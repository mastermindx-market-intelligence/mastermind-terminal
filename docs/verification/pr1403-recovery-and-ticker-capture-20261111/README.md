# PR #1403: repair recovery synchronization and earn ticker evidence

Natural run `42971078823` passed the repaired hosted routing row and exposed two remaining failures: the ticker packet had an old TerminalShell source lock, and the short-screen Chinese recovery test sent READY to the old child. The original watchlist behavior and proof are retained on protected `74c007125129090cc762f2bc4b1b152123326444`.

## Exact failure and source repair

The retained serial artifact `13834489568` has ZIP SHA-256 `6e04e16fc988166d1262ecd8a577f1b60527c6448077fcbfe9f9f882a344236e`. Its failed tablet trace shows READY on old generation `6492c94b-e45c-4dd1-a7fd-f2cce309be8f` ending at 68395.964ms; the new held child was fulfilled at 68457.144ms. The final initialized child had generation `c0a65fa6-1a03-4526-a962-297d5424c13e` and was still waiting for READY. The selected canonical calls and snapshots are retained here.

The test now waits for a nonempty replacement generation, reacquires that child, verifies its initialization, focuses the outside control and sends READY once. Existing visibility/focus assertions and timeouts remain unchanged. Product recovery code is untouched.

## Genuine ticker packet path

The existing serial job adds one bounded capture after its ordinary matrix command and before opt-in qualifications. It directly runs the existing full ticker spec with both packet selectors, all three projects, one worker and zero retries. The step budget is 15 minutes; the existing enclosing 60-minute cap, lane ports, shard topology, browser ownership and three artifact uploaders remain unchanged. The old full capture measured about 554 seconds; that is a sizing input rather than a timing guarantee.

A receipt observer records actual checkout, source/runtime identities and prior packets, and requires every admitted source byte to match its Git blob at that checkout. Browser revision metadata is explicitly labeled configuredChromium. Execution/structural qualification does not claim visual acceptance. It preserves every old packet byte, removes only the ten selected images before the command to establish freshness, and leaves the old EVIDENCE.yml untouched. It qualifies exactly 14 passing cases plus seven authored project skips, zero failures/flakes/retries, ten fully decoded fresh PNGs, stable sources/other packets and a closed lane port with no dev lock after Playwright returns. It never launches or kills a server/browser. All receipt data and image copies use the existing test-results upload. No old hash is restamped and the stale committed ticker gate remains enforced until an actual artifact is verified and imported.

The shard audit now identifies a serial opt-in by its actual feature environment flags; a screenshot capture under the normal server environment does not change the ticker spec's production eligibility. Existing opt-in identities and coverage contracts remain tested.

## Executed checks and remaining proof

50 pure receipt/existing safe-reporter tests, 382 focused CI contracts and eight original watchlist tests passed. Full TypeScript passed after unchanged sparse inputs were hydrated. Affected repair lint passed. TerminalShell retains its existing 45 lint errors and 22 warnings with zero findings on added lines; no broad unrelated cleanup is included. The current spec collects all 21 ticker cases and the three target recovery cases; collection is not browser execution. The full candidate plain-language scan found zero blocking or waived findings across 497 source files (five pre-existing findings disclosed). The unchanged ticker consumer has three passing tests and the one expected stale TerminalShell-lock failure.

Natural changed-head CI must prove the recovery case and provide the fresh ten-image ticker packet. After source/image/report/lifecycle validation and visual inspection, that packet can be committed as genuine new evidence. Existing native enrollment, merge-blocked, product/release holds and the separate CI-topology owner remain unchanged. No approval, direct merge, deployment or production acceptance is claimed.
