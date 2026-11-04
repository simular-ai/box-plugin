// Clients whose MCP config file add-mcp writes (../config-writer.js knows where and in what shape).
// What stays here is specific to box: only an entry whose URL is box by Simular is ours to replace
// or remove, a file we cannot parse is never touched, old box-control entries go, the previous
// file is kept as a backup, and the result is read back after add-mcp writes it.
import fs from 'node:fs'
import { ForeignServerError, LEGACY_SERVER_NAMES } from '../constants.js'
import { readText, saveBackup, writeAtomic } from '../fsutil.js'
import { getPath, parseJsonc, sameValue } from '../formats.js'
import * as writer from '../config-writer.js'

const entryUrl = (e) => e?.url ?? e?.serverUrl ?? e?.httpUrl

/**
 * @param {object} spec
 * @param {string} spec.id                      our client id
 * @param {string} spec.agent                   add-mcp's agent id
 * @param {string} spec.name
 * @param {string[]} [spec.aliases]
 * @param {string[]} [spec.bins]                binaries that mean "installed"
 * @param {(ctx) => string[]} [spec.dirs]       directories that mean "installed"
 * @param {(ctx, info) => void} [spec.check]    throws when add-mcp would write a file the client does not read
 * @param {(ctx) => string[]} spec.next
 */
export function addMcpClient(spec) {
  function look(ctx) {
    const info = writer.inspect(ctx, spec.agent)
    spec.check?.(ctx, info)
    if (info.format !== 'json') throw new Error(`${spec.name}: unexpected config format ${info.format}`)
    const text = readText(info.path)
    // add-mcp reads leniently; never let it write over a file we cannot parse.
    parseJsonc(text, info.path)
    return { info, text, map: Object.fromEntries(info.servers.map((s) => [s.name, s.config])) }
  }
  const ourLegacy = (ctx, map) => LEGACY_SERVER_NAMES.filter((n) => map[n] && ctx.ours(entryUrl(map[n])))

  /** Read the file back after add-mcp wrote it; restore the old text if it is not what we asked for. */
  function verify(ctx, info, before, { expect, gone }) {
    const after = readText(info.path)
    try {
      const servers = getPath(parseJsonc(after, info.path), info.configKey.split('.')) || {}
      if (expect && !sameValue(servers[ctx.name], expect)) throw new Error('box entry not as written')
      for (const n of gone) if (servers[n] !== undefined) throw new Error(`${n} still present`)
    } catch (err) {
      if (before === null) fs.rmSync(info.path, { force: true })
      else writeAtomic(info.path, before)
      throw new Error(`add-mcp's change to ${info.path} did not read back as expected (${err.message}); the file was restored`)
    }
    return before !== null && after !== before ? [saveBackup(info.path, before)] : []
  }

  return {
    id: spec.id,
    name: spec.name,
    auth: 'oauth',
    aliases: spec.aliases || [],

    detect(ctx) {
      for (const bin of spec.bins || []) if (ctx.which(bin)) return { installed: true, via: `${bin} on PATH` }
      for (const dir of spec.dirs ? spec.dirs(ctx) : []) if (fs.existsSync(dir)) return { installed: true, via: dir }
      return { installed: false }
    },

    configLocation(ctx) {
      return writer.inspect(ctx, spec.agent).path
    },

    status(ctx) {
      const { info, map } = look(ctx)
      const entry = map[ctx.name]
      if (entry && !ctx.ours(entryUrl(entry))) {
        return { entries: [], legacy: [], keyConfigured: false, foreign: { where: info.path, url: entryUrl(entry) } }
      }
      return {
        entries: entry ? [{ where: info.path, url: entryUrl(entry), enabled: entry.enabled !== false && entry.disabled !== true }] : [],
        legacy: ourLegacy(ctx, map),
        keyConfigured: false,
      }
    },

    connect(ctx) {
      const { info, text, map } = look(ctx)
      const current = map[ctx.name]
      if (current && !ctx.ours(entryUrl(current))) throw new ForeignServerError(info.path, ctx.name, entryUrl(current))
      const legacy = ourLegacy(ctx, map)
      const upsert = !sameValue(current, info.entry)
      const next = spec.next(ctx)
      if (!upsert && !legacy.length) return { actions: [], backups: [], next }
      if (ctx.dryRun) return { actions: [`would write ${ctx.name} to ${info.path}`], backups: [], next }
      writer.apply(ctx, spec.agent, { upsert, drop: legacy })
      const backups = verify(ctx, info, text, { expect: info.entry, gone: legacy })
      return { actions: [`wrote ${ctx.name} to ${info.path}`], backups, next }
    },

    remove(ctx) {
      const { info, text, map } = look(ctx)
      const names = [ctx.name, ...LEGACY_SERVER_NAMES].filter((n) => map[n] && ctx.ours(entryUrl(map[n])))
      const warnings = map[ctx.name] && !names.includes(ctx.name) ? [`left "${ctx.name}" in ${info.path}: it points at ${entryUrl(map[ctx.name])}, not box by Simular`] : []
      if (!names.length) return { actions: [], backups: [], warnings, next: [] }
      if (ctx.dryRun) return { actions: [`would remove ${names.join(', ')} from ${info.path}`], backups: [], warnings, next: [] }
      writer.apply(ctx, spec.agent, { upsert: false, drop: names })
      const backups = verify(ctx, info, text, { gone: names })
      return { actions: [`removed ${names.join(', ')} from ${info.path}`], backups, warnings, next: [] }
    },
  }
}
