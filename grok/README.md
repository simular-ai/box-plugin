# box for Grok Build

[box](https://box.simular.ai) gives Grok a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, while your own computer stays free. Grok can browse sites (including ones behind a login), fill forms, use desktop apps and run commands there. You can watch the box live and take over at https://box.simular.ai/box.

The plugin adds the box MCP server (`https://mcp.box.simular.ai/mcp`) and a `box` skill that tells Grok which tool to use for what.

## Install

1. Install Grok Build and sign in (see the [Grok Build docs](https://docs.x.ai/build/overview)), then run `grok`.
2. Open the marketplace with `/marketplace`, find **box** and press `i` to install it.
   Until box is listed in xAI's marketplace, install it straight from this repo instead: `grok plugin install simular-ai/box-plugin#grok`.
3. Open the MCP servers tab with `/mcps`, select **box** and press `i` to sign in. Your browser opens the box sign-in page; sign in once with your box account (new accounts get free credit).
4. Once **box** shows ready, ask Grok for anything that needs a computer, for example "open Hacker News in my box and summarize the top five posts".

## Sign-in

The plugin uses OAuth only: you sign in in the browser once and Grok keeps the token. It carries no key, so there is nothing to paste or store in the package.

## What it touches

- Network: only `https://mcp.box.simular.ai/mcp` (box's MCP server) and the box sign-in page.
- Local files: none. The skill only tells Grok how to use box's tools; commands and file edits run on the box, not on your machine.

## Links

- Docs: https://box.simular.ai/docs/mcp
- Privacy policy: https://www.simular.ai/product-sai/privacy
- Terms of use: https://www.simular.ai/terms-of-use

## License

MIT. See [LICENSE](LICENSE).
