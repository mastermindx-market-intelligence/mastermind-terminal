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
sys.path.insert(0, str(ROOT))
from ingest import intraday_capture as capture_owner  # noqa: E402

_capture_runs = threading.local()


def _active_run(sym: str, tf: str):
    run = getattr(_capture_runs, "current", None)
    return run if run and run["identity"] == (sym, tf) else None


OUT = Path(os.environ.get("TERMINAL_DATA_DIR") or (ROOT / "terminal" / "public" / "data"))
MANIFEST = Path(os.environ.get("TERMINAL_MANIFEST") or (OUT / "manifest.json"))
INTRADAY = OUT / "intraday"
ET = ZoneInfo("America/New_York")

MAX_STORE_ROWS = 60000
FINALITY_LAG_S = 900
MIN_STORE_ROWS = 20
# A refresh re-reads the last few days the store already holds. If the vendor now quotes those
# same bars on another price basis (a split or reverse split re-adjusts all history), merging
# would leave one store on two bases. The median new/old close over the shared bars decides.
BASIS_MIN_SHARED = 5
BASIS_TOLERANCE = 0.005
# When fewer than BASIS_MIN_SHARED bars overlap, ratio >= BASIS_GROSS or <= 1/BASIS_GROSS
# triggers a main-budget rebuild; otherwise a thin-budget rebuild needs THIN_MIN_SHARED+
# agreeing bars (each within BASIS_TOLERANCE of the median) and |median-1| > BASIS_TOLERANCE.
BASIS_GROSS = 1.25
THIN_MIN_SHARED = 2
# NYSE full-day closures (America/New_York calendar dates), 2026–2027.
_NYSE_HOLIDAYS: frozenset[dt.date] = frozenset({
    dt.date(2026, 1, 1),
    dt.date(2026, 1, 19),
    dt.date(2026, 2, 16),
    dt.date(2026, 4, 3),
    dt.date(2026, 5, 25),
    dt.date(2026, 6, 19),
    dt.date(2026, 7, 3),
    dt.date(2026, 9, 7),
    dt.date(2026, 11, 26),
    dt.date(2026, 12, 25),
    dt.date(2027, 1, 1),
    dt.date(2027, 1, 18),
    dt.date(2027, 2, 15),
    dt.date(2027, 3, 26),
    dt.date(2027, 5, 31),
    dt.date(2027, 6, 18),
    dt.date(2027, 7, 5),
    dt.date(2027, 9, 6),
    dt.date(2027, 11, 25),
    dt.date(2027, 12, 24),
})
_NYSE_HOLIDAY_CALENDAR_END = max(_NYSE_HOLIDAYS)
_NYSE_HOLIDAY_WARNED = False
MAX_REBUILDS = 200
MAX_THIN_REBUILDS = 20
# Stop the run early when the vendor is unreachable instead of retrying every store.
BREAKER_CONSECUTIVE = 25
BREAKER_MIN_SAMPLE = 200
BREAKER_FRACTION = 0.5
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
EXIT_BREAKER_TRIPPED = 3
EXIT_STALE_VENDOR = 4
EXIT_USAGE = 64


class TransportExhausted(RuntimeError):
    """Every retry of one request failed in transport (timeout, 429, 5xx, connection error)."""


class EmptyOverlap(RuntimeError):
    """A refresh window that contains the store's own last bar came back with no bars."""


class AdjustmentMismatch(RuntimeError):
    """The vendor's bars and the store disagree on price basis and the store was not rebuilt."""


def is_nyse_holiday(day: dt.date) -> bool:
    """True when ``day`` is a full NYSE closure (fixed 2026–2027 set)."""
    global _NYSE_HOLIDAY_WARNED
    if day > _NYSE_HOLIDAY_CALENDAR_END:
        if not _NYSE_HOLIDAY_WARNED:
            print(
                "WARNING: NYSE holiday calendar ends 2027-12-31 — extend _NYSE_HOLIDAYS",
                flush=True,
            )
            _NYSE_HOLIDAY_WARNED = True
        return False
    return day in _NYSE_HOLIDAYS


def _today_et_for_holiday_check() -> dt.date:
    raw = os.environ.get("INTRADAY_RUN_DATE_ET")
    if raw:
        try:
            return dt.date.fromisoformat(raw)
        except ValueError:
            print(
                f"WARNING: invalid INTRADAY_RUN_DATE_ET={raw!r} — using current ET date",
                flush=True,
            )
    return dt.datetime.now(ET).date()


_INTRO_REDACT_PATTERNS = (
    (re.compile(r"(?i)((?:^|[?&])api[_]?key=)([^&\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(r"(?i)(api[_]?key%3d)([^&\s\"',})]+)"), r"\1REDACTED"),
    (re.compile(
        r"(?i)([\"']?api[_]?key[\"']?\s*(?:[:=]|%3d)\s*)"
        r"(?:\"([^\"]*)\"|'([^']*)'|([^&\s\"',})]+))"
    ), r"\1REDACTED"),
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


def _get(url: str, tries: int = 5, *, capture=None) -> dict:
    last_error: Exception | None = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terminal-intraday/1.0"})
            requested_ns = capture.clock() if capture is not None else None
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = (r.read(capture_owner.MAX_RESPONSE_BYTES + 1)
                       if capture is not None else r.read())
                received_ns = capture.clock() if capture is not None else None
            if capture is not None:
                capture.received(raw, requested_ns, received_ns)
                try:
                    return json.loads(raw)
                except (ValueError, UnicodeError):
                    raise capture_owner.CaptureError("malformed_response") from None
            return json.loads(raw)
        except capture_owner.CaptureError:
            raise
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
    raise TransportExhausted(
        f"Polygon aggregate retries exhausted after {tries} attempts") from last_error


def _disp_epoch(ms: int) -> int:
    """Polygon UTC ms → ET wall-clock reinterpreted as a UTC epoch (the route's display epoch)."""
    et = dt.datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ET)
    return int(dt.datetime(et.year, et.month, et.day, et.hour, et.minute, tzinfo=timezone.utc).timestamp())


def _display_epoch_to_real_utc(disp_epoch: int) -> int:
    """Invert _disp_epoch: display epoch → true UTC instant (for finality / asof guards)."""
    fake = dt.datetime.fromtimestamp(disp_epoch, tz=timezone.utc)
    et_wall = dt.datetime(
        fake.year, fake.month, fake.day, fake.hour, fake.minute, fake.second, tzinfo=ET,
    )
    return int(et_wall.timestamp())


def _validate_aggregate_bar(b: dict, sym: str, tf: str) -> None:
    if not isinstance(b, dict):
        raise RuntimeError(f"malformed aggregate bar for {sym} {tf}: not an object")
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


def _capture_next_url(nxt: str, original_path: str) -> str:
    """Keep cursor pagination within the original aggregate request identity."""
    try:
        parsed = urllib.parse.urlsplit(nxt)
        query = urllib.parse.parse_qs(
            parsed.query, keep_blank_values=True, max_num_fields=64)
        if (parsed.scheme != "https" or parsed.hostname != "api.polygon.io"
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.fragment or parsed.path != original_path):
            raise ValueError
        for field, expected in (("adjusted", "true"), ("sort", "asc"), ("limit", "50000")):
            if any(value != expected for value in query.get(field, [])):
                raise ValueError
    except (TypeError, ValueError):
        raise capture_owner.CaptureError("invalid_response") from None
    # A legitimate cursor URL may omit the invariant parameters or the entire query.
    query_string = (parsed.query + "&" if parsed.query else "") + f"apiKey={POLY}"
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, query_string, ""))


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
    run = _active_run(sym, tf)
    session = run["capture"] if run else None
    capture = None
    if session is not None:
        if tf != "1m" or FINALITY_LAG_S != capture_owner.FINALITY_LAG_S:
            raise capture_owner.CaptureError("capture_requires_unchanged_1m_finality")
        capture = capture_owner.CaptureAttempt(
            sym, {"multiplier": 1, "timespan": "minute", "from_date": frm.isoformat(),
                  "to_date": to.isoformat(), "adjusted": True, "sort": "asc", "limit": 50000},
            int(now * 1_000_000_000), clock=time.time_ns)
    ticker = sym.upper()
    url = (f"https://api.polygon.io/v2/aggs/ticker/{urllib.parse.quote(ticker)}/range/"
           f"{spec['mult']}/{spec['unit']}/{frm}/{to}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLY}")
    original_path = urllib.parse.urlsplit(url).path
    rows: list[list] = []
    pages = 0
    bar_seconds = _tf_seconds(tf)
    finality_cutoff = now - FINALITY_LAG_S
    try:
        while url and pages < 400:
            if capture is not None and pages >= capture_owner.MAX_CAPTURE_PAGES:
                raise capture_owner.CaptureCapacity("capture_pages_capacity")
            d = _get(url, capture=capture) if capture is not None else _get(url)
            if capture is not None and not isinstance(d, dict):
                raise capture_owner.CaptureError("invalid_response")
            status = d.get("status")
            if status not in ("OK", "DELAYED"):
                if capture is not None:
                    raise capture_owner.CaptureError("invalid_response")
                raise RuntimeError(
                    f"invalid aggregate response status={status!r} after {pages} completed page(s)")
            if status == "DELAYED" and stats is not None:
                with _stats_lock:
                    stats["delayed_pages"] = stats.get("delayed_pages", 0) + 1
            results = d.get("results")
            if results is None:
                results = []
            elif not isinstance(results, list):
                if capture is not None:
                    raise capture_owner.CaptureError("invalid_response")
                raise RuntimeError(
                    f"invalid aggregate response: results is {type(results).__name__}, not a list")
            page = None
            if capture is not None:
                if len(capture.data["pages"]) != pages + 1:
                    raise capture_owner.CaptureError("source_failure")
                page = capture.data["pages"][-1]
                page["rows_received"] = len(results)
                if "ticker" in d and d["ticker"] != ticker:
                    # Keep the bounded response receipt INVALID, never its wrong-symbol rows.
                    raise capture_owner.CaptureError("invalid_response")
                page["status"] = status
            for row_index, b in enumerate(results):
                raw = capture_owner.raw_minute(b) if capture is not None else None
                _validate_aggregate_bar(b, sym, tf)
                bar_end = b["t"] / 1000 + bar_seconds
                if bar_end > finality_cutoff:
                    if page is not None:
                        page["forming_skipped"] += 1
                    if stats is not None:
                        with _stats_lock:
                            stats["forming_skipped"] = stats.get("forming_skipped", 0) + 1
                    continue
                if page is not None:
                    page["finalized_rows"] += 1
                    capture.data["observations"].append({
                        "page_index": pages, "row_index": row_index,
                        "event_start_utc_ms": b["t"], "event_end_utc_ms": b["t"] + 60000,
                        "raw": raw})
                vol = b.get("v")
                rows.append([_disp_epoch(b["t"]), b["o"], b["h"], b["l"], b["c"],
                             int(vol or 0)])
            nxt = d.get("next_url")
            if capture is not None:
                if nxt is not None and nxt != "" and not isinstance(nxt, str):
                    raise capture_owner.CaptureError("invalid_response")
                url = _capture_next_url(nxt, original_path) if nxt else None
            else:
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
    except Exception as error:
        if capture is not None:
            if isinstance(error, capture_owner.CaptureCapacity):
                session.blocked = True
            else:
                reason = ("transport_exhausted" if isinstance(error, TransportExhausted) else
                          "http_error" if isinstance(error, urllib.error.HTTPError) else
                          str(error) if isinstance(error, capture_owner.CaptureError)
                          and str(error) in capture_owner.FAILURE_KINDS else "source_failure")
                session.retain(capture, reason)
        raise
    if capture is not None:
        session.retain(capture)
    return out


def write_store(sym: str, tf: str, rows: list[list]) -> int:
    """Atomically replace the same chart file and its source evidence, if enabled."""
    if not capture_owner.valid_symbol(sym) or tf not in TF_SPEC:
        raise capture_owner.CaptureError("invalid_store_identity")
    target = INTRADAY / f"{sym}.{tf}.json"
    with capture_owner.store_lock(target):
        run = _active_run(sym, tf)
        old_doc = run["document"] if run else capture_owner.read_document(target)
        session = run["capture"] if run else None
        if old_doc and "minute_capture" in old_doc and session is None:
            raise capture_owner.CaptureError("capture_context_required")
        if session is not None:
            if session.blocked:
                raise capture_owner.CaptureCapacity("capture_retention_refused")
            if not session.attempts:
                raise capture_owner.CaptureError("capture_observation_required")
        elif len(rows) < MIN_STORE_ROWS:
            return 0
        doc = {"t": sym, "tf": tf, "src": "polygon", "bar_quality": "real_ohlc",
               "asof": rows[-1][0] if rows else None, "bars": rows}
        if session is not None:
            doc["minute_capture"] = session.envelope
        encoded = json.dumps(doc, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > capture_owner.MAX_FILE_BYTES:
            if session is not None:
                session.blocked = True
            raise capture_owner.CaptureCapacity("store_bytes_capacity")
        if session is not None and old_doc == doc:
            return len(rows)
        INTRADAY.mkdir(parents=True, exist_ok=True)
        tmp = INTRADAY / (
            f"{sym}.{tf}.json.tmp.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex[:8]}"
        )
        try:
            with open(tmp, "wb") as f:
                f.write(encoded)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, target)
            if run is not None:
                run["document"] = doc
            try:
                dfd = os.open(str(INTRADAY), os.O_RDONLY)
                try:
                    os.fsync(dfd)
                finally:
                    os.close(dfd)
            except OSError:
                pass
        except Exception:
            if session is not None:
                session.persistence_failed = True
            raise
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
        run = _active_run(sym, tf)
        d = run["document"] if run else capture_owner.read_document(p)
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


def _is_price(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0


def _basis_ratio(old: list[list], new: list[list]) -> tuple[float | None, int, list[float]]:
    """Median new/old close over the bars both carry, how many, and each bar's ratio.

    Returns (None, 0, []) only when no bars are shared. `old` and `new` are ascending.
    """
    if not new:
        return None, 0, []
    first = new[0][0]
    old_close: dict[int, float] = {}
    for r in reversed(old):
        if r[0] < first:
            break
        if _is_price(r[4]):
            old_close[r[0]] = r[4]
    ratios = sorted(r[4] / old_close[r[0]] for r in new
                    if r[0] in old_close and _is_price(r[4]))
    n = len(ratios)
    if n == 0:
        return None, 0, []
    mid = n // 2
    median = ratios[mid] if n % 2 else (ratios[mid - 1] + ratios[mid]) / 2
    return median, n, ratios


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
    """Exit contract: EXIT_OK, EXIT_STORE_FAILURES, EXIT_NO_STORES, EXIT_BREAKER_TRIPPED,
    EXIT_STALE_VENDOR, EXIT_USAGE."""
    def opt(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    capture_minutes = "--capture-minutes" in argv
    try:
        symbol_arg = opt("--symbols")
        symbols = capture_owner.parse_symbols(symbol_arg) if symbol_arg is not None else None
        if symbols is not None and not capture_minutes:
            raise capture_owner.CaptureError("symbols_requires_capture_minutes")
        if capture_minutes and (symbols is None or "--existing-only" in argv
                                or "--top" in argv or "--limit" in argv):
            raise capture_owner.CaptureError("capture_requires_explicit_bounded_cohort")
        tfs = (opt("--tf") or ("1m" if capture_minutes else "1h,5m")).split(",")
        if capture_minutes and tfs != ["1m"]:
            raise capture_owner.CaptureError("capture_requires_true_1m")
    except (ValueError, IndexError):
        print("intraday backfill: invalid --capture-minutes/--symbols arguments", flush=True)
        return EXIT_USAGE
    try:
        top = int(opt("--top") or 500)
        workers = int(opt("--workers") or 8)
        limit = int(opt("--limit") or 0)
    except (ValueError, IndexError):
        print("intraday backfill: invalid numeric arguments", flush=True)
        return EXIT_USAGE
    force = "--force" in argv
    update = "--update" in argv or (capture_minutes and not force)
    existing_only = "--existing-only" in argv
    expect_advance = "--expect-advance" in argv

    if existing_only and (update or force):
        print("intraday backfill: --existing-only cannot be combined with --update or --force",
              flush=True)
        return EXIT_USAGE

    # --existing-only: enumerate only the stores already on disk. Bypasses manifest/top-N;
    # never creates a missing symbol. Not usable with --update (they share the same path).
    if capture_minutes:
        jobs = [(symbol, "1m") for symbol in symbols]
        if not 1 <= workers <= capture_owner.MAX_SYMBOLS:
            print("intraday backfill: invalid capture worker count", flush=True)
            return EXIT_USAGE
        print(f"intraday capture: {len(jobs)} explicit 1m jobs | workers={workers}", flush=True)
    elif existing_only:
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

    today_et = _today_et_for_holiday_check()
    n_jobs = len(jobs)
    if expect_advance and is_nyse_holiday(today_et):
        if existing_only:
            print(
                f"intraday refresh --existing-only: NYSE holiday {today_et} "
                f"({n_jobs} store(s) — no advance expected)",
                flush=True,
            )
        print(
            f"intraday refresh: NYSE holiday {today_et} — no advance expected "
            f"(holiday=1, {n_jobs} store(s))",
            flush=True,
        )
        print(
            f"intraday backfill detail: rebuilt=0 basis_unverified=0 "
            f"transport_failed=0 skipped={n_jobs} not_advanced=0 breaker=clear",
            flush=True,
        )
        print(
            f"intraday backfill complete: 0/{n_jobs} stored "
            f"(unchanged=0 failed=0 retention_dropped=0 forming_skipped=0 delayed_pages=0) "
            f"in 0s",
            flush=True,
        )
        return EXIT_OK

    stats: dict = {"delayed_pages": 0, "forming_skipped": 0}
    failures: list[str] = []
    abort = threading.Event()
    rebuilds_left = [MAX_REBUILDS]
    thin_rebuilds_left = [MAX_THIN_REBUILDS]
    wall_now = time.time()

    def rebuild(s, tf, old, asof, why, thin=False):
        """Replace a store whose basis no longer matches the vendor with a full adjusted fetch."""
        with _stats_lock:
            if not thin:
                if rebuilds_left[0] <= 0:
                    raise AdjustmentMismatch(f"{why}; rebuild budget of {MAX_REBUILDS} is spent")
                rebuilds_left[0] -= 1
        full = fetch_polygon_intraday(s, tf, stats=stats)
        rows = full[-MAX_STORE_ROWS:]
        if not rows or rows[-1][0] < asof:
            raise AdjustmentMismatch(
                f"{why}; full refetch ends at {rows[-1][0] if rows else None}, "
                f"before the store's last bar {asof}")
        min_cover = int(0.9 * min(len(old), MAX_STORE_ROWS))
        if len(rows) < min_cover:
            raise AdjustmentMismatch(
                f"{why}; full refetch covers {len(rows)} of {len(old)} row(s)")
        if len(rows) < MIN_STORE_ROWS and not _active_run(s, tf)["capture"]:
            raise AdjustmentMismatch(f"{why}; full refetch returned {len(rows)} bar(s)")
        dropped = max(0, len(full) - MAX_STORE_ROWS)
        if dropped > 0:
            print(f"  retention: {s}.{tf} dropped {dropped} oldest row(s) "
                  f"(cap {MAX_STORE_ROWS})", flush=True)
        write_store(s, tf, rows)
        shrunk = max(0, len(old) - len(rows))
        print(
            f"  rebuilt: {s}.{tf} {why}; {len(old)} -> {len(rows)} row(s) "
            f"retention_dropped={dropped} shrunk={shrunk}",
            flush=True,
        )
        return s, tf, "rebuilt", dropped

    def refresh(s, tf, old, asof):
        if _display_epoch_to_real_utc(asof) > wall_now:
            raise RuntimeError("StoreAsofInFuture: the store's last bar is later than now")
        frm = _date_of(asof) - dt.timedelta(days=3)
        recent = fetch_polygon_intraday(s, tf, frm=frm, stats=stats)
        if not recent:
            raise EmptyOverlap("refetch of a window holding the store's last bar returned no bars")
        ratio, shared, bar_ratios = _basis_ratio(old, recent)
        if shared == 0:
            raise AdjustmentMismatch("refetch shares no bar with the store")
        if shared >= BASIS_MIN_SHARED and ratio is not None and abs(ratio - 1.0) > BASIS_TOLERANCE:
            return rebuild(s, tf, old, asof, f"price basis moved x{ratio:.4f} over {shared} shared bar(s)")
        if shared < BASIS_MIN_SHARED and ratio is not None:
            gross_rebuild = ratio >= BASIS_GROSS or ratio <= 1.0 / BASIS_GROSS
            if gross_rebuild:
                return rebuild(
                    s, tf, old, asof,
                    f"price basis moved x{ratio:.4f} over {shared} shared bar(s) (thin overlap)")
            agreeing = (
                shared >= THIN_MIN_SHARED
                and all(abs(r - ratio) <= BASIS_TOLERANCE for r in bar_ratios)
                and abs(ratio - 1.0) > BASIS_TOLERANCE
            )
            if agreeing:
                with _stats_lock:
                    if thin_rebuilds_left[0] > 0:
                        thin_rebuilds_left[0] -= 1
                        thin_reserved = True
                    else:
                        thin_reserved = False
                        stats["thin_budget_spent"] = stats.get("thin_budget_spent", 0) + 1
                if thin_reserved:
                    return rebuild(
                        s, tf, old, asof,
                        f"price basis moved x{ratio:.4f} over {shared} shared bar(s) "
                        f"(thin overlap, {shared} agreeing bars)",
                        thin=True,
                    )
        if shared < BASIS_MIN_SHARED:
            with _stats_lock:
                stats["basis_unverified"] = stats.get("basis_unverified", 0) + 1
        merged_full = _merge(old, recent)
        if len(merged_full) < MIN_STORE_ROWS and not _active_run(s, tf)["capture"]:
            raise RuntimeError(f"StoreTooSmall: {len(merged_full)} bar(s) after merge")
        if merged_full == old:
            return s, tf, "unchanged", 0
        dropped = max(0, len(merged_full) - MAX_STORE_ROWS)
        if dropped > 0:
            print(f"  retention: {s}.{tf} dropped {dropped} oldest row(s) "
                  f"(cap {MAX_STORE_ROWS})", flush=True)
        write_store(s, tf, merged_full[-MAX_STORE_ROWS:])
        return s, tf, "written", dropped

    def work_unlocked(job):
        s, tf = job
        if abort.is_set():
            return s, tf, "skipped", 0, None, None
        try:
            if update or existing_only:
                old, asof = load_store(s, tf)
                if asof is not None:
                    ret = refresh(s, tf, old, asof)
                    _, asof_after = load_store(s, tf)
                    return ret[0], ret[1], ret[2], ret[3], asof, asof_after
                run = _active_run(s, tf)
                enabled_empty = (run is not None and run["capture"] is not None
                                 and run["document"] is not None
                                 and run["document"]["bars"] == [])
                if existing_only and not enabled_empty:
                    failures.append(
                        f"{s}.{tf}: StoreUnreadable: existing store has no readable bars"
                    )
                    return s, tf, "failed", 0, None, None
                # A validated enabled empty file needs a full fetch to recover. Preserve
                # legacy --update full backfill and --existing-only no-creation behavior.
            rows = fetch_polygon_intraday(s, tf, stats=stats)
            kind = "written" if write_store(s, tf, rows) else "unchanged"
            return s, tf, kind, 0, None, None
        except TransportExhausted as e:
            failures.append(f"{s}.{tf}: {type(e).__name__}: {_redact(str(e))[:300]}")
            return s, tf, "transport", 0, None, None
        except Exception as e:
            failures.append(f"{s}.{tf}: {type(e).__name__}: {_redact(str(e))[:300]}")
            return s, tf, "failed", 0, None, None

    def work(job):
        s, tf = job
        if abort.is_set():
            return s, tf, "skipped", 0, None, None
        if not capture_owner.valid_symbol(s) or tf not in TF_SPEC:
            failures.append(f"{s}.{tf}: invalid_store_identity")
            return s, tf, "failed", 0, None, None
        target = INTRADAY / f"{s}.{tf}.json"
        previous_run = getattr(_capture_runs, "current", None)
        try:
            with capture_owner.store_lock(target):
                document = capture_owner.read_document(target)
                envelope = document.get("minute_capture") if document else None
                enabled = capture_minutes or (document is not None and "minute_capture" in document)
                if enabled and (tf != "1m" or (document and (
                        document.get("t") != s or document.get("tf") != tf
                        or document.get("src") != "polygon"))):
                    raise capture_owner.CaptureError("capture_identity_invalid")
                if enabled and document and "minute_capture" in document and envelope is None:
                    raise capture_owner.CaptureError("capture_envelope_invalid")
                session = capture_owner.CaptureSession(s, envelope) if enabled else None
                run = {"identity": (s, tf), "document": document, "capture": session}
                _capture_runs.current = run
                result = work_unlocked(job)
                if session is not None and session.attempts:
                    if session.persistence_failed:
                        raise capture_owner.CaptureError("capture_write_failed")
                    if session.blocked:
                        raise capture_owner.CaptureCapacity("capture_retention_refused")
                    # A failed fetch preserves the chart projection while retaining its
                    # sanitized partial/failed attempt; unchanged fetches retain receipts too.
                    current = run["document"]
                    write_store(s, tf, current["bars"] if current else [])
                    print(f"  capture_retention: {s}.{tf} retained "
                          f"captures={len(session.envelope['captures'])} "
                          f"latest_status={session.envelope['captures'][-1]['payload']['status']} "
                          f"prefix_sha256={session.envelope['prefix_sha256']}", flush=True)
                elif session is not None and session.blocked:
                    raise capture_owner.CaptureCapacity("capture_retention_refused")
                return result
        except Exception as error:
            label = "StoreUnreadable" if str(error) == "unreadable_store" else type(error).__name__
            failures.append(f"{s}.{tf}: {label}: {_redact(str(error))[:300]}")
            return s, tf, "failed", 0, None, None
        finally:
            _capture_runs.current = previous_run

    counts = {"written": 0, "unchanged": 0, "rebuilt": 0, "failed": 0, "transport": 0,
              "skipped": 0}
    total_dropped = done = attempted = streak = not_advanced = 0
    tripped = False
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        for f in as_completed(futs):
            done += 1
            if f.cancelled():
                counts["skipped"] += 1
            else:
                s, tf, kind, dropped_local, asof_before, asof_after = f.result()
                counts[kind] += 1
                total_dropped += dropped_local
                if kind in ("unchanged", "written", "rebuilt"):
                    if asof_after is None or asof_before is None or asof_after <= asof_before:
                        not_advanced += 1
                if kind != "skipped":
                    attempted += 1
                    streak = streak + 1 if kind == "transport" else 0
                if not tripped and (
                        streak >= BREAKER_CONSECUTIVE
                        or (attempted >= BREAKER_MIN_SAMPLE
                            and counts["transport"] > BREAKER_FRACTION * attempted)):
                    tripped = True
                    abort.set()
                    for other in futs:
                        other.cancel()
                    print(f"  BREAKER: vendor unreachable ({counts['transport']} of {attempted} "
                          f"store(s) exhausted their retries, {streak} in a row) — "
                          "skipping the rest of this run", flush=True)
            if done % 100 == 0 or done == len(jobs):
                rate = done / max(1e-9, time.time() - t0)
                print(f"  {done}/{len(jobs)} | {counts['written'] + counts['rebuilt']} written "
                      f"{counts['unchanged']} unchanged "
                      f"{counts['failed'] + counts['transport']} failed | {rate:.1f}/s", flush=True)

    for i, text in enumerate(failures[:50]):
        print(f"  FAILED {text}", flush=True)
    if len(failures) > 50:
        print(f"  ... and {len(failures) - 50} more failure(s)", flush=True)

    written = counts["written"] + counts["rebuilt"]
    failed = counts["failed"] + counts["transport"]
    print(
        f"intraday backfill complete: {written}/{len(jobs)} stored "
        f"(unchanged={counts['unchanged']} failed={failed} retention_dropped={total_dropped} "
        f"forming_skipped={stats['forming_skipped']} delayed_pages={stats['delayed_pages']}) "
        f"in {time.time()-t0:.0f}s",
        flush=True,
    )
    finished_ok = counts["unchanged"] + counts["written"] + counts["rebuilt"]
    print(
        f"intraday backfill detail: rebuilt={counts['rebuilt']} "
        f"basis_unverified={stats.get('basis_unverified', 0)} "
        f"transport_failed={counts['transport']} skipped={counts['skipped']} "
        f"not_advanced={not_advanced} "
        f"breaker={'TRIPPED' if tripped else 'clear'}",
        flush=True,
    )
    thin_spent = stats.get("thin_budget_spent", 0)
    if thin_spent > 0:
        print(f"intraday thin rebuild budget spent: {thin_spent}", flush=True)
    if tripped:
        return EXIT_BREAKER_TRIPPED
    if failed:
        return EXIT_STORE_FAILURES
    if (expect_advance and not_advanced >= 1
            and not_advanced == finished_ok):
        print("  STALE: no store advanced on a run that expected new bars", flush=True)
        return EXIT_STALE_VENDOR
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
