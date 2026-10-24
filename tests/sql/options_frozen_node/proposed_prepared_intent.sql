-- UNRESERVED / UNAPPLIED source-only amendment AFTER proposed_lifecycle.sql and
-- proposed_atomic_hit.sql. No namespace reservation, installation or activation.
-- Existing outbox is the durable intent owner; PREPARED/ABANDONED never deliver.
-- prepare ACK precedes publication transport. Restart/read-only reconciliation
-- never retries, expires, fences or assumes absence proves no possible effect.
-- Explicit fence closes only exact persisted PREPARED, retaining its tombstone.
-- Parent run-receipt barrier must additionally retain UNKNOWN PREPARE across restarts.
-- Installed producer/service role remains trusted; receipt JSON is never a grant.
-- One atomic statement, legacy statuses/INSERT fanout/idle CAS preserved.
do $prepared_install$
begin
  if pg_catalog.to_regprocedure('public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb)') is null
     or pg_catalog.to_regclass('public.alert_outbox') is null
     or pg_catalog.to_regclass('public.alert_runs') is null then
    raise exception 'atomic lifecycle prerequisites unavailable';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.alert_outbox'::regclass
                and conname='alert_outbox_status_check' and contype='c') then
    raise exception 'native outbox status constraint unavailable';
  end if;
  alter table public.alert_outbox drop constraint alert_outbox_status_check;
  alter table public.alert_outbox add constraint alert_outbox_status_check
    check(status in ('pending','deferred','sent','failed','suppressed','prepared','abandoned'));
  -- DB-enforced lane exclusion: GET-clear/POST-pending is not itself atomic.
  create unique index if not exists alert_runs_frozen_unresolved_lane
    on public.alert_runs(lane)
    where error_class in ('frozen_publication_pending','frozen_fire_effect_unknown');
  create unique index if not exists alert_outbox_frozen_unsettled_slot
    on public.alert_outbox(alert_id,user_id)
    where status='prepared' and payload->>'category'='options_exposure_node';
  execute $rpc$
create or replace function public.commit_frozen_node_state(
  p_alert_id uuid,
  p_principal uuid,
  p_predicate jsonb,
  p_generation uuid,
  p_revision bigint,
  p_next_state jsonb,
  p_hit jsonb default null)
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
  v_state jsonb;
  v_state_keys int;
  v_epoch_text text;
  v_epoch timestamptz;
  v_last timestamptz;
  v_prior jsonb;
  v_prior_last timestamptz;
  v_within numeric;
  v_expect_within numeric;
  v_receipt jsonb;
  v_payload jsonb;
  v_existing record;
  v_event text;
  v_mode text;
  v_eval timestamptz;
  v_quote timestamptz;
  v_new_id uuid;
  v_key text;
  v_intent_id uuid;
begin

  if current_user <> 'service_role' and not coalesce(
      (select rolsuper from pg_catalog.pg_roles where rolname=current_user),false) then
    return public.frozen_node_refuse('service_role_required');
  end if;
  -- Run exclusion precedes alert exclusion. This also serializes explicit
  -- fences for different alerts in one invocation before its marker is released.
  -- Hashes only serialize; full JSONB/UUID/run-row equality below owns identity.
  if p_hit is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'options_frozen_run:' || pg_catalog.jsonb_build_array(
         p_hit#>>'{receipt,invocation,lane}',p_hit#>>'{receipt,invocation,runId}')::text,0));
  end if;
  -- Serialization only, never identity/authority: full UUID/JSONB checks below.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'options_frozen_node:' || p_alert_id::text, 0));
  -- Same order for prepare/commit/fence: alert exclusion, alert row, intent row.
  -- A missing/reinserted alert does not remove the independently retained intent.
  perform 1 from public.alerts where id=p_alert_id for update;
  if p_hit is not null then
    if jsonb_typeof(p_hit) is distinct from 'object' or
       (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(p_hit) k)
       is distinct from array['mode','payload','receipt']::text[] then
      return public.frozen_node_refuse('hit_envelope_shape');
    end if;
    v_mode := p_hit->>'mode'; v_receipt := p_hit->'receipt'; v_payload := p_hit->'payload';
    if v_mode not in ('prepare','commit','reconcile','fence') or v_mode is null
       or jsonb_typeof(v_receipt) is distinct from 'object'
       or jsonb_typeof(v_payload) is distinct from 'object' then
      return public.frozen_node_refuse('hit_envelope_shape');
    end if;
    if (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_receipt) k)
       is distinct from array['admission','conditionVersion','evaluationAt','fireEventId','invocation','nextState','quote','runtime','schema','vintage']::text[]
       or v_receipt->>'schema' is distinct from 'options.frozen_hit_receipt/v1'
       or not public.frozen_node_runtime_valid(v_receipt->'runtime',p_alert_id,p_principal,p_predicate)
       or p_predicate->>'type' is distinct from 'opt_frozen_node_proximity'
       or v_receipt#>'{runtime,generation}' is distinct from pg_catalog.to_jsonb(p_generation::text)
       or v_receipt#>'{runtime,revision}' is distinct from pg_catalog.to_jsonb(p_revision)
       or v_receipt->'nextState' is distinct from p_next_state
       or jsonb_typeof(v_receipt->'fireEventId') is distinct from 'string'
       or (v_receipt->>'fireEventId') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_receipt->'conditionVersion') is distinct from 'string'
       or (v_receipt->>'conditionVersion') !~ '^[0-9a-f]{16}$'
       or jsonb_typeof(v_receipt->'evaluationAt') is distinct from 'string'
       or jsonb_typeof(v_receipt->'quote') is distinct from 'object' then
      return public.frozen_node_refuse('hit_receipt_binding');
    end if;
    if jsonb_typeof(v_receipt->'invocation') is distinct from 'object' then
      return public.frozen_node_refuse('invocation_shape');
    end if;
    if (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_receipt->'invocation') k)
       is distinct from array['lane','runId']::text[]
       or jsonb_typeof(v_receipt#>'{invocation,lane}') is distinct from 'string'
       or jsonb_typeof(v_receipt#>'{invocation,runId}') is distinct from 'string'
       or length(v_receipt#>>'{invocation,lane}') not between 1 and 128
       or length(v_receipt#>>'{invocation,runId}') not between 1 and 128 then
      return public.frozen_node_refuse('invocation_shape');
    end if;
    if (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_receipt->'quote') k)
       is distinct from array['asof','basis','spot']::text[]
       or jsonb_typeof(v_receipt#>'{quote,asof}') is distinct from 'string'
       or jsonb_typeof(v_receipt#>'{quote,basis}') is distinct from 'string'
       or jsonb_typeof(v_receipt#>'{quote,spot}') is distinct from 'number'
       or (v_receipt#>>'{quote,spot}')::numeric <= 0 then
      return public.frozen_node_refuse('hit_quote_binding');
    end if;
    v_eval := public.frozen_node_parse_tstz(v_receipt->>'evaluationAt');
    v_quote := public.frozen_node_parse_tstz(v_receipt#>>'{quote,asof}');
    if v_eval is null or v_quote is null or v_quote > v_eval
       or v_eval > pg_catalog.clock_timestamp()
       or public.frozen_node_parse_tstz(p_next_state->>'lastQuoteAt') is distinct from v_quote
       or p_next_state->>'lastQuoteBasis' is distinct from btrim(v_receipt#>>'{quote,basis}')
       or v_receipt->>'vintage' is distinct from pg_catalog.to_char(v_quote at time zone 'UTC','YYYY-MM-DD"T"HH24:MI"Z"') then
      return public.frozen_node_refuse('hit_quote_clock');
    end if;
    if v_receipt->'admission' is distinct from pg_catalog.jsonb_build_object(
        'principal',p_principal::text,'action','frozen_node_proximity',
        'evaluationAt',v_receipt->'evaluationAt','target',p_predicate->'target',
        'rights',pg_catalog.jsonb_build_object('allowed',true,'policy_version','options.frozen_node_proximity/account/v1','checked_at',v_receipt->'evaluationAt'),
        'rights_decision_ref','DEC:COMMERCIAL-DATA-RIGHTS-CHAIRMAN-ATTESTATION-20261023',
        'createdAt',v_receipt#>'{runtime,createdAt}','armingEpoch',v_receipt#>'{runtime,armingEpoch}',
        'priorState',v_receipt#>'{runtime,priorState}') then
      return public.frozen_node_refuse('hit_admission_binding');
    end if;
    if (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_payload) k)
       is distinct from array['category','condition_plain','condition_plain_zh','evidence_url','fired_at','frozen_node','requires_tier','subject','subject_zh','summary_plain','summary_plain_zh','ticker','value']::text[]
       or v_payload->>'category' is distinct from 'options_exposure_node'
       or v_payload->>'requires_tier' is distinct from 'essential'
       or v_payload->'value' is distinct from v_receipt#>'{quote,spot}'
       or v_payload->'fired_at' is distinct from v_receipt->'evaluationAt'
       or v_payload->>'ticker' is distinct from p_predicate->>'root'
       or v_payload->>'ticker' is distinct from p_predicate#>>'{target,root}'
       or v_payload->>'evidence_url' is distinct from '/alerts'
       or v_payload->'frozen_node' is distinct from pg_catalog.jsonb_build_object(
          'target',p_predicate->'target','within_pct',p_next_state->'withinPct',
          'quote',pg_catalog.jsonb_build_object('asof',p_next_state->'lastQuoteAt','basis',p_next_state->'lastQuoteBasis'),
          'publication_receipt',v_receipt) then
      return public.frozen_node_refuse('hit_payload_binding');
    end if;
    foreach v_key in array array['subject','subject_zh','summary_plain','summary_plain_zh','condition_plain','condition_plain_zh'] loop
      if jsonb_typeof(v_payload->v_key) is distinct from 'string' or btrim(v_payload->>v_key) = '' then
        return public.frozen_node_refuse('hit_payload_prose');
      end if;
    end loop;
    v_event := v_receipt->>'fireEventId';
    select * into v_existing from public.alert_outbox where fire_event_id=v_event for update;
    if found then
      if v_existing.user_id is distinct from p_principal or v_existing.alert_id is distinct from p_alert_id
         or v_existing.payload is distinct from v_payload then
        return public.frozen_node_refuse('event_identity_conflict','conflict');
      end if;
      if v_existing.status='abandoned' then
        if v_mode='reconcile' then
          return pg_catalog.jsonb_build_object('kind','abandoned','fireEventId',v_event);
        end if;
        return public.frozen_node_refuse('prepared_intent_fenced','conflict');
      end if;
      if v_existing.status <> 'prepared' then
        return pg_catalog.jsonb_build_object('kind','already_committed','fireEventId',v_event);
      end if;
      if v_mode='fence' then
        -- Explicit exact PREPARED retirement only. Never create a tombstone on absence.
        update public.alert_outbox set status='abandoned'
          where id=v_existing.id and status='prepared' and payload=v_payload;
        if not found then raise exception 'prepared fence lost'; end if;
        -- Close this exact old generation so a delayed prepare with a new minute
        -- cannot reuse it. Never invalidate a replacement/new-generation runtime.
        update public.alerts set frozen_runtime=null
          where id=p_alert_id and user_id=p_principal
            and frozen_runtime=v_receipt->'runtime';
        -- Release only this actual run's operational barrier, and only when
        -- every persisted prepared intent in it has been explicitly fenced.
        -- No absent-intent run reset; read-only reconciliation never writes it.
        update public.alert_runs set error_class='frozen_publication_fenced'
          where lane=v_receipt#>>'{invocation,lane}' and run_id=v_receipt#>>'{invocation,runId}'
            and error_class in ('frozen_publication_pending','frozen_fire_effect_unknown')
            and not exists(select 1 from public.alert_outbox o where o.status='prepared'
                and o.payload#>'{frozen_node,publication_receipt,invocation}'=v_receipt->'invocation');
        return pg_catalog.jsonb_build_object('kind','abandoned','fireEventId',v_event);
      end if;
      if v_mode in ('prepare','reconcile') then
        return pg_catalog.jsonb_build_object('kind','unsettled','fireEventId',v_event,
                                             'receipt',v_receipt);
      end if;
      v_intent_id := v_existing.id;
    elsif v_mode <> 'prepare' then
      -- Absence is not proof a request cannot still arrive. No placeholder/reset.
      return public.frozen_node_refuse('prepared_intent_unavailable');
    end if;
  end if;
  if p_hit is not null and not exists(select 1 from public.alert_runs
      where lane=v_receipt#>>'{invocation,lane}' and run_id=v_receipt#>>'{invocation,runId}'
        and error_class in ('frozen_publication_pending','frozen_fire_effect_unknown')
        and started_at <= public.frozen_node_parse_tstz(v_receipt->>'evaluationAt')) then
    return public.frozen_node_refuse('durable_publication_run_unavailable');
  end if;
  if exists (select 1 from public.alert_outbox where alert_id=p_alert_id and user_id=p_principal
       and status='prepared' and payload->>'category'='options_exposure_node'
       and (v_intent_id is null or id<>v_intent_id)) then
    return public.frozen_node_refuse('unresolved_prepared_intent');
  end if;
  if jsonb_typeof(p_next_state) is distinct from 'object' then
    return public.frozen_node_refuse('state_not_object');
  end if;

  -- Exact key set: every key known, no key missing, none extra.
  select
      (select count(*) from pg_catalog.jsonb_object_keys(p_next_state) k
        where k not in (select e from pg_catalog.jsonb_array_elements_text(
                          '["targetFingerprint","armingEpoch","lastQuoteAt","inside","withinPct","lastQuoteBasis"]'::jsonb) e))
    + (select count(*) from pg_catalog.jsonb_array_elements_text(
                          '["targetFingerprint","armingEpoch","lastQuoteAt","inside","withinPct","lastQuoteBasis"]'::jsonb) e
        where e not in (select k from pg_catalog.jsonb_object_keys(p_next_state) k))
    into v_state_keys;
  if v_state_keys <> 0 or (select count(*) from pg_catalog.jsonb_object_keys(p_next_state)) <> 6 then
    return public.frozen_node_refuse('state_keys_invalid');
  end if;

  v_state := p_next_state;
  if jsonb_typeof(v_state -> 'targetFingerprint') is distinct from 'string'
     or btrim(v_state ->> 'targetFingerprint') = '' then
    return public.frozen_node_refuse('state_target_fingerprint');
  end if;
  if jsonb_typeof(v_state -> 'lastQuoteBasis') is distinct from 'string'
     or btrim(v_state ->> 'lastQuoteBasis') = '' then
    return public.frozen_node_refuse('state_last_quote_basis');
  end if;
  if jsonb_typeof(v_state -> 'inside') is distinct from 'boolean' then
    return public.frozen_node_refuse('state_inside_not_boolean');
  end if;
  if jsonb_typeof(v_state -> 'withinPct') is distinct from 'number' then
    return public.frozen_node_refuse('state_within_pct_not_number');
  end if;
  v_within := (v_state ->> 'withinPct')::numeric;
  if v_within < 0 then
    return public.frozen_node_refuse('state_within_pct_negative');
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


  select s.v_ok, s.v_reason, s.v_pred
    into v_ok, v_reason, v_pred
    from public.frozen_node_stable(v_row.condition, v_row.active, p_predicate) s;
  if not v_ok then
    return public.frozen_node_refuse(v_reason);
  end if;

  v_runtime := v_row.frozen_runtime;
  if v_runtime is null then
    return public.frozen_node_refuse('no_runtime');
  end if;
  if not public.frozen_node_runtime_valid(v_runtime, v_row.id, v_row.user_id, v_pred) then
    return public.frozen_node_refuse('runtime_malformed');
  end if;
  if p_generation is null
     or p_revision is null
     or p_generation::text is distinct from (v_runtime ->> 'generation')
     or p_revision::numeric is distinct from (v_runtime ->> 'revision')::numeric then
    return public.frozen_node_refuse('stale_generation_or_revision', 'conflict');
  end if;

  -- armingEpoch must be the aware ISO echo of this generation's runtime epoch.
  v_epoch_text := v_runtime ->> 'armingEpoch';
  if coalesce(v_state ->> 'armingEpoch', '') is distinct from v_epoch_text then
    return public.frozen_node_refuse('state_arming_epoch_mismatch');
  end if;
  v_epoch := public.frozen_node_parse_tstz(v_epoch_text);
  if v_epoch is null then
    return public.frozen_node_refuse('runtime_malformed');
  end if;

  -- lastQuoteAt: aware ISO, strictly after the arming epoch, not ahead of the
  -- actual DB clock, and strictly after the prior state's lastQuoteAt.
  if jsonb_typeof(v_state -> 'lastQuoteAt') is distinct from 'string' then
    return public.frozen_node_refuse('state_last_quote_at_malformed');
  end if;
  v_last := public.frozen_node_parse_tstz(v_state ->> 'lastQuoteAt');
  if v_last is null then
    return public.frozen_node_refuse('state_last_quote_at_malformed');
  end if;
  if not v_last > v_epoch then
    return public.frozen_node_refuse('state_last_quote_at_not_after_epoch');
  end if;
  if v_last > pg_catalog.clock_timestamp() then
    return public.frozen_node_refuse('state_last_quote_at_in_future');
  end if;
  v_prior := v_runtime -> 'priorState';
  if jsonb_typeof(v_prior) = 'object' then
    if v_state -> 'targetFingerprint' is distinct from v_prior -> 'targetFingerprint' then
      return public.frozen_node_refuse('state_target_fingerprint_mismatch');
    end if;
    v_prior_last := public.frozen_node_parse_tstz(v_prior ->> 'lastQuoteAt');
    if v_prior_last is null or not v_last > v_prior_last then
      return public.frozen_node_refuse('state_last_quote_at_not_after_prior');
    end if;
  end if;

  -- withinPct must equal the predicate's within_pct, else the incumbent 0.25 default.
  v_expect_within := case when v_pred ? 'within_pct'
                          then (v_pred ->> 'within_pct')::numeric
                          else 0.25 end;
  if v_within is distinct from v_expect_within then
    return public.frozen_node_refuse('state_within_pct_mismatch');
  end if;

  if p_revision = 9223372036854775807 then
    return public.frozen_node_refuse('revision_exhausted');
  end if;

  if p_hit is not null then
    if v_receipt->'runtime' is distinct from v_runtime
       or jsonb_typeof(v_prior) is distinct from 'object'
       or v_prior->'inside' is distinct from 'false'::jsonb
       or v_state->'inside' is distinct from 'true'::jsonb then
      return public.frozen_node_refuse('hit_not_qualified_transition');
    end if;
    if v_mode='prepare' then
      insert into public.alert_outbox(user_id,alert_id,fire_event_id,channel,status,payload)
        values(p_principal,p_alert_id,v_event,'email','prepared',v_payload)
        on conflict(fire_event_id) do nothing returning id into v_new_id;
      if v_new_id is null then
        return public.frozen_node_refuse('event_identity_conflict','conflict');
      end if;
      return pg_catalog.jsonb_build_object('kind','prepared','fireEventId',v_event,
                                           'receipt',v_receipt);
    end if;
    if v_mode <> 'commit' or v_intent_id is null then
      return public.frozen_node_refuse('prepared_intent_unavailable');
    end if;
    update public.alert_outbox set status='pending'
      where id=v_intent_id and status='prepared' and payload=v_payload returning id into v_new_id;
    if v_new_id is null then raise exception 'prepared publication lost'; end if;
    update public.alerts set active=false,
      condition=(v_row.condition - '_fnp') || pg_catalog.jsonb_build_object('triggered',
        pg_catalog.jsonb_build_object('at',v_receipt->'evaluationAt','value',v_receipt#>'{quote,spot}',
          'note','Frozen selected node sampled proximity','fire_event_id',v_event))
      where id=p_alert_id and user_id=p_principal and active=true and frozen_runtime=v_runtime;
    if not found then raise exception 'atomic frozen disarm lost'; end if;
    return pg_catalog.jsonb_build_object('kind','committed','fireEventId',v_event);
  end if;

  -- Atomic state commit: same generation lifecycle, revision + 1, priorState kept.
  v_runtime := pg_catalog.jsonb_build_object(
    'schema',      v_runtime -> 'schema',
    'alertId',     v_runtime -> 'alertId',
    'principal',   v_runtime -> 'principal',
    'generation',  v_runtime -> 'generation',
    'createdAt',   v_runtime -> 'createdAt',
    'armingEpoch', v_runtime -> 'armingEpoch',
    'predicate',   v_runtime -> 'predicate',
    'revision',    (v_runtime ->> 'revision')::bigint + 1,
    'priorState',  v_state);

  update public.alerts
     set frozen_runtime = v_runtime
   where id = v_row.id
     and user_id = v_row.user_id;
  if not found then
    return public.frozen_node_refuse('commit_write_lost');
  end if;
  return pg_catalog.jsonb_build_object('kind', 'data', 'runtime', v_runtime);
exception when others then
  -- This exception subtransaction rolls back outbox, disarm and webhook writes.
  return public.frozen_node_refuse('atomic_hit_write_unavailable');
end;
$fn$;
$rpc$;
  execute $readarm$
create or replace function public.read_frozen_node_runtime(
  p_alert_id uuid,
  p_principal uuid,
  p_predicate jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_row public.alerts;
  v_ok boolean;
  v_reason text;
  v_pred jsonb;
  v_runtime jsonb;
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
  select * into v_row
    from public.alerts
   where id = p_alert_id
     and user_id = p_principal;
  if not found then
    return public.frozen_node_refuse('not_found_or_not_owner');
  end if;

  select s.v_ok, s.v_reason, s.v_pred
    into v_ok, v_reason, v_pred
    from public.frozen_node_stable(v_row.condition, v_row.active, p_predicate) s;
  if not v_ok then
    return public.frozen_node_refuse(v_reason);
  end if;

  v_runtime := v_row.frozen_runtime;
  if v_runtime is null then
    return public.frozen_node_refuse('no_runtime');
  end if;
  if not public.frozen_node_runtime_valid(v_runtime, v_row.id, v_row.user_id, v_pred) then
    return public.frozen_node_refuse('runtime_malformed');
  end if;
  return pg_catalog.jsonb_build_object('kind', 'data', 'runtime', v_runtime);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. RPC: arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)
-- Initial (NULL runtime) arming requires NULL expected generation AND revision.
-- Rearm requires BOTH exact old values. Success stores a fresh DB UUID generation
-- and fresh clock_timestamp() server time for createdAt AND armingEpoch, sets
-- revision 0 and priorState NULL, and never toggles active and never grants action.
-- ---------------------------------------------------------------------------
create or replace function public.arm_frozen_node_runtime(
  p_alert_id uuid,
  p_principal uuid,
  p_predicate jsonb,
  p_expected_generation uuid,
  p_expected_revision bigint)
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
  return pg_catalog.jsonb_build_object('kind', 'data', 'runtime', v_runtime);
end;
$fn$;


$readarm$;
  execute $projection$
create or replace function public.project_alert_fire_to_webhooks() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare
  v_ep     public.webhook_endpoints%rowtype;
  v_payload jsonb;
begin
  if new.payload->>'category'='options_exposure_node' then
    if TG_OP <> 'UPDATE' then return new; end if;
    if old.status <> 'prepared' or new.status <> 'pending' then return new; end if;
    if new.payload is distinct from old.payload or new.user_id is distinct from old.user_id
       or new.alert_id is distinct from old.alert_id or new.fire_event_id is distinct from old.fire_event_id then
      raise exception 'frozen publication identity changed';
    end if;
  elsif TG_OP <> 'INSERT' then
    return new;
  end if;
  -- Build the per-delivery base payload (everything except team_id, which depends on the
  -- matched endpoint — alerts are PERSONAL per 0001 / R2 and can fan out to multiple teams).
  -- Payload keys mirror alert_outbox.payload, plus a schema tag the receiver dispatches on
  -- (mastermind.alert-fired/v1). event_id equals fire_event_id so Mastermind-Webhook-Event-Id
  -- IS the fire id (R5).
  v_payload := jsonb_build_object(
    'schema',            'mastermind.alert-fired/v1',
    'fire_event_id',     new.fire_event_id,
    'alert_id',          new.alert_id,
    'user_id',           new.user_id,
    'fired_at',          coalesce(new.payload->>'fired_at', ''),
    'ticker',            coalesce(new.payload->>'ticker', ''),
    'subject',           coalesce(new.payload->>'subject', ''),
    'subject_zh',        coalesce(new.payload->>'subject_zh', ''),
    'summary_plain',     coalesce(new.payload->>'summary_plain', ''),
    'summary_plain_zh',  coalesce(new.payload->>'summary_plain_zh', ''),
    'condition_plain',   coalesce(new.payload->>'condition_plain', ''),
    'condition_plain_zh',coalesce(new.payload->>'condition_plain_zh', ''),
    'value',             coalesce(new.payload->>'value', ''),
    'evidence_url',      coalesce(new.payload->>'evidence_url', '')
  );

  if new.payload->>'category' = 'options_exposure_node' then
    v_payload := v_payload || jsonb_build_object(
      'category',new.payload->'category','requires_tier',new.payload->'requires_tier',
      'frozen_node',new.payload->'frozen_node');
  end if;

  -- One INSERT per matching endpoint. R2's four gates: endpoint enabled, event_filter
  -- contains 'alert.fired', firing user is a current team_member, firing user has opted in.
  -- alert_outbox has NO team_id column (alerts are personal per 0001 / R2), so team_id in the
  -- payload is taken from the matched endpoint's row, not from new.payload.
  for v_ep in
    select e.*
      from public.webhook_endpoints e
     where e.enabled = true
       and 'alert.fired' = any(e.event_filter)
       and exists (
         select 1 from public.team_members m
          where m.team_id = e.team_id and m.user_id = new.user_id
       )
       and exists (
         select 1 from public.webhook_alert_optins o
          where o.team_id = e.team_id and o.user_id = new.user_id and o.enabled = true
       )
  loop
    insert into public.webhook_deliveries
      (endpoint_id, team_id, event_id, event_type, payload)
    values
      (v_ep.id, v_ep.team_id, new.fire_event_id, 'alert.fired',
       v_payload || jsonb_build_object('team_id', v_ep.team_id::text))
    on conflict (dedupe_key) do nothing;
  end loop;

  return new;
exception when others then
  -- A qualified frozen publication is all-or-nothing, including fanout.
  if new.payload->>'category' = 'options_exposure_node' then raise; end if;
  -- Never fail the outbox insert; the warning shows up in pg logs for the seat's readback.
  raise warning 'project_alert_fire_to_webhooks: % (fire_event_id=%)', SQLERRM, new.fire_event_id;
  return new;
end $$;

$projection$;
  execute 'revoke execute on function public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb) from public,anon,authenticated';
  execute 'grant execute on function public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb) to service_role';
  execute 'revoke execute on function public.read_frozen_node_runtime(uuid,uuid,jsonb) from public,anon,authenticated';
  execute 'grant execute on function public.read_frozen_node_runtime(uuid,uuid,jsonb) to service_role';
  execute 'revoke execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint) from public,anon,authenticated';
  execute 'grant execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint) to service_role';
  execute 'revoke execute on function public.project_alert_fire_to_webhooks() from public,anon,authenticated';
  execute 'grant execute on function public.project_alert_fire_to_webhooks() to service_role';
  execute $run_guard$
create or replace function public.frozen_publication_run_guard() returns trigger
language plpgsql security invoker set search_path='' as $body$
begin
  -- Terminal counters remain writable. Late conclude cannot resurrect a fenced
  -- intent or clear an already-unknown publication from an ordinary callback.
  if old.error_class='frozen_publication_fenced' then
    new.error_class := old.error_class;
  elsif old.error_class='frozen_fire_effect_unknown'
        and new.error_class is distinct from 'frozen_publication_fenced' then
    new.error_class := old.error_class;
  end if;
  return new;
end;
$body$;
$run_guard$;
  execute 'revoke execute on function public.frozen_publication_run_guard() from public,anon,authenticated';
  execute 'grant execute on function public.frozen_publication_run_guard() to service_role';
  drop trigger if exists frozen_publication_run_guard on public.alert_runs;
  create trigger frozen_publication_run_guard before update of error_class on public.alert_runs
    for each row execute function public.frozen_publication_run_guard();
  drop trigger if exists alert_outbox_project_webhooks on public.alert_outbox;
  create trigger alert_outbox_project_webhooks after insert or update of status on public.alert_outbox
    for each row execute function public.project_alert_fire_to_webhooks();
end;
$prepared_install$;
