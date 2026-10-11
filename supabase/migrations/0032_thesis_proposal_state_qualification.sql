-- Ledger row: 0032_thesis_proposal_state_qualification / PR #946 (open, packet B-F11-PROPOSAL-STATE-SQL); not applied
-- Rollback: restore only set_thesis_amendment_state(uuid,text) from 0025, retaining owner and ACL.
-- Fix the installed proposal RPC: RETURNS TABLE output variables must not
-- collide with UPDATE predicate columns. No table, grant, policy or data change.
-- Existing signature, owner, SECURITY DEFINER, search_path and ACL are preserved.

create or replace function public.set_thesis_amendment_state(
  p_proposal_id uuid,
  p_new_state text
)
returns table (
  status text,
  proposal_id uuid,
  state text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.thesis_amendment_proposals%rowtype;
begin
  status := 'not_found';
  proposal_id := null;
  state := null;

  if v_actor is null or p_proposal_id is null then
    return next;
    return;
  end if;

  if p_new_state is null or p_new_state not in ('accepted', 'rejected') then
    status := 'invalid_transition';
    return next;
    return;
  end if;

  select p.* into v_row
  from public.thesis_amendment_proposals as p
  join public.theses as t on t.id = p.thesis_id and t.user_id = v_actor
  where p.proposal_id = p_proposal_id
  for update of p;

  if not found then
    status := 'not_found';
    return next;
    return;
  end if;

  if v_row.state <> 'proposed' then
    status := 'invalid_transition';
    proposal_id := v_row.proposal_id;
    state := v_row.state;
    return next;
    return;
  end if;

  if p_new_state = 'accepted' then
    update public.thesis_amendment_proposals as p
       set state = 'superseded'
     where p.thesis_id = v_row.thesis_id
       and p.amended_from = v_row.amended_from
       and p.state = 'proposed'
       and p.proposal_id <> v_row.proposal_id;
  end if;

  update public.thesis_amendment_proposals as p
     set state = p_new_state
   where p.proposal_id = v_row.proposal_id;

  status := 'ok';
  proposal_id := v_row.proposal_id;
  state := p_new_state;
  return next;
end
$$;

-- down:
-- Restore only the prior set_thesis_amendment_state(uuid,text) definition from 0025.
-- This reintroduces the ambiguity and is for emergency rollback only.
-- Do not replay the table/policy/grant statements from that historical migration.
-- create or replace function public.set_thesis_amendment_state( p_proposal_id uuid, p_new_state text ) returns table ( status text, proposal_id uuid, state text ) language plpgsql security definer set search_path = pg_catalog, public, auth as $$ declare v_actor uuid := auth.uid(); v_row public.thesis_amendment_proposals%rowtype; begin status := 'not_found'; proposal_id := null; state := null; if v_actor is null or p_proposal_id is null then return next; return; end if; if p_new_state is null or p_new_state not in ('accepted', 'rejected') then status := 'invalid_transition'; return next; return; end if; select p.* into v_row from public.thesis_amendment_proposals as p join public.theses as t on t.id = p.thesis_id and t.user_id = v_actor where p.proposal_id = p_proposal_id for update of p; if not found then status := 'not_found'; return next; return; end if; if v_row.state <> 'proposed' then status := 'invalid_transition'; proposal_id := v_row.proposal_id; state := v_row.state; return next; return; end if; if p_new_state = 'accepted' then update public.thesis_amendment_proposals set state = 'superseded' where thesis_id = v_row.thesis_id and amended_from = v_row.amended_from and state = 'proposed' and proposal_id <> v_row.proposal_id; end if; update public.thesis_amendment_proposals set state = p_new_state where proposal_id = v_row.proposal_id; status := 'ok'; proposal_id := v_row.proposal_id; state := p_new_state; return next; end $$;

-- readback:
-- select p.proname, pg_get_functiondef(p.oid) as definition, pg_get_userbyid(p.proowner) as owner,
--        p.prosecdef, p.proconfig, p.proacl
-- from pg_proc p
-- where p.oid = 'public.set_thesis_amendment_state(uuid,text)'::regprocedure;
