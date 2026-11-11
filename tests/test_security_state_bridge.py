"""The public Terminal bridge must retain owner truth and reject broken receipts."""
from copy import deepcopy
from datetime import date

import pytest

from ingest.pull_macro_intel import build_intel
from ingest.security_state_bridge import read_security_state, security_state_digest


def source_state():
    """Synthetic contract fixture; never published or used as market evidence."""
    state = {
        "schema": "security_state.v1", "version": "1.0.0",
        "security_id": "SEC:US-XNAS-AAPL", "issuer_id": "ISS:US-XNAS-AAPL",
        "listing_key": "US-XNAS-AAPL", "ticker_display": "AAPL",
        "generated_at": "2026-10-16T20:00:00Z", "content_sha256": "0" * 64,
        "as_of": {"market_at": "2026-10-16", "source_frontier_at": "2026-10-15T12:00:00Z", "state_compiled_at": "2026-10-16T20:00:00Z"},
        "authority": {"class": "context_only", "display_only": True, "can_rank": False, "can_gate": False, "can_size": False, "can_originate_signal": False, "can_execute": False},
        "identity_proof": {"state": "PROVEN", "method": "owner_backed_chain.v1", "legs": [], "equalities": [], "refusals": [], "disclosures": ["Synthetic test", "No market evidence", "No private context", "No trading authority"]},
        "coverage": {"overall_state": "PARTIAL", "required_legs_total": 2, "required_legs_available": 1, "required_legs_nonblocking": 1, "optional_legs_total": 5, "optional_legs_available": 0, "optional_legs_nonblocking": 1, "missing_legs": ["change"], "stale_legs": [], "rights_blocked_legs": [], "conflicted_legs": []},
        "dominant_degradation": "PARTIAL", "last_good": None,
        "legs": {
            "state": {"deterministic_state_refs": ["ladder.state"], "ladder_state": "HOLD", "ladder_direction": "up", "values_read": [{"field": "ladder.state", "value": "HOLD"}], "summary": {"en": "Synthetic hold", "zh": "测试持有"}, "coverage_state": "AVAILABLE"},
            "change": {"economic_episode_ref": None, "event_refs": [], "generation_id": None, "source_available_at": None, "observed_at": None, "summary": {"en": "Not covered", "zh": "未覆盖"}, "correction_state": "none", "coverage_state": "UNAVAILABLE", "workspace_warnings": []},
            "opportunity_context": {"prophet": {"ref": None, "state": "UNAVAILABLE", "reason": "not linked"}, "entry": {"state": "AVAILABLE", "available": True, "null_reason": None}, "market_incorporation": {"ref": None, "state": "UNAVAILABLE"}, "dislocation": {"ref": None, "state": "UNAVAILABLE"}, "coverage_state": "PARTIAL"},
            "risk": {"risk_refs": [], "failed_gates": [], "strongest_unresolved_fact": {"state": "unavailable", "leg": None, "code": None, "en": None, "zh": None}, "coverage_state": "UNAVAILABLE"},
            "catalyst": {"next_observables": [], "deadlines": [], "coverage_state": "NOT_COVERED"},
            "personal_impact": {"state": "NO_USER_CONTEXT", "user_exposure_overlay_ref": None, "coverage_state": "NOT_APPLICABLE"},
            "evidence": {"evidence_block_refs": [], "recipe_id": None, "compilation": None, "conflicts": [], "coverage_state": "UNAVAILABLE"},
        },
    }
    state["content_sha256"] = security_state_digest(state)
    return state


def test_forwards_exact_envelope_with_its_independent_clocks_and_degradation():
    state = source_state()
    before = deepcopy(state)
    result = build_intel("AAPL", {"asof": "2026-01-01", "security_state": state}, today=date(2026, 10, 17))
    assert result["tape"]["stale"] is True
    assert result["security_state_read"]["disposition"] == "accepted"
    assert result["security_state"] == before == state
    assert result["security_state"] is not state
    assert result["security_state"]["authority"]["can_gate"] is False
    assert result["security_state"]["legs"]["opportunity_context"]["entry"]["available"] is True


@pytest.mark.parametrize("raw, expected", [(None, "not_published"), ([], "invalid"), ({"schema": "security_state.v9"}, "unsupported_contract")])
def test_distinguishes_absence_and_contract_errors(raw, expected):
    assert read_security_state(raw, "AAPL") == (None, expected)


def test_rejects_wrong_symbol_even_when_owner_digest_is_intact():
    assert read_security_state(source_state(), "MSFT") == (None, "identity_mismatch")


def test_rejects_tampered_evidence():
    state = source_state()
    state["legs"]["state"]["summary"]["en"] = "Changed after the owner signed it"
    assert read_security_state(state, "AAPL") == (None, "digest_mismatch")


@pytest.mark.parametrize("kind", ["private", "authority", "extra", "bad_date", "missing_leg"])
def test_closed_contract_rejects_private_or_unreviewed_shape(kind):
    state = source_state()
    if kind == "private": state["legs"]["personal_impact"]["user_exposure_overlay_ref"] = "private-account"
    elif kind == "authority": state["authority"]["can_size"] = True
    elif kind == "extra": state["legs"]["state"]["entry_permission"] = True
    elif kind == "bad_date": state["generated_at"] = "yesterday"
    else: state["legs"].pop("risk")
    state["content_sha256"] = security_state_digest(state)
    assert read_security_state(state, "AAPL") == (None, "invalid")


def test_clock_only_refresh_does_not_break_semantic_digest():
    state = source_state()
    state["generated_at"] = state["as_of"]["state_compiled_at"] = "2026-10-17T20:00:00Z"
    assert read_security_state(state, "AAPL")[1] == "accepted"


def test_failed_compilation_and_last_good_are_retained_without_promotion():
    state = source_state()
    state["dominant_degradation"] = "COMPILER_FAILURE"
    state["identity_proof"]["state"] = "BLOCKED_IDENTITY_BRIDGE"
    state["last_good"] = {"generated_at": "2026-10-15T20:00:00Z", "content_sha256": "a" * 64, "dominant_degradation": "NONE", "reason": "last proven source"}
    state["content_sha256"] = security_state_digest(state)
    accepted, disposition = read_security_state(state, "AAPL")
    assert disposition == "accepted"
    assert accepted == state
    assert accepted["dominant_degradation"] == "COMPILER_FAILURE"
