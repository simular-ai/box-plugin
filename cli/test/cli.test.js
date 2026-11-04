import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../src/args.js'
import { mcpUrl, maskKey, DEFAULT_MCP_URL, EXAMPLE_PROMPTS } from '../src/constants.js'
import { parseWwwAuthenticate, probeEndpoint, checkKey } from '../src/probe.js'
import { runDoctor } from '../src/cli.js'
import { sandbox } from './helpers.js'
import fs from 'node:fs'
import { createContext } from '../src/context.js'
import { findClient } from '../src/clients/index.js'

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'simular-box.js')
const KEY = 'cb_test_fake_key_123'

test('args: --client lists, --auth, and keys are never accepted as arguments', () => {
  assert.deepEqual(parseArgs(['connect', '--client', 'cursor,codex', '-c', 'hermes', '--yes']).flags, { client: ['cursor', 'codex', 'hermes'], yes: true })
  assert.equal(parseArgs(['connect', '--auth=key']).flags.auth, 'key')
  assert.throws(() => parseArgs(['connect', '--key', KEY]), /never as an argument/)
  assert.throws(() => parseArgs(['connect', '--auth', 'password']), /oauth or key/)
})

test('url: one default, BOX_MCP_URL override, https only (http for localhost)', () => {
  assert.equal(mcpUrl({}), DEFAULT_MCP_URL)
  assert.equal(mcpUrl({ BOX_MCP_URL: 'https://mcp.box.simular.ai/mcp/' }), 'https://mcp.box.simular.ai/mcp')
  assert.equal(mcpUrl({ BOX_MCP_URL: 'http://127.0.0.1:8080/mcp' }), 'http://127.0.0.1:8080/mcp')
  assert.throws(() => mcpUrl({ BOX_MCP_URL: 'http://evil.example/mcp' }), /https/)
  assert.equal(maskKey(KEY), 'cb_****')
})

test('probe: parses WWW-Authenticate and follows resource metadata', async () => {
  assert.deepEqual(parseWwwAuthenticate('Bearer resource_metadata="https://r/.well-known/x", scope="boxes", error="invalid_token"'), {
    resource_metadata: 'https://r/.well-known/x',
    scope: 'boxes',
    error: 'invalid_token',
  })
  const fetchImpl = async (url, init) => {
    if (url.includes('.well-known')) return new Response(JSON.stringify({ authorization_servers: ['https://as'] }), { status: 200 })
    if (init.headers.authorization === `Bearer ${KEY}`) return new Response('{}', { status: 200 })
    return new Response(null, { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="https://r/.well-known/x"${init.headers.authorization ? ', error="invalid_token"' : ''}` } })
  }
  const ep = await probeEndpoint('https://r/mcp', { fetchImpl })
  assert.equal(ep.ok, true)
  assert.equal(ep.authorizationServer, 'https://as')
  assert.equal((await checkKey('https://r/mcp', KEY, { fetchImpl })).valid, true)
  assert.deepEqual(await checkKey('https://r/mcp', 'cb_wrong_key', { fetchImpl }), { valid: false, status: 401, error: 'invalid_token' })
  const down = await probeEndpoint('https://r/mcp', { fetchImpl: async () => new Response('', { status: 200 }) })
  assert.match(down.error, /expected 401/)
})

test('doctor: flags a stale URL, a legacy server and a rejected key, with fixes', async () => {
  const sb = sandbox()
  sb.write('.cursor/mcp.json', JSON.stringify({ mcpServers: { box: { url: 'https://relay.simular.cloud/old' }, 'box-control': { url: 'https://relay.simular.cloud/control' } } }))
  sb.write('.hermes/config.yaml', 'mcp_servers:\n  box:\n    url: https://relay.simular.cloud/mcp\n    headers:\n      Authorization: Bearer ${MCP_BOX_API_KEY}\n')
  sb.write('.hermes/.env', `MCP_BOX_API_KEY=${KEY}\n`)
  const report = await runDoctor(sb.ctx, {}, {
    probe: async (url) => ({ url, ok: true, status: 401 }),
    check: async () => ({ valid: false, status: 401, error: 'invalid_token' }),
  })
  const cursor = report.clients.find((c) => c.id === 'cursor')
  assert.equal(cursor.ok, false)
  assert.match(cursor.problems.join('\n'), /points at https:\/\/relay.simular.cloud\/old/)
  assert.match(cursor.problems.join('\n'), /box-control/)
  assert.deepEqual(cursor.fixes, ['npx @simular-ai/box connect --client cursor'])
  const hermes = report.clients.find((c) => c.id === 'hermes')
  assert.deepEqual(hermes.key, { configured: true, valid: false, status: 401 })
  assert.ok(hermes.fixes.some((f) => f.includes('--auth key')))
  assert.ok(!JSON.stringify(report).includes(KEY), 'the report never contains the key')
  assert.equal(report.ok, false)
})

function run(args, sb, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { env: { ...sb.env, PATH: `${sb.env.PATH}${path.delimiter}${path.dirname(process.execPath)}`, ...extraEnv }, encoding: 'utf8' })
}

test('real CLI: connect --client cursor,codex --yes in a temp HOME, then remove', () => {
  const sb = sandbox()
  const res = run(['connect', '--client', 'cursor,codex', '--yes'], sb)
  assert.equal(res.status, 0, res.stderr + res.stdout)
  // No `codex` on PATH (the Codex app alone): the hint points at the app's Settings.
  assert.match(res.stdout, /Settings -> MCP servers and click Authenticate next to box/)
  assert.ok(!res.stdout.includes('codex mcp login'), 'does not assume the codex CLI')
  assert.match(res.stdout, /start a new chat \(or restart the app\)/)
  for (const e of EXAMPLE_PROMPTS) assert.ok(res.stdout.includes(e), `shows the example prompt: ${e}`)
  assert.deepEqual(JSON.parse(sb.read('.cursor/mcp.json')), { mcpServers: { box: { url: DEFAULT_MCP_URL } } })
  assert.match(sb.read('.codex/config.toml'), /\[mcp_servers\.box\]\nurl = "https:\/\/relay\.simular\.cloud\/mcp"/)
  const rm = run(['remove', '--client', 'cursor,codex', '--yes'], sb)
  assert.equal(rm.status, 0, rm.stderr)
  assert.ok(!rm.stdout.includes(EXAMPLE_PROMPTS[0]), 'remove shows no example prompts')
  assert.deepEqual(JSON.parse(sb.read('.cursor/mcp.json')), { mcpServers: {} })
})

test('real CLI: key mode without a key fails clearly; with BOX_TOKEN it never prints the key', () => {
  const sb = sandbox()
  sb.write('.hermes/config.yaml', '')
  const noKey = run(['connect', '--client', 'hermes', '--auth', 'key', '--yes'], sb)
  assert.notEqual(noKey.status, 0)
  assert.match(noKey.stderr, /BOX_TOKEN=cb_/)
  const withKey = run(['connect', '--client', 'hermes', '--auth', 'key', '--yes'], sb, { BOX_TOKEN: KEY })
  assert.equal(withKey.status, 0, withKey.stderr)
  assert.ok(!(withKey.stdout + withKey.stderr).includes(KEY))
  // Hermes keeps its home in %LOCALAPPDATA%\\hermes on Windows and ~/.hermes elsewhere.
  const hermesEnv = path.join(path.dirname(findClient('hermes').configLocation(createContext({ env: sb.env }))), '.env')
  assert.match(fs.readFileSync(hermesEnv, 'utf8'), new RegExp(`^MCP_BOX_API_KEY=${KEY}$`, 'm'))
  const bad = run(['connect', '--client', 'hermes', '--auth', 'key', '--yes'], sb, { BOX_TOKEN: 'not-a-key' })
  assert.notEqual(bad.status, 0)
})

test('real CLI: unknown client and missing --client in non-interactive mode', () => {
  const sb = sandbox()
  assert.match(run(['connect', '--client', 'notepad'], sb).stderr, /unknown client/)
  sb.write('.cursor/mcp.json', '{}')
  assert.match(run(['connect'], sb).stderr, /--client cursor/)
})

test('real CLI: example prompts only after something was set up', () => {
  const sb = sandbox()
  assert.equal(EXAMPLE_PROMPTS.length, 3)
  for (const e of EXAMPLE_PROMPTS) assert.match(e, /^Use box to /)
  const dry = run(['connect', '--client', 'cursor', '--yes', '--dry-run'], sb)
  assert.equal(dry.status, 0, dry.stderr)
  assert.ok(!dry.stdout.includes(EXAMPLE_PROMPTS[0]), 'a dry run sets nothing up')
  sb.write('.cursor/mcp.json', '{ not json')
  const broken = run(['connect', '--client', 'cursor', '--yes'], sb)
  assert.notEqual(broken.status, 0)
  assert.ok(!broken.stdout.includes(EXAMPLE_PROMPTS[0]), 'no example prompts when every app failed')
  const doctor = run(['doctor', '--client', 'cursor'], sb)
  assert.ok(!doctor.stdout.includes(EXAMPLE_PROMPTS[0]), 'doctor shows no example prompts')
})

test('real CLI: a config it may not write gets a clear message (and the Codex app steps)', { skip: (process.platform === 'win32' || process.getuid?.() === 0) && 'needs POSIX permissions and a non-root user' }, () => {
  const sb = sandbox()
  sb.write('.codex/config.toml', 'model = "gpt-5"\n')
  fs.chmodSync(path.join(sb.home, '.codex'), 0o500)
  try {
    const res = run(['connect', '--client', 'codex', '--yes'], sb)
    assert.notEqual(res.status, 0)
    const out = res.stdout + res.stderr
    assert.match(out, /could not change .*config\.toml: the file or its folder/)
    assert.match(out, /Settings -> MCP servers -> Add server, name it box, choose Streamable HTTP, paste https:\/\/relay\.simular\.cloud\/mcp/)
    assert.match(out, /click Authenticate next to box/)
  } finally {
    fs.chmodSync(path.join(sb.home, '.codex'), 0o700)
  }
})
