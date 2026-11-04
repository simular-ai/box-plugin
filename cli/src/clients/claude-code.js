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
const PLUGIN = `box@${MARKETPLACE}`

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

function pluginState(ctx) {
  const res = ctx.run('claude', ['plugin', 'list', '--json'])
  if (res.status !== 0) return null
  try {
    return JSON.parse(res.stdout).find((p) => p.id === PLUGIN) || null
  } catch {
    return null
  }
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
    const plugin = ctx.which('claude') ? pluginState(ctx) : null
    const entries = []
    // A disabled plugin next to a user-scope server is how connect sets up a BOX_MCP_URL override.
    if (plugin && (plugin.enabled || !mine(ctx.name))) {
      entries.push({ where: `plugin ${PLUGIN}${plugin.enabled ? '' : ' (disabled)'}`, url: plugin.mcpServers?.box?.url, enabled: plugin.enabled })
    }
    if (mine(ctx.name)) entries.push({ where: `user scope in ${userConfigFile(ctx)}`, url: user[ctx.name].url, enabled: true })
    // The plugin's server is named plugin:box:box, so a foreign user-scope `box` only matters
    // when connect would add a user-scope server itself (BOX_MCP_URL set).
    const foreign = user[ctx.name] && !mine(ctx.name) && ctx.url !== DEFAULT_MCP_URL ? { where: userConfigFile(ctx), url: user[ctx.name].url } : undefined
    return { entries, legacy: LEGACY_SERVER_NAMES.filter(mine), keyConfigured: false, foreign }
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
            const scope = ['user', 'project', 'local'].includes(plugin.scope) ? ['--scope', plugin.scope] : []
            must(ctx.run('claude', ['plugin', 'update', PLUGIN, ...scope], { timeoutMs: 180000 }), 'claude plugin update')
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
    const label = ctx.url === DEFAULT_MCP_URL ? 'plugin:box:box' : ctx.name
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
    if (pluginState(ctx)) {
      if (!ctx.dryRun) must(ctx.run('claude', ['plugin', 'uninstall', PLUGIN]), 'claude plugin uninstall')
      actions.push(`${ctx.dryRun ? 'would uninstall' : 'uninstalled'} plugin ${PLUGIN}`)
    }
    return { actions, warnings, next: [] }
  },
}
