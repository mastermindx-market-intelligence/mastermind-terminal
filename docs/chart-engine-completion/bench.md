# Chart-engine performance-budget harness

How to produce a receipt for the numbers in `performance-budget.md`. This lane
ships the harness: corpus, receipt builder, `/dev/chart-bench`, and the B1–B6
Playwright protocol. **Official receipts are measured later by the seat** on the
reference Mac after the P1 canvas repair and the ChartPanel migration land. A
green number from a laptop or a CI shard is not the gate.

`ajv` 8.20.0 and `ajv-formats` are already resolvable from `terminal/` (they
are runtime dependencies of other contracts). Follow-up: promote them to
`devDependencies` so the harness does not lean on that coincidence.

## How to run

From `terminal/`. Chromium is required (`npx playwright install chromium`; no
`--with-deps`).

### Dev-mode smoke

Compiles routes on first hit; numbers are **not** official.

```
BENCH_HEADLESS=1 BENCH_RUNS=1 npx playwright test -c playwright.bench.config.ts
```

Writes two schema-valid receipts to `test-results/bench/` (gitignored) and
prints one summary line per impl:

```
BENCH <impl> commit=<sha> first_paint_ms=… pan=… zoom=… live=… shot=… heap=… budget_ok=<bool> violations=<n> file=<path>
```

`--list` always works, even when Chromium cannot launch:

```
npx playwright test -c playwright.bench.config.ts --list
```

### Official prod-mode run (seat, reference Mac)

```
NEXT_PUBLIC_CHART_BENCH=1 npm run build && npm run start -- -p 3111
BENCH_BASE_URL=http://127.0.0.1:3111 npx playwright test -c playwright.bench.config.ts
```

Headed (default), three fresh pages per impl, viewport 1440×900 at
`deviceScaleFactor` 2, Chromium launched with `--disable-partial-raster`. The
seat copies the two receipts into `docs/chart-engine-completion/receipts/` and
commits them. Never commit a dev-mode receipt.

The production site never serves `/dev/chart-bench`: the page calls `notFound()`
when `NODE_ENV === "production"` unless `NEXT_PUBLIC_CHART_BENCH=1` was set at
build time.

## Env knobs

| Knob | Default | Meaning |
|---|---|---|
| `BENCH_IMPLS` | `mm,lwc` | Comma-separated impls to measure. |
| `BENCH_RUNS` | `3` | Fresh pages per impl; receipt = median of the per-run p95s (`heap_mb` = max). |
| `BENCH_OUT_DIR` | `terminal/test-results/bench/` | Receipt + log directory. |
| `BENCH_BASE_URL` | unset | When set, no `webServer`; hit that origin (prod-build path). |
| `BENCH_HEADLESS` | unset (headed) | `1` forces headless. |
| `BENCH_ENFORCE` | unset | `1` fails the test on `budget_ok: false`. A violation is otherwise recorded on the receipt and the test stays green. |
| `BENCH_PROVE_CLOCK` | unset | `1` runs the F7 falsifier (`page.clock.install` + `pauseAt` ⇒ rAF does not fire in 500 ms real time). |
| `TERMINAL_E2E_PORT` | `3110` | Dev-server port when `BENCH_BASE_URL` is unset. |

A budget violation does **not** fail the test unless `BENCH_ENFORCE=1`. Invalid
JSON (schema miss) always fails.

## What each number means

See `performance-budget.md` §1 for the ceilings (150 / 18 / 18 / 4 / 50 / 60).
The receipt carries the **median of three per-run p95s** except `heap_mb` (max
of the three deltas). The 50-switch soak trend, build mode, zoom-anchor drift,
screenshot dimensions, and any `refused:<member>` lines go to stdout and
`test-results/bench/<run>.log`, never into the receipt (`additionalProperties: false`).

- **B1 `first_paint_ms`** — `engine:create` mark immediately before `createEngine`,
  `engine:first-frame` after the double-rAF settle (below). Corpus is inlined.
- **B2 `pan_frame_p95_ms`** — p95 of inter-frame deltas while drag-panning
  (200 × 8 px at ~16 ms) plus a 300 ms tail. Mouse parked at (10,10) otherwise.
- **B3 `zoom_frame_p95_ms`** — same reducer over 60 wheel pulses (`deltaY -120`
  at 50 ms) at the plot center. Pointer-anchor drift is logged; asserted ≤ 1 CSS
  px for `mm` only.
- **B4 `live_commit_ms`** — p95 over 500 ticks. Each tick is `update()` wall
  time plus the summed duration of rAF callbacks in the next frame that did
  work. Every 50th tick rolls a new business-day bar. Driven one tick per
  animation frame.
- **B5 `screenshot_ms`** — p95 of 20 synchronous `takeScreenshot()` calls with a
  double-rAF settle between them. `mm` backing store is 2880×1800 at this
  viewport; `lwc` dims are logged if they differ.
- **B6 `heap_mb`** — `(usedJSHeapSize after B1–B5 + 3 full `resetData` passes −
  heap captured immediately before `createEngine`) / 1048576`. Then a 50-switch
  soak (heap sampled every 10); slope is logged, not receipted.

## Approximations (and why)

Neither impl exposes a present / first-frame hook. The canvas engine schedules
work via `schedule: (cb) => requestAnimationFrame(cb)`. The harness therefore
approximates:

1. **First present = a double `requestAnimationFrame` after the last `setData`.**
   The engine requested its rAF earlier, so it paints in frame N; the nested
   callback runs at the start of frame N+1, after frame N was presented. That
   is `engine:first-frame`. Reason: no compositor-present callback on either
   impl.

2. **Frames that did work = frames in which at least one rAF callback ran.**
   `mount.ts` wraps `window.requestAnimationFrame` **before** `createEngine`,
   so every scheduled callback (either impl) is recorded as
   `{frameTs, start, end}` while logging is on. Distinct `frameTs` values are
   frames; deltas between consecutive frames are frame times. Deltas larger
   than 50 ms are treated as parked-idle gaps and dropped (the mouse is parked
   at (10,10) between metrics; those gaps are not frame cost). Both impls use
   rAF internally, so one wrapper measures both.

3. **No `page.clock.install()`.** Playwright's fake clock replaces rAF and
   `performance.now`, so installing it would measure the driver. Determinism
   is the seeded corpus (`DEFAULT_CORPUS_SEED`) plus this fixed input script.
   The F7 falsifier (skipped unless `BENCH_PROVE_CLOCK=1`) proves the claim.

4. **Live-commit frame slice.** Per tick, `live_commit_ms` is the synchronous
   `update()` duration plus the summed `(end − start)` of rAF callbacks that
   share the next recorded `frameTs`. If the engine schedules no rAF within
   500 ms, the frame slice is recorded as a tiny epsilon so the receipt stays
   schema-valid (`exclusiveMinimum: 0`).

5. **Heap.** `performance.memory.usedJSHeapSize` is Chrome-only. When the API
   is missing the delta is recorded as a tiny epsilon and the log says so.

Engine members that throw (`EngineRefusalError` or a pre-repair TODO) are
caught in `mount.ts`, recorded as `refused:<member>`, and skipped. The
harness does not patch the engine.

## Files

| File | Role |
|---|---|
| `terminal/lib/chart-engine/bench/corpus.ts` | Seeded daily-40k generator + pure helpers (browser-safe). |
| `terminal/lib/chart-engine/bench/receipt.ts` | `BUDGETS`, `computeViolations`, `buildReceipt`, `validateReceipt` (Node-only). |
| `terminal/lib/chart-engine/bench/mount.ts` | `mountBench(container, impl)` + `window.__mmBench`. |
| `terminal/app/dev/chart-bench/page.tsx` | `/dev/chart-bench?engine=mm\|lwc`. |
| `terminal/playwright.bench.config.ts` | Dedicated Playwright config. |
| `terminal/bench/chart-engine.bench.ts` | B1–B6 protocol. |
| `docs/chart-engine-completion/receipts/` | Official receipts (seat only); ships with README. |
