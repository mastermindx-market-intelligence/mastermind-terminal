"""Contract tests for the shadow-only intraday dislocation R0 core."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from signal_layer.intraday_dislocation import (
    CatalystStatus,
    CoverageStatus,
    DislocationFeatures,
    DislocationState,
    MarketBasis,
    TransitionEvidence,
    advance_state,
    effective_catalyst_status,
    empirical_downside_severity,
    event_id,
    qualify_dislocation,
    residual_return,
    robust_location_scale,
    robust_z,
    validate_event_times,
)


def _shock(**overrides) -> DislocationFeatures:
    base = dict(
        z_by_horizon={5: -3.5, 15: -2.2},
        severity_by_horizon={5: 99.0, 15: 80.0},
        vwap_z=-2.0,
        slot_rvol=2.0,
        cum_rvol=1.0,
        velocity_z=-1.0,
        basis=MarketBasis.REALTIME,
        source_fresh=True,
        coverage_status=CoverageStatus.HEALTHY,
        catalyst_status=CatalystStatus.NONE_OBSERVED,
        halted=False,
    )
    base.update(overrides)
    return DislocationFeatures(**base)


def test_robust_z_requires_enough_history():
    assert robust_z(-0.05, [-0.001] * 20) is None


def test_flat_baseline_cannot_manufacture_extreme_z():
    history = [0.0] * 60
    assert robust_location_scale(history) is None
    assert robust_z(-0.01, history) is None


def test_robust_z_uses_median_mad_not_mean_std():
    history = [x / 10000 for x in range(-30, 30)]
    history += [0.25]  # outlier should not dominate the robust scale
    z = robust_z(-0.02, history)
    assert z is not None
    assert z < -3.0


def test_empirical_downside_severity_has_finite_sample_humility():
    history = [float(x) for x in range(60)]
    severity = empirical_downside_severity(-1.0, history)
    assert severity is not None
    assert 98.0 <= severity < 100.0


def test_residual_return_removes_market_and_sector_components():
    got = residual_return(
        -0.04, -0.01, -0.005, beta_market=1.2, beta_sector=0.8,
    )
    assert got == pytest.approx(-0.024)


def test_residual_return_rejects_nonfinite_inputs():
    with pytest.raises(ValueError):
        residual_return(float("nan"), 0.0, 0.0, beta_market=1.0, beta_sector=1.0)


def test_detector_requires_two_corroborators():
    q = qualify_dislocation(_shock(slot_rvol=1.0, vwap_z=-2.0))
    assert q.observed is False
    assert q.state is DislocationState.NORMAL
    assert q.eligible_live is False


def test_detector_observes_qualified_shock_but_does_not_imply_reclaim():
    q = qualify_dislocation(_shock())
    assert q.observed is True
    assert q.state is DislocationState.DISLOCATED
    assert q.eligible_live is True
    assert q.trigger_horizon_min == 5
    assert set(q.corroborators) == {"vwap_stretch", "slot_rvol"}


def test_severe_z_still_needs_corroboration():
    q = qualify_dislocation(_shock(
        z_by_horizon={5: -4.5}, severity_by_horizon={5: 20.0},
        vwap_z=None, slot_rvol=None, cum_rvol=None, velocity_z=None,
    ))
    assert q.observed is False


def test_delayed_basis_is_visible_but_never_live_eligible():
    q = qualify_dislocation(_shock(basis=MarketBasis.DELAYED_15M))
    assert q.observed is True
    assert q.state is DislocationState.DISLOCATED
    assert q.eligible_live is False
    assert "non_realtime_basis" in q.block_reasons


def test_stale_source_is_visible_but_never_live_eligible():
    q = qualify_dislocation(_shock(source_fresh=False))
    assert q.observed is True
    assert q.state is DislocationState.DISLOCATED
    assert q.eligible_live is False
    assert "stale_or_unverified_freshness" in q.block_reasons


@pytest.mark.parametrize("coverage", [CoverageStatus.DEGRADED, CoverageStatus.OUTAGE])
def test_news_coverage_failure_can_never_become_no_news(coverage):
    assert effective_catalyst_status(
        coverage, CatalystStatus.NONE_OBSERVED,
    ) is CatalystStatus.UNKNOWN
    q = qualify_dislocation(_shock(coverage_status=coverage))
    assert q.state is DislocationState.BLOCKED
    assert q.eligible_live is False
    assert q.catalyst_status is CatalystStatus.UNKNOWN
    assert "catalyst_unknown" in q.block_reasons


def test_material_catalyst_blocks_promotion():
    q = qualify_dislocation(_shock(catalyst_status=CatalystStatus.MATERIAL_EVENT))
    assert q.observed is True
    assert q.state is DislocationState.BLOCKED
    assert q.eligible_live is False
    assert "material_catalyst" in q.block_reasons


def test_soft_catalyst_remains_observation_candidate_not_hard_block():
    q = qualify_dislocation(_shock(catalyst_status=CatalystStatus.SOFT_EVENT))
    assert q.state is DislocationState.DISLOCATED
    assert q.observed is True


def test_halt_blocks_even_a_statistically_extreme_shock():
    q = qualify_dislocation(_shock(halted=True))
    assert q.state is DislocationState.BLOCKED
    assert "halt_or_luld" in q.block_reasons


def test_dislocated_needs_price_velocity_and_support_to_exhaust():
    weak = TransitionEvidence(low_holds=True, velocity_improving=True)
    assert advance_state(DislocationState.DISLOCATED, weak) is DislocationState.DISLOCATED

    qualified = TransitionEvidence(
        low_holds=True,
        velocity_improving=True,
        volume_contraction_after_climax=True,
    )
    assert advance_state(
        DislocationState.DISLOCATED, qualified,
    ) is DislocationState.EXHAUSTING


def test_oscillator_divergence_alone_cannot_advance_state():
    e = TransitionEvidence(momentum_divergence=True)
    assert advance_state(DislocationState.DISLOCATED, e) is DislocationState.DISLOCATED


def test_reclaim_requires_structure_and_hold():
    structure_only = TransitionEvidence(structural_reclaim=True)
    assert advance_state(
        DislocationState.EXHAUSTING, structure_only,
    ) is DislocationState.EXHAUSTING

    confirmed = TransitionEvidence(structural_reclaim=True, reclaim_hold=True)
    assert advance_state(
        DislocationState.EXHAUSTING, confirmed,
    ) is DislocationState.RECLAIM_CONFIRMED


@pytest.mark.parametrize(
    "state",
    [DislocationState.DISLOCATED, DislocationState.EXHAUSTING, DislocationState.RECLAIM_CONFIRMED],
)
def test_second_downside_impulse_invalidates_live_episode(state):
    e = TransitionEvidence(second_downside_impulse=True)
    assert advance_state(state, e) is DislocationState.INVALIDATED


def test_block_takes_precedence_over_reclaim_evidence():
    e = TransitionEvidence(
        blocked=True, structural_reclaim=True, reclaim_hold=True,
    )
    assert advance_state(DislocationState.EXHAUSTING, e) is DislocationState.BLOCKED


def test_confirmation_and_entry_cannot_be_backdated():
    t0 = datetime(2026, 10, 2, 14, 7, tzinfo=timezone.utc)
    detected = t0 + timedelta(minutes=1)
    confirmed = t0 + timedelta(minutes=5)
    validate_event_times(
        anchor_at=t0, detected_at=detected, confirmed_at=confirmed,
        entry_eligible_at=confirmed,
    )
    with pytest.raises(ValueError):
        validate_event_times(
            anchor_at=t0, detected_at=detected,
            confirmed_at=t0, entry_eligible_at=t0,
        )


def test_shock_can_be_detected_before_final_low_but_not_confirmed_before_it():
    detected = datetime(2026, 10, 2, 14, 7, tzinfo=timezone.utc)
    anchor = detected + timedelta(minutes=2)
    confirmed = anchor + timedelta(minutes=2)
    validate_event_times(anchor_at=anchor, detected_at=detected, confirmed_at=confirmed)


def test_entry_eligibility_requires_confirmation():
    now = datetime(2026, 10, 2, 14, 7, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        validate_event_times(
            anchor_at=now, detected_at=now, entry_eligible_at=now,
        )


def test_event_id_is_deterministic_and_versioned():
    kwargs = dict(
        symbol=" nvda ",
        session_date="2026-10-02",
        shock_start="14:07:00Z",
        trigger_horizon_min=5,
    )
    first = event_id(**kwargs)
    assert first == event_id(**kwargs)
    assert first.startswith("NVDA|2026-10-02|14:07:00Z|5m|intraday_dislocation_r0.1")
