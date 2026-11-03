// Layer 2: with a real staging key, prove each headless client can reach box and list its tools.
//   BOX_MCP_URL=<staging> BOX_TOKEN=cb_... node e2e/live.mjs [clients...]
// Uses an isolated HOME. Never prints the key; tool calls are never made.
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'
import { isolatedEnv } from './isolated-env.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(HERE, '..', 'bin', 'simular-box.js')
const url = process.env.BOX_MCP_URL
const key = process.env.BOX_TOKEN
if (!url || !key) throw new Error('set BOX_MCP_URL and BOX_TOKEN')
const clients = process.argv.slice(2).length ? process.argv.slice(2) : ['hermes', 'openclaw']

// Skip, loudly, when this runner can't reach the endpoint at all (e.g. a staging host that only
// resolves to a private address): that is a setup choice, not a box or CLI failure.
function skip(why) {
  const msg = `Live checks skipped: ${why}. Options: run against prod with a dedicated test key, use a self-hosted runner inside the network, or expose a public staging MCP host.`
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=Live checks skipped::${msg}` : msg)
  process.exit(0)
}
const { hostname } = new URL(url)
let addrs
try {
  addrs = await dns.lookup(hostname, { all: true })
} catch (err) {
  skip(`${hostname} does not resolve here (${err.code})`)
}
const isPrivate = (ip) => net.isIPv4(ip) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
if (addrs.every((a) => isPrivate(a.address))) skip(`${hostname} resolves only to private addresses (${addrs.map((a) => a.address).join(', ')})`)
try {
  await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000) })
} catch (err) {
  skip(`${url} is unreachable from this runner (${err.cause?.code || err.name})`)
}

const { env } = isolatedEnv(process.env, { keep: ['BOX_MCP_URL', 'BOX_TOKEN'] })
const scrub = (s) => s.split(key).join('***')
function sh(bin, args, { allowFail = false } = {}) {
  const res = spawn.sync(bin, args, { env, encoding: 'utf8', timeout: 180000 })
  const out = scrub(`${res.stdout || ''}${res.stderr || ''}`)
  console.log(`$ ${bin} ${args.join(' ')}  (exit ${res.status})\n${out.trim().split('\n').map((l) => `  ${l}`).join('\n')}`)
  if (!allowFail && res.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed`)
  return out
}

sh(process.execPath, [path.join(HERE, 'mcp-tools.mjs')])
sh(process.execPath, [CLI, 'connect', '--client', clients.join(','), '--auth', 'key', '--yes'])
const report = JSON.parse(sh(process.execPath, [CLI, 'doctor', '--client', clients.join(','), '--json'], { allowFail: true }))
assert.equal(report.endpoint.ok, true, 'endpoint answers 401 + metadata')
for (const row of report.clients) {
  assert.equal(row.key?.valid, true, `${row.name}: the key is valid`)
  assert.equal(row.ok, true, `${row.name}: doctor is clean (${row.problems.join('; ')})`)
}
if (clients.includes('openclaw')) {
  const out = sh('openclaw', ['mcp', 'probe', 'box'])
  assert.match(out, /box: [1-9]\d* tools/, 'openclaw lists box tools')
}
if (clients.includes('hermes')) {
  const out = sh('hermes', ['mcp', 'test', 'box'])
  assert.match(out, /tools? (discovered|found)|✓ Connected/i, 'hermes connects and lists tools')
}
console.log('\nOK: live checks passed')
