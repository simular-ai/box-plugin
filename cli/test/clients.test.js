import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as TOML from 'smol-toml'
import YAML from 'yaml'
import * as jsonc from 'jsonc-parser'
import { findClient } from '../src/clients/index.js'
import { DEFAULT_MCP_URL } from '../src/constants.js'
import { FAKE_CLAUDE, FAKE_OPENCLAW, fixture, sandbox } from './helpers.js'

const KEY = 'cb_test_fake_key_123'
const client = (id) => findClient(id)
const WIN = process.platform === 'win32'
// Fake client CLIs are shebang scripts, and Windows has no POSIX file modes.
const NO_FAKE_BINS = WIN && 'fake CLIs are shebang scripts; Windows runs the real clients in the install matrix'
const plain = (v) => JSON.parse(JSON.stringify(v))
const backups = (dir) => fs.readdirSync(dir).filter((f) => f.includes('.box-backup-'))

test('cursor: merges into mcpServers, keeps comments and other servers, drops box-control, idempotent', () => {
  const sb = sandbox()
  const file = sb.write('.cursor/mcp.json', fixture('cursor.before.json'))
  const first = client('cursor').connect(sb.ctx)
  assert.equal(first.actions.length, 1)
  assert.equal(first.backups.length, 1)
  const text = sb.read('.cursor/mcp.json')
  assert.match(text, /\/\/ Cursor servers the user already has/)
  const doc = jsonc.parse(text)
  assert.deepEqual(doc.mcpServers.box, { url: DEFAULT_MCP_URL })
  assert.deepEqual(doc.mcpServers.github, { url: 'https://api.githubcopilot.com/mcp/' })
  assert.equal(doc.mcpServers['box-control'], undefined)
  const again = client('cursor').connect(sb.ctx)
  assert.deepEqual(again.actions, [])
  assert.equal(backups(path.dirname(file)).length, 1, 'a no-op re-run makes no new backup')
  client('cursor').remove(sb.ctx)
  const after = jsonc.parse(sb.read('.cursor/mcp.json'))
  assert.equal(after.mcpServers.box, undefined)
  assert.ok(after.mcpServers.github)
})

test('cursor: refuses to touch a file it cannot parse', () => {
  const sb = sandbox()
  sb.write('.cursor/mcp.json', fixture('broken.json'))
  assert.throws(() => client('cursor').connect(sb.ctx), /not valid JSON/)
  assert.equal(sb.read('.cursor/mcp.json'), fixture('broken.json'))
})

test('cursor: creates the file when missing; BOX_MCP_URL overrides the URL', () => {
  const sb = sandbox({ env: { BOX_MCP_URL: 'https://staging.example.test/mcp' } })
  client('cursor').connect(sb.ctx)
  assert.deepEqual(JSON.parse(sb.read('.cursor/mcp.json')), { mcpServers: { box: { url: 'https://staging.example.test/mcp' } } })
})

test('codex: rewrites only [mcp_servers.box] (and its subtables), keeps comments, removes box-control', () => {
  const sb = sandbox()
  sb.write('.codex/config.toml', fixture('codex.before.toml'))
  client('codex').connect(sb.ctx)
  assert.equal(sb.read('.codex/config.toml'), fixture('codex.after.toml'))
  assert.deepEqual(client('codex').connect(sb.ctx).actions, [])
  const st = client('codex').status(sb.ctx)
  assert.equal(st.entries[0].url, DEFAULT_MCP_URL)
  client('codex').remove(sb.ctx)
  const doc = TOML.parse(sb.read('.codex/config.toml'))
  assert.equal(doc.mcp_servers.box, undefined)
  assert.deepEqual(plain(doc.mcp_servers.docs), { command: 'npx', args: ['docs-mcp'] })
  assert.match(sb.read('.codex/config.toml'), /# keep this comment/)
  assert.match(sb.read('.codex/config.toml'), /# Profiles: keep this comment with its table\n\[profiles\.fast\]/)
})

test('codex: keeps CRLF line endings', () => {
  const sb = sandbox()
  sb.write('.codex/config.toml', 'model = "gpt-5"\r\n\r\n[mcp_servers.box]\r\nurl = "https://relay.simular.cloud/old"\r\n\r\n[profiles.x]\r\nmodel = "m"\r\n')
  client('codex').connect(sb.ctx)
  assert.equal(sb.read('.codex/config.toml'), 'model = "gpt-5"\r\n\r\n[profiles.x]\r\nmodel = "m"\r\n\r\n[mcp_servers.box]\r\nurl = "https://mcp.box.simular.ai/mcp"\r\n')
  client('codex').remove(sb.ctx)
  assert.equal(sb.read('.codex/config.toml'), 'model = "gpt-5"\r\n\r\n[profiles.x]\r\nmodel = "m"\r\n')
})

test('codex: honours CODEX_HOME', () => {
  const sb = sandbox()
  const codexHome = path.join(sb.home, 'elsewhere')
  const ctx = { ...sb.ctx, env: { ...sb.env, CODEX_HOME: codexHome } }
  client('codex').connect(ctx)
  assert.deepEqual(plain(TOML.parse(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'))), { mcp_servers: { box: { url: DEFAULT_MCP_URL } } })
})

test('codex: refuses an inline box table it cannot edit safely', () => {
  const sb = sandbox()
  const text = 'mcp_servers = { box = { url = "https://relay.simular.cloud/mcp-old" } }\n'
  sb.write('.codex/config.toml', text)
  assert.throws(() => client('codex').connect(sb.ctx), /inline/)
  assert.equal(sb.read('.codex/config.toml'), text)
})

test('opencode: prefers opencode.jsonc, writes a remote entry, keeps comments', () => {
  const sb = sandbox()
  sb.write('.config/opencode/opencode.jsonc', fixture('opencode.before.jsonc'))
  client('opencode').connect(sb.ctx)
  const text = sb.read('.config/opencode/opencode.jsonc')
  assert.match(text, /\/\/ theme first/)
  const doc = jsonc.parse(text)
  assert.deepEqual(doc.mcp.box, { type: 'remote', url: DEFAULT_MCP_URL, enabled: true })
  assert.ok(doc.mcp.local)
  assert.equal(sb.read('.config/opencode/opencode.json'), null)
})

test('vscode: writes servers.box with type http next to other servers', () => {
  const sb = sandbox()
  sb.write('.config/Code/User/mcp.json', fixture('vscode.before.json'))
  client('vscode').connect(sb.ctx)
  const doc = JSON.parse(sb.read('.config/Code/User/mcp.json'))
  assert.deepEqual(doc.servers.box, { type: 'http', url: DEFAULT_MCP_URL })
  assert.ok(doc.servers.playwright)
  assert.deepEqual(doc.inputs, [])
})

test('gemini-cli: merges mcpServers.box as an http server, keeps comments and settings, idempotent, removes', () => {
  const sb = sandbox()
  const file = sb.write('.gemini/settings.json', '{\n  // mine\n  "theme": "Default",\n  "mcpServers": { "other": { "httpUrl": "https://example.com/mcp" } }\n}\n')
  const res = client('gemini').connect(sb.ctx)
  assert.match(res.next[0], /\/mcp auth box/)
  assert.equal(res.backups.length, 1)
  const text = sb.read('.gemini/settings.json')
  assert.match(text, /\/\/ mine/)
  const doc = jsonc.parse(text)
  assert.deepEqual(doc.mcpServers.box, { type: 'http', url: DEFAULT_MCP_URL })
  assert.equal(doc.theme, 'Default')
  assert.deepEqual(client('gemini').connect(sb.ctx).actions, [])
  assert.equal(backups(path.dirname(file)).length, 1, 'a no-op re-run makes no new backup')
  assert.equal(client('gemini-cli').status(sb.ctx).entries[0].url, DEFAULT_MCP_URL)
  client('gemini-cli').remove(sb.ctx)
  assert.deepEqual(Object.keys(jsonc.parse(sb.read('.gemini/settings.json')).mcpServers), ['other'])
})

test('gemini-cli: a foreign box given as httpUrl is recognised and left alone', () => {
  const sb = sandbox()
  const original = JSON.stringify({ mcpServers: { box: { httpUrl: 'https://mcp.box.com' } } }, null, 2)
  sb.write('.gemini/settings.json', original)
  assert.throws(() => client('gemini-cli').connect(sb.ctx), (e) => e.foreign)
  assert.equal(client('gemini-cli').status(sb.ctx).foreign.url, 'https://mcp.box.com')
  client('gemini-cli').remove(sb.ctx)
  assert.equal(sb.read('.gemini/settings.json'), original)
})

test('hermes: OAuth entry keeps comments; key mode puts the key only in .env (0600)', () => {
  const sb = sandbox()
  sb.write('.hermes/config.yaml', fixture('hermes.before.yaml'))
  client('hermes').connect(sb.ctx, { mode: 'oauth' })
  let text = sb.read('.hermes/config.yaml')
  assert.match(text, /# GitHub server/)
  assert.deepEqual(YAML.parse(text).mcp_servers.box, { url: DEFAULT_MCP_URL, auth: 'oauth', enabled: true })

  sb.write('.hermes/.env', 'OPENROUTER_API_KEY=sk-other\n', 0o644)
  client('hermes').connect(sb.ctx, { mode: 'key', key: KEY })
  text = sb.read('.hermes/config.yaml')
  assert.ok(!text.includes(KEY), 'the key is never written to config.yaml')
  assert.deepEqual(YAML.parse(text).mcp_servers.box, { url: DEFAULT_MCP_URL, headers: { Authorization: 'Bearer ${MCP_BOX_API_KEY}' }, enabled: true })
  assert.equal(sb.read('.hermes/.env'), `OPENROUTER_API_KEY=sk-other\nMCP_BOX_API_KEY=${KEY}\n`)
  if (!WIN) assert.equal(fs.statSync(path.join(sb.home, '.hermes/.env')).mode & 0o777, 0o600)
  for (const b of WIN ? [] : backups(path.join(sb.home, '.hermes')).filter((f) => f.startsWith('.env'))) {
    assert.equal(fs.statSync(path.join(sb.home, '.hermes', b)).mode & 0o777, 0o600, 'a backup of .env is private too')
  }
  const st = client('hermes').status(sb.ctx)
  assert.equal(st.key, KEY)
  assert.equal(st.entries[0].mode, 'key')
  // Re-run without a key keeps the stored one.
  assert.deepEqual(client('hermes').connect(sb.ctx, { mode: 'key' }).actions, [])

  client('hermes').remove(sb.ctx)
  assert.equal(sb.read('.hermes/.env'), 'OPENROUTER_API_KEY=sk-other\n')
  assert.equal(YAML.parse(sb.read('.hermes/config.yaml')).mcp_servers.box, undefined)
  assert.ok(YAML.parse(sb.read('.hermes/config.yaml')).mcp_servers.github)
})

test('openclaw: OAuth via `openclaw mcp set` with streamable-http; key mode references ${BOX_TOKEN} from .env', { skip: NO_FAKE_BINS }, () => {
  const sb = sandbox({ bins: { openclaw: FAKE_OPENCLAW } })
  client('openclaw').connect(sb.ctx, { mode: 'oauth' })
  const cfg = () => JSON.parse(sb.read('.openclaw/openclaw.json'))
  assert.deepEqual(cfg().mcp.servers.box, { url: DEFAULT_MCP_URL, transport: 'streamable-http', auth: 'oauth' })

  client('openclaw').connect(sb.ctx, { mode: 'key', key: KEY })
  assert.deepEqual(cfg().mcp.servers.box, { url: DEFAULT_MCP_URL, transport: 'streamable-http', headers: { Authorization: 'Bearer ${BOX_TOKEN}' } })
  assert.ok(!sb.read('.openclaw/openclaw.json').includes(KEY))
  assert.equal(sb.read('.openclaw/.env'), `BOX_TOKEN=${KEY}\n`)
  assert.equal(fs.statSync(path.join(sb.home, '.openclaw/.env')).mode & 0o777, 0o600)

  const st = client('openclaw').status(sb.ctx)
  assert.equal(st.key, KEY)
  assert.deepEqual(st.warnings, [], '`mcp show` substitutes the key, but status reads the raw file')
  const setsBefore = sb.read('fake-openclaw-calls.log').split('\n').filter((l) => l.startsWith('mcp set')).length
  assert.deepEqual(client('openclaw').connect(sb.ctx, { mode: 'key' }).actions, [])
  const setsAfter = sb.read('fake-openclaw-calls.log').split('\n').filter((l) => l.startsWith('mcp set')).length
  assert.equal(setsAfter, setsBefore, 'idempotent re-run does not call mcp set')

  client('openclaw').remove(sb.ctx)
  assert.equal(cfg().mcp.servers.box, undefined)
  assert.equal(sb.read('.openclaw/.env'), '')
})

test('openclaw: warns when the header references BOX_TOKEN but .env lacks it (the literal-placeholder 401)', { skip: NO_FAKE_BINS }, () => {
  const sb = sandbox({ bins: { openclaw: FAKE_OPENCLAW } })
  sb.write('.openclaw/openclaw.json', JSON.stringify({ mcp: { servers: { box: { url: DEFAULT_MCP_URL, transport: 'streamable-http', headers: { Authorization: 'Bearer ${BOX_TOKEN}' } } } } }))
  const st = client('openclaw').status(sb.ctx)
  assert.match(st.warnings.join(' '), /placeholder and get 401/)
})

test('claude-code: default URL installs the plugin from the marketplace; override uses claude mcp add', { skip: NO_FAKE_BINS }, () => {
  const sb = sandbox({ bins: { claude: FAKE_CLAUDE } })
  sb.write('.claude.json', JSON.stringify({ mcpServers: { 'box-control': { url: 'https://relay.simular.cloud/control' }, box: { type: 'http', url: DEFAULT_MCP_URL }, other: { command: 'y' } } }))
  client('claude').connect(sb.ctx)
  const state = () => JSON.parse(sb.read('fake-claude-state.json'))
  assert.deepEqual(state().plugins, { 'box@simular-box': { enabled: true, url: DEFAULT_MCP_URL } })
  assert.deepEqual(Object.keys(JSON.parse(sb.read('.claude.json')).mcpServers), ['other'])
  assert.ok(state().calls.includes('plugin marketplace add simular-ai/box-plugin'))
  assert.deepEqual(client('claude').connect(sb.ctx).actions, [])

  const ctx = { ...sb.ctx, url: 'https://staging.example.test/mcp' }
  client('claude').connect(ctx)
  assert.deepEqual(JSON.parse(sb.read('.claude.json')).mcpServers.box, { type: 'http', url: 'https://staging.example.test/mcp' })
  assert.equal(state().plugins['box@simular-box'].enabled, false)
  assert.equal(client('claude').status(ctx).entries.length, 1)

  // remove runs with the same BOX_MCP_URL, so the staging host counts as ours.
  client('claude').remove(ctx)
  assert.deepEqual(state().plugins, {})
  assert.equal(JSON.parse(sb.read('.claude.json')).mcpServers.box, undefined)
})

test('claude-code: a plugin installed before the move is updated to the new URL', { skip: NO_FAKE_BINS }, () => {
  const sb = sandbox({ bins: { claude: FAKE_CLAUDE } })
  const old = 'https://relay.simular.cloud/mcp'
  sb.write('fake-claude-state.json', JSON.stringify({ marketplaces: ['simular-box'], plugins: { 'box@simular-box': { enabled: true, url: old } }, calls: [] }))
  const state = () => JSON.parse(sb.read('fake-claude-state.json'))
  assert.equal(client('claude').status(sb.ctx).entries[0].url, old)
  const dry = client('claude').connect({ ...sb.ctx, dryRun: true })
  assert.match(dry.actions.join(' '), /would update plugin box@simular-box/)
  assert.equal(state().plugins['box@simular-box'].url, old, 'a dry run updates nothing')
  const res = client('claude').connect(sb.ctx)
  assert.match(res.actions.join(' '), /updated plugin box@simular-box/)
  assert.match(res.next[0], /^Restart Claude Code/)
  assert.ok(state().calls.includes('plugin marketplace update simular-box'))
  assert.ok(state().calls.includes('plugin update box@simular-box --scope user'))
  assert.equal(state().plugins['box@simular-box'].url, DEFAULT_MCP_URL)
  assert.deepEqual(client('claude').connect(sb.ctx).actions, [], 'idempotent once updated')
  // Our own old user-scope box next to the plugin is removed; remove takes the plugin either way.
  sb.write('.claude.json', JSON.stringify({ mcpServers: { box: { type: 'http', url: old } } }))
  assert.match(client('claude').connect(sb.ctx).actions.join(' '), /removed the user-scope box server/)
  client('claude').remove(sb.ctx)
  assert.deepEqual(state().plugins, {})
})

test('claude-desktop: writes nothing, prints connector steps', () => {
  const sb = sandbox()
  const res = client('claude-desktop').connect(sb.ctx)
  assert.match(res.next[0], /Add custom connector/)
  assert.deepEqual(fs.readdirSync(sb.home), ['.bin'])
})

test('dry run writes nothing for file-based clients', () => {
  const sb = sandbox()
  const ctx = { ...sb.ctx, dryRun: true }
  for (const id of ['cursor', 'codex', 'opencode', 'vscode', 'gemini-cli', 'hermes']) {
    const res = client(id).connect(ctx, { mode: 'oauth' })
    assert.ok(res.actions[0].startsWith('would'), id)
  }
  assert.deepEqual(fs.readdirSync(sb.home), ['.bin'])
})

// ---- someone else's `box` (e.g. box.com's MCP server) is never ours to change or remove ----

const BOX_COM = 'https://mcp.box.com'

test('json clients: a foreign box blocks connect, survives remove, and --name installs next to it', () => {
  const cases = [
    ['cursor', '.cursor/mcp.json', ['mcpServers']],
    ['opencode', '.config/opencode/opencode.json', ['mcp']],
    ['vscode', '.config/Code/User/mcp.json', ['servers']],
    ['gemini-cli', '.gemini/settings.json', ['mcpServers']],
  ]
  for (const [id, rel, container] of cases) {
    const sb = sandbox()
    const foreign = { url: BOX_COM, headers: { Authorization: 'Bearer box-com-token' } }
    const original = JSON.stringify(container.reduceRight((acc, k) => ({ [k]: acc }), { box: foreign }), null, 2)
    sb.write(rel, original)
    assert.throws(() => client(id).connect(sb.ctx), (e) => e.foreign && /--name/.test(e.message), id)
    assert.equal(sb.read(rel), original, `${id}: file untouched`)
    const rm = client(id).remove(sb.ctx)
    assert.equal(sb.read(rel), original, `${id}: remove leaves it`)
    assert.match(rm.warnings.join(' '), /not box by Simular/)
    assert.ok(client(id).status(sb.ctx).foreign, `${id}: status reports it`)

    const named = { ...sb.ctx, name: 'simular-box' }
    client(id).connect(named)
    let doc = jsonc.parse(sb.read(rel))
    let map = container.reduce((acc, k) => acc[k], doc)
    assert.deepEqual(map.box, foreign, `${id}: foreign box kept`)
    assert.equal(map['simular-box'].url, DEFAULT_MCP_URL)
    client(id).remove(named)
    doc = jsonc.parse(sb.read(rel))
    map = container.reduce((acc, k) => acc[k], doc)
    assert.deepEqual(Object.keys(map), ['box'])
  }
})

test('codex: a foreign [mcp_servers.box] is left alone, fields and all', () => {
  const sb = sandbox()
  const original = `[mcp_servers.box]\nurl = "${BOX_COM}"\nbearer_token_env_var = "BOX_COM_TOKEN"\n`
  sb.write('.codex/config.toml', original)
  assert.throws(() => client('codex').connect(sb.ctx), /not box by Simular/)
  client('codex').remove(sb.ctx)
  assert.equal(sb.read('.codex/config.toml'), original)
  client('codex').connect({ ...sb.ctx, name: 'simular-box' })
  const doc = plain(TOML.parse(sb.read('.codex/config.toml')))
  assert.deepEqual(doc.mcp_servers.box, { url: BOX_COM, bearer_token_env_var: 'BOX_COM_TOKEN' })
  assert.deepEqual(doc.mcp_servers['simular-box'], { url: DEFAULT_MCP_URL })
})

test('codex: removing box keeps the comment above the next table', () => {
  const sb = sandbox()
  sb.write('.codex/config.toml', `model = "o3"\n\n[mcp_servers.box]\nurl = "${DEFAULT_MCP_URL}"\n\n# Linear: my work tracker (keep!)\n[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"\n`)
  client('codex').remove(sb.ctx)
  assert.equal(sb.read('.codex/config.toml'), `model = "o3"\n\n# Linear: my work tracker (keep!)\n[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"\n`)
})

test('hermes: a foreign box blocks connect and survives remove', () => {
  const sb = sandbox()
  const original = `mcp_servers:\n  box:\n    url: ${BOX_COM}\n    headers:\n      Authorization: Bearer \${BOX_COM_TOKEN}\n`
  sb.write('.hermes/config.yaml', original)
  assert.throws(() => client('hermes').connect(sb.ctx, { mode: 'oauth' }), /--name/)
  client('hermes').remove(sb.ctx)
  assert.equal(sb.read('.hermes/config.yaml'), original)
})

test('openclaw: a foreign box blocks connect and survives remove', { skip: NO_FAKE_BINS }, () => {
  const sb = sandbox({ bins: { openclaw: FAKE_OPENCLAW } })
  sb.write('.openclaw/openclaw.json', JSON.stringify({ mcp: { servers: { box: { url: BOX_COM, transport: 'streamable-http' } } } }))
  assert.throws(() => client('openclaw').connect(sb.ctx, { mode: 'oauth' }), /--name/)
  const rm = client('openclaw').remove(sb.ctx)
  assert.deepEqual(rm.actions, [])
  assert.equal(JSON.parse(sb.read('.openclaw/openclaw.json')).mcp.servers.box.url, BOX_COM)
})

test('claude-code: a foreign user-scope box is never removed', { skip: NO_FAKE_BINS }, () => {
  const sb = sandbox({ bins: { claude: FAKE_CLAUDE } })
  sb.write('.claude.json', JSON.stringify({ mcpServers: { box: { type: 'http', url: BOX_COM } } }))
  client('claude').connect(sb.ctx) // plugin route: its server is plugin:box:box, no clash
  assert.equal(JSON.parse(sb.read('.claude.json')).mcpServers.box.url, BOX_COM)
  const override = { ...sb.ctx, url: 'https://staging.relay.simular.cloud/mcp' }
  assert.throws(() => client('claude').connect(override), /--name/)
  client('claude').remove(sb.ctx)
  assert.equal(JSON.parse(sb.read('.claude.json')).mcpServers.box.url, BOX_COM)
  assert.ok(!JSON.parse(sb.read('fake-claude-state.json')).calls.some((c) => c.startsWith('mcp remove')))
})

test('a symlinked config stays a symlink and the target is updated', { skip: WIN && 'symlinks need admin on Windows' }, () => {
  const sb = sandbox()
  const real = sb.write('dotfiles/cursor-mcp.json', '{ "mcpServers": {} }\n')
  fs.mkdirSync(path.join(sb.home, '.cursor'))
  fs.symlinkSync(real, path.join(sb.home, '.cursor', 'mcp.json'))
  client('cursor').connect(sb.ctx)
  assert.ok(fs.lstatSync(path.join(sb.home, '.cursor', 'mcp.json')).isSymbolicLink())
  assert.equal(JSON.parse(fs.readFileSync(real, 'utf8')).mcpServers.box.url, DEFAULT_MCP_URL)
})

test('key files: no backup keeps an old key after rotation or remove', () => {
  const sb = sandbox()
  client('hermes').connect(sb.ctx, { mode: 'key', key: KEY })
  client('hermes').connect(sb.ctx, { mode: 'key', key: 'cb_rotated_key_456' })
  client('hermes').remove(sb.ctx)
  const leftovers = fs.readdirSync(path.join(sb.home, '.hermes')).filter((f) => f.startsWith('.env'))
  assert.deepEqual(leftovers, ['.env'])
  assert.equal(sb.read('.hermes/.env'), '')
})
