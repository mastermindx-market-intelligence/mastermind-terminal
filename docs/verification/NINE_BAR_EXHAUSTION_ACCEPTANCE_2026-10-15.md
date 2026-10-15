# Nine-Bar Exhaustion — Integrated Acceptance and Release Frontier

**Updated:** 2026-10-15
**Procedure pin:** `Mastermind@022e5f46a0095c911e00450c7046ea90ca9949fa`
**Protected Terminal base last reconciled:** `e12d93687e6257fa6c26cac06ab2f7b9715fee8c`
**Carrier:** `sol/nine-bar-exhaustion-20261015`
**Post-review source-repair commit:** `ee9667be52a2bb61416b00211592d15225a6a9c0`
**Research/browser-evidence commit:** `702b985fa04aa61528c5cbbbecce4663b6c95d5c`

This ledger is the recoverable release frontier for the Chairman-commissioned Nine-Bar Exhaustion slice. It records what is proven, what is deliberately withheld, and the next safe release action. Publication, CI, merge, deployment, and live acceptance remain separate states.

## 1. Implemented product path

Terminal has a first-class **Nine-Bar Exhaustion** / **九转衰竭** module inside the existing Trend suite. The user path is the existing Indicator Library → enable → module settings → chart labels/markers → tooltip → timeframe change → Replay → persisted return.

The implementation reuses Terminal's existing owners:

- pure kernel: `terminal/lib/nineBarExhaustion.ts`;
- module metadata/adapter: `terminal/lib/suites/trend/nineBarExhaustion.meta.ts` and `nineBarExhaustion.ts`;
- existing catalog, settings, persistence, lazy runtime, replay, entitlement, indicator-canvas rendering, suite-event alerts, dry-run, outbox, and delivery;
- no second indicator framework, store, scanner, alert service, lifecycle, or control plane.

## 2. Algorithm actually implemented

Algorithm version: `nine-bar-v1.0.0`.

- Rising: `close[t] > close[t-4]`.
- Falling: `close[t] < close[t-4]`.
- Equality or a missing/non-finite comparison interrupts the sequence.
- First comparison is the fifth available chart bar; first possible completion is the thirteenth.
- Default start mode is direct; optional price-flip mode requires a prior opposite valid relation.
- Default sustained-trend behavior emits the first nine once; optional repeat mode segments uninterrupted runs into 9, 18, 27, … cycles.
- Default display is retroactive 1–6 reveal at count 6; progressive and completed-only modes are available.
- One-minute semantics are four **available chart bars** back, not four wall-clock minutes.
- A developing ninth bar may render as forming but cannot emit a confirmed event.

The implementation is independently derived and does not claim licensed DeMARK Sequential 9–13 parity.

## 3. Post-review repair record

A fresh read-only whole-branch review of `origin/master...593a6dc5` returned **BLOCK: 5 Important, 3 Minor, 0 Critical**. Durable review:
`/Volumes/Mastermind/evidence/nine-bar-exhaustion-20261015/postfix-review-20261015/review-final.txt`.

The single bounded repair wave at `ee9667be…` addressed all findings:

1. **Daily alert finality:** dry-run and firing sidecar now pass one explicit evaluation clock through the shared suite adapter; same-day US daily nines remain forming until the regular/early close and crypto daily nines until the UTC display day rolls.
2. **HK closing auction:** the final admitted HK candle remains provisional through 16:10 because Tencent can fold closing-auction prints into the final candle after 16:00.
3. **CN higher-timeframe anchoring:** non-native CN resampling is session-aware at 09:30 and 13:00 rather than absolute 08:00/12:00 buckets.
4. **OHLCV integrity:** finite-but-impossible daily rows are unevaluable: negative volume, inverted high/low, or open/close outside the range are rejected before alert computation.
5. **Research matching:** matched control availability is now evaluated separately for the requested horizon instead of silently requiring 20-bar availability for 1/3/5/10-bar estimates.
6. **Tooltip time semantics:** intraday source timestamps are labeled chart/display time rather than UTC and earliest observable availability is shown separately.
7. **Delayed-entry research:** one-bar delayed-entry sensitivity is now retained and reported separately from the preregistered next-open result.
8. **Evidence/ledger identity:** current research and browser artifacts are content-bound below.

RED evidence for the repair wave is retained in:
- `repair-red.log` — ten deliberately failing regressions before production changes;
- `sidecar-clock-falsifier-red.log` — the sidecar clock regression turns red when the clock argument is removed.

Post-fix focused gate: **88/88 tests passed**, plus `tsc --noEmit` exit 0.

## 4. Alert capability and freshness

Released alert event types remain narrowly scoped to confirmed daily completions:

- `nine_rising` — rising nine completed, bearish exhaustion context;
- `nine_falling` — falling nine completed, bullish exhaustion context.

The chart and alert paths use the same canonical kernel and stable event identity. Existing confirmation indexing, creation-floor, trailing freshness, one-shot watermark, entitlement, persistence, dry-run, outbox, and delivery contracts remain authoritative.

Counts 7/8 are chart-only provisional states. Full-market intraday scanning is not implemented or claimed. Malformed daily source data is unevaluable rather than coerced into a signal.

## 5. Market/data support boundaries

The kernel is timeframe-agnostic where Terminal supplies at least 13 valid chronological chart bars. Formula support includes 1m/5m/15m/30m/1h/4h/daily/higher intervals, but source depth and freshness remain provider properties.

Current direct Polygon/Massive chart-request windows are bounded by result limits: 10 calendar days for 1m/5m, 25 days for 10m–30m, 60 days for larger US intraday intervals, and 30 days for larger crypto intraday intervals. These are request windows, not retained-history guarantees.

US regular-session finality uses the repository exchange-session clock including represented early closes. CN/HK lunch/session segmentation is implemented, but broad holiday-perfect CN/HK freshness is not claimed. HK finality conservatively includes the Closing Auction Session through 16:10. Crypto is treated as 24-hour.

## 6. Quantitative research — current evidence

Machine receipt: `docs/research/NINE_BAR_RESEARCH_RESULTS_2026-10-13.json`
Receipt SHA-256: `e22c78127069f910aaf47327af76a449bb7ec13fe27d1a04c31f0a4f3ecbfc46`
Research source head: `ee9667be52a2bb61416b00211592d15225a6a9c0`.

Coverage:

- 39,919 admitted bars;
- 34 US/crypto series;
- 37 chronological segments, 3 disclosed discontinuities;
- 8,478 endpoint observations;
- 1,078 primary nines, 103 repeat-cycle nines;
- 20,475 baseline candidates;
- matched primary pairs by requested horizon: **1b 293, 3b 290, 5b 289, 10b 281, 20b 273**.

Matched all-sample return difference in the hypothesized reversal direction:

- 5 bars: **-1.4708%**, 95% cluster-bootstrap CI **[-2.4928%, -0.5830%]**;
- 10 bars: **-1.4217%**, CI **[-2.6840%, -0.2684%]**.

Holdout:

- 5 bars: 24 pairs / 18 symbols, **-1.5273%**, CI **[-4.2492%, +0.9657%]**;
- 10 bars: 21 pairs / 16 symbols, **+0.1777%**, CI **[-2.2108%, +3.0697%]**.

One-bar delayed-entry sensitivity is also not supportive of a promotional reversal claim:

- all sample: 5b **-0.0907%** (N=1059), 10b **-0.2224%** (N=1047);
- holdout: 5b **-0.2652%** (N=214), 10b **-1.4223%** (N=207).

The evidence therefore supports shipping a mathematically correct **descriptive exhaustion indicator**, not a reversal probability, calibrated rank, or Buy/Sell instruction. The retained snapshot is not a complete point-in-time universe and does not justify causal performance claims.

## 7. Browser and evidence identities

### Nine-Bar user journey

Fresh post-review Playwright matrix: **6/6 passed, zero retries/skips/flakes** across desktop/tablet/mobile × EN/ZH × Western/East-Asian directional-color modes. It covers discover → enable → settings → completed-count tooltip → Replay → timeframe change → saved return and writes 18 substantive lifecycle screenshots.

Packet: `terminal/docs/pr-crops/nine-bar-exhaustion/`
Captured implementation source: `ee9667be52a2bb61416b00211592d15225a6a9c0`
Browser report SHA-256: `ae40e2db28f8da1bb5646b6d01cfb42323c0eafcb92b9d0df9be0c7d53b30bc4`.

### Existing chart compatibility

The source-bound compatibility packets that did not change remain valid at the repaired source:
- Visual Intelligence report SHA-256: `590023910ad101ae255fb26a361fd74270424154ddd79a7473fe870775504c9a`;
- Options-axis manifest SHA-256: `9992bc1fea7638dc00c0f473087af6a73a9128f2df691585cc575c0cc44080a8`.

Post-repair evidence readers: **5 files / 18 tests passed**.

These browser packets use deterministic local fixtures. They prove product behavior, geometry, persistence, language, and lifecycle compatibility; they are not production-deployment or live-provider freshness evidence.

## 8. Local qualification frontier

Already proven after the repair:
- review-blocker focused gate: **88/88 passed**;
- TypeScript: `tsc --noEmit` exit 0;
- fresh Nine-Bar browser matrix: **6/6**, zero retries;
- source-bound evidence readers: **18/18 passed**.

Still required before publication:
1. canonical full Terminal unit suite at the current integrated head;
2. production build;
3. refresh this section with exact counts/results and seal the acceptance-ledger guard;
4. fetch/reconcile protected `master` if it moved;
5. push branch and create the non-draft PR;
6. inspect exact-head required CI, then merge-on-green if eligible;
7. verify protected merge/current-master ancestry;
8. verify deployment identity separately;
9. exercise the cache-busted live product journey.

## 9. Release state

As of this ledger update:
- local implementation: complete;
- independent review: completed, blockers repaired with RED→GREEN evidence;
- research/browser evidence: refreshed and content-bound;
- remote feature branch: not yet published;
- PR: not yet created;
- exact-head CI: not yet observed;
- merge: not yet observed;
- deployment: not yet observed;
- live application acceptance: not yet observed.

No later state should be inferred from an earlier one.
