# Options Workbench R2 — Terminal Scenario Contract

Date: 2026-09-18
Operation: `options-workbench-r2-scenario-terminal-contract-20260918-sol-001`
Parent: mastermindx-market-intelligence/mastermind-terminal#603
Macro producer: mastermindx-market-intelligence/macro#7306
Protected Skillpack: Mastermind `61a2ff79aba4e8a5685e779707ad5c4426cf5cc5` (1.0.1/bootstrap 1)
Terminal base: `1f56eae265bdbb69c60ce1c5b63dcea19f1f480e`
State: **BUILT_NOT_PROVEN** until review, CI, the later SurfacePane consumer, browser proof and production proof.

## Why this is a separate contract

The existing `SurfaceFrame` type is observed replay history: price rows × realized session timestamps. Macro #7306's `options.scenario_surface/v1` is a conditional model: one frozen information set evaluated across hypothetical price × later-time coordinates.

Those are different epistemic objects. The Terminal must not cast the scenario payload into `SurfaceFrame` and accidentally make modeled future columns look like observations.

`terminal/lib/scenarioSurfaceContract.ts` therefore introduces a pure, DOM-free consumer contract only. It owns no fetch key, cache, replay clock, persistence, publication or chart lifecycle.

## Capability

The adapter:

- validates schema `options.scenario_surface/v1` and product kind `conditional_price_time_scenario`;
- requires `observed_history=false` and `price_axis=scenario_not_forecast`;
- requires fixed-input inventory and sticky-strike assumptions rather than accepting a forecast masquerade;
- checks the horizon-major GEX/VEX/CEX matrix dimensions and rejects non-finite numeric cells;
- maps Terminal metric names without semantic aliasing:
  - Gamma UI `gex` -> source `gex`
  - Vanna UI `vanna` -> source `vex`
  - Charm UI `charm` -> source `cex`;
- transposes Macro horizon-major grids into the renderer's price-major layout;
- preserves metric-local zero-crossing arrays unchanged;
- preserves market/IV/OI source-clock identity;
- rejects an IV clock after the market observation and an OI vintage after the observation's ET date;
- derives future HH:MM columns in America/New_York from the observation + explicit horizons;
- fails closed when a horizon crosses into another ET date, because the current HeatSeries time anchor carries HH:MM within one session and would otherwise erase date identity;
- converts scenario `null` cells to `NaN` only at the HeatData boundary, making them transparent under the incumbent heat renderer instead of turning unknown into measured zero;
- reuses the incumbent `levelBands` geometry and HeatData type rather than creating another chart geometry contract.

## Quanted rendering relevance

The saved lawful Quanted renderer recon shows one combined visual field with realized columns to the left of NOW and model-field columns to the right. Its white zero-contour primitive explicitly skips cells at/before the current snapshot timestamp. That supports our architecture:

1. existing observed `SurfaceFrame` stays the realized-history owner;
2. this scenario contract stays a distinct right-of-NOW conditional field;
3. a later SurfacePane integration explicitly composes the two under one selected metric and shared replay context;
4. zero contours are drawn only over the scenario side.

This contract alone does **not** claim that the Quanted proprietary projection method is reproduced. Macro #7306 declares our assumptions: fixed OI, frozen sticky-strike IV, deterministic time roll-forward, scenario price axis, incumbent dealer-sign assumption.

## TDD evidence

Baseline before this slice:
- existing `surfaceContract.test.ts`: **93/93**
- TypeScript: exit 0.

New adapter RED:
- direct import failed because `scenarioSurfaceContract` did not exist.

GREEN after implementation:
- adapter contract: **8/8**.

PIT review RED:
- future `iv_observed_at` was accepted by the first validator.

PIT GREEN:
- future IV clock and future-date OI vintage are rejected.

Fresh final owner pack:
- `scenarioSurfaceContract.test.ts`
- `surfaceContract.test.ts`
- `heatSeries.test.ts`
- **132 passed / 0 failed**
- TypeScript `--noEmit`: exit 0.

Protected Terminal master remained exactly `1f56eae265bdbb69c60ce1c5b63dcea19f1f480e`; no scenario owned path exists there and no adapter dependency moved during this slice.

Evidence:
`docs/evidence/options-workbench-r2-scenario-terminal-contract-20260918/`.

## Frozen boundaries / next slice

This carrier must remain new-file-only relative to the incumbent Surface UI. It does not edit:
- `SurfacePane.tsx`;
- replay context/engine;
- flow cache;
- `surfaceContract.ts`;
- `heatSeries.ts`;
- Macro publication paths.

Therefore it cannot conflict with Terminal #608's release/review carrier.

After #608 and Macro #7306 are accepted, the next UI slice may import this adapter into the existing SurfacePane and compose:
- realized observed field left of selected NOW;
- conditional scenario field right of NOW;
- metric-local zero contours right of NOW only;
- explicit scenario/model label and source clocks;
- existing selected expiry scope;
- existing shared replay and price-axis owners.

No user-visible Quanted parity, production deployment, live freshness, measured participant inventory or predictive edge is established by this contract-only slice.
