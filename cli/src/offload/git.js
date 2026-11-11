import fs from 'node:fs'
import path from 'node:path'
import { repoKey } from './model.js'
import { runSync, run } from './run.js'

// GitRepo runs git in one work tree for the packer: the snapshot, the ignored list, the bundle and the merge at back.
// Ported from upstream loomhand/cocoonbox macos/Sources/CocoonBoxKit/OffloadGit.swift.

export class OffloadError extends Error {
  constructor(kind, message, { findings = [], reply } = {}) {
    super(message)
    this.kind = kind // handover | refused | needsYes | box | failed
    this.findings = findings
    this.reply = reply
  }
}

const IDENT = { GIT_AUTHOR_NAME: 'box', GIT_AUTHOR_EMAIL: 'box@localhost', GIT_COMMITTER_NAME: 'box', GIT_COMMITTER_EMAIL: 'box@localhost' }

export class GitRepo {
  constructor(top, env) {
    this.top = top
    this.env = env
  }

  /** open finds the top level of the repository dir is in; null outside one. */
  static open(dir, env = process.env) {
    const r = runSync(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { env })
    if (r.status !== 0 || !r.text) return null
    return new GitRepo(r.text, env)
  }

  run(args, { input, extra = {} } = {}) {
    return runSync(['git', '-C', this.top, ...args], { env: { ...this.env, ...extra }, input })
  }

  runAsync(args, { extra = {} } = {}) {
    return run(['git', '-C', this.top, ...args], { env: { ...this.env, ...extra } })
  }

  git(args, opts) {
    const r = this.run(args, opts)
    if (r.status !== 0) throw new OffloadError('failed', `git ${args.slice(0, 2).join(' ')}: ${r.error.split('\n').pop() || `exit ${r.status}`}`)
    return r.text
  }

  verify(rev) {
    const r = this.run(['rev-parse', '-q', '--verify', `${rev}^{commit}`])
    return r.status === 0 ? r.text : null
  }

  get head() {
    return this.verify('HEAD')
  }

  /** root is the oldest root commit of HEAD, empty for an unborn HEAD. */
  get root() {
    if (!this.head) return ''
    const r = this.run(['rev-list', '--max-parents=0', 'HEAD'])
    return r.status === 0 ? r.text.split('\n').pop() : ''
  }

  get key() {
    return repoKey(this.top, this.root)
  }

  /** linked is true for a linked worktree, whose .git is a file naming a local path. */
  get linked() {
    try {
      return fs.statSync(path.join(this.top, '.git')).isFile()
    } catch {
      return false
    }
  }

  gitPath(name) {
    const p = this.git(['rev-parse', '--git-path', name])
    return path.isAbsolute(p) ? p : path.join(this.top, p)
  }

  /** snapshot commits the work tree, tracked and untracked files that are not ignored, through a temporary index over HEAD's tree. */
  snapshot(index, message) {
    fs.rmSync(index, { force: true })
    try {
      const real = this.gitPath('index')
      if (fs.existsSync(real)) fs.copyFileSync(real, index)
      const extra = { GIT_INDEX_FILE: index }
      const head = this.head
      if (head) {
        if (this.run(['read-tree', '-m', head], { extra }).status !== 0) this.git(['read-tree', head], { extra })
      } else this.git(['read-tree', '--empty'], { extra })
      this.git(['add', '-A'], { extra })
      const tree = this.git(['write-tree'], { extra })
      return this.git(['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message], { extra: IDENT })
    } finally {
      fs.rmSync(index, { force: true })
    }
  }

  /** keepIndex points ref at a commit of the index's tree, so a bundle carries staged content no other ref reaches. */
  keepIndex(ref, scratch) {
    fs.rmSync(scratch, { force: true })
    try {
      const real = this.gitPath('index')
      if (!fs.existsSync(real)) return
      fs.copyFileSync(real, scratch)
      const w = this.run(['write-tree'], { extra: { GIT_INDEX_FILE: scratch } })
      if (w.status !== 0) return // a conflicted index is left out
      this.git(['update-ref', ref, this.git(['commit-tree', w.text, '-m', 'box index'], { extra: IDENT })])
    } finally {
      fs.rmSync(scratch, { force: true })
    }
  }

  /** ignored lists the git-ignored entries, directories ending in /, relative to the top level. */
  ignored() {
    const r = this.run(['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory'])
    if (r.status !== 0) throw new OffloadError('failed', `git ls-files: ${r.error}`)
    return r.out.toString('utf8').split('\0').filter(Boolean)
  }

  /** bundle writes every ref's history the box lacks to file; false when there is none. */
  bundle(file, notRefs) {
    fs.rmSync(file, { force: true })
    const known = notRefs.length
      ? this.run(['cat-file', '--batch-check'], { input: notRefs.map((r) => r + '\n').join('') })
          .text.split('\n')
          .filter((l) => l && !l.endsWith(' missing'))
          .map((l) => l.split(' ')[0])
      : []
    const r = this.run(['bundle', 'create', '-q', file, '--all', ...(known.length ? ['--not', ...known] : [])])
    if (r.status === 0) return true
    if (r.error.includes('empty bundle')) return false
    throw new OffloadError('failed', `git bundle: ${r.error}`)
  }

  // ---------- back ----------

  /**
   * land brings the box's snapshot S' home against base S: a fast-forward when this repo still equals S, else a clean
   * three-way merge applied uncommitted that leaves the user's uncommitted paths alone, else a branch at S' with this
   * work tree untouched. Returns {kind: unchanged|fastForward|merged|branch, files?, branch?, conflicts?}; fastForward and
   * merged also carry head (the box's commit HEAD's branch moved to, else null) and uncommitted (paths the work tree holds
   * beyond that HEAD).
   */
  land({ id, base, box, index, now = new Date() }) {
    const start = this.verify(base + '^')
    const boxHead = this.verify(box + '^')
    const head = this.head
    const local = this.snapshot(index, 'box local')
    const tree = (c) => this.git(['rev-parse', c + '^{tree}'])
    const [baseTree, localTree, boxTree] = [tree(base), tree(local), tree(box)]
    if (boxTree === baseTree && boxHead === start) return { kind: 'unchanged' }
    const follows = boxHead ? (start ? boxHead === start || this.run(['merge-base', '--is-ancestor', start, boxHead]).status === 0 : true) : false
    const move = boxHead && boxHead !== head && head === start && follows ? { old: head, new: boxHead } : null
    // uncommitted lists what the work tree now holds that the (possibly moved) HEAD does not
    const uncommitted = (to) => {
      const at = move ? move.new : head
      return this.git(['diff-tree', '-r', '--name-only', '--no-renames', at ? tree(at) : this.git(['mktree'], { input: '' }), to]).split('\n').filter(Boolean)
    }
    if (head === start && localTree === baseTree && (follows || !boxHead)) {
      if (!this.#settle({ id, from: base, to: box, move, scratch: index })) return this.#branch(box, [], now)
      return { kind: 'fastForward', head: move ? move.new : null, uncommitted: uncommitted(boxTree) }
    }
    const merge = this.run(['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, local, box])
    const lines = merge.out.toString('utf8').replace(/\n$/, '').split('\n')
    if (merge.status !== 0 || !lines[0]) {
      const conflicts = []
      if (merge.status === 1) for (const l of lines.slice(1)) {
        if (!l) break
        conflicts.push(l)
      }
      return this.#branch(box, conflicts, now)
    }
    const merged = lines[0]
    const files = this.git(['diff-tree', '-r', '--name-only', '--no-renames', localTree, merged]).split('\n').filter(Boolean)
    const headTree = head ? tree(head) : this.git(['mktree'], { input: '' })
    const dirty = new Set(this.git(['diff-tree', '-r', '--name-only', '--no-renames', headTree, localTree]).split('\n').filter(Boolean))
    const touched = files.filter((f) => dirty.has(f))
    if (touched.length) return this.#branch(box, touched, now)
    if (!this.#settle({ id, from: localTree, to: merged, move, scratch: index })) return this.#branch(box, [], now)
    return { kind: 'merged', files, head: move ? move.new : null, uncommitted: uncommitted(merged) }
  }

  // settle moves the work tree between trees and, with move, HEAD's branch and the index; the index is built aside under
  // git's index.lock first, so a held lock or a patch that does not apply changes nothing.
  #settle({ id, from, to, move, scratch }) {
    let lock = null
    try {
      if (move) {
        fs.rmSync(scratch, { force: true })
        try {
          const real = this.gitPath('index')
          if (fs.existsSync(real)) fs.copyFileSync(real, scratch)
          const extra = { GIT_INDEX_FILE: scratch }
          let carried = false
          if (move.old) {
            const patch = this.#diff(move.old, move.new)
            carried = !patch.length || this.run(['apply', '--cached', '--binary', '--whitespace=nowarn', '-'], { input: patch, extra }).status === 0
          }
          if (!carried) this.git(['read-tree', '-m', move.new], { extra })
          const lockPath = this.gitPath('index.lock')
          let fd
          try {
            fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644)
          } catch {
            throw new OffloadError('failed', `another git command holds ${lockPath}; nothing changed, try again`)
          }
          lock = lockPath
          fs.writeSync(fd, fs.readFileSync(scratch))
          fs.closeSync(fd)
        } finally {
          fs.rmSync(scratch, { force: true })
        }
      }
      const patch = this.#diff(from, to)
      if (patch.length && this.run(['apply', '--binary', '--whitespace=nowarn', '-'], { input: patch }).status !== 0) return false
      if (move && lock) {
        if (move.old) this.git(['update-ref', `refs/box/pre-back/${id}`, move.old])
        const sym = this.run(['symbolic-ref', '-q', 'HEAD'])
        const ref = sym.status === 0 && sym.text ? [sym.text] : ['--no-deref', 'HEAD']
        this.git(['update-ref', '-m', 'box back', ...ref, move.new, ...(move.old ? [move.old] : [])])
        fs.renameSync(lock, this.gitPath('index'))
        lock = null
        this.run(['update-index', '-q', '--refresh'])
      }
      return true
    } finally {
      if (lock) fs.rmSync(lock, { force: true })
    }
  }

  // diff is a binary patch between two trees that the user's diff settings cannot change.
  #diff(from, to) {
    const r = this.run([
      'diff-tree', '-p', '--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color',
      '--src-prefix=a/', '--dst-prefix=b/', from, to,
    ])
    if (r.status !== 0) throw new OffloadError('failed', `git diff-tree: ${r.error}`)
    return r.out
  }

  #branch(box, conflicts, now) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    const name = `box/back-${stamp}`
    this.git(['branch', '-f', name, box])
    return { kind: 'branch', branch: name, conflicts }
  }
}

const left = (paths) => (paths && paths.length ? `; uncommitted: ${paths.join(', ')}` : '')

export function landingSummary(l) {
  switch (l.kind) {
    case 'unchanged':
      return 'unchanged: the box made no change'
    case 'fastForward':
      return l.head
        ? `fast-forward: this branch now points at the box's commit ${l.head.slice(0, 7)}${left(l.uncommitted)}`
        : `fast-forward: the box made no commit; its changes are applied uncommitted (${(l.uncommitted || []).join(', ')})`
    case 'merged':
      return l.head
        ? `merged: this branch now points at the box's commit ${l.head.slice(0, 7)}; the changes you made meanwhile are kept${left(l.uncommitted)}`
        : `merged: the box's changes are applied uncommitted (${l.files.join(', ')})`
    case 'branch':
      return (
        `conflict: the box's work is on the branch ${l.branch}; your work tree is untouched` +
        (l.conflicts.length ? ` (it conflicts with, or would change your uncommitted, ${l.conflicts.join(', ')})` : '')
      )
    default:
      return l.kind
  }
}
