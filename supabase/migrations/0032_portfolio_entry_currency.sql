-- Ledger row: NONE: original Audit20 A09; shared portfolio entry-unit receipt, production UNAPPLIED.
-- Rollback: NONE: retain additive nullable columns and receipt trigger; old clients remain compatible and recorded units are preserved.
-- No legacy currency backfill, new table, FX rate, entitlement, privilege or RLS change.
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.portfolio_positions') IS NULL THEN
    RAISE EXCEPTION 'portfolio_positions prerequisite missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.portfolio_positions'::regclass) THEN
    RAISE EXCEPTION 'portfolio_positions RLS prerequisite missing';
  END IF;
END $$;

ALTER TABLE public.portfolio_positions ADD COLUMN IF NOT EXISTS entry_currency text;
ALTER TABLE public.portfolio_positions ADD COLUMN IF NOT EXISTS entry_currency_basis jsonb;

DO $$ BEGIN
  IF (SELECT atttypid FROM pg_attribute WHERE attrelid='public.portfolio_positions'::regclass AND attname='entry_currency' AND NOT attisdropped) <> 'text'::regtype
    OR (SELECT atttypid FROM pg_attribute WHERE attrelid='public.portfolio_positions'::regclass AND attname='entry_currency_basis' AND NOT attisdropped) <> 'jsonb'::regtype THEN
    RAISE EXCEPTION 'portfolio entry-unit column type mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.portfolio_positions'::regclass AND conname='portfolio_entry_currency_shape') THEN
    ALTER TABLE public.portfolio_positions ADD CONSTRAINT portfolio_entry_currency_shape
      CHECK (entry_currency IS NULL OR (entry_currency ~ '^[A-Z]{3}$' AND entry_currency NOT IN ('XXX','XTS')));
  END IF;
END $$;

-- An explicit unit is bound to both the recorded instrument and price. An old
-- client changes neither receipt column: its price/ticker update invalidates
-- the unit, and changing back cannot resurrect the earlier declaration.
CREATE OR REPLACE FUNCTION public.portfolio_entry_currency_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.entry_currency IS NULL THEN
    NEW.entry_currency_basis := NULL;
  ELSIF NEW.entry_currency_basis IS DISTINCT FROM jsonb_build_object('ticker',NEW.ticker,'price',NEW.entry_price) THEN
    NEW.entry_currency := NULL;
    NEW.entry_currency_basis := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS portfolio_entry_currency_receipt ON public.portfolio_positions;
CREATE TRIGGER portfolio_entry_currency_receipt BEFORE INSERT OR UPDATE ON public.portfolio_positions
FOR EACH ROW EXECUTE FUNCTION public.portfolio_entry_currency_receipt();

COMMENT ON COLUMN public.portfolio_positions.entry_currency IS 'Explicit user-recorded entry price currency; NULL means unknown, including legacy rows.';
COMMENT ON COLUMN public.portfolio_positions.entry_currency_basis IS 'Exact ticker/price receipt for the entry currency. Older writers changing either invalidate it; not an FX or quote source.';
COMMIT;
