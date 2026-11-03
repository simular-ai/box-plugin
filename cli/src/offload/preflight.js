import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { section } from './model.js'
import { runSync } from './run.js'

// The local half of the offload preflight (contracts.md "Offload", Preflight), ported from upstream OffloadPreflight.swift.
// A block stops with nothing changed; a warn, or a confirm (a warn naming the size), goes on only with the user's yes.
// The lsof and scutil checks run where those tools exist (macOS, most Linux); elsewhere they find nothing.

export const SIZE_LIMIT = 500_000_000
const MAC_TOOLS = new Set(['xcodebuild', 'xcrun', 'security', 'launchctl', 'open'])
const APPLE_PLATFORMS = new Set(['macOS', 'iOS', 'tvOS', 'watchOS', 'visionOS', 'macCatalyst', 'driverKit'])
const COMMON_NAMES = new Set([
  'HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TMPDIR', 'PWD', 'LANG', 'LC_ALL', 'CI', 'DEBUG', 'EDITOR', 'TZ',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
])

export const finding = (check, outcome, detail) => ({ check, outcome, detail })

/** imageFinding blocks an upstream cbdesk image older than v22; our sbxdesk images all carry the box packer, and begin checks the rest. */
export function imageFinding(image) {
  const m = /^cbdesk:v(\d+)/.exec(image || '')
  if (!m || Number(m[1]) >= 22) return null
  return finding('image', 'block', `the box runs ${image}, older than cbdesk:v22; upgrade the box first`)
}

export async function localFindings(repo, { handover, optedIn, env }) {
  const files = repo.run(['ls-files', '-z', '-c', '-o', '--exclude-standard']).out.toString('utf8').split('\0').filter(Boolean)
  let ignored = []
  try {
    ignored = repo.ignored()
  } catch {
    // reported by the caller's own ignored() call
  }
  const texts = configTexts(repo.top)
  return [
    ...macOSOnly(repo.top, files, handover),
    ...services(texts, repo.top, env),
    ...(await vpnHosts(repo, texts, env)),
    ...secrets(repo, ignored, handover, optedIn, env),
    ...carried(repo.top),
  ]
}

// ---------- macOS-only work ----------

export function macOSOnly(top, files, handover) {
  const used = [...new Set(commands(handover).filter((c) => MAC_TOOLS.has(c)))].sort()
  if (used.length) return [finding('macos-only', 'block', `the hand-over's Commands run ${used.join(', ')}, which the box (Linux) lacks`)]
  const markers = new Set()
  for (const file of files) {
    const parts = file.split('/')
    const bundle = parts.find((p) => p.endsWith('.xcodeproj') || p.endsWith('.xcworkspace'))
    if (bundle) markers.add(bundle)
    if (parts[parts.length - 1] === 'Podfile') markers.add(file)
    if (parts[0] === 'fastlane' && parts.length > 1) markers.add('fastlane/')
  }
  try {
    if (appleOnly(fs.readFileSync(path.join(top, 'Package.swift'), 'utf8'))) markers.add('Package.swift')
  } catch {
    // no manifest
  }
  if (!markers.size) return []
  return [finding('macos-only', 'warn', `the repo has an Apple target (${[...markers].sort().slice(0, 4).join(', ')}); the box cannot build or run it`)]
}

/** commands lists the programs the hand-over's Commands section runs, from its code spans. */
export function commands(handover) {
  const spans = section(handover, '## Commands').join('\n').split('`')
  const out = []
  spans.forEach((span, i) => {
    if (i % 2 === 0) return
    for (const part of span.split(/[;|&\n]/)) {
      const word = part.split(' ').filter(Boolean).find((w) => !w.includes('=') && !['sudo', 'env', 'time', 'exec', '$'].includes(w))
      if (word) out.push(path.posix.basename(word))
    }
  })
  return out
}

export function appleOnly(manifest) {
  const start = manifest.indexOf('platforms:')
  if (start < 0) return false
  const open = manifest.indexOf('[', start)
  const close = open < 0 ? -1 : manifest.indexOf(']', open)
  if (open < 0 || close < 0) return false
  const list = manifest.slice(open, close + 1)
  const names = [...list.matchAll(/\.([A-Za-z]+)\(/g), ...list.matchAll(/\.([A-Za-z]+)\s*[,\]]/g)].map((m) => m[1])
  return names.length > 0 && names.every((n) => APPLE_PLATFORMS.has(n))
}

// ---------- local services and hosts ----------

/** configTexts is the repo's .env* files, compose files and top-level config, which name services and hosts. */
export function configTexts(top) {
  let names = []
  try {
    names = fs.readdirSync(top)
  } catch {
    return []
  }
  names = names.filter((name) => {
    const lower = name.toLowerCase()
    return (
      lower.startsWith('.env') || lower.startsWith('docker-compose') || lower.startsWith('compose.') ||
      ['.toml', '.yaml', '.yml', '.json', '.ini', '.conf', '.properties'].some((s) => lower.endsWith(s))
    )
  })
  try {
    names.push(...fs.readdirSync(path.join(top, 'config')).map((n) => 'config/' + n))
  } catch {
    // no config/
  }
  const out = []
  for (const name of names.sort()) {
    try {
      const st = fs.statSync(path.join(top, name))
      if (!st.isFile() || st.size > 256 << 10) continue
      out.push({ name, text: fs.readFileSync(path.join(top, name), 'utf8') })
    } catch {
      // unreadable
    }
  }
  return out
}

export function services(texts, top, env) {
  const findings = []
  const lsof = runSync(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'cn'], { env, timeoutMs: 5000 })
  if (lsof.status === 0) {
    const listening = new Map()
    let command = ''
    for (const line of lsof.text.split('\n')) {
      if (line.startsWith('c')) command = line.slice(1)
      if (line.startsWith('n')) {
        const port = Number(line.split(':').pop())
        if (Number.isInteger(port)) listening.set(port, command)
      }
    }
    for (const [port, cmd] of [...listening].sort((a, b) => a[0] - b[0])) {
      const file = texts.find((t) => namesPort(port, t.text))?.name
      if (file) findings.push(finding('services', 'warn', `${cmd} listens on port ${port} on this computer, and ${file} names it; the box cannot reach it`))
    }
  }
  const compose = runSync(['docker', 'compose', 'ls', '--format', 'json'], { env, timeoutMs: 5000 })
  if (compose.status === 0) {
    try {
      for (const project of JSON.parse(compose.text)) {
        if (String(project.ConfigFiles || '').includes(top + '/')) {
          findings.push(finding('services', 'warn', `the docker compose project ${project.Name || ''} of this repo runs on this computer; the box has no container runtime`))
        }
      }
    } catch {
      // not JSON
    }
  }
  return findings
}

export function namesPort(port, text) {
  const p = String(port)
  return [
    new RegExp(`(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]):${p}\\b`),
    new RegExp(`port"?\\s*[:=]\\s*["']?${p}\\b`, 'i'),
    new RegExp(`["' -]${p}:[0-9]+`),
  ].some((re) => re.test(text))
}

export async function vpnHosts(repo, texts, env, { resolve = resolveHost } = {}) {
  const hosts = []
  const remotes = repo.run(['remote', '-v']).text
  for (const line of remotes.split('\n')) {
    const url = (line.split('\t')[1] || '').split(' ')[0]
    if (!url) continue
    try {
      const u = new URL(url)
      if (u.hostname) {
        hosts.push(u.hostname)
        continue
      }
    } catch {
      // scp-like host:path
    }
    const at = url.split(':')[0]
    hosts.push(at.split('@').pop())
  }
  for (const { text } of texts) for (const m of text.matchAll(/[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s"']+@)?([A-Za-z0-9.-]+)/g)) hosts.push(m[1])
  const split = splitDomains(env)
  const findings = []
  const seen = new Set()
  for (const host of hosts.map((h) => h.toLowerCase())) {
    if (seen.has(host) || seen.size >= 20) continue
    seen.add(host)
    if (host === 'localhost' || host.startsWith('127.') || !host.includes('.')) continue
    const domain = split.find((d) => host === d || host.endsWith('.' + d))
    if (domain) {
      findings.push(finding('vpn-hosts', 'warn', `${host} resolves through this computer's split DNS for ${domain} (a VPN); the box cannot reach it`))
      continue
    }
    const addresses = await resolve(host)
    if (addresses?.length && addresses.every(isPrivate)) {
      findings.push(finding('vpn-hosts', 'warn', `${host} resolves to a private address (${addresses[0]}); the box cannot reach it`))
    }
  }
  return findings
}

/** splitDomains is the domains of macOS's supplemental resolvers, as `scutil --dns` lists them; none elsewhere. */
export function splitDomains(env) {
  const r = runSync(['scutil', '--dns'], { env, timeoutMs: 5000 })
  if (r.status !== 0) return []
  return r.text
    .split('\n')
    .map((line) => {
      const i = line.indexOf(':')
      if (i < 0) return null
      const [k, v] = [line.slice(0, i).trim(), line.slice(i + 1).trim()]
      return k === 'domain' && !v.endsWith('.arpa') && v !== 'local' ? v.toLowerCase() : null
    })
    .filter(Boolean)
}

function resolveHost(host) {
  return Promise.race([
    dns.promises.lookup(host, { all: true }).then((a) => a.map((x) => x.address), () => null),
    new Promise((r) => setTimeout(() => r(null), 2000).unref()),
  ])
}

export function isPrivate(address) {
  const lower = address.toLowerCase()
  if (lower.includes(':')) return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
  const o = address.split('.').map(Number)
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x))) return false
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
}

// ---------- secrets, LFS and submodules ----------

export function secrets(repo, ignored, handover, optedIn, env) {
  const findings = []
  for (const p of ignored) {
    if (!p.endsWith('/') && path.posix.basename(p).startsWith('.env') && !optedIn.includes('file:' + p)) {
      findings.push(finding('secrets', 'warn', `${p} is git-ignored and stays on this computer; if the box needs it, opt it in: npx @simular-ai/box offload secrets add file:${p}`))
    }
  }
  const line = section(handover, '## Environment facts').find((l) => l.includes('Secrets needed:'))
  const needed = line ? line.split('Secrets needed:').pop().trim() : ''
  if (needed && !needed.toLowerCase().startsWith('none') && !optedIn.length) {
    findings.push(finding('secrets', 'warn', `the hand-over needs secrets (${needed}) and none are opted in for this repo`))
  }
  const pattern = `(os\\.Getenv\\(|process\\.env\\.|process\\.env\\[|env::var\\(|os\\.environ\\.get\\(|os\\.environ\\[|os\\.getenv\\()["']?[A-Z][A-Z0-9_]+`
  const grep = repo.run(['grep', '-h', '-o', '-I', '-E', pattern]).text
  const provided = new Set()
  for (const entry of optedIn.filter((e) => e.startsWith('file:'))) {
    let text = ''
    try {
      text = fs.readFileSync(path.join(repo.top, entry.slice(5)), 'utf8')
    } catch {
      // missing; offload reports it
    }
    for (const l of text.split('\n')) {
      const name = l.split('=')[0].replace('export ', '').trim()
      if (name) provided.add(name)
    }
  }
  const read = new Set(grep.split('\n').map((m) => m.split(/[(.["']/).filter(Boolean).pop()).filter(Boolean))
  const unset = [...read].filter((n) => env[n] !== undefined && !COMMON_NAMES.has(n) && !provided.has(n)).sort()
  if (unset.length) findings.push(finding('secrets', 'warn', `the code reads ${unset.slice(0, 10).join(', ')}, set on this computer and unset in the box`))
  return findings
}

export function carried(top) {
  const findings = []
  try {
    if (fs.readFileSync(path.join(top, '.gitattributes'), 'utf8').includes('filter=lfs')) {
      findings.push(finding('lfs', 'warn', 'Git LFS files are not carried; the box copy holds their pointers'))
    }
  } catch {
    // none
  }
  if (fs.existsSync(path.join(top, '.gitmodules'))) findings.push(finding('submodules', 'warn', 'submodule contents are not carried; the box copy holds only their commits'))
  return findings
}

export function sizeFinding(bytes) {
  if (bytes <= SIZE_LIMIT) return null
  return finding('size', 'confirm', `about ${(bytes / 1e6).toFixed(0)} MB to send to the box`)
}
