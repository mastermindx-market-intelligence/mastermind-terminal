# Exact-attempt enrollment source checkpoint

Canonical scope: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1181#issuecomment-6504246811
Existing source carrier: draft https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1182

## Current source custody — October30 recovery

Current receiver is native coordinator `01a15700-1ae2-7a73-9756-f1546da7ace8`
under the original Exposure root `01a156f1-f450-7793-8951-bddadd4784c2`.
The October29 writer `01a188db-21b5-7e31-a019-a0c1f784928d` executed under a
DIFFERENT recovery root `01a1333c-a475-7052-95a8-72c623fb12e1`; that historical
lineage is preserved, not relabeled. Its actual native turn is completed/notLoaded;
no original workspace is registered in either existing Git store and the scoped
process read found no active writer. This is source recovery, not adoption of any
live operation, lease, old provider allowance or UNKNOWN effect.

ONE isolated tree was admitted through `worktree_storage.py` as INTERNAL_FALLBACK:
`/Users/chriswong/mmx-worktrees/claude/53c10d576ba9ec02/options-frozen-enrollment-durable-20261030-716bbd05035883bc`.
Local helper branch: `claude/ssd-options-frozen-enrollment-durable-20261030-716bbd05035883bc`.
The installed helper hardcodes its legacy claude client path and exposes no client
selector. This exact admitted path/receipt was retained; no Codex-layout parity,
helper edit, unlock, remapping or duplicate writer is claimed. The clean local
branch fast-forwarded from protected729a781 to retained1182 source975203886.
Publication must fast-forward the ORIGINAL1182 remote branch
`claude/ssd-exposure-writer-20261029-c9c303501767563e`, never create another PR.

## Bounded source contract

0046 remains UNAPPLIED with application false/date null. Immutable0045 and the
accepted intent-revision stage remain byte-identical. The existing0046 reservation
and source carrier are reused; no new namespace claim is made. One atomic package
composes the accepted intent stage followed by the repaired enrollment stage.
Final readback requires only the seven-argument existing arm name; BOTH old five-
and six-argument arm signatures must be absent. No privately executable old CAS
or publicly callable unreceipted initial-arm entry is left behind. Existing-runtime
rearm is explicitly unavailable in this bounded INITIAL-only contract; the existing
state-only generation/revision CAS remains unchanged.

The server-owned durable pin is the entire frozen intent plus its original attempt
UUID. A future caller must retain that pin durably BEFORE run(), not manufacture
an identity after a historical UNKNOWN. Exactly one `alerts.frozen_enrollment`
slot is retained for the row lifetime; no automatic replacement, eviction, retry
history or enrollment registry is introduced. It contains no bearer, credentials,
account payload, raw source document or policy-verdict grant. A matching runtime
alone is NEVER evidence that an earlier uncertain attempt committed.

- PREPARE persists the exact pin under the existing advisory+row locks BEFORE arm
  dispatch. Only the creating call returns prepared; an existing marker returns
  pending. A timeout/crash of PREPARE remains UNKNOWN even if a later read is empty.
- ARM requires that persisted PREPARED slot plus CURRENT row token, active/full
  predicate and original principal. Runtime and its original acknowledgment are
  committed atomically in one row transaction. No old arm overload is callable.
- RECONCILE is READ ONLY, including in a PostgreSQL READ ONLY transaction. Empty,
  missing, deleted or PREPARED receipts remain UNKNOWN in the host; they never
  create a cancellation tombstone, arm or authorize a fresh attempt. A terminal
  exact receipt returns the ORIGINAL acknowledgment, independent of the current
  runtime, active flag or later same-owner predicate/token edits.
- FENCE is a SEPARATE explicit server-authorized action, never automatic restart
  behavior. It can close ONLY the exact persisted PREPARED receipt under the same
  advisory+row locks as ARM, even after a same-owner token/predicate edit because
  it grants no arming. An absent slot is not fenced or fabricated. ARM/FENCE have
  one terminal winner; delayed original dispatch cannot defeat a committed fence.

The dormant TS composition invokes the ACTUAL Auth/current-account/exact-source
reader before every action or explicit reconciliation read. Read results are not
cached across later account revocation. Mutation run/fence are one-shot and retain
UNKNOWN without retries or new IDs. Every successful receipt result is explicitly
`{kind: committed, intent, historicalRuntime, currentState: unavailable}`; it does
not claim that the alert is currently armed/active or expose a current-state grant.
Public POST/PATCH/UI, default reader, main publisher, opt-in and send remain OFF.

## Privacy, trust and held cases

The existing alerts RLS is owner-only. An authenticated owner can read their own
receipt, other principals cannot. No private envelope is placed in authenticated-
wide alert_runs. Unprivileged INSERT/UPDATE and caller-supplied JWT/custom role
claims cannot forge it. A retained receipt refuses id/user_id reassignment even
by actual service_role, avoiding cross-owner disclosure. Owner deletion retains
existing semantics: lost/deleted/reinserted receipts remain UNKNOWN, never retry
permission or attribution to a new generation.

SECURITY INVOKER and actual service_role/superuser trust are unchanged. Atomicity
and exact-attempt guarantees apply to callers using the admitted RPC. They do NOT
protect against arbitrary SQL from a compromised trusted service_role already
able to mutate protected runtime. No SECURITY DEFINER, role/grant expansion or
forgeable GUC/call-stack admission scheme was added.

A single retained slot deliberately blocks a different attempt; re-enrollment or
receipt retention after physical deletion is not implemented by silently adding a
second store. An absent result cannot settle a still-late PREPARE. These are explicit
held cases, not permission for replay, replacement or a new attempt UUID.

## Verification frontier — draft, not accepted

Current repaired TS source:135 focused cases passed (54 enrollment,18 source/action,
29 source-resolver,34 account-policy), scoped TypeScript and affected ESLint passed.
The retained October29 PG21 suite encodes superseded auto-fence/old6 behavior;
its current14PASS/7FAIL is NOT a completed qualification. Discriminating repaired
PostgreSQL test evidence must replace those seven expectations before acceptance.
Five additional principal-local discriminators ran on actual private PostgreSQL17.11:
all five fail against original975 SQL and pass against the repaired package (absent
read has no writes; actual READ ONLY transaction; six-arg bypass absent; original
ack after runtime/owner edit; explicit old-pin fence after owner edit). These
changed-risk probes do not replace the still-unresolved seven suite expectations.
Native namespace guard PR_NUMBER=1182 reports zero findings.
Root independent changed-risk source review is mandatory on the frozen final delta.
No merge, approval, target DB application, runtime activation or product proof is
claimed by this checkpoint.

Original October29 Fabric packaging/design IDs `exposure-01a188db-package-20261029`
and `exposure-01a188db-design-review-20261029` are closed rc75 prelaunch refusals;
no execution or acceptance is inferred, and neither was retried. The distinct
October30 test-artifact leaf `oem-01a156f1-enrollment-durable-falsifiers-v1` retains
original root01a156f1 and immediate parent01a15700/controller56237. Its latest
supported observation is ACTIVE_OR_WAITING, worker UNKNOWN, no verified START or
quality acceptance; no replacement or allowance reset is permitted.

The original1182 connector attribution incident is preserved: CLI was verified
as mastermindxryan, but draft creation used connector account mastermindx-3, an
excluded author under its commission. No replacement PR was created. Recovery
uses only fresh-verified permitted CLI identity; historical attribution is not
rewritten or silently accepted as current authentication.
