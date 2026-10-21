"""Real-PostgreSQL enforcement proof for the protected frozen Options lifecycle CAS.

Every security property asserted here is exercised against an actual disposable
PostgreSQL cluster started on a private short Unix socket with TCP disabled
(``-h ''``, listen_addresses effectively empty). No ambient, configured or
provisioned database is touched, nothing is installed, and the fixture cluster
is the only server this file ever starts or stops.

Skips with an explicit reason when the PostgreSQL server binaries are missing;
it never claims static checks as database enforcement. Standard library only
(subprocess, concurrent.futures, ...); pytest is used when available for
discovery but is not required — run the file directly with python3 as well.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
import uuid as uuid_mod
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import pytest
except ImportError:  # direct python3 execution stays dependency-free
    pytest = None

HERE = Path(__file__).resolve().parent
LIFECYCLE_SQL = HERE / 'sql' / 'options_frozen_node' / 'proposed_lifecycle.sql'
A = '10000000-0000-4000-8000-000000000001'
B = '10000000-0000-4000-8000-000000000002'
ALERT_IDS = ['30000000-0000-4000-8000-00000000000%d' % n for n in range(1, 8)]
FROZEN_TYPE = 'opt_frozen_node_proximity'
ROLES = ('anon', 'authenticated', 'service_role')
RPCS = ('read_frozen_node_runtime(uuid,uuid,jsonb)',
        'arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)',
        'commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)')
RUNTIME_KEYS = sorted(['schema', 'alertId', 'principal', 'generation', 'createdAt',
                       'armingEpoch', 'predicate', 'revision', 'priorState'])
STATE_KEYS = sorted(['targetFingerprint', 'armingEpoch', 'lastQuoteAt', 'inside',
                     'withinPct', 'lastQuoteBasis'])
ISO_SIX = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$')

BASELINE = """
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.alerts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  condition jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now());
alter table public.alerts enable row level security;
create policy alerts_owner on public.alerts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.alerts to anon, authenticated, service_role;
"""


class Raw(str):
    """Verbatim JSON literal argument (already valid JSON text, no re-quoting)."""


def q(value):
    if value is None:
        return 'null'
    if isinstance(value, Raw):
        return "'" + str(value).replace("'", "''") + "'::jsonb"
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value).replace("'", "''") + "'"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def predicate(within_pct=0.25, **extra):
    p = {'type': FROZEN_TYPE, 'symbol': 'AAPL', 'target': 187.25, 'proximity_pct': 1.5}
    if within_pct is not None:
        p['within_pct'] = within_pct
    p.update(extra)
    return p


class Server:
    def __init__(self, data, sock_dir, port, log):
        self.data = Path(data)
        self.sock_dir = Path(sock_dir)
        self.port = port
        self.log = Path(log)

    def run(self, sql, role=None, claims=None, check=True):
        if role:
            assert role in ROLES, f'SET ROLE outside fixture allowlist: {role}'
            sql = f'set session authorization {role};' + sql
        if claims:
            sql = "set request.jwt.claims='" + json.dumps(claims).replace("'", "''") + "';" + sql
        result = subprocess.run(
            ['psql', '-h', str(self.sock_dir), '-p', str(self.port), '-U', 'postgres',
             '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
            input=sql, text=True, capture_output=True)
        if check:
            assert result.returncode == 0, f'sql failed: {result.stderr}\n--- {sql[:500]}'
            return result.stdout.strip()
        return result

    __call__ = run

    def clock(self):
        return self.run("select to_char(clock_timestamp() at time zone 'UTC',"
                        "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")

    def apply_lifecycle(self):
        self.run(LIFECYCLE_SQL.read_text())

    def version_num(self):
        return int(self.run("select current_setting('server_version_num')"))

    def stop(self):
        subprocess.run(['pg_ctl', '-D', str(self.data), '-m', 'fast', '-w', 'stop'],
                       capture_output=True, check=True)
        shutil.rmtree(self.sock_dir)




def make_server(base_dir):
    """Start the disposable socket-only cluster and apply baseline + lifecycle SQL.

    Returns (server, None) or (None, skip_reason); never raises for a missing
    environment and never installs anything.
    """
    for binary in ('initdb', 'pg_ctl', 'psql'):
        if not shutil.which(binary):
            return None, f'SKIP: PostgreSQL binary missing: {binary} (no installs per contract)'
    if not LIFECYCLE_SQL.exists():
        raise FileNotFoundError(LIFECYCLE_SQL)
    base = Path(base_dir)
    base.mkdir(parents=True, exist_ok=True)
    data = base / 'data'
    if data.exists():
        raise RuntimeError('fixture data directory already populated; preserve original fixture')
    sock_dir = tempfile.mkdtemp(prefix='fznsock-', dir='/tmp')
    os.chmod(sock_dir, 0o700)
    port = 55488  # Private Unix socket namespace; no TCP probe/listener.
    subprocess.run(['initdb', '-D', str(data), '-U', 'postgres', '-A', 'trust',
                    '--no-locale', '--encoding=UTF8', '--no-sync'],
                   check=True, capture_output=True)
    subprocess.run(['pg_ctl', '-D', str(data), '-l', str(base / 'server.log'), '-w', 'start',
                    '-o', f"-k {sock_dir} -h '' -p {port}"], check=True, capture_output=True)
    server = Server(data, sock_dir, port, base / 'server.log')
    try:
        version_num = server.version_num()
        if version_num < 130000:
            server.stop()
            return None, f"SKIP: PostgreSQL too old for pg_catalog.gen_random_uuid: {version_num}"
        server.run(BASELINE)
        server.run(f"insert into auth.users(id) values ('{A}'),('{B}')")
        server.apply_lifecycle()
        server.apply_lifecycle()  # source must be rerunnable: apply twice at startup
    except Exception as error:
        server.stop()
        shutil.rmtree(sock_dir, ignore_errors=True)
        raise RuntimeError(f'fixture initialization failed: {error}') from error
    return server, None


def reset(pg):
    pg('truncate public.alerts cascade')
    pg(f"insert into auth.users(id) values ('{A}'),('{B}') on conflict do nothing")


def insert_alert(pg, alert=ALERT_IDS[0], user=A, condition=None, active=True,
                 created_at=None, frozen_runtime=None, role=None, claims=None):
    if condition is None:
        condition = predicate()
    cond = condition if isinstance(condition, Raw) else Raw(json.dumps(condition))
    cols = ['id', 'user_id', 'symbol', 'condition', 'active']
    vals = [alert, user, 'AAPL', cond, active]
    if created_at is not None:
        cols.append('created_at')
        vals.append(created_at)
    if frozen_runtime is not None:
        cols.append('frozen_runtime')
        vals.append(Raw(json.dumps(frozen_runtime)))
    pg(f'delete from public.alerts where id={q(alert)}; '
       f"insert into public.alerts({','.join(cols)}) values ({','.join(q(v) for v in vals)})",
       role=role, claims=claims)


def get_runtime(pg, alert):
    out = pg(f"select coalesce(frozen_runtime::text,'null') from public.alerts where id={q(alert)}")
    return json.loads(out) if out else None


def get_active(pg, alert):
    return pg(f'select active from public.alerts where id={q(alert)}') == 't'


def call(pg, fn, args, role='service_role', claims=None):
    return json.loads(pg(f'select public.{fn}({",".join(q(a) for a in args)})',
                         role=role, claims=claims))


def call_raw(pg, fn, args, role='service_role', claims=None):
    return pg(f'select public.{fn}({",".join(q(a) for a in args)})',
              role=role, claims=claims, check=False)


def refused(pg, fn, args, role='service_role', claims=None):
    result = call_raw(pg, fn, args, role=role, claims=claims)
    assert result.returncode == 0, f'{fn} raised instead of a typed refusal: {result.stderr}'
    body = json.loads(result.stdout)
    assert body.get('kind') in ('unavailable', 'conflict'), body
    assert isinstance(body.get('reason'), str) and body['reason'], body
    return body


def armed(pg, alert=ALERT_IDS[0], user=A, pred=None, within_pct=0.25):
    pred = pred if pred is not None else predicate(within_pct=within_pct)
    insert_alert(pg, alert=alert, user=user, condition=pred)
    body = call(pg, 'arm_frozen_node_runtime', [alert, user, pred, None, None])
    assert body['kind'] == 'data', body
    return pred, body['runtime']


def make_state(pg, epoch, **over):
    s = {'targetFingerprint': 'sha256:target-0001', 'armingEpoch': epoch,
         'lastQuoteAt': pg.clock(), 'inside': True, 'withinPct': 0.25,
         'lastQuoteBasis': 'NBBO-mid'}
    s.update(over)
    return s


def iso_shift(text, seconds):
    moment = datetime.strptime(text, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)
    return (moment + timedelta(seconds=seconds)).strftime('%Y-%m-%dT%H:%M:%S.%f') + 'Z'


def assert_runtime_shape(runtime, alert, user, pred=None):
    assert sorted(runtime) == RUNTIME_KEYS, runtime
    assert runtime['schema'] == 'options.frozen_runtime/v1'
    assert runtime['alertId'] == alert and runtime['principal'] == user
    assert uuid_mod.UUID(runtime['generation'])
    assert isinstance(runtime['revision'], int) and runtime['revision'] >= 0
    for field in ('createdAt', 'armingEpoch'):
        assert ISO_SIX.match(runtime[field]), runtime[field]
    assert runtime['priorState'] is None or sorted(runtime['priorState']) == STATE_KEYS
    if pred is not None:
        assert runtime['predicate'] == pred
    assert not any(field in runtime for field in ('canFire', 'fire', 'granted', 'action'))

# ---------------------------------------------------------------------------
# 1. Schema contract: exactly one new column, nothing else in public, legacy
#    rows and CRUD untouched.
# ---------------------------------------------------------------------------
def test_only_adds_frozen_runtime_column_and_keeps_legacy(pg):
    assert pg("select data_type||' '||is_nullable||' '||coalesce(column_default,'none') "
              "from information_schema.columns where table_schema='public' "
              "and table_name='alerts' and column_name='frozen_runtime'") == 'jsonb YES none'
    assert pg("select count(*) from information_schema.tables "
              "where table_schema='public' and table_type='BASE TABLE'") == '1'
    assert pg("select string_agg(tgname,',' order by tgname) from pg_trigger "
              "where tgrelid='public.alerts'::regclass and not tgisinternal") == 'alerts_frozen_runtime_guard'
    plain = predicate(0.25, type='price_cross', symbol='MSFT')
    insert_alert(pg, alert=ALERT_IDS[6], condition=plain)
    assert get_runtime(pg, ALERT_IDS[6]) is None
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[6], A, plain, None, None])['reason'] == 'not_frozen_type'
    pg(f"update public.alerts set symbol='MSFT2' where id='{ALERT_IDS[6]}'",
       role='authenticated', claims={'sub': A})
    assert pg(f"select count(*) from public.alerts where id='{ALERT_IDS[6]}'",
              role='authenticated', claims={'sub': B}) == '0'
    pg(f"delete from public.alerts where id='{ALERT_IDS[6]}'",
       role='authenticated', claims={'sub': A})


# ---------------------------------------------------------------------------
# 2. Privileges: actual SQL role only; JWT role claim never escalates.
# ---------------------------------------------------------------------------
def test_rpc_executable_by_service_role_only_and_jwt_role_claim_cannot_escalate(pg):
    for signature in RPCS:
        assert pg(f"select has_function_privilege('anon','public.{signature}','execute')") == 'f'
        assert pg(f"select has_function_privilege('authenticated','public.{signature}','execute')") == 'f'
        assert pg(f"select has_function_privilege('service_role','public.{signature}','execute')") == 't'
    assert pg("select bool_and(not prosecdef) from pg_proc p join pg_namespace n on n.oid=pronamespace "
              "where n.nspname='public' and (p.proname like '%frozen_node%' "
              "or p.proname='alerts_frozen_runtime_guard')") == 't'
    for role in ('anon', 'authenticated'):
        for fn, args in (('read_frozen_node_runtime', [ALERT_IDS[0], A, predicate()]),
                         ('arm_frozen_node_runtime', [ALERT_IDS[0], A, predicate(), None, None]),
                         ('commit_frozen_node_state', [ALERT_IDS[0], A, predicate(), None, None, make_state_raw(pg)])):
            denied = call_raw(pg, fn, args, role=role,
                              claims={'sub': A, 'role': 'service_role'} if role == 'authenticated' else None)
            assert denied.returncode != 0 and 'permission denied' in denied.stderr, (role, fn)
    escalated = pg('set role service_role; select 1', role='authenticated', check=False)
    assert escalated.returncode != 0
    armed(pg)
    claimed = call_raw(pg, 'arm_frozen_node_runtime', [ALERT_IDS[0], A, predicate(), None, None],
                       role='authenticated', claims={'sub': A, 'role': 'service_role'})
    assert claimed.returncode != 0 and 'permission denied' in claimed.stderr
    assert call(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, predicate()])['kind'] == 'data'


def make_state_raw(pg):
    return {'targetFingerprint': 'sha256:target-0001', 'armingEpoch': pg.clock(),
            'lastQuoteAt': pg.clock(), 'inside': True, 'withinPct': 0.25,
            'lastQuoteBasis': 'NBBO-mid'}


# ---------------------------------------------------------------------------
# 3. Forged runtime writes by the owner are rejected outright; a same-statement
#    copy of a live runtime record cannot survive a protected-column mutation.
# ---------------------------------------------------------------------------
def test_forged_runtime_insert_and_update_refused(pg):
    insert_alert(pg, role='authenticated', claims={'sub': A})
    armed(pg, alert=ALERT_IDS[1])  # a second row holding a real runtime document
    donor = get_runtime(pg, ALERT_IDS[1])
    forged = dict(donor, alertId=ALERT_IDS[0], generation=str(uuid_mod.uuid4()), revision=5)
    for sql in (f"insert into public.alerts(id,user_id,symbol,condition,frozen_runtime) "
                f"values ('{ALERT_IDS[0]}','{A}','AAPL','{json.dumps(predicate())}',"
                f"'{json.dumps(forged)}')",
                f"update public.alerts set frozen_runtime='{json.dumps(forged)}' "
                f"where id='{ALERT_IDS[0]}'",
                f"update public.alerts set frozen_runtime="
                f"(select frozen_runtime from public.alerts where id='{ALERT_IDS[1]}') "
                f"where id='{ALERT_IDS[0]}'"):
        denied = pg(sql, role='authenticated', claims={'sub': A}, check=False)
        assert denied.returncode != 0 and 'protected' in denied.stderr, sql
    pred, runtime = armed(pg)
    pg(f"update public.alerts set condition=condition||'{{\"stale\":true}}', frozen_runtime="
       f"(select frozen_runtime from public.alerts where id='{ALERT_IDS[0]}') where id='{ALERT_IDS[0]}'",
       role='authenticated', claims={'sub': A})
    assert get_runtime(pg, ALERT_IDS[0]) is None  # the copied record did not survive
    assert refused(pg, 'commit_frozen_node_state',
                   [ALERT_IDS[0], A, pred, runtime['generation'], 0,
                    make_state_raw(pg)])['kind'] == 'unavailable'


# ---------------------------------------------------------------------------
# 4. Arm runtime shape; server clocks, never row.created_at or caller clocks.
# ---------------------------------------------------------------------------
def test_arm_runtime_shape_and_server_clocks_ignore_forged_created_at(pg):
    insert_alert(pg, created_at='2099-01-01 00:00:00+00')
    before = pg.clock()
    body = call(pg, 'arm_frozen_node_runtime', [ALERT_IDS[0], A, predicate(), None, None])
    after = pg.clock()
    assert body['kind'] == 'data', body
    runtime = body['runtime']
    assert_runtime_shape(runtime, ALERT_IDS[0], A, predicate())
    assert runtime['revision'] == 0 and runtime['priorState'] is None
    assert runtime['createdAt'] == runtime['armingEpoch']
    assert runtime['generation'] != ALERT_IDS[0]
    assert before <= runtime['createdAt'] <= after, (before, runtime['createdAt'], after)
    assert runtime['createdAt'] < '2099-01-01T00:00:00.000000Z'
    assert get_active(pg, ALERT_IDS[0]) is True  # arm never toggles active
    read = call(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, predicate()])
    assert read == {'kind': 'data', 'runtime': runtime}


# ---------------------------------------------------------------------------
# 5. Arm preconditions: active, frozen type, exact stable predicate, expected
#    generation/revision discipline, principal identity.
# ---------------------------------------------------------------------------
def test_arm_requires_active_frozen_type_exact_predicate_and_expected_state(pg):
    insert_alert(pg, condition={**predicate(), '_fnp': {'window': 60}, 'triggered': False})
    fresh_conflict = refused(pg, 'arm_frozen_node_runtime',
                             [ALERT_IDS[0], A, predicate(), str(uuid_mod.uuid4()), 0])
    assert fresh_conflict['kind'] == 'conflict'
    assert fresh_conflict['reason'] == 'expected_state_conflicts_null_runtime'
    for expected in ([None, 0], [str(uuid_mod.uuid4()), None]):
        assert refused(pg, 'arm_frozen_node_runtime',
                       [ALERT_IDS[0], A, predicate(), *expected])['kind'] == 'conflict'
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[0], A, predicate(extra_key=1), None, None])['reason'] == 'predicate_mismatch'
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[0], A, predicate(within_pct=0.3), None, None])['reason'] == 'predicate_mismatch'
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[0], A, Raw('"plain-string"'), None, None])['reason'] == 'predicate_not_object'
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[0], B, predicate(), None, None])['reason'] == 'not_found_or_not_owner'
    runtime = call(pg, 'arm_frozen_node_runtime', [ALERT_IDS[0], A, predicate(), None, None])['runtime']
    assert '_fnp' not in runtime['predicate'] and 'triggered' not in runtime['predicate']
    assert_runtime_shape(runtime, ALERT_IDS[0], A, predicate())
    assert get_active(pg, ALERT_IDS[0]) is True
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[0], A, predicate(), None, None])['reason'] == 'stale_generation_or_revision'
    rearmed = call(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[0], A, predicate(), runtime['generation'], 0])
    assert rearmed['kind'] == 'data' and rearmed['runtime']['generation'] != runtime['generation']
    insert_alert(pg, alert=ALERT_IDS[1], condition={k: v for k, v in predicate().items() if k != 'type'})
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[1], A, predicate(), None, None])['reason'] == 'not_frozen_type'
    insert_alert(pg, alert=ALERT_IDS[1], condition={**predicate(), 'type': 'price_cross'})
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[1], A, predicate(), None, None])['reason'] == 'not_frozen_type'
    insert_alert(pg, alert=ALERT_IDS[1], active=False)
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[1], A, predicate(), None, None])['reason'] == 'inactive'
    insert_alert(pg, alert=ALERT_IDS[1], condition=predicate(within_pct=-0.1))
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[1], A, predicate(within_pct=-0.1), None, None])['reason'] == 'predicate_within_pct'


# ---------------------------------------------------------------------------
# 6. Read enforces the same identity/predicate/active checks.
# ---------------------------------------------------------------------------
def test_read_requires_same_identity_predicate_and_active(pg):
    pred, runtime = armed(pg)
    assert call(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, pred])['runtime'] == \
        get_runtime(pg, ALERT_IDS[0]) == runtime
    assert refused(pg, 'read_frozen_node_runtime',
                   [ALERT_IDS[0], A, predicate(within_pct=0.3)])['reason'] == 'predicate_mismatch'
    assert refused(pg, 'read_frozen_node_runtime',
                   [ALERT_IDS[0], B, pred])['reason'] == 'not_found_or_not_owner'
    assert refused(pg, 'read_frozen_node_runtime',
                   [ALERT_IDS[0], A, Raw('[]')])['reason'] == 'predicate_not_object'
    pg(f"update public.alerts set active=false where id='{ALERT_IDS[0]}'")
    assert refused(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, pred])['reason'] == 'inactive'
    pg(f"update public.alerts set active=true where id='{ALERT_IDS[0]}'")
    assert get_runtime(pg, ALERT_IDS[0]) is None  # service pause invalidated, no auto re-arm
    assert refused(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, pred])['reason'] == 'no_runtime'


# ---------------------------------------------------------------------------
# 7. Commit success path, revision progression, priorState, stale CAS refusals.
# ---------------------------------------------------------------------------
def test_commit_then_stale_revision_generation_and_progression(pg):
    pred, runtime = armed(pg)
    epoch, generation = runtime['armingEpoch'], runtime['generation']
    first = make_state(pg, epoch)
    committed = call(pg, 'commit_frozen_node_state',
                     [ALERT_IDS[0], A, pred, generation, 0, first])
    assert committed['kind'] == 'data', committed
    rt1 = committed['runtime']
    assert_runtime_shape(rt1, ALERT_IDS[0], A, pred)
    assert rt1['revision'] == 1 and rt1['priorState'] == first
    assert rt1['generation'] == generation
    assert rt1['createdAt'] == runtime['createdAt'] and rt1['armingEpoch'] == epoch
    stale = refused(pg, 'commit_frozen_node_state',
                    [ALERT_IDS[0], A, pred, generation, 0, first])
    assert stale['kind'] == 'conflict' and stale['reason'] == 'stale_generation_or_revision'
    assert get_runtime(pg, ALERT_IDS[0]) == rt1  # loser changed nothing
    for wrong_gen, wrong_rev in ((str(uuid_mod.uuid4()), 1), (generation, 9)):
        conflict = refused(pg, 'commit_frozen_node_state',
                           [ALERT_IDS[0], A, pred, wrong_gen, wrong_rev, first])
        assert conflict['kind'] == 'conflict'
    second = make_state(pg, epoch)
    assert second['lastQuoteAt'] > first['lastQuoteAt']
    rt2 = call(pg, 'commit_frozen_node_state', [ALERT_IDS[0], A, pred, generation, 1, second])['runtime']
    assert rt2['revision'] == 2 and rt2['priorState'] == second
    ahead = refused(pg, 'commit_frozen_node_state',
                    [ALERT_IDS[0], A, pred, generation, 2, second])
    assert ahead['kind'] == 'unavailable' and ahead['reason'] == 'state_last_quote_at_not_after_prior'
    assert get_runtime(pg, ALERT_IDS[0])['revision'] == 2


# ---------------------------------------------------------------------------
# 8. nextState key-set and JSON-type strictness (no null/excess/unknown keys,
#    no booleans or numeric strings standing in as numbers), threshold default.
# ---------------------------------------------------------------------------
def test_commit_state_key_and_type_negatives(pg):
    pred, runtime = armed(pg)
    epoch, generation = runtime['armingEpoch'], runtime['generation']

    def negative(mutate, reason):
        state = make_state(pg, epoch)
        mutate(state)
        body = refused(pg, 'commit_frozen_node_state',
                       [ALERT_IDS[0], A, pred, generation, 0, state])
        assert body['reason'] == reason, body

    negative(lambda s: s.pop('inside'), 'state_keys_invalid')
    negative(lambda s: s.update(extra=1), 'state_keys_invalid')
    negative(lambda s: s.update(inside=None), 'state_inside_not_boolean')
    negative(lambda s: s.update(inside='true'), 'state_inside_not_boolean')
    negative(lambda s: s.update(inside=1), 'state_inside_not_boolean')
    negative(lambda s: s.update(targetFingerprint=''), 'state_target_fingerprint')
    negative(lambda s: s.update(targetFingerprint='   '), 'state_target_fingerprint')
    negative(lambda s: s.update(targetFingerprint=5), 'state_target_fingerprint')
    negative(lambda s: s.update(lastQuoteBasis=''), 'state_last_quote_basis')
    negative(lambda s: s.update(lastQuoteBasis=None), 'state_last_quote_basis')
    negative(lambda s: s.update(withinPct='0.25'), 'state_within_pct_not_number')
    negative(lambda s: s.update(withinPct=True), 'state_within_pct_not_number')
    negative(lambda s: s.update(withinPct=-0.1), 'state_within_pct_negative')
    negative(lambda s: s.update(withinPct=0.15), 'state_within_pct_mismatch')
    assert refused(pg, 'commit_frozen_node_state',
                   [ALERT_IDS[0], A, pred, generation, 0, Raw('{}')])['reason'] == 'state_keys_invalid'
    assert refused(pg, 'commit_frozen_node_state',
                   [ALERT_IDS[0], A, pred, generation, 0, Raw('[]')])['reason'] == 'state_not_object'
    # Omitted threshold preserves incumbent 0.25 default, no new policy.
    bare_pred = predicate(within_pct=None)
    insert_alert(pg, alert=ALERT_IDS[1], condition=bare_pred)
    bare = call(pg, 'arm_frozen_node_runtime', [ALERT_IDS[1], A, bare_pred, None, None])['runtime']
    default_ok = call(pg, 'commit_frozen_node_state',
                      [ALERT_IDS[1], A, bare_pred, bare['generation'], 0,
                       make_state(pg, bare['armingEpoch'], withinPct=0.25)])
    assert default_ok['kind'] == 'data', default_ok
    insert_alert(pg, alert=ALERT_IDS[2], condition=bare_pred)
    bare2 = call(pg, 'arm_frozen_node_runtime', [ALERT_IDS[2], A, bare_pred, None, None])['runtime']
    assert refused(pg, 'commit_frozen_node_state',
                   [ALERT_IDS[2], A, bare_pred, bare2['generation'], 0,
                    make_state(pg, bare2['armingEpoch'], withinPct=0.2)])['reason'] == 'state_within_pct_mismatch'
    # 0.250 in the row predicate vs 0.25 in the state: numeric, not textual, equality.
    raw_pred_text = json.dumps(bare_pred)[:-1] + ',"within_pct":0.250}'
    insert_alert(pg, alert=ALERT_IDS[3], condition=Raw(raw_pred_text))
    raw_rt = call(pg, 'arm_frozen_node_runtime',
                  [ALERT_IDS[3], A, Raw(raw_pred_text), None, None])['runtime']
    raw_state = make_state(pg, raw_rt['armingEpoch'], withinPct=0.25)
    assert call(pg, 'commit_frozen_node_state',
                [ALERT_IDS[3], A, Raw(raw_pred_text), raw_rt['generation'], 0, raw_state])['kind'] == 'data'


# ---------------------------------------------------------------------------
# 9. Event-time ordering, DB-clock bound, epoch echo, prior-quote progression.
# ---------------------------------------------------------------------------
def test_commit_event_time_and_threshold_negatives(pg):
    pred, runtime = armed(pg)
    epoch, generation = runtime['armingEpoch'], runtime['generation']

    def negative(state, reason, revision=0):
        body = refused(pg, 'commit_frozen_node_state',
                       [ALERT_IDS[0], A, pred, generation, revision, state])
        assert body['reason'] == reason, body

    negative(make_state(pg, epoch, lastQuoteAt='not-a-time'), 'state_last_quote_at_malformed')
    negative(make_state(pg, epoch, lastQuoteAt='2026-13-45T99:00:00.000000Z'),
             'state_last_quote_at_malformed')
    negative(make_state(pg, epoch, lastQuoteAt=epoch), 'state_last_quote_at_not_after_epoch')
    negative(make_state(pg, epoch, lastQuoteAt=iso_shift(epoch, -5)),
             'state_last_quote_at_not_after_epoch')
    negative(make_state(pg, epoch, lastQuoteAt=iso_shift(pg.clock(), 3600)),
             'state_last_quote_at_in_future')
    negative(make_state(pg, iso_shift(epoch, 1)), 'state_arming_epoch_mismatch')
    negative(make_state(pg, epoch, armingEpoch='garbage'), 'state_arming_epoch_mismatch')
    first = make_state(pg, epoch)
    rt1 = call(pg, 'commit_frozen_node_state',
               [ALERT_IDS[0], A, pred, generation, 0, first])['runtime']
    negative(make_state(pg, epoch, lastQuoteAt=rt1['priorState']['lastQuoteAt']),
             'state_last_quote_at_not_after_prior', revision=1)
    negative(make_state(pg, epoch, lastQuoteAt=iso_shift(rt1['priorState']['lastQuoteAt'], -.000001)),
             'state_last_quote_at_not_after_prior', revision=1)
    negative(make_state(pg, epoch, targetFingerprint='sha256:target-0002'), 'state_target_fingerprint_mismatch', revision=1)
    progressed = make_state(pg, epoch, lastQuoteAt=pg.clock())
    assert call(pg, 'commit_frozen_node_state',
                [ALERT_IDS[0], A, pred, generation, 1, progressed])['kind'] == 'data'
    assert get_runtime(pg, ALERT_IDS[0])['priorState']['lastQuoteAt'] == progressed['lastQuoteAt']


# ---------------------------------------------------------------------------
# 10. Owner mutations of protected source columns invalidate to NULL and never
#     auto-arm; a failed ownership rewrite leaves the runtime intact.
# ---------------------------------------------------------------------------
def test_owner_mutations_invalidate_to_null_and_never_auto_arm(pg):
    cases = [('condition', "condition=condition||'{\"edited\":true}'", 'predicate_mismatch'),
             ('active', 'active=false', 'inactive'),
             ('symbol', "symbol='MSFT'", 'no_runtime'),
             ('created_at', 'created_at=now()', 'no_runtime')]
    for offset, (label, mutation, expected) in enumerate(cases):
        alert = ALERT_IDS[offset]
        pred, runtime = armed(pg, alert=alert)
        pg(f"update public.alerts set {mutation} where id='{alert}'",
           role='authenticated', claims={'sub': A})
        assert get_runtime(pg, alert) is None, label
        assert refused(pg, 'read_frozen_node_runtime', [alert, A, pred])['reason'] == expected, label
    pg(f"update public.alerts set active=true where id='{ALERT_IDS[1]}'",
       role='authenticated', claims={'sub': A})
    assert get_active(pg, ALERT_IDS[1]) is True and get_runtime(pg, ALERT_IDS[1]) is None
    assert refused(pg, 'read_frozen_node_runtime',
                   [ALERT_IDS[1], A, predicate()])['reason'] == 'no_runtime'  # never auto-arms
    pred, runtime = armed(pg, alert=ALERT_IDS[4])
    renamed = pg(f"update public.alerts set id='{ALERT_IDS[5]}' where id='{ALERT_IDS[4]}'",
                 role='authenticated', claims={'sub': A}, check=False)
    assert renamed.returncode == 0
    assert get_runtime(pg, ALERT_IDS[5]) is None
    assert refused(pg, 'commit_frozen_node_state',
                   [ALERT_IDS[5], A, pred, runtime['generation'], 0,
                    make_state_raw(pg)])['kind'] == 'unavailable'
    pred, runtime = armed(pg, alert=ALERT_IDS[6])
    transfer = pg(f"update public.alerts set user_id='{B}' where id='{ALERT_IDS[6]}'",
                  role='authenticated', claims={'sub': A}, check=False)
    assert transfer.returncode != 0  # RLS with check refuses the ownership rewrite
    assert get_runtime(pg, ALERT_IDS[6]) == runtime  # failed mutation leaves runtime intact


# ---------------------------------------------------------------------------
# 11. Service-role ordinary row mutation invalidates without a new runtime; a
#     same-statement runtime copy cannot survive it. Direct privileged runtime
#     writes stay possible (role-based attestation) but the RPCs refuse them.
# ---------------------------------------------------------------------------
def test_service_ordinary_mutation_invalidates_without_new_runtime(pg):
    mutations = [(ALERT_IDS[0], "symbol='SRV'"),
                 (ALERT_IDS[1], "condition=condition||'{\"srv\":1}'"),
                 (ALERT_IDS[2], 'active=false'),
                 (ALERT_IDS[3], 'created_at=now()'),
                 (ALERT_IDS[4], f"id='{ALERT_IDS[5]}'")]
    for alert, mutation in mutations:
        armed(pg, alert=alert)
        pg(f"update public.alerts set {mutation} where id='{alert}'")
        check = ALERT_IDS[5] if alert == ALERT_IDS[4] else alert
        assert get_runtime(pg, check) is None, mutation
    pred, runtime = armed(pg, alert=ALERT_IDS[2])
    pg(f"update public.alerts set symbol='ZZZ', frozen_runtime="
       f"(select frozen_runtime from public.alerts where id='{ALERT_IDS[2]}') "
       f"where id='{ALERT_IDS[2]}'")
    assert get_runtime(pg, ALERT_IDS[2]) is None
    pred, runtime = armed(pg, alert=ALERT_IDS[3])
    pg(f"update public.alerts set frozen_runtime='{{\"x\":1}}' where id='{ALERT_IDS[3]}'")
    assert refused(pg, 'read_frozen_node_runtime',
                   [ALERT_IDS[3], A, pred])['reason'] == 'runtime_malformed'
    assert refused(pg, 'arm_frozen_node_runtime',
                   [ALERT_IDS[3], A, pred, runtime['generation'], 0])['kind'] in ('unavailable', 'conflict')
    pg(f"update public.alerts set frozen_runtime=null where id='{ALERT_IDS[3]}'")
    assert call(pg, 'arm_frozen_node_runtime',
                [ALERT_IDS[3], A, pred, None, None])['kind'] == 'data'


# ---------------------------------------------------------------------------
# 12. DELETE removes authority; same-id reinsertion cannot preserve the nonce.
# ---------------------------------------------------------------------------
def test_delete_and_same_id_reinsert_rejects_old_nonce(pg):
    pred, runtime = armed(pg)
    generation = runtime['generation']
    pg(f"delete from public.alerts where id='{ALERT_IDS[0]}'",
       role='authenticated', claims={'sub': A})
    assert refused(pg, 'commit_frozen_node_state',
                   [ALERT_IDS[0], A, pred, generation, 0,
                    make_state_raw(pg)])['reason'] == 'not_found_or_not_owner'
    insert_alert(pg, role='authenticated', claims={'sub': A})
    forged = pg(f"insert into public.alerts(id,user_id,symbol,condition,frozen_runtime) "
                f"values ('{ALERT_IDS[0]}','{A}','AAPL','{json.dumps(pred)}',"
                f"'{json.dumps(runtime)}')", role='authenticated', claims={'sub': A}, check=False)
    assert forged.returncode != 0 and 'protected' in forged.stderr
    assert refused(pg, 'commit_frozen_node_state',
                   [ALERT_IDS[0], A, pred, generation, 0,
                    make_state_raw(pg)])['reason'] == 'no_runtime'
    fresh = call(pg, 'arm_frozen_node_runtime', [ALERT_IDS[0], A, pred, None, None])['runtime']
    assert fresh['generation'] != generation
    stale = refused(pg, 'commit_frozen_node_state',
                    [ALERT_IDS[0], A, pred, generation, 0, make_state(pg, fresh['armingEpoch'])])
    assert stale['kind'] == 'conflict' and stale['reason'] == 'stale_generation_or_revision'
    assert call(pg, 'commit_frozen_node_state',
                [ALERT_IDS[0], A, pred, fresh['generation'], 0,
                 make_state(pg, fresh['armingEpoch'])])['kind'] == 'data'


# ---------------------------------------------------------------------------
# 13. Concurrency: two same-revision sessions race, exactly one winner, the
#     loser changes nothing.
# ---------------------------------------------------------------------------
def test_concurrent_same_revision_commit_and_arm_single_winner(pg):
    pred, runtime = armed(pg)
    epoch, generation = runtime['armingEpoch'], runtime['generation']
    state = make_state(pg, epoch)
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(call, pg, 'commit_frozen_node_state',
                            [ALERT_IDS[0], A, pred, generation, 0, state]) for _ in range(2)]
        bodies = [job.result() for job in jobs]
    winners = [b for b in bodies if b['kind'] == 'data']
    assert len(winners) == 1, bodies
    assert all(b['reason'] == 'stale_generation_or_revision' for b in bodies if b['kind'] != 'data'), bodies
    final = get_runtime(pg, ALERT_IDS[0])
    assert final['revision'] == 1 and final['priorState'] == state and final['generation'] == generation
    insert_alert(pg, alert=ALERT_IDS[1])
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(call, pg, 'arm_frozen_node_runtime',
                            [ALERT_IDS[1], A, pred, None, None]) for _ in range(2)]
        arms = [job.result() for job in jobs]
    arm_winners = [b for b in arms if b['kind'] == 'data']
    assert len(arm_winners) == 1, arms
    assert all(b['reason'] == 'stale_generation_or_revision' for b in arms if b['kind'] != 'data'), arms
    assert get_runtime(pg, ALERT_IDS[1])['generation'] == arm_winners[0]['runtime']['generation']


# ---------------------------------------------------------------------------
# 14. Re-applying the source preserves stored runtime and keeps enforcing.
# ---------------------------------------------------------------------------
def test_rerun_of_lifecycle_sql_preserves_records_and_enforcement(pg):
    pred, runtime = armed(pg)
    first = make_state(pg, runtime['armingEpoch'])
    committed = call(pg, 'commit_frozen_node_state',
                     [ALERT_IDS[0], A, pred, runtime['generation'], 0, first])['runtime']
    pg.apply_lifecycle()
    pg.apply_lifecycle()
    assert get_runtime(pg, ALERT_IDS[0]) == committed
    assert call(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, pred])['runtime'] == committed
    stale = refused(pg, 'commit_frozen_node_state',
                    [ALERT_IDS[0], A, pred, runtime['generation'], 0, first])
    assert stale['kind'] == 'conflict'
    second = make_state(pg, runtime['armingEpoch'])
    assert call(pg, 'commit_frozen_node_state',
                [ALERT_IDS[0], A, pred, runtime['generation'], 1, second])['kind'] == 'data'
    assert pg("select count(*) from information_schema.columns where table_schema='public' "
              "and table_name='alerts'") == '7'


def test_incumbent_omitted_threshold_is_quarter_percent(pg):
    pred = predicate(within_pct=None)
    insert_alert(pg, condition=pred)
    runtime = call(pg, 'arm_frozen_node_runtime', [ALERT_IDS[0], A, pred, None, None])['runtime']
    reply = call(pg, 'commit_frozen_node_state', [ALERT_IDS[0], A, pred, runtime['generation'], 0,
                  make_state(pg, runtime['armingEpoch'], withinPct=.25)])
    assert reply['kind'] == 'data', reply


def test_state_clock_input_domain_is_explicit_aware_finite_iso(pg):
    for text in ['now', 'today', 'infinity', '-infinity', '2026-10-21', '2026-10-21T14:00:00',
                 '2026-02-30T14:00:00Z', '2026-10-21T24:00:00Z', '2026-10-21T14:00:00Z\n']:
        assert pg(f"select public.frozen_node_parse_tstz({q(text)}) is null", role='service_role') == 't', text
    pred, runtime = armed(pg)
    for value in [123456, True, None, {}, 'now', pg.clock().replace('Z', '')]:
        reply = refused(pg, 'commit_frozen_node_state', [ALERT_IDS[0], A, pred, runtime['generation'], 0,
                        make_state(pg, runtime['armingEpoch'], lastQuoteAt=value)])
        assert reply['reason'] == 'state_last_quote_at_malformed', (value, reply)
        assert get_runtime(pg, ALERT_IDS[0]) == runtime
    aware = datetime.fromisoformat(pg.clock().replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=5, minutes=30)))
    reply = call(pg, 'commit_frozen_node_state', [ALERT_IDS[0], A, pred, runtime['generation'], 0,
                 make_state(pg, runtime['armingEpoch'], lastQuoteAt=aware.isoformat(timespec='microseconds'))])
    assert reply['kind'] == 'data', reply


def test_runtime_consistency_cannot_become_authoritative_state(pg):
    for field, value in [('schema', 'other'), ('generation', 'bad'), ('revision', True),
                         ('revision', 1), ('createdAt', '2026-01-01T00:00:00.000000Z')]:
        pred, runtime = armed(pg)
        corrupt = dict(runtime); corrupt[field] = value
        pg(f"update alerts set frozen_runtime={q(corrupt)} where id={q(ALERT_IDS[0])}")
        reply = call(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, pred])
        assert reply['kind'] == 'unavailable', (field, reply)
        assert refused(pg, 'commit_frozen_node_state', [ALERT_IDS[0], A, pred, runtime['generation'], 0,
                       make_state(pg, runtime['armingEpoch'])])['kind'] == 'unavailable'
    pred, runtime = armed(pg)
    corrupt = dict(runtime); corrupt['priorState'] = make_state(pg, runtime['armingEpoch'])
    pg(f"update alerts set frozen_runtime={q(corrupt)} where id={q(ALERT_IDS[0])}")
    assert call(pg, 'read_frozen_node_runtime', [ALERT_IDS[0], A, pred])['kind'] == 'unavailable'


def test_incumbent_native_qqq_predicate_python_adapter_real_rpc_roundtrip(pg):
    # Derived through accepted createExposureMapReader.reportedGamma and full raw
    # exposureValueFingerprint. Explicit synthetic native fixture, no live book/grant.
    sys.path.insert(0, str(HERE.parent))
    from ingest import alerts_engine as ae
    native = json.loads((HERE / 'fixtures' / 'options_frozen_node_native_target.json').read_text())
    pred = native['condition']
    assert pred['root'] == 'QQQ' and pred['target']['qualification'] == 'observed_partial'
    assert len(pred['target']['members']) == 2  # Includes native missing-measurement P side.
    assert pred['target']['sourceBinding']['clocks']['option_observed_at'] is None
    insert_alert(pg, condition=pred, created_at='2099-01-01T00:00:00Z')
    armed_result = call(pg, 'arm_frozen_node_runtime', [ALERT_IDS[0], A, pred, None, None])
    assert armed_result['kind'] == 'data'
    runtime = armed_result['runtime']
    quote_at = pg.clock()
    evaluation_at = pg.clock()
    requests = []
    allowed = {'read_frozen_node_runtime', 'commit_frozen_node_state'}
    def rpc(name, params):
        assert name in allowed
        requests.append((name, params))
        args = ','.join(key + '=>' + q(value) for key, value in params.items())
        return json.loads(pg(f'select public.{name}({args})', role='service_role'))
    adapter = ae.FrozenNodeLifecycleAdapter(rpc,
        fingerprint=ae.frozen_node_target_fingerprint, instant_micros=ae._fnp_instant_micros,
        normalize_state=ae._fnp_normalize_state, format_instant=ae._fnp_format_instant_utc,
        default_within_pct=ae.FNP_DEFAULT_WITHIN_PCT)
    alert = {'id': ALERT_IDS[0], 'user_id': A, 'symbol': 'QQQ', 'condition': pred,
             'active': True, 'created_at': '2099-01-01T00:00:00Z'}
    snapshot = adapter.read(alert, evaluation_at)
    assert snapshot is not None and snapshot.created_at == runtime['createdAt']
    assert snapshot.created_at != alert['created_at'] and snapshot.within_pct == .25
    assert snapshot.prior_state is None and snapshot.revision == 0
    state = {'targetFingerprint': ae.frozen_node_target_fingerprint(pred['target']),
             'armingEpoch': snapshot.arming_epoch, 'lastQuoteAt': quote_at,
             'inside': False, 'withinPct': .25, 'lastQuoteBasis': 'DELAYED_15M'}
    assert adapter.commit(snapshot, state) is True
    assert adapter.commit(snapshot, state) is False
    stored = get_runtime(pg, ALERT_IDS[0])
    assert stored['revision'] == 1 and stored['priorState'] == state
    assert requests[1][1]['p_predicate'] == pred  # Full native clocks/member/source binding.
    pg(f"update alerts set condition=condition||'{{\"within_pct\":0.3}}' where id={q(ALERT_IDS[0])}",
       role='authenticated', claims={'sub': A})
    assert get_runtime(pg, ALERT_IDS[0]) is None
    assert adapter.read(alert, pg.clock()) is None and adapter.commit(snapshot, state) is False


# ---------------------------------------------------------------------------
# Dual-mode runner: pytest fixture when pytest exists, plain python3 otherwise.
# ---------------------------------------------------------------------------
def _base_dir():
    root = os.environ.get('OPTIONS_FROZEN_PG_ROOT')
    if root:
        return Path(root) / 'pgrun-01a156f1'
    return Path(tempfile.mkdtemp(prefix='fznpg-01a156f1-'))


def _tests():
    return [(name, fn) for name, fn in globals().items() if name.startswith('test_')]


def main(argv=None):
    if not LIFECYCLE_SQL.exists():
        print(f'FAIL: proposed_lifecycle.sql not found at {LIFECYCLE_SQL}')
        return 1
    server, skip = make_server(_base_dir())
    results = {'pass': [], 'fail': [], 'skip': None}
    if server is None:
        print(skip)
        results['skip'] = skip
    else:
        for name, fn in _tests():
            try:
                reset(server)
                fn(server)
                results['pass'].append(name)
                print(f'PASS {name}')
            except Exception:
                results['fail'].append(name)
                print(f'FAIL {name}')
                traceback.print_exc()
        server.stop()
    _report(results)
    return 1 if results['fail'] else 0


def _report(results):
    applied = hashlib.sha256(LIFECYCLE_SQL.read_bytes()).hexdigest()
    print(f"SUMMARY passed={len(results['pass'])} failed={len(results['fail'])} "
          f"skipped={bool(results['skip'])} sql_sha256={applied[:16]}")
    if results['skip']:
        print(results['skip'])
    root = os.environ.get('OPTIONS_FROZEN_PG_ROOT')
    if root:
        evidence = Path(root) / 'evidence'
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence / 'summary.json').write_text(json.dumps(
            {'results': results, 'sql_sha256': applied,
             'lifecycle_sql': str(LIFECYCLE_SQL)}, indent=2, default=str))
        print(f'evidence: {evidence}/summary.json')


if pytest is not None:
    @pytest.fixture(scope='module')
    def lifecycle_server(tmp_path_factory):
        root = os.environ.get('OPTIONS_FROZEN_PG_ROOT')
        base = Path(root) / 'pgrun-01a156f1' if root else tmp_path_factory.mktemp('frozen-lifecycle-pg')
        server, skip = make_server(base)
        if server is None:
            pytest.skip(skip)
        try:
            yield server
        finally:
            server.stop()

    @pytest.fixture
    def pg(lifecycle_server):
        reset(lifecycle_server)
        return lifecycle_server


if __name__ == '__main__':
    sys.exit(main())
