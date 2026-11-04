"""Merge the macro-instrument catalog (indices, yields, FX, futures, crypto majors) into the
Terminal's manifest, and write daily OHLC for the Yahoo-sourced ones.

Run AFTER build_universe.py in the nightly refresh: this pass is purely ADDITIVE — it never
removes an existing manifest row and never rewrites an equity row it did not create. That
matters because build_universe.py owns the 8.7k equity universe and a careless rewrite here is
exactly how the 2026-07-11 manifest 8,740 -> 34 incident happened (see terminal-refresh.sh).

    python ingest/build_macro_symbols.py                     # merge catalog + fetch OHLC
    python ingest/build_macro_symbols.py --no-ohlc           # manifest rows only
    python ingest/build_macro_symbols.py --out /tmp/probe    # write elsewhere (dry run)

Sources
    Yahoo spark   quotes for ^indices, =F futures, =X FX, DX-Y.NYB   (DELAYED — see below)
    Yahoo chart   daily OHLC for that set PLUS the mainland-China indices
    (CN indices and crypto take their live QUOTES from Tencent / Coinbase at REQUEST time via
     the Next app — that leg is untouched. But Tencent serves no daily history, so until the
     2026-08-05 fix the four CN index rows were searchable with no chart behind them: the
     Terminal dead-ended on "No data for this symbol" under a live price. Their history now
     comes off the Yahoo chart endpoint, which carries the same codes. Crypto keeps its own
     OHLC lane in refresh_crypto_ohlc.py.)

Honesty note: everything on the Yahoo leg is delayed, not real-time. Index values, CME futures
and the ICE dollar index all need licensed real-time feeds. The manifest row carries no basis
claim; lib/intradaySources.ts marks these quotes DELAYED_15M at request time.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from macro_catalog import (  # noqa: E402
    CATALOG, duplicates, manifest_rows, ohlc_symbols, retired_symbols, yahoo_symbols,
)
from cn_index_tushare import (  # noqa: E402
    CN_INDEX_SYMBOLS, TU_SOURCE, fetch_cn_index_history, retain_prior_tushare_bars,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "terminal" / "public" / "data"

UA = {"User-Agent": "Mozilla/5.0"}
SPARK = "https://query1.finance.yahoo.com/v7/finance/spark"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart"
# Yahoo's spark endpoint 400s past ~20 symbols and returns ZERO results rather than a partial
# answer, so an oversized batch silently loses everything. Confirmed at 23; stay well under.
SPARK_BATCH = 18
# Minimum daily bars for a macro series to be worth publishing. Every instrument in the catalog
# is decades old, so anything thinner is Yahoo failing to serve history, not a young symbol.
MIN_OHLC_BARS = 30
# This benchmark underpins multi-decade Shanghai Composite charts. Yahoo's daily series
# begins around 1997, but range=max silently returns 1mo bars even with interval=1d.
# Owner staging verified 7107 non-null daily candles from 7279 timestamps
# (1997-07-02 to 2026-11-04); other symbols remain on the cheaper rolling 5y leg.
FULL_HISTORY_SYMBOLS = frozenset({"000001.SS"})
FULL_HISTORY_START_TS = int(dt.datetime(1990, 1, 1, tzinfo=dt.timezone.utc).timestamp())
# A 353-point monthly series must never be published as three decades of daily candles.
MIN_DEEP_DAILY_BARS = 1000


def ohlc_history_query(sym: str, now_ts: int | None = None) -> str:
    """Yahoo chart query: explicit daily bounds avoid range=max auto-downsampling."""
    if sym in FULL_HISTORY_SYMBOLS:
        # period2 is exclusive. Include the current session even during UTC/CN date rollover.
        end = (int(time.time()) if now_ts is None else now_ts) + 86400
        return f"period1={FULL_HISTORY_START_TS}&period2={end}&interval=1d"
    return "range=5y&interval=1d"



def _get(url: str, timeout: int = 20) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_quotes(syms: list[str]) -> dict[str, dict]:
    """Last price + previous close for each symbol. Missing symbols are simply absent."""
    out: dict[str, dict] = {}
    for i in range(0, len(syms), SPARK_BATCH):
        batch = syms[i : i + SPARK_BATCH]
        url = f"{SPARK}?symbols={urllib.parse.quote(','.join(batch))}&range=1d&interval=5m"
        try:
            j = _get(url)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            print(f"  spark batch {i // SPARK_BATCH} failed: {e}", file=sys.stderr)
            continue
        for row in (j.get("spark") or {}).get("result") or []:
            meta = ((row.get("response") or [{}])[0] or {}).get("meta") or {}
            last = meta.get("regularMarketPrice")
            sym = row.get("symbol") or meta.get("symbol")
            if not sym or last is None:
                continue
            prev = meta.get("previousClose") or meta.get("chartPreviousClose")
            chg = ((last - prev) / prev * 100) if prev else None
            out[sym] = {"last": round(float(last), 6), "chg": round(chg, 4) if chg is not None else None}
        time.sleep(0.3)   # be a polite client; this runs once a night
    return out


def publish_decision(fetched: int, have: int) -> str:
    """What to do with a fetched macro series: "write" | "keep" | "drop".

    A truncated Yahoo response must never BECOME the chart. It arrives two ways: a code Yahoo
    quotes but has no history for (000905.SS / 399006.SZ answer with exactly one bar), and a
    transient hiccup on a symbol that was fine yesterday — which would otherwise overwrite a
    good 5y series with a stub. So a fetch has to clear the floor AND not be a fraction of what
    is already published; the 5y window drifts a bar a day, so the disk comparison is "less than
    half", never an exact count, or normal daily updates would freeze.

    "drop" removes a stub that is ALREADY on disk (USDCNH=X shipped as a single 2026-08-05 bar —
    one candle presented as a chart). Only ever a file that is itself under the floor: a series
    with real depth is never deleted, whatever the fetch returned.
    """
    if fetched >= MIN_OHLC_BARS and (not have or fetched * 2 >= have):
        return "write"
    return "drop" if 0 < have < MIN_OHLC_BARS else "keep"


def _valid_deep_bar(row: object) -> bool:
    """Qualify a stored or provider Shanghai candle before counting or retaining it."""
    if not isinstance(row, list) or len(row) != 6 or not isinstance(row[0], str):
        return False
    try:
        if dt.date.fromisoformat(row[0]).isoformat() != row[0]:
            return False
    except ValueError:
        return False
    values = row[1:]
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in values):
        return False
    try:
        if not all(math.isfinite(value) for value in values):
            return False
    except OverflowError:
        return False
    opening, high, low, close, volume = values
    return 0 < low <= min(opening, close) <= max(opening, close) <= high and volume >= 0


def existing_bar_count(path: Path, *, deep_history: bool = False) -> int:
    """Published depth, counting only qualified unique dates for the deep-history index."""
    try:
        bars = json.loads(path.read_text()).get("bars") or []
        if deep_history:
            return len({row[0] for row in bars if _valid_deep_bar(row)}) if isinstance(bars, list) else 0
        return len(bars)
    except (OSError, json.JSONDecodeError, AttributeError):
        return 0


def fetch_ohlc(sym: str) -> list[list]:
    """Daily OHLC in the same shape chart.js already reads for equities."""
    url = f"{CHART}/{urllib.parse.quote(sym)}?{ohlc_history_query(sym)}"
    try:
        j = _get(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"  ohlc {sym} failed: {e}", file=sys.stderr)
        return []
    res = ((j.get("chart") or {}).get("result") or [{}])[0]
    ts = res.get("timestamp") or []
    deep_history = sym in FULL_HISTORY_SYMBOLS
    if deep_history:
        granularity = (res.get("meta") or {}).get("dataGranularity")
        if granularity != "1d" or (ts and len(ts) < MIN_DEEP_DAILY_BARS):
            print(
                f"  ohlc {sym}: refusing non-daily/truncated history "
                f"(granularity={granularity}, bars={len(ts)})",
                file=sys.stderr,
            )
            return []
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    o, h, l, c, v = (q.get(k) or [] for k in ("open", "high", "low", "close", "volume"))
    # POSITIONAL rows [date, o, h, l, c, v] — the house OHLC contract (AAPL.json et al).
    # Every consumer indexes positionally (ChartPanel b[0..5], gen_slices_all b[4],
    # hydrate_prices last[4]); the dict-bar shape this function originally wrote rendered
    # no daily chart at all for macro symbols and KeyError'd the hydrate pass (found 2026-07-27).
    bars: list[list] = []
    for i, t in enumerate(ts):
        if deep_history:
            # Missing or malformed prices must not become synthetic real-OHLC candles.
            if isinstance(t, bool) or not isinstance(t, (int, float)):
                continue
            try:
                day = time.strftime("%Y-%m-%d", time.gmtime(t))
            except (OSError, OverflowError, ValueError):
                continue
            row = [day] + [
                values[i] if isinstance(values, list) and i < len(values) else None
                for values in (o, h, l, c, v)
            ]
            if not _valid_deep_bar(row):
                continue
            row = [day, *(round(float(value), 6) for value in row[1:5]), int(row[5])]
            if _valid_deep_bar(row):
                bars.append(row)
            continue
        # A null close means the session did not print — skip rather than forward-fill, so a
        # holiday never appears as a real flat bar.
        if i >= len(c) or c[i] is None:
            continue
        day = time.strftime("%Y-%m-%d", time.gmtime(t))
        cv = round(float(c[i]), 6)
        bars.append([
            day,
            round(float(o[i]), 6) if i < len(o) and o[i] is not None else cv,
            round(float(h[i]), 6) if i < len(h) and h[i] is not None else cv,
            round(float(l[i]), 6) if i < len(l) and l[i] is not None else cv,
            cv,
            int(v[i]) if i < len(v) and v[i] is not None else 0,
        ])
    if deep_history:
        by_day = {row[0]: row for row in bars}
        if len(by_day) < MIN_DEEP_DAILY_BARS:
            print(
                f"  ohlc {sym}: refusing non-daily/truncated history "
                f"(valid_daily_bars={len(by_day)})",
                file=sys.stderr,
            )
            return []
        return [by_day[day] for day in sorted(by_day)]
    return bars


def merge_deep_history(sym: str, path: Path, fetched: list[list]) -> list[list]:
    """Keep older published bars when Yahoo's bounded daily response loses depth.

    The nightly request can refresh/repair overlapping days, but must not erase
    decades already backfilled. This is index-specific: other macro assets retain
    the established rolling 5y replacement and publish-decision safeguards.
    """
    if sym not in FULL_HISTORY_SYMBOLS or len(fetched) < MIN_OHLC_BARS:
        return fetched
    try:
        stored = json.loads(path.read_text()).get("bars")
    except (OSError, json.JSONDecodeError, AttributeError):
        return fetched
    if not isinstance(stored, list) or len(stored) < MIN_OHLC_BARS:
        return fetched

    by_day = {
        row[0]: row for row in stored
        if _valid_deep_bar(row)
    }
    if len(by_day) < MIN_OHLC_BARS:
        return fetched
    # Latest provider values win on overlap; earlier published dates stay available.
    by_day.update((row[0], row) for row in fetched if _valid_deep_bar(row))
    return [by_day[day] for day in sorted(by_day)]


def write_atomic(path: Path, payload: dict) -> None:
    """tmp + os.replace inside the destination dir — identical to fetch_fred_daily.write_atomic.

    The manifest write below is a FULL rewrite of the whole staging universe (8.7k equity rows
    plus ours). A bare write_text truncates the file first, so a crash, a kill, or a full disk
    mid-write leaves a half-written manifest where a complete one used to be — the same class of
    failure as the 2026-07-11 "8,740 -> 34" incident, only irrecoverable. os.replace is atomic on
    POSIX: a concurrent reader sees either the previous manifest or the new one, never a prefix.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".macro.tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        # mkstemp creates 0600; this file is SERVED out of terminal/public/data, so it must be
        # world-readable like every other writer's output or the web server 403s on it.
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DATA), help="output data dir (default terminal/public/data)")
    ap.add_argument("--no-ohlc", action="store_true", help="manifest rows only, skip OHLC fetch")
    ap.add_argument("--no-quotes", action="store_true", help="skip the live-quote enrichment")
    args = ap.parse_args()

    dupes = duplicates()
    if dupes:
        print(f"FATAL: duplicate symbols in catalog: {dupes}", file=sys.stderr)
        return 2

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    # Honor the nightly's staging manifest ($TERMINAL_MANIFEST). Writing to the live
    # manifest mid-run is exactly how these rows died every night: terminal-data builds
    # the universe into a STAGING file and atomically swaps it over live at the very end,
    # discarding anything merged into live in between (found 2026-07-27; fetch_fred_daily
    # got this right from day one — keep the two resolutions identical).
    env_manifest = os.environ.get("TERMINAL_MANIFEST")
    mpath = Path(env_manifest) if env_manifest else out_dir / "manifest.json"

    if mpath.exists():
        manifest = json.loads(mpath.read_text())
    else:
        manifest = {"as_of": time.strftime("%Y-%m-%d"), "source": "macro-catalog", "symbols": {}}
    symbols = manifest.setdefault("symbols", {})
    before = len(symbols)

    rows = manifest_rows()
    if not args.no_quotes:
        quotes = fetch_quotes(yahoo_symbols())
        print(f"quotes: {len(quotes)}/{len(yahoo_symbols())} symbols priced")
        for sym, q in quotes.items():
            if sym in rows:
                rows[sym].update(q)

    # ADDITIVE merge. An existing row wins on every key it already has: build_universe.py owns
    # the equity universe and its prices are fresher than ours for anything we overlap on.
    added, updated = 0, 0
    for sym, row in rows.items():
        if sym in symbols:
            merged = {**row, **symbols[sym]}
            if merged != symbols[sym]:
                symbols[sym] = merged
                updated += 1
        else:
            symbols[sym] = row
            added += 1

    # The one exception to "purely additive": rows this catalog itself retired (macro_catalog
    # RETIRED — currently the delisted MATIC-USD). Without this, dropping a symbol from the
    # catalog leaves it in the manifest forever as a dead search row that can never price or
    # chart. Only exact names from that explicit list, and only ones no longer in the catalog.
    removed = [s for s in retired_symbols() if symbols.pop(s, None) is not None]
    if removed:
        print(f"retired: removed {len(removed)} row(s) {removed}")

    write_atomic(mpath, manifest)
    print(f"manifest: {before} -> {len(symbols)} symbols "
          f"(+{added} new, {updated} enriched, -{len(removed)} retired)")

    if not args.no_ohlc:
        wrote, thin, dropped = 0, [], []
        targets = ohlc_symbols()
        for sym in targets:
            china_index = sym in CN_INDEX_SYMBOLS
            if china_index:
                # The exact native index levels are available through the Macro-owned
                # licensed TuShare client. Yahoo returns a one-candle stub for these codes.
                # A missing/denied/invalid TuShare response must NEVER delete an old file.
                bars = fetch_cn_index_history(sym)
                if not bars:
                    print(f"  ohlc {sym}: TuShare history unavailable; keeping prior file",
                          file=sys.stderr)
                    continue
            else:
                bars = fetch_ohlc(sym)
            path = out_dir / f"{sym}.json"
            have = existing_bar_count(
                path, deep_history=sym in FULL_HISTORY_SYMBOLS or china_index,
            )
            bars = (
                retain_prior_tushare_bars(path, bars, is_valid_bar=_valid_deep_bar)
                if china_index else merge_deep_history(sym, path, bars)
            )
            decision = publish_decision(len(bars), have)
            if decision == "write":
                payload = {
                    "t": sym, "o": 1,
                    "src": TU_SOURCE if china_index else "yahoo",
                    "bar_quality": "real_ohlc", "bars": bars,
                }
                if china_index:
                    # TuShare index_daily vol is index-constituent lots (100 shares),
                    # not entire-exchange market volume. Preserve the basis on disk.
                    payload.update({
                        "source_endpoint": "index_daily",
                        "volume_unit": "shares",
                        "volume_scope": "index_constituents",
                    })
                if sym in FULL_HISTORY_SYMBOLS or china_index:
                    # A multi-decade payload is never exposed half-written to the chart.
                    write_atomic(path, payload)
                    print(f"  ohlc {sym}: {len(bars)} bars ({bars[0][0]} to {bars[-1][0]})")
                else:
                    path.write_text(json.dumps(payload, separators=(",", ":")))
                wrote += 1
            else:
                if decision == "drop":
                    try:
                        path.unlink()
                        dropped.append(f"{sym}({have}b)")
                    except OSError as e:
                        print(f"  ohlc {sym}: stub unlink failed: {e}", file=sys.stderr)
                if bars:
                    thin.append(f"{sym}({len(bars)}b, disk {have})")
            time.sleep(0.25)
        print(f"ohlc: wrote {wrote}/{len(targets)} series")
        if thin:
            print(f"ohlc: too thin to publish — {', '.join(thin)}", file=sys.stderr)
        if dropped:
            print(f"ohlc: removed stub series (chart now reads as no-data) — {', '.join(dropped)}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
