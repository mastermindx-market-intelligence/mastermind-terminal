# PR #1207: drain Portfolio fixture routes before teardown

The fresh CI run on `8470d4c5bba5848aca0f25fda439af55047e86d6` exposed a lifecycle error in the shared Portfolio browser specification. [Tablet-3 job 129136903439](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42607993927/job/129136903439) reported 281 passed, 112 skipped, one not run, and one error outside any test. An active risk-history route handler called `page.request.get` in `readBook` after the request context had ended. The affected test identity was the Chinese/light unavailable-currency-weights case. `ci-failure.json` preserves the source-linked excerpt.

## Bounded source repair

The only source change is a file-scoped `test.afterEach` in `e2e/portfolio-risk-reasons.spec.ts` that awaits `page.unrouteAll({ behavior: "wait" })`. It removes the test's page routes and drains any active handlers while the page/request context still exists. It runs after failed assertions as well as successful ones. The same waiting pattern already appears in the exact-head options-tape and Pine temporal specifications.

Playwright's [official API contract](https://playwright.dev/docs/api/class-page#page-unroute-all) distinguishes waiting for active handlers from silently ignoring their errors. This repair uses `wait`; it does not suppress the fixture's API/status or risk assertions. Removing the new hook from the final file reproduces the original file byte for byte. All four EN/ZH and dark/light cases, real fixture reads, page-error checks and optional crop code remain.

## Actual validation

All 12 existing cases passed across desktop, tablet and mobile with one worker and zero retries. There were no skipped/flaky cases, failed attempts or report-level errors. The full 1,484-file observed source map remained unchanged before and after. Browser report, complete execution log, source maps and exact source-file identity are preserved here. No optional crop flag was set and no historical image packet was overwritten.

The Playwright process exited 0. Its wrapper initially rejected a leftover Next.js lock; the port was already closed. The named process 18943 was absent, no process held the lock open, and all source hashes still matched. The unchanged lock and original execution receipt are preserved under `lifecycle`; `server-reconciliation.json` records the settled state. No browser case was rerun for cleanup.

Full TypeScript (`--noEmit --incremental false`) and ESLint on the changed specification then passed. Local validation used Node 26.5.0, Next 16.2.9, Playwright 1.61.1, TypeScript 5.9.3 and Vitest 2.1.9. This establishes the focused lifecycle regression proof; required GitHub CI still qualifies the published successor.

## Publication boundary

The local managed review workspace is `terminal-pr1207-route-lifecycle-validation-20261109`. Publication remains the original GitHub-native `claude/news-reading-current-20261102-c4` branch, with an expected-head fence from `8470d4c5bba5848aca0f25fda439af55047e86d6` and a complete-tree match to this validated source/proof. The workspace branch is not pushed.

The News composition is unchanged. Existing source-head unit/typecheck results remain evidence for that prior source, while the new commit must receive its own natural required checks. Historical CodeQL rerun refusals remain closed. No approval, merge enrollment, deployment or production acceptance is inferred from this local packet.
