"""China A-share + Hong Kong deep-analysis bridge  →  <SYM>.intel.json (intel/v1).

Companion to pull_macro_intel.py (which handles US only, from site/stockdata). The Macro
Dashboard already builds rich per-stock JSON for CN/HK — site/chinastockdata/<CODE>.{SS,SZ}.json
(build_china_library.py) and site/hkstockdata/<CODE>.HK.json (build_hk_library.py) — but their
key layout differs from the US per-stock JSON, so the US bridge can't read them and the Terminal's
deep-analysis panel (StockAnalysis.tsx, which renders entirely from intel.analysis) shows the
"coming online" empty state for every CN/HK name.

This script maps the CN/HK per-stock schema onto the SAME intel/v1 `analysis` block the panel
already renders for US names:
    view.decision            -> analysis.decision   (verb/tone/headline/band/score/trust)
    conviction               -> analysis.conviction (score/band/drivers/cautions/size)
    entry_signal             -> analysis.entry       (status/levels/horizon/cycle)
    tech                     -> analysis.tech        (direct — same shape)
    fundamentals.valuation   -> analysis.valuation   (+ val_pctile cheapness, CN)
    fundamentals.{quality|valuation}+financials+piotroski+altman -> analysis.financials
    fundamentals.{description|profile}+archetype -> analysis.profile
    consensus (+earnings)    -> analysis.analyst     (rating/target/EPS/upside — HK carries targets)
    southbound | positioning -> analysis.flows       (HK 港股通 southbound / CN 融资 margin)
US-only cards with no CN/HK analogue (factors, gex, macro, 13F smart_money) are omitted; the panel
guards each section so they simply don't render.

Runs on the Mac (where site/chinastockdata + site/hkstockdata live) and writes into
terminal/public/data/; the CN/HK <SYM>.intel.json are then rsync'd to the VPS.

Usage:  python ingest/pull_cn_hk_intel.py [SYM ...]         # default: every CN/HK site JSON
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

CA_ROOT = Path(__file__).resolve().parents[1]
MACRO = Path(os.environ.get("MACRO_REPO") or "/Users/chriswong/Documents/Cluade/Macro Dashboard")
CN_DIR = MACRO / "site" / "chinastockdata"
HK_DIR = MACRO / "site" / "hkstockdata"
OUT = CA_ROOT / "terminal" / "public" / "data"


def g(obj, *keys, default=None):
    """Nested .get() — returns default on any missing key / non-dict along the path."""
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur


def _num(v):
    if isinstance(v, bool):
        return v
    try:
        f = float(v)
        return None if f != f else v
    except (TypeError, ValueError):
        return None


# ───────────────────────── analysis section builders ─────────────────────────
def build_decision(src: dict) -> dict:
    v = src.get("view") or {}
    d = v.get("decision") or {}
    conv = src.get("conviction") or {}
    lad = src.get("ladder") or {}
    act = d.get("action") or {}
    trust = d.get("trust") or {}
    ctrust = conv.get("trust_tier") if isinstance(conv.get("trust_tier"), dict) else {}
    tone = act.get("tone") or {"up": "go", "down": "avoid"}.get(lad.get("dir"))
    verb = act.get("verb") or lad.get("action") or g(d, "timing", "tag")
    verb_zh = act.get("verb_zh") or g(lad, "entry", "tag_zh") or g(d, "timing", "tag_zh")
    band_en = d.get("band_en")
    if band_en in (None, "—", "-"):
        band_en = conv.get("band_en")
    band_zh = d.get("band_zh")
    if band_zh in (None, "—", "-"):
        band_zh = conv.get("band_zh")
    return {
        "verb": verb, "verb_zh": verb_zh, "tone": tone,
        "headline": d.get("headline") or lad.get("summary_line"),
        "headline_zh": d.get("headline_zh") or lad.get("summary_line_zh"),
        "gloss": d.get("gloss") or None, "gloss_zh": d.get("gloss_zh") or None,
        "band": d.get("band"), "band_label": band_en, "band_label_zh": band_zh,
        "name_label": d.get("name_label"), "name_label_zh": d.get("name_label_zh"),
        "score": d.get("score") if d.get("score") is not None else conv.get("score"),
        "trust_tier": trust.get("tier") or ctrust.get("tier"),
        "trust_en": trust.get("en") or ctrust.get("en"),
        "trust_zh": trust.get("zh") or ctrust.get("zh"),
    }


def build_conviction(src: dict) -> dict:
    c = src.get("conviction") or {}
    size = c.get("size") or {}
    return {
        "score": c.get("score"),
        "band": c.get("band_en") or c.get("band"),
        "band_zh": c.get("band_zh"),
        "drivers": c.get("drivers") or [],
        "cautions": c.get("cautions") or [],
        "cautions_zh": c.get("cautions_zh") or [],
        "size_bucket": size.get("bucket"), "size_pct": size.get("pct"), "size_note": size.get("note"),
        "rank_pctile": None, "potential": None,
    }


def build_entry(src: dict):
    e = src.get("entry_signal") or {}
    if not e:
        return None
    tim = e.get("timing") or {}
    cyc = e.get("cycle_pos") or {}
    return {
        "status": e.get("status"), "urgency": e.get("urgency"),
        "headline": e.get("headline"), "headline_zh": e.get("headline_zh"),
        "action": e.get("action"), "action_zh": e.get("action_zh"),
        "grade": e.get("entry_grade"), "confidence": e.get("confidence"),
        "horizon": e.get("horizon"),
        "buy_zone": e.get("buy_zone"), "chase_above": e.get("chase_above"),
        "stop": e.get("stop"), "spot": e.get("spot"), "atr_pct": e.get("atr_pct"),
        "cycle": ({"dc_day": cyc.get("dc_day"), "dc_band": cyc.get("dc_band"),
                   "pct_through": cyc.get("pct_through"), "phase": cyc.get("phase")} if cyc else None),
        "opens_lo": tim.get("opens_in_days_lo"), "opens_hi": tim.get("opens_in_days_hi"),
        "next_trigger": tim.get("next_trigger"),
    }


def build_valuation(src: dict, vrow: dict | None = None):
    fv = g(src, "fundamentals", "valuation") or {}
    vp = src.get("val_pctile") or {}

    def cheap(key):
        p = g(vp, key, "pctile")
        return None if p is None else round(100 - float(p), 0)  # inline pctile is 0-100; low == cheap

    ratios = []
    if fv.get("pe") is not None:
        ratios.append({"label": "P/E", "v": fv.get("pe"), "med": fv.get("pe_sector_med"), "cheap": cheap("pe")})
    if fv.get("pb") is not None:
        ratios.append({"label": "P/B", "v": fv.get("pb"), "med": fv.get("pb_sector_med"), "cheap": cheap("pb")})
    if fv.get("ps") is not None:
        ratios.append({"label": "P/S", "v": fv.get("ps"), "med": fv.get("ps_sector_med"), "cheap": None})
    if fv.get("div_yield") is not None:
        ratios.append({"label": "Div yield", "v": fv.get("div_yield"), "med": fv.get("div_yield_sector_med"), "cheap": None})

    # coverage fallback: ~half of A-share site JSONs lack an inline fundamentals block. When they do,
    # fill the valuation card from the daily_basic snapshot (valuation.parquet) we already collect.
    if not ratios and vrow:
        def pcheap(p):  # daily_basic percentile scale is inconsistent (0-1 or 0-100); normalize + clamp
            if p is None:
                return None
            frac = float(p)
            frac = frac / 100.0 if frac > 1 else frac
            frac = max(0.0, min(1.0, frac))
            return round(100 * (1 - frac), 0)   # low valuation percentile == cheap == high meter
        pe = vrow.get("pe_ttm") if vrow.get("pe_ttm") is not None else vrow.get("pe")
        if pe is not None:
            ratios.append({"label": "P/E", "v": round(pe, 2), "med": None, "cheap": pcheap(vrow.get("pe_pctile"))})
        if vrow.get("pb") is not None:
            ratios.append({"label": "P/B", "v": round(vrow["pb"], 2), "med": None, "cheap": pcheap(vrow.get("pb_pctile"))})
        if vrow.get("ps_ttm") is not None:
            ratios.append({"label": "P/S", "v": round(vrow["ps_ttm"], 2), "med": None, "cheap": None})
        if vrow.get("dv_ttm") is not None:
            ratios.append({"label": "Div yield", "v": round(vrow["dv_ttm"], 2), "med": None, "cheap": None})

    if not ratios:
        return None
    fwd = g(src, "consensus", "fwd_pe_fy1") or g(src, "fundamentals", "consensus", "fwd_pe_fy1")
    return {"ratios": ratios, "forward_pe": fwd, "value_z": None, "forward_tier": None}


def build_financials(src: dict, frow=None):
    fu = src.get("fundamentals") or {}
    fin = fu.get("financials") or {}
    q = fu.get("quality") or fu.get("valuation") or {}   # HK -> quality, CN -> valuation
    gm_list = fin.get("gross_margin")
    latest_gm = gm_list[-1] if isinstance(gm_list, list) and gm_list else q.get("gross_margin")
    fcf_margin = None
    try:
        if fin.get("fcf") and fin.get("revenue") and fin["revenue"][-1]:
            fcf_margin = round(fin["fcf"][-1] / fin["revenue"][-1] * 100, 1)
    except Exception:
        pass
    multiyear = ({
        "years": fin.get("years"), "revenue": fin.get("revenue"),
        "net_margin": fin.get("net_margin"), "eps": fin.get("eps"), "fcf": fin.get("fcf"),
        "rev_cagr": fin.get("rev_cagr"), "eps_cagr": fin.get("eps_cagr"),
        "piotroski": g(fu, "piotroski", "score"), "altman": g(fu, "altman", "z"),
    } if fin else None)
    rev_growth = q.get("rev_growth")
    if rev_growth is None:   # HK 'quality' has no YoY growth — derive it from the revenue series
        rev = fin.get("revenue")
        try:
            if isinstance(rev, list) and len(rev) >= 2 and rev[-2]:
                rev_growth = round((rev[-1] / rev[-2] - 1) * 100, 1)
        except Exception:
            pass
    out = {
        "gross_margin": latest_gm, "net_margin": q.get("net_margin"), "fcf_margin": fcf_margin,
        "roe": q.get("roe"), "roa": q.get("roa"),
        "rev_growth": rev_growth, "ni_growth": q.get("ni_growth"),
        "debt_to_assets": q.get("debt_ratio"), "multiyear": multiyear,
    }
    if out["net_margin"] is not None or multiyear:
        return out
    # coverage fallback: fina_indicator/income parquet for A-share names without an inline block
    if frow:
        yrs = frow.get("years")
        my = ({"years": yrs, "revenue": frow.get("revenue"), "eps": frow.get("eps"),
               "net_margin": frow.get("net_margin_series"), "fcf": None,
               "rev_cagr": frow.get("rev_cagr"), "eps_cagr": frow.get("eps_cagr"),
               "piotroski": None, "altman": None} if yrs else None)
        gms = frow.get("gross_margin_series")
        fb = {
            "gross_margin": frow.get("gross_margin") if frow.get("gross_margin") is not None else (gms[-1] if gms else None),
            "net_margin": frow.get("net_margin"), "fcf_margin": None,
            "roe": frow.get("roe"), "roa": None,
            "rev_growth": frow.get("rev_growth"), "ni_growth": frow.get("ni_growth"),
            "debt_to_assets": frow.get("debt_to_assets"), "multiyear": my,
        }
        if fb["net_margin"] is not None or my:
            return fb
    return None


def build_profile(src: dict, market: str):
    fu = src.get("fundamentals") or {}
    if market == "HK":
        p = fu.get("profile") or {}
        desc = p.get("description")
        sector = src.get("sector") or p.get("industry")
    else:
        d = fu.get("description")
        desc = d.get("main_business") if isinstance(d, dict) else d
        sector = src.get("sector")
    return {
        "sector": sector, "mktcap_bn": None, "mktcap_tier": None, "mktcap_tier_zh": None,
        "archetype": fu.get("archetype_label"), "archetype_zh": fu.get("archetype_label_zh"),
        "archetype_why": None, "archetype_why_zh": None,
        "description": desc, "description_zh": desc,   # source text is Chinese for both markets
    }


def build_analyst(src: dict):
    cons = src.get("consensus") or g(src, "fundamentals", "consensus") or {}
    earn = src.get("earnings") or {}
    div = g(src, "fundamentals", "valuation", "div_yield")
    if not cons and not earn:
        return None
    # derive a rating label from the buy/hold/sell split when the source has counts but no label (HK)
    rating = cons.get("rating")
    rating_zh = cons.get("rating_zh")
    if not rating:
        b, h, s = cons.get("buy") or 0, cons.get("hold") or 0, cons.get("sell") or 0
        if b + h + s > 0:
            if b >= h and b >= s and b > s:
                rating, rating_zh = "Buy", "买入"
            elif s > b and s >= h:
                rating, rating_zh = "Sell", "卖出"
            else:
                rating, rating_zh = "Hold", "持有"
    return {
        "next_date": earn.get("next_date"), "last_date": earn.get("last_date"),
        "rating": rating, "rating_zh": rating_zh,
        "n_analysts": cons.get("n_analysts") if cons.get("n_analysts") is not None else cons.get("reports"),
        "buy": cons.get("buy"), "hold": cons.get("hold"), "sell": cons.get("sell"),
        "eps_forecast": cons.get("eps_fy1"), "forward_pe": cons.get("fwd_pe_fy1"),
        "target": cons.get("target_med"), "target_low": cons.get("target_low"),
        "target_high": cons.get("target_high"), "upside_pct": cons.get("upside_pct"),
        "div_yield": div,
        "beats": None, "total": None, "avg_surprise": None, "sue_z": None, "surprises": None,
    }


def build_flows(src: dict, market: str, lrow=None):
    if market == "HK":
        sb = src.get("southbound") or {}
        if not sb:
            return None
        return {"kind": "southbound", "own_pct": sb.get("own_pct"), "chg5_pct": sb.get("chg5_pct"),
                "hold_b": sb.get("hold_b"), "label": sb.get("label"), "accum_z": sb.get("accum_z")}
    pos = src.get("positioning") or {}
    lrow = lrow or {}
    fin_bal = pos.get("fin_balance_yi")
    lhb_ct = lrow.get("lhb_count") or 0
    blk_ct = lrow.get("block_count") or 0
    if fin_bal is None and not lhb_ct and not blk_ct:
        return None
    return {
        "kind": "margin", "fin_balance_yi": fin_bal,
        "chg_pct": pos.get("chg_pct"), "pct_mcap": pos.get("pct_mcap"),
        # 龙虎榜 (dragon-tiger) + 大宗交易 (block trades), last ~45 sessions
        # top_list net_amount is in 元 (→亿 = /1e8); block_trade amount is in 万元 (→亿 = /1e4)
        "lhb_count": lhb_ct or None, "lhb_net_yi": (round(lrow["lhb_net"] / 1e8, 2) if lrow.get("lhb_net") else None),
        "block_count": blk_ct or None, "block_amount_yi": (round(lrow["block_amount"] / 1e4, 2) if lrow.get("block_amount") else None),
    }


# ── ai_lean mapping ────────────────────────────────────────────────────────────
# Same table as pull_macro_intel._map_ai_dir (the canonical band×entry mapping —
# tests/test_cn_hk_tape.py pins the two implementations together). Inlined rather
# than imported because this bridge is deliberately stdlib-only (pull_macro_intel
# pulls in build_polygon_universe at import, which the launchd cnhk lane must not).
# The legacy tone read survives only as the no-band fallback: older/lite site JSONs
# without view.decision.band keep their previous lean instead of going blank.
_BUY_ENTRIES = frozenset({"buy_now", "buy_soon", "partial"})
_EXIT_ENTRIES = frozenset({"exit", "topping"})


def _map_ai_dir(band, entry_status, tone) -> str:
    b = (band or "").lower().strip()
    e = (entry_status or "").lower().strip()
    if not b:
        return "BULL" if tone == "go" else "BEAR" if tone in ("avoid", "stop", "sell") else "NEUTRAL"
    if b == "low" or e in _EXIT_ENTRIES:
        return "BEAR"
    if b in ("high", "constructive") and e in _BUY_ENTRIES:
        return "BULL"
    return "NEUTRAL"


def build_tape(src: dict, decision: dict) -> dict:
    tone = (decision.get("tone") or "").lower()
    band = decision.get("band")
    entry_status = g(src, "entry_signal", "status")
    score = g(src, "conviction", "score")
    ai_dir = _map_ai_dir(band, entry_status, tone)
    # consistency guard (parity with pull_macro_intel): a lean that contradicts its
    # own conviction score demotes to NEUTRAL rather than lying.
    if ai_dir == "BULL" and isinstance(score, (int, float)) and score < 55:
        ai_dir = "NEUTRAL"
    if ai_dir == "BEAR" and isinstance(score, (int, float)) and score > 65:
        ai_dir = "NEUTRAL"
    return {
        "ai_lean": {"dir": ai_dir, "score": score,
                    "band": (band or None), "entry": (entry_status or None)},
        "asof": src.get("asof"),
        "conviction": score,
        "regime": g(src, "ladder", "regime_label"),
        "gex_flip": None, "call_wall": None, "put_wall": None, "short_pct": None,
    }


def load_valuation_map() -> dict:
    """ticker(.SS/.SZ) -> daily_basic snapshot row, from valuation.parquet. {} if pandas/parquet absent.
    Used only as a coverage fallback for A-share names whose site JSON has no inline fundamentals."""
    try:
        import pandas as pd  # noqa: PLC0415
    except Exception:
        return {}
    p = MACRO / "data" / "tushare" / "valuation.parquet"
    if not p.exists():
        return {}
    try:
        df = pd.read_parquet(p)
    except Exception:
        return {}
    cols = ("pe", "pe_ttm", "pb", "ps_ttm", "dv_ttm", "total_mv_yi", "pe_pctile", "pb_pctile")
    out: dict = {}
    for r in df.to_dict("records"):
        tk = str(r.get("ticker") or "")
        if not tk:
            continue
        sym = tk[:-3] + ".SS" if tk.endswith(".SH") else tk   # Tushare .SH → terminal .SS
        row = {}
        for k in cols:
            v = r.get(k)
            row[k] = None if v is None or (isinstance(v, float) and v != v) else float(v)
        out[sym] = row
    return out


def _read_parquet(name: str):
    """Return a DataFrame for data/tushare/<name>, or None if pandas/parquet unavailable."""
    try:
        import pandas as pd  # noqa: PLC0415
    except Exception:
        return None
    p = MACRO / "data" / "tushare" / name
    if not p.exists():
        return None
    try:
        return pd.read_parquet(p)
    except Exception:
        return None


def _norm_code(tk: str) -> str:
    return tk[:-3] + ".SS" if tk.endswith(".SH") else tk   # Tushare .SH → terminal .SS


def _flist(v):
    """numpy array / list → plain python list with NaN→None; None if absent."""
    if v is None:
        return None
    try:
        return [None if (x is None or (isinstance(x, float) and x != x)) else float(x) for x in list(v)]
    except Exception:
        return None


def _fval(v):
    return None if v is None or (isinstance(v, float) and v != v) else float(v)


def load_financials_map() -> dict:
    """ticker(.SS/.SZ) -> financials row (margins/roe/growth + multiyear series) from financials.parquet.
    Coverage fallback for A-share names whose site JSON has no inline fundamentals block."""
    df = _read_parquet("financials.parquet")
    if df is None:
        return {}
    out: dict = {}
    for r in df.to_dict("records"):
        code = str(r.get("ts_code") or "")
        if not code:
            continue
        yrs = r.get("years")
        out[_norm_code(code)] = {
            "years": [int(x) for x in list(yrs)] if yrs is not None and len(list(yrs)) else None,
            "revenue": _flist(r.get("revenue")), "eps": _flist(r.get("eps")),
            "net_margin_series": _flist(r.get("net_margin_series")),
            "gross_margin_series": _flist(r.get("gross_margin_series")),
            "roe": _fval(r.get("roe")), "net_margin": _fval(r.get("net_margin")),
            "gross_margin": _fval(r.get("gross_margin")), "debt_to_assets": _fval(r.get("debt_to_assets")),
            "rev_growth": _fval(r.get("rev_growth")), "ni_growth": _fval(r.get("ni_growth")),
            "rev_cagr": _fval(r.get("rev_cagr")), "eps_cagr": _fval(r.get("eps_cagr")),
        }
    return out


def load_holders_map() -> dict:
    """ticker(.SS/.SZ) -> [{name,ratio,change,type}] top float holders, from holders.parquet."""
    df = _read_parquet("holders.parquet")
    if df is None or "holders_json" not in getattr(df, "columns", []):
        return {}
    out: dict = {}
    for r in df.to_dict("records"):
        code = str(r.get("ts_code") or "")
        if not code:
            continue
        try:
            hl = json.loads(r.get("holders_json") or "[]")
        except Exception:
            hl = []
        if hl:
            out[_norm_code(code)] = hl
    return out


def load_lhb_map() -> dict:
    """ticker(.SS/.SZ) -> 龙虎榜 count/net + 大宗交易 count/amount, from lhb.parquet."""
    df = _read_parquet("lhb.parquet")
    if df is None:
        return {}
    out: dict = {}
    for r in df.to_dict("records"):
        code = str(r.get("ts_code") or "")
        if not code:
            continue
        out[_norm_code(code)] = {
            "lhb_count": int(r["lhb_count"]) if r.get("lhb_count") is not None else 0,
            "lhb_net": _fval(r.get("lhb_net")), "block_count": int(r["block_count"]) if r.get("block_count") is not None else 0,
            "block_amount": _fval(r.get("block_amount")),
        }
    return out


def build_smart_money(hrow, lrow):
    """CN smart-money card: named top float holders (13F-analogue) + 龙虎榜 institutional-flow context."""
    if not hrow:
        return None
    holders = []
    n_buy = n_sell = 0
    for h in hrow[:6]:
        chg = h.get("change")
        action = None
        if chg is not None:
            if chg > 0:
                action, n_buy = "add", n_buy + 1
            elif chg < 0:
                action, n_sell = "trim", n_sell + 1
            else:
                action = "hold"
        holders.append({"fund": h.get("name"), "action": action, "grade": None,
                        "pct_portfolio": h.get("ratio"), "value_usd": None})
    net = (lrow or {}).get("lhb_net")
    trend = ("accumulating" if n_buy > n_sell else "distributing" if n_sell > n_buy else "steady")
    return {"holders": holders, "n_holders": len(holders), "is_vip": bool((lrow or {}).get("lhb_count")),
            "n_buying": n_buy, "n_selling": n_sell, "trend": trend, "lhb_net": net}


def load_hk_deep_map() -> dict:
    """ticker(.HK) -> {financials, profile, forecast} akshare payload, from hk_deep.parquet
    (collected by collect_hk_deep.py for HK names without a Macro Dashboard site JSON)."""
    df = _read_parquet("hk_deep.parquet")
    if df is None or "payload" not in getattr(df, "columns", []):
        return {}
    out: dict = {}
    for r in df.to_dict("records"):
        t = str(r.get("ticker") or "")
        if not t:
            continue
        try:
            out[t] = json.loads(r.get("payload") or "{}")
        except Exception:
            pass
    return out


def load_southbound_map() -> dict:
    """ticker(.HK) -> latest 港股通 southbound holdings row, from data/hk_southbound/holdings.parquet."""
    try:
        import pandas as pd  # noqa: PLC0415
    except Exception:
        return {}
    p = MACRO / "data" / "hk_southbound" / "holdings.parquet"
    if not p.exists():
        return {}
    try:
        sb = pd.read_parquet(p)
        last = max(d for d, _ in sb.index)   # index = (date, code)
        xs = sb.xs(last, level=0)
    except Exception:
        return {}
    out: dict = {}
    for code, row in xs.iterrows():
        out[str(code)] = {k: _fval(v) if isinstance(v, (int, float)) else v for k, v in row.to_dict().items()}
    return out


def _ema(vals, n):
    k = 2 / (n + 1)
    e = vals[0]
    for v in vals[1:]:
        e = v * k + e * (1 - k)
    return e


def _compute_tech(bars) -> dict | None:
    """Technical read computed directly from Terminal OHLC (for HK names with no engine coverage)."""
    if not bars or len(bars) < 30:
        return None
    closes = [float(b[4]) for b in bars]
    highs = [float(b[2]) for b in bars]
    last = closes[-1]

    def sma(n):
        return sum(closes[-n:]) / n if len(closes) >= n else None

    def ret(n):
        return round((last / closes[-1 - n] - 1) * 100, 1) if len(closes) > n else None

    sma50, sma200 = sma(50), sma(200)
    rsi = None
    if len(closes) > 15:
        d = [closes[i] - closes[i - 1] for i in range(1, len(closes))][-14:]
        gain = sum(x for x in d if x > 0) / 14
        loss = -sum(x for x in d if x < 0) / 14
        rs = gain / loss if loss else (99 if gain else 1)
        rsi = round(100 - 100 / (1 + rs), 0)
    macd_pos = (_ema(closes[-60:], 12) - _ema(closes[-60:], 26)) > 0 if len(closes) >= 26 else None
    hi52 = max(highs[-252:]) if highs else None
    return {
        "price": round(last, 3),
        "above50": (last > sma50) if sma50 else None,
        "above200": (last > sma200) if sma200 else None,
        "golden": (sma50 > sma200) if (sma50 and sma200) else None,
        "macd_pos": macd_pos, "rsi14": rsi,
        "pct_vs_50dma": round((last / sma50 - 1) * 100, 1) if sma50 else None,
        "pct_vs_200dma": round((last / sma200 - 1) * 100, 1) if sma200 else None,
        "off_52w_high_pct": round((last / hi52 - 1) * 100, 1) if hi52 else None,
        "ret_1m": ret(21), "ret_3m": ret(63), "ret_6m": ret(126), "ret_12m": ret(252),
    }


def _cagr(series):
    vals = [(i, v) for i, v in enumerate(series) if v is not None and v > 0]
    if len(vals) < 2:
        return None
    (i0, v0), (i1, v1) = vals[0], vals[-1]
    return round(((v1 / v0) ** (1 / (i1 - i0)) - 1) * 100, 1) if i1 > i0 else None


def build_hk_lite(sym: str, bars, drow, sbrow) -> dict:
    """Lite HK panel for names with a chart but no site JSON: computed tech + technical decision +
    akshare financials/analyst/profile (drow) + 港股通 southbound (sbrow). No engine conviction."""
    tech = _compute_tech(bars)
    last = tech["price"] if tech else (float(bars[-1][4]) if bars else None)
    a200 = tech.get("above200") if tech else None
    a50 = tech.get("above50") if tech else None
    if a200 and a50:
        verb, verb_zh, tone, hl, hlz = "Uptrend", "上升趋势", "go", "Uptrend — above the 200-day", "上升趋势——位于200日均线上方"
    elif tech and a200 is False and a50 is False:
        verb, verb_zh, tone, hl, hlz = "Downtrend", "下降趋势", "avoid", "Downtrend — below the 200-day", "下降趋势——位于200日均线下方"
    else:
        verb, verb_zh, tone, hl, hlz = "Neutral", "中性", "wait", "Range — mixed trend", "震荡——趋势不明"
    score = None
    drivers, cautions = [], []
    if tech:
        sc = 50 + (18 if a200 else -18) + (10 if a50 else -6) + (8 if tech.get("golden") else 0) + (8 if tech.get("macd_pos") else 0)
        r = tech.get("rsi14")
        sc += 6 if (r is not None and 45 <= r <= 70) else 0
        sc += 6 if (tech.get("ret_3m") or 0) > 0 else 0
        score = max(2, min(98, round(sc)))
        drivers.append("above 200-day") if a200 else cautions.append("below 200-day")
        if tech.get("golden"):
            drivers.append("golden cross")
        if tech.get("macd_pos"):
            drivers.append("MACD positive")
        if r is not None and r > 75:
            cautions.append("RSI overbought")
        elif r is not None and r < 25:
            drivers.append("RSI oversold")
    decision = {
        "verb": verb, "verb_zh": verb_zh, "tone": tone, "headline": hl, "headline_zh": hlz,
        "gloss": None, "gloss_zh": None, "band": None, "band_label": "Technical", "band_label_zh": "技术面",
        "name_label": None, "name_label_zh": None, "score": score, "trust_tier": "technical",
        "trust_en": "Price-action read — full research-desk coverage pending for this HK name.",
        "trust_zh": "价格行为解读——该港股尚未纳入完整研究台覆盖。",
    }
    conviction = {"score": score, "band": "Technical", "band_zh": "技术面", "drivers": drivers,
                  "cautions": cautions, "cautions_zh": None, "size_bucket": None, "size_pct": None,
                  "size_note": None, "rank_pctile": None, "potential": None}

    fin = prof = analyst = val = None
    name = None
    if drow:
        v = drow.get("valuation") or {}
        vr = []
        if v.get("pe"):
            vr.append({"label": "P/E", "v": v["pe"], "med": None, "cheap": None})
        if v.get("pb"):
            vr.append({"label": "P/B", "v": v["pb"], "med": None, "cheap": None})
        if v.get("div_yield"):
            vr.append({"label": "Div yield", "v": v["div_yield"], "med": None, "cheap": None})
        if vr:
            val = {"ratios": vr, "forward_pe": None, "value_z": None, "forward_tier": None}
        rows = sorted(drow.get("financials") or [], key=lambda x: x.get("fy") or 0)
        if rows:
            latest = rows[-1]
            years = [x.get("fy") for x in rows]
            revenue = [x.get("revenue") for x in rows]
            eps = [x.get("eps") for x in rows]
            nm = [x.get("net_margin") for x in rows]
            fin = {"gross_margin": latest.get("gross_margin"), "net_margin": latest.get("net_margin"),
                   "fcf_margin": None, "roe": latest.get("roe"), "roa": latest.get("roa"),
                   "rev_growth": latest.get("rev_growth"), "ni_growth": latest.get("ni_growth"),
                   "debt_to_assets": latest.get("debt_ratio"),
                   "multiyear": {"years": years, "revenue": revenue, "eps": eps, "net_margin": nm, "fcf": None,
                                 "rev_cagr": _cagr(revenue), "eps_cagr": _cagr(eps), "piotroski": None, "altman": None}}
        p = drow.get("profile") or {}
        if p:
            name = p.get("name_full")
            prof = {"sector": p.get("industry"), "mktcap_bn": None, "mktcap_tier": None, "mktcap_tier_zh": None,
                    "archetype": None, "archetype_zh": None, "archetype_why": None, "archetype_why_zh": None,
                    "description": p.get("description"), "description_zh": p.get("description")}
        fc = drow.get("forecast") or {}
        if fc:
            b, h, s = fc.get("buy") or 0, fc.get("hold") or 0, fc.get("sell") or 0
            rating = rating_zh = None
            if b + h + s > 0:
                if b >= h and b > s:
                    rating, rating_zh = "Buy", "买入"
                elif s > b and s >= h:
                    rating, rating_zh = "Sell", "卖出"
                else:
                    rating, rating_zh = "Hold", "持有"
            tgt = fc.get("target_med")
            analyst = {"next_date": None, "last_date": None, "rating": rating, "rating_zh": rating_zh,
                       "n_analysts": fc.get("n_analysts"), "buy": b, "hold": h, "sell": s,
                       "eps_forecast": None, "forward_pe": None, "target": tgt, "target_low": fc.get("target_low"),
                       "target_high": fc.get("target_high"),
                       "upside_pct": (round((tgt - last) / last * 100, 1) if (tgt and last) else None),
                       "div_yield": None, "beats": None, "total": None, "avg_surprise": None,
                       "sue_z": None, "surprises": None}

    flows = None
    if sbrow:
        hm = sbrow.get("hold_mktcap")
        cp = round(sbrow["chg5_v"] / hm * 100, 1) if (sbrow.get("chg5_v") is not None and hm) else None
        flows = {"kind": "southbound", "own_pct": sbrow.get("own_pct"), "chg5_pct": cp,
                 "hold_b": round(hm / 1e9, 1) if hm else None,
                 "label": ("accumulating" if (cp or 0) > 2 else "distributing" if (cp or 0) < -2 else "steady"),
                 "accum_z": round(sbrow["add_amp"], 2) if sbrow.get("add_amp") is not None else None}

    analysis = {"decision": decision, "conviction": conviction, "entry": None, "factors": None, "tech": tech,
                "valuation": val, "financials": fin, "profile": prof, "smart_money": None, "analyst": analyst,
                "flows": flows, "gex": None, "macro": None}
    return {
        "schema": "intel/v1", "ticker": sym, "asof": None, "name": name,
        "sector": (prof or {}).get("sector"), "market": "HK", "lite": True,
        "tape": build_tape({}, decision),
        "cards": {"ai_judgment": {"verdict": hl, "gloss": None, "size_pct": None},
                  "conviction": {"score": score, "band": "Technical", "drivers": drivers, "cautions": cautions},
                  "analyst": analyst, "flows": flows},
        "analysis": analysis,
    }


def build_intel(sym: str, src: dict, market: str, vrow=None, frow=None, hrow=None, lrow=None) -> dict:
    analysis = {
        "decision": build_decision(src),
        "conviction": build_conviction(src),
        "entry": build_entry(src),
        "factors": None,
        "tech": src.get("tech"),
        "valuation": build_valuation(src, vrow),
        "financials": build_financials(src, frow),
        "profile": build_profile(src, market),
        "smart_money": build_smart_money(hrow, lrow) if market == "CN" else None,
        "analyst": build_analyst(src),
        "flows": build_flows(src, market, lrow),
        "gex": None, "macro": None,
    }
    dec = analysis["decision"]
    conv = analysis["conviction"]
    return {
        "schema": "intel/v1", "ticker": sym, "asof": src.get("asof"),
        "name": src.get("name"), "sector": src.get("sector"), "market": market,
        "tape": build_tape(src, dec),
        "cards": {
            "ai_judgment": {"verdict": dec.get("headline"), "gloss": dec.get("gloss"), "size_pct": conv.get("size_pct")},
            "conviction": {"score": conv.get("score"), "band": conv.get("band"),
                           "drivers": conv.get("drivers"), "cautions": conv.get("cautions")},
            "analyst": analysis["analyst"], "flows": analysis["flows"],
        },
        "analysis": analysis,
    }


def market_of(name: str) -> str | None:
    if name.endswith((".SS.json", ".SZ.json")):
        return "CN"
    if name.endswith(".HK.json"):
        return "HK"
    return None


def main(syms: list[str], *, market="all", out_dir=None) -> None:
    target = Path(out_dir) if out_dir else OUT
    target.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    if syms:
        for s in syms:
            for d in (CN_DIR, HK_DIR):
                p = d / f"{s}.json"
                if p.exists():
                    files.append(p)
    else:
        files = sorted(CN_DIR.glob("*.json")) + sorted(HK_DIR.glob("*.json"))

    files = [path for path in files if market == "all" or (market_of(path.name) or "").lower() == market]
    vmap = load_valuation_map()
    fmap = load_financials_map()
    hmap = load_holders_map()
    lmap = load_lhb_map()
    print(f"parquet joins — valuation {len(vmap)}, financials {len(fmap)}, holders {len(hmap)}, lhb {len(lmap)}")
    ok = skip = err = vfill = ffill = smfill = 0
    by_mkt = {"CN": 0, "HK": 0}
    covered: set[str] = set()
    for jf in files:
        mkt = market_of(jf.name)
        if mkt is None:
            skip += 1
            continue
        sym = jf.name[:-5]
        try:
            src = json.loads(jf.read_text())
            had_val = bool(g(src, "fundamentals", "valuation"))
            had_fin = bool(g(src, "fundamentals", "financials"))
            intel = build_intel(sym, src, mkt, vmap.get(sym), fmap.get(sym), hmap.get(sym), lmap.get(sym))
            a = intel["analysis"]
            if not had_val and a.get("valuation"):
                vfill += 1
            if not had_fin and a.get("financials"):
                ffill += 1
            if a.get("smart_money"):
                smfill += 1
            (target / f"{sym}.intel.json").write_text(json.dumps(intel, separators=(",", ":"), ensure_ascii=False))
            ok += 1
            by_mkt[mkt] += 1
            covered.add(sym)
        except Exception as exc:  # noqa: BLE001
            err += 1
            if err <= 20:
                print(f"  ERR {sym}: {exc}")
    print(f"\nCN/HK intel: {ok} written ({by_mkt}), {skip} skipped, {err} errors")
    print(f"  parquet-filled: valuation +{vfill}, financials +{ffill}, smart-money {smfill} names")

    # HK coverage widening — a lite panel (computed tech + akshare financials/analyst + southbound) for
    # every HK name that has a Terminal OHLC chart but no Macro Dashboard site JSON (build_hk_library's
    # curated universe leaves ~345 uncovered). Skipped automatically when its inputs aren't present.
    if not syms and market in ("all", "hk"):   # only on a full HK run
        hk_deep = load_hk_deep_map()
        sbmap = load_southbound_map()
        hk_lite = 0
        for jf in sorted(OUT.glob("*.HK.json")):
            sym = jf.name[:-5]
            if sym in covered or sym.startswith("_"):
                continue
            try:
                bars = json.loads(jf.read_text()).get("bars") or []
                if len(bars) < 30:
                    continue
                intel = build_hk_lite(sym, bars, hk_deep.get(sym), sbmap.get(sym))
                (target / f"{sym}.intel.json").write_text(json.dumps(intel, separators=(",", ":"), ensure_ascii=False))
                hk_lite += 1
            except Exception as exc:  # noqa: BLE001
                err += 1
                if err <= 20:
                    print(f"  ERR lite {sym}: {exc}")
        print(f"  HK lite panels (uncovered names): +{hk_lite}  (hk_deep {len(hk_deep)}, southbound {len(sbmap)})")
    if err:
        raise SystemExit(1)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", choices=("all", "cn", "hk"), default="all")
    parser.add_argument("--out")
    parser.add_argument("symbols", nargs="*")
    args = parser.parse_args()
    main(args.symbols, market=args.market, out_dir=args.out)
