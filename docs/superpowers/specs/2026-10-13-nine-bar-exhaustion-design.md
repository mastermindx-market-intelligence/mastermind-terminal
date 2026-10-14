# Nine-Bar Exhaustion & Reversal Intelligence — Design

Status: Chairman-commissioned implementation. This specification freezes the independently implementable nine-count slice; it does not reproduce proprietary DeMARK code or claim licensed DeMARK Sequential parity.

Procedure: `Mastermind@9a8e9b50b6158eb38af78a5b867eedba1719b908`, Skillpack `1.0.1/bootstrap 1`.
Base: `mastermind-terminal@140894302f9e50637e1891799463d548c0c46c63`.
Carrier: `sol/nine-bar-exhaustion-20261013` in `/Volumes/Mastermind/worktrees/nine-bar-exhaustion-20261013`.

## Outcome

A Terminal user can discover **Nine-Bar Exhaustion**, add it to a chart, configure its display and counting semantics, inspect deterministic rising/falling counts, retain it in saved chart state, replay it without future knowledge, and create freshness-gated alerts for completed rising or falling nines. The study is descriptive: a completed count means a directional nine-bar setup completed, not that a reversal is guaranteed.

## Evidence-derived rule families

Four rule families stay separate:

1. **Vendor Magic Nine / TDS 9 behavior.** Eastmoney and moomoo document a close-versus-four-bars-back sequence, retroactive 1–6 reveal on the sixth qualifying bar, removal of incomplete annotations when qualification fails, and permanent completed 1–9 structures. They do not document the complete DeMARK 9–13 system in those help pages.
2. **Official DeMARK Setup.** DeMARK Analytics defines Buy/Sell Setup as nine consecutive closes below/above the close four bars earlier and distinguishes Setup from Perfection, TDST, Countdown, recycling, and cancellation.
3. **Observed commission screenshots.** The commission references Tonghuashun screenshots, but the uploaded source available to this implementation contains the written commission rather than image bytes. Screenshot-specific pixel behavior is therefore not treated as observed evidence.
4. **Mastermind implementation.** The selected default is vendor-style, bar-based Magic Nine. Full DeMARK Countdown/13, perfection, TDST, and proprietary implementation details are explicitly out of scope.

Sources retrieved 2026-10-13:
- Eastmoney Help, “神奇九转指标介绍”: https://qhweb.eastmoney.com/help/2437550.html
- moomoo Help, “TDS 9 Tom Demark Sequential 9”: https://www.moomoo.com/us/support/topic3_930
- DeMARK Analytics, “Sequential”: https://demark.com/sequential-indicator/
- DeMARK Analytics, indicator descriptions: https://demark.com/indicators-list/

## Deterministic kernel

The canonical kernel is `terminal/lib/nineBarExhaustion.ts`. It receives strictly chronological bars plus explicit context/settings and returns points, episodes, completion events, coverage, and current state. Rendering and alerts both consume this kernel through the native Trend suite module.

### Baseline relation

For fixed lookback 4:

- rising: `close[t] > close[t-4]`
- falling: `close[t] < close[t-4]`
- equality or a missing/non-finite comparison interrupts the active episode
- opposite qualification resets the old episode and can start the opposite episode
- first comparison is bar index 4; first possible completion is index 12

No comparison is fabricated across a missing close. Sparse one-minute feeds remain **four observed chart bars back**, not four wall-clock minutes back. The tooltip and guide disclose this.

### Start semantics

- `direct` (default): any valid directional comparison can be count 1. This matches the documented vendor Magic Nine behavior.
- `price_flip` (optional): count 1 requires the immediately preceding valid relation to be the opposite direction. This exposes a DeMARK-like prerequisite without claiming full Sequential parity.

### Sustained trends

- `single` (default): the first valid nine completes once; later qualifying candles in the uninterrupted run do not emit repeated completion events or repeated 9 labels.
- `repeat`: the uninterrupted streak is segmented into non-overlapping nine-bar cycles; completion events occur only at absolute streaks 9, 18, 27, … . A later qualifying candle never emits a completion on every bar.

### Display semantics

- `retro6` (default): an active sequence appears only when it reaches 6, revealing 1–6 together; unfinished annotations disappear if the episode breaks; completed 1–9 histories remain eligible.
- `progressive`: the active episode is visible from 1; canceled partial history disappears; completed histories remain.
- `completed`: only completed 1–9 cycles are visible.
- density can show `all`, `late` (6–9), or `completion` (9 only).
- a bounded `historyBars` limit controls clutter without changing events.

### Finality, availability, and identity

- `formingBarIndex` is explicit input. A qualifying count on that bar may render as **forming**, but cannot create a confirmed completion event.
- Bar identity is `(symbol, timeframe, session, bar time/index)`; event IDs additionally include algorithm version, direction, and cycle.
- `availableT` may differ from source `t` (for multi-session bars); the kernel records both when supplied.
- chronological duplicates/reversals are rejected as invalid input rather than reordered.
- algorithm version is `nine-bar-v1.0.0`.

## Native suite architecture

Add `suite:trend/nine` to the existing Trend suite:

- metadata: `terminal/lib/suites/trend/nineBarExhaustion.meta.ts`
- implementation/render adapter: `terminal/lib/suites/trend/nineBarExhaustion.ts`
- canonical kernel: `terminal/lib/nineBarExhaustion.ts`
- existing `LabelPrim`, `MarkerPrim`, `TooltipDef`, and `SuiteEvent` contracts
- existing catalog, settings, persistence, lazy runtime, replay, entitlement, renderer, and alert evaluator

No new indicator framework, store, alert service, lifecycle, scanner, or control plane is introduced. The Golden Oracle and unrelated study math remain untouched.

## Visual and inspector contract

- rising counts sit above candles and use the directional down token because they describe potential upside exhaustion;
- falling counts sit below candles and use the directional up token because they describe potential downside exhaustion;
- completed 9 uses a pill plus optional diamond marker; intermediate values use bare labels;
- every visible count can expose direction, count/cycle, timeframe, close comparison, source bar, availability, final/forming state, and the non-guarantee warning;
- labels use density gates and a history bound for responsive readability;
- English/Chinese guides and alert names are included; numeric on-chart labels are language-neutral;
- east/west up/down preferences work through `ctx.colors.up/down`, never hard-coded hues.

## Alerts

The module emits only confirmed completion events:

- `nine_rising` — completed rising nine, direction `bear`
- `nine_falling` — completed falling nine, direction `bull`

Both enter the existing curated `SUITE_ALERT_EVENTS` catalog. Existing confirmation-index, creation-floor, trailing-freshness, one-shot watermark, entitlement, outbox, delivery, and dry-run paths stay authoritative. Counts 7/8 remain chart-only provisional states in this release; no stale historical event is delivered as new.

The current sidecar evaluates daily source files. On-chart intraday completion is supported, but full-market intraday scanning is not claimed.

## Data and research honesty

- The kernel is timeframe-agnostic and operates on the chart bars actually supplied: 1m/5m/15m/30m/1h/4h/daily/higher are mathematically supported where Terminal has adequate chronological history.
- Session boundaries and lunch breaks do not create synthetic bars. Bar mode means the fourth earlier **available chart bar**.
- Provider delay, correction, split adjustment, and retention remain properties of the existing source lineage; the study does not erase them.
- Statistical predictive value is a separate empirical question. Shipping formula correctness does not imply an edge.

## Collision boundaries

PR #999 modifies `ChartPanel.tsx` and chart-engine boundaries. This slice keeps core integration registry-driven. The only planned ChartPanel delta is the explicit `formingBarIndex` context passed to the existing suite host. It must be reconciled against current master before release and, because ChartPanel changes, satisfy the repository’s two screenshot/evidence gates.

## Acceptance proof

- kernel edge cases and no-lookahead prefix parity;
- module labels, tooltips, colors, completion markers, and event identity;
- registry/catalog/runtime split and settings persistence;
- alert catalog, dry-run, freshness, and duplicate suppression;
- typecheck, focused tests, full Terminal unit suite;
- mounted browser proof at 1440×900, 820×1180, and 390×844, in English/Chinese and both directional color modes;
- exact commit/PR/required CI/merge/deployment/live application identities reported separately.
