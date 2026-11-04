"""Macro daily-history leg: who gets a /data/<sym>.json, and when a fetch is fit to publish.

Two live defects sit behind these guards.

1. The four mainland-China index rows (000001.SS et al) shipped searchable with NO daily history:
   their quotes route to Tencent, which serves none, and nothing else wrote them a series. The
   Terminal dead-ended on "No data for this symbol" under a live price — the 2026-08-05 operator
   report. ohlc_symbols() puts them on the Yahoo chart leg while leaving the quote leg alone.

2. USDCNH=X was live on prod as a ONE-BAR file: Yahoo quotes the code but has no history for it,
   and the writer published whatever came back. publish_decision() is the depth guard, and it has
   to tolerate the 5y window drifting by a bar a day or it would freeze every daily update.
"""
from __future__ import annotations

import json
import pytest
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from ingest.build_macro_symbols import (
    FULL_HISTORY_START_TS, INDEX_ARCHIVE_START_TS, INDEX_WITHOUT_DAILY_HISTORY,
    FULL_HISTORY_SYMBOLS, MIN_DEEP_DAILY_BARS, MIN_OHLC_BARS,
    existing_bar_count, fetch_ohlc, merge_deep_history, ohlc_history_query, publish_decision,
)
from ingest.macro_catalog import CATALOG, fred_symbols, ohlc_symbols, yahoo_symbols

CN_INDICES = {"000001.SS", "000300.SS", "000905.SS", "399001.SZ", "399006.SZ"}


def test_ohlc_leg_extends_the_quote_leg_with_the_cn_indices():
    ohlc, yahoo = ohlc_symbols(), yahoo_symbols()
    assert set(yahoo) <= set(ohlc), "every Yahoo-quoted symbol must keep its history leg"
    assert CN_INDICES <= set(ohlc), "the CN indices are the reason this leg exists"
    assert not CN_INDICES & set(yahoo), "their QUOTES stay on Tencent — this must not move them"


def test_ohlc_leg_has_no_duplicates_and_only_real_catalog_rows():
    ohlc = ohlc_symbols()
    assert len(ohlc) == len(set(ohlc)), "a duplicate would fetch and rewrite the same series twice"
    assert set(ohlc) <= {s.sym for s in CATALOG}, "every target must be a catalog symbol"


def test_ohlc_leg_excludes_crypto_and_fred():
    ohlc = set(ohlc_symbols())
    assert not (ohlc & set(fred_symbols())), "FRED rows are daily prints, not OHLC"
    assert not {s.sym for s in CATALOG if s.sym.endswith("-USD")} & ohlc, "crypto has its own lane"


def test_publish_writes_a_full_series():
    assert publish_decision(1211, 0) == "write"       # first publish
    assert publish_decision(1211, 1210) == "write"    # steady state


def test_publish_tolerates_rolling_window_drift():
    # A 5y window sheds its oldest bar as it gains today's; an exact-count guard would freeze here.
    assert publish_decision(1209, 1210) == "write"
    assert publish_decision(700, 1210) == "write"     # thinner, but not the collapse we guard


def test_publish_keeps_disk_over_a_truncated_fetch():
    # Yahoo hiccup on a symbol that was fine yesterday — never overwrite 5 years with a stub.
    assert publish_decision(1, 1210) == "keep"
    assert publish_decision(400, 1210) == "keep"      # less than half of what is published


def test_publish_refuses_to_create_a_stub():
    # 000905.SS / 399006.SZ answer with one bar and have nothing on disk: no file at all beats a
    # one-candle "chart", and the Terminal's empty state explains it.
    assert publish_decision(1, 0) == "keep"
    assert publish_decision(MIN_OHLC_BARS - 1, 0) == "keep"
    assert publish_decision(MIN_OHLC_BARS, 0) == "write"


def test_publish_drops_a_stub_already_on_disk():
    # The USDCNH=X case: a one-bar file already published, and nothing better on offer.
    assert publish_decision(1, 1) == "drop"
    assert publish_decision(0, 5) == "drop"
    # …but a series with real depth is never deleted, whatever the fetch returned.
    assert publish_decision(0, 1210) == "keep"


def _bars(start: str, count: int, close: int = 100) -> list[list]:
    first = date.fromisoformat(start)
    return [[(first + timedelta(days=i)).isoformat(), close, close + 1,
             close - 1, close, 100] for i in range(count)]


def test_shanghai_composite_requests_bounded_daily_yahoo_history():
    assert FULL_HISTORY_START_TS == 631152000  # 1990-01-01 UTC; Yahoo serves 1997 onward
    assert ohlc_history_query("000001.SS", now_ts=1762300000) == (
        "period1=631152000&period2=1762386400&interval=1d"
    )
    assert INDEX_ARCHIVE_START_TS == -2208988800  # 1900-01-01 UTC
    assert ohlc_history_query("^GSPC", now_ts=1762300000) == (
        "period1=-2208988800&period2=1762386400&interval=1d"
    )
    for sym in ("000300.SS", "000905.SS", "399006.SZ", "EURUSD=X", "GC=F"):
        assert ohlc_history_query(sym) == "range=5y&interval=1d"

    # Check actual request URLs; range=max auto-downsamples to monthly despite interval=1d.
    with patch("ingest.build_macro_symbols._get", return_value={"chart": {"result": []}}) as get:
        assert fetch_ohlc("000001.SS") == []
        assert fetch_ohlc("^GSPC") == []
        assert fetch_ohlc("000300.SS") == []
    index_url = get.call_args_list[0].args[0]
    index_query = parse_qs(urlparse(index_url).query)
    assert urlparse(index_url).path.endswith("/000001.SS")
    assert index_query["period1"] == [str(FULL_HISTORY_START_TS)]
    assert int(index_query["period2"][0]) > FULL_HISTORY_START_TS
    assert index_query["interval"] == ["1d"]
    assert "range" not in index_query
    assert "^GSPC?period1=-2208988800" in get.call_args_list[1].args[0]
    assert "000300.SS?range=5y&interval=1d" in get.call_args_list[2].args[0]


def _yahoo_bars(granularity: str, count: int) -> dict:
    start = datetime(1997, 7, 2, tzinfo=timezone.utc)
    timestamps = [int((start + timedelta(days=i)).timestamp()) for i in range(count)]
    return {"chart": {"result": [{
        "meta": {"dataGranularity": granularity},
        "timestamp": timestamps,
        "indicators": {"quote": [{
            "open": [100.0] * count, "high": [101.0] * count,
            "low": [99.0] * count, "close": [100.5] * count,
            "volume": [1000] * count,
        }]},
    }]}}


def test_shanghai_rejects_monthly_or_truncated_responses(capsys):
    with patch("ingest.build_macro_symbols._get", return_value=_yahoo_bars("1mo", 353)):
        assert fetch_ohlc("000001.SS") == []
    assert "granularity=1mo" in capsys.readouterr().err

    with patch("ingest.build_macro_symbols._get", return_value=_yahoo_bars("1d", 353)):
        assert fetch_ohlc("000001.SS") == []
    assert "refusing non-daily/truncated history" in capsys.readouterr().err


def test_shanghai_accepts_genuine_deep_daily_ohlc():
    with patch("ingest.build_macro_symbols._get",
               return_value=_yahoo_bars("1d", MIN_DEEP_DAILY_BARS)):
        rows = fetch_ohlc("000001.SS")
    assert len(rows) == MIN_DEEP_DAILY_BARS
    assert rows[0] == ["1997-07-02", 100.0, 101.0, 99.0, 100.5, 1000]
    assert rows[1][0] == "1997-07-03"


def test_shanghai_history_backfill_preserves_old_dates_and_prefers_fresh_overlap(tmp_path):
    path = tmp_path / "000001.SS.json"
    old_1997 = _bars("1997-07-01", 35, 100)
    old_recent = _bars("2026-07-01", 35, 200)
    path.write_text(json.dumps({"bars": old_1997 + old_recent}))
    recent_refresh = _bars("2026-07-01", 35, 250)

    got = merge_deep_history("000001.SS", path, recent_refresh)
    assert got == old_1997 + recent_refresh
    assert len({row[0] for row in got}) == len(got), "never emit duplicate dates"
    assert publish_decision(len(got), len(old_1997 + old_recent)) == "write"


def test_shanghai_history_never_promotes_single_candle_stubs(tmp_path):
    path = tmp_path / "000001.SS.json"
    old = _bars("1997-07-01", 35) + _bars("2026-07-01", 35)
    path.write_text(json.dumps({"bars": old}))
    stub = _bars("2026-11-01", 1)
    assert merge_deep_history("000001.SS", path, stub) == stub
    assert publish_decision(len(stub), len(old)) == "keep"


def test_deep_history_merge_is_index_scoped_and_safe_on_corrupt_disk(tmp_path):
    path = tmp_path / "other.json"
    path.write_text(json.dumps({"bars": _bars("1997-07-01", 35)}))
    fresh = _bars("2026-07-01", 35, 300)
    assert merge_deep_history("000300.SS", path, fresh) == fresh
    path.write_text("{not json")
    assert merge_deep_history("000001.SS", path, fresh) == fresh


def test_shanghai_depth_counts_valid_candles_after_null_closes(capsys):
    payload = _yahoo_bars("1d", MIN_DEEP_DAILY_BARS)
    payload["chart"]["result"][0]["indicators"]["quote"][0]["close"][:-30] = [None] * 970
    with patch("ingest.build_macro_symbols._get", return_value=payload):
        assert fetch_ohlc("000001.SS") == []
    assert "valid_daily_bars=30" in capsys.readouterr().err


def test_shanghai_duplicate_dates_cannot_satisfy_the_depth_floor():
    payload = _yahoo_bars("1d", MIN_DEEP_DAILY_BARS)
    result = payload["chart"]["result"][0]
    result["timestamp"][-1] = result["timestamp"][0]
    with patch("ingest.build_macro_symbols._get", return_value=payload):
        assert fetch_ohlc("000001.SS") == []


def test_shanghai_valid_daily_rows_are_sorted_unique_and_latest_overlap_wins():
    payload = _yahoo_bars("1d", MIN_DEEP_DAILY_BARS + 1)
    result = payload["chart"]["result"][0]
    result["timestamp"][-1] = result["timestamp"][0]
    result["indicators"]["quote"][0]["close"][-1] = 100.75
    with patch("ingest.build_macro_symbols._get", return_value=payload):
        rows = fetch_ohlc("000001.SS")
    assert len(rows) == MIN_DEEP_DAILY_BARS
    assert [row[0] for row in rows] == sorted({row[0] for row in rows})
    assert rows[0][4] == 100.75


@pytest.mark.parametrize(("field", "bad"), [
    ("open", None), ("open", "100"), ("high", float("nan")),
    ("close", float("inf")), ("close", True), ("close", 10 ** 400),
    ("low", 0), ("low", -1), ("low", 102), ("high", 99),
    ("volume", None), ("volume", -1), ("volume", False),
])
def test_shanghai_provider_rows_must_have_finite_numeric_ohlcv(field, bad):
    payload = _yahoo_bars("1d", MIN_DEEP_DAILY_BARS + 1)
    payload["chart"]["result"][0]["indicators"]["quote"][0][field][0] = bad
    with patch("ingest.build_macro_symbols._get", return_value=payload):
        rows = fetch_ohlc("000001.SS")
    assert len(rows) == MIN_DEEP_DAILY_BARS
    assert rows[0][0] == "1997-07-03", "the malformed candle must be omitted, not repaired"


@pytest.mark.parametrize("bad", [True, "867801600", float("inf"), float("nan")])
def test_shanghai_invalid_timestamps_do_not_count_as_daily_candles(bad):
    payload = _yahoo_bars("1d", MIN_DEEP_DAILY_BARS + 1)
    payload["chart"]["result"][0]["timestamp"][0] = bad
    with patch("ingest.build_macro_symbols._get", return_value=payload):
        rows = fetch_ohlc("000001.SS")
    assert len(rows) == MIN_DEEP_DAILY_BARS
    assert rows[0][0] == "1997-07-03"


@pytest.mark.parametrize("bad", [
    ["not-a-date", None, None, None, None, None],
    ["1997-02-30", 100, 101, 99, 100, 100],
    ["19970701", 100, 101, 99, 100, 100],
    ["1997-W27-2", 100, 101, 99, 100, 100],
    [True, 100, 101, 99, 100, 100],
    ["1997-06-30", "100", 101, 99, 100, 100],
    ["1997-06-30", True, 101, 99, 100, 100],
    ["1997-06-30", 100, float("inf"), 99, 100, 100],
    ["1997-06-30", 100, 101, 99, float("nan"), 100],
    ["1997-06-30", 100, 101, 99, 100, -1],
    ["1997-06-30", 100, 101, 99, 100, None],
    ["1997-06-30", 100, 101, 0, 100, 100],
    ["1997-06-30", 100, 99, 98, 100, 100],
    ["1997-06-30", 100, 101, 100.5, 100, 100],
    ["1997-06-30", 10 ** 400, 101, 99, 100, 100],
    ["1997-06-30"], {"date": "1997-06-30"}, None,
])
def test_shanghai_does_not_republish_malformed_stored_candles(tmp_path, bad):
    path = tmp_path / "000001.SS.json"
    old = _bars("1997-07-01", 35)
    fresh = _bars("2026-07-01", 35, 250)
    path.write_text(json.dumps({"bars": old + [bad]}))
    assert merge_deep_history("000001.SS", path, fresh) == old + fresh


def test_shanghai_published_depth_counts_only_valid_unique_stored_dates(tmp_path):
    path = tmp_path / "000001.SS.json"
    old = _bars("1997-07-01", 35)
    rows = old + old + [["not-a-date", None, None, None, None, None]] * 100
    path.write_text(json.dumps({"bars": rows}))
    assert existing_bar_count(path, deep_history=True) == len(old)
    assert existing_bar_count(path) == len(rows), "other symbols retain the established count"


def test_shanghai_malformed_rows_cannot_promote_a_stored_stub(tmp_path):
    path = tmp_path / "000001.SS.json"
    old = _bars("1997-07-01", MIN_OHLC_BARS - 1)
    path.write_text(json.dumps({"bars": old + [["not-a-date", 1, 1, 1, 1, 1]] * 20}))
    fresh = _bars("2026-07-01", 35, 250)
    assert merge_deep_history("000001.SS", path, fresh) == fresh


def _run_shanghai_ingest(monkeypatch, out_dir, payload):
    from ingest import build_macro_symbols as macro

    monkeypatch.delenv("TERMINAL_MANIFEST", raising=False)
    monkeypatch.setattr("sys.argv", ["build_macro_symbols.py", "--out", str(out_dir), "--no-quotes"])
    monkeypatch.setattr(macro, "ohlc_symbols", lambda: ["000001.SS"])
    monkeypatch.setattr(macro.time, "sleep", lambda _: None)
    with patch("ingest.build_macro_symbols._get", return_value=payload) as get:
        assert macro.main() == 0
    assert get.call_count == 1


@pytest.mark.parametrize("has_history", [False, True])
def test_shanghai_sparse_response_cannot_create_or_replace_history(tmp_path, monkeypatch, has_history):
    path = tmp_path / "000001.SS.json"
    before = json.dumps({"bars": _bars("1990-01-01", 35)}).encode()
    if has_history:
        path.write_bytes(before)
    payload = _yahoo_bars("1d", MIN_DEEP_DAILY_BARS)
    payload["chart"]["result"][0]["indicators"]["quote"][0]["close"][:-30] = [None] * 970
    _run_shanghai_ingest(monkeypatch, tmp_path, payload)
    if has_history:
        assert path.read_bytes() == before
    else:
        assert not path.exists()


def test_shanghai_real_ingest_removes_invalid_history_without_losing_valid_dates(tmp_path, monkeypatch):
    path = tmp_path / "000001.SS.json"
    old = _bars("1990-01-01", 35)
    path.write_text(json.dumps({
        "bars": old + [["not-a-date", None, None, None, None, None]] * 3000,
    }))
    _run_shanghai_ingest(monkeypatch, tmp_path, _yahoo_bars("1d", MIN_DEEP_DAILY_BARS))
    payload = json.loads(path.read_text())
    assert payload["bar_quality"] == "real_ohlc"
    assert payload["bars"][:35] == old
    assert len(payload["bars"]) == MIN_DEEP_DAILY_BARS + len(old)
    assert payload["bars"][35] == ["1997-07-02", 100.0, 101.0, 99.0, 100.5, 1000]
    assert [row[0] for row in payload["bars"]] == sorted({row[0] for row in payload["bars"]})
    assert not list(tmp_path.glob("*.macro.tmp"))


def test_other_indices_keep_existing_small_daily_response_behavior():
    with patch("ingest.build_macro_symbols._get", return_value=_yahoo_bars("1d", 35)):
        assert len(fetch_ohlc("000300.SS")) == 35


def test_all_catalogued_index_histories_are_deep_unless_provider_cannot_supply_daily():
    catalog_indices = {row.sym for row in CATALOG if row.sec == "Indices"}
    assert len(catalog_indices) == 22
    assert INDEX_WITHOUT_DAILY_HISTORY == {"000300.SS", "000905.SS", "399006.SZ"}
    assert FULL_HISTORY_SYMBOLS == catalog_indices - INDEX_WITHOUT_DAILY_HISTORY
    assert len(FULL_HISTORY_SYMBOLS) == 19  # Shanghai + eighteen additional indices
    assert FULL_HISTORY_SYMBOLS <= set(ohlc_symbols())
    assert "^GSPC" in yahoo_symbols() and "399001.SZ" not in yahoo_symbols()
    assert "000001.SS" in FULL_HISTORY_SYMBOLS
    assert "399001.SZ" in FULL_HISTORY_SYMBOLS
    # A new index catalog row auto-enrolls without touching the FX, bonds or futures legs.
    assert not FULL_HISTORY_SYMBOLS.intersection({r.sym for r in CATALOG if r.sec != "Indices"})


@pytest.mark.parametrize("symbol", [
    "^GSPC", "^NDX", "^DJI", "^RUT", "^VIX",
    "399001.SZ", "^HSI", "^HSCE", "^GSPTSE", "^N225", "^KS11", "^TWII",
    "^FTSE", "^GDAXI", "^FCHI", "^STOXX50E", "^BSESN", "^AXJO",
])
def test_other_supported_indices_request_earliest_available_daily_history(symbol):
    args = parse_qs(ohlc_history_query(symbol, now_ts=1762300000))
    assert args == {
        "period1": [str(INDEX_ARCHIVE_START_TS)],
        "period2": ["1762386400"],
        "interval": ["1d"],
    }


@pytest.mark.parametrize("symbol", ["^GSPC", "^N225", "^HSI", "399001.SZ"])
def test_other_index_deep_history_rejects_downsampled_monthlies(symbol, capsys):
    with patch("ingest.build_macro_symbols._get", return_value=_yahoo_bars("1mo", 353)):
        assert fetch_ohlc(symbol) == []
    assert "granularity=1mo" in capsys.readouterr().err


def test_other_index_merge_retains_older_archive_and_replaces_overlap(tmp_path):
    path = tmp_path / "^GSPC.json"
    previous = _bars("1927-12-30", 40) + _bars("2026-07-01", 40, 200)
    path.write_text(json.dumps({"bars": previous}))
    latest = _bars("2026-07-01", 40, 250)
    merged = merge_deep_history("^GSPC", path, latest)
    assert merged == previous[:40] + latest
    assert publish_decision(len(merged), len(previous)) == "write"


def test_unsupported_china_indices_remain_guarded_and_never_emit_one_bar(tmp_path):
    for sym in INDEX_WITHOUT_DAILY_HISTORY:
        output = tmp_path / f"{sym}.json"
        assert ohlc_history_query(sym) == "range=5y&interval=1d"
        assert publish_decision(1, 0) == "keep"
        output.write_text(json.dumps({"bars": _bars("2021-11-01", 35)}))
        assert merge_deep_history(sym, output, _bars("2026-11-04", 1)) == _bars("2026-11-04", 1)
        assert publish_decision(1, existing_bar_count(output)) == "keep"
