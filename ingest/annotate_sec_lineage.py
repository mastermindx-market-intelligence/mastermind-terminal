"""Stamp each statement column with the SEC filing its figure comes from (E11-03, #922).

WHY THIS EXISTS. `gen_fund_us.py` rebuilds terminal/public/data/<SYM>.fund.json from yfinance
every night, and yfinance serves only the figure as it stands today. When a company recasts a
year (GE restated FY2022 revenue from 76,555M to 58,100M to 29,139M across three filings), the
recast figure lands in the column with nothing saying so: a corrected number reads as the
original published fact. The UI already discloses a restatement when the file carries
`statements.<annual|quarterly>.filed_by_period[]` / `restated_by_period[]`; the only writer of
those arrays (the vendor backfill) lost its endpoint (HTTP 410) and never ran in the nightly.
This pass writes them from SEC XBRL companyfacts, which keeps every filing's value for every
period, and runs in ops/nightly_fund.sh right after gen_fund_us.

WHAT A STAMP CLAIMS. A column is checked against SEC on three anchors: revenue, net income and
total assets (us-gaap, USD). Revenue is required; the other two corroborate. For each anchor:
  - The SEC values reported for the period are grouped into figures, per concept. Two values are
    one figure only when they agree at their reported precision (inferred from trailing zeros, up
    to millions) and sit within 1% of each other. So 9,481M vs 9,482M, or 80,449K vs 80M, is one
    figure, but 500.0M vs 498.0M is a restatement.
  - The latest filing for the period decides which figures are current. A concept that filing no
    longer reports is either a predecessor or a parallel measure. A predecessor is a tag switch:
    it never shares a filing with its successor, so its figures are earlier versions. A parallel
    measure was reported beside the matched concept in some filing, and is never pooled.
  - The displayed number must be one of the current figures. If it sits between two different
    figures, closer to both than their precision allows, no claim is made.
Then:
  - `filed_by_period[i]`  = the date the displayed figure was FIRST filed, under its concept or a
    predecessor (latest over the anchors);
  - `restated_by_period[i]` = an earlier filing reported a DIFFERENT figure for the period, under
    the same concept or a predecessor.
`src.statement_lineage = "sec_companyfacts"` names the source once anything is stamped. Each run's
verdict replaces the previous one; a stamp is never carried over from an earlier run.

WHAT IT DOES NOT CLAIM.
  - It never changes a displayed number and never adds a column; it only adds the two arrays
    and the src tag. Every other byte of the file is gen_fund_us's.
  - It is not point-in-time history: the superseded figures are not served, only disclosed.
  - A column makes NO claim (filed null, restated false) when any anchor's displayed number
    matches no SEC figure, matches a figure a later filing replaced, or sits between two
    figures. In each case the file and SEC disagree, so a stamp would be a guess. A column also
    stays unstamped when revenue has no SEC fact: non-US-GAAP filers, revenue lines outside the
    four tags below (most banks), or a period the vendor left empty. A fiscal Q4 column makes no
    claim either, because 10-Ks report its flows only as a full year, so its revenue cannot be
    checked. Silence, never a wrong date.
  - Only files whose statements are in USD and whose ticker maps to an SEC CIK are read.

NETWORK BUDGET. SEC asks for a contact User-Agent and at most 10 requests/s; this stays at 5.
companyfacts is fetched for CIKs that filed since the last run (SEC daily form index), then
never-fetched CIKs by market cap, then entries older than 30 days — under --max-fetch and
--deadline-secs. Every file is annotated from the compact cache (outside the repo) whether or
not it was refetched tonight, because gen_fund_us drops the arrays on every rebuild.

Usage (any Python 3.11+; no third-party deps):
    python3 ingest/annotate_sec_lineage.py --dry-run --only GE,AAPL --verbose
    python3 ingest/annotate_sec_lineage.py --offline        # cache only, no network
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import gzip
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gen_fund_us import TOP_ORDER, atomic_write, dump  # noqa: E402

CA_ROOT = Path(__file__).resolve().parents[1]
OUT = CA_ROOT / "terminal" / "public" / "data"

RECEIPT_SCHEMA = "mastermind.sec_lineage_receipt/v1"
LINEAGE_SOURCE = "sec_companyfacts"
DEFAULT_UA = "MastermindX terminal filing lineage longr2512@gmail.com"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
INDEX_URL = "https://www.sec.gov/Archives/edgar/daily-index/{y}/QTR{q}/form.{ymd}.idx"

# (block, field) -> us-gaap concepts. Revenue has several legitimate tags. A filer can carry two
# of them with different meanings (total vs contract revenue), or switch from one to another
# between filings; anchor_outcome() tells the two apart by what the filings they share report.
ANCHORS: dict[tuple[str, str], tuple[str, ...]] = {
    ("income", "revenue"): (
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
    ),
    ("income", "net_income"): ("NetIncomeLoss",),
    ("balance", "assets"): ("Assets",),
}
INSTANT_ANCHORS = {("balance", "assets")}
ALL_CONCEPTS = tuple(c for names in ANCHORS.values() for c in names)

# fund.json normalises period_end to month end (AAPL FY2025 2025-09-30 vs SEC 2025-09-27), so
# the end date is matched within a window, and the duration filter keeps a 9-month YTD fact out
# of a quarterly column and a quarter out of an annual one.
END_WINDOW_DAYS = 10
DURATION_DAYS = {"annual": (350, 380), "quarterly": (80, 100)}
# yfinance rounds differently from the filing (GE Q2'25 revenue 11,022M vs SEC 11,023M); this is
# only how near the DISPLAYED number must be. Two SEC values are judged with same_figure().
DISPLAY_TOLERANCE = 0.005
FIGURE_MAX_UNIT = 1_000_000   # filers report in units, thousands or millions, never coarser
FIGURE_MAX_REL = 0.01         # agreeing at precision never stretches past 1%
REVENUE = "revenue"

INDEX_FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A", "10-KT", "10-QT", "20-F", "40-F", "8-K", "8-K/A"}
INDEX_LOOKBACK_DAYS = 10
# A missing index on an open EDGAR day holds the processed day for this long (not yet published
# tonight, or SEC refusing us); after that it is taken as an unscheduled closure.
INDEX_HOLD_DAYS = 5
TICKERS_MAX_AGE_DAYS = 7
STALE_DAYS = 30
MIN_INTERVAL_S = 0.2          # 5 requests/s, half SEC's published ceiling
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRIES = 2
TIMEOUT_S = 30
MAX_CONSECUTIVE_ERRORS = 20   # SEC is refusing us (403 burst, outage): stop asking tonight

COLUMN_KINDS = ("attributed", "restated", "unattributed", "superseded_display", "no_anchor")


# ───────────────────────────── pure matching logic ─────────────────────────────
def parse_day(value) -> dt.date | None:
    if not isinstance(value, str):
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def _num(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def within_display(shown: float, value: float) -> bool:
    return abs(shown - value) <= DISPLAY_TOLERANCE * max(abs(value), 1.0)


def _unit(value: float) -> float:
    """The coarsest reporting unit `value` is consistent with: 29,139,000,000 -> 1e6."""
    if value != int(value):
        return 1.0
    n, unit = abs(int(value)), 1
    while n and unit < FIGURE_MAX_UNIT and n % (unit * 10) == 0:
        unit *= 10
    return float(unit)


def same_figure(a: float, b: float) -> bool:
    """One reported figure at two precisions: each value's rounding interval reaches the other's."""
    d = abs(a - b)
    return d <= (_unit(a) + _unit(b)) / 2 and d <= FIGURE_MAX_REL * max(abs(a), abs(b))


def candidates(facts: list, period_end: dt.date, timeframe: str, instant: bool) -> list:
    """(value, filed, accession) facts for this column: end within the window and, for flows,
    the timeframe's duration."""
    lo, hi = DURATION_DAYS[timeframe]
    out = []
    for row in facts or []:
        if not isinstance(row, (list, tuple)) or len(row) < 4:
            continue
        start, end, val, filed = parse_day(row[0]), parse_day(row[1]), _num(row[2]), parse_day(row[3])
        if end is None or val is None or filed is None:
            continue
        if abs((end - period_end).days) > END_WINDOW_DAYS:
            continue
        if instant:
            if start is not None:
                continue
        else:
            if start is None or not lo <= (end - start).days <= hi:
                continue
        accn = row[5] if len(row) > 5 and isinstance(row[5], str) and row[5] else filed.isoformat()
        out.append((val, filed.isoformat(), accn))
    return out


def clusters(cands: list) -> list[dict]:
    """Group one concept's values into figures, seeded in ascending filing order."""
    groups: list[dict] = []
    for val, filed, _ in sorted(cands, key=lambda c: (c[1], c[0])):
        for g in groups:
            if same_figure(val, g["value"]):
                g["values"].append(val)
                g["last_filed"] = max(g["last_filed"], filed)
                break
        else:
            groups.append({"value": val, "values": [val], "first_filed": filed, "last_filed": filed})
    return groups


def _agrees(a: list, b: list) -> bool:
    """One filing reports the same figure(s) under two concepts."""
    return all(any(same_figure(x, y) for y in b) for x in a) and all(any(same_figure(x, y) for x in a) for y in b)


def _equivalent(a: dict, b: dict) -> bool:
    """Two figures are the same number. Distinct figures of ONE concept never are."""
    if a is b:
        return True
    if a["tag"] == b["tag"]:
        return False
    return any(same_figure(x, y) for x in a["values"] for y in b["values"])


def anchor_outcome(per_tag: dict, period_end: dt.date, timeframe: str, instant: bool, displayed) -> dict:
    """Judge one anchor row of one column against every SEC concept that can carry it."""
    shown = _num(displayed)
    figures: list[dict] = []
    filings: dict[str, dict[str, list]] = {}   # tag -> accession -> values that filing reported
    for tag, facts in per_tag.items():
        cands = candidates(facts, period_end, timeframe, instant)
        if cands:
            for val, _, accn in cands:
                filings.setdefault(tag, {}).setdefault(accn, []).append(val)
            figures.extend({"tag": tag, **g} for g in clusters(cands))
    if not figures or shown is None:
        return {"status": "absent"}
    latest = max(f["last_filed"] for f in figures)
    current: dict[str, dict] = {}
    for f in figures:
        c = current.get(f["tag"])
        if c is None or (f["last_filed"], f["first_filed"]) > (c["last_filed"], c["first_filed"]):
            current[f["tag"]] = f
    live_tags = {t for t, f in current.items() if f["last_filed"] == latest}

    hits = [f for f in figures if any(within_display(shown, v) for v in f["values"])]
    if not hits:
        return {"status": "unmatched"}
    exact = [f for f in hits if any(same_figure(shown, v) for v in f["values"])]
    pool = exact or hits
    if any(not _equivalent(a, b) for i, a in enumerate(pool) for b in pool[i + 1:]):
        return {"status": "ambiguous"}
    matched = [f for f in pool if f["tag"] in live_tags and current[f["tag"]] is f]
    if not matched:
        return {"status": "superseded"}

    tags = {f["tag"] for f in matched}
    # A concept the latest filing dropped is the matched one's predecessor (a tag switch) when every
    # filing carrying both reported the same figure under each; one shared filing with different
    # figures makes it a parallel measure, left out. A dropped concept that never shared a filing
    # must have carried the matched figure: a different value under another tag can be a
    # restatement or a different measure, and the filings cannot tell which, so no claim is made.
    predecessors = set()
    for t, by_accn in filings.items():
        if t in live_tags:
            continue
        shared = [(by_accn[a], filings[m][a]) for m in tags for a in by_accn.keys() & filings[m].keys()]
        if shared:
            if all(_agrees(x, y) for x, y in shared):
                predecessors.add(t)
        elif any(_equivalent(f, m) for f in figures if f["tag"] == t for m in matched):
            predecessors.add(t)
        else:
            return {"status": "ambiguous"}
    same = [f for f in figures if (f["tag"] in tags and any(f is m for m in matched))
            or (f["tag"] in predecessors and any(_equivalent(f, m) for m in matched))]
    filed = min(f["first_filed"] for f in same)
    restated = any(f["first_filed"] < filed for f in figures
                   if f["tag"] in tags | predecessors and not any(f is m for m in same))
    return {"status": "matched", "filed": filed, "restated": restated, "last_filed": latest}


def concept_outcome(facts: list, period_end: dt.date, timeframe: str, instant: bool, displayed) -> dict:
    """One concept judged on its own (an anchor carried by a single tag)."""
    return anchor_outcome({"concept": facts}, period_end, timeframe, instant, displayed)


def column_lineage(anchors: dict) -> dict:
    """Combine anchors into one column claim; revenue is required, and any disagreement with SEC
    means no claim."""
    statuses = {a["status"] for a in anchors.values()}
    if "superseded" in statuses:
        return {"kind": "superseded_display", "filed": None, "restated": False}
    if statuses & {"unmatched", "ambiguous"}:
        return {"kind": "unattributed", "filed": None, "restated": False}
    if (anchors.get(REVENUE) or {}).get("status") != "matched":
        return {"kind": "no_anchor", "filed": None, "restated": False}
    matched = [a for a in anchors.values() if a["status"] == "matched"]
    return {"kind": "attributed", "filed": max(a["filed"] for a in matched),
            "restated": any(a["restated"] for a in matched)}


def set_lineage(period_set: dict, timeframe: str, concepts: dict) -> list[dict] | None:
    """One claim per column of a StatementPeriodSet, or None when its arrays are misaligned."""
    periods = period_set.get("periods")
    ends = period_set.get("period_end")
    if not isinstance(periods, list) or not isinstance(ends, list) or len(ends) != len(periods):
        return None
    rows = {}
    for key in ANCHORS:
        block, field = key
        section = period_set.get(block)
        if section is not None and not isinstance(section, dict):
            return None
        arr = (section or {}).get(field)
        if arr is not None and (not isinstance(arr, list) or len(arr) != len(periods)):
            return None
        rows[key] = arr
    cols = []
    for i in range(len(periods)):
        end = parse_day(ends[i])
        if end is None:
            cols.append({"kind": "no_anchor", "filed": None, "restated": False})
            continue
        anchors = {}
        for key, names in ANCHORS.items():
            displayed = rows[key][i] if rows[key] is not None else None
            anchors[key[1]] = anchor_outcome({n: concepts.get(n) or [] for n in names}, end, timeframe,
                                             key in INSTANT_ANCHORS, displayed)
        cols.append(column_lineage(anchors))
    return cols


def annotate_doc(doc: dict, concepts: dict) -> tuple[dict, dict]:
    """Return (annotated copy, column counts). Only the two arrays and src.statement_lineage change."""
    out = copy.deepcopy(doc)
    counts = dict.fromkeys(COLUMN_KINDS, 0)
    attributed = False
    statements = out.get("statements")
    if not isinstance(statements, dict):
        return out, counts
    for timeframe in ("annual", "quarterly"):
        period_set = statements.get(timeframe)
        if not isinstance(period_set, dict):
            continue
        cols = set_lineage(period_set, timeframe, concepts)
        if cols is None:
            period_set.pop("filed_by_period", None)
            period_set.pop("restated_by_period", None)
            continue
        n = len(cols)
        for c in cols:
            counts[c["kind"]] += 1
            if c["kind"] == "attributed" and c["restated"]:
                counts["restated"] += 1
        # Tonight's verdict replaces any earlier one: a stamp SEC no longer supports (the vendor
        # changed the number, or a later filing replaced it) must not survive.
        filed = [c["filed"] for c in cols]
        restated = [c["restated"] for c in cols]
        if any(f is not None for f in filed) or any(restated):
            period_set["filed_by_period"] = filed
            period_set["restated_by_period"] = restated
        else:
            period_set.pop("filed_by_period", None)
            period_set.pop("restated_by_period", None)
        attributed = attributed or any(c["kind"] == "attributed" for c in cols)
    src = out.get("src")
    if isinstance(src, dict):
        if attributed:
            src["statement_lineage"] = LINEAGE_SOURCE
        elif src.get("statement_lineage") == LINEAGE_SOURCE:
            del src["statement_lineage"]
    return out, counts


def parse_daily_index(text: str, forms=INDEX_FORMS) -> set[int]:
    """CIKs with a filing of one of `forms` in an EDGAR daily form index."""
    ciks: set[int] = set()
    for line in text.splitlines():
        m = re.search(r"edgar/data/(\d+)/", line)
        parts = line.split()
        if m and parts and parts[0] in forms:
            ciks.add(int(m.group(1)))
    return ciks


def plan_refresh(ciks, entries: dict, flagged, mktcap: dict, now: dt.datetime,
                 max_fetch: int, stale_days: int = STALE_DAYS) -> list[int]:
    """Fetch order: filed since last run, then never fetched (largest first), then oldest stale."""
    universe = set(ciks)
    by_cap = lambda c: (mktcap.get(c) is None, -(mktcap.get(c) or 0.0), c)  # noqa: E731
    first = sorted((c for c in set(flagged) if c in universe), key=by_cap)
    taken = set(first)
    uncached = sorted((c for c in universe - taken if entries.get(c) is None), key=by_cap)
    stale = []
    for c in universe - taken:
        e = entries.get(c)
        fetched = _parse_ts(e.get("fetched_at")) if e else None
        if e is not None and (fetched is None or (now - fetched).days > stale_days):
            stale.append((e.get("fetched_at") or "", c))
    order = first + uncached + [c for _, c in sorted(stale)]
    return order[:max(0, max_fetch)]


def _field(obj, key) -> dict:
    value = obj.get(key) if isinstance(obj, dict) else None
    return value if isinstance(value, dict) else {}


def compact_extract(companyfacts) -> dict:
    """Keep only the anchor concepts' USD facts as [start, end, val, filed, form, accn].
    Raises ValueError for a body that is not a companyfacts document."""
    if not isinstance(companyfacts, dict) or not isinstance(companyfacts.get("facts", {}), dict):
        raise ValueError("not a companyfacts document")
    gaap = _field(companyfacts.get("facts") or {}, "us-gaap")
    out = {}
    for concept in ALL_CONCEPTS:
        rows = []
        usd = _field(_field(gaap, concept), "units").get("USD")
        for f in usd if isinstance(usd, list) else []:
            if not isinstance(f, dict) or not f.get("end") or not f.get("filed") or _num(f.get("val")) is None:
                continue
            rows.append([f.get("start"), f["end"], f["val"], f["filed"], f.get("form"), f.get("accn")])
        if rows:
            out[concept] = rows
    return out


def _parse_ts(value) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        ts = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=dt.timezone.utc)


# ───────────────────────────── SEC access + cache ─────────────────────────────
def urlopen_fetch(url: str) -> tuple[int, bytes | None]:
    req = urllib.request.Request(url, headers={
        "User-Agent": os.environ.get("SEC_USER_AGENT") or DEFAULT_UA,
        "Accept-Encoding": "gzip",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = resp.read()
            if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                body = gzip.decompress(body)
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, None


class SecClient:
    """Throttled, retrying GET. `fetch(url) -> (status, body)` is injectable for tests."""

    def __init__(self, fetch=urlopen_fetch, sleep=time.sleep, clock=time.monotonic):
        self.fetch, self.sleep, self.clock = fetch, sleep, clock
        self._last = None

    def get(self, url: str) -> tuple[int, bytes | None]:
        status = 0
        for attempt in range(MAX_RETRIES + 1):
            if self._last is not None:
                wait = self._last + MIN_INTERVAL_S - self.clock()
                if wait > 0:
                    self.sleep(wait)
            self._last = self.clock()
            try:
                status, body = self.fetch(url)
            except (OSError, ValueError, http.client.HTTPException):
                status, body = 0, None
            if status == 200 or (status and status not in RETRY_STATUSES):
                return status, body
            if attempt < MAX_RETRIES:
                self.sleep(2.0 * (attempt + 1))
        return status, None


class Cache:
    def __init__(self, root: Path):
        self.root = root
        (root / "facts").mkdir(parents=True, exist_ok=True)

    def _read(self, path: Path):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return None

    def _write(self, path: Path, obj) -> None:
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=True))
        os.replace(tmp, path)

    def facts_path(self, cik: int) -> Path:
        return self.root / "facts" / f"CIK{cik:010d}.json"

    def entry(self, cik: int) -> dict | None:
        e = self._read(self.facts_path(cik))
        if not isinstance(e, dict) or e.get("status") not in ("ok", "no_companyfacts") \
                or not isinstance(e.get("concepts"), dict) or _parse_ts(e.get("fetched_at")) is None:
            return None  # corrupt or foreign: treat as never fetched
        return e

    def put_entry(self, cik: int, status: str, concepts: dict, now: dt.datetime) -> None:
        self._write(self.facts_path(cik), {"cik": cik, "status": status, "concepts": concepts,
                                           "fetched_at": now.isoformat()})

    def read_json(self, name: str):
        return self._read(self.root / name)

    def write_json(self, name: str, obj) -> None:
        self._write(self.root / name, obj)


def ticker_map(client: SecClient | None, cache: Cache, now: dt.datetime) -> dict | None:
    cached = cache.read_json("company_tickers.json")
    ok_cached = isinstance(cached, dict) and isinstance(cached.get("map"), dict)
    fresh = ok_cached and (ts := _parse_ts(cached.get("fetched_at"))) is not None \
        and (now - ts).days < TICKERS_MAX_AGE_DAYS
    if fresh or client is None:
        return cached["map"] if ok_cached else None
    status, body = client.get(TICKERS_URL)
    if status == 200 and body:
        try:
            raw = json.loads(body)
            mapping = {str(r["ticker"]).upper(): int(r["cik_str"]) for r in raw.values()}
        except (ValueError, KeyError, TypeError, AttributeError):
            mapping = None
        if mapping:
            cache.write_json("company_tickers.json", {"fetched_at": now.isoformat(), "map": mapping})
            return mapping
    return cached["map"] if ok_cached else None


def cik_for(symbol: str, mapping: dict) -> int | None:
    s = symbol.upper()
    return mapping.get(s) or mapping.get(s.replace(".", "-"))


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    """The n-th `weekday` (Mon=0) of a month; n=-1 is the last."""
    if n > 0:
        first = dt.date(year, month, 1)
        return first + dt.timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
    nxt = dt.date(year + month // 12, month % 12 + 1, 1)
    last = nxt - dt.timedelta(days=1)
    return last - dt.timedelta(days=(last.weekday() - weekday) % 7)


def _observed(day: dt.date) -> dt.date:
    return day - dt.timedelta(days=1) if day.weekday() == 5 else day + dt.timedelta(days=1) if day.weekday() == 6 else day


def federal_holidays(year: int) -> set[dt.date]:
    """US federal holidays as observed in `year` (EDGAR does not accept filings on them)."""
    fixed = [(1, 1), (7, 4), (11, 11), (12, 25)] + ([(6, 19)] if year >= 2021 else [])
    days = {_observed(dt.date(year, m, d)) for m, d in fixed}
    days.add(_observed(dt.date(year + 1, 1, 1)))      # a Saturday New Year is observed on Dec 31
    days |= {_nth_weekday(year, 1, 0, 3), _nth_weekday(year, 2, 0, 3), _nth_weekday(year, 5, 0, -1),
             _nth_weekday(year, 9, 0, 1), _nth_weekday(year, 10, 0, 2), _nth_weekday(year, 11, 3, 4)}
    return {d for d in days if d.year == year}


def edgar_closed(day: dt.date) -> bool:
    return day.weekday() >= 5 or day in federal_holidays(day.year)


def read_index(client: SecClient, state: dict, today: dt.date, stop=None,
               receipt: dict | None = None) -> tuple[bool, set[int], str | None]:
    """(index_ok, CIKs filed since the last processed day, new last processed day).

    EDGAR answers a day with no index with 403 or 404. On a weekend or holiday that is final. On
    an open day it means "not published yet" (tonight's index appears after the run) or "refused",
    so the processed day stops before it and the day is read again next run; after INDEX_HOLD_DAYS
    it is taken as an unscheduled closure. Later days are still read so their filers are flagged.
    The held day goes in the receipt, so SEC refusing every day does not read as a quiet night.
    """
    last = parse_day(state.get("last_date"))
    start = today - dt.timedelta(days=INDEX_LOOKBACK_DAYS)
    if last is not None and last + dt.timedelta(days=1) > start:
        start = last + dt.timedelta(days=1)
    flagged: set[int] = set()
    newest, held = last, None
    day = start
    while day <= today:
        if stop is not None and stop():
            break
        url = INDEX_URL.format(y=day.year, q=(day.month - 1) // 3 + 1, ymd=day.strftime("%Y%m%d"))
        status, body = client.get(url)
        if status == 200 and body is not None:
            flagged |= parse_daily_index(body.decode("latin-1"))
            if held is None:
                newest = day
        elif status in (403, 404):
            if not edgar_closed(day) and (today - day).days <= INDEX_HOLD_DAYS and held is None:
                held = day
        else:
            # Anything else is a failure, and the processed day stays put.
            return False, set(), state.get("last_date")
        day += dt.timedelta(days=1)
    if receipt is not None and held is not None:
        receipt["index_held"] = held.isoformat()
    return True, flagged, newest.isoformat() if newest else None


# ───────────────────────────── driver ─────────────────────────────
def scan_universe(data_dir: Path, only: set[str] | None, limit: int | None, mapping: dict, receipt: dict):
    """[(symbol, path, cik, mktcap)] for USD files with a CIK; counts the rest."""
    rows = []
    for path in sorted(data_dir.glob("*.fund.json")):
        symbol = path.name[: -len(".fund.json")]
        if only is not None and symbol.upper() not in only:
            continue
        if limit is not None and receipt["files"] >= limit:
            break
        receipt["files"] += 1
        try:
            doc = json.loads(path.read_text())
        except (OSError, ValueError):
            receipt["unreadable"] += 1
            continue
        if not isinstance(doc, dict) or doc.get("stmt_currency") != "USD":
            receipt["non_usd"] += 1
            continue
        receipt["usd"] += 1
        ticker = doc.get("ticker") if isinstance(doc.get("ticker"), str) else symbol
        cik = cik_for(ticker, mapping) or cik_for(symbol, mapping)
        if cik is None:
            receipt["no_cik"] += 1
            continue
        rows.append((symbol, path, cik, _num((doc.get("stats") or {}).get("mktcap"))))
    return rows


def new_receipt(dry_run: bool) -> dict:
    return {"schema": RECEIPT_SCHEMA, "files": 0, "usd": 0, "non_usd": 0, "no_cik": 0, "unreadable": 0,
            "fetched": 0, "fetch_errors": 0, "no_companyfacts": 0, "index_ok": False, "index_held": None,
            "index_flagged": 0, "annotated_files": 0, "annotate_errors": 0, "unsafe_shape": 0,
            "columns": dict.fromkeys(COLUMN_KINDS, 0),
            "deadline_hit": False, "fetch_aborted": False, "dry_run": dry_run}


def run(argv=None, client: SecClient | None = None, now: dt.datetime | None = None) -> int:
    ap = argparse.ArgumentParser(description="Stamp statement columns with their SEC filing lineage.")
    ap.add_argument("--only", help="comma-separated symbols")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--max-fetch", type=int, default=1200)
    ap.add_argument("--deadline-secs", type=int, default=1500)
    ap.add_argument("--offline", action="store_true", help="cache only, no network")
    ap.add_argument("--dry-run", action="store_true", help="compute and report, write no data file")
    ap.add_argument("--data-dir", type=Path, default=OUT)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    t0 = time.monotonic()
    now = now or dt.datetime.now(dt.timezone.utc)
    cache = Cache(Path(os.environ.get("SEC_LINEAGE_CACHE") or Path.home() / ".cache" / "mastermind" / "sec_lineage"))
    if client is None and not args.offline:
        client = SecClient()
    if args.offline:
        client = None
    receipt = new_receipt(args.dry_run)

    mapping = ticker_map(client, cache, now)
    if not mapping:
        print("annotate_sec_lineage: SEC company_tickers unavailable (no network and no cache)", file=sys.stderr)
        return 1
    only = {s.strip().upper() for s in args.only.split(",") if s.strip()} if args.only else None
    rows = scan_universe(args.data_dir, only, args.limit, mapping, receipt)
    ciks = sorted({r[2] for r in rows})
    mktcap: dict[int, float] = {}
    for _, _, cik, cap in rows:
        if cap is not None:
            mktcap[cik] = max(cap, mktcap.get(cik, cap))
    entries = {c: cache.entry(c) for c in ciks}

    if client is not None:
        state = cache.read_json("index_state.json")
        state = state if isinstance(state, dict) else {}
        pending = {int(c) for c in state.get("pending") or [] if isinstance(c, int)}
        over = lambda: time.monotonic() - t0 > args.deadline_secs  # noqa: E731
        index_ok, flagged, last_date = read_index(client, state, now.date(), stop=over, receipt=receipt)
        receipt["deadline_hit"] = over()
        receipt["index_ok"] = index_ok
        flagged |= pending
        receipt["index_flagged"] = len(flagged & set(ciks))
        refreshed: set[int] = set()
        errors_in_row = 0
        for cik in plan_refresh(ciks, entries, flagged, mktcap, now, args.max_fetch):
            if time.monotonic() - t0 > args.deadline_secs:
                receipt["deadline_hit"] = True
                break
            if errors_in_row >= MAX_CONSECUTIVE_ERRORS:
                receipt["fetch_aborted"] = True
                break
            status, body = client.get(FACTS_URL.format(cik=cik))
            if status == 404:
                receipt["no_companyfacts"] += 1
                cache.put_entry(cik, "no_companyfacts", {}, now)
            elif status == 200 and body is not None:
                try:
                    concepts = compact_extract(json.loads(body))
                except (ValueError, TypeError, AttributeError):
                    receipt["fetch_errors"] += 1
                    errors_in_row += 1
                    continue
                receipt["fetched"] += 1
                cache.put_entry(cik, "ok", concepts, now)
            else:
                receipt["fetch_errors"] += 1
                errors_in_row += 1
                continue
            errors_in_row = 0
            refreshed.add(cik)
            entries[cik] = cache.entry(cik)
        if not args.dry_run and index_ok:
            # A CIK flagged by the index but not refreshed tonight (cap, deadline, error) stays
            # pending, so advancing the index day never loses its update.
            universe = set(ciks) if only is None and args.limit is None else None
            carry = sorted(c for c in flagged - refreshed if universe is None or c in universe)
            cache.write_json("index_state.json", {"last_date": last_date, "pending": carry})

    allowed = set(TOP_ORDER)
    for symbol, path, cik, _ in rows:
        entry = entries.get(cik)
        if not entry or entry.get("status") != "ok":
            continue
        try:
            text = path.read_text()
            doc = json.loads(text)
        except (OSError, ValueError):
            continue
        if not isinstance(doc, dict) or not set(doc) <= allowed or dump(doc) != text:
            # Rewriting through dump() must reproduce every byte it does not own: a foreign
            # top-level key (dump keeps only TOP_ORDER) or a file another writer serialised
            # differently would change in ways this pass never claims.
            receipt["unsafe_shape"] += 1
            continue
        try:
            out, counts = annotate_doc(doc, entry["concepts"])
            new_text = dump(out)
        except Exception as e:  # noqa: BLE001 — one odd file must not stop the universe
            receipt["annotate_errors"] += 1
            print(f"annotate_sec_lineage: {symbol}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        for k, v in counts.items():
            receipt["columns"][k] += v
        if args.verbose:
            print(f"{symbol} cik={cik} " + " ".join(
                f"{tf}:" + ",".join(f"{p}={'R' if r else ''}{f or '-'}" for p, f, r in zip(
                    s.get("periods") or [], s.get("filed_by_period") or [], s.get("restated_by_period") or []))
                for tf, s in ((tf, (out.get("statements") or {}).get(tf)) for tf in ("annual", "quarterly"))
                if isinstance(s, dict)))
        if out == doc or new_text == text:
            continue
        receipt["annotated_files"] += 1
        if not args.dry_run:
            atomic_write(path, new_text)

    print(json.dumps(receipt, separators=(",", ":")))
    try:
        cache.write_json("last_receipt.json", receipt)
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(run())
