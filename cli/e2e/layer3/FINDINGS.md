# Layer 3 findings

Problems found while building and running layer 3, before the judge files issues on its own. Each entry says where it came from. Recordings live in `~/.box-layer3/runs/` on the machine that ran them, not in this repo.

## Onboarding (product)

| # | Finding | Target | Source |
|---|---|---|---|
| 1 | Claude Code's auto mode blocks `npx @simular-ai/box connect` as "Code from External". Claude Code falls back to the manual `claude mcp add` path in install.md, which works, so the main path fails under Claude Code's default mode. | install.md, cli | run `2026-11-05T06-23-49-887Z-claude-code-landing`, steps 5 and 6 |
| 2 | After adding box, the user is told to run `/mcp` and authenticate. `/mcp` in the same session shows "No MCP servers configured". Claude Code needs a restart first, and nothing says so. | install.md | same run, steps 7 to 9 |
| 3 | On box.simular.ai/sign-in, closing the Google sign-in popup leaves both sign-in buttons spinning until the page is reloaded. | portal | same run, steps 14 to 16 |
| 2a | Seen again with box fully working: the agent's reply says "Type /mcp here" as step 1 and "Start a new chat" as step 3. The driver had to guess the restart, so the run failed on a workaround although box connected and the task succeeded. | install.md | run `2026-11-05T06-36-07-346Z-claude-code-landing`, steps 8 to 13 |
| 13 | install.md and the agent's reply say "click **Approve**", but the consent page's button says **Allow**. | install.md | same run, steps 8 and 16 |
| 14 | After `/exit` and relaunch, Claude Code asked to trust `/home/user` again, although it had been trusted minutes earlier. Possibly upstream Claude Code behaviour, not yet confirmed. | client-docs | same run, step 12; also run `06-23-49`, step 9 |
| 4 | Fetching the install URL, Claude Code's first probe showed a red "Exit code 127" next to the HTTP 200 headers. It recovered, but a new user sees an error on the first step. | install.md | run `2026-11-05T06-20-57-248Z-claude-code-landing`, step 5 |

Filed automatically by run `2026-11-05T06-58-25-137Z-claude-code-landing`: box-portal#152 (`box connect` should print the restart-first order; same root cause as #147, fixed in the CLI) and box-portal#153 (the consent page shows no confirmation after Allow, so a second click lands on a dead localhost callback). The same run commented "seen again" on box-portal#147.

Filed by hand in simular-ai/box-portal (private): #1 as box-portal#146, #2 and #2a as box-portal#147, #3 as box-portal#148, #4 as box-portal#149, #13 as box-portal#150. #14 is not filed until it is confirmed.

## box platform

| # | Finding | Target | Source |
|---|---|---|---|
| 5 | No password filling for web pages. box has a secrets vault for **API keys** (box-portal `src/secrets/`, cocoonbox `Keys`): a box holds a stand-in in an env var and its egress swaps in the real value on the key's hosts only. It cannot fill a password into a sign-in page without the agent seeing it. Sign-in for tests relies on a Chrome profile signed in once by hand. | box | box-portal source and `keys.proto`, 2026-11-05 |
| 6 | Copy and paste don't work in the screen view at box.simular.ai/box. | portal | reported by hand while signing the box's Chrome in, 2026-11-05 |

#5 is covered by box-portal#72 (sign in to sites in the box without leaving the app). #6 is not filed yet.

## Harness

| # | Finding | Status |
|---|---|---|
| 7 | Claude Code on the box loads the signed-in claude.ai account's connectors, including box, so a "clean" cell never installs anything. | Fixed: the clean cell sets `ENABLE_CLAUDEAI_MCP_SERVERS=false`. The connector path is now its own cell. |
| 8 | The driver typed ahead into a restarting Claude Code, and the Enter landed on the trust prompt, whose default is "No, exit". | Fixed: driver rule against typing ahead. |
| 9 | OAuth cells need a browser identity. The box's Chrome had no Google or GitHub account signed in, so sign-in needed a password. | Fixed by hand: Chrome on the box is signed in to the test account. |
| 9a | A box OAuth tab left open in Chrome from signing in by hand was still there when the next run started. | Fixed: reset closes Chrome. The profile, and its sign-in, stays. |
| 10 | No `funnel.json`. The judge decided from screenshots alone. | Fixed: `funnel.json` from cocoonbox `Grants.List` shows approval and first token use. Which tool was called still needs box api. |
| 11 | Runs left their OAuth grant on the test account. | Fixed: the run revokes the grants its client created inside the run window. A run is blocked if the client already holds a live grant, because consent would renew it. |
| 12 | The judge proposed issues but nothing filed them. | Fixed: `file.mjs` files with `gh`, dedupes against open issues, caps new issues at three per run. |
