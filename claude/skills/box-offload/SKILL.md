---
name: box-offload
description: Hand this coding task to an agent in the user's box (their cloud computer) and take it back. Use when the user says offload, "move this to my box", "keep working while I'm away", "I'm back" or "bring it back", or when a message is exactly OFFLOAD or BACK.
---

The agent in the box starts fresh. It knows only what your hand-over says, plus the repo.
Write the hand-over as if for a capable engineer who has never seen this conversation.
`box` below is `npx -y @simular-ai/box@^0.2.0`. Run it in the repo the user works in. It does every
mechanical step: never copy files or secrets yourself, never print a secret, never edit the
files it writes.

## OFFLOAD

1. Finish the step you are in, or stop at a safe point. Do not start new work.
2. Run `box offload handover-path` in the repo and write the hand-over to the path it
   prints, with the template below. Fill every section; write "none" for an empty one. Be
   concrete: exact commands, versions you saw, file paths, error messages, decisions with
   their reasons. Under "Secrets needed" give names only, never values.
3. Run `box offload --kind claude` (or the CLI the user asked for in the box:
   `codex`, `cursor`). Add `--box NAME` when the user names a box.
   - "not signed in": ask the user to run `box login` in their terminal (it opens the
     browser), then run offload again.
   - Exit 3 is a block: stop and tell the user why, one line per finding. If the box CLI is
     missing or signed out, tell the user to run, in their own terminal,
     `box offload install-cli --kind <K>` and then `box offload sign-in --kind <K>`
     (the sign-in asks them to approve in the browser and paste a code, so you cannot do it).
   - Exit 4 is warnings: tell the user each one, and run again with `--yes` only when they
     agree, or said beforehand to go ahead.
   - For a secret it warns about, ask the user; only they opt one in
     (`box offload secrets add file:.env`). Never opt in on your own.
4. When it prints `offloaded`, tell the user the box, that its agent runs with permission
   prompts bypassed, and that `/box:back` returns the work. End your turn and make no more
   changes to this repo.
5. On exit 1, report its last line. Nothing changed on this computer; do not retry by hand.

While the task is in the box, `box offload inbox` shows what the box agent posted
(progress, questions), `box offload send "<answer>"` answers it, and
`box offload status` shows whether it is working. The user can watch its terminal with
the `rsh -t ... tmux attach` line offload printed.

## BACK

Run `box back` in the repo. It waits for the box agent to go idle, then up to 10 minutes in
all for its hand-over, then lands the box's work against the snapshot taken at the offload.
Report how the code landed, as its first line says: fast-forward (the branch now points at
the box's commit), merged (the branch moved to the box's commit, or the box's changes applied
uncommitted, with any uncommitted paths listed), unchanged, or a branch with conflicts, where
your work tree is untouched. If it says nothing of this repo is in a box and names a
`back.md`, the work has landed already: read that file as the hand-over. Then check the
hand-over's claims against `git log` and `git diff`, run its verify commands, and continue
from its next steps.

## Hand-over template

```markdown
# Hand-over: <one-line goal>

From: <local | box>   Agent: <claude|codex|cursor>   Repo: <path>   Branch: <branch> @ <short sha>

## Goal and definition of done
<what the user asked for, in their words where it matters; what "done" means>

## User preferences and constraints
<style, scope limits, things the user said not to do, deadlines; or none>

## Current state
<where the work stands in one paragraph: what works, what is broken, what is half-done>

## Decisions made
- <decision> — <why>; rejected: <alternative and why>

## Files touched
- `<path>` — <what changed and why; whether it is finished>

## Next steps
1. <the very next action, specific enough to start without asking>
2. <…>

## Commands
- Build: `<command>`   Test: `<command>`   Lint: `<command>`   Run: `<command>`
- Verify the current state: `<command>` → <what passing looks like>

## Environment facts
- Tools and versions: <go 1.26.x, rustc 1.9x, node 22.x, …; where each came from>
- Services: <local databases, ports, docker compose services; or none>
- Hosts: <APIs or internal hosts the task calls; or none>
- Secrets needed: <names only, never values; or none>
- Installed during this session: <packages and tools added; or none>

## Gotchas learned
- <non-obvious things that cost time: flaky tests, a wrong doc, a tool quirk>

## Open questions
- <what needs the user, and what to do meanwhile>
```
