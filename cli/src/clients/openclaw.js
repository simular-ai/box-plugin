// OpenClaw: `mcp.servers.box` in openclaw.json (JSON5, managed by OpenClaw). Written through
// OpenClaw's own `openclaw mcp set/show/unset`, so its config journal and paths stay right.
// OAuth (default): `{url, transport: "streamable-http", auth: "oauth"}`, then `openclaw mcp login box`.
// Without `transport` OpenClaw defaults to SSE, so it is always set.
// Personal key (--auth key): the header is `Bearer ${BOX_TOKEN}` and the key goes to the state
// dir's .env (0600). OpenClaw substitutes ${VAR} from its own process environment and sends the
// placeholder literally when the variable is unset (the 401 seen in box-plugin#2): a Gateway
// started by launchd/systemd never sees a shell export, but it does load <state dir>/.env, and
// only at start, hence the restart.
// Sources: https://github.com/openclaw/openclaw/blob/main/src/cli/mcp-cli.ts ,
// https://github.com/openclaw/openclaw/blob/main/src/config/env-substitution.ts ,
// https://github.com/openclaw/openclaw/blob/main/docs/help/environment.md
import fs from 'node:fs'
import path from 'node:path'
import { ForeignServerError, KEY_ENV, LEGACY_SERVER_NAMES } from '../constants.js'
import { readText, updateFile } from '../fsutil.js'
import { parseJsonc, readEnvValue, removeEnvValue, sameValue, upsertEnvValue } from '../formats.js'

const KEY_REF = `Bearer \${${KEY_ENV}}`

function stateDir(ctx) {
  if (ctx.env.OPENCLAW_STATE_DIR) return ctx.env.OPENCLAW_STATE_DIR
  const base = ctx.env.OPENCLAW_HOME || ctx.home
  const profile = (ctx.env.OPENCLAW_PROFILE || '').trim()
  return path.join(base, profile && profile !== 'default' ? `.openclaw-${profile}` : '.openclaw')
}
const envFile = (ctx) => path.join(stateDir(ctx), '.env')
const configFile = (ctx) => ctx.env.OPENCLAW_CONFIG_PATH || path.join(stateDir(ctx), 'openclaw.json')

function show(ctx, name) {
  const res = ctx.run('openclaw', ['mcp', 'show', name, '--json'], { timeoutMs: 30000 })
  if (res.status !== 0) return undefined
  try {
    return JSON.parse(res.stdout.slice(res.stdout.indexOf('{')))
  } catch {
    return undefined
  }
}

/**
 * The entry as written in the file. `openclaw mcp show` prints values with ${VAR} already
 * substituted (it would show the key), so compare and inspect the raw file when we can parse it;
 * OpenClaw itself writes plain JSON. Falls back to `show` for hand-written JSON5.
 */
function rawEntry(ctx, name) {
  const file = configFile(ctx)
  const text = readText(file)
  if (text === null) return { known: true, entry: undefined }
  try {
    return { known: true, entry: parseJsonc(text, file).mcp?.servers?.[name] }
  } catch {
    return { known: false, entry: show(ctx, name) }
  }
}

function must(res, what) {
  if (res.status === 0) return
  const msg = (res.stderr || res.stdout).trim().split('\n').filter(Boolean).pop() || `exit ${res.status}`
  if (/gateway/i.test(msg) && /running/i.test(msg)) {
    throw new Error(`${what}: ${msg}. Run \`openclaw gateway stop\`, run connect again, then \`openclaw gateway start\``)
  }
  throw new Error(`${what} failed: ${msg}`)
}

function gatewayUp(ctx) {
  return ctx.run('openclaw', ['gateway', 'health'], { timeoutMs: 20000 }).status === 0
}

export default {
  id: 'openclaw',
  name: 'OpenClaw',
  auth: 'oauth',
  supportsKey: true,

  detect(ctx) {
    if (ctx.which('openclaw')) return { installed: true, via: 'openclaw on PATH' }
    if (fs.existsSync(stateDir(ctx))) return { installed: true, via: stateDir(ctx), cliMissing: true }
    return { installed: false }
  },

  configLocation: configFile,

  status(ctx) {
    if (!ctx.which('openclaw')) throw new Error('the `openclaw` command is not on PATH, so its config cannot be read')
    const box = rawEntry(ctx, ctx.name).entry
    if (box && !ctx.ours(box.url)) return { entries: [], legacy: [], keyConfigured: false, foreign: { where: configFile(ctx), url: box.url || box.command } }
    const legacy = LEGACY_SERVER_NAMES.filter((n) => ctx.ours(rawEntry(ctx, n).entry?.url))
    const header = box?.headers?.Authorization || box?.headers?.authorization
    const usesKeyRef = typeof header === 'string' && header.includes(`\${${KEY_ENV}}`)
    const literal = typeof header === 'string' && /^Bearer\s+cb_/.test(header) ? header.replace(/^Bearer\s+/, '') : undefined
    const key = literal || (usesKeyRef ? readEnvValue(readText(envFile(ctx)), KEY_ENV) : undefined)
    const warnings = []
    if (box && box.transport !== 'streamable-http') warnings.push(`box uses transport ${box.transport || 'sse (the default)'}; box needs streamable-http`)
    if (usesKeyRef && !key) warnings.push(`box sends \${${KEY_ENV}}, but ${KEY_ENV} is not in ${envFile(ctx)}; OpenClaw would send the placeholder and get 401`)
    if (literal) warnings.push('the key is written into openclaw.json in plain text; re-run connect to move it to .env')
    return {
      entries: box ? [{ where: configFile(ctx), url: box.url, enabled: box.enabled !== false, mode: header ? 'key' : 'oauth' }] : [],
      legacy,
      key,
      keyConfigured: Boolean(key),
      warnings,
    }
  },

  connect(ctx, { mode = 'oauth', key } = {}) {
    if (!ctx.which('openclaw')) throw new Error('the `openclaw` command is not on PATH; install OpenClaw first')
    const current = rawEntry(ctx, ctx.name).entry
    if (current && !ctx.ours(current.url)) throw new ForeignServerError(configFile(ctx), ctx.name, current.url || current.command)
    const actions = []
    const backups = []
    const next = []
    let keyChanged = false
    if (mode === 'key') {
      const useKey = key || readEnvValue(readText(envFile(ctx)), KEY_ENV)
      if (!useKey) throw new Error('a personal key is needed')
      const r = updateFile(envFile(ctx), (text) => upsertEnvValue(text, KEY_ENV, useKey), { mode: 0o600, dryRun: ctx.dryRun, secret: true })
      if (r.changed) {
        keyChanged = true
        actions.push(`${ctx.dryRun ? 'would save' : 'saved'} the key as ${KEY_ENV} in ${envFile(ctx)} (no backup of that file is kept: it holds keys)`)
      }
      if (r.backup) backups.push(r.backup)
    }
    const entry =
      mode === 'key'
        ? { url: ctx.url, transport: 'streamable-http', headers: { Authorization: KEY_REF } }
        : { url: ctx.url, transport: 'streamable-http', auth: 'oauth' }
    let configChanged = false
    if (!sameValue(current, entry)) {
      if (!ctx.dryRun) must(ctx.run('openclaw', ['mcp', 'set', ctx.name, JSON.stringify(entry)], { timeoutMs: 60000 }), 'openclaw mcp set')
      configChanged = true
      actions.push(`${ctx.dryRun ? 'would set' : 'set'} mcp.servers.${ctx.name} (${mode === 'key' ? 'personal key from .env' : 'OAuth'}) via openclaw mcp set`)
    }
    for (const name of LEGACY_SERVER_NAMES) {
      if (ctx.ours(rawEntry(ctx, name).entry?.url)) {
        if (!ctx.dryRun) ctx.run('openclaw', ['mcp', 'unset', name])
        actions.push(`removed old server ${name}`)
      }
    }
    if (!ctx.dryRun && (configChanged || keyChanged)) {
      if (keyChanged && gatewayUp(ctx)) {
        // The Gateway reads .env only when it starts.
        const rr = ctx.run('openclaw', ['gateway', 'restart'], { timeoutMs: 120000 })
        if (rr.status === 0) actions.push('restarted the OpenClaw Gateway so it loads the key')
        else next.push('Run `openclaw gateway restart` so the Gateway loads the key.')
      } else if (configChanged) ctx.run('openclaw', ['mcp', 'reload'], { timeoutMs: 30000 })
      if (keyChanged && !gatewayUp(ctx)) next.push('The key is read when the Gateway starts: `openclaw gateway start` (or restart it if it runs elsewhere).')
    }
    if (mode === 'oauth') next.push(`Run \`openclaw mcp login ${ctx.name}\`, sign in in the browser and click Approve. On a server without a browser, use --auth key instead.`)
    return { actions, backups, next }
  },

  remove(ctx) {
    if (!ctx.which('openclaw')) throw new Error('the `openclaw` command is not on PATH')
    const actions = []
    const backups = []
    const warnings = []
    for (const name of [ctx.name, ...LEGACY_SERVER_NAMES]) {
      const entry = rawEntry(ctx, name).entry
      if (entry === undefined) continue
      if (!ctx.ours(entry.url)) {
        if (name === ctx.name) warnings.push(`left mcp.servers.${name}: it is not box by Simular`)
        continue
      }
      if (!ctx.dryRun) must(ctx.run('openclaw', ['mcp', 'unset', name]), 'openclaw mcp unset')
      actions.push(`${ctx.dryRun ? 'would remove' : 'removed'} mcp.servers.${name}`)
    }
    const e = updateFile(envFile(ctx), (text) => removeEnvValue(text, KEY_ENV), { dryRun: ctx.dryRun, mode: 0o600, secret: true })
    if (e.changed) actions.push(`${ctx.dryRun ? 'would remove' : 'removed'} ${KEY_ENV} from ${envFile(ctx)}`)
    if (e.backup) backups.push(e.backup)
    return { actions, backups, warnings, next: [] }
  },
}
