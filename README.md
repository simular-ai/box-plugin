# box by Simular: plugins

[box](https://box.simular.ai) gives your AI agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. You can watch it live and take over at https://box.simular.ai/box.

Most agents need no plugin: add the MCP server `https://mcp.box.simular.ai/mcp` and sign in once (see https://box.simular.ai/install). This repository holds a package for each agent that installs box its own way. Each folder stands alone and is released through that agent's channel.

| Agent | Folder | Sign-in | Install |
| --- | --- | --- | --- |
| Claude Code and Cowork | [`claude/`](claude/) | OAuth, once in the browser | `/plugin marketplace add simular-ai/box-plugin`, then `/plugin install simular-box@simular-box` |
| DeepSeek Harness (dsh) | [`dsh/`](dsh/) | Personal key (`cb_...`), pasted on the plugin's page in Plugins | [dsh/README.md](dsh/README.md) |
| OpenClaw | [`openclaw/`](openclaw/) | OAuth, once from the plugin's page in Settings | `openclaw plugins install @simular-ai/openclaw-box` |
| Any of Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Hermes, OpenClaw, VS Code (and steps for Claude Desktop) | [`@simular-ai/box`](https://www.npmjs.com/package/@simular-ai/box) (the box CLI, from [simular-ai/box-cli](https://github.com/simular-ai/box-cli)) | OAuth; personal key with `--auth key` for Hermes and OpenClaw | `npx @simular-ai/box connect` (check with `npx @simular-ai/box doctor`) |
| Hermes Agent | [`hermes/`](hermes/) | Personal key (`cb_...`) in `MCP_BOX_API_KEY`; OAuth optional | `hermes plugins install simular-box` ([hermes/README.md](hermes/README.md)) |
| ChatGPT and Codex (OpenAI plugin directory) | [`openai/`](openai/) | OAuth, once in the browser | Listed by OpenAI after review; build the upload with `openai/build-zip.sh` ([openai/README.md](openai/README.md)) |

## Offload: move a coding task into your box and back

Going offline in the middle of a task? In Claude Code with the plugin, `/simular-box:offload` hands the task to a fresh Claude Code (or Codex, Cursor) session in your box, which keeps working while you are away; `/simular-box:back` brings its commits and its written hand-over home and merges them. Any other agent or a plain terminal uses `npx @simular-ai/box offload` and `npx @simular-ai/box back`. Setup and details: [the CLI's README](https://www.npmjs.com/package/@simular-ai/box).

## Adding an agent

Add a folder named after the agent with its own manifest, MCP config and, where the agent supports skills, a copy of `claude/skills/box/SKILL.md`. Point it at `https://mcp.box.simular.ai/mcp`. Use OAuth sign-in where the agent supports it; otherwise read a personal key from an environment variable or the agent's own credentials store, never from a file in the package. Add a row above.

## Releasing

- `claude/`: bump `version` in `claude/.claude-plugin/plugin.json`. Claude Code doesn't auto-update third-party marketplaces: users get it with `/plugin marketplace update simular-box` and `/plugin update simular-box@simular-box`, or with `npx @simular-ai/box connect`.
- `openclaw/`: bump `version` in `openclaw/package.json` and `openclaw/openclaw.plugin.json`, then `npm run build` and `clawhub package publish .` from `openclaw/`.
- `dsh/`: bump `version` in `dsh/package.json`, then push a tag `dsh-vX.Y.Z`. The release workflow attaches `dsh-box.tgz`.
- `openai/`: bump `version` in `openai/plugin.json` and `publication.release_notes`, run `openai/build-zip.sh`, upload the ZIP at platform.openai.com/plugins.
- `hermes/`: bump `version` in `hermes/plugin.json`, merge, then open a PR to [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) that moves `sha:` (and `version:`) in `plugin-catalog/box.yaml` to the merge commit. Hermes installs only the pinned, reviewed commit.
- The Claude plugin's CLI pin: since 1.0.0, `@simular-ai/box` on npm is the Rust CLI released from [simular-ai/box-cli](https://github.com/simular-ai/box-cli). To move the plugin to a new CLI release, change the exact pin `npx -y @simular-ai/box@X.Y.Z` in `claude/skills/box-offload/SKILL.md` and bump `version` in `claude/.claude-plugin/plugin.json` in one PR (CI fails unless every pin under `claude/` names the same exact version and that version is on npm; never a range, because the Claude directory review requires that what runs is what it read).
- The box CLI (`@simular-ai/box` on npm) is released from simular-ai/box-cli, not from here. `e2e/` tests the pinned version against each real client (versions in `e2e/clients.json`); see `.github/workflows/ci.yml`.
