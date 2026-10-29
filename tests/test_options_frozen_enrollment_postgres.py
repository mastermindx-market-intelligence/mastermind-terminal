"""0046 source qualification on a disposable socket-only PostgreSQL cluster.

No configured database, source enrollment, provider or send is used.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re

import pytest

import test_alerts_frozen_lifecycle_postgres as b
from test_options_frozen_migration_postgres import native, MIGRATION, intent_condition, intent_token
from scripts.supabase_apply import split_statements, readback_statements, expected_objects, missing_after

ROOT = Path(__file__).resolve().parents[1]
FOLLOWUP = ROOT / 'supabase/migrations/0046_options_frozen_enrollment.sql'
ATTEMPT = '60000000-0000-4000-8000-000000000001'
OTHER = '60000000-0000-4000-8000-000000000002'


@pytest.fixture
def enrolled(native):
    native(MIGRATION.read_text())
    native(FOLLOWUP.read_text())
    b.insert_alert(native, condition=intent_condition(), symbol='QQQ',
                   role='authenticated', claims={'sub': b.A})
    return native


def call(pg, operation, *, attempt=ATTEMPT, token=None, principal=b.A, predicate=None,
         lens=None, role='service_role'):
    return b.call(pg, 'arm_frozen_node_runtime', [b.ALERT_IDS[0], principal,
        predicate or intent_condition(), None, None, token or intent_token(pg),
        {'operation': operation, 'attemptId': attempt, 'lens': lens or {'kind': 'all'}}], role=role)


def saved(pg):
    return json.loads(pg('select frozen_enrollment::text from public.alerts'))


def test_exact_units_single_statement_and_immutable0045():
    text = FOLLOWUP.read_text()
    assert len(split_statements(text)) == 1
    for i, name in enumerate(('proposed_intent_revision.sql', 'proposed_enrollment_attempt.sql')):
        body = (ROOT / 'tests/sql/options_frozen_node' / name).read_text()
        match = re.search(r'EXECUTE \$enrollment_stage_'+str(i)+r'\$(.*?)\$enrollment_stage_'+str(i)+r'\$;', text, re.S)
        assert match and match.group(1) == body
        assert hashlib.sha256(body.encode()).hexdigest() in text
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == '2719fcdb0ca70248791459d981e5bb645f0b680a1382e181b2c08b8c6a27da30'


def test_commit_response_loss_then_restart_recovers_exact_ack_without_rearm(enrolled):
    pg = enrolled
    assert call(pg, 'prepare')['kind'] == 'prepared'
    original = call(pg, 'arm')  # Response is lost; recover through a new SQL connection.
    assert original['enrollment']['outcome']['kind'] == 'data'
    runtime = b.get_runtime(pg, b.ALERT_IDS[0])
    assert call(pg, 'reconcile') == original
    assert call(pg, 'arm') == original
    assert call(pg, 'prepare') == original
    assert b.get_runtime(pg, b.ALERT_IDS[0]) == runtime
    assert pg('select count(*) from public.alert_outbox') == '0'
    assert pg('select count(*) from public.alert_runs') == '0'


@pytest.mark.parametrize('prepared', [False, True])
def test_reconcile_before_dispatch_fences_late_prepare_and_arm(enrolled, prepared):
    pg = enrolled
    if prepared:
        assert call(pg, 'prepare')['kind'] == 'prepared'
        assert call(pg, 'prepare')['kind'] == 'pending'  # Restart cannot acquire dispatch authority.
    result = call(pg, 'reconcile')
    assert result['enrollment']['outcome'] == {'kind': 'conflict', 'reason': 'enrollment_not_committed'}
    assert call(pg, 'prepare') == result
    assert call(pg, 'arm') == result
    assert b.get_runtime(pg, b.ALERT_IDS[0]) is None


def test_unprepared_arm_never_creates_runtime(enrolled):
    assert call(enrolled, 'arm') == {'kind': 'conflict', 'reason': 'enrollment_not_prepared'}
    assert b.get_runtime(enrolled, b.ALERT_IDS[0]) is None


def test_same_attempt_concurrency_creates_and_arms_once(enrolled):
    pg = enrolled
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: call(pg, 'prepare'), range(2)))
    assert sorted(x['kind'] for x in outcomes) == ['pending', 'prepared']
    with ThreadPoolExecutor(max_workers=2) as pool:
        arms = list(pool.map(lambda _: call(pg, 'arm'), range(2)))
    assert arms[0] == arms[1]
    assert arms[0]['enrollment']['outcome']['kind'] == 'data'
    assert b.get_runtime(pg, b.ALERT_IDS[0])['revision'] == 0


def test_reconcile_and_delayed_arm_are_serialized(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda mode: call(pg, mode), ['arm', 'reconcile']))
    assert outcomes[0] == outcomes[1]
    runtime = b.get_runtime(pg, b.ALERT_IDS[0])
    result = outcomes[0]['enrollment']['outcome']
    assert (runtime is not None) == (result['kind'] == 'data')
    assert call(pg, 'arm') == outcomes[0]


@pytest.mark.parametrize('substitution', ['attempt', 'principal', 'predicate', 'lens'])
def test_substituted_attempt_or_full_pin_is_not_attributed(enrolled, substitution):
    pg = enrolled
    call(pg, 'prepare')
    original = saved(pg)
    args = {}
    if substitution == 'attempt': args['attempt'] = OTHER
    if substitution == 'principal': args['principal'] = b.B
    if substitution == 'predicate': args['predicate'] = {**intent_condition(), 'within_pct': 0.7}
    if substitution == 'lens': args['lens'] = {'kind': 'week'}
    assert call(pg, 'reconcile', **args)['kind'] in ('unavailable', 'conflict')
    assert saved(pg) == original
    assert b.get_runtime(pg, b.ALERT_IDS[0]) is None


@pytest.mark.parametrize('aba', ['pause', 'delete'])
def test_stale_incarnation_cannot_recover_or_arm(enrolled, aba):
    pg = enrolled
    token = intent_token(pg)
    call(pg, 'prepare')
    if aba == 'pause':
        pg('update public.alerts set active=false')
        pg('update public.alerts set active=true')
    else:
        b.insert_alert(pg, condition=intent_condition(), symbol='QQQ')
    assert call(pg, 'reconcile', token=token) == {'kind': 'conflict', 'reason': 'stale_intent_revision'}
    assert call(pg, 'arm', token=token)['reason'] == 'stale_intent_revision'
    assert b.get_runtime(pg, b.ALERT_IDS[0]) is None


def test_other_generation_never_masquerades_as_original_ack(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    result = call(pg, 'arm')
    runtime = result['enrollment']['outcome']['runtime']
    other = b.call(pg, 'arm_frozen_node_runtime', [b.ALERT_IDS[0], b.A,
        intent_condition(), runtime['generation'], 0, intent_token(pg)])
    assert other['kind'] == 'data'
    assert call(pg, 'reconcile') == {'kind': 'conflict', 'reason': 'enrollment_generation_changed'}
    assert saved(pg) == result['enrollment']


def test_owner_scoped_read_service_only_mutation_and_rpc(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    assert pg('select count(frozen_enrollment) from public.alerts', role='authenticated', claims={'sub': b.A}) == '1'
    assert pg('select count(*) from public.alerts', role='authenticated', claims={'sub': b.B}) == '0'
    denied = pg("update public.alerts set frozen_enrollment=null", role='authenticated', claims={'sub': b.A}, check=False)
    assert denied.returncode and 'service-write-only' in denied.stderr
    for role in ('anon', 'authenticated', 'service_member'):
        denied = b.call_raw(pg, 'arm_frozen_node_runtime', [b.ALERT_IDS[0], b.A,
            intent_condition(), None, None, intent_token(pg),
            {'operation': 'arm', 'attemptId': ATTEMPT, 'lens': {'kind': 'all'}}], role=role)
        assert denied.returncode
    call(pg, 'reconcile')
    denied = pg('update public.alerts set frozen_enrollment=null', role='service_role', check=False)
    assert denied.returncode and 'immutable' in denied.stderr


def test_actual_package_atomic_rollback_and_reapplication(native):
    pg = native
    pg(MIGRATION.read_text())
    b.insert_alert(pg, condition=intent_condition(), symbol='QQQ')
    before = pg('select to_jsonb(a)::text from public.alerts a')
    bad = FOLLOWUP.read_text().replace('END $frozen_enrollment_composed$;',
        "RAISE EXCEPTION 'synthetic0046_failure'; END $frozen_enrollment_composed$;")
    result = pg(bad, check=False)
    assert result.returncode and 'synthetic0046_failure' in result.stderr
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    assert pg("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)') is not null") == 't'
    pg(FOLLOWUP.read_text())
    call(pg, 'prepare')
    call(pg, 'arm')
    before = pg('select to_jsonb(a)::text from public.alerts a')
    pg(FOLLOWUP.read_text())
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    assert pg("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)') is null") == 't'
    for signature in ('uuid,uuid,jsonb,uuid,bigint,uuid', 'uuid,uuid,jsonb,uuid,bigint,uuid,jsonb'):
        assert pg(f"select to_regprocedure('public.arm_frozen_node_runtime({signature})') is not null") == 't'
    rb = [{'statement': q, 'rows': json.loads(pg('select json_agg(r)::text from ('+q.rstrip(';')+') r'))}
          for q in readback_statements(FOLLOWUP.read_text())]
    assert missing_after(expected_objects(split_statements(FOLLOWUP.read_text())), rb) == []
