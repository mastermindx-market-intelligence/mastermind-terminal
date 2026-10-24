"""Actual private-socket PG atomic hit/outbox/fanout; no configured DB or delivery."""
import copy
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import test_alerts_frozen_lifecycle_postgres as b
from ingest import alerts_engine as ae
from ingest.options_frozen_hit import FrozenNodeHitPublisher

ROOT = Path(__file__).parents[1]
SQL = ROOT/'tests/sql/options_frozen_node/proposed_atomic_hit.sql'
TEAM = '40000000-0000-4000-8000-000000000001'
ENDPOINT = '50000000-0000-4000-8000-000000000001'


@pytest.fixture(scope='module')
def hit_pg(tmp_path_factory):
    directory = tmp_path_factory.mktemp('frozen-hit-postgres')
    pg, reason = b.make_server(directory)
    if pg is None:
        pytest.skip(reason)
    try:
        pg('create schema extensions; create extension pgcrypto with schema extensions;')
        for name in ('0013_alert_runs_outbox.sql','0014_tenancy_foundation.sql',
                     '0018_webhook_delivery.sql','0026_webhook_rotation_alert_fires.sql'):
            pg((ROOT/'supabase/migrations'/name).read_text())
        # Explicit model of required Supabase service default ACL, not target proof.
        pg('grant all on public.alert_runs,public.alert_outbox to service_role;')
        pg(SQL.read_text()); pg(SQL.read_text())
        (directory/'hit-fixture-source.json').write_text(json.dumps({
            'hashes':{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in (
                'tests/sql/options_frozen_node/proposed_atomic_hit.sql',
                'tests/test_alerts_frozen_hit_postgres.py','ingest/options_frozen_hit.py','ingest/alerts_engine.py')},
            'postgres_version_num':pg.version_num(),'listen_addresses':pg('show listen_addresses'),
            'scope':'disposable socket only; no target DB or delivery'},indent=2))
        yield pg
    finally:
        pg.stop()


@pytest.fixture
def pg(hit_pg):
    hit_pg('truncate public.alerts,public.alert_outbox,public.teams,public.webhook_endpoints,public.webhook_deliveries cascade')
    hit_pg(f"insert into public.teams(id,name,created_by) values({b.q(TEAM)},'synthetic',{b.q(b.A)})")
    hit_pg(f"insert into public.webhook_endpoints(id,team_id,url,secret,created_by,event_filter) values"
           f"({b.q(ENDPOINT)},{b.q(TEAM)},'https://synthetic.invalid/webhook','synthetic-secret',{b.q(b.A)},array['alert.fired'])")
    hit_pg(f"insert into public.webhook_alert_optins(team_id,user_id,enabled) values({b.q(TEAM)},{b.q(b.A)},true)")
    return hit_pg


def rpc(pg,name,params):
    keys=['p_alert_id','p_principal','p_predicate']
    if name=='commit_frozen_node_state':
        keys+=['p_generation','p_revision','p_next_state']
        if 'p_hit' in params: keys+=['p_hit']
    return b.call(pg,name,[params[k] for k in keys])


def candidate(pg,symbol='QQQ'):
    condition=json.loads((ROOT/'tests/fixtures/options_frozen_node_native_target.json').read_text())['condition']
    b.insert_alert(pg,condition=condition,symbol=symbol,created_at='2099-01-01T00:00:00Z')
    assert pg(f'select symbol from public.alerts where id={b.q(b.ALERT_IDS[0])}')==symbol
    assert pg(f"select created_at='2099-01-01T00:00:00Z'::timestamptz from public.alerts where id={b.q(b.ALERT_IDS[0])}")=='t'
    b.call(pg,'arm_frozen_node_runtime',[b.ALERT_IDS[0],b.A,condition,None,None])
    adapter=ae.FrozenNodeLifecycleAdapter(lambda name,p:rpc(pg,name,p),
        fingerprint=ae.frozen_node_target_fingerprint,instant_micros=ae._fnp_instant_micros,
        normalize_state=ae._fnp_normalize_state,format_instant=ae._fnp_format_instant_utc,
        default_within_pct=ae.FNP_DEFAULT_WITHIN_PCT,source_origin='https://synthetic.invalid')
    alert={'id':b.ALERT_IDS[0],'user_id':b.A,'symbol':symbol,'active':True,
           'created_at':'2099-01-01T00:00:00Z','condition':condition}
    at=pg.clock();first=adapter.read(alert,at)
    assert first.created_at != alert['created_at']  # RPC generation clock, not owner-writable row clock.
    outside={'targetFingerprint':first.target_fingerprint,'armingEpoch':first.arming_epoch,
             'lastQuoteAt':at,'inside':False,'withinPct':first.within_pct,'lastQuoteBasis':'LIVE'}
    assert adapter.commit(first,outside)
    at=pg.clock();runtime=adapter.read(alert,at)
    quote={'spot':159.1,'asof':at,'basis':'LIVE'}
    admission={'principal':b.A,'action':'frozen_node_proximity','evaluationAt':at,
        'target':condition['target'],'rights':{'allowed':True,'policy_version':'options.frozen_node_proximity/account/v1','checked_at':at},
        'rights_decision_ref':'DEC:COMMERCIAL-DATA-RIGHTS-CHAIRMAN-ATTESTATION-20261023',
        'createdAt':runtime.created_at,'armingEpoch':runtime.arming_epoch,'priorState':runtime.prior_state}
    state={**outside,'lastQuoteAt':at,'inside':True}
    receipt,payload=ae._frozen_hit_envelope(runtime,state,admission,quote)
    return alert,adapter,runtime,state,receipt,payload


def effects(pg):
    return tuple(int(pg(f'select count(*) from public.{name}')) for name in ('alert_outbox','webhook_deliveries'))


def test_atomic_commit_replay_and_full_projection(pg):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    publisher=FrozenNodeHitPublisher(adapter)
    assert publisher.publish(runtime,state,receipt,payload)=={'kind':'committed','fireEventId':receipt['fireEventId']}
    assert effects(pg)==(1,1) and not b.get_active(pg,alert['id']) and b.get_runtime(pg,alert['id']) is None
    stored=json.loads(pg('select payload from public.alert_outbox'))
    projected=json.loads(pg('select payload from public.webhook_deliveries'))
    assert stored==payload
    for key in ('category','requires_tier','frozen_node','condition_plain','condition_plain_zh'):
        assert projected[key]==payload[key]
    assert 'observed partial' in projected['condition_plain'] and 'sampled proximity' in projected['condition_plain']
    assert publisher.reconcile(runtime,state,receipt,payload)['kind']=='already_committed'
    assert effects(pg)==(1,1)


def test_racing_same_hit_one_effect(pg):
    _,adapter,runtime,state,receipt,payload=candidate(pg)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:FrozenNodeHitPublisher(adapter).publish(runtime,state,receipt,payload),range(2)))
    assert sorted(x['kind'] for x in results)==['already_committed','committed']
    assert effects(pg)==(1,1)


def test_idle_hit_race(pg):
    _,adapter,runtime,state,receipt,payload=candidate(pg)
    with ThreadPoolExecutor(max_workers=2) as pool:
        commit=pool.submit(FrozenNodeHitPublisher(adapter).publish,runtime,state,receipt,payload)
        persist=pool.submit(adapter.commit,runtime,{**state,'inside':False})
        hit,changed=commit.result(),persist.result()
    assert (hit['kind']=='committed') != changed
    assert effects(pg)==((1,1) if hit['kind']=='committed' else (0,0))


@pytest.mark.parametrize('change',["active=false","condition=condition || '{\"within_pct\":0.3}'::jsonb"])
def test_owner_pause_edit_before_hit(pg,change):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    pg(f'update public.alerts set {change} where id={b.q(alert["id"])}',role='authenticated',claims={'sub':b.A,'role':'service_role'})
    assert b.get_runtime(pg,alert['id']) is None
    assert FrozenNodeHitPublisher(adapter).publish(runtime,state,receipt,payload)['kind'] in ('unavailable','conflict')
    assert effects(pg)==(0,0)


def test_generation_collision_and_exact_old_recovery_never_mutate_current(pg):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    old=copy.deepcopy(payload)
    old['frozen_node']['publication_receipt']['runtime']['generation']='90000000-0000-4000-8000-000000000001'
    # Server fixture seeds an older generation's immutable receipt at the SAME
    # fixed triple. No timestamp/ID substitution or minute-boundary skip.
    pg(f"insert into public.alert_outbox(user_id,alert_id,fire_event_id,payload) values"
       f"({b.q(b.A)},{b.q(alert['id'])},{b.q(receipt['fireEventId'])},{b.q(old)})")
    before=b.get_runtime(pg,alert['id'])
    assert FrozenNodeHitPublisher(adapter).publish(runtime,state,receipt,payload)['kind']=='conflict'
    assert b.get_runtime(pg,alert['id'])==before and b.get_active(pg,alert['id']) and effects(pg)==(1,1)
    # Explicit exact old receipt reconciliation may acknowledge only that old
    # effect; it must not disarm or alter today's protected generation.
    old_runtime=copy.deepcopy(runtime)
    from dataclasses import replace
    old_runtime=replace(old_runtime,generation=old['frozen_node']['publication_receipt']['runtime']['generation'])
    assert FrozenNodeHitPublisher(adapter).reconcile(old_runtime,state,old['frozen_node']['publication_receipt'],old)['kind']=='already_committed'
    assert b.get_runtime(pg,alert['id'])==before and b.get_active(pg,alert['id'])


@pytest.mark.parametrize('which',['outbox','fanout','disarm'])
def test_failure_rolls_back_all_writes(pg,which):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    relation={'outbox':'alert_outbox','fanout':'webhook_deliveries','disarm':'alerts'}[which]
    operation='update' if which=='disarm' else 'insert'
    pg(f"create function public.synthetic_hit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic'; end$$;"
       f'create trigger synthetic_hit_failure before {operation} on public.{relation} for each row execute function public.synthetic_hit_failure();')
    try:
        result=FrozenNodeHitPublisher(adapter).publish(runtime,state,receipt,payload)
        assert result['kind']=='unavailable' and effects(pg)==(0,0)
        assert b.get_active(pg,alert['id']) and b.get_runtime(pg,alert['id'])==receipt['runtime']
    finally:
        pg(f'drop trigger synthetic_hit_failure on public.{relation};drop function public.synthetic_hit_failure()')


def test_reconcile_absence_and_claims_role_forgery(pg):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    assert FrozenNodeHitPublisher(adapter).reconcile(runtime,state,receipt,payload)['reason']=='no_committed_receipt'
    args=[alert['id'],b.A,runtime.predicate,runtime.generation,runtime.revision,state,{'mode':'commit','receipt':receipt,'payload':payload}]
    denied=b.call_raw(pg,'commit_frozen_node_state',args,role='authenticated',claims={'sub':b.A,'role':'service_role'})
    assert denied.returncode!=0 and 'permission denied' in denied.stderr and effects(pg)==(0,0)
    assert pg("select to_regprocedure('public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)') is null")=='t'
    assert pg("select has_function_privilege('service_role','public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb)','EXECUTE')")=='t'


def test_legacy_projection_warning_behavior_unchanged(pg):
    pg("create function public.synthetic_hit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic'; end$$;"
       'create trigger synthetic_hit_failure before insert on public.webhook_deliveries for each row execute function public.synthetic_hit_failure();')
    try:
        pg(f"insert into public.alert_outbox(user_id,alert_id,fire_event_id,payload) values"
           f"({b.q(b.A)},{b.q(b.ALERT_IDS[0])},repeat('a',64),'{{\"subject\":\"legacy\"}}')")
        assert effects(pg)==(1,0)
    finally:
        pg('drop trigger synthetic_hit_failure on public.webhook_deliveries;drop function public.synthetic_hit_failure()')


@pytest.mark.parametrize('fault',['rights','quote_type','future','payload','epoch'])
def test_malformed_or_mismatched_evidence_no_effect(pg,fault):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    bad=copy.deepcopy(receipt)
    if fault=='rights':bad['admission']['rights']['allowed']=False
    elif fault=='quote_type':bad['quote']['spot']=True
    elif fault=='future':bad['evaluationAt']='2099-01-01T00:00:00Z'
    elif fault=='payload':payload['ticker']='SPY'
    elif fault=='epoch':bad['admission']['armingEpoch']='2000-01-01T00:00:00Z'
    payload['frozen_node']['publication_receipt']=bad
    result=b.call(pg,'commit_frozen_node_state',[alert['id'],b.A,runtime.predicate,runtime.generation,runtime.revision,state,
                                                {'mode':'commit','receipt':bad,'payload':payload}])
    assert result['kind']=='unavailable' and effects(pg)==(0,0)
    assert b.get_runtime(pg,alert['id'])==receipt['runtime'] and b.get_active(pg,alert['id'])


@pytest.mark.parametrize('mutation',['resume','delete_reinsert'])
def test_stale_generation_after_real_rearm_zero_effect(pg,mutation):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    if mutation=='resume':
        pg(f'update public.alerts set active=false where id={b.q(alert["id"])}')
        pg(f'update public.alerts set active=true where id={b.q(alert["id"])}')
    else:
        pg(f'delete from public.alerts where id={b.q(alert["id"])}')
        b.insert_alert(pg,condition=runtime.predicate,symbol='QQQ')
    fresh=b.call(pg,'arm_frozen_node_runtime',[alert['id'],b.A,runtime.predicate,None,None])['runtime']
    assert fresh['generation']!=runtime.generation
    assert FrozenNodeHitPublisher(adapter).publish(runtime,state,receipt,payload)['kind'] in ('conflict','unavailable')
    assert b.get_runtime(pg,alert['id'])==fresh and effects(pg)==(0,0)


def test_absent_outbox_never_disarms(pg):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    pg('alter table public.alert_outbox rename to synthetic_absent_outbox')
    try:
        assert FrozenNodeHitPublisher(adapter).publish(runtime,state,receipt,payload)['kind']=='unavailable'
        assert b.get_active(pg,alert['id']) and b.get_runtime(pg,alert['id'])==receipt['runtime']
    finally:
        pg('alter table public.synthetic_absent_outbox rename to alert_outbox')
    assert effects(pg)==(0,0)


def test_unknown_response_no_retry_then_explicit_same_id_reconciliation(pg):
    _,adapter,runtime,state,receipt,payload=candidate(pg)
    original=adapter.rpc;calls=[]
    def lost(name,params):
        calls.append(params)
        original(name,params)
        raise OSError('synthetic response lost AFTER SQL commit')
    adapter.rpc=lost
    publisher=FrozenNodeHitPublisher(adapter)
    assert publisher.publish(runtime,state,receipt,payload)['kind']=='effect_unknown'
    assert len(calls)==1 and effects(pg)==(1,1)
    adapter.rpc=original
    assert publisher.reconcile(runtime,state,receipt,payload)['kind']=='already_committed'
    assert effects(pg)==(1,1)


# This fixture reuses the actual compiled CLI + canonical Macro account helper;
# only subprocess I/O boundaries and market quote availability are synthetic.
from test_alerts_frozen_service import workers,reader as service_reader  # noqa: E402,F401
import test_alerts_frozen_node as core  # noqa: E402


@pytest.mark.parametrize('lost_response',[False,True])
def test_actual_run_once_service_workers_and_atomic_pg_payload(pg,workers,tmp_path,monkeypatch,lost_response):
    alert,_,_,_,_,_=candidate(pg,symbol='SPY')  # actual row differs; target/root stays QQQ
    fake=core._FakeRest([alert]);core._patch_http(monkeypatch,fake)
    fallback=ae.http_json_status
    calls=[]
    def status(url,headers=None,method='GET',body=None,timeout=15):
        if '/rpc/' in url:
            calls.append(body)
            result=rpc(pg,url.rsplit('/',1)[1],body)
            if lost_response and body.get('p_hit',{}).get('mode')=='commit':
                return 0,None,'synthetic response lost AFTER commit'
            return 200,result,json.dumps(result)
        return fallback(url,headers,method,body,timeout)
    monkeypatch.setattr(ae,'http_json_status',status)
    core._manifest(tmp_path)
    at=pg.clock()
    now=ae.datetime.fromisoformat(at.replace('Z','+00:00'))
    data=ae.Data(str(tmp_path),None,now_fn=lambda:now)
    quote_calls=[]
    def quote(root):
        quote_calls.append(root)
        assert root=='QQQ' and len(quote_calls)==1
        return {'spot':159.1,'asof':at,'basis':'DELAYED_15M'}
    monkeypatch.setattr(data,'live_quote',quote)
    monkeypatch.setattr(data,'evaluation_vintage',lambda *a:(_ for _ in ()).throw(AssertionError('second vintage')))
    supa=ae.Supa('https://synthetic.invalid','synthetic-service-key');adapter=supa.frozen_lifecycle_adapter()
    result=ae.run_once(supa,data,now,'synthetic-atomic-hit',frozen_node_reader=service_reader(workers,monkeypatch),
                       frozen_lifecycle_adapter=adapter,frozen_node_publisher=FrozenNodeHitPublisher(adapter))
    assert result['fired_n']==(0 if lost_response else 1)
    assert result['unevaluable_n']==int(lost_response) and effects(pg)==(1,1)
    payload=json.loads(pg('select payload from public.alert_outbox'))
    assert payload['ticker']=='QQQ' and payload['category']=='options_exposure_node' and payload['requires_tier']=='essential'
    assert '15-minute-delayed' in payload['condition_plain'] and 'observed partial' in payload['condition_plain']
    assert payload['frozen_node']['publication_receipt']['quote']['asof']==at
    assert payload['frozen_node']['publication_receipt']['vintage']==ae._minute_vintage(at)
    assert len([p for p in calls if p.get('p_hit')])==1
    assert not any('/alert_outbox' in url for _,url,_ in fake.calls)
    assert not any(method=='PATCH' and '/alerts?' in url for method,url,_ in fake.calls)
    if lost_response:
        assert result['error_class']=='frozen_fire_effect_unknown'
        retained=result['frozen_effect_unknown'][0]
        snapshot=adapter._validate(alert,{'kind':'data','runtime':retained['receipt']['runtime']},retained['receipt']['evaluationAt'])
        assert FrozenNodeHitPublisher(adapter).reconcile(snapshot,retained['receipt']['nextState'],
            retained['receipt'],retained['payload'])['kind']=='already_committed'
        assert effects(pg)==(1,1)


def test_upgrade_single_statement_failure_restores_old_signature_and_acl(pg):
    from scripts.supabase_apply import split_statements,strip_sql_comments
    sql=SQL.read_text()
    units=[strip_sql_comments(s).strip() for s in split_statements(sql) if strip_sql_comments(s).strip()]
    assert len(units)==1
    pg('drop function public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb)')
    pg((ROOT/'tests/sql/options_frozen_node/proposed_lifecycle.sql').read_text())
    before=pg("select pg_get_functiondef('public.project_alert_fire_to_webhooks()'::regprocedure)")
    broken=sql.replace('end;\n$atomic_frozen_hit$;',"raise exception 'synthetic final installer failure';\nend;\n$atomic_frozen_hit$;")
    try:
        for statement in split_statements(broken):
            statement=strip_sql_comments(statement).strip()
            if statement:
                result=pg(statement,check=False)
                assert result.returncode!=0 and 'synthetic final installer failure' in result.stderr
        assert pg("select to_regprocedure('public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb)') is null")=='t'
        assert pg("select has_function_privilege('service_role','public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)','EXECUTE')")=='t'
        assert pg("select has_function_privilege('authenticated','public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb)','EXECUTE')")=='f'
        assert pg("select pg_get_functiondef('public.project_alert_fire_to_webhooks()'::regprocedure)")==before
    finally:
        pg(sql)


@pytest.mark.parametrize('competitor',['pause','rearm'])
def test_actual_owner_pause_or_service_rearm_races_hit(pg,competitor):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    def competing():
        if competitor=='pause':
            pg(f'update public.alerts set active=false where id={b.q(alert["id"])}',role='authenticated',claims={'sub':b.A})
            return None
        return b.call(pg,'arm_frozen_node_runtime',[alert['id'],b.A,runtime.predicate,runtime.generation,runtime.revision])
    with ThreadPoolExecutor(max_workers=2) as pool:
        fire=pool.submit(FrozenNodeHitPublisher(adapter).publish,runtime,state,receipt,payload)
        other=pool.submit(competing)
        result,other_result=fire.result(),other.result()
    if competitor=='rearm':
        assert (result['kind']=='committed') != (other_result['kind']=='data')
    assert effects(pg)==((1,1) if result['kind']=='committed' else (0,0))
    if competitor=='pause' or result['kind']=='committed':
        assert not b.get_active(pg,alert['id']) and b.get_runtime(pg,alert['id']) is None


def test_read_reconciliation_failure_is_unavailable_not_effect_unknown(pg,monkeypatch):
    _,adapter,runtime,state,receipt,payload=candidate(pg)
    adapter.rpc=lambda *a:(_ for _ in ()).throw(OSError('synthetic read transport failure'))
    assert FrozenNodeHitPublisher(adapter).reconcile(runtime,state,receipt,payload)['kind']=='unavailable'
    assert effects(pg)==(0,0)
    monkeypatch.setattr(ae,'http_json_status',lambda *a,**k:(0,None,'synthetic transport failure'))
    supa=ae.Supa('https://synthetic.invalid','synthetic-service-key')
    for mode,kind in [('commit','effect_unknown'),('reconcile','unavailable')]:
        assert supa.frozen_runtime_rpc('commit_frozen_node_state',{'p_hit':{'mode':mode}})['kind']==kind
