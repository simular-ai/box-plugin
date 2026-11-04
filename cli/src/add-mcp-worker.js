// Runs add-mcp in a child process; only config-writer.js starts it.
// add-mcp resolves every config path from os.homedir() and process.env once, when it is imported,
// so it runs in a process whose environment is the CLI context's (tests use a temporary HOME).
// Request on stdin: {agent, name, url, ops: [{op: 'inspect' | 'upsert' | 'remove', name?}]}.
// Reply on stdout: {results: [...]} or {error}. Never pass a secret: none is needed here.
import fs from 'node:fs'
import * as jsonc from 'jsonc-parser'
import { agents, listInstalledServers, removeServer, upsertServer } from 'add-mcp'

function configPath(agent) {
  return agent.resolveConfigPath ? agent.resolveConfigPath(agent, { local: false, cwd: process.cwd() }) : agent.configPath
}

// OpenCode keeps servers under `mcp` (V1) or `mcp.servers` (V2). add-mcp writes a new server into
// `mcp.servers` when the file has that map (even empty) and no V1 servers; mirror that here.
function openCodeKey(file, servers) {
  if (servers.some((s) => s.configKey === 'mcp')) return 'mcp'
  if (servers.length) return servers[0].configKey
  if (!fs.existsSync(file)) return 'mcp'
  const map = jsonc.parse(fs.readFileSync(file, 'utf8'), [], { allowTrailingComma: true })?.mcp?.servers
  return map && typeof map === 'object' && !Array.isArray(map) ? 'mcp.servers' : 'mcp'
}

async function inspect(agentId, name, url) {
  const agent = agents[agentId]
  const file = configPath(agent)
  let servers = []
  if (fs.existsSync(file)) {
    const [read] = await listInstalledServers({ global: true, agents: [agentId] })
    if (read.error) throw new Error(read.error)
    if (!read.detected) throw new Error(`add-mcp did not read ${file}`)
    servers = read.servers.map((s) => ({ name: s.serverName, configKey: s.configKey, config: s.config }))
  }
  const existing = servers.find((s) => s.name === name)
  const configKey = existing?.configKey ?? (agentId === 'opencode' ? openCodeKey(file, servers) : agent.configKey)
  const entry = agent.transformConfig(name, { type: 'http', url }, { local: false, configKey })
  return { path: file, format: agent.format, configKey, entry: JSON.parse(JSON.stringify(entry)), servers }
}

async function run(req) {
  if (!Object.prototype.hasOwnProperty.call(agents, req.agent)) throw new Error(`add-mcp does not know ${req.agent}`)
  const results = []
  for (const step of req.ops) {
    const name = step.name ?? req.name
    if (step.op === 'inspect') results.push(await inspect(req.agent, name, req.url))
    else if (step.op === 'upsert') results.push(upsertServer(req.agent, name, { type: 'http', url: req.url }))
    else if (step.op === 'remove') results.push(removeServer(req.agent, name))
    else throw new Error(`unknown op ${step.op}`)
    const last = results[results.length - 1]
    if (last.success === false) break
  }
  return results
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', async () => {
  try {
    process.stdout.write(JSON.stringify({ results: await run(JSON.parse(input)) }))
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err.message, code: err.code }))
  }
})
