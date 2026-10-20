# Series-Marker Parity Audit — mm canvas engine vs lightweight-charts (PAR-MARKERS, 2026-10-20)

Read-only audit. mm = native canvas engine (`lib/chart-engine/canvas/`), reached through the
engine-neutral surface `lib/chart-engine/api.ts` (`SeriesHandle.setMarkers`, api.ts:323) and the
LWC delegate adapter (`lib/chart-engine/lwc/index.ts:606-616`). LWC = ground truth
`node_modules/lightweight-charts/dist/lightweight-charts.development.mjs` ("dev:<line>" below,
branch head 51f3c8feb). No .ts/.tsx was modified by this audit.

## 1. SUMMARY

- Verdict: **MINOR GAPS** — the full v5 option surface (six positions incl. `atPrice*`, four
  shapes, `size`/`text`/`id`/`price`) is accepted and every product-sent shape renders; the gaps
  are pixel-geometry and secondary-behaviour divergences, not missing capability.
- Top gap 1: marker **text label placement** — mm draws text to the RIGHT of the glyph
  (`decorations.ts:250-254`, `textAlign:"left"`, hardcoded `10px sans-serif` `decorations.ts:530`)
  while LWC centres text on the glyph x (`SeriesMarkersRenderer._internal__drawImpl` dev:15583-15587)
  and stacks it vertically: above the glyph for aboveBar (`fillSizeAndY` dev:15705-15708), below
  the glyph for inBar/atPriceMiddle (dev:15695-15698) and belowBar (dev:15719-15723), in the chart
  layout font (default `fontSize:12`, dev:12314,
  `_internal_setParams` dev:15534-15542). Every episode/Pine/RSPivot mark carries text, so this is
  the most visible difference.
- Top gap 2: **size + margin formula** — mm base glyph `clamp(barSpacing×0.6, 4, 14)`
  (`decorations.ts:107-110,167`) vs LWC `ceiledEven(clamp(barSpacing,12,30))`
  (`size()` dev:15388-15391 + `calculateShapeHeight` dev:15403-15405) and LWC per-shape shrink
  (`shapeSize` dev:15392-15401: circle ×0.8, square ×0.7) that mm does not apply
  (`paintMarker` decorations.ts:635-652 draws all shapes at full `size`). mm glyphs are ~40-60%
  of LWC's at normal spacings; mm stacks with a fixed 2px gap (`MARKER_GAP_PX` decorations.ts:113)
  vs LWC `shapeMargin = max(size(bs,0.1), 3)` (dev:15406-15408) plus 1.2×textHeight per labelled
  marker (dev:15707-15710, 15721-15723).
- Top gap 3: **no marker autoscale margins and no canvas hitTest** — LWC default
  `autoScale:true` adds `calculateShapeHeight×1.5 + shapeMargin×2` pane-edge margins
  (`_private__getAutoScaleMargins` dev:15933-15954, defaults dev:15383-15386); mm's price scale
  never consults markers (`scales.ts` has zero marker references; markers live only on
  `SeriesModel` `model.ts:96`), so aboveBar/belowBar glyphs clip against a tight fit. LWC also
  exposes `hitTest` returning `{externalId, itemType:'marker'}`
  (`SeriesMarkersRenderer._internal_hitTest` dev:15543-15557); mm canvas has no marker hit path
  (`canvas/input.ts` has no marker references; only the DOM overlay tooltip exists —
  `lib/markerTooltip.ts`, pinned by `e2e/marker-tooltip.spec.ts`).
- Also: LWC re-anchors a marker whose time has no data row to the NEAREST data bar
  (`_private__recalculateMarkers` dev:15973-16017), mm silently drops it
  (`rowsIndexFor.indexOfTime(..., "exact")` `frame.ts:197`, drop counted `decorations.ts:176-181`) —
  low product impact because every caller pre-snaps (see §5); `price` missing on `atPrice*` throws
  in LWC (dev:15994-15996) vs mm `dropped++` (decorations.ts:225-233).

## 2. API SURFACE

| LWC marker option (dev) | mm support | Evidence |
|---|---|---|
| `time: Time` — logical-mapped, nearest-data re-anchor (dev:15973-15990 `_private__recalculateMarkers`, `dataByIndex` NearestLeft/NearestRight dev:15983-15986) | PARTIAL — exact-time only; unmatched time silently dropped | mm `frame.ts:197` (`seriesIndexOfTime(s,t,"exact")`, `model.ts:429-441`), drop `decorations.ts:176-181`; LWC dev:15983-15986 |
| `position: aboveBar\|belowBar\|inBar` (dev:15692-15731 `fillSizeAndY`) | MATCH (accepted + painted) | mm `api.ts:112-118` `EngineMarkerPosition`, layout `decorations.ts:197-221`; adapter forwards untranslated `lwc/index.ts:606-610` |
| `position: atPriceTop\|atPriceBottom\|atPriceMiddle` (v5; dev:15651-15653 `isPriceMarker`, anchors dev:15692-15731, price required else throw dev:15994-15996) | MATCH on anchors, PARTIAL on error (missing/NaN `price` → `dropped++`, no throw) | mm `api.ts:112-118`, `decorations.ts:222-238`; LWC dev:15702-15704/15716-15718/15693-15694 |
| `shape: circle\|square\|arrowUp\|arrowDown` (dev:15608-15626 `drawShape`) | MATCH (set equal; glyph GEOMETRY differs, see §3) | mm `api.ts:119`, paint `decorations.ts:635-652`; LWC dev:15608-15626 |
| `color: string` (dev:15601 `ctx.fillStyle = item._internal_color`) | MATCH — mm carries spec colour verbatim, never invents (empty string → skip) | mm `decorations.ts:247`, skip guard `decorations.ts:631`; law comment `decorations.ts:13-15`; LWC dev:15601 |
| `size?: number` multiplier — `isNumber(size)?max(size,0):1`, NO upper clamp; `0` → invisible (dev:15687, dev:15609-15611 size===0 early return) | PARTIAL — `size>0 ? size : 1` (non-positive ⇒ base size, NOT hidden) | mm `decorations.ts:182-189`; LWC dev:15687, dev:15609-15611 |
| `text?: string` — painted, centre-x, stacked vertically (§3) (dev:15695-15723, dev:15583-15587) | PARTIAL — painted but anchored right of glyph, fixed font | mm `decorations.ts:250-254,530,657-666`; LWC dev:15586 |
| `id?: string` — read back on hitTest as `externalId` (dev:15543-15557, stored dev:15791) | PARTIAL — field accepted (`api.ts:126`), stored, but never read anywhere in the canvas engine (no hitTest; §4) | mm `api.ts:121-131`; grep of `canvas/` finds no `marker.id` consumer; LWC dev:15554 |
| `price?: number` for atPrice* (dev:15654-15657 `getPrice`) | MATCH — projected via pane price scale, edge-touch anchor | mm `decorations.ts:225-238` (`projection.yOfPrice`); LWC dev:15654-15657 |
| `createSeriesMarkers(series, markers, options)` — `options.zOrder:'normal'\|'aboveSeries'`, `options.autoScale` (defaults dev:15383-15386; zOrder draw split dev:15558-15571, paneView.zOrder dev:15780-15782) | MISSING on mm canvas — `setMarkers(marks)` has no options arg; LWC delegate passes none either (engine defaults hold) | mm `api.ts:323`, `lwc/index.ts:606-616` (`createSeriesMarkers(this.series, lwcMarks)` no 3rd arg); LWC `createSeriesMarkers` dev:16082 |
| plugin `markers()` getter (dev `SeriesMarkersPrimitiveWrapper.markers()` dev:16047) | MISSING — mm `SeriesHandle` has no readback | mm `api.ts:315-345` surface listing; LWC dev:16045-16050 |
| lazy plugin creation (LWC always a primitive; mm adapter mirrors) | MATCH (adapter) — first `setMarkers` creates, later calls reuse | mm `lwc/index.ts:606-616` + tests `lib/__tests__/lwcAdapter.test.ts:572-591` |

## 3. GEOMETRY

| Aspect | LWC (dev) | mm (file:line) | Verdict + numbers |
|---|---|---|---|
| Base glyph size | `calculateShapeHeight` dev:15403-15405 = `ceiledEven(clamp(barSpacing,12,30))` (`size()` dev:15388-15391, MinShapeSize 12 / MaxShapeSize 30) | `decorations.ts:107-110,167` `clamp(barSpacing×0.6, 4, 14)` | GAP — at bs=10: LWC 12 vs mm 6; bs=20: LWC 20 vs mm 12; bs=30+: LWC 30 vs mm 14. mm ~half-size; no odd/even pixel parity (mm snaps device px `decorations.ts:58-62,240-241` vs LWC `ceiledEven/ceiledOdd` dev:4069-4077 + bitmap tick correction dev:15591-15599) |
| Per-shape shrink | `shapeSize` dev:15392-15401: arrow ×1.0, circle ×0.8, square ×0.7 (each ceiledOdd), then −1px in draw (`drawCircle` dev:15478-15482, `drawSquare` dev:15494-15499) | `paintMarker` decorations.ts:635-640 — circle `arc(r=size/2)`, square `rect(size×size)`, no −1 or ×0.8/×0.7 | GAP — mm circle Ø=12 at bs20 vs LWC Ø=`ceiledOdd(20×0.8)−1`=15; mm square side 12 vs LWC 13 (`ceiledOdd(14)−1`) |
| Arrow glyph form | `drawArrow` dev:15419-15446 — chevron head + rectangular stem (halfBase from `ceiledOdd(size/2)`) | `decorations.ts:641-652` — plain filled triangle, w=h=size | GAP — different silhouette (LWC arrow has a stem) |
| Size multiplier | `fillSizeAndY` dev:15687 `max(size,0)` default 1; NO clamp; size 0 ⇒ skipped dev:15609-15611 | `decorations.ts:182` `size>0 ? size : 1`; result `base×mult`, dropped only if non-finite/≤0 `decorations.ts:186-189` | GAP (edge) — `size:0`: LWC hides, mm draws base; `size:4` at bs=20: LWC 80px vs mm 48px (mm clamp is on the BASE, not the product) |
| Shape margin | `shapeMargin` dev:15406-15408 = `max(clamp(bs,12,30)×0.1 ⇒≥1, 3)` ⇒ ≥3px; initial aboveBar/belowBar offset = shapeMargin per bar (`SeriesMarkersPaneView._internal__makeValid` dev:15812-15823) | first aboveBar `y = highY − size/2` (`decorations.ts:208`) — glyph bottom exactly ON the high, no margin; belowBar mirror `decorations.ts:212` | GAP — mm sits 3+px closer to the bar; e.g. bs=20 LWC first-above centre = highY−10−3, mm = highY−6 |
| Stacking >1 marker/bar | per-bar running `offsets` reset on time change (dev:15819-15823); each marker adds `shapeSize+shapeMargin` and, with text, `textHeight×1.2` (dev:15707-15710, 15721-15723); assumes markers sorted ascending (visible culling `visibleTimedValues` dev:15817) | per-bar Maps `topEdge`/`bottomEdge` `decorations.ts:171-174`; step = `size + MARKER_GAP_PX(2)` `decorations.ts:208,212`; text adds no vertical cost | GAP (numbers: 2px vs ≥3px + text height) — direction/monotonicity MATCH; mm is order-insensitive (Map keyed by bar), LWC mis-stacks on unsorted input; product sorts ascending (`ChartPanel.tsx:1586`, `RSPivotChart.tsx:50`) |
| aboveBar/belowBar anchor (candles) | OHLC high/low (`getPrice` dev:15664-15676) | `frame.ts:193-202` `rowsIndexFor` highY/lowY via `yOfRow` `frame.ts:185-191` → row.high / row.low | MATCH |
| aboveBar/belowBar anchor (line/area series) | value data ⇒ `seriesData.value` for ALL positions (dev:15658-15659) — above/below/in share one anchor | `yOfRow` falls back `seriesClose(row)` = `value` (`frame.ts:185-191`) — highY=lowY=closeY | MATCH (anchors); stacking direction still differs only by the margin above |
| inBar anchor | OHLC close (dev:15662-15663); value data → value | `y = closeY` `decorations.ts:215-221` | MATCH |
| atPrice* anchors | `marker.price` → coord; top = priceY−halfSize, bottom = priceY+halfSize, middle = priceY; `ignoreOffset` (no stacking, no margin) dev:15685, 15702-15731 | `decorations.ts:222-238` — identical three anchors, offset 0 | MATCH |
| Inverted price scale | aboveBar uses LOW and belowBar HIGH when `invertScale` (dev:15665-15676) | mm anchors high/low regardless of scale inversion (`frame.ts:198-200`; inversion handled only in `yOfPrice`, `scales.ts:272`) | GAP (edge) — on an inverted pane mm's aboveBar lands on the visual bottom; no product caller inverts (§5) |
| Text font | chart layout: `makeFont(layout.fontSize, layout.fontFamily)` dev:273-277, defaults `fontSize:12` dev:12314 + `defaultFontFamily` dev:263; renderer params dev:15534-15542 | `MARKER_TEXT_FONT = "10px sans-serif"` hardcoded `decorations.ts:530`, set in `paintMarker` `decorations.ts:662` | GAP — −2px and different family; text height LWC feeds stacking (1.2×fontSize) vs mm none |
| Text placement | centred on glyph x: `text.x = item.x − width/2` (`_internal__drawImpl` dev:15583-15587, `drawText` dev:15509-15513); vertical per position: inBar/belowBar/atPriceBottom BELOW glyph `y+halfSize+shapeMargin+0.6×textH` (dev:15697,15721), aboveBar/atPriceTop ABOVE glyph `y−halfSize−0.6×textH` (dev:15706) | right of glyph: `textX = x + size/2 + 2`, `textY = y`, `textAlign:"left"`, baseline middle (`decorations.ts:250-254`, `decorations.ts:662-665`) | GAP — horizontal vs vertical label layout; mm text can overrun neighbouring bars, LWC text never shifts x |
| Visibility culling | only `visibleRange` items laid out/drawn (dev:15817) | whole array laid out each change (from/to only key the memo) `decorations.ts:134-163`; offscreen x still painted — canvas clips | MATCH visually (perf note only) |
| Hidden series | `renderer()` null when `!series.options().visible` dev:15751-15753 | `seriesPaintable` gate `frame.ts:896-902`, loop `frame.ts:959-961` | MATCH |

## 4. RENDER ORDER + HIT

| Aspect | LWC (dev) | mm (file:line) | Verdict |
|---|---|---|---|
| Marker paint layer | markers are a paneView primitive; zOrder `'normal'` default paints after series geometry, `'aboveSeries'` diverts to `drawBackground` (dev:15558-15571; `zOrder()` → 'top' dev:15780-15782) | per pane: bottom primitives `frame.ts:948` → series geometry `frame.ts:952-956` → price lines then markers `frame.ts:958-963` → normal primitives `frame.ts:966` → watermark `frame.ts:968-975` → top primitives `frame.ts:990` (documented `frame.ts:3`, `decorations.ts:21-25`) | MATCH for the default zOrder: markers over series + price lines, under watermark. GAP: mm has no `aboveSeries`/top-layer option (§2) and always paints markers BEFORE normal primitives, where LWC's marker primitive (itself a primitive) shares the primitive z layer |
| Price lines vs markers | per-series pane views; markers paint after the series' own price-line view | `for (const part of ["priceLines","markers"])` `frame.ts:958` — all price lines first, then markers | MATCH (mm's z-order header `decorations.ts:21-25` documents price lines below markers) |
| Marker hitTest | `SeriesMarkersRenderer._internal_hitTest` dev:15543-15557 over the visible range; text rect OR shape (`hitTestItem` dev:15628-15634); tolerances: circle `2+size/2` (dev:15483-15490), square exact rect (dev:15500-15506), arrow rect-tol 2 + triangle-tol 3 (dev:15447-15476), text half-height (dev:15514-15518); returns `{zOrder, externalId, itemType:'marker'}` | **MISSING in the canvas engine** — no marker reference in `canvas/input.ts` (only comment `input.ts:19` pointing at the DOM layer); `MarkerSpec.id` never read; no `hitTest` on `SeriesHandle`/chart api (`api.ts:315-345`) | MISSING — but the product's marker tooltip need is served OUTSIDE the engine: JS hit test over the SVG signal overlay in `lib/markerTooltip.ts` (hit test ~dev-local `markerTooltip.ts:66-73`, centre-distance resolution), wired at `ChartPanel.tsx:107,4197-4229,5043-5055`; pinned by e2e `terminal/e2e/marker-tooltip.spec.ts` (claims 1 DISPLAY + 2 "THE CHART STILL WINS", spec lines 10-31). `hitTest … when the product needs it`: the product does not currently need engine-level marker hit (tooltip layer owns it); `id` readback/selection would |
| Autoscale margins | marker primitive contributes `above/below = shapeHeight×1.5 + shapeMargin×2` when `autoScale` (default true, dev:15383-15386; margins dev:15933-15954; `calculateAdjustedMargin` halves it when only inBar exists, 0 when no bar-position markers dev:15409-15418,15923-15930) | none — `canvas/scales.ts` never consults `SeriesModel.markers` (`model.ts:96`); margins come only from `priceScale().applyOptions` (`scales.ts:81-82`) | GAP (consequence) — a pane auto-fit to bars clips aboveBar/belowBar glyphs+text that LWC would keep inside |

## 5. PRODUCT USAGE (gap ranking basis)

Callers found by `grep -rn "setMarkers\|createSeriesMarkers" terminal/lib terminal/components`
(non-test hits):

- `components/ChartPanel.tsx` — engine-neutral `SeriesHandle` (mm canvas when engine=canvas):
  - MACD-RSI cross dots: `{position:"atPriceMiddle", price, shape:"circle", size:1, colour dirUp()/dirDown()}` — `ChartPanel.tsx:1516-1521` (`applyMacdMarkers` on the line series' OWN handle).
  - TTM-squeeze tier dots: `{position:"inBar", shape:"circle", size:1, tier colours #e8a33d/#e8734d/#f0566b}` on the histogram — `ChartPanel.tsx:2109-2115`.
  - ONE shared writer for the price series: episode marks + price-anchored Pine shapes merged and
    sorted ascending, `ChartPanel.tsx:1577-1588` (`applyPriceMarkers`, sort :1586); ownership census
    `ChartPanel.tsx:3439-3443`; lazy-plugin comment :729-731, :2105-2106.
  - Episode marks source `lib/dislocations/episodeMarks.ts:148-196`: positions aboveBar/belowBar;
    shapes arrowUp/circle/arrowDown/square; **text** (bilingual) + **id** + `size:1`; times
    pre-snapped to bars in `lib/dislocations/episodeChartTimes.ts:60-79` (`snapToBars` → exact hit).
  - Pine shapes `lib/pine-engine/runtime.ts:85,879` (aboveBar/belowBar/inBar; 4 shapes; text incl.
    "★" BUY/SELL `ChartPanel.tsx:2753`) → `lib/pineChartLayer.ts:166-177` `anchor.setMarkers`
    (no `size`, no `price`, no `id` — `price` is only present for atPrice*), merged writer path
    `pineChartLayer.ts:175-177`.
- `components/workspaces/RSPivotChart.tsx:40-50` — belowBar circle/arrowUp + aboveBar arrowDown,
  text labels, default size, sorted ascending :50.
- `components/surface/StrikeEvolutionModal.tsx:19-26,177-183` — uses REAL LWC `createSeriesMarkers`
  (inBar circle + text) — a reference render for visual diffing, not the mm engine.
- Engine-internal probes: `lib/chart-engine/conformance.ts:349-351` (both engines receive aboveBar,
  then belowBar, then `[]`); bench `lib/chart-engine/bench/mount.ts:246-247`; census
  `lib/__tests__/fixtures/chart-engine/gap-census/api-census.json:1048` (`SeriesHandle.setMarkers`
  callers row).

Consequences for ranking: **no product caller ever sends `atPriceTop`/`atPriceBottom`** (grep over
components + pine engine: none), `size` is always 1/omitted, times are always bar-exact, and no
caller inverts a price scale. That demotes the exact-time-drop, size-multiplier-0, inverted-anchor
and price-throw gaps. What ships text on above/below markers (episodes, Pine, RSPivot) is exposed
to gaps #1/#2 (text placement, size/margins), and every fit-content pane is exposed to gap #3
(autoscale margins). `id` is sent (episodes) but only consumed by the DOM tooltip path today.

## 6. PROPOSED TESTS (vitest, `lib/__tests__/`)

Pattern: pure-layout tests call `layoutMarkers` with a stub `Projection`/`RowsIndex`
(`canvas/decorations.ts:79-84,38-47`); paint tests use the fake-ctx recorder of
`lib/__tests__/chartEngineInputHitRegions.test.ts:7-13` (`Ctx.__calls` / `rec(method)`).
LWC numbers below are the dev-dist constants, so each assertion is falsifiable from both sides.

1. `layoutMarkers: glyph base follows LWC calculateShapeHeight=ceiledEven(clamp(bs,12,30))` —
   barSpacing 20, marker `size:1`: expect `result.markers[0].size === 20` (LWC dev:15388-15405).
   EXPOSES GAP (mm yields `clamp(12,4,14)=12`, decorations.ts:167). PASSES once geometry adopts LWC.
2. `layoutMarkers: atPriceTop/Bottom/Middle anchor = priceY ∓ size/2 / priceY, offset-free` —
   projection `yOfPrice: p→200-p`, `atPriceTop price:150`: expect `y === 50 + …` concretely
   `yOfPrice(150) − size/2` and second marker on the SAME price keeps the SAME y (no stacking).
   PINS MATCH (decorations.ts:222-238 vs dev:15685,15702-15731).
3. `layoutMarkers: first aboveBar sits shapeMargin=max(size(bs,0.1),3) off the high; Nth stacks
   size+shapeMargin+1.2×textHeight` — barSpacing 20, two text markers: expect
   `y0 === highY − 10 − 3`, `y1 === highY − 20 − 3 − (20 + 3 + 14.4)` (dev:15406-15408,
   15707-15710). EXPOSES GAP (mm: `highY−6` then `highY−12−2`, no text cost, decorations.ts:204-209).
4. `paintDecorations text: recorder asserts ctx.font === layout font and fillText centred above
   belowBar glyph` — rec-ctx `paintDecorations(ctx,{markers:[…belowBar with text]}, {dpr:1})`:
   expect `fillText.args[0] === item.x − measureText/2` and `args[1] === y + size/2 + margin +
   0.6×fontSize` (dev:15583-15587, 15719-15723). EXPOSES GAP (mm: font `"10px sans-serif"`,
   `textX = x+size/2+2` left-aligned, decorations.ts:250-254,530).
5. `model autoscale: a pane whose only off-row content is one aboveBar marker widens its price
   range by LWC marginValue = shapeHeight×1.5 + shapeMargin×2` (dev:15933-15954) — call
   `ChartModel` fit/autoscale and assert the top price bound recedes. EXPOSES MISSING margin
   (scales.ts never reads `series.markers`).
6. `hitTest(marker centre) → {itemType:"marker", externalId:spec.id}` on the canvas engine —
   after `setMarkers([{id:"ep1",…}])`, a point at the glyph centre must return the id (dev:15543-15557).
   EXPOSES MISSING engine hit path; keep the DOM-overlay tooltip e2e
   (`e2e/marker-tooltip.spec.ts`) as the product-level guard for the shipped behaviour.

## 7. EXISTING TEST RUN

`cd terminal && npx vitest run lib/__tests__ -t marker` (2026-10-19, this worktree):

```
Test Files  46 passed | 731 skipped (777)
Tests  137 passed | 12912 skipped | 1 todo (13050)
Duration  23.59s
```

Marker-relevant suites that ran: `chartEngineCanvasPaint.test.ts:463` (inBar square paint),
`chartEnginePineRendering.test.ts:408-416` (merged writer, never raw setMarkers),
`lwcAdapter.test.ts:572-597` (lazy create + reuse of the LWC markers plugin),
`chartEnginePrimaryMigration.test.ts:397-415` (setMarkers REPLACE semantics),
`chartEnginePerfFrame.test.ts:121` (12-marker layout memo bench).

UNKNOWN register: (a) LWC `createSeriesMarkers` exact export line — read the wrapper/creator at
dev:16040-16070 but did not pin the single line; (b) whether mm ever plans a canvas-level marker
hitTest — checked `canvas/input.ts`, `primitives.ts`, `api.ts` SeriesHandle surface: no evidence
either way.
