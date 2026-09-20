-- Ledger row: 0025_thesis_amendment_proposals / PR #577 (merged 4169e0cf, packet B-F11-5); applied 2026-09-19
-- Rollback: drop function if exists public.set_thesis_amendment_state(uuid, text); drop trigger if exists thesis_amendment_proposals_guard on public.thesis_amendment_proposals; drop function if exists public.thesis_amendment_proposals_guard(); drop table if exists public.thesis_amendment_proposals;
--
-- 0025: thesis_amendment_proposals — propose-only assistant amendments (packet B-F11-5).
-- Binding contract: MO-PAID-054 write-back. A chat turn may INSERT a proposed row; it may not
-- UPDATE or DELETE a theses head, a published thesis_versions row, or any evidence row.
-- Accepting a proposal NEVER publishes a version: it marks state=accepted. Publishing stays
-- the human's existing apply_thesis_version_v1 path (ARCHITECTURE §7.3 immutability).
--
-- Prefix 0025 (next free after 0024 on master). Shipped UNAPPLIED — the seat applies after merge.
-- Idempotent per supabase/migrations/README.md. Never logs body text. Never prints the project
-- reference.

begin;

create table if not exists public.thesis_amendment_proposals (
  proposal_id   uuid primary key default gen_random_uuid(),
  thesis_id     uuid not null references public.theses (id),
  amended_from  uuid not null references public.thesis_versions (id),
  body          text not null check (length(btrim(body)) between 1 and 12000),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  proposed_by   text not null check (proposed_by = 'assistant'),
  state         text not null default 'proposed' check (state in ('proposed', 'accepted', 'rejected', 'superseded')),
  created_at    timestamptz not null default now()
);

comment on table public.thesis_amendment_proposals is
  'Propose-only assistant amendments to a thesis (MO-PAID-054). Owner-only. Body, evidence_refs, amended_from and created_at are immutable. State changes only through set_thesis_amendment_state.';

create index if not exists thesis_amendment_proposals_thesis
  on public.thesis_amendment_proposals (thesis_id, created_at desc);
create index if not exists thesis_amendment_proposals_amended_from
  on public.thesis_amendment_proposals (amended_from, state);

alter table public.thesis_amendment_proposals enable row level security;

-- Owner-only through the existing thesis ownership predicate from migration 0012
-- (0012_thesis_objects.sql:59-61: `using (auth.uid() = user_id)` on public.theses).
-- Reused here as EXISTS so this table never grows its own user_id column and cannot
-- disagree with the thesis head about who owns the row.
do $$ begin
  create policy thesis_amendment_proposals_select_own on public.thesis_amendment_proposals
    for select to authenticated
    using (exists (
      select 1 from public.theses t
      where t.id = thesis_id and t.user_id = auth.uid()
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy thesis_amendment_proposals_insert_own on public.thesis_amendment_proposals
    for insert to authenticated
    with check (
      proposed_by = 'assistant'
      and state = 'proposed'
      and exists (
        select 1 from public.theses t
        where t.id = thesis_id and t.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

-- No UPDATE policy: authenticated sessions cannot change a row through PostgREST.
-- No DELETE policy: a proposal its subject can erase is not a proposal.
revoke all on table public.thesis_amendment_proposals from public;
revoke all on table public.thesis_amendment_proposals from anon, authenticated;
grant select, insert on table public.thesis_amendment_proposals to authenticated;

create or replace function public.thesis_amendment_proposals_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.thesis_versions tv
      where tv.id = new.amended_from and tv.thesis_id = new.thesis_id
    ) then
      raise exception 'amended_from does not belong to thesis_id';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.body is distinct from old.body
       or new.evidence_refs is distinct from old.evidence_refs
       or new.amended_from is distinct from old.amended_from
       or new.created_at is distinct from old.created_at
       or new.thesis_id is distinct from old.thesis_id
       or new.proposal_id is distinct from old.proposal_id
       or new.proposed_by is distinct from old.proposed_by then
      raise exception 'thesis amendment proposal fields are immutable';
    end if;
    return new;
  end if;
  return new;
end
$$;

drop trigger if exists thesis_amendment_proposals_guard on public.thesis_amendment_proposals;
create trigger thesis_amendment_proposals_guard
  before insert or update on public.thesis_amendment_proposals
  for each row execute function public.thesis_amendment_proposals_guard();

-- State transitions ONLY through this function. Owner check inside. proposed → accepted|rejected.
-- Accepting supersedes other proposed rows on the same amended_from.
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
    update public.thesis_amendment_proposals
       set state = 'superseded'
     where thesis_id = v_row.thesis_id
       and amended_from = v_row.amended_from
       and state = 'proposed'
       and proposal_id <> v_row.proposal_id;
  end if;

  update public.thesis_amendment_proposals
     set state = p_new_state
   where proposal_id = v_row.proposal_id;

  status := 'ok';
  proposal_id := v_row.proposal_id;
  state := p_new_state;
  return next;
end
$$;

alter function public.set_thesis_amendment_state(uuid, text) owner to postgres;
revoke all on function public.set_thesis_amendment_state(uuid, text) from public, anon, authenticated;
grant execute on function public.set_thesis_amendment_state(uuid, text) to authenticated;

revoke all on function public.thesis_amendment_proposals_guard() from public, anon, authenticated;

commit;

-- down:
-- begin;
-- drop function if exists public.set_thesis_amendment_state(uuid, text);
-- drop trigger if exists thesis_amendment_proposals_guard on public.thesis_amendment_proposals;
-- drop function if exists public.thesis_amendment_proposals_guard();
-- drop policy if exists thesis_amendment_proposals_insert_own on public.thesis_amendment_proposals;
-- drop policy if exists thesis_amendment_proposals_select_own on public.thesis_amendment_proposals;
-- drop index if exists public.thesis_amendment_proposals_amended_from;
-- drop index if exists public.thesis_amendment_proposals_thesis;
-- drop table if exists public.thesis_amendment_proposals;
-- commit;

-- readback:
-- Post-apply verification (run manually against the target database):
--
-- select relname, relrowsecurity from pg_class
--   where relname = 'thesis_amendment_proposals' and relnamespace = 'public'::regnamespace;
--   -- expect relrowsecurity = true
--
-- select schemaname, tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'thesis_amendment_proposals'
--   order by policyname;
--   -- expect exactly: thesis_amendment_proposals_insert_own (INSERT),
--   -- thesis_amendment_proposals_select_own (SELECT). No UPDATE. No DELETE.
--
-- select pg_get_constraintdef(c.oid)
--   from pg_constraint c
--   join pg_class t on t.oid = c.conrelid
--  where t.relname = 'thesis_amendment_proposals' and t.relnamespace = 'public'::regnamespace
--  order by c.conname;
--   -- expect proposed_by = 'assistant'; state in (proposed, accepted, rejected, superseded);
--   -- FKs to theses and thesis_versions
--
-- select tgname from pg_trigger
--  where tgrelid = 'public.thesis_amendment_proposals'::regclass and not tgisinternal;
--   -- expect thesis_amendment_proposals_guard
--
-- select p.proname, p.prosecdef, p.proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'set_thesis_amendment_state';
--   -- expect prosecdef = true; proconfig carries search_path
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'thesis_amendment_proposals'
--  order by grantee, privilege_type;
--   -- expect select and insert to authenticated; no update, no delete, no public/anon
