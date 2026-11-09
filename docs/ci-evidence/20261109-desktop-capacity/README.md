# Desktop CI capacity qualification — PR #801

The previous desktop-1 job exhausted its existing one-hour budget (run 42550254306, job 128946320810). That result established a capacity boundary, not a particular failing assertion. This repair raises the full desktop partition from five to six shards while keeping four tablet shards, three mobile shards and the serial job. It preserves worker count, per-job budget, required aggregate, assertions, capture ownership, runner permissions and release controls.

The protected first-parent selector bridge recognizes only the exact historical full five-desktop/three-tablet allocations. It preserves focused/filtered selections and selector failure behavior. The self-hosted input validator mirrors the allowed full six-desktop/four-tablet partitions; no self-hosted canary was dispatched.

## Qualification

- 238 selector, shard, merge-group and canary contract tests passed. Those eight indexed files are byte-identical to the tested immutable source tree recorded in qualification.json.
- 549 Investigation tests in 29 suites and the full TypeScript check passed on the current composition.
- Native Playwright collection found 1,558 desktop cases. Six shards contain 260/260/260/260/259/259 cases; their union is complete and disjoint. Old shard 1/5 contained 312 cases.
- All four long chart-ownership stress cases remain in shard 1. This is reduced case count, not demonstrated runtime balance. New-head natural CI remains required.
- Collection ran without a browser. The initial full discovery also emitted the repository’s existing Node-helper footer; it is not counted as browser proof. Later listings explicitly named the 277 registered Playwright files. The compressed case projection preserves each test identity and both allocations.

## Preserved feature evidence

The original seven November 9 captures still match their SHA-256, Git blob, length and PNG signatures. All fifteen receipt-bound paths are unchanged from the original published #801 head. Fourteen still match capture-H1 hashes; the documentation-only difference in INVESTIGATION_EVIDENCE_REVIEW.md was introduced by the original H2 publication and remains explicitly attributed to that follow-up. Capture heads and historical source hashes have not been restamped.

The old October source-verification.json stays byte-exact and historical. No deployed authenticated owner-backed review receipt is claimed here. Production admission and that outstanding acceptance boundary remain unchanged.
