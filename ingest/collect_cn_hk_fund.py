"""Collect the full-statement fundamentals the fund.json emitter (gen_fund_cn.py / gen_fund_hk.py)
needs for CN A-shares and HK names — BUILD-SPEC §2 D2.

CN (Tushare, all endpoints entitled/$0):
    income_vip / balancesheet_vip / cashflow_vip whole-market per quarter-end period (28 periods back
    → ~84 whole-market calls, ≤2/s). Each statement cached as one parquet keyed (ts_code, end_date),
    resumable by period (a period already in the cache is skipped). income_vip carries the 营业成本
    (oper_cost) row the judge's gross-margin ruling depends on.
    pro.dividend per-ticker over the CN universe → dividends.parquet (resumable per-ticker).

EastMoney bulk:
    cn_consensus.parquet  — EastMoney datacenter consensus EPS/revenue/PE by predict_year (2026-2028)
    cn_reports.parquet    — per-ticker research report list (rating + per-report EPS + target price)
    cn_company.parquet    — stock_company from Tushare (website/employees/setup_date/province/city)
    cn_holdernum.parquet  — stk_holdernumber snapshot (latest filed holder count)
    cn_disclosure.parquet — disclosure_date for next quarter-end (pre_date / actual_date)

HK (akshare + yfinance):
    stock_financial_hk_report_em per ticker for 利润表 / 资产负债表 / 现金流量表, indicator="报告期"
    (annual AND quarterly — 95 report dates for 00700, judge-verified). Long-format rows keyed by
    STD_ITEM_CODE; the emitter maps the taxonomy. HK dividend comes from the income-statement 每股股息
    row + a regex over any note text. yfinance HK supplies estimates / targets / recommendation dist /
    financialCurrency (often CNY while the quote is HKD — the judge's flagged 0700.HK case).
    Serial akshare with 0.5-1s sleep, resumable per-ticker cache data/hk_fund/<SYM>.json.

Universe:
    CN = site/chinastockdata/*.{SS,SZ}.json  (→ Tushare .SH/.SZ codes; .SS→.SH mapping handled)
    HK = ingest/hk_universe_cache.json (full HKEX listing, ~2,798 names — the terminal manifest
         floor) ∪ site/hkstockdata/*.HK.json ∪ data/tushare/hk_deep.parquet tickers.
         (The old site∪hk_deep-only universe was the ~500-name top-turnover slice — that is what
         stalled fund.json coverage at 470/2798, 2026-07-13 census.)

Writes into  <Macro Dashboard>/data/ :
    tushare/stmt_income.parquet    (ts_code, end_date, <income fields>)      resumable by period
    tushare/stmt_balance.parquet   (ts_code, end_date, <balance fields>)
    tushare/stmt_cashflow.parquet  (ts_code, end_date, <cashflow fields>)
    tushare/dividends.parquet      (ts_code, events_json)                    resumable per-ticker
    tushare/daily_basic.parquet    (ts_code, close, total_share, ...)        stats snapshot (one call)
    tushare/cn_consensus.parquet   (SECUCODE, PREDICT_YEAR, EPS, PE, ...)    consensus by year
    tushare/cn_reports.parquet     (ts_code, publishDate, emRatingName, ...) per-report ratings/EPS
    tushare/cn_company.parquet     (ts_code, website, employees, ...)        company profile
    tushare/cn_holdernum.parquet   (ts_code, holder_nums, end_date)          latest holder count
    tushare/cn_disclosure.parquet  (ts_code, end_date, pre_date, actual_date) next earnings date
    hk_fund/<SYM>.json             {financials{income,balance,cashflow}, yf{...}}  resumable per-ticker

Run with the macro venv (pandas + TUSHARE_TOKEN in <Macro Dashboard>/.env):
    "<Macro Dashboard>/.venv/bin/python" ingest/collect_cn_hk_fund.py \
        [--market cn|hk|all] [--only 600519.SH,0700.HK] [--limit N] \
        [--periods 28] [--stale-days 7] [--skip-stmt] [--skip-div] [--force]
        [--skip-consensus] [--skip-reports] [--skip-company] [--skip-holders]
        [--skip-disclosure] [--shard i/N] [--statements-only]

--shard i/N (1-based) takes every N-th name of the sorted HK universe so N processes can run the
per-ticker HK collection in parallel against one shared cache dir (writes are per-ticker atomic).
"""
from __future__ import annotations

import glob
import json
import math
import os
import sys
import time
import datetime as dt
import urllib.request
from numbers import Integral, Real
from pathlib import Path

import pandas as pd

CA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CA_ROOT))
from ingest.earnings_calendar import select_next_earnings_date  # noqa: E402

MACRO = Path(os.environ.get("MACRO_REPO") or "/Users/chriswong/Documents/Cluade/Macro Dashboard")
OUT = MACRO / "data" / "tushare"
HK_OUT = MACRO / "data" / "hk_fund"
CN_SITE = MACRO / "site" / "chinastockdata"
HK_SITE = MACRO / "site" / "hkstockdata"
HK_DEEP = OUT / "hk_deep.parquet"


# ─────────────────────────────── Tushare REST ───────────────────────────────
TOKEN: str | None = None


def _token() -> str:
    global TOKEN
    if TOKEN:
        return TOKEN
    t = (os.environ.get("TUSHARE_TOKEN") or "").strip()
    if not t:
        env = MACRO / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("TUSHARE_TOKEN="):
                    t = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not t:
        sys.exit("no TUSHARE_TOKEN (env or Macro Dashboard/.env)")
    TOKEN = t
    return t


def ts_call(api: str, params: dict, fields: str = "", retries: int = 4):
    """Tushare REST → (fields, items). Retries on rate-limit (频率超限). Returns ([],[]) on hard error."""
    body = json.dumps({"api_name": api, "token": _token(), "params": params, "fields": fields}).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request("http://api.tushare.pro", data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                r = json.loads(resp.read())
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.get("code") == 0:
            d = r.get("data") or {}
            return d.get("fields") or [], d.get("items") or []
        msg = str(r.get("msg") or "")
        if "频率" in msg or "超限" in msg:
            time.sleep(2.0 * (attempt + 1))
            continue
        return [], []
    return [], []


def _f(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _json_safe(value):
    """Normalize dataframe scalars and replace NaN/±Infinity before writing resumable caches."""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, Integral):
        return int(value)
    if isinstance(value, Real):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _strict_json_dumps(value) -> str:
    return json.dumps(
        _json_safe(value),
        ensure_ascii=False,
        default=str,
        allow_nan=False,
    )


def _atomic_write(dest: Path, text: str) -> None:
    """Write via tmp+rename so a kill mid-write never leaves a truncated per-ticker cache that the
    exists()/stale check would then treat as valid."""
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, dest)


# ─────────────────────────────── universes ───────────────────────────────
def cn_universe() -> list[str]:
    """CN names (site/chinastockdata/*.SS|SZ.json) → Tushare codes (.SS→.SH)."""
    out = []
    for p in CN_SITE.glob("*.json"):
        n = p.name[:-5]
        if n.endswith(".SS"):
            out.append(n[:-3] + ".SH")
        elif n.endswith(".SZ"):
            out.append(n)
    return sorted(set(out))


HK_UNIVERSE_CACHE = Path(__file__).resolve().parent / "hk_universe_cache.json"


def hk_universe() -> list[str]:
    """HK names as terminal 4-digit .HK symbols. Floor = ingest/hk_universe_cache.json (the full
    HKEX listing from Tushare hk_basic that also floors the terminal manifest, ~2,798 names),
    unioned with the legacy site/hkstockdata ∪ hk_deep.parquet sources."""
    out: set[str] = set()
    if HK_UNIVERSE_CACHE.exists():
        try:
            out.update(k for k in json.loads(HK_UNIVERSE_CACHE.read_text()) if k.endswith(".HK"))
        except Exception:
            pass
    for f in glob.glob(str(HK_SITE / "*.HK.json")):
        n = os.path.basename(f)[:-5]
        if not n.startswith("_"):   # skip _HSI / _HSCE index files
            out.add(n)
    if HK_DEEP.exists():
        try:
            for t in pd.read_parquet(HK_DEEP)["ticker"].tolist():
                out.add(str(t))
        except Exception:
            pass
    return sorted(out)


# ─────────────────────────────── CN statement periods ───────────────────────────────
def quarter_periods(n: int) -> list[str]:
    """The last n fiscal quarter-ends (YYYYMMDD), newest→oldest, as of today."""
    today = dt.date.today()
    ends = [(3, 31), (6, 30), (9, 30), (12, 31)]
    out = []
    y = today.year
    # start from the most recent quarter-end strictly on/before today
    while len(out) < n:
        for m, d in reversed(ends):
            qe = dt.date(y, m, d)
            if qe <= today:
                out.append(qe.strftime("%Y%m%d"))
                if len(out) >= n:
                    break
        y -= 1
    return out


INCOME_FIELDS = ("ts_code,end_date,total_revenue,revenue,oper_cost,total_cogs,operate_profit,"
                 "total_profit,income_tax,n_income,n_income_attr_p,basic_eps,diluted_eps,ebit,ebitda,"
                 "sell_exp,admin_exp,fin_exp")
BALANCE_FIELDS = ("ts_code,end_date,total_assets,total_cur_assets,total_nca,total_liab,total_cur_liab,"
                  "total_ncl,total_hldr_eqy_inc_min_int,money_cap,st_borr,lt_borr,bond_payable")
CASHFLOW_FIELDS = ("ts_code,end_date,n_cashflow_act,n_cashflow_inv_act,n_cash_flows_fnc_act,"
                   "c_pay_acq_const_fiolta,free_cashflow")

_STMT = {
    "income":   ("income_vip",       INCOME_FIELDS,   OUT / "stmt_income.parquet"),
    "balance":  ("balancesheet_vip", BALANCE_FIELDS,  OUT / "stmt_balance.parquet"),
    "cashflow": ("cashflow_vip",     CASHFLOW_FIELDS, OUT / "stmt_cashflow.parquet"),
}


def collect_cn_statements(periods: list[str], force: bool) -> None:
    """Whole-market _vip statement pulls, one parquet per statement, resumable by period.
    Each parquet holds one row per (ts_code, end_date); a period already present is skipped."""
    OUT.mkdir(parents=True, exist_ok=True)
    for kind, (api, fields, path) in _STMT.items():
        have: set[str] = set()
        existing = None
        if path.exists() and not force:
            try:
                existing = pd.read_parquet(path)
                have = set(str(x) for x in existing["end_date"].unique())
            except Exception:
                existing = None
        want = [p for p in periods if p not in have]
        if not want:
            print(f"  {kind}: all {len(periods)} periods cached — skip", flush=True)
            continue
        frames = [existing] if existing is not None else []
        for p in want:
            f, items = ts_call(api, {"period": p}, fields)
            if not items:
                print(f"  {kind} {p}: 0 rows (skip)", flush=True)
                time.sleep(0.55)
                continue
            idx = {n: i for i, n in enumerate(f)}
            rows = []
            for it in items:
                row = {c: (_f(it[idx[c]]) if c not in ("ts_code", "end_date") else it[idx[c]])
                       for c in f}
                rows.append(row)
            frames.append(pd.DataFrame(rows))
            print(f"  {kind} {p}: {len(rows)} rows", flush=True)
            time.sleep(0.55)   # ≤2/s
        df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        if not df.empty:
            df = df.drop_duplicates(subset=["ts_code", "end_date"], keep="last")
            df.to_parquet(path, index=False)
        print(f"{path.name}: {len(df)} rows ({df['ts_code'].nunique() if not df.empty else 0} tickers)",
              flush=True)


def collect_daily_basic() -> None:
    """One whole-market daily_basic snapshot → stats (shares/mktcap/beta-proxy) for the emitter."""
    # newest trade date with data: walk back from today, skip weekends
    d = dt.date.today()
    for _ in range(10):
        if d.weekday() < 5:
            f, items = ts_call("daily_basic", {"trade_date": d.strftime("%Y%m%d")},
                               "ts_code,close,total_share,float_share,free_share,total_mv,circ_mv,"
                               "pe,pe_ttm,pb,ps_ttm,dv_ttm")
            if items:
                idx = {n: i for i, n in enumerate(f)}
                rows = [{c: (_f(it[idx[c]]) if c != "ts_code" else it[idx[c]]) for c in f} for it in items]
                df = pd.DataFrame(rows)
                OUT.mkdir(parents=True, exist_ok=True)
                df.to_parquet(OUT / "daily_basic.parquet", index=False)
                print(f"daily_basic.parquet: {len(df)} rows ({d})", flush=True)
                return
        d -= dt.timedelta(days=1)
    print("daily_basic: no data found in last 10 days", flush=True)


# ─────────────────────────────── CN dividends (per-ticker) ───────────────────────────────
DIV_FIELDS = "ts_code,end_date,ann_date,div_proc,stk_div,cash_div,cash_div_tax,record_date,ex_date,pay_date"


def _one_div(code: str):
    f, items = ts_call("dividend", {"ts_code": code}, DIV_FIELDS)
    if not items:
        return []
    idx = {n: i for i, n in enumerate(f)}
    events = []
    for it in items:
        proc = it[idx.get("div_proc", -1)] if "div_proc" in idx else None
        ex = it[idx.get("ex_date", -1)] if "ex_date" in idx else None
        # only implemented cash dividends with an ex-date (drop 预案/股东大会通过 proposals)
        amt = _f(it[idx["cash_div_tax"]]) if "cash_div_tax" in idx else None
        if amt is None or amt <= 0 or not ex:
            continue
        if proc and proc not in ("实施", "分红"):
            continue
        stk = _f(it[idx["stk_div"]]) if "stk_div" in idx else None
        events.append({
            "ex": _ymd(ex), "amount": round(amt, 6),
            "pay": _ymd(it[idx.get("pay_date", -1)] if "pay_date" in idx else None),
            "record": _ymd(it[idx.get("record_date", -1)] if "record_date" in idx else None),
            "type": "regular",
            "stk_div": stk if stk else None,
        })
    events.sort(key=lambda e: e["ex"] or "")
    return events


def _ymd(s):
    if not s:
        return None
    s = str(s)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else s


def collect_cn_dividends(codes: list[str], force: bool, stale_days: int = 7) -> None:
    have: dict[str, str] = {}
    path = OUT / "dividends.parquet"
    stale = False   # if the parquet itself is older than stale_days, re-fetch every ticker
    if path.exists() and not force:
        age_days = (time.time() - path.stat().st_mtime) / 86400
        stale = stale_days > 0 and age_days >= stale_days
        try:
            for r in pd.read_parquet(path).to_dict("records"):
                have[str(r["ts_code"])] = r["events_json"]
        except Exception:
            pass
    # A stale parquet re-fetches every code (a late-filed / revised dividend is otherwise never revisited);
    # a fresh parquet only fetches codes not yet cached.
    todo = list(codes) if stale else [c for c in codes if c not in have]
    print(f"CN dividends: {len(codes)} names, {len(todo)} to fetch", flush=True)
    done = ok = 0
    try:
        for c in todo:
            events = _one_div(c)
            have[c] = json.dumps(events, ensure_ascii=False)
            done += 1
            if events:
                ok += 1
            if done % 100 == 0 or done == len(todo):
                print(f"  dividends: {done}/{len(todo)} done, {ok} with data", flush=True)
                _flush_div(path, have)   # periodic checkpoint (Ctrl-C-safe)
            time.sleep(0.32)   # ≤2/s buffer alongside statement calls
    except KeyboardInterrupt:
        print("  interrupted — flushing dividends checkpoint", flush=True)
    _flush_div(path, have)
    print(f"dividends.parquet: {len(have)} tickers", flush=True)


def _flush_div(path: Path, have: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame([{"ts_code": k, "events_json": v} for k, v in sorted(have.items())])
    df.to_parquet(path, index=False)


# ─────────────────────────────── HK (akshare + yfinance, per-ticker) ───────────────────────────────
HK_STMTS = {"income": "利润表", "balance": "资产负债表", "cashflow": "现金流量表"}


def _ak_stock(sym: str) -> str:
    """terminal '0700.HK' → akshare stock code '00700' (akshare wants a 5-digit code)."""
    n = sym.split(".")[0]
    return n.zfill(5)


def _hk_report(sym: str, cn_label: str) -> list[dict]:
    """akshare HK report with source period and taxonomy identity preserved.

    `START_DATE` distinguishes cumulative YTD from a discrete period; `STD_ITEM_NAME` is the audit
    receipt for the 001/002/003/004 family adapters. Discarding both forced downstream month/amount
    guesses, which is how H1/FY became Q2/Q4.
    """
    import akshare as ak
    code = _ak_stock(sym)
    df = ak.stock_financial_hk_report_em(stock=code, symbol=cn_label, indicator="报告期")
    if df is None or df.empty:
        return []
    out: dict[str, dict] = {}
    for r in df.to_dict("records"):
        report_raw = r.get("REPORT_DATE")
        rd = "" if pd.isna(report_raw) else str(report_raw)[:10]
        if not rd:
            continue
        start_raw = r.get("START_DATE")
        start = None if pd.isna(start_raw) else (str(start_raw)[:10] or None)
        date_type_raw = r.get("DATE_TYPE_CODE")
        fiscal_year_raw = r.get("FISCAL_YEAR")
        date_type = None if pd.isna(date_type_raw) else str(date_type_raw)
        fiscal_year_end = None if pd.isna(fiscal_year_raw) else str(fiscal_year_raw)
        rec = out.setdefault(rd, {
            "end": rd,
            "start": start,
            "date_type": date_type,
            "fiscal_year_end": fiscal_year_end,
            "items": {},
            "item_names": {},
        })
        if rec.get("start") is None and start:
            rec["start"] = start
        if rec.get("date_type") is None and date_type:
            rec["date_type"] = date_type
        if rec.get("fiscal_year_end") is None and fiscal_year_end:
            rec["fiscal_year_end"] = fiscal_year_end
        code_i = str(r.get("STD_ITEM_CODE") or "")
        amt = _f(r.get("AMOUNT"))
        if code_i:
            rec["items"][code_i] = amt
            name_raw = r.get("STD_ITEM_NAME")
            name = "" if pd.isna(name_raw) else str(name_raw).strip()
            if name:
                rec["item_names"][code_i] = name
    rows = sorted(out.values(), key=lambda x: x["end"])
    return rows


def _hk_yf(sym: str) -> dict:
    """yfinance HK: financialCurrency + estimates/targets/recommendation distribution."""
    import yfinance as yf
    yf_sym = sym if sym.endswith(".HK") else sym + ".HK"
    try:
        t = yf.Ticker(yf_sym)
        info = t.info or {}
    except Exception:
        return {}
    out = {
        "financial_currency": info.get("financialCurrency"),
        "currency": info.get("currency"),
        "target_mean": _f(info.get("targetMeanPrice")), "target_high": _f(info.get("targetHighPrice")),
        "target_low": _f(info.get("targetLowPrice")), "target_median": _f(info.get("targetMedianPrice")),
        "rec_key": info.get("recommendationKey"), "n_analysts": info.get("numberOfAnalystOpinions"),
        "beta": _f(info.get("beta")), "mktcap": _f(info.get("marketCap")),
        "shares_out": _f(info.get("sharesOutstanding")), "float_shares": _f(info.get("floatShares")),
        "held_inst_pct": _f(info.get("heldPercentInstitutions")), "held_insider_pct": _f(info.get("heldPercentInsiders")),
        "sector": info.get("sector"), "industry": info.get("industry"),
        "website": info.get("website"), "employees": info.get("fullTimeEmployees"),
        "description": info.get("longBusinessSummary"),
        "trailing_eps_fwd": _f(info.get("forwardEps")), "trailing_pe": _f(info.get("trailingPE")),
        "forward_pe": _f(info.get("forwardPE")), "ps": _f(info.get("priceToSalesTrailing12Months")),
        "pb": _f(info.get("priceToBook")), "div_yield": _f(info.get("dividendYield")),
        "payout_ratio": _f(info.get("payoutRatio")), "rev_growth": _f(info.get("revenueGrowth")),
        "eps_growth": _f(info.get("earningsGrowth")), "gross_margin": _f(info.get("grossMargins")),
        "net_margin": _f(info.get("profitMargins")), "roe": _f(info.get("returnOnEquity")),
        "roa": _f(info.get("returnOnAssets")), "next_earnings": None,
    }
    # recommendation distribution (strongBuy/buy/hold/sell/strongSell), newest window
    try:
        rec = t.recommendations
        if rec is not None and not rec.empty:
            row = rec.iloc[0].to_dict()
            out["rec_dist"] = {k: int(row.get(k) or 0)
                               for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}
    except Exception:
        pass
    # analyst estimates (eps/rev forward) + next earnings date from calendar
    try:
        cal = t.calendar or {}
        eds = cal.get("Earnings Date")
        if eds:
            # Keep the whole vendor candidate set in play: truncating to eds[0] here meant a
            # stale first entry hid a real later date from the emitter (mastermind-terminal#474).
            out["next_earnings"] = select_next_earnings_date(eds)
        out["eps_next_avg"] = _f(cal.get("Earnings Average"))
        out["rev_next_avg"] = _f(cal.get("Revenue Average"))
    except Exception:
        pass
    try:
        et = t.earnings_estimate
        if et is not None and not et.empty:
            out["eps_est"] = {str(k): _json_safe(et.loc[k].to_dict()) for k in et.index}
    except Exception:
        pass
    try:
        rt = t.revenue_estimate
        if rt is not None and not rt.empty:
            out["rev_est"] = {str(k): {kk: _f(vv) for kk, vv in rt.loc[k].to_dict().items()} for k in rt.index}
    except Exception:
        pass
    return out


def _meaningful_value(value) -> bool:
    """Whether a vendor value carries information rather than an empty response shell."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return any(_meaningful_value(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_meaningful_value(item) for item in value)
    return True


def _meaningful_yf(value: dict | None) -> bool:
    return bool(value) and _meaningful_value(value)


def _merge_yf(previous: dict | None, fresh: dict | None) -> dict:
    """Overlay meaningful fresh fields without erasing good fields during partial outages."""
    merged = dict(previous or {})
    for key, value in (fresh or {}).items():
        if _meaningful_value(value) or key not in merged:
            merged[key] = value
    return merged


def _fetch_hk(sym: str, *, fetch_yf: bool = True) -> dict | None:
    fin: dict[str, list] = {}
    for kind, label in HK_STMTS.items():
        try:
            fin[kind] = _hk_report(sym, label)
        except Exception:
            fin[kind] = []
        time.sleep(0.6)   # serial akshare etiquette
    yf = _hk_yf(sym) if fetch_yf else {}
    if not any(fin.values()) and not _meaningful_yf(yf):
        return None
    return {"ticker": sym, "financials": fin, "yf": yf}


def collect_hk_fund(
    syms: list[str], force: bool, stale_days: int = 7, *, statements_only: bool = False,
) -> None:
    HK_OUT.mkdir(parents=True, exist_ok=True)
    done = ok = healed = preserved_blocks = 0
    try:
        for sym in syms:
            cache = HK_OUT / f"{sym}.json"
            # Re-fetch when missing, forced, or older than stale_days (otherwise a cache written on the
            # first backfill is skipped forever and never picks up new report dates / analyst updates).
            if cache.exists() and not force:
                age_days = (time.time() - cache.stat().st_mtime) / 86400
                if stale_days <= 0 or age_days < stale_days:
                    # SELF-HEAL a fresh cache with a hollow block: a yfinance rate-limit episode
                    # caches yf={} (the 2026-07-03 run left 89% of HK names that way) and an
                    # akshare outage caches empty financials — both would otherwise never be
                    # revisited while the cache stays fresh.
                    try:
                        rec = json.loads(cache.read_text())
                    except Exception:
                        rec = None
                    current_yf = (rec or {}).get("yf") or {}
                    needs_yf_heal = (
                        not _meaningful_yf(current_yf)
                        or not _meaningful_value(current_yf.get("financial_currency"))
                    )
                    if rec and any((rec.get("financials") or {}).values()) and needs_yf_heal:
                        yf = _hk_yf(sym)
                        if _meaningful_yf(yf):
                            rec["yf"] = _merge_yf(current_yf, yf)
                            _atomic_write(cache, _strict_json_dumps(rec))
                            healed += 1
                        done += 1
                        continue
                    if rec is not None and (any((rec.get("financials") or {}).values()) or rec.get("yf")):
                        done += 1
                        continue
                    # corrupt cache or both blocks hollow → fall through to a full re-fetch
            preserved_yf = {}
            preserved_financials: dict[str, list] = {}
            if cache.exists():
                try:
                    previous = json.loads(cache.read_text())
                    preserved_financials = previous.get("financials") or {}
                    preserved_yf = previous.get("yf") or {}
                except Exception:
                    preserved_yf = {}
                    preserved_financials = {}
            rec = _fetch_hk(sym, fetch_yf=not statements_only)
            done += 1
            if rec:
                if statements_only:
                    rec["yf"] = preserved_yf
                else:
                    # yfinance fields fail independently and an empty `info` response is often a
                    # truthy dictionary of nulls. Keep prior sourced values unless the refresh
                    # provides a meaningful replacement for that exact field.
                    rec["yf"] = _merge_yf(preserved_yf, rec.get("yf"))
                fresh_financials = rec.setdefault("financials", {})
                # Each vendor endpoint fails independently. Never let one transient empty
                # response erase a valid cached income/balance/cash-flow history while the
                # other two endpoints refresh successfully. This applies to the ordinary stale
                # refresh too, not only the one-off statements-only migration.
                for kind in HK_STMTS:
                    if not fresh_financials.get(kind) and preserved_financials.get(kind):
                        fresh_financials[kind] = preserved_financials[kind]
                        preserved_blocks += 1
                _atomic_write(cache, _strict_json_dumps(rec))
                ok += 1
            if done % 25 == 0 or done == len(syms):
                print(
                    f"  hk_fund: {done}/{len(syms)} done, {ok} newly cached, "
                    f"{healed} yf-healed, {preserved_blocks} statement blocks preserved",
                    flush=True,
                )
    except KeyboardInterrupt:
        print("  interrupted — per-ticker caches already on disk (resumable)", flush=True)
    print(
        f"hk_fund: {ok} names newly cached, {healed} yf-healed, "
        f"{preserved_blocks} statement blocks preserved into {HK_OUT}",
        flush=True,
    )


# ─────────────────────────────── EastMoney consensus (cn_consensus.parquet) ───────────────────────────────
_EM_HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"}
_EM_BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def _em_get(url: str, retries: int = 4) -> dict:
    """GET → parsed JSON dict.  Returns {} on failure."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=_EM_HEADERS)
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return {}


def collect_cn_consensus(force: bool = False) -> None:
    """EastMoney datacenter bulk consensus → cn_consensus.parquet.

    Pulls RPT_RES_PROFITPREDICT for PREDICT_YEAR in {2026,2027,2028}, 500 rows/page,
    ~6 pages per year.  Resumable: years already in the cache are skipped unless --force.
    Fields retained: SECUCODE, PREDICT_YEAR, EPS, PE, PARENT_NETPROFIT, TOTAL_OPERATE_INCOME.
    """
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "cn_consensus.parquet"
    YEARS = [2026, 2027, 2028]
    have_years: set = set()
    existing = None
    if path.exists() and not force:
        try:
            existing = pd.read_parquet(path)
            have_years = set(existing["PREDICT_YEAR"].unique())
        except Exception:
            existing = None

    frames = [existing] if existing is not None else []
    for yr in YEARS:
        if yr in have_years:
            print(f"  cn_consensus {yr}: cached — skip", flush=True)
            continue
        year_rows: list[dict] = []
        page = 1
        while True:
            url = (f"{_EM_BASE}?reportName=RPT_RES_PROFITPREDICT&columns=ALL"
                   f"&pageSize=500&pageNumber={page}"
                   f"&filter=(PREDICT_YEAR%3D{yr})")
            d = _em_get(url)
            result = d.get("result") or {}
            rows = result.get("data") or []
            if not rows:
                break
            for r in rows:
                year_rows.append({
                    "SECUCODE": r.get("SECUCODE"),
                    "PREDICT_YEAR": yr,
                    "EPS": _f(r.get("EPS")),
                    "PE": _f(r.get("PE")),
                    "PARENT_NETPROFIT": _f(r.get("PARENT_NETPROFIT")),
                    "TOTAL_OPERATE_INCOME": _f(r.get("TOTAL_OPERATE_INCOME")),
                })
            total = result.get("count") or 0
            print(f"  cn_consensus {yr} page {page}: {len(rows)} rows (total {total})", flush=True)
            if len(year_rows) >= (total or 1) or len(rows) < 500:
                break
            page += 1
            time.sleep(0.3)
        if year_rows:
            frames.append(pd.DataFrame(year_rows))
        time.sleep(0.5)

    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not df.empty:
        df = df.drop_duplicates(subset=["SECUCODE", "PREDICT_YEAR"], keep="last")
        df.to_parquet(path, index=False)
    print(f"cn_consensus.parquet: {len(df)} rows, {df['SECUCODE'].nunique() if not df.empty else 0} tickers",
          flush=True)


# ─────────────────────────────── EastMoney per-ticker reports (cn_reports.parquet) ────────────────────────
_EM_REPORT_BASE = "https://reportapi.eastmoney.com/report/list"


def _em_reports_one(code6: str) -> list[dict]:
    """Fetch last 365d research reports for a 6-digit code.  Returns [] on any error."""
    today = dt.date.today()
    begin = (today - dt.timedelta(days=365)).strftime("%Y-%m-%d")
    end = today.strftime("%Y-%m-%d")
    url = (f"{_EM_REPORT_BASE}?pageSize=100&pageNo=1&code={code6}"
           f"&beginTime={begin}&endTime={end}&qType=0")
    d = _em_get(url)
    items = d.get("data") or []
    out = []
    for row in items:
        if not isinstance(row, dict):
            continue
        out.append({
            "orgSName": row.get("orgSName"),
            "publishDate": str(row.get("publishDate") or "")[:10],
            "emRatingName": row.get("emRatingName"),
            "emRatingValue": _f(row.get("emRatingValue")),
            "predictThisYearEps": _f(row.get("predictThisYearEps")),
            "predictNextYearEps": _f(row.get("predictNextYearEps")),
            "indvAimPriceT": _f(row.get("indvAimPriceT")),
        })
    return out


def collect_cn_reports(codes: list[str], force: bool = False, stale_days: int = 7) -> None:
    """Per-ticker EastMoney research reports → cn_reports.parquet.

    Resumable per-ticker (skip if already fresh).  Tolerant of empty/malformed rows —
    zero-coverage small caps emit an honest empty list in reports_json.
    codes should be Tushare .SH/.SZ; we strip to 6-digit for the EastMoney endpoint.
    """
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "cn_reports.parquet"
    have: dict[str, str] = {}
    stale = False
    if path.exists() and not force:
        age_days = (time.time() - path.stat().st_mtime) / 86400
        stale = stale_days > 0 and age_days >= stale_days
        if not stale:
            try:
                for r in pd.read_parquet(path).to_dict("records"):
                    have[str(r["ts_code"])] = r["reports_json"]
            except Exception:
                pass
    todo = list(codes) if stale else [c for c in codes if c not in have]
    print(f"cn_reports: {len(codes)} names, {len(todo)} to fetch", flush=True)
    done = ok = 0
    try:
        for c in todo:
            code6 = c[:6]
            rows = _em_reports_one(code6)
            have[c] = json.dumps(rows, ensure_ascii=False)
            done += 1
            if rows:
                ok += 1
            if done % 100 == 0 or done == len(todo):
                print(f"  cn_reports: {done}/{len(todo)} done, {ok} with data", flush=True)
                _flush_reports(path, have)
            time.sleep(0.4)
    except KeyboardInterrupt:
        print("  interrupted — flushing cn_reports checkpoint", flush=True)
    _flush_reports(path, have)
    print(f"cn_reports.parquet: {len(have)} tickers, {ok} with coverage", flush=True)


def _flush_reports(path: Path, have: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame([{"ts_code": k, "reports_json": v} for k, v in sorted(have.items())])
    df.to_parquet(path, index=False)


# ─────────────────────────────── Tushare bulk singles ───────────────────────────────
def collect_cn_company(force: bool = False) -> None:
    """Tushare stock_company (SSE+SZSE) → cn_company.parquet.

    Fields: ts_code, website, employees, setup_date, province, city, introduction.
    One-shot (whole market per exchange), resumable by checking file age.
    """
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "cn_company.parquet"
    if path.exists() and not force:
        age_days = (time.time() - path.stat().st_mtime) / 86400
        if age_days < 30:
            print(f"cn_company.parquet: fresh ({age_days:.1f}d old) — skip", flush=True)
            return
    fields = "ts_code,website,employees,setup_date,province,city,introduction"
    frames = []
    for exchange in ("SSE", "SZSE"):
        f, items = ts_call("stock_company", {"exchange": exchange}, fields)
        if items:
            idx = {n: i for i, n in enumerate(f)}
            rows = []
            for it in items:
                row = {"ts_code": it[idx["ts_code"]] if "ts_code" in idx else None}
                for col in ("website", "employees", "setup_date", "province", "city", "introduction"):
                    if col in idx:
                        v = it[idx[col]]
                        row[col] = (_f(v) if col == "employees" else (v if v else None))
                rows.append(row)
            frames.append(pd.DataFrame(rows))
            print(f"  cn_company {exchange}: {len(rows)} rows", flush=True)
        time.sleep(0.6)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not df.empty:
        df = df.drop_duplicates(subset=["ts_code"], keep="last")
        df.to_parquet(path, index=False)
    print(f"cn_company.parquet: {len(df)} rows", flush=True)


def collect_cn_holdernum(force: bool = False) -> None:
    """Tushare stk_holdernumber (latest well-filed quarter-end, whole market) → cn_holdernum.parquet.

    Walks back through recent quarter-ends and picks the one with the most rows (>= 2000 threshold
    distinguishes well-filed from in-progress periods; Q1 2026 = 5040 rows, Q2 2026 partial at ~984).
    """
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "cn_holdernum.parquet"
    if path.exists() and not force:
        age_days = (time.time() - path.stat().st_mtime) / 86400
        if age_days < 30:
            print(f"cn_holdernum.parquet: fresh ({age_days:.1f}d old) — skip", flush=True)
            return
    today = dt.date.today()
    candidate_ends = []
    for y in (today.year, today.year - 1):
        for m, d in reversed([(3, 31), (6, 30), (9, 30), (12, 31)]):
            qe = dt.date(y, m, d)
            if qe <= today:
                candidate_ends.append(qe.strftime("%Y%m%d"))
    best_f, best_items, best_qdate = [], [], None
    for qdate in candidate_ends[:6]:
        f, items = ts_call("stk_holdernumber", {"enddate": qdate}, "ts_code,holder_nums,end_date")
        print(f"  cn_holdernum: {len(items)} rows for {qdate}", flush=True)
        if len(items) > len(best_items):
            best_f, best_items, best_qdate = f, items, qdate
        if len(best_items) >= 2000:
            break   # good enough — stop walking back
        time.sleep(0.55)
    if not best_items:
        print("cn_holdernum: no data found", flush=True)
        return
    idx = {n: i for i, n in enumerate(best_f)}
    rows = [{"ts_code": it[idx["ts_code"]],
             "holder_nums": _f(it[idx["holder_nums"]]) if "holder_nums" in idx else None,
             "end_date": it[idx["end_date"]] if "end_date" in idx else None}
            for it in best_items]
    df = pd.DataFrame(rows)
    df.to_parquet(path, index=False)
    print(f"cn_holdernum.parquet: {len(df)} rows (from {best_qdate})", flush=True)


def collect_cn_disclosure(force: bool = False) -> None:
    """Tushare disclosure_date (current/latest quarter-end) → cn_disclosure.parquet.

    Pulls for the most recent quarter-end that has data (~5537 rows as per brief).
    Fields: ts_code, end_date, pre_date, actual_date.
    """
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "cn_disclosure.parquet"
    if path.exists() and not force:
        age_days = (time.time() - path.stat().st_mtime) / 86400
        if age_days < 14:
            print(f"cn_disclosure.parquet: fresh ({age_days:.1f}d old) — skip", flush=True)
            return
    today = dt.date.today()
    # Try current quarter-end first (already-past quarters have better coverage),
    # then previous ones as fallback
    candidate_ends = []
    for y in (today.year, today.year - 1):
        for m, d in reversed([(3, 31), (6, 30), (9, 30), (12, 31)]):
            qe = dt.date(y, m, d)
            if qe <= today:
                candidate_ends.append(qe.strftime("%Y%m%d"))
    fields = "ts_code,ann_date,end_date,pre_date,actual_date"
    f, items = [], []
    for qdate in candidate_ends[:3]:
        f, items = ts_call("disclosure_date", {"end_date": qdate}, fields)
        if items:
            print(f"  cn_disclosure: {len(items)} rows for {qdate}", flush=True)
            break
        time.sleep(0.55)
    if not items:
        print("cn_disclosure: no data found", flush=True)
        return
    idx = {n: i for i, n in enumerate(f)}
    rows = []
    for it in items:
        row = {"ts_code": it[idx["ts_code"]] if "ts_code" in idx else None}
        for col in ("ann_date", "end_date", "pre_date", "actual_date"):
            row[col] = it[idx[col]] if col in idx else None
        rows.append(row)
    df = pd.DataFrame(rows)
    df.to_parquet(path, index=False)
    print(f"cn_disclosure.parquet: {len(df)} rows", flush=True)


# ─────────────────────────────── driver ───────────────────────────────
def _arg(argv, flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


def main(argv: list[str]) -> None:
    market = (_arg(argv, "--market", "all") or "all").lower()
    only = _arg(argv, "--only")
    limit = int(_arg(argv, "--limit", 0) or 0)
    periods_n = int(_arg(argv, "--periods", 28) or 28)
    stale_days = int(_arg(argv, "--stale-days", 7) or 7)
    skip_stmt = "--skip-stmt" in argv
    skip_div = "--skip-div" in argv
    skip_consensus = "--skip-consensus" in argv
    skip_reports = "--skip-reports" in argv
    skip_company = "--skip-company" in argv
    skip_holders = "--skip-holders" in argv
    skip_disclosure = "--skip-disclosure" in argv
    force = "--force" in argv
    statements_only = "--statements-only" in argv

    only_set = set(s.strip() for s in only.split(",")) if only else None
    t0 = time.time()

    if market in ("cn", "all"):
        cn = cn_universe()
        # accept both terminal (.SS) and tushare (.SH) in --only
        if only_set:
            def _match(code):
                return code in only_set or (code[:-3] + ".SS") in only_set
            cn = [c for c in cn if _match(c)]
        if limit:
            cn = cn[:limit]
        print(f"=== CN ({len(cn)} names) ===", flush=True)
        if not skip_stmt and not only_set:
            # whole-market statement pulls are period-scoped, not name-scoped; only on a full run
            periods = quarter_periods(periods_n)
            print(f"CN statements: {len(periods)} periods {periods[-1]}..{periods[0]}", flush=True)
            collect_cn_statements(periods, force)
            collect_daily_basic()
        elif not skip_stmt:
            print("  --only set: statements are whole-market — skipping the period pulls "
                  "(run without --only to refresh stmt parquets)", flush=True)
        if not skip_div:
            collect_cn_dividends(cn, force, stale_days)

        # Bulk singles: company/holders/disclosure are whole-market one-shots (not name-scoped)
        if not only_set:
            if not skip_consensus:
                collect_cn_consensus(force)
            if not skip_company:
                collect_cn_company(force)
            if not skip_holders:
                collect_cn_holdernum(force)
            if not skip_disclosure:
                collect_cn_disclosure(force)
        else:
            print("  --only set: skipping whole-market consensus/company/holders/disclosure "
                  "(run without --only to refresh them)", flush=True)

        # Per-ticker reports: run for requested universe (resumable)
        if not skip_reports:
            collect_cn_reports(cn, force, stale_days)

    if market in ("hk", "all"):
        hk = hk_universe()
        if only_set:
            hk = [s for s in hk if s in only_set or s.split(".")[0].zfill(5) in
                  {x.split(".")[0].zfill(5) for x in only_set}]
        if limit:
            hk = hk[:limit]
        shard = _arg(argv, "--shard")
        if shard:
            i, n = (int(x) for x in shard.split("/"))
            hk = hk[i - 1::n]
            print(f"=== HK shard {i}/{n} ===", flush=True)
        print(f"=== HK ({len(hk)} names) ===", flush=True)
        collect_hk_fund(hk, force, stale_days, statements_only=statements_only)

    print(f"done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
