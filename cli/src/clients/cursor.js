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
  // ~/.cursor/mcp.json is shared by the editor and its command line (cursor-agent, also `agent`),
  // which has no Settings screen, so both get a step.
  next: (ctx) => [
    `In the editor: open Customize in the left sidebar (or Cursor Settings -> Open Customize), choose MCPs and click Authenticate next to ${ctx.name}; sign in and click Allow. Older versions: Cursor Settings -> Tools & MCP -> Login.`,
    `In the cursor-agent command line (also \`agent\`): run \`cursor-agent mcp login ${ctx.name}\`, sign in and click Allow, then start a new cursor-agent session.`,
  ],
})
