"""Real PostgreSQL boundary proof; socket-only disposable database, no live service."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
import pytest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / 'supabase/migrations/0034_api_watchlist_write.sql'
A = '10000000-0000-4000-8000-000000000001'
B = '10000000-0000-4000-8000-000000000002'
KA = '20000000-0000-4000-8000-000000000001'
KB = '20000000-0000-4000-8000-000000000002'
KR = '20000000-0000-4000-8000-000000000003'
LA = '30000000-0000-4000-8000-000000000001'
LB = '30000000-0000-4000-8000-000000000002'
LA2 = '30000000-0000-4000-8000-000000000003'


def quote(value):
    return 'null' if value is None else "'" + str(value).replace("'", "''") + "'"


@pytest.fixture(scope='module')
def server(tmp_path_factory):
    for binary in ('initdb', 'pg_ctl', 'psql'):
        if not shutil.which(binary):
            pytest.skip(f'PostgreSQL binary missing: {binary}')
    base = tmp_path_factory.mktemp('api-write-pg')
    data = base / 'data'
    socket_dir = tempfile.TemporaryDirectory(prefix='f12sock-', dir='/tmp')
    sock = Path(socket_dir.name)
    subprocess.run(['initdb', '-D', str(data), '-U', 'postgres', '-A', 'trust',
                    '--no-locale', '--encoding=UTF8', '--no-sync'], check=True, capture_output=True)
    subprocess.run(['pg_ctl', '-D', str(data), '-l', str(base/'server.log'),
                    '-o', f"-k {sock} -h '' -p 55486", '-w', 'start'], check=True, capture_output=True)

    def run(sql, role=None, check=True):
        if role:
            assert role in ('anon', 'authenticated', 'service_role')
            sql = f'set role {role};' + sql
        result = subprocess.run(['psql', '-h', str(sock), '-p', '55486', '-U', 'postgres',
                                 '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                                input=sql, text=True, capture_output=True)
        if check:
            assert result.returncode == 0, result.stderr
            return result.stdout.strip()
        return result

    try:
        run("create role anon; create role authenticated; create role service_role bypassrls; "
            "create schema auth; create schema extensions; "
            "create extension pgcrypto with schema extensions; "
            "create table auth.users(id uuid primary key); "
            "create function auth.uid() returns uuid language sql stable as $$"
            "select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$; "
            "grant usage on schema public,auth to anon,authenticated,service_role; "
            "create table watchlists(id uuid primary key default gen_random_uuid(), "
            "user_id uuid not null references auth.users(id),name text not null,position int default 0,created_at timestamptz default now()); "
            "create table watchlist_symbols(id uuid primary key default gen_random_uuid(), "
            "watchlist_id uuid not null references watchlists(id) on delete cascade,symbol text not null, "
            "section text,position int default 0,created_at timestamptz default now()); "
            "create unique index wls_watchlist_symbol on watchlist_symbols(watchlist_id,symbol);")
        run((ROOT/'supabase/migrations/0027_api_keys.sql').read_text())
        # Preserve the existing auth function's owner, security-definer boundary and ACL.
        catalog = "select row(proowner,prosecdef,proconfig,proacl,pg_get_function_result(oid))::text from pg_proc where oid='public.api_key_authenticate(text,text)'::regprocedure"
        before = run(catalog)
        from scripts.supabase_apply import split_statements, idempotency_findings
        statements = split_statements(SQL.read_text())
        assert len(statements) == 1, "ACL/RLS and function creation must be atomic under management runner"
        assert not idempotency_findings(SQL.read_text(), statements)
        for statement in statements:
            run(statement)
        # Reapplication must preserve old keys and function privileges too.
        for statement in statements:
            run(statement)
        assert run(catalog) == before
        yield run
    finally:
        subprocess.run(['pg_ctl', '-D', str(data), '-m', 'fast', '-w', 'stop'], check=True, capture_output=True)
        socket_dir.cleanup()


@pytest.fixture
def pg(server):
    server('truncate api_keys cascade; truncate watchlists cascade; '
           f'insert into auth.users values ({quote(A)}),({quote(B)}) on conflict do nothing;')
    for kid, owner, prefix, scopes in ((KA, A, 'aaaaaaaa', ['read','watchlists:write']),
                                       (KB, B, 'bbbbbbbb', ['read','watchlists:write']),
                                       (KR, A, 'rrrrrrrr', ['read'])):
        server('insert into api_keys(key_id,user_id,key_prefix,key_digest,key_salt,label,scopes) values ('
               + ','.join(map(quote, [kid,owner,prefix,'A'*43+'=','A'*22+'==','isolated test']))
               + ',array[' + ','.join(map(quote, scopes)) + '])')
    for lid, owner in ((LA,A),(LA2,A),(LB,B)):
        server(f'insert into watchlists(id,user_id,name) values ({quote(lid)},{quote(owner)},{quote(lid)})')
    return server


def test_mint_scope_allowlist_cannot_upgrade_an_existing_key(pg):
    assert pg(f"select scopes::text from api_keys where key_id={quote(KR)}") == '{read}'
    pg(f"set request.jwt.claims='{{\"sub\":\"{A}\"}}'; "
       f"update api_keys set scopes=array['read','watchlists:write'] where key_id={quote(KR)}",
       role='authenticated', check=False)
    assert pg(f"select scopes::text from api_keys where key_id={quote(KR)}") == '{read}'
    for scopes in ("array['write']", "array['read','admin']", "array['watchlists:write']", "array[]::text[]"):
        denied = pg(f'update api_keys set scopes={scopes} where key_id={quote(KR)}', check=False)
        assert denied.returncode != 0, scopes


def test_authentication_returns_actual_scope_and_keeps_quota(pg):
    digest = quote('A'*43+'=')
    read = json.loads(pg(f"select api_key_authenticate('rrrrrrrr',{digest})", role='service_role'))
    write = json.loads(pg(f"select api_key_authenticate('aaaaaaaa',{digest})", role='service_role'))
    assert read['scopes'] == ['read']
    assert write['scopes'] == ['read','watchlists:write']
    # Drive the existing durable minute counter to its boundary rather than issue 60 requests.
    pg(f'update api_key_usage set count=60 where key_id={quote(KA)} and window_seconds=60')
    limited = json.loads(pg(f"select api_key_authenticate('aaaaaaaa',{digest})", role='service_role'))
    assert limited['rate_limited'] is True and limited['retry_after'] > 0
    pg(f'update api_keys set revoked_at=now() where key_id={quote(KA)}')
    assert pg(f"select api_key_authenticate('aaaaaaaa',{digest})", role='service_role') == ''

# The API delegates only its authenticated key ID, user ID and normalized operation.
# This adapter is bound to the installed signature during integration below.
WRITE_FN = 'api_v1_add_watchlist_symbol'


def write(pg, request='request-0000000001', symbol='AAPL', section='Watchlist',
          key=KA, user=A, target=LA, role='service_role'):
    return json.loads(pg(f'select {WRITE_FN}(' + ','.join(map(quote,[key,user,target,request,symbol,section])) + ')', role=role))


def status(result):
    return result['status']


def test_replay_is_same_response_after_removal_and_payload_changes_conflict(pg):
    original=write(pg)
    assert status(original) in (200,201)
    assert pg(f'select count(*) from watchlist_symbols where watchlist_id={quote(LA)}') == '1'
    again=write(pg)
    assert again['body'] == original['body'] and status(again) == status(original)
    assert again['replayed'] is True
    for change in ({'symbol':'MSFT'},{'section':'Different'},{'target':LA2}):
        assert status(write(pg,**change)) == 409
    pg(f'delete from watchlist_symbols where watchlist_id={quote(LA)}')
    assert write(pg)['body'] == original['body']
    assert pg(f'select count(*) from watchlist_symbols where watchlist_id={quote(LA)}') == '0'


def test_existing_membership_is_preserved(pg):
    pg(f"insert into watchlist_symbols(watchlist_id,symbol,section,position) values ({quote(LA)},'AAPL','Original',7)")
    before=pg('select row_to_json(s)::text from watchlist_symbols s')
    assert status(write(pg,section='Attempted replacement')) in (200,201)
    assert pg('select row_to_json(s)::text from watchlist_symbols s') == before


def test_owner_scope_and_revocation_are_rechecked_in_transaction(pg):
    assert status(write(pg,key=KR)) == 403
    assert status(write(pg,target=LB)) == 404
    assert status(write(pg,key=KB)) == 401
    first=write(pg)
    assert status(first) in (200,201)
    pg(f'update api_keys set revoked_at=now() where key_id={quote(KA)}')
    assert status(write(pg)) == 401
    assert pg('select count(*) from watchlist_symbols') == '1'


def test_replay_requires_current_list_ownership(pg):
    assert status(write(pg)) in (200,201)
    pg(f'update watchlists set user_id={quote(B)} where id={quote(LA)}')
    assert status(write(pg)) == 404


def test_same_key_concurrent_retries_commit_one_receipt_and_symbol(pg):
    with ThreadPoolExecutor(max_workers=6) as pool:
        replies=list(pool.map(lambda _:write(pg),range(6)))
    assert all(r['body']==replies[0]['body'] for r in replies)
    assert sum(not r['replayed'] for r in replies) == 1
    assert pg('select count(*) from watchlist_symbols') == '1'
    assert pg('select count(*) from api_v1_write_receipts') == '1'


def test_distinct_keys_and_requests_still_converge_on_one_membership(pg):
    # Two separately scoped keys belonging to the same user.
    pg(f'update api_keys set user_id={quote(A)} where key_id={quote(KB)}')
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies=list(pool.map(lambda key:write(pg,key=key),[KA,KB]))
    assert all(status(r) in (200,201) for r in replies)
    assert pg('select count(*) from watchlist_symbols') == '1'
    assert pg('select count(*) from api_v1_write_receipts') == '2'


def test_receipt_failure_rolls_back_membership(pg):
    pg("create function test_fail_receipt() returns trigger language plpgsql as $$begin raise exception 'test receipt failure'; end;$$; "
       "create trigger test_fail_receipt before insert on api_v1_write_receipts for each row execute function test_fail_receipt();")
    try:
        result=pg(f'select {WRITE_FN}(' + ','.join(map(quote,[KA,A,LA,'request-0000000001','AAPL','Watchlist'])) + ')',role='service_role',check=False)
        # A raised exception or a controlled error may be returned; neither may leak an insertion.
        if result.returncode == 0:
            assert status(json.loads(result.stdout)) >= 400
        assert pg('select count(*) from watchlist_symbols') == '0'
        assert pg('select count(*) from api_v1_write_receipts') == '0'
    finally:
        pg('drop trigger test_fail_receipt on api_v1_write_receipts; drop function test_fail_receipt()')


def test_direct_rpc_and_receipt_access_denied_to_browser_roles(pg):
    for role in ('anon','authenticated'):
        for query in ('select * from api_v1_write_receipts','delete from api_v1_write_receipts',
                      f'select {WRITE_FN}(' + ','.join(map(quote,[KA,A,LA,'request-0000000001','AAPL','Watchlist'])) + ')'):
            denied=pg(query,role=role,check=False)
            assert denied.returncode != 0 and 'permission denied' in denied.stderr
