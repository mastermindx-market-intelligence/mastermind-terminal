import copy
import json
import numpy as np
import pandas as pd
import pytest
from signal_layer.mtf_screener import ScreenPolicy, document_frame, scan_universe, screen_ticker


def document(n=2200, symbol="TEST"):
    i = np.arange(n)
    close = 100*np.exp(.00008*i + .12*np.sin(i/27) + .035*np.sin(i/7))
    opens = close*(1+.005*np.cos(i/13))
    dates = pd.bdate_range("2012-01-02", periods=n)
    return {"t":symbol, "src":"synthetic_validation_only", "bar_quality":"real_ohlc",
            "adjustment_basis":"synthetic_no_corporate_actions",
            "session_anchor":{"v":1,"date":dates[0].date().isoformat(),"index":0,"basis":"feed"},
            "bars":[[t.date().isoformat(), float(o), float(max(o,c)*1.02), float(min(o,c)*.98), float(c), 1000000.0]
                    for t,o,c in zip(dates,opens,close)]}


def args(doc, **kwargs):
    t = doc["bars"][-1][0]
    return dict(symbol=doc["t"], market="us", as_of=t, closed_through=t, expected_session=t, **kwargs)


def test_full_and_swing_coverage_are_not_silently_mixed():
    doc = document(1000)
    swing = screen_ticker(doc, **args(doc))
    full = screen_ticker(doc, **args(doc, policy=ScreenPolicy(preset="full")))
    assert swing["state"] == "research_ready"
    assert full["state"] == "insufficient_history"
    assert "1M" in full["missing_timeframes"]
    assert full["setup_score"] is None
    assert full["historical_analogs"] is None
    assert not swing["trade_authority"] and swing["production_rank"] is None


def test_populated_monthly_full_snapshot_and_strict_json():
    doc = document()
    row = screen_ticker(doc, **args(doc, policy=ScreenPolicy(preset="full")))
    assert row["state"] == "research_ready"
    monthly = row["timeframes"][-1]
    assert monthly["ready"] and monthly["closed_bars"] >= 78
    assert monthly["rsi_macd"] is not None
    assert row["historical_analogs"]["status"] == "unvalidated_historical_comparison"
    json.dumps(row, allow_nan=False)


def test_source_suffix_never_changes_earlier_snapshot_or_digest():
    doc = document()
    cutoff = doc["bars"][1800][0]
    kwargs = dict(symbol="TEST",market="us",as_of=cutoff,closed_through=cutoff,expected_session=cutoff)
    a = screen_ticker(doc, **kwargs)
    prefix = copy.deepcopy(doc)
    prefix["bars"] = prefix["bars"][:1801]
    b = screen_ticker(prefix, **kwargs)
    assert a == b


def test_provisional_tail_is_excluded_before_any_calculation():
    doc = document(1000)
    cutoff = doc["bars"][-2][0]
    changed = copy.deepcopy(doc)
    for j in range(1,5):
        changed["bars"][-1][j] *= 2
    kwargs = dict(symbol="TEST",market="us",as_of=doc["bars"][-1][0],closed_through=cutoff,expected_session=cutoff)
    assert screen_ticker(doc, **kwargs) == screen_ticker(changed, **kwargs)


def test_stale_input_not_research_ranked_but_visible():
    doc = document(1000)
    expected = (pd.Timestamp(doc["bars"][-1][0])+pd.offsets.BDay()).date().isoformat()
    r = screen_ticker(doc, symbol="TEST",market="us",as_of=expected,closed_through=expected,expected_session=expected)
    assert r["state"] == "stale_data" and r["historical_analogs"] is None


def test_every_requested_name_accounted_for():
    good = document(1000,"GOOD")
    bad = document(5,"WRONG")
    date = good["bars"][-1][0]
    requests = [{"symbol":s,"market":"us","closed_through":date,"expected_session":date} for s in ["GOOD","BAD","MISSING"]]
    out = scan_universe({"GOOD":good,"BAD":bad},requests,as_of=date)
    assert out["requested_count"] == 3 and len(out["rows"]) == 3
    assert out["coverage"] == {"research_ready":1,"invalid_data":1,"missing_data":1}
    assert out["research_order"] == ["GOOD"]
    assert out["selection_adjustment"]["pbo"] is None
    assert not out["production_rank_authority"] and not out["trade_authority"]


@pytest.mark.parametrize("mutation", ["quality","anchor","source","duplicate","range","open","volume"])
def test_invalid_source_never_silently_fixed(mutation):
    doc = document(30)
    if mutation == "quality": doc["bar_quality"] = "close_proxy"
    if mutation == "anchor": doc.pop("session_anchor")
    if mutation == "source": doc.pop("src")
    if mutation == "duplicate": doc["bars"][3][0] = doc["bars"][2][0]
    if mutation == "range": doc["bars"][3][2] = 1
    if mutation == "open": doc["bars"][3][1] = np.nan
    if mutation == "volume": doc["bars"][3][5] = -1
    with pytest.raises(ValueError):
        document_frame(doc,"TEST")


def test_dated_anchor_not_assumed_row_zero():
    doc = document(1000)
    other = copy.deepcopy(doc)
    other["session_anchor"].update(date=doc["bars"][5][0], index=5)
    a,b = screen_ticker(doc,**args(doc)),screen_ticker(other,**args(other))
    assert a == b


def test_universe_order_is_not_future_profit_sorted():
    doc = document(1000)
    second = copy.deepcopy(doc)
    second["t"] = "AAA"
    t = doc["bars"][-1][0]
    requests=[dict(symbol=s,market="us",closed_through=t,expected_session=t) for s in ["TEST","AAA"]]
    r=scan_universe({"TEST":doc,"AAA":second},requests,as_of=t)
    assert r["research_order"] == ["AAA","TEST"]
    assert all(row["historical_analogs"]["status"] == "unvalidated_historical_comparison" for row in r["rows"])


def test_short_history_does_not_get_zero_score_or_fake_analogs():
    doc = document(20)
    row = screen_ticker(doc,**args(doc))
    assert row["setup_score"] is None
    assert row["state"] == "insufficient_history"
    assert row["historical_analogs"] is None
    assert row["timeframes"][-1]["closed_bars"] == 0


@pytest.mark.parametrize("kwargs", [{"preset":"intraday"},{"analog_horizon":True},{"min_analogs":30},{"entry_bps":-1}])
def test_policy_validation(kwargs):
    with pytest.raises(ValueError): ScreenPolicy(**kwargs)


def test_duplicate_request_is_rejected_not_double_counted():
    with pytest.raises(ValueError):
        scan_universe({},[{"symbol":"TEST"},{"symbol":"TEST"}],as_of="2025-01-02")
