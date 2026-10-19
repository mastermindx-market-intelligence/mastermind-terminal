"""One-time backfill: rewrite the flagship <SYM>.slice.json so the confluence signal history spans
the FULL deep <SYM>.json (to IPO), matching gen_slices_all / every non-flagship symbol.

WHY: build_polygon_universe used to run confluence on the shallow Polygon `close` (~6yr REST floor),
so AAPL/NVDA/TSLA/… showed BUY/SELL/CUT/REBUY markers only back to ~2021 even though the chart draws
IPO-deep bars — while CN/HK + non-flagship US (gen_slices_all, deep <SYM>.json) show full history.

This reads the already-deep OHLC on disk (NO network, does NOT touch <SYM>.json) and replaces ONLY
slice['indicator']; the existing slice['backtest'] (Polygon-fed WR/PF/CAGR) is preserved verbatim
WHEN it is the current strategy identity. LANE GUARD (2026-07-16 reclaim promotion): when the
on-disk <SYM>.backtest.json carries a stale strategy.spec_hash (e.g. a pre-promotion no-reclaim
backtest under current FLAGSHIP_PARAMS), the backtest is RECOMPUTED here from the deep close
(use_reclaim_entry per reclaim_eligible) and the manifest row (wr/pf/cagr + verdict/vts) patched in
lockstep — a slice must never pair a current-identity indicator with an old-lane backtest, and a
standalone regen must leave verify_publish green without waiting for the nightly reconcile. In the
nightly this guard is a no-op: build_polygon_universe wrote a fresh current-identity backtest
minutes earlier. Idempotent — safe to re-run. The build_polygon_universe.py fix keeps the nightly
cron correct going forward; this script fixes the live slices immediately without waiting for it.

Run on the VPS (deep <SYM>.json + /opt/macro deep store present):
  MACRO_REPO=/opt/macro /opt/macro/.venv/bin/python ingest/regen_flagship_slices.py           # rewrite all
  MACRO_REPO=/opt/macro /opt/macro/.venv/bin/python ingest/regen_flagship_slices.py --check NVDA   # dry-run one
  TERMINAL_DATA_DIR=/some/staging ... --stage                                                  # write to staging
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
from signal_layer import backtest, confluence, contracts, confluence_v2  # noqa: E402
from signal_layer.washout_override import DailyBars, WashoutStamper  # noqa: E402
from ingest.build_polygon_universe import DEFAULT as FLAGSHIP, write_backtest_artifact  # noqa: E402
from ingest.slice_document import write_slice_preserving_siblings  # noqa: E402
from ingest.v2_cohort_cache import build_cohort_cache  # noqa: E402

OUT = Path(os.environ.get("TERMINAL_DATA_DIR") or (ROOT / "terminal" / "public" / "data"))
MANIFEST = Path(os.environ.get("TERMINAL_MANIFEST") or (OUT / "manifest.json"))
SPEC_HASH = contracts.strategy_spec_hash()   # the CURRENT scored-lane identity
HONEST = "RSI-MACD × StochRSI MTF confluence on full-history daily→3D. Risk/timing overlay + brain input."
HONEST_BT = ("As-traded backtest recomputed from the deep on-disk series after a strategy-identity "
             "change (lane guard); the nightly Polygon rebuild supersedes it.")
try:
    SRC = (ROOT / "signal_layer" / "confluence.py").read_text()
except Exception:
    SRC = ""


_MANIFEST_MEMO: dict | None = None


def _load_manifest() -> dict:
    # memoized: the manifest is multi-MB and regen() consults it once per flagship name
    global _MANIFEST_MEMO
    if _MANIFEST_MEMO is None:
        try:
            _MANIFEST_MEMO = json.loads((OUT / "manifest.json").read_text())
        except Exception:
            _MANIFEST_MEMO = {"symbols": {}}
    return _MANIFEST_MEMO


def regen(sym: str, write: bool = True, cache=None, patches: dict | None = None,
          stamper: WashoutStamper | None = None) -> str:
    jf = OUT / f"{sym}.json"
    sf = OUT / f"{sym}.slice.json"
    if not jf.exists():
        return f"{sym}: NO OHLC file"
    d = json.loads(jf.read_text())
    bars = d.get("bars") or []
    if len(bars) < 60:
        return f"{sym}: only {len(bars)}b — skip"
    idx = pd.to_datetime([b[0] for b in bars])
    close = pd.Series([float(b[4]) for b in bars], index=idx)
    high = pd.Series([float(b[2]) for b in bars], index=idx)
    low = pd.Series([float(b[3]) for b in bars], index=idx)
    vol_raw = [(b[5] if len(b) > 5 else None) for b in bars]
    volume = (pd.Series([float(v) if v not in (None, 0) else float("nan")
                         for v in vol_raw], index=idx)
              if any(v not in (None, 0) for v in vol_raw) else None)
    anchor = confluence.ipo_bar_anchor(close, sym)
    wparity = confluence.ipo_week_parity(close, sym)
    sig = confluence.compute_signals(close, bar_anchor=anchor, week_parity=wparity)
    if sig.empty:
        return f"{sym}: empty sig ({len(bars)}b)"
    # cohort cache built once by main(); for --check a single symbol, build lazily.
    if cache is None:
        cache = build_cohort_cache(OUT, _load_manifest())
    sec_basket, panel_basket, cohort = cache.for_symbol(sym)
    # symbol-class exclusion: decay instruments (leveraged/inverse/VIX/futures wrappers)
    # never emit RE-ENTRY reclaims — the name comes from the manifest row.
    mrow = _load_manifest().get("symbols", {}).get(sym) or {}
    eligible = confluence_v2.reclaim_eligible(mrow.get("name"), sym)
    # ONE stamper for the run: it is the live washout-override ENTRY gate here (era
    # gc_v2_wo1) and the display stamp below, so a single artifact + ledger load answers
    # both. `--check` on a single symbol builds it lazily, exactly as the stamp does.
    gate = stamper if stamper is not None else WashoutStamper.create()
    v2 = confluence_v2.build_v2(sig, close, high=high, low=low, volume=volume,
                                sector_basket=sec_basket, panel_basket=panel_basket,
                                cohort_frac_daily=cohort,
                                reclaims_enabled=eligible,
                                symbol=sym, override_gate=gate)
    ind = contracts.indicator_contract(
        sym, "3D", sig, bar_quality="real_ohlc", src_text=SRC, honest_read=HONEST, v2=v2,
        bar_closed=contracts.three_day_bar_closed(close, anchor))
    # ── washout-override pass (ratified 2026-08-10, notch 25%) ──
    # This script is the nightly's LAST writer of the flagship slices (terminal-data phase 1
    # runs it right after build_polygon_universe), so without this pass every flagship ⊘
    # would lose its override class the moment the rewrite lands. Display stamp + the
    # forward-ledger row for stamped and TAKEN fires alike; the entry decision itself was
    # made above, by the same object, inside build_v2.
    gate.stamp(sym, ind.get("signals"), daily=DailyBars(
        bar_opens=[d.strftime("%Y-%m-%d") for d in sig.index],
        dates=[d.strftime("%Y-%m-%d") for d in idx],
        high=high.to_list(), low=low.to_list(), close=close.to_list()))
    # retro projection: DISPLAY-ONLY re-marks of pre-fence refusals today's rule would
    # have entered. Never scored, never alerted, never accrued.
    gate.retro(sym, ind.get("signals"), relievable_ts=v2.get("keeper_relievable"))
    for heavy in ("series", "gates", "bars"):
        ind.pop(heavy, None)
    sigs = ind.get("signals", [])
    span = f"{sigs[0]['ts']}→{sigs[-1]['ts']}" if sigs else "none"
    # preserve the existing Polygon-fed backtest slice (OracleDash reads slice.backtest) —
    # but ONLY when the on-disk artifact is the CURRENT strategy identity (lane guard).
    out = {"indicator": ind}
    bt_state = "MISSING"
    try:
        cur_hash = json.loads((OUT / f"{sym}.backtest.json").read_text()) \
            .get("strategy", {}).get("spec_hash")
    except Exception:
        cur_hash = None
    if cur_hash == SPEC_HASH:
        if sf.exists():
            try:
                existing = json.loads(sf.read_text())
                if "backtest" in existing:
                    out["backtest"] = existing["backtest"]
                    bt_state = "kept"
            except Exception:
                pass
    else:
        # Lane-stale (or absent) artifact: recompute from the deep on-disk close so the
        # rewritten slice never pairs a current-identity indicator with an old-lane
        # backtest. The manifest row's wr/pf/cagr are patched in lockstep (verify_publish
        # asserts manifest == slice); the next nightly Polygon rebuild supersedes both.
        bt = backtest.run_backtest(close, fixed=True, bar_quality="real_ohlc",
                                   bar_anchor=anchor, week_parity=wparity,
                                   use_reclaim_entry=eligible)
        btc = contracts.backtest_contract(sym, "3D", bt, honest_read=HONEST_BT)
        out["backtest"] = contracts.model_slice(btc)
        bt_state = f"RECOMPUTED[{'reclaim' if eligible else 'base'}-lane]"
        if write:
            write_backtest_artifact(sym, bt, btc, OUT)
        m = bt.get("metrics") or {}
        if patches is not None and mrow and m:
            patches[sym] = {"wr": m.get("win_rate"), "pf": m.get("profit_factor"),
                            "cagr": m.get("cagr")}
    # verdict/vts sync — the SAME scored-first rule as build_universe.reconcile_flagship_verdicts
    # (which remains the authoritative nightly sweep): a standalone regen must leave the manifest
    # agreeing with the slices it just wrote, or a strict verify_publish between regens would red.
    if patches is not None and mrow.get("verdict") is not None:
        st = ind.get("state", {})
        ls = st.get("last_scored_signal") or st.get("last_signal")
        vts = st.get("last_scored_ts")
        if ls and (mrow.get("verdict") != ls or mrow.get("vts") != vts):
            patches.setdefault(sym, {}).update(verdict=ls, vts=vts)
    if write:
        # Own only indicator/backtest. Cross-engine siblings were published by
        # independent bridges and must survive this second Phase-1 flagship rewrite.
        write_slice_preserving_siblings(
            sf, out, owned_fields={"indicator", "backtest"})
    return f"{sym}: {len(sigs)} sigs [{span}] over {len(bars)}b  state={ind['state'].get('last_signal')}  bt={bt_state}"


def main() -> None:
    if "--check" in sys.argv:
        sym = sys.argv[sys.argv.index("--check") + 1]
        print(regen(sym, write=False))         # regen builds the cache lazily for one name
        return
    t0 = time.time()
    ok = 0
    # build the sector-cohort cache ONCE, reuse across all flagship names (bounded overhead).
    cache = build_cohort_cache(OUT, _load_manifest())
    patches: dict[str, dict] = {}
    # one artifact + ledger load for the whole run; rows append once at the end
    stamper = WashoutStamper.create()
    for sym in FLAGSHIP:
        try:
            print(" ", regen(sym, write=True, cache=cache, patches=patches, stamper=stamper), flush=True)
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {sym}: {e}", flush=True)
    stamper.flush()
    # lane-guard manifest patch: keep the published wr/pf/cagr + verdict/vts in lockstep with
    # any recomputed slice backtests. Read-modify-write of the EXISTING rows only — never
    # adds/removes symbols (the 2026-07-11 clobber lesson: this script must be structurally
    # incapable of shrinking the universe).
    if patches:
        try:
            man = json.loads(MANIFEST.read_text())
            hit = 0
            for sym, patch in patches.items():
                row = (man.get("symbols") or {}).get(sym)
                if row:
                    row.update(patch)
                    hit += 1
            MANIFEST.write_text(json.dumps(man, separators=(",", ":")))
            print(f"manifest: patched {hit}/{len(patches)} rows (lane guard) -> {MANIFEST}")
        except Exception as e:  # noqa: BLE001
            print(f"manifest patch FAILED (slices still written): {e}")
    print(f"done: {ok}/{len(FLAGSHIP)} flagship slices rewritten in {time.time() - t0:.0f}s -> {OUT}")


if __name__ == "__main__":
    main()
