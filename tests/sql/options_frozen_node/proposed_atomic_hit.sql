-- UNRESERVED / UNAPPLIED source proposal. No migration number or DB installation.
-- Prerequisites: protected lifecycle proposal, actual0013outbox/0018/0026webhook estate.
-- One atomic statement replaces SAME state-CAS RPC with optional qualified hit;
-- six-argument callers retain null-hit idle semantics. The old signature is removed
-- in this unit, so PostgREST has no ambiguous overload. Never reapply the old
-- lifecycle-only proposal after this upgrade; qualified installation must check
-- exact signatures/ACLs and reload its native schema cache separately.
-- Service-owned producer evidence is as-of evaluation, not a DB-locked entitlement
-- revision. JSON evidence is NOT an action grant. Generic fire stays refused and
-- production publisher None until both email/webhook delivery admission qualify.
-- Applied migration0026 is historical and unchanged: its replacement is only here.
-- No new store, role, endpoint, scheduler or delivery worker.
-- Unknown commit outcomes require explicit SAME-ID read reconciliation, no retry.
do $atomic_frozen_hit$
begin
  if pg_catalog.to_regclass('public.alert_outbox') is null
     or pg_catalog.to_regclass('public.webhook_endpoints') is null
     or pg_catalog.to_regclass('public.webhook_deliveries') is null
     or pg_catalog.to_regclass('public.team_members') is null
     or pg_catalog.to_regclass('public.webhook_alert_optins') is null then
    raise exception 'incumbent outbox/webhook prerequisites unavailable';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where
      tgname='alert_outbox_project_webhooks' and tgrelid='public.alert_outbox'::regclass
      and not tgisinternal and tgenabled in ('O','A')
      and tgfoid='public.project_alert_fire_to_webhooks()'::regprocedure) then
    raise exception 'incumbent webhook projection trigger unavailable';
  end if;
  execute 'drop function if exists public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)';
  execute $commit_ddl$
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
begin

  if current_user <> 'service_role' and not coalesce(
      (select rolsuper from pg_catalog.pg_roles where rolname=current_user),false) then
    return public.frozen_node_refuse('service_role_required');
  end if;
  if p_hit is not null then
    if jsonb_typeof(p_hit) is distinct from 'object' or
       (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(p_hit) k)
       is distinct from array['mode','payload','receipt']::text[] then
      return public.frozen_node_refuse('hit_envelope_shape');
    end if;
    v_mode := p_hit->>'mode'; v_receipt := p_hit->'receipt'; v_payload := p_hit->'payload';
    if v_mode not in ('commit','reconcile') or v_mode is null
       or jsonb_typeof(v_receipt) is distinct from 'object'
       or jsonb_typeof(v_payload) is distinct from 'object' then
      return public.frozen_node_refuse('hit_envelope_shape');
    end if;
    if (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_receipt) k)
       is distinct from array['admission','conditionVersion','evaluationAt','fireEventId','nextState','quote','runtime','schema','vintage']::text[]
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
    select * into v_existing from public.alert_outbox where fire_event_id=v_event;
    if found then
      if v_existing.user_id=p_principal and v_existing.alert_id=p_alert_id and v_existing.payload=v_payload then
        return pg_catalog.jsonb_build_object('kind','already_committed','fireEventId',v_event);
      end if;
      return public.frozen_node_refuse('event_identity_conflict','conflict');
    end if;
    if v_mode='reconcile' then
      return public.frozen_node_refuse('no_committed_receipt');
    end if;
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

  if p_hit is not null then
    select * into v_existing from public.alert_outbox where fire_event_id=v_event;
    if found then
      if v_existing.user_id=p_principal and v_existing.alert_id=p_alert_id and v_existing.payload=v_payload then
        return pg_catalog.jsonb_build_object('kind','already_committed','fireEventId',v_event);
      end if;
      return public.frozen_node_refuse('event_identity_conflict','conflict');
    end if;
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
    insert into public.alert_outbox(user_id,alert_id,fire_event_id,channel,status,payload)
      values(p_principal,p_alert_id,v_event,'email','pending',v_payload)
      on conflict(fire_event_id) do nothing returning id into v_new_id;
    if v_new_id is null then
      select * into v_existing from public.alert_outbox where fire_event_id=v_event;
      if found and v_existing.user_id=p_principal and v_existing.alert_id=p_alert_id and v_existing.payload=v_payload then
        return pg_catalog.jsonb_build_object('kind','already_committed','fireEventId',v_event);
      end if;
      return public.frozen_node_refuse('event_identity_conflict','conflict');
    end if;
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
$commit_ddl$;
  execute 'revoke execute on function public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb) from public,anon,authenticated';
  execute 'grant execute on function public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb) to service_role';
  execute $projection_ddl$
create or replace function public.project_alert_fire_to_webhooks() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare
  v_ep     public.webhook_endpoints%rowtype;
  v_payload jsonb;
begin
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

$projection_ddl$;
  execute 'revoke execute on function public.project_alert_fire_to_webhooks() from public,anon,authenticated';
  execute 'grant execute on function public.project_alert_fire_to_webhooks() to service_role';
end;
$atomic_frozen_hit$;
