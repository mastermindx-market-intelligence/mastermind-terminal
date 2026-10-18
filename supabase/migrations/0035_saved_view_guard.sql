-- Ledger row: 0035 / DEFENSE-P2-SAVED-VIEW-DB / PR #778 / unapplied
-- Rollback: retain this guard, slots and v2 reader; disable new saves at the application. Never drop receipts or restore a binary that physically deletes v2 rows.
-- Existing workspace_settings is the sole owner. RLS, grants and existing payloads are unchanged.
-- Receipts remain at least for the account lifetime. Existing account-delete SET NULL/orphan behavior is preserved, not represented as solved privacy cleanup.
-- Applying is one atomic DO statement: no unlocked intermediate table/index/trigger state.
DO $migration$
BEGIN
  LOCK TABLE public.workspace_settings IN SHARE ROW EXCLUSIVE MODE;
  ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS saved_view_slot integer;
  DROP TRIGGER IF EXISTS workspace_saved_view_guard ON public.workspace_settings;
  DROP INDEX IF EXISTS public.workspace_saved_view_slot;
  -- Re-application changes metadata only. Grandfather all old rows, including >50; never truncate.
  UPDATE public.workspace_settings SET saved_view_slot=NULL;
  WITH numbered AS (
    SELECT id,row_number() OVER (PARTITION BY user_id ORDER BY key)::integer AS slot
    FROM public.workspace_settings
    WHERE scope='user' AND user_id IS NOT NULL AND key ~ '^rms_saved_view\.[0-9a-f]{32}$'
      AND NOT (coalesce(value->>'schema','')='mastermind.saved_view.v2' AND value ? 'deletedAt')
  ) UPDATE public.workspace_settings s SET saved_view_slot=n.slot FROM numbered n WHERE s.id=n.id;
  CREATE UNIQUE INDEX workspace_saved_view_slot ON public.workspace_settings(user_id,saved_view_slot)
    WHERE saved_view_slot IS NOT NULL;
  EXECUTE $definition$
  CREATE OR REPLACE FUNCTION public.workspace_saved_view_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
  DECLARE
    old_saved boolean:=false; new_saved boolean:=false; old_v2 boolean:=false;
    new_v2 boolean:=false; active_old boolean:=false; active_new boolean:=false;
    request_id text; deleted_at text; old_revision numeric; new_revision numeric;
    population integer;
  BEGIN
    IF TG_OP<>'INSERT' THEN
      old_saved:=OLD.scope='user' AND OLD.key ~ '^rms_saved_view\.[0-9a-f]{32}$';
      old_v2:=old_saved AND coalesce(OLD.value->>'schema','')='mastermind.saved_view.v2';
      IF TG_OP='DELETE' THEN
        IF old_v2 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_receipt_retained'; END IF;
        RETURN OLD;
      END IF;
      -- Preserve the native account-FK SET NULL effect. Existing RLS still denies an owner's null-owner rewrite.
      IF old_saved AND OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
        AND NEW.scope=OLD.scope AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
        AND NEW.key=OLD.key AND NEW.value=OLD.value AND NEW.id=OLD.id THEN
        NEW.saved_view_slot:=NULL; RETURN NEW;
      END IF;
    END IF;
    new_saved:=NEW.scope='user' AND NEW.key ~ '^rms_saved_view\.[0-9a-f]{32}$';
    IF old_saved AND (NEW.scope IS DISTINCT FROM OLD.scope OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.key IS DISTINCT FROM OLD.key OR NEW.id IS DISTINCT FROM OLD.id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_identity_immutable';
    END IF;
    IF NOT new_saved THEN NEW.saved_view_slot:=NULL; RETURN NEW; END IF;
    -- BEFORE triggers precede RLS WITH CHECK. Reject a foreign owner before taking its lock.
    IF NEW.user_id IS NULL OR auth.uid() IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='saved_view_owner_required';
    END IF;
    new_v2:=coalesce(NEW.value->>'schema','')='mastermind.saved_view.v2';
    IF (NEW.value ? 'schema') AND NOT new_v2 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
    END IF;
    IF old_v2 THEN
      IF NOT new_v2 OR NEW.value->'receipt' IS DISTINCT FROM OLD.value->'receipt' THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_receipt_immutable';
      END IF;
      IF OLD.value ? 'deletedAt' AND NEW.value IS DISTINCT FROM OLD.value THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_request_retired';
      END IF;
    ELSIF TG_OP='UPDATE' AND new_v2 THEN
      -- Legacy records have no initial operation receipt; never fabricate one retrospectively.
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_legacy_upgrade_refused';
    END IF;
    IF new_v2 THEN
      request_id:=NEW.value->'receipt'->>'requestId';
      IF jsonb_typeof(NEW.value)<>'object' OR jsonb_typeof(NEW.value->'receipt') IS DISTINCT FROM 'object'
        OR request_id IS NULL OR request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR NEW.key<>'rms_saved_view.'||replace(request_id,'-','')
        OR jsonb_typeof(NEW.value->'receipt'->'fingerprint') IS DISTINCT FROM 'string'
        OR coalesce(NEW.value->'receipt'->>'fingerprint','') !~ '^[0-9a-f]{64}$'
        OR ((NEW.value->'receipt') - ARRAY['requestId','fingerprint'])<>'{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
      END IF;
      IF NEW.value ? 'deletedAt' THEN
        deleted_at:=NEW.value->>'deletedAt';
        IF TG_OP='INSERT' OR NOT old_v2 OR NEW.value->>'id' IS DISTINCT FROM request_id
          OR (NEW.value - ARRAY['schema','id','deletedAt','receipt'])<>'{}'::jsonb
          OR deleted_at IS NULL OR deleted_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
        END IF;
        BEGIN
          IF to_char(deleted_at::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>deleted_at THEN
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
          END IF;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
        END;
      ELSE
        IF (NEW.value - ARRAY['schema','record','originalName','receipt'])<>'{}'::jsonb
          OR jsonb_typeof(NEW.value->'record') IS DISTINCT FROM 'object'
          OR NEW.value->'record'->>'id' IS DISTINCT FROM request_id
          OR jsonb_typeof(NEW.value->'record'->'definition') IS DISTINCT FROM 'object'
          OR jsonb_typeof(NEW.value->'originalName') IS DISTINCT FROM 'string'
          OR length(NEW.value->>'originalName')=0
          OR jsonb_typeof(NEW.value->'record'->'revision') IS DISTINCT FROM 'number'
          OR coalesce(NEW.value->'record'->>'revision','') !~ '^[1-9][0-9]*$' THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
        END IF;
        new_revision:=(NEW.value->'record'->>'revision')::numeric;
        IF new_revision>9007199254740991 THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
        END IF;
        IF TG_OP='INSERT' AND new_revision<>1 THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_contract_invalid';
        END IF;
        IF old_v2 AND NEW.value IS DISTINCT FROM OLD.value THEN
          old_revision:=(OLD.value->'record'->>'revision')::numeric;
          IF new_revision<>old_revision+1 OR NEW.value->'originalName' IS DISTINCT FROM OLD.value->'originalName'
            OR ((NEW.value->'record') - ARRAY['name','updatedAt','revision']) IS DISTINCT FROM
               ((OLD.value->'record') - ARRAY['name','updatedAt','revision']) THEN
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_changed';
          END IF;
        END IF;
      END IF;
    END IF;
    active_old:=TG_OP='UPDATE' AND old_saved AND OLD.saved_view_slot IS NOT NULL;
    active_new:=NOT (new_v2 AND NEW.value ? 'deletedAt');
    IF NOT active_new THEN NEW.saved_view_slot:=NULL; RETURN NEW; END IF;
    IF active_old THEN NEW.saved_view_slot:=OLD.saved_view_slot; RETURN NEW; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('rms_saved_view:'||NEW.user_id::text,0));
    SELECT count(*) INTO population FROM public.workspace_settings
      WHERE scope='user' AND user_id=NEW.user_id AND saved_view_slot IS NOT NULL AND id<>NEW.id;
    IF population>=50 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_limit_reached'; END IF;
    SELECT i INTO NEW.saved_view_slot FROM generate_series(1,50)i
      WHERE NOT EXISTS(SELECT 1 FROM public.workspace_settings s WHERE s.user_id=NEW.user_id AND s.saved_view_slot=i)
      ORDER BY i LIMIT 1;
    IF NEW.saved_view_slot IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='saved_view_limit_reached'; END IF;
    RETURN NEW;
  END $body$;
  $definition$;
  REVOKE ALL ON FUNCTION public.workspace_saved_view_guard() FROM PUBLIC,anon,authenticated;
  CREATE TRIGGER workspace_saved_view_guard BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_settings
    FOR EACH ROW EXECUTE FUNCTION public.workspace_saved_view_guard();
END $migration$;

-- readback:
-- SELECT a.attname,a.atttypid::regtype FROM pg_attribute a WHERE a.attrelid='public.workspace_settings'::regclass AND a.attname='saved_view_slot' AND NOT a.attisdropped;
-- SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='workspace_saved_view_slot';
-- SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.workspace_settings'::regclass AND tgname='workspace_saved_view_guard';
-- SELECT prosecdef,proconfig,proacl FROM pg_proc WHERE oid='public.workspace_saved_view_guard()'::regprocedure;
-- SELECT relrowsecurity FROM pg_class WHERE oid='public.workspace_settings'::regclass;
