// Network checks for `doctor`. Uses Node's built-in fetch (Node >= 18).
import dns from 'node:dns'

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'simular-box-doctor', version: '0' },
  },
})

const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

async function post(url, headers, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  return fetchImpl(url, {
    method: 'POST',
    headers: { ...HEADERS, ...headers },
    body: INIT_BODY,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  })
}

/** Parse `Bearer resource_metadata="...", scope="...", error="..."`. */
export function parseWwwAuthenticate(value) {
  if (!value) return null
  const match = /^\s*Bearer\b(.*)$/i.exec(value)
  if (!match) return null
  const params = {}
  for (const m of match[1].matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) params[m[1]] = m[2]
  return params
}

/**
 * Unauthenticated probe. A healthy box endpoint answers 401 with a WWW-Authenticate header that
 * points at its protected-resource metadata (RFC 9728), which names the authorization server.
 */
export async function probeEndpoint(url, opts = {}) {
  const result = { url, ok: false, status: null, resourceMetadata: null, authorizationServer: null, error: null }
  let res
  try {
    res = await post(url, {}, opts)
  } catch (err) {
    result.error = `cannot reach ${url}: ${err.cause?.code || err.name || err.message}`
    return result
  }
  result.status = res.status
  if (res.status !== 401) {
    result.error = `expected 401 from an unauthenticated request, got ${res.status}`
    return result
  }
  const auth = parseWwwAuthenticate(res.headers.get('www-authenticate'))
  if (!auth?.resource_metadata) {
    result.error = '401 without a WWW-Authenticate resource_metadata link; OAuth clients cannot discover sign-in'
    return result
  }
  result.resourceMetadata = auth.resource_metadata
  try {
    const meta = await (opts.fetchImpl || fetch)(auth.resource_metadata, {
      signal: AbortSignal.timeout(opts.timeoutMs || 10000),
    })
    if (!meta.ok) throw new Error(`HTTP ${meta.status}`)
    const doc = await meta.json()
    result.authorizationServer = doc.authorization_servers?.[0] || null
    if (!result.authorizationServer) throw new Error('no authorization_servers')
    result.resource = doc.resource || null
  } catch (err) {
    result.error = `protected-resource metadata at ${auth.resource_metadata} is unusable: ${err.message}`
    return result
  }
  // MCP clients refuse to sign in when the metadata names another resource (RFC 9728 section 3.3),
  // which is what an old address that now points at a new one looks like.
  if (result.resource && trimSlash(result.resource) !== trimSlash(url)) {
    result.error = `the sign-in metadata names ${result.resource}, not ${url}, so apps will refuse to sign in (box may have moved there)`
    return result
  }
  result.ok = true
  return result
}

function trimSlash(u) {
  return String(u).replace(/\/+$/, '')
}

/**
 * Check a personal key without printing it. 200 = valid; 401 with error="invalid_token" = rejected.
 */
export async function checkKey(url, key, opts = {}) {
  let res
  try {
    res = await post(url, { authorization: `Bearer ${key}` }, opts)
  } catch (err) {
    return { valid: null, status: null, error: `cannot reach ${url}: ${err.cause?.code || err.name}` }
  }
  // Drain the body so the connection can close; it may be an SSE stream, so do not wait on it.
  res.body?.cancel?.().catch(() => {})
  if (res.status >= 200 && res.status < 300) return { valid: true, status: res.status, error: null }
  if (res.status === 401 || res.status === 403) {
    const auth = parseWwwAuthenticate(res.headers.get('www-authenticate'))
    return { valid: false, status: res.status, error: auth?.error || 'rejected' }
  }
  return { valid: null, status: res.status, error: `unexpected HTTP ${res.status}` }
}

/**
 * A plain DNS lookup of the endpoint's host, the way an app that doesn't use a proxy resolves it.
 * The HTTPS probe can succeed through a proxy while this fails; then those apps fail to sign in
 * with ENOTFOUND even though the endpoint looks up (simular-ai/box-portal#191).
 */
export async function lookupHost(url, { lookup = dns.promises.lookup, timeoutMs = 5000 } = {}) {
  let host = null
  let timer
  try {
    host = new URL(url).hostname
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'ETIMEOUT' })), timeoutMs)
    })
    const { address } = await Promise.race([lookup(host), timeout])
    return { host, ok: true, address, error: null }
  } catch (err) {
    return { host, ok: false, address: null, error: err.code || err.message }
  } finally {
    clearTimeout(timer)
  }
}

/** The proxy the environment names for HTTPS, as `NAME=scheme://host:port`, never its user or password. */
export function proxyFromEnv(env) {
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const value = env[name]
    if (!value) continue
    try {
      const u = new URL(value)
      return `${name}=${u.protocol}//${u.host}`
    } catch {
      return `${name} (set)`
    }
  }
  return null
}
