"""Read-only committed-event evidence for the existing delivery workers.

This is NOT delivery permission. Callers must separately check the current
canonical account, category and channel consent. An alert has already disarmed
when it fires, so its current armed state cannot authenticate delayed delivery.
The incumbent service-role reconciliation RPC validates the retained exact
event instead. No new RPC, source fetch, publication or automatic recovery.
"""
from dataclasses import dataclass
import json
import re
from uuid import UUID

from ingest.options_frozen_lifecycle import FrozenNodeLifecycleAdapter


@dataclass(frozen=True)
class CommittedFrozenEvent:
    outbox_id: str
    fire_event_id: str
    principal: str
    alert_id: str
    evaluation_at: str
    payload_json: str
    source_origin: str

    @property
    def payload(self):
        return json.loads(self.payload_json)


class FrozenNodeCommittedEventReader:
    """Explicit host capability; never constructed from a delivery-row field.

The transport must be the same installed lifecycle/database origin as the
privileged outbox reader. A returned event proves publication only; it grants
neither current notification consent nor permission to send on any channel.
"""
    def __init__(self, lifecycle, *, outbox_origin):
        self.lifecycle = lifecycle
        self.outbox_origin = outbox_origin

    def read(self, row):
        if not isinstance(self.lifecycle, FrozenNodeLifecycleAdapter):
            return None
        if (not isinstance(self.outbox_origin, str) or not self.outbox_origin
                or self.lifecycle.source_origin != self.outbox_origin):
            return None
        try:
            # Snapshot the complete envelope before the transport can yield.
            encoded = json.dumps(row, allow_nan=False, separators=(',', ':'))
            if len(encoded.encode('utf-8')) > 256 * 1024:
                return None
            pin = json.loads(encoded)
            if not isinstance(pin, dict) or pin.get('channel') != 'email':
                return None  # Canonical outbox event; never webhook projection JSON.
            if pin.get('status') not in ('pending', 'deferred', 'sent', 'failed', 'suppressed'):
                return None  # PREPARED/ABANDONED are not publications.
            for field in ('id', 'user_id', 'alert_id'):
                if not isinstance(pin.get(field), str) or str(UUID(pin[field])) != pin[field]:
                    return None
            event = pin.get('fire_event_id')
            if not isinstance(event, str) or not re.fullmatch('[0-9a-f]{64}', event):
                return None
            payload = pin['payload']
            if payload['category'] != 'options_exposure_node':
                return None
            receipt = payload['frozen_node']['publication_receipt']
            runtime = receipt['runtime']
            if (receipt['schema'] != 'options.frozen_hit_receipt/v1'
                    or receipt['fireEventId'] != event
                    or runtime['principal'] != pin['user_id']
                    or runtime['alertId'] != pin['alert_id']
                    or self.lifecycle.instant(receipt['evaluationAt']) is None):
                return None
            payload_json = json.dumps(payload, allow_nan=False, separators=(',', ':'))
            result = CommittedFrozenEvent(pin['id'], event, pin['user_id'], pin['alert_id'],
                                          receipt['evaluationAt'], payload_json, self.outbox_origin)
            params = {'p_alert_id': pin['alert_id'], 'p_principal': pin['user_id'],
                      'p_predicate': runtime['predicate'], 'p_generation': runtime['generation'],
                      'p_revision': runtime['revision'], 'p_next_state': receipt['nextState'],
                      'p_hit': {'mode': 'reconcile', 'receipt': receipt, 'payload': payload}}
            # SQL owns complete receipt/payload equality, roles and publication
            # state. This operation cannot prepare/commit/fence/settle an event.
            reply = self.lifecycle.rpc('commit_frozen_node_state', params)
            if reply != {'kind': 'already_committed', 'fireEventId': event}:
                return None
            return result
        except Exception:
            # Failure of a read is unavailable evidence, never retry permission.
            return None
