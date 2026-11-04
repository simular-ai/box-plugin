// OpenCode: ~/.config/opencode/opencode.json(c), `mcp` (or `mcp.servers` in the newer layout),
// `{ type: "remote", url }`, written by add-mcp. OpenCode detects the 401 and runs OAuth (DCR)
// itself; `opencode mcp auth box` signs in. Docs: https://opencode.ai/docs/mcp-servers/
import path from 'node:path'
import { addMcpClient } from './add-mcp-client.js'

export default addMcpClient({
  id: 'opencode',
  agent: 'opencode',
  name: 'OpenCode',
  bins: ['opencode'],
  dirs: (ctx) => [path.join(ctx.xdgConfig, 'opencode')],
  // OpenCode honours XDG_CONFIG_HOME; add-mcp 2.6.1 always writes ~/.config/opencode. Stop rather
  // than write a file OpenCode never reads.
  check(ctx, info) {
    if (path.resolve(path.dirname(info.path)) !== path.resolve(ctx.xdgConfig, 'opencode')) {
      throw new Error(
        `OpenCode reads ${path.join(ctx.xdgConfig, 'opencode')} (XDG_CONFIG_HOME), but this version can only write ${info.path}. ` +
          `Add box by hand under "mcp" in ${path.join(ctx.xdgConfig, 'opencode', 'opencode.json')}: "${ctx.name}": { "type": "remote", "url": "${ctx.url}" }`,
      )
    }
  },
  next: (ctx) => [`Run \`opencode mcp auth ${ctx.name}\`, sign in in the browser and click Approve.`],
})
