"""Regenerate <SYM>.slice.json from the already-fetched OHLC (<SYM>.json) — no network.
Rewrites the `indicator` block with the FULL signal history (model_slice caps it to 12 for
the Opus token budget; the chart needs every BUY/SELL/CUT/REBUY marker). Backtest preserved.
Run with the macro venv python: `../Macro Dashboard/.venv/bin/python ingest/regen_slices.py`.
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from signal_layer import confluence, contracts  # noqa: E402

OUT = ROOT / "terminal" / "public" / "data"
HONEST = "RSI-MACD × StochRSI MTF confluence on Polygon daily→3D. Risk/timing overlay + brain input."

n_ok = n_skip = 0
for jf in sorted(OUT.glob("*.json")):
    name = jf.name
    if name == "manifest.json" or name.endswith((".slice.json", ".intel.json", ".backtest.json")):
        continue
    sym = name[:-5]
    slice_f = OUT / f"{sym}.slice.json"
    if not slice_f.exists():
        continue
    try:
        d = json.loads(jf.read_text())
        bars = d.get("bars") or []
        if len(bars) < 60:
            n_skip += 1
            continue
        idx = pd.to_datetime([b[0] for b in bars])
        close = pd.Series([float(b[4]) for b in bars], index=idx)
        # Phase the 3D grid (and the 2-week confirm pairing) to the symbol's IPO so they match
        # a full-history TradingView chart (the feed is truncated to ~6yr; defaults would anchor
        # at the feed start = wrong phase).
        bar_anchor = confluence.ipo_bar_anchor(close, sym)
        sig = confluence.compute_signals(
            close, bar_anchor=bar_anchor,
            week_parity=confluence.ipo_week_parity(close, sym))
        if sig.empty:
            n_skip += 1
            continue
        ind = contracts.indicator_contract(
            sym, "3D", sig, bar_quality="real_ohlc", src_text=d.get("src", ""), honest_read=HONEST,
            bar_closed=contracts.three_day_bar_closed(close, bar_anchor))
        existing = json.loads(slice_f.read_text())
        existing["indicator"] = ind  # full signal history (was model_slice → capped to 12)
        slice_f.write_text(json.dumps(existing, indent=2))
        n_ok += 1
    except Exception as e:  # noqa: BLE001
        print(f"  {sym}: ERROR {e}")
        n_skip += 1
print(f"regen: {n_ok} slices rewritten, {n_skip} skipped")
