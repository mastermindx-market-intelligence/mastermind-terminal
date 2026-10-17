# Nine-Bar Exhaustion & Reversal Intelligence — Implementation Plan

> Execute continuously under the current commission. Each phase saves evidence and advances to the next ready phase; a plan, test pass, PR, or merge is not the end state.

**Goal:** Deliver a mathematically honest, native, responsive nine-count study plus safely gated completed-nine alerts and a reproducible research foundation.
**Architecture:** One pure kernel feeds a Trend suite module. Existing catalog/settings/persistence/render/replay/alert infrastructure remains authoritative.
**Spec:** `docs/superpowers/specs/2026-10-13-nine-bar-exhaustion-design.md`
**Procedure pin:** `Mastermind@a53062ff18df71869a1363d35a99347f06d9a3fb`, bootstrap major 1.
**Protected base:** `mastermind-terminal@f55b317adafed6409e538eb0ffd5d0447855bed2`.
**Carrier:** `sol/nine-bar-exhaustion-20261015` in `/Volumes/Mastermind/worktrees/nine-bar-exhaustion-20261015`.
**Accepted code/source head:** `bbbb0f8526c54f59e2ab0b980495f31336f18169`. The feature was de-stacked from open chart-engine PR #999 onto current protected master; #999 is not a release dependency.


## Verified execution state — 2026-10-15

- Pure kernel, native Trend module, bilingual settings/guides, final-bar semantics, completed-nine alerts, research runner, and responsive browser path are implemented.
- Local gates: production build exit 0; 188/188 focused acceptance tests; 692/692 Vitest files with 11,528 passed and 4 todo; TypeScript exit 0; feature-owned ESLint 0 errors/0 warnings.
- Browser gates: nine-bar 6/6 user journeys with 18 crops; inherited chart-context 30/30; chart-chrome 4/4; options-axis 5/5; all zero-retry local-fixture runs.
- Research receipt: 39,919 bars, 1,078 primary nines, 229 matched primary events; holdout evidence does not support predictive promotion, so the released interpretation remains descriptive.
- Open release frontier: independent code review, push/PR, required CI, merge, deployment identity, and cache-busted live user-path verification.

## Task 1 — Kernel contract (TDD)

Files: create `terminal/lib/nineBarExhaustion.ts`, `terminal/lib/__tests__/nineBarExhaustion.test.ts`.

- [x] RED: fixtures for index 4 first comparison, index 12 first completion, equality, interruption, opposite direction, >9, repeat cycles, multiple episodes, retro6 reveal/cancel, forming→final, correction, sparse bars, reverse/duplicate rejection, replay prefix parity, and stable IDs.
- [x] GREEN: implement one-pass relation/state machine plus post-pass display eligibility; no DOM, chart, I/O, wall clock, or randomness.
- [x] Verify deterministic equality and bounded 5k-bar performance.

## Task 2 — Native Trend module

Files: create module metadata/implementation and guides; modify suite metadata/runtime/catalog.

- [x] RED: registry split/catalog/module rendering tests fail because `suite:trend/nine` is absent.
- [x] Add fields/defaults and catalog copy/aliases.
- [x] Adapt kernel results into labels, completion markers, tooltips, and SuiteEvents using directional tokens.
- [x] Add bilingual guide content and confirm settings/picker/persistence are inherited without a second framework.
- [x] Keep primitive counts under host caps and density-gate labels.

## Task 3 — Live finality and alert parity

Files: minimally extend suite input/context and ChartPanel suite calls; modify suite alerts/i18n/tests.

- [x] RED: a forming ninth bar must not emit an event; the same finalized bar must emit exactly one stable event.
- [x] Pass explicit forming-bar index through the current suite host and include it in memo identity.
- [x] Add `nine_rising`/`nine_falling` to the curated catalog and bilingual copy.
- [x] Verify daily sidecar/dry-run parity, confirmation timing, freshness floor, one-shot watermark, and duplicate suppression.
- [x] Do not release 7/8 provisional alerts or claim full-market intraday scanning.

## Task 4 — Data census and preregistered research

Files: `docs/research/NINE_BAR_*`, optional scripts/tests under `research/` or `scripts/` that reuse point-in-time bars without creating a data plane.

- [x] Record current provider/timeframe/session/retention/adjustment limitations from source.
- [x] Freeze outcomes, horizons, baselines, overlap handling, training/holdout split, friction, and subgroup analyses before examining results.
- [x] Build a reproducible event-study runner over admitted chronological data.
- [x] Report null/negative findings and missing coverage; do not market vendor hit rates as Mastermind evidence.

## Task 5 — UX/browser proof

- [x] Add focused mounted/e2e coverage for discover→enable→settings→tooltip→timeframe→replay→saved return.
- [x] Run actual desktop/tablet/mobile, EN/ZH, and east/west directional-color checks.
- [x] Because ChartPanel changes, refresh both repository evidence manifests/crops at the exact candidate head.
- [x] Check pan/zoom/timeframe/symbol/replay/live stability and low-width decluttering.

## Task 6 — Release

- [x] Run the production build, focused tests, typecheck, full Terminal unit suite, applicable e2e, and performance checks.
- [x] Reconcile current protected master/open overlapping PRs; resolve rather than overwrite.
- [ ] Commit, push, open non-draft PR, label `merge-on-green`, enable native auto-merge, and inspect exact-head required checks.
- [ ] Verify merge commit, current master ancestry, git-gated deployment identity, and cache-busted live user path.
- [ ] Return implemented access path, exact variant, markets/timeframes, alert freshness, research findings/limits, commit/PR/CI/merge/deploy/browser evidence, and remaining obligations.
