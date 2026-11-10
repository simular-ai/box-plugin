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
  next: (ctx) => [`Run \`opencode mcp auth ${ctx.name}\`, sign in in the browser and click Allow.`],
  // Without this step box shows "needs authentication" and loads no tools, so an interactive
  // connect offers to run it. `opencode mcp auth` exits 0 even when sign-in fails or times out,
  // so the result is read back from `opencode mcp auth list` instead of the exit code.
  signIn: {
    bin: 'opencode',
    args: (ctx) => ['mcp', 'auth', ctx.name],
    signedIn(ctx) {
      const res = ctx.run('opencode', ['mcp', 'auth', 'list'], { timeoutMs: 30000 })
      if (res.status !== 0) return undefined
      return authListSaysSignedIn(res.stdout, ctx.name)
    },
  },
})

/** Pure: whether `opencode mcp auth list` shows `name` as authenticated; undefined when it isn't listed. */
export function authListSaysSignedIn(stdout, name) {
  // eslint-disable-next-line no-control-regex
  const lines = String(stdout).replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  const line = lines.find((l) => l.split(/\s+/).includes(name))
  if (!line) return undefined
  return line.includes('✓') && !/not authenticated|expired/i.test(line)
}
