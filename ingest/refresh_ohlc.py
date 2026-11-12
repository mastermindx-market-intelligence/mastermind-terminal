#!/usr/bin/env python3
"""refresh_ohlc.py — append recent daily bars to EXISTING US OHLC files from Polygon
grouped-daily (ONE call per date covers the whole US market). Fills the gap left by
backfill_ohlc.py, which only fetches NEW symbols and never refreshes existing ones — so
non-flagship OHLC (and thus watchlist LAST/CHG via hydrate_prices) was frozen. Memory-
light: a few grouped snapshots in RAM; OHLC files rewritten one at a time (atomic).
Only appends dates strictly newer than each file's last bar (no dups; won't clobber
flagship bars already written by build_polygon_universe).

Appends go through merge_refresh (U01): the overlap check refuses the whole append when
a vendor close on an ALREADY-STORED date disagrees beyond BASIS_DRIFT_TOLERANCE (a new
split factor or a corrected bar — one file must never silently mix bases), then the
append re-runs the ticker-reuse guard, RETAINING guard-dropped bars under
`retained_suspected_history` instead of silently deleting them, and stamps/updates the
`view` provenance block (segments, basis_drift, suspected_breaks, refusal_reasons).

Usage: refresh_ohlc.py [--days N] [--write]   (default days=7; dry-run unless --write)
"""
import json, os, sys, urllib.request, datetime as dt

try:
    from ingest.polygon_bars import merge_refresh  # package context (tests)
except ImportError:  # run as `python ingest/refresh_ohlc.py` — same-dir import
    from polygon_bars import merge_refresh

D = os.environ.get("TERMINAL_DATA_DIR", "/opt/terminal/terminal/public/data")
US_MKTS = {"NASDAQ", "NYSE", "US", "AMEX", "NYSEAMERICAN", "NYSE American", "NYSE Arca", "BATS"}


def _polygon_key():
    poly = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLYGON_KEY")
    if not poly and os.path.exists("/opt/terminal/.env"):
        for line in open("/opt/terminal/.env"):
            line = line.strip()
            for k in ("POLYGON_API_KEY=", "POLYGON_KEY="):
                if line.startswith(k):
                    poly = line.split("=", 1)[1].strip().strip('"').strip("'")
    return poly


def grouped(date_str, poly):
    url = (f"https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/{date_str}"
           f"?adjusted=true&apiKey={poly}")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            d = json.loads(r.read())
    except Exception:
        return {}
    out = {}
    for x in d.get("results") or []:
        t = x.get("T")
        if t and None not in (x.get("o"), x.get("h"), x.get("l"), x.get("c")):
            out[t] = [date_str, x.get("o"), x.get("h"), x.get("l"), x.get("c"), x.get("v")]
    return out


def merge_file(sym: str, d: dict, rows: list) -> tuple[dict, int, dict]:
    """Pure per-file merge factored out of main(): (doc, n_new, report).

    Keeps the historical precondition that a file with no stored bars is never seeded
    from grouped snapshots, then delegates to merge_refresh (basis-drift refusal,
    retained suspected breaks, view stamp). main() only does I/O around this.
    """
    if not (d.get("bars") or []):
        return d, 0, {}
    return merge_refresh(sym, d, list(rows))


def main():
    write = "--write" in sys.argv
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 7
    poly = _polygon_key()
    assert poly, "no polygon key"

    today = dt.date.today()
    by_tkr, dates_ok = {}, []
    for i in range(days, -1, -1):
        ds = (today - dt.timedelta(days=i)).isoformat()
        g = grouped(ds, poly)
        if not g:
            continue
        dates_ok.append(ds)
        for t, bar in g.items():
            by_tkr.setdefault(t, {})[ds] = bar
    print(f"grouped days with data: {dates_ok}  |  tickers: {len(by_tkr)}")

    # Universe = the LIVE manifest, deliberately NOT $TERMINAL_MANIFEST: during the nightly
    # this runs in Phase 1 when the staging manifest holds only the ~37 flagship rows, so
    # reading staging silently reduced the refresh to a no-op (0 of ~3,100 US symbols
    # updated, 2026-07-10/11). The live manifest is last night's full universe — exactly
    # the set of existing OHLC files this script appends to.
    man = json.load(open(os.path.join(D, "manifest.json")))
    updated = appended = refused = 0
    sample = {}
    for sym, row in man["symbols"].items():
        if row.get("mkt") not in US_MKTS:
            continue
        gt = by_tkr.get(sym)
        if not gt:
            continue
        p = os.path.join(D, f"{sym}.json")
        if not os.path.exists(p):
            continue
        try:
            d = json.load(open(p))
        except Exception:
            continue
        doc, n_new, report = merge_file(sym, d, list(gt.values()))
        drift = report.get("basis_drift")
        if drift:
            refused += 1
        if not n_new and not drift:
            continue
        appended += n_new
        if write:
            tmp = p + ".tmp"
            json.dump(doc, open(tmp, "w"), separators=(",", ":"))
            os.replace(tmp, p)
        updated += 1
        if sym in ("WM", "REGN", "MCK", "SOFI", "KRUS", "ZS", "FOUR", "VEEV", "YELP", "CNI"):
            sample[sym] = {"new_last_date": doc["bars"][-1][0], "close": doc["bars"][-1][4]}

    print(f"US symbols updated: {updated}  |  bars appended: {appended}")
    print(f"basis drift refused: {refused}")
    print("sample:", json.dumps(sample))
    print("WROTE" if write else "DRY-RUN (no write)")


if __name__ == "__main__":
    main()
