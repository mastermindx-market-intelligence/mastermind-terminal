-- Ledger row: MO-PAID-052 / packet B-F12-B5-1 (explicit grants); prefix ruled by the seat at launch (next free >= 0021)
-- Rollback: drop trigger if exists resource_grants_revoke_is_terminal on public.resource_grants; drop function if exists public.resource_grants_guard(); drop policy if exists watchlists_granted_read on public.watchlists; drop policy if exists wls_granted_read on public.watchlist_symbols; drop function if exists public.has_active_grant(text, uuid); drop function if exists public.owns_watchlist(uuid); drop table if exists public.resource_grants;
-- 0021: resource_grants -- one owner lets one named account READ one of their rows.
--
-- NOT APPLIED by packet B-F12-B5-1. Applying is a separate privileged act performed by the
-- Meta-CEO B seat out of band, with the `-- readback:` block at the foot of this file posted
-- as a receipt on the pull request before README.md's application table is updated.
--
-- This file defines functions with dollar-quoted bodies containing semicolons (the 0006-style
-- warning, restated by 0014): do NOT push it through the naive split-on-semicolon Management
-- API endpoint.
--
-- Idempotent per supabase/migrations/README.md "Every file must stay re-runnable": this
-- project has no migration ledger, so a future session may replay 0001..0021 in order.

begin;

create table if not exists public.resource_grants (
  id              uuid primary key default gen_random_uuid(),
  resource_kind   text not null check (resource_kind in ('watchlist')),
  resource_id     uuid not null,
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  granted_by      uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  constraint resource_grants_not_self check (grantee_user_id <> granted_by)
);

comment on table public.resource_grants is
  'One owner lets one named account READ one row. Read-only, revocable, never a public link: there is no token column and no anon policy. A revoked row is kept as the audit record of the share, never deleted.';

-- No foreign key to public.watchlists on purpose: resource_kind is the polymorphic key and a
-- second kind must not need a second column. The consequence is deliberate and tested: if the
-- owner deletes the list, the grant row survives but grants nothing, because every read below
-- joins through a row that no longer exists.

-- At most ONE live share per (kind, resource, grantee). A second share of the same list to the
-- same account converges on the existing row instead of minting a duplicate; a share that was
-- revoked does not block a fresh one.
create unique index if not exists resource_grants_live
  on public.resource_grants (resource_kind, resource_id, grantee_user_id)
  where revoked_at is null;
create index if not exists resource_grants_grantee
  on public.resource_grants (grantee_user_id, resource_kind) where revoked_at is null;
create index if not exists resource_grants_owner
  on public.resource_grants (granted_by, resource_kind, created_at desc);

-- Two SECURITY DEFINER helpers with a fixed search_path, exactly the 0014 pattern
-- (is_team_member / team_role). NEITHER TAKES A USER ID: both read auth.uid() internally, so
-- neither can be used to probe whether some OTHER account can see a row. Being definer-owned is
-- also what keeps the policies below from recursing: the watchlists policy reads resource_grants
-- through has_active_grant, and the resource_grants insert policy reads watchlists through
-- owns_watchlist, and neither read re-enters RLS.
create or replace function public.has_active_grant(p_kind text, p_resource uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public, auth as $$
  select exists (
    select 1 from public.resource_grants g
     where g.resource_kind = p_kind
       and g.resource_id = p_resource
       and g.grantee_user_id = auth.uid()
       and g.revoked_at is null) $$;

create or replace function public.owns_watchlist(p_watchlist uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public, auth as $$
  select exists (
    select 1 from public.watchlists w
     where w.id = p_watchlist and w.user_id = auth.uid()) $$;

revoke all on function public.has_active_grant(text, uuid), public.owns_watchlist(uuid) from public, anon;
grant execute on function public.has_active_grant(text, uuid), public.owns_watchlist(uuid) to authenticated;

-- Revocation is terminal, and the immutable fields are immutable. Column-level UPDATE grants
-- (below) already narrow a writer to revoked_at; this trigger is the belt to that braces, and it
-- is what makes "a withdrawn share can never be quietly reinstated" true against any writer that
-- reaches the table, including a future route bug.
create or replace function public.resource_grants_guard() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a withdrawn share cannot be changed' using errcode = '42501';
  end if;
  if new.resource_kind is distinct from old.resource_kind
     or new.resource_id is distinct from old.resource_id
     or new.grantee_user_id is distinct from old.grantee_user_id
     or new.granted_by is distinct from old.granted_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a share record cannot be re-pointed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists resource_grants_revoke_is_terminal on public.resource_grants;
create trigger resource_grants_revoke_is_terminal before update on public.resource_grants
  for each row execute function public.resource_grants_guard();

alter table public.resource_grants enable row level security;

-- Postgres has no `create policy if not exists`; this file must never DROP a live policy on a
-- shared table. Same duplicate_object wrapper 0016 and 0007 use.
do $$ begin
  create policy resource_grants_select_party on public.resource_grants
    for select to authenticated
    using (granted_by = auth.uid() or grantee_user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy resource_grants_insert_owner on public.resource_grants
    for insert to authenticated
    with check (
      granted_by = auth.uid()
      and grantee_user_id <> auth.uid()
      and resource_kind = 'watchlist'
      and public.owns_watchlist(resource_id));
exception when duplicate_object then null; end $$;

-- Only the person who made the share may withdraw it, and only while it is live.
do $$ begin
  create policy resource_grants_revoke_owner on public.resource_grants
    for update to authenticated
    using (granted_by = auth.uid() and revoked_at is null)
    with check (granted_by = auth.uid());
exception when duplicate_object then null; end $$;

-- No DELETE policy and no delete grant, on purpose: a share record that its author can erase is
-- not a record. Withdrawal is revoked_at, and the row stays.

-- The read the whole packet exists for. These are PERMISSIVE policies, so they OR with 0001's
-- watchlists_owner / wls_via_parent rather than replacing them: the owner keeps everything they
-- had, and a grantee gains SELECT and only SELECT.
do $$ begin
  create policy watchlists_granted_read on public.watchlists
    for select to authenticated
    using (public.has_active_grant('watchlist', id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy wls_granted_read on public.watchlist_symbols
    for select to authenticated
    using (public.has_active_grant('watchlist', watchlist_id));
exception when duplicate_object then null; end $$;

revoke all on table public.resource_grants from public;
revoke all on table public.resource_grants from anon, authenticated;
grant select, insert on table public.resource_grants to authenticated;
-- Column-level UPDATE: revoked_at is the only field a caller may ever write.
grant update (revoked_at) on table public.resource_grants to authenticated;

commit;

-- readback: (run after applying; the seat posts this output as the receipt)
--   select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname='public' and c.relname='resource_grants';                    -- expected: t
--   select policyname, cmd from pg_policies
--     where schemaname='public' and tablename='resource_grants' order by 1;
--     -- expected 3: resource_grants_insert_owner INSERT, resource_grants_revoke_owner UPDATE,
--     --             resource_grants_select_party SELECT
--   select policyname, cmd from pg_policies
--     where schemaname='public' and tablename in ('watchlists','watchlist_symbols') order by 1,2;
--     -- expected to now include watchlists_granted_read SELECT and wls_granted_read SELECT
--     -- alongside the pre-existing watchlists_owner ALL and wls_via_parent ALL
--   select proname, prosecdef from pg_proc
--     where pronamespace='public'::regnamespace
--       and proname in ('has_active_grant','owns_watchlist','resource_grants_guard') order by 1;
--     -- expected: all three prosecdef = t
--   select indexname from pg_indexes where schemaname='public' and tablename='resource_grants';
--   select tgname from pg_trigger where tgrelid='public.resource_grants'::regclass and not tgisinternal;
--     -- expected: resource_grants_revoke_is_terminal

-- down: drop trigger if exists resource_grants_revoke_is_terminal on public.resource_grants; drop function if exists public.resource_grants_guard(); drop policy if exists watchlists_granted_read on public.watchlists; drop policy if exists wls_granted_read on public.watchlist_symbols; drop function if exists public.has_active_grant(text, uuid); drop function if exists public.owns_watchlist(uuid); drop table if exists public.resource_grants;
--       -- WARNING: dropping the table destroys the record of every share ever made. Prefer revoking each grant.
