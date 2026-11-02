-- proposed_lifecycle.sql — protected frozen Options lifecycle/state CAS for public.alerts
-- Proposed source, UNRESERVED/UNAPPLIED: no migration id, no migration ledger row, no
-- provisioning call. The parent owns placement, migration numbering and integration.
--
-- Scope: this file ONLY
--   1. adds ONE nullable jsonb column public.alerts.frozen_runtime (legacy rows => NULL,
--      legacy types/ACL/RLS untouched);
--   2. installs three fixed-search-path SECURITY INVOKER RPCs:
--        public.read_frozen_node_runtime(uuid,uuid,jsonb)
--        public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)
--        public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)
--      with EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role
--      (actual SQL role, never a caller-set JWT role claim);
--   3. installs an invoker-side BEFORE INSERT/UPDATE guard trigger on public.alerts that
--      rejects non-privileged writes of the protected runtime and invalidates the runtime
--      (to NULL) whenever a mutation touches a protected source column.
-- It creates NO table, store, registry, outbox, webhook fan-out or action grant. The
-- engine's generic service-role update_condition PATCH and the outbox-before-active-PATCH
-- fire path remain owned separately by the parent; no arm toggles active and no commit
-- fires, disarms or emits outbox rows.
--
-- Runtime document (exact keys, schema options.frozen_runtime/v1):
--   {"schema","alertId","principal","generation","createdAt","armingEpoch",
--    "predicate","revision","priorState"}
-- createdAt/armingEpoch are server clocks (UTC ISO, six fractional digits, Z), taken at
-- arm time from clock_timestamp(), never from row.created_at or any caller timestamp.
-- The stable predicate is condition minus ONLY the keys '_fnp' and 'triggered', compared
-- as full jsonb equality (no hash). priorState is the last committed state, NULL at arm.
--
-- Down (manual, ordered; parent decides if/when):
--   drop trigger if exists alerts_frozen_runtime_guard on public.alerts;
--   drop function if exists public.alerts_frozen_runtime_guard();
--   drop function if exists public.read_frozen_node_runtime(uuid,uuid,jsonb);
--   drop function if exists public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint);
--   drop function if exists public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb);
--   drop function if exists public.frozen_node_runtime_valid(jsonb,uuid,uuid,jsonb);
--   drop function if exists public.frozen_node_stable(jsonb,boolean,jsonb);
--   drop function if exists public.frozen_node_refuse(text,text);
--   drop function if exists public.frozen_node_utc_text();
--   drop function if exists public.frozen_node_parse_tstz(text);
--   alter table public.alerts drop column if exists frozen_runtime;
-- Readback after apply:
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--     where table_schema='public' and table_name='alerts' and column_name='frozen_runtime';
--   select p.proname, p.prosecdef, p.proacl from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and
--      (p.proname like 'frozen\_node\_%' or p.proname in
--       ('read_frozen_node_runtime','arm_frozen_node_runtime',
--        'commit_frozen_node_state','alerts_frozen_runtime_guard'))
--    order by p.proname;
--   select tgname, tgenabled, pg_catalog.pg_get_triggerdef(oid) from pg_catalog.pg_trigger
--     where tgrelid='public.alerts'::regclass and not tgisinternal;
-- Rerunnable: every statement is create-or-replace / if-exists guarded and no statement
-- touches stored rows, so re-applying preserves an existing frozen_runtime verbatim.
-- Installation is ONE DO statement, including CREATE and final REVOKE/GRANT.
-- scripts/supabase_apply.py sends one top-level statement per request; a file-level
-- BEGIN/COMMIT wrapper would not be atomic there. This unit follows migration 0038.
-- Namespace reservation, installer admission/readback and target qualification remain
-- required before any later promotion/application; this proposal grants none of them.

-- ---------------------------------------------------------------------------
-- 1. The single protected column
-- ---------------------------------------------------------------------------
do $frozen_lifecycle$
begin
alter table public.alerts add column if not exists frozen_runtime jsonb;

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (EXECUTE revoked from unprivileged roles; only the RPCs
--    below call them, so service_role needs EXECUTE because functions run with
--    invoker privilege checks at every call)
-- ---------------------------------------------------------------------------

-- Strip the two non-stable keys and hold the resulting full predicate. No hashing.
create or replace function public.frozen_node_stable(
  p_condition jsonb,
  p_active boolean,
  p_predicate jsonb,
  out v_ok boolean,
  out v_reason text,
  out v_pred jsonb)
returns record
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  v_ok := false;
  v_reason := 'unavailable';
  v_pred := null;
  if jsonb_typeof(p_predicate) is distinct from 'object' then
    v_reason := 'predicate_not_object';
    return;
  end if;
  v_pred := p_predicate - '_fnp' - 'triggered';
  if jsonb_typeof(p_condition) is distinct from 'object' then
    v_reason := 'not_frozen_type';
    return;
  end if;
  if p_condition ->> 'type' is distinct from 'opt_frozen_node_proximity' then
    v_reason := 'not_frozen_type';
    return;
  end if;
  if p_active is not true then
    v_reason := 'inactive';
    return;
  end if;
  if (p_condition - '_fnp' - 'triggered') is distinct from v_pred then
    v_reason := 'predicate_mismatch';
    return;
  end if;
  if v_pred ? 'within_pct' then
    if jsonb_typeof(v_pred -> 'within_pct') is distinct from 'number' then
      v_reason := 'predicate_within_pct';
      return;
    end if;
    if (v_pred ->> 'within_pct')::numeric < 0 then
      v_reason := 'predicate_within_pct';
      return;
    end if;
  end if;
  v_ok := true;
  v_reason := null;
end;
$fn$;

-- Typed refusal envelope. p_kind is 'unavailable' for refusals and 'conflict' for a
-- CAS loser (stale generation/revision identity).
create or replace function public.frozen_node_refuse(p_reason text, p_kind text default 'unavailable')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('kind', p_kind, 'reason', p_reason);
$fn$;

-- Server clock text: UTC ISO with six fractional digits and Z.
create or replace function public.frozen_node_utc_text()
returns text
language sql
volatile
security invoker
set search_path = ''
as $fn$
  select pg_catalog.to_char(
    pg_catalog.clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$fn$;

-- Malformed-time-safe parse: NULL instead of an uncaught cast error.
create or replace function public.frozen_node_parse_tstz(p_text text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = ''
as $fn$
begin
  -- Incumbent core domain: explicit-zone ISO, real calendar, finite, <=microseconds.
  -- Reject session-dependent naive/relative text, infinity, JSON text coercion and controls.
  if p_text is null or p_text ~ '[[:space:]]'
     or p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
    return null;
  end if;
  return p_text::timestamptz;
exception
  when others then
    return null;
end;
$fn$;

-- Validate a stored v1 record independently of a copied row or malformed service output.
create or replace function public.frozen_node_runtime_valid(
  p_runtime jsonb, p_alert uuid, p_principal uuid, p_predicate jsonb)
returns boolean language plpgsql volatile security invoker set search_path = '' as $fn$
declare
  v_revision bigint;
  v_epoch timestamptz;
  v_created timestamptz;
  v_prior jsonb;
  v_last timestamptz;
  v_within numeric;
begin
  if jsonb_typeof(p_runtime) is distinct from 'object' then return false; end if;
  if (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(p_runtime) k)
     is distinct from array['alertId','armingEpoch','createdAt','generation','predicate','principal','priorState','revision','schema']::text[]
     or p_runtime ->> 'schema' is distinct from 'options.frozen_runtime/v1'
     or p_runtime -> 'alertId' is distinct from pg_catalog.to_jsonb(p_alert::text)
     or p_runtime -> 'principal' is distinct from pg_catalog.to_jsonb(p_principal::text)
     or p_runtime -> 'predicate' is distinct from p_predicate
     or jsonb_typeof(p_runtime -> 'generation') is distinct from 'string'
     or (p_runtime ->> 'generation') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_runtime -> 'revision') is distinct from 'number'
     or (p_runtime ->> 'revision') !~ '^[0-9]+$'
     or jsonb_typeof(p_runtime -> 'createdAt') is distinct from 'string'
     or jsonb_typeof(p_runtime -> 'armingEpoch') is distinct from 'string' then return false; end if;
  v_revision := (p_runtime ->> 'revision')::bigint;
  if v_revision < 0 then return false; end if;
  v_created := public.frozen_node_parse_tstz(p_runtime ->> 'createdAt');
  v_epoch := public.frozen_node_parse_tstz(p_runtime ->> 'armingEpoch');
  if v_created is null or v_epoch is null or v_created <> v_epoch
     or v_epoch > pg_catalog.clock_timestamp() then return false; end if;
  v_prior := p_runtime -> 'priorState';
  if v_revision = 0 then return jsonb_typeof(v_prior) = 'null'; end if;
  if jsonb_typeof(v_prior) is distinct from 'object' then return false; end if;
  if (select array_agg(k order by k collate "C") from pg_catalog.jsonb_object_keys(v_prior) k)
     is distinct from array['armingEpoch','inside','lastQuoteAt','lastQuoteBasis','targetFingerprint','withinPct']::text[]
     or jsonb_typeof(v_prior -> 'targetFingerprint') is distinct from 'string'
     or (v_prior ->> 'targetFingerprint') !~ '[^[:space:]]'
     or jsonb_typeof(v_prior -> 'inside') is distinct from 'boolean'
     or jsonb_typeof(v_prior -> 'lastQuoteBasis') is distinct from 'string'
     or (v_prior ->> 'lastQuoteBasis') !~ '[^[:space:]]'
     or jsonb_typeof(v_prior -> 'lastQuoteAt') is distinct from 'string'
     or jsonb_typeof(v_prior -> 'armingEpoch') is distinct from 'string'
     or jsonb_typeof(v_prior -> 'withinPct') is distinct from 'number' then return false; end if;
  if public.frozen_node_parse_tstz(v_prior ->> 'armingEpoch') is distinct from v_epoch then return false; end if;
  v_last := public.frozen_node_parse_tstz(v_prior ->> 'lastQuoteAt');
  v_within := case when p_predicate ? 'within_pct' then (p_predicate ->> 'within_pct')::numeric else 0.25 end;
  return v_last is not null and v_last > v_epoch and v_last <= pg_catalog.clock_timestamp()
    and (v_prior ->> 'withinPct')::numeric = v_within;
exception when others then return false;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Guard trigger (SECURITY INVOKER on purpose: attestation follows the actual
--    SQL role, so a caller-set JWT role claim can never forge or preserve the
--    protected runtime)
-- ---------------------------------------------------------------------------
create or replace function public.alerts_frozen_runtime_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_privileged boolean;
  v_protected_changed boolean;
begin
  v_privileged := current_user = 'service_role'
    or coalesce(
      (select p.rolsuper from pg_catalog.pg_roles p where p.rolname = current_user),
      false);

  if tg_op = 'INSERT' then
    if new.frozen_runtime is not null and not v_privileged then
      raise exception 'frozen_runtime is protected: forged runtime insert refused';
    end if;
    return new;
  end if;

  -- UPDATE: reject any non-privileged write of the protected column, including a
  -- copy of the old record onto a row whose runtime is NULL. An unchanged carried
  -- value is not a write and falls through to the invalidation rule below.
  if new.frozen_runtime is distinct from old.frozen_runtime and not v_privileged then
    raise exception 'frozen_runtime is protected: direct mutation refused';
  end if;

  -- Any mutation of a frozen row's protected source columns invalidates the runtime
  -- to NULL. This applies to owners and service alike, and it wins over a runtime
  -- value set in the same statement: ordinary row mutation without a corresponding
  -- sanctioned new runtime never keeps authority and never auto-arms.
  v_protected_changed :=
    new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.symbol is distinct from old.symbol
    or new.condition is distinct from old.condition
    or new.active is distinct from old.active
    or new.created_at is distinct from old.created_at;
  if v_protected_changed then
    new.frozen_runtime := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists alerts_frozen_runtime_guard on public.alerts;
create trigger alerts_frozen_runtime_guard
  before insert or update on public.alerts
  for each row execute function public.alerts_frozen_runtime_guard();

-- ---------------------------------------------------------------------------
-- 4. RPC: read_frozen_node_runtime(uuid,uuid,jsonb)
-- Same exact identity/predicate/active checks as arm; returns the stored runtime
-- verbatim when it matches, else a typed refusal.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6. RPC: commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)
-- Validates nextState EXACTLY (no null/excess/unknown keys, no booleans or numeric
-- strings standing in as numbers, no malformed times), CASes by the full stable
-- predicate + generation + revision, then atomically increments revision and
-- stores priorState. No outbox row, no fire, no disarm, no active toggle. The
-- targetFingerprint is opaque here: the parent adapter computes/checks it against
-- the full predicate; this SQL keeps the full predicate independently.
-- ---------------------------------------------------------------------------
create or replace function public.commit_frozen_node_state(
  p_alert_id uuid,
  p_principal uuid,
  p_predicate jsonb,
  p_generation uuid,
  p_revision bigint,
  p_next_state jsonb)
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
begin
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
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: actual SQL role controls privileged attestation. No JWT role
-- claim, no anon/authenticated path, no PUBLIC default.
-- ---------------------------------------------------------------------------
revoke execute on function public.read_frozen_node_runtime(uuid,uuid,jsonb)
  from public, anon, authenticated;
revoke execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)
  from public, anon, authenticated;
revoke execute on function public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.read_frozen_node_runtime(uuid,uuid,jsonb) to service_role;
grant execute on function public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint) to service_role;
grant execute on function public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb) to service_role;

revoke execute on function public.frozen_node_stable(jsonb,boolean,jsonb) from public, anon, authenticated;
revoke execute on function public.frozen_node_refuse(text,text) from public, anon, authenticated;
revoke execute on function public.frozen_node_utc_text() from public, anon, authenticated;
revoke execute on function public.frozen_node_parse_tstz(text) from public, anon, authenticated;
grant execute on function public.frozen_node_stable(jsonb,boolean,jsonb) to service_role;
grant execute on function public.frozen_node_refuse(text,text) to service_role;
grant execute on function public.frozen_node_utc_text() to service_role;
grant execute on function public.frozen_node_parse_tstz(text) to service_role;

revoke execute on function public.frozen_node_runtime_valid(jsonb,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.frozen_node_runtime_valid(jsonb,uuid,uuid,jsonb) to service_role;
-- Trigger invocation remains available to owner CRUD; PostgreSQL does not require caller EXECUTE.
revoke execute on function public.alerts_frozen_runtime_guard() from public, anon, authenticated;
grant execute on function public.alerts_frozen_runtime_guard() to service_role;
end;
$frozen_lifecycle$;
