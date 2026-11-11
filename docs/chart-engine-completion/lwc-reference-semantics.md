# LWC 5.2 reference semantics — formulas the native renderer must reproduce

LWCFACTS dossier for the P3 clean-room Canvas2D renderer (`terminal/lib/chart-engine/canvas/`).
Every formula and numeric constant below was read out of the vendored package installed at
BASE_SHA `c923cc46d179dd92cb6e3bd6d10c03c9bac17c76` (lightweight-charts 5.2.0). Nothing here
comes from memory or from the LWC website. Citation line numbers were pinned with
`grep -n` against the exact installed files and spot-verified by printing the cited line.

Citation shorthand (all paths relative to `terminal/`):

- **`dev:<line>`** = `node_modules/lightweight-charts/dist/lightweight-charts.development.mjs`
  (736,549 bytes, 16,430 lines — the unminified implementation actually read).
- **`types:<line>`** = `node_modules/lightweight-charts/dist/typings.d.ts` (156,435 bytes, 5,041 lines).
- **`fancy:<line>`** = `node_modules/fancy-canvas/<file>.mjs` (fancy-canvas 2.1.0, dependency
  of lightweight-charts 5.2.0, import at dev:7); the specific file is named in each citation.

A citation like `dev:6134` means "line 6134 of lightweight-charts.development.mjs".
Anything that could not be located in dist is listed in §9 "Unverified".

---

## 1. Time scale

### 1.1 Defaults

`timeScaleOptionsDefaults` (**dev:12345-12370**):

| option | default | cite |
|---|---|---|
| `rightOffset` | `0` | dev:12346 |
| `barSpacing` | `6` | dev:12347 |
| `minBarSpacing` | `0.5` | dev:12348 |
| `maxBarSpacing` | `0` (meaning: `width * 0.5`) | dev:12349, dev:6533-6541 |
| `fixLeftEdge` / `fixRightEdge` | `false` / `false` | dev:12350-12351 |
| `lockVisibleTimeRangeOnResize` | `false` | dev:12352 |
| `rightBarStaysOnScroll` | `false` | dev:12353 |
| `borderVisible` / `visible` | `true` / `true` | dev:12354, dev:12356 |
| `timeVisible` / `secondsVisible` | `false` / `true` | dev:12357-12358 |
| `shiftVisibleRangeOnNewBar` | `true` | dev:12359 |
| `allowShiftVisibleRangeOnWhitespaceReplacement` | `false` | dev:12360 |
| `ignoreWhitespaceIndices` | `false` | dev:12365 |
| `enableConflation` / `conflationThresholdFactor` | `false` / `1` | dev:12366-12367 |

Chart-level `rightOffsetPixels` is absent from defaults (undefined ⇒ bar-unit mode; the
pixel-mode branches are cited in §1.5).

### 1.2 indexToCoordinate — the exact mapping

`TimeScale._internal_indexToCoordinate(index)` (**dev:6134-6142**):

```
deltaFromRight = baseIndex + rightOffset - index          // dev:6139
x = width - (deltaFromRight + 0.5) * barSpacing - 1       // dev:6140
```

- Guard: returns `0` when the scale is empty **or** the index is not an integer
  (`isInteger`, dev:6135-6137). Fractional logicals go through
  `_private__coordinateToFloatIndex`, not this function.
- `width` is the plot width (pane width minus price axes; §6.3).
- The `+0.5` centres a bar in its slot; the `-1` pins the right border one
  device-independent pixel inside the right edge (LWC measures the right border at
  `width - 1`: `_private__rightOffsetForCoordinate`, **dev:6488-6489**, returns
  `(width - 1 - x) / barSpacing`).

Equivalence with the contract convention (`x = (i - visibleFrom + 0.5) * barSpacing`):
from `_private__updateVisibleRange` (**dev:6510-6520**)
`rightBorder = rightOffset + baseIndex` and `leftBorder = rightBorder - width/barSpacing + 1`,
so with `visibleFrom = leftBorder` the two formulas produce the same pixel with the same
off-by-one — the contract's convention is the left-anchored restatement of dev:6139-6140,
and the native renderer may use either as long as the `width - 1` anchor is kept.

### 1.3 coordinateToIndex

- `_internal_coordinateToIndex(x)` (**dev:6154-6161**) = `Math.ceil(floatIndex(x))`
  (the `Math.ceil` is dev:6155) where `floatIndex(x)`
  (`_private__coordinateToFloatIndex`, **dev:6491-6497**) is
  `index = baseIndex + rightOffset - (width - 1 - x)/barSpacing`, then
  `Math.round(index * 1000000) / 1000000` (dev:6497) to kill FP noise.
- With `ignoreWhitespaceIndices: true` and `considerIgnoreWhitespace` (the crosshair path
  passes `true`), a whitespace index is replaced by the nearest index that has data,
  walking outward around the rounded value (**dev:6161-6163**, generator
  `testNearestIntegers` dev:6698-6708).
- Public `coordinateToLogical` (**dev:12919-12923**) returns `null` on an empty scale,
  else this value; `logicalToCoordinate` is dev:12910-12917.

### 1.4 baseIndex

- `baseIndex()` = `_baseIndexOrNull || 0` (**dev:6382-6386**).
- `_baseIndexOrNull` is set by `_internal_setBaseIndex` (**dev:6263-6268**) from the
  DataLayer's `_private__getBaseIndex()` (**dev:11764-11776**): the **max over all series
  of that series' last row index** (the max is dev:11772; `null` when there is no data).
  baseIndex is the right edge of the *data*, not of the viewport: `rightOffset` is
  measured from it.

### 1.5 rightOffset, fitContent, scrollToRealtime / scrollToPosition

- `_internal_setRightOffset(offset)` (**dev:6163-6169**) sets the offset then
  `_private__correctOffset()` (**dev:6574-6585**) clamps it: minimum
  `firstIndex - baseIndex - 1 + barsEstimation` where
  `barsEstimation = fixLeftEdge ? width/barSpacing : min(2, points.length)`
  (`MinVisibleBarsCount = 2`, **dev:6588-6597**, the min at dev:6596); maximum
  `fixRightEdge ? 0 : width/barSpacing - min(2, points.length)` (**dev:6599-6603**).
  So at least ~2 bars of history stay reachable and the future side is bounded by one
  viewport minus 2 bars.
- `_internal_fitContent()` (**dev:6404-6413**): `setVisibleRange(Range(first, last +
  rightOffsetBars), true)` where `rightOffsetBars = options.rightOffset` when
  `rightOffsetPixels` is undefined (dev:6412); `_internal_setVisibleRange`
  (**dev:6389-6402**) then sets `barSpacing = (width - pixelOffset) / count`,
  `rightOffset = range.right - baseIndex`, and — because `applyDefaultOffset` is true —
  overrides `rightOffset` with `rightOffsetPixels ? pixelOffset/barSpacing :
  options.rightOffset` (dev:6395-6398). fitContent therefore shows **all bars plus the
  option rightOffset**, at the bar spacing that exactly consumes the width.
- `setVisibleLogicalRange` (public, **dev:12900-12904**, asserts `from <= to`) →
  `_internal_setLogicalRange` (**dev:6415-6417**) = `setVisibleRange(Range(from,to))`
  with `applyDefaultOffset = false`: **an explicit range does NOT add rightOffset** —
  the caller must add its own future gutter (this is why `viewReset.ts`
  `withChartFutureOffset` exists).
- `_internal_scrollToRealTime()` (**dev:6346-6348**) =
  `scrollToOffsetAnimated(options.rightOffset)`; `_internal_scrollToOffsetAnimated`
  (**dev:6349-6368**) defaults to **400 ms** (`Constants.DefaultAnimationDuration`,
  dev:6349) of linear interpolation `source + (offset - source) * progress`; throws
  `RangeError` for non-finite offset or duration ≤ 0 (dev:6350-6354).
- Public `scrollToPosition(position, animated)` (**dev:12862-12868**): not animated →
  `setRightOffset(position)`; animated → the same animation with **1000 ms**
  (`Constants.AnimationDurationMs`, dev:12867).
- Zoom changes to barSpacing re-derive rightOffset when in `rightOffsetPixels` mode:
  `_internal_setBarSpacing` (**dev:6173-6188**) keeps the *pixel* offset via
  `newRightOffset = rightOffset * oldBarSpacing / newBarSpacing` (dev:6176-6180).
- Width change with `lockVisibleTimeRangeOnResize` keeps the logical window instead:
  `newBarSpacing = barSpacing * newWidth / oldWidth` (**dev:6112-6115**).

### 1.6 time ⇄ coordinate, whitespace and beyond-data points

- `timeToIndex(time, findNearest)` (**dev:6037-6053**): binary search (`lowerBound`) over
  the point list; returns `null` when `time > last point` unless `findNearest` (then the
  last index, dev:6042-6044), `null` when `time` falls strictly between points unless
  `findNearest` (then the next index, dev:6046-6051).
- `timeToCoordinate(time)` (**dev:12931-12936**) = `indexToCoordinate(timeToIndex(time,
  false))` (the `false` call is dev:12932); **null for any time that is not an exact grid
  point** — a future time or a non-sampled intraday second has no coordinate.
- `coordinateToTime(x)` (**dev:12938-12944**) = `points[coordinateToIndex(x)].originalTime`.
- Whitespace rows (`{time}` with no value) DO occupy grid slots: the DataLayer creates a
  time-point entry for every data item, valued or not (`createEmptyTimePointData`,
  **dev:11523**), so a whitespace tail extends the index space exactly like real bars
  and `timeToCoordinate` resolves against it. Gap *rendering* (no line across) comes
  from the series having no plot row there, not from the scale skipping the slot
  (custom-series whitespace check dev:12073-12075; hit-test skips whitespace at dev:12085).
- `getVisibleRange()` (time range, **dev:12872-12882**) is the strict range mapped through
  `indexToTimeScalePoint` clamped to `[firstIndex, lastIndex]`
  (`_internal_timeRangeForLogicalRange`, **dev:6078-6086**) — the time range can never
  name a future/whitespace slot outside the data. `logicalRangeForTimeRange`
  (**dev:6088-6093**) uses `findNearest = true` on both ends.

### 1.7 Logical range vs visible (strict) range

- `_internal_visibleLogicalRange()` (**dev:6063-6065**) returns the **fractional**
  `RangeImpl(leftBorder, rightBorder)` computed in §1.2 — `from`/`to` are floats, `to`
  is the right border (bar centres are at integer logicals; a bar is visible when
  `from <= i <= to`).
- `_internal_visibleStrictRange()` (**dev:6059-6061**) = `Range(floor(left), ceil(right))`
  (`TimeScaleVisibleRange._internal_strictRange`, **dev:5940-5947**) — integer indices of
  every bar whose slot intersects the viewport.
- Subscribers fire only when the logical range actually changed
  (`_private__setVisibleRange`, **dev:6626-6637**); the public handler receives
  `{from, to}` floats (dev:12890-12898 + dev:12960-12966).

### 1.8 Tick-mark weights (time labels)

`weightByTime(currentDate, prevDate)` (**dev:7587-7603**) compares **UTC** fields of
consecutive points:

| weight | condition | cite |
|---|---|---|
| `70` Year | `getUTCFullYear()` differs | dev:7588-7589 |
| `60` Month | `getUTCMonth()` differs | dev:7591-7592 |
| `50` Day | `getUTCDate()` differs | dev:7594-7595 |
| intraday | first divisor (scanned largest→smallest) whose `floor(ts / divisor)` differs | dev:7597-7600 |
| `0` LessThanSecond | none of the above | dev:7601 |

Intraday divisors (**dev:7577-7585**): `1s→10`, `1m→20`, `5m→21`, `30m→22`, `1h→30`,
`3h→31`, `6h→32`, `12h→33` (`hours/minutes/seconds` helpers dev:7568-7575).

Label text by weight (`weightToTickMarkType`, **dev:7706-7728**):
Year(70)→`Year`; Month(60)→`Month`; Day(50)→`DayOfMonth`; minute/hour weights→
`timeVisible ? Time : DayOfMonth`; second weights→`timeVisible ? (secondsVisible ?
TimeWithSeconds : Time) : DayOfMonth`.

### 1.9 Which marks are drawn (collision)

- Estimated label width (`TimeScale._internal_marks`, **dev:6191-6260**):
  `pixelsPer8Characters = (fontSize + 4) * 5` (**dev:6200**);
  `maxLabelWidth = pixelsPer8Characters / 8 * (tickMarkMaxCharacterLength || 8)`
  (**dev:6201-6202**, `defaultTickMarkMaxCharacterLength = 8` at dev:5954);
  `indexPerLabel = round(maxLabelWidth / barSpacing)` (**dev:6203**).
- `TickMarks._internal_build` (**dev:5844-5858**) computes
  `maxIndexesPerMark = ceil(maxWidth / spacing)` (dev:5845) and
  `_private__buildMarksImpl` (**dev:5877-5920**) walks weights **highest first**,
  keeping a mark only if `rightIndex - currentIndex >= maxIndexesPerMark &&
  currentIndex - leftIndex >= maxIndexesPerMark` (dev:5912) — i.e. ≥
  `maxIndexesPerMark` index-space to the kept neighbours on both sides.
- Edge alignment: when `barSpacing > maxLabelWidth / 2` labels are never coordinate
  aligned; otherwise labels within one `indexPerLabel` of a *fixed* edge may snap
  (**dev:6236-6245**).
- Bold-year special case: `maxTickMarkWeight` reduces any max weight strictly between
  Hour1(30) and Day(50) down to Hour1 (**dev:7798-7805**).

---

## 2. Price scale

### 2.1 Defaults

`priceScaleOptionsDefaults` (**dev:12326-12343**):

| option | default | cite |
|---|---|---|
| `autoScale` | `true` | dev:12327 |
| `mode` | `0` Normal | dev:12328 |
| `invertScale` | `false` | dev:12329 |
| `alignLabels` | `true` | dev:12330 |
| `borderVisible` / `borderColor` | `true` / `'#2B2B43'` | dev:12331-12332 |
| `entireTextOnly` | `false` | dev:12333 |
| `visible` | `false` (chart overrides: right `true`, left `false`) | dev:12334, dev:12385-12392 |
| `ticksVisible` | `false` | dev:12335 |
| `scaleMargins` | `{ top: 0.2, bottom: 0.1 }` | dev:12336-12339 |
| `minimumWidth` / `ensureEdgeTickMarksVisible` / `tickMarkDensity` | `0` / `false` / `2.5` | dev:12340-12342 |

### 2.2 Geometry

- `internalHeight = height - topMarginPx - bottomMarginPx`
  (`_internal_internalHeight`, **dev:4652-4658**; formula at dev:4656), where
  `topMarginPx = scaleMargins.top * height + marginAbove` and
  `bottomMarginPx = scaleMargins.bottom * height + marginBelow`; when inverted the two
  option margins swap (**dev:5033-5040**). `marginAbove/Below` come from series
  autoscale-info (§2.5) and `ensureEdgeTickMarksVisible` padding = `fontSize / 2`
  (dev:4986-4988).
- price → y (`_private__logicalToCoordinate`, **dev:5052-5063**), after percent/indexed
  transform (`_internal_priceToCoordinate`, **dev:4685-4692**):

```
invCoordinate = bottomMarginPx + (internalHeight - 1) * (logical - rangeMin) / rangeLength  // dev:5059-5060
y = inverted ? invCoordinate : (height - 1 - invCoordinate)                                 // dev:4683
```

- y → price (`_private__coordinateToLogical`, **dev:5064-5075**) is the exact inverse:
  `logical = rangeMin + rangeLength * (inv - bottomMarginPx) / (internalHeight - 1)`
  (dev:5071-5072).
- Batch forms used by renderers: `pointsArrayToCoordinates`
  (**dev:4694-4722**) / `barPricesToCoordinates` (**dev:4723-4758**) with
  `hmm = (internalHeight - 1) / (max - min)` — the same formula hoisted.
- Empty scale → both directions return `0` (dev:5056-5058, dev:5066-5068).

### 2.3 Log mode

`defLogFormula = { logicalOffset: 4, coordOffset: 0.0001 }` (**dev:4180-4183**).

```
toLog(price):     m = |price|;  m < 1e-15 → 0;
                  log = log10(m + coordOffset) + logicalOffset;  sign preserved   // dev:4215-4221
fromLog(logical): m = |logical|; m < 1e-15 → 0;
                  price = 10^(m - logicalOffset) - coordOffset;  sign preserved   // dev:4223-4229
```

`logFormulaForPriceRange(range)` (**dev:4255-4271**): `diff = |max - min|`; if
`diff >= 1 || diff < 1e-15` the default formula; else
`digits = ceil(|log10(diff)|)`, `logicalOffset = 4 + digits`,
`coordOffset = 1 / 10^logicalOffset`. Range conversion helpers dev:4231-4253.
(The repo's `terminal/lib/chart-engine/axisZoom.ts:75-103` mirrors these constants and
formulas — verified equal.)

### 2.4 Percentage and indexedTo100

Base value = the series' **first value** (`firstValue._internal_value`; each source's own
first value converts its range before merging, **dev:5092-5109** — the autoscale-info
loop, see §2.5).

```
fromPercent(v, base):      (v / 100) * base + base,   v negated when base < 0    // dev:4184-4189
toPercent(v, base):        100 * (v - base) / base, sign-flipped when base < 0   // dev:4190-4195
fromIndexedTo100(v, base): v -= 100; (v / 100) * base + base (v negated when base < 0) // dev:4199-4204
toIndexedTo100(v, base):   100 * (v - base) / base + 100, sign-flipped when base < 0  // dev:4206-4211
```

`priceToCoordinate` applies the forward transform then maps linearly;
`coordinateToPrice` (**dev:4759-4770**) inverts. Percentage/indexed scales refuse
axis-drag scaling (dev:4844-4849, dev:4859-4862) and force axis base `100`
(`_internal_updateFormatter`, **dev:4988-5022**) and `minMove = 1`
(`_internal_minMove`, **dev:5024-5026**).

### 2.5 Autoscale and the flat-data guard

`_private__recalculatePriceRangeImpl` (**dev:5080-5170**):

- For each visible source, `autoscaleInfo(left, right)` (dev:5100) yields a range; the
  mode converts it (log/percent/indexed, dev:5102-5115); ranges merge; per-source
  `margins.above/below` take running maxima (dev:5120-5128), plus `fontSize / 2` on both
  when `ensureEdgeTickMarksVisible` (dev:4982-4988).
- **Flat-data guard** (dev:5144-5159): if `min === max`, extend by
  `extendValue = 5 * minMove()` on both sides (`± 5 min-move`, dev:5144), converting out
  of log space and back when in log mode. `minMove()` = `1/base` of the formatter source,
  or `1` for percent/indexed (**dev:5024-5026**).
- Custom range wins when not autoScale (dev:5082-5084).

### 2.6 Tick span and label collision

- `PriceTickSpanCalculator._internal_tickSpan(high, low, maxTickSpan)`
  (**dev:4302-4339**): start `resultTickSpan = 10^max(0, ceil(log10(high - low)))`,
  divide by integral dividers while `resultTickSpan >= maxTickSpan * divider` (and > 1,
  and > minMovement `1/base`, epsilon `1e-14` `TickSpanEpsilon`); floor at
  `minMovement`; then `Math.max(1, …)`; fractional dividers `[2, 2.5, 2]` only for
  decimal bases (**dev:4280-4283**).
- `alignLabels` (`_private__alignLabels`, **dev:9367-9410**): when true,
  `_private__fixLabelOverlap` (**dev:9412-9436**) splits visible labels at the first
  source's centre coordinate, sorts top-part centre→top and bottom-part centre→bottom
  (sharing the centre label), clamps labels within `halfHeight` of either edge
  (dev:9429-9434), then `recalculateOverlapping(top, 1, height, …)` /
  `(bottom, -1, …)` (dev:9436-9437) — overlapping labels are hidden walking away from
  the centre.
- minMove → precision (`precisionByMinMove`, **dev:7389-7400**): decimals of minMove,
  capped at 8 (`minMove >= 1 → 0` at dev:7390); `priceFormat.minMove` given without
  `precision` derives precision this way (`patchPriceFormat`, dev:12996-13002).

---

## 3. Series

### 3.1 Common defaults (`seriesOptionsDefaults`, **dev:12-36**)

`title ''` (dev:13), `visible true` (dev:14), `hitTestTolerance 3` (dev:15),
`lastValueVisible true` (dev:16), `priceLineVisible true` (dev:17), `priceLineSource 0`
LastBar (dev:18), `priceLineWidth 1` (dev:19), `priceLineColor ''` (dev:20),
`priceLineStyle 2` Dashed (dev:21), `baseLineVisible true` (dev:22), `baseLineWidth 1`
(dev:23), `baseLineColor '#B2B5BE'` (dev:24), `baseLineStyle 0` Solid (dev:25),
`priceFormat { type 'price', precision 2, minMove 0.01 }` (dev:26-30).

### 3.2 Candlesticks

Defaults `candlestickStyleDefaults` (**dev:14760-14769**): `upColor '#26a69a'`,
`downColor '#ef5350'`, `wickVisible true`, `borderVisible true`, `borderColor '#378658'`,
`borderUpColor '#26a69a'`, `borderDownColor '#ef5350'`, `wickColor '#737375'`,
`wickUpColor '#26a69a'`, `wickDownColor '#ef5350'`.

- Body width `optimalCandlestickWidth(barSpacing, pixelRatio)`
  (**dev:14418-14432**): if `2.5 <= barSpacing <= 4` → `floor(3 * pixelRatio)`
  (special-case constants at dev:14419-14421); else
  `coeff = 1 - 0.2 * atan(max(4, barSpacing) - 4) / (π/2)` (reducing coeff 0.2,
  dev:14426), `res = floor(barSpacing * coeff * pixelRatio)`,
  `optimal = min(res, floor(barSpacing * pixelRatio))`, result
  `max(floor(pixelRatio), optimal)` (dev:14427-14431).
- Parity rule (**dev:14607-14613**): when `barWidth >= 2`, if
  `floor(pixelRatio) % 2 !== barWidth % 2` then `barWidth--` (dev:14612) — bodies keep
  the same odd/even parity as the 1px grid so the crosshair overlay stays symmetric.
- Wick width (**dev:14633-14635**):
  `wickWidth = max(floor(pixelRatio), min(min(floor(pixelRatio), floor(barSpacing*pixelRatio)), barWidth))`;
  wick left = `round(x*pr) - floor(wickWidth/2)`, clamped to `prevEdge + 1`
  (dev:14636-14649).
- Border width `_private__calculateBorderWidth` (**dev:14660-14675**):
  `borderWidth = floor(1 * pixelRatio)`, shrunk to `floor((barWidth-1)/2)` when
  `barWidth <= 2*borderWidth`; if `barWidth <= res*2` bodies are not drawn at all
  (border covers the candle, dev:14624-14626).
- Bodies: `left = round(x*pr) - floor(barWidth/2)`, `right = left + barWidth - 1`,
  top/bottom from `min/max(openY, closeY)`, left clamped to `max(prevEdge+1, left)`
  (`_private__drawCandles`, **dev:14677-14710**).

### 3.3 Bars (OHLC)

Defaults `barStyleDefaults` (**dev:14567-14770**): `upColor '#26a69a'`,
`downColor '#ef5350'`, `openVisible true`, `thinBars true`.

- Tick width `_private__calcBarWidth` (**dev:14504-14508**):
  `max(floor(pixelRatio), floor(optimalBarWidth(barSpacing, pixelRatio)))` where
  `optimalBarWidth = floor(barSpacing * 0.3 * pixelRatio)` (**dev:14415-14417**).
- Parity rule identical (dev:14454-14459). `thinBars` caps the stroke:
  `barLineWidth = thinBars ? min(barWidth, floor(pixelRatio)) : barWidth`
  (**dev:14461**).
- Open/close ticks drawn only when `barLineWidth <= barWidth && barSpacing >=
  floor(1.5 * pixelRatio)` (**dev:14463**); tick length `sideWidth =
  ceil(barWidth * 1.5)` (dev:14481); vertical tick thickness = `barLineWidth`
  (dev:14477-14497).

### 3.4 Line (types 0/1/2), point markers, area, baseline

Defaults `lineStyleDefaults` (**dev:13759-13773**): `color '#2196f3'`, `lineStyle 0`
Solid, `lineWidth 3`, `lineType 0` Simple, `lineVisible true`,
`crosshairMarkerVisible true`, `crosshairMarkerRadius 4`,
`crosshairMarkerBorderWidth 2`, `lastPriceAnimation 0` Disabled,
`pointMarkersVisible false`.

- LineType semantics (`walkLine`, **dev:13403-13517**): `0 Simple` = `lineTo`
  (dev:13471-13481); `1 WithSteps` = horizontal first `lineTo(currentX, prevY)` then
  vertical `lineTo(currentX, currentY)` (dev:13482-13499); `2 Curved` = cubic bezier
  with control points from `getControlPoints` (**dev:13520-13527**) using
  `curveTension = 6` (dev:13507): `cp1 = p0 + (p1 - p_prev)/6`,
  `cp2 = p1 - (p_next - p0)/6` (clamped neighbours, dev:13523-13526).
- Single visible point draws a horizontal segment `x ± barWidth/2` at the point's y
  (**dev:13415-13425**).
- Style runs are split by walking with a style getter; on change the path is finished
  and restarted (dash-offset continuity tracked, dev:13449-13469, dev:13512-13516).
- Point markers (`drawSeriesPointMarkers`, **dev:13366-13390**): radius =
  `pointMarkersRadius * verticalPixelRatio + (tickWidth % 2) / 2` (dev:13377) with
  `tickWidth = max(1, floor(horizontalPixelRatio))` (dev:13375); circles via
  `arc(cx, cy, r, 0, 2π)`. `pointMarkersRadius` falls back to `lineWidth / 2 + 2` when
  unset — hit-test at dev:13729, renderer data at dev:13751, baseline at dev:14264.
  Hit radius: `max(lineWidth/2, pointMarkersRadius ?? 0) + hitTestTolerance`
  (`hitTestLineSeries`, dev:13638).
- Conflated rows draw the extreme further from close
  (`LinePaneViewBase._internal__fillRawPoints`, **dev:13711-13740**):
  `value = |high-close| > |low-close| ? high : low`.
- Area defaults `areaStyleDefaults` (**dev:14382-14397**): `topColor
  'rgba( 46, 220, 135, 0.4)'`, `bottomColor 'rgba( 40, 221, 100, 0)'`,
  `invertFilledArea false`, `lineColor '#33D778'`, `lineWidth 3`, `lineType 0`. Fill:
  the path is walked with `lineWidth = 1` (**dev:14127**) and closed down to the base
  level: two `lineTo(..., baseLevelCoordinate)` then `closePath`/`fill`
  (`finishStyledArea`, **dev:14095-14102**); `baseLevelCoordinate` defaults to
  `invertFilledArea ? 0 : mediaSize.height` (dev:14117).
- Baseline defaults `baselineStyleDefaults` (**dev:14274-14301**): `baseValue { type
  'price', price 0 }`, `relativeGradient false`, `topFillColor1
  'rgba(38, 166, 154, 0.28)'`, `topFillColor2 'rgba(38, 166, 154, 0.05)'`, `topLineColor
  'rgba(38, 166, 154, 1)'`, `bottomFillColor1 'rgba(239, 83, 80, 0.05)'`,
  `bottomFillColor2 'rgba(239, 83, 80, 0.28)'`, `bottomLineColor 'rgba(239, 83, 80, 1)'`.
  `baseLevelCoordinate = priceToCoordinate(baseValue.price, firstValue)`
  (**dev:14227**). The fill is a vertical linear gradient with stops `topColor1` at 0,
  `topColor2` at `baselineRatio`, `bottomColor1` at `baselineRatio`, `bottomColor2` at
  1, `baselineRatio = clamp((baseline - top) / (bottom - top), 0, 1)`
  (`GradientStyleCache`, **dev:14132-14180**; ratio dev:14155, stops dev:14156);
  `relativeGradient` recomputes top/bottom from the visible items' min/max y
  (dev:14230-14343), otherwise the pane's full height is used (dev:14255-14257). The
  line itself is a second renderer with the same gradient built from the two line colors
  (`PaneRendererBaselineLine`, **dev:14187-14205**).

### 3.5 Histogram

Defaults `histogramStyleDefaults` (**dev:14940-1442**): `color '#26a69a'`, `base 0`.

- Column geometry (`_private__fillPrecalculatedCache`, **dev:14829-14898**):
  `spacing = ceil(barSpacing * pixelRatio) <= 1 ? 0 : max(1, floor(pixelRatio))`
  (`showSpacingMinimalBarWidth = 1`, **dev:14787**; formula dev:14834);
  `columnWidth = round(barSpacing * pixelRatio) - spacing` (dev:14835); odd widths
  split `left = x - (w-1)/2, right = x + (w-1)/2`, even widths shift one pixel left
  (dev:14840-14852); adjacent columns are re-joined to exact `spacing + 1` gaps
  (dev:14869, dev:14873); minimum width is aligned when `minWidth < 4`
  (`alignToMinimalWidthLimit = 4`, **dev:14788**, applied dev:14891-14901).
- Base: `histogramBase = priceToCoordinate(options.base, firstValue)`
  (**dev:14934**; hit-test variant dev:14914); baseline drawn `tickWidth =
  max(1, floor(verticalPixelRatio))` tall (dev:14806, dev:14808), columns from `y` to
  the base band (**dev:14806-14825**).

### 3.6 Whitespace, last value, price line

- Whitespace rows produce no plot row (gap) but keep their grid slot (§1.6); series data
  must be strictly ascending by time (`checkItemsAreOrdered` asserts, **dev:12560-12575**
  — the strict `<` at dev:12567; called from `setData`, **dev:12713-12718**).
- `lastValueVisible` / `priceLineVisible` / `priceLineSource` defaults in §3.1
  (dev:16-18). The series price line + last-value label are drawn from the last bar when
  `priceLineSource = 0` (`PriceLineSource.LastBar`, dev:18).
- `createPriceLine` merges `priceLineOptionsDefaults` (**dev:12618-12628**: `color
  '#FF0000'`, `price 0`, `lineStyle 2` Dashed, `lineWidth 1`, `lineVisible true`,
  `axisLabelVisible true`, `title ''`, `axisLabelColor ''`, `axisLabelTextColor ''`)
  then validates `typeof price === 'number'` (**dev:12763-12766**).

### 3.7 Markers (createSeriesMarkers plugin)

`createSeriesMarkers(series, markers, options)` (**dev:16082**). Sizing:

- `size(barSpacing, coeff) = ceiledOdd(min(max(barSpacing, 12), 30) * coeff)`
  (**dev:15388-15390**; `MinShapeSize 12`, `MaxShapeSize 30` in that clamp;
  `ceiledOdd` dev:4073-4076).
- `calculateShapeHeight(barSpacing) = ceiledEven(size(barSpacing, 1))`
  (**dev:15403-15405**; `ceiledEven` dev:4069-4071). Marker `size` option multiplies:
  `shapeSize = calculateShapeHeight(barSpacing) * max(size, 0)` (dev:15688).
- Per-shape widths (`shapeSize(shape, originalSize)`, **dev:15392-15401**): arrowUp/Down
  `1.0`, circle `0.8`, square `0.7` × the base size; arrows additionally draw a base of
  `ceiledOdd(size/2)` (dev:15419-15450); circle radius `(circleSize-1)/2`
  (dev:15478-15483); square side `squareSize` (dev:15494-15502).
- `shapeMargin(barSpacing) = max(size(barSpacing, 0.1), 3)` (`MinShapeMargin 3`)
  (**dev:15406-15408**).
- Anchoring price by position (`getPrice`, **dev:15653-15677**): `inBar` → `close`
  (dev:15661); `aboveBar` → `high` (or `low` when the scale is inverted);
  `belowBar` → `low` (or `high`); price positions (`atPriceTop/Bottom/Middle`) use
  `marker.price` directly and ignore stacking (dev:15685-15686).
- Stacking (`fillSizeAndY`, **dev:15680-15745**): `aboveBar` y = `priceToCoordinate -
  halfSize - offset` where `offset` accumulates `shapeSize + shapeMargin` per marker on
  the same bar (dev:15710); text sits another `halfSize + shapeMargin +
  textHeight * (0.5 + 0.1)` out (`TextMargin 0.1`, dev:15697) and grows the offset by
  `textHeight * 1.2` (dev:15707-15708); `belowBar` mirrors (dev:15714-15722);
  `inBar`/`atPriceMiddle` centre on the price (dev:15693-15701).

---

## 4. Crosshair

### 4.1 Modes

`CrosshairMode` (**dev:1237-1254**): `Normal 0`, `Magnet 1`, `Hidden 2`, `MagnetOHLC 3`.
Default `mode: 1` Magnet (`crosshairOptionsDefaults`, **dev:12291**); vert/horz lines:
color `'#9598A1'`, `width 1`, `style 3` LargeDashed, `labelVisible true`,
`labelBackgroundColor '#131722'` (**dev:12275-12290**, the label bg at dev:12281);
`doNotSnapToHiddenSeriesIndices false` (dev:12292).

### 4.2 Magnet target rule

`Magnet._internal_align(price, index, pane)` (**dev:3989-4030**):

- `Normal` returns the raw price untouched (dev:3991-3993).
- Otherwise the pane's default price scale converts the price to y; candidate ys are
  collected from every **visible, non-overlay** series that **contains `index`**
  (dev:3999-4015); Magnet uses `magnetPlotRowKeys = [Close]` (**dev:3976-3978**),
  MagnetOHLC uses `[Open, High, Low, Close]` (**dev:3979-3984**); each value is mapped
  to a y on that series' own scale.
- The candidate y nearest `|y_i - y|` wins and is converted back to a price on the
  default scale (dev:4023-4028). No candidates → raw price.

Index itself: `_internal_setAndSaveCurrentPosition` (**dev:7033-7052**) computes
`index = coordinateToIndex(x, /*considerIgnoreWhitespace*/ true)` (dev:7036), clamps it
into `visibleStrictRange` (dev:7038-7041), then optionally snaps to visible-series bars
when `doNotSnapToHiddenSeriesIndices` is on (`_internal_snapToVisibleSeriesIfNeeded`,
**dev:1353-1390**: nearest left/right search by `MismatchDirection`, closest coordinate
wins). In `Hidden` mode the crosshair line/labels are not drawn but the move events still
fire with the computed logical (dev:1179-1181).

### 4.3 Labels

The time-axis label (`CrosshairTimeAxisView`, **dev:1148-1204**): text =
`timeScale._internal_formatDateTime(point)` (dev:1196-1197) which is
`localization.timeFormatter(originalTime)` when provided, else the built-in
`formatHorzItem` (**dev:6419-6424**); background from `labelBackgroundColor` with
generated contrast foreground (dev:1199-1204); tick visible iff `timeScale.ticksVisible`
(dev:1202). Price-axis labels use the price-scale formatter through the crosshair's
value provider — for non-default scales the price is re-derived from the coordinate
(**dev:1266-1297**).

### 4.4 subscribeCrosshairMove param shape

`MouseEventParams` (**types:3392-3437**, built at **dev:11191-11228**, converted at
**dev:13258-13301**): `time` (originalTime of the applied index), `logical` (applied
index), `point {x, y}` (CSS px), `paneIndex`, `seriesData: Map<series, data>` —
populated per series via `bars._internal_search(index)` with the **default mismatch
mode `None`** (dev:11197, signature dev:2972), so a series with no bar exactly at that
logical is simply absent from the map; `hoveredInfo {type, sourceKind, objectKind,
series, objectId, paneIndex}` (types:3423, dev:7925-7935); `hoveredSeries`
(deprecated alias of `hoveredInfo.series`, types:3429, resolved dev:13285);
`hoveredObjectId` (deprecated); `sourceEvent` (the DOM mouse/touch event)
(types:3439).

`MismatchDirection` (**dev:2922-2935**): `NearestLeft = -1`, `None = 0`,
`NearestRight = 1`. `SeriesApi.dataByIndex(logicalIndex, mismatchDirection?)`
(**dev:12732-12740**, types:2485-2488) passes it to `bars._internal_search`
(**dev:2972-2988**); the private search returns the exact position, or with a non-None
mode the nearest occupied position left/right (`_private__searchNearestLeft`,
**dev:3028-3035**); whitespace returns `null` data.

On leave, the delegate fires with `(null, null, null)` (**dev:7070-7076**) → params with
`time/logical/point` undefined.

`hoveredSeries` semantics: the series whose painted item is under the pointer (hit-test
result, dev:7904-7924); `hoveredSeriesOnTop: true` (chart default, dev:12375) re-orders
that series last in draw order.

---

## 5. Interaction

### 5.1 Wheel zoom

`_private__onMousewheel` (**dev:11026-11044**):

```
deltaX = adjustment * event.deltaX / 100
deltaY = -(adjustment * event.deltaY / 100)                          // dev:11033
if (handleScale.mouseWheel && deltaY !== 0):
    zoomScale = sign(deltaY) * min(1, |deltaY|)                      // dev:11038
    anchorX  = event.clientX - element.getBoundingClientRect().left  // dev:11039
    model.zoomTime(anchorX, zoomScale)                               // dev:11040
if (handleScroll.mouseWheel && deltaX !== 0):
    model.scrollChart(deltaX * -80)   // 80 = made-up coefficient, natural-scroll sign // dev:11043
```

`_determineWheelSpeedAdjustment` (**dev:11007-11024**): `deltaMode === DOM_DELTA_PAGE →
120` (dev:11011), `DOM_DELTA_LINE → 32` (dev:11014), otherwise `1`; on Windows Chromium
`1 / window.devicePixelRatio` (bug workaround, dev:11024).

`Model._internal_zoomTime(pointX, scale)` (**dev:6987-6997**) clamps the anchor to
`[1, timeScaleWidth]` (dev:6993), then `TimeScale._internal_zoom` (**dev:6277-6289**):
`newBarSpacing = barSpacing + scale * (barSpacing / 10)` (dev:6280; scale is in tenths
of bar spacing), applied via `_internal_setBarSpacing` (clamps, §1.1); when
`!rightBarStaysOnScroll` the right offset is corrected so the float index under the
anchor returns to its original coordinate (dev:6283-6286). Positive scale = zoom in.
One notch (deltaY ±100 → zoomScale ±1) = ±10% bar spacing anchored at the cursor.

### 5.2 Pinch

`_internal_pinchStartEvent` stops any time-scale animation and resets
`_prevPinchScale = 1` (**dev:9730-9734**); `_internal_pinchEvent(middlePoint, scale)`
(**dev:9734-9742**), gated by `handleScale.pinch`: `zoomScale = (scale -
_prevPinchScale) * 5` (dev:9738), then the same `zoomTime(middlePoint.x, zoomScale)` —
the pinch midpoint is the anchor.

### 5.3 Pressed-move pan

`TimeScale._internal_scrollTo(x)` (**dev:6329-6338**):
`shiftInLogical = (scrollStartPoint - x) / barSpacing` (dev:6333) applied to the right
offset saved at drag start (`_internal_startScroll`, dev:6319-6328); `_correctOffset`
clamps. Dragging right moves to older data. The same drag starts price-axis scroll
(`model.startScrollPrice/scrollPriceTo`, **dev:10101-10110**) — but only when the scale
is not autoScale (dev:6953-6956); price scroll shifts the range by
`pixelDelta * rangeLength / (internalHeight - 1)` and flips sign when inverted
(**dev:4899-4912**, `priceUnitsPerPixel` at dev:4906).

### 5.4 Kinetic scroll decay

Enabled by `kineticScroll: { mouse: false, touch: true }` (**dev:12417-12420**; the
`mouse: false` at dev:12418; `handleScroll` defaults dev:12399-12404). Construction on
drag start (**dev:10086**):

```
KineticAnimation(0.2 / barSpacing,   // MinScrollSpeed, bars/msec
                7 / barSpacing,      // MaxScrollSpeed
                0.997,               // DumpingCoeff
                15 / barSpacing)     // ScrollMinMove
```

- Speed estimate (`KineticAnimation._internal_start`, **dev:8745-8816**):
  distance-weighted mean of the last ≤3 sampled segments (the weighted sum is
  dev:8812; samples < `minMove` apart are dropped, dev:8763-8770), each clamped to
  `maxSpeed` (`speedPxPerMSec`, dev:8737-8739); opposite-direction segments stop the
  accumulation (dev:8788-8791); start is refused if the last sample is older than
  `MaxStartDelay = 50` msec (dev:8779) or |speed| < minSpeed (dev:8814).
- Position integral (**dev:8824**):
  `pos(t) = start + v * (d^t - 1) / ln d` with `d = 0.997` (per-msec exponent).
- Duration (`durationMSec`, **dev:8741-8744**): `ln((1 * ln d) / -speed) / ln d`
  (`EpsilonDistance = 1`).

### 5.5 Axis interactions

- Axis drag-to-scale (price): `_internal_startScale` / `_internal_scaleTo`
  (**dev:4844-4878**) — disabled for percentage/indexed scales; with x measured from
  the bottom (`height - x`, dev:4869), `scaleCoeff = (startPoint + (height-1)*0.2) /
  (x + (height-1)*0.2)` (dev:4873) floored at `0.1` (dev:4874), then
  `scaleAroundCenter` on the snapshot range.
- Axis double-click reset: price axis → `_internal_reset()` → autoScale on + recalc
  (**dev:9269-9272**, dev:5461-5468); time axis → `resetTimeScale()` →
  `_internal_restoreDefault` (**dev:10327-10329**): barSpacing back to
  `options.barSpacing` (6) and rightOffset back to `rightOffsetPixels/barSpacing` or
  `options.rightOffset` (**dev:6251-6261**). Both gated by
  `handleScale.axisDoubleClickReset.{price,time}` (defaults true, dev:12410-12413).
- `handleScale` defaults (**dev:12405-12416**): `axisPressedMouseMove {time true, price
  true}`, `axisDoubleClickReset {time true, price true}`, `mouseWheel true`,
  `pinch true`.

---

## 6. Panes

### 6.1 Constants and defaults

- `DEFAULT_STRETCH_FACTOR = 1` (**dev:5224**); `MIN_PANE_HEIGHT = 30` (**dev:5225**).
- Separator height `1` px (`SeparatorConstants.SeparatorHeight`, **dev:8576-8579** CSS,
  **dev:8605-8611** bitmap `1 * devicePixelRatio`); `layout.panes.enableResize: true`,
  `separatorColor '#E0E3EB'`, `separatorHoverColor 'rgba(178, 181, 189, 0.2)'`
  (`layoutOptionsDefaults`, **dev:12308-12323**; separator colors dev:12318-12319).

### 6.2 HTML structure

Chart root `div.tv-lightweight-charts` (overflow hidden, direction ltr, width/height
100%, **dev:10623-10631**) containing a single `<table cellspacing="0">` (created at
dev:10630) with one `<tr>` per pane (**dev:9560-9564**): `<td>` left axis · `<td>` pane
· `<td>` right axis (all `padding: 0`; pane cell `position: relative`, dev:9533-9536).
The pane cell holds a wrapper div and **two stacked canvases** — main z-index 1
(dev:9550), top (crosshair + primitives) z-index 2 (dev:9557), both absolutely
positioned at 0,0 (**dev:9537-9559**). Separator rows (`<tr>` height 1px, dev:8576-8579)
sit between pane rows (inserted before the time axis row, dev:11173-11176); the
time-axis row is appended last (dev:10639).

### 6.3 Sizing / stretch distribution

`_private__adjustSizeImpl` (**dev:10938-10985**):

- Axis widths: max over panes of each `PriceAxisWidget.optimalWidth()` and the
  `minimumWidth` option, then rounded up to even (`suggestPriceScaleWidth`,
  **dev:7943-7945**; `optimalWidth` = border + tick + paddings + `5` (`LabelOffset`,
  dev:9143) + widest label, fallback `34` (`DefaultOptimalWidth`), **dev:9133-9149**).
- `paneWidth = max(width - leftAxis - rightAxis, 0)` (dev:10953-10954).
- `separatorHeight = 1` (dev:10957); `otherWidgetHeight = separatorCount + timeAxisHeight`
  (dev:10956-10960); `totalPaneHeight = height - otherWidgetHeight` (floor 0,
  dev:10961-10962); `stretchPixels = totalPaneHeight / totalStretch` (dev:10964).
- Non-last panes: `round(stretchFactor * stretchPixels * dpr) / dpr` (dev:10976); the
  last pane gets `ceil((totalPaneHeight - accumulated) * dpr) / dpr` (dev:10973); every
  pane at least `2` px (dev:10978).
- `paneSize(paneIndex)` public API = the pane widget's size = the **plot area only**
  (excludes axes and separators) (`ChartWidget._internal_paneSize`, **dev:10824-10826**;
  types:1826-1832; `PaneSize {width, height}` types:3510).

### 6.4 Pane topology operations

- `getOrCreatePane(index)` (**dev:7300-7309**): `index = min(panes.length, index)`
  (dev:7302) — an out-of-range index **clamps to append a new pane at the end** (this
  is the semantics `addSeries(..., paneIndex)` and `series.moveToPane` rely on; the
  engine contract preserves it — api.ts:229-232).
- `addSeries(definition, options, paneIndex)` → `_internal_addSeriesToPane`
  (**dev:7147-7154**); first series triggers `fullUpdate`, later ones `lightUpdate`.
- `SeriesApi.moveToPane(paneIndex)` (**dev:12814-12816**) →
  `_internal_moveSeriesToPane` (**dev:7223-7242**): no-op when unchanged; removes from
  the old pane, `getOrCreatePane` the target, and **removes the old pane when it becomes
  empty** (`_internal_cleanupIfPaneIsEmpty`, dev:7235) unless `preserveEmptyPane` is set
  (`PaneApi.setPreserveEmptyPane`, **dev:12542-12544**).
- `IPaneApi.moveTo(paneIndex)` is stricter: **asserts** `0 <= paneIndex <
  paneWidgets.length` (throws `Invalid pane index`, **dev:12505-12512**) and splices the
  pane (`_internal_movePane`, **dev:6932-6940**).
- `removePane(index)` (**dev:6890-6897**): no-op when only one pane; otherwise splice +
  fullUpdate. `swapPanes(first, second)` (**dev:6924-6933**): index swap + fullUpdate.
- `PaneApi.setHeight(height)` (**dev:12490-12493**) →
  `_internal_changePanesHeight` (**dev:6898-6921**): clamps the target to
  `[MIN_PANE_HEIGHT, totalHeight - MIN_PANE_HEIGHT * (n-1)]`, converts px ↔ stretch via
  `pixelStretchFactor = totalStretch / totalHeight`, and redistributes the remainder
  evenly over the other panes (each floored at `30`, dev:6915).
- `PaneApi.getHTMLElement()` returns the pane widget's element or `null` before layout
  (**dev:12516-12521**; types:2049).

---

## 7. Rendering

### 7.1 Device pixel ratio (fancy-canvas)

- Every canvas is bound with `bindCanvasElementBitmapSizeTo(canvas, { type:
  'device-pixel-content-box', options: { allowResizeObserver: true }, transform: (bmp,
  client) => ({ width: max(bmp.width, client.width), height: max(bmp.height,
  client.height) }) })` (`createBoundCanvas`, **dev:8906-8922**; the transform at
  dev:8915; import dev:7).
- When `device-pixel-content-box` ResizeObserver is unsupported, fancy-canvas falls back
  to a `devicePixelRatio` observable and computes the bitmap size from the client rect
  times the ratio (fancy `canvas-element-bitmap-size.mjs:140-180`;
  `predictedBitmapSize(clientRect, ratio)` / `clientSize * ratio`, fancy:171-180).
- `CanvasRenderingTarget2D` exposes per-axis pixel ratios `bitmapSize.width /
  mediaSize.width` and `bitmapSize.height / mediaSize.height` (fancy
  `canvas-rendering-target.mjs:50-58`); renderers draw either in bitmap coordinate space
  (multiply by `horizontalPixelRatio`/`verticalPixelRatio`, e.g. dev:14633-14649) or
  media space (watermark, §7.4).
- A suggested-bitmap-size change repaints the pane at `InvalidationLevel.Full`
  (**dev:10115**).

### 7.2 Invalidation levels

Numeric values from usage comments in dev (the enum is not emitted as a name):
`None = 0` (dev:9837), `Cursor = 1` (dev:6768), `Light = 2` (dev:1566), `Full = 3`
(dev:1569). `PaneWidget._internal_paint(type)` (**dev:9836-9886**):

- `None` → nothing (dev:9837-9839).
- `type > Cursor` → recalculate price scales first (dev:9846-9848); axis widgets get
  painted at the same level (dev:9850-9854).
- `type !== Cursor` → apply suggested bitmap size to the **main canvas** (dev:9856),
  draw background (dev:9860), then `bottom` sources → grid (dev:9864) → `normal`
  sources → label sources.
- Always (also for `Cursor`) → **top canvas**: clear rect (dev:9874), draw crosshair
  (dev:9876), `top` sources, label sources. Crosshair-only motion therefore costs one
  top-canvas clear+redraw, never a main-canvas repaint.
- `ChartWidget._internal_paint` (**dev:10739-10748**) walks panes then the time axis
  with the mask's full level.

### 7.3 takeScreenshot

Public `takeScreenshot(addTopLayer = false, includeCrosshair = false)`
(**dev:13174-13196**): unless `includeCrosshair`, temporarily sets
`crosshair.mode = Hidden` and restores it in `finally` (dev:13180-13194). Internal
(**dev:10775-10787**): flushes any pending invalidation first (dev:10777-10779), creates
a fresh `<canvas>` at the **total bitmap size**, then composites via
`_private__traverseLayout(ctx, addTopLayer)` (**dev:10857-10934**) in this order: left
price axes column (top→bottom with separators, dev:10868) → panes column (top→bottom
with 1px separators) → right price axes column → time axis row with left/right stubs
(dev:10884-10933). `addTopLayer` includes the top (crosshair/primitive) canvases. Result
is one canvas at device-pixel resolution — synchronous, no toDataURL.

### 7.4 Watermark plugin

`createTextWatermark(pane, options)` (**dev:15180**). Defaults
`textWatermarkOptionsDefaults` (**dev:14979-14984**): `visible true`, `horzAlign
'center'`, `vertAlign 'center'`, `lines []`; per line
`textWatermarkLineOptionsDefaults` (**dev:14985-14991**): `color 'rgba(0, 0, 0, 0.5)'`,
`fontSize 48` (dev:14987), `fontFamily defaultFontFamily`, `fontStyle ''`, `text ''`.
Renderer (`TextWatermarkRenderer`, **dev:14993-15080**) draws in **media coordinate
space**: total height = Σ `lineHeight * zoom`; `zoom = min(1, mediaSize.width /
textWidth)` per line (dev:15012); vertical offset top `0` / center
`max((h - textHeight)/2, 0)` (dev:15025) / bottom `max(h - textHeight, 0)`;
horizontal: left at `lineHeight/2` with `textAlign left` (dev:15037), center at
`width/2`, right at `width - 1 - lineHeight/2` (dev:15046); `textBaseline top`,
`scale(zoom, zoom)` then `fillText` (dev:15049-15052). There is no remove API —
replacing means detaching the plugin and creating a new one (the lwc adapter's replace
strategy, lwc/index.ts header).

### 7.5 Canvas release

`releaseCanvas` (**dev:8923-8927**) sets `width/height = 0` after detach to dodge the
iOS Safari "Total canvas memory use exceeds the maximum limit" error.

---

## 8. Events / lifecycle

### 8.1 subscribeClick / subscribeDblClick / crosshair

- API surface **dev:13134-13156** (subscribe/unsubscribe triples). The ChartApi
  re-fires the widget delegates only `if (hasListeners())` (**dev:13065-13081**) — lazy
  param construction.
- Params are the same `MouseEventParams` shape as crosshair (built by
  `_private__getMouseEventParamsImpl`, **dev:11191-11228**; see §4.4). Clicks fire from
  tap/mouse-up without drag (`_internal_tapEvent` → `_private__fireClickedDelegate`,
  **dev:9703-9707**, coordinate→index conversion dev:9899-9906); double click from the
  DOM dblclick / double-tap (`_internal_mouseDoubleClickEvent`, dev:10326-10329).
- Delegates are plain listener arrays: `fire` snapshots and drops singleshot listeners
  (**dev:170-175**); firing a destroyed delegate is a no-op over an empty array
  (`_internal_destroy` clears, dev:178-183).

### 8.2 remove() and post-remove behaviour

`ChartApi.remove()` (**dev:13082-13098**): unsubscribes the three widget delegates
(dev:13083-13085), destroys the TimeScaleApi, calls `ChartWidget._internal_destroy()`,
clears the series maps, destroys the public delegates and the DataLayer.
`ChartWidget._internal_destroy` (**dev:10674-10704**) destroys the model and every pane
widget (removing their rows from the table), destroys separators and the time axis
widget, **removes the root element from its parent** (dev:10696-10697), destroys
delegates and the ResizeObserver.

Documented contract (types:1604-1605): *"Removes the chart object including all DOM
elements. This is an irreversible operation, you cannot do anything with the chart after
removing it."* The engine contract adds idempotent `destroy()` (api.ts:273) — the lwc
adapter implements double-destroy safety itself (its own `destroyed` flag); it is **not**
provided by LWC (calling `remove()` twice is not guarded in dev:13082-13098 — see §9).

### 8.3 applyOptions merging

`merge(dst, ...sources)` (**dev:184-202**) is a **deep** merge: `undefined` values,
inherited properties and `__proto__`/`constructor`/`prototype` keys are skipped
(dev:188-193); arrays and non-object leaves are **replaced** (dev:194); plain objects
recurse (dev:198-201). Chart options flow: `ChartApi.applyOptions` → widget →
`ChartModel._internal_applyOptions` (**dev:6798-6813**) = merge + per-pane scale options
+ timeScale/localization side channels + background recompute + fullUpdate. Series:
`SeriesApi.applyOptions` (dev:12753-12755) → `Series._internal_applyOptions`
(**dev:3476-3492**) = merge into the series options, with special handling for
`priceScaleId` (moves the series between scales, dev:3481) and `visible` (invalidates
the visible-series cache). TimeScale options apply with ordering constraints —
**barSpacing before rightOffset** because the offset depends on spacing
(`TimeScale._internal_applyOptions`, **dev:5998-6028**; the two applies at dev:6009 and
dev:6012), and re-apply after min/maxBarSpacing changes (dev:6017-6020). Price-scale
options by id: left/right merge into the chart options (**dev:6814-6838**); a bad pane
index throws (dev:6816-6819).

### 8.4 Data entry points

`setData` (**dev:12713-12718**): asserts strictly ascending unique times
(`checkItemsAreOrdered`, **dev:12560-12575** — `allowDuplicates = false` default) and
value types per kind, then full replace. `update(bar, historicalUpdate = false)`
(**dev:12719-12723**, DataLayer `_internal_updateSeriesData`
**dev:11560-11648**): throws `Cannot update oldest data` when going backwards without
`historicalUpdate` (dev:11571-11574); throws for a `historicalUpdate` at a non-existing
point; an update at an existing time **replaces the bar in place** (whitespace
replacement — whether the visible range shifts is governed by `shiftVisibleRangeOnNewBar`
+ `allowShiftVisibleRangeOnWhitespaceReplacement`, **dev:7105-7106** and the surrounding
`_internal_updateTimeScale`, dev:7093-7112); a new time inserts a point and reindexes
everything to its right (dev:11624-11638).

### 8.5 Series defaults table (all six kinds)

Common to every series: §3.1 (dev:12-36). Per kind:

| kind | defaults | cite |
|---|---|---|
| candles | upColor `#26a69a`, downColor `#ef5350`, wickVisible true, borderVisible true, borderColor `#378658`, borderUpColor `#26a69a`, borderDownColor `#ef5350`, wickColor `#737375`, wickUpColor `#26a69a`, wickDownColor `#ef5350` | dev:14760-14769 |
| bars | upColor `#26a69a`, downColor `#ef5350`, openVisible true, thinBars true | dev:14567-14770 |
| line | color `#2196f3`, lineStyle 0, lineWidth 3, lineType 0, lineVisible true, crosshairMarkerVisible true, crosshairMarkerRadius 4, crosshairMarkerBorderWidth 2, lastPriceAnimation 0, pointMarkersVisible false | dev:13759-13773 |
| area | topColor `rgba( 46, 220, 135, 0.4)`, bottomColor `rgba( 40, 221, 100, 0)`, invertFilledArea false, relativeGradient false, lineColor `#33D778`, lineWidth 3, lineType 0 (+ crosshairMarker/pointMarkers same as line) | dev:14382-14397 |
| baseline | baseValue `{price, 0}`, relativeGradient false, topFillColor1 `rgba(38, 166, 154, 0.28)`, topFillColor2 `rgba(38, 166, 154, 0.05)`, topLineColor `rgba(38, 166, 154, 1)`, bottomFillColor1 `rgba(239, 83, 80, 0.05)`, bottomFillColor2 `rgba(239, 83, 80, 0.28)`, bottomLineColor `rgba(239, 83, 80, 1)`, lineWidth 3, lineType 0 | dev:14274-14301 |
| histogram | color `#26a69a`, base 0 | dev:14940-1442 |

`LineStyle` values referenced above: `0 Solid`, `2 Dashed`, `3 LargeDashed` (usage
comments dev:25, dev:21, dev:12278).

---

## 9. Unverified / not located in dist

- **InvalidationLevel enum declaration**: the enum body is not emitted under that name
  in the development bundle; values 0/1/2/3 are evidenced by inline comments
  (dev:9837, dev:6768, dev:1566, dev:1569). Semantics verified from
  `PaneWidget.paint` (dev:9836-9886).
- **Double `chart.remove()`**: no guard exists in `ChartApi.remove` (dev:13082-13098);
  whether the second call throws depends on destroyed-delegate/widget internals I did
  not trace to a definitive throw/no-throw. The typings contract ("you cannot do
  anything with the chart after removing it", types:1604-1605) is the only authoritative
  statement. Likewise individual post-remove method calls: not traced.
- **`PriceTickMarkBuilder` tick density (`tickMarkDensity 2.5`)**: the option default is
  at dev:12342; the builder's use of the density (target vertical gap per mark) sits in
  `PriceTickMarkBuilder` (constructed at dev:5018, ctor base at dev:4533) which I did
  not read line-by-line — treat the exact gap formula as unverified.
- **`lastPriceAnimation` pulse timing** (modes other than the default `Disabled`): the
  animation stage constants were not read; only the default (dev:13770) is verified.
- **Attribution logo** (`layout.attributionLogo: true`, dev:12321): position/size rules
  not read (irrelevant to the renderer contract, but noted for screenshot parity).
- **`createOptionsChart` / yield-curve horz-scale behavior** (dev:13953+, dev:13809+):
  out of scope for the six-kind engine contract; not verified beyond existence.
