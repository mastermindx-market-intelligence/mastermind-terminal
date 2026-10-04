"""Point-in-time Terminal momentum features, not a validated trading model.

Product math is parity-locked to terminal/lib/mtfMomentum.ts. The existing
Terminal label "Stochastic RSI" denotes the H/L/C price stochastic (14, 3, 3).
RSI-MACD uses SMA-seeded EMA14/EMA60 of Wilder RSI14 and EMA5 signal. Do not
import Golden Oracle's first-value-seeded EMA here: it is a different contract.

Inputs are settled, ordered daily bars. Pass closed_through when a provider
also supplies a developing tail. Calendar values become available on the first
observed session of the NEXT bucket; the current bucket is never backdated.
"""
from __future__ import annotations

from numbers import Integral
from typing import Iterable

import numpy as np
import pandas as pd

TFS = ("D", "3D", "W", "2W", "1M")
WEIGHTS = {"D": 1.0, "3D": 1.25, "W": 1.5, "2W": 1.25, "1M": 1.0}
PRESETS = {"full": TFS, "swing": ("D", "3D", "W"), "position": ("3D", "W", "2W")}
FEATURE_VERSION = "terminal-mtf-momentum/v2"
MOMENTUM_EPSILON = 1e-9
MIN_MOMENTUM_BARS = 78
PRICE_COLUMNS = ["high", "low", "close"]


def _ohlc(daily: pd.Series | pd.DataFrame) -> pd.DataFrame:
    """Validate without silently dropping a session and rephasing the 3D grid.

    Close-only Series remain usable for synthetic/legacy research, explicitly
    marked as a proxy. The screener producer requires actual OHLC, never a proxy.
    """
    if not isinstance(daily, (pd.Series, pd.DataFrame)):
        raise TypeError("daily must be a pandas Series or DataFrame")
    if not isinstance(daily.index, pd.DatetimeIndex):
        raise ValueError("daily index must contain datetime session dates")
    idx = daily.index
    if idx.hasnans or idx.tz is not None or not idx.equals(idx.normalize()):
        raise ValueError("daily index must contain timezone-naive midnight session dates")
    if not idx.is_unique or not idx.is_monotonic_increasing:
        raise ValueError("daily sessions must be unique and strictly increasing")
    if isinstance(daily, pd.Series):
        close = pd.to_numeric(daily, errors="raise").astype(float)
        result = pd.DataFrame({"high": close, "low": close, "close": close})
        result.attrs["price_basis"] = "close_only_proxy"
    else:
        aliases = {"high": ("high", "h", "High"), "low": ("low", "l", "Low"),
                   "close": ("close", "c", "Close"), "open": ("open", "o", "Open")}
        columns = {}
        for dest, names in aliases.items():
            source = next((name for name in names if name in daily.columns), None)
            if source is None:
                if dest == "open":
                    continue
                raise ValueError(f"daily OHLC missing {dest}")
            columns[dest] = pd.to_numeric(daily[source], errors="raise").astype(float)
        result = pd.DataFrame(columns, index=idx)
        result.attrs["price_basis"] = daily.attrs.get("price_basis", "ohlc")
    values = result.to_numpy(dtype=float)
    if not np.isfinite(values).all() or (values <= 0).any():
        raise ValueError("OHLC must be finite and positive; repair missing sessions upstream")
    if ((result.high < result.low) | (result.close > result.high) |
            (result.close < result.low)).any():
        raise ValueError("OHLC range must contain the close")
    if "open" in result and ((result.open > result.high) | (result.open < result.low)).any():
        raise ValueError("OHLC range must contain the open")
    return result


def _sma(values: np.ndarray, length: int) -> np.ndarray:
    # Serial addition across each window, vectorized across rows. Unlike Python
    # 3.12 sum or cumsum subtraction this preserves the product's operation order.
    out = np.full(len(values), np.nan)
    count = len(values) - length + 1
    if count > 0:
        total = np.zeros(count)
        for offset in range(length):
            total += values[offset:offset + count]
        out[length - 1:] = total / length
    return out


def _ema(values: np.ndarray, length: int) -> np.ndarray:
    out = np.full(len(values), np.nan)
    previous = None
    total, count, alpha = 0.0, 0, 2.0 / (length + 1)
    for i, value in enumerate(values):
        if not np.isfinite(value):
            continue
        value = float(value)
        if previous is None:
            total += value
            count += 1
            if count == length:
                previous = total / length
                out[i] = previous
        else:
            previous = value * alpha + previous * (1 - alpha)
            out[i] = previous
    return out


def _wilder_rsi(close: np.ndarray, length: int = 14) -> np.ndarray:
    out = np.full(len(close), np.nan)
    gain = loss = 0.0
    for i in range(1, len(close)):
        change = float(close[i]) - float(close[i - 1])
        up, down = max(change, 0.0), max(-change, 0.0)
        if i <= length:
            gain += up
            loss += down
            if i != length:
                continue
            gain /= length
            loss /= length
        else:
            gain = (gain * (length - 1) + up) / length
            loss = (loss * (length - 1) + down) / length
        out[i] = 100.0 if loss == 0 else 100.0 - 100.0 / (1.0 + gain / loss)
    return out


def _terminal_stochastic(x: pd.DataFrame, n=14, k_smooth=3, d_smooth=3):
    raw = np.full(len(x), np.nan)
    if len(x) >= n:
        from numpy.lib.stride_tricks import sliding_window_view
        hi = sliding_window_view(x.high.to_numpy(dtype=float), n).max(axis=1)
        lo = sliding_window_view(x.low.to_numpy(dtype=float), n).min(axis=1)
        span = hi - lo
        close = x.close.to_numpy(dtype=float)[n - 1:]
        values = np.full(len(span), 50.0)
        np.divide(100.0 * (close - lo), span, out=values, where=span != 0)
        raw[n - 1:] = values
    k = _sma(raw, k_smooth)
    return pd.Series(k, index=x.index), pd.Series(_sma(k, d_smooth), index=x.index)


def _direction(a: float, b: float) -> int:
    return 1 if a - b > MOMENTUM_EPSILON else -1 if b - a > MOMENTUM_EPSILON else 0


def _state(x: pd.DataFrame) -> pd.DataFrame:
    """Product points, including null warmup, stable comparisons and phase precedence."""
    ks, ds = _terminal_stochastic(x)
    k, d = ks.to_numpy(), ds.to_numpy()
    rsi = _wilder_rsi(x.close.to_numpy(dtype=float))
    macd = _ema(rsi, 14) - _ema(rsi, 60)
    signal = _ema(macd, 5)
    ready = np.isfinite(np.column_stack([k, d, macd, signal])).all(axis=1)
    kd = np.where(k - d > MOMENTUM_EPSILON, 1, np.where(d - k > MOMENTUM_EPSILON, -1, 0))
    md = np.where(macd - signal > MOMENTUM_EPSILON, 1, np.where(signal - macd > MOMENTUM_EPSILON, -1, 0))
    previous_k = np.r_[np.nan, k[:-1]] if len(k) else k
    previous_m = np.r_[np.nan, macd[:-1]] if len(macd) else macd
    previous_s = np.r_[np.nan, signal[:-1]] if len(signal) else signal
    stoch_reclaim = ready & (kd > 0) & (k < 35 - MOMENTUM_EPSILON) & (k - previous_k > MOMENTUM_EPSILON)
    macd_reclaim = ready & (md > 0) & (macd < -MOMENTUM_EPSILON) & np.isfinite(previous_m) & np.isfinite(previous_s) & (previous_m - previous_s <= MOMENTUM_EPSILON)
    washout = (k < 20 - MOMENTUM_EPSILON) & (d < 20 - MOMENTUM_EPSILON)
    rollover = (kd < 0) & (k > 70 + MOMENTUM_EPSILON)
    phase = np.select([washout, stoch_reclaim | macd_reclaim, (kd > 0) & (md > 0), rollover,
                       (kd < 0) & (md < 0), (kd == 0) & (md == 0)],
                      ["washout", "reclaim", "bull", "rollover", "bear", "neutral"], default="mixed").astype(object)
    phase[~ready] = None
    score = 50.0 + (k - 50.0) * .28 + 12 * kd + 16 * md
    score += 10 * stoch_reclaim
    score += 12 * macd_reclaim
    score -= 8 * (washout & (kd < 0))
    score = np.clip(score, 0, 100)
    score[~ready] = np.nan
    return pd.DataFrame({"k": k, "d": d, "macd": macd, "signal": signal, "score": score,
                         "phase": pd.Series(phase, index=x.index, dtype=object), "ready": ready, "stoch_reclaim": stoch_reclaim.astype(float),
                         "macd_reclaim": macd_reclaim.astype(float), "reclaim": (phase == "reclaim").astype(float),
                         "washout": (phase == "washout").astype(float),
                         "falling": np.isin(phase, ["washout", "bear"]).astype(float)}, index=x.index)


def _group_arrays(keys: np.ndarray):
    if not len(keys):
        return np.array([], dtype=int), np.array([], dtype=int)
    starts = np.r_[0, np.flatnonzero(keys[1:] != keys[:-1]) + 1]
    return starts, np.r_[starts[1:] - 1, len(keys) - 1]


def _aggregate(x: pd.DataFrame, starts: Iterable[int], ends: Iterable[int], *, calendar: bool):
    starts, ends = np.asarray(starts, dtype=int), np.asarray(ends, dtype=int)
    if not len(starts):
        return pd.DataFrame(columns=PRICE_COLUMNS, index=pd.DatetimeIndex([]), dtype=float), pd.DatetimeIndex([])
    # Groups are contiguous and ordered. Bounded reduceat avoids a DataFrame
    # allocation for every bucket when replaying a whole universe.
    stop = int(ends[-1]) + 1
    high = np.maximum.reduceat(x.high.to_numpy(dtype=float)[:stop], starts)
    low = np.minimum.reduceat(x.low.to_numpy(dtype=float)[:stop], starts)
    close = x.close.to_numpy(dtype=float)[ends]
    labels = x.index[ends if calendar else starts]
    known = x.index[ends + 1 if calendar else ends]
    return pd.DataFrame({"high": high, "low": low, "close": close}, index=labels), known


def _groups_3d(x: pd.DataFrame, bar_anchor: int):
    if isinstance(bar_anchor, bool) or not isinstance(bar_anchor, Integral):
        raise ValueError("bar_anchor must be an integer row-zero session index")
    # Same canonical close rule as sessionBars.ts: global index modulo 3 == 0.
    ends = np.flatnonzero((np.arange(len(x)) + int(bar_anchor)) % 3 == 0)
    starts = np.r_[0, ends[:-1] + 1] if len(ends) else np.array([], dtype=int)
    return _aggregate(x, starts, ends, calendar=False)


def _calendar_groups(x: pd.DataFrame, tf: str):
    if tf == "W":
        # ISO Monday weeks, matching ChartPanel even for 7-day series.
        keys = (x.index - pd.to_timedelta(x.index.weekday, unit="D")).to_numpy(dtype="datetime64[D]")
    elif tf == "1M":
        keys = x.index.to_numpy(dtype="datetime64[M]")
    else:
        raise ValueError(f"unsupported calendar timeframe: {tf}")
    starts, ends = _group_arrays(keys)
    return _aggregate(x, starts[:-1], ends[:-1], calendar=True)


def _groups_2w(x: pd.DataFrame):
    monday = x.index - pd.to_timedelta(x.index.weekday, unit="D")
    keys = monday.to_numpy(dtype="datetime64[D]").astype(np.int64) // 14
    starts, ends = _group_arrays(keys)
    return _aggregate(x, starts[:-1], ends[:-1], calendar=True)


def _tf_ohlc(daily: pd.Series | pd.DataFrame, tf: str, bar_anchor: int = 0):
    x = _ohlc(daily)
    if tf == "D":
        return x, pd.DatetimeIndex(x.index)
    if tf == "3D":
        return _groups_3d(x, bar_anchor)
    if tf == "2W":
        return _groups_2w(x)
    return _calendar_groups(x, tf)


def _aggregate_score(base: pd.DataFrame, timeframes: tuple[str, ...]):
    weights = sum(WEIGHTS[tf] for tf in timeframes)
    ready = pd.concat([base[f"{tf.lower()}_score"].notna() for tf in timeframes], axis=1).all(axis=1)
    momentum = sum(base[f"{tf.lower()}_score"] * WEIGHTS[tf] for tf in timeframes) / weights
    reclaims = sum(base[f"{tf.lower()}_reclaim"].fillna(0) for tf in timeframes)
    falling = sum(base[f"{tf.lower()}_falling"].fillna(0) for tf in timeframes)
    bottom_bonus = (10 * (1 - base.bottom_position)).fillna(0)
    setup = (momentum + bottom_bonus + np.minimum(10, reclaims * 3) - np.maximum(0, falling - 2) * 4).clip(0, 100)
    return momentum.where(ready), setup.where(ready)


def feature_frame(daily: pd.Series | pd.DataFrame, bar_anchor: int = 0, *, closed_through=None) -> pd.DataFrame:
    """Settled-data features. Unknown lanes stay null; full score requires all five."""
    dx = _ohlc(daily)
    if closed_through is not None:
        boundary = pd.Timestamp(closed_through)
        if boundary.tz is not None or pd.isna(boundary) or boundary != boundary.normalize():
            raise ValueError("closed_through must be an unambiguous session date")
        dx = dx.loc[dx.index <= boundary]
    base = pd.DataFrame(index=dx.index)
    for tf in TFS:
        x, known = _tf_ohlc(dx, tf, bar_anchor)
        z = _state(x)
        z["bar_time"] = x.index
        z["known_at"] = known
        z["closed_bars"] = np.arange(1, len(z) + 1)
        z.index = known
        # Backward availability join, never an opening-label join.
        z = z.reindex(base.index, method="ffill").add_prefix(tf.lower() + "_")
        base = pd.concat([base, z], axis=1)
    close = dx.close
    low = close.rolling(252, min_periods=63).min()
    high = close.rolling(252, min_periods=63).max()
    base["bottom_position"] = ((close - low) / (high - low).replace(0, np.nan)).clip(0, 1)
    base["drawdown_252"] = close / high - 1
    base["coverage_count"] = sum(base[f"{tf.lower()}_score"].notna().astype(int) for tf in TFS)
    base["reclaim_count"] = sum(base[f"{tf.lower()}_reclaim"].fillna(0) for tf in TFS)
    base["washout_count"] = sum(base[f"{tf.lower()}_washout"].fillna(0) for tf in TFS)
    base["falling_count"] = sum(base[f"{tf.lower()}_falling"].fillna(0) for tf in TFS)
    base["mtf_score"], base["setup_score"] = _aggregate_score(base, TFS)
    for name in ("swing", "position"):
        _, base[f"{name}_score"] = _aggregate_score(base, PRESETS[name])
    base.attrs.update(feature_version=FEATURE_VERSION, score_status="uncalibrated_prior", price_basis=dx.attrs.get("price_basis", "ohlc"))
    return base


def add_forward_labels(features: pd.DataFrame, daily: pd.Series | pd.DataFrame, horizons=(5, 21, 63)) -> pd.DataFrame:
    """Evaluation-only close-to-close benchmarks, NOT executable entry returns."""
    out = features.copy()
    close = _ohlc(daily).close.reindex(out.index)
    for h in horizons:
        if isinstance(h, bool) or not isinstance(h, Integral) or h < 1:
            raise ValueError("horizon must be a positive integer session count")
        out[f"fwd_{h}d"] = close.shift(-h) / close - 1
        out[f"label_end_{h}d"] = pd.Series(out.index, index=out.index).shift(-h)
    return out


def walk_forward_summary(frame: pd.DataFrame, score="setup_score", horizon=21, min_train_years=3) -> pd.DataFrame:
    """Expanding yearly descriptive evaluation with overlapping training labels purged."""
    label = f"fwd_{horizon}d"
    end_name = f"label_end_{horizon}d"
    ends = frame[end_name] if end_name in frame else pd.Series(frame.index, index=frame.index).shift(-horizon)
    years = sorted(set(frame.index.year))
    rows = []
    for year in years[min_train_years:]:
        test = frame.loc[frame.index.year == year].dropna(subset=[score, label])
        if len(test) < 20:
            continue
        start = frame.index[frame.index.year == year][0]
        train = frame.loc[(frame.index < start) & (ends < start)].dropna(subset=[score, label])
        if len(train) < 100:
            continue
        threshold = float(train[score].quantile(.9))
        picked = test.loc[test[score] >= threshold]
        rows.append({"test_year": year, "train_n": len(train), "test_n": len(test),
                     "train_last_label_end": ends.loc[train.index].max(), "test_start": start,
                     "threshold": threshold, "signals": len(picked),
                     "mean_fwd": picked[label].mean(), "median_fwd": picked[label].median(),
                     "hit_rate": (picked[label] > 0).mean() if len(picked) else np.nan})
    columns = ["test_year", "train_n", "test_n", "train_last_label_end", "test_start", "threshold", "signals", "mean_fwd", "median_fwd", "hit_rate"]
    return pd.DataFrame(rows, columns=columns)
