// Claude Desktop and claude.ai: remote servers are added as custom connectors in the app, not in
// claude_desktop_config.json (that file only takes local stdio servers). We can't add a connector
// for the user, so `connect` prints the steps and writes nothing.
// Docs: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
import fs from 'node:fs'
import path from 'node:path'

const appDir = (ctx) => path.join(ctx.appData, 'Claude')

export default {
  id: 'claude-desktop',
  name: 'Claude Desktop',
  auth: 'oauth',
  manual: true,
  aliases: ['claude-ai', 'claude.ai'],
  detect(ctx) {
    if (fs.existsSync(appDir(ctx))) return { installed: true, via: appDir(ctx) }
    if (ctx.platform === 'darwin' && fs.existsSync('/Applications/Claude.app')) return { installed: true, via: '/Applications/Claude.app' }
    return { installed: false }
  },
  configLocation() {
    return 'Settings -> Connectors in the Claude app'
  },
  status() {
    return { entries: [], legacy: [], keyConfigured: false, manual: true }
  },
  connect(ctx) {
    return {
      actions: ['nothing written: Claude Desktop adds remote servers as connectors in the app'],
      next: [`Open Settings -> Connectors -> Add custom connector, name it box, paste ${ctx.url}, click Connect, sign in and Approve.`],
    }
  },
  remove() {
    return { actions: [], next: ['Remove the box connector in Settings -> Connectors.'] }
  },
}
