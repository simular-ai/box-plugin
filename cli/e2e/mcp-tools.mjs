// Minimal MCP check: initialize + tools/list over streamable HTTP with a bearer key.
// Lists tools only; never calls one (calling would wake the box or act on it).
//   BOX_MCP_URL=... BOX_TOKEN=cb_... node e2e/mcp-tools.mjs
import { connectMcp } from './mcp-client.mjs'

const url = process.env.BOX_MCP_URL
const key = process.env.BOX_TOKEN
if (!url || !key) throw new Error('set BOX_MCP_URL and BOX_TOKEN')

const mcp = await connectMcp(url, key)
const tools = await mcp.listTools()
console.log(`server ${mcp.serverInfo?.name} ${mcp.serverInfo?.version}: ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`)
if (!tools.length) throw new Error('no tools listed')
