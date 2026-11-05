# Tiingo 24H consumer verification

These are local browser fixtures from the consumer repair on base `e3ca39a82d9713061e5e27ac0cd3ac1d249af127`. They prove chart loading and admission behavior; they do not prove that the production BOATS producers are running or measure Tiingo-to-screen latency.

The first-paint fixture deliberately returns no BOATS observation or overnight bars. The initial daytime request is pending, then returns 90 daytime candles with a final close of 201. The existing five-second refresh adopts that response through the normal chart initializer, without an extra intraday request or a chart-command context change. Header and watchlist values belong to the independent development fixtures; they are not the intraday fixture price.

| Viewport | Dimensions | Pending | Completed | Readback |
|---|---|---|---|---|
| Desktop | 1440 × 900 | [Image](desktop-daytime-pending.png) | [Image](desktop-daytime-completed.png) | [JSON](desktop-daytime-completion.json) |
| Tablet | 820 × 1180 | [Image](tablet-daytime-pending.png) | [Image](tablet-daytime-completed.png) | [JSON](tablet-daytime-completion.json) |
| Mobile | 390 × 844 | [Image](mobile-daytime-pending.png) | [Image](mobile-daytime-completed.png) | [JSON](mobile-daytime-completion.json) |

The recorded completion durations include the next poll, chart rendering, mirror publication and screenshot work. They are fixture measurements, not service-level guarantees. Each readback records two initial requests during preference hydration and one completion request.

## Executed checks

- The full overnight chart and refresh matrix passed 42 checks across desktop, tablet and mobile, including English/Chinese and dark/light fixtures. The existing light-token fixture does not claim a persisted production theme selector.
- After the first-paint trade-watermark repair, all 24 focused refresh checks passed. They cover OHLCV correction, authoritative empty replacement, viewport preservation, session/AI target retirement, cold completion, retained initial overnight history and settled empty/error status.
- After the final out-of-order quote guard, the six cold-completion and quote-only first-paint checks passed again across all three viewports. The quote-only test verifies that an expired quote's accepted trade survives two older REST responses and is reconciled by a newer REST capture.
- The out-of-order quote regression independently proves its quote is admissible before asserting that an older quote cannot replace a newer accepted trade. The case failed before the ordering comparison was added; equality remains admissible.
- Server checks cover fresh corrections and empty snapshots inside the old cache TTL, single-flight concurrency, actual fetch abort, failure recovery, authenticated cache separation, and session-scoped archive watermarks.

The production activation owner and its prior persistent-operation hold are unchanged by this consumer PR.

## Existing chart evidence gates

The first hosted unit run found three stale source-bound capture manifests and an exact-source replay extractor that did not include the new `intradayLoadVersion` dependency. The extractor now names that dependency while preserving its epoch checks, minimum protected-write count and guard-deletion falsifier.

The existing capture owners were run against the same consumer source: four ChartChrome captures (desktop/mobile, EN/ZH), all five options-axis variants, and all 30 Visual Intelligence cases across desktop/tablet/mobile with zero retries, failures, skips or flaky cases. The actual complete JSON report is retained in `../terminal-visual-intelligence/browser-report.json`. Prior manifest bindings and historical receipts were preserved. The four affected guard suites then passed all 23 tests; `git diff --check` passed. These checks supplement the earlier 205 targeted tests and overnight browser proof. They remain deterministic local evidence, separate from live Tiingo freshness and production deployment.

Parent visual inspection covered the refreshed mobile Chinese ChartChrome crop, desktop and mobile options-axis views, and desktop English/mobile Chinese Visual Intelligence views. Existing chart, studies, price badges and context remain legible at their intended viewport sizes.
