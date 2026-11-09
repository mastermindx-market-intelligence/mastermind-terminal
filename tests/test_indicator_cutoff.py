"""The completed-bar cutoff the indicator contract publishes (screener scan contract, E01).

``indicator_contract`` stamps ``cutoff = {session, bar_open, bar_closed}`` so a reader (the
screener scan, ``ingest/gen_technical_scan.py``) can say WHICH DATA a state was computed
from without inferring it. Three properties are pinned here:

1. ``three_day_bar_closed`` restates the oracle's session grouping exactly — it is checked
   bar-for-bar against ``confluence._3d_groups`` (the oracle itself is never edited).
2. The stamp is read from the engine frame (``known_ts`` / the bar index), never guessed;
   a frame that cannot state it publishes ``None``, and an inverted bar is refused.
3. AC-E01-01 full-versus-prefix: at every CLOSED cutoff, the state the scan projects from a
   prefix-only computation equals the full computation restricted to what was knowable at
   that session. A forming cutoff is disclosed as forming (``bar_closed: False``).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from signal_layer import confluence, confluence_v2, contracts  # noqa: E402
from tests._synthetic_tape import synthetic_close  # noqa: E402

# The keys the screener scan projects from ``state`` (terminal/lib/technicalScan.ts
# TECHNICAL_STATE_KEYS). ``extended`` is the deprecated alias and is never projected.
SCAN_STATE_KEYS = (
    "position_hint", "last_signal", "last_scored_signal", "last_scored_ts",
    "last_scored_basis", "bars_since_signal", "strong_bull", "overbought",
    "weeklyBull", "above200",
)

# Display annotations the v2 keeper resolves over its confirmation window (CHARTER §7:
# take/block/pending). A prefix truthfully reports "pending" for a BUY whose window has
# not elapsed; the full computation later resolves it. Not projected to the scan, and not
# read by ``_state`` (which gates only on ``blocked`` / ``regime_blocked``).
CONFIRMATION_DISPLAY_FIELDS = {"quality", "quality_reason"}


def _emit(close: pd.Series, bar_anchor: int = 0) -> tuple[pd.DataFrame, dict]:
    sig = confluence.compute_signals(close, bar_anchor=bar_anchor)
    v2 = confluence_v2.build_v2(sig, close)
    ind = contracts.indicator_contract(
        "SYNTH", "3D", sig, bar_quality="real_ohlc", src_text="", honest_read="", v2=v2,
        bar_closed=contracts.three_day_bar_closed(close, bar_anchor))
    return sig, ind


@pytest.fixture(scope="module")
def tape() -> pd.Series:
    return synthetic_close()


@pytest.fixture(scope="module")
def full(tape):
    return _emit(tape)


# ── 1. the phase helper restates the oracle's grouping ─────────────────────────────────
@pytest.mark.parametrize("anchor", range(0, 6))
def test_three_day_bar_closed_matches_oracle_grouping(anchor):
    close = pd.Series(np.arange(1, 41, dtype="float64"),
                      index=pd.bdate_range("2025-01-02", periods=40))
    for n in range(1, 40):
        prefix, longer = close.iloc[:n], close.iloc[: n + 1]
        opens_now = len(confluence._3d_groups(prefix, anchor)[0])
        opens_next = len(confluence._3d_groups(longer, anchor)[0])
        # the last bar is complete exactly when one more session opens a NEW bar
        oracle_closed = opens_next == opens_now + 1
        assert contracts.three_day_bar_closed(prefix, anchor) is oracle_closed, (anchor, n)
        # and a complete bar's close session never moves when more sessions arrive
        if oracle_closed:
            last_close_now = confluence._3d_groups(prefix, anchor)[1][-1]
            assert last_close_now in set(confluence._3d_groups(close, anchor)[1])


def test_three_day_bar_closed_ignores_gaps_and_rejects_empty():
    idx = pd.bdate_range("2025-01-02", periods=7)
    close = pd.Series([1.0, np.nan, 2.0, 3.0, np.nan, 4.0, 5.0], index=idx)
    # five real sessions (NaN rows are not sessions — _3d_groups drops them too)
    assert contracts.three_day_bar_closed(close, 0) is ((5 - 1) % 3 == 0)
    assert contracts.three_day_bar_closed(close.iloc[:0], 0) is None
    assert contracts.three_day_bar_closed(pd.Series([np.nan], index=idx[:1]), 0) is None


# ── 2. the stamp is read from the engine frame ─────────────────────────────────────────
def test_cutoff_is_read_from_the_engine_frame(tape, full):
    sig, ind = full
    cut = ind["cutoff"]
    assert cut == {
        "session": sig["known_ts"].iloc[-1].strftime("%Y-%m-%d"),
        "bar_open": sig.index[-1].strftime("%Y-%m-%d"),
        "bar_closed": contracts.three_day_bar_closed(tape, 0),
    }
    # the last session the engine consumed IS the tape's last session
    assert cut["session"] == tape.index[-1].strftime("%Y-%m-%d")
    # bar_open is the indicator's own 3D identity (as_of date), never after the session
    assert ind["as_of"].startswith(cut["bar_open"])
    assert cut["bar_open"] <= cut["session"]


@pytest.mark.parametrize("value, published", [(True, True), (False, False), (None, None),
                                               ("yes", None), (1, None)])
def test_bar_closed_is_passed_through_verbatim_or_unstated(full, value, published):
    sig, _ = full
    ind = contracts.indicator_contract("SYNTH", "3D", sig, bar_closed=value)
    assert ind["cutoff"]["bar_closed"] is published


def test_cutoff_defaults_to_an_unstated_phase_for_unwired_callers(full):
    sig, _ = full
    ind = contracts.indicator_contract("SYNTH", "3D", sig)
    assert ind["cutoff"]["bar_closed"] is None
    assert ind["cutoff"]["session"] and ind["cutoff"]["bar_open"]


def test_frames_that_cannot_state_a_cutoff_publish_none(full):
    sig, _ = full
    assert contracts.indicator_contract("SYNTH", "3D", sig.iloc[:0])["cutoff"] is None
    legacy = sig.drop(columns=["known_ts"])
    assert contracts.indicator_contract("SYNTH", "3D", legacy)["cutoff"] is None
    # a bar that opens AFTER its own availability session is a future-bar leak: refused
    inverted = sig.copy()
    inverted.loc[inverted.index[-1], "known_ts"] = inverted.index[-1] - pd.Timedelta(days=5)
    assert contracts.indicator_contract("SYNTH", "3D", inverted)["cutoff"] is None


def test_cutoff_survives_the_broad_slice_slimming(full):
    """gen_slices_all pops the heavy chart arrays before writing; the cutoff is not one."""
    _, ind = full
    slim = dict(ind)
    for heavy in ("series", "gates", "bars"):
        slim.pop(heavy, None)
    assert slim["cutoff"] == ind["cutoff"]
    assert json.loads(json.dumps(slim))["cutoff"] == ind["cutoff"]


def test_model_slice_carries_no_cutoff(full):
    """fast_flagship publishes model_slice (intraday-spliced, forming). It must stay
    unqualified for the scan, so the projection does not carry the cutoff."""
    _, ind = full
    assert "cutoff" not in contracts.model_slice(ind)


@pytest.mark.parametrize("writer", [
    "ingest/gen_slices_all.py",
    "ingest/regen_slices.py",
    "ingest/regen_flagship_slices.py",
    "ingest/build_polygon_universe.py",
])
def test_every_full_contract_writer_publishes_the_phase(writer):
    src = (ROOT / writer).read_text()
    assert "bar_closed=contracts.three_day_bar_closed(" in src, writer


# ── 3. AC-E01-01: full versus prefix ───────────────────────────────────────────────────
def _signal_key(s: dict) -> dict:
    return {k: v for k, v in s.items() if k not in CONFIRMATION_DISPLAY_FIELDS}


def _closed_prefix_lengths(tape: pd.Series, start: int, stride: int) -> list[int]:
    out = [n for n in range(start, len(tape) + 1)
           if contracts.three_day_bar_closed(tape.iloc[:n], 0)]
    return out[::stride]


def test_closed_cutoff_state_uses_no_future_bars(tape, full):
    full_sig, full_ind = full
    checked = 0
    for n in _closed_prefix_lengths(tape, 400, 9):
        p_sig, p_ind = _emit(tape.iloc[:n])
        cut = p_ind["cutoff"]
        assert cut["bar_closed"] is True
        session = cut["session"]
        assert session == tape.index[n - 1].strftime("%Y-%m-%d")

        # the closed bar's engine row is identical whether or not later bars exist
        k = len(p_sig)
        assert full_sig.index[k - 1] == p_sig.index[-1]
        assert full_sig["known_ts"].iloc[k - 1] == p_sig["known_ts"].iloc[-1]

        # the full stream restricted to what was knowable at the session
        known = [s for s in full_ind["signals"] if (s.get("known_ts") or s["ts"]) <= session]
        assert [_signal_key(s) for s in known] == [_signal_key(s) for s in p_ind["signals"]]
        for f, p in zip(known, p_ind["signals"]):
            for field in CONFIRMATION_DISPLAY_FIELDS:
                if f.get(field) != p.get(field):
                    # only an unelapsed confirmation window may differ, and the prefix
                    # says so instead of guessing the verdict
                    assert p.get("quality") == "pending", (session, f, p)

        # the projected scan state, from the full computation as of that session, equals
        # the prefix computation's — field for field
        full_as_of = contracts._state(full_sig.iloc[:k], known)
        for key in SCAN_STATE_KEYS:
            assert full_as_of[key] == p_ind["state"][key], (session, key)
        checked += 1
    assert checked >= 25


def test_forming_cutoff_is_disclosed_not_passed_off_as_closed(tape, full):
    full_sig, _ = full
    forming = [n for n in range(400, 460) if contracts.three_day_bar_closed(tape.iloc[:n], 0) is False]
    assert forming
    for n in forming:
        p_sig, p_ind = _emit(tape.iloc[:n])
        cut = p_ind["cutoff"]
        assert cut["bar_closed"] is False
        # the forming bar's availability session is BEFORE the session that closes it
        k = len(p_sig)
        assert p_sig["known_ts"].iloc[-1] < full_sig["known_ts"].iloc[k - 1]
        assert cut["bar_open"] == full_sig.index[k - 1].strftime("%Y-%m-%d")
