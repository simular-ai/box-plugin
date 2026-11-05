// cocoonbox Grants over gRPC-web with a personal key: list the caller's OAuth grants, revoke one.
// Hand-rolled protobuf for the two messages used here, so the e2e needs no generated code.
//   node e2e/layer3/grants.mjs list
export const GRANTS_URL = process.env.BOX_GRANTS_URL || 'https://relay.simular.cloud/grpc-web'
const SERVICE = 'cocoonbox.control.v1.Grants'

function varint(n) {
  const out = []
  let v = BigInt(n)
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v) b |= 0x80
    out.push(b)
  } while (v)
  return out
}

function encodeString(field, s) {
  const bytes = Buffer.from(s, 'utf8')
  return Buffer.from([...varint((field << 3) | 2), ...varint(bytes.length), ...bytes])
}

/** Decode one protobuf message into { field: [values] }; length-delimited values stay Buffers. */
function decode(buf) {
  const fields = {}
  let i = 0
  const readVarint = () => {
    let shift = 0n
    let v = 0n
    for (;;) {
      const b = buf[i++]
      v |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) return v
      shift += 7n
    }
  }
  while (i < buf.length) {
    const tag = Number(readVarint())
    const field = tag >> 3
    const wire = tag & 7
    let value
    if (wire === 0) value = readVarint()
    else if (wire === 2) {
      const len = Number(readVarint())
      value = buf.subarray(i, i + len)
      i += len
    } else if (wire === 1) {
      value = buf.subarray(i, i + 8)
      i += 8
    } else if (wire === 5) {
      value = buf.subarray(i, i + 4)
      i += 4
    } else throw new Error(`unsupported wire type ${wire}`)
    ;(fields[field] ??= []).push(value)
  }
  return fields
}

const str = (f, n) => (f[n]?.[0] ? f[n][0].toString('utf8') : '')
const num = (f, n) => Number(f[n]?.[0] ?? 0n)
const strs = (f, n) => (f[n] || []).map((b) => b.toString('utf8'))

function parseGrant(buf) {
  const f = decode(buf)
  return {
    id: str(f, 1),
    clientId: str(f, 2),
    clientName: str(f, 3),
    clientHost: str(f, 4),
    maxBoxes: num(f, 5),
    maxRunning: num(f, 6),
    boxIds: strs(f, 7),
    chosenBoxIds: strs(f, 8),
    createdAtMs: num(f, 9),
    expiresAtMs: num(f, 10),
    usedAtMs: num(f, 11),
  }
}

async function call(key, method, body) {
  const frame = Buffer.concat([Buffer.from([0, ...[24, 16, 8, 0].map((s) => (body.length >>> s) & 0xff)]), body])
  const res = await fetch(`${GRANTS_URL}/${SERVICE}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1', authorization: `Bearer ${key}` },
    body: frame,
    signal: AbortSignal.timeout(30000),
  })
  const buf = Buffer.from(await res.arrayBuffer())
  let message = null
  let trailers = ''
  for (let i = 0; i + 5 <= buf.length; ) {
    const flag = buf[i]
    const len = buf.readUInt32BE(i + 1)
    const payload = buf.subarray(i + 5, i + 5 + len)
    if (flag & 0x80) trailers += payload.toString('utf8')
    else message = payload
    i += 5 + len
  }
  const status = Number(res.headers.get('grpc-status') ?? /grpc-status:\s*(\d+)/i.exec(trailers)?.[1] ?? (res.ok ? 0 : -1))
  if (status !== 0) {
    const msg = decodeURIComponent(res.headers.get('grpc-message') || /grpc-message:\s*(.*)/i.exec(trailers)?.[1]?.trim() || `HTTP ${res.status}`)
    throw new Error(`Grants.${method}: grpc-status ${status}: ${msg}`)
  }
  return message ?? Buffer.alloc(0)
}

export async function listGrants(key) {
  const f = decode(await call(key, 'List', Buffer.alloc(0)))
  return (f[1] || []).map(parseGrant)
}

export async function revokeGrant(key, grantId) {
  await call(key, 'Revoke', encodeString(1, grantId))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: path } = await import('node:path')
  const { default: fs } = await import('node:fs')
  const env = path.join(path.dirname(new URL(import.meta.url).pathname), '.env')
  if (fs.existsSync(env)) process.loadEnvFile(env)
  if (!process.env.BOX_TOKEN) throw new Error('set BOX_TOKEN')
  for (const g of await listGrants(process.env.BOX_TOKEN)) {
    const at = (ms) => (ms ? new Date(ms).toISOString() : '-')
    console.log(`${g.id}  ${g.clientName.padEnd(24)}  created ${at(g.createdAtMs)}  used ${at(g.usedAtMs)}  boxes ${g.boxIds.length}`)
  }
}
