"""Product parity and causal-availability proofs; synthetic data, not trading evidence."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from signal_layer.mtf_confluence import (
    MIN_MOMENTUM_BARS, PRESETS, TFS, WEIGHTS, _aggregate_score, _calendar_groups,
    _groups_2w, _groups_3d, _state, add_forward_labels, feature_frame, walk_forward_summary,
)

GOLDEN = json.loads((Path(__file__).with_name("mtf_momentum_golden.json")).read_text())


def history(n=2800):
    dates = pd.bdate_range("2005-01-03", periods=n)
    i = np.arange(n)
    close = 100 + i * .005 + 8 * np.sin(i / 13) + 3 * np.cos(i / 37)
    return pd.DataFrame({"open": close - .2, "high": close + 1.5,
                         "low": close - 1.5, "close": close}, index=dates)


def golden_bars(name, length):
    rows = []
    for i in range(length):
        j = i % 34
        cents = (10000 if name == "flat" else 10000 + 40*i if name == "rising" else
                 10000 - 30*i if name == "falling" else 10000 + 2*i + 80*(j if j <= 17 else 34-j) + 13*(i % 11))
        rows.append({"high": (cents + (0 if name == "flat" else 130))/100,
                     "low": (cents - (0 if name == "flat" else 170))/100, "close": cents/100})
    return pd.DataFrame(rows, index=pd.bdate_range("2001-01-02", periods=length))


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["name"])
def test_exact_product_golden_math_and_phase(case):
    got = _state(golden_bars(case["name"], case["length"]))
    for index, k, d, m, signal, score, phase in case["checks"]:
        expected = [np.nan if v is None else v for v in (k, d, m, signal, score)]
        np.testing.assert_allclose(got.iloc[index][["k", "d", "macd", "signal", "score"]].to_numpy(dtype=float),
                                   expected, rtol=1e-12, atol=1e-12, equal_nan=True)
        assert got.iloc[index].phase == phase
    assert got.score.iloc[:MIN_MOMENTUM_BARS - 1].isna().all()
    if len(got) >= MIN_MOMENTUM_BARS:
        assert pd.notna(got.score.iloc[MIN_MOMENTUM_BARS - 1])


@pytest.mark.parametrize("case", GOLDEN["aggregates"])
def test_aggregation_matches_product_not_a_second_scoring_model(case):
    points = _state(golden_bars("oscillating", 240))
    columns = {"bottom_position": case["bottom"]}
    for item in GOLDEN["aggregateInputs"]:
        prefix, point = item["tf"].lower(), points.iloc[item["index"]]
        columns[prefix + "_score"] = point.score
        columns[prefix + "_reclaim"] = float(point.phase == "reclaim")
        columns[prefix + "_falling"] = float(point.phase in ("bear", "washout"))
    base = pd.DataFrame([columns]).astype({"bottom_position": float})
    _, score = _aggregate_score(base, TFS)
    assert score.iloc[0] == pytest.approx(case["expected"], abs=1e-12)


@pytest.mark.parametrize("anchor", [0, 1, 2])
def test_all_warmed_timeframes_are_prefix_stable_for_every_3d_phase(anchor):
    x = history()
    full = feature_frame(x, bar_anchor=anchor)
    # Past 78 months: monthly checks must have actual non-null evidence.
    for cut in (2200, 2201, 2202):
        prefix = feature_frame(x.iloc[:cut], bar_anchor=anchor)
        assert prefix.iloc[-1].coverage_count == 5
        assert pd.notna(prefix.iloc[-1]["1m_score"])
        pd.testing.assert_frame_equal(prefix, full.iloc[:cut], check_exact=False, rtol=1e-12, atol=1e-12)
    assert full.setup_score.dropna().between(0, 100).all()


def test_calendar_holiday_and_weekend_month_end_do_not_backdate_values():
    x = history(3600)
    # February 2014 ends Friday: remove that observed session to model a closure.
    x = x.drop(pd.Timestamp("2014-02-28"))
    for date in ("2014-02-27", "2014-03-03", "2014-05-30", "2014-06-02"):
        prefix = feature_frame(x.loc[:date])
        assert pd.notna(prefix.iloc[-1]["1m_score"])
        pd.testing.assert_frame_equal(prefix, feature_frame(x).loc[prefix.index],
                                      check_exact=False, rtol=1e-12, atol=1e-12)
    full = feature_frame(x)
    assert full.loc["2014-02-27", "w_known_at"] < pd.Timestamp("2014-02-27")
    assert full.loc["2014-03-03", "w_known_at"] == pd.Timestamp("2014-03-03")
    assert full.loc["2014-03-03", "1m_bar_time"] == pd.Timestamp("2014-02-27")
    assert full.loc["2014-03-03", "1m_known_at"] == pd.Timestamp("2014-03-03")


def test_absolute_fortnight_grid_retains_overlapping_complete_ohlc():
    x = history(90)
    full, _ = _groups_2w(x)
    truncated, _ = _groups_2w(x.iloc[7:])
    # The first bucket of a truncated feed may be partial; subsequent ones cannot rephase.
    shared = truncated.index[1:].intersection(full.index)
    assert len(shared) >= 4
    pd.testing.assert_frame_equal(truncated.loc[shared], full.loc[shared])


def test_iso_weeks_include_saturday_and_sunday_in_the_same_week():
    x = history(30)
    x.index = pd.date_range("2024-01-01", periods=len(x))
    bars, known = _calendar_groups(x, "W")
    assert bars.index[0] == pd.Timestamp("2024-01-07")
    assert known[0] == pd.Timestamp("2024-01-08")
    assert bars.iloc[0].close == x.iloc[6].close


def test_3d_close_is_only_admitted_at_the_canonical_session_position():
    x = history(9)
    expected = {0: [0, 3, 6], 1: [2, 5, 8], 2: [1, 4, 7]}
    for anchor, positions in expected.items():
        _, known = _groups_3d(x, anchor)
        assert list(known) == list(x.index[positions])


def test_suffix_prices_and_developing_tail_cannot_change_settled_features():
    x = history()
    altered = x.copy()
    altered.iloc[2200:] *= np.linspace(1, 1.8, len(x) - 2200)[:, None]
    a = feature_frame(x, closed_through=x.index[2199])
    b = feature_frame(altered, closed_through=x.index[2199])
    pd.testing.assert_frame_equal(a, b)
    pd.testing.assert_frame_equal(a, feature_frame(x).iloc[:2200])


@pytest.mark.parametrize("n", [0, 1, 5, 30, 100, 800])
def test_short_histories_are_honest_not_crashes_or_five_frame_scores(n):
    f = feature_frame(history(n))
    assert len(f) == n
    assert f.setup_score.isna().all()
    if n:
        assert f.iloc[-1].coverage_count < 5
    if n == 800:
        assert pd.notna(f.iloc[-1].swing_score)
        assert pd.isna(f.iloc[-1]["1m_score"])


def test_close_only_proxy_is_explicitly_marked():
    f = feature_frame(history(800).close)
    assert f.attrs["price_basis"] == "close_only_proxy"


@pytest.mark.parametrize("bad", ["duplicate", "unsorted", "nan", "nonpositive", "bad_range", "intraday"])
def test_invalid_data_is_rejected_instead_of_silent_session_rephasing(bad):
    x = history(100)
    if bad == "duplicate":
        x.index = x.index[:99].append(x.index[98:99])
    elif bad == "unsorted":
        x = x.iloc[::-1]
    elif bad == "nan":
        x.iloc[30, 2] = np.nan
    elif bad == "nonpositive":
        x.iloc[30, 3] = 0
    elif bad == "bad_range":
        x.iloc[30, 1] = 1
    else:
        x.index = x.index + pd.Timedelta(hours=1)
    with pytest.raises(ValueError):
        feature_frame(x)


def test_forward_labels_are_separate_and_training_never_sees_test_outcomes():
    x = history()
    features = feature_frame(x)
    assert not any(c.startswith("fwd_") for c in features)
    labelled = add_forward_labels(features, x)
    summary = walk_forward_summary(labelled, score="swing_score", horizon=63)
    assert len(summary) > 3
    assert (summary.train_last_label_end < summary.test_start).all()
    assert labelled["fwd_63d"].iloc[-63:].isna().all()
