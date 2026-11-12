"""Collect raw US/ADR fundamentals from yfinance into a per-symbol cache the fund emitter
(gen_fund_us.py) reads. Companion to collect_cn_deep.py / collect_hk_deep.py — same house style
(macro venv, resumable, threaded, jittered, Ctrl-C-safe, --only/--limit flags).

Universe = the live Terminal manifest US/ADR symbols: pulled once from
https://app.mastermind-x.com/data/manifest.json (cached to data/us_fund/_manifest.json) and filtered
to US-home markets (mkt in NYSE/NASDAQ/AMEX/US/Cboe) — i.e. everything that is NOT .SS/.SZ/.HK/.TO/-USD.

Per symbol we dump the RAW yfinance payload (no interpretation — that's gen_fund_us.py's job) to
    <Macro Dashboard>/data/us_fund/<SYM>.json
DataFrames are serialized as {columns, index, data} records with ISO dates so the emitter can rebuild
them without pandas quirks; Series (dividends/splits) as {index, values}; dicts/scalars verbatim.

Every per-field fetch is wrapped so one broken endpoint (e.g. NIO's missing quarterly cashflow) never
loses the whole symbol — the field lands as null and we log it. Resumable via --stale-days: a cache
file newer than N days is skipped. Threaded (≤4, yfinance-etiquette) with ~1s jitter per symbol.

Run with the macro venv:
    "<Macro Dashboard>/.venv/bin/python" ingest/collect_us_fund.py \
        [--only AAPL,ZS,NVDA] [--limit N] [--stale-days 3] [--workers 4] [--force] \
        [--foreign | --canada] [--deadline-seconds N]

--foreign swaps the universe to the manifest's .TO/intl names (Yahoo-native suffixes, ~1.2k) —
same fetch set and the same gen_fund_us.py emitter apply unchanged (it already separates
quote_currency from stmt_currency, so CAD/JPY/INR/... names come out honest).

--canada is the NARROWER, scheduled scope: only the Canadian .TO equity listings (216 in the
2026-10-21 manifest), no other foreign market. The default nightly passes no scope at all, so
before this flag the .TO names were never collected and every Canadian fund.json froze on its
last good fetch. --foreign still works and still means "every non-US market"; --canada exists so
the nightly can refresh Canada gently (workers=1) without pulling ~1.2k intl names every night.
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
import datetime as dt
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

MACRO = Path(os.environ.get("MACRO_ROOT", "/Users/chriswong/Documents/Cluade/Macro Dashboard"))
OUT = MACRO / "data" / "us_fund"
MANIFEST_URL = "https://app.mastermind-x.com/data/manifest.json"
MANIFEST_CACHE = OUT / "_manifest.json"
TX_INDEX = OUT / "_tx_index.json"

# US-home exchange labels in the manifest's `mkt` field (everything else is a foreign/crypto market)
US_MKTS = {"NYSE", "NASDAQ", "AMEX", "US", "Cboe", "NYSEARCA", "BATS", "OTC"}
NON_US_SUFFIX = (".SS", ".SZ", ".HK", ".TO")

# Canadian scope (--canada).  Every one of the manifest's 216 .TO listings carries mkt="TSX".
CANADA_SUFFIX = ".TO"
CANADA_MKTS = {"TSX", "TSXV", "TSE", "CSE", "NEO", "VENTURE"}
# Yahoo indexes are "^"-prefixed.  ^GSPTSE (S&P/TSX Composite) is filed in the manifest under
# mkt="TSX" — the ONLY TSX symbol that is not a .TO listing — so an mkt-only scope would happily
# collect an index that has no company fundamentals and emit a junk fund.json for it.
INDEX_PREFIX = "^"


# ───────────────────────────── universe ─────────────────────────────
def load_manifest() -> dict:
    """Fetch the live manifest once, cache to disk; fall back to the cache if the fetch fails."""
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(MANIFEST_URL, timeout=60) as r:
            m = json.loads(r.read())
        MANIFEST_CACHE.write_text(json.dumps(m))
        return m
    except Exception as exc:  # noqa: BLE001
        print(f"  manifest fetch failed ({exc}); using cache", flush=True)
        if MANIFEST_CACHE.exists():
            return json.loads(MANIFEST_CACHE.read_text())
        sys.exit("no manifest (fetch failed and no cache)")


def foreign_universe() -> list[str]:
    """--foreign universe: manifest names on non-US exchanges with Yahoo-native suffixes —
    .TO (TSX) plus the intl set (.L/.T/.NS/.KS/.TW/.AX/.PA/.DE/.SW/.MI/.AS/.MC/...). Excludes
    .SS/.SZ/.HK (own Tushare/akshare pipelines) and -USD crypto. Same collector + gen_fund_us
    emitter work unchanged: yfinance serves statements/estimates/analyst for these and the
    emitter already carries quote vs stmt currency separately (ADR handling)."""
    m = load_manifest()
    syms = m.get("symbols") or {}
    return sorted(sym for sym, row in syms.items()
                  if not sym.endswith((".SS", ".SZ", ".HK", "-USD"))
                  and (row or {}).get("mkt") not in US_MKTS)


def _is_index(sym: str) -> bool:
    """Yahoo index/future tickers start with '^'. They have no statements and no fundamentals."""
    return sym.startswith(INDEX_PREFIX)


def canada_universe() -> list[str]:
    """--canada universe: the manifest's Canadian .TO equity listings.

    Selection is by the Yahoo-native .TO listing suffix (the identity the cache filename and the
    emitted fund.json are keyed on), confirmed by a Canadian exchange label when the manifest row
    carries one, with ^-prefixed indexes excluded. A row with no `mkt` at all is kept: the .TO
    suffix already identifies it as a TSX listing, and dropping it would freeze a real name.

    This deliberately does NOT touch foreign_universe(): --foreign still means every non-US
    market, so a scheduled Canada pass never drags in ~1.2k intl names.
    """
    m = load_manifest()
    syms = m.get("symbols") or {}
    out = set()
    for sym, row in syms.items():
        if _is_index(sym) or not sym.endswith(CANADA_SUFFIX):
            continue
        mkt = (row or {}).get("mkt")
        if mkt is not None and mkt not in CANADA_MKTS:
            continue
        out.add(sym)
    return sorted(out)


def us_universe() -> list[str]:
    m = load_manifest()
    syms = m.get("symbols") or {}
    out = set()
    for sym, row in syms.items():
        if sym.endswith(NON_US_SUFFIX) or sym.endswith("-USD"):
            continue
        mkt = (row or {}).get("mkt")
        if mkt in US_MKTS:
            out.add(sym)
    # Union in transcript-indexed names: collect_transcripts.py filters the manifest by suffix only
    # (no mkt whitelist) and reads the LOCAL repo manifest, so its index can carry names this filter
    # would drop — and a transcript with no fund.json is unreachable in the UI (2026-07 audit: 248
    # such orphans after a rate-limited bulk run left them permanently cacheless).
    if TX_INDEX.exists():
        try:
            tx = json.loads(TX_INDEX.read_text())
            out.update(s for s in tx if not (s.endswith(NON_US_SUFFIX) or s.endswith("-USD")))
        except Exception as exc:  # noqa: BLE001
            print(f"  tx-index read failed ({exc}); universe from manifest only", flush=True)
    return sorted(out)


def top_n_by_dollar_vol(n: int) -> list[str]:
    """Return the top-N US manifest symbols ranked by dollar volume (last × vol).

    Used by --top-n to prioritise the most liquid names for fund/intel coverage
    extension.  Symbols not in the manifest or with missing price/vol are ranked
    last (dollar_vol = 0).  The sort is stable, so alphabetic order breaks ties.
    """
    m = load_manifest()
    syms = m.get("symbols") or {}
    ranked = []
    for sym, row in syms.items():
        if sym.endswith(NON_US_SUFFIX) or sym.endswith("-USD"):
            continue
        if not isinstance(row, dict):
            continue
        mkt = row.get("mkt")
        if mkt not in US_MKTS:
            continue
        last = row.get("last") or 0
        vol = row.get("vol") or 0
        dollar_vol = (last or 0) * (vol or 0)
        ranked.append((sym, dollar_vol))
    ranked.sort(key=lambda x: x[1], reverse=True)
    return [s for s, _ in ranked[:n]]


# ───────────────────────────── serialization helpers ─────────────────────────────
def _iso(v):
    """Timestamp/date → ISO date string; pass everything else through."""
    if isinstance(v, (pd.Timestamp, dt.datetime, dt.date)):
        try:
            return pd.Timestamp(v).strftime("%Y-%m-%d")
        except Exception:
            return str(v)
    return v


def _clean(v):
    """NaN/NaT → None; numpy scalar → python; Timestamp → ISO; leave the rest."""
    if v is None:
        return None
    if isinstance(v, (pd.Timestamp, dt.datetime, dt.date)):
        return _iso(v)
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item"):          # numpy scalar
        try:
            return v.item()
        except Exception:
            pass
    return v


def df_to_records(df) -> dict | None:
    """DataFrame → {columns:[ISO], index:[str], data:[[...]]}. Statement frames have datetime columns
    (period-ends) and string index (line items); we ISO-ify both axes and NaN→null the cells."""
    if not isinstance(df, pd.DataFrame) or df.empty:
        return None
    cols = [str(_iso(c)) for c in df.columns]
    index = [str(_iso(i)) for i in df.index]
    data = [[_clean(x) for x in row] for row in df.values.tolist()]
    return {"columns": cols, "index": index, "data": data}


def series_to_obj(s) -> dict | None:
    """Series → {index:[ISO], values:[float]} (dividends/splits keyed by ex-date)."""
    if not isinstance(s, pd.Series) or s.empty:
        return None
    return {"index": [str(_iso(i)) for i in s.index], "values": [_clean(v) for v in s.values.tolist()]}


def dict_clean(d) -> dict | None:
    """calendar / analyst_price_targets / info dicts → JSON-safe, dates ISO-ified."""
    if not isinstance(d, dict) or not d:
        return None
    out = {}
    for k, v in d.items():
        if isinstance(v, list):
            out[str(k)] = [_clean(x) for x in v]
        else:
            out[str(k)] = _clean(v)
    return out


# ───────────────────────────── per-symbol fetch ─────────────────────────────
# field name -> (yfinance attr, serializer). Each is fetched independently and null on failure.
DF_FIELDS = {
    "income_stmt": "income_stmt",
    "quarterly_income_stmt": "quarterly_income_stmt",
    "balance_sheet": "balance_sheet",
    "quarterly_balance_sheet": "quarterly_balance_sheet",
    "cashflow": "cashflow",
    "quarterly_cashflow": "quarterly_cashflow",
    "earnings_dates": "earnings_dates",
    "earnings_estimate": "earnings_estimate",
    "revenue_estimate": "revenue_estimate",
    "eps_trend": "eps_trend",
    "recommendations_summary": "recommendations_summary",
    "institutional_holders": "institutional_holders",
    "major_holders": "major_holders",
}
SERIES_FIELDS = {"dividends": "dividends", "splits": "splits"}
DICT_FIELDS = {"calendar": "calendar", "analyst_price_targets": "analyst_price_targets"}


def _grab(errs: list, name: str, fn):
    """Run one field fetch; on any exception log to errs and return None (never lose the symbol)."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        errs.append(f"{name}:{type(exc).__name__}")
        return None


# INFO_KEYS: only the fields gen_fund_us.py consumes — keeps the cache small (info is ~180 keys).
INFO_KEYS = (
    "financialCurrency", "currency", "quoteType", "longName", "shortName",
    "marketCap", "sharesOutstanding", "floatShares", "impliedSharesOutstanding",
    "heldPercentInstitutions", "heldPercentInsiders", "beta",
    "fullTimeEmployees", "website", "sector", "industry", "longBusinessSummary",
    "country", "city", "state", "address1", "phone",
    "trailingPE", "forwardPE", "priceToBook", "priceToSalesTrailing12Months",
    "enterpriseValue", "enterpriseToEbitda", "enterpriseToRevenue", "trailingPegRatio",
    "dividendYield", "dividendRate", "payoutRatio", "lastDividendValue", "lastDividendDate",
    "exDividendDate", "grossMargins", "profitMargins", "operatingMargins",
    "returnOnEquity", "returnOnAssets", "debtToEquity", "currentRatio", "quickRatio",
    "totalRevenue", "ebitda", "freeCashflow", "operatingCashflow",
    "targetMeanPrice", "targetHighPrice", "targetLowPrice", "targetMedianPrice",
    "numberOfAnalystOpinions", "recommendationKey", "recommendationMean", "averageAnalystRating",
    "earningsTimestamp", "mostRecentQuarter", "lastFiscalYearEnd", "nextFiscalYearEnd",
    "currentPrice", "regularMarketPrice", "previousClose",
)


def fetch_one(sym: str) -> dict | None:
    """Full raw payload for one symbol, robust to any per-field exception."""
    import yfinance as yf  # local import so a missing dep fails only inside the worker
    t = yf.Ticker(sym)
    errs: list[str] = []

    info_raw = _grab(errs, "info", lambda: t.info) or {}
    info = {k: _clean(info_raw.get(k)) for k in INFO_KEYS if k in info_raw}

    payload: dict = {
        "ticker": sym,
        "fetched_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "info": info,
    }
    for key, attr in DF_FIELDS.items():
        payload[key] = _grab(errs, key, lambda a=attr: df_to_records(getattr(t, a)))
    for key, attr in SERIES_FIELDS.items():
        payload[key] = _grab(errs, key, lambda a=attr: series_to_obj(getattr(t, a)))
    for key, attr in DICT_FIELDS.items():
        payload[key] = _grab(errs, key, lambda a=attr: dict_clean(getattr(t, a)))

    payload["_errors"] = errs
    # A symbol with nothing but errors and no info is a dead fetch — signal skip so we don't cache junk.
    got_any = bool(info) or any(payload.get(k) for k in list(DF_FIELDS) + list(SERIES_FIELDS) + list(DICT_FIELDS))
    if not got_any:
        return None
    return payload


# ───────────────────────────── driver ─────────────────────────────
def atomic_write(dest: Path, text: str) -> None:
    """Write via tmp+rename so a Ctrl-C mid-write never leaves a truncated cache file that would
    pass the freshness check and get skipped on the next run."""
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, dest)


def is_fresh(path: Path, stale_days: int) -> bool:
    if stale_days <= 0 or not path.exists():
        return False
    cache = read_cache(path)
    try:
        stamp = dt.datetime.fromisoformat(str(cache.get("fetched_at", "")).replace("Z", "+00:00"))
        if stamp.tzinfo is None or cache.get("_errors"):
            return False
        age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
        return 0 <= age < stale_days * 86400
    except (AttributeError, TypeError, ValueError):
        return False


# A cache holding at least this many populated data fields is worth protecting; below it a
# downgrade is not a data-loss event and blocking the write would just freeze the symbol.
RICH_CACHE_FLOOR = 5


def cache_richness(payload: object) -> int:
    """How many populated data fields a cache payload carries.

    A partial fetch (rate limit, an endpoint erroring) still returns `info` or one frame, and the
    driver used to write it straight over a good cache — silently replacing years of statements
    with an info shell while still bumping the file mtime, so the next run skipped it as fresh.
    Comparing populated-field counts catches that without needing a per-symbol schema.
    """
    if not isinstance(payload, dict):
        return -1
    n = 1 if payload.get("info") else 0
    for key in list(DF_FIELDS) + list(SERIES_FIELDS) + list(DICT_FIELDS):
        if payload.get(key):
            n += 1
    return n


def read_cache(path: Path) -> dict | None:
    """Existing cache payload, or None when absent/unreadable (a corrupt file must not block a
    good new fetch — it is replaced either way)."""
    try:
        return json.loads(path.read_text())
    except Exception:  # noqa: BLE001
        return None


def main(argv: list[str]) -> None:
    only = None
    limit = 0
    top_n = 0   # --top-n N: collect top-N by dollar-vol; takes priority over alphabetic universe
    stale_days = 3
    workers = 4
    force = "--force" in argv
    deadline = None
    jitter_lo = 0.4
    jitter_hi = 1.4
    if "--only" in argv:
        only = [s.strip().upper() for s in argv[argv.index("--only") + 1].split(",") if s.strip()]
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])
    if "--top-n" in argv:
        # e.g. --top-n 2000: collect/refresh up to N symbols ranked by manifest dollar-vol.
        # Bounds cron runtime predictably: at ~1.2s/symbol × workers=4 a --top-n 2000 run
        # takes ~10 min wall-clock; --top-n 500 ~2.5 min.  The gen step (gen_fund_us.py)
        # adds ~0.5s/symbol and processes exactly the symbols with a cache file, so it
        # naturally matches whatever --top-n collected.
        top_n = int(argv[argv.index("--top-n") + 1])
    if "--stale-days" in argv:
        stale_days = int(argv[argv.index("--stale-days") + 1])
    if "--deadline-seconds" in argv:
        # Soft scheduling deadline; run_bounded.py supplies the scheduled hard process bound.
        # Stopping early is safe: the pass is incremental and resumable, and an unreached symbol
        # keeps its old cache mtime, so the next night retries it instead of skipping it fresh.
        deadline = time.time() + float(argv[argv.index("--deadline-seconds") + 1])
    if "--workers" in argv:
        workers = max(1, min(4, int(argv[argv.index("--workers") + 1])))
    if "--delay" in argv:
        # Override jitter range: --delay MIN MAX  (e.g. --delay 2.0 5.0)
        # Used for second-pass recovery runs to avoid rate-limit storms.
        idx = argv.index("--delay")
        jitter_lo = float(argv[idx + 1])
        jitter_hi = float(argv[idx + 2])
    if force:
        stale_days = 0

    OUT.mkdir(parents=True, exist_ok=True)
    if only:
        want = only
    elif "--canada" in argv:
        want = canada_universe()
        print(f"us_fund: --canada: {len(want)} Canadian .TO manifest symbols "
              f"(^indexes excluded)", flush=True)
    elif "--foreign" in argv:
        want = foreign_universe()
        print(f"us_fund: --foreign: {len(want)} .TO/intl manifest symbols (Yahoo-native)", flush=True)
    elif top_n:
        want = top_n_by_dollar_vol(top_n)
        print(f"us_fund: --top-n {top_n}: selected {len(want)} symbols ranked by manifest dollar-vol", flush=True)
    else:
        want = us_universe()
    if limit:
        want = want[:limit]

    todo = [s for s in want if not is_fresh(OUT / f"{s}.json", stale_days)]
    print(f"us_fund: {len(want)} US/ADR names, {len(todo)} to fetch "
          f"(workers={workers}, stale_days={stale_days}, jitter={jitter_lo:.1f}-{jitter_hi:.1f}s)", flush=True)

    ok = empty = 0
    done = 0
    kept = 0
    stopped = False
    interrupted = False

    def worker(sym: str, _jlo=jitter_lo, _jhi=jitter_hi):
        # This is a soft scheduling deadline. The scheduled caller also uses
        # run_bounded.py to terminate stuck network threads at the hard budget.
        if deadline is not None and time.time() >= deadline:
            return sym, None
        time.sleep(random.uniform(_jlo, _jhi))
        if deadline is not None and time.time() >= deadline:
            return sym, None
        return sym, fetch_one(sym)

    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(worker, s): s for s in todo}
            for fut in as_completed(futs):
                if deadline is not None and time.time() > deadline:
                    stopped = True
                    for pending in futs:
                        pending.cancel()
                    print(f"  deadline reached at {done}/{len(todo)} — "
                          f"{len(todo) - done} deferred to the next run", flush=True)
                    break
                sym = futs[fut]
                done += 1
                try:
                    _, payload = fut.result()
                except Exception as exc:  # noqa: BLE001
                    payload = None
                    print(f"  ERR {sym}: {type(exc).__name__} {exc}", flush=True)
                if payload:
                    dest = OUT / f"{sym}.json"
                    prior = read_cache(dest) if dest.exists() else None
                    prior_rich = cache_richness(prior)
                    new_rich = cache_richness(payload)
                    lost_fields = [key for key in list(DF_FIELDS) + list(SERIES_FIELDS) + list(DICT_FIELDS)
                                   if (prior or {}).get(key) and not payload.get(key)]
                    if lost_fields or (prior_rich >= RICH_CACHE_FLOOR and new_rich < prior_rich):
                        # A thinner fetch must never replace real data — and keeping the old file
                        # also keeps its mtime, so the next run retries instead of skipping it fresh.
                        kept += 1
                        print(f"  {sym}: fetch degraded ({new_rich} fields vs {prior_rich} cached; lost={lost_fields}) "
                              f"— keeping existing cache", flush=True)
                    else:
                        atomic_write(dest, json.dumps(payload, ensure_ascii=False))
                        ok += 1
                        if payload.get("_errors"):
                            print(f"  {sym}: ok (partial — {','.join(payload['_errors'][:4])})", flush=True)
                else:
                    empty += 1
                    print(f"  {sym}: empty (no data)", flush=True)
                if done % 25 == 0 or done == len(todo):
                    print(f"  progress {done}/{len(todo)} — {ok} ok, {empty} empty, {kept} kept", flush=True)
    except KeyboardInterrupt:
        interrupted = True
        print("\ninterrupted — cached symbols are safe, rerun to resume", flush=True)

    print(f"done: {ok} written, {empty} empty, {kept} kept-over-degraded, "
          f"{len(want) - len(todo)} skipped fresh"
          f"{' (INTERRUPTED)' if interrupted else ''}{' (DEADLINE)' if stopped else ''}", flush=True)

    # Universe names that STILL have no cache file are invisible to cache-scanning repair tooling
    # (an empty fetch writes nothing) — report them so a rate-limit storm never hides a gap again.
    if not only and not interrupted:
        gaps = [s for s in want if not (OUT / f"{s}.json").exists()]
        if gaps:
            print(f"  WARNING: {len(gaps)} universe names have no cache file after this run"
                  f"{' (deadline-deferred, not failed)' if stopped else ''}: "
                  f"{' '.join(gaps[:40])}{' …' if len(gaps) > 40 else ''}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
