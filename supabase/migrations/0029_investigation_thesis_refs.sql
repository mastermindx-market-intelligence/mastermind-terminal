-- IW2 G5: retain exact canonical Thesis versions without copying belief content.
-- Ledger row: 0029 | IW2-G5-THESIS-REFERENCES | PR #804 | not applied
-- Prerequisites: applied 0012 and 0028. Apply only this file after review.
-- Rollback: disable Investigation writes first. Keep 0029 read/admission semantics
-- for existing references. Never overwrite 0028 or remove retained user data.
begin;

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
  identity:=jsonb_build_array(r->'owner',r->'kind',r->'object_id',r->'version_ref');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
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
  if m#>>'{review_baseline_ref,mode}' is distinct from 'pinned' then return false; end if;
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

commit;

-- down:
-- revoke execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) from authenticated;
-- Preserve retained Thesis references and the validator until forward repair or verified backup restoration.

-- readback:
-- select proname,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('valid_investigation_manifest_v2','apply_investigation_revision_v2') order by proname;
-- select has_function_privilege('authenticated','public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb)','EXECUTE') as authenticated_apply,has_function_privilege('anon','public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb)','EXECUTE') as anon_apply,has_function_privilege('authenticated','public.valid_investigation_manifest_v2(jsonb)','EXECUTE') as authenticated_validator;
-- select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('theses','thesis_versions','investigations','investigation_revisions') order by c.relname;
