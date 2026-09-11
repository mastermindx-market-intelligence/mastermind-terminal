-- Ledger row: 0018_webhook_delivery / PR #549 (merged cd1269fe, packet B-F12-7); applied 2026-09-10
-- Rollback: drop function if exists public.enqueue_test_webhook_delivery(uuid); drop table if exists public.webhook_deliveries; drop table if exists public.webhook_endpoints;
-- 0018: outbound signed webhook endpoints + deliveries (packet B-F12-7).
-- Shipped as a file only. Not applied by this PR — see supabase/migrations/README.md
-- "How DDL actually lands". Reuses 0014's is_team_member()/team_role(). Does not
-- touch alert_outbox (0013) and does not mint API keys.

begin;

create table if not exists public.webhook_endpoints (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  url          text not null check (length(url) between 1 and 2048),
  -- See packet B-F12-7 §2.1a — NOT a one-way digest. Column-privilege isolated (below), never
  -- selectable by `authenticated`; readable only by service_role.
  secret       text not null,
  enabled      boolean not null default true,
  -- text[], not an enum: 0012/0014/0015 all validate closed vocabularies via
  -- `check (x in (...))` on `text`, never a native Postgres enum type, so a
  -- future event type never needs a type-altering migration. v1's only legal
  -- value is 'webhook.test'; the check constraint is widened, never
  -- silently dropped, when a real producer is wired.
  event_filter text[] not null default '{}'
    check (event_filter <@ array['webhook.test']::text[]),
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (id, team_id)
);

create index if not exists webhook_endpoints_team on public.webhook_endpoints(team_id, created_at desc);

create table if not exists public.webhook_deliveries (
  id            uuid primary key default gen_random_uuid(),
  endpoint_id   uuid not null,
  team_id       uuid not null,
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  attempt       int not null default 0,
  status        text not null default 'pending'
                check (status in ('pending','delivering','retrying','delivered','failed')),
  response_code int,
  last_error    text check (last_error is null or length(last_error) <= 500),
  next_retry_at timestamptz,
  claimed_at    timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  -- Dedupe key: (endpoint, event) is unique by construction, mirroring
  -- 0015's owner_id generated-column idiom rather than trusting the caller
  -- to compute it consistently.
  dedupe_key    text generated always as (endpoint_id::text || ':' || event_id) stored,
  foreign key (endpoint_id, team_id)
    references public.webhook_endpoints (id, team_id) on delete cascade
);

-- Two more terminal statuses, added as a separate idempotent statement rather
-- than by rewriting the inline check above (this file is unapplied; the
-- constraint is re-created to the same auto-generated name either way).
-- `failed` renders as "Gave up after 5 tries" and is written by exactly one
-- code path — failurePatch at attempt >= 5. A delivery abandoned because the
-- endpoint was turned off, or because its saved address stopped being a public
-- https address, made 0 attempts; it gets its own status so the deliveries list
-- never states an attempt count that never happened.
alter table public.webhook_deliveries drop constraint if exists webhook_deliveries_status_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_status_check
  check (status in ('pending','delivering','retrying','delivered','failed',
                    'not_sent_disabled','not_sent_invalid_url'));

create unique index if not exists webhook_deliveries_dedupe_key on public.webhook_deliveries(dedupe_key);
create index if not exists webhook_deliveries_due on public.webhook_deliveries(status, next_retry_at);
create index if not exists webhook_deliveries_team on public.webhook_deliveries(team_id, created_at desc);

alter table public.webhook_endpoints  enable row level security;
alter table public.webhook_deliveries enable row level security;

drop policy if exists we_select_member on public.webhook_endpoints;
create policy we_select_member on public.webhook_endpoints for select to authenticated
  using (public.is_team_member(team_id));
drop policy if exists we_insert_admin on public.webhook_endpoints;
create policy we_insert_admin on public.webhook_endpoints for insert to authenticated
  with check (public.team_role(team_id) in ('owner','admin') and created_by = auth.uid());
-- v1 UPDATE is toggle-only in the application layer; the row policy
-- cannot itself express "only these columns," so the route enforces it —
-- same division of labour as 0014's tm_update_admin (RLS gates WHO, the
-- route gates WHAT).
drop policy if exists we_update_admin on public.webhook_endpoints;
create policy we_update_admin on public.webhook_endpoints for update to authenticated
  using (public.team_role(team_id) in ('owner','admin'))
  with check (public.team_role(team_id) in ('owner','admin'));
-- No delete policy in v1 — disable, never remove.

drop policy if exists wd_select_member on public.webhook_deliveries;
create policy wd_select_member on public.webhook_deliveries for select to authenticated
  using (public.is_team_member(team_id));
-- Same shape as 0013's alert_outbox / alert_runs: the delivery worker holds
-- service_role and is the ONLY writer. No authenticated INSERT/UPDATE/DELETE
-- policy exists — matches 0016's "status is advanced only by service_role."
do $$ begin
  create policy wd_service_role_all on public.webhook_deliveries for all to service_role
    using (true) with check (true);
exception when duplicate_object then null; end $$;

revoke all on table public.webhook_endpoints, public.webhook_deliveries from public, anon, authenticated;
grant select, insert on table public.webhook_endpoints to authenticated;
grant update (url, enabled, event_filter) on table public.webhook_endpoints to authenticated;
-- Column-privilege isolation: `authenticated` never gets SELECT on
-- `secret`, at the grant layer, independent of and in addition to RLS.
revoke select on table public.webhook_endpoints from authenticated;
grant select (id, team_id, url, enabled, event_filter, created_by, created_at)
  on table public.webhook_endpoints to authenticated;
grant select on table public.webhook_deliveries to authenticated;
grant all on table public.webhook_endpoints, public.webhook_deliveries to service_role;

create or replace function public.enqueue_test_webhook_delivery(p_endpoint_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public, auth as $$
declare
  v_ep public.webhook_endpoints%rowtype;
  v_event_id text := encode(gen_random_bytes(16), 'hex');
begin
  select * into v_ep from public.webhook_endpoints where id = p_endpoint_id for update;
  if not found or public.team_role(v_ep.team_id) not in ('owner','admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not v_ep.enabled then
    return jsonb_build_object('ok', false, 'reason', 'endpoint_disabled');
  end if;
  insert into public.webhook_deliveries (endpoint_id, team_id, event_id, event_type, payload)
  values (v_ep.id, v_ep.team_id, v_event_id, 'webhook.test',
          jsonb_build_object('schema', 'mastermind.webhook-test/v1', 'sent_at', now()));
  return jsonb_build_object('ok', true, 'event_id', v_event_id);
end $$;
revoke all on function public.enqueue_test_webhook_delivery(uuid) from public, anon;
grant execute on function public.enqueue_test_webhook_delivery(uuid) to authenticated;

commit;

-- down: drop function if exists public.enqueue_test_webhook_delivery(uuid);
--       drop policy if exists we_select_member on public.webhook_endpoints;
--       drop policy if exists we_insert_admin on public.webhook_endpoints;
--       drop policy if exists we_update_admin on public.webhook_endpoints;
--       drop policy if exists wd_select_member on public.webhook_deliveries;
--       drop policy if exists wd_service_role_all on public.webhook_deliveries;
--       drop index if exists webhook_deliveries_team;
--       drop index if exists webhook_deliveries_due;
--       drop index if exists webhook_deliveries_dedupe_key;
--       drop index if exists webhook_endpoints_team;
--       drop table if exists public.webhook_deliveries;
--       drop table if exists public.webhook_endpoints;
--       (manual, never auto-run — see 0014's down block for the destructive-drop precedent)

-- readback:
--   select relrowsecurity from pg_class where relname in ('webhook_endpoints','webhook_deliveries');
--   select policyname, tablename from pg_policies where tablename in ('webhook_endpoints','webhook_deliveries');
--   select table_name, column_name, privilege_type, grantee from information_schema.role_column_grants
--     where table_name = 'webhook_endpoints' order by 1,2,4;
--     -- expect: `secret` has NO row for grantee=authenticated
