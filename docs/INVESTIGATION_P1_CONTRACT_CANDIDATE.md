# Investigation P1 — command-contract candidate

Workstream: `WS:DEEPVUE-INTELLIGENCE-WORKSPACE`. Program: Macro #8338,
research commit `90336ccdd7173dd856e9c00b81e267ab3cc7abb3`, first commission Task 1.
Protected procedure: Mastermind `d1594f3c7ae750db3f14b4eebf0de3460f84267a`.
Terminal base: `863f678658e2211b5a48daa99404686dfaa117f2`.

## Boundary

This candidate implements the pure `validateInvestigationManifest` input boundary.
It is not an installed Investigation feature or completion of P1. It introduces no
route, table, migration, identity registry, evidence store, Brain state, or scheduler.
No existing layout, Thesis, saved-filter, guest, phone, or sharing code is changed.

The owner convergence request remains Terminal #777 comment 5972964732. Its
Saved Research aggregate and migration 0028 are not modified or replaced. This
path-disjoint contract work does not take over that source writer. Final storage/API
placement and Macro's complete paired schemas remain held for owner convergence.
The `investigation_manifest.v1` spelling is a reviewable P1 command candidate, not
an assertion that the package's server head/revision schemas are already deployed.

Terminal source isolation uses its repository-specific worktree contract through
the installed external-SSD storage helper. The helper returned and its existing
receipt verified the operation-derived branch; no raw clone/worktree command,
Mastermind workspace override, or incumbent adoption was used. The separate
Mastermind-only launcher and unavailable Workbench canary do not erase this
repository-specific source-entry capability. Earlier denied census/search actions
were not replayed or routed through this acquisition.

## Contract meaning

The candidate retains exact authored title/question text, ordered typed subjects,
immutable layout ID/revision/digest references, exact Thesis versions, evidence
references, an optional pinned baseline request, and explicit continuation text.
No owner is admitted by default. Existing adapters supply supported owner/kind
pairs; this module has no adapter discovery, registry, identity mapping, or I/O.
Acceptance means only shape validity, never referent existence, entitlement,
qualification, successful persistence, or historical availability.

Title/question limits are 160/2,000 Unicode scalar values. Limits are 16 subjects,
4 layouts, 16 Thesis references, 128 evidence references, and 65,536 serialized
UTF-8 bytes. Both boundary and boundary-plus-one cases are tested. Input is not
trimmed, normalized, truncated, or repaired. Blankness follows ECMAScript trim;
question line endings/whitespace survive. NUL and unpaired surrogates reject
explicitly. The returned value has no mutable aliases into the input object.

Layout roles are `primary|supporting`; Thesis-reference roles are
`primary|alternative|context`. These are candidate view roles, not authoring
lifecycles. Evidence supports `pinned` with a required version, or `follow_head`
without a pinned version/fingerprint. A reviewed baseline request must be pinned.
P1 selection is a bounded field identifier only, never executable query text.
An absent baseline stays absent; validation does not manufacture zero change.

Server-authored principal/scope, clocks, qualification, reviewed-at stamps and
source content are rejected. Future argument/scenario fields are rejected rather
than dropped or falsely advertised as implemented. No macro scenario assumption
is migrated. UI view mechanics remain outside this research command.

Inputs must be parsed JSON data. Defensive checks also reject accessors,
nonenumerable/symbol properties, sparse/cyclic/exotic objects, and inherited Array
serialization hooks before serialization. This is not a sandbox for arbitrary
JavaScript proxies or a compromised host. Diagnostics and traversal are bounded.

## Verification and unresolved acceptance

Initial missing-module RED was followed by an explicit rejecting stub: 63 of 70
assertions failed for missing behavior. The first implementation passed 70 tests.
A new adversarial test then observed an inherited Array `toJSON` hook execute once;
rejecting nonstandard Array prototypes fixed it. The expanded suite passed 112
TypeScript tests, including the exact 65,535/65,536/65,537-byte boundary.

One 30-case JSON vector file is consumed by TypeScript and an independent Python
text-only oracle; its two unittest methods passed. This is text conformance, NOT
full Macro/TypeScript manifest-schema parity. Focused ESLint and full TypeScript
checking passed. Full project regression and independent review are separate
receipts and must not be inferred from these scoped results.

A read-only production PostgreSQL 17.6 expression check at
`2026-10-03T20:36:01.382977Z` confirmed: NUL, lone-high and reversed-surrogate JSONB
inputs reject; a valid astral pair is one scalar/four UTF-8 bytes; authored CRLF and
surrounding spaces round-trip. No table, user, membership, or application record
was read or changed. This is storage-type behavior, not a saved-user journey.

That probe also confirmed last-key-wins parsing of duplicate JSON object keys.
The eventual raw request/import boundary must reject ambiguous duplicate keys
before ordinary JSON parsing; this object-level validator cannot recover keys
already discarded by a parser. Raw request size must be bounded independently of
this compact serialized-manifest limit. The write owner must compute its canonical
payload identity; this module does not define an idempotency digest algorithm.

References: PostgreSQL 17 JSON types documentation, section 8.14,
https://www.postgresql.org/docs/17/datatype-json.html; ECMAScript TrimString.

Still required: Macro paired schemas, owner-authenticated reference resolution,
transactional immutable layout capture/CAS/idempotency/outcome lookup, approved
migration, UI integration, signed-in cross-device exact readback, actual approved
two-principal isolation/share/read/deny/revoke, independent integrated review and
all remaining P2–P9 obligations. DDL0022 is already present; do not reapply it.
