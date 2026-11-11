"""U01 — daily-OHLC producer provenance tests (pure: tmp_path fixtures, no network).

Drives the ACTUAL producer seams: build_ohlc_json with a small pandas DataFrame,
merge_refresh, split_suspected_history, load_view_contract.

New-name imports (merge_refresh / split_suspected_history / load_view_contract /
view_block) are deliberately function-local: the module must still import against the
BASE producers so every test_u01_guard_* that does not depend on a new function runs
(and passes) there, while every test_u01_fix_* fails — the fail-on-old proof keeps its
guard half meaningful.
"""
import json

import pandas as pd
import pytest

from ingest.build_universe import build_ohlc_json
from ingest.polygon_bars import append_recent_bars, drop_stale_ticker_history


def bar(d, c, v=1000):
    return [d, c, c, c, c, v]


def deep_doc(bars, sym="FOO"):
    return {"t": sym, "o": 1, "src": "deep", "bar_quality": "synthetic_open_deepstore", "bars": bars}


def one_day_df(close=10.0, start="2026-01-05", periods=2):
    return pd.DataFrame({"close": [close + i for i in range(periods)]},
                        index=pd.date_range(start, periods=periods))


def contract_fixture(sym="FOO", mic="XNAS"):
    return {
        "schema": "dataos.view_contract.v1",
        "purpose": "terminal_daily_ohlc",
        "identity_namespace": "mastermind-terminal",
        "field_units": {"currency": "USD", "share_basis": "vendor-adjusted",
                        "volume_convention": "shares"},
        "adjustment_reference": {"basis": "tradj", "action_revision_set_id": None,
                                 "as_at": "2026-10-13T00:00:00Z"},
        "evidence_mode": {"mode": "CURRENT", "clock": "2026-10-13T16:18:00Z",
                          "dependency_generation_ids": ["deep-2026-10-12"], "code_version": None},
        "coverage": {"requested": 3100, "delivered": 3099,
                     "fallback": {"synthetic_open_deepstore": 3099}, "refused": {}},
        "listings": {sym: {"security_id": "SEC1", "listing_id": "LST1", "mic": mic,
                           "src": "deep", "refusal_reasons": []}},
        "refusal_reasons": [],
    }


# ------------------------------------------------------------------ test_u01_fix_*

def test_u01_fix_mixed_segment():
    from ingest.polygon_bars import merge_refresh
    doc = deep_doc([bar("2026-01-05", 10.0), bar("2026-01-06", 11.0)])
    rows = [bar("2026-01-07", 12.0), bar("2026-01-08", 13.0)]
    out, n, report = merge_refresh("FOO", doc, rows)
    assert n == 2 and report["basis_drift"] is False
    segs = out["view"]["segments"]
    assert len(segs) == 2
    assert segs[0] == {"from": "2026-01-05", "to": "2026-01-06",
                       "src": "deep", "bar_quality": "synthetic_open_deepstore"}
    assert segs[1] == {"from": "2026-01-07", "to": "2026-01-08",
                       "src": "polygon", "bar_quality": "real_ohlc"}
    # the top-level identity keys are NEVER upgraded by stitching real bars on top
    assert out["src"] == "deep" and out["bar_quality"] == "synthetic_open_deepstore"
    assert len(out["bars"]) == 4


def test_u01_fix_split_drift_refused():
    from ingest.polygon_bars import merge_refresh
    doc = deep_doc([bar("2026-01-05", 200.0)])            # stored close 200 on day D
    rows = [bar("2026-01-05", 100.0), bar("2026-01-06", 101.0)]   # vendor says 100 on D
    out, n, report = merge_refresh("FOO", doc, rows)
    assert n == 0 and report["basis_drift"] is True
    assert out["bars"] == doc["bars"]                     # byte-unchanged, nothing appended
    drift = out["view"]["basis_drift"]
    assert drift["status"] == "SUSPECTED" and drift["date"] == "2026-01-05"
    assert drift["stored_close"] == 200.0 and drift["vendor_close"] == 100.0
    assert drift["ratio"] == 2.0
    assert "BASIS_DRIFT_SUSPECTED" in out["view"]["refusal_reasons"]


def test_u01_fix_corrected_bar_refused():
    from ingest.polygon_bars import merge_refresh
    doc = deep_doc([bar("2026-01-05", 100.0), bar("2026-01-06", 100.5)])
    rows = [bar("2026-01-05", 95.0), bar("2026-01-06", 100.5), bar("2026-01-07", 101.0)]
    out, n, report = merge_refresh("FOO", doc, rows)
    assert n == 0 and report["basis_drift"] is True
    assert out["bars"] == doc["bars"]
    assert out["view"]["basis_drift"]["ratio"] == pytest.approx(100.0 / 95.0)
    assert "BASIS_DRIFT_SUSPECTED" in out["view"]["refusal_reasons"]


def test_u01_fix_suspected_break_retained():
    from ingest.polygon_bars import merge_refresh
    old = [bar(f"2026-01-{d:02d}", 10.0) for d in range(1, 29)]   # Jan 2026, ~$10
    new = [bar("2026-04-15", 40.0), bar("2026-04-16", 41.0)]      # 77d gap, 4x jump
    doc = deep_doc(old, sym="XXXX")
    out, n, report = merge_refresh("XXXX", doc, new)
    assert n == 2 and report["basis_drift"] is False
    # "bars" keeps exactly today's series (newest segment only) ...
    assert out["bars"] == new
    # ... and the dropped bars are RETAINED, never silently deleted
    assert out["retained_suspected_history"] == old
    breaks = [{"status": "SUSPECTED", "at": "2026-04-15",
               "reason": "gap>=45d and close jump>=3x", "retained_bars": len(old)}]
    assert out["view"]["suspected_breaks"] == breaks
    # a follow-up refresh must not duplicate retained dates or break records
    out2, n2, _ = merge_refresh("XXXX", out, [bar("2026-04-17", 42.0)])
    assert n2 == 1
    assert out2["retained_suspected_history"] == old
    assert out2["view"]["suspected_breaks"] == breaks
    # HISTORY_START stays authoritative: its trims are discarded, NOT retained
    meta_doc = deep_doc([bar("2022-06-01", 12.0), bar("2022-06-09", 200.0)], sym="META")
    mout, mn, _ = merge_refresh("META", meta_doc, [bar("2022-06-10", 201.0)])
    assert mn == 1 and [b[0] for b in mout["bars"]] == ["2022-06-09", "2022-06-10"]
    assert "retained_suspected_history" not in mout


def test_u01_fix_view_contract_verbatim(tmp_path):
    from ingest.polygon_bars import load_view_contract
    contract = contract_fixture("FOO")
    (tmp_path / "_view_contract.json").write_text(json.dumps(contract))
    loaded, refusals = load_view_contract(tmp_path)
    assert refusals == [] and loaded == contract
    doc = build_ohlc_json("FOO", one_day_df(), loaded, refusals)
    view = doc["view"]
    assert view["schema"] == "terminal.ohlc_view.v1"
    assert view["contract"] == {k: v for k, v in contract.items() if k != "listings"}
    assert view["listing"] == contract["listings"]["FOO"]
    assert view["contract"]["adjustment_reference"]["basis"] == "tradj"
    assert view["segments"] == [{"from": "2026-01-05", "to": "2026-01-06",
                                 "src": "deep", "bar_quality": "synthetic_open_deepstore"}]
    assert view["refusal_reasons"] == []


def test_u01_fix_contract_absent(tmp_path):
    from ingest.polygon_bars import load_view_contract
    contract, refusals = load_view_contract(tmp_path)     # empty dir — the normal state today
    assert contract is None and refusals == ["VIEW_CONTRACT_ABSENT"]


def test_u01_fix_contract_invalid(tmp_path):
    from ingest.polygon_bars import load_view_contract
    good = contract_fixture()
    bad = [
        "not json {",
        json.dumps({**good, "schema": "dataos.view_contract.v2"}),
        json.dumps({**good, "purpose": "something_else"}),
        json.dumps({k: v for k, v in good.items() if k != "coverage"}),
    ]
    for text in bad:
        (tmp_path / "_view_contract.json").write_text(text)
        contract, refusals = load_view_contract(tmp_path)
        assert contract is None and refusals == ["VIEW_CONTRACT_INVALID"], text


def test_u01_fix_basis_unsupported(tmp_path):
    from ingest.polygon_bars import load_view_contract
    contract = contract_fixture()
    contract["adjustment_reference"]["basis"] = "sadj"    # house SADJ is not claimed in v1
    (tmp_path / "_view_contract.json").write_text(json.dumps(contract))
    loaded, refusals = load_view_contract(tmp_path)
    assert loaded is None and refusals == ["VIEW_BASIS_UNSUPPORTED"]


def test_u01_fix_venue_out_of_scope():
    contract = contract_fixture("FOO", mic="XLON")        # D00.A1.3: XNYS/XNAS/XASE/ARCX only
    doc = build_ohlc_json("FOO", one_day_df(), contract, [])
    assert "VENUE_OUT_OF_SCOPE" in doc["view"]["refusal_reasons"]


def test_u01_fix_listing_absent():
    contract = contract_fixture("BAR")                    # FOO has no listing entry
    doc = build_ohlc_json("FOO", one_day_df(), contract, [])
    assert doc["view"]["listing"] is None
    assert "LISTING_ABSENT" in doc["view"]["refusal_reasons"]


def test_u01_fix_legacy_doc_gets_view():
    from ingest.polygon_bars import merge_refresh
    doc = deep_doc([bar("2026-01-05", 10.0), bar("2026-01-06", 11.0)], sym="LG")
    out, n, _ = merge_refresh("LG", doc, [bar("2026-01-07", 12.0)])
    view = out["view"]
    assert view["schema"] == "terminal.ohlc_view.v1"
    assert view["contract"] is None and view["listing"] is None
    assert "VIEW_CONTRACT_ABSENT" in view["refusal_reasons"]
    assert view["segments"][0] == {"from": "2026-01-05", "to": "2026-01-06",
                                   "src": "deep", "bar_quality": "synthetic_open_deepstore"}
    # a doc with NO top-level src / bar_quality gets "unknown" — never guessed —
    # and the segment says so
    doc2 = {"t": "X", "o": 1, "bars": [bar("2026-01-05", 10.0)]}
    out2, _, _ = merge_refresh("X", doc2, [bar("2026-01-06", 11.0)])
    seg0 = out2["view"]["segments"][0]
    assert seg0["src"] == "unknown" and seg0["bar_quality"] == "unknown"
    assert "SEGMENT_SRC_UNKNOWN" in out2["view"]["refusal_reasons"]


# ---------------------------------------------------------------- test_u01_guard_*

def test_u01_guard_build_ohlc_json_legacy_fields():
    doc = build_ohlc_json("GT", one_day_df())
    assert doc["t"] == "GT" and doc["o"] == 1
    assert doc["src"] == "deep" and doc["bar_quality"] == "synthetic_open_deepstore"
    assert doc["bars"] == [["2026-01-05", 10.0, 10.0, 10.0, 10.0, None],
                           ["2026-01-06", 10.0, 11.0, 10.0, 11.0, None]]


def test_u01_guard_append_recent_bars_semantics():
    bars = [bar("2026-01-05", 10.0), bar("2026-01-06", 11.0)]
    new = [bar("2026-01-06", 11.0), bar("2026-01-07", 12.0)]
    out, n = append_recent_bars("AAPL", bars, new)        # strictly newer only
    assert n == 1 and len(out) == 3 and out[-1][0] == "2026-01-07"
    out2, n2 = append_recent_bars("AAPL", out, new)       # idempotent rerun
    assert n2 == 0 and out2 == out


def test_u01_guard_history_start_authoritative():
    bars = [bar(d, 12.0) for d in ("2022-06-01", "2022-06-08", "2022-06-09", "2022-06-10")]
    out = drop_stale_ticker_history("META", bars)
    assert [b[0] for b in out] == ["2022-06-09", "2022-06-10"]   # trimmed, not retained


def test_u01_guard_within_tolerance_appends():
    from ingest.polygon_bars import merge_refresh
    doc = deep_doc([bar("2026-01-05", 100.00)])
    rows = [bar("2026-01-05", 100.50), bar("2026-01-06", 101.0)]
    out, n, report = merge_refresh("FOO", doc, rows)
    assert n == 1 and report["basis_drift"] is False
    assert [b[0] for b in out["bars"]] == ["2026-01-05", "2026-01-06"]
    assert out["bars"][0][4] == 100.00                     # the stored bar is never rewritten
    assert out["view"]["basis_drift"] is None
