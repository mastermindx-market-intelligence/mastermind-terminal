# Terminal chart footer clock isolation — 2026-09-21

Mission: improve chart responsiveness and reduce unnecessary work without reducing chart quality, altering market data, changing indicator math or introducing another store/timer service.

Authority: current Chairman instruction to continue the chart upgrade. Protected procedure: `Mastermind@05450845911bc4e67afd16555f25daee6d77388b`, compatible skillpack 1.0.1, INDEX / COLD_START / ACTIVE_EXECUTION / WEB_CEO_DELEGATION / RECONCILE_STATE / CLOSEOUT. Source base: `mastermind-terminal@749576c537284df43772d3cfd3fdd75ad7194a2d`.

Operation and branch: `claude/terminal-chart-clock-isolation-20260921`. Isolated canonical-repository worktree on the same authorized Mac Studio; Remote Desktop Commander native carrier. Direct rationale: `LOWER_TOTAL_OVERHEAD`; one small component-boundary correction with discriminating tests. No worker, watcher, source replacement or deployment started.

## Measured defect and repair

The real `ChartFrameBar` component owns the ticking wall-clock state alongside every range button, date picker, chart-mode setting and gear menu. In the RED test, advancing 60 one-second ticks causes **60 additional footer renders**. Its interval also keeps running when the document is hidden.

`ChartClock` now owns the same single interval and the original clock markup. Parent controls are not re-rendered by ticks. The interval stops while the document is hidden and restarts with an immediate current-time snapshot when visibility returns. Cleanup removes the interval and visibility listener, including React StrictMode effect replay. No global clock store, new dependency, CSS change, chart redraw loop or polling owner was introduced.

SSR remains free of server-local timestamps; the client clock initializes after hydration. Time and UTC offset derive from the same Date instance. This is the footer wall clock, not a bar-close countdown, quote timestamp or market-session clock.

## Validation

The actual parent-component RED/GREEN test changes from 4 failures / 1 pass to **5/5 passed**. It proves **60 → 0 additional footer renders** across 60 ticks, continued displayed-time updates, zero timer while hidden, immediate visibility catch-up, one interval after repeated events, SSR parity and cleanup. These are deterministic component-test measurements, not a claim about FPS or whole-page load time.

TypeScript and the new component/test lint pass. Browser and whole-suite qualification are still pending at this checkpoint. Settings PR #701 is separate: no overlapping changed source file and no duplicate chart-settings rewrite.

Current capability: `BUILT_NOT_PROVEN`. Parent mission complete: false. Next: complete real Terminal browser smoke and regression checks, preserve the immutable candidate in a separate PR, then consume CI and the existing git-gated release chain. Do not redo the settings redesign, replace the renderer or infer production speedup from this render-count test.
