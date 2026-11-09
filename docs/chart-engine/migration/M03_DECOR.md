# M03 — Markers, watermark, price lines, crosshair/click payloads (DECOR)

RUN_ID `ce-m03-1012` · BASE_SHA `8fb010a91bf46e10ce822525b6b91f9a76ef1495` · patch `M03_DECOR.patch` (same directory)

The patch moves every marker / watermark / price-line / crosshair-payload site in
`terminal/components/ChartPanel.tsx` from raw LWC plugin objects onto the owned contract
(`lib/chart-engine/api.ts`): `SeriesHandle.setMarkers(MarkerSpec[])`,
`ChartEngine.setWatermark(pane, WatermarkSpec)`,
`SeriesHandle.createPriceLine/removePriceLine/priceLines`, and
`EngineMouseEventParams.seriesData` keyed by owned handles. It also carries one
non-owned adapter change (see **Contract gap**) that makes the event payload
handle-keyed, plus one committed additive change (`lib/sessionShading.ts`
handle-based attach/detach helpers).

Apply (from the repo root, at BASE_SHA **or** on top of this branch's commits —
ChartPanel and the adapter carry no branch commits):

```bash
git apply --check docs/chart-engine/migration/M03_DECOR.patch   # verified: applies clean
git apply    docs/chart-engine/migration/M03_DECOR.patch
```

---

## 1. Census at BASE_SHA (re-measured; grep totals quoted)

`grep -c` on `components/ChartPanel.tsx` @ BASE_SHA — matches the integrator's ground
truth exactly:

| Symbol | BASE count | Occurrences |
|---|---|---|
| `createSeriesMarkers` | 5 | line 16 (import) + calls at 1412, 1532, 2081, 9318 |
| `createTextWatermark` | 4 | line 17 (import), comment 3938, call 3948, comment 9720 |
| `IPriceLine` | 5 | line 18 (import), 1081, 1082, 1083 (refs/helper), comment 2426 |
| `ISeriesMarkersPluginApi` | 6 | line 16 (import) + refs 652–655 + comment 8554 |
| `createPriceLine` | 19 grep hits | 15 call sites (see §2) |
| `seriesData` | 2 | comment 4570 + read 4583 (the only reader) |
| `engine.unwrap<IChartApi>` | 2 sites (11 grep hits for `unwrap`) | 3936 (Effect 1), 3335 area (census guard) |

### Markers — creation / replace / clear semantics (what the test preserves)

| Site (BASE line) | Host series | Lazily created? | Replace semantics | Cleared by |
|---|---|---|---|---|
| 1412 `applyMacdMarkers` | buildMacd's line series (sub-pane) | plugin per call | **detach old plugin first (1406), then create new** — 2 ops per rebuild | `clearAllIndicators` 2448; incremental removal ~9206; unmount 8559 |
| 1532 `buildPineScript` shapes | anchor = first plot series **or the price series** | plugin per script | plugins **stack** on the shared price series (one per script id, `pineMarkersRef`) | `clearAllPine` 1546; unmount 8552 |
| 2081 `buildTtmsq` dots | ttmsq histogram series | plugin per rebuild | detach old first (2071) | `clearAllIndicators` 2448; unmount 8559 |
| 9318 `renderEpisodeMarks` | the price series | plugin per call | detach old first (9303) | re-run of `renderEpisodeMarks`; unmount 8560; `clearChartData` |

### Watermark

Created **once on mount** (3948) on pane 0 via `createTextWatermark(pane, opts)`; the
plugin ref (`watermarkPluginRef` 1049) is toggled by `applyOptions` in the settings
effect (9726). Never detached explicitly — dies with `engine.destroy()` (teardown just
nulls the ref, 8564).

### Price lines (15 call sites)

* **Pooled on the price series** (tracked in `indPriceLinesRef`, removed by key):
  slevels 1897, pivots 1941, optlevels 1995, Pine hlines **only when anchored on the
  price series** 1524 (`anchoredOnPrice`). Each builder calls
  `removeIndPriceLines(key)` first — defensive never-double-draw.
* **Singleton on the price series**: extended-hours line 1120
  (`extendedPriceLineRef`, cleared by `clearExtendedPriceLine` 1097 on every rebuild /
  family switch / teardown).
* **Fire-and-forget on the indicator's OWN series** (die with series removal, never
  pooled): RSI ob/os 1372 (×2), stochRSI 80/20/50 1397 (×3), MACD zero 1419, RSI-stack
  ob/os 1786/1787, accum bands 1800 (×3 loop), RVOL 1.0 2041, ADX 25/20 2100/2101,
  suite-pane guides 2472.

### Event payload

`onTagCrosshair` (4573–4610), subscribed raw at 4611, unsubscribed at 8480. Reads
`p.seriesData` as `Map<ISeriesApi, any>` (4583–4598) for Magnet candidate selection
(visible / same-pane / non-overlay-scale; `priceToCoordinate` per candidate; snap via
the price series' `coordinateToPrice`). Four other raw crosshair subscriptions
(7176, 7184, 7195, 9049) read only `point`/`time` — no raw identity.

### sessionShading coupling

`attachSessionShading(priceS, bars)` 9833, `detachSessionShading` 9827 + 8546 — raw
`ISeriesApi` in/out of `lib/sessionShading.ts`.

---

## 2. What the patch does (per cluster)

| Cluster | Migration |
|---|---|
| Price series handle | `addPriceSeries` builds through `engineRef.current.addSeries(kind, opts, 0)` (1:1 mapping per chartType); the handle lives in new `priceSeriesHRef`; the RAW view is returned and stored in `priceSeriesRef` unchanged (single `handle.unwrap()` inside the factory — M01 handoff, no new `engine-unwrap:` tag, ratchet count stays 1). |
| Markers on own series | macd line / ttmsq histogram / pine plot series are created through `engine.addSeries`; decorations call `handle.setMarkers(...)` — the adapter lazily creates ONE plugin per series and every later call replaces (M03-A01). The four plugin refs (`pineMarkersRef`, `ttmsqMarkersRef`, `macdMarkersRef`, `episodeMarkersRef`) are deleted. |
| Markers on the SHARED price series | `setMarkers` replaces per series, so multiple creators must merge: new `applyPriceMarkers()` is the ONE writer, merging `episodeSpecsRef` (now `MarkerSpec[]`) + `pinePriceShapesRef` (shapes of overlay scripts that anchored on the price series), sorted by time, applied to `priceSeriesHRef`. `clearAllPine` / `clearChartData` / `renderEpisodeMarks` all drive it. |
| Watermark | mount: `engine.setWatermark(0, spec)` (spec kept in `watermarkSpecRef`); visibility toggle: replace the spec — the adapter detaches the previous plugin, exactly one instance stays live (M03-A01). `watermarkPluginRef` deleted. |
| Pooled price lines | `indPriceLinesRef: Map<string, PriceLineHandle[]>`, `extendedPriceLineRef: PriceLineHandle`; create/remove via `priceSeriesHRef.createPriceLine/removePriceLine` — creator-owns-no-series lines are cleared **through the price series' handle** (M03-A02). Fire-and-forget lines call `handle.createPriceLine` on their own series handle. `applyHidden` flips pooled lines via `PriceLineHandle.applyOptions`. |
| Crosshair payloads | ALL five crosshair subscriptions go through `engine.subscribe/unsubscribeCrosshairMove` (wrapper memoization preserves identity-based unsubscribe). `onTagCrosshair` iterates `seriesData` keyed by **owned handles** (`candidate.options()/paneIndex()/priceToCoordinate()`; snap via `priceSeriesHRef.coordinateToPrice`) — no raw `ISeriesApi` key anywhere (M03-A03). |
| sessionShading | `attachSessionShadingToHandle(priceH, bars)` / `detachSessionShadingFromHandle` — the additive committed helpers; the primitive itself is unchanged. |
| Census (`chartOwnershipCensus`) | `pricePaneLines` reads `priceSeriesHRef.priceLines().length`; `markerPlugins` now counts price-series marker WRITERS (episode set + price-anchored pine shape sets) — per-series marker sets live on host handles and die with the series. |

### Before / after counters (grep -c on ChartPanel)

| Symbol | BASE | Patched |
|---|---|---|
| `createSeriesMarkers` | 5 | **0** |
| `createTextWatermark` | 4 | **0** |
| `IPriceLine` | 5 | **0** |
| `ISeriesMarkersPluginApi` | 6 | **0** |
| `chart.subscribeCrosshairMove` / `chart.unsubscribeCrosshairMove` | 5 / 2 | **0 / 0** |
| `engine-unwrap:` tags (ratchet budget 8) | 1 | **1** (api.ts 7 unchanged → total 8, `chartEngineBoundary` stays green) |
| contract decoration calls (`setMarkers`/`setWatermark`/`createPriceLine`/shading-helpers) | 0 | 36 |

Remaining raw-LWC sites in ChartPanel (owners): the `engine.unwrap<IChartApi>` bridge
(M01 — series/pane creation clusters), `chart.addSeries(...)` in the non-decorated
builders (M01), `chart.removeSeries`, raw option/geometry calls, and the peer-magnet
duplicate at ~9020 (uses `getPane().getSeries()`/`dataByIndex`, not the event
`seriesData` map — paneSync/M01 territory).

---

## 3. Verification (all commands run from `terminal/`, patch applied unless stated)

```
npx tsc --noEmit                          → exit 0
npx eslint components/ChartPanel.tsx      → 271 problems (246 errors, 25 warnings)
                                            BASE_SHA baseline: 295 problems (270 errors, 25 warnings)
                                            → 24 FEWER errors, 0 new warnings (3 transient unused-import
                                              warnings removed); the file is not eslint-clean at BASE either.
VITEST_MAX_THREADS=3 npx vitest run \
  lib/__tests__/chartEngine*.test.ts lib/__tests__/lwcAdapter.test.ts
                                          → Test Files 25 passed (25) / Tests 581 passed (581)
                                            (568 pre-existing + 13 in chartEngineDecorationMigration.test.ts)

WITHOUT the patch (working tree at BASE + this branch's commits):
npx tsc --noEmit                          → exit 0
VITEST_MAX_THREADS=3 npx vitest run (same subset) → 581 passed (581)
git apply --check docs/chart-engine/migration/M03_DECOR.patch → clean
```

### Falsifiers (mutate `lib/chart-engine/lwc/index.ts`, run the committed test, restore)

| Mutant | RED | 
|---|---|
| kill marker-plugin reuse (`if (false && this.markersPlugin)`) | `expected "spy" to be called 1 times, but got 10 times` — 3 tests red |
| skip previous-watermark detach (`prev && false`) | `expected [] to have a length of 9 but got +0` — 2 tests red |
| `PriceLineHandle.remove()` no-op | `expected [ LwcPriceLineHandle{ …(4) } ] to have a length of +0 but got 1` — 3 tests red |
| break wrapper memoization (`!w \|\| true`) | `expected [Function w] to be [Function w] // Object.is equality` — 1 red |
| drop watermark `visible` flag (`visible: true` hard-coded) | `expected true to be false // Object.is equality` — 1 red |
| restore | `Tests 13 passed (13)` (GREEN) |

Strict M03-A03 (scratch, NOT committed — it must fail at BASE): with the adapter
re-key, `Tests 2 passed`; against the BASE adapter, `2 failed` —
`expected [ { …(20) } ] to deeply equal [ LwcSeriesHandle{ …(10) } ]` (raw keys leak)
and `expected […] to have a length of 2 but got 3` (foreign raw series leaks). This is
the evidence that the adapter change is real and necessary.

---

## 4. M03-A04 — z-order / screenshot guarantee (documented from LWC 5.2 source)

`takeScreenshot()` delegates to `chart.takeScreenshot()`, which re-renders every pane
through the SAME painter pipeline into a fresh canvas (`_internal_takeScreenshot` →
`traverseLayout(ctx)` — verified in `node_modules/lightweight-charts/dist/lightweight-
charts.development.mjs` 10775–10787). Hiding is OPTION state on the live instance
(watermark `visible:false` via spec replace; price line `lineVisible:false` via
`applyOptions`), so the screenshot rasterizes the same hidden instances — hidden stays
hidden; no copy of a stale bitmap is involved.

Per-pane paint order (bundle-verified): `bottom` primitives' background pass → grid →
the series' own views (series, last-value line, custom price lines) → **`normal`
primitive views** → `top` views (last-price animation + `top` primitives). The text
watermark's pane views declare NO `zOrder()`, and the wrapper defaults missing zOrder
to `'normal'` (bundle 3178/3246: `zOrder?.() ?? 'normal'`) — so the watermark paints
ABOVE the grid and series, BELOW top primitives; session shading (`zOrder "bottom"`)
paints beneath everything; series markers ride their series' own primitive views.

---

## 5. Contract gap (adapter change carried in the patch)

`api.ts` documents `EngineMouseEventParams` as the LWC param passed through, but the
M03 ground truth (and law 1) require `seriesData` keyed by OWNED handles. At BASE_SHA
`wrapMouse` forwarded LWC's raw-keyed map (canvas crosshair.ts keys by series id —
the two impls disagreed). The patch's `lwc/index.ts` hunk adds `ownMouseParams()`:
re-keys `seriesData` (and `hoveredSeries` / `hoveredInfo.series`) through the engine's
native→handle registry, **adopting** foreign raw series (via `ISeriesApi.seriesType()`,
bundle-verified present in 5.2) so nothing leaks raw and the magnet candidate set is
preserved for consumers whose series are not yet engine-created; untypeable entries
are dropped rather than leaked. See RESULT.md PROPOSED_PATCHES for the same diff.

---

## 6. Risks / invariants

* **Marker ordering**: merged price-series markers are sorted ascending by time
  (homogeneous per chart: date strings daily / epoch numbers intraday) — LWC's plugin
  expects ordered markers.
* **Single-writer discipline**: only `applyPriceMarkers` may touch the price series'
  marker set; a future creator must register through `episodeSpecsRef` /
  `pinePriceShapesRef`, never call `setMarkers` directly.
* **Magnet candidate set**: with the patch, seriesData keys are owned/adopted handles
  — identical candidate set to BASE (adoption covers raw-created series). Once M01
  lands, adoption becomes a no-op path.
* **Pine overlay shapes on the price series** now share ONE marker set; two scripts'
  shapes at the same time are both present (merge), where BASE stacked two plugins —
  visually equivalent, lifecycle simpler (clear = remove from the merge).
* `priceSeriesRef` (raw) is untouched for M01 consumers; `priceSeriesHRef` is the
  decoration handle. Family switches remove the old series through
  `engine.removeSeries(oldHandle)` (plugin detach included).
