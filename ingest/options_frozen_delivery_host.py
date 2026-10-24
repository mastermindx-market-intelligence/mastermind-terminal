"""Private host composition of committed-event proof and current delivery policy.

No import IO, sender, new endpoint or source read. Canonical rows are selected
again from the SAME privileged database; a proof never claims an outbox row.
"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from urllib.parse import quote
from uuid import UUID
from ingest.options_frozen_delivery import FrozenNodeCommittedEventReader
from ingest.options_frozen_lifecycle import _json_equal

EMAIL_FIELDS = ('id','user_id','alert_id','fire_event_id','channel','status','payload','attempts','deliver_after')
WEBHOOK_FIELDS = ('id','endpoint_id','team_id','event_id','event_type','payload','attempt','status','claimed_at','next_retry_at')
PUBLIC_ENDPOINT_FIELDS = ('id','team_id','url','enabled','event_filter','secret_version')


def snapshot(value):
    encoded = json.dumps(value, allow_nan=False, separators=(',', ':'))
    if len(encoded.encode()) > 256*1024:
        raise ValueError('oversized private delivery snapshot')
    return json.loads(encoded)


def uuid(value):
    return isinstance(value,str) and str(UUID(value)) == value


def fields(row, names):
    if not isinstance(row,dict) or any(k not in row for k in names):
        raise ValueError('incomplete canonical delivery row')
    return {k:row[k] for k in names}


class FrozenDeliveryAuthorizer:
    def __init__(self, *, read, event_reader, account_reader, source_origin, now_fn=None):
        if not isinstance(event_reader,FrozenNodeCommittedEventReader) or event_reader.outbox_origin != source_origin:
            raise ValueError('mismatched private delivery origin')
        self.read=read; self.events=event_reader; self.account=account_reader
        self.origin=source_origin; self.now=now_fn or (lambda:datetime.now(timezone.utc))

    def one(self, path):
        rows=self.read(path)
        if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict):
            raise ValueError('canonical delivery selection unavailable or ambiguous')
        return snapshot(rows[0])

    def check(self, request):
        """Return one immutable JSON snapshot for this invocation, or unavailable.

        Email keeps the incumbent suppression/quiet/ledger gates. Webhooks must
        still CAS-claim and sign the authoritative current endpoint themselves.
        """
        try:
            req=snapshot(request)
            if set(req)!={'mode','row','evaluationAt','sourceOrigin'} or req['sourceOrigin']!=self.origin:
                return None
            at=req['evaluationAt']; stamp=self.events.lifecycle.instant(at)
            now=self.events.lifecycle.instant(self.now().isoformat())
            if stamp is None or now is None or stamp>now or now-stamp>60_000_000:
                return None  # current policy check, never a historical account grant
            mode=req['mode']; selected=req['row']
            if not uuid(selected.get('id')) or mode not in ('email','webhook'):
                return None
            if mode=='email':
                row=self.one('alert_outbox?id=eq.'+quote(selected['id'],safe='')+'&channel=eq.email&select='+','.join(EMAIL_FIELDS)+'&limit=2')
                row=fields(row,EMAIL_FIELDS)
                if not _json_equal(row,fields(selected,EMAIL_FIELDS)):
                    return None
                event_row=row
            else:
                row=self.one('webhook_deliveries?id=eq.'+quote(selected['id'],safe='')+'&select='+','.join(WEBHOOK_FIELDS)+'&limit=2')
                row=fields(row,WEBHOOK_FIELDS)
                if not _json_equal(row,fields(selected,WEBHOOK_FIELDS)) or row['event_type']!='alert.fired':
                    return None
                if (not uuid(row['endpoint_id']) or not uuid(row['team_id'])
                        or type(row['attempt']) is not int or not 0<=row['attempt']<=5):
                    return None
                event_row=self.one('alert_outbox?fire_event_id=eq.'+quote(row['event_id'],safe='')+'&channel=eq.email&select='+','.join(EMAIL_FIELDS)+',value_text:payload->>value&limit=2')
            if mode=='webhook' and event_row.get('fire_event_id')!=row['event_id']:
                return None
            legacy = mode=='webhook' and event_row.get('payload',{}).get('category')!='options_exposure_node'
            if legacy:
                # A configured worker must not mistake a stripped node payload
                # for a legacy alert. Only canonical non-node data can select it.
                p=event_row['payload']
                if ('frozen_node' in p or 'frozen_node' in row['payload']
                        or row['payload'].get('category')=='options_exposure_node'
                        or event_row.get('status') not in ('pending','deferred','sent','failed','suppressed')
                        or not uuid(event_row.get('user_id')) or not uuid(event_row.get('alert_id'))):
                    return None
                event=None
            else:
                event=self.events.read(event_row)
            if not legacy and (event is None or event.source_origin!=self.origin):
                return None
            if not legacy and not _json_equal(self.account.read_delivery_account(event,at,source_origin=self.origin),
                    {'kind':'delivery_account','principal':event.principal,'evaluationAt':at}):
                return None
            if mode=='email':
                if (row['status'] not in ('pending','failed','deferred')
                        or type(row['attempts']) is not int or not 0<=row['attempts']<3):
                    return None
                return snapshot(dict(kind='admitted_delivery',mode=mode,sourceOrigin=self.origin,evaluationAt=at,row=row))
            principal=event_row['user_id']
            ep=self.one('webhook_endpoints?id=eq.'+quote(row['endpoint_id'],safe='')+'&select='+','.join(PUBLIC_ENDPOINT_FIELDS)+'&limit=2')
            ep=fields(ep,PUBLIC_ENDPOINT_FIELDS)
            if (ep['id']!=row['endpoint_id'] or ep['team_id']!=row['team_id'] or ep['enabled'] is not True
                    or not isinstance(ep['event_filter'],list) or 'alert.fired' not in ep['event_filter']):
                return None
            member=self.one('team_members?team_id=eq.'+quote(row['team_id'],safe='')+'&user_id=eq.'+quote(principal,safe='')+'&select=team_id,user_id&limit=2')
            consent=self.one('webhook_alert_optins?team_id=eq.'+quote(row['team_id'],safe='')+'&user_id=eq.'+quote(principal,safe='')+'&select=team_id,user_id,enabled&limit=2')
            if (not _json_equal(member,{'team_id':row['team_id'],'user_id':principal})
                    or not _json_equal(consent,{'team_id':row['team_id'],'user_id':principal,'enabled':True})):
                return None
            p=event_row['payload'] if legacy else event.payload
            # Match the installed 0026 + frozen prepared-intent projection. SQL's
            # ->> numeric text is selected from the canonical event, not rebuilt
            # with a potentially different floating-point/exponent formatter.
            expected={'schema':'mastermind.alert-fired/v1','fire_event_id':event_row['fire_event_id'],
                'alert_id':event_row['alert_id'],'user_id':principal,'team_id':row['team_id']}
            for key in ('fired_at','ticker','subject','subject_zh','summary_plain','summary_plain_zh',
                        'condition_plain','condition_plain_zh','evidence_url'):
                expected[key]=p.get(key) or ''
            # Native SQL coalesces ->> NULL (missing or JSON null value) to ''.
            # The selected alias must still be present; never forgive a malformed
            # response or reconstruct numeric text with a different formatter.
            if 'value_text' not in event_row or (event_row['value_text'] is not None
                    and not isinstance(event_row['value_text'],str)):
                return None
            expected['value']=event_row['value_text'] if event_row['value_text'] is not None else ''
            if not legacy:expected.update({k:p[k] for k in ('category','requires_tier','frozen_node')})
            if not _json_equal(row['payload'],expected):
                return None
            return snapshot(dict(kind='legacy_delivery' if legacy else 'admitted_delivery',mode=mode,sourceOrigin=self.origin,evaluationAt=at,row=row,endpoint=ep))
        except Exception:
            return None
