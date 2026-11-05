// The dimensions a cell picks from, and the cells in cells.json. A cell's name is app/setup/alreadySetUp.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Which app the user sets box up in. names: what the app calls itself on box's sign-in page. */
export const APPS = {
  'claude-code-cli': { label: 'Claude Code CLI', signIn: 'click-allow-in-browser', names: ['Claude Code'] },
}

/** What the user does first. */
export const SETUPS = {
  'paste-landing-line': 'Pastes "Set up box from https://box.simular.ai/install" into their agent, and the agent does the rest.',
  'click-open-in-button': 'Clicks "Open in Claude / Codex / Cursor" on the box site, which opens the app with the setup prompt filled in.',
  'click-add-to-claude-link': 'Clicks the one-tap "Add to Claude" link, which opens claude.ai connector settings with box filled in.',
  'click-install-in-vscode': 'Clicks the VS Code install link, then Install in VS Code.',
  'run-npx-connect': 'Runs npx @simular-ai/box connect in their own terminal.',
  'add-connector-in-settings': "Adds box by hand in the app's connector settings, following install.md.",
  'edit-app-config': "Follows install.md's manual steps for their app, such as claude mcp add or Codex's TOML file.",
}

/** What is already there before the run starts. */
export const ALREADY_SET_UP = {
  nothing: 'box is not set up anywhere: no MCP entry, no claude.ai connector, no live grant.',
  'claude-ai-connector': "The user's claude.ai account already has the box by Simular connector, and the app loads it.",
}

export const cellName = (cell) => `${cell.app}/${cell.setup}/${cell.alreadySetUp}`

/** Load and check cells.json: every value must be one of the dimensions above, and names unique. */
export function loadCells(file = path.join(HERE, 'cells.json')) {
  const { cells } = JSON.parse(fs.readFileSync(file, 'utf8'))
  const byName = new Map()
  for (const cell of cells) {
    for (const [field, allowed] of [['app', APPS], ['setup', SETUPS], ['alreadySetUp', ALREADY_SET_UP]]) {
      if (!(cell[field] in allowed)) throw new Error(`cell "${cell.title}": ${field} "${cell[field]}" is not one of ${Object.keys(allowed).join(', ')}`)
    }
    const name = cellName(cell)
    if (byName.has(name)) throw new Error(`two cells are named ${name}`)
    byName.set(name, { name, ...cell })
  }
  return byName
}
