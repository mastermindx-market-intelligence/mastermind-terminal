# Independent review — chart-engine integration branch (R21, exit 2)

- **Run**: `ce-review-1012`
- **Range reviewed**: `c923cc46d..8fb010a91bf46e10ce822525b6b91f9a76ef1495` (49 commits, 80 files changed, +26,788 −62)
- **Reviewer mode**: READ-ONLY. The only file created by this review is this document. No implementation file was modified; every dynamic claim below was produced either by quoted command output or by a read-only `vite-node` probe that imports the module and calls it (probe scripts live in `~/lanes/wt/ce-review-1012/.tmp/`, outside the repo tree).
- **Scope note**: the range also carries ~22 files outside the programme surface (`ThesisWorkspace.tsx`, `thesisOntologyReopen.test.tsx`, `e2e/market-ontology-context.spec.ts`, `docs/pr-crops/**`, `e2e/proof/**`) — they enter the range through master ancestry (`git merge-base --is-ancestor c923cc46d HEAD` → yes; base `c923cc4` is master commit "#915") and are **not** programme work. They were not reviewed beyond noting their presence. Cherry-picking to master must take only the programme files.

---

## 1. Baseline (all quoted from this clone at BASE_SHA)

| Check | Command | Result |
|---|---|---|
| Types | `cd terminal && npx tsc --noEmit` | `TSC_EXIT=0` (no output) |
| Tests | `VITEST_MAX_THREADS=3 npx vitest run lib/__tests__/chartEngine*.test.ts lib/__tests__/lwcAdapter.test.ts lib/__tests__/futureTime.test.ts` | `Test Files  25 passed (25)` · `Tests  581 passed (581)` · exit 0 |
| Lint | `npx eslint lib/chart-engine` | no output, `ESLINT_EXIT=0` |

Note: the first vitest attempt used `--reporter=basic`, which vitest 2.1.9 rejects (`code: 'ERR_LOAD_URL'` trying to load a reporter module named "basic"); rerun without the flag is the quoted green run. No red anywhere in baseline.

Dark-launch safety fact (production wiring): both `createEngine` consumers call it **without** an `impl` argument, so `"lwc"` (the shipping renderer) is always selected:

```
components/ChartPanel.tsx:3915:  const engine = createEngine(el, { ...
components/workspaces/RSPivotChart.tsx:24:  const engine = createEngine(el, { height: 430, ... });
lib/chart-engine/index.ts:57:  impl: EngineImpl = "lwc",
```

and no production code reads the selection resolver (`grep -rn "resolveEngineImpl|ENGINE_URL_PARAM|readStoredEngine" lib/ components/ app/ hooks/` → only `lib/chart-engine/select.ts` itself and tests). `impl "mm"` is genuinely unreachable in the app as merged. ChartPanel.tsx and lib/paneSync.ts are untouched by the range (`git diff --name-only c923cc46d..HEAD -- <file>` → empty for both).

---

## 2. Law audit (L1–L8)

### L1 — no `lightweight-charts` import outside `lwc/` — **PASS**

`grep -n "lightweight-charts" lib/chart-engine/api.ts` → only comments (lines 5, 45). `grep -rn "lightweight-charts" lib/chart-engine/canvas/` → only comments (primitives.ts:10, invalidation.ts:4, series.ts:4, snapshot.ts:25, axes.ts:19). `grep -rn 'from "lightweight-charts' lib/chart-engine/ | grep -v lwc/index.ts` → zero import statements. The only non-lwc importer of the package in the tree is `lib/paneSync.ts:13` (`import type { IChartApi, ... }`), which is pre-existing and on the G01 allowlist. Additionally `lib/__tests__/chartEngineBoundary.test.ts` fences this at CI time with a comment-stripping source scan (checks a/b/c/d) — a fence that can go red on a real import.

### L2 — no hardcoded up/down colours under `canvas/` — **PASS with P3 notes**

- Named up/down colours: `grep -rniE '"(green|red|lime|crimson|...)"' lib/chart-engine/canvas/` → **no hits**.
- Series colour resolution is options-driven: `canvas/series.ts:181-182` (`upColor(opts, up)` reads `opts.upColor`/`opts.downColor`; undefined stays undefined), wick/border colours chain through `optStr(opts, …)` (series.ts:281-282, 321). Verified by `chartEngineSeriesGeometry.test.ts:128` ("never hardcodes up/down colors").
- **P3 exceptions (neutral greys, not up/down semantics, but baked literals under `canvas/` contrary to the strict "colours come from options" reading):**
  - `canvas/index.ts:145` — `seriesStroke` last-resort `return "#848484"` when a series carries no colour option at all.
  - `canvas/index.ts:207,220` — grid line fallback `rgba(128,128,128,0.2)`; `canvas/index.ts:348` — crosshair fallback `rgba(180,180,180,0.6)`.

### L3 — `takeScreenshot` synchronous, returns `HTMLCanvasElement` — **PASS**

Every implementation is synchronous and canvas-returning:

- `canvas/index.ts:445-453` (`takeScreenshot(): HTMLCanvasElement`, no `await`; post-destroy returns a 1×1 canvas).
- `canvas/dom.ts:171-189` `takeDomScreenshot` — synchronous composite via `drawImage`.
- `lwc/index.ts:653-655` — `return this.ensure().takeScreenshot()`.
- `conformance.ts:387-393` (Q01-C12) asserts `shot instanceof HTMLCanvasElement` with "no await: sync by contract"; `chartEngineSnapshot.test.ts:102-108` additionally asserts the result is not a thenable and (static-law test, :108-118) that `snapshot.ts` contains no `async`/`await`/`Promise`/`toBlob` constructs.

### L4 — gesture classification uses `event.timeStamp`, never `performance.now()`/`Date.now()` — **PASS**

`grep -rn "performance.now|Date.now" lib/chart-engine/` (impl files) → **zero hits**. `canvas/input.ts` classifies taps/long-press from event `timeStamp` deltas (:100-111 constants, :380, :417, :439-458, :473); the injected `deps.now()` (:89) is used only for inertia frame timing (:309, :336), and the header (:13-15) states exactly that. No gesture code exists in `select.ts` (it is the engine-selection resolver, not gesture classification).

### L5 — pane sync mirrors a calendar window, never bar indexes — **PASS**

`paneSyncAdapter.ts` read in full. Outbound, a logical range is converted to epoch-ms through `calendarWindow`/`calendarMsAt` (paneSyncAdapter.ts:203-229) and broadcast as ms (:324-337, comment: "The bus receives the CALENDAR window … never this pane's bar indexes"). Inbound, ms → `logicalForMs` → `resolveLogical` (:232-236) → `setVisibleLogicalRange`. The shims handed to the legacy bus present an ms-indexed virtual axis (:353-383) so even `paneSync`'s own index arithmetic is calendar-valued. Fractional edges interpolate between neighbour bars; past-the-ends extrapolates at the median cadence (:151-221). The module's tests (`chartEnginePaneSync.test.ts:344-399`) pin interpolation, extrapolation and cross-cadence adoption; the falsifiers named at :35 swap conversions to raw indexes and go red. Caveat: the adapter has **no production consumer** (see §6).

### L6 — one live bar → one generation, no series recreation per tick — **PASS (module level, unwired)**

- `liveGeneration.ts`: `applyLiveOp` (:298-328) issues exactly one `series.update(...)` for the price handle plus one `update()` per in-place derived handle; it never calls `setData`, `addSeries`, or any lifecycle method (grep over the file: `createSeries|addSeries` → none). The reducer bumps `generation` exactly once per non-"none" op (:268-285); `chartEngineLiveGeneration.test.ts:296,448`-style assertions pin this ("bumps exactly once per applied op and never for a refused one").
- `replayGeneration.ts`: pure data reduction, no renderer calls at all (grep `setData|addSeries|createSeries` → doc comments only); queued live commits coalesce per bar key and `exitReplay` hands back a generation-scoped flush (header :21-30).
- Canvas model's live path: `updateSeriesRow` mutates in place / appends; no recreation. (An out-of-order non-matching row is silently dropped — see F-07.)

### L7 — lifecycle: double destroy/remove no-op; `inventory()` after destroy = `{alive:false, zeros}` — **PASS (both engines)**

Canvas — empirically probed (read-only vite-node probe at `.tmp/probe1.mts`):

```
inventory after double destroy: {"alive":false,"panes":0,"series":0,"seriesByPane":[],"priceLines":0,"watermarks":0}
data() after destroy: 0
```

Code: `model.destroy()` guarded by `if (!this.alive) return` (model.ts:633-642); `inventory()` short-circuits to zeros (model.ts:616); `CanvasEngine.destroy` guarded by `if (!this.dom) return` (index.ts:503-518); DOM teardown disconnects the ResizeObserver and removes the root (`dom.ts:156-160`); `removeSeries` idempotent via `s.removed` (model.ts:569-579); price-line remove idempotent (model.ts:705-711).

LWC — code read: `destroy()` starts `if (!this.chart) return; // idempotent` (lwc/index.ts end of file), clears watermark plugins, nulls the chart, `chart.remove()`; `inventory()` returns the zero inventory when `!chart`. Both also covered by conformance Q01-C13/C14 (run against the LWC adapter over the fake registry).

### L8 — six time facts not conflated — **PASS with two P1 exceptions found in the canvas model**

- No function applies the display-epoch conversion twice: `grep -rn "liveDisplayEpoch" lib/chart-engine/` → only `time.ts:213` (applied exactly once in `freezeFacts`, on the key's true-UTC reading) plus tests that pin the arguments (`chartEngineTime.test.ts:159-165` asserts equality against `liveDisplayEpoch(CN_OPEN_UTC * 1000, market)` — this pins *which instant* is fed in; the conversion itself is liveCandle's own, pre-existing logic).
- `time.ts` keeps key/openUtcMs/closeUtcMs/displayEpochSec/sessionId/cadenceSec/isSynthetic as separate frozen fields; `closeTime` availability law honored (:239-244); `preserveSessionAnchors` flags re-anchoring (:255-277). `canvas/lod.ts` header explicitly brands its keys "IDENTITY keys for lookup only … never the legacy display-epoch coordinate and never a render generation".
- **EXCEPTIONS (future slot treated as data — see F-04):** `canvas/model.ts` `timeToIndex` (model.ts:669-671) returns a *synthetic future-slot logical index* even with `findNearest === false`, and `coordinateToTime` (model.ts:522-523) hands synthetic future times to callers — including the crosshair event params built in `canvas/index.ts:382-390`, where a hover past the last bar reports a synthetic time as `param.time`. The programme's own LWC dossier (`docs/chart-engine-completion/lwc-reference-semantics.md:134-141`) states LWC answers **null** in exactly those cases ("`timeToIndex` … returns null when time > last point unless findNearest", "`timeToCoordinate` … null for any time that is not an exact grid point — a future time or a non-sampled intraday second has no coordinate").

---

## 3. Contract drift table (`canvas/index.ts` + `canvas/model.ts` vs `api.ts`; LWC column from `lwc/index.ts`)

Legend: **impl** = implemented, **partial** = implemented for a subset of inputs (rest silently ignored/stored), **visual-noop** = state stored and queryable but never rendered, **stub** = wrong constant answer.

### ChartEngine

| Method | canvas | lwc | Note |
|---|---|---|---|
| `impl` | impl ("mm") | impl ("lwc") | |
| `addSeries` | impl | impl | handle identity stable (model.ts:238-239, 379-381) |
| `removeSeries` | impl | impl | post-destroy quiet |
| `panes` | impl | impl | |
| `timeScale` | impl | impl | |
| `priceScale` | impl | impl | |
| `chartElement` | impl | impl | detached root after destroy |
| `options` | impl | impl | |
| `setCrosshairPosition` / `clearCrosshairPosition` | impl | impl | canvas draws overlay line, not echoed to subscribers (LWC semantics) |
| `paneSize` | impl | impl | throws for missing pane (contract permits) |
| `swapPanes` | impl | impl | |
| `takeScreenshot` | impl | impl | canvas composites pane canvases only — **overlay canvas not composited** (dom.ts:171-189); `snapshot.ts` compositor unused (F-06) |
| `applyOptions` | **partial** | impl (forwards 1:1) | canvas honors width/height; `timeScale` group only `rightOffset`/`barSpacing` (model.ts:444-449, 542-552); `rightPriceScale.mode` requested post-construction is silently ignored while the constructor *refuses* the same option (F-02) |
| `subscribe`/`unsubscribe` ×6 | impl | impl | |
| `setWatermark` | **visual-noop** | impl | stored in model + counted in inventory (model.ts:431-437); `paint()` never draws it (index.ts:316-359) |
| `resize` | impl | impl | |
| `unwrap` | impl (returns ChartModel) | impl (IChartApi) | |
| `inventory` | impl | impl | |
| `destroy` | impl, idempotent | impl, idempotent | |

### SeriesHandle

| Method | canvas | Note |
|---|---|---|
| `kind`, `setData`, `applyOptions`, `options`, `data`, `paneIndex`, `pane`, `moveToPane`, `priceScale`, `priceToCoordinate`, `coordinateToPrice`, `remove`, `unwrap` | impl | |
| `update` | impl, **one drift** | unmatched out-of-order rows silently dropped (model.ts:604-611) — F-07 |
| `dataByIndex` | impl, **one drift** | `nearest-left` rounds instead of flooring (F-05) |
| `setMarkers` | **visual-noop** | stored (model.ts:734-739), never painted |
| `createPriceLine` / `removePriceLine` / `priceLines` | impl storage, **visual-noop** | counted in inventory, never painted |
| `attachPrimitive` / `detachPrimitive` | **visual-noop** | stored (model.ts:789-800), never invoked; `canvas/primitives.ts` host unused |

### PaneHandle — all methods impl on both engines (index/height/setHeight/setStretchFactor/stretchFactor/getHTMLElement/getSeries/priceScale/unwrap). Canvas `getSeries` returns identity-stable handles (model.ts:831-840) matching the C02 promise.

### TimeScaleHandle

| Method | canvas | Note |
|---|---|---|
| `get/setVisibleLogicalRange`, `subscribe/unsubscribe…Change`, `scrollToRealtime`, `fitContent`, `getVisibleRange`, `setVisibleRange`, `logicalToCoordinate`, `coordinateToLogical`, `width`, `options`, `unwrap` | impl | |
| `timeToCoordinate` | impl, **drift** | nearest-bar answer for any in-window time; LWC → null for non-grid times (F-04) |
| `coordinateToTime` | impl, **drift** | returns synthetic future time past the last bar (probe: `coordinateToTime(xOfLogical(5)) -> 6000` with 4 rows at 1000..4000) (F-04) |
| `timeToIndex` | impl, **drift** | future slot returned even with `findNearest=false` (probe: `timeToIndex(6000,false) -> 5`) (F-04) |
| `scrollToPosition` | impl | `animated` accepted and ignored (`void animated`, model.ts:911) — LWC animates |
| `applyOptions` | **partial** | only `rightOffset`/`barSpacing` (model.ts:542-552); everything else silently stored |

### PriceScaleHandle

| Method | canvas | Note |
|---|---|---|
| `applyOptions` | impl, **accepts too much** | takes `mode: log/percent/indexed100` (model.ts:862-864) it cannot render — F-02 |
| `options`, `getVisibleRange`, `setVisibleRange`, `setAutoScale`, `unwrap` | impl | autoscale runs only in normal mode (model.ts:313) |
| `width` | **stub** | `return 0;` always (model.ts:851) |

### PriceLineHandle — `applyOptions`/`options`/`remove`/`unwrap` impl on both (canvas storage-only visually).

**LWC adapter**: full delegation for every contract method; new C02 queries wrapped in `quietQuery`/`quietMutate` (no-throw after dispose); P0-era methods still throw `chart-engine: disposed`/`series removed` exactly as api.ts:185-187 documents.

---

## 4. Duplicate local structural types

The lanes were told to declare local mirrors; the integrator was to unify. Unification did **not** happen (evidence: `canvas/primitives.ts:12-14` still says "the integration parent should alias them to C03's declarations instead of keeping a second copy").

| Type | Declarations | Shapes agree? |
|---|---|---|
| `LogicalIndex` | model.ts:38, input.ts:33, scales.ts:32, series.ts:19, primitives.ts:19 | yes — all `= number` |
| `TimeScaleState` | model.ts:39, input.ts:35, scales.ts:49, series.ts:20 (ticks.ts/tests import) | yes — identical 5 fields |
| `PriceScaleState` | model.ts:46, input.ts:43, scales.ts:36, series.ts:23 | **no** — model adds **required `autoScale: boolean`**; scales adds **optional `baseValue?: number`** and aliases `mode` to its own `PriceScaleMode` (scales.ts:34); series/input match the shared vocabulary exactly |
| `Projection` | model.ts:55, series.ts:27 | yes — identical 4 fields + 4 methods |
| Projection vocabulary, extended copies | `drawingBridge.ts:47-56 DrawingProjection` (same 8 members), `primitive.ts:38-50 EngineProjection` (adds `timeToX`/`xToTime`), `canvas/primitives.ts` Host* mirrors (per its own header) | consistent supersets; 6 copies of the vocabulary in total |
| `PriceScaleMode` | scales.ts:34 `PriceScaleMode` vs options.ts:14 `EnginePriceScaleMode` | same union, two names |

Deltas are the finding (F-10): a `PriceScaleState` built by `scales.ts` consumers cannot be handed to `model.ts` (missing `autoScale`) without the integrator noticing — today nothing crosses that boundary, which is itself the symptom of the non-integration.

---

## 5. Test quality (per new test file: 3 most important assertions + can-they-fail judgment)

Method note: the review mandate is read-only, so mutations were **not** applied by this reviewer; mutability is judged by reading the assertion against the implementation, plus the lanes' own RED/GREEN falsifier notes where present. Two extra dynamic checks were run as read-only probes (quoted in §2/§3). Files not listed individually below were scanned and are covered by the summary sentence at the end.

- **chartEngineBoundary.test.ts** — (a) `expect(offenders).toEqual([])` over a comment-stripped walk of all non-lwc engine files (fails on any real LWC import — trivially mutable to red); (b) allowlist ratchet `newImporters … toEqual([])` (fails when a new importer appears); (c) unwrap-tag budget `total <= 8` (fails on the 9th tag). All three can fail; this is the fence that keeps L1 true.
- **chartEngineConformance.test.ts** — the suite runs the 15 CHECKS against the LWC adapter over a fake registry and then a deliberately broken fake through `collectEngineConformance`, asserting the planted defects produce `fail` results (the built-in falsifier, :734-762). Can fail; note the harness's `it.skip` mechanism (:507) is currently invoked with **no** opt-outs. **Gap: the canvas engine never passes through `runEngineConformance`** (grep: only one call site, line 336) — the branch's parity gate was never applied to the renderer it was built for (F-08).
- **chartEngineCanvasModel.test.ts** — `destroy … zeroes inventory` (:333) and `post-destroy handles are deterministic no-ops` (:367) pin L7 (a `s.removed`-guard removal goes red); `projection round trips … within 1e-9` (:272) pins the coordinate convention (a `+0.5` drop in `xOfLogical` goes red). **But :296 ("timeToCoordinate resolves nearest primary-series row") affirmatively pins the drifted nearest-resolution semantics** — the test enshrines behaviour the programme's own dossier contradicts (F-04).
- **chartEngineCanvasC02.test.ts** — handle identity (`priceLines()`/`getSeries()` return the same objects), `data()` snapshot ownership, nearest-left branch; header declares the falsifier ("mutate the model's nearest-left branch → RED"). Judgment: passes-mutation-credible; note it tests the *model's* nearest-left (out-of-range only), not the fractional in-range case where the drift lives (F-05).
- **chartEngineHandles.test.ts** — LWC adapter C02 delegation against spies: `dataByIndex maps MismatchDirection strings onto LWC's numeric enum` (:377, fails if the map is dropped), `after destroy, C02 mutators no-op, queries return null/[]/0/{}` (:487, fails if `quietQuery` is bypassed), `pane.getSeries returns the identical SeriesHandle objects` (:426, fails if the WeakMap registry is removed). All can fail.
- **chartEnginePaneSync.test.ts** — `a peer window with a different cadence lands on the right logical range here` (:386 — the L5 law as a number; fails if conversions swap to indexes), `swallows a synchronously delivered echo` (:436), `lets the echo of a BUS-driven write reach the bus` (:452). Strong, falsifiable; file header documents index-swap falsifiers.
- **chartEngineLiveGeneration.test.ts** — `keys an hourly print to the 09:30-anchored bar … INPLACE, not an append` (:230 — the display-epoch bucketing law; fails if the tick's own print time is used), `bumps exactly once per applied op and never for a refused one` (:296), `never mutates the input state` (:318). Can fail; the mutation targets are the guard order and the fold.
- **chartEngineTime.test.ts** — `extracts US facts: display epoch shifts 13:30Z to the 09:30 ET wall clock` (:127 — a hard number, dies on any double shift), `flags a re-anchored session id` (:227), `T01-A04: the facts record is frozen` (:202). The `T01-A03` sweep (:159) recomputes with `liveDisplayEpoch` — it re-runs the same conversion the impl calls, so it pins the *argument wiring*, not the conversion (borderline re-implementation; acceptable because liveCandle's conversion is separately tested there, but the test could not catch a wrong market table by itself — it can, since it iterates all five markets against their zones' expected wall clocks at :127-157. Judgment: can fail).
- **chartEngineSelect.test.ts** — kill switch precedence (:159 "always wins over a valid mm url, an mm choice and an mm default" — fails if the order flips), `first occurrence wins when the param repeats` (:191), `a throwing storage never throws` (:211). All can fail.
- **chartEngineInvalidation.test.ts** — `five invalidations before a flush produce exactly one schedule and one generation bump` (:135), `a re-entrant flush() … returns null` (:259), `update off-screen → level none, and NOTHING is scheduled` (:370). All count-based and mutable.
- **chartEngineLod.test.ts** — extrema-preservation against a brute-force pass (:15 header names the falsifier mutant), exact-index lookups, 40k-collapse bound (:340). Can fail.
- **chartEngineScales.test.ts** — `inverts within 1e-9 relative across modes` (:89), `keeps the price under the pointer fixed while zooming` (:188 — the pointer-anchored law), `autoscales percent and indexed100 in the display domain` (:165). Can fail. (Note this file exercises `scales.ts`, which the engine does **not** use — green here says nothing about the shipped paint path.)
- **chartEngineSeriesGeometry.test.ts** — dpr snapping (:102, :140), polyline whitespace/NaN breaks (:176), baseline crossing (:249). Can fail. The "never hardcodes up/down colors" case (:128) only feeds opts-supplied colours, so it cannot catch a fallback baked when options are absent (index.ts:145 is exactly such a fallback — untested).
- **chartEngineCrosshair / Input / Axes / Snapshot / Primitives / PrimitiveLifecycle / DrawingBridge / Replay / Options / FutureAnchors** — scanned: assertions are numeric/pixel/count-based with named falsifiers in headers (e.g. Input's tap/long-press boundaries at :100-111 are asserted with timeStamp deltas at both edges; Axes pins containment and priority ordering; Snapshot pins draw order, dpr math and typed errors). No assertion found that compares a value to itself.
- **lwcAdapter.test.ts** (modified, +94/−5) — deletions are only the fake registry growing richer (FakePriceScale gained options/range methods); no existing assertion was weakened, no skip/only added anywhere in the range (`git diff | grep '^\+.*it\.(skip|only)'` → 0).

**No test re-implements its function under test and compares the two.** The nearest cases (Time's `T01-A03` sweep, model's round-trip `logicalOfX(xOfLogical(i))`) compare a function against its own *inverse* or pin the inputs of a delegated conversion, which are legitimate.

---

## 6. Dead / unreachable code and exports nothing imports

Production-consumer map (`grep` across `lib/ components/ app/ hooks/`, excluding tests): **the only new modules reachable from production are `canvas/index.ts` + `canvas/model.ts` + `canvas/dom.ts` (via `createEngine(…, "mm")`, itself unreachable) and `options.ts` (re-exported types only)**. Everything else is imported only by its own test (or by another test-only module):

- Test-only, by design (staged engine parts): `canvas/series.ts, scales.ts, ticks.ts, axes.ts, crosshair.ts, input.ts, invalidation.ts, layout.ts, lod.ts, primitives.ts, snapshot.ts`; `liveGeneration.ts` (only importer: `replayGeneration.ts`, itself test-only); `replayGeneration.ts`; `time.ts`; `drawingBridge.ts`; `paneSyncAdapter.ts`; `primitive.ts` (importer: `canvas/primitives.ts`, test-only); `select.ts`; `conformance.ts` (harness; expected).
- `options.ts` `normalizeEngineOptions` + `EngineCapabilities` + `LWC_CAPABILITIES`/`CANVAS_CAPABILITIES`: exported, advertised in `index.ts`, consumed by **no** production or engine code — the canvas engine has its own duplicate refusal (`collectUnsupported`, canvas/index.ts:124-137). Two option-gate mechanisms, one dead (F-09).
- Exported constants with no references outside their own module (not even tests): input.ts `TAP_MAX_MS…INERTIA_MAX_MS`, `zoomTimeAround`; dom.ts `sizeCanvas`; model.ts `DEFAULT_SCALE_MARGINS`, `asCadenceTime`; scales.ts `priceToDisplay`; liveGeneration.ts `toLiveBar`; viewReset.ts `DEFAULT_CHART_RIGHT_BUFFER_PX` (pre-existing). These are internal helpers exported "just in case" — P3 tidy-ups, not bugs.
- Unwired ≠ unintentional: every unwired module's header describes integration that was to happen at merge time ("R02 replaces with canvas/series.ts geometry" — canvas/index.ts:160; "T02's scales.ts replaces these implementations" — model.ts:102; primitives.ts's alias-me note). The integration step this branch is named for did not perform those wirings. That is the branch's central gap (F-01).

---

## 7. Findings

Severity: P0 wrong behaviour that would ship · P1 contract/law violation · P2 drift, test-cannot-fail, duplicate type · P3 style.

| ID | Sev | Location | Finding | Scenario / evidence | Falsifier (test that would catch it) |
|---|---|---|---|---|---|
| F-01 | **P1** | canvas/index.ts:160-359 (paint), :56-64 (capabilities) | The shipped canvas engine still paints the R01 placeholder (close-polyline / 1px stems, no bodies, no colours, no axes, no markers, no price lines, no watermark, no primitives, no LOD, no invalidation scheduling, no gesture input) while `CANVAS_CAPABILITIES` advertises `watermark: true, markers: true, primitives: true, screenshot: true`. Eleven tested modules sit beside it unwired. `setWatermark`/`setMarkers`/`createPriceLine`/`attachPrimitive` are silent visual no-ops (state stored, inventory counts, nothing rendered). | `grep` import graph: index.ts imports only `./dom`, `./model`. Paint loop calls `paintSeries` (the file's own comment says R02 replaces it). | Engine-level render test: mount `createCanvasEngine`, set markers/price line/watermark, flush a manual scheduler, assert the recorded 2D-context calls contain their draw operations (the existing fake-ctx harness in chartEngineCanvasC02 already records calls — extend it past `drawImage`). Also: run `runEngineConformance("canvas", …)` (see F-08) and add capability-vs-render assertions. |
| F-02 | **P1** | canvas/model.ts:862-865 (accept), :313 (autoscale skip), :103-136 (linear-only math) | `priceScale().applyOptions({mode:"log"})` is accepted after construction, but the engine's math is linear-only and autoscale is silently skipped for non-normal modes — wrong rendering with no refusal, while the *same* option at construction throws `EngineRefusalError` (canvas/index.ts:124-137). | Probe: `applyOptions({mode:"log"})` → `options().mode === "log"`, `priceToCoordinate(2.5)` → `0` on a degenerate `{from:0,to:1}` range, no error. | Unit test: apply mode log post-construction, expect either a thrown refusal (parity with constructor) or log-math coordinates; assert `priceToCoordinate` under log differs from linear for a skew of prices. |
| F-03 | **P1** | primitive.ts:328-339; absent from lwc/index.ts | `toLwcPrimitive` is an exported, documented bridge that **always throws** ("typed stub — the lwc/ adapter implements it"), but the lwc adapter never grew the implementation. The C03 lane's contract says the parent implements it; the integration left the stub. | `grep toLwcPrimitive lwc/index.ts` → none; the only test asserts the throw. | A test that calls `toLwcPrimitive(primitive, () => proj)` and expects a working LWC primitive object (attach/update events flow) instead of the stub throw. |
| F-04 | **P1** (L8 conflation + drift) | canvas/model.ts:492-512 (`timeToCoordinate`), :514-524 (`coordinateToTime`), :656-672 (`timeToIndex`), canvas/index.ts:382-390 (crosshair params) | Future slots leak out as data: `timeToIndex(t, false)` returns a synthetic future logical (contract comment at api.ts:247-249 says findNearest=false is *exact*); `timeToCoordinate` answers a coordinate for times that don't exist; `coordinateToTime`/crosshair `param.time` hand synthetic future times to consumers. The programme's own dossier (lwc-reference-semantics.md:134-141, dev-line-cited) says LWC answers null in all three cases — paneSync (exact `timeToIndex` consumer, api.ts:249) would resolve future windows against mm but abort against lwc. | Probes: `timeToIndex(6000,false) -> 5`; `timeToCoordinate(3500) -> 250`; `coordinateToTime(xOfLogical(5)) -> 6000`. Canvas test :296 pins the nearest-resolution behaviour instead of the dossier's. | Cross-engine parity test (or extend Q01): for a time between bars, a future time, and a hover past the last bar, assert `null` on both engines; assert `timeToIndex(future, false) === null`. |
| F-05 | P2 | canvas/model.ts:748-757 | `dataByIndex(2.6, "nearest-left")` returns the row at index 3 (`Math.round`), LWC's NearestLeft returns the largest index **<** logical (index 2; dossier dev:3028-3035). Cross-impl readback drift; conformance doesn't check dataByIndex. | Probe: `dataByIndex(2.6,'nearest-left') -> time 4000`. | Parity test: `dataByIndex(2.6, "nearest-left")` must equal `rows[2]` on both engines. |
| F-06 | P2 | canvas/dom.ts:171-189 vs canvas/snapshot.ts | Two screenshot compositors: `takeDomScreenshot` (used; pane canvases only, overlay canvas never composited — crosshair lines missing from screenshots vs LWC) and `snapshot.ts`'s richer compositor (layers, dpr, opacity; unused by the engine). | Import graph; snapshot.ts exports test-only. | Screenshot parity test: draw the overlay (setCrosshairPosition), take a screenshot, assert the overlay pixels/ops appear; run `composeSnapshot` through the engine path. |
| F-07 | P2 | canvas/model.ts:604-611 | `update()` with an out-of-order time that matches no existing row is silently dropped. LWC's `update` semantics for historical rows differ (adapter forwards verbatim; the conformance corpus never exercises an unmatched out-of-order row). Labelled unverified-against-real-LWC (jsdom cannot run real LWC). | Probe: `after out-of-order update, data().length = 4` (row at t=1500 dropped). | Conformance check: `update({time: mid-series non-existent time})` then assert the row count/behaviour is identical on both engines (insert vs drop), or document the drop in api.ts. |
| F-08 | P2 | lib/__tests__/chartEngineConformance.test.ts:336 | The factory-agnostic conformance harness — built precisely to measure renderer parity — runs only against the LWC adapter (fake registry) and a deliberately broken fake. The canvas engine never passes through it, so F-04/F-05/F-07 class drifts are invisible to CI. | `grep runEngineConformance lib/__tests__` → single call site, LWC only. | Add `runEngineConformance("canvas (impl mm)", (c) => createCanvasEngine(c, {scheduler: manual, …}))`; expect red on F-04 today (timeToCoordinate-related checks absent, so at minimum it locks the 15 shared semantics). |
| F-09 | P2 | lib/chart-engine/options.ts (whole) vs canvas/index.ts:113-137 | Two option-gate mechanisms: `normalizeEngineOptions(options, caps)` (typed result, allowed-group list, zero callers) and the engine's private `collectUnsupported` + `EngineRefusalError`. They already disagree in coverage (e.g. engine checks kineticScroll and construction-time scale modes; normalize checks group names) and only one is live. | `grep normalizeEngineOptions` → index.ts re-export + tests. | Delete-one-or-wire-the-other: a test asserting the engine's refusal list equals `normalizeEngineOptions(…).unsupported` for a corpus of option bags. |
| F-10 | P2 | §4 table | Duplicate structural types left un-unified, with real deltas: `PriceScaleState` model(+`autoScale` required) vs scales(+`baseValue?`) vs series/input(shared vocabulary); 6 copies of the Projection vocabulary; `PriceScaleMode`/`EnginePriceScaleMode` alias pair. primitives.ts's header explicitly asks the integrator to alias — not done. | Quoted greps in §4. | Type-level test: `const _a: model.PriceScaleState = scalesStyleState;` in a checked test file (tsc red until unified), or a lint rule forbidding re-declaration outside model.ts. |
| F-11 | P2 | canvas/model.ts:542-552; model.ts:444-449 | `TimeScaleHandle.applyOptions` and engine `applyOptions` silently ignore every timeScale option beyond `rightOffset`/`barSpacing` (e.g. `timeVisible`, `secondsVisible`, `borderColor`): stored, echoed in `options()`, never acted on. Consumers (RSPivotChart passes `timeScale: {timeVisible: true, secondsVisible: false}`) would believe it took effect. | Code read; RSPivotChart.tsx:24 quoted in §1. | Engine options test: apply `timeScale:{timeVisible:false}` and assert a visible behavioural difference (or a refusal) rather than silent storage. |
| F-12 | P2 | lib/chart-engine/time.ts:204-224 vs the app pipeline | `barTimeFacts` reads row keys as **true UTC** and derives `displayEpochSec = liveDisplayEpoch(openUtcMs, market)`. The app's chart rows carry **display-epoch** keys (liveCandle.ts:71-88: "the same convention used by the REST intraday loader"), so any future consumer that feeds engine rows into `barTimeFacts` shifts twice. No shipped consumer today (module is test-only) — latent L8 hazard, the exact conflation the law names. | Convention quotes from liveCandle.ts and time.ts. | A doc/test fixture asserting the expected caller: either `barTimeFacts(displayKey→trueUtc pre-mapped)` documented, or a test feeding a display-epoch key and asserting the *non*-double-shifted result fails today and forces the decision. |
| F-13 | P2 | lib/chart-engine/select.ts (whole) | The dark-launch entry the masterplan names (masterplan.md:84 "Dark-launch behind `?engine=mm` and a per-user flag") does not exist end-to-end: the resolver is complete and tested, but nothing in the app reads `location.search`/`mm.engine` storage or passes `impl` to `createEngine`. An operator cannot actually dark-launch mm from this branch; the flip is factory-level only. | Consumer grep quoted in §1. | An app-level test (ChartPanel or a hook) that mounts with `?engine=mm` and asserts `engine.impl === "mm"` — currently impossible. |
| F-14 | P3 | canvas/index.ts:145, 207, 220, 348 | Baked neutral-grey fallbacks (`#848484`, `rgba(128,128,128,0.2)`, `rgba(180,180,180,0.6)`) under `canvas/`. Not up/down colours (L2's target), but they are literals in a "colours come from options" layer and are untested (the geometry test only passes colours through opts). | Quoted greps in §2. | Render test with no colour options: assert the fallback comes from a named, documented default (or the caller's theme), not a bare literal. |
| F-15 | P3 | canvas/model.ts:911; model.ts:138-143 vs time.ts:84 | Minor: `scrollToPosition` ignores `animated` (documented in code); ms-leak thresholds disagree across the tree (time.ts rejects keys > 1e11 s; model.ts `timeToMs` switches to ms at 1e12; timeWindow.ts always multiplies by 1000) — an epoch-seconds value between 1e11 and 1e12 is a valid year-5138+… actually out-of-range for dates, so the disagreement is benign but should be one constant. | Code quotes. | Constant-unity test or a shared `EPOCH_S_MAX` import. |
| F-16 | P3 | conformance.ts:507; canvas/model.ts:633-642 | The conformance harness contains an `it.skip` opt-out mechanism (currently unused — no ids opted out); `ChartModel.destroy()` clears handler sets but keeps `seriesHandles`/`lineHandles`/`panes` contents alive until GC (contract-visible behaviour is correct: `alive:false` gates everything). | Code read. | None needed; note only. |

No P0: nothing in this range changes behaviour of the shipping LWC path (ChartPanel.tsx, paneSync.ts untouched; adapter changes are additive C02 surface + quiet post-dispose semantics, all green on the existing and extended adapter tests), and impl "mm" is unreachable from any consumer.

---

## 8. Verdict

**Safe to merge as a dark-launched, unused-by-default engine — yes, with conditions.** The shipping path is untouched: ChartPanel.tsx and lib/paneSync.ts have zero diff, both `createEngine` call sites default to `"lwc"`, the adapter's additions are additive and quiet-on-dispose, and the baseline is fully green (`tsc` 0, 581/581 tests, eslint 0) with no weakened, skipped or only'd test anywhere in the range. The law audit passes L1–L7 outright, and L8 passes everywhere except the canvas model's future-slot leaks (F-04), which are unreachable in production because nothing selects "mm". The integration risk of merging is therefore low, and the branch is a net positive: the contract grew a precise C02 surface, a real conformance harness, a boundary fence, and a large corpus of genuinely falsifiable pure modules.

It is **not** close to the P4 flip, and should not be represented as a completed P3: the canvas renderer that "mm" actually mounts is still the R01 placeholder — eleven tested modules (geometry, colours, axes, ticks, scales modes, crosshair, gestures, invalidation, LOD, primitives, snapshot compositor) sit beside it unwired, its capability flags claim support (markers/primitives/watermark) that paint never delivers, its own conformance harness has never been run against it, and four contract-method drifts against the programme's own LWC dossier (F-04, F-05, F-07, F-11) are live in the model — one of them (nearest-resolution) even enshrined in a test. The masterplan's stated dark-launch lever (`?engine=mm`) is not wired end-to-end (F-13), so an operator cannot exercise mm from the URL. Merge as dark scaffolding, then treat F-01/F-02/F-04 (P1) as the exit criteria for any P3 "done" claim.

**What I could NOT verify** (and how): (1) Real-LWC runtime behaviour — jsdom has no canvas, so every LWC claim rests on the adapter tests' fake registry and on the lanes' `lwc-reference-semantics.md` dossier (dev-line-cited but not re-derived by me); the F-05/F-07 drift statements cite that dossier, and F-07 is labelled unverified-against-real-LWC. (2) Rendering fidelity of the canvas engine — the fake 2D context records calls but paints nothing; no pixel was ever looked at, and Playwright/e2e were out of scope by instruction. (3) The performance budget (`performance-budget.md`, receipt schema) — no benchmark was run. (4) Mutation falsifiers — the read-only mandate forbade mutating implementations, so §5 mutability judgments are argued from the assertion/implementation pair, not from observed RED; the lanes' own RED/GREEN claims were not re-executed. (5) The ~22 non-programme files riding in the range (ThesisWorkspace, pr-crops, e2e proofs, thesisOntologyReopen.test.tsx) — out of scope, unreviewed, and the integrator must cherry-pick around them. (6) `runEngineConformance` against mm (F-08) — not run by me either, since adding that suite would have meant writing a test file, which the mandate forbids; the two `.tmp` probes quoted above are the only dynamic evidence, and they exercise the model directly rather than through `createEngine`.
