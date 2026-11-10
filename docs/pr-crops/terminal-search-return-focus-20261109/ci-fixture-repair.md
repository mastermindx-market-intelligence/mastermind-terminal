# Search focus CI fixture repair

Qualified 2026-11-09 13:07 UTC. This extends PR #1385 at prior head `9c779b352078c0d425f1b80e31bed21ab8c6caa3`; runtime product `ac2cb419feab42f14b245ecfeb81708d5ac55976` is unchanged. Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.

## Exact hosted failure

[Run 42611334509, attempt 1](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42611334509), [unit job 129150059976](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42611334509/job/129150059976), executed merge `05da7f76eb607328c36c30b945c531d7375200f7` into protected base `f34b0deb0bb2a0b2f57ba82256b9e87886ad76e0`. TypeScript and evidence capture passed. Step 12, npm test, failed four focus assertions while 20,931 tests passed (50 skipped, 3 todo).

The failures expected the original or live replacement opener after dismissal, but observed document.body:
- companySearchIdentity: Escape from a company-dialog tab.
- sharedShellLazyFocus: cold activation followed by Escape or the close button; external programmatic opener.

This is separate from the Pine capture failure on #1378.

## Cause and correction

The new logical-session return target preserves only connected, visible, available openers. Its existing eligibility check requires real layout rectangles. These two older jsdom fixtures supplied no opener geometry; jsdom does not lay out those otherwise visible buttons, so the session correctly retained no eligible target. The newer return-focus fixture already modeled visible geometry and all 16 of its cases passed in the same hosted run.

Both older fixtures now model rendered geometry with the same visibility-aware convention: disconnected, hidden, inert, aria-hidden and display:none targets yield no rectangles. The mock is restored during each test's cleanup. This also models the live replacement trigger created during cold lazy loading.

**No runtime code, focus assertion, eligibility guard, required check or timeout changed.** Held #1307 touches MobileSheet and mobileSheetEligibility.test.tsx; neither is changed here.

## Discriminating verification

| Check | Result |
|---|---|
| Two original suites before repair | **4 failed, 3 passed**, matching the hosted failures |
| The two repaired suites plus all existing return-focus cases | **23 passed**, no skips |
| Changed-file ESLint | exit 0, no errors or warnings |
| Source preimages | companySearchIdentity `3114cd6fe985086b093478bc29d814177082c024`; sharedShellLazyFocus `690a865774a695b4fb363d286a661784695b6523` |
| Final fixture blobs | companySearchIdentity `4beefb076d2d94ddab7a223d721ea85badec178b`; sharedShellLazyFocus `986fcf4bed8ca62db4153a7662ed5afb396efd18` |

[Before log](ci-fixture-before.log) · [Passing group and lint](ci-fixture-after.log)

The local discriminator uses the combined integration copy; the production return-target helper is the same immutable blob `0a2356a6a62f2dff85a161548c99474cb7a75781`. Earlier 246-test affected qualification and eight real-route browser journeys remain separately recorded in [the runtime verification](verification.md). Runtime was not changed or recaptured for this fixture-only correction. Local passing tests do not claim the next hosted run is green.

The existing native auto-merge request remains with the same PR. Do not re-arm it, clear a hold, or duplicate a CI retry. The pushed fixture repair creates the normal fresh-head qualification; required CI, queue, deployment and live acceptance remain distinct.
