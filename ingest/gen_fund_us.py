"""Emit terminal/public/data/<SYM>.fund.json (mastermind.fund/v1) for US/ADR names from the raw
yfinance cache (collect_us_fund.py) + the Macro Dashboard US site treasure + an optional transcript index.

This is the US half of the D3 emitter (CN/HK live in gen_fund_json / pull_cn_hk_intel). It implements
the judge-fixed §1.1 contract EXACTLY:

  quote_currency  = info.currency          (trading currency — price/mktcap/dividends)
  stmt_currency   = info.financialCurrency (reporting currency — statements/estimates); differ for ADRs
                    (e.g. NIO stmt=CNY / quote=USD) — never mixed into a ratio without this field.
  estimates       = EXACTLY two FY periods (0y,+1y) and two Q periods (0q,+1q) — yfinance carries no 3rd year.
  earnings.q[]    = per-quarter EPS actual/estimate/surprise; rev_a/rev_e stay null for US (yfinance has none).
                    PLUS synthesized all-null "tx-carrier" rows (report_date null) for transcript ids that no
                    earnings_dates announcement covers — earnings_dates is a rolling window and goes stale.
  next_period     = DERIVED from the fiscal-year-end month + quarter arithmetic (algorithm documented below).
  period labels    = fiscal "Q3 '26" (quarter within the issuer's fiscal year, not the calendar quarter).
  arrays           = oldest→newest, aligned to `periods` with null holes; raw currency units (never millions).
  output           = deterministic (sort_keys + fixed section ordering) for clean rsync diffs.

Joins, all null-safe:
  * site/stockdata/<SYM>.json  — free-float/employees fallback, earnings-surprise depth, profile HQ/founded.
  * data/us_fund/_tx_index.json — {SYM: [fiscal ids]} → sets earnings.q[].tx.  A
    missing/collapsed index may never erase previously published discovery links.

Run with the macro venv:
    "<Macro Dashboard>/.venv/bin/python" ingest/gen_fund_us.py [--only AAPL,ZS] [--limit N]
"""
from __future__ import annotations

import json
import os
import sys
import datetime as dt
from pathlib import Path

CA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CA_ROOT))
from ingest.earnings_calendar import select_next_earnings_date  # noqa: E402

MACRO = Path(os.environ.get("MACRO_ROOT", "/Users/chriswong/Documents/Cluade/Macro Dashboard"))
CACHE = MACRO / "data" / "us_fund"
SITE = MACRO / "site" / "stockdata"
TX_INDEX = CACHE / "_tx_index.json"
OUT = CA_ROOT / "terminal" / "public" / "data"

SCHEMA = "mastermind.fund/v1"


# ───────────────────────────── small utils ─────────────────────────────
def g(obj, *keys, default=None):
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur


def num(v):
    """→ float (or None). Guards NaN and non-numerics; leaves bools as-is elsewhere."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


def _val_v(site: dict, key: str):
    """Null-safe read of site/stockdata/<SYM>.json valuation sub-key.

    site["valuation"]["ev_to_sales"]["v"] → float or None.
    Returns None for any missing/non-numeric step — never raises.
    """
    return num((((site or {}).get("valuation") or {}).get(key) or {}).get("v"))


class Frame:
    """A cached DataFrame ({columns, index, data}) with label-based lookups, newest-first columns."""

    def __init__(self, obj):
        self.cols = obj["columns"] if obj else []          # period-end ISO strings, NEWEST first
        self.index = obj["index"] if obj else []
        self.data = obj["data"] if obj else []
        self._row = {name: i for i, name in enumerate(self.index)}

    def __bool__(self):
        return bool(self.cols) and bool(self.index)

    def row(self, *labels):
        """First matching line-item row (list aligned to self.cols); [] if none present."""
        for lab in labels:
            i = self._row.get(lab)
            if i is not None:
                return [num(x) for x in self.data[i]]
        return []

    def at(self, labels, col_i):
        r = self.row(*labels) if isinstance(labels, tuple) else self.row(labels)
        return r[col_i] if r and col_i < len(r) else None


# ───────────────────────────── period label derivation ─────────────────────────────
_MONTHS_PER_Q = 3


def fy_end_month(cache: dict) -> int:
    """Issuer fiscal-year-end month (1-12). Prefer the annual income statement's newest column month;
    fall back to info.lastFiscalYearEnd; default to December."""
    inc = cache.get("income_stmt")
    if inc and inc.get("columns"):
        try:
            return dt.date.fromisoformat(inc["columns"][0]).month
        except Exception:
            pass
    lfy = g(cache, "info", "lastFiscalYearEnd")
    if isinstance(lfy, str):
        try:
            return dt.date.fromisoformat(lfy[:10]).month
        except Exception:
            pass
    return 12


def fiscal_q_label(period_end_iso: str, fy_end_m: int, style: str = "long") -> str | None:
    """Map a quarter period-end date to a FISCAL quarter label.

    Fiscal-quarter arithmetic: the fiscal year that a period-end belongs to is the calendar year of the
    fiscal-year-END that this period falls on/before. Quarter number = months since the START of that
    fiscal year, in 3-month steps. For a Dec-end filer this is the calendar quarter; for a Sep-end filer
    (AAPL) the Dec-31 quarter is fiscal Q1 of the NEXT calendar year, etc.

    style 'long'  -> "Q3 2026"   (used for earnings.q[].period / next_period)
    style 'short' -> "Q3 '26"    (used for statements.quarterly.periods / estimates.eps_q)
    """
    try:
        d = dt.date.fromisoformat(period_end_iso[:10])
    except Exception:
        return None
    # Fiscal year label = calendar year of the fiscal-year-end this quarter closes within.
    # Months from the fiscal-year-end month, walking forward, define the fiscal year the period ends in.
    fy_year = d.year if d.month <= fy_end_m else d.year + 1
    # Quarter index within the fiscal year: fiscal year runs (fy_end_m+1 .. fy_end_m) → Q1..Q4.
    months_after_start = (d.month - (fy_end_m + 1)) % 12    # 0..11 from the first fiscal month
    q = months_after_start // _MONTHS_PER_Q + 1
    if style == "short":
        return f"Q{q} '{fy_year % 100:02d}"
    return f"Q{q} {fy_year}"


def fy_label(period_end_iso: str, fy_end_m: int) -> str | None:
    """Annual period → fiscal-year string. FY label = calendar year the fiscal year ends in."""
    try:
        d = dt.date.fromisoformat(period_end_iso[:10])
    except Exception:
        return None
    return str(d.year if d.month <= fy_end_m else d.year + 1)


def next_period_label(next_date_iso: str | None, fy_end_m: int) -> str | None:
    """Derive the fiscal-quarter label of the UPCOMING report from its calendar date + the fiscal
    calendar. yfinance's next earnings date is the ANNOUNCEMENT date ~4-8 weeks after the quarter it
    reports; we back it up to the quarter-end it covers (the fiscal quarter whose end most recently
    preceded the announcement) and label THAT quarter."""
    if not next_date_iso:
        return None
    try:
        d = dt.date.fromisoformat(next_date_iso[:10])
    except Exception:
        return None
    # The reported quarter ends roughly one month before the announcement — step back ~35 days,
    # then snap to the nearest fiscal-quarter boundary preceding it.
    approx_end = d - dt.timedelta(days=35)
    # Snap: find the fiscal-quarter-end month on/before approx_end.month within the fiscal grid.
    # Fiscal quarter-end months are (fy_end_m, fy_end_m-3, fy_end_m-6, fy_end_m-9) mod 12.
    qend_months = {((fy_end_m - 3 * k - 1) % 12) + 1 for k in range(4)}
    m, y = approx_end.month, approx_end.year
    for _ in range(4):
        if m in qend_months:
            break
        m -= 1
        if m < 1:
            m, y = 12, y - 1
    # last day of that month
    if m == 12:
        last = dt.date(y, 12, 31)
    else:
        last = dt.date(y, m + 1, 1) - dt.timedelta(days=1)
    return fiscal_q_label(last.isoformat(), fy_end_m, style="long")


# ───────────────────────────── statement extraction ─────────────────────────────
# yfinance line-item label → schema field. Tuples try each label in order (first present wins).
INCOME_MAP = {
    "revenue": ("Total Revenue", "Operating Revenue"),
    "cogs": ("Cost Of Revenue", "Reconciled Cost Of Revenue"),
    "gross_profit": ("Gross Profit",),
    "opex": ("Operating Expense", "Total Expenses"),
    "op_income": ("Operating Income", "Total Operating Income As Reported"),
    "nonop_income": ("Other Income Expense", "Net Non Operating Interest Income Expense"),
    "pretax_income": ("Pretax Income",),
    "taxes": ("Tax Provision",),
    "net_income": ("Net Income", "Net Income Common Stockholders"),
    "eps_basic": ("Basic EPS",),
    "eps_diluted": ("Diluted EPS",),
    "ebitda": ("EBITDA", "Normalized EBITDA"),
}
BALANCE_MAP = {
    "assets": ("Total Assets",),
    "assets_st": ("Current Assets",),
    "assets_lt": ("Total Non Current Assets",),
    "liabilities": ("Total Liabilities Net Minority Interest",),
    "liab_st": ("Current Liabilities",),
    "liab_lt": ("Total Non Current Liabilities Net Minority Interest",),
    "equity": ("Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"),
    "debt": ("Total Debt",),
    "cash": ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"),
    "net_debt": ("Net Debt",),
}
CASHFLOW_MAP = {
    "cfo": ("Operating Cash Flow", "Cash Flow From Continuing Operating Activities"),
    "cfi": ("Investing Cash Flow", "Cash Flow From Continuing Investing Activities"),
    "cff": ("Financing Cash Flow", "Cash Flow From Continuing Financing Activities"),
    "capex": ("Capital Expenditure",),
    "fcf": ("Free Cash Flow",),
}


def build_block(frame: Frame, fmap: dict, order: list[str], ends: list[str]) -> dict:
    """Extract a statement block aligned to the canonical `ends` (oldest→newest ISO period-ends).

    Each statement frame (income/balance/cashflow) can carry a DIFFERENT set of period columns —
    e.g. NVDA's quarterly_cashflow has 7 columns vs quarterly_income's 5. We therefore project every
    block onto the income statement's period spine, matching by period-end date and leaving null holes
    where a given statement lacks that period, so every array stays aligned to `periods`.
    """
    # map ISO period-end → column index within the (newest-first) frame
    col_of = {c: i for i, c in enumerate(frame.cols)}
    block = {}
    for field in order:
        labels = fmap[field]
        row = frame.row(*labels)          # aligned to frame.cols (newest-first)
        out = []
        for e in ends:                    # oldest→newest canonical spine
            ci = col_of.get(e)
            out.append(row[ci] if (ci is not None and ci < len(row)) else None)
        block[field] = out
    return block


def build_statements(cache: dict, ann: Frame, qtr: Frame, fy_end_m: int) -> dict:
    inc_order = list(INCOME_MAP)
    bal_order = list(BALANCE_MAP)
    cf_order = list(CASHFLOW_MAP)

    a_ends = list(reversed(ann.cols)) if ann else []
    a_periods = [fy_label(e, fy_end_m) for e in a_ends]
    q_ends = list(reversed(qtr.cols)) if qtr else []
    q_periods = [fiscal_q_label(e, fy_end_m, style="short") for e in q_ends]

    a_bal = build_frame(cache, "balance_sheet")
    a_cf = build_frame(cache, "cashflow")
    q_bal = build_frame(cache, "quarterly_balance_sheet")
    q_cf = build_frame(cache, "quarterly_cashflow")
    return {
        "annual": {
            "periods": a_periods, "period_end": a_ends,
            "income": build_block(ann, INCOME_MAP, inc_order, a_ends),
            "balance": build_block(a_bal, BALANCE_MAP, bal_order, a_ends),
            "cashflow": build_block(a_cf, CASHFLOW_MAP, cf_order, a_ends),
        },
        "quarterly": {
            "periods": q_periods, "period_end": q_ends,
            "income": build_block(qtr, INCOME_MAP, inc_order, q_ends),
            "balance": build_block(q_bal, BALANCE_MAP, bal_order, q_ends),
            "cashflow": build_block(q_cf, CASHFLOW_MAP, cf_order, q_ends),
        },
    }


def build_frame(cache: dict, key: str) -> Frame:
    return Frame(cache.get(key))


# ───────────────────────────── ratios (from info + statements) ─────────────────────────────
def build_ratios(cache: dict, ann: Frame, fy_end_m: int, site: dict | None = None) -> dict:
    info = cache.get("info") or {}
    periods = [fy_label(e, fy_end_m) for e in reversed(ann.cols)] if ann else []
    # per-year historical ratio series are not reliably derivable from yfinance without share-price
    # history → leave as null-padded arrays aligned to the annual periods; `current` carries the snapshot.
    n = len(periods)
    empty = [None] * n
    # UNIT RULING: yfinance 1.4.1 reports dividendYield in PERCENT form (0.35 == 0.35%, 3.92 == 3.92%).
    # The fund.json contract stores div_yield/yield_ttm as a 0..1 FRACTION (sibling to gross_margin/roe/
    # payout). Always divide the percent-form by 100 → 0.0035 / 0.0392.
    div_yield = num(info.get("dividendYield"))
    if div_yield is not None:
        div_yield = div_yield / 100.0
    # UNIT RULING: yfinance reports debtToEquity in PERCENT form (AAPL 79.548 == 0.795x). The fund.json
    # contract stores debt_to_equity as a RAW RATIO (HK/CN emitters compute debt/equity directly from the
    # balance sheet → 0700.HK 0.2, 000001.SZ 0.99). Always divide the percent-form by 100.
    dte = num(info.get("debtToEquity"))
    if dte is not None:
        dte = dte / 100.0
    # EV metrics sourced from Macro Dashboard site/stockdata/<SYM>.json (valuation keys).
    # These are null until the Macro Dashboard nightly render populates stockdata — _val_v() is
    # null-safe so gen_fund_us.py works correctly before stockdata has been populated.
    current = {
        "pe_ttm": num(info.get("trailingPE")), "pe_fwd": num(info.get("forwardPE")),
        "ps": num(info.get("priceToSalesTrailing12Months")), "pb": num(info.get("priceToBook")),
        "ev_ebitda": num(info.get("enterpriseToEbitda")),
        "div_yield": div_yield, "payout": num(info.get("payoutRatio")),
        "gross_margin": num(info.get("grossMargins")), "net_margin": num(info.get("profitMargins")),
        "roe": num(info.get("returnOnEquity")), "roa": num(info.get("returnOnAssets")),
        "debt_to_equity": dte, "current_ratio": num(info.get("currentRatio")),
        "ev_sales": _val_v(site, "ev_to_sales"),
        "ev_ebit":  _val_v(site, "ev_to_ebit"),
        "p_fcf":    _val_v(site, "price_to_fcf"),
    }
    return {
        "periods": periods, "pe": list(empty), "ps": list(empty), "pb": list(empty),
        "pcf": list(empty), "ev": list(empty), "ev_ebitda": list(empty), "current": current,
    }


# ───────────────────────────── earnings ─────────────────────────────
def build_earnings(cache: dict, fy_end_m: int, tx_ids: set[str] | None) -> dict:
    cal = cache.get("calendar") or {}
    ed = build_frame(cache, "earnings_dates")

    next_date = select_next_earnings_date(cal.get("Earnings Date"))

    q_rows = []
    fy_rows = []
    if ed:
        # earnings_dates: index = report datetimes (newest first), cols EPS Estimate/Reported EPS/Surprise(%)
        ci = {c: i for i, c in enumerate(ed.cols)}
        i_est = ci.get("EPS Estimate")
        i_act = ci.get("Reported EPS")
        i_surp = ci.get("Surprise(%)")
        rows = []
        for r, ts in enumerate(ed.index):
            vals = ed.data[r]
            eps_a = num(vals[i_act]) if i_act is not None else None
            eps_e = num(vals[i_est]) if i_est is not None else None
            surp = num(vals[i_surp]) if i_surp is not None else None
            report_date = str(ts)[:10]
            # the reported quarter closes ~1 month before the announcement date
            try:
                rd = dt.date.fromisoformat(report_date)
                approx_end = (rd - dt.timedelta(days=35))
            except Exception:
                approx_end = None
            rows.append((report_date, eps_a, eps_e, surp, approx_end))
        # oldest→newest
        rows = list(reversed(rows))
        for report_date, eps_a, eps_e, surp, approx_end in rows:
            if eps_a is None:
                continue    # not yet reported (future quarter) — q[] holds ACTUALS only
            period = end = tx = None
            if approx_end is not None:
                # snap to the fiscal quarter-end preceding the announcement
                np_label = next_period_from_end(approx_end, fy_end_m)
                period, end = np_label
                if tx_ids:
                    # tx id = fiscal YYYYQn (defeatbeta label). period is "Q3 2026" → "2026Q3"
                    if period:
                        parts = period.split()
                        if len(parts) == 2 and parts[0].startswith("Q"):
                            cand = f"{parts[1]}{parts[0]}"
                            if cand in tx_ids:
                                tx = cand
            q_rows.append({
                "period": period, "end": end, "report_date": report_date,
                "eps_a": eps_a, "eps_e": eps_e, "rev_a": None, "rev_e": None,
                "surp_pct": surp, "tx": tx,
            })

    # Orphan transcripts: earnings_dates is a rolling ~8-12 announcement window (stale or ancient
    # for some names — AACG's stops in 2014), so tx ids in the index routinely cover quarters with
    # no q row and the transcript is unreachable in the UI (2026-07 audit: 3,357 of 22,789 ids
    # across 926 symbols). Synthesize a minimal tx-carrier row per orphan id (eps/rev all null —
    # q[] otherwise holds actuals only). end prefers the quarterly-statement column carrying the
    # same fiscal label, because StatementsPage joins tx by EXACT period_end string and 4-4-5
    # filers (NVDA) close quarters off month-end; fiscal month-end from the id is the fallback.
    if tx_ids:
        attached = {r["tx"] for r in q_rows if r["tx"]}
        orphans = sorted(tx_ids - attached)
        if orphans:
            qtr = build_frame(cache, "quarterly_income_stmt")
            stmt_end_by_id = {}
            for e in (qtr.cols if qtr else []):
                lbl = fiscal_q_label(e, fy_end_m, style="long")
                if lbl:
                    qn, yr = lbl.split()
                    stmt_end_by_id.setdefault(f"{yr}{qn}", e[:10])
            for tid in orphans:
                derived = tx_period_end(tid, fy_end_m)
                if derived is None:
                    continue    # malformed id — not "YYYYQn"
                period, end = derived
                q_rows.append({
                    "period": period, "end": stmt_end_by_id.get(tid, end),
                    "report_date": None,
                    "eps_a": None, "eps_e": None, "rev_a": None, "rev_e": None,
                    "surp_pct": None, "tx": tid,
                })
            q_rows.sort(key=lambda r: r["end"] or "")

    # annual EPS actual vs estimate: aggregate from the site treasure summary is unavailable per-FY;
    # yfinance has no clean FY actual/estimate pairs → leave fy[] empty-but-typed (contract allows).
    # We still emit fy rows from earnings_estimate 0y/+1y as forward estimates? No — fy[] is ACTUALS.
    # Keep fy[] to reported annual EPS from the annual income statement (eps_a only; eps_e null).
    ann = build_frame(cache, "income_stmt")
    if ann:
        eps_row = ann.row("Diluted EPS", "Basic EPS")
        for i, e in enumerate(reversed(ann.cols)):
            eps_a = list(reversed(eps_row))[i] if i < len(eps_row) else None
            fy_rows.append({"period": fy_label(e, fy_end_m), "eps_a": eps_a,
                            "eps_e": None, "rev_a": None, "rev_e": None, "surp_pct": None})

    next_period = next_period_label(next_date, fy_end_m)
    return {
        "next_date": next_date, "next_period": next_period,
        "next_eps_est": num(cal.get("Earnings Average")),
        "next_rev_est": num(cal.get("Revenue Average")),
        "q": q_rows, "fy": fy_rows,
    }


def next_period_from_end(approx_end: dt.date, fy_end_m: int):
    """Snap a rough quarter-end date to the fiscal quarter-end on/before it; return (long_label, iso_end)."""
    qend_months = {((fy_end_m - 3 * k - 1) % 12) + 1 for k in range(4)}
    m, y = approx_end.month, approx_end.year
    for _ in range(4):
        if m in qend_months:
            break
        m -= 1
        if m < 1:
            m, y = 12, y - 1
    last = (dt.date(y, 12, 31) if m == 12 else dt.date(y, m + 1, 1) - dt.timedelta(days=1))
    return fiscal_q_label(last.isoformat(), fy_end_m, style="long"), last.isoformat()


def tx_period_end(tx_id: str, fy_end_m: int):
    """Invert a defeatbeta fiscal id ("2025Q3") to (long label, ISO quarter-end) under the
    issuer's fiscal calendar — the exact inverse of fiscal_q_label's month math, so the
    derived end round-trips: fiscal_q_label(end) == label. None for malformed ids."""
    if len(tx_id) != 6 or tx_id[4] != "Q" or not (tx_id[:4].isdigit() and tx_id[5].isdigit()):
        return None
    fy_year, q = int(tx_id[:4]), int(tx_id[5])
    if not 1 <= q <= 4:
        return None
    m = (fy_end_m + 3 * q - 1) % 12 + 1                     # last month of fiscal quarter q
    y = fy_year if m <= fy_end_m else fy_year - 1
    last = dt.date(y, 12, 31) if m == 12 else dt.date(y, m + 1, 1) - dt.timedelta(days=1)
    return f"Q{q} {fy_year}", last.isoformat()


# ───────────────────────────── estimates ─────────────────────────────
def build_estimates(cache: dict, fy_end_m: int) -> dict | None:
    ee = build_frame(cache, "earnings_estimate")
    re = build_frame(cache, "revenue_estimate")
    if not ee and not re:
        return None

    def frow(frame: Frame, row_label: str, col: str):
        if not frame:
            return None
        ci = {c: i for i, c in enumerate(frame.cols)}
        ri = {r: i for i, r in enumerate(frame.index)}
        if row_label not in ri or col not in ci:
            return None
        return num(frame.data[ri[row_label]][ci[col]])

    # yfinance rows: 0q,+1q (forward quarters), 0y,+1y (current & next fiscal year)
    cal = cache.get("calendar") or {}
    # FY period labels: current FY and next FY. Derive from lastFiscalYearEnd if present.
    lfy = g(cache, "info", "lastFiscalYearEnd")
    base_fy = None
    if isinstance(lfy, str):
        try:
            base_fy = fy_label(lfy, fy_end_m)
        except Exception:
            base_fy = None
    if base_fy is None:
        ann = build_frame(cache, "income_stmt")
        if ann and ann.cols:
            base_fy = fy_label(ann.cols[0], fy_end_m)
    fy0 = int(base_fy) + 1 if base_fy else None   # 0y = the fiscal year currently in progress
    eps_fy_periods = [str(fy0), str(fy0 + 1)] if fy0 else [None, None]
    rev_fy_periods = list(eps_fy_periods)

    # Q period labels for eps_q (0q,+1q). next_date's quarter is 0q; next is +1q.
    next_date = select_next_earnings_date(cal.get("Earnings Date"))
    q0 = q1 = None
    if next_date:
        try:
            d0 = dt.date.fromisoformat(next_date[:10])
            approx0 = d0 - dt.timedelta(days=35)
            q0lbl, _ = next_period_from_end(approx0, fy_end_m)
            # convert long "Q3 2026" → short "Q3 '26"
            q0 = _short_from_long(q0lbl)
            approx1 = approx0 + dt.timedelta(days=91)
            q1lbl, _ = next_period_from_end(approx1, fy_end_m)
            q1 = _short_from_long(q1lbl)
        except Exception:
            pass

    def fy_series(frame, metric_rows):
        return {
            "avg": [frow(frame, r, "avg") for r in metric_rows],
            "high": [frow(frame, r, "high") for r in metric_rows],
            "low": [frow(frame, r, "low") for r in metric_rows],
            "n": [_int(frow(frame, r, "numberOfAnalysts")) for r in metric_rows],
        }

    eps_fy = {"periods": eps_fy_periods, **fy_series(ee, ["0y", "+1y"])}
    rev_fy = {"periods": rev_fy_periods, **fy_series(re, ["0y", "+1y"])}
    eps_q = {"periods": [q0, q1], **fy_series(ee, ["0q", "+1q"])}

    growth = {
        "rev_yoy": frow(re, "0y", "growth"),
        "eps_yoy": frow(ee, "0y", "growth"),
    }
    return {"eps_fy": eps_fy, "rev_fy": rev_fy, "eps_q": eps_q, "growth": growth}


def _short_from_long(lbl: str | None):
    if not lbl:
        return None
    parts = lbl.split()
    if len(parts) == 2 and parts[0].startswith("Q"):
        return f"{parts[0]} '{int(parts[1]) % 100:02d}"
    return lbl


def _int(v):
    v = num(v)
    return int(v) if v is not None else None


# ───────────────────────────── analyst ─────────────────────────────
def build_analyst(cache: dict) -> dict | None:
    info = cache.get("info") or {}
    rs = build_frame(cache, "recommendations_summary")
    apt = cache.get("analyst_price_targets") or {}
    dist = {"strongBuy": 0, "buy": 0, "hold": 0, "sell": 0, "strongSell": 0}
    have_dist = False
    if rs:
        ci = {c: i for i, c in enumerate(rs.cols)}
        # newest period is row 0 ("0m")
        row0 = rs.data[0] if rs.data else []
        for key in dist:
            if key in ci and ci[key] < len(row0):
                v = _int(row0[ci[key]])
                if v is not None:
                    dist[key] = v
                    have_dist = have_dist or v > 0
    rating_label = _rating_from_key(info.get("recommendationKey")) or (
        info.get("averageAnalystRating") or None)
    target = {
        "mean": num(apt.get("mean")) if apt else num(info.get("targetMeanPrice")),
        "high": num(apt.get("high")) if apt else num(info.get("targetHighPrice")),
        "low": num(apt.get("low")) if apt else num(info.get("targetLowPrice")),
        "n": _int(info.get("numberOfAnalystOpinions")),
    }
    if not have_dist and not any(v is not None for v in target.values()) and not rating_label:
        return None
    return {"dist": dist, "rating_label": rating_label, "target": target}


def _rating_from_key(key):
    return {
        "strong_buy": "Strong buy", "buy": "Buy", "hold": "Hold",
        "underperform": "Underperform", "sell": "Sell",
    }.get(key)


# ───────────────────────────── dividends ─────────────────────────────
def build_dividends(cache: dict) -> dict:
    info = cache.get("info") or {}
    divs = cache.get("dividends")
    splits = cache.get("splits")
    events = []
    never_paid = True
    if divs and divs.get("values"):
        never_paid = False
        for ex, amt in zip(divs["index"], divs["values"]):
            a = num(amt)
            if a is None:
                continue
            events.append({"ex": str(ex)[:10], "amount": a, "pay": None, "type": "regular"})
    split_events = []
    if splits and splits.get("values"):
        for d, ratio in zip(splits["index"], splits["values"]):
            r = num(ratio)
            if r is None:
                continue
            # yfinance split value 4.0 == a 4:1 split
            rr = f"{int(r)}:1" if r == int(r) else f"{r}:1"
            split_events.append({"date": str(d)[:10], "ratio": rr})
    # UNIT RULING: yfinance dividendYield is percent-form → normalize to a 0..1 fraction.
    dy = num(info.get("dividendYield"))
    if dy is not None:
        dy = dy / 100.0
    return {
        "never_paid": never_paid,
        "yield_ttm": dy,
        "payout_ratio": num(info.get("payoutRatio")),
        "events": events, "splits": split_events,
    }


# ───────────────────────────── ownership / stats / profile ─────────────────────────────
def build_ownership(cache: dict, site: dict) -> dict:
    info = cache.get("info") or {}
    ih = build_frame(cache, "institutional_holders")
    mh = build_frame(cache, "major_holders")
    top = []
    if ih:
        ci = {c: i for i, c in enumerate(ih.cols)}
        for r in range(min(len(ih.index), 10)):
            row = ih.data[r]
            name = row[ci["Holder"]] if "Holder" in ci else None
            pct = num(row[ci["pctHeld"]]) if "pctHeld" in ci else None
            val = num(row[ci["Value"]]) if "Value" in ci else None
            top.append({"name": name, "pct": pct, "value": val})
    # free float: prefer yfinance floatShares/sharesOutstanding; site treasure has no direct float pct
    fs = num(info.get("floatShares"))
    so = num(info.get("sharesOutstanding"))
    free_float = round(fs / so, 4) if (fs and so) else None
    closely = None
    insiders = num(info.get("heldPercentInsiders"))
    if insiders is not None:
        closely = insiders
    elif mh:
        # major_holders index labels vary; look for insidersPercentHeld
        ri = {r: i for i, r in enumerate(mh.index)}
        if "insidersPercentHeld" in ri:
            closely = num(mh.data[ri["insidersPercentHeld"]][0])
    return {"free_float_pct": free_float, "closely_held_pct": closely, "top_inst": top}


def build_stats(cache: dict) -> dict:
    info = cache.get("info") or {}
    return {
        "mktcap": num(info.get("marketCap")),
        "shares_out": num(info.get("sharesOutstanding")),
        "float_shares": num(info.get("floatShares")),
        "inst_pct": num(info.get("heldPercentInstitutions")),
        "insider_pct": num(info.get("heldPercentInsiders")),
        "beta": num(info.get("beta")),
        "num_holders": None,
    }


def build_profile(cache: dict, site: dict) -> dict:
    info = cache.get("info") or {}
    sp = (site or {}).get("profile") or {}
    hq = sp.get("hq")
    if not hq:
        parts = [info.get("city"), info.get("state"), info.get("country")]
        hq = ", ".join([p for p in parts if p]) or None
    return {
        "website": info.get("website"),
        "employees": num(info.get("fullTimeEmployees")) or sp.get("employees"),
        "sector": info.get("sector") or sp.get("sector"),
        "industry": info.get("industry") or sp.get("sic_description"),
        "description": info.get("longBusinessSummary") or sp.get("description"),
        "founded": sp.get("founded"),
        "hq": hq,
    }


# ───────────────────────────── top-level assembly ─────────────────────────────
def build_fund(sym: str, cache: dict, site: dict, tx_ids: set[str] | None) -> dict:
    info = cache.get("info") or {}
    fy_end_m = fy_end_month(cache)
    ann = build_frame(cache, "income_stmt")
    qtr = build_frame(cache, "quarterly_income_stmt")

    quote_ccy = info.get("currency") or "USD"
    stmt_ccy = info.get("financialCurrency") or quote_ccy

    estimates = build_estimates(cache, fy_end_m)
    analyst = build_analyst(cache)
    asof = dt.date.today().isoformat()

    fund = {
        "schema": SCHEMA,
        "ticker": sym,
        "asof": asof,
        "quote_currency": quote_ccy,
        "stmt_currency": stmt_ccy,
        "src": {
            "statements": "yfinance",
            "estimates": "yfinance" if estimates else None,
            "dividends": "yfinance",
        },
        "profile": build_profile(cache, site),
        "stats": build_stats(cache),
        "statements": build_statements(cache, ann, qtr, fy_end_m),
        "ratios": build_ratios(cache, ann, fy_end_m, site),
        "earnings": build_earnings(cache, fy_end_m, tx_ids),
        "estimates": estimates,
        "analyst": analyst,
        "dividends": build_dividends(cache),
        "ownership": build_ownership(cache, site),
        "guidance": None,
        "segments": None,
    }
    return fund


# section key order for deterministic top-level output (sort_keys handles nested dicts)
TOP_ORDER = ["schema", "ticker", "asof", "quote_currency", "stmt_currency", "src", "profile",
             "stats", "statements", "ratios", "earnings", "estimates", "analyst",
             "dividends", "ownership", "guidance", "segments"]


def dump(fund: dict) -> str:
    ordered = {k: fund[k] for k in TOP_ORDER if k in fund}
    return json.dumps(ordered, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def atomic_write(dest: Path, text: str) -> None:
    """Write text to dest via tmp+rename so a kill mid-write never leaves a truncated file."""
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, dest)


# ───────────────────────────── driver ─────────────────────────────
def _published_tx_pairs() -> set[tuple[str, str]]:
    """Return exact ``(ticker, id)`` pairs discoverable in fund payloads."""
    pairs: set[tuple[str, str]] = set()
    for path in OUT.glob("*.fund.json"):
        try:
            payload = json.loads(path.read_text())
            sym = str(payload.get("ticker") or path.name.removesuffix(".fund.json")).upper()
            linked = {
                row.get("tx")
                for row in ((payload.get("earnings") or {}).get("q") or [])
                if row.get("tx")
            }
        except Exception:
            continue
        pairs.update((sym, tx_id) for tx_id in linked if isinstance(tx_id, str))
    return pairs


def _normalize_tx_map(raw: object) -> dict[str, list[str]]:
    """Strict local normalization keeps this standalone emitter import-safe."""
    if not isinstance(raw, dict):
        raise ValueError("transcript index must be an object")
    clean: dict[str, list[str]] = {}
    for raw_sym, raw_values in raw.items():
        if not isinstance(raw_sym, str) or not raw_sym.strip() or not isinstance(raw_values, list):
            raise ValueError("transcript entries must map symbol strings to ID arrays")
        sym = raw_sym.strip().upper()
        ids: set[str] = set()
        for value in raw_values:
            if not (
                isinstance(value, str)
                and len(value) == 6
                and value[:4].isdigit()
                and value[4] == "Q"
                and value[5] in "1234"
            ):
                raise ValueError(f"invalid transcript ID for {sym}: {value!r}")
            ids.add(value)
        if ids:
            clean[sym] = sorted(ids)
    return clean


def load_tx_index() -> dict:
    """Load and guard the transcript discovery map.

    The old fail-open ``{}`` behavior allowed a missing Macro-root index to
    overwrite thousands of valid fund payloads with ``tx:null``.  Preserve the
    last-good surface instead: malformed/missing input is fatal when any links
    are already published, and every published ticker/ID pair is immutable.
    """
    published_pairs = _published_tx_pairs()
    if not TX_INDEX.exists():
        if published_pairs:
            raise RuntimeError(
                f"transcript index absent at {TX_INDEX}; refusing to erase "
                f"{len(published_pairs)} published links"
            )
        return {}
    try:
        raw = json.loads(TX_INDEX.read_text())
    except Exception as exc:
        raise RuntimeError(f"transcript index unreadable: {exc}") from exc
    try:
        clean = _normalize_tx_map(raw)
        candidate_pairs = {(sym, tx_id) for sym, ids in clean.items() for tx_id in ids}
        missing = sorted(published_pairs - candidate_pairs)
    except ValueError as exc:
        raise RuntimeError(f"transcript index invalid: {exc}") from exc
    if missing:
        preview = ", ".join(f"{sym}/{tx_id}" for sym, tx_id in missing[:8])
        suffix = f" (+{len(missing) - 8} more)" if len(missing) > 8 else ""
        raise RuntimeError(
            "transcript index would remove published links: "
            f"{preview}{suffix}; preserving last good"
        )
    return clean


def main(argv: list[str]) -> None:
    only = None
    limit = 0
    if "--only" in argv:
        only = [s.strip().upper() for s in argv[argv.index("--only") + 1].split(",") if s.strip()]
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])

    OUT.mkdir(parents=True, exist_ok=True)
    tx_map = load_tx_index()

    if only:
        syms = only
    else:
        # cache glob ∪ tx-index: a transcript-indexed name must get a fund.json even if the raw
        # collect never succeeded for it, or its transcripts are unreachable in the UI.
        syms = sorted({p.stem for p in CACHE.glob("*.json") if not p.name.startswith("_")} | set(tx_map))
    if limit:
        syms = syms[:limit]

    ok = miss = err = 0
    for sym in syms:
        cf = CACHE / f"{sym}.json"
        if not cf.exists() and not tx_map.get(sym):
            miss += 1
            print(f"  {sym}: no cache", flush=True)
            continue
        try:
            # No cache but transcripts indexed → build from an empty cache: build_earnings synthesizes
            # tx-carrier q rows, so the transcripts stay reachable; the next collect upgrades the file.
            cache = json.loads(cf.read_text()) if cf.exists() else {}
            sf = SITE / f"{sym}.json"
            site = json.loads(sf.read_text()) if sf.exists() else {}
            tx_ids = set(tx_map.get(sym) or []) or None
            fund = build_fund(sym, cache, site, tx_ids)
            atomic_write(OUT / f"{sym}.fund.json", dump(fund))
            ok += 1
        except Exception as exc:  # noqa: BLE001
            err += 1
            print(f"  ERR {sym}: {type(exc).__name__} {exc}", flush=True)
    print(f"gen_fund_us: {ok} emitted, {miss} no-cache, {err} errors "
          f"(tx_index {len(tx_map)} names)", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
