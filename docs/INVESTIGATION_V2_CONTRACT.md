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

## Owner API read lifetime

A current `401` from `/api/investigations` (including its query forms) ends the
Workspace's existing private-view lifetime before parsing the response body.
It aborts that scope and clears displayed private detail and local admission;
it does not call SDK sign-out or clear the original owner's pending-save storage.
An unresolved write remains unresolved under its original operation. A stale
response from an older scope cannot end a newly rebound view. `403`, `404` and
`503` remain unavailable/refused reads, not invented sign-out or no-effect proof.
This is local display/admission fencing, not live authentication or cutover proof.

## Same-owner response-loss recovery

The operation lock and immutable receipt bind authenticated principal, operation UUID,
action, target, expected sequence, exact semantic manifest and capture intent. Exact
replay precedes CAS and returns the original result; changed reuse conflicts.
Direct table writes remain revoked and owner-only RLS protects all reads.

`GET /api/investigations?operation_id=...` is read-only. A miss remains inconclusive.
`PUT /api/investigations` reconciles the exact original command under the same operation
lock as apply. It returns an existing receipt or atomically records terminal `not_applied`.
A delayed original apply then returns that fence without creating any record or capture.

Receipt cap (I1): once reconcile returns a no-effect status for (principal, operation),
no later apply of that operation can commit. Apply and reconcile share one cap
definition (`investigation_receipt_capacity_reached_v2`, checked under the capacity lock
after the receipt lookup). At the cap, apply of a new operation returns `limit_reached`
and writes nothing; reconcile of a new operation returns the conclusive
`not_applied` with `reason: "limit_reached"` and writes nothing, distinct from
`unavailable`. A delayed original then also returns `limit_reached`, because receipts are
monotone: authenticated callers cannot delete them, no migration deletes them and the
only cascade is account deletion. A service-role receipt deletion voids I1. Existing
receipts still replay at the cap, changed reuse still conflicts, and each principal has
its own cap. Because no receipt is stored, a later receipt GET stays inconclusive; the
client keeps the conclusive answer locally.

Pending/uncertain UI offers only **Check original outcome**. It never resends a mutation.
Only an exact owner `not_applied` result without a reason permits **Try save again** with
a new operation UUID and retained draft. The at-cap `not_applied` ends the uncertainty with
a limit message, keeps the draft and permits neither the original nor a replacement; a
later new save receives `limit_reached`. An unknown reason stays uncertain.
Local storage is a principal-partitioned draft buffer, not an
outcome authority. On reload, a stored plain `not_applied` claim is not trusted: it
returns as uncertain, and the page reads the original receipt from the owner once,
read-only, without resending. A stored `limit_reached` rejection stays local: it shows
the limit message, keeps the draft, is not retryable and grants nothing. Other stored
definitive rejections (for example `version_conflict`) also stay local and show the
conflict message. Logout/account changes abort in-flight reads and clear the mounted
private state.

## Native Options Plan draft entry

The Workspace optionally registers `onOptionPlanAdmissionReady(admit | null)`.
Only an already-open fresh unsaved draft and a current ready authenticated lifetime
can admit a whole canonical `OptionsPlanDraft`; the anonymous preview carrier cannot.
The consumer calls `admit(candidate)` deliberately. Registration does not capture,
save, allocate an identity, clear an uncertain command or select a different subject.
The admitted detached/frozen Plan leaves the authored title, question and subject
unchanged. It uses v3 through the existing explicit Save command, with its captured
principal/epoch checked again before that command can be sent.

`onOptionPlanRevisionReady(read | null)` registers a pure current-lifetime getter.
`read()` returns `{id, revision, plan}` only for the acknowledged exact saved revision;
a stale account/epoch, departed selection or cleaned-up Workspace returns null.
Selection departure invalidates the previous getter synchronously; ordinary
same-record Edit receives a newly bound getter for its acknowledged saved Plan.
This is an authored-input read, not an immutable previous calculation. It performs
no payoff recomputation or source refresh. A future calculation must be explicit and
carry its own dated terms/source boundary through its existing owner.

`historyMode="embedded"` suppresses only the Workspace's programmatic route-history
writes for New/open/save, so the existing host retains its URL and navigation lifetime.
The default `"route"` behavior and explicit canonical links remain unchanged. Neither
mode serializes a Plan in a URL or creates another store/router. These optional source
interfaces do not enable live Save, change any SQL grant or clear cutover/release holds.

## Selected Earnings evidence and current rights

The immutable Earnings generation is a container, not a rights grant. The first new
baseline selector is `selection.field = issuer_release`. Its adapter requires one
byte-replayed issuer release with document identity, source SHA-256 and the already
verified event/company/generation binding. It emits a bounded reference projection,
selected source clocks (unknown stays unknown), container hashes/byte counts and a
separate selection fingerprint. It emits no transcript, QA, facts, excerpts, model
output, other source bodies, or whole workspace payload.

The no-scope selected baseline, saved review and platform-snapshot replay routes
supply `createSelectedIssuerReleaseReadOptions(user.id, request.signal)` using the
principal returned by the existing server `getUser`. This is a narrow executable
read policy, not a general source-family or whole-workspace grant. An absent
callback still denies; a historical `rp_public_primary_v1` label, a SEC-looking URL
or `byte_replayed` alone cannot authorize display.

The immutable owner may supply `acquisition_receipt` conforming to
`earnings_release.sec_acquisition.v1`. The checked-in schema and synthetic byte
vector are exact copies from Macro commit `2b17d6c4c3e03cfb49f6d3cd8c4ce781e9d3b607` (the synthetic byte
vector is unchanged from `2b4408859faf5002093000b6ecf6e4e69983d455`).
The consumer strictly validates closed fields, selected URL/hash/filing binding,
canonical HTTPS SEC filing URLs, at most five contiguous same-filing redirects
with raw Location validation, status 200, recorded entity/UTF8 digests and lengths,
strict decoder policy and a real acquisition timestamp no later than its immutable
generation cutoff. The producer computes that conservative whole-second cutoff
from actual observations, including acquisition; it is not a measured wall-clock
emission time. This bound uses the generation cutoff, not a carried-forward source
first-observation clock, and preserves sub-millisecond acquisition precision. Filing index and index-header URLs are refused. Valid records are copied
and deeply frozen. A present malformed receipt invalidates the owner record; an
old record without one remains readable by its existing non-grant consumers but
is unavailable to this selected read policy. No old timestamp or receipt is
synthesized. The entity is `requests.content` after content decoding, not raw wire
bytes. Parsing retained declarations does not independently replay acquired bytes
or prove the producer was correctly installed; producer qualification and actual
retained publication remain separate acceptance obligations.

`SELECTED_SEC_READ_POLICY` records the reviewed SEC public-filing basis, exact
acquisition-schema digest, read purpose, eligibility and exclusions. Its
`local_executable_policy.sha256:` revision hashes our canonical executable policy;
it is not an SEC-issued policy version or an external registry revision. The
policy does not grant transcript/QA, mixed Company context, model input, export,
owner writes, or use of SEC logos/artwork/trademarks.

For each selected document evaluation the authorization callback separately
receives a frozen `IssuerReleaseSourceContext`: the retained source URL,
`provenance="retained_owner_metadata"`, optional validated acquisition receipt,
and current request scope. The server creates a fresh `checked_at` evaluation
clock and binds the decision to the exact authenticated principal, `read` action,
`investigation.selected_issuer_release` purpose, company, event, generation,
document and source digest. An acquisition later than the evaluation is refused without truncating its
microseconds or nanoseconds to the request clock's milliseconds.
Review evaluates the saved and current generations separately; replay reauthorizes
the saved root and every actual selected generation. A stale checked-at value,
other tuple/principal/purpose, or wrong policy version/revision is unavailable.

The callback context and current decision scope add no direct fields to
`IssuerReleaseIdentity`, the bounded selection projection or its fingerprint
formula. The acquisition receipt is part of the immutable raw owner JSON, so
newly retained receipt bytes legitimately change the existing container and
transitive selection fingerprints; identical retained bytes keep their existing
fingerprints. The decision carries its binding separately in selection rights;
acquisition and request clocks do not fill unknown source/publication clocks.
The checked-in emitted synthetic fixture retains two unique exact producer rows
and manifests (three cases including an identical refresh). Consumer integration
checks their original wire hashes, cutoff ordering, bounded selected projection
and retained replay. Its mocked acquisition date is not a live observation.
Synthetic tests establish this source contract, not real authenticated acquisition,
production source-use permission, migration qualification or release acceptance.

The shared baseline endpoint has two explicit consumer contracts. Existing IW2
requests without `scope` keep the selected issuer-release projection. The Company
retained-context client sends `scope=company_context` alongside either its symbol
or its exact four-field retained pin; only the whole immutable workspace resolver
may answer that scope. Unknown or duplicate scopes and mixed selectors are invalid.
The Company client continues to reject a selected projection, including one paired
with a superficially valid whole-workspace receipt; it never falls back to current.
The whole resolver is still called without an authorizer and refuses before
fetching retained generation bytes. The selected factory cannot be borrowed by
that scope. This separation repairs the endpoint/schema collision; it does not
restore the withdrawn public-primary grant, qualify full Company availability,
change the original admission/release holds, or assert producer installation.
Symbol bootstrap still reads the current owner to establish the exact company and
generation; the zero-retained-generation-read denial is not a zero-network claim
for that bootstrap. Client and server scope changes require coupled adoption:
an old server rejects the new scope, and an old Company client cannot treat the
new server's no-scope selection response as full context. These are fail-closed
availability limits, not transparent rolling compatibility.

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
