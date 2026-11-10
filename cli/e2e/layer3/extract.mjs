// Turn a Claude Code stream-json transcript into the run folder's steps.jsonl and screenshots/.
import fs from 'node:fs'
import path from 'node:path'

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const blocks = (m) => (Array.isArray(m?.message?.content) ? m.message.content : [])

function summarize(content) {
  if (typeof content === 'string') return content.slice(0, 2000)
  return (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').slice(0, 2000)
}

/** Parse stream-json lines into { steps, images, final }. Pure: no file access. */
export function parseTranscript(lines) {
  const steps = []
  const byId = new Map()
  const images = []
  let note = ''
  let final = null
  for (const line of lines) {
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    if (msg.type === 'assistant') {
      for (const b of blocks(msg)) {
        if (b.type === 'text') note = note ? `${note}\n${b.text}` : b.text
        if (b.type === 'tool_use') {
          const step = { i: steps.length, tool: b.name, input: b.input, note: note.trim(), result: null, isError: false, screenshots: [] }
          steps.push(step)
          byId.set(b.id, step)
          note = ''
        }
      }
    } else if (msg.type === 'user') {
      for (const b of blocks(msg)) {
        if (b.type !== 'tool_result') continue
        const step = byId.get(b.tool_use_id)
        if (!step) continue
        step.result = summarize(b.content)
        step.isError = Boolean(b.is_error)
        for (const c of Array.isArray(b.content) ? b.content : []) {
          if (c.type !== 'image' || c.source?.type !== 'base64') continue
          const file = `screenshots/${String(step.i).padStart(3, '0')}${step.screenshots.length ? `-${step.screenshots.length}` : ''}.${EXT[c.source.media_type] || 'png'}`
          step.screenshots.push(file)
          images.push({ file, data: c.source.data })
        }
      }
    } else if (msg.type === 'result') {
      final = { text: msg.result ?? '', subtype: msg.subtype, turns: msg.num_turns, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms }
    }
  }
  const claim = /RESULT:\s*(done|stuck(?::.*)?)\s*$/im.exec(final?.text || '')?.[1] ?? null
  return { steps, images, final: final && { ...final, claim, trailingNote: note.trim() || undefined } }
}

/** Write steps.jsonl and screenshots/ into runDir from its transcript.jsonl. */
export function extractRun(runDir) {
  const lines = fs.readFileSync(path.join(runDir, 'transcript.jsonl'), 'utf8').split('\n')
  const parsed = parseTranscript(lines)
  fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true })
  for (const img of parsed.images) fs.writeFileSync(path.join(runDir, img.file), Buffer.from(img.data, 'base64'))
  fs.writeFileSync(path.join(runDir, 'steps.jsonl'), parsed.steps.map((s) => JSON.stringify(s)).join('\n') + (parsed.steps.length ? '\n' : ''))
  return parsed
}
