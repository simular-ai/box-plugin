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
| ChatGPT and Codex (OpenAI plugin directory) | [`openai/`](openai/) | OAuth, once in the browser | Listed by OpenAI after review; build the upload with `openai/build-zip.sh` ([openai/README.md](openai/README.md)) |
| Grok Build | [`grok/`](grok/) | OAuth, once in the browser (`/mcps`, then `i`) | `/marketplace`, find **box**, press `i` ([grok/README.md](grok/README.md)) |

## Offload: move a coding task into your box and back

Going offline in the middle of a task? In Claude Code with the plugin, `/box:offload` hands the task to a fresh Claude Code (or Codex, Cursor) session in your box, which keeps working while you are away; `/box:back` brings its commits and its written hand-over home and merges them. Any other agent or a plain terminal uses `npx @simular-ai/box offload` and `npx @simular-ai/box back`. Setup and details: [cli/README.md](cli/README.md#offload).

## Adding an agent

Add a folder named after the agent with its own manifest, MCP config and, where the agent supports skills, a copy of `claude/skills/box/SKILL.md`. Point it at `https://mcp.box.simular.ai/mcp`. Use OAuth sign-in where the agent supports it; otherwise read a personal key from an environment variable or the agent's own credentials store, never from a file in the package. Add a row above.

## Releasing

- `claude/`: bump `version` in `claude/.claude-plugin/plugin.json`. Claude Code doesn't auto-update third-party marketplaces: users get it with `/plugin marketplace update simular-box` and `/plugin update box@simular-box`, or with `npx @simular-ai/box connect`.
- `openclaw/`: bump `version` in `openclaw/package.json` and `openclaw/openclaw.plugin.json`, then `npm run build` and `clawhub package publish .` from `openclaw/`.
- `dsh/`: bump `version` in `dsh/package.json`, then push a tag `dsh-vX.Y.Z`. The release workflow attaches `dsh-box.tgz`.
- `openai/`: bump `version` in `openai/plugin.json` and `publication.release_notes`, run `openai/build-zip.sh`, upload the ZIP at platform.openai.com/plugins.
- `hermes/`: bump `version` in `hermes/plugin.json`. Users copy the folder by hand until box is in the Hermes plugin catalog.
- `grok/`: bump `version` in `grok/.grok-plugin/plugin.json`, then open a PR to [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) that moves the `box` entry's `sha` to the new commit and regenerates its index.
- The Claude plugin's CLI pin: since 1.0.0, `@simular-ai/box` on npm is the Rust CLI released from [simular-ai/box-cli](https://github.com/simular-ai/box-cli). To move the plugin to a new CLI release, change the exact pin `npx -y @simular-ai/box@X.Y.Z` in `claude/skills/box-offload/SKILL.md` and bump `version` in `claude/.claude-plugin/plugin.json` in one PR (CI fails unless every pin under `claude/` names the same exact version and that version is on npm; never a range, because the Claude directory review requires that what runs is what it read).
- `cli/`: the JavaScript CLI (0.2.x). It no longer publishes to npm: its trusted publisher on `@simular-ai/box` was removed when the Rust 1.0.0 shipped, so do not push `cli-v*` tags. The endpoint and CLI changes now go to simular-ai/box-cli.
