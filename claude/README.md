# box by Simular: plugins

[box](https://box.simular.ai) gives your AI agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. You can watch it live and take over at https://box.simular.ai/box.

Most agents need no plugin: add the MCP server `https://mcp.box.simular.ai/mcp` and sign in once (see https://box.simular.ai/install). The [simular-ai/box-plugin](https://github.com/simular-ai/box-plugin) repository holds a package for each agent that installs box its own way. Each folder stands alone and is released through that agent's channel. This folder is the plugin listed in the Claude plugin directory. The Claude Code plugin in this repository's own marketplace is [`claude-code/`](https://github.com/simular-ai/box-plugin/tree/main/claude-code), which adds offload.

| Agent | Folder | Sign-in | Install |
| --- | --- | --- | --- |
| Claude Code and Cowork | [`claude-code/`](https://github.com/simular-ai/box-plugin/tree/main/claude-code) | OAuth, once in the browser | `/plugin marketplace add simular-ai/box-plugin`, then `/plugin install simular-box@simular-box` |
| DeepSeek Harness (dsh) | [`dsh/`](https://github.com/simular-ai/box-plugin/tree/main/dsh) | Personal key (`cb_...`), pasted on the plugin's page in Plugins | [dsh/README.md](https://github.com/simular-ai/box-plugin/blob/main/dsh/README.md) |
| OpenClaw | [`openclaw/`](https://github.com/simular-ai/box-plugin/tree/main/openclaw) | OAuth, once from the plugin's page in Settings | `openclaw plugins install @simular-ai/openclaw-box` |
| Any of Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Hermes, OpenClaw, VS Code (and steps for Claude Desktop) | [`@simular-ai/box`](https://www.npmjs.com/package/@simular-ai/box) (the box CLI, from [simular-ai/box-cli](https://github.com/simular-ai/box-cli)) | OAuth; personal key with `--auth key` for Hermes and OpenClaw | `npx @simular-ai/box connect` (check with `npx @simular-ai/box doctor`) |
| Hermes Agent | [`hermes/`](https://github.com/simular-ai/box-plugin/tree/main/hermes) | Personal key (`cb_...`) in `MCP_BOX_API_KEY`; OAuth optional | [hermes/README.md](https://github.com/simular-ai/box-plugin/blob/main/hermes/README.md) |
| ChatGPT and Codex (OpenAI plugin directory) | [`openai/`](https://github.com/simular-ai/box-plugin/tree/main/openai) | OAuth, once in the browser | Listed by OpenAI after review; build the upload with `openai/build-zip.sh` ([openai/README.md](https://github.com/simular-ai/box-plugin/blob/main/openai/README.md)) |

## What this plugin contains

- **The box MCP server** (`.mcp.json`): `https://mcp.box.simular.ai/mcp`, over HTTP. You sign in once with OAuth in the browser (`/mcp`, pick `plugin:simular-box:box`, Authenticate); there is no key to paste, and the plugin stores none.
- **The `box` skill** (`skills/box/SKILL.md`): when to use the box tools and which one fits.
- **Moving files** (in `skills/box/SKILL.md`), the only part of the plugin that runs a program on your computer: when you ask Claude to bring a file home from your box or send one to it, Claude runs the same pinned CLI (`npx -y @simular-ai/box@1.2.2 exec` or `rsh`, with `rsync` for folders) in your terminal. It goes only to your own box, over box's API, signed in as you, and Claude never sends a secret (`.env`, keys, credentials).

## Adding an agent

Add a folder named after the agent with its own manifest, MCP config and, where the agent supports skills, a copy of `claude-code/skills/box/SKILL.md`. Point it at `https://mcp.box.simular.ai/mcp`. Use OAuth sign-in where the agent supports it; otherwise read a personal key from an environment variable or the agent's own credentials store, never from a file in the package. Add a row above.

## Releasing

- `claude/` and `claude-code/`: bump `version` in both `.claude-plugin/plugin.json` files. Claude Code doesn't auto-update third-party marketplaces: users get it with `/plugin marketplace update simular-box` and `/plugin update simular-box@simular-box`, or with `npx @simular-ai/box connect`.
- `openclaw/`: bump `version` in `openclaw/package.json` and `openclaw/openclaw.plugin.json`, then `npm run build` and `clawhub package publish .` from `openclaw/`.
- `dsh/`: bump `version` in `dsh/package.json`, then push a tag `dsh-vX.Y.Z`. The release workflow attaches `dsh-box.tgz`.
- `openai/`: bump `version` in `openai/plugin.json` and `publication.release_notes`, run `openai/build-zip.sh`, upload the ZIP at platform.openai.com/plugins.
- `hermes/`: bump `version` in `hermes/plugin.json`. Users copy the folder by hand until box is in the Hermes plugin catalog.
- The Claude plugins' CLI pin: change the exact CLI version in every `npx -y` command under `claude/` and `claude-code/`, and bump both `plugin.json` versions, in one PR (CI fails unless every pin names the same exact version and that version is on npm).
- The box CLI (`@simular-ai/box` on npm) is released from simular-ai/box-cli, not from here. `e2e/` tests the pinned version against each real client (versions in `e2e/clients.json`); see `.github/workflows/ci.yml`.
