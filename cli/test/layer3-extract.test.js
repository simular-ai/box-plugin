import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractRun } from '../e2e/layer3/extract.mjs'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
const line = (o) => JSON.stringify(o)
const transcript = [
  line({ type: 'system', subtype: 'init' }),
  line({ type: 'assistant', message: { content: [{ type: 'text', text: 'The desktop is empty. I will open a terminal.' }, { type: 'tool_use', id: 't1', name: 'mcp__box__screenshot', input: {} }] } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '1280x800' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] } }),
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__box__computer_act', input: { action: 'type', text: 'claude' } }] } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'denied' }] } }),
  line({ type: 'result', subtype: 'success', result: 'Connected.\nRESULT: stuck: the consent page never loaded', num_turns: 3, total_cost_usd: 0.1 }),
].join('\n')

test('extractRun writes one step per tool call, its screenshots, and the driver claim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer3-'))
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), transcript)

  const { final } = extractRun(dir)
  const steps = fs.readFileSync(path.join(dir, 'steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

  assert.equal(steps.length, 2)
  assert.equal(steps[0].note, 'The desktop is empty. I will open a terminal.')
  assert.deepEqual(steps[0].screenshots, ['screenshots/000.png'])
  assert.equal(steps[0].result, '1280x800')
  assert.ok(fs.readFileSync(path.join(dir, 'screenshots/000.png')).subarray(1, 4).equals(Buffer.from('PNG')))
  assert.equal(steps[1].isError, true)
  assert.equal(steps[1].result, 'denied')
  assert.equal(final.claim, 'stuck: the consent page never loaded')
})
