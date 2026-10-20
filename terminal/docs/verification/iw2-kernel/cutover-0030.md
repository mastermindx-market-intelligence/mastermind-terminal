# Investigation activation contract

This is source preparation, not permission or evidence to apply migration0030,
execute the refused T03k qualification, deploy, merge, or lift hold5989604142.
The retained fifth-case result remains unaccepted and `EFFECT_UNKNOWN` remains.

## Exact migration identity

The current unapplied source includes native grammar-2 screen envelopes in the
existing pure `valid_investigation_screen_record_v2` validator. No other SQL
statement or intended grant changes in this compatibility repair. Native grammar-2
definitions are non-reviewable, so their retained `review` must be null; the
grammar-1 review envelope is unchanged. This repair is 8 added / 1 removed
source lines, a net 572 bytes.
`supabase/migrations/0030_investigation_kernel.sql` is 41,139 bytes, SHA256
`e98d5a59cfb1932ebf4e562ecf89b6d08b7a5c9365b3e2fbe0b612eaaeff4694`.
The preceding accepted source at `ad80ceff67e9b9f95a131a74e6bf57aa19e97b39`
was 40,567 bytes, SHA256
`3db93b9227ff515cab5fd9962c30c0a58682208187c47888a8b7a2cd44b6036e`.
The historical refused source `41d85a86830ee367b7e51f9f95287b2fa558bd7d`
contained 31,394 bytes, SHA256
`b840b1116afbd159a85b23368ef8741a5ddc0693205ceb9fc13785d694471f4e`.
These bodies differ. Existing accepted screen-retention and kernel source work
is preserved; an old qualification, review or approval cannot silently bind
newer SQL bytes. The grammar-2 repair has source-only checks, not SQL execution
or migration qualification. Any eventual qualification and approval must name
the then-selected exact body. The source README still records0030 open/not
applied; this is not a fresh live database observation.

## Application admission

`INVESTIGATION_API_ADMISSION` is a server process setting. Only the literal
`open` admits requests. Missing, empty, `closed`, or malformed values close the
Investigation API. It is not a browser flag, request header, authenticated-user
permission, SQL grant, or operation receipt.

Every implemented handler under `/api/investigations` must check admission before
authentication, rate-limit mutation, body consumption, RPC, or owner fetches.
Closed requests return HTTP503 `{ "status": "unavailable" }`, with
`Cache-Control: private, no-store` and `Vary: Cookie`. In particular, a denied PUT
or legacy POST must not synthesize `not_applied`, replace an operation ID, clear
an uncertain command, or claim that a previously submitted operation did not run.
Explicit-open behavior retains the accepted strict-write and unchanged-request
legacy-reconciliation paths. Admission does not override authentication or RLS.
A request admitted while open may finish after configuration changes; checking
new entries does not cancel, drain or erase already submitted work.

The in-memory tests explicitly select open only for the test environment. An
eventual service installation must independently set and verify its own policy.
No installer or runtime setting is changed by this source patch. Reading the
setting per request does not make an external environment-file edit a hot reload:
the service owner must establish which actual processes received the setting.
Setting `open` is not a substitute for any activation or release approval.

## Ordering and failure boundaries

1. First complete the existing git-gated app deployment with the candidate
   explicitly configured closed before it handles requests. The old app may
   continue ordinary traffic against **unchanged old SQL** during the build. No
   migration attempt occurs during this phase. Complete health/identity checks
   and the ordinary app-build rollback window before proceeding. If deployment
   fails here, old SQL is still the boundary and ordinary app rollback remains
   available; this does not assert that original pending commands had no effect.
2. After candidate deployment, establish actual closure and drain **before the
   first SQL activation attempt**. Verify every surviving candidate process is
   closed, old nodes/workers have retired, and policy survives starts/restarts.
   The setting does not fence direct authenticated Supabase RPC ingress or work
   already submitted. A process stop, elapsed time, zero HTTP count, generic `/`
   health or missing receipt proves neither drain nor no effect. Settle original
   operations through their existing owners without changing their identities;
   independently establish all other SQL-ingress exclusion. If any part remains
   unresolved, keep SQL untouched and candidate admission closed.
3. Only the existing authorized migration owner may subsequently handle approved
   exact0030 while closure remains established. This contract runs no SQL and
   establishes neither approval nor qualification. Exact0030's intentional grants
   remain unchanged; revocation before migration is not a surviving barrier.
4. After any SQL attempt or uncertain SQL outcome, preserve closure and reconcile
   that same operation. Do not invoke old-binary rollback on the assumption that
   an app health failure proves the database stayed old. Existing
   `ops/terminal-build.sh` restores app build/marker state, not schema, data or
   mutation receipts. Fail forward or remain closed unless joint rollback
   compatibility has independently been established.
5. Reopening requires the actual candidate and schema identities, all-ingress
   closure/drain evidence, current-master/required-check qualification and the
   existing migration, rights, principal and release controls. A successful
   deployment or `open` setting is not authenticated saved-evidence acceptance.

## Exact-source invocation binding

The existing `scripts/supabase_apply.py` accepts optional
`--expected-source-sha256` (Python `expected_source_sha256`) for generic caller
compatibility. Any eventual exact0030 invocation under this contract must supply
the independently approved raw-source SHA256. The value must be 64 lowercase hex
characters and match the digest of the single buffer used for parsing. Refusal
occurs before any query, including pre-readback, and leaves existing receipts
untouched. Dry-run mismatch also precedes credential resolution; the apply CLI
still resolves its project/credentials before the function's source comparison.
Do not infer lack of credential access from zero queries.

A matching supplied value establishes content identity relative to that value;
it does not establish that the value was approved, source custody, a filesystem
lock, SQL transaction atomicity, rights, or permission to invoke the helper.
The raw buffer is decoded as UTF-8 without newline normalization, preserving
CRLF in both source and its digest. It does not claim every historical locale
encoding is compatible. Statements remain individually transported; a later
error can follow partial execution. A receipt records a source digest, not a
signature, a single wire-payload hash, or an approval certificate. No actual0030
helper invocation, dry-run, credential resolution or query is performed here.

## Remaining acceptance

The application admission primitive is executable and testable without SQL. It
does not complete the activation contract's all-ingress/drain precondition. The
existing release script has no trustworthy SQL-operation outcome input; this
change does not add a boolean-based compatibility certificate, migration runner,
new ledger, store, or parallel lifecycle.

Source inspected: accepted IW2 candidate `ad80ceff67e9b9f95a131a74e6bf57aa19e97b39`
and fetched master `8b8b217fdf799713f8b4a906bc0d4564d8aa20a2`. Master's additional
production/beta release profiles and build-resource lock do not establish
Investigation drain or SQL compatibility. Its older Investigation API lacks
accepted candidate recovery routes; do not replace candidate behavior with that
older API when integrating this guard. These are source observations, not a
current installed-service inspection or activation rehearsal.

## Source verification, not activation

The admission implementation passed 78 focused selector/handler/in-flight cases
and 48 existing route/recovery cases (126 unique cases across seven files).
TypeScript and touched-file lint passed. Removing only the main GET guard made
seven closed-mode cases fail; restoring the candidate restored the tested bytes.
A non-author Fabric source review accepted the changed admission behavior with
the installation, ingress, drain and SQL limitations above. No actual SQL,
credentials, authentication ceremony, browser server, migration or deployment
was used for these checks. Existing visual evidence is reused without restamping.

The helper's synthetic snapshot regression failed three cases before its repair;
the added source-pin/CLI regression failed 25 cases before the pin was present.
The final affected fake-transport suite passed 116 cases, including the existing
helper suite. No helper test used a real query runner, service credential,
actual0030 payload or external endpoint. Compile and whitespace checks passed.
These source checks do not establish production migration qualification.
