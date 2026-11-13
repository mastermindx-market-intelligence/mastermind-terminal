-- Mastermind Terminal -- explicit brief sharing-review requests (companion to EXISTING0048)
-- Ledger row: MMOS-AT04-EXPLICIT-BRIEF-SHARING-REQUEST (PR #1290)
-- Rollback: NONE: preserve request/grant history; disable callers and use reviewed forward repair.
--
-- SOURCE ONLY / UNAPPLIED. No new table, queue, role, policy or registry: the one
-- immutable sharing-review request per delivery lives in new sharing_request_* columns of
-- the already owner-scoped public.brief_deliveries row, under that table's existing RLS
-- and grants. EXISTING0048 (MMOS-AT20-BRIEF-TEAM-ACCESS) is referenced, never replaced,
-- redefined or re-granted. Namespace 0049 is claimed by PR #1290 after the complete
-- protected-source/open-PR census. The exact Terminal principal/session scopes below
-- carry no Auth0 equivalence claim.
--
-- The explicit request is a review/navigation source only; it never grants access by
-- itself, and content digest equality is an integrity precondition, never an access
-- claim. All statements are static; there is no dynamic SQL anywhere in this file.
--
-- This packet assumes it is applied by the same migration-owner role that applied 0048:
-- the definer bodies here call the 0048 functions, whose execute was revoked from PUBLIC.
-- Function owners always retain execute on their own functions, so a same-owner apply
-- needs no extra grant; a different applying role would need an explicit operator grant
-- outside this file.
do $mm_brief_sharing_request$ begin

alter table public.brief_deliveries
  add column if not exists sharing_request_ref uuid,
  add column if not exists sharing_request_revision integer,
  add column if not exists sharing_request_team_id uuid,
  add column if not exists sharing_request_content_sha256 text,
  add column if not exists sharing_request_issued_by uuid,
  add column if not exists sharing_request_issued_at timestamptz,
  add column if not exists sharing_request_status text,
  add column if not exists sharing_request_resolved_at timestamptz;

-- All-null OR full closed shape, same idiom as the 0048 share shape: a delivery carries
-- either no request at all, or exactly one complete immutable request. revision is
-- exactly 1 for this bounded first slice; OPEN is unresolved (resolved_at null), and
-- SHARED / KEPT_PRIVATE are resolved (resolved_at not null). The ref, intended team,
-- content digest, issuer and issuance timestamp are written once at issuance and are
-- never updated afterwards by any function in this file.
do $shape$ begin
  if not exists (select 1 from pg_catalog.pg_constraint
      where conrelid='public.brief_deliveries'::regclass
        and conname='brief_delivery_sharing_request_shape') then
    alter table public.brief_deliveries add constraint brief_delivery_sharing_request_shape check (
      (sharing_request_ref is null and sharing_request_revision is null
       and sharing_request_team_id is null and sharing_request_content_sha256 is null
       and sharing_request_issued_by is null and sharing_request_issued_at is null
       and sharing_request_status is null and sharing_request_resolved_at is null)
      or (sharing_request_ref is not null and sharing_request_revision is not null and sharing_request_revision = 1
       and sharing_request_team_id is not null
       and sharing_request_content_sha256 is not null and sharing_request_content_sha256 ~ '^[0-9a-f]{64}$'
       and sharing_request_issued_by is not null and sharing_request_issued_at is not null
       and sharing_request_status is not null and sharing_request_status in ('OPEN','SHARED','KEPT_PRIVATE')
       and ((sharing_request_status = 'OPEN' and sharing_request_resolved_at is null)
         or (sharing_request_status in ('SHARED','KEPT_PRIVATE')
             and sharing_request_resolved_at is not null))));
  end if;
end $shape$;

-- One request per delivery is structural (request state lives on the delivery row itself);
-- a request_ref already persisted on any delivery can never be adopted by a second one
-- (partial unique index: rows without a request carry a null ref).
create unique index if not exists brief_delivery_sharing_request_ref_unique
  on public.brief_deliveries(sharing_request_ref) where sharing_request_ref is not null;
-- Feed scan: newest OPEN requests first.
create index if not exists brief_delivery_sharing_request_open
  on public.brief_deliveries(sharing_request_issued_at desc)
  where sharing_request_status = 'OPEN';

-- Internal bound for a single request record (same ceiling as the 0048 sharing-view
-- bound, because the review payload embeds that whole view).
create or replace function public.brief_sharing_request_record_bound(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $bound$
begin
  if octet_length(convert_to(p_value::text,'UTF8')) > 131072 then
    raise exception using errcode='22023',message='brief sharing request unavailable';
  end if;
  return p_value;
end $bound$;


-- Closed request-record projection: schema / request_ref / revision / issued_at /
-- disposition / resolved_at, with the EXACT 0048 sharing view supplied by the caller as
-- the review payload. Internal helper: never granted to any client role.
create or replace function public.brief_sharing_request_record(
  p_ref uuid,p_revision integer,p_issued_at timestamptz,
  p_status text,p_resolved_at timestamptz,p_review jsonb)
returns jsonb language sql stable set search_path=pg_catalog as $record$
  select public.brief_sharing_request_record_bound(jsonb_build_object(
    'schema','mastermind.brief_sharing_request.v1',
    'request_ref',p_ref,'revision',p_revision,
    'issued_at',to_char(p_issued_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'disposition',p_status,
    'resolved_at',case when p_resolved_at is null then null else
      to_char(p_resolved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'review',p_review))
$record$;

-- Internal bound for the feed envelope: the frozen feed contract may never exceed 65536
-- bytes; an oversized feed is refused, never truncated.
create or replace function public.brief_sharing_request_feed_bound(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $bound$
begin
  if octet_length(convert_to(p_value::text,'UTF8')) > 65536 then
    raise exception using errcode='22023',message='brief sharing request feed unavailable';
  end if;
  return p_value;
end $bound$;

-- Explicit issuance. SECURITY DEFINER: the caller only ever proves, through
-- auth.uid(), that it owns the delivery (via its subscription) and currently holds
-- owner/admin in the intended team. The request itself carries no grant.
create or replace function public.issue_brief_sharing_request(
  p_delivery_id uuid,p_request_ref uuid,p_team_id uuid,p_expected_content_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $issue$
declare
  actor uuid:=auth.uid(); d public.brief_deliveries; t public.teams;
  subscription uuid; member_role text; content_digest text;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  if p_request_ref is null or p_team_id is null
     or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid brief sharing request';
  end if;
  -- EXISTING0048 lock order, unchanged: team advisory lock, team key share, member row
  -- update lock, subscription share lock, delivery update lock. The request columns ride
  -- on the delivery row, so no new lock object and no new lock order is introduced.
  perform pg_advisory_xact_lock(hashtext(p_team_id::text));
  select teams.* into t from public.teams where teams.id=p_team_id for key share;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select m.role into member_role from public.team_members m
    where m.team_id=p_team_id and m.user_id=actor for update;
  if not found or member_role not in ('owner','admin') then
    raise exception using errcode='42501',message='brief sharing request unavailable';
  end if;
  select bs.subscription_id into subscription from public.brief_subscriptions bs
    join public.brief_deliveries bd on bd.subscription_id=bs.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor for share of bs;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select bd.* into d from public.brief_deliveries bd
    where bd.delivery_id=p_delivery_id and bd.subscription_id=subscription for update;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  content_digest:=public.brief_delivery_content_sha256(d);
  if d.state <> 'ready' or content_digest <> p_expected_content_sha256 then
    raise exception using errcode='40001',message='brief sharing request source changed';
  end if;
  if d.sharing_request_ref is not null then
    -- One immutable request per delivery: the identical ref + actor + team + digest
    -- echoes the original row unchanged (same issuance timestamp, no write at all);
    -- any different input on the same delivery, or the same ref on a different one,
    -- conflicts. Delivery-row locking above serializes concurrent issuers.
    if d.sharing_request_ref = p_request_ref and d.sharing_request_issued_by = actor
       and d.sharing_request_team_id = p_team_id
       and d.sharing_request_content_sha256 = content_digest then
      return public.brief_sharing_request_record(d.sharing_request_ref,d.sharing_request_revision,
        d.sharing_request_issued_at,d.sharing_request_status,d.sharing_request_resolved_at,
        public.brief_delivery_sharing_view(d,t,actor,member_role in ('owner','admin')));
    end if;
    raise exception using errcode='40001',message='brief sharing request conflicts with original request';
  end if;
  -- An already-shared delivery never takes a new request.
  if d.shared_team_id is not null then
    raise exception using errcode='40001',message='brief sharing request conflicts with original grant';
  end if;
  if exists (select 1 from public.brief_deliveries bd
      where bd.sharing_request_ref = p_request_ref and bd.delivery_id <> p_delivery_id) then
    raise exception using errcode='40001',message='brief sharing request conflicts with original request';
  end if;
  begin
  update public.brief_deliveries bd set
      sharing_request_ref=p_request_ref, sharing_request_revision=1,
      sharing_request_team_id=p_team_id, sharing_request_content_sha256=content_digest,
      sharing_request_issued_by=actor, sharing_request_issued_at=clock_timestamp(),
      sharing_request_status='OPEN', sharing_request_resolved_at=null
    where bd.delivery_id=d.delivery_id returning bd.* into d;
  exception when unique_violation then
    raise exception using errcode='40001',message='brief sharing request conflicts with original request';
  end;
  return public.brief_sharing_request_record(d.sharing_request_ref,d.sharing_request_revision,
    d.sharing_request_issued_at,d.sharing_request_status,d.sharing_request_resolved_at,
    public.brief_delivery_sharing_view(d,t,actor,member_role in ('owner','admin')));
end $issue$;

-- Native sharing-review request feed. SECURITY DEFINER, read-only. The viewer identity is
-- the actual auth.uid() plus the actual verified auth.jwt() session_id claim; the
-- principal/session scopes are derived here and can never be accepted from arguments
-- (the function takes none). Missing, empty or non-UUID session_id refuses the feed.
create or replace function public.read_brief_sharing_requests()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $feed$
declare
  actor uuid:=auth.uid(); session_raw text; session_id uuid;
  principal_scope text; session_scope text;
  observed timestamptz:=now();
  requests jsonb:='[]'::jsonb; appended integer:=0;
  limit_reached boolean:=false; source_changed boolean:=false; authority_changed boolean:=false;
  title text; r record; scanned integer:=0;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing request feed unavailable'; end if;
  session_raw:=auth.jwt() ->> 'session_id';
  if session_raw is null or btrim(session_raw)='' or length(session_raw)>64 then
    raise exception using errcode='42501',message='brief sharing request feed unavailable';
  end if;
  begin
    session_id:=session_raw::uuid;
  exception when others then
    raise exception using errcode='42501',message='brief sharing request feed unavailable';
  end;
  principal_scope:=encode(sha256(convert_to(
    'mastermind.terminal.principal.v1:'||actor::text,'UTF8')),'hex');
  session_scope:=encode(sha256(convert_to(
    'mastermind.terminal.session.v1:'||actor::text||':'||session_id::text,'UTF8')),'hex');
  -- Scope: OPEN requests on deliveries this viewer actually owns through its own
  -- subscription. Member count is the plain team_members row count at read time; no
  -- invite or expiry inference of any kind. Rows are read without locks; every action
  -- function re-proves all currentness preconditions under the 0048 lock order.
  for r in
    select bd.delivery_id,bd.sharing_request_ref,bd.sharing_request_revision,
           bd.sharing_request_issued_at,bd.sharing_request_team_id,bd.sharing_request_issued_by,
           bd.sharing_request_content_sha256,bd.shared_team_id,bd.state,bd.body,bd.slot_asof,bd.artifact_asof,
           public.brief_delivery_content_sha256(bd) as current_digest,
           t.name as team_name,
           (select count(*) from public.team_members m
              where m.team_id=bd.sharing_request_team_id) as member_count,
           (select m.role from public.team_members m
              where m.team_id=bd.sharing_request_team_id and m.user_id=actor) as member_role
    from public.brief_deliveries bd
    join public.brief_subscriptions bs on bs.subscription_id=bd.subscription_id
    left join public.teams t on t.id=bd.sharing_request_team_id
    where bs.user_id=actor and bd.sharing_request_status='OPEN'
    order by bd.sharing_request_issued_at desc,bd.sharing_request_ref desc limit 201
  loop
    scanned:=scanned+1;
    if scanned>200 then limit_reached:=true; exit; end if;
    title:=r.body->'artifact'->>'name';
    if r.state <> 'ready' or r.current_digest <> r.sharing_request_content_sha256 or r.shared_team_id is not null
       or jsonb_typeof(r.body->'artifact'->'name') is distinct from 'string'
       or title is null or btrim(title)='' or length(title)>240 or title ~ '[[:cntrl:]]'
       or (r.team_name is not null and (btrim(r.team_name)='' or length(r.team_name)>240 or r.team_name ~ '[[:cntrl:]]')) then
      source_changed:=true;  -- suppressed, but never silently omitted from coverage
    elsif r.sharing_request_issued_by is distinct from actor or r.team_name is null or r.member_role is null
       or r.member_role not in ('owner','admin') then
      authority_changed:=true;
    else
      if appended < 20 then
        requests:=requests || jsonb_build_object(
          'request_ref',r.sharing_request_ref,'revision',r.sharing_request_revision,
          'issued_at',to_char(r.sharing_request_issued_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'delivery',jsonb_build_object(
            'delivery_id',r.delivery_id,'content_sha256',r.current_digest,
            'title',title,
            'slot_asof',to_char(r.slot_asof,'YYYY-MM-DD'),
            'artifact_asof',case when r.artifact_asof is null then null else
              to_char(r.artifact_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end),
          'audience',jsonb_build_object(
            'team_id',r.sharing_request_team_id,'name',r.team_name,
            'member_count',r.member_count,'membership_policy','DYNAMIC_TEAM_MEMBERSHIP'),
          'review',jsonb_build_object('request_ref',r.sharing_request_ref,
            'revision',1,'delivery_id',r.delivery_id));
        appended:=appended+1;
      else
        limit_reached:=true;
      end if;
    end if;
  end loop;
  -- No body, subscription id, target id, token or actor UUID is emitted; only the frozen
  -- envelope fields below. Coverage claims completeness only within this owned-request
  -- scope, never globally; suppressed requests force PARTIAL with a distinct reason code.
  return public.brief_sharing_request_feed_bound(jsonb_build_object(
    'schema','mastermind.terminal_sharing_request_feed.v1',
    'viewer',jsonb_build_object('principal_scope',principal_scope,'session_scope',session_scope),
    'source',jsonb_build_object('owner','TERMINAL_BRIEF_DELIVERY',
      'scope','OWNED_EXPLICIT_SHARING_REQUESTS',
      'observed_at',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
    'coverage',jsonb_build_object('state',
      case when limit_reached or source_changed or authority_changed
        then 'PARTIAL' else 'COMPLETE_WITHIN_SCOPE' end,
      'reason_codes',coalesce((select jsonb_agg(v.code order by v.ord) from (values
        (1,'LIMIT_REACHED',limit_reached),
        (2,'REQUEST_SOURCE_CHANGED',source_changed),
        (3,'REQUEST_AUTHORITY_CHANGED',authority_changed)) as v(ord,code,present)
        where v.present),'[]'::jsonb)),
    'requests',requests));
end $feed$;

-- Single exact-request review read. There is no free team argument anywhere: the
-- persisted request itself fixes the intended team. Exact owner + request + revision and
-- current team owner/admin plus unchanged ready digest are all required; missing, stale
-- or authority-changed requests refuse rather than degrade.
create or replace function public.read_brief_sharing_request(
  p_delivery_id uuid,p_request_ref uuid,p_revision integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $read_one$
declare
  actor uuid:=auth.uid(); d public.brief_deliveries; t public.teams; member_role text;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  if p_request_ref is null or p_revision is distinct from 1 then
    raise exception using errcode='22023',message='invalid brief sharing request';
  end if;
  select bd.* into d from public.brief_deliveries bd
    join public.brief_subscriptions bs on bs.subscription_id=bd.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor
      and bd.sharing_request_ref=p_request_ref and bd.sharing_request_revision=p_revision
      and bd.sharing_request_issued_by=actor;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select teams.* into t from public.teams where teams.id=d.sharing_request_team_id;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select m.role into member_role from public.team_members m
    where m.team_id=t.id and m.user_id=actor;
  if not found or member_role not in ('owner','admin') then
    raise exception using errcode='42501',message='brief sharing request unavailable';
  end if;
  if d.state <> 'ready'
     or public.brief_delivery_content_sha256(d) <> d.sharing_request_content_sha256 then
    raise exception using errcode='40001',message='brief sharing request source changed';
  end if;
  return public.brief_sharing_request_record(d.sharing_request_ref,d.sharing_request_revision,
    d.sharing_request_issued_at,d.sharing_request_status,d.sharing_request_resolved_at,
    public.brief_delivery_sharing_view(d,t,actor,member_role in ('owner','admin')));
end $read_one$;

-- Resolve an OPEN request by sharing. Same actual lock order, current authority, ready
-- state and exact request/digest preconditions as issuance; the share itself is the
-- EXISTING0048 share function called with the persisted intended team, never a caller
-- argument. The 0048 function re-takes the same advisory lock and re-locks the same rows
-- in the same order (all re-entrant within this transaction). No request write happens
-- unless every precondition held and the 0048 grant succeeded.
create or replace function public.share_requested_brief(
  p_delivery_id uuid,p_request_ref uuid,p_revision integer,
  p_expected_content_sha256 text,p_expected_effect_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $share_req$
declare
  actor uuid:=auth.uid(); d public.brief_deliveries; t public.teams;
  subscription uuid; member_role text; content_digest text; effect_digest text;
  request_team uuid; request_resolved timestamptz; review jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  if p_request_ref is null or p_revision is distinct from 1
     or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[0-9a-f]{64}$'
     or p_expected_effect_sha256 is null or p_expected_effect_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid brief sharing request';
  end if;
  select bd.sharing_request_team_id into request_team
    from public.brief_deliveries bd
    join public.brief_subscriptions bs on bs.subscription_id=bd.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor
      and bd.sharing_request_ref=p_request_ref and bd.sharing_request_revision=p_revision
      and bd.sharing_request_issued_by=actor;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  perform pg_advisory_xact_lock(hashtext(request_team::text));
  select teams.* into t from public.teams where teams.id=request_team for key share;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select m.role into member_role from public.team_members m
    where m.team_id=request_team and m.user_id=actor for update;
  if not found or member_role not in ('owner','admin') then
    raise exception using errcode='42501',message='brief sharing request unavailable';
  end if;
  select bs.subscription_id into subscription from public.brief_subscriptions bs
    join public.brief_deliveries bd on bd.subscription_id=bs.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor for share of bs;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select bd.* into d from public.brief_deliveries bd
    where bd.delivery_id=p_delivery_id and bd.subscription_id=subscription for update;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  content_digest:=public.brief_delivery_content_sha256(d);
  if d.sharing_request_ref is distinct from p_request_ref or d.sharing_request_revision is distinct from p_revision
     or d.sharing_request_issued_by is distinct from actor
     or d.state <> 'ready' or content_digest <> p_expected_content_sha256
     or content_digest <> d.sharing_request_content_sha256
     or d.sharing_request_team_id is distinct from request_team then
    raise exception using errcode='40001',message='brief sharing request source changed';
  end if;
  effect_digest:=public.brief_delivery_share_effect_sha256(d.delivery_id,content_digest,t.id,actor);
  if effect_digest <> p_expected_effect_sha256 then
    raise exception using errcode='40001',message='brief sharing operation changed';
  end if;
  if d.sharing_request_status = 'KEPT_PRIVATE' then
    raise exception using errcode='40001',message='brief sharing request conflicts with original request';
  end if;
  -- EXISTING0048 share: for an OPEN request this writes the grant; for an already SHARED
  -- request with an identical grant (team + content + actor + effect) it returns the
  -- original view without a new grant or timestamp. Any mismatching existing grant raises
  -- there, so a revoked authority or divergent share never reconciles.
  review:=public.share_brief_delivery(p_delivery_id,t.id,p_expected_content_sha256,p_expected_effect_sha256);
  if d.sharing_request_status = 'OPEN' then
    update public.brief_deliveries bd set sharing_request_status='SHARED',
        sharing_request_resolved_at=clock_timestamp()
      where bd.delivery_id=d.delivery_id and bd.sharing_request_status='OPEN'
      returning bd.sharing_request_resolved_at into request_resolved;
    if not found then
      raise exception using errcode='40001',message='brief sharing request conflicts with original request';
    end if;
  else
    request_resolved:=d.sharing_request_resolved_at;  -- SHARED duplicate: original timestamp
  end if;
  return public.brief_sharing_request_record(p_request_ref,p_revision,
    d.sharing_request_issued_at,'SHARED',request_resolved,review);
end $share_req$;

-- Resolve an OPEN request as kept private. Never touches an existing grant: a delivery
-- that already carries any 0048 share conflicts instead, and an already KEPT_PRIVATE
-- request echoes the original row with its unchanged resolved_at.
create or replace function public.keep_requested_brief_private(
  p_delivery_id uuid,p_request_ref uuid,p_revision integer,p_expected_content_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $keep$
declare
  actor uuid:=auth.uid(); d public.brief_deliveries; t public.teams;
  subscription uuid; member_role text; content_digest text; request_team uuid;
begin
  if actor is null then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  if p_request_ref is null or p_revision is distinct from 1
     or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid brief sharing request';
  end if;
  select bd.sharing_request_team_id into request_team
    from public.brief_deliveries bd
    join public.brief_subscriptions bs on bs.subscription_id=bd.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor
      and bd.sharing_request_ref=p_request_ref and bd.sharing_request_revision=p_revision
      and bd.sharing_request_issued_by=actor;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  perform pg_advisory_xact_lock(hashtext(request_team::text));
  select teams.* into t from public.teams where teams.id=request_team for key share;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select m.role into member_role from public.team_members m
    where m.team_id=request_team and m.user_id=actor for update;
  if not found or member_role not in ('owner','admin') then
    raise exception using errcode='42501',message='brief sharing request unavailable';
  end if;
  select bs.subscription_id into subscription from public.brief_subscriptions bs
    join public.brief_deliveries bd on bd.subscription_id=bs.subscription_id
    where bd.delivery_id=p_delivery_id and bs.user_id=actor for share of bs;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  select bd.* into d from public.brief_deliveries bd
    where bd.delivery_id=p_delivery_id and bd.subscription_id=subscription for update;
  if not found then raise exception using errcode='42501',message='brief sharing request unavailable'; end if;
  content_digest:=public.brief_delivery_content_sha256(d);
  if d.sharing_request_ref is distinct from p_request_ref or d.sharing_request_revision is distinct from p_revision
     or d.sharing_request_issued_by is distinct from actor
     or d.state <> 'ready' or content_digest <> p_expected_content_sha256
     or content_digest <> d.sharing_request_content_sha256
     or d.sharing_request_team_id is distinct from request_team then
    raise exception using errcode='40001',message='brief sharing request source changed';
  end if;
  -- SHARED implies an existing grant; both conflict here. Only a truly unshared OPEN (or
  -- already KEPT_PRIVATE) delivery reaches the resolution below.
  if d.shared_team_id is not null or d.sharing_request_status = 'SHARED' then
    raise exception using errcode='40001',message='brief sharing request conflicts with original request';
  end if;
  if d.sharing_request_status = 'KEPT_PRIVATE' then
    return public.brief_sharing_request_record(d.sharing_request_ref,d.sharing_request_revision,
      d.sharing_request_issued_at,d.sharing_request_status,d.sharing_request_resolved_at,
      public.brief_delivery_sharing_view(d,t,actor,member_role in ('owner','admin')));
  end if;
  update public.brief_deliveries bd set sharing_request_status='KEPT_PRIVATE',
      sharing_request_resolved_at=clock_timestamp()
    where bd.delivery_id=d.delivery_id and bd.sharing_request_status='OPEN'
    returning bd.* into d;
  if not found then
    raise exception using errcode='40001',message='brief sharing request conflicts with original request';
  end if;
  return public.brief_sharing_request_record(d.sharing_request_ref,d.sharing_request_revision,
    d.sharing_request_issued_at,d.sharing_request_status,d.sharing_request_resolved_at,
    public.brief_delivery_sharing_view(d,t,actor,member_role in ('owner','admin')));
end $keep$;

-- Privileges: only the five surface functions are executable by authenticated sessions.
-- The three internal helpers above stay callable by their function owner alone.
-- Explicitly revoke service_role as well: revoking PUBLIC does not remove a direct
-- or default EXECUTE grant already held by that role. Only the five surface
-- functions below are then granted to authenticated. No table privilege, no
-- UPDATE grant and no RLS policy is added or widened: the new columns live under the
-- existing owner-scoped brief_deliveries RLS, the owner could already read their own
-- whole row, and the feed never returns a whole row to any client.
revoke all on function public.brief_sharing_request_record(uuid,integer,timestamptz,text,timestamptz,jsonb),
  public.brief_sharing_request_record_bound(jsonb),
  public.brief_sharing_request_feed_bound(jsonb),
  public.issue_brief_sharing_request(uuid,uuid,uuid,text),
  public.read_brief_sharing_requests(),
  public.read_brief_sharing_request(uuid,uuid,integer),
  public.share_requested_brief(uuid,uuid,integer,text,text),
  public.keep_requested_brief_private(uuid,uuid,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.issue_brief_sharing_request(uuid,uuid,uuid,text),
  public.read_brief_sharing_requests(),
  public.read_brief_sharing_request(uuid,uuid,integer),
  public.share_requested_brief(uuid,uuid,integer,text,text),
  public.keep_requested_brief_private(uuid,uuid,integer,text) to authenticated;

end $mm_brief_sharing_request$;

-- down:
-- NONE: do not erase historical sharing-request state or drop the sharing_request_*
-- columns automatically. Removing them (and the partial unique ref index) destroys the
-- immutable per-delivery request record and its resolution; do that only through a
-- separately reviewed forward migration and its real access owner, never automatically.
-- The 0048 functions this file references are untouched and remain governed by their own
-- rollback note.
-- readback:
-- select column_name from information_schema.columns where table_schema='public'
--   and table_name='brief_deliveries' and column_name like 'sharing_request_%'
--   order by column_name;
-- select conname,pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.brief_deliveries'::regclass
--   and conname='brief_delivery_sharing_request_shape';
-- select indexname,indexdef from pg_indexes where schemaname='public'
--   and tablename='brief_deliveries' and indexname like 'brief_delivery_sharing_request%';
-- select proname,prosecdef,proconfig,
--   has_function_privilege('authenticated',oid,'execute') as authenticated_execute,
--   has_function_privilege('anon',oid,'execute') as anonymous_execute
-- from pg_proc where oid in (
--   'public.issue_brief_sharing_request(uuid,uuid,uuid,text)'::regprocedure,
--   'public.read_brief_sharing_requests()'::regprocedure,
--   'public.read_brief_sharing_request(uuid,uuid,integer)'::regprocedure,
--   'public.share_requested_brief(uuid,uuid,integer,text,text)'::regprocedure,
--   'public.keep_requested_brief_private(uuid,uuid,integer,text)'::regprocedure,
--   'public.brief_sharing_request_record(uuid,integer,timestamptz,text,timestamptz,jsonb)'::regprocedure);
-- select has_table_privilege('authenticated','public.brief_deliveries','update');
-- select policyname from pg_policies where schemaname='public' and tablename='brief_deliveries';
