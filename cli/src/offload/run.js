import { spawn, spawnSync } from 'node:child_process'

/** runSync runs argv on env's PATH with input, collecting stdout and stderr as Buffers. */
export function runSync(argv, { cwd, env = process.env, input, timeoutMs } = {}) {
  const res = spawnSync(argv[0], argv.slice(1), { cwd, env, input, timeout: timeoutMs, maxBuffer: 1 << 30 })
  return {
    status: res.error ? 127 : (res.status ?? 1),
    out: res.stdout || Buffer.alloc(0),
    err: res.stderr || Buffer.from(res.error ? String(res.error.message) : ''),
    get text() {
      return this.out.toString('utf8').trim()
    },
    get error() {
      return this.err.toString('utf8').trim()
    },
  }
}

/** run is runSync without blocking the event loop, for commands that call back into this CLI (rsync and git over rsh). */
export function run(argv, { cwd, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    const err = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', (e) => err.push(Buffer.from(e.message)))
    child.on('close', (code) =>
      resolve({
        status: code ?? 1,
        out: Buffer.concat(out),
        err: Buffer.concat(err),
        get text() {
          return this.out.toString('utf8').trim()
        },
        get error() {
          return this.err.toString('utf8').trim()
        },
      }),
    )
  })
}

/** quote makes word one shell word for the box's bash -lc. */
export function quote(word) {
  return /^[A-Za-z0-9\-_./=:]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}
