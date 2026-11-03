import { createRequire } from 'node:module'
import * as p from '@clack/prompts'
import { parseArgs } from './args.js'
import { createContext } from './context.js'
import { CLIENTS, findClient } from './clients/index.js'
import { DEFAULT_MCP_URL, KEY_ENV, KEYS_URL, WATCH_URL, INSTALL_URL, SUPPORT_EMAIL, EXAMPLE_PROMPTS, isOldUrl, looksLikeKey, validServerName } from './constants.js'
import { probeEndpoint, checkKey } from './probe.js'
import { OFFLOAD_HELP, boxContext, login, logout, rshCommand, offload, back } from './offload/commands.js'

const VERSION = createRequire(import.meta.url)('../package.json').version

const HELP = `simular-box ${VERSION}: connect box (a cloud computer for your AI agent) to your AI apps.

Usage:
  npx @simular-ai/box connect [--client <ids>] [--auth oauth|key] [--yes] [--dry-run]
  npx @simular-ai/box doctor  [--client <ids>] [--json]
  npx @simular-ai/box remove  [--client <ids>] [--yes] [--dry-run]

${OFFLOAD_HELP}

Clients: ${CLIENTS.map((c) => c.id).join(', ')}

Options:
  -c, --client <ids>  Comma-separated client ids (default: pick from the detected ones)
      --name <name>   Server name to use instead of "box" (when another "box" server exists)
      --auth key      Hermes and OpenClaw: use a personal key instead of OAuth (for
                      always-on servers with no browser). Other apps always use OAuth.
  -y, --yes           Don't ask; with no --client, use every detected client
      --dry-run       Show what would change without writing anything
      --json          doctor: machine-readable output

Sign-in: every app signs in with OAuth in the browser by default (no key). With --auth key, the key
comes from ${KEY_ENV} or a hidden prompt (create one at ${KEYS_URL}); it is never accepted as an
argument and never printed.
Set BOX_MCP_URL to use another box endpoint (default ${DEFAULT_MCP_URL}).
`

export async function main(argv, { env = process.env, stdout = process.stdout, isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY) } = {}) {
  // rsh is rsync's and git's remote shell: its words after the options are the remote command, so they are not parsed here.
  if (argv[0] === 'rsh') return rshCommand(boxContext(env), argv.slice(1))
  const args = parseArgs(argv)
  if (args.flags.version) {
    stdout.write(`${VERSION}\n`)
    return 0
  }
  if (args.flags.help || !args.command || args.command === 'help') {
    stdout.write(HELP)
    return args.command || args.flags.help ? 0 : 1
  }
  const ctx = createContext({ env, dryRun: Boolean(args.flags['dry-run']), serverName: args.flags.name ? validServerName(args.flags.name) : undefined })
  const interactive = isTTY && !args.flags.yes && !args.flags.json
  switch (args.command) {
    case 'connect':
    case 'add':
    case 'install':
      return connect(ctx, args.flags, { interactive, env, isTTY })
    case 'doctor':
    case 'status':
      return doctor(ctx, args.flags, { stdout })
    case 'remove':
    case 'uninstall':
      return remove(ctx, args.flags, { interactive })
    case 'login':
      return login(boxContext(env), args.flags, { stdout })
    case 'logout':
      return logout(boxContext(env), args.flags, { stdout })
    case 'offload':
      return offload(boxContext(env), args.flags, args.rest, { stdout })
    case 'back':
      return back(boxContext(env), args.flags, { stdout })
    default:
      throw new Error(`unknown command "${args.command}"; run with --help`)
  }
}

function selectedFromFlags(flags) {
  return (flags.client || []).map((id) => {
    const c = findClient(id)
    if (!c) throw new Error(`unknown client "${id}"; known: ${CLIENTS.map((x) => x.id).join(', ')}`)
    return c
  })
}

function detectAll(ctx) {
  return CLIENTS.map((client) => ({ client, detected: safe(() => client.detect(ctx), { installed: false }) }))
}

function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function cancelled(value) {
  if (p.isCancel(value)) {
    p.cancel('Nothing changed.')
    return true
  }
  return false
}

async function chooseClients(ctx, flags, { interactive, verb }) {
  const explicit = selectedFromFlags(flags)
  if (explicit.length) return explicit
  const found = detectAll(ctx).filter((d) => d.detected.installed)
  if (!found.length) {
    p.log.warn(`No supported AI apps found. Supported: ${CLIENTS.map((c) => c.name).join(', ')}.`)
    p.log.info(`Install one, or pick one anyway with --client <id>. Manual steps: ${INSTALL_URL}`)
    return []
  }
  if (!interactive) {
    if (!flags.yes) throw new Error(`no --client given; pass --client ${found.map((d) => d.client.id).join(',')} or --yes for all detected`)
    return found.map((d) => d.client)
  }
  const picked = await p.multiselect({
    message: `Which apps should ${verb} box? (space to toggle, enter to confirm)`,
    options: found.map(({ client, detected }) => ({
      value: client.id,
      label: client.name,
      hint: `${client.manual ? 'shows the steps' : client.supportsKey ? 'OAuth or personal key' : 'sign in in the browser'}${detected.cliMissing ? '; CLI not on PATH' : ''}`,
    })),
    initialValues: found.map((d) => d.client.id),
    required: true,
  })
  if (cancelled(picked)) return null
  return picked.map(findClient)
}

async function chooseModes(clients, flags, { interactive }) {
  const modes = {}
  for (const c of clients) modes[c.id] = c.auth === 'key' ? 'key' : 'oauth'
  const flexible = clients.filter((c) => c.supportsKey)
  if (!flexible.length) return modes
  if (flags.auth) {
    for (const c of flexible) modes[c.id] = flags.auth
    return modes
  }
  if (!interactive) return modes
  for (const c of flexible) {
    const choice = await p.select({
      message: `How should ${c.name} sign in to box?`,
      options: [
        { value: 'oauth', label: 'Sign in in the browser (OAuth)', hint: 'desktop with a browser' },
        { value: 'key', label: 'Personal key (cb_...)', hint: 'always-on server; OAuth sign-ins expire and need a person' },
      ],
      initialValue: 'oauth',
    })
    if (cancelled(choice)) return null
    modes[c.id] = choice
  }
  return modes
}

async function getKey(ctx, clients, { interactive, env }) {
  const fromEnv = (env[KEY_ENV] || '').trim()
  if (fromEnv) {
    if (!looksLikeKey(fromEnv)) throw new Error(`${KEY_ENV} is set but does not look like a box personal key (cb_...)`)
    return fromEnv
  }
  // Re-runs keep the key a client already has.
  const missing = clients.filter((c) => !safe(() => c.status(ctx), {}).keyConfigured)
  if (!missing.length) return null
  if (!interactive) {
    throw new Error(`${missing.map((c) => c.name).join(', ')} sign in with a personal key. Create one at ${KEYS_URL} and run again with ${KEY_ENV}=cb_... in the environment`)
  }
  p.log.info(`${missing.map((c) => c.name).join(', ')} can't sign in in the browser, so ${missing.length > 1 ? 'they use' : 'it uses'} a personal key.\nCreate one at ${KEYS_URL} (Create key under Personal keys; it is shown once).`)
  const key = await p.password({
    message: 'Paste the key (cb_...)',
    mask: '*',
    validate: (v) => (looksLikeKey(v) ? undefined : 'A box personal key starts with cb_'),
  })
  if (cancelled(key)) return undefined
  return key.trim()
}

async function connect(ctx, flags, { interactive, env, isTTY }) {
  p.intro(`box ${ctx.dryRun ? '(dry run) ' : ''}-> ${ctx.url}`)
  const clients = await chooseClients(ctx, flags, { interactive, verb: 'use' })
  if (!clients?.length) return clients === null ? 1 : 0
  const modes = await chooseModes(clients, flags, { interactive })
  if (!modes) return 1
  const keyClients = clients.filter((c) => modes[c.id] === 'key')
  let key = null
  if (keyClients.length) {
    key = await getKey(ctx, keyClients, { interactive, env })
    if (key === undefined) return 1
  }
  let failed = 0
  let connected = 0
  const next = []
  for (const client of clients) {
    // The spinner draws with escape codes; in logs and CI print plain lines instead.
    const spin = isTTY ? p.spinner() : { start() {}, stop: (msg, code) => (code ? p.log.error(msg) : p.log.success(msg)) }
    spin.start(`${client.name}`)
    try {
      const moved = movedFrom(ctx, client)
      const res = await client.connect(ctx, { key, mode: modes[client.id] })
      spin.stop(`${client.name}: ${res.actions.length ? res.actions.join('; ') : 'already set up'}`)
      for (const b of res.backups || []) p.log.message(`  backup: ${b}`)
      for (const w of res.warnings || []) p.log.warn(`  ${w}`)
      if (moved.length && res.actions.length && !ctx.dryRun) {
        p.log.warn(`  box moved from ${moved.join(', ')} to ${ctx.url}. ${client.name} may ask you to sign in to box again.`)
      }
      for (const n of res.next || []) next.push(`${client.name}: ${n}`)
      connected++
    } catch (err) {
      failed++
      spin.stop(`${client.name}: failed`, 1)
      p.log.error(`  ${err.message}`)
      if (isPermissionError(err)) {
        const where = safe(() => client.configLocation(ctx), 'its config')
        p.log.warn(`  box could not change ${where}: the file or its folder may belong to another user (for example after a run with sudo), or the app may hold it open. Check the owner of both, or quit the app, then run again.`)
        for (const n of client.permissionHelp?.(ctx) || []) next.push(`${client.name}: ${n}`)
      }
    }
  }
  if (next.length) p.note(next.join('\n'), 'Next')
  if (connected && !ctx.dryRun) {
    p.note([`After signing in (or setting your key), start a new chat (or restart the app) so box's tools load. Then try:`, ...EXAMPLE_PROMPTS.map((e) => `  ${e}`)].join('\n'), 'Try box')
  }
  p.outro(`Watch your box live: ${WATCH_URL}  |  Keys and connected apps: ${KEYS_URL}  |  Check: npx @simular-ai/box doctor`)
  return failed ? 1 : 0
}

/** The old box addresses a client points at before connect rewrites them. */
function movedFrom(ctx, client) {
  const st = safe(() => client.status(ctx), null)
  return [...new Set((st?.entries || []).map((e) => e.url).filter((u) => u && isOldUrl(u, ctx.url)))]
}

/** EACCES/EPERM, or EBUSY (Windows: the app holds the file open), including as text ("Access is denied"). */
export function isPermissionError(err) {
  return ['EACCES', 'EPERM', 'EBUSY'].includes(err?.code) || /\bEACCES\b|\bEPERM\b|\bEBUSY\b|permission denied|access is denied|operation not permitted/i.test(err?.message || '')
}

async function remove(ctx, flags, { interactive }) {
  p.intro(`Remove box ${ctx.dryRun ? '(dry run)' : ''}`)
  let clients = selectedFromFlags(flags)
  if (!clients.length) {
    const configured = detectAll(ctx)
      .filter((d) => d.detected.installed)
      .map((d) => d.client)
      .filter((c) => {
        const s = safe(() => c.status(ctx), null)
        return s && (s.entries.length || s.legacy.length || s.keyConfigured)
      })
    if (!configured.length) {
      p.outro('box is not set up in any detected app.')
      return 0
    }
    if (interactive) {
      const picked = await p.multiselect({
        message: 'Remove box from which apps?',
        options: configured.map((c) => ({ value: c.id, label: c.name })),
        initialValues: configured.map((c) => c.id),
        required: true,
      })
      if (cancelled(picked)) return 1
      clients = picked.map(findClient)
    } else if (flags.yes) clients = configured
    else throw new Error(`no --client given; pass --client ${configured.map((c) => c.id).join(',')} or --yes`)
  }
  let failed = 0
  for (const client of clients) {
    try {
      const res = await client.remove(ctx)
      p.log.success(`${client.name}: ${res.actions.length ? res.actions.join('; ') : 'nothing to remove'}`)
      for (const b of res.backups || []) p.log.message(`  backup: ${b}`)
      for (const w of res.warnings || []) p.log.warn(`  ${w}`)
      for (const n of res.next || []) p.log.info(`  ${n}`)
    } catch (err) {
      failed++
      p.log.error(`${client.name}: ${err.message}`)
    }
  }
  p.outro(`To revoke a key or a signed-in app, open ${KEYS_URL}.`)
  return failed ? 1 : 0
}

export async function runDoctor(ctx, flags, { probe = probeEndpoint, check = checkKey } = {}) {
  const report = { url: ctx.url, defaultUrl: DEFAULT_MCP_URL, endpoint: null, clients: [] }
  report.endpoint = await probe(ctx.url)
  const explicit = selectedFromFlags(flags)
  const rows = explicit.length ? explicit.map((client) => ({ client, detected: safe(() => client.detect(ctx), { installed: false }) })) : detectAll(ctx).filter((d) => d.detected.installed)
  for (const { client, detected } of rows) {
    const row = { id: client.id, name: client.name, auth: client.auth, installed: detected.installed, configured: false, entries: [], problems: [], fixes: [] }
    report.clients.push(row)
    let st
    try {
      st = client.status(ctx)
    } catch (err) {
      row.problems.push(`cannot read config: ${err.message}`)
      row.fixes.push(`fix or move aside ${client.configLocation(ctx)}, then: npx @simular-ai/box connect --client ${client.id}`)
      continue
    }
    if (st.manual) {
      row.manual = true
      row.problems = []
      row.fixes = []
      row.notes = [`can't be checked from here: add or check the box connector in ${client.configLocation(ctx)} (URL ${ctx.url})`]
      row.ok = true
      continue
    }
    if (st.foreign) {
      row.problems.push(`a server named "${ctx.name}" in ${st.foreign.where} points at ${st.foreign.url}, which is not box by Simular`)
      row.fixes.push(`npx @simular-ai/box connect --client ${client.id} --name simular-box`)
    }
    row.entries = st.entries.map(({ where, url, enabled }) => ({ where, url: url || null, enabled: enabled !== false }))
    row.configured = st.entries.length > 0
    const keyMode = st.entries.some((e) => e.mode === 'key')
    const nameFlag = ctx.name !== 'box' ? ` --name ${ctx.name}` : ''
    const fix = `npx @simular-ai/box connect --client ${client.id}${nameFlag}${keyMode ? ' --auth key' : ''}`
    if (!row.configured && !st.foreign) {
      row.problems.push('box is not configured')
      row.fixes.push(fix)
    }
    for (const e of st.entries) {
      if (e.url && isOldUrl(e.url, ctx.url)) {
        row.problems.push(`${e.where} points at ${e.url}, box's old address, which no longer signs in; box is now at ${ctx.url}`)
        row.fixes.push(fix)
      } else if (e.url && e.url !== ctx.url) {
        row.problems.push(`${e.where} points at ${e.url}, not ${ctx.url}`)
        row.fixes.push(fix)
      }
      if (e.enabled === false) {
        row.problems.push(`${e.where} is disabled`)
        row.fixes.push(fix)
      }
    }
    if (st.entries.length > 1) row.problems.push(`box is configured ${st.entries.length} times; the app may show it twice`)
    if (st.legacy.length) {
      row.problems.push(`old server ${st.legacy.join(', ')} is still configured`)
      row.fixes.push(fix)
    }
    for (const w of st.warnings || []) row.problems.push(w)
    for (const f of st.fixes || []) row.fixes.push(f)
    if (keyMode || client.auth === 'key' || st.key) {
      if (!st.key) {
        row.key = { configured: false }
        if (row.configured) {
          row.problems.push('no personal key is configured')
          row.fixes.push(`create a key at ${KEYS_URL}, then: ${KEY_ENV}=cb_... npx @simular-ai/box connect --client ${client.id} --auth key`)
        }
      } else if (report.endpoint.ok || report.endpoint.status) {
        const r = await check(ctx.url, st.key)
        row.key = { configured: true, valid: r.valid, status: r.status }
        if (r.valid === false) {
          row.problems.push(`the configured key was rejected (${r.error})`)
          row.fixes.push(`create a new key at ${KEYS_URL}, then: ${KEY_ENV}=cb_... npx @simular-ai/box connect --client ${client.id} --auth key`)
        } else if (r.valid === null) row.problems.push(`could not check the key: ${r.error}`)
      } else row.key = { configured: true, valid: null }
    }
    row.fixes = [...new Set(row.fixes)]
    row.ok = row.problems.length === 0
  }
  report.ok = report.endpoint.ok && report.clients.every((c) => c.ok)
  return report
}

async function doctor(ctx, flags, { stdout }) {
  const report = await runDoctor(ctx, flags)
  if (flags.json) {
    stdout.write(JSON.stringify(report, null, 2) + '\n')
    return report.ok ? 0 : 1
  }
  p.intro('box doctor')
  if (ctx.url !== DEFAULT_MCP_URL) p.log.info(`BOX_MCP_URL is set: checking ${ctx.url}`)
  const ep = report.endpoint
  if (ep.ok) p.log.success(`Endpoint ${ep.url} is up (401 + sign-in metadata, authorization server ${ep.authorizationServer})`)
  else p.log.error(`Endpoint: ${ep.error}. Check your network or proxy; status: https://box.simular.ai`)
  if (!report.clients.length) p.log.warn('No supported AI apps found.')
  for (const c of report.clients) {
    const lines = []
    for (const e of c.entries) lines.push(`${e.where} -> ${e.url || '(url unknown)'}`)
    if (c.key) lines.push(`personal key: ${c.key.configured ? (c.key.valid === true ? 'valid' : c.key.valid === false ? 'rejected' : 'not checked') : 'none'}`)
    for (const pr of c.problems) lines.push(`problem: ${pr}`)
    for (const f of c.fixes) lines.push(`fix: ${f}`)
    for (const n of c.notes || []) lines.push(n)
    const how = c.manual ? 'connector in the app' : c.key ? 'personal key' : 'OAuth'
    const msg = `${c.name} (${how})\n${lines.map((l) => `  ${l}`).join('\n')}`
    if (c.ok) p.log.success(msg)
    else p.log.warn(msg)
  }
  if (report.clients.some((c) => !c.manual && !c.key)) p.log.info('OAuth sign-ins are kept by each app, so doctor cannot see them: if box asks you to sign in, do it in that app.')
  p.outro(report.ok ? 'All good.' : `Something needs fixing (above). Help: ${SUPPORT_EMAIL}`)
  return report.ok ? 0 : 1
}
