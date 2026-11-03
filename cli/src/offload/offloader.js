import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { frames } from '../box/connection.js'
import { envJson } from './env-probe.js'
import { GitRepo, OffloadError } from './git.js'
import { copyName, handoverProblems, kind as kindOf, newId } from './model.js'
import { finding, imageFinding, localFindings, sizeFinding } from './preflight.js'
import { quote, run, runSync } from './run.js'
import { tarParts } from './tar.js'

// Offloader is the local packer (design.md §27): the preflight, the snapshot, the transfer and the way back, over
// Session.Exec to `cocoonbox-agent offload` in the box and rsync and git over `rsh`. Ported from upstream
// loomhand/cocoonbox macos/Sources/CocoonBoxKit/Offloader.swift.

export const BACK_WAIT_S = 600

export class Offloader {
  /**
   * rsh is the remote-shell command rsync and git run (this CLI's `rsh --box <id>`); its children get the endpoint and
   * token through env, never argv.
   */
  constructor({ connection, box, store, rsh, env, progress = () => {} }) {
    this.connection = connection
    this.box = box
    this.store = store
    this.rsh = rsh
    this.env = { ...env, BOX_ENDPOINT: connection.endpoint, BOX_TOKEN: connection.token }
    this.progress = progress
  }

  // ---------- offload ----------

  async offload({ directory, kind, handover, yes }) {
    const problems = handoverProblems(handover)
    if (problems.length) throw new OffloadError('handover', `the hand-over breaks the template: ${problems.join('; ')}`)
    kindOf(kind)
    const timings = []
    let lap = Date.now()
    const mark = (step) => {
      timings.push([step, Date.now() - lap])
      lap = Date.now()
    }
    const findings = []
    const img = imageFinding(this.box.image)
    if (img) findings.push(img)
    const repo = GitRepo.open(directory, this.env)
    if (!repo) throw new OffloadError('refused', 'refused by the preflight; nothing changed', { findings: [finding('git', 'block', `${directory} is not in a git repository`)] })
    const key = repo.key
    const stage = this.store.directory(key)
    const excludes = path.join(stage, 'excludes')
    const bundle = path.join(stage, 'offload.bundle')
    const refs = []
    try {
      if (runSync(['rsync', '--version'], { env: this.env }).status !== 0) {
        findings.push(finding('rsync', 'block', 'rsync is not installed on this computer; offload copies the repo with it (macOS ships it; on Linux install the rsync package)'))
      }
      findings.push(...(await localFindings(repo, { handover, optedIn: this.store.secrets(key), env: this.env })))
      fs.writeFileSync(excludes, repo.ignored().map((p) => '/' + escape(p) + '\n').join(''))
      if (!this.store.sizeConfirmed(key)) {
        const size = sizeFinding(this.dryRun(repo, excludes, stage))
        if (size) findings.push(size)
      }
      mark('preflight')
      if (findings.some((f) => f.outcome === 'block')) throw refused(findings)

      const id = newId()
      const name = copyName(repo.top)
      let begin
      try {
        begin = await this.verb(['begin', '--repo', key, '--name', name, '--kind', kind, '--id', id])
      } catch (err) {
        if (err instanceof OffloadError && err.kind === 'box' && err.reply?.code === 'refused') {
          const refusal = replyFindings(err.reply)
          throw refused([...findings, ...(refusal.length ? refusal : [finding('box', 'block', err.message)])])
        }
        throw err
      }
      findings.push(...replyFindings(begin))
      mark('begin')
      if (findings.some((f) => f.outcome === 'block')) throw refused(findings)
      if (!yes && findings.length) throw new OffloadError('needsYes', "the preflight has warnings; go on only with the user's yes (--yes)", { findings })
      const dir = begin.dir
      if (!dir) throw new OffloadError('failed', 'begin named no directory')
      if (Array.isArray(begin.ignored) && begin.ignored.length) fs.appendFileSync(excludes, begin.ignored.map((p) => '/' + escape(p) + '\n').join(''))

      refs.push(`refs/cocoonbox/offload/${id}`, `refs/cocoonbox/index/${id}`)
      const record = {
        id, repo: key, box: this.box.id, box_name: this.box.name, name, dir, kind, base: null, top: repo.top,
        started_at_ms: Date.now(), seen: 0,
      }
      let sent = 0
      let sending = false
      let reply
      try {
        const members = [['handover.md', Buffer.from(handover)]]
        const index = path.join(stage, 'snapshot.index')
        const snapshot = repo.snapshot(index, `box offload ${id}`)
        record.base = snapshot
        repo.git(['update-ref', refs[0], snapshot])
        repo.keepIndex(refs[1], index)
        const env = envJson(repo.top, this.env)
        fs.writeFileSync(path.join(stage, 'env.json'), env)
        members.push(['env.json', Buffer.from(env)])
        mark('snapshot')
        sent = await this.rsync(repo, dir, excludes)
        mark('rsync')
        if (repo.bundle(bundle, Object.values(begin.refs || {}))) {
          members.push(['offload.bundle', { file: bundle }])
          sent += fs.statSync(bundle).size
        }
        if (repo.linked) {
          members.push(['HEAD', fs.readFileSync(repo.gitPath('HEAD'))])
          members.push(['index', fs.readFileSync(repo.gitPath('index'))])
        }
        for (const [n, data] of this.secrets(this.store.secrets(key), repo.top)) members.push([n, data])
        mark('bundle')
        this.store.save(record)
        sending = true
        reply = await this.verb(['send', '--repo', key, '--kind', kind, '--id', id], tarParts(members))
        mark('send')
      } catch (err) {
        // a send cut off in transit may have started the box CLI, so its record stays for back
        if (sending && !(err instanceof OffloadError)) {
          throw new OffloadError('failed', `the connection broke while the box took the task (${err.message}); check \`npx @simular-ai/box offload status\`, then offload again or bring it back`)
        }
        this.store.remove(key)
        for (const ref of refs) repo.run(['update-ref', '-d', ref])
        throw err
      }
      if (findings.some((f) => f.check === 'size')) this.store.confirmSize(key)
      const cli = begin.cli || {}
      if (cli.hooks_blocked) this.progress(`warning: ${cli.hooks_blocked} turns off the hooks the box reads the CLI's status from; it reads the transcript instead`)
      const account = cli.account ? `, signed in as ${cli.account}` : ''
      return { record, accepted: Boolean(reply.accepted), findings, cli: `${kindOf(kind).title} ${cli.version || ''}`.trim() + account, timings, sent }
    } finally {
      fs.rmSync(excludes, { force: true })
      fs.rmSync(bundle, { force: true })
    }
  }

  /** rsync copies the work tree and .git without its objects, leaving the box's ignored files alone; returns the bytes sent. */
  async rsync(repo, dir, excludes) {
    const report = path.join(path.dirname(excludes), 'rsh-report')
    fs.rmSync(report, { force: true })
    try {
      const argv = ['rsync', '-az', '--stats', '--delete', `--exclude-from=${excludes}`, '--exclude=/.git/objects/', ...(repo.linked ? ['--exclude=/.git'] : []), '-e', this.rsh, repo.top + '/', `box:${dir}/`]
      const r = await run(argv, { env: { ...this.env, BOX_RSH_REPORT: report } })
      if (r.status !== 0) {
        let side = 'rsh never reported, so it did not start or was killed'
        try {
          const text = fs.readFileSync(report, 'utf8')
          const [head, ...rest] = text.split('\n')
          const tail = rest.join('\n').trim()
          side = (head.startsWith('exit ') ? `the box command exited ${head.slice(5)}` : `rsh ${head}`) + (tail ? `, with stderr:\n${tail}` : '')
        } catch {
          // no report
        }
        throw new OffloadError('failed', `rsync to the box failed (${r.status}); ${side}\nrsync stderr:\n${r.error}`)
      }
      const line = r.text.split('\n').find((l) => l.startsWith('Total sent:') || l.startsWith('Total bytes sent:')) || ''
      return Number(line.replace(/[^0-9]/g, '')) || 0
    } finally {
      fs.rmSync(report, { force: true })
    }
  }

  /** dryRun is the bytes rsync would send to an empty copy. */
  dryRun(repo, excludes, stage) {
    const empty = fs.mkdtempSync(path.join(stage, 'dry-run-'))
    try {
      const argv = ['rsync', '-an', '--stats', `--exclude-from=${excludes}`, '--exclude=/.git/objects/', ...(repo.linked ? ['--exclude=/.git'] : []), repo.top + '/', empty + '/']
      const res = runSync(argv, { env: this.env }).text
      const line = res.split('\n').find((l) => l.startsWith('Total transferred file size:')) || ''
      return Number(line.replace(/[^0-9]/g, '')) || 0
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  }

  /** secrets reads the opted-in entries as stream members; values never reach argv, the environment or a log. */
  secrets(entries, top) {
    const home = this.env.HOME || os.homedir()
    const read = (file, name) => {
      try {
        return [name, fs.readFileSync(file)]
      } catch {
        throw new OffloadError('failed', `the opted-in secret ${name} is missing on this computer (${file})`)
      }
    }
    return entries.flatMap((entry) => {
      if (entry.startsWith('file:')) return [read(path.join(top, entry.slice(5)), 'secrets/file/' + entry.slice(5))]
      if (entry === 'aws') return [read(path.join(home, '.aws/credentials'), 'secrets/aws')]
      if (entry === 'kube') return [read((this.env.KUBECONFIG || '').split(':')[0] || path.join(home, '.kube/config'), 'secrets/kube')]
      if (entry === 'gcloud') {
        const root = path.join(home, '.config/gcloud')
        const out = []
        const walk = (dir) => {
          let list = []
          try {
            list = fs.readdirSync(dir, { withFileTypes: true })
          } catch {
            return
          }
          for (const d of list) {
            const full = path.join(dir, d.name)
            const rel = path.relative(root, full)
            if (rel.startsWith('logs')) continue
            if (d.isDirectory()) walk(full)
            else if (d.isFile()) out.push(read(full, 'secrets/gcloud/' + rel))
          }
        }
        walk(root)
        return out
      }
      if (entry.startsWith('ssh:')) return [read(path.join(home, '.ssh', entry.slice(4)), 'secrets/ssh/' + entry.slice(4))]
      throw new OffloadError('failed', `unknown secret entry ${entry}`)
    })
  }

  // ---------- back ----------

  /** back asks the box agent for its hand-over, waits for it, fetches the box's commits and lands them against S, then ends the box CLI session. */
  async back(key, { interrupt = false, onEntry = () => {}, waitS = BACK_WAIT_S } = {}) {
    const record = this.store.record(key)
    if (!record) throw new OffloadError('failed', 'nothing of this repo is in the box')
    let { entries } = await this.read(key, 0)
    let back = [...entries].reverse().find((e) => e.kind === 'back' && e.offload_id === record.id)
    let since = Math.max(0, ...entries.map((e) => e.seq))
    if (!back) {
      await this.verb(['send', '--repo', key, '--back', ...(interrupt ? ['--interrupt'] : [])], [Buffer.alloc(0)])
      this.progress('asked the box agent for its hand-over; waiting')
    }
    const deadline = Date.now() + waitS * 1000
    while (!back) {
      const left = Math.max(1, Math.ceil((deadline - Date.now()) / 1000))
      const res = await this.read(key, since, left)
      for (const entry of res.entries) {
        since = Math.max(since, entry.seq)
        if (entry.offload_id === record.id || !entry.offload_id) onEntry(entry)
        if (entry.kind === 'blocked') throw new OffloadError('failed', `the box agent stopped: ${entry.body}`)
      }
      back = [...res.entries].reverse().find((e) => e.kind === 'back' && e.offload_id === record.id)
      if (!back && res.status === 'stopped') throw new OffloadError('failed', 'the box CLI session stopped without handing the work back')
      if (!back && Date.now() >= deadline) {
        throw new OffloadError(
          'failed',
          `the box agent has not handed the work back after ${Math.round(waitS / 60)} min (status ${res.status}); BACK stays queued for its next idle. Run back again later, or back --interrupt to stop its current step`,
        )
      }
    }
    const file = this.store.back(key)
    fs.writeFileSync(file, back.body)
    let landing = null
    if (record.base && record.top) {
      const repo = GitRepo.open(record.top, this.env)
      if (!repo) throw new OffloadError('failed', `${record.top} is no longer a git repository`)
      const ref = `refs/cocoonbox/back/${record.id}`
      const fetch = await repo.runAsync(['fetch', '-q', `box:${record.dir}`, '+refs/heads/*:refs/cocoonbox/box/*', `+${ref}:${ref}`], {
        extra: { GIT_SSH_COMMAND: this.rsh, GIT_SSH_VARIANT: 'simple' },
      })
      if (fetch.status !== 0) throw new OffloadError('failed', `git fetch from the box failed (${fetch.status}):\n${fetch.error}`)
      landing = repo.land({ id: record.id, base: record.base, box: ref, index: path.join(this.store.directory(key), 'snapshot.index') })
    }
    await this.verb(['end', '--repo', key])
    this.store.remove(key)
    return { record, handover: back.body, file, landing }
  }

  // ---------- inbox ----------

  async read(key, since, wait) {
    const reply = await this.verb(['read', '--repo', key, '--since', String(since), ...(wait ? ['--wait', String(wait)] : [])])
    return { entries: reply.entries || [], status: reply.status || '' }
  }

  async status(key) {
    const reply = await this.verb(['status', ...(key ? ['--repo', key] : [])])
    return reply.sessions || []
  }

  /** send hands the box agent a message: pasted when it is idle, queued while it works. */
  async send(key, message, interrupt) {
    const reply = await this.verb(['send', '--repo', key, '--message', ...(interrupt ? ['--interrupt'] : [])], [Buffer.from(message)])
    return reply.delivery || ''
  }

  // ---------- transport ----------

  async verb(args, input = []) {
    const command = 'cocoonbox-agent offload ' + args.map(quote).join(' ')
    const { code, out, err } = await this.exec(command, input)
    const line = out.toString('utf8').split('\n').filter(Boolean).pop() || ''
    let reply
    try {
      reply = JSON.parse(line)
    } catch {
      const reason = err.split('\n').filter(Boolean).pop() || `exit ${code}`
      throw new OffloadError('failed', `the box cannot run \`cocoonbox-agent offload ${args[0]}\` (${reason}); upgrade the box (npx @simular-ai/box doctor)`)
    }
    if (code !== 0 || reply.ok !== true) throw new OffloadError('box', `the box said ${reply.code || 'failed'}: ${reply.error || `exit ${code}`}`, { reply })
    return reply
  }

  async exec(command, input = []) {
    const out = []
    let err = ''
    const code = await this.connection.exec(this.box.id, { command }, frames(input), (data, isStderr) => {
      if (!isStderr) return void out.push(data)
      const text = data.toString('utf8')
      err += text
      for (const l of text.split('\n')) if (l) this.progress(l)
    })
    if (code === null) throw new OffloadError('failed', `the box ended \`${command.slice(0, 60)}\` without an exit code`)
    return { code, out: Buffer.concat(out), err }
  }
}

function refused(findings) {
  return new OffloadError('refused', 'refused by the preflight; nothing changed', { findings })
}

/** replyFindings reads a box reply's findings, in begin's output and in its refusal. */
export function replyFindings(reply) {
  return (reply.findings || []).map((f) => finding(f.check || 'box', ['block', 'warn', 'confirm'].includes(f.outcome) ? f.outcome : 'warn', f.detail || ''))
}

/** escape makes a path a literal rsync pattern. */
export function escape(p) {
  return p.replace(/[*?[\\]/g, (c) => '\\' + c)
}
