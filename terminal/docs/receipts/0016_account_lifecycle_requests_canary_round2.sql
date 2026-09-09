create schema if not exists canary_b_f12_4_r2;

create table if not exists canary_b_f12_4_r2.account_lifecycle_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,
  status        text not null default 'received',
  receipt_code  text not null,
  requested_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table canary_b_f12_4_r2.account_lifecycle_requests is
  'User-visible intake + receipt for account data export / deletion requests. Owner-readable, insert-only for the owner; status is advanced by the operator (service_role). No email or token is stored here - the address is read from the session at display time.';
comment on column canary_b_f12_4_r2.account_lifecycle_requests.receipt_code is
  'Human-readable reference shown to the user, e.g. MMX-DEL-20260906-3F7K2Q8A. Not a secret and not an authorization token.';

create unique index if not exists canary_b_f12_4_r2_account_lifecycle_receipt_code
  on canary_b_f12_4_r2.account_lifecycle_requests (receipt_code);
create index if not exists canary_b_f12_4_r2_account_lifecycle_user
  on canary_b_f12_4_r2.account_lifecycle_requests (user_id, requested_at desc);
create unique index if not exists canary_b_f12_4_r2_account_lifecycle_one_open_deletion
  on canary_b_f12_4_r2.account_lifecycle_requests (user_id)
  where kind = 'deletion' and status in ('received', 'in_progress');

alter table canary_b_f12_4_r2.account_lifecycle_requests enable row level security;

do $$ begin
  create policy "canary_b_f12_4_r2_account_lifecycle_select_own" on canary_b_f12_4_r2.account_lifecycle_requests
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "canary_b_f12_4_r2_account_lifecycle_insert_own" on canary_b_f12_4_r2.account_lifecycle_requests
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
