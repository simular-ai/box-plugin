---
name: box
description: Use box, a cloud Linux computer with Chrome and a shell, when a task needs a real computer - browsing sites (including ones behind a login), filling forms, using desktop apps, or running commands somewhere other than the user's machine.
---

# Use box

box is the user's own cloud Linux desktop. Its tools come from the `box` MCP server. The first call signs the user in through their browser once; after that it just works. A sleeping box wakes on the first call, which can take a few seconds.

## Pick the right tool

- **Shell and files:** `shell` runs a command; `read_file`, `write_file`, `edit_file` and `list_dir` work on the box's files. Prefer these whenever the task can be done without the screen.
- **Web pages:** `browser_navigate` opens a URL, `browser_snapshot` or `browser_read` reads the page, `browser_click`, `browser_type` and `browser_fill` act on elements from the last snapshot, `browser_tabs` manages tabs, `browser_fetch` fetches a URL without rendering. Re-snapshot after the page changes; element refs go stale.
- **Desktop apps:** send a whole GUI plan in one `gui_plan` call (open the app, menu, click, type, wait, save) instead of a chain of single clicks. Use `desk` for one accessibility-tree action, `computer_act` and `computer_state` for raw pointer and keyboard work, and `script_run` for loops over many items.
- **Seeing the screen:** `screenshot` when you need to look; don't take one after every step.
- **The box itself:** `box_status`, `box_list`, `box_wake`, `box_hibernate`, `box_save` and `box_upgrade`.

## Moving files between box and this computer

The box tools act inside the box, and `read_file` reads text only. When the user asks to bring a file home or send one to the box, and you also have a shell on the user's computer (Claude Code, Codex and other CLI agents), use the box CLI there. It runs over box's API as the signed-in user, and the copy is byte for byte:

- Download a file: `npx -y @simular-ai/box@1.2.1 exec -- cat /home/user/report.pdf > report.pdf`
- Upload a file: `npx -y @simular-ai/box@1.2.1 exec -c 'cat > /home/user/data.csv' < data.csv`
- A folder, either way, with rsync. The host is the box's name from `box_list` (or `npx -y @simular-ai/box@1.2.1 ls`): `rsync -az -e "npx -y @simular-ai/box@1.2.1 rsh" main:/home/user/out/ ./out/`

Send only what the user asked for: never a secret (`.env`, keys, credentials) unless the user names that file, and add `--exclude .env` when you rsync a folder up. Don't overwrite a local file without asking; pick a new name instead. `exec` uses the first box unless you add `--box <name>`. If the CLI says it isn't signed in, run `npx -y @simular-ai/box@1.2.1 login` and ask the user to allow it in the browser. Without a shell on the user's computer (ChatGPT, Claude on the web) there is no download yet: tell the user the file's path on the box.

## Working with the user

- The user can watch the box live and take over at https://box.simular.ai/box. Mention it for long tasks.
- When a step needs the user (a sign-in, a password, a 2FA code, a captcha, a payment), stop and ask them to do it on that page, then continue. Never ask for passwords in chat.
- Report what you did and anything you saved on the box, with paths.
