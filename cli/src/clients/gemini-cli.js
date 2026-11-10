// Gemini CLI: ~/.gemini/settings.json, `mcpServers`, `{ type: "http", url }` (streamable HTTP).
// On a 401 Gemini CLI marks the server as needing OAuth; `/mcp auth box` discovers the sign-in
// from the WWW-Authenticate header and runs it. MCP servers load only in a trusted folder.
// Docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
import path from 'node:path'
import { jsonClient } from './json-client.js'

export default jsonClient({
  id: 'gemini-cli',
  name: 'Gemini CLI',
  auth: 'oauth',
  aliases: ['gemini'],
  file: (ctx) => path.join(ctx.home, '.gemini', 'settings.json'),
  container: ['mcpServers'],
  entry: (ctx) => ({ type: 'http', url: ctx.url }),
  // Gemini CLI also reads `httpUrl` (its older field for streamable HTTP).
  entryUrl: (e) => e?.url ?? e?.httpUrl,
  bins: ['gemini'],
  dirs: (ctx) => [path.join(ctx.home, '.gemini')],
  next: (ctx) => [`Start Gemini CLI in a trusted folder, run \`/mcp auth ${ctx.name}\`, sign in in the browser and click Allow.`],
})
