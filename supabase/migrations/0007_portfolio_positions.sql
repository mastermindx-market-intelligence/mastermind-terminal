-- Mastermind Terminal — RECORD the live `portfolio_positions` table (schema home, not a change)
--
-- ========================== THIS IS A RECORD, NOT A DEPLOYMENT ==========================
-- `public.portfolio_positions` has been LIVE in the shared Supabase project
-- (`{ref}`) since <= 2026-07-18, but its CREATE TABLE was never version
-- controlled in ANY repository — only its RLS policies were, in the macro repo's
-- `templates/uwp_supabase.sql`. This file gives the table a home so a fresh environment can
-- be stood up from source.
--
-- Against live production the table, RLS and policy statements are NO-OPS (`create table if not
-- exists`, an already-enabled `enable row level security`, and policies wrapped in
-- duplicate_object handlers). ONE statement is NOT provably a no-op: the
-- `create index if not exists portfolio_positions_user` below. Index existence is not
-- introspectable through PostgREST with a publishable key, so whether it already exists is
-- UNKNOWN — see the asserted-not-introspectable list further down, which it belongs to. If it is
-- absent, applying this file would CREATE it. That is a safe, non-blocking, additive index on the
-- column every read in the estate already filters by, but it is a write, and calling it a no-op
-- would have been false.
--
-- Nothing here was applied to production by the session that wrote it, and nothing needs to be.
--
-- Schema authority for the shared user-data plane is THIS directory (packet section 3);
-- macro's `templates/uwp_supabase.sql` remains the applied source of record for the four
-- policy bodies and is reproduced verbatim below.
-- =======================================================================================
--
-- ------------------------------- HOW THE SHAPE WAS VERIFIED -------------------------------
-- Live introspection, 2026-08-12, against https://{ref}.supabase.co/rest/v1
-- with the PUBLISHABLE key only (`sb_publishable_f33VG8fZ...`, public by design — macro
-- `config.yml` watchlist.supabase.anon_key). No secret key, no DDL, no writes.
--
-- The PostgREST OpenAPI root (`GET /rest/v1/`), which would return `definitions.
-- portfolio_positions` with types + defaults, now answers
--     HTTP 401 {"message":"Secret API key required","hint":"Only secret API keys can be
--               used for this endpoint."}
-- so the shape below was established by read-only behavioural probes instead:
--
--   COLUMN NAMES  — `?select=<col>&limit=1` returns 200 `[]` when the column exists and
--                   400 `42703 column portfolio_positions.<col> does not exist` when it
--                   does not. VERIFIED PRESENT: id, user_id, ticker, shares, entry_price,
--                   entry_date, notes, status, created_at, updated_at.
--                   VERIFIED ABSENT (drift guesses, all 42703): note, portfolio_id, symbol,
--                   cost_basis, quantity, currency.
--   COLUMN TYPES  — `?<col>=eq.zzNOTVALIDzz` makes PostgREST coerce the filter to the column
--                   type, and Postgres names that type in the error:
--                     id          22P02 invalid input syntax for type uuid
--                     user_id     22P02 invalid input syntax for type uuid
--                     shares      22P02 invalid input syntax for type numeric
--                     entry_price 22P02 invalid input syntax for type numeric
--                     entry_date  22007 invalid input syntax for type date
--                     created_at  22007 invalid input syntax for type timestamp with time zone
--                     updated_at  22007 invalid input syntax for type timestamp with time zone
--                     ticker / notes / status  -> accepted arbitrary text (text)
--   RLS           — anon `GET` on portfolio_positions, watchlists and watchlist_symbols all
--                   return 200 `[]` (deny-consistent), and an anon `POST` is rejected
--                   401 `42501 new row violates row-level security policy` on both
--                   portfolio_positions and watchlists. That proves DENY consistency only;
--                   the POLICY TEXT below is copied verbatim from the applied source of
--                   record (macro `templates/uwp_supabase.sql`), NOT re-introspected.
--
-- NOT ANONYMOUSLY INTROSPECTABLE (asserted from the writer contract, flagged for operator
-- confirmation against the live catalog, and harmless either way because this file is
-- `if not exists`): NOT NULL flags, column DEFAULTS, the primary key, the FK to
-- `auth.users`, any numeric precision/scale or CHECK constraint, and THE EXISTENCE OF THE
-- `portfolio_positions_user` INDEX — the one statement in this file that could be a real write
-- rather than a no-op (see the header). They are written here
-- to match how the estate actually uses the table:
--   * macro `templates/watchstore.js` inserts {user_id, ticker, shares, entry_price,
--     entry_date, notes, status, updated_at} and never supplies `id` -> `id` has a
--     server-side default; house idiom for every table in 0001_init.sql is
--     `gen_random_uuid()`.
--   * that writer always sends `status` as exactly 'open' or 'closed', and reads order by
--     `created_at` -> `created_at` has a now() default.
--   * shares/entry_price/entry_date/notes are all written as NULL when the user leaves the
--     field blank -> nullable.
-- -----------------------------------------------------------------------------------------
--
-- Scope discipline (packet section 4): recording reality ONLY. No new tables, no
-- `portfolios`/`portfolio_id`, no note column on watchlist_symbols, no `watchlists.updated_at`.
-- Watchlist-side shapes were re-probed the same way and match `0001_init.sql` exactly:
-- watchlists = id,user_id,name,position,created_at (NO updated_at);
-- watchlist_symbols = id,watchlist_id,symbol,section,position,created_at (NO note/notes).

create table if not exists public.portfolio_positions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  shares      numeric,
  entry_price numeric,
  entry_date  date,
  notes       text,
  status      text not null default 'open',       -- 'open' | 'closed' (writer-enforced; no live CHECK is asserted)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Owner lookups: every read in the estate is `where user_id = auth.uid() order by created_at`.
-- NOT a proven no-op against prod: index existence could not be introspected with a publishable
-- key. Additive and non-blocking if it does get created; listed above as asserted, not verified.
create index if not exists portfolio_positions_user on public.portfolio_positions(user_id);

-- ====================== Row-Level Security ======================
-- Idempotent, and already true in production.
alter table public.portfolio_positions enable row level security;

-- The four own-row policies, copied VERBATIM from the applied source of record
-- (macro `templates/uwp_supabase.sql`). Postgres has no `create policy if not exists`, and
-- this file must never DROP a live policy, so each create is wrapped in a duplicate_object
-- handler: present -> untouched, absent -> created.
do $$ begin
  create policy "portfolio_select_own" on public.portfolio_positions
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "portfolio_insert_own" on public.portfolio_positions
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "portfolio_update_own" on public.portfolio_positions
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "portfolio_delete_own" on public.portfolio_positions
    for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
