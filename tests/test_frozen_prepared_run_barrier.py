"""Actual engine startup/ACK/exception fences; synthetic HTTP only, no live DB."""
import json
from pathlib import Path
import pytest
import test_alerts_frozen_node as f
from ingest import alerts_engine as ae
from ingest.options_frozen_hit import FrozenNodeHitPublisher


def setup(tmp_path,monkeypatch,*,prior=False,ack=201,crash=False,conclude=204):
    condition=json.loads((Path(__file__).parent/'fixtures/options_frozen_node_native_target.json').read_text())['condition']
    alert={'id':'30000000-0000-4000-8000-000000000001','user_id':'10000000-0000-4000-8000-000000000001',
           'symbol':'QQQ','active':True,'created_at':'2099-01-01T00:00:00Z','condition':condition}
    f._manifest(tmp_path);calls=[]
    def http(url,headers=None,method='GET',body=None,timeout=15):
        calls.append((method,url,body))
        if '/alert_runs?' in url and method=='GET':
            assert 'frozen_publication_pending' in url and 'frozen_fire_effect_unknown' in url
            return 200,[{'run_id':'previous-unknown'}] if prior else [],''
        if url.endswith('/alert_runs') and method=='POST':return ack,None,''
        if '/alert_runs?' in url and method=='PATCH':return conclude,None,''
        if '/alerts?' in url:
            if crash:raise OSError('synthetic active-alert crash')
            return 200,[alert],''
        raise AssertionError('unexpected HTTP '+url)
    monkeypatch.setattr(ae,'http_json_status',http)
    monkeypatch.setattr(ae,'http_json',lambda url,headers=None,method='GET',body=None,timeout=15:http(url,headers,method,body,timeout)[1])
    supa=ae.Supa('https://synthetic.invalid','synthetic-service-key');adapter=supa.frozen_lifecycle_adapter()
    data=ae.Data(str(tmp_path),None)
    monkeypatch.setattr(data,'prime_quotes',lambda *a:None)
    def forbidden(*a,**k):raise AssertionError('source or prepare must not be called')
    monkeypatch.setattr(adapter,'read',forbidden)
    return supa,adapter,data,calls,forbidden


@pytest.mark.parametrize('ack',[0,400,409,500])
def test_unacknowledged_run_marker_permits_zero_prepare(tmp_path,monkeypatch,ack):
    supa,adapter,data,calls,forbidden=setup(tmp_path,monkeypatch,ack=ack)
    result=ae.run_once(supa,data,ae.datetime.now(ae.timezone.utc),'new-run',
       frozen_lifecycle_adapter=adapter,frozen_node_reader=forbidden,
       frozen_node_publisher=FrozenNodeHitPublisher(adapter))
    assert result['fired_n']==0 and result['unevaluable_n']==1
    posts=[body for method,url,body in calls if method=='POST']
    assert len(posts)==1 and posts[0]['error_class']=='frozen_publication_pending'
    assert not any('/rpc/' in url for _,url,_ in calls)


def test_restart_prior_pending_or_unknown_blocks_without_new_marker(tmp_path,monkeypatch):
    supa,adapter,data,calls,forbidden=setup(tmp_path,monkeypatch,prior=True)
    result=ae.run_once(supa,data,ae.datetime.now(ae.timezone.utc),'fresh-minute-run',
       frozen_lifecycle_adapter=adapter,frozen_node_reader=forbidden,
       frozen_node_publisher=FrozenNodeHitPublisher(adapter))
    assert result['fired_n']==0 and result['unevaluable_n']==1
    assert all('error_class' not in body for method,url,body in calls if method=='POST')
    assert not any('/rpc/' in url for _,url,_ in calls)


def test_exception_and_failed_conclude_preserve_unknown_marker(tmp_path,monkeypatch):
    supa,adapter,data,calls,forbidden=setup(tmp_path,monkeypatch,crash=True,conclude=0)
    with pytest.raises(OSError,match='active-alert crash'):
        ae.run_once(supa,data,ae.datetime.now(ae.timezone.utc),'crashed-run',
            frozen_lifecycle_adapter=adapter,frozen_node_reader=forbidden,
            frozen_node_publisher=FrozenNodeHitPublisher(adapter))
    patch=[body for method,url,body in calls if method=='PATCH']
    assert len(patch)==1 and patch[0]['error_class']=='frozen_fire_effect_unknown'
    assert patch[0]['evaluated_n'] is None and patch[0]['fired_n'] is None
    assert not supa.conclude_run('alerts_engine','crashed-run','2026-10-24T11:00:00Z','partial',None,None,None,'frozen_fire_effect_unknown')


@pytest.mark.parametrize('response',[(0,None,''),(200,{},''),(404,None,''),(200,[{'run_id':'held'}],'')])
def test_unreadable_or_nonclear_barrier_never_grants(monkeypatch,response):
    monkeypatch.setattr(ae,'http_json_status',lambda *a,**k:response)
    assert not ae.Supa('https://synthetic.invalid','synthetic-service-key').frozen_publication_clear('alerts_engine')


def test_barrier_exception_and_known_clear(monkeypatch):
    monkeypatch.setattr(ae,'http_json_status',lambda *a,**k:(_ for _ in ()).throw(ValueError('bad JSON')))
    s=ae.Supa('https://synthetic.invalid','synthetic-service-key')
    assert not s.frozen_publication_clear('alerts_engine')
    monkeypatch.setattr(ae,'http_json_status',lambda *a,**k:(200,[],''))
    assert s.frozen_publication_clear('alerts_engine')


@pytest.mark.parametrize('mode',['prepare','commit','fence'])
@pytest.mark.parametrize('reply',[(200,None,''),(204,None,''),(500,None,''),(0,None,'')])
def test_mutating_rpc_malformed_or_unknown_reply_keeps_uncertainty(monkeypatch,mode,reply):
    monkeypatch.setattr(ae,'http_json_status',lambda *a,**k:reply)
    result=ae.Supa('https://synthetic.invalid','synthetic-service-key').frozen_runtime_rpc(
        'commit_frozen_node_state',{'p_hit':{'mode':mode}})
    assert result['kind']=='effect_unknown'


def test_sql_typed_refusal_is_not_transport_uncertainty(monkeypatch):
    reply={'kind':'unavailable','reason':'atomic_hit_write_unavailable'}
    monkeypatch.setattr(ae,'http_json_status',lambda *a,**k:(200,reply,''))
    assert ae.Supa('https://synthetic.invalid','synthetic-service-key').frozen_runtime_rpc(
        'commit_frozen_node_state',{'p_hit':{'mode':'commit'}})==reply
