// The box CLI these tests run: the Rust `simular-box` from simular-ai/box-cli, at the exact
// version the Claude plugin pins (claude/skills/box-offload/SKILL.md; CI keeps every pin under
// claude/ on one version that is on npm). Set BOX_CLI to a binary to test another build, for
// example a local `target/release/simular-box` from a box-cli checkout.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export function pinnedVersion() {
  const skill = fs.readFileSync(path.join(REPO, 'claude', 'skills', 'box-offload', 'SKILL.md'), 'utf8')
  const m = skill.match(/@simular-ai\/box@(\d+\.\d+\.\d+)/)
  if (!m) throw new Error('no exact @simular-ai/box@X.Y.Z pin in claude/skills/box-offload/SKILL.md')
  return m[1]
}

/** [command, ...leading args] to spawn the CLI with. */
export function boxCommand(env = process.env) {
  if (env.BOX_CLI) return [env.BOX_CLI]
  return ['npx', '-y', `@simular-ai/box@${pinnedVersion()}`]
}

export function which(bin, env = process.env, platform = process.platform) {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext)
      try {
        const st = fs.statSync(candidate)
        if (st.isFile() && (platform === 'win32' || st.mode & 0o111)) return candidate
      } catch {
        // not here
      }
    }
  }
  return null
}
