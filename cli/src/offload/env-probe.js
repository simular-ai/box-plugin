import fs from 'node:fs'
import path from 'node:path'
import { runSync } from './run.js'

// EnvProbe writes env.json: the versions this computer runs of the tools the repo uses, its package manager, and which
// toolchain files and lockfiles it has (contracts.md "Environment"). Ported from upstream OffloadEnvironment.swift.

export const FILES = [
  '.mise.toml', 'mise.toml', '.tool-versions', '.nvmrc', '.node-version', '.python-version', '.go-version', 'rust-toolchain',
  'rust-toolchain.toml', 'go.mod', 'package.json', 'Cargo.toml', '.devcontainer/devcontainer.json', 'flake.nix', 'shell.nix',
]
export const LOCKFILES = ['go.sum', 'Cargo.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'uv.lock']

const TOOLS = [
  { name: 'go', markers: ['go.mod', 'go.sum', '.go-version'], argv: ['go', 'env', 'GOVERSION'] },
  { name: 'rust', markers: ['Cargo.toml', 'rust-toolchain', 'rust-toolchain.toml'], argv: ['rustc', '-V'] },
  { name: 'node', markers: ['package.json', '.nvmrc', '.node-version', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'], argv: ['node', '-v'] },
  { name: 'python', markers: ['pyproject.toml', 'requirements.txt', 'setup.py', 'uv.lock', '.python-version'], argv: ['python3', '-V'] },
]
const MANAGERS = [
  { lockfile: 'pnpm-lock.yaml', name: 'pnpm', argv: ['pnpm', '-v'] },
  { lockfile: 'yarn.lock', name: 'yarn', argv: ['yarn', '-v'] },
  { lockfile: 'package-lock.json', name: 'npm', argv: ['npm', '-v'] },
  { lockfile: 'uv.lock', name: 'uv', argv: ['uv', '--version'] },
]

export function envJson(top, env) {
  const exists = (name) => fs.existsSync(path.join(top, name))
  const tools = {}
  for (const tool of TOOLS) {
    if (!tool.markers.some(exists)) continue
    const v = version(tool.argv, env)
    if (v) tools[tool.name] = v
  }
  const managers = {}
  let pinned = null
  try {
    pinned = JSON.parse(fs.readFileSync(path.join(top, 'package.json'), 'utf8')).packageManager
  } catch {
    // no package.json
  }
  if (typeof pinned === 'string' && pinned.includes('@')) {
    const at = pinned.indexOf('@')
    managers[pinned.slice(0, at)] = pinned.slice(at + 1).split('+')[0]
  } else {
    for (const m of MANAGERS) {
      if (!exists(m.lockfile)) continue
      const v = version(m.argv, env)
      if (v) managers[m.name] = v
    }
  }
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
  return JSON.stringify({ files: FILES.filter(exists), lockfiles: LOCKFILES.filter(exists), package_managers: sorted(managers), tools: sorted(tools), v: 1 })
}

/** version takes the first version-looking word of a tool's output: go1.26.5, rustc 1.88.0, v22.11.0, Python 3.12.7. */
export function version(argv, env) {
  const r = runSync(argv, { env, timeoutMs: 10000 })
  if (r.status !== 0) return null
  return parseVersion(r.text)
}

export function parseVersion(text) {
  for (const word of text.split(/\s+/)) {
    const trimmed = word.replace(/^[^0-9]+/, '')
    if (/^[0-9]/.test(trimmed) && trimmed.includes('.')) return trimmed
  }
  return null
}
