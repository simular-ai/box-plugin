// The one place the box MCP endpoint lives. When the endpoint moves (planned: mcp.box.simular.ai),
// change DEFAULT_MCP_URL and release a new CLI version. BOX_MCP_URL overrides it (e.g. staging).
export const DEFAULT_MCP_URL = 'https://relay.simular.cloud/mcp'

/** Servers named here are removed on connect: older box setups added them next to `box`. */
export const LEGACY_SERVER_NAMES = ['box-control']

export const SERVER_NAME = 'box'

/** Hosts that serve box by Simular. An existing server named `box` elsewhere is not ours. */
export const OUR_HOSTS = ['relay.simular.cloud', 'staging.relay.simular.cloud', 'mcp.box.simular.ai']

/** Whether `url` points at box by Simular (a known host, or the host of the current endpoint). */
export function isOurUrl(url, currentUrl) {
  if (typeof url !== 'string') return false
  let host
  try {
    host = new URL(url).host
  } catch {
    return false
  }
  if (OUR_HOSTS.includes(host)) return true
  try {
    return host === new URL(currentUrl).host
  } catch {
    return false
  }
}

/** Thrown when a server with our name already exists but points somewhere else. */
export class ForeignServerError extends Error {
  constructor(where, name, url) {
    super(
      `${where} already has a server named "${name}" that points at ${url || 'something else'}, which is not box by Simular. ` +
        'Nothing was changed. To add box next to it, run again with --name <another-name> (for example --name simular-box).',
    )
    this.foreign = true
  }
}

export function validServerName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('--name may use letters, digits, - and _ (up to 64)')
  return name
}
export const KEY_ENV = 'BOX_TOKEN'
export const KEYS_URL = 'https://box.simular.ai/keys'
export const WATCH_URL = 'https://box.simular.ai/box'
export const INSTALL_URL = 'https://box.simular.ai/install'
export const SUPPORT_EMAIL = 'support@simular.ai'

// Shown after a successful connect, word for word. They start with "Use box to" so the model reads
// "box" as this tool, not a layout box or Box.com. Keep in sync with box-portal
// src/docs/content/mcp.md ("Once box is connected, try asking your AI"; the first one is
// BOX_FIRST_PROMPT in src/lib/getting-started.ts).
export const EXAMPLE_PROMPTS = [
  'Use box to open Chrome, search Google for "Simular", and summarize the top 3 results.',
  "Use box to open GitHub Trending and tell me what today's top 3 repositories do",
  "Use box to go to news.ycombinator.com and give me today's top 5 stories in a table",
]

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
