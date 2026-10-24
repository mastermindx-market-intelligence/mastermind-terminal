-- MO-DELTA-003 source candidate only. UNAPPLIED; no numbered reservation yet.
-- One atomic statement. Existing column/constraint causes refusal, not overwrite.
-- No policy, privilege, holdings, monetary, alert or execution changes.
-- Rollback requires a separately qualified operation: dropping role_label destroys
-- user-authored text. Never replay a lost response; inspect the original effect.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.portfolio_targets') AND relrowsecurity) THEN
    RAISE EXCEPTION 'portfolio_targets with enabled RLS is required';
  END IF;
  ALTER TABLE public.portfolio_targets ADD COLUMN role_label text;
  ALTER TABLE public.portfolio_targets ADD CONSTRAINT portfolio_targets_role_label_valid CHECK (
    role_label IS NULL OR (
      char_length(role_label) BETWEEN 1 AND 48
      AND role_label !~ U&'[\0001-\001F\007F-\009F]'
      AND role_label = btrim(role_label, U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    )
  );
END
$migration$;
