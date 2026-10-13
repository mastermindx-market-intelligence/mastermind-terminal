# Chart-engine performance-budget harness

How to produce a receipt for the numbers in `performance-budget.md`. This lane
ships the harness: corpus, receipt builder, `/dev/chart-bench`, and the B1–B6
Playwright protocol. **Official receipts are measured later by the seat** on the
reference Mac after the P1 canvas repair and the ChartPanel migration land. A
green number from a laptop or a CI shard is not the gate.

`ajv` 8.20.0 and `ajv-formats` resolve from `terminal/` because they are real
**runtime** dependencies (`terminal/package.json:24-25`): `app/api/flow/route.ts`
-> `lib/optionsAlphaCandidatePair.ts:3-4` compiles and validates with them on every
request. Do NOT move them to `devDependencies` — a `--omit=dev` production install
would then break `/api/flow`. `bench/receipt.ts` is a second, dev-only consumer of
the same production dependency; that is fine and needs no package.json change.

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
| `BENCH_RUNS` | `3` | Fresh pages per impl; receipt = median of the per-run p95s (`heap_mb` = max). A non-numeric value fails at config load rather than producing a `NaN` timeout. |
| `BENCH_SOAK` | `50` | `resetData` switches per impl in the B6 leak soak (floor 2). Samples every 10th switch. |
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
of the three deltas); both aggregates are `UNMEASURED`-absorbing (`runMedian`),
so one run that measured nothing reddens the receipt instead of being averaged
away by the healthy runs. The soak trend, build mode, zoom-anchor drift,
screenshot dimensions and the raw `refused:<member>` lines go to stdout and
`test-results/bench/<run>.log`; refusals reach the receipt only through
`violations` (`additionalProperties: false`).

B4's wheel phase needs `handleScroll.mouseWheel: false` (set by
`BENCH_HANDLE_SCROLL` in `corpus.ts`): the canvas controller mirrors LWC's rule
`zoom = handleScale.mouseWheel && (ctrlKey || !handleScroll.mouseWheel)`, so a
plain `page.mouse.wheel()` would scroll and leave the visible span unchanged.

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
   500 ms, the frame slice is `UNMEASURED` (1e9) so the receipt stays
   schema-valid (`exclusiveMinimum: 0`) while the metric is an explicit
   violation instead of the fastest number the schema can express.

5. **Heap.** `performance.memory.usedJSHeapSize` is Chrome-only. When the API
   is missing the hook reports `heapSupported() === false`, the delta is
   recorded as `UNMEASURED` (1e9) and the log says so.

Engine members that throw (`EngineRefusalError` or a pre-repair TODO) are
caught in `mount.ts`, recorded as `refused:<member>`, and skipped. A frame
whose paint threw is **not** recorded as work. Every refusal also taints the
metric it invalidated (`REFUSAL_TAINTS` in `receipt.ts`) to `UNMEASURED`, so a
refusing renderer cannot print a green receipt. The harness does not patch the
engine.

## Presented-frame cadence (Q03)

Q03 measures the cost of a gesture in actual presentation times, not rAF
times. Chromium's compositor `PipelineReporter` emits one slice per presentation
even when the engine's rAF callback fired with no visible work; counting rAF
times would over-report smoothness. `enabled-by-default-devtools.timeline.frame`
covers the same domain but is not enabled by default for CDP `Tracing.start`,
so the protocol asks for `disabled-by-default-devtools.timeline.frame`
plus `blink.user_timing` and reads the `args.frame_reporter` payload.

Chromium forks the frame reporter: one display presentation can be reported
by two `PipelineReporter` slices with different `frame_sequence` values
(one of them carrying `frame_type: "FORKED"`). The parser de-duplicates
those into one frame per `frame_source:frame_sequence` key, then collapses
to presentation times (`STATE_PRESENTED_ALL` slices) plus the keyed drop
and partial frames; the count is FRAMES, not slices — over-reporting drops
by ~192 per gesture in the E1 trace.

### How to run

```
BENCH_RUNS=3 npx playwright test -c playwright.bench.config.ts bench/chart-engine.cadence.bench.ts
```

The official receipt is taken with `BENCH_HEADLESS=0` (headed) against a
prod build (`NEXT_PUBLIC_CHART_BENCH=1 npm run build && npm run start -- -p …`),
exactly like the B1–B6 protocol above. Chromium 149 launched with
`--disable-partial-raster`, viewport 1440×900 at `deviceScaleFactor` 2.
The seat copies the per-impl receipt into `docs/chart-engine-completion/receipts/`
and commits it. **Never commit dev-mode, rehearsal, or `budget_ok: false`
receipts — receipts ship only when measured on the reference Mac when the
host load1 < 24.**

### What it measures

For each impl:
  - ONE pan gesture of 200 × 8 px mouse moves (`center.x` → `center.x + 1600`)
    over 200 dispatch steps (no waits), bracketed by `cadence:pan:start` /
    `cadence:pan:end` `performance.mark`s.
  - ONE zoom gesture of 60 × `wheel(0,-120)` pulses at the plot center,
    bracketed by `cadence:zoom:start` / `cadence:zoom:end`.

Each gesture is a fresh CDP `Tracing.start` (transferMode: `ReportEvents`)
that opens BEFORE the 200 ms idle so any presentation drift in the pre-gesture
200 ms idle is captured, and closes 250 ms after the end mark so the last
presentation lands inside the trace. The window for stats is
`[cadence:<gesture>:start, cadence:<gesture>:end + 100 ms]`.

Compositor presentation times come from `PipelineReporter` `STATE_PRESENTED_ALL`
slices de-duplicated to presentation timestamps; the receipt carries the
in-window p95/p99, the per-frame count, and `input_hz`. Percentiles delegate
to `corpus.percentile` so an empty intervals array yields `UNMEASURED` (1e9),
a violation, never `NaN`.

### Budgets

```
CADENCE_BUDGETS = {
  presented_p95_ms: 20,
  presented_p99_ms: 33.4,
  input_to_present_p95_ms: 20,
  input_to_present_p99_ms: 33.4,
}
```

A budget violation is recorded on the receipt and the test stays green
unless `BENCH_ENFORCE=1`, which fails the test on `budget_ok: false`. The
median-run receipt uses the canonical `buildCadenceReceipt` math against
`CADENCE_BUDGETS` — never hardcoded 20 / 33.4 anywhere in the spec.

### Input-rate floor (read the p95/p99 with this in mind)

`presented_p95_ms` / `presented_p99_ms` are intervals between consecutive
*presented* frames, so they are bounded below by whichever is slower: the
renderer, or the arrival of the next input. Both gestures dispatch every
event as an awaited CDP round trip (200 `mouse.move` steps, 60
`mouse.wheel` pulses, no waits), so on a busy host the dispatch rate — not
the engine — sets the floor:

```
input_floor_ms = 1000 / input_hz
```

Measured examples: on a 100 Hz display with `input_hz` 49.3 the zoom p50 is
20 ms (the wheel spacing) for BOTH engines, while pan p95 is 10 ms; on a
loaded Linux dev host with `input_hz` 22.3 the pan p50 is 44.3 ms and
`presented == inputs` for zoom (60 == 60), i.e. the renderer presented
exactly one frame per wheel pulse and every interval is an input gap.

Consequences for the seat:

  - Read `CADENCE_DIAG` (console only, never in the receipt) next to the
    `CADENCE` line: when `p95_ms` sits at or just above `input_floor_ms`
    and `presented_per_input` is ~1.0, the number is measuring the harness,
    not the engine.
  - `budget_ok: false` on `zoom.presented_p95_ms` is expected on any host
    whose dispatch rate is below 50 Hz, because the 20 ms budget is under
    the input floor. It is not by itself evidence of an engine regression.
  - Compare engines at a matched `input_hz` (same host, same session), and
    prefer pan for renderer attribution: its 200 dispatch steps keep the
    compositor busy continuously, whereas the 60 wheel pulses do not.

Attributing an interval to the renderer alone needs one `performance.mark`
per dispatched input (already on the captured `blink.user_timing` category).
Q03b below adds exactly that, so this section's `presented_p95_ms` /
`presented_p99_ms` remain interval metrics with the input-rate floor
described above, and the per-input `input_to_present_*` metrics are the ones
to read for renderer attribution. The gesture definition is unchanged; D10
still forbids lowering a budget after a result, and the two Q03b budgets
were bound prospectively. The receipt shape did change here: nine top-level
keys (a new `display`), thirteen per-gesture stat keys, and four budget
keys.

### INVALID gates

The bench fails when any of these is true:

  - `window.devicePixelRatio !== 2` (every cadence number is scale-dependent).
  - The pan/zoom range did not change (engine ignored the gesture).
  - `cadence:<gesture>:start` or `:end` mark absent.
  - `parsePresentedFrames` throws "no presentation records in trace" (the
    chosen renderer pid emitted no `PipelineReporter`, or no marks and no
    pipeline reporters exist).
  - Fewer than 2 presented frames land in the gesture window:
    `INVALID: fewer than 2 presented frames in the <pan|zoom> window (<impl>)`.
  - The trace's input marks and the page-side `performance` entries disagree
    (count or > 0.01 ms delta): `INVALID: input-mark clock check failed
    (<impl> <pan|zoom>): <reason>`.
  - No input mark lands inside `[start mark, end mark]`:
    `INVALID: no input marks in the <pan|zoom> window (<impl>)`.
  - `Tracing.tracingComplete` does not arrive within 30 s of `Tracing.end`:
    `INVALID: Tracing.tracingComplete not received within 30 s (<pan|zoom>)`.

## Per-input presentation latency (Q03b)

The presented-frame interval is bounded below by whichever is slower: the
renderer, or the arrival of the next input. A zoom that dispatches
~50 wheel events per second cannot show intervals under ~20 ms, so the
interval quantity cannot attribute anything to the renderer. Per-input
presentation latency (Q03b) is the matching rule that escapes this floor.

How the inputs are marked. Before each gesture the bench installs a
capture-phase listener on `document`, after the 200 ms idle and removed after
the end mark. The same `finally` block also removes the listener when the gesture
throws, so a failing pan never leaves the listener behind. For the pan, the
listener receives `pointermove` and `mousemove`; a `PointerEvent` with
coalesced events gets one `performance.mark` per coalesced event, every other
event gets one mark of its own. A pointermove and its compatibility
mousemove carry the same `timeStamp`, so identical timestamps are one input.
For the zoom, the listener receives `wheel` only, one mark per event. Each
mark is written with `performance.mark(name, { startTime: ev.timeStamp })`, so
the mark clock is the input clock, not the listener clock.

The latency rule. For every input mark `m` inside `[start mark, end mark]`,
latency = the first presented frame (`STATE_PRESENTED_ALL`) at or after `m`,
minus `m`, provided that frame arrives by `end mark + 100 ms`. An input with
no such frame is counted in `input_unpresented` (reported, never budgeted).
Percentiles are p50/p95/p99 over inputs.

The clock check and its INVALID. The bench reads the trace's
`blink.user_timing` marks and the page-side `performance.getEntriesByName`
startTimes and compares them via `checkInputMarkClock`. A deviation above
0.01 ms FAILS the run with `INVALID: input-mark clock check failed`.

Measured vsync. `vsync_ms` is the mode of the positive rounded (0.1 ms)
presented-frame intervals pooled over both gestures, `hz = round(1000 /
vsync_ms)`. Measured, never declared: nothing assumes 60 / 120 / 16.7 ms.
The cross-check `vsync_seq_ms` uses `frameSequenceIntervals` (begin-time
difference divided by `frame_sequence` difference between consecutive frames
of one BeginFrame source); its mode is printed as `vsync_seq_ms` on the
diagnostic line and is not part of the receipt. **Reading rule:** when
`vsync_ms` and `vsync_seq_ms` differ, the presented intervals were
input-bound and `vsync_ms` is the modal input gap rather than the refresh
slot (generally not a whole multiple of it), so that run's `vsync_ms` is not
a display reading. A slow headless host printed `vsync_ms 43.5` on a
`16.7` ms frame clock (2.6 slots, not 2 or 3); the diagnostic line showed
the disagreement. Latency is bounded below by the vsync slot, not by input rate.

Budgets (`CADENCE_BUDGETS`; each one applies to both pan and zoom):

| Budget key | Limit (ms) | Quantity |
|---|---|---|
| `presented_p95_ms` | 20 | p95 of the presented-frame intervals |
| `presented_p99_ms` | 33.4 | p99 of the presented-frame intervals |
| `input_to_present_p95_ms` | 20 | p95 of the per-input presentation latency |
| `input_to_present_p99_ms` | 33.4 | p99 of the per-input presentation latency |

Receipt additions. The receipt's `display` field carries `vsync_ms` and
`hz`. Each gesture record carries 13 keys (the eight intervals-only keys
plus the five per-input latency keys: `input_marks`, `input_unpresented`,
`input_to_present_p50_ms`, `input_to_present_p95_ms`,
`input_to_present_p99_ms`). `input_marks` must be `>= 1`; a gesture with
none throws `"no input marks"` and never reaches the receipt. Four new
violation metrics are added after the four presented ones, one per
(input-to-present) budget per gesture.

The bench prints `CADENCE` once per run with all thirteen numeric fields
(`pan_p95`, `pan_p99`, `zoom_p95`, `zoom_p99`, `pan_lat_p95`, `pan_lat_p99`,
`zoom_lat_p95`, `zoom_lat_p99`, `vsync_ms`, `presented`, `partial`,
`dropped`, `input_hz`) plus
`budget_ok`, `violations`, and `file`. `CADENCE_DIAG` adds
`*_input_marks`, `*_unpresented`, `hz`, `vsync_seq_ms`, and `*_clock_dev_ms`
so a host can see how many inputs were marked, how many found a presented
frame, the cross-check vsync, and the page-vs-trace clock deviation.

Known limits:

  - The first presentation at or after a mark may not yet contain that
    input, so latency can be under-stated by up to one frame.
  - When inputs are slower than refreshes the interval mode tracks the
    modal input gap, which need not be a whole multiple of the true vsync;
    both gestures are pooled, and `vsync_seq_ms` shows the disagreement.
  - The browser may merge wheel events, so `input_marks` can be below the
    dispatched count.
  - Event timestamps are coarsened by the browser (about 0.1 ms).
  - The listener itself costs one `performance.mark` per input.
  - The receipt's run is the median by `pan.p95_ms`, so its zoom numbers
    come from that same run.
  - Small-n tail: the zoom dispatches 60 inputs, so nearest-rank p99 is the
    60th value — the single worst input — and p95 is the 57th. The first
    wheel of the gesture is included (no warm-up pulse), and it is usually
    that worst input. On a headed 100 Hz Mac, input 0 was the worst zoom
    input in all 9 runs of both engines (mm 31.7 to 35.6 ms, lwc 31.2 to
    49.2 ms) while every other mm zoom input was <= 20.1 ms. One headless
    run measured zoom `input_to_present_p99_ms` 72.1 from input 0 alone
    while every other zoom input was <= 8.7 ms. Read zoom p99 as "the worst
    of 60", not as a tail over a population. Pan has 200 inputs, where p99
    is the 198th value.

### Protocol v2 (zoom)

Q03c binds a v2 protocol for the zoom gesture; the pan gesture stays v1.
Decision record: `DEC:CHART-ENGINE-Q03B-PROTOCOL-V2-WALL-CLOCK-INPUT`
(see docs/receipts). v1 and v2 receipts are NEVER compared without the
`protocol` column (the validator's `protocol` field is `"q03b-v1"` or
`"q03b-v2"`).

The v2 protocol changes only how zoom inputs are delivered and what
state the renderer is in when the gesture starts. It leaves unchanged
every budget (input_to_present p95 ≤ 20 ms, p99 ≤ 33.4 ms), the 60
`wheel(0,-120)` pulses at the chart centre, the pan gesture, the run
count (3, median run by pan.p95), `deviceScaleFactor` 2, the latency
definition (first STATE_PRESENTED_ALL frame at or after the input mark,
within end mark + 100 ms) and the rule that the first input is in the
sample with no exclusions.

(1) **Wall-clock dispatch.** The 60 wheels are sent through ONE CDP
session per gesture as `Input.dispatchMouseEvent` (type `mouseWheel`,
deltaY -120 at the chart centre, the parameters `page.mouse.wheel`
sends) at scheduled wall-clock times `t_i = t_(i-1) + g_i` with
`g_i = 17 + 6 × u_i` ms, `u_i` drawn from `[0, 1)` by Mulberry32 seeded
with `CADENCE_V2_SEED_BASE + run index` (0x51C03B00 + runIdx). The same
seed sequence is used for both engines. The harness arms a timer to
about 2 ms before each target and spins on the Node clock to the target
(never in the page). The next dispatch never waits for the previous
send to acknowledge, and all dispatch promises are awaited after the
end mark.

(2) **Awake start.** The 200 ms pre-gesture idle is replaced by a
harness-side `requestAnimationFrame` heartbeat (empty callback,
installed by `page.evaluate` after `installInputMarks` and before
tracing starts); the start mark is written after at least 200 ms of
heartbeat. Product code is unchanged. Two modes (`env
BENCH_HEARTBEAT_MODE=through|until-first-input`, default `through`):
`through` keeps the heartbeat running through the end mark,
`until-first-input` cancels the pending rAF at the first wheel. The
receipt records the mode and `awake_start.leadin_presentations` (the
count of STATE_PRESENTED_ALL slices in the 200 ms lead-in).

(3) **Receipt.** Top-level `protocol: "q03b-v2"`; under `gesture.zoom`:
`dispatch: { gap_min_ms, gap_jitter_ms, seed, scheduled, dispatched,
dispatch_dev_max_ms }`, `awake_start: { heartbeat_ms, heartbeat_mode,
leadin_presentations }`, and the diag-only `answered_by_prior_frame`
count (inputs whose answering frame began before their mark).
`validateCadenceReceipt` REQUIRES `protocol` and refuses (INVALID,
neither PASS nor FAIL) a v2 receipt whose
`zoom.input_marks !== dispatch.scheduled`, whose
`zoom.input_unpresented !== 0`, whose `dispatch.dispatch_dev_max_ms`
exceeds 2 ms, or whose `heartbeat_mode` is `"through"` with
`leadin_presentations > 0`. An INVALID run is repeated (up to 3
attempts, never counted and never read); any other validation error is
a bug and throws.

(4) **Diagnostic control.** `BENCH_AWAKE_START=idle200` disables the
heartbeat (the v1-style 200 ms idle before the start mark). The
dispatch is identical; the run prints a `CADENCE_CONTROL` line with
`awake_start=idle200` and `heartbeat_mode=none`, `heartbeat_ms=0`, no
per-run or median receipt, and no test failure for that reason.

### Dumping the trace

`BENCH_DUMP_TRACE=1 BENCH_RUNS=1 BENCH_IMPLS=mm` writes
`test-results/bench/cadence-trace-{impl}-r1-<pan|zoom>-<commit-prefix>.json`.
Use the dump to confirm the protocol against a real Chromium; do NOT
commit dumps or anything under `test-results/`.

### Receipt path

The canonical per-impl receipt is

```
test-results/bench/cadence-<impl>-<commit>-<host>.json
```

written by the run whose `pan.p95_ms` is the median of the sorted-ascending
per-run p95s (tie → lower run index, `Math.floor((RUNS - 1) / 2)` of the
sorted set). Receipts are valid only against `validateCadenceReceipt`,
which rejects any top-level key outside the nine and any per-gesture key
outside the thirteen stat keys.

Use an odd `BENCH_RUNS` (the default is 3). With an even count the rule
above picks the lower of the two middle runs, which is the better result,
not a true median.

## Files

| File | Role |
|---|---|
| `terminal/lib/chart-engine/bench/corpus.ts` | Seeded daily-40k generator + pure helpers (browser-safe). |
| `terminal/lib/chart-engine/bench/receipt.ts` | `BUDGETS`, `computeViolations`, `buildReceipt`, `validateReceipt` (Node-only). |
| `terminal/lib/chart-engine/bench/mount.ts` | `mountBench(container, impl)` + `window.__mmBench`. |
| `terminal/lib/chart-engine/bench/cadence.ts` | Q03 parser + per-frame reducer + receipt builder/validator. |
| `terminal/app/dev/chart-bench/page.tsx` | `/dev/chart-bench?engine=mm\|lwc`. |
| `terminal/playwright.bench.config.ts` | Dedicated Playwright config. |
| `terminal/bench/chart-engine.bench.ts` | B1–B6 protocol. |
| `terminal/bench/chart-engine.cadence.bench.ts` | Q03 protocol. |
| `terminal/lib/__tests__/chartEngineCadence.test.ts` | Q03 parser unit tests + 4 falsifiers. |
| `terminal/lib/__tests__/chartEngineLocalization.test.ts` | F-4 `localization.locale` on canvas time-axis labels (the locale is passed through `terminal/lib/chart-engine/canvas/frame.ts`). |
| `terminal/lib/__tests__/fixtures/chart-engine/cadence-trace.sample.json` | Trimmed Q03 fixture (real Chromium 149 pan trace, ≤ 300 events, scrubbed). Its p95/p99 literals come from the gaps the trimming left, not from a real cadence. |
| `terminal/lib/__tests__/fixtures/chart-engine/cadence-trace.input.sample.json` | Trimmed Q03b fixture (real headless pan trace with `pointermove`/`mousemove` input-mark pairs, ≤ 300 events, scrubbed). Carries the start/end marks, a head run and a tail run of input marks, and the renderer PipelineReporter pairs needed to answer every kept mark. Its latency and vsync literals come from the trimmed subset, not from a real cadence. |
| `terminal/lib/__tests__/fixtures/chart-engine/cadence-trace.raf-only.sample.json` | Same fixture with PipelineReporter removed + FireAnimationFrame events per presented time. |
| `docs/chart-engine-completion/receipts/` | Official receipts (seat only); ships with README. |
