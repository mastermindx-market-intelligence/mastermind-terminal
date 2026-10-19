# Mastermind Chart Engine — Masterplan

*2026-07-20 · living doc · owner: charting program*

## Thesis

Everything above the renderer is already ours — data model, indicators, Pine v6 interpreter,
Golden Oracle signal layer, drawings/replay, workspace and interaction logic. The one layer we
do not own is the low-level canvas renderer (TradingView `lightweight-charts` 5.2). To reach
institutional perceived quality — and go past it on the workflows we care about — we replace
only that final layer, and we do it behind our own API so the swap is a flag flip, not a rewrite.

```
Mastermind Chart Engine
├── Data model                  ours
├── Indicators and Pine         ours
├── Signals and intelligence    ours
├── Drawings and replay         ours
├── Workspace and interaction   ours
└── Canvas renderer             lightweight-charts 5.2  ←  the only rented layer
```

## Current coupling (measured 2026-07-20)

`terminal/components/ChartPanel.tsx` is 4,041 lines and speaks raw LWC at ~300 call sites:
68× `setData`, 47× `addSeries`, 44× `ISeriesApi`, 25× `IChartApi`, 21× `applyOptions`,
19× `timeScale()`, 14× `createPriceLine`, 8× `panes()`, 5× `createChart`, plus the markers
plugin (`createSeriesMarkers`), the watermark plugin, and a custom `ISeriesPrimitive`
(`lib/sessionShading.ts`). Satellite consumers: `ChartPane.tsx`, `lib/paneSync.ts`,
`lib/indicatorMath.ts` (types only), `ChartFrameBar.tsx`, `ChartSettingsModal.tsx`,
`OptionsHubView.tsx`, `lib/intradaySources.ts`, `lib/__tests__/subpaneAssign.test.ts`.

## Target architecture

```
terminal/lib/chart-engine/
├── api.ts        renderer-agnostic contract (MastermindChart)
├── lwc/          adapter: api.ts ⇄ lightweight-charts 5.2 (thin, 1:1 semantics)
│   └── index.ts
├── canvas/       (P3) clean-room Canvas2D renderer implementing api.ts
└── __tests__/    contract tests — run against EVERY implementation
```

### The contract (`api.ts`) — shape

```
createEngine(container, options, impl?) → ChartEngine
ChartEngine
├── addSeries(kind, style, paneIndex?) → SeriesHandle
│     kind: candles | bars | line | area | histogram | baseline
├── SeriesHandle: setData · update · applyOptions · setMarkers ·
│     createPriceLine → PriceLineHandle · priceToCoordinate · coordinateToPrice ·
│     paneIndex · moveToPane · attachPrimitive · remove
├── panes() → PaneHandle[]: height · setHeight · setStretch · setSeparatorColors
├── timeScale(): visible-range get/set/subscribe · timeToCoordinate ·
│     coordinateToTime · scrollToRealtime · applyOptions
├── applyOptions (layout/grid/crosshair/localization)
├── subscribeCrosshairMove · subscribeClick · subscribeDblClick
├── setWatermark(paneIndex, lines)
├── unwrap() → raw impl handle        ← P0 escape hatch, dies in P3
└── destroy
```

Two contract laws:

1. **Semantics are defined by our contract tests, not by LWC.** Every implementation ships
   against `chart-engine/__tests__` (jsdom where possible, playwright-pixel where not).
2. **`unwrap()` is temporary.** Every call site through the escape hatch is tech debt with a
   tracking comment (`// engine-unwrap:`), grep-countable, and must reach zero before P3 ships.

## Phases

- **P0 — foundation (additive, zero production risk).** `api.ts` + complete `lwc/` adapter +
  contract tests. No ChartPanel changes. Ships dark.
- **P1 — rewire ChartPanel.** Mechanical migration of chart/series lifecycle to the engine API,
  behavior-frozen (same options, same order of operations), type-gated, screenshot-compared
  before/after. `unwrap()` allowed for the long tail (primitives, markers edge cases).
- **P2 — primitives + interactions behind the API.** sessionShading, markers, watermark,
  drawings hit-testing, pane sync. `unwrap()` count driven toward zero. This is where the API
  earns the right to a second implementation.
- **P3 — clean-room Canvas2D renderer** (`canvas/`), implementing `api.ts` exactly:
  candles/bars/line/area/histogram/baseline, price+time scales with label collision, autoscale,
  crosshair/tooltips, pan/pinch/inertia, multi-pane, hi-DPI alignment, incremental live-bar
  updates, primitive + hit-test hooks. Dark-launch behind `?engine=mm` and a per-user flag;
  parity harness gates rollout (below). WebGL is a later optimization for footprint/tick-scale
  work, not a P3 requirement.
- **P4 — flip default, keep LWC as fallback flag for one release, then remove.**

## Parity / quality gates (P3 exit criteria)

- Visual: screenshot diffs vs LWC at 5 zoom levels × {daily, intraday, gapped, halted,
  1-bar, 40k-bar} datasets, all panes, both DPRs (1x, 2x) — diffs explained or fixed.
- Motion: 60fps pan/zoom/crosshair on a mid-tier phone (recorded traces); pinch anchors under
  the fingers; inertial scroll decays like the native platform.
- Correctness: timezone/session boundaries, DST, exchange holidays, malformed/gap data,
  live-splice updates without full redraw.
- Memory: ≤ LWC baseline on the 40k-bar workspace; no leak across 50 symbol/TF switches.
- Interaction: axis label collision never overlaps; hit-testing tolerances match drawings UX.

## Where we go PAST TradingView (the point of owning the layer)

- Signals in the visual grammar: Oracle marks, regime shading, structure-break warnings as
  first-class render primitives, not overlay hacks.
- Macro/regime pressure rendered directly into the chart chrome (risk radar tint, session
  shading synced to the macro plane).
- Decision Packet + Brain annotations as native primitives with hit-testing.
- Automatic information density: the renderer knows viewport + data density and promotes/demotes
  detail (labels, wicks, markers) instead of exposing 400 toggles.
- Mobile interaction tuned to our workflows (pinch-anchored replay scrubbing, one-thumb pane
  management) rather than a desktop port.

## Why not a one-shot rewrite

Drawing candles is easy; the expensive engineering is timezone/session behavior, axis tick
generation + label collision, autoscaling across series, touch inertia + pinch anchoring,
pixel-perfect hi-DPI, hit testing, pane resize/sync, and pathological market data. The API-first
path lets each of those be conquered behind a flag with LWC as the always-on control group.

## LWC 5.2 facts the adapter bridges (verified against installed typings)

- `scrollToRealTime` has a capital T in LWC; the contract keeps `scrollToRealtime()`.
- `ISeriesApi` has NO `.remove()` — removal is `chart.removeSeries(series)`; the contract
  puts `remove()` on SeriesHandle and the adapter delegates to the chart.
- Markers are the `createSeriesMarkers` plugin (lazy-created on first `setMarkers`,
  reused, `.detach()`ed on removal), not a series method.
- Watermark is pane-level only (`createTextWatermark(pane, opts)`; the chart-level
  option died in v5). No clear method → "replace" = detach + recreate.
- `TextWatermarkLineOptions` requires `fontFamily`/`fontStyle`; the adapter supplies
  neutral defaults. `setWatermark` accepts a full `WatermarkSpec` (alignment/visibility)
  or a bare `WatermarkLine[]` shorthand.
- Pane indices clamp (`getOrCreatePane`: out-of-range → append at `panes.length`) on both
  `addSeries(def, opts, paneIndex)` and `series.moveToPane` — the semantics pinned by
  `lib/__tests__/subpaneAssign.test.ts`. The adapter forwards indices untouched.
- Contract tests live at `terminal/lib/__tests__/lwcAdapter.test.ts` (vitest include only
  collects `lib/__tests__/**`); they run against a mocked LWC module — real LWC needs a
  canvas, which vitest/jsdom lacks (repo precedent).

## Status log

- 2026-07-20 · P0 landed (api.ts + lwc adapter + contract tests, 45 tests) — additive, dark.
- 2026-07-20 · P0.5 + P1 landed (PR #157): contract gained the surface ChartPanel measurably
  uses (priceScale/paneSize/swapPanes/takeScreenshot/pane()/getHTMLElement, 50 tests);
  ChartPanel's renderer lifecycle now runs through createEngine with chartRef holding the
  `engine-unwrap:` bridge — the engine is in the production path, downstream call sites
  byte-identical. P2 next: migrate clusters (series builders, markers, price lines,
  watermark, priceScale sites) behind the contract and drive the unwrap count to zero.
- 2026-10-12 · P2 canvas foundation (PR #969, 24-lane fan-out): `lib/chart-engine/canvas/**`
  dark-launched as impl `"mm"` behind `createEngine(el, opts, "mm")`; `CANVAS_CAPABILITIES`
  and the typed `EngineRefusalError` make an unsupported option group a refusal, never a
  silent downgrade. The factory-agnostic conformance corpus runs against both engines.
- 2026-10-13 · Mount selection (PR #982), canvas paint + input + bench harness (PR #987),
  wave-4 hardening (PR #991) and the ChartPanel primary migration at the F-13 stage (PR #992,
  master `0e011e81c`): `?engine=` / `mm.engine` resolve per mount, default and unknown values
  keep lwc with no storage write, `[data-chart-engine]` marks the host. Perf wave (PR #994),
  presented-frame cadence instrument (PR #995) and Q03b per-input presentation latency (PR #998)
  followed, each deployed through the git-gated build and live-proven.
- 2026-10-13 · Q03 ruling: the pan half is LIFTED (official Q03b v1 receipt at `e206cd046`, mm
  p95 9.138 / p99 9.639 ms); the zoom half FAILED (p95 20.562 / p99 37.175 ms) and is HELD.
- 2026-10-17 · Boundary closure (PR #999, master `9938c0cb0`, ce8): the forced-lwc fallback is
  gone, so `?engine=mm` mounts the owned Canvas2D engine with no warning; ChartPanel has no
  direct `lightweight-charts` import and no `.unwrap(` (it still reaches LWC types through
  `lib/chartTimeAxis` and `lib/sessionShading`). PaneHandle identity is ruled (one pane per
  handle, `index()` tracks the current slot).
- 2026-10-17 · Q03b protocol v2 (PR #1027, master `3c115e5d1`, ce9): wall-clock seeded wheel
  dispatch and a harness rAF awake start. The one official v2 receipt (head `1b7ec6a6b`) is a
  VALID FAIL: mm zoom input-to-present p95 21.655 / p99 42.429 ms vs <= 20 / <= 33.4 (pan PASS
  8.905 / 9.686); the lwc comparator fails the same budgets. Per D10 nothing is amended after
  the result and no receipt is committed; the bench readiness retry (PR #1028) is
  harness-only.
- 2026-10-17 · Acceptance close: PR #993 (GAPS, 24fd0ce6f) and PR #997 (census follow-ups,
  3e6e9591d) landed; `docs/chart-engine-completion/acceptance-ledger.md` records all 136 rows
  (102 ACCEPTED / 31 UNRESOLVED / 3 EXCLUDED) with each UNRESOLVED row's gate. Live at
  `3e6e9591d21b` (ce11): P01 opt-in mm, default lwc, bogus lwc and the `engineProbe=refuse`
  rollback all PASS. P03 (default -> mm, branch `claude/ce-p03-1013`) and P04 (LWC retirement)
  stay HELD on the zoom half; the next step is a prospective v3 decision with a new falsifiable
  diagnosis, not a re-measurement.
