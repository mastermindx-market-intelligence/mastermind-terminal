"""Actual two-process service composition through run_once. Explicit cross-repo fixture;
no ambient DB/R2/provider/socket is contacted. Production modules/CLI are used.
"""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone, timedelta

import pytest
import test_alerts_frozen_node as f
from ingest import alerts_engine as ae
from ingest.options_frozen_service import FrozenNodeServiceReader, _invoke

ROOT = Path(__file__).parents[1]
MACRO = os.environ.get('OPTIONS_FROZEN_MACRO_SOURCE')
ID = '10000000-0000-4000-8000-000000000001'
ALERT = '30000000-0000-4000-8000-000000000001'
NOW = datetime(2026, 10, 21, 14, tzinfo=timezone.utc)
EPOCH = '2026-10-21T13:30:00.000000Z'


@pytest.fixture(scope='module')
def workers(tmp_path_factory):
    if not MACRO:
        pytest.skip('explicit OPTIONS_FROZEN_MACRO_SOURCE required for actual two-repository composition')
    macro = Path(MACRO)
    assert (macro / 'scripts/frozen_options_account.py').is_file()
    esbuild = ROOT / 'terminal/node_modules/.bin/esbuild'
    node = shutil.which('node')
    if not esbuild.is_file() or not node:
        pytest.skip('existing Node/esbuild runtime unavailable; no installation')
    directory = tmp_path_factory.mktemp('frozen-service-workers')
    bundle = directory / 'frozen_node_source.mjs'
    subprocess.run([str(esbuild), 'ingest/frozen_node_source_cli.ts', '--bundle', '--platform=node', '--format=esm',
                    f'--outfile={bundle}', '--alias:@=./terminal', '--conditions=react-server', '--log-level=warning'], cwd=ROOT, check=True, capture_output=True)
    # Real CLI import, with only the native fetch boundary replaced by synthetic bytes.
    shim = directory / 'fetch-fixture.mjs'
    source = ROOT / 'terminal/lib/__tests__/fixtures/exposure-native-qqq-observed-v2.json'
    shim.write_text('''import {readFileSync} from 'node:fs';
    globalThis.fetch = async (url,init) => {
      if (!String(url).includes('QQQ') || !String(url).includes('2026-10-20')) throw new Error('unexpected fetch');
      let raw=JSON.parse(readFileSync(process.env.FROZEN_SERVICE_SOURCE,'utf8'));
      if(process.env.FROZEN_SERVICE_FAULT==='source') raw.outside_selected_lens='corrected';
      const r=new Response(JSON.stringify(raw));Object.defineProperty(r,'url',{value:url});return r;
    };''')
    python_shim = directory / 'sitecustomize.py'
    python_shim.write_text('''import os,json,urllib.request,contextlib,io
from types import SimpleNamespace
class Reply:
 def __init__(self,value):self.value=value
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def read(self):return json.dumps(self.value).encode()
def fake(req,*a,**k):
 url=req.full_url;fault=open(os.environ['FROZEN_SERVICE_FAULT_FILE']).read().strip();uid='10000000-0000-4000-8000-000000000001'
 if url.startswith('https://synthetic.invalid/auth/v1/admin/users/'):
  return Reply({'id':'other' if fault=='principal' else uid,'email':'synthetic@example.invalid','user_metadata':{'alert_email_optin':fault!='consent','alert_categories':['options_exposure_node']}})
 if url.startswith('https://synthetic.invalid/rest/v1/user_entitlements?'):
  return Reply([{'tier':'free' if fault=='revoked' else 'essential','features':['terminal_live_options'],'status':'active','current_period_end':'2026-11-21T00:00:00Z'}])
 raise AssertionError('network forbidden')
urllib.request.urlopen=fake
with contextlib.redirect_stdout(io.StringIO()):
 import app.main as main
 main._brain_module=lambda:SimpleNamespace(get_user_quotas=lambda *a,**k:{'tier':'free','quotas':{}})
''')
    return {'macro': macro, 'bundle': bundle, 'node': node, 'shim': shim, 'source': source, 'directory': directory}


def reader(workers, monkeypatch, fault=''):
    monkeypatch.setenv('NODE_OPTIONS', f'--import={workers["shim"]}')
    monkeypatch.setenv('FROZEN_SERVICE_SOURCE', str(workers['source']))
    monkeypatch.setenv('FROZEN_SERVICE_FAULT', fault)
    fault_file = workers['directory'] / 'current-account-fault'
    fault_file.write_text(fault)
    monkeypatch.setenv('FROZEN_SERVICE_FAULT_FILE', str(fault_file))
    env = {**os.environ, 'PYTHONPATH': os.pathsep.join([str(workers['directory']), str(workers['macro']), *[p for p in sys.path if 'site-packages' in p]]), 'SUPABASE_URL': 'https://synthetic.invalid',
           'SUPABASE_SERVICE_ROLE_KEY': 'synthetic-service-key', 'SENTRY_DSN': '', 'MACRO_REPO': str(workers['macro'])}
    return FrozenNodeServiceReader(macro_python=sys.executable,
        macro_account_script=workers['macro'] / 'scripts/frozen_options_account.py',
        node=workers['node'], source_bundle=workers['bundle'], macro_env=env,
        fingerprint=ae.frozen_node_target_fingerprint, instant_micros=ae._fnp_instant_micros)


def engine(tmp_path, monkeypatch, now=NOW, spot=160):
    cond = json.loads((ROOT / 'tests/fixtures/options_frozen_node_native_target.json').read_text())['condition']
    alert = {'id': ALERT, 'user_id': ID, 'symbol': 'QQQ', 'active': True, 'created_at': '2099-01-01T00:00:00Z', 'condition': cond}
    f._manifest(tmp_path)
    db = f._FakeRest([alert])
    db.runtime = {'schema': 'options.frozen_runtime/v1', 'alertId': ALERT, 'principal': ID,
        'generation': '20000000-0000-4000-8000-000000000002', 'createdAt': EPOCH, 'armingEpoch': EPOCH,
        'predicate': copy.deepcopy(cond), 'revision': 0, 'priorState': None}
    f._patch_http(monkeypatch, db)
    data = ae.Data(str(tmp_path), None, now_fn=lambda: now)
    data.quotes = {'QQQ': {'last': spot, 'asOfMs': int(now.timestamp()*1000), 'lagMs': 0, 'basis': 'LIVE',
        'marketSession': 'rth', 'regularSession': 'rth', 'regularSessionDate': now.date().isoformat()}}
    return db, data


def run(db, data, source_reader, now=NOW):
    supa = ae.Supa('https://synthetic.invalid', 'synthetic-service-key')
    return ae.run_once(supa, data, now, 'synthetic-service-integration', frozen_node_reader=source_reader,
                       frozen_lifecycle_adapter=supa.frozen_lifecycle_adapter())


def test_actual_canonical_account_cli_native_resolver_and_run_once(workers, tmp_path, monkeypatch):
    db, data = engine(tmp_path, monkeypatch)
    service = reader(workers, monkeypatch)
    first = run(db, data, service)
    assert first['unevaluable_n'] == 0 and first['fired_n'] == 0
    assert db.runtime['revision'] == 1 and db.runtime['priorState']['inside'] is False
    # A real hit through the complete composition remains deferred; no fire effect.
    prior = copy.deepcopy(db.runtime)
    later = NOW + timedelta(seconds=1)
    data.now_fn = lambda: later
    data.quotes['QQQ'].update(last=159.1, asOfMs=int(later.timestamp()*1000))
    second = run(db, data, service, later)
    assert second['fired_n'] == 0 and second['unevaluable_n'] == 1
    assert db.runtime == prior and db.outbox == []
    assert not any(method == 'PATCH' and '/alerts?' in url for method,url,body in db.calls)


@pytest.mark.parametrize('fault', ['principal', 'revoked', 'consent', 'source'])
def test_current_principal_revocation_consent_and_exact_source_refuse(workers, tmp_path, monkeypatch, fault):
    db, data = engine(tmp_path, monkeypatch)
    before = copy.deepcopy(db.runtime)
    result = run(db, data, reader(workers, monkeypatch, fault))
    assert result['unevaluable_n'] == 1 and db.runtime == before and db.outbox == []


def test_runtime_clock_and_client_command_cannot_supply_service_authority(workers, tmp_path, monkeypatch):
    db, data = engine(tmp_path, monkeypatch)
    service = reader(workers, monkeypatch)
    import ingest.options_frozen_service as service_module
    observed = []
    original = service_module._invoke
    def traced(*args, **kwargs):
        value = original(*args, **kwargs)
        observed.append((Path(args[0][1]).name, value))
        return value
    monkeypatch.setattr(service_module, '_invoke', traced)
    supa = ae.Supa('https://synthetic.invalid', 'synthetic-service-key')
    runtime = supa.frozen_lifecycle_adapter().read(db.alerts[ALERT], NOW.isoformat())
    assert service.read(runtime, db.alerts[ALERT], (NOW+timedelta(seconds=1)).isoformat(), source_origin='https://synthetic.invalid') is None
    assert service.read(db.runtime, db.alerts[ALERT], NOW.isoformat(), source_origin='https://synthetic.invalid') is None
    assert service.read(runtime, db.alerts[ALERT], NOW.isoformat(), source_origin='https://other-project.invalid') is None
    assert observed == []
    db.alerts[ALERT]['command'] = ['/bin/sh', '-c', 'forbidden']
    db.alerts[ALERT]['rights'] = {'allowed': True}
    result = run(db, data, service)
    assert result['unevaluable_n'] == 0, [(name, bool(value)) for name,value in observed]
    assert len(observed) == 2 and all(value for name,value in observed)


def test_same_reader_rechecks_revocation_after_valid_observation(workers, tmp_path, monkeypatch):
    db, data = engine(tmp_path, monkeypatch)
    service = reader(workers, monkeypatch)
    assert run(db, data, service)['unevaluable_n'] == 0
    prior = copy.deepcopy(db.runtime)
    (workers['directory'] / 'current-account-fault').write_text('revoked')
    later = NOW + timedelta(seconds=1)
    data.now_fn = lambda: later
    data.quotes['QQQ'].update(last=159.1, asOfMs=int(later.timestamp()*1000))
    assert run(db, data, service, later)['unevaluable_n'] == 1
    assert db.runtime == prior and db.outbox == []


@pytest.mark.parametrize('fault', ['', 'revoked', 'consent', 'principal'])
def test_delivery_account_reuses_current_canonical_policy_without_source_fetch(workers, tmp_path, monkeypatch, fault):
    from ingest.options_frozen_delivery import CommittedFrozenEvent
    service = reader(workers, monkeypatch, fault)
    no_fetch = tmp_path / 'forbid-fetch.mjs'
    no_fetch.write_text("globalThis.fetch=async()=>{throw new Error('NO_SOURCE_FETCH_PERMITTED')};")
    service._source_env['NODE_OPTIONS'] = f'--import={no_fetch}'
    event = CommittedFrozenEvent('40000000-0000-4000-8000-000000000001', 'a'*64,
                                 ID, ALERT, EPOCH, '{}')
    current = NOW.isoformat()
    result = service.read_delivery_account(event, current, source_origin='https://synthetic.invalid')
    if fault:
        assert result is None
    else:
        assert result == {'kind': 'delivery_account', 'principal': ID, 'evaluationAt': current}
        # Same reader must observe current revocation; no cached firing grant.
        (workers['directory'] / 'current-account-fault').write_text('revoked')
        assert service.read_delivery_account(event, current, source_origin='https://synthetic.invalid') is None


def test_delivery_account_refuses_inband_object_wrong_origin_and_backdated_check(workers, monkeypatch):
    from ingest.options_frozen_delivery import CommittedFrozenEvent
    import ingest.options_frozen_service as service_module
    service = reader(workers, monkeypatch)
    event = CommittedFrozenEvent('40000000-0000-4000-8000-000000000001', 'a'*64, ID, ALERT, EPOCH, '{}')
    calls=[]
    monkeypatch.setattr(service_module, '_invoke', lambda *args, **kwargs: calls.append(args))
    assert service.read_delivery_account({'principal': ID}, NOW.isoformat(), source_origin='https://synthetic.invalid') is None
    assert service.read_delivery_account(event, NOW.isoformat(), source_origin='https://other.invalid') is None
    assert service.read_delivery_account(event, '2026-10-20T00:00:00Z', source_origin='https://synthetic.invalid') is None
    assert calls == []


def test_local_protocol_rejects_nonzero_invalid_utf8_json_and_excess_output(tmp_path):
    for code in ("import sys;sys.exit(1)", "print('invalid')", "import sys;sys.stdout.buffer.write(b'\\xff')", "print('x'*300000)"):
        worker = tmp_path / 'protocol.py'; worker.write_text(code)
        assert _invoke((sys.executable, str(worker)), {}) is None


def test_local_protocol_timeout_and_input_bound(tmp_path, monkeypatch):
    import time
    import ingest.options_frozen_service as service_module
    worker = tmp_path / 'sleep.py'
    worker.write_text('import time;time.sleep(60)')
    monkeypatch.setattr(service_module, '_TIMEOUT', 0.1)
    started = time.monotonic()
    assert _invoke((sys.executable, str(worker)), {}) is None
    assert time.monotonic() - started < 2
    assert _invoke((sys.executable, str(worker)), {'oversize': 'x' * (1024 * 1024)}) is None


def test_evaluation_clock_is_captured_after_quote_priming(workers, tmp_path, monkeypatch):
    db, data = engine(tmp_path, monkeypatch)
    # The run begins first, then a quote arrives while the incumbent primer runs.
    # Its server event time precedes this alert's actual evaluation invocation.
    observed = NOW + timedelta(seconds=1)
    evaluation = NOW + timedelta(seconds=2)
    data.now_fn = lambda: evaluation
    data.quotes['QQQ']['asOfMs'] = int(observed.timestamp() * 1000)
    result = run(db, data, reader(workers, monkeypatch), now=NOW)
    assert result['unevaluable_n'] == 0
    assert db.runtime['revision'] == 1
    assert db.runtime['priorState']['lastQuoteAt'] == observed.isoformat(timespec='microseconds').replace('+00:00', 'Z')
    assert db.outbox == []


def test_genuinely_future_quote_remains_unavailable(workers, tmp_path, monkeypatch):
    db, data = engine(tmp_path, monkeypatch)
    data.now_fn = lambda: NOW + timedelta(seconds=2)
    data.quotes['QQQ']['asOfMs'] = int((NOW+timedelta(seconds=3)).timestamp()*1000)
    before = copy.deepcopy(db.runtime)
    assert run(db, data, reader(workers, monkeypatch))['unevaluable_n'] == 1
    assert db.runtime == before and db.outbox == []
