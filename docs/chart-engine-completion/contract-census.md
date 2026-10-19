# Contract census — Native Chart Engine P2 (C01)

Machine-readable companion: [`contract-census.json`](./contract-census.json).

| Field | Value |
|---|---|
| `base_sha` | `c923cc46d179dd92cb6e3bd6d10c03c9bac17c76` |
| ChartPanel | `terminal/components/ChartPanel.tsx` (9,978 lines) |
| Contract | `terminal/lib/chart-engine/api.ts` (274 lines) |
| Unwrap tags | 8 (`api.ts` handle declarations × 7 including the comment at `:267`; `ChartPanel.tsx:3934`) |

Every `raw_calls[]` line number was produced by a comment-stripped parse of the file at `BASE_SHA` (not guessed). ChartPanel live LWC method counts match the parent greps: `addSeries` 51 (parent 50 plus `applyFutureAxis` at `:753`), `timeScale()` 33, `createPriceLine` 18, `priceScale()` 15, `getPane` 12 live (parent 13 included a comment), `removeSeries` 9, `getHTMLElement` 6, `subscribeCrosshairMove` 5, `logicalToCoordinate` 4, `paneSize` 4, `getVisibleRange` 3, `data()` 3, `unsubscribeCrosshairMove` 3, `removePriceLine` 2, `fitContent` 2, `dataByIndex` 2, `takeScreenshot` / `swapPanes` / `setStretchFactor` / `getStretchFactor` / `coordinateToLogical` / `setAutoScale` / `unwrap` 1 each. `series.options()` 20. `setData` 66.

---

## Importers (16 files + comment-only `api.ts`)

| File | Class | Migration | Imported symbols |
|---|---|---|---|
| `terminal/components/ChartPanel.tsx` | main-chart | in-closure | `CandlestickSeries` `BarSeries` `LineSeries` `AreaSeries` `HistogramSeries` `BaselineSeries` `createSeriesMarkers` `ISeriesMarkersPluginApi` `createTextWatermark` `CrosshairMode` `ColorType` `LineStyle` `LineType` `MismatchDirection` `PriceScaleMode` `IChartApi` `ISeriesApi` `IPaneApi` `IPriceLine` |
| `terminal/components/ChartPane.tsx` | main-chart | in-closure | `IChartApi` (state + `onChartApi` to FrameBar / SettingsModal) |
| `terminal/components/ChartFrameBar.tsx` | main-chart | in-closure | `IChartApi` `PriceScaleMode` |
| `terminal/components/ChartSettingsModal.tsx` | main-chart | in-closure | `PriceScaleMode` `IChartApi` |
| `terminal/lib/paneSync.ts` | lib-helper | in-closure | `IChartApi` `ISeriesApi` `SeriesType` `Time` |
| `terminal/lib/drawingPaneReadiness.ts` | lib-helper | in-closure | `ISeriesApi` `ISeriesPrimitive` `SeriesType` |
| `terminal/lib/sessionShading.ts` | lib-helper | in-closure | `ISeriesPrimitive` `ISeriesApi` `SeriesType` `IPrimitivePaneView` `IPrimitivePaneRenderer` `PrimitivePaneViewZOrder` `IChartApi` `SeriesAttachedParameter` `Time` |
| `terminal/lib/chartTimeAxis.ts` | lib-helper | in-closure | `TickMarkType` `Time` |
| `terminal/components/TideChartLazy.tsx` | options-suite | excluded-until-owner-changes | `createChart` `LineSeries` `AreaSeries` `IChartApi` `ISeriesApi` |
| `terminal/components/surface/SurfacePane.tsx` | options-suite | excluded-until-owner-changes | `createChart` `CandlestickSeries` `IChartApi` `ISeriesApi` `MouseEventParams` `Time` |
| `terminal/components/surface/StrikeEvolutionModal.tsx` | options-suite | excluded-until-owner-changes | `createChart` `LineSeries` `createSeriesMarkers` `IChartApi` `ISeriesApi` `Time` |
| `terminal/components/surface/SessionFlowPane.tsx` | options-suite | excluded-until-owner-changes | `createChart` `LineSeries` `AreaSeries` `IChartApi` `ISeriesApi` `Time` |
| `terminal/lib/heatSeries.ts` | options-suite | excluded-until-owner-changes | custom-series types + `customSeriesDefaultOptions` |
| `terminal/lib/surfaceContract.ts` | options-suite | excluded-until-owner-changes | `Time` (type-only) |
| `terminal/app/embed/chart/EmbedChart.tsx` | standalone-embed | excluded-until-owner-changes | `createChart` `CandlestickSeries` `HistogramSeries` `LineSeries` `CrosshairMode` `ColorType` `LineStyle` `IChartApi` `ISeriesApi` `MouseEventParams` `Time` |
| `terminal/lib/chart-engine/lwc/index.ts` | lib-helper | excluded-until-owner-changes | adapter import set (must keep LWC) |

`terminal/lib/chart-engine/api.ts` mentions `"lightweight-charts"` only in comments (`:5`). It is not an importer (law 1).

---

## C01-A01 — methods the contract must add before migration

These are in-closure call sites whose LWC method has **no** equivalent on `api.ts` at `BASE_SHA`. Covered methods (`addSeries`, `setData`, `update`, `createPriceLine`, `timeScale()`, `getVisibleLogicalRange`, `subscribeCrosshairMove`, `takeScreenshot`, `resize`, `panes`, `paneSize`, `swapPanes`, `fitContent`, `priceToCoordinate`, …) stay on the existing handles; ChartPanel still reaches them through `engine.unwrap<IChartApi>()` (`ChartPanel.tsx:3936`).

`chartElement()` is **not** in this list: zero matches under `terminal/` at `BASE_SHA`. See C01-A03.

| Handle | Method | Signature | In-closure consumers (file:line) | Clusters |
|---|---|---|---|---|
| `ChartEngine` | `setCrosshairPosition` | `(price: number, time: EngineTime, series: SeriesHandle): void` | `paneSync.ts:110,:413` | S-sync |
| `ChartEngine` | `clearCrosshairPosition` | `(): void` | `paneSync.ts:109,:124,:140` | S-sync |
| `ChartEngine` | `options` | `(): EngineOptions` | `ChartPanel.tsx:3767,:4550` | I-interaction, X-other |
| `TimeScaleHandle` | `getVisibleRange` | `(): EngineRange<EngineTime> \| null` | `ChartPanel.tsx:639`; `paneSync.ts:530` | S-sync, X-other |
| `TimeScaleHandle` | `setVisibleRange` | `(range: EngineRange<EngineTime>): void` | `ChartFrameBar.tsx:181,:387` | I-interaction |
| `TimeScaleHandle` | `logicalToCoordinate` | `(logical: number): number \| null` | `ChartPanel.tsx:4646,:6631,:6934,:7036` | D-drawings, M02-studies |
| `TimeScaleHandle` | `coordinateToLogical` | `(x: number): number \| null` | `ChartPanel.tsx:5126`; `ChartFrameBar.tsx:381` | D-drawings, I-interaction |
| `TimeScaleHandle` | `width` | `(): number` | `ChartPanel.tsx:3319,:6978` | I-interaction, M02-studies |
| `TimeScaleHandle` | `options` | `(): Record<string, unknown>` | `ChartPanel.tsx:3766` (`__mmChartAxisOpts`) | X-other |
| `TimeScaleHandle` | `timeToIndex` | `(time: EngineTime, findNearest?: boolean): number \| null` | `paneSync.ts:397,:490,:491` | S-sync |
| `SeriesHandle` | `options` | `(): EngineSeriesOptions` | `ChartPanel.tsx:568,:2241×2,:3734,:3746,:4587,:4588,:7329,:9024,:9025` | I-interaction, M01, S-sync, X-other |
| `SeriesHandle` | `data` | `(): EngineSeriesRow[]` | `ChartPanel.tsx:3774,:3775,:3874` | X-other |
| `SeriesHandle` | `dataByIndex` | `(logicalIndex: number, mismatch?: "nearest-left" \| "nearest-right" \| "none"): EngineSeriesRow \| null` | `ChartPanel.tsx:4204,:9027`; `paneSync.ts:487,:488,:502` | I-interaction, S-sync |
| `SeriesHandle` | `priceScale` | `(): PriceScaleHandle` | `ChartPanel.tsx:3781,:3782,:4198,:7042,:7301`; `drawingPaneReadiness.ts:7,:19` | D-drawings, I-interaction, X-other |
| `SeriesHandle` | `priceLines` | `(): PriceLineHandle[]` | `ChartPanel.tsx:3358` | X-other |
| `SeriesHandle` | `barsInLogicalRange` | `(range: EngineLogicalRange): { from: EngineTime; to: EngineTime } \| null` | `sessionShading.ts:88` | M03-decorations |
| `PriceScaleHandle` | `options` | `(): Record<string, unknown>` | `ChartPanel.tsx:3761,:3765,:3768,:3782,:4198,:7042,:7303` | D-drawings, I-interaction, X-other |
| `PriceScaleHandle` | `getVisibleRange` | `(): EngineRange<number> \| null` | `ChartPanel.tsx:3781,:7324`; `drawingPaneReadiness.ts:7,:19` | D-drawings, I-interaction, X-other |
| `PriceScaleHandle` | `setVisibleRange` | `(range: EngineRange<number>): void` | `ChartPanel.tsx:7358` (axis-wheel zoom) | I-interaction |
| `PriceScaleHandle` | `setAutoScale` | `(on: boolean): void` | `ChartPanel.tsx:7371`; `ChartFrameBar.tsx:478`; `ChartSettingsModal.tsx:367` | I-interaction |
| `PaneHandle` | `getSeries` | `(): SeriesHandle[]` | `ChartPanel.tsx:4662,:7291,:9021` | D-drawings, I-interaction, S-sync |
| `PaneHandle` | `priceScale` | `(priceScaleId: string): PriceScaleHandle` | `ChartPanel.tsx:2232,:3765,:7293` | M01-mount, I-interaction, X-other |
| `WatermarkHandle` | `applyOptions` | `(opts: Partial<WatermarkSpec>): void` | `ChartPanel.tsx:9726` (Effect 7 visibility/color) | M03-decorations |
| `MarkersHandle` | `detach` | `(): void` | `ChartPanel.tsx:1406,:1546,:2071,:2448,:2449,:3019,:8560,:9131,:9132,:9303` | M03-decorations |

Semantic notes the parent must pin in `api.ts`:

- **Calendar vs logical.** `getVisibleRange` / `setVisibleRange` on `TimeScaleHandle` are the time-domain window (pane-sync law: mirror a CALENDAR window). They are distinct from the already-shipped `getVisibleLogicalRange` / `setVisibleLogicalRange`.
- **`setCrosshairPosition` does not fire `subscribeCrosshairMove`.** `paneSync.ts:19–21` documents this; ChartPanel feeds the DOM hover tag through `registerPane({ onCrosshair })` (`ChartPanel.tsx:9012–9044`).
- **`MismatchDirection`.** Replace with the string union `"nearest-left" | "nearest-right" | "none"`. ChartPanel uses `MismatchDirection.NearestRight` at `:4204`; `paneSync.ts` inlines `NEAREST_LEFT = -1` / `NEAREST_RIGHT = 1` at `:41–42` so it can stay type-only on LWC.
- **Watermark.** `ChartEngine.setWatermark` already exists (`api.ts:263`) and *replaces*. Effect 7 mutates the plugin in place (`:9726`). Adding `WatermarkHandle.applyOptions` avoids a flash; alternatively Effect 7 can re-call `setWatermark` if the adapter’s replace is proven flicker-free.
- **Markers.** `SeriesHandle.setMarkers` already exists (`api.ts:222`). ChartPanel still calls `createSeriesMarkers` + `plugin.detach()` because it keeps plugin refs (`macdMarkersRef`, `ttmsqMarkersRef`, `episodeMarkersRef`, `pineMarkersRef`). `clearAllIndicators` (`:2448`) detaches **before** `removeSeries`. `SeriesHandle.remove()` already detaches internally in the adapter; an explicit `MarkersHandle.detach` is still required when the host series survives.

Adapter already maps `TimeScaleHandle.scrollToRealtime()` → LWC `scrollToRealTime` (`api.ts:207–209`). `ChartFrameBar.tsx:163` is therefore **covered**.

---

## C01-A02 — typed unsupported-option policy

Today `EngineOptions` (`api.ts:113–127`) and `EngineSeriesOptions` (`api.ts:47–53`) are open bags (`Record<string, unknown>` plus an index signature on `EngineOptions`). `PriceLineSpec` (`api.ts:105`) is the same. The comment at `api.ts:47–53` calls this “the documented `any` idiom for the P0 pass-through boundary”: the LWC adapter forwards unknown keys verbatim (`SeriesPartialOptionsMap` cast in `lwc/index.ts`).

That is silent loss the moment a second renderer (`canvas/`) does not implement a native option ChartPanel thinks it set (`tickMarkDensity`, `attributionLogo`, `pointMarkersRadius`, `autoscaleInfoProvider`, `kineticScroll.mouse`, …).

**Proposal (binding for P2 contract work):**

1. **Known keys are named fields** on `EngineOptions` / per-kind series options / `PriceLineSpec`, typed structurally (no LWC imports). The census of keys ChartPanel actually writes is the initial closed set (createEngine bag at `ChartPanel.tsx:3915–3932`; Effect 7 at `:9663–9718`; series bags in `addPriceSeries` `:1275–1306` and the indicator builders).
2. **Unknown keys are a typed refusal**, never dropped:
   ```ts
   type UnsupportedOption = { ok: false; reason: "unsupported-option"; handle: string; key: string };
   type ApplyResult = { ok: true } | UnsupportedOption;
   ```
   `applyOptions` / `addSeries` / `createPriceLine` / `setWatermark` return `ApplyResult` (or throw a branded `UnsupportedOptionError` with the same shape). Dev/e2e already read `__mmChartAxisOpts` (`ChartPanel.tsx:3758`); a refusal must be observable there.
3. **The LWC adapter may still forward a *known* key 1:1.** It must not `as any` an unknown key into LWC. An unknown key is a contract bug, not a renderer detail.
4. **Read-back (`options()`) returns the owned subset.** Extra native fields the renderer happens to have are not re-exported; that would recouple consumers to LWC.
5. **No silent defaulting that changes meaning.** Filling `fontFamily`/`fontStyle` on a watermark line is already documented (`api.ts:84–85`) and stays; inventing a color, a scale mode, or dropping `tickMarkDensity` is refusal.

This is the P0 `any` pass-through being retired, not a new option DSL.

---

## C01-A03 — deliberately not added (no in-closure consumer)

Grep of `terminal/**/*.{ts,tsx}` at `BASE_SHA`, excluding tests. If a later consumer appears, it joins C01-A01 rather than being used through `unwrap()`.

| LWC API | Why it stays off the contract |
|---|---|
| `IChartApi.chartElement()` | Zero matches under `terminal/`. ChartPanel positions overlays on `wrapElRef` / pane `getHTMLElement()` (`:2206`). |
| `IChartApi.subscribeClick` / `unsubscribeClick` / `subscribeDblClick` / `unsubscribeDblClick` | Already on `ChartEngine` (`api.ts:255–258`). ChartPanel does **not** call them; pane dblclick is a DOM listener on `wrapEl` (`:8508`). Keep the methods (cheap, already tested) but do not expand them. |
| `TimeScaleHandle.scrollToPosition` / `scrollToRealtime` | Already on the contract. ChartPanel never calls them; FrameBar uses `scrollToRealTime` (`:163`) which the adapter already bridges. |
| `ISeriesApi.barsInLogicalRange` extras (`barsBefore` / `barsAfter`) | sessionShading (`:88`) only reads the returned `from`/`to` times. Do not ship the full LWC `BarsInfo` object. |
| `IChartApi.takeScreenshot(filter)` overlay filter | ChartPanel calls `takeScreenshot()` with no args (`:3464`). Keep the zero-arg sync `HTMLCanvasElement` law. |
| Custom series (`ICustomSeriesPaneView`, `customSeriesDefaultOptions`) | Only `heatSeries.ts` (options-suite, C01-A04). The six first-class kinds stay candles/bars/line/area/histogram/baseline. |
| `ISeriesApi.setMarkers` (legacy v4) | Unused. Markers are the v5 plugin; the contract’s `SeriesHandle.setMarkers` is the owned replacement. |
| `ITimeScaleApi.timeToIndex` `exact` mismatch beyond boolean `findNearest` | paneSync passes `false` (`:397,:490,:491`). Boolean is enough. |
| `IPriceLine.options()` | No consumer. Writes go through `applyOptions` (`ChartPanel.tsx:2435`). |
| `IPaneApi.setSeparatorColor` / `setHeight` (beyond `stretchFactor`) | `setHeight`/`height` already on `PaneHandle`. Separator color is set via `layout.panes` in createEngine / Effect 7, not per-pane. |
| Magnet/crosshair *mode enum objects* | Replace with string unions (see enum table). Do not re-export `CrosshairMode`. |

---

## C01-A04 — Options-suite / standalone stay outside the migration closure

The P2 unwrap-to-zero programme is the **main chart** (`ChartPanel` + the helpers it wires + the chrome that receives `onChartApi`). These importers keep `createChart` / LWC types until their owning lane migrates them:

| File | Owner reason |
|---|---|
| `TideChartLazy.tsx` | Only LWC consumer in the options hub; lazy-loaded so the ~130 KB chunk stays off the tape critical path (`TideChartLazy.tsx:6–11`). |
| `surface/SurfacePane.tsx` | Options surface; own `createChart` + `setCrosshairPosition` (`:1038`). |
| `surface/StrikeEvolutionModal.tsx` | Options strike-evolution; own `createChart` + `createSeriesMarkers`. |
| `surface/SessionFlowPane.tsx` | Options session-flow; own `createChart`. |
| `heatSeries.ts` | Custom-series heatmap for the options surface. Not one of the six first-class kinds. |
| `surfaceContract.ts` | Type-only `Time` import. |
| `app/embed/chart/EmbedChart.tsx` | Isolated `/embed/chart` iframe; must not pull AppShell / ChartPanel (`EmbedChart.tsx:7–10`). |
| `lib/chart-engine/lwc/index.ts` | The adapter. It is the one module *allowed* to import `lightweight-charts`. |

After M01, `ChartPane.tsx:48` (`useState<IChartApi>`) and Effect 8 (`ChartPanel.tsx:9804`) still publish a raw `IChartApi` into FrameBar / SettingsModal. Those two files are **in-closure** (they are how the main chart is operated) even though they currently type against LWC. Their `IChartApi` prop becomes `ChartEngine` (or a small facade) as part of M01, not a later options-suite lane.

---

## Enum uses

| Enum | Members used at BASE_SHA | Replacement |
|---|---|---|
| `CrosshairMode` | `Normal` (`ChartPanel.tsx:3920,:9706`), `Magnet` (`:9706`) | string-union `"normal" \| "magnet"` on `EngineOptions.crosshair.mode` |
| `ColorType` | `Solid` (`:9686`), `VerticalGradient` (`:9685`) | string-union `"solid" \| "vertical-gradient"` |
| `LineStyle` | `Dotted` (`:1124`) | contract constant (price-line `lineStyle` is already a number in several builders; pick one representation and refuse the other) |
| `LineType` | `WithSteps` (`:1286`, step chart type) | string-union `"simple" \| "with-steps"` |
| `MismatchDirection` | `NearestRight` (`:4204`) | string-union `"nearest-left" \| "nearest-right" \| "none"` |
| `PriceScaleMode` | `Normal` `:4198`, `Percentage` `:4211`, `IndexedTo100` `:4211`, `Logarithmic` `:7328,:7359`; also the `ChartSettings.mode` field (`ChartFrameBar.tsx:12`) | string-union `"normal" \| "log" \| "percent" \| "indexed100"` (matches `PriceScaleState.mode` in the programme vocabulary) |
| `TickMarkType` | `DayOfMonth` `Time` `TimeWithSeconds` (`chartTimeAxis.ts:36,:48,:55`) | string-union on the tick-formatter callback; `chartTimeAxis.ts` stays in-closure and must stop importing LWC |

---

## Already covered (still raw via unwrap)

ChartPanel reaches these through `const chart = engine.unwrap<IChartApi>()` (`:3936`). Replacing the receiver is mechanical once M01 drops `chartRef`.

| Raw call | Owned replacement | ChartPanel frequency (live) |
|---|---|---|
| `chart.addSeries(Ctor, opts, pane?)` | `ChartEngine.addSeries(kind, opts, pane?)` | 51 |
| `series.setData(rows)` | `SeriesHandle.setData` | 66 |
| `chart.timeScale()` | `ChartEngine.timeScale()` | 33 |
| `*.applyOptions` | per-handle `applyOptions` | 27 |
| `series.createPriceLine` | `SeriesHandle.createPriceLine` | 18 |
| `chart.priceScale(id)` | `ChartEngine.priceScale(id)` | 15 (plus series/pane overloads in A01) |
| `series.priceToCoordinate` / `coordinateToPrice` | `SeriesHandle.*` | 15 / 7 |
| `series.getPane()` | `SeriesHandle.pane()` | 12 |
| `chart.removeSeries(s)` | `SeriesHandle.remove()` | 9 |
| `chart.panes()` | `ChartEngine.panes()` | 9 |
| `pane.paneIndex()` | `PaneHandle.index()` | 9 |
| `timeScale.get/setVisibleLogicalRange` | already on handle | 9 / 8 |
| `pane.getHTMLElement()` | `PaneHandle.getHTMLElement()` | 6 |
| `subscribe/unsubscribeCrosshairMove` | `ChartEngine.*` | 5 / 3 |
| `createSeriesMarkers` | `SeriesHandle.setMarkers` (semantic) | 4 |
| `chart.paneSize` | `ChartEngine.paneSize` | 4 |
| `series.update` | `SeriesHandle.update` | 2 (`:3189`, `:3278`) |
| `takeScreenshot` / `swapPanes` / `resize` / `fitContent` / stretch | already on handles | 1–2 |
| `createTextWatermark` | `ChartEngine.setWatermark` (semantic) | 1 (`:3948`) |
| `engine.unwrap` | dies with the last cluster | 1 (`:3936`) |

`engine.inventory()` (`:3337`) and `engine.destroy()` (`:8567`) are contract methods, not raw LWC, and are omitted from `raw_calls`.

---

## How to read `contract-census.json`

- `importers[]` — one row per non-test importer (file-granularity symbols + class + migration).
- `raw_calls[]` — every live ChartPanel LWC method / factory / enum member, plus the in-closure satellites (`paneSync`, `ChartFrameBar`, `ChartSettingsModal`, `drawingPaneReadiness`, `chartTimeAxis`, `sessionShading`). `contract_status` is `covered` or `needs_method`.
- `proposed_contract_additions[]` — the C01-A01 set, with consumer counts and clusters.
- `exclusions[]` — C01-A04 plus `api.ts` (comments only) and the adapter.
- `enum_uses[]` — C01 enum table.
