# Transcript comparison: focus recovery and current copy feedback

## Reproduced defects

The existing Clear topic action measured 24×24px and removed its own focused button when used by keyboard. The topic input remained mounted but inactive, so typing could no longer continue there. The clipboard path also published every asynchronous completion without checking whether another copy or comparison change had superseded it. An old rejected copy replaced a newer success; a delayed receipt build initiated an old receipt write after the user had already copied a newer link.

## Change

The existing topic input now owns its return ref. Clearing uses the unchanged filter owner and returns focus to that input. The input and clear action have 44px targets, the enclosing search row fits them, and the clear action has a visible focus outline. No new search state, translation owner or archive path was introduced.

A local monotonic attempt counter owns copy feedback. Every copy intent starts its attempt before asynchronous work; call/filter/mode changes, swapping, retry and Close invalidate old attempts synchronously. A committed comparison-context token also covers ticker, ordered calls/filter/mode, actual full body revisions and archive generation. Its layout-effect cleanup invalidates on committed transitions and unmount; feedback renders only for its current token, including A → B → A. Ref writes do not occur during render or state updater execution.

Receipt preparation belongs to the original click. Its attempt is checked before any later clipboard write, blocked result or completion feedback. Existing link, receipt and reference payload construction stays intact. The existing 1,800ms feedback lifetime remains; an already queued old timer cannot clear a newer feedback object. A browser clipboard call already invoked cannot be cancelled by this change—the guard discards obsolete feedback and prevents a stale prepared receipt from initiating a later write.

## Source/design qualification

- Original TSX blob `86cd79315246aec5a9dafdb503a66f1fba04ca24`; CSS `c3a1392cc41daeea7f2d1e4d6802408ed88ff67d`.
- Base `1377853d02fdb0295c0848d7127fdee4ca36714b`; these leaves match protected source through `f34b0deb0bb2a0b2f57ba82256b9e87886ad76e0`. The subsequent `b387616013f38cce9e467cc7da7b87fd2672718c` delta changes only unrelated accepted alert/event UI.
- Three bounded open-PR file pages found no edits to these leaves. Fourteen capped heads have both exact current blobs; #796/#857 have neither file at head or their merge base. Existing `transcript-compare.spec.ts` and the #1375 TranscriptDrawer changes remain untouched.
- The [Paper shared-shell reference](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0) remains the presentation contract. Existing research, translation, revision validation and rights owners remain authoritative.
- Direct principal implementation reason: `LOWER_TOTAL_OVERHEAD` for this bounded, coupled UI/reproduction patch; native children supplied read-only ownership and reasoning checks.

## Proof

The new `terminal/e2e/transcript-compare-interactions.spec.ts` mounts the actual Analysis Transcripts consumer and uses three explicitly synthetic calls through its existing revision-verified loader. Body hashes are computed through the incumbent canonical hash function. The controlled clipboard and digest promises allow real completion-order assertions without granting clipboard permissions or touching production accounts.

- Baseline PID 6097: both languages lost input focus after clearing; target measured 24×24px; delayed receipt preparation produced a second obsolete clipboard write. The first copy-race assertion had an incorrect link-shape precondition; it was corrected to assert the existing exact revision-bearing URL contract before accepting that race's baseline.
- Corrected copy-race baseline PID 22612: exit 1; a newer success was overwritten by the older rejection and displayed Copy failed.
- Beta interaction matrix PID 42901: exit 0, **12/12** across desktop 1440×900, tablet 820×1180 and phone 320×568. English and Chinese/light clear-input journeys; overlapping copy outcomes, A → B → A, call changes, close/reopen, current failure/retry, 1,800ms reset, stale receipt preparation and current receipt serialization.
- Additional visible-target proof PID 49845: exit 0, **6/6**. Every clear control is a visible, hit-test reachable 44×44px target; after Enter/Space the surviving input owns focus, clearing restores actual passages and immediate typing filters them again. The phone check first scrolls the actual field into view, since programmatic fill alone need not do so.
- The initial beta matrix stopped after identifying a proof locator error: Playwright label text included nested option text. Using the observed combobox accessibility name corrected it; no product timeout, assertion or contract was weakened.
- Existing transcript comparison/search tests: PID 51402 exited 0, **34/34**.
- `next typegen && tsc --noEmit` and focused ESLint passed (PID 57239). `git diff --check` passed.
- Default-shell matrix PID 64115 exited 0, **12/12**, on the final source and test assertions with the shared-shell flag absent, including visible hit-tested targets and the existing dark Analysis presentation.

Screenshots are unmodified copies of the actual baseline and qualified browser runs, including focused/cleared phone and tablet controls and current copy feedback. These local consumer proofs are separate from merge, deployment and live acceptance.
