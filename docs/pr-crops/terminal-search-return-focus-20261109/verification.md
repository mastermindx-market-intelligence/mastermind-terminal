# Search focus continuity — qualified product

Verified 2026-11-09 11:42:38 UTC. PR #1385.

- Product commit: `ac2cb419feab42f14b245ecfeb81708d5ac55976`.
- Protected base: `f2aa1e0cb27d459149f59d3b24d98cd6e2e8389f`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Source authoring: GitHub-native branch with exact preimages, locally computed Git blob checksums and compare-and-swap ref updates.
- Source receipt: [browser-source.json](browser-source.json). The isolated browser copy was materialized from the accepted base and exact product blobs before execution. Enrolled sibling product changes were restored to their accepted base for this standalone proof.

## Result

**PASS: 246 affected unit tests, zero targeted lint errors/warnings, full TypeScript exit 0, and 8 real-route browser cases with no retries or skips.**

| Proof | Result | What it establishes |
|---|---|---|
| Search/owner/scroll-lock integration, 9 suites | 210 passed | Strict Mode, both responsive directions, fresh opener per opening, unavailable targets, pending-frame handoff, newer-modal Tab/Escape, parking and one restoration; existing IME/selection/scroll-lock contracts |
| Actual annotation component and sync engine, 2 suites | 36 passed | Background refresh retains the chosen import action; Escape still closes; guest note stays and no annotation write is dispatched |
| Targeted lint | 0 errors, 0 warnings | All changed runtime/test files |
| Full TypeScript | exit 0 | Final combined local integration copy, including enrolled #1376 and other qualified polish slices |
| Ordinary Search, desktop/tablet/phone | 3 passed, 49.1s | Real opener → AAPL → alternate presentation → original presentation → Escape; original opener focused, query retained, no outer-page jump; next opening works |
| Shared Search, desktop/tablet/phone | 3 passed, 19.4s | Same roundtrip through the actual Shared Shell company-search entry point |
| Real receiving annotation preview, tablet/phone | 2 passed, 30.4s | Actual import chip over Search, both presentation directions, native Tab/Shift+Tab, no focus escaping the receiver, Escape closes only the receiver; Search/query/NVDA route retained |

Browser process 48953 completed exit 0 in 99.92s. Playwright 1.61.1, installed Chromium, actual Next routes on the isolated fixture server, one worker, retries 0. Default ordinary mode and existing `MMX_SHARED_SHELL=1` beta opt-in ran in separate server processes. Fixture stores were isolated for the receiving-dialog journeys; the import action was never activated. [Browser log](browser.log), [unit/lint/typecheck log](qualification.log).

The receiving-dialog owner listens at window capture. That journey proves native user behavior; the mounted owner tests separately isolate MobileSheet's document-handler yielding.

## Discriminating failures and repairs

The initial search-session candidate failed the mounted receiving-modal→presentation-switch and pending initial-focus-frame cases. Persistent per-opening predecessor provenance and guards at the existing capture/frame/keyboard/cleanup points resolved them.

During added real-receiver proof, a fast Tab during tablet→phone remount returned to Import 1. Waiting for the actual Search presentation isolated that race; it did not establish Search stealing focus. An independent mounted actual-component counterexample then reproduced the incumbent annotation defect deterministically: focus Not now, perform an ordinary background annotation read, and focus moved to Import 1. The parent recreated an inline close callback and restarted the existing dialog effect. A stable callback reused by Import and Conflict fixes that replay. [Before-fix discriminator](annotation-before.log). The final 8-case browser pass uses the corrected runtime and explicit presentation readiness.

## Source boundaries

Search owns optional metadata for one logical opening; its incumbent desktop dialog and MobileSheet continue to own focus. No new global modal registry, listener, focus trap or timer was added. Accepted #1364 shared scroll locking remains intact. Annotation data reconciliation, revision checks, import confirmation and conflict decisions are unchanged.

Held #1307 retains its original source-custody/release hold. Its inner-target eligibility changes and tests were not adopted or altered. Current published open-PR inventory found no annotation-component overlap. Enrolled #1376 owns different search selection/reveal changes; this branch starts from protected Search source and does not republish that sibling. The local combined tests cover compatibility.

## Visual inspection

The final desktop opener ring, phone Shared Search opener ring, and phone receiving dialog were inspected after the functional assertions. The captures show the expected current layout and focus treatment:

- [Desktop return](desktop-return.png)
- [Phone Shared Search return](phone-return.png)
- [Phone receiving dialog](receiver-phone.png)

These are isolated fixture browser results, not live-account or deployed-production acceptance. No latency, INP, frame-rate, universal accessibility or whole-app parity claim is made. Ready, native enrollment, queue admission, merge and deployment remain separate states.
