# Portfolio workspace owner-boundary repair — 2026-10-21

The user-authorized independent native review found two HIGH owner-display isolation defects on frozen `33535adb1ef8d087449cab9e67cde8d068ec9257`: settled or delayed Portfolio brief and event responses could appear under a different account. Both frozen probes failed, while matching owner-keyed controls passed.

Semantic repair `de0100bc073e038c068b4c9d95c8b9ee01929fd6` adds one immutable-owner key to the complete PortfolioWorkspace instance. Account changes retire its personalized panels and local selection/filter state. Same-owner seed and email refreshes preserve the instance. Queue, server, mutation, database, and deployment behavior is unchanged.

The same independent native reviewer closed both findings on that exact semantic commit. The original HOLD, failed probes, corrected canonical-envelope probe, raw logs and scoped repair PASS are preserved here. Parent-assisted execution is explicitly recorded; failed Fabric014/015 are neither retried nor relabeled.

## Actual validation

| Evidence | Result |
| --- | --- |
| Permanent real-component regression on original source | 8 expected isolation failures; 2 same-owner controls passed |
| Same regression after repair | 10 passed |
| Affected component suites and three retained evidence readers | 134 passed across 7 files |
| Fresh repaired archive: unchanged independent probes, permanent regression and original controller | 67 passed across 4 files |
| Typecheck and changed-file lint | Both exit 0 |
| Portfolio desktop browser composition smoke | 1 passed; no skipped, unexpected or flaky cases; retries 0 |

Counts overlap and must not be added as unique tests. Parent tests ran on the exact bytes committed in de0100; the independent recheck ran in an archive of that commit with independently copied dependencies. Browser testing used localhost and the existing fixture transport. All identities, records and response markers in these tests are synthetic.

## Retained and separate evidence

VI30, BPL24 and Options-axis evidence retain their actual prior capture sources and unchanged declared file bindings. The three current readers passed. No historical capture receipt was restamped or relabeled as a new run. Legacy Targets, Risk-history and Event-invalidation packets remain historical.

The accepted independent013 backend/Risk review remains limited to its four unchanged blobs. Migration0036 SQL and its existing production receipt remain byte-identical; no migration was applied by this repair.

This packet proves the repaired client owner boundary at its stated evidence level. Current-head hosted checks, protected-master integration, the post-merge0036 ledger update, incumbent-owner deployment and live acceptance remain separately tracked release gates. It does not claim new production mutations, authenticated save/reopen, history-feed availability or real-account acceptance.

The original and repaired native reports, source identities, command results, raw logs and artifact SHA256s are linked by `receipt.json`.
