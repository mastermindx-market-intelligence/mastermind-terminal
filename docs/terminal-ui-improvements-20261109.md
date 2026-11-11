# Terminal UI improvements — 9 November 2026

## Mission and authority

Current Chairman assignment: find and implement visible UI defects and useful upgrades across Terminal, using current Paper designs as evidence; publish qualified changes into the existing automatic release flow and continue other fixes while CI/merge queue runs.

Procedure pin: Mastermind `ff6d5ab67c3535056d69f603fac0d95c058baad8`, Sol skillpack v1.0.1. Initial Terminal protected master: `e4329a7d265e1d2405cad4e87ead9b7797d60e61`. Shared design doctrine pin: Macro `536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136`.

Authoring carrier: GitHub-native branch/file/tree/commit/ref APIs on this isolated branch. Local source snapshots are for candidate assembly and validation only; no Studio checkout, live production tree, or other writer is acquired. Root session owns implementation, source self-review and release qualification. Direct implementation reason: LOWER_TOTAL_OVERHEAD for small interaction fixes; native advisors provide separate UI/design judgment without source writes.

## Completion ruler

For each accepted fix: reproduce or identify the source-bound user-visible defect; preserve existing data/authorization/navigation owners; implement the smallest coherent correction; run focused checks and relevant browser interaction/visual proof; publish a Ready PR with exact head and evidence; request permitted existing automatic release only after checking holds, conflicts, actual rules and current checks. Record queue/merge/production as distinct facts. Pending CI does not stop independent source work. Never weaken CI or release controls.

## Work tree

| Node | Outcome | Acceptance | State |
| --- | --- | --- | --- |
| UI1 | Recover current source, Paper references and overlapping work | Exact source pins and correct current/reference/rejected design classification | implementation_complete |
| UI2 | Repair the first bounded set of defective controls | Observable state, keyboard/touch access, focus and readable responsive layout with affected checks | in_progress |
| UI3 | Publish UI2 and request existing auto release | Exact-head PR/diff/validation; normal protected automatic merge request; no hold removal or bypass | proposed |
| UI4 | Repair the next independent UI gap while UI3 runs | Separate paths and useful consumer proof; preserve earlier pending release | proposed |
| UI5 | Consume release results and verify shipped behavior | Exact merged/deployed source and relevant live behavior; do not equate queued/green with shipped | proposed |

## Scope boundaries and known adjacent work

Do not duplicate active PRs #1361 (Top Picks navigation identity), #1352 (portfolio navigation recovery), #1353 (profile settings error isolation), or #1346 (alert bulk-confirmation inventory). Reconcile overlapping paths before selecting a new fix. Existing explicit holds remain.

Paper Terminal file: `01M3NSZGE8JWN2EZCSF0DT05RM`; design map page `p-R-0`. D06 workspace `p-17-0` contains studies whose acceptance is not established. Account/settings page `p-10-0` includes rejected entire-pane redesigns; do not port those. F01 shared-shell file `01M6Y2GT8S3YP4TK052PPESZEC` is a review-pending candidate, useful design intent rather than accepted production law. Reuse Terminal's current tokens and primitives.

## Verification and continuity

Initial state: source investigation in progress; no code or browser pass claimed. No GitHub approval, merge, deployment or production acceptance claimed. This plan is versioned implementation continuity, not an Agent OS/runtime record or a new queue. PLAN_NOT_ORG_LINKED: no existing workstream was identified in the bounded initial source census. Keep milestone evidence with each owned PR and this source plan; continue after saving.

## UI2 source milestone

Chart quick settings now use native keyboard-operable controls, observable selected/expanded state, Escape/focus-return behavior and a bounded scrollable popup with coarse-pointer targets. More settings transfers focus to its persistent gear trigger before opening the existing full dialog. ETH/chart-engine/data behavior is unchanged; PR #1268's only ChartFrameBar hunk (ETH aria-pressed) is disjoint.

Focused tests: 56 passed across chartQuickSettings, chartSettingsUi, chartFrameBarClock and chartSettingsHydration. Candidate ESLint has exactly the same six existing ChartFrameBar findings as the immutable base; both changed test files are clean. Full typecheck initially exhausted the default 2GB heap, then identified omitted validation-snapshot fixtures; these dependencies have been restored and the 4GB rerun is in progress. No typecheck pass claimed yet.

Browser proof remains pending. The attached Chrome extension is blocked by another open extension UI; no attempt to control or bypass it is made. Scratch Playwright browser download failed with a truncated archive. An isolated test-runner route is being qualified. No merge/release request has been submitted yet.

Next independent source gap: IndicatorSettings declares modality without native focus containment; preserve live-save versus Cancel semantics. The broad Options sort-header and ticker-action work is already in PR #1248; do not duplicate it. Four remaining Screener ticker cells may be addressed separately after reconciliation.

## UI2 verified / UI3 release qualification

PR #1363: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1363. Product source `c011b921112b77f4a05a31fd0f3b8006aff3b554` passes full TypeScript validation, 56 focused unit tests, four real-route desktop/tablet keyboard tests and two viewport/touch assertions. Changed-state screenshots and detailed proof are committed under docs/pr-crops/terminal-ui-20261109. No production pass claimed.

Current source is mergeable; the protected base advanced only through #1361's independent navigation identity fix. No held label or actual review outstanding was observed in native PR state. Protected branch summary and active queue ruleset 24411653 are observable; the classic protection-detail endpoint returned integration 403 and is not retried through another reader. No review waiver or absence of classic rules is inferred from that denial. Native checks, reviewDecision and queue/autoMergeRequest are inspected for this exact PR before one normal head-leased enrollment request; no admin or direct merge.

UI4 is in progress on separate branch sol/web-terminal-indicator-dialog-20261109-c1 based on 8390cc4ad41b1c0773e979198c80e742852c01dc. The indicator dialog now has a candidate native modal lifecycle with named controls; 63 focused tests pass, with real browser proof still to do. Next: complete #1363 Ready/normal auto enrollment, then continue UI4 while hosted checks run.
