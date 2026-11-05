"""Pure China-index OHLC adapter for the existing Terminal macro-symbol writer.

This module never publishes a file or reads a private license. The existing Macro
`collectors.tushare_client` remains the one credential, throttle, error and endpoint
owner; the Terminal nightly supplies MACRO_REPO and (when installed) TUSHARE_TOKEN.
A missing credential/client or an invalid result returns no rows, which the caller
must treat as KEEP-OLD, not as a reason to remove a good index series.

TuShare index_daily returns unadjusted native index *points*, vol in 100-share
lots (手), and amount in thousand CNY. The Terminal positional OHLC contract uses
integer share units; only volume is multiplied by 100, never the index point levels.
Index constituents' volume can differ from exchange-wide market volume, per
TuShare's index_daily documentation; we do not relabel it as total market turnover.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

CN_INDEX_TS_CODE = {
    "000300.SS": "000300.SH",  # CSI 300
    "000905.SS": "000905.SH",  # CSI 500
    "399006.SZ": "399006.SZ",  # ChiNext
}
CN_INDEX_SYMBOLS = frozenset(CN_INDEX_TS_CODE)
FIELDS = "ts_code,trade_date,open,high,low,close,vol,amount"
FIRST_REQUEST_DATE = "20000101"
MIN_VALID_DAILY_BARS = 1000
MAX_STALE_DAYS = 20
TU_SOURCE = "tushare"


@lru_cache(maxsize=1)
def _macro_tushare_client() -> Any | None:
    """Load the already-owned Macro client by its operator-configured source path.

    Do not implement another token reader, REST client, throttle, or retry layer.
    The nightly sets MACRO_REPO=/opt/macro; developer tests inject `query` instead.
    """
    path = Path(os.environ.get("MACRO_REPO") or "/opt/macro") / "collectors" / "tushare_client.py"
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("_mmx_macro_tushare_client", path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except ImportError:
        return None
    return module


def _finite(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _trade_date(raw: object) -> str | None:
    if not isinstance(raw, str) or len(raw) != 8 or not raw.isascii() or not raw.isdigit():
        return None
    try:
        return dt.datetime.strptime(raw, "%Y%m%d").date().isoformat()
    except ValueError:
        return None


def normalize_index_daily(
    symbol: str,
    records: list[dict[str, Any]],
    *,
    as_of: dt.date,
    min_bars: int = MIN_VALID_DAILY_BARS,
) -> list[list]:
    """Accept genuine, unique daily index points; skip invalid/prelaunch rows.

    Reject a response with foreign ticker identity or conflicting duplicate dates
    instead of silently joining another series. Invalid dated rows, NaN, zero
    prelaunch candles and malformed prices/volume never become chart bars.
    """
    provider = CN_INDEX_TS_CODE.get(symbol)
    if not provider or not isinstance(records, list):
        return []
    expected_codes = {provider, symbol}
    by_day: dict[str, list] = {}
    for raw in records:
        if not isinstance(raw, dict) or raw.get("ts_code") not in expected_codes:
            return []
        date = _trade_date(raw.get("trade_date"))
        # Keep admission within the same inclusive cutoff sent as end_date.
        if date is None or date > as_of.isoformat():
            continue
        prices = [_finite(raw.get(field)) for field in ("open", "high", "low", "close")]
        lots = _finite(raw.get("vol"))
        if (
            any(value is None or value <= 0 for value in prices)
            or lots is None or lots < 0
        ):
            continue
        opening, high, low, close = prices
        if not low <= min(opening, close) <= max(opening, close) <= high:
            continue
        shares = lots * 100
        if not math.isfinite(shares) or shares > 9_007_199_254_740_991:
            continue  # prevent precision-unsafe JS volume integers
        row = [date, *(round(value, 6) for value in prices), int(round(shares))]
        if date in by_day and by_day[date] != row:
            return []
        by_day[date] = row
    if len(by_day) < min_bars:
        return []
    last_date = dt.date.fromisoformat(max(by_day))
    if (as_of - last_date).days > MAX_STALE_DAYS:
        return []
    return [by_day[day] for day in sorted(by_day)]


def fetch_cn_index_history(
    symbol: str,
    *,
    query: Callable[..., Any] | None = None,
    as_of: dt.date | None = None,
) -> list[list]:
    """Use the Macro-owned TuShare `index_daily` client, never a second API plane."""
    if symbol not in CN_INDEX_SYMBOLS:
        return []
    if query is None:
        client = _macro_tushare_client()
        if client is None or not client.enabled():
            return []
        query = client.query
    as_of = as_of or dt.datetime.now(dt.timezone.utc).date()
    try:
        frame = query(
            "index_daily",
            ts_code=CN_INDEX_TS_CODE[symbol],
            start_date=FIRST_REQUEST_DATE,
            end_date=as_of.strftime("%Y%m%d"),
            fields=FIELDS,
            _retries=0,  # never replay a denied or ambiguous vendor effect
        )
        if frame is None or not callable(getattr(frame, "to_dict", None)):
            return []
        rows = frame.to_dict("records")
    except (AttributeError, TypeError, ValueError, OSError):
        return []
    return normalize_index_daily(symbol, rows, as_of=as_of)


def retain_prior_tushare_bars(
    path: Path,
    fetched: list[list],
    *,
    is_valid_bar: Callable[[object], bool],
) -> list[list]:
    """Retain only earlier SAME-SOURCE qualified dates, never Yahoo/ETF hybrids.

    The source changes from Yahoo to TuShare on first publication; that switch
    must be a complete replacement of the authentic index-point series.
    """
    if len(fetched) < MIN_VALID_DAILY_BARS:
        return fetched
    try:
        existing = json.loads(path.read_text())
    except (OSError, ValueError, TypeError):
        return fetched
    if not isinstance(existing, dict) or existing.get("src") != TU_SOURCE:
        return fetched
    stored = existing.get("bars")
    if not isinstance(stored, list):
        return fetched
    by_day = {row[0]: row for row in stored if is_valid_bar(row)}
    by_day.update((row[0], row) for row in fetched if is_valid_bar(row))
    return [by_day[key] for key in sorted(by_day)]
