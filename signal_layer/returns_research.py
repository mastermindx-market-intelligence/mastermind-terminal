"""Causal Returns research procedure. This module cannot admit or publish a model.

Inputs are an explicit, uncompressed session axis and close observations. Reports
contain experimental predictions; the consumer envelope always has null odds.
No seasonal LOYO output, options sign, or indicator vote enters this procedure.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

VERSION = "returns.research.v1"
HORIZONS = (5, 21, 63)
CLASSES = ("down", "flat", "up")
FEATURES = ("return_5_scaled", "return_21_scaled", "return_63_scaled",
            "pace_change_5_scaled", "pace_change_21_scaled", "efficiency_21",
            "volatility_21_over_63", "drawdown_63_scaled")


@dataclass(frozen=True)
class Procedure:
    """Frozen defaults; any changed parameter is a different reported procedure."""
    min_train: int = 756
    calibration_sessions: int = 252
    refit_sessions: int = 126
    min_class_train: int = 20
    min_class_calibration: int = 10
    ridge: float = 0.05
    max_iterations: int = 1200
    gradient_tolerance: float = 1e-6
    bootstrap_draws: int = 500
    seed: int = 271828


def source_holds(evidence: dict) -> list[str]:
    """Read an owner's qualification verdict; this is not a new data authority."""
    holds = list(evidence.get("holds", []))
    if evidence.get("price_basis") not in ("owner_qualified_adjusted",):
        holds.append("PRICE_BASIS_UNQUALIFIED")
    if evidence.get("historical_availability") != "qualified_archive":
        holds.append("HISTORICAL_AVAILABILITY_UNVERIFIED")
    if not evidence.get("owner_qualification_reference"):
        holds.append("SOURCE_QUALIFICATION_REFERENCE_MISSING")
    return sorted(set(holds))


def consumer_abstention(symbol: str, as_of: str, horizon: int, reasons: list[str]) -> dict:
    return {"schema": "returns.forecast.v1", "status": "abstain", "symbol": symbol,
            "asOf": as_of, "horizon": horizon, "probabilities": None,
            "quantilesPct": None, "admissionReference": None,
            "reasons": sorted(set(reasons + ["CANONICAL_MODEL_ADMISSION_NOT_PUBLISHED"]))}


def _pace(log_prices: np.ndarray) -> float:
    x = np.arange(len(log_prices), dtype=float)
    x -= x.mean()
    return float(x @ (log_prices - log_prices.mean()) / (x @ x))


def features_at(closes: np.ndarray, i: int) -> tuple[np.ndarray, float] | None:
    """Strictly past-only features. A missing session invalidates its window."""
    if i < 126:
        return None
    history = np.asarray(closes[i-126:i+1], dtype=float)
    if len(history) != 127 or not np.isfinite(history).all() or (history <= 0).any():
        return None
    lp = np.log(history)
    moves = np.diff(lp)
    sigma = float(np.std(moves[-63:], ddof=1))
    # A price-constant sample cannot support a volatility-normalized model.
    if sigma < 1e-8:
        return None
    returns = [float(moves[-h:].sum() / (sigma * np.sqrt(h))) for h in (5, 21, 63)]
    change = [(_pace(lp[-h-1:]) - _pace(lp[-2*h-1:-h])) * np.sqrt(h) / sigma for h in (5, 21)]
    absolute = float(np.abs(moves[-21:]).sum())
    efficiency = float(moves[-21:].sum() / absolute) if absolute > 0 else 0.0
    prices63 = history[-64:]
    drawdown = float(np.min(prices63 / np.maximum.accumulate(prices63) - 1))
    x = np.array(returns + change + [efficiency, float(np.std(moves[-21:], ddof=1) / sigma),
                                   drawdown / (sigma * np.sqrt(63))])
    return x, sigma


def make_samples(dates: list[str], closes: np.ndarray, horizon: int) -> dict[str, np.ndarray]:
    if horizon not in HORIZONS or len(dates) != len(closes) or dates != sorted(set(dates)):
        raise ValueError("Invalid horizon or uncompressed session axis")
    values: dict[str, list] = {k: [] for k in ("x", "y", "decision", "label_end", "return_pct", "band_pct")}
    for i in range(126, len(closes) - horizon):
        feature = features_at(closes, i)
        future = closes[i:i+horizon+1]
        if feature is None or not np.isfinite(future).all() or (future <= 0).any():
            continue
        x, sigma = feature
        # Arithmetic-return event, with a symmetric band fixed at decision time.
        band = max(0.005, 0.5 * sigma * np.sqrt(horizon))
        realized = float(closes[i+horizon] / closes[i] - 1)
        y = 2 if realized > band else 0 if realized < -band else 1
        for key, value in (("x", x), ("y", y), ("decision", i), ("label_end", i+horizon),
                           ("return_pct", realized*100), ("band_pct", band*100)):
            values[key].append(value)
    return {k: np.asarray(v, dtype=int if k in ("y", "decision", "label_end") else float)
            for k, v in values.items()}


def fold_indices(samples: dict, test_start: int, horizon: int, spec: Procedure) -> tuple:
    calibration_start = test_start - horizon - spec.calibration_sessions
    train = np.flatnonzero(samples["label_end"] < calibration_start)
    calibration = np.flatnonzero((samples["decision"] >= calibration_start) &
                                 (samples["label_end"] < test_start))
    test = np.flatnonzero((samples["decision"] >= test_start) &
                         (samples["decision"] < test_start + spec.refit_sessions))
    return train, calibration, test


def _probabilities(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = logits / temperature
    z = z - z.max(axis=1, keepdims=True)
    exp = np.exp(z)
    return exp / exp.sum(axis=1, keepdims=True)


def losses(probabilities: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    brier = ((probabilities - np.eye(3)[labels]) ** 2).sum(axis=1)
    logloss = -np.log(np.maximum(probabilities[np.arange(len(labels)), labels], 1e-15))
    return brier, logloss


def fit_model(train_x: np.ndarray, labels: np.ndarray, spec: Procedure) -> dict:
    mean, scale = train_x.mean(axis=0), train_x.std(axis=0)
    scale = np.where(scale < 1e-8, 1.0, scale)
    x = np.column_stack([np.ones(len(train_x)), np.clip((train_x - mean) / scale, -8, 8)])
    w = np.zeros((x.shape[1], 3))
    counts = np.bincount(labels, minlength=3) + 1
    w[0] = np.log(counts / counts.sum())
    target = np.eye(3)[labels]
    # Multiclass softmax curvature <= 1/2; the spectral bound gives a safe step.
    rate = 1 / (0.5 * float(np.linalg.norm(x, 2) ** 2) / len(x) + spec.ridge)
    converged = False
    for iteration in range(spec.max_iterations):
        penalty = spec.ridge * w
        penalty[0] = 0
        gradient = x.T @ (_probabilities(x @ w) - target) / len(x) + penalty
        if np.max(np.abs(gradient)) < spec.gradient_tolerance:
            converged = True
            break
        w -= rate * gradient
    return {"weights": w, "mean": mean, "scale": scale, "converged": converged,
            "iterations": iteration + 1}


def logits(model: dict, x: np.ndarray) -> np.ndarray:
    z = np.clip((x - model["mean"]) / model["scale"], -8, 8)
    return np.column_stack([np.ones(len(x)), z]) @ model["weights"]


def calibrate(z: np.ndarray, y: np.ndarray) -> float:
    """One-parameter temperature; calibration labels never touch fitting or tests."""
    candidates = np.geomspace(0.5, 5.0, 41)
    scores = [float(losses(_probabilities(z, t), y)[1].mean()) for t in candidates]
    return float(candidates[int(np.argmin(scores))])


def bootstrap_indices(decisions: np.ndarray, block: int, spec: Procedure) -> tuple[np.ndarray | None, dict]:
    """Moving blocks never cross a missing session or an excluded fold."""
    segments = np.split(np.arange(len(decisions)), np.flatnonzero(np.diff(decisions) != 1) + 1)
    blocks = [segment[i:i+block] for segment in segments for i in range(max(0, len(segment)-block+1))]
    count = sum(len(segment)//block for segment in segments)
    meta = {"method": "moving_block_bootstrap", "block_sessions": block,
            "nonoverlapping_temporal_blocks": count, "candidate_blocks": len(blocks),
            "effective_sample_size": None, "draws": spec.bootstrap_draws, "seed": spec.seed + block,
            "short_segment_observations_excluded": sum(len(s) for s in segments if len(s) < block)}
    if count < 8 or not blocks:
        return None, meta
    rng = np.random.default_rng(spec.seed + block)
    chosen = rng.integers(len(blocks), size=(spec.bootstrap_draws, int(np.ceil(len(decisions)/block))))
    result = np.asarray(blocks)[chosen].reshape(spec.bootstrap_draws, -1)[:, :len(decisions)]
    return result, meta


def _ci(values: np.ndarray) -> list[float] | None:
    finite = values[np.isfinite(values)]
    return [float(v) for v in np.quantile(finite, [0.05, 0.95])] if len(finite) else None


def evaluation_scores(probabilities: dict[str, np.ndarray], labels: np.ndarray,
                      decisions: np.ndarray, horizon: int, spec: Procedure) -> dict:
    scored = {name: losses(p, labels) for name, p in probabilities.items()}
    summary = {name: {"brier": float(l[0].mean()), "log_loss": float(l[1].mean())}
               for name, l in scored.items()}
    dependence = []
    for block in (horizon, 2*horizon):
        indices, meta = bootstrap_indices(decisions, block, spec)
        comparisons = {}
        for name in ("past_prior", "momentum_baseline"):
            comparisons[name] = {}
            for metric, k in (("brier", 0), ("log_loss", 1)):
                diff = scored[name][k] - scored["candidate"][k]
                comparisons[name][metric] = {"improvement": float(diff.mean()),
                    "improvement_ci90": _ci(diff[indices].mean(axis=1)) if indices is not None else None}
        reliability = []
        candidate = probabilities["candidate"]
        for c, name in enumerate(CLASSES):
            for lower in (0.0, 0.2, 0.4, 0.6, 0.8):
                mask = (candidate[:, c] >= lower) & (candidate[:, c] < lower+0.2+ (1e-10 if lower == .8 else 0))
                count = int(mask.sum())
                if not count:
                    continue
                observed = (labels == c).astype(float)
                ci = None
                if indices is not None:
                    denominator = mask[indices].sum(axis=1)
                    numerator = (mask * (observed-candidate[:, c]))[indices].sum(axis=1)
                    valid = denominator > 0
                    ci = _ci(numerator[valid] / denominator[valid])
                reliability.append({"class": name, "bin": [lower, lower+0.2], "observations": count,
                                    "mean_probability": float(candidate[mask, c].mean()),
                                    "observed_frequency": float(observed[mask].mean()),
                                    "observed_minus_predicted_ci90": ci})
        dependence.append({**meta, "comparisons": comparisons, "reliability": reliability})
    return {"scoring_convention": "multiclass Brier summed over 3 classes; lower losses are better",
            "models": summary, "dependence": dependence,
            "class_counts": dict(zip(CLASSES, [int(v) for v in np.bincount(labels, minlength=3)]))}


def evaluate(symbol: str, dates: list[str], closes: np.ndarray, evidence: dict,
             horizon: int, *, exploratory: bool = False, spec: Procedure = Procedure()) -> dict[str, Any]:
    if horizon not in HORIZONS or not dates or len(dates) != len(closes):
        raise ValueError("Invalid evaluation context")
    holds = source_holds(evidence)
    report: dict[str, Any] = {"schema": VERSION, "symbol": symbol, "horizon": horizon,
        "research_only": True, "source": evidence, "source_holds": holds, "procedure": asdict(spec),
        "features": list(FEATURES), "target": {"kind": "forward_close_return",
            "neutral_band": "max(0.5%, 0.5 * trailing_63_session_sigma * sqrt(horizon))",
            "classes": list(CLASSES), "decision_information": "close and earlier sessions only"},
        "consumer": consumer_abstention(symbol, dates[-1], horizon, holds),
        "status": "blocked", "folds": [], "excluded_folds": [], "predictions": [], "scores": None}
    if holds and not exploratory:
        report["reasons"] = ["STRICT_EVALUATION_REQUIRES_QUALIFIED_HISTORY"]
        return report
    samples = make_samples(dates, closes, horizon)
    if not len(samples["y"]):
        report["reasons"] = ["NO_COMPLETE_SAMPLES"]
        return report
    predictions: dict[str, list] = {k: [] for k in ("candidate", "past_prior", "momentum_baseline")}
    labels, decision_axis = [], []
    first_test = 126 + spec.min_train + spec.calibration_sessions + 2*horizon
    for test_start in range(first_test, len(dates)-horizon, spec.refit_sessions):
        train, cal, test = fold_indices(samples, test_start, horizon, spec)
        classes_train = np.bincount(samples["y"][train], minlength=3)
        classes_cal = np.bincount(samples["y"][cal], minlength=3)
        if len(train) < spec.min_train or not len(test) or min(classes_train) < spec.min_class_train or min(classes_cal) < spec.min_class_calibration:
            report["excluded_folds"].append({"test_start": dates[test_start], "reason": "INSUFFICIENT_TRAINING_OR_CLASS_SUPPORT",
                "training_observations": len(train), "calibration_class_counts": classes_cal.tolist()})
            continue
        x, y = samples["x"], samples["y"]
        model = fit_model(x[train], y[train], spec)
        momentum = fit_model(x[train, 1:2], y[train], spec)
        if not model["converged"] or not momentum["converged"]:
            report["excluded_folds"].append({"test_start": dates[test_start], "reason": "OPTIMIZER_NOT_CONVERGED"})
            continue
        temperature = calibrate(logits(model, x[cal]), y[cal])
        momentum_temperature = calibrate(logits(momentum, x[cal, 1:2]), y[cal])
        prior = (classes_train+1) / (classes_train.sum()+3)
        probabilities = {"candidate": _probabilities(logits(model, x[test]), temperature),
            "past_prior": np.tile(prior, (len(test), 1)),
            "momentum_baseline": _probabilities(logits(momentum, x[test, 1:2]), momentum_temperature)}
        fold = {"id": len(report["folds"]), "train_decision_start": dates[int(samples["decision"][train[0]])],
            "train_label_end": dates[int(samples["label_end"][train[-1]])],
            "calibration_decision_start": dates[int(samples["decision"][cal[0]])],
            "calibration_label_end": dates[int(samples["label_end"][cal[-1]])],
            "test_decision_start": dates[int(samples["decision"][test[0]])],
            "test_decision_end": dates[int(samples["decision"][test[-1]])],
            "test_label_end": dates[int(samples["label_end"][test[-1]])],
            "training_observations": len(train), "calibration_observations": len(cal), "test_observations": len(test),
            "temperature": temperature, "momentum_temperature": momentum_temperature,
            "train_only_mean": model["mean"].tolist(), "train_only_scale": model["scale"].tolist(),
            "weights": model["weights"].tolist()}
        report["folds"].append(fold)
        for name, p in probabilities.items():
            predictions[name].extend(p)
        labels.extend(y[test]); decision_axis.extend(samples["decision"][test])
        for j, index in enumerate(test):
            report["predictions"].append({"fold": fold["id"], "decision": dates[int(samples["decision"][index])],
                "label_end": dates[int(samples["label_end"][index])], "observed_class": CLASSES[int(y[index])],
                "return_pct": float(samples["return_pct"][index]), "neutral_band_pct": float(samples["band_pct"][index]),
                "experimental_probabilities": {name: dict(zip(CLASSES, p[j].tolist())) for name, p in probabilities.items()}})
    if not labels:
        report["reasons"] = ["NO_ELIGIBLE_WALK_FORWARD_FOLDS"]
        return report
    report["scores"] = evaluation_scores({k: np.asarray(v) for k, v in predictions.items()}, np.asarray(labels), np.asarray(decision_axis), horizon, spec)
    report["status"] = "evaluated_exploratory" if holds else "evaluated_research"
    report["observations"] = len(labels)
    report["effective_observations"] = None
    report["reasons"] = ["RESEARCH_DOES_NOT_ADMIT_A_MODEL", "NO_TRADING_COST_OR_IMPLEMENTATION_CLAIM"]
    return report
