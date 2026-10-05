# Investigation v2 — the single Terminal owner

The existing Saved Research / Investigation aggregate owns persistence. #777 and
migration 0028 established it; #804 and applied migration 0029 added exact Thesis
references. The kernel repair remains on #804 as forward migration 0030. Do not
edit or reapply 0028/0029 to install this repair. #804 remains Draft under the
integration review at comment 5989604142; local proof is not release approval.

## Closed command and canonical identity

Published `investigation_manifest.v1` keeps its 2,000-scalar / 64-KiB contract.
New `investigation_manifest.v2` commands require `schema`, `intent`, `layout_refs`,
`thesis_refs`, `evidence_refs`, `argument_relations`, and `continuation`, with only
`review_baseline_ref` optional. There is no generic metadata or source-body bag.

The v2 bounds are 160 title scalars, 4,000 question/continuation/annotation scalars,
16 typed subjects, 4 layouts, 16 Thesis references, 128 distinct evidence identities,
and 256 argument annotations. Layout and Thesis references do not consume evidence
slots. An optional baseline must be pinned and fully semantically identical to one
evidence member, including fingerprint and selection; it never consumes another slot.
Evidence identity is `(owner, object_type, object_id, mode, version_ref, selection.field)`;
fingerprint is not identity. Thesis identity is `(thesis_id, version_id)`, excluding role.

Each argument annotation has exactly `source`, `target`, `relation`, `rationale`, and
optional `discrimination_criterion`. Relations are `supports`, `weakens`, `contradicts`,
`unresolved_interpretation`, or `discriminates_between`. Endpoints name an existing
exact Thesis or evidence identity in the same manifest; they introduce no new reference.
Annotations carry no client author, clock, rights, confidence, or accepted-review claims.

Canonical v2 bytes are UTF-8 JSON with recursively sorted object keys, original array
order, compact separators, direct non-ASCII text and no trailing newline. Authored
whitespace, CRLF and composed/decomposed Unicode remain significant. The ceiling is
exactly 131,072 canonical bytes. TypeScript, Python and PostgreSQL consume the same
48-case kernel corpus, including exact byte boundaries. PostgreSQL persists SHA-256
of the final owner-prepared manifest in the immutable revision wrapper.

A present `research_as_of` is exactly `YYYY-MM-DDTHH:mm:ss.sssZ`, with a real Gregorian
date and time. Date-only, offsets, alternate precision and normalization to another
instant refuse. The G1 editor has no date-only input and invents no midnight cutoff.
A saved cutoff is intent, never a source's historical-availability guarantee.

## Immutable revisions and layout retention

`investigations` stores the mutable owner-scoped head, lifecycle and numeric revision.
`investigation_revisions` retains the integer as a sequence, with a server-minted UUID,
exact previous revision UUID, authenticated author (`user_id` exposed as `author_ref`),
originating operation UUID, manifest, digest and server timestamp. Scoped foreign keys
bind each parent to sequence N-1 and the head to its exact immutable row. Head, revision,
retained layout and committed receipt are atomic. Remove/restore preserve the manifest
and digest while producing a new revision identity and lifecycle.

Forward migration 0030 backfills identity only when each old row has exactly one matching
principal/target/action/revision/manifest receipt. Ambiguity aborts migration. Old manifest
values and historical operation results are not rewritten. The explicit stored-read
validator permits those pre-repair values unchanged; new create/revise commands use the
strict contract. Legacy operation recovery uses the same owner receipt and fence path.

`chart_layouts` remains current-layout authority. Capture intent is exactly
`{layout_id, expected_revision}`. Its owner mints or reuses one retained UUID for
`(user_id, layout_id, source_revision)` under lock. Equal bytes/digest reuse identity;
divergent content at the same source revision refuses. Retained N survives current
N+1 and deletion of the mutable layout. Reopen never writes the current head.
The layout digest retains the existing PostgreSQL JSONB owner law; it is not the
Investigation digest or a redefinition of `workspace_layout.v1` golden bytes.

## Same-owner response-loss recovery

The operation lock and immutable receipt bind authenticated principal, operation UUID,
action, target, expected sequence, exact semantic manifest and capture intent. Exact
replay precedes CAS and returns the original result; changed reuse conflicts.
Direct table writes remain revoked and owner-only RLS protects all reads.

`GET /api/investigations?operation_id=...` is read-only. A miss remains inconclusive.
`PUT /api/investigations` reconciles the exact original command under the same operation
lock as apply. It returns an existing receipt or atomically records terminal `not_applied`.
A delayed original apply then returns that fence without creating any record or capture.

Pending/uncertain UI offers only **Check original outcome**. It never resends a mutation.
Only an exact owner `not_applied` result permits **Try save again** with a new operation
UUID and retained draft. Local storage is a principal-partitioned draft buffer, not an
outcome authority; reloading a stored no-effect claim rechecks the owner. Logout/account
changes abort in-flight reads and clear the mounted private state.

## Selected Earnings evidence and current rights

The immutable Earnings generation is a container, not a rights grant. The first new
baseline selector is `selection.field = issuer_release`. Its adapter requires one
byte-replayed issuer release with document identity, source SHA-256 and the already
verified event/company/generation binding. It emits a bounded reference projection,
selected source clocks (unknown stays unknown), container hashes/byte counts and a
separate selection fingerprint. It emits no transcript, QA, facts, excerpts, model
output, other source bodies, or whole workspace payload.

The current rights dependency must supply a fresh `sec_edgar` display decision bound
to that document/hash, registry revision, policy revision and checked-at time. It is
injectable for owner integration tests and **absent by default in production**. The
baseline route therefore reports `rights_unavailable` until the existing rights owner
is admitted and connected. An old `rp_public_primary_v1` annotation cannot authorize
the mixed workspace. The previous broad authorizer now refuses; preserved G2/G4 source
foundations do not bypass that refusal. Source fixtures are not a production grant.

## Installation and proof boundary

0030 is not applied. Its safe rollback disables apply/reconcile grants and retains all
user history; recovery proceeds through reviewed forward repair or verified restore.
The migration is rerun against an isolated PostgreSQL database as part of the existing
Python all-tests CI job. Missing PostgreSQL binaries fail CI. Binaries are discovered
with `pg_config --bindir`; no separate Investigation CI denominator is added.

The integration review's raw-ingress requirement B5 remains outstanding pending the
original handoff's carrier restriction: do not copy or recreate the denied #792 follow-up.
The current HTTP body parser must not be claimed as strict UTF-8/duplicate-key proof.
New independent review, hosted CI, 0030 apply/readback, exact merged deployment and a
repeated real authenticated private journey are required before G1 release acceptance.
The earlier private save/resume proof remains a narrow historical receipt, not acceptance
of this repaired kernel or the full G0–G9 program.
