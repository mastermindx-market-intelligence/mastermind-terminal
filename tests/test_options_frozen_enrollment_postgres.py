"""0046 source qualification on a disposable socket-only PostgreSQL cluster.

No configured database, source enrollment, provider or send is used.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
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
    raw = pg('select frozen_enrollment::text from public.alerts')
    return json.loads(raw) if raw else None


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
def test_reconciliation_is_read_only_without_cancelling_late_dispatch(enrolled, prepared):
    pg = enrolled
    if prepared:
        assert call(pg, 'prepare')['kind'] == 'prepared'
    before = pg('select to_jsonb(a)::text from public.alerts a')
    result = call(pg, 'reconcile')
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    if prepared:
        assert result == {'kind': 'pending', 'enrollment': saved(pg)}
        assert call(pg, 'prepare')['kind'] == 'pending'
    else:
        assert result == {'kind': 'unavailable', 'reason': 'enrollment_not_prepared'}
        # Legal late delivery of the ORIGINAL prepare after an empty read.
        # The read did not prove absence of a possible in-flight mutation.
        assert call(pg, 'prepare')['kind'] == 'prepared'
    assert call(pg, 'arm')['enrollment']['outcome']['kind'] == 'data'


@pytest.mark.parametrize('prepared', [False, True])
def test_read_only_transaction_can_reconcile_without_row_write(enrolled, prepared):
    pg = enrolled
    if prepared:
        call(pg, 'prepare')
    before = pg('select to_jsonb(a)::text from public.alerts a')
    args = [b.ALERT_IDS[0], b.A, intent_condition(), None, None, intent_token(pg),
            {'operation': 'reconcile', 'attemptId': ATTEMPT, 'lens': {'kind': 'all'}}]
    result = json.loads(pg('begin read only; select public.arm_frozen_node_runtime('
        + ','.join(b.q(a) for a in args) + '); commit', role='service_role'))
    assert result['kind'] == ('pending' if prepared else 'unavailable')
    assert pg('select to_jsonb(a)::text from public.alerts a') == before


def raced(pg, operations):
    barrier = Barrier(len(operations))
    def invoke(operation):
        barrier.wait(timeout=5)
        return call(pg, operation)
    with ThreadPoolExecutor(max_workers=len(operations)) as pool:
        return list(pool.map(invoke, operations))


def test_reconcile_races_original_late_prepare_without_sealing_it(enrolled):
    pg = enrolled
    prepared, observed = raced(pg, ['prepare', 'reconcile'])
    assert prepared['kind'] == 'prepared'
    assert observed in ({'kind': 'unavailable', 'reason': 'enrollment_not_prepared'},
                        {'kind': 'pending', 'enrollment': prepared['enrollment']})
    assert saved(pg) == prepared['enrollment']  # no read-created tombstone
    committed = call(pg, 'arm')
    assert committed['enrollment']['outcome']['kind'] == 'data'
    assert call(pg, 'reconcile') == committed


def test_reconcile_races_original_arm_and_observes_only_snapshot_or_exact_commit(enrolled):
    pg = enrolled
    prepared = call(pg, 'prepare')
    committed, observed = raced(pg, ['arm', 'reconcile'])
    assert committed['enrollment']['outcome']['kind'] == 'data'
    assert observed in ({'kind': 'pending', 'enrollment': prepared['enrollment']}, committed)
    assert saved(pg) == committed['enrollment']
    assert call(pg, 'reconcile') == committed


@pytest.mark.parametrize('prepared', [False, True])
def test_only_explicit_fence_can_close_existing_prepare(enrolled, prepared):
    pg = enrolled
    before = pg('select to_jsonb(a)::text from public.alerts a')
    if not prepared:
        assert call(pg, 'fence')['reason'] == 'enrollment_not_prepared'
        assert pg('select to_jsonb(a)::text from public.alerts a') == before
        return
    call(pg, 'prepare')
    result = call(pg, 'fence')
    assert result['enrollment']['outcome'] == {'kind': 'conflict', 'reason': 'enrollment_not_committed'}
    for operation in ('arm', 'prepare', 'reconcile', 'fence'):
        assert call(pg, operation) == result
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


def test_explicit_fence_and_arm_share_one_terminal_winner(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    outcomes = raced(pg, ['arm', 'fence'])
    assert outcomes[0] == outcomes[1]
    runtime = b.get_runtime(pg, b.ALERT_IDS[0])
    result = outcomes[0]['enrollment']['outcome']
    assert (runtime is not None) == (result['kind'] == 'data')
    assert result['kind'] == 'data' or result == {'kind': 'conflict', 'reason': 'enrollment_not_committed'}
    for operation in ('arm', 'fence', 'reconcile'):
        assert call(pg, operation) == outcomes[0]
    assert saved(pg) == outcomes[0]['enrollment']


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
def test_old_incarnation_never_gains_new_arm_authority(enrolled, aba):
    pg = enrolled
    token = intent_token(pg)
    prepared = call(pg, 'prepare')
    if aba == 'pause':
        pg('update public.alerts set active=false')
        pg('update public.alerts set active=true')
        assert call(pg, 'reconcile', token=token) == {'kind': 'pending', 'enrollment': prepared['enrollment']}
        # The new current token cannot adopt this OLD receipt's exact pin.
        assert call(pg, 'reconcile')['reason'] == 'enrollment_attempt_conflict'
    else:
        b.insert_alert(pg, condition=intent_condition(), symbol='QQQ')
        assert call(pg, 'reconcile', token=token)['reason'] == 'enrollment_not_prepared'
        assert call(pg, 'fence', token=token)['reason'] == 'enrollment_not_prepared'
        assert saved(pg) is None
    assert intent_token(pg) != token
    assert call(pg, 'arm', token=token)['reason'] == 'stale_intent_revision'
    assert b.get_runtime(pg, b.ALERT_IDS[0]) is None


def test_exact_original_commit_is_historical_after_current_generation_and_owner_edit(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    result = call(pg, 'arm')
    token = intent_token(pg)
    original_generation = result['enrollment']['outcome']['runtime']['generation']
    # This modifies CURRENT runtime through already-trusted service SQL, never
    # the immutable saved acknowledgment. The latter must remain the original.
    pg("update public.alerts set frozen_runtime=jsonb_set(frozen_runtime,'{generation}',"
       + b.q(json.dumps(OTHER)) + '::jsonb)', role='service_role')
    assert b.get_runtime(pg, b.ALERT_IDS[0])['generation'] != original_generation
    assert call(pg, 'reconcile', token=token) == result
    pg("update public.alerts set active=false; update public.alerts set active=true; "
       "update public.alerts set condition=condition || '{\"within_pct\":0.7}'::jsonb",
       role='authenticated', claims={'sub': b.A})
    assert intent_token(pg) != token and b.get_runtime(pg, b.ALERT_IDS[0]) is None
    before = pg('select to_jsonb(a)::text from public.alerts a')
    assert call(pg, 'reconcile', token=token) == result
    assert call(pg, 'fence', token=token) == result  # cannot undo the original commit
    assert call(pg, 'arm', token=token)['reason'] == 'stale_intent_revision'
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    assert saved(pg) == result['enrollment']


def test_explicit_exact_fence_can_close_prepare_after_same_owner_edit(enrolled):
    pg = enrolled
    token = intent_token(pg)
    call(pg, 'prepare')
    pg("update public.alerts set condition=condition || '{\"within_pct\":0.7}'::jsonb", role='authenticated', claims={'sub': b.A})
    assert intent_token(pg) != token
    result = call(pg, 'fence', token=token)
    assert result['enrollment']['outcome'] == {'kind': 'conflict', 'reason': 'enrollment_not_committed'}
    assert call(pg, 'reconcile', token=token) == result
    assert call(pg, 'arm', token=token)['reason'] == 'stale_intent_revision'
    assert b.get_runtime(pg, b.ALERT_IDS[0]) is None


def test_no_legacy_five_or_six_argument_initial_arm_bypass(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    before = pg('select to_jsonb(a)::text from public.alerts a')
    for args in ([b.ALERT_IDS[0], b.A, intent_condition(), None, None],
                 [b.ALERT_IDS[0], b.A, intent_condition(), None, None, intent_token(pg)]):
        denied = b.call_raw(pg, 'arm_frozen_node_runtime', args)
        assert denied.returncode and 'does not exist' in denied.stderr
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    assert pg("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='arm_frozen_node_runtime'") == '1'
    assert pg("select pronargs from pg_proc where pronamespace='public'::regnamespace and proname='arm_frozen_node_runtime'") == '7'


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
    call(pg, 'fence')
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
    assert pg("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid)') is null") == 't'
    assert pg("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid,jsonb)') is not null") == 't'
    rb = [{'statement': q, 'rows': json.loads(pg('select json_agg(r)::text from ('+q.rstrip(';')+') r'))}
          for q in readback_statements(FOLLOWUP.read_text())]
    assert missing_after(expected_objects(split_statements(FOLLOWUP.read_text())), rb) == []


@pytest.mark.parametrize('unsafe_policy', ['disabled', 'wide_select', 'wide_owner'])
def test_installer_refuses_unqualified_disclosure_boundary_atomically(native, unsafe_policy):
    pg = native
    pg(MIGRATION.read_text())
    if unsafe_policy == 'disabled':
        pg('alter table public.alerts disable row level security')
    elif unsafe_policy == 'wide_select':
        pg('create policy unsafe_wide_select on public.alerts for select to authenticated using(true)')
    else:
        pg('alter policy alerts_owner on public.alerts using(true)')
    result = pg(FOLLOWUP.read_text(), check=False)
    assert result.returncode and ('owner policy required' in result.stderr or 'RLS required' in result.stderr)
    assert pg("select count(*) from pg_attribute where attrelid='public.alerts'::regclass and attname='frozen_enrollment' and not attisdropped") == '0'
    assert pg("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)') is not null") == 't'


def test_packaging_requires0045_before_intent_or_enrollment_install(native):
    pg = native
    result = pg(FOLLOWUP.read_text(), check=False)
    assert result.returncode and 'composition required before0046' in result.stderr
    assert pg("select count(*) from pg_attribute where attrelid='public.alerts'::regclass and attname in ('frozen_intent_revision','frozen_enrollment') and not attisdropped") == '0'


def test_reapplication_preserves_pending_marker_and_late_failure_restores_overload(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    before = pg('select to_jsonb(a)::text from public.alerts a')
    pg(FOLLOWUP.read_text())
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    bad = FOLLOWUP.read_text().replace('END $frozen_enrollment_composed$;',
        "RAISE EXCEPTION 'synthetic_reapply_failure'; END $frozen_enrollment_composed$;")
    result = pg(bad, check=False)
    assert result.returncode and 'synthetic_reapply_failure' in result.stderr
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    assert call(pg, 'prepare')['kind'] == 'pending'
    assert call(pg, 'arm')['enrollment']['outcome']['kind'] == 'data'


@pytest.mark.parametrize('field,value', [('id', b.ALERT_IDS[1]), ('user_id', b.B)])
def test_retained_private_receipt_refuses_identity_transfer(enrolled, field, value):
    pg = enrolled
    call(pg, 'prepare')
    before = pg('select to_jsonb(a)::text from public.alerts a')
    denied = pg(f'update public.alerts set {field}={b.q(value)}', role='service_role', check=False)
    assert denied.returncode and 'forbids alert identity reassignment' in denied.stderr
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    assert pg('select count(*) from public.alerts', role='authenticated', claims={'sub': b.B}) == '0'


def test_owner_cannot_forge_receipt_using_jwt_or_custom_role_claim(enrolled):
    pg = enrolled
    call(pg, 'prepare')
    before = pg('select to_jsonb(a)::text from public.alerts a')
    denied = pg("set request.jwt.claim.role='service_role'; update public.alerts set frozen_enrollment=null",
        role='authenticated', claims={'sub': b.A, 'role': 'service_role'}, check=False)
    assert denied.returncode and 'service-write-only' in denied.stderr
    denied = pg('insert into public.alerts(id,user_id,symbol,condition,active,frozen_enrollment) values ('
        + ','.join(b.q(x) for x in [b.ALERT_IDS[1], b.A, 'QQQ', b.Raw(json.dumps(intent_condition())), True, b.Raw(json.dumps(saved(pg)))]) + ')',
        role='authenticated', claims={'sub': b.A, 'role': 'service_role'}, check=False)
    assert denied.returncode and 'enrollment insert refused' in denied.stderr
    assert pg('select to_jsonb(a)::text from public.alerts a') == before


def test_concurrent_different_attempts_and_terminal_slot_never_evict(enrolled):
    pg = enrolled
    barrier = Barrier(2)
    def prepare(attempt):
        barrier.wait(timeout=5)
        return attempt, call(pg, 'prepare', attempt=attempt)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(prepare, [ATTEMPT, OTHER]))
    assert sum(result['kind'] == 'prepared' for _, result in results) == 1
    winner, prepared = next(pair for pair in results if pair[1]['kind'] == 'prepared')
    loser = OTHER if winner == ATTEMPT else ATTEMPT
    original = saved(pg)
    assert original == prepared['enrollment']
    assert call(pg, 'fence', attempt=loser)['reason'] == 'enrollment_attempt_conflict'
    committed = call(pg, 'arm', attempt=winner)
    assert committed['enrollment']['outcome']['kind'] == 'data'
    assert call(pg, 'prepare', attempt=loser)['reason'] == 'enrollment_attempt_conflict'
    assert saved(pg) == committed['enrollment']



def test_state_only_generation_cas_remains_and_initial_rearm_fails_closed(enrolled):
    from ingest.alerts_engine import frozen_node_target_fingerprint
    pg = enrolled
    call(pg, 'prepare')
    original = call(pg, 'arm')
    runtime = original['enrollment']['outcome']['runtime']
    state = b.make_state(pg, runtime['armingEpoch'], lastQuoteBasis='LIVE',
        targetFingerprint=frozen_node_target_fingerprint(intent_condition()['target']))
    changed = b.call(pg, 'commit_frozen_node_state', [b.ALERT_IDS[0], b.A,
        intent_condition(), runtime['generation'], 0, state, None])
    assert changed['kind'] == 'data'
    assert changed['runtime']['generation'] == runtime['generation']
    assert changed['runtime']['revision'] == 1
    assert call(pg, 'reconcile') == original  # original ack, never latest state
    before = pg('select to_jsonb(a)::text from public.alerts a')
    denied = b.call(pg, 'arm_frozen_node_runtime', [b.ALERT_IDS[0], b.A,
        intent_condition(), runtime['generation'], 1, intent_token(pg),
        {'operation': 'arm', 'attemptId': OTHER, 'lens': {'kind': 'all'}}])
    assert denied == {'kind': 'unavailable', 'reason': 'invalid_enrollment_request'}
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
