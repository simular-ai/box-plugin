import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'

// BrowserLogin signs the CLI in as the relay's first-party client (RFC 8252), as upstream's `cocoonbox login`: it opens
// the consent page, takes the answer on a loopback port of its own, and redeems the code with PKCE for a device token,
// which has no expiry and no refresh token and is revoked under Keys -> Devices.

export const CLI_CLIENT = 'cocoonbox-cli'
const AUTHORIZE_PATH = '/cb/oauth/authorize'
const TOKEN_PATH = '/oauth/token'
const REVOKE_PATH = '/oauth/revoke'
const MAX_DEVICE_NAME = 64
const PAGE = '<!doctype html><meta charset=utf-8><title>box</title><p>box has the answer. You can close this tab and return to the terminal.'

const urlSafe = (buf) => buf.toString('base64url')

export function challenge(verifier) {
  return urlSafe(crypto.createHash('sha256').update(verifier).digest())
}

/** deviceName is this computer's name as the consent page and the Devices list show it. */
export function deviceName(host = os.hostname()) {
  const name = host.endsWith('.local') ? host.slice(0, -6) : host
  let out = ''
  for (const ch of name) {
    if (Buffer.byteLength(out + ch) > MAX_DEVICE_NAME) break
    out += ch
  }
  return out
}

export function authorizeUrl(endpoint, { redirect, challenge: chal, state, device }) {
  const url = new URL(endpoint + AUTHORIZE_PATH)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLI_CLIENT,
    redirect_uri: redirect,
    scope: 'account',
    code_challenge: chal,
    code_challenge_method: 'S256',
    state,
    device_name: device,
  }).toString()
  return url.toString()
}

/** listen opens 127.0.0.1 on a free port and resolves the query of the first GET /callback. */
function listen() {
  let deliver
  const answered = new Promise((resolve) => (deliver = resolve))
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE)
    deliver(url.searchParams)
  })
  return new Promise((resolve, reject) => {
    server.once('error', (err) => reject(new Error(`cannot listen on 127.0.0.1: ${err.message}`)))
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, answered }))
  })
}

async function post(endpoint, pathname, fields, fetchImpl = fetch) {
  const res = await fetchImpl(endpoint + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(15000),
  })
  let body = {}
  try {
    body = await res.json()
  } catch {
    // an empty or non-JSON answer
  }
  return { status: res.status, body }
}

/**
 * browserLogin runs the sign-in: open(url) shows the consent page; the promise resolves to the device token.
 * The token is returned to the caller only; it is never printed or logged here.
 */
export async function browserLogin(endpoint, { open, timeoutMs = 600000, device = deviceName(), fetchImpl } = {}) {
  const { server, port, answered } = await listen()
  try {
    const verifier = urlSafe(crypto.randomBytes(32))
    const state = urlSafe(crypto.randomBytes(16))
    const redirect = `http://127.0.0.1:${port}/callback`
    await open(authorizeUrl(endpoint, { redirect, challenge: challenge(verifier), state, device }))
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('no answer from the browser in time')), timeoutMs)
    })
    const answer = await Promise.race([answered, timeout]).finally(() => clearTimeout(timer))
    if (answer.get('state') !== state) throw new Error('the browser brought back an answer to another sign-in')
    const iss = answer.get('iss')
    if ((iss || '').toLowerCase() !== endpoint.toLowerCase()) throw new Error(`the answer came from ${iss || 'an unnamed issuer'}, not ${endpoint}`)
    if (answer.get('error')) throw new Error(`the sign-in was denied: ${answer.get('error_description') || answer.get('error')}`)
    const code = answer.get('code')
    if (!code) throw new Error('the answer carries no code')
    const { status, body } = await post(
      endpoint,
      TOKEN_PATH,
      { grant_type: 'authorization_code', code, client_id: CLI_CLIENT, redirect_uri: redirect, code_verifier: verifier },
      fetchImpl,
    )
    if (status !== 200 || !body.access_token) throw new Error(`the server refused the sign-in: ${body.error_description || `HTTP ${status}`}`)
    return body.access_token
  } finally {
    server.close()
    server.closeAllConnections?.()
  }
}

/** revoke ends a device token at the server; a token that is no device's is left alone (RFC 7009). */
export async function revoke(endpoint, token, { fetchImpl } = {}) {
  const { status } = await post(endpoint, REVOKE_PATH, { token, client_id: CLI_CLIENT }, fetchImpl)
  if (status !== 200) throw new Error(`the server answered HTTP ${status} to the revoke`)
}
