# ChartPanel migration seams (M01 / M02 / M03)

Parent-owned file: `terminal/components/ChartPanel.tsx` (9,978 lines at `c923cc46d179dd92cb6e3bd6d10c03c9bac17c76`). This lane does not edit it. Every range below is a seam the parent applies top-down.

Companion census: [`contract-census.json`](./contract-census.json) / [`contract-census.md`](./contract-census.md). Add the C01-A01 methods (and the C01-A02 refusal policy) **before** any seam; otherwise the first `unwrap` deletion will not typecheck.

---

## Integration recipe (top-down)

1. **Land C01-A01 on `api.ts` + `lwc/` adapter** (parent-owned `lib/chart-engine/index.ts`). Include `setCrosshairPosition` / `clearCrosshairPosition` even though ChartPanel never calls them — `paneSync.ts` does, and ChartPanel registers with it.
2. **M01 — mount / teardown / primary price series / StrictMode.** Replace `engine.unwrap<IChartApi>()` (`:3936`) with `engineRef` as the only renderer handle. Retype `addPriceSeries` to take `ChartEngine`. Keep Effect 1’s empty-deps `engine.destroy()` teardown (`:8567`) as the double-mount safety.
3. **Repoint Effect 8** (`:9802–9807`) so `ChartPane` / `ChartFrameBar` / `ChartSettingsModal` receive `ChartEngine` (or a small facade), not `IChartApi`. FrameBar’s `setVisibleRange` / `setAutoScale` are C01-A01 methods; they unblock this step.
4. **Retype `paneSync.registerPane` and `drawingPaneReadiness`** onto owned handles (parent-owned `paneSync.ts`). ChartPanel’s `reRegisterSync` (`:8992`) then passes `engine` + `priceSeries` without unwrap.
5. **M03 — decorations that attach to the price series** (watermark, price lines, markers, screenshot, session shading). They need a live `SeriesHandle` from M01 and must detach-before-remove.
6. **M02 — studies / compare / live in-place updates.** Largest seam. Preserve the one-live-bar → one-generation law (`commitLiveBarGeneration` `:3134`). The `seriesReuseChart` facade (`:3077`) must wrap `ChartEngine.addSeries`, not `IChartApi.addSeries`.
7. **Pine (P) rides with M02** (`addPinePlot` `:1476`, Effect 3c `:9436`). Episode markers (`:9301`) ride with M03.
8. **Drive `unwrap()` to zero.** Grep `engine-unwrap:` must be empty in ChartPanel before P3.

Do not start M02 while `chartRef: IChartApi` is still the handle studies close over: every builder takes `chart: IChartApi` today (`buildEma` `:1322` through `buildCvd` `:2116`). M01 changing that argument is what makes M02 mechanical.

---

## Refs that must change type

| Ref / binding | Today (`ChartPanel.tsx`) | After unwrap dies |
|---|---|---|
| `engineRef` | `useRef<ChartEngine \| null>` `:635` | unchanged — becomes the only renderer handle |
| `chartRef` | `useRef<IChartApi \| null>` `:636` | **delete**. Every `chartRef.current` becomes `engineRef.current` |
| `priceSeriesRef` | `ISeriesApi<any>` `:645` | `SeriesHandle` |
| `priceFamilyRef` | `string \| null` `:646` | unchanged |
| `indSeriesRef` | `Map<string, ISeriesApi<any>[]>` `:647` | `Map<string, SeriesHandle[]>` |
| `cmpSeriesRef` | `Map<string, ISeriesApi<any>>` `:648` | `Map<string, SeriesHandle>` |
| `futureAxisRef` | `ISeriesApi<any>` `:740` | `SeriesHandle` |
| `pineSeriesRef` | `Map<string, ISeriesApi<any>[]>` `:651` | `Map<string, SeriesHandle[]>` |
| `pineMarkersRef` | `Map<string, ISeriesMarkersPluginApi<any>>` `:652` | drop if `SeriesHandle.setMarkers`; else `MarkersHandle` |
| `ttmsqMarkersRef` / `macdMarkersRef` / `episodeMarkersRef` | `ISeriesMarkersPluginApi` `:653–655` | same as pine markers |
| `watermarkPluginRef` | `{ applyOptions }` `:1049` | `WatermarkHandle` (C01-A01) or drop if Effect 7 re-calls `setWatermark` |
| `indPriceLinesRef` | `Map<string, IPriceLine[]>` `:1081` | `Map<string, PriceLineHandle[]>` |
| `extendedPriceLineRef` | `IPriceLine` `:1082` | `PriceLineHandle` |
| `panesMeta.current[].pane` | `IPaneApi` (see `:2342`, `:7203`) | `PaneHandle` |
| `shadingPrimRef` | `SessionShadingPrimitive` `:1134` | stays a primitive; `attachPrimitive` already on `SeriesHandle` |
| `ChartPane` `chartApi` state | `useState<IChartApi \| null>` (`ChartPane.tsx:48`) | `ChartEngine \| null` |
| `ChartFrameBar` / `ChartSettingsModal` `chartApi` prop | `IChartApi` | `ChartEngine` |

`visualPanelRef` (`:625`) is **not** LWC. Its `.update` (`:2883`) must not be rewritten as `SeriesHandle.update`.

---

## M01 — mount / teardown / primary price series / StrictMode

### Line ranges

| Region | Lines | Role |
|---|---|---|
| `futureAxisRef` + `applyFutureAxis` | `:740–764` | Whitespace series that creates labelled future slots (`chartApi.addSeries(LineSeries, …)` `:753`, `setData` `:763`) |
| `addPriceSeries` | `:1275–1306` | Six-kind primary series factory. Takes `chart: IChartApi`. Uses `LineType.WithSteps` `:1286` |
| Pane stretch / maximize / tick density | `:2154–2234` | `m.pane.setStretchFactor` `:2188`, `m.pane.getHTMLElement` `:2206`, `p.priceScale("right").applyOptions({ tickMarkDensity })` `:2232`, `getStretchFactor` `:2237` |
| Pane move | `:2406` | `ch.panes().length`, `ch.swapPanes` |
| Effect 1 (empty deps) | `:3402–8580` | **The** mount. `createEngine` `:3915`, unwrap `:3936`, `chartRef.current = chart` `:3937` |
| createEngine options | `:3915–3932` | `CrosshairMode.Normal` `:3920`; `chartTimeAxisOptions` `:3928`; `kineticScroll` `:3931` |
| ResizeObserver | `:8454–8474` | `getVisibleLogicalRange` → `resize` → `setVisibleLogicalRange` (preserve window across box changes) |
| Mount teardown | `:8476–8579` | `unsubscribeCrosshairMove` `:8480–8481`; `engine.destroy()` `:8567`; `chartRef = null` `:8568`; `__mmChartOwnershipFinal` after destroy `:8576` |
| Effect 2 price-series (re)build | `:8916–8932` | `removeSeries` + `addPriceSeries` on family change; else `applyOptions` + `setData` |
| Effect 5 token/color restyle | `:9594–9644` | `chart.applyOptions` + per-kind `priceS.applyOptions` |
| Effect 7 settings | `:9655–9784` | `chart.applyOptions` `:9664,:9687`; `chart.priceScale(scaleId).applyOptions` `:9679`; `priceS.applyOptions` `:9768`; `priceS.setData` `:9770`. Watermark half is M03. |
| Effect 8 publish API | `:9802–9807` | `onChartApi(chartRef.current)` — parent of FrameBar/Settings |
| StrictMode note | `ChartPane.tsx:71–73` | Effect replay in dev. ChartPanel Effect 1 empty deps + `destroy` in the cleanup is the double-mount safety |

### Raw calls inside M01 (owned replacement)

| Call | Site | Replacement |
|---|---|---|
| `createEngine(el, EngineOptions)` | `:3915` | already owned |
| `engine.unwrap<IChartApi>()` | `:3936` | **delete** — this is the P1 bridge (`// engine-unwrap:` `:3934`) |
| `chart.addSeries(Ctor, opts, 0)` | `addPriceSeries` `:1284–1295`; `applyFutureAxis` `:753` | `engine.addSeries("line"\|"area"\|"baseline"\|"bars"\|"candles", opts, 0)` |
| `chart.removeSeries(priceS)` | `:8920` | `priceS.remove()` |
| `chart.applyOptions(...)` | `:8710,:8786,:9599,:9664,:9687` | `engine.applyOptions` |
| `chart.priceScale(id).applyOptions` | `:9679` | `engine.priceScale(id).applyOptions` |
| `chart.timeScale().get/setVisibleLogicalRange` | ResizeObserver `:8468,:8470`; Effect 7 does not touch logical range | `engine.timeScale().get/setVisibleLogicalRange` |
| `chart.resize(w, h)` | `:8469` | `engine.resize` |
| `chart.panes()` / `swapPanes` / `setStretchFactor` / `getHTMLElement` | `:2188–2406,:7200` | `engine.panes()` / `PaneHandle.*` |
| `chart.unsubscribeCrosshairMove` | teardown `:8480–8481` | `engine.unsubscribeCrosshairMove` |
| `engine.destroy()` | `:8567` | already owned; must remain the **one** disposal. Double destroy is a no-op (law). |
| `CrosshairMode.Normal` | `:3920` | `"normal"` string-union (C01 enum table) |
| `LineType.WithSteps` | `:1286` | `"with-steps"` |

### StrictMode double-mount

Effect 1 has `[]` deps (`:8580`). React 18 StrictMode runs mount → cleanup → mount in dev. The cleanup at `:8476` calls `engine.destroy()` and nulls `engineRef` / `chartRef` / every series ref. The second mount calls `createEngine` again. An “ignore the first effect” ref would be wrong here the same way it is wrong for settings persistence (`ChartPane.tsx:71–73`): the first cleanup must actually destroy, or the second `createEngine` leaves two canvases in `el`.

`inventory()` after destroy answers `{ alive: false, zeros }` (`api.ts:151–152`). The teardown receipt `__mmChartOwnershipFinal` (`:8576`) is the e2e witness.

### M01 risks

- Leaving `chartRef` as a shadow of `engine.unwrap()` undoes the seam. Delete the ref in the same patch that deletes `:3936`.
- `applyFutureAxis` closes over `chartRef` (`:742`). After M01 it must close over `engineRef`.
- Effect 2 (`:8586`) starts `const chart = chartRef.current; if (!chart) return;`. That guard becomes `engineRef.current`.
- `addPriceSeries` currently receives the unwrapped `IChartApi` so `LineSeries` constructors typecheck. After M01 it receives `ChartEngine` and a kind string; the six `if (chartType === …)` branches (`:1284–1295`) map onto `EngineSeriesKind`.

---

## M02 — studies / indicators / compare / live updates

### Line ranges

| Region | Lines | Role |
|---|---|---|
| Indicator builders | `:1322–2131` | `buildEma` … `buildCvd`. Each takes `chart: IChartApi` and returns `ISeriesApi[]`. Nested M03: MACD markers `:1405`, TTM squeeze markers `:2081`, RSI/stoch/ADX/accum price lines |
| Pine plots | `:1476–1580` | `addPinePlot` `:1476`, `buildPineScript` `:1498`, `clearAllPine` `:1544` (`removeSeries` loop `:1553`), `paintPineFromCache` `:1560`, `buildAllPine` `:1580` |
| `clearAllIndicators` | `:2445–2455` | Detach marker plugins `:2448–2449` **then** `removeSeries` `:2450` |
| `buildSuitePane` | `:2461–2475` | Transparent range-anchor `addSeries(LineSeries)` `:2464` + guide `createPriceLine` `:2472` |
| `buildAllIndicators` | `:2477–2536` | Full rebuild in canonical order onto `rows` |
| `updateAllIndicators` | `:2538–2583` | In-place `setData` only — no add/remove (live-bar law) |
| `rebuildCompare` | `:2635–2676` | Async; `cmpGenRef` supersession. `addSeries` + `setData` for each compare symbol |
| `runStudyInPlace` | `:3074–3114` | Re-runs a builder against `seriesReuseChart(chart, owned, key)` so `addSeries` returns the already-owned series |
| `refreshLiveStudies` | `:3116–3122` | One pass over `LIVE_REBUILD_KEYS` + pane suites |
| `commitLiveBarGeneration` | `:3134–3165` | **The** live-bar boundary. One accepted bar → one generation |
| `applyIntradayLiveCandle` | `:3167–3227` | `priceS.update(...)` `:3189` then `commitLiveBarGeneration` |
| `applyLiveSplice` | `:3229–3301` | Daily/resampled path; `priceS.update` `:3278` |
| `schedulePineLiveRerun` | `:3303–3314` | Off-thread; dropped by `pineEpochRef` |
| Effect 2 | `:8585–8988` | Fetch + price series + indicators + `reRegisterSync` tail `:8974` |
| Effect 3 indicator topology | `:9062–9183` | Incremental sub-pane edits vs full rebuild |
| Effect 3b params | `:9228–9262` | Rebuild on `indParams` |
| Effect 3c pine | `:9436–9453` | Add/remove/param-edit a script without touching the price series |
| Volume refresh | `:9786–9793` | `volume.setData(volData(...))` |

### Raw calls inside M02

| Call | Typical site | Replacement |
|---|---|---|
| `chart.addSeries(LineSeries\|HistogramSeries\|…, opts, pane)` | builders `:1325` onward; 40 M02 hits | `engine.addSeries(kind, opts, paneIndex)` |
| `series.setData(rows)` | 57 M02 hits; `updateAllIndicators` | `SeriesHandle.setData` |
| `chart.removeSeries(s)` | `clearAllIndicators` `:2450`; `clearAllPine` `:1553`; Effect 3 topology | `SeriesHandle.remove()` |
| `series.applyOptions({ visible })` | `applyHidden` `:2423,:2439,:2441` | `SeriesHandle.applyOptions` |
| `series.getPane().paneIndex()` | live pane identity `:9203`, `:2342` | `SeriesHandle.paneIndex()` / `SeriesHandle.pane().index()` |
| `chart.priceScale("volume").applyOptions` | `buildVol` `:1363` | `engine.priceScale("volume").applyOptions` |
| `chart.timeScale().get/setVisibleLogicalRange` | preserve-view on indicator toggle `:9067,:9177,:9231,:9236,:9249,:9260,:9439,:9451` | already on `TimeScaleHandle` |
| `timeScale.logicalToCoordinate` | suite SVG `xi` `:6631,:6934` | **C01-A01** `TimeScaleHandle.logicalToCoordinate` |
| `timeScale.width()` | `:6978` | **C01-A01** `TimeScaleHandle.width` |
| `priceS.update(bar)` | `:3189,:3278` | `SeriesHandle.update` — in-place, never recreate the series per tick (law) |

### `seriesReuseChart` (live in-place)

`runStudyInPlace` (`:3074`) builds a facade whose `addSeries()` hands back the series that `indSeriesRef` already owns (`:3077`). After M01 that facade must implement the **owned** `addSeries(kind, opts, pane)` shape (or wrap `ChartEngine`), not `IChartApi.addSeries(Ctor, …)`. If the facade still speaks LWC constructors, M02 cannot compile once `lightweight-charts` is removed from ChartPanel.

`updateAllIndicators` (`:2538`) is the other live path: `setData` on existing handles, no add/remove. Both paths must remain; splitting them re-creates the stale-bar bug the live-bar boundary exists to close (`:3124–3133`).

### M02 risks

- **Shared `priceSeriesRef`.** M01 creates it, M02 paints it (`:8928`), M03 puts price lines / markers / shading on it, `reRegisterSync` (`:9004`) registers it, Effect 7 restyles it. A seam that nulls it without the others agreeing orphans decorations.
- **Pane collapse auto-remove.** Comment at `:3066`: emptying a pane auto-removes it and slides higher panes down. In-place study refresh must not `setData([])` a sub-pane series.
- **`cmpGenRef` supersession** (`:825`, `:2635`). An async compare fetch must still drop stale generations after the handle type change.
- **Preserve-view on indicator toggle** (`PRESERVE_VIEW_ON_INDICATOR_TOGGLE`, `:9067`). Reads/writes logical range, not calendar range. That is local to one pane’s bar set and is allowed; pane-*sync* still uses calendar `getVisibleRange` (C01-A01).
- Markers created inside builders (MACD `:1412`, TTM `:2081`, pine `:1532`) are M03 call sites living in M02 functions. Migrating M02 without M03 means those builders still import `createSeriesMarkers`. Prefer M03’s marker helper to be callable from M02 builders (one `setMarkers` wrapper) so M02 does not re-import LWC.

---

## M03 — markers, watermark, price lines, crosshair series map, screenshot

### Line ranges

| Region | Lines | Role |
|---|---|---|
| `pushIndPriceLine` / `removeIndPriceLines` / `clearExtendedPriceLine` / `applyExtendedPriceLine` | `:1083–1132` | Price-line pool on the **price** series. `removePriceLine` `:1093,:1101`; `createPriceLine` `:1120` (`LineStyle.Dotted` `:1124`) |
| MACD markers | `:1405–1412` | `macdMarkersRef.detach` `:1406`; `createSeriesMarkers` `:1412` |
| Pine markers | `:1532` | `createSeriesMarkers(anchor, markers)` |
| TTM squeeze markers | `:2071–2081` | detach then `createSeriesMarkers(histS, markers)` |
| `clearAllIndicators` marker detach | `:2448–2449` | **before** `removeSeries` |
| Snapshot / screenshot | `:3413–3464` | `chartRef.current!.takeScreenshot()` `:3464` — sync `HTMLCanvasElement` (law) |
| Watermark create | `:3938–3977` | `chart.panes()[0]` + `createTextWatermark(pane, spec)` `:3948`; stored on `watermarkPluginRef` |
| Crosshair series map (magnet) | `:4573–4611` | `p.seriesData` as `Map<ISeriesApi, datum>` `:4583–4585`; `candidate.options()` `:4587`; `subscribeCrosshairMove(onTagCrosshair)` `:4611` |
| Visual crosshair | `:7176–7195` | second `subscribeCrosshairMove` |
| `paneSize` in snapshot composite | `:3504` | `ch.paneSize(i).height` |
| Episode markers | `:9301–9318` | `episodeMarkersRef.detach`; `createSeriesMarkers(priceS, specs)` `:9318` |
| Effect 7 watermark mutate | `:9720–9741` | `watermarkPluginRef.current?.applyOptions({ visible, lines })` `:9726` |
| Session shading Effect | `:9813–9855` | `attachSessionShading` / `detachSessionShading` on `priceSeriesRef` via `SeriesHandle.attachPrimitive` |
| Teardown marker null | `:8553–8561` | `episodeMarkersRef.detach` `:8560`; other plugin refs nulled (chart already gone) |

### Raw calls inside M03

| Call | Site | Replacement |
|---|---|---|
| `createSeriesMarkers(series, marks)` | `:1412,:1532,:2081,:9318` | `SeriesHandle.setMarkers(marks)` (or `MarkersHandle` if plugin identity is kept) |
| `plugin.detach()` | 10 sites, e.g. `:1406,:2448,:8560,:9303` | `MarkersHandle.detach()` (C01-A01) or `setMarkers([])` when the series survives |
| `series.createPriceLine(spec)` | 18 sites, e.g. `:1120,:1372,:1397,:1897,:2472` | `SeriesHandle.createPriceLine` |
| `series.removePriceLine(pl)` | `:1093,:1101` | `PriceLineHandle.remove()` |
| `pl.applyOptions({ lineVisible })` | `:2435` | `PriceLineHandle.applyOptions` |
| `createTextWatermark(pane, spec)` | `:3948` | `engine.setWatermark(0, spec)` |
| `watermarkPlugin.applyOptions` | `:9726` | **C01-A01** `WatermarkHandle.applyOptions` (preferred) or re-call `setWatermark` |
| `chart.takeScreenshot()` | `:3464` | `engine.takeScreenshot()` — already on the contract, already sync |
| `chart.paneSize(i)` | `:3504` | `engine.paneSize(i)` |
| `chart.subscribeCrosshairMove` | `:4611,:7177,:9049` | `engine.subscribeCrosshairMove` |
| `param.seriesData: Map<ISeriesApi, datum>` | `:4583` | `EngineMouseEventParams` is currently an open record (`api.ts:134`). Pin a typed `seriesData: ReadonlyMap<SeriesHandle, EngineSeriesRow>` as part of C01-A01’s event payload, or ChartPanel keeps `as any` on the map |
| `attach/detachSessionShading` | `:9826,:8547` | `SeriesHandle.attachPrimitive` / `detachPrimitive` (already on the contract) |
| `series.barsInLogicalRange` | `sessionShading.ts:88` | **C01-A01** `SeriesHandle.barsInLogicalRange` |

### M03 risks

- **Detach-before-remove.** `clearAllIndicators` (`:2448`) detaches MACD/TTM plugins before `removeSeries`. Skipping detach after switching to `setMarkers` is safe only because `SeriesHandle.remove()` detaches internally (`api.ts:236`). Skipping detach while the series **survives** (eye-toggle, live in-place) leaks the plugin.
- **Watermark replace vs mutate.** Adapter `setWatermark` detaches+recreates (masterplan LWC 5.2 facts). Effect 7 currently mutates (`:9726`) so toggling visibility does not flash. If M03 uses `setWatermark` for Effect 7, screenshot-compare the toggle.
- **Price lines on the shared price series.** `slevels` / `pivots` / `optlevels` / extended-hours line live on `priceSeriesRef`, not on a study series. `clearAllIndicators` calls `removeIndPriceLines()` (`:2454`) for that reason — `removeSeries` of a study does not take them with it. M02 rebuilds must keep calling that helper.
- **`panes()` identity.** `:7203–7205`: LWC hands back fresh `IPaneApi` wrappers, so `series.getPane() !== chart.panes()[i]`. Match by `paneIndex()`. `PaneHandle` must preserve that: index is identity, object identity is not.
- **Crosshair `seriesData` map.** Magnet mode (`:4578`) iterates every series in the event payload. After unwrap dies, the map keys must be `SeriesHandle` (or the handler looks up via `engine` inventory). This is shared with M02 (compare/indicator series appear in the map) and S-sync (`:9021` `getPane().getSeries()` candidate scan).

---

## Shared-state risks (two seams, one ref)

| State | Seams | What breaks |
|---|---|---|
| `chartRef` vs `engineRef` | M01 + all others | Dual handles. A late `chartRef.current!.addSeries` after M01 re-imports LWC. |
| `priceSeriesRef` | M01 creates, M02 paints, M03 decorates, S-sync registers, shading attaches, Effect 7 restyles | Nulling in one seam without the others agreeing. Live `update` (`:3189`) against a replaced handle drops the developing bar. |
| `indSeriesRef` + `paneMapRef` | M02 builders, M02 live in-place, M03 markers on those series, pane stretch M01 | `runStudyInPlace` assumes the map still owns the series the facade returns. |
| `watermarkPluginRef` | M01 mount creates (`:3948`), M03 Effect 7 mutates (`:9726`), M01 teardown nulls (`:8564`) | Recreating in M03 while Effect 7 still holds the old plugin. |
| Marker plugin refs | M02 builders create, M03 episode, M01 teardown nulls, `clearAllIndicators` detaches | Detach on a plugin whose host series M02 already `remove()`d — must stay try/catch / no-op. |
| `syncCleanupRef` | S-sync `reRegisterSync` `:8992`, M01 teardown `:8485`, Effect 2 tail `:8974` | Unsubscribing a handler M01 already destroyed. |
| `viewSavedRef` logical range | M02 preserve-view, M01 ResizeObserver preserve-window | Mixing calendar `setVisibleRange` (FrameBar) with logical `setVisibleLogicalRange` (indicator toggle) on the same tick. |
| Effect 8 `onChartApi` | M01 publish, FrameBar/Settings consume | Publishing `ChartEngine` while FrameBar still types `IChartApi` (or the reverse) is a one-patch pair. |

---

## Suggested patch order (parent)

```
C01-A01 api.ts + lwc adapter + tests
  └─ M01 ChartPanel Effect 1 / addPriceSeries / applyFutureAxis / teardown / Effect 8
       ├─ ChartPane chartApi state + FrameBar + SettingsModal props
       ├─ paneSync + drawingPaneReadiness retype (parent-owned paneSync.ts)
       ├─ M03 watermark + price lines + markers + screenshot + shading
       └─ M02 builders + updateAllIndicators + live update + compare + pine
            └─ grep engine-unwrap:  →  0
```

M03 before M02 is the default because decorations attach to the **price** series M01 already created, and because M02 builders embed marker/price-line calls that should call an M03 helper rather than `createSeriesMarkers` directly.

Swap M02 before M03 only if a single patch must keep indicator markers compiling while watermark work lags — in that case extract `setOwnedMarkers(series, marks)` first (five lines) and let both seams call it.

---

## Cluster map (for the census `cluster` field)

| Cluster | ChartPanel meaning | Primary ranges |
|---|---|---|
| `M01-mount` | Engine lifecycle, price series, pane chrome, settings apply, Effect 8 | `:740–764`, `:1275–1306`, `:2154–2443`, `:3402` create/teardown, `:8454–8579`, `:8916–8932`, `:9594–9784`, `:9802–9807` |
| `M02-studies` | Indicator/compare/pine builders, Effect 2/3, suite SVG overlays | `:1322–2131`, `:2445–2676`, `:8585–9262`, `:9436`, `:6604–7006` |
| `M03-decorations` | Markers, watermark, price lines, screenshot, shading | `:1083–1132`, `:1405,:1532,:2081,:2448`, `:3464`, `:3948`, `:9301`, `:9726`, `:9813` |
| `L-live` | In-place bar update + generation boundary | `:3074–3299` |
| `P-pine` | Pine plot/marker lifecycle | `:1476–1580`, `:3303`, `:9436` |
| `I-interaction` | Axis wheel/dblclick, hover tags, applyView, magnet map | `:3316`, `:4175–4611`, `:7289–7374` |
| `D-drawings` | SVG drawings, `xOf` / `logicalToCoordinate` | `:4614–7110` |
| `S-sync` | `reRegisterSync` + paneSync bus | `:8992–9056`; `paneSync.ts` |
| `X-other` | e2e hooks (`__mmChartAxisOpts` `:3758`), ownership census `:3334` | — |
