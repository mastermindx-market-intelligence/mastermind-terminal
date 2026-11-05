# M01 — Primary chart ownership and price handles

Package: **M01**. Patch: [`M01_PRIMARY.patch`](./M01_PRIMARY.patch).
BASE_SHA: `8fb010a91bf46e10ce822525b6b91f9a76ef1495` (head of `claude/ce-integrate-1012`).
ChartPanel at BASE: `terminal/components/ChartPanel.tsx`, **9,978 lines**.

This lane does **not** commit ChartPanel. The integrator applies the patch.

```
git apply --check docs/chart-engine/migration/M01_PRIMARY.patch
git apply docs/chart-engine/migration/M01_PRIMARY.patch
```

Run from the repo root at BASE_SHA. Paths in the patch are relative to the repo root (`terminal/components/ChartPanel.tsx`).

---

## Ground-truth re-measure vs integrator counts

Measured at BASE_SHA with substring counts on the raw file (the ratchet uses these regexes).

| Needle | Integrator GT | Measured | Delta |
|---|---:|---:|---|
| `unwrap<` | 2 (`engine.unwrap<IChartApi>()` sites) | **1** | Only one live call (`:3936`). Comments at `:3934–3935` and `:8566` mention unwrap but do not call it. |
| `chartRef.current` | 46 | **46** | match |
| `IChartApi` | 28 | **28** | match |
| `ISeriesApi` (any) | 59 | **59** | match |
| `ISeriesApi<` (ratchet) | — | **56** | 3 hits lack `<` (import `:18`, comments `:1321`, `:8555`) |
| `createSeriesMarkers(` | 5 | **4** | 5th hit is the import identifier without `(` (`:16`) |
| `createTextWatermark(` | 4 | **1** | 4 hits of `createTextWatermark` without requiring `(`: import `:17`, comments `:3938`, `:9720`, call `:3948` |
| `LineSeries` | 41 | **41** matching lines / 42 substrings | match on `rg` line count; `:1417` contains two `addSeries(LineSeries)` calls |
| `HistogramSeries` | 8 | **8** | match |
| `AreaSeries` | 4 | **4** | match |
| `BaselineSeries` | 4 | **4** | match |
| `CandlestickSeries` | 2 | **2** | match |
| `BarSeries` | 2 | **2** | match |
| `IPriceLine` | 5 | **5** | match |

Ratchet ceilings (committed test, BASE_SHA without the patch) use the **measured** regex counts: `unwrap<` 1, `chartRef.current` 46, `IChartApi` 28, `ISeriesApi<` 56, `createSeriesMarkers(` 4, `createTextWatermark(` 1.

---

## 1. Census (BASE_SHA)

Classification: **M01** = this patch; **M02** = study/compare/indicator/volume series; **M03** = markers/watermark/price lines/session shading; **enum or type only** = CrosshairMode / ColorType / LineStyle / LineType / MismatchDirection / PriceScaleMode / IChartApi / ISeriesApi / IPaneApi / IPriceLine as types.

### Imports (`:14–19`)

| Line | Symbol | Class |
|---|---|---|
| 15 | `CandlestickSeries`, `BarSeries`, `LineSeries`, `AreaSeries`, `HistogramSeries`, `BaselineSeries` | constructors: M01 primary uses candles/bars/line/area/baseline; remainder M02 |
| 16 | `createSeriesMarkers`, `ISeriesMarkersPluginApi` | M03 |
| 17 | `createTextWatermark` | M03 |
| 18 | `CrosshairMode`, `ColorType`, `LineStyle`, `LineType`, `MismatchDirection`, `PriceScaleMode` | enum or type only (values used at M01 option bags and M03/interaction sites) |
| 18 | `IChartApi`, `ISeriesApi`, `IPaneApi`, `IPriceLine` | enum or type only |

`createEngine` / `ChartEngine` already imported from `@/lib/chart-engine` (`:20`).

### `engine.unwrap` / `chartRef` / primary series

| Line | Site | Class |
|---|---|---|
| 635–636 | `engineRef` / `chartRef: IChartApi` | M01 ownership; chartRef kept as M02/M03 bridge |
| 639 | `chartRef.current?.timeScale().getVisibleRange()` | M01 (migrated) |
| 645 | `priceSeriesRef: ISeriesApi` | M01 handle + M02/M03 unwrap bridge |
| 740 | `futureAxisRef: ISeriesApi` | M01 helper series on pane 0 |
| 742–763 | `applyFutureAxis` → `chartApi.addSeries(LineSeries, …)` | M01 (migrated) |
| 1275–1306 | `addPriceSeries(chart: IChartApi, …)` + six `chart.addSeries(Ctor, opts, 0)` | M01 (migrated) |
| 3934–3937 | `engine.unwrap<IChartApi>()` → `chartRef.current` | M01 create-site; **kept** tagged `// engine-unwrap: M02\|M03` so other clusters compile |
| 8916–8928 | Effect 2 daily: `chart.removeSeries(priceS)` / `addPriceSeries` / `setData` | M01 (migrated) |
| ~8768–8777 | Effect 2 intraday: same family swap | M01 (migrated) |
| 3037 | `clearChartData` `priceSeriesRef.setData([])` | M01 (migrated onto handle) |
| 9594–9628 | Effect 5 `chart.applyOptions` + primary `applyOptions` | M01 (migrated); volume `setData` stays M02 |
| 9656–9774 | Effect 7 `chart.applyOptions` / `chart.priceScale` / primary `applyOptions`/`setData` | M01 (migrated); watermark plugin mutate stays M03 |
| 8710, 8786 | Effect 2 `chart.applyOptions({ timeScale })` | M01 (migrated) |
| 8467–8470 | ResizeObserver `timeScale` / `resize` | M01 (migrated) |
| 3317–3322 | `applyView` `timeScale().width/setVisibleLogicalRange/fitContent` | M01 (migrated) |
| 2230–2232 | `applyPaneTickDensity` `chart.panes()` / `p.priceScale("right")` | M01 (migrated) |
| 2406, 2410 | `doMove` / `canMoveDown` `panes()` / `swapPanes` | M01 (migrated) |
| 4611, 7176, 7184, 7195, 9049 | `subscribeCrosshairMove` | M01 (migrated onto `engine.subscribeCrosshairMove`) |
| 8480–8481, 9053 | `unsubscribeCrosshairMove` | M01 (migrated) |
| 7124, 9050, 9054 | `timeScale().subscribe/unsubscribeVisibleLogicalRangeChange` | M01 (migrated) |
| 8567–8568 | `engine.destroy()` + `chartRef = null` | M01 already owned; handle refs nulled |

### M02 — not migrated (count only)

Builders `buildEma` `:1322` through `buildCvd` `:2116`, `addPinePlot` `:1476`, `buildSuitePane` `:2461`, `rebuildCompare` `:2635` — each takes `chart: IChartApi` and calls `chart.addSeries(LineSeries\|HistogramSeries\|AreaSeries\|BaselineSeries, …)`.

`chartRef.current` guards in Pine (`:1499,:1545,:1561,:1581,:1593`), `clearAllIndicators` `:2446`, `buildAllIndicators` `:2478`, `runStudyInPlace` `:3075`, `schedulePineLiveRerun` `:3309`, Effect 2 M02 tail, Effect 3/3b/3c (`:9063,:9218,:9230,:9246,:9438`), volume refresh `:9789`.

`chart.priceScale("volume")` `:1363`, `chart.priceScale("stochsig")` `:1390`.

Preserve-view `timeScale().get/setVisibleLogicalRange` on indicator toggle (`:9067,:9177,:9231,:9236,:9249,:9260,:9439,:9451,:9501`).

Live `priceS.update` (`:3189,:3278`) still goes through the unwrapped `ISeriesApi` (M02 live-bar law; handle `update` is available but other clusters still close over `priceSeriesRef`).

### M03 — not migrated (count only)

| Line | Site |
|---|---|
| 1081–1132 | `IPriceLine` pool, `createPriceLine`, `removePriceLine`, `LineStyle.Dotted` |
| 1412, 1532, 2081, 9318 | `createSeriesMarkers(` |
| 3948 | `createTextWatermark(` |
| 9726 | watermark plugin `applyOptions` |
| 3464 | `takeScreenshot()` |
| 4583–4585 | crosshair `seriesData` as `Map<ISeriesApi, datum>` (magnet) |
| 9813–9855 | session shading primitive on `priceSeriesRef` |
| 8560 | `episodeMarkersRef.detach` |

### Enum / type-only uses (kept; adapter forwards 1:1)

| Enum | Lines | Notes |
|---|---|---|
| `CrosshairMode.Normal/Magnet` | 3920, 9706 | M01 option bags. LWC numeric enum (`0`/`1`). Adapter does **not** map `"normal"` → `CrosshairMode.Normal`. Kept as enum so behaviour is unchanged. |
| `ColorType.Solid/VerticalGradient` | 9685–9686 | String-valued (`"solid"`/`"gradient"`). Could become those strings; left as enum for byte-identical bags. |
| `LineType.WithSteps` | 1286 | Numeric `1`. Passed through in the migrated `addPriceSeries` options object. |
| `LineStyle.Dotted` | 1124 | M03 price lines |
| `MismatchDirection.NearestRight` | 4204 | interaction / hover tag |
| `PriceScaleMode.*` | 4198, 4208, 7301, 7324, 7358 | interaction / axis zoom |

### Satellites named in the brief

- `lib/liveBarProjection.ts`: 2 LWC **mentions** in comments (`:18`, `:93`). No import.
- `lib/sessionShading.ts`: 1 import block of LWC primitive types (`:37`). M03.
- `lib/indicatorPaneSeries.ts`, `lib/priceTagPlacement.ts`: no LWC.

---

## 2. Patch behaviour

What changed (ChartPanel only):

1. **Primary series** via `engine.addSeries(kind, options, 0)` keeping the exact option objects (including `LineType.WithSteps`). `PaneHandle.addSeries` is **not** on `api.ts` at BASE_SHA; `ChartEngine.addSeries(kind, opts, paneIndex)` is the contract equivalent of `engine.pane(0).addSeries`.
2. **`priceSeriesHandleRef: SeriesHandle`** is the M01 owner. `priceSeriesRef` is still populated with `handle.unwrap()` so M02/M03 compile.
3. **Future-axis whitespace series** created with `engine.addSeries("line", {…}, 0)`.
4. **Chart options** (`createEngine` already owned; Effect 2/5/7 `applyOptions`) go through `engine.applyOptions`.
5. **Time scale** for view, resize, calendar span, and mount/sync range subscriptions: `engine.timeScale()`.
6. **Price scale** for Effect 7 mode/invert/autoScale/margins and shell tick density: `engine.priceScale(id)` / `engine.panes()[i].priceScale("right")`.
7. **Crosshair subscriptions** (tag, projection, visual, scrub, pane-sync) via `engine.subscribeCrosshairMove` / `unsubscribeCrosshairMove`. `EngineMouseEventParams.seriesData` is still LWC's `Map<ISeriesApi, datum>` because `wrapMouse` currently casts the param through (see contract gap). Magnet consumption stays M03.
8. **Cleanup**: family swap uses `engine.removeSeries(handle)`; `clearChartData` uses `handle.setData([])`; StrictMode still destroys in Effect 1's empty-deps cleanup (`engine.destroy()` once; double destroy is a no-op). `chartRef` / handle refs nulled after destroy.
9. **ONE create/destroy**. `chartRef` is still assigned from the single unwrap at create-site.

`CandlestickSeries` / `BarSeries` imports drop because the primary factory no longer names the LWC constructors. M02 still imports `LineSeries` / `AreaSeries` / `HistogramSeries` / `BaselineSeries`.

---

## 3. Before / after counters (ChartPanel)

| Needle | BASE_SHA | After patch | Δ |
|---|---:|---:|---:|
| `unwrap<` | 1 | 1 | 0 (kept as M02/M03 bridge) |
| `chartRef.current` | 46 | 35 | −11 |
| `IChartApi` | 28 | 26 | −2 (`addPriceSeries` param + comment churn) |
| `ISeriesApi<` | 56 | 56 | 0 |
| `createSeriesMarkers(` | 4 | 4 | 0 (M03) |
| `createTextWatermark(` | 1 | 1 | 0 (M03) |
| `LineSeries` | 41 | 38 | −3 (primary line/step/markers + future-axis) |
| `HistogramSeries` | 8 | 8 | 0 (M02) |
| `AreaSeries` | 4 | 3 | −1 (primary area) |
| `BaselineSeries` | 4 | 3 | −1 (primary baseline) |
| `CandlestickSeries` | 2 | 0 | −2 |
| `BarSeries` | 2 | 0 | −2 |
| `engine-unwrap:` tags | 1 | 1 | 0 (G01 budget is 8 = api.ts 7 + ChartPanel 1) |

Integrator: lower the ratchet ceilings in `chartEnginePrimaryMigration.test.ts` when this patch lands (`chartRef.current` 35, `IChartApi` 26). Do **not** add extra `engine-unwrap:` tags at remaining M02/M03 sites without raising `ENGINE_UNWRAP_BUDGET` in `chartEngineBoundary.test.ts` (budget 8). Remaining sites are listed below instead.

---

## 4. Remaining unmigrated ChartPanel sites (owning package)

`chartRef.current` after the patch (35):

| Lines | Owner | Role |
|---|---|---|
| 1517, 1563, 1579, 1599, 1611 | M02 | Pine |
| 2274, 2464, 2496, 2658 | M02 | legend / indicators / compare |
| 3052, 3093, 3327 | M02 | clear compare, study-in-place, pine live |
| 3482, 3516 | M03 | screenshot composite |
| 3777 | X / diagnostics | `__mmChartAxisOpts` |
| 3956, 8589 | M01 bridge | assign/null the unwrap handle |
| 4682, 7221, 7280–7281, 7311 | drawings / overlay geometry | `panes()` / `priceScale().width()` |
| 8608, 9016, 9085, 9240, 9252, 9268, 9460, 9492, 9547, 9565, 9673, 9941 | M02 | Effect 2/3/sync/replay |
| 9827 | chrome | Effect 8 publishes raw API to FrameBar/Settings (`ChartPane.tsx`) |

Plus all M02 `chart.addSeries` builders and all M03 marker/watermark/price-line calls in the census above.

---

## 5. Verification

Quoted from this lane at BASE_SHA `8fb010a91bf46e10ce822525b6b91f9a76ef1495`.

**Patch applies**

```
git apply --check docs/chart-engine/migration/M01_PRIMARY.patch
# APPLY_CHECK_OK
```

**Without the patch** (committed test only):

```
cd terminal && VITEST_MAX_THREADS=3 npx vitest run lib/__tests__/chartEnginePrimaryMigration.test.ts
# Test Files  1 passed (1)
# Tests  4 passed (4)
```

**With the patch applied**

```
npx tsc --noEmit
# exit 0

npx eslint components/ChartPanel.tsx
# 295 problems (270 errors, 25 warnings) — identical to BASE_SHA (pre-existing no-explicit-any)

npx eslint lib/__tests__/chartEnginePrimaryMigration.test.ts
# ESLINT_TEST_OK

VITEST_MAX_THREADS=3 npx vitest run lib/__tests__/chartEngine*.test.ts lib/__tests__/lwcAdapter.test.ts
# Test Files  25 passed (25)
# Tests  572 passed (572)
```

Then `git checkout -- terminal/components/ChartPanel.tsx` before committing owned files.

**Falsifiers** (mutate `terminal/lib/chart-engine/lwc/index.ts`, restore from backup; ChartPanel patched during this pass, then checked out):

- M01-A01: skip `this.chart = null` in `destroy()`. RED:
  `AssertionError: expected { alive: true, panes: 1, …(4) } to deeply equal { alive: false, panes: +0, …(4) }` at `first.inventory()` (`chartEnginePrimaryMigration.test.ts:367`).
- M01-A02: `if (rows.length === 0) return` in `setData`. RED:
  `AssertionError: expected [ { time: '2020-01-01', …(4) }, …(1) ] to deeply equal []` at `primary.data()` (`:410`).
- M01-A03: skip `series.remove()` in `removeSeries`. RED:
  `AssertionError: expected 2 to be 1` at `engine.inventory().series` after candles→line (`:433`).

Restored adapter (`cmp` equal to backup): `Tests  4 passed (4)`.

`ChartPanel.tsx` has **zero** `subscribeClick` / `unsubscribeClick` sites at BASE_SHA; only `subscribeCrosshairMove` exists and is what the patch rewires.

---

## 6. Risks (behaviour not proven unchanged)

- **Crosshair `seriesData` keys**. Subscriptions now go through `engine.subscribeCrosshairMove`, but `wrapMouse` still passes LWC's param through. Magnet (`:4583`) still iterates `Map<ISeriesApi, datum>`. Unverified against a real canvas; contract-level only.
- **`LineType.WithSteps` / `CrosshairMode` / `ColorType`** still LWC enums inside option bags. Adapter forwards 1:1. Switching to contract string unions without an adapter map would change LWC input (`"normal"` ≠ `0`).
- **Effect 8** still publishes `IChartApi` to ChartPane / FrameBar / Settings. Those files are parent-owned.
- **`registerPane({ chart, series })`** still receives the unwrapped chart and `ISeriesApi`. paneSync is parent-owned.
- **Screenshot / pane overlay geometry / drawings timeScale** still on `chartRef`. Not M01.
- **jsdom has no real LWC canvas**. Adapter tests use the house fake. Visual ChartPanel crops are an integrator recapture gate (not run here).
- **G01 unwrap-tag budget**. Remaining M02/M03 sites are **not** each tagged `// engine-unwrap:` because that would raise ChartPanel's tag count above the budget of 1. The create-site tag names M02/M03. Census table is the remaining-site list.

---

## 7. Contract gaps (api.ts already read)

No ChartPanel call in this patch **requires** an api.ts change. Used as-is:

- `createEngine` / `applyOptions` / `destroy` / `inventory`
- `addSeries(kind, options, paneIndex)` / `removeSeries`
- `SeriesHandle.setData/applyOptions/unwrap/kind`
- `timeScale()` (visible logical range, width, fitContent, timeToCoordinate, subscribeVisibleLogicalRangeChange)
- `priceScale(id)` / `PaneHandle.priceScale` / `panes()` / `swapPanes` / `resize`
- `subscribeCrosshairMove` / `unsubscribeCrosshairMove`

**Not present, not required for this patch** (optional sugar / later clusters):

1. `ChartEngine.pane(i)` and `PaneHandle.addSeries(kind, options)` — task phrasing. Equivalent: `engine.addSeries(kind, options, i)` + `engine.panes()[i]`.
2. `wrapMouse` remapping `seriesData` onto `ReadonlyMap<SeriesHandle, EngineSeriesRow>` — M03 magnet. Today the adapter casts LWC `MouseEventParams` through.
3. Enum adapters: `"normal"|"magnet"` → `CrosshairMode`, `"with-steps"` → `LineType`. Needed before dropping the LWC enum imports from ChartPanel.
4. `setData([])` does **not** auto-remove price lines or markers in the adapter. ChartPanel `clearChartData` already detaches episode markers and `clearExtendedPriceLine` before emptying data. The M01-A02 test pins that sequence plus `data() === []` / `dataByIndex === null`.

Proposed diffs for (1)–(2) belong in RESULT.md `PROPOSED_PATCHES` if the parent wants them before M02/M03. They are not in this patch.

---

## Tests

`terminal/lib/__tests__/chartEnginePrimaryMigration.test.ts` (green at BASE_SHA without the patch):

- **M01-A01** StrictMode create → destroy → create: one live engine; final `inventory()` is `{ alive: false, zeros }`.
- **M01-A02** primary `setData([])` after withdrawing markers/price lines: empty `data()`, `dataByIndex` null, `priceLines` empty.
- **M01-A03** candles → line → candles via `removeSeries` + `addSeries`: pane count and price-scale options hold; inventory returns to baseline.
- **Ratchet** reads ChartPanel from disk; counts `<=` BASE_SHA ceilings. Integrator lowers ceilings when M01/M02/M03 land.
