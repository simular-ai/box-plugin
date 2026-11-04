import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from '../box/browser.js'
import { BoxConnection, describe } from '../box/connection.js'
import { boxHome, endpointUrl } from '../box/endpoint.js'
import { browserLogin, revoke } from '../box/login.js'
import { attach, rsh, wake } from '../box/rsh.js'
import { TokenStore, TOKEN_ENV } from '../box/token-store.js'
import { GitRepo, OffloadError, landingSummary } from './git.js'
import { HANDOVER_TEMPLATE, currentKind, findSignInLink, kind as kindOf, loginCommand, tmuxSession } from './model.js'
import { Offloader } from './offloader.js'
import { quote } from './run.js'
import { OffloadStore } from './store.js'

// The box-side commands of the CLI: login/logout, rsh, offload, back, and the box CLI's install and sign-in. They follow
// upstream cocoonbox's CLI (macos/Sources/CocoonBoxCLI/main.swift) and its app's "Install in box" / "Sign in in the box".

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'simular-box.js')
export const CMD = 'npx @simular-ai/box'

export const OFFLOAD_HELP = `Offload (move a coding task into your box and back):
  login [--token -]                     sign this CLI in to box in the browser (a device token, revocable
                                        under Keys -> Devices); --token - reads a personal key (cb_...)
                                        from stdin or a hidden prompt. Kept in ~/.simular-box (0600)
  logout                                forget the token, and revoke it when login made it
  rsh [--box NAME|ID] [-t] [HOST] COMMAND...
                                        run COMMAND in a box with this stdin/stdout/stderr (rsync's and
                                        git's remote shell); exits with its code, or 255
  offload [--box B] [--kind claude|codex|cursor] [--dir PATH] [--handover FILE] [--yes] [--json]
                                        move this repo's task into a box: preflight, copy, and a fresh box
                                        CLI session that starts from the hand-over
  offload handover-path                 print where to write the hand-over
  offload --handover-prompt [--kind K]  print the request to paste into Codex or another CLI
  offload inbox [--wait S] [--all] [--json]   what the box agent posted since the last look
  offload status [--all] [--json]       the box CLI session of this repo, or of every repo
  offload send [--interrupt] [TEXT...]  give the box agent a message (TEXT, else stdin)
  offload secrets [add|remove ENTRY]    this repo's opted-in secrets: file:PATH, aws, kube, gcloud, ssh:KEY
  offload install-cli [--box B] [--kind K]   install the box CLI with the vendor's official installer
  offload sign-in [--box B] [--kind K]  run the box CLI's own login in the box on this terminal; its
                                        sign-in link opens in this computer's browser
  back [--interrupt] [--json]           bring the task back: the box agent's hand-over and its commits,
                                        merged against the offload's snapshot; it first waits for the box
                                        agent to go idle (--interrupt stops its current step instead)

offload and back exit 0 when done, 1 on a failure (nothing changed here), 3 when the preflight blocks,
and 4 when it warns and --yes was not given: ask the user, then run again with --yes.`

/** Box is the CLI's context for box calls: endpoint, token store and offload store. */
export function boxContext(env = process.env) {
  const home = boxHome(env)
  return {
    env,
    home,
    tokens: new TokenStore(home, env),
    store: new OffloadStore(home),
    endpoint: (override) => (override ? endpointUrl({ BOX_ENDPOINT: override }) : endpointUrl(env)),
  }
}

export function connect(ctx, override) {
  const endpoint = ctx.endpoint(override)
  const saved = ctx.tokens.get(endpoint)
  if (!saved) throw new Error(`not signed in to ${endpoint}; run: ${CMD} login`)
  return new BoxConnection(endpoint, saved.token)
}

// ---------- login ----------

export async function login(ctx, flags, { stdin = process.stdin, stderr = process.stderr, stdout = process.stdout } = {}) {
  const endpoint = ctx.endpoint(flags.endpoint)
  let token
  let source
  if (flags.token !== undefined) {
    if (flags.token !== '-') throw new Error('--token takes -: paste the token on stdin or at the prompt, never as an argument')
    token = await readSecret(stdin, stderr, 'box personal key (cb_...): ')
    source = 'paste'
  } else {
    token = await browserLogin(endpoint, {
      open: (url) => {
        stderr.write(`box: allow this computer in the browser; if no page opened, open\n  ${url}\n`)
        openBrowser(url, { env: ctx.env })
      },
    })
    source = 'browser'
  }
  if (!token) throw new Error('no token given')
  const connection = new BoxConnection(endpoint, token)
  try {
    await connection.listBoxes()
  } catch (err) {
    if (source === 'browser') await revoke(endpoint, token).catch(() => {})
    throw new Error(describe(err))
  } finally {
    connection.close()
  }
  const previous = ctx.tokens.saved(endpoint)
  ctx.tokens.set(endpoint, token, source)
  // A replaced device token would otherwise stay live with nothing holding it.
  if (previous?.source === 'browser' && previous.token !== token) await revoke(endpoint, previous.token).catch(() => {})
  if ((ctx.env[TOKEN_ENV] || '').trim()) stderr.write(`box: note: ${TOKEN_ENV} is set and wins over the saved token\n`)
  stdout.write(`signed in to ${endpoint}\n`)
  return 0
}

export async function logout(ctx, flags, { stdout = process.stdout } = {}) {
  const endpoint = ctx.endpoint(flags.endpoint)
  const saved = ctx.tokens.saved(endpoint)
  let note = ''
  if (saved?.source === 'browser') {
    try {
      await revoke(endpoint, saved.token)
    } catch (err) {
      note = ` (the server did not revoke the device token: ${err.message}; revoke it under Keys -> Devices at https://box.simular.ai/keys)`
    }
  }
  ctx.tokens.remove(endpoint)
  stdout.write(`signed out${note}\n`)
  return note ? 1 : 0
}

async function readSecret(stdin, stderr, prompt) {
  if (!stdin.isTTY) {
    let data = ''
    for await (const chunk of stdin) data += chunk
    return data.split('\n')[0].trim()
  }
  stderr.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish(null, value.trim())
        if (ch === '\u0003') return finish(new Error('cancelled'))
        if (ch === '\u007f') value = value.slice(0, -1)
        else value += ch
      }
    }
    const finish = (err, v) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stderr.write('\n')
      if (err) reject(err)
      else resolve(v)
    }
    stdin.on('data', onData)
  })
}

// ---------- rsh ----------

export function rshCommand(ctx, argv) {
  return rsh(argv, { connect: (override) => connect(ctx, override), env: ctx.env })
}

// ---------- offload ----------

/** offloadKey is the repo key of --dir or the working directory; for an offload in flight it falls back to the record of the same top level. */
function offloadKey(ctx, flags, { inFlight = false } = {}) {
  const dir = path.resolve(flags.dir || process.cwd())
  const repo = GitRepo.open(dir, ctx.env)
  if (!repo) throw new OffloadError('failed', `${dir} is not in a git repository`)
  if (!inFlight || ctx.store.record(repo.key)) return repo.key
  return ctx.store.records().filter((r) => r.top === repo.top).pop()?.repo || repo.key
}

async function runningBox(connection, ref) {
  const boxes = await connection.listBoxes()
  const box = ref ? boxes.find((b) => b.id === ref || b.name === ref) : boxes[0]
  if (!box) throw new Error(ref ? `no box named ${ref}` : 'no box yet; create one at https://box.simular.ai')
  return wake(connection, box)
}

function offloader(ctx, connection, box, stderr) {
  const rsh = [process.execPath, BIN].map(quote).join(' ') + ` rsh --box ${quote(box.id)}`
  return new Offloader({ connection, box, store: ctx.store, rsh, env: ctx.env, progress: (l) => stderr.write(`${l}\n`) })
}

function printFindings(findings, out) {
  for (const f of findings) out.write(`${f.outcome.padEnd(8)}${f.check}: ${f.detail}\n`)
}

const json = (out, obj) => out.write(JSON.stringify(obj, null, 2) + '\n')

export function offloadFailed(err, flags, { stdout, stderr }) {
  const code = err.kind === 'refused' ? 3 : err.kind === 'needsYes' ? 4 : 1
  if (flags.json) {
    json(stdout, { ok: false, code: code === 3 ? 'refused' : code === 4 ? 'confirm' : 'failed', error: err.message, findings: err.findings })
  } else {
    printFindings(err.findings, stdout)
    if (err.findings.some((f) => f.outcome === 'block' && f.check.includes('cli'))) {
      const k = `--kind ${flags.kind || currentKind(process.env) || '<claude|codex|cursor>'}${flags.box ? ` --box ${flags.box}` : ''}`
      stdout.write(`Install or sign in the box CLI from your own terminal: ${CMD} offload install-cli ${k} (when it is missing), then ${CMD} offload sign-in ${k}\n`)
    }
    stderr.write(`box: ${err.message}${code === 1 ? '; nothing changed on this computer' : ''}\n`)
  }
  return code
}

export function handoverPrompt(handoverPath, kindName) {
  const k = kindOf(kindName)
  return `OFFLOAD: move this task into my box, where a fresh ${k.title} session continues it while I am away. It knows only what your hand-over says, plus the repo.
1. Finish the step you are in, or stop at a safe point. Do not start new work.
2. Write a hand-over of this session to ${handoverPath} with the template below. Fill every section; write "none" for an empty one. Be concrete: exact commands, versions, paths, errors, decisions with their reasons. Names only for secrets, never values. The file is outside this repo: if your sandbox refuses the write, ask me to approve it.
3. Run in this repo: ${CMD} offload --kind ${kindName}
   It needs the network: if your sandbox refuses, ask me to approve it. Exit 3 is a block: tell me why, one line per finding. Exit 4 is warnings: tell me each one and run again with --yes only if I agree. Exit 1: tell me its last line.
4. When it prints "offloaded", tell me the box, end your turn and change nothing more in this repo. \`${CMD} back\` in this repo brings the work back.

${HANDOVER_TEMPLATE}`
}

export async function offload(ctx, flags, rest, io = {}) {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  const sub = ['handover-path', 'inbox', 'status', 'send', 'secrets', 'install-cli', 'sign-in'].includes(rest[0]) ? rest[0] : null
  const words = sub ? rest.slice(1) : rest
  try {
    if (sub === 'handover-path') {
      stdout.write(ctx.store.handover(offloadKey(ctx, flags)) + '\n')
      return 0
    }
    if (sub === 'secrets') return secretsCommand(ctx, flags, words, stdout)
    const kindName = flags.kind || currentKind(ctx.env)
    if (flags.kind) kindOf(flags.kind)
    if (flags['handover-prompt']) {
      stdout.write(handoverPrompt(ctx.store.handover(offloadKey(ctx, flags)), kindName || 'codex') + '\n')
      return 0
    }
    if (sub === 'install-cli' || sub === 'sign-in') return boxCli(ctx, flags, sub, kindName, { stdout, stderr })
    const connection = connect(ctx, flags.endpoint)
    try {
      if (sub) return await inboxCommand(ctx, flags, sub, words, connection, { stdout, stderr })
      if (!kindName) throw new OffloadError('failed', 'name the box CLI with --kind claude, codex or cursor')
      const key = offloadKey(ctx, flags)
      const file = flags.handover ? path.resolve(flags.handover) : ctx.store.handover(key)
      let handover
      try {
        handover = fs.readFileSync(file, 'utf8')
      } catch {
        throw new OffloadError('failed', `no hand-over at ${file}; write it there first (${CMD} offload handover-path)`)
      }
      const box = await runningBox(connection, flags.box)
      const outcome = await offloader(ctx, connection, box, stderr).offload({ directory: path.resolve(flags.dir || process.cwd()), kind: kindName, handover, yes: Boolean(flags.yes) })
      const r = outcome.record
      if (flags.json) {
        json(stdout, {
          ok: true, box: box.name, box_id: box.id, dir: r.dir, tmux: tmuxSession(r), offload_id: r.id, repo: r.repo, accepted: outcome.accepted,
          sent_bytes: outcome.sent, findings: outcome.findings, timings_ms: Object.fromEntries(outcome.timings),
        })
        return 0
      }
      printFindings(outcome.findings, stdout)
      stdout.write(`offloaded to ${box.name}: ${outcome.cli}\n`)
      stdout.write(`  copy ${r.dir}, tmux ${tmuxSession(r)}, offload ${r.id}\n`)
      stdout.write(`  sent ${(outcome.sent / 1e6).toFixed(1)} MB; ${outcome.timings.map(([s, ms]) => `${s} ${(ms / 1000).toFixed(1)} s`).join(', ')}\n`)
      if (!outcome.accepted) stdout.write(`  the box CLI has not taken the hand-over yet; watch it with \`${CMD} offload status\`\n`)
      stdout.write(`  watch its terminal: ${CMD} rsh -t --box ${box.name} tmux attach -t ${tmuxSession(r)}\n`)
      stdout.write(`Bring it back with /box:back or \`${CMD} back\`.\n`)
      return 0
    } finally {
      connection.close()
    }
  } catch (err) {
    if (err instanceof OffloadError) return offloadFailed(err, flags, { stdout, stderr })
    throw new Error(describe(err))
  }
}

async function inboxCommand(ctx, flags, sub, words, connection, { stdout }) {
  const all = Boolean(flags.all)
  const key = all && sub === 'status' ? null : offloadKey(ctx, flags, { inFlight: true })
  const record = key ? ctx.store.record(key) : null
  const box = await runningBox(connection, flags.box || record?.box)
  const packer = offloader(ctx, connection, box, process.stderr)
  if (sub === 'status') {
    const sessions = await packer.status(key)
    if (flags.json) return json(stdout, { sessions: sessions.map((s) => ({ repo: s.repo, name: s.name, cli: s.cli, offload_id: s.offload_id, status: s.status, hooks_silent: Boolean(s.hooks_silent) })) }), 0
    if (!sessions.length) stdout.write('no box CLI session\n')
    for (const s of sessions) {
      stdout.write(`${s.name} ${s.cli} ${s.status} offload ${s.offload_id} (repo ${s.repo})${s.hooks_silent ? '; its hooks do not run, so the status comes from its transcript' : ''}\n`)
    }
    return 0
  }
  if (sub === 'send') {
    let text = words.join(' ')
    if (!text) for await (const chunk of process.stdin) text += chunk
    if (!text.trim()) throw new OffloadError('failed', 'no message')
    const delivery = await packer.send(key, text, Boolean(flags.interrupt))
    if (flags.json) json(stdout, { delivery })
    else stdout.write(`sent to the box agent: ${delivery}\n`)
    return 0
  }
  // inbox
  const since = all ? 0 : record?.seen || 0
  const wait = flags.wait ? Number(flags.wait) : undefined
  let { entries, status } = await packer.read(key, since, wait)
  let newest = entries.length ? entries[entries.length - 1].seq : since
  if (!all && record) {
    const current = (e) => e.offload_id === record.id || !e.offload_id
    if (entries.length && !entries.some(current)) {
      ;({ entries, status } = await packer.read(key, newest, wait))
      newest = entries.length ? entries[entries.length - 1].seq : newest
    }
    entries = entries.filter(current)
  }
  if (record && newest > (record.seen || 0)) ctx.store.save({ ...record, seen: newest })
  if (flags.json) return json(stdout, { status, entries }), 0
  if (!entries.length) stdout.write(`nothing new from the box agent (${status || 'no session'})\n`)
  for (const e of entries) stdout.write(`#${e.seq} ${e.kind} at ${new Date(e.time_ms).toLocaleTimeString()}\n${e.body}\n\n`)
  return 0
}

function secretsCommand(ctx, flags, words, stdout) {
  const key = offloadKey(ctx, flags)
  let entries = ctx.store.secrets(key)
  if (words.length) {
    const [action, entry] = words
    if (!['add', 'remove'].includes(action) || words.length !== 2) throw new OffloadError('failed', `usage: ${CMD} offload secrets [add|remove ENTRY]`)
    const rel = entry.startsWith('file:') || entry.startsWith('ssh:') ? entry.slice(entry.indexOf(':') + 1) : null
    if (rel !== null && (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..'))) {
      throw new OffloadError('failed', `${entry}: name a path inside the repo (file:) or a key in ~/.ssh (ssh:), without ..`)
    }
    if (!(entry.startsWith('file:') || entry.startsWith('ssh:') || ['aws', 'kube', 'gcloud'].includes(entry))) {
      throw new OffloadError('failed', 'an entry is file:PATH, aws, kube, gcloud or ssh:KEY')
    }
    entries = entries.filter((e) => e !== entry)
    if (action === 'add') entries.push(entry)
    ctx.store.setSecrets(key, entries)
  }
  stdout.write((entries.length ? entries.join('\n') : 'no secrets opted in') + '\n')
  return 0
}

export async function back(ctx, flags, io = {}) {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  try {
    const key = offloadKey(ctx, flags, { inFlight: true })
    const record = ctx.store.record(key)
    if (!record) {
      const last = path.join(ctx.store.root, key, 'back.md')
      const st = fs.existsSync(last) ? fs.statSync(last) : null
      throw new OffloadError('failed', 'nothing of this repo is in a box' + (st ? `; the hand-over brought back at ${st.mtime.toLocaleString()} is in ${last}` : ''))
    }
    const connection = connect(ctx, flags.endpoint)
    try {
      const box = await runningBox(connection, record.box)
      const outcome = await offloader(ctx, connection, box, stderr).back(key, {
        interrupt: Boolean(flags.interrupt),
        onEntry: (e) => stderr.write(`box agent ${e.kind} #${e.seq}${e.kind === 'question' ? ':\n' + e.body : ''}\n`),
      })
      const landing = outcome.landing ? landingSummary(outcome.landing) : 'no repo'
      if (flags.json) return json(stdout, { ok: true, landing, handover: outcome.handover, file: outcome.file, offload_id: record.id }), 0
      stdout.write(`${landing}\nThe box agent's hand-over (also in ${outcome.file}):\n\n${outcome.handover}\n`)
      return 0
    } finally {
      connection.close()
    }
  } catch (err) {
    if (err instanceof OffloadError) return offloadFailed(err, flags, { stdout, stderr })
    throw new Error(describe(err))
  }
}

// ---------- the box CLI: install and sign in ----------

async function boxCli(ctx, flags, sub, kindName, { stdout, stderr }) {
  if (!kindName) throw new OffloadError('failed', 'name the box CLI with --kind claude, codex or cursor')
  const k = kindOf(kindName)
  const connection = connect(ctx, flags.endpoint)
  try {
    const box = await runningBox(connection, flags.box)
    if (sub === 'install-cli') {
      // The vendor's official installer, as the box's desktop user into its home, so it stays across saves and upgrades.
      stderr.write(`box: installing ${k.title} in ${box.name}: ${k.install}\n`)
      const code = await attach(connection, box.id, { command: k.install }, { stdin: null })
      if (code !== 0) {
        stderr.write(`box: the installer failed (exit ${code})\n`)
        return 1
      }
      stdout.write(`installed ${k.title} in ${box.name}; next: ${CMD} offload sign-in --kind ${kindName}${flags.box ? ` --box ${flags.box}` : ''}\n`)
      return 0
    }
    if (!process.stdin.isTTY) throw new OffloadError('failed', 'sign-in needs a terminal: the CLI asks you to paste a code')
    // The CLI's own login on a terminal in the box. Its first https link on the vendor's own hosts opens here, once; the
    // box is untrusted, so no other link from its output is opened. The login stays in the box.
    stderr.write(`box: signing ${k.title} in inside ${box.name}. Approve in the browser, then paste the code here.\n`)
    let seen = ''
    let opened = false
    const tap = (data) => {
      if (opened) return
      seen = (seen + data.toString('utf8')).slice(-(64 << 10))
      const link = findSignInLink(seen, kindName)
      if (!link) return
      opened = true
      openBrowser(link, { env: ctx.env })
      stderr.write(`\r\nbox: opened the sign-in page in your browser (${new URL(link).hostname})\r\n`)
    }
    const term = ctx.env.TERM || ''
    const code = await attach(
      connection,
      box.id,
      { command: loginCommand(kindName), tty: { term, window: { rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 } } },
      { tty: true, tap },
    )
    stdout.write(code === 0 ? `\nsigned ${k.title} in inside ${box.name}\n` : `\nthe sign-in ended with exit ${code}\n`)
    return code === 0 ? 0 : 1
  } finally {
    connection.close()
  }
}

