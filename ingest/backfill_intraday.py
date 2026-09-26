"""Pre-store INTRADAY OHLC history for the Terminal chart.

The live intraday path (`/api/intraday` → lib/intradaySources.ts) only serves a short
recent window (10–120 days) with no stored history. This backfill builds a durable
intraday store so hourly/minute charts scroll back years, not days.

Source strategy (settled 2026-07-04):
  * Polygon aggregates = the BULK source. Paid key, no per-page cap (50k bars/req), covers
    ~2021-07 → now (~5y, the key's REST floor). One symbol paginates in ~20 chunks.
  * Alpaca (2016+) is NOT used here — its free tier caps ~3 weeks/request, so bulk 1h for
    the whole universe would take ~45h. Alpaca stays the on-demand deep-scroll fallback in
    the serving layer, not the pre-store source.

What we store (matches the user's "both / maximal" choice):
  * 1h  → ALL US symbols        (full Polygon window; ~20k bars/sym)
  * 5m  → top-N by dollar-vol   (default 800; capped to the recent ~2y to bound file size)
  Sub-hour tfs (10m/15m/30m/45m) resample from 5m; 2h/3h/4h from 1h; 1m/2m/3m stay on-demand.

Epoch convention: we store the SAME "display epoch" the live route emits — ET wall-clock
reinterpreted as a UTC instant (lightweight-charts renders UTC, so this keeps each US bar at
its ET clock position). That makes stored history + the live Polygon tail concatenate with
zero conversion in the serving layer. Bars: [dispEpochSec, o, h, l, c, v], ascending, unique.

Contract:  <OUT>/intraday/<SYM>.<tf>.json = {"t","tf","src":"polygon","asof",<"bars">}
Resumable: skips a (sym,tf) whose file already exists unless --force.

  python ingest/backfill_intraday.py [--tf 1h,5m] [--top N] [--workers 8] [--limit N] [--force]
"""
from __future__ import annotations

import json
import os
import sys
import time
import datetime as dt
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("TERMINAL_DATA_DIR") or (ROOT / "terminal" / "public" / "data"))
MANIFEST = Path(os.environ.get("TERMINAL_MANIFEST") or (OUT / "manifest.json"))
INTRADAY = OUT / "intraday"
ET = ZoneInfo("America/New_York")

# Per-tf: Polygon (multiplier, unit) + how far back to store. 5m capped to ~2y to bound file
# size (5m×5y ≈ 240k bars ≈ 10MB/file); 1h full window is only ~20k bars (~800KB).
TF_SPEC = {
    "1h": {"mult": 1, "unit": "hour", "days": int(6 * 365.25)},
    "5m": {"mult": 5, "unit": "minute", "days": 400},
    "15m": {"mult": 15, "unit": "minute", "days": 760},
    "1m": {"mult": 1, "unit": "minute", "days": 40},
}


def _polygon_key() -> str:
    k = os.environ.get("POLYGON_API_KEY") or os.environ.get("MASSIVE_API_KEY")
    if not k:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith(("POLYGON_API_KEY=", "MASSIVE_API_KEY=")):
                    k = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not k:
        raise RuntimeError("POLYGON_API_KEY not set")
    return k


POLY = _polygon_key()


def _get(url: str, tries: int = 5) -> dict:
    last_error: Exception | None = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terminal-intraday/1.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:                       # rate limited — back off and retry
                last_error = e
                time.sleep(2.0 * (attempt + 1))
                continue
            if 500 <= e.code < 600:
                last_error = e
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception as e:
            last_error = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Polygon aggregate retries exhausted after {tries} attempts") from last_error


def _disp_epoch(ms: int) -> int:
    """Polygon UTC ms → ET wall-clock reinterpreted as a UTC epoch (the route's display epoch)."""
    et = dt.datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ET)
    return int(dt.datetime(et.year, et.month, et.day, et.hour, et.minute, tzinfo=timezone.utc).timestamp())


def fetch_polygon_intraday(sym: str, tf: str, frm: dt.date | None = None) -> list[list]:
    spec = TF_SPEC[tf]
    to = dt.date.today()
    if frm is None:
        frm = to - dt.timedelta(days=spec["days"])
    ticker = sym.upper()
    url = (f"https://api.polygon.io/v2/aggs/ticker/{urllib.parse.quote(ticker)}/range/"
           f"{spec['mult']}/{spec['unit']}/{frm}/{to}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLY}")
    rows: list[list] = []
    pages = 0
    while url and pages < 400:
        d = _get(url)
        status = d.get("status")
        if status not in ("OK", "DELAYED"):
            raise RuntimeError(
                f"invalid aggregate response status={status!r} after {pages} completed page(s)")
        for b in d.get("results") or []:
            rows.append([_disp_epoch(b["t"]), b.get("o"), b.get("h"), b.get("l"),
                         b.get("c"), int(b.get("v") or 0)])
        nxt = d.get("next_url")
        url = (nxt + f"&apiKey={POLY}") if nxt else None
        pages += 1
        if url:
            time.sleep(0.1)
    if url:
        raise RuntimeError(f"pagination incomplete after {pages} pages")
    # ascending + de-dupe by epoch (pagination can overlap a boundary bar)
    rows.sort(key=lambda r: r[0])
    out: list[list] = []
    last = None
    for r in rows:
        if r[0] != last and r[1] is not None:
            out.append(r)
            last = r[0]
    return out


def write_store(sym: str, tf: str, rows: list[list]) -> int:
    """Write an intraday store atomically: temp file + os.replace so readers never see a
    partial file. Returns 0 if the row count is below the minimum viable store size."""
    if len(rows) < 20:
        return 0
    INTRADAY.mkdir(parents=True, exist_ok=True)
    target = INTRADAY / f"{sym}.{tf}.json"
    doc = {"t": sym, "tf": tf, "src": "polygon", "bar_quality": "real_ohlc",
           "asof": rows[-1][0], "bars": rows}
    tmp = INTRADAY / f"{sym}.{tf}.json.tmp.{os.getpid()}"
    tmp.write_text(json.dumps(doc, separators=(",", ":")))
    os.replace(tmp, target)
    return len(rows)


# ---------------------------------------------------------------- incremental refresh (--update)
def load_store(sym: str, tf: str) -> tuple[list[list], int | None]:
    """Existing store bars + asof (last display-epoch), or ([], None) if no file."""
    p = INTRADAY / f"{sym}.{tf}.json"
    if not p.exists():
        return [], None
    try:
        d = json.loads(p.read_text())
        bars = d.get("bars") or []
        return bars, (bars[-1][0] if bars else None)
    except Exception:
        return [], None


def _date_of(disp_epoch: int) -> dt.date:
    """A display-epoch encodes ET wall-clock as UTC, so its UTC date is the ET trading date."""
    return dt.datetime.fromtimestamp(disp_epoch, tz=timezone.utc).date()


def _merge(old: list[list], new: list[list]) -> list[list]:
    """Union old + new by display-epoch (new wins on overlap), ascending, capped to MAX_BARS-ish."""
    by_ep: dict[int, list] = {}
    for r in old:
        by_ep[r[0]] = r
    for r in new:                       # new overwrites old on the same bar (fresher / corrected)
        if r[1] is not None:
            by_ep[r[0]] = r
    return [by_ep[k] for k in sorted(by_ep)]


def existing_stores(tfs: list[str]) -> list[tuple[str, str]]:
    """Enumerate already-present intraday store files for the given timeframes.

    This is the incremental-refresh universe: it NEVER includes a symbol that has no
    store on disk. Dot symbols (e.g. BRK.B) are included — the dot is valid in filenames.
    """
    if not INTRADAY.exists():
        return []
    out: list[tuple[str, str]] = []
    for tf in tfs:
        if tf not in TF_SPEC:
            continue
        pattern = f".{tf}.json"
        for p in INTRADAY.iterdir():
            if p.name.endswith(pattern) and p.name != f"{pattern}":  # guard empty glob
                sym = p.name[: -len(pattern)]
                out.append((sym, tf))
    return out


# ---------------------------------------------------------------- universe
NON_US_SUFFIX = (".HK", ".TO", ".SS", ".SZ", "-USD")


def us_symbols_ranked() -> list[str]:
    """US symbols, ranked by dollar volume (manifest last×vol) desc — most-liquid first."""
    syms = json.loads(MANIFEST.read_text())["symbols"]
    scored: list[tuple[float, str]] = []
    for s, rec in syms.items():
        if s.endswith(NON_US_SUFFIX):
            continue
        mkt = rec.get("mkt")
        if not (mkt in {"NYSE", "NASDAQ", "AMEX", "US", "Cboe", "NYSE Arca", "IEX"}
                or s.replace(".", "").replace("-", "").isalpha()):
            continue
        last = rec.get("last") or 0
        vol = rec.get("vol") or 0
        scored.append(((last or 0) * (vol or 0), s))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s for _, s in scored]


def main(argv: list[str]) -> int | None:
    """Returns total failed count, or None if there was nothing to do."""
    def opt(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    tfs = (opt("--tf") or "1h,5m").split(",")
    top = int(opt("--top") or 500)
    workers = int(opt("--workers") or 8)
    limit = int(opt("--limit") or 0)
    force = "--force" in argv
    update = "--update" in argv   # incremental: extend existing store files with recent bars
    existing_only = "--existing-only" in argv

    # --existing-only: enumerate only the stores already on disk. Bypasses manifest/top-N;
    # never creates a missing symbol. Not usable with --update (they share the same path).
    if existing_only:
        jobs = existing_stores(tfs)
        print(f"intraday refresh --existing-only: {len(jobs)} existing (sym,tf) jobs | "
              f"tfs={tfs} workers={workers}", flush=True)
    else:
        ranked = us_symbols_ranked()
        if limit:
            ranked = ranked[:limit]
        top_set = set(ranked[:top])

        jobs: list[tuple[str, str]] = []
        for tf in tfs:
            if tf not in TF_SPEC:
                print(f"skip unknown tf {tf}", flush=True)
                continue
            pool = ranked if tf == "1h" else [s for s in ranked if s in top_set]
            for s in pool:
                if not force and not update and (INTRADAY / f"{s}.{tf}.json").exists():
                    continue
                jobs.append((s, tf))
        print(f"intraday backfill{' [update]' if update else ''}: {len(jobs)} (sym,tf) jobs | "
              f"tfs={tfs} top={top} universe={len(ranked)} workers={workers}", flush=True)

    if not jobs:
        print("intraday backfill: no jobs — nothing to do", flush=True)
        return None

    def work(job):
        s, tf = job
        try:
            if update or existing_only:
                old, asof = load_store(s, tf)
                if asof is not None:
                    frm = _date_of(asof) - dt.timedelta(days=3)
                    recent = fetch_polygon_intraday(s, tf, frm=frm)
                    if not recent:
                        return s, tf, 0
                    merged = _merge(old, recent)[-60000:]
                    return s, tf, write_store(s, tf, merged)
                if existing_only:
                    return s, tf, -1  # refresh-only mode never invents/rebuilds a missing store
                # Preserve legacy --update semantics: a newly listed symbol with no store
                # falls through to the ordinary full backfill path.
            rows = fetch_polygon_intraday(s, tf)
            return s, tf, write_store(s, tf, rows)
        except Exception:
            return s, tf, -1

    attempted = written = unchanged = failed = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        for f in as_completed(futs):
            s, tf, n = f.result()
            attempted += 1
            if n and n > 0:
                written += 1
            elif n == 0:
                unchanged += 1
            else:
                failed += 1
            if attempted % 100 == 0 or attempted == len(jobs):
                rate = attempted / max(1e-9, time.time() - t0)
                print(f"  {attempted}/{len(jobs)} | {written} written {unchanged} unchanged "
                      f"{failed} failed | {rate:.1f}/s", flush=True)

    print(f"intraday backfill complete: {written}/{len(jobs)} stored "
          f"(unchanged={unchanged} failed={failed}) in {time.time()-t0:.0f}s", flush=True)
    return failed


if __name__ == "__main__":
    failed = main(sys.argv[1:])
    if failed:
        sys.exit(1)
