# box for OpenClaw

Give your OpenClaw agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, around the clock.

This folder is a Claude-format bundle (`.claude-plugin/plugin.json`, `.mcp.json`, `skills/`), which OpenClaw loads as a bundle plugin. It differs from `claude/` only in sending a personal key, because a bundle's MCP entry can't turn on OAuth sign-in.

1. Create a personal key at https://box.simular.ai/keys (name it "openclaw"). It is shown once.
2. Add it to `~/.openclaw/.env`:

   ```
   BOX_TOKEN=cb_your_key
   ```

3. Install the plugin and check the connection:

   ```bash
   git clone https://github.com/simular-ai/box-plugin
   openclaw plugins install ./box-plugin/openclaw --force --accept-capabilities
   openclaw plugins inspect box     # Format: bundle, Bundle capabilities: skills, mcpServers
   openclaw plugins doctor
   ```

   Restart the Gateway. The plugin's `box` server connects when the Gateway starts; `openclaw mcp status` and `openclaw mcp probe` only list servers added with `openclaw mcp add`, not ones a plugin brings.

**On a desktop with a browser**, you can sign in instead: `openclaw mcp add box --url https://relay.simular.cloud/mcp --transport streamable-http --auth oauth`, then `openclaw mcp login box`. On a server, prefer the key: OpenClaw drops a server whose OAuth credentials have expired until someone signs in again.

Watch the box live, and take over when needed, at https://box.simular.ai/box.
