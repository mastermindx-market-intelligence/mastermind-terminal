# D06 Terminal — final browser-test repairs

## Outcome

Three test assumptions from hosted run [41827927547](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41827927547) are corrected on the original D06 branch. The production implementation remains unchanged from **9d1d8549a3d5f77208de385631e10c31c7d16c4f**. The final diff changes only the three affected end-to-end tests and this evidence.

The completed old-head run has 11 successful and 6 failed jobs. Five failed browser shards reduce to three distinct assertions; the sixth failure is the aggregate check. Unit/typecheck and the other successful jobs remain separate results. This receipt does not relabel the old run as green.

[Verification](pr-crops/d06-final-tests-20261104/verification.json) · [Inventory](pr-crops/d06-final-tests-20261104/manifest.json) · [Prior layout/CI repair](d06-ci-20261104.md) · [Prior bilingual copy routing](d06-copy-routing-20261104.md).

## Repairs and retained assertions

**Portfolio refresh.** The prior fixture assumed the initial completed request was always read 1. Hosted ZH cases displayed read 2 before the user edited the holding. The repaired test captures the displayed initial ordinal and verifies it matches the request counter. Each fixture response captures shares at request entry. An explicit gate holds only the edited holding's response. The test still requires exactly one additional read, removes the old facts while checking, and then displays exactly one event for the updated 25-share holding. Duplicate post-edit requests still fail. The gate is released in `finally`. New screenshots use the test's output directory, preserving historical evidence.

**Clean embed controls.** The complete control row is owned by `.embed-range-controls`; the horizontal range scroller is `.embed-ranges`. The phone layout already reserves the fullscreen button outside the scroller. The geometry assertion now measures the complete row, retaining the same **6–12px** bottom-gap limit. Fullscreen width and height must each be at least **44px**. Chart height, overflow, range order, capsule styling and native handoff assertions remain intact.

**Drawing recovery.** Canvas visibility does not establish that the queued replay has completed its journal work and automatic recovery read. The test now waits for its fixture's second GET to finish aborting before asserting the recovery UI. It retains the exact original PUT payload, **2 reads / 1 PUT** before explicit review, the Review cloud copy action, the Use cloud copy action, final **3 reads / 1 PUT**, and the cleared local journal. A missing automatic read still fails under the normal test timeout. The former five-second prerequisite failure does not establish a particular browser scheduling cause or a production data-loss defect.

The drawing test, drawing persistence/outbox implementation and relevant shell recovery block were unchanged across old head **9d1d8549**, protected base **cd2a335f8f8fcf4fa947aa8a47f7dbf5748b2fdc**, and tested merge **fa72e615474d165e004dc5edaffdf5b7e61ead59**. All three failed attempts retained the queued drawing, original operation and superseded marker. The fixture-event fence follows the adjacent two-device test's existing pattern.

## Verification

| Check | Result |
|---|---|
| Portfolio edit journey | 6 passed: EN/ZH × desktop/tablet/mobile |
| Clean embed/fullscreen geometry | 3 passed: desktop/tablet/mobile |
| Superseded drawing replay and explicit cloud choice | 3 passed: desktop/tablet/mobile |
| Browser retries, failures and skips in these runs | 0 |
| Existing event refresh lifecycle suite | 33 tests passed |
| Portfolio test lint | Clean |
| Shell test lint | 38 pre-existing findings, byte-equivalent rule/message/source-line signatures; no added findings |
| Prior D06 layout/CI and copy-routing inventories | Unchanged |

Both browser runs use the original Playwright configuration, the existing fixture environment, one worker and retries 0. Automatic server reuse is disabled for the owned D06 operation. Viewports remain 1440×900, 820×1180 with touch, and 390×844 with touch. The matching installed Chromium runner and original 14-route warm-up are reused. No shared-shell override, new browser owner or replacement test runner is introduced.

The six portfolio PNGs are cropped functional-fixture captures. Root inspected the Chinese desktop and English phone samples; they establish the updated shares and layout at capture time, and do not replace prior settled visual acceptance. A non-executable comment was tidied after the drawing run; executable test logic is unchanged. The final source hashes are recorded after the runs.

The additional full-file lint command exits 1 on existing `no-explicit-any` uses in the shell test. A baseline comparison at the exact old head finds the same 38 diagnostics after accounting for shifted line numbers; this work makes no full-file lint-clean claim. The initial comparison's line-number-only mismatch is retained in the diagnostic history. No lint waiver or repository guard was changed. The drawing repair adds no `any` or suppression.

The 33 unit tests and these targeted journeys overlap earlier D06 coverage; they are not added to prior counts as unique tests. Local success does not establish full hosted-CI success, physical WKWebView behavior or production acceptance.

## Publication boundary

[Draft PR1270](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1270) remains the existing implementation carrier. Its final published head and current hosted-CI state are recorded in its body and the canonical D06 return. Ready/enqueue/PR-merge/deployment and joint-shell rollout remain held. The original F01/F02 uncertain effects remain untouched.
