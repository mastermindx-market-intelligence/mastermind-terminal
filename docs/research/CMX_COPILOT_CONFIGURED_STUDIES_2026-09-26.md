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
