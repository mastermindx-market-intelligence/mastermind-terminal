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
