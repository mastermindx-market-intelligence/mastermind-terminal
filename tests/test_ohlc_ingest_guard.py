"""The ticker-reuse guard and market-owner boundaries on non-Polygon ingest paths.

PR #92 guarded the Polygon fetch used by build_polygon_universe (flagships). The two
remaining contaminated series on the box (0300.HK via the yfinance/Tencent backfill,
SPCX via grouped-daily appends) arrived through backfill_ohlc.write_json and the
refresh_ohlc/refresh_ohlc_intl append loops — these tests pin the guard onto those.

China A-share daily history is owned by Macro's canonical ``china_stocks`` deep store
and copied into Terminal by ``build_universe.py --ohlc all``.  The generic non-US Yahoo
refresher must never independently append .SS/.SZ rows over that canonical plane.
"""
from __future__ import annotations

import datetime as dt
import json

import ingest.backfill_ohlc as backfill_ohlc
import ingest.refresh_ohlc  # noqa: F401  — import-safe: no polygon key at module level
import ingest.refresh_ohlc_intl as refresh_ohlc_intl  # yfinance deferred to main()


def bar(date: str, close: float) -> list:
    return [date, close, close, close, close, 1000]


def seq(start: str, n: int, price: float) -> list:
    d0 = dt.date.fromisoformat(start)
    return [bar((d0 + dt.timedelta(days=i)).isoformat(), price + i * 0.1) for i in range(n)]


def test_write_json_drops_stale_segment(tmp_path, monkeypatch):
    # generic gap+jump rule (a symbol NOT in the curated map): one prior-holder bar,
    # then a 89-day gap into a 37x-higher continuous series → keep only the new segment
    monkeypatch.setattr(backfill_ohlc, "OUT", tmp_path)
    rows = [bar("2024-07-05", 2.49)] + seq("2024-10-02", 40, 90.0)
    n = backfill_ohlc.write_json("0301.HK", rows, "yahoo")
    assert n == 40
    doc = json.loads((tmp_path / "0301.HK.json").read_text())
    assert doc["bars"][0][0] == "2024-10-02"
    assert len(doc["bars"]) == 40


def test_write_json_skips_thin_remainder(tmp_path, monkeypatch):
    # SPCX shape: after trimming the old holder, the honest series is < 30 bars —
    # nothing is written yet (the symbol backfills once the new listing has history)
    monkeypatch.setattr(backfill_ohlc, "OUT", tmp_path)
    rows = seq("2021-06-29", 60, 22.0) + seq("2026-06-12", 17, 160.0)
    n = backfill_ohlc.write_json("SPCY", rows, "yahoo")
    assert n == 0
    assert not (tmp_path / "SPCY.json").exists()


def test_write_json_clean_series_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(backfill_ohlc, "OUT", tmp_path)
    rows = seq("2024-01-01", 50, 100.0)
    n = backfill_ohlc.write_json("AAPL", rows, "yahoo")
    assert n == 50
    doc = json.loads((tmp_path / "AAPL.json").read_text())
    assert doc["bars"][0][0] == "2024-01-01"
    assert doc["src"] == "yahoo" and doc["bar_quality"] == "real_ohlc"


def test_intl_refresh_excludes_china_by_suffix(tmp_path):
    (tmp_path / "600118.SS.json").write_text("{}")
    (tmp_path / "000001.SZ.json").write_text("{}")
    assert refresh_ohlc_intl.should_refresh("600118.SS", {"mkt": "SSE"}, str(tmp_path)) is False
    assert refresh_ohlc_intl.should_refresh("000001.SZ", {"mkt": "SZSE"}, str(tmp_path)) is False


def test_intl_refresh_excludes_china_by_market_even_if_suffix_is_bad(tmp_path):
    # Defense in depth: a malformed/imported China symbol cannot sneak into the generic
    # Yahoo append lane merely because it lacks the canonical suffix.
    (tmp_path / "600118.json").write_text("{}")
    assert refresh_ohlc_intl.should_refresh("600118", {"mkt": "SSE"}, str(tmp_path)) is False


def test_intl_refresh_keeps_hk_and_other_non_us_names(tmp_path):
    for sym in ("0700.HK", "SHOP.TO", "7203.T"):
        (tmp_path / f"{sym}.json").write_text("{}")
        assert refresh_ohlc_intl.should_refresh(sym, {"mkt": "HKEX"}, str(tmp_path)) is True
