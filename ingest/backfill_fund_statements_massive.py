"""Backfill deep statement history into terminal/public/data/<SYM>.fund.json from Massive.

`gen_fund_us.py` builds each file from the yfinance cache, which carries ~5 fiscal periods.
Massive's `stocks/financials/v1` endpoints (see massive_financials) serve SEC XBRL-derived
statements back to the 2009 XBRL mandate. This pass EXTENDS the existing files in place — it
does not rebuild them and does not introduce a second store. gen_fund_us rewrites every file
nightly, so `ops/nightly_fund.sh` runs this pass right after it, before the safety gates and
the rsync; without that step the deep history is wiped the next night.

MERGE CONTRACT (deliberately conservative — a backfill must never degrade a live file):

  1. One fiscal period is ONE column. A vendor period whose end lies within
     SAME_PERIOD_DAYS of a column already on file IS that column and takes its label: the
     two sources disagree on the date for the same fiscal year (yfinance normalises AAPL
     FY2025 to 2025-09-30, the vendor reports the true 52/53-week close 2025-09-27) and, now
     and then, on the label (1 of 541 date-matched quarterly columns, measured 2026-10-18).
     Any other vendor period is keyed on the vendor's own fiscal label, which matched
     gen_fund_us's calendar on every other date-matched column (481/481 annual, 540/541
     quarterly). A label already held by a column for a DIFFERENT period is never merged
     into it — the row falls back to gen_fund_us's own date arithmetic (`fy_label` /
     `fiscal_q_label`, imported, never re-implemented) if that label is free, and is
     otherwise skipped and counted. The vendor's duplicate labels for ONE period end are
     resolved before this, in massive_financials.join_statements. A published set the
     label-keyed merge cannot carry faithfully — a blank or repeated label (gen_fund_us
     repeats one when an issuer moves its fiscal year end), or a per-period key the merge
     does not own (the CN/HK generators') — is left exactly as emitted (`unmergeable`).
  2. NEVER overwrite an existing non-null value. Vendor data only (a) adds periods the file
     does not carry — in practice the older ones, but a newer or in-between period the
     vendor serves is added too — and (b) fills per-field null holes, so the yfinance values
     the nightly just emitted survive untouched wherever both sources state one.
  3. `period_end` for an existing label keeps its existing value, so StatementsPage's
     transcript join (exact period_end ↔ earnings.q[].end) is unaffected.
  4. Per-period provenance is recorded in `statements.<tf>.src_by_period[]` and the
     uncovered-field set in `statements.<tf>.vendor_gaps` (for v1: EBITDA, total and net
     debt, whose definitions differ from the yfinance columns — massive_financials), so the
     UI can disclose in plain words which rows a source cannot carry instead of showing
     bare dashes.
  5. FILING PROVENANCE, stated only as far as the source can establish it. When two vendor
     rows land on one column the LATER FILING WINS, by `row_filing_date`, under a total order
     (see `vendor_rows_newest_filing_first`), and the date of the filing whose figures the
     column took lands in `statements.<tf>.filed_by_period[]`. v1 serves only the LATEST
     filing that reported each period (massive_financials.SERVES_FILING_HISTORY is False),
     so that date is a conservative point-in-time anchor — never earlier than first
     publication — and the source cannot show whether a period was restated:
     `restated_by_period[]` is null for "not established", never a False the data cannot
     back. True survives only where an earlier run observed it.
  6. SEC LINEAGE TAKES PRECEDENCE. In the nightly, annotate_sec_lineage (E11-03) runs between
     gen_fund_us and this pass and stamps each column from SEC companyfacts: the date its
     anchor figures were FIRST filed, and whether an earlier filing reported a different
     figure. That is a stronger claim than the vendor's latest filing, so when the file carries
     `src.statement_lineage` every column the annotator judged keeps its verdict exactly —
     its date, its restated True/False, and its silence (a null date where the file and SEC
     disagree) — even where this pass fills a hole in it (`sec_judged`). The vendor stamps only
     what the annotator never saw: the deep columns this pass adds.

     ⚠ THIS IS NOT FULL POINT-IN-TIME. A restatement still REWRITES the published column; we
     make the rewrite deterministic and visible, we do not preserve what was published before
     it. Latching each column to the figures as first published (and serving the restatement
     as a second, versioned read) is follow-up work — it needs a per-period version store this
     file deliberately does not introduce.

⚠ OPERATIONAL COROLLARY of rule 2: because the merge never overwrites, changing the vendor
  field mapping does NOT heal already-written files on a re-run — the old value is non-null
  and therefore wins. After a mapping change, re-emit the affected symbols with
  `gen_fund_us.py` first, then re-run this pass against the fresh files (the nightly does
  exactly that).

FAILURE CONTRACT. A batch is fetched whole (both timeframes) before any file in it is
touched, so a vendor error leaves every file in that batch byte-identical; files of batches
already merged keep their (atomic, per-file) writes. A systemic status (401/403/404/410 — a
bad key, a retired endpoint) stops the sweep at once; so do MAX_CONSECUTIVE_BATCH_ERRORS
failed batches in a row. A spent `--deadline-seconds` budget stops the sweep, and the symbols
it did not reach keep the periods already on file — in the nightly, that night's yfinance
periods. Nothing carries over: gen_fund_us rewrites every file the next night and the sweep
starts from the top again, so a bare sweep runs LARGEST MARKET CAP FIRST (`sweep_order`) and
a short budget leaves the smallest names shallow, not whichever names sort last. A file this
pass cannot rewrite faithfully is left byte-identical and counted: unreadable, carrying a
top-level key `dump` would drop, or with statements in a currency other than USD (vendor rows
carry no currency, so their figures are merged only where the file already states USD). One
odd file never stops the sweep. The exit status is non-zero only when the sweep was aborted,
or failed without updating anything; the nightly logs it and ships regardless.

Usage (any Python 3.11+; no third-party deps):
    python3 ingest/backfill_fund_statements_massive.py --only AAPL,CROX
    python3 ingest/backfill_fund_statements_massive.py --limit 50
    python3 ingest/backfill_fund_statements_massive.py --dry-run --only AAPL
    # the nightly (ops/nightly_fund.sh): key read from the env file into this process only
    python3 ingest/backfill_fund_statements_massive.py --env-file ~/.macro-dashboard/.env \\
        --deadline-seconds 2700 --quiet
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gen_fund_us import TOP_ORDER, atomic_write, dump, fiscal_q_label, fy_label  # noqa: E402
from annotate_sec_lineage import LINEAGE_SOURCE  # noqa: E402
from massive_financials import (  # noqa: E402
    SERVES_FILING_HISTORY,
    SOURCE_LABEL,
    SYSTEMIC_STATUSES,
    DeadlineReached,
    VendorHTTPError,
    api_key,
    fetch_batch,
    key_from_env_file,
    map_row,
    row_end_date,
    row_filing_date,
    statement_coverage,
    vendor_label,
)

CA_ROOT = Path(__file__).resolve().parents[1]
OUT = CA_ROOT / "terminal" / "public" / "data"

BLOCKS = ("income", "balance", "cashflow")

# Two period ends this close describe one fiscal period (52/53-week closes drift ≤ 7 days
# from the month end; adjacent quarters are ≥ ~84 days apart).
SAME_PERIOD_DAYS = 14

# Symbols per vendor request: 100 fit one page (0.7 s) on every endpoint, measured 2026-10-18.
BATCH_SIZE = 100
MAX_CONSECUTIVE_BATCH_ERRORS = 3

# Exchange suffixes the vendor's US filings API does not cover. The data dir also holds the
# CN/HK/KR listings fed by tushare/akshare; an unfiltered sweep would spend requests to be
# told "no results" — real quota on the shared key, every night. ADRs carry no suffix and
# are covered, so they still run.
NON_US_SUFFIXES = {
    "SZ", "SS", "SH", "BJ",   # mainland China
    "HK",                      # Hong Kong
    "KS", "KQ",               # Korea
    "T", "TW", "TWO",         # Japan / Taiwan
    "L", "PA", "DE", "AS", "SW", "MI", "MC", "ST", "OL", "HE", "CO",  # Europe
    "AX", "NZ", "SI", "BK", "NS", "BO", "SA", "MX", "TO", "V",        # rest of world
}


def is_vendor_market(sym: str) -> bool:
    """True when the symbol is a US listing (or ADR) the vendor can serve."""
    _, dot, suffix = sym.rpartition(".")
    if not dot:
        return True
    return suffix.upper() not in NON_US_SUFFIXES


def fy_end_month_from(dates: list[str]) -> int:
    """Fiscal-year-end month from the NEWEST annual period-end; December if unknown.

    Mirrors gen_fund_us.fy_end_month's intent (which reads the yfinance frame) for a
    caller that only has the emitted file plus the vendor rows.
    """
    for iso in reversed([d for d in dates if d]):
        try:
            return dt.date.fromisoformat(iso[:10]).month
        except ValueError:
            continue
    return 12


def label_for(end_iso: str, fy_end_m: int, timeframe: str) -> str | None:
    """Fiscal label from a period-end date — gen_fund_us's own arithmetic, never re-implemented."""
    return (
        fy_label(end_iso, fy_end_m)
        if timeframe == "annual"
        else fiscal_q_label(end_iso, fy_end_m, style="short")
    )


def vendor_row_label(raw: dict, end_iso: str, fy_end_m: int, timeframe: str) -> str | None:
    """Label for a vendor row: the vendor's stated fiscal period first, date arithmetic second.

    See massive_financials.vendor_label — the date arithmetic mis-buckets 52/53-week quarters
    that close on the 1st of a month, which silently collapses two real quarters into one
    column. The vendor's own fiscal_year / fiscal_quarter is the better key; its rare
    duplicate labels are resolved in massive_financials.join_statements, and a label that
    still clashes is caught by the merge (rule 1).
    """
    return vendor_label(raw, timeframe) or label_for(end_iso, fy_end_m, timeframe)


def vendor_rows_newest_filing_first(vendor_rows: list[dict]) -> list[dict]:
    """Vendor rows in a documented, restatement-aware order: NEWEST FILING FIRST.

    WHY THIS ORDER IS LOAD-BEARING. The merge below is first-writer-wins by design (rule 2:
    never overwrite a non-null value), so when two vendor rows land on one column — two
    period ends within SAME_PERIOD_DAYS, or two rows for one label — whichever the loop
    reaches first becomes published history. Wire order cannot decide that: the request sorts
    on period end, not on filing. Sorting here makes the winner a property of the DATA.

    Key: (filing date, period end, source index), descending. Filing date is the restatement
    anchor — the later filing supersedes. Period end and the original index are pure tiebreaks
    so the order is total: a row with no filing date sorts below every dated row (we only
    promote a row over another on evidence), and two rows identical on all three keys are
    impossible because the index is unique.

    Consequence for gap-filling: the newest filing creates the column, and OLDER filings can
    still contribute fields the newer one omitted — filling a null is not overwriting.
    """
    return [
        raw
        for _, raw in sorted(
            enumerate(vendor_rows),
            key=lambda pair: (
                row_filing_date(pair[1]) or "",
                row_end_date(pair[1]) or "",
                pair[0],
            ),
            reverse=True,
        )
    ]


def _days_apart(a: str | None, b: str | None) -> int | None:
    try:
        return abs((dt.date.fromisoformat(a[:10]) - dt.date.fromisoformat(b[:10])).days)
    except (TypeError, ValueError):
        return None


# Keys of a StatementPeriodSet this merge rebuilds. A set carrying anything else (the CN/HK
# generators' period_kind / source_family_by_period / …) is left exactly as emitted: the
# merge cannot keep a per-period key it does not know aligned to new columns.
OWNED_KEYS = frozenset(
    {"periods", "period_end", *BLOCKS, "src_by_period", "filed_by_period", "restated_by_period", "vendor_gaps"}
)


def unmergeable(existing: dict | None) -> str | None:
    """Why a published set must not be merged into, or None when it can be.

    The merge keys columns on their label, so a set with a blank or repeated label would
    lose a published column. gen_fund_us emits repeats when an issuer moves its fiscal
    year end (GEF, JACK — 23 of 19,942 period sets on M1, 2026-10-18).

    It also rebuilds every array from per-column slots, so an array that does not line up
    with `periods`, or an entry of a type the merge would misread, would silently re-pair
    values with the wrong period. gen_fund_us and annotate_sec_lineage always emit aligned
    arrays; this holds anything else exactly as it is.
    """
    if not existing:
        return None
    if not isinstance(existing, dict):
        return "not an object"
    labels = existing.get("periods")
    labels = [] if labels is None else labels
    if not isinstance(labels, list) or any(not isinstance(lab, str) for lab in labels):
        return "non-string period label"
    if any(not lab for lab in labels):
        return "blank period label"
    if len(set(labels)) != len(labels):
        return "repeated period label"
    extra = sorted(set(existing) - OWNED_KEYS)
    if extra:
        return f"unknown key {extra[0]}"
    n = len(labels)
    for key, kinds in (
        ("period_end", (str,)),
        ("src_by_period", (str,)),
        ("filed_by_period", (str,)),
        ("restated_by_period", (bool,)),
    ):
        arr = existing.get(key)
        if arr is None:
            continue
        if not isinstance(arr, list) or len(arr) != n or any(
            v is not None and not isinstance(v, kinds) for v in arr
        ):
            return f"misaligned {key}"
    for block in BLOCKS:
        fields = existing.get(block)
        if fields is None:
            continue
        if not isinstance(fields, dict):
            return f"misaligned {block}"
        for field, arr in fields.items():
            if not isinstance(arr, list) or len(arr) != n:
                return f"misaligned {block}.{field}"
    return None


def same_period_label(end_iso: str, merged: dict[str, dict]) -> str | None:
    """Label of the column whose period end lies within SAME_PERIOD_DAYS of `end_iso`
    (the nearest one), or None."""
    best: tuple[int, str] | None = None
    for label, slot in merged.items():
        d = _days_apart(end_iso, slot.get("end"))
        if d is not None and d <= SAME_PERIOD_DAYS and (best is None or (d, label) < best):
            best = (d, label)
    return best[1] if best else None


def merge_period_set(
    existing: dict | None,
    vendor_rows: list[dict],
    fy_end_m: int,
    timeframe: str,
    base_src: str,
    serves_history: bool = SERVES_FILING_HISTORY,
    sec_lineage: bool = False,
) -> tuple[dict, dict]:
    """Merge vendor rows into one StatementPeriodSet. Returns (merged_set, stats).

    Pure — no I/O — so the merge contract is unit-testable. `serves_history` says whether
    the source returns every filing per period (only then is ">1 filing" a restatement tell
    and "1 filing" evidence of none — rule 5). `sec_lineage` says the file carries
    annotate_sec_lineage's stamps (rule 6).
    """
    held = unmergeable(existing)
    if held:
        n = len((existing or {}).get("periods") or [])
        return dict(existing), {
            "added": 0, "filled": 0, "relabeled": 0, "skipped": 0,
            "held": held, "total": n, "before": n,
        }
    existing = existing or {}
    ex_periods: list[str] = list(existing.get("periods") or [])
    ex_ends: list[str] = list(existing.get("period_end") or [])
    # Provenance already on file. A column whose values are all filled accepts nothing new on
    # a re-run (rule 2), so without carrying the stamps forward a second run would blank them.
    ex_filed: list = list(existing.get("filed_by_period") or [])
    ex_restated: list = list(existing.get("restated_by_period") or [])
    ex_src: list = list(existing.get("src_by_period") or [])

    # label → {end, values:{block:{field:v}}, src}
    merged: dict[str, dict] = {}
    order: list[str] = []

    def existing_at(block: str, index: int) -> dict:
        """Existing values for one block at one period index; short arrays read as null."""
        fields = existing.get(block) or {}
        out: dict = {}
        for field, arr in fields.items():
            seq = arr if isinstance(arr, list) else []
            out[field] = seq[index] if index < len(seq) else None
        return out

    for i, label in enumerate(ex_periods):
        src = ex_src[i].split("+") if i < len(ex_src) and ex_src[i] else [base_src]
        restated_on_file = ex_restated[i] if i < len(ex_restated) else None
        merged[label] = {
            "end": ex_ends[i] if i < len(ex_ends) else None,
            "values": {b: existing_at(b, i) for b in BLOCKS},
            # A column an earlier run stamped keeps its stamp ("massive" alone marks a
            # vendor-only column, which finStatements discloses).
            "src": src,
            # Filing provenance (rule 5). `filed` is the filing whose values this column
            # actually took; `filings` is every distinct vendor filing seen THIS run;
            # `restated` carries a True an earlier run established (never a False).
            "filed": ex_filed[i] if i < len(ex_filed) else None,
            "filings": set(),
            "restated": restated_on_file is True,
            # Rule 6: the annotator judged every column of the file it stamped, so a column
            # under SEC lineage keeps the annotator's verdict — including a null date and
            # restated False, which is how it records "no claim", and an absent array, which
            # is how it records "no claim on any column". The one exception is a vendor-only
            # column this pass added after the annotator ran: it carries our own null
            # restated, never the annotator's bool, and stays ours.
            "sec_judged": sec_lineage and (src != [SOURCE_LABEL] or isinstance(restated_on_file, bool)),
            "sec_restated": restated_on_file,
        }
        order.append(label)

    added = filled = relabeled = skipped = 0
    for raw in vendor_rows_newest_filing_first(vendor_rows):
        end = row_end_date(raw)
        if not end:
            continue
        label = same_period_label(end, merged)
        if label is None:
            label = vendor_row_label(raw, end, fy_end_m, timeframe)
            if not label:
                continue
            holder = merged.get(label)
            if holder is not None and holder.get("end"):
                # The label belongs to a column for a different period (none is within
                # SAME_PERIOD_DAYS of this one) — merging would fill one period from another.
                alt = label_for(end, fy_end_m, timeframe)
                if alt and alt not in merged:
                    label = alt
                    relabeled += 1
                else:
                    skipped += 1
                    continue
        mapped = map_row(raw)
        filed = row_filing_date(raw)
        slot = merged.get(label)
        if slot is None:
            merged[label] = {
                "end": end,
                "values": {b: dict(mapped[b]) for b in BLOCKS},
                "src": [SOURCE_LABEL],
                "filed": filed,
                "filings": {filed} if filed else set(),
                "restated": False,
                "sec_judged": False,
            }
            order.append(label)
            added += 1
            continue
        if filed:
            slot["filings"].add(filed)
        # existing label → fill null holes only; never overwrite, never move period_end
        touched = False
        for b in BLOCKS:
            for field, v in mapped[b].items():
                if v is None:
                    continue
                cur = slot["values"].setdefault(b, {}).get(field)
                if cur is None:
                    slot["values"][b][field] = v
                    touched = True
        if touched:
            filled += 1
            if SOURCE_LABEL not in slot["src"]:
                slot["src"].append(SOURCE_LABEL)
            # Rows arrive newest-filing-first, so the first one to supply a value is the newest
            # filing that supplied one. A row that contributed nothing never claims the column,
            # and an older filing never displaces a later one already stamped (this run or a
            # previous one) — ISO dates compare lexicographically. A column SEC judged keeps
            # SEC's date, or SEC's silence (rule 6).
            if filed and not slot["sec_judged"] and (slot["filed"] is None or filed > slot["filed"]):
                slot["filed"] = filed

    # oldest→newest by period-end (the contract's array order), label as a stable tiebreak
    order = sorted(set(order), key=lambda lab: (merged[lab]["end"] or "", lab))

    def restated(slot: dict) -> bool | None:
        if slot.get("sec_judged"):
            return slot.get("sec_restated")
        if slot.get("restated") or (serves_history and len(slot.get("filings") or ()) > 1):
            return True
        return False if serves_history else None

    fields = {b: sorted({f for lab in order for f in merged[lab]["values"].get(b, {})}) for b in BLOCKS}
    out: dict = {
        "periods": order,
        "period_end": [merged[lab]["end"] for lab in order],
    }
    for b in BLOCKS:
        out[b] = {
            f: [merged[lab]["values"].get(b, {}).get(f) for lab in order] for f in fields[b]
        }
    out["src_by_period"] = ["+".join(merged[lab]["src"]) for lab in order]
    out["filed_by_period"] = [merged[lab].get("filed") for lab in order]
    out["restated_by_period"] = [restated(merged[lab]) for lab in order]
    out["vendor_gaps"] = statement_coverage()

    return out, {
        "added": added,
        "filled": filled,
        "relabeled": relabeled,
        "skipped": skipped,
        "held": None,
        "total": len(order),
        "before": len(ex_periods),
    }


def apply_vendor_rows(
    sym: str,
    path: Path,
    ann_rows: list[dict],
    qtr_rows: list[dict],
    dry_run: bool = False,
) -> dict:
    """Merge already-fetched vendor rows into one file. Returns a per-symbol stats dict.

    The file is read AFTER the fetch, so a slow batch never writes back a stale copy.
    A file it cannot rewrite faithfully keeps its bytes (see FAILURE CONTRACT).
    """
    if not ann_rows and not qtr_rows:
        # A real coverage gap (foreign private issuers filing 20-F/40-F carry no XBRL
        # financials here). Leave the file untouched — an empty vendor answer is not a
        # reason to erase what yfinance already published.
        return {"sym": sym, "status": "no-vendor-coverage"}
    try:
        text = path.read_text()
        fund = json.loads(text)
    except (OSError, ValueError) as exc:
        return {"sym": sym, "status": "unreadable", "detail": type(exc).__name__}
    if not isinstance(fund, dict):
        return {"sym": sym, "status": "unreadable", "detail": "not a JSON object"}
    extra = sorted(set(fund) - set(TOP_ORDER))
    if extra:
        # `dump` keeps only TOP_ORDER keys, so a rewrite would silently drop this one.
        return {"sym": sym, "status": "unsafe-shape", "detail": f"top-level key {extra[0]!r} dump would drop"}
    if fund.get("stmt_currency") != "USD":
        # Vendor rows carry no currency; merging them into another currency's columns would
        # mix two units in one statement.
        return {"sym": sym, "status": "not-usd", "detail": str(fund.get("stmt_currency"))}
    stmts = dict(fund.get("statements") or {})
    # The emitter's own source for columns already on file — without our stamp, which only
    # columns the vendor actually filled earn.
    file_src = str((fund.get("src") or {}).get("statements") or "")
    base_src = "+".join(p for p in file_src.split("+") if p and p != SOURCE_LABEL) or "unknown"
    # annotate_sec_lineage ran on this file since gen_fund_us last rebuilt it (rule 6).
    sec_lineage = (fund.get("src") or {}).get("statement_lineage") == LINEAGE_SOURCE

    ann_ends = list((stmts.get("annual") or {}).get("period_end") or [])
    ann_ends += [row_end_date(r) or "" for r in ann_rows]
    fy_end_m = fy_end_month_from(ann_ends)

    stats = {}
    for tf, rows in (("annual", ann_rows), ("quarterly", qtr_rows)):
        before = len((stmts.get(tf) or {}).get("periods") or [])
        if not rows:
            # Nothing to add: the set stays exactly as emitted (a null basis stays null).
            stats[tf] = {"added": 0, "filled": 0, "relabeled": 0, "skipped": 0,
                         "held": None, "total": before, "before": before}
            continue
        merged, stats[tf] = merge_period_set(
            stmts.get(tf), rows, fy_end_m, tf, base_src, sec_lineage=sec_lineage
        )
        # A set the vendor added nothing to stays exactly as emitted — no provenance arrays
        # claiming a source that contributed no value.
        if stats[tf]["added"] or stats[tf]["filled"]:
            stmts[tf] = merged

    took = sum(stats[tf]["added"] + stats[tf]["filled"] for tf in stats)
    if took:
        fund["statements"] = stmts
        src = dict(fund.get("src") or {})
        if src.get("statements") and SOURCE_LABEL not in str(src["statements"]).split("+"):
            src["statements"] = f"{src['statements']}+{SOURCE_LABEL}"
        elif not src.get("statements"):
            src["statements"] = SOURCE_LABEL
        fund["src"] = src

    # Write only a real change: an unchanged file keeps its bytes and mtime, so a re-run is
    # a no-op and the nightly's rsync ships nothing it does not have to.
    changed = took > 0 and fund != json.loads(text)
    if changed and not dry_run:
        atomic_write(path, dump(fund))

    return {
        "sym": sym,
        "status": "ok",
        "changed": changed,
        "fy_end_month": fy_end_m,
        "annual": stats["annual"],
        "quarterly": stats["quarterly"],
    }


def backfill_symbol(sym: str, path: Path, key: str, dry_run: bool = False) -> dict:
    """Fetch + merge one symbol. Returns a per-symbol stats dict (never raises on vendor gaps)."""
    try:
        ann_rows = fetch_batch([sym], "annual", key=key)[sym]
        qtr_rows = fetch_batch([sym], "quarterly", key=key)[sym]
    except (VendorHTTPError, ValueError, OSError) as exc:
        return {"sym": sym, "status": "vendor-error", "detail": str(exc)}
    return apply_vendor_rows(sym, path, ann_rows, qtr_rows, dry_run=dry_run)


def _mktcap(path: Path) -> float | None:
    try:
        value = (json.loads(path.read_text()).get("stats") or {}).get("mktcap")
    except (OSError, ValueError, AttributeError):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def sweep_order(paths: list[tuple[str, Path]]) -> list[tuple[str, Path]]:
    """Largest market cap first, unknown caps last, then by symbol (annotate_sec_lineage's order).

    A budget that runs out drops the tail of this list for the night (FAILURE CONTRACT), so
    the tail should be the smallest names, the same ones every night, not the late alphabet.
    """
    caps = {sym: _mktcap(path) for sym, path in paths}
    return sorted(paths, key=lambda sp: (caps[sp[0]] is None, -(caps[sp[0]] or 0.0), sp[0]))


def resolve_key(env_file: str | None) -> str | None:
    """The env file's key when one is named, else the environment's. Never printed."""
    key = key_from_env_file(env_file) if env_file else None
    if key:
        return key
    try:
        return api_key()
    except RuntimeError:
        return None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", help="comma-separated symbols (default: every US *.fund.json)")
    ap.add_argument("--limit", type=int, default=0,
                    help="cap the number of symbols processed (a bare sweep's largest first)")
    ap.add_argument("--dry-run", action="store_true", help="fetch + merge but do not write")
    ap.add_argument("--data-dir", type=Path, default=OUT, help="directory of <SYM>.fund.json files")
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="symbols per vendor request")
    ap.add_argument(
        "--deadline-seconds",
        type=float,
        default=0,
        help="time budget; symbols not reached by then keep the periods on file (0 = none)",
    )
    ap.add_argument(
        "--env-file",
        help="dotenv file to read MASSIVE_API_KEY / POLYGON_API_KEY from (this process only)",
    )
    ap.add_argument("--quiet", action="store_true", help="print only problems and the summary")
    args = ap.parse_args(argv)
    deadline = time.monotonic() + args.deadline_seconds if args.deadline_seconds > 0 else None
    data_dir: Path = args.data_dir

    key = resolve_key(args.env_file)
    if not key:
        where = f"{args.env_file} or the environment" if args.env_file else "the environment"
        print(f"statements backfill: no MASSIVE_API_KEY / POLYGON_API_KEY in {where} — nothing fetched", file=sys.stderr)
        return 2

    if args.only:
        syms = [s.strip().upper() for s in args.only.split(",") if s.strip()]
        paths = [(s, data_dir / f"{s}.fund.json") for s in syms]
        missing = [s for s, p in paths if not p.exists()]
        if missing:
            print(f"no fund.json for: {', '.join(missing)} — run gen_fund_us.py first", file=sys.stderr)
        paths = [(s, p) for s, p in paths if p.exists()]
    else:
        # A bare sweep is US-only: see NON_US_SUFFIXES. An explicit --only is honoured as
        # given, so a one-off probe of a suffixed ticker is still possible.
        paths = sweep_order([
            (p.name.removesuffix(".fund.json"), p)
            for p in data_dir.glob("*.fund.json")
            if is_vendor_market(p.name.removesuffix(".fund.json"))
        ])
    if args.limit:
        paths = paths[: args.limit]

    size = max(1, args.batch_size)
    batches = [paths[i : i + size] for i in range(0, len(paths), size)]
    ok = changed = held = added = filled = relabeled = skipped = gaps = not_usd = errs = 0
    unreached: list[str] = []
    consecutive = 0
    aborted = None
    started = time.monotonic()
    for bi, batch in enumerate(batches):
        syms = [s for s, _ in batch]
        try:
            ann = fetch_batch(syms, "annual", key, deadline=deadline)
            qtr = fetch_batch(syms, "quarterly", key, deadline=deadline)
        except DeadlineReached:
            unreached = [s for b in batches[bi:] for s, _ in b]
            break
        except (VendorHTTPError, ValueError, OSError) as exc:
            errs += len(syms)
            consecutive += 1
            print(
                f"batch {bi + 1}/{len(batches)} ({syms[0]}…{syms[-1]}, {len(syms)} symbols): "
                f"{exc} — files left unchanged",
                file=sys.stderr,
            )
            status = getattr(exc, "status", None)
            if status in SYSTEMIC_STATUSES:
                aborted = f"HTTP {status} is systemic"
            elif consecutive >= MAX_CONSECUTIVE_BATCH_ERRORS:
                aborted = f"{consecutive} consecutive failed batches"
            if aborted:
                unreached = [s for b in batches[bi + 1 :] for s, _ in b]
                break
            continue
        consecutive = 0
        for sym, path in batch:
            try:
                st = apply_vendor_rows(sym, path, ann.get(sym) or [], qtr.get(sym) or [], dry_run=args.dry_run)
            except Exception as exc:  # noqa: BLE001 — one odd file must not stop the sweep
                st = {"sym": sym, "status": "failed", "detail": type(exc).__name__}
            if st["status"] == "ok":
                ok += 1
                changed += bool(st["changed"])
                a, q = st["annual"], st["quarterly"]
                added += a["added"] + q["added"]
                filled += a["filled"] + q["filled"]
                relabeled += a["relabeled"] + q["relabeled"]
                skipped += a["skipped"] + q["skipped"]
                if a["skipped"] or q["skipped"]:
                    print(f"{sym:8s} {a['skipped'] + q['skipped']} vendor periods skipped (label held by another period)", file=sys.stderr)
                for tf, part in (("annual", a), ("quarterly", q)):
                    if part["held"]:
                        held += 1
                        if not args.quiet:
                            print(f"{sym:8s} {tf} set left as emitted ({part['held']})")
                if not args.quiet:
                    print(
                        f"{sym:8s} annual {a['before']:>3}→{a['total']:<3} "
                        f"quarterly {q['before']:>3}→{q['total']:<3} "
                        f"(+{a['added'] + q['added']} periods, {a['filled'] + q['filled']} gap-filled)"
                    )
            elif st["status"] == "no-vendor-coverage":
                gaps += 1
                if not args.quiet:
                    print(f"{sym:8s} no vendor coverage — file left unchanged")
            elif st["status"] == "not-usd":
                not_usd += 1
                if not args.quiet:
                    print(f"{sym:8s} statements in {st['detail']}, not USD — file left unchanged")
            else:
                errs += 1
                print(f"{sym:8s} {st['status']}: {st.get('detail', '')} — file left unchanged", file=sys.stderr)

    print(
        f"statements backfill done in {time.monotonic() - started:.0f}s: {ok} merged "
        f"({changed} changed), {gaps} without vendor coverage, {not_usd} not in USD, {errs} errors, "
        f"{len(unreached)} not reached; "
        f"+{added} periods added, {filled} gap-filled, {relabeled} relabeled, {skipped} skipped, "
        f"{held} period sets held"
        + (" (DRY RUN — nothing written)" if args.dry_run else "")
    )
    if aborted:
        print(f"ABORT: {aborted} — remaining symbols not attempted", file=sys.stderr)
        return 1
    if unreached:
        print(
            f"WARN: time budget spent — {len(unreached)} symbols not reached (from {unreached[0]}); "
            "they keep the periods already on file",
            file=sys.stderr,
        )
    return 1 if errs and not ok else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
