-- Dormant initial enrollment on the incumbent owner-RLS alerts row.
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
    v_runtime jsonb;
    v_now text;
  begin
    -- The existing actual service-role boundary is retained. This does not
    -- protect against arbitrary SQL from a compromised trusted service role.
    if current_user <> 'service_role' and not coalesce(
        (select rolsuper from pg_catalog.pg_roles where rolname=current_user),false) then
      return public.frozen_node_refuse('service_role_required');
    end if;
    if jsonb_typeof(p_enrollment) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_enrollment) k)
          is distinct from array['attemptId','lens','operation']::text[]
       or coalesce(p_enrollment->>'attemptId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(p_enrollment->'lens') is distinct from 'object'
       or jsonb_typeof(p_predicate) is distinct from 'object'
       or p_expected_intent_revision is null
       or p_expected_generation is not null or p_expected_revision is not null then
      return public.frozen_node_refuse('invalid_enrollment_request');
    end if;
    v_operation := p_enrollment->>'operation';
    if v_operation is null or v_operation not in ('prepare','arm','reconcile','fence') then
      return public.frozen_node_refuse('invalid_enrollment_operation');
    end if;
    if v_operation='reconcile' then
      -- Snapshot read also works in an actual PostgreSQL READ ONLY transaction.
      -- A concurrently settling prepare/arm may remain UNKNOWN at this snapshot.
      select * into v_row from public.alerts where id=p_alert_id and user_id=p_principal;
    else
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'options_frozen_node:' || p_alert_id::text,0));
      select * into v_row from public.alerts
        where id=p_alert_id and user_id=p_principal for update;
    end if;
    if not found then
      return public.frozen_node_refuse('not_found_or_not_owner');
    end if;
    -- Receipt identity is ORIGINAL intent, not today's mutable condition/token.
    -- Only its current principal may read it. Host admission remains current.
    v_pred := p_predicate - '_fnp' - 'triggered';
    v_pin := pg_catalog.jsonb_build_object(
      'schema','options.frozen_enrollment/v1','attemptId',p_enrollment->>'attemptId',
      'alertId',p_alert_id::text,'principal',p_principal::text,
      'predicate',v_pred,'intentRevision',p_expected_intent_revision::text,
      'lens',p_enrollment->'lens');
    v_saved := v_row.frozen_enrollment;
    if v_saved is not null then
      if jsonb_typeof(v_saved) is distinct from 'object'
         or (v_saved-'preparedAt'-'phase'-'outcome') is distinct from v_pin then
        return public.frozen_node_refuse('enrollment_attempt_conflict','conflict');
      end if;
      if jsonb_typeof(v_saved->'preparedAt') is distinct from 'string'
         or public.frozen_node_parse_tstz(v_saved->>'preparedAt') is null
         or public.frozen_node_parse_tstz(v_saved->>'preparedAt') > pg_catalog.clock_timestamp()
         or coalesce(v_saved->>'phase','') not in ('prepared','terminal')
         or (v_saved->>'phase'='prepared' and v_saved->'outcome' is distinct from 'null'::jsonb)
         or (v_saved->>'phase'='terminal' and jsonb_typeof(v_saved->'outcome') is distinct from 'object') then
        return public.frozen_node_refuse('enrollment_receipt_malformed');
      end if;
    end if;
    if v_operation='reconcile' then
      -- READ ONLY, even if the row has no receipt or a prepare is still in flight.
      -- Absence never proves nonexecution and never reserves/cancels an attempt.
      if v_saved is null then
        return public.frozen_node_refuse('enrollment_not_prepared');
      elsif v_saved->>'phase'='prepared' then
        return pg_catalog.jsonb_build_object('kind','pending','enrollment',v_saved);
      end if;
      -- Return the immutable historical acknowledgment, never the current
      -- runtime. Current generation/active/condition may legitimately differ.
      return pg_catalog.jsonb_build_object('kind','enrollment','enrollment',v_saved);
    end if;
    if v_operation='fence' then
      -- Explicit same-owner closure is safe after a later token/predicate edit:
      -- it grants no arm and can touch ONLY this exact persisted PREPARED pin.
      if v_saved is null then
        return public.frozen_node_refuse('enrollment_not_prepared');
      elsif v_saved->>'phase'='terminal' then
        return pg_catalog.jsonb_build_object('kind','enrollment','enrollment',v_saved);
      end if;
      v_result := public.frozen_node_refuse('enrollment_not_committed','conflict');
      v_saved := v_saved || pg_catalog.jsonb_build_object('phase','terminal','outcome',v_result);
      update public.alerts set frozen_enrollment=v_saved where id=p_alert_id and user_id=p_principal;
      return pg_catalog.jsonb_build_object('kind','enrollment','enrollment',v_saved);
    end if;
    -- PREPARE/ARM require the CURRENT token, active row and predicate.
    if v_row.frozen_intent_revision is distinct from p_expected_intent_revision then
      return public.frozen_node_refuse('stale_intent_revision','conflict');
    end if;
    select s.v_ok,s.v_reason,s.v_pred into v_ok,v_reason,v_pred
      from public.frozen_node_stable(v_row.condition,v_row.active,p_predicate) s;
    if not v_ok then return public.frozen_node_refuse(v_reason); end if;
    if v_saved->>'phase'='terminal' then
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
    if v_saved is null or v_saved->>'phase' is distinct from 'prepared' then
      return public.frozen_node_refuse('enrollment_not_prepared','conflict');
    end if;
      -- Initial arming only. No unreceipted six-argument entry remains callable.
      -- Existing-generation rearm fails closed; state-only generation CAS is unchanged.
      if v_row.frozen_runtime is not null then
        return public.frozen_node_refuse('initial_runtime_present','conflict');
      end if;
      if exists(select 1 from public.alert_outbox where alert_id=p_alert_id and user_id=p_principal
         and status='prepared' and payload->>'category'='options_exposure_node') then
        return public.frozen_node_refuse('unresolved_prepared_intent');
      end if;
      v_now := public.frozen_node_utc_text();
      v_runtime := pg_catalog.jsonb_build_object(
        'schema','options.frozen_runtime/v1','alertId',v_row.id::text,
        'principal',v_row.user_id::text,'generation',pg_catalog.gen_random_uuid()::text,
        'createdAt',v_now,'armingEpoch',v_now,'predicate',v_pred,
        'revision',0,'priorState',null::jsonb);
      v_result := pg_catalog.jsonb_build_object('kind','data','runtime',v_runtime,
        'intentRevision',v_row.frozen_intent_revision::text);
    v_saved := v_saved || pg_catalog.jsonb_build_object('phase','terminal','outcome',v_result);
    -- Original acknowledgment and runtime are committed in ONE row transaction.
    update public.alerts set frozen_enrollment=v_saved,
      frozen_runtime=case when v_operation='arm' then v_runtime else frozen_runtime end
      where id=p_alert_id and user_id=p_principal;
    return pg_catalog.jsonb_build_object('kind','enrollment','enrollment',v_saved);
  end;
  $attempt$;
  revoke execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid,jsonb)
    from public,anon,authenticated;
  grant execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid,jsonb)
    to service_role;
  -- Remove the otherwise callable unreceipted initial-arm bypass atomically.
  drop function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid);
END $enrollment_attempt_install$;
