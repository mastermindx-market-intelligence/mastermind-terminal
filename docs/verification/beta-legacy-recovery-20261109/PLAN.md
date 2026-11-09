# Beta embedded-page recovery - 2026-11-09

Parent: `docs/verification/beta-shell-sweep-20261109/PLAN.md` and the Terminal Experience masterplan. This is the next independent phase of the Chairman-authorized beta-wide bug sweep, not a new control plane.

Operation: `beta-legacy-recovery-20261109-astra-01`. Original managed branch: `sol/web-beta-legacy-recovery-20261109-astra-01`. Protected base: `f2aa1e0cb27d459149f59d3b24d98cd6e2e8389f`. Mastermind procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`; applicable source blobs unchanged at recovery. Macro design pin remains `536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136`.

## Outcome
An embedded market/research page must recover from temporary service trouble without crashing the shell or incorrectly requiring a full refresh. A frame whose admission expired or whose version was rejected must not hide that failure with late READY messages. Retry must re-admit the exact current route in a fresh generation. Existing origin, source, protocol, context and generation checks remain mandatory.

## Work and evidence
1. Reproduce late READY after a deadline/version rejection, plus transient status failure on tab return, using the mounted real host and existing browser-I/O test seams. These remain hypotheses until a failing-before test proves them.
2. Repair the existing frame lifetime and bounded status request; do not create another navigation, authentication, source or retry owner.
3. Run related unit/contract tests, typecheck/lint, and desktop/tablet/mobile browser recovery cases. Preserve raw-response redaction, source pins and URL/history behavior.
4. Publish one coherent Ready PR, use mandatory CI/protected queue, then beta deploy and public-browser proof after merge. Continue the parent sweep while external checks run.

## Custody and non-goals
The acquire response was unqualified; same-operation publisher status and mmx-workspace status reconciled a clean registered workspace at the exact base with no active acquisition process. No acquisition was replayed.

#1364 is already merged; its beta deployment is separately in progress. #1369 owns company snapshot/loading changes and has fresh CI; do not duplicate or replace it. #1352/#1353 own navigationRecovery/Settings, and #1244 owns intelligence integration. This phase edits neither those paths nor authentication, entitlements, market data, release/CI policies or trade logic.

Execution reason: LOWER_TOTAL_OVERHEAD for a bounded principal-owned mounted-component repair using the existing tests. No worker was dispatched and no independent review is claimed.

## Reproduction and overlap reconciliation
All eight additional mounted-host regressions fail on the protected base while the existing 23 pass. The exact patch and test result are retained alongside this plan. Before product changes, live census found #1384 (head a5a7c9ccdeb1efa928ca6f79083dbb564c607799) already owns failed-attempt retirement in this component. Its source must not be duplicated or overwritten. #1276 remains explicitly held; none of its held work was adopted.

The new patch is diagnostic evidence, not an active test-suite change or a product repair. The original test path was restored byte-for-byte after preserving the patch. The foreground revalidation path still merits qualification: HTTP 503 versus version change, overlapping visibility requests, a hanging response and cancellation on navigation. Route these findings to #1384 without claiming its candidate failed tests that were run only on the protected base. Continue independent live-beta route/interaction probes while that carrier progresses.
