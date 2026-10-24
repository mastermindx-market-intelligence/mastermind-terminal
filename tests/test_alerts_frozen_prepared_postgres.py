"""Private-socket PostgreSQL prepared-intent/restart protocol; no live DB/send."""
from pathlib import Path
import copy
import json
from concurrent.futures import ThreadPoolExecutor
import pytest
import test_alerts_frozen_hit_postgres as h
from test_alerts_frozen_hit_postgres import hit_pg  # noqa: F401
from ingest.options_frozen_delivery import FrozenNodeCommittedEventReader


@pytest.fixture
def pg(hit_pg):
    hit_pg((Path(__file__).parent / "sql/options_frozen_node/proposed_prepared_intent.sql").read_text())
    hit_pg("truncate public.alerts,public.alert_outbox,public.alert_runs,public.teams,public.webhook_endpoints,public.webhook_deliveries cascade")
    hit_pg(f"insert into public.teams(id,name,created_by) values({h.b.q(h.TEAM)},'synthetic',{h.b.q(h.b.A)})")
    hit_pg(f"insert into public.webhook_endpoints(id,team_id,url,secret,created_by,event_filter) values"
           f"({h.b.q(h.ENDPOINT)},{h.b.q(h.TEAM)},'https://synthetic.invalid/webhook','synthetic-secret',{h.b.q(h.b.A)},array['alert.fired'])")
    hit_pg(f"insert into public.webhook_alert_optins(team_id,user_id,enabled) values({h.b.q(h.TEAM)},{h.b.q(h.b.A)},true)")
    return hit_pg


def test_prepare_persists_intent_without_publication(pg):
    _, adapter, runtime, state, receipt, payload = subject(pg)
    result = adapter.rpc('commit_frozen_node_state', {
        'p_alert_id': runtime.alert_id, 'p_principal': runtime.principal,
        'p_predicate': runtime.predicate, 'p_generation': runtime.generation,
        'p_revision': runtime.revision, 'p_next_state': state,
        'p_hit': {'mode': 'prepare', 'receipt': receipt, 'payload': payload}})
    assert result.get('kind') == 'prepared', result
    assert h.b.get_active(pg, runtime.alert_id)
    assert h.b.get_runtime(pg, runtime.alert_id) == h.ae.runtime_record(runtime)
    assert pg("select status from public.alert_outbox") == 'prepared'
    assert pg("select count(*) from public.webhook_deliveries") == '0'


def call(adapter, runtime, state, receipt, payload, mode):
    return adapter.rpc('commit_frozen_node_state', {
        'p_alert_id': runtime.alert_id, 'p_principal': runtime.principal,
        'p_predicate': runtime.predicate, 'p_generation': runtime.generation,
        'p_revision': runtime.revision, 'p_next_state': state,
        'p_hit': {'mode': mode, 'receipt': receipt, 'payload': payload}})


def subject(pg):
    alert,adapter,runtime,state,receipt,payload=h.candidate(pg)
    receipt['invocation']={'lane':'prepared_test','runId':runtime.generation}
    payload['frozen_node']['publication_receipt']=receipt
    pg(f"insert into public.alert_runs(lane,run_id,started_at,error_class) values('prepared_test',{h.b.q(runtime.generation)},{h.b.q(runtime.created_at)},'frozen_publication_pending')")
    return alert,adapter,runtime,state,receipt,payload


def test_commit_requires_prepared_and_absent_fence_is_not_placeholder(pg):
    alert,a,r,s,x,p=subject(pg)
    before=h.b.get_runtime(pg,r.alert_id)
    for mode in ('commit','reconcile','fence'):
        assert call(a,r,s,x,p,mode)['kind']=='unavailable'
    assert h.effects(pg)==(0,0) and h.b.get_active(pg,r.alert_id)
    assert h.b.get_runtime(pg,r.alert_id)==before


def test_repeated_prepare_is_unsettled_never_fresh_permission(pg):
    _,a,r,s,x,p=subject(pg)
    assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    for mode in ('prepare','reconcile'):
        assert call(a,r,s,x,p,mode)['kind']=='unsettled'
    assert h.effects(pg)==(1,0)
    assert call(a,r,s,x,p,'commit')['kind']=='committed'
    assert h.effects(pg)==(1,1) and not h.b.get_active(pg,r.alert_id)
    assert call(a,r,s,x,p,'reconcile')['kind']=='already_committed'
    assert call(a,r,s,x,p,'fence')['kind']=='already_committed'
    assert h.effects(pg)==(1,1)


def test_persisted_intent_withholds_new_process_read_idle_and_arm(pg):
    alert,a,r,s,x,p=subject(pg)
    assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    # A newly constructed adapter has no in-memory knowledge of the first process.
    fresh=h.ae.FrozenNodeLifecycleAdapter(lambda name,q:h.rpc(pg,name,q),
        fingerprint=h.ae.frozen_node_target_fingerprint,instant_micros=h.ae._fnp_instant_micros,
        normalize_state=h.ae._fnp_normalize_state,format_instant=h.ae._fnp_format_instant_utc,
        default_within_pct=h.ae.FNP_DEFAULT_WITHIN_PCT,source_origin='https://synthetic.invalid')
    assert fresh.read(alert,pg.clock()) is None
    assert h.b.call(pg,'arm_frozen_node_runtime',[r.alert_id,r.principal,r.predicate,r.generation,r.revision])['kind']=='unavailable'
    assert not fresh.commit(r,{**s,'inside':False})
    assert h.effects(pg)==(1,0) and h.b.get_runtime(pg,r.alert_id)==h.ae.runtime_record(r)


def test_explicit_fence_invalidates_only_exact_generation_and_retains_tombstone(pg):
    _,a,r,s,x,p=subject(pg)
    assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
    assert pg('select status from public.alert_outbox')=='abandoned'
    assert h.b.get_runtime(pg,r.alert_id) is None and h.b.get_active(pg,r.alert_id)
    for mode in ('prepare','commit','fence'):
        assert call(a,r,s,x,p,mode)['kind']=='conflict'
    # Different claimed event/quote can never resurrect the closed old generation.
    other=copy.deepcopy(x);other['fireEventId']='e'*64
    body=copy.deepcopy(p);body['frozen_node']['publication_receipt']=other
    refused=call(a,r,s,other,body,'prepare')
    assert refused['kind']=='unavailable' and refused['reason']=='durable_publication_run_unavailable'
    fresh=h.b.call(pg,'arm_frozen_node_runtime',[r.alert_id,r.principal,r.predicate,None,None])
    assert fresh['kind']=='data' and fresh['runtime']['generation']!=r.generation
    assert call(a,r,s,x,p,'fence')['kind']=='conflict'
    assert h.b.get_runtime(pg,r.alert_id)==fresh['runtime']
    assert h.effects(pg)==(1,0)


@pytest.mark.parametrize('mutation',['pause','edit','delete_reinsert'])
def test_prepared_survives_owner_mutations_and_fence_does_not_clobber_new_row(pg,mutation):
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    if mutation=='delete_reinsert':
        pg(f'delete from public.alerts where id={h.b.q(r.alert_id)}',role='authenticated',claims={'sub':r.principal})
        h.b.insert_alert(pg,condition=r.predicate,symbol='SPY')
    else:
        change='active=false' if mutation=='pause' else "condition=condition || '{\"within_pct\":0.3}'::jsonb"
        pg(f'update public.alerts set {change} where id={h.b.q(r.alert_id)}',role='authenticated',claims={'sub':r.principal})
    before=pg(f'select row_to_json(a) from public.alerts a where id={h.b.q(r.alert_id)}')
    assert call(a,r,s,x,p,'commit')['kind']=='unavailable'
    assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
    assert pg(f'select row_to_json(a) from public.alerts a where id={h.b.q(r.alert_id)}')==before
    assert call(a,r,s,x,p,'prepare')['kind']=='conflict'
    assert h.effects(pg)==(1,0)


def test_commit_fence_race_exactly_one_wins(pg):
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda mode:call(a,r,s,x,p,mode),['commit','fence']))
    if results[0]['kind']=='committed':
        assert results[1]['kind']=='already_committed'
        assert h.effects(pg)==(1,1) and not h.b.get_active(pg,r.alert_id)
    else:
        assert results[0]['kind']=='conflict' and results[1]['kind']=='abandoned'
        assert h.effects(pg)==(1,0) and h.b.get_active(pg,r.alert_id)


def test_two_prepares_one_unresolved_slot(pg):
    _,a,r,s,x,p=subject(pg)
    other=copy.deepcopy(x);other['fireEventId']='d'*64
    body=copy.deepcopy(p);body['frozen_node']['publication_receipt']=other
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(call,a,r,s,x,p,'prepare'),pool.submit(call,a,r,s,other,body,'prepare')]
        results=[f.result() for f in futures]
    assert sum(z['kind']=='prepared' for z in results)==1
    assert h.effects(pg)==(1,0) and h.b.get_runtime(pg,r.alert_id)==h.ae.runtime_record(r)


@pytest.mark.parametrize('failure',['projection','disarm'])
def test_publication_failure_restores_prepared_and_runtime(pg,failure):
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    table='webhook_deliveries' if failure=='projection' else 'alerts'
    op='insert' if failure=='projection' else 'update'
    pg(f"create function synthetic_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic'; end$$; create trigger synthetic_fail before {op} on public.{table} for each row execute function synthetic_fail()")
    try:
        assert call(a,r,s,x,p,'commit')['kind']=='unavailable'
        assert pg('select status from public.alert_outbox')=='prepared'
        assert h.effects(pg)==(1,0) and h.b.get_active(pg,r.alert_id)
        assert h.b.get_runtime(pg,r.alert_id)==h.ae.runtime_record(r)
    finally:
        pg(f'drop trigger synthetic_fail on public.{table}; drop function synthetic_fail()')


def test_claim_role_forgery_and_missing_intent_no_effect(pg):
    _,a,r,s,x,p=subject(pg)
    params=[r.alert_id,r.principal,r.predicate,r.generation,r.revision,s,{'mode':'prepare','receipt':x,'payload':p}]
    denied=pg('select public.commit_frozen_node_state('+','.join(h.b.q(z) for z in params)+')',role='authenticated',claims={'sub':r.principal,'role':'service_role'},check=False)
    assert denied.returncode!=0 and 'permission denied' in denied.stderr
    assert h.effects(pg)==(0,0)


def test_installer_is_one_atomic_unit_and_failure_restores_all(pg):
    from scripts.supabase_apply import split_statements,strip_sql_comments
    sql=(Path(__file__).parent/'sql/options_frozen_node/proposed_prepared_intent.sql').read_text()
    units=[strip_sql_comments(x).strip() for x in split_statements(sql) if strip_sql_comments(x).strip()]
    assert len(units)==1
    before=pg("select pg_get_functiondef('public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb)'::regprocedure)")
    broken=sql.replace("'prepared_intent_fenced'","'synthetic_changed_body'").replace('end;\n$prepared_install$;',"raise exception 'synthetic final failure';\nend;\n$prepared_install$;")
    result=pg(strip_sql_comments(split_statements(broken)[0]).strip(),check=False)
    assert result.returncode!=0 and 'synthetic final failure' in result.stderr
    assert pg("select pg_get_functiondef('public.commit_frozen_node_state(uuid,uuid,jsonb,uuid,bigint,jsonb,jsonb)'::regprocedure)")==before


def test_lane_unique_marker_closes_concurrent_get_clear_post_race(pg):
    # Both prospective processes observe clear; only the DB INSERT winner may prepare.
    assert pg("select count(*) from public.alert_runs where error_class in ('frozen_publication_pending','frozen_fire_effect_unknown')")=='0'
    def insert(run_id):
        return pg(f"insert into public.alert_runs(lane,run_id,started_at,error_class) values('alerts_engine',{h.b.q(run_id)},clock_timestamp(),'frozen_publication_pending')",role='service_role',check=False)
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows=list(pool.map(insert,['one','two']))
    assert sorted(z.returncode==0 for z in rows)==[False,True]
    assert any('duplicate key' in z.stderr for z in rows if z.returncode)
    pg("update public.alert_runs set error_class='frozen_fire_effect_unknown'")
    assert insert('fresh-reset').returncode!=0
    assert h.effects(pg)==(0,0)


def test_absent_read_cannot_reset_unknown_prepare_and_late_original_can_arrive(pg):
    _,a,r,s,x,p=subject(pg)
    pg("update public.alert_runs set error_class='frozen_fire_effect_unknown'")
    assert call(a,r,s,x,p,'reconcile')['kind']=='unavailable'
    assert call(a,r,s,x,p,'fence')['kind']=='unavailable'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_fire_effect_unknown'
    # The original request can arrive AFTER those absent reads. No replacement was sent.
    assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    assert h.effects(pg)==(1,0)
    assert call(a,r,s,x,p,'reconcile')['kind']=='unsettled'
    assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_fenced'
    assert call(a,r,s,x,p,'prepare')['kind']=='conflict'


def test_fence_leaves_different_generation_untouched(pg):
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    # Test-only privileged server-generation replacement: discriminate full equality
    # from an unsafe alert-id-only invalidation in the fencing operation.
    fresh=h.ae.runtime_record(r);fresh.update(generation='99999999-0000-4000-8000-000000000001',revision=0,priorState=None)
    pg(f"update public.alerts set frozen_runtime={h.b.q(h.b.Raw(__import__('json').dumps(fresh)))} where id={h.b.q(r.alert_id)}")
    assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
    assert h.b.get_runtime(pg,r.alert_id)==fresh
    assert call(a,r,s,x,p,'commit')['kind']=='conflict'
    assert h.effects(pg)==(1,0)


def test_fence_and_delayed_different_event_prepare_exclude_each_other(pg):
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    other=copy.deepcopy(x);other['fireEventId']='c'*64
    body=copy.deepcopy(p);body['frozen_node']['publication_receipt']=other
    with ThreadPoolExecutor(max_workers=2) as pool:
        fence=pool.submit(call,a,r,s,x,p,'fence')
        delayed=pool.submit(call,a,r,s,other,body,'prepare')
        assert fence.result()['kind']=='abandoned'
        assert delayed.result()['kind']=='unavailable'
    assert h.effects(pg)==(1,0) and pg('select status from public.alert_outbox')=='abandoned'


def test_publisher_unknown_prepare_never_sends_commit_or_retries(pg):
    _,a,r,s,x,p=subject(pg);original=a.rpc;calls=[]
    def lost(name,params):
        calls.append(params['p_hit']['mode'])
        original(name,params)
        raise OSError('synthetic prepare response lost')
    a.rpc=lost
    result=h.FrozenNodeHitPublisher(a).publish(r,s,x,p)
    assert result['kind']=='effect_unknown' and result['phase']=='prepare'
    assert calls==['prepare'] and h.effects(pg)==(1,0)
    a.rpc=original
    assert h.FrozenNodeHitPublisher(a).reconcile(r,s,x,p)['kind']=='unsettled'
    # Even an explicit mistaken publish cannot turn a repeated prepare ACK into commit permission.
    assert h.FrozenNodeHitPublisher(a).publish(r,s,x,p)['kind']=='unsettled'
    assert h.effects(pg)==(1,0)


def test_publisher_fresh_ack_then_one_commit_and_unknown_commit_readonly(pg):
    _,a,r,s,x,p=subject(pg);original=a.rpc;calls=[]
    def lost(name,params):
        mode=params['p_hit']['mode'];calls.append(mode)
        value=original(name,params)
        if mode=='commit':raise OSError('synthetic committed response lost')
        return value
    a.rpc=lost
    result=h.FrozenNodeHitPublisher(a).publish(r,s,x,p)
    assert result['kind']=='effect_unknown' and result['phase']=='commit'
    assert calls==['prepare','commit'] and h.effects(pg)==(1,1)
    a.rpc=original
    assert h.FrozenNodeHitPublisher(a).reconcile(r,s,x,p)['kind']=='already_committed'
    # Read-only acknowledgement does not erase the separate run barrier.
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_pending'


def test_legacy_insert_and_status_updates_do_not_duplicate_projection(pg):
    pg(f"insert into public.alert_outbox(user_id,fire_event_id,payload) values({h.b.q(h.b.A)},'legacy','{{}}')")
    assert h.effects(pg)==(1,1)
    pg("update public.alert_outbox set status='sent' where fire_event_id='legacy'")
    assert h.effects(pg)==(1,1)


def test_two_explicit_fences_in_one_run_release_marker_only_after_both(pg):
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    other_id=h.b.ALERT_IDS[1]
    h.b.insert_alert(pg,alert=other_id,condition=r.predicate,symbol='QQQ')
    h.b.call(pg,'arm_frozen_node_runtime',[other_id,r.principal,r.predicate,None,None])
    alert={'id':other_id,'user_id':r.principal,'condition':r.predicate,'active':True}
    at=pg.clock();second=a.read(alert,at)
    outside={'targetFingerprint':second.target_fingerprint,'armingEpoch':second.arming_epoch,
             'lastQuoteAt':at,'inside':False,'withinPct':second.within_pct,'lastQuoteBasis':'LIVE'}
    assert a.commit(second,outside)
    at=pg.clock();second=a.read(alert,at);state={**outside,'inside':True,'lastQuoteAt':at}
    admission=copy.deepcopy(x['admission']);admission.update(evaluationAt=at,createdAt=second.created_at,
        armingEpoch=second.arming_epoch,priorState=second.prior_state)
    admission['rights']['checked_at']=at
    quote={'spot':159.1,'asof':at,'basis':'LIVE'}
    receipt,payload=h.ae._frozen_hit_envelope(second,state,admission,quote,invocation=x['invocation'])
    assert call(a,second,state,receipt,payload,'prepare')['kind']=='prepared'
    with ThreadPoolExecutor(max_workers=2) as pool:
        first=pool.submit(call,a,r,s,x,p,'fence')
        other=pool.submit(call,a,second,state,receipt,payload,'fence')
        assert first.result()['kind']=='abandoned' and other.result()['kind']=='abandoned'
    assert pg("select count(*) from public.alert_outbox where status='abandoned'")=='2'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_fenced'


from test_alerts_frozen_service import workers  # noqa: E402,F401


@pytest.mark.parametrize('fault',['none','prepare','commit','before_prepare','conclude'])
def test_complete_run_once_native_intent_run_barrier_and_restart(pg,workers,tmp_path,monkeypatch,fault):
    alert,_,_,_,_,_=h.candidate(pg,symbol='SPY')
    fake=h.core._FakeRest([alert]);h.core._patch_http(monkeypatch,fake)
    fallback=h.ae.http_json_status;rpc_calls=[];delayed=[]
    def status(url,headers=None,method='GET',body=None,timeout=15):
        if '/alert_runs' in url:
            if fault=='conclude' and method=='PATCH':return 0,None,'synthetic conclude response lost before DB'
            return h.native_run_receipt(pg,url,method,body)
        if '/rpc/' in url:
            name=url.rsplit('/',1)[1]
            if body.get('p_hit'):
                mode=body['p_hit']['mode'];rpc_calls.append(mode)
                if fault=='before_prepare' and mode=='prepare':
                    delayed.append(copy.deepcopy(body));return 0,None,'synthetic request delayed before DB'
            result=h.rpc(pg,name,body)
            if body.get('p_hit',{}).get('mode')==fault or (fault=='conclude' and body.get('p_hit',{}).get('mode')=='commit'):
                return 0,None,'synthetic response lost AFTER DB'
            return 200,result,__import__('json').dumps(result)
        return fallback(url,headers,method,body,timeout)
    monkeypatch.setattr(h.ae,'http_json_status',status)
    h.core._manifest(tmp_path);at=pg.clock();now=h.ae.datetime.fromisoformat(at.replace('Z','+00:00'))
    data=h.ae.Data(str(tmp_path),None,now_fn=lambda:now)
    monkeypatch.setattr(data,'live_quote',lambda root:{'spot':159.1,'asof':at,'basis':'DELAYED_15M'})
    monkeypatch.setattr(data,'evaluation_vintage',lambda *a:(_ for _ in ()).throw(AssertionError('second vintage')))
    supa=h.ae.Supa('https://synthetic.invalid','synthetic-service-key');adapter=supa.frozen_lifecycle_adapter()
    reader=h.service_reader(workers,monkeypatch)
    result=h.ae.run_once(supa,data,now,'prepared-original',frozen_node_reader=reader,
        frozen_lifecycle_adapter=adapter,frozen_node_publisher=h.FrozenNodeHitPublisher(adapter))
    if fault=='none':
        assert result['fired_n']==1 and rpc_calls==['prepare','commit'] and h.effects(pg)==(1,1)
        assert pg("select error_class is null from public.alert_runs where lane='alerts_engine'")=='t'
        return
    assert result['fired_n']==0 and result['error_class']=='frozen_fire_effect_unknown'
    expected=['prepare'] if fault in ('prepare','before_prepare') else ['prepare','commit']
    assert rpc_calls==expected
    assert pg("select error_class from public.alert_runs where lane='alerts_engine'")==('frozen_publication_pending' if fault=='conclude' else 'frozen_fire_effect_unknown')
    expected_effects=(0,0) if fault=='before_prepare' else (1,0) if fault=='prepare' else (1,1)
    assert h.effects(pg)==expected_effects
    # A fresh caller/process must withhold before source/intent calls, even if
    # its active-alert read is stale and a new minute/run ID would otherwise fire.
    next_supa=h.ae.Supa('https://synthetic.invalid','synthetic-service-key');next_adapter=next_supa.frozen_lifecycle_adapter()
    def forbidden(*a,**k):raise AssertionError('restart attempted source evaluation')
    again=h.ae.run_once(next_supa,data,now,'prepared-restart',frozen_node_reader=forbidden,
        frozen_lifecycle_adapter=next_adapter,frozen_node_publisher=h.FrozenNodeHitPublisher(next_adapter))
    assert again['fired_n']==0 and again['unevaluable_n']==1 and rpc_calls==expected
    assert h.effects(pg)==expected_effects
    if delayed:
        # Absent read did not mean the original prepare could not still commit.
        assert pg('select count(*) from public.alert_outbox')=='0'
        assert h.rpc(pg,'commit_frozen_node_state',delayed[0])['kind']=='prepared'
        assert h.effects(pg)==(1,0)


def test_actual_macro_drain_selector_never_enqueues_prepared_or_abandoned(pg,tmp_path):
    import os,subprocess,sys,json
    macro=os.environ.get('OPTIONS_FROZEN_MACRO_SOURCE')
    if not macro:pytest.skip('explicit Macro source fixture required for actual drain interface')
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    script=tmp_path/'drain_selector.py'
    script.write_text('''import sys,json,re
from engine import alert_delivery_drain as d
row=json.load(sys.stdin);calls=[]
def read(path):
 assert path.startswith('alert_outbox?'),path
 statuses=re.findall(r'status\\.eq\\.([a-z_]+)',path)
 assert set(statuses)=={'pending','failed','deferred'},statuses
 calls.append(path)
 rows=[row] if row['status'] in statuses else []
 return d.TypedRead(d.READ_OK if rows else d.READ_OK_ZERO,rows)
d.typed_get=read
d.open_receipt=lambda *a:(None,None,False)
def no_send(**kwargs):raise AssertionError('transport called')
result=d.drain(send_fn=no_send)
assert result.evaluated_n==0 and result.fired_n==0
assert len(calls)==1
''')
    for expected in ('prepared','abandoned'):
        if expected=='abandoned':assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
        row=json.loads(pg('select row_to_json(o) from public.alert_outbox o'))
        assert row['status']==expected
        result=subprocess.run([sys.executable,str(script)],input=json.dumps(row),text=True,capture_output=True,
            cwd=macro,env={**os.environ,'PYTHONPATH':str(macro)},timeout=20)
        assert result.returncode==0,result.stdout+result.stderr


def test_late_conclude_retains_fenced_marker_and_terminal_counters(pg):
    _,a,r,s,x,p=subject(pg);assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
    pg("update public.alert_runs set error_class='frozen_fire_effect_unknown',outcome='partial',evaluated_n=7,fired_n=2,unevaluable_n=1,concluded_at=clock_timestamp() where lane='prepared_test'",role='service_role')
    assert pg("select error_class||':'||evaluated_n||':'||fired_n||':'||unevaluable_n from public.alert_runs where lane='prepared_test'")=='frozen_publication_fenced:7:2:1'


def test_ordinary_conclude_cannot_clear_unknown_prepare_marker(pg):
    _,a,r,s,x,p=subject(pg)
    pg("update public.alert_runs set error_class='frozen_fire_effect_unknown' where lane='prepared_test'")
    pg("update public.alert_runs set error_class=null,outcome='partial',concluded_at=clock_timestamp() where lane='prepared_test'",role='service_role')
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_fire_effect_unknown'
    assert call(a,r,s,x,p,'fence')['kind']=='unavailable'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_fire_effect_unknown'


def test_explicit_settle_proven_commit_preserves_event_and_counters(pg):
    _,a,r,s,x,p=subject(pg)
    publisher=h.FrozenNodeHitPublisher(a)
    assert publisher.publish(r,s,x,p)['kind']=='committed'
    pg("update public.alert_runs set error_class='frozen_fire_effect_unknown',evaluated_n=7,fired_n=1,unevaluable_n=2 where lane='prepared_test'")
    before=pg('select row_to_json(o) from public.alert_outbox o')
    assert publisher.reconcile(r,s,x,p)['kind']=='already_committed'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_fire_effect_unknown'
    assert publisher.settle(r,s,x,p)=={'kind':'settled','fireEventId':x['fireEventId']}
    assert pg("select error_class||':'||evaluated_n||':'||fired_n||':'||unevaluable_n from public.alert_runs where lane='prepared_test'")=='frozen_publication_settled:7:1:2'
    assert pg('select row_to_json(o) from public.alert_outbox o')==before
    assert h.effects(pg)==(1,1)
    # A late terminal callback cannot resurrect the old barrier or its authority.
    pg("update public.alert_runs set error_class='frozen_fire_effect_unknown',evaluated_n=8 where lane='prepared_test'")
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_settled'
    assert publisher.settle(r,s,x,p)['kind']=='settled'
    assert call(a,r,s,x,p,'commit')['kind']=='already_committed'
    pg("insert into public.alert_runs(lane,run_id,started_at,error_class) values('prepared_test','new-run',clock_timestamp(),'frozen_publication_pending')")
    assert h.effects(pg)==(1,1)


def test_settle_refuses_absent_prepared_or_mismatched_evidence(pg):
    _,a,r,s,x,p=subject(pg)
    assert call(a,r,s,x,p,'settle')['kind']=='unavailable'
    assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    assert call(a,r,s,x,p,'settle')['kind']=='unavailable'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_pending'
    assert call(a,r,s,x,p,'commit')['kind']=='committed'
    changed=copy.deepcopy(p);changed['subject']+=' altered'
    assert call(a,r,s,x,changed,'settle')['kind']=='conflict'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_pending'
    # This mode is administrative service authority, never owner/JWT authority.
    params=[r.alert_id,r.principal,r.predicate,r.generation,r.revision,s,{'mode':'settle','receipt':x,'payload':p}]
    denied=pg('select public.commit_frozen_node_state('+','.join(h.b.q(z) for z in params)+')',role='authenticated',claims={'sub':r.principal,'role':'service_role'},check=False)
    assert denied.returncode!=0 and 'permission denied' in denied.stderr
    assert h.effects(pg)==(1,1)


def test_settle_cannot_relabel_abandoned_or_missing_run(pg):
    _,a,r,s,x,p=subject(pg)
    assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
    assert call(a,r,s,x,p,'settle')['kind']=='conflict'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_fenced'
    # Published evidence without its actual invocation marker cannot create one.
    pg("update public.alert_outbox set status='sent'")
    pg("delete from public.alert_runs where lane='prepared_test'")
    assert call(a,r,s,x,p,'settle')['kind']=='unavailable'
    assert pg("select count(*) from public.alert_runs where lane='prepared_test'")=='0'


def test_settle_refuses_any_remaining_prepared_intent(pg):
    _,a,r,s,x,p=subject(pg)
    assert h.FrozenNodeHitPublisher(a).publish(r,s,x,p)['kind']=='committed'
    # Even an inconsistent retained intent sharing the invocation must hold it.
    pg(f"insert into public.alert_outbox(user_id,alert_id,fire_event_id,channel,status,payload) values({h.b.q(r.principal)},{h.b.q(h.b.ALERT_IDS[1])},'other-prepared','email','prepared',{h.b.q(p)})")
    assert call(a,r,s,x,p,'settle')['kind']=='unavailable'
    assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_pending'
    assert h.effects(pg)==(2,1)


def test_competing_settlement_and_delayed_original_prepare_are_exclusive(pg):
    _,a,r,s,x,p=subject(pg)
    assert h.FrozenNodeHitPublisher(a).publish(r,s,x,p)['kind']=='committed'
    # A separately valid second alert in the same original invocation must
    # either prepare before closure (holding settlement), or lose to closure.
    other_id=h.b.ALERT_IDS[1]
    h.b.insert_alert(pg,alert=other_id,condition=r.predicate,symbol='QQQ')
    h.b.call(pg,'arm_frozen_node_runtime',[other_id,r.principal,r.predicate,None,None])
    alert={'id':other_id,'user_id':r.principal,'condition':r.predicate,'active':True}
    at=pg.clock();second=a.read(alert,at)
    outside={'targetFingerprint':second.target_fingerprint,'armingEpoch':second.arming_epoch,
             'lastQuoteAt':at,'inside':False,'withinPct':second.within_pct,'lastQuoteBasis':'LIVE'}
    assert a.commit(second,outside)
    at=pg.clock();second=a.read(alert,at);state={**outside,'inside':True,'lastQuoteAt':at}
    admission=copy.deepcopy(x['admission']);admission.update(evaluationAt=at,createdAt=second.created_at,
        armingEpoch=second.arming_epoch,priorState=second.prior_state)
    admission['rights']['checked_at']=at
    late,late_payload=h.ae._frozen_hit_envelope(second,state,admission,
        {'spot':159.1,'asof':at,'basis':'LIVE'},invocation=x['invocation'])
    with ThreadPoolExecutor(max_workers=3) as pool:
        tasks=[pool.submit(call,a,r,s,x,p,'settle'),pool.submit(call,a,r,s,x,p,'settle'),
               pool.submit(call,a,second,state,late,late_payload,'prepare')]
        settlements=[f.result()['kind'] for f in tasks[:2]]
        prepared=tasks[2].result()['kind']
    if prepared=='prepared':
        assert settlements==['unavailable','unavailable']
        assert h.effects(pg)==(2,1)
        assert call(a,second,state,late,late_payload,'fence')['kind']=='abandoned'
        # Fence closes the invocation; settlement must not relabel that decision.
        assert call(a,r,s,x,p,'settle')['kind']=='unavailable'
    else:
        assert prepared=='unavailable' and settlements==['settled','settled']
        assert call(a,second,state,late,late_payload,'prepare')['kind']=='unavailable'
        assert pg("select error_class from public.alert_runs where lane='prepared_test'")=='frozen_publication_settled'
        assert h.effects(pg)==(1,1)


def canonical_event(pg):
    return json.loads(pg('select row_to_json(o) from public.alert_outbox o'))


@pytest.mark.parametrize('status', ['pending', 'deferred', 'sent', 'failed', 'suppressed'])
def test_delivery_evidence_uses_committed_event_after_disarm_not_live_armed_state(pg, status):
    _,a,r,s,x,p=subject(pg)
    assert h.FrozenNodeHitPublisher(a).publish(r,s,x,p)['kind']=='committed'
    assert not h.b.get_active(pg,r.alert_id)
    pg(f'update public.alert_outbox set status={h.b.q(status)}')
    row=canonical_event(pg)
    before=pg('select row_to_json(o) from public.alert_outbox o')
    marker=pg("select row_to_json(a) from public.alert_runs a where lane='prepared_test'")
    proof=FrozenNodeCommittedEventReader(a,outbox_origin=a.source_origin).read(row)
    assert proof is not None and proof.fire_event_id==x['fireEventId']
    assert proof.principal==r.principal and proof.payload==p
    assert proof.source_origin==a.source_origin
    # Suppressed email still proves firing, never delivery permission. The
    # channel's current consent/suppression decision remains independently owed.
    assert pg('select row_to_json(o) from public.alert_outbox o')==before
    assert pg("select row_to_json(a) from public.alert_runs a where lane='prepared_test'")==marker
    assert h.effects(pg)==(1,1)


def test_delivery_evidence_refuses_prepared_abandoned_and_forged_projection(pg):
    _,a,r,s,x,p=subject(pg)
    reader=FrozenNodeCommittedEventReader(a,outbox_origin=a.source_origin)
    assert call(a,r,s,x,p,'prepare')['kind']=='prepared'
    row=canonical_event(pg)
    assert reader.read(row) is None
    row['status']='pending'  # A claimed state cannot promote an actual intent.
    assert reader.read(row) is None
    assert call(a,r,s,x,p,'fence')['kind']=='abandoned'
    assert reader.read(row) is None
    assert h.effects(pg)==(1,0)


def test_delivery_evidence_refuses_mismatch_and_pins_before_transport(pg):
    _,a,r,s,x,p=subject(pg)
    assert h.FrozenNodeHitPublisher(a).publish(r,s,x,p)['kind']=='committed'
    row=canonical_event(pg)
    reader=FrozenNodeCommittedEventReader(a,outbox_origin=a.source_origin)
    wrong=copy.deepcopy(row);wrong['payload']['summary_plain']='forged'
    assert reader.read(wrong) is None
    wrong=copy.deepcopy(row);wrong['user_id']=h.b.B
    assert reader.read(wrong) is None
    wrong=copy.deepcopy(row);wrong['fire_event_id']='a'*64
    assert reader.read(wrong) is None
    assert FrozenNodeCommittedEventReader(a,outbox_origin='https://other.invalid').read(row) is None
    original=a.rpc
    def mutating(name,params):
        result=original(name,params)
        row['user_id']=h.b.B
        params['p_hit']['receipt']['evaluationAt']='2099-01-01T00:00:00Z'
        params['p_hit']['payload']['summary_plain']='changed after observation'
        return result
    a.rpc=mutating
    proof=reader.read(row)
    assert proof is not None and proof.principal==r.principal
    assert proof.evaluation_at==x['evaluationAt'] and proof.payload==p
    body=proof.payload;body['summary_plain']='external mutation'
    assert proof.payload==p
    assert h.effects(pg)==(1,1)
