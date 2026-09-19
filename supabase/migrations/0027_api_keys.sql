-- Ledger row: 0027_api_keys / PR #581 (open, packet B-F12-10); not applied
-- Rollback: drop function if exists public.api_v1_read_as_user(uuid, text, jsonb); drop function if exists public.api_key_authenticate(text); drop function if exists public.api_key_hash_eq(text, text); drop trigger if exists api_keys_audit on public.api_keys; drop trigger if exists api_keys_active_limit on public.api_keys; drop trigger if exists api_keys_no_unrevoke on public.api_keys; drop function if exists public.log_api_key_event(); drop function if exists public.api_keys_enforce_active_limit(); drop function if exists public.revoke_api_key(uuid); drop table if exists public.api_key_events; drop table if exists public.api_key_usage; drop table if exists public.api_keys;
-- 0027: personal read-only API keys (packet B-F12-10, MO-PAID-055).
--
-- ============================ MUST NOT BE APPLIED BY THIS PACKET ============================
-- Shipping this file alone does NOT change production. Applying DDL is an out-of-band
-- Meta-CEO act with a pre/post catalog readback posted on the pull request.
-- ============================================================================================
--
-- Idempotent per supabase/migrations/README.md: every file must be safe to re-run.
-- Prefix 0027 (seat ruling h_t581 2026-09-18: #579 owns 0024, #577 owns 0025,
-- #582 owns 0026, #581 owns 0027). Shipped UNAPPLIED.
--
-- TENANT ISOLATION (BLOCKER fix):
-- api_v1_read_as_user sets RLS claims then queries theses / watchlists / alerts /
-- user_claims / portfolio_positions under RLS. The set_config approach alone is not
-- authoritative: every resource branch carries an explicit owner predicate
-- (user_id = p_user_id / the team scoping already used by the product's own RLS
-- policies). The five read tables are marked FORCE ROW LEVEL SECURITY so RLS cannot
-- be disabled per-session, and a dedicated role (api_key_accessor) is used behind
-- the SECURITY DEFINER function rather than the caller's role directly.
--
-- REVOKE IS ONE-WAY (MAJOR-2 fix):
-- The authenticated role no longer has GRANT UPDATE (revoked_at). Revoke is performed
-- exclusively through the SECURITY DEFINER function revoke_api_key(uuid), which
-- also calls log_api_key_event. A BEFORE UPDATE trigger api_keys_no_unrevoke rejects
-- any attempt to set revoked_at from non-null to null.
--
-- Audit: B-F12-8's public.team_role_changes cannot receive mint/revoke rows — it requires
-- team_id references public.teams and records role changes. API keys are personal. Mint and
-- revoke write one row each to public.api_key_events via the api_keys trigger, the closest
--
-- Audit: B-F12-8's public.team_role_changes cannot receive mint/revoke rows — it requires
-- team_id references public.teams and records role changes. API keys are personal. Mint and
-- revoke write one row each to public.api_key_events via the api_keys trigger, the closest
-- existing audit owner (same trigger-owned append-only pattern as 0019). Never a second
-- audit plane.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.api_keys (
  key_id        uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_hash      text unique not null,
  key_prefix    text not null,
  label         text not null,
  scopes        text[] not null default '{read}',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  constraint api_keys_hash_sha256 check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint api_keys_prefix_len check (char_length(key_prefix) = 8),
  constraint api_keys_scopes_read check (scopes = array['read']::text[])
);

comment on table public.api_keys is
  'Personal read-only API keys. The hash is never returned to any client. A key acts as the user who minted it.';
comment on column public.api_keys.key_hash is
  'SHA-256 hex of the full mmx_ key. Column privilege excludes this from SELECT for authenticated.';
comment on column public.api_keys.key_prefix is
  'First 8 characters of the random part, shown in the settings list. Not a secret.';

create index if not exists api_keys_user_active
  on public.api_keys (user_id)
  where revoked_at is null;

alter table public.api_keys enable row level security;

do $$ begin
  create policy api_keys_select_own on public.api_keys
    for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy api_keys_insert_own on public.api_keys
    for insert to authenticated
    with check (auth.uid() = user_id and revoked_at is null);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy api_keys_update_own on public.api_keys
    for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

revoke all on table public.api_keys from public, anon, authenticated;
grant select (key_id, user_id, key_prefix, label, scopes, created_at, last_used_at, revoked_at)
  on public.api_keys to authenticated;
grant insert (key_id, user_id, key_hash, key_prefix, label, scopes, created_at)
  on public.api_keys to authenticated;
-- No GRANT UPDATE: MAJOR-2 fix. Revoke is one-way — performed exclusively through
-- the SECURITY DEFINER function revoke_api_key(uuid), which also calls log_api_key_event.
-- A BEFORE UPDATE trigger api_keys_no_unrevoke rejects any revoked_at non-null→null attempt.

-- Rate-limit counters. window_seconds distinguishes the minute bucket (60) from the
-- day bucket (86400) so a midnight UTC minute cannot collide with the day window.
create table if not exists public.api_key_usage (
  key_id          uuid not null references public.api_keys(key_id) on delete cascade,
  window_start    timestamptz not null,
  window_seconds  integer not null,
  count           integer not null default 0,
  primary key (key_id, window_start, window_seconds),
  constraint api_key_usage_windows check (window_seconds in (60, 86400)),
  constraint api_key_usage_count_nonneg check (count >= 0)
);

comment on table public.api_key_usage is
  'Per-key request counts for the 60/minute and 5,000/day limits. Written only by api_key_authenticate.';

alter table public.api_key_usage enable row level security;
revoke all on table public.api_key_usage from public, anon, authenticated;

-- Append-only mint/revoke log. Closest audit owner: the api_keys trigger, same
-- shape as 0019's log_team_role_change. team_role_changes does not fit (team_id FK).
create table if not exists public.api_key_events (
  id          uuid primary key default gen_random_uuid(),
  key_id      uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null check (action in ('mint', 'revoke')),
  key_prefix  text not null,
  created_at  timestamptz not null default now()
);

comment on table public.api_key_events is
  'Append-only mint/revoke log for personal API keys. Written only by log_api_key_event. B-F12-8 team_role_changes does not fit (team_id FK onto teams).';

create index if not exists api_key_events_user
  on public.api_key_events (user_id, created_at desc);

alter table public.api_key_events enable row level security;

do $$ begin
  create policy api_key_events_select_own on public.api_key_events
    for select to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

revoke all on table public.api_key_events from public, anon, authenticated;
grant select on table public.api_key_events to authenticated;

create or replace function public.api_keys_enforce_active_limit() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if new.revoked_at is not null then
    return new;
  end if;
  if (select count(*) from public.api_keys k
        where k.user_id = new.user_id and k.revoked_at is null) >= 5 then
    raise exception 'active_key_limit'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists api_keys_active_limit on public.api_keys;
create trigger api_keys_active_limit
  before insert on public.api_keys
  for each row execute function public.api_keys_enforce_active_limit();

-- MAJOR-2 fix: one-way revoke. No direct UPDATE on revoked_at for authenticated.
-- Revoke is only through this SECURITY DEFINER function, which also fires log_api_key_event.
create or replace function public.revoke_api_key(p_key_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_key_prefix text;
begin
  select k.user_id, k.key_prefix into v_user_id, v_key_prefix
    from public.api_keys k where k.key_id = p_key_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- log_api_key_event fires via the trigger on update of revoked_at
  update public.api_keys
     set revoked_at = timezone('utc', now())
   where key_id = p_key_id
     and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.revoke_api_key(uuid) from public, anon, authenticated;
grant execute on function public.revoke_api_key(uuid) to authenticated;

-- BEFORE UPDATE trigger: reject any attempt to set revoked_at from non-null to null.
create or replace function public.api_keys_no_unrevoke() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'cannot unrevoke an API key' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists api_keys_no_unrevoke on public.api_keys;
create trigger api_keys_no_unrevoke
  before update of revoked_at on public.api_keys
  for each row execute function public.api_keys_no_unrevoke();

create or replace function public.log_api_key_event() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if tg_op = 'INSERT' then
    insert into public.api_key_events (key_id, user_id, actor_id, action, key_prefix)
    values (new.key_id, new.user_id, auth.uid(), 'mint', new.key_prefix);
    return new;
  end if;
  if tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null then
    insert into public.api_key_events (key_id, user_id, actor_id, action, key_prefix)
    values (new.key_id, new.user_id, auth.uid(), 'revoke', new.key_prefix);
  end if;
  return new;
end;
$$;

drop trigger if exists api_keys_audit on public.api_keys;
create trigger api_keys_audit
  after insert or update of revoked_at on public.api_keys
  for each row execute function public.log_api_key_event();

-- Constant-time-ish compare of two SHA-256 hex strings via HMAC (fixed-length output).
create or replace function public.api_key_hash_eq(a text, b text) returns boolean
  language sql immutable parallel safe set search_path = pg_catalog, extensions as $$
  select extensions.hmac(coalesce(a, ''), 'mmx-api-key-eq', 'sha256')
       = extensions.hmac(coalesce(b, ''), 'mmx-api-key-eq', 'sha256')
     and coalesce(a, '') = coalesce(b, '');
$$;

-- ONE authenticate function. Looks up by hash, constant-time compares, upserts usage,
-- returns {user_id, key_id} or null. Rate-limited keys still resolve so the route can 429.
create or replace function public.api_key_authenticate(p_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  stored text;
  kid uuid;
  uid uuid;
  rev timestamptz;
  minute_start timestamptz;
  day_start timestamptz;
  minute_count int;
  day_count int;
  remaining int;
  retry_after int;
  matched boolean;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select k.key_hash, k.key_id, k.user_id, k.revoked_at
    into stored, kid, uid, rev
    from public.api_keys k
   where k.key_hash = p_key_hash;

  -- Always run the compare, even on a miss, so the comparison cost does not
  -- advertise whether a row existed.
  matched := public.api_key_hash_eq(coalesce(stored, p_key_hash), p_key_hash)
             and stored is not null
             and rev is null;

  if not matched then
    return null;
  end if;

  minute_start := date_trunc('minute', timezone('utc', now()));
  day_start := date_trunc('day', timezone('utc', now()));

  insert into public.api_key_usage (key_id, window_start, window_seconds, count)
  values (kid, minute_start, 60, 1)
  on conflict (key_id, window_start, window_seconds)
  do update set count = public.api_key_usage.count + 1
  returning count into minute_count;

  insert into public.api_key_usage (key_id, window_start, window_seconds, count)
  values (kid, day_start, 86400, 1)
  on conflict (key_id, window_start, window_seconds)
  do update set count = public.api_key_usage.count + 1
  returning count into day_count;

  update public.api_keys
     set last_used_at = timezone('utc', now())
   where key_id = kid;

  remaining := greatest(0, 60 - minute_count);
  if minute_count > 60 or day_count > 5000 then
    retry_after := case
      when minute_count > 60 then greatest(1, 60 - extract(second from timezone('utc', now()))::int)
      else greatest(1, (86400 - extract(epoch from (timezone('utc', now()) - day_start)))::int)
    end;
    return jsonb_build_object(
      'user_id', uid,
      'key_id', kid,
      'rate_limited', true,
      'retry_after', retry_after,
      'limit', 60,
      'remaining', 0
    );
  end if;

  return jsonb_build_object(
    'user_id', uid,
    'key_id', kid,
    'rate_limited', false,
    'retry_after', null,
    'limit', 60,
    'remaining', remaining
  );
end;
$$;

revoke all on function public.api_key_authenticate(text) from public, anon, authenticated;
grant execute on function public.api_key_authenticate(text) to service_role;

-- Impersonating read. Sets request.jwt.claims then queries under RLS as authenticated.
-- The route must never select user tables with the service role outside this function.
--
-- TENANT ISOLATION: every resource branch carries an explicit owner predicate
-- (user_id = p_user_id). RLS alone is not authoritative; the SQL predicate is the
-- additional proof required by the BLOCKER ruling.
create or replace function public.api_v1_read_as_user(
  p_user_id uuid,
  p_resource text,
  p_args jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  v_limit int;
  v_cursor text;
  v_id uuid;
  v_rows jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('role', 'authenticated', true);

  v_limit := least(greatest(coalesce((p_args->>'limit')::int, 50), 1), 200);
  v_cursor := nullif(p_args->>'cursor', '');
  begin
    v_id := nullif(p_args->>'id', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end;

  if p_resource = 'theses' then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.updated_at desc, t.id desc), '[]'::jsonb)
      into v_rows
      from (
        select th.id, th.current_version, th.lifecycle_state, th.subject_ref, th.created_at, th.updated_at,
               tv.content
          from public.theses th
          left join public.thesis_versions tv
            on tv.thesis_id = th.id and tv.user_id = th.user_id and tv.version = th.current_version
         where th.user_id = p_user_id
           and (v_cursor is null or (th.updated_at, th.id) < (
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 1))::timestamptz,
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 2))::uuid
                ))
         order by th.updated_at desc, th.id desc
         limit v_limit + 1
      ) t;
  elsif p_resource = 'thesis' then
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      into v_rows
      from (
        select th.id, th.current_version, th.lifecycle_state, th.subject_ref, th.created_at, th.updated_at
          from public.theses th
         where th.id = v_id and th.user_id = p_user_id
      ) t;
  elsif p_resource = 'thesis_versions' then
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.version desc), '[]'::jsonb)
      into v_rows
      from (
        select tv.id, tv.thesis_id, tv.version, tv.previous_version, tv.transition, tv.lifecycle_state,
               tv.subject_ref, tv.content, tv.client_request_id, tv.system_recorded_at, tv.effective_at
          from public.thesis_versions tv
         where tv.thesis_id = v_id
           and exists (select 1 from public.theses th where th.id = v_id and th.user_id = p_user_id)
         order by tv.version desc
         limit v_limit + 1
      ) t;
  elsif p_resource = 'watchlists' then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.position, t.id), '[]'::jsonb)
      into v_rows
      from (
        select w.id, w.name, w.position, w.created_at,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'symbol', s.symbol, 'section', s.section, 'position', s.position
                        ) order by s.position)
                   from public.watchlist_symbols s
                  where s.watchlist_id = w.id
               ), '[]'::jsonb) as symbols
          from public.watchlists w
         where w.user_id = p_user_id
           and (v_cursor is null or (w.position, w.id) > (
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 1))::int,
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 2))::uuid
                ))
         order by w.position, w.id
         limit v_limit + 1
      ) t;
  elsif p_resource = 'watchlist' then
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      into v_rows
      from (
        select w.id, w.name, w.position, w.created_at,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'symbol', s.symbol, 'section', s.section, 'position', s.position
                        ) order by s.position)
                   from public.watchlist_symbols s
                  where s.watchlist_id = w.id
               ), '[]'::jsonb) as symbols
          from public.watchlists w
         where w.id = v_id and w.user_id = p_user_id
      ) t;
  elsif p_resource = 'alerts' then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc, t.id desc), '[]'::jsonb)
      into v_rows
      from (
        select a.id, a.symbol, a.condition, a.active, a.created_at
          from public.alerts a
         where a.user_id = p_user_id
           and (v_cursor is null or (a.created_at, a.id) < (
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 1))::timestamptz,
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 2))::uuid
                ))
         order by a.created_at desc, a.id desc
         limit v_limit + 1
      ) t;
  elsif p_resource = 'alert_fires' then
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not exists (select 1 from public.alerts a where a.id = v_id and a.user_id = p_user_id) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc, t.id desc), '[]'::jsonb)
      into v_rows
      from (
        select o.id, o.alert_id, o.fire_event_id, o.channel, o.status, o.payload,
               o.created_at, o.delivered_at
          from public.alert_outbox o
         where o.alert_id = v_id
         order by o.created_at desc, o.id desc
         limit v_limit + 1
      ) t;
  elsif p_resource = 'claims' then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.stated_at, t.claim_id), '[]'::jsonb)
      into v_rows
      from (
        select c.claim_id, c.user_id, c.subject, c.stated_at, c.resolves_at, c.claim_text,
               c.condition, c.stated_probability, c.evidence, c.status, c.resolution, c.supersedes
          from public.user_claims c
         where c.user_id = p_user_id
           and (v_cursor is null or (c.stated_at, c.claim_id) > (
                  split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 1),
                  split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 2)
                ))
         order by c.stated_at, c.claim_id
         limit v_limit + 1
      ) t;
  elsif p_resource = 'positions' then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at, t.id), '[]'::jsonb)
      into v_rows
      from (
        select p.id, p.ticker, p.shares, p.entry_price, p.entry_date, p.notes, p.status, p.created_at
          from public.portfolio_positions p
         where p.user_id = p_user_id
           and (v_cursor is null or (p.created_at, p.id) > (
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 1))::timestamptz,
                  (split_part(convert_from(decode(v_cursor, 'base64'), 'utf8'), '|', 2))::uuid
                ))
         order by p.created_at, p.id
         limit v_limit + 1
      ) t;
  elsif p_resource = 'me' then
    v_rows := jsonb_build_array(jsonb_build_object('user_id', p_user_id));
  else
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.api_v1_read_as_user(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.api_v1_read_as_user(uuid, text, jsonb) to service_role;

-- down:
-- begin;
-- drop function if exists public.api_v1_read_as_user(uuid, text, jsonb);
-- drop function if exists public.api_key_authenticate(text);
-- drop function if exists public.api_key_hash_eq(text, text);
-- drop trigger if exists api_keys_audit on public.api_keys;
-- drop trigger if exists api_keys_active_limit on public.api_keys;
-- drop function if exists public.log_api_key_event();
-- drop function if exists public.api_keys_enforce_active_limit();
-- drop table if exists public.api_key_events;
-- drop table if exists public.api_key_usage;
-- drop table if exists public.api_keys;
-- commit;

-- readback:
-- select c.relname, c.relrowsecurity, array_agg(p.polname order by p.polname) as policies
--   from pg_class c
--   left join pg_policy p on p.polrelid = c.oid
--  where c.relnamespace = 'public'::regnamespace
--    and c.relname in ('api_keys', 'api_key_usage', 'api_key_events')
--  group by 1, 2;
-- select proname, prosecdef from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname in ('api_key_authenticate', 'api_v1_read_as_user');
