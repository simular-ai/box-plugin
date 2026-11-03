#!/usr/bin/env node
// Sets one plugin's version in box-portal's src/lib/plugin-versions.json, never moving it back.
//
//   node set-portal-version.mjs <manifest> <plugin> <version> [<pending-manifest>]
//
// <pending-manifest> is the same file on the open bump PR's branch, if there is one, so a re-run
// of an older release can't downgrade a PR that already carries a newer version. Writes
// `changed=true|false` and `current=<version>` to $GITHUB_OUTPUT when it is set.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const [manifestPath, plugin, version, pendingPath] = process.argv.slice(2)
const SEMVER = /^\d+\.\d+\.\d+$/

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

function compare(a, b) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

function output(changed, current) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\ncurrent=${current}\n`)
  }
}

if (!manifestPath || !plugin || !version) {
  fail('usage: set-portal-version.mjs <manifest> <plugin> <version> [<pending-manifest>]')
}
if (!SEMVER.test(version)) fail(`version "${version}" is not X.Y.Z`)
if (!existsSync(manifestPath)) fail(`${manifestPath} does not exist on box-portal`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!Object.hasOwn(manifest, plugin)) {
  fail(`"${plugin}" is not in ${manifestPath}; add it there by hand first`)
}
const current = manifest[plugin]
if (!SEMVER.test(current)) fail(`${manifestPath} has "${plugin}": "${current}", not X.Y.Z`)

let pending = null
if (pendingPath && existsSync(pendingPath)) {
  const value = JSON.parse(readFileSync(pendingPath, 'utf8'))[plugin]
  if (typeof value === 'string' && SEMVER.test(value)) pending = value
}

const newest = pending && compare(pending, current) > 0 ? pending : current
if (compare(version, newest) < 0) {
  console.log(`::notice::box-portal already has ${plugin} ${newest}; not moving it back to ${version}`)
  output(false, current)
} else if (compare(version, current) === 0) {
  console.log(`::notice::box-portal already links ${plugin} ${version}`)
  output(false, current)
} else {
  manifest[plugin] = version
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${plugin}: ${current} -> ${version}`)
  output(true, current)
}
