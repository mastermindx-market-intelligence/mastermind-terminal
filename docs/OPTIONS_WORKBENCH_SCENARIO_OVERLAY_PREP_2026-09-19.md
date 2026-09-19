# Options Workbench R2 Scenario Overlay Prep — 2026-09-19

Operation: `options-workbench-r2-scenario-overlay-prep-20260919-sol-001`

Parent program: Terminal issue #603.
Dependency carrier: Terminal PR #640 at `df440cac848ffbb973ed6100579f0603ca3c5e19`.
Protected procedure: Mastermind `733389933e605e508517732fb6c69b6c18b7fef6`,
Skillpack 1.0.1 / bootstrap 1.

## Capability delta

Adds a pure presentation bridge over #640's already-proven observed+conditional composition.
It emits:
- scenario heat bars only to the right of NOW;
- zero-contour line segments from NOW into future horizons;
- explicit conditional-model / not-forecast / assumption-signed provenance metadata.

Multiple zero crossings are paired only between adjacent horizons using an order-preserving
minimum-distance match. The result deliberately carries
`continuity=adjacent_horizon_only`; it does not invent persistent branch identity.

## Source boundary

This lane does not edit `SurfacePane.tsx`, replay/index/cache owners, `heatSeries.ts`,
`surfaceContract.ts`, fetch/store code, Macro pricing/Greek code, or publication/deployment.
It therefore stays source-disjoint from Terminal #608 while that carrier awaits fresh review.

The current protected Terminal master is `4b19a698bd4afefc58cdd024a05920270f836dbf`.
Movement since #640's integrated master `82bee14ba3d7812b78fedd92b351318b575a9a81`
does not touch the shared HeatSeries/Surface-contract/package/tsconfig dependencies used here.
The #640 remote head remained `df440cac...` during implementation.

## TDD and proof

Discriminating RED: the new overlay test could not import
`@/lib/surfaceScenarioOverlay` because the module did not exist.

Final local proof:
- overlay-specific tests: 3/3;
- scenario contract + composition + overlay + Surface contract + HeatSeries + session/theme pack:
  196/196;
- TypeScript `tsc --noEmit`: pass;
- `git diff --check`: pass.

## Held gates

This is BUILT_NOT_PROVEN and not user-visible.
No Quanted parity, browser acceptance, production freshness, forecast edge, or measured
participant inventory is claimed.

After #608 and Macro #7306 clear their independent source/release gates, the next product slice is
the small incumbent SurfacePane splice: render observed history left of NOW, consume this overlay
on the right, draw selected-metric contours only on the scenario side, show EN/ZH model/provenance
labels, then run responsive real-route browser proof.
