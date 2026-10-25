CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
-- Production privilege shape: anon and service_role exist, anon can evaluate
-- auth.uid(), and new public functions grant EXECUTE to all three API roles.
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA auth TO anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.fixture_preimage(id integer PRIMARY KEY, body jsonb);
INSERT INTO public.fixture_preimage VALUES(1,'{"preserved":true}');
GRANT SELECT,DELETE ON public.fixture_preimage TO authenticated;
