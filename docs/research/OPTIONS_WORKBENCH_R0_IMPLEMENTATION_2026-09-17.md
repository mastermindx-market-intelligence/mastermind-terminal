# Options Workbench R0 Implementation Plan

**Goal:** Correct price alignment and continuously admit live replay frames in the existing Surface workspace.
**Spec:** Terminal issue #603 and the Chairman-approved Options Workbench recovery design (17 September 2026).
**Architecture:** Keep HeatSeries, the shared ReplayProvider/reducer, and flowClientCache as the existing owners. No new pricing kernel, history store, data collector or runtime. This is a bounded first recovery slice, not feature-parity completion.
**Stack:** TypeScript, React 19.2.4, Lightweight Charts 5.2, Vitest and Playwright on the pinned lockfile.
**Base:** 75c22083249e7a1529be3d6baf819b9ad5ea509f.
**Procedure:** Mastermind 8b231e8267f09cfb002ed3e87bec14906dce1720 (Skillpack 1.0.1 / bootstrap 1).
**Carrier:** claude/options-workbench-r0-replay-20260917-sol-001 under Terminal #603.

## Constraints
Preserve #591/#592, #598/#599 and Macro #6604; do not edit their owned paths. No vendor code/assets, licensed payloads, secrets, source-cadence changes, scoring changes or new dependencies. Dark Terminal, existing metric colors and EN/ZH controls remain intact. Source-path evidence is not production proof. Work only in this isolated worktree; never the shared checkout.

## Task 1 — Render real price intervals
Files: terminal/lib/heatSeries.ts; terminal/lib/__tests__/heatSeriesGeometry.test.ts; browser evidence under terminal/e2e/.
Interface: HeatSeries.renderer().draw(target, priceConverter), unchanged.
- [ ] Run the existing heatSeries/replayEngine tests before production edits.
- [ ] Exercise the actual HeatSeries renderer against a recording raster target. For bands [99.5,100.5], [100.5,105.5], [105.5,114.5], a linear price converter must paint the middle value at price 102, not the bottom value.
- [ ] Demonstrate failure on the original source; include uniform, inverted, nonlinear and unprojectable-boundary cases.
- [ ] Keep cached numeric time interpolation; draw each cached raster row between priceConverter(boundaries[row]) and priceConverter(boundaries[row+1]). Reject null/non-finite/zero-height geometry. Never uniformly stretch nonuniform price intervals.
- [ ] Run original and new suites, typecheck, then actual browser chart alignment at different pixel ratios. Record failures and exact source identity.

## Task 2 — Refresh once per shared replay owner
Files: existing surface replay context/view/pane, replayEngine, flowClientCache, and focused tests.
- [ ] Mount the real provider/view with controlled HTTP responses and timers; prove a growing same-root index is not admitted by the original source.
- [ ] Reuse the existing fetch cache with an explicit awaited refresh; retain in-flight deduplication rather than invalidating active requests.
- [ ] Let the existing provider load/refresh the index once for its group. Preserve a paused timestamp when frames grow or earlier frames are inserted; reset only on root/session identity changes. A layout change must not reset playback.
- [ ] Cancel timers/listeners and reject obsolete requests on identity change/unmount. Failures must not falsely grant live status. Historical selection must not load today's index.
- [ ] Prove same-root advance, paused cursor, same-minute revision, date rollover, out-of-order completion, archive and unmount behavior in mounted tests and the served fixture journey.

## Release and proof
- [ ] Narrow suites plus full typecheck and applicable responsive EN/ZH browser evidence.
- [ ] Preserve a pushed candidate and exact evidence. Obtain independent review; no self-certified production acceptance.
- [ ] Use the existing canonical release preflight/deploy path only after its gates. Production proof must show an advancing real session and correct price alignment, or record the exact remaining gate.

Direct initial execution reason: PRINCIPAL_JUDGMENT / CRITICAL_PATH_SHORTCUT — turn source-derived counterexamples into real component failures before freezing a wider worker packet. No worker or Executive START is implied.

## Continuation boundary
The failing reproduction suite and 18 synthetic browser captures are preserved under `docs/evidence/options-workbench-r0-20260917/`. Production modifications are platform-held and no source correction has landed. See its README for the navigation correction and exact do-not-retry boundary.


## Integration continuation — 17 September 2026

The shared provider/view/pane integration is now built on the same #608 carrier.
Its focused 167-test suite is green. The former missing-code hold is superseded
only by this verified source effect, not by a permission assumption. Read
`docs/evidence/options-workbench-r0-20260917/replay-integration/README.md` for the
current capability boundary and pending full regression/review/production gates.
Current procedure pin: `320f586126b7c82c843ef17612f12d40d20a42e0`.
Direct continuation reason: CRITICAL_PATH_SHORTCUT; incumbent source custody,
existing red tests and immediate shared-state integration make dispatch overhead
larger than the bounded direct repair. No worker START or source transfer is claimed.
