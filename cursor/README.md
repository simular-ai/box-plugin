# box for Cursor

Gives Cursor's agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. You can watch it live and take over at https://box.simular.ai/box.

The plugin adds the `box` MCP server (`https://mcp.box.simular.ai/mcp`) and a `box` skill that tells the agent when and how to use it.

## Install

From the Cursor Marketplace: open **Customize**, search for **box by Simular**, and install.

Before the listing is live, either run `npx @simular-ai/box connect --client cursor`, or copy this folder to `~/.cursor/plugins/local/simular-box` and reload the window.

## Sign in

The first time the agent calls a box tool, Cursor opens your browser to sign in to box. There is no key to paste. Free accounts start with free credits; see https://box.simular.ai for plans.

## Privacy and support

- Privacy: https://www.simular.ai/privacy-policy
- Terms: https://www.simular.ai/terms-of-use
- Support: https://www.simular.ai/support
