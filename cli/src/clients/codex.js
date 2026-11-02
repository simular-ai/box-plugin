// Codex CLI: $CODEX_HOME/config.toml (default ~/.codex), `[mcp_servers.box]` with `url`.
// Codex runs OAuth itself (`codex mcp login box`). We edit the TOML instead of running
// `codex mcp add`, because `add` starts the browser sign-in inline and would block a scripted run.
// Sources: https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs ,
// https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs
import fs from 'node:fs'
import path from 'node:path'
import { LEGACY_SERVER_NAMES, SERVER_NAME } from '../constants.js'
import { readText, updateFile } from '../fsutil.js'
import { parseToml, removeTomlServers, upsertTomlServer } from '../formats.js'

const home = (ctx) => ctx.env.CODEX_HOME || path.join(ctx.home, '.codex')
const file = (ctx) => path.join(home(ctx), 'config.toml')

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

  status(ctx) {
    const f = file(ctx)
    const servers = parseToml(readText(f), f).mcp_servers || {}
    const box = servers[SERVER_NAME]
    const warnings = []
    if (box && (box.bearer_token_env_var || box.http_headers || box.env_http_headers)) {
      warnings.push('box has a bearer token or headers set; Codex then skips OAuth. Re-run connect to reset it')
    }
    return {
      entries: box ? [{ where: f, url: box.url, enabled: box.enabled !== false }] : [],
      legacy: LEGACY_SERVER_NAMES.filter((n) => servers[n]),
      keyConfigured: false,
      warnings,
    }
  },

  connect(ctx) {
    const f = file(ctx)
    const res = updateFile(f, (text) => upsertTomlServer(text, SERVER_NAME, { url: ctx.url }, { legacy: LEGACY_SERVER_NAMES, file: f }), {
      dryRun: ctx.dryRun,
    })
    return {
      actions: res.changed ? [`${ctx.dryRun ? 'would write' : 'wrote'} [mcp_servers.box] to ${f}`] : [],
      backups: res.backup ? [res.backup] : [],
      next: ['Run `codex mcp login box`, sign in in the browser and click Approve.'],
    }
  },

  remove(ctx) {
    const f = file(ctx)
    const res = updateFile(f, (text) => removeTomlServers(text, [SERVER_NAME, ...LEGACY_SERVER_NAMES], { file: f }), { dryRun: ctx.dryRun })
    return {
      actions: res.changed ? [`${ctx.dryRun ? 'would remove' : 'removed'} [mcp_servers.box] from ${f}`] : [],
      backups: res.backup ? [res.backup] : [],
      next: res.changed ? ['To also drop the stored sign-in: `codex mcp logout box` (before removing) or revoke it at https://box.simular.ai/keys.'] : [],
    }
  },
}
