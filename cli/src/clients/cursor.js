// Cursor: ~/.cursor/mcp.json, `mcpServers`, written by add-mcp. Cursor signs in to remote servers
// with OAuth (DCR + PKCE) itself. Docs: https://cursor.com/docs/context/mcp
import path from 'node:path'
import { addMcpClient } from './add-mcp-client.js'

export default addMcpClient({
  id: 'cursor',
  agent: 'cursor',
  name: 'Cursor',
  bins: ['cursor', 'agent', 'cursor-agent'],
  dirs: (ctx) => [path.join(ctx.home, '.cursor'), ...(ctx.platform === 'darwin' ? ['/Applications/Cursor.app'] : [])],
  next: (ctx) => [`Open Cursor Settings -> MCP (Tools & MCP) and click Login next to ${ctx.name}; sign in and click Approve.`],
})
