# Revenue history basis controls — 2026-11-09

## User-visible result

Annual and interim Revenue history buttons expose the basis actually shown in the chart and table. The controls have 44px minimum targets, visible keyboard focus, a localized group name, and phone focus clearance above the existing bottom navigation. Native disabled behavior follows the existing availability resolver, including the incumbent semiannual fallback.

Before the change, the actual Terminal phone consumer rendered a 21px-high Annual button, no group role, and no pressed states. The baseline browser check failed on that source. The repair changes RevenuePage markup and a local CSS module; it does not change data selection, financial math, cadence labels, fetch ownership, chart rendering, or shared-shell/global styles.

## Source and design qualification

- Workspace operation: `beta-revenue-basis-controls-20261109-c4`.
- Original local base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Qualified protected master: `1c0bf028cf72539a4d3fcb17fa137ee474d764f9`.
- Original RevenuePage blob: `323feb05503c74de304c7085d22a3612763f3dec`.
- Original finStatementMath test blob: `bcf5748b3123a38595080b4fd64ff23caab25fa5`.
- Mastermind law pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Accepted Paper file `01M6Y2GT8S3YP4TK052PPESZEC`, Company R2 `2RK-0`, provides presentation context. It does not specify these detailed Revenue control states. This is a source-evidenced interaction/accessibility repair, not a claim of exact new Paper control specifications.
- Three current open-PR ownership pages and capped-head qualification found no competing Revenue leaf change. The two existing Revenue test assertions are disjoint from #738's appended Earnings currency case and #654's source-owner reference edits.
- The newly merged #1377 MiniTable changes add controls only for hierarchical rows or more than six periods. Neither is mounted by these one-row, two/three-period fixtures. No shared MiniTable code was recreated.
- Studio Direct uses its existing default M2 connection; no host selector was called.

## Browser proof

The local fixtures contain synthetic USD revenue, not production financial research: Annual FY2023/FY2024/FY2025 = 100M/200M/300M; Quarterly Q1/Q2 2026 = 25M/40M. The interim fixture declares `flow_basis: "discrete_period"`. Other local API requests are intercepted with a fixture-specific 503 response. No live account or data write is performed.

The real Analysis Revenue route and the incumbent Terminal Revenue pane are exercised in English and Chinese at desktop 1440×900, tablet 820×1180, and phone 320×568. Beta runs cover dark English and light Chinese; ordinary-shell runs also cover the existing dark Analysis and light Terminal Chinese presentations.

Assertions cover localized group naming, resolved pressed states, 44px geometry, focus visibility and retention, native keyboard Space/Enter, phone tapping, chart bars changing 3→2→3, matching table periods/values, unchanged fund request count, no document horizontal overflow, and actual native-focus hit reachability above phone navigation. The test does not manually scroll the target into view.

| Verification | Observed outcome |
| --- | --- |
| Unchanged-source baseline, PID 37181 | Expected failure: 21px height and absent group/pressed semantics on Terminal Chinese phone. |
| Beta main consumer matrix, PID 50400 | All 12 main cases passed. The same initial run had three fallback fixture-isolation failures. |
| Fallback diagnosis, PID 61913 | Exactly one fund response was consumed; the second payload in the same context reused the first annual-only snapshot. Production caching was not changed. |
| Final isolated beta fallbacks, PID 70245 | All 6 cases passed: annual-only and quarterly-only each use a fresh browser context at all three widths. Each asserts an actual fund read, selected/enabled basis, unavailable/disabled basis, and matching chart/table. |
| Final ordinary-shell complete matrix, PID 73443 | All 18 cases passed, exit 0, 92.18 seconds. Original process reconciled from its retained start receipt after output truncation; no duplicate run. |

Beta acceptance is 12 main cases plus 6 isolated fallback cases across focused runs, not a claimed single all-green 18-case invocation. Product code was unchanged between these accepted runs.

Reproduction from `terminal/`:

```sh
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3185 npx playwright test e2e/revenue-basis-controls.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line
MMX_SHARED_SHELL=0 TERMINAL_E2E_PORT=3185 npx playwright test e2e/revenue-basis-controls.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line
```

## Incumbent checks and self-review

- `finStatements` and `finStatementMath`: **89/89 passed**, PID 70368. The first run correctly detected two stale exact-markup expectations in one semiannual fallback test. Only those two Revenue assertions were strengthened with `type="button"` and resolved `aria-pressed`; Statements assertions and all financial expectations remain intact.
- TypeScript: PID 53557, exit 0 on final product code. Later edits were confined to fixture isolation and the two expected-markup strings.
- Scoped ESLint: PID 53265, exit 0; final Revenue component, browser spec, and incumbent test lint PID 87986, exit 0. Whitespace validation PID 87848, exit 0, with only the intended component/CSS/spec/assertion/proof files changed and no listener left on port 3185.
- Principal diff review and a bounded read-only reasoning review found no remaining concrete issue. The reasoning reviewer performed no edits, tests, builds, publication, or approval.
- No production deployment or live Revenue acceptance is claimed here. Required CI, merge queue, and the incumbent beta release owner remain responsible for later integration and deployment.

## Captures

These are unedited actual browser captures. Final quarterly captures were taken after the selected control passed geometry and hit testing. Native focus may scroll part of the chart above the viewport; the table remains reachable in the existing page scroll.

- `before-terminal-zh-phone.png`: unchanged-source phone baseline.
- `beta-analysis-en-desktop.png`: beta dark Analysis, quarterly selection.
- `beta-terminal-en-desktop.png`: beta dark Terminal, quarterly selection.
- `beta-analysis-zh-phone.png`: beta light Analysis, quarterly selection and table.
- `beta-terminal-zh-phone.png`: beta light Terminal, quarterly chart and focused control.
- `ordinary-terminal-zh-phone.png`: ordinary shell, final complete passing run.
