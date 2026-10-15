# Nine-Bar Exhaustion — Integrated Acceptance and Release Frontier

**Date:** 2026-10-15
**Procedure pin:** `Mastermind@cbd12b6fcbedaaad8f04cbeb1ab0296e1d6d192f`
**Protected base:** `mastermind-terminal@e12d93687e6257fa6c26cac06ab2f7b9715fee8c`
**Carrier:** `sol/nine-bar-exhaustion-20261015`
**Qualified runtime/evidence head:** `6ea54a68faa50833cc15efc9fe6d6acf967f6f7e`

This ledger records the exact locally qualified product state before independent whole-branch review and publication. A later documentation-only commit may carry this ledger; it does not change the runtime or evidence bytes qualified below.

## 1. Implemented user path

A Terminal user can open the existing **Indicator Library**, search for **Nine-Bar Exhaustion** (`九转衰竭` in Chinese), enable the native Trend module, change its module-scoped settings, inspect a completed count, switch timeframes, enter and leave Replay, reload the chart, and recover the saved study state.

The feature remains inside Terminal's established chart architecture:

- canonical pure kernel: `terminal/lib/nineBarExhaustion.ts`;
- Trend metadata and adapter: `terminal/lib/suites/trend/nineBarExhaustion.meta.ts` and `nineBarExhaustion.ts`;
- registry/catalog/lazy-runtime integration under `suite:trend/nine`;
- existing `LabelPrim`, `MarkerPrim`, `TooltipDef`, `SuiteEvent`, persistence, replay, entitlement, renderer, dry-run, outbox, and delivery owners;
- no second indicator framework, scanner, alert service, store, lifecycle, or control plane.

Rising counts render above candles using the directional-down token because they describe possible upside exhaustion. Falling counts render below candles using the directional-up token because they describe possible downside exhaustion. Completed nines are visually distinct, inspectable, responsive, bilingual, and compatible with Western and East-Asian directional color preferences.

## 2. Algorithm variant actually shipped in the branch

Algorithm version: `nine-bar-v1.0.0`.

- rising relation: `close[t] > close[t-4]`;
- falling relation: `close[t] < close[t-4]`;
- equality, a non-finite/missing comparison, or an invalid chronology interrupts the active sequence;
- first comparison is the fifth available chart bar; first possible completion is the thirteenth available chart bar;
- `direct` start is the default; optional `price_flip` requires the prior valid relation to be opposite;
- `single` is the default sustained-trend policy; optional `repeat` emits only at non-overlapping 9, 18, 27, … cycles, never on every later qualifying candle;
- `retro6` is the default display policy; `progressive` and `completed` are available;
- density can show all counts, late counts, or completion only; recent-history depth is bounded;
- one-minute semantics are four observed chart bars back, not four wall-clock minutes;
- a forming ninth bar may render provisionally but cannot emit a confirmed completion event.

Finality is derived from the actual chart timeframe, market-local display clock, session segment, admitted daily source rows, and existing session-anchor/grouping rules. It is not inferred from whether a quote happened to arrive. Replay is closed by definition. Unknown timing fails closed: the tail may remain forming, but no confirmed completion event is manufactured.

## 3. Supported markets, timeframes, and honest coverage limits

The kernel is timeframe-agnostic and operates on the chronological bars Terminal actually supplies. The formula is supported on 1m, 5m, 15m, 30m, 1h, 4h, daily, and higher chart intervals where the current source provides enough ordered history.

- US regular-session finality uses the repository's exchange-session projection, including represented holidays and early closes.
- CN/HK session segmentation and lunch breaks are handled, but this tree does not contain an equally complete CN/HK holiday calendar; broad holiday-perfect freshness is not claimed.
- Crypto uses the existing 24-hour session identity.
- Missing bars do not create synthetic comparisons. Sparse intraday mode remains four available chart bars back.
- Feed delay, corrections, split adjustment, retention, and resampling remain properties of the existing data lineage; this indicator does not erase or upgrade them.
- On-chart intraday calculation is supported for an adequately populated symbol. Full-market real-time intraday scanning is not implemented or claimed.

## 4. Alerts and freshness

Only confirmed completion events are released through the existing suite-event path:

- `nine_rising` — completed rising nine, bearish exhaustion context;
- `nine_falling` — completed falling nine, bullish exhaustion context.

The canonical kernel and stable event identity are shared by chart computation and alert evaluation. Existing confirmation indexing, creation floor, trailing freshness, entitlement, one-shot watermark, persistence, dry-run, outbox, and delivery controls remain authoritative. A malformed or incomplete OHLCV row makes the daily source unevaluable instead of coercing missing values to zero.

The current alert sidecar evaluates admitted daily source files. Counts 7/8 remain chart-only provisional states. Watchlist/full-market intraday scanning and delivery of stale historical completions as new opportunities are not claimed.

## 5. Quantitative research result

The reproducible receipt is `docs/research/NINE_BAR_RESEARCH_RESULTS_2026-10-13.json`, receipt SHA-256 `f6ee9650fdf305a3f49e49875a0da9963b94d9e450fa4555fe7a345207202713`.

Coverage:

- 39,919 admitted bars across 34 US/crypto series;
- 37 chronological segments and 3 disclosed discontinuities;
- 8,478 endpoint observations;
- 1,078 primary nines and 103 repeat-cycle nines;
- 20,475 baseline candidates;
- 273 causally matched primary-nine pairs.

Feature buckets are causal expanding ranks within each chronological partition: a later observation cannot move an earlier event into another return/ATR/volatility bucket.

Matched all-sample results do **not** support a reversal-edge claim. Relative to matched non-events, the mean direction-adjusted return difference was:

- 5 bars: `-1.6016%`, 95% bootstrap CI `[-2.6580%, -0.6856%]`;
- 10 bars: `-1.4364%`, 95% bootstrap CI `[-2.6765%, -0.2437%]`.

The holdout is only 18 matched pairs across 15 symbols and is inconclusive:

- 5 bars: `-2.1894%`, CI `[-5.0560%, +0.7705%]`;
- 10 bars: `+1.0893%`, CI `[-1.8828%, +4.7424%]`.

These are associations from retained repository snapshots, not a licensed DeMARK study, a complete point-in-time vendor archive, or a production trading backtest. The product therefore remains descriptive: a completed nine is possible exhaustion context, not a probability, Buy/Sell instruction, or verified predictive edge.

## 6. Exact local verification

### Deterministic and integration tests

- final full Terminal suite at qualified head: **695/695 test files passed; 11,547 tests passed; 4 todo; zero failures**;
- final TypeScript gate: `tsc --noEmit`, exit 0;
- final production build: exit 0; compilation, TypeScript, page-data collection, 62/62 static pages, and route finalization completed;
- build note: the existing Turbopack NFT-tracing warning remains in `next.config.ts → lib/flowSource.ts → app/api/flow/stream/route.ts`; it did not fail the build;
- focused finality/missingness/causal-research repair gate: 23/23 tests passed;
- consolidated source-bound evidence readers: 5 files / 15 tests passed.

Retained execution logs are under `/Volumes/Mastermind/evidence/nine-bar-exhaustion-20261015/`, including `full-vitest-final-head.log`, `tsc-final-head.log`, `production-build-final-head.log`, `review-red.log`, `missingness-red.log`, `review-green-attempt1.log`, and `all-evidence-readers-final.log`.

### Browser and visual evidence

- Nine-Bar journey: **6/6**, zero retries, desktop/tablet/mobile × English/Chinese × Western/East-Asian color mode; 18 substantive lifecycle screenshots. Packet: `terminal/docs/pr-crops/nine-bar-exhaustion/`; captured source `48ed055b3cbd6bfde70a8bf0bd731bef84f01464`; report SHA-256 `5c88700cd2a0322d0ed9c04cb091942c87e964dabbd4f9ddea848e5b92d64231`.
- Existing chart-context compatibility: **30/30**, zero retries, desktop/tablet/mobile; six fresh EN/ZH crops. Packet: `terminal/docs/pr-crops/terminal-visual-intelligence/`; captured source `86a24a3f90604a41898de5d8b6afcddb51957a10`; report SHA-256 `c360ea6413ed52ba830c45ee9533dba6cf0d12811b97b8b64ebd2bf93a53e443`.
- Chart-chrome compatibility: **4/4** fresh captures; packet source `48ed055b3cbd6bfde70a8bf0bd731bef84f01464`.
- Options-axis compatibility: **5/5** captures with six exact native price lines, native axis labels suppressed, six visible DOM badges, no label/chrome collisions, and no page/console/HTTP errors. Packet source `ed89cc44032c286513aae6484b7ec1a6213009b2`.

The browser packets use deterministic local fixtures and prove product behavior, geometry, persistence, language, and lifecycle compatibility. They are not production deployment or live-provider freshness evidence.

## 7. Current release state

At the time this ledger was written:

- implementation branch: complete and locally qualified;
- independent whole-branch review: pending;
- remote branch: not yet published;
- pull request: not yet created;
- exact-head CI: not yet observed;
- protected merge: not yet observed;
- deployment identity: not yet observed;
- cache-busted live user-path verification: not yet observed.

These states must be advanced and reported separately. A local pass, PR creation, CI pass, merge, and deployment are not interchangeable evidence.

## 8. Next actionable release frontier

1. Perform one fresh whole-branch review against `origin/master...HEAD` and repair any Critical/Important finding with RED→GREEN proof.
2. Re-run affected gates and confirm the tree is clean.
3. Push this branch, open a non-draft PR, apply the established merge-on-green path, and inspect required checks at the immutable PR head.
4. Verify protected merge and current-master ancestry.
5. Verify the deployment artifact identity separately.
6. Exercise a cache-busted live path: discover → enable → configure → inspect completion → change timeframe → Replay → saved return.

Until those observations exist, the feature is **implemented and locally accepted, not yet claimed live**.
