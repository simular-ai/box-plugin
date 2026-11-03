import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'

// The protos are copied from simular-ai/box proto/ (see proto/README.md); the wire is the relay's native gRPC.
const PROTO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'proto')
const HEADER_BOX = 'x-cocoonbox-box'
// Exec chunks are at most 64 KiB on every hop (contracts.md "Remote command").
export const CHUNK = 64 << 10
// A box agent frame is far below this; the edge allows the same.
const MAX_MESSAGE = 16 << 20

let services
export function loadServices() {
  if (services) return services
  const def = protoLoader.loadSync(['cocoonbox/agent/v1/session.proto', 'cocoonbox/control/v1/boxes.proto'], {
    includeDirs: [PROTO_ROOT],
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: false,
    oneofs: true,
  })
  const pkg = grpc.loadPackageDefinition(def)
  services = { Session: pkg.cocoonbox.agent.v1.Session, Boxes: pkg.cocoonbox.control.v1.Boxes }
  return services
}

/** describe turns a gRPC error into one line for a person. */
export function describe(err) {
  if (err && typeof err.code === 'number') {
    const name = Object.keys(grpc.status).find((k) => grpc.status[k] === err.code) || String(err.code)
    if (err.code === grpc.status.UNAUTHENTICATED) return `box refused the sign-in (${err.details}); run: npx @simular-ai/box login`
    return `${name}: ${err.details || err.message}`
  }
  return err?.message || String(err)
}

/**
 * BoxConnection is the CLI's gRPC channel to the relay: Boxes for the box list and wake, Session.Exec to run a command
 * in a box. The token travels only in call metadata.
 */
export class BoxConnection {
  constructor(endpoint, token) {
    const url = new URL(endpoint)
    const target = `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`
    const creds = url.protocol === 'https:' ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
    const { Session, Boxes } = loadServices()
    const options = {
      'grpc.max_receive_message_length': MAX_MESSAGE,
      'grpc.max_send_message_length': MAX_MESSAGE,
      // HTTP/2 pings while a call is open, so a half-open stream (sleep, a network change) fails within ~45 s instead of
      // holding a raw terminal; the relay's load balancer answers them, and no ping goes out on an idle channel.
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 15000,
      'grpc.keepalive_permit_without_calls': 0,
    }
    this.endpoint = endpoint
    this.token = token
    this.boxes = new Boxes(target, creds, options)
    // Session shares the Boxes channel's options but is its own client, so a stalled Exec never holds a Boxes call.
    this.session = new Session(target, creds, options)
  }

  metadata(box) {
    const md = new grpc.Metadata()
    md.set('authorization', `Bearer ${this.token}`)
    if (box) md.set(HEADER_BOX, box)
    return md
  }

  #unary(method, request) {
    return new Promise((resolve, reject) => {
      this.boxes[method](request, this.metadata(), { deadline: Date.now() + 30000 }, (err, res) => (err ? reject(err) : resolve(res)))
    })
  }

  async listBoxes() {
    const res = await this.#unary('List', {})
    return res.boxes || []
  }

  async ensure(boxId) {
    return this.#unary('Ensure', { box_id: boxId })
  }

  /** waitRunning polls the box list until boxId runs, for at most timeoutMs. */
  async waitRunning(boxId, { timeoutMs = 180000, intervalMs = 2000, onState = () => {} } = {}) {
    const deadline = Date.now() + timeoutMs
    let last = ''
    for (;;) {
      const box = (await this.listBoxes()).find((b) => b.id === boxId)
      if (!box) throw new Error(`box ${boxId} is gone`)
      if (box.state === 'BOX_STATE_RUNNING') return box
      if (box.state === 'BOX_STATE_FAILED') throw new Error(`box ${box.name} failed to start${box.failure_reason ? `: ${box.failure_reason}` : ''}`)
      if (box.state !== last) onState(box.state)
      last = box.state
      if (Date.now() > deadline) throw new Error(`box ${box.name} is still ${stateName(box.state)} after ${Math.round(timeoutMs / 1000)} s`)
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }

  /**
   * exec runs start (`{command, tty?}`) in box. input is an async iterable of client frames after start
   * (`{stdin}`, `{eof: {}}`, `{signal}`, `{resize}`); it is read one frame at a time as the stream drains, so a slow box
   * slows the reader. onOutput(buffer, isStderr) may return a promise, which pauses the stream until it settles.
   * Resolves to the exit code, or null when the stream ended without one. The returned `call` lets a caller cancel.
   */
  exec(box, start, input, onOutput, { onCall = () => {} } = {}) {
    return new Promise((resolve, reject) => {
      const call = this.session.Exec(this.metadata(box))
      onCall(call)
      let code = null
      let settled = false
      const done = (fn, v) => {
        if (settled) return
        settled = true
        fn(v)
      }
      call.on('data', (frame) => {
        if (frame.body === 'exit_code') code = frame.exit_code ?? 0
        else if (frame.body === 'stdout' || frame.body === 'stderr') {
          const pending = onOutput(frame[frame.body] || Buffer.alloc(0), frame.body === 'stderr')
          if (pending && typeof pending.then === 'function') {
            call.pause()
            pending.then(() => call.resume(), (err) => {
              call.cancel()
              done(reject, err)
            })
          }
        }
      })
      call.on('error', (err) => {
        // A cancel after the exit code is ours; anything else is the transport's.
        if (code !== null && err.code === grpc.status.CANCELLED) return done(resolve, code)
        done(reject, err)
      })
      call.on('end', () => done(resolve, code))
      const write = (frame) =>
        new Promise((res) => {
          if (call.write(frame)) res()
          else call.once('drain', res)
        })
      ;(async () => {
        await write({ start })
        for await (const frame of input) {
          if (settled) return
          await write(frame)
        }
        call.end()
      })().catch((err) => {
        call.cancel()
        done(reject, err)
      })
    })
  }

  close() {
    this.boxes.close()
    this.session.close()
  }
}

export function stateName(state) {
  return String(state || '').replace(/^BOX_STATE_/, '').toLowerCase() || 'unknown'
}

/** frames turns parts (Buffers, or {file} paths read lazily) into stdin frames of at most CHUNK bytes, then eof. */
export async function* frames(parts) {
  for (const part of parts) {
    if (Buffer.isBuffer(part)) {
      for (let i = 0; i < part.length; i += CHUNK) yield { stdin: part.subarray(i, i + CHUNK) }
    } else if (part && part.file) {
      const stream = fs.createReadStream(part.file, { highWaterMark: CHUNK })
      for await (const chunk of stream) yield { stdin: chunk }
    }
  }
  yield { eof: {} }
}
