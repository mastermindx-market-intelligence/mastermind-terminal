-- Least-privilege cases. Runs in a fresh session as the migration owner after
-- 0031 loads under the production default privileges from fixture-setup.sql.
DO $privilege_catalog$
DECLARE fn regprocedure;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
  'public.validate_drawing_replace_input(text,jsonb,uuid)'::regprocedure,
  'public.read_drawings_collection(text)'::regprocedure,
  'public.replace_drawings_collection(text,jsonb,text,uuid)'::regprocedure
 ] LOOP
  -- Witness that the fixture reproduced the default grant this case removes.
  IF NOT has_function_privilege('service_role',fn,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: fixture default privileges did not grant %',fn;
  END IF;
  IF has_function_privilege('anon',fn,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: anon can execute %',fn;
  END IF;
  IF NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: authenticated cannot execute %',fn;
  END IF;
  RAISE NOTICE 'PRIVILEGE_PASS: catalog anon=false authenticated=true %',fn;
 END LOOP;
END;
$privilege_catalog$;

SET ROLE anon;
SET request.jwt.claim.sub = '';
DO $anon_denied$
DECLARE
 probe text[];
 state text;
 detail text;
BEGIN
 FOREACH probe SLICE 1 IN ARRAY ARRAY[
  ARRAY['validate_drawing_replace_input',$q$SELECT public.validate_drawing_replace_input('ANONPROBE','[]'::jsonb,'91111111-1111-4111-8111-111111111111'::uuid)$q$],
  ARRAY['read_drawings_collection',$q$SELECT public.read_drawings_collection('ANONPROBE')$q$],
  ARRAY['replace_drawings_collection',$q$SELECT public.replace_drawings_collection('ANONPROBE','[]'::jsonb,NULL,'92222222-2222-4222-8222-222222222222'::uuid)$q$]
 ] LOOP
  state := NULL; detail := NULL;
  BEGIN
   EXECUTE probe[2];
   state := 'returned'; detail := 'call completed';
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, detail = MESSAGE_TEXT;
  END;
  -- Under a grant to anon the body runs and raises 28000 instead.
  IF state IS DISTINCT FROM '42501' OR detail IS DISTINCT FROM 'permission denied for function ' || probe[1] THEN
   RAISE EXCEPTION 'FAIL: anon call to % reached % (%)',probe[1],state,detail;
  END IF;
  RAISE NOTICE 'PRIVILEGE_PASS: anon call denied before body %',probe[1];
 END LOOP;
END;
$anon_denied$;
RESET ROLE;
