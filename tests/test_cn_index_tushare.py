"""CSI 300 / CSI 500 / ChiNext: accepted TuShare index_daily → Terminal OHLC.

Hermetic tests: none import a real token, contact a vendor, or write public data.
"""
from __future__ import annotations

import datetime as dt
import json
from unittest.mock import patch

import pytest

from ingest import build_macro_symbols as macro
from ingest.cn_index_tushare import (
    CN_INDEX_SYMBOLS, CN_INDEX_TS_CODE, FIELDS, MIN_VALID_DAILY_BARS,
    TU_SOURCE, fetch_cn_index_history, normalize_index_daily,
    retain_prior_tushare_bars,
)

AS_OF = dt.date(2026, 11, 4)


def item(sym="000300.SS", date="20261104", *, o=4000, h=4100, l=3900,
         c=4050, vol=41918449.87):
    return {
        "ts_code": sym, "trade_date": date,
        "open": o, "high": h, "low": l, "close": c,
        "vol": vol, "amount": 120000.0,
    }


def rows(sym="000300.SS", n=MIN_VALID_DAILY_BARS + 1):
    start = AS_OF - dt.timedelta(days=n-1)
    return [
        item(sym=sym, date=(start+dt.timedelta(days=i)).strftime("%Y%m%d"))
        for i in range(n)
    ]


class FakeFrame:
    def __init__(self, result):
        self.result = result

    def to_dict(self, orientation):
        assert orientation == "records"
        return self.result


def test_exact_indices_and_native_identities_only():
    assert CN_INDEX_SYMBOLS == {"000300.SS", "000905.SS", "399006.SZ"}
    assert CN_INDEX_TS_CODE == {
        "000300.SS": "000300.SH",
        "000905.SS": "000905.SH",
        "399006.SZ": "399006.SZ",
    }
    assert CN_INDEX_SYMBOLS.issubset(macro.ohlc_symbols())
    assert not CN_INDEX_SYMBOLS.intersection(macro.yahoo_symbols())


@pytest.mark.parametrize("sym", sorted(CN_INDEX_SYMBOLS))
def test_source_integration_calls_only_macro_owned_index_daily(sym):
    calls = []

    def fake_query(*args, **kwargs):
        calls.append((args, kwargs))
        return FakeFrame(rows(sym=sym))

    got = fetch_cn_index_history(sym, query=fake_query, as_of=AS_OF)
    assert len(got) == MIN_VALID_DAILY_BARS + 1
    assert got[0][0] < got[-1][0] == "2026-11-04"
    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args == ("index_daily",)
    assert kwargs == {
        "ts_code": CN_INDEX_TS_CODE[sym],
        "start_date": "20000101",
        "end_date": "20261104",
        "fields": FIELDS,
        "_retries": 0,
    }


@pytest.mark.parametrize("sym", sorted(CN_INDEX_SYMBOLS))
def test_filter_prelaunch_zero_and_malformed_ohlc_without_inventing_bars(sym):
    # Keep the qualified remainder above the hard 1,000-daily-bar publication floor.
    candidate = rows(sym=sym, n=MIN_VALID_DAILY_BARS + 4)
    candidate[:3] = [
        item(sym=sym, date="20020101", o=0, h=0, l=0, c=0, vol=0),
        item(sym=sym, date="20020102", o=100, h=90, l=80, c=95),
        item(sym=sym, date="20020103", o=100, h=120, l=90, c=110, vol=-1),
    ]
    got = normalize_index_daily(sym, candidate, as_of=AS_OF)
    assert len(got) == MIN_VALID_DAILY_BARS+1
    assert got[0][0] == (AS_OF-dt.timedelta(days=MIN_VALID_DAILY_BARS)).isoformat()


@pytest.mark.parametrize(("field", "bad"), [
    ("open", None), ("high", float("nan")), ("low", 0),
    ("close", float("inf")), ("open", True), ("vol", -1),
    ("vol", float("nan")), ("open", "not-a-number"),
    ("high", 3999), ("low", 4051),
])
def test_each_invalid_provider_price_or_volume_row_is_excluded(field, bad):
    candidate = rows()
    candidate[0][field] = bad
    got = normalize_index_daily("000300.SS", candidate, as_of=AS_OF)
    assert len(got) == MIN_VALID_DAILY_BARS
    assert got[0][0] == (AS_OF-dt.timedelta(days=MIN_VALID_DAILY_BARS-1)).isoformat()


def test_volume_converts_tushare_lots_to_integer_shares():
    got = normalize_index_daily(
        "399006.SZ", [item(sym="399006.SZ")], as_of=AS_OF, min_bars=1,
    )
    assert got == [["2026-11-04", 4000, 4100, 3900, 4050, 4191844987]]


def test_decline_foreign_ticker_even_if_one_row_masquerades_in_valid_series():
    candidate = rows()
    candidate[5]["ts_code"] = "510300.SS"  # ETF NAV must never become CSI 300
    assert normalize_index_daily("000300.SS", candidate, as_of=AS_OF) == []


def test_conflicting_duplicate_date_refuses_entire_response():
    candidate = rows()
    duplicate = dict(candidate[-1], close=4060)
    candidate.append(duplicate)
    assert normalize_index_daily("000300.SS", candidate, as_of=AS_OF) == []


def test_identical_duplicate_date_is_deduplicated():
    candidate = rows()
    candidate.append(dict(candidate[-1]))
    assert len(normalize_index_daily("000300.SS", candidate, as_of=AS_OF)) == MIN_VALID_DAILY_BARS+1


@pytest.mark.parametrize("date", ["20010229", "20AA1104", "20261105x", True, "2026-11-04"])
def test_reject_invalid_dates(date):
    candidate = rows()
    candidate[0]["trade_date"] = date
    got = normalize_index_daily("000300.SS", candidate, as_of=AS_OF)
    assert len(got) == MIN_VALID_DAILY_BARS


@pytest.mark.parametrize("future_date", ["20261105", "20261201"])
def test_reject_future_and_stale_series(future_date):
    future = rows()
    future[0]["trade_date"] = future_date
    assert len(normalize_index_daily("000300.SS", future, as_of=AS_OF)) == MIN_VALID_DAILY_BARS
    assert normalize_index_daily(
        "000300.SS", [item(date="20260901")], as_of=AS_OF, min_bars=1,
    ) == []


@pytest.mark.parametrize("valid_count", [MIN_VALID_DAILY_BARS - 1, MIN_VALID_DAILY_BARS])
def test_provider_rows_after_requested_end_date_cannot_publish_or_meet_depth(valid_count):
    candidate = rows(n=valid_count) + [
        item(date=(AS_OF + dt.timedelta(days=1)).strftime("%Y%m%d")),
    ]

    def query(endpoint, **kwargs):
        assert endpoint == "index_daily"
        assert kwargs["end_date"] == AS_OF.strftime("%Y%m%d")
        return FakeFrame(candidate)

    got = fetch_cn_index_history("000300.SS", query=query, as_of=AS_OF)
    if valid_count < MIN_VALID_DAILY_BARS:
        assert got == []  # The rejected future candle cannot satisfy the floor.
    else:
        assert len(got) == valid_count
        assert got[-1][0] == AS_OF.isoformat()
        assert all(row[0] <= AS_OF.isoformat() for row in got)


def test_reject_downgraded_history_depth_and_missing_provider():
    assert normalize_index_daily("000905.SS", rows(sym="000905.SS", n=999), as_of=AS_OF) == []
    assert fetch_cn_index_history("000905.SS", query=lambda *a, **k: None, as_of=AS_OF) == []


def test_unsupported_symbol_never_calls_vendor():
    def fail(*a, **kw):
        raise AssertionError("vendor should not be called")
    for symbol in ("000001.SS", "^GSPC", "510300.SS"):
        assert fetch_cn_index_history(symbol, query=fail, as_of=AS_OF) == []


def test_prior_yahoo_or_etf_history_is_not_mixed_with_tushare(tmp_path):
    p = tmp_path / "000300.SS.json"
    p.write_text(json.dumps({"src": "yahoo", "bars": [["1997-01-01", 1, 2, 1, 1, 100]]}))
    new = normalize_index_daily("000300.SS", rows(), as_of=AS_OF)
    assert retain_prior_tushare_bars(p, new, is_valid_bar=macro._valid_deep_bar) == new


def test_prior_tushare_valid_dates_survive_and_overlap_refreshes(tmp_path):
    p = tmp_path / "000300.SS.json"
    full = normalize_index_daily("000300.SS", rows(), as_of=AS_OF)
    older = ["1999-01-04", 10, 11, 9, 10, 100]
    stale = dict(src=TU_SOURCE, bars=[older]+full)
    stale["bars"][-1] = ["2026-11-04", 10, 11, 9, 10, 100]
    stale["bars"].append(["2000-02-30", 1, 1, 1, 1, 2])  # invalid
    p.write_text(json.dumps(stale))
    merged = retain_prior_tushare_bars(p, full, is_valid_bar=macro._valid_deep_bar)
    assert merged[0] == older
    assert merged[-1] == full[-1]
    assert len(merged) == len(full)+1
    assert len({b[0] for b in merged}) == len(merged)


def run_macro(monkeypatch, tmp_path, sym, fetched):
    monkeypatch.setattr("sys.argv", ["build_macro_symbols.py", "--out", str(tmp_path), "--no-quotes"])
    monkeypatch.delenv("TERMINAL_MANIFEST", raising=False)
    monkeypatch.setattr(macro, "ohlc_symbols", lambda: [sym])
    monkeypatch.setattr(macro.time, "sleep", lambda _seconds: None)
    with patch("ingest.build_macro_symbols.fetch_cn_index_history", return_value=fetched) as fetch:
        with patch("ingest.build_macro_symbols.fetch_ohlc", side_effect=AssertionError("must not use Yahoo")):
            assert macro.main() == 0
        fetch.assert_called_once_with(sym)


def test_real_writer_publishes_index_points_with_source_and_units(tmp_path, monkeypatch):
    sym = "000300.SS"
    p = tmp_path / (sym+".json")
    old = {"t": sym, "o": 1, "src": "yahoo", "bars": [
        ["2021-11-03", 1, 2, 1, 1, 100],
    ]}
    p.write_text(json.dumps(old))
    qualified = normalize_index_daily(sym, rows(), as_of=AS_OF)
    run_macro(monkeypatch, tmp_path, sym, qualified)
    published = json.loads(p.read_text())
    assert published["src"] == "tushare"
    assert published["source_endpoint"] == "index_daily"
    assert published["volume_unit"] == "shares"
    assert published["volume_scope"] == "index_constituents"
    assert published["bar_quality"] == "real_ohlc"
    assert len(published["bars"]) == len(qualified)
    assert published["bars"][0] == qualified[0]
    assert published["bars"][-1] == qualified[-1]
    assert not list(tmp_path.glob("*.macro.tmp"))


@pytest.mark.parametrize("sym", sorted(CN_INDEX_SYMBOLS))
def test_writer_preserves_file_unchanged_when_no_access_or_bad_response(tmp_path, monkeypatch, sym):
    path = tmp_path / (sym+".json")
    before = json.dumps({"t": sym, "src": "yahoo", "bars": [
        ["2021-11-03", 1, 2, 1, 1, 100],
    ]}).encode()
    path.write_bytes(before)
    run_macro(monkeypatch, tmp_path, sym, [])
    assert path.read_bytes() == before


def test_missing_macro_client_cannot_accidentally_fetch_anything(monkeypatch):
    import ingest.cn_index_tushare as x
    x._macro_tushare_client.cache_clear()
    monkeypatch.setenv("MACRO_REPO", "/definitely-not-a-real-macro-repo")
    assert fetch_cn_index_history("000905.SS", as_of=AS_OF) == []
    x._macro_tushare_client.cache_clear()

@pytest.mark.parametrize("sym", sorted(CN_INDEX_SYMBOLS))
@pytest.mark.parametrize(("price", "expected"), [
    (0.0000001, []),
    (0.00000049, []),
    (0.00000051, [["2026-11-04", 0.000001, 0.000001, 0.000001, 0.000001, 0]]),
])
def test_serialized_prices_remain_positive_for_each_native_index(sym, price, expected):
    candidate = [item(sym=sym, o=price, h=price, l=price, c=price, vol=0)]
    assert normalize_index_daily(sym, candidate, as_of=AS_OF, min_bars=1) == expected


@pytest.mark.parametrize("valid_count", [MIN_VALID_DAILY_BARS - 1, MIN_VALID_DAILY_BARS])
def test_serialized_zero_cannot_satisfy_history_depth(valid_count):
    candidate = rows(n=valid_count)
    earlier = (AS_OF - dt.timedelta(days=valid_count)).strftime("%Y%m%d")
    candidate.append(item(date=earlier, o=0.0000001, h=0.0000001, l=0.0000001, c=0.0000001))
    got = fetch_cn_index_history(
        "000300.SS", query=lambda *args, **kwargs: FakeFrame(candidate), as_of=AS_OF,
    )
    if valid_count < MIN_VALID_DAILY_BARS:
        assert got == []
    else:
        assert len(got) == valid_count
        assert all(macro._valid_deep_bar(bar) for bar in got)


@pytest.mark.parametrize("invalid_first", [False, True])
def test_serialized_zero_never_claims_an_admitted_duplicate_date(invalid_first):
    invalid = item(o=0.0000001, h=0.0000001, l=0.0000001, c=0.0000001)
    valid = item()
    candidate = [invalid, valid] if invalid_first else [valid, invalid]
    assert normalize_index_daily("000300.SS", candidate, as_of=AS_OF, min_bars=1) == [
        ["2026-11-04", 4000, 4100, 3900, 4050, 4191844987],
    ]


@pytest.mark.parametrize("prior", [None, "unreadable", "yahoo", "tushare"])
def test_writer_keeps_prior_when_serialized_zero_would_complete_depth(tmp_path, monkeypatch, prior):
    sym = "000300.SS"
    path = tmp_path / (sym + ".json")
    before = None
    if prior is not None:
        before = b"not valid JSON" if prior == "unreadable" else json.dumps({
            "t": sym, "src": prior, "bars": [["2021-11-03", 1, 2, 1, 1, 100]],
        }).encode()
        path.write_bytes(before)
    candidate = rows(n=MIN_VALID_DAILY_BARS - 1)
    candidate.append(item(date="20000103", o=0.0000001, h=0.0000001, l=0.0000001, c=0.0000001))
    fetched = normalize_index_daily(sym, candidate, as_of=AS_OF)
    run_macro(monkeypatch, tmp_path, sym, fetched)
    if before is None:
        assert not path.exists()
    else:
        assert path.read_bytes() == before

def test_serialized_low_cannot_be_zero_when_other_prices_remain_valid():
    candidate = [item(o=1, h=2, l=0.0000001, c=1.5)]
    assert normalize_index_daily("000300.SS", candidate, as_of=AS_OF, min_bars=1) == []
