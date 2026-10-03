"""Deterministic research primitives for the intraday Dislocation + Reclaim program.

R0 is intentionally shadow-only. It detects abnormal downside observations, preserves
adverse-selection/data gates, and advances an auditable state machine. It does not emit
BUY/SELL, position, sizing, portfolio, or production execution authority.

The frozen research law lives in docs/PREREG_INTRADAY_DISLOCATION.md. Keep this module
pure: no network, filesystem, clock, model, or provider calls.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from math import isfinite
from statistics import median
from typing import Mapping, Sequence

MODEL_VERSION = "intraday_dislocation_r0.1"


class MarketBasis(str, Enum):
    REALTIME = "REALTIME"
    DELAYED_15M = "DELAYED_15M"
    STALE = "STALE"
    EOD = "EOD"
    UNKNOWN = "UNKNOWN"


class CoverageStatus(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    OUTAGE = "OUTAGE"


class CatalystStatus(str, Enum):
    MATERIAL_EVENT = "MATERIAL_EVENT"
    SOFT_EVENT = "SOFT_EVENT"
    NONE_OBSERVED = "NONE_OBSERVED"
    UNKNOWN = "UNKNOWN"


class DislocationState(str, Enum):
    NORMAL = "NORMAL"
    DISLOCATED = "DISLOCATED"
    EXHAUSTING = "EXHAUSTING"
    RECLAIM_CONFIRMED = "RECLAIM_CONFIRMED"
    BLOCKED = "BLOCKED"
    INVALIDATED = "INVALIDATED"
    EXPIRED = "EXPIRED"


@dataclass(frozen=True)
class FrozenThresholds:
    """R0 hypotheses locked before replay; not claims of optimality."""

    min_baseline_n: int = 40
    core_z: float = -3.0
    severe_z: float = -4.0
    severity_pct: float = 98.0
    vwap_z: float = -1.75
    slot_rvol: float = 1.75
    cum_rvol: float = 1.25
    velocity_z: float = -2.5
    min_corroborators: int = 2
    mad_floor: float = 1e-12


R0_THRESHOLDS = FrozenThresholds()


@dataclass(frozen=True)
class DislocationFeatures:
    z_by_horizon: Mapping[int, float | None]
    severity_by_horizon: Mapping[int, float | None]
    vwap_z: float | None = None
    slot_rvol: float | None = None
    cum_rvol: float | None = None
    velocity_z: float | None = None
    basis: MarketBasis = MarketBasis.UNKNOWN
    source_fresh: bool = False
    coverage_status: CoverageStatus = CoverageStatus.DEGRADED
    catalyst_status: CatalystStatus = CatalystStatus.UNKNOWN
    halted: bool = False


@dataclass(frozen=True)
class Qualification:
    observed: bool
    state: DislocationState
    eligible_live: bool
    trigger_horizon_min: int | None
    corroborators: tuple[str, ...]
    block_reasons: tuple[str, ...]
    catalyst_status: CatalystStatus
    model_version: str = MODEL_VERSION


@dataclass(frozen=True)
class TransitionEvidence:
    """Point-in-time completed-bar evidence for one state transition."""

    low_holds: bool = False
    velocity_improving: bool = False
    close_location_improving: bool = False
    volume_contraction_after_climax: bool = False
    spread_normalized: bool = False
    momentum_divergence: bool = False
    higher_low: bool = False
    structural_reclaim: bool = False
    reclaim_hold: bool = False
    second_downside_impulse: bool = False
    blocked: bool = False
    expired: bool = False


def _finite(values: Sequence[float]) -> list[float]:
    return [float(v) for v in values if isfinite(v)]


def robust_location_scale(
    history: Sequence[float],
    *,
    min_n: int = R0_THRESHOLDS.min_baseline_n,
    mad_floor: float = R0_THRESHOLDS.mad_floor,
) -> tuple[float, float] | None:
    """Return median and normal-consistent MAD scale, or unavailable.

    A flat/near-flat baseline is not rescued by an epsilon denominator because doing
    so manufactures spectacular Z-scores. A later replay may supply an explicitly
    preregistered neighbouring-slot shrinkage scale.
    """
    vals = _finite(history)
    if len(vals) < min_n:
        return None
    loc = float(median(vals))
    mad = float(median(abs(v - loc) for v in vals))
    scale = 1.4826 * mad
    if not isfinite(scale) or scale <= mad_floor:
        return None
    return loc, scale


def robust_z(
    current: float,
    history: Sequence[float],
    *,
    min_n: int = R0_THRESHOLDS.min_baseline_n,
    mad_floor: float = R0_THRESHOLDS.mad_floor,
) -> float | None:
    if not isfinite(current):
        return None
    stats = robust_location_scale(history, min_n=min_n, mad_floor=mad_floor)
    if stats is None:
        return None
    loc, scale = stats
    return (float(current) - loc) / scale


def empirical_downside_severity(
    current: float,
    history: Sequence[float],
    *,
    min_n: int = R0_THRESHOLDS.min_baseline_n,
) -> float | None:
    """Historical downside extremeness on [0,100), with finite-sample humility."""
    vals = _finite(history)
    if len(vals) < min_n or not isfinite(current):
        return None
    p_down = (sum(v <= current for v in vals) + 1.0) / (len(vals) + 1.0)
    return 100.0 * (1.0 - p_down)


def residual_return(
    stock_return: float,
    market_return: float,
    sector_residual_return: float,
    *,
    beta_market: float,
    beta_sector: float,
) -> float:
    """Return stock residual versus broad market and market-orthogonalized sector."""
    vals = (
        stock_return, market_return, sector_residual_return, beta_market, beta_sector,
    )
    if not all(isfinite(v) for v in vals):
        raise ValueError("residual inputs must be finite")
    return stock_return - beta_market * market_return - beta_sector * sector_residual_return


def effective_catalyst_status(
    coverage: CoverageStatus,
    status: CatalystStatus,
) -> CatalystStatus:
    """Coverage failure can only reduce certainty; it can never mean no-news."""
    if coverage is not CoverageStatus.HEALTHY:
        return CatalystStatus.UNKNOWN
    return status


def _corroborators(
    features: DislocationFeatures,
    thresholds: FrozenThresholds,
) -> tuple[str, ...]:
    out: list[str] = []
    if features.vwap_z is not None and features.vwap_z <= thresholds.vwap_z:
        out.append("vwap_stretch")
    if features.slot_rvol is not None and features.slot_rvol >= thresholds.slot_rvol:
        out.append("slot_rvol")
    if features.cum_rvol is not None and features.cum_rvol >= thresholds.cum_rvol:
        out.append("cum_rvol")
    if features.velocity_z is not None and features.velocity_z <= thresholds.velocity_z:
        out.append("downside_velocity")
    return tuple(out)


def qualify_dislocation(
    features: DislocationFeatures,
    thresholds: FrozenThresholds = R0_THRESHOLDS,
) -> Qualification:
    """Qualify an abnormal observation without conferring entry authority."""
    candidates: list[tuple[int, float]] = []
    for horizon, z in features.z_by_horizon.items():
        if z is None or not isfinite(z):
            continue
        sev = features.severity_by_horizon.get(horizon)
        core = z <= thresholds.core_z and sev is not None and sev >= thresholds.severity_pct
        severe = z <= thresholds.severe_z
        if core or severe:
            candidates.append((int(horizon), float(z)))

    corroborators = _corroborators(features, thresholds)
    observed = bool(candidates) and len(corroborators) >= thresholds.min_corroborators
    trigger_horizon = min(candidates, key=lambda item: item[1])[0] if candidates else None

    catalyst = effective_catalyst_status(
        features.coverage_status, features.catalyst_status,
    )
    reasons: list[str] = []
    if features.halted:
        reasons.append("halt_or_luld")
    if catalyst is CatalystStatus.MATERIAL_EVENT:
        reasons.append("material_catalyst")
    elif catalyst is CatalystStatus.UNKNOWN:
        reasons.append("catalyst_unknown")
    if features.basis is not MarketBasis.REALTIME:
        reasons.append("non_realtime_basis")
    if not features.source_fresh:
        reasons.append("stale_or_unverified_freshness")

    eligible_live = observed and not reasons
    if not observed:
        state = DislocationState.NORMAL
    elif any(r in reasons for r in ("halt_or_luld", "material_catalyst", "catalyst_unknown")):
        state = DislocationState.BLOCKED
    else:
        state = DislocationState.DISLOCATED
    return Qualification(
        observed=observed,
        state=state,
        eligible_live=eligible_live,
        trigger_horizon_min=trigger_horizon,
        corroborators=corroborators,
        block_reasons=tuple(reasons),
        catalyst_status=catalyst,
    )


def _has_exhaustion_support(e: TransitionEvidence) -> bool:
    return any((
        e.close_location_improving,
        e.volume_contraction_after_climax,
        e.spread_normalized,
        e.momentum_divergence,
        e.higher_low,
    ))


def advance_state(
    current: DislocationState,
    evidence: TransitionEvidence,
) -> DislocationState:
    """Advance one deterministic state using only evidence knowable now."""
    if current in (DislocationState.INVALIDATED, DislocationState.EXPIRED):
        return current
    if evidence.blocked:
        return DislocationState.BLOCKED
    if evidence.expired:
        return DislocationState.EXPIRED
    if evidence.second_downside_impulse:
        return DislocationState.INVALIDATED
    if current is DislocationState.DISLOCATED:
        if evidence.low_holds and evidence.velocity_improving and _has_exhaustion_support(evidence):
            return DislocationState.EXHAUSTING
        return current
    if current is DislocationState.EXHAUSTING:
        if evidence.structural_reclaim and evidence.reclaim_hold:
            return DislocationState.RECLAIM_CONFIRMED
        return current
    if current is DislocationState.RECLAIM_CONFIRMED:
        return current
    if current is DislocationState.BLOCKED:
        return current
    return current


def validate_event_times(
    *,
    anchor_at: datetime,
    detected_at: datetime,
    confirmed_at: datetime | None = None,
    entry_eligible_at: datetime | None = None,
) -> None:
    """Reject backdated confirmation/entry timestamps.

    anchor_at may precede or follow detected_at because a shock can be detected before
    its final low. Confirmation cannot precede either anchor or detection, and an
    eligible entry cannot precede confirmation.
    """
    if confirmed_at is not None:
        if confirmed_at < detected_at or confirmed_at < anchor_at:
            raise ValueError("confirmed_at cannot precede detection or anchor")
    if entry_eligible_at is not None:
        if confirmed_at is None:
            raise ValueError("entry eligibility requires confirmed_at")
        if entry_eligible_at < confirmed_at:
            raise ValueError("entry_eligible_at cannot precede confirmed_at")


def event_id(
    *,
    symbol: str,
    session_date: str,
    shock_start: str,
    trigger_horizon_min: int,
    model_version: str = MODEL_VERSION,
) -> str:
    """Stable human-readable identity for a single detector-version episode."""
    sym = symbol.strip().upper()
    if not sym:
        raise ValueError("symbol is required")
    if trigger_horizon_min <= 0:
        raise ValueError("trigger horizon must be positive")
    return "|".join((
        sym,
        session_date,
        shock_start,
        f"{trigger_horizon_min}m",
        model_version,
    ))
