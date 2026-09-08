-- Ledger row: 0016_account_lifecycle_requests / PR #527 (open, packet B-F12-4); not applied
-- Rollback: drop table if exists public.account_lifecycle_requests;
-- 0016: account_lifecycle_requests — the user-visible intake + receipt for
-- "download my data" and "delete my account" (packet B-F12-4, lane F12).
--
-- This table records that a REQUEST was made and lets its owner read it back.
-- It is NOT an execution ledger and it never asserts that anything was deleted:
-- the identity-side deletion (DELETE /auth/v1/admin/users/{id}) needs the
-- service-role key, which the Terminal does not and must not hold
-- (F12 do_not_redo: no second auth plane, no secret store).
--
-- Deliberately DISJOINT from the macro-side `account_deletion_receipts` table
-- specified in docs/F12_ACCOUNT_DATA_LIFECYCLE_SPEC_2026-09-06.md §3.3
-- (service-role-only, subject_digest-keyed). Different readers, different keys.
--
-- Idempotent per supabase/migrations/README.md:76-85: this project has no
-- migration ledger, so every file must be safe to re-run from 0001.
create table if not exists public.account_lifecycle_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,                      -- 'deletion' | 'export'
  status        text not null default 'received',   -- 'received'|'in_progress'|'completed'|'cancelled'|'failed'
  receipt_code  text not null,
  requested_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.account_lifecycle_requests is
  'User-visible intake + receipt for account data export / deletion requests. Owner-readable, insert-only for the owner; status is advanced by the operator (service_role). No email or token is stored here - the address is read from the session at display time.';
comment on column public.account_lifecycle_requests.receipt_code is
  'Human-readable reference shown to the user, e.g. MMX-DEL-20260906-3F7K2Q8A. Not a secret and not an authorization token.';

create unique index if not exists account_lifecycle_receipt_code
  on public.account_lifecycle_requests (receipt_code);
create index if not exists account_lifecycle_user
  on public.account_lifecycle_requests (user_id, requested_at desc);
-- One open deletion request per account: makes the route's "you already filed one"
-- path deterministic instead of a best-effort read-then-insert race.
create unique index if not exists account_lifecycle_one_open_deletion
  on public.account_lifecycle_requests (user_id)
  where kind = 'deletion' and status in ('received', 'in_progress');

alter table public.account_lifecycle_requests enable row level security;

-- Postgres has no `create policy if not exists`; this file must never DROP a live
-- policy. Same duplicate_object wrapper 0007_portfolio_positions.sql:107-128 uses.
do $$ begin
  create policy "account_lifecycle_select_own" on public.account_lifecycle_requests
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "account_lifecycle_insert_own" on public.account_lifecycle_requests
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- No UPDATE and no DELETE policy on purpose: a receipt its subject can edit or
-- erase is not a receipt. Status is advanced only by service_role, which bypasses RLS.

-- readback: run against the live project to confirm this migration is applied.
--   select table_name from information_schema.tables
--     where table_schema = 'public' and table_name = 'account_lifecycle_requests';
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'account_lifecycle_requests' order by 1;
--   select indexname from pg_indexes
--     where schemaname = 'public' and tablename = 'account_lifecycle_requests';
--   select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public' and c.relname = 'account_lifecycle_requests';
--   select policyname, cmd, qual, with_check from pg_policies
--     where schemaname = 'public' and tablename = 'account_lifecycle_requests' order by 1;

-- down: drop table if exists public.account_lifecycle_requests;
--       -- WARNING: this destroys every filed receipt. Prefer leaving the table in place.
