"""Regression contract for the existing display-only market-risk bridge.

No collector, external source, production payload or Macro warning module runs.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.pull_macro_risk import _is_stale, build_market_risk  # noqa: E402

TODAY = date(2026, 10, 8)


def _source(schema: str = "risk_state.v1") -> dict:
    radar = {"state": "caution", "top_score": 84.8,
             "label_en": "Rates pressure", "label_zh": "利率压力"}
    if schema == "market_state.v1":
        return {"schema": schema, "asof": "2026-10-08", "verdict": "MIXED",
                "score": 51, "radar": radar,
                "components": [{"key": "trend", "score": 50}]}
    return {"schema": schema, "nightly_asof": "2026-10-08",
            "stale": False, "realtime": True, "live_active": True,
            "display": {"verdict": "MIXED", "score": 51,
                        "label_en": "Mixed", "label_zh": "混合"},
            "live": {"radar": radar}, "nightly": {}}


@pytest.mark.parametrize("asof", [
    "2026-10-09", "2026-10-08junk", "20261008", "2026-10-08T12:00:00Z",
    "2026-10-08 ", " 2026-10-08", "2026-02-30", True,
    datetime(2026, 10, 8, 12),
])
def test_only_exact_nonfuture_session_dates_are_fresh(asof):
    assert _is_stale(asof, TODAY, 5) is True


@pytest.mark.parametrize("asof,expected", [
    (date(2026, 10, 8), False), ("2026-10-08", False),
    ("2026-10-04", False), ("2026-10-03", True), (None, True),
])
def test_existing_date_budget_and_boundary_are_preserved(asof, expected):
    assert _is_stale(asof, TODAY, 5) is expected


@pytest.mark.parametrize("schema", ["risk_state.v1", "market_state.v1"])
@pytest.mark.parametrize("marker", [True, None, "false", "true", 0, 1, ""])
def test_producer_stale_or_invalid_marker_cannot_be_restamped_fresh(schema, marker):
    src = _source(schema)
    src["stale"] = marker
    out = build_market_risk(src, today=TODAY)
    assert out["stale"] is True
    assert out["realtime"] is False
    assert out["verdict"] == "MIXED"  # historical observation, not a fabricated calm


@pytest.mark.parametrize("schema", ["risk_state.v1", "market_state.v1"])
def test_absent_stale_marker_preserves_legacy_date_derived_compatibility(schema):
    src = _source(schema)
    src.pop("stale", None)
    assert build_market_risk(src, today=TODAY)["stale"] is False


@pytest.mark.parametrize("field", ["realtime", "live_active"])
@pytest.mark.parametrize("value", ["false", "true", 1, 0, None, False])
def test_realtime_requires_real_boolean_true(field, value):
    src = _source()
    src[field] = value
    assert build_market_risk(src, today=TODAY)["realtime"] is False


@pytest.mark.parametrize("asof", ["2026-10-09", "2026-10-01", "2026-10-08junk", None])
def test_bad_session_prevents_realtime_claim(asof):
    src = _source()
    src["nightly_asof"] = asof
    out = build_market_risk(src, today=TODAY)
    assert out["stale"] is True
    assert out["realtime"] is False


def test_fresh_true_boolean_realtime_survives():
    out = build_market_risk(_source(), today=TODAY)
    assert out["realtime"] is True
    assert out["stale"] is False


@pytest.mark.parametrize("value", [
    True, False, float("nan"), float("inf"), -float("inf"),
    "nan", "Infinity", "-Infinity", "1e999", "n/a", 10 ** 500,
], ids=["true", "false", "nan", "inf", "neg-inf", "nan-string",
        "inf-string", "neg-inf-string", "overflow-string", "bad-string", "huge-int"])
def test_all_numeric_slots_reject_invalid_or_nonfinite_values(value):
    src = _source("market_state.v1")
    src["score"] = value
    src["radar"]["top_score"] = value
    src["components"][0]["score"] = value
    out = build_market_risk(src, today=TODAY)
    assert out["score"] is None
    assert out["radar"]["top_score"] is None
    assert out["components"][0]["score"] is None
    json.dumps(out, allow_nan=False)


@pytest.mark.parametrize("value,expected", [(0, 0), (0.0, 0.0), ("0", 0.0),
                                           (51, 51), (84.812345, 84.8123), ("51.5", 51.5)])
def test_finite_numbers_and_legitimate_zero_survive(value, expected):
    src = _source()
    src["display"]["score"] = value
    out = build_market_risk(src, today=TODAY)
    assert out["score"] == expected
    if type(value) is int:
        assert type(out["score"]) is int
    json.dumps(out, allow_nan=False)


def test_projection_preserves_source_and_no_action_authority():
    src = _source()
    before = deepcopy(src)
    out = build_market_risk(src, today=TODAY)
    assert src == before
    assert out["is_display_only"] is True
    assert out["label_zh"] == "混合"
    assert out["radar"]["label_zh"] == "利率压力"
    assert not ({"may_size", "may_execute", "may_gate", "may_rank", "may_exit_modulate"} & out.keys())
