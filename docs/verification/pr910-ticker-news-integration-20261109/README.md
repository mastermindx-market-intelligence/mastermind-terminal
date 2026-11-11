# PR 910 — current ticker-news evidence integration

## Qualified result

The original news evidence lock is integrated with protected master. The existing current ticker-news spec can deliberately capture the original ten-image packet without replacing the newer editorial, recovery or Chinese/Hong Kong packets.

The new selector accepts only an unset value or ticker-news, and continues to require the existing TERMINAL_CROPS opt-in. The ordinary default capture behavior is preserved. Its invalid-value case was executed and refused before output mutation. All 103 newer packet files stayed byte-identical during both actual browser runs.

## Actual current verification

- The complete current spec passed 14 cases with 7 existing project-specific skips, no failures, flakes or retries.
- All ten intended images were freshly produced by that successful run in 431.50 seconds.
- All 1,938 rendering inputs were stable across capture. The manifest is bound to the actual source hashes and image bytes.
- Four existing evidence-lock assertions passed. Full TypeScript passed in 43.87 seconds, and both affected TypeScript files passed scoped lint with zero warnings.
- Root inspected current desktop English and phone Chinese live-feed and unavailable images.

The capture checkout HEAD remains the real original ed396f371a86c029ccfd26b67dc9fc981d49f35d. Its uncommitted protected merge and exact current source map are recorded separately. A future publication hash is not misrepresented as the capture checkout.

## Preserved failure and causal repair

The first full run passed thirteen cases but failed its matrix case during streamed route hydration. The News tab was attached inside the hidden streamed segment while both the loading skeleton and actual Terminal header existed. The shared Settings helper's strict header query therefore correctly refused an ambiguous match.

The bounded repair changes only that caller's existing 60-second readiness assertion from attached to visible. It does not change the helper, use first(), add retries, force a click, lengthen a timeout or alter product code. The later unrelated attached assertion remains unchanged. All seven tests and their seventy-two expect calls are retained.

The failed report, trace and returned packet remain preserved, including its four fresh unavailable images and six older baseline matrix images. That failed packet is not presented as ten current captures. A separate initial preparation check failed before any second browser execution; its source snapshot and reconciliation remain recorded.

## Evidence and lifecycle

Both real parents' original eleven-file packets are preserved before the conflict resolution. The original four evidence tests retain their executable assertions; only obsolete capture instructions changed.

The successful run closed its owned listener. Its recorded stale Next lock was reconciled by exact identity and process, descriptor, listener and workspace-activity absence before one unlink; final closure was read back. No other process was stopped.

Original and newer packet provenance, invalid-selector proof, both browser runs, traces, source snapshots, repair receipts, the exact current manifest binding and final consumers are included. Raw diagnostic logs stay in the owned workspace with a hash inventory; the structured reports retain their results.

Publication uses a two-parent GitHub-native commit and exact-head CAS on the existing PR branch. Required hosted CI and normal protected queue acceptance remain required. No deployment, new provider request, authenticated production session or live-news acceptance is claimed.
