import fs from 'node:fs'
import path from 'node:path'

export const TOKEN_ENV = 'BOX_TOKEN'

/**
 * TokenStore keeps the CLI's own box token per endpoint in <boxHome>/credentials.json, mode 0600 in a 0700 directory,
 * as gh and Claude Code do on Linux. BOX_TOKEN (a personal key, cb_...) wins over the file and is never written.
 * It is one small interface, so an OS keychain backend can replace the file later without touching the callers.
 */
export class TokenStore {
  constructor(dir, env = process.env) {
    this.dir = dir
    this.file = path.join(dir, 'credentials.json')
    this.env = env
  }

  /** saved is the token login stored for endpoint, ignoring BOX_TOKEN: {token, source: 'browser' (a device token) | 'paste'}. */
  saved(endpoint) {
    const entry = this.#read()[endpoint]
    return entry?.token ? { token: entry.token, source: entry.source || 'paste' } : null
  }

  /** get is the token calls use: BOX_TOKEN ({source: 'env'}) when set, else the saved one, else null. */
  get(endpoint) {
    const fromEnv = (this.env[TOKEN_ENV] || '').trim()
    return fromEnv ? { token: fromEnv, source: 'env' } : this.saved(endpoint)
  }

  set(endpoint, token, source) {
    const all = this.#read()
    all[endpoint] = { token, source, saved_at: new Date().toISOString() }
    this.#write(all)
  }

  remove(endpoint) {
    const all = this.#read()
    if (!(endpoint in all)) return false
    delete all[endpoint]
    this.#write(all)
    return true
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  #write(all) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    fs.chmodSync(this.dir, 0o700)
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, this.file)
  }
}
