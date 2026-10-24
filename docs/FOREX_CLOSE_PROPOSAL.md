# Forex close proposal preparation

Status: **inert implementation preparation; HOLD for review and integration**.

This module prepares and checks the proposed handoff from the existing Macro
closed-price evaluator to a future Terminal atomic enqueue boundary. It supplies
no source reader, database client, credential reader, CLI, engine registration,
activation path or delivery transport. A ready result is a proposal, not
source admission or an outbox receipt.

The current 0038 account contract still requires inactive conditions with a null
feed. Those actual rows withhold. The source policy remains
CANDIDATE_NOT_ADOPTED; neither these fixtures nor this module adopts it.

## Existing owners and exact interfaces

- Macro policy: [macro PR10052](https://github.com/mastermindx-market-intelligence/macro/pull/10052),
  published source e2169fe462017d849b525c16dd44d2f45a69393a.
- Canonical predicate: engine.forex_alerts.evaluate_price_condition(rule, bars, *, now).
  Git blob aea6b913a9642a34b6cfb26657c0c970ee639ede. No price predicate is copied here.
- Existing Terminal identity: condition_version(condition) and
  mint_fire_event_id(alert, vintage) from ingest/alerts_engine.py.
  These are explicit injected callables, not a new event-identity algorithm.
- Terminal integration base: 725764d24ec0c003d2a68fe20a004523a9614ec2, including the
  merged Options preparation. The two identity function ASTs are unchanged from
  acquisition base ec1e45ec29ced091b3721da77702d57e720ae588. Forex does not reuse
  Options frozen_runtime or alter its engine/API/SQL paths.

prepare_forex_enqueue(alert, qualified_snapshot, *, expected_owner, now,
evaluator, condition_version_fn, mint_fire_event_id_fn) returns ready,
not_met or withheld. Only ready carries a detached strict-JSON
PreparedProposal. Preparation cannot enqueue or disarm an alert.

submit_prepared(proposal, *, enqueue, condition_version_fn,
mint_fire_event_id_fn) first validates the full proposal and binds its condition
version and event ID through the incumbent identity functions, then invokes the
explicitly supplied enqueue callback once. Its response is typed as
accepted, replayed, withheld, conflict or unconfirmed. Exceptions and
malformed acknowledgements remain unconfirmed. There is no retry, legacy
Supa.fire, direct outbox insert or disarm fallback.

These function signatures define a proposed internal DTO. They do not establish
an installed SQL relation, RPC, privilege or authenticated source-reader API.

## Proposed source-owner readback

The required snapshot has:

| Field | Meaning |
| --- | --- |
| schema | forex.qualified-source-snapshot.proposal.v1 |
| scope | Exact feed, USDJPY, 4H, fx-utc-4h/v1, literal quote basis |
| policy_id, policy_adopted, state | Expected adopted owner policy and eligible state |
| generation | Positive, non-boolean signed-bigint eligibility generation |
| manifest_ref, manifest_sha256 | Immutable owner manifest reference and lowercase SHA256 |
| observations | Full supplied ordered window, including supporting observations |
| eligibility_deadline | Optional earlier not_after, nonempty reason and evidence ID |

The exact feed is tiingo.fx.USDJPY.reported-close.utc4h.local/v1.
Each observation contains the existing evaluator's 13 fields plus bar_start.
The module checks exact convention, revision1, finite literal close, complete
4H slot boundaries, logical observation ID, UTC slot sequence, full-window
contiguity and original fixed expiry. The full supplied window reaches the
canonical evaluator; tail selection cannot conceal an earlier duplicate or
conflict.

The snapshot must eventually originate from the qualified authenticated source
owner. **A dictionary containing policy_adopted=true or state=eligible is
not proof of eligibility.** This module validates expectations only. No raw
candidate-to-final conversion is supplied.

Rule JSON retains its strict key set, exact identity/revision and canonical
stored UTC .mmmZ expiry. The module does not fill a null feed, activate an
inactive row, add condition.triggered or normalize the stored numeric values.
Incumbent identity hashes the exact condition serialization; a future SQL
implementation must qualify its condition-version agreement instead of inventing
a different hash or assuming number/text round trips are interchangeable.

## Identity, clocks and effect boundary

The selected observation ID is the SHA256 of the compact ASCII six-string
contract/pair/interval/calendar/start/end encoding. Timestamp checks preserve
the represented precision, including nanoseconds; a fractional boundary is not
truncated into a valid slot.

Vintage uses the exact ordered ID/revision tail actually evaluated:

~~~text
forex-4h/v1:sha256:SHA256(
  compact ASCII ["forex-price-close-window/v1", exactFeed,
                 [[observationId, revision], ...]]
)
~~~

The documented two-observation vector remains
efc8b496369b6aa9faa5a13637df9af548ddf4bbd8e57676247eb8cb576cb155.
Manifest, generation and readback/evaluation clocks do not enter vintage.
A new explicit re-arm revision changes the incumbent condition version and event
ID even if the still-valid vintage is unchanged.

Every source slot expires exactly 14,400 seconds after its interval end. Only the
newest evaluated slot must still be fresh; older supporting slots may have
expired. Proposal not_after is the minimum of rule expiry, newest source expiry
and any earlier authoritative eligibility deadline. Equality is expired; readback
never renews the deadline.

The prepared request includes owner/alert/revision/condition version, full
condition, scope/policy/generation/manifest, selected window, stable vintage,
event ID, evaluation evidence/digest, preparation clock and deadline. The
submission preflight verifies internal consistency without repeating the price
predicate. Mutable inputs and callback arguments cannot modify the retained
proposal.

The future transaction still owes:

1. Actual authentication and minimal grants, with no direct Forex outbox bypass.
2. Owner advisory -> source fence -> alert row lock order.
3. Fresh database wall time after blocking locks and revalidation of actual
   owner, active intent, revision, condition version, source generation,
   manifest, exact window and deadlines.
4. Atomic incumbent outbox insertion plus automatic disarm, with rollback and
   concurrency proof.
5. Exact-event reconciliation after an uncertain acknowledgement. A replay
   returns the first receipt/evidence and is explicitly historical; it need not
   match a newer equivalent manifest, generation or evaluation digest. Its
   original deadline can be expired and can differ from the current eligibility
   cutoff, but must be after the newest close and no later than the immutable
   rule/source expiry.
6. Forward account-validator/guard integration. Never reapply 0038.

An accepted callback fixture is not proof of database atomicity. The source
fence and independent policy review retain their original refused operations.
This independent adapter does not replace or replay the SQL proposal request.

## Executed qualification

The latest local run completed **2026-10-24T04:01:28Z: 85 passed**, including the
actual pinned Macro evaluator and the incumbent Terminal identity functions.
See forex_close_proposal_qualification.json for source and retained proof hashes.

The cross-repository test requires explicit FOREX_CANONICAL_PROOF_ROOT pointing
to a credential-free image containing the complete pinned Macro evaluator and
its original config/package source. It verifies exact Git blobs, refuses a root
.env, uses an isolated interpreter, exposes only the installed required
dependency roots, and blocks credential-file opens and network/process effects.
The evaluator function is not extracted or reimplemented.

Ordinary single-repository CI runs all local contract cases and explicitly skips
that one cross-repository case when the exact source image is unavailable. The
retained local run did execute it. All prices and clocks in these tests are
synthetic historical fixtures, not current adopted observations.

Tests cover current inactive/unbound rejection, malformed snapshots and clocks,
full-window conflicts/gaps, fixed expiry, exact deadline equality, stable reread
identity, revision re-arm, immutable proposals, evaluator contract corruption,
malformed pre-effect requests, one-call acknowledgement uncertainty and historical
replay. Follow-up cases reject valid-looking but incorrect event IDs before enqueue,
qualify identity-owner failure, and constrain historical deadlines to their
immutable rule/source window while allowing an original eligibility cutoff.
Existing identity tests run alongside them.

## Remaining release holds

No SQL, numbered migration, live outbox row, alert activation or delivery was
created. The original source-fence request
forex-r26-source-fence-proposal-20261024-sol-001 remains terminal/refused with
retry_allowed=false; its two proposed SQL/README paths remain untouched.
Its directory-custody repair and admitted continuation belong to the original
transport owner.

Independent review, source-policy adoption, actual transactional proofs and
coordinated validator/status integration remain necessary. F08 category consent,
expiry/pre-send suppression semantics and real delivery acceptance remain with
the shared delivery owner. This preparation cannot enable email or webhook
delivery and does not establish today's production operator flags.
