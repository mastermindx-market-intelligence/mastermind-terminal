-- Ledger row: 0053_investigation_v3_prophet_decision_admission / PR #1425 (open, packet SI-P16-LANE6-V3-INVESTIGATION-ADMISSION); not applied
-- Rollback: one guarded transaction (down block below): refuses unless the installed valid_investigation_manifest_v2 is this file's dispatcher (md5 pin) and NO investigation_manifest.v3 revision exists, restores valid_investigation_manifest_v2 to the exact 0052 body (75f2b7feba6b3c9f177f4cda6c3605e9) from the core copy, drops the v3 validator and the core copy, and restores the 0052 evidence probe. Created v3 records are never stranded: with any v3 row present the down refuses and a reviewed forward repair is required.
-- STACKED on 0052 (PR #1410): must not merge before it. Requires the exact 0052 valid_investigation_manifest_v2 body (75f2b7feba6b3c9f177f4cda6c3605e9) installed -- it refuses the 0040 body, 0047 body, 0042 body and any unknown shape. On the installed production ledger (0040 applied; 0042, 0047 and 0052 UNAPPLIED) the operator sequence is: apply 0042, then 0047, then 0052, then this file, each explicitly, one request per file. Apply only after retention and current-rights qualification (lane 9) -- this file is structural admission only.
-- Apply this file explicitly as ONE request; never the entire migration directory. This file defines functions with dollar-quoted bodies containing semicolons: do NOT push it through the naive split-on-semicolon Management API endpoint.
-- What this file installs (source only, UNAPPLIED): (1) valid_investigation_manifest_core_v2 = an exact copy of the 0052 validator body (made from the installed definition behind the md5 guard, so it cannot drift); (2) valid_investigation_manifest_v3: Prophet D05 investigation_manifest.v3 = the v2 fields plus the closed optional user_decision (disposition investigate|watch|pass, reason <=2000 nonempty for pass, RFC 3339 decided_at, <=20 milestones with stable UUID ids, pinned-evidence indexes), the closed prophet.research evidence namespace (today_selection, b03_occurrence, plan_origin, evaluation; pinned-only, version_ref+fingerprint required, no selection) and the v3-only macro.sector keys context_ref (resolver hint) and member_sha256 (durable capture identity, <=8 members), delegating every other rule to the core copy; (3) valid_investigation_manifest_v2 becomes a dispatcher (schema v3 -> v3 validator, anything else -> core copy) so apply_investigation_revision_v2 and every other caller keep their RPC names with no body change; (4) the evidence probe gains a valid prophet.research example. It never creates or alters a table, policy or row, never replaces apply_investigation_revision_v2 (whose installed body already performs the same-owner exact Thesis-version join), adds no retention, entitlement or source read, and changes no RLS/ACL, Options/review/scenario rule or search_path.
begin;

do $$
declare observed text; core_observed text;
begin
  select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure;
  if observed is null or observed not in ('75f2b7feba6b3c9f177f4cda6c3605e9', 'deb836f348c5a008b570984d1b401b0c') then
    raise exception '0053 requires the exact 0052 valid_investigation_manifest_v2 body (75f2b7feba6b3c9f177f4cda6c3605e9) or this file''s dispatcher; observed md5 %', observed;
  end if;
  if to_regprocedure('public.investigation_subject_admitted_v2(text,text)') is null then
    raise exception '0053 requires the 0052 subject probe investigation_subject_admitted_v2(text,text)';
  end if;
  if observed = 'deb836f348c5a008b570984d1b401b0c' then
    select pg_catalog.md5(p.prosrc) into core_observed from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.valid_investigation_manifest_core_v2(jsonb)');
    if core_observed is distinct from '75f2b7feba6b3c9f177f4cda6c3605e9' then
      raise exception '0053 dispatcher is installed but the core copy is not the exact 0052 body; observed md5 %', core_observed;
    end if;
  else
    -- Exact copy of the installed 0052 definition under the core name (header rewritten, body verbatim).
    execute pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure), 'valid_investigation_manifest_v2\(', 'valid_investigation_manifest_core_v2(');
    select pg_catalog.md5(p.prosrc) into core_observed from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.valid_investigation_manifest_core_v2(jsonb)');
    if core_observed is distinct from '75f2b7feba6b3c9f177f4cda6c3605e9' then
      raise exception '0053 core copy is not byte-identical to the 0052 body; observed md5 %', core_observed;
    end if;
  end if;
end $$;

alter function public.valid_investigation_manifest_core_v2(jsonb) owner to postgres;
revoke all on function public.valid_investigation_manifest_core_v2(jsonb) from public, anon, authenticated;

create or replace function public.valid_investigation_manifest_v3(m jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'public'
as $function$
declare c jsonb; r jsonb; d jsonb; ms jsonb; e jsonb; x jsonb; allrefs jsonb; kept jsonb:='[]'; pseen jsonb:='[]'; ids jsonb:='[]'; sidx jsonb;
        pos integer:=0; ev_len integer; n integer; baseline jsonb; baseline_kept boolean:=true; identity jsonb; k text; stamp text;
begin
 if jsonb_typeof(m)<>'object' or m->>'schema'<>'investigation_manifest.v3'
  or not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','continuation'],array['review_baseline_ref','review','scenario_capture','user_decision'])
  or octet_length(public.investigation_json_v2(m))>131072 then return false; end if;
 n:=0;
 foreach k in array array['layout_refs','thesis_refs','evidence_refs'] loop
  if jsonb_typeof(m->k)<>'array' then return false; end if;
  n:=n+jsonb_array_length(m->k);
 end loop;
 if n>128 then return false; end if;
 ev_len:=jsonb_array_length(m->'evidence_refs');
 allrefs:=m->'evidence_refs';
 if m ? 'review_baseline_ref' then allrefs:=allrefs||jsonb_build_array(m->'review_baseline_ref'); end if;
 -- Split each evidence reference: prophet.research is validated here (closed adapter namespace,
 -- pinned-only, version_ref + fingerprint required, no selection); the v3-only Sector keys
 -- context_ref (hint) and member_sha256 (durable capture identity) are validated here and stripped;
 -- everything else is handed unchanged to the exact S validator body (core copy).
 for r in select value from jsonb_array_elements(allrefs) loop
  pos:=pos+1;
  if jsonb_typeof(r)<>'object' then return false; end if;
  if r->>'owner'='prophet.research' then
   if not public.investigation_keys_v2(r,array['owner','object_type','object_id','mode','version_ref','fingerprint'])
    or r->>'object_type' not in ('today_selection','b03_occurrence','plan_origin','evaluation')
    or r->>'mode'<>'pinned'
    or not public.investigation_text_v2(r->'object_id',256,true)
    or not public.investigation_text_v2(r->'version_ref',256,true)
    or jsonb_typeof(r->'fingerprint')<>'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$' then return false; end if;
   if pos<=ev_len then
    identity:=jsonb_build_array(r->'object_type',r->'object_id',r->'mode',r->'version_ref');
    if exists(select 1 from jsonb_array_elements(pseen) prior(value) where prior.value=identity) then return false; end if;
    pseen:=pseen||jsonb_build_array(identity);
   else baseline_kept:=false; end if;
  else
   if r ? 'context_ref' or r ? 'member_sha256' then
    if r->>'owner'<>'macro.sector' or r->>'object_type' not in ('sector_observation','basket_observation') then return false; end if;
    if r ? 'context_ref' and (jsonb_typeof(r->'context_ref')<>'string' or r->>'context_ref' !~ '^[A-Za-z0-9_.-]+$' or pg_catalog.length(r->>'context_ref')>1024) then return false; end if;
    if r ? 'member_sha256' then
     if jsonb_typeof(r->'member_sha256')<>'object'
      or (select count(*) from jsonb_each(r->'member_sha256'))<1 or (select count(*) from jsonb_each(r->'member_sha256'))>8
      or exists(select 1 from jsonb_each(r->'member_sha256') f where f.key !~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$' or jsonb_typeof(f.value)<>'string' or (f.value#>>'{}') !~ '^[0-9a-f]{64}$') then return false; end if;
    end if;
    r:=(r-'context_ref')-'member_sha256';
   end if;
   if pos<=ev_len then kept:=kept||jsonb_build_array(r); else baseline:=r; end if;
  end if;
 end loop;
 if m ? 'user_decision' then
  d:=m->'user_decision';
  if jsonb_typeof(d)<>'object' or not public.investigation_keys_v2(d,array['disposition','reason','decided_at','milestones'])
   or jsonb_typeof(d->'disposition')<>'string' or d->>'disposition' not in ('investigate','watch','pass')
   or jsonb_typeof(d->'reason')<>'string'
   or not ((d->>'reason'='' and d->>'disposition'<>'pass') or public.investigation_text_v2(d->'reason',2000))
   or jsonb_typeof(d->'decided_at')<>'string' or d->>'decided_at' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
   or to_char((substr(d->>'decided_at',1,10))::date,'YYYY-MM-DD')<>substr(d->>'decided_at',1,10)
   or jsonb_typeof(d->'milestones')<>'array' or jsonb_array_length(d->'milestones')>20 then return false; end if;
  for ms in select value from jsonb_array_elements(d->'milestones') loop
   if jsonb_typeof(ms)<>'object' or not public.investigation_keys_v2(ms,array['id','criterion','state','supporting_evidence_indexes'],array['due_on','user_observed_at']) or not (ms ? 'due_on') or not (ms ? 'user_observed_at')
    or jsonb_typeof(ms->'id')<>'string' or ms->>'id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or exists(select 1 from jsonb_array_elements(ids) prior(value) where prior.value=ms->'id')
    or not public.investigation_text_v2(ms->'criterion',500)
    or jsonb_typeof(ms->'state')<>'string' or ms->>'state' not in ('open','met','missed','withdrawn')
    or jsonb_typeof(ms->'supporting_evidence_indexes')<>'array' or jsonb_array_length(ms->'supporting_evidence_indexes')>16 then return false; end if;
   ids:=ids||jsonb_build_array(ms->'id');
   if jsonb_typeof(ms->'due_on')<>'null' then
    if jsonb_typeof(ms->'due_on')<>'string' or ms->>'due_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or to_char((ms->>'due_on')::date,'YYYY-MM-DD')<>ms->>'due_on' then return false; end if;
   end if;
   if jsonb_typeof(ms->'user_observed_at')='null' then
    if ms->>'state' in ('met','missed') then return false; end if;
   else
    if jsonb_typeof(ms->'user_observed_at')<>'string'
     or ms->>'user_observed_at' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
     or to_char((substr(ms->>'user_observed_at',1,10))::date,'YYYY-MM-DD')<>substr(ms->>'user_observed_at',1,10) then return false; end if;
   end if;
   sidx:='[]';
   for x in select value from jsonb_array_elements(ms->'supporting_evidence_indexes') loop
    if jsonb_typeof(x)<>'number' or (x#>>'{}') !~ '^(0|[1-9][0-9]{0,2})$' or (x#>>'{}')::integer>=ev_len
     or (m->'evidence_refs'->((x#>>'{}')::integer))->>'mode' is distinct from 'pinned'
     or exists(select 1 from jsonb_array_elements(sidx) prior(value) where prior.value=x) then return false; end if;
    sidx:=sidx||jsonb_build_array(x);
   end loop;
  end loop;
 end if;
 c:=(m-'user_decision')||pg_catalog.jsonb_build_object('schema','investigation_manifest.v2','evidence_refs',kept);
 if m ? 'review_baseline_ref' then
  if baseline_kept then c:=c||pg_catalog.jsonb_build_object('review_baseline_ref',baseline); else c:=c-'review_baseline_ref'; end if;
 end if;
 return public.valid_investigation_manifest_core_v2(c);
exception when others then return false;
end $function$;
alter function public.valid_investigation_manifest_v3(jsonb) owner to postgres;
revoke all on function public.valid_investigation_manifest_v3(jsonb) from public, anon, authenticated;

create or replace function public.valid_investigation_manifest_v2(m jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'public'
as $function$
begin
 if jsonb_typeof(m)='object' and m->>'schema'='investigation_manifest.v3' then return public.valid_investigation_manifest_v3(m); end if;
 return public.valid_investigation_manifest_core_v2(m);
end $function$;

-- This placeholder ref must satisfy every per-type rule in valid_investigation_manifest_v2/v3; a migration that adds one must re-run readback (iii).
create or replace function public.investigation_evidence_admitted_v2(owner text, object_type text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $$
select public.valid_investigation_manifest_v2(
  pg_catalog.jsonb_build_object(
   'schema',case when $1='prophet.research' then 'investigation_manifest.v3' else 'investigation_manifest.v2' end,
   'intent',pg_catalog.jsonb_build_object('title','XLK gamma at 450','question','Does the matched change hold?','subjects',pg_catalog.jsonb_build_array()),
   'layout_refs',pg_catalog.jsonb_build_array(),
   'thesis_refs',pg_catalog.jsonb_build_array(),
   'evidence_refs',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'owner',$1,'object_type',$2,
    'object_id',case when
      $1='macro.sector' and $2='sector_observation' then 'xlf'
      when $1='macro.sector' and $2='basket_observation' then 'b-us_defensives'
      when $1='theme_graph.curation_assertion' and $2='curation_assertion' then 'ev:0123456789abcdef'
      when $1='prophet.research' then 'obj-1'
      else 'XLK/2026-10-16/450/gamma/one:2026-10-17' end,
    'mode','pinned',
    'version_ref',case when
      $1='theme_graph.curation_assertion' and $2='curation_assertion' then 'gmirca_0123456789abcdef0123456789abcdef'
      when $1='macro.sector' and $2 in ('sector_observation','basket_observation') then 'captured-sector-1'
      when $1='prophet.research' then 'v-1'
      else 'exposure_chart_request.v1:7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6' end,
    'fingerprint','7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6')),
   'continuation',pg_catalog.jsonb_build_object()))
$$;
revoke all on function public.investigation_evidence_admitted_v2(text,text) from public, anon;
grant execute on function public.investigation_evidence_admitted_v2(text,text) to authenticated;
do $$ begin
  revoke all on function public.investigation_evidence_admitted_v2(text,text) from service_role;
exception when undefined_object then null; end $$;

commit;

-- down:
-- -- Emergency rollback only: ONE transaction. Refuses unless the installed validator is this file's dispatcher and no v3 revision exists; restores the exact 0052 validator and probe. Strip exactly one leading comment marker from every line of this block and apply it as ONE request.
-- begin;
-- do $$ declare observed text; begin select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure; if observed is distinct from 'deb836f348c5a008b570984d1b401b0c' then raise exception '0053 down requires the 0053 dispatcher; observed md5 %', observed; end if; if exists(select 1 from public.investigation_revisions r where r.manifest->>'schema'='investigation_manifest.v3') then raise exception '0053 down refused: investigation_manifest.v3 records exist; use a reviewed forward repair'; end if; select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_core_v2(jsonb)'::pg_catalog.regprocedure; if observed is distinct from '75f2b7feba6b3c9f177f4cda6c3605e9' then raise exception '0053 down requires the exact 0052 core copy; observed md5 %', observed; end if; end $$;
-- do $down$ begin execute pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef('public.valid_investigation_manifest_core_v2(jsonb)'::pg_catalog.regprocedure), 'valid_investigation_manifest_core_v2\(', 'valid_investigation_manifest_v2('); end $down$;
-- do $down$ begin execute E'create or replace function public.investigation_evidence_admitted_v2(owner text, object_type text)\n returns boolean\n language sql\n stable\n security definer\n set search_path = ''''\nas $$\nselect public.valid_investigation_manifest_v2(\n  pg_catalog.jsonb_build_object(\n   ''schema'',''investigation_manifest.v2'',\n   ''intent'',pg_catalog.jsonb_build_object(''title'',''XLK gamma at 450'',''question'',''Does the matched change hold?'',''subjects'',pg_catalog.jsonb_build_array()),\n   ''layout_refs'',pg_catalog.jsonb_build_array(),\n   ''thesis_refs'',pg_catalog.jsonb_build_array(),\n   ''evidence_refs'',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(\n    ''owner'',$1,''object_type'',$2,\n    ''object_id'',case when\n      $1=''macro.sector'' and $2=''sector_observation'' then ''xlf''\n      when $1=''macro.sector'' and $2=''basket_observation'' then ''b-us_defensives''\n      when $1=''theme_graph.curation_assertion'' and $2=''curation_assertion'' then ''ev:0123456789abcdef''\n      else ''XLK/2026-10-16/450/gamma/one:2026-10-17'' end,\n    ''mode'',''pinned'',\n    ''version_ref'',case when\n      $1=''theme_graph.curation_assertion'' and $2=''curation_assertion'' then ''gmirca_0123456789abcdef0123456789abcdef''\n      when $1=''macro.sector'' and $2 in (''sector_observation'',''basket_observation'') then ''captured-sector-1''\n      else ''exposure_chart_request.v1:7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6'' end,\n    ''fingerprint'',''7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6'')),\n   ''continuation'',pg_catalog.jsonb_build_object()))\n$$;'; end $down$;
-- drop function public.valid_investigation_manifest_v3(jsonb);
-- drop function public.valid_investigation_manifest_core_v2(jsonb);
-- commit;

-- readback:
-- (i) the dispatcher, v3 validator and core copy (migration role; expected deb836f348c5a008b570984d1b401b0c | 8cc8940c0d3fb6412159bc5818d47087 | 75f2b7feba6b3c9f177f4cda6c3605e9):
-- select (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid='public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure) as dispatcher, (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid='public.valid_investigation_manifest_v3(jsonb)'::pg_catalog.regprocedure) as v3, (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid='public.valid_investigation_manifest_core_v2(jsonb)'::pg_catalog.regprocedure) as core;
-- (ii) the functional validator on a v3 manifest (migration role; expected admits_v3 t, refuses_bad_disposition f, refuses_v2_user_decision f):
-- with sample as (select jsonb_build_object('schema','investigation_manifest.v3','intent',jsonb_build_object('title','Dated look','question','Is the setup intact?','subjects','[]'::jsonb),'layout_refs','[]'::jsonb,'thesis_refs','[]'::jsonb,'evidence_refs','[]'::jsonb,'continuation','{}'::jsonb,'user_decision',jsonb_build_object('disposition','watch','reason','','decided_at','2026-11-10T08:00:00Z','milestones','[]'::jsonb)) as m)
-- select public.valid_investigation_manifest_v2(m) as admits_v3, public.valid_investigation_manifest_v2(jsonb_set(m,'{user_decision,disposition}','"buy"')) as refuses_bad_disposition, public.valid_investigation_manifest_v2(jsonb_set(m,'{schema}','"investigation_manifest.v2"')) as refuses_v2_user_decision from sample;
-- (iii) the evidence probe as authenticated (expected t for each prophet.research type and the 0052/0047 pairs; f for a stranger type): begin; set local role authenticated; select public.investigation_evidence_admitted_v2('prophet.research','today_selection'), public.investigation_evidence_admitted_v2('prophet.research','evaluation'), public.investigation_evidence_admitted_v2('macro.sector','sector_observation'), public.investigation_evidence_admitted_v2('prophet.research','order_ticket'); rollback;
-- (iv) the same probe as anon (expected ERROR: permission denied for function investigation_evidence_admitted_v2): begin; set local role anon; select public.investigation_evidence_admitted_v2('prophet.research','today_selection'); rollback;
-- (v) ACL and owner of the three validators and the probe (migration role; expected postgres on each; anon/authenticated EXECUTE f on the three validators; authenticated t, anon f on the probe):
-- select p.proname, pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_catalog.pg_proc p where p.oid in ('public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure,'public.valid_investigation_manifest_v3(jsonb)'::pg_catalog.regprocedure,'public.valid_investigation_manifest_core_v2(jsonb)'::pg_catalog.regprocedure,'public.investigation_evidence_admitted_v2(text,text)'::pg_catalog.regprocedure) order by 1;
-- (vi) the installed apply body still carries the same-owner Thesis-version join (migration role; precondition, expected md5 a14a4abf290ca9dc99f89b19617c7e9c on the production ledger):
-- select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb)'::pg_catalog.regprocedure;
