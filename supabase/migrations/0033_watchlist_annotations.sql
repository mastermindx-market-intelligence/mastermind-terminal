-- E05 (terminal-enhancements20-20261011-opus, #916): cross-device watchlist notes and flags.
-- Ledger row: NONE: unapplied at authoring (packet E05); the applier records applied_in_production/applied_date and the readback receipt in RESERVATIONS.json
-- Rollback: NONE: forward-safe and additive; disable by reverting the Terminal consumer (GET/POST /api/watchlist/annotations answers 503 annotations_unavailable without this table) and RETAIN public.watchlist_annotations rows; the commented down block below is destructive and requires a verified backup first.
-- Re-runnable source. Apply this file explicitly, never the entire migration directory.
--
-- One row per (account, symbol). A note and a flag are SEPARATE fields with separate revisions, so
-- two devices that edit different fields of the same symbol both land (disjoint merge), while two
-- devices that edit the SAME field race on a compare-and-set: the Terminal writes
--   update ... set note = $v, note_revision = $base + 1 where user_id = $uid and symbol = $sym
--                                                    and note_revision = $base
-- and a zero-row update is answered as a conflict carrying the current server text, never as a
-- silent overwrite. Postgres re-checks the WHERE clause on the locked row version, so two
-- concurrent writers holding the same base cannot both succeed.
--
-- Rows are never deleted to "clear" an annotation: a cleared field is NULL with its revision
-- bumped, so a stale device that still holds the old text is told about the clear instead of
-- resurrecting it (no ABA on revision 0). Signal/indicator data is never stored here; the note is
-- bounded user text and the flag is a palette colour.
begin;

create table if not exists public.watchlist_annotations (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (char_length(symbol) between 1 and 128),
  note text check (note is null or char_length(note) between 1 and 500),
  note_revision integer not null default 0 check (note_revision >= 0),
  note_updated_at timestamptz,
  flag text check (flag is null or flag ~ '^#[0-9a-f]{6}$'),
  flag_revision integer not null default 0 check (flag_revision >= 0),
  flag_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

alter table public.watchlist_annotations enable row level security;

do $$ begin
  create policy "watchlist_annotations_select_own" on public.watchlist_annotations
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "watchlist_annotations_insert_own" on public.watchlist_annotations
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "watchlist_annotations_update_own" on public.watchlist_annotations
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "watchlist_annotations_delete_own" on public.watchlist_annotations
    for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

revoke all on table public.watchlist_annotations from anon;
grant select, insert, update, delete on table public.watchlist_annotations to authenticated;

commit;

-- readback:
-- select c.relname, c.relrowsecurity
--   from pg_class c
--  where c.relnamespace = 'public'::regnamespace and c.relname = 'watchlist_annotations';
--   -- expected: watchlist_annotations | t
-- select p.polname
--   from pg_policy p
--   join pg_class c on c.oid = p.polrelid
--  where c.relnamespace = 'public'::regnamespace and c.relname = 'watchlist_annotations'
--  order by p.polname;
--   -- expected 4 rows, one policy name per row (the applier matches exact row values, so the
--   -- names must not be aggregated into one array column): watchlist_annotations_delete_own,
--   -- watchlist_annotations_insert_own, watchlist_annotations_select_own,
--   -- watchlist_annotations_update_own
-- select has_table_privilege('anon', 'public.watchlist_annotations', 'select');  -- expected: f

-- down: (destructive -- deletes every account's synced notes and flags; take a verified backup first)
-- begin;
-- drop policy if exists "watchlist_annotations_delete_own" on public.watchlist_annotations;
-- drop policy if exists "watchlist_annotations_update_own" on public.watchlist_annotations;
-- drop policy if exists "watchlist_annotations_insert_own" on public.watchlist_annotations;
-- drop policy if exists "watchlist_annotations_select_own" on public.watchlist_annotations;
-- drop table if exists public.watchlist_annotations;
-- commit;
