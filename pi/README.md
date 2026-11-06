# box for Pi

[box](https://box.simular.ai) gives the [Pi coding agent](https://pi.dev) a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. Pi can browse sites (including ones behind a login), fill forms, use desktop apps and run commands there. You can watch the box live and take over at https://box.simular.ai/box.

## Install

```bash
pi install npm:@simular-ai/box-pi
```

Then start `pi`, run `/mcp login box` inside the session and approve in the browser (the `pi mcp` shell commands don't load extensions, so they can't see box). New accounts get free credit. Ask Pi for anything that needs a computer, for example "open Hacker News in my box and summarize the top five posts".

## What the package adds

- An extension that registers box's hosted MCP server, `https://mcp.box.simular.ai/mcp`, with Pi's built-in MCP support. Needs Pi 0.99 or later; on an older Pi the extension prints a warning and does nothing. If you use pi-mcp-adapter instead, it connects the same server.
- A `box` skill that tells Pi which box tool to use for what. Tools are named `mcp__box__<tool>`; `shell`, `browser_navigate`, `browser_snapshot`, `screenshot` and `box_status` are declared directly and the rest are found with `tool_search`.

## Sign-in and what it touches

- Sign-in is OAuth only. Pi stores the token in `~/.pi/agent/mcp-auth.json`; the package reads no key, environment variable or local file.
- Network: only `https://mcp.box.simular.ai/mcp` and the box sign-in page.
- Commands and file edits run on the box, not on your machine.

## Releasing

Bump `version` in `pi/package.json`, merge to main, then push a matching tag: `git tag pi-v<X.Y.Z> && git push origin pi-v<X.Y.Z>`. `.github/workflows/release-pi.yml` publishes it to npm with provenance.

## Links

- Docs: https://box.simular.ai/docs/mcp
- Privacy policy: https://www.simular.ai/product-sai/privacy
- Terms of use: https://www.simular.ai/terms-of-use

## License

MIT. See [LICENSE](LICENSE).
