"""Sensitivity of frozen MTF event studies to ticker and calendar concentration.

Consumes the existing mtf_panel paired-event records. No selections, thresholds,
weights, fills, labels, or holdout boundaries are fitted here. These are delete-
group diagnostics, NOT confidence intervals or independent-sample estimates.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime
from hashlib import sha256
from math import isclose, isfinite
from statistics import fmean
import json

ROBUSTNESS_VERSION = "terminal-mtf-robustness/v1"
BASELINE_RULE = "unconditional_common_coverage"
_STATES = frozenset({"paired", "unresolved_ticker_outcome", "missing_benchmark_decision",
                     "unresolved_benchmark_outcome", "execution_window_mismatch"})


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def _day(value, name):
    # The existing evaluator serializes naive midnight timestamps, not only dates.
    if not isinstance(value, str):
        raise ValueError(f"{name} must be an explicit session string")
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{name} is not an ISO session") from exc
    if stamp.tzinfo is not None or stamp.time() != datetime.min.time():
        raise ValueError(f"{name} must be a naive midnight session")
    return stamp.date()


def _name(value, name):
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise ValueError(f"{name} must be a bounded nonempty string")
    return value


def _months(first: date, last: date) -> list[str]:
    start = first.year * 12 + first.month - 1
    stop = last.year * 12 + last.month - 1
    if stop - start > 1200:
        raise ValueError("event span exceeds 100 years")
    return [f"{v // 12:04d}-{v % 12 + 1:02d}" for v in range(start, stop + 1)]


def _audit_rows(rows, requested_symbols, holdout):
    if (not isinstance(requested_symbols, list) or not requested_symbols
            or any(not isinstance(s, str) or not s.strip() for s in requested_symbols)
            or len(set(requested_symbols)) != len(requested_symbols)):
        raise ValueError("requested_symbols must be nonempty unique names")
    if not isinstance(rows, list) or not rows:
        raise ValueError("rows must contain a represented baseline")
    cell, seen, audited = None, set(), []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("rows must be records")
        sym, rule = row.get("symbol"), _name(row.get("rule"), "rule")
        if sym not in requested_symbols or (sym, rule) in seen:
            raise ValueError("unrequested symbol or repeated symbol/rule row")
        seen.add((sym, rule))
        horizon = row.get("horizon")
        if isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 1:
            raise ValueError("horizon must be a positive integer")
        costs = [_number(row.get(key), key) for key in ("entry_bps", "exit_bps")]
        if any(not 0 <= c < 10000 for c in costs):
            raise ValueError("costs must be per-side bps in [0, 10000)")
        benchmark = _name(row.get("benchmark_symbol"), "benchmark_symbol")
        here = (horizon, *costs, benchmark)
        if cell is not None and cell != here:
            raise ValueError("cannot pool horizons, costs, or benchmarks")
        cell = here
        events = row.get("events")
        if not isinstance(events, list):
            raise ValueError("events must be a list")
        observations, previous = [], None
        for event in events:
            if not isinstance(event, dict):
                raise ValueError("events must be records")
            decision = _day(event.get("decision_session"), "decision_session")
            if decision >= holdout:
                raise ValueError("reserved holdout decision cannot be consumed")
            if previous is not None and decision <= previous:
                raise ValueError("decisions must be unique and ordered")
            previous = decision
            state = event.get("benchmark_state")
            if state not in _STATES:
                raise ValueError("unknown benchmark_state")
            end_key, value_key = f"label_end_{horizon}", f"net_return_{horizon}"
            entry = None if event.get("entry_time") is None else _day(event["entry_time"], "entry_time")
            end = None if event.get(end_key) is None else _day(event[end_key], end_key)
            if (entry is not None and (entry <= decision or entry >= holdout)
                    or end is not None and (end >= holdout or entry is None or end < entry)):
                raise ValueError("invalid execution window or reserved holdout outcome")
            excess = event.get("arithmetic_excess_return")
            if state == "paired":
                if entry is None or end is None:
                    raise ValueError("paired event requires its exact execution window")
                stock = _number(event.get(value_key), value_key)
                peer = _number(event.get("benchmark_net_return"), "benchmark_net_return")
                value = _number(excess, "arithmetic_excess_return")
                if stock < -1 or peer < -1:
                    raise ValueError("unlevered return cannot be below -1")
                if not isclose(value, stock - peer, rel_tol=1e-10, abs_tol=1e-12):
                    raise ValueError("paired excess does not match stock minus benchmark")
            else:
                if excess is not None or event.get("benchmark_net_return") is not None:
                    raise ValueError("unpaired event cannot carry benchmark performance")
                value = None
                stock_value = event.get(value_key)
                if state == "unresolved_ticker_outcome" and stock_value is not None:
                    raise ValueError("unresolved ticker cannot carry an observed return")
                if stock_value is not None and _number(stock_value, value_key) < -1:
                    raise ValueError("unlevered return cannot be below -1")
            observations.append({"decision": decision, "entry": entry, "end": end,
                                 "value": value, "state": state})
        audited.append((sym, rule, observations))
    return cell, audited


def _comparison(group, baseline, names, removed_month=None):
    values, missing = [], []
    kept_rule, kept_base = 0, 0
    for sym in names:
        selected = []
        for source in (group, baseline):
            observations = [e for e in source.get(sym, []) if e["value"] is not None
                            and (removed_month is None or removed_month not in _months(e["entry"], e["end"]))]
            selected.append(observations)
        candidates, controls = selected
        kept_rule += len(candidates)
        kept_base += len(controls)
        if not candidates or not controls:
            missing.append(sym)
        else:
            values.append(fmean(e["value"] for e in candidates) - fmean(e["value"] for e in controls))
    # Never silently change the ticker support when a deleted month removes a
    # sparse rule's only event. Unknown comparison is not a zero or an improvement.
    valid = bool(names) and not missing
    return {"state": "comparable" if valid else "insufficient_common_support",
            "difference_from_baseline": fmean(values) if valid else None,
            "fixed_tickers": names, "lost_ticker_support": missing,
            "rule_events_retained": kept_rule, "baseline_events_retained": kept_base}


def _range(results):
    available = [r["difference_from_baseline"] for r in results if r["state"] == "comparable"]
    return {"attempted": len(results), "comparable": len(available),
            "incomparable": len(results) - len(available),
            "minimum": min(available) if available else None,
            "maximum": max(available) if available else None,
            "positive": sum(v > 0 for v in available),
            "negative": sum(v < 0 for v in available),
            "zero": sum(v == 0 for v in available)}


def robustness_report(rows: list[dict], *, requested_symbols: list[str],
                      reserved_holdout_start: str, baseline_rule=BASELINE_RULE) -> dict:
    """Diagnose concentration without refitting or claiming statistical confidence.

    Each row is one symbol/rule and one cost/horizon/benchmark cell from mtf_panel.
    All rules and all requested tickers survive, including zero-event and missing
    symbols. Calendar sensitivity deletes *overlapping outcome windows* together
    across every ticker, not only entries made during the named calendar month.
    """
    holdout = _day(reserved_holdout_start, "reserved_holdout_start")
    cell, audited = _audit_rows(rows, requested_symbols, holdout)
    by_rule = defaultdict(dict)
    for sym, rule, events in audited:
        by_rule[rule][sym] = events
    if baseline_rule not in by_rule:
        raise ValueError("baseline rule must be explicitly represented")
    baseline = by_rule[baseline_rule]
    observed = [e for _, _, events in audited for e in events if e["value"] is not None]
    months = _months(min(e["entry"] for e in observed), max(e["end"] for e in observed)) if observed else []
    output = []
    for rule in sorted(by_rule):
        group = by_rule[rule]
        available = [s for s in requested_symbols if any(e["value"] is not None for e in group.get(s, []))]
        common = [s for s in available if any(e["value"] is not None for e in baseline.get(s, []))]
        paired = [(s, e) for s in available for e in group[s] if e["value"] is not None]
        by_day = Counter(e["decision"].isoformat() for _, e in paired)
        by_month = Counter(e["decision"].strftime("%Y-%m") for _, e in paired)
        overlap_months = Counter(month for _, e in paired for month in _months(e["entry"], e["end"]))
        full = _comparison(group, baseline, common)
        without_ticker = [{"excluded_ticker": s, **_comparison(group, baseline, [n for n in common if n != s])}
                          for s in common]
        without_month = [{"excluded_calendar_month": month, **_comparison(group, baseline, common, month)}
                         for month in months]
        n = len(paired)
        output.append({"rule": rule, "selected_events": sum(len(v) for v in group.values()),
                       "paired_events": n, "benchmark_states": dict(Counter(e["state"] for v in group.values() for e in v)),
                       "contributing_tickers": available, "common_baseline_tickers": common,
                       "missing_or_zero_pair_tickers": [s for s in requested_symbols if s not in available],
                       "unique_decision_dates": len(by_day), "unique_decision_months": len(by_month),
                       "maximum_same_decision_date_share": max(by_day.values()) / n if n else None,
                       "maximum_same_decision_month_share": max(by_month.values()) / n if n else None,
                       "decision_date_counts": dict(sorted(by_day.items())),
                       "decision_month_counts": dict(sorted(by_month.items())),
                       "outcome_month_overlap_counts": dict(sorted(overlap_months.items())),
                       "full_comparison": full,
                       "leave_one_ticker_out": {"summary": _range(without_ticker), "cases": without_ticker},
                       "leave_one_calendar_month_out": {"summary": _range(without_month), "cases": without_month}})
    serial = json.dumps({"rows": rows, "symbols": requested_symbols, "holdout": reserved_holdout_start,
                         "baseline": baseline_rule}, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return {"schema": ROBUSTNESS_VERSION,
            "cell": dict(zip(("horizon", "entry_bps", "exit_bps", "benchmark_symbol"), cell)),
            "input_sha256": sha256(serial.encode()).hexdigest(),
            "reserved_holdout_start": holdout.isoformat(), "holdout_consumed": False,
            "requested_symbols": list(requested_symbols), "baseline_rule": baseline_rule,
            "calendar_blocks": months, "rules": output,
            "interpretation": "deterministic_delete_group_sensitivity_not_confidence_or_causal_effect",
            "calendar_deletion": "remove_all_execution_windows_overlapping_month_keep_original_common_ticker_support",
            "confidence_interval": None, "effective_independent_sample_size": None,
            "production_rank_authority": False, "trade_authority": False}
