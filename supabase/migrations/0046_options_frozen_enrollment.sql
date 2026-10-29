-- Ledger row: 0046 / OPTIONS-EXPOSURE-P09-EXACT-ENROLLMENT / PR #1182
-- Rollback: application-first disablement; retain intent revision and enrollment tombstones.
-- Source only, UNAPPLIED. Requires immutable0045. No route, enrollment,
-- opt-in, source/action grant, provider call, activation or delivery is installed.
-- One atomic statement for the incumbent statement-at-a-time installer.
-- Private means owner-RLS readable and service-write-only, not a secret from
-- the owning user. alert_runs and its authenticated-wide policy are unchanged.
-- Embedded proposed_intent_revision.sql SHA256 a4aed9e4af12c0cf9a2718f9574c0ab092838714ff1b7b718fe629ef57ddc3a2
-- Embedded proposed_enrollment_attempt.sql SHA256 77842b264e7c932c05432b1e1cc97b9cc71219cda1bff5027681aca85bbaa1bf
DO $frozen_enrollment_composed$
BEGIN
  if not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.alerts'::regclass
      and attname='frozen_runtime' and atttypid='jsonb'::regtype and not attnotnull and not attisdropped)
     or to_regprocedure('public.read_frozen_node_runtime(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb)') is null
     or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.alert_runs'::regclass
       and tgname='frozen_publication_run_guard' and not tgisinternal) then
    raise exception 'qualified0045 frozen runtime composition required before0046';
  end if;
  -- Reapplication temporarily removes only this composition's seven-argument
  -- overload inside the SAME transaction, so the immutable accepted stage can
  -- reject every other unexpected overload. Stage2 restores ACLs/body atomically.
  drop function if exists public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid,jsonb);
  EXECUTE $enrollment_stage_0$-- SOURCE PROPOSAL ONLY: UNRESERVED / UNAPPLIED. Never edit or replay merged0045.
-- Amend the EXISTING alerts row and arm_frozen_node_runtime name. No route,
-- scheduler, source/account execution, grant from JSON or runtime activation.
-- A future canonical followup migration must package/review this atomically.
-- Initial null/null runtime CAS alone cannot reject pause/restore ABA. The new
-- DB-owned revision is independent of frozen_runtime, rotates on INSERT and
-- protected edits, and is compared under the same row/advisory lock as arming.
-- UUID revision is an exact precondition, never an entitlement or action grant.
-- The legacy five-argument arm is removed in this same atomic statement.
DO $intent_revision_install$
DECLARE
  existed boolean;
BEGIN
  select exists(select 1 from pg_catalog.pg_attribute
    where attrelid='public.alerts'::regclass and attname='frozen_intent_revision'
      and not attisdropped) into existed;
  if not existed then
    alter table public.alerts add column frozen_intent_revision uuid;
    -- Install-time metadata initialization, not lifecycle arming or source proof.
    -- Existing frozen_runtime and every business field remain unchanged.
    update public.alerts set frozen_intent_revision=pg_catalog.gen_random_uuid();
    alter table public.alerts alter column frozen_intent_revision set not null;
  elsif not exists(select 1 from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.alerts'::regclass and a.attname='frozen_intent_revision'
        and not a.attisdropped and a.atttypid='uuid'::regtype and a.attnotnull
        and a.attgenerated='' and a.attidentity='' and d.oid is null) then
    raise exception 'frozen intent revision column shape mismatch';
  end if;

  -- No default: the BEFORE trigger creates every INSERT revision, so an explicit
  -- client-selected UUID can be rejected rather than mistaken for a default.
  create or replace function public.alerts_frozen_runtime_guard()
  returns trigger language plpgsql security invoker set search_path='' as $guard$
  declare
    v_privileged boolean;
    v_protected_changed boolean;
  begin
    v_privileged := current_user='service_role' or coalesce(
      (select rolsuper from pg_catalog.pg_roles where rolname=current_user),false);
    if tg_op='INSERT' then
      if new.frozen_intent_revision is not null then
        raise exception 'frozen intent revision is DB-owned';
      end if;
      if new.frozen_runtime is not null and not v_privileged then
        raise exception 'frozen_runtime is protected: forged runtime insert refused';
      end if;
      new.frozen_intent_revision := pg_catalog.gen_random_uuid();
      return new;
    end if;
    if new.frozen_intent_revision is distinct from old.frozen_intent_revision then
      raise exception 'frozen intent revision is DB-owned';
    end if;
    if new.frozen_runtime is distinct from old.frozen_runtime and not v_privileged then
      raise exception 'frozen_runtime is protected: direct mutation refused';
    end if;
    v_protected_changed := new.id is distinct from old.id
      or new.user_id is distinct from old.user_id
      or new.symbol is distinct from old.symbol
      or new.condition is distinct from old.condition
      or new.active is distinct from old.active
      or new.created_at is distinct from old.created_at;
    if v_protected_changed then
      new.frozen_runtime := null;
      new.frozen_intent_revision := pg_catalog.gen_random_uuid();
    end if;
    return new;
  end;
  $guard$;
  revoke execute on function public.alerts_frozen_runtime_guard() from public,anon,authenticated;
  grant execute on function public.alerts_frozen_runtime_guard() to service_role;

  -- Refuse a surprise overload instead of silently leaving another arm path.
  if exists(select 1 from pg_catalog.pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname='arm_frozen_node_runtime'
        and p.oid not in (
          coalesce(to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)')::oid,0),
          coalesce(to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid)')::oid,0))) then
    raise exception 'unrecognized frozen arm overload';
  end if;
  drop function if exists public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint);
create or replace function public.arm_frozen_node_runtime(
  p_alert_id uuid,
  p_principal uuid,
  p_predicate jsonb,
  p_expected_generation uuid,
  p_expected_revision bigint,
  p_expected_intent_revision uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row public.alerts;
  v_ok boolean;
  v_reason text;
  v_pred jsonb;
  v_runtime jsonb;
  v_now text;
  v_gen uuid;
begin
  if current_user <> 'service_role' and not coalesce(
      (select rolsuper from pg_catalog.pg_roles where rolname=current_user),false) then
    return public.frozen_node_refuse('service_role_required');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'options_frozen_node:' || p_alert_id::text, 0));
  if exists (select 1 from public.alert_outbox where alert_id=p_alert_id and user_id=p_principal
       and status='prepared' and payload->>'category'='options_exposure_node') then
    return public.frozen_node_refuse('unresolved_prepared_intent');
  end if;
  -- Lock exactly this id+principal row for the compare-and-set.
  select * into v_row
    from public.alerts
   where id = p_alert_id
     and user_id = p_principal
     for update;
  if not found then
    return public.frozen_node_refuse('not_found_or_not_owner');
  end if;

  -- A value-equal row may have been paused/restored or deleted/reinserted.
  -- This DB-owned revision survives nullable runtime and cannot be client-restored.
  if p_expected_intent_revision is null then
    return public.frozen_node_refuse('intent_revision_required');
  end if;
  if v_row.frozen_intent_revision is distinct from p_expected_intent_revision then
    return public.frozen_node_refuse('stale_intent_revision', 'conflict');
  end if;

  select s.v_ok, s.v_reason, s.v_pred
    into v_ok, v_reason, v_pred
    from public.frozen_node_stable(v_row.condition, v_row.active, p_predicate) s;
  if not v_ok then
    return public.frozen_node_refuse(v_reason);
  end if;

  v_runtime := v_row.frozen_runtime;
  if v_runtime is null then
    if p_expected_generation is not null or p_expected_revision is not null then
      return public.frozen_node_refuse('expected_state_conflicts_null_runtime', 'conflict');
    end if;
  else
    if not public.frozen_node_runtime_valid(v_runtime, v_row.id, v_row.user_id, v_pred) then
      return public.frozen_node_refuse('runtime_malformed');
    end if;
    if p_expected_generation is null
       or p_expected_revision is null
       or p_expected_generation::text is distinct from (v_runtime ->> 'generation')
       or p_expected_revision::numeric is distinct from (v_runtime ->> 'revision')::numeric then
      return public.frozen_node_refuse('stale_generation_or_revision', 'conflict');
    end if;
  end if;

  v_now := public.frozen_node_utc_text();
  v_gen := pg_catalog.gen_random_uuid();
  v_runtime := pg_catalog.jsonb_build_object(
    'schema',      'options.frozen_runtime/v1',
    'alertId',     v_row.id::text,
    'principal',   v_row.user_id::text,
    'generation',  v_gen::text,
    'createdAt',   v_now,
    'armingEpoch', v_now,
    'predicate',   v_pred,
    'revision',    0,
    'priorState',  null::jsonb);

  update public.alerts
     set frozen_runtime = v_runtime
   where id = v_row.id
     and user_id = v_row.user_id;
  if not found then
    return public.frozen_node_refuse('arm_write_lost');
  end if;
  return pg_catalog.jsonb_build_object('kind', 'data', 'runtime', v_runtime,
    'intentRevision', v_row.frozen_intent_revision::text);
end;
$fn$;

  revoke execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid) from public,anon,authenticated;
  grant execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid) to service_role;
END $intent_revision_install$;
$enrollment_stage_0$;
  EXECUTE $enrollment_stage_1$-- Dormant initial enrollment on the incumbent owner-RLS alerts row.
-- No new table, RPC family, route, activation or delivery. The envelope is
-- owner-readable, service-write-only; it is NEVER placed in alert_runs.
DO $enrollment_attempt_install$
BEGIN
  if not exists(select 1 from pg_catalog.pg_class c where c.oid='public.alerts'::regclass
      and c.relrowsecurity) then
    raise exception 'owner-scoped alerts RLS required';
  end if;
  -- RLS being enabled alone does not establish privacy. A permissive extra
  -- SELECT/ALL policy could disclose the new envelope to every authenticated
  -- principal. Require the exact incumbent owner policy before adding data.
  if (select count(*) from pg_catalog.pg_policy where polrelid='public.alerts'::regclass) <> 1
     or not exists(select 1 from pg_catalog.pg_policy where polrelid='public.alerts'::regclass
       and polpermissive and polcmd='*' and polroles=array[0]::oid[]
       and pg_catalog.pg_get_expr(polqual,polrelid)='(user_id = auth.uid())'
       and pg_catalog.pg_get_expr(polwithcheck,polrelid)='(user_id = auth.uid())') then
    raise exception 'exact incumbent alerts owner policy required';
  end if;
  if to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid)') is null
     or to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)') is not null then
    raise exception 'six-argument intent-bound arm required without legacy arm';
  end if;
  alter table public.alerts add column if not exists frozen_enrollment jsonb;
  if not exists(select 1 from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.alerts'::regclass and a.attname='frozen_enrollment'
        and not a.attisdropped and a.atttypid='jsonb'::regtype and not a.attnotnull
        and a.attgenerated='' and a.attidentity='' and d.oid is null) then
    raise exception 'frozen enrollment column shape mismatch';
  end if;
  create or replace function public.alerts_frozen_enrollment_guard()
  returns trigger language plpgsql security invoker set search_path='' as $guard$
  begin
    if tg_op='INSERT' then
      if new.frozen_enrollment is not null then
        raise exception 'frozen enrollment insert refused';
      end if;
    elsif new.frozen_enrollment is distinct from old.frozen_enrollment then
      if current_user <> 'service_role' and not coalesce(
          (select rolsuper from pg_catalog.pg_roles where rolname=current_user),false) then
        raise exception 'frozen enrollment is service-write-only';
      end if;
      if old.frozen_enrollment is not null and
         (old.frozen_enrollment->>'phase'='terminal'
          or (new.frozen_enrollment - 'phase' - 'outcome') is distinct from
             (old.frozen_enrollment - 'phase' - 'outcome')
          or new.frozen_enrollment->>'phase' is distinct from 'terminal') then
        raise exception 'frozen enrollment identity and terminal outcome are immutable';
      end if;
    end if;
    -- Do not let owner reassignment disclose the previous owner's private pin.
    if tg_op='UPDATE' and (new.id is distinct from old.id or new.user_id is distinct from old.user_id)
       and old.frozen_enrollment is not null then
      raise exception 'retained enrollment forbids alert identity reassignment';
    end if;
    return new;
  end;
  $guard$;
  revoke execute on function public.alerts_frozen_enrollment_guard() from public,anon,authenticated;
  grant execute on function public.alerts_frozen_enrollment_guard() to service_role;
  drop trigger if exists alerts_frozen_enrollment_guard on public.alerts;
  create trigger alerts_frozen_enrollment_guard before insert or update on public.alerts
    for each row execute function public.alerts_frozen_enrollment_guard();

  create or replace function public.arm_frozen_node_runtime(
    p_alert_id uuid, p_principal uuid, p_predicate jsonb,
    p_expected_generation uuid, p_expected_revision bigint,
    p_expected_intent_revision uuid, p_enrollment jsonb)
  returns jsonb language plpgsql security invoker set search_path='' as $attempt$
  declare
    v_row public.alerts;
    v_pin jsonb;
    v_saved jsonb;
    v_result jsonb;
    v_operation text;
    v_ok boolean;
    v_reason text;
    v_pred jsonb;
  begin
    if current_user <> 'service_role' and not coalesce(
        (select rolsuper from pg_catalog.pg_roles where rolname=current_user),false) then
      return public.frozen_node_refuse('service_role_required');
    end if;
    if jsonb_typeof(p_enrollment) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_enrollment) k)
          is distinct from array['attemptId','lens','operation']::text[]
       or coalesce(p_enrollment->>'attemptId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(p_enrollment->'lens') is distinct from 'object'
       or p_expected_generation is not null or p_expected_revision is not null then
      return public.frozen_node_refuse('invalid_enrollment_request');
    end if;
    v_operation := p_enrollment->>'operation';
    if v_operation is null or v_operation not in ('prepare','arm','reconcile') then
      return public.frozen_node_refuse('invalid_enrollment_operation');
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'options_frozen_node:' || p_alert_id::text,0));
    select * into v_row from public.alerts
      where id=p_alert_id and user_id=p_principal for update;
    if not found then
      return public.frozen_node_refuse('not_found_or_not_owner');
    end if;
    if p_expected_intent_revision is null
       or v_row.frozen_intent_revision is distinct from p_expected_intent_revision then
      return public.frozen_node_refuse('stale_intent_revision','conflict');
    end if;
    select s.v_ok,s.v_reason,s.v_pred into v_ok,v_reason,v_pred
      from public.frozen_node_stable(v_row.condition,v_row.active,p_predicate) s;
    if not v_ok then return public.frozen_node_refuse(v_reason); end if;
    v_pin := pg_catalog.jsonb_build_object(
      'schema','options.frozen_enrollment/v1','attemptId',p_enrollment->>'attemptId',
      'alertId',p_alert_id::text,'principal',p_principal::text,
      'predicate',v_pred,'intentRevision',p_expected_intent_revision::text,
      'lens',p_enrollment->'lens');
    v_saved := v_row.frozen_enrollment;
    if v_saved is not null and (v_saved-'preparedAt'-'phase'-'outcome') is distinct from v_pin then
      return public.frozen_node_refuse('enrollment_attempt_conflict','conflict');
    end if;
    if v_saved->>'phase'='terminal' then
      -- A retained acknowledgment belongs to its original generation only.
      if v_saved->'outcome'->>'kind'='data' and
         (v_row.frozen_runtime->>'generation') is distinct from
         (v_saved->'outcome'->'runtime'->>'generation') then
        return public.frozen_node_refuse('enrollment_generation_changed','conflict');
      end if;
      return pg_catalog.jsonb_build_object('kind','enrollment','enrollment',v_saved);
    end if;
    if v_operation='prepare' then
      if v_saved is not null then
        return pg_catalog.jsonb_build_object('kind','pending','enrollment',v_saved);
      end if;
      if v_row.frozen_runtime is not null then
        return public.frozen_node_refuse('initial_runtime_present','conflict');
      end if;
      if exists(select 1 from public.alert_outbox where alert_id=p_alert_id and user_id=p_principal
         and status='prepared' and payload->>'category'='options_exposure_node') then
        return public.frozen_node_refuse('unresolved_prepared_intent');
      end if;
      v_saved := v_pin || pg_catalog.jsonb_build_object('preparedAt',public.frozen_node_utc_text(),
        'phase','prepared','outcome',null::jsonb);
      update public.alerts set frozen_enrollment=v_saved where id=p_alert_id and user_id=p_principal;
      return pg_catalog.jsonb_build_object('kind','prepared','enrollment',v_saved);
    end if;
    if v_operation='arm' then
      if v_saved is null or v_saved->>'phase' is distinct from 'prepared' then
        return public.frozen_node_refuse('enrollment_not_prepared','conflict');
      end if;
      v_result := public.arm_frozen_node_runtime(p_alert_id,p_principal,p_predicate,
        p_expected_generation,p_expected_revision,p_expected_intent_revision);
    else
      -- Seal even an absent slot under the SAME lock. This is a fence against
      -- late prepare/arm, not an inference of nonexecution from an absent read.
      v_saved := coalesce(v_saved,v_pin || pg_catalog.jsonb_build_object(
        'preparedAt',public.frozen_node_utc_text(),'phase','prepared','outcome',null::jsonb));
      v_result := public.frozen_node_refuse('enrollment_not_committed','conflict');
    end if;
    v_saved := v_saved || pg_catalog.jsonb_build_object('phase','terminal','outcome',v_result);
    update public.alerts set frozen_enrollment=v_saved where id=p_alert_id and user_id=p_principal;
    return pg_catalog.jsonb_build_object('kind','enrollment','enrollment',v_saved);
  end;
  $attempt$;
  revoke execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid,jsonb)
    from public,anon,authenticated;
  grant execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid,jsonb)
    to service_role;
END $enrollment_attempt_install$;
$enrollment_stage_1$;
  if to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid)') is null
     or to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid,jsonb)') is null
     or to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)') is not null then
    raise exception 'enrollment arm signature readback failed';
  end if;
END $frozen_enrollment_composed$;

-- down:
-- Disable the dormant caller before qualified restoration. Preserve the revision,
-- runtime and exact-attempt envelope, including terminal cancellation tombstones.
-- Never restore a five-argument arm or replay an uncertain operation.
-- readback:
-- select a.attname,a.atttypid::regtype::text,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) as default_expression
--   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
--   where a.attrelid='public.alerts'::regclass and not a.attisdropped
--   and a.attname in ('frozen_intent_revision','frozen_enrollment');
-- select p.proname,p.oid::regprocedure::text,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid)
--   from pg_proc p where p.pronamespace='public'::regnamespace
--   and p.proname in ('arm_frozen_node_runtime','alerts_frozen_runtime_guard','alerts_frozen_enrollment_guard');
-- select p.oid::regprocedure::text,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
--   has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
--   has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
--   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='arm_frozen_node_runtime';
-- select tgname,pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.alerts'::regclass and not tgisinternal;
-- select tablename,policyname,roles,cmd,qual,with_check from pg_policies
--   where schemaname='public' and tablename in ('alerts','alert_runs') order by tablename,policyname;
