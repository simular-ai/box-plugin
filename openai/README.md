# box by Simular for ChatGPT and Codex

**Live:** [box by Simular in ChatGPT's plugin directory](https://chatgpt.com/plugins/plugin_asdk_app_6af13fd141b48191b8c8fdb9ebd37276), listed "By Simular", version 1.0.0
(published 2026-11-14). It connects the prod MCP server only, so staging is still added by hand as a
custom MCP server.

The OpenAI plugin package: one listing covers ChatGPT and Codex. It connects the remote MCP server
`https://mcp.box.simular.ai/mcp` with OAuth (dynamic client registration) and ships two skills:
`get-started` (onboarding) and `box` (a copy of `claude/skills/box/SKILL.md`).

Format: OpenAI's portable plugin layout (https://developers.openai.com/plugins/build/plugins):
`plugin.json` with listing, review test cases and release notes under `extensions.com.openai`,
`mcp.json`, `skills/` and `assets/` (the box mark, rendered from box-portal `public/favicon.svg`).

## Build the ZIP

```sh
openai/build-zip.sh            # writes box-by-simular-openai-<version>.zip in the current folder
```

Upload it at https://platform.openai.com/plugins (Upload new or existing plugin, "With MCP").

## Not in the package (entered in the portal)

- The reviewer test account and its sign-in steps. Never put credentials in this folder.
- The demo video link, unless it is added here as `review.demo_recording_url`.
- The domain verification token: box serves it at
  `https://mcp.box.simular.ai/.well-known/openai-apps-challenge` (prod values, `oauth.openai_apps_challenge`).

## Releasing an update

Bump `version` in `plugin.json` (OpenAI refuses an unchanged version), update
`publication.release_notes`, rebuild and upload. `name` (`box-by-simular`) can never change.
Tool changes on the MCP server need no new ZIP; OpenAI rescans the server.
