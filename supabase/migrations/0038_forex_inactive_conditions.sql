-- Ledger row: 0038_forex_inactive_conditions / PR #1100 / FOREX-R26-INACTIVE-CONDITIONS
-- Claimed 2026-10-21T12:17:40Z before SQL authoring. NOT applied in production.
-- Rollback: revoke execute on function public.save_forex_watch(uuid,integer,uuid,jsonb), public.delete_forex_watch(uuid,integer,uuid) from authenticated;
-- Preserve the inactive-row guard and stored conditions on application rollback.
-- Existing alerts owner/RLS/grants remain authoritative. No table, evaluator or delivery owner.
-- One DO statement is atomic under scripts/supabase_apply.py's statement-at-a-time runner.
do $migration$
declare
  existing public.alerts%rowtype;
  privilege text;
begin
  perform set_config('lock_timeout','3s',true);
  if not exists (select 1 from pg_class where oid=to_regclass('public.alerts') and relrowsecurity) then
    raise exception 'forex_watch_prerequisite_alerts_rls';
  end if;
  foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('authenticated','public.alerts',privilege) then
      raise exception 'forex_watch_prerequisite_authenticated_privilege: %', privilege;
    end if;
  end loop;
  lock table public.alerts in share row exclusive mode;

  create or replace function public.canonical_forex_watch_rule(p_rule jsonb, p_require_future boolean)
  returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog
  as $rule$
  declare
    threshold_value double precision;
    streak numeric;
    expiry timestamptz;
    expiry_text text;
    canonical_expiry text;
    result jsonb;
  begin
    if p_rule is null or jsonb_typeof(p_rule) is distinct from 'object' or p_require_future is null then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    if not (p_rule ?& array['kind','pair','quote_basis','interval','calendar','operator','threshold','consecutive','expires_at','feed'])
       or (p_rule - array['kind','pair','quote_basis','interval','calendar','operator','threshold','consecutive','expires_at','feed','origin_snapshot_id']) <> '{}'::jsonb
       or p_rule->>'kind' is distinct from 'price_close'
       or not coalesce(p_rule->>'pair'=any(array['EURUSD','USDJPY','AUDUSD','GBPUSD','USDCAD','USDCHF','USDMXN','USDBRL','USDCNH']),false)
       or p_rule->>'quote_basis' is distinct from 'literal'
       or p_rule->>'interval' is distinct from '4H'
       or p_rule->>'calendar' is distinct from 'fx-utc-4h/v1'
       or not coalesce(p_rule->>'operator'=any(array['lt','lte','gt','gte']),false)
       or jsonb_typeof(p_rule->'threshold') is distinct from 'number'
       or jsonb_typeof(p_rule->'consecutive') is distinct from 'number'
       or jsonb_typeof(p_rule->'expires_at') is distinct from 'string'
       or p_rule->'feed' is distinct from 'null'::jsonb then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    threshold_value := (p_rule->>'threshold')::double precision;
    streak := (p_rule->>'consecutive')::numeric;
    if threshold_value <= 0 or threshold_value = 'Infinity'::double precision
       or threshold_value = 'NaN'::double precision
       or streak < 1 or streak > 10 or streak <> trunc(streak) then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    expiry_text := p_rule->>'expires_at';
    if expiry_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?Z$' then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    expiry := expiry_text::timestamptz;
    canonical_expiry := to_char(expiry at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    if split_part(expiry_text,'.',1) <> split_part(canonical_expiry,'.',1)
       and replace(expiry_text,'Z','') <> split_part(canonical_expiry,'.',1) then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    if p_require_future and expiry <= clock_timestamp() then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    if p_rule ? 'origin_snapshot_id' and p_rule->'origin_snapshot_id' <> 'null'::jsonb
       and (jsonb_typeof(p_rule->'origin_snapshot_id') is distinct from 'string'
            or char_length(btrim(p_rule->>'origin_snapshot_id'))=0
            or char_length(p_rule->>'origin_snapshot_id')>256) then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    result := jsonb_build_object('kind','price_close','pair',p_rule->>'pair','quote_basis','literal',
      'interval','4H','calendar','fx-utc-4h/v1','operator',p_rule->>'operator',
      'threshold',threshold_value,'consecutive',streak::integer,'expires_at',canonical_expiry,'feed',null);
    if p_rule ? 'origin_snapshot_id' then
      result := result || jsonb_build_object('origin_snapshot_id',p_rule->'origin_snapshot_id');
    end if;
    return result;
  exception when data_exception then
    raise exception using errcode='22023',message='forex_watch_invalid_condition';
  end;
  $rule$;

  create or replace function public.validate_forex_watch_row(p_id uuid,p_symbol text,p_condition jsonb)
  returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog
  as $validate$
  declare
    rule jsonb;
    revision_value numeric;
  begin
    if p_id is null or jsonb_typeof(p_condition) is distinct from 'object'
       or p_condition->>'type' is distinct from 'forex_price_close'
       or p_condition->'schema_version' is distinct from '1'::jsonb
       or p_condition->>'condition_id' is distinct from p_id::text
       or jsonb_typeof(p_condition->'revision') is distinct from 'number' then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    revision_value := (p_condition->>'revision')::numeric;
    if revision_value < 1 or revision_value > 2147483647 or revision_value <> trunc(revision_value) then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    rule := public.canonical_forex_watch_rule(p_condition - array['type','schema_version','condition_id','revision'],false);
    if p_symbol is distinct from rule->>'pair' or p_condition is distinct from
       (rule || jsonb_build_object('type','forex_price_close','schema_version',1,'condition_id',p_id,'revision',revision_value::integer)) then
      raise exception using errcode='22023',message='forex_watch_invalid_condition';
    end if;
    return rule;
  exception when data_exception then
    raise exception using errcode='22023',message='forex_watch_invalid_condition';
  end;
  $validate$;

  create or replace function public.guard_forex_watch_write()
  returns trigger language plpgsql volatile security invoker set search_path=pg_catalog
  as $guard$
  declare
    old_forex boolean := false;
    new_forex boolean := coalesce(new.condition->>'type'='forex_price_close',false);
    rule jsonb;
    old_rule jsonb;
  begin
    if tg_op='INSERT' then
      -- All INSERT paths share the incumbent 50-alert cap, including legacy/direct writers.
      -- UPDATE never takes this lock after obtaining a row lock; RPC lock order stays owner -> row.
      perform pg_advisory_xact_lock(hashtextextended('alerts-owner-cap/v1:' || new.user_id::text,0));
      if (select count(*) from public.alerts where user_id=new.user_id) >= 50 then
        raise exception using errcode='P0001',message='forex_watch_limit_reached';
      end if;
    else
      old_forex := coalesce(old.condition->>'type'='forex_price_close',false);
    end if;
    if not old_forex and not new_forex then return new; end if;
    if new.active is distinct from false then
      raise exception using errcode='P0001',message='forex_activation_unavailable';
    end if;
    if tg_op='UPDATE' and
       (not old_forex or not new_forex or new.id is distinct from old.id
        or new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at) then
      raise exception using errcode='P0001',message='forex_watch_identity_conflict';
    end if;
    rule := public.validate_forex_watch_row(new.id,new.symbol,new.condition);
    if tg_op='INSERT' then
      if new.condition->'revision' is distinct from '1'::jsonb then
        raise exception using errcode='P0001',message='forex_watch_revision_conflict';
      end if;
      perform public.canonical_forex_watch_rule(rule,true);
    elsif new.condition is distinct from old.condition or new.symbol is distinct from old.symbol then
      if (new.condition->>'revision')::bigint <> (old.condition->>'revision')::bigint+1 then
        raise exception using errcode='P0001',message='forex_watch_revision_conflict';
      end if;
      old_rule := old.condition - array['type','schema_version','condition_id','revision'];
      if rule is distinct from old_rule then perform public.canonical_forex_watch_rule(rule,true); end if;
    end if;
    return new;
  end;
  $guard$;

  create or replace function public.save_forex_watch(
    p_id uuid,p_expected_revision integer,p_expected_user_id uuid,p_rule jsonb)
  returns public.alerts language plpgsql volatile security invoker set search_path=pg_catalog
  as $save$
  declare
    owner_id uuid := auth.uid();
    item public.alerts%rowtype;
    rule jsonb;
    next_revision integer;
  begin
    if owner_id is null then raise exception using errcode='P0001',message='forex_watch_unauthenticated'; end if;
    if p_expected_user_id is distinct from owner_id then
      raise exception using errcode='P0001',message='forex_watch_owner_changed';
    end if;
    if p_id is null or p_expected_revision is null or p_expected_revision<0 then
      raise exception using errcode='22023',message='forex_watch_invalid_request';
    end if;
    rule := public.canonical_forex_watch_rule(p_rule,false);
    perform pg_advisory_xact_lock(hashtextextended('alerts-owner-cap/v1:' || owner_id::text,0));
    select a.* into item from public.alerts a where a.id=p_id and a.user_id=owner_id for update;
    if p_expected_revision=0 then
      if found then
        if item.active is false and item.condition is not distinct from
          (rule || jsonb_build_object('type','forex_price_close','schema_version',1,'condition_id',p_id,'revision',1))
          and item.symbol=rule->>'pair' then return item; end if;
        raise exception using errcode='P0001',message='forex_watch_identity_conflict';
      end if;
      rule := public.canonical_forex_watch_rule(rule,true);
      begin
        insert into public.alerts(id,user_id,symbol,condition,active)
          values(p_id,owner_id,rule->>'pair',rule || jsonb_build_object('type','forex_price_close',
            'schema_version',1,'condition_id',p_id,'revision',1),false) returning * into item;
      exception when unique_violation then
        -- Never update an invisible/conflicting identity, and never expose its owner.
        raise exception using errcode='P0001',message='forex_watch_identity_conflict';
      end;
      return item;
    end if;
    if not found or item.condition->>'type' is distinct from 'forex_price_close' then
      raise exception using errcode='P0001',message='forex_watch_not_found';
    end if;
    if item.condition->'revision' is distinct from to_jsonb(p_expected_revision) or p_expected_revision=2147483647 then
      raise exception using errcode='P0001',message='forex_watch_revision_conflict';
    end if;
    rule := public.canonical_forex_watch_rule(rule,true);
    next_revision := p_expected_revision+1;
    update public.alerts a set symbol=rule->>'pair',condition=rule || jsonb_build_object('type','forex_price_close',
      'schema_version',1,'condition_id',p_id,'revision',next_revision),active=false
      where a.id=p_id and a.user_id=owner_id returning a.* into item;
    if not found then raise exception using errcode='P0001',message='forex_watch_not_found'; end if;
    return item;
  end;
  $save$;

  create or replace function public.delete_forex_watch(p_id uuid,p_expected_revision integer,p_expected_user_id uuid)
  returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog
  as $delete$
  declare
    owner_id uuid := auth.uid();
    item public.alerts%rowtype;
    deleted_id uuid;
  begin
    if owner_id is null then raise exception using errcode='P0001',message='forex_watch_unauthenticated'; end if;
    if p_expected_user_id is distinct from owner_id then
      raise exception using errcode='P0001',message='forex_watch_owner_changed';
    end if;
    if p_id is null or p_expected_revision is null or p_expected_revision<1 then
      raise exception using errcode='22023',message='forex_watch_invalid_request';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('alerts-owner-cap/v1:' || owner_id::text,0));
    select a.* into item from public.alerts a where a.id=p_id and a.user_id=owner_id for update;
    if not found then return jsonb_build_object('id',p_id,'deleted',false); end if;
    if item.condition->>'type' is distinct from 'forex_price_close' then
      raise exception using errcode='P0001',message='forex_watch_identity_conflict';
    end if;
    if item.condition->'revision' is distinct from to_jsonb(p_expected_revision) then
      raise exception using errcode='P0001',message='forex_watch_revision_conflict';
    end if;
    delete from public.alerts a where a.id=p_id and a.user_id=owner_id returning a.id into deleted_id;
    return jsonb_build_object('id',p_id,'deleted',deleted_id is not null);
  end;
  $delete$;

  -- Explicit revocation also defeats permissive deployment-role default privileges.
  revoke all on function public.canonical_forex_watch_rule(jsonb,boolean),
    public.validate_forex_watch_row(uuid,text,jsonb),public.guard_forex_watch_write(),
    public.save_forex_watch(uuid,integer,uuid,jsonb),public.delete_forex_watch(uuid,integer,uuid)
    from public,anon,authenticated,service_role;
  grant execute on function public.canonical_forex_watch_rule(jsonb,boolean),
    public.validate_forex_watch_row(uuid,text,jsonb),
    public.save_forex_watch(uuid,integer,uuid,jsonb),public.delete_forex_watch(uuid,integer,uuid)
    to authenticated;

  -- Refuse an incompatible pre-existing row instead of silently rewriting it.
  for existing in select * from public.alerts where condition->>'type'='forex_price_close' loop
    if existing.active is distinct from false then raise exception 'forex_activation_unavailable'; end if;
    perform public.validate_forex_watch_row(existing.id,existing.symbol,existing.condition);
  end loop;
  drop trigger if exists alerts_forex_inactive_guard on public.alerts;
  create trigger alerts_forex_inactive_guard before insert or update on public.alerts
    for each row execute function public.guard_forex_watch_write();
end;
$migration$;

-- down:
-- Revoke application RPC access, retaining rows and the inactivity guard.
-- revoke execute on function public.save_forex_watch(uuid,integer,uuid,jsonb), public.delete_forex_watch(uuid,integer,uuid) from authenticated;
-- readback:
-- select c.relname as table_name,c.relrowsecurity as rls_enabled,c.relacl::text as acl from pg_class c where c.oid=to_regclass('public.alerts');
-- select p.proname as function_name,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef as security_definer,p.proconfig as settings,p.proacl::text as acl,has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,has_function_privilege('anon',p.oid,'execute') as anon_execute,has_function_privilege('service_role',p.oid,'execute') as service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('canonical_forex_watch_rule','validate_forex_watch_row','guard_forex_watch_write','save_forex_watch','delete_forex_watch');
-- select t.tgname as trigger_name,t.tgenabled as enabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t where t.tgrelid=to_regclass('public.alerts') and t.tgname='alerts_forex_inactive_guard' and not t.tgisinternal;
