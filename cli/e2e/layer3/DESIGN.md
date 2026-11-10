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

## Cells

A cell is one test case: one way a user might set up box, starting from one state. Cells live in `cells.json`. `cells.mjs` holds the allowed values for each dimension and rejects a cell that uses any other value.

### Dimensions

Each cell picks one value for each of these three:

| Field | Question it answers |
|---|---|
| `app` | Which app is the user setting box up in? |
| `setup` | What does the user do first? |
| `alreadySetUp` | What is already there before the run starts? |

A cell's name is the three values joined with `/`, so the name reads as a sentence: `claude-code-cli/paste-landing-line/nothing` is "Claude Code CLI, the user pastes the landing line, nothing set up yet". Each cell also has a `title` with that sentence written out, which run output and filed issues show.

Two more dimensions have only one value so far, so they are not fields yet. The machine is always a Linux box. The account is always the test account.

#### `app`

| Value | App |
|---|---|
| `claude-code-cli` | Claude Code, the command-line app |

Each app in `cells.mjs` also records how it signs in to box and the name it shows on box's sign-in page. Sign-in is not a separate dimension, because it follows from the app. Most apps click Allow in the browser (OAuth). Hermes, OpenClaw and dsh paste a personal key instead. A cell names its sign-in only for an app that supports both.

#### `setup`

| Value | What the user does first | Apps it applies to |
|---|---|---|
| `paste-landing-line` | Pastes `Set up box from https://box.simular.ai/install` into their agent, and the agent does the rest | Claude Code, Codex, Cursor, Gemini CLI, OpenCode, any coding agent. claude.ai and ChatGPT chat reply with the steps instead of installing |
| `click-open-in-button` | Clicks "Open in Claude / Codex / Cursor" on the box site, which opens the app with the setup prompt filled in | Claude Code (`claude://`), Codex (`codex://`), Cursor (`cursor.com/link`) |
| `click-add-to-claude-link` | Clicks the one-tap "Add to Claude" link, which opens claude.ai connector settings with box filled in | claude.ai, the Claude desktop app |
| `click-install-in-vscode` | Clicks the VS Code install link, then Install in VS Code | VS Code |
| `run-npx-connect` | Runs `npx @simular-ai/box connect` in their own terminal | Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Hermes, OpenClaw, VS Code |
| `add-connector-in-settings` | Adds box by hand in the app's connector settings, following install.md | claude.ai, the Claude desktop app, ChatGPT |
| `edit-app-config` | Follows install.md's manual steps for their app, such as `claude mcp add`, Codex's TOML file or Cursor's JSON file | Claude Code, Codex, Cursor, Gemini CLI, dsh, any MCP app |

`setup` is what the user does first, not every step that follows. In runs 3 and 5, Claude Code was blocked from running `npx` and fell back to `claude mcp add`. That run is still `paste-landing-line`. The fallback is something the judge reports from the recording.

#### `alreadySetUp`

| Value | What is there before the run |
|---|---|
| `nothing` | box is not set up anywhere: no MCP entry, no claude.ai connector, no live grant |
| `claude-ai-connector` | The user's claude.ai account already has the box by Simular connector, and the app loads it |

Values to add next, from issue #11: `second-codex-on-path`, `old-box-entry`, `another-server-named-box`, `two-google-accounts`, `expired-access`.

### What a cell holds

Besides its three values and its title, a cell has:

- `reset`. Shell commands the harness runs on the box to reach the cell's starting state, such as installing the latest app or turning claude.ai connectors off.
- `precheck`. A command that must print `OK`. If it doesn't, the run stops as `blocked` instead of testing the wrong thing.
- `precheckHelp`. What a person has to fix by hand when the precheck fails.
- `handover`. The user's situation, as the driver hears it. This is all the driver knows about how to start.
- `task`. The one thing the user wants to do with box once it works.

The steps between `handover` and `task` are not written down on purpose. The driver works them out from the screen on each run, so an upstream change shows up as the driver getting stuck.

### Cells today

| Name | Title |
|---|---|
| `claude-code-cli/paste-landing-line/nothing` | Claude Code CLI: a new user pastes the landing line, with nothing set up yet |
| `claude-code-cli/paste-landing-line/claude-ai-connector` | Claude Code CLI: the user pastes the landing line, but their claude.ai account already has the box connector |

To add a cell, add an entry to `cells.json`. A new `app` value also needs an entry in `cells.mjs` with the name the app shows on box's sign-in page, so the run can find its grant.

## How a run works

1. **Reset.** Run the cell's `reset` commands on the box, then its `precheck`.
2. **Hand over.** Give the driver the cell's `handover` and `task`, and the rules below.
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
  run.json          the cell (name, title, values), the app's version, driver model,
                    account label, start and end time, the driver's own claim,
                    and the grants the run revoked
  reset.log         the reset and precheck commands and what they printed
  steps.jsonl       one line per tool call: index, time, tool, arguments, result
                    summary, screenshot file, driver note
  screenshots/      000.png, 001.png, ...
  transcript.jsonl  the driver's full Claude Code transcript
  funnel.json       server-side records for this run's user and time window
  judge.json        written by the judge
```

The run folder is the contract between the driver and the judge. Either side can change as long as the folder keeps this shape.

### Server-side funnel

`funnel.json` is what box's server saw for the run. It comes from box's list of apps connected to the test account (cocoonbox `Grants.List`).

- `approved` is true when someone clicked Allow on box's sign-in page during the run, for the cell's app.
- `used` is true when the app then sent at least one request to box.
- `grants` lists the grants the run created, with when each was allowed and first used.

A grant counts as the run's own when the cell's app created it during the run. A grant from before the run, such as a claude.ai connector, never counts. After the run, the harness revokes the run's own grants. A run stops as `blocked` when the cell's app already holds a live grant, because clicking Allow again renews that grant instead of creating one.

`used` does not mean a tool ran. Connecting counts as a request. box does not record which tools an app called, so the screenshots still show whether the task ran.

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

- **pass.** A screenshot shows the app's reply to the task through box. The driver used no workarounds. The user saw an example prompt or a clear next step after connecting.
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

## Next cells

In order:

1. `codex-cli/paste-landing-line/second-codex-on-path`. A stock box already has `codex` and `claude` in `/usr/local/bin`, so this starting state is the box as it is today.
2. `claude-code-cli/paste-landing-line/two-google-accounts`, checking that the grant goes to the intended account.
3. ChatGPT desktop (Linux preview) with `click-open-in-button`.
4. A nightly schedule over the cells, with an alert when a scheduled run posts no result.

## Open questions

1. **One box or two.** Settled for now: the client under test reaches the same box the driver is using (run 1 described its own terminal). A read-only first task, a screenshot, is safe on one box.
2. **Where the driver runs.** A local Claude Code session for the first run. For nightly runs, a GitHub workflow or the Mac mini. A GitHub workflow needs a box key or OAuth token as a secret.
3. **Pass rate.** One run is a sample. How many runs per cell per night, and what pass rate counts as green?
4. **Which tool was called.** `funnel.json` comes from `Grants.List`: approval time and first token use. box api does not expose token exchange or `tools/call` per grant yet, so the screenshots still decide whether the task ran.
5. **Sign-in.** Settled for now: the box's Chrome is signed in to the test account once by hand, and the consent page then needs one click. box has no way to fill a web password without the agent seeing it.
