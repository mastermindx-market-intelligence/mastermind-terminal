-- Ledger row: MEDTECH-R14-WATCHES / RESERVATIONS.json prefix 0037
-- Rollback: Disable MedTech watch routes and retain user data. The destructive down block is for disposable qualification databases only.
-- Two new owner-scoped account tables. No symbol-watchlist, identity, alert-delivery or existing application tables are altered.
-- One DO statement keeps catalog creation, RLS and grants atomic through the existing statement-at-a-time applier.
DO $migration$
BEGIN
  CREATE TABLE IF NOT EXISTS public.medtech_watches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subject_type text NOT NULL CHECK (subject_type IN ('event', 'pma_application')),
    subject_id text NOT NULL,
    triggers text[] NOT NULL,
    baseline_generation text NOT NULL CHECK (baseline_generation ~ '^[0-9a-f]{64}$'),
    baseline_revision text CHECK (baseline_revision ~ '^[0-9a-f]{64}$'),
    baseline_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    CONSTRAINT medtech_watches_subject CHECK (
      (subject_type = 'event' AND subject_id ~ '^fda-(510k|pma)-[A-Z][0-9]{6}(-S[0-9]{1,6})?$'
       AND baseline_revision IS NOT NULL)
      OR (subject_type = 'pma_application' AND subject_id ~ '^fda-pma-P[0-9]{6}$'
          AND baseline_revision IS NULL)
    ),
    CONSTRAINT medtech_watches_triggers CHECK (
      array_ndims(triggers) = 1 AND array_lower(triggers, 1) = 1
      AND array_position(triggers, NULL) IS NULL
      AND ((cardinality(triggers) = 1 AND
            (triggers[1] = 'record_changed' OR
             (subject_type = 'pma_application' AND triggers[1] = 'new_supplement')))
           OR (subject_type = 'pma_application' AND cardinality(triggers) = 2
               AND triggers @> ARRAY['record_changed', 'new_supplement']::text[]))
    ),
    UNIQUE (user_id, subject_type, subject_id),
    UNIQUE (id, user_id)
  );
  CREATE INDEX IF NOT EXISTS medtech_watches_user_created
    ON public.medtech_watches(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS public.medtech_reviewed_changes (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    watch_id uuid NOT NULL,
    event_id text NOT NULL CHECK (event_id ~ '^fda-(510k|pma)-[A-Z][0-9]{6}(-S[0-9]{1,6})?$'),
    revision_id text NOT NULL CHECK (revision_id ~ '^[0-9a-f]{64}$'),
    reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (watch_id, event_id, revision_id),
    FOREIGN KEY (watch_id, user_id) REFERENCES public.medtech_watches(id, user_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS medtech_reviews_user_watch
    ON public.medtech_reviewed_changes(user_id, watch_id);

  ALTER TABLE public.medtech_watches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.medtech_watches FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.medtech_reviewed_changes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.medtech_reviewed_changes FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS medtech_watches_owner ON public.medtech_watches;
  CREATE POLICY medtech_watches_owner ON public.medtech_watches
    FOR ALL TO authenticated USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));
  DROP POLICY IF EXISTS medtech_reviews_read ON public.medtech_reviewed_changes;
  CREATE POLICY medtech_reviews_read ON public.medtech_reviewed_changes
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
  DROP POLICY IF EXISTS medtech_reviews_insert ON public.medtech_reviewed_changes;
  CREATE POLICY medtech_reviews_insert ON public.medtech_reviewed_changes
    FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
  DROP POLICY IF EXISTS medtech_reviews_delete ON public.medtech_reviewed_changes;
  CREATE POLICY medtech_reviews_delete ON public.medtech_reviewed_changes
    FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

  EXECUTE $definition$
    CREATE OR REPLACE FUNCTION public.medtech_watch_guard()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
    SET search_path = pg_catalog, public
    AS $guard$
    DECLARE stamp timestamptz := clock_timestamp();
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- Serialize this account's insertions so concurrent tabs cannot exceed the quota.
        PERFORM pg_advisory_xact_lock(hashtextextended('medtech-watch:' || NEW.user_id::text, 0));
        IF (SELECT count(*) FROM public.medtech_watches WHERE user_id = NEW.user_id) >= 50 THEN
          RAISE EXCEPTION 'medtech_watch_limit' USING ERRCODE = 'P0001';
        END IF;
        NEW.baseline_at := stamp;
        NEW.created_at := stamp;
        NEW.updated_at := stamp;
        NEW.version := 1;
      ELSE
        IF (NEW.id, NEW.user_id, NEW.subject_type, NEW.subject_id, NEW.baseline_generation,
            NEW.baseline_revision, NEW.baseline_at, NEW.created_at)
           IS DISTINCT FROM
           (OLD.id, OLD.user_id, OLD.subject_type, OLD.subject_id, OLD.baseline_generation,
            OLD.baseline_revision, OLD.baseline_at, OLD.created_at) THEN
          RAISE EXCEPTION 'medtech_watch_identity_immutable' USING ERRCODE = '23514';
        END IF;
        NEW.version := OLD.version + 1;
        NEW.updated_at := stamp;
      END IF;
      RETURN NEW;
    END
    $guard$
  $definition$;
  EXECUTE $definition$
    CREATE OR REPLACE FUNCTION public.medtech_review_guard()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
    SET search_path = pg_catalog, public
    AS $guard$
    DECLARE
      watched_type text;
      watched_subject text;
    BEGIN
      SELECT subject_type, subject_id INTO watched_type, watched_subject
        FROM public.medtech_watches
        WHERE id = NEW.watch_id AND user_id = NEW.user_id;
      -- The composite foreign key handles an absent or cross-owner watch.
      -- Personal review intent must still belong to the saved subject.
      IF FOUND AND NOT (
        NEW.event_id = watched_subject OR
        (watched_type = 'pma_application' AND
          NEW.event_id LIKE watched_subject || '-S%')
      ) THEN
        RAISE EXCEPTION 'medtech_review_subject_mismatch' USING ERRCODE = '23514';
      END IF;
      NEW.reviewed_at := clock_timestamp();
      RETURN NEW;
    END
    $guard$
  $definition$;
  DROP TRIGGER IF EXISTS medtech_watch_guard ON public.medtech_watches;
  CREATE TRIGGER medtech_watch_guard BEFORE INSERT OR UPDATE ON public.medtech_watches
    FOR EACH ROW EXECUTE FUNCTION public.medtech_watch_guard();
  DROP TRIGGER IF EXISTS medtech_review_guard ON public.medtech_reviewed_changes;
  CREATE TRIGGER medtech_review_guard BEFORE INSERT ON public.medtech_reviewed_changes
    FOR EACH ROW EXECUTE FUNCTION public.medtech_review_guard();

  -- Clear inherited/default grants too: TRUNCATE bypasses row-level security.
  REVOKE ALL ON public.medtech_watches, public.medtech_reviewed_changes FROM PUBLIC, anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.medtech_watches TO authenticated;
  GRANT SELECT, INSERT, DELETE ON public.medtech_reviewed_changes TO authenticated;
  REVOKE ALL ON FUNCTION public.medtech_watch_guard(), public.medtech_review_guard() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.medtech_watch_guard(), public.medtech_review_guard() TO authenticated;
END
$migration$;

-- down:
-- DROP TABLE IF EXISTS public.medtech_reviewed_changes;
-- DROP TABLE IF EXISTS public.medtech_watches;
-- DROP FUNCTION IF EXISTS public.medtech_review_guard();
-- DROP FUNCTION IF EXISTS public.medtech_watch_guard();

-- readback:
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
--        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_any_privilege,
--        has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
--        has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
--        has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
--        has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete,
--        has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER') AS authenticated_unsafe_privilege,
--        (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
--        (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS guards
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname IN ('medtech_watches', 'medtech_reviewed_changes')
-- ORDER BY c.relname;
