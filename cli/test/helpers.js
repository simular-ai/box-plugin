import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext } from '../src/context.js'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8')

/** A temporary HOME with an empty bin dir on PATH; nothing outside it is touched. */
export function sandbox({ env = {}, bins = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'box-cli-test-'))
  const bin = path.join(home, '.bin')
  fs.mkdirSync(bin)
  for (const [name, source] of Object.entries(bins)) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o755 })
  }
  // On Windows, libuv copies USERPROFILE (and a few others) from the parent into a child env
  // that lacks them, so point every home-like variable into the sandbox explicitly.
  const fullEnv = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    PATH: bin,
    ...env,
  }
  const ctx = createContext({ env: fullEnv, platform: 'linux' })
  const write = (rel, text, mode) => {
    const file = path.join(home, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, mode ? { mode } : undefined)
    return file
  }
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(home, rel), 'utf8')
    } catch {
      return null
    }
  }
  return { home, ctx, write, read, env: fullEnv }
}

/** Fake `claude`: records calls and keeps plugin / user-scope server state in $HOME. */
export const FAKE_CLAUDE = String.raw`
const fs = require('fs'), path = require('path')
const home = process.env.HOME
const stateFile = path.join(home, 'fake-claude-state.json')
const cfgFile = path.join(home, '.claude.json')
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { marketplaces: [], plugins: {}, calls: [] }
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}
const a = process.argv.slice(2)
state.calls.push(a.join(' '))
const save = () => { fs.writeFileSync(stateFile, JSON.stringify(state)); fs.writeFileSync(cfgFile, JSON.stringify(cfg)) }
const is = (...w) => w.every((x, i) => a[i] === x)
// The marketplace's plugin points at state.latestUrl (default: the current URL); an installed plugin keeps the URL it was installed with until updated.
const latest = () => state.latestUrl || 'https://mcp.box.simular.ai/mcp'
if (is('plugin', 'list')) console.log(JSON.stringify(Object.entries(state.plugins).map(([id, p]) => ({ id, scope: 'user', enabled: p.enabled, mcpServers: { box: { type: 'http', url: p.url } } }))))
else if (is('plugin', 'marketplace', 'list')) console.log(JSON.stringify(state.marketplaces.map((name) => ({ name }))))
else if (is('plugin', 'marketplace', 'add')) state.marketplaces.push('simular-box')
else if (is('plugin', 'install')) { if (!state.marketplaces.includes('simular-box')) { console.error('marketplace not found'); process.exit(1) } state.plugins[a[2]] = { enabled: true, url: latest() } }
else if (is('plugin', 'marketplace', 'update')) {}
else if (is('plugin', 'update')) { if (!state.staleMarketplace) state.plugins[a[2]].url = latest() }
else if (is('plugin', 'enable')) state.plugins[a[2]].enabled = true
else if (is('plugin', 'disable')) state.plugins[a[2]].enabled = false
else if (is('plugin', 'uninstall')) delete state.plugins[a[2]]
else if (is('mcp', 'add')) { cfg.mcpServers = cfg.mcpServers || {}; cfg.mcpServers[a[a.length - 2]] = { type: 'http', url: a[a.length - 1] } }
else if (is('mcp', 'remove')) { if (cfg.mcpServers) delete cfg.mcpServers[a[a.length - 1]] }
else { console.error('unexpected: ' + a.join(' ')); process.exit(2) }
save()
`

/** Fake `openclaw`: like the real one, `mcp show` prints values with ${VAR} substituted from .env. */
export const FAKE_OPENCLAW = String.raw`
const fs = require('fs'), path = require('path')
const dir = path.join(process.env.HOME, '.openclaw')
const file = path.join(dir, 'openclaw.json')
const calls = path.join(process.env.HOME, 'fake-openclaw-calls.log')
const a = process.argv.slice(2)
fs.appendFileSync(calls, a.slice(0, 3).join(' ') + '\n')
const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
const servers = (cfg.mcp && cfg.mcp.servers) || {}
const envText = fs.existsSync(path.join(dir, '.env')) ? fs.readFileSync(path.join(dir, '.env'), 'utf8') : ''
const sub = (s) => s.replace(/\$\{([A-Z_]+)\}/g, (m, k) => { const r = new RegExp('^' + k + '=(.*)$', 'm').exec(envText); return r ? r[1] : m })
const save = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cfg, null, 2)) }
if (a[0] === 'mcp' && a[1] === 'show') { if (!servers[a[2]]) { console.error('unknown'); process.exit(1) } console.log(sub(JSON.stringify(servers[a[2]]))) }
else if (a[0] === 'mcp' && a[1] === 'set') { cfg.mcp = cfg.mcp || {}; cfg.mcp.servers = { ...servers, [a[2]]: JSON.parse(a[3]) }; save(); console.log('Saved MCP server "' + a[2] + '" to ' + file) }
else if (a[0] === 'mcp' && a[1] === 'unset') { delete servers[a[2]]; cfg.mcp.servers = servers; save() }
else if (a[0] === 'mcp' && a[1] === 'reload') {}
else if (a[0] === 'gateway' && a[1] === 'health') process.exit(1)
else { console.error('unexpected: ' + a.join(' ')); process.exit(2) }
`
