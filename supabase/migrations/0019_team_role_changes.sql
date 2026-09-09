-- Ledger row: 0019_team_role_changes / PR pending (open, packet B-F12-8); not applied
-- Rollback: drop trigger if exists team_role_changes_log on public.team_members; drop function if exists public.log_team_role_change(); drop function if exists public.team_member_names(uuid); drop table if exists public.team_role_changes; -- then recreate tm_insert_admin / tm_update_admin / tm_delete_admin from 0014_tenancy_foundation.sql
-- 0019: team role changes — audit log, tighter administrator grants, self-leave (packet B-F12-8).
--
-- ============================ MUST NOT BE APPLIED BY THIS PACKET ============================
-- Shipping this file alone does NOT change production. Applying DDL to {ref} is an out-of-band
-- Meta-CEO act with a pre/post catalog readback posted on the pull request. This file defines a
-- dollar-quoted trigger function containing semicolons, so it must never be pushed through the
-- naive split-on-semicolon Management-API endpoint (the 0006-style warning).
-- ============================================================================================
--
-- Idempotent per supabase/migrations/README.md: there is no migration ledger for {ref}, so every
-- file must be safe to re-run from 0001.
--
-- TWO-ORGANISMS LAW (UWP-R2): nothing here reads or writes profiles.is_pro. Entitlement
-- authority stays with macro-api. A team grants nothing.

create table if not exists public.team_role_changes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  subject_id  uuid not null references auth.users(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  old_role    text,          -- null when the person was added
  new_role    text,          -- null when the person was removed
  changed_at  timestamptz not null default now()
);

comment on table public.team_role_changes is
  'Append-only log of team membership role changes. Written only by the log_team_role_change trigger. Owner and administrator may read; nobody may insert, update or delete through RLS.';
comment on column public.team_role_changes.actor_id is
  'The account that made the change (auth.uid() at trigger time). Null for the founding-owner insert inside handle_new_team. On delete set null so the log survives the actor leaving.';
comment on column public.team_role_changes.old_role is
  'Role before the change. Null when the person was added.';
comment on column public.team_role_changes.new_role is
  'Role after the change. Null when the person was removed.';

create index if not exists team_role_changes_team
  on public.team_role_changes (team_id, changed_at desc);

alter table public.team_role_changes enable row level security;

-- Brand-new policies use the 0016 duplicate_object wrapper (this file must never DROP a live
-- policy on team_role_changes). There is no INSERT, UPDATE or DELETE policy on purpose: a log
-- its subject can edit or erase is not a log. The trigger is SECURITY DEFINER, so it writes as
-- the table owner and is not blocked by the absent INSERT policy.
do $$ begin
  create policy trc_select_admin on public.team_role_changes
    for select to authenticated
    using (public.team_role(team_id) in ('owner','admin'));
exception when duplicate_object then null; end $$;

revoke all on table public.team_role_changes from public;
revoke all on table public.team_role_changes from anon, authenticated;
grant select on table public.team_role_changes to authenticated;

-- The audit row is written by the database, so an application that forgets cannot skip it.
create or replace function public.log_team_role_change() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;
  insert into public.team_role_changes (team_id, subject_id, actor_id, old_role, new_role)
  values (
    coalesce(new.team_id, old.team_id),
    coalesce(new.user_id, old.user_id),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then old.role else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.role else null end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists team_role_changes_log on public.team_members;
create trigger team_role_changes_log
  after insert or delete or update of role on public.team_members
  for each row execute function public.log_team_role_change();

-- Readable names for the roster. Returns only id and display name, and only for a team the
-- caller is in. Do not add a second SELECT policy to profiles: that would expose is_pro.
create or replace function public.team_member_names(p_team uuid)
  returns table (user_id uuid, display_name text)
  language sql stable security definer set search_path = pg_catalog, public, auth as $$
  select p.id, p.display_name
    from public.profiles p
    join public.team_members m on m.user_id = p.id
   where m.team_id = p_team
     and public.is_team_member(p_team)
$$;
revoke all on function public.team_member_names(uuid) from public, anon;
grant execute on function public.team_member_names(uuid) to authenticated;

-- Replaced 0014 policies. drop + create (superseding 0014_tenancy_foundation.sql), not the
-- duplicate_object wrapper: replacing these three named live policies is this file's purpose.

-- Supersedes 0014_tenancy_foundation.sql tm_insert_admin.
-- T1: only the owner may insert an administrator; an administrator may insert a member.
-- Still never 'owner'.
drop policy if exists tm_insert_admin on public.team_members;
create policy tm_insert_admin on public.team_members
  for insert to authenticated
  with check (
    (public.team_role(team_id) = 'owner' and role in ('admin','member'))
    or (public.team_role(team_id) = 'admin' and role = 'member')
  );

-- Supersedes 0014_tenancy_foundation.sql tm_update_admin.
-- T1 + T2: only the owner changes a role; the owner row is untouchable; nobody changes their own.
drop policy if exists tm_update_admin on public.team_members;
create policy tm_update_admin on public.team_members
  for update to authenticated
  using (role <> 'owner' and public.team_role(team_id) = 'owner' and user_id <> auth.uid())
  with check (role in ('admin','member') and public.team_role(team_id) = 'owner' and user_id <> auth.uid());

-- Supersedes 0014_tenancy_foundation.sql tm_delete_admin.
-- The owner removes anyone but themselves; an administrator removes members only;
-- T3: anyone who is not the owner may remove their own row (leave).
drop policy if exists tm_delete_admin on public.team_members;
create policy tm_delete_admin on public.team_members
  for delete to authenticated
  using (
    role <> 'owner'
    and (
      public.team_role(team_id) = 'owner'
      or (public.team_role(team_id) = 'admin' and role = 'member')
      or user_id = auth.uid()
    )
  );

-- readback: run against the live project to confirm this migration is applied.
--   select table_name from information_schema.tables
--     where table_schema = 'public' and table_name = 'team_role_changes';
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'team_role_changes' order by 1;
--   select indexname from pg_indexes
--     where schemaname = 'public' and tablename = 'team_role_changes';
--   select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public' and c.relname = 'team_role_changes';
--   select policyname, cmd, qual, with_check from pg_policies
--     where schemaname = 'public' and tablename = 'team_role_changes' order by 1;
--   select polname, polcmd from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'team_members'
--      and polname in ('tm_insert_admin','tm_update_admin','tm_delete_admin')
--    order by 1;
--   select proname, prosecdef, pg_get_function_identity_arguments(oid)
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('log_team_role_change','team_member_names');
--   select pg_get_functiondef(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'team_member_names';

-- down:
--   drop trigger if exists team_role_changes_log on public.team_members;
--   drop function if exists public.log_team_role_change();
--   drop function if exists public.team_member_names(uuid);
--   drop table if exists public.team_role_changes;
--   -- Recreate the 0014 policies (see supabase/migrations/0014_tenancy_foundation.sql):
--   drop policy if exists tm_insert_admin on public.team_members;
--   create policy tm_insert_admin on public.team_members for insert to authenticated
--     with check (role in ('admin','member') and public.team_role(team_id) in ('owner','admin'));
--   drop policy if exists tm_update_admin on public.team_members;
--   create policy tm_update_admin on public.team_members for update to authenticated
--     using (public.team_role(team_id) in ('owner','admin') and role <> 'owner')
--     with check (role in ('admin','member') and public.team_role(team_id) in ('owner','admin'));
--   drop policy if exists tm_delete_admin on public.team_members;
--   create policy tm_delete_admin on public.team_members for delete to authenticated
--     using (public.team_role(team_id) in ('owner','admin') and role <> 'owner');
--   -- WARNING: dropping team_role_changes destroys the audit log. Prefer leaving the table in place.
