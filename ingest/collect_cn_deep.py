"""Collect deep A-share data the Macro Dashboard doesn't yet assemble per-stock, into parquets the
CN/HK intel bridge (pull_cn_hk_intel.py) joins. Closes the Phase-2 gaps: full financial statements
for the ~50% of names without an inline fundamentals block, and 龙虎榜/大宗交易/top-holder smart-money.

All endpoints are ENTITLED on the current Tushare token (verified 2026-07-02) — $0. Whole-market _vip
calls make financials cheap (~2 calls/fiscal-year); dragon-tiger/block are whole-market by trade date;
top-holders is per-ticker (thread-pooled, resumable).

Writes into  <Macro Dashboard>/data/tushare/ :
    financials.parquet   one row per ts_code — margins/roe/growth + multiyear revenue/eps/net-margin series
    lhb.parquet          one row per ts_code — 龙虎榜 count + net-amount, 大宗交易 count + amount (last N sessions)
    holders.parquet      one row per ts_code — top float holders [{name, ratio, change, type}]

Run with the macro venv (pandas + the token in <Macro Dashboard>/.env):
    "<Macro Dashboard>/.venv/bin/python" ingest/collect_cn_deep.py [--stages financials,lhb,holders] \
        [--lhb-days 60] [--workers 8] [--limit N] [--years 7]

RELIABILITY CONTRACT (2026-10-21)
──────────────────────────────────
The 2026-10-22 nightly produced a false-green: Tushare rejected the configured token
("invalid token"), every call returned no rows, and the collectors happily overwrote
good financials/holders caches with ZERO-row parquet files while the shell exited 0.
This module is now written so that can never happen again:

  * The token is acquired LAZILY. Importing this module performs no I/O and no provider
    call — which is what lets the test-suite import it without a token or a network.
  * Upstream failures are TYPED. A legitimate empty response (HTTP 200, `code == 0`, no
    items — e.g. a quiet 龙虎榜 session) is data. A rejected token, a missing entitlement,
    a rate-limit that outlived its backoff, or a dead socket is an ERROR. The old code
    collapsed both into `([], [])`, which is exactly how an outage looked like "no data".
  * A stage that hits a hard error writes NOTHING. The last-good parquet survives intact.
    There is no code path that replaces a valid cache with an empty or truncated one.
  * Holders merge per-symbol: a symbol that refreshed updates its own row and every other
    symbol keeps its last-good observation.
  * Writes are atomic (temp file in the same directory + `os.replace`), so a reader never
    observes a half-written parquet.
  * No date is ever fabricated. A holder's `period` is the `end_date` the provider actually
    returned; the build clock is never substituted for a source period.
"""
from __future__ import annotations

import json
import os
import sys
import time
import datetime as dt
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

CA_ROOT = Path(__file__).resolve().parents[1]
MACRO = Path(os.environ.get("MACRO_REPO") or "/Users/chriswong/Documents/Cluade/Macro Dashboard")
OUT = MACRO / "data" / "tushare"
MANIFEST = CA_ROOT / "terminal" / "public" / "data" / "manifest.json"

# Rolling annual horizon. A fiscal year is only complete once the following calendar year
# has begun, so the window ends at the previous calendar year and rolls forward on its own
# (2026 → 2019..2025, 2027 → 2020..2026) instead of silently freezing on a hardcoded range.
DEFAULT_FIN_YEARS = 7


# ─────────────────────────────── typed upstream errors ───────────────────────────────
class UpstreamError(RuntimeError):
    """Base for every failure that is NOT a legitimate empty response."""


class MissingTokenError(UpstreamError):
    """No Tushare token in the environment or the Macro Dashboard .env."""


class UpstreamAuthError(UpstreamError):
    """The provider rejected our credential. Never retry: every later call will fail too."""


class UpstreamPermissionError(UpstreamError):
    """Credential is valid but the endpoint is not entitled. Never retry."""


class UpstreamTransportError(UpstreamError):
    """Socket/timeout/protocol failure. Retried with backoff before being raised."""


class UpstreamRateLimited(UpstreamError):
    """Provider rate limit that outlived its backoff. Retried with backoff before being raised."""


_TOKEN_CACHE: str | None = None


def _token() -> str:
    """Resolve the Tushare token. Called per request, never at import time."""
    global _TOKEN_CACHE
    if _TOKEN_CACHE:
        return _TOKEN_CACHE
    t = (os.environ.get("TUSHARE_TOKEN") or "").strip()
    if not t:
        env = MACRO / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("TUSHARE_TOKEN="):
                    t = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not t:
        raise MissingTokenError(f"no TUSHARE_TOKEN (env or {MACRO}/.env)")
    _TOKEN_CACHE = t
    return t


def _classify(msg: str) -> type[UpstreamError]:
    """Map a Tushare `msg` onto a typed error. Order matters: a rate-limit notice must not
    be mistaken for a credential or entitlement rejection."""
    m = (msg or "").lower()
    if ("频率" in m or "超限" in m or "rate limit" in m or "每分钟" in m
            or "频繁" in m or "繁忙" in m or "稍后重试" in m or "too many requests" in m):
        return UpstreamRateLimited
    if "invalid token" in m or "token" in m:
        return UpstreamAuthError
    if "权限" in m or "积分" in m or "permission" in m or "forbidden" in m:
        return UpstreamPermissionError
    return UpstreamError


def ts_call(api: str, params: dict, fields: str = "", retries: int = 4):
    """Tushare REST → (fields, items).

    Returns `([], [])` ONLY for a legitimate empty result (provider said `code == 0` and
    gave us no rows). Every other outcome raises a typed UpstreamError so the caller can
    tell "the market was quiet" apart from "we could not ask".
    """
    token = _token()
    body = json.dumps({"api_name": api, "token": token, "params": params, "fields": fields}).encode()
    last: UpstreamError | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request("http://api.tushare.pro", data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                r = json.loads(resp.read())
        except Exception as e:                      # socket, timeout, bad JSON — retryable
            last = UpstreamTransportError(f"{api}: {type(e).__name__}")
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.get("code") == 0:
            d = r.get("data") or {}
            return d.get("fields") or [], d.get("items") or []
        msg = str(r.get("msg") or "")
        kind = _classify(msg)
        if kind in (UpstreamAuthError, UpstreamPermissionError):
            raise kind(f"{api}: {kind.__name__}")              # credential/entitlement — do NOT retry
        last = kind(f"{api}: {kind.__name__}")
        time.sleep(2.0 * (attempt + 1))
    raise last or UpstreamError(f"{api}: exhausted retries")


def _f(v):
    try:
        x = float(v)
        return None if x != x else x
    except (TypeError, ValueError):
        return None


# ─────────────────────────────── atomic, lossless writes ───────────────────────────────
def _atomic_write_parquet(df: pd.DataFrame, path: Path) -> None:
    """Publish `df` at `path` atomically. A reader sees either the old file or the new one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Keep the .parquet suffix so the engine can still be inferred from the name.
    tmp = path.with_name(f".{path.stem}.tmp-{os.getpid()}{path.suffix}")
    try:
        df.to_parquet(tmp, engine="pyarrow")
        with open(tmp, "rb") as fh:                  # flush to disk before the rename
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def _read_last_good(path: Path) -> pd.DataFrame | None:
    """The existing cache, or None when there is none / it is unreadable."""
    if not path.exists():
        return None
    try:
        return pd.read_parquet(path)
    except Exception:
        return None


def _guard(fn, artifact: str):
    """Run a stage; on a typed upstream failure leave the cache untouched and report.

    Returns True when the stage published, False when it degraded to last-good.
    """
    try:
        fn()
        return True
    except (UpstreamAuthError, UpstreamPermissionError) as e:
        print(f"  FATAL {artifact}: {e}", flush=True)
        print(f"  {artifact}: keeping last-good cache — credential/entitlement is unusable", flush=True)
        raise
    except UpstreamError as e:
        print(f"  FATAL {artifact}: {e}", flush=True)
        print(f"  {artifact}: keeping last-good cache — refusing to publish a truncated refresh", flush=True)
        return False


CN_SITE = MACRO / "site" / "chinastockdata"


def cn_universe() -> list[str]:
    """CN names we build intel for (site/chinastockdata/*.SS|SZ.json) → Tushare codes (.SS→.SH)."""
    out = []
    for p in CN_SITE.glob("*.json"):
        n = p.name[:-5]
        if n.endswith(".SS"):
            out.append(n[:-3] + ".SH")
        elif n.endswith(".SZ"):
            out.append(n)
    return sorted(set(out))


# ─────────────────────────────── financials (whole-market _vip) ───────────────────────────────
FINA_FIELDS = "ts_code,end_date,eps,roe,netprofit_margin,grossprofit_margin,gross_margin,debt_to_assets,or_yoy,netprofit_yoy"


def fiscal_years(count: int = DEFAULT_FIN_YEARS, today: dt.date | None = None) -> list[int]:
    """Rolling window of the `count` most recent COMPLETE fiscal years."""
    last_complete = (today or dt.date.today()).year - 1
    return list(range(last_complete - count + 1, last_complete + 1))


def collect_financials(years: list[int] | None = None) -> None:
    years = years or fiscal_years()
    # per (ts_code, year) accumulate the annual metrics + revenue
    fina: dict[tuple, dict] = {}
    rev: dict[tuple, float] = {}
    for y in years:
        period = f"{y}1231"
        ff, fitems = ts_call("fina_indicator_vip", {"period": period}, FINA_FIELDS)
        idx = {name: i for i, name in enumerate(ff)}
        for it in fitems:
            code = it[idx["ts_code"]]
            fina[(code, y)] = {
                "eps": _f(it[idx.get("eps", -1)]) if "eps" in idx else None,
                "roe": _f(it[idx["roe"]]) if "roe" in idx else None,
                "net_margin": _f(it[idx["netprofit_margin"]]) if "netprofit_margin" in idx else None,
                "gross_margin": (_f(it[idx["grossprofit_margin"]]) if "grossprofit_margin" in idx and _f(it[idx["grossprofit_margin"]]) is not None
                                 else (_f(it[idx["gross_margin"]]) if "gross_margin" in idx else None)),
                "debt_to_assets": _f(it[idx["debt_to_assets"]]) if "debt_to_assets" in idx else None,
                "or_yoy": _f(it[idx["or_yoy"]]) if "or_yoy" in idx else None,
                "netprofit_yoy": _f(it[idx["netprofit_yoy"]]) if "netprofit_yoy" in idx else None,
            }
        rf, ritems = ts_call("income_vip", {"period": period}, "ts_code,end_date,revenue,total_revenue")
        ridx = {name: i for i, name in enumerate(rf)}
        for it in ritems:
            code = it[ridx["ts_code"]]
            r = _f(it[ridx["revenue"]]) if "revenue" in ridx else None
            if r is None and "total_revenue" in ridx:
                r = _f(it[ridx["total_revenue"]])
            if r is not None:
                rev[(code, y)] = r
        print(f"  financials {y}: fina {len(fitems)} rows, income {len(ritems)} rows", flush=True)
        time.sleep(0.3)

    codes = sorted({c for (c, _) in fina} | {c for (c, _) in rev})
    rows = []
    for code in codes:
        yrs, revenue, eps, nm, gm = [], [], [], [], []
        for y in years:
            fi = fina.get((code, y))
            rv = rev.get((code, y))
            if fi is None and rv is None:
                continue
            yrs.append(y)
            revenue.append(rv)
            eps.append(fi.get("eps") if fi else None)
            nm.append(fi.get("net_margin") if fi else None)
            gm.append(fi.get("gross_margin") if fi else None)
        if not yrs:
            continue
        latest = fina.get((code, yrs[-1])) or {}

        def cagr(series):
            vals = [(i, v) for i, v in enumerate(series) if v is not None and v > 0]
            if len(vals) < 2:
                return None
            (i0, v0), (i1, v1) = vals[0], vals[-1]
            n = i1 - i0
            return round(((v1 / v0) ** (1 / n) - 1) * 100, 1) if n > 0 else None

        rows.append({
            "ts_code": code, "years": yrs, "revenue": revenue, "eps": eps,
            "net_margin_series": nm, "gross_margin_series": gm,
            "roe": latest.get("roe"), "net_margin": latest.get("net_margin"),
            "gross_margin": latest.get("gross_margin"), "debt_to_assets": latest.get("debt_to_assets"),
            "rev_growth": latest.get("or_yoy"), "ni_growth": latest.get("netprofit_yoy"),
            "rev_cagr": cagr(revenue), "eps_cagr": cagr(eps),
        })
    df = pd.DataFrame(rows)
    _atomic_write_parquet(df, OUT / "financials.parquet")
    print(f"financials.parquet: {len(df)} tickers (fiscal years {years[0]}-{years[-1]})", flush=True)


# ─────────────────────────────── 龙虎榜 + 大宗交易 (whole-market by date) ───────────────────────────────
def collect_lhb(days: int) -> None:
    lhb: dict[str, dict] = {}
    today = dt.date.today()
    scanned = 0
    d = today
    # walk back over calendar days; skip weekends; stop after we've seen `days` sessions with data.
    # A session that legitimately has no 龙虎榜 rows is fine (we just don't count it). A session
    # that FAILS raises out of this function, so a partial walk can never be published.
    while scanned < days and (today - d).days < days * 2 + 20:
        if d.weekday() < 5:
            td = d.strftime("%Y%m%d")
            tff, ti = ts_call("top_list", {"trade_date": td})
            bff, bi = ts_call("block_trade", {"trade_date": td})
            if ti or bi:
                scanned += 1
            if ti:
                idx = {n: i for i, n in enumerate(tff)}
                for it in ti:
                    code = it[idx["ts_code"]]
                    rec = lhb.setdefault(code, {"lhb_count": 0, "lhb_net": 0.0, "block_count": 0, "block_amount": 0.0})
                    rec["lhb_count"] += 1
                    na = _f(it[idx["net_amount"]]) if "net_amount" in idx else None
                    if na is not None:
                        rec["lhb_net"] += na
            if bi:
                bidx = {n: i for i, n in enumerate(bff)}
                seen_codes = set()
                for it in bi:
                    code = it[bidx["ts_code"]]
                    rec = lhb.setdefault(code, {"lhb_count": 0, "lhb_net": 0.0, "block_count": 0, "block_amount": 0.0})
                    if code not in seen_codes:
                        rec["block_count"] += 1
                        seen_codes.add(code)
                    am = _f(it[bidx["amount"]]) if "amount" in bidx else None
                    if am is not None:
                        rec["block_amount"] += am
            if scanned % 10 == 0 and (ti or bi):
                print(f"  lhb: {scanned}/{days} sessions, {len(lhb)} tickers", flush=True)
        d -= dt.timedelta(days=1)
    rows = [{"ts_code": c, **v} for c, v in lhb.items()]
    df = pd.DataFrame(rows)
    _atomic_write_parquet(df, OUT / "lhb.parquet")
    print(f"lhb.parquet: {len(df)} tickers (龙虎榜/大宗交易, {scanned} of {days} target sessions)", flush=True)


# ─────────────────────────────── top float holders (per-ticker, threaded) ───────────────────────────────
HOLD_FIELDS = "ts_code,end_date,holder_name,hold_ratio,hold_change,holder_type"


def _one_holders(code: str):
    """→ (code, period, holders, error). `period` is the provider's own latest end_date —
    never the build clock. An empty provider response is a legitimate observation, not an error."""
    try:
        hf, hi = ts_call("top10_floatholders", {"ts_code": code}, HOLD_FIELDS)
    except UpstreamError as e:
        return code, None, None, e
    if not hi:
        return code, None, None, None
    idx = {n: i for i, n in enumerate(hf)}
    # keep only the most recent end_date
    latest = max(it[idx["end_date"]] for it in hi)
    hl = []
    for it in hi:
        if it[idx["end_date"]] != latest:
            continue
        hl.append({
            "name": it[idx["holder_name"]],
            "ratio": _f(it[idx.get("hold_ratio", -1)]) if "hold_ratio" in idx else None,
            "change": _f(it[idx.get("hold_change", -1)]) if "hold_change" in idx else None,
            "type": it[idx.get("holder_type", -1)] if "holder_type" in idx else None,
        })
    hl.sort(key=lambda h: (h["ratio"] is None, -(h["ratio"] or 0)))
    return code, latest, hl[:8], None


def collect_holders(workers: int, limit: int) -> None:
    codes = cn_universe()
    if limit:
        codes = codes[:limit]
    if not codes:
        print("holders: empty universe — nothing to refresh, keeping last-good cache", flush=True)
        return

    # Last-good rows, keyed by ticker: every symbol survives unless it is individually refreshed.
    merged: dict[str, dict] = {}
    existing = _read_last_good(OUT / "holders.parquet")
    if existing is not None and len(existing):
        for _, r in existing.iterrows():
            merged[r["ts_code"]] = {"ts_code": r["ts_code"], "period": r["period"],
                                    "holders_json": r["holders_json"]}
        print(f"  holders: carrying forward {len(merged)} last-good symbol rows", flush=True)

    done = refreshed = failed = 0
    auth_fatal: UpstreamError | None = None
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_one_holders, c) for c in codes]
        for fut in as_completed(futs):
            code, period, hl, err = fut.result()
            done += 1
            if err is not None:
                failed += 1
                if auth_fatal is None and isinstance(err, (UpstreamAuthError, UpstreamPermissionError)):
                    auth_fatal = err
                continue
            if hl:
                refreshed += 1
                # store as a JSON string — robust across parquet engines (avoids list<struct> quirks)
                merged[code] = {"ts_code": code, "period": period,
                                "holders_json": json.dumps(hl, ensure_ascii=False)}
            # A legitimate empty response carries no new information, so the last-good row stays.
            if done % 200 == 0 or done == len(codes):
                print(f"  holders: {done}/{len(codes)} done, {refreshed} refreshed, {failed} failed",
                      flush=True)

    if auth_fatal is not None:
        # A dead credential means every symbol failed; publishing would replace a good cache
        # with nothing. Stop the whole run here — later stages would fail identically.
        print(f"  holders: {refreshed} refreshed, {failed} failed — {auth_fatal}", flush=True)
        raise auth_fatal
    if refreshed == 0:
        # Nothing succeeded, so this run learned nothing. Keep what we had.
        print(f"  holders: 0 refreshed ({failed} failed) — keeping last-good cache", flush=True)
        raise UpstreamError(f"holders: every one of {len(codes)} symbols failed ({failed} errors)")

    df = pd.DataFrame([merged[c] for c in sorted(merged)])
    _atomic_write_parquet(df, OUT / "holders.parquet")
    print(f"holders.parquet: {len(df)} tickers ({refreshed} refreshed this run, "
          f"{failed} kept last-good after failure)", flush=True)


# ─────────────────────────────── driver ───────────────────────────────
STAGES = ("financials", "lhb", "holders")


def main(argv: list[str]) -> int:
    stages = "financials,lhb,holders"
    lhb_days = 60
    workers = 8
    limit = 0
    years = DEFAULT_FIN_YEARS
    if "--stages" in argv:
        stages = argv[argv.index("--stages") + 1]
    if "--lhb-days" in argv:
        lhb_days = int(argv[argv.index("--lhb-days") + 1])
    if "--workers" in argv:
        workers = int(argv[argv.index("--workers") + 1])
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])
    if "--years" in argv:
        years = int(argv[argv.index("--years") + 1])
    st = {s.strip() for s in stages.split(",") if s.strip()}
    unknown = st - set(STAGES)
    if unknown:
        print(f"unknown stage(s): {','.join(sorted(unknown))} (known: {','.join(STAGES)})", file=sys.stderr)
        return 2
    if not st:
        print("no stages requested", file=sys.stderr)
        return 2

    t0 = time.time()
    status: list[tuple[str, str]] = []
    fatal = False

    for name, title, run in (
        ("financials", "fina_indicator_vip + income_vip", lambda: collect_financials(fiscal_years(years))),
        ("lhb", "top_list + block_trade", lambda: collect_lhb(lhb_days)),
        ("holders", "top10_floatholders", lambda: collect_holders(workers, limit)),
    ):
        if name not in st:
            status.append((name, "skipped"))
            continue
        if fatal:
            # A rejected credential makes every later call fail; stop instead of burning retries.
            status.append((name, "not-attempted (credential rejected)"))
            print(f"=== {title}: NOT ATTEMPTED — credential already rejected ===", flush=True)
            continue
        print(f"=== {title} ===", flush=True)
        try:
            published = _guard(run, name)
        except (UpstreamAuthError, UpstreamPermissionError, MissingTokenError):
            status.append((name, "FAILED (fatal)"))
            fatal = True
        else:
            status.append((name, "ok" if published else "FAILED (last-good kept)"))

    print(f"\n{'stage':<12} result")
    for name, result in status:
        print(f"{name:<12} {result}")
    failed = [n for n, r in status if r.startswith("FAILED")]
    print(f"done in {time.time() - t0:.0f}s — "
          f"{len(failed)} stage(s) failed; last-good caches preserved for those stages")
    if failed:
        print("collect_cn_deep: INCOMPLETE", flush=True)
        return 1
    print("collect_cn_deep: OK", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))