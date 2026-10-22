"""mastermind.reported-ownership/v1 — provider-reported institutional holders.

WHY THIS EXISTS
    `fund.ownership.top_inst` (the incumbent field) keeps a name, an undated percentage and a
    number-less value. It erases the reporting date, the share count and the source. Rendering it
    as verified 13F would assert a provenance and a date the cache never carried, so the Terminal
    cannot show it. This module normalizes the *already dated* Yahoo `institutional_holders` frame
    that `ingest/collect_us_fund.py` writes into the incumbent raw cache
    (`$MACRO_ROOT/data/us_fund/<TICKER>.json`) into one atomic, self-describing block that keeps
    what the provider actually stated and nothing it did not.

THE CONTRACT
    schema `mastermind.reported-ownership/v1`, optional at `fund.ownership.reported`, scoped to one
    listing (ticker + market). Only the Yahoo/yfinance `institutional_holders` table is qualified
    here; this adapter never establishes a publication time, so `publication_time` is always null.

WHAT IS DELIBERATELY ABSENT
    * `Value` and `pctChange` — dropped. A value without a currency is a guess, and a period change
      is a trend claim this panel does not make.
    * Aggregate counts/totals — the block is a list of what the provider said, not a summary.
    * Any float. Every numeric observation is a canonical decimal/integer STRING, and every other
      leaf is a string or null, so the canonical JSON is byte-identical in Python and JS and the
      content hash means the same thing in both. See `_assert_no_numbers`.

INTEGRITY RECEIPT — WHAT IT IS NOT
    `raw_input_sha256` covers the exact raw bytes this block was derived from and `content_sha256`
    covers the canonical JSON of this block. Together they prove the block was not corrupted or
    edited between the cache and the screen. They are NOT a signature, NOT an attestation that the
    provider said what it said, and NOT CI manifest verification. They say nothing about whether a
    13F was filed. Nothing here may be used to qualify, authorize or substitute for a verified CI
    event.

DEGRADED FETCHES
    On a fetch or field failure with a previously qualified block, the earlier rows are retained
    verbatim together with their ORIGINAL `acquired_at` and their original report dates, and the
    block is degraded to `partial` with `latest_attempt_at` set to the real attempt when one is
    known. Old data is never restamped as current; `raw_input_sha256` keeps describing the bytes
    the retained rows actually came from.

This module is a library, not an emitter: it imports only the stdlib, opens no network, and writes
no files. It never reads credentials and never touches the cache.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import quote

SCHEMA = "mastermind.reported-ownership/v1"
NORMALIZER_VERSION = "1"
POPULATION = "vendor_institutional_holders"
PERCENTAGE_BASIS = "provider_reported_unspecified"

SOURCE_NAME = "Yahoo Finance"
SOURCE_ADAPTER = "yfinance"
SOURCE_FIELD = "institutional_holders"
SOURCE_URL_PREFIX = "https://finance.yahoo.com/quote/"
SOURCE_URL_SUFFIX = "/holders/"

# Listing-scoped markets this adapter qualifies. Anything else is out of scope, not degraded.
MARKET_SUFFIXES = {".TO": "ca", ".V": "ca", ".HK": "hk"}

AVAILABLE = "available"
PARTIAL = "partial"
UNAVAILABLE = "unavailable"
SOURCE_ERROR = "source_error"
AVAILABILITY_VALUES = (AVAILABLE, PARTIAL, UNAVAILABLE, SOURCE_ERROR)

# Stable, machine reasons. The Terminal maps these to localized copy and falls back to the code
# itself when it meets one it does not know, so an old client never invents a description.
REASON_RAW_UNAVAILABLE = "raw_unavailable"
REASON_RAW_UNPARSABLE = "raw_unparsable"
REASON_TICKER_MISMATCH = "raw_ticker_mismatch"
REASON_ACQUIRED_AT_MISSING = "acquired_at_missing"
REASON_MARKET_UNSUPPORTED = "market_unsupported"
REASON_FETCH_FIELD_ERROR = "fetch_field_error"
REASON_NO_DATED_ROWS = "no_dated_rows"
REASON_ROWS_DROPPED = "rows_dropped_unqualified"
REASON_RETAINED_AFTER_FAILURE = "retained_after_failure"
REASON_CODES = (
    REASON_RAW_UNAVAILABLE,
    REASON_RAW_UNPARSABLE,
    REASON_TICKER_MISMATCH,
    REASON_ACQUIRED_AT_MISSING,
    REASON_MARKET_UNSUPPORTED,
    REASON_FETCH_FIELD_ERROR,
    REASON_NO_DATED_ROWS,
    REASON_ROWS_DROPPED,
    REASON_RETAINED_AFTER_FAILURE,
)

# Frame axes are addressed BY NAME, never by position: the provider has re-ordered these columns
# before and a positional read would silently attach a share count to the wrong column.
COLUMN_REPORTED_DATE = "Date Reported"
COLUMN_HOLDER = "Holder"
COLUMN_SHARES = "Shares"
COLUMN_FRACTION = "pctHeld"

_PLAIN_DECIMAL_RE = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
_DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_ACQUIRED_AT_RE = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$")
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")


# ─────────────────────────────────────────────────────────────────────────────
# scalar normalization
# ─────────────────────────────────────────────────────────────────────────────
def _reject_constant(name: str) -> Any:
    """Python's json accepts bare NaN/Infinity by default; JSON does not.

    A non-finite observation must never become a `null` that reads like "the provider did not
    report this". It has to fail the parse so the row is dropped and counted instead.
    """
    raise ValueError(f"non-finite JSON constant: {name}")


def _plain_decimal(value: Any) -> str | None:
    """Canonical plain decimal string for a fractional observation, or None.

    No exponent, no sign, no leading zeros — so Python and JS agree on the exact characters and the
    [0,1] bound is decidable by string comparison instead of by binary floating point.
    """
    if isinstance(value, bool) or value is None:
        return None
    text = value.strip() if isinstance(value, str) else None
    if text is None:
        # parse_float=str guarantees JSON numbers arrive here as their source literal.
        return None
    if _PLAIN_DECIMAL_RE.match(text):
        whole, _, frac = text.partition(".")
        frac = frac.rstrip("0")
        return whole if not frac else f"{whole}.{frac}"
    try:
        number = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number < 0:
        return None
    fixed = format(number, "f")
    whole, _, frac = fixed.partition(".")
    frac = frac.rstrip("0")
    return whole if not frac else f"{whole}.{frac}"


def _fraction_in_unit_interval(text: str) -> bool:
    """0 <= text <= 1 for a canonical plain decimal, without touching a float."""
    whole, _, frac = text.partition(".")
    # The regex already forbids leading zeros, so `whole` is "0" or a canonical positive integer.
    if len(whole) > 1:  # >= 10, unambiguously out of range
        return False
    if whole == "1":  # only 1.000... exactly
        return not frac.strip("0")
    return whole == "0"  # 2..9 are single digits and still out of range


def _integer_string(value: Any) -> str | None:
    """Canonical decimal integer string for a share count, or None.

    A share count that is fractional, negative or non-numeric is unknown here, not zero.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value) if value >= 0 else None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if _PLAIN_DECIMAL_RE.match(text):
        whole, _, frac = text.partition(".")
        if frac.strip("0"):
            return None  # 70220631.5 is not a share count
        return whole
    try:
        number = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number < 0 or number != number.to_integral_value():
        return None
    return str(int(number))


def _calendar_date(value: Any) -> str | None:
    """A real calendar date as YYYY-MM-DD, or None.

    `date.fromisoformat` accepts a wider grammar on 3.11+, so the exact shape is pinned first and
    then the date is actually constructed: 2026-02-30 must not survive as a string.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not _DATE_RE.match(text):
        return None
    year, month, day = int(text[0:4]), int(text[5:7]), int(text[8:10])
    if not 1 <= month <= 12:
        return None
    if month in (1, 3, 5, 7, 8, 10, 12):
        limit = 31
    elif month in (4, 6, 9, 11):
        limit = 30
    else:
        leap = (year % 4 == 0 and year % 100 != 0) or year % 400 == 0
        limit = 29 if leap else 28
    return text if 1 <= day <= limit else None


def _acquired_at(value: Any) -> str | None:
    """The raw `fetched_at` as a strict UTC instant, or None. Never re-derived, never defaulted."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not _ACQUIRED_AT_RE.match(text):
        return None
    try:
        parsed = _calendar_date(text[:10])
        hour, minute, second = int(text[11:13]), int(text[14:16]), int(text[17:19])
    except ValueError:
        return None
    if not parsed or hour > 23 or minute > 59 or second > 60:
        return None
    return text


def _day_ordinal(date_text: str) -> int:
    """Proleptic-Gregorian day number for a validated YYYY-MM-DD (no `datetime` import needed)."""
    year, month, day = int(date_text[0:4]), int(date_text[5:7]), int(date_text[8:10])
    shifted = month - 3
    era = (year if shifted >= 0 else year - 399) // 400
    yoe = year - era * 400
    doy = (153 * shifted + 2) // 5 + day - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def market_for_ticker(ticker: str) -> str | None:
    """ca|hk for a supported listing suffix, else None. Scope is decided here, not at the panel."""
    if not isinstance(ticker, str):
        return None
    normalized = ticker.strip().upper()
    for suffix in (".SS", ".SZ", ".BJ", ".TO", ".V", ".HK"):
        if normalized.endswith(suffix):
            return MARKET_SUFFIXES.get(suffix)
    return None


def source_url(ticker: str) -> str:
    """The fixed provider URL for this listing. Never harvested from provider HTML."""
    return f"{SOURCE_URL_PREFIX}{quote(ticker.strip().upper(), safe='')}{SOURCE_URL_SUFFIX}"


# ─────────────────────────────────────────────────────────────────────────────
# canonical form + hashes
# ─────────────────────────────────────────────────────────────────────────────
def canonical_json(value: Any) -> str:
    """Canonical UTF-8 JSON text: recursively sorted keys, no whitespace.

    Mirrors `JSON.stringify` in the Terminal exactly — `separators` strips Python's default spaces
    and `ensure_ascii=False` stops Python from escaping the non-ASCII holder names that JS leaves
    raw. The block holds no JSON numbers at all, so the two runtimes cannot disagree on a number.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_sha256(block: dict) -> str:
    """SHA-256 of the canonical JSON of `block` with `content_sha256` itself excluded."""
    payload = {key: value for key, value in block.items() if key != "content_sha256"}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def _assert_no_numbers(value: Any, path: str = "$") -> None:
    """Fail loudly at build time if a float or int ever enters the hashed block."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, (int, float)):
        raise AssertionError(f"numeric leaf at {path} — the hashed block must hold strings only")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_no_numbers(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key in sorted(value):
            _assert_no_numbers(value[key], f"{path}.{key}")
        return
    raise AssertionError(f"unsupported leaf type {type(value).__name__} at {path}")


def _seal(block: dict) -> dict:
    block.pop("content_sha256", None)
    _assert_no_numbers(block)
    block["content_sha256"] = content_sha256(block)
    return block


def _valid_previous(previous: Any, ticker: str, market: str) -> dict | None:
    """Accept a previous block only if it is still self-consistent for this listing."""
    if not isinstance(previous, dict):
        return None
    if previous.get("schema") != SCHEMA:
        return None
    listing = previous.get("listing")
    if not isinstance(listing, dict):
        return None
    if listing.get("ticker") != ticker or listing.get("market") != market:
        return None
    if not _acquired_at(previous.get("acquired_at")):
        return None
    if not _HEX64_RE.match(str(previous.get("raw_input_sha256", ""))):
        return None
    if not isinstance(previous.get("rows"), list):
        return None
    # The retained block must still seal its own content: a tampered or hand-edited previous block
    # would otherwise be re-published under a fresh status while carrying unverified rows.
    sealed = previous.get("content_sha256")
    if not isinstance(sealed, str) or not _HEX64_RE.match(sealed) or sealed != content_sha256(previous):
        return None
    return previous


def _degraded(
    previous: dict,
    *,
    reason: str,
    latest_attempt_at: str | None,
    market: str,
) -> dict:
    """Retain the earlier qualified block's rows and dates; degrade its status honestly.

    `acquired_at`, `raw_input_sha256` and every `reported_date` are carried over untouched, so the
    screen keeps showing when this was actually acquired. Only the status, the reason and the
    attempt clock move.
    """
    block = {
        "schema": SCHEMA,
        "listing": {"ticker": previous["listing"]["ticker"], "market": market},
        "population": POPULATION,
        "source": dict(previous["source"]),
        "acquired_at": previous["acquired_at"],
        "latest_attempt_at": _acquired_at(latest_attempt_at) or previous.get("latest_attempt_at") or previous["acquired_at"],
        "publication_time": None,
        "percentage_basis": PERCENTAGE_BASIS,
        "availability": PARTIAL,
        "unavailable_reason": reason,
        "normalizer_version": NORMALIZER_VERSION,
        "raw_input_sha256": previous["raw_input_sha256"],
        "rows": [dict(row) for row in previous["rows"]],
    }
    return _seal(block)


def _status_only(market: str, ticker: str, reason: str, availability: str, latest_attempt_at: str | None) -> dict:
    """A block with no rows and an explicit reason. Absence is rendered, never inferred."""
    return _seal(
        {
            "schema": SCHEMA,
            "listing": {"ticker": ticker, "market": market},
            "population": POPULATION,
            "source": {
                "name": SOURCE_NAME,
                "adapter": SOURCE_ADAPTER,
                "field": SOURCE_FIELD,
                "url": source_url(ticker),
            },
            "acquired_at": None,
            "latest_attempt_at": _acquired_at(latest_attempt_at),
            "publication_time": None,
            "percentage_basis": PERCENTAGE_BASIS,
            "availability": availability,
            "unavailable_reason": reason,
            "normalizer_version": NORMALIZER_VERSION,
            "raw_input_sha256": None,
            "rows": [],
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# frame reading
# ─────────────────────────────────────────────────────────────────────────────
def _frame_rows(frame: Any) -> Iterator[dict]:
    """Yield one dict per data row of a `{columns, data}` frame, addressed by column name."""
    if not isinstance(frame, dict):
        return
    columns = frame.get("columns")
    rows = frame.get("data")
    if not isinstance(columns, list) or not isinstance(rows, list):
        return
    names = [name for name in columns if isinstance(name, str)]
    if not names:
        return
    for row in rows:
        if not isinstance(row, list):
            continue
        # Short rows read as unknown cells; extra cells are dropped with their name.
        yield {name: row[index] for index, name in enumerate(names) if index < len(row)}


def _field_error(payload: dict) -> bool:
    """True when the collector recorded a failure for the field this adapter reads.

    `_errors` is written by `collect_us_fund.py` as a LIST of "field:ExceptionType" strings. An
    older/other writer may leave an empty OBJECT instead, so the type is inspected rather than
    assumed — only a genuine mention of our field counts.
    """
    errors = payload.get("_errors")
    if isinstance(errors, str):
        entries: list[Any] = [errors]
    elif isinstance(errors, list):
        entries = list(errors)
    elif isinstance(errors, dict):
        entries = [key for key, value in errors.items() if value not in (None, False, "", [], {})]
    else:
        return False
    return any(
        isinstance(entry, str) and entry.split(":", 1)[0].strip() == SOURCE_FIELD
        for entry in entries
    )


def _raw_bytes(raw: bytes | str | Path) -> bytes | None:
    """Accept the exact raw bytes, or the incumbent cache path to read them from."""
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    if isinstance(raw, Path):
        try:
            return raw.read_bytes()
        except OSError:
            return None
    if isinstance(raw, str):
        try:
            return Path(raw).read_bytes()
        except OSError:
            return None
    return None


# ─────────────────────────────────────────────────────────────────────────────
# entry point
# ─────────────────────────────────────────────────────────────────────────────
def build_reported_ownership(
    raw: bytes | str | Path,
    *,
    expected_ticker: str,
    previous: dict | None = None,
    latest_attempt_at: str | None = None,
) -> dict | None:
    """Normalize one raw collector cache into a `mastermind.reported-ownership/v1` block.

    `raw` is either the exact raw bytes or the path to the incumbent cache file. `expected_ticker`
    scopes the block to one listing: a payload for any other ticker is refused rather than relabeled.
    `previous` is the last qualified block for the same listing; on a fetch or field failure its
    rows and original dates are retained and degraded instead of being dropped. Returns None when
    nothing qualified can be said at all.
    """
    ticker = expected_ticker.strip().upper() if isinstance(expected_ticker, str) else ""
    market = market_for_ticker(ticker)
    retained = _valid_previous(previous, ticker, market) if market else None

    if not market:
        return None  # outside this adapter's scope: no qualified block, no fabricated one

    payload_bytes = _raw_bytes(raw)
    if payload_bytes is None:
        if retained:
            return _degraded(retained, reason=REASON_RAW_UNAVAILABLE, latest_attempt_at=latest_attempt_at, market=market)
        return _status_only(market, ticker, REASON_RAW_UNAVAILABLE, UNAVAILABLE, latest_attempt_at)

    try:
        payload = json.loads(payload_bytes.decode("utf-8"), parse_float=str, parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError):
        if retained:
            return _degraded(retained, reason=REASON_RAW_UNPARSABLE, latest_attempt_at=latest_attempt_at, market=market)
        return _status_only(market, ticker, REASON_RAW_UNPARSABLE, UNAVAILABLE, latest_attempt_at)

    if not isinstance(payload, dict):
        return _status_only(market, ticker, REASON_RAW_UNPARSABLE, UNAVAILABLE, latest_attempt_at)

    raw_ticker = payload.get("ticker")
    if not isinstance(raw_ticker, str) or raw_ticker.strip().upper() != ticker:
        # A payload for another listing is never relabeled as this one, not even to keep a block.
        if retained:
            return _degraded(retained, reason=REASON_TICKER_MISMATCH, latest_attempt_at=latest_attempt_at, market=market)
        return _status_only(market, ticker, REASON_TICKER_MISMATCH, UNAVAILABLE, latest_attempt_at)

    acquired = _acquired_at(payload.get("fetched_at"))
    if acquired is None:
        # No receipt for when this was acquired means no qualified block for its rows.
        if retained:
            return _degraded(retained, reason=REASON_ACQUIRED_AT_MISSING, latest_attempt_at=latest_attempt_at, market=market)
        return _status_only(market, ticker, REASON_ACQUIRED_AT_MISSING, UNAVAILABLE, latest_attempt_at)

    field_failed = _field_error(payload)
    acquired_day = _day_ordinal(acquired[:10])
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    dropped = 0
    dropped_undated = 0

    for entry in _frame_rows(payload.get(SOURCE_FIELD)):
        holder = entry.get(COLUMN_HOLDER)
        holder_name = holder.strip() if isinstance(holder, str) else ""
        if not holder_name:
            dropped += 1
            continue
        reported = _calendar_date(entry.get(COLUMN_REPORTED_DATE))
        if reported is None:
            # An undated holder row cannot be presented next to dated ones without implying a date.
            dropped_undated += 1
            continue
        if _day_ordinal(reported) > acquired_day:
            # A report dated after we acquired it is incoherent; it is not "recent", it is wrong.
            dropped += 1
            continue
        fraction = _plain_decimal(entry.get(COLUMN_FRACTION))
        if fraction is not None and not _fraction_in_unit_interval(fraction):
            fraction = None  # an out-of-unit observation is unknown here, not 0 and not clamped
        row = {
            "holder_name": holder_name,
            "reported_date": reported,
            "shares": _integer_string(entry.get(COLUMN_SHARES)),
            "reported_fraction": fraction,
        }
        key = (row["holder_name"], row["reported_date"])
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)

    if not rows:
        if retained:
            # The newest fetch produced nothing usable; keep the last qualified rows and say so.
            reason = REASON_FETCH_FIELD_ERROR if field_failed else REASON_NO_DATED_ROWS
            return _degraded(retained, reason=reason, latest_attempt_at=acquired, market=market)
        reason = REASON_FETCH_FIELD_ERROR if field_failed else REASON_NO_DATED_ROWS
        return _status_only(
            market, ticker, reason, SOURCE_ERROR if field_failed else UNAVAILABLE, acquired
        )

    if field_failed:
        availability = PARTIAL  # rows survived, but the collector recorded a failure for this field
        reason = REASON_FETCH_FIELD_ERROR
    elif dropped or dropped_undated:
        availability = PARTIAL  # some raw rows did not qualify; say so rather than look complete
        reason = REASON_ROWS_DROPPED
    else:
        availability = AVAILABLE
        reason = None

    block = _seal(
        {
            "schema": SCHEMA,
            "listing": {"ticker": ticker, "market": market},
            "population": POPULATION,
            "source": {
                "name": SOURCE_NAME,
                "adapter": SOURCE_ADAPTER,
                "field": SOURCE_FIELD,
                "url": source_url(ticker),
            },
            "acquired_at": acquired,
            "latest_attempt_at": acquired,
            "publication_time": None,
            "percentage_basis": PERCENTAGE_BASIS,
            "availability": availability,
            "unavailable_reason": reason,
            "normalizer_version": NORMALIZER_VERSION,
            "raw_input_sha256": hashlib.sha256(payload_bytes).hexdigest(),
            "rows": rows,
        }
    )
    return block