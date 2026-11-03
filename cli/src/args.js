// Tiny argument parser: no dependency for a handful of flags.
const BOOLEAN = new Set(['yes', 'json', 'dry-run', 'help', 'version', 'all'])
const VALUE = new Set(['client', 'auth', 'name'])
const ALIASES = { y: 'yes', h: 'help', v: 'version', c: 'client' }

export function parseArgs(argv) {
  const out = { command: null, flags: {}, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]
    if (arg === '--') {
      out.rest.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('-')) {
      let value
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        value = arg.slice(eq + 1)
        arg = arg.slice(0, eq)
      }
      let name = arg.replace(/^--?/, '')
      name = ALIASES[name] || name
      if (BOOLEAN.has(name)) out.flags[name] = true
      else if (VALUE.has(name)) {
        if (value === undefined) value = argv[++i]
        if (value === undefined || value.startsWith('-')) throw new Error(`--${name} needs a value`)
        if (name === 'name') out.flags.name = value
        else if (name === 'auth') {
          if (value !== 'oauth' && value !== 'key') throw new Error('--auth must be oauth or key')
          out.flags.auth = value
        } else out.flags[name] = [...(out.flags[name] || []), ...value.split(',').map((s) => s.trim()).filter(Boolean)]
      } else if (name === 'key' || name === 'token') {
        throw new Error('pass the key in the BOX_TOKEN environment variable or at the prompt, never as an argument (it would end up in shell history)')
      } else throw new Error(`unknown option ${arg}`)
    } else if (!out.command) out.command = arg
    else out.rest.push(arg)
  }
  return out
}
