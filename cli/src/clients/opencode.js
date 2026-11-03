// OpenCode: ~/.config/opencode/opencode.json(c), `mcp`, `{ type: "remote", url }`. OpenCode
// detects the 401 and runs OAuth (DCR) itself; `opencode mcp auth box` signs in.
// Docs: https://opencode.ai/docs/mcp-servers/ , https://opencode.ai/docs/config/
import fs from 'node:fs'
import path from 'node:path'
import { jsonClient } from './json-client.js'

function file(ctx) {
  if (ctx.env.OPENCODE_CONFIG) return ctx.env.OPENCODE_CONFIG
  const dir = path.join(ctx.xdgConfig, 'opencode')
  const jsonc = path.join(dir, 'opencode.jsonc')
  return fs.existsSync(jsonc) ? jsonc : path.join(dir, 'opencode.json')
}

export default jsonClient({
  id: 'opencode',
  name: 'OpenCode',
  auth: 'oauth',
  file,
  container: ['mcp'],
  entry: (ctx) => ({ type: 'remote', url: ctx.url, enabled: true }),
  bins: ['opencode'],
  dirs: (ctx) => [path.join(ctx.xdgConfig, 'opencode')],
  next: (ctx) => [`Run \`opencode mcp auth ${ctx.name}\`, sign in in the browser and click Approve.`],
})
