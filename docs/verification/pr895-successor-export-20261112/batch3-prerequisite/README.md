# PR895 Batch 3 prerequisite import

This imports the actual complete Batch 3 output from the existing PL6 shard of CI run 43224805483, attempt 1. The producer ran at merge checkout `37ad42be3a043570ddcb39236c3b8c6a9a21ff91`, tree `220120a93b82a4d4d158e279e5d8e05532b0d56e`, on PR head `86734ee171317df24f5f8e2349e350aabe48f42f`.

The two downloaded artifact ZIP digests match GitHub. All 20 declared PNGs match their actual dimensions, bytes and native receipt; all 16 source bindings match exact GitHub source preimages. The original supervisor records exit zero, closed child and settled server. Its truthful state remains `CAPTURED_AWAITING_UNIT_VALIDATION`; this import does not relabel it as consumer acceptance.

All 40 previous root files are preserved under `history/pr895-before-43224805483` using their exact original Git blobs. Only the actual 20 fresh PNGs and their producer-written manifest replace current packet bytes. The 18 additional historical FlowDesk images and capture-history document stay unchanged.

The first unit job failed at the committed control-lock guard before the EOD/browser exporter began. No raw EOD export or inbox capture is inferred from that run. The active-inbox committed lock is also stale, so its actual existing producer and subsequent immutable import are still needed. No test, source-lock hash, ordinary Options selector, producer receipt or artifact has been restamped to conceal that state.
