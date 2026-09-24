# CMX A1 Native Suite Control Implementation Plan

> For agentic workers: use superpowers:executing-plans for this bounded native execution, or the admitted subagent-driven path when independently available. Steps use checkboxes for evidence tracking.

**Goal:** Configure native Terminal suites through the existing Brain command bus without dropping nonnumeric settings.
**Architecture:** Metadata-derived validation extends the current chart command translator; three small shell seams advertise and apply the existing suite identities. The existing parameter store, lazy runtime and kernels stay authoritative.
**Tech Stack:** existing TypeScript, React, Vitest 2.1.9, Playwright, Next 16.2.9; no new dependencies.
**Spec:** docs/superpowers/specs/2026-09-24-cmx-a1-native-suite-control-design.md

## Global constraints

No new indicator algorithms, catalogues, data/alert stores, routers, MCP services, account permissions or production signals. Do not edit useChartBus, the indicator host/types, BrainWidget, workflow presets, or the hash-protected ChartPanel. Preserve current classic behavior. Never claim exact-context or predictive proof from this slice. All commands operate in the locked task worktree, not the shared primary checkout.

## Review focus

- String booleans, unknown enum choices, NaN/Infinity, and nested maps must reject the whole native request.
- False module switches must survive; truthiness cannot re-enable default studies.
- Paid suite metadata visibility must not bypass the existing renderer tier gate.
- Manual and AI settings must use identical kernels, including satellite/default settings.
- Partial parameter updates must not delete unrelated saved parameters; replace-set indicator membership retains its existing meaning.

## Task 1 — Native setting semantics

Files: create terminal/lib/chartIndicatorParams.ts; modify terminal/lib/chartBus.ts; test terminal/lib/__tests__/chartBusNativeSuites.test.ts.
Consumes: existing getSuiteMeta/SuiteModuleMeta metadata and chartBus.translate.
Produces: IndicatorParam = number | boolean | string; readNativeSuiteParams(suiteKey: string, value: unknown) returns {ok:true,params?:Record<string,IndicatorParam>} or {ok:false,error:string}.

- [ ] Write failing tests against the existing translator, not a mock.
```ts
const params = { "sr.on": true, "sr.sensitivity": "low", "sr.bufferZone": false };
const result = translate(command(params), { tfs: ["D"], indicators: ["structure"] });
expect(result.ok && result.setIndicators?.[0].params).toEqual(params);
```
- [ ] Run npm test -- lib/__tests__/chartBusNativeSuites.test.ts and retain the RED result.
- [ ] Add metadata-only validation. Resolve each <module>.<field> through the existing module fields; validate master on switches as booleans. Reject unknown fields and unsupported declared kinds.
```ts
if (field.type === "bool") return typeof value === "boolean";
if (field.type === "select") return field.options?.some(option => option.v === value) === true;
```
- [ ] Route native suite params through that reader in chartBus.translate; propagate an error before emitting a setIndicators result. Retain the classic number-only translator branch.
- [ ] Run new tests plus chartBus.test.ts and suiteRegistrySplit.test.ts; verify Structure/RSI command parameters produce identical real computeSuite outputs to manual inputs.
- [ ] Commit only the tested implementation/test/spec/plan paths.

## Task 2 — Mounted shell consumer

Files: modify terminal/components/TerminalShell.tsx; create terminal/e2e/brain-native-suite-control.spec.ts.
Consumes: IndicatorSpec typed scalars and existing SUITE_ORDER/isSuiteKey.
Produces: the mounted Brain command callback accepts native suite identities and preserves suite parameters.

- [ ] Inspect the exact incumbent shell patches before editing the small Chart Bus block.
- [ ] Add a browser test invoking the real host callback with explicit mocked model transport, e.g. chart.set_indicators -> Structure Core sr sensitivity low and bufferZone false. Assert the existing settings/renderer reflects those values, not just a success caption.
- [ ] Make the minimal wiring changes:
```ts
capabilities: { tfs: TF_CANONICAL_ORDER, indicators: [...IND_ORDER, ...SUITE_ORDER] }
const keys = specs.map(s => s.name).filter(k => isIndKey(k) || isSuiteKey(k) || scriptById[k]);
const withParams = specs.filter(s => s.params && (isIndKey(s.name) || isSuiteKey(s.name)));
```
- [ ] Preserve parameter merging into existing indParams and all unrelated shell behavior.
- [ ] Run focused browser proof at 1440x900, 820x1180, and 390x844; capture actual mounted evidence and label the data/model fixture.
- [ ] Run TypeScript and full unit tests. Retain warnings and any actual failures by name.

## Task 3 — Independent review and delivery

Files: docs/research/CMX_A1_NATIVE_SUITE_CONTROL_EVIDENCE_2026-09-24.md and existing parent/Agent OS continuation records.
Consumes: exact source head and collected test/browser receipts.
Produces: one recoverable PR with truthful BUILT_NOT_PROVEN state until release proof is met.

- [ ] Reconcile remote branch/head and publish the candidate once, then read it back.
- [ ] Record exact test counts, input basis, capability delta, missing proof, incumbent boundaries and next action.
- [ ] Request admitted independent review of the exact candidate; no self-authored APPROVE substitutes for review.
- [ ] Release only after current-source compatibility, independent review, exact-head required CI and applicable source/production gates pass.
- [ ] Deploy merged master through the existing git-gated owner and verify the real user path. Otherwise preserve the exact incomplete state; do not call a pushed branch or queued CI complete.

## Current progress

Task 1 source and focused tests pass; implementation commit 64701e45ceb62f8ade1ac2bfcac4ecd5ad7c0d77 is remotely verified. Task 2 consumer and six-case responsive fixture proof pass. Full unit: 6,137 passed / four TODOs. Independent exact-head review, hosted CI and production proof remain owed. See the evidence report for step-grid and mobile-density rulings; neither changes the native kernels.
