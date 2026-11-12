"""A US risk bridge must not borrow an envelope from another or unknown market.

All inputs are synthetic; no fetch, emitter, ledger, host or publication runs.
"""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path

import pytest

from ingest.pull_macro_risk import build_market_risk, qualify_risk_envelope

NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
FIXTURE = Path(__file__).resolve().parents[1] / "terminal/lib/__tests__/rotationRiskEnvelope.fixture.json"


def fixture():
    envelope = json.loads(FIXTURE.read_text())
    source = {"schema": "market_state.v1", "asof": envelope["source_session"],
              "built": envelope["produced_at"], "verdict": "MIXED", "score": 51,
              "freshness": {"stale": False}}
    return source, envelope


@pytest.mark.parametrize("market", ["CN", "HK", "UK", "JP", "us", " US ", "", None, False, 1, [], {}])
def test_foreign_or_ambiguous_market_is_not_qualified(market):
    source, envelope = fixture()
    envelope["market"] = market
    before = deepcopy(envelope)
    payload, qualification = qualify_risk_envelope(envelope, source["asof"], today=NOW.date(), now=NOW)
    assert payload is None
    assert qualification["qualified"] is False
    assert "market_mismatch" in qualification["reasons"]
    assert envelope == before


def test_missing_market_cannot_be_assumed_us():
    source, envelope = fixture()
    del envelope["market"]
    out = build_market_risk(source, now=NOW, risk_envelope=envelope)
    assert out["risk_envelope"] is None
    assert out["risk_envelope_freshness"] == {"qualified": False, "reasons": ["market_mismatch"]}
    assert out["verdict"] == "MIXED" and out["score"] == 51
    assert out["stale"] is False and out["is_display_only"] is True


def test_foreign_hazard_does_not_erase_independent_native_score():
    source, envelope = fixture()
    envelope.update(market="CN")
    envelope["hazard_summary"]["stage"] = "BREAKDOWN"
    out = build_market_risk(source, now=NOW, risk_envelope=envelope)
    assert out["risk_envelope"] is None
    assert out["risk_envelope_freshness"]["reasons"] == ["market_mismatch"]
    assert out["verdict"] == "MIXED" and out["score"] == 51
    assert out["stale"] is False and out["is_display_only"] is True


def test_same_market_native_evidence_survives_without_mutation():
    source, envelope = fixture()
    before = deepcopy(envelope)
    out = build_market_risk(source, now=NOW, risk_envelope=envelope)
    assert out["risk_envelope_freshness"] == {"qualified": True, "reasons": []}
    for field in ("market", "measured_state", "hazard_summary", "rotation_context", "authority"):
        assert out["risk_envelope"][field] == envelope[field]
    assert envelope == before
