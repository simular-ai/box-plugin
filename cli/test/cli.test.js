import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../src/args.js'
import { mcpUrl, maskKey, isOldUrl, isOurUrl, DEFAULT_MCP_URL, EXAMPLE_PROMPTS, connectCommand } from '../src/constants.js'
import { parseWwwAuthenticate, probeEndpoint, checkKey, lookupHost, proxyFromEnv } from '../src/probe.js'
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

test('probe: metadata naming another resource fails (what the old relay address now returns)', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('.well-known')) return new Response(JSON.stringify({ resource: 'https://mcp.box.simular.ai/mcp', authorization_servers: ['https://mcp.box.simular.ai'] }), { status: 200 })
    return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.box.simular.ai/.well-known/oauth-protected-resource/mcp"' } })
  }
  const old = await probeEndpoint('https://relay.simular.cloud/mcp', { fetchImpl })
  assert.equal(old.ok, false)
  assert.match(old.error, /names https:\/\/mcp\.box\.simular\.ai\/mcp, not https:\/\/relay\.simular\.cloud\/mcp/)
  assert.equal((await probeEndpoint('https://mcp.box.simular.ai/mcp', { fetchImpl })).ok, true)
  assert.equal((await probeEndpoint('https://mcp.box.simular.ai/mcp/', { fetchImpl })).ok, true, 'a trailing slash is the same resource')
})

test('url: the old relay address is ours but outdated; staging is not', () => {
  assert.equal(DEFAULT_MCP_URL, 'https://mcp.box.simular.ai/mcp')
  for (const u of ['https://relay.simular.cloud/mcp', 'https://staging.relay.simular.cloud/mcp', DEFAULT_MCP_URL]) assert.ok(isOurUrl(u, DEFAULT_MCP_URL), u)
  assert.equal(isOurUrl('https://mcp.box.com', DEFAULT_MCP_URL), false)
  assert.equal(isOldUrl('https://relay.simular.cloud/mcp', DEFAULT_MCP_URL), true)
  assert.equal(isOldUrl('https://staging.relay.simular.cloud/mcp', DEFAULT_MCP_URL), false)
  assert.equal(isOldUrl(DEFAULT_MCP_URL, DEFAULT_MCP_URL), false)
  assert.equal(isOldUrl('https://relay.simular.cloud/mcp', 'https://relay.simular.cloud/mcp'), false, 'not outdated when BOX_MCP_URL points there')
  assert.equal(isOldUrl('not a url', DEFAULT_MCP_URL), false)
})

test('doctor: flags a stale URL, a legacy server and a rejected key, with fixes', async () => {
  const sb = sandbox()
  sb.write('.cursor/mcp.json', JSON.stringify({ mcpServers: { box: { url: 'https://relay.simular.cloud/old' }, 'box-control': { url: 'https://relay.simular.cloud/control' } } }))
  sb.write('.hermes/config.yaml', 'mcp_servers:\n  box:\n    url: https://relay.simular.cloud/mcp\n    headers:\n      Authorization: Bearer ${MCP_BOX_API_KEY}\n')
  sb.write('.hermes/.env', `MCP_BOX_API_KEY=${KEY}\n`)
  const report = await runDoctor(sb.ctx, {}, {
    probe: async (url) => ({ url, ok: true, status: 401 }),
    check: async () => ({ valid: false, status: 401, error: 'invalid_token' }),
    resolve: async (url) => ({ host: new URL(url).hostname, ok: true, address: '203.0.113.1', error: null }),
  })
  const cursor = report.clients.find((c) => c.id === 'cursor')
  assert.equal(cursor.ok, false)
  assert.match(cursor.problems.join('\n'), /points at https:\/\/relay.simular.cloud\/old, box's old address/)
  assert.match(cursor.problems.join('\n'), /box-control/)
  assert.deepEqual(cursor.fixes, ['npx @simular-ai/box connect --client cursor'])
  const hermes = report.clients.find((c) => c.id === 'hermes')
  assert.match(hermes.problems.join('\n'), /relay\.simular\.cloud\/mcp, box's old address, which no longer signs in; box is now at https:\/\/mcp\.box\.simular\.ai\/mcp/)
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
  assert.match(sb.read('.codex/config.toml'), /\[mcp_servers\.box\]\nurl = "https:\/\/mcp\.box\.simular\.ai\/mcp"/)
  const rm = run(['remove', '--client', 'cursor,codex', '--yes'], sb)
  assert.equal(rm.status, 0, rm.stderr)
  assert.ok(!rm.stdout.includes(EXAMPLE_PROMPTS[0]), 'remove shows no example prompts')
  assert.deepEqual(JSON.parse(sb.read('.cursor/mcp.json')), { mcpServers: {} })
})

test('real CLI: connect moves old relay entries to the new URL and says to sign in again; remove takes either', () => {
  const sb = sandbox()
  sb.write('.cursor/mcp.json', JSON.stringify({ mcpServers: { box: { url: 'https://relay.simular.cloud/mcp' }, 'box-control': { url: 'https://relay.simular.cloud/control' }, other: { url: 'https://example.com/mcp' } } }))
  sb.write('.codex/config.toml', '[mcp_servers.box]\nurl = "https://relay.simular.cloud/mcp"\n')
  const res = run(['connect', '--client', 'cursor,codex', '--yes'], sb)
  assert.equal(res.status, 0, res.stderr + res.stdout)
  assert.match(res.stdout, /Cursor: wrote box/)
  assert.match(res.stdout, /box moved from https:\/\/relay\.simular\.cloud\/mcp to https:\/\/mcp\.box\.simular\.ai\/mcp\. Cursor may ask you to sign in to box again/)
  assert.match(res.stdout, /Codex may ask you to sign in to box again/)
  assert.deepEqual(JSON.parse(sb.read('.cursor/mcp.json')).mcpServers, { other: { url: 'https://example.com/mcp' }, box: { url: DEFAULT_MCP_URL } })
  assert.match(sb.read('.codex/config.toml'), /url = "https:\/\/mcp\.box\.simular\.ai\/mcp"/)
  const again = run(['connect', '--client', 'cursor,codex', '--yes'], sb)
  assert.ok(!again.stdout.includes('sign in to box again'), 'a re-run says nothing about moving')

  // remove takes an entry at the old address too.
  sb.write('.cursor/mcp.json', JSON.stringify({ mcpServers: { box: { url: 'https://relay.simular.cloud/mcp' } } }))
  assert.equal(run(['remove', '--client', 'cursor', '--yes'], sb).status, 0)
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
    assert.match(out, /Settings -> MCP servers -> Add server, name it box, choose Streamable HTTP, paste https:\/\/mcp\.box\.simular\.ai\/mcp/)
    assert.match(out, /click Authenticate next to box/)
  } finally {
    fs.chmodSync(path.join(sb.home, '.codex'), 0o700)
  }
})

// simular-ai/box-portal#179: inside Codex's sandbox ~/.codex is read-only. Say so at once, with the command to run instead.
test('real CLI: in an agent sandbox, an unwritable config fails fast with the command to run in a normal terminal', { skip: (process.platform === 'win32' || process.getuid?.() === 0) && 'needs POSIX permissions and a non-root user' }, () => {
  const sb = sandbox()
  sb.write('.codex/config.toml', 'model = "gpt-5"\n')
  fs.chmodSync(path.join(sb.home, '.codex'), 0o500)
  try {
    const started = Date.now()
    const res = run(['connect', '--client', 'codex', '--yes'], sb, { CODEX_SANDBOX: 'seatbelt' })
    assert.ok(Date.now() - started < 10000, 'fails fast')
    assert.notEqual(res.status, 0)
    const out = res.stdout + res.stderr
    const lines = res.stdout.split('\n').filter((l) => /\w/.test(l))
    assert.match(lines[0], /box -> /)
    assert.match(lines[1], /Codex: setting up box/, 'a progress line comes right after the intro')
    assert.match(out, /can't write .*config\.toml \(EACCES\)/)
    assert.match(out, /This looks like an AI agent's sandbox .*Run this command in a normal terminal instead: npx -y @simular-ai\/box connect --client codex --yes/)
    assert.ok(!out.includes('Add server'), "no Codex app steps: they don't help inside the sandbox")
    assert.equal(sb.read('.codex/config.toml'), 'model = "gpt-5"\n')
  } finally {
    fs.chmodSync(path.join(sb.home, '.codex'), 0o700)
  }
})

// simular-ai/box-portal#191: doctor's HTTPS check can work through a proxy while the apps' own DNS lookup fails.
test('doctor: flags a DNS lookup that fails while the HTTPS check works (a proxy), without the proxy password', async () => {
  const sb = sandbox({ env: { HTTPS_PROXY: 'http://user:s3cret@127.0.0.1:3128' } })
  const report = await runDoctor(sb.ctx, {}, {
    probe: async (url) => ({ url, ok: true, status: 401 }),
    resolve: async (url) => ({ host: new URL(url).hostname, ok: false, address: null, error: 'ENOTFOUND' }),
  })
  assert.equal(report.ok, false)
  assert.deepEqual(report.dns, { host: 'mcp.box.simular.ai', ok: false, address: null, error: 'ENOTFOUND', proxy: 'HTTPS_PROXY=http://127.0.0.1:3128', proxiedOnly: true })
  assert.ok(!JSON.stringify(report).includes('s3cret'))
  assert.equal(proxyFromEnv({}), null)
})

test('lookupHost: a plain lookup of the endpoint host; failures and timeouts come back as codes', async () => {
  assert.deepEqual(await lookupHost('https://mcp.box.simular.ai/mcp', { lookup: async (h) => ({ address: h === 'mcp.box.simular.ai' ? '203.0.113.1' : '' }) }), { host: 'mcp.box.simular.ai', ok: true, address: '203.0.113.1', error: null })
  const notFound = await lookupHost('https://mcp.box.simular.ai/mcp', { lookup: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }) } })
  assert.equal(notFound.error, 'ENOTFOUND')
  const slow = await lookupHost('https://mcp.box.simular.ai/mcp', { lookup: () => new Promise(() => {}), timeoutMs: 20 })
  assert.equal(slow.error, 'ETIMEOUT')
})

test('real CLI: doctor prints its first line, then names a failed DNS lookup', () => {
  const sb = sandbox()
  const res = run(['doctor', '--client', 'cursor'], sb, { BOX_MCP_URL: 'https://box-doctor-test.invalid/mcp' })
  assert.notEqual(res.status, 0)
  assert.match(res.stdout, /box doctor/)
  assert.match(res.stdout, /DNS: this computer can't look up box-doctor-test\.invalid \(ENOTFOUND\)/)
})

// simular-ai/box-portal#195, end to end: one message, not the generic "file may belong to another user".
test('real CLI: connect --client openclaw while OpenClaw holds its lock prints one quit-then-run message', { skip: process.platform === 'win32' && 'fake CLIs are shebang scripts' }, async () => {
  const { FAKE_OPENCLAW } = await import('./helpers.js')
  const locked = FAKE_OPENCLAW.replace("else if (a[0] === 'mcp' && a[1] === 'set') {", "else if (a[0] === 'mcp' && a[1] === 'set') { console.error('Error: config is locked by a running OpenClaw session'); process.exit(1) }\nelse if (false) {")
  const sb = sandbox({ bins: { openclaw: locked } })
  const res = run(['connect', '--client', 'openclaw', '--yes'], sb)
  assert.notEqual(res.status, 0)
  const out = res.stdout + res.stderr
  assert.match(out, /OpenClaw is running and holds its config lock.*Type `\/exit` to quit OpenClaw/)
  assert.ok(!out.includes('could not change'), 'no generic permission advice')
  assert.ok(!out.includes('Use box to open Chrome'), 'no example prompts: nothing was set up')
})

test('connectCommand: keeps BOX_MCP_URL (quoted), --name and --auth key', () => {
  assert.equal(connectCommand({ url: DEFAULT_MCP_URL, name: 'box', platform: 'linux' }, 'codex'), 'npx -y @simular-ai/box connect --client codex --yes')
  assert.equal(connectCommand({ url: 'https://x.test/mcp?a=1&b=2', name: 'simular-box', platform: 'darwin' }, 'openclaw', { mode: 'key' }), "BOX_MCP_URL='https://x.test/mcp?a=1&b=2' npx -y @simular-ai/box connect --client openclaw --name simular-box --auth key --yes")
  assert.equal(connectCommand({ url: 'https://x.test/mcp', name: 'box', platform: 'win32' }, 'codex'), "$env:BOX_MCP_URL='https://x.test/mcp'; npx -y @simular-ai/box connect --client codex --yes")
})
