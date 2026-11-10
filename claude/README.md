# box by Simular: plugins

[box](https://box.simular.ai) gives your AI agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. You can watch it live and take over at https://box.simular.ai/box.

Most agents need no plugin: add the MCP server `https://mcp.box.simular.ai/mcp` and sign in once (see https://box.simular.ai/install). The [simular-ai/box-plugin](https://github.com/simular-ai/box-plugin) repository holds a package for each agent that installs box its own way. Each folder stands alone and is released through that agent's channel. This folder is the Claude Code and Cowork plugin.

| Agent | Folder | Sign-in | Install |
| --- | --- | --- | --- |
| Claude Code and Cowork | [`claude/`](https://github.com/simular-ai/box-plugin/tree/main/claude) | OAuth, once in the browser | `/plugin marketplace add simular-ai/box-plugin`, then `/plugin install simular-box@simular-box` |
| DeepSeek Harness (dsh) | [`dsh/`](https://github.com/simular-ai/box-plugin/tree/main/dsh) | Personal key (`cb_...`), pasted on the plugin's page in Plugins | [dsh/README.md](https://github.com/simular-ai/box-plugin/blob/main/dsh/README.md) |
| OpenClaw | [`openclaw/`](https://github.com/simular-ai/box-plugin/tree/main/openclaw) | OAuth, once from the plugin's page in Settings | `openclaw plugins install @simular-ai/openclaw-box` |
| Any of Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Hermes, OpenClaw, VS Code (and steps for Claude Desktop) | [`cli/`](https://github.com/simular-ai/box-plugin/tree/main/cli) | OAuth; personal key with `--auth key` for Hermes and OpenClaw | `npx @simular-ai/box connect` (check with `npx @simular-ai/box doctor`) |
| Hermes Agent | [`hermes/`](https://github.com/simular-ai/box-plugin/tree/main/hermes) | Personal key (`cb_...`) in `MCP_BOX_API_KEY`; OAuth optional | [hermes/README.md](https://github.com/simular-ai/box-plugin/blob/main/hermes/README.md) |
| ChatGPT and Codex (OpenAI plugin directory) | [`openai/`](https://github.com/simular-ai/box-plugin/tree/main/openai) | OAuth, once in the browser | Listed by OpenAI after review; build the upload with `openai/build-zip.sh` ([openai/README.md](https://github.com/simular-ai/box-plugin/blob/main/openai/README.md)) |

## What this plugin contains

- **The box MCP server** (`.mcp.json`): `https://mcp.box.simular.ai/mcp`, over HTTP. You sign in once with OAuth in the browser (`/mcp`, pick `plugin:simular-box:box`, Authenticate); there is no key to paste, and the plugin stores none.
- **The `box` skill** (`skills/box/SKILL.md`): when to use the box tools and which one fits.
- **Offload and back** (`commands/offload.md`, `commands/back.md`, `skills/box-offload/SKILL.md`): `/simular-box:offload` and `/simular-box:back`, below. They are the only part of the plugin that runs a program on your computer.

## Offload: move a coding task into your box and back

Going offline in the middle of a task? In Claude Code with the plugin, `/simular-box:offload` hands the task to a fresh Claude Code (or Codex) session in your box, which keeps working while you are away; `/simular-box:back` brings its commits and its written hand-over home and merges them. Any other agent or a plain terminal uses `npx @simular-ai/box@1.0.0 offload` and `npx @simular-ai/box@1.0.0 back`. Setup and details: [the CLI's README](https://www.npmjs.com/package/@simular-ai/box).

Nothing leaves your computer until you run `/simular-box:offload` yourself.

### What `/simular-box:offload` runs

- **One npx package, pinned to an exact version:** `npx -y @simular-ai/box@1.0.0`, the `simular-box` CLI, built and released by Simular from [simular-ai/box-cli](https://github.com/simular-ai/box-cli) and published to npm as [`@simular-ai/box`](https://www.npmjs.com/package/@simular-ai/box). The pin is exact, never a range, so what runs is the version this plugin was reviewed with.
- **Claude's steps** (from `skills/box-offload/SKILL.md`):
  1. Write a hand-over to the file `npx -y @simular-ai/box@1.0.0 offload handover-path` prints, from a fixed template: goal, decisions, files touched, next steps, commands. Secrets go in by name only, never by value.
  2. Run `npx -y @simular-ai/box@1.0.0 offload --kind claude` in your repo. The CLI does every step that follows; the skill tells Claude never to copy files or secrets itself.
- **Checks before anything is sent.** The CLI stops, and sends nothing, when the folder is not a git repo, `rsync` is missing, this repo already has an offload in progress, the box's image is too old, or the task needs macOS. It warns, and goes on only after you say yes, when you have untracked files, a `.env` file stays behind, the hand-over names secrets you have not opted in, the code reads environment variables set here but not in the box, the repo uses Git LFS or submodules, it calls local services or VPN-only hosts, or the copy is over 500 MB.
- **Sign-in:** the CLI uses your box account (`npx -y @simular-ai/box@1.0.0 login`, in the browser). Its token is kept in the macOS Keychain, or on Linux in `~/.simular-box/credentials.json` with mode 0600.

### What gets uploaded from your repo

| What | Details |
| --- | --- |
| Tracked files | Every file git tracks (committed, or staged with `git add`), with its uncommitted changes. |
| Git history | A `git bundle` of your branches and tags that the box does not have yet, and `.git` without its object store. |
| The hand-over | `handover.md`, written by Claude as above. |
| `env.json` | Versions of the tools the repo uses on this computer (go, rustc, node, …), its package manager, and which toolchain files and lockfiles exist. No environment variable values. |
| Secrets you opted in | Nothing, unless you opted a secret in for this repo yourself (next section). |

What stays on your computer:

- Untracked files, the ones git does not know about. Stage a new file with `git add` to take it.
- Git-ignored files, such as `.env` and `node_modules`.
- Git LFS contents (the box copy holds their pointers) and submodule contents (the box copy holds their commits).
- Everything outside the repo, except the secrets you opted in.

### Where it goes

Into your own box, the cloud computer of the box account you signed in with, at `/workspace/<repo name>`. It travels over box's API (`mcp.box.simular.ai`), authenticated as you: `rsync` and `git` run over the CLI's own remote shell to your box. Nothing is sent anywhere else. `/simular-box:back` brings the box's commits and its hand-over home, and merges them only when that leaves your work intact: a fast-forward, or a clean merge applied uncommitted; otherwise the box's work goes on a branch `box/back-<time>` and your work tree is untouched.

### How secrets are handled

- **Opt-in only, per repo, by you.** You run `npx -y @simular-ai/box@1.0.0 offload secrets add <entry>` yourself; the skill tells Claude never to opt one in on its own. The entries are `file:<path in the repo>` (for example `file:.env`), `aws` (`~/.aws/credentials`), `kube` (your kubeconfig), `gcloud` (`~/.config/gcloud`, without its logs) and `ssh:<key>` (`~/.ssh/<key>`). Your opt-ins are kept as names and paths only, never values, in `~/.simular-box/offload/repos.json` (mode 0600).
- **In the box, secrets live in memory only:** a tmpfs at `/run/cocoonbox-offload` (mode 0700, owned by the box user, never written to disk and never part of a box snapshot). A file secret is linked into the copy from there; `aws`, `kube` and `gcloud` are handed to the box agent as `AWS_SHARED_CREDENTIALS_FILE`, `KUBECONFIG` and `CLOUDSDK_CONFIG`; ssh keys are loaded into an ssh-agent and their files deleted.
- **Wiped** when you bring the task back, when an offload fails, and when the next offload of the repo starts.

### How permissions work on the box

- The agent in the box runs with permission prompts off: `claude --dangerously-skip-permissions` (Codex: `--dangerously-bypass-approvals-and-sandbox`), so it can keep working while you are away. Claude tells you this when the offload finishes.
- What it can reach is the box itself: a separate cloud computer, not yours. It holds the repo copy, the secrets you opted in for this repo, the box CLI's own sign-in (`npx -y @simular-ai/box@1.0.0 offload sign-in --kind claude`, done by you once per box), and whatever you signed in to in the box's browser. Opt in only the secrets the task needs.
- You can watch it, answer its questions and stop it: `npx -y @simular-ai/box@1.0.0 offload inbox` shows what it posted, `offload send "<answer>"` answers, `offload status` shows whether it is working, and offload prints an `rsh -t … tmux attach` line to watch its terminal. You can also watch the box's screen at https://box.simular.ai/box.

## Adding an agent

Add a folder named after the agent with its own manifest, MCP config and, where the agent supports skills, a copy of `claude/skills/box/SKILL.md`. Point it at `https://mcp.box.simular.ai/mcp`. Use OAuth sign-in where the agent supports it; otherwise read a personal key from an environment variable or the agent's own credentials store, never from a file in the package. Add a row above.

## Releasing

- `claude/`: bump `version` in `claude/.claude-plugin/plugin.json`. Claude Code doesn't auto-update third-party marketplaces: users get it with `/plugin marketplace update simular-box` and `/plugin update simular-box@simular-box`, or with `npx @simular-ai/box connect`.
- `openclaw/`: bump `version` in `openclaw/package.json` and `openclaw/openclaw.plugin.json`, then `npm run build` and `clawhub package publish .` from `openclaw/`.
- `dsh/`: bump `version` in `dsh/package.json`, then push a tag `dsh-vX.Y.Z`. The release workflow attaches `dsh-box.tgz`.
- `openai/`: bump `version` in `openai/plugin.json` and `publication.release_notes`, run `openai/build-zip.sh`, upload the ZIP at platform.openai.com/plugins.
- `hermes/`: bump `version` in `hermes/plugin.json`. Users copy the folder by hand until box is in the Hermes plugin catalog.
- The Claude plugin's CLI pin: since 1.0.0, `@simular-ai/box` on npm is the Rust CLI released from [simular-ai/box-cli](https://github.com/simular-ai/box-cli). To move the plugin to a new CLI release, change the exact CLI version in every `npx -y` command in `claude/skills/box-offload/SKILL.md` and `claude/README.md`, and bump `version` in `claude/.claude-plugin/plugin.json`, in one PR (CI fails unless every pin under `claude/` names the same exact version and that version is on npm; never a range, because the Claude directory review requires that what runs is what it read).
- `cli/`: the JavaScript CLI (0.2.x). It no longer publishes to npm: its trusted publisher on `@simular-ai/box` was removed when the Rust 1.0.0 shipped, so do not push `cli-v*` tags. The endpoint and CLI changes now go to simular-ai/box-cli.
