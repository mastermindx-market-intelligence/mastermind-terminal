-- Ledger row: MO-DELTA-003, PR #1173; source-only/UNAPPLIED.
-- Rollback: NONE: roll back application code only; retain additive role labels to avoid destroying user text.
-- One atomic statement; re-running identical source preserves data and refuses incompatible catalog shape.
-- No policy, privilege, holdings, monetary, alert or execution changes.
-- Re-runnability is not permission to replay an unknown production effect.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.portfolio_targets') AND relrowsecurity) THEN
    RAISE EXCEPTION 'portfolio_targets with enabled RLS is required';
  END IF;
  ALTER TABLE public.portfolio_targets ADD COLUMN IF NOT EXISTS role_label text;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.portfolio_targets'::regclass
      AND attname='role_label' AND NOT attisdropped
      AND (atttypid <> 'text'::regtype OR atttypmod <> -1 OR attnotnull OR atthasdef OR attgenerated <> '')) THEN
    RAISE EXCEPTION 'portfolio role column shape mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.portfolio_targets'::regclass AND conname='portfolio_targets_role_label_valid') THEN
  ALTER TABLE public.portfolio_targets ADD CONSTRAINT portfolio_targets_role_label_valid CHECK (
    role_label IS NULL OR (
      char_length(role_label) BETWEEN 1 AND 48
      AND role_label !~ U&'[\0001-\001F\007F-\009F]'
      AND role_label = btrim(role_label, U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    )
  );
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.portfolio_targets'::regclass
      AND conname='portfolio_targets_role_label_valid' AND contype='c' AND convalidated AND NOT connoinherit
      AND pg_get_constraintdef(oid) = U&'CHECK (((role_label IS NULL) OR (((char_length(role_label) >= 1) AND (char_length(role_label) <= 48)) AND (role_label !~ ''[\0001-\001F\007F-\009F]''::text) AND (role_label = btrim(role_label, '' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF''::text)))))') THEN
    RAISE EXCEPTION 'portfolio role constraint shape mismatch';
  END IF;
END
$migration$;

-- down:
-- Retain additive labels and constraints; older clients omit and preserve the column.
-- SELECT 'application-only rollback; retain owner-authored role labels' AS rollback;

-- readback:
-- SELECT attname, format_type(atttypid,atttypmod) AS type, attnotnull, atthasdef, attgenerated FROM pg_attribute WHERE attrelid='public.portfolio_targets'::regclass AND attname='role_label' AND NOT attisdropped;
-- SELECT pg_get_constraintdef(oid), convalidated, connoinherit FROM pg_constraint WHERE conrelid='public.portfolio_targets'::regclass AND conname='portfolio_targets_role_label_valid';
-- SELECT relrowsecurity, relforcerowsecurity, relacl FROM pg_class WHERE oid='public.portfolio_targets'::regclass;
-- SELECT polname, polcmd, polroles, pg_get_expr(polqual,polrelid), pg_get_expr(polwithcheck,polrelid) FROM pg_policy WHERE polrelid='public.portfolio_targets'::regclass ORDER BY polname;
