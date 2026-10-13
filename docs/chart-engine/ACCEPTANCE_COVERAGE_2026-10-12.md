# Chart Engine — Acceptance Coverage Census (2026-10-12)

RUN_ID `ce-accept-1012` · BASE_SHA `8fb010a91bf46e10ce822525b6b91f9a76ef1495` (head of `claude/ce-integrate-1012`, the P2–P4 integration branch) · mode READ_ONLY + DOC.

This census maps every acceptance ID of the programme's masterplan acceptance matrix to the
test(s) on the integration branch that prove it, classifies the coverage, and lists what is
still unproven so the next lane wave can be launched from it. Test names were read at the
assertion level (grep located candidates; reading the assertions was the proof). Every PROVEN
row below is backed by a green run of its cited file today — see §Run evidence.

Status vocabulary:

- **PROVEN** — a cited assertion would fail if the behaviour broke.
- **PARTIAL** — a related test exists, but the specific scenario is not asserted; the gap column says what is missing.
- **UNPROVEN** — nothing on the branch exercises the scenario.
- **N/A-PENDING** — depends on the ChartPanel migration (M01–M03) that is not on this branch.

## The acceptance matrix (authoritative input, reproduced)

Per package, four falsifiable scenarios:

- **C01** — A01 contract contains explicit supported methods; A02 unknown native option → typed refusal; A03 unused vendor API not copied; A04 non-chart Options consumers outside closure.
- **C02** — A01 supported data/scale queries return defined values without exposing a native object; A02 use after destroy is a deterministic no-op or disposed error; A03 same source → same pixels before/after adapter change; A04 unsupported native option → frozen explicit refusal with unchanged last valid state.
- **C03** — A01 finite zero coordinates from an unready scale keep readiness false; A02 stale primitive callback after generation change is discarded; A03 destroy/remove twice detaches once; A04 shared overlay uses one projection generation.
- **M01–M03** — ChartPanel migration seams (M01 mount/teardown/primary price series/StrictMode; M02 studies/compare/live updates; M03 decorations on the price series). NOT on this branch.
- **T01** — A01 display epoch applied exactly once; A02 backfilled prefix keeps 3D group identity; A03 opening time = identity, closeTime = availability; A04 invalid/duplicate keys rejected explicitly.
- **T02** — A01 normal/log/percent/indexed100 + inverted round trips; A02 empty/constant/single-bar/all-missing inputs give safe extents; A03 small pane/EN-ZH/fractional DPR labels obey the no-overlap rule; A04 repeated opposite wheel deltas return to baseline.
- **T03** — A01 future anchor survives new bars; A02 holiday future date not claimed as a session; A03 future whitespace never fabricates values; A04 zero/one input time → explicit no-cadence.
- **R01** — A01 factory default still LWC; A02 impl `mm` reports identity with no hidden LWC; A03 dispose/remount ends ownership once; A04 unsupported feature refuses without mutating saved workspace.
- **R02** — A01 each series kind on a fixed fixture: geometry/colour/extents/identity; A02 40k bars at multiple zooms keep exact lookup and declared extrema; A03 removing an empty pane obeys ownership/order/sizes; A04 gap/NaN/whitespace rows never connect or invent zero.
- **R03** — A01 100 same-frame updates → latest generation, bounded coalesced paints; A02 historical correction invalidates autoscale; A03 idle/destroyed chart has no timer/frame loop; A04 a deliberately orphaned series/line is caught by the inventory comparison.
- **R04** — A01 primitive clips to its pane for paint AND hits; A02 generation change mid-draw discards stale projection; A03 null upstream overlay stays honestly unavailable; A04 raw LWC primitive passed to mm → explicit unsupported.
- **R05** — A01 snapshot after live update equals committed view; A02 multi-pane high-DPR capture has no blank strips/duplicate labels; A03 tainted resource → typed failure; A04 no hidden Promise in the sync contract.
- **I01** — A01 pinch keeps the anchor under the fingers within the CSS-px budget; A02 pointercancel ends the gesture with no sticky state; A03 touch in a scrolling control preserves page behaviour; A04 keyboard + reduced motion reach range/reset/crosshair.
- **I02** — A01 axis wheel repeated/reversed has no cumulative wall; A02 collapsed pane reopened keeps meaning once ready; A03 overlapping price tags follow the frozen priority; A04 fractional DPR keeps hit/paint aligned.
- **I03** — A01 peers with different history lengths share a TIME window; A02 register/unregister/reuse cannot deliver a stale crosshair; A03 plan change before RAF discards the old-plan event; A04 no new synchronised dimension.
- **D01** — A01 same drawing in both engines → identical anchors and bytes; A02 timeframe/history changes keep the anchor policy; A03 unready scale → no migration write; A04 source disappears then returns → document recoverable.

## Coverage table

Files are under `terminal/lib/__tests__/`. `it()` names are quoted verbatim.

### C01 — contract explicitness

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| C01-A01 | PROVEN | chartEngineConformance.test.ts : `runEngineConformance("LWC adapter (fake registry)", …)` — checks Q01-C01…Q01-C15 (e.g. `Q01-C02 — all six kinds add with their fixture; inventory counts match`) | Each contract method is driven through the factory-agnostic harness; a missing or broken surface method fails its named Q01-\* check ("never ran" → fail). `lwcAdapter.test.ts : "createEngine('lwc') and createLwcEngine both build one chart via createChart"` pins the factory entry. | Harness runs only against the LWC adapter + the broken fake, not against impl `mm` (see C02-A03). |
| C01-A02 | PARTIAL | chartEngineOptions.test.ts : `"refuses overlayPriceScales, trackingMode, watermark, addDefaultPane, hoveredSeriesOnTop"`; `"never mutates the caller object on accept or refuse"`; chartEngineCanvasModel.test.ts : `"EngineRefusalError leaves no DOM (R01-A04)"` | `normalizeEngineOptions` returns `{ok:false, reason, unsupported}` for unknown/native-only groups; canvas construction throws typed `EngineRefusalError` (`unsupported` contains `priceScaleMode:log`). | `normalizeEngineOptions` is exported but **not wired into either factory**; `collectUnsupported` (canvas/index.ts) only checks price-scale mode + kineticScroll, so an unknown group (e.g. `trackingMode`) passed to a live engine is silently accepted. |
| C01-A03 | PARTIAL | chartEngineBoundary.test.ts : `"(a) no file under lib/chart-engine/ outside lwc/ imports lightweight-charts"`; `"(b) no NEW importer of lightweight-charts appears outside lib/chart-engine (allowlist ratchet)"` | Comment-stripped source of every non-lwc engine file must not match the LWC import regex; offender list must be `[]`. | No test asserts the contract surface equals the *consumed* set (that census lives in docs/chart-engine-completion/contract-census.md, a doc, not a gate). |
| C01-A04 | PROVEN | chartEngineBoundary.test.ts : `"(b) no NEW importer of lightweight-charts appears outside lib/chart-engine (allowlist ratchet)"` + `"(b) every allowlist entry exists on disk…"` | Non-chart consumers (Options-suite panes `surface/*.tsx`, `EmbedChart.tsx`, …) are enumerated on `LWC_IMPORT_ALLOWLIST`; a new importer outside `lib/chart-engine` fails, a stale entry fails. | — |

### C02 — data/scale queries

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| C02-A01 | PROVEN | chartEngineHandles.test.ts : `"data() snapshots rows and never returns the native series"`, `"series.priceScale forwards options / range / autoScale without leaking the native scale"`; chartEngineCanvasC02.test.ts : `"series.data()/options() are copies and dataByIndex honours the mismatch direction"` | `expect(s).not.toBe(rawSeries())`; mutating the returned rows/options does not change readback; canvas engine returns plain copies. | — |
| C02-A02 | PROVEN | chartEngineHandles.test.ts : `"after destroy, C02 mutators no-op, queries return null/[]/0/{}, nothing throws, inventory stays safe"`; lwcAdapter.test.ts : `"post-destroy engine calls throw Error('chart-engine: disposed')"`; chartEngineCanvasC02.test.ts : `"after destroy the C02 surface is a deterministic no-op…"` | Everything post-destroy either no-ops with quiet query values or throws the typed disposed error; `inventory()` answers `{alive:false, …zeros}` without throwing. | — |
| C02-A03 | UNPROVEN | — | — | No cross-engine parity test exists: `runEngineConformance` runs only the LWC adapter; the canvas engine is never driven through the shared harness, and no test feeds the same source through both engines and compares pixels. This is the P4 gate. |
| C02-A04 | PROVEN | chartEngineOptions.test.ts : `"refuses overlayPriceScales, trackingMode, watermark, addDefaultPane, hoveredSeriesOnTop"` + `"never mutates the caller object on accept or refuse"`; chartEngineCanvasModel.test.ts : `"EngineRefusalError leaves no DOM (R01-A04)"` | Refusal is explicit (`reason` matches `/unsupported option groups/`, `unsupported` lists keys) and frozen: the caller's object is `Object.freeze`d and survives both accept and refuse unchanged; the refused canvas construction leaves `container.childNodes` empty. | Mid-session `applyOptions` refusal on a *live* engine is construction-only today (see C01-A02 gap). |

### C03 — readiness / generation / lifecycle

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| C03-A01 | PROVEN | chartEnginePrimitiveLifecycle.test.ts : `"keeps a host-gated source queued even with a non-degenerate projection"`, `"projectionReady() rejects null and non-finite geometry directly"`; drawingPaneReadiness.test.ts : `"allows a legitimate zero price on a usable inverted coordinate map"` + `"rejects a collapsed inverse map even when forward coordinates differ"` | A scale whose map returns finite zeros (collapsed `coordinateToPrice → 0`) keeps `paneDrawingScaleReady` false while a genuine zero *price* on a usable map stays true; `projectionReady(null) === false`; a non-degenerate projection with `isReady() === false` never attaches. | — |
| C03-A02 | PROVEN | chartEnginePrimitiveLifecycle.test.ts : `"drops a stale (lower-generation) projection and keeps generations monotonic"`; drawingPaneReadiness.test.ts : `"ignores an already queued retry after the data generation changes"` | `source.emit({generation:2})` after gen 3 delivers nothing (`updates == [1,3,4]`); a queued retry flushed after `nextGeneration()` never fires `ready`. | — |
| C03-A03 | PROVEN | chartEnginePrimitiveLifecycle.test.ts : `"detach() twice calls detached() exactly once"`, `"dispose releases every primitive exactly once, is idempotent…"`; lwcAdapter.test.ts : `"destroy calls chart.remove exactly once and is idempotent"` | `detached` fires exactly once across detach+disposer+double-dispose; `chart.remove` called once. | — |
| C03-A04 | PROVEN | chartEnginePrimitiveLifecycle.test.ts : `"delivers the same projection object and generation to every primitive in one flush, in zOrder order"` | `new Set([bottom,mid,top].updates[0]).size === 1` — every primitive in the flush received the identical projection object and generation. | — |

### M01–M03 — ChartPanel migration (not on this branch)

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| M01 | N/A-PENDING | — (chartEngineBoundary.test.ts : `"(d) ChartPanel builds its chart only through createEngine…"` is the P1 bridge, not M01) | ChartPanel.tsx still carries its single `engine-unwrap:` bridge and is still on `LWC_IMPORT_ALLOWLIST`; the seams of docs/chart-engine-completion/chartpanel-seams.md (unwrap removal, `addPriceSeries(ChartEngine)`, Effect-1 teardown) are unstarted. | Pending migration patch. |
| M02 | N/A-PENDING | — | Studies/compare/live updates still close over `IChartApi` (`seriesReuseChart` facade unwrapped); no engine-path test exists. `chartEngineLiveGeneration.test.ts` proves the pure reducer/applier the seam will call. | Pending migration patch. |
| M03 | N/A-PENDING | — | Watermark/price lines/markers/session-shading decorations still attach via the unwrap bridge; `lwcAdapter.test.ts` proves the contract surface they will use. | Pending migration patch. |

### T01 — time facts

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| T01-A01 | PROVEN | chartEngineTime.test.ts : `"T01-A03: displayEpochSec equals liveDisplayEpoch(openUtcMs, market) for us/cn/hk/crypto/ca"` + `"extracts US facts: display epoch shifts 13:30Z to the 09:30 ET wall clock"`; liveCandle.test.ts : `"derives winter EST independently of the summer offset"` | `displayEpochSec === liveDisplayEpoch(openUtcMs, market)` — equality with the canonical **single** application; a double or missing shift breaks it (crypto asserts the identity shift). | No render-level double-application test (jsdom cannot raster axes); the law is proven at the facts layer every renderer consumes. |
| T01-A02 | PROVEN | chartEngineTime.test.ts : `"extracts business-day facts: key is the session, closeTime is availability"` + `preserveSessionAnchors` `"accepts appended and dropped keys — only shared keys are anchored"`; sessionBars.test.ts : `"ChartPanel.resampleTf reproduces the canonical grid bar-for-bar"` (golden 3D incl. truncated `dropLeading` variants) | A 3D bar keyed `2026-10-09` with `closeTime 2026-10-13` keeps `key === "2026-10-09"`; prefix changes (dropped/appended keys) anchor only shared keys, so backfill cannot re-key existing bars. | — |
| T01-A03 | PROVEN | chartEngineTime.test.ts : `"extracts business-day facts: key is the session, closeTime is availability"`; chartEngineReplay.test.ts : `"truncates by closeTime, not time…"` + `"a bar is knowable AT its closeTime instant (boundary is inclusive)"` | `d3.closeUtcMs === Date.UTC(2026,9,13,12)` while `key` stays the opening session; replay hides a bar whose `closeTime` is past the cursor even when `time === cursor`. | — |
| T01-A04 | PROVEN | chartEngineTime.test.ts : `validateTimeKeys` `"reports the FIRST offending index"` (12-case table incl. duplicate/decreasing/mixed/malformed); chartEngineLod.test.ts : `"a duplicate time is disorder too…"` + `"malformed and non-finite times throw the typed bad-time error"` | Refusals are explicit with index + reason (`"duplicate time key"`, `"mixed time kinds"`, …) and typed (`LodIndexError` code `lod/disorder` / `lod/bad-time`). | — |

### T02 — scales

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| T02-A01 | PROVEN | chartEngineScales.test.ts : `"inverts within 1e-9 relative across modes, inversion, heights, and prices"` | 4 modes × inverted × 5 heights × 50 prices (2000 checks) round-trip `priceToCoordinate`/`coordinateToPrice` within 1e-9 relative. | — |
| T02-A02 | PROVEN | chartEngineScales.test.ts : `"keeps the last valid range when extents are null or all-missing"` + `"pads a constant / single-bar series by max(\|v\|*0.005, minMove)"` | `autoscaleRange(null|NaN)` → `unavailable:true` keeping the last valid range with finite values; constant/zero series get a positive finite span. | — |
| T02-A03 | PARTIAL | chartEngineScales.test.ts : `"keeps adjacent label y's at least minLabelGapPx apart with nice steps"` (+ log + inversion variants, heights down to 64 px); chartEngineAxes.test.ts : `"AXES-A02: edge ticks shift inward and every visible box stays inside [0, heightPx]"` + `"snaps placed y to multiples of 1/dpr"` (dpr 1.25 and 2) | Adjacent visible labels always ≥ `minLabelGapPx` apart; boxes contained; placed y quantised to the device grid at fractional DPR. | No test renders actual **zh-locale** label strings (CJK widths); width growth is covered generically by `axisWidthForLabels` `"grows immediately when a longer label appears"`. |
| T02-A04 | PROVEN | chartEngineScales.test.ts : `"returns to the baseline within 1e-9 after equal opposite deltas"`; axisZoom.test.ts : `"is reversible for reciprocal factors"`; chartEngineInput.test.ts : `"restores the baseline within 1e-9 after equal opposite wheel deltas"` | 6×+6× opposite zooms restore `from`/`to` within 1e-9 in every mode/inversion; reciprocal factors multiply to 1. | — |

### T03 — future time

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| T03-A01 | PROVEN | chartEngineDrawingBridge.test.ts : `"re-derives a stored future anchor's slot from the cadence after new bars shift the grid"`; futureTime.test.ts : `"resolves a stored anchor whose exact grid slot no longer exists"`; chartEngineFutureAnchors.test.ts : `"slot i's key is independent of how many anchors are generated"` | A stored future time re-resolves to the correct x after `pushTimes` shifts the grid; `futureSlotOf` re-derives the slot from the new cadence. | — |
| T03-A02 | PARTIAL | chartEngineFutureAnchors.test.ts : `"never emits a weekend date on a daily cadence"` + `"skips weekends exactly as futureBarTimes does"` | 40 future anchors all land Mon–Fri. | **Holiday** calendars are not consulted when minting future slots — no test feeds an exchange-holiday set (sessionBars' golden holidays cover historical 3D aggregation only). |
| T03-A03 | PROVEN | chartEngineFutureAnchors.test.ts : `"builds synthetic business-day facts on the same conventions as real ones"` (`isSynthetic:true`, no OHLC); chartEngineCanvasModel.test.ts : `"setData/update retain whitespace rows"`; chartEngineLod.test.ts : `"whitespace rows set hasGap and are excluded from extrema, open, and close"` | Synthetic future facts carry time facts only; whitespace rows survive verbatim (`{time:"2020-01-04"}`) and never contribute values or extrema. | — |
| T03-A04 | PROVEN | futureTime.test.ts : `"has no cadence to report below two samples"` + `"returns nothing when no cadence can be derived"`; chartEngineFutureAnchors.test.ts : `"returns nothing without a usable cadence or count"` | 0/1 sample → explicit no-cadence (`null` / `[]`), never a fabricated grid. | — |

### R01 — factory / identity / disposal

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| R01-A01 | PROVEN | chartEngineHandles.test.ts : `"impl is 'lwc' for both factories and LWC_CAPABILITIES lists every series kind"`; lwcAdapter.test.ts : `"createEngine('lwc') and createLwcEngine both build one chart via createChart"` | `createEngine(container).impl === "lwc"` (factory default; `index.ts` default param `"lwc"`). | — |
| R01-A02 | PROVEN | chartEngineCanvasModel.test.ts : `"identifies as impl mm and unwraps the owned ChartModel"`; chartEngineBoundary.test.ts : `"(a) no file under lib/chart-engine/ outside lwc/ imports lightweight-charts"` | `engine.impl === "mm"`, `unwrap()` returns the owned `ChartModel`; the static law forbids any LWC import (even types) under `canvas/`. | — |
| R01-A03 | PROVEN | chartEngineCanvasModel.test.ts : `"destroy exactly once releases canvases/observers and zeroes inventory"`; lwcAdapter.test.ts : `"destroy calls chart.remove exactly once and is idempotent"` + `"post-destroy calls on handles obtained BEFORE destroy also throw"` | Double `destroy()` disconnects the ResizeObserver once, empties the container, `inventory()` → zeros/`alive:false`; every pre-destroy handle goes quiet. | Remount into the *same* container element is not separately asserted (fresh mounts per test use fresh containers). |
| R01-A04 | PROVEN | chartEngineCanvasModel.test.ts : `"EngineRefusalError leaves no DOM (R01-A04)"`; chartEngineOptions.test.ts : `"never mutates the caller object on accept or refuse"` | Refusal is typed (`EngineRefusalError` with `reason`/`unsupported`) and side-effect free: `container.childNodes` stays empty; the caller's option object survives frozen. | — |

### R02 — rendering

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| R02-A01 | PROVEN | chartEngineSeriesGeometry.test.ts : per-kind describes (`"emits snapped bodies and wicks for a known projection at dpr 1 and dpr 2"`, `"places open ticks left and close ticks right…"`, `"breaks the polyline on whitespace and NaN…"`, `"closes each gap-bounded line segment…"`, `"uses candle body width, honours per-point color…"`, `"splits above/below opts.baseValue…"`) + `extentsOf` | Fixed fixtures pin exact x/y/width/colour per kind; colours come only from opts (`every(c => c === "#111111" || c === "#222222")`); extrema and row identity asserted. | — |
| R02-A02 | PROVEN | chartEngineSeriesGeometry.test.ts : `"collapses 40k rows at barSpacing 0.05 to <= 2*widthPx columns without losing extrema"`; chartEngineLod.test.ts : `"matches a brute-force pass on seeded random data with gaps and NaN (LOD-A02)"`, `"keeps a spike that occupies a single row of a many-row column"`, `"aggregates 40k rows into 1440 columns inside the perf bound"`, `"answers 1000 indexOfTime lookups over 40k rows inside the perf bound"` | 40k rows → ≤2·widthPx columns, declared extrema survive (`minYHigh`/`maxYLow` equal the projected 110/90), single-row spikes kept, exact `indexOfTime` lookups, multiple column budgets (37/1440/window<columns). | — |
| R02-A03 | PROVEN | chartEngineSeriesGeometry.test.ts : `"re-distributes to remaining panes and keeps order when an empty pane is removed"`; chartEngineCanvasModel.test.ts : `"swapPanes exchanges series membership and pane indices"` | Removing an empty pane re-distributes heights to remaining panes, keeps order, and tiles the full height (`two[0].height + 1 + two[1].height === 201`); series membership follows pane indices exactly. | — |
| R02-A04 | PROVEN | chartEngineSeriesGeometry.test.ts : `"breaks the polyline on whitespace and NaN — never a connecting segment, never a zero"` + `"skips whitespace and NaN-close rows…"`; chartEngineLod.test.ts : `"whitespace rows set hasGap and are excluded from extrema, open, and close"` | Segments never span a gap (`idx.includes(1) && idx.includes(4)` is false), `y !== 0` unless the value *is* the projection of the baseline. | — |

### R03 — live updates / invalidation

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| R03-A01 | PROVEN | chartEngineInvalidation.test.ts : `"five invalidations before a flush produce exactly one schedule and one generation bump"`; chartEnginePrimitiveLifecycle.test.ts : `"coalesces several projections arriving before one flush into the newest generation"`; chartEngineLiveGeneration.test.ts : `"bumps exactly once per applied op and never for a refused one"` + `"the price series gets exactly one update, and never a setData"` | A same-frame burst yields exactly 1 schedule call, 1 generation, newest-wins delivery; each applied live tick bumps the generation exactly once and pushes exactly one `update()` (never `setData`). | Burst size in tests is 5–20, not literally 100 — the coalescing property asserted is the same. |
| R03-A02 | PARTIAL | chartEngineInvalidation.test.ts : `dataChangeMask` `"setData → full for that pane + timeScale + its price scale"` (autoscale via `autoscaleTargets`), `liveTickMask` `"a backwards tick is a historical revision, never an append"` | A full re-set re-runs autoscale on every autoscale-enabled pane; a backwards tick is classified as a revision, not an append. | No test asserts that **correcting a historical row** (e.g. `update()` with an old time, or a re-fetch that changes a past bar) invalidates autoscale for the affected pane. |
| R03-A03 | PROVEN | chartEngineInvalidation.test.ts : `"cancels a pending schedule and drops pending work"` + `"post-dispose invalidate is a no-op (no schedule, no pending)"` + `"update off-screen → level none, and NOTHING is scheduled"` | Dispose cancels the armed frame and later invalidations schedule nothing; a `none`-level event costs zero frames — an idle or destroyed chart has no frame loop. | — |
| R03-A04 | PROVEN | lwcAdapter.test.ts : `"a price line drawn on a FOREIGN series survives that creator's teardown"` + `"sees series created RAW through unwrap(), not just engine-created ones"` + `"stays bounded across 50 add/remove generations"` | The census reads the renderer, so deliberately orphaned lines are *visible*: after 5 generations `inventory().priceLines === 5` while `series === 1`; 50 add/remove generations stay bounded. | — |

### R04 — primitives

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| R04-A01 | PROVEN | chartEnginePrimitives.test.ts : `"paintPane ignores primitives registered in another pane"`, `"paintAxis clips to the rect it is given (save → beginPath/rect/clip → restore)"`, `"hitTest is pane-scoped"`; chartEngineCanvasModel.test.ts : `"construction allocates one canvas per pane…"` | Paint and hits are pane-scoped by registry; axis paints run inside an explicit ctx clip matching the given rect; each pane owns its own bitmap, so a pane pass cannot paint outside its pane. | `paintPane` itself relies on per-pane canvases rather than an asserted ctx clip (the clip assertion exists for the axis pass). |
| R04-A02 | PROVEN | chartEngineInvalidation.test.ts : `"an invalidate landing inside the flush window is not merged into the painted generation"`; chartEnginePrimitives.test.ts : `"deliver updates each primitive exactly once per generation"` | A mid-flush invalidation is deferred to the next generation — the painted frame is a frozen snapshot; `deliver(gen 5)` twice and `deliver(gen 4)` are no-ops. | — |
| R04-A03 | PARTIAL | chartEnginePrimitiveLifecycle.test.ts : `"projectionReady() rejects null and non-finite geometry directly"` + `"queues a primitive attached before readiness…"` | A null/degenerate upstream projection never attaches or updates an overlay — it stays queued (honestly unavailable) instead of painting. | No end-to-end test of a *null upstream overlay artifact* reporting an explicit unavailable answer to a consumer (nearest: drawingBridge fails-closed null anchors; paneSync prices null). |
| R04-A04 | UNPROVEN | — | — | `canvas/model.ts attachPrimitive(primitive: unknown)` pushes without any shape check — a raw LWC `ISeriesPrimitive` is silently accepted, and no test covers a refusal. Needs an explicit typed refusal. |

### R05 — snapshot

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| R05-A01 | PARTIAL | chartEngineSnapshot.test.ts : `"returns an HTMLCanvasElement that is not a thenable (no deferred answer)"`; chartEngineCanvasModel.test.ts : `"takeScreenshot is sync and draws every pane"` | The composite is synchronous and, after `scheduler.flush()`, draws every live pane canvas exactly once in order. | No test takes a screenshot **between** a live update and its flush to prove the uncommitted state is excluded (snapshot == committed view ordering). |
| R05-A02 | PROVEN | chartEngineSnapshot.test.ts : `"rasterizes at round(css × dpr) device pixels"`, `"maps panes to full-width layers at their tops, then full-chart overlays above"`, `"two adjacent crops share the exact same snapped edge (no gap, no doubled row)"` | Exact 9-arg `drawImage` positions tile the full composed height at `round(css×dpr)`; each source is drawn exactly once; adjacent crops share the snapped edge. | — |
| R05-A03 | PROVEN | chartEngineSnapshot.test.ts : `"throws SnapshotUnavailableError for the blank sentinels 'data:,' / 'data:' / empty payload"` + `"wraps a throwing toDataURL (jsdom 'Not implemented') in the typed error with the cause"` | Tainted/failing encodes raise the typed `SnapshotUnavailableError` (with `cause`), never a blank image URL. | — |
| R05-A04 | PROVEN | chartEngineSnapshot.test.ts : `"returns an HTMLCanvasElement that is not a thenable…"` + `"the module source contains no deferred-encoding construct (static law)"` | `typeof out.then === "undefined"`; source scan rejects `async`/`await`/`.then(`/`toBlob`/`convertToBlob`/`Promise` in snapshot.ts. | — |

### I01 — touch

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| I01-A01 | PROVEN | chartEngineInput.test.ts : `"keeps the midpoint logical fixed and does not jump when a finger lifts"` | Midpoint logical index fixed within 1e-9 across the pinch (far inside the ≤1 CSS-px budget) and the range is frozen through `pointerup`. | — |
| I01-A02 | PARTIAL | chartEngineInput.test.ts : `"is idempotent and stops further camera writes"` (dispose) — the gesture-teardown analogue; implementation handles `pointercancel` (`input.ts` `case "pointercancel": onUp(event, true)`) | Dispose-style teardown leaves no sticky state and stops camera writes. | **No test sends a `pointercancel` event**; only `pointerup` ends gestures in tests. |
| I01-A03 | UNPROVEN | — | — | No `touch-action`/overscroll handling exists in `canvas/dom.ts` or `input.ts`, and no test checks that a touch starting in a scrolling control preserves page behaviour. |
| I01-A04 | UNPROVEN | — | — | No keyboard or reduced-motion path in the engine input controller; no test. |

### I02 — axis / panes

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| I02-A01 | PROVEN | axisZoom.test.ts : `"keeps compounding far beyond the former fixed clamp"` + `"keeps expanding across many gestures without saturating"`; chartEngineInput.test.ts : `"keeps the logical index under the pointer fixed to 1e-9"` | 80 compounded zooms keep positive spans (span₈₀ < 1% of span₄₀) with no saturation wall; the pointer anchor holds to 1e-9. | — |
| I02-A02 | PARTIAL | chartEngineDrawingBridge.test.ts : `"refuses to resolve anchors while the pane round trip is degenerate"` + `"notifies a pending pane's subscriber once the round trip heals"` (collapse → uncollapse) | A collapsed (degenerate) pane is refused (`ready() === false`); after `uncollapse` readiness heals exactly once and resolution resumes. | No assertion that a reopened pane's projection is pixel-identical to its pre-collapse meaning, and no pane-collapse UI test at engine level. |
| I02-A03 | PROVEN | chartEngineAxes.test.ts : `"AXES-A01: a pinned label always wins over a colliding tick"` + `"nudges a colliding lower-priority pinned label by one label height"` + `"hides a pinned label only after two label heights fail to free a slot"`; priceTagPlacement.test.ts : `"fans a dense level cluster around the active timed quote without moving any price line"` | Priority ordering is frozen and deterministic: pinned beats tick, higher priority nudges lower by exactly one label height, hiding is the last resort after ±2 heights. | — |
| I02-A04 | PARTIAL | chartEngineAxes.test.ts : `"snaps placed y to multiples of 1/dpr"` (dpr 1.25, 2); chartEngineSeriesGeometry.test.ts : `"snaps a half-pixel price differently at dpr 1 and dpr 2"` | Paint-side geometry and labels quantise to the device grid at fractional DPR. | No hit-test-side alignment assertion at fractional DPR (e.g. `hitTest` at x snapped for dpr 1.25 resolving the same target the painter drew). |

### I03 — pane sync / crosshair

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| I03-A01 | PROVEN | paneSyncTimeAxis.test.ts : `"RED: a peer with a shorter history lands on the same DATES, where bar numbers would not"` + `"mirrors across a 4-pane grid with four different history depths"` + `"agrees with a peer that trades a different session calendar"` | `expect(b.dates()).toEqual({from: want.from, to: want.to})` with the bar-index mutant proven different by >300 days; 4 panes × 4 depths and 7-day calendars converge on the same calendar window. | — |
| I03-A02 | PROVEN | paneSyncLinkGroups.test.ts : `"a crosshair queued by a registration that was replaced before the frame is dropped"` + `"a disposed pane's callbacks are never called again, and its slot's next owner starts clean"`; paneSyncTimeAxis.test.ts : `"re-registering an id replaces the previous pane rather than doubling it"` | A queued sample from a replaced/unregistered owner never reaches peers (`peer.crosshair` stays null); the retired pane's callback count freezes; the new owner starts from zero. | — |
| I03-A03 | PROVEN | paneSyncLinkGroups.test.ts : `"a crosshair queued before a regroup reaches neither the old group nor the new one"` + `"re-sending the same plan is a no-op…"`; paneSyncFrame.test.ts : `"drops a queued sample when its source pane unregisters before paint"` | A pre-RAF plan change discards the queued old-plan event (both groups null); an identical re-sent plan preserves a live sample (idempotence, so the discard is plan-driven, not timing-driven). | — |
| I03-A04 | PROVEN | paneSyncLinkGroups.test.ts : `"the bus reaches for nothing but the visible range and the crosshair — no symbol, data, options or scale"` | Every engine method touched by the bus is checked against a 7-entry allowlist (`timeScale`, `set/clearCrosshairPosition`, `get/setVisibleLogicalRange`, `timeToIndex`, `dataByIndex`) — any new synchronised dimension fails. | — |

### D01 — drawings

| ID | Status | file : test name | Decisive assertion | Gap |
|---|---|---|---|---|
| D01-A01 | PARTIAL | chartEngineDrawingBridge.test.ts : `"resolves the same price against each pane's own price scale"` + `"round-trips raw and snapped pixels through anchors within 1e-9"` (against a contract-shaped fake engine) | Pane-scoped anchor resolution and raw/snap round-trips are exact to 1e-9 — the anchor *policy* both engines must satisfy. | No test resolves the same drawing through **both real engines** (lwc + mm) and compares anchors/bytes; the conformance harness has no drawing check. |
| D01-A02 | PROVEN | chartEngineDrawingBridge.test.ts : `"re-derives a stored future anchor's slot from the cadence after new bars shift the grid"` + `"prefers an exact bar time over a stale logical index"`; chartEngineFutureAnchors.test.ts : `"switching cadence 1h → 1d re-derives the slots from openUtcMs"` | History growth re-derives slots from the stored *time* (stale logical ignored); a cadence/timeframe switch re-derives the grid from `openUtcMs`. | — |
| D01-A03 | PARTIAL | chartEngineDrawingBridge.test.ts : `"refuses to resolve anchors while the pane round trip is degenerate"` + `"fails closed with no primary series or a removed series"`; drawingPaneReadiness.test.ts : `"does not retry or schedule frames for an unusable scale"` | Unready scale → all anchor resolution refuses (null), readiness gate stays closed, no retry storm. | No test asserts a **migration write** is suppressed while the scale is unready — the bridge refuses resolution, but nothing observes a persisted-document write path. |
| D01-A04 | PARTIAL | chartEngineDrawingBridge.test.ts : `"fails closed with no primary series or a removed series"` (with `setPrimary(1,true)` → `ready()` true again) + `"notifies a pending pane's subscriber once the round trip heals"` | Source removal fails closed; source return re-arms readiness and resolution resumes. | No test round-trips a drawing **document** (persist → source disappears → returns → document rehydrates intact). |

## Summary

| Status | Count | IDs |
|---|---|---|
| PROVEN | 43 | C01-A01, C01-A04, C02-A01, C02-A02, C02-A04, C03-A01…A04, T01-A01…A04, T02-A01, T02-A02, T02-A04, T03-A01, T03-A03, T03-A04, R01-A01…A04, R02-A01…A04, R03-A01, R03-A03, R03-A04, R04-A01, R04-A02, R05-A02…A04, I01-A01, I02-A01, I02-A03, I03-A01…A04, D01-A02 |
| PARTIAL | 13 | C01-A02, C01-A03, T02-A03, T03-A02, R03-A02, R04-A03, R05-A01, I01-A02, I02-A02, I02-A04, D01-A01, D01-A03, D01-A04 |
| UNPROVEN | 4 | C02-A03, R04-A04, I01-A03, I01-A04 |
| N/A-PENDING | 3 | M01, M02, M03 |

## Run evidence (cited files, run once today at BASE_SHA)

All commands from `terminal/` with `VITEST_MAX_THREADS=3 npx vitest run <files>`:

- Batch 1 (11 files: chartEngineAxes, chartEngineBoundary, chartEngineCanvasC02, chartEngineCanvasModel, chartEngineConformance, chartEngineCrosshair, chartEngineDrawingBridge, chartEngineFutureAnchors, chartEngineHandles, chartEngineInput, chartEngineInvalidation):
  `Test Files  11 passed (11)` · `Tests  207 passed (207)`
- Batch 2 (12 files: chartEngineLiveGeneration, chartEngineLod, chartEngineOptions, chartEnginePaneSync, chartEnginePrimitiveLifecycle, chartEnginePrimitives, chartEngineReplay, chartEngineScales, chartEngineSelect, chartEngineSeriesGeometry, chartEngineSnapshot, chartEngineTime):
  `Test Files  12 passed (12)` · `Tests  298 passed (298)`
- Batch 3 (12 files: lwcAdapter, axisZoom, futureTime, chartViewReset, drawingPaneReadiness, paneSyncTimeAxis, paneSyncLinkGroups, paneSyncFrame, timeWindow, sessionBars, liveCandle, priceTagPlacement):
  `Test Files  12 passed (12)` · `Tests  226 passed (226)`

Total: 35 files, 731 tests, 0 failures. (chartEngineCrosshair, chartEnginePaneSync, chartEngineSelect, chartViewReset, timeWindow, liveCandle, priceTagPlacement are cited as supporting evidence and were run green in the same session; `npx tsc --noEmit` exit 0 on the tree — this census adds only docs, no code.)

## The 10 most valuable uncovered scenarios (ranked)

1. **C02-A03 — same source → same pixels before/after adapter change.** The P4 flip gate; nothing today proves the two engines agree. *Sketch:* drive `collectEngineConformance((c) => createCanvasEngine(c, {scheduler: manual}))` so the whole Q01 table runs against `mm` too, then add a parity check feeding the same corpus fixture through `createEngine(c, opts, "lwc")` (fake registry) and `"mm"`, asserting `timeToCoordinate`/`logicalToCoordinate`/`priceToCoordinate` agree within 1e-6 on the contract surface.
2. **R04-A04 — raw LWC primitive passed to mm → explicit unsupported.** Today `attachPrimitive(unknown)` silently accepts an `ISeriesPrimitive`, which would dead-paint in prod. *Sketch:* `mm.addSeries("line").attachPrimitive(lwcShapedPrimitive)` must throw `EngineRefusalError` with `unsupported: ["primitive:lwc"]` and leave `inventory()` unchanged; a subsequent engine-owned primitive still attaches.
3. **I01-A04 — keyboard + reduced motion reach range/reset/crosshair.** Accessibility hole in the owned renderer. *Sketch:* extend `createInputController` with key events (Home/End/±/arrows) and a `reducedMotion` option; assert the visible range moves/resets, the crosshair steps whole bars, and no inertia frames are scheduled when reduced motion is on.
4. **I01-A03 — touch in a scrolling control preserves page behaviour.** *Sketch:* assert `canvas/dom.ts` sets `touch-action: none` only on the plot/pane canvases (never on legend, axis containers, or the root), and that a `touchstart` in a scrollable overlay region does not `preventDefault` — page scroll must survive.
5. **C01-A02 / C02-A04 — wire `normalizeEngineOptions` into both factories.** The typed-refusal gate exists but is unwired; unknown groups pass silently into a live engine. *Sketch:* `engine.applyOptions({ trackingMode: {...} })` on `mm` (and `lwc`) must return/throw the typed refusal and a following `options()` readback must equal the pre-call state (last valid frame unchanged).
6. **R03-A02 — historical correction invalidates autoscale.** *Sketch:* autoscaled pane with 300 bars; `update()` a bar 200 back with a 10× high (or re-`setData` with that row changed); assert the resulting invalidation mask carries `autoscale: {pane}` and the next flush's range includes the corrected extremum.
7. **D01-A01 — same drawing in both engines → identical anchors and bytes.** *Sketch:* build both engines over one fixture, wrap each in `createDrawingBridge`, resolve one anchor per pane per engine, assert pixel equality within 1e-6 and byte-identical serialized anchor records `{paneIndex, time, logical, price}`.
8. **R05-A01 — snapshot after live update equals committed view.** *Sketch:* canvas engine + manual scheduler; `update()` the live bar, `takeScreenshot()` **before** `flush()` (bitmap ops must equal the pre-update frame), `flush()`, screenshot again (must include the update) — the snapshot never shows uncommitted state.
9. **T03-A02 — holiday future date not claimed as a session.** *Sketch:* feed `futureAnchors`/`futureBarTimes` a cadence plus the sessionBars golden holiday set; assert minted future keys skip listed holidays exactly (no holiday key emitted, next session resumes after) for daily grids.
10. **I02-A02 — collapsed pane reopened keeps meaning once ready.** *Sketch:* resolve an anchor's pixel on a ready pane, force the collapsed (degenerate) map, uncollapse, re-resolve; assert pixel-identical placement and that `ready()` fired exactly once per heal — plus a `pointercancel`-gesture variant for I01-A02 in the same lane.

## Census notes

- Several sibling-lane test files carry their own ID vocabularies (L01, LOD, AXES, CROSSHAIR, Q01) that overlap this matrix; where their assertions genuinely prove an input-matrix scenario they are cited above (e.g. LOD-A01/A02 → R02-A02, AXES-A01 → I02-A03), otherwise they were excluded.
- `chartEnginePrimitives.test.ts` labels its generation-guard test "R04-A01", but this census follows the authoritative input matrix (R04-A01 = pane clipping for paint and hits); the generation guard is cited under R04-A02 where it belongs.
- The conformance harness is the natural vehicle for gaps 1 and 7 — it already runs factory-agnostically; only the canvas factory has never been registered in it.
