# M02 — study / compare / volume series onto SeriesHandle

Lane `ce-m02-1012`. Patch-only delivery for `terminal/components/ChartPanel.tsx`
(never committed). Helpers and contract tests land on `claude/ce-m02-1012`.

`BASE_SHA=8fb010a91bf46e10ce822525b6b91f9a76ef1495` (head of
`claude/ce-integrate-1012`). ChartPanel at this SHA is 9,979 lines.

## Apply

From the repo root, with this branch's helper commits already present:

```
git apply --check docs/chart-engine/migration/M02_STUDIES.patch
git apply docs/chart-engine/migration/M02_STUDIES.patch
```

`git apply --check` was verified at `BASE_SHA` against the unmodified ChartPanel.

The patch is self-contained at `BASE_SHA` (M01 has not landed). Study builders
obtain the engine ChartPanel already holds (`engineRef.current`) and call
`ChartEngine.addSeries(kind, options, paneIndex)`. There is no
`engine.pane(i).addSeries` on `api.ts`; the existing `addSeries` third argument
is the pane index.

## Contract used (no api.ts change)

Read of `terminal/lib/chart-engine/api.ts` at BASE_SHA (334 lines):

- `ChartEngine.addSeries(kind, options?, paneIndex?) → SeriesHandle`
- `SeriesHandle.setData / update / applyOptions / options / data / dataByIndex`
- `SeriesHandle.createPriceLine / remove / priceScale / pane / paneIndex / unwrap`
- `ChartEngine.priceScale(id, paneIndex?) → PriceScaleHandle.applyOptions`
- `ChartEngine.removeSeries(handle)` (same as `handle.remove()`)
- `ChartEngine.inventory()`

Study creation uses `addSeries` + identical option objects. Live ticks use
`handle.update` / in-place `setData` on the stable handle. Compare add/remove
uses `handle.remove()`. Overlay volume / stochsig scale margins go through
`engine.priceScale(id).applyOptions`.

## Census at BASE_SHA (re-measured)

ChartPanel imports from `"lightweight-charts"` at lines 14–19:
`CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
BaselineSeries, createSeriesMarkers, ISeriesMarkersPluginApi,
createTextWatermark, CrosshairMode, ColorType, LineStyle, LineType,
MismatchDirection, PriceScaleMode, IChartApi, ISeriesApi, IPaneApi, IPriceLine`.

Raw chart via `engine.unwrap<IChartApi>()` (1 live site at `:3943`, plus the
tagged comment). `ISeriesApi` token count: 59. `addSeries(`: 51.

### Creation — M02 cluster (42 sites). Once per build, never per tick.

| Site (BASE line) | Kind | Builder | When created |
|---|---|---|---|
| 1325, 1334 | line ×N | `buildEma` | overlay build / Effect 3 add |
| 1340 | line ×3 | `buildBb` | overlay build |
| 1354 | histogram | `buildVol` | overlay build |
| 1370 | line | `buildRsiPane` | subpane build |
| 1389, 1392, 1393 | histogram + line×2 | `buildStochRsiPane` | subpane build |
| 1416, 1417 | histogram + line×2 | `buildMacd` | subpane build |
| 1482 / 1485 / 1488 | hist / area / line | `addPinePlot` | pine build |
| 1608, 1609, 1620, 1621 | line×4 | `buildIchimoku` | overlay build |
| 1632, 1633 | line×2 | `buildRibbon` | overlay build |
| 1723, 1724 | line×2 | `buildSupertrend` | overlay build |
| 1738 / 1747 / 1756 | line | avwap / rvwap / wvwap | overlay build |
| 1781–1783 | line×3 | `buildRsiStack` | subpane build |
| 1796 | line | `buildAccum` | subpane build |
| 1821, 1836, 1843 | line | `buildSvwap` | overlay build |
| 2021, 2028, 2034 | line / hist / line | `buildRvol` | subpane build |
| 2067 | histogram | `buildTtmsq` | subpane build |
| 2094, 2106, 2108 | line | `buildAdx` | subpane build |
| 2122 | baseline | `buildCvd` | subpane build |
| 2464 | line (transparent) | `buildSuitePane` | subpane build |
| 2662, 2668 | line | `rebuildCompare` | compare rebuild (own gen token) |

SVG-only builders (`buildVprofile`, `buildVolbox`, `buildOrb`, `buildSlevels`,
`buildPivots`, `buildOptLevels`) return `[]` and own no LWC series.

### Not M02 (stay raw)

| Site (BASE line) | Kind | Owner |
|---|---|---|
| 753 | `addSeries(LineSeries)` future-axis | M01 |
| 1284–1297 | price `addSeries(Line/Area/Baseline/Bar/Candlestick)` | M01 |
| 8749, 8920 | `chart.removeSeries(priceS)` | M01 |
| 1412, 1532, 2081, 9318 | `createSeriesMarkers` on study/price hosts | M03 |
| 3948 | `createTextWatermark` | M03 |
| slevels/pivots/optlevels `createPriceLine` on `priceSeriesRef` | M03 |

### Per-tick path (must not recreate)

| Path | BASE line | After patch |
|---|---|---|
| `updateAllIndicators` `setData` on EMA/BB/VWAP/Vol/RSI/Stoch/MACD | 2538 | `SeriesHandle.setData` on the same refs |
| `runStudyInPlace` + `seriesReuseChart` | 3074 / 3077 | `seriesReuseEngine(engine, owned, key)` |
| `commitLiveBarGeneration` | 3134 | unchanged owner; still one generation |
| Effect 5 volume recolor `vol[0].setData` | 9629 / 9788 | `SeriesHandle.setData` |
| Classic live EMA/BB/… | `LIVE_INPLACE_SERIES_KEYS` | still `setData`, not `addSeries` |

Law: one live bar → one generation of in-place updates. `seriesReuseEngine`
throws if a builder asks for more series than the key already owns (same
semantics as `seriesReuseChart`).

### applyOptions / setData / update / remove (M02)

- Volume scale: `chart.priceScale("volume").applyOptions({ scaleMargins })` at
  BASE `:1363` → `engine.priceScale("volume").applyOptions(...)`.
- Stoch highlight scale: `:1390` `priceScale("stochsig")` → engine handle.
- Hide/show: `indSeriesRef` / `cmpSeriesRef` / `pineSeriesRef` `.applyOptions({ visible })`.
- Remove: every study/compare/pine teardown `chart.removeSeries(s)` → `s.remove()`.
- Compare rebuild still increments `cmpGenRef` and abandons a superseded fetch.

Parameter changes (Effect 3) still recompute only in the designated build
owner: overlay add/remove is incremental; subpane add/remove is ordered;
`updateAllIndicators` is the TF-switch in-place owner; `runStudyInPlace` is
the live-rebuild owner. Indicator math, inputs, and comparison bases are
untouched (`toLine`, `volData`, `stochHiData`, compare date-join).

## Before / after counters (ChartPanel)

| Metric | BASE_SHA | With M02 patch |
|---|---|---|
| `addSeries(LineSeries)` ctor | 38 | 4 (future-axis + 3 price line variants) |
| `addSeries(HistogramSeries)` ctor | 6 | 0 (import removed) |
| `addSeries(AreaSeries)` ctor | 2 | 1 (price area) |
| `addSeries(BaselineSeries)` ctor | 2 | 1 (price baseline) |
| `addSeries(CandlestickSeries/BarSeries)` | 1+1 | 1+1 (price) |
| `engine.addSeries("line"\|"histogram"\|"area"\|"baseline")` | 0 | 42 |
| `ISeriesApi` tokens | 59 | 18 |
| `chart.removeSeries` | 9 study+price | 2 (price series only, M01) |
| `// engine-unwrap:` in ChartPanel | 1 (P1 bridge) | 1 (P1 bridge; G01 budget) |
| ChartPanel lines | 9,979 | 9,987 |

Ref names other clusters read (`indSeriesRef`, `cmpSeriesRef`, `pineSeriesRef`,
`paneMapRef`, `priceSeriesRef`) are kept. Their element type for the three
study maps becomes `SeriesHandle`. `keepIndicatorPaneAxisLabelsOnly(series)`
call sites stay exactly two (source-grep contract in
`indicatorPaneSeries.test.ts`).

## Remaining raw-LWC sites (owner)

G01 (`chartEngineBoundary.test.ts`) budgets **8** `// engine-unwrap:` tags
across `lib/chart-engine/**` + ChartPanel (`api.ts` already has 7). ChartPanel
may therefore keep **one** tag — the existing P1 bridge. Additional
`// engine-unwrap: <cluster> (M0x)` comments would fail the subset. Remaining
sites are listed here and tagged in-source as `// M01 …` / `// M03 …`
without the G01-counted prefix.

| Cluster | What stays raw | Owner |
|---|---|---|
| P1 bridge `:3943` | `engine.unwrap<IChartApi>()` → `chartRef` | M01 (tagged) |
| Price factory | `IChartApi.addSeries(Ctor)` | M01 |
| Future-axis | `addSeries(LineSeries)` on `chartApi` | M01 |
| Price teardown | `chart.removeSeries(priceS)` | M01 |
| Pane meta | `handle.pane().unwrap<IPaneApi>()` so `panesMeta` still stores `IPaneApi` | M01 |
| MACD / TTM / pine markers | `createSeriesMarkers(handle.unwrap<ISeriesApi>())` | M03 |
| Pine hlines on overlay-empty scripts | `createPriceLine` on shared `priceS` | M03 |
| Watermark | `createTextWatermark` | M03 |
| Episode markers | `createSeriesMarkers` | M03 |
| Drawings `seriesForPane` / axis-wheel `paneSeries` | `chartRef.panes()[i].getSeries()[0]` | drawings / M01 |
| `paneSync.ts` | `IChartApi` / `ISeriesApi` | S-sync (not this lane) |

## Helpers (committed, backward compatible)

`terminal/lib/liveBarProjection.ts` — existing exports unchanged:

- `reuseSeries<S>(s: S): S`
- `seriesReuseChart<C, S>(chart: C, owned: S[], label: string): C`
- `liveQuoteStamp`, `acceptsLiveTick`, `LIVE_BAR_PROJECTION`,
  `LIVE_INPLACE_SERIES_KEYS`, `LIVE_REBUILD_KEYS`

New, beside the old ones:

- `reuseSeriesHandle(s: SeriesHandle): SeriesHandle` — data writes/reads
  forward; `applyOptions` / `createPriceLine` no-ops.
- `seriesReuseEngine(engine, owned, label): ChartEngine` — `addSeries` returns
  `owned[i]` wrapped by `reuseSeriesHandle`; throws on leak.
- `updateLiveStudyRow(handle, row, historicalUpdate?)` — `handle.update`.

`terminal/lib/indicatorPaneSeries.ts`:

- `keepIndicatorPaneAxisLabelsOnly<T>(series: T[]): T[]` unchanged.
- `keepIndicatorPaneAxisLabelsOnlyHandles(series: SeriesHandle[]): SeriesHandle[]`
  wraps the original.

The branch typechecks **without** the ChartPanel patch.

## Tests (green at BASE_SHA without the patch)

`terminal/lib/__tests__/chartEngineStudyMigration.test.ts` against the LWC
adapter with a house `vi.mock("lightweight-charts")` stand-in whose `update`
mutates `__data` (the stock lwcAdapter mock's `update` is a no-op).

- **M02-A01** 100 `handle.update` on the same live time: `data()` length 1,
  value 100→200, pane/series counts and options unchanged.
- **M02-A02** add/remove compare line ×20: `inventory()` returns to baseline.
- **M02-A03** whitespace `{ time: 2 }` through `setData` / historical `update`
  / `dataByIndex`: no `value: 0`, no interpolation.
- **M02-A04** `applyOptions` on EMA does not call vol/osc spies.
- Helpers: labels-only handles, reuse swallow, reuse-engine leak throw,
  `updateLiveStudyRow`.

Falsifier: drop the `applyOptions` no-op in `reuseSeriesHandle` →
`reuseSeriesHandle swallows applyOptions` RED; restore GREEN.

## Verification (quoted)

### Patch applies at BASE_SHA

```
git apply --check docs/chart-engine/migration/M02_STUDIES.patch
# APPLY_CHECK_OK
```

### With patch applied (working tree only)

```
cd terminal && npx tsc --noEmit
# exit 0

cd terminal && npx eslint components/ChartPanel.tsx
# BASELINE (unpatched): ✖ 295 problems (270 errors, 25 warnings)
# WITH PATCH:           ✖ 256 problems (231 errors, 25 warnings)
# ChartPanel eslint is pre-red at BASE_SHA; the patch reduces error count
# (ISeriesApi any-casts leave study builders) and does not add warnings.

cd terminal && VITEST_MAX_THREADS=3 npx vitest run \
  lib/__tests__/chartEngine*.test.ts lib/__tests__/lwcAdapter.test.ts
# Test Files  25 passed (25)
# Tests       576 passed (576)
```

### Without the patch (committed files)

```
cd terminal && npx tsc --noEmit
# exit 0

cd terminal && npx eslint lib/liveBarProjection.ts \
  lib/indicatorPaneSeries.ts lib/__tests__/chartEngineStudyMigration.test.ts
# exit 0

cd terminal && VITEST_MAX_THREADS=3 npx vitest run \
  lib/__tests__/chartEngineStudyMigration.test.ts \
  lib/__tests__/liveBarProjection.test.ts \
  lib/__tests__/indicatorPaneSeries.test.ts
# Test Files  3 passed (3)
# Tests       30 passed (30)
```

### Falsifier

Mutant: `reuseSeriesHandle` stopped swallowing `applyOptions`.

```
FAIL lib/__tests__/chartEngineStudyMigration.test.ts > M02 helpers
  reuseSeriesHandle swallows applyOptions and createPriceLine
AssertionError: expected "spy" to not be called at all, but actually been called 1 times
 ❯ lib/__tests__/chartEngineStudyMigration.test.ts:354:34
 Test Files  1 failed (1)
 Tests       1 failed | 7 passed (8)
```

Restore:

```
✓ lib/__tests__/chartEngineStudyMigration.test.ts (8 tests)
Test Files  1 passed (1)
Tests       8 passed (8)
```

## Risks

- `toLine` still `filter(Boolean)`-drops nulls (MACD hist / ichimoku / rvol
  slot likewise). That is pre-existing ChartPanel math; A03 asserts the
  **contract** whitespace row, not `toLine`. Changing `toLine` to emit
  `{ time }` would change on-chart gaps vs dropped points and is out of
  M02 byte-for-byte scope.
- `seriesReuseEngine.addSeries` ignores kind/options/pane (same as
  `seriesReuseChart`): a live rebuild cannot restyle or leak.
- `panesMeta` still wants `IPaneApi` (stretch / getHTMLElement). Study panes
  unwrap `handle.pane()` for that bag; M01 owns replacing the bag.
- Drawings and magnet-mode still walk raw `chart.panes()[i].getSeries()`.
  Those series objects are LWC natives, not `SeriesHandle`. M01/drawings.
- Compare overlays live on pane 0, so A02 inventory does not depend on
  empty-pane auto-removal.

## Contract gaps → PROPOSED_PATCHES

None required for M02. `api.ts` already has `addSeries(kind, opts, paneIndex)`,
`SeriesHandle.update/setData/applyOptions/remove/data/dataByIndex`, and
`inventory()`.

Noted for the parent (not blocking):

- Task text mentioned `engine.pane(i).addSeries`. The contract is
  `engine.addSeries(kind, opts, paneIndex)`. No `PaneHandle.addSeries`.
- `WatermarkHandle.applyOptions` and `MarkersHandle.detach` remain M03.
- G01 unwrap-tag budget (8) forbids per-site `// engine-unwrap:` comments
  on remaining M01/M03 ChartPanel sites.
