-- Ledger row: 0034_api_watchlist_write / PR #1018 (open, packet B-F12-WATCHLIST-WRITE); not applied
-- Personal watchlist additions only; original key scopes remain unchanged.
-- Rollback: revoke execute on function public.api_v1_add_watchlist_symbol(uuid,uuid,uuid,text,text,text) from service_role;

-- One DO statement is one transaction under the statement-at-a-time management runner.
-- New function privileges and receipt RLS are installed atomically with the schema.
do $migration$
begin
perform set_config('lock_timeout','3s',true);
alter table public.api_keys drop constraint if exists api_keys_scopes_read;
alter table public.api_keys add constraint api_keys_scopes_read check (
  scopes = array['read']::text[] or scopes = array['read','watchlists:write']::text[]
);
comment on table public.api_keys is 'Personal API keys. Read-only by default; newly minted keys may opt into watchlist additions. Digests and salts are not client-readable.';

create table if not exists public.api_v1_write_receipts (
  key_id uuid not null references public.api_keys(key_id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_.:-]{16,128}$'),
  request_payload jsonb not null,
  status integer not null check (status in (200,201)),
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key_id,request_id)
);
alter table public.api_v1_write_receipts enable row level security;
revoke all on table public.api_v1_write_receipts from public,anon,authenticated,service_role;

create or replace function public.api_key_authenticate(p_key_prefix text, p_key_digest text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  stored_digest text;
  kid uuid;
  uid uuid;
  rev timestamptz;
  minute_start timestamptz;
  day_start timestamptz;
  minute_count int;
  day_count int;
  remaining int;
  retry_after int;
  matched boolean;
  key_scopes text[];
begin
  if p_key_prefix is null or char_length(p_key_prefix) <> 8
     or p_key_digest is null or p_key_digest !~ '^[A-Za-z0-9+/]{43}=$' then
    return null;
  end if;

  select k.key_digest, k.key_id, k.user_id, k.revoked_at, k.scopes
    into stored_digest, kid, uid, rev, key_scopes
    from public.api_keys k
   where k.key_prefix = p_key_prefix
     and k.key_digest = p_key_digest;

  matched := stored_digest is not null and rev is null;

  if not matched then
    return null;
  end if;

  minute_start := date_trunc('minute', timezone('utc', now()));
  day_start := date_trunc('day', timezone('utc', now()));

  insert into public.api_key_usage (key_id, window_start, window_seconds, count)
  values (kid, minute_start, 60, 1)
  on conflict (key_id, window_start, window_seconds)
  do update set count = public.api_key_usage.count + 1
  returning count into minute_count;

  insert into public.api_key_usage (key_id, window_start, window_seconds, count)
  values (kid, day_start, 86400, 1)
  on conflict (key_id, window_start, window_seconds)
  do update set count = public.api_key_usage.count + 1
  returning count into day_count;

  update public.api_keys
     set last_used_at = timezone('utc', now())
   where key_id = kid;

  remaining := greatest(0, 60 - minute_count);
  if minute_count > 60 or day_count > 5000 then
    retry_after := case
      when minute_count > 60 then greatest(1, 60 - extract(second from timezone('utc', now()))::int)
      else greatest(1, (86400 - extract(epoch from (timezone('utc', now()) - day_start)))::int)
    end;
    return jsonb_build_object(
      'user_id', uid,
      'key_id', kid,
      'scopes', to_jsonb(key_scopes),
      'rate_limited', true,
      'retry_after', retry_after,
      'limit', 60,
      'remaining', 0
    );
  end if;

  return jsonb_build_object(
    'user_id', uid,
    'key_id', kid,
      'scopes', to_jsonb(key_scopes),
    'rate_limited', false,
    'retry_after', null,
    'limit', 60,
    'remaining', remaining
  );
end;
$$;

revoke all on function public.api_key_authenticate(text, text) from public, anon, authenticated;
grant execute on function public.api_key_authenticate(text, text) to service_role;

create or replace function public.api_v1_add_watchlist_symbol(
  p_key_id uuid, p_user_id uuid, p_watchlist_id uuid,
  p_request_id text, p_symbol text, p_section text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, extensions
set lock_timeout = '3s'
as $$
declare
  k public.api_keys%rowtype;
  receipt public.api_v1_write_receipts%rowtype;
  payload jsonb;
  body jsonb;
  inserted_id uuid;
  item public.watchlist_symbols%rowtype;
  result_status int;
begin
  if p_key_id is null or p_user_id is null then
    return jsonb_build_object('status',401,'error','unauthorized');
  end if;
  -- Serialize every operation of the same key, including reuse against another list.
  -- Revoke and owner deletion serialize on the same row; no successful replay bypasses them.
  select * into k from public.api_keys where key_id=p_key_id for update;
  if not found or k.user_id<>p_user_id or k.revoked_at is not null then
    return jsonb_build_object('status',401,'error','unauthorized');
  end if;
  if not ('watchlists:write'=any(k.scopes)) then
    return jsonb_build_object('status',403,'error','forbidden');
  end if;
  if p_watchlist_id is null or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_.:-]{16,128}$'
     or p_symbol is null or char_length(p_symbol) not between 1 and 128 or p_symbol<>upper(btrim(p_symbol)) or p_symbol ~ '[[:cntrl:]]'
     or p_section is null or char_length(p_section)>80 or p_section ~ '[[:cntrl:]]' then
    return jsonb_build_object('status',400,'error','invalid_request');
  end if;
  -- Shared/team visibility is not ownership. Lock parent before checking/replaying membership.
  perform 1 from public.watchlists where id=p_watchlist_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('status',404,'error','not_found'); end if;
  payload:=jsonb_build_object('path','/api/v1/watchlists/'||p_watchlist_id::text||'/symbols',
                            'symbol',p_symbol,'section',p_section);
  select * into receipt from public.api_v1_write_receipts where key_id=p_key_id and request_id=p_request_id;
  if found then
    if receipt.request_payload<>payload then
      return jsonb_build_object('status',409,'error','idempotency_conflict');
    end if;
    return jsonb_build_object('status',receipt.status,'body',receipt.response_body,'replayed',true);
  end if;
  insert into public.watchlist_symbols(watchlist_id,symbol,section,position)
    select p_watchlist_id,p_symbol,p_section,coalesce(max(position),-1)+1
      from public.watchlist_symbols where watchlist_id=p_watchlist_id
    on conflict(watchlist_id,symbol) do nothing returning id into inserted_id;
  select * into strict item from public.watchlist_symbols where watchlist_id=p_watchlist_id and symbol=p_symbol;
  result_status:=case when inserted_id is null then 200 else 201 end;
  body:=jsonb_build_object('schema','mm.api.v1.watchlist_symbol','version','2026-10-15',
    'asof',to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data',jsonb_build_object('watchlist_id',p_watchlist_id,'symbol',item.symbol,'section',item.section,
                             'position',item.position,'added',inserted_id is not null));
  insert into public.api_v1_write_receipts(key_id,request_id,request_payload,status,response_body)
    values(p_key_id,p_request_id,payload,result_status,body);
  return jsonb_build_object('status',result_status,'body',body,'replayed',false);
exception when lock_not_available or query_canceled or deadlock_detected then
  return jsonb_build_object('status',503,'error','unavailable','retry_after',3);
end;
$$;
revoke all on function public.api_v1_add_watchlist_symbol(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.api_v1_add_watchlist_symbol(uuid,uuid,uuid,text,text,text) to service_role;

end;
$migration$;

-- down:
-- Revoke the new write capability only; preserve stored receipts and memberships.
-- revoke execute on function public.api_v1_add_watchlist_symbol(uuid,uuid,uuid,text,text,text) from service_role;
-- readback:
-- select to_regclass('public.api_v1_write_receipts');
-- select has_function_privilege('service_role','public.api_v1_add_watchlist_symbol(uuid,uuid,uuid,text,text,text)','execute');
-- select has_function_privilege('authenticated','public.api_v1_add_watchlist_symbol(uuid,uuid,uuid,text,text,text)','execute');
