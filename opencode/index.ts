// box by Simular for OpenCode: adds box's hosted MCP server to every session.
// Sign-in is OAuth: run `opencode mcp auth box` once and approve in the browser. This plugin
// reads no key or token; OpenCode keeps the sign-in itself. How to use box's tools comes from the
// server's own instructions, so the plugin ships no skill of its own.
const MCP_URL = "https://mcp.box.simular.ai/mcp"

export const BoxPlugin = async () => ({
  config: async (config: any) => {
    // An entry the user already has (for example from `npx @simular-ai/box connect opencode`) wins.
    config.mcp ??= {}
    config.mcp.box ??= { type: "remote", url: MCP_URL, enabled: true }
  },
})

export default BoxPlugin
