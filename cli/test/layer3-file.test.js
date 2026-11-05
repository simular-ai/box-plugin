import assert from 'node:assert/strict'
import test from 'node:test'
import { redact } from '../e2e/layer3/file.mjs'

test('redact masks email addresses and leaves other text alone', () => {
  assert.equal(redact('Signed in as someone.name+box@example.co.uk, then clicked Allow'), 'Signed in as [email], then clicked Allow')
  assert.equal(redact('box.simular.ai/sign-in'), 'box.simular.ai/sign-in')
})
