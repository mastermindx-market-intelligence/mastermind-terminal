"""Polygon historical bars → the chart OHLC contract.

Backtesting feed (NOT live trading — that waits on the Alpaca/live decision). Reuses
the macro repo's Polygon/Massive key (api.polygon.io). Real OHLC, so bar_quality is
"real_ohlc" (unlike the macro deep store's synthetic open).

We shell out to `curl` rather than urllib because some edge endpoints 1010-block the
default urllib user-agent (learned the hard way against another API).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess

BASE = "https://api.polygon.io"
KEY = os.environ.get("POLYGON_API_KEY") or os.environ.get("MASSIVE_API_KEY") or ""

# DB/UI symbol → Polygon ticker (crypto needs the X: prefix and no dash)
CRYPTO = {"BTC-USD": "X:BTCUSD", "ETH-USD": "X:ETHUSD", "SOL-USD": "X:SOLUSD", "XRP-USD": "X:XRPUSD"}

# Polygon aggs are keyed by TICKER STRING, so a symbol whose ticker previously belonged
# to a DIFFERENT security returns the old holder's bars too. META has been Meta Platforms
# only since the FB→META rename on 2022-06-09; before that the ticker was the Roundhill
# Ball Metaverse ETF (~$12-15), whose bars poisoned the 2022 seasonality path (a fake
# +1395% Jan→Jun jump) and the confluence/backtest close series.
# The same applies to the yfinance/Tencent feeds (keyed the same way):
#   SPCX    — The SPAC and New Issue ETF until its 2026-04 delisting; Space Exploration
#             Technologies (SpaceX) Class A since its 2026-06-12 Nasdaq listing
#             (Polygon reference list_date; splits endpoint empty — reuse, not a split).
#   0300.HK — HKEX reissued the code to Midea Group H-shares (listed 2024-09-17); a
#             stray prior-holder bar (2024-07-05 close 2.49) poisoned the backfill.
HISTORY_START = {
    "META": "2022-06-09",
    "SPCX": "2026-06-12",
    "0300.HK": "2024-09-17",
}

# Generic guard for the same failure shape anywhere else in the universe: a months-long
# trading gap combined with an extreme price jump across it means the ticker changed
# hands. Keep only the newest contiguous segment — a real halt this violent is rare, and
# for charting/seasonality the recent segment is the honest series either way.
REUSE_GAP_DAYS = 45
REUSE_JUMP_RATIO = 3.0

# ---------------------------------------------------------------- Data OS view contract
# U01: the daily-OHLC producer STAMPS provenance; it never re-derives basis / as-of /
# generation itself (D00.A1). Macro emits <ohlc_dir>/_view_contract.json (package C01);
# absence is the NORMAL state today and is reported, never papered over.
VIEW_CONTRACT_FILE = "_view_contract.json"
VIEW_CONTRACT_SCHEMA = "dataos.view_contract.v1"
VIEW_PURPOSE = "terminal_daily_ohlc"
VIEW_MIC_SCOPE = {"XNYS", "XNAS", "XASE", "ARCX"}   # D00.A1.3 venues (consumer A v1)
VIEW_SCHEMA = "terminal.ohlc_view.v1"
_VIEW_CONTRACT_REFUSALS = ("VIEW_CONTRACT_ABSENT", "VIEW_CONTRACT_INVALID", "VIEW_BASIS_UNSUPPORTED")

# U01.03: a vendor close on an ALREADY-STORED date that disagrees with the stored close
# beyond this ratio tolerance means the file's basis no longer matches the vendor's
# (a new split factor ~2.0, or a corrected historical bar) — refuse the whole append
# rather than silently mixing bases inside one file.
BASIS_DRIFT_TOLERANCE = 0.02


def load_view_contract(ohlc_dir) -> tuple[dict | None, list]:
    """Read Macro's emitted view contract verbatim: (contract_or_None, refusal_codes).

    The producer copies Macro's contract; it never derives basis / as-of / generation.
    Absence is the normal state until package C01 lands the emitter.
    """
    path = os.path.join(ohlc_dir, VIEW_CONTRACT_FILE)
    if not os.path.exists(path):
        return None, ["VIEW_CONTRACT_ABSENT"]
    try:
        with open(path) as f:
            contract = json.load(f)
    except (OSError, ValueError):
        return None, ["VIEW_CONTRACT_INVALID"]
    if not isinstance(contract, dict):
        return None, ["VIEW_CONTRACT_INVALID"]
    if contract.get("schema") != VIEW_CONTRACT_SCHEMA or contract.get("purpose") != VIEW_PURPOSE:
        return None, ["VIEW_CONTRACT_INVALID"]
    required = ("schema", "purpose", "identity_namespace", "field_units", "adjustment_reference",
                "evidence_mode", "coverage", "listings", "refusal_reasons")
    if any(k not in contract for k in required):
        return None, ["VIEW_CONTRACT_INVALID"]
    adj = contract.get("adjustment_reference")
    if (adj.get("basis") if isinstance(adj, dict) else None) != "tradj":
        return None, ["VIEW_BASIS_UNSUPPORTED"]      # consumer A v1 is TRADJ only
    return contract, []


def view_block(sym, contract, contract_refusals, segments, *, basis_drift=None, suspected_breaks=()) -> dict:
    """The per-file `view` block (schema terminal.ohlc_view.v1). Pure.

    `contract` is Macro's emitted contract dict (already validated) or None; its
    top-level fields except `listings` are copied VERBATIM. Refusal codes beyond the
    contract's own are derived here: LISTING_ABSENT, VENUE_OUT_OF_SCOPE,
    BASIS_DRIFT_SUSPECTED, SEGMENT_SRC_UNKNOWN.
    """
    refusals = list(contract_refusals)
    contract_fields = listing = None
    if contract is not None:
        contract_fields = {k: v for k, v in contract.items() if k != "listings"}
        listings = contract.get("listings")
        listing = listings.get(sym) if isinstance(listings, dict) else None
        if listing is None:
            refusals.append("LISTING_ABSENT")
        elif not isinstance(listing, dict) or listing.get("mic") not in VIEW_MIC_SCOPE:
            refusals.append("VENUE_OUT_OF_SCOPE")
    if basis_drift is not None:
        refusals.append("BASIS_DRIFT_SUSPECTED")
    if any(isinstance(s, dict) and s.get("src") == "unknown" for s in segments):
        refusals.append("SEGMENT_SRC_UNKNOWN")
    return {
        "schema": VIEW_SCHEMA,
        "contract": contract_fields,
        "listing": listing,
        "segments": [dict(s) for s in segments],
        "basis_drift": dict(basis_drift) if basis_drift is not None else None,
        "suspected_breaks": [dict(b) for b in suspected_breaks],
        "refusal_reasons": sorted(set(refusals)),
    }


def split_suspected_history(sym: str, bars: list) -> tuple[list, list, list]:
    """The ticker-reuse guard, split into its parts (U01.04: suspected breaks are
    RETAINED, never silently deleted).

    Returns (kept, dropped, breaks): `kept` is the newest contiguous segment exactly
    as drop_stale_ticker_history returns it today; `dropped` are the bars the guard
    removes (callers persist them under `retained_suspected_history`); `breaks` are
    the SUSPECTED discontinuity records. HISTORY_START trims first and those bars are
    discarded as before — the curated table is identity, not suspicion.
    """
    start = HISTORY_START.get(sym)
    if start:
        bars = [b for b in bars if b[0] >= start]
    cut = prior = 0
    breaks = []
    for i in range(1, len(bars)):
        prev_b, cur_b = bars[i - 1], bars[i]
        try:
            gap = (dt.date.fromisoformat(cur_b[0]) - dt.date.fromisoformat(prev_b[0])).days
        except ValueError:
            continue
        pc, cc = prev_b[4], cur_b[4]
        if gap >= REUSE_GAP_DAYS and pc and cc:
            ratio = cc / pc
            if ratio >= REUSE_JUMP_RATIO or ratio <= 1 / REUSE_JUMP_RATIO:
                cut = i  # keep scanning: retain only the segment after the LAST break
                breaks.append({"status": "SUSPECTED", "at": cur_b[0],
                               "reason": f"gap>={REUSE_GAP_DAYS}d and close jump>={REUSE_JUMP_RATIO:g}x",
                               "retained_bars": i - prior})
                prior = i
    return (bars[cut:], bars[:cut], breaks) if cut else (bars, [], breaks)


def drop_stale_ticker_history(sym: str, bars: list) -> list:
    """Trim bars that predate the current holder of a reused ticker.

    bars: [[date, o, h, l, c, v], ...] ascending. Applies the curated HISTORY_START
    cutoff first, then the generic gap+jump discontinuity guard. Keeps its historic
    contract (returns only the kept segment); split_suspected_history additionally
    exposes the dropped bars + SUSPECTED break records for the view block.
    """
    kept, dropped, _breaks = split_suspected_history(sym, bars)
    if dropped:
        print(f"  {sym}: dropped {len(dropped)} pre-{kept[0][0]} bars (ticker-reuse discontinuity)")
    return kept


def append_recent_bars(sym: str, bars: list, new_rows: list) -> tuple[list, int]:
    """Merge freshly fetched rows into an existing OHLC series, guarding ticker reuse.

    Appends only rows strictly newer than the last existing bar (the idempotence rule
    the refresh scripts already used), then re-runs drop_stale_ticker_history over the
    stitched series: when a ticker changes hands, the first refresh after the new
    holder's debut stitches its bars onto the old holder's file (SPCX 2026-06: SPAC ETF
    file + SpaceX bars) — the discontinuity guard then keeps only the new segment.
    Returns (bars, n_appended); n_appended == 0 means nothing new arrived, so callers
    skip the write.
    """
    last = bars[-1][0] if bars else ""
    fresh = sorted((r for r in new_rows if r and r[0] > last), key=lambda r: r[0])
    if not fresh:
        return bars, 0
    return drop_stale_ticker_history(sym, bars + fresh), len(fresh)


def _existing_segments(doc: dict) -> list:
    """The doc's current segment list: the stamped view's, or a prefix segment derived
    from the doc's own top-level src / bar_quality for every file written before views
    existed (missing -> "unknown"; never guessed)."""
    view = doc.get("view")
    if isinstance(view, dict) and view.get("schema") == VIEW_SCHEMA and isinstance(view.get("segments"), list):
        return [dict(s) for s in view["segments"] if isinstance(s, dict)]
    bars = [b for b in (doc.get("bars") or []) if b]
    if not bars:
        return []
    return [{"from": bars[0][0], "to": bars[-1][0],
             "src": doc.get("src") or "unknown",
             "bar_quality": doc.get("bar_quality") or "unknown"}]


def _doc_view(sym: str, doc: dict, segments: list, *, basis_drift=None, breaks=()) -> dict:
    """(Re)build the doc's view block for a refresh write.

    The contract fields stamped by build_universe are carried verbatim — refresh runs
    on the Terminal host and cannot re-read Macro's contract; re-stamping is the
    rebuild's job. A legacy doc gets contract null + VIEW_CONTRACT_ABSENT. A previously
    suspected basis_drift stays flagged until a rebuild clears it (sticky refusal).
    """
    view = doc.get("view")
    if isinstance(view, dict) and view.get("schema") == VIEW_SCHEMA:
        contract_fields, listing = view.get("contract"), view.get("listing")
        contract_refusals = [c for c in (view.get("refusal_reasons") or []) if c in _VIEW_CONTRACT_REFUSALS]
        prior_drift = view.get("basis_drift") if isinstance(view.get("basis_drift"), dict) else None
        prior_breaks = [b for b in (view.get("suspected_breaks") or []) if isinstance(b, dict)]
    else:
        contract_fields = listing = None
        contract_refusals = ["VIEW_CONTRACT_ABSENT"]
        prior_drift, prior_breaks = None, []
    contract = dict(contract_fields, listings={sym: listing}) if isinstance(contract_fields, dict) else None
    by_at = {b.get("at"): b for b in prior_breaks}
    for b in breaks:
        by_at[b.get("at")] = dict(b)
    return view_block(sym, contract, contract_refusals, segments,
                      basis_drift=basis_drift or prior_drift,
                      suspected_breaks=[by_at[k] for k in sorted(by_at)])


def _merge_retained(prior, dropped: list) -> list:
    """retained_suspected_history: bars, de-duplicated by date, ascending."""
    merged = {}
    for b in prior or []:
        if b:
            merged[b[0]] = b
    for b in dropped:
        merged[b[0]] = b          # the live series wins on date collisions
    return [merged[k] for k in sorted(merged)]


def merge_refresh(sym: str, doc: dict, new_rows: list,
                  *, tolerance: float = BASIS_DRIFT_TOLERANCE) -> tuple[dict, int, dict]:
    """Refresh a stored OHLC doc with vendor rows (U01 seams). Pure.

    Overlap check FIRST (U01.03): any vendor close on an ALREADY-STORED date that
    disagrees beyond `tolerance` (ratio = stored_close / vendor_close) means the file's
    basis no longer matches the vendor's — a new split factor or a corrected historical
    bar — so NOTHING is appended, `bars` stays byte-unchanged, and view.basis_drift
    records the latest such date. Returns (doc, n_new, report); n_new == 0 means the
    caller skips counting an append (a refusal is visible via report["basis_drift"]).

    Otherwise appends exactly as append_recent_bars does (strictly newer dates,
    ascending, then the reuse guard), and updates the view: segments extend or add the
    polygon real-OHLC segment; guard-dropped bars are RETAINED under
    `retained_suspected_history` with SUSPECTED break records (U01.04) instead of being
    silently deleted, while `bars` keeps today's series for every downstream consumer.
    """
    report = {"basis_drift": False}
    bars = [b for b in (doc.get("bars") or []) if b]
    stored = {b[0]: b for b in bars}
    drift = None
    for r in sorted((r for r in new_rows if r), key=lambda r: r[0]):
        sb = stored.get(r[0])
        if sb is None or not sb[4] or not r[4]:
            continue
        ratio = sb[4] / r[4]
        if abs(ratio - 1.0) > tolerance:
            drift = {"status": "SUSPECTED", "date": r[0], "stored_close": sb[4],
                     "vendor_close": r[4], "ratio": ratio}   # latest offending date wins
    if drift is not None:
        report["basis_drift"] = True
        out = dict(doc)
        out["view"] = _doc_view(sym, doc, _existing_segments(doc), basis_drift=drift)
        return out, 0, report

    last = bars[-1][0] if bars else ""
    fresh = sorted((r for r in new_rows if r and r[0] > last), key=lambda r: r[0])
    if not fresh:
        return doc, 0, report
    kept, dropped, breaks = split_suspected_history(sym, bars + fresh)
    if dropped:
        print(f"  {sym}: dropped {len(dropped)} pre-{kept[0][0]} bars (ticker-reuse discontinuity)")
    segments = _existing_segments(doc)
    if segments and segments[-1].get("src") == "polygon" and segments[-1].get("bar_quality") == "real_ohlc":
        segments[-1]["to"] = fresh[-1][0]                  # extend the polygon segment
    else:
        segments.append({"from": fresh[0][0], "to": fresh[-1][0],
                         "src": "polygon", "bar_quality": "real_ohlc"})
    out = dict(doc)
    out["bars"] = kept
    if dropped:
        out["retained_suspected_history"] = _merge_retained(doc.get("retained_suspected_history"), dropped)
    out["view"] = _doc_view(sym, doc, segments, breaks=breaks)
    return out, len(fresh), report


def poly_ticker(sym: str) -> str:
    return CRYPTO.get(sym, sym)


def _get(url: str) -> dict:
    r = subprocess.run(["curl", "-s", "-m", "30", url], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {"status": "ERROR", "error": r.stdout[:200]}


def fetch_daily(sym: str, years: int = 6, end: dt.date | None = None) -> list:
    """Daily OHLCV bars as [date, o, h, l, c, v] (oldest→newest)."""
    if not KEY:
        raise RuntimeError("POLYGON_API_KEY / MASSIVE_API_KEY not set")
    end = end or dt.date.today()
    start = end - dt.timedelta(days=int(365.25 * years) + 5)
    t = poly_ticker(sym)
    url = (f"{BASE}/v2/aggs/ticker/{t}/range/1/day/{start}/{end}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={KEY}")
    d = _get(url)
    if d.get("status") not in ("OK", "DELAYED") or not d.get("results"):
        return []
    out = []
    for a in d["results"]:
        date = dt.datetime.utcfromtimestamp(a["t"] / 1000).strftime("%Y-%m-%d")
        out.append([date, round(a["o"], 4), round(a["h"], 4), round(a["l"], 4),
                    round(a["c"], 4), int(a.get("v", 0))])
    return drop_stale_ticker_history(sym, out)


def ohlc_json(sym: str, bars: list) -> dict:
    """The chart OHLC contract (mirrors build_chart_data.py; real OHLC from Polygon)."""
    return {"t": sym, "o": 1, "src": "polygon", "bar_quality": "real_ohlc", "bars": bars}
