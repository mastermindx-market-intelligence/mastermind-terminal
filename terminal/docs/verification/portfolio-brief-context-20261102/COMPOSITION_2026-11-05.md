# Terminal #1216 — canonical-book composition and residual repairs

This source delivery composes original head
`c2591e5d434053cd61600e2efa20b1e8fd997def` with protected master
`50713efda7cbd06c60b6dce2f88b31cea5c005a2` on the original branch. All seven
modified-file patch preimages equal current master exactly. All 32 originally
added paths are absent on master. The complete original 39-path intent therefore
composes without replacing a newer owner or discarding a master hunk.

The original canonical-book acceptance contract remains: server-verified owner,
same-read witness completeness, actual unchanged `rowToPosition` and
`portfolioBookKey`, whitelisted public response, committed request generations,
current-book rendering and deliberate page-owned canonical reload. Ordinary
proxy callers keep their existing response/status/population behavior. No new
reader, authentication authority, schema, dependency, producer or runtime is added.

The PR stays **Draft and unarmed**. This source repair is not producer acceptance,
deployment, authenticated live proof or a merge recommendation.

## Numeric witness false acceptance

The completed [unapplied proposal](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1216#issuecomment-6658713464)
identified a missing branch in `PY_FLOAT_LITERAL`: Python accepts leading-dot
Unicode decimal strings such as `".٥"`, while JavaScript's canonical reader does
not. The original guard treated that Python-valid form as absent and could
accept a divergent witness. Its published synthetic economic counterexample
remains prior evidence; no production occurrence was observed by this repair.

The exact one-line recognizer change and its exact 50-case whole-decoder suite
are adopted. The recognizer now detects the incompatible form and rejects the
row. It does not coerce a value, calculate another key or normalize a book.
Twenty Unicode leading-dot cases, eight underscore cases and 22 agreed-reading
controls exercise both shares and entry price. Existing ownership, population,
count, completeness, canonical-key and 64-row shared-fixture checks are retained.

Local execution used the complete actual decoder, actual portfolio and money
readers, actual Node book-key owner and actual brief module. Only test assertions
and the empty `server-only` boundary are local ports, with Node 24 type stripping.
The original 44 test bodies plus the new 50 were executed:

- Original decoder: **66 pass / 28 expected regressions fail**.
- Repaired decoder: **94 pass / zero fail**.

The original modules and four fixtures were Git-blob checked. The portable patch
SHA256 is `2ca08d8ba97663e8d76b6a31600cba1f5de123a74c33bc977db5b21246bab158`;
the new native test SHA256 is
`0759e45c9772aa5747b37465769d2b0f5017d6ccf0c11713f64e2c824427d479`.
This execution is not native Vitest, full TypeScript, React or browser proof.
The already published Python producer counterexample was not rerun.

## Exact natural-CI browser failure and repair

Natural run [41435790549](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41435790549)
tested synthetic merge `341327bb4fa7e0233d9e9121811f61cb63a4a647`, combining
the original PR with historical base `8a56d612377af3d7fcb5099e2dd9d33de55435a7`.
Its unit/typecheck job `125245656217` succeeded. Three browser jobs failed:

| Job | ID | Observed native result |
|---|---:|---|
| Tablet 3 | 125245656605 | 337 passed, 89 skipped, one failed |
| Mobile 3 | 125245656250 | 327 passed, 99 skipped, one failed |
| Desktop 4 | 125245656114 | 228 passed, 27 skipped, one failed |

All three failed the same `portfolio-positions.spec.ts` journey, waiting at
line 254 for `brief-population`; initial execution and both retries had the
same failure. The tested spec and current master share blob
`0428f78341dab290ffd56d4ce3636a122871c85c`. Its fixture had no canonical context,
which the new consumer correctly refuses. Its later count-gap expectation
also targeted a heuristic this PR intentionally retires. The exact tested
panel and brief-helper blobs match the original PR. This is a missing test
contract adaptation, not evidence of three unrelated product defects or a flake.
Each failed log was retrieved once; no workflow was rerun or dispatched.

The existing journey now uses the isolated fixture's actual owner and the key
returned by the real `/api/portfolio?view=positions` route, verified with the
unchanged canonical Node function. Two names in three position records prove
the two count domains are distinct. Adding MSFT while serving the prior book's
response must produce unavailable state with no old facts or population.
Only a response bound to the new book, after the existing deliberate retry,
can show three names in four position records.

Other positions journeys remain intact. The original new EN/ZH canonical-book
edit/retry suite and its explicit context-free rejection case remain unchanged.
No permissive fixture acceptance or count-only fallback is restored. The updated
browser journey is authored but unrun locally; natural CI must execute it.

## Evidence and release limits

All original dated documentation, fixtures and all 20 PNGs (including the
18-image bound/unavailable/rebound matrix) remain their exact original blobs.
They are historical evidence at the sources stated in
their existing receipts, not a new capture of this composition. No source hash,
image, manifest, screenshot matrix or CI gate is restamped or waived. This
delivery makes no capture/workflow change.

Syntax/whitespace and full-tree conservation are checked during publication.
Native Vitest/React/jsdom, full TypeScript, Playwright, production build,
database and live authenticated acceptance were not run locally. Historical
successful checks do not qualify this new head. Chairman's unavailable-test
waiver is recorded as a limit, not converted into a successful check.

The producer dependency was freshly read: [Macro #10551](https://github.com/mastermindx-market-intelligence/macro/pull/10551)
is still OPEN/Draft/unmerged at `68adf1cf47af278efc09fa0692d4066d2182f697`,
with its concrete HOLD-FOR-SOL disposition and producer/source/CI conditions.
Its separately identified Python mirror repair remains necessary. This repair
does not release that candidate, alter the producer, deploy either repository,
perform live account reads, mark this consumer Ready or arm merge-on-green.
The prior generic independent-review sentence is not treated as a new blanket
Web review gate; the actual producer and release conditions remain unresolved.
