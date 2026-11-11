# Reversal & Reclaim — paired price/RSI evidence

**Outcome:** With one explicit RSI Divergence setting, a trader can inspect the same two anchors on price and RSI and see when the pattern became detectable. This is explanatory chart geometry, not a new signal/scientific authority.
**Authority:** Chairman-approved full charting upgrade, Sol source owner. Skillpack Mastermind@8b231e8267f09cfb002ed3e87bec14906dce1720. Operation CHART-DIVERGENCE-PRICE-LINKS-20260917-SOL-001, branch claude/chart-divergence-price-links-20260917-sol-001, base Terminal75c22083249e7a1529be3d6baf819b9ad5ea509f.

## Source custody and boundaries
This is an independent additive display change. A1 #602 retains event-clock/runtime/release ownership; no A1 source is copied or changed. #606 retains workspace composition/undo. #604 remains frozen for its exact denied position-card refinement: this operation does not modify position drawing, its sizing/placement, i18n entries, or its tests. Both existing native reviews/CI remain their owners.

## Contract and implementation
Extend the existing IndicatorCanvas primitive base with optional coordinateSpace: price. Absent is the owning suite's native y-space, so all existing modules retain their behavior. A pure render-bundle projection helper partitions the already-capped primitives; it never recomputes signals or creates another event tape. Host caps, entitlements, module visibility and cache identity remain the owners. The existing ChartPanel pane and price-clip paths supply the appropriate coordinate mappers. Price links clear with hidden module/suite or a maximized oscillator pane; they do not leak through the wrong axes.

RSI Divergence preserves the existing detector and normalized anchor prices. The explicit `Price Links` option defaults off, so no saved chart silently gains drawings. When enabled, each displayed divergence contributes its paired price connector, the existing oscillator connector, and a small price label on the CONFIRMATION bar (`RSI Div · +5`) rather than backdating detection to the pivot. Tooltip contains pivot span, source confirmation date/time, delay and price endpoints. The source bar may still be forming; wording states detected-after-later-bars rather than claiming exchange-close or permanent price reversal.

Use the existing up/down palette (including east-flip), dashed hidden-divergence style, current showLast/fan caps, pointer-events:none and delegated existing tooltip owner. No new chart legend, state store, separate overlay renderer or branded clone. On-chart source coordinates are original OHLC, even when display candles are synthetic. A later accepted #606 integration can explicitly enable this option in the workflow recipe; do not alter its currently reviewed carrier merely to obtain a default.

## Test-first sequence
1. Actual RSI module tests: price/oscillator anchors agree, no links before confirmation on every prefix, display option changes no events/native prims, toggle off unchanged, current chart inputs respected, malformed prices withheld.
2. Pure projection tests: no coordinate leakage, original bundle/metadata unchanged, entitlements/host caps preserved through the real host.
3. Real browser data-route fixture: actual chart + RSI price links in correct clips at desktop/tablet/mobile EN/ZH, no pointer interception, settings off removes the overlay, selected scenario first-availability verified by unit prefix tests. Fixture has synthetic prices and is only UI/causality proof, not performance proof.
4. Full unit/typecheck/copy guard, current-source exact diff and independent review. Native checks + canonical deployed browser proof remain owed.

## Acceptance limits / continuation
No new numerical confidence, trade permission or validation status. This is one explanatory capability in the parent upgrade. Price reaction after divergence, pending trigger states, gap/zone lifecycle and validated occurrence ranking remain with their declared subsequent slices and scientific owners. Do not claim a first-availability metadata fix closes live source qualification.


## HELD partial checkpoint — not releasable
The actual module and pure projection work is partially implemented: the six price-link tests and three projection tests pass, alongside 263 existing module tests. One existing strict hygiene test fails because the module formats a supplied source time with `new Date`. The renderer must own that presentation, but it has NOT been changed. ChartPanel has NOT been wired to the two coordinate projections; enabling the new option in this partial candidate is not accepted product behavior. Default is off. No browser, full-suite, independent-review or production acceptance is claimed.

The exact subsequent timestamp-presentation repair operation was denied by the tool safety layer before execution. Same-carrier readback confirmed no effect: `new Date` remains in rsiDivergence.ts; `utcEpoch`/tooltipRowValue and renderer changes are absent. Freeze that operation and do not retry, re-home, encode, or delegate the denied edit through another route. This commit only preserves the earlier work/tests and this factual checkpoint. No customer/production state was changed.

Next lawful action after a material tool/permission invalidator: reconcile this original carrier, resolve the source-time presentation contract without weakening hygiene, then wire and test the existing price/native render paths. Do not reproduce #604's denied position-card refinement, change #606's reviewed workspace source, or treat partial producer code as a delivered chart feature. No worker was dispatched or claimed STARTED.
