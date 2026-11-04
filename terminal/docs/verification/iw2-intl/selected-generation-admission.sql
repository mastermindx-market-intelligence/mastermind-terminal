-- PREPARED SOURCE ONLY, NOT APPLIED. Requires existing0030/0039/0040/0041/0042/0043.
-- Not a numbered migration or an application/qualification grant. Numbering and
-- namespace admission must be reconciled before any separately authorized release.
-- Rollback: NONE: retain saved revisions; close ingress and use reviewed forward repair.
begin;
do $preimage$
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.valid_investigation_manifest_v2(jsonb)')) is distinct from 'fef99f4987c9a493247819a36942dda7' then
  raise exception 'IW2 International: expected exact0043 predicate body; reconcile newer source before application';
 end if;
end $preimage$;

create or replace function public.valid_investigation_intl_ref_v1(r jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
begin
 return coalesce(public.investigation_keys_v2(r,array['owner','object_type','object_id','mode','version_ref','fingerprint','selection'])
 and r->>'owner'='intl.workspace_generation' and r->>'object_type'='selected_generation' and r->>'mode'='pinned'
 and public.investigation_text_v2(r->'object_id',256,true) and r->>'object_id' ~ '^intl-workspace-context:sha256:[0-9a-f]{64}$'
 and public.investigation_text_v2(r->'version_ref',256,true) and r->>'version_ref' ~ '^im-workspace-generation:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 and jsonb_typeof(r->'fingerprint')='string' and r->>'fingerprint' ~ '^[0-9a-f]{64}$'
 and public.investigation_keys_v2(r->'selection',array['field']) and jsonb_typeof(r#>'{selection,field}')='string'
 and r#>>'{selection,field}' ~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$',false);
exception when others then return false;
end $$;

create or replace function public.valid_investigation_intl_scope_v1(m jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare refs jsonb; subjects jsonb; first_ref jsonb; r jsonb; s jsonb; seen jsonb:='[]'; b jsonb;
begin
 select coalesce(jsonb_agg(value),'[]'::jsonb) into refs from jsonb_array_elements(m->'evidence_refs') where value->>'owner'='intl.workspace_generation';
 select coalesce(jsonb_agg(value),'[]'::jsonb) into subjects from jsonb_array_elements(m#>'{intent,subjects}') where value->>'owner'='intl.workspace_context';
 b:=m->'review_baseline_ref';
 if jsonb_array_length(refs)=0 then return jsonb_array_length(subjects)=0 and coalesce(b->>'owner','')<>'intl.workspace_generation'; end if;
 if m->>'schema' is distinct from 'investigation_manifest.v3' or jsonb_array_length(subjects)<>1 then return false; end if;
 first_ref:=refs->0;s:=subjects->0;
 if not public.valid_investigation_intl_ref_v1(first_ref) or s->>'kind' is distinct from 'economy'
  or s->>'object_id' is distinct from first_ref->>'object_id'
  or (s ? 'version_ref' and s->>'version_ref' is distinct from first_ref->>'version_ref') then return false; end if;
 for r in select value from jsonb_array_elements(refs) loop
  if not public.valid_investigation_intl_ref_v1(r) or r->>'object_id' is distinct from first_ref->>'object_id'
   or r->>'version_ref' is distinct from first_ref->>'version_ref' or r->>'fingerprint' is distinct from first_ref->>'fingerprint'
   or seen @> jsonb_build_array(r#>'{selection,field}') then return false; end if;
  seen:=seen||jsonb_build_array(r#>'{selection,field}');
 end loop;
 if b->>'owner'='intl.workspace_generation' and (not public.valid_investigation_intl_ref_v1(b) or not refs @> jsonb_build_array(b)) then return false; end if;
 return true;
exception when others then return false;
end $$;

create or replace function public.valid_investigation_manifest_v2(m jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb; endpoint jsonb;
begin
 if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','argument_relations','continuation'],array['review_baseline_ref','review','option_plan','scenario_capture'])
 or m->>'schema' not in ('investigation_manifest.v2','investigation_manifest.v3') or octet_length(public.investigation_json_v2(m))>131072
 or not public.investigation_keys_v2(m->'intent',array['title','question','subjects'],array['horizon','research_as_of'])
 or not public.investigation_text_v2(m#>'{intent,title}',160,true)
 or not public.investigation_text_v2(m#>'{intent,question}',4000)
 or not public.investigation_keys_v2(m->'continuation','{}',array['next_question','next_observation']) then return false; end if;
 if m->'intent' ? 'horizon' and not public.investigation_text_v2(m#>'{intent,horizon}',64,true) then return false; end if;
 if m->'intent' ? 'research_as_of' then
   if jsonb_typeof(m#>'{intent,research_as_of}') is distinct from 'string' or (m#>>'{intent,research_as_of}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     or to_char((m#>>'{intent,research_as_of}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>m#>>'{intent,research_as_of}' then return false; end if;
 end if;
 foreach k in array array['next_question','next_observation'] loop
  if m->'continuation' ? k and not public.investigation_text_v2(m->'continuation'->k,4000) then return false; end if;
 end loop;
 if m ? 'review' then
  if jsonb_typeof(m->'review') is distinct from 'object'
   or not public.investigation_keys_v2(m->'review',array['assessment'],array['fire_event_id','note'])
   or (m#>>'{review,assessment}') not in ('confirmed','contradicted','inconclusive')
   or (m->'review' ? 'fire_event_id' and (jsonb_typeof(m#>'{review,fire_event_id}') is distinct from 'string' or (m#>>'{review,fire_event_id}') !~ '^[0-9a-f]{64}$'))
   or (m->'review' ? 'note' and not public.investigation_text_v2(m#>'{review,note}',2000)) then return false; end if;
 end if;
 if m ? 'option_plan' and (m->>'schema'<>'investigation_manifest.v3' or not public.valid_investigation_option_plan_v1(m->'option_plan')) then return false; end if;
 if m ? 'scenario_capture' and (m->>'schema'<>'investigation_manifest.v2' or not public.valid_investigation_scenario_reference_v1(m->'scenario_capture')) then return false; end if;
 if jsonb_typeof(m#>'{intent,subjects}') is distinct from 'array' or jsonb_array_length(m#>'{intent,subjects}')>16 then return false; end if;
 for r in select value from jsonb_array_elements(m#>'{intent,subjects}') loop
  if not public.investigation_keys_v2(r,array['kind','owner','object_id'],array['version_ref'])
   or not public.investigation_text_v2(r->'object_id',256,true)
   or not ((r->>'owner'='terminal.analysis_symbol' and r->>'kind'='security') or (r->>'owner'='data_os.security_master' and r->>'kind' in ('security','issuer')) or (r->>'owner'='intl.workspace_context' and r->>'kind'='economy'))
   or (r ? 'version_ref' and not public.investigation_text_v2(r->'version_ref',256,true)) then return false; end if;
  identity:=jsonb_build_array(r->'owner',r->'kind',r->'object_id',r->'version_ref');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
 end loop;
 n:=0;
 foreach k in array array['layout_refs','thesis_refs','evidence_refs'] loop
  if jsonb_typeof(m->k) is distinct from 'array' then return false; end if;
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
   or jsonb_typeof(r->'thesis_id') is distinct from 'string' or jsonb_typeof(r->'version_id') is distinct from 'string' or jsonb_typeof(r->'role') is distinct from 'string'
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
  if r->>'owner'='terminal.smart_screen' then
   if not public.valid_investigation_screen_ref_v2(r) then return false; end if;
  elsif not public.investigation_keys_v2(r,array['owner','object_type','object_id','mode'],array['version_ref','fingerprint','selection'])
  or not ((r->>'owner'='earnings.workspace_generation' and r->>'object_type'='event_workspace') or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement')) or (r->>'owner'='intl.workspace_generation' and r->>'object_type'='selected_generation'))
  or not public.investigation_text_v2(r->'object_id',256,true) or r->>'mode' not in ('pinned','follow_head')
  or (r->>'mode'='pinned' and not public.investigation_text_v2(r->'version_ref',256,true))
  or (r->>'mode'='follow_head' and (r ? 'version_ref' or r ? 'fingerprint'))
  or (r ? 'fingerprint' and (jsonb_typeof(r->'fingerprint') is distinct from 'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$'))
  or (r ? 'selection' and (not public.investigation_keys_v2(r->'selection',array['field']) or jsonb_typeof(r#>'{selection,field}') is distinct from 'string' or r#>>'{selection,field}' !~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if;
  n:=n+1;
  identity:=jsonb_build_array(r->'owner',r->'object_type',r->'object_id',r->'mode',r->'version_ref',r#>'{selection,field}');
  if n<=jsonb_array_length(m->'evidence_refs') then
   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
  end if;
 end loop;
 if jsonb_typeof(m->'argument_relations') is distinct from 'array' or jsonb_array_length(m->'argument_relations')>256 then return false; end if;
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
 return public.valid_investigation_intl_scope_v1(m);
exception when others then return false;
end $$;

-- Existing predicate OID/ACL stays intact; helpers are not new public RPCs.
revoke all on function public.valid_investigation_intl_ref_v1(jsonb),public.valid_investigation_intl_scope_v1(jsonb) from public,anon,authenticated;
commit;
