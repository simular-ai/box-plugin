// VS Code (GitHub Copilot agent mode): user-profile mcp.json, `servers`, `type: "http"`, written by
// add-mcp. VS Code runs the OAuth sign-in itself. Docs:
// https://code.visualstudio.com/docs/agents/reference/mcp-configuration
// Detection uses the user-data folder, not `code` on PATH: Cursor also installs a `code` shim.
import path from 'node:path'
import { addMcpClient } from './add-mcp-client.js'

export default addMcpClient({
  id: 'vscode',
  agent: 'vscode',
  name: 'VS Code',
  aliases: ['code', 'copilot'],
  dirs: (ctx) => [path.join(ctx.appData, 'Code', 'User')],
  next: (ctx) => [`In VS Code, open the Command Palette -> MCP: List Servers -> ${ctx.name} -> Start, then allow the sign-in and click Approve.`],
})
