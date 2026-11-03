// Minimal MCP client: initialize + tools/list over streamable HTTP with a bearer key.
// Lists tools only; never calls one (calling would wake the box or act on it).
//   BOX_MCP_URL=... BOX_TOKEN=cb_... node e2e/mcp-tools.mjs
const url = process.env.BOX_MCP_URL
const key = process.env.BOX_TOKEN
if (!url || !key) throw new Error('set BOX_MCP_URL and BOX_TOKEN')

let session
async function rpc(method, params, id) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${key}`,
      ...(session ? { 'mcp-session-id': session } : {}),
      ...(method !== 'initialize' ? { 'mcp-protocol-version': '2025-06-18' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(id !== undefined ? { id } : {}) }),
    signal: AbortSignal.timeout(60000),
  })
  if (res.status === 401) throw new Error('401: the key was rejected')
  if (!res.ok && res.status !== 202) throw new Error(`${method}: HTTP ${res.status}`)
  session = res.headers.get('mcp-session-id') || session
  if (id === undefined) return null
  const type = res.headers.get('content-type') || ''
  const text = await res.text()
  const messages = type.includes('text/event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
    : [JSON.parse(text)]
  const reply = messages.find((m) => m.id === id)
  if (!reply) throw new Error(`${method}: no reply`)
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`)
  return reply.result
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'box-ci', version: '0' } }, 1)
await rpc('notifications/initialized')
const { tools } = await rpc('tools/list', {}, 2)
console.log(`server ${init.serverInfo?.name} ${init.serverInfo?.version}: ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`)
if (!tools.length) throw new Error('no tools listed')
