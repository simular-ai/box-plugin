// Layer 1: run the real CLI against a real, installed client in an isolated HOME.
//   node e2e/install-matrix.mjs <client>
// Seeds an unrelated server and a box set up at box's old address (relay.simular.cloud), runs
// `connect --client <client> --yes`, checks that it moved box to the current URL and said so, checks
// with the client's own listing command that box is there, re-runs connect (must change nothing),
// runs `doctor`, then `remove`, and checks that the unrelated server survived. No secrets, no sign-in.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import spawn from 'cross-spawn'
import { isolatedEnv } from './isolated-env.mjs'
import { createContext } from '../src/context.js'
import { findClient } from '../src/clients/index.js'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'simular-box.js')
const URL_RE = /mcp\.box\.simular\.ai\/mcp/
const OLD_URL = 'https://relay.simular.cloud/mcp'
const REPO = path.join(path.dirname(CLI), '..', '..')
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

// Claude Code: install the plugin as it was before the move and the rename (named `box`, at the old
// URL) from a git marketplace built from this checkout (so the job tests this branch's plugin, not
// main's), then push this branch's plugin to it, as a merge to main would. connect must then end
// with only simular-box@simular-box installed: Claude Code moves box@simular-box to it through the
// marketplace's renames map, and connect uninstalls an old box@simular-box that is left. A fake
// https URL is mapped to the local repo with git's url.<base>.insteadOf, because Claude Code adds
// git marketplaces only from https URLs.
const FAKE_MARKETPLACE = 'https://box-plugin.invalid/box-plugin.git'
function seedOldClaudePlugin() {
  const work = path.join(home, 'box-plugin-market')
  const bare = path.join(home, 'box-plugin-market.git')
  const git = (...args) => sh('git', ['-C', work, '-c', 'user.name=box e2e', '-c', 'user.email=e2e@box.invalid', '-c', 'commit.gpgsign=false', ...args])
  const copy = () => {
    for (const d of ['.claude-plugin', 'claude']) fs.cpSync(path.join(REPO, d), path.join(work, d), { recursive: true })
  }
  copy()
  const mcp = path.join(work, 'claude', '.mcp.json')
  fs.writeFileSync(mcp, fs.readFileSync(mcp, 'utf8').replace(URL_RE, 'relay.simular.cloud/mcp'))
  const manifest = path.join(work, 'claude', '.claude-plugin', 'plugin.json')
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), name: 'box', version: '0.0.1' }, null, 2))
  const market = path.join(work, '.claude-plugin', 'marketplace.json')
  const m = JSON.parse(fs.readFileSync(market, 'utf8'))
  fs.writeFileSync(market, JSON.stringify({ ...m, plugins: m.plugins.map((p) => ({ ...p, name: 'box' })) }, null, 2))
  sh('git', ['init', '--quiet', '--initial-branch', 'main', work])
  git('add', '-A')
  git('commit', '--quiet', '-m', 'before the move')
  sh('git', ['clone', '--quiet', '--bare', work, bare])
  Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${pathToFileURL(bare).href}.insteadOf`, GIT_CONFIG_VALUE_0: FAKE_MARKETPLACE })
  sh('claude', ['plugin', 'marketplace', 'add', FAKE_MARKETPLACE])
  sh('claude', ['plugin', 'install', 'box@simular-box', '--scope', 'user'])
  assert.match(sh('claude', ['plugin', 'list', '--json']), /relay\.simular\.cloud\/mcp/, 'the old plugin is installed')
  copy()
  git('add', '-A')
  git('commit', '--quiet', '-m', 'this branch')
  git('push', '--quiet', bare, 'HEAD:main')
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
    seed: () => {
      sh('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'other', 'https://example.com/mcp'])
      seedOldClaudePlugin()
    },
    list: () => sh('claude', ['mcp', 'list']),
    present: (out) => /plugin:simular-box:box/.test(out) && URL_RE.test(out),
    needsAuth: /needs authentication/i,
    otherKept: (out) => /\bother\b/.test(out),
  },
  codex: {
    bin: 'codex',
    seed: () => {
      sh('codex', ['mcp', 'add', 'other', '--', 'npx', '-y', 'other-mcp'])
      // `codex mcp add --url` would start the sign-in, so the old entry is written by hand.
      fs.appendFileSync(client.configLocation(ctx), `\n[mcp_servers.box]\nurl = "${OLD_URL}"\n`)
    },
    list: () => sh('codex', ['mcp', 'list']),
    present: (out) => /^box\s+https:\/\/mcp\.box\.simular\.ai\/mcp/m.test(out),
    needsAuth: /not logged in/i,
    otherKept: (out) => /^other\s/m.test(out),
  },
  opencode: {
    bin: 'opencode',
    seed: () =>
      writeJson(client.configLocation(ctx), {
        $schema: 'https://opencode.ai/config.json',
        mcp: { other: { type: 'remote', url: 'https://example.com/mcp', enabled: false }, box: { type: 'remote', url: OLD_URL, enabled: true } },
      }),
    list: () => sh('opencode', ['mcp', 'list']),
    present: (out) => /\bbox\b/.test(out) && URL_RE.test(out),
    needsAuth: /needs authentication/i,
    otherKept: (out) => /\bother\b/.test(out),
  },
  openclaw: {
    bin: 'openclaw',
    seed: () => {
      sh('openclaw', ['mcp', 'set', 'other', JSON.stringify({ command: 'npx', args: ['-y', 'other-mcp'] })])
      sh('openclaw', ['mcp', 'set', 'box', JSON.stringify({ url: OLD_URL, transport: 'streamable-http', auth: 'oauth' })])
    },
    list: () => sh('openclaw', ['mcp', 'list']) + sh('openclaw', ['mcp', 'show', 'box', '--json'], { allowFail: true }),
    present: (out) => /-\s+box\b/.test(out) && /streamable-http/.test(out) && URL_RE.test(out),
    otherKept: (out) => /-\s+other\b/.test(out),
  },
  hermes: {
    bin: 'hermes',
    seed: () => {
      const file = client.configLocation(ctx)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, `# seeded by the e2e test\nmcp_servers:\n  other:\n    command: npx\n    args: [-y, other-mcp]\n    enabled: false\n  box:\n    url: ${OLD_URL}\n    auth: oauth\n`)
    },
    list: () => sh('hermes', ['mcp', 'list']),
    present: (out) => /\bbox\s+https:\/\/mcp\.box\.simular/.test(out),
    otherKept: (out) => /\bother\b/.test(out),
  },
  'gemini-cli': {
    bin: 'gemini',
    seed: () => writeJson(client.configLocation(ctx), { mcpServers: { other: { httpUrl: 'https://example.com/mcp' }, box: { type: 'http', url: OLD_URL } } }),
    // The isolated HOME is not a trusted folder, so Gemini lists the servers as Disabled and
    // never connects; the listing still proves it reads our entry as an http server.
    list: () => sh('gemini', ['mcp', 'list']),
    present: (out) => /\bbox: https:\/\/mcp\.box\.simular\.ai\/mcp \(http\)/.test(out),
    otherKept: (out) => /\bother: https:\/\/example\.com\/mcp/.test(out),
  },
  cursor: {
    bin: 'cursor-agent',
    seed: () => writeJson(client.configLocation(ctx), { mcpServers: { other: { url: 'https://example.com/mcp' }, box: { url: OLD_URL } } }),
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
assert.match(out, new RegExp(`box moved from ${OLD_URL.replace(/[.]/g, '\\.')} to https://mcp\\.box\\.simular\\.ai/mcp\\. ${client.name} may ask you to sign in to box again`), 'connect moved box off the old address and said so')

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
