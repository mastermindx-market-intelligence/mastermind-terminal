-- Ledger row: SHARED-SHELL-PORTFOLIO-1499, PR #1506. Source only, unapplied.
-- Rollback: NONE: revert caller integration and retain privately owned position history.
ALTER TABLE public.portfolio_positions
  ADD COLUMN IF NOT EXISTS entry_executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS exit_date date,
  ADD COLUMN IF NOT EXISTS exit_executed_at timestamptz;

-- Existing closed_at records when the close action was logged. Execution fields retain separately entered trade times.
-- Legacy writers can still change an entry day or reopen a lot.
CREATE OR REPLACE FUNCTION public.portfolio_execution_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.entry_date IS DISTINCT FROM OLD.entry_date AND NEW.entry_executed_at IS NOT DISTINCT FROM OLD.entry_executed_at THEN NEW.entry_executed_at := NULL; END IF;
    IF NEW.exit_date IS DISTINCT FROM OLD.exit_date AND NEW.exit_executed_at IS NOT DISTINCT FROM OLD.exit_executed_at THEN NEW.exit_executed_at := NULL; END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM 'closed' THEN NEW.exit_date := NULL; NEW.exit_executed_at := NULL; END IF;
  IF NEW.entry_executed_at IS NOT NULL AND NEW.entry_date IS NULL OR NEW.exit_executed_at IS NOT NULL AND NEW.exit_date IS NULL
    OR NEW.exit_date < NEW.entry_date OR NEW.exit_executed_at < NEW.entry_executed_at THEN
    RAISE EXCEPTION 'Invalid execution chronology' USING ERRCODE='22007';
  END IF;
  RETURN NEW;
END
$body$;
CREATE OR REPLACE TRIGGER portfolio_execution_chronology BEFORE INSERT OR UPDATE ON public.portfolio_positions
FOR EACH ROW EXECUTE FUNCTION public.portfolio_execution_guard();

-- The service stores a complete account snapshot in one row. The browser only
-- receives display fields through an authenticated, owner-fenced projection.
CREATE TABLE IF NOT EXISTS public.portfolio_broker_connections (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK(stage IN ('pending','exchanging','connected','disconnecting')),
  secret_box text NOT NULL,
  item_id text UNIQUE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  attempted_at timestamptz,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  holdings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(holdings)='array'),
  sync_error boolean NOT NULL DEFAULT false
);
ALTER TABLE public.portfolio_broker_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portfolio_broker_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.portfolio_broker_connections TO service_role;
CREATE INDEX IF NOT EXISTS portfolio_broker_owner ON public.portfolio_broker_connections(user_id);
CREATE INDEX IF NOT EXISTS portfolio_broker_due ON public.portfolio_broker_connections(attempted_at NULLS FIRST) WHERE stage='connected';

-- down:
-- SELECT 'Disable account linking and the nightly sync before reverting the caller. Retain private history and encrypted connections for consented revocation.' AS rollback;
-- readback:
-- SELECT attname,format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='public.portfolio_positions'::regclass AND attname IN ('entry_executed_at','exit_date','exit_executed_at') AND NOT attisdropped ORDER BY attname;
-- SELECT relrowsecurity,relacl FROM pg_class WHERE oid=to_regclass('public.portfolio_broker_connections');
-- SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='public.portfolio_positions'::regclass AND tgname='portfolio_execution_chronology';
