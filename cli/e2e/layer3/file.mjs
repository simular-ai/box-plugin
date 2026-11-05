// File a judged run's improvements as GitHub issues with the local `gh`, once per run.
//   node e2e/layer3/file.mjs <runDir> [--dry-run]
// Product targets go to box-portal (private) with screenshots; `harness` goes to box-plugin (public)
// as text only; `client-docs` is listed, never filed. A repeat of an open issue becomes a comment.
import fs from 'node:fs'
import path from 'node:path'
import spawn from 'cross-spawn'

const PRIVATE_REPO = process.env.LAYER3_ISSUES_REPO || 'simular-ai/box-portal'
const PUBLIC_REPO = process.env.LAYER3_HARNESS_REPO || 'simular-ai/box-plugin'
const EVIDENCE_BRANCH = 'layer3-evidence'
const MAX_NEW = 3
const ROUTES = { 'install.md': PRIVATE_REPO, portal: PRIVATE_REPO, cli: PRIVATE_REPO, harness: PUBLIC_REPO }
const LABELS = { 'install.md': 'documentation', portal: 'bug', cli: 'bug', harness: 'enhancement' }
const FOOTER = '🤖 Filed by the layer 3 onboarding runs (simular-ai/box-plugin#11) with [Claude Code](https://claude.com/claude-code)'

function run(cmd, args, { input, allowFail = false } = {}) {
  const res = spawn.sync(cmd, args, { input, encoding: 'utf8', maxBuffer: 1 << 26 })
  if (res.error) throw res.error
  if (res.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${res.stderr || res.stdout}`)
  return res
}
const gh = (args, opts) => run('gh', args, opts)
const readJson = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
const readSteps = (dir) => fs.readFileSync(path.join(dir, 'steps.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

/** Ask a fresh model which open issue, if any, each improvement repeats. */
function matchOpenIssues(improvements, openIssues) {
  if (!openIssues.length) return improvements.map(() => null)
  const schema = { type: 'object', additionalProperties: false, required: ['matches'], properties: { matches: { type: 'array', items: { type: ['integer', 'null'] } } } }
  const prompt = [
    'For each proposed improvement, return the number of the open GitHub issue that describes the same problem, or null if none does. Same problem means a maintainer fixing that issue would also fix the improvement. Answer with one entry per improvement, in order.',
    '',
    'Improvements:',
    ...improvements.map((imp, i) => `${i}. [${imp.target}] ${imp.title}\n   ${imp.detail}`),
    '',
    'Open issues:',
    ...openIssues.map((iss) => `#${iss.number} ${iss.title}\n   ${(iss.body || '').replace(/\s+/g, ' ').slice(0, 400)}`),
  ].join('\n')
  const res = run('claude', ['-p', prompt, '--tools', '', '--strict-mcp-config', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--no-session-persistence'])
  const out = JSON.parse(res.stdout)
  const { matches } = out.structured_output ?? JSON.parse(out.result)
  const known = new Set(openIssues.map((i) => i.number))
  return improvements.map((_, i) => (known.has(matches[i]) ? matches[i] : null))
}

function ensureEvidenceBranch() {
  const ref = gh(['api', `repos/${PRIVATE_REPO}/git/ref/heads/${EVIDENCE_BRANCH}`], { allowFail: true })
  if (ref.status === 0) return
  const base = JSON.parse(gh(['api', `repos/${PRIVATE_REPO}`]).stdout).default_branch
  const sha = JSON.parse(gh(['api', `repos/${PRIVATE_REPO}/git/ref/heads/${base}`]).stdout).object.sha
  gh(['api', '-X', 'POST', `repos/${PRIVATE_REPO}/git/refs`, '-f', `ref=refs/heads/${EVIDENCE_BRANCH}`, '-f', `sha=${sha}`])
}

/** Upload one screenshot to the evidence branch and return a link that renders for repo readers. */
function uploadScreenshot(runDir, runId, file) {
  const dest = `layer3/${runId}/${file}`
  const body = JSON.stringify({ message: `layer3 evidence: ${runId} ${file}`, branch: EVIDENCE_BRANCH, content: fs.readFileSync(path.join(runDir, file)).toString('base64') })
  const res = gh(['api', '-X', 'PUT', `repos/${PRIVATE_REPO}/contents/${dest}`, '--input', '-'], { input: body, allowFail: true })
  if (res.status !== 0 && !/sha/i.test(res.stdout + res.stderr)) throw new Error(`upload ${dest}: ${res.stderr || res.stdout}`)
  return `https://github.com/${PRIVATE_REPO}/blob/${EVIDENCE_BRANCH}/${dest}?raw=true`
}

function evidence(runDir, run, steps, cited, { withScreenshots }) {
  const lines = []
  for (const i of [...new Set(cited)].sort((a, b) => a - b)) {
    const step = steps[i]
    if (!step) continue
    lines.push(`**Step ${i}.** ${step.note || '(no note)'}`)
    if (withScreenshots) for (const file of step.screenshots) lines.push(`![step ${i}](${uploadScreenshot(runDir, run.runId, file)})`)
  }
  return lines.join('\n\n')
}

/** Mask email addresses: recordings show the test account's screen. */
export const redact = (text) => text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')

function issueBody(imp, judge, run, evidenceText, { isPrivate }) {
  const reasons = isPrivate ? judge.reasons.filter((r) => r.steps.some((s) => imp.steps.includes(s))).map((r) => `- ${r.text}`) : []
  return [
    imp.detail,
    '',
    '## Where it showed up',
    '',
    `Run \`${run.runId}\`: cell \`${run.cell.name}\` (${run.cell.client}, ${run.clientVersion || 'version unknown'}, entry ${run.cell.entry}, auth ${run.cell.auth}). Verdict **${judge.verdict}**. Steps ${imp.steps.join(', ')}.`,
    ...(reasons.length ? ['', 'Judge:', '', ...reasons] : []),
    '',
    '## Evidence',
    '',
    evidenceText || (isPrivate ? '_No screenshots attached._' : '_This repo is public, so the recording stays private. Ask in #box for the run folder._'),
    '',
    FOOTER,
  ].join('\n')
}

function seenAgainBody(imp, judge, run, evidenceText) {
  return [`Seen again in run \`${run.runId}\` (${run.cell.name}, ${run.clientVersion || 'version unknown'}, verdict **${judge.verdict}**): ${imp.title}`, '', evidenceText, '', FOOTER].join('\n')
}

export function fileRun(runDir, { dryRun = false } = {}) {
  const filedPath = path.join(runDir, 'filed.json')
  if (fs.existsSync(filedPath)) return JSON.parse(fs.readFileSync(filedPath, 'utf8'))
  const run = readJson(runDir, 'run.json')
  const judge = readJson(runDir, 'judge.json')
  const steps = fs.existsSync(path.join(runDir, 'steps.jsonl')) ? readSteps(runDir) : []
  const results = []
  if (judge.verdict === 'blocked') {
    results.push(...judge.improvements.filter((i) => i.target === 'harness').map((imp) => ({ imp, action: 'skipped', why: 'blocked runs file only harness issues, and only by hand' })))
  }
  const fileable = judge.verdict === 'blocked' ? [] : judge.improvements
  const byRepo = new Map()
  for (const imp of fileable) {
    const repo = ROUTES[imp.target]
    if (!repo) {
      results.push({ imp, action: 'listed', why: `${imp.target} is for the client's maker` })
      continue
    }
    if (!byRepo.has(repo)) byRepo.set(repo, [])
    byRepo.get(repo).push(imp)
  }

  let created = 0
  for (const [repo, imps] of byRepo) {
    const open = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,title,body']).stdout)
    const matches = matchOpenIssues(imps, open)
    const isPrivate = repo === PRIVATE_REPO
    if (isPrivate && !dryRun && imps.some((imp) => imp.steps.length)) ensureEvidenceBranch()
    imps.forEach((imp, i) => {
      const ev = isPrivate ? evidence(runDir, run, steps, imp.steps, { withScreenshots: !dryRun }) : ''
      if (matches[i]) {
        if (!dryRun) gh(['issue', 'comment', String(matches[i]), '--repo', repo, '--body-file', '-'], { input: redact(seenAgainBody(imp, judge, run, ev)) })
        results.push({ imp, action: 'commented', repo, issue: matches[i] })
      } else if (created >= MAX_NEW) {
        results.push({ imp, action: 'skipped', why: `cap of ${MAX_NEW} new issues per run` })
      } else {
        created++
        let url = null
        if (!dryRun) {
          url = gh(['issue', 'create', '--repo', repo, '--title', redact(imp.title), '--label', LABELS[imp.target], '--body-file', '-'], { input: redact(issueBody(imp, judge, run, ev, { isPrivate })) }).stdout.trim()
        }
        results.push({ imp, action: 'created', repo, url })
      }
    })
  }

  const summary = results.map(({ imp, ...r }) => ({ target: imp.target, title: imp.title, ...r }))
  if (!dryRun) fs.writeFileSync(filedPath, JSON.stringify(summary, null, 2) + '\n')
  return summary
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, flag] = process.argv.slice(2)
  if (!dir) throw new Error('usage: node e2e/layer3/file.mjs <runDir> [--dry-run]')
  for (const r of fileRun(path.resolve(dir), { dryRun: flag === '--dry-run' })) {
    console.log(`${r.action.padEnd(9)} [${r.target}] ${r.title}${r.issue ? `  -> ${r.repo}#${r.issue}` : ''}${r.url ? `  -> ${r.url}` : ''}${r.why ? `  (${r.why})` : ''}`)
  }
}
