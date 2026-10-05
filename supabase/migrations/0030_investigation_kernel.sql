-- IW2 G1 forward repair. Never edit or reapply 0028/0029 for this repair.
-- Ledger row: 0030 | IW2-G1-KERNEL-REPAIR | PR #804 | not applied
-- Rollback: disable apply/reconcile grants and preserve retained data for forward repair.
-- Prerequisites: 0012, 0028 and 0029 already applied.
-- The approved Management API helper sends one statement per connection.
-- Keep the entire repair inside one DO statement, so a backfill/index failure
-- rolls back the validator, grants, schema and data together on that transport.
do $migration$
begin
perform set_config('search_path','pg_catalog,public,extensions',true);
execute $ddl$

create or replace function public.valid_investigation_manifest_v2(m jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb; endpoint jsonb;
begin
 if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','argument_relations','continuation'],array['review_baseline_ref'])
 or m->>'schema'<>'investigation_manifest.v2' or octet_length(public.investigation_json_v2(m))>131072
 or not public.investigation_keys_v2(m->'intent',array['title','question','subjects'],array['horizon','research_as_of'])
 or not public.investigation_text_v2(m#>'{intent,title}',160,true)
 or not public.investigation_text_v2(m#>'{intent,question}',4000)
 or not public.investigation_keys_v2(m->'continuation','{}',array['next_question','next_observation']) then return false; end if;
 if m->'intent' ? 'horizon' and not public.investigation_text_v2(m#>'{intent,horizon}',64,true) then return false; end if;
 if m->'intent' ? 'research_as_of' then
   if jsonb_typeof(m#>'{intent,research_as_of}')<>'string' or (m#>>'{intent,research_as_of}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     or to_char((m#>>'{intent,research_as_of}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>m#>>'{intent,research_as_of}' then return false; end if;
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
  identity:=jsonb_build_array(r->'owner',r->'kind',r->'object_id',r->'version_ref');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
 end loop;
 n:=0;
 foreach k in array array['layout_refs','thesis_refs','evidence_refs'] loop
  if jsonb_typeof(m->k)<>'array' then return false; end if;
  n:=n+jsonb_array_length(m->k);
 end loop;
 if jsonb_array_length(m->'evidence_refs')>128 or jsonb_array_length(m->'layout_refs')>4 or jsonb_array_length(m->'thesis_refs')>16 then return false; end if;
 seen:='[]';
 for r in select value from jsonb_array_elements(m->'layout_refs') loop
  if not public.investigation_keys_v2(r,array['layout_id','layout_revision_id','digest','role'])
  or (r->>'layout_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or (r->>'layout_revision_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or (r->>'digest') !~ '^[0-9a-f]{64}$' or r->>'role' not in ('primary','supporting') then return false; end if;
  identity:=jsonb_build_array(r->'layout_id',r->'layout_revision_id');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
 end loop;
 -- Only canonical, immutable Thesis version references belong in this manifest.
 seen:='[]';
 for r in select value from jsonb_array_elements(m->'thesis_refs') loop
  if not public.investigation_keys_v2(r,array['thesis_id','version_id','role'])
   or jsonb_typeof(r->'thesis_id')<>'string' or jsonb_typeof(r->'version_id')<>'string' or jsonb_typeof(r->'role')<>'string'
   or (r->>'thesis_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or (r->>'version_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or r->>'role' not in ('primary','alternative','context') then return false; end if;
  identity:=jsonb_build_array(r->'thesis_id',r->'version_id');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if;
  seen:=seen||jsonb_build_array(identity);
 end loop;
 refs:=m->'evidence_refs';
 if m ? 'review_baseline_ref' then
  if m#>>'{review_baseline_ref,mode}' is distinct from 'pinned' or not exists(select 1 from jsonb_array_elements(m->'evidence_refs') e where e=m->'review_baseline_ref') then return false; end if;
  refs:=refs||jsonb_build_array(m->'review_baseline_ref');
 end if;
 seen:='[]';
 n:=0;
 for r in select value from jsonb_array_elements(refs) loop
  if not public.investigation_keys_v2(r,array['owner','object_type','object_id','mode'],array['version_ref','fingerprint','selection'])
  or r->>'owner'<>'earnings.workspace_generation' or r->>'object_type'<>'event_workspace'
  or not public.investigation_text_v2(r->'object_id',256,true) or r->>'mode' not in ('pinned','follow_head')
  or (r->>'mode'='pinned' and not public.investigation_text_v2(r->'version_ref',256,true))
  or (r->>'mode'='follow_head' and (r ? 'version_ref' or r ? 'fingerprint'))
  or (r ? 'fingerprint' and (jsonb_typeof(r->'fingerprint')<>'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$'))
  or (r ? 'selection' and (not public.investigation_keys_v2(r->'selection',array['field']) or jsonb_typeof(r#>'{selection,field}')<>'string' or r#>>'{selection,field}' !~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if;
  n:=n+1;
  identity:=jsonb_build_array(r->'owner',r->'object_type',r->'object_id',r->'mode',r->'version_ref',r#>'{selection,field}');
  if n<=jsonb_array_length(m->'evidence_refs') then
   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
  end if;
 end loop;
 if jsonb_typeof(m->'argument_relations')<>'array' or jsonb_array_length(m->'argument_relations')>256 then return false; end if;
 for r in select value from jsonb_array_elements(m->'argument_relations') loop
  if not public.investigation_keys_v2(r,array['source','target','relation','rationale'],array['discrimination_criterion'])
   or r->>'relation' not in ('supports','weakens','contradicts','unresolved_interpretation','discriminates_between')
   or not public.investigation_text_v2(r->'rationale',4000)
   or (r ? 'discrimination_criterion' and not public.investigation_text_v2(r->'discrimination_criterion',4000)) then return false; end if;
  foreach k in array array['source','target'] loop
   endpoint:=r->k;
   if endpoint->>'kind'='thesis' then
    if not public.investigation_keys_v2(endpoint,array['kind','thesis_id','version_id'])
     or not exists(select 1 from jsonb_array_elements(m->'thesis_refs') e where e-'role'=endpoint-'kind') then return false; end if;
   elsif endpoint->>'kind'='evidence' then
    if not public.investigation_keys_v2(endpoint,array['kind','owner','object_type','object_id','mode'],array['version_ref','selection'])
     or not exists(select 1 from jsonb_array_elements(m->'evidence_refs') e where e-'fingerprint'=endpoint-'kind') then return false; end if;
   else return false;
   end if;
  end loop;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.investigation_text_v2(jsonb,integer,boolean),public.investigation_keys_v2(jsonb,text[],text[]),public.valid_investigation_manifest_v2(jsonb),public.investigation_json_v2(jsonb) from public,anon,authenticated;

-- Add immutable identities without rewriting retained manifests or historical receipts.
-- Lock out concurrent legacy writes while the owner lineage is backfilled.
lock table public.investigations,public.investigation_revisions,public.investigation_mutation_receipts,public.chart_layout_revisions in share row exclusive mode;
alter table public.investigation_revisions add column if not exists id uuid not null default gen_random_uuid();
alter table public.investigation_revisions add column if not exists parent_revision_id uuid;
alter table public.investigation_revisions add column if not exists operation_id uuid;
alter table public.investigation_revisions add column if not exists manifest_digest text;
alter table public.investigation_revisions add column if not exists parent_sequence integer generated always as (case when revision>1 then revision-1 else null end) stored;
alter table public.investigations add column if not exists current_revision_id uuid;

do $$begin
 if exists(select 1 from public.investigation_revisions r where r.operation_id is null and
  (select count(*) from public.investigation_mutation_receipts q where q.user_id=r.user_id
   and q.request->>'target'=r.investigation_id::text and q.request->>'action'=r.action
   and q.result->>'status'='committed' and q.result->>'id'=r.investigation_id::text
   and q.result->>'revision'=r.revision::text and q.result->'manifest'=r.manifest)<>1) then
  raise exception 'investigation_revision_receipt_lineage_ambiguous';
 end if;
end $$;
update public.investigation_revisions r set operation_id=q.operation_id
 from public.investigation_mutation_receipts q where r.operation_id is null and q.user_id=r.user_id
 and q.request->>'target'=r.investigation_id::text and q.request->>'action'=r.action
 and q.result->>'status'='committed' and q.result->>'id'=r.investigation_id::text
 and q.result->>'revision'=r.revision::text and q.result->'manifest'=r.manifest;
update public.investigation_revisions r set parent_revision_id=p.id from public.investigation_revisions p
 where r.revision>1 and r.parent_revision_id is null and p.investigation_id=r.investigation_id and p.user_id=r.user_id and p.revision=r.revision-1;
update public.investigation_revisions set manifest_digest=encode(extensions.digest(convert_to(public.investigation_json_v2(manifest),'UTF8'),'sha256'),'hex') where manifest_digest is null;
update public.investigations h set current_revision_id=r.id from public.investigation_revisions r where h.current_revision_id is null and r.investigation_id=h.id and r.user_id=h.user_id and r.revision=h.current_revision;
alter table public.investigation_revisions alter column operation_id set not null;
alter table public.investigation_revisions alter column manifest_digest set not null;
alter table public.investigations alter column current_revision_id set not null;
create unique index if not exists investigation_revision_identity on public.investigation_revisions(id,investigation_id,user_id,revision);
create unique index if not exists investigation_revision_uuid on public.investigation_revisions(id);
create unique index if not exists investigation_revision_operation on public.investigation_revisions(user_id,operation_id);
-- Existing duplicate captures require explicit owner reconciliation, never silent deletion.
create unique index if not exists chart_layout_revision_source on public.chart_layout_revisions(user_id,layout_id,source_revision);
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.investigation_revisions'::regclass and conname='investigation_revision_lineage') then
  alter table public.investigation_revisions add constraint investigation_revision_lineage check ((revision=1 and action='create' and parent_revision_id is null) or (revision>1 and action<>'create' and parent_revision_id is not null));
  alter table public.investigation_revisions add constraint investigation_revision_parent foreign key(parent_revision_id,investigation_id,user_id,parent_sequence) references public.investigation_revisions(id,investigation_id,user_id,revision);
  alter table public.investigation_revisions add constraint investigation_revision_receipt foreign key(user_id,operation_id) references public.investigation_mutation_receipts(user_id,operation_id) deferrable initially deferred;
  alter table public.investigation_revisions add constraint investigation_revision_digest check(manifest_digest ~ '^[0-9a-f]{64}$' and manifest_digest=encode(extensions.digest(convert_to(public.investigation_json_v2(manifest),'UTF8'),'sha256'),'hex'));
  alter table public.investigations add constraint investigation_head_revision foreign key(current_revision_id,id,user_id,current_revision) references public.investigation_revisions(id,investigation_id,user_id,revision) deferrable initially deferred;
 end if;
end $$;

create or replace function public.apply_investigation_revision_v2(
 p_id uuid,p_expected_revision integer,p_action text,p_operation_id uuid,p_manifest jsonb,p_layout_capture jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,extensions as $$
declare
 actor uuid:=auth.uid(); request jsonb; prior public.investigation_mutation_receipts%rowtype;
 head public.investigations%rowtype; layout public.chart_layouts%rowtype;
 content jsonb:=p_manifest; output jsonb; stamp timestamptz;
 next_revision integer; next_lifecycle text; ref jsonb; capture_id uuid; content_digest text;
 retained public.chart_layout_revisions%rowtype; revision_id uuid:=gen_random_uuid(); manifest_digest text;
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
 if p_expected_revision<0 or p_action not in ('create','revise','remove','restore') or (p_action in ('create','revise') and not public.valid_investigation_manifest_v2(content)) then return jsonb_build_object('status','invalid_payload'); end if;
 -- Serialize this principal's capacity check with every new mutation. Receipt replay above
 -- remains available at capacity. These limits include removed records and retained history.
 perform pg_advisory_xact_lock(hashtextextended('investigation.capacity:'||actor::text,0));
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
 if p_action in ('remove','restore') and p_manifest is distinct from (select manifest from public.investigation_revisions where investigation_id=p_id and revision=head.current_revision and user_id=actor) then
  return jsonb_build_object('status','invalid_transition');
 end if;
 if (p_action='create' and (select count(*) from public.investigations where user_id=actor)>=500)
 or (select count(*) from public.investigation_revisions where user_id=actor)>=2000 then
  return jsonb_build_object('status','limit_reached');
 end if;
 -- Validate retained refs under this principal; unknown UUIDs are never trusted as captures.
 for ref in select value from jsonb_array_elements(content->'layout_refs') loop
  if not exists(select 1 from public.chart_layout_revisions r where r.user_id=actor and r.id=(ref->>'layout_revision_id')::uuid and r.layout_id=(ref->>'layout_id')::uuid and r.digest=ref->>'digest') then return jsonb_build_object('status','reference_unavailable'); end if;
 end loop;
 -- Ownership and tuple identity are checked in the same transaction as the save.
 -- Stable ordering avoids opposite-order row locks across a multi-reference save.
 -- Current-head equality is deliberately absent: old canonical versions are valid.
 for ref in select value from jsonb_array_elements(content->'thesis_refs') order by value->>'thesis_id',value->>'version_id' loop
  perform 1 from public.theses t join public.thesis_versions v on v.thesis_id=t.id and v.user_id=t.user_id
   where t.user_id=actor and t.id=(ref->>'thesis_id')::uuid and v.user_id=actor and v.id=(ref->>'version_id')::uuid
   for key share of t,v;
  if not found then return jsonb_build_object('status','reference_unavailable'); end if;
 end loop;
 if p_layout_capture is not null then
  if p_action not in ('create','revise') or not public.investigation_keys_v2(p_layout_capture,array['layout_id','expected_revision'])
   or jsonb_typeof(p_layout_capture->'layout_id')<>'string'
   or (p_layout_capture->>'layout_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or jsonb_typeof(p_layout_capture->'expected_revision')<>'number' or (p_layout_capture->>'expected_revision') !~ '^[1-9][0-9]{0,8}$'
   or jsonb_array_length(content->'layout_refs')<>0 then return jsonb_build_object('status','invalid_payload'); end if;
  select * into layout from public.chart_layouts where id=(p_layout_capture->>'layout_id')::uuid and user_id=actor for update;
  if not found then return jsonb_build_object('status','reference_unavailable'); end if;
  if layout.config->>'schema' is distinct from 'workspace_layout.v1' or layout.config->'revision' is distinct from p_layout_capture->'expected_revision' then return jsonb_build_object('status','layout_conflict'); end if;
  -- Keep the existing layout-owner digest law so retained N remains readable.
  content_digest:=encode(extensions.digest(convert_to(layout.config::text,'UTF8'),'sha256'),'hex');
  select * into retained from public.chart_layout_revisions where user_id=actor and layout_id=layout.id and source_revision=(layout.config->>'revision')::integer;
  if found and (retained.config<>layout.config or retained.digest<>content_digest) then return jsonb_build_object('status','layout_conflict'); end if;
  capture_id:=coalesce(retained.id,gen_random_uuid());
  ref:=jsonb_build_object('layout_id',layout.id,'layout_revision_id',capture_id,'digest',content_digest,'role','primary');
  content:=jsonb_set(content,'{layout_refs}',jsonb_build_array(ref));
  if not public.valid_investigation_manifest_v2(content) then return jsonb_build_object('status','invalid_payload'); end if;
 end if;
 -- No INSERT/UPDATE occurs before every fallible validation above. The following effects share
 -- a transaction, and any constraint/storage failure rolls all four writes back together.
 -- Record the write phase after admission, not a potentially much earlier lock-wait start.
 stamp:=clock_timestamp();
 if capture_id is not null then
  insert into public.chart_layout_revisions values(capture_id,actor,layout.id,(layout.config->>'revision')::integer,layout.name,layout.config,content_digest,stamp)
   on conflict(user_id,layout_id,source_revision) do nothing;
  select * into retained from public.chart_layout_revisions where user_id=actor and layout_id=layout.id and source_revision=(layout.config->>'revision')::integer;
  if retained.id is distinct from capture_id or retained.config is distinct from layout.config or retained.digest is distinct from content_digest then
   -- Never return a normal rejection after a new capture effect: roll back instead.
   raise exception 'retained_layout_integrity_conflict';
  end if;
 end if;
 if p_action='create' then
  insert into public.investigations(id,user_id,current_revision,lifecycle,created_at,updated_at,current_revision_id) values(p_id,actor,next_revision,next_lifecycle,stamp,stamp,revision_id);
 else
  update public.investigations set current_revision=next_revision,lifecycle=next_lifecycle,updated_at=stamp where id=p_id and user_id=actor;
 end if;
 manifest_digest:=encode(extensions.digest(convert_to(public.investigation_json_v2(content),'UTF8'),'sha256'),'hex');
 insert into public.investigation_revisions(investigation_id,user_id,revision,action,lifecycle,manifest,committed_at,id,parent_revision_id,operation_id,manifest_digest)
 values(p_id,actor,next_revision,p_action,next_lifecycle,content,stamp,revision_id,head.current_revision_id,p_operation_id,manifest_digest);
 update public.investigations set current_revision_id=revision_id where id=p_id and user_id=actor;
 output:=jsonb_build_object('status','committed','id',p_id,'revision',next_revision,'lifecycle',next_lifecycle,'manifest',content,'committed_at',stamp,'investigation_id',p_id,'revision_id',revision_id,'sequence',next_revision,'parent_revision_id',head.current_revision_id,'operation_id',p_operation_id,'author_ref',actor,'recorded_at',stamp,'manifest_digest',manifest_digest);
 insert into public.investigation_mutation_receipts values(actor,p_operation_id,request,output);
 return output;
end $$;
alter function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) to authenticated;

-- Reconciliation is the same receipt owner and exact same operation lock.
-- A temporary SELECT miss remains inconclusive until this terminal fence commits.
create or replace function public.reconcile_investigation_operation_v2(
 p_id uuid,p_expected_revision integer,p_action text,p_operation_id uuid,p_manifest jsonb,p_layout_capture jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare actor uuid:=auth.uid(); request jsonb; prior public.investigation_mutation_receipts%rowtype; output jsonb;
begin
 if actor is null then return jsonb_build_object('status','unauthenticated'); end if;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_action is null or p_manifest is null then return jsonb_build_object('status','invalid_payload'); end if;
 request:=jsonb_build_object('principal',actor,'action',p_action,'target',p_id,'expected_revision',p_expected_revision,'manifest',p_manifest,'layout_capture',p_layout_capture);
 perform pg_advisory_xact_lock(hashtextextended('investigation.operation:'||actor::text||':'||p_operation_id::text,0));
 select * into prior from public.investigation_mutation_receipts where user_id=actor and operation_id=p_operation_id;
 if found then
  if prior.request=request then return prior.result; end if;
  return jsonb_build_object('status','idempotency_conflict');
 end if;
 -- Bound terminal fences. Recovery of an existing outcome is always available above.
 if p_expected_revision<0 or p_action not in ('create','revise','remove','restore') or octet_length(public.investigation_json_v2(p_manifest))>131072
  or jsonb_typeof(p_manifest)<>'object' or (p_layout_capture is not null and octet_length(p_layout_capture::text)>512) then return jsonb_build_object('status','invalid_payload'); end if;
 perform pg_advisory_xact_lock(hashtextextended('investigation.capacity:'||actor::text,0));
 if (select count(*) from public.investigation_mutation_receipts where user_id=actor)>=4000 then return jsonb_build_object('status','unavailable'); end if;
 output:=jsonb_build_object('status','not_applied','id',p_id,'operation_id',p_operation_id);
 insert into public.investigation_mutation_receipts values(actor,p_operation_id,request,output);
 return output;
end $$;
alter function public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb) to authenticated;

create or replace function public.read_investigation_v2(p_id uuid,p_revision integer default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public,auth as $$
 select coalesce((select jsonb_build_object('status','found','id',h.id,'current_revision',h.current_revision,'revision',r.revision,'lifecycle',r.lifecycle,'manifest',r.manifest,'committed_at',r.committed_at,'investigation_id',r.investigation_id,'revision_id',r.id,'sequence',r.revision,'parent_revision_id',r.parent_revision_id,'operation_id',r.operation_id,'author_ref',r.user_id,'recorded_at',r.committed_at,'manifest_digest',r.manifest_digest,
 'layouts',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'layout_id',l.layout_id,'name',l.name,'source_revision',l.source_revision,'config',l.config,'digest',l.digest)) from jsonb_array_elements(r.manifest->'layout_refs') ref
 join public.chart_layout_revisions l on l.id=(ref->>'layout_revision_id')::uuid and l.user_id=auth.uid() and l.digest=ref->>'digest'),'[]'::jsonb))
 from public.investigations h join public.investigation_revisions r on r.investigation_id=h.id and r.user_id=h.user_id and r.revision=coalesce(p_revision,h.current_revision)
 where h.id=p_id and h.user_id=auth.uid()),jsonb_build_object('status','not_found'))
$$;

$ddl$;
end $migration$;

-- down:
-- Disable Investigation writes, preserve retained rows and use a reviewed forward repair.
-- revoke execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb),public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb) from authenticated;
-- readback:
-- select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('valid_investigation_manifest_v2','apply_investigation_revision_v2','reconcile_investigation_operation_v2','read_investigation_v2') order by proname;
-- select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='investigation_revisions' and column_name in ('id','parent_revision_id','parent_sequence','operation_id','manifest_digest') order by column_name;
-- select conname,condeferrable,condeferred from pg_constraint where conrelid in ('public.investigations'::regclass,'public.investigation_revisions'::regclass) and conname in ('investigation_revision_lineage','investigation_revision_parent','investigation_revision_receipt','investigation_revision_digest','investigation_head_revision') order by conname;
-- select indexname from pg_indexes where schemaname='public' and indexname in ('investigation_revision_identity','investigation_revision_uuid','investigation_revision_operation','chart_layout_revision_source') order by indexname;
-- select has_function_privilege('authenticated','public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb)','EXECUTE') as authenticated_reconcile,has_function_privilege('anon','public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb)','EXECUTE') as anon_reconcile;
