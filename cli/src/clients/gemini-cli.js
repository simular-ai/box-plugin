// Gemini CLI: ~/.gemini/settings.json, `mcpServers`, `{ type: "http", url }`, written by add-mcp.
// Gemini CLI discovers OAuth from the 401 and signs in with `/mcp auth box`. It loads MCP servers
// only in a trusted folder. Docs: https://geminicli.com/docs/tools/mcp-server/
import path from 'node:path'
import { addMcpClient } from './add-mcp-client.js'

export default addMcpClient({
  id: 'gemini-cli',
  agent: 'gemini-cli',
  name: 'Gemini CLI',
  aliases: ['gemini'],
  bins: ['gemini'],
  dirs: (ctx) => [path.join(ctx.home, '.gemini')],
  next: (ctx) => [`Start Gemini CLI in a trusted folder, run \`/mcp auth ${ctx.name}\`, sign in in the browser and click Approve.`],
})
