"""Qualified, append-only mainland coverage from Yahoo's explicit period metadata.

This adapter extends missing whole periods. It does not assert filing/revision authority
or overwrite an overlapping observation from either provider. The raw response body,
listing, currency and 3M/12M metadata remain attached to each admitted observation.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import math
import re

FIELDS = {
    "income": {
        "revenue": "TotalRevenue", "cogs": "CostOfRevenue", "gross_profit": "GrossProfit",
        "opex": "OperatingExpense", "op_income": "OperatingIncome",
        "nonop_income": "OtherNonOperatingIncomeExpenses", "pretax_income": "PretaxIncome",
        "taxes": "TaxProvision", "net_income": "NetIncome", "eps_basic": "BasicEPS",
        "eps_diluted": "DilutedEPS", "ebitda": "EBITDA",
    },
    "balance": {
        "assets": "TotalAssets", "assets_st": "CurrentAssets", "assets_lt": "TotalNonCurrentAssets",
        "liabilities": "TotalLiabilitiesNetMinorityInterest", "liab_st": "CurrentLiabilities",
        "liab_lt": "TotalNonCurrentLiabilitiesNetMinorityInterest", "equity": "StockholdersEquity",
        "debt": "TotalDebt", "cash": "CashCashEquivalentsAndShortTermInvestments", "net_debt": "NetDebt",
    },
    "cashflow": {
        "cfo": "OperatingCashFlow", "cfi": "InvestingCashFlow", "cff": "FinancingCashFlow",
        "capex": "CapitalExpenditure", "fcf": "FreeCashFlow",
    },
}
PROVIDER = "yahoo_timeseries"
SOURCE_MODE = "yahoo_append_only"
CACHE_SCHEMA = "mastermind.cn-yahoo-source/v1"
PERIOD_ARRAYS = ("period_start", "source_period_start", "fiscal_year", "period_kind",
                 "period_number", "period_duration_months", "source_period_label", "is_cumulative",
                 "normalization_method", "src_by_period", "comparison_basis", "source_family_by_period",
                 "filed_by_period", "restated_by_period")


def valid_symbol(symbol):
    return isinstance(symbol, str) and bool(re.fullmatch(r"[0-9]{6}\.(SS|SZ|BJ)", symbol))


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def source_stamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise ValueError("source acquisition receipt missing")
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def calendar_end(value, annual=False):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("invalid period end")
    day = dt.date.fromisoformat(value)
    allowed = ("12-31",) if annual else ("03-31", "06-30", "09-30", "12-31")
    if value[5:] not in allowed:
        raise ValueError("unsupported fiscal period boundary")
    return day


def source_family(info):
    industry = str(info.get("industry") or "").lower()
    sector = str(info.get("sector") or "").lower()
    if "insurance" in industry:
        return "insurer"
    if "bank" in industry:
        return "bank"
    if "financial" in sector:
        return "financial_services"
    return "industrial" if sector else "other"


def qualify_source(raw, expected_ticker):
    """Read exact raw bytes and admit only explicit same-listing CNY 3M/12M observations."""
    if not valid_symbol(expected_ticker):
        raise ValueError("unsupported listing")
    payload = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    if not isinstance(payload, dict) or payload.get("schema") != CACHE_SCHEMA or payload.get("ticker") != expected_ticker:
        raise ValueError("source identity mismatch")
    acquired = source_stamp(payload.get("fetched_at"))
    info = payload.get("info") or {}
    if (info.get("symbol") != expected_ticker or info.get("quoteType") != "EQUITY"
            or info.get("currency") != "CNY" or info.get("financialCurrency") != "CNY"):
        raise ValueError("listing or statement currency unqualified")
    body = payload.get("timeseries_body")
    if not isinstance(body, str) or hashlib.sha256(body.encode()).hexdigest() != payload.get("timeseries_sha256"):
        raise ValueError("raw time-series receipt mismatch")
    envelope = json.loads(body, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    series_root = envelope.get("timeseries") or {}
    if series_root.get("error"):
        raise ValueError("provider returned an error")
    lookup = {prefix + source: (basis, family, field, duration)
              for prefix, basis, duration in (("annual", "annual", "12M"), ("quarterly", "quarterly", "3M"))
              for family, fields in FIELDS.items() for field, source in fields.items()}
    result = {"annual": {}, "quarterly": {}}
    seen = {}
    for series in series_root.get("result") or []:
        meta = series.get("meta") or {}
        if meta.get("symbol") != [expected_ticker]:
            raise ValueError("series listing mismatch")
        kinds = meta.get("type")
        if not isinstance(kinds, list) or len(kinds) != 1 or kinds[0] not in lookup:
            continue
        kind = kinds[0]
        basis, family, field, duration = lookup[kind]
        for observation in series.get(kind) or []:
            if observation.get("periodType") != duration or observation.get("currencyCode") != "CNY":
                continue
            end = observation.get("asOfDate")
            try:
                day = calendar_end(end, basis == "annual")
            except (TypeError, ValueError):
                continue
            if day > acquired.date():
                continue
            value = number((observation.get("reportedValue") or {}).get("raw"))
            if value is None:
                continue
            key = (basis, end, family, field)
            if key in seen and seen[key] != value:
                raise ValueError("conflicting source observation")
            seen[key] = value
            result[basis].setdefault(end, {}).setdefault(family, {})[field] = value
    # A stock-value-only balance sheet does not establish a new income-reporting period.
    for basis in result:
        result[basis] = {end: blocks for end, blocks in result[basis].items()
                         if any(blocks.get("income", {}).get(field) is not None for field in ("revenue", "net_income"))}
    if not any(result.values()):
        raise ValueError("no qualified reporting periods")
    return payload, result, hashlib.sha256(raw).hexdigest()


def _metadata(end, basis, *, legacy=False, family="other"):
    day = calendar_end(end, basis == "annual")
    year, quarter = str(day.year), (day.month - 1) // 3 + 1
    if basis == "annual":
        label, kind, n, months, start = "FY" + year, "full_year", None, 12, year + "-01-01"
    elif legacy:
        label, kind, n = {1: ("Q1 " + year, "quarter", 1), 2: ("H1 " + year, "half_year", 1),
                          3: ("9M " + year, "year_to_date", None), 4: ("FY" + year, "full_year", None)}[quarter]
        months, start = quarter * 3, year + "-01-01"
    else:
        label, kind, n, months = f"Q{quarter} {year}", "quarter", quarter, 3
        start = f"{year}-{(quarter - 1) * 3 + 1:02d}-01"
    provider = "tushare" if legacy else PROVIDER
    return {"periods": label, "period_end": end, "period_start": start, "source_period_start": None,
            "fiscal_year": year, "period_kind": kind, "period_number": n, "period_duration_months": months,
            "source_period_label": label, "is_cumulative": basis == "quarterly" and legacy,
            "normalization_method": "as_reported_ytd" if basis == "quarterly" and legacy else "as_reported",
            "src_by_period": provider, "comparison_basis": provider + ":" + family + (":legacy_ytd" if legacy else ":v1"),
            "source_family_by_period": family, "filed_by_period": None, "restated_by_period": None}


def _retained_columns(block, basis, prior_source, current_family):
    if not block:
        return {}
    ends, labels = block.get("period_end") or [], block.get("periods") or []
    if len(ends) != len(labels) or len(set(ends)) != len(ends):
        raise ValueError("retained period alignment invalid")
    metadata_present = block.get("flow_basis") == "mixed_period"
    if metadata_present and any(len(block.get(key) or []) != len(ends) for key in PERIOD_ARRAYS):
        raise ValueError("retained mixed-period metadata incomplete")
    if not metadata_present and prior_source != "tushare":
        raise ValueError("retained reporting convention unqualified")
    columns = {}
    for index, end in enumerate(ends):
        families = block.get("source_family_by_period")
        if families is not None and len(families) != len(ends):
            raise ValueError("retained family alignment invalid")
        family = families[index] if families else block.get("source_family")
        if family is None:
            family = ("ambiguous" if current_family in ("bank", "insurer", "financial_services")
                      else "other")
        meta = _metadata(end, basis, legacy=True, family=family)
        if family == "ambiguous" and (not families or block.get("source_family_basis") == "profile_financial_historical_unqualified"):
            meta["source_family_basis"] = "profile_financial_historical_unqualified"
        for key in ("filed_by_period", "restated_by_period"):
            if isinstance(block.get(key), list) and len(block[key]) == len(ends):
                meta[key] = copy.deepcopy(block[key][index])
        if metadata_present:
            meta.update({key: copy.deepcopy(block[key][index]) for key in PERIOD_ARRAYS})
            meta["periods"] = labels[index]
        else:
            # Preserve explicit producer-normalized periods where already qualified.
            if block.get("flow_basis") in ("as_reported", "discrete_period"):
                required = ("fiscal_year", "period_kind", "period_number", "period_start", "normalization_method")
                if any(len(block.get(key) or []) != len(ends) for key in required):
                    raise ValueError("retained normalized metadata incomplete")
                for key in PERIOD_ARRAYS:
                    if isinstance(block.get(key), list) and len(block[key]) == len(ends):
                        meta[key] = copy.deepcopy(block[key][index])
                meta["periods"] = labels[index]
                start = dt.date.fromisoformat(meta["period_start"])
                finish = calendar_end(end, basis == "annual")
                meta["period_duration_months"] = (finish.year - start.year) * 12 + finish.month - start.month + 1
                meta["comparison_basis"] = "tushare:" + family + ":qualified"
        column = {"meta": meta, "blocks": {}, "provenance": {}}
        for section, field_map in FIELDS.items():
            values = block.get(section) or {}
            if any(not isinstance(arr, list) or len(arr) != len(ends) for arr in values.values()):
                raise ValueError("retained value alignment invalid")
            column["blocks"][section] = {field: values.get(field, [None] * len(ends))[index] for field in set(field_map) | set(values)}
            provenance = (block.get("period_provenance") or {}).get(section) or []
            column["provenance"][section] = copy.deepcopy(provenance[index]) if index < len(provenance) else {
                "origin": "retained_history", "provider": "tushare", "acquired_at": None,
                "scope": "legacy_unknown", "raw_input_sha256": None}
        columns[end] = column
    return columns


def extend_statements(previous, observations, payload, raw_hash):
    previous = previous or {}
    prior_source = (previous.get("src") or {}).get("statements")
    prior_source = "tushare" if prior_source == "tushare+yahoo_timeseries" else prior_source
    family = source_family(payload["info"])
    output, additions = {}, {"annual": [], "quarterly": []}
    for basis in ("annual", "quarterly"):
        columns = _retained_columns((previous.get("statements") or {}).get(basis), basis, prior_source, family)
        for end, blocks in observations[basis].items():
            if end in columns:
                continue
            meta = _metadata(end, basis, family=family)
            column = {"meta": meta, "blocks": {}, "provenance": {}}
            for section, fields in FIELDS.items():
                values = blocks.get(section) or {}
                column["blocks"][section] = {field: values.get(field) for field in fields}
                column["provenance"][section] = {
                    "origin": "qualified_coverage_extension", "provider": PROVIDER,
                    "acquired_at": payload["fetched_at"] if values else None,
                    "scope": "vendor_reported_unverified" if values else "unavailable",
                    "raw_input_sha256": raw_hash if values else None,
                    "source_period_type": "12M" if basis == "annual" else "3M",
                    "publication_at": None}
            columns[end] = column
            additions[basis].append(end)
        if not columns:
            output[basis] = None
            continue
        ordered = [columns[end] for end in sorted(columns)]
        block = {key: [column["meta"][key] for column in ordered] for key in ("periods", "period_end", *PERIOD_ARRAYS)}
        block.update(flow_basis="mixed_period", source_market="cn",
                     reporting_cadence="annual" if basis == "annual" else "mixed",
                     source_family=family,
                     period_provenance={section: [column["provenance"][section] for column in ordered] for section in FIELDS})
        if any(column["meta"].get("source_family_basis") == "profile_financial_historical_unqualified" for column in ordered):
            block["source_family_basis"] = "profile_financial_historical_unqualified"
        for section, fields in FIELDS.items():
            all_fields = list(fields) + sorted(set().union(*(column["blocks"][section] for column in ordered)) - set(fields))
            block[section] = {field: [column["blocks"][section].get(field) for column in ordered] for field in all_fields}
        output[basis] = block
    return output, additions


def build_fund(raw, ticker, previous=None):
    from ingest.gen_fund_us import build_fund as empty_fund, build_profile, build_stats
    payload, observations, raw_hash = qualify_source(raw, ticker)
    if previous is not None and (previous.get("ticker") != ticker or previous.get("schema") != "mastermind.fund/v1"
                                 or previous.get("stmt_currency") != "CNY" or previous.get("quote_currency") != "CNY"):
        raise ValueError("previous fund identity or currency differs")
    statements, additions = extend_statements(previous, observations, payload, raw_hash)
    cache = {"info": payload["info"]}
    fund = copy.deepcopy(previous) if previous else empty_fund(ticker, cache, {}, None)
    fund["statements"] = statements
    fund["asof"] = dt.datetime.now(dt.timezone.utc).date().isoformat()
    fund["asof_semantics"] = "build_date"
    src = fund.setdefault("src", {})
    providers = sorted({provider for block in statements.values() if block for provider in block["src_by_period"]})
    src.update(statements="+".join(providers),
               statement_coverage_policy=SOURCE_MODE, fallback_acquired_at=payload["fetched_at"],
               fallback_raw_input_sha256=raw_hash)
    # No global source clock: existing annual observations have not been reacquired.
    src.pop("cache_fetched_at", None)
    for section, fresh in (("profile", build_profile(cache, {})), ("stats", build_stats(cache))):
        current = fund.setdefault(section, {})
        for field, value in fresh.items():
            if value is not None and value != "":
                current[field] = value
        # Some legacy CN profiles carry NaN in website. It is not a URL and must
        # not prevent otherwise qualified financials from being strict JSON.
        if section == "profile" and current.get("website") is not None and not isinstance(current["website"], str):
            current["website"] = None
        src[section + "_acquired_at"] = payload["fetched_at"]
    earnings = fund.setdefault("earnings", {})
    # Rebuild actuals from the qualified statement observations. Legacy earnings.q
    # can contain old subtraction-derived EPS; copying it would re-publish that defect.
    for basis, key in (("annual", "fy"), ("quarterly", "q")):
        block = statements[basis]
        old_rows = {row.get("end") if key == "q" else row.get("period"): row
                    for row in earnings.get(key) or []}
        rows = []
        if not block:
            earnings[key] = []
            continue
        for i, end in enumerate(block["period_end"]):
            kind, months = block["period_kind"][i], block["period_duration_months"][i]
            method, provider = block["normalization_method"][i], block["src_by_period"][i]
            provenance = copy.deepcopy(block["period_provenance"]["income"][i])
            quarter = (dt.date.fromisoformat(end).month - 1) // 3 + 1
            label = block["periods"][i] if key == "fy" else f"Q{quarter} {end[:4]}"
            identity = end if key == "q" else label
            old = old_rows.get(identity) or {}
            direct = key == "fy" or (kind == "quarter" and months == 3 and (
                method == "as_reported" or (provider == "tushare" and quarter == 1)))
            qualified_bridge = (key == "q" and kind == "quarter" and months == 3
                                and method == "difference_from_prior_ytd"
                                and provenance.get("scope") == "consolidated")
            income = block["income"]
            eps = income["eps_basic"][i] if income["eps_basic"][i] is not None else income["eps_diluted"][i]
            row = {"period": label, "end": end, "eps_a": eps if direct else None,
                   "eps_e": old.get("eps_e"), "rev_a": income["revenue"][i] if direct or qualified_bridge else None,
                   "rev_e": old.get("rev_e"), "surp_pct": None, "actuals_provenance": provenance}
            if key == "q":
                row.update(report_date=None, tx=old.get("tx"),
                           eps_basis="reported_discrete" if direct and eps is not None else "discrete_eps_unavailable",
                           rev_basis="reported_discrete" if direct else "qualified_ytd_bridge" if qualified_bridge else "unqualified_discrete_period")
            rows.append(row)
        earnings[key] = rows
    ends = [end for block in statements.values() if block for end in block["period_end"]]
    fund["data_freshness"] = {
        "latest_report_period": max(ends) if ends else None,
        "source_mode": SOURCE_MODE, "coverage_extension_acquired_at": payload["fetched_at"],
        "historical_source_acquisition": "per_period_or_unknown",
        "added_periods": {basis: sorted(values) for basis, values in additions.items()}}
    return fund


def read_collection_receipt(path, expected_run_id):
    from pathlib import Path
    receipt = json.loads(Path(path).read_text())
    if (receipt.get("schema") != "mastermind.cn-yahoo-collection/v1"
            or receipt.get("run_id") != expected_run_id or receipt.get("finalized") is not True):
        raise ValueError("collection receipt does not belong to this completed invocation")
    source_stamp(receipt.get("completed_at"))
    requested = receipt.get("requested_symbols")
    if (not isinstance(requested, list) or requested != sorted(set(requested))
            or not requested or any(not valid_symbol(symbol) for symbol in requested)):
        raise ValueError("collection scope invalid")
    digest = hashlib.sha256(json.dumps(requested, separators=(",", ":")).encode()).hexdigest()
    if digest != receipt.get("scope_sha256") or receipt.get("requested") != len(requested):
        raise ValueError("collection scope receipt mismatch")
    outcomes, admitted = receipt.get("outcomes"), receipt.get("admitted")
    states = {"qualified", "fresh", "unavailable", "source_error", "deferred"}
    if (not isinstance(outcomes, dict) or set(outcomes) != set(requested)
            or any(not isinstance(item, dict) or item.get("status") not in states for item in outcomes.values())
            or not isinstance(admitted, dict)
            or set(admitted) != {symbol for symbol, item in outcomes.items() if item["status"] in ("qualified", "fresh")}):
        raise ValueError("collection admission mismatch")
    counts = {state: sum(item["status"] == state for item in outcomes.values()) for state in states}
    if counts != receipt.get("counts"):
        raise ValueError("collection counts mismatch")
    complete = counts["deferred"] == counts["unavailable"] == counts["source_error"] == 0
    if receipt.get("coverage_complete") is not complete or receipt.get("scope") not in ("manifest", "limited", "explicit_subset"):
        raise ValueError("collection completeness mismatch")
    for symbol, item in admitted.items():
        if (not isinstance(item, dict) or item.get("status") != outcomes[symbol]["status"]
                or not re.fullmatch(r"[a-f0-9]{64}", str(item.get("raw_input_sha256")))):
            raise ValueError("admitted source receipt invalid")
        source_stamp(item.get("acquired_at"))
    return receipt
