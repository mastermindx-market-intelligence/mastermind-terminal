"""Source-only qualified-hit transport. No default publisher or retry loop.

Admission is as of the trusted evaluation, not a transaction-locked account
revision. Receipts are evidence from the installed producer, never a grant read
from condition JSON. The existing lifecycle RPC/outbox own all effects. A fresh prepare ACK precedes
the one commit transport; replayed intents never resume automatically. The caller
must first acknowledge its DB-exclusive publication-run marker.
"""
from __future__ import annotations

import json

from ingest.options_frozen_lifecycle import FrozenRuntime, _json_equal


def runtime_record(runtime):
    return {'schema': 'options.frozen_runtime/v1', 'alertId': runtime.alert_id,
            'principal': runtime.principal, 'generation': runtime.generation,
            'revision': runtime.revision, 'createdAt': runtime.created_at,
            'armingEpoch': runtime.arming_epoch, 'predicate': runtime.predicate,
            'priorState': runtime.prior_state}


class FrozenNodeHitPublisher:
    """Explicit capability, never constructed by the reader opt-in factory.

    Only a trusted engine caller may supply this capability. Both current email
    and webhook delivery admission remain separate production qualification.
    """
    def __init__(self, lifecycle):
        self.lifecycle = lifecycle

    def publish(self, runtime, state, receipt, payload):
        # Only a freshly acknowledged durable intent permits this invocation's
        # one commit transport. Existing/unsettled intents never resume here.
        prepared = self.prepare(runtime, state, receipt, payload)
        if prepared.get('kind') != 'prepared':
            return prepared
        return self._call(runtime, state, receipt, payload, 'commit')

    def prepare(self, runtime, state, receipt, payload):
        return self._call(runtime, state, receipt, payload, 'prepare')

    def fence(self, runtime, state, receipt, payload):
        """Explicit exact persisted intent retirement; NEVER an automatic recovery."""
        return self._call(runtime, state, receipt, payload, 'fence')

    def settle(self, runtime, state, receipt, payload):
        """Explicit administrative closure of a proven committed invocation.

        Never called by publish, reconciliation or the scheduled evaluator.
        Absence, a timeout or a remaining prepared intent cannot authorize it.
        """
        return self._call(runtime, state, receipt, payload, 'settle')

    def reconcile(self, runtime, state, receipt, payload):
        """Explicit same-ID read only; never called automatically on uncertainty."""
        return self._call(runtime, state, receipt, payload, 'reconcile')

    def _call(self, runtime, state, receipt, payload, mode):
        unavailable = {'kind': 'unavailable', 'reason': 'invalid qualified-hit binding'}
        failed_kind = 'unavailable' if mode == 'reconcile' else 'effect_unknown'
        if not isinstance(runtime, FrozenRuntime):
            return unavailable
        try:
            state, receipt, payload = json.loads(json.dumps([state, receipt, payload], allow_nan=False))
            normalized = self.lifecycle.normalize_state(state, runtime.target_fingerprint)
            at = self.lifecycle.instant
            prior = runtime.prior_state
            if (not normalized or not _json_equal(normalized, state) or not prior
                    or prior.get('inside') is not False or state['inside'] is not True
                    or state['armingEpoch'] != runtime.arming_epoch or state['withinPct'] != runtime.within_pct
                    or at(state['lastQuoteAt']) <= at(prior['lastQuoteAt'])
                    or at(state['lastQuoteAt']) > at(runtime.evaluation_at)
                    or not _json_equal(receipt.get('runtime'), runtime_record(runtime))
                    or not _json_equal(receipt.get('nextState'), state)
                    or receipt.get('evaluationAt') != runtime.evaluation_at
                    or not _json_equal(payload.get('frozen_node', {}).get('publication_receipt'), receipt)):
                return unavailable
        except Exception:
            return unavailable  # Validation failed before any transport effect.
        try:
            reply = self.lifecycle.rpc('commit_frozen_node_state', {
                'p_alert_id': runtime.alert_id, 'p_principal': runtime.principal,
                'p_predicate': runtime.predicate, 'p_generation': runtime.generation,
                'p_revision': runtime.revision, 'p_next_state': state,
                'p_hit': {'mode': mode, 'receipt': receipt, 'payload': payload}})
            if not isinstance(reply, dict):
                return {'kind': failed_kind, 'fireEventId': receipt.get('fireEventId'), 'phase': mode}
            if reply.get('kind') in ('prepared', 'committed', 'already_committed', 'unsettled', 'abandoned', 'settled'):
                if reply.get('fireEventId') != receipt.get('fireEventId'):
                    return {'kind': failed_kind, 'fireEventId': receipt.get('fireEventId'), 'phase': mode}
                if reply.get('kind') == 'settled' and mode != 'settle':
                    return {'kind': failed_kind, 'fireEventId': receipt.get('fireEventId'), 'phase': mode}
                if reply.get('kind') == 'prepared' and (mode != 'prepare' or not _json_equal(reply.get('receipt'), receipt)):
                    return {'kind': failed_kind, 'fireEventId': receipt.get('fireEventId'), 'phase': mode}
                return reply
            if reply.get('kind') in ('conflict', 'unavailable', 'effect_unknown'):
                return {**reply, 'phase': mode} if reply.get('kind') == 'effect_unknown' else reply
            return {'kind': failed_kind, 'fireEventId': receipt.get('fireEventId'), 'phase': mode}
        except Exception:
            # A transport exception may follow a committed SQL transaction. No
            # automatic repeat or downgrade to proof of no effect is permitted.
            return {'kind': failed_kind, 'fireEventId': receipt.get('fireEventId')
                    if isinstance(receipt, dict) else None, 'phase': mode}
