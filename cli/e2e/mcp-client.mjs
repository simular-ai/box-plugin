// Minimal MCP client over streamable HTTP with a bearer key.
export async function connectMcp(url, key, { clientName = 'box-ci' } = {}) {
  let session
  let nextId = 1
  async function rpc(method, params, { notify = false, timeoutMs = 60000 } = {}) {
    const id = notify ? undefined : nextId++
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
      signal: AbortSignal.timeout(timeoutMs),
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

  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '0' } })
  await rpc('notifications/initialized', undefined, { notify: true })
  return {
    serverInfo: init.serverInfo,
    listTools: async () => (await rpc('tools/list', {})).tools,
    callTool: (name, args, { timeoutMs = 180000 } = {}) => rpc('tools/call', { name, arguments: args }, { timeoutMs }),
  }
}
