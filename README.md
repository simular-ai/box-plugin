# box by Simular: plugins

[box](https://box.simular.ai) gives your AI agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. You can watch it live and take over at https://box.simular.ai/box.

Most agents need no plugin: add the MCP server `https://relay.simular.cloud/mcp` and sign in once (see https://box.simular.ai/install). This repository holds a package for each agent that installs box its own way. Each folder stands alone and is released through that agent's channel.

| Agent | Folder | Sign-in | Install |
| --- | --- | --- | --- |
| Claude Code and Cowork | [`claude/`](claude/) | OAuth, once in the browser | `/plugin marketplace add simular-ai/box-plugin`, then `/plugin install box@simular-box` |
| DeepSeek Harness (dsh) | [`dsh/`](dsh/) | Personal key (`cb_...`) | [dsh/README.md](dsh/README.md) |
| Any of Claude Code, Codex, Cursor, OpenCode, Hermes, OpenClaw, VS Code (and steps for Claude Desktop) | [`cli/`](cli/) | OAuth; personal key with `--auth key` for Hermes and OpenClaw | `npx @simular-ai/box connect` (check with `npx @simular-ai/box doctor`) |

## Adding an agent

Add a folder named after the agent with its own manifest, MCP config and, where the agent supports skills, a copy of `claude/skills/box/SKILL.md`. Point it at `https://relay.simular.cloud/mcp`. Use OAuth sign-in where the agent supports it; otherwise read a personal key from an environment variable, never from a file in the package. Add a row above.

## Releasing

- `claude/`: bump `version` in `claude/.claude-plugin/plugin.json`; Claude Code picks it up from the marketplace.
- `dsh/`: bump `version` in `dsh/package.json`, then push a tag `dsh-vX.Y.Z`. The release workflow attaches `dsh-box.tgz`.
- `cli/`: bump `version` in `cli/package.json`, then push a tag `cli-vX.Y.Z`. The release workflow tests it and publishes `@simular-ai/box` to npm with provenance (needs the `NPM_TOKEN` secret). When the box endpoint moves, change `DEFAULT_MCP_URL` in `cli/src/constants.js` and release.
