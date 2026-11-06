# box for OpenClaw

Give your OpenClaw agent a computer of its own: a cloud Linux desktop with Chrome and a shell that it drives over MCP, around the clock, while your own machine stays free.

This is a native OpenClaw plugin. It declares box's remote MCP server (`https://mcp.box.simular.ai/mcp`, streamable HTTP, OAuth) and ships a `box` skill. It runs no code of its own.

## Install

```bash
openclaw plugins install @simular-ai/openclaw-box
```

On OpenClaw 2026.10.4 or older, use `clawhub:@simular-ai/openclaw-box`. The install works while the Gateway is running; no restart needed.

## Sign in

Open the OpenClaw Control UI, go to **Settings > Plugins > box by Simular**, and under **Accounts** choose **Connect**. Sign in to box in the browser and choose **Allow**. The page then shows **Connected**.

The box approval page says "Unverified - this agent registered itself": OpenClaw registers its own sign-in, so box can't confirm its name. That's expected; allow it only when you just started the sign-in yourself.

Sign-in needs the Control UI on the Gateway's own address (local loopback, its HTTPS address or its Tailscale address).

## Use it

Ask your agent something like "take a screenshot of my box" or "use box to open news.ycombinator.com and give me today's top 5 stories". Watch the box live, and take over when needed, at https://box.simular.ai/box.

## If you set box up with the CLI before

`npx @simular-ai/box connect --client openclaw` adds a server named `box` to `mcp.servers`. That entry overrides this plugin's `box` server, so keep one. To move to the plugin:

1. Stop the Gateway first: `openclaw gateway stop`, or Ctrl+C if it runs in the foreground (Quick start). `openclaw mcp unset` refuses to run while the Gateway is up.
2. `openclaw mcp unset box`
3. Start the Gateway again (`openclaw gateway start`, or `openclaw gateway run` in the foreground), then sign in from the plugin page as above.

## Build and publish

```bash
npm install
npm run build
clawhub package publish . --dry-run
clawhub package publish .
```
