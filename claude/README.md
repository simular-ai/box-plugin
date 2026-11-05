# box by Simular for Claude

[box](https://box.simular.ai) gives Claude a computer of its own: a cloud Linux desktop with Chrome and a shell. Claude drives it over MCP while your own computer stays free, and you can watch it live and take over at https://box.simular.ai/box.

## What the plugin adds

- The box MCP server (`https://mcp.box.simular.ai/mcp`): tools for the shell and files, web pages in Chrome, desktop apps and screenshots, and the box itself (wake, hibernate, save).
- The box skill, which tells Claude when to use box and which tool to pick.
- Offload: `/box:offload` hands the current coding task to a fresh agent session in your box, which keeps working while you are away; `/box:back` brings its commits and hand-over home and merges them. Each box needs a one-time setup first: [cli/README.md](https://github.com/simular-ai/box-plugin/blob/main/cli/README.md#offload).

## Install

In Claude Code:

```
/plugin marketplace add simular-ai/box-plugin
/plugin install box@simular-box
```

Or run `npx @simular-ai/box connect`, which installs it for you.

## Sign in

You sign in once, in the browser; there is no key to paste. In Claude Code, run `/mcp`, pick the box server and choose Authenticate, then sign in and click Approve. A sleeping box wakes on the first call.

## Links

- box: https://box.simular.ai
- Setup for Claude and other apps: https://box.simular.ai/docs/mcp
- Privacy policy: https://www.simular.ai/product-sai/privacy
- Terms of use: https://www.simular.ai/terms-of-use
