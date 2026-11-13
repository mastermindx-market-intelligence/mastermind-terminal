# PR496 route-only diagnostic classification — 2026-11-11

## Reproduced defect and narrow repair

At original head cc9be85b2d4ece4503d5cf57a6005140875fb4c9, executeRouteOnlyStage selected an action-failure code before asynchronous diagnostic capture. A rejected final click could leave one millisecond, select TOOLBAR_ACTION_FAILED, and then produce a receipt showing no remaining budget or a closed page.

The catch now reuses failToolbarActionUnlessDone, which captures once and classifies from that completed receipt. Existing routeOnlyAction always returns false from done, so this does not add a success path. Stage allocation, invocation deadlines, continuation reserve, revision/retry rules, phone behavior, production hook and broader overflow recovery remain unchanged.

Three behavioral cases call public runToolbarDetector and traverse the real private catch. Each issues exactly one opening click and one final click, with timeouts 7,999 ms and 1,001 ms and noWaitAfter true. The final click rejects at time 9,999 with a deadline of 10,000. A single diagnostic capture either spends the last millisecond, closes the page, or leaves the positive remainder. Exact failure codes and receipts, closure priority, one settled wait/disposal, one capture and unchanged intent are asserted. The classifier and failure helpers are not mocked.

## Actual validation

With the new tests and unchanged original helper: 38 passed and exactly two failed, reproducing stale ACTION_FAILED in the deadline-expiry and page-closure cases. The open-page/positive-budget control passed. Both failures occur only after the exact actions, single capture and receipt assertions succeed.

After the helper repair: all 40 deadline cases pass, including all 37 existing cases. Full TypeScript passes. ESLint returns zero errors and the same four retained unused-variable warnings in the existing test prefix; no warning is suppressed. Source hashes remain stable through execution. Original command lines, timestamps, raw output and negative evidence are retained.

The prior real browser journeys and their complete archives remain unchanged at their original source identities. No new browser capture or product behavior claim is made for this deterministic diagnostic-only error-path repair. New-head natural CI is owed after publication.

## Custody and release boundary

The earlier C3 workspace retains its 22,715 status rows and unpublished evidence; it was not reset or edited. The original GitHub publication is settled. The new managed operation terminal-pr496-receipt-classification-20261111-c3 acquired exact cc9be85 on the same host/source. Its initially unqualified acquisition return was reconciled through the original operation's registered, clean exact-head workspace and installed-owner recoverability readback, without replay or alternate allocation. Dependencies use the unchanged lockfile.

Publish on original branch sol/terminal-r1t-toolbar-settled-20260831. Formal CHANGES_REQUESTED reviews 5108504922 and 5108886118 remain intact, merge-blocked stays, and auto-merge remains off. The review findings' earlier accepted repairs are not redone. This closes the narrower diagnostic race retained as a follow-up; it does not claim formal approval, merge, deployment or broader acceptance.
