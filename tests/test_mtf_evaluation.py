import numpy as np
import pandas as pd
import pytest
from signal_layer.mtf_confluence import feature_frame
from signal_layer.mtf_evaluation import (ExecutionCosts, episode_positions, experiment_digest,
    historical_analogs, outcome_frame, summarize_events, walk_forward_events)


def prices(n=2400):
    i = np.arange(n)
    close = 100 * np.exp(.00008*i + .12*np.sin(i/27) + .035*np.sin(i/7))
    opening = close * (1 + .008*np.sin(i/11))
    return pd.DataFrame({"open": opening, "high": np.maximum(close, opening)*1.02,
                         "low": np.minimum(close, opening)*.98, "close": close},
                        index=pd.bdate_range("2012-01-02", periods=n))


@pytest.fixture(scope="module")
def history():
    x = prices()
    return x, feature_frame(x), outcome_frame(x, (5, 21))


def test_next_open_not_unavailable_signal_close():
    x = pd.DataFrame({"open": [100, 120, 120], "high": [101, 126, 123],
                      "low": [99, 119, 118], "close": [100, 125, 121]},
                     index=pd.bdate_range("2020-01-02", periods=3))
    f = outcome_frame(x, (1,), costs=ExecutionCosts(0, 0))
    assert f.iloc[0].entry_open == 120
    assert f.iloc[0].gross_return_1 == pytest.approx(125/120-1)
    assert f.iloc[0].entry_gap == pytest.approx(.2)
    assert f.iloc[0].label_end_1 == x.index[1]
    assert np.isnan(f.iloc[-1].net_return_1)


def test_costs_exact_round_trip_not_approximate_subtraction():
    cost = ExecutionCosts(25, 30)
    assert cost.net_return(100, 110) == pytest.approx(110*.997/(100*1.0025)-1)
    assert cost.net_return(100, 100) < 0


@pytest.mark.parametrize("value", [-1, np.nan, np.inf, 10000, True, "5"])
def test_reject_invalid_costs(value):
    with pytest.raises(ValueError):
        ExecutionCosts(value, 0)


def test_same_bar_stop_target_collision_is_not_free_profit():
    x = pd.DataFrame({"open": [100, 100, 100], "high": [101, 115, 102],
                      "low": [99, 90, 98], "close": [100, 105, 100]},
                     index=pd.bdate_range("2020-01-02", periods=3))
    f = outcome_frame(x, (1,), costs=ExecutionCosts(0, 0))
    assert f.iloc[0].ambiguous_1
    assert f.iloc[0].barrier_outcome_1 == "stop"
    assert f.iloc[0].barrier_return_1 == pytest.approx(-.05)
    assert f.iloc[0].mae_1 == pytest.approx(-.1)
    assert f.iloc[0].mfe_1 == pytest.approx(.15)


def test_gap_below_stop_is_filled_at_worse_open():
    x = pd.DataFrame({"open": [100, 100, 80, 85], "high": [101, 102, 90, 88],
                      "low": [99, 98, 75, 82], "close": [100, 100, 85, 84]},
                     index=pd.bdate_range("2020-01-02", periods=4))
    f = outcome_frame(x, (2,), costs=ExecutionCosts(0, 0))
    assert f.iloc[0].gap_stop_2
    assert f.iloc[0].barrier_return_2 == pytest.approx(-.2)
    assert not f.iloc[0].ambiguous_2
    assert f.iloc[0].barrier_exit_2 == x.index[2]


def test_open_above_target_resolves_before_later_low():
    x = pd.DataFrame({"open": [100, 100, 115], "high": [101, 102, 120],
                      "low": [99, 98, 90], "close": [100, 100, 96]},
                     index=pd.bdate_range("2020-01-02", periods=3))
    f = outcome_frame(x, (2,), costs=ExecutionCosts(0, 0))
    assert f.iloc[0].barrier_outcome_2 == "target"
    assert f.iloc[0].barrier_return_2 == pytest.approx(.1)
    assert not f.iloc[0].ambiguous_2


@pytest.mark.parametrize("horizons", [(), (0,), (True,), (2.5,), (2,2)])
def test_invalid_horizon_contract(horizons):
    with pytest.raises(ValueError):
        outcome_frame(prices(20), horizons)


def test_requires_open_never_synthesizes_it():
    with pytest.raises(ValueError):
        outcome_frame(prices(20).drop(columns="open"))
    with pytest.raises(ValueError):
        outcome_frame(prices(20).close)


def test_incomplete_labels_stay_missing_and_inputs_unchanged():
    x = prices(10)
    before = x.copy(deep=True)
    f = outcome_frame(x, (5,21))
    assert f.net_return_21.isna().all()
    assert f.label_end_21.isna().all()
    assert f.net_return_5.iloc[-5:].isna().all()
    assert f.ambiguous_5.iloc[-5:].isna().all()
    pd.testing.assert_frame_equal(x, before)


def test_matured_labels_are_prefix_stable():
    x = prices(100)
    a, b = outcome_frame(x.iloc[:80], (5,)), outcome_frame(x, (5,))
    pd.testing.assert_frame_equal(a.iloc[:75], b.iloc[:75])


def test_episode_selection_never_reads_returns():
    assert episode_positions(np.ones(12, dtype=bool), 5) == [0,5,10]
    assert episode_positions(np.ones(12, dtype=bool), 5, not_before=4) == [4,9]


def test_walk_forward_purges_labels_and_deoverlaps_across_years(history):
    x, f, o = history
    folds, events = walk_forward_events(f, o, horizon=21, min_train_years=2, min_train_rows=100, quantile=.5)
    assert len(folds) > 0 and len(events) > 0
    evaluated = folds.loc[folds.state == "evaluated"]
    assert (evaluated.train_last_label_end < evaluated.test_start).all()
    positions = x.index.get_indexer(events.index)
    assert (np.diff(positions) >= 21).all()
    # More than one fold actually contributed events; this is not a vacuous boundary test.
    assert events.test_year.nunique() > 2


def test_test_labels_cannot_change_threshold_or_selection(history):
    x, f, o = history
    cutoff = pd.Timestamp("2019-01-01")
    altered = o.copy()
    altered.loc[(altered.index >= cutoff) & altered.label_end_21.notna(), "net_return_21"] = 777.0
    kwargs = dict(horizon=21, min_train_years=2, min_train_rows=100)
    a, ea = walk_forward_events(f, o, **kwargs)
    b, eb = walk_forward_events(f, altered, **kwargs)
    pd.testing.assert_frame_equal(a[["test_year", "threshold"]], b[["test_year", "threshold"]])
    assert ea.index.equals(eb.index)


def test_analog_selection_uses_only_matured_labels_and_nonoverlap(history):
    x, f, o = history
    cutoff = x.index[1800]
    r = historical_analogs(f, o, as_of=cutoff, max_distance=1)
    assert r["nonoverlapping_analogs"] == 20
    dates = [pd.Timestamp(a["decision_session"]) for a in r["analogs"]]
    positions = sorted(x.index.get_indexer(dates))
    assert (np.diff(positions) >= 21).all()
    assert all(pd.Timestamp(a["label_end"]) < cutoff for a in r["analogs"])


def test_analog_choice_ignores_all_return_values(history):
    x, f, o = history
    altered = o.copy()
    altered["net_return_21"] = -altered.net_return_21 * 100
    kwargs = dict(as_of=x.index[1800], max_distance=1)
    a = historical_analogs(f, o, **kwargs)
    b = historical_analogs(f, altered, **kwargs)
    assert [(r["decision_session"], r["distance"]) for r in a["analogs"]] == [(r["decision_session"], r["distance"]) for r in b["analogs"]]


def test_analog_report_prefix_equals_full_at_same_cutoff(history):
    x, f, o = history
    cut = 1800
    prefix = x.iloc[:cut+1]
    a = historical_analogs(f, o, as_of=x.index[cut])
    b = historical_analogs(feature_frame(prefix), outcome_frame(prefix, (21,)), as_of=x.index[cut])
    assert a == b


def test_no_monthly_value_means_no_full_analog_claim(history):
    x, f, o = history
    r = historical_analogs(f, o, as_of=x.index[800], preset="full")
    assert r["state"] == "insufficient_history" and r["statistics"] is None


def test_empty_events_have_no_fabricated_statistics():
    o = outcome_frame(prices(1), (5,))
    s = summarize_events(o, 5)
    assert s["matured"] == 0 and s["unresolved"] == 1 and s["hit_rate"] is None


def test_config_digest_changes_with_friction():
    assert experiment_digest({"entry_bps":5}) == experiment_digest({"entry_bps":5})
    assert experiment_digest({"entry_bps":5}) != experiment_digest({"entry_bps":10})


@pytest.mark.parametrize("mutation", ["label_backdated","immature_profit","future_feature","infinite_score"])
def test_evaluation_rejects_temporal_or_numeric_fabrication(history, mutation):
    x, original_f, original_o = history
    f, o = original_f.copy(), original_o.copy()
    if mutation == "label_backdated": o.iloc[100, o.columns.get_loc("label_end_21")] = x.index[100]
    if mutation == "immature_profit": o.iloc[-1, o.columns.get_loc("net_return_21")] = .5
    if mutation == "future_feature": f.iloc[500, f.columns.get_loc("w_known_at")] = x.index[501]
    if mutation == "infinite_score": f.iloc[500, f.columns.get_loc("swing_score")] = np.inf
    with pytest.raises(ValueError):
        walk_forward_events(f, o, min_train_years=2, min_train_rows=100)


@pytest.mark.parametrize("value", [None, True, 0, 1790880000, "", "2026-10-01T12:00:00", "2026-10-01T00:00:00Z"])
def test_cutoff_is_an_explicit_session_date(value):
    from signal_layer.mtf_evaluation import session_date
    with pytest.raises(ValueError): session_date(value)
