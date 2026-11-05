# Layer 3: agent-driven onboarding runs

Status: first cell built (`run.mjs`, `cells.json`, `driver.md`, `judge.md`), not yet run live. Tracks [simular-ai/box-plugin#11](https://github.com/simular-ai/box-plugin/issues/11).

## Goal

Find out when a new user can no longer get from "I want box" to a first working tool call, before a user tells us. The main cause we want to catch is upstream change: Claude Code, Codex, Cursor, Hermes and the desktop apps ship often, and any release can move a path, a button or an auth flow. Our own regressions are a secondary target. Layers 1 and 2 already cover the parts that don't change.

A run must not depend on steps we wrote down in advance. Scripted steps break when a client's UI moves, so they test the script, not the onboarding. Instead an agent plays the new user and works the steps out each time from what a user would see.

## Roles

| Role | What it is | First version |
|---|---|---|
| Driver | An agent acting as the new user. It sees the screen, clicks and types. | Claude Code with the box MCP server |
| Machine under test | The "user's computer". The client gets installed here. | A box (Ubuntu desktop), reset from a snapshot per run |
| Client under test | The app the user is setting box up in | Claude Code CLI, then Codex CLI, Cursor, ChatGPT desktop (Linux) |
| Box under test | The box the client reaches over MCP after sign-in | The test account's box on prod |
| Judge | A separate agent that reads the recording afterwards | Claude Code, fresh session per run |

Later versions add a Mac mini as the machine under test for macOS builds, and Parallels VMs on it for Windows and Linux. The roles and the run folder below stay the same. Only the driver's tool set changes.

## How a run works

1. **Reset.** Restore the machine under test from a known snapshot. Apply the cell's seeds (for example, a second `codex` on PATH, or two Google accounts signed in to Chrome).
2. **Hand over.** Give the driver only what a real user gets for this entry point: the landing line `Set up box from https://box.simular.ai/install`, an "Open in" link, or the install.md URL. The driver also gets the rules below.
3. **Act.** The driver works through the onboarding on the box's screen until it gets a reply to one real task through box, or decides it is stuck.
4. **Collect.** The harness saves the run folder, including the server-side records for the run.
5. **Judge.** A fresh judge agent reads the run folder and writes a verdict and improvements.
6. **File.** Improvements become issues or draft PRs (see Filing).
7. **Clean up.** Revoke the run's grant and delete anything the run created on the test account.

### Driver rules

The driver must act as a user would. It controls the box through `screenshot`, `computer_act` and `computer_state`. It types into the box's own terminal window when a user would use a terminal (for example, `npx @simular-ai/box connect`), so the step is on screen and in the recording.

The driver must not:

- use `shell`, `write_file`, `edit_file` or `browser_*` during the user flow. These tools are for steps 1 and 7 only, run by the harness.
- edit config files by hand, read our source code, or use any URL that the user-facing pages don't show.
- retry the same failing step more than three times.

If the driver breaks a rule to get past a problem, it must say so in a step note. The judge counts every such step as a workaround.

## Recording

The recording must not depend on the driver remembering to take notes. The driver is a headless `claude -p` session with `--output-format stream-json`, which writes every tool call, its arguments, its result and every screenshot to `transcript.jsonl`. `extract.mjs` turns that into `steps.jsonl` and `screenshots/`. The driver's notes ("I clicked Login because...") are the text it writes before each call.

The driver rules are enforced by the CLI, not only by the prompt. `--tools ""` removes every built-in tool, `--strict-mcp-config` loads only the box server, `--allowedTools` allows only `screenshot`, `computer_act` and `computer_state`, and `--disallowedTools` denies every other box tool. A denied attempt still shows in the transcript, so the judge sees it.

Runs are written to `~/.box-layer3/runs/` (or `LAYER3_RUNS_DIR`), outside the repo, because they show the test account's screen.

### Run folder

```
runs/<run_id>/
  run.json          cell, machine, snapshot id, client and version, driver model,
                    account label, start and end time, the driver's own claim
  steps.jsonl       one line per tool call: index, time, tool, arguments, result
                    summary, screenshot file, driver note
  screenshots/      000.png, 001.png, ...
  transcript.jsonl  the driver's full Claude Code transcript
  funnel.json       server-side records for this run's user and time window
  judge.json        written by the judge
```

The run folder is the contract between the driver and the judge. Either side can change as long as the folder keeps this shape.

### Server-side funnel

`funnel.json` lists which onboarding steps the box service saw for the run:

1. consent page served and approved (`/oauth/authorize`)
2. token exchange
3. `initialize` on `/mcp`
4. `tools/list`
5. first `tools/call`

Each entry records the user and grant. Steps 1, 3, 4 and 5 are in box api logs today. Step 2, and any 401 responses, are not logged yet. That logging is a follow-up in box-portal.

## Judge

The judge is a fresh agent. It gets only the run folder, never the driver's live session, so the driver's claim can't sway it. It writes `judge.json`:

```json
{
  "verdict": "pass | fail | blocked",
  "reasons": [{ "text": "...", "steps": [12, 13] }],
  "workarounds": [{ "text": "...", "steps": [20] }],
  "improvements": [
    {
      "target": "install.md | cli | portal | client-docs | harness",
      "title": "...",
      "detail": "...",
      "steps": [8, 9],
      "proposed": "issue | draft-pr"
    }
  ]
}
```

Verdicts:

- **pass.** `funnel.json` shows a first `tools/call` as the intended account. The driver used no workarounds. The user saw an example prompt after connecting.
- **fail.** The onboarding or its docs failed a user. Only this verdict files product issues.
- **blocked.** The harness failed: the box didn't wake, the snapshot didn't restore, or the model hit a limit. It files nothing about the product, so harness problems don't fill the tracker.

Any workaround makes the run a fail, even when the funnel completed. An agent that hand-edits a config still connects, but a real user would not.

## Filing

Recordings show the test account's email, the Google account chooser and sometimes tokens. This repo is public, so evidence never goes here.

- Issues go to `simular-ai/box-portal` (private) with screenshots and the relevant transcript lines. Run folders live in private storage, and issues link to them.
- Before filing, the judge searches open issues for the same failure. If it finds one, it adds a comment ("seen again in run X") instead of opening a new issue.
- At most three new issues per run.
- PRs only for doc and copy fixes, for example install.md. They open as drafts and never merge without review.
- `harness` improvements (driver prompt, seeds, judge rubric) go to this repo, with no screenshots.

## Test account

A team member's account is the test account for now. It moves to `dev@simular.ai` later. The account is one config value, so the switch is one line.

Until then:

- Cleanup (step 7) matters more, because runs create grants on a real account.
- Free-tier cells (caps, `max_boxes`) wait for the dedicated account, unless the current account is on the free tier.
- The box's Chrome profile is signed in only to the test account, so no other account appears in screenshots.

## First run

One cell, driven by hand once to test the recording and the judge before building a runner:

- Entry point: the landing line pasted into Claude Code CLI on the box
- Client: Claude Code CLI, latest version
- Auth: MCP OAuth
- Environment: clean snapshot, with the preinstalled `codex` and `claude` removed

The run counts if the judge can reach a verdict from the folder alone, and every reason it gives points at a step and a screenshot.

After that, in order:

1. Codex CLI with a second `codex` on PATH. A stock box already has `codex` and `claude` in `/usr/local/bin`, so this seed is the snapshot as it is today.
2. Two Google accounts signed in to Chrome, asserting the grant user.
3. ChatGPT desktop (Linux preview).
4. A nightly schedule over the cells, with an alert when a scheduled run posts no result.

## Open questions

1. **One box or two.** Settled for now: the client under test reaches the same box the driver is using (run 1 described its own terminal). A read-only first task, a screenshot, is safe on one box.
2. **Where the driver runs.** A local Claude Code session for the first run. For nightly runs, a GitHub workflow or the Mac mini. A GitHub workflow needs a box key or OAuth token as a secret.
3. **Pass rate.** One run is a sample. How many runs per cell per night, and what pass rate counts as green?
4. **Which tool was called.** `funnel.json` comes from `Grants.List`: approval time and first token use. box api does not expose token exchange or `tools/call` per grant yet, so the screenshots still decide whether the task ran.
5. **Sign-in.** Settled for now: the box's Chrome is signed in to the test account once by hand, and the consent page then needs one click. box has no way to fill a web password without the agent seeing it.
