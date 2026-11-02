-- Ledger row: 0047_investigation_options_selection_evidence / PR #1222 (packet OPT006-V3-SAVE-ADMISSION); unapplied at authoring
-- Rollback: restore only valid_investigation_manifest_v2(jsonb) to the installed 0042 body (evidence owner allow-list terminal.options_exposure / exposure_chart_request, sector_origin, rotation_measurement); drop function public.investigation_evidence_admitted_v2(text,text)
-- Requires: the 0042 validator body installed first (the guard below refuses otherwise). Until this file is applied, every save carrying object_type options_matrix_selection answers invalid_payload (0039 pattern).
-- Apply this file explicitly, never the entire migration directory.
-- What this file installs (source only, UNAPPLIED): the valid_investigation_manifest_v2
-- evidence allow-list widened by exactly one object_type, options_matrix_selection, under the
-- existing owner terminal.options_exposure (every other byte the installed 0042 body, which the
-- leading guard requires), and one boolean admission probe
-- public.investigation_evidence_admitted_v2(owner, object_type) that re-evaluates the installed
-- validator on a minimal manifest. It never creates or alters a table, policy or row; it adds
-- no retention, no entitlement and no source read, computes no result, and grants only the probe.

do $$
begin
  if position('valid_investigation_scenario_reference_v1' in pg_catalog.pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure)) = 0 then
    raise exception '0047 requires the 0042 valid_investigation_manifest_v2 body (marker valid_investigation_scenario_reference_v1 absent)';
  end if;
end $$;

create or replace function public.valid_investigation_manifest_v2(m jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'public'
as $function$
declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb;
begin
 if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','continuation'],array['review_baseline_ref','review','scenario_capture'])
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
 if m ? 'review' then
  if jsonb_typeof(m->'review')<>'object'
   or not public.investigation_keys_v2(m->'review',array['assessment'],array['fire_event_id','note'])
   or (m#>>'{review,assessment}') not in ('confirmed','contradicted','inconclusive')
   or (m->'review' ? 'fire_event_id' and (jsonb_typeof(m#>'{review,fire_event_id}')<>'string' or (m#>>'{review,fire_event_id}') !~ '^[0-9a-f]{64}$'))
   or (m->'review' ? 'note' and not public.investigation_text_v2(m#>'{review,note}',2000)) then return false; end if;
 end if;
 -- Only a v2 manifest may carry the typed scenario reference, and only when the pure
 -- reference validator admits it (the Terminal/Python pairing pins the same rule). The
 -- reference is unresolved input metadata: this proves structure only -- never retention,
 -- private destination, entitlement, current action authority or source availability -- and
 -- no path in this file retrieves protected source bytes or computes any result.
 if m ? 'scenario_capture' then
  if m->>'schema'<>'investigation_manifest.v2' or not public.valid_investigation_scenario_reference_v1(m->'scenario_capture') then return false; end if;
 end if;
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
  or not ((r->>'owner'='earnings.workspace_generation' and r->>'object_type'='event_workspace')
          or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement','options_matrix_selection')))
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
end $function$;

create or replace function public.investigation_evidence_admitted_v2(owner text, object_type text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $$
select public.valid_investigation_manifest_v2(
  pg_catalog.jsonb_build_object(
   'schema','investigation_manifest.v2',
   'intent',pg_catalog.jsonb_build_object('title','XLK gamma at 450','question','Does the matched change hold?','subjects',pg_catalog.jsonb_build_array()),
   'layout_refs',pg_catalog.jsonb_build_array(),
   'thesis_refs',pg_catalog.jsonb_build_array(),
   'evidence_refs',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'owner',$1,'object_type',$2,'object_id','XLK/2026-10-16/450/gamma/one:2026-10-17',
    'mode','pinned',
    'version_ref','exposure_chart_request.v1:7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6',
    'fingerprint','7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6')),
   'continuation',pg_catalog.jsonb_build_object()))
$$;

revoke all on function public.investigation_evidence_admitted_v2(text,text) from public, anon;
grant execute on function public.investigation_evidence_admitted_v2(text,text) to authenticated;

-- down:
-- Restore only the installed 0042 body (the live validator above minus the one widening) and
-- drop the probe. This refuses options_matrix_selection again; rows already saved with that
-- owner stay in place because no stored manifest is re-validated on read. Emergency rollback only.
-- create or replace function public.valid_investigation_manifest_v2(m jsonb)
--  returns boolean
--  language plpgsql
--  immutable
--  set search_path to 'pg_catalog', 'public'
-- as $function$
-- declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb;
-- begin
--  if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','continuation'],array['review_baseline_ref','review','scenario_capture'])
--  or m->>'schema'<>'investigation_manifest.v2' or octet_length(public.investigation_json_v2(m))>131072
--  or not public.investigation_keys_v2(m->'intent',array['title','question','subjects'],array['horizon','research_as_of'])
--  or not public.investigation_text_v2(m#>'{intent,title}',160,true)
--  or not public.investigation_text_v2(m#>'{intent,question}',4000)
--  or not public.investigation_keys_v2(m->'continuation','{}',array['next_question','next_observation']) then return false; end if;
--  if m->'intent' ? 'horizon' and not public.investigation_text_v2(m#>'{intent,horizon}',64,true) then return false; end if;
--  if m->'intent' ? 'research_as_of' then
--    if jsonb_typeof(m#>'{intent,research_as_of}')<>'string' or (m#>>'{intent,research_as_of}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
--      or to_char((m#>>'{intent,research_as_of}')::date,'YYYY-MM-DD')<>m#>>'{intent,research_as_of}' then return false; end if;
--  end if;
--  foreach k in array array['next_question','next_observation'] loop
--   if m->'continuation' ? k and not public.investigation_text_v2(m->'continuation'->k,4000) then return false; end if;
--  end loop;
--  if m ? 'review' then
--   if jsonb_typeof(m->'review')<>'object'
--    or not public.investigation_keys_v2(m->'review',array['assessment'],array['fire_event_id','note'])
--    or (m#>>'{review,assessment}') not in ('confirmed','contradicted','inconclusive')
--    or (m->'review' ? 'fire_event_id' and (jsonb_typeof(m#>'{review,fire_event_id}')<>'string' or (m#>>'{review,fire_event_id}') !~ '^[0-9a-f]{64}$'))
--    or (m->'review' ? 'note' and not public.investigation_text_v2(m#>'{review,note}',2000)) then return false; end if;
--  end if;
--  -- Only a v2 manifest may carry the typed scenario reference, and only when the pure
--  -- reference validator admits it (the Terminal/Python pairing pins the same rule). The
--  -- reference is unresolved input metadata: this proves structure only -- never retention,
--  -- private destination, entitlement, current action authority or source availability -- and
--  -- no path in this file retrieves protected source bytes or computes any result.
--  if m ? 'scenario_capture' then
--   if m->>'schema'<>'investigation_manifest.v2' or not public.valid_investigation_scenario_reference_v1(m->'scenario_capture') then return false; end if;
--  end if;
--  if jsonb_typeof(m#>'{intent,subjects}')<>'array' or jsonb_array_length(m#>'{intent,subjects}')>16 then return false; end if;
--  for r in select value from jsonb_array_elements(m#>'{intent,subjects}') loop
--   if not public.investigation_keys_v2(r,array['kind','owner','object_id'],array['version_ref'])
--    or not public.investigation_text_v2(r->'object_id',256,true)
--    or not ((r->>'owner'='terminal.analysis_symbol' and r->>'kind'='security') or (r->>'owner'='data_os.security_master' and r->>'kind' in ('security','issuer')))
--    or (r ? 'version_ref' and not public.investigation_text_v2(r->'version_ref',256,true)) then return false; end if;
--   identity:=jsonb_build_array(r->'owner',r->'kind',r->'object_id',r->'version_ref');
--   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
--  end loop;
--  n:=0;
--  foreach k in array array['layout_refs','thesis_refs','evidence_refs'] loop
--   if jsonb_typeof(m->k)<>'array' then return false; end if;
--   n:=n+jsonb_array_length(m->k);
--  end loop;
--  if n>128 or jsonb_array_length(m->'layout_refs')>4 or jsonb_array_length(m->'thesis_refs')>16 then return false; end if;
--  seen:='[]';
--  for r in select value from jsonb_array_elements(m->'layout_refs') loop
--   if not public.investigation_keys_v2(r,array['layout_id','layout_revision_id','digest','role'])
--   or (r->>'layout_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
--   or (r->>'layout_revision_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
--   or (r->>'digest') !~ '^[0-9a-f]{64}$' or r->>'role' not in ('primary','supporting') then return false; end if;
--   identity:=jsonb_build_array(r->'layout_id',r->'layout_revision_id');
--   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
--  end loop;
--  -- Only canonical, immutable Thesis version references belong in this manifest.
--  seen:='[]';
--  for r in select value from jsonb_array_elements(m->'thesis_refs') loop
--   if not public.investigation_keys_v2(r,array['thesis_id','version_id','role'])
--    or jsonb_typeof(r->'thesis_id')<>'string' or jsonb_typeof(r->'version_id')<>'string' or jsonb_typeof(r->'role')<>'string'
--    or (r->>'thesis_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
--    or (r->>'version_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
--    or r->>'role' not in ('primary','alternative','context') then return false; end if;
--   identity:=jsonb_build_array(r->'thesis_id',r->'version_id');
--   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if;
--   seen:=seen||jsonb_build_array(identity);
--  end loop;
--  refs:=m->'evidence_refs';
--  if m ? 'review_baseline_ref' then
--   if m#>>'{review_baseline_ref,mode}' is distinct from 'pinned' then return false; end if;
--   refs:=refs||jsonb_build_array(m->'review_baseline_ref');
--  end if;
--  seen:='[]';
--  n:=0;
--  for r in select value from jsonb_array_elements(refs) loop
--   if not public.investigation_keys_v2(r,array['owner','object_type','object_id','mode'],array['version_ref','fingerprint','selection'])
--   or not ((r->>'owner'='earnings.workspace_generation' and r->>'object_type'='event_workspace')
--           or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement')))
--   or not public.investigation_text_v2(r->'object_id',256,true) or r->>'mode' not in ('pinned','follow_head')
--   or (r->>'mode'='pinned' and not public.investigation_text_v2(r->'version_ref',256,true))
--   or (r->>'mode'='follow_head' and (r ? 'version_ref' or r ? 'fingerprint'))
--   or (r ? 'fingerprint' and (jsonb_typeof(r->'fingerprint')<>'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$'))
--   or (r ? 'selection' and (not public.investigation_keys_v2(r->'selection',array['field']) or jsonb_typeof(r#>'{selection,field}')<>'string' or r#>>'{selection,field}' !~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if;
--   n:=n+1;
--   identity:=jsonb_build_array(r->'owner',r->'object_type',r->'object_id',r->'mode',r->'version_ref',r#>'{selection,field}');
--   if n<=jsonb_array_length(m->'evidence_refs') then
--    if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
--   end if;
--  end loop;
--  return true;
-- exception when others then return false;
-- end $function$;
-- drop function if exists public.investigation_evidence_admitted_v2(text,text);

-- readback:
-- (i) the widening is installed (migration role):
-- select position('''options_matrix_selection''' in pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::regprocedure))>0 as admits_options_matrix_selection;
-- (ii) the functional validator probe on a minimal manifest carrying one options_matrix_selection ref (0040-readback style, migration role):
-- with sample as (
--   select jsonb_build_object('schema','investigation_manifest.v2',
--     'intent',jsonb_build_object('title','XLK gamma at 450','question','Does the matched change hold?','subjects','[]'::jsonb),
--     'layout_refs','[]'::jsonb,'thesis_refs','[]'::jsonb,
--     'evidence_refs',jsonb_build_array(jsonb_build_object('owner','terminal.options_exposure','object_type','options_matrix_selection',
--       'object_id','XLK/2026-10-16/450/gamma/one:2026-10-17','mode','pinned',
--       'version_ref','exposure_chart_request.v1:7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6',
--       'fingerprint','7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6')),
--     'continuation','{}'::jsonb) as m)
-- select public.valid_investigation_manifest_v2(m) as admits_options_matrix_selection_manifest,
--        public.valid_investigation_manifest_v2(jsonb_set(m,'{evidence_refs,0,object_type}','"dealer_inventory"',true)) as refuses_dealer_inventory
-- from sample;
-- (iii) the probe, positive, run as authenticated:
-- select public.investigation_evidence_admitted_v2('terminal.options_exposure','options_matrix_selection') as admitted; -- expected true (run as authenticated)
-- (iv) the probe, the falsifier that can fail, run as authenticated:
-- select public.investigation_evidence_admitted_v2('terminal.options_exposure','dealer_inventory') as admitted; -- expected false (run as authenticated; the falsifier)
