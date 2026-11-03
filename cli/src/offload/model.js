import crypto from 'node:crypto'
import path from 'node:path'

// Ported from upstream loomhand/cocoonbox macos/Sources/CocoonBoxKit/Offload.swift and SignInLink.swift
// (contracts.md "Offload"). The box side is cocoonbox-agent's, unchanged in simular-ai/box.

/** The box CLIs a task can continue in. */
export const KINDS = {
  claude: {
    title: 'Claude Code',
    executable: 'claude',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    login: 'claude auth login',
    hosts: ['claude.ai', 'claude.com', 'anthropic.com'],
  },
  codex: {
    title: 'Codex',
    executable: 'codex',
    install: 'curl -fsSL https://github.com/openai/codex/releases/latest/download/install.sh | CODEX_NON_INTERACTIVE=1 sh',
    login: 'codex login --device-auth',
    hosts: ['auth.openai.com', 'chatgpt.com'],
  },
  cursor: {
    title: 'Cursor',
    executable: 'cursor-agent',
    install: 'curl -fsSL https://cursor.com/install | bash',
    login: 'cursor-agent login',
    hosts: ['cursor.com'],
  },
}

export function kind(name) {
  const k = KINDS[name]
  if (!k) throw new Error('--kind is claude, codex or cursor')
  return { name, ...k }
}

/** loginCommand keeps the box's browser shut, so the user approves on this computer. */
export function loginCommand(name) {
  return `BROWSER=true NO_OPEN_BROWSER=1 ${kind(name).login}`
}

/** currentKind is the coding agent this process runs under; only Claude Code says so. */
export function currentKind(env) {
  return env.CLAUDECODE === '1' ? 'claude' : null
}

// ---------- hand-over ----------

export const HANDOVER_TITLE = '# Hand-over: '
export const HANDOVER_HEADINGS = [
  '## Goal and definition of done',
  '## User preferences and constraints',
  '## Current state',
  '## Decisions made',
  '## Files touched',
  '## Next steps',
  '## Commands',
  '## Environment facts',
  '## Gotchas learned',
  '## Open questions',
]
export const HANDOVER_LIMIT = 256 << 10

export const HANDOVER_TEMPLATE = `# Hand-over: <one-line goal>

From: <local | box>   Agent: <claude|codex|cursor>   Repo: <path>   Branch: <branch> @ <short sha>

## Goal and definition of done
<what the user asked for, in their words where it matters; what "done" means>

## User preferences and constraints
<style, scope limits, things the user said not to do, deadlines; or none>

## Current state
<where the work stands in one paragraph: what works, what is broken, what is half-done>

## Decisions made
- <decision> — <why>; rejected: <alternative and why>

## Files touched
- \`<path>\` — <what changed and why; whether it is finished>

## Next steps
1. <the very next action, specific enough to start without asking>
2. <…>

## Commands
- Build: \`<command>\`   Test: \`<command>\`   Lint: \`<command>\`   Run: \`<command>\`
- Verify the current state: \`<command>\` → <what passing looks like>

## Environment facts
- Tools and versions: <go 1.26.x, rustc 1.9x, node 22.x, …; where each came from>
- Services: <local databases, ports, docker compose services; or none>
- Hosts: <APIs or internal hosts the task calls; or none>
- Secrets needed: <names only, never values; or none>
- Installed during this session: <packages and tools added; or none>

## Gotchas learned
- <non-obvious things that cost time: flaky tests, a wrong doc, a tool quirk>

## Open questions
- <what needs the user, and what to do meanwhile>
`

/** handoverProblems lists what breaks the template; empty for a valid hand-over. */
export function handoverProblems(text) {
  const problems = []
  if (Buffer.byteLength(text) > HANDOVER_LIMIT) problems.push(`larger than ${HANDOVER_LIMIT >> 10} KiB`)
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  if (!(lines[0] || '').startsWith(HANDOVER_TITLE)) problems.push(`the first line does not start with "${HANDOVER_TITLE}"`)
  for (const heading of HANDOVER_HEADINGS) {
    const count = lines.filter((l) => l.trim() === heading).length
    if (count === 0) problems.push(`missing "${heading}"`)
    if (count > 1) problems.push(`"${heading}" appears ${count} times`)
  }
  return problems
}

/** section returns the lines under heading, up to the next ## heading. */
export function section(text, heading) {
  let inside = false
  const out = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith('## ')) {
      inside = t === heading
      continue
    }
    if (inside) out.push(line)
  }
  return out
}

// ---------- names ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

/** repoKey is the first 12 hex of sha256 of the top level and the oldest root commit of HEAD. */
export function repoKey(top, root) {
  return sha256(`${top}\n${root}`).slice(0, 12)
}

/** copyName is the box copy's name before the box adds a -2, -3 suffix. */
export function copyName(top) {
  const mapped = [...path.basename(top)].map((c) => (/[A-Za-z0-9._-]/.test(c) ? c : '-')).join('')
  const name = mapped.replace(/^\.+/, '').slice(0, 64)
  return name || 'repo'
}

export function newId() {
  return crypto.randomBytes(6).toString('hex')
}

export function tmuxSession(record) {
  return `cb-off-${record.repo}-${record.kind}`
}

// ---------- sign-in link ----------

// The box is untrusted: only an https link on the vendor's own hosts may open in the local browser.
// eslint-disable-next-line no-control-regex
const OSC8 = /\x1B\]8;[^;\x07\x1B]*;([^\x07\x1B]+)(?:\x07|\x1B\\)/g
// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1B(?:\][^\x07\x1B]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g
// A link is only RFC 3986 URL characters; quotes, spaces, control bytes, ^ | < > \ { } and backticks end it.
const LINK = /https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+/g
const WHOLE_LINK = /^https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+$/

/** findSignInLink returns the first allowed link in output: an OSC 8 target, else a link in the text without escapes. */
export function findSignInLink(output, kindName) {
  const targets = [...output.matchAll(OSC8)].map((m) => m[1])
  const text = output.replace(ESCAPES, '')
  const links = [...text.matchAll(LINK)].map((m) => m[0].replace(/[.,;:!?)\]}]+$/, ''))
  for (const candidate of [...targets, ...links]) {
    // the parsed, normalized form is what opens; a target with characters outside a URL's is skipped
    if (WHOLE_LINK.test(candidate) && signInAllowed(candidate, kindName)) return new URL(candidate).href
  }
  return null
}

export function signInAllowed(link, kindName) {
  let url
  try {
    url = new URL(link)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return kind(kindName).hosts.some((h) => host === h || host.endsWith('.' + h))
}
