// Shared logic for clients whose config is a JSON/JSONC file with a map of servers.
import fs from 'node:fs'
import { LEGACY_SERVER_NAMES, SERVER_NAME } from '../constants.js'
import { readText, updateFile } from '../fsutil.js'
import { getPath, parseJsonc, removeJsonServer, upsertJsonServer } from '../formats.js'

/**
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.name
 * @param {'oauth'|'key'} spec.auth
 * @param {(ctx) => string} spec.file          config file path
 * @param {string[]} spec.container             JSON path of the servers map
 * @param {(ctx, key) => object} spec.entry     the box entry to write
 * @param {(entry) => string|undefined} [spec.entryUrl]
 * @param {(entry) => string|undefined} [spec.entryKey]
 * @param {string[]} [spec.bins]                binaries that mean "installed"
 * @param {(ctx) => string[]} [spec.dirs]       directories that mean "installed"
 * @param {string[]} [spec.next]
 * @param {(ctx) => object} [spec.extraStatus]
 */
export function jsonClient(spec) {
  const entryUrl = spec.entryUrl || ((e) => e?.url)
  const entryKey = spec.entryKey || (() => undefined)
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
      const doc = parseJsonc(readText(file), file)
      const servers = getPath(doc, spec.container) || {}
      const entry = servers[SERVER_NAME]
      const entries = entry ? [{ where: file, url: entryUrl(entry), enabled: entry.enabled !== false && entry.disabled !== true }] : []
      const key = entry ? entryKey(entry) : undefined
      return {
        entries,
        legacy: LEGACY_SERVER_NAMES.filter((n) => servers[n]),
        key,
        keyConfigured: Boolean(key),
        ...(spec.extraStatus ? spec.extraStatus(ctx, entry) : {}),
      }
    },

    connect(ctx, { key } = {}) {
      const file = spec.file(ctx)
      let useKey = key
      if (spec.auth === 'key' && !useKey) useKey = this.status(ctx).key
      if (spec.auth === 'key' && !useKey) throw new Error('a personal key is needed')
      const entry = spec.entry(ctx, useKey)
      const res = updateFile(
        file,
        (text) => upsertJsonServer(text, spec.container, SERVER_NAME, entry, { legacy: LEGACY_SERVER_NAMES, file }),
        { dryRun: ctx.dryRun, mode: spec.auth === 'key' ? 0o600 : undefined },
      )
      return {
        actions: res.changed ? [`${ctx.dryRun ? 'would write' : 'wrote'} box to ${file}`] : [],
        backups: res.backup ? [res.backup] : [],
        next: typeof spec.next === 'function' ? spec.next(ctx) : spec.next || [],
      }
    },

    remove(ctx) {
      const file = spec.file(ctx)
      const res = updateFile(file, (text) => removeJsonServer(text, spec.container, [SERVER_NAME, ...LEGACY_SERVER_NAMES], { file }), {
        dryRun: ctx.dryRun,
      })
      return {
        actions: res.changed ? [`${ctx.dryRun ? 'would remove' : 'removed'} box from ${file}`] : [],
        backups: res.backup ? [res.backup] : [],
        next: [],
      }
    },
  }
}
