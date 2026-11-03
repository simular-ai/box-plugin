import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeBox, TOKEN } from './fakebox/fake-box.js'
import { HANDOVER_TEMPLATE } from '../src/offload/model.js'

// Offload and back end to end against a fake box: the CLI's real gRPC Exec, rsh as rsync's and git's remote shell, the
// tar stream with the bundle, and the merge at back. Needs bash, git and rsync (macOS and Linux CI have them).

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'simular-box.js')
const skip = process.platform === 'win32' || !hasRsync() ? 'needs bash, git and rsync' : false

function hasRsync() {
  try {
    execFileSync('rsync', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let tmp, box, env
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENT } }).trim()
const IDENT = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }

function cli(args, { cwd, input, extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...env, ...extraEnv } })
    const out = []
    const err = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), text: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }))
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

function handover(goal) {
  return HANDOVER_TEMPLATE.replace('<one-line goal>', goal)
}

/** playBoxAgent commits change in the copy, makes S' as the box packer's `post --back` does, and posts back. */
function playBoxAgent({ dir, offload_id: id, repo: key }, change) {
  for (const [file, text] of Object.entries(change)) fs.writeFileSync(path.join(dir, file), text)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'box work')
  const tree = git(dir, 'rev-parse', 'HEAD^{tree}')
  const snap = git(dir, 'commit-tree', tree, '-p', 'HEAD', '-m', 'back')
  git(dir, 'update-ref', `refs/cocoonbox/back/${id}`, snap)
  const outbox = path.join(tmp, 'state', `${key}.outbox.json`)
  const entries = fs.existsSync(outbox) ? JSON.parse(fs.readFileSync(outbox, 'utf8')) : []
  entries.push({ seq: entries.length + 1, kind: 'back', offload_id: id, cli: 'claude', time_ms: Date.now(), body: handover('done in the box') })
  fs.writeFileSync(outbox, JSON.stringify(entries))
}

function makeRepo(name) {
  const repo = path.join(tmp, name)
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  fs.writeFileSync(path.join(repo, 'b.txt'), 'bee\n')
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n.env\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'init')
  return repo
}

before(async () => {
  if (skip) return
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'box-offload-e2e-')))
  for (const d of ['workspace', 'state', 'home']) fs.mkdirSync(path.join(tmp, d))
  box = await startFakeBox({ workspace: path.join(tmp, 'workspace'), state: path.join(tmp, 'state'), env: IDENT })
  env = { PATH: process.env.PATH, HOME: path.join(tmp, 'home'), BOX_HOME: path.join(tmp, 'home', '.simular-box'), BOX_ENDPOINT: box.endpoint, BOX_TOKEN: TOKEN, ...IDENT }
})

after(async () => {
  if (skip) return
  await box.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('rsh passes bytes, exit codes and stderr, and drops rsync host words', { skip, timeout: 60000 }, async () => {
  const data = crypto.randomBytes(300 << 10)
  const cat = await cli(['rsh', '--box', 'main', 'box', 'cat'], { input: data })
  assert.equal(cat.code, 0)
  assert.ok(cat.stdout.equals(data), 'cat returns the bytes unchanged')
  const exit = await cli(['rsh', 'main', 'echo out; echo err >&2; exit 42'])
  assert.equal(exit.code, 42)
  assert.equal(exit.text, 'out\n')
  assert.match(exit.stderr, /err/)
  const none = await cli(['rsh', '--box', 'main'])
  assert.equal(none.code, 255)
  // a closed local reader ends rsh quietly with 255 (no stack trace), and the box command is cancelled
  const pipe = await new Promise((resolve) => {
    const child = spawn('bash', ['-c', `"${process.execPath}" "${BIN}" rsh --box main 'yes | head -c 50000000' | head -c 10 >/dev/null; echo "rc=\${PIPESTATUS[0]}"`], { env })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', () => resolve({ out, err }))
  })
  assert.match(pipe.out, /rc=255/)
  assert.ok(!/\n\s+at /.test(pipe.err), pipe.err)
  const bad = await cli(['rsh', '--box', 'main', 'true'], { extraEnv: { BOX_TOKEN: 'cb_wrong' } })
  assert.equal(bad.code, 255)
  assert.match(bad.stderr, /invalid bearer token/)
  assert.ok(!bad.stderr.includes('cb_wrong'), 'the token is never printed')
})

test('offload warns, then moves the task; back fast-forwards the box commits', { skip, timeout: 60000 }, async () => {
  const repo = makeRepo('proj')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nuncommitted\n')
  fs.writeFileSync(path.join(repo, 'new.txt'), 'untracked\n')
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n')
  fs.mkdirSync(path.join(repo, 'node_modules'))
  fs.writeFileSync(path.join(repo, 'node_modules', 'big.js'), 'x')

  const where = (await cli(['offload', 'handover-path'], { cwd: repo })).text.trim()
  assert.ok(where.startsWith(env.BOX_HOME))
  fs.writeFileSync(where, handover('finish the thing'))

  const warned = await cli(['offload', '--kind', 'claude', '--json'], { cwd: repo })
  assert.equal(warned.code, 4, warned.stderr)
  const w = JSON.parse(warned.text)
  assert.equal(w.code, 'confirm')
  assert.ok(w.findings.some((f) => f.check === 'secrets' && f.detail.includes('.env')))

  const done = await cli(['offload', '--kind', 'claude', '--yes', '--json'], { cwd: repo })
  assert.equal(done.code, 0, done.stderr + done.text)
  const r = JSON.parse(done.text)
  assert.equal(r.accepted, true)
  const copy = r.dir
  assert.equal(fs.readFileSync(path.join(copy, 'a.txt'), 'utf8'), 'one\nuncommitted\n')
  assert.equal(fs.readFileSync(path.join(copy, 'new.txt'), 'utf8'), 'untracked\n')
  assert.ok(!fs.existsSync(path.join(copy, '.env')), 'ignored files stay here')
  assert.ok(!fs.existsSync(path.join(copy, 'node_modules')))
  // the bundle carried history and S
  assert.equal(git(copy, 'rev-parse', `refs/cocoonbox/offload/${r.offload_id}`), git(repo, 'rev-parse', `refs/cocoonbox/offload/${r.offload_id}`))
  assert.equal(git(copy, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'HEAD'))
  assert.equal(fs.readFileSync(path.join(tmp, 'state', `${r.repo}.handover.md`), 'utf8'), handover('finish the thing'))
  const envJson = JSON.parse(fs.readFileSync(path.join(tmp, 'state', `${r.repo}.env.json`), 'utf8'))
  assert.equal(envJson.v, 1)

  // the record is 0600 in a 0700 directory
  const rec = path.join(env.BOX_HOME, 'offload', r.repo, 'offload.json')
  assert.equal(fs.statSync(rec).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.dirname(rec)).mode & 0o777, 0o700)

  playBoxAgent(r, { 'a.txt': 'one\nuncommitted\nfrom the box\n' })
  const back = await cli(['back', '--json'], { cwd: repo })
  assert.equal(back.code, 0, back.stderr + back.text)
  const b = JSON.parse(back.text)
  assert.match(b.landing, /^fast-forward/)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\nuncommitted\nfrom the box\n')
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'box work')
  assert.equal(git(repo, 'status', '--porcelain'), '')
  assert.equal(fs.readFileSync(path.join(repo, '.env'), 'utf8'), 'SECRET=1\n')
  assert.ok(!fs.existsSync(rec), 'back removes the record')
  // the three offload Execs, rsync and git over rsh, and the back verbs all went through Session.Exec
  assert.ok(box.calls.some((c) => c.startsWith('cocoonbox-agent offload begin')))
  assert.ok(box.calls.some((c) => /^rsync --server/.test(c)), box.calls.join('\n'))
  assert.ok(box.calls.some((c) => /^git-upload-pack /.test(c)), box.calls.join('\n'))
  assert.ok(box.calls.some((c) => c.startsWith('cocoonbox-agent offload end')))
  const again = await cli(['back'], { cwd: repo })
  assert.equal(again.code, 1)
  assert.match(again.stderr, /back\.md/)
})

test('back applies a clean merge uncommitted when the user worked meanwhile, else a branch', { skip, timeout: 60000 }, async () => {
  const repo = makeRepo('proj2')
  const where = (await cli(['offload', 'handover-path'], { cwd: repo })).text.trim()
  fs.writeFileSync(where, handover('second'))
  const done = await cli(['offload', '--kind', 'claude', '--yes', '--json'], { cwd: repo })
  assert.equal(done.code, 0, done.stderr)
  const r = JSON.parse(done.text)
  fs.writeFileSync(path.join(repo, 'b.txt'), 'bee\nlocal edit\n')
  playBoxAgent(r, { 'a.txt': 'one\nbox edit\n' })
  const back = JSON.parse((await cli(['back', '--json'], { cwd: repo })).text)
  assert.match(back.landing, /^merged/)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\nbox edit\n')
  assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'bee\nlocal edit\n')

  // a conflict: the box changes the file the user also changed
  fs.writeFileSync(where, handover('third'))
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'local')
  const third = JSON.parse((await cli(['offload', '--kind', 'claude', '--yes', '--json'], { cwd: repo })).text)
  fs.writeFileSync(path.join(repo, 'a.txt'), 'mine\n')
  playBoxAgent(third, { 'a.txt': 'theirs\n' })
  const conflict = JSON.parse((await cli(['back', '--json'], { cwd: repo })).text)
  assert.match(conflict.landing, /^conflict: the box's work is on the branch cocoonbox\/back-/)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'mine\n', 'the work tree is untouched')
})

test('a box-side block exits 3 and names the box CLI commands', { skip, timeout: 60000 }, async () => {
  const repo = makeRepo('proj3')
  fs.writeFileSync((await cli(['offload', 'handover-path'], { cwd: repo })).text.trim(), handover('blocked'))
  // the block comes from begin; run the fake agent with FAKE_BEGIN_BLOCK through a box restarted with it
  const blocked = await startFakeBox({ workspace: path.join(tmp, 'workspace'), state: path.join(tmp, 'state'), env: { ...IDENT, FAKE_BEGIN_BLOCK: '1' } })
  try {
    const res = await cli(['offload', '--kind', 'claude'], { cwd: repo, extraEnv: { BOX_ENDPOINT: blocked.endpoint } })
    assert.equal(res.code, 3, res.stderr)
    assert.match(res.text, /block\s+cli: claude is signed out/)
    assert.match(res.text, /offload sign-in --kind claude/)
  } finally {
    await blocked.stop()
  }
  const bad = await cli(['offload', '--kind', 'claude', '--handover', path.join(tmp, 'nope.md')], { cwd: repo })
  assert.equal(bad.code, 1)
})
