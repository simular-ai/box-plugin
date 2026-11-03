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
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600)
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  assert.deepEqual(store.get('https://e'), { token: 'cb_x', source: 'browser' })
  const env = new TokenStore(dir, { BOX_TOKEN: 'cb_env' })
  assert.deepEqual(env.get('https://e'), { token: 'cb_env', source: 'env' })
  assert.deepEqual(env.saved('https://e'), { token: 'cb_x', source: 'browser' })
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes('cb_env'))
  assert.equal(store.remove('https://e'), true)
  assert.equal(store.get('https://e'), null)
})

test('endpoint: BOX_ENDPOINT, else the origin of BOX_MCP_URL, else prod; https only off localhost', () => {
  assert.equal(endpointUrl({}), 'https://relay.simular.cloud')
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
