import fs from 'node:fs'
import path from 'node:path'

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export function exists(file) {
  try {
    fs.accessSync(file)
    return true
  } catch {
    return false
  }
}

/**
 * Copy `file` to `file.box-backup-<timestamp>` before we change it. Returns the backup path,
 * or null when there was nothing to back up.
 */
export function backup(file, now = new Date()) {
  if (!exists(file)) return null
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const target = `${file}.box-backup-${stamp}`
  fs.copyFileSync(file, target)
  try {
    fs.chmodSync(target, fs.statSync(file).mode & 0o777)
  } catch {
    // best effort: the copy keeps the default mode
  }
  return target
}

/**
 * Write atomically (temp file + rename) so a crash never leaves a half-written config.
 * Keeps the existing file's mode; `mode` applies to new files (0600 for files that hold a key).
 */
export function writeAtomic(linkOrFile, text, { mode } = {}) {
  // Write through a symlinked config (dotfile repos): replace the target, keep the link.
  const file = exists(linkOrFile) ? fs.realpathSync(linkOrFile) : linkOrFile
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let finalMode = mode
  if (exists(file)) {
    const current = fs.statSync(file).mode & 0o777
    finalMode = mode === undefined ? current : current & mode
  }
  const tmp = `${file}.box-tmp-${process.pid}`
  fs.writeFileSync(tmp, text, { mode: finalMode ?? 0o644 })
  if (finalMode !== undefined) fs.chmodSync(tmp, finalMode)
  fs.renameSync(tmp, file)
}

/**
 * Apply `transform(oldText|null) -> newText|null` to a file. Returns {changed, backup}.
 * A null result or an unchanged text leaves the file alone (idempotent re-runs, no backup spam).
 * `secret: true` (a .env holding keys) keeps no backup: a backup would keep an old or removed
 * key on disk. Those edits only add, replace or delete one line.
 */
export function updateFile(file, transform, { mode, dryRun = false, secret = false } = {}) {
  const before = readText(file)
  const after = transform(before)
  if (after === null || after === before) return { changed: false, backup: null }
  if (dryRun) return { changed: true, backup: null, preview: after }
  const backupPath = secret ? null : backup(exists(file) ? fs.realpathSync(file) : file)
  // A backup of a file that holds a key is a copy of that key: keep it as private as the file.
  if (backupPath && mode !== undefined) fs.chmodSync(backupPath, (fs.statSync(backupPath).mode & 0o777) & mode)
  writeAtomic(file, after, { mode })
  return { changed: true, backup: backupPath }
}
