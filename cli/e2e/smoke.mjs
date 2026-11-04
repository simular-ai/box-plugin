// Smoke test of the packed CLI entry point in an isolated HOME: version, help, a dry run that
// must write nothing, and a doctor run that must emit valid JSON.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'
import { isolatedEnv } from './isolated-env.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(root, 'bin', 'simular-box.js')
const { version } = createRequire(import.meta.url)(path.join(root, 'package.json'))
const { home, env } = isolatedEnv()
const run = (...args) => spawn.sync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' })

let r = run('--version')
assert.equal(r.status, 0)
assert.equal(r.stdout.trim(), version)
r = run('--help')
assert.equal(r.status, 0)
assert.match(r.stdout, /npx @simular-ai\/box connect/)

const before = fs.readdirSync(home).sort()
r = run('connect', '--client', 'cursor,codex,opencode,vscode,gemini-cli,hermes', '--yes', '--dry-run')
assert.equal(r.status, 0, r.stderr)
assert.match(r.stdout, /would write/)
assert.deepEqual(fs.readdirSync(home).sort(), before, 'dry run writes nothing')

r = run('doctor', '--client', 'cursor', '--json')
const report = JSON.parse(r.stdout)
assert.equal(report.clients[0].configured, false)
console.log(`smoke OK: simular-box ${version}`)
