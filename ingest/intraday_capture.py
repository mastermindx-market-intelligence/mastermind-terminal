"""Bounded evidence retention for the existing intraday writer.

This is source observation custody, not a file-visibility clock or a revision
selector. The same per-symbol JSON owns the legacy chart projection and captures.
"""
from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import math
import re
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

SCHEMA = "mastermind.intraday_minute_capture.v1"
OBSERVER_ID = "terminal.backfill_intraday"
GENESIS_SHA256 = "0" * 64
AUTHORITY = {"research_admitted": False, "trading_authority": False}
MAX_SYMBOLS = 16
MAX_CAPTURES = 4096
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_CAPTURE_PAGES = 16
MAX_FILE_BYTES = 32 * 1024 * 1024
FINALITY_LAG_S = 900
FAILURE_KINDS = frozenset({
    "transport_exhausted", "http_error", "malformed_response", "invalid_response",
    "malformed_bar", "pagination_incomplete", "source_failure", "clock_invalid",
})
_SHA = re.compile(r"[0-9a-f]{64}")
_SYMBOL = re.compile(r"[A-Z][A-Z0-9.-]{0,14}")
_thread = threading.local()
_mutex_guard = threading.Lock()
_mutexes: dict[str, threading.RLock] = {}


class CaptureError(ValueError):
    """A fixed, credential-free refusal reason."""


class CaptureCapacity(CaptureError):
    """No persistence is permitted after a retention/input capacity refusal."""


def canonical_bytes(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def digest(value) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def integer(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def valid_symbol(symbol) -> bool:
    return isinstance(symbol, str) and bool(_SYMBOL.fullmatch(symbol))


def parse_symbols(raw: str) -> list[str]:
    symbols = raw.split(",")
    if (not 1 <= len(symbols) <= MAX_SYMBOLS
            or any(not valid_symbol(s) for s in symbols)
            or len(set(symbols)) != len(symbols)):
        raise CaptureError("invalid_capture_symbols")
    return symbols


@contextmanager
def store_lock(path: Path):
    """One conventional file lock covers read/fetch/merge/replace; reentrant.

    The lock inode is deliberately never unlinked: unlinking a held lock permits
    another process to lock a different inode and lose a concurrent update.
    """
    key = str(path.resolve())
    with _mutex_guard:
        mutex = _mutexes.setdefault(key, threading.RLock())
    with mutex:
        held = getattr(_thread, "held", None)
        if held is None:
            held = _thread.held = {}
        if key in held:
            yield
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(str(path) + ".lock", "a+b") as stream:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            held[key] = stream
            try:
                yield
            finally:
                held.pop(key, None)
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def read_document(path: Path) -> dict | None:
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_FILE_BYTES + 1)
    except FileNotFoundError:
        return None
    if len(raw) > MAX_FILE_BYTES:
        raise CaptureCapacity("store_bytes_capacity")
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise CaptureError("unreadable_store") from error
    if not isinstance(value, dict) or not isinstance(value.get("bars"), list):
        raise CaptureError("unreadable_store")
    return value


def empty_envelope() -> dict:
    return {"schema": SCHEMA, "observer_id": OBSERVER_ID,
            "authority": dict(AUTHORITY), "captures": [],
            "prefix_sha256": GENESIS_SHA256}


def _keys(value, required, optional=()):
    if (not isinstance(value, dict)
            or not set(required) <= value.keys()
            or not value.keys() <= set(required) | set(optional)):
        raise CaptureError("capture_schema_invalid")


def _nat(value):
    if not integer(value) or value < 0:
        raise CaptureError("capture_integer_invalid")


def _sha(value):
    if not isinstance(value, str) or not _SHA.fullmatch(value):
        raise CaptureError("capture_digest_invalid")


def raw_minute(bar: dict) -> dict:
    """Allowlisted original values. Missing v, null v and 0 remain distinct."""
    if not isinstance(bar, dict):
        raise CaptureError("malformed_bar")
    if (not integer(bar.get("t")) or bar["t"] < 0 or bar["t"] % 60000):
        raise CaptureError("malformed_bar")
    for field in ("o", "h", "l", "c"):
        value = bar.get(field)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or value <= 0):
            raise CaptureError("malformed_bar")
    if not bar["l"] <= min(bar["o"], bar["c"]) <= max(bar["o"], bar["c"]) <= bar["h"]:
        raise CaptureError("malformed_bar")
    if "v" in bar and bar["v"] is not None:
        value = bar["v"]
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or value < 0):
            raise CaptureError("malformed_bar")
    return {key: bar[key] for key in ("t", "o", "h", "l", "c", "v") if key in bar}


def validate_payload(payload: dict, symbol: str) -> None:
    _keys(payload, ("symbol", "timeframe", "source", "status", "failure_kind",
                    "started_at_utc_ns", "completed_at_utc_ns",
                    "finality_reference_utc_ns", "finality_lag_s",
                    "request", "pages", "observations", "counts"))
    if (payload["symbol"] != symbol or not valid_symbol(symbol)
            or payload["timeframe"] != "1m" or payload["source"] != "polygon"
            or payload["status"] not in ("complete", "partial", "failed")
            or payload["finality_lag_s"] != FINALITY_LAG_S
            or isinstance(payload["finality_lag_s"], bool)):
        raise CaptureError("capture_identity_invalid")
    status, failure = payload["status"], payload["failure_kind"]
    if ((status == "complete" and failure is not None)
            or (status != "complete" and failure not in FAILURE_KINDS)):
        raise CaptureError("capture_status_invalid")
    for field in ("started_at_utc_ns", "completed_at_utc_ns", "finality_reference_utc_ns"):
        _nat(payload[field])
    start, end = payload["started_at_utc_ns"], payload["completed_at_utc_ns"]
    if start > end or payload["finality_reference_utc_ns"] > end:
        raise CaptureError("clock_invalid")
    request = payload["request"]
    _keys(request, ("multiplier", "timespan", "from_date", "to_date", "adjusted", "sort", "limit"))
    from datetime import date
    try:
        dates = [date.fromisoformat(request[k]) for k in ("from_date", "to_date")]
    except (ValueError, TypeError):
        raise CaptureError("capture_request_invalid") from None
    if (request["multiplier"] != 1 or isinstance(request["multiplier"], bool)
            or request["timespan"] != "minute" or request["adjusted"] is not True
            or request["sort"] != "asc" or request["limit"] != 50000
            or isinstance(request["limit"], bool) or dates[0] > dates[1]
            or dates[0].isoformat() != request["from_date"]
            or dates[1].isoformat() != request["to_date"]):
        raise CaptureError("capture_request_invalid")
    pages, observations, counts = payload["pages"], payload["observations"], payload["counts"]
    if not isinstance(pages, list) or not isinstance(observations, list):
        raise CaptureError("capture_schema_invalid")
    if len(pages) > MAX_CAPTURE_PAGES:
        raise CaptureCapacity("capture_pages_capacity")
    _keys(counts, ("rows_received", "finalized_rows", "forming_skipped",
                   "unchanged_suppressed", "observations_retained"))
    for value in counts.values():
        _nat(value)
    totals = {"rows_received": 0, "finalized_rows": 0, "forming_skipped": 0}
    for index, page in enumerate(pages):
        _keys(page, ("page_index", "request_started_at_utc_ns", "response_received_at_utc_ns",
                     "response_sha256", "response_bytes", "status", "rows_received",
                     "finalized_rows", "forming_skipped"))
        for field in ("page_index", "request_started_at_utc_ns", "response_received_at_utc_ns",
                      "response_bytes", "rows_received", "finalized_rows", "forming_skipped"):
            _nat(page[field])
        _sha(page["response_sha256"])
        if page["response_bytes"] > MAX_RESPONSE_BYTES:
            raise CaptureCapacity("response_bytes_capacity")
        if (page["page_index"] != index
                or not start <= page["request_started_at_utc_ns"] <= page["response_received_at_utc_ns"] <= end
                or page["status"] not in ("OK", "DELAYED", "INVALID")
                or page["finalized_rows"] + page["forming_skipped"] > page["rows_received"]
                or (status == "complete" and page["status"] == "INVALID")):
            raise CaptureError("capture_page_invalid")
        for key in totals:
            totals[key] += page[key]
    if status == "complete" and not pages:
        raise CaptureError("capture_page_missing")
    if any(counts[key] != total for key, total in totals.items()):
        raise CaptureError("capture_counts_invalid")
    if (counts["observations_retained"] != len(observations)
            or counts["observations_retained"] + counts["unchanged_suppressed"] != counts["finalized_rows"]
            or (status != "complete" and counts["unchanged_suppressed"] != 0)):
        raise CaptureError("capture_counts_invalid")
    locations = set()
    cutoff = payload["finality_reference_utc_ns"] - FINALITY_LAG_S * 1_000_000_000
    for observation in observations:
        _keys(observation, ("page_index", "row_index", "event_start_utc_ms",
                            "event_end_utc_ms", "raw"))
        for field in ("page_index", "row_index", "event_start_utc_ms", "event_end_utc_ms"):
            _nat(observation[field])
        pi, ri = observation["page_index"], observation["row_index"]
        if pi >= len(pages) or ri >= pages[pi]["rows_received"] or (pi, ri) in locations:
            raise CaptureError("capture_location_invalid")
        locations.add((pi, ri))
        raw = observation["raw"]
        _keys(raw, ("t", "o", "h", "l", "c"), ("v",))
        raw_minute(raw)
        if (observation["event_start_utc_ms"] != raw["t"]
                or observation["event_end_utc_ms"] != raw["t"] + 60000
                or observation["event_end_utc_ms"] * 1_000_000 > cutoff
                or observation["event_end_utc_ms"] * 1_000_000 > pages[pi]["response_received_at_utc_ns"]):
            raise CaptureError("capture_finality_invalid")


def validate_envelope(envelope: dict, symbol: str) -> dict:
    _keys(envelope, ("schema", "observer_id", "authority", "captures", "prefix_sha256"))
    if (envelope["schema"] != SCHEMA or envelope["observer_id"] != OBSERVER_ID
            or envelope["authority"] != AUTHORITY):
        raise CaptureError("capture_envelope_invalid")
    _keys(envelope["authority"], AUTHORITY)
    if any(value is not False for value in envelope["authority"].values()):
        raise CaptureError("capture_authority_invalid")
    records = envelope["captures"]
    if not isinstance(records, list):
        raise CaptureError("capture_envelope_invalid")
    if len(records) > MAX_CAPTURES:
        raise CaptureCapacity("capture_count_capacity")
    previous, ids = GENESIS_SHA256, set()
    for sequence, record in enumerate(records, 1):
        _keys(record, ("sequence", "capture_id", "previous_capture_sha256",
                       "payload_sha256", "payload", "capture_sha256"))
        cid = record["capture_id"]
        if (not integer(record["sequence"]) or record["sequence"] != sequence
                or not isinstance(cid, str) or not re.fullmatch(r"[0-9a-f]{32}", cid)
                or cid in ids or record["previous_capture_sha256"] != previous):
            raise CaptureError("capture_sequence_invalid")
        ids.add(cid)
        validate_payload(record["payload"], symbol)
        if digest(record["payload"]) != record["payload_sha256"]:
            raise CaptureError("capture_payload_seal_invalid")
        sealed = {key: value for key, value in record.items() if key != "capture_sha256"}
        if digest(sealed) != record["capture_sha256"]:
            raise CaptureError("capture_prefix_seal_invalid")
        previous = record["capture_sha256"]
    if envelope["prefix_sha256"] != previous:
        raise CaptureError("capture_prefix_seal_invalid")
    return envelope


def append_capture(envelope: dict, payload: dict, capture_id: str) -> dict:
    """Append one already-compacted payload; exact-ID replay is idempotent."""
    validate_envelope(envelope, payload["symbol"])
    validate_payload(payload, payload["symbol"])
    for record in envelope["captures"]:
        if record["capture_id"] == capture_id:
            if record["payload"] == payload and record["payload_sha256"] == digest(payload):
                return copy.deepcopy(envelope)
            raise CaptureError("capture_id_conflict")
    if len(envelope["captures"]) >= MAX_CAPTURES:
        raise CaptureCapacity("capture_count_capacity")
    record = {"sequence": len(envelope["captures"]) + 1, "capture_id": capture_id,
              "previous_capture_sha256": envelope["prefix_sha256"],
              "payload_sha256": digest(payload), "payload": copy.deepcopy(payload)}
    record["capture_sha256"] = digest(record)
    result = copy.deepcopy(envelope)
    result["captures"].append(record)
    result["prefix_sha256"] = record["capture_sha256"]
    validate_envelope(result, payload["symbol"])
    return result


def append_sealed_capture(envelope: dict, record: dict) -> dict:
    """Replay accepts the exact immutable seal, never an un-compacted attempt."""
    symbol = record["payload"]["symbol"]
    validate_envelope(envelope, symbol)
    for previous in envelope["captures"]:
        if previous["capture_id"] == record["capture_id"]:
            if canonical_bytes(previous) == canonical_bytes(record):
                return copy.deepcopy(envelope)
            raise CaptureError("capture_id_conflict")
    if len(envelope["captures"]) >= MAX_CAPTURES:
        raise CaptureCapacity("capture_count_capacity")
    result = copy.deepcopy(envelope)
    result["captures"].append(copy.deepcopy(record))
    result["prefix_sha256"] = record["capture_sha256"]
    validate_envelope(result, symbol)
    return result


def compact_complete(envelope: dict, payload: dict) -> dict:
    """Only consecutive equal *complete* observations are suppressed."""
    result = copy.deepcopy(payload)
    if result["status"] != "complete":
        return result
    latest = {}
    for record in envelope["captures"]:
        if record["payload"]["status"] == "complete":
            for observation in record["payload"]["observations"]:
                latest[observation["event_start_utc_ms"]] = canonical_bytes(observation["raw"])
    retained = []
    for observation in result["observations"]:
        key, raw = observation["event_start_utc_ms"], canonical_bytes(observation["raw"])
        if latest.get(key) == raw:
            result["counts"]["unchanged_suppressed"] += 1
        else:
            retained.append(observation)
            latest[key] = raw
    result["observations"] = retained
    result["counts"]["observations_retained"] = len(retained)
    return result


class CaptureAttempt:
    def __init__(self, symbol: str, request: dict, finality_reference_utc_ns: int,
                 *, clock=time.time_ns, capture_id: str | None = None):
        self.clock = clock
        self.capture_id = capture_id or uuid.uuid4().hex
        self.sealed_record = None
        self.source_payload_sha256 = None
        self.data = {"symbol": symbol, "timeframe": "1m", "source": "polygon",
                     "status": "failed", "failure_kind": "source_failure",
                     "started_at_utc_ns": clock(), "completed_at_utc_ns": None,
                     "finality_reference_utc_ns": finality_reference_utc_ns,
                     "finality_lag_s": FINALITY_LAG_S, "request": dict(request),
                     "pages": [], "observations": [],
                     "counts": {"rows_received": 0, "finalized_rows": 0, "forming_skipped": 0,
                                "unchanged_suppressed": 0, "observations_retained": 0}}

    def received(self, raw: bytes, requested_ns: int, received_ns: int) -> dict:
        if len(raw) > MAX_RESPONSE_BYTES:
            raise CaptureCapacity("response_bytes_capacity")
        pages = self.data["pages"]
        if len(pages) >= MAX_CAPTURE_PAGES:
            raise CaptureCapacity("capture_pages_capacity")
        page = {"page_index": len(pages), "request_started_at_utc_ns": requested_ns,
                "response_received_at_utc_ns": received_ns,
                "response_sha256": hashlib.sha256(raw).hexdigest(), "response_bytes": len(raw),
                "status": "INVALID", "rows_received": 0, "finalized_rows": 0, "forming_skipped": 0}
        pages.append(page)
        return page

    def finish(self, failure_kind: str | None = None) -> dict:
        self.data["completed_at_utc_ns"] = self.clock()
        self.data["status"] = ("complete" if failure_kind is None else
                               "partial" if self.data["pages"] else "failed")
        self.data["failure_kind"] = failure_kind
        for field in ("rows_received", "finalized_rows", "forming_skipped"):
            self.data["counts"][field] = sum(page[field] for page in self.data["pages"])
        self.data["counts"]["observations_retained"] = len(self.data["observations"])
        return copy.deepcopy(self.data)


class CaptureSession:
    """Pending additions inside the existing writer's per-file critical section."""
    def __init__(self, symbol: str, envelope: dict | None):
        self.symbol = symbol
        self.envelope = copy.deepcopy(empty_envelope() if envelope is None else envelope)
        validate_envelope(self.envelope, symbol)
        self.blocked = False
        self.persistence_failed = False
        self.attempts = 0

    def retain(self, attempt: CaptureAttempt, failure_kind: str | None = None):
        if attempt.sealed_record is not None:
            if (digest(attempt.data) != attempt.source_payload_sha256
                    or failure_kind != attempt.data["failure_kind"]):
                raise CaptureError("capture_id_conflict")
            self.envelope = append_sealed_capture(self.envelope, attempt.sealed_record)
            return
        original = attempt.finish(failure_kind)
        payload = compact_complete(self.envelope, original)
        try:
            self.envelope = append_capture(self.envelope, payload, attempt.capture_id)
        except CaptureCapacity:
            self.blocked = True
            raise
        attempt.source_payload_sha256 = digest(original)
        attempt.sealed_record = copy.deepcopy(self.envelope["captures"][-1])
        self.attempts += 1
