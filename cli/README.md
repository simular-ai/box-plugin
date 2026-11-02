# @simular-ai/box

Connect [box](https://box.simular.ai) to your AI apps in one command. box gives your AI agent a computer of its own: a cloud Linux desktop with Chrome and a shell, driven over MCP.

```bash
npx @simular-ai/box connect
```

The CLI finds the AI apps on this computer, asks which ones should use box, and adds the box MCP server (`https://relay.simular.cloud/mcp`) to each one in its own format. Other servers and settings in those files are left alone, each changed file gets a backup next to it (`*.box-backup-<time>`), and running it again changes nothing.

```bash
npx @simular-ai/box doctor     # is box set up right in each app? is the endpoint up? is the key valid?
npx @simular-ai/box remove     # undo connect
```

The command is `simular-box` (`box` belongs to box.com's CLI), so after `npm i -g @simular-ai/box` it is `simular-box connect`.

## Apps

| App | `--client` | What connect does | Sign-in |
| --- | --- | --- | --- |
| Claude Code | `claude-code` | Installs the [`claude/`](../claude/) plugin (box server + box skill) with `claude plugin install box@simular-box`. With `BOX_MCP_URL` set, `claude mcp add --scope user --transport http box <url>` instead | OAuth: `/mcp` → box → Authenticate |
| Codex | `codex` | Writes `[mcp_servers.box]` to `$CODEX_HOME/config.toml` (default `~/.codex`) | OAuth: `codex mcp login box` |
| Cursor | `cursor` | Merges `mcpServers.box` into `~/.cursor/mcp.json` | OAuth: Settings → MCP → Login |
| OpenCode | `opencode` | Merges `mcp.box` (`type: remote`) into `~/.config/opencode/opencode.json(c)` | OAuth: `opencode mcp auth box` |
| Hermes Agent | `hermes` | Writes `mcp_servers.box` to `$HERMES_HOME/config.yaml` (default `~/.hermes`); restarts a running gateway | OAuth (`hermes mcp login box`) or `--auth key` |
| OpenClaw | `openclaw` | `openclaw mcp set box …` with `transport: streamable-http`; restarts a running Gateway when the key changes | OAuth (`openclaw mcp login box`) or `--auth key` |
| VS Code | `vscode` | Merges `servers.box` (`type: http`) into the user `mcp.json` | OAuth, when the server starts |
| Claude Desktop | `claude-desktop` | Writes nothing: remote servers are connectors in the app. Prints the steps | OAuth in the app |

Pick apps without prompts with `--client cursor,codex --yes`; `--yes` alone picks every app found. `--dry-run` shows what would change.

## Sign-in

Every app signs in with OAuth by default: the app opens a browser page, you sign in to box and click Approve. No key to copy.

Hermes and OpenClaw often run around the clock on a server, where an expired OAuth sign-in waits for a person. For those, `--auth key` uses a personal key instead:

```bash
# create a key at https://box.simular.ai/keys, then:
BOX_TOKEN=cb_... npx @simular-ai/box connect --client hermes,openclaw --auth key
```

Without `BOX_TOKEN`, an interactive run asks for the key with hidden input. The key is never accepted as a command-line argument and never printed. It goes only where the app reads secrets: `MCP_BOX_API_KEY` in `$HERMES_HOME/.env`, `BOX_TOKEN` in `~/.openclaw/.env` (both `0600`). The app config holds only a `${...}` reference to it. OpenClaw's Gateway reads `.env` only at start, and a running Hermes gateway keeps the old key, so connect restarts them when the key changes.

## Doctor

`doctor` checks, for each app it finds:

- box is configured, points at the current URL, and no old `box-control` server is left
- the endpoint answers an unauthenticated request with `401` and a `WWW-Authenticate` link to its sign-in metadata
- a configured personal key is accepted (the key is sent to the box endpoint only, never printed)

It prints a fix for each problem. `--json` prints a machine-readable report; the exit code is 1 when something needs fixing. OAuth sign-ins are stored by each app, so doctor can't see whether you've signed in.

## Other endpoints

`BOX_MCP_URL` points everything at another endpoint (for example staging): `BOX_MCP_URL=https://… npx @simular-ai/box connect`. When box's endpoint moves, a new CLI version changes the default and `connect` updates each app.

## Development

```bash
cd cli && npm install && npm test
node bin/simular-box.js connect --dry-run
```

Test against a temporary home, never your own configs: `HOME=$(mktemp -d) node bin/simular-box.js connect --client cursor --yes`.

Release: bump `version` in `package.json`, then push a tag `cli-vX.Y.Z`. The release workflow runs the tests and publishes to npm with provenance.
