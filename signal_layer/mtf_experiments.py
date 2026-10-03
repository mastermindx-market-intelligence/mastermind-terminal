"""Fixed MTF entry-rule comparisons using the existing research kernel.

This is an evaluation recipe, not an optimizer, experiment registry, macro-regime
owner, portfolio simulator, or promotion controller. All declared trials are
returned; none is called the winner. Freeze choices before examining returns.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .mtf_confluence import FEATURE_VERSION, PRESETS, _ohlc, feature_frame
from .mtf_evaluation import (ExecutionCosts, EVALUATION_VERSION, _horizons,
    experiment_digest, outcome_frame, session_date, summarize_events, walk_forward_events)

RULES = (
    "unconditional_common_coverage",
    "daily_momentum_upper_decile",
    "multitimeframe_momentum_upper_decile",
    "trailing_bottom_position_upper_decile",
    "daily_reclaim_with_weekly_support",
    "synchronized_oversold",
)


def _strict_records(frame: pd.DataFrame) -> list[dict]:
    records = []
    for record in frame.to_dict("records"):
        row = {}
        for key, value in record.items():
            if value is None or pd.isna(value):
                row[key] = None
            elif isinstance(value, (pd.Timestamp, np.datetime64)):
                row[key] = pd.Timestamp(value).isoformat()
            elif isinstance(value, np.generic):
                row[key] = value.item()
            else:
                row[key] = value
        records.append(row)
    return records


def compare_entry_rules(daily: pd.DataFrame, *, bar_anchor: int, evaluation_end,
                        holdout_start=None, preset="swing", horizons=(5,21,63),
                        cost_bps=(0,5,25), min_train_years=3, min_train_rows=252) -> dict:
    """A reproducible research matrix with a sealed final holdout when supplied.

    All rules share required-lane/bottom-context coverage. Cost values are PER
    SIDE basis points. Signals and holding intervals are unaffected by costs.
    Final-holdout bars are removed BEFORE features, labels or train thresholds;
    outcomes spilling into that reserved period remain unresolved.
    """
    if preset not in PRESETS:
        raise ValueError("unknown preset")
    horizons = _horizons(horizons)
    if not isinstance(cost_bps, (list, tuple)) or not cost_bps or len(set(cost_bps)) != len(cost_bps):
        raise ValueError("costs must be a nonempty unique sequence of per-side bps")
    for cost in cost_bps:
        ExecutionCosts(cost, cost)
    end = session_date(evaluation_end)
    raw = _ohlc(daily)
    if "open" not in raw:
        raise ValueError("entry evaluation requires actual opens")
    x = raw.loc[raw.index <= end]
    holdout = session_date(holdout_start) if holdout_start is not None else None
    if holdout is not None:
        x = x.loc[x.index < holdout]
    if x.empty:
        raise ValueError("no development observations before the supplied boundaries")
    features = feature_frame(x, bar_anchor)
    score_name = {"swing":"swing_score", "full":"setup_score", "position":"position_score"}[preset]
    cohort = features[score_name].notna() & features.bottom_position.notna()
    f = features.copy()
    f["unconditional"] = 0.0
    f["bottom_priority"] = 100 * (1 - features.bottom_position)
    daily_reclaim = (features.d_stoch_reclaim.eq(1) | features.d_macd_reclaim.eq(1)) & features.w_score.ge(50)
    simultaneous = pd.Series(True, index=x.index)
    for tf in PRESETS[preset]:
        simultaneous &= features[f"{tf.lower()}_k"].lt(20) & features[f"{tf.lower()}_d"].lt(20)
    selection = {
        RULES[0]: ("unconditional", None),
        RULES[1]: ("d_score", None),
        RULES[2]: (score_name, None),
        RULES[3]: ("bottom_priority", None),
        RULES[4]: ("unconditional", daily_reclaim),
        RULES[5]: ("unconditional", simultaneous),
    }
    config = {"preset":preset, "horizons":list(horizons), "cost_bps_per_side":list(cost_bps),
              "rules":list(RULES), "quantile":.9, "min_train_years":min_train_years,
              "min_train_rows":min_train_rows, "evaluation_end":end.date().isoformat(),
              "final_holdout_start":None if holdout is None else holdout.date().isoformat()}
    trials = []
    for cost in cost_bps:
        outcomes = outcome_frame(x, horizons, costs=ExecutionCosts(cost,cost))
        for horizon in horizons:
            for name in RULES:
                score, trigger = selection[name]
                folds, events = walk_forward_events(f, outcomes, score=score, horizon=horizon,
                    min_train_years=min_train_years, min_train_rows=min_train_rows,
                    eligible=cohort, trigger=trigger)
                identity = {"rule":name,"horizon":horizon,"entry_bps":cost,"exit_bps":cost}
                events = events.copy()
                events.insert(0,"decision_session",events.index)
                keep = [c for c in events if c in ("decision_session","entry_time","entry_open","test_year",
                    "decision_score","threshold",f"net_return_{horizon}",f"mae_{horizon}",f"mfe_{horizon}",
                    f"label_end_{horizon}",f"barrier_return_{horizon}",f"ambiguous_{horizon}")]
                trials.append({**identity,"trial_digest":experiment_digest({**config,**identity}),
                               "summary":summarize_events(events,horizon),
                               "folds":_strict_records(folds), "events":_strict_records(events[keep])})
    return {"schema":"terminal-mtf-entry-study/v1", "status":"research_only_not_validated",
            "feature_version":FEATURE_VERSION,"evaluation_version":EVALUATION_VERSION,
            "config":config,"config_digest":experiment_digest(config),
            "development_start":x.index[0].date().isoformat(),
            "development_end":x.index[-1].date().isoformat(), "development_sessions":len(x),
            "common_coverage_sessions":int(cohort.sum()), "trial_count":len(trials),"trials":trials,
            "holdout_status":"not_consumed" if holdout is not None else "not_reserved",
            "selection_adjustment":{"pbo":None,"dsr":None,
                "reason":"Event returns are not a synchronized portfolio-return trial matrix."},
            "limitations":["Common coverage does not repair survivor or corporate-action bias.",
                "Event means are not paired benchmark excess returns, portfolio returns, or causal treatment effects.",
                "Daily OHLC cannot establish actual fills, intrabar order or continuous-market liquidity.",
                "No ranking, capital sizing or automatic promotion follows from this report."],
            "production_rank_authority":False,"trade_authority":False}
