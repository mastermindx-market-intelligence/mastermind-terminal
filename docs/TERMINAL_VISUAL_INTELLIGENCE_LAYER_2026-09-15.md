# Terminal Visual Intelligence Layer

## Outcome and authority
Chairman Chris authorized Sol to build and complete this layer after Mastermind Candles.
The primary job: understand what the current chart is saying without assembling six studies,
and inspect WHY a particular candle looks that way without losing price, timeframe or date.
The machine job: consume the same bounded, descriptive numerical facts the user can inspect.
The moat is coherent explanation and context across the workflow, not arbitrary colored signals.
Sol owns the freeze, implementation, adversarial review and production acceptance. This is a
separate capability from the default-rollout PR #589, initially stacked on its repaired head
3f433bbac313cd0e4b82f12025d4a9a71247473d. Do not recreate that PR.
Procedure pin: Mastermind 19b6111891ffd742ceec7c96f437a2a890847c92 (skillpack 1.0.1).

## Full-scale thesis
Price remains the primary canvas. Candles communicate local state; optional regime tint
communicates slower trend; volume treatment communicates participation; named levels anchor
price; dated event marks locate catalysts; missing/provisional/conflicting context is explicit.
The end-state is a premium, multilingual, accessible chart that explains and exposes its
facts without converting research context into an unvalidated trade recommendation.
Future licensed macro/sector regimes, options positioning and event-impact forecasts may join
through their existing producers and acceptance gates. This layer must NOT synthesize those
capabilities merely because it has a place to draw them.

## First end-to-end release (the current freeze)
A compact Chart context disclosure lives on the active price pane. Open it to inspect the
latest plotted bar or move the chart crosshair to inspect a historical bar. It explains:
1. Mastermind Candles mode/state and its exact RSI(14) or EMA20/50 basis, alongside the raw
   candle direction. The same implementation produces both the paint and the explanation.
2. Slower EMA20/50 trend and whether it agrees with momentum. This is deterministic prose,
   never an LLM confidence score, win rate, buy/sell instruction or macro risk-on assertion.
3. Positive-volume percentile versus up to 100 strictly EARLIER plotted bars, with at least
   20 usable observations. This is not time-of-day relative volume or inferred buying pressure.
4. High/low of the previous 20 plotted bars, excluding the selected bar. These are reference
   range boundaries, not validated support/resistance forecasts or order-placement advice.
5. Report/ex-dividend/split dates carried by the EXISTING Fund artifact. Show source as-of and
   distinguish current-calendar history from point-in-time evidence. Current scheduled earnings
   dates remain estimates. Never invent missing dates or attach an undated transcript to a candle.

The disclosure and every overlay can be turned off. Regime tint, volume intensity, range levels
and event glyphs are optional and quiet by default. Price/OHLC geometry and all study settings
remain unchanged. Classic candles still work: context is descriptive even with candle coloring off.
A light candle-only runtime prevents this default from downloading all premium Trend modules.

## One system / no-rebuild boundaries
- Candle state: refactor the existing candlePainter math into one exported, pure state producer;
  keep suite:trend/cp, module settings, thresholds, series seeds and painter output identical.
- Presentation preferences: extend the existing ChartSettings/mm.chartSettings owner. No new
  preferences database, global event bus, polling service or user identity.
- Rendering: use the existing chart coordinates, price-pane clipping and indicator SVG layer.
  Existing volume series is restyled in place; never add a second volume pane or chart engine.
- Calendar: reuse getFund and its existing artifact/cache boundary; no new scraping/data feed.
- Numeric consumer: extend the existing per-bar indicator readout and ChartTableView columns.
  Do not alter the frozen ai_context_client.v1 envelope or introduce trade authority.
- Learning: discrete interactions through existing first-party analytics /api/collect. Do not
  log every mouse move, transcript or prompt. Instrumentation is not evidence of improvement.

## Time, missing data and corrections
All technical values at index i use bars <= i. Reference levels and volume baselines exclude i.
An empty series, invalid bar, insufficient warm-up and missing volume have distinct states;
missing is never a neutral regime or a fabricated zero. Paint retains its prior neutral fallback
where needed for compatibility, while the explanation admits the missing evidence.
Replay receives ONLY the replay slice. Calendar overlays are withheld in replay because the Fund
artifact lacks historical knowledge timestamps; current event knowledge cannot leak into replay.
Hover also cannot promote current calendar knowledge into historical point-in-time evidence.
Newly loaded symbols/timeframes clear outgoing context, including on read failure. A corrected
historical bar recomputes the forward projection; no identity-only memo may hide in-place correction.
The newest plotted bar is not automatically called live or confirmed. Basis text comes from the
existing quote/source context and admits that a forming bar and later corrections can change it.

## Experience and performance
One responsive implementation at 1440x900, 820x1180 and 390x844. The collapsed control is small;
expanded content is intentionally user-invoked, bounded, scrollable and keyboard dismissible.
Text accompanies color; up/down tokens follow the user's regional convention. Controls have
usable touch targets, stable focus and reduced-motion behavior. No overlay intercepts drawing/pan.
Crosshair selection is an O(1) read of the precomputed projection and updates the small disclosure,
not a new full calculation per mouse pixel. Overlay projection uses visible bounds and a hard
mark/label cap. A source-fetch failure cannot prevent the price chart from rendering.

## Acceptance / production proof
Required before acceptance: canonical paint parity, prefix-invariance, historical correction,
zero/null volume, warm-up, replay calendar withholding, symbol/timeframe race fencing,
classic-vs-colored distinction, default-on migration/removal, optional-layer persistence,
EN/ZH and regional-color behavior; real browser use at all three sizes, plus required hosted CI.
After merge: deploy ONLY protected origin/master via /opt/terminal/terminal-build.sh. Record
production data-dpl-id, live readout on real data, actual layer controls/paint, removal/reload,
source failure and replay behavior. Local fixtures are not production evidence.
Capability starts SPEC_ONLY; no docs/checks/merge may be called PROVEN_LIVE without those receipts.

## Basis references
TradingView Lightweight Charts v5.2 official plugin docs (pane/series primitives and z-order):
https://tradingview.github.io/lightweight-charts/docs/plugins/series-primitives
https://tradingview.github.io/lightweight-charts/docs/plugins/pane-primitives
W3C WCAG 2.2, Use of Color (redundant text/shape):
https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
These inform an original implementation; no competitor assets, code or proprietary data are copied.

## Continuation
Finish the existing #589 release while implementing this frozen user journey on this branch.
Keep source/effect identities recoverable. Stop only at a real release/authority boundary or
production-proven outcome; record precisely what remains rather than calling foundations done.


## Implementation checkpoint (2026-09-15)
The first complete local journey now exists, not just this spec: Chart context opens on the active
chart, explains its actual resampled bar, inspects history without future-calendar knowledge,
controls four optional render layers, and extends the existing numeric table/CSV readout.
The same canonical candle producer supplies both paint and explanations. Four pre-refactor
paint-output digests remain byte-identical. The candle-only default imports no paid Trend runtime.

Two existing cache defects were exposed by the new default and are part of this capability's
correctness closure, not a separate rebuild: (1) the suite host memo ignored OHLCV corrections
at fixed length/last-time; (2) raw price writes could remove candle colors while the applied-paint
signature falsely claimed they remained on the canvas. Both have discriminating red-first tests.
The existing bounded host memo now compares a primitive data snapshot; existing price writers
invalidate their existing paint signature. A signature is committed only after setData succeeds.
A bounded readback was added to the existing development-only chart diagnostics to prove actual
series color channels, not only a switch or a state label. There is no new production control API.

Latest verified local evidence at checkpoint: 327 unit files / 5430 passed / four existing todos;
nine inspector browser journeys across desktop/tablet/mobile passed; a separate real-series
paint test failed with all 120 sampled candle colors missing after a settings change, then passed
with the invalidation repair. Full release-candidate verification remains owed after checkpoint.

Candle predecessor #589 is merged as 702d81bb35f2c900a5aa1215437bf968aa9e6d93. Its git-gated VPS
deploy completed with DEPLOY_EXIT=0, healthy service and matching served data-dpl-id. The isolated
production browser proof tested both fresh and pre-existing browser state: default on, sibling
settings preserved, explicit removal remains off after reload. Proof script and receipt are in
terminal/e2e/tools/prove-mastermind-candles-live.mjs and the production crop directory.

Current layer state: BUILT_NOT_PROVEN. More browser negative/replay/numeric-consumer checks,
latest-head hosted gates, production deployment and real-data acceptance are still mandatory.
This checkpoint is not acceptance. Source procedure re-pin for predecessor release:
Mastermind 36f74c02edc938f7f5c41f38743f93ee34be2b2b (compatible skillpack 1.0.1).

## Release-candidate verification checkpoint (2026-09-16)
Canonical procedure was re-pinned from protected Mastermind master at
8ba7deedde164c90298d3e88785d98e02fa5e2d2 (bootstrap major 1; COLD_START + ACTIVE_EXECUTION).
This branch was merge-forwarded onto Terminal master through 34874e71, including the canonical
session-close and intraday-lineage changes, with no VIL-path conflict.

The browser journey is now closed locally across all supported sizes rather than inferred from
unit tests. The Visual Intelligence suite passes 10/10 on desktop 1440x900, tablet 820x1180 and
mobile 390x844. Those journeys cover persisted startup-timeframe hydration, current and historical
bar explanations, classic-candle truthfulness, real candle-paint survival through chart settings,
existing Chart Settings preference ownership, table/CSV parity against plotted 3D rows, replay
future-data/calendar withholding, symbol-race and unavailable-calendar fencing, and Chinese copy.
The mobile price-label/crosshair regression also passes after shrinking the collapsed context
control to a 44px touch target outside the price pane/fullscreen lane.

The current full local gate is clean: TypeScript noEmit passes; the forward-only plain-language
check exits 0; Vitest reports 332/332 files and 5509 passing tests with four existing todos.
User-visible context copy is routed through explicit EN/ZH pairs. The existing Chart Settings tabs
also expose stable accessible names, so the same restore journey is operable on phone layouts.
Six dark-theme browser captures (EN/ZH x desktop/tablet/mobile) were produced from the passing real
journeys under terminal/docs/pr-crops/terminal-visual-intelligence/.

Current layer state remains BUILT_NOT_PROVEN. Hosted CI on the exact pushed head, review/release
gates, protected-master merge, git-gated VPS deployment, and production real-data browser proof
remain mandatory before PROVEN_LIVE. Do not repeat local archaeology; next action is publish this
exact candidate on PR #590 and reconcile only the checks/review findings on that head.
