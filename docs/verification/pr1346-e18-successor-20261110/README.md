# PR1346 — current E18 successor evidence

This packet repairs the stale E18 evidence on the original PR1346 branch. The alert review behavior, native producer, and five-case evidence guard remain intact. A real new capture supplies the current shared-owner source hash; the prior packet is retained unchanged in prior-e18-packet/ with its original inventory.

## Source composition

- Original PR head: 33d55577356a55ed2839d38c507b568b3caafed2.
- Integrated shared capture dependency: 9ef372c8086ceaac8bcb153bd2d2d71b5b63d62c from PR768.
- Protected overlay: d15741d452403594a4ddb540a97b9a981c2a62ca.
- Capture source tree: 7f28a3cb32fe2eabd4a889cf6705eefbfc1cd23c.
- composition.json binds all 57 overlay preimages/postimages and the 14 original PR paths. The normal dependency merge had no conflicts.
- Shared capture-owner Git blob: 51956187614f10d745c5a65f62621845d96cac25; SHA256 856da74c32caa80a6bb0d18a243e90db1c3a1c65690c44e5703887a855d834e4.
- All seven E18 source locks match the actual capture. Its informational checkout head remains the original head; the seven source hashes bind the composed worktree.

## Actual consumer proof

The existing E18 producer ran through the existing generic legacy supervisor, with its owned server on 47283. No new packet registry or control plane was introduced. Native capture produced the exact 12 review/results images: three viewports × two languages × two states.

native-capture.json, legacy-supervision.json, lifecycle.json, the raw logs, and retained native-stage/capture-proof.json bind the execution. All 3516 observed source entries were identical before/after. The capture and server processes settled; the port and Next lock were clear. The canonical manifest SHA256 is 2283e45f2c3af08d47fde7b37ad03cf70d301bfb66786b70c74aa3e5964929b3.

Visual inspection found no defect in the 12 views. Review shows four to pause and one already paused. Results keep acknowledged, refused, unconfirmed, and skipped outcomes distinct. In particular, an unconfirmed AAPL change stays unconfirmed even when its latest saved state reads Paused. Primary actions remain visible at 390×844; long English badges wrap within the card, and Chinese text is complete.

## Functional checks

All 69 existing tests passed:

| Existing test file | Passed |
|---|---:|
| e18AlertManagementEvidence.test.ts | 5 |
| alertBulk.test.ts | 26 |
| alertBulkReviewValidation.test.tsx | 38 |

The command and raw output are retained in focused-tests.json and focused-tests.log. The E18 guard and production assertions were not weakened.

## Final dependency applicability

The later published dependency delta from 9ef372 to 8e2451 contains 16 paths, with zero intersection against the seven captured E18 source locks. Exact pre/postimages and unchanged current locks are retained in final-integration-deltas.json. The original capture identity remains unchanged.

## Delivery state

This is qualified local successor evidence. Final protected-base reconciliation, publication to the original GitHub branch, exact-head required CI, protected queue admission, and merge remain separate subsequent steps. PR768 must land before that final publication. No deployed-production acceptance is claimed.
