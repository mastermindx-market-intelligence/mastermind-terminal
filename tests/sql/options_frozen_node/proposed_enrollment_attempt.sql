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
