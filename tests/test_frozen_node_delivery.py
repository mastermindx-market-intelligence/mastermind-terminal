"""Generic frozen-node fire stays closed before outbox, HTTP and event identity.

The synthetic target retains full source identity but cannot establish source/action
authority. Protected state CAS does not authorize a fire or webhook fan-out.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ingest.alerts_engine as ae


def test_frozen_target_cannot_bypass_generic_fire_hold(monkeypatch):
    target = {
        "root": "SPY", "securityId": "SEC:US-ARCX-SPY",
        "sourceSession": "2026-10-20", "sourceKey": "a" * 64,
        "definitionKey": "synthetic:reported-gamma", "scopeKey": '["one","2026-10-23"]',
        "availableAt": "2026-10-20T13:00:00Z", "price": 620,
        "qualification": "observed_partial",
        "members": [{"expiry": "2026-10-23", "strike": 620, "right": "C"}],
        "sourceBinding": {"inputSha256": "b" * 64, "populationId": "c" * 64,
                          "sourceRef": "synthetic:dated-source", "clocks": {}},
    }
    state = {"lastQuoteAt": "2026-10-20T14:05:20Z", "lastQuoteBasis": "IEX_DELAYED", "withinPct": .25}
    alert = {"id": "synthetic-alert", "user_id": "synthetic-principal", "symbol": "SPY",
             "condition": {"type": "opt_frozen_node_proximity", "root": "SPY",
                           "target": target, "within_pct": .25, "_fnp": state}}
    def refused_effect(*_args, **_kwargs):
        raise AssertionError("Generic frozen-node fire must refuse before HTTP or fire identity effects")

    monkeypatch.setattr(ae, "http_json_status", refused_effect)
    monkeypatch.setattr(ae, "http_json", refused_effect)
    monkeypatch.setattr(ae, "mint_fire_event_id", refused_effect)
    vintage = ae._minute_vintage(state["lastQuoteAt"])
    assert ae.Supa("https://synthetic.invalid", "synthetic-not-a-key").fire(
        alert, 620.1, "Synthetic exact target is not source/action authority", vintage=vintage) is False
