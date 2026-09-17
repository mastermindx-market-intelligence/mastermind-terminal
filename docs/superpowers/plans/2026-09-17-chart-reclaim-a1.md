# Chart Reversal & Reclaim — A1 confirmation-time repair

> Execute with the existing source owner, TDD and independent release review. This is the first child of the approved charting upgrade, not parent-program completion.

**Goal:** A newly knowable RSI/Pulse/MACD divergence or RSI turn can be evaluated once at its confirmation bar, while the chart retains its original geometric anchors.
**Architecture:** Extend the existing SuiteEvent contract with an optional confirmation index. The existing alert evaluator, sequence evaluator and sidecar demo share one pure timing resolver. Keep existing detection math, chart anchors, runtime stores, provider data, entitlements and alert publication owners.
**Tech stack:** TypeScript, Vitest 2.1.9, Next 16.2.9, the existing IndicatorCanvas and Node alert sidecar.
**Spec:** Chairman-approved Market Sniper charting audit, 2026-09-17; current directive: take full leadership and deliver the upgrade.

## Authority and exact source
- Sol owns the approved end-to-end charting upgrade. Direct A1 work reason: PRINCIPAL_JUDGMENT (confirmation/migration semantics must be settled with the actual consumers).
- Skillpack: mastermindx-market-intelligence/Mastermind@8b231e8267f09cfb002ed3e87bec14906dce1720; compatible v1.0.1/bootstrap 1.
- Terminal base: a9b615f41fc44a6cc6a3588ef1aace26226b3eec. Operation: CHART-RECLAIM-A1-20260917-SOL-001. Branch: claude/chart-reclaim-a1-20260917-sol-001.
- Terminal source isolation follows this repository's AGENTS.md, in the ignored .claude/worktrees directory of its declared charting-app home. The installed mmx-workspace launcher is pinned to the separate Mastermind repository and cannot select Terminal; it is not repointed.
- The first preflight on the SSD administrative clone stopped at its ignore check with exit 1 before any branch/worktree creation. Exact branch/path absence was reconciled. That checkout and its pre-existing staged deletions were not modified.
- No child worker has been submitted, started or displaced for this operation. Executive connector is not exposed; this is attended source work, not claimed Executive dispatch.

## Global constraints
- No new technical score, strategy registry, signal database, or trading/promotion authority.
- Preserve i as the geometric event anchor. confirmedAt is an input-bar index, NOT a wall-clock publication/arrival timestamp. Source-close qualification remains with the input owner.
- Missing confirmedAt means a legacy event knowable on i. An explicit malformed, future, or pre-anchor confirmation fails closed.
- Creation floor, freshness and sequence order use confirmation. Legacy fire watermarks remain anchor-clock until a new fire writes clockVersion=2. Never redeliver a legacy-fired event by redating it.
- Persist state only through the current _se/_sq paths. Preserve legacy watermark interpretation on no-fire sequence state updates.
- Keep Pulse turns and MACD crosses already dated on their confirmation bars unchanged.
- Scope is no-creds unit/sidecar proof until required checks, independent review and production proof permit release. No customer alert is sent as a test.

## Task 1 — reproduce the real defect and freeze regression cases
Files: create terminal/lib/__tests__/suiteEventConfirmation.test.ts.
- [x] Test actual modules on every prefix of deterministic OHLCV; record each event's first appearance, not just settled history.
- [x] Test creation floors, malformed/future confirmations, legacy dedupe, v2 dedupe, confirmation-order sequences and expiry.
- [x] Run npm test -- lib/__tests__/suiteEventConfirmation.test.ts --maxWorkers=2 --minWorkers=1. Expect assertion failures against the unchanged implementation, never an import/setup failure.

## Task 2 — repair producer plus real consumers
Files: terminal/lib/indicator-canvas/types.ts; terminal/lib/suiteAlerts.ts; terminal/lib/suites/{rsix/rsiSignals,rsix/rsiDivergence,pulse/divergences,macdx/macdDivergence}.ts; ingest/suite_alerts.ts.
Interface: SuiteEvent.confirmedAt?: number. Export suiteEventTiming(event, barsT) returning {anchorI, confirmedI, anchorT, confirmedT} or null. Existing _se/_sq state gains optional clockVersion: 2 on new fire records.
- [x] Emit detector confirmation metadata without moving any chart anchors or changing mathematical settings.
- [x] Resolve indices and finite source timestamps once; refuse malformed metadata and unknown state-clock versions.
- [x] Use confirmation for creation/freshness/ordering, but interpret old lastFiredT against event anchors until its state migrates on fire.
- [x] Sidecar demo uses the same resolver. Its no-creds output must agree with the actual evaluator.
- [x] Rerun red tests, then original module/alert/sidecar tests. Adapt exact state assertions to the intentional clock-version field, not to weaker acceptance.

## Task 3 — prove the integration and retain continuity
Files: existing alert-sidecar receipt tests and this plan's evidence section; concise technical contract under docs/.
- [x] Feed actual module events through the real sidecar with only HTTP transport mocked; prove successful conditional persistence and no-duplicate reevaluation.
- [ ] Run typecheck and full unit suite, git diff --check, scoped diff review, and the repository's required release checks.
- [ ] Commit/push the exact carrier and obtain independent review. A draft/green PR is not production proof.
- [ ] Record source/PR/test/remaining-scope references in the existing Macro Agent OS owner. Keep TOI research and Terminal deployment gates intact.

## Parent continuation (not implemented by A1)
A2: cross-suite Reversal & Reclaim workspace, linked price/pane evidence, explicit developing versus confirmed states, relevant levels and original/current remaining R. A3: existing gap lifecycle and nested/wedge structure upgrades. A4: qualified owner-native discovery and independently evaluated options expressions. Do not duplicate Terminal #601 intraday data qualification, #600 release-preflight work, #597 feed status or TOI #7094.

## Evidence
Baseline: 346 tests passed across suiteModules, suiteAlerts and suitePresets at the exact base. No production changes or customer alert delivery occurred.

RED regression receipt: 25 tests, 21 expected assertion failures and 4 passing guards. All four delayed producer cases reproduced (RSI turn anchor 20 / confirmation 21; RSI divergence 100/105; Pulse divergence 134/139; MACD divergence 70/75). The final RED run had no import/setup errors. Source algorithms are still unchanged at this checkpoint.

### Material discovery: actual sidecar was bound to metadata, not computation
The transport-only integration test failed even after all 367 indicator/evaluator tests passed. `ingest/suite_alerts.ts` imported `getSuiteDef` from the metadata facade, cast it to the host runtime type, and the host skipped every module without a compute function. Result: a silently empty event stream. Two real-file/real-module/HTTP-only-mocked integration tests failed. The repair loads the existing `ensureSuiteRuntime` graph and awaits it at the existing sidecar/demonstration call sites. No duplicate runtime graph or algorithm is introduced; synchronous test-hook returns remain supported. This is part of A1's producer-to-real-consumer capability, not a separate unrelated refactor.

GREEN proof: full unit 334 files / 5,541 passed / 4 existing TODOs; typecheck passed; production-form bundle and four read-only real-input demonstrations passed. Detailed proof: docs/research/CHART_RECLAIM_A1_CONFIRMATION_CONTRACT_2026-09-17.md. No candidate deployment or customer notification has occurred.

Independent review was consumed: P2 non-monotonic source clock reproduced with four RED tests, repaired at the shared clock/input boundary; real malformed-file integration added. Full suite now 5,546 passed / 4 existing TODOs in 334 files. Exact source and PR remain the same carrier.
