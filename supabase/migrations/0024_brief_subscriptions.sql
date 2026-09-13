-- Ledger row: MO-PAID-032 (B-F11-7, Market Ontology F11 lane)
-- Rollback: drop table if exists public.brief_deliveries; drop table if exists public.brief_subscriptions;
--
-- Recurring briefs (packet B-F11-7, Terminal half of MO-PAID-032). Schema is identical
-- in the macro producer packet (M_F11_7B); this file is the source of truth.
--
-- Prefix 0024. Shipped UNAPPLIED — the builder never runs DDL against production;
-- the seat applies with a receipt, in ledger order after 0023.
--
-- SINGLE SCHEDULER: no cron, timer, pg_cron, background thread or per-user
-- executor is created here. Inserts into brief_deliveries come ONLY from the
-- macro nightly/weekly producer (service client — the same privilege path
-- engine/thesis_condition_monitor.py uses for public.alert_outbox).

create table if not exists public.brief_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid(),
  target_kind     text not null check (target_kind in ('thesis', 'watchlist')),
  target_id       uuid not null,
  cadence         text not null check (cadence in ('daily_after_us_close', 'weekly_saturday')),
  delivery        text not null default 'in_product_inbox' check (delivery = 'in_product_inbox'),
  state           text not null default 'active' check (state in ('active', 'paused')),
  created_at      timestamptz not null default now(),
  unique (user_id, target_kind, target_id, cadence)
);

create index if not exists brief_subscriptions_user
  on public.brief_subscriptions (user_id, created_at desc);

create table if not exists public.brief_deliveries (
  delivery_id      uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references public.brief_subscriptions (subscription_id) on delete cascade,
  slot_asof        date not null,
  state            text not null check (state in ('ready', 'degraded')),
  degraded_reason  text,
  artifact_asof    timestamptz,
  body             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (subscription_id, slot_asof)
);

create index if not exists brief_deliveries_slot
  on public.brief_deliveries (subscription_id, slot_asof desc);

alter table public.brief_subscriptions enable row level security;
alter table public.brief_deliveries enable row level security;

revoke all on table public.brief_subscriptions from public, anon;
revoke all on table public.brief_deliveries from public, anon;
grant select, insert, update, delete on table public.brief_subscriptions to authenticated;
grant select on table public.brief_deliveries to authenticated;

do $$ begin
  create policy brief_subscriptions_select_own on public.brief_subscriptions
    for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brief_subscriptions_insert_own on public.brief_subscriptions
    for insert to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brief_subscriptions_update_own on public.brief_subscriptions
    for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brief_subscriptions_delete_own on public.brief_subscriptions
    for delete to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brief_deliveries_select_owner on public.brief_deliveries
    for select to authenticated
    using (
      exists (
        select 1 from public.brief_subscriptions s
         where s.subscription_id = brief_deliveries.subscription_id
           and s.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brief_subscriptions_service_role_all on public.brief_subscriptions
    for all to service_role
    using (true)
    with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brief_deliveries_service_role_all on public.brief_deliveries
    for all to service_role
    using (true)
    with check (true);
exception when duplicate_object then null; end $$;

-- down:
-- begin;
-- drop policy if exists brief_deliveries_service_role_all on public.brief_deliveries;
-- drop policy if exists brief_subscriptions_service_role_all on public.brief_subscriptions;
-- drop policy if exists brief_deliveries_select_owner on public.brief_deliveries;
-- drop policy if exists brief_subscriptions_delete_own on public.brief_subscriptions;
-- drop policy if exists brief_subscriptions_update_own on public.brief_subscriptions;
-- drop policy if exists brief_subscriptions_insert_own on public.brief_subscriptions;
-- drop policy if exists brief_subscriptions_select_own on public.brief_subscriptions;
-- drop index if exists public.brief_deliveries_slot;
-- drop index if exists public.brief_subscriptions_user;
-- drop table if exists public.brief_deliveries;
-- drop table if exists public.brief_subscriptions;
-- commit;

-- readback:
-- select c.relname, c.relrowsecurity, array_agg(p.polname order by p.polname) as policies
--   from pg_class c
--   left join pg_policy p on p.polrelid = c.oid
--  where c.relnamespace = 'public'::regnamespace
--    and c.relname in ('brief_subscriptions', 'brief_deliveries')
--  group by 1, 2;
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid in ('public.brief_subscriptions'::regclass, 'public.brief_deliveries'::regclass)
--  order by 1;
