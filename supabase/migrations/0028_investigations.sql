-- IW2 G1: one Investigation aggregate, converged from Saved Research #777.
-- Ledger row: 0028 | IW2-G1-INVESTIGATION | PR #777 | unapplied
-- Rollback: retain user data and disable RPC grants; restore from verified backup before destructive down.
-- Re-runnable source. Apply this file explicitly, never the entire migration directory.
begin;

create table if not exists public.investigations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_revision integer not null check (current_revision > 0),
  lifecycle text not null check (lifecycle in ('active','removed')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(id,user_id)
);
create table if not exists public.investigation_revisions (
  investigation_id uuid not null,
  user_id uuid not null,
  revision integer not null check (revision > 0),
  action text not null check (action in ('create','revise','remove','restore')),
  lifecycle text not null check (lifecycle in ('active','removed')),
  manifest jsonb not null,
  committed_at timestamptz not null,
  primary key(investigation_id,revision),
  foreign key(investigation_id,user_id) references public.investigations(id,user_id) on delete cascade
);
create table if not exists public.investigation_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key(user_id,operation_id)
);
-- This table belongs to the existing chart-layout owner, not to Investigation.
-- A deleted current layout must not erase an explicitly retained owner revision.
create table if not exists public.chart_layout_revisions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  layout_id uuid not null,
  source_revision integer not null check(source_revision > 0),
  name text not null,
  config jsonb not null,
  digest text not null,
  retained_at timestamptz not null,
  unique(id,user_id)
);
create index if not exists investigations_owner_updated on public.investigations(user_id,updated_at desc,id);
create index if not exists investigation_revisions_owner on public.investigation_revisions(user_id,investigation_id,revision);
create index if not exists chart_layout_revisions_owner on public.chart_layout_revisions(user_id,id);

alter table public.investigations enable row level security;
alter table public.investigation_revisions enable row level security;
alter table public.investigation_mutation_receipts enable row level security;
alter table public.chart_layout_revisions enable row level security;
drop policy if exists investigations_owner_read on public.investigations;
create policy investigations_owner_read on public.investigations for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists investigation_revisions_owner_read on public.investigation_revisions;
create policy investigation_revisions_owner_read on public.investigation_revisions for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists investigation_receipts_owner_read on public.investigation_mutation_receipts;
create policy investigation_receipts_owner_read on public.investigation_mutation_receipts for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists chart_layout_revisions_owner_read on public.chart_layout_revisions;
create policy chart_layout_revisions_owner_read on public.chart_layout_revisions for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.investigations,public.investigation_revisions,public.investigation_mutation_receipts,public.chart_layout_revisions from public,anon,authenticated;
grant select on public.investigations,public.investigation_revisions,public.investigation_mutation_receipts,public.chart_layout_revisions to authenticated;

-- Pure, private helpers. Scalars cannot contain NUL or unpaired surrogates in PostgreSQL JSONB.
create or replace function public.investigation_text_v2(v jsonb, lim integer, single_line boolean default false)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select coalesce(jsonb_typeof(v)='string' and char_length(v#>>'{}') between 1 and lim
    and btrim(v#>>'{}',E' \t\n\r'||U&'\00a0\feff\1680\2028\2029\202f\205f\3000\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a')<>''
    and (v#>>'{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    and (not single_line or (v#>>'{}') !~ '[\t\r\n]'),false)
$$;
create or replace function public.investigation_keys_v2(v jsonb, required text[], optional text[] default '{}')
returns boolean language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(v)='object' then v ?& required and not exists(select 1 from unnest(required) key where v->key='null'::jsonb) and not exists(
 select 1 from jsonb_object_keys(v) k where not(k=any(required||optional))) else false end
$$;
create or replace function public.investigation_json_v2(v jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,public as $$
begin
 case jsonb_typeof(v)
 when 'object' then return '{'||coalesce((select string_agg(to_jsonb(key)::text||':'||public.investigation_json_v2(value),',' order by key collate "C") from jsonb_each(v)),'')||'}';
 when 'array' then return '['||coalesce((select string_agg(public.investigation_json_v2(value),',' order by n) from jsonb_array_elements(v) with ordinality a(value,n)),'')||']';
 else return v::text;
 end case;
end $$;
create or replace function public.valid_investigation_manifest_v2(m jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb;
begin
 if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','continuation'],array['review_baseline_ref'])
 or m->>'schema'<>'investigation_manifest.v2' or octet_length(public.investigation_json_v2(m))>131072
 or not public.investigation_keys_v2(m->'intent',array['title','question','subjects'],array['horizon','research_as_of'])
 or not public.investigation_text_v2(m#>'{intent,title}',160,true)
 or not public.investigation_text_v2(m#>'{intent,question}',4000)
 or not public.investigation_keys_v2(m->'continuation','{}',array['next_question','next_observation']) then return false; end if;
 if m->'intent' ? 'horizon' and not public.investigation_text_v2(m#>'{intent,horizon}',64,true) then return false; end if;
 if m->'intent' ? 'research_as_of' then
   if jsonb_typeof(m#>'{intent,research_as_of}')<>'string' or (m#>>'{intent,research_as_of}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or to_char((m#>>'{intent,research_as_of}')::date,'YYYY-MM-DD')<>m#>>'{intent,research_as_of}' then return false; end if;
 end if;
 foreach k in array array['next_question','next_observation'] loop
  if m->'continuation' ? k and not public.investigation_text_v2(m->'continuation'->k,4000) then return false; end if;
 end loop;
 if jsonb_typeof(m#>'{intent,subjects}')<>'array' or jsonb_array_length(m#>'{intent,subjects}')>16 then return false; end if;
 for r in select value from jsonb_array_elements(m#>'{intent,subjects}') loop
  if not public.investigation_keys_v2(r,array['kind','owner','object_id'],array['version_ref'])
   or not public.investigation_text_v2(r->'object_id',256,true)
   or not ((r->>'owner'='terminal.analysis_symbol' and r->>'kind'='security') or (r->>'owner'='data_os.security_master' and r->>'kind' in ('security','issuer')))
   or (r ? 'version_ref' and not public.investigation_text_v2(r->'version_ref',256,true)) then return false; end if;
  if seen @> jsonb_build_array(r) then return false; end if; seen:=seen||jsonb_build_array(r);
 end loop;
 n:=0;
 foreach k in array array['layout_refs','thesis_refs','evidence_refs'] loop
  if jsonb_typeof(m->k)<>'array' then return false; end if;
  n:=n+jsonb_array_length(m->k);
 end loop;
 if n>128 or jsonb_array_length(m->'layout_refs')>4 or jsonb_array_length(m->'thesis_refs')>16 then return false; end if;
 seen:='[]';
 for r in select value from jsonb_array_elements(m->'layout_refs') loop
  if not public.investigation_keys_v2(r,array['layout_id','layout_revision_id','digest','role'])
  or (r->>'layout_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or (r->>'layout_revision_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or (r->>'digest') !~ '^[0-9a-f]{64}$' or r->>'role' not in ('primary','supporting') then return false; end if;
  identity:=jsonb_build_array(r->'layout_id',r->'layout_revision_id');
  if seen @> jsonb_build_array(identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
 end loop;
 -- Thesis integration remains with its owner. G1 admits no unverified Thesis rows.
 if jsonb_array_length(m->'thesis_refs')>0 then return false; end if;
 refs:=m->'evidence_refs';
 if m ? 'review_baseline_ref' then
  if m#>>'{review_baseline_ref,mode}' is distinct from 'pinned' then return false; end if;
  refs:=refs||jsonb_build_array(m->'review_baseline_ref');
 end if;
 seen:='[]';
 for r in select value from jsonb_array_elements(refs) loop
  if not public.investigation_keys_v2(r,array['owner','object_type','object_id','mode'],array['version_ref','fingerprint','selection'])
  or r->>'owner'<>'earnings.workspace_generation' or r->>'object_type'<>'event_workspace'
  or not public.investigation_text_v2(r->'object_id',256,true) or r->>'mode' not in ('pinned','follow_head')
  or (r->>'mode'='pinned' and not public.investigation_text_v2(r->'version_ref',256,true))
  or (r->>'mode'='follow_head' and (r ? 'version_ref' or r ? 'fingerprint'))
  or (r ? 'fingerprint' and (jsonb_typeof(r->'fingerprint')<>'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$'))
  or (r ? 'selection' and (not public.investigation_keys_v2(r->'selection',array['field']) or r#>>'{selection,field}' !~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.investigation_text_v2(jsonb,integer,boolean),public.investigation_keys_v2(jsonb,text[],text[]),public.valid_investigation_manifest_v2(jsonb),public.investigation_json_v2(jsonb) from public,anon,authenticated;

create or replace function public.apply_investigation_revision_v2(
 p_id uuid,p_expected_revision integer,p_action text,p_operation_id uuid,p_manifest jsonb,p_layout_capture jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,extensions as $$
declare
 actor uuid:=auth.uid(); request jsonb; prior public.investigation_mutation_receipts%rowtype;
 head public.investigations%rowtype; layout public.chart_layouts%rowtype;
 content jsonb:=p_manifest; output jsonb; stamp timestamptz:=clock_timestamp();
 next_revision integer; next_lifecycle text; ref jsonb; capture_id uuid; content_digest text;
begin
 if actor is null then return jsonb_build_object('status','unauthenticated'); end if;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_action is null or p_manifest is null then return jsonb_build_object('status','invalid_payload'); end if;
 request:=jsonb_build_object('principal',actor,'action',p_action,'target',p_id,'expected_revision',p_expected_revision,'manifest',p_manifest,'layout_capture',p_layout_capture);
 -- Same-principal operation lock is always first. Exact retry is independent of the current head.
 perform pg_advisory_xact_lock(hashtextextended('investigation.operation:'||actor::text||':'||p_operation_id::text,0));
 select * into prior from public.investigation_mutation_receipts where user_id=actor and operation_id=p_operation_id;
 if found then
  if prior.request=request then return prior.result; end if;
  return jsonb_build_object('status','idempotency_conflict');
 end if;
 if p_expected_revision<0 or p_action not in ('create','revise','remove','restore') or not public.valid_investigation_manifest_v2(content) then return jsonb_build_object('status','invalid_payload'); end if;
 -- Lock globally by target, including create, so foreign target collisions cannot race INSERT.
 perform pg_advisory_xact_lock(hashtextextended('investigation.target:'||p_id::text,0));
 select * into head from public.investigations where id=p_id for update;
 if found and head.user_id<>actor then return jsonb_build_object('status','not_found'); end if;
 if p_action='create' then
  if head.id is not null then return jsonb_build_object('status','version_conflict','current_revision',head.current_revision); end if;
  if p_expected_revision<>0 then return jsonb_build_object('status','invalid_payload'); end if;
  next_revision:=1; next_lifecycle:='active';
 else
  if head.id is null then return jsonb_build_object('status','not_found'); end if;
  if head.current_revision<>p_expected_revision then return jsonb_build_object('status','version_conflict','current_revision',head.current_revision); end if;
  if (p_action='restore' and head.lifecycle<>'removed') or (p_action<>'restore' and head.lifecycle<>'active') then return jsonb_build_object('status','invalid_transition'); end if;
  next_revision:=head.current_revision+1;
  next_lifecycle:=case when p_action='remove' then 'removed' else 'active' end;
 end if;
 -- Validate retained refs under this principal; unknown UUIDs are never trusted as captures.
 for ref in select value from jsonb_array_elements(content->'layout_refs') loop
  if not exists(select 1 from public.chart_layout_revisions r where r.user_id=actor and r.id=(ref->>'layout_revision_id')::uuid and r.layout_id=(ref->>'layout_id')::uuid and r.digest=ref->>'digest') then return jsonb_build_object('status','reference_unavailable'); end if;
 end loop;
 if p_layout_capture is not null then
  if p_action not in ('create','revise') or not public.investigation_keys_v2(p_layout_capture,array['layout_id','expected_revision','revision_id'])
   or jsonb_typeof(p_layout_capture->'layout_id')<>'string' or jsonb_typeof(p_layout_capture->'revision_id')<>'string'
   or (p_layout_capture->>'layout_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or (p_layout_capture->>'revision_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or jsonb_typeof(p_layout_capture->'expected_revision')<>'number' or (p_layout_capture->>'expected_revision') !~ '^[1-9][0-9]{0,8}$'
   or jsonb_array_length(content->'layout_refs')<>0 then return jsonb_build_object('status','invalid_payload'); end if;
  select * into layout from public.chart_layouts where id=(p_layout_capture->>'layout_id')::uuid and user_id=actor for share;
  if not found then return jsonb_build_object('status','reference_unavailable'); end if;
  if layout.config->>'schema' is distinct from 'workspace_layout.v1' or layout.config->'revision' is distinct from p_layout_capture->'expected_revision' then return jsonb_build_object('status','layout_conflict'); end if;
  capture_id:=(p_layout_capture->>'revision_id')::uuid;
  if exists(select 1 from public.chart_layout_revisions where id=capture_id) then return jsonb_build_object('status','reference_unavailable'); end if;
  content_digest:=encode(extensions.digest(convert_to(layout.config::text,'UTF8'),'sha256'),'hex');
  ref:=jsonb_build_object('layout_id',layout.id,'layout_revision_id',capture_id,'digest',content_digest,'role','primary');
  content:=jsonb_set(content,'{layout_refs}',jsonb_build_array(ref));
  if not public.valid_investigation_manifest_v2(content) then return jsonb_build_object('status','invalid_payload'); end if;
 end if;
 -- No INSERT/UPDATE occurs before every fallible validation above. The following effects share
 -- a transaction, and any constraint/storage failure rolls all four writes back together.
 if capture_id is not null then
  insert into public.chart_layout_revisions values(capture_id,actor,layout.id,(layout.config->>'revision')::integer,layout.name,layout.config,content_digest,stamp);
 end if;
 if p_action='create' then
  insert into public.investigations values(p_id,actor,next_revision,next_lifecycle,stamp,stamp);
 else
  update public.investigations set current_revision=next_revision,lifecycle=next_lifecycle,updated_at=stamp where id=p_id and user_id=actor;
 end if;
 insert into public.investigation_revisions values(p_id,actor,next_revision,p_action,next_lifecycle,content,stamp);
 output:=jsonb_build_object('status','committed','id',p_id,'revision',next_revision,'lifecycle',next_lifecycle,'manifest',content,'committed_at',stamp);
 insert into public.investigation_mutation_receipts values(actor,p_operation_id,request,output);
 return output;
end $$;
alter function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) to authenticated;

create or replace function public.read_investigation_v2(p_id uuid,p_revision integer default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public,auth as $$
 select coalesce((select jsonb_build_object('status','found','id',h.id,'current_revision',h.current_revision,'revision',r.revision,'lifecycle',r.lifecycle,'manifest',r.manifest,'committed_at',r.committed_at,
 'layouts',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'layout_id',l.layout_id,'config',l.config,'digest',l.digest)) from jsonb_array_elements(r.manifest->'layout_refs') ref
 join public.chart_layout_revisions l on l.id=(ref->>'layout_revision_id')::uuid and l.user_id=auth.uid() and l.digest=ref->>'digest'),'[]'::jsonb))
 from public.investigations h join public.investigation_revisions r on r.investigation_id=h.id and r.user_id=h.user_id and r.revision=coalesce(p_revision,h.current_revision)
 where h.id=p_id and h.user_id=auth.uid()),jsonb_build_object('status','not_found'))
$$;
create or replace function public.read_investigation_operation_v2(p_operation_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public,auth as $$
 select coalesce((select result from public.investigation_mutation_receipts where user_id=auth.uid() and operation_id=p_operation_id),jsonb_build_object('status','not_found'))
$$;
revoke all on function public.read_investigation_v2(uuid,integer),public.read_investigation_operation_v2(uuid) from public,anon,authenticated;
grant execute on function public.read_investigation_v2(uuid,integer),public.read_investigation_operation_v2(uuid) to authenticated;
commit;

-- down:
-- revoke execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) from authenticated;
-- Preserve heads/revisions/receipts/captures until backup restoration is independently verified.

-- readback:
-- select relname,relrowsecurity from pg_class where relname in ('investigations','investigation_revisions','investigation_mutation_receipts','chart_layout_revisions');
-- select proname,prosecdef,proconfig from pg_proc where proname in ('apply_investigation_revision_v2','read_investigation_v2','read_investigation_operation_v2');
