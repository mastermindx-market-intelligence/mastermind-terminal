# Rotation monitor · R1 implementation

**Candidate in the existing RS × 30m Pivot Study. Local consumer proof is complete; independent review, hosted checks, production release, and live-source latency qualification are still required.**

This is the first implementation slice of [Macro proposal #10673](https://github.com/mastermindx-market-intelligence/macro/pull/10673), under the existing **WS:LIVE-ENTRY-RADAR** and **WS:LEADERSHIP-ROTATION-INTELLIGENCE** homes. The [original specification](https://github.com/mastermindx-market-intelligence/macro/blob/f7c9e2ae348e0fffdeee8296178b72843c41cc92/research/live_entry_radar/rs_pullback_launch/leader_pivot_2026-10-08/ROTATION_PIVOT_EXTENSION_2026-11-03.md) remains the broader research and delivery plan.

## User path

Open **Discover → RS · 30m Pivot → Open rotation monitor** (`/discover?tab=rs-pivot`). The monitor displays eleven US sector ETF proxies against SPY:

- Completed **5-minute** and **30-minute** relative returns, using one common SPY endpoint.
- Relative and absolute change **since the previous close**, displayed separately from the interval returns.
- Source observation time and age, explicit availability states, and the actual coverage denominator.

Selecting an ETF moves its symbol and SPY into the existing study controls, clears the previous study result, scrolls the ticker control into view, and focuses it. The user can then run the incumbent study. Quote updates do not run a backtest or manufacture a new study result.

The monitor starts only when a signed-in user opens it. Source details are available in English and Chinese. Sector identity stays visible while the comparison table scrolls horizontally on smaller screens.

## Measurement contract

| Area | Implemented rule | Meaning and limit |
| --- | --- | --- |
| Population | XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB, XLRE, XLK, XLU; benchmark SPY | ETF proxy measurements. Coverage is always out of eleven; this is not constituent breadth or fund flow. |
| Quote owner | Existing `/api/quote?view=regular&syms=...`, Quote Hub, `sectorRegularSession`, and `sectorRegularReading` | Existing authentication, upstream ownership, and session calendar remain the input contract. |
| Quote event time | Qualified `asOfMs`; the incumbent AM sources can use their event `ts` | UTC milliseconds. A snapshot refresh `ts` and HTTP receipt never establish a price event time. |
| Current quote | Incumbent source basis plus event age no greater than 15 seconds | Operational display parameter, not an empirically qualified latency service level. |
| Relative quote | Same admitted session, coherent price/reference pairs, and either matching timed freshness classes or official session closes | Maximum cross-symbol skew is 15 seconds for recent prints and 60 seconds for delayed prints. Untimed observations keep only their permitted absolute reading. |
| Prior-close reference | Owner-qualified regular price and previous close; percent coherence tolerance 0.01 percentage point | Corporate-action and historical availability certification are not established here. |
| Bar owner | Existing `/api/intraday?sym=...&tf=5m&ext=0&date=...` | Only the current or most recently completed session is requested. Exact source schema, symbol, timeframe, session and timestamp basis are required. |
| Bar clock | `market_local_display_epoch` | ET display-epoch seconds. Used for nominal completed-bar geometry, never subtracted directly from a UTC event clock. |
| Common interval | Latest completed SPY bar endpoint applies to every sector | A missing sector endpoint cannot move that row back to an easier interval. |
| 5m and 30m | Two adjacent closes for 5m; seven closes with all intermediate slots for 30m | Today's partial session is usable. Missing slots, overnight bridges, malformed current bars and duplicate/out-of-order bars do not qualify. Forming and future prices do not enter the calculation. |
| Bar age | During RTH, nominal endpoint age must be at most 20 minutes; after close the endpoint must equal the official session end | Supports clearly dated delayed context. It does not certify the underlying print time, completeness or delivery latency. |
| Relative return | `100 × ((sector_end / sector_start) / (SPY_end / SPY_start) − 1)` | Exact relative wealth, with finite positive ratios; missing input is never zero. |
| Output authority | `terminal.rotation_monitor.v1`, `descriptive_only`; windows use `descriptive_bar_geometry` | No forecasts, probability, fused regime score, position sizing, execution or prospective event claims. |

Unknown source families, invalid/future clocks, missing benchmarks, incompatible freshness, source skew, incomplete intervals, stale caches and expired bar endpoints have explicit unavailable states. A missing benchmark preserves an otherwise admitted absolute quote.

## Read lifecycle

The existing endpoint consumers have one active request per lane. Quotes refresh five seconds **after a completed read** while the regular session is open, and sixty seconds after a completed-session read. Current-session history refreshes sixty seconds after completion, with at most three requests in flight for the twelve instruments. These are consumer cadences; actual price delay is visible separately.

Quote and history requests have independent deadlines. Slow history cannot occupy the quote lane. Hiding the view, closing it, changing account, or unmounting aborts its work. A visibility return starts with empty inputs. HTTP 401/403 clears both lanes and stops that read generation. Failed, truncated or timed-out responses cannot perpetuate previous values as a new successful read. Retry-After is respected within the existing bounded view retry.

No provider connection, API route, collector, durable observation store, background task, strategy registry or regime authority is added. Macro's existing basket intraday comparison remains its separate owner-measured theme/basket capability.

## Source changes

- `terminal/lib/rotationMonitor.ts`: pure source qualification and common-endpoint interval measurement.
- `terminal/components/workspaces/useRotationMonitorInputs.ts`: visible authenticated read ownership.
- `terminal/components/workspaces/RSPivotRotationMonitor.tsx` and its CSS: bilingual consumer and source evidence.
- `terminal/components/workspaces/RSPivotStudy.tsx`: monitor integration and symbol/focus transfer. The existing sign-in anchor uses Next Link to satisfy its scoped lint rule.
- The two new unit suites and `terminal/e2e/rotation-monitor.spec.ts`: discriminating failure and consumer tests.

Source base: **2ded360882b9c721e690907ff363b553781fb920**. Managed operation: **rotation-regime-r1-20261103-c1**, branch **sol/web-rotation-regime-r1-20261103-c1**. Protected source-law pin: Mastermind **9f65957e29eba92245d78609f032aaea523b7cb4**. Existing open Sector Central and quote-polling carriers were inspected; this candidate does not edit their paths.

## Validation

Final source validation:

| Check | Result |
| --- | --- |
| New measurement tests | 38 passed |
| New read-lifecycle tests | 9 passed |
| Existing RS study, chart, hydration, account and regular-reading regressions | 48 passed |
| Combined targeted unit/component run | **95 passed in 8 files** |
| Responsive browser journeys | **24 passed**: 12 monitor journeys and 12 incumbent study journeys |
| Browser sizes | Desktop 1440×900, tablet 820×1180, phone 390×844 |
| Languages | English and Chinese |
| TypeScript | `npx tsc --noEmit --incremental false`, exit 0 |
| Scoped ESLint | Seven changed TypeScript/test paths, exit 0 |
| Whitespace | `git diff --check`, exit 0 |

The final chained process was PID **73203**, exit **0**. Since checks were chained with `&&`, later checks ran only after earlier checks succeeded. `local_validation.json` binds the observed commands and source hashes. This is an attended local evidence record, not independent approval.

Reproduce from `terminal/`:

```bash
TERMINAL_VISUAL_EVIDENCE_OPERATION=rotation-regime-r1-20261103-c1 TERMINAL_E2E_PORT=62913 npm run test:e2e:responsive -- e2e/rotation-monitor.spec.ts e2e/rs-pivot-study.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
npx tsc --noEmit --incremental false
npx eslint lib/rotationMonitor.ts lib/__tests__/rotationMonitor.test.ts lib/__tests__/rotationMonitorInputs.test.tsx components/workspaces/useRotationMonitorInputs.ts components/workspaces/RSPivotRotationMonitor.tsx components/workspaces/RSPivotStudy.tsx e2e/rotation-monitor.spec.ts
npm test -- lib/__tests__/rotationMonitor.test.ts lib/__tests__/rotationMonitorInputs.test.tsx lib/__tests__/rsPivotStudy.test.ts lib/__tests__/rsPivotChartReplay.test.tsx lib/__tests__/rsPivotShellIdentity.test.tsx lib/__tests__/rsPivotHydration.test.tsx lib/__tests__/rsPivotRequest.test.tsx lib/__tests__/sectorRegularReading.test.ts
```

Use an available operation-bound port on another machine; never reuse an unrelated running server. The existing development fixtures supply identity and synthetic market inputs. The deliberate missing-client-chunk tests emit expected ChunkLoadError logs and pass by proving inert controls.

### Screenshots

**All screenshots use synthetic fixtures dated 2026-10-27. They are interface evidence, not market observations or backtest results.**

[Desktop, English](desktop-en.png) · [Tablet, English](tablet-en.png) · [Phone study handoff, English](mobile-en.png)  
[Desktop source details, Chinese](desktop-zh.png) · [Tablet source details, Chinese](tablet-zh.png) · [Phone source details, Chinese](mobile-zh.png)

## Execution and review provenance

The original paid Fabric source-audit and engine children both reached a terminal provider error and returned no source or review. Their results reported EAI_AGAIN, indeterminate capacity preflight and an unrecognized-model diagnostic; the exact cause beyond those observations is unproven. Both retain `retry_allowed=false`.

- `rotation-r1-source-audit-20261103-c1`: response SHA256 `3ddb14eb104f3f4afd547000ec19ad4ef42b91dc9e99c29c6593b4ff9d020b94`.
- `rotation-r1-engine-20261103-c1`: response SHA256 `fc9bc21f552adf238e8610eaf1f2c0d3915308606f9dd332ed7ffac21ac85a57`.

Root and immediate parent for both: `rotation-regime-r1-20261103-c1`. They were reconciled on their original runs, not accepted or relaunched. The current principal completed source work directly in the original managed workspace under the **NO_ELIGIBLE_PRE_EFFECT_WORKER** exception. The bounded native adviser provided principal design judgment only, then stopped. None of that substitutes for independent code review.

## Remaining release and research gates

1. Review this exact candidate through the existing non-author GitHub review path; resolve material findings and require current-head hosted checks.
2. Use the incumbent protected release/deployment chain after its gates qualify. Then prove the signed-in production journey, access behavior, and actual source age/coverage during a regular session.
3. Measure Quote Hub and intraday end-to-end source behavior before accepting a live latency target. Five-second client polling is not five-second source freshness.
4. Add prospective causal pivot watches through the existing Radar/TOI owners and execute the original B0/P1 protocol using admitted data. This candidate ran no market backtest and establishes no predictive edge.
5. Regime and duration adaptation remain conditional on the existing regime/Temporal Grain owners and the saved research gates. The prohibited rotation×cycle entry construction, fused allocation score and outcome-selected timeframes remain excluded.

**R1 consumer implementation: locally proven candidate. Production acceptance: unproven. Live latency qualification: unproven. Predictive qualification: unproven.**
