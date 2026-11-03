import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import grpc from '@grpc/grpc-js'
import { loadServices } from '../../src/box/connection.js'

// FakeBox is a local stand-in for the relay and one box: Boxes.List/Ensure, and Session.Exec running `bash -c` in a
// workspace directory with a fake `cocoonbox-agent` first on PATH. It checks the bearer token and the box header as the
// edge does, so the CLI's real gRPC, rsh, rsync and git paths run against it.

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const TOKEN = 'cb_test_token'

export async function startFakeBox({ workspace, state, box = { id: 'cb-test', name: 'main', state: 'BOX_STATE_RUNNING', image: 'sbxdesk:v7' }, env = {} }) {
  const { Session, Boxes } = loadServices()
  const server = new grpc.Server()
  const calls = []
  const authed = (call) => {
    const auth = call.metadata.get('authorization')[0]
    if (auth !== `Bearer ${TOKEN}`) return { code: grpc.status.UNAUTHENTICATED, details: auth ? 'invalid bearer token' : 'missing bearer token' }
    return null
  }
  server.addService(Boxes.service, {
    List(call, cb) {
      const err = authed(call)
      if (err) return cb(err)
      calls.push('List')
      cb(null, { boxes: [box] })
    },
    Ensure(call, cb) {
      const err = authed(call)
      if (err) return cb(err)
      calls.push('Ensure')
      box.state = 'BOX_STATE_RUNNING'
      cb(null, { box })
    },
  })
  server.addService(Session.service, {
    Exec(call) {
      const err = authed(call)
      if (err) return call.destroy(Object.assign(new Error(err.details), err))
      if (call.metadata.get('x-cocoonbox-box')[0] !== box.id) {
        return call.destroy(Object.assign(new Error('no such box'), { code: grpc.status.NOT_FOUND }))
      }
      let child = null
      call.on('data', (frame) => {
        if (!child) {
          if (frame.body !== 'start') return call.destroy(Object.assign(new Error('first frame must be start'), { code: grpc.status.INVALID_ARGUMENT }))
          calls.push(frame.start.command)
          child = spawn('bash', ['-c', frame.start.command], {
            cwd: workspace,
            detached: true,
            env: { ...process.env, ...env, PATH: `${path.join(HERE, 'bin')}:${process.env.PATH}`, FAKE_BOX_STATE: state, FAKE_BOX_WORKSPACE: workspace },
          })
          child.stdin.on('error', () => {})
          child.stdout.on('data', (d) => {
            if (!call.write({ stdout: d })) {
              child.stdout.pause()
              call.once('drain', () => child.stdout.resume())
            }
          })
          child.stderr.on('data', (d) => call.write({ stderr: d }))
          child.on('close', (code, signal) => {
            call.write({ exit_code: code ?? 128 + (signal === 'SIGINT' ? 2 : 15) })
            call.end()
          })
          return
        }
        if (frame.body === 'stdin') child.stdin.write(frame.stdin)
        else if (frame.body === 'eof') child.stdin.end()
        else if (frame.body === 'signal') {
          try {
            process.kill(-child.pid, frame.signal === 'EXEC_SIGNAL_INT' ? 'SIGINT' : 'SIGTERM')
          } catch {
            // gone
          }
        }
      })
      call.on('end', () => child?.stdin.end())
      call.on('cancelled', () => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // gone
        }
      })
    },
  })
  const port = await new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p))),
  )
  return { endpoint: `http://127.0.0.1:${port}`, calls, box, stop: () => new Promise((r) => server.tryShutdown(r)) }
}
