/**
 * box by Simular for DeepSeek Harness, Host half.
 *
 * dsh's MCP client sends fixed headers and has no sign-in, so box authenticates with a personal
 * key (cb_...). This plugin reads it from dsh's credentials store under BOX_TOKEN (which also
 * falls back to the launch environment and ~/.dsh/.env) and provides it as the `boxAuth` service.
 * The `mcp-box` row injects `boxAuth`, so it starts once a key exists and restarts with the new
 * header whenever the key changes. The browser half (client.js) is the key page on Plugins.
 *
 * It also serves the live view that client.js shows in the chat for box_view: box's MCP App
 * (ui://box/live), the same page ChatGPT and Claude render inline. The page runs in a sandboxed
 * iframe and calls a few box tools through its host; this route relays those calls with the key,
 * which never reaches the browser. Only the tools the page needs pass.
 */
export const name = '@simular/dsh-box'
export const inject = ['credentials']

const REF = 'BOX_TOKEN'
const MCP_URL = process.env.BOX_MCP_URL || 'https://mcp.box.simular.ai/mcp'
/** Relative to the shared /api channel; client.js posts to the same path without the leading slash. */
const LIVE_PATH = '/api/simular-box/live'
const LIVE_URI = 'ui://box/live'
/** The tools the live view calls (live.js): screen token, state, waking, approvals. */
const VIEW_TOOLS = new Set([
  'box_view',
  'box_view_token',
  'box_status',
  'box_approvals',
  'box_approval_token',
  'box_approval_answer',
])
const PROTOCOL = '2025-06-18'
const CALL_TIMEOUT_MS = 180_000

export function apply(ctx) {
  let token
  let unprovide
  let generation = 0
  const refresh = async () => {
    const mine = ++generation
    const hit = await ctx.credentials.resolve(REF)
    if (mine !== generation) return
    unprovide?.()
    unprovide = undefined
    token = hit?.value?.trim() || undefined
    mcp.reset()
    if (token) unprovide = ctx.provide('boxAuth', { authorization: `Bearer ${token}` })
  }
  // Log why the key couldn't be read (never the key itself); otherwise mcp-box just waits on
  // boxAuth with no reason shown.
  const refreshLogged = () =>
    refresh().catch((err) => ctx.logger?.warn('box: could not read BOX_TOKEN', err?.message))

  const mcp = createMcp(() => token)

  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === REF) void refreshLogged()
  })
  void refreshLogged()

  // Only owner Peers reach an exact route (Connection answers 403 for anyone else), on Web and Desktop alike.
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => scope.connection.fetch.register({
      path: LIVE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => serveLive(request, mcp, () => token),
    }), 'dsh-box: live view route')
  })
}

/** One relay request: `{ op: 'page' }` reads the view's page, `{ op: 'tool', name, arguments }` calls a view tool. */
async function serveLive(request, mcp, currentToken) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad request' }, 400)
  }
  if (!currentToken()) return json({ error: 'No box key yet. Add one on the box plugin page under Plugins.' }, 409)
  try {
    if (body?.op === 'page') {
      const read = await mcp.request('resources/read', { uri: LIVE_URI })
      const page = read?.contents?.find((c) => c?.uri === LIVE_URI)
      if (typeof page?.text !== 'string') return json({ error: 'box sent no live view page' }, 502)
      return json({ html: page.text, meta: page._meta ?? null })
    }
    if (body?.op === 'tool' && typeof body.name === 'string' && VIEW_TOOLS.has(body.name)) {
      const args = body.arguments && typeof body.arguments === 'object' ? body.arguments : {}
      return json({ result: await mcp.request('tools/call', { name: body.name, arguments: args }) })
    }
    return json({ error: 'not allowed' }, 403)
  } catch (err) {
    return json({ error: err?.message ?? String(err) }, 502)
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * A minimal Streamable HTTP MCP client for the relay: one session per key, opened on first use and
 * again when the server drops it. Answers may come as JSON or as an SSE stream.
 */
function createMcp(currentToken) {
  let session
  let opening
  let nextId = 1

  async function post(message, sessionId) {
    const headers = {
      authorization: `Bearer ${currentToken()}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
    }
    if (sessionId) headers['mcp-session-id'] = sessionId
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    return res
  }

  async function answer(res, id) {
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'box refused the key (401). Check it on the box plugin page.' : `box answered ${res.status}`)
      err.status = res.status
      throw err
    }
    if (id === undefined) return undefined
    const type = res.headers.get('content-type') ?? ''
    let message
    if (type.includes('text/event-stream')) {
      const text = await res.text()
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
        if (!data) continue
        const parsed = JSON.parse(data)
        if (parsed?.id === id) message = parsed
      }
    } else {
      message = await res.json()
    }
    if (!message) throw new Error('box sent no answer')
    if (message.error) throw new Error(message.error.message ?? 'box error')
    return message.result
  }

  async function open() {
    const id = nextId++
    const res = await post({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dsh-box-live-view', version: '0.3.0' } },
    })
    await answer(res, id)
    const sessionId = res.headers.get('mcp-session-id') ?? ''
    await answer(await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId), undefined)
    return sessionId
  }

  async function ensure() {
    if (session !== undefined) return session
    opening ??= open().finally(() => {
      opening = undefined
    })
    session = await opening
    return session
  }

  return {
    reset() {
      session = undefined
    },
    async request(method, params) {
      for (let attempt = 0; ; attempt++) {
        const sessionId = await ensure()
        const id = nextId++
        try {
          return await answer(await post({ jsonrpc: '2.0', id, method, params }, sessionId), id)
        } catch (err) {
          // A dropped or expired session answers 404 (or 400): open a new one once.
          if (attempt === 0 && (err.status === 404 || err.status === 400)) {
            session = undefined
            continue
          }
          throw err
        }
      }
    },
  }
}
