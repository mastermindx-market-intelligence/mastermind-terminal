# Chart engine performance budget (native renderer, P3/P4 gates)

*Numeric contract for the Canvas2D renderer (`impl: "mm"`) and the measurement protocol
that produces a receipt. The masterplan (`docs/CHART_ENGINE_MASTERPLAN.md`, § "Parity /
quality gates") demands "60fps pan/zoom/crosshair" and "memory ≤ LWC baseline on the
40k-bar workspace"; this file turns those sentences into checkable numbers. A receipt that
violates any budget blocks the P4 default flip — the LWC adapter (`impl: "lwc"`) stays the
control group and is measured with the identical protocol on the same host in the same run.*

## 1. Budgets

| # | Metric | Budget | Class / rationale |
|---|---|---|---|
| B1 | `first_paint_ms` | ≤ **150 ms** | M1-class first paint: 40k-bar daily corpus, engine constructed + `setData` + first composited frame on screen. Anything slower reads as a blank flash on symbol/TF switch. |
| B2 | `pan_frame_p95_ms` | ≤ **18 ms** | Steady-state drag pan ≥ 55 fps at p95 (1440×900 dpr2). 18 ms, not 16.7, buys the compositor headroom; p95, not mean, because a dropped frame is what the eye catches. |
| B3 | `zoom_frame_p95_ms` | ≤ **18 ms** | Wheel zoom (discrete steps) and pinch (continuous) under the same frame budget as B2. |
| B4 | `live_commit_ms` | ≤ **4 ms** | One live tick → in-place `update()` on the live bar → commit inside one frame's slice. Must never recreate a series per tick (programme law: one live bar = one generation). |
| B5 | `screenshot_ms` | ≤ **50 ms** | `takeScreenshot()` (synchronous, returns `HTMLCanvasElement`) at 1440×900 dpr2, all panes composited. The share flow runs it on the UI thread. |
| B6 | `heap_mb` | ≤ **60 MB** | Per-chart JS heap ceiling (see §3 B6 for the delta method). The masterplan's "≤ LWC baseline" is tracked as an additional comparison row, not a replacement gate. |

All budgets apply to the 40k-bar daily corpus unless a metric says otherwise. They are
ceilings for the p95 of ≥ 3 runs on the reference host — a single lucky run proves nothing.

## 2. Corpus

`daily-40k`: one primary candlestick series, 40,000 daily bars (gapped business days,
no whitespace rows), plus the standard satellite set of the parity harness: 2 line overlays
(moving averages), 1 histogram pane (volume, own overlay scale), 1 oscillator pane (line,
own pane). Markers on ≤ 200 recent bars, watermark on pane 0. The corpus generator is
deterministic (seeded) so any host regenerates it byte-identically; the receipt records
`corpus.name = "daily-40k"` and `corpus.bars = 40000`.

## 3. Measurement protocol (Playwright, headless-off)

One Chromium context, launched with `--disable-partial-raster` (no tile-cache partial
invalidation: every dirty frame pays full raster, so a cheap-looking frame cannot hide
behind a cached one) and `--enable-gpu-rasterization` left at default. Viewport 1440×900,
`deviceScaleFactor: 2`. `page.clock` is installed (`page.clock.install()`) before app boot
so timers/timestamps are deterministic; frame math itself uses `performance.now()` deltas
inside `requestAnimationFrame` callbacks, which `page.clock` does not rewind. The mouse is
**parked** at a neutral corner (10,10) whenever a metric does not involve pointer input, so
crosshair-move handlers cannot dirty frames being counted.

- **B1 first paint.** `page.clock` running; navigate with a boot hook that marks
  `performance.mark("engine:create")` at `createEngine()` entry and
  `performance.mark("engine:first-frame")` in the first `requestAnimationFrame` after the
  renderer's first present. `first_paint_ms` = difference, from entry of `createEngine` to
  that first presented frame. Includes data → geometry → raster; excludes network/JSON
  (corpus is inlined).
- **B2 pan.** `mouse.move` to the plot area center, `mouse.down`, 200 `mouse.move` steps of
  8 px along x at ~16 ms cadence, `mouse.up`. Record `performance.now()` in every rAF
  callback during the drag + 300 ms tail (inertia decay). `pan_frame_p95_ms` = p95 of the
  inter-callback deltas of frames that did work (deltas where the renderer reports a
  present; parked-idle gaps are excluded, not averaged in).
- **B3 zoom.** Same harness, wheel events: 60 pulses of `deltaY: -120` at 50 ms cadence at
  the plot center — the pointer must stay the anchor (programme law: the value under the
  pointer is fixed, ≤ 1 CSS px). `zoom_frame_p95_ms` as above. Pinch is verified by the
  interaction parity harness, not timed here (no deterministic pinch in Playwright).
- **B4 live tick.** After B1, feed 500 sequential ticks (1/s simulated, `page.clock` advance
  optional) updating the last bar via the engine's `update()`. Each tick is bracketed with
  `performance.mark`; `live_commit_ms` = p95 of (update-call → next rAF present). Ticks that
  roll a new bar are included — bar roll is the worst case.
- **B5 screenshot.** After B1, 20 calls to `takeScreenshot()` with a settle between calls;
  `screenshot_ms` = p95 of call → return (it is synchronous). Canvas is 1440×900 at dpr2
  (2880×1800 backing store). The returned element's `width`/`height` are asserted before
  timing counts (a 1:1 canvas from a mis-set dpr would time artificially fast).
- **B6 heap.** `page.evaluate(() => performance.memory.usedJSHeapSize)` before engine
  creation and after the full B1–B5 sequence + 3 full corpus re-`setData` passes (the
  symbol/TF switch shape). `heap_mb` = final − initial, in MB. A separate 50-switch soak
  (masterplan: "no leak across 50 symbol/TF switches") must show a flat trend; the receipt's
  single number is the post-sequence delta.

Every metric is measured 3× in fresh pages; the receipt carries the **median of the p95s**
per metric except `heap_mb` (max). The same script then re-runs the whole protocol against
`?engine=lwc` and records the control row (informational; budgets apply to `mm` only).

## 4. The receipt

Emitted as JSON matching `performance-receipt.schema.json` (JSON Schema draft 2020-12, in
this directory). Fields:

```
commit            HEAD sha the renderer under test was built from
generated_at      ISO-8601 timestamp
host.os           e.g. "linux 6.x"        host.cpu   e.g. "12 × …"
host.dpr          device pixel ratio used (2)
corpus.name       "daily-40k"             corpus.bars  40000
metrics.first_paint_ms / pan_frame_p95_ms / zoom_frame_p95_ms /
        live_commit_ms / screenshot_ms / heap_mb     (numbers, protocol §3)
budget_ok         true iff every metric is within §1
violations        [] on green; else one entry per breach:
                  { "metric": "pan_frame_p95_ms", "value": 21.4, "budget": 18 }
```

Validation: `python3 -c "import json; json.load(open('docs/chart-engine-completion/performance-receipt.schema.json'))"`
plus `jsonschema` validation of the emitted receipt against it in CI. Receipts are
committed under `docs/chart-engine-completion/receipts/` named
`receipt-<impl>-<commit>-<host>.json`; the P4 flip PR must contain a green `mm` receipt and
the same-run `lwc` control receipt.

## 5. What a violation means

- **B1/B2/B3 red** → P4 flip blocked; profile before optimizing (the budget doc is a gate,
  not a TODO list). A regression ≥ 10% vs the previous `mm` receipt is treated as red even
  when under budget (creep ratchet, same spirit as the import ratchet in `baseline.md`).
- **B4 red** → almost always a per-tick series recreation; check the generation law first.
- **B5 red** → check for a canvas reallocation per call (the 50 ms is dominated by
  alloc+blit; reuse of the backing store is the design intent).
- **B6 red or 50-switch soak trend up** → a listener/geometry cache leak; the census
  (`inventory()`) after `destroy()` must answer `{alive:false, zeros}` before anything else
  is suspected.

Budgets may be tightened at any time (they are ceilings); loosening one requires a written
justification in this file and a fresh receipt showing the old budget could not be met
without a correctness trade.
