# PR 632 — Path finalization and fresh editing recovery

## Behavior and integration

The candidate preserves the original PR's Path-finalization acceptance while integrating the actual qualified dependency d03e7587711f1182531f25459fa1f60c679bac10 and protected master 156c4b3ecfa27b9137c64068b3ed969e07efbe49. Publication uses all three real parents. Both parent versions of the original ten affected files and the protected-master supplement are archived with exact hashes.

The existing semantic-anchor completion, coarse-pointer radius, pane-correct deduplication, unconditional completion repaint and current quarantine removal remain intact. A one-gesture completion guard consumes the trailing double-click after a variable Path already committed. A fresh pointer press resets the guard so later editing remains available.

Actual testing found a second problem: repainting an already selected drawing on the first press detached its hit node before Chromium could deliver the fresh double-click. The bounded repair repaints on a selection change and keeps the existing node when selection is unchanged. Clone selection, drag initialization, lock handling and ordinary editor behavior retain their current owners.

## Discriminating proof

The unchanged original new case was first exercised against the integrated dependency and reproduced the late-double-click Settings failure. The guard repaired that path. A stronger second check then observed that an actual fresh mouse double-click failed to arrive because the node was replaced. The selection-continuity repair passed the same strengthened case.

The final case records actual trusted input: completion without a trusted native double-click, followed by two trusted fresh pointer presses and one trusted native double-click that opens Settings on the same completed drawing. The existing synthetic late-tail injection remains a separate targeted event case. No fresh-edit claim relies on a synthetic double-click.

All earlier attempts and their specific failures are retained. The proof does not turn desktop-only skips into mobile passes.

## Current validation

- The full affected drawing, professional editing, chart-reset and crosshair/price-label selection passed: 89 successful cases, 94 existing project skips, no failure or flaky case, zero retries, 634.82 seconds.
- All 25 drawing unit tests passed. Full TypeScript passed in 42.69 seconds.
- ChartPanel has the same 200 existing lint diagnostics as the actual dependency; the drawing spec has the same seven. Neither adds a diagnostic or disables a rule. The first validation wrapper stopped at the inherited spec diagnostics; the continuation records the comparison and retains the already passed unit/type stages.
- The existing complete CI evidence owner finished in 385.54 seconds inside the unchanged 54-minute owner / 55-minute workflow budget. PL6 and VI children returned successfully, the current 50-case composition selected, and the owner captured the required current five-image Options-axis packet.
- A leftover VI Next lock was reconciled after capture success using the recorded server identity, process/listener/open-file and same-user working-directory absence, followed by an immediate file-identity check. Only the stale file was removed. No capture was repeated, no server was killed, and process-group absence was not inferred from a closed port.
- All 18 final selected evidence consumers passed against the actual composition.
- The 1,938 observed source entries remained stable. Current images, reports, owner receipts and lifecycle reconciliation are retained.

The diagnostic owner identifier is local validation provenance, not a GitHub Actions run. GitHub checks and merge-queue acceptance still govern merging. Production, SQL, producer, deployment and existing reserved controls remain binding.

## Publication

Publish this exact qualified tree on the original branch using an exact-head compare-and-swap. The old scoped integration/proof hold can be resolved by these current results after control readback; ordinary merge-on-green and native auto-merge remain subject to repository controls. No unrelated hold is cleared.

Excluded raw diagnostic logs are individually inventoried by hash and size. Historical evidence files, image packets and report-bound artifacts are preserved.

## Diagnostic trace packaging

GitHub rejected the original 55.99 MB trace blob with a definitive HTTP 422 input-size response. The two large failed-attempt traces are preserved as ordered 4 MiB parts with exact original SHA-256, byte count and Git blob identity. Run restore-diagnostic-traces.py to reconstruct their original trace.zip paths and verify every part and final byte sequence. This changes archival packaging only; reports, source, assertions and accepted capture outputs are unchanged. The original rejected request and its 24 acknowledged smaller immutable blobs are retained and reconciled. No branch publication occurred in that attempt.
