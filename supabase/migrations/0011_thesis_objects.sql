-- F11-1: private, versioned Thesis Objects.
--
-- Source of record only. This repository does not run migrations automatically; production
-- application is a separate privileged, reconciled effect. The file is idempotent for the known
-- empty pre-F11 catalog and deliberately creates only one head table, one immutable version table,
-- and one authenticated transactional mutation boundary.

begin;

create table if not exists public.theses (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  current_version integer not null check (current_version > 0),
  lifecycle_state text not null check (lifecycle_state in ('active', 'archived', 'invalidated')),
  subject_ref jsonb not null check (jsonb_typeof(subject_ref) = 'object'),
  subject_digest bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.thesis_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  thesis_id uuid not null,
  user_id uuid not null,
  version integer not null check (version > 0),
  previous_version integer check (previous_version is null or previous_version > 0),
  transition text not null check (transition in ('create', 'revise', 'archive', 'reopen', 'invalidate')),
  lifecycle_state text not null check (lifecycle_state in ('active', 'archived', 'invalidated')),
  subject_ref jsonb not null check (jsonb_typeof(subject_ref) = 'object'),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  client_request_id uuid not null,
  request_fingerprint bytea not null,
  system_recorded_at timestamptz not null default now(),
  effective_at timestamptz,
  unique (thesis_id, version),
  unique (user_id, client_request_id),
  foreign key (thesis_id, user_id)
    references public.theses (id, user_id)
    on delete cascade,
  check (
    (version = 1 and previous_version is null and transition = 'create')
    or (version > 1 and previous_version = version - 1 and transition <> 'create')
  )
);

create index if not exists theses_owner_updated_idx
  on public.theses (user_id, updated_at desc, id);
create index if not exists theses_owner_subject_idx
  on public.theses (user_id, subject_digest, updated_at desc);
create index if not exists thesis_versions_owner_thesis_idx
  on public.thesis_versions (user_id, thesis_id, version desc);

alter table public.theses enable row level security;
alter table public.thesis_versions enable row level security;

drop policy if exists theses_select_own on public.theses;
create policy theses_select_own on public.theses
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists thesis_versions_select_own on public.thesis_versions;
create policy thesis_versions_select_own on public.thesis_versions
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.theses from public;
revoke all on table public.thesis_versions from public;
revoke all on table public.theses from anon, authenticated;
revoke all on table public.thesis_versions from anon, authenticated;
grant select on table public.theses to authenticated;
grant select on table public.thesis_versions to authenticated;

create or replace function public.apply_thesis_version_v1(
  p_thesis_id uuid,
  p_expected_version integer,
  p_transition text,
  p_subject_ref jsonb,
  p_content jsonb,
  p_client_request_id uuid,
  p_effective_at timestamptz default null
)
returns table (
  status text,
  thesis_id uuid,
  version integer,
  current_version integer,
  lifecycle_state text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_head public.theses%rowtype;
  v_prior public.thesis_versions%rowtype;
  v_fingerprint bytea;
  v_subject_digest bytea;
  v_subject_ref jsonb;
  v_next_state text;
  v_next_version integer;
  v_now timestamptz := clock_timestamp();
  v_title text;
  v_statement text;
  v_revision_note text;
begin
  status := null;
  thesis_id := null;
  version := null;
  current_version := null;
  lifecycle_state := null;
  replayed := false;

  if v_actor is null then
    status := 'not_found';
    return next;
    return;
  end if;

  -- Closed transition and identity vocabulary. UUID argument types close request-id syntax at the
  -- database boundary; application validation provides the more specific HTTP 400 response.
  if p_transition is null
     or p_transition not in ('create', 'revise', 'archive', 'invalidate', 'reopen')
     or p_expected_version is null or p_expected_version < 0
     or p_client_request_id is null
     or (p_transition = 'create' and (p_thesis_id is not null or p_expected_version <> 0))
     or (p_transition <> 'create' and (p_thesis_id is null or p_expected_version < 1)) then
    status := 'invalid_transition';
    return next;
    return;
  end if;

  -- The SECURITY DEFINER function must not trust the Next.js normalizer. Validate the complete
  -- closed subject object again: exact keys, bounded identities, and truthful listing scope.
  if p_subject_ref is null
     or jsonb_typeof(p_subject_ref) <> 'object'
     or not (p_subject_ref ?& array['schema','kind','owner','key','identity_state','display'])
     or exists (
       select 1 from jsonb_object_keys(p_subject_ref) as k(key)
       where k.key not in ('schema','kind','owner','key','identity_state','listing','company_id','display')
     )
     or jsonb_typeof(p_subject_ref->'schema') <> 'string'
     or jsonb_typeof(p_subject_ref->'kind') <> 'string'
     or jsonb_typeof(p_subject_ref->'owner') <> 'string'
     or jsonb_typeof(p_subject_ref->'key') <> 'string'
     or jsonb_typeof(p_subject_ref->'identity_state') <> 'string'
     or jsonb_typeof(p_subject_ref->'display') <> 'string'
     or p_subject_ref->>'schema' <> 'mastermind.thesis-subject-ref/v1'
     or p_subject_ref->>'kind' not in ('issuer','theme')
     or p_subject_ref->>'owner' not in ('data_os.security_master','terminal.analysis_symbol','macro.theme_registry')
     or (p_subject_ref->>'owner' = 'macro.theme_registry' and p_subject_ref->>'kind' <> 'theme')
     or (p_subject_ref->>'owner' in ('data_os.security_master','terminal.analysis_symbol')
         and p_subject_ref->>'kind' <> 'issuer')
     or p_subject_ref->>'identity_state' not in ('resolved','listing_scoped')
     or length(btrim(p_subject_ref->>'key')) not between 1 and 256
     or length(btrim(p_subject_ref->>'display')) not between 1 and 256
     or (p_subject_ref->>'key') ~ '[[:cntrl:]]'
     or (p_subject_ref->>'display') ~ '[[:cntrl:]]'
     or case
       when p_subject_ref ? 'listing' and jsonb_typeof(p_subject_ref->'listing') = 'object' then exists (
         select 1 from jsonb_object_keys(p_subject_ref->'listing') as lk(key)
         where lk.key not in ('symbol','mic','security_id')
       )
       else false
     end
     or (p_subject_ref ? 'listing' and (
       jsonb_typeof(p_subject_ref->'listing') <> 'object'
       or not ((p_subject_ref->'listing') ?& array['symbol','mic','security_id'])
       or jsonb_typeof(p_subject_ref->'listing'->'symbol') <> 'string'
       or jsonb_typeof(p_subject_ref->'listing'->'mic') not in ('string','null')
       or jsonb_typeof(p_subject_ref->'listing'->'security_id') not in ('string','null')
       or length(p_subject_ref->'listing'->>'symbol') not between 1 and 128
       or length(coalesce(p_subject_ref->'listing'->>'mic', '')) > 32
       or length(coalesce(p_subject_ref->'listing'->>'security_id', '')) > 256
       or (p_subject_ref->'listing'->>'symbol') ~ '[[:cntrl:]]'
       or coalesce((p_subject_ref->'listing'->>'mic') ~ '[[:cntrl:]]', false)
       or coalesce((p_subject_ref->'listing'->>'security_id') ~ '[[:cntrl:]]', false)
     ))
     or (p_subject_ref ? 'company_id' and jsonb_typeof(p_subject_ref->'company_id') not in ('string','null'))
     or length(coalesce(p_subject_ref->>'company_id', '')) > 256
     or coalesce((p_subject_ref->>'company_id') ~ '[[:cntrl:]]', false)
     or (p_subject_ref->>'identity_state' = 'listing_scoped' and (
       not (p_subject_ref ? 'listing')
       or p_subject_ref->>'owner' <> 'terminal.analysis_symbol'
       or p_subject_ref->>'kind' <> 'issuer'
       or jsonb_typeof(p_subject_ref->'listing') <> 'object'
       or length(btrim(p_subject_ref->'listing'->>'symbol')) not between 1 and 128
     ))
     or (p_subject_ref->>'kind' = 'theme' and p_subject_ref ? 'listing') then
    status := 'invalid_transition';
    return next;
    return;
  end if;

  -- Normalize at the authenticated database boundary before hashing or storing. The application
  -- performs the same trim/uppercase/null folding, so direct RPC callers cannot create an immutable
  -- subject whose next application mutation has different identity bytes.
  v_subject_ref := jsonb_build_object(
    'schema', p_subject_ref->>'schema',
    'kind', p_subject_ref->>'kind',
    'owner', p_subject_ref->>'owner',
    'key', btrim(p_subject_ref->>'key'),
    'identity_state', p_subject_ref->>'identity_state',
    'company_id', nullif(btrim(p_subject_ref->>'company_id'), ''),
    'display', btrim(p_subject_ref->>'display')
  );
  if p_subject_ref ? 'listing' then
    v_subject_ref := v_subject_ref || jsonb_build_object('listing', jsonb_build_object(
      'symbol', upper(btrim(p_subject_ref->'listing'->>'symbol')),
      'mic', nullif(btrim(p_subject_ref->'listing'->>'mic'), ''),
      'security_id', nullif(btrim(p_subject_ref->'listing'->>'security_id'), '')
    ));
  end if;

  -- Complete version snapshots only. No conviction/score/rank/model fields can pass the exact-key
  -- fence, and every list item is independently bounded before it reaches the immutable ledger.
  if p_content is null
     or jsonb_typeof(p_content) <> 'object'
     or not (p_content ?& array[
       'schema','title','statement','catalysts','falsifiers','risks','horizon','effective_at','revision_note'
     ])
     or exists (
       select 1 from jsonb_object_keys(p_content) as k(key)
       where k.key not in (
         'schema','title','statement','catalysts','falsifiers','risks','horizon','effective_at','revision_note'
       )
     )
     or jsonb_typeof(p_content->'schema') <> 'string'
     or p_content->>'schema' <> 'mastermind.thesis-content/v1'
     or jsonb_typeof(p_content->'title') <> 'string'
     or jsonb_typeof(p_content->'statement') <> 'string'
     or jsonb_typeof(p_content->'catalysts') <> 'array'
     or jsonb_typeof(p_content->'falsifiers') <> 'array'
     or jsonb_typeof(p_content->'risks') <> 'array'
     or jsonb_typeof(p_content->'horizon') <> 'string'
     or jsonb_typeof(p_content->'effective_at') not in ('string','null')
     or jsonb_typeof(p_content->'revision_note') not in ('string','null')
     or p_content->>'horizon' not in ('unspecified','days','weeks','months','quarters','years')
     or length(btrim(p_content->>'title')) not between 1 and 160
     or length(btrim(p_content->>'statement')) not between 1 and 12000
     or (p_content->>'title') ~ '[[:cntrl:]]'
     or regexp_replace(p_content->>'statement', E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]'
     or jsonb_array_length(p_content->'catalysts') > 20
     or jsonb_array_length(p_content->'falsifiers') > 20
     or jsonb_array_length(p_content->'risks') > 20
     or exists (
       select 1
       from jsonb_array_elements(
         (p_content->'catalysts') || (p_content->'falsifiers') || (p_content->'risks')
       ) as item(value)
       where jsonb_typeof(item.value) <> 'string'
          or length(btrim(item.value #>> '{}')) not between 1 and 500
          or (item.value #>> '{}') ~ '[[:cntrl:]]'
     ) then
    status := 'invalid_transition';
    return next;
    return;
  end if;

  v_title := btrim(p_content->>'title');
  v_statement := btrim(p_content->>'statement');
  v_revision_note := nullif(btrim(p_content->>'revision_note'), '');
  if length(coalesce(v_revision_note, '')) > 1000
     or regexp_replace(coalesce(v_revision_note, ''), E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]'
     or (p_transition = 'invalidate' and v_revision_note is null) then
    status := 'invalid_transition';
    return next;
    return;
  end if;

  -- The canonical content timestamp and typed column must agree. A malformed direct-RPC timestamp
  -- is caught below and becomes a closed invalid result, never a partial write.
  begin
    if (p_content->>'effective_at')::timestamptz is distinct from p_effective_at then
      status := 'invalid_transition';
      return next;
      return;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    status := 'invalid_transition';
    return next;
    return;
  end;

  v_subject_digest := extensions.digest(convert_to(v_subject_ref::text, 'UTF8'), 'sha256');
  v_fingerprint := extensions.digest(convert_to(jsonb_build_object(
    'thesis_id', p_thesis_id,
    'expected_version', p_expected_version,
    'transition', p_transition,
    'subject_ref', v_subject_ref,
    'content', p_content,
    'effective_at', p_effective_at
  )::text, 'UTF8'), 'sha256');

  -- Serialize equal request IDs before reading their unique row. This closes the concurrent-create
  -- replay race as well as ordinary transport retries; the lock is transaction-scoped.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_client_request_id::text, 0));
  select tv.* into v_prior
  from public.thesis_versions as tv
  where tv.user_id = v_actor and tv.client_request_id = p_client_request_id;
  if found then
    if v_prior.request_fingerprint <> v_fingerprint then
      status := 'idempotency_conflict';
      return next;
      return;
    end if;
    status := 'replayed';
    thesis_id := v_prior.thesis_id;
    version := v_prior.version;
    current_version := v_prior.version;
    lifecycle_state := v_prior.lifecycle_state;
    replayed := true;
    return next;
    return;
  end if;

  if p_transition = 'create' then
    thesis_id := extensions.gen_random_uuid();
    insert into public.theses (
      id, user_id, current_version, lifecycle_state, subject_ref, subject_digest, created_at, updated_at
    ) values (
      thesis_id, v_actor, 1, 'active', v_subject_ref, v_subject_digest, v_now, v_now
    );
    insert into public.thesis_versions (
      thesis_id, user_id, version, previous_version, transition, lifecycle_state,
      subject_ref, content, client_request_id, request_fingerprint, system_recorded_at, effective_at
    ) values (
      thesis_id, v_actor, 1, null, 'create', 'active',
      v_subject_ref, p_content, p_client_request_id, v_fingerprint, v_now, p_effective_at
    );
    status := 'created';
    version := 1;
    current_version := 1;
    lifecycle_state := 'active';
    return next;
    return;
  end if;

  select t.* into v_head
  from public.theses as t
  where t.id = p_thesis_id and t.user_id = v_actor
  for update;
  if not found then
    status := 'not_found';
    return next;
    return;
  end if;

  if v_head.current_version <> p_expected_version then
    status := 'version_conflict';
    current_version := v_head.current_version;
    lifecycle_state := v_head.lifecycle_state;
    return next;
    return;
  end if;

  -- Subject correction/rebinding is not a v1 transition. Equality is on the exact canonical JSONB
  -- snapshot digest, so a URL symbol or client guess cannot silently retarget an existing thesis.
  if v_head.subject_digest <> v_subject_digest then
    status := 'invalid_transition';
    return next;
    return;
  end if;

  v_next_state := case
    when p_transition = 'revise' and v_head.lifecycle_state = 'active' then 'active'
    when p_transition = 'archive' and v_head.lifecycle_state = 'active' then 'archived'
    when p_transition = 'invalidate' and v_head.lifecycle_state = 'active' then 'invalidated'
    when p_transition = 'reopen' and v_head.lifecycle_state in ('archived','invalidated') then 'active'
    else null
  end;
  if v_next_state is null
     or (p_transition = 'reopen' and v_head.lifecycle_state = 'invalidated' and v_revision_note is null) then
    status := 'invalid_transition';
    return next;
    return;
  end if;

  v_next_version := v_head.current_version + 1;
  insert into public.thesis_versions (
    thesis_id, user_id, version, previous_version, transition, lifecycle_state,
    subject_ref, content, client_request_id, request_fingerprint, system_recorded_at, effective_at
  ) values (
    v_head.id, v_actor, v_next_version, v_head.current_version, p_transition, v_next_state,
    v_subject_ref, p_content, p_client_request_id, v_fingerprint, v_now, p_effective_at
  );

  update public.theses
  set current_version = v_next_version,
      lifecycle_state = v_next_state,
      updated_at = v_now
  where id = v_head.id and user_id = v_actor;
  if not found then
    raise exception 'thesis head advance lost after row lock';
  end if;

  status := 'advanced';
  thesis_id := v_head.id;
  version := v_next_version;
  current_version := v_next_version;
  lifecycle_state := v_next_state;
  return next;
end;
$$;

alter function public.apply_thesis_version_v1(uuid, integer, text, jsonb, jsonb, uuid, timestamptz)
  owner to postgres;
revoke all on function public.apply_thesis_version_v1(uuid, integer, text, jsonb, jsonb, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_thesis_version_v1(uuid, integer, text, jsonb, jsonb, uuid, timestamptz)
  to authenticated;

commit;
