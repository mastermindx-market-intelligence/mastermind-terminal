"""Build the terminal's market data from Polygon (backtesting feed).

For each symbol: fetch daily bars → write the OHLC contract; run the user's faithful
confluence signal + Tier-1 backtest → write the model-sliced indicator+backtest
contracts; and roll a `manifest.json` (last price, % change, Golden-Oracle verdict,
WR/PF/CAGR, regime) so the terminal renders REAL prices + per-symbol verdicts.

Usage:  POLYGON_API_KEY=… python ingest/build_polygon_universe.py [SYM ...]
Outputs into terminal/public/data/ (served by the Next app at /data/*).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.polygon_bars import fetch_daily, ohlc_json   # noqa: E402
from ingest.session_anchor import stamp as stamp_session_anchor  # noqa: E402
from ingest.slice_document import write_slice_preserving_siblings  # noqa: E402
from signal_layer import confluence, contracts, backtest  # noqa: E402
from signal_layer.confluence_v2 import reclaim_eligible  # noqa: E402

OUT = Path(os.environ.get("TERMINAL_DATA_DIR") or (ROOT / "terminal" / "public" / "data"))
MANIFEST = Path(os.environ.get("TERMINAL_MANIFEST") or (OUT / "manifest.json"))


def _deep_ohlc(sym: str, poly_bars: list) -> tuple[list, str]:
    """Full-history daily bars for the chart <SYM>.json. Polygon's REST aggregates cap at
    ~5y on this key, so the flagship charts were stuck at ~1,250 bars. Fetch yfinance
    period=max (split/div adjusted, back to IPO) and keep it when it's deeper; if Yahoo is
    thin/rate-limited this run, reuse an already-deep existing file rather than SHRINKING it
    (the whole point — the nightly used to clobber deep files back to 5y); only fall back to
    the ~5y Polygon window as a last resort. The signal/backtest math still runs on the
    Polygon `poly_bars` with the IPO anchor, so flagship confluence stays byte-identical —
    this deepens ONLY the displayed chart series."""
    try:
        import yfinance as yf
        yt = sym if sym.endswith((".HK", ".TO", ".SS", ".SZ")) else sym.replace(".", "-")
        df = yf.Ticker(yt).history(period="max", auto_adjust=True)
        if df is not None and not df.empty:
            # NaN prices would serialize as bare NaN tokens (invalid JSON for the browser);
            # NaN volume is truthy, so int(v or 0) raises and abandons the whole deep fetch.
            df = df.dropna(subset=["Open", "High", "Low", "Close"])
        rows = ([[idx.strftime("%Y-%m-%d"), round(float(r["Open"]), 4), round(float(r["High"]), 4),
                  round(float(r["Low"]), 4), round(float(r["Close"]), 4),
                  int(r["Volume"]) if pd.notna(r.get("Volume")) else 0]
                 for idx, r in df.iterrows()] if df is not None and not df.empty else [])
        if len(rows) > len(poly_bars):
            return rows, "yahoo"
    except Exception:
        pass
    try:
        prev = json.loads((OUT / f"{sym}.json").read_text()).get("bars") or []
        if len(prev) > len(poly_bars):
            return prev, "yahoo"
    except Exception:
        pass
    return poly_bars, "polygon"

META = {
    "NVDA": ("NVIDIA Corp", "Equities", "#76b900"),
    "AAPL": ("Apple Inc", "Equities", "#a2aaad"),
    "MSFT": ("Microsoft Corp", "Equities", "#3b82f6"),
    "GOOGL": ("Alphabet Inc", "Equities", "#4285f4"),
    "AMZN": ("Amazon.com", "Equities", "#ff9900"),
    "META": ("Meta Platforms", "Equities", "#0668e1"),
    "TSLA": ("Tesla Inc", "Equities", "#e82127"),
    "AMD": ("Advanced Micro Devices", "Equities", "#ed1c24"),
    "AVGO": ("Broadcom Inc", "Equities", "#cc0000"),
    "NFLX": ("Netflix Inc", "Equities", "#e50914"),
    "CRM": ("Salesforce Inc", "Equities", "#00a1e0"),
    "SMCI": ("Super Micro Computer", "Equities", "#7cb342"),
    "ARM": ("Arm Holdings", "Equities", "#0091bd"),
    "PLTR": ("Palantir Technologies", "Equities", "#101113"),
    "MSTR": ("MicroStrategy", "Equities", "#f7931a"),
    "MU": ("Micron Technology", "Equities", "#0033a0"),
    "INTC": ("Intel Corp", "Equities", "#0071c5"),
    "COIN": ("Coinbase Global", "Equities", "#0052ff"),
    "JPM": ("JPMorgan Chase", "Equities", "#1a3c6e"),
    "V": ("Visa Inc", "Equities", "#1a1f71"),
    "XOM": ("Exxon Mobil", "Equities", "#e31837"),
    "LLY": ("Eli Lilly", "Equities", "#d52b1e"),
    "COST": ("Costco Wholesale", "Equities", "#005daa"),
    # Chinese ADRs (US-listed). Polygon types them ADRC, not CS, so expand_universe's
    # type=CS filter never adds them, and the macro store has no ADRs either — carry them
    # here so they get flagship OHLC/slice/verdict and survive the nightly manifest rebuild.
    "BABA": ("Alibaba Group", "Equities", "#ff6a00"),
    "JD": ("JD.com", "Equities", "#d92332"),
    "PDD": ("PDD Holdings", "Equities", "#e60012"),
    # ── ETFs ──────────────────────────────────────────────────────────────────
    # Polygon types ETFs as "ETF", not CS/ADRC, so expand_universe/build_universe's
    # type=CS+ADRC fetch never adds them — carry the curated liquid set here so they get
    # flagship OHLC/slice/verdict and stay searchable through the nightly manifest rebuild.
    # (Fundamentals/intel/insider gracefully absent for funds — the UI already handles that.)
    "SPY": ("SPDR S&P 500 ETF", "Funds", "#1f8a4c"),
    "QQQ": ("Invesco QQQ Trust", "Funds", "#4d82ff"),
    "IWM": ("iShares Russell 2000", "Funds", "#6f42c1"),
    "DIA": ("SPDR Dow Jones", "Funds", "#2e7d32"),
    "SOXL": ("Direxion Semis 3x", "Funds", "#ff6d00"),
    "GLD": ("SPDR Gold Shares", "Funds", "#d4af37"),
    "TLT": ("iShares 20+ Treasury", "Funds", "#5c6bc0"),
    # Sector SPDRs (the 11 GICS sectors) — the gap that hid XLU
    "XLK": ("Technology Select Sector SPDR", "Funds", "#4d82ff"),
    "XLF": ("Financial Select Sector SPDR", "Funds", "#2a9d8f"),
    "XLE": ("Energy Select Sector SPDR", "Funds", "#e63946"),
    "XLV": ("Health Care Select Sector SPDR", "Funds", "#06d6a0"),
    "XLI": ("Industrial Select Sector SPDR", "Funds", "#8d99ae"),
    "XLY": ("Consumer Discretionary Select Sector SPDR", "Funds", "#f4a261"),
    "XLP": ("Consumer Staples Select Sector SPDR", "Funds", "#b5838d"),
    "XLU": ("Utilities Select Sector SPDR", "Funds", "#ffd166"),
    "XLB": ("Materials Select Sector SPDR", "Funds", "#a68a64"),
    "XLRE": ("Real Estate Select Sector SPDR", "Funds", "#118ab2"),
    "XLC": ("Communication Services Select Sector SPDR", "Funds", "#9b5de5"),
    # Industry / thematic
    "SMH": ("VanEck Semiconductor ETF", "Funds", "#ff8500"),
    "XBI": ("SPDR S&P Biotech ETF", "Funds", "#00b4d8"),
    "KRE": ("SPDR S&P Regional Banking ETF", "Funds", "#6a994e"),
    "ARKK": ("ARK Innovation ETF", "Funds", "#ef476f"),
    # Macro / asset
    "SLV": ("iShares Silver Trust", "Funds", "#9aa5b1"),
    "USO": ("United States Oil Fund", "Funds", "#8c6d46"),
    "HYG": ("iShares iBoxx High Yield Corp Bond", "Funds", "#e07a5f"),
    "UUP": ("Invesco DB US Dollar Bullish", "Funds", "#386641"),
    "VXX": ("iPath Series B S&P 500 VIX Short-Term", "Funds", "#d00000"),
    # International
    "EEM": ("iShares MSCI Emerging Markets", "Funds", "#f77f00"),
    "FXI": ("iShares China Large-Cap", "Funds", "#d62828"),
    # ── ETFs, batch 2 ─────────────────────────────────────────────────────────
    # Broad market / style
    "VOO": ("Vanguard S&P 500 ETF", "Funds", "#8e1f2f"),
    "VTI": ("Vanguard Total Stock Market", "Funds", "#96172a"),
    "QQQM": ("Invesco NASDAQ 100 ETF", "Funds", "#5a8dee"),
    "RSP": ("Invesco S&P 500 Equal Weight", "Funds", "#4c9f70"),
    "IWF": ("iShares Russell 1000 Growth", "Funds", "#7048e8"),
    "IWD": ("iShares Russell 1000 Value", "Funds", "#495057"),
    # Dividend / income
    "SCHD": ("Schwab US Dividend Equity", "Funds", "#1e88e5"),
    "VIG": ("Vanguard Dividend Appreciation", "Funds", "#00897b"),
    "JEPI": ("JPMorgan Equity Premium Income", "Funds", "#5c6bc0"),
    # Tech / semis
    "SOXX": ("iShares Semiconductor ETF", "Funds", "#fb8c00"),
    "IGV": ("iShares Expanded Tech-Software", "Funds", "#26c6da"),
    "VGT": ("Vanguard Information Technology", "Funds", "#3949ab"),
    # Leveraged / inverse
    "TQQQ": ("ProShares UltraPro QQQ 3x", "Funds", "#00c853"),
    "SQQQ": ("ProShares UltraPro Short QQQ 3x", "Funds", "#d50000"),
    "SPXL": ("Direxion S&P 500 Bull 3x", "Funds", "#2e7d32"),
    "SOXS": ("Direxion Semiconductor Bear 3x", "Funds", "#c62828"),
    # Bonds / rates
    "IEF": ("iShares 7-10 Year Treasury", "Funds", "#7986cb"),
    "SHY": ("iShares 1-3 Year Treasury", "Funds", "#9fa8da"),
    "LQD": ("iShares Investment Grade Corp Bond", "Funds", "#4dd0e1"),
    "AGG": ("iShares Core US Aggregate Bond", "Funds", "#4db6ac"),
    # Commodities
    "GDX": ("VanEck Gold Miners ETF", "Funds", "#c9a227"),
    "GDXJ": ("VanEck Junior Gold Miners", "Funds", "#b8860b"),
    # International / country
    "EFA": ("iShares MSCI EAFE", "Funds", "#ff8f00"),
    "VEA": ("Vanguard Developed Markets", "Funds", "#fb8c00"),
    "VWO": ("Vanguard Emerging Markets", "Funds", "#f4511e"),
    "EWZ": ("iShares MSCI Brazil", "Funds", "#43a047"),
    "KWEB": ("KraneShares China Internet", "Funds", "#e53935"),
    # Crypto-linked ETFs
    "IBIT": ("iShares Bitcoin Trust", "Funds", "#f7931a"),
    "BITO": ("ProShares Bitcoin Strategy", "Funds", "#f2a900"),
    # Thematic / industry
    "IBB": ("iShares Biotechnology ETF", "Funds", "#0097a7"),
    "JETS": ("US Global Jets ETF", "Funds", "#1565c0"),
    "IYR": ("iShares US Real Estate", "Funds", "#00838f"),
    "BTC-USD": ("Bitcoin", "Crypto", "#f7931a"),
    "ETH-USD": ("Ethereum", "Crypto", "#627eea"),
    "SOL-USD": ("Solana", "Crypto", "#14f195"),
    "XRP-USD": ("XRP", "Crypto", "#23292f"),
}
DEFAULT = list(META.keys())

# Home-exchange label for the search row. build_universe only auto-tags names it finds in
# the Polygon type=CS reference; these ADRs aren't in it, so emit the label here so the
# nightly rebuild keeps NYSE/NASDAQ instead of falling back to the generic "US" tag.
MKT = {"BABA": "NYSE", "JD": "NASDAQ", "PDD": "NASDAQ"}


def write_backtest_artifact(sym: str, bt: dict, btc: dict, out_dir: Path) -> bool:
    """Write the full <SYM>.backtest.json (contract + cumulative equity curve, HANDOFF §7.3)
    from a run_backtest result + its contract. Returns False (no file) when the run has no
    trades. Shared with regen_flagship_slices' lane-stale recompute path."""
    if bt.get("status") != "ok" or not bt.get("trades"):
        return False
    _rets = bt.get("_returns", [])
    _idx = bt.get("_returns_index", [])
    # Build cumulative equity curve: start 1.0, compound each bar return
    eq_v = [1.0]
    for r in _rets:
        eq_v.append(round(eq_v[-1] * (1.0 + r), 8))
    bh_tr = bt.get("metrics", {}).get("vs_buy_hold", {}).get("bh_total_return")
    equity_obj = {
        "t": [bt["first"]] + _idx,
        "v": eq_v,
        "bh_total_return": bh_tr,
    }
    # backtest_contract dict + "equity" key; strip raw _returns/_returns_index
    full_bt = {k: v for k, v in btc.items() if k not in ("_returns", "_returns_index")}
    full_bt["equity"] = equity_obj
    (out_dir / f"{sym}.backtest.json").write_text(json.dumps(full_bt, separators=(",", ":")))
    return True


def main(syms: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = (ROOT / "signal_layer" / "confluence.py").read_text()
    manifest: dict = {"as_of": None, "source": "polygon", "symbols": {}}
    for sym in syms:
        bars = fetch_daily(sym, years=6)
        if len(bars) < 120:
            print(f"  skip {sym}: {len(bars)} bars")
            continue
        ohlc_bars, ohlc_src = _deep_ohlc(sym, bars)
        _doc = ohlc_json(sym, ohlc_bars)
        _doc["src"] = ohlc_src
        # The chart buckets these sessions into 2D/3D bars in the BROWSER, which cannot derive
        # the grid's phase from a truncated feed. Publish the anchor with the bars it describes.
        # Stamped here as well as in the nightly's stamp_session_anchors pass because this
        # builder rebuilds the document from scratch in Phase 1 and would otherwise drop the
        # field for the hours until the marathon reaches that pass (ingest/session_anchor.py).
        stamp_session_anchor(_doc, sym)
        (OUT / f"{sym}.json").write_text(json.dumps(_doc, separators=(",", ":")))

        df = pd.DataFrame(bars, columns=["date", "o", "h", "l", "c", "v"])
        df["date"] = pd.to_datetime(df["date"])
        close = df.set_index("date")["c"].astype(float)
        last, prev = float(close.iloc[-1]), float(close.iloc[-2])
        chg = (last - prev) / prev * 100

        name, sec, col = META.get(sym, (sym, "Equities", "#888"))
        lb = bars[-1]  # [date,o,h,l,c,v]
        hi52 = float(df["h"].tail(252).max()); lo52 = float(df["l"].tail(252).min())
        row = {"name": name, "sec": sec, "col": col, "last": round(last, 4), "chg": round(chg, 2),
               "open": lb[1], "high": lb[2], "low": lb[3], "vol": lb[5],
               "hi52": round(hi52, 2), "lo52": round(lo52, 2),
               "verdict": None, "wr": None, "pf": None, "cagr": None, "regimeBull": None}
        if sym in MKT:
            row["mkt"] = MKT[sym]

        # ── chart signal history runs over the DEEP (full-IPO) display series ──────────────────
        # gen_slices_all computes every non-flagship symbol's confluence over its deep <SYM>.json,
        # so CN/HK and non-flagship US show BUY/SELL/CUT/REBUY markers across their WHOLE history.
        # The flagship path used to run confluence on the shallow Polygon `close` (~6yr REST floor),
        # so AAPL/NVDA/TSLA/… markers stopped ~2021 even though the chart shows IPO-deep bars. Feed
        # the same deep series here for parity. When Yahoo is unavailable (ohlc_src=="polygon") the
        # deep series == close, so this degrades gracefully to the old shallow behaviour.
        if ohlc_src != "polygon" and len(ohlc_bars) > len(bars):
            ddf = pd.DataFrame(ohlc_bars, columns=["date", "o", "h", "l", "c", "v"])
            ddf["date"] = pd.to_datetime(ddf["date"])
            deep_close = ddf.set_index("date")["c"].astype(float)
        else:
            deep_close = close
        # Phase the 3D session grid + 2-week confirm to each series' IPO anchor (a full-history feed
        # anchors at ~0 = TV parity; ipo_bar_anchor also handles a merely-partial deep feed robustly).
        sig_anchor = confluence.ipo_bar_anchor(deep_close, sym)
        sig_wparity = confluence.ipo_week_parity(deep_close, sym)
        sig = confluence.compute_signals(deep_close, bar_anchor=sig_anchor, week_parity=sig_wparity)
        # The backtest stays on the Polygon feed (liquid recent window; validated WR/PF/CAGR/equity).
        bt_anchor = confluence.ipo_bar_anchor(close, sym)
        bt_wparity = confluence.ipo_week_parity(close, sym)
        if not sig.empty:
            ind = contracts.indicator_contract(
                sym, "3D", sig, bar_quality="real_ohlc", src_text=src,
                honest_read="RSI-MACD × StochRSI MTF confluence on full-history daily→3D. Risk/timing overlay + brain input.")
            # The chart reads only indicator.signals + indicator.state; drop the heavy per-bar
            # series/gates/bars arrays (full IPO history would balloon the slice to megabytes —
            # gen_slices_all strips them for the same reason).
            for heavy in ("series", "gates", "bars"):
                ind.pop(heavy, None)
            # reclaim_lane (FLAGSHIP_PARAMS): the scored sim prices the RE-ENTRY repair
            # entries — except for decay instruments (reclaim_eligible symbol-class rule),
            # which trade the plain baseline.
            bt = backtest.run_backtest(close, fixed=True, bar_quality="real_ohlc",
                                       bar_anchor=bt_anchor, week_parity=bt_wparity,
                                       use_reclaim_entry=bool(
                                           contracts.FLAGSHIP_PARAMS.get("reclaim_lane")
                                           and reclaim_eligible(name, sym)))
            btc = contracts.backtest_contract(
                sym, "3D", bt,
                honest_read="As-traded Polygon backtest after costs; significance verdict delegated to loop/harness.")
            slim = {"indicator": ind, "backtest": contracts.model_slice(btc)}
            # A slice is a shared envelope. This flagship builder owns indicator/backtest,
            # while slower bridges own siblings such as opportunities. Preserve those
            # siblings so Phase 1 cannot make them disappear during the nightly marathon.
            slim = write_slice_preserving_siblings(
                OUT / f"{sym}.slice.json",
                slim,
                owned_fields={"indicator", "backtest"},
                indent=2,
            )

            # Write full backtest contract + equity curve (HANDOFF §7.3)
            write_backtest_artifact(sym, bt, btc, OUT)
            st = slim["indicator"]["state"]
            m = slim["backtest"]["metrics"]
            # scored-first: blocked markers never become the public verdict; the fallback
            # keeps this v2-less staging emission (empty keeper) behaving as before, and
            # reconcile_flagship_verdicts re-derives from the published v2 slice downstream.
            row.update(verdict=st.get("last_scored_signal") or st.get("last_signal"),
                       vts=st.get("last_scored_ts"),
                       regimeBull=bool(st.get("above200") and st.get("weeklyBull")),
                       wr=m.get("win_rate"), pf=m.get("profit_factor"), cagr=m.get("cagr"))
            print(f"  {sym}: {len(bars)}b last={last:.2f} {chg:+.2f}% | {st.get('last_signal')} "
                  f"WR={m.get('win_rate')} PF={m.get('profit_factor')} CAGR={m.get('cagr')}")
        else:
            print(f"  {sym}: {len(bars)}b last={last:.2f} (no signal — too short)")
        manifest["symbols"][sym] = row
        manifest["as_of"] = bars[-1][0]
        time.sleep(0.2)
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"\nmanifest: {len(manifest['symbols'])} symbols, as_of {manifest['as_of']}")


if __name__ == "__main__":
    main(sys.argv[1:] or DEFAULT)
