import assert from 'node:assert/strict'
import test from 'node:test'
import { funnelFrom, liveGrantsOf, runGrants } from '../e2e/layer3/funnel.mjs'

const grant = (id, clientName, createdAtMs, usedAtMs = 0) => ({ id, clientName, clientHost: '', createdAtMs, usedAtMs, maxBoxes: 2, boxIds: [] })
const window = { app: 'claude-code-cli', startedAtMs: 1000, endedAtMs: 2000 }

test('only grants the cell app created inside the run window belong to the run', () => {
  const grants = [
    grant('oag_before', 'Claude Code', 500, 1500),
    grant('oag_connector', 'Claude', 1200, 1300),
    grant('oag_run', 'Claude Code', 1500, 1600),
    grant('oag_after', 'Claude Code', 2500),
  ]
  assert.deepEqual(runGrants(grants, window).map((g) => g.id), ['oag_run'])
})

test('a live grant the cell app already holds is found, an expired one or another client is not', () => {
  const grants = [{ ...grant('oag_live', 'Claude Code', 100), expiresAtMs: 9000 }, { ...grant('oag_old', 'Claude Code', 100), expiresAtMs: 500 }, { ...grant('oag_web', 'Claude', 100), expiresAtMs: 9000 }]
  assert.deepEqual(liveGrantsOf(grants, 'claude-code-cli', 1000).map((g) => g.id), ['oag_live'])
})

test('the funnel reports approval and first use from the run grants', () => {
  const none = funnelFrom([])
  assert.equal(none.approved, false)
  assert.equal(none.used, false)

  const f = funnelFrom([grant('oag_run', 'Claude Code', 1500, 1600)])
  assert.equal(f.approved, true)
  assert.equal(f.used, true)
  assert.equal(f.grants[0].approvedAt, new Date(1500).toISOString())
})
