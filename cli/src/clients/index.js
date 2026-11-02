import claudeCode from './claude-code.js'
import claudeDesktop from './claude-desktop.js'
import codex from './codex.js'
import cursor from './cursor.js'
import hermes from './hermes.js'
import openclaw from './openclaw.js'
import opencode from './opencode.js'
import vscode from './vscode.js'

export const CLIENTS = [claudeCode, codex, cursor, opencode, hermes, openclaw, vscode, claudeDesktop]

const ALIASES = { claude: 'claude-code', 'claude-code-cli': 'claude-code' }

export function findClient(id) {
  const key = String(id).toLowerCase()
  const target = ALIASES[key] || key
  return CLIENTS.find((c) => c.id === target || (c.aliases || []).includes(target))
}
