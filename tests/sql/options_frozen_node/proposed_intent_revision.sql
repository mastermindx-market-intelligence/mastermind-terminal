-- SOURCE PROPOSAL ONLY: UNRESERVED / UNAPPLIED. Never edit or replay merged0045.
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
