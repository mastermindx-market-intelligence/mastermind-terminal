-- Ledger row: 0043 | IW2-OPTIONS-PLAN-V3-COMPOSITION | original PR #804 | NOT APPLIED
-- Rollback: NONE: retain admitted revisions/receipts and close ingress for a reviewed forward repair; never install an older predicate after v3 writes.
-- Source preparation only. This is not authorization or proof of cutover, grants,
-- exact0030 qualification, fleet drain or release5989604142 clearance.
-- Prerequisites are schema/order checks, not an authenticity or production receipt.
-- All definitions/revocations are in one atomic DO statement on the existing helper.
do $composition$
begin
 if to_regprocedure('public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb)') is null
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='investigation_revisions' and column_name='manifest_digest')
  or to_regprocedure('public.valid_investigation_scenario_reference_v1(jsonb)') is null
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='resource_grants' and column_name='include_scenario' and data_type='boolean') then
  raise exception '0043_requires_existing_kernel_and_0042';
 end if;
 if position('scenario_capture' in pg_get_functiondef('public.valid_investigation_manifest_v2(jsonb)'::regprocedure))=0 then
  raise exception '0043_requires_0042_predicate_order';
 end if;
 execute $definitions$
-- SOURCE CANDIDATE ONLY / UNAPPLIED. Not a cutover or qualification command.
-- Install ordering, if separately admitted: exact 0030, 0039, 0040, 0041, 0042,
-- then this forward composition. Never apply an older replacement predicate after it.
-- Original migrations, transaction/RLS/grants and canonical digest owner stay unchanged.
-- Promoted as 0043 after namespace census and independent changed-risk source review; UNAPPLIED.

create or replace function public.investigation_plan_keys_v1(v jsonb, keys text[])
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(v)='object' and v ?& keys
   and not exists(select 1 from jsonb_object_keys(v) k where not(k=any(keys))),false)
$$;

create or replace function public.investigation_plan_text_v1(v jsonb, lim integer, single_line boolean default false)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(v)='string' and char_length(v#>>'{}')<=lim
   and (v#>>'{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]'
   and (not single_line or (v#>>'{}') !~ U&'[\0009\000a\000d\2028\2029]'),false)
$$;

-- ECMAScript shortest number spelling is needed only for existing identity keys.
-- PG float output intentionally avoids some midpoints (e.g. 1.25e22); do not use
-- its printed decimal as JS spelling. Decode the double's exact rational value,
-- find the nearest shortest decimal that round-trips, and use ties-to-even.
-- The supplied JSON number must equal that decimal; never round stored inputs.
-- Native investigation_json_v2/digests remain unchanged and authoritative.
create or replace function public.investigation_plan_number_v1(v jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare n numeric; f double precision; b bytea; e integer; mantissa numeric; exact_value numeric;
 negative boolean; i integer; precision_value integer; scale_value integer; factor numeric; scaled numeric; candidate numeric:=null;
 digits text; s text; point integer; decimal_exponent integer;
begin
 if jsonb_typeof(v) is distinct from 'number' then return null; end if;
 n:=(v#>>'{}')::numeric;
 if n=0 then return '0'; end if;
 negative:=n<0; n:=abs(n); f:=(n::text)::double precision;
 if f::text in ('Infinity','NaN') then return null; end if;
 b:=float8send(f); e:=((get_byte(b,0)&127)*16)+(get_byte(b,1)>>4);
 mantissa:=get_byte(b,1)&15;
 for i in 2..7 loop mantissa:=mantissa*256+get_byte(b,i); end loop;
 if e=0 then e:=-1074; else mantissa:=mantissa+4503599627370496; e:=e-1075; end if;
 exact_value:=mantissa;
 if e>=0 then for i in 1..e loop exact_value:=exact_value*2; end loop;
 else
  for i in 1..(-e) loop exact_value:=exact_value*5; end loop;
  exact_value:=(exact_value::text||'e'||e::text)::numeric;
 end if;
 s:=exact_value::text;
 point:=case when position('.' in s)>0 then position('.' in s)-1 else length(s) end;
 digits:=replace(s,'.','');
 while left(digits,1)='0' loop digits:=substr(digits,2); point:=point-1; end loop;
 decimal_exponent:=point-1;
 for precision_value in 1..17 loop
  scale_value:=precision_value-1-decimal_exponent;
  factor:=('1e'||scale_value::text)::numeric;
  scaled:=exact_value*factor;
  candidate:=case when scaled-trunc(scaled)=0.5 then (trunc(scaled)+mod(trunc(scaled),2))/factor else round(exact_value,scale_value) end;
  begin
   if candidate<>0 and (candidate::text)::double precision=f then exit; end if;
  exception when numeric_value_out_of_range then null;
  end;
  candidate:=null;
 end loop;
 if candidate is null or candidate<>n then return null; end if;
 s:=candidate::text;
 point:=case when position('.' in s)>0 then position('.' in s)-1 else length(s) end;
 digits:=replace(s,'.','');
 while left(digits,1)='0' loop digits:=substr(digits,2); point:=point-1; end loop;
 digits:=rtrim(digits,'0');
 if point>0 and point<=21 then
  s:=case when length(digits)<=point then digits||repeat('0',point-length(digits)) else left(digits,point)||'.'||substr(digits,point+1) end;
 elsif point<=0 and point> -6 then s:='0.'||repeat('0',-point)||digits;
 else s:=left(digits,1)||case when length(digits)>1 then '.'||substr(digits,2) else '' end||'e'||case when point-1>=0 then '+' else '' end||(point-1)::text;
 end if;
 return case when negative then '-' else '' end||s;
exception when others then return null;
end $$;

create or replace function public.investigation_plan_uri_v1(v text)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare b bytea:=convert_to(v,'UTF8'); i integer; n integer; result text:='';
begin
 for i in 0..length(b)-1 loop
  n:=get_byte(b,i);
  if (n between 65 and 90) or (n between 97 and 122) or (n between 48 and 57) or chr(n)=any(array['-','_','.','!','~','*','''','(',')']) then result:=result||chr(n);
  else result:=result||'%'||upper(lpad(to_hex(n),2,'0')); end if;
 end loop;
 return result;
end $$;

-- Same JSON data limits as the native leaf; JSONB has no accessors/prototypes.
-- Byte counts use JS number spelling, but key order does not affect byte length.
create or replace function public.investigation_plan_json_v1(v jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,public as $$
declare s text;
begin
 case jsonb_typeof(v)
 when 'object' then return '{'||coalesce((select string_agg(to_jsonb(key)::text||':'||public.investigation_plan_json_v1(value),',' order by key collate "C") from jsonb_each(v)),'')||'}';
 when 'array' then return '['||coalesce((select string_agg(public.investigation_plan_json_v1(value),',' order by n) from jsonb_array_elements(v) with ordinality a(value,n)),'')||']';
 when 'number' then s:=public.investigation_plan_number_v1(v); if s is null then raise exception 'non_js_number'; end if; return s;
 else return v::text;
 end case;
end $$;

create or replace function public.valid_investigation_option_plan_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare leg jsonb; pin jsonb; id jsonb; row_value jsonb; terms jsonb; a jsonb; entry_value jsonb;
 k text; term_value jsonb; key_value text; numeric_text text; session_value text; root_value text:=null; seen text[]:='{}';
 nodes integer; max_depth integer; text_bytes bigint; bad boolean;
begin
 if not public.investigation_plan_keys_v1(p,array['schema','legs','research']) or p->>'schema' is distinct from 'options_plan_draft.v1'
  or jsonb_typeof(p->'legs') is distinct from 'array' or jsonb_array_length(p->'legs') not between 1 and 4 then return false; end if;
 with recursive walk(v,depth) as (
  select p,0 union all
  select child.value,w.depth+1 from walk w cross join lateral (
   select value from jsonb_each(case when jsonb_typeof(w.v)='object' then w.v else '{}'::jsonb end)
   union all select value from jsonb_array_elements(case when jsonb_typeof(w.v)='array' then w.v else '[]'::jsonb end)
  ) child where w.depth<=12
 ) select count(*),max(depth),coalesce(sum(case when jsonb_typeof(v)='string' then octet_length(v#>>'{}') else 0 end),0)
  +coalesce(sum(case when jsonb_typeof(v)='object' then (select coalesce(sum(octet_length(key)),0) from jsonb_object_keys(v) key) else 0 end),0),
  bool_or((jsonb_typeof(v)='string' and not public.investigation_plan_text_v1(v,65536))
   or (jsonb_typeof(v)='object' and exists(select 1 from jsonb_object_keys(v) key where key in ('__proto__','prototype','constructor') or not public.investigation_plan_text_v1(to_jsonb(key),65536))))
 into nodes,max_depth,text_bytes,bad from walk;
 if nodes>2048 or max_depth>12 or text_bytes>65536 or bad or octet_length(public.investigation_plan_json_v1(p))>65536 then return false; end if;
 if not public.investigation_plan_keys_v1(p->'research',array['thesis','invalidation','horizon'])
  or not public.investigation_plan_text_v1(p#>'{research,thesis}',4000)
  or not public.investigation_plan_text_v1(p#>'{research,invalidation}',4000)
  or not public.investigation_plan_text_v1(p#>'{research,horizon}',160,true) then return false; end if;
 for leg in select value from jsonb_array_elements(p->'legs') loop
  if not public.investigation_plan_keys_v1(leg,array['snapshot','assumptions']) then return false; end if;
  pin:=leg->'snapshot'; id:=pin->'identity'; row_value:=pin->'row'; terms:=id->'terms'; a:=leg->'assumptions';
  if not public.investigation_plan_keys_v1(pin,array['pinKey','identity','family','hotView','session','asofRaw','schema','sourceStale','row'])
   or not public.investigation_plan_keys_v1(id,array['root','right','exp','strike','terms','key','adjustedRootHint'])
   or not public.investigation_plan_keys_v1(terms,array['multiplier','deliverable','settlement','exercise_style'])
   or jsonb_typeof(row_value) is distinct from 'object' or octet_length(public.investigation_plan_json_v1(row_value))>8192
   or jsonb_typeof(pin->'sourceStale') is distinct from 'boolean' or jsonb_typeof(pin->'family') is distinct from 'string' or pin->>'family' not in ('doi','hot')
   or not (pin->'hotView'='null'::jsonb or pin->>'hotView' in ('by_volume','by_premium'))
   or (pin->>'family'='doi' and pin->'hotView'<>'null'::jsonb)
   or not (pin->'schema'='null'::jsonb or public.investigation_plan_text_v1(pin->'schema',256,true))
   or not public.investigation_plan_text_v1(pin->'asofRaw',128,true) or pin->>'asofRaw'='' then return false; end if;
  with recursive walk(v,depth) as (select row_value,0 union all select c.value,w.depth+1 from walk w cross join lateral (
   select value from jsonb_each(case when jsonb_typeof(w.v)='object' then w.v else '{}'::jsonb end)
   union all select value from jsonb_array_elements(case when jsonb_typeof(w.v)='array' then w.v else '[]'::jsonb end)
  ) c where w.depth<=8) select max(depth) into max_depth from walk;
  if max_depth>8 then return false; end if;
  session_value:=left(pin->>'asofRaw',10);
  if session_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(session_value,4)::integer<100
   or to_char(session_value::date,'YYYY-MM-DD')<>session_value or jsonb_typeof(pin->'session') is distinct from 'string' or pin->>'session' is distinct from session_value then return false; end if;
  if jsonb_typeof(row_value->'root') is distinct from 'string' or row_value->>'root'='' or (row_value->>'root') ~ U&'[\0009-\000d\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]'
   or jsonb_typeof(row_value->'right') is distinct from 'string' or row_value->>'right' not in ('C','P') or jsonb_typeof(row_value->'exp') is distinct from 'string'
   or row_value->>'exp' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(row_value->>'exp',4)::integer<100
   or to_char((row_value->>'exp')::date,'YYYY-MM-DD')<>row_value->>'exp'
   or public.investigation_plan_number_v1(row_value->'strike') is null or (row_value->>'strike')::numeric<=0 then return false; end if;
  if id->'root' is distinct from row_value->'root' or id->'right' is distinct from row_value->'right'
   or id->'exp' is distinct from row_value->'exp' or id->'strike' is distinct from row_value->'strike'
   or id->'adjustedRootHint' is distinct from to_jsonb((row_value->>'root') ~ '[0-9]$') then return false; end if;
  if root_value is not null and root_value<>id->>'root' then return false; end if; root_value:=id->>'root';
  key_value:='='||public.investigation_plan_uri_v1(root_value)||'|'||(id->>'right')||'|'||(id->>'exp')||'|='||public.investigation_plan_number_v1(id->'strike');
  foreach k in array array['multiplier','deliverable','settlement','exercise_style'] loop
   term_value:=coalesce(row_value->k,'null'::jsonb);
   if terms->k is distinct from term_value then return false; end if;
   if term_value='null'::jsonb then key_value:=key_value||'|?';
   elsif k='multiplier' then
    numeric_text:=public.investigation_plan_number_v1(term_value);
    if numeric_text is null or (term_value#>>'{}')::numeric<=0 then return false; end if;
    key_value:=key_value||'|='||public.investigation_plan_uri_v1(numeric_text);
   else
    if jsonb_typeof(term_value) is distinct from 'string' or btrim(term_value#>>'{}',E' \t\r\n'||U&'\000b\000c\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')='' then return false; end if;
    key_value:=key_value||'|='||public.investigation_plan_uri_v1(term_value#>>'{}');
   end if;
  end loop;
  if id->>'key' is distinct from key_value or pin->>'pinKey' is distinct from (pin->>'family')||'@'||session_value||'#'||key_value
   or key_value=any(seen) then return false; end if; seen:=array_append(seen,key_value);
  if not public.investigation_plan_keys_v1(a,array['side','quantity','entry'])
   or not (a->'side'='null'::jsonb or a->>'side' in ('buy','sell')) then return false; end if;
  if a->'quantity'<>'null'::jsonb and (jsonb_typeof(a->'quantity') is distinct from 'number' or (a->>'quantity')::numeric not between 1 and 1000000 or trunc((a->>'quantity')::numeric)<>(a->>'quantity')::numeric) then return false; end if;
  entry_value:=a->'entry';
  if entry_value<>'null'::jsonb and (not public.investigation_plan_keys_v1(entry_value,array['kind','premium_per_unit','currency'])
   or entry_value->>'kind' is distinct from 'user_assumption' or entry_value->>'currency' is distinct from 'USD'
   or public.investigation_plan_number_v1(entry_value->'premium_per_unit') is null or (entry_value->>'premium_per_unit')::numeric<0) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

-- Forward composition over the existing predicate; no transaction/store replacement.
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
   or not ((r->>'owner'='terminal.analysis_symbol' and r->>'kind'='security') or (r->>'owner'='data_os.security_master' and r->>'kind' in ('security','issuer')))
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
  or not ((r->>'owner'='earnings.workspace_generation' and r->>'object_type'='event_workspace') or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement')))
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
 return true;
exception when others then return false;
end $$;

-- Internal pure helpers are not a new public RPC surface. Existing predicate ACL is retained.
revoke all on function public.investigation_plan_keys_v1(jsonb,text[]),public.investigation_plan_text_v1(jsonb,integer,boolean),public.investigation_plan_number_v1(jsonb),public.investigation_plan_uri_v1(text),public.investigation_plan_json_v1(jsonb),public.valid_investigation_option_plan_v1(jsonb) from public,anon,authenticated;

$definitions$;
end $composition$;
