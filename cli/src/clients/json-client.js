// Shared logic for clients whose config is a JSON/JSONC file with a map of servers.
import fs from 'node:fs'
import { ForeignServerError, LEGACY_SERVER_NAMES } from '../constants.js'
import { readText, updateFile } from '../fsutil.js'
import { getPath, parseJsonc, removeJsonServer, upsertJsonServer } from '../formats.js'

/**
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.name
 * @param {'oauth'} spec.auth
 * @param {(ctx) => string} spec.file          config file path
 * @param {string[]} spec.container             JSON path of the servers map
 * @param {(ctx) => object} spec.entry          the box entry to write
 * @param {(entry) => string|undefined} [spec.entryUrl]
 * @param {string[]} [spec.bins]                binaries that mean "installed"
 * @param {(ctx) => string[]} [spec.dirs]       directories that mean "installed"
 * @param {string[]|((ctx) => string[])} [spec.next]
 */
export function jsonClient(spec) {
  const entryUrl = spec.entryUrl || ((e) => e?.url ?? e?.serverUrl)
  const servers = (ctx) => {
    const file = spec.file(ctx)
    return getPath(parseJsonc(readText(file), file), spec.container) || {}
  }
  // Only entries that point at box by Simular are ours to change or remove.
  const ourLegacy = (ctx, map) => LEGACY_SERVER_NAMES.filter((n) => map[n] && ctx.ours(entryUrl(map[n])))

  return {
    id: spec.id,
    name: spec.name,
    auth: spec.auth,
    aliases: spec.aliases || [],

    detect(ctx) {
      for (const bin of spec.bins || []) if (ctx.which(bin)) return { installed: true, via: `${bin} on PATH` }
      for (const dir of spec.dirs ? spec.dirs(ctx) : []) if (fs.existsSync(dir)) return { installed: true, via: dir }
      return { installed: false }
    },

    configLocation(ctx) {
      return spec.file(ctx)
    },

    status(ctx) {
      const file = spec.file(ctx)
      const map = servers(ctx)
      const entry = map[ctx.name]
      if (entry && !ctx.ours(entryUrl(entry))) {
        return { entries: [], legacy: [], keyConfigured: false, foreign: { where: file, url: entryUrl(entry) } }
      }
      return {
        entries: entry ? [{ where: file, url: entryUrl(entry), enabled: entry.enabled !== false && entry.disabled !== true }] : [],
        legacy: ourLegacy(ctx, map),
        keyConfigured: false,
      }
    },

    connect(ctx) {
      const file = spec.file(ctx)
      const map = servers(ctx)
      if (map[ctx.name] && !ctx.ours(entryUrl(map[ctx.name]))) throw new ForeignServerError(file, ctx.name, entryUrl(map[ctx.name]))
      const res = updateFile(file, (text) => upsertJsonServer(text, spec.container, ctx.name, spec.entry(ctx), { legacy: ourLegacy(ctx, map), file }), {
        dryRun: ctx.dryRun,
      })
      return {
        actions: res.changed ? [`${ctx.dryRun ? 'would write' : 'wrote'} ${ctx.name} to ${file}`] : [],
        backups: res.backup ? [res.backup] : [],
        next: typeof spec.next === 'function' ? spec.next(ctx) : spec.next || [],
      }
    },

    remove(ctx) {
      const file = spec.file(ctx)
      const map = servers(ctx)
      const names = [ctx.name, ...LEGACY_SERVER_NAMES].filter((n) => map[n] && ctx.ours(entryUrl(map[n])))
      const warnings = map[ctx.name] && !names.includes(ctx.name) ? [`left "${ctx.name}" in ${file}: it points at ${entryUrl(map[ctx.name])}, not box by Simular`] : []
      const res = updateFile(file, (text) => removeJsonServer(text, spec.container, names, { file }), { dryRun: ctx.dryRun })
      return {
        actions: res.changed ? [`${ctx.dryRun ? 'would remove' : 'removed'} ${names.join(', ')} from ${file}`] : [],
        backups: res.backup ? [res.backup] : [],
        warnings,
        next: [],
      }
    },
  }
}
