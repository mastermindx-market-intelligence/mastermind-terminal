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
import math
import os
import re
import sys
import threading
import time
import uuid
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

MAX_STORE_ROWS = 60000
FINALITY_LAG_S = 900
_stats_lock = threading.Lock()

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

EXIT_OK = 0
EXIT_STORE_FAILURES = 1
EXIT_NO_STORES = 2

_INTRO_REDACT_PATTERNS = (
    (re.compile(r"(?i)(apikey=)([^&\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(r"(?i)(api_key=)([^&\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(r"(?i)(apikey%3d)([^&\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(r"(?i)(api_key%3d)([^&\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(r'(?i)("apiKey"\s*:\s*")([^"\',})]+)'), r"\1REDACTED"),
    (re.compile(r"(?i)('apiKey'\s*:\s*')([^'\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(r"(?i)(apikey\s*:\s*)([^&\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(r"(?i)(api_key\s*:\s*)([^&\s\"',})]+)"), r"\1REDACTED"),
)


def _redact(text: str) -> str:
    try:
        s = text if isinstance(text, str) else str(text)
        for pat, repl in _INTRO_REDACT_PATTERNS:
            s = pat.sub(repl, s)
        if isinstance(POLY, str) and len(POLY) >= 8:
            s = s.replace(POLY, "REDACTED")
        return s
    except Exception:
        # Fail closed: a redactor that cannot run must not hand back the raw text.
        return "[redaction failed: message withheld]"


def _tf_seconds(tf: str) -> int:
    spec = TF_SPEC[tf]
    unit = spec["unit"]
    mult = spec["mult"]
    if unit == "minute":
        return mult * 60
    if unit == "hour":
        return mult * 3600
    raise ValueError(f"unsupported tf unit {unit!r}")


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


def _validate_aggregate_bar(b: dict, sym: str, tf: str) -> None:
    t = b.get("t")
    if not isinstance(t, int) or isinstance(t, bool):
        raise RuntimeError(f"malformed aggregate bar for {sym} {tf}: t")
    for field in ("o", "h", "l", "c"):
        val = b.get(field)
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            raise RuntimeError(f"malformed aggregate bar for {sym} {tf}: {field}")
        if not math.isfinite(val) or val <= 0:
            raise RuntimeError(f"malformed aggregate bar for {sym} {tf}: {field}")
    if b["h"] < b["l"]:
        raise RuntimeError(f"malformed aggregate bar for {sym} {tf}: h")
    vol = b.get("v")
    if vol is not None:
        if isinstance(vol, bool) or not isinstance(vol, (int, float)):
            raise RuntimeError(f"malformed aggregate bar for {sym} {tf}: v")
        if not math.isfinite(vol) or vol < 0:
            raise RuntimeError(f"malformed aggregate bar for {sym} {tf}: v")


def fetch_polygon_intraday(
    sym: str,
    tf: str,
    frm: dt.date | None = None,
    *,
    now: float | None = None,
    stats: dict | None = None,
) -> list[list]:
    spec = TF_SPEC[tf]
    if now is None:
        now = time.time()
    to = dt.date.today()
    if frm is None:
        frm = to - dt.timedelta(days=spec["days"])
    ticker = sym.upper()
    url = (f"https://api.polygon.io/v2/aggs/ticker/{urllib.parse.quote(ticker)}/range/"
           f"{spec['mult']}/{spec['unit']}/{frm}/{to}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLY}")
    rows: list[list] = []
    pages = 0
    bar_seconds = _tf_seconds(tf)
    finality_cutoff = now - FINALITY_LAG_S
    while url and pages < 400:
        d = _get(url)
        status = d.get("status")
        if status not in ("OK", "DELAYED"):
            raise RuntimeError(
                f"invalid aggregate response status={status!r} after {pages} completed page(s)")
        if status == "DELAYED" and stats is not None:
            with _stats_lock:
                stats["delayed_pages"] = stats.get("delayed_pages", 0) + 1
        for b in d.get("results") or []:
            _validate_aggregate_bar(b, sym, tf)
            bar_end = b["t"] / 1000 + bar_seconds
            if bar_end > finality_cutoff:
                if stats is not None:
                    with _stats_lock:
                        stats["forming_skipped"] = stats.get("forming_skipped", 0) + 1
                continue
            vol = b.get("v")
            rows.append([_disp_epoch(b["t"]), b["o"], b["h"], b["l"], b["c"],
                         int(vol or 0)])
        nxt = d.get("next_url")
        url = (nxt + f"&apiKey={POLY}") if nxt else None
        pages += 1
        if url:
            time.sleep(0.1)
    if url:
        raise RuntimeError(f"pagination incomplete after {pages} pages")
    rows.sort(key=lambda r: r[0])
    out: list[list] = []
    last = None
    for r in rows:
        if r[0] != last:
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
    tmp = INTRADAY / (
        f"{sym}.{tf}.json.tmp.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex[:8]}"
    )
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps(doc, separators=(",", ":")))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
        try:
            dfd = os.open(str(INTRADAY), os.O_RDONLY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        except OSError:
            pass
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
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


def main(argv: list[str]) -> int:
    """Exit contract: EXIT_OK, EXIT_STORE_FAILURES, or EXIT_NO_STORES."""
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
        if existing_only:
            print(f"intraday backfill: no existing stores under {INTRADAY} — refusing to report success",
                  flush=True)
            return EXIT_NO_STORES
        print("intraday backfill: no jobs — nothing to do", flush=True)
        return EXIT_OK

    seen: set[tuple[str, str]] = set()
    deduped: list[tuple[str, str]] = []
    for job in jobs:
        if job not in seen:
            seen.add(job)
            deduped.append(job)
    jobs = deduped

    stats: dict = {"delayed_pages": 0, "forming_skipped": 0}
    failures: list[str] = []
    total_dropped = 0

    def work(job):
        s, tf = job
        dropped_local = 0
        try:
            if update or existing_only:
                old, asof = load_store(s, tf)
                if asof is not None:
                    frm = _date_of(asof) - dt.timedelta(days=3)
                    recent = fetch_polygon_intraday(s, tf, frm=frm, stats=stats)
                    if not recent:
                        return s, tf, 0, 0
                    merged_full = _merge(old, recent)
                    dropped_local = max(0, len(merged_full) - MAX_STORE_ROWS)
                    if dropped_local > 0:
                        print(f"  retention: {s}.{tf} dropped {dropped_local} oldest row(s) "
                              f"(cap {MAX_STORE_ROWS})", flush=True)
                    merged = merged_full[-MAX_STORE_ROWS:]
                    return s, tf, write_store(s, tf, merged), dropped_local
                if existing_only:
                    failures.append(
                        f"{s}.{tf}: StoreUnreadable: existing store has no readable bars"
                    )
                    return s, tf, -1, 0  # refresh-only mode never invents/rebuilds a missing store
                # Preserve legacy --update semantics: a newly listed symbol with no store
                # falls through to the ordinary full backfill path.
            rows = fetch_polygon_intraday(s, tf, stats=stats)
            return s, tf, write_store(s, tf, rows), 0
        except Exception as e:
            failures.append(f"{s}.{tf}: {type(e).__name__}: {_redact(str(e))[:300]}")
            return s, tf, -1, 0

    attempted = written = unchanged = failed = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        for f in as_completed(futs):
            s, tf, n, dropped_local = f.result()
            total_dropped += dropped_local
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

    for i, text in enumerate(failures[:50]):
        print(f"  FAILED {text}", flush=True)
    if len(failures) > 50:
        print(f"  ... and {len(failures) - 50} more failure(s)", flush=True)

    print(
        f"intraday backfill complete: {written}/{len(jobs)} stored "
        f"(unchanged={unchanged} failed={failed} retention_dropped={total_dropped} "
        f"forming_skipped={stats['forming_skipped']} delayed_pages={stats['delayed_pages']}) "
        f"in {time.time()-t0:.0f}s",
        flush=True,
    )
    return EXIT_STORE_FAILURES if failed else EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
