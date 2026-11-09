# box for Hermes Agent

Give your Hermes agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, around the clock.

This folder is a portable Agent Plugins v1 package (`plugin.json`, `mcp.json`, `skills/`). It reaches box with a personal key, which suits a Hermes agent running on a server with no browser.

1. Create a personal key at https://box.simular.ai/keys (name it "hermes"). It is shown once.
2. Add it to `~/.hermes/.env`:

   ```
   MCP_BOX_API_KEY=cb_your_key
   ```

   `MCP_BOX_API_KEY` is the name Hermes's own `hermes mcp add --auth header` uses, and the same one `npx @simular-ai/box connect --client hermes --auth key` writes, so one key serves either install.

3. Install the plugin into your profile's plugin folder, enable it, and restart the gateway so it picks up the key:

   ```bash
   git clone https://github.com/simular-ai/box-plugin /tmp/box-plugin
   cp -R /tmp/box-plugin/hermes ~/.hermes/plugins/simular-box     # per profile: ~/.hermes/profiles/<name>/plugins/simular-box
   hermes plugins enable simular-box
   hermes gateway restart
   ```

   `hermes plugins install` takes a catalog name, a Git URL or `owner/repo`, not a folder inside a repo, so until box is in the Hermes plugin catalog the folder is copied by hand. Check it with `hermes plugins validate ~/.hermes/plugins/simular-box`. The plugin is named `simular-box` so it isn't confused with Box, the cloud-files company. box's tools show up from the `box` server, and the `box` skill tells the agent how to use them.

   Hermes asks you the first time the agent uses each box tool that can change something (clicking, typing, running a command, writing or deleting a file). Answer **Always** and it won't ask for that tool again; screenshots and other read-only tools never ask. A scheduled or unattended run can't answer, so approve the tools once in a chat first.

   If you change the key later, run `hermes gateway restart`: a running gateway keeps the old value and parks the server.

   To update, copy the folder again the same way and restart the gateway. Version 0.2.0 renamed the plugin from `box` to `simular-box`: if you installed an earlier version, run `hermes plugins disable box`, delete `~/.hermes/plugins/box`, then install as above. Version 0.1.1 moved box to `https://mcp.box.simular.ai/mcp`.

**On a desktop with a browser**, you can sign in instead of using a key: `hermes mcp add box --url https://mcp.box.simular.ai/mcp --auth oauth`, then `hermes mcp login box`. A server you add this way overrides the plugin's entry of the same name. On a server, prefer the key: when an OAuth refresh token expires, Hermes parks the server until someone signs in again by hand.

Watch the box live, and take over when needed, at https://box.simular.ai/box.
