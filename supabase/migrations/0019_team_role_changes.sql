-- Ledger row: 0019_team_role_changes / PR #550 (open, packet B-F12-8); not applied
-- Rollback: drop trigger if exists team_role_changes_log on public.team_members; drop trigger if exists team_member_move_deny on public.team_members; drop function if exists public.log_team_role_change(); drop function if exists public.team_member_names(uuid); drop function if exists public.team_members_rls_deny(); drop function if exists public.deny_team_member_move(); drop table if exists public.team_role_changes; -- then recreate tm_insert_admin / tm_update_admin / tm_delete_admin / ti_insert_admin from 0014_tenancy_foundation.sql
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
  'The account that made the change (auth.uid() at trigger time). The founding-owner insert inside handle_new_team records the team creator: auth.uid() reads the request JWT setting, which SECURITY DEFINER does not clear. Null only when there is no request JWT at all (an operator or job acting directly on the database). On delete set null so the log survives the actor leaving.';
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
  -- 0014 cascades auth.users deletion into team_members. This AFTER DELETE trigger
  -- would otherwise insert a log row whose subject_id is already gone, which raises
  -- a foreign-key violation and aborts the account deletion (canary run 34346186331).
  -- Skip the insert when the subject account no longer exists. Direct leave/remove
  -- still writes a row because the subject is still in auth.users. Existing log rows
  -- for that subject are dropped by subject_id ON DELETE CASCADE, per the table DDL.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;
  -- Round-6 ruling R2: mirror the subject-account guard for the team FK.
  -- 0014 cascades a team creator's account deletion into the teams row
  -- (created_by ON DELETE CASCADE), which then cascade-deletes every remaining
  -- membership. This AFTER DELETE trigger would otherwise insert a log row
  -- whose team_id is already gone, which raises a foreign-key violation and
  -- aborts the account deletion. Skip the insert when the team no longer
  -- exists. Direct leave/remove still writes a row because the team is still
  -- in public.teams.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.teams where id = coalesce(new.team_id, old.team_id)
  ) then
    return old;
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

-- Raises 42501 from a DELETE USING miss. PostgreSQL RLS treats a USING miss as
-- 0-row success (not 42501); WITH CHECK exists only for INSERT/UPDATE. The house
-- canary rls:member_cannot_delete_other asserts 42501, so a forbidden DELETE must
-- raise rather than silently filter. VOLATILE so the planner cannot skip the call.
create or replace function public.team_members_rls_deny()
returns boolean
language plpgsql
volatile
set search_path = pg_catalog, public, auth as $$
begin
  raise exception using errcode = '42501', message = 'permission denied for table team_members';
end
$$;
revoke all on function public.team_members_rls_deny() from public, anon;
grant execute on function public.team_members_rls_deny() to authenticated;

-- Supersedes 0014_tenancy_foundation.sql tm_update_admin.
-- T1 + T2: only the owner changes a role; the owner row is untouchable; nobody changes their own.
-- USING includes administrator so an administrator's UPDATE of a peer matches the row;
-- WITH CHECK then rejects it with 42501 (a USING miss would be 0-row success, which the
-- house canary rls:admin_cannot_change_peer_admin does not accept).
drop policy if exists tm_update_admin on public.team_members;
create policy tm_update_admin on public.team_members
  for update to authenticated
  using (role <> 'owner' and public.team_role(team_id) in ('owner','admin'))
  with check (role in ('admin','member') and public.team_role(team_id) = 'owner' and user_id <> auth.uid());

-- Round-4 ruling R1: a membership row never moves between teams or between people.
-- USING is evaluated on the OLD row and WITH CHECK on the NEW row, so public.team_role(team_id)
-- resolves against the SOURCE team in USING and the DESTINATION team in WITH CHECK, with nothing
-- tying the two together. Without this trigger, an administrator of team A who also owns any
-- team B (one team creation away) could UPDATE a peer administrator's row out of A by setting
-- team_id = B: USING passes on the old row, WITH CHECK passes on the new one, and because the
-- audit trigger below fires `of role`, a team_id-only UPDATE writes no log row at all. The same
-- shape lets a user_id be rewritten, which would move a membership between people. A BEFORE
-- UPDATE trigger states the invariant directly and raises 42501 for either move, so the widened
-- USING (previous round, ruling R1) stays and no canary assertion is weakened.
create or replace function public.deny_team_member_move() returns trigger
  language plpgsql
  set search_path = pg_catalog, public, auth as $$
begin
  if new.team_id is distinct from old.team_id or new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'permission denied for table team_members';
  end if;
  return new;
end
$$;

drop trigger if exists team_member_move_deny on public.team_members;
create trigger team_member_move_deny
  before update on public.team_members
  for each row execute function public.deny_team_member_move();

-- Supersedes 0014_tenancy_foundation.sql tm_delete_admin.
-- The owner removes anyone but themselves; an administrator removes members only;
-- T3: anyone who is not the owner may remove their own row (leave).
-- CASE ELSE raises 42501 so a member DELETE of another row is a deny, not a silent miss.
-- ORDER IS LOAD-BEARING: `role = 'owner' then false` comes FIRST, before the owner-of-team
-- branch, so a team owner cannot delete their own owner row. Reversing those two lines would
-- open owner self-eviction, which §2.10 forbids; the migration contract test pins this order.
drop policy if exists tm_delete_admin on public.team_members;
create policy tm_delete_admin on public.team_members
  for delete to authenticated
  using (
    case
      when role = 'owner' then false
      when public.team_role(team_id) = 'owner' then true
      when public.team_role(team_id) = 'admin' and role = 'member' then true
      when user_id = auth.uid() then true
      -- Round-4 ruling R4(d): the raising ELSE below must fire only for a caller who IS a member
      -- of this team. A non-member reaching a raise would turn RLS into a membership oracle: the
      -- same DELETE raises 42501 when the row exists and returns 0 rows when it does not, so an
      -- authenticated stranger holding two ids could test membership. Before 0019 both cases were
      -- a silent 0-row miss (0014's USING is a plain boolean); this branch keeps that for
      -- strangers while the canary's member_cannot_delete_other still gets its 42501.
      when public.team_role(team_id) is null then false
      else public.team_members_rls_deny()
    end
  );

-- Supersedes 0014_tenancy_foundation.sql ti_insert_admin.
-- T1: only the owner may invite an administrator; an administrator may invite a member.
-- invited_by must still be the caller. Still never 'owner' (column CHECK already forbids it).
drop policy if exists ti_insert_admin on public.team_invites;
create policy ti_insert_admin on public.team_invites
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and (
      (public.team_role(team_id) = 'owner' and role in ('admin','member'))
      or (public.team_role(team_id) = 'admin' and role = 'member')
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
--   select polname, polcmd, pg_get_expr(p.polwithcheck, p.polrelid)
--     from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'team_invites' and polname = 'ti_insert_admin';
--   select proname, prosecdef, pg_get_function_identity_arguments(oid)
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('log_team_role_change','team_member_names','team_members_rls_deny','deny_team_member_move');
--   select tgname, tgtype from pg_trigger t join pg_class c on c.oid = t.tgrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'team_members' and not t.tgisinternal order by 1;
--   select pg_get_functiondef(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'team_member_names';

-- down:
--   drop trigger if exists team_role_changes_log on public.team_members;
--   drop trigger if exists team_member_move_deny on public.team_members;
--   drop function if exists public.log_team_role_change();
--   drop function if exists public.team_member_names(uuid);
--   drop function if exists public.team_members_rls_deny();
--   drop function if exists public.deny_team_member_move();
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
--   drop policy if exists ti_insert_admin on public.team_invites;
--   create policy ti_insert_admin on public.team_invites for insert to authenticated
--     with check (public.team_role(team_id) in ('owner','admin') and invited_by = auth.uid());
--   -- WARNING: dropping team_role_changes destroys the audit log. Prefer leaving the table in place.
