# box for Hermes Agent

Give your Hermes agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, around the clock.

This folder is a portable Agent Plugins v1 package (`plugin.json`, `mcp.json`, `skills/`). It reaches box with a personal key, which suits a Hermes agent running on a server with no browser.

1. Create a personal key at https://box.simular.ai/keys (name it "hermes"). It is shown once.
2. Add it to `~/.hermes/.env`:

   ```
   BOX_TOKEN=cb_your_key
   ```

3. Install and enable the plugin, then reload MCP servers:

   ```bash
   hermes plugins install simular-ai/box-plugin --subdir hermes
   hermes plugins enable box
   ```

   Then `/reload-mcp` in a session. box's tools show up from the `box` server, and the `box` skill tells the agent how to use them.

**On a desktop with a browser**, you can sign in instead of using a key: `hermes mcp add box --url https://relay.simular.cloud/mcp --auth oauth`, then `hermes mcp login box`. A server you add this way overrides the plugin's entry of the same name. On a server, prefer the key: when an OAuth refresh token expires, Hermes parks the server until someone signs in again by hand.

Watch the box live, and take over when needed, at https://box.simular.ai/box.
