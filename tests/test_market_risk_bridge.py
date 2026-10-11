"""Tests for the market-risk bridge (ingest/pull_macro_risk.py).

Covers the pure ``build_market_risk`` trim against BOTH source schemas
(risk_state.v1 — the web-served display file; market_state.v1 — the richer nightly
file with component legs) and the stale-abstain gate.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.pull_macro_risk import build_market_risk, _is_stale  # noqa: E402

TODAY = date(2026, 7, 1)


# ── fixtures ─────────────────────────────────────────────────────────────────

def _risk_state(*, asof="2026-07-01", verdict="RISK_OFF", score=40):
    """A minimal risk_state.v1 (web-served) source dict."""
    return {
        "schema": "risk_state.v1",
        "stale": False, "realtime": False, "live_active": False,
        "nightly_asof": asof,
        "display": {"verdict": verdict, "score": score, "color": "red",
                    "label_en": "Risk-off", "label_zh": "避险"},
        "live": {"verdict": verdict, "score": score,
                 "headline_en": "Risk-off — defend capital.", "headline_zh": "避险 — 保住本金。",
                 "radar": {"state": "caution", "state_ungated": "risk-off", "top_score": 84,
                           "label_en": "Growth scare / defensive rotation", "label_zh": "增长恐慌/防御轮动"}},
        "nightly": {"verdict": verdict, "score": score, "headline_en": "Risk-off — defend capital.",
                    "headline_zh": "避险 — 保住本金。",
                    "radar": {"state": "caution", "top_score": 84,
                              "label_en": "Growth scare / defensive rotation", "label_zh": "增长恐慌/防御轮动"}},
    }


def _market_state(*, asof="2026-07-01", verdict="MIXED", score=55):
    """A minimal market_state.v1 (richer nightly) source dict."""
    return {
        "schema": "market_state.v1", "asof": asof, "verdict": verdict, "score": score,
        "color": "amber", "label_en": "Mixed", "label_zh": "中性",
        "headline_en": "Mixed tape.", "headline_zh": "混合行情。",
        "radar": {"state": "watch", "label_en": "Neutral", "top_score": 30},
        "components": [
            {"key": "liquidity", "label_en": "Liquidity & credit", "score": 75, "tone": "good", "weight": 0.14},
            {"key": "trend", "label_en": "Trend & technicals", "score": 90, "tone": "good", "weight": 0.24},
        ],
        "is_display_only": True,
    }


# ── risk_state.v1 (the deploy source) ────────────────────────────────────────

class TestRiskStateSource:
    def test_schema_and_verdict(self):
        out = build_market_risk(_risk_state(), today=TODAY)
        assert out["schema"] == "market_risk/v1"
        assert out["verdict"] == "RISK_OFF"
        assert out["score"] == 40 and isinstance(out["score"], int)

    def test_display_only_always_true(self):
        assert build_market_risk(_risk_state(), today=TODAY)["is_display_only"] is True

    def test_radar_trimmed(self):
        r = build_market_risk(_risk_state(), today=TODAY)["radar"]
        assert r["state"] == "caution" and r["top_score"] == 84
        assert r["label_en"].startswith("Growth scare")

    def test_bilingual_carried(self):
        out = build_market_risk(_risk_state(), today=TODAY)
        assert out["label_zh"] == "避险"
        assert out["headline_zh"] == "避险 — 保住本金。"
        assert out["radar"]["label_zh"] == "增长恐慌/防御轮动"

    def test_fresh_not_stale(self):
        assert build_market_risk(_risk_state(asof="2026-07-01"), today=TODAY)["stale"] is False

    def test_no_components_from_web_source(self):
        # risk_state.v1 carries no component legs — the key must be absent, not null.
        assert "components" not in build_market_risk(_risk_state(), today=TODAY)


# ── market_state.v1 (the richer fallback) ────────────────────────────────────

class TestMarketStateSource:
    def test_verdict_and_components(self):
        out = build_market_risk(_market_state(), today=TODAY)
        assert out["verdict"] == "MIXED"
        assert out["radar"]["state"] == "watch"
        assert isinstance(out["components"], list) and len(out["components"]) == 2
        leg = out["components"][0]
        assert {"key", "label_en", "score", "tone"}.issubset(leg)
        assert leg["weight"] == 0.14
        assert leg["key"] == "liquidity" and leg["score"] == 75


# ── stale-abstain gate ───────────────────────────────────────────────────────

class TestStaleGate:
    def test_old_asof_is_stale(self):
        assert build_market_risk(_risk_state(asof="2026-06-20"), today=TODAY)["stale"] is True

    def test_missing_asof_is_stale(self):
        src = _risk_state()
        src.pop("nightly_asof")
        assert build_market_risk(src, today=TODAY)["stale"] is True

    def test_empty_source_does_not_crash(self):
        out = build_market_risk({}, today=TODAY)
        assert out["schema"] == "market_risk/v1"
        assert out["verdict"] is None
        assert out["stale"] is True                # no asof → stale
        assert out["is_display_only"] is True


@pytest.mark.parametrize("asof,max_days,expected", [
    ("2026-07-01", 5, False),
    ("2026-06-27", 5, False),
    ("2026-06-26", 5, True),
    ("2026-06-25", 5, True),
    (None, 5, True),
    ("", 5, True),
    ("invalid", 5, True),
])
def test_is_stale(asof, max_days, expected):
    assert _is_stale(asof, date(2026, 7, 1), max_days) is expected

# The user-visible defect was a producer/consumer contract mismatch, together
# with inactive-live content replacing the nightly cause. Exercise failure paths,
# not only the former shape's happy fixture.
from datetime import datetime, timezone  # noqa: E402
import copy  # noqa: E402
import json  # noqa: E402
from ingest import pull_macro_risk as bridge  # noqa: E402

NOW = datetime(2026, 7, 1, 19, 0, tzinfo=timezone.utc)


def _envelope():
    return {
        "schema": "mastermind.risk_envelope/v1", "bundle_id": "test-bundle",
        "source_session": "2026-07-01", "as_of": "2026-07-01",
        "observed_at": "2026-07-01T18:00:00Z", "produced_at": "2026-07-01T18:00:00Z",
        "stale_after": None, "revision": "settled", "data_state": "FRESH",
        "measured_state": {"verdict": "MIXED", "score": 55},
        "hazard_summary": {"stage": "FRAGILE"}, "policy_summary": {"posture": "NORMAL"},
        "authority": {key: False for key in bridge._AUTHORITY_FLAGS},
        "freshness": {"all_on_session": True},
        "rotation_context": {"state": "DEFENSIVE_RELATIVE_STRENGTH", "as_of": "2026-07-01",
                             "usable": True, "coverage": "FRESH", "display_only": True},
        "confluence": {"state": "DEFENSIVE_RELATIVE_STRENGTH__MIXED",
                      "lineage_status": "PARTIAL", "nonredundant_component_count": None,
                      "statistical_independence_established": False,
                      "changes_hazard_stage": False, "changes_policy": False, "display_only": True},
    }


def test_inactive_live_cannot_replace_settled_read_or_cause():
    src = _risk_state(verdict="RISK_ON", score=65)
    src["stale"] = True
    src["stale_reason"] = "market closed"
    src["live"] = {"verdict": "RISK_OFF", "score": 12, "headline_en": "Live-only warning",
                   "radar": {"state": "risk-off", "top_score": 99}}
    src["nightly"]["headline_en"] = "Settled risk-on"
    src["nightly"]["radar"] = {"state": "watch", "top_score": 30}
    out = build_market_risk(src, now=NOW)
    assert (out["verdict"], out["score"], out["headline_en"]) == ("RISK_ON", 65, "Settled risk-on")
    assert out["radar"] == {"state": "watch", "top_score": 30}
    assert out["source_basis"] == "settled" and out["realtime"] is False
    assert out["stale"] is False
    assert out["freshness"]["source_stale_reason"] == "market closed"


@pytest.mark.parametrize("mutate,reason", [
    (lambda s: s.update(asof="2026-07-02"), "future_asof"),
    (lambda s: s.update(asof="2026-02-30"), "missing_or_invalid_asof"),
    (lambda s: s.update(freshness={"stale": True}), "owner_stale"),
    (lambda s: s.update(built="2026-07-01T20:00:00Z"), "future_built"),
    (lambda s: s.update(built="2026-07-01T18:00:00"), "invalid_built"),
    (lambda s: s.update(score=float("nan")), "invalid_score"),
    (lambda s: s.update(score=True), "invalid_score"),
])
def test_unknown_or_invalid_is_not_a_fresh_vote(mutate, reason):
    source = _market_state()
    mutate(source)
    result = build_market_risk(source, now=NOW)
    assert result["stale"] is True
    assert reason in result["freshness"]["reasons"]


def test_active_live_requires_event_clock_and_preserves_its_numeric_causes_during_pending_band():
    src = _risk_state(verdict="RISK_ON", score=66)
    src.update(live_active=True, realtime=True, built="2026-07-01T18:59:00Z",
               stale_after="2026-07-01T19:15:00Z")
    src["display"].update(score=50, raw_score=78, headline_en="Owner display projection",
                          pending={"verdict": "MIXED", "ticks": 1, "needs": 2})
    src["live"].update(verdict="MIXED", score=50, raw_score=78, capped=True,
                       score_source="verdict_cap", score_caps=[{"kind": "live_cap", "limit": 50}],
                       source_event_time="2026-07-01T18:58:00Z",
                       headline_en="Instantaneous Mixed", radar={"state": "caution"})
    src["nightly"].update(raw_score=66, capped=False, headline_en="Old settled prose")
    out = build_market_risk(src, now=NOW)
    assert out["stale"] is False and out["realtime"] is True
    assert (out["verdict"], out["score"], out["raw_score"]) == ("RISK_ON", 50, 78)
    assert out["source_verdict"] == "MIXED" and out["capped"] is True
    assert out["score_caps"] == src["live"]["score_caps"]
    assert out["headline_en"] == "Owner display projection"
    assert out["display_pending"] == src["display"]["pending"]
    assert out["cause_basis"] == "live_score_pending_band"
    assert out["source_event_time"] == "2026-07-01T18:58:00Z"
    src["display"]["raw_score"] = 79
    assert build_market_risk(src, now=NOW)["raw_score"] == 79
    del src["stale_after"]
    assert "missing_live_expiry" in build_market_risk(src, now=NOW)["freshness"]["reasons"]


def test_resolver_uses_fresh_settled_instead_of_first_stale_live_file(tmp_path, monkeypatch):
    live = tmp_path / "site/live/risk_state.json"
    live.parent.mkdir(parents=True)
    live.write_text(json.dumps(_risk_state(asof="2026-06-01")))
    settled = tmp_path / "data/market_state/latest.json"
    settled.parent.mkdir(parents=True)
    settled.write_text(json.dumps(_market_state()))
    monkeypatch.setattr(bridge, "MACRO", tmp_path)
    monkeypatch.delenv("MACRO_RISK_URL", raising=False)
    raw, provenance = bridge.resolve_source(now=NOW)
    assert raw["schema"] == "market_state.v1"
    assert provenance == "local:data/market_state/latest.json"


def test_optional_envelope_is_carried_verbatim_without_signal_arithmetic():
    env = _envelope()
    before = copy.deepcopy(env)
    result = build_market_risk(_market_state(), now=NOW, risk_envelope=env)
    assert result["risk_envelope"] == env
    assert env == before
    assert result["risk_envelope_freshness"]["qualified"] is True
    assert result["score"] == 55 and result["verdict"] == "MIXED"


@pytest.mark.parametrize("field,value,reason", [
    ("source_session", "2026-06-30", "source_session_mismatch"),
    ("data_state", "STALE", "unusable_data_state"),
    ("produced_at", "2026-07-01T20:00:00Z", "future_produced_at"),
    ("observed_at", None, "missing_or_invalid_observed_at"),
    ("observed_at", "9999-12-31T23:00:00-02:00", "missing_or_invalid_observed_at"),
    ("produced_at", "0001-01-01T00:00:00+02:00", "missing_or_invalid_produced_at"),
    ("stale_after", "2026-07-01T18:59:00Z", "invalid_or_expired_envelope"),
])
def test_bad_envelope_does_not_rewrite_native_market_state(field, value, reason):
    env = _envelope()
    env[field] = value
    result = build_market_risk(_market_state(), now=NOW, risk_envelope=env)
    assert result["risk_envelope"] is None
    assert reason in result["risk_envelope_freshness"]["reasons"]
    assert result["stale"] is False and result["score"] == 55


def test_existing_refresh_owners_invoke_context_bridge_without_signal_gate():
    for relative in ("ops/terminal-data", "ingest/refresh.sh"):
        source = (ROOT / relative).read_text()
        assert source.count('ingest/pull_macro_risk.py') == 1
    assert 'run "$PY" ingest/pull_macro_risk.py' in (ROOT / "ops/terminal-data").read_text()


def test_main_atomically_publishes_existing_output_with_native_dates(tmp_path, monkeypatch):
    source = _market_state(asof=datetime.now(timezone.utc).astimezone(bridge.MARKET_TZ).date().isoformat())
    out = tmp_path / "market_risk.json"
    monkeypatch.setattr(bridge, "OUT", out)
    monkeypatch.setattr(bridge, "resolve_source", lambda **kw: (source, "test:source"))
    monkeypatch.setattr(bridge, "resolve_risk_envelope", lambda *a, **kw: None)
    assert bridge.main() == 0
    doc = json.loads(out.read_text())
    assert doc["asof"] == source["asof"] and doc["source_path"] == "test:source"
    assert doc["score"] == source["score"]
    assert list(tmp_path.iterdir()) == [out]


def test_optional_off_session_source_does_not_erase_native_coverage():
    env = _envelope()
    env["freshness"] = {"source_session": "2026-07-01", "all_on_session": False,
                        "off_session_sources": ["optional-source"]}
    result = build_market_risk(_market_state(), now=NOW, risk_envelope=env)
    assert result["risk_envelope"]["freshness"] == env["freshness"]
    assert result["risk_envelope_freshness"]["qualified"] is True


@pytest.mark.parametrize("patch,reason", [
    ({"measured_state": {"usable": True, "as_of": "2026-06-30"}}, "measured_session_mismatch"),
    ({"observed_at": "2026-07-01T18:30:00Z"}, "incoherent_publication_clocks"),
    ({"revision": "live_provisional"}, "missing_live_expiry"),
    ({"confluence": {"changes_hazard_stage": True}}, "invalid_confluence_authority"),
])
def test_envelope_clock_and_authority_mismatches_remain_context_only(patch, reason):
    env = _envelope()
    env.update(patch)
    result = build_market_risk(_market_state(), now=NOW, risk_envelope=env)
    assert result["risk_envelope"] is None
    assert reason in result["risk_envelope_freshness"]["reasons"]
    assert result["score"] == 55 and result["stale"] is False


def test_a_fresh_legacy_build_does_not_refresh_an_unknown_observation():
    raw = {"built": "2026-07-01T18:59:00Z", "display": {"verdict": "RISK_ON", "score": 61}}
    result = build_market_risk(raw, now=NOW)
    assert result["source_basis"] == "legacy_display"
    assert result["asof"] is None and result["stale"] is True
    assert "missing_or_invalid_asof" in result["freshness"]["reasons"]


def test_new_york_session_remains_prior_day_across_utc_midnight():
    now = datetime(2026, 7, 2, 1, tzinfo=timezone.utc)
    # An explicit instant wins over a caller's UTC calendar date.
    current = build_market_risk(_market_state(), today=now.date(), now=now, risk_envelope=_envelope())
    assert current["stale"] is False
    assert current["risk_envelope_freshness"]["qualified"] is True
    future_envelope = {**_envelope(), "source_session": "2026-07-02", "as_of": "2026-07-02"}
    future = build_market_risk(_market_state(asof="2026-07-02"), today=now.date(),
                               now=now, risk_envelope=future_envelope)
    assert "future_asof" in future["freshness"]["reasons"]
    assert "invalid_future_or_expired_session" in future["risk_envelope_freshness"]["reasons"]
    assert future["risk_envelope"] is None
    _, direct = bridge.qualify_risk_envelope(future_envelope, "2026-07-02", today=now.date(), now=now)
    assert "invalid_future_or_expired_session" in direct["reasons"]
    live = _risk_state()
    live.update(live_active=True, realtime=True, built="2026-07-02T00:59:00Z",
                stale_after="2026-07-02T01:05:00Z")
    live["live"]["source_event_time"] = "2026-07-02T00:59:00Z"
    read = build_market_risk(live, now=now)
    assert read["stale"] is False and read["realtime"] is True
    assert read["asof"] == "2026-07-01"
