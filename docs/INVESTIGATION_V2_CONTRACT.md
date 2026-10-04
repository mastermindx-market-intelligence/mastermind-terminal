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

## Implemented G1 reads and UI

The authenticated `/api/investigations` GET lists owner heads, reads one exact
revision, or looks up the original operation receipt. `/analysis?view=investigations`
uses those reads for Saved Research. `investigation=<uuid>&revision=<n>` retains an
exact revision link. Opening and refreshing do not create revisions, receipts,
layouts, Brain runs or schedules. The browser retains one pending command per
principal in session storage before sending it; this is a recovery buffer, not a
second retry authority. A missing receipt keeps the original command and key.
Account changes clear in-memory data and abort outstanding requests.

The additive migration serializes new mutations by principal before testing
capacity: 500 lifetime records and 2000 retained revisions per principal. Removed
records count because their immutable history remains. At capacity the operation
returns `limit_reached` without writes; exact committed replay remains available.
These are explicit storage bounds, not subscription or ranking rules.

`/api/investigations/baseline` delegates to the existing Earnings reader. Exact
historical reads require event, generation, company and complete fingerprint. The
fingerprint binds immutable manifest and workspace bytes, including transcript,
qualification and exclusion changes, rather than only the issuer release hash.
The read projects public-known, platform-known and generation-emitted clocks
separately. The client adds a session-local viewed time, never a backdated stored
observation.

Current access for this G1 adapter is intentionally limited to personal public-primary
context display. Every byte-replayed source must have an explicit
`rp_public_primary_v1` annotation in the retained object and a fresh current owner
publication. Missing, changed, private or unknown current declarations deny display.
This is not a license registry, nor an export, team-sharing or AI-reuse permission.
No general rights grant is inferred from an old receipt or an unmerged rights row.
Unavailable retained generations remain `HISTORICAL_UNAVAILABLE`.

A retained layout opens through the existing Terminal layout host and its existing
migration/validation code. The local working copy has no current-row write target;
a subsequent Save creates a copy unless the user explicitly selects an overwrite.
Loading retained N never writes current N+1.

## Verification status — source and fixture proof

The preceding backend checkpoint `1fdefeaf` passed all hosted CI suites. Hosted
PostgreSQL invariants also passed at `9d70e2ec`, including lifecycle content guards.
At `f2220413`, hosted type generation/typecheck and 7095 unit cases passed; two
source-bound Analysis visual locks required actual recapture. Those ten affected
images have now been recaptured through the browser harness with per-viewport
source hashes, routes and timestamps; both visual-lock suites pass (9 cases).

Local browser journeys passed all 12 cases across desktop 1440x900, tablet
820x1180 and mobile 390x844: exact save/readback/reopen, lost response and temporary
receipt miss, 320px doubled text, and bilingual Analysis entry captures. Six
additional browser cases prove rejected stale drafts survive reload without a new
create, and successful saves retain their exact revision URL during a read outage.
These use transport fixtures and the existing local preview seam, not real-user
production authentication. Local full typecheck passes after the shared-shell and
browser-crypto compatibility fixes. Recovery unit checks pass six cases. Native
retained-layout host and existing workspace golden vectors pass 78 cases.

Rejected commands remain in the same principal-partitioned recovery buffer until
an explicit new edit/save replaces them; they do not become automatic retries.
The immutable success receipt remains the only commit/retry authority. The
independent 0028 source review is in progress; no release approval is asserted.

Production read-only inventory confirmed the existing `chart_layouts` table and
absence of both new owners before migration. The connected Terminal project has
no team rows; G7 requires a designated real team and approved existing principals.
No migration, production Investigation write, source merge or deployment has yet
occurred. These source and fixture results are not G1 or G0-G9 acceptance.
