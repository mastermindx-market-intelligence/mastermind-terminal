-- Ledger row: MO-PAID-052 / MO-DELTA-041 / packet B-F12 handoff-sql (pinned research handoffs);
-- prefix 0041 verified against master max 0040
-- Rollback: NONE: preserve all grant history and revision discriminators. Disable the handoff
-- consumer, revoke RPC EXECUTE, and drop only its new INSERT policy as described in down.
-- NOT APPLIED by the packet. Applying is a separate privileged act performed out of band, with
-- the `-- readback:` block at the foot of this file posted as a receipt on the pull request
-- before README.md's application table is updated.
--
-- This file defines functions with dollar-quoted bodies containing semicolons (the 0006-style
-- warning restated by 0014 and 0021): do NOT push it through the naive split-on-semicolon
-- Management API endpoint.
--
-- 0041: pinned research handoffs -- an owner lets one named account READ one PINNED revision of
-- one of their Investigation aggregates. The grant row pins (resource_id, resource_revision):
-- later owner revisions never move the pin, and 0021's live uniqueness on
-- (resource_kind, resource_id, grantee_user_id) is deliberately left unchanged, so one grantee
-- holds at most one live pin per aggregate and a different live revision is a share conflict the
-- owner must revoke explicitly. Revocation stays terminal exactly as in 0021. The grantee gains
-- no SELECT, UPDATE or grant on any Investigation table: every read flows through the definer
-- RPCs below, which expose a fixed DTO and nothing else.
--
-- Amendment (same draft, packet B-F12 handoff-overflow-sql): the list RPC paginates both share
-- directions by ascending immutable grant UUID keyset instead of failing closed at 200 live
-- pins. sent and received each read at most 200 rows per call plus a next cursor; the prior
-- no-argument draft signature is explicitly dropped so an isolated prior draft upgrades in
-- place and no ambiguous overload survives a replay. Pagination is a navigation contract, not
-- an admission cap: preexisting and direct-INSERT overflow rows stay fully navigable.
--
-- Idempotent per supabase/migrations/README.md "Every file must stay re-runnable": this project
-- has no migration ledger, so a future session may replay 0001..0041 in order. Re-running this
-- file widens nothing twice, never writes to a live grant row, and replays the signature handoff
-- (create the two-argument keyset function, then drop the superseded no-argument overload) as a
-- no-op once the upgrade has landed.

begin;

-- 0021 pinned resource_kind to ('watchlist') inline. Postgres has no `alter constraint`, so the
-- widening is detected off the constraint's own definition: on an already-widened database the
-- replay below is a no-op and the legacy constraint is never dropped and re-added twice.
do $$ declare legacy_kind_check text; begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.resource_grants'::regclass
       and c.contype = 'c'
       and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
         where a.attrelid = c.conrelid and a.attname = 'resource_kind')]::smallint[]
       and pg_catalog.pg_get_constraintdef(c.oid) like '%investigation%') then
    select c.conname into legacy_kind_check
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.resource_grants'::regclass
       and c.contype = 'c'
       and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
         where a.attrelid = c.conrelid and a.attname = 'resource_kind')]::smallint[]
       and pg_catalog.pg_get_constraintdef(c.oid) like '%resource_kind%';
    if legacy_kind_check is null then
      raise exception 'expected the 0021 resource_kind check constraint';
    end if;
    execute pg_catalog.format('alter table public.resource_grants drop constraint %I', legacy_kind_check);
    alter table public.resource_grants
      add constraint resource_grants_resource_kind_check
      check (resource_kind in ('watchlist', 'investigation'));
  end if;
end $$;

-- NULL stays the watchlist shape; an Investigation grant must pin a positive revision.
alter table public.resource_grants add column if not exists resource_revision integer;

comment on column public.resource_grants.resource_revision is
  'For watchlist grants: always NULL, exactly as 0021 stored every share. For investigation grants: the one pinned revision the grantee may read; later owner revisions never move it, and the guard trigger keeps it immutable for the life of the row.';

do $$ begin
  alter table public.resource_grants
    add constraint resource_grants_revision_matches_kind
    check ((resource_kind = 'watchlist' and resource_revision is null)
        or (resource_kind = 'investigation' and resource_revision is not null and resource_revision > 0));
exception when duplicate_object then null; end $$;

-- The 0021 guard already made revocation terminal and every immutable field immutable; the same
-- function body is extended with exactly one condition so a live pin cannot be silently
-- re-pointed onto a different revision. All original checks, messages and errcodes are preserved
-- verbatim. The prerequisite 0021 trigger remains unchanged.
create or replace function public.resource_grants_guard() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a withdrawn share cannot be changed' using errcode = '42501';
  end if;
  if new.resource_kind is distinct from old.resource_kind
     or new.resource_id is distinct from old.resource_id
     or new.resource_revision is distinct from old.resource_revision
     or new.grantee_user_id is distinct from old.grantee_user_id
     or new.granted_by is distinct from old.granted_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a share record cannot be re-pointed' using errcode = '42501';
  end if;
  return new;
end $$;

-- Prerequisite 0021 already binds resource_grants_revoke_is_terminal to this function.
-- Keep that trigger exactly as installed; replacing the function updates its guard.

-- Definer helpers, the 0021 pattern (has_active_grant / owns_watchlist): fixed minimal
-- search_path with every reference schema-qualified, and NO caller-supplied principal --
-- auth.uid() is read internally, so neither helper can probe another account's rows. The
-- ownership helper is what keeps the new INSERT policy from recursing: the resource_grants
-- policy reads the Investigation tables, which never re-enter resource_grants RLS.
create or replace function public.owns_active_investigation_revision(p_investigation uuid, p_revision integer)
returns boolean
  language sql stable security definer set search_path = ''
  as $$
  select exists (
    select 1
      from public.investigations h
      join public.investigation_revisions r
        on r.investigation_id = h.id and r.user_id = h.user_id and r.revision = p_revision
     where h.id = p_investigation
       and h.user_id = auth.uid()
       and h.lifecycle = 'active'
       and r.lifecycle = 'active')
$$;

-- The one place the SUMMARY DTO is built, so created/already_shared and both list sections can
-- never drift apart. Exactly {grant_id, investigation_id, revision, title, shared_by,
-- grantee_user_id, created_at}: no current revision, no lifecycle, no manifest internals.
create or replace function public.investigation_handoff_summary_v1(
  p_grant_id uuid, p_investigation uuid, p_revision integer, p_shared_by uuid,
  p_grantee uuid, p_created_at timestamptz, p_manifest jsonb
) returns jsonb
  language sql stable set search_path = ''
  as $$
  select jsonb_build_object(
    'grant_id', p_grant_id,
    'investigation_id', p_investigation,
    'revision', p_revision,
    'title', p_manifest #>> '{intent,title}',
    'shared_by', p_shared_by,
    'grantee_user_id', p_grantee,
    'created_at', p_created_at)
$$;

create or replace function public.create_investigation_handoff_v1(
  p_id uuid, p_revision integer, p_grantee uuid
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  head record;
  pinned record;
  live record;
  grant_id uuid;
  shared_at timestamptz;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  if p_id is null or p_revision is null or p_grantee is null
     or p_revision < 1 or p_grantee = actor then
    return jsonb_build_object('status', 'invalid_payload');
  end if;
  -- An absent grantee account is indistinguishable from an absent aggregate: both are a bare
  -- not_found, so a share attempt discloses nothing about either side.
  if not exists (select 1 from auth.users u where u.id = p_grantee) then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Serialize this owner's shares of this aggregate so convergence reads the winner of any
  -- concurrent share instead of racing a duplicate past 0021's live unique index.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('resource_grants.investigation:' || actor::text || ':' || p_id::text, 0));
  select * into head from public.investigations h where h.id = p_id for share;
  if not found or head.user_id <> actor or head.lifecycle <> 'active' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into pinned from public.investigation_revisions r
   where r.investigation_id = p_id and r.user_id = head.user_id and r.revision = p_revision;
  if not found or pinned.lifecycle <> 'active' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into live from public.resource_grants g
   where g.resource_kind = 'investigation'
     and g.resource_id = p_id
     and g.grantee_user_id = p_grantee
     and g.revoked_at is null;
  if found then
    if live.resource_revision = p_revision then
      return jsonb_build_object('status', 'already_shared', 'handoff',
        public.investigation_handoff_summary_v1(live.id, live.resource_id, live.resource_revision,
          live.granted_by, live.grantee_user_id, live.created_at, pinned.manifest));
    end if;
    -- A different live revision is a conflict, never a silent repoint: the owner must revoke
    -- the existing pin explicitly first.
    return jsonb_build_object('status', 'share_conflict');
  end if;
  -- Every fallible validation above precedes the single INSERT; the advisory lock held since
  -- the head read rules out a duplicate-live race, and any remaining storage failure rolls the
  -- whole statement back and surfaces as a bare unavailable.
  insert into public.resource_grants
    (resource_kind, resource_id, resource_revision, grantee_user_id, granted_by)
    values ('investigation', p_id, p_revision, p_grantee, actor)
    returning id, created_at into grant_id, shared_at;
  return jsonb_build_object('status', 'created', 'handoff',
    public.investigation_handoff_summary_v1(grant_id, p_id, p_revision,
      actor, p_grantee, shared_at, pinned.manifest));
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

-- Owner inventory plus both share directions. own lists the caller's ACTIVE aggregates only and
-- keeps its hard bound: 501 candidates read one row past 500 and answer unavailable rather than
-- a silently truncated success. sent keeps live pins visible to their owner while source is
-- removed, so explicit revoke remains reachable. Received lists only active source aggregates
-- and active pinned revisions; removing source availability is not a terminal revocation event.
--
-- Each share direction is keyset-paginated by the grant row's immutable UUID ascending. The
-- section query orders by g.id ASC before LIMIT 201, the JSON aggregate keeps that same order,
-- and a 201st row means another page exists: the reply is trimmed to exactly the first 200 rows
-- and the 200th grant UUID rides out as that direction's next cursor; any smaller page closes
-- with a null cursor. The two cursors move independently. A cursor is a bare grant UUID -- no
-- user IDs, no raw manifest, no current-or-future revision -- and it is only ever compared
-- inside the caller's own rows, so seeking past an arbitrary UUID grants nothing and discloses
-- nothing. Ascending UUID keyset with no OFFSET means a revocation anywhere in the walked
-- prefix can never shift a later row out of place, and rows inserted after a traversed cursor
-- surface on the next page or, when they sort before it, on the next explicit refresh: these
-- are live lists, not a cross-page frozen snapshot, and the UI says so.
create or replace function public.list_investigation_handoffs_v1(
  p_sent_after uuid default null,
  p_received_after uuid default null
)
returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  own jsonb;
  sent jsonb;
  received jsonb;
  sent_ids uuid[];
  received_ids uuid[];
  sent_cursor uuid;
  received_cursor uuid;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  select coalesce(jsonb_agg(x.item order by x.updated_at desc, x.id), '[]'::jsonb) into own
    from (select jsonb_build_object('id', h.id, 'revision', h.current_revision,
                    'title', r.manifest #>> '{intent,title}') as item,
                 h.updated_at, h.id
            from public.investigations h
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = h.current_revision
           where h.user_id = actor and h.lifecycle = 'active'
           limit 501) x;
  if jsonb_array_length(own) > 500 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select coalesce(jsonb_agg(x.item order by x.gid), '[]'::jsonb),
         coalesce(array_agg(x.gid order by x.gid), array[]::uuid[])
    into sent, sent_ids
    from (select public.investigation_handoff_summary_v1(g.id, g.resource_id, g.resource_revision,
                    g.granted_by, g.grantee_user_id, g.created_at, r.manifest) as item,
                 g.id as gid
            from public.resource_grants g
            join public.investigations h
              on h.id = g.resource_id and h.user_id = g.granted_by
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = g.resource_revision and r.lifecycle = 'active'
           where g.granted_by = actor and g.resource_kind = 'investigation' and g.revoked_at is null
             and (p_sent_after is null or g.id > p_sent_after)
           order by g.id asc
           limit 201) x;
  if coalesce(array_length(sent_ids, 1), 0) > 200 then
    -- One row was read past the page on purpose: trim only that extra. The cursor is the 200th
    -- -- not the 201st -- grant UUID, i.e. exactly the last row this page returned.
    sent := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
               from jsonb_array_elements(sent) with ordinality as t(e, ord)
              where ord <= 200);
    sent_cursor := sent_ids[200];
  end if;
  select coalesce(jsonb_agg(x.item order by x.gid), '[]'::jsonb),
         coalesce(array_agg(x.gid order by x.gid), array[]::uuid[])
    into received, received_ids
    from (select public.investigation_handoff_summary_v1(g.id, g.resource_id, g.resource_revision,
                    g.granted_by, g.grantee_user_id, g.created_at, r.manifest) as item,
                 g.id as gid
            from public.resource_grants g
            join public.investigations h
              on h.id = g.resource_id and h.user_id = g.granted_by and h.lifecycle = 'active'
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = g.resource_revision and r.lifecycle = 'active'
           where g.grantee_user_id = actor and g.resource_kind = 'investigation' and g.revoked_at is null
             and (p_received_after is null or g.id > p_received_after)
           order by g.id asc
           limit 201) x;
  if coalesce(array_length(received_ids, 1), 0) > 200 then
    received := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
                   from jsonb_array_elements(received) with ordinality as t(e, ord)
                  where ord <= 200);
    received_cursor := received_ids[200];
  end if;
  return jsonb_build_object('status', 'listed', 'own', own, 'sent', sent, 'received', received,
    'sent_next_cursor', sent_cursor, 'received_next_cursor', received_cursor);
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

-- An isolated prior draft of this same migration installed the list RPC with no arguments. The
-- defaulted two-argument form above answers a bare list_investigation_handoffs_v1() call, so
-- both signatures cannot coexist: while the old overload lives, every zero-argument call is an
-- ambiguous function error. Drop exactly that superseded signature -- and no other function,
-- old or new -- once the replacement exists. On an already-upgraded database the drop is a
-- no-op, so replaying this file stays idempotent.
drop function if exists public.list_investigation_handoffs_v1();

-- Grantee-only read of the pinned handoff. The definer joins the explicit grant to the sharer's
-- aggregate and the exact pinned revision (both still active) and emits a fixed DTO: no whole
-- manifest, no layout/subject/evidence descriptors, no receipts, and no current-or-future
-- revision information. A removed source reads as the common not_found while the grant stays
-- live, so restoring the source revives the same original pin; an explicit revoke never does.
create or replace function public.read_investigation_handoff_v1(p_grant_id uuid)
returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  handoff jsonb;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  if p_grant_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select jsonb_build_object(
      'schema', 'mm.research_handoff.v1',
      'grant_id', g.id,
      'investigation_id', g.resource_id,
      'revision', g.resource_revision,
      'shared_by', g.granted_by,
      'committed_at', r.committed_at,
      'intent', jsonb_build_object('title', r.manifest #>> '{intent,title}',
                                   'question', r.manifest #>> '{intent,question}'),
      'continuation', jsonb_strip_nulls(jsonb_build_object(
        'next_question', r.manifest #> '{continuation,next_question}',
        'next_observation', r.manifest #> '{continuation,next_observation}')))
    into handoff
    from public.resource_grants g
    join public.investigations h
      on h.id = g.resource_id and h.user_id = g.granted_by and h.lifecycle = 'active'
    join public.investigation_revisions r
      on r.investigation_id = h.id and r.user_id = h.user_id
     and r.revision = g.resource_revision and r.lifecycle = 'active'
   where g.id = p_grant_id
     and g.resource_kind = 'investigation'
     and g.grantee_user_id = actor
     and g.revoked_at is null;
  if handoff is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'found', 'handoff', handoff);
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

-- Explicit revocation, owner-scoped and kind-bound. No DELETE, no receipt machinery, and never
-- a watchlist revoke or somebody else's grant. Revocation is terminal: an already-revoked owned
-- grant answers revoked again idempotently, and no restore of the source can revive it.
create or replace function public.revoke_investigation_handoff_v1(p_grant_id uuid)
returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  withdrawn uuid;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  if p_grant_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  update public.resource_grants g
     set revoked_at = pg_catalog.clock_timestamp()
   where g.id = p_grant_id
     and g.resource_kind = 'investigation'
     and g.granted_by = actor
     and g.revoked_at is null
   returning g.id into withdrawn;
  if withdrawn is not null then
    return jsonb_build_object('status', 'revoked');
  end if;
  if exists (select 1 from public.resource_grants g
              where g.id = p_grant_id
                and g.resource_kind = 'investigation'
                and g.granted_by = actor) then
    return jsonb_build_object('status', 'revoked');
  end if;
  return jsonb_build_object('status', 'not_found');
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

alter function public.owns_active_investigation_revision(uuid, integer) owner to postgres;
alter function public.investigation_handoff_summary_v1(uuid, uuid, integer, uuid, uuid, timestamptz, jsonb) owner to postgres;
alter function public.create_investigation_handoff_v1(uuid, integer, uuid) owner to postgres;
alter function public.list_investigation_handoffs_v1(uuid, uuid) owner to postgres;
alter function public.read_investigation_handoff_v1(uuid) owner to postgres;
alter function public.revoke_investigation_handoff_v1(uuid) owner to postgres;

-- No default EXECUTE survives on any new function: PUBLIC, anon, authenticated and service_role
-- are all stripped before the explicit authenticated grants. The two helpers stay internal --
-- owns_active_investigation_revision is granted to authenticated only because the new INSERT
-- policy evaluates it inside RLS, the 0021 owns_watchlist pattern. The dropped no-argument
-- overload needed no revoke here: dropping a function drops its ACL with it.
revoke all on function public.owns_active_investigation_revision(uuid, integer),
  public.investigation_handoff_summary_v1(uuid, uuid, integer, uuid, uuid, timestamptz, jsonb),
  public.create_investigation_handoff_v1(uuid, integer, uuid),
  public.list_investigation_handoffs_v1(uuid, uuid),
  public.read_investigation_handoff_v1(uuid),
  public.revoke_investigation_handoff_v1(uuid)
  from public, anon, authenticated;

do $$ begin
  revoke all on function public.owns_active_investigation_revision(uuid, integer),
    public.investigation_handoff_summary_v1(uuid, uuid, integer, uuid, uuid, timestamptz, jsonb),
    public.create_investigation_handoff_v1(uuid, integer, uuid),
    public.list_investigation_handoffs_v1(uuid, uuid),
    public.read_investigation_handoff_v1(uuid),
    public.revoke_investigation_handoff_v1(uuid)
    from service_role;
exception when undefined_object then null; end $$;

grant execute on function public.owns_active_investigation_revision(uuid, integer) to authenticated;

grant execute on function public.create_investigation_handoff_v1(uuid, integer, uuid),
  public.list_investigation_handoffs_v1(uuid, uuid),
  public.read_investigation_handoff_v1(uuid),
  public.revoke_investigation_handoff_v1(uuid)
  to authenticated;

-- Permissive INSERT policy, so it ORs with 0021's watchlist-only resource_grants_insert_owner:
-- the owner keeps the entire watchlist surface they had, and the new kind is admitted by a
-- separate policy whose only job is to require an active owned aggregate plus the exact active
-- pinned revision. The original policy text is untouched.
do $$ begin
  create policy resource_grants_insert_investigation_owner on public.resource_grants
    for insert to authenticated
    with check (
      granted_by = auth.uid()
      and grantee_user_id <> auth.uid()
      and resource_kind = 'investigation'
      and resource_revision is not null
      and public.owns_active_investigation_revision(resource_id, resource_revision));
exception when duplicate_object then null; end $$;

-- The table-level UPDATE grant stays exactly 0021's column list: revoked_at only. Adding the
-- column grants nothing, so no caller can ever write resource_revision directly; the guard
-- trigger above is the belt to that braces for any writer that reaches the table.
commit;

-- down:
-- Disable the consumer and revoke authenticated EXECUTE on the four handoff RPCs (the list RPC
-- under its two-uuid keyset signature).
-- Drop only resource_grants_insert_investigation_owner to stop new direct kind inserts.
-- drop policy if exists resource_grants_insert_investigation_owner on public.resource_grants;
-- Retain grant rows, resource_revision, its constraints and the immutable-field guard.
-- Keep legacy watchlist kind filters even when the handoff UI is disabled.
-- Destructive schema reversal needs a separately qualified data-preservation plan.
-- revoking a grant does not make its historical record disposable.

-- readback: (run after applying; the seat posts this output as the receipt)
--   select attname, attnotnull from pg_attribute
--     where attrelid='public.resource_grants'::regclass and attname='resource_revision';
--     -- expected exactly one row: resource_revision | f
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.resource_grants'::regclass and contype='c' order by 1;
--     -- expected 3: resource_grants_not_self unchanged from 0021;
--     --             resource_grants_resource_kind_check admitting watchlist AND investigation;
--     --             resource_grants_revision_matches_kind (watchlist => null, investigation => > 0)
--   select policyname, cmd from pg_policies
--     where schemaname='public' and tablename='resource_grants' order by 1;
--     -- expected 4: resource_grants_insert_investigation_owner INSERT,
--     --             resource_grants_insert_owner INSERT (unchanged 0021 text),
--     --             resource_grants_revoke_owner UPDATE, resource_grants_select_party SELECT
--   select has_column_privilege('authenticated','public.resource_grants','resource_revision','UPDATE'),
--          has_column_privilege('authenticated','public.resource_grants','revoked_at','UPDATE');
--     -- expected: f | t
--   select proname, prosecdef, proconfig from pg_proc
--     where pronamespace='public'::regnamespace and proname in
--       ('owns_active_investigation_revision','investigation_handoff_summary_v1',
--        'create_investigation_handoff_v1','list_investigation_handoffs_v1',
--        'read_investigation_handoff_v1','revoke_investigation_handoff_v1') order by 1;
--     -- expected 6 rows; the four RPCs prosecdef = t with search_path = ''
--   select pg_get_function_identity_arguments(oid) from pg_proc
--     where pronamespace='public'::regnamespace and proname='list_investigation_handoffs_v1';
--     -- expected exactly one row: "p_sent_after uuid, p_received_after uuid" -- the superseded
--     -- no-argument overload must not survive anywhere, or every zero-argument call is ambiguous
--   select has_function_privilege('authenticated','public.create_investigation_handoff_v1(uuid,integer,uuid)','EXECUTE'),
--          has_function_privilege('authenticated','public.list_investigation_handoffs_v1(uuid,uuid)','EXECUTE'),
--          has_function_privilege('authenticated','public.read_investigation_handoff_v1(uuid)','EXECUTE'),
--          has_function_privilege('authenticated','public.revoke_investigation_handoff_v1(uuid)','EXECUTE'),
--          has_function_privilege('authenticated','public.investigation_handoff_summary_v1(uuid,uuid,integer,uuid,uuid,timestamptz,jsonb)','EXECUTE');
--     -- expected: t | t | t | t | f
--   select tgname from pg_trigger where tgrelid='public.resource_grants'::regclass and not tgisinternal;
--     -- expected: resource_grants_revoke_is_terminal
--   select count(*) from public.resource_grants where resource_kind='investigation' and revoked_at is null;
--     -- informational: a replay must leave this count and every existing row byte-identical
