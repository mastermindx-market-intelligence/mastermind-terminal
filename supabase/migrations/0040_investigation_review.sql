-- Ledger row: 0040_investigation_review / PR #1104 (packet OPTIONS-R1-W3C); unapplied at authoring
-- Rollback: restore only valid_investigation_manifest_v2(jsonb) to the 0039 body (supabase/migrations/0039_investigation_options_evidence.sql), retaining IMMUTABLE, owner, ACL and search_path; the down block below is that exact 0039 body, collapsed to one line.
-- Options R1 W3C: admit the optional review block in the installed investigation manifest
-- validator. The Terminal validator (terminal/lib/investigationContracts.ts) now accepts an
-- optional top-level `review` object — required `assessment` in ('confirmed','contradicted',
-- 'inconclusive'), optional `fire_event_id` matching the 64-hex digest rule, optional `note`
-- of at most 2000 characters, no other keys — so a review recorded on a saved question can be
-- written as the next immutable revision through apply_investigation_revision_v2. This file
-- adds that single predicate in the same place the other optional-block checks live and leaves
-- every other line of the installed 0039 body untouched (the contract test
-- terminal/lib/__tests__/investigationReviewMigrationContract.test.ts pins the two to each
-- other). No table, constraint, grant, policy or row change; existing rows stay valid because
-- the predicate only widens. Signature, IMMUTABLE, owner, ACL and search_path are preserved.
-- Re-runnable source. Apply this file explicitly, never the entire migration directory.

create or replace function public.valid_investigation_manifest_v2(m jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'public'
as $function$
declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb;
begin
 if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','continuation'],array['review_baseline_ref','review'])
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
          or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement')))
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

-- down:
-- Restore only the installed 0039 body (the W3C review predicate is removed again; this refuses
-- a review-bearing manifest as invalid_payload. Rows already saved with a review block stay in
-- place because the check constraint is not re-evaluated for existing rows). Emergency rollback
-- only.
-- CREATE OR REPLACE FUNCTION public.valid_investigation_manifest_v2(m jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog', 'public' AS $function$ declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb; begin if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','continuation'],array['review_baseline_ref']) or m->>'schema'<>'investigation_manifest.v2' or octet_length(public.investigation_json_v2(m))>131072 or not public.investigation_keys_v2(m->'intent',array['title','question','subjects'],array['horizon','research_as_of']) or not public.investigation_text_v2(m#>'{intent,title}',160,true) or not public.investigation_text_v2(m#>'{intent,question}',4000) or not public.investigation_keys_v2(m->'continuation','{}',array['next_question','next_observation']) then return false; end if; if m->'intent' ? 'horizon' and not public.investigation_text_v2(m#>'{intent,horizon}',64,true) then return false; end if; if m->'intent' ? 'research_as_of' then if jsonb_typeof(m#>'{intent,research_as_of}')<>'string' or (m#>>'{intent,research_as_of}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char((m#>>'{intent,research_as_of}')::date,'YYYY-MM-DD')<>m#>>'{intent,research_as_of}' then return false; end if; end if; foreach k in array array['next_question','next_observation'] loop if m->'continuation' ? k and not public.investigation_text_v2(m->'continuation'->k,4000) then return false; end if; end loop; if jsonb_typeof(m#>'{intent,subjects}')<>'array' or jsonb_array_length(m#>'{intent,subjects}')>16 then return false; end if; for r in select value from jsonb_array_elements(m#>'{intent,subjects}') loop if not public.investigation_keys_v2(r,array['kind','owner','object_id'],array['version_ref']) or not public.investigation_text_v2(r->'object_id',256,true) or not ((r->>'owner'='terminal.analysis_symbol' and r->>'kind'='security') or (r->>'owner'='data_os.security_master' and r->>'kind' in ('security','issuer'))) or (r ? 'version_ref' and not public.investigation_text_v2(r->'version_ref',256,true)) then return false; end if; identity:=jsonb_build_array(r->'owner',r->'kind',r->'object_id',r->'version_ref'); if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity); end loop; n:=0; foreach k in array array['layout_refs','thesis_refs','evidence_refs'] loop if jsonb_typeof(m->k)<>'array' then return false; end if; n:=n+jsonb_array_length(m->k); end loop; if n>128 or jsonb_array_length(m->'layout_refs')>4 or jsonb_array_length(m->'thesis_refs')>16 then return false; end if; seen:='[]'; for r in select value from jsonb_array_elements(m->'layout_refs') loop if not public.investigation_keys_v2(r,array['layout_id','layout_revision_id','digest','role']) or (r->>'layout_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or (r->>'layout_revision_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or (r->>'digest') !~ '^[0-9a-f]{64}$' or r->>'role' not in ('primary','supporting') then return false; end if; identity:=jsonb_build_array(r->'layout_id',r->'layout_revision_id'); if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity); end loop; seen:='[]'; for r in select value from jsonb_array_elements(m->'thesis_refs') loop if not public.investigation_keys_v2(r,array['thesis_id','version_id','role']) or jsonb_typeof(r->'thesis_id')<>'string' or jsonb_typeof(r->'version_id')<>'string' or jsonb_typeof(r->'role')<>'string' or (r->>'thesis_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or (r->>'version_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or r->>'role' not in ('primary','alternative','context') then return false; end if; identity:=jsonb_build_array(r->'thesis_id',r->'version_id'); if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity); end loop; refs:=m->'evidence_refs'; if m ? 'review_baseline_ref' then if m#>>'{review_baseline_ref,mode}' is distinct from 'pinned' then return false; end if; refs:=refs||jsonb_build_array(m->'review_baseline_ref'); end if; seen:='[]'; n:=0; for r in select value from jsonb_array_elements(refs) loop if not public.investigation_keys_v2(r,array['owner','object_type','object_id','mode'],array['version_ref','fingerprint','selection']) or not ((r->>'owner'='earnings.workspace_generation' and r->>'object_type'='event_workspace') or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement'))) or not public.investigation_text_v2(r->'object_id',256,true) or r->>'mode' not in ('pinned','follow_head') or (r->>'mode'='pinned' and not public.investigation_text_v2(r->'version_ref',256,true)) or (r->>'mode'='follow_head' and (r ? 'version_ref' or r ? 'fingerprint')) or (r ? 'fingerprint' and (jsonb_typeof(r->'fingerprint')<>'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$')) or (r ? 'selection' and (not public.investigation_keys_v2(r->'selection',array['field']) or jsonb_typeof(r#>'{selection,field}')<>'string' or r#>>'{selection,field}' !~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if; n:=n+1; identity:=jsonb_build_array(r->'owner',r->'object_type',r->'object_id',r->'mode',r->'version_ref',r#>'{selection,field}'); if n<=jsonb_array_length(m->'evidence_refs') then if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity); end if; end loop; return true; exception when others then return false; end $function$;

-- readback:
-- with sample as (
--   select jsonb_build_object('schema','investigation_manifest.v2',
--     'intent',jsonb_build_object('title','NVDA · 230 wall','question','Did NVDA reach the 230 wall before the rotation faded?','subjects','[]'::jsonb),
--     'layout_refs','[]'::jsonb,'thesis_refs','[]'::jsonb,'evidence_refs','[]'::jsonb,'continuation','{}'::jsonb,
--     'review',jsonb_build_object('assessment','inconclusive','fire_event_id',repeat('a',64),'note','the wall held through the session')) as m)
-- select public.valid_investigation_manifest_v2(m) as admits_valid_review,
--        public.valid_investigation_manifest_v2(jsonb_set(m,'{review,assessment}','"maybe"',true)) as rejects_invalid_assessment,
--        public.valid_investigation_manifest_v2(jsonb_set(m,'{review,fire_event_id}',to_jsonb(repeat('g',64)),true)) as rejects_malformed_fire_event_id
-- from sample;
-- select p.proname as name, 'function'::text as object_kind,
--        n.nspname as object_schema,
--        pg_get_function_identity_arguments(p.oid) as identity_arguments,
--        pg_get_function_result(p.oid) as result_type,
--        l.lanname as language_name, pg_get_userbyid(p.proowner) as owner_name,
--        p.provolatile as volatility, p.prosecdef as security_definer,
--        p.proconfig as configuration, p.proacl::text as acl,
--        md5(p.prosrc) as body_md5
-- from pg_proc p
-- join pg_namespace n on n.oid=p.pronamespace
-- join pg_language l on l.oid=p.prolang
-- where p.oid=to_regprocedure('public.valid_investigation_manifest_v2(jsonb)');
