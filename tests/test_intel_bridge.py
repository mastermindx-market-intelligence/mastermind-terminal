"""Tests for the intel bridge contract fix (#18).

Two main fixture groups:
  1. No-BULL-on-neutral: the A.json live case — ladder.dir='up' while
     decision.band='neutral', score=50, entry_signal.status='hold' must NOT
     produce ai_lean.dir='BULL'.
  2. Stale-file abstention: a record with asof older than MAX_STALE_DAYS must
     produce ai_lean={'abstain': True, ...} and NOT expose a dir field.

Additional table-driven cases cover the full mapping table.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.pull_macro_intel import (  # noqa: E402
    _map_ai_dir, build_intel, _is_stale, _build_sector_pulse, _build_washout_turn,
)


# ── helpers ────────────────────────────────────────────────────────────────────

def _src(
    *,
    asof: str = "2026-07-01",
    band: str = "neutral",
    entry_status: str = "hold",
    score: float = 50.0,
    verdict: str = "Neutral — no clear edge",
    ladder_dir: str = "up",
    ladder_regime: str = "MIXED",
) -> dict:
    """Build a minimal stockdata dict for testing."""
    return {
        "asof": asof,
        "view": {
            "decision": {
                "band": band,
                "score": score,
                "headline": verdict,
                "gloss": None,
            }
        },
        "conviction": {
            "verdict": verdict,
            "score": score,
            "band_en": band.capitalize(),
            "drivers": None,
            "cautions": [],
        },
        "ladder": {
            "dir": ladder_dir,
            "regime_label": ladder_regime,
        },
        "entry_signal": {
            "status": entry_status,
        },
        "gex": {},
        "positioning": {},
        "revisions": {},
        "valuation": {},
        "analyst": {},
        "smart_money": {},
    }


TODAY = date(2026, 7, 1)  # deterministic for all tests


# ── fixture 1: no BULL on neutral (the A.json live case) ──────────────────────

class TestNoBullOnNeutral:
    """The exact field values from A.json (asof 2026-06-26, verified 2026-07-01)."""

    def _build(self, **overrides):
        src = _src(
            asof="2026-07-01",  # fresh so freshness gate doesn't fire
            band="neutral",
            entry_status="hold",
            score=50.0,
            verdict="Neutral — no clear edge",
            ladder_dir="up",   # ← the old bug: this alone used to produce BULL
            ladder_regime="MIXED",
            **overrides,
        )
        return build_intel("A", src, today=TODAY)

    def test_no_bull_direction(self):
        intel = self._build()
        lean = intel["tape"]["ai_lean"]
        assert "abstain" not in lean, "should not abstain on fresh data"
        assert lean["dir"] != "BULL", (
            f"BULL emitted on neutral band + hold entry — got dir={lean['dir']!r}\n"
            f"band={lean.get('band')!r}, entry={lean.get('entry')!r}, score={lean.get('score')}"
        )

    def test_neutral_direction(self):
        intel = self._build()
        lean = intel["tape"]["ai_lean"]
        assert lean["dir"] == "NEUTRAL", f"expected NEUTRAL, got {lean['dir']!r}"

    def test_score_passthrough(self):
        intel = self._build()
        assert intel["tape"]["ai_lean"]["score"] == 50.0

    def test_band_and_entry_in_lean(self):
        """Lean must expose band + entry so the panel can display the rationale."""
        lean = self._build()["tape"]["ai_lean"]
        assert lean["band"] == "neutral"
        assert lean["entry"] == "hold"

    def test_not_stale(self):
        assert self._build()["tape"]["stale"] is False


# ── fixture 2: stale file abstention ──────────────────────────────────────────

class TestStalenessAbstention:
    """Files with asof older than MAX_STALE_DAYS must cause abstention."""

    def test_5_day_old_abstains(self):
        src = _src(asof="2026-06-25", band="high", entry_status="buy_now", score=90.0)
        intel = build_intel("X", src, today=TODAY)
        lean = intel["tape"]["ai_lean"]
        assert lean.get("abstain") is True, (
            f"stale file (asof=2026-06-25) should abstain; got lean={lean}"
        )
        assert "dir" not in lean, "stale lean must not expose dir"
        assert intel["tape"]["stale"] is True

    def test_6_day_old_abstains(self):
        src = _src(asof="2026-06-24", band="high", entry_status="buy_now", score=95.0)
        intel = build_intel("X", src, today=TODAY)
        assert intel["tape"]["ai_lean"].get("abstain") is True

    def test_same_day_does_not_abstain(self):
        src = _src(asof="2026-07-01", band="high", entry_status="buy_now", score=90.0)
        intel = build_intel("X", src, today=TODAY)
        lean = intel["tape"]["ai_lean"]
        assert "abstain" not in lean
        assert lean["dir"] == "BULL"
        assert lean["max_age_days"] == 5

    def test_fresh_source_without_direction_inputs_abstains(self):
        tape = build_intel("X", {"asof": "2026-07-01"}, today=TODAY)["tape"]
        assert tape["stale"] is False
        assert tape["ai_lean"] == {"abstain": True, "reason": "missing_direction"}

    def test_preserves_supplied_timing_without_manufacturing_direction(self):
        src = _src(asof="2026-07-01", band="", entry_status="wait_pullback")
        lean = build_intel("X", src, today=TODAY)["tape"]["ai_lean"]
        assert lean == {"entry": "wait_pullback", "max_age_days": 5}

    def test_future_source_withholds_direction_and_live_context(self):
        src = _src(asof="2026-07-02", band="high", entry_status="buy_now", score=90.0)
        src["sector_pulse"] = _FULL_PULSE
        tape = build_intel("X", src, today=TODAY)["tape"]
        assert tape["stale"] is True
        assert tape["ai_lean"] == {"abstain": True, "reason": "stale"}
        assert "sector_pulse" not in tape

    def test_missing_asof_abstains(self):
        src = _src(asof="2026-07-01")
        src.pop("asof")
        intel = build_intel("X", src, today=TODAY)
        assert intel["tape"]["ai_lean"].get("abstain") is True

    def test_4_day_old_does_not_abstain(self):
        """4 calendar days is within the 5-day window — should NOT abstain."""
        src = _src(asof="2026-06-27", band="high", entry_status="buy_now", score=90.0)
        intel = build_intel("X", src, today=TODAY)
        lean = intel["tape"]["ai_lean"]
        assert "abstain" not in lean
        assert lean["dir"] == "BULL"


# ── mapping table: full value-set coverage ────────────────────────────────────

@pytest.mark.parametrize("band,entry,expected_dir", [
    # Bullish: high band + buy entry
    ("high",         "buy_now",       "BULL"),
    ("high",         "buy_soon",      "BULL"),
    ("high",         "partial",       "BULL"),
    ("constructive", "buy_now",       "BULL"),
    ("constructive", "buy_soon",      "BULL"),
    ("constructive", "partial",       "BULL"),
    # High band but no confirmed entry → NEUTRAL
    ("high",         "hold",          "NEUTRAL"),
    ("high",         "blocked",       "NEUTRAL"),
    ("high",         "extended",      "NEUTRAL"),
    ("high",         "watch",         "NEUTRAL"),
    ("high",         "wait_pullback", "NEUTRAL"),
    # Constructive band but no confirmed entry → NEUTRAL
    ("constructive", "hold",          "NEUTRAL"),
    ("constructive", "blocked",       "NEUTRAL"),
    ("constructive", "watch",         "NEUTRAL"),
    ("constructive", "wait_pullback", "NEUTRAL"),
    # Neutral band → always NEUTRAL regardless of entry
    ("neutral",      "buy_now",       "NEUTRAL"),
    ("neutral",      "buy_soon",      "NEUTRAL"),
    ("neutral",      "hold",          "NEUTRAL"),
    ("neutral",      "blocked",       "NEUTRAL"),
    # Low band → BEAR regardless of entry
    ("low",          "hold",          "BEAR"),
    ("low",          "extended",      "BEAR"),
    ("low",          "caution",       "BEAR"),
    ("low",          "buy_now",       "BEAR"),  # low band overrides buy entry
    # Exit/topping entry → BEAR regardless of band
    ("high",         "exit",          "BEAR"),
    ("constructive", "topping",       "BEAR"),
    ("neutral",      "exit",          "BEAR"),
    # Missing / empty band → NEUTRAL
    ("",             "buy_now",       "NEUTRAL"),
    (None,           "buy_now",       "NEUTRAL"),
    ("high",         "",              "NEUTRAL"),
    ("high",         None,            "NEUTRAL"),
])
def test_mapping_table(band, entry, expected_dir):
    result = _map_ai_dir(band, entry)
    assert result == expected_dir, (
        f"_map_ai_dir({band!r}, {entry!r}) = {result!r}, expected {expected_dir!r}"
    )


# ── consistency guard: BULL must not have score < 55 ─────────────────────────

class TestConsistencyGuard:
    def test_bull_with_low_score_demoted(self):
        """If band=high+entry=buy_now but score=45, demote to NEUTRAL."""
        src = _src(
            asof="2026-07-01",
            band="high",
            entry_status="buy_now",
            score=45.0,
            ladder_dir="up",
        )
        intel = build_intel("X", src, today=TODAY)
        lean = intel["tape"]["ai_lean"]
        assert lean["dir"] == "NEUTRAL", (
            f"BULL with score=45 must be demoted; got dir={lean['dir']!r}"
        )

    def test_bear_with_high_score_demoted(self):
        """If band=low+entry=hold but score=70, demote to NEUTRAL."""
        src = _src(
            asof="2026-07-01",
            band="low",
            entry_status="hold",
            score=70.0,
        )
        intel = build_intel("X", src, today=TODAY)
        lean = intel["tape"]["ai_lean"]
        assert lean["dir"] == "NEUTRAL", (
            f"BEAR with score=70 must be demoted; got dir={lean['dir']!r}"
        )

    def test_bull_with_adequate_score_not_demoted(self):
        src = _src(
            asof="2026-07-01",
            band="high",
            entry_status="buy_now",
            score=87.0,
        )
        intel = build_intel("X", src, today=TODAY)
        assert intel["tape"]["ai_lean"]["dir"] == "BULL"


# ── _is_stale unit tests ──────────────────────────────────────────────────────

@pytest.mark.parametrize("asof,max_days,expected", [
    ("2026-07-01", 5, False),   # same day
    ("2026-06-30", 5, False),   # 1 day old
    ("2026-06-27", 5, False),   # 4 days old
    ("2026-06-26", 5, True),    # 5 days old (exactly at boundary → stale)
    ("2026-06-25", 5, True),    # 6 days old
    (None,         5, True),    # missing
    ("",           5, True),    # empty
    ("invalid",    5, True),    # unparseable
    ("2026-07-02", 5, True),    # future session
    ("2026-07-01garbage", 5, True),
    ("2026-02-30", 5, True),
    ("2026-06-30T19:30:00Z", 5, False),  # valid timestamp from an earlier session
])
def test_is_stale(asof, max_days, expected):
    from ingest.pull_macro_intel import _is_stale
    result = _is_stale(asof, date(2026, 7, 1), max_days)
    assert result == expected, f"_is_stale({asof!r}, ..., {max_days}) = {result}, expected {expected}"


# ── sector_pulse pass-through tests ──────────────────────────────────────────

_FULL_PULSE = {
    "theme_id": "AIINFRA",
    "theme_name": "AI Infrastructure",
    "theme_name_zh": "人工智能基础设施",
    "heat": "heating",
    "label": "Accelerating",
    "reco": "overweight",
    "rank": 3,
    "n_themes": 46,
    "rank_delta_5d": -2.0,
    "theme_ids": ["AIINFRA", "SEMIS"],
    "as_of": "2026-07-01",
}


class TestSectorPulseHelper:
    """Unit tests for _build_sector_pulse helper."""

    def test_full_valid_pulse_passes_through(self):
        out = _build_sector_pulse(_FULL_PULSE)
        assert out is not None
        assert out["heat"] == "heating"
        assert out["theme_id"] == "AIINFRA"
        assert out["theme_name"] == "AI Infrastructure"
        assert out["rank"] == 3
        assert out["n_themes"] == 46
        assert out["rank_delta_5d"] == -2.0
        assert out["as_of"] == "2026-07-01"

    def test_internal_fields_omitted(self):
        """theme_name_zh and theme_ids must NOT leak into terminal output."""
        out = _build_sector_pulse(_FULL_PULSE)
        assert out is not None
        assert "theme_name_zh" not in out
        assert "theme_ids" not in out

    def test_all_valid_heat_values_accepted(self):
        for heat in ("heating", "hot", "cooling", "broken", "idle"):
            pulse = {**_FULL_PULSE, "heat": heat}
            out = _build_sector_pulse(pulse)
            assert out is not None and out["heat"] == heat, f"heat={heat!r} was rejected"

    def test_unknown_heat_rejected(self):
        pulse = {**_FULL_PULSE, "heat": "unknown_future_value"}
        assert _build_sector_pulse(pulse) is None

    def test_missing_heat_returns_none(self):
        pulse = {k: v for k, v in _FULL_PULSE.items() if k != "heat"}
        assert _build_sector_pulse(pulse) is None

    def test_none_input_returns_none(self):
        assert _build_sector_pulse(None) is None

    def test_non_dict_input_returns_none(self):
        assert _build_sector_pulse("heating") is None
        assert _build_sector_pulse([]) is None

    def test_optional_fields_omitted_gracefully(self):
        """Sparse pulse with only required fields must not raise."""
        minimal = {"heat": "hot"}
        out = _build_sector_pulse(minimal)
        assert out is not None
        assert out["heat"] == "hot"
        assert "rank" not in out
        assert "n_themes" not in out


class TestSectorPulseBuildIntel:
    """Integration tests: sector_pulse in build_intel output."""

    def _src_with_pulse(self, pulse, asof="2026-07-01", **kwargs):
        src = _src(asof=asof, **kwargs)
        src["sector_pulse"] = pulse
        return src

    def test_fresh_with_pulse_emits_sector_pulse(self):
        src = self._src_with_pulse(_FULL_PULSE)
        intel = build_intel("NVDA", src, today=TODAY)
        assert "sector_pulse" in intel["tape"], "sector_pulse must be present when fresh"
        assert intel["tape"]["sector_pulse"]["heat"] == "heating"

    def test_fresh_without_pulse_omits_field(self):
        """No sector_pulse in source → field absent (not null) in output."""
        intel = build_intel("NVDA", _src(), today=TODAY)
        assert "sector_pulse" not in intel["tape"], (
            "sector_pulse must be absent (not null) when not in source"
        )

    def test_fresh_with_null_pulse_omits_field(self):
        src = _src()
        src["sector_pulse"] = None
        intel = build_intel("NVDA", src, today=TODAY)
        assert "sector_pulse" not in intel["tape"]

    def test_stale_with_pulse_drops_sector_pulse(self):
        """When the record is stale, sector_pulse must NOT appear even if present."""
        src = self._src_with_pulse(_FULL_PULSE, asof="2026-06-25")  # 6 days old → stale
        intel = build_intel("NVDA", src, today=TODAY)
        assert intel["tape"]["stale"] is True
        assert "sector_pulse" not in intel["tape"], (
            "sector_pulse must be dropped when tape is stale"
        )

    def test_fresh_with_unknown_heat_omits_field(self):
        """Unknown heat values must not reach the terminal."""
        pulse = {**_FULL_PULSE, "heat": "mystery"}
        src = self._src_with_pulse(pulse)
        intel = build_intel("NVDA", src, today=TODAY)
        assert "sector_pulse" not in intel["tape"]

    def test_rank_and_n_themes_are_ints(self):
        intel = build_intel("NVDA", self._src_with_pulse(_FULL_PULSE), today=TODAY)
        sp = intel["tape"]["sector_pulse"]
        assert isinstance(sp["rank"], int)
        assert isinstance(sp["n_themes"], int)


# ── washout_turn pass-through tests ──────────────────────────────────────────
# The weekly dual-read row's source block (macro engine/washout_turn.py). The
# reference shape is MCD's 2026-07-31 cross at the 6.3rd depth percentile — the
# miss the row exists to surface.

_FULL_WT = {
    "state": "WASHOUT_TURN",
    "since": "2026-07-31",
    "weeks_since_cross": 1,
    "depth_pctile": 6.28,
    "depth_pctile_at_cross": 6.3,
    "line": -1.84,
    "sig": -2.01,
    "hist": 0.17,
    "stoch_k": 18.4,
    "stoch_d": 14.9,
    "weekly_cb": True,
    "drawdown_pct": -22.7,
    "data_through": "2026-06-30",
    "history_weeks": 780,
    "history_start": "2011-07-01",
    "history": {"n": 11, "med_13w": 4.24, "med_26w": 7.9, "win_13w": 63.6, "win_26w": 72.7},
}


class TestWashoutTurnHelper:
    """Unit tests for _build_washout_turn helper."""

    def test_full_valid_block_passes_through_trimmed(self):
        out = _build_washout_turn(_FULL_WT)
        assert out is not None
        assert out["state"] == "WASHOUT_TURN"
        assert out["since"] == "2026-07-31"
        assert out["depth_pctile"] == 6.3        # _r(…, 1)
        assert out["data_through"] == "2026-06-30"
        assert out["history"] == {"n": 11, "med_13w": 4.2, "med_26w": 7.9}

    def test_internal_fields_omitted(self):
        """Engine internals must NOT leak into terminal output."""
        out = _build_washout_turn(_FULL_WT)
        assert out is not None
        for key in ("line", "sig", "hist", "stoch_k", "stoch_d", "weekly_cb",
                    "drawdown_pct", "weeks_since_cross", "depth_pctile_at_cross",
                    "history_weeks", "history_start"):
            assert key not in out, f"{key} must not reach the terminal"
        assert "win_13w" not in out["history"]
        assert "win_26w" not in out["history"]

    def test_both_valid_states_accepted(self):
        for state in ("WASHOUT_TURN", "TURN_WATCH"):
            out = _build_washout_turn({**_FULL_WT, "state": state})
            assert out is not None and out["state"] == state, f"state={state!r} was rejected"

    def test_unknown_state_rejected(self):
        assert _build_washout_turn({**_FULL_WT, "state": "SOME_FUTURE_STATE"}) is None
        assert _build_washout_turn({**_FULL_WT, "state": "washout_turn"}) is None  # case-exact

    def test_missing_state_returns_none(self):
        wt = {k: v for k, v in _FULL_WT.items() if k != "state"}
        assert _build_washout_turn(wt) is None

    def test_none_input_returns_none(self):
        assert _build_washout_turn(None) is None

    def test_non_dict_input_returns_none(self):
        assert _build_washout_turn("WASHOUT_TURN") is None
        assert _build_washout_turn([]) is None

    def test_null_optional_fields_omitted_not_nulled(self):
        wt = {**_FULL_WT, "since": None, "depth_pctile": None, "data_through": None}
        out = _build_washout_turn(wt)
        assert out is not None
        for key in ("since", "depth_pctile", "data_through"):
            assert key not in out, f"{key} must be omitted, never null"
        assert out["state"] == "WASHOUT_TURN"

    def test_null_medians_omitted_history_keeps_n(self):
        """The thin-history case: n survives, the null medians do not."""
        wt = {**_FULL_WT, "history": {"n": 1, "med_13w": None, "med_26w": None,
                                      "reason": "insufficient_events"}}
        out = _build_washout_turn(wt)
        assert out is not None
        assert out["history"] == {"n": 1}

    def test_empty_history_dropped_whole(self):
        wt = {**_FULL_WT, "history": {"n": None, "med_13w": None, "med_26w": None}}
        out = _build_washout_turn(wt)
        assert out is not None
        assert "history" not in out, "an empty history block must be dropped, not emitted as {}"

    def test_non_dict_history_dropped(self):
        wt = {**_FULL_WT, "history": None}
        out = _build_washout_turn(wt)
        assert out is not None and "history" not in out

    def test_uncoercible_n_omitted(self):
        wt = {**_FULL_WT, "history": {"n": "many", "med_13w": 4.2, "med_26w": 7.9}}
        out = _build_washout_turn(wt)
        assert out is not None
        assert "n" not in out["history"]
        assert out["history"]["med_13w"] == 4.2

    def test_minimal_block_state_only(self):
        out = _build_washout_turn({"state": "TURN_WATCH"})
        assert out == {"state": "TURN_WATCH"}

    def test_n_is_int(self):
        out = _build_washout_turn({**_FULL_WT, "history": {"n": 11.0}})
        assert out is not None
        assert isinstance(out["history"]["n"], int)


class TestWashoutTurnBuildIntel:
    """Integration tests: washout_turn in build_intel output."""

    def _src_with_wt(self, wt, asof="2026-07-01", **kwargs):
        src = _src(asof=asof, **kwargs)
        src["washout_turn"] = wt
        return src

    def test_fresh_with_turn_emits_washout_turn(self):
        intel = build_intel("MCD", self._src_with_wt(_FULL_WT), today=TODAY)
        assert "washout_turn" in intel["tape"], "washout_turn must be present when fresh"
        assert intel["tape"]["washout_turn"]["state"] == "WASHOUT_TURN"
        assert intel["tape"]["washout_turn"]["depth_pctile"] == 6.3

    def test_fresh_with_watch_emits_washout_turn(self):
        src = self._src_with_wt({**_FULL_WT, "state": "TURN_WATCH"})
        intel = build_intel("MCD", src, today=TODAY)
        assert intel["tape"]["washout_turn"]["state"] == "TURN_WATCH"

    def test_fresh_without_block_omits_field(self):
        """No washout_turn in source → field absent (not null) in output."""
        intel = build_intel("MCD", _src(), today=TODAY)
        assert "washout_turn" not in intel["tape"], (
            "washout_turn must be absent (not null) when not in source"
        )

    def test_fresh_with_null_block_omits_field(self):
        src = _src()
        src["washout_turn"] = None
        intel = build_intel("MCD", src, today=TODAY)
        assert "washout_turn" not in intel["tape"]

    def test_stale_with_turn_drops_washout_turn(self):
        """A stale weekly window must never render as a live one."""
        src = self._src_with_wt(_FULL_WT, asof="2026-06-25")  # 6 days old → stale
        intel = build_intel("MCD", src, today=TODAY)
        assert intel["tape"]["stale"] is True
        assert "washout_turn" not in intel["tape"], (
            "washout_turn must be dropped when tape is stale"
        )

    def test_fresh_with_unknown_state_omits_field(self):
        """Unknown states must not reach the terminal."""
        src = self._src_with_wt({**_FULL_WT, "state": "mystery"})
        intel = build_intel("MCD", src, today=TODAY)
        assert "washout_turn" not in intel["tape"]

    def test_sector_pulse_and_washout_turn_coexist(self):
        """The two pass-throughs are independent — neither shadows the other."""
        src = self._src_with_wt(_FULL_WT)
        src["sector_pulse"] = _FULL_PULSE
        intel = build_intel("MCD", src, today=TODAY)
        assert intel["tape"]["sector_pulse"]["heat"] == "heating"
        assert intel["tape"]["washout_turn"]["state"] == "WASHOUT_TURN"
