"""Offline evaluation for Terminal MTF momentum; never an execution/promotion owner.

A decision is made after session t closes. A hypothetical fill is the next
observed session's OPEN. h=1 exits that session's CLOSE; h=21 exits t+21.
All path labels mature at t+h, including early barrier exits. No future label
is used by feature construction, episode selection, or analog distance.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
from numbers import Integral
from typing import Iterable
import hashlib
import json
import math

import numpy as np
import pandas as pd

from .mtf_confluence import FEATURE_VERSION, PRESETS, _ohlc

EVALUATION_VERSION = "terminal-mtf-evaluation/v1"


def _positive_integer(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral) or value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return int(value)


def session_date(value) -> pd.Timestamp:
    if not isinstance(value, (str, date, datetime, pd.Timestamp, np.datetime64)):
        raise ValueError("cutoff must be an explicit date, not a numeric timestamp")
    result = pd.Timestamp(value)
    if pd.isna(result) or result.tz is not None or result != result.normalize():
        raise ValueError("cutoff must be a timezone-naive midnight session date")
    return result


@dataclass(frozen=True)
class ExecutionCosts:
    """Assumed friction, not measured liquidity, spread, or a broker fill promise."""
    entry_bps: float = 5.0
    exit_bps: float = 5.0

    def __post_init__(self):
        for value in (self.entry_bps, self.exit_bps):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("costs must be numeric basis points")
            if not math.isfinite(value) or not 0 <= value < 10000:
                raise ValueError("costs must be finite and between 0 and 10000 bps")

    def net_return(self, entry, exit_price):
        return exit_price * (1 - self.exit_bps / 10000) / (entry * (1 + self.entry_bps / 10000)) - 1


def _horizons(values: Iterable[int]) -> tuple[int, ...]:
    result = tuple(_positive_integer(v, "horizon") for v in values)
    if not result or len(set(result)) != len(result):
        raise ValueError("supply a nonempty set of unique horizons")
    return result


def outcome_frame(daily: pd.DataFrame, horizons=(5, 21, 63), *,
                  costs=ExecutionCosts(), stop_loss=.05, target_gain=.10) -> pd.DataFrame:
    """Executable-price *hypotheses* and excursions, kept outside the feature frame.

    Gap below stop fills at OPEN, never at an unobtainable stop. Same-bar stop
    and target hits use stop-first and carry an ambiguity flag: daily OHLC
    cannot identify intrabar order. Profit-target gaps use target-price fills
    conservatively. These assumptions are explicit and replace no live strategy.
    """
    if not isinstance(daily, pd.DataFrame):
        raise ValueError("executable outcomes require actual OHLC with open")
    x = _ohlc(daily)
    if "open" not in x or x.attrs.get("price_basis") == "close_only_proxy":
        raise ValueError("executable outcomes require actual OHLC with open")
    horizons = _horizons(horizons)
    if not isinstance(costs, ExecutionCosts):
        raise TypeError("costs must be ExecutionCosts")
    for value, name in ((stop_loss, "stop_loss"), (target_gain, "target_gain")):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value < 1:
            raise ValueError(f"{name} must be a fraction strictly between 0 and 1")
    n = len(x)
    dates = pd.Series(x.index, index=x.index)
    entry = x.open.shift(-1)
    out = pd.DataFrame({"entry_time": dates.shift(-1), "entry_open": entry,
                        "entry_gap": entry / x.close - 1}, index=x.index)
    for h in horizons:
        count = max(0, n - h)
        for name in ("gross_return", "net_return", "mae", "mfe", "barrier_return"):
            out[f"{name}_{h}"] = np.nan
        out[f"label_end_{h}"] = dates.shift(-h)
        out[f"barrier_exit_{h}"] = pd.Series(pd.NaT, index=x.index, dtype="datetime64[ns]")
        out[f"barrier_outcome_{h}"] = pd.Series(None, index=x.index, dtype=object)
        out[f"ambiguous_{h}"] = pd.Series(pd.NA, index=x.index, dtype="boolean")
        out[f"gap_stop_{h}"] = pd.Series(pd.NA, index=x.index, dtype="boolean")
        if not count:
            continue
        from numpy.lib.stride_tricks import sliding_window_view
        high = sliding_window_view(x.high.to_numpy()[1:], h)
        low = sliding_window_view(x.low.to_numpy()[1:], h)
        opens = sliding_window_view(x.open.to_numpy()[1:], h)
        entries = entry.to_numpy()[:count]
        exits = x.close.to_numpy()[h:]
        idx = out.index[:count]
        out.loc[idx, f"gross_return_{h}"] = exits / entries - 1
        out.loc[idx, f"net_return_{h}"] = costs.net_return(entries, exits)
        out.loc[idx, f"mae_{h}"] = np.minimum(0, low.min(axis=1) / entries - 1)
        out.loc[idx, f"mfe_{h}"] = np.maximum(0, high.max(axis=1) / entries - 1)
        stops = entries * (1 - stop_loss)
        targets = entries * (1 + target_gain)
        stop_hits = low <= stops[:, None]
        target_hits = high >= targets[:, None]
        hits = stop_hits | target_hits
        any_hit = hits.any(axis=1)
        first = hits.argmax(axis=1)
        rows = np.arange(count)
        offsets = np.where(any_hit, first, h - 1)
        opening = opens[rows, offsets]
        hit_stop = stop_hits[rows, offsets]
        hit_target = target_hits[rows, offsets]
        gap_stop = any_hit & (opening <= stops)
        gap_target = any_hit & ~gap_stop & (opening >= targets)
        stopped = any_hit & ~gap_target & hit_stop
        ambiguous = stopped & ~gap_stop & hit_target
        barrier_price = np.where(~any_hit, exits,
                          np.where(gap_stop, opening,
                          np.where(gap_target, targets,
                          np.where(stopped, stops, targets))))
        reason = np.where(~any_hit, "horizon", np.where(stopped, "stop", "target"))
        out.loc[idx, f"barrier_return_{h}"] = costs.net_return(entries, barrier_price)
        out.loc[idx, f"barrier_exit_{h}"] = x.index[rows + 1 + offsets]
        out.loc[idx, f"barrier_outcome_{h}"] = reason
        out.loc[idx, f"ambiguous_{h}"] = pd.array(ambiguous, dtype="boolean")
        out.loc[idx, f"gap_stop_{h}"] = pd.array(gap_stop, dtype="boolean")
    out.attrs.update(evaluation_version=EVALUATION_VERSION,
                     execution="next_observed_session_open_to_hth_session_close",
                     costs=asdict(costs), stop_loss=stop_loss, target_gain=target_gain,
                     collision_policy="opening_gap_then_stop_first",
                     note="Daily bars do not prove tradability, slippage or intrabar ordering.")
    return out


def episode_positions(mask: np.ndarray, horizon: int, *, not_before=0) -> list[int]:
    """Chronological fixed-horizon de-overlap; independent of realized outcomes."""
    horizon = _positive_integer(horizon, "horizon")
    chosen = []
    next_position = not_before
    for i in np.flatnonzero(mask):
        if i >= next_position:
            chosen.append(int(i))
            # A new decision at the prior exit's close can enter next session.
            next_position = int(i) + horizon
    return chosen


def _validate_pair(features: pd.DataFrame, outcomes: pd.DataFrame, horizon: int):
    _positive_integer(horizon, "horizon")
    if not features.index.equals(outcomes.index):
        raise ValueError("features and outcomes must have identical daily session indices")
    if not isinstance(features.index, pd.DatetimeIndex) or not features.index.is_unique or not features.index.is_monotonic_increasing:
        raise ValueError("daily indices must be datetime, ordered and unique")
    if features.index.tz is not None or not features.index.equals(features.index.normalize()):
        raise ValueError("daily indices must use naive midnight session dates")
    for name in (f"net_return_{horizon}", f"label_end_{horizon}"):
        if name not in outcomes:
            raise ValueError(f"missing outcome column: {name}")
    ends = outcomes[f"label_end_{horizon}"]
    if not pd.api.types.is_datetime64_any_dtype(ends.dtype) or ends.dt.tz is not None:
        raise ValueError("label ends must be naive datetime session dates")
    expected = pd.Series(features.index, index=features.index).shift(-horizon)
    if not ((ends == expected) | (ends.isna() & expected.isna())).all():
        raise ValueError("label maturity must equal the declared future session horizon")
    returns = pd.to_numeric(outcomes[f"net_return_{horizon}"], errors="raise")
    if (returns.notna() & (~np.isfinite(returns) | ends.isna())).any():
        raise ValueError("nonfinite or immature returns cannot enter evaluation")
    for name in (c for c in features if c.endswith("_known_at")):
        known = features[name]
        if not pd.api.types.is_datetime64_any_dtype(known.dtype) or known.dt.tz is not None:
            raise ValueError("feature availability must use naive datetime sessions")
        if (known.notna() & (known > features.index)).any():
            raise ValueError("a feature contains information unavailable at its decision session")


def summarize_events(events: pd.DataFrame, horizon: int) -> dict:
    """Event statistics, not a portfolio Sharpe, CAGR or independent-sample claim."""
    horizon = _positive_integer(horizon, "horizon")
    values = events[f"net_return_{horizon}"].dropna().astype(float)
    n = len(values)
    result = {"selected": len(events), "matured": n, "unresolved": len(events) - n,
              "mean_net_return": None, "median_net_return": None,
              "p10_net_return": None, "hit_rate": None,
              "median_mae": None, "median_mfe": None,
              "same_bar_ambiguities": 0,
              "interpretation": "descriptive_event_statistics_not_portfolio_performance"}
    if not n:
        return result
    result.update(mean_net_return=float(values.mean()), median_net_return=float(values.median()),
                  p10_net_return=float(values.quantile(.1)), hit_rate=float((values > 0).mean()))
    for key in ("mae", "mfe"):
        name = f"{key}_{horizon}"
        if name in events:
            v = events.loc[values.index, name].dropna()
            result[f"median_{key}"] = float(v.median()) if len(v) else None
    if f"ambiguous_{horizon}" in events:
        result["same_bar_ambiguities"] = int(events[f"ambiguous_{horizon}"].fillna(False).sum())
    return result


def walk_forward_events(features: pd.DataFrame, outcomes: pd.DataFrame, *,
                        score="swing_score", horizon=21, quantile=.9,
                        min_train_rows=252, min_train_years=3, gap_sessions=0,
                        eligible: pd.Series | None = None,
                        trigger: pd.Series | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fixed-rule yearly walk-forward, label-end purge, nonoverlap across folds.

    Does not search parameter grids or select the best test year. Every outer
    fold and rejected fold is returned. A tail signal remains selected but
    unresolved until its full horizon matures. Thresholds never use test labels.
    eligible defines the common train/test population; trigger restricts test
    decisions only, so sparse fixed triggers need not refit their own threshold.
    """
    _validate_pair(features, outcomes, horizon)
    _positive_integer(min_train_rows, "min_train_rows")
    _positive_integer(min_train_years, "min_train_years")
    if isinstance(gap_sessions, bool) or not isinstance(gap_sessions, Integral) or gap_sessions < 0:
        raise ValueError("gap_sessions must be a nonnegative integer")
    if isinstance(quantile, bool) or not isinstance(quantile, (int, float)) or not 0 < quantile < 1 or not math.isfinite(quantile):
        raise ValueError("quantile must be between 0 and 1")
    if score not in features:
        raise ValueError(f"missing score: {score}")
    if eligible is not None and (not isinstance(eligible, pd.Series) or not eligible.index.equals(features.index)):
        raise ValueError("eligibility must align with the complete daily index")
    dates = features.index
    values = pd.to_numeric(features[score], errors="raise")
    if (values.notna() & ~np.isfinite(values)).any():
        raise ValueError("decision scores must be finite or explicitly missing")
    permitted = pd.Series(True, index=dates) if eligible is None else eligible.fillna(False).astype(bool)
    if trigger is not None and (not isinstance(trigger, pd.Series) or not trigger.index.equals(dates)):
        raise ValueError("trigger must align with the complete daily index")
    triggered = pd.Series(True, index=dates) if trigger is None else trigger.fillna(False).astype(bool)
    ends = outcomes[f"label_end_{horizon}"]
    folds, event_rows = [], []
    next_allowed = 0
    if not len(dates):
        return pd.DataFrame(), outcomes.iloc[:0].copy()
    for year in sorted(set(dates.year)):
        positions = np.flatnonzero(dates.year == year)
        first, start = int(positions[0]), dates[positions[0]]
        if start < dates[0] + pd.DateOffset(years=min_train_years):
            continue
        train_stop = max(0, first - gap_sessions)
        train_mask = (np.arange(len(dates)) < train_stop) & (ends < start) & values.notna() & permitted
        train = values.loc[train_mask]
        base = {"test_year": int(year), "test_start": start, "train_n": len(train),
                "train_last_label_end": ends.loc[train_mask].max(), "threshold": np.nan}
        if len(train) < min_train_rows:
            folds.append({**base, "state": "insufficient_training", "selected": 0, "matured": 0})
            continue
        threshold = float(train.quantile(quantile))
        mask = ((dates.year == year) & values.ge(threshold) & permitted & triggered).to_numpy(dtype=bool)
        chosen = episode_positions(mask, horizon, not_before=next_allowed)
        if chosen:
            next_allowed = chosen[-1] + horizon
        chosen_events = outcomes.iloc[chosen].copy()
        chosen_events["test_year"] = year
        chosen_events["threshold"] = threshold
        chosen_events["decision_score"] = values.iloc[chosen]
        event_rows.append(chosen_events)
        folds.append({**base, "threshold": threshold, "state": "evaluated",
                      **summarize_events(chosen_events, horizon)})
    events = pd.concat(event_rows) if event_rows else outcomes.iloc[:0].copy()
    events.attrs.update(outcomes.attrs, selection="fixed_rule_purged_walk_forward_nonoverlapping",
                        score=score, quantile=quantile, horizon=horizon)
    return pd.DataFrame(folds), events


def historical_analogs(features: pd.DataFrame, outcomes: pd.DataFrame, *, as_of,
                       preset="swing", horizon=21, max_analogs=20,
                       min_analogs=10, max_distance=.25) -> dict:
    """Nearest matured past states, never closest past profits or hindsight lows.

    Equal-weight timeframe groups use k/d/RSI-MACD/signal, scaled by fixed
    oscillator bounds. Bottom-position and drawdown form one additional group.
    No whole-history scaler or future-return column enters distance. Greedy
    distance-first selection rejects overlapping forward windows.
    """
    _validate_pair(features, outcomes, horizon)
    _positive_integer(max_analogs, "max_analogs")
    _positive_integer(min_analogs, "min_analogs")
    if min_analogs > max_analogs:
        raise ValueError("min_analogs cannot exceed max_analogs")
    if preset not in PRESETS:
        raise ValueError(f"unknown preset: {preset}")
    if not isinstance(max_distance, (int, float)) or isinstance(max_distance, bool) or not math.isfinite(max_distance) or max_distance <= 0:
        raise ValueError("max_distance must be finite and positive")
    cutoff = session_date(as_of)
    if cutoff not in features.index:
        raise ValueError("as_of must be an observed feature session")
    columns = [f"{tf.lower()}_{v}" for tf in PRESETS[preset] for v in ("k", "d", "macd", "signal")]
    columns += ["bottom_position", "drawdown_252"]
    missing = [c for c in columns if c not in features]
    if missing:
        raise ValueError(f"missing analog features: {missing}")
    result = {"state": "insufficient_history", "as_of": cutoff.date().isoformat(),
              "preset": preset, "horizon": horizon, "eligible_matured": 0,
              "nonoverlapping_analogs": 0, "analogs": [], "statistics": None,
              "status": "unvalidated_historical_comparison",
              "uncertainty": "Nonoverlap reduces duplicate episodes, not serial dependence or selection bias."}
    query = features.loc[cutoff, columns].to_numpy(dtype=float)
    if not np.isfinite(query).all():
        return result
    # Mature BEFORE the decision session, never merely before the data's final row.
    mask = (features.index < cutoff) & (outcomes[f"label_end_{horizon}"] < cutoff)
    mask &= outcomes[f"net_return_{horizon}"].notna()
    matrix = features[columns].to_numpy(dtype=float)
    mask &= np.isfinite(matrix).all(axis=1)
    candidates = np.flatnonzero(np.asarray(mask))
    result["eligible_matured"] = len(candidates)
    if not len(candidates):
        return result
    delta = matrix[candidates] - query
    groups = []
    for i in range(len(PRESETS[preset])):
        groups.append(np.mean((delta[:, 4*i:4*i+4] / 100.0) ** 2, axis=1))
    groups.append(np.mean(delta[:, -2:] ** 2, axis=1))
    distances = np.sqrt(np.mean(np.column_stack(groups), axis=1))
    ordered = np.lexsort((candidates, distances))
    chosen, chosen_distance = [], []
    for j in ordered:
        position = int(candidates[j])
        if distances[j] > max_distance:
            break
        if any(abs(position - old) < horizon for old in chosen):
            continue
        chosen.append(position)
        chosen_distance.append(float(distances[j]))
        if len(chosen) >= max_analogs:
            break
    records = []
    for position, distance in zip(chosen, chosen_distance):
        row = outcomes.iloc[position]
        records.append({"decision_session": features.index[position].date().isoformat(),
                        "label_end": pd.Timestamp(row[f"label_end_{horizon}"]).date().isoformat(),
                        "distance": distance, "net_return": float(row[f"net_return_{horizon}"]),
                        "mae": float(row[f"mae_{horizon}"]) if f"mae_{horizon}" in row else None,
                        "mfe": float(row[f"mfe_{horizon}"]) if f"mfe_{horizon}" in row else None})
    result.update(state="descriptive_only" if len(chosen) >= min_analogs else "sparse_analogs",
                  nonoverlapping_analogs=len(chosen), analogs=records,
                  statistics=summarize_events(outcomes.iloc[chosen], horizon))
    return result


def experiment_digest(config: dict) -> str:
    """Artifact identity only. Does not create an experiment or promotion registry."""
    body = {"feature_version": FEATURE_VERSION, "evaluation_version": EVALUATION_VERSION, "config": config}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
