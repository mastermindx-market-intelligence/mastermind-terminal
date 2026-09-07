-- 0011: analytics_events.eid — envelope-v1 event identity (WS:COMMERCIAL-ACTIVATION CA1A).
--
-- The macro collector's CA1A envelope (macro PR #6838) assumed analytics_events.id was a
-- UUID the client event id (eid) could seat into (decision DEC:ANALYTICS-EID-USES-
-- EXISTING-EVENT-PRIMARY-KEY). The live id is a bigint identity (0004_analytics.sql), so
-- a UUID there made PostgREST reject the whole insert batch (22P02) — caught by the
-- mandatory §16 production canary on 2026-09-04. The corrected seat (macro PR #6858) is
-- this dedicated nullable unique column: producers mint a stable UUID eid per envelope-v1
-- growth event, the collector inserts with on_conflict=eid + ignore-duplicates, and an
-- exact replay of the same event is ONE row. Legacy rows carry NULL (UNIQUE ignores
-- NULLs), and the bigint id stays DB-minted for every row.
--
-- Applied to the live shared project on 2026-09-05 UTC via the Supabase management API,
-- this file is the durable record and is idempotent for replays.
alter table public.analytics_events add column if not exists eid uuid;
create unique index if not exists analytics_events_eid_uniq
  on public.analytics_events (eid);
comment on column public.analytics_events.eid is
  'growth_events.v1 envelope: producer-minted stable UUID, UNIQUE so an exact replay inserts one row (on_conflict=eid ignore-duplicates). NULL for non-envelope rows.';

-- readback: run against the live project to confirm this migration is applied.
--   select indexname from pg_indexes
--     where schemaname = 'public' and tablename = 'analytics_events'
--     and indexname = 'analytics_events_eid_uniq';
--   select column_name, data_type from information_schema.columns
--     where table_schema = 'public' and table_name = 'analytics_events'
--     and column_name = 'eid';

-- down: drop index if exists public.analytics_events_eid_uniq;
--       alter table public.analytics_events drop column if exists eid;
