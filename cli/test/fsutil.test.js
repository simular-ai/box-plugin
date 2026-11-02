import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { updateFile } from '../src/fsutil.js'

test('updateFile backs up, writes atomically, and is a no-op when nothing changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-fs-'))
  const file = path.join(dir, 'a.json')
  fs.writeFileSync(file, 'old\n', { mode: 0o640 })
  const first = updateFile(file, () => 'new\n')
  assert.equal(first.changed, true)
  assert.equal(fs.readFileSync(first.backup, 'utf8'), 'old\n')
  assert.equal(fs.readFileSync(file, 'utf8'), 'new\n')
  assert.equal(fs.statSync(file).mode & 0o777, 0o640)
  const second = updateFile(file, () => 'new\n')
  assert.deepEqual(second, { changed: false, backup: null })
  assert.equal(fs.readdirSync(dir).length, 2)
})

test('updateFile creates new key files 0600 and tightens existing ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-fs-'))
  const fresh = path.join(dir, 'sub', 'new.env')
  updateFile(fresh, () => 'X=1\n', { mode: 0o600 })
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600)
  const loose = path.join(dir, 'loose.env')
  fs.writeFileSync(loose, 'A=1\n', { mode: 0o644 })
  updateFile(loose, (t) => t + 'B=2\n', { mode: 0o600 })
  assert.equal(fs.statSync(loose).mode & 0o777, 0o600)
})

test('dry run changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-fs-'))
  const file = path.join(dir, 'a.json')
  const res = updateFile(file, () => 'x', { dryRun: true })
  assert.equal(res.changed, true)
  assert.equal(fs.existsSync(file), false)
})
