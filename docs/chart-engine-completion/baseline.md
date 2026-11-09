# Chart engine completion — programme baseline (G01)

*Measured at `BASE_SHA = c923cc46d179dd92cb6e3bd6d10c03c9bac17c76` (2026-10-11) by lane
`ce-g01-1012`. Every number below was produced by a quoted command run in `terminal/` on a
clean checkout of that SHA; nothing is estimated. This file is the "before" photograph the
boundary ratchet (`terminal/lib/__tests__/chartEngineBoundary.test.ts`) pins in CI.*

## 1. The rented layer

| What | Value | Where measured |
|---|---|---|
| declared dependency | `"lightweight-charts": "^5.2.0"` | `terminal/package.json:27` |
| installed version | `5.2.0` | `terminal/node_modules/lightweight-charts/package.json` |
| adapter | `terminal/lib/chart-engine/lwc/index.ts` (552 lines) | `wc -l` |

`grep -n '"lightweight-charts"' package.json` → `27:    "lightweight-charts": "^5.2.0",`;
`grep '"version"' node_modules/lightweight-charts/package.json` → `"version": "5.2.0"`.

## 2. The engine at baseline

```
terminal/lib/chart-engine/          (all files, wc -l)
├── api.ts          274   renderer-agnostic contract (types + interfaces only)
├── index.ts         60   createEngine factory; EngineImpl = "lwc" only
├── axisZoom.ts     119   wheel/axis-zoom pointer anchoring math
├── futureTime.ts   125   synthetic future drawing coordinates
├── viewReset.ts     85   named-view reset semantics
└── lwc/index.ts    552   the ONLY file allowed to import lightweight-charts
```

`options.ts`, `time.ts`, `primitive.ts` and `canvas/` do **not** exist at this SHA; sibling
lanes are creating them now. The boundary test walks the whole tree, so each lands fenced
on its first commit.

## 3. Importer census (15 files outside `lib/chart-engine/`)

Measured with:

```sh
grep -rl 'from "lightweight-charts"\|require("lightweight-charts")' \
  --include="*.ts" --include="*.tsx" components/ lib/ app/ \
  | grep -v node_modules | grep -v __tests__ | sort
```

Fifteen files (the masterplan's satellite consumers plus the surfaces). This is exactly
`LWC_IMPORT_ALLOWLIST` in the ratchet test — the set may only shrink.

| # | File | Imported symbols |
|---|---|---|
| 1 | `components/ChartPanel.tsx:12` | `CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, BaselineSeries, createSeriesMarkers, ISeriesMarkersPluginApi (type), createTextWatermark, CrosshairMode, ColorType, LineStyle, LineType, MismatchDirection, PriceScaleMode, IChartApi/ISeriesApi/IPaneApi/IPriceLine (types)` |
| 2 | `components/ChartFrameBar.tsx:3` | `IChartApi (type), PriceScaleMode` |
| 3 | `components/ChartSettingsModal.tsx:5` | `PriceScaleMode, IChartApi (type)` |
| 4 | `components/ChartPane.tsx:10` | `IChartApi (type)` |
| 5 | `components/TideChartLazy.tsx:17` | `createChart, LineSeries, AreaSeries, IChartApi/ISeriesApi (types)` |
| 6 | `components/surface/SurfacePane.tsx:36` | `createChart, CandlestickSeries, IChartApi/ISeriesApi/MouseEventParams/Time (types)` |
| 7 | `components/surface/StrikeEvolutionModal.tsx:22` | `createChart, LineSeries, createSeriesMarkers, IChartApi/ISeriesApi/Time (types)` |
| 8 | `components/surface/SessionFlowPane.tsx:33` | `createChart, LineSeries, AreaSeries, IChartApi/ISeriesApi/Time (types)` |
| 9 | `app/embed/chart/EmbedChart.tsx:18` | `createChart, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode, ColorType, LineStyle, IChartApi/ISeriesApi/MouseEventParams/Time (types)` |
| 10 | `lib/surfaceContract.ts:17` | `Time (type)` |
| 11 | `lib/drawingPaneReadiness.ts:1` | `ISeriesApi/ISeriesPrimitive/SeriesType (types)` |
| 12 | `lib/heatSeries.ts:26,38` | types `ICustomSeriesPaneView, ICustomSeriesPaneRenderer, PaneRendererCustomData, CustomSeriesPricePlotValues, PriceToCoordinateConverter, CustomData, CustomSeriesOptions, Time, WhitespaceData`; value `customSeriesDefaultOptions` |
| 13 | `lib/sessionShading.ts:27` | types `ISeriesPrimitive, ISeriesApi, SeriesType, IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, IChartApi, SeriesAttachedParameter, Time` |
| 14 | `lib/chartTimeAxis.ts:1` | `TickMarkType, Time (type)` |
| 15 | `lib/paneSync.ts:13` | `IChartApi/ISeriesApi/SeriesType/Time (types)` |

Two further files mention the package **only in comments** (`lib/chart-engine/api.ts:5`,
`lib/chart-engine/futureTime.ts:21`) — the ratchet strips comments before matching, so
documentation prose cannot false-fail. Note for P2 planning: files 2–4, 10, 14, 15 are
type-only or near-type-only imports — cheap first wins for driving the list down.

## 4. ChartPanel raw-call census

`components/ChartPanel.tsx` is 9,978 lines; `lib/paneSync.ts` is 538. Construction already
runs through the engine (`components/ChartPanel.tsx:3915` `createEngine(el, {...})`), and the
raw `IChartApi` is reached through exactly one bridge
(`components/ChartPanel.tsx:3936` `const chart = engine.unwrap<IChartApi>();`). Line counts
of raw-call patterns inside the file (`grep -cF`, counts are matching lines):

| Pattern | Lines | | Pattern | Lines |
|---|---|---|---|---|
| `chart.addSeries` | 49 | | `removeSeries` | 14 |
| `.setData(` | 61 | | `.panes()` | 10 |
| `.applyOptions(` | 28 | | `setVisibleLogicalRange` | 9 |
| `.timeScale(` | 32 | | `getVisibleLogicalRange` | 10 |
| `.update(` | 6 | | `subscribeCrosshairMove` | 8 |
| `.priceScale(` | 15 | | `createSeriesMarkers` | 5 |
| `.createPriceLine(` | 15 | | `createTextWatermark` | 4 |
| `.getPane(` | 12 | | `fitContent` | 2 |
| `.takeScreenshot()` | 1 | | `engine.unwrap<IChartApi>()` | 1 |

`engine.` is otherwise used only for the ownership census
(`components/ChartPanel.tsx:3337` `engine.inventory()`) and teardown
(`components/ChartPanel.tsx:8567` `engineRef.current.destroy()`). Primitives attach through
the `attachSessionShading` wrapper (`lib/sessionShading.ts`), not raw `attachPrimitive`.

## 5. `// engine-unwrap:` inventory (budget 8, total 8)

`grep -rn 'engine-unwrap:' lib/chart-engine/ components/ChartPanel.tsx` → 8 occurrences:

- `lib/chart-engine/api.ts:176,188,196,212,238,268` — the six `unwrap<T>(): T;` handle
  declarations (PriceLine, Pane, PriceScale, TimeScale, Series, ChartEngine).
- `lib/chart-engine/api.ts:267` — prose in the unwrap doc comment that names the tag itself.
- `components/ChartPanel.tsx:3934` — the single P1 bridge comment above `engine.unwrap()`.

Live call sites: **1** (`ChartPanel.tsx:3936`). The budget counts raw tag text (comments
included) so prose cannot hide a real tag; P2 drives both numbers to zero before P3.

## 6. Existing chart-engine test coverage (`terminal/lib/__tests__/`)

Vitest collects only `lib/__tests__/**/*.test.ts(x)` (`terminal/vitest.config.ts`), so every
engine test lives there:

| Test | Lines | Guards |
|---|---|---|
| `lwcAdapter.test.ts` | 932 | contract semantics of the lwc adapter against a `vi.mock("lightweight-charts")` stand-in (mapping, laziness, disposal, census) |
| `subpaneAssign.test.ts` | 331 | pane-index clamp semantics (`getOrCreatePane`) |
| `surfaceContract.test.ts` | 786 | surface series contracts |
| `paneSyncLinkGroups.test.ts` | 452 | linked-pane CALENDAR-window sync |
| `paneSyncTimeAxis.test.ts` | 470 | time-axis conversion in sync |
| `paneSyncFocus.test.ts` / `paneSyncFrame.test.ts` | 174 / 113 | focus + frame sync |
| `heatSeries.test.ts` / `heatSeriesGeometry.test.ts` | 219 / 118 | custom heat series primitive |
| `axisZoom.test.ts` | 127 | pointer-anchored zoom math |
| `futureTime.test.ts` | 85 | synthetic future coordinates |
| `chartViewReset.test.ts` | 73 | named-view reset |
| `chartTimeAxis.test.ts` | 43 | axis tick/label formatting |
| `drawingPaneReadiness.test.ts` | 120 | drawing pane readiness gating |
| `indicatorPaneSeries.test.ts` | 29 | indicator pane series assignment |
| `chartEngineBoundary.test.ts` (new, G01) | — | the ratchet this doc accompanies |

Adjacent (consumer-level): `chartBus*.test.ts(x)`, `chartIndicatorCapabilities.test.ts`,
`chartObjectTree.test.tsx`, `chartOverlaysI18nKeys.test.ts`, `chartSettings*.test.ts`,
`chartSnapshotTables.test.ts`, `indicatorCanvasPaneClip.test.ts`, `markerTooltip*.test.ts`,
`primaryPriceSeriesScale.test.ts`, `squareMarkerBatchPlan.test.ts`, `useChartBus*.test.tsx`.

## 7. E2E chart specs (`terminal/e2e/`, Playwright, 145 specs total)

Chart/surface/rendering-relevant specs for parity work:

`chart-link-groups`, `chart-object-tree`, `chart-ownership-stress`,
`chart-quote-single-flight`, `chart-settings-ux`, `chart-view-reset`,
`cold-chart-optional-slice`, `crosshair-price-label`, `dislocation-chart-marks`,
`drawing-professional-editing`, `drawing-system`, `marker-tooltip`,
`mobile-chart-chrome`, `mobile-chart-hub-upgrade`, `mobile-chart-touch-upgrade`,
`options-surface-alignment`, `options-surface-geometry`, `options-surface-replay`,
`pane-sync-time-axis`, `replay-statusline-responsive`, `replay-temporal-authority`,
`embedded-terminal-bridge` (embed chart), plus the `discover-heatmap-*` surface trio.

## 8. How the boundary ratchet runs

```sh
cd terminal && VITEST_MAX_THREADS=3 npx vitest run lib/__tests__/chartEngineBoundary.test.ts
```

Six assertions: (a) contract-core existence, (a) no LWC import outside `lwc/` inside
`lib/chart-engine/`, (b) no NEW importer outside the engine (allowlist ratchet + stale-entry
check + `console.info` for files that went clean), (c) unwrap-tag budget, (d) ChartPanel
constructs via `createEngine`. It runs in plain Node (fs walk, no DOM) in ~15 ms and is part
of the normal vitest collection, so CI fails the moment coupling widens. To tighten after a
file migrates behind the contract: delete its entry from `LWC_IMPORT_ALLOWLIST` — the
stale-entry assertion names exactly what to remove (or `console.info` does, if the file
still exists but stopped importing).
