# box for DeepSeek Harness (dsh)

dsh's MCP client sends fixed headers and has no sign-in, so it reaches box with a personal key.

1. Create a personal key at https://box.simular.ai/keys (under Personal keys, name it "dsh"). It is shown once.
2. Install the plugin. In dsh Desktop (or dsh web), open **Plugins → Add plugin**, paste this link and turn the plugin on:

   ```
   https://github.com/simular-ai/box-plugin/releases/download/dsh-v0.2.1/dsh-box.tgz
   ```

   From a terminal: `dsh plugin add https://github.com/simular-ai/box-plugin/releases/download/dsh-v0.2.1/dsh-box.tgz`
3. Open **box** on the Plugins page, paste your key and click **Save**. box connects within a second; changing the key later needs no restart.

box's tools show up as `mcp__box__*`.

When the agent works on the box's screen (clicks, typing, the browser, screenshots) or calls `box_view`, the box's live screen appears in the chat, view only, as in ChatGPT and Claude, without anyone asking for it. It shows once per turn, stays in the chat while the agent works and after it answers, and **Take control** opens the screen in your browser, where you can type. Shell and file tools, and account tools such as `usage`, don't bring it up.

The key is kept in dsh's own credentials store as `BOX_TOKEN`, not in settings. On the command line, an exported `BOX_TOKEN` or a `BOX_TOKEN=cb_...` line in `~/.dsh/.env` works too. To use the staging box, also set `BOX_MCP_URL=https://staging.relay.simular.cloud/mcp` (VPN required).

Always install from a versioned release link like the one above. pnpm caches what a tarball URL resolved to, so new contents behind the same URL (such as `releases/latest`) fail to install.

## How it works

- `cordis.patch.yml` inserts two rows: `box-auth` (this package) and `mcp-box` (`@deepseek-ai/dsh-mcp-client`, shipped with dsh). `mcp-box` injects the `boxAuth` service, so it waits quietly until a key exists and restarts with the new header when the key changes.
- `index.js` (Host half) resolves `BOX_TOKEN` from dsh's credentials (store, then launch environment, then `~/.dsh/.env`) and provides `boxAuth`.
- `client.js` (browser half) is the key page in the `plugins.bundle.config` slot. It is hand-written in dsh's lazy-CJS client format, so the package has no build step.
- Live view: dsh has no MCP Apps host, so `client.js` hosts box's live view page (`ui://box/live`, the MCP App ChatGPT and Claude render) itself. dsh folds a turn's tool calls as soon as the next one starts, so the view is not a tool card: a conversation definition publishes it as its own chat node at the turn's `box_view` call or, without one, its first box tool that works on the screen (the page then gets the box from `box_status`), at the turn level (`groupTree: 'turn'`), which dsh keeps outside the folded process while the agent works and after. The page runs in a sandboxed iframe without same-origin access and talks MCP Apps over `postMessage`; its tool calls go to `POST /api/simular-box/live`, a Host route in `index.js` that adds the key (so the key never reaches the browser) and passes only the six tools the page uses (`box_view`, `box_view_token`, `box_status`, `box_approvals`, `box_approval_token`, `box_approval_answer`).

Tested on dsh 0.2.1-rc.5 web, which serves the same UI as Desktop. The live view was tested on dsh 0.2.2-rc.1 web.

Contributed by Dora Qian (originally in simular-ai/box-portal#18).
