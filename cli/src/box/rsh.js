import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, stateName } from './connection.js'

// rsh runs a command in a box with this process's stdin, stdout and stderr, ssh-style, so rsync and git can use it as their
// remote shell (contracts.md "Remote command", upstream `cocoonbox rsh`). It exits with the command's code, or 255 for its
// own failures.

export const RSH_USAGE = 'usage: npx @simular-ai/box rsh [--box NAME|ID] [-t] [-l USER] [HOST] COMMAND...'
export const RSH_FAILURE = 255
const MAX_TERMINFO = 256 << 10

/** parseRsh splits rsh's argv into options and the words after them. */
export function parseRsh(argv) {
  const options = {}
  let i = 0
  for (; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      i++
      break
    }
    if (!a.startsWith('-')) break
    if (a === '-t') {
      options.tty = true
      continue
    }
    if (!['--box', '--endpoint', '-l'].includes(a) || i + 1 >= argv.length) throw new Error(`unknown option ${a}\n${RSH_USAGE}`)
    options[a.replace(/^-+/, '')] = argv[++i]
  }
  return { options, words: argv.slice(i) }
}

/**
 * pickBox resolves the box and drops rsync's or git's host word. --box wins: a first word that is `box` or names one of
 * the user's boxes is dropped as the host. Without --box, the first word names the box.
 */
export function pickBox(boxes, boxRef, words) {
  const host = (w) => w.split('@').pop()
  const named = (w) => boxes.find((b) => b.id === host(w) || b.name === host(w))
  const rest = [...words]
  let box
  if (boxRef) {
    box = boxes.find((b) => b.id === boxRef || b.name === boxRef)
    if (!box) throw new Error(`no box named ${boxRef}; yours: ${boxes.map((b) => b.name).join(', ') || 'none'}`)
    if (rest.length && (host(rest[0]) === 'box' || named(rest[0]))) rest.shift()
  } else {
    box = rest.length ? named(rest[0]) : null
    if (!box) throw new Error(`name the box with --box or as the host\n${RSH_USAGE}`)
    rest.shift()
  }
  return { box, command: rest.join(' ') }
}

/** wake ensures box runs, reporting progress on stderr, and returns it as the list then shows it. */
export async function wake(connection, box, stderr = process.stderr) {
  if (box.state === 'BOX_STATE_RUNNING') return box
  stderr.write(`box: waking ${box.name}\n`)
  await connection.ensure(box.id)
  return connection.waitRunning(box.id, { onState: (s) => stderr.write(`box: ${box.name} is ${stateName(s)}\n`) })
}

/** terminfo is the local `infocmp -x` source of term, which a box without the entry compiles; empty when there is none. */
export function terminfo(term) {
  if (!term) return ''
  const r = spawnSync('infocmp', ['-x', term], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.status !== 0 || Buffer.byteLength(r.stdout || '') > MAX_TERMINFO) return ''
  return r.stdout
}

/**
 * Input is the frames sent after start: stdin chunks pulled one at a time as the stream asks (so a chunk or two at most
 * wait in memory), then eof; signals and window sizes jump the queue.
 */
export class Input {
  constructor(stdin) {
    this.urgent = []
    this.wake = null
    this.reader = stdin ? stdin[Symbol.asyncIterator]() : null
    this.pending = null
    this.ended = !stdin
    this.eofSent = false
  }

  send(frame) {
    this.urgent.push(frame)
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  #nextUrgent() {
    return new Promise((resolve) => (this.wake = resolve))
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.urgent.length) {
        yield this.urgent.shift()
        continue
      }
      if (this.ended) {
        if (!this.eofSent) {
          this.eofSent = true
          yield { eof: {} }
          continue
        }
        // after eof only signals and sizes go
        await this.#nextUrgent()
        continue
      }
      const urgent = this.#nextUrgent().then(() => null)
      this.pending ??= this.reader.next().then((v) => ({ v }))
      const got = await Promise.race([this.pending, urgent])
      if (!got) continue
      this.pending = null
      if (got.v.done) this.ended = true
      else yield { stdin: Buffer.isBuffer(got.v.value) ? got.v.value : Buffer.from(got.v.value) }
    }
  }
}

/** writeTo writes data to a stream and resolves when it may take more, so a slow local reader slows the box. */
export function writeTo(stream, data) {
  if (stream.write(data)) return undefined
  return new Promise((resolve) => stream.once('drain', resolve))
}

/**
 * attach runs start in box on this process's terminal or pipes. tap(buffer) sees every output chunk (sign-in watches for
 * its link). Resolves to the exit code; a second INT or TERM rejects with code 255.
 */
export async function attach(connection, boxId, start, { tty = false, tap = () => {}, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const input = new Input(stdin)
  const restore = []
  if (tty) {
    if (stdin.isTTY) {
      stdin.setRawMode(true)
      restore.push(() => stdin.setRawMode(false))
      const onResize = () => input.send({ resize: { rows: stdout.rows || 24, cols: stdout.columns || 80 } })
      process.on('SIGWINCH', onResize)
      restore.push(() => process.off('SIGWINCH', onResize))
    }
  }
  let call
  let forwarded = false
  const onSignal = (name) => () => {
    if (forwarded) {
      call?.cancel()
      for (const r of restore.splice(0)) r()
      process.exit(RSH_FAILURE)
    }
    forwarded = true
    input.send({ signal: name })
  }
  const int = onSignal('EXEC_SIGNAL_INT')
  const term = onSignal('EXEC_SIGNAL_TERM')
  process.on('SIGINT', int)
  process.on('SIGTERM', term)
  restore.push(() => {
    process.off('SIGINT', int)
    process.off('SIGTERM', term)
  })
  try {
    return await connection.exec(
      boxId,
      start,
      input,
      (data, isStderr) => {
        tap(data)
        return writeTo(isStderr ? stderr : stdout, data)
      },
      { onCall: (c) => (call = c) },
    )
  } finally {
    for (const r of restore.splice(0)) r()
    stdin?.pause?.()
  }
}

/** rsh is the `rsh` command; it never returns, exiting with the remote code or 255. */
export async function rsh(argv, { connect, env = process.env }) {
  const report = env.BOX_RSH_REPORT
  const fail = (message) => {
    if (report) {
      try {
        fs.writeFileSync(report, `failed: ${message.split('\n')[0]}\n`)
      } catch {
        // the caller only reads it when present
      }
    }
    process.stderr.write(`box rsh: ${message}\n`)
    return RSH_FAILURE
  }
  let parsed
  try {
    parsed = parseRsh(argv)
  } catch (err) {
    return fail(err.message)
  }
  let connection
  try {
    connection = connect(parsed.options.endpoint)
    const boxes = await connection.listBoxes()
    const { box, command } = pickBox(boxes, parsed.options.box, parsed.words)
    if (!command) return fail(`no command: rsh runs a command, not a login shell\n${RSH_USAGE}`)
    await wake(connection, box)
    const start = { command }
    let tty = false
    if (parsed.options.tty) {
      if (process.stdin.isTTY) {
        const t = env.TERM || ''
        start.tty = { term: t, window: { rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 }, terminfo: terminfo(t) }
        tty = true
      } else process.stderr.write('box rsh: no terminal for the command because stdin is not a terminal\n')
    }
    const code = await attach(connection, box.id, start, { tty })
    if (code === null) return fail('the box ended the command without an exit code')
    if (report) {
      try {
        fs.writeFileSync(report, `exit ${code}\n`)
      } catch {
        // best effort
      }
    }
    return code
  } catch (err) {
    return fail(describe(err))
  } finally {
    connection?.close()
  }
}
