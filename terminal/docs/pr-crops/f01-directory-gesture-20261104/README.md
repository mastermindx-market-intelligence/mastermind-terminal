# F01 directory: deliberate backdrop dismissal

## Proven scoped behavior

A real drag that starts in the directory and ends on the backdrop used to close the dialog because the browser retargeted the resulting click to the dialog. The unchanged production component at parent `b14436dd7b9c1296d17455c89f63960c774ab9be` failed the new real-input case in all three Chromium projects.

The existing component now records one primary pointer gesture. Both endpoints must fall outside the dialog bounds, and its completed click must belong to that gesture. Cross-boundary drags, interrupted capture, cancellation, other pointers, secondary buttons, inside-edge activation and clicks without a completed pointer gesture leave the task open. Implicit touch capture release after pointerup keeps a completed gesture available for its click. Close and the existing Escape/IME path retain their own dismissal behavior.

The local ref is cleared on cancellation, closure, reopening and cleanup; no global listener, timer, storage key or lifecycle owner was introduced. Existing focus restoration, query/category retention, ordering, four-identity facet, 48-result recovery, route/access ownership and search handoff remain in place.

## Evidence sequence

| Stage | Actual result | Qualification |
| --- | --- | --- |
| Baseline browser | 0 passed / 3 failed | New cross-boundary-drag case on unchanged parent component at 1440, 820 and 390px |
| Full corrected browser suite | 37 passed / 2 intentional skips / 0 failed / 0 flaky | Before the final capture-loss guard; the two smaller-viewport modified-new-tab skips are existing |
| Final affected browser rerun | 3 passed / 0 failed / 0 flaky | Final exact source, both drag directions, deliberate mouse/touch dismissal, valid return focus and retained context on reopen |
| Final component + neighbor suites | 95 passed / 0 failed | Includes interrupted capture, right/secondary pointer, pointer mismatch, inside edge and consumed gesture outcomes |
| Final scoped ESLint | Pass, zero warnings | Three changed source/test files |
| Final TypeScript | Pass | `tsc --noEmit --incremental false` |

`RESULTS.json` and `SOURCE_INPUTS.json` bind commands, times and final source hashes. `BROWSER_CASES.json` records every browser case/result, observation and attachment digest without duplicating inline image payloads. `raw-reports.zip` retains the actual runner reports, logs, process records, baseline failure screenshots and baseline error context. Optional local Playwright trace archives are catalogued by digest but excluded from that compact archive; no trace review is claimed.

The three `*-retained.png` captures come from the final affected rerun after both real drag directions. Native selection highlighting is an outcome of the gesture, not an image edit. Self-QA checks the visible modal, retained options query, selected facet, full exact paths, readable phone list and lack of clipping. The Paper interaction reference is maintained separately in the F01 source carrier on exact board `72OR-0`.

## Reproduction and limits

Use the repository's installed dependencies and normal responsive Playwright runner. The process receipts contain exact commands. The browser run uses `MMX_SHARED_SHELL=1`, the incumbent development guest seam and a controlled AAPL manifest, on owned port 3658. Node 26/jsdom uses `NODE_OPTIONS=--no-experimental-webstorage`. No production identity, premium entitlement or remote provider data is qualified. Desktop mouse drag is exercised at every viewport; intentional touch dismissal is exercised in the tablet/mobile projects. This is not an OS-level touch/assistive-technology certification.

The inherited development chunk 404 / ERR_ABORTED observations are retained, not hidden. No new uncaught page error was observed. Other engines, actual Chinese OS IME, screen-reader behavior, domain/Brain integration and the complete 86-case programme remain unqualified. Candidate.4 remains operative; candidate.5 is proposed, not adopted. Original held Paper atlas/Readme effects remain unresolved.

The previous-head hosted CI is a separate result. Its two hard failures were traced to an external widget script in the thesis fixture; the scoped repair and 84 passing thesis cases are recorded in [the companion CI evidence](../f01-ci-widget-fixture-20261104/README.md). Local green does not establish hosted green. This draft does not authorize Ready, merge, enqueue, held relabel or deployment.

Managed operation: `f01-directory-focus-correction-20261104-c4`. Existing author/publisher retained. Protected procedure pin: Mastermind `7a52808e5761739a08b279dddba0d0c88e13224d`. Adjacent #1244 remains `624dbc0ac22ecdaa6d1bd580d5221da939c5e5a9`; this change does not adopt or rewrite it.
