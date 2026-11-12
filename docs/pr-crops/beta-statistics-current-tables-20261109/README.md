# Statistics current tables — phone readability proof

## Result and reproduced defect

Key stats and Profitability retain native two-column tables while showing each current value beside its metric on narrow screens. The local class removes the inherited 420px minimum and allows header/metric text to wrap. Numeric cells retain their formatting and automatic column sizing. The multi-period Valuation table keeps its existing horizontal scrolling.

On the actual 320px Terminal Chinese/light consumer, the unchanged-source baseline rendered `200.00M` at x=380.95–434, outside the table's visible x=24–296 interval. The scrollport was 272px wide but the table required 420px at horizontal offset 0; hit testing failed. This reproduced the blank-looking Current column observed during #1397 visual inspection.

After the repair, the same text is x=232.95–286 within the same visible interval. Current-table scroll width equals client width 272px. The focused tests assert rendered text bounds and hit visibility after vertical reading scroll settles, with horizontal offset explicitly 0.

## Source and independent scope

- Operation: `beta-statistics-current-tables-20261109-c4`.
- Original workspace: `/Volumes/Mastermind 2/agent-workspaces/terminal/web/beta-statistics-current-tables-20261109-c4`.
- Base: `1377853d02fdb0295c0848d7127fdee4ca36714b`; qualified protected master `1c0bf028cf72539a4d3fcb17fa137ee474d764f9`.
- Original StatisticsPage blob: `7be2b4731f84c0becc951b93bd561a893d063a3f`.
- Inherited fin.css blob: `da4176b63a239c8a0a11be43e8c356dedda4a869`, independently matched to protected master. Its 420px Statistics rule is unchanged.
- Mastermind law pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Three current ownership pages and 17 unchanged capped heads qualified the two new CSS/spec paths. #1396 is unrelated Today work. The new import beside FinCharts and the two table-class hunks are disjoint from #1397 `e5a11c73e05809ea84c84464ce5a14f9b4f483d4`'s basis import/header/copy.
- Product changes are one local module import, two class additions and seven CSS lines. Native table scopes/row groups, current data, historical values and financial calculations remain intact; no shared stylesheet or unit-test expectations change.
- Accepted Paper Company R2 `2RK-0` in file `01M6Y2GT8S3YP4TK052PPESZEC` is presentation context. This is a source-evidenced consumer-readability repair, not a claim that the mockup specifies this exact table implementation.
- Studio Direct uses its default M2 connection. The acquire adapter's unqualified return was reconciled by original owner PID 57648 and the typed publisher: same original operation, clean base/branch on the secondary volume. No acquire replay, host selection, root change or carrier swap.

## Consumer checks

All data is synthetic: current shares 200.00M, holders 1,234,567, gross margin 48.75%, current ratio 123456.78, annual P/E 10/20/30 and current P/E 25.00. These fixtures exercise readable numbers and long labels; they are not NVDA research. No production account/data write occurs.

Actual Analysis and Terminal Statistics consumers run in English and Chinese at desktop 1440×900, tablet 820×1180 and phone 320×568. Beta uses English/dark and Chinese/light; ordinary-shell cases preserve the existing route themes.

The checks verify actual numeric text rectangles and hit visibility at horizontal offset 0, two native column headers, larger counts/percentages/ratios, annual/interim switching with current values preserved, unchanged fundamentals request counts and no document horizontal overflow. Phone checks separately scroll the historical Valuation table to its Current P/E value and verify that period columns and annual values remain available.

| Run | Observed outcome |
| --- | --- |
| Baseline PID 76681 | Expected failure on `200.00M` visibility; exact geometry above. |
| Initial complete beta PID 89353 | 12/12 passed, 140.57 seconds. One initial capture preceded vertical-scroll settling; every final assertion passed. |
| Final beta phone captures |4/4 passed, PID 4843, 71.64 seconds; final capture timing and both phone languages. |
| Final ordinary shell | 12/12 passed, PID 42941, 117.17 seconds; observed retry after the reconciled startup-only failure described below. |
| TypeScript PID 89548 |Exit 0, 135.81 seconds, final product code. |
| Scoped ESLint |Final PID 5035 exited 0, with only the pre-existing unused fmtNum/quote warnings. |
| Final scope, whitespace and server state |PID 60020 exited 0; only the intended component/CSS/spec/proof paths changed and port 3187 has no listener. |

The first ordinary-shell invocation (PID 10399) timed out in the existing 120-second web-server readiness check before any tests began. Reads of the original operation established no listener, no lock holder, and its recorded server PID 10963 no longer running. The 74-byte development log provided no cause. One observed retry enabled only `DEBUG=pw:webserver`, reached HTTP 200 after about 10 seconds and passed all 12 cases. Source, test timeouts, compiler, host binding and release controls were unchanged, and no cache reset was performed. The first startup failure's cause remains unproven.

The capture-only follow-up waits for successful text-range/hit checks before recording images and also captures English phones. It changes no product code or assertion meaning. Final phone artifacts, rather than the early unsettled Analysis capture, are committed here. Principal diff self-check and bounded read-only reasoning found no concrete remaining issue.

Reproduce from `terminal/`, one original workspace server at a time:

```sh
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3187 TERMINAL_VISUAL_EVIDENCE_OPERATION=beta-statistics-current-tables-20261109-c4 npx playwright test e2e/statistics-current-tables.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line
MMX_SHARED_SHELL=0 TERMINAL_E2E_PORT=3187 TERMINAL_VISUAL_EVIDENCE_OPERATION=beta-statistics-current-tables-20261109-c4 npx playwright test e2e/statistics-current-tables.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line
```

## Acceptance boundary

Captures are unedited actual browser images. Vertical scrolling brings the target row into a reading position; each current-table assertion explicitly resets horizontal scroll to zero. Historical table checks deliberately use its existing horizontal scroll.

Required CI, native merge queue and the incumbent beta release owner govern subsequent integration/deployment. This proof does not claim production deployment or live acceptance.

Committed captures: `before-terminal-zh-key-stats.png`, `beta-terminal-en-key-stats.png`, `beta-terminal-zh-key-stats.png`, `beta-terminal-zh-profitability.png`, `beta-analysis-zh-key-stats.png`, `beta-analysis-en-profitability.png`, and `ordinary-terminal-zh-key-stats.png`.
