"""Old-client compatibility and immutable projection selection."""
import copy
import json
from pathlib import Path
import pytest
from ingest.regional_financial_projection import (
    materialize_regional_fund, wrap_regional_financials, canonical_projection, digest, projection,
)
from ingest.statement_history import merge_statement_history

FIXTURE = Path(__file__).resolve().parents[1] / "terminal/lib/__tests__/fixtures/regional_financial_projection.json"


def fixture():
    return json.loads(FIXTURE.read_text())


def test_python_and_typescript_share_the_exact_projection_receipt():
    envelope = fixture()
    assert digest(canonical_projection(projection(envelope))) == envelope["regional_financials"]["base_sha256"]
    assert "2026-06-30" not in envelope["statements"]["quarterly"]["period_end"]
    selected = materialize_regional_fund(envelope, "600519.SS")
    assert selected["statements"]["quarterly"]["period_end"][-1] == "2026-06-30"
    assert selected["statements"]["quarterly"]["income"]["eps_basic"][-1] is None
    assert selected["statements"]["quarterly"]["cashflow"]["cfo"][-1] is None
    assert "regional_financials" not in selected


@pytest.mark.parametrize("change", ["base", "payload", "version", "ticker", "currency"])
def test_corrupt_or_incompatible_envelope_is_never_promoted(change):
    envelope = fixture()
    if change == "base": envelope["statements"]["annual"]["income"]["revenue"][0] += 1
    if change == "payload": envelope["regional_financials"]["payload_json"] += " "
    if change == "version": envelope["regional_financials"]["schema"] += "999"
    if change == "ticker": envelope["regional_financials"]["ticker"] = "000858.SZ"
    if change == "currency": envelope["stmt_currency"] = "USD"
    with pytest.raises(ValueError):
        materialize_regional_fund(envelope, "600519.SS")


def test_repeat_wrapping_keeps_legacy_view_and_whole_qualified_projection():
    envelope = fixture()
    selected = materialize_regional_fund(envelope, "600519.SS")
    again = wrap_regional_financials(selected, envelope)
    assert projection(again) == projection(envelope)
    assert materialize_regional_fund(again, "600519.SS") == selected


def test_new_listing_has_no_legacy_mixed_periods():
    selected = materialize_regional_fund(fixture(), "600519.SS")
    envelope = wrap_regional_financials(selected, None)
    assert envelope["statements"] == {"annual": None, "quarterly": None}
    assert envelope["earnings"]["q"] == [] and envelope["earnings"]["fy"] == []
    assert envelope["src"]["statements"] is None
    assert materialize_regional_fund(envelope, "600519.SS")["statements"] == selected["statements"]


def test_primary_source_cannot_silently_discard_the_qualified_projection():
    envelope = fixture()
    fresh = copy.deepcopy(envelope);fresh.pop("regional_financials")
    with pytest.raises(ValueError, match="source-transition"):
        merge_statement_history(fresh, envelope)


def test_legacy_view_withholds_proven_unsafe_eps_without_adding_periods():
    previous = fixture()
    selected = materialize_regional_fund(previous, "600519.SS")
    row = next(row for row in selected["earnings"]["q"]
               if row.get("eps_basis") == "discrete_eps_unavailable")
    previous.pop("regional_financials")
    previous["earnings"]["q"] = [
        {"end":row["end"], "period":row["period"], "eps_a":99, "surp_pct":500, "rev_a":123},
        {"end":"2026-03-31", "period":"Q1 2026", "eps_a":10, "surp_pct":20}]
    untouched = copy.deepcopy(previous)
    result = wrap_regional_financials(selected, previous)
    assert previous == untouched
    assert len(result["earnings"]["q"]) == 2
    assert result["earnings"]["q"][0] == {**previous["earnings"]["q"][0], "eps_a":None, "surp_pct":None}
    assert result["earnings"]["q"][1] == previous["earnings"]["q"][1]
    assert result["statements"] == previous["statements"]
    assert materialize_regional_fund(result, "600519.SS")["earnings"] == selected["earnings"]
