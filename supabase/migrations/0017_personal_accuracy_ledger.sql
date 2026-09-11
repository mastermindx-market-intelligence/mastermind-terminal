-- Ledger row: 0017_personal_accuracy_ledger / MO-DELTA-007 (F13-OPS-LEARNING) / packet B-F13-5 / PR #547 (merged b7aa0981); applied 2026-09-10
-- Rollback: drop table if exists public.user_claims;
-- 0017: user_claims — the append-only personal claim store the F13 accuracy ledger scores.
-- Design authority: macro research/.../MARKET_ONTOLOGY_F13_PERSONAL_ACCURACY_LEDGER_SPEC_2026-09-06.md §1.
-- NOT APPLIED by this packet. Idempotent per README.md ("every file must stay re-runnable").
-- Deliberately has NO team_id and NO reference to public.teams: §4 forbids any cross-user or team
-- scoreboard, and the non-ranking team rollup is DEFERRED, not adjudicated.

begin;

create table if not exists public.user_claims (
  claim_id           text primary key check (claim_id ~ '^[0-9a-f]{16}$'),
  user_id            uuid not null references auth.users(id) on delete cascade,
  subject            jsonb not null check (jsonb_typeof(subject) = 'object'
                       and subject ?& array['kind','id']
                       and subject->>'kind' in ('security','macro_series','basket')
                       and length(btrim(subject->>'id', ' ')) between 1 and 256),
  stated_at          timestamptz not null,
  resolves_at        timestamptz not null,
  claim_text         text not null check (length(claim_text) between 1 and 280),
  condition          jsonb not null check (jsonb_typeof(condition) = 'object'),
  stated_probability double precision check (stated_probability >= 0 and stated_probability <= 1),
  evidence           jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  status             text not null default 'open'
                       check (status in ('open','matured','resolved','void_unscorable','withdrawn')),
  resolution         jsonb check (resolution is null or jsonb_typeof(resolution) = 'object'),
  supersedes         text references public.user_claims(claim_id),
  created_at         timestamptz not null default now(),
  check (resolves_at > stated_at),
  check (status <> 'resolved' or resolution is not null)
);

comment on table public.user_claims is
  'Append-only personal claims scored by the F13 personal accuracy ledger (learning_only). Never an
   input to a signal, rank, size, gate, alert, price or entitlement; never aggregated across users.';

create index if not exists user_claims_owner_stated_idx
  on public.user_claims (user_id, stated_at desc, claim_id);
-- The five-part episode key of §3, so the scorer's group-by is an index scan, not a table scan.
create index if not exists user_claims_owner_episode_idx
  on public.user_claims (user_id, (subject->>'id'), (condition->>'metric'),
                         (condition->>'comparator'), (condition->>'threshold'), stated_at);
-- The worker's only scan: what has come due and not yet been settled.
create index if not exists user_claims_maturity_idx
  on public.user_claims (resolves_at) where status in ('open','matured');
create index if not exists user_claims_supersedes_idx
  on public.user_claims (supersedes) where supersedes is not null;

alter table public.user_claims enable row level security;

-- 0016_account_lifecycle_requests.sql:52-63 precedent: Postgres has no
-- `create policy if not exists`; never DROP a live policy in a re-runnable file.
do $$ begin
  create policy "user_claims_select_own" on public.user_claims
    for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "user_claims_insert_own" on public.user_claims
    for insert to authenticated
    with check (auth.uid() = user_id and status = 'open' and resolution is null);
exception when duplicate_object then null; end $$;

-- No UPDATE and no DELETE policy, on purpose (0016 precedent): a ledger its subject can rewrite is
-- not a ledger. §1 "Nothing is overwritten". Maturation and resolution are service_role writes made
-- by terminal/scripts/score_personal_accuracy.mjs, which bypasses RLS; a user correction is a NEW
-- row carrying `supersedes`, never an edit.
revoke all on table public.user_claims from public, anon;
grant select, insert on table public.user_claims to authenticated;

commit;

-- down:
-- begin;
-- drop policy if exists user_claims_insert_own on public.user_claims;
-- drop policy if exists user_claims_select_own on public.user_claims;
-- drop index if exists public.user_claims_supersedes_idx;
-- drop index if exists public.user_claims_maturity_idx;
-- drop index if exists public.user_claims_owner_episode_idx;
-- drop index if exists public.user_claims_owner_stated_idx;
-- drop table if exists public.user_claims;
-- commit;
-- WARNING: this destroys every claim a user ever wrote down. Prefer leaving the table in place.

-- readback:
-- select relname, relrowsecurity from pg_class
--   where relname = 'user_claims' and relnamespace = 'public'::regnamespace;  -- expect true
-- select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='user_claims' order by 1;
--   -- expect exactly: user_claims_insert_own (INSERT), user_claims_select_own (SELECT)
-- select indexname from pg_indexes where schemaname='public' and tablename='user_claims';
--   -- expect user_claims_owner_stated_idx, user_claims_owner_episode_idx,
--   --         user_claims_maturity_idx, user_claims_supersedes_idx plus the primary key
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name='user_claims' order by 1,2;
--   -- expect SELECT + INSERT to authenticated only; no UPDATE, no DELETE, nothing to anon
