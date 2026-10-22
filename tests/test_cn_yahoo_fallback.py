"""Financial-semantic falsifiers for the explicit mainland Yahoo coverage extension."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import pytest
from ingest.cn_yahoo_fallback import CACHE_SCHEMA, build_fund, qualify_source
from ingest.collect_cn_yahoo import collect, select_symbols

SYMBOL = "600519.SS"


def payload(*, symbol=SYMBOL, acquired="2026-10-22T06:00:00Z", revenue=40, duration="3M", currency="CNY"):
    observations = {
        "annualTotalRevenue": ("2025-12-31", "12M", 120),
        "annualNetIncome": ("2025-12-31", "12M", 60),
        "quarterlyTotalRevenue": ("2026-06-30", duration, revenue),
        "quarterlyNetIncome": ("2026-06-30", duration, 20),
        "quarterlyTotalAssets": ("2026-06-30", "3M", 200),
    }
    body = json.dumps({"timeseries": {"result": [
        {"meta": {"symbol": [symbol], "type": [kind]},
         kind: [{"asOfDate": end, "periodType": period, "currencyCode": currency,
                 "reportedValue": {"raw": value}}]}
        for kind, (end, period, value) in observations.items()], "error": None}})
    return {"schema": CACHE_SCHEMA, "ticker": symbol, "fetched_at": acquired,
        "info": {"symbol": symbol, "quoteType": "EQUITY", "currency": "CNY", "financialCurrency": "CNY",
                 "sector": "Consumer Defensive", "industry": "Beverages", "marketCap": 1000},
        "timeseries_body": body, "timeseries_sha256": hashlib.sha256(body.encode()).hexdigest()}


def raw(data=None):
    return json.dumps(data or payload(), separators=(",", ":")).encode()


def previous():
    def block(ends, revenue, eps):
        return {"periods": ends, "period_end": ends,
                "income": {"revenue": revenue, "net_income": [30] * len(ends), "eps_basic": eps},
                "balance": {"assets": [180] * len(ends)}, "cashflow": {"cfo": [25] * len(ends)}}
    return {"schema": "mastermind.fund/v1", "ticker": SYMBOL, "stmt_currency": "CNY", "quote_currency": "CNY",
            "src": {"statements": "tushare"}, "profile": {}, "stats": {},
            "statements": {
                "annual": block(["2024-12-31", "2025-12-31"], [100, 110], [4, 5]),
                "quarterly": block(["2025-06-30", "2025-09-30", "2026-03-31"], [50, 80, 30], [2, 3, 1])},
            "earnings": {"q": [], "fy": []}}


def test_new_three_month_period_keeps_value_without_differencing_or_borrowing():
    fund = build_fund(raw(), SYMBOL, previous())
    q = fund["statements"]["quarterly"]
    assert q["period_end"][-1] == "2026-06-30"
    assert q["periods"] == ["H1 2025", "9M 2025", "Q1 2026", "Q2 2026"]
    assert q["income"]["revenue"] == [50, 80, 30, 40]
    assert q["income"]["eps_basic"][-1] is None
    assert q["cashflow"]["cfo"][-1] is None
    assert q["period_duration_months"] == [6, 9, 3, 3]
    assert q["period_start"][-1] == "2026-04-01"
    assert q["flow_basis"] == "mixed_period"
    assert q["period_provenance"]["income"][-1]["scope"] == "vendor_reported_unverified"
    assert fund["earnings"]["q"][-1]["eps_a"] is None
    assert fund["earnings"]["q"][-1]["rev_a"] == 40
    assert fund["earnings"]["q"][-1]["report_date"] is None


def test_overlap_keeps_whole_legacy_period_values_and_unknown_original_clock():
    fund = build_fund(raw(), SYMBOL, previous())
    annual = fund["statements"]["annual"]
    assert annual["income"]["revenue"] == [100, 110]  # incoming 120 never restates Tushare
    assert annual["period_provenance"]["income"][-1]["acquired_at"] is None
    assert "cache_fetched_at" not in fund["src"]
    assert annual["src_by_period"] == ["tushare", "tushare"]


def test_rebuild_keeps_original_yahoo_observation_receipt_and_all_metadata():
    first = build_fund(raw(), SYMBOL, previous())
    second = build_fund(raw(payload(acquired="2026-10-23T06:00:00Z", revenue=45)), SYMBOL, first)
    assert second["statements"] == first["statements"]
    assert second["earnings"] == first["earnings"]
    assert second["statements"]["quarterly"]["period_provenance"]["income"][-1]["acquired_at"] == "2026-10-22T06:00:00Z"
    assert second["data_freshness"]["added_periods"] == {"annual": [], "quarterly": []}


@pytest.mark.parametrize("change", ["ticker", "currency", "hash", "future", "no_date"])
def test_invalid_identity_or_receipt_is_rejected(change):
    data = payload()
    if change == "ticker": data["ticker"] = "000858.SZ"
    if change == "currency": data["info"]["financialCurrency"] = "USD"
    if change == "hash": data["timeseries_sha256"] = "0" * 64
    if change == "future": data["fetched_at"] = "2020-01-01T00:00:00Z"
    if change == "no_date": data.pop("fetched_at")
    with pytest.raises(ValueError):
        qualify_source(raw(data), SYMBOL)


def test_six_month_data_is_not_admitted_as_a_quarter():
    _, observations, _ = qualify_source(raw(payload(duration="6M")), SYMBOL)
    assert observations["quarterly"] == {}
    assert observations["annual"]  # independent qualified annual observations survive


def test_mismatched_series_identity_fails_even_with_correct_outer_ticker():
    data = payload()
    series = json.loads(data["timeseries_body"])
    series["timeseries"]["result"][0]["meta"]["symbol"] = ["000858.SZ"]
    data["timeseries_body"] = json.dumps(series)
    data["timeseries_sha256"] = hashlib.sha256(data["timeseries_body"].encode()).hexdigest()
    with pytest.raises(ValueError, match="series listing"):
        qualify_source(raw(data), SYMBOL)


def test_incomplete_retained_duration_metadata_cannot_be_reinterpreted():
    first = build_fund(raw(), SYMBOL, previous())
    del first["statements"]["quarterly"]["period_duration_months"]
    with pytest.raises(ValueError, match="metadata incomplete"):
        build_fund(raw(), SYMBOL, first)


def test_missing_previous_builds_a_complete_contract_from_qualified_source():
    fund = build_fund(raw(), SYMBOL)
    assert fund["ticker"] == SYMBOL and fund["stmt_currency"] == "CNY"
    assert fund["statements"]["quarterly"]["income"]["revenue"] == [40]
    assert fund["src"]["statements"] == "yahoo_timeseries"


def test_currency_and_source_transition_cannot_overwrite_previous():
    old = previous()
    old["stmt_currency"] = "USD"
    with pytest.raises(ValueError, match="currency"):
        build_fund(raw(), SYMBOL, old)
    old = previous()
    old["src"]["statements"] = "unknown_vendor"
    with pytest.raises(ValueError, match="convention"):
        build_fund(raw(), SYMBOL, old)


def test_collector_keeps_immutable_source_and_failed_attempt_separate(tmp_path):
    counts = collect([SYMBOL], tmp_path, delay=(0, 0), fetcher=lambda symbol: payload())
    assert counts["qualified"] == 1
    path = tmp_path / (SYMBOL + ".json")
    before = path.read_bytes()
    receipt = hashlib.sha256(before).hexdigest()
    assert (tmp_path / "_receipts" / SYMBOL / (receipt + ".json")).read_bytes() == before
    def failed(symbol): raise TimeoutError("private network details")
    counts = collect([SYMBOL], tmp_path, stale_days=0, delay=(0, 0), fetcher=failed)
    assert counts["source_error"] == 1 and path.read_bytes() == before
    attempt = (tmp_path / "_attempts" / (SYMBOL + ".json")).read_text()
    assert "private network details" not in attempt and "source_error" in attempt


def test_only_exact_mainland_symbols_are_selected():
    assert select_symbols({"symbols": {SYMBOL: {}, "000858.SZ": {}, "430047.BJ": {}, "0700.HK": {},
                                     "RY.TO": {}, "^SSEC": {}, "600519.SH": {}}}) == ["000858.SZ", "430047.BJ", SYMBOL]


def test_bank_family_remains_separate_from_provider_identity():
    data = payload()
    data["info"].update(sector="Financial Services", industry="Banks - Regional")
    fund = build_fund(raw(data), SYMBOL)
    q = fund["statements"]["quarterly"]
    assert q["source_family_by_period"] == ["bank"]
    assert q["src_by_period"] == ["yahoo_timeseries"]
