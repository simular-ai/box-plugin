// Layer 1: run the real CLI against a real, installed client in an isolated HOME.
//   node e2e/install-matrix.mjs <client>
// Seeds an unrelated server, runs `connect --client <client> --yes`, checks with the client's own
// listing command that box is there, re-runs connect (must change nothing), runs `doctor`, then
// `remove`, and checks that the unrelated server survived. No secrets, no sign-in.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'
import { isolatedEnv } from './isolated-env.mjs'
import { createContext } from '../src/context.js'
import { findClient } from '../src/clients/index.js'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'simular-box.js')
const URL_RE = /relay\.simular\.cloud\/mcp/
const id = process.argv[2]
const client = findClient(id)
if (!client) throw new Error(`unknown client ${id}`)

const { home, env } = isolatedEnv()
if (client.id === 'codex' && process.platform === 'win32') {
  // On Windows, Codex finds the home folder through the OS profile API, not USERPROFILE, so a
  // temp HOME alone would point it at the runner's real profile. CODEX_HOME is its own override,
  // which the CLI honours too.
  env.CODEX_HOME = path.join(home, '.codex')
  fs.mkdirSync(env.CODEX_HOME, { recursive: true })
}
const ctx = createContext({ env })
console.log(`isolated HOME: ${home}`)

function sh(bin, args, { allowFail = false, timeout = 180000 } = {}) {
  const res = spawn.sync(bin, args, { env, cwd: home, encoding: 'utf8', timeout })
  const out = `${res.stdout || ''}${res.stderr || ''}`
  console.log(`$ ${bin} ${args.join(' ')}  (exit ${res.status})\n${out.trim().split('\n').map((l) => `  ${l}`).join('\n')}`)
  if (!allowFail && res.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed with exit ${res.status}`)
  return out
}
const box = (...args) => sh(process.execPath, [CLI, ...args])
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}
function backups() {
  const found = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory() && !['node_modules', '.git', 'plugins', 'cache'].includes(e.name)) walk(p)
      else if (e.name.includes('.box-backup-')) found.push(p)
    }
  }
  walk(home)
  return found.sort()
}

const ADAPTERS = {
  'claude-code': {
    bin: 'claude',
    seed: () => sh('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'other', 'https://example.com/mcp']),
    list: () => sh('claude', ['mcp', 'list']),
    present: (out) => /plugin:box:box/.test(out) && URL_RE.test(out),
    needsAuth: /needs authentication/i,
    otherKept: (out) => /\bother\b/.test(out),
  },
  codex: {
    bin: 'codex',
    seed: () => sh('codex', ['mcp', 'add', 'other', '--', 'npx', '-y', 'other-mcp']),
    list: () => sh('codex', ['mcp', 'list']),
    present: (out) => /^box\s+https:\/\/relay\.simular\.cloud\/mcp/m.test(out),
    needsAuth: /not logged in/i,
    otherKept: (out) => /^other\s/m.test(out),
  },
  opencode: {
    bin: 'opencode',
    seed: () => writeJson(client.configLocation(ctx), { $schema: 'https://opencode.ai/config.json', mcp: { other: { type: 'remote', url: 'https://example.com/mcp', enabled: false } } }),
    list: () => sh('opencode', ['mcp', 'list']),
    present: (out) => /\bbox\b/.test(out) && URL_RE.test(out),
    needsAuth: /needs authentication/i,
    otherKept: (out) => /\bother\b/.test(out),
  },
  openclaw: {
    bin: 'openclaw',
    seed: () => sh('openclaw', ['mcp', 'set', 'other', JSON.stringify({ command: 'npx', args: ['-y', 'other-mcp'] })]),
    list: () => sh('openclaw', ['mcp', 'list']) + sh('openclaw', ['mcp', 'show', 'box', '--json'], { allowFail: true }),
    present: (out) => /-\s+box\b/.test(out) && /streamable-http/.test(out) && URL_RE.test(out),
    otherKept: (out) => /-\s+other\b/.test(out),
  },
  hermes: {
    bin: 'hermes',
    seed: () => {
      const file = client.configLocation(ctx)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, '# seeded by the e2e test\nmcp_servers:\n  other:\n    command: npx\n    args: [-y, other-mcp]\n    enabled: false\n')
    },
    list: () => sh('hermes', ['mcp', 'list']),
    present: (out) => /\bbox\s+https:\/\/relay\.simular/.test(out),
    otherKept: (out) => /\bother\b/.test(out),
  },
  cursor: {
    bin: 'cursor-agent',
    seed: () => writeJson(client.configLocation(ctx), { mcpServers: { other: { url: 'https://example.com/mcp' } } }),
    list: () => sh('cursor-agent', ['mcp', 'list']),
    present: (out) => /^box:/m.test(out),
    otherKept: (out) => /^other:/m.test(out),
  },
}

const a = ADAPTERS[client.id]
if (!a) throw new Error(`no install-matrix adapter for ${client.id}`)
if (!ctx.which(a.bin)) throw new Error(`${a.bin} is not on PATH; install the client first`)

a.seed()
let out = box('connect', '--client', client.id, '--yes')
assert.match(out, new RegExp(`${client.name}: `), 'connect reports the client')

out = a.list()
assert.ok(a.present(out), `${a.bin}'s own listing shows box at the box URL`)
if (a.needsAuth) assert.match(out, a.needsAuth, 'and says it needs sign-in')
assert.ok(a.otherKept(out), 'the seeded server is still listed after connect')

const before = backups()
out = box('connect', '--client', client.id, '--yes')
assert.match(out, new RegExp(`${client.name}: already set up`), 're-run is a no-op')
assert.deepEqual(backups(), before, 're-run writes no new backup')

const report = JSON.parse(box('doctor', '--client', client.id, '--json'))
const row = report.clients[0]
assert.equal(report.endpoint.ok, true, 'prod endpoint answers 401 + metadata')
assert.equal(row.configured, true)
assert.deepEqual(row.problems, [], 'doctor finds no problem')

box('remove', '--client', client.id, '--yes')
out = a.list()
assert.ok(!a.present(out), 'box is gone after remove')
assert.ok(a.otherKept(out), 'the seeded server survived remove')
console.log(`\nOK: ${client.name} (${a.bin})`)
