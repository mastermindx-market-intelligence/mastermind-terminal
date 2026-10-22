"""Shared, dependency-free rules for mainland-China (CN) financial statements.

WHY THIS EXISTS — two defects that each had more than one copy:

1. The collector derived *whole-market completeness* from `set(cached end_dates)`. A period
   is therefore "done" the moment ONE ticker has a row for it, so a pull that returned 3% of
   the market was recorded as complete and never revisited. Completeness is a per-period fact
   about a pull, not a fact about the union of rows, so it is tracked as an explicit receipt
   (`period_receipt`) rather than inferred. Rows that ARE valid are kept regardless.

2. The emitter differenced quarterly EPS as if it were an additive flow. Chinese interim
   reports publish *weighted-average* EPS for the cumulative year-to-date window, and each
   filing uses a different share denominator, so `cum_n − cum_{n−1}` is not the quarter. The
   same differencing block was copied into two functions, which is how both drifted the same
   way. Revenue and net income ARE additive, so those may be differenced — but only across
   the immediately preceding quarter of the SAME fiscal year, never across a gap.

This module holds the shared arithmetic for both, so the collector's revision precedence and
the emitter's discrete-quarter rule each have exactly one implementation.

Pure Python and no pandas/tushare import, so both the collector and the emitter can use it and
tests can pin it with no provider, token, or cache on disk.

Vendor semantics below are taken from the Tushare statement documentation, which describes
`income_vip` / `balancesheet_vip` / `cashflow_vip` as taking the same parameters as their
non-VIP counterparts:

  * `period`      — the reporting period, e.g. 20171231. The VIP form returns the WHOLE market
                    for that period, which is why a period is the unit of completeness.
  * `report_type` — 1..12; `1` is 合并报表 (consolidated) and `6` is 母公司报表 (parent-only).
                    Only consolidated rows are comparable across issuers.
  * `ann_date` / `f_ann_date` — announcement date / actual announcement date. These are the
                    facts a revision is ordered by; "the last row the API happened to return"
                    is not.
  * `update_flag` — 更新标志, `1` marks the latest revision of a period.

NOTE ON PAGINATION: those same docs list no `limit` / `offset` input and no per-call row cap,
so this code never synthesizes page semantics. Truncation is instead *detected* from the
returned ticker count against a comparable period (`truncated_period`), and an unproven period
stays incomplete and is retried.
"""
from __future__ import annotations

import json
from pathlib import Path

# ─────────────────────────────── period arithmetic ───────────────────────────────
#: Calendar quarter-end (MMDD) → quarter number. CN A-share fiscal years end 12-31.
QUARTER_ENDS: dict[str, int] = {"0331": 1, "0630": 2, "0930": 3, "1231": 4}

#: The fiscal period immediately preceding each quarter-end. Crossing 12-31 moves to the prior
#: year's 09-30, so "contiguous" is calendar-contiguous and not array-contiguous.
_PRIOR_QUARTER_END: dict[str, str] = {"0331": "1231", "0630": "0331", "0930": "0630", "1231": "0930"}


def _digits(value) -> str:
    """Tushare dates arrive as YYYYMMDD (sometimes numpy ints); normalize to a digit string."""
    return "".join(ch for ch in str(value) if ch.isdigit())


def normalize_period(value) -> str:
    """Any YYYYMMDD-ish input → canonical 'YYYYMMDD', or '' when unusable."""
    digits = _digits(value)
    return digits if len(digits) == 8 else ""


def quarter_number(end_date) -> int | None:
    """1..4 for a quarter-end, else None."""
    period = normalize_period(end_date)
    return QUARTER_ENDS.get(period[4:8]) if period else None


def is_quarter_end(end_date) -> bool:
    return quarter_number(end_date) is not None


def quarter_label(end_date) -> str:
    """'Q2 2026' — the label shape the fund contract and frontend both parse."""
    period = normalize_period(end_date)
    number = quarter_number(period)
    return f"Q{number} {period[:4]}" if number else period


def prior_quarter_end(end_date) -> str | None:
    """The calendar quarter-end immediately before `end_date`, or None if not a quarter-end."""
    period = normalize_period(end_date)
    if not period or not is_quarter_end(period):
        return None
    month_day = _PRIOR_QUARTER_END[period[4:8]]
    year = int(period[:4]) - (1 if month_day == "1231" else 0)
    return f"{year:04d}{month_day}"


def parse_quarter_label(label) -> tuple[str | None, int | None]:
    """'Q2 2026' → ('2026', 2). The inverse of `quarter_label`, for rows read back from a
    published fund.json where only the label survives. Returns (None, None) if unparseable."""
    parts = str(label or "").strip().split()
    if len(parts) != 2 or not parts[0].startswith("Q") or not parts[1].isdigit():
        return None, None
    try:
        quarter = int(parts[0][1:])
    except ValueError:
        return None, None
    if quarter not in (1, 2, 3, 4):
        return None, None
    return parts[1], quarter


def prior_quarter(year, quarter) -> tuple[str, int]:
    """The (fiscal_year, quarter) immediately before the given one, crossing the year boundary."""
    return (year, quarter - 1) if quarter > 1 else (str(int(year) - 1), 4)


def contiguous_prior(present_periods, end_date) -> str | None:
    """The differencing base for `end_date`, or None when no valid base exists.

    A base exists only when the *immediately preceding* quarter-end of the same fiscal year is
    among `present_periods`. This is the guard the emitter was missing: with Q1 absent, Q2 has
    no base and must not be differenced, and Q3 must not borrow Q2 either.
    """
    base = prior_quarter_end(end_date)
    if base is None:
        return None
    available = {normalize_period(p) for p in present_periods}
    return base if base in available else None


def report_date(ann_date, f_ann_date=None) -> str | None:
    """Announcement date as YYYY-MM-DD.

    `f_ann_date` (实际公告日期) is the date actually published and is preferred when present;
    `ann_date` is the vendor's filing date. Both are strings/numbers of YYYYMMDD form.
    """
    for candidate in (f_ann_date, ann_date):
        period = normalize_period(candidate)
        if period:
            return f"{period[:4]}-{period[4:6]}-{period[6:8]}"
    return None


# ─────────────────────────────── revision precedence ───────────────────────────────
#: 合并报表 (consolidated) — the only scope comparable across issuers. Parent-only (母公司报表,
#: code 6) is a different entity and must never displace a consolidated row.
CONSOLIDATED_REPORT_TYPES = frozenset({"1", "合并报表"})


def is_consolidated(row: dict) -> bool:
    """True when the row is a consolidated statement.

    A row with no `report_type` at all is treated as consolidated: that is the pre-metadata
    shape every already-cached parquet has, and refusing to trust it would discard good
    history. Rows that DO declare a non-consolidated type are rejected.
    """
    declared = str(row.get("report_type") or "").strip()
    if not declared:
        return True
    return declared in CONSOLIDATED_REPORT_TYPES


def revision_rank(row: dict) -> tuple:
    """Sort key for competing rows of one (ts_code, end_date); HIGHER wins.

    Ordered by the facts the vendor actually publishes, never by arrival order:
      1. consolidated scope beats parent-only,
      2. update_flag 1 (更新标志: latest) beats any other,
      3. later f_ann_date (actual announcement) wins — this is the restatement,
      4. later ann_date wins as a final dated tiebreak.
    The last element is a stable text tiebreak so the result is deterministic even for rows
    that agree on every published fact.
    """
    flag = row.get("update_flag")
    try:
        flag_rank = 1 if int(float(flag)) == 1 else 0
    except (TypeError, ValueError):
        flag_rank = 0
    f_ann = normalize_period(row.get("f_ann_date"))
    ann = normalize_period(row.get("ann_date"))
    return (
        1 if is_consolidated(row) else 0,
        flag_rank,
        f_ann,
        ann,
        str(row.get("ts_code") or ""),
        repr(sorted((k, str(v)) for k, v in row.items())),
    )


def pick_revision(rows) -> dict | None:
    """The single winning row from competing revisions, or None when nothing is eligible.

    Parent-only rows are dropped before ranking, so an unconsolidated revision can never
    overwrite the consolidated statement it competes with.
    """
    eligible = [r for r in rows if r and is_consolidated(r)]
    if not eligible:
        return None
    return max(eligible, key=revision_rank)


def revision_key(row: dict) -> tuple:
    """Dedupe key for a cached row; a newer revision supersedes an older one on the same key."""
    return (str(row.get("ts_code") or ""), normalize_period(row.get("end_date")))


# ─────────────────────────────── period receipts ───────────────────────────────
#: Pull outcomes. Only COMPLETE closes a period; everything else is retried next run.
COMPLETE = "complete"
TRUNCATED = "truncated"
EMPTY = "empty"
FAILED = "failed"


def period_receipts(path) -> dict[str, dict]:
    """Load the per-period receipt ledger, tolerating a missing/corrupt file."""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def save_period_receipts(path, receipts: dict[str, dict]) -> None:
    """Persist the receipt ledger atomically (tmp+rename)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(receipts, sort_keys=True, indent=2))
    tmp.replace(p)


def periods_to_pull(periods, receipts, *, force=False, refresh_periods=6) -> list[str]:
    """Which periods this run must request, given the receipt ledger.

    A period is pulled when any of these hold:
      * `force` — operator asked for a full rebuild;
      * no receipt, or the last pull did not reach COMPLETE — an incomplete period is retried,
        which is precisely the case the old "is any row cached for this end_date?" test got
        wrong and silently skipped forever;
      * it falls inside the newest `refresh_periods` — a rolling overlap window so restatements
        and late corrections to recent filings are picked up without a full rebuild.

    Everything else is left alone: historical periods that closed COMPLETE keep their rows.
    """
    ordered = [normalize_period(p) for p in periods]
    ordered = [p for p in ordered if p]
    # The rolling window is the newest N periods by value, so the caller's ordering cannot
    # decide which end is "newest" (the collector passes newest→oldest, tests may not).
    newest = set(sorted(ordered, reverse=True)[:max(0, int(refresh_periods))])
    todo = []
    for period in ordered:
        if force or period in newest:
            todo.append(period)
            continue
        receipt = receipts.get(period)
        if not isinstance(receipt, dict) or receipt.get("status") != COMPLETE:
            todo.append(period)
    return todo


def comparable_period(end_date) -> str | None:
    """The same quarter-end one fiscal year earlier — the reference for truncation.

    A whole-market pull for 20260331 should cover roughly the same issuer set as 20250331.
    Comparing to the same quarter a year back absorbs the strong seasonality in how many CN
    issuers have filed by any given date (a March annual-report deadline is not a June one),
    which a flat "compare to the biggest period ever" threshold cannot.
    """
    period = normalize_period(end_date)
    if not is_quarter_end(period):
        return None
    return f"{int(period[:4]) - 1:04d}{period[4:8]}"


def truncated_period(end_date, ticker_count, receipts, fallback_reference=None) -> bool:
    """True when a pull is too thin to be a whole-market result.

    The reference is, in order of preference:
      1. the same quarter one fiscal year earlier, when that period closed COMPLETE with a
         recorded ticker count. This absorbs the strong seasonality in how many CN issuers have
         filed by a given date — a March annual-report deadline is not a June one — which a flat
         "compare to the biggest period ever" threshold cannot;
      2. `fallback_reference`, normally the widest cross-section observed in the SAME run. This
         is what makes a cold start work: with no receipt ledger at all, the 28 periods pulled
         together still reveal the market's breadth, so a period returning a fraction of the
         widest one is still caught instead of being accepted as complete.

    With no reference at all there is nothing to prove truncation, so the period is accepted:
    an unproven shortfall is reported as unknown, never as failure.
    """
    period = normalize_period(end_date)
    reference_period = comparable_period(period)
    reference = receipts.get(reference_period) if reference_period else None
    if not (isinstance(reference, dict) and reference.get("status") == COMPLETE):
        reference = None

    try:
        count = int(ticker_count)
        if isinstance(reference, dict):
            reference_count = int(reference.get("tickers") or 0)
        else:
            reference_count = int(fallback_reference or 0)
    except (TypeError, ValueError):
        return False
    if reference_count <= 0:
        return False
    # A thin margin: whole-market pulls vary a little as issuers are listed/delisted, and a
    # restated cross-section can legitimately differ. Only a material shortfall is a suspect.
    return count < reference_count * 0.90


# ─────────────────────────────── discrete-quarter normalization ───────────────────────────────
#: Flows that genuinely add across a cumulative year-to-date window.
ADDITIVE_FIELDS = frozenset({"total_revenue", "revenue", "n_income", "n_income_attr_p"})
#: Per-share ratios. Weighted-average EPS uses a different denominator in every filing, so it
#: is NEVER recovered by subtraction.
NON_ADDITIVE_FIELDS = frozenset({"basic_eps", "diluted_eps"})


def quarter_of(end_date) -> int | None:
    """Quarter number 1..4 from either a 'YYYYMMDD' period end OR a bare quarter number.

    Both forms occur: the collector/emitter path keys rows by end_date, while the
    merge-mode fallback rebuilds from a published fund.json where only the 'Q2 2026' label
    survives and only the quarter number is available.
    """
    if isinstance(end_date, int) and not isinstance(end_date, bool):
        return end_date if end_date in (1, 2, 3, 4) else None
    return quarter_number(end_date)


def discrete_value(field, end_date, cumulative, base_cumulative, *, published_discrete=None):
    """Discrete single-quarter value for one cumulative field, with its basis.

    Returns `(value, basis)` where `basis` records WHY the number is what it is, so a consumer
    never has to guess whether it read a filing or a difference:

      "as_reported"       — the period is Q1, where the cumulative window IS the quarter and
                            the filed figure is already discrete;
      "published"         — the source published this figure as a discrete quarter directly;
      "derived"           — differenced from the immediately preceding quarter of the same
                            fiscal year (additive fields only);
      "not_disclosable"   — non-additive field with no base that can be safely differenced;
      "no_base"           — additive field whose preceding quarter is missing, or a field not
                            positively known to be additive (never differenced on assumption);
      "missing"           — the source carries no value for this field and period at all.

    "missing" is checked FIRST so an absent figure is never reported as though it had been
    filed and merely withheld: a dash caused by no data and a dash caused by unsafe arithmetic
    are different facts, and only one of them means anything about the issuer.

    Weighted-average EPS is non-additive by construction: the H1 filing divides six months of
    earnings by a six-month weighted share count and the Q1 filing divides three months by a
    three-month weighted count, so the difference of the two is not the second quarter. Only a
    directly published discrete EPS may be used; otherwise Q2+ stays null and says why.
    """
    if published_discrete is not None:
        return published_discrete, "published"
    if cumulative is None:
        return None, "missing"

    if quarter_of(end_date) == 1:
        # The cumulative window IS the first quarter, so the filed figure is already discrete.
        return cumulative, "as_reported"

    if field in NON_ADDITIVE_FIELDS:
        # Q2..Q4 weighted-average per-share figure: there is no safe difference to take.
        return None, "not_disclosable"

    if field not in ADDITIVE_FIELDS or base_cumulative is None:
        # A field not positively known to be additive is never differenced on assumption.
        return None, "no_base"
    return cumulative - base_cumulative, "derived"