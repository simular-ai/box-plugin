// Hermes Agent: $HERMES_HOME/config.yaml (default ~/.hermes), `mcp_servers.box`.
// OAuth (default): `{url, auth: oauth}`; Hermes signs in with `hermes mcp login box`.
// Personal key (--auth key, for always-on servers): the header references ${MCP_BOX_API_KEY}, the
// name `hermes mcp add --auth header` itself uses, and the key goes to $HERMES_HOME/.env (0600),
// where Hermes loads secrets from. A running gateway caches the old key, so it is restarted.
// We write the YAML directly because `hermes mcp add` is interactive and cancels without a TTY.
// Sources: https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/mcp_config.py ,
// https://github.com/NousResearch/hermes-agent/blob/main/tools/mcp_tool.py ,
// https://github.com/NousResearch/hermes-agent/blob/main/hermes_constants.py
import fs from 'node:fs'
import path from 'node:path'
import { LEGACY_SERVER_NAMES, SERVER_NAME } from '../constants.js'
import { readText, updateFile } from '../fsutil.js'
import { readEnvValue, readYaml, removeEnvValue, removeYamlServers, upsertEnvValue, upsertYamlServer } from '../formats.js'

export const HERMES_KEY_ENV = 'MCP_BOX_API_KEY'
const KEY_REF = `Bearer \${${HERMES_KEY_ENV}}`

function home(ctx) {
  if (ctx.env.HERMES_HOME) return ctx.env.HERMES_HOME
  if (ctx.platform === 'win32' && ctx.env.LOCALAPPDATA) return path.join(ctx.env.LOCALAPPDATA, 'hermes')
  return path.join(ctx.home, '.hermes')
}
const configFile = (ctx) => path.join(home(ctx), 'config.yaml')
const envFile = (ctx) => path.join(home(ctx), '.env')

function serverEntry(ctx) {
  const f = configFile(ctx)
  return (readYaml(readText(f), f).mcp_servers || {})
}

export default {
  id: 'hermes',
  name: 'Hermes Agent',
  auth: 'oauth',
  supportsKey: true,

  detect(ctx) {
    if (ctx.which('hermes')) return { installed: true, via: 'hermes on PATH' }
    if (fs.existsSync(home(ctx))) return { installed: true, via: home(ctx), cliMissing: true }
    return { installed: false }
  },

  configLocation: configFile,

  status(ctx) {
    const servers = serverEntry(ctx)
    const box = servers[SERVER_NAME]
    const usesKey = Boolean(box?.headers && JSON.stringify(box.headers).includes(HERMES_KEY_ENV))
    const key = usesKey ? readEnvValue(readText(envFile(ctx)), HERMES_KEY_ENV) || ctx.env[HERMES_KEY_ENV] : undefined
    const warnings = []
    if (usesKey && !key) warnings.push(`box reads ${HERMES_KEY_ENV}, but it is not set in ${envFile(ctx)}`)
    return {
      entries: box ? [{ where: configFile(ctx), url: box.url, enabled: box.enabled !== false, mode: usesKey ? 'key' : 'oauth' }] : [],
      legacy: LEGACY_SERVER_NAMES.filter((n) => servers[n]),
      key,
      keyConfigured: Boolean(key),
      warnings,
    }
  },

  connect(ctx, { mode = 'oauth', key } = {}) {
    const f = configFile(ctx)
    const entry =
      mode === 'key'
        ? { url: ctx.url, headers: { Authorization: KEY_REF }, enabled: true }
        : { url: ctx.url, auth: 'oauth', enabled: true }
    const actions = []
    const backups = []
    const next = []
    let keyChanged = false
    if (mode === 'key') {
      const useKey = key || this.status(ctx).key
      if (!useKey) throw new Error('a personal key is needed')
      const r = updateFile(envFile(ctx), (text) => upsertEnvValue(text, HERMES_KEY_ENV, useKey), { mode: 0o600, dryRun: ctx.dryRun })
      if (r.changed) {
        keyChanged = true
        actions.push(`${ctx.dryRun ? 'would save' : 'saved'} the key as ${HERMES_KEY_ENV} in ${envFile(ctx)}`)
      }
      if (r.backup) backups.push(r.backup)
    }
    const r = updateFile(f, (text) => upsertYamlServer(text, 'mcp_servers', SERVER_NAME, entry, { legacy: LEGACY_SERVER_NAMES, file: f }), {
      dryRun: ctx.dryRun,
    })
    if (r.changed) actions.push(`${ctx.dryRun ? 'would write' : 'wrote'} mcp_servers.box (${mode === 'key' ? 'personal key' : 'OAuth'}) to ${f}`)
    if (r.backup) backups.push(r.backup)

    if (mode === 'oauth') next.push('Run `hermes mcp login box`, sign in in the browser and click Approve (on a server without a browser: `hermes mcp login box --flow device`, or use --auth key).')
    if ((keyChanged || r.changed) && !ctx.dryRun) {
      // A running gateway keeps the old config and key until it restarts.
      if (ctx.which('hermes')) {
        const st = ctx.run('hermes', ['gateway', 'status'], { timeoutMs: 20000 })
        if (st.status === 0 && /running/i.test(st.stdout) && !/not running/i.test(st.stdout)) {
          const rr = ctx.run('hermes', ['gateway', 'restart'], { timeoutMs: 60000 })
          if (rr.status === 0) actions.push('restarted the Hermes gateway so it picks up the change')
          else next.push('Run `hermes gateway restart` so the gateway picks up the change.')
        }
      } else next.push('If a Hermes gateway is running, run `hermes gateway restart` so it picks up the change.')
    }
    next.push('In an open Hermes chat, run /reload-mcp (or start a new session).')
    return { actions, backups, next }
  },

  remove(ctx) {
    const actions = []
    const backups = []
    const f = configFile(ctx)
    const r = updateFile(f, (text) => removeYamlServers(text, 'mcp_servers', [SERVER_NAME, ...LEGACY_SERVER_NAMES], { file: f }), { dryRun: ctx.dryRun })
    if (r.changed) actions.push(`${ctx.dryRun ? 'would remove' : 'removed'} mcp_servers.box from ${f}`)
    if (r.backup) backups.push(r.backup)
    const e = updateFile(envFile(ctx), (text) => removeEnvValue(text, HERMES_KEY_ENV), { dryRun: ctx.dryRun })
    if (e.changed) actions.push(`${ctx.dryRun ? 'would remove' : 'removed'} ${HERMES_KEY_ENV} from ${envFile(ctx)}`)
    if (e.backup) backups.push(e.backup)
    return { actions, backups, next: actions.length ? ['Run `hermes gateway restart` if a gateway is running.'] : [] }
  },
}
