import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import spawn from 'cross-spawn'
import { mcpUrl, SERVER_NAME, isOurUrl } from './constants.js'

/**
 * Everything a client adapter may touch about the machine goes through this context, so tests can
 * point it at a temporary HOME and a fake PATH.
 */
export function createContext({ env = process.env, platform = process.platform, dryRun = false, log = () => {}, serverName = SERVER_NAME } = {}) {
  // Match os.homedir(), which the apps themselves use: USERPROFILE on Windows, HOME elsewhere.
  const home = (platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE) || os.homedir()
  const ctx = {
    env,
    home,
    platform,
    dryRun,
    log,
    url: mcpUrl(env),
    /** The name box is installed under (--name); `box` unless that name is taken by another server. */
    name: serverName,
    /** Whether a configured URL is box by Simular (and so ours to change or remove). */
    ours(url) {
      return isOurUrl(url, this.url)
    },
    /** XDG config dir, falling back to ~/.config (also on macOS, as most CLIs do). */
    xdgConfig: env.XDG_CONFIG_HOME || path.join(home, '.config'),
    /** Platform app-data dir: ~/Library/Application Support, %APPDATA%, or XDG config. */
    appData:
      platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : platform === 'win32'
          ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
          : env.XDG_CONFIG_HOME || path.join(home, '.config'),
    which(bin) {
      return which(bin, env, platform)
    },
    /**
     * Run a client's own CLI. Arguments are passed as an array; cross-spawn quotes them for
     * Windows .cmd shims (npm-installed CLIs), where a plain spawn needs a shell. Secrets must
     * never be passed here: they would show up in `ps`.
     */
    run(bin, args, { input, timeoutMs = 60000 } = {}) {
      const resolved = ctx.which(bin)
      if (!resolved) return { status: 127, stdout: '', stderr: `${bin} not found` }
      const res = spawn.sync(resolved, args, { env, input, encoding: 'utf8', timeout: timeoutMs })
      return { status: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || String(res.error || '') }
    },
    /** Run a client's own CLI attached to this terminal, for its interactive sign-in. */
    runInteractive(bin, args) {
      const resolved = ctx.which(bin)
      if (!resolved) return { status: 127 }
      const res = spawn.sync(resolved, args, { env, stdio: 'inherit' })
      return { status: res.status ?? 1 }
    },
  }
  return ctx
}

export function which(bin, env = process.env, platform = process.platform) {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext)
      try {
        const st = fs.statSync(candidate)
        if (st.isFile() && (platform === 'win32' || st.mode & 0o111)) return candidate
      } catch {
        // not here
      }
    }
  }
  return null
}
