-- Ledger row: MMOS-AT20-BRIEF-TEAM-ACCESS
-- Rollback: NONE: additive access source requires reviewed forward repair.
-- SOURCE ONLY / UNAPPLIED. No new scheduler, delivery, membership or authority store.
-- One exact delivered snapshot may be shared with one existing team, view only.
-- Membership stays dynamic; private subscriptions and underlying targets stay private.
do $mm_brief_share$ begin

alter table public.brief_deliveries
  add column if not exists shared_team_id uuid,
  add column if not exists shared_content_sha256 text,
  add column if not exists shared_effect_sha256 text,
  add column if not exists shared_by uuid,
  add column if not exists shared_at timestamptz;

-- Historical team/actor identities deliberately do not cascade or rebind a personal
-- delivery when a team/member disappears. Current read checks require the real team
-- and current membership. Deleting a subscription retains its existing cascade.
do $shape$ begin
  if not exists (select 1 from pg_catalog.pg_constraint
      where conrelid='public.brief_deliveries'::regclass and conname='brief_delivery_share_shape') then
    alter table public.brief_deliveries add constraint brief_delivery_share_shape check (
      (shared_team_id is null and shared_content_sha256 is null and shared_effect_sha256 is null
       and shared_by is null and shared_at is null)
      or (shared_team_id is not null and shared_by is not null and shared_at is not null
          and shared_content_sha256 is not null and shared_content_sha256 ~ '^[0-9a-f]{64}$'
          and shared_effect_sha256 is not null and shared_effect_sha256 ~ '^[0-9a-f]{64}$'));
  end if;
end $shape$;

create or replace function public.brief_delivery_content_sha256(p_delivery public.brief_deliveries)
returns text language sql immutable parallel safe set search_path=pg_catalog as $digest$
  select encode(sha256(convert_to(jsonb_build_object(
    'delivery_id',p_delivery.delivery_id,
    'slot_asof',to_char(p_delivery.slot_asof,'YYYY-MM-DD'),
    'artifact_asof',case when p_delivery.artifact_asof is null then null else
      to_char(p_delivery.artifact_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'state',p_delivery.state,'body',p_delivery.body)::text,'UTF8')),'hex')
$digest$;

create or replace function public.brief_delivery_share_effect_sha256(
  p_delivery_id uuid,p_content text,p_team uuid,p_actor uuid)
returns text language sql immutable parallel safe set search_path=pg_catalog as $effect$
  select encode(sha256(convert_to(jsonb_build_object(
    'schema','mastermind.brief_delivery_share_effect.v1','delivery_id',p_delivery_id,
    'content_sha256',p_content,'team_id',p_team,'shared_by',p_actor)::text,'UTF8')),'hex')
$effect$;

create or replace function public.brief_delivery_share_grant(p_delivery public.brief_deliveries)
returns jsonb language sql immutable parallel safe set search_path=pg_catalog as $grant$
  select case when p_delivery.shared_team_id is null then null else jsonb_build_object(
    'team_id',p_delivery.shared_team_id,'content_sha256',p_delivery.shared_content_sha256,
    'effect_sha256',p_delivery.shared_effect_sha256,'shared_by',p_delivery.shared_by,
    'shared_at',to_char(p_delivery.shared_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end
$grant$;

create or replace function public.brief_delivery_sharing_bound(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $bound$
begin
  if octet_length(convert_to(p_value::text,'UTF8')) > 131072 then
    raise exception using errcode='22023',message='brief sharing response unavailable';
  end if;
  return p_value;
end $bound$;

create or replace function public.brief_delivery_sharing_view(
  p_delivery public.brief_deliveries,p_team public.teams,p_actor uuid,p_can_share boolean)
returns jsonb language sql immutable set search_path=pg_catalog as $view$
  select public.brief_delivery_sharing_bound(jsonb_build_object(
    'schema','mastermind.brief_delivery_sharing.v1',
    'delivery',jsonb_build_object('delivery_id',p_delivery.delivery_id,
      'slot_asof',to_char(p_delivery.slot_asof,'YYYY-MM-DD'),
      'artifact_asof',case when p_delivery.artifact_asof is null then null else
        to_char(p_delivery.artifact_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'content_sha256',public.brief_delivery_content_sha256(p_delivery),'body',p_delivery.body),
    'audience',jsonb_build_object('team_id',p_team.id,'name',p_team.name,
      'membership_policy','DYNAMIC_TEAM_MEMBERSHIP'),
    'eligibility',jsonb_build_object('can_share',p_can_share),
    'expected_effect_sha256',public.brief_delivery_share_effect_sha256(
      p_delivery.delivery_id,public.brief_delivery_content_sha256(p_delivery),p_team.id,p_actor),
    'grant',public.brief_delivery_share_grant(p_delivery)))
$view$;

create or replace function public.read_brief_delivery_sharing(p_delivery_id uuid,p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $read$
declare
  actor uuid:=auth.uid(); d public.brief_deliveries; t public.teams; member_role text;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  select bd.* into d from public.brief_deliveries bd
    join public.brief_subscriptions bs on bs.subscription_id=bd.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor;
  if not found then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  select teams.* into t from public.teams where teams.id=p_team_id;
  if not found then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  select m.role into member_role from public.team_members m where m.team_id=p_team_id and m.user_id=actor;
  if not found then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  if d.state <> 'ready' then raise exception using errcode='22023',message='brief is not ready for sharing'; end if;
  return public.brief_delivery_sharing_view(d,t,actor,member_role in ('owner','admin'));
end $read$;

create or replace function public.share_brief_delivery(
  p_delivery_id uuid,p_team_id uuid,p_expected_content_sha256 text,p_expected_effect_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $share$
declare
  actor uuid:=auth.uid(); d public.brief_deliveries; t public.teams;
  subscription uuid; member_role text; content_digest text; effect_digest text;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  if p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[0-9a-f]{64}$'
      or p_expected_effect_sha256 is null or p_expected_effect_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid brief sharing selection';
  end if;
  -- Same team lock order as the existing ownership-transfer owner. Row locks
  -- also serialize direct membership UPDATE/DELETE and deletion of the team.
  perform pg_advisory_xact_lock(hashtext(p_team_id::text));
  select teams.* into t from public.teams where teams.id=p_team_id for key share;
  if not found then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  select m.role into member_role from public.team_members m
    where m.team_id=p_team_id and m.user_id=actor for update;
  if not found or member_role not in ('owner','admin') then
    raise exception using errcode='42501',message='brief sharing unavailable';
  end if;
  select bs.subscription_id into subscription from public.brief_subscriptions bs
    join public.brief_deliveries bd on bd.subscription_id=bs.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor for share of bs;
  if not found then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  select bd.* into d from public.brief_deliveries bd
    where bd.delivery_id=p_delivery_id and bd.subscription_id=subscription for update;
  if not found then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  content_digest:=public.brief_delivery_content_sha256(d);
  if d.state <> 'ready' or content_digest <> p_expected_content_sha256 then
    raise exception using errcode='40001',message='brief sharing source changed';
  end if;
  effect_digest:=public.brief_delivery_share_effect_sha256(d.delivery_id,content_digest,t.id,actor);
  if effect_digest <> p_expected_effect_sha256 then
    raise exception using errcode='40001',message='brief sharing operation changed';
  end if;
  if d.shared_team_id is not null then
    if d.shared_team_id <> t.id or d.shared_content_sha256 <> content_digest
       or d.shared_by <> actor or d.shared_effect_sha256 <> effect_digest then
      raise exception using errcode='40001',message='brief sharing conflicts with original grant';
    end if;
    return public.brief_delivery_sharing_view(d,t,actor,true);
  end if;
  update public.brief_deliveries bd set shared_team_id=t.id,shared_content_sha256=content_digest,
    shared_effect_sha256=effect_digest,shared_by=actor,shared_at=clock_timestamp()
    where bd.delivery_id=d.delivery_id returning bd.* into d;
  return public.brief_delivery_sharing_view(d,t,actor,true);
end $share$;

create or replace function public.reconcile_brief_delivery_sharing(
  p_delivery_id uuid,p_expected_effect_sha256 text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $receipt$
declare actor uuid:=auth.uid(); d public.brief_deliveries; observation text; matched boolean;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  if p_expected_effect_sha256 is null or p_expected_effect_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid brief sharing selection';
  end if;
  select bd.* into d from public.brief_deliveries bd
    join public.brief_subscriptions bs on bs.subscription_id=bd.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor;
  if not found then raise exception using errcode='42501',message='brief sharing unavailable'; end if;
  matched:=d.shared_effect_sha256=p_expected_effect_sha256;
  observation:=case when d.shared_team_id is null then 'NOT_OBSERVED'
    when matched then 'MATCHED' else 'CONFLICT' end;
  return jsonb_build_object('schema','mastermind.brief_delivery_sharing_receipt.v1',
    'delivery_id',d.delivery_id,'expected_effect_sha256',p_expected_effect_sha256,
    'observation',observation,'grant',case when matched then public.brief_delivery_share_grant(d) else null end,
    'current_access',coalesce(matched and d.state='ready'
      and public.brief_delivery_content_sha256(d)=d.shared_content_sha256
      and exists(select 1 from public.teams where id=d.shared_team_id),false));
end $receipt$;

create or replace function public.read_shared_brief_delivery(p_delivery_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $member$
declare actor uuid:=auth.uid(); d public.brief_deliveries; t public.teams; safe_body jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='shared brief unavailable'; end if;
  select bd.* into d from public.brief_deliveries bd where bd.delivery_id=p_delivery_id;
  if not found or d.shared_team_id is null or d.state <> 'ready'
      or public.brief_delivery_content_sha256(d) <> d.shared_content_sha256 then
    raise exception using errcode='42501',message='shared brief unavailable';
  end if;
  select teams.* into t from public.teams where teams.id=d.shared_team_id
    and exists(select 1 from public.team_members m where m.team_id=teams.id and m.user_id=actor);
  if not found then raise exception using errcode='42501',message='shared brief unavailable'; end if;
  if jsonb_typeof(d.body->'market_read') is distinct from 'array'
      or jsonb_typeof(d.body->'monitors') is distinct from 'array'
      or jsonb_typeof(d.body->'artifact') is distinct from 'object' then
    raise exception using errcode='22023',message='shared brief content unavailable';
  end if;
  -- Explicit field projection, including inside arrays: recipients never receive
  -- private target/subscription identifiers or unknown producer metadata.
  safe_body:=jsonb_build_object(
    'market_read',coalesce((select jsonb_agg(jsonb_build_object('section',e->>'section',
      'sentence_en',e->>'sentence_en','sentence_zh',e->>'sentence_zh','asof',e->>'asof'))
      from jsonb_array_elements(d.body->'market_read') e),'[]'::jsonb),
    'monitors',coalesce((select jsonb_agg(jsonb_build_object('name',e->>'name',
      'state_en',e->>'state_en','state_zh',e->>'state_zh'))
      from jsonb_array_elements(d.body->'monitors') e),'[]'::jsonb),
    'artifact',jsonb_build_object('name',d.body->'artifact'->>'name','asof',d.body->'artifact'->>'asof'));
  return public.brief_delivery_sharing_bound(jsonb_build_object(
    'schema','mastermind.shared_brief_delivery.v1','delivery',jsonb_build_object(
      'delivery_id',d.delivery_id,'slot_asof',to_char(d.slot_asof,'YYYY-MM-DD'),
      'artifact_asof',case when d.artifact_asof is null then null else
        to_char(d.artifact_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'content_sha256',d.shared_content_sha256,'body',safe_body),
    'audience',jsonb_build_object('team_id',t.id,'name',t.name,'membership_policy','DYNAMIC_TEAM_MEMBERSHIP')));
end $member$;

-- The private source table's owner RLS and authenticated SELECT-only grant are
-- unchanged. No team whole-row SELECT policy: it would expose subscription IDs.
revoke all on function public.brief_delivery_content_sha256(public.brief_deliveries),
  public.brief_delivery_share_effect_sha256(uuid,text,uuid,uuid),
  public.brief_delivery_share_grant(public.brief_deliveries),
  public.brief_delivery_sharing_bound(jsonb),
  public.brief_delivery_sharing_view(public.brief_deliveries,public.teams,uuid,boolean),
  public.read_brief_delivery_sharing(uuid,uuid),public.share_brief_delivery(uuid,uuid,text,text),
  public.reconcile_brief_delivery_sharing(uuid,text),public.read_shared_brief_delivery(uuid)
  from public,anon,authenticated;
grant execute on function public.read_brief_delivery_sharing(uuid,uuid),
  public.share_brief_delivery(uuid,uuid,text,text),public.reconcile_brief_delivery_sharing(uuid,text),
  public.read_shared_brief_delivery(uuid) to authenticated;
end $mm_brief_share$;

-- down:
-- NONE: do not erase historical sharing metadata or restore a guessed access
-- policy. Revoke an exact grant or change its policy only through a separately
-- reviewed forward migration and its real access owner; never run automatically.
-- readback:
-- select proname,prosecdef,proconfig,
--   has_function_privilege('authenticated',oid,'execute') as authenticated_execute,
--   has_function_privilege('anon',oid,'execute') as anonymous_execute
-- from pg_proc where oid in (
--   'public.read_brief_delivery_sharing(uuid,uuid)'::regprocedure,
--   'public.share_brief_delivery(uuid,uuid,text,text)'::regprocedure,
--   'public.reconcile_brief_delivery_sharing(uuid,text)'::regprocedure,
--   'public.read_shared_brief_delivery(uuid)'::regprocedure);
-- select column_name from information_schema.columns where table_schema='public'
--   and table_name='brief_deliveries' and column_name like 'shared_%' order by column_name;
-- select policyname from pg_policies where schemaname='public' and tablename='brief_deliveries';
-- select has_table_privilege('authenticated','public.brief_deliveries','update');
