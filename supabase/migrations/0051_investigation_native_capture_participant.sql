-- Ledger row: P12.T11.S17-NATIVE-CAPTURE-PARTICIPANT
-- Rollback: NONE: disable callers/revoke claim and mutation EXECUTE; preserve original receipts and use reviewed forward repair.
-- SOURCE ONLY / UNAPPLIED. Existing common OPEN guard and CLOSED installer unchanged.
-- Exact 0030 apply/reconcile body preimages are qualified before DDL. No migration
-- replay, schema readiness, runtime issuer/key/grant, drain or old-effect claim.
-- Same receipt owner; native completion means retention phase stopped writing,
-- never global no-effect, canonical commit, current rights or whole HTTP death.
do $migration$
declare installed_body text; role_name text; function_name text;
begin
select prosrc into installed_body from pg_proc p where p.proowner='postgres'::regrole and p.prosecdef and p.oid=to_regprocedure('public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb)');
if installed_body is null or encode(extensions.digest(convert_to(installed_body,'UTF8'),'sha256'),'hex') not in ('26e5445e8b4ee2bcd1d5f0291915a1ae32481134e26bcc7187783014f5332b1c','f3d940ff01ea3cf629517430f0eae5f1ad6e3341d276a92c74c00f9e7395acc6') then raise exception 'native_prerequisite_body_mismatch:apply_investigation_revision_v2'; end if;
select prosrc into installed_body from pg_proc p where p.proowner='postgres'::regrole and p.prosecdef and p.oid=to_regprocedure('public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb)');
if installed_body is null or encode(extensions.digest(convert_to(installed_body,'UTF8'),'sha256'),'hex') not in ('1f97747ed29165863b456640f89e37023c0418bbd3006fbe322b3a2fd165c168','745cf112acd042e190a9f775ffcc6e234afc078b65e39c80545d0e6c12a61523') then raise exception 'native_prerequisite_body_mismatch:reconcile_investigation_operation_v2'; end if;
execute $native_ddl$
alter table public.investigation_mutation_receipts
 add column if not exists native_binding jsonb,
 add column if not exists native_generation uuid,
 add column if not exists native_phase text,
 add column if not exists native_claimed_at timestamptz,
 add column if not exists native_completed_at timestamptz;
do $shape$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.investigation_mutation_receipts'::regclass and conname='investigation_native_phase_shape') then
  alter table public.investigation_mutation_receipts add constraint investigation_native_phase_shape check (
   (native_binding is null and native_generation is null and native_phase is null and native_claimed_at is null and native_completed_at is null)
   or (native_binding is not null and native_generation is not null and native_claimed_at is not null and native_phase is not null
    and ((native_phase='started' and native_completed_at is null)
     or (native_phase='retained' and native_completed_at is not null and native_completed_at>=native_claimed_at))));
 end if;
end $shape$;

-- Existing server-role trust domain, NOT an individual native binary or a
-- generation credential. auth.role() retains the verified PostgREST JWT role;
-- current_user inside SECURITY DEFINER would identify the owner, not invoker.
create or replace function public.claim_investigation_native_capture_v1(p_binding jsonb,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $fn$
declare actor uuid; op uuid; prior public.investigation_mutation_receipts%rowtype;
 generation uuid:=gen_random_uuid(); stamp timestamptz:=clock_timestamp();
begin
 if auth.role() is distinct from 'service_role' then raise exception 'native_server_role_required' using errcode='42501'; end if;
 if not public.investigation_keys_v2(p_binding,array['actor','operation_id','issuer','auth_epoch','request_sha256','source_binding_sha256'])
 or jsonb_typeof(p_binding->'actor') is distinct from 'string' or (p_binding->>'actor') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or jsonb_typeof(p_binding->'operation_id') is distinct from 'string' or (p_binding->>'operation_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or jsonb_typeof(p_binding->'auth_epoch') is distinct from 'string' or (p_binding->>'auth_epoch') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or jsonb_typeof(p_binding->'issuer') is distinct from 'string' or (p_binding->>'issuer') !~ '^https://[a-z0-9.-]+/auth/v1$'
 or jsonb_typeof(p_binding->'request_sha256') is distinct from 'string' or (p_binding->>'request_sha256') !~ '^[0-9a-f]{64}$'
 or jsonb_typeof(p_binding->'source_binding_sha256') is distinct from 'string' or (p_binding->>'source_binding_sha256') !~ '^[0-9a-f]{64}$'
 then return jsonb_build_object('status','invalid_binding'); end if;
 actor:=(p_binding->>'actor')::uuid; op:=(p_binding->>'operation_id')::uuid;
 if not public.investigation_keys_v2(p_request,array['principal','action','target','expected_revision','manifest'],array['layout_capture'])
 or not (p_request ? 'layout_capture')
 or p_request->>'principal' is distinct from actor::text
 or p_request->>'action' not in ('create','revise')
 or jsonb_typeof(p_request->'target') is distinct from 'string' or (p_request->>'target') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or (p_request->>'expected_revision') !~ '^(0|[1-9][0-9]{0,9})$'
 or (p_request->>'expected_revision')::numeric>2147483646
 or ((p_request->>'expected_revision')::numeric=0) is distinct from (p_request->>'action'='create')
 or not public.valid_investigation_manifest_v2(p_request->'manifest')
 or jsonb_typeof(p_request->'manifest'->'scenario_capture') is distinct from 'object'
 or octet_length(public.investigation_json_v2(p_request))>135168
 then return jsonb_build_object('status','invalid_request'); end if;
 if p_request->'layout_capture' is distinct from 'null'::jsonb then
  if not public.investigation_keys_v2(p_request->'layout_capture',array['layout_id','expected_revision','revision_id'])
  or jsonb_typeof(p_request#>'{layout_capture,layout_id}') is distinct from 'string'
  or (p_request#>>'{layout_capture,layout_id}') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_request#>'{layout_capture,revision_id}') is distinct from 'string'
  or (p_request#>>'{layout_capture,revision_id}') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_request#>'{layout_capture,expected_revision}') is distinct from 'number'
  or (p_request#>>'{layout_capture,expected_revision}') !~ '^[1-9][0-9]{0,8}$'
  or p_request->'manifest'->'layout_refs' is distinct from '[]'::jsonb
  then return jsonb_build_object('status','invalid_request'); end if;
 end if;
 -- SAME original-operation owner and lock as apply/reconcile. No external
 -- write occurs inside SQL. A lost acknowledgement grants no execution.
 perform pg_advisory_xact_lock(hashtextextended('investigation.operation:'||actor::text||':'||op::text,0));
 select * into prior from public.investigation_mutation_receipts where user_id=actor and operation_id=op for update;
 if found then
  if prior.request is distinct from p_request or prior.native_binding is distinct from p_binding then return jsonb_build_object('status','conflict'); end if;
  return jsonb_build_object('schema','investigation.native_capture.v1','status','existing','generation',prior.native_generation,'binding',prior.native_binding);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('investigation.capacity:'||actor::text,0));
 if public.investigation_receipt_capacity_reached_v2(actor) then return jsonb_build_object('status','limit_reached'); end if;
 insert into public.investigation_mutation_receipts(user_id,operation_id,request,result,native_binding,native_generation,native_phase,native_claimed_at)
 values(actor,op,p_request,jsonb_build_object('status','pending','id',p_request->>'target','operation_id',op),p_binding,generation,'started',stamp);
 return jsonb_build_object('schema','investigation.native_capture.v1','status','claimed','generation',generation,'binding',p_binding);
end $fn$;

create or replace function public.complete_investigation_native_capture_v1(p_binding jsonb,p_generation uuid,p_native_phase text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $fn$
declare actor uuid; op uuid; prior public.investigation_mutation_receipts%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'native_server_role_required' using errcode='42501'; end if;
 if p_generation is null or p_native_phase is distinct from 'retained'
 or jsonb_typeof(p_binding) is distinct from 'object'
 or (p_binding->>'actor') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or (p_binding->>'operation_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 then return jsonb_build_object('status','invalid_binding'); end if;
 actor:=(p_binding->>'actor')::uuid; op:=(p_binding->>'operation_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('investigation.operation:'||actor::text||':'||op::text,0));
 select * into prior from public.investigation_mutation_receipts where user_id=actor and operation_id=op for update;
 if not found or prior.native_binding is distinct from p_binding or prior.native_generation is distinct from p_generation
 or prior.native_phase not in ('started','retained') then return jsonb_build_object('status','unresolved'); end if;
 -- Factual original completion may arrive after canonical refusal/gate closure.
 -- It records the no-more-retention-writes barrier, never new rights or effects.
 if prior.native_phase='started' then
  update public.investigation_mutation_receipts set native_phase='retained',native_completed_at=clock_timestamp()
  where user_id=actor and operation_id=op;
 end if;
 return jsonb_build_object('schema','investigation.native_capture.v1','status','recorded','generation',p_generation,'binding',p_binding,'native_phase','retained');
end $fn$;

create or replace function public.read_investigation_native_capture_v1(p_operation_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public,auth as $fn$
 select coalesce((select jsonb_build_object('status','found','schema','investigation.native_capture.v1',
 'binding',native_binding,'generation',native_generation,'native_phase',native_phase,
 'canonical_status',result->>'status','id',request->>'target')
 from public.investigation_mutation_receipts where user_id=auth.uid() and operation_id=p_operation_id and native_binding is not null),jsonb_build_object('status','not_found'))
$fn$;

-- Guard only newly enrolled native rows; no historical operation is backfilled.
-- SQL receipt phase changes never imply external effects did not happen.
create or replace function public.investigation_native_receipt_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog,public,auth as $fn$
begin
 if tg_op='DELETE' then
  if old.native_binding is not null then raise exception 'native_original_receipt_immutable'; end if;
  return old;
 end if;
 if old.native_binding is null then
  if new.native_binding is not null then raise exception 'native_historical_enrollment_forbidden'; end if;
  return new;
 end if;
 if new.user_id is distinct from old.user_id or new.operation_id is distinct from old.operation_id
 or new.request is distinct from old.request or new.native_binding is distinct from old.native_binding
 or new.native_generation is distinct from old.native_generation or new.native_claimed_at is distinct from old.native_claimed_at
 then raise exception 'native_original_binding_immutable'; end if;
 if new.result is distinct from old.result then
  if old.result->>'status' is distinct from 'pending' or jsonb_typeof(new.result->'status') is distinct from 'string' or new.result->>'status' not in ('committed','not_applied')
  or new.result->>'id' is distinct from old.request->>'target' or new.result->>'operation_id' is distinct from old.operation_id::text
  or auth.role() is distinct from 'authenticated' or auth.uid() is distinct from old.user_id
  or (new.result->>'status'='committed' and old.native_phase is distinct from 'retained')
  then raise exception 'native_canonical_terminal_immutable'; end if;
 end if;
 if new.native_phase is distinct from old.native_phase or new.native_completed_at is distinct from old.native_completed_at then
  if auth.role() is distinct from 'service_role' or old.native_phase is distinct from 'started'
  or new.native_phase is distinct from 'retained' or old.native_completed_at is not null
  or new.native_completed_at is null or new.native_completed_at<old.native_claimed_at
  then raise exception 'native_completion_transition_invalid'; end if;
 end if;
 return new;
end $fn$;
drop trigger if exists investigation_native_receipt_guard on public.investigation_mutation_receipts;
create trigger investigation_native_receipt_guard before update or delete on public.investigation_mutation_receipts
 for each row execute function public.investigation_native_receipt_guard_v1();

alter function public.claim_investigation_native_capture_v1(jsonb,jsonb) owner to postgres;
alter function public.complete_investigation_native_capture_v1(jsonb,uuid,text) owner to postgres;
alter function public.read_investigation_native_capture_v1(uuid) owner to postgres;
alter function public.investigation_native_receipt_guard_v1() owner to postgres;
revoke all on function public.claim_investigation_native_capture_v1(jsonb,jsonb),public.complete_investigation_native_capture_v1(jsonb,uuid,text),public.read_investigation_native_capture_v1(uuid),public.investigation_native_receipt_guard_v1() from public,anon,authenticated,service_role;
grant execute on function public.claim_investigation_native_capture_v1(jsonb,jsonb),public.complete_investigation_native_capture_v1(jsonb,uuid,text) to service_role;
grant execute on function public.read_investigation_native_capture_v1(uuid) to authenticated;

create or replace function public.apply_investigation_revision_v2(
 p_id uuid,p_expected_revision integer,p_action text,p_operation_id uuid,p_manifest jsonb,p_layout_capture jsonb default null,p_screen_capture jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,extensions as $$
declare
 actor uuid:=auth.uid(); request jsonb; prior public.investigation_mutation_receipts%rowtype;
 head public.investigations%rowtype; layout public.chart_layouts%rowtype;
 content jsonb:=p_manifest; output jsonb; stamp timestamptz;
 next_revision integer; next_lifecycle text; ref jsonb; capture_id uuid; content_digest text;
 retained public.chart_layout_revisions%rowtype; revision_id uuid:=gen_random_uuid(); manifest_digest text;
 screen_head jsonb; screen_record jsonb; screen_value jsonb; screen_key text; prior_screen jsonb;
begin
 if actor is null then return jsonb_build_object('status','unauthenticated'); end if;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_action is null or p_manifest is null then return jsonb_build_object('status','invalid_payload'); end if;
 request:=jsonb_build_object('principal',actor,'action',p_action,'target',p_id,'expected_revision',p_expected_revision,'manifest',p_manifest,'layout_capture',p_layout_capture);
 -- Omission/null preserves the bytes of every pre-screen receipt.
 if p_screen_capture is not null then request:=request||jsonb_build_object('screen_capture',p_screen_capture); end if;
 -- Same-principal operation lock is always first. Exact retry is independent of the current head.
 perform pg_advisory_xact_lock(hashtextextended('investigation.operation:'||actor::text||':'||p_operation_id::text,0));
 select * into prior from public.investigation_mutation_receipts where user_id=actor and operation_id=p_operation_id;
 if found then
  if prior.request is distinct from request then return jsonb_build_object('status','idempotency_conflict'); end if;
  if prior.native_binding is null or prior.result->>'status' is distinct from 'pending' then return prior.result; end if;
  if prior.native_phase is distinct from 'retained' then return prior.result; end if;
 elsif p_action in ('create','revise') and content ? 'scenario_capture' then
  return jsonb_build_object('status','unavailable');
 end if;
 if p_expected_revision<0 or p_action not in ('create','revise','remove','restore') or (p_action in ('create','revise') and not public.valid_investigation_manifest_v2(content)) then return jsonb_build_object('status','invalid_payload'); end if;
 -- Serialize this principal's capacity check with every new mutation. Receipt replay above
 -- remains available at capacity. These limits include removed records and retained history.
 perform pg_advisory_xact_lock(hashtextextended('investigation.capacity:'||actor::text,0));
 -- Only a NEW receipt allocation is refused at the cap. A native participant
 -- already reserved its slot under the same capacity lock. An at-cap no-effect answer from
 -- reconcile stays true for good. Nothing is written on this path.
 if prior.user_id is null and public.investigation_receipt_capacity_reached_v2(actor) then return jsonb_build_object('status','limit_reached'); end if;
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

 -- Lock only personal retained records under this actor. Same-owner settings are mutable
 -- through their existing API: a missing or changed digest is unavailable, never head fallback.
 for ref in select value from jsonb_array_elements(content->'evidence_refs')
  where value->>'owner'='terminal.smart_screen' order by value->>'version_ref' loop
  select value into prior_screen from public.workspace_settings
   where scope='user' and team_id is null and user_id=actor and key='scr_def.'||replace(ref->>'version_ref','-','') for share;
  if not found or not public.valid_investigation_screen_value_v2(prior_screen,ref) then return jsonb_build_object('status','reference_unavailable'); end if;
 end loop;
 if p_screen_capture is not null then
  if not coalesce(p_action in ('create','revise') and public.investigation_keys_v2(p_screen_capture,array['screen_id','expected_revision'])
   and jsonb_typeof(p_screen_capture->'screen_id')='string' and p_screen_capture->>'screen_id' ~ '^[0-9a-f]{32}$'
   and jsonb_typeof(p_screen_capture->'expected_revision')='number' and p_screen_capture->>'expected_revision' ~ '^[1-9][0-9]{0,9}$'
   and (p_screen_capture->>'expected_revision')::numeric<=1000000000
   and jsonb_array_length(content->'evidence_refs')<128,false) then return jsonb_build_object('status','invalid_payload'); end if;
  if exists(select 1 from jsonb_array_elements(content->'evidence_refs') r where r->>'owner'='terminal.smart_screen' and r->>'object_id'=p_screen_capture->>'screen_id') then return jsonb_build_object('status','invalid_payload'); end if;
  select value into screen_head from public.workspace_settings where scope='user' and team_id is null and user_id=actor
   and key='scr_screen.'||(p_screen_capture->>'screen_id') for update;
  if not found or not public.valid_investigation_screen_record_v2(screen_head,p_screen_capture->>'screen_id') then return jsonb_build_object('status','reference_unavailable'); end if;
  if screen_head->'rev' is distinct from p_screen_capture->'expected_revision' then return jsonb_build_object('status','screen_conflict'); end if;
  screen_key:='scr_def.'||replace(p_operation_id::text,'-','');
  if exists(select 1 from public.workspace_settings where scope='user' and user_id=actor and key=screen_key) then return jsonb_build_object('status','reference_unavailable'); end if;
  if (select count(*) from public.workspace_settings where scope='user' and user_id=actor and left(key,8)='scr_def.')>=2000 then return jsonb_build_object('status','limit_reached'); end if;
  screen_record:=jsonb_set(screen_head,'{review}','null'::jsonb);
  ref:=jsonb_build_object('owner','terminal.smart_screen','object_type','screen_definition','object_id',p_screen_capture->>'screen_id','mode','pinned','version_ref',p_operation_id,
   'fingerprint',encode(extensions.digest(convert_to(public.investigation_json_v2(screen_record),'UTF8'),'sha256'),'hex'));
  screen_value:=ref||jsonb_build_object('found',true,'source_revision',screen_record->'rev','record',screen_record);
  content:=jsonb_set(content,'{evidence_refs}',content->'evidence_refs'||jsonb_build_array(ref));
  if not public.valid_investigation_manifest_v2(content) or not public.valid_investigation_screen_value_v2(screen_value,ref) then return jsonb_build_object('status','invalid_payload'); end if;
 end if;
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
 if screen_value is not null then
  -- Insert only: a racing direct owner write must abort the entire operation, not adopt it.
  insert into public.workspace_settings(scope,user_id,team_id,key,value,updated_at) values('user',actor,null,screen_key,screen_value,stamp);
  select value into prior_screen from public.workspace_settings where scope='user' and team_id is null and user_id=actor and key=screen_key;
  if prior_screen is distinct from screen_value then raise exception 'retained_screen_integrity_conflict'; end if;
 end if;
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
 if prior.native_binding is not null then
  update public.investigation_mutation_receipts q set result=output where q.user_id=actor and q.operation_id=p_operation_id
   and q.request=prior.request and q.native_generation=prior.native_generation and q.native_phase='retained' and q.result->>'status'='pending';
  if not found then raise exception 'native_canonical_receipt_changed'; end if;
 else
  insert into public.investigation_mutation_receipts(user_id,operation_id,request,result) values(actor,p_operation_id,request,output);
 end if;
 return output;
end $$;
create or replace function public.reconcile_investigation_operation_v2(
 p_id uuid,p_expected_revision integer,p_action text,p_operation_id uuid,p_manifest jsonb,p_layout_capture jsonb default null,p_screen_capture jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare actor uuid:=auth.uid(); request jsonb; prior public.investigation_mutation_receipts%rowtype; output jsonb;
begin
 if actor is null then return jsonb_build_object('status','unauthenticated'); end if;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_action is null or p_manifest is null then return jsonb_build_object('status','invalid_payload'); end if;
 request:=jsonb_build_object('principal',actor,'action',p_action,'target',p_id,'expected_revision',p_expected_revision,'manifest',p_manifest,'layout_capture',p_layout_capture);
 -- Omission/null preserves the bytes of every pre-screen receipt.
 if p_screen_capture is not null then request:=request||jsonb_build_object('screen_capture',p_screen_capture); end if;
 perform pg_advisory_xact_lock(hashtextextended('investigation.operation:'||actor::text||':'||p_operation_id::text,0));
 select * into prior from public.investigation_mutation_receipts where user_id=actor and operation_id=p_operation_id;
 if found then
  if prior.request is distinct from request then return jsonb_build_object('status','idempotency_conflict'); end if;
  if prior.native_binding is null or prior.result->>'status' is distinct from 'pending' then return prior.result; end if;
  output:=jsonb_build_object('status','not_applied','id',p_id,'operation_id',p_operation_id);
  update public.investigation_mutation_receipts set result=output where user_id=actor and operation_id=p_operation_id and result->>'status'='pending';
  if not found then raise exception 'native_canonical_receipt_changed'; end if;
  return output;
 end if;
 -- Bound terminal fences. Recovery of an existing outcome is always available above.
 if p_expected_revision<0 or p_action not in ('create','revise','remove','restore') or octet_length(public.investigation_json_v2(p_manifest))>131072
  or jsonb_typeof(p_manifest)<>'object' or (p_layout_capture is not null and octet_length(p_layout_capture::text)>512) or (p_screen_capture is not null and octet_length(p_screen_capture::text)>512) then return jsonb_build_object('status','invalid_payload'); end if;
 perform pg_advisory_xact_lock(hashtextextended('investigation.capacity:'||actor::text,0));
 -- At the cap no receipt is stored, but apply refuses this operation for good under the same
 -- lock, so the missing effect is final. The reason tells clients not to send it again.
 if public.investigation_receipt_capacity_reached_v2(actor) then return jsonb_build_object('status','not_applied','id',p_id,'operation_id',p_operation_id,'reason','limit_reached'); end if;
 output:=jsonb_build_object('status','not_applied','id',p_id,'operation_id',p_operation_id);
 insert into public.investigation_mutation_receipts(user_id,operation_id,request,result) values(actor,p_operation_id,request,output);
 return output;
end $$;
$native_ddl$;
-- Effective ACLs include explicit/default grants; PUBLIC revocation alone is
-- insufficient. Never widen apply/reconcile: CREATE OR REPLACE preserves their
-- exact existing ACL (including a CLOSED prerequisite's revoked state).
foreach function_name in array array['public.claim_investigation_native_capture_v1(jsonb,jsonb)','public.complete_investigation_native_capture_v1(jsonb,uuid,text)'] loop
 foreach role_name in array array['anon','authenticated'] loop
  if has_function_privilege(role_name,function_name,'EXECUTE') then raise exception 'native_untrusted_execute'; end if;
 end loop;
 if not has_function_privilege('service_role',function_name,'EXECUTE') then raise exception 'native_server_execute_missing'; end if;
end loop;
end $migration$;
-- down:
-- Disable original entrants, retain all historical/native rows, and use a reviewed forward repair.
-- revoke execute on function public.claim_investigation_native_capture_v1(jsonb,jsonb) from service_role;
-- Keep original factual completion available during a qualified drain; it cannot authorize another PUT. Full schema/direct-RPC closure remains a separate qualified operation.
-- readback:
-- select proname,prosecdef,proconfig,proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('claim_investigation_native_capture_v1','complete_investigation_native_capture_v1','read_investigation_native_capture_v1','investigation_native_receipt_guard_v1') order by proname;
-- select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='investigation_mutation_receipts' and column_name like 'native_%' order by column_name;
-- select conname from pg_constraint where conrelid='public.investigation_mutation_receipts'::regclass and conname='investigation_native_phase_shape';
-- select tgname,tgenabled from pg_trigger where tgrelid='public.investigation_mutation_receipts'::regclass and tgname='investigation_native_receipt_guard';
