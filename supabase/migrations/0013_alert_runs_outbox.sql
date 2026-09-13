-- Mastermind Terminal — alert run receipts + fire-to-delivery outbox (Market Ontology F08,
-- packet B-F08-2). Gives the alerts_engine.py evaluator a durable record that a run happened
-- (alert_runs) and a durable, replay-safe record of every fire event awaiting delivery
-- (alert_outbox). Companion drain packet (macro repo, B-F08-1b) reads alert_outbox and never
-- writes it.
--
-- ========================== THIS IS A RESERVATION, NOT AN APPLICATION ==========================
-- Applying DDL against the shared Supabase project is a separate, out-of-band Meta-CEO act with
-- a pre/post readback posted on the merge PR (see supabase/migrations/README.md). This file is
-- NOT applied by merging this PR. Every statement below is written idempotent so it is safe to
-- apply out of order and to re-run, per the estate's standing rule (README "Every file must stay
-- re-runnable").
-- =================================================================================================
--
-- Frozen contract (shared verbatim with macro's B-F08-1b drain packet — do not diverge):
--   public.alert_outbox   — one row per fire event, keyed by a deterministic fire_event_id so a
--                           replayed evaluator run over the same data vintage inserts nothing new.
--   public.alert_runs     — two-phase run receipt: a `started` row at run open, a terminal row
--                           (concluded_at + outcome) once the run's outputs are committed. outcome
--                           is DERIVED from typed reads, never asserted by the caller; the fallback
--                           when a run cannot be fully attributed is 'partial', never 'success'.
--
-- No per-position `alerts` rows are created here or anywhere in this packet — alerts stays the
-- existing single table (F08 do_not_redo: no second alert/scheduler model).

-- ---------------------------------------------------------------------------------------------
-- alert_runs — run receipts
-- ---------------------------------------------------------------------------------------------
create table if not exists public.alert_runs (
    id                   uuid primary key default gen_random_uuid(),
    lane                 text not null,
    run_id               text not null,
    started_at           timestamptz not null,
    concluded_at         timestamptz,
    outcome              text check (outcome in ('success', 'partial', 'failure')),
    evaluated_n          int,
    fired_n              int,
    unevaluable_n        int,
    source_asof          timestamptz,
    lane_cadence_budget_s int,
    error_class          text
);

create unique index if not exists alert_runs_lane_run_id on public.alert_runs (lane, run_id);
create index if not exists alert_runs_started_at on public.alert_runs (started_at desc);

alter table public.alert_runs enable row level security;

do $$ begin
    create policy alert_runs_select_authenticated on public.alert_runs
        for select
        to authenticated
        using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy alert_runs_service_role_all on public.alert_runs
        for all
        to service_role
        using (true)
        with check (true);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- alert_outbox — fire-to-delivery queue
-- ---------------------------------------------------------------------------------------------
create table if not exists public.alert_outbox (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null,
    alert_id       uuid,
    fire_event_id  text not null,
    channel        text not null default 'email',
    status         text not null default 'pending'
                   check (status in ('pending', 'deferred', 'sent', 'failed', 'suppressed')),
    payload        jsonb not null,
    attempts       int not null default 0,
    last_error     text,
    deliver_after  timestamptz,
    delivered_at   timestamptz,
    created_at     timestamptz not null default now()
);

create unique index if not exists alert_outbox_fire_event_id on public.alert_outbox (fire_event_id);
create index if not exists alert_outbox_user_status on public.alert_outbox (user_id, status);

alter table public.alert_outbox enable row level security;

do $$ begin
    create policy alert_outbox_select_owner on public.alert_outbox
        for select
        to authenticated
        using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy alert_outbox_service_role_all on public.alert_outbox
        for all
        to service_role
        using (true)
        with check (true);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- down: (manual, out-of-band — for completeness / recovery only, never auto-run)
-- ---------------------------------------------------------------------------------------------
-- drop table if exists public.alert_outbox;
-- drop table if exists public.alert_runs;

-- ---------------------------------------------------------------------------------------------
-- readback: catalog query an operator runs post-apply to prove the shape landed
-- ---------------------------------------------------------------------------------------------
-- select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relname in ('alert_runs', 'alert_outbox');
-- select indexname from pg_indexes where schemaname = 'public'
--   and tablename in ('alert_runs', 'alert_outbox');
-- select polname, tablename from pg_policies where schemaname = 'public'
--   and tablename in ('alert_runs', 'alert_outbox');
