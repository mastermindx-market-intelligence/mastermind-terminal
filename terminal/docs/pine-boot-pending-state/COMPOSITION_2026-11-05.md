# Pine pending and retry composition — Terminal #973

## Source and intended behavior

Original carrier: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/973

The original head is `a942751a0fabc233a9e4bc4d768d3b19b6934a2e` on
`claude/pine-boot-pending-state`. This composition uses protected master
`50713efda7cbd06c60b6dce2f88b31cea5c005a2` and carries the feature's unique
five-commit intent, identified by compare
`70b26b0494aa91af3620f1cf7d8443565266044b...a942751a0fabc233a9e4bc4d768d3b19b6934a2e`.
The original 76-path overall stack is not the implementation baseline.
Dependencies #874 and #972 are already merged.

A script whose worker is starting must distinguish running, waiting for the
engine, and an engine failure from a script result. A failed engine startup
remains explicitly retryable on the same symbol and bars. The editor reports
checking and engine unavailability without claiming that cancelled or
unavailable diagnostics checked the script. Feature-local EN/ZH copy serves
the chart legend and editor; shared i18n remains unchanged.

## Current owners preserved

ChartPanel continues to use ChartEngine and SeriesHandle, the existing
`pineChartLayer.ts` adapter, the shared price-marker writer, price-line pool,
pane placement, epoch guard, hidden-state normalization and current render
callbacks. The adapter, host implementation and host retry semantics remain
byte-identical to master. Request identity retains source, parameters, symbol,
timeframe, bar signature and the published session anchor. Interrupted
reissues use the inputs pinned at launch.

The original pending/retry behavior is composed at the current run/cache,
miss-selection, legend and cleanup seams. Retry uses the same current adapter
and restores the visible logical range. Infrastructure failures are excluded
from the script-result cache and pinned only to the request that failed.
Existing pane grouping, keyboard-accessible names, touch arming and row keys
remain in ChartOverlays.

PineEditor retains its ID-keyed editable buffers, current mutable library,
per-ID save singleflight, expected_updated_at CAS, receipt validation, dirty
switch guard and incumbent scripts fixture. Diagnostic ownership includes
both the selected script ID and the launch generation. Selection/reset
supplies one consistent source/parameter snapshot. A same-ID library reorder
or save receipt does not reset the buffer or restart diagnostics.

## Narrow correctness repairs during composition

1. A successful cached request A must not display request B's later engine
   failure. The legend now uses the same request-key comparison as scheduling.
2. Retired run settlements and warm-compilation callbacks cannot recreate an
   AST/cache after removal or overwrite a newer result or failure. Settlement
   ownership is checked before every mutable adoption.
3. Editing or switching IDs retires the pending indicator and its owned grace
   timer. A late compilation cannot dispatch a dry-run for a retired buffer.
   A new diagnosis observes its own grace period and preserves prior truth
   while waiting.
4. Manual compile completion can clear only its own still-compiling status;
   delayed completion cannot erase saving, saved or error status.

## Existing evidence owner

The old unit job
https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/38218893141/job/114710198781
failed three current-source visual locks after ChartPanel changed. Its other
9,288 tests passed. The old Ingest failure referenced #927's open 0033 ledger
row; that row is already merged in current master. No migration was modified
or applied for this feature.

The incumbent `capture_ci_evidence.cjs` now enrolls the existing Pine producer
and the Options producer beside PL6/VI. It uses the same owned-server and
attempt-receipt implementation already published for #1048, with one Pine
legacy packet rather than that PR's unrelated four packets. It preserves
strict Ready/HTTP-200 readiness, refusal propagation, awaited cleanup and
complete prior/returned archives under the existing CI artifact owner.
Options still runs inside PL6's owned server, and failed returned output is
archived without losing the original failure. CI workflow, uploader and
evidence readers are unchanged.

Pine's exact matrix is 30 images: legend waiting, failed and retried, plus
editor checking and unavailable, at 1440/820/390 in EN/ZH. Its six layout
members remain globals.css, ChartOverlays.module.css, ChartOverlays.tsx,
PineEditor.tsx, pineChartRun.ts and pineRunLex.ts. ChartPanel behavior is
covered by the actual E2E state transitions, as in the original contract.
The producer retains its real Worker hang, 8-second boot windows, host retry,
actual plotted-series recovery, one fresh worker after Retry, unchanged NVDA
symbol, geometry and enabled Add to chart during editor unavailability.

The Pine producer is import-safe, asserts the real development-indicator DOM
instead of removing it, and issues its attempt-bound receipt only after all
30 captures and browser/server cleanup succeed. Its bounded 12-minute
allowance includes approximately 192 seconds of intentional boot waiting;
the existing total 54-minute internal deadline, 55-minute capture step and
cleanup reserve remain. No new browser, auth, scheduler or artifact owner is
introduced.

The original manifest and 30 image blobs are retained byte-for-byte as
historical evidence. They are not relabelled as captures of this composition.
Fresh current-source receipt/image validation remains required in natural CI.
Capture process success alone is `CAPTURED_AWAITING_UNIT_VALIDATION`.

## Executed local verification and limits

- 53 native Node orchestration/control tests passed against this composition.
- Seven native test bodies from `pineChartRunOwner.test.ts` passed through a
  local actual-source assertion adapter. These execute the real ChartPanel
  run/cache/legend closures with controlled host and clock ports, including
  stale completion, removed scripts, request-key failure identity and positive
  current-success/current-failure controls.
- Eight actual PineEditor callback probes passed with controlled state,
  host and clock ports: typing, equal-buffer ID change, A/B/A, same-ID render,
  stale dry-run, cancelled/current script error, host rejection and save-status
  preservation. These are not React or DOM execution.
- Four native React regressions were added to the existing ID-buffer suite;
  all its previous cases remain. The original WorkerHost, Pine E2E,
  chart-engine adapter and session-anchor suites remain in the native CI path.

The local adapters use Node 24 only to erase TypeScript in isolated callbacks;
they do not claim native Vitest, the TypeScript compiler, React, Playwright,
PostgreSQL or product acceptance. Committed native tests use the repository's
existing TypeScript dependency and remain compatible with hosted Node 20.
The necessary native current-head checks are left to the natural CI run.
No local browser capture, deployment, database, release or production
acceptance is claimed. Chairman authorization to defer unavailable local
checks does not convert required CI into a pass.

## Delivery boundary

This is an original-branch source repair, preserving the accepted journey.
The source author may record an individual merge-on-green admission after
required current-head gates genuinely pass, but performs no native
self-approval or self-merge. The publication receipt records the actual tree,
parents, branch readback, CI and subsequent disposition.
