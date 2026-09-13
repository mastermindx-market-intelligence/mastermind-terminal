-- Ledger row: 0026_webhook_rotation_alert_fires / PR #582 (open, packet B-F12-11); not applied
-- Rollback: drop function if exists public.requeue_failed_webhook_delivery(uuid); drop function if exists public.rotate_webhook_secret(uuid); drop function if exists public.project_alert_fire_to_webhooks(); drop trigger if exists alert_outbox_project_webhooks on public.alert_outbox; drop table if exists public.webhook_alert_optins; alter table public.webhook_endpoints drop column if exists secret_previous_expires_at; alter table public.webhook_endpoints drop column if exists secret_rotated_at; alter table public.webhook_endpoints drop column if exists secret_version; alter table public.webhook_endpoints drop column if exists secret_previous; alter table public.webhook_endpoints drop constraint if exists webhook_endpoints_event_filter_check;
-- 0026: outbound signed webhooks — signing-key rotation, dead-letter redrive, alert-fire
-- producer wiring, per-team consent row (packet B-F12-11, MO-PAID-056 + MO-DELTA-038).
-- Builds on 0018 (webhook_endpoints/webhook_deliveries), 0013 (alert_outbox) and 0014 (teams,
-- team_members, is_team_member, team_role). Does not edit 0018; widens its event_filter vocabulary
-- via a fresh constraint that supersedes the narrower 0018 one. Every statement is idempotent so
-- re-running against an already-applied schema is a no-op (README "Every file must stay re-runnable").

begin;

-- ---------------------------------------------------------------------------
-- 1) webhook_endpoints — rotation columns + re-issued column-privilege grant
-- ---------------------------------------------------------------------------
alter table public.webhook_endpoints
  add column if not exists secret_previous           text,
  add column if not exists secret_version            int  not null default 1,
  add column if not exists secret_rotated_at         timestamptz,
  add column if not exists secret_previous_expires_at timestamptz;

-- Widen the closed event_filter vocabulary exactly to {'webhook.test','alert.fired'}. 0018 named
-- the constraint webhook_endpoints_event_filter_check implicitly when it added the column, so a
-- drop-constraint-if-exists is safe and the add is named explicitly (per R4) so future widens land
-- on the same name the test pin reads.
alter table public.webhook_endpoints drop constraint if exists webhook_endpoints_event_filter_check;
alter table public.webhook_endpoints add  constraint webhook_endpoints_event_filter_check
  check (event_filter <@ array['webhook.test','alert.fired']::text[]);

-- Re-issue the column grant so secret and secret_previous are NEVER selectable by `authenticated`,
-- independent of RLS. This is the same shape 0018 issued for `secret`, widened to cover
-- secret_previous. Readback asserts no row for either column with grantee=authenticated.
revoke select on table public.webhook_endpoints from authenticated;
grant select (id, team_id, url, enabled, event_filter, created_by, created_at,
              secret_version, secret_rotated_at)
  on table public.webhook_endpoints to authenticated;

-- ---------------------------------------------------------------------------
-- 2) webhook_alert_optins — per-team opt-in row (R2's fourth consent gate)
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_alert_optins (
  user_id    uuid not null references auth.users(id)  on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

alter table public.webhook_alert_optins enable row level security;

-- Members see their own row, and may insert/update their own row (with check enforcing the same).
-- Membership gate is enforced by the route via team_role(); RLS here only proves the row is your
-- own. NO delete policy: revocation of consent is an update (enabled=false), not a row removal —
-- a stray delete would silently re-enable fan-out on the next membership check.
drop policy if exists wao_select_own on public.webhook_alert_optins;
create policy wao_select_own on public.webhook_alert_optins
  for select to authenticated using (user_id = auth.uid());
drop policy if exists wao_insert_own on public.webhook_alert_optins;
create policy wao_insert_own on public.webhook_alert_optins
  for insert to authenticated with check (user_id = auth.uid() and public.is_team_member(team_id));
drop policy if exists wao_update_own on public.webhook_alert_optins;
create policy wao_update_own on public.webhook_alert_optins
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

do $$ begin
  create policy wao_service_role_all on public.webhook_alert_optins
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

revoke all on table public.webhook_alert_optins from public, anon, authenticated;
grant select, insert on table public.webhook_alert_optins to authenticated;
grant update (enabled, updated_at) on table public.webhook_alert_optins to authenticated;
grant all    on table public.webhook_alert_optins to service_role;

-- ---------------------------------------------------------------------------
-- 3) rotate_webhook_secret(p_endpoint_id uuid) returns jsonb (R3, R6)
-- ---------------------------------------------------------------------------
create or replace function public.rotate_webhook_secret(p_endpoint_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = pg_catalog, public, auth as $$
declare
  v_ep        public.webhook_endpoints%rowtype;
  v_new_secret text;
  v_prev_expiry timestamptz := now() + interval '24 hours';
begin
  select * into v_ep from public.webhook_endpoints where id = p_endpoint_id for update;
  if not found or public.team_role(v_ep.team_id) not in ('owner','admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Mint the same shape newWebhookSecret() in terminal/lib/webhooks.ts produces: 32 random bytes,
  -- base64url (translate the standard base64 alphabet + strip trailing '=').
  -- pgcrypto lives in schema `extensions` (canary scripts/f12_webhooks_postgres_canary.py:93
  -- creates it there, production Supabase same, cf. 0012's `extensions.gen_random_uuid()`); the
  -- function declares `set search_path = pg_catalog, public, auth`, so the call must be schema-
  -- qualified — same pattern 0012 uses for `extensions.gen_random_uuid()`.
  v_new_secret := translate(
    rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='),
    '+/',
    '-_'
  );
  update public.webhook_endpoints
     set secret                    = v_new_secret,
         secret_previous           = v_ep.secret,
         secret_version            = coalesce(v_ep.secret_version, 1) + 1,
         secret_rotated_at         = now(),
         secret_previous_expires_at = v_prev_expiry
   where id = p_endpoint_id;
  -- The NEW secret is returned exactly once. The previous secret is never returned or echoed —
  -- the only way to recover it for the 24-hour dual-signature window is to read
  -- secret_previous on the row before rotation or by direct, auditable DB access.
  return jsonb_build_object(
    'ok',                  true,
    'secret',              v_new_secret,
    'secret_version',      coalesce(v_ep.secret_version, 1) + 1,
    -- The route discards `previous_expires_at` (FROZEN SPEC (3) returns {ok,secret,secretVersion}
    -- only). Emit it in UTC anyway — the rotate path casts the timestamptz to UTC at the
    -- SQL boundary so a future caller that DOES read it sees the labelled UTC, not the session's
    -- local TimeZone.
    'previous_expires_at', to_char((v_prev_expiry at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end $$;
revoke all on function public.rotate_webhook_secret(uuid) from public, anon;
grant execute on function public.rotate_webhook_secret(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) requeue_failed_webhook_delivery(p_delivery_id uuid) returns jsonb (R6)
-- ---------------------------------------------------------------------------
create or replace function public.requeue_failed_webhook_delivery(p_delivery_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = pg_catalog, public, auth as $$
declare
  v_d  public.webhook_deliveries%rowtype;
begin
  select * into v_d from public.webhook_deliveries where id = p_delivery_id for update;
  if not found or public.team_role(v_d.team_id) not in ('owner','admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_d.status <> 'failed' then
    return jsonb_build_object('ok', false, 'reason', 'not_failed');
  end if;
  update public.webhook_deliveries
     set status         = 'pending',
         attempt        = 0,
         next_retry_at  = null,
         last_error     = null,
         claimed_at     = null
   where id = p_delivery_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.requeue_failed_webhook_delivery(uuid) from public, anon;
grant execute on function public.requeue_failed_webhook_delivery(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) project_alert_fire_to_webhooks() — AFTER INSERT trigger on alert_outbox (R1, R2, R5)
-- ---------------------------------------------------------------------------
-- Reuses the existing worker (ingest/webhook_delivery.ts), the existing dedupe_key unique index
-- (`webhook_deliveries_dedupe_key`), and the existing retry ladder (terminal/lib/webhookRetry.ts).
-- Does NOT touch ingest/alerts_engine.py — that engine writes to alert_outbox; this trigger is
-- the only fan-out path. The trigger body is wrapped in `exception when others then raise warning`
-- so a webhook misconfiguration NEVER fails the alert_outbox insert that fanned it out.
create or replace function public.project_alert_fire_to_webhooks() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare
  v_ep     public.webhook_endpoints%rowtype;
  v_payload jsonb;
begin
  -- Build the per-delivery base payload (everything except team_id, which depends on the
  -- matched endpoint — alerts are PERSONAL per 0001 / R2 and can fan out to multiple teams).
  -- Payload keys mirror alert_outbox.payload, plus a schema tag the receiver dispatches on
  -- (mastermind.alert-fired/v1). event_id equals fire_event_id so Mastermind-Webhook-Event-Id
  -- IS the fire id (R5).
  v_payload := jsonb_build_object(
    'schema',            'mastermind.alert-fired/v1',
    'fire_event_id',     new.fire_event_id,
    'alert_id',          new.alert_id,
    'user_id',           new.user_id,
    'fired_at',          coalesce(new.payload->>'fired_at', ''),
    'ticker',            coalesce(new.payload->>'ticker', ''),
    'subject',           coalesce(new.payload->>'subject', ''),
    'subject_zh',        coalesce(new.payload->>'subject_zh', ''),
    'summary_plain',     coalesce(new.payload->>'summary_plain', ''),
    'summary_plain_zh',  coalesce(new.payload->>'summary_plain_zh', ''),
    'condition_plain',   coalesce(new.payload->>'condition_plain', ''),
    'condition_plain_zh',coalesce(new.payload->>'condition_plain_zh', ''),
    'value',             coalesce(new.payload->>'value', ''),
    'evidence_url',      coalesce(new.payload->>'evidence_url', '')
  );

  -- One INSERT per matching endpoint. R2's four gates: endpoint enabled, event_filter
  -- contains 'alert.fired', firing user is a current team_member, firing user has opted in.
  -- alert_outbox has NO team_id column (alerts are personal per 0001 / R2), so team_id in the
  -- payload is taken from the matched endpoint's row, not from new.payload.
  for v_ep in
    select e.*
      from public.webhook_endpoints e
     where e.enabled = true
       and 'alert.fired' = any(e.event_filter)
       and exists (
         select 1 from public.team_members m
          where m.team_id = e.team_id and m.user_id = new.user_id
       )
       and exists (
         select 1 from public.webhook_alert_optins o
          where o.team_id = e.team_id and o.user_id = new.user_id and o.enabled = true
       )
  loop
    insert into public.webhook_deliveries
      (endpoint_id, team_id, event_id, event_type, payload)
    values
      (v_ep.id, v_ep.team_id, new.fire_event_id, 'alert.fired',
       v_payload || jsonb_build_object('team_id', v_ep.team_id::text))
    on conflict (dedupe_key) do nothing;
  end loop;

  return new;
exception when others then
  -- Never fail the outbox insert; the warning shows up in pg logs for the seat's readback.
  raise warning 'project_alert_fire_to_webhooks: % (fire_event_id=%)', SQLERRM, new.fire_event_id;
  return new;
end $$;
drop trigger if exists alert_outbox_project_webhooks on public.alert_outbox;
create trigger alert_outbox_project_webhooks
  after insert on public.alert_outbox
  for each row execute function public.project_alert_fire_to_webhooks();

commit;

-- down: (manual, never auto-run — see 0018's down block for the destructive-drop precedent)
--   drop trigger if exists alert_outbox_project_webhooks on public.alert_outbox;
--   drop function if exists public.project_alert_fire_to_webhooks();
--   drop function if exists public.requeue_failed_webhook_delivery(uuid);
--   drop function if exists public.rotate_webhook_secret(uuid);
--   drop table if exists public.webhook_alert_optins;
--   alter table public.webhook_endpoints drop column if exists secret_previous_expires_at;
--   alter table public.webhook_endpoints drop column if exists secret_rotated_at;
--   alter table public.webhook_endpoints drop column if exists secret_version;
--   alter table public.webhook_endpoints drop column if exists secret_previous;
--   alter table public.webhook_endpoints drop constraint if exists webhook_endpoints_event_filter_check;
--   -- restore the narrower 0018 vocabulary constraint if the 0018 file is re-applied before 0026:
--   -- alter table public.webhook_endpoints add constraint webhook_endpoints_event_filter_check
--   --   check (event_filter <@ array['webhook.test']::text[]);
--   -- restore the narrower 0018 column grant (no secret_version / secret_rotated_at):
--   -- revoke select on table public.webhook_endpoints from authenticated;
--   -- grant select (id, team_id, url, enabled, event_filter, created_by, created_at)
--   --   on table public.webhook_endpoints to authenticated;

-- readback: (run after applying; every row must be present)
--   select relrowsecurity from pg_class
--     where relname in ('webhook_alert_optins') and relnamespace = 'public'::regnamespace;
--     -- expected: t
--   select policyname, tablename from pg_policies
--     where tablename = 'webhook_alert_optins' order by policyname;
--     -- expected: wao_insert_own, wao_select_own, wao_service_role_all, wao_update_own
--     -- (no wao_delete_* row — readback asserts the absence of a delete policy)
--   select table_name, column_name, privilege_type, grantee
--     from information_schema.role_column_grants
--    where table_name = 'webhook_endpoints' and grantee = 'authenticated'
--    order by column_name;
--     -- expected: id, team_id, url, enabled, event_filter, created_by, created_at,
--     --           secret_version, secret_rotated_at
--     -- NOT expected: secret, secret_previous
--   select tgname, tgrelid::regclass from pg_trigger
--    where tgname = 'alert_outbox_project_webhooks';
--     -- expected: alert_outbox_project_webhooks | alert_outbox
--   select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conname = 'webhook_endpoints_event_filter_check';
--     -- expected: pg_get_constraintdef: CHECK (((event_filter)::text[] <@ '{webhook.test,alert.fired}'::text[]))
--   select proname, prosecdef from pg_proc
--     where proname in ('rotate_webhook_secret','requeue_failed_webhook_delivery','project_alert_fire_to_webhooks')
--     order by proname;
--     -- expected: prosecdef = t for all three (security definer)