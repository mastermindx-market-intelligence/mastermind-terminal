from concurrent.futures import ThreadPoolExecutor
from threading import Event
from pathlib import Path
import json
from test_alerts_frozen_hit_postgres import hit_pg, pg, candidate, effects, FrozenNodeHitPublisher, b


def test_old_count_oracle_rejects_real_retained_prepared_intent(pg):
    alert,adapter,runtime,state,receipt,payload=candidate(pg)
    real_rpc=adapter.rpc
    prepared_ack,release=Event(),Event()
    modes=[]
    def gated_rpc(name,params):
        reply=real_rpc(name,params)
        mode=(params.get('p_hit') or {}).get('mode')
        modes.append(mode)
        if mode=='prepare' and reply.get('kind')=='prepared':
            prepared_ack.set()
            assert release.wait(timeout=30),'prepare/commit gate timed out'
        return reply
    adapter.rpc=gated_rpc
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(FrozenNodeHitPublisher(adapter).publish,runtime,state,receipt,payload)
        try:
            assert prepared_ack.wait(timeout=30),'no real prepare ACK'
            pg(f'update public.alerts set active=false where id={b.q(runtime.alert_id)}',role='authenticated',claims={'sub':runtime.principal})
        finally:
            release.set()
        result=future.result(timeout=30)
    rows=json.loads(pg("select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from (select user_id,alert_id,fire_event_id,channel,status,payload from public.alert_outbox order by id) o"))
    expected={'user_id':runtime.principal,'alert_id':runtime.alert_id,'fire_event_id':receipt['fireEventId'],'channel':'email','status':'prepared','payload':payload}
    actual={'result':result,'effects':effects(pg),'modes':modes,'outbox':rows,'inactive':not b.get_active(pg,runtime.alert_id),'runtime':b.get_runtime(pg,runtime.alert_id),'listenAddresses':pg('show listen_addresses'),'postgresVersion':pg.version_num()}
    Path(__file__).with_name('baseline-observation.json').write_text(json.dumps(actual,indent=2)+'\n')
    assert modes==['prepare','commit']
    assert result=={'kind':'unavailable','reason':'inactive'}
    assert rows==[expected]
    assert actual['inactive'] and actual['runtime'] is None
    assert actual['listenAddresses']==''
    # The exact old race oracle is intentionally exercised after proving the row.
    assert effects(pg)==(0,0)
