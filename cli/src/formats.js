// Parsing and the format-preserving edits add-mcp does not cover for us (Codex TOML, Hermes YAML,
// .env files). We change only the keys we own and keep comments, ordering and every other server.
import * as jsonc from 'jsonc-parser'
import * as TOML from 'smol-toml'
import YAML from 'yaml'

/** Parse JSON or JSONC. Throws on a file we cannot parse: never overwrite what we can't read. */
export function parseJsonc(text, file = 'config') {
  if (text === null || text.trim() === '') return {}
  const errors = []
  const value = jsonc.parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length) {
    const e = errors[0]
    throw new Error(`${file} is not valid JSON (${jsonc.printParseErrorCode(e.error)} at offset ${e.offset}); fix it or move it aside, then run again`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} does not hold a JSON object; fix it or move it aside, then run again`)
  }
  return value
}

export function getPath(obj, jsonPath) {
  let cur = obj
  for (const key of jsonPath) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

/** Equal for config purposes (key order ignored). */
export function sameValue(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  }
  return v
}

// ---- dotenv files (KEY=value lines) ----

const envLine = (name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, 'm')

export function readEnvValue(text, name) {
  if (!text) return undefined
  const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`, 'm').exec(text)
  if (!m) return undefined
  return m[1].trim().replace(/^(['"])(.*)\1$/, '$2')
}

/** Set NAME=value, replacing an existing line in place and keeping every other line. */
export function upsertEnvValue(text, name, value) {
  const line = `${name}=${value}`
  if (text && envLine(name).test(text)) {
    if (readEnvValue(text, name) === value) return text
    return text.replace(envLine(name), () => line)
  }
  const base = text ? text.replace(/\n*$/, '\n') : ''
  return `${base}${line}\n`
}

export function removeEnvValue(text, name) {
  if (!text || !envLine(name).test(text)) return text
  return text.replace(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*(?:\\r?\\n|$)`, 'm'), '')
}

// ---- TOML (Codex): surgical table edits, so comments and formatting elsewhere survive ----


export function parseToml(text, file = 'config.toml') {
  if (!text || !text.trim()) return {}
  try {
    return TOML.parse(text)
  } catch (err) {
    throw new Error(`${file} is not valid TOML (${err.message.split('\n')[0]}); fix it or move it aside, then run again`)
  }
}

function splitDotted(key) {
  const parts = []
  let cur = ''
  let quote = null
  for (const ch of key) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '.') {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  parts.push(cur.trim())
  return parts
}

const HEADER = /^\s*\[(\[?)\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?\r?$/

/**
 * Remove `[table]` blocks whose key path starts with any of `prefixes` (arrays of key parts), or
 * equals one of them when `exact`. Comment and blank lines just above a table we keep stay with
 * that table (they usually describe it).
 */
export function removeTomlTables(text, prefixes, { exact = false } = {}) {
  if (!text) return text
  const lines = text.split('\n') // a CRLF line keeps its \r, which HEADER tolerates
  const out = []
  let dropping = false
  let pending = [] // comment/blank lines seen while dropping; kept if a kept table follows
  for (const line of lines) {
    const m = HEADER.exec(line)
    if (m) {
      const parts = splitDotted(m[2])
      const wasDropping = dropping
      dropping = prefixes.some((pre) => (exact ? pre.length === parts.length : true) && pre.every((p, i) => parts[i] === p))
      if (wasDropping && !dropping) {
        const blank = (l) => /^\s*\r?$/.test(l)
        if (!out.length || blank(out[out.length - 1])) while (pending.length && blank(pending[0])) pending.shift()
        out.push(...pending)
      }
      pending = []
    }
    if (!dropping) out.push(line)
    else if (/^\s*(#.*)?\r?$/.test(line)) pending.push(line)
    else pending = []
  }
  // A dropped block at the end also drops the file's final newline: restore it.
  const eol = /\r\n/.test(text) ? '\r\n' : '\n'
  let result = out.join('\n').replace(/\r$/, '')
  if (/\n$/.test(text) && !/\n$/.test(result) && result) result += eol
  return result
}

const tomlString = (s) => JSON.stringify(s)

/** Keys that select how Codex connects; anything else on our table (timeouts, tool lists) is kept. */
const CONNECTION_KEYS = new Set(['url', 'command', 'args', 'env', 'cwd', 'bearer_token', 'bearer_token_env_var', 'http_headers', 'env_http_headers'])

/**
 * Set `[mcp_servers.<name>]` so it connects with `fields`, removing legacy names. Other settings
 * on the table and its subtables (e.g. tool approvals) are kept. The caller checks that an
 * existing table is ours. Throws when the server is defined in a way we can't edit safely.
 */
export function upsertTomlServer(text, name, fields, { legacy = [], file } = {}) {
  const doc = parseToml(text, file)
  const current = doc.mcp_servers?.[name]
  const kept = {}
  for (const [k, v] of Object.entries(current || {})) {
    if (!CONNECTION_KEYS.has(k) && (v === null || typeof v !== 'object' || Array.isArray(v) || v instanceof Date)) kept[k] = v
  }
  const connection = Object.fromEntries(Object.entries(current || {}).filter(([k]) => CONNECTION_KEYS.has(k)))
  const hasLegacy = legacy.some((n) => doc.mcp_servers?.[n] !== undefined)
  if (current && sameValue(connection, fields) && !hasLegacy) return text
  let out = removeTomlTables(text || '', [['mcp_servers', name]], { exact: true })
  out = removeTomlTables(out, legacy.map((n) => ['mcp_servers', n]))
  const check = parseToml(out, file)
  for (const n of legacy) {
    if (check.mcp_servers?.[n] !== undefined) throw new Error(`${file} defines mcp_servers.${n} inline; remove it by hand, then run again`)
  }
  const leftover = check.mcp_servers?.[name]
  if (leftover && Object.values(leftover).some((v) => v === null || typeof v !== 'object' || Array.isArray(v))) {
    throw new Error(`${file} defines mcp_servers.${name} inline or with dotted keys; remove it by hand, then run again`)
  }
  // Keep the file's line endings (CRLF on Windows-edited files).
  const eol = /\r\n/.test(text || '') ? '\r\n' : '\n'
  const keptLines = Object.keys(kept).length ? TOML.stringify(kept).trim().split(/\r?\n/) : []
  const body = [...Object.entries(fields).map(([k, v]) => `${k} = ${tomlString(v)}`), ...keptLines].join(eol)
  out = `${out.replace(/\s*$/, '')}${out.trim() ? eol + eol : ''}[mcp_servers.${name}]${eol}${body}${eol}`
  const final = parseToml(out, file)
  const got = Object.fromEntries(Object.entries(final.mcp_servers?.[name] || {}).filter(([k]) => CONNECTION_KEYS.has(k)))
  if (!sameValue(got, fields)) throw new Error(`could not update ${file} safely; nothing was written`)
  return out
}

export function removeTomlServers(text, names, { file } = {}) {
  if (!text) return text
  const doc = parseToml(text, file)
  if (!names.some((n) => doc.mcp_servers?.[n] !== undefined)) return text
  const out = removeTomlTables(text, names.map((n) => ['mcp_servers', n])).replace(/(\r?\n){3,}/g, (m) => (m.includes('\r') ? '\r\n\r\n' : '\n\n'))
  const check = parseToml(out, file)
  for (const n of names) {
    if (check.mcp_servers?.[n] !== undefined) throw new Error(`${file} defines mcp_servers.${n} inline; remove it by hand`)
  }
  return out
}

// ---- YAML (Hermes): Document API keeps comments and key order ----


export function parseYamlDoc(text, file = 'config.yaml') {
  const doc = YAML.parseDocument(text || '')
  if (doc.errors.length) throw new Error(`${file} is not valid YAML (${doc.errors[0].message.split('\n')[0]}); fix it or move it aside, then run again`)
  const root = doc.toJS()
  if (root !== null && root !== undefined && (typeof root !== 'object' || Array.isArray(root))) {
    throw new Error(`${file} does not hold a YAML mapping`)
  }
  return doc
}

export function upsertYamlServer(text, containerKey, name, entry, { legacy = [], file } = {}) {
  const doc = parseYamlDoc(text, file)
  const js = doc.toJS() || {}
  const servers = js[containerKey] || {}
  const hasLegacy = legacy.some((n) => servers[n] !== undefined)
  if (sameValue(servers[name], entry) && !hasLegacy) return text
  if (!doc.contents) doc.contents = doc.createNode({})
  doc.setIn([containerKey, name], doc.createNode(entry))
  for (const n of legacy) if (servers[n] !== undefined) doc.deleteIn([containerKey, n])
  return String(doc)
}

export function removeYamlServers(text, containerKey, names, { file } = {}) {
  if (!text) return text
  const doc = parseYamlDoc(text, file)
  const servers = (doc.toJS() || {})[containerKey] || {}
  if (!names.some((n) => servers[n] !== undefined)) return text
  for (const n of names) if (servers[n] !== undefined) doc.deleteIn([containerKey, n])
  return String(doc)
}

export function readYaml(text, file) {
  return parseYamlDoc(text, file).toJS() || {}
}
