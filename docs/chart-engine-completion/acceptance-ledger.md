# Chart engine — acceptance ledger

Source of the rows: masterplan `04_ACCEPTANCE_MATRIX.md` (2026-10-11); one row per acceptance id, scenario abridged.
`Status` is `ACCEPTED` (evidence cited), `UNRESOLVED` (exact gate named) or `EXCLUDED` (scope ruling cited). Evidence classes: source-read, unit, mocked-adapter, real-browser, physical-device, production. A plan row is never evidence (CLOSE-A04).
Test files are under `terminal/lib/__tests__/` unless a path is given; `e2e/` is `terminal/e2e/`. Seat-local receipts are named, not committed.

**102 ACCEPTED · 31 UNRESOLVED · 3 EXCLUDED** (136 rows).

## Release state

| Layer | State |
|---|---|
| Source-built | `master` = PR 999 (9938c0cb0) + PR 993 (24fd0ce6f) + PR 997 (3e6e9591d) + PR 1027 (3c115e5d1) |
| Installed | production = `origin/master` @ 3e6e9591d21b via the git-gated build (VERIFY OK) |
| Selected | default `lwc`; `mm` opt-in via `?engine=mm` or `localStorage mm.engine`; `?engineProbe=refuse` exercises the refusal fallback |
| Production-proven | P01-A01..A04 live proofs at 3e6e9591d21b |
| Held / excluded | P03 default flip HELD (Q03 zoom); P04 retirement gated on P03; rulings D3 (no Offscreen/WebGL) and D9 (LWC kept for excluded consumers) |

## Pending effects

| Effect | Owner | Gate |
|---|---|---|
| P03 default flip — branch `claude/ce-p03-1013` @ 9576169f9 | seat | protocol-v3 decision, then a passing Q03 zoom receipt |
| P02 admitted-account production journey | seat | the Q03 zoom fix |
| P04 retirement | seat | P03 live; transitive LWC coupling removed (P04-A01) |
| Q03 bench readiness retry (`claude/ce-bench-ready2-1017`, harness-only) | seat | done: PR 1028 merged as master fb72315fa (harness-only; shipped inside ce10, no deploy of its own) |
| Lane ce-q02-1013 (rc=124) | seat | kept under its id; no replay (Q02-A03) |
| Licence attribution (`attributionLogo: false`, no NOTICE link) | operator (licence owner) | licence check (P04-A02) |
| Agent OS close records (Macro) | seat | Macro branch `claude/agentos-ce-close-1013` (PR opened after this ledger) |

## Scoped independence vs residuals

- **Scoped independence (primary chart):** `ChartPanel.tsx` builds its chart only through `createEngine` (boundary ratchet d), with 0 direct `lightweight-charts` imports and 0 `.unwrap(` calls; `lib/chart-engine/**` outside `lwc/` imports no LWC (ratchet a); `// engine-unwrap:` tags stay within `ENGINE_UNWRAP_BUDGET = 7` (ratchet c); `paneSync.ts` speaks engine types (PR 999). The owned Canvas2D renderer (`mm`) passes the shared conformance suite with no skips.
- **Residuals:** (1) the default impl is still `lwc`, so LWC renders the primary chart unless `mm` is selected; (2) `ChartPanel.tsx` reaches LWC transitively via `lib/chartTimeAxis.ts` and `lib/sessionShading.ts`; (3) the allowlisted excluded consumers keep their imports (D9) — `app/embed/chart/EmbedChart.tsx`, `components/TideChartLazy.tsx`, `components/surface/SessionFlowPane.tsx`, `components/surface/StrikeEvolutionModal.tsx`, `components/surface/SurfacePane.tsx`, `lib/chartTimeAxis.ts`, `lib/heatSeries.ts`, `lib/sessionShading.ts`, `lib/surfaceContract.ts`; (4) the package (`^5.2.0`) and its LICENSE stay; `attributionLogo: false` at 7 sites with no NOTICE link awaits the licence owner.

## Named gaps

| Gap | Rows | Next |
|---|---|---|
| Q03 zoom latency (VALID FAIL, PR 1027) | Q03-A01, Q03-A04, P02-A01, P02-A02, P02-A03, P02-A04, P03-A01, P03-A02, P03-A03, P03-A04 | protocol-v3 decision before any receipt; then a passing zoom receipt unblocks P02 and the P03 flip |
| Q03 memory / retained-resource receipts | Q03-A02, Q03-A03 | committed receipts with raw counters vs the LWC baseline |
| F10/X1 future-tail `resolveX` under mm; F12/X2 jsdom `xOfLogical` ≈6–7 px | M04-A04 | both-impl caller parity |
| Canvas pointer hit-testing with the plot clip | R04-A01 | wire PrimitiveHost hit-testing into the canvas input bridge |
| Same-frame stale-projection discard | R04-A02 | canvas paint path, after the P04 flip |
| Replay point-in-time label + missing-knowledge-time refusal | L02-A04 | replay state capability (pin RED-able) |
| Real-device / real-browser input receipts | I01-A01, I01-A02, I01-A03, I01-A04, I02-A01, I02-A04 | touch, cancel, reduced-motion, axis-wheel, DPR receipts |
| Drawings create/drag/undo/redo + cancel on engine=mm | D02-A01, D02-A02 | extend chart-engine-drawings.spec.ts |
| Pixel / visual-difference receipts | C02-A03, Q01-A04, R05-A02, T02-A03 | same-pixels LWC receipt; per-class diff; DPR-2 snapshot; small-pane labels |
| Per-mutant receipts | Q02-A03 | one receipt per plan mutant |
| Transitive LWC coupling of the primary chart | P04-A01 | route chartTimeAxis / sessionShading through the engine |
| Programme closure | CLOSE-A01 | the rows above |

## G00

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| G00-A01 | Existing P0/P1 and #635 changes | ACCEPTED | source-read | P0/P1 = 2caf6c36c + 24d54afab (merge b1ba90a1e, PR 157); PR 635 = e2f2ba205. Over 48df88ae8..0a03b1604, api.ts, lib/chart-engine/index.ts and e2e/chart-ownership-stress.spec.ts are byte-identical, lwcAdapter.test.ts only gains cases, and the growth of lwc/index.ts and ChartPanel.tsx is the planned PR 982 and M01–M03 work. Reproduce: `git show --stat 2caf6c36c 24d54afab e2f2ba205`; `git diff --stat 48df88ae8 0a03b1604`. |
| G00-A02 | An open sibling touches ChartPanel | ACCEPTED | source-read | One ChartPanel writer (the seat). The PR 995/996 and PR 998 seams entered the migration branch by natural merges 76e914153 and 04a45fbe4 — only 17 evidence crops conflicted — and landed as squash 9938c0cb0 (PR 999). Disjoint work continued in parallel in PR 993/997/1027. |
| G00-A03 | Manifest says ^5.2.0 | ACCEPTED | source-read | Lockfile: terminal/package.json `"lightweight-charts": "^5.2.0"`; terminal/package-lock.json (lockfileVersion 3) resolves 5.2.0 with integrity. CI runtime: .github/workflows/ci.yml uses `actions/setup-node@v4` and `npm ci` (lockfile-exact) in every required job; exact-head run 38396941216 (head c01af9c23) succeeded on the locked 5.2.0. Reference Mac: installed 5.2.0. Pinned by chartEngineGapCensus.test.ts (PR 993); mutant 5.2.0→5.1.0 RED. |
| G00-A04 | A previously interrupted mutation is found | ACCEPTED | source-read | Lane ce-mig-rev-1013 lost controller transport (POLL_TRANSPORT_FAILED rc=255) and was reconciled under the SAME id to DONE rc=0 — no replay. ce-mig-fixrev-1013 was a new assignment under a new id, refused by the economic guard and never started. Seat-local lane log. |

## G01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| G01-A01 | Named native Opus agent | ACCEPTED | source-read | Native P1/P2/P3/GAPS children ran as model claude-opus-5-5, spawned with model=opus + `ROUTE: ORCHESTRATION` + `WHY OPUS:`; no native worker spawns; lane labour ran on the m2 pool fabric. Seat-local transcripts. |
| G01-A02 | Fabric submission | ACCEPTED | source-read | Lane ce-smoke-1013: LEASE_OK → LAUNCH_ATTEMPT → REMOTE_DONE rc=0 → OUTPUT_CONTRACT_MATCHED → DONE rc=0 — the launch and the terminal result are separate events of the existing launcher. Seat-local lane log. |
| G01-A03 | Returned API finding | ACCEPTED | source-read | Lane ce-fold3-1013's erratum withdrew a false GAPS finding after a source check; review ce-mig-rev-1013 REPAIR_REQUIRED → repairs 71664ede4, 4c96a8dad → MIG_READY, returned to the seat as a compact outcome. Seat-local receipts. |
| G01-A04 | Capacity or permission refusal | ACCEPTED | source-read | Lane ce-accept2-rev-1013 ended DONE rc=75 remote_admission_refused and is kept under its own id; its successor ce-accept2-rev2-1013 is a new id on another host (same packet). ECONOMIC_POLICY_REFUSED ids are kept, never replayed. Seat-local lane log. |

## C01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| C01-A01 | Current consumer calls setCrosshairPosition/getVisibleRange | ACCEPTED | source-read | terminal/lib/chart-engine/api.ts declares getVisibleRange and setCrosshairPosition; semantics in chartEngineCanvasC02.test.ts 'engine.options() is a copy; setCrosshairPosition paints without firing crosshair handlers; clear erases'. |
| C01-A02 | Unknown native option | ACCEPTED | unit | chartEngineOptions.test.ts 'normalizeEngineOptions — refuse native-only / unknown groups (C02-A04)', 'refuses overlayPriceScales, trackingMode, watermark, addDefaultPane, hoveredSeriesOnTop'. |
| C01-A03 | Unused vendor API | ACCEPTED | source-read + unit | Census lane ce-c01-census-1013 (qwen3.8-max, READ_ONLY) at e0ae63af8 classified 21/21 zero-consumer members: KEEP-PARITY 18 / KEEP-MIGRATION-TARGET 3 / REMOVE 0 — none removed (each has an LWC analogue, a conformance assertion or a raw-bridge consumer); mutants M1–M3 RED→GREEN. Its test gaps F-1..F-3 landed in PR 997 (lwcAdapter.test.ts, chartEngineCanvasModel.test.ts, chartEngineCensusWiring.test.ts; mutants M1b/M4/M5). |
| C01-A04 | Non-chart Options consumer | EXCLUDED | source-read | Masterplan ruling D9: retain the package and notices for excluded standalone consumers; primary-chart independence is not whole-repo removal. The import is held by chartEngineBoundary.test.ts '(b) no NEW importer of lightweight-charts appears outside lib/chart-engine (allowlist ratchet)'. |

## C02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| C02-A01 | Supported data/scale query | ACCEPTED | unit | chartEngineHandles.test.ts 'data() snapshots rows and never returns the native series', 'series.priceScale forwards … without leaking the native scale'. |
| C02-A02 | Removed series used after engine destruction | ACCEPTED | unit | chartEngineHandles.test.ts 'chart-engine C02 — disposed semantics (C02-A02)'; chartEngineCanvasModel.test.ts post-destroy handles are deterministic no-ops. |
| C02-A03 | Valid LWC caller before/after adapter change | UNRESOLVED | real-browser | GAP: a same-pixels before/after receipt for the LWC path across the adapter change. The PR 999 evidence-crop recapture re-baselines the crops; it does not prove pixel identity. |
| C02-A04 | Native unsupported option is supplied | ACCEPTED | unit | PR 993: chartEngineGapPrimitives.test.ts; mutant RED |

## C03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| C03-A01 | Finite zero coordinates from an unready scale | ACCEPTED | unit | chartEnginePrimitiveLifecycle.test.ts 'C03-A01 readiness: attached() fires only on a ready projection'. |
| C03-A02 | Old primitive callback after symbol/pane replacement | ACCEPTED | unit | chartEnginePrimitiveLifecycle.test.ts 'C03-A02 generation guard: at most one update per generation, stale dropped'. |
| C03-A03 | Destroy or series remove twice | ACCEPTED | unit | chartEnginePrimitiveLifecycle.test.ts 'C03-A03 idempotent detach: detached() exactly once, never throws'. |
| C03-A04 | Shared overlay is clipped/resized | ACCEPTED | unit | PR 993: chartEngineGapPrimitives.test.ts (paint.generation === update.generation); mutant RED |

## CLOSE

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| CLOSE-A01 | All required scope accepted | UNRESOLVED | source-read | GAP: 31 rows remain UNRESOLVED (this one included), each with its gate in "Named gaps"; closure needs each ACCEPTED or EXCLUDED. |
| CLOSE-A02 | Pending child/effect | ACCEPTED | source-read | Section "Pending effects" of this ledger names every open effect, its owner and its gate. |
| CLOSE-A03 | Required physical/browser/source proof unavailable | ACCEPTED | source-read | Every UNRESOLVED row names its exact gate (GAP / CAPABILITY-MISSING / HELD); no row claims a pass it lacks. |
| CLOSE-A04 | Successful plan versus successful build | ACCEPTED | source-read | No plan row is cited as evidence; the masterplan is cited only for rulings D3/D5/D9/D10. |

## D01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| D01-A01 | Same drawing loaded in both engines | ACCEPTED | unit, mocked-adapter | PR 993: chartEngineGapDrawing.test.ts (anchors; bytes mm, lwc); mutant RED |
| D01-A02 | Timeframe or history-depth changes | ACCEPTED | unit, mocked-adapter | PR 993: chartEngineGapDrawing.test.ts + chartEngineGapDrawingAnchor.test.ts (pins setData([]) and source swap; RAW-travel negatives for a raw anchor and a future slot); `resolveX` returns null for a time-anchored `future == null` anchor (drawingBridge.ts fix 708acfa2); mutant RED. |
| D01-A03 | Scale unready after pane collapse | ACCEPTED | unit | chartEngineDrawingBridge.test.ts 'drawing bridge: readiness gate (D01-A03)', 'refuses to resolve anchors while the pane round trip is degenerate', 'fails closed with no primary series or a removed series'. |
| D01-A04 | Source disappears then returns | ACCEPTED | unit, mocked-adapter | PR 993: chartEngineGapDrawing.test.ts; mutant RED |

## D02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| D02-A01 | Create/drag/undo/redo and engine rollback | UNRESOLVED | real-browser | Partial: chart-engine-drawings.spec.ts 'A01: stored document renders on default and engine=mm routes' (both impls; PR 999 CI e2e green). GAP: create/drag/undo/redo and engine rollback on engine=mm — undo/redo is covered only on the default engine (drawing-system.spec.ts). |
| D02-A02 | Freehand or multi-point drawing cancellation | UNRESOLVED | real-browser | GAP: freehand / multi-point pointercancel on engine=mm; drawing-system.spec.ts covers pointercancel on the default engine only. |
| D02-A03 | Hit-test at narrow viewport/DPR2 | ACCEPTED | real-browser | chart-engine-drawings.spec.ts 'A03: DOM handle grab at DPR 2' (default + engine=mm) and 'A03: seeded drawing projects on 390×844 mobile viewport'; PR 999 CI e2e shards green. |
| D02-A04 | Chart without data | ACCEPTED | real-browser | chart-engine-drawings.spec.ts 'A04: NOSUCH.TEST empty pane does not overwrite stored drawings' (both impls); PR 999 CI e2e shards green. |

## I01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| I01-A01 | Pinch with two stable contacts | UNRESOLVED | physical-device | GAP: two-contact pinch trace on a touch device, anchor within the frozen CSS-pixel budget. |
| I01-A02 | Pointercancel/lost capture mid-drag | UNRESOLVED | real-browser | GAP: pointercancel/lostpointercapture mid-drag e2e asserting no sticky pan/drawing and no later mutation. |
| I01-A03 | Touch starts in scrolling control | UNRESOLVED | real-browser | GAP: touch-starts-in-scrolling-control e2e with an accessible-zoom check. |
| I01-A04 | Keyboard and reduced motion | UNRESOLVED | real-browser | Partial unit: chartEngineKeyboard.test.ts 'zoom, pan, roving, Escape and reset never announce'. GAP: prefers-reduced-motion e2e proving range/reset/crosshair are reachable without animation. |

## I02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| I02-A01 | Axis wheel repeated/reversed | UNRESOLVED | real-browser | Plot-wheel zoom anchor drift is resolved: the earlier 24d2fb45a drift failure is superseded by the 8395ceea9 headed 3-run (mm drift 6.8e-10 px; seat-local receipt) and unit chartEngineScales.test.ts 'keeps the price under the pointer fixed while zooming'. GAP: an axis-wheel repeated/reversed real-browser receipt showing no cumulative wall. |
| I02-A02 | Collapsed pane reopened | ACCEPTED | unit | PR 993: chartEngineGapPanes.test.ts; mutant RED |
| I02-A03 | Overlapping price tags | ACCEPTED | unit | chartEngineAxes.test.ts 'AXES-A01: a pinned label always wins over a colliding tick', and AXES-A02 edge containment. |
| I02-A04 | Fractional DPR/browser zoom change | UNRESOLVED | real-browser | GAP: fractional-DPR / browser-zoom-change e2e measuring hit vs paint alignment against the frozen tolerance. |

## I03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| I03-A01 | Peers with different history lengths | ACCEPTED | unit | chartEnginePaneSync.test.ts 'outbound range: the bus carries a CALENDAR window, never bar indexes', 'a peer window with a different cadence lands on the right logical range here'. |
| I03-A02 | Register/unregister/reuse pane slot | ACCEPTED | unit | PR 993: chartEngineGapPanes.test.ts (control); mutant RED |
| I03-A03 | Group plan changes before RAF fires | ACCEPTED | unit | PR 993: chartEngineGapPanes.test.ts; mutant RED |
| I03-A04 | Security or timeframe selection | ACCEPTED | source-read | PR 999's terminal/lib/paneSync.ts change is type-only (LWC IChartApi/ISeriesApi/Time → engine ChartEngine/SeriesHandle/EngineTime); `PaneLink` stays `{ group; crosshair; window }` — no new synchronized dimension. Reproduce: `git diff 9938c0cb0^ 9938c0cb0 -- terminal/lib/paneSync.ts`. Scope: masterplan ruling D5. |

## L01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| L01-A01 | Live quote same symbol/current epoch | ACCEPTED | unit | chartEngineLiveGeneration.test.ts 'reduceLiveTick — generation counting (L01-A01)', one accepted tick -> one generation's writes. |
| L01-A02 | Old-symbol HTTP/script response arrives late | ACCEPTED | source-read | PR 993: chartEngineGapLiveReplay.test.ts (census, zero unguarded; measured floor `>= 14`; falsifier); mutant RED |
| L01-A03 | In-place update | ACCEPTED | unit, mocked-adapter | PR 993: chartEngineGapLiveReplay.test.ts; mutant RED |
| L01-A04 | Data-fed Options overlay | ACCEPTED | unit | PR 993: chartEngineGapLiveReplay.test.ts; mutant RED |

## L02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| L02-A01 | Scrub before future bars/signals | ACCEPTED | unit | PR 993: chartEngineGapLiveReplay.test.ts; mutant RED |
| L02-A02 | Replay→live after intervening updates | ACCEPTED | unit | PR 993: chartEngineGapLiveReplay.test.ts (through production applyLiveOp); mutant RED |
| L02-A03 | 2D/3D partial bar | ACCEPTED | unit | chartEngineReplay.test.ts 'hides the opened-but-unclosed bar by default', 'showPartial projects the developing bar as its OPEN only — no invented path'. |
| L02-A04 | Missing captured knowledge-time metadata | UNRESOLVED | unit (unavailable half) | PR 993: CAPABILITY-MISSING (seat ruling B: named UNRESOLVED, not built in this programme). Pinned half: chartEngineGapLiveReplay.test.ts (capability pin); mutant RED. GAP: the label + refusal code. |

## L03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| L03-A01 | Hline-only script rebuild 50 times | ACCEPTED | unit | PR 999: chartEnginePineRendering.test.ts 'overlay hline-only: price-line count stable across 50 build/clear cycles'; mutant RED; review lane ce-l03-rev-1013 ACCEPT_WITH_PATCHES at 852943d38 (seat-local). |
| L03-A02 | Slow old script returns after a newer source | ACCEPTED | unit | PR 999: chartEnginePineRendering.test.ts 'stale slow-path epoch does not repaint after a newer bump', 'A02: a superseded slow batch never clears, repaints or re-measures'; mutant pin; review lane ce-l03-rev-1013 (seat-local). |
| L03-A03 | No-data symbol/engine destroy | ACCEPTED | unit | PR 999: chartEnginePineRendering.test.ts 'clear after engine destroy is a no-op and leaves maps empty'; review lane ce-l03-rev-1013 (seat-local). |
| L03-A04 | Unsupported Pine construct | ACCEPTED | unit | PR 999: chartEnginePineRendering.test.ts 'pins unsupported, no-output, and legend warn suffix'; review lane ce-l03-rev-1013 (seat-local). |

## M01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| M01-A01 | Mount/StrictMode cleanup/remount | ACCEPTED | unit | chartEnginePrimaryMigration.test.ts 'M01-A01 StrictMode-style create / destroy / create'. |
| M01-A02 | Empty/no-data symbol | ACCEPTED | unit | chartEnginePrimaryMigration.test.ts 'M01-A02 setData([]) withdraws stale primary-series state'. |
| M01-A03 | Supported price-series family change | ACCEPTED | unit | chartEnginePrimaryMigration.test.ts 'M01-A03 replace primary series family without orphans'. |
| M01-A04 | Sibling ChartPanel changes | ACCEPTED | source-read | Both seams survived integration: PR 995/996 merged naturally at 76e914153 and PR 998 at 04a45fbe4 (ChartPanel.tsx auto-merged; only 17 evidence crops conflicted), squashed as 9938c0cb0 (PR 999) and deployed. Exact path diff: `git diff 9938c0cb0^ 9938c0cb0 -- terminal/components/ChartPanel.tsx`. |

## M02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| M02-A01 | Live quote updates many studies | ACCEPTED | unit | chartEngineStudyMigration.test.ts 'M02-A01 — 100 quote updates through handle.update', 'advance data() without changing pane count or series options'. |
| M02-A02 | Compare add/remove repeatedly | ACCEPTED | unit | chartEngineStudyMigration.test.ts 'M02-A02 — add/remove compare ×20 returns inventory() to baseline'. |
| M02-A03 | Missing indicator value | ACCEPTED | unit | chartEngineStudyMigration.test.ts 'M02-A03 — whitespace rows stay whitespace'. |
| M02-A04 | Parameters change | ACCEPTED | unit | chartEngineStudyMigration.test.ts 'M02-A04 — applyOptions on parameter change touches only the designated handle'. |

## M03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| M03-A01 | Repeated watermark/marker replacement | ACCEPTED | unit | chartEngineDecorationMigration.test.ts 'M03-A01 — setMarkers replaces; no plugin stacking', 'M03-A01 — setWatermark replaces; one live instance per pane'. |
| M03-A02 | Hline-only Pine/guide anchored on price series | ACCEPTED | unit | chartEngineDecorationMigration.test.ts 'M03-A02 — a price line on the price series is cleared by its creator through the host handle'. |
| M03-A03 | Crosshair event series map | ACCEPTED | unit | chartEngineDecorationMigration.test.ts 'M03-A03 — crosshair payload is addressed by the owned handles the caller registered'. |
| M03-A04 | Hidden decoration and screenshot | ACCEPTED | unit | PR 993: chartEngineGapTimeSnapshot.test.ts; mutant RED |

## M04

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| M04-A01 | Injected alias/type import/raw plugin usage | ACCEPTED | unit | chartEngineBoundaryClosure.test.ts 'detects aliased lightweight-charts imports (A01 mutant)', 'detects type-only lightweight-charts imports (A01 mutant)', 'detects dynamic lightweight-charts import (A01 mutant)', 'ChartPanel injects no vendor plugin directly (A01)', 'ChartPanel live source has no lightweight-charts import'. |
| M04-A02 | Native rich event | ACCEPTED | unit | chartEngineHandles.test.ts (no native series / price-scale escapes); chartEngineDecorationMigration.test.ts crosshair payload keyed by owned handles; chartEngineMousePayload.test.ts. |
| M04-A03 | Excluded Options standalone chart remains | ACCEPTED | unit, real-browser | Masterplan ruling D9 + chartEngineBoundary.test.ts ratchet (b) keep the excluded Options importers; regression-tested by e2e/options-surface-alignment.spec.ts, e2e/options-surface-geometry.spec.ts, surfaceReplayMounted.test.tsx and surfaceContract.test.ts. |
| M04-A04 | All main-chart callers | UNRESOLVED | mocked-adapter | Partial: ChartPanel.tsx has 0 `.unwrap(` calls; chartEngineBoundary.test.ts '(d) ChartPanel builds its chart only through createEngine from @/lib/chart-engine'; the only non-test unwrap is inside lwc/index.ts. GAP: two named behaviour differences carried from PR 999 — F10/X1 (future-tail `resolveX` under mm) and F12/X2 (jsdom `xOfLogical` ≈6–7 px). |

## P01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| P01-A01 | Native option enabled for admitted test account | ACCEPTED | production | Production live proof at 3e6e9591d21b (and at ce8, 9938c0cb0): `?engine=mm` → data-chart-engine and `__mmChartEngineImpl` both `mm`, zero chart-engine warnings; data-dpl-id equals the deployed SHA. The route is the anonymous opt-in; the admitted-account journey is P02. |
| P01-A02 | Default/unknown selection | ACCEPTED | production | Re-proven at every deploy through 3e6e9591d21b: default URL and `?engine=bogus` → `lwc`, `mm.engine` storage untouched, zero chart-engine warnings. |
| P01-A03 | Load/init failure | ACCEPTED | production | `?engineProbe=refuse` live case at 3e6e9591d21b: a refused mm init falls back to `lwc` with the same bars and the refusal wording, and writes no mm marker. |
| P01-A04 | Deployment | ACCEPTED | production | Every programme deploy went through the git-gated `/opt/terminal/terminal-build.sh --target-sha` route with deployment-id = .gitsrc HEAD = served data-dpl-id: PR 982 3b0cd9e16, PR 987 6de9c6e8f, PR 990 745d46d57, PR 992 0e011e81c, PR 999 9938c0cb0 (ce8), PR 1027 3c115e5d1 (ce9), PR 993 24fd0ce6f (ce10), PR 997 3e6e9591d (ce11). No working-tree sync. |

## P02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| P02-A01 | Primary actual route journey | UNRESOLVED | production | HELD behind the Q03 zoom fix (PR 1027 VALID FAIL). GAP: live route-journey receipt on app.mastermind-x.com recording component values and the selected implementation. |
| P02-A02 | Engine rollback after edits | UNRESOLVED | production | HELD behind the Q03 zoom fix (PR 1027 VALID FAIL). GAP: live engine-rollback-after-edits receipt showing the same saved documents and zero duplicate resources. |
| P02-A03 | Live/replay/refresh | UNRESOLVED | production | HELD behind the Q03 zoom fix (PR 1027 VALID FAIL). GAP: live live/replay/refresh receipt showing no future values, no old-symbol late updates and no false live label. |
| P02-A04 | Failure and recovery | UNRESOLVED | production | HELD behind the Q03 zoom fix (PR 1027 VALID FAIL). GAP: live failure-and-recovery receipt showing a truthful actionable state and a safe return to the last valid data. |

## P03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| P03-A01 | Default for specified admitted scope | UNRESOLVED | production | Branch claude/ce-p03-1013 @ 9576169f9, not merged; HELD by the Q03 zoom VALID FAIL (PR 1027) until a protocol-v3 receipt passes. GAP: live receipt that the admitted scope runs mm with its capabilities. |
| P03-A02 | Regression in cohort | UNRESOLVED | production | Branch claude/ce-p03-1013 @ 9576169f9, not merged; HELD by the Q03 zoom VALID FAIL (PR 1027) until a protocol-v3 receipt passes. GAP: live rollback receipt returning the same chart state without a schema change. |
| P03-A03 | Unqualified/excluded standalone route | UNRESOLVED | production | Branch claude/ce-p03-1013 @ 9576169f9, not merged; HELD by the Q03 zoom VALID FAIL (PR 1027) until a protocol-v3 receipt passes. Excluded routes keep LWC under masterplan ruling D9. GAP: live receipt that excluded routes are unchanged. |
| P03-A04 | Monitoring | UNRESOLVED | production | Branch claude/ce-p03-1013 @ 9576169f9, not merged; HELD by the Q03 zoom VALID FAIL (PR 1027) until a protocol-v3 receipt passes. GAP: monitoring receipt capturing renderer identity and failures without chart data. |

## P04

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| P04-A01 | Migrated closure after retirement | UNRESOLVED | source-read | Retirement not reached (P03 HELD). ChartPanel.tsx has 0 direct lightweight-charts imports and 0 `.unwrap(` calls, but reaches LWC transitively through lib/chartTimeAxis.ts (value import `TickMarkType`) and lib/sessionShading.ts (LWC `ISeriesPrimitive` types). GAP: route both through the engine before retirement. |
| P04-A02 | Options/other standalone LWC use remains | ACCEPTED | source-read | terminal/package.json keeps `"lightweight-charts": "^5.2.0"` and its LICENSE ships in node_modules; no excluded source was rewritten (chartEngineBoundary.test.ts ratchet (b) allowlist unchanged). Residual for the licence owner: `attributionLogo: false` is set at 7 sites (5 direct LWC mounts, plus ChartPanel.tsx and RSPivotChart.tsx through the default lwc adapter) with no tradingview.com link or NOTICE in the app. |
| P04-A03 | No remaining LWC dependency in audited future scope | EXCLUDED | source-read | Precondition false: under masterplan ruling D9 the excluded consumers keep LWC, so no audited scope is dependency-free and no package/notice removal is qualified. |
| P04-A04 | Final state report | ACCEPTED | source-read | Section "Scoped independence vs residuals" of this ledger. |

## Q01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| Q01-A01 | Each planned suite | ACCEPTED | unit | PR 993 chartEngineGapCensus.test.ts 'Q01-A01: Each planned suite' pins membership of every planned suite (coverage suites + chartEngineGap*) in the collected manifest fixtures/chart-engine/gap-census/collected-files.json, not only in the include globs; the 4 previously absent planned names are carried by chartEnginePineRendering.test.ts (PR 999), chartEngineGapDrawingAnchor.test.ts, chartEngineGapLiveReplay.test.ts and chartEngineGapPrimitives.test.ts. |
| Q01-A02 | Both engines on same fixture | ACCEPTED | unit | chartEngineConformance.test.ts runs the same fixture through `runEngineConformance` for LWC and for 'canvas engine mm' with `CANVAS_CONFORMANCE_SKIPS = []`; each run records its impl. |
| Q01-A03 | Independent transform oracle | ACCEPTED | unit (mutation oracle) | PR 993: chartEngineGapCensus.test.ts independent transform oracle; offset/sign/scale mutants RED. |
| Q01-A04 | Visual difference | UNRESOLVED | real-browser | GAP: per-class visual-difference report with semantic checks and no blanket mask. |

## Q02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| Q02-A01 | Original parity matrix | ACCEPTED | source-read | All 136 matrix rows are present with a status; every UNRESOLVED row names its gate (the generator refuses to emit otherwise) and none is counted as a pass. |
| Q02-A02 | 52 transitions plus owner churn | ACCEPTED | unit, mocked-adapter | PR 993: chartEngineGapLifecycle.test.ts (timers, primitives, listeners); mutant RED |
| Q02-A03 | Regression mutants | UNRESOLVED | unit | Recorded: the L03 mutants (PR 999) and the PR 993/997 mutants cited per row. Lane ce-q02-1013 ended rc=124 and is kept under its id. GAP: a receipt for each regression mutant the plan specifies. |
| Q02-A04 | Full integrated candidate | ACCEPTED | source-read | Exact-head required CI green on each merged head — PR 993 24fd0ce6f, PR 997 3e6e9591d, PR 1027 3c115e5d1 — with nonempty collection (Q01-A01) and independent reviews: grok integration review (PR 993), qwen3.8-max (PR 997, PR 1027). |

## Q03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| Q03-A01 | 60fps target on 60Hz device | UNRESOLVED | real-browser | PR 998 (Q03b v1, e206cd046): pan lifted (mm p95 9.138 / p99 9.639 ms); zoom FAIL p95 20.562 / p99 37.175 ms. PR 1027 (Q03b v2, 1b7ec6a6b): VALID FAIL — mm zoom p95 21.655 / p99 42.429 ms against p95 ≤ 20 / p99 ≤ 33.4; the lwc comparator also fails (25.583 / 47.199). GAP: a protocol-v3 decision recorded before any receipt, then a passing zoom receipt. |
| Q03-A02 | 40k workspace equal warmup | UNRESOLVED | real-browser | A seat bench at 8395ceea9 measured heap mm 4.17 MB vs lwc 368.6 MB, but that receipt is seat-local and budget_ok false. GAP: a committed memory receipt against the LWC baseline with raw counters. |
| Q03-A03 | Long switching/close/reopen sequence | UNRESOLVED | real-browser | GAP: a long switch/close/reopen retained-resource receipt. |
| Q03-A04 | Performance failure | UNRESOLVED | real-browser | Process half held: the v2 protocol decision (Macro PR 9175) was recorded before its receipt and no budget was lowered after a result (masterplan ruling D10). GAP: cause not isolated — the renderer-idle-wakeup hypothesis was refuted by its own falsifier — so a protocol-v3 decision precedes any retest. |

## Q04

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| Q04-A01 | Keyboard/200% browser zoom/narrow width | ACCEPTED | real-browser | chart-engine-accessibility.spec.ts K1 (keyboard reach + visible named focus), K2/K3 (keyboard rollback) and Z (a browser.newContext deviceScaleFactor-2 context at 1440×900 — never CSS zoom) on /terminal?engine=mm across the desktop 1440×900, tablet 820×1180 and mobile 390×844 projects; PR 999 CI e2e shards green; the impl is recorded per test, never asserted. The reflow half of 200% zoom is the ≤860 px layout covered by the tablet and mobile projects. |
| Q04-A02 | EN/ZH and supported themes | ACCEPTED | real-browser | chart-engine-accessibility.spec.ts C: EN/ZH × the two shipped colour schemes (west/east; the Terminal is dark-only) keep every chart control unclipped with symbol/timeframe unchanged, on /terminal?engine=mm across the desktop 1440×900, tablet 820×1180 and mobile 390×844 projects; PR 999 CI e2e shards green; the impl is recorded per test, never asserted. |
| Q04-A03 | Real source gap/access revocation | ACCEPTED | real-browser | chart-engine-accessibility.spec.ts H1/H1b (fixture 404 → honest unavailable state; 5xx → failure copy, no ready edge) and H2 (revoked entitlement → gated row says so, bars stay real), on /terminal?engine=mm across the desktop 1440×900, tablet 820×1180 and mobile 390×844 projects; PR 999 CI e2e shards green; the impl is recorded per test, never asserted. |
| Q04-A04 | Native app web host | ACCEPTED | source-read + unit | appsNoChartMath.test.ts A01–A07 (no chart math/render under apps/); the iOS host apps/ios/…/AppConfig.swift allows `/terminal` and ChartWebView.swift is a WKWebView of the same web chart. No physical-device receipt. |

## R01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| R01-A01 | Factory default | ACCEPTED | unit | chartEngineSelect.test.ts 'resolveEngineImpl precedence' and kill switch; chartEngineIdentityMarker.test.ts default impl `lwc`. Corroborated in production by P01-A02. |
| R01-A02 | mm selected in development qualification | ACCEPTED | unit | chartEngineCanvasModel.test.ts 'identifies as impl mm and unwraps the owned ChartModel'; chartEngineBoundary.test.ts '(a) no file under lib/chart-engine/ outside lwc/ imports lightweight-charts'. |
| R01-A03 | Dispose and remount | ACCEPTED | unit | chartEngineCanvasModel.test.ts 'destroy exactly once releases canvases/observers and zeroes inventory'. |
| R01-A04 | Required unsupported contract feature | ACCEPTED | unit | chartEngineCanvasModel.test.ts 'EngineRefusalError leaves no DOM (R01-A04)'; chartEngineOptions.test.ts 'never mutates the caller object on accept or refuse'; chartEngineIdentityMarker.test.ts 'createEngine(el, { trackingMode: {} }, 'mm') throws and writes no marker'. |

## R02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| R02-A01 | Each series type on fixed fixture | ACCEPTED | unit | chartEngineSeriesGeometry.test.ts candle, bar, line, area, histogram (per-point color), baseline, style opts, extentsOf. |
| R02-A02 | Dense 40k bars at multiple zooms | ACCEPTED | unit | chartEngineSeriesGeometry.test.ts 'collapses 40k rows at barSpacing 0.05 to <= 2*widthPx columns without losing extrema'. |
| R02-A03 | Empty pane removed between peers | ACCEPTED | unit | chartEngineSeriesGeometry.test.ts 're-distributes to remaining panes and keeps order when an empty pane is removed'. |
| R02-A04 | Gap/NaN/whitespace row | ACCEPTED | unit | chartEngineSeriesGeometry.test.ts 'breaks the polyline on whitespace and NaN — never a connecting segment, never a zero'. |

## R03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| R03-A01 | 100 accepted same-frame updates | ACCEPTED | unit | chartEngineInvalidation.test.ts 'R03-A01 — one schedule call, one flush, one generation per burst'. |
| R03-A02 | Historical correction changes visible extrema | ACCEPTED | unit | PR 993: chartEngineGapLifecycle.test.ts; mutant RED |
| R03-A03 | Idle or destroyed chart | ACCEPTED | unit | PR 993: chartEngineGapLifecycle.test.ts (timer); mutant RED |
| R03-A04 | Deliberately orphan one series/line | ACCEPTED | unit, mocked-adapter | PR 993: chartEngineGapLifecycle.test.ts (mm; lwc); mutant RED |

## R04

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| R04-A01 | Primitive crosses plot boundary | UNRESOLVED | unit (paint-clip half) | PR 993: CAPABILITY-MISSING (seat ruling B: named UNRESOLVED, not built in this programme). Pinned half: chartEngineGapPrimitives.test.ts (hit leg documented); mutant RED. GAP: wire canvas pointer hit-testing with the same clip, then the hit leg of the test. |
| R04-A02 | Generation changes during draw | UNRESOLVED | unit (requeue half) | PR 993: CAPABILITY-MISSING (seat ruling B: named UNRESOLVED, not built in this programme). Pinned half: chartEngineGapPrimitives.test.ts (lifecycle drop; mounted requeue); mutant RED. GAP: same-frame stale-projection discard (route to the canvas owner after the P04 flip). |
| R04-A03 | Null/partial upstream intelligence overlay | ACCEPTED | unit | PR 993: chartEngineGapPrimitives.test.ts; mutant RED |
| R04-A04 | Raw LWC primitive passed to mm | ACCEPTED | unit | PR 993: chartEngineGapPrimitives.test.ts; mutant RED |

## R05

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| R05-A01 | Snapshot after live update | ACCEPTED | unit | chartEngineSnapshot.test.ts 'composeSnapshot — R05-A01 synchronous composite'. |
| R05-A02 | Multi-pane/high-DPR screenshot | UNRESOLVED | real-browser | Label mismatch: chartEngineSnapshot.test.ts 'R05-A02' tests dataUrl failure. GAP: multi-pane DPR2 screenshot receipt checking extents, no blank strips and no duplicate labels. |
| R05-A03 | Tainted/unavailable image resource | ACCEPTED | unit | PR 993: chartEngineGapTimeSnapshot.test.ts; mutant RED |
| R05-A04 | Future offscreen proposal | EXCLUDED | source-read | Masterplan ruling D3: main-thread Canvas2D; Offscreen/WebGL only as a separately reviewed change after a measured bottleneck. No offscreen proposal is in scope; the synchronous contract is pinned by chartEngineSnapshot.test.ts 'composeSnapshot — R05-A01 synchronous composite'. |

## T01

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| T01-A01 | Same numeric seconds used as legacy display epoch | ACCEPTED | unit | chartEngineTime.test.ts 'extracts US facts: display epoch shifts 13:30Z to the 09:30 ET wall clock', displayEpochSec equals liveDisplayEpoch (that test is labelled T01-A03). |
| T01-A02 | Backfilled prefix on a 3D series | ACCEPTED | unit | chartEngineTime.test.ts 'accepts appended and dropped keys — only shared keys are anchored', 'flags a re-anchored session id (T01-A02)'. |
| T01-A03 | Bar opening identity before close availability | ACCEPTED | unit | chartEngineReplay.test.ts 'truncates by closeTime, not time: a bar whose closeTime is past the cursor is hidden', 'showPartial projects the developing bar as its OPEN only'. The Time test labelled T01-A03 does not cover this row. |
| T01-A04 | Invalid/duplicate time keys | ACCEPTED | unit | chartEngineTime.test.ts validateTimeKeys 'reports the FIRST offending index' over fixtures incl. 'duplicate time key' and 'time key decreases'. The test labelled T01-A04 (frozen facts) does not cover this row. |

## T02

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| T02-A01 | Normal/log/percent/index plus inversion | ACCEPTED | unit | chartEngineScales.test.ts 'T02-A01 … inverts within 1e-9 relative across modes, inversion, heights, and prices'. |
| T02-A02 | Empty/constant/single-bar/all-missing inputs | ACCEPTED | unit | chartEngineScales.test.ts 'T02-A02 autoscale degenerate extents'. |
| T02-A03 | Small pane, EN/ZH, fractional DPR | UNRESOLVED | real-browser | Partial unit: chartEngineScales.test.ts 'T02-A03 priceTicks spacing', chartEngineAxes.test.ts (1/dpr snap). GAP: small-pane EN/ZH labels at fractional DPR in a browser receipt. |
| T02-A04 | Repeated opposite wheel deltas | ACCEPTED | unit | chartEngineScales.test.ts 'T02-A04 opposite-wheel restore … returns to the baseline within 1e-9'. |

## T03

| Id | Scenario | Status | Class | Evidence |
|---|---|---|---|---|
| T03-A01 | Future anchor across newly arriving bars | ACCEPTED | unit | chartEngineFutureAnchors.test.ts 'T03-A01 — slot stability'; chartEngineDrawingBridge.test.ts 're-derives a stored future anchor's slot from the cadence after new bars shift the grid'. |
| T03-A02 | Holiday/non-trading future date | ACCEPTED | unit | PR 993: chartEngineGapTimeSnapshot.test.ts; mutant RED |
| T03-A03 | Future whitespace with no observed value | ACCEPTED | unit | PR 993: chartEngineGapTimeSnapshot.test.ts; mutant RED |
| T03-A04 | Zero/one input time | ACCEPTED | unit | PR 993: chartEngineGapTimeSnapshot.test.ts; mutant RED |

