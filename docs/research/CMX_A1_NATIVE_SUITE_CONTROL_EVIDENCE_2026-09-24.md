# CMX A1 native suite control — implementation evidence

Parent: Macro #7151; operation MMX-AI-TERMINAL-ENV-BUILD-20260924-SOL-001.
Procedure: Mastermind@1a7d400294b0d37c460b963b8865b40a23173b58.
Base: Terminal@1d2ac1e64a21c957b229e2e2567fcc248d557a64.
Carrier: claude/cmx-a1-native-suite-control-20260924-sol-001.

## Capability delta

Before: the Brain command translator dropped native booleans/enum values, and the mounted shell neither advertised nor accepted native suite identities. After: the existing chart.set_indicators path advertises all five canonical suites and accepts metadata-checked native numeric, boolean, and enum settings. Partial settings merge into the existing manual parameter store; invalid native changes reject as a whole. Existing replace-set membership semantics and rendering entitlement checks remain unchanged.

State: BUILT_NOT_PROVEN. This is implemented and fixture-browser proven, not production deployed, model-qualified, or a complete Stage A environment. Source is original; no external indicator code or assets were imported.

## Recorded verification

| Check | Command | Result |
|---|---|---|
| Protected-base focused baseline | npm test -- lib/__tests__/chartBus.test.ts lib/__tests__/suiteRegistrySplit.test.ts | 61 passed |
| First missing-capability RED | npm test -- lib/__tests__/chartBusNativeSuites.test.ts | 28 failed / 5 passed; scalar loss and invalid native acceptance reproduced |
| Native/legacy/catalog regression | npm test -- lib/__tests__/chartBusNativeSuites.test.ts lib/__tests__/chartBus.test.ts lib/__tests__/suiteRegistrySplit.test.ts | 94 passed |
| Full unit suite | npm test -- --maxWorkers=4 --minWorkers=1 | 382 files; 6,137 passed; four existing TODOs |
| Mounted missing-consumer RED | TERMINAL_E2E_PORT=49127 playwright test e2e/brain-native-suite-control.spec.ts --project=desktop --workers=1 --retries=0 --grep='— en' | Expected structure membership remained empty on the old shell |
| Mounted responsive matrix | TERMINAL_E2E_PORT=49127 playwright test e2e/brain-native-suite-control.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 | Six passed; all three viewports x EN/ZH; no retries |
| Typecheck | next typegen; tsc --noEmit, after the dev server stopped | PASS, exact result retained in local log and source handoff |

Native kernel parity uses identical synthetic input/settings with the real computeSuite for Structure Core and RSI Ultimate. Default parameter round trips cover every canonical suite. Renderer entitlement testing retains a locked essential module on free tier. No event strength or geometrical agreement is represented as predictive accuracy.

## Debugging findings retained

The new tests exposed an invalid initial assumption: numeric step is a UI increment, not a grid anchored at min. Trend defaults 2/4/8/3 do not lie on min 0.1 plus step 0.5. Source inspection of NumberField showed finite range clamping without quantization. The validator follows that actual contract; an explicit test accepts an off-grid manual value. Metadata was not changed to make the test pass.

The first responsive candidate run passed desktop/tablet but failed both phone label assertions. The real renderer intentionally suppresses Smart S/R chips below 2.5px/bar. Phone screenshots showed correct price-level geometry. Tests now observe actual level lines at all sizes, preserve larger-view label assertions, and prove a false module switch removes the real geometry. No density/UI code changed.

A concurrent dev-generation typecheck observed a truncated .next/dev/types/validator.ts. Sequential type generation after browser shutdown restores a valid generated file; no product source or dependency changes were made to hide that failure. Package and lock hashes were preserved.

## Evidence locations and limitations

Screenshots and hashes: terminal/docs/pr-crops/cmx-native-suite-control-20260924/EVIDENCE.json. Synthetic OHLC, fixture entitlement, and model/state transport are explicitly mocked. The actual chart, callback, command translator, settings store, compute and rendering are real. Fixture page quote context may differ from the synthetic chart series; this is not a market analysis example.

Logs include the existing Vite CJS deprecation and development-only analytics credentials absence. These are not new product failures. GitHub reported existing default-branch dependency advisories on push; this slice did not change dependencies and makes no security-clean claim.

## Boundaries and remaining work

No change to useChartBus, indicator host/types, ChartPanel, BrainWidget, workflow presets, datasets, model/provider routes, permissions, alerts, replay, or production signals. #597 owns relevant context/range work; #606 owns workflow composition/undo; #607/#675 own host work; #654 owns startup changes. The intended shell block was disjoint in the current patch census.

Before release: independent exact-head review, concluded required CI, current-source compatibility, then the existing git-gated deployment and real user-path proof. Source tooling being callable is not evidence a real model selects correct fields. The next environment slices must add governed discoverable instrument semantics, exact pane/revision/viewport observations and reliable effect receipts while reconciling #597 rather than recreating it. Historical knowledge-time parity and research/Prophet promotion remain separate gates.
