"""Matched-event benchmark diagnostics for the existing MTF research report.

No signal selection, refitting, execution, rank, or promotion occurs here.
Benchmark outcomes must come from the existing next-open outcome owner; exact
entry and maturity dates must match. Missing dates are never forward-filled.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import fmean
import math

import pandas as pd

PANEL_VERSION = "terminal-mtf-panel-diagnostics/v1"


def _finite(value):
    if value is None or pd.isna(value):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("returns must be finite numbers or null")
    if value < -1:
        raise ValueError("long-only unlevered return cannot be below -1")
    return float(value)


def _day(value):
    if not isinstance(value, (str, pd.Timestamp)):
        raise ValueError("event dates must be explicit session dates")
    stamp = pd.Timestamp(value)
    if pd.isna(stamp) or stamp.tz is not None or stamp != stamp.normalize():
        raise ValueError("event dates must be naive midnight sessions")
    return stamp


def pair_benchmark_events(events: list[dict], benchmark: pd.DataFrame, *,
                          horizon: int, entry_bps: float, exit_bps: float) -> list[dict]:
    """Decorate *already selected* events using exact benchmark execution windows.

    benchmark is an outcome_frame output, not resampled or inferred prices.
    An event is paired only when decision, entry, and label-end sessions match.
    Counts for unpaired and unresolved events remain in the returned population.
    """
    if isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 1:
        raise ValueError("horizon must be a positive integer")
    for cost in (entry_bps, exit_bps):
        if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or not 0 <= cost < 10000:
            raise ValueError("costs must be finite nonnegative per-side bps below 10000")
    if not isinstance(events, list) or not all(isinstance(e, dict) for e in events):
        raise ValueError("events must be a list of records")
    if not isinstance(benchmark, pd.DataFrame) or not isinstance(benchmark.index, pd.DatetimeIndex):
        raise ValueError("benchmark must carry a daily DatetimeIndex")
    if (not benchmark.index.is_unique or not benchmark.index.is_monotonic_increasing
            or benchmark.index.hasnans or benchmark.index.tz is not None
            or not benchmark.index.equals(benchmark.index.normalize())):
        raise ValueError("benchmark sessions must be unique ordered naive dates")
    if benchmark.attrs.get("execution") != "next_observed_session_open_to_hth_session_close":
        raise ValueError("benchmark execution must use the existing next-open outcome contract")
    if benchmark.attrs.get("costs") != {"entry_bps": entry_bps, "exit_bps": exit_bps}:
        raise ValueError("benchmark and ticker friction assumptions must match")
    value_key, end_key = f"net_return_{horizon}", f"label_end_{horizon}"
    if not {"entry_time", value_key, end_key}.issubset(benchmark.columns):
        raise ValueError("benchmark lacks required outcome columns")
    result, previous = [], None
    for event in events:
        decision = _day(event["decision_session"])
        if previous is not None and decision <= previous:
            raise ValueError("selected decisions must be unique and strictly ordered")
        previous = decision
        stock = _finite(event.get(value_key))
        record = dict(event, benchmark_net_return=None, arithmetic_excess_return=None,
                      benchmark_state="unresolved_ticker_outcome")
        if stock is None:
            result.append(record)
            continue
        entry, end = _day(event["entry_time"]), _day(event[end_key])
        if not decision < entry <= end:
            raise ValueError("event maturity must not precede its entry")
        if decision not in benchmark.index:
            record["benchmark_state"] = "missing_benchmark_decision"
        else:
            peer = benchmark.loc[decision]
            if pd.isna(peer.entry_time) or pd.isna(peer[end_key]):
                record["benchmark_state"] = "unresolved_benchmark_outcome"
            elif _day(peer.entry_time) != entry or _day(peer[end_key]) != end:
                record["benchmark_state"] = "execution_window_mismatch"
            else:
                value = _finite(peer[value_key])
                if value is None:
                    record["benchmark_state"] = "unresolved_benchmark_outcome"
                else:
                    record.update(benchmark_state="paired", benchmark_net_return=value,
                                  arithmetic_excess_return=stock-value)
        result.append(record)
    return result


def summarize_paired_events(events: list[dict]) -> dict:
    states = defaultdict(int)
    values = []
    for event in events:
        state = event["benchmark_state"]
        states[state] += 1
        value = event.get("arithmetic_excess_return")
        if state == "paired":
            if value is None or not math.isfinite(value):
                raise ValueError("paired events require finite excess returns")
            values.append(float(value))
        elif value is not None:
            raise ValueError("unpaired events cannot supply excess returns")
    return {"selected": len(events), "paired": len(values), "states": dict(states),
            "mean_arithmetic_excess_return": fmean(values) if values else None,
            "median_arithmetic_excess_return": float(pd.Series(values).median()) if values else None,
            "excess_positive_fraction": sum(v > 0 for v in values)/len(values) if values else None}


def equal_ticker_rule_summary(rows: list[dict], *, requested_symbols: list[str],
                              baseline_rule: str) -> dict:
    """Descriptive equal-ticker summaries, not investable portfolio weights.

    Each row identifies symbol/rule and one same-cost/horizon matrix cell's
    selected paired events. Different rules choose DIFFERENT entry times, so
    rule-minus-baseline differences are not a paired treatment-effect estimate.
    A ticker absent from either rule is excluded only from that comparison and
    is named explicitly; zero-event rules never disappear from the output.
    """
    if not requested_symbols or len(set(requested_symbols)) != len(requested_symbols):
        raise ValueError("requested symbols must be nonempty and unique")
    by_rule, cells, seen = defaultdict(dict), set(), set()
    for row in rows:
        sym, rule = row["symbol"], row["rule"]
        if sym not in requested_symbols or (sym, rule) in seen:
            raise ValueError("row symbol is unrequested or symbol/rule is duplicated")
        seen.add((sym, rule))
        cells.add((row["horizon"], row["entry_bps"], row["exit_bps"], row["benchmark_symbol"]))
        summary = summarize_paired_events(row["events"])
        by_rule[rule][sym] = summary
    if len(cells) > 1:
        raise ValueError("do not pool different horizons, costs, or benchmarks")
    if baseline_rule not in by_rule:
        raise ValueError("baseline rule must be explicitly represented")
    baseline = by_rule[baseline_rule]
    output = []
    for rule in sorted(by_rule):
        group = by_rule[rule]
        available = [s for s in requested_symbols if s in group and group[s]["paired"] > 0]
        common = [s for s in available if s in baseline and baseline[s]["paired"] > 0]
        means = [group[s]["mean_arithmetic_excess_return"] for s in available]
        deltas = [group[s]["mean_arithmetic_excess_return"] - baseline[s]["mean_arithmetic_excess_return"] for s in common]
        output.append({"rule": rule, "contributing_tickers": available,
                       "missing_or_zero_pair_tickers": [s for s in requested_symbols if s not in available],
                       "paired_events": sum(group[s]["paired"] for s in available),
                       "equal_ticker_mean_excess": fmean(means) if means else None,
                       "common_baseline_tickers": common,
                       "equal_ticker_difference_from_baseline": fmean(deltas) if deltas else None,
                       "tickers_beating_baseline": sum(d > 0 for d in deltas),
                       "per_ticker": group})
    return {"schema": PANEL_VERSION, "baseline_rule": baseline_rule,
            "requested_symbols": requested_symbols, "rules": output,
            "interpretation": "equal_ticker_descriptive_event_means_not_portfolio_or_causal_effects",
            "uncertainty": "not_estimated; ticker/theme/calendar dependence remains",
            "production_rank_authority": False, "trade_authority": False}
