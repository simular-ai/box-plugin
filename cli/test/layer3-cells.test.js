import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadCells } from '../e2e/layer3/cells.mjs'

test('every cell in cells.json uses known values and has what a run needs', () => {
  const cells = loadCells()
  assert.ok(cells.size > 0)
  for (const [name, cell] of cells) {
    assert.match(name, /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/)
    for (const field of ['title', 'precheck', 'precheckHelp', 'handover', 'task']) assert.ok(cell[field], `${name}: ${field}`)
    assert.ok(cell.reset.length, `${name}: reset`)
  }
})

test('a cell with an unknown value is rejected by name', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cells-')), 'cells.json')
  fs.writeFileSync(file, JSON.stringify({ cells: [{ app: 'claude-code-cli', setup: 'paste-the-line', alreadySetUp: 'nothing', title: 'x' }] }))
  assert.throws(() => loadCells(file), /setup "paste-the-line" is not one of/)
})
