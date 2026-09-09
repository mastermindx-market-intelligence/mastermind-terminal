-- Ledger row: 0020_team_ownership_transfer / PR pending (open, packet B-F12-9); not applied
-- Rollback: drop function if exists public.transfer_team_ownership(uuid, uuid) cascade;
-- 0020: atomic team ownership transfer — demote-then-promote, owner-only, admin recipient (packet B-F12-9).
--
-- ============================ MUST NOT BE APPLIED BY THIS PACKET ============================
-- Shipping this file alone does NOT change production. Applying DDL to {ref} is an out-of-band
-- Meta-CEO act with a pre/post catalog readback posted on the pull request. This file defines a
-- dollar-quoted function containing semicolons, so it must never be pushed through the naive
-- split-on-semicolon Management-API endpoint (the 0006-style warning).
-- ============================================================================================
--
-- Idempotent per supabase/migrations/README.md: there is no migration ledger for {ref}, so every
-- file must be safe to re-run from 0001.
--
-- TWO-ORGANISMS LAW (UWP-R2): nothing here reads or writes profiles.is_pro. Entitlement
-- authority stays with macro-api. A team grants nothing.
--
-- Seat ruling R1: this packet owns prefix 0020. The frozen spec claimed 0019; 0019 is B-F12-8's
-- team_role_changes file on the base branch and is never edited here.
--
-- Audit rows are written only by 0019's log_team_role_change trigger on public.team_members.
-- This function never inserts, updates, or deletes public.team_role_changes, and it never
-- INSERTS into public.team_members (including never inserting role = 'owner').

create or replace function public.transfer_team_ownership(
  p_team uuid,
  p_new_owner_user_id uuid
)
returns table (
  success boolean,
  message text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_caller_id uuid := auth.uid();
  v_current_owner_id uuid;
  v_current_owner_role text;
  v_new_owner_role text;
  v_demoted int;
  v_promoted int;
begin
  if v_caller_id is null then
    return query select false, 'not_signed_in'::text;
    return;
  end if;

  -- Read the owner before taking the lock so a caller who was never the owner
  -- returns owner_only without waiting. Concurrent callers who both pass this
  -- check then serialize on the advisory lock; the second re-reads and returns
  -- conflict (seat ruling R2).
  select user_id, role into v_current_owner_id, v_current_owner_role
    from public.team_members
   where team_id = p_team and role = 'owner';

  if v_current_owner_id is null then
    return query select false, 'team_not_found'::text;
    return;
  end if;

  if v_current_owner_id <> v_caller_id then
    return query select false, 'owner_only'::text;
    return;
  end if;

  if p_new_owner_user_id = v_current_owner_id then
    return query select false, 'same_owner'::text;
    return;
  end if;

  select role into v_new_owner_role
    from public.team_members
   where team_id = p_team and user_id = p_new_owner_user_id;

  if v_new_owner_role is null then
    return query select false, 'not_on_team'::text;
    return;
  end if;

  if v_new_owner_role <> 'admin' then
    return query select false, 'transfer_requires_admin'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_team::text));

  select user_id, role into v_current_owner_id, v_current_owner_role
    from public.team_members
   where team_id = p_team and role = 'owner'
   for update;

  if v_current_owner_id is null or v_current_owner_id <> v_caller_id then
    return query select false, 'conflict'::text;
    return;
  end if;

  select role into v_new_owner_role
    from public.team_members
   where team_id = p_team and user_id = p_new_owner_user_id
   for update;

  if v_new_owner_role is null then
    return query select false, 'conflict'::text;
    return;
  end if;

  if v_new_owner_role <> 'admin' then
    return query select false, 'conflict'::text;
    return;
  end if;

  -- Demote first so a second owner never exists. SECURITY DEFINER bypasses the
  -- 0019 tm_update_admin USING (role <> 'owner') gate; the function itself is
  -- the write gate. If the promote fails, restore the demotion before returning
  -- so this statement never commits a team with zero owners.
  update public.team_members
     set role = 'admin'
   where team_id = p_team
     and user_id = v_current_owner_id
     and role = 'owner';
  get diagnostics v_demoted = row_count;
  if v_demoted <> 1 then
    return query select false, 'conflict'::text;
    return;
  end if;

  update public.team_members
     set role = 'owner'
   where team_id = p_team
     and user_id = p_new_owner_user_id
     and role = 'admin';
  get diagnostics v_promoted = row_count;
  if v_promoted <> 1 then
    update public.team_members
       set role = 'owner'
     where team_id = p_team
       and user_id = v_current_owner_id
       and role = 'admin';
    return query select false, 'conflict'::text;
    return;
  end if;

  return query select true, 'transfer_success'::text;
end;
$$;

comment on function public.transfer_team_ownership(uuid, uuid) is
  'Atomically demote the current owner to administrator and promote an administrator to owner. Callable only by authenticated. The caller must be the current owner. Never inserts a membership row. Audit rows come from the 0019 log_team_role_change trigger.';

revoke all on function public.transfer_team_ownership(uuid, uuid) from public;
revoke execute on function public.transfer_team_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated;

-- readback: run against the live project to confirm this migration is applied.
--   select proname, prosecdef, pg_get_function_identity_arguments(oid)
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname = 'transfer_team_ownership';
--   select pg_get_functiondef(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'transfer_team_ownership';
--   select has_function_privilege('anon', 'public.transfer_team_ownership(uuid,uuid)', 'execute') as anon_exec,
--          has_function_privilege('authenticated', 'public.transfer_team_ownership(uuid,uuid)', 'execute') as auth_exec;
--   select proconfig from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'transfer_team_ownership';

-- down:
--   drop function if exists public.transfer_team_ownership(uuid, uuid) cascade;
