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

The key is kept in dsh's own credentials store as `BOX_TOKEN`, not in settings. On the command line, an exported `BOX_TOKEN` or a `BOX_TOKEN=cb_...` line in `~/.dsh/.env` works too. To use the staging box, also set `BOX_MCP_URL=https://staging.relay.simular.cloud/mcp` (VPN required).

Always install from a versioned release link like the one above. pnpm caches what a tarball URL resolved to, so new contents behind the same URL (such as `releases/latest`) fail to install.

## How it works

- `cordis.patch.yml` inserts two rows: `box-auth` (this package) and `mcp-box` (`@deepseek-ai/dsh-mcp-client`, shipped with dsh). `mcp-box` injects the `boxAuth` service, so it waits quietly until a key exists and restarts with the new header when the key changes.
- `index.js` (Host half) resolves `BOX_TOKEN` from dsh's credentials (store, then launch environment, then `~/.dsh/.env`) and provides `boxAuth`.
- `client.js` (browser half) is the key page in the `plugins.bundle.config` slot. It is hand-written in dsh's lazy-CJS client format, so the package has no build step.

Tested on dsh 0.2.1-rc.5 web, which serves the same UI as Desktop.

Contributed by Dora Qian (originally in simular-ai/box-portal#18).
