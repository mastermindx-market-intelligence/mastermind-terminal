# Forex R26 inactive account conditions

Status: storage review repair and API/presentation implementation locally qualified; fresh exact-head independent review pending. Read-only production catalog preflight completed; no production DDL, deployed account acceptance, active monitoring or notification proof.

This is the Terminal storage/API portion of the existing Forex R26 program `forex-r26-native-completion-20261020-sol-001`, paired with Macro PR #9866. The managed operation is `forex-r26-account-owner-20261021-sol-002`. It was acquired at `8f00622096d0dc574458c134516e802ce78907ae` and fast-forwarded to `8189edb8abd41e1c95d6460ad735549af5538d48`; the forward delta only reconciled the already-applied Portfolio 0036 ledger. The original branch and workspace remain bound to the same operation.

## Migration claim

Claimed forward prefix: **0038**, `0038_forex_inactive_conditions.sql`.

The 2026-10-21 census inspected 157 open Terminal PRs, including every paginated file list for all nine PRs whose initial GraphQL file list was truncated. The highest open claim is 0037 on #1084 (`0037_medtech_watches.sql`). Current master `8189edb8` has ledger entries through 0036. The existing 0035/#778, 0037/#1084 and older held claims are retained.

Per the repository's numbering rule, draft PR #1100 claimed 0038 when it opened at 2026-10-21T12:17:40Z. Its head b44b0552 was read back before the SQL was written. The ledger records the open claim and does not assert production application or review acceptance.

## Intended existing-owner extension

Use `public.alerts`, existing owner RLS, shared Supabase authentication and ordinary invoker functions:

- `save_forex_watch(p_id uuid, p_expected_revision integer, p_expected_user_id uuid, p_rule jsonb)` returns one authoritative inactive alerts row.
- `delete_forex_watch(p_id uuid, p_expected_revision integer, p_expected_user_id uuid)` returns `{id, deleted}`.

Expected owner must equal `auth.uid()` before mutation. Expected revision 0 creates a stable UUID with revision 1; positive revisions edit by compare-and-set. Repeated creates with a different rule cannot overwrite a row. Uncertain browser writes are reconciled by reads, never automatically replayed.

The reserved condition envelope is `type=forex_price_close`, `schema_version=1`, `condition_id=id`, and a positive owner-assigned revision. The canonical rule is literal price close, interval 4H, calendar `fx-utc-4h/v1`, one of EURUSD/USDJPY/AUDUSD/GBPUSD/USDCAD/USDCHF/USDMXN/USDBRL/USDCNH, operator lt/lte/gt/gte, finite positive threshold, consecutive integer 1..10, future UTC expiry, null feed and optional bounded origin snapshot ID.

Storage must reject active Forex rows and any attempt to escape the reserved family through direct UPDATE. It must preserve row identity/owner/creation time and require monotonic revisions. The supported RPC/API path supplies revision CAS; unchanged direct owner DELETE privileges are not an exclusive RPC gate or durable replay journal.

The existing alerts API must refuse Forex resume, including omitted-action re-arm, and preserve honest unavailable/conflict/unknown-write responses. Existing Terminal alert presentation must describe these records as saved inactive and cannot offer activation. No new auth system, condition table, queue, evaluator or delivery lane is authorized by this slice.

## Qualification before release

The implementation will be tested against a disposable socket-only PostgreSQL cluster with owner RLS and hostile function defaults, including cross-owner/session fences, direct activation/family escape, validation, idempotent create, concurrent revisions and deletion. Existing route tests and actual browser compatibility remain required.

The browser half at Macro commit `2d4550791063d02b3ade2a95a48b6e728cbd7a00` passed 272 focused tests with one sparse-data skip, including 18 Node transport subtests and 10 browser cases against a controlled account fixture. Those tests do not prove this storage implementation. The fresh independent frontend review is separate.

Production DDL remains the established out-of-band migration-owner action with catalog receipts. Source, migration application, deployed authenticated user-path acceptance, admitted finalized 4H source, evaluation and delivered notifications are separate gates. Keep this PR Draft/HOLD until its actual release conditions are satisfied.

## Storage proof and compatibility scope

The migration is one atomic, rerunnable DO statement under the incumbent apply runner. Five invoker functions with fixed pg_catalog search paths add strict rule validation, an unconditional alerts INSERT/UPDATE guard, and the two account-bound RPCs. Existing alerts table grants, RLS, policies and stored legacy rows are preserved. New function grants are explicit even under permissive default privileges.

The existing 50-alert cap is enforced for **all alert INSERT paths** under the same per-owner transaction lock, so a legacy/direct insert cannot race a Forex create above that cap. Updates never obtain this advisory lock after taking a row lock. Ordinary legacy update/delete behavior remains unchanged; Forex identity, family, inactive status and monotonic revision are storage invariants. The supported RPC flow compares the expected revision after locking the row. Existing direct owner DML is not an exclusive RPC gate; hard deletion retains no durable operation journal.

The initial disposable PostgreSQL run passed 63 cases in 11.46 seconds, including actual simultaneous clients, all rule-field validation, cross-owner/session fences, direct family/activation escape, cap races, existing-estate preservation and hostile default grants. The fixture applies the real migration twice using the existing apply parser/runner. No production database was contacted.

Final storage qualification: **168 passed in 13.17 seconds** — 66 actual PostgreSQL cases plus the migration ledger/namespace suites with PR_NUMBER=1100. The first combined run exposed the required explicit explanation for a null application date; only the 0038 note was corrected, and the unchanged guard then passed. Both results and exact source hashes are retained under `docs/verification/forex-r26/`. Incumbent 0035/#778 and 0037/#1084 reservation rows are disclosed from #1084's existing ledger; their SQL is not imported, reapplied or claimed as this program's work. The existing required-PostgreSQL CI job now runs the Forex suite.

## Independent storage finding and repair

The first independent storage review at `57a456589ef58fff7f174c0c5e5ed2617c7bad63` returned **REQUEST_CHANGES**. Its disposable PostgreSQL counterexample retained a REPEATABLE READ snapshot of 49 rows, let a separate default-isolation writer commit row 50, and then admitted row 51 despite the owner advisory lock. The original 66 tests passed independently; their scope did not include this retained-snapshot case.

The repair rejects REPEATABLE READ and SERIALIZABLE alert INSERTs with SQLSTATE 25001 before accepting the count-based cap protocol. PostgreSQL READ COMMITTED and READ UNCOMMITTED remain supported. Three discriminating regressions failed before repair; all 69 PostgreSQL cases then passed. The combined repair qualification is **171 passed in 13.85 seconds**, including unchanged ledger/namespace checks with PR_NUMBER=1100. See `storage-review-repair.json` and its red/green/combined logs. Fresh immutable-head independent review remains separate.

This shared cap also intentionally rejects direct INSERT/UPSERT attempts at a full cap before ON CONFLICT handling. No incumbent alerts-table UPSERT writer was found during independent review; alert_outbox UPSERTs are separate. Ordinary legacy UPDATE/DELETE behavior is unchanged. Hard deletion, including direct owner DELETE, retains no operation journal or exactly-once replay guarantee.

## API and account inventory integration

The existing `/api/alerts` route now sends Forex creation and revision-bound edits through the storage RPC. It validates the authenticated expected owner and verifies the returned identity, revision, inactive state and canonical rule before acknowledging. Missing RPC/access and unknown writes have distinct unavailable/unconfirmed responses. The API refuses Forex resume and omitted-action re-arm. The legacy update/delete paths exclude the reserved family in their actual mutation predicates, including a read/delete/recreate identity race.

Terminal's account inventory renders the literal condition, UTC expiry and revision in English and Chinese. It labels the row saved inactive, excludes it from tracked counts, monitoring lanes, delivery projections, re-arm and bulk activation, and preserves the account's ordinary alerts. The R26 editor remains the existing Macro Forex editor; this change does not add a second editor.

Forex deletion captures the saved owner and revision, keeps the row visible while sending, and has a 12-second request deadline. A lost, malformed or mismatched acknowledgement preserves an unconfirmed state and disables replay. Recovery only reads. Reads that began before the uncertain response cannot settle the deletion; a later confirmed absence establishes the current desired state without claiming causality. Account state is keyed by the authenticated UUID: a changed UUID clears the old account, while an email update for the same UUID preserves pending state.

The local browser proof uses the existing Next development fixture seam and controlled account responses. It is not a production authentication or storage proof. The focused tests additionally exercise stale inventory, account switches, same-owner email changes, malformed acknowledgements, deadlines and legacy compatibility.

## Current production observation

A **read-only catalog preflight** on 2026-10-21 at 13:09:56 UTC found the existing owner policy, RLS enabled, and authenticated SELECT/INSERT/UPDATE/DELETE grants. It found no Forex functions or alerts triggers. The database default isolation is READ COMMITTED. The exact observation is retained in `production-catalog-preflight.json`; no user rows were read and no DDL was applied.

Production application still belongs to the established per-file migration operator and requires catalog readback. The reservation remains unapplied. This packet cannot establish deployed account acceptance, a qualified finalized 4H source, evaluation, delivery or release.
