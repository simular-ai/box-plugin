// Our interface to add-mcp (https://github.com/neon-solutions/add-mcp, Apache-2.0), which knows
// where each client keeps its MCP servers and in what shape. The version is pinned exactly in
// package.json; bump it only after the install matrix passes. If add-mcp is ever replaced, this
// file is the only one that changes.
//
// add-mcp runs in a child process (add-mcp-worker.js) with the context's environment, because it
// reads HOME and the client's env overrides once, at import. That keeps tests in their temporary
// HOME and keeps the paths add-mcp writes the same ones the rest of the CLI reads.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'add-mcp-worker.js')

/** add-mcp reports failures as messages; keep permission problems recognisable for the CLI. */
export function writeError(message, file) {
  const err = new Error(message)
  if (/\bEACCES\b|\bEPERM\b|permission denied|access is denied|operation not permitted/i.test(message)) {
    err.code = /\bEPERM\b|operation not permitted/i.test(message) ? 'EPERM' : 'EACCES'
    err.path = file
  }
  return err
}

function call(ctx, agent, name, ops) {
  const res = spawnSync(process.execPath, [WORKER], {
    env: ctx.env,
    input: JSON.stringify({ agent, name, url: ctx.url, ops }),
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  })
  let out
  try {
    out = JSON.parse(res.stdout)
  } catch {
    throw new Error(`add-mcp failed: ${(res.stderr || String(res.error || `exit ${res.status}`)).trim().split('\n').pop()}`)
  }
  if (out.error) throw writeError(out.error)
  return out.results
}

/**
 * Where `agent` keeps its servers and what add-mcp would write for box there:
 * {path, format, configKey, entry, servers: [{name, configKey, config}]}. Reads only.
 */
export function inspect(ctx, agent, name = ctx.name) {
  return call(ctx, agent, name, [{ op: 'inspect' }])[0]
}

/** Write box under `name` and remove `drop` (names the caller has checked are ours). */
export function apply(ctx, agent, { name = ctx.name, upsert = true, drop = [] } = {}) {
  const ops = [...(upsert ? [{ op: 'upsert', name }] : []), ...drop.map((n) => ({ op: 'remove', name: n }))]
  if (!ops.length) return
  for (const r of call(ctx, agent, name, ops)) {
    if (r.success === false) throw writeError(`could not update ${r.path || agent}: ${r.error}`, r.path)
  }
}
