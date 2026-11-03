// An environment whose every home/config/data dir points into a fresh temp dir, so a real
// client run in CI (or on a laptop) can never read or write the user's own configs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STRIP = /^(CLAUDE_CONFIG_DIR|CODEX_HOME|HERMES_HOME|OPENCODE_CONFIG|OPENCODE_CONFIG_DIR|OPENCLAW_.*|XDG_.*|BOX_MCP_URL|BOX_TOKEN|MCP_BOX_API_KEY)$/i

export function isolatedEnv(base = process.env, { keep = [] } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'box-e2e-')))
  const env = {}
  for (const [k, v] of Object.entries(base)) if (!STRIP.test(k) || keep.includes(k)) env[k] = v
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    NO_COLOR: '1',
    CI: base.CI || '1',
  })
  for (const d of [env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME]) fs.mkdirSync(d, { recursive: true })
  return { home, env }
}
