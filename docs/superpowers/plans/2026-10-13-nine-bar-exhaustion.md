# Nine-Bar Exhaustion & Reversal Intelligence — Implementation Plan

> Execute continuously under the current commission. Each phase saves evidence and advances to the next ready phase; a plan, test pass, PR, or merge is not the end state.

**Goal:** Deliver a mathematically honest, native, responsive nine-count study plus safely gated completed-nine alerts and a reproducible research foundation.
**Architecture:** One pure kernel feeds a Trend suite module. Existing catalog/settings/persistence/render/replay/alert infrastructure remains authoritative.
**Spec:** `docs/superpowers/specs/2026-10-13-nine-bar-exhaustion-design.md`
**Base:** `140894302f9e50637e1891799463d548c0c46c63`

## Task 1 — Kernel contract (TDD)

Files: create `terminal/lib/nineBarExhaustion.ts`, `terminal/lib/__tests__/nineBarExhaustion.test.ts`.

- [ ] RED: fixtures for index 4 first comparison, index 12 first completion, equality, interruption, opposite direction, >9, repeat cycles, multiple episodes, retro6 reveal/cancel, forming→final, correction, sparse bars, reverse/duplicate rejection, replay prefix parity, and stable IDs.
- [ ] GREEN: implement one-pass relation/state machine plus post-pass display eligibility; no DOM, chart, I/O, wall clock, or randomness.
- [ ] Verify deterministic equality and bounded 5k-bar performance.

## Task 2 — Native Trend module

Files: create module metadata/implementation and guides; modify suite metadata/runtime/catalog.

- [ ] RED: registry split/catalog/module rendering tests fail because `suite:trend/nine` is absent.
- [ ] Add fields/defaults and catalog copy/aliases.
- [ ] Adapt kernel results into labels, completion markers, tooltips, and SuiteEvents using directional tokens.
- [ ] Add bilingual guide content and confirm settings/picker/persistence are inherited without a second framework.
- [ ] Keep primitive counts under host caps and density-gate labels.

## Task 3 — Live finality and alert parity

Files: minimally extend suite input/context and ChartPanel suite calls; modify suite alerts/i18n/tests.

- [ ] RED: a forming ninth bar must not emit an event; the same finalized bar must emit exactly one stable event.
- [ ] Pass explicit forming-bar index through the current suite host and include it in memo identity.
- [ ] Add `nine_rising`/`nine_falling` to the curated catalog and bilingual copy.
- [ ] Verify daily sidecar/dry-run parity, confirmation timing, freshness floor, one-shot watermark, and duplicate suppression.
- [ ] Do not release 7/8 provisional alerts or claim full-market intraday scanning.

## Task 4 — Data census and preregistered research

Files: `docs/research/NINE_BAR_*`, optional scripts/tests under `research/` or `scripts/` that reuse point-in-time bars without creating a data plane.

- [ ] Record current provider/timeframe/session/retention/adjustment limitations from source.
- [ ] Freeze outcomes, horizons, baselines, overlap handling, training/holdout split, friction, and subgroup analyses before examining results.
- [ ] Build a reproducible event-study runner over admitted chronological data.
- [ ] Report null/negative findings and missing coverage; do not market vendor hit rates as Mastermind evidence.

## Task 5 — UX/browser proof

- [ ] Add focused mounted/e2e coverage for discover→enable→settings→tooltip→timeframe→replay→saved return.
- [ ] Run actual desktop/tablet/mobile, EN/ZH, and east/west directional-color checks.
- [ ] Because ChartPanel changes, refresh both repository evidence manifests/crops at the exact candidate head.
- [ ] Check pan/zoom/timeframe/symbol/replay/live stability and low-width decluttering.

## Task 6 — Release

- [ ] Run focused tests, typecheck, full Terminal unit suite, applicable e2e, and performance checks.
- [ ] Reconcile current protected master/open overlapping PRs; resolve rather than overwrite.
- [ ] Commit, push, open non-draft PR, label `merge-on-green`, enable native auto-merge, and inspect exact-head required checks.
- [ ] Verify merge commit, current master ancestry, git-gated deployment identity, and cache-busted live user path.
- [ ] Return implemented access path, exact variant, markets/timeframes, alert freshness, research findings/limits, commit/PR/CI/merge/deploy/browser evidence, and remaining obligations.
