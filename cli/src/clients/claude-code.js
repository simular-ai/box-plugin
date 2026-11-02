// Claude Code. Uses Claude Code's own CLI, never edits ~/.claude.json directly.
// Default URL: installs this repo's claude/ plugin (box MCP server + the box skill) from the
// `simular-box` marketplace. With BOX_MCP_URL set, the plugin's pinned URL would be wrong, so a
// user-scope server is added with `claude mcp add` instead.
// Docs: https://code.claude.com/docs/en/mcp , https://code.claude.com/docs/en/plugins
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_MCP_URL, LEGACY_SERVER_NAMES, SERVER_NAME } from '../constants.js'

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
    const plugin = ctx.which('claude') ? pluginState(ctx) : null
    const entries = []
    // A disabled plugin next to a user-scope server is how connect sets up a BOX_MCP_URL override.
    if (plugin && (plugin.enabled || !user[SERVER_NAME])) {
      entries.push({ where: `plugin ${PLUGIN}${plugin.enabled ? '' : ' (disabled)'}`, url: plugin.mcpServers?.box?.url, enabled: plugin.enabled })
    }
    if (user[SERVER_NAME]) entries.push({ where: `user scope in ${userConfigFile(ctx)}`, url: user[SERVER_NAME].url, enabled: true })
    const legacy = LEGACY_SERVER_NAMES.filter((n) => user[n])
    return { entries, legacy, keyConfigured: false }
  },

  connect(ctx) {
    if (!ctx.which('claude')) throw new Error('the `claude` command is not on PATH; install Claude Code first (https://code.claude.com)')
    const actions = []
    const user = readUserServers(ctx)
    for (const name of LEGACY_SERVER_NAMES) {
      if (user[name]) {
        if (!ctx.dryRun) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', name])
        actions.push(`removed old server ${name}`)
      }
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
      } else if (!plugin.enabled) {
        if (!ctx.dryRun) must(ctx.run('claude', ['plugin', 'enable', PLUGIN]), 'claude plugin enable')
        actions.push(`enabled plugin ${PLUGIN}`)
      }
      // A user-scope `box` next to the plugin would show box twice.
      if (user[SERVER_NAME]) {
        if (!ctx.dryRun) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME])
        actions.push('removed the user-scope box server (the plugin provides it)')
      }
    } else {
      const current = user[SERVER_NAME]
      if (!current || current.url !== ctx.url || current.type !== 'http') {
        if (!ctx.dryRun) {
          if (current) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME])
          must(ctx.run('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', SERVER_NAME, ctx.url]), 'claude mcp add')
        }
        actions.push(`added user-scope server box -> ${ctx.url}`)
      }
      const plugin = pluginState(ctx)
      if (plugin?.enabled) {
        if (!ctx.dryRun) ctx.run('claude', ['plugin', 'disable', PLUGIN])
        actions.push(`disabled plugin ${PLUGIN} (it points at the default URL)`)
      }
    }
    const label = ctx.url === DEFAULT_MCP_URL ? 'plugin:box:box' : 'box'
    return {
      actions,
      next: [`Start Claude Code, run /mcp, pick ${label} and choose Authenticate; sign in and click Approve in the browser.`],
    }
  },

  remove(ctx) {
    if (!ctx.which('claude')) throw new Error('the `claude` command is not on PATH')
    const actions = []
    const user = readUserServers(ctx)
    for (const name of [SERVER_NAME, ...LEGACY_SERVER_NAMES]) {
      if (user[name]) {
        if (!ctx.dryRun) ctx.run('claude', ['mcp', 'remove', '--scope', 'user', name])
        actions.push(`removed user-scope server ${name}`)
      }
    }
    if (pluginState(ctx)) {
      if (!ctx.dryRun) must(ctx.run('claude', ['plugin', 'uninstall', PLUGIN]), 'claude plugin uninstall')
      actions.push(`uninstalled plugin ${PLUGIN}`)
    }
    return { actions, next: [] }
  },
}
