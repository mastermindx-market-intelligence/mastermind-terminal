-- Watchlist membership becomes UNIQUE at the database boundary.
--
-- ── RENUMBERED 0008 -> 0009 (2026-08-20) ──────────────────────────────────────────────────────
-- This file shipped as `0008_watchlist_symbol_unique.sql` in PR #426 while
-- `0008_chart_layouts_unique_name.sql` shipped in PR #427. The two PRs were authored in parallel
-- off the same base, so neither could see the other's number, and both landed. A version prefix is
-- the migration's IDENTITY, so "has 0008 been applied?" then had two different and both-true
-- answers. The later-merged file (this one, 18:02Z vs #427's 13:43Z) was renumbered; merge time is
-- an immutable fact recoverable from git, unlike application status, which changes underfoot.
-- `tests/test_migration_ledger.py` now fails CI on any repeat.
--
-- APPLIED TO PRODUCTION: yes. Censused read-only through the Management API on 2026-08-20 —
-- `wls_watchlist_symbol` is present on `public.watchlist_symbols (watchlist_id, symbol)`. Note that
-- `0008` is NOT applied, so production carries this file but not its predecessor; there is no
-- migration ledger to be inconsistent with (`supabase_migrations` does not exist). See
-- `supabase/migrations/README.md`.
--
-- `public.watchlists` has carried `unique (user_id, name)` since 0001, which is what makes the
-- Default-list provisioning converge instead of duplicating under a race. `watchlist_symbols`
-- never had the equivalent: `id` was its only unique key, with a plain index on `watchlist_id`.
-- Membership was therefore enforced only in application code —
-- `lib/watchlists.ts#addSymbols` SELECTs the current rows, builds a `present` set, and INSERTs the
-- difference — which is a read-then-write with no lock and no constraint behind it. Two writers
-- that read before either wrote both see the symbol as absent and both insert it:
--
--   * two tabs / two devices adding NVDA at the same moment -> two NVDA rows in one list;
--   * the two concurrent post-signup requests `app/terminal/page.tsx` explicitly exists to handle
--     (`router.refresh` racing the page load) -> both count zero symbols and both seed, turning a
--     six-name Default into twelve rows, six of them duplicates.
--
-- The read side hid it rather than fixing it: `listWatchlists` de-dupes by symbol as it builds its
-- result, so the rail looked correct while the table did not — and every subsequent
-- `remove`/`move` fanned out across rows the user could not see.
--
-- ── Reconciliation, before the constraint ──────────────────────────────────────────────────────
-- A unique index cannot be created over existing duplicates, so this migration reconciles first.
-- The surviving row per `(watchlist_id, symbol)` is chosen DETERMINISTICALLY:
--
--   1. lowest `position`   — preserves the symbol's earliest place in the user's visible order;
--   2. then earliest `created_at` — the row the user actually created first;
--   3. then lowest `id`    — a total order, so the choice is never arbitrary or platform-dependent.
--
-- The survivor keeps its own `section`, so a symbol stays in the section it was first filed under.
-- Nothing else is touched: no list is renamed or deleted, no non-duplicate row moves, and
-- `position` values are left exactly as they are (they are already non-contiguous by design —
-- `addSymbols` appends at max+1 — and the Terminal treats visible ORDER as local-wins anyway).
--
-- Idempotent: re-running finds no duplicates and `create unique index if not exists` is a no-op.

begin;

-- ---------- 1. reconcile existing duplicates ----------
with ranked as (
  select
    id,
    row_number() over (
      partition by watchlist_id, symbol
      order by position asc, created_at asc, id asc
    ) as rank
  from public.watchlist_symbols
)
delete from public.watchlist_symbols
where id in (select id from ranked where rank > 1);

-- ---------- 2. make membership authoritative ----------
-- With this in place `addSymbols` can upsert on the conflict target instead of trusting a
-- preceding SELECT, so concurrent writers converge on ONE row per symbol rather than racing.
create unique index if not exists wls_watchlist_symbol
  on public.watchlist_symbols(watchlist_id, symbol);

commit;
