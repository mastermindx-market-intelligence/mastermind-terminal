"""Massive `stocks/financials/v1` statements → mastermind.fund/v1 statement blocks.

The Terminal's Statements / Revenue tabs read `statements.annual` / `statements.quarterly`
out of `terminal/public/data/<SYM>.fund.json`, which `gen_fund_us.py` builds from the
yfinance cache. yfinance only carries ~5 fiscal periods, so the deep history the tabs are
designed to page through comes from Massive's SEC-derived statements (back to 2009).

This module is the *mapping* half (pure functions + a thin HTTP client);
`backfill_fund_statements_massive.py` is the driver that merges the result into the
existing per-symbol files. Split so the mapping is unit-testable without a key or network.

ENDPOINTS (#364). The old `vX/reference/financials` answers HTTP 410 since its 2026-10-09
sunset. Its successors are three per-statement endpoints under
`https://api.massive.com/stocks/financials/v1/`: `income-statements`, `balance-sheets`,
`cash-flow-statements`. MEASURED SHAPE (M1, 2026-10-18) — built from the payload, not docs:

  * rows are FLAT — `{tickers: [..], cik, period_end, filing_date, fiscal_year,
    fiscal_quarter, timeframe, <line items>}`; no nested blocks, no {value} cells.
  * ONE row per fiscal period, and `filing_date` is the LATEST filing that reported it
    (AAPL FY2010 → 2012-10-31, the 10-K whose comparatives last carried it). There is no
    as-filed history, so a restatement cannot be observed here — see SERVES_FILING_HISTORY.
  * `fiscal_year` / `fiscal_quarter` are the issuer's fiscal calendar (AAPL Dec-2025 quarter
    = FY2026 Q1, NVDA Jan-2026 = FY2026 Q4, MSFT Sep-2025 = FY2026 Q1) — the same calendar
    gen_fund_us labels with. Annual rows carry fiscal_quarter 4.
  * batching: `tickers.any_of=A,B` works (100 symbols → 1 page, 0.7 s); `tickers=A,B`
    returns NOTHING and `tickers.in` is silently ignored (returns everything) — never use
    either for a batch. `limit=50000` is accepted; pagination is `next_url`, which carries
    only an opaque cursor.
  * errors: a bad key is HTTP 404 `Unknown API Key` (not 401); the sunset endpoint is 410;
    an unknown ticker is 200 with empty results.

⚠ `total_operating_expenses` EXCLUDES cost of revenue. AAPL FY2010:
     gross_profit 25.684B − total_operating_expenses 7.299B = operating_income 18.385B.
   That is the contract's `opex` meaning (gen_fund_us maps yfinance "Operating Expense",
   also excl-COGS), so it passes through as-is.

⚠ DEFINITIONAL GAPS. The deep vendor columns are stitched onto the yfinance columns
   gen_fund_us writes, so a vendor line with a different DEFINITION would put a false level
   shift at the join. Measured on M1 2026-10-19 (9 names, 69–78 date-matched columns per
   field, agreement within 2%):
     * served: assets / liabilities / equity 78/78, cash 76/78, capex 75/77, cfo 72/77,
       fcf 71/77, revenue 68/78, pretax 76/78, net_income 70/78.
     * `debt` 17/78 → UNCOVERED, with `net_debt`. v1 states `debt_current` and
       `long_term_debt_and_capital_lease_obligations` but no lease-liability line, while
       yfinance "Total Debt" includes leases (yf/v1 median 1.10–1.73 on 8 of 9 names).
     * `ebitda` 21/69 → UNCOVERED. The two vendors' EBITDA definitions differ by 2–14% per
       name, so neither series can extend the other.
   Classification differences that are internally consistent stay mapped. Restaurants
   (WEN, JACK) book store operating costs in v1 `cost_of_revenue` but in yfinance opex, so
   cogs / gross_profit / opex differ while op_income agrees. `nonop_income` is v1's TOTAL
   non-operating line, which is what the Statements row ("Non-operating income (total)")
   means; gen_fund_us takes yfinance "Other Income Expense", which excludes interest.

⚠ `purchase_of_property_plant_and_equipment` is POSITIVE on ~1.4% of v1 rows (full US sweep
   2026-10-19: 2,103 of 129,738 quarterly and 197 of 36,746 annual capex cells; e.g. CULP
   fiscal Q2 2025 +1.671M), where the yfinance columns hold 0 positives in 98k cells. An
   outflow line cannot be positive and the true figure is unknown, so it reads as null —
   never sign-flipped — and fcf with it.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.parse
from pathlib import Path

CA_ROOT = Path(__file__).resolve().parents[1]

API_HOST = "api.massive.com"
BASE = f"https://{API_HOST}/stocks/financials/v1"
ENDPOINTS = {
    "income": "income-statements",
    "balance": "balance-sheets",
    "cashflow": "cash-flow-statements",
}
BLOCKS = tuple(ENDPOINTS)
SOURCE_LABEL = "massive"

# v1 serves the LATEST filing per period only. A second row for one fiscal label is
# therefore never evidence of a restatement, and one row is never evidence of none.
SERVES_FILING_HISTORY = False

# Contract line items that the vendor payload cannot fill (see module docstring).
UNCOVERED: dict[str, tuple[str, ...]] = {
    "income": ("ebitda",),
    "balance": ("debt", "net_debt"),
    "cashflow": (),
}

KEY_VARS = ("MASSIVE_API_KEY", "POLYGON_API_KEY")

# Statuses that mean "every request will fail the same way" — the driver stops the sweep
# instead of spending the rest of the budget on them.
SYSTEMIC_STATUSES = frozenset({"401", "403", "404", "410"})
RETRYABLE_STATUSES = frozenset({"000", "429", "500", "502", "503", "504"})


class VendorHTTPError(RuntimeError):
    """A non-200 answer. `status` is the HTTP code as a string ("000" = no response)."""

    def __init__(self, status: str, detail: str = ""):
        self.status = status or "000"
        super().__init__(f"financials HTTP {self.status}" + (f": {detail}" if detail else ""))


class DeadlineReached(RuntimeError):
    """The caller's time budget ran out before (or during) a request. Nothing was fetched
    for the batch in flight, so the driver defers it instead of counting an error."""


# ───────────────────────────── key handling ─────────────────────────────
def api_key() -> str:
    """MASSIVE_API_KEY / POLYGON_API_KEY from the environment. Never logged."""
    for var in KEY_VARS:
        v = os.environ.get(var)
        if v and v.strip():
            return v.strip()
    raise RuntimeError("MASSIVE_API_KEY / POLYGON_API_KEY not set")


def key_from_env_file(path: str | Path) -> str | None:
    """The API key from a dotenv file, or None. Reads only KEY_VARS and exports nothing.

    The nightly lane passes ~/.macro-dashboard/.env here instead of sourcing it, so the
    key reaches this process's memory and nothing else — not the shell, not the other
    lane children, not curl's environment (`_get` strips KEY_VARS from it).
    """
    p = Path(path).expanduser()
    if not p.is_file():
        return None
    found: dict[str, str] = {}
    for line in p.read_text(errors="replace").splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        name, eq, value = line.partition("=")
        name = name.strip()
        if not eq or name not in KEY_VARS:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value:
            found[name] = value
    for var in KEY_VARS:
        if var in found:
            return found[var]
    return None


# ───────────────────────────── HTTP ─────────────────────────────
def _checked_url(url: str) -> str:
    """Only ever send the key to the vendor host over https, and never as a query param."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname != API_HOST:
        raise VendorHTTPError("000", f"refusing a non-{API_HOST} URL")
    q = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    if any(k.lower() == "apikey" for k, _ in q):
        # The Authorization header is the only carrier; a cursor that echoes a key back
        # must not put it on our command line.
        q = [(k, v) for k, v in q if k.lower() != "apikey"]
        url = urllib.parse.urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(q), "")
        )
    return url


def _curl_config(key: str) -> str:
    """curl `-K -` config carrying the bearer header — fed on stdin, so the key is never
    in argv (visible to every user via `ps`) or in a URL."""
    if any(c in key for c in "\r\n"):
        raise RuntimeError("API key contains a line break")
    esc = key.replace("\\", "\\\\").replace('"', '\\"')
    return f'header = "Authorization: Bearer {esc}"\n'


def _get(
    url: str,
    key: str,
    timeout: int = 60,
    retries: int = 2,
    deadline: float | None = None,
) -> dict:
    """One GET → parsed JSON. curl (not urllib) per ingest/polygon_bars.py: some edge
    endpoints 1010-block the default urllib user-agent.

    `deadline` is a `time.monotonic()` instant: no request starts after it and none is
    allowed to run past it, so a caller's budget is a hard bound, not a hint.
    """
    url = _checked_url(url)
    env = {k: v for k, v in os.environ.items() if k not in KEY_VARS}
    for attempt in range(retries + 1):
        limit = timeout
        if deadline is not None:
            left = deadline - time.monotonic()
            if left < 1:
                raise DeadlineReached("time budget spent")
            limit = max(1, int(min(timeout, left)))
        proc = subprocess.run(
            ["curl", "-sS", "-m", str(limit), "-w", "\n%{http_code}", "-K", "-", url],
            input=_curl_config(key),
            capture_output=True,
            text=True,
            env=env,
        )
        body, _, code = proc.stdout.rpartition("\n")
        code = code.strip() or "000"
        if code == "200":
            return json.loads(body)
        if code in RETRYABLE_STATUSES and attempt < retries:
            pause = 2.0 * (attempt + 1)
            if deadline is not None and time.monotonic() + pause >= deadline:
                raise DeadlineReached("time budget spent")
            time.sleep(pause)
            continue
        detail = ""
        try:
            detail = str(json.loads(body).get("error") or json.loads(body).get("message") or "")
        except (ValueError, AttributeError):
            pass
        raise VendorHTTPError(code, detail.replace(key, "***")[:160])
    raise VendorHTTPError("000")  # unreachable: the loop always returns or raises


def vendor_ticker(sym: str) -> str:
    """File symbol → the vendor's ticker. Class shares are dotted there (BRK.B), while the
    data dir names some with a dash (BRK-B.fund.json)."""
    return sym.strip().upper().replace("-", ".")


def fetch_rows(
    block: str,
    tickers: list[str],
    timeframe: str,
    key: str,
    limit: int = 50000,
    max_pages: int = 20,
    deadline: float | None = None,
) -> list[dict]:
    """Every `timeframe` row of one statement for `tickers` (vendor form), oldest first.

    Follows `next_url`; a cursor still open after `max_pages` raises rather than
    returning a silently truncated history (with an ascending sort the NEWEST periods are
    the ones a truncation would drop).
    """
    if not tickers:
        return []
    joined = urllib.parse.quote(",".join(tickers), safe=",.")
    who = f"tickers={joined}" if len(tickers) == 1 else f"tickers.any_of={joined}"
    url: str | None = (
        f"{BASE}/{ENDPOINTS[block]}?{who}&timeframe={timeframe}"
        f"&limit={limit}&sort=period_end.asc"
    )
    rows: list[dict] = []
    pages = 0
    while url:
        if pages >= max_pages:
            raise VendorHTTPError("000", f"{ENDPOINTS[block]} cursor still open after {max_pages} pages")
        payload = _get(url, key, deadline=deadline)
        rows.extend(payload.get("results") or [])
        url = payload.get("next_url")
        pages += 1
    return rows


def _dominant_cik(rows: list[dict]):
    """The CIK that most recently reported. A ticker the vendor tags onto two registrants
    (AMR: AMR Corp to 2013, Alpha Metallurgical since; AMBO) would otherwise interleave
    two companies' statements in one file — the same contamination the OHLC
    ticker-reuse guard exists for. The live registrant is the one that reported last."""
    best: dict = {}
    for r in rows:
        cik = r.get("cik")
        end = row_end_date(r) or ""
        last, n = best.get(cik, ("", 0))
        best[cik] = (max(last, end), n + 1)
    if not best:
        return None
    return max(best, key=lambda c: (best[c][0], best[c][1], str(c)))


def _plausible_fiscal_year(raw: dict) -> bool:
    """A fiscal year within a year of the period-end's calendar year. Anything further out
    is a mis-tagged comparative (PBT: a 2025-12-31 period served once as FY2023)."""
    end = row_end_date(raw)
    try:
        return abs(int(raw.get("fiscal_year")) - int(end[:4])) <= 1
    except (TypeError, ValueError):
        return False


def _fiscal(raw: dict) -> tuple:
    return (raw.get("fiscal_year"), raw.get("fiscal_quarter"))


def join_statements(by_block: dict[str, list[dict]]) -> list[dict]:
    """One symbol's rows from the three endpoints → ONE row per period end, oldest first.

    ⚠ MEASURED (M1, 2026-10-18, 400 names × 3 endpoints × 2 timeframes): about 0.1% of
    rows describe a period the vendor already served under a DIFFERENT fiscal label — a later
    filing's comparative re-tagged (CULP's quarter ended 2024-10-27 is FY2025 Q2 in the 10-Q
    that first reported it and "FY2024 Q4" in one filed 20 months later). Keyed on the label,
    that period would publish twice and the merge would fill one column from another
    period. So the join keys on the period END, within the dominant CIK, and splits the two
    questions a duplicate raises:

      * the LABEL comes from the earliest filing with a plausible fiscal year — the filer
        tagging its own period, before any comparative could re-tag it;
      * each statement's FIGURES come from the latest filing — the merge contract's rule
        that the later filing wins, applied here exactly as in the backfill merge.

    The joined `filing_date` is the LATEST of the chosen parts: one period's statements are
    last re-reported by different filings (a 10-K carries three years of income but two of
    balance sheet), and the column is only fully public once the last of them is.
    """
    cik = _dominant_cik([r for rows in by_block.values() for r in rows])
    cands: dict[str, list[tuple[str, dict]]] = {}
    for block in BLOCKS:
        for r in by_block.get(block) or []:
            end = row_end_date(r)
            if r.get("cik") == cik and end:
                cands.setdefault(end, []).append((block, r))
    out = []
    for end in sorted(cands):
        rows = cands[end]
        label_row = min(
            (r for _, r in rows),
            key=lambda r: (
                not _plausible_fiscal_year(r),
                row_filing_date(r) or "9999-12-31",
                str(_fiscal(r)),
            ),
        )
        statements = {}
        for block in BLOCKS:
            mine = [r for b, r in rows if b == block]
            if mine:
                statements[block] = max(
                    mine,
                    key=lambda r: (row_filing_date(r) or "", _fiscal(r) == _fiscal(label_row)),
                )
        dates = [d for d in (row_filing_date(r) for r in statements.values()) if d]
        out.append(
            {
                "cik": cik,
                "period_end": end,
                "fiscal_year": label_row.get("fiscal_year"),
                "fiscal_quarter": label_row.get("fiscal_quarter"),
                "timeframe": label_row.get("timeframe"),
                "filing_date": max(dates) if dates else None,
                "statements": statements,
            }
        )
    return out


def fetch_batch(
    symbols: list[str],
    timeframe: str,
    key: str | None = None,
    deadline: float | None = None,
) -> dict[str, list[dict]]:
    """{symbol: joined rows} for a batch of file symbols — 3 requests per timeframe.

    A symbol the vendor does not cover maps to []. Any vendor error raises, so a batch is
    all-or-nothing and the caller leaves every file in it untouched.
    """
    key = key or api_key()
    vend = {s: vendor_ticker(s) for s in symbols}
    wanted = sorted(set(vend.values()))
    per: dict[str, dict[str, list[dict]]] = {t: {b: [] for b in BLOCKS} for t in wanted}
    for block in BLOCKS:
        for r in fetch_rows(block, wanted, timeframe, key, deadline=deadline):
            for t in {str(x).upper() for x in (r.get("tickers") or [])}:
                if t in per:
                    per[t][block].append(r)
    joined = {t: join_statements(per[t]) for t in wanted}
    return {s: joined[vend[s]] for s in symbols}


def fetch_financials(ticker: str, timeframe: str, key: str | None = None) -> list[dict]:
    """All `timeframe` ('annual' | 'quarterly') joined rows for one ticker, oldest first."""
    return fetch_batch([ticker], timeframe, key)[ticker]


# ───────────────────────────── mapping ─────────────────────────────
def _v(row: dict | None, field: str):
    """A finite float from a flat v1 row, else None."""
    raw = (row or {}).get(field)
    if raw is None or isinstance(raw, bool):
        return None
    try:
        f = float(raw)
    except (TypeError, ValueError):
        return None
    return None if f != f or f in (float("inf"), float("-inf")) else f


def _first(*vals):
    """First non-null value. NOT `a or b` — a legitimate 0.0 cash flow is falsy."""
    for v in vals:
        if v is not None:
            return v
    return None


def _diff(a, b):
    return a - b if a is not None and b is not None else None


def _sum(a, b):
    return a + b if a is not None and b is not None else None


def row_end_date(raw: dict) -> str | None:
    """The period-end ISO date of a vendor (or joined) row."""
    v = raw.get("period_end")
    return v[:10] if isinstance(v, str) and len(v) >= 10 else None


def row_filing_date(raw: dict) -> str | None:
    """The filing date a row's figures come from, as an ISO date. None if unstated.

    On v1 this is the LATEST filing that reported the period, never the first — so it is a
    conservative point-in-time anchor (never earlier than first publication, so it cannot
    introduce lookahead), not the original as-filed date.
    """
    v = raw.get("filing_date")
    return v[:10] if isinstance(v, str) and len(v) >= 10 else None


def vendor_label(raw: dict, timeframe: str) -> str | None:
    """Fiscal label straight from the vendor's own `fiscal_year` / `fiscal_quarter`.

    ⚠ Why not re-derive from the period-end date: gen_fund_us's `fiscal_q_label` buckets a
    quarter by the CALENDAR MONTH of its end date. 52/53-week filers close a quarter on the
    1st of a month often enough that this bumps the quarter a full step forward —
    AAPL's fiscal Q3 2017 ended 2017-07-01 and derived as "Q4 '17", colliding with the real
    Q4 (ended 2017-09-30). Each collision silently collapses two real quarters into one
    column. The shared helper stays the fallback for rows without the fiscal fields.

    Label shapes match the fund.json contract exactly: annual "2025", quarterly "Q3 '26".
    """
    try:
        year = int(str(raw.get("fiscal_year"))[:4])
    except (TypeError, ValueError):
        return None
    if timeframe == "annual":
        return str(year)
    try:
        q = int(raw.get("fiscal_quarter"))
    except (TypeError, ValueError):
        return None
    if q not in (1, 2, 3, 4):
        return None
    return f"Q{q} '{year % 100:02d}"


def map_row(raw: dict) -> dict:
    """One joined row → {income, balance, cashflow} of contract line items.

    Every contract field is present; unavailable ones are None (never 0).
    """
    st = raw.get("statements") or {}
    inc = st.get("income")
    bal = st.get("balance")
    cfs = st.get("cashflow")

    total_assets = _v(bal, "total_assets")
    cur_assets = _v(bal, "total_current_assets")
    total_liab = _v(bal, "total_liabilities")
    cur_liab = _v(bal, "total_current_liabilities")
    cfo = _first(
        _v(cfs, "net_cash_from_operating_activities"),
        _v(cfs, "cash_from_operating_activities_continuing_operations"),
    )
    # An outflow, so never positive. A positive value is a vendor sign/derivation error, not
    # a fact (docstring), and fcf = cfo + capex would carry it at twice its size.
    capex = _v(cfs, "purchase_of_property_plant_and_equipment")
    if capex is not None and capex > 0:
        capex = None
    return {
        "income": {
            "revenue": _v(inc, "revenue"),
            "cogs": _v(inc, "cost_of_revenue"),
            "gross_profit": _v(inc, "gross_profit"),
            # contract `opex` EXCLUDES COGS — see module docstring. Passed through as-is.
            "opex": _v(inc, "total_operating_expenses"),
            "op_income": _v(inc, "operating_income"),
            "nonop_income": _v(inc, "total_other_income_expense"),
            "pretax_income": _v(inc, "income_before_income_taxes"),
            "taxes": _v(inc, "income_taxes"),
            # what EPS is computed on; consolidated (incl. minority interest) only as fallback
            "net_income": _first(
                _v(inc, "net_income_loss_attributable_common_shareholders"),
                _v(inc, "consolidated_net_income_loss"),
            ),
            "eps_basic": _v(inc, "basic_earnings_per_share"),
            "eps_diluted": _v(inc, "diluted_earnings_per_share"),
            "ebitda": None,  # UNCOVERED: a different definition from yfinance's (docstring)
        },
        "balance": {
            "assets": total_assets,
            "assets_st": cur_assets,
            "assets_lt": _diff(total_assets, cur_assets),
            "liabilities": total_liab,
            "liab_st": cur_liab,
            "liab_lt": _diff(total_liab, cur_liab),
            "equity": _first(
                _v(bal, "total_equity_attributable_to_parent"),
                _v(bal, "total_equity"),
            ),
            # UNCOVERED: v1 has no lease-liability line, so its total debt would read low
            # against the yfinance "Total Debt" columns it is stitched onto (docstring).
            "debt": None,
            "cash": _v(bal, "cash_and_equivalents"),
            "net_debt": None,
        },
        "cashflow": {
            "cfo": cfo,
            "cfi": _first(
                _v(cfs, "net_cash_from_investing_activities"),
                _v(cfs, "net_cash_from_investing_activities_continuing_operations"),
            ),
            "cff": _first(
                _v(cfs, "net_cash_from_financing_activities"),
                _v(cfs, "net_cash_from_financing_activities_continuing_operations"),
            ),
            "capex": capex,
            "fcf": _sum(cfo, capex),
        },
    }


def statement_coverage() -> dict:
    """Contract fields this vendor cannot fill, by block — drives the UI disclosure."""
    return {block: list(fields) for block, fields in UNCOVERED.items()}
