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

## Verification frontier — local qualification, independent review pending

The final affected suite has34 PASS in39.19s on actual disposable socket-only
PostgreSQL. It replaces all seven superseded expectations with discriminators:
read-only absent/PREPARED snapshots and actual READ ONLY transactions; real
concurrent reconcile versus late prepare/arm; explicit fence versus arm one
terminal winner; original commit acknowledgment after current generation AND
same-owner predicate/token changes; missing/deleted receipt UNKNOWN; old5/6
signature absence; cross-owner read isolation and identity-transfer refusal;
JWT/custom-role forgery denial; no slot eviction; atomic rollback/reapplication;
unchanged state-only generation CAS and explicit initial-rearm refusal.

The first local run had32PASS/1FAIL because the local helper json.loads tried to
parse psql's empty text for SQL NULL in the new delete/reinsert case. Correcting
that test helper to return None for SQL NULL preserved missingness; the complete
final34-case run passed. No production code changed after frozen f31041ba.

Reused source checks:135 focused TS cases (54 enrollment,18 source/action,
29 source-resolver,34 account-policy), scoped TypeScript and affected ESLint pass.
Five separate principal-local PG discriminators are all RED on original975 SQL
and all GREEN on repaired SQL. Immutable0045 and accepted intent-stage hashes
remain exact. Local namespace guard returned zero findings in LENIENT mode;
this is local consistency only, NOT hosted PR-scope/native strict qualification.
No manual CI/observer or known-red publication was used.

Root independent changed-risk source review consumed frozen f31041ba and found
no additional blocker on R1/R2/R3; final changed test diff/source snapshot still
requires its independent acceptance before any normal FF to existing draft1182.
Draft status/no auto-merge/approval/application/activation remains mandatory.

## Settled Fabric return and exact delivery refusal

Original October29 Fabric packaging/design IDs `exposure-01a188db-package-20261029`
and `exposure-01a188db-design-review-20261029` remain closed rc75 prelaunch refusals;
neither was retried. Distinct October30 test-artifact run
`oem-01a156f1-enrollment-durable-falsifiers-v1` retained root01a156f1 and immediate
parent01a15700. Its ORIGINAL controller56237 was consumed exit0: actual lease and
launch are now verified, with terminal DONE at2026-10-30T14:57Z. The controller's
7200s wait bound was never a worker termination deadline. Usage receipt is MISSING.

The same-ID4196B result was consumed (SHA256
`5c5e1ff6abe7bf7b9f43e740bf11944e0bc64bc5b8437bfffdd1fe9bb7694699`).
Its advertised artifact was NOT delivered: the first supported export returned
rc75/REFUSED at destination_reservation, diagnostic
`destination_outside_approved_evidence_root`. Read-only source diagnosis found
artifact_delivery.py hardcodes `/Volumes/Mastermind/evidence`; the native alias
mapper does not map unrelated evidence roots. No policy edit, alternate export,
reader, destination, retry, replacement worker or allowance reset occurred.

Verdict: NOT_ACCEPTED_AS_DELIVERED. The artifact bytes were never inspected or
validated; exit0 is not quality acceptance. The supported accept command exposes
only positive `--by deterministic|reviewer`, so it was not invoked; the actual
adapter projection remains accepted=false/NO_OUTCOME, not a fabricated negative
ledger write. Root separately authorized local completion after execution was
settled, using already-local tests and accepted contracts. No denied artifact
bytes were reconstructed/retrieved or used as passing evidence. Local34PG proof
is principal-authored verification, not independent Fabric review.

The original1182 connector attribution incident is preserved: CLI was verified
as mastermindxryan, but draft creation used connector account mastermindx-3, an
excluded author under its commission. No replacement PR was created. Recovery
uses only fresh-verified permitted CLI identity; historical attribution is not
rewritten or silently accepted as current authentication.
