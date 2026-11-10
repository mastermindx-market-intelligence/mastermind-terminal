# PR650 — CI collection and timeout contract repair

This is a single-parent successor of d3bd6b2d98c6c23398be0bed6c7450caa47bd665 on the existing PR branch. The source-linked continuation is https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/650#issuecomment-6746036815.

## Actual hosted failures

Run https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42640575037 found two independent test-infrastructure defects. Ingest job129270958722 passed4,875 tests and failed the one assertion still expecting the old55-minute browser-capture budget. Desktop job129271073805 and mobile job129271073904 stopped during Playwright collection because a file recognized as a test imported another recognized test file.

The existing workflow already uses85 minutes. Only the Python expectation is aligned with that value. The five Options Exposure Node cases are moved byte-for-byte from optionsExposureEvidence.test.cjs to optionsExposureEvidence.cases.cjs, and the existing CI owner test imports that module. All five cases still register in the same Node entrypoint. No assertion, timeout, retry, production source, capture producer, workflow, or Playwright selection rule is weakened or changed.

## Current validation

All167 Node CI-entrypoint assertions and all18 Python browser-setup contract tests pass with zero skipped or failed cases. Full unfiltered Playwright collection now succeeds with4,900 tests across289 files. This is collection proof; hosted CI must still execute the browser cases on the successor head.

The77 existing native evidence-reader assertions pass. The prior #650 native and browser qualification is retained with its original source identities. The renamed test cases and timeout assertion do not change application or rendering inputs. The observed six validation control files remained byte-identical throughout this repair's checks.

Structured reports, the exact repair receipt and executable validation driver are included. Raw logs remain in the owned workspace and are SHA256-bound by execution.json. Existing native auto-merge admission is preserved, subject to required CI and repository controls.
