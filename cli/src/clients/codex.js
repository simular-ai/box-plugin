// Codex CLI: $CODEX_HOME/config.toml (default ~/.codex), `[mcp_servers.box]` with `url`.
// Codex runs OAuth itself (`codex mcp login box`). We edit the TOML instead of running
// `codex mcp add`, because `add` starts the browser sign-in inline and would block a scripted run.
// Sources: https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs ,
// https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs
import fs from 'node:fs'
import path from 'node:path'
import { ForeignServerError, LEGACY_SERVER_NAMES } from '../constants.js'
import { readText, updateFile } from '../fsutil.js'
import { parseToml, removeTomlServers, upsertTomlServer } from '../formats.js'

const home = (ctx) => ctx.env.CODEX_HOME || path.join(ctx.home, '.codex')
const file = (ctx) => path.join(home(ctx), 'config.toml')
const servers = (ctx) => parseToml(readText(file(ctx)), file(ctx)).mcp_servers || {}
const ourLegacy = (ctx, map) => LEGACY_SERVER_NAMES.filter((n) => map[n] && ctx.ours(map[n].url))

// The Codex app (ChatGPT desktop) reads the same config.toml but ships no `codex` on PATH.
function signInHint(ctx) {
  if (ctx.which('codex')) return `Run \`codex mcp login ${ctx.name}\`, sign in in the browser and click Allow.`
  return `Restart the Codex app, open Settings -> MCP servers and click Authenticate next to ${ctx.name}; sign in in the browser and click Allow.`
}

export default {
  id: 'codex',
  name: 'Codex',
  auth: 'oauth',
  aliases: ['codex-cli'],

  detect(ctx) {
    if (ctx.which('codex')) return { installed: true, via: 'codex on PATH' }
    if (fs.existsSync(home(ctx))) return { installed: true, via: home(ctx), cliMissing: true }
    return { installed: false }
  },

  configLocation: file,
  /** Files connect writes itself, checked before anything changes. */
  writes: (ctx) => [file(ctx)],

  status(ctx) {
    const f = file(ctx)
    const map = servers(ctx)
    const box = map[ctx.name]
    if (box && !ctx.ours(box.url)) return { entries: [], legacy: [], keyConfigured: false, foreign: { where: f, url: box.url || box.command } }
    const warnings = []
    if (box && (box.bearer_token_env_var || box.http_headers || box.env_http_headers)) {
      warnings.push('box has a bearer token or headers set; Codex then skips OAuth. Re-run connect to reset it')
    }
    return {
      entries: box ? [{ where: f, url: box.url, enabled: box.enabled !== false }] : [],
      legacy: ourLegacy(ctx, map),
      keyConfigured: false,
      warnings,
    }
  },

  connect(ctx) {
    const f = file(ctx)
    const map = servers(ctx)
    const current = map[ctx.name]
    if (current && !ctx.ours(current.url)) throw new ForeignServerError(f, ctx.name, current.url || current.command)
    const res = updateFile(f, (text) => upsertTomlServer(text, ctx.name, { url: ctx.url }, { legacy: ourLegacy(ctx, map), file: f }), {
      dryRun: ctx.dryRun,
    })
    return {
      actions: res.changed ? [`${ctx.dryRun ? 'would write' : 'wrote'} [mcp_servers.${ctx.name}] to ${f}`] : [],
      backups: res.backup ? [res.backup] : [],
      next: [signInHint(ctx)],
    }
  },

  /** Shown when config.toml cannot be written (EACCES/EPERM, "Access is denied" on Windows). */
  permissionHelp(ctx) {
    return [
      `If the Codex app holds the file, add box there instead: Settings -> MCP servers -> Add server, name it ${ctx.name}, choose Streamable HTTP, paste ${ctx.url} as the URL and click Save.`,
      `Restart Codex, then click Authenticate next to ${ctx.name}, sign in in the browser and click Allow.`,
    ]
  },

  remove(ctx) {
    const f = file(ctx)
    const map = servers(ctx)
    const names = [ctx.name, ...LEGACY_SERVER_NAMES].filter((n) => map[n] && ctx.ours(map[n].url))
    const warnings = map[ctx.name] && !names.includes(ctx.name) ? [`left [mcp_servers.${ctx.name}] in ${f}: it is not box by Simular`] : []
    // Drop the stored sign-in too, while Codex still knows the server (best effort).
    if (names.includes(ctx.name) && !ctx.dryRun && ctx.which('codex')) ctx.run('codex', ['mcp', 'logout', ctx.name], { timeoutMs: 30000 })
    const res = updateFile(f, (text) => removeTomlServers(text, names, { file: f }), { dryRun: ctx.dryRun })
    return {
      actions: res.changed ? [`${ctx.dryRun ? 'would remove' : 'removed'} ${names.map((n) => `[mcp_servers.${n}]`).join(', ')} from ${f}`] : [],
      backups: res.backup ? [res.backup] : [],
      warnings,
      next: [],
    }
  },
}
