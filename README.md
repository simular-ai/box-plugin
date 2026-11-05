# box by Simular: plugins

[box](https://box.simular.ai) gives your AI agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. You can watch it live and take over at https://box.simular.ai/box.

Most agents need no plugin: add the MCP server `https://mcp.box.simular.ai/mcp` and sign in once (see https://box.simular.ai/install). This repository holds a package for each agent that installs box its own way. Each folder stands alone and is released through that agent's channel.

| Agent | Folder | Sign-in | Install |
| --- | --- | --- | --- |
| Claude Code and Cowork | [`claude/`](claude/) | OAuth, once in the browser | `/plugin marketplace add simular-ai/box-plugin`, then `/plugin install box@simular-box` |
| DeepSeek Harness (dsh) | [`dsh/`](dsh/) | Personal key (`cb_...`), pasted on the plugin's page in Plugins | [dsh/README.md](dsh/README.md) |
| OpenClaw | [`openclaw/`](openclaw/) | OAuth, once from the plugin's page in Settings | `openclaw plugins install @simular-ai/openclaw-box` |
| Any of Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Hermes, OpenClaw, VS Code (and steps for Claude Desktop) | [`cli/`](cli/) | OAuth; personal key with `--auth key` for Hermes and OpenClaw | `npx @simular-ai/box connect` (check with `npx @simular-ai/box doctor`) |
| Hermes Agent | [`hermes/`](hermes/) | Personal key (`cb_...`) in `MCP_BOX_API_KEY`; OAuth optional | [hermes/README.md](hermes/README.md) |

## Offload: move a coding task into your box and back

Going offline in the middle of a task? In Claude Code with the plugin, `/box:offload` hands the task to a fresh Claude Code (or Codex, Cursor) session in your box, which keeps working while you are away; `/box:back` brings its commits and its written hand-over home and merges them. Any other agent or a plain terminal uses `npx @simular-ai/box offload` and `npx @simular-ai/box back`. Setup and details: [cli/README.md](cli/README.md#offload).

## Adding an agent

Add a folder named after the agent with its own manifest, MCP config and, where the agent supports skills, a copy of `claude/skills/box/SKILL.md`. Point it at `https://mcp.box.simular.ai/mcp`. Use OAuth sign-in where the agent supports it; otherwise read a personal key from an environment variable or the agent's own credentials store, never from a file in the package. Add a row above.

## Releasing

- `claude/`: bump `version` in `claude/.claude-plugin/plugin.json`. Claude Code doesn't auto-update third-party marketplaces: users get it with `/plugin marketplace update simular-box` and `/plugin update box@simular-box`, or with `npx @simular-ai/box connect`.
- `openclaw/`: bump `version` in `openclaw/package.json` and `openclaw/openclaw.plugin.json`, then `npm run build` and `clawhub package publish .` from `openclaw/`.
- `dsh/`: bump `version` in `dsh/package.json`, then push a tag `dsh-vX.Y.Z`. The release workflow attaches `dsh-box.tgz`.
- `hermes/`: bump `version` in `hermes/plugin.json`. Users copy the folder by hand until box is in the Hermes plugin catalog.
- `cli/`: bump `version` in `cli/package.json`, then push a tag `cli-vX.Y.Z`. The `publish-cli.yml` workflow tests it and publishes `@simular-ai/box` to npm through trusted publishing (OIDC), with provenance; the one-time npm setup is in [cli/README.md](cli/README.md#releasing). When the box endpoint moves, change `DEFAULT_MCP_URL` in `cli/src/constants.js`, add the old host to `OLD_HOSTS` there, change the URL in every plugin folder, and release each one.
