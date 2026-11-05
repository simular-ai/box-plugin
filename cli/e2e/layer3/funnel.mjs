// Server-side evidence for a run, from the test account's OAuth grants, and the run's cleanup.
// A grant belongs to the run when the cell's app created it inside the run's window, so a grant the
// account held before the run (another app, a claude.ai connector) is never touched.
import { APPS } from './cells.mjs'

const namesOf = (app) => APPS[app]?.names || []

export function runGrants(grants, { app, startedAtMs, endedAtMs }) {
  const names = namesOf(app)
  return grants.filter((g) => g.createdAtMs >= startedAtMs && g.createdAtMs <= endedAtMs && names.includes(g.clientName))
}

/** Live grants the cell's app already holds. Allowing again renews such a grant instead of creating one. */
export function liveGrantsOf(grants, app, nowMs) {
  const names = namesOf(app)
  return grants.filter((g) => names.includes(g.clientName) && (!g.expiresAtMs || g.expiresAtMs > nowMs))
}

export function funnelFrom(grants) {
  const at = (ms) => (ms ? new Date(ms).toISOString() : null)
  return {
    source: "box's list of apps connected to the test account",
    note: 'approved means someone clicked Allow on the box sign-in page during this run. used means the app then sent at least one request to box. box does not record which tools the app called, so only the screenshots show whether the task ran.',
    approved: grants.length > 0,
    used: grants.some((g) => g.usedAtMs > 0),
    grants: grants.map((g) => ({ id: g.id, clientName: g.clientName, clientHost: g.clientHost, approvedAt: at(g.createdAtMs), firstUsedAt: at(g.usedAtMs), maxBoxes: g.maxBoxes, boxesCreated: g.boxIds.length })),
  }
}
