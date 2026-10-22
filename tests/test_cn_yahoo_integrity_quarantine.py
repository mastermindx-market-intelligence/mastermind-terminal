"""Falsifiers for the versioned mainland Yahoo provider-period integrity quarantine.

The recorded sample is 001399.SZ FY2024, whose own vendor fundamentals-timeseries response
reports gross_profit equal to revenue rather than revenue minus COGS, TotalAssets equal to the
non-current total rather than current plus non-current, and TotalLiabilitiesNetMinorityInterest
equal to the non-current total rather than current plus non-current. Four further (symbol, period)
pairs were censused as failing the same three identities; their exact vendor values are not
reproduced here, so those four are exercised as contradicting periods of the same shape.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest
from ingest.cn_yahoo_fallback import (CACHE_SCHEMA, FIELDS, IDENTITY_RULES, PROVIDER,
                                       QUARANTINE_FAMILY, QUARANTINE_KEY, QUARANTINE_ORIGIN,
                                       QUARANTINE_POLICY, build_fund,
                                       evaluate_provider_period, extend_statements,
                                       quarantine_provider_period, quarantined_periods,
                                       qualify_source, rebuild_earnings)
from ingest.cn_yahoo_integrity_quarantine import bound_receipts, repair_document, validate_quarantine_scope
from ingest.regional_financial_projection import FIELD, materialize_regional_fund, wrap_regional_financials

SAMPLE = "001399.SZ"
RECORDED = [("001233.SZ", "2022-12-31"), ("001399.SZ", "2024-12-31"), ("301531.SZ", "2024-12-31"),
            ("688797.SS", "2024-12-31"), ("688836.SS", "2024-12-31")]
# The raw FY2024 fundamentals-timeseries response, exactly as the parent recorded it.
BAD_2024 = {"TotalRevenue": 40281827700, "CostOfRevenue": 32812661619.88, "GrossProfit": 40281827700,
            "OperatingExpense": 0, "OperatingIncome": 40281827700, "TotalAssets": 100725798900,
            "CurrentAssets": 43492543164.85, "TotalNonCurrentAssets": 100725798900,
            "TotalLiabilitiesNetMinorityInterest": 69287831900, "CurrentLiabilities": 43827364872.71,
            "TotalNonCurrentLiabilitiesNetMinorityInterest": 69287831900,
            "OperatingCashFlow": 10996105610.95, "CapitalExpenditure": -2488516103.28,
            "FreeCashFlow": 10996105600}
# FY2025 and the current interim are internally consistent and must stay usable.
GOOD_2025 = {"TotalRevenue": 45000000000, "CostOfRevenue": 35000000000, "GrossProfit": 10000000000,
             "OperatingExpense": 5000000000, "OperatingIncome": 5000000000, "TotalAssets": 110000000000,
             "CurrentAssets": 46000000000, "TotalNonCurrentAssets": 64000000000,
             "TotalLiabilitiesNetMinorityInterest": 70000000000, "CurrentLiabilities": 44000000000,
             "TotalNonCurrentLiabilitiesNetMinorityInterest": 26000000000, "NetIncome": 3800000000,
             "BasicEPS": 2.5, "OperatingCashFlow": 6000000000, "CapitalExpenditure": -1200000000,
             "FreeCashFlow": 4800000000}
GOOD_INTERIM = {"TotalRevenue": 12000000000, "NetIncome": 900000000, "TotalAssets": 115000000000,
                "CurrentAssets": 50000000000, "TotalNonCurrentAssets": 65000000000,
                "TotalLiabilitiesNetMinorityInterest": 72000000000, "CurrentLiabilities": 46000000000,
                "TotalNonCurrentLiabilitiesNetMinorityInterest": 26000000000}
ACQUIRED = "2026-10-22T06:00:00Z"
SOURCE_FIELD = {source: (section, field)
                for section, fields in FIELDS.items() for field, source in fields.items()}


def annual_series(bad_period="2024-12-31", eps=None):
    """FY2024 in the recorded contradictory shape, plus a consistent FY2025.

    ``eps`` adds a vendor EPS observation for the contradicted period, which the recorded
    response did not carry; it exists so a correction can be shown to withhold a published
    earnings actual and not only a revenue figure.
    """
    rows = {"annualBasicEPS": [(bad_period, "12M", eps)]} if eps else {}
    for source, value in BAD_2024.items():
        rows.setdefault("annual" + source, []).append((bad_period, "12M", value))
    for source, value in GOOD_2025.items():
        rows.setdefault("annual" + source, []).append(("2025-12-31", "12M", value))
    return rows


def consistent_period(period="2024-12-31", overrides=None):
    """One annual period that satisfies all three identities."""
    series = {"annual" + source: [(period, "12M", value)] for source, value in GOOD_2025.items()}
    series.update({"annual" + source: [(period, "12M", value)] for source, value in (overrides or {}).items()})
    return series


def payload(*, symbol=SAMPLE, acquired=ACQUIRED, sector="Industrials", industry="Auto Manufacturers",
            annual=None, interim=None, drop=()):
    annual = annual_series() if annual is None else annual
    interim = GOOD_INTERIM if interim is None else interim
    series = {**annual, **{"quarterly" + source: [("2026-06-30", "3M", value)]
                           for source, value in interim.items()}}
    series = {kind: rows for kind, rows in series.items() if not any(kind.startswith(prefix) for prefix in drop)}
    body = json.dumps({"timeseries": {"result": [
        {"meta": {"symbol": [symbol], "type": [kind]},
         kind: [{"asOfDate": end, "periodType": period, "currencyCode": "CNY",
                 "reportedValue": {"raw": value}} for end, period, value in rows]}
        for kind, rows in sorted(series.items())], "error": None}})
    return {"schema": CACHE_SCHEMA, "ticker": symbol, "fetched_at": acquired,
            "info": {"symbol": symbol, "quoteType": "EQUITY", "currency": "CNY",
                     "financialCurrency": "CNY", "sector": sector, "industry": industry, "marketCap": 1000},
            "timeseries_body": body, "timeseries_sha256": hashlib.sha256(body.encode()).hexdigest()}


def raw(data=None):
    return json.dumps(data or payload(), separators=(",", ":")).encode()


def retained_previous(symbol=SAMPLE):
    """Prior Tushare history: retained periods must survive a Yahoo-only correction."""
    def block(ends, revenue, eps):
        return {"periods": ends, "period_end": ends,
                "income": {"revenue": revenue, "net_income": [30] * len(ends), "eps_basic": eps},
                "balance": {"assets": [180] * len(ends)}, "cashflow": {"cfo": [25] * len(ends)}}
    return {"schema": "mastermind.fund/v1", "ticker": symbol, "stmt_currency": "CNY", "quote_currency": "CNY",
            "src": {"statements": "tushare"}, "profile": {}, "stats": {},
            "statements": {"annual": block(["2021-12-31", "2022-12-31", "2023-12-31"], [90, 95, 100], [3, 3, 4]),
                           "quarterly": block(["2026-03-31"], [30], [1])},
            "earnings": {"q": [{"period": "Q1 2026", "end": "2026-03-31", "eps_a": 1, "rev_a": 30,
                                "eps_e": 1.1, "rev_e": 31, "surp_pct": None}],
                         "fy": [{"period": "FY2023", "end": "2023-12-31", "eps_a": 4, "rev_a": 100,
                                 "eps_e": 4.2, "rev_e": 105, "surp_pct": None}]}}


def published(symbol=SAMPLE, previous=None, **kwargs):
    """The already-published artifact and the exact acquired bytes its provenance names."""
    data = payload(symbol=symbol, **kwargs)
    body = json.dumps(data, separators=(",", ":")).encode()
    fund = build_fund(body, symbol, previous)
    artifact = wrap_regional_financials(fund, previous)
    return artifact, hashlib.sha256(body).hexdigest(), body


def before_the_policy(artifact, symbol, body, previous=None):
    """Model the artifact exactly as it was published before this policy existed.

    The contradictory figures are restored from the acquisition's own qualified observations and
    the withdrawal metadata is removed, so a scoped repair has a real predecessor to correct.
    """
    legacy = copy.deepcopy(materialize_regional_fund(copy.deepcopy(artifact), symbol))
    observations = qualify_source(body, symbol)[1]
    for basis in ("annual", "quarterly"):
        block = (legacy["statements"] or {}).get(basis)
        if not block:
            continue
        receipts = block["period_provenance"]
        for index, end in enumerate(block["period_end"]):
            if (receipts["income"][index].get(QUARANTINE_KEY) or {}).get("policy") != QUARANTINE_POLICY:
                continue
            withdrawn = observations[basis][end]
            for section, fields in FIELDS.items():
                for field in fields:
                    if field in (withdrawn.get(section) or {}):
                        block[section][field][index] = withdrawn[section][field]
                receipts[section][index].pop(QUARANTINE_KEY, None)
    legacy["earnings"] = rebuild_earnings(legacy["statements"], legacy["earnings"])
    return wrap_regional_financials(legacy, previous)


def retain_receipts(identity, body, root, symbol=SAMPLE):
    path = Path(root) / symbol / (identity + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return root


def column(series, family):
    """One provider-period column in the internal shape, keyed by internal field names."""
    blocks = {}
    for kind, rows in series.items():
        source = kind.replace("annual", "", 1).replace("quarterly", "", 1)
        if source in SOURCE_FIELD:
            section, field = SOURCE_FIELD[source]
            blocks.setdefault(section, {})[field] = rows[0][2]
    return {"meta": {"source_family_by_period": family}, "blocks": blocks,
            "provenance": {section: {"origin": QUARANTINE_ORIGIN, "provider": PROVIDER,
                                     "raw_input_sha256": "a" * 64, "source_period_type": "12M",
                                     "acquired_at": ACQUIRED, "scope": "vendor_reported_unverified",
                                     "publication_at": None} for section in FIELDS}}


def findings(series, family=QUARANTINE_FAMILY):
    return {item["rule"]: item for item in evaluate_provider_period(column(series, family))}


# --- the recorded anomaly ------------------------------------------------------------------

def test_recorded_sample_fails_exactly_the_three_established_identities():
    observed = qualify_source(raw(), SAMPLE)[1]["annual"]["2024-12-31"]
    assert observed["income"] == {"revenue": 40281827700, "cogs": 32812661619.88,
                                  "gross_profit": 40281827700, "opex": 0, "op_income": 40281827700}
    assert observed["balance"] == {"assets": 100725798900, "assets_st": 43492543164.85,
                                   "assets_lt": 100725798900, "liabilities": 69287831900,
                                   "liab_st": 43827364872.71, "liab_lt": 69287831900}
    result = findings(annual_series())
    assert set(result) == {rule[0] for rule in IDENTITY_RULES}
    assert all(item["status"] == "contradicted" for item in result.values()), result
    assert result["gross_profit_equals_revenue_minus_cogs"]["residual"] == pytest.approx(32812661619.88)
    assert result["assets_equal_current_plus_noncurrent"]["residual"] == pytest.approx(-43492543164.85)
    assert result["liabilities_equal_current_plus_noncurrent"]["residual"] == pytest.approx(-43827364872.71)
    assert result["gross_profit_equals_revenue_minus_cogs"]["tolerance"] == 40281827.7
    # The cash-flow figures are left alone: their definition and sign are unresolved, and a
    # fabricated cash-flow identity would restate a period only the vendor's own totals break.
    assert all("cash" not in rule and "flow" not in rule for rule in result)


@pytest.mark.parametrize("rule,field,source", [
    ("gross_profit_equals_revenue_minus_cogs", "gross_profit", "annualGrossProfit"),
    ("assets_equal_current_plus_noncurrent", "assets", "annualTotalAssets"),
    ("liabilities_equal_current_plus_noncurrent", "liabilities",
     "annualTotalLiabilitiesNetMinorityInterest")])
def test_each_identity_rule_catches_only_its_own_contradiction(rule, field, source):
    consistent = consistent_period()
    assert all(item["status"] == "pass" for item in findings(consistent).values())
    broken = dict(consistent, **{source: [("2024-12-31", "12M", consistent[source][0][2] * 10)]})
    result = findings(broken)
    assert result[rule]["status"] == "contradicted", result
    assert all(item["status"] == "pass" for name, item in result.items() if name != rule)
    assert field in result[rule]["operands"]


def test_tolerance_boundary_is_one_currency_unit_or_one_thousandth():
    tolerance = 0.001 * 45000000000  # 45,000,000 at this magnitude
    for delta, expected in ((tolerance, "pass"), (-tolerance, "pass"),
                            (tolerance + 1, "contradicted"), (-tolerance - 1, "contradicted")):
        series = consistent_period(overrides={"GrossProfit": 10000000000 + delta})
        result = findings(series)["gross_profit_equals_revenue_minus_cogs"]
        assert (result["status"], result["tolerance"]) == (expected, tolerance), delta
    # A small magnitude never invents a sub-unit tolerance.
    tiny = {"annualTotalRevenue": [("2024-12-31", "12M", 2)], "annualCostOfRevenue": [("2024-12-31", "12M", 1)],
            "annualGrossProfit": [("2024-12-31", "12M", 2)], "annualTotalAssets": [("2024-12-31", "12M", 4)],
            "annualCurrentAssets": [("2024-12-31", "12M", 2)],
            "annualTotalNonCurrentAssets": [("2024-12-31", "12M", 2)],
            "annualTotalLiabilitiesNetMinorityInterest": [("2024-12-31", "12M", 3)],
            "annualCurrentLiabilities": [("2024-12-31", "12M", 1)],
            "annualTotalNonCurrentLiabilitiesNetMinorityInterest": [("2024-12-31", "12M", 2)]}
    result = findings(tiny)["gross_profit_equals_revenue_minus_cogs"]
    assert (result["residual"], result["tolerance"], result["status"]) == (1.0, 1.0, "pass")
    result = findings(dict(tiny, annualGrossProfit=[("2024-12-31", "12M", 3)]))["gross_profit_equals_revenue_minus_cogs"]
    assert (result["residual"], result["tolerance"], result["status"]) == (2.0, 1.0, "contradicted")


@pytest.mark.parametrize("absent", ["annualCostOfRevenue", "annualCurrentAssets", "annualCurrentLiabilities",
                                    "annualTotalAssets", "annualTotalLiabilitiesNetMinorityInterest"])
def test_missing_operand_is_not_checked_and_never_a_pass(absent):
    series = {kind: rows for kind, rows in consistent_period().items() if kind != absent}
    result = findings(series)
    for rule, _, fields, _ in IDENTITY_RULES:
        if absent.replace("annual", "") in fields:
            assert result[rule]["status"] == "not_checked", (absent, rule, result[rule])
            assert result[rule]["reason"] == "operand_absent"
    # The same response still qualifies as a source; only the identity is withheld.
    assert qualify_source(raw(payload(annual=series)), SAMPLE)[1]["annual"]["2024-12-31"]


def test_legitimate_zero_operands_withdraw_nothing():
    series = consistent_period(overrides={"OperatingExpense": 0, "StockholdersEquity": 0})
    assert all(item["status"] == "pass" for item in findings(series).values())
    assert quarantine_provider_period(column(series, QUARANTINE_FAMILY)) is None


def test_mixed_sources_families_and_acquisitions_are_never_withdrawn():
    series = annual_series()
    for family in ("bank", "insurer", "financial_services", "other", None):
        result = findings(series, family)
        assert {item["reason"] for item in result.values()} == {"unqualified_source_family"}
        assert quarantine_provider_period(column(series, family)) is None
    retained = column(series, QUARANTINE_FAMILY)
    for receipt in retained["provenance"].values():
        receipt["origin"] = "retained_history"
    assert all(item["status"] == "not_checked" for item in evaluate_provider_period(retained))
    # Two acquisitions of one period cannot establish same-source, same-period units.
    mixed = column(series, QUARANTINE_FAMILY)
    mixed["provenance"]["balance"]["raw_input_sha256"] = "f" * 64
    assert {item["reason"] for item in evaluate_provider_period(mixed)
            if item["status"] == "not_checked"} == {"ambiguous_acquisition"}
    assert quarantine_provider_period(mixed) is None


# --- producer-side withdrawal ---------------------------------------------------------------

@pytest.mark.parametrize("symbol,bad_period", RECORDED)
def test_every_recorded_case_withdraws_and_preserves_the_rest_of_the_history(symbol, bad_period):
    fund = build_fund(raw(payload(symbol=symbol, annual=annual_series(bad_period))), symbol)
    annual = fund["statements"]["annual"]
    assert annual["period_end"] == sorted([bad_period, "2025-12-31"])
    assert quarantined_periods(fund["statements"]) == {"annual": [bad_period]}
    first = annual["period_end"].index(bad_period)
    assert all(series[first] is None
               for section in ("income", "balance", "cashflow")
               for series in annual[section].values() if isinstance(series[first], (int, float)))
    last = annual["period_end"].index("2025-12-31")
    assert annual["income"]["revenue"][last] == 45000000000
    assert annual["income"]["gross_profit"][last] == 10000000000
    assert annual["cashflow"]["cfo"][last] == 6000000000
    assert annual["income"]["eps_basic"][last] == 2.5
    assert annual["periods"] == ["FY" + bad_period[:4], "FY2025"]
    assert annual["period_duration_months"] == [12, 12]
    assert annual["period_start"] == [bad_period[:4] + "-01-01", "2025-01-01"]
    assert annual["comparison_basis"] == ["yahoo_timeseries:industrial:v1"] * 2
    # The receipt that proved faithful ingestion survives the withdrawal unchanged.
    receipt = annual["period_provenance"]["income"][first]
    assert receipt["acquired_at"] == ACQUIRED and len(receipt["raw_input_sha256"]) == 64
    assert receipt[QUARANTINE_KEY]["policy"] == QUARANTINE_POLICY
    assert receipt[QUARANTINE_KEY]["rules"] == sorted(rule[0] for rule in IDENTITY_RULES)
    assert receipt[QUARANTINE_KEY]["withdrawn_observations"] > 0
    assert QUARANTINE_KEY not in annual["period_provenance"]["income"][last]
    # A current interim that never contradicted anything keeps every value.
    assert fund["statements"]["quarterly"]["income"]["revenue"] == [12000000000]
    assert fund["statements"]["quarterly"]["cashflow"]["cfo"] == [None]


def test_retained_tushare_history_is_never_withdrawn_or_relabelled():
    previous = retained_previous()
    fund = build_fund(raw(), SAMPLE, previous)
    annual, quarterly = fund["statements"]["annual"], fund["statements"]["quarterly"]
    assert annual["income"]["revenue"][:3] == [90, 95, 100]
    assert annual["src_by_period"][:3] == ["tushare"] * 3
    assert all(QUARANTINE_KEY not in receipt for receipt in annual["period_provenance"]["income"][:3])
    assert quarterly["income"]["revenue"][0] == 30
    assert fund["earnings"]["fy"][0]["rev_a"] == 90
    assert quarantined_periods(fund["statements"]) == {"annual": ["2024-12-31"]}


def test_eps_actuals_and_growth_are_withheld_while_estimates_keep_their_provenance():
    fund = build_fund(raw(), SAMPLE, retained_previous())
    rows = {row["end"]: row for row in fund["earnings"]["fy"]}
    assert rows["2024-12-31"]["eps_a"] is None and rows["2024-12-31"]["rev_a"] is None
    assert rows["2024-12-31"]["surp_pct"] is None
    assert rows["2025-12-31"]["eps_a"] == 2.5 and rows["2025-12-31"]["rev_a"] == 45000000000
    assert rows["2024-12-31"]["actuals_provenance"][QUARANTINE_KEY]["policy"] == QUARANTINE_POLICY
    assert fund["statements"]["annual"]["income"]["eps_basic"] == [3, 3, 4, None, 2.5]
    # The consumer suppresses a comparison whose operand is null, so no growth survives.
    revenue = fund["statements"]["annual"]["income"]["revenue"]
    index = revenue.index(45000000000)
    assert revenue[index - 1] is None


def test_input_is_never_mutated_and_repeated_refresh_is_idempotent():
    first = build_fund(raw(), SAMPLE, retained_previous())
    snapshot = json.dumps(first, sort_keys=True)
    again = build_fund(raw(payload(acquired="2026-10-23T06:00:00Z")), SAMPLE, first)
    assert json.dumps(first, sort_keys=True) == snapshot
    assert again["statements"] == first["statements"]
    assert again["earnings"] == first["earnings"]
    assert again["statements"]["annual"]["period_provenance"]["income"][3]["acquired_at"] == ACQUIRED
    assert again["statements"]["annual"]["income"]["revenue"][3:] == [None, 45000000000]
    assert again["data_freshness"]["added_periods"] == {"annual": [], "quarterly": []}
    assert build_fund(raw(), SAMPLE, again)["statements"] == first["statements"]


def test_a_later_acquisition_cannot_relabel_or_restore_a_withdrawn_period():
    first = build_fund(raw(), SAMPLE, retained_previous())
    # A later response that looks self-consistent for FY2024 must not reinstate those figures.
    revised = {kind: ([("2024-12-31", "12M", GOOD_2025[kind[6:]])]
                      if kind[6:] in BAD_2024 else rows)
               for kind, rows in annual_series().items()}
    later = build_fund(raw(payload(acquired="2026-10-23T06:00:00Z", annual=revised)), SAMPLE, first)
    annual = later["statements"]["annual"]
    assert annual["income"]["gross_profit"][3] is None
    assert annual["income"]["gross_profit"][4] == 10000000000
    assert QUARANTINE_KEY in annual["period_provenance"]["income"][3]
    assert annual["period_provenance"]["income"][3]["acquired_at"] == ACQUIRED
    assert annual["source_family_by_period"][3] == QUARANTINE_FAMILY
    assert later["statements"]["annual"]["period_start"] == first["statements"]["annual"]["period_start"]


# --- the receipt-bound scoped repair -------------------------------------------------------

def test_scoped_repair_withdraws_only_the_contradicted_period_and_keeps_the_base(tmp_path):
    previous = retained_previous()
    artifact, identity, body = published(previous=previous, annual=annual_series(eps=1.9))
    retain_receipts(identity, body, tmp_path)
    artifact = before_the_policy(artifact, SAMPLE, body, previous)
    stale = materialize_regional_fund(artifact, SAMPLE)
    assert stale["statements"]["annual"]["income"]["revenue"][3] == 40281827700
    assert {row["end"]: row["eps_a"] for row in stale["earnings"]["fy"]}["2024-12-31"] == 1.9
    candidate, report = repair_document(artifact, SAMPLE, tmp_path)
    assert report["marked_periods"] == ["annual:2024-12-31"]
    assert report["withdrawn_periods"] == {
        "annual:2024-12-31": {"rules": sorted(rule[0] for rule in IDENTITY_RULES),
                              "withdrawn_observations": report["withdrawn_periods"]["annual:2024-12-31"]["withdrawn_observations"]}}
    assert report["bound_receipts"] == 3 and report["withdrawn_observations"] >= 14
    # The compatibility base and the legacy outer view are retained unchanged.
    assert candidate[FIELD]["base_sha256"] == artifact[FIELD]["base_sha256"]
    assert {key: artifact.get(key) for key in ("statements", "earnings", "src", "data_freshness")} == \
           {key: candidate.get(key) for key in ("statements", "earnings", "src", "data_freshness")}
    assert artifact["statements"]["annual"]["income"]["revenue"] == [90, 95, 100]
    selected = materialize_regional_fund(candidate, SAMPLE)
    annual = selected["statements"]["annual"]
    assert annual["period_end"] == ["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"]
    assert annual["income"]["revenue"] == [90, 95, 100, None, 45000000000]
    assert annual["income"]["gross_profit"] == [None, None, None, None, 10000000000]
    assert annual["period_provenance"]["income"][3]["acquired_at"] == ACQUIRED
    assert annual["period_provenance"]["income"][3]["raw_input_sha256"] == identity
    assert annual["comparison_basis"][3] == "yahoo_timeseries:industrial:v1"
    assert annual["income"]["eps_basic"] == [3, 3, 4, None, 2.5]  # retained Tushare EPS survive
    assert selected["statements"]["quarterly"]["income"]["revenue"] == [30, 12000000000]
    rows = {row["end"]: row for row in selected["earnings"]["fy"]}
    assert rows["2024-12-31"]["eps_a"] is None and rows["2025-12-31"]["eps_a"] == 2.5
    assert rows["2023-12-31"]["rev_a"] == 100


def test_scoped_repair_is_idempotent_and_proves_no_synthesized_value(tmp_path):
    previous = retained_previous()
    artifact, identity, body = published(previous=previous, annual=annual_series(eps=1.9))
    retain_receipts(identity, body, tmp_path)
    artifact = before_the_policy(artifact, SAMPLE, body, previous)
    first, report = repair_document(artifact, SAMPLE, tmp_path)
    second, again = repair_document(first, SAMPLE, tmp_path)
    assert first == second
    assert again["withdrawn_observations"] == 0 and again["withheld_actuals"] == 0
    assert again["withdrawn_periods"] == {} and again["marked_periods"] == []
    annual = materialize_regional_fund(second, SAMPLE)["statements"]["annual"]
    assert annual["income"]["revenue"] == [90, 95, 100, None, 45000000000]
    # Every surviving number is the vendor's own; the correction only ever withdrew the
    # contradicted period's EPS and revenue actuals and nothing else.
    assert report["withheld_actuals"] == 2


@pytest.mark.parametrize("damage", ["absent", "altered", "foreign_acquisition", "other_listing", "truncated"])
def test_receipts_that_cannot_prove_their_origin_fail_closed(tmp_path, damage):
    artifact, identity, body = published(previous=retained_previous())
    retain_receipts(identity, body, tmp_path)
    path = tmp_path / SAMPLE / (identity + ".json")
    if damage == "absent":
        path.unlink()
    elif damage == "truncated":
        path.write_bytes(b"{")
    else:
        data = json.loads(path.read_text())
        if damage == "altered":
            data["info"]["sector"] = "Financial Services"
        if damage == "foreign_acquisition":
            data["fetched_at"] = "2020-01-01T00:00:00Z"
        if damage == "other_listing":
            data["ticker"] = "000858.SZ"
        path.write_bytes(json.dumps(data, separators=(",", ":")).encode())
    with pytest.raises(ValueError):
        repair_document(artifact, SAMPLE, tmp_path)
    with pytest.raises(ValueError):
        bound_receipts(SAMPLE, materialize_regional_fund(artifact, SAMPLE)["statements"], tmp_path)
    assert not (tmp_path / "candidate").exists()


@pytest.mark.parametrize("mutation", ["restate", "resurrect", "synthesize", "relabel",
                                      "drop_period", "invent_period", "currency"])
def test_validation_rejects_any_correction_outside_an_explicit_withdrawal(tmp_path, mutation):
    previous = retained_previous()
    artifact, identity, body = published(previous=previous)
    retain_receipts(identity, body, tmp_path)
    candidate, _ = repair_document(before_the_policy(artifact, SAMPLE, body, previous), SAMPLE, tmp_path)
    selected = json.loads(candidate[FIELD]["payload_json"])
    annual = selected["statements"]["annual"]
    if mutation == "restate":
        annual["income"]["revenue"][3] = 12345
    if mutation == "resurrect":
        annual["period_provenance"]["income"][3].pop(QUARANTINE_KEY)
    if mutation == "synthesize":
        annual["income"]["revenue"][3] = 7469166080.12
    if mutation == "relabel":
        selected["src"]["fallback_acquired_at"] = "2030-01-01T00:00:00Z"
    if mutation == "drop_period":
        annual["period_end"] = [end for end in annual["period_end"] if end != "2024-12-31"]
        annual["periods"] = [label for label in annual["periods"] if label != "FY2024"]
    if mutation == "invent_period":
        annual["period_end"].append("2030-12-31")
    if mutation == "currency":
        candidate["stmt_currency"] = "USD"
    encoded = json.dumps(selected, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    candidate[FIELD]["payload_json"] = encoded
    candidate[FIELD]["payload_sha256"] = hashlib.sha256(encoded.encode()).hexdigest()
    with pytest.raises(ValueError):
        validate_quarantine_scope(before_the_policy(artifact, SAMPLE, body, previous), candidate, SAMPLE)


def test_the_withdrawal_lives_beside_qualification_not_in_a_consumer_or_scheduler():
    statements, _ = extend_statements(None, qualify_source(raw(), SAMPLE)[1], payload(),
                                      hashlib.sha256(raw()).hexdigest())
    assert quarantined_periods(statements) == {"annual": ["2024-12-31"]}


def test_cli_runs_as_a_script_without_the_pytest_import_path(tmp_path):
    root = Path(__file__).resolve().parents[1]
    previous = retained_previous()
    artifact, identity, body = published(previous=previous)
    retain_receipts(identity, body, tmp_path)
    served = tmp_path / "served"
    served.mkdir()
    (served / (SAMPLE + ".fund.json")).write_text(
        json.dumps(before_the_policy(artifact, SAMPLE, body, previous)))
    result = subprocess.run(
        [sys.executable, str(root / "ingest" / "cn_yahoo_integrity_quarantine.py"),
         "--fund", str(served), "--receipt-root", str(tmp_path), "--out", str(tmp_path / "candidate")],
        capture_output=True, text=True, check=False, cwd=str(tmp_path))
    assert result.returncode == 0, result.stderr
    lines = result.stdout.strip().splitlines()
    assert json.loads(lines[0])["marked_periods"] == ["annual:2024-12-31"]
    assert json.loads(lines[-1]) == {"summary": {"corrected": 1, "unchanged": 0, "errors": 0}}
    candidate = json.loads((tmp_path / "candidate" / (SAMPLE + ".fund.json")).read_text())
    assert materialize_regional_fund(candidate, SAMPLE)["statements"]["annual"]["income"]["revenue"] == \
        [90, 95, 100, None, 45000000000]
    held = subprocess.run(
        [sys.executable, str(root / "ingest" / "cn_yahoo_integrity_quarantine.py"),
         "--fund", str(served), "--receipt-root", str(tmp_path / "absent"), "--out", str(tmp_path / "held")],
        capture_output=True, text=True, check=False, cwd=str(tmp_path))
    assert held.returncode == 1
    assert json.loads(held.stdout.strip().splitlines()[-1])["summary"]["errors"] == 1
    assert not (tmp_path / "held" / (SAMPLE + ".fund.json")).exists()