# PR #1270: place the current inbox evidence test with its capture owner

## What failed

Original natural CI 43093205282, attempt 1, checked out bb64f589909ec5e45558a28bf71202cfa377e7f1 (source cb2c8eb7 plus protected 568fa505). Unit shard 1 failed because f11_7RecurringBriefsEvidence.test.ts correctly rejected a committed inbox capture whose i18n and globals hashes differ from current source. The assertion actual value is the captured value; expected is the current source. The exact identities are recorded in diagnosis.json.

The shared inventory searched for composition and inline evidence-lock markers but omitted the delegated readInboxPacket call. The workflow already captures the current eight-view inbox in the evidence owner, then runs this inventory; independent unit shards exclude exactly the same inventory. Consequently, the missing suite ran against stale committed evidence in a different checkout.

## Bounded repair

Add readInboxPacket to the existing inventory. Keep every prior suite and add only the unchanged six-case inbox suite. Strengthen the existing contract test with explicit required inclusion, unchanged exact inventory comparison, mandatory inbox capture before the owner reader step, and the same shared-list exclusion contract. No workflow gate, hash validator, reader assertion, capture identity, product source, artifact policy, timeout, retry or new execution owner changes.

The original inventory selects 39 suites. The repair selects 40. A 40-file/278-test future owner result is expected, not observed by this local verification.

## Discriminating verification

The strengthened partition regression fails on the unchanged inventory at the explicit missing-inbox assertion. After the repair, all 104 affected partition/merge-group/aggregate/browser-setup contract tests pass. Bash syntax and git diff --check pass. Source hashes are unchanged throughout final verification. Only the two intended source files changed; all previous captures and proof remain byte-identical.

No browser recapture is needed to diagnose this partition defect. The existing inbox producer calls the same strict reader before adoption and after copying the full eight-PNG packet. The next natural CI must execute the relocated suite after the genuine current-source capture and must retain its actual evidence.

## Original negative evidence remains

The original evidence-owner log records successful captures and 39 files / 272 tests. That result excluded the missing inbox suite. The subsequent CreateArtifact operation failed after five internal retries received HTML instead of JSON; the original unit-evidence archive was not present in the retained artifact listing. This separate service/retention failure is not repaired by the source change or converted into retained browser acceptance. The complete obtained owner log and unit annotations are retained here; failed log reads were not replayed.

## Custody and delivery

The prior cb2c8eb7 publication was APPLIED with no pending effect. The managed D06 workspace's index exactly matched that published tree and had no unstaged/untracked source or live cwd holder. An exact-tree guarded mixed reset adopted the already-published commit without changing working bytes before this repair. The original PR remains the only publication carrier, Draft, with no labels and no auto-merge. Physical WK/Escape, authenticated installed/RLS, full D06 and cross-repository release holds remain.

Parent: https://github.com/mastermindx-market-intelligence/Mastermind/issues/2028
Operation: terminal-pr1270-inbox-partition-20261111-c3
Law pin: bb2c2e4437e6ee250f9d4ee9b6b420abdfbbc178

## Raw log retention

The original owner log is stored losslessly as `original-evidence-owner.log.gz`. Decompression yields exactly 217,763 bytes with SHA-256 `12c48ddc438314f1be42e58b2048c66eaa86051482755f371afa7139dc92476d`. The initial full proof diff check rejected trailing spaces in the raw log; lossless compression preserves those original bytes without editing evidence. The failed packaging check is retained in `packaging-recovery.json`.
