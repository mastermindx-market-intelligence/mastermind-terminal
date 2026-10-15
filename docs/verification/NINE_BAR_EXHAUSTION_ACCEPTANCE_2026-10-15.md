# Nine-Bar Exhaustion — Local Acceptance and Release Frontier

**Date:** 2026-10-15  
**Procedure pin:** `Mastermind@a53062ff18df71869a1363d35a99347f06d9a3fb`  
**Protected base:** `mastermind-terminal@f55b317adafed6409e538eb0ffd5d0447855bed2`  
**Carrier:** `sol/nine-bar-exhaustion-20261015`  
**Accepted code/source head:** `bbbb0f8526c54f59e2ab0b980495f31336f18169`

## Implemented product path

Terminal users can discover **Nine-Bar Exhaustion** in the existing Trend study catalog, enable it on the native chart, choose direct or price-flip start semantics, single or repeat cycles, retro-6/progressive/completed display, label density, history depth, marker style, and saved-layout persistence. Rising counts render above bars; falling counts render below; completed nines are visually distinct and inspectable. The same kernel drives chart points and confirmed completion events.

The algorithm is `nine-bar-v1.0.0`: `close[t] > close[t-4]` advances a rising streak, `close[t] < close[t-4]` advances a falling streak, equality/missing comparisons interrupt, and the first confirmed completion is the ninth consecutive qualifying relation. A live unfinished ninth bar may be shown as forming but cannot emit a confirmed event.

## Supported and deliberately unsupported scope

The kernel is timeframe-agnostic over adequate chronological chart bars. It is usable on Terminal-supported chart intervals where the existing feed supplies enough history; one-minute mode means four observed bars back, not four wall-clock minutes. Completed rising/falling alerts reuse the existing freshness, confirmation, watermark, entitlement, dry-run, outbox, and delivery path. The current sidecar coverage remains daily-source oriented; all-market intraday scanning, provisional 7/8 delivery, DeMARK Countdown/13, and automated trade instructions are not claimed.

## Local verification

- Production build: exit 0; one existing Turbopack NFT-trace warning remains in the unrelated `flowSource.ts` route.
- Focused acceptance: 188/188 tests passed.
- Full Terminal unit suite: 692/692 files passed; 11,528 tests passed; 4 todo; zero failures.
- TypeScript: exit 0.
- Feature-owned ESLint: 0 errors and 0 warnings. The repository-wide lint command still reports protected-master baseline debt outside this slice.
- Nine-bar browser matrix: 6/6 zero-retry journeys across desktop/tablet/mobile, English/Chinese, and Western/East-Asian directional colors; 18 substantive crops retained.
- Existing chart-context compatibility: 30/30 zero-retry cases across desktop/tablet/mobile.
- Chart-chrome packet: 4/4 fresh captures.
- Options-axis packet: 5/5 fresh captures with exact line prices, six visible badges, and no collision/browser errors.

## Research decision

The deterministic receipt covers 39,919 admitted bars from 34 US/crypto series, 1,078 primary nines, 103 repeat-cycle nines, 20,475 baseline candidates, and 229 matched primary events. The 23-pair holdout across 13 symbols does not demonstrate a stable positive reversal advantage. The feature therefore remains descriptive: a completed nine is possible exhaustion context, not a probability, Buy/Sell signal, or verified edge.

## Release frontier

Local implementation and acceptance do not prove release. The remaining ordered gates are:

1. Independent code review and repair of any Critical/Important findings.
2. Push and non-draft PR from the current-master carrier.
3. Exact-head required CI and protected merge.
4. Deployment identity verification.
5. Cache-busted live application verification of discover → enable → configure → inspect → timeframe/replay → saved return.

PR, CI, merge, deployment, and live-app fields remain intentionally unset until independently observed.
