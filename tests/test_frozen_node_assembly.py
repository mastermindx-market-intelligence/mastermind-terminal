"""Deployment-only assembly and real bounded workers; all IO is synthetic."""
import copy
import json
from pathlib import Path
import sys

import pytest

from ingest import alerts_engine as ae
from ingest.options_frozen_assembly import assemble_frozen_node_services as assemble
from test_alerts_frozen_service import workers, engine, reader, NOW  # noqa: F401


def invoke(config):
    return assemble(ae.Supa('https://synthetic.invalid', 'synthetic-service-key'), config,
                    load_env=ae.load_env, fingerprint=ae.frozen_node_target_fingerprint,
                    instant_micros=ae._fnp_instant_micros)


def config_at(tmp_path):
    script = tmp_path / 'frozen_options_account.py'
    bundle = tmp_path / 'frozen_node_source.mjs'
    env = tmp_path / 'account.env'
    script.touch(); bundle.touch()
    env.write_text('SUPABASE_URL=https://synthetic.invalid\nSUPABASE_SERVICE_ROLE_KEY=synthetic-service-key\n')
    return {'OPTIONS_FROZEN_READER_ENABLED': '1', 'OPTIONS_FROZEN_MACRO_PYTHON': sys.executable,
            'OPTIONS_FROZEN_MACRO_ACCOUNT_SCRIPT': str(script), 'OPTIONS_FROZEN_NODE': sys.executable,
            'OPTIONS_FROZEN_SOURCE_BUNDLE': str(bundle), 'OPTIONS_FROZEN_MACRO_ENV_FILE': str(env)}


def test_disabled_does_no_io_and_cannot_use_condition_config(monkeypatch):
    import ingest.options_frozen_assembly as module
    monkeypatch.setattr(Path, 'is_file', lambda *a: (_ for _ in ()).throw(AssertionError('IO')))
    for config in ({}, {'OPTIONS_FROZEN_READER_ENABLED': '0'}, {'condition': {
            'OPTIONS_FROZEN_READER_ENABLED': '1', 'rights': {'allowed': True}}}):
        assert invoke(config) == (None, None)
    monkeypatch.setattr(module, 'FrozenNodeServiceReader', lambda **k: (_ for _ in ()).throw(AssertionError('worker')))
    with pytest.raises(ValueError):
        invoke({'OPTIONS_FROZEN_READER_ENABLED': True})


def test_partial_malformed_origin_and_environment_fail_before_worker(tmp_path, monkeypatch):
    import ingest.options_frozen_assembly as module
    config = config_at(tmp_path)
    monkeypatch.setattr(module, 'FrozenNodeServiceReader', lambda **k: (_ for _ in ()).throw(AssertionError('worker')))
    for key in config.keys() - {'OPTIONS_FROZEN_READER_ENABLED'}:
        incomplete = dict(config); incomplete.pop(key)
        with pytest.raises(ValueError): invoke(incomplete)
    env = Path(config['OPTIONS_FROZEN_MACRO_ENV_FILE'])
    for origin in ('https://other.invalid', 'https://synthetic.invalid/path',
                   'https://user@synthetic.invalid', 'http://synthetic.invalid'):
        env.write_text(f'SUPABASE_URL={origin}\nSUPABASE_SERVICE_ROLE_KEY=synthetic-service-key\n')
        with pytest.raises(ValueError): invoke(config)
    env.write_text('SUPABASE_URL=https://synthetic.invalid\n')
    with pytest.raises(ValueError): invoke(config)
    env.write_text('x' * 65537)
    with pytest.raises(ValueError): invoke(config)


@pytest.mark.parametrize('fault', ['', 'principal', 'revoked', 'consent', 'source'])
def test_configured_factory_uses_actual_readers_and_run_once(workers, tmp_path, monkeypatch, fault):
    db, data = engine(tmp_path, monkeypatch)
    native = reader(workers, monkeypatch, fault)
    envfile = tmp_path / 'account.env'
    envfile.write_text(''.join(f'{k}={v}\n' for k,v in native._macro_env.items()
                               if k in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PYTHONPATH', 'MACRO_REPO', 'SENTRY_DSN')))
    config = {'OPTIONS_FROZEN_READER_ENABLED': '1',
        'OPTIONS_FROZEN_MACRO_PYTHON': native._account[0], 'OPTIONS_FROZEN_MACRO_ACCOUNT_SCRIPT': native._account[1],
        'OPTIONS_FROZEN_NODE': native._source[0], 'OPTIONS_FROZEN_SOURCE_BUNDLE': native._source[1],
        'OPTIONS_FROZEN_MACRO_ENV_FILE': str(envfile)}
    service, lifecycle = invoke(config)
    config['OPTIONS_FROZEN_NODE'] = '/client/replacement'
    before = copy.deepcopy(db.runtime)
    result = ae.run_once(ae.Supa('https://synthetic.invalid','synthetic-service-key'), data, NOW, 'synthetic-assembly',
                         frozen_node_reader=service, frozen_lifecycle_adapter=lifecycle)
    assert result['fired_n'] == 0 and db.outbox == []
    if fault:
        assert result['unevaluable_n'] == 1 and db.runtime == before
    else:
        assert result['unevaluable_n'] == 0 and db.runtime['revision'] == 1


def test_main_defaults_disabled_and_partial_optin_stops_before_data(tmp_path, monkeypatch):
    env = tmp_path / 'engine.env'
    env.write_text('NEXT_PUBLIC_SUPABASE_URL=https://synthetic.invalid\nSUPABASE_SERVICE_ROLE_KEY=synthetic-service-key\n')
    monkeypatch.setattr(sys, 'argv', ['alerts_engine.py', '--env-file', str(env)])
    monkeypatch.setattr(ae, 'Data', lambda *a: object())
    calls = []
    monkeypatch.setattr(ae, 'run_once', lambda *a, **k: calls.append(k))
    assert ae.main() == 0
    assert calls[0]['frozen_node_reader'] is None and calls[0]['frozen_lifecycle_adapter'] is None
    env.write_text(env.read_text() + 'OPTIONS_FROZEN_READER_ENABLED=1\n')
    monkeypatch.setattr(ae, 'Data', lambda *a: (_ for _ in ()).throw(AssertionError('Data')))
    assert ae.main() == 2 and len(calls) == 1
