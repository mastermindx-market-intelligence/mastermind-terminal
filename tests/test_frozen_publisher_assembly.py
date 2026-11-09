"""Production main wiring with isolated account/source/REST fixtures; no live IO.

The existing publisher and run_once remain real. RPC responses here prove transport
composition only; previously accepted PostgreSQL tests own atomic SQL semantics.
"""
import copy
import sys

import pytest
import test_alerts_frozen_node as f
from test_frozen_node_assembly import config_at
from ingest import alerts_engine as ae
from ingest import options_frozen_assembly as assembly


@pytest.mark.parametrize('flag', [None, '', '0'])
def test_publication_default_off_never_constructs(flag, monkeypatch):
    monkeypatch.setattr(assembly, 'FrozenNodeHitPublisher', lambda *_: pytest.fail('publisher'))
    config = {} if flag is None else {'OPTIONS_FROZEN_PUBLISHER_ENABLED': flag}
    assert assembly.assemble_frozen_node_publisher(object(), config) is None


@pytest.mark.parametrize('flag', ['true', 'yes', True, 1, ' 1', '2'])
def test_invalid_publication_optin_rejected(flag):
    with pytest.raises(ValueError):
        assembly.assemble_frozen_node_publisher(None, {'OPTIONS_FROZEN_PUBLISHER_ENABLED': flag})


def test_publication_requires_existing_reader_adapter():
    config = {'OPTIONS_FROZEN_PUBLISHER_ENABLED': '1', 'OPTIONS_FROZEN_READER_ENABLED': '1'}
    for adapter in (None, object(), {'rpc': 'client capability'}):
        with pytest.raises(ValueError): assembly.assemble_frozen_node_publisher(adapter, config)
    adapter = ae.Supa('https://synthetic.invalid', 'synthetic-key').frozen_lifecycle_adapter()
    with pytest.raises(ValueError): assembly.assemble_frozen_node_publisher(adapter, {**config, 'OPTIONS_FROZEN_READER_ENABLED': '0'})
    assert assembly.assemble_frozen_node_publisher(adapter, config).lifecycle is adapter


def invoke_main(tmp_path, monkeypatch, *, enabled=True, fault=None, dry_run=False):
    prior = f._fnp_state(inside=False)
    db, data = f._engine(tmp_path, monkeypatch, f._alert(), quote=f._rth_quote(620.0, minutes_ago=.5))
    db.runtime = f._runtime_for(f._alert(), prior)
    db.runtime['revision'] = 1
    modes = []
    original_get, original_post = db.get, db.post

    def get(url):
        if '/alert_runs?' in url:
            db.calls.append(('GET', url, None))
            return 200, [{'run_id': 'unknown-original'}] if fault == 'prior_unknown' else [], ''
        return original_get(url)

    def post(url, body):
        if body and body.get('p_hit'):
            db.calls.append(('POST', url, copy.deepcopy(body)))
            hit = body['p_hit']; modes.append(hit['mode'])
            if hit['mode'] == 'prepare':
                if fault == 'prepare_unknown': return 0, None, ''
                return 200, {'kind': 'prepared', 'fireEventId': hit['receipt']['fireEventId'], 'receipt': hit['receipt']}, ''
            assert hit['mode'] == 'commit'
            if fault == 'commit_unknown': return 0, None, ''
            db.outbox.append(copy.deepcopy(hit['payload']))
            return 200, {'kind': 'committed', 'fireEventId': hit['receipt']['fireEventId']}, ''
        return original_post(url, body)

    db.get, db.post = get, post
    class SyntheticReader(assembly.FrozenNodeServiceReader):
        def __init__(self, **_): pass
        def read(self, runtime, alert, at, *, source_origin):
            assert source_origin == 'https://synthetic.invalid'
            context = f._reader(prior, allowed=fault != 'denied')(alert, at)
            if fault == 'principal': context['principal'] = 'other-principal'
            if fault == 'source_clock': context['target']['availableAt'] = '2099-01-01T00:00:00Z'
            return context
    monkeypatch.setattr(assembly, 'FrozenNodeServiceReader', SyntheticReader)
    monkeypatch.setattr(ae, 'Data', lambda *_: data)
    config = config_at(tmp_path)
    config.update(NEXT_PUBLIC_SUPABASE_URL='https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY='synthetic-key')
    if enabled: config['OPTIONS_FROZEN_PUBLISHER_ENABLED'] = '1'
    if fault == 'incomplete': config.pop('OPTIONS_FROZEN_READER_ENABLED')
    env = tmp_path / 'engine.env'; env.write_text(''.join(f'{k}={v}\n' for k,v in config.items()))
    monkeypatch.setattr(sys, 'argv', ['alerts_engine.py', '--env-file', str(env)] + (['--dry-run'] if dry_run else []))
    real_run = ae.run_once
    seen = []
    def run(*args, **kwargs):
        publisher = kwargs['frozen_node_publisher']
        if enabled:
            assert isinstance(publisher, ae.FrozenNodeHitPublisher)
            assert publisher.lifecycle is kwargs['frozen_lifecycle_adapter']
        else: assert publisher is None
        result = real_run(*args, **kwargs); seen.append(result); return result
    monkeypatch.setattr(ae, 'run_once', run)
    code = ae.main()
    return code, db, modes, seen


def test_actual_main_reaches_existing_prepare_commit(tmp_path, monkeypatch):
    code, db, modes, results = invoke_main(tmp_path, monkeypatch)
    assert code == 0 and modes == ['prepare', 'commit']
    assert results[0]['fired_n'] == 1 and len(db.outbox) == 1
    assert db.runs[0]['error_class'] is None


@pytest.mark.parametrize('fault', ['denied', 'principal', 'source_clock', 'prior_unknown'])
def test_main_unqualified_context_never_publishes(tmp_path, monkeypatch, fault):
    code, db, modes, results = invoke_main(tmp_path, monkeypatch, fault=fault)
    assert code == 0 and modes == [] and db.outbox == [] and results[0]['fired_n'] == 0


def test_reader_optin_alone_preserves_no_publication(tmp_path, monkeypatch):
    code, db, modes, results = invoke_main(tmp_path, monkeypatch, enabled=False)
    assert code == 0 and modes == [] and db.outbox == [] and results[0]['fired_n'] == 0


def test_incomplete_configuration_stops_before_runtime(tmp_path, monkeypatch):
    code, db, modes, results = invoke_main(tmp_path, monkeypatch, fault='incomplete')
    assert code == 2 and results == [] and db.calls == [] and modes == []


def test_main_dry_run_keeps_all_writes_off(tmp_path, monkeypatch):
    code, db, modes, results = invoke_main(tmp_path, monkeypatch, dry_run=True)
    assert code == 0 and modes == [] and db.outbox == [] and db.runs == []
    assert not any(method in ('POST','PATCH') and '/rpc/read_frozen_node_runtime' not in url for method,url,_ in db.calls)


@pytest.mark.parametrize('fault,expected', [('prepare_unknown',['prepare']), ('commit_unknown',['prepare','commit'])])
def test_main_unknown_never_retries(tmp_path, monkeypatch, fault, expected):
    code, db, modes, results = invoke_main(tmp_path, monkeypatch, fault=fault)
    assert code == 0 and modes == expected and db.outbox == []
    assert results[0]['frozen_effect_unknown'] and db.runs[0]['error_class'] == 'frozen_fire_effect_unknown'
