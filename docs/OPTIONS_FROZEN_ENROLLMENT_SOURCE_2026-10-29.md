# Exact-attempt enrollment source checkpoint

Canonical scope: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1181#issuecomment-6504246811

Current source receiver: native coordinator01a188db-21b5-7e31-a019-a0c1f784928d,
commissioned under verified native root01a1333c-a475-7052-95a8-72c623fb12e1.
The original Exposure programme remains01a156f1-f450-7793-8951-bddadd4784c2.
Takeover covers this isolated source follow-up only. Original Oct26 operations,
allowance and UNKNOWN effects are not transferred, adopted or replayed.

Workspace: `/Users/chriswong/mmx-worktrees/claude/53c10d576ba9ec02/exposure-writer-20261029-c9c303501767563e`.
Branch: `claude/ssd-exposure-writer-20261029-c9c303501767563e`.
Base: `729a781acdb639f9e8ef9aaaba043c7624b6ceda`.
Procedure pin reused: Mastermind `bb85b429f2ffffd38408080ce4df7d6378c34100`,
skillpack1.0.1, compatible bootstrap major1, INDEX/ACTIVE_EXECUTION.

## Bounded task tree

- E1: reserve0046 after complete current namespace census, package accepted
  intent unit after immutable0045 as one installer statement, rollback/reapply
  preservation checks. DONE_WHEN source and private-PG checks pass.
- E2: retain one exact initial-enrollment attempt on the owner-RLS alerts row,
  using the existing arm RPC family. DONE_WHEN crash/loss/concurrency and
  substitution negatives prove no second arm and no unrelated acknowledgment.
- E3: connect the dormant server composition to prepare/arm and explicit
  reconciliation. DONE_WHEN current auth/account/source checks precede every
  new run or reconciliation and restart cannot arm an existing marker.
- E4: fresh non-author permission/exactly-once review, draft publication only.
  DONE_WHEN assigning parent consumes exact source and records findings/verdict.

## Design boundary

The durable pin is the complete server-owned initial intent plus a caller-retained
attempt UUID. A future caller must save that pin durably before starting run().
This source does not invent or recover the identity of a historical unknown arm.
Neither the runtime generation nor a matching row is the attempt identity.

`prepare` creates an exact pin marker under the incumbent advisory and row locks.
Only that creating call returns prepared. A second caller receives pending.
`arm` requires that marker and stores the original CAS result in the same
transaction as runtime mutation. `reconcile` never arms: it returns the retained
terminal result, or atomically seals an absent/prepared slot, fencing late calls.
Current source/account/Auth admission is still required by the server composition.
The durable envelope contains no stored admission decision or bearer credential.

An owning authenticated user may read their envelope through the unchanged
owner-only alerts RLS. Other users cannot read it. This is intentionally not a
strict service-only secret column: doing that would break existing SELECT-star
consumers unless separately migrated. No policy/grant broadening is included.
The envelope guard protects identity and terminal outcomes even from accidental
service writes. An enrolled row's id/owner cannot be reassigned; delete retains
existing owner semantics and makes subsequent historical attribution unknown.
One attempt slot is retained for the row lifetime; this source does not add a
retry/rearm history or generic enrollment registry.

The six-argument CAS remains available for separately authorized lifecycle use.
It cannot write this envelope or impersonate an attempt. A later unrelated
runtime generation makes reconciliation conflict rather than returning its state
as the original attempt. Source readiness is separate from DB application,
service enrollment, activation, delivery and product acceptance.

## Delegation and actual controls

Fabric packaging run `exposure-01a188db-package-20261029` and independent design
review run `exposure-01a188db-design-review-20261029` both returned rc75 before
launch, no eligible admitted remote mode. Retained same-ID statuses confirm
REQUEST_REFUSED_BEFORE_LAUNCH, execution_absence_proven=true,
same_run_replay_allowed=false. No worker ran or received acceptance. No replacement
or retry was submitted. Local source integration continued under the installed
no-eligible-labor fallback; parent owns independent source review and consumption.

The default npm cache targeted the absent `/Volumes/Mastermind` and npm failed
with EACCES before a usable install. No mount directory was created or permissions
changed. Verification uses a private APFS copy of already installed dependencies
from the read-only sibling worktree; no shared dependency files are mutated.

No SQL was sent to a configured database. No opt-in, provider request, send,
activation, deployment, merge or approval is authorized by this source draft.

## Source verification and remaining boundary

- E1/E2:21 private PostgreSQL cases passed for0046 and exact-attempt recovery.
  Command: `python3 -m pytest tests/test_options_frozen_enrollment_postgres.py -q`.
- Namespace/ledger:102 cases passed (the combined invocation with the then19
  PostgreSQL cases returned121 passed). `PR_NUMBER=1182` native namespace check
  reports zero findings. Actual0046 application remains false/null.
- E3:100 TypeScript account/source/enrollment cases passed, with48 enrollment
  cases; TypeScript no-emit typecheck and focused ESLint both passed.
- Existing P09 packaging/prepared tests passed before the initial placeholder
  ledger schema failure; six actual Macro-drain interface cases skipped because
  no explicit Macro source fixture was provided. The ledger metadata was repaired
  using actual draft1182 and the namespace/ledger checks then passed. No skipped
  Macro runtime proof is promoted to acceptance.
- E4 remains assigning-parent independent permission/exactly-once source review.
  Draft-only publication is not merge, DB application, activation or product proof.

A reconciliation refusal caused by stale/missing/reinserted row or a different
runtime generation remains EFFECT_UNKNOWN in the composition. Only a terminal
envelope matching the original complete pin resolves that attempt's ambiguity.
Current Auth/account/source denial also grants no inference about prior effects.

**Account attribution incident:** the local CLI was verified as `mastermindxryan`,
but the GitHub connector used for draft creation returned `mastermindx-3` as the
actual author of1182, an excluded account under this commission. The assigning
parent was notified immediately. The confirmed draft was retained with its true
attribution; no replacement creation, merge or approval occurred. That connector
was not used again. Local source work and verified CLI use remain separate facts.
