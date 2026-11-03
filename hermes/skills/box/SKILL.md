---
name: box
description: Use box, a cloud Linux computer with Chrome and a shell, when a task needs a real computer - browsing sites (including ones behind a login), filling forms, using desktop apps, or running commands somewhere other than the user's machine.
---

# Use box

box is the user's own cloud Linux desktop. Its tools come from the `box` MCP server, which authenticates with the user's personal key in `MCP_BOX_API_KEY`. If box's tools fail with an authorization error, ask the user to create a key at https://box.simular.ai/keys and set `MCP_BOX_API_KEY`; never ask them to paste the key into chat. A sleeping box wakes on the first call, which can take a few seconds.

## Pick the right tool

- **Shell and files:** `shell` runs a command; `read_file`, `write_file`, `edit_file` and `list_dir` work on the box's files. Prefer these whenever the task can be done without the screen.
- **Web pages:** `browser_navigate` opens a URL, `browser_snapshot` or `browser_read` reads the page, `browser_click`, `browser_type` and `browser_fill` act on elements from the last snapshot, `browser_tabs` manages tabs, `browser_fetch` fetches a URL without rendering. Re-snapshot after the page changes; element refs go stale.
- **Desktop apps:** send a whole GUI plan in one `gui_plan` call (open the app, menu, click, type, wait, save) instead of a chain of single clicks. Use `desk` for one accessibility-tree action, `computer_act` and `computer_state` for raw pointer and keyboard work, and `script_run` for loops over many items.
- **Seeing the screen:** `screenshot` when you need to look; don't take one after every step.
- **The box itself:** `box_status`, `box_list`, `box_wake`, `box_hibernate`, `box_save` and `box_upgrade`.

## Working with the user

- The user can watch the box live and take over at https://box.simular.ai/box. Mention it for long tasks.
- When a step needs the user (a sign-in, a password, a 2FA code, a captcha, a payment), stop and ask them to do it on that page, then continue. Never ask for passwords in chat.
- Report what you did and anything you saved on the box, with paths.
