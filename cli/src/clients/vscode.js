// VS Code (GitHub Copilot agent mode): user-profile mcp.json, `servers`, `type: "http"`.
// VS Code runs the OAuth sign-in itself. Docs:
// https://code.visualstudio.com/docs/agents/reference/mcp-configuration
// Detection uses the user-data folder, not `code` on PATH: Cursor also installs a `code` shim.
import path from 'node:path'
import { jsonClient } from './json-client.js'

const userDir = (ctx) => path.join(ctx.appData, 'Code', 'User')

export default jsonClient({
  id: 'vscode',
  name: 'VS Code',
  auth: 'oauth',
  aliases: ['code', 'copilot'],
  file: (ctx) => path.join(userDir(ctx), 'mcp.json'),
  container: ['servers'],
  entry: (ctx) => ({ type: 'http', url: ctx.url }),
  dirs: (ctx) => [userDir(ctx)],
  next: ['In VS Code, open the Command Palette -> MCP: List Servers -> box -> Start, then allow the sign-in and click Approve.'],
})
