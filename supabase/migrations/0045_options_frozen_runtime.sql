-- Ledger row: 0045 / OPTIONS-EXPOSURE-P09-FROZEN-RUNTIME / PR #1175
-- Rollback: application-first disablement and qualified catalog restoration only; see down.
-- Source only, UNAPPLIED. No enrollment, source/action grant, activation or delivery.
-- Packages the accepted #1161/#1169 units byte-for-byte inside ONE atomic statement.
-- Historical UNRESERVED comments inside the embedded units describe their original
-- proposal provenance; this outer unit is the forward namespace claim in #1175.
-- Prerequisites: incumbent alerts/auth roles, 0013/0014/0018/0026, and qualified
-- existing ACL/RLS. Current 0038 coexistence is covered in the native fixture.
-- Never reapply a lifecycle-only intermediate unit after this composition.
-- A successful SQL application does not qualify selected source or runtime accounts.
-- Embedded proposed_lifecycle.sql SHA256 4838864e8b2584ff184a92f7fd3b02c7644c168517529663191e0ac1e5308c2f
-- Embedded proposed_atomic_hit.sql SHA256 480749e6b3e5872ed3e1ae3a16ba1a40ca6698ccdc7e5edd0b9df0aa26d9e5fb
-- Embedded proposed_prepared_intent.sql SHA256 ad9079e9a659b8b2b28e9aefd285863f192381b8d094148f7470d69c87696f23
DO $frozen_composed$
BEGIN
  EXECUTE $frozen_stage_0$-- proposed_lifecycle.sql — protected frozen Options lifecycle/state CAS for public.alerts
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
$frozen_stage_0$;
  EXECUTE $frozen_stage_1$-- UNRESERVED / UNAPPLIED source proposal. No migration number or DB installation.
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
$frozen_stage_1$;
  EXECUTE $frozen_stage_2$-- UNRESERVED / UNAPPLIED source-only amendment AFTER proposed_lifecycle.sql and
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
    if v_mode not in ('prepare','commit','reconcile','fence','settle') or v_mode is null
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
        if v_mode='settle' then
          -- Explicit administration only: an exact published winner is the
          -- evidence. Close its invocation to delayed prepares, never replay it.
          -- The run advisory lock also excludes every prepare/commit/fence in
          -- this invocation. No absent-row or timeout-based reset is possible.
          if exists(select 1 from public.alert_outbox o where o.status='prepared'
              and o.payload#>'{frozen_node,publication_receipt,invocation}'=v_receipt->'invocation') then
            return public.frozen_node_refuse('invocation_has_prepared_intent');
          end if;
          update public.alert_runs set error_class='frozen_publication_settled'
            where lane=v_receipt#>>'{invocation,lane}' and run_id=v_receipt#>>'{invocation,runId}'
              and error_class in ('frozen_publication_pending','frozen_fire_effect_unknown','frozen_publication_settled')
              and started_at <= public.frozen_node_parse_tstz(v_receipt->>'evaluationAt');
          if not found then
            return public.frozen_node_refuse('settlement_run_unavailable');
          end if;
          return pg_catalog.jsonb_build_object('kind','settled','fireEventId',v_event);
        end if;
        return pg_catalog.jsonb_build_object('kind','already_committed','fireEventId',v_event);
      end if;
      if v_mode='settle' then
        return public.frozen_node_refuse('settlement_requires_published_intent');
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
  if old.error_class in ('frozen_publication_fenced','frozen_publication_settled') then
    new.error_class := old.error_class;
  elsif old.error_class='frozen_fire_effect_unknown'
        and new.error_class is distinct from 'frozen_publication_fenced'
        and new.error_class is distinct from 'frozen_publication_settled' then
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
$frozen_stage_2$;
END $frozen_composed$;

-- down:
-- Disable the qualified application evaluator/publisher before any schema rollback.
-- Preserve frozen_runtime, prepared/abandoned tombstones and unresolved run markers.
-- Never restore an intermediate commit RPC or discard an uncertain operation.
-- Use retained pre-application catalog bodies and original effect receipts to plan
-- a separately reviewed restoration; the following query is read-only preparation.
-- select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
--   from pg_proc p where p.pronamespace='public'::regnamespace
--   and (p.proname like '%frozen%' or p.proname='project_alert_fire_to_webhooks');

-- readback:
-- select a.attname, a.atttypid::regtype::text, a.attnotnull
--   from pg_attribute a where a.attrelid='public.alerts'::regclass
--   and a.attname='frozen_runtime' and not a.attisdropped;
-- select p.proname, p.oid::regprocedure::text, p.prosecdef, p.proconfig, p.proacl,
--   pg_get_functiondef(p.oid) from pg_proc p
--   where p.pronamespace='public'::regnamespace
--   and (p.proname like '%frozen%' or p.proname='project_alert_fire_to_webhooks')
--   order by p.oid::regprocedure::text;
-- select p.oid::regprocedure::text,
--   has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
--   has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
--   has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
--   from pg_proc p where p.pronamespace='public'::regnamespace
--   and p.proname in ('arm_frozen_node_runtime','read_frozen_node_runtime','commit_frozen_node_state');
-- select c.relname,t.tgname,pg_get_triggerdef(t.oid) from pg_trigger t
--   join pg_class c on c.oid=t.tgrelid where not t.tgisinternal
--   and t.tgrelid in ('public.alerts'::regclass,'public.alert_runs'::regclass,'public.alert_outbox'::regclass)
--   order by c.relname,t.tgname;
-- select conname,pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.alert_outbox'::regclass and conname='alert_outbox_status_check';
-- select indexname,indexdef from pg_indexes where schemaname='public'
--   and indexname in ('alert_runs_frozen_unresolved_lane','alert_outbox_frozen_unsettled_slot');
-- select tablename,policyname,roles,cmd,qual,with_check from pg_policies
--   where schemaname='public' and tablename in ('alerts','alert_runs','alert_outbox','webhook_deliveries')
--   order by tablename,policyname;
