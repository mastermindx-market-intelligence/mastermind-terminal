# Investigation v2 — #777 integrated owner

This document supersedes the implementation scope of the plan-only Saved Research
proposal on #777. The Chairman authorized continuation past the unfinished
Executive/source-custody backend on 2026-10-03; #8338 comment 5976062668 records START.
No separate Saved Research tables are introduced. Migration 0028 belongs to #777.

## Envelope

`investigation_manifest.v1` remains the published 2000-scalar / 64-KiB contract.
`investigation_manifest.v2` uses the same typed reference grammar, with a 4000-scalar
question, 4000-scalar continuation fields, and 128-KiB serialized UTF-8 envelope.
Title is at most 160 scalars; subjects at most 16; layouts at most 4; Thesis references
at most 16; all layout/Thesis/evidence references together at most 128. Author text
retains whitespace, CRLF, and composed/decomposed Unicode exactly. Unknown fields,
unsupported owner/kind combinations, invalid scalars and source/layout/AI bodies
are rejected. Future relation/notes/scenario fields require an explicit contract
extension; this G1 slice does not advertise them as implemented.

JSON object order is not mutation identity. Arrays and exact string values are.
The PostgreSQL RPC fingerprints its typed JSONB request, including principal,
action, target UUID, expected revision, manifest, and optional layout capture.
This fingerprint is a server operation identity, not a cross-language layout hash.
A principal-scoped operation UUID is locked before its immutable receipt is read.
Exact retries return the original committed result before evaluating current head,
layout state or reference availability. Changed reuse conflicts. A second target
lock serializes create and compare-and-swap. Failed validations commit no rows.

## Layout ownership

`chart_layouts` remains the mutable current-layout owner. `chart_layout_revisions`
is its owner-native immutable retention table. Investigation only stores references.
An explicit save can request retention of a named owned workspace with an expected
workspace revision. The transaction reads the owner row under lock, retains its
exact configuration, inserts the reference, and commits the Investigation revision
and operation receipt together. Opening an Investigation only reads retained rows;
it never writes the current layout. Stored digest identifies PostgreSQL's retained
JSONB representation and does not redefine workspace_layout.v1 golden digests.

## Persistence and read isolation

`investigations` is the mutable head index. `investigation_revisions` is immutable.
`investigation_mutation_receipts` is the single retry authority. Direct client writes
are revoked. Authenticated principal comes only from auth.uid(), never request data.
Owner-only SELECT policies cover heads, revisions, receipts, and retained layouts.
Missing and foreign objects produce the same not_found result. A missing operation
receipt is not a license to replace the operation UUID after a response is lost.

References are references, not proof of entitlement or perpetual source retention.
The Earnings owner resolver must recheck the exact generation's semantic subject,
event, schema, authority, complete dependency/qualification identity, bytes/hash,
and current rights on read/export. It must report HISTORICAL_UNAVAILABLE instead of
substituting today's data. Pure manifest/storage acceptance does not certify this.

Migration remains unapplied until source review and real database readback. G1
acceptance still requires the genuine retained owner baseline and authenticated
leave/fresh-session resume. Neither the storage tests nor a fixture pass completes G1.
