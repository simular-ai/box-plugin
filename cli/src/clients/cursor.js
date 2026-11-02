// Cursor: ~/.cursor/mcp.json, `mcpServers`. Cursor signs in to remote servers with OAuth
// (DCR + PKCE) itself. Docs: https://cursor.com/docs/context/mcp
import path from 'node:path'
import { jsonClient } from './json-client.js'

export default jsonClient({
  id: 'cursor',
  name: 'Cursor',
  auth: 'oauth',
  file: (ctx) => path.join(ctx.home, '.cursor', 'mcp.json'),
  container: ['mcpServers'],
  entry: (ctx) => ({ url: ctx.url }),
  bins: ['cursor', 'agent', 'cursor-agent'],
  dirs: (ctx) => [path.join(ctx.home, '.cursor'), ...(ctx.platform === 'darwin' ? ['/Applications/Cursor.app'] : [])],
  next: ['Open Cursor Settings -> MCP (Tools & MCP) and click Login next to box; sign in and click Approve.'],
})
