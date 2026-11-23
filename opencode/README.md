# box for OpenCode

[box](https://box.simular.ai) gives [OpenCode](https://opencode.ai) a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. OpenCode can browse sites (including ones behind a login), fill forms, use desktop apps and run commands there. You can watch the box live and take over at https://box.simular.ai/box.

## Install

Add the plugin to your OpenCode config (`~/.config/opencode/opencode.json` for every project, or `opencode.json` in one project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@simular-ai/opencode-box"]
}
```

Then sign in once and approve in the browser:

```bash
opencode mcp auth box
```

New accounts get free credit. Start `opencode` and ask for anything that needs a computer, for example "open Hacker News in my box and summarize the top five posts". `opencode mcp list` shows whether box is connected.

## What the plugin adds

- box's hosted MCP server, `https://mcp.box.simular.ai/mcp`, as the `box` server. If your config already has a `box` server (for example from `npx @simular-ai/box connect opencode`), yours is kept as it is.
- box's tools show up in OpenCode as `box_<tool>`, for example `box_shell` and `box_browser_navigate`. How to use them comes from the box server's own instructions.

## Sign-in and what it touches

- Sign-in is OAuth only, through OpenCode's own `opencode mcp auth`. OpenCode stores the token; the plugin reads no key, environment variable or local file.
- Network: only `https://mcp.box.simular.ai/mcp` and the box sign-in page.
- Commands and file edits run on the box, not on your machine.

## Releasing

Bump `version` in `opencode/package.json`, merge to main, then push a matching tag: `git tag opencode-v<X.Y.Z> && git push origin opencode-v<X.Y.Z>`. `.github/workflows/release-opencode.yml` publishes it to npm with provenance.

## Links

- Docs: https://box.simular.ai/docs/mcp
- Privacy policy: https://www.simular.ai/product-sai/privacy
- Terms of use: https://www.simular.ai/terms-of-use

## License

MIT. See [LICENSE](LICENSE).
