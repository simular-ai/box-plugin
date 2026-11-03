import fs from 'node:fs'

// The send stream is a ustar archive of regular files, with a pax header for a path over 100 bytes (contracts.md "Send
// stream"). tarParts returns Exec stdin parts: Buffers and {file} parts that frames() reads lazily, so a large bundle is
// never held in memory. Ported from upstream ExecFrames.tar.

export function tarParts(members, { now = Math.floor(Date.now() / 1000) } = {}) {
  const parts = []
  for (const [name, part] of members) {
    const size = Buffer.isBuffer(part) ? part.length : fs.statSync(part.file).size
    if (Buffer.byteLength(name) > 100) {
      let length = 0
      let record = ''
      do {
        length = Buffer.byteLength(record)
        record = `${length} path=${name}\n`
      } while (Buffer.byteLength(record) !== length)
      parts.push(Buffer.concat([header('PaxHeader', length, 'x', now), pad(Buffer.from(record))]))
    }
    parts.push(header(Buffer.from(name).subarray(0, 100).toString('utf8'), size, '0', now))
    parts.push(part)
    parts.push(Buffer.alloc((512 - (size % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return parts
}

function pad(buf) {
  return Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)])
}

export function header(name, size, type, now) {
  const block = Buffer.alloc(512)
  const put = (text, offset) => Buffer.from(text).copy(block, offset)
  const octal = (value, offset, width) => put(value.toString(8).padStart(width - 1, '0'), offset)
  put(name, 0)
  octal(0o600, 100, 8)
  octal(0, 108, 8)
  octal(0, 116, 8)
  octal(size, 124, 12)
  octal(now, 136, 12)
  put('        ', 148)
  put(type, 156)
  put('ustar\u000000', 257)
  let sum = 0
  for (const b of block) sum += b
  octal(sum, 148, 7)
  block[155] = 0x20
  return block
}
