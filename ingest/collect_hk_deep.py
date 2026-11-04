"""Fetch akshare HK deep data (financials / analyst-forecast / profile) for HK names that have
a Terminal OHLC chart but NO Macro Dashboard site JSON — the ~345 names build_hk_library's curated
constituents universe leaves uncovered. Lets the CN/HK intel bridge build a (lite) deep panel for them.

Reuses collectors.hk_fundamentals.fetch_one — the SAME akshare parsing build_hk_library uses
(stock_financial_hk_analysis_indicator_em + stock_hk_company_profile_em + stock_hk_profit_forecast_et),
so the uncovered names get financials/analyst identical in shape to the covered ones. Southbound comes
free from the existing data/hk_southbound/holdings.parquet cross-section (no per-ticker fetch).

Universe = (Terminal *.HK.json OHLC files) − (site/hkstockdata/*.HK.json). Resumable (caches by ticker).
Output: <Macro Dashboard>/data/tushare/hk_deep.parquet  {ticker, payload(json)}

Run with the macro venv:  "<Macro Dashboard>/.venv/bin/python" ingest/collect_hk_deep.py [--workers 6] [--limit N]
"""
from __future__ import annotations

import glob
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

MACRO = Path(os.environ.get("MACRO_REPO") or "/Users/chriswong/Documents/Cluade/Macro Dashboard")
CA = Path(os.environ.get("CA_ROOT") or "/Users/chriswong/Documents/Cluade/charting-app")
sys.path.insert(0, str(MACRO))

from collectors.hk_fundamentals import fetch_one, ak_symbol  # noqa: E402  (financials + profile + analyst forecast)

OUT = MACRO / "data" / "tushare" / "hk_deep.parquet"

# currency-safe valuation from Baidu (HKD-consistent, unlike raw CNY-EPS/HKD-price PE). Positive-only.
_VAL_IND = {"pe": "市盈率(TTM)", "pb": "市净率", "div_yield": "股息率"}


def _valuation(ticker: str) -> dict:
    import akshare as ak
    import pandas as pd
    sym = ak_symbol(ticker)
    out: dict = {}
    for metric, ind in _VAL_IND.items():
        try:
            df = ak.stock_hk_valuation_baidu(symbol=sym, indicator=ind, period="近一年")
            if df is None or df.empty or "value" not in df.columns:
                continue
            s = pd.to_numeric(df["value"], errors="coerce").dropna()
            s = s[s > 0]   # PE/PB/yield are strictly positive; negatives are Baidu noise / loss-makers
            if len(s):
                out[metric] = round(float(s.iloc[-1]), 2)
        except Exception:
            pass
    return out


def fetch_full(ticker: str):
    """fetch_one (financials/profile/analyst) + Baidu valuation."""
    rec = fetch_one(ticker)
    val = _valuation(ticker)
    if rec is None and not val:
        return None
    if rec is None:
        rec = {"ticker": ticker, "financials": [], "profile": {}, "forecast": {}}
    rec["valuation"] = val
    return rec


def uncovered() -> list[str]:
    site = {os.path.basename(f)[:-5] for f in glob.glob(str(MACRO / "site" / "hkstockdata" / "*.HK.json"))}
    ohlc = {os.path.basename(f)[:-5] for f in glob.glob(str(CA / "terminal" / "public" / "data" / "*.HK.json"))}
    return sorted(ohlc - site)


def main(argv: list[str]) -> None:
    workers = int(argv[argv.index("--workers") + 1]) if "--workers" in argv else 6
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else 0
    force = "--force" in argv   # re-fetch cached names too (e.g. after a payload-schema change)
    want = uncovered()
    if limit:
        want = want[:limit]
    cache: dict[str, str] = {}
    if OUT.exists():
        try:
            for r in pd.read_parquet(OUT).to_dict("records"):
                cache[r["ticker"]] = r["payload"]
        except Exception:
            pass
    todo = [t for t in want if force or t not in cache]
    print(f"hk_deep: {len(want)} uncovered HK names, {len(todo)} to fetch (workers={workers}, force={force})", flush=True)

    got = done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch_full, t): t for t in todo}
        for fut in as_completed(futs):
            done += 1
            try:
                rec = fut.result()
            except Exception:
                rec = None
            if rec:
                cache[futs[fut]] = json.dumps(rec, ensure_ascii=False, default=str)
                got += 1
            if done % 50 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)} done, {got} with data", flush=True)

    df = pd.DataFrame([{"ticker": k, "payload": v} for k, v in sorted(cache.items())])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if todo and got == 0:
        raise SystemExit("HK deep collection returned no observations; existing cache unchanged")
    if got:
        temporary = OUT.with_name(f".{OUT.stem}.{os.getpid()}.tmp.parquet")
        try:
            df.to_parquet(temporary, index=False)
            os.replace(temporary, OUT)
        finally:
            temporary.unlink(missing_ok=True)
    print(f"hk_deep.parquet: {len(df)} names", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
