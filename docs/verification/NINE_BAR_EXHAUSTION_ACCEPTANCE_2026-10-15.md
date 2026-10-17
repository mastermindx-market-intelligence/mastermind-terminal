# Nine-Bar Exhaustion — Integrated Acceptance and Release Frontier

**Updated:** 2026-10-17
**Procedure pin:** `Mastermind@a552a5e506ae808efa575c2e13cb56f478c72b87`
**Protected Terminal base last reconciled:** `fb72315fa9fd8c0d0c058632fdef7b91ec20d53f`
**Carrier:** `sol/nine-bar-exhaustion-20261015`
**First review repair:** `ee9667be52a2bb61416b00211592d15225a6a9c0`
**Second-round source repair:** `53a69ffa7da546532ffc7ab32fc473075be5aaa0`
**Current-base integration commit:** `530b230efa1d447e22ff5e7769491053eb9635d3`
**Pre-integration evidence commit:** `3963baf052bf508a2270c65d4cbf96c6a2336133`
**HK Replay repair:** `291e528c1bd8354a2d8b9dd8ca5948ca6c19ca13`
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

An additional pre-release review of the session-aware Replay consumer identified an HK closing-auction lookahead bug. At 16:00 Hong Kong time, Tencent can still mutate its last 15:00 hourly candle with closing-auction prints until 16:10; Replay previously exposed that future-mutated candle prematurely. Repair `291e528c…` shares the session-close calculation with the existing live suite finality, carries market identity to the Replay axis/cutoff, and fails closed on invalid HK timing. A real resampled Tencent fixture proves the ninth completion is withheld at 16:00 and 16:09:59 and first appears at 16:10. The focused Replay/Chart/Module/Lookahead matrix passed **84/84**.

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

US regular-session finality uses the repository exchange-session clock including represented early closes. CN/HK lunch/session segmentation is implemented, but broad holiday-perfect CN/HK freshness is not claimed. HK live finality **and historical Replay availability** conservatively include the Closing Auction Session through 16:10, so future auction prices cannot leak into the prior 16:00 bar. Crypto is treated as 24-hour.

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

**Integrated product source:** `530b230efa1d447e22ff5e7769491053eb9635d3` (protected `master@fb72315f…` plus Nine-Bar and HK Replay). Browser evidence is a deterministic local fixture, not a live-feed or deployment assertion.

- **Nine-Bar user journey:** **6/6 passed**, zero failures/skips/flakes/retries; desktop/tablet/mobile × EN/ZH × Western/East-Asian colors; discover, enable, settings, inspect, Replay, timeframe switching, persisted return. Eighteen substantive screenshots. Actual Playwright JSON SHA-256: `a7455441da48fc968eec3ea673e8cdbf0afeffced0f9c7d269bf35a6c0504886`.
- **Visual Intelligence compatibility:** **30/30 passed**, zero failures/skips/flakes/retries; retained six bilingual responsive screenshots and full report. SHA-256: `ef6052a07fb3bd3642ebc65a4312c4d35752b34d4375e120949e07aec631f958`.
- **Options-axis compatibility:** **5/5 passed**; every capture contains six exact-price options levels, suppressed native axis labels, no tag/chrome overlap, no page/console/HTTP error. Content-bound manifest SHA-256: `b470926d5c9fe45ca1d3b9470237c01605c3c761acfbbb0971a28f6524b5079a`. The earlier false capture failure was the test server omitting its fixture email/entitlement, allowing the intended anonymous indicator cap to replace the seeded `optlevels` study. The fixture instructions document the required entitlement; production permissions remain unchanged.
- **Chart chrome:** four desktop/mobile EN/ZH crops recaptured on the integrated source with the existing B-PL-6 owner. Manifest SHA-256: `2d49e692ff62ec3a6f9ee57816dd15d472566f08802c88f534b9f59cf6e77c6b`.

The corresponding source-bound browser/evidence integrity guards are green; their final combined total is reported in Section 8. All captures were made against the actual integrated source, not copied from the old master or old feature branch.

## 8. Current-base qualification frontier

The protected source advanced materially when chart-engine PR #999 and benchmark PRs #1027/#1028 landed. The feature's previous ChartPanel integration was reconciled with the actual protected branch rather than treating `behind` as a cosmetic number. The join at `530b230e…` composed source without a code conflict. The overlapping screenshot manifests and binaries were resolved in favor of protected accepted versions, then affected browser evidence was **genuinely recaptured** on the integrated tree.

Green on integrated source `530b230e…`:

- Core Nine-Bar/Replay/chart-engine focused Vitest gate: **182/182 passed**;
- dedicated HK auction Replay regression with a composed Tencent 16:05 tick: **PASS**, confirmation delayed to 16:10;
- TypeScript `npx tsc --noEmit --pretty false`: exit 0;
- Nine-Bar browser acceptance: **6/6**; Visual Intelligence: **30/30**; Options-axis: **5/5**; chart-chrome: **4/4**;
- source/report/crop integrity guards: Nine-Bar **4/4**, Visual **3/3**, Options **3/3**, chart-chrome **4/4**;
- retained research receipt: `b483bf48e4ed8f1aedd4577d072ed11b47ade8e28bf1f0ff5f68c20c0fdde3fb` (no research-source modification in the current join).

Current full unit suite at the integrated source: **729/729 test files, 12,148 passing tests, 4 todo, zero failures**; retained `full-vitest.log`, exit 0. Production build: **exit 0**, Turbopack compile, TypeScript, and page-data collection complete with **64/64 static pages** generated; retained `production-build.log`. The previous source `89e72adc…` passed 723 test files / 12,069 tests; those prior results remain historical, not the release proof.

Current browser/CI reports are retained under `/Volumes/Mastermind/evidence/nine-bar-exhaustion-20261017/integrated-530b230e/`. Existing nonblocking warning: Turbopack NFT traces `next.config.ts → lib/flowSource.ts → app/api/flow/stream/route.ts` during build.

## 9. Release state

PR [#1022](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1022) remains open and non-draft. Its most recently verified **remote** head was `485a674275e64d3b0fc9dd1a2b5314b5e9aabc80`; all **17 PR-head hosted checks passed on that historical head**. The newer local integration source and evidence have not yet been published, so old green CI cannot be substituted for the next head's CI.

The protected base was `fb72315fa9fd8c0d0c058632fdef7b91ec20d53f` at the integrated source join. The exact in-scope code/evidence was reconciled with PRs #999/#1027/#1028; do not create an ancestry-only commit if `master` later moves on disjoint paths.

A final independent technical review remains **unproven**. The earlier reviewer at `593a6dc5…` returned BLOCK and its findings were repaired; the subsequent exact-head native reviewer exhausted credits before issuing a verdict. The current Executive `session_summon` attempt returned `backend_unavailable` and no authorized canonical reply was found. Neither failure is an acceptance receipt and neither authorizes a duplicate dispatch.

Last observed live Terminal deployment: `3c115e5d15177bf721420b69e87e93978dc2f264`, `systemctl is-active terminal = active`, no active deploy jobs. This is a **pre-feature** production generation, not Nine-Bar live proof. Vercel rate/preview status is separately recorded and is not a substitute for the VPS deployment identity.

As of this ledger update:

- feature implementation and bounded repairs: **BUILT_NOT_PROVEN**;
- current-base local source composition: complete at `530b230e…`;
- deterministic kernel, alert/replay, browser and fixture evidence: green at the source stated above;
- final local unit suite / TypeScript / production build: green on integrated source `530b230e…`;
- remote PR update / new exact-head hosted CI: pending;
- final independent technical review: **not accepted**;
- protected merge: not observed;
- deployment and cache-busted real product journey: not observed.

Next actions are ordered: seal and publish the matching evidence on the existing PR, inspect **new-head** CI and independent reviewer output, and only then use the repository's authorized native landing path with expected-head checks. If those release gates pass, verify the protected merge, deploy only the correct descendant of the live generation, and exercise the live user chart journey. Never infer merge from green CI or production acceptance from a local fixture.
