import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// box ships no runtime code of its own: the manifest declares the remote MCP
// server, and OpenClaw signs the user in from this plugin's page in Settings.
export default definePluginEntry({
  id: "box",
  name: "box by Simular",
  description: "A cloud Linux desktop your agent drives over MCP.",
  register() {},
});
