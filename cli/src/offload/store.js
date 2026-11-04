import fs from 'node:fs'
import path from 'node:path'

// OffloadStore keeps this computer's side of offloads under <boxHome>/offload (0700): per repo key handover.md, env.json,
// back.md and offload.json while an offload is in flight; repos.json (0600) keeps opted-in secret entries (names and paths
// only, never a value) and whether the user said yes to the size confirm. Ported from upstream OffloadStore.
export class OffloadStore {
  constructor(boxHome) {
    this.root = path.join(boxHome, 'offload')
  }

  directory(key) {
    const dir = path.join(this.root, key)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.chmodSync(path.dirname(this.root), 0o700)
    fs.chmodSync(this.root, 0o700)
    fs.chmodSync(dir, 0o700)
    return dir
  }

  handover(key) {
    return path.join(this.directory(key), 'handover.md')
  }

  back(key) {
    return path.join(this.directory(key), 'back.md')
  }

  record(key) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.root, key, 'offload.json'), 'utf8'))
    } catch {
      return null
    }
  }

  save(record) {
    writeAtomic(path.join(this.directory(record.repo), 'offload.json'), JSON.stringify(record, null, 2) + '\n', 0o600)
  }

  remove(key) {
    fs.rmSync(path.join(this.root, key, 'offload.json'), { force: true })
  }

  /** records lists every offload in flight, oldest first. */
  records() {
    let keys = []
    try {
      keys = fs.readdirSync(this.root)
    } catch {
      return []
    }
    return keys
      .map((k) => this.record(k))
      .filter(Boolean)
      .sort((a, b) => a.started_at_ms - b.started_at_ms)
  }

  secrets(key) {
    return this.#repos()[key]?.secrets || []
  }

  setSecrets(key, entries) {
    this.#update(key, (s) => (s.secrets = entries))
  }

  sizeConfirmed(key) {
    return Boolean(this.#repos()[key]?.size_confirmed)
  }

  confirmSize(key) {
    this.#update(key, (s) => (s.size_confirmed = true))
  }

  #update(key, change) {
    const all = this.#repos()
    const settings = all[key] || { secrets: [], size_confirmed: false }
    change(settings)
    if (!settings.secrets.length && !settings.size_confirmed) delete all[key]
    else all[key] = settings
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeAtomic(path.join(this.root, 'repos.json'), JSON.stringify(all, null, 2) + '\n', 0o600)
  }

  #repos() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.root, 'repos.json'), 'utf8')) || {}
    } catch {
      return {}
    }
  }
}

function writeAtomic(file, text, mode) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, { mode })
  fs.chmodSync(tmp, mode)
  fs.renameSync(tmp, file)
}
