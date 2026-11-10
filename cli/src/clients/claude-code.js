// Claude Code. Uses Claude Code's own CLI, never edits ~/.claude.json directly.
// Default URL: installs this repo's claude/ plugin (box MCP server + the box skill) from the
// `simular-box` marketplace. With BOX_MCP_URL set, the plugin's pinned URL would be wrong, so a
// user-scope server is added with `claude mcp add` instead.
// Docs: https://code.claude.com/docs/en/mcp , https://code.claude.com/docs/en/plugins
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_MCP_URL, ForeignServerError, LEGACY_SERVER_NAMES, SERVER_NAME } from '../constants.js'

const MARKETPLACE_SOURCE = 'simular-ai/box-plugin'
const MARKETPLACE = 'simular-box'
const PLUGIN = `simular-box@${MARKETPLACE}`
// The plugin was called `box` until 2026-11; the Claude plugin directory already had a `box`.
// connect replaces an installed old plugin with the new one, and remove takes both.
const LEGACY_PLUGINS = [`box@${MARKETPLACE}`]

function configDir(ctx) {
  return ctx.env.CLAUDE_CONFIG_DIR || path.join(ctx.home, '.claude')
}

function userConfigFile(ctx) {
  return ctx.env.CLAUDE_CONFIG_DIR ? path.join(ctx.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(ctx.home, '.claude.json')
}

function readUserServers(ctx) {
  try {
    return JSON.parse(fs.readFileSync(userConfigFile(ctx), 'utf8')).mcpServers || {}
  } catch {
    return {}
  }
}

function listPlugins(ctx) {
  const res = ctx.run('claude', ['plugin', 'list', '--json'])
  if (res.status !== 0) return []
  try {
    return JSON.parse(res.stdout)
  } catch {
    return []
  }
}

function pluginState(ctx) {
  return listPlugins(ctx).find((p) => p.id === PLUGIN) || null
}

function legacyPlugins(ctx) {
  return listPlugins(ctx).filter((p) => LEGACY_PLUGINS.includes(p.id))
}

function scopeArgs(plugin) {
  return ['user', 'project', 'local'].includes(plugin.scope) ? ['--scope', plugin.scope] : []
}

function must(res, what) {
  if (res.status !== 0) throw new Error(`${what} failed: ${(res.stderr || res.stdout).trim().split('\n').pop()}`)
}

export default {
  id: 'claude-code',
  name: 'Claude Code',
  auth: 'oauth',

  detect(ctx) {
    if (ctx.which('claude')) return { installed: true, via: 'claude on PATH' }
    if (fs.existsSync(configDir(ctx))) return { installed: true, via: configDir(ctx), cliMissing: true }
    return { installed: false }
  },

  configLocation(ctx) {
    return userConfigFile(ctx)
  },

  status(ctx) {
    const user = readUserServers(ctx)
    const mine = (n) => user[n] && ctx.ours(user[n].url)
    const hasClaude = ctx.which('claude')
    const plugin = hasClaude ? pluginState(ctx) : null
    const old = hasClaude ? legacyPlugins(ctx) : []
    const entries = []
    // A disabled plugin next to a user-scope server is how connect sets up a BOX_MCP_URL override.
    if (plugin && (plugin.enabled || !mine(ctx.name))) {
      entries.push({ where: `plugin ${PLUGIN}${plugin.enabled ? '' : ' (disabled)'}`, url: plugin.mcpServers?.box?.url, enabled: plugin.enabled })
    }
    // An old-named plugin still serves box (and its URL tells connect whether box moved).
    for (const p of old.filter((p) => p.enabled)) entries.push({ where: `plugin ${p.id}`, url: p.mcpServers?.box?.url, enabled: true })
    if (mine(ctx.name)) entries.push({ where: `user scope in ${userConfigFile(ctx)}`, url: user[ctx.name].url, enabled: true })
    // The plugin's server is named plugin:simular-box:box, so a foreign user-scope `box` only
    // matters when connect would add a user-scope server itself (BOX_MCP_URL set).
    const foreign = user[ctx.name] && !mine(ctx.name) && ctx.url !== DEFAULT_MCP_URL ? { where: userConfigFile(ctx), url: user[ctx.name].url } : undefined
    const legacy = [...LEGACY_SERVER_NAMES.filter(mine), ...old.map((p) => `plugin ${p.id}`)]
    return { entries, legacy, keyConfigured: false, foreign }
  },

  connect(ctx) {
    if (!ctx.which('claude')) throw new Error('the `claude` command is not on PATH; install Claude Code first (https://code.claude.com)')
    const actions = []
    let updated = false
    const user = readUserServers(ctx)
    const mine = (n) => user[n] && ctx.ours(user[n].url)
    if (ctx.url !== DEFAULT_MCP_URL && user[ctx.name] && !mine(ctx.name)) {
      throw new ForeignServerError(`Claude Code (user scope, ${userConfigFile(ctx)})`, ctx.name, user[ctx.name].url || user[ctx.name].command)
    }
    // `claude mcp remove/add` edit ~/.claude.json; Claude Code keeps its own backups of it
    // under ~/.claude/backups.
    for (const name of LEGACY_SERVER_NAMES.filter(mine)) {
      if (!ctx.dryRun) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', name])
      actions.push(`removed old server ${name}`)
    }

    if (ctx.url === DEFAULT_MCP_URL) {
      const plugin = pluginState(ctx)
      if (!plugin) {
        if (!ctx.dryRun) {
          const list = ctx.run('claude', ['plugin', 'marketplace', 'list', '--json'])
          if (!list.stdout.includes(`"${MARKETPLACE}"`)) {
            must(ctx.run('claude', ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE], { timeoutMs: 180000 }), 'claude plugin marketplace add')
          } else {
            // A marketplace added before the rename lists only the old plugin name.
            must(ctx.run('claude', ['plugin', 'marketplace', 'update', MARKETPLACE], { timeoutMs: 180000 }), 'claude plugin marketplace update')
          }
          must(ctx.run('claude', ['plugin', 'install', PLUGIN, '--scope', 'user'], { timeoutMs: 180000 }), 'claude plugin install')
        }
        actions.push(`installed plugin ${PLUGIN} (box server + box skill)`)
      } else {
        // Claude Code doesn't auto-update third-party marketplaces, so a plugin installed before
        // box moved keeps the old URL until the marketplace and the plugin are updated.
        const pinned = plugin.mcpServers?.box?.url
        if (pinned && pinned !== DEFAULT_MCP_URL) {
          if (!ctx.dryRun) {
            must(ctx.run('claude', ['plugin', 'marketplace', 'update', MARKETPLACE], { timeoutMs: 180000 }), 'claude plugin marketplace update')
            must(ctx.run('claude', ['plugin', 'update', PLUGIN, ...scopeArgs(plugin)], { timeoutMs: 180000 }), 'claude plugin update')
            const now = pluginState(ctx)?.mcpServers?.box?.url
            if (now !== DEFAULT_MCP_URL) {
              throw new Error(
                `the ${PLUGIN} plugin still points at ${now || 'an unknown URL'} after an update; its marketplace "${MARKETPLACE}" may not come from ${MARKETPLACE_SOURCE}. ` +
                  `Run \`claude plugin uninstall ${PLUGIN}\` and \`claude plugin marketplace remove ${MARKETPLACE}\`, then connect again`,
              )
            }
          }
          actions.push(`${ctx.dryRun ? 'would update' : 'updated'} plugin ${PLUGIN} (box server now at ${DEFAULT_MCP_URL})`)
          updated = true
        }
        if (!plugin.enabled) {
          if (!ctx.dryRun) must(ctx.run('claude', ['plugin', 'enable', PLUGIN]), 'claude plugin enable')
          actions.push(`enabled plugin ${PLUGIN}`)
        }
      }
      // Our own user-scope box next to the plugin would show box twice. Someone else's stays.
      if (mine(SERVER_NAME)) {
        if (!ctx.dryRun) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME])
        actions.push('removed the user-scope box server (the plugin provides it)')
      }
    } else {
      const current = user[ctx.name]
      if (!current || current.url !== ctx.url || current.type !== 'http') {
        if (!ctx.dryRun) {
          if (current) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', ctx.name])
          must(ctx.run('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', ctx.name, ctx.url]), 'claude mcp add')
        }
        actions.push(`added user-scope server ${ctx.name} -> ${ctx.url}`)
      }
      const plugin = pluginState(ctx)
      if (plugin?.enabled) {
        if (!ctx.dryRun) ctx.run('claude', ['plugin', 'disable', PLUGIN])
        actions.push(`disabled plugin ${PLUGIN} (it points at the default URL)`)
      }
    }
    // The old-named plugin goes on either route, and only once box is set up the new way, so a
    // failed install leaves the user with the old plugin rather than with no box at all.
    for (const p of legacyPlugins(ctx)) {
      if (!ctx.dryRun) must(ctx.run('claude', ['plugin', 'uninstall', p.id, ...scopeArgs(p)]), 'claude plugin uninstall')
      actions.push(`${ctx.dryRun ? 'would uninstall' : 'uninstalled'} old plugin ${p.id}`)
    }
    const label = ctx.url === DEFAULT_MCP_URL ? 'plugin:simular-box:box' : ctx.name
    return {
      actions,
      next: [`${updated ? 'Restart Claude Code (a plugin update applies on restart), then run' : 'Start Claude Code, run'} /mcp, pick ${label} and choose Authenticate; sign in and click Approve in the browser.`],
    }
  },

  remove(ctx) {
    if (!ctx.which('claude')) throw new Error('the `claude` command is not on PATH')
    const actions = []
    const warnings = []
    const user = readUserServers(ctx)
    for (const name of [...new Set([ctx.name, SERVER_NAME, ...LEGACY_SERVER_NAMES])]) {
      if (!user[name]) continue
      if (!ctx.ours(user[name].url)) {
        if (name === ctx.name) warnings.push(`left user-scope server ${name}: it points at ${user[name].url || user[name].command}, not box by Simular`)
        continue
      }
      if (!ctx.dryRun) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', name])
      actions.push(`${ctx.dryRun ? 'would remove' : 'removed'} user-scope server ${name}`)
    }
    for (const p of listPlugins(ctx).filter((p) => p.id === PLUGIN || LEGACY_PLUGINS.includes(p.id))) {
      if (!ctx.dryRun) must(ctx.run('claude', ['plugin', 'uninstall', p.id, ...scopeArgs(p)]), 'claude plugin uninstall')
      actions.push(`${ctx.dryRun ? 'would uninstall' : 'uninstalled'} plugin ${p.id}`)
    }
    return { actions, warnings, next: [] }
  },
}
