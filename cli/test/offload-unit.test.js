import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from '../src/args.js'
import { endpointUrl } from '../src/box/endpoint.js'
import { authorizeUrl, browserLogin, challenge, deviceName } from '../src/box/login.js'
import { parseRsh, pickBox } from '../src/box/rsh.js'
import { TokenStore } from '../src/box/token-store.js'
import { HANDOVER_TEMPLATE, copyName, findSignInLink, handoverProblems, loginCommand, repoKey } from '../src/offload/model.js'
import { appleOnly, commands, imageFinding, isPrivate, macOSOnly, namesPort } from '../src/offload/preflight.js'
import { parseVersion } from '../src/offload/env-probe.js'
import { escape } from '../src/offload/offloader.js'
import { tarParts } from '../src/offload/tar.js'

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'box-unit-'))

test('hand-over template: the template itself passes; missing, repeated and title problems are listed', () => {
  const good = HANDOVER_TEMPLATE.replace('<one-line goal>', 'x')
  assert.deepEqual(handoverProblems(good), [])
  const missing = good.replace('## Gotchas learned\n', '')
  assert.deepEqual(handoverProblems(missing), ['missing "## Gotchas learned"'])
  assert.deepEqual(handoverProblems('x\n' + good), ['the first line does not start with "# Hand-over: "'])
  assert.match(handoverProblems(good + '\n## Commands\n').join(), /appears 2 times/)
  assert.match(handoverProblems(good + 'x'.repeat(256 << 10)).join(), /larger than 256 KiB/)
})

test('names: repo key, copy name', () => {
  assert.equal(repoKey('/a/b', 'abc'), repoKey('/a/b', 'abc'))
  assert.equal(repoKey('/a/b', '').length, 12)
  assert.notEqual(repoKey('/a/b', 'x'), repoKey('/a/c', 'x'))
  assert.equal(copyName('/x/my repo!'), 'my-repo-')
  assert.equal(copyName('/x/..hidden'), 'hidden')
  assert.equal(copyName('/x/' + 'a'.repeat(80)).length, 64)
  assert.equal(copyName('/x/日本'), '--')
})

test('sign-in link: only https on the vendor hosts, OSC 8 targets first, escapes stripped', () => {
  const osc = '\x1b]8;;https://claude.ai/oauth/authorize?code=1\x07click\x1b]8;;\x07'
  assert.equal(findSignInLink(`Visit ${osc}`, 'claude'), 'https://claude.ai/oauth/authorize?code=1')
  assert.equal(findSignInLink('go to \x1b[1mhttps://auth.openai.com/codex/device\x1b[0m.', 'codex'), 'https://auth.openai.com/codex/device')
  assert.equal(findSignInLink('https://evil.example/claude.ai http://claude.ai/x https://claude.ai.evil.com/', 'claude'), null)
  assert.equal(findSignInLink('https://user:pw@claude.ai/', 'claude'), null)
  assert.equal(findSignInLink('https://console.anthropic.com/oauth', 'claude'), 'https://console.anthropic.com/oauth')
  assert.equal(findSignInLink('https://claude.ai/x', 'codex'), null)
  assert.equal(loginCommand('claude'), 'BROWSER=true NO_OPEN_BROWSER=1 claude auth login')
})

test('tar stream: a ustar archive with a pax path that system tar reads', () => {
  const dir = tmpdir()
  const big = path.join(dir, 'big.bin')
  fs.writeFileSync(big, Buffer.alloc(70000, 7))
  const long = 'secrets/file/' + 'd/'.repeat(60) + 'x.env'
  const parts = tarParts([['handover.md', Buffer.from('hi\n')], ['offload.bundle', { file: big }], [long, Buffer.from('S=1\n')]])
  const buf = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : fs.readFileSync(p.file))))
  assert.equal(buf.length % 512, 0)
  const tarFile = path.join(dir, 'x.tar')
  fs.writeFileSync(tarFile, buf)
  const out = path.join(dir, 'out')
  fs.mkdirSync(out)
  execFileSync('tar', ['-xf', tarFile, '-C', out])
  assert.equal(fs.readFileSync(path.join(out, 'handover.md'), 'utf8'), 'hi\n')
  assert.equal(fs.statSync(path.join(out, 'offload.bundle')).size, 70000)
  assert.equal(fs.readFileSync(path.join(out, long), 'utf8'), 'S=1\n')
})

test('token store: 0600 file in a 0700 dir; BOX_TOKEN wins and is never written', () => {
  const dir = path.join(tmpdir(), '.simular-box')
  const store = new TokenStore(dir, {})
  assert.equal(store.get('https://e'), null)
  store.set('https://e', 'cb_x', 'browser')
  if (process.platform !== 'win32') {
    // Windows has no POSIX modes; the file sits in the user's profile
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600)
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  }
  assert.deepEqual(store.get('https://e'), { token: 'cb_x', source: 'browser' })
  const env = new TokenStore(dir, { BOX_TOKEN: 'cb_env' })
  assert.deepEqual(env.get('https://e'), { token: 'cb_env', source: 'env' })
  assert.deepEqual(env.saved('https://e'), { token: 'cb_x', source: 'browser' })
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes('cb_env'))
  assert.equal(store.remove('https://e'), true)
  assert.equal(store.get('https://e'), null)
})

test('endpoint: BOX_ENDPOINT, else the origin of BOX_MCP_URL, else prod; https only off localhost', () => {
  assert.equal(endpointUrl({}), 'https://mcp.box.simular.ai')
  assert.equal(endpointUrl({ BOX_MCP_URL: 'https://staging.relay.simular.cloud/mcp' }), 'https://staging.relay.simular.cloud')
  assert.equal(endpointUrl({ BOX_ENDPOINT: 'http://127.0.0.1:9' }), 'http://127.0.0.1:9')
  assert.throws(() => endpointUrl({ BOX_ENDPOINT: 'http://relay.example' }), /https/)
})

test('args: offload flags; a token is never an argument except --token -', () => {
  const a = parseArgs(['offload', 'send', '--interrupt', 'hello', 'there', '--box', 'main'])
  assert.deepEqual(a.rest, ['send', 'hello', 'there'])
  assert.equal(a.flags.box, 'main')
  assert.equal(a.flags.interrupt, true)
  assert.equal(parseArgs(['login', '--token', '-']).flags.token, '-')
  assert.throws(() => parseArgs(['login', '--token', 'cb_secret']), /never as an argument/)
  assert.throws(() => parseArgs(['login', '--token=cb_secret']), /never as an argument/)
})

test('rsh: options, host words and box choice', () => {
  assert.deepEqual(parseRsh(['--box', 'main', '-t', 'box', 'ls', '-la']), { options: { box: 'main', tty: true }, words: ['box', 'ls', '-la'] })
  assert.deepEqual(parseRsh(['-l', 'user', 'main', '--', 'x']).words, ['main', '--', 'x'])
  assert.throws(() => parseRsh(['-x']), /unknown option/)
  const boxes = [{ id: 'cb-1', name: 'main' }, { id: 'cb-2', name: 'other' }]
  assert.equal(pickBox(boxes, 'cb-1', ['box', 'rsync', '--server']).command, 'rsync --server')
  assert.equal(pickBox(boxes, 'main', ['u@other', 'ls']).command, 'ls')
  assert.equal(pickBox(boxes, 'main', ['ls']).command, 'ls')
  assert.equal(pickBox(boxes, null, ['other', 'git-upload-pack', "'/w/r'"]).box.id, 'cb-2')
  assert.throws(() => pickBox(boxes, null, ['nobox', 'ls']), /name the box/)
  assert.throws(() => pickBox(boxes, 'zzz', ['ls']), /no box named/)
})

test('preflight pieces', () => {
  assert.equal(imageFinding('sbxdesk:v7'), null)
  assert.equal(imageFinding('cbdesk:v22'), null)
  assert.equal(imageFinding('cbdesk:v21').outcome, 'block')
  const h = HANDOVER_TEMPLATE.replace('- Build: `<command>`', '- Build: `xcodebuild -scheme X && sudo /usr/bin/open .`')
  assert.deepEqual(commands(h).filter((c) => c === 'xcodebuild' || c === 'open'), ['xcodebuild', 'open'])
  assert.equal(macOSOnly('/nonexistent', [], h)[0].outcome, 'block')
  assert.equal(macOSOnly('/nonexistent', ['App.xcodeproj/project.pbxproj'], HANDOVER_TEMPLATE)[0].outcome, 'warn')
  assert.equal(appleOnly('platforms: [.macOS(.v14), .iOS(.v17)]'), true)
  assert.equal(appleOnly('platforms: [.macOS(.v14), .linux]'), false)
  assert.equal(namesPort(5432, 'DATABASE_URL=postgres://localhost:5432/x'), true)
  assert.equal(namesPort(5432, 'nothing'), false)
  assert.ok(isPrivate('10.1.2.3') && isPrivate('192.168.0.1') && isPrivate('100.64.0.1') && isPrivate('fd00::1'))
  assert.ok(!isPrivate('8.8.8.8'))
  assert.equal(parseVersion('go version go1.26.5 darwin/arm64'), '1.26.5')
  assert.equal(parseVersion('v22.11.0'), '22.11.0')
  assert.equal(escape('a*b?[c]\\d'), 'a\\*b\\?\\[c]\\\\d')
})

test('browser login: PKCE, state and issuer checked, the code redeemed for a device token', async () => {
  let issuer
  let seen
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      seen = Object.fromEntries(new URLSearchParams(body))
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'cb_device', token_type: 'Bearer' }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  issuer = `http://127.0.0.1:${server.address().port}`
  let authUrl
  try {
    const token = await browserLogin(issuer, {
      device: 'laptop',
      open: async (url) => {
        authUrl = new URL(url)
        const q = authUrl.searchParams
        // the consent page redirects back with the code, the state and the issuer
        const back = new URL(q.get('redirect_uri'))
        back.search = new URLSearchParams({ code: 'c1', state: q.get('state'), iss: issuer }).toString()
        setTimeout(() => fetch(back), 10)
      },
    })
    assert.equal(token, 'cb_device')
    assert.equal(authUrl.pathname, '/cb/oauth/authorize')
    assert.equal(authUrl.searchParams.get('client_id'), 'cocoonbox-cli')
    assert.equal(authUrl.searchParams.get('scope'), 'account')
    assert.equal(authUrl.searchParams.get('device_name'), 'laptop')
    assert.match(authUrl.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    assert.equal(seen.grant_type, 'authorization_code')
    assert.equal(seen.code, 'c1')
    assert.equal(challenge(seen.code_verifier), authUrl.searchParams.get('code_challenge'))
    await assert.rejects(
      browserLogin(issuer, {
        open: async (url) => {
          const q = new URL(url).searchParams
          setTimeout(() => fetch(`${q.get('redirect_uri')}?code=c&state=wrong&iss=${encodeURIComponent(issuer)}`), 10)
        },
      }),
      /another sign-in/,
    )
    await assert.rejects(
      browserLogin(issuer, {
        open: async (url) => {
          const q = new URL(url).searchParams
          setTimeout(() => fetch(`${q.get('redirect_uri')}?code=c&state=${q.get('state')}&iss=https://evil.example`), 10)
        },
      }),
      /not http/,
    )
  } finally {
    server.close()
  }
  assert.equal(deviceName('mac.local'), 'mac')
  assert.ok(authorizeUrl('https://e', { redirect: 'r', challenge: 'c', state: 's', device: 'd' }).startsWith('https://e/cb/oauth/authorize?'))
})

test('browser: one argv element, no shell, on every platform; win32 never goes through cmd', async () => {
  const { browserCommand, openBrowser } = await import('../src/box/browser.js')
  const evil = 'https://claude.ai/x?a=1&calc|whoami^%PATH%'
  for (const platform of ['win32', 'darwin', 'linux']) {
    const [cmd, args] = browserCommand(evil, { env: {}, platform })
    assert.notEqual(cmd, 'cmd')
    assert.equal(args[args.length - 1], new URL(evil).href, platform)
    assert.ok(!args.some((a) => a === '/c'))
  }
  assert.deepEqual(browserCommand(evil, { env: {}, platform: 'win32' }), ['rundll32', ['url.dll,FileProtocolHandler', new URL(evil).href]])
  assert.equal(browserCommand('file:///etc/passwd', { env: {} }), null)
  assert.equal(browserCommand('javascript:alert(1)', { env: {} }), null)
  const seen = []
  const fakeSpawn = (cmd, args, opts) => {
    seen.push({ cmd, args, opts })
    return { on: () => ({ unref() {} }) }
  }
  assert.equal(openBrowser(evil, { env: {}, platform: 'win32', spawn: fakeSpawn }), true)
  assert.equal(seen[0].opts.shell, false)
  assert.equal(seen[0].args.length, 2)
})

test('browser: a real opener gets the URL as one argument and no shell runs its metacharacters', { skip: process.platform === 'win32' }, async () => {
  const { openBrowser } = await import('../src/box/browser.js')
  const dir = tmpdir()
  const out = path.join(dir, 'argv.json')
  const pwned = path.join(dir, 'pwned')
  const opener = path.join(dir, 'opener')
  fs.writeFileSync(opener, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))\n`, { mode: 0o755 })
  const evil = `https://claude.ai/x?a=1&touch ${pwned};touch ${pwned}|touch ${pwned}^%PATH%$(touch ${pwned})`
  assert.equal(openBrowser(evil, { env: { BROWSER: opener } }), true)
  for (let i = 0; i < 100 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 20))
  const argv = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.deepEqual(argv, [new URL(evil).href])
  assert.ok(!fs.existsSync(pwned))
})

test('sign-in link: the normalized URL; | ^ and quotes end a link, a target with them is skipped', () => {
  assert.equal(findSignInLink('open https://claude.ai/x?&calc now', 'claude'), 'https://claude.ai/x?&calc')
  assert.equal(findSignInLink('https://claude.ai/x|calc', 'claude'), 'https://claude.ai/x')
  assert.equal(findSignInLink('https://claude.ai/x^calc', 'claude'), 'https://claude.ai/x')
  assert.equal(findSignInLink('\x1b]8;;https://claude.ai/x|calc\x07t\x1b]8;;\x07', 'claude'), null)
  assert.equal(findSignInLink('https://CLAUDE.ai/a%20b', 'claude'), 'https://claude.ai/a%20b')
})

test('tty escape: ~. at line start disconnects, ~~ sends ~, other ~ pass through', async () => {
  const { escapeFilter } = await import('../src/box/rsh.js')
  let gone = 0
  const f = escapeFilter(() => gone++)
  assert.deepEqual(f(Buffer.from('a~b')), { data: Buffer.from('a~b'), disconnect: false })
  assert.deepEqual(f(Buffer.from('\r~~x')), { data: Buffer.from('\r~x'), disconnect: false })
  assert.deepEqual(f(Buffer.from('\r~')), { data: Buffer.from('\r'), disconnect: false })
  assert.deepEqual(f(Buffer.from('q')), { data: Buffer.from('~q'), disconnect: false })
  assert.equal(gone, 0)
  assert.deepEqual(f(Buffer.from('\r~.')), { data: Buffer.from('\r'), disconnect: true })
  assert.equal(gone, 1)
  const g = escapeFilter(() => gone++)
  assert.equal(g(Buffer.from('~.')).disconnect, true, 'the first byte is a line start')
})

test('back pastes BACK again once when the box CLI never took it, and only after a paste', async () => {
  const { Offloader } = await import('../src/offload/offloader.js')
  const { OffloadStore } = await import('../src/offload/store.js')
  const home = tmpdir()
  const store = new OffloadStore(home)
  store.save({ id: 'id1', repo: 'k1', box: 'b', box_name: 'main', name: 'r', dir: '/w/r', kind: 'claude', base: null, top: null, started_at_ms: 0, seen: 0 })
  const run = async (firstDelivery) => {
    const sends = []
    let posted = false
    class Fake extends Offloader {
      async verb(args) {
        if (args[0] === 'status') return { sessions: [{ repo: 'k1', status: sends.length ? 'working' : 'idle', hook_at_ms: 5 }] }
        if (args[0] === 'send') {
          sends.push(args.slice(3).join(' '))
          if (sends.length === 2) posted = true
          return { delivery: sends.length === 1 ? firstDelivery : 'pasted' }
        }
        if (args[0] === 'read') {
          await new Promise((r) => setTimeout(r, 20))
          return { status: 'working', entries: posted ? [{ seq: 1, kind: 'back', offload_id: 'id1', body: '# Hand-over: x' }] : [] }
        }
        return { ok: true }
      }
    }
    const f = new Fake({ connection: { endpoint: 'e', token: 't' }, box: { id: 'b' }, store, rsh: 'x', env: {} })
    const out = await f.back('k1', { retryS: 0.05, waitS: 1, pollMs: 5 }).catch((e) => e)
    store.save({ id: 'id1', repo: 'k1', box: 'b', box_name: 'main', name: 'r', dir: '/w/r', kind: 'claude', base: null, top: null, started_at_ms: 0, seen: 0 })
    return { sends, out }
  }
  const pasted = await run('pasted')
  assert.deepEqual(pasted.sends, ['--back', '--back --interrupt'])
  assert.equal(pasted.out.handover, '# Hand-over: x')
  const queued = await run('queued')
  assert.deepEqual(queued.sends, ['--back'], 'a queued BACK is never re-sent')
  assert.match(queued.out.message, /has not handed the work back/)
})

test('back waits for the box agent to be idle twice in a row before asking for its hand-over', async () => {
  const { Offloader } = await import('../src/offload/offloader.js')
  const { OffloadStore } = await import('../src/offload/store.js')
  const home = tmpdir()
  const store = new OffloadStore(home)
  const record = { id: 'id1', repo: 'k1', box: 'b', box_name: 'main', name: 'r', dir: '/w/r', kind: 'claude', base: null, top: null, started_at_ms: 0, seen: 0 }
  const run = async (statuses, opts) => {
    store.save(record)
    const log = []
    let i = 0
    let sent = false
    class Fake extends Offloader {
      async verb(args) {
        if (args[0] === 'status') {
          const status = statuses[Math.min(i++, statuses.length - 1)]
          log.push(`status ${status}`)
          return { sessions: status === null ? [] : [{ repo: 'k1', status, hook_at_ms: 1 }] }
        }
        if (args[0] === 'send') {
          log.push(`send ${args.slice(3).join(' ')}`)
          sent = true
          return { delivery: 'accepted' }
        }
        if (args[0] === 'read') return { status: 'idle', entries: sent ? [{ seq: 1, kind: 'back', offload_id: 'id1', body: '# Hand-over: x' }] : [] }
        return { ok: true }
      }
    }
    const progress = []
    const f = new Fake({ connection: { endpoint: 'e', token: 't' }, box: { id: 'b' }, store, rsh: 'x', env: {} })
    f.progress = (m) => progress.push(m)
    const out = await f.back('k1', { waitS: 0.3, pollMs: 5, ...opts }).catch((e) => e)
    return { log, out, progress }
  }
  const busy = await run(['working', 'working', 'idle', 'working', 'idle', 'idle'])
  assert.deepEqual(busy.log.filter((l) => l.startsWith('status')).slice(0, 6), ['status working', 'status working', 'status idle', 'status working', 'status idle', 'status idle'])
  // one more status read after the wait records the hook time for the pasted-retry check
  assert.equal(busy.log.indexOf('send --back'), 7, 'BACK goes out only after two idle polls in a row')
  assert.equal(busy.out.handover, '# Hand-over: x')
  assert.match(busy.progress[0], /waiting for it to go idle/)

  const blocked = await run(['blocked', 'blocked'])
  assert.equal(blocked.log.indexOf('send --back'), 3, 'a session blocked by an unconfirmed delivery takes BACK again')

  const unknown = await run([null])
  assert.equal(unknown.log.indexOf('send --back'), 2, 'a box that reports no session status is not waited on')

  const never = await run(['working'])
  assert.ok(!never.log.some((l) => l.startsWith('send')), 'nothing is sent when it never goes idle')
  assert.match(never.out.message, /still working after .* nothing was sent.*back --interrupt/)

  const stopped = await run(['stopped'])
  assert.match(stopped.out.message, /stopped without handing the work back/)

  const interrupt = await run(['working'], { interrupt: true })
  assert.deepEqual(interrupt.log.filter((l) => l.startsWith('send')), ['send --back --interrupt'], '--interrupt skips the wait')
})

test('landing summaries say where HEAD went and what is left uncommitted', async () => {
  const { landingSummary } = await import('../src/offload/git.js')
  const head = 'ae472b8c0ffee00000000000000000000000000'
  assert.equal(landingSummary({ kind: 'fastForward', head, uncommitted: [] }), "fast-forward: this branch now points at the box's commit ae472b8")
  assert.equal(landingSummary({ kind: 'fastForward', head, uncommitted: ['b.txt'] }), "fast-forward: this branch now points at the box's commit ae472b8; uncommitted: b.txt")
  assert.equal(landingSummary({ kind: 'fastForward', head: null, uncommitted: ['a.txt'] }), "fast-forward: the box made no commit; its changes are applied uncommitted (a.txt)")
  assert.equal(
    landingSummary({ kind: 'merged', files: ['calc.py'], head, uncommitted: ['__pycache__/calc.pyc'] }),
    "merged: this branch now points at the box's commit ae472b8; the changes you made meanwhile are kept; uncommitted: __pycache__/calc.pyc",
  )
  assert.equal(landingSummary({ kind: 'merged', files: ['a.txt'], head: null, uncommitted: ['a.txt'] }), "merged: the box's changes are applied uncommitted (a.txt)")
})
