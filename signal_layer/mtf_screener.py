"""Offline MTF screener projection over the existing settled OHLC/kernel owners.

No downloads, scheduler, production publisher, authentication, execution, or
promotion. Callers supply dated market expectations and source provenance.
Unknown/missing/stale names remain visible; no hidden universe attrition.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from numbers import Integral
from typing import Mapping
import hashlib
import json
import math
import re

import numpy as np
import pandas as pd

from .mtf_confluence import FEATURE_VERSION, MIN_MOMENTUM_BARS, PRESETS, TFS, _ohlc, feature_frame
from .mtf_evaluation import ExecutionCosts, experiment_digest, historical_analogs, outcome_frame, session_date

SCREENER_VERSION = "terminal-mtf-screen-research/v1"
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.^=:_-]{0,31}$")
SCORE_COLUMNS = {"full": "setup_score", "swing": "swing_score", "position": "position_score"}


@dataclass(frozen=True)
class ScreenPolicy:
    preset: str = "swing"
    analog_horizon: int = 21
    min_analogs: int = 10
    max_analogs: int = 20
    max_analog_distance: float = .25
    entry_bps: float = 5.0
    exit_bps: float = 5.0

    def __post_init__(self):
        if self.preset not in PRESETS:
            raise ValueError(f"unknown preset: {self.preset}")
        for value in (self.analog_horizon, self.min_analogs, self.max_analogs):
            if isinstance(value, bool) or not isinstance(value, Integral) or value < 1:
                raise ValueError("horizon and analog counts must be positive integers")
        if self.min_analogs > self.max_analogs:
            raise ValueError("min_analogs cannot exceed max_analogs")
        if isinstance(self.max_analog_distance, bool) or not isinstance(self.max_analog_distance, (int, float)) or not math.isfinite(self.max_analog_distance) or self.max_analog_distance <= 0:
            raise ValueError("max_analog_distance must be finite and positive")
        ExecutionCosts(self.entry_bps, self.exit_bps)


def _number(value):
    return float(value) if value is not None and pd.notna(value) and np.isfinite(value) else None


def _date(value):
    return None if pd.isna(value) else pd.Timestamp(value).date().isoformat()


def document_frame(doc: dict, symbol: str) -> tuple[pd.DataFrame, int, dict]:
    """Consume the existing Terminal [date,o,h,l,c,v] and dated anchor contract."""
    if not isinstance(doc, dict) or doc.get("t") != symbol:
        raise ValueError("document identity does not match requested symbol")
    if doc.get("bar_quality") != "real_ohlc":
        raise ValueError("real_ohlc source quality is required; proxies cannot be screened")
    bars = doc.get("bars")
    if not isinstance(bars, list) or not bars:
        raise ValueError("document has no daily bars")
    if any(not isinstance(row, list) or len(row) != 6 for row in bars):
        raise ValueError("daily rows must have exactly date/open/high/low/close/volume")
    dates = [row[0] for row in bars]
    if any(not isinstance(d, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) is None for d in dates):
        raise ValueError("daily bar dates must be ISO session dates")
    idx = pd.DatetimeIndex(pd.to_datetime(dates, errors="raise"))
    raw = pd.DataFrame([row[1:] for row in bars], index=idx,
                       columns=["open", "high", "low", "close", "volume"])
    daily = _ohlc(raw)
    volume = pd.to_numeric(raw.volume, errors="raise")
    if not np.isfinite(volume).all() or (volume < 0).any():
        raise ValueError("volume must be finite and nonnegative")
    daily["volume"] = volume.astype(float)
    anchor = doc.get("session_anchor")
    if not isinstance(anchor, dict) or anchor.get("basis") not in ("ipo", "feed"):
        raise ValueError("a declared ipo/feed session_anchor is required")
    if anchor.get("v") != 1 or isinstance(anchor.get("v"), bool):
        raise ValueError("unsupported anchor version")
    index = anchor.get("index")
    if isinstance(index, bool) or not isinstance(index, Integral):
        raise ValueError("anchor index must be an integer")
    point = session_date(anchor.get("date"))
    if point not in daily.index:
        raise ValueError("anchor date is missing from the source daily sessions")
    row_zero = int(index) - int(daily.index.get_loc(point))
    if row_zero < 0:
        raise ValueError("anchor implies negative session indices")
    source = doc.get("src")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("source attribution is required")
    provenance = {"source": source, "anchor_basis": anchor["basis"],
                  "row_zero_session_index": row_zero,
                  "adjustment_basis": doc.get("adjustment_basis", "not_declared"),
                  "bar_quality": "real_ohlc"}
    return daily, row_zero, provenance


def history_calendar_status(dates: pd.DatetimeIndex, calendar: dict | None) -> dict:
    """Compare with caller-supplied owner sessions; this creates no calendar authority."""
    if calendar is None:
        return {"state": "not_provided", "authority": "not_certified"}
    if not isinstance(calendar, dict) or not isinstance(calendar.get("source"), str) or not calendar["source"].strip() or len(calendar["source"]) > 512:
        raise ValueError("session calendar requires a bounded source reference")
    supplied = calendar.get("session_dates")
    if not isinstance(supplied, list) or not 1 <= len(supplied) <= 30000:
        raise ValueError("session calendar must contain 1 to 30000 explicit dates")
    expected = pd.DatetimeIndex([session_date(value) for value in supplied])
    if not expected.is_unique or not expected.is_monotonic_increasing:
        raise ValueError("calendar dates must be unique and strictly increasing")
    if not len(dates):
        raise ValueError("observed sessions cannot be empty")
    result = {"source": calendar["source"], "authority": "caller_supplied_not_certified",
              "checked_from": _date(dates[0]), "checked_through": _date(dates[-1])}
    if expected[0] > dates[0] or expected[-1] < dates[-1]:
        return {**result, "state": "incomplete_calendar"}
    expected = expected[(expected >= dates[0]) & (expected <= dates[-1])]
    missing, unexpected = expected.difference(dates), dates.difference(expected)
    return {**result, "state": "history_gaps" if len(missing) or len(unexpected) else "matches_supplied_calendar",
            "missing_count": len(missing), "unexpected_count": len(unexpected),
            "missing_sessions": missing.strftime("%Y-%m-%d").tolist(),
            "unexpected_sessions": unexpected.strftime("%Y-%m-%d").tolist()}


def screen_ticker(doc: dict, *, symbol: str, market: str, as_of, closed_through,
                  expected_session, policy=ScreenPolicy(), session_calendar=None) -> dict:
    """One ticker snapshot. A current expectation is explicit, never calendar-guessed.

    closed_through attests the latest settled bar supplied by the existing data
    owner. as_of is the historical decision cutoff. This function cannot itself
    certify that either attestation is true.
    """
    if not isinstance(symbol, str) or not SYMBOL_RE.fullmatch(symbol):
        raise ValueError("invalid symbol")
    if not isinstance(market, str) or not market:
        raise ValueError("market is required")
    if not isinstance(policy, ScreenPolicy):
        raise TypeError("policy must be ScreenPolicy")
    cutoff, settled, expected = map(session_date, (as_of, closed_through, expected_session))
    if expected > cutoff:
        raise ValueError("expected_session cannot be after as_of")
    daily, anchor, provenance = document_frame(doc, symbol)
    daily = daily.loc[daily.index <= min(cutoff, settled)]
    if daily.empty:
        raise ValueError("no settled observations at the requested cutoff")
    source_session = daily.index[-1]
    if source_session > expected:
        raise ValueError("source contains a later settled session than the market expectation")
    calendar_quality = history_calendar_status(daily.index, session_calendar)
    if calendar_quality["state"] not in ("not_provided", "matches_supplied_calendar"):
        return {"symbol": symbol, "market": market, "state": "incomplete_history",
                "decision_cutoff": _date(cutoff), "source_session": _date(source_session),
                "expected_session": _date(expected), "source_stale": source_session != expected,
                "calendar_quality": calendar_quality, "provenance": provenance,
                "setup_score": None, "historical_analogs": None, "timeframes": [],
                "production_rank": None, "trade_authority": False,
                "reason": "Supplied calendar does not establish complete observed sessions."}
    features = feature_frame(daily, anchor)
    point = features.iloc[-1]
    required = PRESETS[policy.preset]
    lanes = []
    for tf in TFS:
        pre = tf.lower()
        known = point[f"{pre}_known_at"]
        age = None if pd.isna(known) else len(daily) - 1 - int(daily.index.get_loc(known))
        count = point[f"{pre}_closed_bars"]
        lanes.append({"timeframe": tf, "required": tf in required,
                      "ready": bool(pd.notna(point[f"{pre}_score"])),
                      "closed_bars": int(count) if pd.notna(count) else 0,
                      "required_bars": MIN_MOMENTUM_BARS,
                      "stochastic_k": _number(point[f"{pre}_k"]),
                      "stochastic_d": _number(point[f"{pre}_d"]),
                      "rsi_macd": _number(point[f"{pre}_macd"]),
                      "rsi_macd_signal": _number(point[f"{pre}_signal"]),
                      "momentum_score": _number(point[f"{pre}_score"]),
                      "phase": point[f"{pre}_phase"] if pd.notna(point[f"{pre}_phase"]) else None,
                      "bar_session": _date(point[f"{pre}_bar_time"]),
                      "available_session": _date(known), "evidence_age_sessions": age})
    missing = [lane["timeframe"] for lane in lanes if lane["required"] and not lane["ready"]]
    stale = source_session != expected
    state = "stale_data" if stale else "insufficient_history" if missing else "research_ready"
    score = _number(point[SCORE_COLUMNS[policy.preset]])
    d_reclaim = bool(point.d_stoch_reclaim or point.d_macd_reclaim)
    if not pd.notna(point.d_score):
        family = "unavailable"
    elif d_reclaim and pd.notna(point.w_score) and point.w_score >= 50:
        family = "pullback_reclaim_watch"
    elif point.d_phase == "washout":
        family = "oversold_without_entry_confirmation"
    elif score is not None and score >= 70:
        family = "established_momentum"
    else:
        family = "mixed_momentum"
    # A carried weekly event is not a new event every day of the following week.
    new_reclaims = [tf for tf in required
                    if pd.notna(point[f"{tf.lower()}_known_at"])
                    and point[f"{tf.lower()}_known_at"] == source_session
                    and point[f"{tf.lower()}_reclaim"] == 1]
    risk_lanes = [lane["timeframe"] for lane in lanes
                  if lane["required"] and lane["phase"] in ("rollover", "bear")]
    serialized = {"symbol": symbol, "source": provenance,
                  "bars": [[date, *row] for date, row in zip(
                      daily.index.strftime("%Y-%m-%d"), daily.to_numpy(dtype=float).tolist())]}
    input_sha = hashlib.sha256(json.dumps(serialized, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    analogs = None
    if not missing and not stale:
        outcomes = outcome_frame(daily, (policy.analog_horizon,),
                                 costs=ExecutionCosts(policy.entry_bps, policy.exit_bps))
        analogs = historical_analogs(features, outcomes, as_of=source_session,
                                    preset=policy.preset, horizon=policy.analog_horizon,
                                    min_analogs=policy.min_analogs, max_analogs=policy.max_analogs,
                                    max_distance=policy.max_analog_distance)
    return {"symbol": symbol, "market": market, "state": state,
            "decision_cutoff": cutoff.date().isoformat(), "source_session": source_session.date().isoformat(),
            "expected_session": expected.date().isoformat(), "closed_through": min(cutoff, settled).date().isoformat(),
            "calendar_quality": calendar_quality, "preset": policy.preset, "required_timeframes": list(required), "missing_timeframes": missing,
            "setup_score": score, "score_status": "uncalibrated_prior",
            "setup_family": family, "new_reclaim_timeframes": new_reclaims,
            "deteriorating_timeframes": risk_lanes,
            "bottom_position": _number(point.bottom_position), "drawdown_252": _number(point.drawdown_252),
            "last_close": float(daily.close.iloc[-1]), "history_sessions": len(daily),
            "average_dollar_volume_20": float((daily.close * daily.volume).iloc[-20:].mean()) if len(daily) >= 20 else None,
            "timeframes": lanes, "historical_analogs": analogs,
            "provenance": provenance, "input_sha256": input_sha,
            "feature_version": FEATURE_VERSION, "policy_digest": experiment_digest(asdict(policy)),
            "warnings": ["Historical analogs are not calibrated success probabilities.",
                         "Price context is not a macro/fundamental regime model.",
                         "Current-survivor history does not prove point-in-time universe membership."] +
                         (["Corporate-action adjustment convention is not declared."] if provenance["adjustment_basis"] == "not_declared" else []),
            "production_rank": None, "trade_authority": False}


def scan_universe(documents: Mapping[str, dict | None], requests: list[dict], *, as_of,
                  policy=ScreenPolicy(), session_calendars=None) -> dict:
    """Account for every requested name, including missing, invalid and stale data."""
    cutoff = session_date(as_of)
    if not isinstance(requests, list) or any(not isinstance(r, dict) for r in requests):
        raise ValueError("requests must be a list of ticker/market/cutoff objects")
    symbols = [r.get("symbol") for r in requests]
    if any(not isinstance(s, str) or not SYMBOL_RE.fullmatch(s) for s in symbols) or len(set(symbols)) != len(symbols):
        raise ValueError("request symbols must be valid and unique")
    if session_calendars is not None and not isinstance(session_calendars, Mapping):
        raise ValueError("session_calendars must be a mapping")
    calendars = session_calendars or {}
    rows = []
    for request in requests:
        symbol = request["symbol"]
        doc = documents.get(symbol)
        if doc is None:
            rows.append({"symbol": symbol, "market": request.get("market"), "state": "missing_data",
                         "setup_score": None, "production_rank": None, "trade_authority": False})
            continue
        try:
            calendar_id = request.get("calendar_id")
            if "calendar_id" in request and (not isinstance(calendar_id, str) or calendar_id not in calendars or calendars[calendar_id] is None):
                raise ValueError("requested calendar is unavailable")
            calendar = calendars[calendar_id] if calendar_id is not None else None
            rows.append(screen_ticker(doc, symbol=symbol, market=request["market"], as_of=cutoff,
                                      closed_through=request["closed_through"],
                                      expected_session=request["expected_session"], policy=policy, session_calendar=calendar))
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            rows.append({"symbol": symbol, "market": request.get("market"), "state": "invalid_data",
                         "reason": str(exc)[:300], "setup_score": None,
                         "production_rank": None, "trade_authority": False})
    # Offline inspection order only; never sort on historical forward profits.
    ready = sorted((r for r in rows if r["state"] == "research_ready"),
                   key=lambda r: (-r["setup_score"], r["symbol"]))
    result = {"schema": SCREENER_VERSION, "as_of": cutoff.date().isoformat(),
              "policy": asdict(policy), "policy_digest": experiment_digest(asdict(policy)),
              "feature_version": FEATURE_VERSION, "status": "research_only_not_validated",
              "requested_count": len(requests), "coverage": dict(Counter(r["state"] for r in rows)),
              "research_order": [r["symbol"] for r in ready], "rows": rows,
              "selection_adjustment": {"pbo": None, "dsr": None,
                  "reason": "No synchronized portfolio-return trial matrix or independent promotion evidence."},
              "production_rank_authority": False, "trade_authority": False}
    # Fail loudly on accidental NaN/pandas objects before a caller publishes any artifact.
    json.dumps(result, allow_nan=False)
    return result
