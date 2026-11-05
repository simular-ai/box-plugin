// Layer 3: an agent plays a new user onboarding box on a box, then a separate judge reviews the recording.
//   BOX_TOKEN=cb_... node e2e/layer3/run.mjs <cell>            reset, drive, extract, judge
//   node e2e/layer3/run.mjs --judge <runDir>                     judge an existing run again
// Needs a signed-in `claude` CLI on this machine. Recordings hold the test account's screen, so they
// are written outside the repo (LAYER3_RUNS_DIR, default ~/.box-layer3/runs) and never committed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'
import { DEFAULT_MCP_URL } from '../../src/constants.js'
import { connectMcp } from '../mcp-client.mjs'
import { extractRun } from './extract.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER = 'box'
const DRIVER_TOOLS = ['screenshot', 'computer_act', 'computer_state']
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8')
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
const writeJson = (dir, name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2) + '\n')

function claude(args, { cwd, env, stdoutFile }) {
  const out = stdoutFile ? fs.openSync(stdoutFile, 'w') : 'pipe'
  const res = spawn.sync('claude', args, { cwd, env, stdio: ['ignore', out, 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 })
  if (stdoutFile) fs.closeSync(out)
  if (res.error) throw res.error
  return res
}

function textOf(result) {
  return (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

async function drive(cellName) {
  const cells = JSON.parse(read('cells.json'))
  const cell = cells[cellName]
  if (!cell) throw new Error(`unknown cell "${cellName}". Cells: ${Object.keys(cells).filter((k) => k !== '//').join(', ')}`)
  const key = process.env.BOX_TOKEN
  if (!key) throw new Error('set BOX_TOKEN to a box key for the test account (https://box.simular.ai/keys)')
  const url = process.env.BOX_MCP_URL || DEFAULT_MCP_URL

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${cellName}`
  const runDir = path.join(process.env.LAYER3_RUNS_DIR || path.join(os.homedir(), '.box-layer3', 'runs'), runId)
  fs.mkdirSync(runDir, { recursive: true })
  const run = { runId, cell: { name: cellName, ...cell }, mcpUrl: url, account: process.env.LAYER3_ACCOUNT || 'test-account', startedAt: new Date().toISOString(), funnel: 'unavailable' }
  const finish = (extra) => {
    Object.assign(run, extra, { endedAt: new Date().toISOString() })
    writeJson(runDir, 'run.json', run)
    return runDir
  }

  const mcp = await connectMcp(url, key, { clientName: 'box-layer3-harness' })
  const toolNames = (await mcp.listTools()).map((t) => t.name)
  const missing = [...DRIVER_TOOLS, 'shell'].filter((t) => !toolNames.includes(t))
  if (missing.length) return finish({ blocked: `box MCP server lacks tools: ${missing.join(', ')}` })

  const log = []
  for (const command of [...cell.reset, cell.precheck]) {
    const res = await mcp.callTool('shell', { command, timeout_s: 300 })
    log.push(`$ ${command}\n${textOf(res)}`)
  }
  fs.writeFileSync(path.join(runDir, 'reset.log'), log.join('\n\n') + '\n')
  run.clientVersion = log.at(-2)?.split('\n')[1]?.trim()
  if (!/\bOK\b/.test(log.at(-1))) return finish({ blocked: `precheck failed. ${cell.precheckHelp}` })

  writeJson(runDir, 'mcp.json', { mcpServers: { [SERVER]: { type: 'http', url, headers: { Authorization: 'Bearer ${BOX_TOKEN}' } } } })
  const allowed = DRIVER_TOOLS.map((t) => `mcp__${SERVER}__${t}`)
  const denied = toolNames.filter((t) => !DRIVER_TOOLS.includes(t)).map((t) => `mcp__${SERVER}__${t}`)
  const prompt = fill(read('driver.md'), cell)
  const driverArgs = [
    '-p', prompt,
    '--mcp-config', path.join(runDir, 'mcp.json'), '--strict-mcp-config',
    '--tools', '',
    '--allowedTools', allowed.join(','),
    '--disallowedTools', denied.join(','),
    '--output-format', 'stream-json', '--verbose',
    '--max-turns', process.env.LAYER3_MAX_TURNS || '150',
    '--max-budget-usd', process.env.LAYER3_MAX_USD || '10',
    '--no-session-persistence',
    ...(process.env.LAYER3_DRIVER_MODEL ? ['--model', process.env.LAYER3_DRIVER_MODEL] : []),
  ]
  console.log(`driving ${cellName} on ${url} (recording to ${runDir})`)
  const transcript = path.join(runDir, 'transcript.jsonl')
  const res = claude(driverArgs, { cwd: runDir, env: { ...process.env, BOX_TOKEN: key }, stdoutFile: transcript })
  fs.writeFileSync(transcript, fs.readFileSync(transcript, 'utf8').split(key).join('***'))
  if (res.stderr) fs.writeFileSync(path.join(runDir, 'driver.stderr'), res.stderr.split(key).join('***'))

  const { steps, final } = extractRun(runDir)
  return finish({ driver: { exit: res.status, model: process.env.LAYER3_DRIVER_MODEL || 'default', steps: steps.length, ...final } })
}

function judge(runDir) {
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'))
  if (run.blocked) {
    const verdict = { verdict: 'blocked', reasons: [{ text: run.blocked, steps: [] }], workarounds: [], improvements: [] }
    writeJson(runDir, 'judge.json', verdict)
    return verdict
  }
  const res = claude([
    '-p', fill(read('judge.md'), { runDir }),
    '--tools', 'Read,Glob,Grep',
    '--allowedTools', 'Read,Glob,Grep',
    '--add-dir', runDir,
    '--strict-mcp-config',
    '--output-format', 'json',
    '--json-schema', read('judge.schema.json'),
    '--no-session-persistence',
    ...(process.env.LAYER3_JUDGE_MODEL ? ['--model', process.env.LAYER3_JUDGE_MODEL] : []),
  ], { cwd: runDir, env: process.env })
  if (res.status !== 0) throw new Error(`judge exited ${res.status}: ${res.stderr || res.stdout}`)
  const out = JSON.parse(res.stdout)
  const verdict = out.structured_output ?? JSON.parse(out.result)
  writeJson(runDir, 'judge.json', verdict)
  return verdict
}

const argv = process.argv.slice(2)
const runDir = argv[0] === '--judge' ? path.resolve(argv[1]) : await drive(argv[0] || 'claude-code-landing')
const verdict = judge(runDir)
console.log(`${verdict.verdict.toUpperCase()}  ${runDir}`)
for (const r of verdict.reasons) console.log(`  - ${r.text} (steps ${r.steps.join(', ') || 'none'})`)
for (const imp of verdict.improvements) console.log(`  * [${imp.target}] ${imp.title}`)
process.exitCode = verdict.verdict === 'pass' ? 0 : verdict.verdict === 'blocked' ? 2 : 1
