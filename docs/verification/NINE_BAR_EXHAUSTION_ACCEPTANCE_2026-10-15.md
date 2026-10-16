# Nine-Bar Exhaustion — Integrated Acceptance and Release Frontier

**Updated:** 2026-10-16
**Procedure pin:** `Mastermind@022e5f46a0095c911e00450c7046ea90ca9949fa`
**Protected Terminal base last reconciled:** `e72e1de16777bb131f2d47be02383c882ab63969`
**Carrier:** `sol/nine-bar-exhaustion-20261015`
**First review repair:** `ee9667be52a2bb61416b00211592d15225a6a9c0`
**Second-round source repair:** `53a69ffa7da546532ffc7ab32fc473075be5aaa0`
**Current-base integration commit:** `c5268ebb11576a366efb2af77bf4147aa0ecf68f`
**Current evidence commit:** `89e72adcebe26579ba50d60e942d66d337cbd319`
**Release PR:** `mastermind-terminal#1022`

This ledger is the recoverable release frontier for the Chairman-commissioned Nine-Bar Exhaustion slice. It distinguishes local implementation, independent review, evidence, publication, exact-head CI, merge, deployment, and live acceptance; no later state is inferred from an earlier one.

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

## 3. Review and repair record

A read-only whole-branch review of `origin/master...593a6dc5` returned **BLOCK: 5 Important, 3 Minor, 0 Critical**. Durable review:
`/Volumes/Mastermind/evidence/nine-bar-exhaustion-20261015/postfix-review-20261015/review-final.txt`.

The bounded repair at `ee9667be…` closed those eight findings with RED→GREEN evidence:

1. daily alert finality uses an explicit evaluation clock;
2. HK finality remains provisional through the admitted Closing Auction Session;
3. CN non-native resampling is session-anchored;
4. finite-but-impossible OHLCV is rejected before alert computation;
5. research matching checks availability at each requested horizon;
6. tooltips distinguish chart/display timestamps from availability;
7. delayed-entry sensitivity is retained and reported separately;
8. research/browser evidence is content-bound.

A later exact-head read-only review of PR #1022 at `c9cb4d9e…` did **not** return an acceptance verdict because its external Codex workspace exhausted credits. It therefore is not counted as final independent acceptance. Before failing, that review exposed two additional defects; both were independently reproduced and repaired at `53a69ffa…`:

9. **clock-only chart finality:** a forming nine now repaints when the market/session clock crosses finality even if no new quote arrives. A lightweight one-second heartbeat compares finality state and schedules a suite repaint only when the forming index changes; the existing suite memo key already distinguishes forming from final.
10. **ATR-missing research outcomes:** lack of event-bar ATR no longer censors non-ATR signed return, friction, delay, MFE, or MAE. ATR-dependent reversal/continuation fields stay null as preregistered.

Focused post-second-round validation passed **187/187 tests** across the kernel, module, chart-finality, alerts, dry-run parity, research, and intraday session contracts. TypeScript was clean before the current protected-base join. The former hosted-CI picker regression was also reproduced and repaired: the Pro catalog test now derives its expected count from `MODULE_CATALOG`; the exact previously failing browser case passed **1/1** locally.

Final independent exact-head acceptance remains a release obligation; the failed credit-limited review is not promoted into one.

## 4. Alert capability and freshness

Released alert event types remain narrowly scoped to confirmed daily completions:

- `nine_rising` — rising nine completed, bearish exhaustion context;
- `nine_falling` — falling nine completed, bullish exhaustion context.

The chart and alert paths use the same canonical kernel and stable event identity. Existing confirmation indexing, creation floor, trailing freshness, one-shot watermark, entitlement, persistence, dry-run, outbox, and delivery contracts remain authoritative.

Counts 7/8 are chart-only provisional states. Full-market intraday scanning is not implemented or claimed. Malformed daily source data is unevaluable rather than coerced into a signal.

## 5. Market/data support boundaries

The kernel is timeframe-agnostic where Terminal supplies at least 13 valid chronological chart bars. Formula support includes 1m/5m/15m/30m/1h/4h/daily/higher intervals, but source depth and freshness remain provider properties.

Current direct Polygon/Massive chart-request windows are bounded by result limits: 10 calendar days for 1m/5m, 25 days for 10m–30m, 60 days for larger US intraday intervals, and 30 days for larger crypto intraday intervals. These are request windows, not retained-history guarantees.

US regular-session finality uses the repository exchange-session clock including represented early closes. CN/HK lunch/session segmentation is implemented, but broad holiday-perfect CN/HK freshness is not claimed. HK finality conservatively includes the Closing Auction Session through 16:10. Crypto is treated as 24-hour.

## 6. Quantitative research — current evidence

Machine receipt: `docs/research/NINE_BAR_RESEARCH_RESULTS_2026-10-13.json`
Receipt SHA-256: `b483bf48e4ed8f1aedd4577d072ed11b47ade8e28bf1f0ff5f68c20c0fdde3fb`
Research source head: `c5268ebb11576a366efb2af77bf4147aa0ecf68f`.

Coverage:

- 39,919 admitted bars;
- 34 US/crypto series;
- 37 chronological segments, 3 disclosed discontinuities;
- 8,478 endpoint observations;
- 1,078 primary nines, 103 repeat-cycle nines;
- 20,475 baseline candidates;
- matched primary pairs by requested horizon: **1b 293, 3b 290, 5b 289, 10b 281, 20b 273**.

The ATR-missingness repair adds four early development-period primary nines to non-ATR descriptive return/excursion coverage. It does not change the matched headline effects, which are byte-identical to the prior receipt.

Matched all-sample return difference in the hypothesized reversal direction:

- 5 bars: **-1.4708%**, 95% cluster-bootstrap CI **[-2.4928%, -0.5830%]**;
- 10 bars: **-1.4217%**, CI **[-2.6840%, -0.2684%]**.

Holdout:

- 5 bars: 24 pairs / 18 symbols, **-1.5273%**, CI **[-4.2492%, +0.9657%]**;
- 10 bars: 21 pairs / 16 symbols, **+0.1777%**, CI **[-2.2108%, +3.0697%]**.

One-bar delayed-entry sensitivity remains non-promotional:

- all sample: 5b **-0.0944%** (N=1,063), 10b **-0.2263%** (N=1,051);
- holdout: 5b **-0.2652%** (N=214), 10b **-1.4223%** (N=207).

The evidence supports shipping a mathematically correct **descriptive exhaustion indicator**, not a reversal probability, calibrated rank, or Buy/Sell instruction. The retained snapshot is not a complete point-in-time universe and does not justify causal performance claims.

## 7. Browser and evidence identities

### Nine-Bar user journey

Fresh second-round Playwright matrix: **6/6 passed, zero failures/skips/flakes/retries** across desktop/tablet/mobile × EN/ZH × Western/East-Asian directional-color modes. It covers discover → enable → settings → completed-count tooltip → Replay → timeframe change → saved return and writes 18 substantive lifecycle screenshots.

Packet: `terminal/docs/pr-crops/nine-bar-exhaustion/`
Captured implementation source: `53a69ffa7da546532ffc7ab32fc473075be5aaa0`
Browser report SHA-256: `a394c1dbda910df6bae31b3262a61dae8274c87d0b2a4e18ff954925ef931093`.

### Existing chart compatibility

The changed ChartPanel boundary required fresh source-bound compatibility captures. Current artifacts:

- Visual Intelligence: **30/30 passed**, zero failures/skips/flakes/retries; browser report SHA-256 `578c01f54b0044d37724aacabcee70968600fcd189c582aa915652bc5cec29d4`;
- Options-axis manifest SHA-256: `5fb62daf3eb761e03d149c7387807e7ddcacfcd2572956ad14213f01ad3efb4b`;
- chart-chrome packet manifest SHA-256: `a68804b86e6698a8851be411d62bd596643ca443526b1f49e38be442c3f58e84`;
- source-bound evidence readers after the current-base join: **5 files / 15 tests passed**.

The browser packets use deterministic local fixtures. They prove product behavior, geometry, persistence, language, and lifecycle compatibility; they are not production-deployment or live-provider freshness evidence.

## 8. Current-base qualification frontier

The feature and dirty evidence paths were disjoint from the protected advance `55570e66… → e72e1de1…`. The branch joined protected `master@e72e1de16777bb131f2d47be02383c882ab63969` cleanly at `c5268ebb…`; the locked ChartPanel source remained byte-identical to the fresh browser captures. Evidence was sealed at `89e72adc…`.

Final current-base qualification is green:

- second-round focused gate: **187/187 passed**;
- exact browser regression that failed old hosted CI: **1/1 passed**;
- Nine-Bar browser matrix: **6/6 passed**;
- Visual Intelligence browser matrix: **30/30 passed**;
- source-bound evidence readers: **15/15 passed**;
- research runner: deterministic across repeated executions at the current-base source;
- canonical full Terminal unit suite: **723/723 test files passed; 12,069 tests passed; 4 todo; zero failures**;
- TypeScript: `npx tsc --noEmit --pretty false`, exit 0 after removing a corrupt disposable `.next/dev/types/routes.d.ts` left by an interrupted local dev server; no source file changed for that recovery;
- production build: exit 0; Turbopack compile succeeded, TypeScript completed, page data collected, and **64/64 static pages** generated;
- build note: the pre-existing Turbopack NFT tracing warning remains on `next.config.ts → lib/flowSource.ts → app/api/flow/stream/route.ts`; it did not fail the build;
- `git diff --check`: clean after making the research markdown generator emit one canonical trailing newline.

Final qualification logs are retained under `/Volumes/Mastermind/evidence/nine-bar-exhaustion-20261015/final-candidate-89e72adc/`.

Only release-owned states remain after local qualification: publication of the new exact head, hosted CI/review, landing, deployment identity, and live product acceptance.

## 9. Release state

PR #1022 is open and non-draft. The previously published remote head is `c9cb4d9e4a757c69f081a73ec5cb666f95155ef3`; the newer current candidate has not yet been pushed.

Hosted CI for the old head completed with one deterministic branch-owned failure in the desktop-2 shard: the picker asserted 31 modules while Nine-Bar correctly made the catalog 32. All other hosted jobs completed successfully; an unrelated Pine temporal case was flaky and passed on retry. The deterministic count contract has been repaired and its exact browser case passes locally. Old-head CI is historical and cannot qualify a new pushed head.

As of this ledger update:

- local implementation: complete on the current integrated source;
- first independent review: completed; all eight findings repaired;
- second exact-head review: interrupted by reviewer credit exhaustion; no final verdict, two surfaced defects repaired;
- research/browser evidence: refreshed and content-bound;
- protected-master reconciliation: current through `e72e1de1…`;
- final local full-suite/typecheck/production-build qualification: green;
- remote branch/PR: published, but still on the older head until the new candidate is pushed;
- exact-head CI for the new candidate: not yet observed;
- final independent exact-head acceptance: not yet observed;
- merge: not yet observed;
- deployment: not yet observed;
- live application acceptance: not yet observed.

Still required for release:

1. seal this ledger and push the current branch to update PR #1022;
2. inspect exact-head hosted CI and obtain a fresh independent exact-head review if an independent reviewer is available;
3. when the PR is ready, follow the repository landing policy for the exact head; landing approval is head-specific;
4. verify protected merge/current-master content;
5. verify deployment identity separately and never deploy an ancestor of a newer live generation;
6. exercise the cache-busted live product journey and verify the served deployment identity.

No later state should be inferred from an earlier one.
