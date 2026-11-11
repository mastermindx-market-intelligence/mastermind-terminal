# Statistics basis controls and fallback guidance — 2026-11-09

## User-visible result

The existing Annual/Interim buttons expose the basis actually selected by the availability resolver, have 44px minimum targets and visible keyboard focus, and belong to a localized Statistics basis group. Native disabled behavior and quarterly/semiannual labels remain intact.

An interim-only snapshot previously disabled Annual while telling the user to switch to Annual. The new English/Chinese explanation states that historical valuation ratios use annual fiscal periods and that annual statement history is unavailable in this snapshot. The existing switch instruction remains when Annual is available. This describes statement-set availability; it does not claim the annual ratios payload is absent.

The existing absence of quarterly historical ratio series, current key statistics, profitability values, financial-family handling and calculations are unchanged. No global CSS, shell, navigation, API, account or data-owner changes are included.

## Source, ownership and design

- Operation: `beta-statistics-basis-controls-20261109-c4`.
- Original workspace: `/Volumes/Mastermind 2/agent-workspaces/terminal/web/beta-statistics-basis-controls-20261109-c4`.
- Acquired base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Qualified protected master: `1c0bf028cf72539a4d3fcb17fa137ee474d764f9`.
- StatisticsPage source blob: `7be2b4731f84c0becc951b93bd561a893d063a3f`.
- finStatementMath source blob: `bcf5748b3123a38595080b4fd64ff23caab25fa5`.
- Mastermind law pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Three current ownership pages and 17 capped-head qualifications found no Statistics leaf or proposed-file owner. Only capped #1243 changed; its refreshed head `663983edd16fc64e86003b420e97d557982b1bf2` and merge base have identical Statistics/test blobs.
- The two Statistics test expectations at original lines 616–617 are disjoint from #1395's Revenue patch 602–609, #738's appended Earnings case, and #654's source-owner references.
- Accepted Paper Company R2 `2RK-0` in file `01M6Y2GT8S3YP4TK052PPESZEC` provides presentation context. It does not specify these detailed control semantics; this is a source-evidenced interaction and guidance repair.
- Studio Direct remained on its default M2 connection. The acquire adapter returned an unqualified result; the original workspace owner (PID 6420) and typed publisher established the original secondary-volume workspace, branch/base and clean state before editing. No acquire retry, host selection, root change or carrier swap occurred.

## Actual consumer evidence

The local synthetic fixtures use USD, three annual periods, annual P/E 10/20/30, P/S 2/3/4 and 200M current shares. Separate contexts supply annual-only and semiannual-only statement availability. These are UI fixtures, not NVDA financial research. No production financial/account write occurs.

The real Analysis Statistics route and incumbent Terminal Statistics pane are tested in English and Chinese at desktop 1440×900, tablet 820×1180 and phone 320×568. Beta tests cover dark English and light Chinese; ordinary-shell tests retain the existing dark Analysis and light Terminal Chinese presentations.

The browser assertions verify named grouping, resolved pressed states, native disabled semantics, 44px geometry, visible focus and hit reachability, Space/Enter and phone tap activation, focus retention, unchanged fund request counts, no document horizontal overflow, six annual chart bars and annual table values, zero fabricated interim ratio bars/table, and preserved current key statistics. Semiannual-only tests verify the available label/state and the removal of the impossible Annual instruction.

### Baseline and final results

- Initial harness PID 15362 identified an overly broad selector matching both the outer pane and inner component. The selector was narrowed to the component with the direct Statistics header; no product code was changed for that correction.
- Qualified unchanged-source baseline PID 19565 reproduced both defects: Terminal Chinese phone buttons were 21px high, with no group/pressed attributes; the semiannual-only Analysis snapshot disabled Annual yet instructed the user to switch to Annual.
- Final beta browser matrix: **18/18 passed, PID 25914, exit 0, 112.77 seconds**.
- Final ordinary-shell browser matrix: **18/18 passed, PID 34926, exit 0, 106.73 seconds**.
- Incumbent `finStatements`/`finStatementMath`: **89/89 passed**, PID 25767. Exactly two existing Statistics markup expectations now assert native button type and resolved pressed state; Gross margin omission and financial-family expectations remain intact.
- Scoped ESLint PID 26130 exited 0 with only the pre-existing unused `fmtNum`/`quote` warnings. TypeScript: **PID 25644, exit 0, 104.42 seconds**. Principal whitespace/diff review PID 26966 exited 0.
- Principal self-check and a bounded read-only reasoning review found no concrete remaining issue. The reasoning reviewer ran no tests and performed no edits or publication.
- **Final artifact/scope check PID 43080 exited 0; only the intended component/CSS/spec/two-assertion/proof files changed, with no listener remaining on port 3186.**

Reproduce from `terminal/`, with one original workspace server at a time:

```sh
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3186 TERMINAL_VISUAL_EVIDENCE_OPERATION=beta-statistics-basis-controls-20261109-c4 npx playwright test e2e/statistics-basis-controls.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line
MMX_SHARED_SHELL=0 TERMINAL_E2E_PORT=3186 TERMINAL_VISUAL_EVIDENCE_OPERATION=beta-statistics-basis-controls-20261109-c4 npx playwright test e2e/statistics-basis-controls.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line
```

## Captures and acceptance limits

The attached images are unedited browser captures. Final interim control captures follow native focus geometry/hit checks. The semiannual explanatory text is scrolled into view for its phone capture; target reachability is checked separately through native focus without manually scrolling the button.

Existing horizontal scrolling in the current-only tables is tracked as the next separate phone-readability phase. This proof does not claim that every table value fits simultaneously on a phone.

No production deployment or live Statistics acceptance is claimed. Required CI, merge queue and the incumbent beta release owner remain responsible for subsequent integration/deployment.

Captures: `before-terminal-zh-phone.png`, `beta-analysis-en-desktop.png`, `beta-terminal-en-desktop.png`, `beta-terminal-zh-phone.png`, `beta-analysis-zh-semiannual-phone.png`, and `ordinary-terminal-zh-phone.png`.
