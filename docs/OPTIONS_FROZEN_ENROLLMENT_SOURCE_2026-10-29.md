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
UUID. The dormant private caller confirms PREPARE retention of that complete pin
before run()/ARM; it never manufactures an identity after a historical UNKNOWN. Exactly one `alerts.frozen_enrollment`
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

## Accepted baseline verification frontier

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

Root independent changed-risk review SOURCE_ACCEPTED exact785789a5 after the
final34-case PG result and final test/source hash verification. Canonical accepted
disposition is1182 comment6526842110. The new caller delta below requires its own
scoped changed-risk review before publication.
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


## Dormant caller and crash recovery — October30 followup

Commission:1182 comment6526919133. Existing SQL/envelope/0046 phases are unchanged.
`createFrozenNodeInitialEnrollment().retain()` snapshots and confirms the complete
pin through the existing PREPARE. It returns retained only for the original call
that actually created the exact PREPARED slot. `run()` consumes that same-instance
confirmation, revalidates current Auth/canonical account/exact selected source,
then dispatches at most one ARM. Without explicit retain, compatible run performs
those same steps internally. A pending/error/timeout/late PREPARE cannot dispatch;
concurrent run calls share one retained result, never a new UUID or second ARM.

`frozenNodeEnrollmentCaller.ts` adds a dormant PRIVATE SERVER capability. Its full
pin parameter and transport capabilities are server inputs, never authority from
public request JSON. It obtains the actual cookie-authenticated Supabase client,
verifies getUser against the exact session bearer and reads the authoritative row
through owner RLS. It then uses the actual existing account/source verifier and
service RPC, with full row/predicate/current intent token CAS still enforced.
Public POST/PATCH/UI/reader opt-in and main publisher are unchanged/off. The helper
does not create a frozen alert, mint attempts or enable enrollment.

Read-only `reconcilePersistedFrozenNodeEnrollment({alertId,attemptId}, transports)`
requires a KNOWN original immutable attempt reference. The identifier is a selector,
not permission: current authenticated owner RLS first locates the saved complete
pin; current account/exact-source admission then gates privileged reconciliation
and historical acknowledgment disclosure. A replaced receipt with another valid
attempt, changed owner, deleted/missing receipt or absent reference remains UNKNOWN.
No latest-attempt lookup, run/fence capability or automatic mutation is returned.
The exact saved COMMITTED acknowledgment remains historical/currentState unavailable
after same-owner predicate/token/runtime changes; no currently-armed claim is made.

Unavoidable held case: if the first retention response AND the caller's original
attempt reference are both lost, recovery is unavailable. A receipt lookup by
alertId alone cannot attribute it to the original invocation after deletion/ABA.
PREPARED found on restart remains pending/UNKNOWN and cannot regain dispatch;
explicit fence remains a separate admitted operation, never automatic recovery.
This source slice does not add durable request-reference storage or a public
caller/creation path, and claims no recovery from physical receipt deletion.

New affected checks:77 enrollment/caller Vitest cases PASS (including23 new cases),
scoped TypeScript and affected ESLint. Existing34 actual private-PG/81 unchanged
account/source/resolver TS checks remain reusable because SQL/account/source are
unchanged. Original first focused run53PASS/1FAIL exposed an old test mock holding
EVERY getSession call; the explicit second admission now needs the mock to hold
only its intended first call. That fixture change preserves the pin/method
mutation discriminator; no timeout/assertion/runtime weakening occurred.

Distinct admitted Fabric leaf `oem-01a156f1-enrollment-retain-tests-v1` ran under
original root01a156f1/parent01a15700, GLM5.3Flash/ubuntu3, controller97581 consumed0.
Same-ID5118B plain result was consumed directly (no denied artifact export). Two
returned nonduplicate discriminators, retain-time denial and late PREPARE timeout,
were integrated and passed; other scenarios overlap existing coordinator cases.
Deterministic acceptance is scoped to those verified test contributions, not
independent production review. Usage receipt is MISSING; no budget reset claimed.

At the one eligible source boundary remote1182 remained OPEN/Draft/no-auto/no-labels
on accepted785789a5. Natural CI41083075458 had11 responsive shards in progress and
no failures at that observation. No observer/manual CI was created. The caller
delta remains LOCAL pending root independent changed-risk review and normal FF
publication to the same Draft carrier; no runtime effect is authorized here.

## Prospective entry composition — disabled-default source followup

Commission:1182 comment6527394858. This slice connects the actual ExposureMap
selection to the existing alerts POST owner, accepted caller and read-only restart.
No new endpoint/RPC/server registry/SQL/role/server store or IW2 Plan/Save lane is added.
Both `NEXT_PUBLIC_MM_OPTIONS_FROZEN_ENTRY_ENABLED` and the independent private host
`MM_OPTIONS_FROZEN_ENTRY_ENABLED` are absent/OFF by default. No configuration,
installation, target-DB application, source acquisition, enrollment or send is
performed by this source work. Live quote/evaluator/publisher remains unavailable.

The actual selected entry is keyed by full map identity PLUS selected strike and
owner. It builds a target ONLY from the frozen native `reportedGamma(lens)` book,
full-source value fingerprint, exact source binding and all selected-price members.
Other metrics, shocked/scenario values, chart nodes and Plan legs cannot supply it.
Source/root/lens/metric/shock/strike or account drift invalidates the original
asynchronous issuance/confirmation. Keyed remount/layout cleanup clears the visible
confirmation without clearing the retained operation. Default-OFF selected-node
mount performs zero entry Auth/fetch/storage work.

Protocol on EXISTING POST `/api/alerts`, explicit `x-mm-frozen-entry: v1` header:

1. `issue` validates actual Auth/current canonical account/exact selected source
   and returns a non-effectful descriptor `{schema,alertId,attemptId,principal,
   predicate,lens,issuedAt}`. Its UUIDs/reference are selectors, not signed grants;
   DB intentRevision does not exist until creation and is never fabricated.
2. The browser holds an account-specific native WebLock across issuance and exact
   localStorage write/readback. One bounded128KiB owner slot retains the COMPLETE
   descriptor. Corrupt/unreadable/occupied storage or missing/unavailable lock
   refuses dispatch. Other owners use disjoint keys. No credentials, Auth bearer,
   account payload or raw source book is stored. Browser readback is identifier
   retention, not guaranteed hardware durability or server permission.
3. A SEPARATE explicit confirmation by the same original controller rechecks
   current owner/selection, writes and verifies its `dispatched` marker under that
   lock BEFORE sending. Current-owner waits are bounded5s; late Auth cannot resume
   storage or HTTP work. Lock completion is normal, never forced/released by hand.
4. Server `enroll` again validates actual Auth/account/source and the existing50
   owner-alert cap. It uses INSERT ONLY for the issued id. Error, timeout or occupied
   id never reads/adopts an existing row to continue. Only the confirmed returned
   exact owner/predicate/active row and real DB-generated intentRevision form the
   full pin. Existing confirmed PREPARE then one original-instance ARM follows,
   including its fresh admission and SQL token/CAS/prepared-publication checks.
5. Restart never reconstructs dispatch. Explicit `reconcile` uses the retained
   exact `{alertId,attemptId}`, owner RLS and current account/exact original source.
   Missing/deleted/replaced receipt stays UNKNOWN. A historical commit response
   names ORIGINAL root/price/session/reference even if another node is now selected;
   it never claims current activation. Generic POST/PATCH/other alert families are
   unchanged; generic frozen POST remains rejected.

Journal lifecycle: `empty -> retained -> dispatched`, or `empty -> reference_unknown`
after a KNOWN missing-reference recovery. That hold uses the SAME slot with no
fabricated descriptor/UUID. It disables new issuance in the same journey and across
remount; a fresh profile cannot detect physically erased prior history. One unresolved owner slot,
no expiry, timeout-based clearance, eviction, replacement, latest lookup or automatic
fence. Once sent/uncertain, an empty server read is not permission to create again.
This module offers NO disposal or retry API. An explicit recovery read with missing
local reference returns UNKNOWN and never issues a UUID. Complete browser/site-data
loss cannot reconstruct the old original reference; no hardware persistence, global
cross-device history or recovery from physically deleted receipts is claimed.
Issuance-response loss itself has no alert/lifecycle effect. Clearing/forging client
storage is not server authority; every server effect still requires actual Auth,
current canonical account and exact source, and duplicate same-id creation has only
one INSERT creator. Stateless issuance is not a cryptographic storage attestation.

The new shared browser journal leaf was admitted as
`oem-01a156f1-entry-reference-journal-v1` under original root01a156f1 and parent01a15700,
GLM5.3Flash/ubuntu1. Original controller82236 consumed0; same-ID6404B plain result
consumed, no refused artifact export/retry. Coordinator integration added owner
binding, read-size-before-parse protection and invalidation of escaped slot methods
after lock release. Tests cover those repairs and real shared-lock two-tab admission;
acceptance is deterministic integration, not independent production review. Usage
receipt MISSING. Root independent changed-risk review remains required for final
new source; earlier787 review is reused only for unchanged retain/run/RPC semantics.

Affected checks:44 new composed actual-route/caller cases,7 actual rendered
component cases,13 incumbent route regressions (64PASS total), scoped TypeScript,
affected ESLint (zero errors; one unchanged ExposureMap unused-read warning),
local Next production build. Actual parent A-issue -> strike-B remount regression
proves no retention/enrollment and no stale confirmation. Known missing-reference
recovery prevents subsequent Prepare in both the same journey and parent remount.
The visible condition states0.5% proximity; original root/price/session stays visible
while UUIDs live in a closed keyboard-accessible details disclosure. Hung-owner cases before
issuance and after dispatch marker release the lock normally with no late POST.
Other cases include non-effectful response loss, retention failure, pre/post-effect
crashes, independent concurrent tabs/direct submissions, lost INSERT/PREPARE/ARM
replies, exact-reference ABA/deletion/account swap, source/account revocation,
forged input/origin,50cap and default-OFF zero effects. Existing34 private-PG and77
accepted helper cases remain reusable because SQL and helper are unchanged.

Six local headless synthetic actual-component preview captures plus one expanded
keyboard disclosure passed EN/ZH at1440x900,820x1180,390x844 with zero page errors/overflow.
They substitute mock Auth/non-effectful mock issuance and allow only the local fixture origin; they are layout/source proof, NOT actual
Chrome, live source, enrolled runtime or production acceptance. No actual-provider
screenshots/inputs are added to this public repository. Host flags, exact0046
installation, source/account readiness and any real operation remain separately held.

Local component tests used Node26 `--no-experimental-webstorage` to let jsdom own
its real browser Storage; this avoids Node26’s unavailable native localStorage
shadow. No runtime/source permission or application behavior was changed for it.

## Production publisher assembly — October30 source followup

Commission:1182 comment6528692543. Root01a156f1 resumes this same clean writer
from accepted776468f2 after coordinator01a15700's completed push/comment. The
coordinator is idle/interrupted and absent from native agent inventory; direct
app-server continuation returned a multi-agent-v2 refusal and was not retried or
rerouted. No live writer, lease or uncertain publication was taken over.

The existing production main now passes the existing FrozenNodeHitPublisher bound
to the identical lifecycle adapter into run_once ONLY when host configuration has
both OPTIONS_FROZEN_READER_ENABLED=1 and a separate
OPTIONS_FROZEN_PUBLISHER_ENABLED=1. Publisher switch absent/empty/0 returns None;
malformed or incomplete explicit opt-in stops before runtime execution. This is
source wiring only; no environment file or host configuration was changed. Reader
and entry flags alone still cannot publish. The publisher does not grant source,
account, generation/epoch or run-marker admission. Existing run_once retains its
exclusive pending-run acknowledgement, exact atomic PREPARE/commit, no-retry
UNKNOWN handling and dry-run fences. Delivery email/webhook admission is unchanged.

Actual main tests execute production service/publisher assembly and run_once with
isolated account/source/REST fixtures. Positive fixture reaches existing prepare
then commit and one synthetic outbox result; negative principal, denied rights,
future source clock, prior UNKNOWN run, incomplete config, disabled publisher,
dry-run and lost prepare/commit responses cannot publish/retry. RPC responses are
synthetic transport evidence, not a new claim of real PostgreSQL atomicity.
51 affected tests pass; five pre-existing optional cross-repository reader tests
skip without OPTIONS_FROZEN_MACRO_SOURCE. Their unchanged earlier accepted evidence
is retained, not claimed rerun. Initial test fixture used priorState with revision0;
correcting it to revision1 and subclassing the actual reader restored valid fixture
admission without weakening production checks. Independent non-author review of
this changed exactly-once composition is required before Draft publication.
All SQL, account/source policies and delivery contracts remain unchanged. No DB
apply, real account/provider request, enrollment, publication/send, activation,
merge/approval or deployment occurred. Runtime prerequisites remain separately held.
