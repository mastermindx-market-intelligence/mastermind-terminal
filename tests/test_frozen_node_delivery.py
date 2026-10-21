"""New-type delivery contract only; fake HTTP captures the real Supa.fire output.

These are preparatory enqueue tests, not grants or delivery admission. The current
API rejects this condition, and no production trusted resolver is connected.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ingest.alerts_engine as ae


def test_frozen_target_qualifiers_reach_actual_outbox_without_hashes_in_prose(monkeypatch):
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
    calls = []

    def status(url, _headers, *, method, body):
        assert "/alert_outbox?on_conflict=fire_event_id" in url and method == "POST"
        calls.append(body)
        return 201, [body], ""

    def patch(url, _headers, *, method, body):
        assert "/alerts?id=" in url and "active=eq.true" in url and method == "PATCH"
        assert body["active"] is False
        return None

    monkeypatch.setattr(ae, "http_json_status", status)
    monkeypatch.setattr(ae, "http_json", patch)
    vintage = ae._minute_vintage(state["lastQuoteAt"])
    assert ae.Supa("https://synthetic.invalid", "synthetic-not-a-key").fire(
        alert, 620.1, "An evaluator note alone is not a delivery receipt", vintage=vintage)
    assert len(calls) == 1
    row = calls[0]
    assert row["fire_event_id"] == ae.mint_fire_event_id(alert, vintage)
    payload = row["payload"]
    english = payload["condition_plain"].lower()
    chinese = payload["condition_plain_zh"]
    assert all(fragment in english for fragment in ("620", "2026-10-20", "dated", "partial", "sampled"))
    assert "620" in chinese and "2026-10-20" in chinese
    assert "a" * 64 not in english and "b" * 64 not in english
    assert "thetadata" not in english
    assert payload["frozen_node"]["target"] == target
    assert payload["frozen_node"]["quote"] == {
        "asof": state["lastQuoteAt"], "basis": "IEX_DELAYED"}
    # The accepted incumbent category remains withheld at the Macro drain.
    assert payload["category"] == "options_exposure_node"
    assert payload["requires_tier"] == "essential"
    assert payload["frozen_node"]["within_pct"] == .25
    assert "delayed" in english
