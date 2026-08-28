"""Emit <SYM>.fund.json (mastermind.fund/v1, BUILD-SPEC §1.1) for Hong Kong names.

Reads the per-ticker caches collect_cn_hk_fund.py writes to data/hk_fund/<SYM>.json:
    financials.{income,balance,cashflow}   akshare stock_financial_hk_report_em long-format
                                           (rows per REPORT_DATE, items keyed by STD_ITEM_CODE)
    yf                                      yfinance HK: financialCurrency, targets, rec-dist,
                                           estimates, stats, profile

JUDGE FIXES honoured:
  - quote_currency = "HKD" (trading currency); stmt_currency = yf.financialCurrency (often "CNY" for
    mainland-parented names like 0700.HK — NEVER assume HKD for the statements).
  - analyst / estimates from yfinance HK (not the unaudited hk_deep collector).
  - HK dividend: per-share dividend from the income-statement 每股股息 (004027004 / 004027001) row;
    the amount is stated per share in the statement currency.

akshare HK statement families (STD_ITEM_CODE prefix), verified against the cached corpus and live
vendor rows rather than inferred from issuer sector labels:
  001 bank, 002 insurer, 003 financial-services, 004 industrial/general corporate.
Each family has its own adapter below. Economically comparable totals are mapped; industrial-only
concepts (for example bank gross profit/current assets/industrial debt) remain null.

Merge-mode (default ON, --no-merge to disable): when the output <SYM>.fund.json already exists,
populated blocks in it survive a fresh run that would null them (statements when akshare returned
nothing, estimates/analyst/profile/stats fields when yfinance was rate-limited, dividend events).
Fresh non-null values always win. Mirrors gen_fund_cn.py's merge-mode (CN backfill pattern).

Usage:
    "<Macro Dashboard>/.venv/bin/python" ingest/gen_fund_hk.py [--only 0700.HK,0005.HK] [--limit N] \
        [--out <dir>] [--no-merge]        # default out = terminal/public/data
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import os
import sys
from numbers import Integral, Real
from pathlib import Path

CA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CA_ROOT))
from ingest.earnings_calendar import select_next_earnings_date  # noqa: E402
MACRO = Path(os.environ.get("MACRO_REPO") or "/Users/chriswong/Documents/Cluade/Macro Dashboard")
HK_FUND = MACRO / "data" / "hk_fund"
DEFAULT_OUT = CA_ROOT / "terminal" / "public" / "data"

ASOF = __import__("datetime").date.today().strftime("%Y-%m-%d")

# akshare STD_ITEM_CODE taxonomy. The family is a statement-SCHEMA family, not a yfinance sector.
# In particular, 003 includes exchanges/brokers/asset managers and is intentionally distinct from
# 001 banks and 002 insurers. Unknown families fail closed to null instead of being coerced through
# the 004 industrial map.
FAMILY_BY_PREFIX = {
    "001": "bank",
    "002": "insurer",
    "003": "financial_services",
    "004": "industrial",
}

INC_BY_FAMILY = {
    "industrial": {
        "revenue": ("004001999", "004001001"), "gross_profit": ("004007999",),
        "op_income": ("004010999",), "pretax": ("004011999",), "taxes": ("004012001",),
        "net": ("004025002", "004012999"), "eps_basic": ("004027002",),
        "eps_diluted": ("004027003",), "dps": ("004027004", "004027001"),
        # 004005001 营运支出 is cost of revenue in the observed corpus (it equals revenue minus
        # gross profit for Tencent and 17k+ other rows), not ex-COGS operating expense. Terminal
        # derives the latter from gross profit minus operating income and leaves this raw field null.
        "opex": (),
    },
    "bank": {
        # 经营收入总额, not interest income or net-interest income alone.
        "revenue": ("001003999",), "gross_profit": (), "op_income": ("001010999",),
        "pretax": ("001011999",), "taxes": ("001012001",),
        "net": ("001025002", "001012999"), "eps_basic": ("001027002",),
        "eps_diluted": ("001027003",), "dps": ("001027004", "001027001"),
        "opex": ("001005999",),
    },
    "insurer": {
        # 经营收入总额 includes premium and investment economics; gross premium is not revenue.
        "revenue": ("002003999",), "gross_profit": (), "op_income": ("002010999",),
        "pretax": ("002011999",), "taxes": ("002012001",),
        "net": ("002014002", "002013999"), "eps_basic": ("002027002",),
        "eps_diluted": ("002027003",), "dps": ("002027004", "002027001"),
        "opex": ("002007999",),
    },
    "financial_services": {
        "revenue": ("003003999", "003001999"), "gross_profit": (),
        "op_income": ("003010999",), "pretax": ("003011999",),
        "taxes": ("003012001",), "net": ("003015002", "003012999"),
        "eps_basic": ("003027002",), "eps_diluted": ("003027003",),
        "dps": ("003027004", "003027001"), "opex": ("003007999",),
    },
    "other": {},
}

BAL_BY_FAMILY = {
    "industrial": {
        "assets": ("004009999",), "assets_st": ("004002999",),
        "assets_lt": ("004001999",), "liab": ("004025999",),
        "liab_st": ("004011999",), "liab_lt": ("004020999",),
        "equity": ("004036999", "004030999"), "cash": ("004002010",),
        "debt": (),
        # Definite interest-bearing obligations. These components are summed, not fallback-picked:
        # loans alone understated 1378.HK FY2025 by 25.676B of bonds/convertibles.
        "debt_components": (
            "004011006",  # current finance-lease liabilities
            "004011010",  # current borrowings
            "004011021",  # current bonds payable
            "004020001",  # non-current borrowings
            "004020005",  # non-current finance-lease liabilities
            "004020007",  # convertible notes and bonds
            "004020018",  # non-current notes payable
        ),
        "st_debt": (), "lt_debt": (),
    },
    "bank": {
        "assets": ("001001999",), "assets_st": (), "assets_lt": (),
        "liab": ("001002999",), "liab_st": (), "liab_lt": (),
        "equity": ("001011999", "001009999"), "cash": ("001001001",),
        # Deposits and ordinary bank funding are not industrial debt. Leave debt/net debt null.
        "debt": (), "debt_components": (), "st_debt": (), "lt_debt": (),
    },
    "insurer": {
        "assets": ("002001999",), "assets_st": (), "assets_lt": (),
        "liab": ("002002999",), "liab_st": (), "liab_lt": (),
        "equity": ("002011999", "002009999"), "cash": ("002001001",),
        "debt": ("002002008",), "debt_components": (), "st_debt": (), "lt_debt": (),
    },
    "financial_services": {
        "assets": ("003005999",), "assets_st": ("003002999",),
        "assets_lt": ("003001999",), "liab": ("003019999",),
        "liab_st": ("003007999",), "liab_lt": ("003015999",),
        "equity": ("003029999", "003025999"), "cash": ("003002010",),
        # The schema also carries issued bonds and other funding. A two-code sum is incomplete.
        "debt": (), "debt_components": (), "st_debt": (), "lt_debt": (),
    },
    "other": {},
}
CF = {"cfo": ("003999",), "cfi": ("005999",), "cff": ("007999",), "capex": ("005005",)}

# Source milestones are fiscal, not calendar: 001=FY, 002=H1, 003=Q1, 004=9M/Q3-YTD.
_ANNUAL_TYPE = "001"


def _f(v):
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _json_safe(value):
    """Recursively normalize numpy/Python numerics and replace non-finite values with null."""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, Integral):
        return int(value)
    if isinstance(value, Real):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def strict_json_dumps(value) -> str:
    """Emit browser-valid JSON and fail closed if a non-finite value escapes normalization."""
    return json.dumps(
        _json_safe(value),
        separators=(",", ":"),
        ensure_ascii=False,
        sort_keys=False,
        allow_nan=False,
    )


def _pick(items: dict, codes) -> float | None:
    for c in codes:
        v = items.get(c)
        if v is not None:
            return _f(v)
    return None


def _div_yield_frac(yf: dict):
    """UNIT RULING: yfinance 1.4.1 reports dividendYield in PERCENT form (3.92 == 3.92%). The
    fund.json contract stores div_yield/yield_ttm as a 0..1 FRACTION → divide the percent-form by 100."""
    v = _f((yf or {}).get("div_yield"))
    return v / 100.0 if v is not None else None


def _row_statement_families(row: dict) -> set[str]:
    families: set[str] = set()
    # Income is authoritative; balance is a safe fallback for a sparse income filing. Cash-flow
    # codes are shared across schemas and therefore cannot identify the family.
    for namespace in (row.get("inc") or {}, row.get("bal") or {}):
        for code in namespace.keys():
            family = FAMILY_BY_PREFIX.get(str(code)[:3])
            if family:
                families.add(family)
        if families:
            break
    return families


def _row_statement_family(row: dict) -> str:
    """Return one schema family, ``ambiguous`` for multiple, or ``other`` for none.

    A handful of real vendor rows carry complete 003 and 004 namespaces together (0767.HK is a
    concrete example). Item-count majority silently chose the smaller industrial top line. There
    is no source receipt proving which schema is primary, so an ambiguous row must not be coerced.
    """
    families = _row_statement_families(row)
    if len(families) == 1:
        return next(iter(families))
    return "ambiguous" if families else "other"


def _statement_family(rows: list[dict]) -> str:
    """Dominant vendor statement family from actual income item codes.

    Counting across unambiguous rows makes this resilient to a sparse latest filing. No recognized
    prefix, or more than one schema in the same row, yields `other`, whose maps are empty by design.
    """
    counts: dict[str, int] = {}
    for row in rows:
        family = _row_statement_family(row)
        if family in FAMILY_BY_PREFIX.values():
            weight = len(row.get("inc") or {}) or len(row.get("bal") or {}) or 1
            counts[family] = counts.get(family, 0) + weight
    return max(counts, key=counts.get) if counts else "other"


def _fiscal_year_labels(rows: list[dict]) -> list[str]:
    """Assign each row to the fiscal year closed by its next DATE_TYPE_CODE=001 boundary.

    Calendar month math is not a fiscal calendar: 789 cached HK issuers have a non-December FY
    end. The vendor's annual boundary is authoritative. For the still-open newest fiscal cycle,
    infer only the YEAR from the observed annual month/day (for example Sep-2025 → FY2026 for a
    March-end issuer); the source DATE_TYPE_CODE still owns the period slot.
    """
    parsed: list[_dt.date | None] = []
    for row in rows:
        try:
            parsed.append(_dt.date.fromisoformat(str(row.get("end") or "")[:10]))
        except Exception:
            parsed.append(None)
    annuals = [d for row, d in zip(rows, parsed) if d and row.get("date_type") == _ANNUAL_TYPE]
    annual_md = (annuals[-1].month, annuals[-1].day) if annuals else (12, 31)
    out: list[str] = []
    for row, end in zip(rows, parsed):
        if end is None:
            out.append(str(row.get("end") or "")[:4])
            continue
        if row.get("date_type") == _ANNUAL_TYPE:
            out.append(str(end.year))
            continue
        # New caches retain the vendor's exact fiscal START_DATE and fiscal-end month/day.
        try:
            start = _dt.date.fromisoformat(str(row.get("start") or "")[:10])
        except Exception:
            start = None
        fy_end_raw = str(row.get("fiscal_year_end") or "")
        try:
            fy_end_md = tuple(int(part) for part in fy_end_raw.split("-")[-2:])
            if len(fy_end_md) != 2:
                raise ValueError
        except Exception:
            fy_end_md = annual_md
        if start:
            out.append(str(start.year if (start.month, start.day) <= fy_end_md else start.year + 1))
            continue
        # Legacy cache fallback: never jump more than one fiscal cycle to find an annual boundary.
        future = [a for a in annuals if a >= end and (a - end).days <= 370]
        if future:
            out.append(str(min(future).year))
            continue
        out.append(str(end.year if (end.month, end.day) <= annual_md else end.year + 1))
    return out


def _source_label(date_type: str | None, fiscal_year: str) -> str:
    slot = {"001": "FY", "002": "H1", "003": "Q1", "004": "9M"}.get(str(date_type or ""))
    return f"{slot} {fiscal_year}" if slot else fiscal_year


def _interim_identities(all_rows: list[dict], selected_rows: list[dict]) -> list[dict]:
    """Canonical period identity for each selected HK interim source row.

    The source slots are FY/H1/Q1/Q3-YTD. A discrete quarter/half is emitted only when its exact
    cumulative base exists in the same fiscal cycle. Otherwise the filed H1/FY/9M identity remains
    visible; no missing quarter is fabricated and no six-month period receives a Q label.
    """
    all_fy = _fiscal_year_labels(all_rows)
    fy_by_end = {row["end"]: fy for row, fy in zip(all_rows, all_fy)}
    groups: dict[str, dict[str, list[str]]] = {}
    for row, fy in zip(all_rows, all_fy):
        # START_DATE is the source-grounded fiscal-cycle key. Legacy rows deliberately get an
        # isolated key: without the source start, subtracting across two vendor rows would only be
        # a calendar guess. Those rows remain honestly labelled YTD/FY until their cache refreshes.
        start = str(row.get("start") or "")[:10]
        cycle = f"start:{start}" if start else f"legacy:{row['end']}"
        dtype = str(row.get("date_type") or "")
        groups.setdefault(cycle, {}).setdefault(dtype, []).append(row["end"])

    cycle_by_end = {
        row["end"]: (f"start:{str(row.get('start'))[:10]}" if row.get("start")
                     else f"legacy:{row['end']}")
        for row in all_rows
    }
    row_by_end = {row["end"]: row for row in all_rows}

    identities: list[dict] = []
    for row in selected_rows:
        fy = fy_by_end.get(row["end"], str(row["end"])[:4])
        dtype = str(row.get("date_type") or "")
        slots = groups.get(cycle_by_end.get(row["end"], ""), {})
        base_end = None
        requires_base = False
        period_number = None
        current_family = _row_statement_family(row)
        def unique_slot(slot: str):
            ends = slots.get(slot, [])
            if len(ends) != 1 or ends[0] >= row["end"]:
                return None
            # A namespace change changes the meaning of the vendor totals. Subtracting an
            # industrial Q1 from a financial-services H1 (observed on 1973.HK) fabricates a
            # negative "Q2". Without a same-family base, retain the filed source identity.
            base_family = _row_statement_family(row_by_end.get(ends[0], {}))
            if current_family not in FAMILY_BY_PREFIX.values() or base_family != current_family:
                return None
            return ends[0]
        q1_end = unique_slot("003")
        h1_end = unique_slot("002")
        nine_month_end = unique_slot("004")
        if dtype == "003":
            label, kind, period_number = f"Q1 {fy}", "quarter", 1
        elif dtype == "002" and q1_end:
            label, kind, period_number = f"Q2 {fy}", "quarter", 2
            base_end, requires_base = q1_end, True
        elif dtype == "002":
            label, kind, period_number = f"H1 {fy}", "half_year", 1
        elif dtype == "004" and h1_end:
            label, kind, period_number = f"Q3 {fy}", "quarter", 3
            base_end, requires_base = h1_end, True
        elif dtype == "004":
            label, kind = f"9M {fy}", "year_to_date"
        elif dtype == "001" and nine_month_end:
            label, kind, period_number = f"Q4 {fy}", "quarter", 4
            base_end, requires_base = nine_month_end, True
        elif dtype == "001" and h1_end:
            label, kind, period_number = f"H2 {fy}", "half_year", 2
            base_end, requires_base = h1_end, True
        else:
            label, kind = f"FY {fy}", "full_year"
        # Duplicate source milestones are stubs/restatements with incompatible geometry. Keep their
        # exact ends visible rather than silently collapsing two rows under one label.
        if len(slots.get(dtype, [])) > 1:
            label = f"{label} · {row['end']}"
        identities.append({
            "period": label,
            "fiscal_year": fy,
            "period_kind": kind,
            "period_number": period_number,
            "source_period_label": _source_label(dtype, fy),
            "source_period_start": row.get("start"),
            "source_end": row["end"],
            "base_end": base_end,
            "requires_base": requires_base,
        })

    # Fiscal-year-end changes can produce the same canonical identity from different source
    # cycles (for example 0030.HK has two H1 FY2024 rows). Keep both source observations but make
    # their display labels unambiguous. Comparable-period math separately fails closed whenever
    # either side has a duplicate identity.
    identity_counts: dict[tuple, int] = {}
    for identity in identities:
        key = (identity["fiscal_year"], identity["period_kind"], identity.get("period_number"))
        identity_counts[key] = identity_counts.get(key, 0) + 1
    for identity in identities:
        key = (identity["fiscal_year"], identity["period_kind"], identity.get("period_number"))
        if identity_counts[key] > 1 and identity["source_end"] not in identity["period"]:
            identity["period"] = f"{identity['period']} · {identity['source_end']}"

    selected_index = {row["end"]: i for i, row in enumerate(selected_rows)}
    for identity in identities:
        base_end = identity.pop("base_end")
        requires_base = identity.pop("requires_base")
        identity["base_index"] = selected_index.get(base_end) if base_end else None
        identity["is_cumulative"] = True
        if base_end and identity["base_index"] is not None:
            identity["normalization_method"] = "difference_from_prior_ytd"
            try:
                base_date = _dt.date.fromisoformat(base_end[:10])
                identity["period_start"] = (base_date + _dt.timedelta(days=1)).isoformat()
            except Exception:
                identity["period_start"] = None
        elif requires_base:
            identity["normalization_method"] = "unavailable_missing_base"
            identity["period_start"] = None
        else:
            identity["normalization_method"] = "as_reported_ytd"
            identity["period_start"] = identity.get("source_period_start")
    return identities


def _cadence(identities: list[dict]) -> str:
    kinds = {identity["period_kind"] for identity in identities}
    if kinds and kinds <= {"quarter"}:
        return "quarterly"
    if kinds and kinds <= {"half_year"}:
        return "semiannual"
    if kinds and kinds <= {"full_year"}:
        return "annual"
    return "mixed"


def _normalize_flow(
    values: list[float | None], identities: list[dict], *, additive: bool = True,
    require_non_decreasing: bool = False,
):
    """Apply the identity's exact cumulative base once; missing bases stay null.

    EPS is not additive because weighted-average shares can change inside the year, so callers pass
    `additive=False`: Q1/H1 remains as filed while a derived Q2/Q3/Q4/H2 EPS is an honest null.
    """
    out: list[float | None] = []
    for i, identity in enumerate(identities):
        if identity["normalization_method"] == "unavailable_missing_base":
            out.append(None)
            continue
        if identity["normalization_method"] != "difference_from_prior_ytd":
            out.append(values[i] if i < len(values) else None)
            continue
        if not additive:
            out.append(None)
            continue
        base_i = identity.get("base_index")
        cur = values[i] if i < len(values) else None
        base = values[base_i] if isinstance(base_i, int) and base_i < len(values) else None
        if cur is None or base is None or (require_non_decreasing and cur < base):
            out.append(None)
        else:
            out.append(cur - base)
    return out


# ─────────────────────────────── statement assembly ───────────────────────────────
def _income_block(
    rows: list[dict], families: list[str], identities: list[dict] | None = None,
) -> dict:
    def col(field):
        return [
            _pick(r["inc"], INC_BY_FAMILY.get(family, INC_BY_FAMILY["other"]).get(field, ()))
            for r, family in zip(rows, families)
        ]

    revenue = col("revenue")
    gross = col("gross_profit")
    raw = {
        "revenue": revenue,
        # COGS/gross profit are industrial concepts. Financial statement families leave both null.
        "cogs": [(rv - gp) if (rv is not None and gp is not None) else None
                 for rv, gp in zip(revenue, gross)],
        "gross_profit": gross,
        "opex": col("opex"),
        "op_income": col("op_income"),
        "nonop_income": [None] * len(rows),
        "pretax_income": col("pretax"),
        "taxes": col("taxes"),
        "net_income": col("net"),
        "eps_basic": col("eps_basic"),
        "eps_diluted": col("eps_diluted"),
        "ebitda": [None] * len(rows),
    }
    if not identities:
        return raw
    return {
        field: _normalize_flow(values, identities, additive=field not in {"eps_basic", "eps_diluted"})
        for field, values in raw.items()
    }


def _balance_block(rows: list[dict], families: list[str]) -> dict:
    def col(field):
        return [
            _pick(r["bal"], BAL_BY_FAMILY.get(family, BAL_BY_FAMILY["other"]).get(field, ()))
            for r, family in zip(rows, families)
        ]

    cash = col("cash")
    total_debt = col("debt")
    component_debt = []
    for row, family in zip(rows, families):
        codes = BAL_BY_FAMILY.get(family, BAL_BY_FAMILY["other"]).get("debt_components", ())
        parts = [_f(row["bal"].get(code)) for code in codes]
        present = [value for value in parts if value is not None]
        component_debt.append(sum(present) if present else None)
    debt = []
    for explicit, components in zip(total_debt, component_debt):
        if explicit is not None:
            debt.append(explicit)
        else:
            debt.append(components)
    net_debt = [(d - c) if (d is not None and c is not None) else None for d, c in zip(debt, cash)]
    return {
        "assets": col("assets"), "assets_st": col("assets_st"), "assets_lt": col("assets_lt"),
        "liabilities": col("liab"), "liab_st": col("liab_st"), "liab_lt": col("liab_lt"),
        "equity": col("equity"), "debt": debt, "cash": cash, "net_debt": net_debt,
    }


def _cashflow_block(
    rows: list[dict], families: list[str], identities: list[dict] | None = None,
) -> dict:
    def col(field):
        return [_pick(r["cf"], CF[field]) for r in rows]

    raw = {field: col(field) for field in ("cfo", "cfi", "cff", "capex")}
    flow = ({field: _normalize_flow(values, identities)
             for field, values in raw.items() if field != "capex"}
            if identities else {field: values for field, values in raw.items() if field != "capex"})
    # Eastmoney `005005` (购建固定资产) is a positive cash-outflow amount. The fund contract uses
    # cash-flow signs, matching CN/US: capex is negative and FCF = CFO + capex. Normalize the
    # absolute gross-outflow magnitude first and fail closed when a cumulative magnitude falls;
    # applying `-abs` to that negative revision would invent spending (observed on 0990.HK).
    capex_magnitude = [abs(value) if value is not None else None for value in raw["capex"]]
    normalized_capex = (_normalize_flow(
        capex_magnitude, identities, require_non_decreasing=True,
    ) if identities else capex_magnitude)
    flow["capex"] = [-value if value is not None else None for value in normalized_capex]
    cfo = flow["cfo"]
    capex = flow["capex"]
    fcf = [(o + c) if (o is not None and c is not None) else None for o, c in zip(cfo, capex)]
    # FCF is not a comparable bank/insurer statement subtotal; do not manufacture one.
    fcf = [None if family in {"bank", "insurer", "ambiguous"} else value
           for family, value in zip(families, fcf)]
    return {**flow, "fcf": fcf}


def _assemble(rows: list[dict], identities: list[dict] | None = None) -> dict | None:
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: r["end"])
    if identities is None:
        fiscal_years = _fiscal_year_labels(rows)
        identities = [{
            "period": fiscal_year,
            "fiscal_year": fiscal_year,
            "period_kind": "full_year",
            "period_number": None,
            "source_period_label": f"FY {fiscal_year}",
            "source_period_start": row.get("start"),
            "period_start": row.get("start"),
            "source_end": row["end"],
            "base_index": None,
            "is_cumulative": False,
            "normalization_method": "as_reported",
        } for row, fiscal_year in zip(rows, fiscal_years)]
        # Fiscal-year-end transitions can produce two annual source rows with the same year label
        # (2720.HK has FY rows ending 2022-06-30 and 2022-12-31). Keep both observations, but make
        # the display identity unambiguous just as the interim adapter does for duplicate H1/FY
        # identities.
        annual_identity_counts: dict[tuple, int] = {}
        for identity in identities:
            key = (identity["fiscal_year"], identity["period_kind"], identity.get("period_number"))
            annual_identity_counts[key] = annual_identity_counts.get(key, 0) + 1
        for identity in identities:
            key = (identity["fiscal_year"], identity["period_kind"], identity.get("period_number"))
            if annual_identity_counts[key] > 1:
                identity["period"] = f"{identity['period']} · {identity['source_end']}"
        normalize = False
    else:
        normalize = True
    dominant = _statement_family(rows)
    families = []
    for row in rows:
        recognized = _row_statement_families(row)
        if len(recognized) == 1:
            families.append(next(iter(recognized)))
        elif not recognized:
            # A sparse cash-flow-only row has no family-bearing codes; use the surrounding
            # statement's dominant family. A multi-namespace row is different: it is ambiguous
            # evidence and must remain `other` so every family-specific mapped field is null.
            families.append(dominant)
        else:
            families.append("ambiguous")
    kinds = {identity["period_kind"] for identity in identities}
    flow_basis = "as_reported"
    if normalize:
        flow_basis = "discrete_period" if kinds <= {"quarter", "half_year"} else "mixed_period"
    return {
        "periods": [identity["period"] for identity in identities],
        "period_start": [identity.get("period_start") for identity in identities],
        "source_period_start": [identity.get("source_period_start") for identity in identities],
        "period_end": [r["end"] for r in rows],
        "fiscal_year": [identity["fiscal_year"] for identity in identities],
        "period_kind": [identity["period_kind"] for identity in identities],
        "period_number": [identity.get("period_number") for identity in identities],
        "source_period_label": [identity["source_period_label"] for identity in identities],
        "reporting_cadence": _cadence(identities),
        "is_cumulative": [identity["is_cumulative"] for identity in identities],
        "normalization_method": [identity["normalization_method"] for identity in identities],
        "flow_basis": flow_basis,
        "source_market": "hk",
        "source_family": next((family for family in reversed(families) if family != "other"), dominant),
        "source_family_by_period": families,
        "income": _income_block(rows, families, identities if normalize else None),
        "balance": _balance_block(rows, families),
        "cashflow": _cashflow_block(rows, families, identities if normalize else None),
    }


def _tail_period_set(period_set: dict | None, limit: int) -> dict | None:
    """Trim a fully normalized set while preserving every index-aligned provenance array."""
    if not period_set:
        return None
    n = len(period_set.get("periods") or [])
    start = max(0, n - limit)
    out = {}
    for key, value in period_set.items():
        if isinstance(value, list) and len(value) == n:
            out[key] = value[start:]
        elif key in {"income", "balance", "cashflow"} and isinstance(value, dict):
            out[key] = {
                field: (series[start:] if isinstance(series, list) and len(series) == n else series)
                for field, series in value.items()
            }
        else:
            out[key] = value
    # These scalars describe the emitted transport window, not rows that were normalized and then
    # intentionally trimmed away. Mixed cadence inside the retained window remains mixed.
    retained_kinds = out.get("period_kind") or []
    out["reporting_cadence"] = _cadence([
        {"period_kind": kind} for kind in retained_kinds
    ])
    out["flow_basis"] = (
        "discrete_period"
        if set(retained_kinds) <= {"quarter", "half_year"}
        else "mixed_period"
    )
    return out


def _merge_rows(fin: dict) -> dict:
    """Group income/balance/cashflow by REPORT_DATE. STD_ITEM_CODE is NOT unique across statements
    (e.g. 004001999 = 营运收入 in income but 非流动资产合计 in balance), so the three statements'
    item dicts are kept in separate namespaces (inc/bal/cf) — never merged into one dict."""
    merged: dict[str, dict] = {}
    slot = {"income": "inc", "balance": "bal", "cashflow": "cf"}
    for kind, key in slot.items():
        for r in fin.get(kind) or []:
            end = r.get("end")
            if not end:
                continue
            rec = merged.setdefault(end, {
                "end": end,
                "start": None,
                "date_type": None,
                "fiscal_year_end": None,
                "inc": {},
                "bal": {},
                "cf": {},
            })
            rec[key] = r.get("items") or {}
            # prefer the income statement's date_type (the canonical annual/quarterly flag)
            if rec["date_type"] is None or kind == "income":
                rec["date_type"] = r.get("date_type")
            if rec["start"] is None or (kind == "income" and r.get("start")):
                rec["start"] = r.get("start")
            if rec["fiscal_year_end"] is None or (kind == "income" and r.get("fiscal_year_end")):
                rec["fiscal_year_end"] = r.get("fiscal_year_end")
    return merged


def build_statements(fin: dict) -> dict:
    merged = _merge_rows(fin)
    rows = sorted(merged.values(), key=lambda r: r["end"])
    annual = [r for r in rows if r.get("date_type") == _ANNUAL_TYPE][-6:]
    # `.quarterly` is the frozen v1 transport key. Its metadata owns the honest display name:
    # quarterly, semiannual, or mixed. Pure annual-only issuers get no duplicate interim set.
    periodic_rows = [r for r in rows if str(r.get("date_type") or "") in {"001", "002", "003", "004"}]
    has_interim = any(r.get("date_type") in {"002", "003", "004"} for r in periodic_rows)
    identities = _interim_identities(periodic_rows, periodic_rows) if has_interim else None
    interim_full = _assemble(periodic_rows, identities) if identities else None
    return {
        "annual": _assemble(annual),
        "quarterly": _tail_period_set(interim_full, 12),
    }


# ─────────────────────────────── yfinance-derived sections ───────────────────────────────
_REC_LABEL = {"strong_buy": "Strong buy", "buy": "Buy", "hold": "Hold", "sell": "Sell",
              "strong_sell": "Strong sell", "underperform": "Sell", "outperform": "Buy"}


def build_analyst(yf: dict) -> dict | None:
    if not yf:
        return None
    dist = yf.get("rec_dist") or {"strongBuy": 0, "buy": 0, "hold": 0, "sell": 0, "strongSell": 0}
    tm = yf.get("target_mean")
    if not any(dist.values()) and tm is None:
        return None
    return {
        "dist": dist,
        "rating_label": _REC_LABEL.get(str(yf.get("rec_key") or "").lower()),
        "target": {"mean": tm, "high": yf.get("target_high"), "low": yf.get("target_low"),
                   "n": yf.get("n_analysts")},
    }


def _latest_annual_year(fin: dict) -> int | None:
    """Newest completed fiscal-year boundary (DATE_TYPE 001), as an integer label."""
    best = None
    for r in (fin or {}).get("income") or []:
        if r.get("date_type") == _ANNUAL_TYPE:
            end = str(r.get("end") or "")
            if len(end) >= 4 and end[:4].isdigit():
                y = int(end[:4])
                if best is None or y > best:
                    best = y
    return best


def _fy_periods(fin: dict, yf: dict) -> list[str]:
    """Real fiscal-year labels for estimates [0y, +1y] from the latest annual boundary."""
    base = _latest_annual_year(fin)
    if base is None:
        ne = str((yf or {}).get("next_earnings") or "")
        if len(ne) >= 4 and ne[:4].isdigit():
            base = int(ne[:4]) - 1
    if base is None:
        return ["0y", "+1y"]   # last resort: keep placeholders rather than emit wrong years
    fy0 = base + 1
    return [str(fy0), str(fy0 + 1)]


def _q_periods(fin: dict, yf: dict) -> list[str]:
    """Real quarter labels for eps_q [0q, +1q]. The next earnings date reports the quarter that
    closed ~35 days earlier (Dec-end filer → calendar quarter); +1q is the following quarter."""
    ne = str((yf or {}).get("next_earnings") or "")
    try:
        d = _dt.date.fromisoformat(ne[:10])
    except Exception:
        return ["0q", "+1q"]
    reported = d - _dt.timedelta(days=35)     # snap back to the reported quarter-end
    m0 = reported.month
    q0 = (m0 - 1) // 3 + 1
    y0 = reported.year
    q1 = q0 + 1
    y1 = y0
    if q1 > 4:
        q1, y1 = 1, y0 + 1
    return [f"Q{q0} '{y0 % 100:02d}", f"Q{q1} '{y1 % 100:02d}"]


def build_estimates(yf: dict, fin: dict | None = None) -> dict | None:
    if not yf:
        return None
    fin = fin or {}
    ee = yf.get("eps_est") or {}
    re_ = yf.get("rev_est") or {}
    # yfinance index labels: 0q,+1q,0y,+1y
    def row(src, keys):
        avg, high, low, n = [], [], [], []
        for k in keys:
            d = src.get(k) or {}
            avg.append(_f(d.get("avg")))
            high.append(_f(d.get("high")))
            low.append(_f(d.get("low")))
            n.append(_f(d.get("numberOfAnalysts")))
        return {"avg": avg, "high": high, "low": low, "n": n}
    eps_fy = row(ee, ["0y", "+1y"])
    rev_fy = row(re_, ["0y", "+1y"])
    eps_q = row(ee, ["0q", "+1q"])
    if not (any(eps_fy["avg"]) or any(rev_fy["avg"]) or any(eps_q["avg"])):
        return None
    fy_periods = _fy_periods(fin, yf)
    q_periods = _q_periods(fin, yf)
    return {
        "eps_fy": {"periods": list(fy_periods), **eps_fy},
        "rev_fy": {"periods": list(fy_periods), **rev_fy},
        "eps_q": {"periods": list(q_periods), **eps_q},
        "growth": {"rev_yoy": _f(yf.get("rev_growth")), "eps_yoy": _f(yf.get("eps_growth"))},
    }


def build_stats(yf: dict) -> dict:
    return {"mktcap": yf.get("mktcap"), "shares_out": yf.get("shares_out"),
            "float_shares": yf.get("float_shares"),
            "inst_pct": yf.get("held_inst_pct"), "insider_pct": yf.get("held_insider_pct"),
            "beta": yf.get("beta"), "num_holders": None}


def build_ratios(yf: dict, annual) -> dict:
    cur = {"pe_ttm": yf.get("trailing_pe"), "pe_fwd": yf.get("forward_pe"), "ps": yf.get("ps"),
           "pb": yf.get("pb"), "ev_ebitda": None, "div_yield": _div_yield_frac(yf),
           "payout": yf.get("payout_ratio"),
           "gross_margin": _pctize(yf.get("gross_margin")), "net_margin": _pctize(yf.get("net_margin")),
           "roe": _pctize(yf.get("roe")), "roa": _pctize(yf.get("roa")),
           "debt_to_equity": None, "current_ratio": None}
    if annual and annual.get("balance"):
        b = annual["balance"]

        def last(k):
            v = b.get(k)
            return v[-1] if isinstance(v, list) and v and v[-1] is not None else None
        ast, lst = last("assets_st"), last("liab_st")
        if ast and lst:
            cur["current_ratio"] = round(ast / lst, 2)
        debt, eq = last("debt"), last("equity")
        if debt is not None and eq:
            cur["debt_to_equity"] = round(debt / eq, 2)
    periods = (annual or {}).get("periods") or []
    empty = [None] * len(periods)   # null-pad per-period series to len(periods) (contract §1.1)
    return {"periods": periods, "pe": list(empty), "ps": list(empty), "pb": list(empty),
            "pcf": list(empty), "ev": list(empty), "ev_ebitda": list(empty), "current": cur}


def _pctize(v):
    """yfinance margins/roe are decimals (0.31); contract wants percent (31.0)."""
    return round(v * 100, 2) if isinstance(v, (int, float)) else None


def _hk_never_paid(fin: dict, yf: dict, events: list) -> bool:
    """A HK name is a dividend payer if it has ANY of: DPS events from the statement, a positive
    yfinance dividend yield, or a yfinance dividends history. The income-statement 每股股息 row is
    often empty for financials (e.g. 0005.HK/HSBC) even though they pay — so don't rely on it alone."""
    if events:
        return False
    dy = _f((yf or {}).get("div_yield"))
    if dy is not None and dy > 0:
        return False
    hist = (yf or {}).get("dividends") or (yf or {}).get("div_history")
    if isinstance(hist, (list, dict)) and len(hist) > 0:
        return False
    return True


def build_dividends(fin: dict, yf: dict) -> dict:
    """Per-share dividend from the income-statement 每股股息 row, oldest→newest."""
    merged = sorted(_merge_rows(fin).values(), key=lambda row: row["end"])
    events = []
    for r in sorted(fin.get("income") or [], key=lambda x: x.get("end") or ""):
        family = FAMILY_BY_PREFIX.get(next(iter((r.get("items") or {}).keys()), "")[:3], "other")
        dps_codes = INC_BY_FAMILY.get(family, INC_BY_FAMILY["other"]).get("dps", ())
        dps = _pick(r.get("items") or {}, dps_codes)
        if dps and dps > 0 and r.get("date_type") == _ANNUAL_TYPE:
            events.append({"ex": r["end"], "amount": round(dps, 6), "pay": None, "type": "regular"})
    return {"never_paid": _hk_never_paid(fin, yf, events), "yield_ttm": _div_yield_frac(yf),
            "payout_ratio": yf.get("payout_ratio"), "events": events, "splits": []}


def build_profile(yf: dict) -> dict:
    return {"website": yf.get("website"), "employees": yf.get("employees"),
            "sector": yf.get("sector"), "industry": yf.get("industry"),
            "description": yf.get("description"), "founded": None, "hq": None}


def build_earnings(yf: dict, annual: dict | None = None) -> dict:
    """fy actuals from the akshare annual statements (last 5 FY eps_basic/revenue — same shape as
    gen_fund_cn). q stays empty: the statement-period adapter owns HK quarter/half-year identity,
    and additive differencing cannot recover EPS safely because weighted share counts can change."""
    fy = []
    if annual:
        periods = annual.get("periods") or []
        inc = annual.get("income") or {}
        eps_l = inc.get("eps_basic") or []
        rev_l = inc.get("revenue") or []
        n = len(periods)
        eps_l = (eps_l + [None] * n)[:n]
        rev_l = (rev_l + [None] * n)[:n]
        for i in range(max(0, n - 5), n):
            eps_v, rev_v = _f(eps_l[i]), _f(rev_l[i])
            if eps_v is None and rev_v is None:
                continue
            fy.append({"period": periods[i],
                       "eps_a": round(eps_v, 4) if eps_v is not None else None,
                       "rev_a": round(rev_v) if rev_v is not None else None,
                       "eps_e": None, "rev_e": None, "surp_pct": None})
    # collect_cn_hk_fund stores the vendor calendar's first entry verbatim, so it is only a
    # *candidate* until proven present-or-future (mastermind-terminal#474).
    return {"next_date": select_next_earnings_date(yf.get("next_earnings")), "next_period": None,
            "next_eps_est": yf.get("eps_next_avg"), "next_rev_est": yf.get("rev_next_avg"),
            "q": [], "fy": fy}


def build_ownership(yf: dict) -> dict:
    """free_float_pct = floatShares/sharesOutstanding as a 0..1 fraction (same derivation and
    units as gen_fund_us.build_ownership); closely_held_pct = yf heldPercentInsiders (already a
    fraction). No HK 13F-equivalent → top_inst stays an honest empty list."""
    fs = _f(yf.get("float_shares"))
    so = _f(yf.get("shares_out"))
    free_float = round(fs / so, 4) if (fs and so) else None
    return {"free_float_pct": free_float, "closely_held_pct": _f(yf.get("held_insider_pct")),
            "top_inst": []}


# ─────────────────────────────── emitter ───────────────────────────────
def build_fund(sym: str, rec: dict) -> dict:
    fin = rec.get("financials") or {}
    yf = rec.get("yf") or {}
    statements = build_statements(fin)
    annual = statements.get("annual")
    # HK listing currency does not establish statement units: mainland-parented issuers often
    # report in CNY and some vendor profiles omit financialCurrency altogether. Unknown must stay
    # null so consumers fail closed rather than silently mixing HKD market values with other units.
    stmt_ccy = yf.get("financial_currency") or None
    return {
        "schema": "mastermind.fund/v1",
        "ticker": sym, "asof": ASOF,
        "quote_currency": yf.get("currency") or "HKD",
        "stmt_currency": stmt_ccy,
        "src": {"statements": "akshare",
                "estimates": "yfinance" if (yf.get("eps_est") or yf.get("rev_est")) else None,
                "dividends": "akshare"},
        "profile": build_profile(yf),
        "stats": build_stats(yf),
        "statements": {"annual": annual, "quarterly": statements.get("quarterly")},
        "ratios": build_ratios(yf, annual),
        "earnings": build_earnings(yf, annual),
        "estimates": build_estimates(yf, fin),
        "analyst": build_analyst(yf),
        "dividends": build_dividends(fin, yf),
        "ownership": build_ownership(yf),
        "guidance": None,
        "segments": None,
    }


# ─────────────────────────────── merge-mode (mirrors gen_fund_cn.py) ───────────────────────────────
def _nonempty(v) -> bool:
    """True when a JSON value is meaningfully non-null/non-empty."""
    if v is None:
        return False
    if isinstance(v, (list, dict)):
        return len(v) > 0
    return True


def _merge_fund(fresh: dict, existing: dict) -> dict:
    """Preserve populated blocks from the existing fund.json when the fresh run nulls them
    (akshare returned nothing → keep statements; yfinance rate-limited → keep estimates/analyst
    and per-field profile/stats/ratios.current/earnings/ownership). Fresh non-null always wins;
    asof is always today."""
    merged = dict(fresh)
    merged["asof"] = ASOF

    fresh_stmts = fresh.get("statements") or {}
    if not _nonempty(fresh_stmts.get("annual")) and not _nonempty(fresh_stmts.get("quarterly")):
        if _nonempty(existing.get("statements")):
            merged["statements"] = existing["statements"]

    # whole-block: fresh wins when present, else preserve existing
    for key in ("estimates", "analyst", "guidance", "segments"):
        if merged.get(key) is None and existing.get(key) is not None:
            merged[key] = existing[key]

    # field-level: fresh non-null overrides, existing fills the nulls
    for blk in ("profile", "stats", "earnings", "ownership"):
        f = fresh.get(blk) or {}
        e = existing.get(blk) or {}
        m = dict(e)
        for k, v in f.items():
            if _nonempty(v):
                m[k] = v
        merged[blk] = m or (fresh.get(blk) if fresh.get(blk) is not None else existing.get(blk))

    # earnings.next_date / next_period are TEMPORAL CLAIMS, not merely "data we might be
    # missing". The field-level rule above starts from `existing` and only lets a NON-EMPTY
    # fresh value overwrite, so a correct fresh `None` - meaning "the vendor knows of no
    # future report" - loses to whatever stale date the previous artifact carried, and a past
    # date is republished forever. For these two fields the fresh emitter is authoritative in
    # both directions (mastermind-terminal#474).
    if isinstance(fresh.get("earnings"), dict) and isinstance(merged.get("earnings"), dict):
        for _tk in ("next_date", "next_period"):
            merged["earnings"][_tk] = fresh["earnings"].get(_tk)

    # ratios: preserve period series when fresh has none; merge the current snapshot per-field
    fr = fresh.get("ratios") or {}
    er = existing.get("ratios") or {}
    mr = dict(fr)
    if not _nonempty(fr.get("periods")):
        for k in ("periods", "pe", "ps", "pb", "pcf", "ev", "ev_ebitda"):
            if _nonempty(er.get(k)):
                mr[k] = er[k]
    mc = dict(er.get("current") or {})
    for k, v in (fr.get("current") or {}).items():
        if v is not None:
            mc[k] = v
    mr["current"] = mc
    merged["ratios"] = mr

    # dividends: preserve existing when it has events and fresh does not
    fresh_div = fresh.get("dividends") or {}
    if not _nonempty(fresh_div.get("events")) and _nonempty((existing.get("dividends") or {}).get("events")):
        merged["dividends"] = existing["dividends"]

    src = dict(existing.get("src") or {})
    src.update({k: v for k, v in (fresh.get("src") or {}).items() if v is not None})
    merged["src"] = src
    return merged


def hk_universe() -> list[str]:
    return sorted(p.name[:-5] for p in HK_FUND.glob("*.json"))


def _arg(argv, flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


def atomic_write(dest: Path, text: str) -> None:
    """Write via tmp+rename so a kill mid-write never leaves a truncated fund.json."""
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, dest)


def normalize_existing_artifacts(out_dir: Path, skip: set[Path] | None = None) -> tuple[int, int]:
    """Repair strict JSON in output-only HK artifacts without discarding their production data."""
    normalized = errors = 0
    skipped = skip or set()
    for dest in sorted(out_dir.glob("*.HK.fund.json")):
        if dest in skipped:
            continue
        try:
            atomic_write(dest, strict_json_dumps(json.loads(dest.read_text())))
            normalized += 1
        except Exception as exc:  # noqa: BLE001
            errors += 1
            if errors <= 20:
                print(f"  ERR normalize {dest.name}: {exc}", flush=True)
    return normalized, errors


def main(argv: list[str]) -> int:
    only = _arg(argv, "--only")
    limit = int(_arg(argv, "--limit", 0) or 0)
    out_dir = Path(_arg(argv, "--out", str(DEFAULT_OUT)))
    no_merge = "--no-merge" in argv
    out_dir.mkdir(parents=True, exist_ok=True)

    syms = ([s.strip() for s in only.split(",")] if only else hk_universe())
    syms = [s if s.endswith(".HK") else s + ".HK" for s in syms]
    if limit:
        syms = syms[:limit]

    ok = err = miss = merged_n = 0
    written: set[Path] = set()
    for sym in syms:
        cache = HK_FUND / f"{sym}.json"
        if not cache.exists():
            miss += 1
            continue
        try:
            rec = json.loads(cache.read_text())
            fund = build_fund(sym, rec)
            dest = out_dir / f"{sym}.fund.json"
            if not no_merge and dest.exists():
                try:
                    fund = _merge_fund(fund, json.loads(dest.read_text()))
                    merged_n += 1
                except Exception:
                    pass   # unreadable existing → plain fresh write
            atomic_write(dest, strict_json_dumps(fund))
            written.add(dest)
            ok += 1
        except Exception as exc:   # noqa: BLE001
            err += 1
            if err <= 20:
                print(f"  ERR {sym}: {exc}", flush=True)
    normalized_n, normalize_errors = normalize_existing_artifacts(out_dir, written)
    err += normalize_errors
    print(f"gen_fund_hk: {ok} written ({merged_n} merge-mode), "
          f"{normalized_n} output-only normalized, {err} errors, {miss} missing cache → {out_dir}",
          flush=True)
    return 1 if err or miss else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
