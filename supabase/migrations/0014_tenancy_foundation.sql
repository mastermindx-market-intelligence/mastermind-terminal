-- Mastermind Terminal — tenancy foundation: teams + team_id-scoped membership (packet B-F12-1)
--
-- Source of record only; this repository does not apply migrations (see README.md "How DDL
-- actually lands"). Application is a manual, out-of-band operator act via the Management API.
--
-- This file defines functions with dollar-quoted bodies containing semicolons (the 0006-style
-- warning): do NOT push it through the naive Management-API split-on-semicolon endpoint.
--
-- NOT APPLIED by packet B-F12-1 — application is a separate privileged act. Use the
-- `-- readback:` query at the bottom of this file to verify after applying.

begin;

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','admin','member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);
create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('admin','member')),
  token_hash  text not null,
  invited_by  uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists team_members_user  on public.team_members(user_id, team_id);
create index if not exists team_members_team  on public.team_members(team_id, role);
create index if not exists team_invites_team  on public.team_invites(team_id, expires_at desc);
create unique index if not exists team_invites_token on public.team_invites(token_hash);
-- Partial, not a plain column unique: an expired/declined invite (accepted_at still null forever
-- in this packet, since there is no accept route yet — but a future one will set it) must not
-- permanently block re-inviting the same address, and the comparison is case-insensitive.
create unique index if not exists team_invites_team_email_pending
  on public.team_invites(team_id, lower(email)) where accepted_at is null;

-- Recursion guard: two SECURITY DEFINER helpers, fixed search_path, neither takes a user id — both
-- read auth.uid() internally, so neither can be used to probe someone else's role.
create or replace function public.is_team_member(p_team uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public, auth as $$
  select exists (select 1 from public.team_members m where m.team_id = p_team and m.user_id = auth.uid()) $$;
create or replace function public.team_role(p_team uuid) returns text
  language sql stable security definer set search_path = pg_catalog, public, auth as $$
  select m.role from public.team_members m where m.team_id = p_team and m.user_id = auth.uid() $$;
revoke all on function public.is_team_member(uuid), public.team_role(uuid) from public, anon;
grant execute on function public.is_team_member(uuid), public.team_role(uuid) to authenticated;

-- Creator becomes owner via trigger, not via a policy branch (a bootstrap branch inside the
-- team_members insert policy would re-introduce the recursion; a definer trigger is atomic).
create or replace function public.handle_new_team() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  insert into public.team_members (team_id, user_id, role, invited_by)
  values (new.id, new.created_by, 'owner', new.created_by)
  on conflict (team_id, user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_team_created on public.teams;
create trigger on_team_created after insert on public.teams
  for each row execute function public.handle_new_team();

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams        for select to authenticated using (public.is_team_member(id) or created_by = auth.uid());
drop policy if exists teams_insert_self on public.teams;
create policy teams_insert_self   on public.teams        for insert to authenticated with check (created_by = auth.uid());
drop policy if exists tm_select_member on public.team_members;
create policy tm_select_member    on public.team_members for select to authenticated using (public.is_team_member(team_id));
-- Owner invariant (ruling r2, round 4): exactly one owner row exists per team, and it is written
-- ONLY by the creator-becomes-owner trigger (handle_new_team, SECURITY DEFINER). Its INSERT is not
-- blocked by tm_insert_admin below because this table never sets `force row level security` — a
-- table's owning role is exempt from its own RLS policies by default (BYPASSRLS is unrelated and
-- not required for this to work), so this WITH CHECK never has to special-case it. If a later
-- operator act ever adds `force row level security` to this table, the founding-owner insert would
-- need an explicit bootstrap policy (see PR body Deviations). No policy below ever lets an
-- authenticated caller write 'owner' into this table again: an
-- admin cannot INSERT a fresh owner row for another account (WITH CHECK excludes 'owner' here),
-- and no UPDATE can turn an existing row into 'owner' (tm_update_admin's WITH CHECK below also
-- excludes it). Ownership transfer is not available in this version.
drop policy if exists tm_insert_admin on public.team_members;
create policy tm_insert_admin     on public.team_members for insert to authenticated
  with check (role in ('admin','member') and public.team_role(team_id) in ('owner','admin'));
-- Owner transfer and owner eviction are OUT OF SCOPE for V1 (M1 ruling, tightened round 4): a row
-- whose CURRENT role is 'owner' can never be touched by this policy — not by an admin, and not by
-- the owner themselves — so nobody can demote, evict, or otherwise rewrite the owner row via
-- UPDATE; the row can also never be written TO 'owner' (WITH CHECK), so no path here can ever
-- create a second owner or restore one once removed.
drop policy if exists tm_update_admin on public.team_members;
create policy tm_update_admin     on public.team_members for update to authenticated
  using (public.team_role(team_id) in ('owner','admin') and role <> 'owner')
  with check (role in ('admin','member') and public.team_role(team_id) in ('owner','admin'));
drop policy if exists tm_delete_admin on public.team_members;
create policy tm_delete_admin     on public.team_members for delete to authenticated using (public.team_role(team_id) in ('owner','admin') and role <> 'owner');
drop policy if exists ti_select_admin on public.team_invites;
create policy ti_select_admin     on public.team_invites for select to authenticated using (public.team_role(team_id) in ('owner','admin'));
drop policy if exists ti_insert_admin on public.team_invites;
create policy ti_insert_admin     on public.team_invites for insert to authenticated with check (public.team_role(team_id) in ('owner','admin') and invited_by = auth.uid());

revoke all on table public.teams, public.team_members, public.team_invites from public;
revoke all on table public.teams, public.team_members, public.team_invites from anon, authenticated;
grant select, insert                 on table public.teams        to authenticated;
grant select, insert, update, delete on table public.team_members to authenticated;
grant select, insert                 on table public.team_invites to authenticated;

commit;

-- down: (never run automatically; destroys tenancy data)
--   drop trigger if exists on_team_created on public.teams
--   drop function if exists public.handle_new_team()
--   drop function if exists public.team_role(uuid)
--   drop function if exists public.is_team_member(uuid)
--   drop table if exists public.team_invites
--   drop table if exists public.team_members
--   drop table if exists public.teams
-- readback: (run after applying; every row must be present)
--   select c.relname, c.relrowsecurity, count(p.polname) as policies
--     from pg_class c left join pg_policy p on p.polrelid = c.oid
--    where c.relnamespace = 'public'::regnamespace
--      and c.relname in ('teams','team_members','team_invites')
--    group by 1,2 order by 1;
--   -- expected: teams t 2 · team_invites t 2 · team_members t 4
