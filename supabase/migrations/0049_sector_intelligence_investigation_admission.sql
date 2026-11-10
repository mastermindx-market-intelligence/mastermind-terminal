-- Ledger row: 0049_sector_intelligence_investigation_admission / PR #1410 (open, packet SI-P16-LANE6-INVESTIGATION-ADMISSION); not applied
-- Rollback: restore only valid_investigation_manifest_v2(jsonb) to the exact 0047 body (markers valid_investigation_scenario_reference_v1 + options_matrix_selection, md5 pin), restore investigation_evidence_admitted_v2(text,text) to the 0047 probe body (Options-shaped minimal example), and drop public.investigation_subject_admitted_v2(text,text)
-- Requires the exact 0047 body installed (md5 pin below); it refuses the installed 0040 body, the 0042 body and any 0043/unknown shape -- recompose over a different preimage only in a new prefix. On the installed production ledger (0040 applied; 0042 and 0047 merged but UNAPPLIED) the operator sequence is: apply 0042, then 0047, then this file, each explicitly.
-- Apply this file explicitly, never the entire migration directory. No installed database state was read in this planning round.
-- This file defines functions with dollar-quoted bodies containing semicolons (the 0006-style
-- warning restated by 0014, 0021 and 0041): do NOT push it through the naive
-- split-on-semicolon Management API endpoint.
-- What this file installs (source only, UNAPPLIED): the valid_investigation_manifest_v2
-- subject allow-list widened by the Sector Intelligence owner/kind pairs (macro.sector/sector
-- on the exact captured 11-sector native cohort; theme_graph.identity theme/basket/company on
-- their owner-resolved id grammars) and the evidence allow-list widened by macro.sector
-- sector_observation/basket_observation and theme_graph.curation_assertion curation_assertion,
-- all pinned-only with required version_ref+fingerprint and no selection; plus one boolean
-- evidence-admission probe rebuilt with a valid minimal example per new type and one narrow
-- boolean subject-admission probe, both granted to authenticated only. It never creates or
-- alters a table, policy or row; it adds no retention, entitlement or source read, computes no
-- result, and changes no existing Options/review/scenario validation, RLS/ACL or search_path.
begin;

do $$
declare observed text;
begin
  select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure;
  if position('valid_investigation_scenario_reference_v1' in pg_catalog.pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure)) = 0
     or position('options_matrix_selection' in pg_catalog.pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure)) = 0
     or observed is null or observed not in ('a554c15c1ae58dfbd34d04bcda9b5e48', '75f2b7feba6b3c9f177f4cda6c3605e9') then
    raise exception '0049 requires the exact 0047 valid_investigation_manifest_v2 body (markers valid_investigation_scenario_reference_v1 and options_matrix_selection, md5 pin); observed md5 %', observed;
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
   or not ((r->>'owner'='terminal.analysis_symbol' and r->>'kind'='security') or (r->>'owner'='data_os.security_master' and r->>'kind' in ('security','issuer'))
           -- Sector Intelligence admission (packet 3.2): exact owner-resolved ids only.
           -- A macro.sector subject is the admitted native cohort id, never a ticker/name
           -- guess; theme_graph.identity ids keep their owner grammar and are never
           -- reinterpreted as security/issuer (sector:financials and native xlf stay
           -- distinct owners joined only by an explicit versioned owner crosswalk).
           or (r->>'owner'='macro.sector' and r->>'kind'='sector' and (r->>'object_id') in ('xlb','xlk','xlc','xly','xlf','xli','xle','xlv','xlp','xlu','xlre'))
           or (r->>'owner'='theme_graph.identity' and r->>'kind'='theme' and (r->>'object_id') ~ '^theme:[a-z0-9][a-z0-9_]{1,62}$')
           or (r->>'owner'='theme_graph.identity' and r->>'kind'='basket' and (r->>'object_id') ~ '^basket:(baskets|baskets_china|baskets_china_ths|baskets_hk|baskets_canada|baskets_intl):[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$')
           or (r->>'owner'='theme_graph.identity' and r->>'kind'='company' and (r->>'object_id') ~ '^co:(us|cn|hk|ca|intl):[A-Za-z0-9.-]+(#[0-9]+)?$'))
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
          or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement','options_matrix_selection'))
          or (r->>'owner'='macro.sector' and r->>'object_type' in ('sector_observation','basket_observation'))
          or (r->>'owner'='theme_graph.curation_assertion' and r->>'object_type'='curation_assertion'))
  or not public.investigation_text_v2(r->'object_id',256,true) or r->>'mode' not in ('pinned','follow_head')
  or (r->>'mode'='pinned' and not public.investigation_text_v2(r->'version_ref',256,true))
  or (r->>'mode'='follow_head' and (r ? 'version_ref' or r ? 'fingerprint'))
  or (r ? 'fingerprint' and (jsonb_typeof(r->'fingerprint')<>'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$'))
  or (r ? 'selection' and (not public.investigation_keys_v2(r->'selection',array['field']) or jsonb_typeof(r#>'{selection,field}')<>'string' or r#>>'{selection,field}' !~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if;
  -- Sector Intelligence evidence (packet 3.2) is pinned-only: version_ref AND
  -- fingerprint are both required, selection stays omitted until a closed per-type
  -- selector vocabulary exists, and each type pins its owner-resolved identity
  -- grammar (generation token, basket projection id, curation evidence/revision).
  -- No JSON state hides in title, horizon, selection.field or object_id.
  if r->>'owner'='macro.sector' and r->>'object_type' in ('sector_observation','basket_observation') then
   if r->>'mode'<>'pinned' or not (r ? 'fingerprint') or (r ? 'selection')
    or (r->>'object_type'='sector_observation' and (r->>'object_id') not in ('xlb','xlk','xlc','xly','xlf','xli','xle','xlv','xlp','xlu','xlre'))
    or (r->>'object_type'='basket_observation' and (r->>'object_id') !~ '^b-[a-zA-Z0-9_-]{1,100}$')
    or (r->>'version_ref') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' then return false; end if;
  end if;
  if r->>'owner'='theme_graph.curation_assertion' and r->>'object_type'='curation_assertion' then
   if r->>'mode'<>'pinned' or not (r ? 'fingerprint') or (r ? 'selection')
    or (r->>'object_id') !~ '^ev:[0-9a-f]{16}$'
    or (r->>'version_ref') !~ '^gmirca_[0-9a-f]{32}$' then return false; end if;
  end if;
  n:=n+1;
  identity:=jsonb_build_array(r->'owner',r->'object_type',r->'object_id',r->'mode',r->'version_ref',r#>'{selection,field}');
  if n<=jsonb_array_length(m->'evidence_refs') then
   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
  end if;
 end loop;
 return true;
exception when others then return false;
end $function$;

-- This placeholder ref must satisfy every per-type rule in valid_investigation_manifest_v2; a migration that adds one must re-run readback (iii).
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
    'owner',$1,'object_type',$2,
    'object_id',case when
      $1='macro.sector' and $2='sector_observation' then 'xlf'
      when $1='macro.sector' and $2='basket_observation' then 'b-us_defensives'
      when $1='theme_graph.curation_assertion' and $2='curation_assertion' then 'ev:0123456789abcdef'
      else 'XLK/2026-10-16/450/gamma/one:2026-10-17' end),
    'mode','pinned',
    'version_ref',case when
      $1='theme_graph.curation_assertion' and $2='curation_assertion' then 'gmirca_0123456789abcdef0123456789abcdef'
      when $1='macro.sector' and $2 in ('sector_observation','basket_observation') then 'captured-sector-1'
      else 'exposure_chart_request.v1:7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6' end),
    'fingerprint','7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6')),
   'continuation',pg_catalog.jsonb_build_object()))
$$;
create or replace function public.investigation_subject_admitted_v2(owner text, kind text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $$
select public.valid_investigation_manifest_v2(
  pg_catalog.jsonb_build_object(
   'schema','investigation_manifest.v2',
   'intent',pg_catalog.jsonb_build_object('title','Subject admission','question','Is the owner-resolved subject admitted?','subjects',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'kind',$2,'owner',$1,
    'object_id',case when
      $1='macro.sector' and $2='sector' then 'xlf'
      when $1='theme_graph.identity' and $2='theme' then 'theme:ai_supply_chain'
      when $1='theme_graph.identity' and $2='basket' then 'basket:baskets:nuclear_power'
      when $1='theme_graph.identity' and $2='company' then 'co:us:AAPL'
      when $1='terminal.analysis_symbol' and $2='security' then 'AAPL'
      when $1='data_os.security_master' and $2='security' then 'AAPL'
      when $1='data_os.security_master' and $2='issuer' then 'AAPL'
      else 'xlf' end))),
   'layout_refs',pg_catalog.jsonb_build_array(),
   'thesis_refs',pg_catalog.jsonb_build_array(),
   'evidence_refs',pg_catalog.jsonb_build_array(),
   'continuation',pg_catalog.jsonb_build_object()))
$$;
revoke all on function public.investigation_evidence_admitted_v2(text,text) from public, anon;
grant execute on function public.investigation_evidence_admitted_v2(text,text) to authenticated;
revoke all on function public.investigation_subject_admitted_v2(text,text) from public, anon;
grant execute on function public.investigation_subject_admitted_v2(text,text) to authenticated;

do $$ begin
  revoke all on function public.investigation_evidence_admitted_v2(text,text)
    from service_role;
exception when undefined_object then null; end $$;
do $$ begin
  revoke all on function public.investigation_subject_admitted_v2(text,text)
    from service_role;
exception when undefined_object then null; end $$;

commit;

-- down:
-- -- Emergency rollback only: one transaction that refuses unless the installed body is the 0049 body, restores the exact 0047 validator body and the exact 0047 evidence probe, and drops the subject probe. Strip exactly one leading comment marker from every line of this block and apply it as ONE request.
-- begin;
-- do $$ declare observed text; begin select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure; if observed is distinct from '75f2b7feba6b3c9f177f4cda6c3605e9' then raise exception '0049 down requires the 0049 body; observed md5 %', observed; end if; end $$;
-- do $down$ begin execute E'create or replace function public.valid_investigation_manifest_v2(m jsonb)\n returns boolean\n language plpgsql\n immutable\n set search_path to ''pg_catalog'', ''public''\nas $function$\ndeclare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:=''[]''; identity jsonb;\nbegin\n if not public.investigation_keys_v2(m,array[''schema'',''intent'',''layout_refs'',''thesis_refs'',''evidence_refs'',''continuation''],array[''review_baseline_ref'',''review'',''scenario_capture''])\n or m->>''schema''<>''investigation_manifest.v2'' or octet_length(public.investigation_json_v2(m))>131072\n or not public.investigation_keys_v2(m->''intent'',array[''title'',''question'',''subjects''],array[''horizon'',''research_as_of''])\n or not public.investigation_text_v2(m#>''{intent,title}'',160,true)\n or not public.investigation_text_v2(m#>''{intent,question}'',4000)\n or not public.investigation_keys_v2(m->''continuation'',''{}'',array[''next_question'',''next_observation'']) then return false; end if;\n if m->''intent'' ? ''horizon'' and not public.investigation_text_v2(m#>''{intent,horizon}'',64,true) then return false; end if;\n if m->''intent'' ? ''research_as_of'' then\n   if jsonb_typeof(m#>''{intent,research_as_of}'')<>''string'' or (m#>>''{intent,research_as_of}'') !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''\n     or to_char((m#>>''{intent,research_as_of}'')::date,''YYYY-MM-DD'')<>m#>>''{intent,research_as_of}'' then return false; end if;\n end if;\n foreach k in array array[''next_question'',''next_observation''] loop\n  if m->''continuation'' ? k and not public.investigation_text_v2(m->''continuation''->k,4000) then return false; end if;\n end loop;\n if m ? ''review'' then\n  if jsonb_typeof(m->''review'')<>''object''\n   or not public.investigation_keys_v2(m->''review'',array[''assessment''],array[''fire_event_id'',''note''])\n   or (m#>>''{review,assessment}'') not in (''confirmed'',''contradicted'',''inconclusive'')\n   or (m->''review'' ? ''fire_event_id'' and (jsonb_typeof(m#>''{review,fire_event_id}'')<>''string'' or (m#>>''{review,fire_event_id}'') !~ ''^[0-9a-f]{64}$''))\n   or (m->''review'' ? ''note'' and not public.investigation_text_v2(m#>''{review,note}'',2000)) then return false; end if;\n end if;\n -- Only a v2 manifest may carry the typed scenario reference, and only when the pure\n -- reference validator admits it (the Terminal/Python pairing pins the same rule). The\n -- reference is unresolved input metadata: this proves structure only -- never retention,\n -- private destination, entitlement, current action authority or source availability -- and\n -- no path in this file retrieves protected source bytes or computes any result.\n if m ? ''scenario_capture'' then\n  if m->>''schema''<>''investigation_manifest.v2'' or not public.valid_investigation_scenario_reference_v1(m->''scenario_capture'') then return false; end if;\n end if;\n if jsonb_typeof(m#>''{intent,subjects}'')<>''array'' or jsonb_array_length(m#>''{intent,subjects}'')>16 then return false; end if;\n for r in select value from jsonb_array_elements(m#>''{intent,subjects}'') loop\n  if not public.investigation_keys_v2(r,array[''kind'',''owner'',''object_id''],array[''version_ref''])\n   or not public.investigation_text_v2(r->''object_id'',256,true)\n   or not ((r->>''owner''=''terminal.analysis_symbol'' and r->>''kind''=''security'') or (r->>''owner''=''data_os.security_master'' and r->>''kind'' in (''security'',''issuer'')))\n   or (r ? ''version_ref'' and not public.investigation_text_v2(r->''version_ref'',256,true)) then return false; end if;\n  identity:=jsonb_build_array(r->''owner'',r->''kind'',r->''object_id'',r->''version_ref'');\n  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);\n end loop;\n n:=0;\n foreach k in array array[''layout_refs'',''thesis_refs'',''evidence_refs''] loop\n  if jsonb_typeof(m->k)<>''array'' then return false; end if;\n  n:=n+jsonb_array_length(m->k);\n end loop;\n if n>128 or jsonb_array_length(m->''layout_refs'')>4 or jsonb_array_length(m->''thesis_refs'')>16 then return false; end if;\n seen:=''[]'';\n for r in select value from jsonb_array_elements(m->''layout_refs'') loop\n  if not public.investigation_keys_v2(r,array[''layout_id'',''layout_revision_id'',''digest'',''role''])\n  or (r->>''layout_id'') !~ ''^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$''\n  or (r->>''layout_revision_id'') !~ ''^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$''\n  or (r->>''digest'') !~ ''^[0-9a-f]{64}$'' or r->>''role'' not in (''primary'',''supporting'') then return false; end if;\n  identity:=jsonb_build_array(r->''layout_id'',r->''layout_revision_id'');\n  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);\n end loop;\n -- Only canonical, immutable Thesis version references belong in this manifest.\n seen:=''[]'';\n for r in select value from jsonb_array_elements(m->''thesis_refs'') loop\n  if not public.investigation_keys_v2(r,array[''thesis_id'',''version_id'',''role''])\n   or jsonb_typeof(r->''thesis_id'')<>''string'' or jsonb_typeof(r->''version_id'')<>''string'' or jsonb_typeof(r->''role'')<>''string''\n   or (r->>''thesis_id'') !~ ''^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$''\n   or (r->>''version_id'') !~ ''^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$''\n   or r->>''role'' not in (''primary'',''alternative'',''context'') then return false; end if;\n  identity:=jsonb_build_array(r->''thesis_id'',r->''version_id'');\n  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if;\n  seen:=seen||jsonb_build_array(identity);\n end loop;\n refs:=m->''evidence_refs'';\n if m ? ''review_baseline_ref'' then\n  if m#>>''{review_baseline_ref,mode}'' is distinct from ''pinned'' then return false; end if;\n  refs:=refs||jsonb_build_array(m->''review_baseline_ref'');\n end if;\n seen:=''[]'';\n n:=0;\n for r in select value from jsonb_array_elements(refs) loop\n  if not public.investigation_keys_v2(r,array[''owner'',''object_type'',''object_id'',''mode''],array[''version_ref'',''fingerprint'',''selection''])\n  or not ((r->>''owner''=''earnings.workspace_generation'' and r->>''object_type''=''event_workspace'')\n          or (r->>''owner''=''terminal.options_exposure'' and r->>''object_type'' in (''exposure_chart_request'',''sector_origin'',''rotation_measurement'',''options_matrix_selection'')))\n  or not public.investigation_text_v2(r->''object_id'',256,true) or r->>''mode'' not in (''pinned'',''follow_head'')\n  or (r->>''mode''=''pinned'' and not public.investigation_text_v2(r->''version_ref'',256,true))\n  or (r->>''mode''=''follow_head'' and (r ? ''version_ref'' or r ? ''fingerprint''))\n  or (r ? ''fingerprint'' and (jsonb_typeof(r->''fingerprint'')<>''string'' or r->>''fingerprint'' !~ ''^[0-9a-f]{64}$''))\n  or (r ? ''selection'' and (not public.investigation_keys_v2(r->''selection'',array[''field'']) or jsonb_typeof(r#>''{selection,field}'')<>''string'' or r#>>''{selection,field}'' !~ ''^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$'')) then return false; end if;\n  n:=n+1;\n  identity:=jsonb_build_array(r->''owner'',r->''object_type'',r->''object_id'',r->''mode'',r->''version_ref'',r#>''{selection,field}'');\n  if n<=jsonb_array_length(m->''evidence_refs'') then\n   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);\n  end if;\n end loop;\n return true;\nexception when others then return false;\nend $function$;'; end $down$;
-- do $down$ begin execute E'create or replace function public.investigation_evidence_admitted_v2(owner text, object_type text)\n returns boolean\n language sql\n stable\n security definer\n set search_path = ''''\nas $$\nselect public.valid_investigation_manifest_v2(\n  pg_catalog.jsonb_build_object(\n   ''schema'',''investigation_manifest.v2'',\n   ''intent'',pg_catalog.jsonb_build_object(''title'',''XLK gamma at 450'',''question'',''Does the matched change hold?'',''subjects'',pg_catalog.jsonb_build_array()),\n   ''layout_refs'',pg_catalog.jsonb_build_array(),\n   ''thesis_refs'',pg_catalog.jsonb_build_array(),\n   ''evidence_refs'',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(\n    ''owner'',$1,''object_type'',$2,''object_id'',''XLK/2026-10-16/450/gamma/one:2026-10-17'',\n    ''mode'',''pinned'',\n    ''version_ref'',''exposure_chart_request.v1:7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6'',\n    ''fingerprint'',''7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6'')),\n   ''continuation'',pg_catalog.jsonb_build_object()))\n$$;'; end $down$;
-- drop function if exists public.investigation_subject_admitted_v2(text,text);
-- commit;

-- readback:
-- (i) the widening is installed (migration role):
-- select position('sector_observation' in pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::regprocedure))>0 as admits_sector_evidence,
--        position('macro.sector' in pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::regprocedure))>0 as admits_sector_subjects,
--        position('gmirca_' in pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::regprocedure))>0 as admits_curation_grammar;
-- (ii) the functional validator on the packet 3.2 command-template manifest (0040-readback style, migration role):
-- with sample as (
--   select jsonb_build_object('schema','investigation_manifest.v2',
--     'intent',jsonb_build_object('title','Financials leadership','question','Is the 63-session leadership supported by participation?',
--       'subjects',jsonb_build_array(jsonb_build_object('kind','sector','owner','macro.sector','object_id','xlf')),'horizon','63 sessions','research_as_of','2026-11-06'),
--     'layout_refs','[]'::jsonb,'thesis_refs','[]'::jsonb,
--     'evidence_refs',jsonb_build_array(jsonb_build_object('owner','macro.sector','object_type','sector_observation','object_id','xlf','mode','pinned',
--       'version_ref','captured-sector-1','fingerprint','a3573d7cefe87da155ef7575feb2071b4c32c9f562f42d5724b3ec54332d9eab')),
--     'continuation',jsonb_build_object('next_observation','Review participation and concentration on the next qualified observation')) as m)
-- select public.valid_investigation_manifest_v2(m) as admits_sector_template,
--        public.valid_investigation_manifest_v2(jsonb_set(m,'{intent,subjects,0,object_id}','"sector:financials"',true)) as refuses_research_label,
--        public.valid_investigation_manifest_v2(jsonb_set(m,'{evidence_refs,0,selection}','{"field":"close"}',true)) as refuses_selection
-- from sample;
-- (iii) the evidence probe as authenticated, per new type (expected t for each new pair; then f for a stranger type; the 0047 pairs stay t):
-- begin; set local role authenticated; select public.investigation_evidence_admitted_v2('macro.sector','sector_observation'); select public.investigation_evidence_admitted_v2('macro.sector','basket_observation'); select public.investigation_evidence_admitted_v2('theme_graph.curation_assertion','curation_assertion'); select public.investigation_evidence_admitted_v2('terminal.options_exposure','options_matrix_selection'); select public.investigation_evidence_admitted_v2('macro.sector','dealer_inventory'); rollback;
-- (iii-b) the subject probe as authenticated (expected t for each admitted pair; f for a stranger kind):
-- begin; set local role authenticated; select public.investigation_subject_admitted_v2('macro.sector','sector'); select public.investigation_subject_admitted_v2('theme_graph.identity','theme'); select public.investigation_subject_admitted_v2('theme_graph.identity','basket'); select public.investigation_subject_admitted_v2('theme_graph.identity','company'); select public.investigation_subject_admitted_v2('data_os.security_master','issuer'); select public.investigation_subject_admitted_v2('macro.sector','industry'); rollback;
-- (iv) the same probes as anon (expected ERROR: permission denied for function investigation_evidence_admitted_v2 / investigation_subject_admitted_v2):
-- begin; set local role anon; select public.investigation_evidence_admitted_v2('macro.sector','sector_observation'); select public.investigation_subject_admitted_v2('macro.sector','sector'); rollback;
-- (v) the installed validator body md5 (migration role; expected the guard's 0049 literal after apply, its 0047 literal before):
-- select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure;
-- (vi) both probes' owner, definer flag, search_path and ACL (migration role; expected postgres | t | search_path="" | f | t | f on each row):
-- select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, pg_catalog.array_to_string(p.proconfig, ';'), pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') from pg_catalog.pg_proc p where p.oid in ('public.investigation_evidence_admitted_v2(text,text)'::pg_catalog.regprocedure, 'public.investigation_subject_admitted_v2(text,text)'::pg_catalog.regprocedure);
