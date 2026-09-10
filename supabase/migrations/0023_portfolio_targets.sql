-- Ledger row: MO-DELTA-003 (B-F08-B5-1, Market Ontology F08 lane, WS:MARKET-OS)
-- Rollback: drop table if exists public.portfolio_targets;
--
-- New table — not a record of a pre-existing live table (unlike 0007). This file IS the
-- deployment source of record and its CHECK constraints are real, asserted invariants, not
-- asserted-but-unverified notes about production.
--
-- Scope discipline (F08 freeze §1/§9; ledger row MO-DELTA-003): stores ONLY the user's own typed
-- targets. Never written by any evaluator, engine, alert, or ranking path (TWO-ORGANISMS law,
-- UWP-R2). Read-only with respect to portfolio_positions: nothing in this migration or its owning
-- module (terminal/lib/portfolioTargets.ts) writes to portfolio_positions.
--
-- Prefix 0023 (seat ruling R1, 2026-09-09): 0021 is B-F12-B5-1 explicit grants, 0022 is
-- B-F12-B5-2 team-shared workspaces, 0017-0020 reserved by #543. Shipped UNAPPLIED.

create table if not exists public.portfolio_targets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  ticker            text not null,
  target_weight_pct numeric not null check (target_weight_pct >= 0 and target_weight_pct <= 100),
  band_pct          numeric not null default 5 check (band_pct >= 0 and band_pct <= 50),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, ticker)
);

-- Owner lookups follow the same shape every table in this estate uses (0007's own comment).
create index if not exists portfolio_targets_user on public.portfolio_targets(user_id);

alter table public.portfolio_targets enable row level security;

do $$ begin
  create policy "portfolio_targets_select_own" on public.portfolio_targets
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "portfolio_targets_insert_own" on public.portfolio_targets
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "portfolio_targets_update_own" on public.portfolio_targets
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "portfolio_targets_delete_own" on public.portfolio_targets
    for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- down:
-- begin;
-- drop policy if exists "portfolio_targets_delete_own" on public.portfolio_targets;
-- drop policy if exists "portfolio_targets_update_own" on public.portfolio_targets;
-- drop policy if exists "portfolio_targets_insert_own" on public.portfolio_targets;
-- drop policy if exists "portfolio_targets_select_own" on public.portfolio_targets;
-- drop index if exists public.portfolio_targets_user;
-- drop table if exists public.portfolio_targets;
-- commit;

-- readback:
-- select c.relname, c.relrowsecurity, array_agg(p.polname order by p.polname) as policies
--   from pg_class c
--   left join pg_policy p on p.polrelid = c.oid
--  where c.relnamespace = 'public'::regnamespace and c.relname = 'portfolio_targets'
--  group by 1, 2;
