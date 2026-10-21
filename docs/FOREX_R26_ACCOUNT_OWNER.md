# Forex R26 inactive account conditions

Status: implementation in progress; no production DDL, active monitoring or notification proof.

This is the Terminal storage/API portion of the existing Forex R26 program `forex-r26-native-completion-20261020-sol-001`, paired with Macro PR #9866. The managed operation is `forex-r26-account-owner-20261021-sol-002`. It was acquired at `8f00622096d0dc574458c134516e802ce78907ae` and fast-forwarded to `8189edb8abd41e1c95d6460ad735549af5538d48`; the forward delta only reconciled the already-applied Portfolio 0036 ledger. The original branch and workspace remain bound to the same operation.

## Migration claim

Proposed forward prefix: **0038**, `0038_forex_inactive_conditions.sql`.

The 2026-10-21 census inspected 157 open Terminal PRs, including every paginated file list for all nine PRs whose initial GraphQL file list was truncated. The highest open claim is 0037 on #1084 (`0037_medtech_watches.sql`). Current master `8189edb8` has ledger entries through 0036. The existing 0035/#778, 0037/#1084 and older held claims are retained.

Per the repository's numbering rule, this draft PR claims 0038 when it opens. SQL is written only after that open claim is read back. This document and the README proposal do not assert that a migration exists, has been applied, or has passed review.

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
