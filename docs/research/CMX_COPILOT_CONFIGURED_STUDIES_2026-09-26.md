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
