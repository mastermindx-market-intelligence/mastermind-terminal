# PR496 drawing caller deadline repair — 2026-11-11

Published basis: ad2c74fb576a82ff771c1f9a0a5cab975444640b. Natural CI43008544271 had27 successful jobs and two failures. Desktop1 job130482482161 was the underlying failure; the aggregate propagated it.

The bulk drawing callback invoked Auto Fibonacci without the callback's public test bound. All three hosted attempts refused before opening More, while the toolbar was settled, with4750/4963/5192ms remaining. The existing three-stage detector admission required6001ms. No detector product assertion had been reached.

Three toolbar-owning callbacks in drawing-professional-editing.spec.ts now create one test bound at callback entry and pass a fresh capped intent to each Replay, split or detector invocation. The pane detector closure keeps its owning bound across both invocations. Existing timeout,3-second test reserve,12-second invocation cap, stage admission and all product assertions remain unchanged.

Verification:37 existing deadline unit cases, focused ESLint and full TypeScript passed. All three affected desktop browser cases passed at one attempt each, with no skipped/failed/flaky/retried executions; this exercises seven actual toolbar invocations. Source stayed stable across4453 paths. Port57727 closed with no listener, lock handle or workspace cwd holder. The old lock pathname remained. Original comparison/layout/workspace proof was not repeated.

Actual capture HEAD was f664ba3d604934572ea50a98a8560abfac0631f8 and index tree815fba66fba0b2c41cec9847bf865979651cb8ce. The repaired spec was unstaged at capture; full source hashes bind its actual bytes. The index identity is not claimed to contain the new spec.

The archive preserves source preimage, validation logs, complete reports, source snapshots and three browser traces, with a complete member inventory and decompressed-byte readback.

Formal Changes Requested reviews5108504922 and5108886118 remain. Auto-merge stays off; fresh natural CI on the published repair is owed.

The complete archive is stored as ordered parts within ordinary Git blob limits. Concatenate raw-evidence.tar.gz.chunk-* in lexical order to reconstruct raw-evidence.tar.gz. receipt.json binds the complete archive and every part. Packaging initially stopped before output at a conservative 90MB size bound. A subsequent readback expression failed after writing the exact archive parts; recovery validated those existing parts without recapture or regeneration.

The Git blob API rejected the first64MiB part with HTTP422 input-size rejection. Original-target readback and the explicit response reconcile that request as EFFECT_NONE. The same unchanged archive is now represented as24 parts of at most8MiB through the same carrier. No source or browser execution changed.
