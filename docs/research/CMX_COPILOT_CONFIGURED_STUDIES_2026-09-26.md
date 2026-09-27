# Copilot configured studies and surgical chart edits

## Status and ownership

SOURCE_IMPLEMENTED / UNTESTED / NOT_RELEASED. The Chairman explicitly deferred local tests and final qualification for this feature-building phase. No test pass, compilation, browser behavior or predictive improvement is claimed for these changes. Retain Draft/HOLD; normal repository CI must not be disabled or bypassed.

Program: Macro #7151, operation `MMX-AI-TERMINAL-ENV-BUILD-20260924-SOL-001`.
Paired backend: existing Macro #8014, branch `claude/cmx-a2c-stream-command-ack-20260925`.
Terminal carrier: retained branch `claude/cmx-a4-native-ta-skillpack-20260925`.
Protected procedure: Mastermind `a31f49f4056943124cc0e7e42349e46feee444c7` (Skillpack 1.0.1/bootstrap 1). No relevant INDEX/COLD_START/ACTIVE_EXECUTION/CLOSEOUT delta from the preceding pin.

## User jobs addressed

- “Add this native indicator and tune one setting, but leave the rest of my chart alone.”
- “Remove that AI trendline, but keep the other marks and my own drawings.”
- “Analyze this chart” using its attached native instruments rather than requiring indicator names in the prompt.

These are intended user journeys, not recorded executions.

## Same canonical owners

`chartIndicatorParams.ts` projects the current suite metadata and guide registry. No second indicator catalog, computation or guide corpus. `TerminalShell` places the projection on the existing state mirror; frozen ai_context v1 is unchanged. `chartBus` retains validation/translation/reduction and `useChartBus` retains application and ACK transport. Macro retains the exact-origin chart record and existing technician router. No new endpoint, state ledger, action queue, provider or auth path.

## Additive indicator edits

Use the existing `chart.set_indicators` op with explicit `mode: "patch"`, `indicators: [{name, params?}]` and optional `remove: [name]`. Unmentioned studies/scripts/order/settings survive. Metadata validates native numeric/boolean/enum/module-switch settings. Conflicting add/remove names, duplicate edits, malformed values and empty patches refuse instead of partially mutating. A missing mode preserves legacy replacement behavior; removals are not legal in replacement mode.

The patch is calculated again at queue execution against the current host's indicator list. Accepted settings update the existing host reference so a second same-tick patch sees the first configuration before React's commit. The actual computations and entitlements remain owned by the existing manual indicator settings/rendering path.

`capabilities.indicator_edit` advertises support. The backend refuses to send a patch without exact-origin/revision state advertising this feature, because an old client could interpret the same op as destructive replacement. Adding an inactive native suite can require an add-only patch, then a fresh state read to discover its exact native setting names before a tuning patch. Configuration/application success is not computation/render proof. Existing ai.undo does NOT undo settings.

## Selective AI annotation removal

`ai.clear {ids:[...]}` removes only exact AI ids from the active symbol's AI store. The selection is atomic: an unknown id rejects the complete request. Empty/malformed/user-owned ids reject. Omitted ids retain the old clear-all-AI-on-this-symbol meaning. Human drawing storage and other symbols are untouched by this reducer. Multi-object drawings use their actual returned child ids, not an invented parent-id deletion convention.

`capabilities.ai_drawing_edit.clear_ids` advertises support. The backend refuses selective clear for an unqualified/old client and must never drop the ids to make the command run.

## Configured native context

`capabilities.native_study_context` carries bounded stable suite/module ids, enabled settings and guide availability. It is derived from canonical metadata, prioritized enabled-first, capped at 4096 actual UTF-8 bytes and explicit about omitted modules. It contains NO numeric indicator observations. Enabled is not unlocked, healthy, warmed up or predictive. Requested settings remain in `session.indicators`; native kernel normalization is not attested by a configuration hash.

The backend derives a bounded study_context and selects the existing technician lessons from validated identities only. Raw client titles, guide prose, captions and parameter values never enter the privileged prompt through this path. Older native_parameters packets can supply a conservative partial fallback. Disabled/contradictory/omitted module state is not promoted to an observed signal.

## Deferred acceptance matrix — specifications, not executions

A. Patch: preserve unrelated native/classic/script entries, ordering and parameters; retain false and enum values; add then tune; explicit removal; duplicate/conflicting/unknown/malformed entries; unchanged legacy replacement; queue delay and intervening manual edit; two same-tick patches; setter failure; real renderer/settings parity.

B. Selective clear: one and multiple existing ids; absent id rejects atomically; duplicate ids; empty ids; user ids; grouped child ids; other-symbol isolation; omitted ids compatibility; old-client refusal; exact ACK and actual visual result.

C. Native context: all suites, enabled-first ordering, UTF-8 byte cap, omitted identities, guide gaps, disabled modules, invalid/contradictory rows, no-native chart, malformed fields, parameter fallback, and absence of accidental computation/entitlement claims.

D. Gateway: generic prompt selects actual configured native guidance; explicit user topic still outranks context; wrong origin/revision/expired/missing state does not load stale chart guidance; read and verified action refresh exactly one block in stream/nonstream loops; raw client strings do not become prompt instructions; three-module/budget bounds and Analyst compatibility; leak guards and EN/ZH meanings.

E. Integrated: real model command → correct target/chart application → exact ACK → updated guidance → accurate follow-up, plus rejection/timeout/nonstream cases. Source-authored guards do not replace this proof.

## Unfinished engineering before release

- New edit extensions do not yet add a host-authored wire target precondition. The pre-existing command path checks exact state at backend dispatch, but a subsequent human tab/pane/symbol/timeframe change still requires adversarial qualification. Do not call delayed-command targeting solved by execution-time indicator rebasing.
- Current configured-module context supplies identity/settings, not live numerical native observations. Qualified chart/headless same-kernel observation wiring remains a separate capability.
- Precise range control was not expanded here; no range/viewport regression proof is claimed.
- No arbitrary Pine execution, roaming, autonomous research, learned signal ranking, alerts, account change or trade authority was added.


## Continuation: exact-target receiver and bounded Data Window readout

**Authored source only / UNTESTED / NOT_RELEASED.** This is a bounded continuation on the same Terminal #757 carrier, not an accepted runtime result. No local tests, compiler, browser/model qualification, merge or deploy was performed. `git diff --check` checks formatting only and is not functional evidence. Current protected Mastermind pin: `4c6b206d3fb7fbc6d077faf61ae361bedf259925`; compatible Skillpack 1.0.1/bootstrap 1. Required source blobs are identical to the previously loaded pin. Existing assignment and test deferral remain controlling; no new design-approval ceremony is introduced.

### Exact-target receiving implementation

The existing v2 command envelope accepts one optional top-level `target`:

```json
{"schema":"chart.command_target.v1","origin_id":"existing-mount-id","context_revision":8,"pane_id":0,"symbol":"NVDA","tf":"D"}
```

The values must come from the server-bound original chart context, NOT model parameters. This is an equality precondition, not authentication or another origin/revision registry. The receiver validates bounded strings, safe nonnegative integer revision/pane, and the exact schema; it does not coerce missing values or normalize another target into the current chart.

Target is now **mandatory** for the two new extensions (`chart.set_indicators` with `mode:patch`, and `ai.clear` with an `ids` selector). Other legacy v2 commands retain their untargeted behavior; when they explicitly carry a target it is checked. A missing target on the new extensions is an explicit rejection, never fallback to destructive replacement/clear-all.

`useChartBus` compares the target to the existing provider plus committed host both when the message is accepted and again immediately before queued execution. A mismatch returns a bounded failed ACK before changing the AI store or chart settings. It neither switches the view to make the command fit nor silently requeues/retries the action. Targeted wire commands are detached before queueing to avoid retaining ordinary JSON-object aliases. An unmounted hook cannot execute queued work. A context-changing command setter closes a local pending guard until a committed symbol/timeframe transition is visible, so a following same-tick edit cannot slip through against the old host.

The pane is the incumbent workspace chart tile (`activePane` / `session.pane_id`), not a newly invented oscillator-subpane identity. The frozen ai_context v1 provider and its revision semantics are unchanged. The tuple does not detect every pane-away-and-back or pan/zoom excursion that leaves the incumbent identity unchanged. Do not advertise such a stronger generation guarantee.

**Receiving half only:** the attempted companion backend-target-authoring write was refused before tool dispatch. It was not retried, split or moved to another carrier. No backend target producer is claimed from this continuation. The server must freeze the initial pane as well as the original origin/revision/symbol/timeframe, qualify receiver support, attach the target outside model control, and only advance it following an explicitly requested, accepted context change. Arbitrary user drift, a timeout or a rejected action must not authorize retargeting. Existing old/untargeted backend output will now be rejected for these extensions. Keep the paired release HOLD until this contract is implemented and qualified.

Source-review risk still requiring repair/qualification: JavaScript-only local objects are not ordinary JSON wire messages. A local `ai.clear` caller with `args.ids: undefined` plus a valid target can lose that selector during JSON detachment. An additional selector-preservation refinement was included in the refused compound write and is **not applied**; do not claim malformed-local-object ingress is safe. Ordinary network JSON cannot carry `undefined`, but the local validator must be made fail-closed before release. This finding is source inspection, not an executed reproduction.

### Existing chart numerical readout, not another native kernel

New `terminal/lib/chartReadoutSnapshot.ts` projects the incumbent ChartPanel/Data Window lookup. TerminalShell supplies it through the same Chart Bus state mirror as `session.data_readout`, with schema `chart.data_readout.v1`.

It returns at most the latest **loaded** candle and the exact **locked vertical-line** candle, with source OHLCV and available numeric readout ids. A missing locked bar is reported as not loaded; no nearest-bar snapping, future-bar insertion, stale-value backfill, or substitution of the latest candle for the requested one occurs. This is not a hover-crosshair selection claim.

The projection has a 4096-byte complete-packet budget and a per-sample field cap, explicit omission counts and null/nonfinite disclosures. It does not manufacture zero values, infer units, or claim that an empty readout means no setup. Source identifiers remain data, never privileged instructions. Data Window names such as `mc.rsi14` are their own series and must NOT be silently relabeled as native RSI Ultimate `rsix/eng`.

The existing readout metadata is extended locally with its captured origin/revision, chart tile, settings signature and replay selection. A mismatch with the current committed shell makes the readout unavailable until its original owner provides another matching readout. The original ChartPanel/ChartPane renderer, suite kernels, Node headless observation adapter and ai_context provider are unchanged. No second calculation, browser driver, polling timer, source fetch or provider call was added. Readout refresh shares the existing ordinary telemetry coalescing; ACK priority remains higher.

Limitations are in the payload: capture time is not provider as-of time; last-bar closure is unknown; loaded cache is not independently live-attested; the readout owner does not attest exact native settings/health/warmup; not all native studies are covered. Replay is labeled as a replay slice, never current market data. The existing headless native observation code remains Node-only and was not imported into the browser or duplicated.

### New deferred acceptance cases — not run

F. Target receiver: missing/malformed/versioned targets; exact match; other origin, revision, tile, symbol or timeframe; receipt-to-queue context switch; unmount; same-tick symbol/timeframe transition; no-op context setters; setter exception/possible partial effect; valid legacy behavior; targeted command JSON detachment and malformed local selectors; original error ACK preserved without automatic replay. Also check pane-away/back limitations and no manufactured revision change.

G. Target producer: server-owned original target; model-supplied target ignored; initial missing/mismatched state; pane switch while model computes; old receiver refusal; wire field preserved by both stream/nonstream paths; requested context-change adoption only after matching accepted ACK; rejection/timeout/manual drift never auto-retarget; normal visual result and exact receipt.

H. Data readout: exact selected vs latest-loaded times, missing/invalid selection, empty series, zero/null/nonfinite values, malformed fields, UTF-8 byte budget and omissions, throwing lookup, no lookup, classic/native namespace distinctions, pane/symbol/timeframe/settings/replay mismatch, source-readout update, no added computation/fetch/polling, existing ACK scheduling, full state-body size, model-visible projection and truthful missing/live/replay language.

### Source custody and exact continuation boundary

Backend #8014 changed concurrently from `84aa2829a725d6f44d81545537e3df68c036f206` to remote/local `961c478b290c760556af9daec062ec7596af36e0` (observed title: `test(brain): align doctrine guards with native lessons`) and had additional uncommitted `brain_gateway.py` plus `test_brain_gateway.py` changes. These were NOT authored or staged by this turn; no test execution is inferred from their presence. Backend source is a collision/ownership gate, not permission to overwrite a writer. No running matching process was observed, which does not prove release of its custody.

The prior Agent OS handoff on the backend branch is retained, not overwritten while that source is occupied. This exact Terminal document and the existing program carrier receive the current continuation reference; no second lifecycle store or PR is created.

Next: the incumbent backend writer must be reconciled and consume the target contract before either paired feature can be released. Then finish qualified native numerical observation integration (the Data Window readout above is not a substitute) and the deliberately deferred combined tests/typecheck/browser/real-model qualification. Preserve all earlier controls, patch/remove features, native configured context and guidance source. No independent reviewer/Fable was started. No watcher, autonomous wake or background Web work is claimed.

FINALIZATION_CLASSIFICATION at verified publication: CHECKPOINTED_CONTINUATION.
MISSION_COMPLETE: false. EFFECT_UNKNOWN: none for this turn's observed Terminal effects; the refused write was pre-dispatch/EFFECT_NONE. Concurrent backend custody remains unresolved and is not transferred by this checkpoint. Resume in the current Pro surface for source-owner reconciliation and independent feature work; do not use a mode/carrier change to bypass a refused action.


## Continuation — visible chart-action results (2026-09-26, New York)

Status: newly authored source; local tests, TypeScript, browser, model and visual qualification remain deferred by Chairman direction. Persistence/source inspection is not execution proof. No merge/deployment or feature acceptance is claimed.

### Bounded capability and existing owners

The ChartConductor now consumes local refusal notifications through the existing CommandQueue step/lifecycle channel. Previously a v2 envelope, target or translation refusal could generate an ACK but never enter the animation queue, leaving no on-chart explanation. `reportRejection` emits a refusal notification without enqueueing an action or running a chart setter. It is not a retry, extra command, backend ACK, receipt store or additional controller. `unknown` is an observation-only label for a rejected malformed op, never an admitted wire operation.

The receiver forwards the same bounded error codes into both pre-queue and queued feedback. User-facing explanations are fixed EN/ZH copy, not raw exception strings or failed-command captions. A failure opens the existing action rail and updates the caption. Rejected events carry no success-fit chip or cursor animation. A throwing context/indicator/range setter is shown as **unconfirmed**, because it may have begun a change; no unchanged-chart assertion or automatic retry is added. The backend's existing ACK contract is unchanged by these local UI distinctions.

The summary counts accepted, rejected and unconfirmed actions separately. Scene markers are not counted as mutations. The actual current AI-object count remains distinct and zero remains zero after a clear; it is never replaced with a previous drawn-object tally. Adjacent notifications inside the existing 1.2-second settle window remain one visible sequence so a later success does not erase an immediately preceding refusal. These are local sequence counts, not a new durable per-Brain-turn action ledger.

Operation-specific fallback text distinguishes symbol switches, timeframe switches, study edits, range edits, clear and undo. The existing animation bypass now says **Skip animations**, including its accessible label; it is not a cancellation control. Existing classes, colors, token owners, overlay layout and motion timings are reused. The rail exposes explicit text outcomes and polite screen-reader updates.

### Source/custody reconciliation

This unit starts on Terminal `867af1c91850e4a8078df9ede1c44bdbbba20c79`. Its preceding concurrent test-source work became both local and remote with a clean tracked/index state; it is preserved, not attributed to this session or rerun. No matching cwd process was found in the bounded host observation. Product file preimages and local/remote HEAD are fenced before mutation/publication. Scope pickup: #757 comment 5851371231. No STARTed delegated child or source lease is displaced by a new dispatch; no new worker was submitted.

Macro independently published target-production source at `99d363a3d4b99cfc58812cc7c06b51a2d39a5130`. That is a source-identity observation, not a reviewed compatibility result. This turn's compound read of that new target diff and native numerical-observation sources was blocked before dispatch; it was not retried, split or routed elsewhere. EFFECT_NONE for that read. The backend and native-observation lanes were left unchanged while this separate ChartConductor capability advanced. Earlier denied source actions and unresolved producer/receiver/selector qualifications remain held; a new commit title does not settle them.

### Deferred acceptance additions — specifications only

1. A first-command validation/unknown-op/target/translation refusal opens the existing rail, emits exactly one refusal notification and retains exactly one canonical ACK. It must enqueue no action and call no setter.
2. A queued target rejection and reducer refusal show their fixed reason without a successful model caption, fit chip or cursor pulse. An unsupported local error string remains generic and cannot become HTML or privileged instructions.
3. All-rejected, all-accepted, mixed and setter-unconfirmed sequences settle honestly. A clear that leaves zero objects must report zero even after preceding draws; scene-only traffic must not claim chart edits.
4. Follow-on work inside the settle window preserves earlier outcomes; a genuinely new visible sequence after the completed window resets them. Notification callbacks must not alter execution order, pacing, ACK timing or command counts.
5. Context, indicator and range setter throws are unconfirmed, not proven no-effect. No automatic retry or hidden retarget follows.
6. EN/ZH × dark/light × desktop/tablet/mobile, reduced motion, long failure text, rail auto-open/manual close, keyboard/screen reader and Skip animations behavior require actual browser/visual proof. Existing CSS reuse does not constitute that proof.

Finish exact targeting and full-native numerical observation qualification through their incumbent owners, then execute the deferred combined validation before release. Do not substitute this action-feedback feature or historical ancestor tests for those outcomes.


## Continuation: published feedback and cancel queued actions

This section supersedes the older LOCAL_SOURCE_UNPUBLISHED feedback statement only. The five-file feedback source was committed and pushed on the SAME #757 branch at `37afbd7d74d4cf90e91bf2d858f1972b96c55fc2`. Expected local/remote HEAD and exact owned postimages were reconciled; the existing untracked `terminal/e2e/brain-targeted-readout.spec.ts` remained byte-identical and was not staged, run or deleted. Source reconciliation notice: #757 comment 5851450815. A path-disjoint untracked specification did not justify abandoning the current owner's independently identifiable source. No global workspace-clean, writer-release, test-pass or release claim follows from this publication.

### Additional user capability — source authored, not qualified

The existing Conductor now exposes **Cancel queued** separately from **Skip animations**. It is a native button using current controls/classes, with English/Chinese scope labels and disabled state when the queue has no pending work. The first paced delay can show pending text and this control before the first command executes. Existing dark/light material, keyboard button behavior and reduced-motion policy are reused; no new CSS/token root or design treatment is introduced.

`CommandQueue.cancelPending()` detaches the commands already pending at the click, clears their scheduled execution and invokes cancellation callbacks, never their `run` callbacks. Each real Chart Bus command callback produces an `ok:false` / `command_cancelled_by_user` ACK with the original host batch and sequence through the SAME ACK transport. Already-applied changes and human drawings are not undone. Cancellation notifications share existing step/drain listeners and preserve accepted/cancelled/rejected/unconfirmed outcomes and the actual remaining mark count. If a cancellation receipt callback throws, the pending action stays removed and the panel discloses the receipt limitation; it is never run as recovery.

Queue metadata remains in the incumbent queue; no second queue, cancellation store, identity, timer service, model route or retry engine is created. The pump is non-reentrant during step notifications so callback-triggered enqueues/cancellations cannot double-run work. The existing `clear()` lifecycle behavior remains; `applyInstantly()` still executes pending jobs rather than cancelling them.

**Scope is deliberately local:** this does not abort the Brain response, interrupt an already executing synchronous setter, cancel a provider call, revoke later SSE commands or roll back accepted effects. Later-arriving commands can still be queued. The UI explicitly names this limitation; do not relabel the button Stop AI or Cancel turn. The paired technician protocol tells the model not to retry or substitute a cancelled action without a new explicit request. That is authored guidance, not tested model compliance or a server-enforced cancellation ledger.

### Deferred acceptance additions — not executed

Cancel before the first paced action; cancel after one accepted action; mixed accepted/cancelled/rejected summaries; zero-pending disabled/no-op behavior; all pending run/setter/reducer callbacks remain uncalled after cancellation; exact one negative ACK per cancelled real command; cancellation ACK network failure retains the existing transport behavior; cancellation callback failure disclosure; no undo of already-applied edits; manual drawings preserved; reentrant step-listener cancellation/enqueue/drain order; later streamed commands explicitly outside scope; Skip animations still applies rather than cancels; reduced-motion zero-delay limitations; narrow/light/dark/EN/ZH/keyboard/accessibility behavior; model follows no-retry instruction after cancellation; old tests and real producer/receiver integration before release.

No local test, compiler, browser, model run or CI poll was performed for this continuation. Candidate remains Draft/HOLD/BUILT_NOT_PROVEN. The independently authored backend target producer and Data Window consumer are recorded at #8014 `84f60fb43cc07e1cfd57438e8d3cca5198999465`; they are not rebuilt or claimed reviewed here. Exact denied target/native inspection actions stay held. Full native numerical coverage, malformed-local-selector qualification and the final paired browser/model acceptance remain unfinished.


## 2026-09-26 deep feature batch — live native evidence and exact range control

### Live native numerical evidence from the renderer's own bundle

This batch closes the architectural gap between "the native study is configured" and "Copilot can inspect numerical/native facts that the on-screen Terminal actually computed."

The implementation deliberately does not add another indicator engine. ChartPanel continues to call the canonical entitlement-aware computeSuite() owner. After a suite's bundle is successfully used by the active chart pass, the same SuiteRenderBundle is projected through terminal/lib/nativeObservationProjection.ts. The headless research adapter ingest/native_suite_observation.ts now consumes the same projector. One selection law therefore owns recent series samples, event confirmation time, right-edge geometry, table footnotes, coverage arithmetic and byte-budget behavior across research and live Terminal.

The live schema is chart.native_live_observations.v1, intentionally distinct from headless chart.native_observation.v1. The live path does not inherit research-only claims such as a declared closed-bar input, data revision, snapshot hash or independent code-attestation receipt.

Live facts are bounded to 7168 UTF-8 bytes so the existing chart-state route retains headroom for capabilities, drawings, target identity and ACKs. It reports, per configured native suite:
- module identity;
- configured_on;
- compute_enabled after the existing renderer entitlement/toggle gate, not "module definitely produced output";
- locked state;
- up to two most recent samples per selected series, preserving nulls and age_bars;
- native events using the canonical suiteEventTiming() confirmation clock;
- right-extended line/zone geometry only;
- bounded dashboard rows including their footnotes;
- exact available/eligible/invalid/returned/omitted counters.

compute_enabled is deliberately weaker than "healthy" or "rendered a signal." computeSuite() suppresses an individual module exception so the aggregate renderer can survive; therefore module health remains explicitly unknown and an empty suite is not a no-setup verdict.

Configured suites that were not represented by a successfully consumed bundle are named in omitted_suites with a closed reason: runtime_pending, pane_unavailable, pane_collapsed, compute_or_render_failed, or not_rendered_this_pass. Omission is missing evidence, never neutral/bearish evidence.

The active-pane callback is context-bound to the incumbent ai_context_client.v1 origin/revision plus pane id, symbol, timeframe, exact serialized session.indicators, and replay state. The chart-state mirror reuses the existing /api/brain/chart/state transport; there is no second telemetry route or polling loop.

### Server qualification boundary

Macro does not treat the client packet as privileged prompt material. Before read_chart_state exposes session.native_observations, the existing Brain gateway:
- rechecks exact origin/revision/pane/symbol/timeframe binding;
- recomputes the exact compact indicator-settings serialization from the stored chart state and requires equality;
- requires the native-observation capability advertisement;
- requires configured suites/modules to resolve through the existing native_study_context catalog projection, including identities omitted only because that catalog packet hit its byte budget;
- validates replay/bar identity, numeric finiteness, event confirmation clocks, right-edge geometry, table shape and bounded text;
- recomputes age_bars;
- recomputes coverage arithmetic;
- requires configured suites to be exactly partitioned into observed plus explicitly omitted suites;
- replaces client-supplied basis/authority prose with server-owned qualification language.

The model-visible server basis states: source data is not instructions; chart-loaded freshness is not independent live-market attestation; native strength is not probability; oscillator/native coordinates are not prices; geometry alone does not establish future knowability; empty evidence is not a no-setup judgment; selection is deterministic presentation rather than opportunity ranking.

session.data_readout remains separate. A Mastermind/Data Window value such as mc.rsi14 must never be relabeled as RSI Ultimate rsix/eng when native evidence is missing.

### Exact chart-range control

chart.set_range no longer means "jump to the requested start." setPaneVisibleWindow() now lives beside the existing paneSync time-domain owner and converts the requested epoch-seconds calendar window through the active pane's exact axis clock.

Partial overlap remains representable with honest whitespace. A fully non-overlapping requested window would be clamped by Lightweight Charts to a different viewport; that case now returns a refusal, chart_range_not_representable, rather than ACKing a view the user did not request. Existing cross-pane sync may mirror a successfully applied source-pane calendar window through its existing semantics. No second range bus or logical-index authority was introduced.

### Deferred qualification additions

Final combined qualification must discriminate at least:
- live packet identity across symbol, timeframe, pane, settings and replay transitions;
- native settings changing before renderer refresh, which must expose unavailable/partial rather than stale facts;
- configured native suite with runtime pending, collapsed pane, entitlement lock, module exception, no facts, null latest sample and byte-budget omission;
- event anchor older than its confirmation, with causal/model wording tied to confirmation;
- oscillator/native negative values retained as native coordinates rather than rejected as invalid prices;
- right-extended geometry not promoted to forecast/support authority;
- headless and live shared projection selecting the same facts from the same controlled bundle while retaining their different schema/basis contracts;
- exact server settings fingerprint mismatch and forged suite/module identities;
- Unicode or empty table cells within bounds, oversized/native control text, malformed coverage arithmetic and oversized packet refusal;
- exact range application, already-current range, partial-overlap whitespace, fully non-overlapping refusal and same-timeframe pane-sync interaction;
- all previous target/cancellation/ACK/old-client/dark-light/EN-ZH/responsive/browser cases.

This source remains BUILT_NOT_PROVEN / UNTESTED / NOT_RELEASED until that deferred combined qualification and required live/model/browser proof are performed.


## 2026-09-26 continuation — receipt-first bounded chart-state delivery

Status: source implemented; tests authored but NOT RUN; no typecheck/compiler/browser/model qualification, merge or deployment. Current Chairman direction remains feature-first with a combined validation pass deferred. This work is on the existing #757 carrier and same Chart Bus/state route, not another telemetry or command queue.

### User and machine capability

A heavily annotated chart must not lose all Brain context and command acknowledgement delivery merely because its state JSON exceeds the existing API body limit. Preserve exact origin/revision, requested settings and receipt identifiers. Reduce only the wire projection, explicitly, without deleting actual drawings or manufacturing an empty native-study assessment.

`chartStatePayload.ts` prepares a conservative 60 KiB envelope beneath the server's 64 KiB validator. The size bound accounts for ASCII-escaped Unicode, JSON separator spacing and numeric printer differences, rather than assuming browser UTF-8 size equals Python's validator size.

Small states retain their previous shape. Under size pressure the projector:
1. Reduces drawing geometry/captions to an identity/ownership roster; the chart stores are unchanged.
2. Can withhold verbose native parameter descriptions while preserving settings, configured identities and command/target capabilities.
3. Bounds the drawing roster in its original order, publishing available/returned/omitted/detail-omitted counts.
4. Marks native observations or Data Window evidence unavailable with `chart_state_budget` when those optional packets cannot fit. Missing observations are not negative market evidence.
5. Keeps FIFO ACK identities intact, sends at most 32 per batch, and retains every unsent receipt. It can reduce a batch further when necessary; an unfittable first receipt or essential context fails closed, never silently truncates identities or settings.

`session.mirror_coverage` describes the projection, not deletion from the chart. A reduced roster is not a complete inventory. Compact command-receipt drawing counts can describe returned rows only; re-read coverage before making whole-chart inventory claims. No retry with omitted ids or broad-clear substitution is authorized.

### Existing transport integration

`useChartBus` now prepares the bounded payload before consuming ACKs, so identity-getter or serialization failures leave the accumulator intact. It uses one in-flight request for this mirror and coalesces an actual newer update into the current scheduling owner. Remaining ACK batches drain after successful delivery without requiring another market tick. A failed/non-2xx/aborted batch is restored once ahead of later receipts. Another attempt after failure requires an actual new/coalesced input; there is no periodic retry loop. A four-second request deadline releases a stalled upload and is not proof of server non-execution or receipt delivery. ACK replay is existing idempotent receipt transport, never replay of chart mutations. Unmounted receivers do not launch deferred requests.

Delivery is still not guaranteed during network or authentication failure. A timeout is not cancellation of the underlying chart action. The collective Brain ACK deadline and late-command targeting remain separate acceptance obligations; this transport change does not grant a stronger command-result or pixel-proof claim.

### Authored, unexecuted acceptance cases

`terminal/lib/__tests__/chartStatePayload.test.ts` covers unchanged small snapshots, Unicode/server accounting, string punctuation, exact FIFO receipt batching, drawing-detail immutability, incomplete roster coverage, optional parameter/native-evidence omission, large receipt batches, an unfittable first receipt and serialization failure.

`terminal/lib/__tests__/useChartBusDelivery.test.tsx` covers single-flight latest-context coalescing, draining 70 receipts without another data tick, exactly-once restoration, throwing identity lookup, stalled-request release, absence of a periodic retry and unmount behavior. These are source specifications, not test results.

### Native/target boundaries preserved

The paired native renderer/qualifier implementation at Terminal `dd8cb762bcae66b7613837d9a16e4762669ad5f3` / Macro `28437b9b02bf13ee4a2f58ec92d49f0b256dbcc8` is retained, not rebuilt. Current source inspection found that target selection occurs after model processing and revision adoption is broader than only accepted intended context transitions. Its attempted deeper inspection was refused before dispatch; no repair is claimed here.

A separate selected-candle event/projection write was refused before dispatch; its implementation is unchanged. Proposed acceptance cases are preserved as specification-only text in `CMX_NATIVE_SELECTION_DEFERRED_TESTS_2026-09-26.ts.txt`, outside executable test discovery. The future capability must separate events confirmed by a selected bar from recent events, preserve numeric gaps and bound candidate selection; it must not claim point-in-time feed history from a renderer snapshot.

A concurrent Macro writer added native settings-format equality and boundary hardening while this continuation was active. That work and its `tests/test_brain_native_evidence_boundary.py` are preserved and not staged or executed by this session. An independently inserted redundant helper was removed by exact text, leaving the incumbent implementation as the single owner. The foreign Terminal browser specification remains excluded. No denied action was retried through another tool or carrier.


## Continuation — native-boundary integration, receipt precision and inert command input

### Native-boundary consolidation

Counterpart return Macro #8014 comment 5851985582 explicitly froze its local gateway/native-boundary
regressions for the continuing Sol writer. The exact returned source hashes were consumed and
published unchanged in Macro 55999405ece25b512db879f2916f9004061a2eea. The new source compares
settings by bounded JSON values rather than JavaScript/Python printer spelling, checks the complete
configured suite/module census, and refuses malformed enum containers, numeric overflow and boolean
chart identities. No parallel equality helper remains. This is published source, not passing tests.

### Matched receipts preserve the effect boundary

The paired gateway retains its accepted/rejected/unverified status vocabulary and adds a more precise
command_outcome: accepted, rejected, cancelled, unconfirmed or unverified. A setter/application failure
or failed receipt recording is unconfirmed with effect_state unknown, even when a negative ACK was
received. Cancellation describes a pending action that did not run, not undo or the whole reply ending.
No ACK still means unknown execution, not proof nothing happened. All receipts explicitly disallow
automatic replay as a model instruction; no new turn-level cancellation/retry enforcement is claimed.

The compact receipt carries a structurally checked mirror_coverage, explicit received-snapshot drawing
count basis, and omitted identity count. Oversized/nonfinite ranges cannot crash receipt generation.
Long drawing ids are omitted with a count instead of truncated into different actionable ids.
read_chart_state uses that SAME coverage qualifier; client basis prose and unchecked completeness
arithmetic are not elevated to server-owned claims. Reported availability is still client-reported,
not an independently reconstructed inventory.

### The original command intake cannot lose a destructive selector

A supplied malformed ids/mode/args value is now refused, not defaulted to clear-all or replace-all.
Intentional legacy clear-all with a genuinely absent selector and legitimate indicator replace mode
remain available. Valid patch and selective removal continue through the incumbent translator and
existing exact-target requirements.

The v2 validator snapshots inert JSON-shaped data before accepting it. It does not invoke getters or
toJSON, rejects non-plain objects, non-enumerable/symbol/prototype properties, functions, nonfinite
numbers, cycles and sparse arrays, and bounds depth (12), values (4096) and UTF-8 payload (64 KiB).
Only optional root id/caption/target undefined properties may be omitted for typed local compatibility;
undefined argument values may not disappear. Every admitted command refers to the detached snapshot,
so later caller mutation cannot silently change its operation or arguments while queued. Batch ids
and sequence numbers now fit the existing receipt owner's 40-character/nonnegative safe-integer
contract. This is an input boundary, not a sandbox for already-compromised JavaScript or a new queue.

### Deferred qualification

New executable specification files: Terminal chartCommandInputBoundary.test.ts; Macro
 test_brain_chart_receipt_outcomes.py (under their existing tests directories). They cover selector
loss, malformed/null input, accessor/toJSON side effects, inert snapshots, payload bounds, namespace
and receipt identity, cancellation/unconfirmed outcomes, missing ACKs, coverage shape/arithmetic,
exact drawing ids, invalid ranges and unchanged input records. The returned native-boundary test
file is now published but remains unexecuted by this continuation. No test, compiler, browser/model,
CI poll, merge or deployment was invoked. Final compatibility and real-path proof remain owed.

Original-pane freezing/broad revision adoption and selected-candle causal event projection are still
held on their previously refused actions. This work neither retries those actions nor closes those
gaps. Existing queue cancellation remains pending-at-click only; no future SSE/provider stop is added.


## Effect-aware Stop and cold reply recovery — implementation slice

Goal: stopping a reply must not erase evidence that chart work may already have happened; replaying an older reply must not silently repeat chart changes. This is independent of the held original-pane and historical-native projection work.

Architecture: reuse the widget's existing per-turn holder, run id/cursor and sessionStorage record. Record only whether a chart callback was invoked and up to 64 existing batch ids, not a second command log. The existing queue gains scoped removal of pending entries by those batch ids. A typed optional `onChartStop({scope:"received_batches", batch_ids})` host callback returns `{scope:"received_batches", cancelled}`; it reports local queue removals, not ACK delivery, undo or provider termination.

Implementation plan (inline, current user assignment; tests are authored first and run only at the deferred combined pass):
1. Add scoped queue cancellation using the current cancel callbacks and preserve other batches/FIFO ordering/timers. Wire exact batch metadata at enqueue; expose no new wire action.
2. Bind the optional Stop callback through the existing BrainWidget config lifecycle and TerminalShell. Older widgets/hosts may ignore it; an absent/failed callback is an explicit unconfirmed stop, never a fabricated cancellation count.
3. Fence widget event forwarding on its existing stopped/done/retracted and current-turn state. Preserve prompt and a fixed bilingual note after any chart callback, even if the callback threw or answer text has not arrived. Clear the existing run through the unchanged server cancellation route, but do not claim its in-flight work ceased.
4. Mark cold reconstructed turns read-only for chart actions. Same live turn reconnect keeps its cursor behavior; a reconstructed transcript must require a fresh explicit user request for new chart edits. Restore known handoff/batch metadata only from the same existing run record. Never use cold reply restoration as target authority.
5. Preserve source/readback receipts on the same PRs and handoff. Run no tests/compilers/browser/model calls in this feature-building slice.

Deferred acceptance: Stop before any chart event retains existing prompt retraction; Stop after command/annotation handoff keeps the user row even without text; callback throws stay uncertain; matching queued work is cancelled once and unrelated batches remain; late chunks and late run responses cannot mutate a stopped or superseded reply; cold replay emits no chart commands and explains that limit; same live reconnect remains supported; old hosts disclose missing cancellation support; callback remount/cleanup cannot reach a stale host; server cancellation failure is not local replay permission; dark/light/EN/ZH/responsive/keyboard behavior stays on existing surfaces.
