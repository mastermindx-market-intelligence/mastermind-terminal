"""Canonical P09 packaging: actual private PostgreSQL, never a configured database."""
from pathlib import Path
import hashlib
import json
import re

import pytest

import test_alerts_frozen_lifecycle_postgres as b
from scripts.supabase_apply import split_statements, readback_statements, idempotency_findings

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
