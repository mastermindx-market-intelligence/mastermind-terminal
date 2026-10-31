"""Canonical P09 packaging: actual private PostgreSQL, never a configured database."""
from pathlib import Path
import hashlib
import json
import re

import pytest

import test_alerts_frozen_lifecycle_postgres as b
from scripts.supabase_apply import (
    split_statements, readback_statements, idempotency_findings,
    expected_objects, missing_after,
)

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/0045_options_frozen_runtime.sql'
UNITS = ('proposed_lifecycle.sql', 'proposed_atomic_hit.sql', 'proposed_prepared_intent.sql')


def test_reviewed_units_are_exact_and_native_installer_sees_one_statement():
    text = MIGRATION.read_text()
    for i, name in enumerate(UNITS):
        body = (ROOT / 'tests/sql/options_frozen_node' / name).read_text()
        embedded = re.search(r'EXECUTE \$frozen_stage_' + str(i) + r'\$(.*?)\$frozen_stage_' + str(i) + r'\$;', text, re.S)
        assert embedded and embedded.group(1) == body
        assert hashlib.sha256(body.encode()).hexdigest() in text
    statements = split_statements(text)
    assert len(statements) == 1
    assert not idempotency_findings(text, statements)
    assert len(readback_statements(text)) == 7


@pytest.fixture
def native(tmp_path):
    pg, reason = b.make_server(tmp_path / 'native', apply_lifecycle=False)
    if pg is None:
        pytest.skip(reason)
    try:
        pg('create schema extensions; create extension pgcrypto with schema extensions;')
        for name in ('0013_alert_runs_outbox.sql', '0014_tenancy_foundation.sql',
                     '0018_webhook_delivery.sql', '0026_webhook_rotation_alert_fires.sql',
                     '0038_forex_inactive_conditions.sql'):
            pg((ROOT / 'supabase/migrations' / name).read_text())
        pg('grant all on public.alert_runs,public.alert_outbox to service_role;')
        yield pg
    finally:
        pg.stop()


def test_late_failure_rolls_back_all_stages(native):
    text = MIGRATION.read_text().replace('END $frozen_composed$;',
        "RAISE EXCEPTION 'synthetic_install_failure'; END $frozen_composed$;")
    result = native(text, check=False)
    assert result.returncode != 0 and 'synthetic_install_failure' in result.stderr
    assert native("select count(*) from pg_attribute where attrelid='public.alerts'::regclass and attname='frozen_runtime'") == '0'
    assert native("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)') is null") == 't'
    assert native("select to_regclass('public.alert_runs_frozen_unresolved_lane') is null") == 't'


def test_native_installer_accepts_actual_catalog_rows_and_detects_missing_rpc(native):
    text = MIGRATION.read_text()
    native(text)

    def readback():
        return [{'statement': query, 'rows': json.loads(native(
            "select coalesce(json_agg(result),'[]'::json)::text from ("
            + query.rstrip().rstrip(';') + ") result"))}
            for query in readback_statements(text)]

    expected = expected_objects(split_statements(text))
    assert expected  # An empty object census is not verified installation.
    assert missing_after(expected, readback()) == []
    native('drop function public.read_frozen_node_runtime(uuid,uuid,jsonb)')
    assert 'function read_frozen_node_runtime' in missing_after(expected, readback())


def test_rerun_preserves_runtime_intents_and_existing_forex_guard(native):
    import test_alerts_frozen_hit_postgres as h
    import test_alerts_frozen_prepared_postgres as p
    native(MIGRATION.read_text())
    native(f"insert into public.teams(id,name,created_by) values({b.q(h.TEAM)},'synthetic',{b.q(b.A)})")
    native(f"insert into public.webhook_endpoints(id,team_id,url,secret,created_by,event_filter) values ({b.q(h.ENDPOINT)},{b.q(h.TEAM)},'https://synthetic.invalid/webhook','synthetic-secret',{b.q(b.A)},array['alert.fired'])")
    native(f"insert into public.webhook_alert_optins(team_id,user_id,enabled) values({b.q(h.TEAM)},{b.q(b.A)},true)")
    _, adapter, runtime, state, receipt, payload = p.subject(native)
    assert p.call(adapter, runtime, state, receipt, payload, 'prepare')['kind'] == 'prepared'
    before = [native(f'select to_jsonb(t)::text from public.{table} t order by 1')
              for table in ('alerts','alert_runs','alert_outbox','webhook_deliveries')]
    native(MIGRATION.read_text())
    after = [native(f'select to_jsonb(t)::text from public.{table} t order by 1')
             for table in ('alerts','alert_runs','alert_outbox','webhook_deliveries')]
    assert before == after
    assert p.call(adapter, runtime, state, receipt, payload, 'reconcile')['kind'] == 'unsettled'
    assert p.call(adapter, runtime, state, receipt, payload, 'commit')['kind'] == 'committed'
    assert h.effects(native) == (1, 1)
    assert native("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='commit_frozen_node_state'") == '1'
    assert native("select pronargs from pg_proc where pronamespace='public'::regnamespace and proname='commit_frozen_node_state'") == '7'
    assert native("select count(*) from pg_trigger where tgrelid='public.alerts'::regclass and tgname='alerts_forex_inactive_guard'") == '1'
    for query in readback_statements(MIGRATION.read_text()):
        native(query)
    for role in ('anon','authenticated'):
        assert native(f"select bool_or(has_function_privilege('{role}',p.oid,'EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('arm_frozen_node_runtime','read_frozen_node_runtime','commit_frozen_node_state')") == 'f'


# Unreserved source amendment: canonical0045 and its three reviewed units stay
# immutable. This is not a configured database or migration application receipt.
INTENT = ROOT / 'tests/sql/options_frozen_node/proposed_intent_revision.sql'


def intent_condition():
    return json.loads((ROOT / 'tests/fixtures/options_frozen_node_native_target.json').read_text())['condition']


def intent_token(pg, alert=b.ALERT_IDS[0]):
    return pg(f'select frozen_intent_revision::text from public.alerts where id={b.q(alert)}')


def intent_arm(pg, token, condition=None, generation=None, revision=None, principal=b.A):
    return b.call(pg, 'arm_frozen_node_runtime', [b.ALERT_IDS[0], principal,
        condition or intent_condition(), generation, revision, token])


@pytest.fixture
def intent_native(native):
    native(MIGRATION.read_text())
    native(INTENT.read_text())
    b.insert_alert(native, condition=intent_condition(), symbol='QQQ',
                   role='authenticated', claims={'sub': b.A})
    return native


@pytest.mark.parametrize('aba', ['pause', 'edit', 'symbol', 'created', 'delete'])
def test_intent_revision_rejects_value_equal_initial_aba(intent_native, aba):
    pg = intent_native
    token = intent_token(pg)
    original = json.loads(pg('select to_jsonb(a)::text from public.alerts a'))
    row = b.q(b.ALERT_IDS[0])
    if aba == 'delete':
        b.insert_alert(pg, condition=original['condition'], symbol=original['symbol'],
            created_at=original['created_at'], role='authenticated', claims={'sub': b.A})
    else:
        edits = {
            'pause': ('active=false', 'active=true'),
            'edit': ("condition=condition || '{\"within_pct\":0.3}'::jsonb", 'condition='+b.q(original['condition'])+'::jsonb'),
            'symbol': ("symbol='SPY'", "symbol='QQQ'"),
            'created': ("created_at=created_at + interval '1 second'", 'created_at='+b.q(original['created_at'])+'::timestamptz'),
        }
        for edit in edits[aba]:
            pg('update public.alerts set '+edit+' where id='+row,
               role='authenticated', claims={'sub': b.A})
    after = json.loads(pg('select to_jsonb(a)::text from public.alerts a'))
    assert after.pop('frozen_intent_revision') != original.pop('frozen_intent_revision')
    assert after == original  # content equality cannot hide incarnation change
    assert intent_arm(pg, token) == {'kind': 'conflict', 'reason': 'stale_intent_revision'}
    assert b.get_runtime(pg, b.ALERT_IDS[0]) is None
    assert pg('select count(*) from public.alert_outbox') == '0'


def test_intent_token_db_ownership_and_no_legacy_arm_bypass(intent_native):
    pg = intent_native
    token = intent_token(pg)
    for role in ('authenticated', 'service_role'):
        claims = {'sub': b.A} if role == 'authenticated' else None
        bad = pg('update public.alerts set frozen_intent_revision='+b.q(b.B), role=role, claims=claims, check=False)
        assert bad.returncode and 'DB-owned' in bad.stderr
        bad = pg('insert into public.alerts(id,user_id,symbol,frozen_intent_revision) values ('+
            ','.join(b.q(x) for x in (b.ALERT_IDS[1], b.A, 'QQQ', b.B))+')', role=role, claims=claims, check=False)
        assert bad.returncode and 'DB-owned' in bad.stderr
    assert intent_arm(pg, b.B)['reason'] == 'stale_intent_revision'
    assert intent_arm(pg, None)['reason'] == 'intent_revision_required'
    assert intent_arm(pg, token, principal=b.B)['reason'] == 'not_found_or_not_owner'
    legacy = b.call_raw(pg, 'arm_frozen_node_runtime', [b.ALERT_IDS[0], b.A, intent_condition(), None, None])
    assert legacy.returncode and 'does not exist' in legacy.stderr
    for role in ('anon', 'authenticated'):
        assert b.call_raw(pg, 'arm_frozen_node_runtime', [b.ALERT_IDS[0], b.A, intent_condition(), None, None, token], role=role).returncode
    assert pg("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='arm_frozen_node_runtime'") == '1'
    assert pg("select pronargs from pg_proc where pronamespace='public'::regnamespace and proname='arm_frozen_node_runtime'") == '6'
    assert b.get_runtime(pg, b.ALERT_IDS[0]) is None


def test_current_token_arms_once_and_existing_state_cas_remains(intent_native):
    from concurrent.futures import ThreadPoolExecutor
    from ingest.alerts_engine import frozen_node_target_fingerprint
    pg = intent_native
    token = intent_token(pg)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: intent_arm(pg, token), range(2)))
    assert sum(r['kind'] == 'data' for r in results) == 1
    assert sum(r.get('reason') == 'stale_generation_or_revision' for r in results) == 1
    runtime = next(r['runtime'] for r in results if r['kind'] == 'data')
    assert runtime['revision'] == 0 and runtime['priorState'] is None
    assert runtime['createdAt'] == runtime['armingEpoch']
    assert intent_token(pg) == token
    state = b.make_state(pg, runtime['armingEpoch'], lastQuoteBasis='LIVE',
        targetFingerprint=frozen_node_target_fingerprint(intent_condition()['target']))
    result = b.call(pg, 'commit_frozen_node_state', [b.ALERT_IDS[0], b.A, intent_condition(),
        runtime['generation'], 0, state, None])
    assert result['kind'] == 'data' and result['runtime']['revision'] == 1
    assert intent_token(pg) == token
    assert intent_arm(pg, token, generation=runtime['generation'], revision=0)['kind'] == 'conflict'
    rearmed = intent_arm(pg, token, generation=runtime['generation'], revision=1)
    assert rearmed['kind'] == 'data' and rearmed['runtime']['generation'] != runtime['generation']
    assert rearmed['runtime']['priorState'] is None
    before = pg('select to_jsonb(a)::text from public.alerts a')
    pg(INTENT.read_text())
    assert pg('select to_jsonb(a)::text from public.alerts a') == before
    assert pg('select count(*) from public.alert_outbox') == '0'


def test_intent_install_preserves_and_excludes_existing_prepared(native):
    import test_alerts_frozen_prepared_postgres as p
    native(MIGRATION.read_text())
    _, adapter, runtime, state, receipt, payload = p.subject(native)
    assert p.call(adapter, runtime, state, receipt, payload, 'prepare')['kind'] == 'prepared'
    before = b.get_runtime(native, runtime.alert_id)
    native(INTENT.read_text())
    assert b.get_runtime(native, runtime.alert_id) == before
    assert intent_arm(native, intent_token(native), condition=runtime.predicate,
        generation=runtime.generation, revision=runtime.revision)['reason'] == 'unresolved_prepared_intent'
    assert p.call(adapter, runtime, state, receipt, payload, 'reconcile')['kind'] == 'unsettled'
    assert p.call(adapter, runtime, state, receipt, payload, 'commit')['kind'] == 'committed'
    assert native('select count(*) from public.alert_outbox') == '1'


def test_intent_amendment_atomic_rollback_preserves_old_contract(native):
    native(MIGRATION.read_text())
    b.insert_alert(native, condition=intent_condition(), symbol='QQQ')
    before = native('select to_jsonb(a)::text from public.alerts a')
    bad = INTENT.read_text().replace('END $intent_revision_install$;',
        "RAISE EXCEPTION 'synthetic_intent_install_failure'; END $intent_revision_install$;")
    result = native(bad, check=False)
    assert result.returncode and 'synthetic_intent_install_failure' in result.stderr
    assert native('select to_jsonb(a)::text from public.alerts a') == before
    assert native("select count(*) from pg_attribute where attrelid='public.alerts'::regclass and attname='frozen_intent_revision' and not attisdropped") == '0'
    assert native("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint)') is not null") == 't'
    assert native("select to_regprocedure('public.arm_frozen_node_runtime(uuid,uuid,jsonb,uuid,bigint,uuid)') is null") == 't'


def test_intent_proposal_is_atomic_and_canonical0045_remains_immutable():
    assert len(split_statements(INTENT.read_text())) == 1
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == '2719fcdb0ca70248791459d981e5bb645f0b680a1382e181b2c08b8c6a27da30'
