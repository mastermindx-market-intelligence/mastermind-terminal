# Native Chart Engine — assessed Fable P2–P4 completion masterplan

Prepared October 11, 2026. **Planning handoff only: not dispatched, not implemented or production-accepted by this assessment.**

## 1. Mission and original programme

Complete the existing [Chart Engine programme](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/docs/CHART_ENGINE_MASTERPLAN.md): finish the portable main-chart boundary, implement an original Canvas2D backend, prove current user workflows and roll out the native renderer through actual selection and rollback acceptance. This supplements the original masterplan; it does not silently replace it or create a new Terminal programme.

The Chairman asked for the next hardest existing project outside the already-selected Options programme and single-name intelligence, Grey Deer Risk, Market OS, Options Intelligence, Prophet and Market Ontology. Earlier Mastermind OS, Executive OS, Fabric-development and GMI exclusions remain. This is an informed engineering selection from a bounded census, not an exhaustive numerical ranking of every company programme.

The full accompanying conversation package contains `00_START_HERE_FABLE.md`, the expanded `01_MASTERPLAN.md`, a 28-capability census, 34 detailed work packages, 136 planned acceptance assertions, 32 source references, a passive dependency graph, operator packets and a risk/decision register. Its document validator passes reference/graph/assertion/scope checks and rejects eight deliberate malformed cases. **Those are package-integrity checks, not product tests.** This repository document is a standalone execution entrypoint; the expanded annexes are conversation artifacts, not claimed to be installed repository code.

## 2. Required Fable execution model

On deliberate delivery to an actual eligible session, use:

**Fable principal → native Opus suborchestrators → existing Subagent Fabric task operators → optional bounded Fabric workers.**

Fable owns principal trade-offs, scope, integration, economic decisions and final acceptance. Native Opus agents own specialist domain judgment and adjudicate consolidated operator returns. Fabric operators own bounded investigate/build/test/repair outcomes. They may execute directly or delegate independent leaves when framing plus review costs less than direct execution. Workers return through the originating operator and Opus, preserving the original root/grant and actual capacity/budget.

Do not substitute an all-Opus coding swarm, Fable doing routine bulk implementation, native leaf proliferation, or a new router/queue/daemon. Seven domains are responsibilities, not seven compulsory concurrent launches. Start contract, time/scale and baseline verification first; activate further domains as inputs become ready. Keep one designated integration writer for shared ChartPanel and related seams.

[Official native-subagent documentation](https://code.claude.com/docs/en/sub-agents) is not proof of actual Fable-seat model/tool/MCP availability. G01 below proves a meaningful native Opus→Fabric operator→same Opus result-consumption path using a real read-only contract-gap task. Inspect actual model/tool evidence and current approved admission, not a prose label. Delivery, QUEUED, START, result and consumption are different states. A denied or unknown-effect action is never retried through another carrier.

Count native framing/review, operator/worker effort, repairs, queued obligations and reserved independent review against the same approved envelope. Do not multiply quotas by nesting. Missing usage remains unknown. Optimize accepted outcomes per observed total consumption; no fixed token-saving percentage is asserted.

## 3. Scope and definition of done

In scope: the main chart-engine workflow, six current series kinds, time/price scales, panes, crosshair/window sync, markers/lines/watermarks/session shading, current supported study/Pine output rendering, existing drawing interactions, live mutation, replay/live return, chart-table/snapshot behavior, responsive input/accessibility, independent device/performance qualification, canonical release, actual selection and rollback.

Out of scope: rebuilding any excluded intelligence programme, Bot autonomy, Intelligence Workspace, data feeds, market calendars/resampling, indicators, Pine language semantics, drawing persistence, authentication, context buses, alert or telemetry control planes. Existing intelligence overlays may be rendered unchanged; the renderer must not author their signals, change their clocks or grant trading/sizing/forecast authority.

**This is scoped main-chart independence, not a whole-repository LWC purge.** Excluded Options and other standalone consumers may still use LWC. Do not globally uninstall `lightweight-charts` or remove applicable notices while those consumers remain. P4 removes the obsolete main-chart bridge only after its transition and dependency conditions are satisfied. A wider migration is a separate decision, not hidden work here.

Done means: all current supported main-chart tasks run on an original native renderer; migrated callers cannot escape to raw LWC; mathematical/time/document meaning is preserved and independently checked; actual supported-device performance and accessibility pass; authorized real users can complete the source-bound live/replay/study/drawing workflow; installed code, selected setting and actual executing renderer are separately observed; rollback preserves saved work and disposes resources. Required unavailable tests remain unfinished, not passes.

## 4. Source cuts and evidence limits

- Terminal primary cut: `8520e5d77e9f0b83973a988cf4f4adff300994cf`.
- Macro durable-registry cut: `7cb33d3aaac3512bee53d7254a785af38f3bd172`.
- Existing compatible protected procedure: Mastermind `94bae30d53aee81a6430dcec75915b1c73ba86e1`, Skillpack1.0.1/bootstrap1.

The census read twenty pinned source files, the engine directory, and selected PR metadata/history. It did not run application tests, inspect current production hosts, measure devices or dispatch workers. Exact full caller counts, current live source leases, installed lockfile versions and unpublished native work remain G00 inputs. Reconcile relevant material changes before effects; unrelated master movement is not a reason to repeat all archaeology.

| Finding | Direct evidence | Consequence |
|---|---|---|
| Original P0/P1 substrate exists, native implementation missing at inspected primary factory | [Factory](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/chart-engine/index.ts), blob `6d15416bfcfbee18978473c1b226d4430bb5e019`; [directory](https://github.com/mastermindx-market-intelligence/mastermind-terminal/tree/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/chart-engine) has no canvas/ | Build the missing backend; do not recreate factory/adapter or assume an mm query already works |
| Contract still leaks renderer assumptions | [api.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/chart-engine/api.ts), blob `749ad269870a45c47bab87bd1315b107552e866d` | Close used options, methods, events and primitives before claiming portability |
| ChartPanel imports raw constructors/plugins/types | [ChartPanel](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/components/ChartPanel.tsx), blob `4c58122065e1778d4887a37023719dd1d5d527a7` | Migrate owner clusters with one shared writer; old July call counts are not current counts |
| Adapter tests use a stand-in | [lwcAdapter.test.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/__tests__/lwcAdapter.test.ts) | Mock delegation tests cannot prove real pixels/browser/native conformance |
| Test location differs from the old plan | [vitest.config.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/vitest.config.ts) | Put tests in collected lib/__tests__ or deliberately qualify a config change |
| Lifecycle fixes already merged | [PR #635](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/635), merge `e2f2ba2059d21ef4381cb240a135f327dc69d8eb` | Preserve old fixes/harness; historical test counts are not new-engine proof |
| Live, time, drawing and script owners already exist | Source links in section 6 | Migrate render handles, not their domain algorithms/state |
| Bot and IW2 have existing separate work | [Mastermind #1357](https://github.com/mastermindx-market-intelligence/Mastermind/pull/1357), [Terminal #821](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/821) | Do not create a parallel Bot programme or workspace-context coordinator |

The package manifest declares LWC `^5.2.0`; actual resolved version must come from the current lockfile. LWC is an open-source control implementation, not a proprietary layer that must be escaped at any cost. Use public interfaces and original implementation; retain applicable LICENSE/NOTICE/attribution. No proprietary source or product-design copying is authorized.

## 5. Architecture and portable contract

Use existing `terminal/lib/chart-engine/api.ts`, `index.ts` and `lwc/index.ts`; add an original `canvas/` implementation behind them. Complete caller migration against LWC first so the behavior-preserving boundary earns a second implementation. Keep native dark until its claimed features are actually available. A complete native test-only slice may advance before production default changes.

Reject a one-shot ChartPanel rewrite. Reject WebGL/Offscreen-first complexity without a measured bottleneck. Start with main-thread Canvas2D, stable model/handles, independent pure geometry, bounded invalidation and existing worker-based script computation. The current synchronous `takeScreenshot(): HTMLCanvasElement` is a real contract; do not silently replace it with a Promise to suit a preferred architecture.

Proposed files, subject to current ownership checks:

- `terminal/lib/chart-engine/options.ts`, `time.ts`, `primitive.ts`: smallest complete used semantics under the existing boundary.
- `terminal/lib/chart-engine/canvas/{index,model,layout,scales,ticks,series,invalidation,input,primitives}.ts`: original renderer implementation.
- `terminal/lib/__tests__/chartEngine*.test.ts` and `terminal/e2e/chart-engine-*.spec.ts`: discoverable contract, geometry, migration, workflow and performance proof.

C01 enumerates every actually used method/option/default/event/primitive with source path, side effect, ordering and failure. Already observed gaps include portable set/clear crosshair; series data/query/options/price-scale access; price-scale visible-range operations; rich event maps using owned handles; primitive callbacks/readiness. Add the necessary methods with current style, not the entire vendor API. Required unsupported native options produce explicit failure, never silent omission.

Close raw escapes in the migrated dependency closure, not by string grep alone. Check type and runtime imports, plugin constructors, alias wrappers, private adapter access and raw native objects hidden in event payloads. LWC native types remain private to its adapter or explicitly excluded standalone owners. No `any` cast can qualify a portable boundary.

## 6. Preserved invariants

### Time, identity and availability

[sessionBars.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/sessionBars.ts) owns 2D/3D anchor semantics. [intradayShared.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/intradayShared.ts) contains legacy display-epoch/session behavior. Preserve both.

Source UTC/availability, display coordinate, business-day/opening key, grouped-bar completion, geometric future slot and render generation are different facts. Never infer the axis representation from a number or convert time twice. Do not regroup truncated 3D history by floor(loadedIndex/3). Opening identity places the candle; closeTime qualifies completion. A renderer cannot manufacture missing captured historical knowledge-time evidence.

[futureTime.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/chart-engine/futureTime.ts) creates cadence-derived drawing slots, not a full future exchange calendar. Keep exact anchors through new bars; never turn whitespace into prices, studies, coverage or certified future sessions.

### Scales and pixels

Reuse [axisZoom.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/chart-engine/axisZoom.ts): pointer-anchored numeric zoom and the current signed-log convention. Naive log(price) is not compatible with its zero/negative behavior. Percent/indexed scales retain their reference and displayed-domain meaning. Specify logical/time, CSS and bitmap spaces explicitly.

Independent oracle tests cover projection/inverse, constant/empty/single-bar/all-missing inputs, extreme finite values, overflow, inversion, margins and fractional DPR. Refusal preserves a valid view or shows unavailable; it cannot invent observed prices. Visual density reduction never changes exact lookup, chart-table values or analytical data.

### Panes, drawings and context

[paneSync.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/paneSync.ts) and [timeWindow.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/timeWindow.ts) already own time-window/crosshair links. Peers synchronize time, not equal array indices. Preserve same-timeframe rules, group/echo/registration epochs. Security/timeframe context stays with the existing native Chart Bus/IW2; no second bus.

[drawingPaneReadiness.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/drawingPaneReadiness.ts) checks nondegenerate forward/inverse geometry before legacy migration. Finite zero is not ready. Preserve event-driven readiness; no fixed sleeps or new poller. Drawings retain existing schema, semantic time/price/pane anchors and persistence. Collapse, resize, timeframe/history changes, undo/redo and rollback cannot silently reanchor/delete them.

### Live, Pine and replay

[liveBarProjection.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/liveBarProjection.ts) owns one accepted generation for candles, studies, table and sync. Preserve in-place series/styling; do not rebuild panes or static guides on every quote. Late HTTP/script results are fenced at final commit by current source/symbol/timeframe generation.

[pine-engine/host.ts](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/8520e5d77e9f0b83973a988cf4f4adff300994cf/terminal/lib/pine-engine/host.ts) already owns worker cancellation, cache and budgets. Migrate supported output rendering only. Add real synthetic hline-only/all-na script lifecycle cases; preserve unsupported diagnostics and do not claim full Pine-language parity.

Replay boundaries apply to candles, indicators, script output, tooltips, table and annotations, not just the candle array. Reconstructed visual replay is not captured-PIT certification. Returning to live must use the latest accepted generation with no duplicate subscriptions or old-cache overwrite. Rendering an existing overlay cannot change its upstream source freshness or infer a new signal.

## 7. Native rendering and interaction design

Maintain stable pane/scale/series handles and one committed render generation. Separate data/main-plot invalidation from pointer overlay redraw. Historical changes invalidate extents as well as pixels. Idle charts do not need a permanent repaint loop; disposal cancels pending frames/listeners/observers and detaches primitives.

Implement all six existing series kinds, actual pane movement/empty-pane behavior and synchronous composed snapshots. Typed primitives share lifecycle, clipping, z-order and hit-test projection with painting. Raw vendor primitives passed as unknown are explicitly refused on native until bridged.

Pointer input arbitrates plot, axis, drawing and page controls; preserve anchored pinch and axis zoom. Pointercancel/lost capture/blur/disposal ends the gesture. Do not globally disable browser zoom/scroll for an easy canvas implementation. Keyboard/reduced-motion and meaningful table/readout alternatives are required. Actual mobile/device performance is separate from viewport emulation.

Native inventory reads the actual scene/resource model. Compare it to caller ownership and independent browser/DOM/resource observations. Two counters copied from the same map cannot detect the same omitted cleanup. Exact resource disposal and measured heap growth remain separate claims. Preserve #635's useful historical harness and source-bound scope.

## 8. Work packages and dependency order

All IDs below are passive planning labels, not runtime job identities. Every modifying task binds exact current paths, original carrier, accepted inputs, budget and independent proof. Commands and new tests in the full annexes are planned, not executed by this assessment.

| Task | Lead | Dependencies | Observable outcome / decisive falsifier |
|---|---|---|---|
| G00 | Fable | — | Exact current source/used closure, original writers/effects, lockfile/runtime/CI/device baseline; no stale owner implies free custody |
| G01 | Fable | G00 | Actual native Opus→Fabric operator→same Opus consumption using real C01 read-only work; no QUEUED-as-START |
| C01 | O1 contract | G00 | Used method/option/event/primitive matrix; raw cast or unsupported silent option fails |
| C02 | O1 | C01 | Complete portable handles/options on LWC first; actual behavior unchanged, native objects cannot leak |
| C03 | O1 | C02 | Typed primitive/projection/readiness lifecycle; stale callbacks/zero-scale migration rejected |
| M01 | O1/O7 writer | C02 | Primary ChartPanel lifecycle/price handles migrated; zero duplicate mounts/resources |
| M02 | O1/O7 writer | M01,C03 | Compare/built-in rendering migrated, math unchanged; no per-tick pane churn |
| M03 | O1/O7 writer | M02,C03 | Markers/watermark/price lines/events migrated; hline-only leak and raw event identity caught |
| T01 | O2 geometry | C01 | Time identity/availability/display representation fixed at existing boundary; no double conversion or 3D rephasing |
| T02 | O2 | T01,C02 | Independent scales/ticks/label math; signed-log/percent/inversion/gap extremes covered |
| T03 | O2 | T01 | Future geometry preserves anchors without invented sessions or observations |
| R01 | O3 renderer | C02,T02 | Original Canvas2D model and actual dark mm factory branch; default remains LWC |
| R02 | O3 | R01 | Six series and pane geometry; density cannot change exact admitted values |
| R03 | O3 | R02,C03 | Bounded invalidation/live updates/actual inventory; missed correction or orphan mutant fails |
| R04 | O3 | R02,C03 | Native primitive paint/hits/overlays; one projection generation and correct clipping |
| R05 | O3 | R02 | Synchronous composed snapshots; exact committed frame and origin security retained |
| I01 | O4 interaction | R02,C02 | Pan/pinch/crosshair/pointer lifecycle; cancel, capture, keyboard and zoom preserved |
| I02 | O4 | I01,T02 | Axis/resize/hit priority; pointer precision, no invalid collapsed-pane migration |
| I03 | O4/O7 writer | C02,T01 | Existing paneSync adapted only; time not index, no new context bus |
| D01 | O4/O7 writer | C03,T02,M01,T03 | Same drawing documents/anchors in both engines; no storage/schema replacement |
| D02 | O4 | D01,I02,R04 | Actual create/drag/undo/redo/future/collapse/rollback drawing workflow |
| L01 | O5 live | M01,C02 | One accepted candle/study/table/sync generation; old async data cannot commit |
| L02 | O5 | L01,T01,R02 | Whole-layer replay/live return; no future completion leakage or fabricated PIT |
| L03 | O5 | L01,C03 | Supported Pine output rendering with existing host containment; hline-only/all-na cleanup |
| M04 | O1/O7 writer | M03,I03,D01,L03 | Zero raw escape in migrated closure; excluded standalone dependencies disclosed |
| Q01 | O6 verification | C01,G00 | Collected real LWC baseline and parameterized browser conformance; native proof remains pending until real mm exists |
| Q02 | O6 | R03,R04,R05,M04,D02,L02,L03,Q01 | Integrated parity and adversarial proof, not a sum of child test reports |
| Q03 | O6 | Q02 | Matched physical-device presentation/latency/memory traces; RAF/emulation is not phone FPS |
| Q04 | O6 | Q02 | EN/ZH responsive/keyboard/zoom/browser/authenticated source acceptance |
| P01 | O7 release | Q02 | Actual bounded native selection via existing release/settings owners; default still LWC |
| P02 | O7 | P01,Q03,Q04 | Real source user workflow and rollback without lost saved state |
| P03 | O7 | P02 | Native default only for qualified main-chart scope, original fallback transition retained |
| P04 | O7 | P03 | Retire obsolete main-chart bridge only; keep LWC for excluded consumers |
| CLOSE | Fable | P04 | Honest actual outcome and residuals, existing-owner durable frontier, no abandoned effects/children |

Start O1 contract, O2 time/scales and O6 baseline responsibilities, with O7 supervising shared-file custody. Do not launch all seven domains merely because they are named. The critical order is boundary→migration plus native core→whole-workflow qualification→actual selection/rollback→scoped retirement. Safe independent geometry/tests can proceed while one shared source lane is blocked.

**First engineering vertical:** same immutable approved development input through actual LWC and mm; price plus volume in two panes; a supported indicator and own synthetic Pine output; time/price drawing; crosshair/pan; accepted live generation; replay and return; resize/collapse/reopen; engine rollback. Compare exact values, saved document bytes, generations and resources. This is early development evidence, not full programme or natural-market acceptance.

## 9. Acceptance design and proposed budgets

Retain the original five zoom levels × daily/intraday/gapped/halted/one-bar/40k-bar × DPR1/2 coverage: 60 core view combinations before applicable series/pane/language factors. Record every applicable cell and unavailable/failed reason. Add fractional DPR/browser zoom, split sessions, partial grouped bars, malformed/duplicate data, late responses, corrections, primitive readiness and supported drawing/script cases.

Use independent semantic/geometry assertions and actual dual-renderer browser execution. Mock tests remain their own evidence class. Visual differences require case-specific explanation or repair; broad screenshot masking cannot hide axis/data regressions. Ensure every new suite is actually collected and included in current CI dependency scope.

Proposed budgets below are to bind prospectively at G00/Q01, not measured performance or resource promises:

| Measure | Proposed gate | Proof |
|---|---|---|
| Smoothness | Original 60fps target on an identified mid-tier 60Hz phone; normal workload presented interval p95≤20ms, p99≤33.4ms | Actual presentation trace with device/OS/browser/power/display/DPR/workload/build |
| Response | Pointer-to-visible committed response p95≤50ms | Bound input and observed frame, not task duration alone |
| Anchor precision | ≤1 CSS pixel in independent pinch/axis projection tests; device measurement limits separately stated | Actual geometry and gesture evidence |
| Density | Original 40k-bar corpus plus representative panes/studies; exact lookup preserved | Same data/view/load in both engines |
| Memory | Native steady workspace memory≤matched LWC baseline after equal warmup | Paired same-instrument runs; raw counters and limits |
| Lifecycle | Original ≥50 switches, no growing orphans; zero owned resources after destroy | Renderer/caller/browser observations and retained mutants |
| Idle | No self-sustaining renderer repaint loop on unchanged settled input | Actual frame/event observations with visibility/external activity separated |

Use at least three paired interleaved workload repetitions for a comparison. Retain all runs/failures. Any target amendment is explicit and prospective, never a retroactive pass. Do not improve apparent speed by hiding series, reducing the tested data or changing mathematical semantics. RAF/draw-call frequency is not presented FPS; desktop mobile emulation is not physical-phone proof. If a platform cannot expose the required measurement, report the narrower result and the remaining gate.

Required isolated falsifiers include shifted time coordinate, wrong transform sign/reference, omitted resource removal, stale generation accepted, future replay value exposed, historical-update autoscale not invalidated, wrong pixel-space primitive and an uncollected test. These mutations never run on production.

## 10. Release, safety and completion

Read current root and app instructions before product effects. Use an ordinary admitted source workspace and preserve shared dirty primary work. Existing Options companion and IW2 PRs are collision candidates to reconcile, not new projects to take over. A current writer or unknown effect remains fenced; archived chat/old timestamp does not grant transfer.

Follow actual required checks, independent exact-head review and canonical merged-source deployment. Do not rsync a draft or lower a protection. Prove installed build, requested flag/setting, actual executing engine and user result separately. One account's success is not all-account adoption. Rollout uses current release/settings/telemetry owners, not a new service.

Rollback changes the renderer only: data, live/replay authority, drawing schema and saved workspace meaning remain. Test native→LWC→native after actual user edits and verify no duplicate subscriptions/resources. Preserve account access/revocation and sanitize captures; no secrets or private chart notes enter public evidence. No database migration or new persistence is planned.

Each operator return names original task/root/carrier; exact base/head/inputs/changed paths; actual checks and falsifiers; evidence class; independent review; unresolved limits; confirmed/unknown effects; active children; observed consumption; and next necessary decision. Opus adjudicates its domain; Fable integrates. Raw histories stay at source, and nested coordinators never multiply permissions/budget.

Execute→verify→persist compact delta in existing owners→start the next safe ready dependency. A checkpoint, passing suite or open PR is not a stop while required healthy work remains. Do not poll unchanged CI or create filler work. Real external execution needs an actual owner and return path; this planning document creates neither a watcher nor a worker.

CLOSE distinguishes built, merged, installed, selected and production-proven. It names excluded standalone LWC consumers and mandatory unfinished device/source/access work. Do not count all unavailable states as completion or use this plan's assertions as executed proof. Stop only for the proven scoped outcome, user stop, real gate after useful independent work is exhausted, actual durable external execution with no useful local work, or genuine continuity risk with a verified frontier.

**Fable: complete the original native main-chart capability through native Opus leadership and economical Fabric operators. Preserve existing owners, build the original renderer against a proved contract, and finish the actual user workflow and rollback—not another report.**
