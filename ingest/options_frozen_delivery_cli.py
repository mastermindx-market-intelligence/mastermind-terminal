"""One bounded private host invocation, default off; no channel send or source fetch."""
from pathlib import Path
import sys, os, json, signal
_ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(_ROOT))


def main():
    result={'kind':'unavailable','reason':'private_delivery_unavailable'}
    def expired(*_): raise TimeoutError('private delivery deadline')
    signal.signal(signal.SIGALRM,expired);signal.alarm(15)
    try:
        if len(sys.argv)!=1 or os.environ.get('OPTIONS_FROZEN_DELIVERY_ENABLED')!='1':
            raise ValueError('delivery disabled')
        p=Path(os.environ['OPTIONS_FROZEN_DELIVERY_ENV_FILE'])
        if not p.is_absolute() or not p.is_file() or p.stat().st_size>65536:
            raise ValueError('unqualified private environment')
        raw=sys.stdin.buffer.read(262145)
        if len(raw)>262144: raise ValueError('oversized private request')
        request=json.loads(raw.decode('utf-8','strict'),parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
        from ingest import alerts_engine as ae
        from ingest.options_frozen_assembly import assemble_frozen_node_services
        from ingest.options_frozen_delivery import FrozenNodeCommittedEventReader
        from ingest.options_frozen_delivery_host import FrozenDeliveryAuthorizer
        config=ae.load_env(str(p));url=config['SUPABASE_URL'];key=config['SUPABASE_SERVICE_ROLE_KEY']
        supa=ae.Supa(url,key)
        # Construct this read-only account/lifecycle capability from the same
        # installed host paths. This does not activate the scheduled evaluator.
        service,lifecycle=assemble_frozen_node_services(supa,{**config,'OPTIONS_FROZEN_READER_ENABLED':'1'},
            load_env=ae.load_env,fingerprint=ae.frozen_node_target_fingerprint,instant_micros=ae._fnp_instant_micros)
        def read(path):
            code,body,_=ae.http_json_status(supa.base+'/'+path,supa.h)
            return body if 200<=code<300 else None
        reader=FrozenNodeCommittedEventReader(lifecycle,outbox_origin=lifecycle.source_origin)
        authorizer=FrozenDeliveryAuthorizer(read=read,event_reader=reader,account_reader=service,source_origin=lifecycle.source_origin)
        result=authorizer.check(request) or result
    except Exception:
        pass
    finally:
        signal.alarm(0)
    encoded=json.dumps(result,allow_nan=False,separators=(',',':'))
    if len(encoded.encode())>262144: encoded='{"kind":"unavailable"}'
    sys.stdout.write(encoded+'\n')
    return 0 if result.get('kind') in ('admitted_delivery','legacy_delivery') else 2


if __name__=='__main__':raise SystemExit(main())
