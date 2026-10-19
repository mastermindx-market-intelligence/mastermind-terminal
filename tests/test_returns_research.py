"""Discriminating tests for temporal leakage, losses, gaps, and admission."""
from datetime import date, timedelta

import numpy as np

from signal_layer.returns_research import (Procedure, bootstrap_indices, calibrate, consumer_abstention,
    evaluate, features_at, fit_model, fold_indices, logits, losses, make_samples, _probabilities)


def fixture(n=1500):
    # This pure function receives an already validated session axis. These daily
    # ordinal labels are synthetic; the CLI separately binds the actual NYSE owner.
    dates = [(date(2020, 1, 1) + timedelta(days=i)).isoformat() for i in range(n)]
    rng = np.random.default_rng(81)
    moves = rng.normal(0.0004, 0.015, n)
    return dates, 100 * np.exp(np.cumsum(moves))


def test_future_prices_never_change_a_decision_feature_or_band():
    dates, closes = fixture()
    before, sigma = features_at(closes, 200)
    revised = closes.copy(); revised[201:] *= 3
    after, after_sigma = features_at(revised, 200)
    np.testing.assert_array_equal(before, after)
    assert sigma == after_sigma
    a, b = make_samples(dates, closes, 21), make_samples(dates, revised, 21)
    index = np.flatnonzero(a["decision"] == 200)[0]
    assert a["band_pct"][index] == b["band_pct"][index]
    assert a["return_pct"][index] != b["return_pct"][index]


def test_labels_mature_before_the_next_partition_and_use_exact_horizons():
    dates, closes = fixture()
    spec = Procedure(min_train=200, calibration_sessions=100)
    for horizon in (5, 21, 63):
        samples = make_samples(dates, closes, horizon)
        train, cal, test = fold_indices(samples, 900, horizon, spec)
        assert max(samples["label_end"][train]) < min(samples["decision"][cal])
        assert max(samples["label_end"][cal]) < min(samples["decision"][test])
        np.testing.assert_array_equal(samples["label_end"]-samples["decision"], horizon)


def test_missing_session_is_not_compressed_or_filled():
    dates, closes = fixture(); closes[200] = np.nan
    samples = make_samples(dates, closes, 21)
    assert 200 not in samples["decision"]
    assert 201 not in samples["decision"]
    assert 326 not in samples["decision"]
    assert 327 in samples["decision"]
    assert 179 not in samples["decision"]  # Label interval crosses the missing close.
    np.testing.assert_array_equal(samples["label_end"]-samples["decision"], 21)


def test_brier_and_log_loss_have_the_declared_multiclass_units():
    brier, logloss = losses(np.array([[1/3, 1/3, 1/3], [0, 0, 1]]), np.array([0, 2]))
    np.testing.assert_allclose(brier, [2/3, 0])
    np.testing.assert_allclose(logloss, [np.log(3), 0])


def test_training_transform_is_fitted_only_on_training_rows():
    rng = np.random.default_rng(2); x = rng.normal(size=(1000, 2)); y = (x[:, 0] > .5).astype(int)*2
    y[np.abs(x[:, 0]) < .5] = 1
    model = fit_model(x, y, Procedure())
    assert model["converged"]
    np.testing.assert_allclose(model["mean"], x.mean(axis=0))
    z = logits(model, x[:20]); p = _probabilities(z)
    np.testing.assert_allclose(p.sum(axis=1), 1)
    assert np.isfinite(p).all()
    temperature = calibrate(z, y[:20])
    assert .5 <= temperature <= 5


def test_bootstrap_blocks_do_not_cross_a_missing_fold_or_session():
    spec = Procedure(bootstrap_draws=20)
    decisions = np.r_[np.arange(100), np.arange(200, 300)]
    indices, meta = bootstrap_indices(decisions, 5, spec)
    assert indices is not None
    for draw in indices:
        for block in draw.reshape(-1, 5):
            np.testing.assert_array_equal(np.diff(decisions[block]), 1)
    assert meta["effective_sample_size"] is None
    assert meta["nonoverlapping_temporal_blocks"] == 40


def test_strict_mode_stops_before_fitting_unqualified_history():
    dates, closes = fixture()
    report = evaluate("NVDA", dates, closes, {}, 21)
    assert report["status"] == "blocked"
    assert report["predictions"] == []
    assert report["consumer"]["probabilities"] is None


def test_exploratory_results_never_become_consumer_probabilities():
    dates, closes = fixture(1150)
    spec = Procedure(min_train=200, calibration_sessions=100, min_class_train=5,
                     min_class_calibration=3, bootstrap_draws=20)
    report = evaluate("NVDA", dates, closes, {}, 5, exploratory=True, spec=spec)
    assert report["status"] == "evaluated_exploratory"
    assert report["observations"] > 500
    assert report["consumer"]["probabilities"] is None
    assert report["effective_observations"] is None
    assert set(report["scores"]["models"]) == {"candidate", "past_prior", "momentum_baseline"}
    assert "CANONICAL_MODEL_ADMISSION_NOT_PUBLISHED" in report["consumer"]["reasons"]
    for fold in report["folds"]:
        assert fold["train_label_end"] < fold["calibration_decision_start"]
        assert fold["calibration_label_end"] < fold["test_decision_start"]


def test_even_no_source_holds_cannot_self_admit_a_model():
    result = consumer_abstention("NVDA", "2026-10-16", 21, [])
    assert result["status"] == "abstain"
    assert result["probabilities"] is None
    assert result["admissionReference"] is None
