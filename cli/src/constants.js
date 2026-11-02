// The one place the box MCP endpoint lives. When the endpoint moves (planned: mcp.box.simular.ai),
// change DEFAULT_MCP_URL and release a new CLI version. BOX_MCP_URL overrides it (e.g. staging).
export const DEFAULT_MCP_URL = 'https://relay.simular.cloud/mcp'

/** Servers named here are removed on connect: older box setups added them next to `box`. */
export const LEGACY_SERVER_NAMES = ['box-control']

export const SERVER_NAME = 'box'
export const KEY_ENV = 'BOX_TOKEN'
export const KEYS_URL = 'https://box.simular.ai/keys'
export const WATCH_URL = 'https://box.simular.ai/box'
export const INSTALL_URL = 'https://box.simular.ai/install'
export const SUPPORT_EMAIL = 'support@simular.ai'

export function mcpUrl(env = process.env) {
  const override = (env.BOX_MCP_URL || '').trim()
  if (!override) return DEFAULT_MCP_URL
  let parsed
  try {
    parsed = new URL(override)
  } catch {
    throw new Error(`BOX_MCP_URL is not a valid URL: ${override}`)
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new Error('BOX_MCP_URL must use https (http is allowed only for localhost)')
  }
  return parsed.toString().replace(/\/$/, '')
}

function isLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

/** A personal key looks like `cb_` followed by url-safe characters. */
export function looksLikeKey(value) {
  return typeof value === 'string' && /^cb_[A-Za-z0-9_-]{4,}$/.test(value.trim())
}

/** For display only: never print a key, only that one is set and how it starts. */
export function maskKey(value) {
  if (!value) return '(none)'
  return value.startsWith('cb_') ? 'cb_****' : '****'
}
