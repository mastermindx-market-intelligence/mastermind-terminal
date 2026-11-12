# PR 1481 protected-master integration

The original security dependency candidate c31abf59eb92a8cce34e684886ec8eb2b0b118eb is integrated with protected master cbf6d90f2e43b7cdfa874e8999b8058800c68a88 in its original registered workspace and branch. This is recovery of the existing PR, not a replacement implementation.

## Conflict and correction

Only the nine-file active recurring-inbox packet overlaps the two source histories. The candidate packet used the upgraded dependency graph with the older capture tool; the protected packet used the newer capture tool with the older dependency graph. Neither qualified the combined source. Both historical packets are retained byte-for-byte under historical-inbox, with source revisions and hashes in historical-inbox-manifest.json.

Ran the existing producer on the combined working tree: node e2e/tools/capture_b_f11_7_recurring_briefs.cjs --active-inbox. All eight views completed on 2026-11-12 at 11:44:12 UTC, with all eight contexts closed, browser closed, and server settled. The process then exited 1 because macOS /tmp aliases /private/tmp and the reader requires canonical directory identity. Read back the completed original stage and cleanup receipt, confirmed the old active packet was unchanged and the capture port was no longer listening, and passed the unchanged readInboxPacket validator against the real /private/tmp stage. Copied the same eight images followed by the same manifest; all file hashes are identical to the original stage. No image, source hash, or captured checkout identity was restamped. capture-recovery.json records this technical recovery and capture-proof.json records the original browser observations.

## Verification

- Existing strict evidence suite before recovery: 5 passed, 1 failed, with capture_ci_evidence.cjs source-hash mismatch.
- The same six existing tests after recovery: 6 passed (inbox-test-after.txt).
- All 15 source bindings match the integrated source; the unchanged packet validator passes.
- All eight actual screenshots visually inspected in English and Chinese at desktop and phone widths, list and empty states.
- Original candidate source and fixture paths are byte-identical; protected-master changes outside the conflicted packet are byte-identical. Exact inventory is in source-integration-check.json.
- Both historical packets (18 files) match their respective Git objects exactly.
- No conflict markers/unmerged index entries; git diff --check passes.

## Evidence limits

The capture correctly records actual checkout HEAD c31abf59eb92a8cce34e684886ec8eb2b0b118eb while the integrated working tree is bound by source hashes. It does not invent the later merge-commit identity. The existing candidate dependency-audit and full-suite evidence remains historical; fresh hosted CI must qualify the integrated published head. These are local fixture captures, not production activation or production acceptance. No authentication, entitlement, provider, database, or release hold is cleared by this packet.
