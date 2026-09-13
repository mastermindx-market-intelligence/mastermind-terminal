-- Ledger row: 0022_chart_layouts_team_sharing / PR #555 (merged 6cdbaa0a8, packet B-F12-B5-2); not applied
-- Rollback: begin; drop policy if exists chart_layouts_team_read on public.chart_layouts; drop policy if exists chart_layouts_team_update on public.chart_layouts; drop policy if exists chart_layouts_team_delete on public.chart_layouts; drop policy if exists chart_layouts_share_insert_guard on public.chart_layouts; drop policy if exists chart_layouts_share_update_guard on public.chart_layouts; drop policy if exists chart_layouts_share_delete_guard on public.chart_layouts; drop index if exists public.chart_layouts_team_name; drop index if exists public.chart_layouts_team; alter table public.chart_layouts drop constraint if exists chart_layouts_visibility_ck, drop constraint if exists chart_layouts_share_shape_ck, drop column if exists visibility, drop column if exists team_id; commit;
-- 0022_chart_layouts_team_sharing.sql
--
-- Packet B-F12-B5-2 (MO-DELTA-041). Seat ruling R1 owns prefix 0022 (0021 is B-F12-B5-1).
-- Shipped UNAPPLIED. Idempotent. No new store: charter §9.2 forbids a second workspace plane.
-- Writer set is owner/admin, copied from 0015 workspace_settings. No viewer role is minted.
-- Policies are TO authenticated. anon is already denied because the only permissive policy that
-- could match it is 0001's owner policy, whose user_id = auth.uid() is NULL for an anonymous
-- caller and therefore never true.
-- Restrictive guards AND with everything else so 0001's owner policy cannot let a member insert
-- a team-shared row (its check only inspects user_id). The UPDATE guard USING clause reads the
-- OLD row, which is what stops a demoted administrator from un-sharing a team workspace.

begin;

-- 1. Two columns on the canonical object. No new table.
alter table public.chart_layouts
  add column if not exists team_id uuid references public.teams(id) on delete cascade;
alter table public.chart_layouts
  add column if not exists visibility text not null default 'private';

-- 2. Shape. Drop-then-add so the file is re-runnable.
alter table public.chart_layouts drop constraint if exists chart_layouts_visibility_ck;
alter table public.chart_layouts add constraint chart_layouts_visibility_ck
  check (visibility in ('private','team'));
alter table public.chart_layouts drop constraint if exists chart_layouts_share_shape_ck;
alter table public.chart_layouts add constraint chart_layouts_share_shape_ck
  check ((visibility = 'team' and team_id is not null)
      or (visibility = 'private' and team_id is null));

-- 3. Indexes. The unique one is PARTIAL: it constrains shared rows only.
create index if not exists chart_layouts_team
  on public.chart_layouts (team_id, visibility);
create unique index if not exists chart_layouts_team_name
  on public.chart_layouts (team_id, name) where visibility = 'team';

-- 4. Permissive policies. These OR with 0001's owner policy, which is not touched:
--    the creator keeps every right they had over their own private rows.
drop policy if exists chart_layouts_team_read on public.chart_layouts;
create policy chart_layouts_team_read on public.chart_layouts
  for select to authenticated
  using (visibility = 'team' and team_id is not null and public.is_team_member(team_id));

drop policy if exists chart_layouts_team_update on public.chart_layouts;
create policy chart_layouts_team_update on public.chart_layouts
  for update to authenticated
  using  (visibility = 'team' and team_id is not null and public.team_role(team_id) in ('owner','admin'))
  with check (visibility = 'team' and team_id is not null and public.team_role(team_id) in ('owner','admin'));

drop policy if exists chart_layouts_team_delete on public.chart_layouts;
create policy chart_layouts_team_delete on public.chart_layouts
  for delete to authenticated
  using (visibility = 'team' and team_id is not null and public.team_role(team_id) in ('owner','admin'));

-- 5. Restrictive guards. Permissive policies OR together, so the 0001 owner policy would
--    otherwise let any member insert a row with visibility='team'. A restrictive policy
--    ANDs with everything else.
--    The UPDATE and DELETE guards read the OLD row (using), which enforces ruling R2:
--    once a workspace is shared, only an owner or admin of its team may touch it,
--    including the person who created it.
drop policy if exists chart_layouts_share_insert_guard on public.chart_layouts;
create policy chart_layouts_share_insert_guard on public.chart_layouts
  as restrictive for insert to authenticated
  with check ((visibility = 'private' and team_id is null)
           or (visibility = 'team' and team_id is not null
               and public.team_role(team_id) in ('owner','admin')));

drop policy if exists chart_layouts_share_update_guard on public.chart_layouts;
create policy chart_layouts_share_update_guard on public.chart_layouts
  as restrictive for update to authenticated
  using  (visibility <> 'team'
       or (team_id is not null and public.team_role(team_id) in ('owner','admin')))
  with check ((visibility = 'private' and team_id is null)
           or (visibility = 'team' and team_id is not null
               and public.team_role(team_id) in ('owner','admin')));

drop policy if exists chart_layouts_share_delete_guard on public.chart_layouts;
create policy chart_layouts_share_delete_guard on public.chart_layouts
  as restrictive for delete to authenticated
  using (visibility <> 'team'
      or (team_id is not null and public.team_role(team_id) in ('owner','admin')));

commit;

-- down:
-- begin;
-- drop policy if exists chart_layouts_team_read on public.chart_layouts;
-- drop policy if exists chart_layouts_team_update on public.chart_layouts;
-- drop policy if exists chart_layouts_team_delete on public.chart_layouts;
-- drop policy if exists chart_layouts_share_insert_guard on public.chart_layouts;
-- drop policy if exists chart_layouts_share_update_guard on public.chart_layouts;
-- drop policy if exists chart_layouts_share_delete_guard on public.chart_layouts;
-- drop index if exists public.chart_layouts_team_name;
-- drop index if exists public.chart_layouts_team;
-- alter table public.chart_layouts drop constraint if exists chart_layouts_visibility_ck, drop constraint if exists chart_layouts_share_shape_ck, drop column if exists visibility, drop column if exists team_id;
-- commit;

-- readback:
-- select polname, polpermissive, polcmd, polroles::regrole[]
--   from pg_policy
--   where polrelid = 'public.chart_layouts'::regclass
--   order by polname;
-- -- expect: chart_layouts_team_read, chart_layouts_team_update, chart_layouts_team_delete,
-- -- chart_layouts_share_insert_guard, chart_layouts_share_update_guard, chart_layouts_share_delete_guard
-- -- (and the pre-existing owner policy). The three share_* guards must be polpermissive = false.
-- select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and indexname in ('chart_layouts_team_name','chart_layouts_team');
-- select column_name, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'chart_layouts'
--     and column_name in ('team_id','visibility');
-- select count(*), count(*) filter (where visibility = 'team') from public.chart_layouts;
