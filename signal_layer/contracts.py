"""The data contracts — the centerpiece of the whole system (research doc §7).

Every series, signal, and backtest result the charting container produces is a
versioned JSON artifact in ONE of these two shapes, so the Mastermind Opus brain
and the Macro Dashboard stock-picker consume them with no bespoke parser.

Two schemas (see ``contracts/*.schema.json`` for the formal JSON Schema):
  * ``mastermind.indicator/v1``  — one doc per {indicator, symbol, timeframe}
  * ``backtest_result/v1``       — one doc per {strategy, symbol}

THE GUARDRAIL (research doc §4 P0-4 / D9): the ``series``/``gates``/``bars`` arrays
are FOR THE CHART ONLY and must NEVER be sent to the model. ``model_slice()`` is the
projection that strips them, leaving only ``signals[]`` + ``state{}`` + the honest
read — the small surface Opus reasons over within its token budget. Enforce the
slice at the read boundary; do not rely on convention.
"""
from __future__ import annotations

import hashlib
import json

import numpy as np
import pandas as pd

from . import SIGNAL_ERA, SIGNAL_ERA_PRE
from .washout_override import (OVERRIDE_TAKE_QUALITY, RECLAIM_OVERRIDE_TAKE_QUALITY,
                               WASHOUT_OVERRIDE_NOTCH)

SCHEMA_INDICATOR = "mastermind.indicator/v1"
SCHEMA_BACKTEST = "backtest_result/v1"

# The confluence indicator's identity as ``indicator_contract`` stamps it by default. Named
# here so a reader that must compare identities (ingest/gen_technical_scan.py — the screener
# scan's staleness key is (indicator id, engine, signal era)) reads the one definition
# instead of copying the strings.
CONFLUENCE_INDICATOR_ID = "confluence_rsimacd_stochrsi_mtf"
CONFLUENCE_ENGINE = "python:signal_layer.confluence_v2@v2"

# The flagship's faithful Pine params (mirrors confluence.py module constants).
# macd_kind alone is insufficient — two rsi_based MACDs of different lengths still
# disagree (research doc §4 / D6), so the lengths live in params and are hashed.
#
# ``no_cut_exits: True`` is the GC v2 marker (memory: gc-v2-signal-program): revSell is
# demoted from a scored EXIT to a display caution, so the traded stream is no-cut. It
# lives in the hashed params so the v2 emission gets a NEW ``source_hash`` — v1 and v2
# indicator docs are distinct identities even off the same script text.
#
# ``reclaim_lane: True`` is the 2026-07-16 scored promotion of the RE-ENTRY repair
# grammar (confluence_v2.reclaim_events): TREND-RECLAIM + BLOCK-REPAIR entries join the
# scored stream (position walk, manifest verdict, wr/pf via use_reclaim_entry=True),
# gated by the reclaim_eligible symbol-class rule. Panel evidence (post-exclusion,
# docs/RECLAIM_LANE_EVIDENCE.md): n=84 names / 1,169 trades, all five gates pass —
# pooled expectancy +10.5%, portfolio ratio 1.33x, WR 56.2→58.8, 2022 falsifier −1.1%.
# In the hashed params so the promoted emission is a NEW source_hash/spec_hash identity.
FLAGSHIP_PARAMS = {
    "confW": 8, "rsiLen": 14, "useMTF": True, "confirmTF": "1W",
    "macd_on": "rsi", "macd_fast": 14, "macd_slow": 60, "macd_signal": 5,
    "buy_rsi_max": 65, "ext_rsi": 70, "rev_bars": 3,
    "no_cut_exits": True,
    "reclaim_lane": True,
}


# ── HK-O1 truth-in-labeling: the emitted ``basis`` vocabulary ────────────────────
# ``basis`` names the MACHINE that produced an event, so no consumer can read a
# trailing structure stop as an oracle-momentum exit. Forensic receipt:
# Macro Dashboard research/prophet_us_audit/HK_ORACLE_FORENSIC_2026-08-08.md §1.
#
# Every user-facing SELL comes from ``v2["sell_confirms"]`` — the ARM→CONFIRM
# structure break (confluence_v2.warn_events): the daily close prints below the last
# CONFIRMED radius-3 swing low while armed. That is a TRAILING STOP on price
# structure. It is NOT the MACD-RSI cross-down (``CS``), which has not been emitted
# to the user stream since the GC v2 unification — 0700.HK printed a red
# "GOLDEN ORACLE · SELL" on 2026-07-24 while its own 3D RSI-MACD read bull
# (CS=False every bar 05-21→08-05, macd>sig rising at the fire).
BASIS_STRUCTURE_STOP = "structure_stop"

# Set on a marker the v2 entry logic REFUSED (bear_block regime veto). Kept alongside
# the legacy ``quality='regime_blocked'`` string — the flag is the render key, the
# string stays for every existing reader (HK-O1 item 2 is additive-only).
BLOCKED_QUALITY = "regime_blocked"

# ── the washout-override entry class (signal era gc_v2_wo1) ─────────────────────
# ``OVERRIDE_TAKE_QUALITY`` is imported from ``washout_override`` (which owns the notch and
# the gate and must stay pandas-free) and re-exported here, so a consumer reading the
# emission has one place to import every quality string from.
#
# Its OWN quality string, not a keeper verdict, because it is not a keeper verdict: the
# ratified construction (Macro Dashboard research/BLOCKED_ENTRY_RATIFICATION_PACKET_
# 2026-08-10.md §2, prereg §5 @ the 25% notch) takes the `bear_block`-vetoed fire ITSELF,
# so the fire bypasses the keeper's counter-trend reclaim-and-hold leg — which, `bear_block`
# requiring below-200, would otherwise re-refuse nearly every one of them and silently ship
# a much stricter rule than the one three rounds of gates cleared. A consumer that treats
# this like `take` is correct about the entry; a consumer that treats it like a keeper
# verdict is reading a machine that never ran.
#
# It is a REAL scored BUY: it walks `position_hint`, anchors the rail verdict, and fires
# alerts. `blocked` is never set on it, and it is NOT in the client's SOFT_Q set.
#
# ── the reclaim-waiver entry class (signal era gc_v2_wo2) ───────────────────────
# `RECLAIM_OVERRIDE_TAKE_QUALITY` is the SIBLING class, and every sentence above applies to
# it verbatim: real scored BUY, no `blocked` flag, absent from SOFT_Q, walks the position,
# anchors the verdict, alerts. What differs is which refusal was relieved and on whose
# cohort. The washout override takes a fire the REGIME gate vetoed and skips the keeper
# entirely; the reclaim waiver takes a fire the KEEPER blocked, by dropping one of the
# keeper's two counter-trend legs (the 200-reclaim) while the other (the next-bar hold)
# still had to pass. Two waivers, two gauntlets, two forward ledgers — so two strings.
#
# The verdict is produced in `confluence_v2.keeper_quality_map` (on branch logic, never on
# the keeper's collapsed reason string) and arrives here already decided; this module only
# carries it, exactly as it carries `take`/`block`/`pending`.


def override_quality_reason(ctx: dict | None) -> str:
    """The one-line WHY behind a taken override, stamped on the event.

    ``washout override: <group_id> <peer_dd> ≤ −25% (era gc_v2_wo1)`` — the group whose
    peers were washed out, how far below their 252d highs the peer median sat, the notch it
    cleared, and the era the decision was made under. Everything a later reader needs to
    re-derive the call without the artifact. Degrades field by field: an artifact that ships
    no group, or no number, yields a shorter line, never an empty slot.
    """
    ctx = ctx or {}
    bits = []
    group = ctx.get("group_id")
    if group:
        bits.append(str(group))
    dd = ctx.get("peer_dd")
    if isinstance(dd, (int, float)) and not isinstance(dd, bool) and np.isfinite(dd):
        bits.append(f"−{abs(float(dd)) * 100:.1f}%")
    bits.append(f"≤ −{WASHOUT_OVERRIDE_NOTCH}%")
    return f"washout override: {' '.join(bits)} (era {SIGNAL_ERA})"


def source_hash(source_text: str, params: dict) -> str:
    """Hash the script source AND the full params block (so a param change is a new
    identity). Matches the loop's spec_hash discipline."""
    blob = source_text + "\x00" + json.dumps(params, sort_keys=True, default=str)
    return "sha256:" + hashlib.sha256(blob.encode()).hexdigest()


def strategy_spec_hash(strategy_id: str = "rsimacd_stochrsi_mtf", params: dict | None = None) -> str:
    """The backtest contract's strategy identity — {id, params} hashed, 8 hex chars.
    Exposed so ingest can detect a LANE-STALE artifact (e.g. a pre-reclaim-promotion
    backtest under current params) without re-deriving the formula."""
    return hashlib.sha256(
        json.dumps({"id": strategy_id, "params": params or FLAGSHIP_PARAMS},
                   sort_keys=True).encode()
    ).hexdigest()[:8]


# ------------------------------------------------------------- bar phase -----
def three_day_bar_closed(daily_close: pd.Series, bar_anchor: int = 0) -> bool | None:
    """Whether the LAST 3D bar of ``compute_signals(daily_close, bar_anchor)`` is complete.

    Restates the oracle's session grouping (``confluence._3d_groups``) without editing it:
    a bar closes on the session whose global index ``i + bar_anchor`` is divisible by 3, so
    the final bar is complete exactly when the last consumed session is such a close.
    ``None`` for an empty series (no bar, no phase). Pinned bar-for-bar against
    ``_3d_groups`` by ``tests/test_indicator_cutoff.py``."""
    n = int(daily_close.dropna().shape[0])
    if n == 0:
        return None
    return (n - 1 + int(bar_anchor)) % 3 == 0


# ---------------------------------------------------------------- indicator --
def indicator_contract(
    symbol: str,
    timeframe: str,
    sig: pd.DataFrame,
    *,
    indicator_id: str = CONFLUENCE_INDICATOR_ID,
    title: str = "RSI-MACD × StochRSI MTF Confluence",
    engine: str = CONFLUENCE_ENGINE,
    source_lang: str = "python",
    params: dict | None = None,
    macd_kind: str = "rsi_based",
    bar_quality: str = "synthetic_open_deepstore",
    as_of: str | None = None,
    src_text: str = "",
    validation: dict | None = None,
    honest_read: str = "",
    v2: dict | None = None,
    bar_closed: bool | None = None,
) -> dict:
    """Build a ``mastermind.indicator/v1`` doc from ``confluence.compute_signals`` output.

    ``v2`` is the GC v2 emission from ``confluence_v2.build_v2`` (keeper quality + recipe
    tier per BUY/REBUY, early_dots[], warnings[], score_basis). When present, BUY/REBUY
    signals gain ``quality``/``tier``, CUT signals get ``scored:false``, and the two side
    channels ``early_dots``/``warnings`` are attached at the top level (capped to the last
    40 each). ``v2=None`` yields the plain oracle doc (back-compat for any caller that has
    not wired the v2 emitter yet).

    ``bar_closed`` is the published phase of the LAST 3D bar — True when its final session
    has printed, False while it is still forming. Pass ``three_day_bar_closed(close,
    bar_anchor)`` with the same close/anchor given to ``compute_signals``; None (the default,
    for callers that have not wired it) publishes the cutoff with an unstated phase. The
    phase is never inferred downstream: the screener scan reads it verbatim."""
    params = params or FLAGSHIP_PARAMS
    bars = [d.strftime("%Y-%m-%d") for d in sig.index]

    def col(name):
        return [_num(v) for v in sig[name].to_list()]

    series = {k: col(k) for k in ("macd", "sig", "k", "d", "rsi14") if k in sig}
    gates = {k: [bool(v) for v in sig[k].to_list()]
             for k in ("w_bull", "above200", "mo_bull", "w2_bull") if k in sig}

    v2 = v2 or {}
    signals = _extract_signals(sig, v2)
    state = _state(sig, signals)
    early = (v2.get("early_dots") or [])[-40:]
    warns = (v2.get("warnings") or [])[-40:]

    return {
        "schema": SCHEMA_INDICATOR,
        "indicator": {
            "id": indicator_id, "title": title, "engine": engine,
            "source_lang": source_lang, "source_hash": source_hash(src_text, params),
            "macd_kind": macd_kind, "params": params,
        },
        "symbol": symbol,
        "timeframe": timeframe,
        "as_of": as_of or (bars[-1] + "T00:00:00Z" if bars else None),
        "bar_quality": bar_quality,
        # ── the completed-bar cutoff (screener scan contract, E01) ──
        # WHICH DATA the state was computed from: the last daily session consumed and the
        # opening session of the bar ``state`` describes. Kept in the slim broad slice (it is
        # not one of the heavy chart arrays), so a reader never has to infer it.
        "cutoff": _cutoff(sig, bars, bar_closed),
        # ── the signal-era fence (signal_layer/__init__.py) ──────────────────────────
        # WHICH RULE emitted these signals. Stamped unconditionally, including on emissions
        # that grant no override, because the fence's job is to make every artifact say
        # which era it belongs to — an emission that only declared its era when the new
        # behaviour fired would leave the quiet majority unattributable. A slice carrying no
        # ``signal_era`` at all is pre-fence (read it as SIGNAL_ERA_PRE); never pool the two.
        "signal_era": SIGNAL_ERA,
        # ── CHART-ONLY ARRAYS — never projected to the model (model_slice strips) ──
        "bars": bars,
        "series": series,
        "gates": gates,
        # ── MODEL-FACING SLICE ──
        "signals": signals,
        "state": state,
        # ── v2 side channels (display; small — kept in the slice) ──
        "early_dots": early,
        "warnings": warns,
        "meta": {
            "leakfree": True, "scored": False,
            "score_basis": v2.get("score_basis", "full"),
            "validated_against": "signal_layer/confluence.py",
            "validation": validation or {},
            "honest_read": honest_read,
            "warnings": [],
        },
    }


def _extract_signals(sig: pd.DataFrame, v2: dict | None = None) -> list[dict]:
    """Discrete events → the Opus-facing surface: the ONE UNIFIED signal stream.

    The stream is ordered by ``bar_index`` and carries scored position events plus explicit
    display/watch events:
      * BUY   — from CB, exactly as before (keeper ``quality``/``tier``/``score`` stamped).
      * REBUY — from revBuy, exactly as before.
      * SELL  — from the v2 warn stream's CONFIRM events (``v2["sell_confirms"]``, the
                armed-momentum + structure-break event). This REPLACES the old CS-based SELL,
                so it is a TRAILING STRUCTURE STOP and says so: every SELL carries
                ``basis="structure_stop"`` + ``stop_level`` (the swing low its daily close
                broke). Nothing in this stream is a momentum exit — do not label one as one.
      * BOTTOM_WATCH — own-name washout candidate, always ``scored:false``.
      * RECLAIM — validated repair-lane entries plus display-only ``stop_sweep_reclaim``.

    NOT in this stream anymore (display priority = tops/bottoms readability, not sim purity):
      * CS-based SELL entries — dropped; CS stays internal to the no-cut sim only.
      * CUT (revSell) entries — dropped; revSell stays internal to the no-cut sim only.
    Both remain live inside ``backtest``/``confluence.simulate``; they are simply no longer
    emitted as user-facing markers. The chart's classic red sell pill renders ``type:"SELL"``
    with zero frontend work.

    GC v2 (``v2`` = confluence_v2.build_v2 output):
      * BUY / REBUY gain ``quality`` (keeper take/block/pending) + ``tier`` (recipe
        aplus/quality/base) + ``score`` (0..100) at their positional ``bar_index`` (the
        index into the non-NaN signal rows, which is what ``keeper``/``recipe`` key on).
      * a fire in ``v2["override"]`` is the washout-override ENTRY (era gc_v2_wo1): it was
        ``bear_block``-vetoed and the live gate took it, so it is emitted with
        ``quality="override_take"`` + ``override_ctx``, a recipe tier, and no ``blocked``
        flag. The three cohorts are disjoint by construction (override ⊂ bear_block, keeper
        ⊂ ~bear_block), so the branch order below cannot mask one with another."""
    v2 = v2 or {}
    keeper = v2.get("keeper", {})       # {positional_bar_index: {verdict, reason, shift}}
    recipe = v2.get("recipe", {})       # {positional_bar_index: {score, tier}}
    override = v2.get("override", {})   # {positional_bar_index: override_ctx} — taken fires
    # bar_index here counts POSITIONAL non-NaN rows (keeper/recipe key on the same index).
    # Guard the empty/columnless frame (dropna(subset=...) would KeyError otherwise).
    if len(sig) and {"macd", "sig", "k", "d", "rsi14"}.issubset(sig.columns):
        valid = sig.dropna(subset=["macd", "sig", "k", "d", "rsi14"])
        pos_of = {ts: p for p, ts in enumerate(valid.index)}
    else:
        pos_of = {}

    out = []
    for i, (ts, row) in enumerate(sig.iterrows()):
        kind = None
        if row.get("revBuy"):
            kind, reasons = "REBUY", ["fast_reversal_up", "sell_failed"]
        elif row.get("CB"):
            kind, reasons = "BUY", ["macd_bull_cross", "recent_b1", "confirm_bull", "rsi<65"]
        # CS / revSell are NO LONGER emitted here (unified stream: SELL comes from the v2
        # CONFIRM events below; CS+revSell remain internal to the sim only).
        if not kind:
            continue
        ev = {
            "ts": ts.strftime("%Y-%m-%d"),
            # ``ts`` is the 3D bar OPEN and remains the chart/replay coordinate.
            # ``known_ts`` is the session when this row's value became observable.
            "known_ts": _iso_date(row.get("known_ts"), ts.strftime("%Y-%m-%d")),
            "bar_index": i,
            "type": kind,
            "strength": _strength(row),
            "price": _num(row.get("close")),
            "reasons": reasons,
            "regime": {"weeklyBull": bool(row.get("w_bull")),
                       "above200": bool(row.get("above200")),
                       "monthlyBull": bool(row.get("mo_bull"))},
        }
        p = pos_of.get(ts)
        ovr = override.get(p) if p is not None else None
        if ovr is not None:
            # ── THE WASHOUT-OVERRIDE ENTRY (era gc_v2_wo1) ──────────────────────────
            # A bear_block-vetoed fire the live gate TOOK. It is a real entry: no
            # ``blocked`` flag, its own quality string, and a tier from the standard recipe
            # scoring — which carries no counter-trend leg, so the tier is the same one an
            # unvetoed fire on this bar would have had. It is deliberately NOT keeper-graded
            # (see confluence_v2.keeper_quality_map): the gauntleted construction enters on
            # the fire, and the keeper's counter-trend reclaim-and-hold leg would re-refuse
            # it. ``override_ctx`` rides along so the marker and the card can say WHY
            # without a second fetch, and so an archived slice stays self-describing.
            ev["quality"] = OVERRIDE_TAKE_QUALITY
            ev["quality_reason"] = override_quality_reason(ovr)
            ev["override_ctx"] = dict(ovr)
            r = recipe.get(p)
            if r is not None:
                ev["tier"] = r["tier"]
                ev["score"] = r["score"]
        elif p is not None and p in keeper:
            # take / block / pending — or, since gc_v2_wo2, ``reclaim_override_take``: the
            # keeper's own verdict when the ratified waiver dropped its 200-reclaim leg for
            # a qualifying name. It rides this branch rather than a new one BECAUSE it is a
            # keeper verdict: same cohort, same scoring, one relaxed leg. Its ``override_ctx``
            # rides along for the same reason the washout class's does — so the marker and
            # the card can say WHY without a second fetch, and an archived slice stays
            # self-describing.
            ev["quality"] = keeper[p]["verdict"]
            ev["quality_reason"] = keeper[p]["reason"]
            ovr_ctx = keeper[p].get("override_ctx")
            if ovr_ctx is not None:
                ev["override_ctx"] = dict(ovr_ctx)
            r = recipe.get(p)
            if r is not None:
                ev["tier"] = r["tier"]                     # aplus / quality / base
                ev["score"] = r["score"]
        else:
            # A raw CB/revBuy the v2 entry logic does NOT take: bear_block regime veto
            # (keeper only grades ``(CB|revBuy) & ~bear_block``). Keep the display marker
            # but flag it so the model/chart never treats it as an entry. tier=None.
            #
            # ``blocked`` is the HK-O1 render key: ``type`` stays "BUY"/"REBUY" verbatim so
            # every existing reader keeps working, but a blocked setup must never be DRAWN
            # with buy geometry (9988.HK's 2026-07-09 entry was regime-vetoed and still
            # printed a solid BUY star on the price series — forensic §2). Consumers gate
            # on ``blocked``/``quality``, never on ``type`` alone.
            ev["quality"] = BLOCKED_QUALITY
            ev["quality_reason"] = "bear_block: monthly-bear & below-200 & 2W-not-bull"
            ev["tier"] = None
            ev["score"] = None
            ev["blocked"] = True
        out.append(ev)

    # ── BOTTOM_WATCH: own-name washout candidates (display/watch, every market) ──
    # These are intentionally distinct from BUY/REBUY. They make the early turn findable
    # without pretending an unvalidated cross-market candidate was a scored entry.
    bottom_watches = v2.get("bottom_watches") or []
    if bottom_watches and len(sig):
        sidx = sig.index
        for watch in bottom_watches:
            j = int(sidx.searchsorted(pd.Timestamp(watch["ts"]), side="right")) - 1
            if j < 0:
                continue
            row = sig.iloc[j]
            subtype = str(watch.get("kind") or "early_dot")
            ev = {
                "ts": watch["ts"],
                "known_ts": _iso_date(watch.get("known_ts"), watch["ts"]),
                "bar_index": j,
                "type": "BOTTOM_WATCH",
                "scored": False,
                "subtype": subtype,
                "quality": watch.get("quality") or "washout_early_watch",
                "quality_reason": (
                    "blocked Oracle turn inside a point-in-time own-name washout"
                    if subtype == "blocked_trigger"
                    else "early momentum turn inside a point-in-time own-name washout"
                ),
                "trigger_ts": watch.get("trigger_ts") or watch["ts"],
                "trigger_known_ts": _iso_date(
                    watch.get("trigger_known_ts"),
                    _iso_date(watch.get("known_ts"), watch["ts"]),
                ),
                "strength": _strength(row),
                "price": _num(watch.get("price")),
                "reasons": (["bear_block", "own_name_washout", "raw_buy_trigger"]
                            if subtype == "blocked_trigger"
                            else ["bear_block", "own_name_washout", "early_momentum_turn"]),
                "washout_ctx": dict(watch.get("washout_ctx") or {}),
                "regime": {"weeklyBull": bool(row.get("w_bull")),
                           "above200": bool(row.get("above200")),
                           "monthlyBull": bool(row.get("mo_bull"))},
            }
            for key in ("sweep_low", "atr14", "stop_level", "risk_basis"):
                if watch.get(key) is not None:
                    ev[key] = (_num(watch[key]) if key != "risk_basis" else watch[key])
            out.append(ev)

    # ── SELL from the v2 CONFIRM events (distribution armed + structure break) ──
    # Each confirm event is a DAILY-grid date; map it onto the containing / nearest-preceding
    # 3D row (open_date <= confirm_ts) so it renders on the 3D chart grid. strength/regime
    # come from that 3D row (its OPEN precedes the confirm, so both are point-in-time safe).
    # Multiple confirms can fall in one 3D bar's 3-session window — each stays a distinct
    # SELL at its own confirm date.
    #
    # PRICE IS THE EXCEPTION (HK-O1 item 3 / forensic B2). The 3D row's ``close`` is the
    # close of a bar that OPENED on/before the confirm and CLOSES up to 2 sessions AFTER it,
    # so stamping it on the marker published a price the market had not printed yet —
    # 9988.HK's 2026-05-27 SELL carried the close of the bar that opened 05-26. The honest
    # stamp is the confirm session's own DAILY close (``px``), which is also the exact number
    # the rule tested when it broke ``level``. ``price`` falls back to the 3D close only for
    # a legacy v2 payload emitted before ``px`` existed.
    sell_confirms = v2.get("sell_confirms") or []
    if sell_confirms and len(sig):
        sidx = sig.index                                   # 3D open dates, ascending
        for w in sell_confirms:
            cts = pd.Timestamp(w["ts"])
            j = int(sidx.searchsorted(cts, side="right")) - 1
            if j < 0:                                       # confirm before the first 3D bar
                continue
            row = sig.iloc[j]
            px = _num(w.get("px"))
            out.append({
                "ts": w["ts"],                              # the confirm event's date
                "known_ts": _iso_date(w.get("known_ts"), w["ts"]),
                "bar_index": j,                             # nearest-preceding 3D row
                "type": "SELL",
                # A trailing stop on price STRUCTURE — never a momentum/oracle exit.
                "basis": BASIS_STRUCTURE_STOP,
                "strength": _strength(row),                 # of the nearest 3D row
                "price": px if px is not None else _num(row.get("close")),
                "stop_level": _num(w.get("level")),         # the swing low the close broke
                "reasons": ["distribution_confirmed", "structure_break"],
                "regime": {"weeklyBull": bool(row.get("w_bull")),
                           "above200": bool(row.get("above200")),
                           "monthlyBull": bool(row.get("mo_bull"))},
            })
    # ── RECLAIM from the v2 repair lane (scored re-entry since reclaim_lane promotion) ──
    # Two kinds ride the same marker type: "reclaim" (post-SELL trend reclaim) and
    # "block_repair" (a bear-blocked entry whose block legs cleared). ``scored`` mirrors
    # FLAGSHIP_PARAMS["reclaim_lane"]: True since the 2026-07-16 promotion (panel gates
    # G1–G5 passed post-exclusion), so these flip the position walk / manifest verdict and
    # the sim prices them (backtest.use_reclaim_entry). Pre-promotion slices in the wild
    # carry scored:false — every consumer treats those as display-only.
    reclaims = v2.get("reclaims") or []
    if reclaims and len(sig):
        sidx = sig.index
        for r in reclaims:
            j = int(sidx.searchsorted(pd.Timestamp(r["ts"]), side="right")) - 1
            if j < 0:
                continue
            kind = r.get("kind", "reclaim")
            is_stop_sweep = kind == "stop_sweep_reclaim"
            row = sig.iloc[j]
            if is_stop_sweep and "known_ts" in sig.columns:
                # A daily reclaim can land inside a 3D bar whose indicators are not yet
                # closed. Render on that bar, but read strength/regime only from the latest
                # 3D row already knowable on the reclaim session.
                event_day = pd.Timestamp(r["ts"])
                known = pd.to_datetime(sig["known_ts"], errors="coerce")
                safe = np.flatnonzero((known <= event_day).fillna(False).to_numpy())
                if len(safe):
                    row = sig.iloc[int(safe[-1])]
            ev = {
                "ts": r["ts"],
                "known_ts": _iso_date(r.get("known_ts"), r["ts"]),
                "bar_index": j,
                "type": "RECLAIM",
                "strength": _strength(row),
                # A stop-sweep reclaim is daily-grid, so use its own close rather than the
                # containing 3D row's later close. Legacy repairs keep their old fallback.
                "price": (_num(r.get("price")) if r.get("price") is not None
                          else _num(row.get("close"))),
                "scored": (False if is_stop_sweep
                           else bool(FLAGSHIP_PARAMS.get("reclaim_lane"))),
                "quality": kind,                 # reclaim | block_repair | stop_sweep_reclaim
                "quality_reason": (
                    f"price reclaimed the {r.get('anchor_ts')} structure-stop level within five sessions"
                    if is_stop_sweep else
                    (f"trend reclaimed the {r.get('anchor_ts')} sell level"
                     if kind == "reclaim"
                     else f"bear-block legs repaired after the {r.get('anchor_ts')} blocked entry")
                ),
                "reasons": (["close_reclaimed_stop_level", "within_5_sessions",
                             "failed_breakdown"] if is_stop_sweep else
                            (["close>sell_price", "weekly_bull", "above200", "debounced"]
                             if kind == "reclaim"
                             else ["bear_block_cleared", "macd_cross_still_live"])),
                "regime": {"weeklyBull": bool(row.get("w_bull")),
                           "above200": bool(row.get("above200")),
                           "monthlyBull": bool(row.get("mo_bull"))},
            }
            if is_stop_sweep:
                ev["anchor_ts"] = r.get("anchor_ts")
                for key in ("prior_stop_level", "sweep_low", "atr14", "stop_level",
                            "risk_basis"):
                    if r.get(key) is not None:
                        ev[key] = (_num(r[key]) if key != "risk_basis" else r[key])
            out.append(ev)

    # keep the unified stream ordered by bar_index (BUY/REBUY were already in order;
    # SELLs/RECLAIMs are appended out of order). Stable sort preserves same-bar ordering.
    out.sort(key=lambda e: e["bar_index"])
    return out


def _strength(row) -> float:
    """Crude 0..1 conviction from how many regime gates agree on the signal bar."""
    gates = [bool(row.get("w_bull")), bool(row.get("above200")),
             bool(row.get("mo_bull")), bool(row.get("w2_bull"))]
    return round(0.45 + 0.55 * (sum(gates) / len(gates)), 3)


def _state(sig: pd.DataFrame, signals: list[dict]) -> dict:
    """Model-facing position state, derived from the UNIFIED signal stream.

    CUT + CS-SELL are no longer emitted (see ``_extract_signals``). ``last_signal`` /
    ``bars_since_signal`` echo the raw stream tail, including display/watch events.
    ``position_hint`` / ``last_scored_signal`` / ``last_scored_ts`` walk the SCORED lane
    only: markers stamped ``quality='regime_blocked'`` are display artifacts the v2 entry
    logic refused ("never treat as an entry") and must not flip the position — a blocked
    BUY after a SELL leaves the hint flat and the scored verdict SELL. ``last_scored_ts``
    is the signal's availability date (``known_ts``), with a legacy fallback to its chart
    coordinate (``ts``). The scored fields diverge from ``last_signal`` exactly when the
    stream tail is a blocked marker.

    A ``quality='override_take'`` BUY/REBUY is the OPPOSITE case and walks the position
    normally: the live mask entered it (era gc_v2_wo1), so it is a scored entry in every
    sense. The exclusion below is written against ``blocked``/``regime_blocked`` by name
    precisely so a new entry class cannot be swept up in it — an override fire carries
    neither key, and the walk needs no clause of its own to let it through.

    ``last_scored_basis`` mirrors the anchoring signal's ``basis`` so the demotion to flat
    is READABLE (HK-O1 item 1): a SELL here flips ``position_hint`` to flat off a trailing
    structure stop, never off an oracle-momentum exit, and a consumer that reads only the
    state block can now tell which. None on every non-SELL anchor (basis is SELL-only)."""
    last = sig.iloc[-1] if len(sig) else None
    last_sig = signals[-1] if signals else None
    bars_since = (len(sig) - 1 - last_sig["bar_index"]) if last_sig else None

    # position hint from the last SCORED position event (blocked markers don't trade;
    # RECLAIM counts only when its emission was scored — pre-promotion display-tier
    # markers carry scored:false and stay out of the walk).
    pos = None
    last_scored = None
    for s in reversed(signals):
        if s["type"] in ("RECLAIM", "BOTTOM_WATCH") and not s.get("scored"):
            continue
        # a refused entry never walks the position — gate on the explicit ``blocked`` flag
        # AND the legacy quality string, so neither alone can re-open the 2026-07-15 hole.
        if s.get("blocked") is True or s.get("quality") == BLOCKED_QUALITY:
            continue
        if s["type"] in ("BUY", "REBUY", "SELL", "RECLAIM"):
            last_scored = s
            pos = "long" if s["type"] in ("BUY", "REBUY", "RECLAIM") else "flat"
            break
    strong_bull = bool(last is not None and last.get("strong_bull"))
    return {
        "position_hint": pos,
        "last_signal": last_sig["type"] if last_sig else None,
        "last_scored_signal": last_scored["type"] if last_scored else None,
        "last_scored_ts": (
            last_scored.get("known_ts") or last_scored["ts"]
            if last_scored else None
        ),
        # why the scored lane sits where it sits — "structure_stop" on a stopped-out flat.
        "last_scored_basis": (last_scored.get("basis") if last_scored else None),
        "bars_since_signal": bars_since,
        # ── the two ``extended``s (HK-O1 item 4 / forensic §2) ──────────────────────────
        # DEPRECATED ALIAS. This field carries ``strong_bull`` (weekly+monthly bull & above
        # 200d) — a STRENGTH read. It does NOT mean the Pine ``extended`` (overbought), and
        # it is NOT the Macro Dashboard cycles pipeline's "Extended — don't chase", which is
        # an entirely different engine (engine/cycles.py) whose caution rides ``overbought``
        # on this contract. Two meanings of one word landed on one stock card. Every reader
        # should take ``strong_bull`` or ``overbought`` by name; the alias survives only so
        # pre-2026-07-15 consumers keep parsing. Do not add new readers of ``extended``.
        "extended": strong_bull,
        "strong_bull": strong_bull,
        # the true Pine extendedNow — overbought on the last 3D row (RSI>=70 or %K>=80)
        "overbought": bool(
            last is not None
            and ((last.get("rsi14") or 0) >= FLAGSHIP_PARAMS["ext_rsi"]
                 or (last.get("k") or 0) >= 80)
        ),
        "weeklyBull": bool(last is not None and last.get("w_bull")),
        "above200": bool(last is not None and last.get("above200")),
    }


# ---------------------------------------------------------------- backtest ---
def backtest_contract(
    symbol: str,
    timeframe: str,
    bt: dict,
    *,
    strategy_id: str = "rsimacd_stochrsi_mtf",
    name: str = "RSI-MACD × StochRSI MTF confluence",
    params: dict | None = None,
    fill: str = "next_close",
    series_ref: str | None = None,
    honest_read: str = "",
) -> dict:
    """Build a ``backtest_result/v1`` doc from ``backtest.run_backtest`` output."""
    params = params or FLAGSHIP_PARAMS
    spec_hash = strategy_spec_hash(strategy_id, params)
    m = bt.get("metrics", {})
    return {
        "schema": SCHEMA_BACKTEST,
        "as_of": bt.get("last"),
        "status": bt.get("status", "ok"),
        "bar_quality": bt.get("bar_quality"),
        "strategy": {
            "id": strategy_id, "name": name, "source": "signal_layer/confluence.py",
            "spec_hash": spec_hash, "params": params, "fill": fill,
            "cost_bps": bt.get("cost_bps"), "slippage_bps": bt.get("slippage_bps"),
        },
        "universe": {"ticker": symbol, "timeframe": timeframe,
                     "start": bt.get("first"), "end": bt.get("last"), "bars": bt.get("bars")},
        "metrics": m,
        "trades": bt.get("trades", []),
        "series_ref": series_ref,    # loop.harness consumes the parquet at this path
        "validation": None,          # null until loop/harness is invoked (keeps per-chart runs cheap)
        "honest_read": honest_read,
    }


# ---------------------------------------------------------------- the slice --
def model_slice(contract: dict) -> dict:
    """Project a contract down to the MODEL-FACING surface only.

    Strips ``bars``/``series``/``gates`` (indicator) and ``trades``/``_returns``
    (backtest) so the brain never ingests raw float arrays. This is the cost/context
    guardrail (research doc §4 P0-4 / D9) — enforce it at the read boundary.
    """
    s = contract.get("schema")
    if s == SCHEMA_INDICATOR:
        return {
            "schema": s, "indicator_id": contract["indicator"]["id"],
            "symbol": contract["symbol"], "timeframe": contract["timeframe"],
            "as_of": contract.get("as_of"), "bar_quality": contract.get("bar_quality"),
            # the era rides into the model surface too: a reader pooling slices needs to
            # know which rule produced each one, and this is the only place it can see it.
            "signal_era": contract.get("signal_era", SIGNAL_ERA_PRE),
            "macd_kind": contract["indicator"].get("macd_kind"),
            "signals": contract.get("signals", [])[-12:],   # cap the history sent to the model
            "state": contract.get("state", {}),
            # v2 side channels (small; safe to send) — cap to the recent window.
            "early_dots": contract.get("early_dots", [])[-12:],
            "warnings": contract.get("warnings", [])[-12:],
            "score_basis": contract.get("meta", {}).get("score_basis", "full"),
            "honest_read": contract.get("meta", {}).get("honest_read", ""),
        }
    if s == SCHEMA_BACKTEST:
        return {
            "schema": s, "strategy_id": contract["strategy"]["id"],
            "symbol": contract["universe"]["ticker"], "as_of": contract.get("as_of"),
            "bar_quality": contract.get("bar_quality"),
            "metrics": contract.get("metrics", {}),       # scalars only — safe to send
            "n_trades": contract.get("metrics", {}).get("n_trades"),
            "validation": contract.get("validation"),
            "honest_read": contract.get("honest_read", ""),
        }
    raise ValueError(f"unknown contract schema: {s!r}")


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(f):
        return None
    return round(f, 6)


def _cutoff(sig: pd.DataFrame, bars: list[str], bar_closed: bool | None) -> dict | None:
    """``{session, bar_open, bar_closed}`` for the bar ``state`` describes, or None when the
    frame cannot state one (empty, or no ``known_ts`` column — a legacy/synthetic frame).

    ``session`` is the last row's ``known_ts`` (the last daily session the engine consumed);
    ``bar_open`` is that row's 3D opening session. A frame whose bar opens after its own
    availability session would be a future-bar leak; it publishes no cutoff rather than an
    inverted one."""
    if not bars or "known_ts" not in getattr(sig, "columns", ()):
        return None
    session = _iso_date(sig["known_ts"].iloc[-1], "")
    bar_open = bars[-1]
    if not session or bar_open > session:
        return None
    return {
        "session": session,
        "bar_open": bar_open,
        "bar_closed": bar_closed if isinstance(bar_closed, bool) else None,
    }


def _iso_date(value, fallback: str) -> str:
    """Return an ISO availability date, falling back for legacy/synthetic frames."""
    try:
        if value is None or pd.isna(value):
            return fallback
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return fallback
