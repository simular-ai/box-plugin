// Server-side evidence for a run, from the test account's OAuth grants, and the run's cleanup.
// A grant belongs to the run when it was created inside the run's window by the cell's client, so a
// grant the account held before the run (another app, a claude.ai connector) is never touched.

/** Clients by the name their OAuth metadata gives box's consent page. */
const CLIENT_NAMES = { 'claude-code': ['Claude Code'] }

export function runGrants(grants, { client, startedAtMs, endedAtMs }) {
  const names = CLIENT_NAMES[client]
  return grants.filter((g) => g.createdAtMs >= startedAtMs && g.createdAtMs <= endedAtMs && (!names || names.includes(g.clientName)))
}

/** Live grants the cell's client already holds. Consent renews such a grant instead of creating one. */
export function liveGrantsOf(grants, client, nowMs) {
  const names = CLIENT_NAMES[client] || []
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
