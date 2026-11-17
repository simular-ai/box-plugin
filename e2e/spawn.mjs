// spawnSync that also runs .cmd/.bat shims on Windows (npx.cmd, claude.cmd, ...), which Node
// refuses to spawn without a shell. A port of cross-spawn 7.0.6's Windows path
// (lib/parse.js and lib/util/escape.js, MIT), so e2e/ needs no npm install: the Claude directory
// review holds a package.json beside a lockfile, and this repo ships none.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { which } from './cli.mjs'

// See http://www.robvanderwoude.com/escapechars.php
const META = /([()\][%!^"`<>&|;, *?])/g
const escapeCommand = (cmd) => cmd.replace(META, '^$1')

function escapeArgument(arg, doubleEscapeMeta) {
  // Based on https://qntm.org/cmd: double the backslashes before a quote and at the end, escape
  // the quote, quote the whole argument, then escape cmd.exe's meta characters.
  arg = `${arg}`.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1')
  arg = `"${arg}"`.replace(META, '^$1')
  return doubleEscapeMeta ? arg.replace(META, '^$1') : arg
}

export function spawnSyncCross(bin, args = [], options = {}) {
  if (process.platform !== 'win32') return spawnSync(bin, args, options)
  const file = /[\\/]/.test(bin) ? bin : which(bin, options.env || process.env, 'win32') || bin
  if (/\.(?:com|exe)$/i.test(file)) return spawnSync(bin, args, options)
  // A cmd-shim in node_modules/.bin passes its arguments through cmd.exe a second time.
  const doubleEscape = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i.test(file)
  const line = [escapeCommand(path.normalize(bin)), ...args.map((a) => escapeArgument(a, doubleEscape))].join(' ')
  return spawnSync(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true,
  })
}
