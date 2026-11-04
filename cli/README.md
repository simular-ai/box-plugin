# @simular-ai/box

Connect [box](https://box.simular.ai) to your AI apps in one command. box gives your AI agent a computer of its own: a cloud Linux desktop with Chrome and a shell, driven over MCP.

```bash
npx @simular-ai/box connect
```

The CLI finds the AI apps on this computer, asks which ones should use box, and adds the box MCP server (`https://mcp.box.simular.ai/mcp`) to each one in its own format. Other servers and settings in those files are left alone, each changed file gets a backup next to it (`*.box-backup-<time>`), and running it again changes nothing.

```bash
npx @simular-ai/box doctor     # is box set up right in each app? is the endpoint up? is the key valid?
npx @simular-ai/box remove     # undo connect
```

The command is `simular-box` (`box` belongs to box.com's CLI), so after `npm i -g @simular-ai/box` it is `simular-box connect`.

## Apps

| App | `--client` | What connect does | Sign-in |
| --- | --- | --- | --- |
| Claude Code | `claude-code` | Installs the [`claude/`](../claude/) plugin (box server + box skill) with `claude plugin install box@simular-box`. With `BOX_MCP_URL` set, `claude mcp add --scope user --transport http box <url>` instead | OAuth: `/mcp` → box → Authenticate |
| Codex | `codex` | Writes `[mcp_servers.box]` to `$CODEX_HOME/config.toml` (default `~/.codex`) | OAuth: `codex mcp login box`, or Settings → MCP servers → Authenticate in the Codex app |
| Cursor | `cursor` | Merges `mcpServers.box` into `~/.cursor/mcp.json` | OAuth: Settings → MCP → Login |
| Gemini CLI | `gemini-cli` | Merges `mcpServers.box` (`type: http`) into `~/.gemini/settings.json` | OAuth: `/mcp auth box` (in a trusted folder) |
| OpenCode | `opencode` | Merges `mcp.box` (`type: remote`) into `~/.config/opencode/opencode.json(c)` | OAuth: `opencode mcp auth box` |
| Hermes Agent | `hermes` | Writes `mcp_servers.box` to `$HERMES_HOME/config.yaml` (default `~/.hermes`); restarts a running gateway | OAuth (`hermes mcp login box`) or `--auth key` |
| OpenClaw | `openclaw` | `openclaw mcp set box …` with `transport: streamable-http`; restarts a running Gateway when the key changes | OAuth (`openclaw mcp login box`) or `--auth key` |
| VS Code | `vscode` | Merges `servers.box` (`type: http`) into the user `mcp.json` | OAuth, when the server starts |
| Claude Desktop | `claude-desktop` | Writes nothing: remote servers are connectors in the app. Prints the steps | OAuth in the app |

Pick apps without prompts with `--client cursor,codex --yes`; `--yes` alone picks every app found. `--dry-run` shows what would change.

The CLI only changes or removes a server that points at box by Simular (`mcp.box.simular.ai`, the old `relay.simular.cloud`, its staging host, or your `BOX_MCP_URL`). If an app already has a different server named `box`, such as box.com's MCP server, `connect` stops without changing anything, and `remove` leaves it alone. To add box next to it, use `--name simular-box`. A symlinked config stays a symlink: the file it points to is updated. If a config can't be written (owned by another user, or locked by the app), connect says so; for Codex it prints the steps to add box in the Codex app's Settings instead.

## Sign-in

Every app signs in with OAuth by default: the app opens a browser page, you sign in to box and click Approve. No key to copy.

Hermes and OpenClaw often run around the clock on a server, where an expired OAuth sign-in waits for a person. For those, `--auth key` uses a personal key instead:

```bash
# create a key at https://box.simular.ai/keys, then:
BOX_TOKEN=cb_... npx @simular-ai/box connect --client hermes,openclaw --auth key
```

Without `BOX_TOKEN`, an interactive run asks for the key with hidden input. The key is never accepted as a command-line argument and never printed. It goes only where the app reads secrets: `MCP_BOX_API_KEY` in `$HERMES_HOME/.env`, `BOX_TOKEN` in `~/.openclaw/.env` (both `0600`). The app config holds only a `${...}` reference to it. No backup is kept of those `.env` files, because a backup would keep an old or removed key on disk. OpenClaw's Gateway reads `.env` only at start, and a running Hermes gateway keeps the old key, so connect restarts them when the key changes.

## Doctor

`doctor` checks, for each app it finds:

- box is configured, points at the current URL (not the old `relay.simular.cloud`), and no old `box-control` server is left
- the endpoint answers an unauthenticated request with `401` and a `WWW-Authenticate` link to its sign-in metadata, and that metadata names the same URL
- a configured personal key is accepted (the key is sent to the box endpoint only, never printed)

It prints a fix for each problem. `--json` prints a machine-readable report; the exit code is 1 when something needs fixing. OAuth sign-ins are stored by each app, so doctor can't see whether you've signed in.

## Offload

Move the coding task you are working on into your box, let an agent there keep going while you are away, and bring the work back. This is upstream cocoonbox's Offload (design §27), with the same box side.

```bash
npx @simular-ai/box login                                   # once: sign this CLI in to box in the browser
npx @simular-ai/box offload install-cli --kind claude       # once per box: the vendor's official installer, in the box
npx @simular-ai/box offload sign-in --kind claude           # once per box: Claude Code's own login, run in the box
```

Then, in Claude Code with the `box` plugin, `/box:offload` and later `/box:back`. Elsewhere, write the hand-over to the path `offload handover-path` prints (or paste the request `offload --handover-prompt --kind codex` prints into your agent), then:

```bash
npx @simular-ai/box offload --kind claude     # preflight, copy the repo, start the box agent from the hand-over
npx @simular-ai/box offload inbox             # what the box agent posted; offload send "..." answers it
npx @simular-ai/box back                      # wait for its hand-over, fetch its commits, merge them here
```

How it works:

- **Sign-in.** `login` signs the CLI in as the relay's first-party `cocoonbox-cli` client: the consent page opens in your browser, the answer comes back to a one-time listener on `127.0.0.1` (PKCE, `state` and issuer checked), and the CLI gets a device token of its own, listed under Keys -> Devices and revoked there or with `logout`. It is kept in `~/.simular-box/credentials.json` (`0600`, directory `0700`; `BOX_HOME` moves it). `BOX_TOKEN=cb_...` (a personal key) wins over it, for CI or a server. `login --token -` reads a personal key from stdin or a hidden prompt. A token is never accepted as an argument or printed.
- **The box CLI has its own login.** `offload sign-in` runs the vendor's login (`claude auth login`, `codex login --device-auth`, `cursor-agent login`) on a terminal in the box, relayed to yours, with the box's browser kept shut. The first https link it prints on that vendor's own sign-in hosts opens in your browser, once; no other link from the box is opened. Approve, then paste the code into your terminal. Nothing is copied from this computer.
- **Transport.** Everything goes over `Session.Exec` on the relay's gRPC: `npx @simular-ai/box rsh` is an ssh-like remote shell (`rsync -e`, `GIT_SSH_COMMAND`). An offload is three Execs: `begin` (box checks), rsync of the work tree and `.git` without objects, and `send`, whose stream carries the hand-over, `env.json`, the history as a git bundle and any opted-in secrets.
- **Back.** It waits for the box agent to go idle (a hand-over request pasted while it is ending a turn can be lost; `back --interrupt` stops its current step instead), then up to 10 minutes in all for its hand-over, fetches the box's commits over `rsh`, and lands them against the snapshot taken at offload: a fast-forward when your repo has not changed, else a clean merge applied uncommitted (never touching a file you changed meanwhile), else the branch `cocoonbox/back-<time>` with your work tree untouched.
- **Preflight.** It blocks on a non-git directory, a box missing `git`/`rsync`/`tmux`/`mise`, a missing or signed-out box CLI, an offload not yet brought back, and macOS-only commands. It warns (go on with `--yes`) about local services and VPN-only hosts the box cannot reach, git-ignored `.env*` files and other secrets (opt one in with `offload secrets add file:.env`; values travel only in the Exec stream and land on a tmpfs in the box), LFS and submodules, and a copy over 500 MB.
- **Limits.** macOS and Linux (needs `git` and `rsync`); git repositories only; the box agent commits but never pushes; one session per repo and three per box; the box agent runs with permission prompts bypassed.

## Other endpoints

`BOX_MCP_URL` points everything at another endpoint (for example staging): `BOX_MCP_URL=https://… npx @simular-ai/box connect`. Offload, `login` and `rsh` use its origin, or `BOX_ENDPOINT` when set. When box's endpoint moves, a new CLI version changes the default and `connect` updates each app: it rewrites a `box` entry that points at the old address and, for Claude Code, updates the `box@simular-box` plugin. Apps may then ask you to sign in to box again. box moved from `relay.simular.cloud` to `mcp.box.simular.ai` on 2026-11-04; `doctor` flags an app still on the old address.

## Development

```bash
cd cli && npm install && npm test
node bin/simular-box.js connect --dry-run
```

Test against a temporary home, never your own configs: `HOME=$(mktemp -d) node bin/simular-box.js connect --client cursor --yes`.

CI (`.github/workflows/publish-cli.yml`) runs on every non-draft PR:
- `check`: lint, unit tests and a smoke test on Linux, macOS and Windows.
- `clients` (Layer 1): installs each real client at the version pinned in `e2e/clients.json`, then runs `e2e/install-matrix.mjs <client>` in an isolated HOME: connect, the client's own listing, re-run, doctor, remove. No secrets.
- `live` (Layer 2): `e2e/live.mjs` with the staging key. It doesn't run on fork PRs.

Any `e2e/` script can be run locally the same way, with the client on PATH. They never touch your HOME.

### Releasing

Bump `version` in `package.json`, merge, then push a tag `cli-vX.Y.Z`. A `cli-vX.Y.Z-rc.N` tag publishes under the dist-tag `next`. The workflow publishes with npm trusted publishing (OIDC, no token) and provenance, then creates a GitHub release.

One-time setup, done by an owner of the `@simular-ai` npm org:

1. **Publish the first version by hand.** npm can only attach a trusted publisher to a package that already exists. `npm help trust` says: "Package must exist: The package you're configuring must already exist on the npm registry". From `cli/` on `main`, with 2FA: `npm publish --access public`. This version has no provenance, because provenance comes only from CI.
2. **Add the trusted publisher.** Either on npmjs.com (package → Settings → Trusted Publisher) or with npm >= 11.10.0: `npm trust github @simular-ai/box --repo simular-ai/box-plugin --file publish-cli.yml --env npm`. The values are organization `simular-ai`, repository `box-plugin`, workflow `publish-cli.yml`, environment `npm`.
3. **Push the next tag within 2 days.** A new trusted-publisher configuration expires if its first publish doesn't happen within 2 days.
