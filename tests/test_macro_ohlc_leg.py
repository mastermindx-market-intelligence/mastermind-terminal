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
from datetime import date, timedelta
from unittest.mock import patch

from ingest.build_macro_symbols import (
    MIN_OHLC_BARS, fetch_ohlc, merge_deep_history, ohlc_history_range,
    publish_decision,
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


def test_shanghai_composite_requests_full_yahoo_history_not_rolling_five_years():
    assert ohlc_history_range("000001.SS") == "max"
    for sym in ("000300.SS", "399001.SZ", "^GSPC", "EURUSD=X"):
        assert ohlc_history_range(sym) == "5y"

    # Check the actual request route as well as the selector, without a live API dependency.
    with patch("ingest.build_macro_symbols._get", return_value={"chart": {"result": []}}) as get:
        assert fetch_ohlc("000001.SS") == []
        assert fetch_ohlc("000300.SS") == []
    assert "000001.SS?range=max&interval=1d" in get.call_args_list[0].args[0]
    assert "000300.SS?range=5y&interval=1d" in get.call_args_list[1].args[0]


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
