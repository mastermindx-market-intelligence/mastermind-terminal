-- 0015_team_roles_invitations.sql
--
-- Packet B-F12-3 (MO-PAID-081/082/083). Builds on 0014_tenancy_foundation.sql's `teams` /
-- `team_members` / `team_invites`. NOT YET APPLIED — see supabase/migrations/README.md "How DDL
-- actually lands" for the manual Management-API application procedure. This file creates no
-- second auth/tenant/secret/job/event plane (F12 do_not_redo) and does not renumber or edit
-- 0011-0014.
--
-- A. accept_team_invite(p_token): 0014 grants `team_invites` only SELECT/INSERT to owner/admin
--    (ti_select_admin / ti_insert_admin) -- the invitee can never SELECT their own row, let alone
--    UPDATE it, so acceptance is impossible through table DML. This SECURITY DEFINER function is
--    the only way an invitee can accept, mirroring 0014's own `is_team_member`/`team_role` idiom
--    (security definer set search_path = pg_catalog, public, auth, reading auth.uid() internally).
-- B. workspace_settings: one table, two scopes (`scope='user'` / `scope='workspace'`) -- a
--    workspace IS a 0014 team, no second tenant entity is minted.
begin;

create or replace function public.accept_team_invite(p_token text) returns jsonb
  language plpgsql volatile security definer set search_path = pg_catalog, public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_inv public.team_invites;
  v_email text;
  v_updated int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_token is null or length(p_token) not between 32 and 128 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  select * into v_inv from public.team_invites where token_hash = v_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  if v_inv.accepted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'email_unknown');
  end if;
  if v_email <> lower(btrim(v_inv.email)) then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;
  -- Belt-and-braces: ownership is never transferable through an invitation, regardless of what
  -- role a team_invites row carries. The app layer already refuses to CREATE an owner-role
  -- invite (lib/teams.ts createInvite), but this function is reachable by any row that exists in
  -- team_invites (round-2 review, MAJOR-3) -- so the acceptance path refuses to mint one too.
  if v_inv.role = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_role');
  end if;
  insert into public.team_members (team_id, user_id, role, invited_by)
    values (v_inv.team_id, v_uid, v_inv.role, v_inv.invited_by)
    on conflict (team_id, user_id) do nothing;
  update public.team_invites set accepted_at = now() where id = v_inv.id and accepted_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  return jsonb_build_object('ok', true, 'team_id', v_inv.team_id, 'role', v_inv.role);
end $$;
revoke all on function public.accept_team_invite(text) from public, anon;
grant execute on function public.accept_team_invite(text) to authenticated;

create table if not exists public.workspace_settings (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null check (scope in ('user','workspace')),
  team_id    uuid references public.teams(id) on delete cascade,
  -- user_id is nullable and ON DELETE SET NULL, not ON DELETE CASCADE: it records the last
  -- WRITER for attribution only. Ownership is owner_id (below), which for a workspace-scope row
  -- is team_id, never the writer -- a workspace's settings must not be deleted just because the
  -- account that last wrote them is later deleted (round-2 review MAJOR-2, ruling 2026-09-07).
  -- DISCLOSED CONSEQUENCE (round-3 review MAJOR-1): this same column and rule also cover
  -- scope='user' rows, where user_id IS the sole owner (owner_id = user_id). Deleting that
  -- user's account sets user_id to NULL, which makes owner_id NULL too -- every RLS policy below
  -- keys off `user_id = auth.uid()` or a team, so a scope='user' row survives its owner's account
  -- deletion as a permanently unreachable, un-owned orphan (no `authenticated` role can read,
  -- write, or delete it again). The ruling's rationale (MAJOR-2) is workspace-scope survival
  -- only; this is a known, disclosed trade-off of applying the same column/FK to both scopes,
  -- not a fix -- a cleanup path (e.g. a service-role job, or a scope-specific delete rule) is
  -- unresolved and owed as a follow-up decision, not silently redesigned here.
  user_id    uuid references auth.users(id) on delete set null,
  -- owner_id collapses the two scopes into one conflict target: for scope='user' it is the
  -- user, for scope='workspace' it is the team. PostgREST's upsert ON CONFLICT(columns) cannot
  -- infer a *partial* unique index (SQLSTATE 42P10) -- a non-partial index on
  -- (scope, owner_id, key) is required so one onConflict target works for both scopes.
  owner_id   uuid generated always as (coalesce(team_id, user_id)) stored,
  key        text not null check (key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  constraint workspace_settings_scope_shape check (
    (scope = 'workspace' and team_id is not null) or (scope = 'user' and team_id is null))
);
create unique index if not exists workspace_settings_scope_owner_key on public.workspace_settings(scope, owner_id, key);
alter table public.workspace_settings enable row level security;

drop policy if exists ws_select on public.workspace_settings;
create policy ws_select on public.workspace_settings for select to authenticated using (
  (scope = 'user' and user_id = auth.uid())
  or (scope = 'workspace' and public.is_team_member(team_id)));
drop policy if exists ws_insert on public.workspace_settings;
create policy ws_insert on public.workspace_settings for insert to authenticated with check (
  user_id = auth.uid() and (
    (scope = 'user' and team_id is null)
    or (scope = 'workspace' and public.team_role(team_id) in ('owner','admin'))));
drop policy if exists ws_update on public.workspace_settings;
create policy ws_update on public.workspace_settings for update to authenticated using (
  (scope = 'user' and user_id = auth.uid())
  or (scope = 'workspace' and public.team_role(team_id) in ('owner','admin')))
  with check (
  (scope = 'user' and user_id = auth.uid() and team_id is null)
  -- WITH CHECK also pins user_id = auth.uid() on the workspace branch (round-2 review MAJOR-2):
  -- USING alone let any owner/admin UPDATE re-attribute a row to an arbitrary user_id, minting a
  -- false attribution for someone who never wrote it. The writer can only ever be themselves.
  or (scope = 'workspace' and user_id = auth.uid() and public.team_role(team_id) in ('owner','admin')));
drop policy if exists ws_delete on public.workspace_settings;
create policy ws_delete on public.workspace_settings for delete to authenticated using (
  (scope = 'user' and user_id = auth.uid())
  or (scope = 'workspace' and public.team_role(team_id) in ('owner','admin')));
-- Deliberate asymmetry: a member may READ a workspace setting but only owner/admin may WRITE it;
-- every user owns their own scope='user' row outright. A second, independent instance of
-- MO-PAID-082's role model.
revoke all on table public.workspace_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_settings to authenticated;

commit;

-- down:
--   drop policy if exists ws_select on public.workspace_settings;
--   drop policy if exists ws_insert on public.workspace_settings;
--   drop policy if exists ws_update on public.workspace_settings;
--   drop policy if exists ws_delete on public.workspace_settings;
--   drop index if exists public.workspace_settings_scope_owner_key;
--   drop table if exists public.workspace_settings;
--   drop function if exists public.accept_team_invite(text);

-- readback:
--   select c.relname, c.relrowsecurity, count(p.polname) from pg_class c
--     left join pg_policy p on p.polrelid = c.oid
--    where c.relnamespace='public'::regnamespace and c.relname='workspace_settings' group by 1,2;
--   -- expected: workspace_settings t 4
--   select proname, prosecdef, pg_get_function_identity_arguments(oid) from pg_proc
--    where pronamespace='public'::regnamespace and proname='accept_team_invite';
--   -- expected: accept_team_invite t "p_token text"
