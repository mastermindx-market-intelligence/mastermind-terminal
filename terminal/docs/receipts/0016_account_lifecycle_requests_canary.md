# 0016 Postgres canary — `account_lifecycle_requests`

Closes blocker B1 (PR #527, packet B-F12-4): a live-catalog canary proving
`supabase/migrations/0016_account_lifecycle_requests.sql` applies cleanly,
that `gen_random_uuid()` is available, that the partial unique index
(`account_lifecycle_one_open_deletion`) is buildable, and that the two
`do $$ ... exception when duplicate_object` policy blocks are idempotent on
a second run.

- **Run at:** 2026-09-07T00:23Z
- **Target:** the shared Supabase project named in `supabase/migrations/README.md`
  (project ref and access token deliberately not repeated here — see that file
  for how to reach the same project; this receipt names no secret).
- **Method:** Supabase Management API, `POST /v1/projects/{ref}/database/query`,
  per `supabase/migrations/README.md` §"How DDL actually lands".
- **Isolation:** the real `0016` DDL was never run against `public.` in
  production. Every object was rewritten into a throwaway schema
  `canary_b_f12_4` (`public.` → `canary_b_f12_4.`, and every index/policy name
  prefixed `canary_b_f12_4_`) so the canary could not collide with, or leave
  behind, anything the real migration will later create. `auth.users` and
  `auth.uid()` referenced the real auth schema, since that already exists in
  production and is what `0016` itself depends on.

## What ran

1. **Apply, round 1** — create schema `canary_b_f12_4`; create
   `canary_b_f12_4.account_lifecycle_requests` with the same 7 columns as
   `0016`; the 3 named indexes (receipt-code unique, user+requested_at,
   and the partial `where kind = 'deletion' and status in ('received',
   'in_progress')` unique index); `enable row level security`; the two
   `do $$ ... exception when duplicate_object` policy blocks (select-own,
   insert-own).
   → HTTP 201, `[]` (no error).
2. **Apply, round 2** — byte-identical statement set re-run against the same
   schema, to prove second-run idempotency (the exact defect the review
   flagged as unproven).
   → HTTP 201, `[]` (no error — every `create ... if not exists` and both
   `duplicate_object` guards absorbed the re-run cleanly).
3. **Readback** — five targeted queries against `canary_b_f12_4`:
   - `information_schema.tables` → `account_lifecycle_requests` present.
   - `information_schema.columns` → all 7 columns present with the expected
     types/defaults, including `id uuid default gen_random_uuid()` (proves
     `gen_random_uuid()` resolves on this catalog) and
     `status text default 'received'::text`.
   - `pg_indexes` → 4 indexes: the primary key plus the 3 named indexes above,
     including the partial unique index (`canary_b_f12_4_account_lifecycle_one_open_deletion`),
     proving the partial-index syntax is valid against this catalog.
   - `pg_class.relrowsecurity` → `true`.
   - `pg_policies` → both policies present (`..._select_own` cmd `SELECT`
     with `qual = (auth.uid() = user_id)`; `..._insert_own` cmd `INSERT`
     with `with_check = (auth.uid() = user_id)`), matching `0016`'s intent
     exactly modulo the canary name prefix.
4. **Teardown** — `drop schema if exists canary_b_f12_4 cascade` → HTTP 201,
   `[]`. Re-queried `pg_namespace` for `canary_b_f12_4` afterward → `[]`
   (schema confirmed gone; nothing left behind in the shared project).

## Raw responses (JSON, no secrets)

### Apply round 1
```json
[]
```
HTTP 201.

### Apply round 2 (idempotency)
```json
[]
```
HTTP 201.

### Readback — tables
```json
[{"table_name": "account_lifecycle_requests"}]
```

### Readback — columns
```json
[
  {"column_name": "id", "data_type": "uuid", "is_nullable": "NO", "column_default": "gen_random_uuid()"},
  {"column_name": "kind", "data_type": "text", "is_nullable": "NO", "column_default": null},
  {"column_name": "receipt_code", "data_type": "text", "is_nullable": "NO", "column_default": null},
  {"column_name": "requested_at", "data_type": "timestamp with time zone", "is_nullable": "NO", "column_default": "now()"},
  {"column_name": "status", "data_type": "text", "is_nullable": "NO", "column_default": "'received'::text"},
  {"column_name": "updated_at", "data_type": "timestamp with time zone", "is_nullable": "NO", "column_default": "now()"},
  {"column_name": "user_id", "data_type": "uuid", "is_nullable": "NO", "column_default": null}
]
```

### Readback — indexes
```json
[
  {"indexname": "account_lifecycle_requests_pkey"},
  {"indexname": "canary_b_f12_4_account_lifecycle_one_open_deletion"},
  {"indexname": "canary_b_f12_4_account_lifecycle_receipt_code"},
  {"indexname": "canary_b_f12_4_account_lifecycle_user"}
]
```

### Readback — RLS enabled
```json
[{"relrowsecurity": true}]
```

### Readback — policies
```json
[
  {"policyname": "canary_b_f12_4_account_lifecycle_insert_own", "cmd": "INSERT", "qual": null, "with_check": "(auth.uid() = user_id)"},
  {"policyname": "canary_b_f12_4_account_lifecycle_select_own", "cmd": "SELECT", "qual": "(auth.uid() = user_id)", "with_check": null}
]
```

### Drop
```json
[]
```
HTTP 201.

### Verify dropped
```json
[]
```
HTTP 201 — `canary_b_f12_4` no longer appears in `pg_namespace`.

## What this proves, and what it does not

**Proves:** `0016`'s DDL shape (table + 7 columns, 3 named indexes including
the partial-unique one, RLS enable, 2 `duplicate_object`-guarded policies)
applies cleanly to the *current* production catalog, twice in a row, with
zero errors and zero leftover state. `gen_random_uuid()` is available on
this project without an extension change. This is what acceptance-5 asked
for: proof against the current catalog, not a synthetic/local Postgres
stand-in.

**Does not prove:** this canary never touched `public.account_lifecycle_requests`
itself — `0016` is still **not applied** in production (see
`supabase/migrations/README.md`'s status table, unchanged by this receipt).
Applying the real migration remains a separate, later operator/Meta-CEO act,
expected after migrations `0014`/`0015` land (see the PR body's acceptance-7
note). This receipt closes the "does the DDL work against this catalog"
question, not the "is the real table live" question.

## Round 2 (2026-09-06) — closes review MINORs 1 and 2

Round 1 above proved the table, the 3 named indexes, RLS-enabled, and the two
policies. The round-2 review correctly noted two gaps: the readback never
queried `pg_constraint` (so the FK to `auth.users` — the one statement in
`0016` whose success depends on cross-schema privileges, and the one that
differs most between a canary schema and `public`) was only indirectly
evidenced by the clean apply, and the transformed canary DDL itself was
never committed, so "the same 7 columns as `0016`" rested on prose, not a
diffable artifact.

Both are closed here. The exact transformed DDL is committed alongside this
receipt as
[`0016_account_lifecycle_requests_canary_round2.sql`](./0016_account_lifecycle_requests_canary_round2.sql)
— diff it against `supabase/migrations/0016_account_lifecycle_requests.sql`
yourself: every substantive line is identical except `public.` →
`canary_b_f12_4_r2.` and the index/policy name prefixes (the same transform
round 1 described in prose, now inspectable).

- **Run at:** 2026-09-06 (same live project as round 1; a fresh schema name
  `canary_b_f12_4_r2` was used so this run could not depend on, or collide
  with, round 1's already-dropped `canary_b_f12_4`).
- **Method:** identical to round 1 — Supabase Management API,
  `POST /v1/projects/{ref}/database/query`, no secrets in this file.

### What ran (round 2)

1. **Apply, round 1** — the committed SQL file, verbatim, in one call.
   → HTTP 201, `[]`.
2. **Apply, round 2** — the same file re-run, to reconfirm idempotency.
   → HTTP 201, `[]`.
3. **Readback — the same 5 queries as round 1**, scoped to
   `canary_b_f12_4_r2` (schema, columns, indexes, RLS, policies) — same
   shape as round 1's results, confirming the fresh schema behaves
   identically. Omitted verbatim here since round 1 already shows the shape;
   the two NEW readbacks below are what round 2 adds.
4. **NEW — constraints** (`pg_constraint` filtered on
   `conrelid = 'canary_b_f12_4_r2.account_lifecycle_requests'::regclass`):
   ```json
   [
     {"conname": "account_lifecycle_requests_pkey", "contype": "p", "references_table": "-"},
     {"conname": "account_lifecycle_requests_user_id_fkey", "contype": "f", "references_table": "auth.users"}
   ]
   ```
   This is the direct proof the round-1 receipt was missing: the
   `references auth.users(id) on delete cascade` foreign key was actually
   created — not merely implied by a clean HTTP 201 — and it resolves to
   `auth.users`, proving this project grants the privilege to reference that
   table from a new schema.
5. **NEW — comments** (`obj_description` for the table,
   `col_description` for `receipt_code`):
   ```json
   [{"table_comment": "User-visible intake + receipt for account data export / deletion requests. Owner-readable, insert-only for the owner; status is advanced by the operator (service_role). No email or token is stored here - the address is read from the session at display time."}]
   [{"receipt_code_comment": "Human-readable reference shown to the user, e.g. MMX-DEL-20260906-3F7K2Q8A. Not a secret and not an authorization token."}]
   ```
   Both `comment on` statements in `0016` land and read back exactly as
   written.
6. **Teardown** — `drop schema if exists canary_b_f12_4_r2 cascade` → HTTP
   201, `[]`. Re-queried `pg_namespace` for `canary_b_f12_4_r2` afterward →
   `[]` (schema confirmed gone).

### What round 2 proves, and what it still does not

**Proves, additively to round 1:** every object `0016` creates — table,
7 columns, 3 named indexes, the primary-key constraint, the foreign-key
constraint to `auth.users`, RLS enabled, both policies, and both `comment on`
statements — applies to the live catalog, reads back exactly as declared,
and leaves nothing behind after teardown. The transformed DDL that produced
this result is a committed file, not prose.

**Still does not prove:** the same "is the real table live" gap as round 1 —
`0016` remains unapplied against `public.` (see
`supabase/migrations/README.md`), and applying it stays a separate, later
operator/Meta-CEO act.
