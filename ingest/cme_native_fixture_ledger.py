"""Pure, bounded, SYNTHETIC-ONLY decoded CME Trade Summary accounting.

This is not a DBN, SBE, PCAP, historical-market-data, or live-feed decoder.
No IO, clocks, callbacks, imports of market clients, or mutation on evaluation.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re

SCHEMA = "CME_DECODED_TRADE_SUMMARY_FIXTURE_V1"
UINT32_MAX = (1 << 32) - 1
UINT64_MAX = (1 << 64) - 1
INT64_MAX = (1 << 63) - 1
MAX_INPUT_BYTES = 4 * 1024 * 1024
MAX_SERIALIZED_BYTES = 8 * 1024 * 1024
STRING_CHUNK_CHARS = 256
MAX_RECORDS = 4096
MAX_IDENTITIES = 4096
SIDES = ("BUY", "SELL", "NO_AGGRESSOR")
AGGRESSOR = {0: "NO_AGGRESSOR", 1: "BUY", 2: "SELL"}
ENVELOPE_KEYS = frozenset((
    "schema", "fixture", "sourceKind", "fixtureId", "quantityUnit",
    "priceScale", "namespace", "records",
))
NAMESPACE_KEYS = frozenset(("channelId", "sessionId", "instrumentId", "rawSymbol"))
SOURCE_KEYS = frozenset(("artifactId", "ordinal", "byteOffset"))
RECORD_KEYS = frozenset((
    "source", "namespace", "action", "mdTradeEntryId", "price", "quantity",
    "aggressorSide", "eventTimeNs", "messageTimeNs", "availableTimeNs",
    "sequence", "rptSeq", "eventComplete",
))
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,95}\Z")
SYMBOL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:+!/-]{0,31}\Z")


class InputRefused(ValueError):
    """A document, query or bounded serialization cannot be safely admitted."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _integer(value: object, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def _token(value: object) -> bool:
    return type(value) is str and TOKEN.fullmatch(value) is not None


class _ParserDuplicate(dict):
    """Parser-only provenance; a caller's similarly shaped JSON is plain dict."""

    __slots__ = ()


def _canonical(value: object, *, max_bytes: int = MAX_SERIALIZED_BYTES) -> bytes:
    """Canonical JSON with budget checks before every bounded append.

    Whole strings are never handed to an unbounded encoder: each escaped string
    chunk contains at most STRING_CHUNK_CHARS input characters. Duplicate-object
    evidence is a tree, with each original value represented exactly once.
    """
    if not _integer(max_bytes, 0, MAX_SERIALIZED_BYTES):
        raise InputRefused("INVALID_SERIALIZATION_LIMIT")
    out = bytearray()

    def append(text: str) -> None:
        if len(text) > max_bytes - len(out):
            raise InputRefused("SERIALIZED_BYTE_CAP")
        out.extend(text.encode("ascii"))

    def string(text: str) -> None:
        append('"')
        for start in range(0, len(text), STRING_CHUNK_CHARS):
            escaped = json.dumps(text[start:start + STRING_CHUNK_CHARS],
                                 ensure_ascii=True, allow_nan=False)
            append(escaped[1:-1])
        append('"')

    def write(item: object) -> None:
        kind = type(item)
        if item is None:
            append("null")
        elif kind is bool:
            append("true" if item else "false")
        elif kind is int:
            append(str(item))
        elif kind is str:
            string(item)
        elif kind in (list, tuple):
            append("[")
            for index, member in enumerate(item):
                if index:
                    append(",")
                write(member)
            append("]")
        elif kind in (dict, _ParserDuplicate):
            if any(type(key) is not str for key in item):
                raise InputRefused("NON_JSON_VALUE")
            append("{")
            for index, key in enumerate(sorted(item)):
                if index:
                    append(",")
                string(key)
                append(":")
                write(item[key])
            append("}")
        else:
            raise InputRefused("NON_JSON_VALUE")

    write(value)
    return bytes(out)


def _unadmitted_number(value: str) -> dict:
    # Preserve the invalid lexeme without a Python float or eager future failure.
    return {"__unadmitted_json_number__": value}


def _object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    duplicates = set()
    for key, value in pairs:
        if key in result:
            duplicates.add(key)
        result[key] = value
    if duplicates:
        # Retain ONLY the original pairs. Keeping selected values beside these
        # pairs would duplicate nested subtrees exponentially during encoding.
        return _ParserDuplicate({"__duplicate_json_fields__": {
            "keys": sorted(duplicates), "pairs": pairs,
        }})
    return result


def _field(record: object, key: str, *, parser_origin: bool = False) -> object:
    """Read actual raw fields, never authenticate a caller-shaped marker.

    The private parser type is used before storage. After storage, only the
    immutable per-row provenance bit may authenticate original-pair evidence.
    """
    if type(record) not in (dict, _ParserDuplicate):
        return None
    if type(record) is not _ParserDuplicate and not parser_origin:
        return record.get(key)
    if set(record) != {"__duplicate_json_fields__"}:
        return None
    duplicate = record["__duplicate_json_fields__"]
    pairs = duplicate.get("pairs") if type(duplicate) is dict else None
    if type(pairs) is not list:
        return None
    found = []
    for pair in pairs:
        if type(pair) in (list, tuple) and len(pair) == 2 and pair[0] == key:
            found.append(pair[1])
            if len(found) > 1:
                return None
    return found[0] if found else None


def _clock(record: object, key: str, *, parser_origin: bool = False) -> int | None:
    value = _field(record, key, parser_origin=parser_origin)
    return value if _integer(value, 0, UINT64_MAX - 1) else None


def _namespace(value: object) -> bool:
    return (
        type(value) is dict and set(value) == NAMESPACE_KEYS
        and _integer(value["channelId"], 1, 65535)
        and _token(value["sessionId"])
        and _integer(value["instrumentId"], 1, UINT32_MAX - 1)
        and type(value["rawSymbol"]) is str
        and SYMBOL.fullmatch(value["rawSymbol"]) is not None
    )


def _source(value: object) -> bool:
    return (
        type(value) is dict and set(value) == SOURCE_KEYS
        and _token(value["artifactId"])
        and _integer(value["ordinal"], 0, UINT64_MAX - 1)
        and _integer(value["byteOffset"], 0, UINT64_MAX - 1)
    )


def _source_key(value: dict) -> tuple:
    return value["artifactId"], value["ordinal"], value["byteOffset"]


def _source_id(value: dict) -> str:
    return "fixture-report:" + hashlib.sha256(_canonical(value)).hexdigest()


@dataclass(frozen=True, slots=True)
class Limits:
    """Limits may be lowered, never increased past the hard ceilings."""

    max_input_bytes: int = MAX_INPUT_BYTES
    max_serialized_bytes: int = MAX_SERIALIZED_BYTES
    max_records: int = MAX_RECORDS
    max_identities: int = MAX_IDENTITIES
    max_total_quantity: int = INT64_MAX

    def __post_init__(self) -> None:
        for name, ceiling in (
            ("max_input_bytes", MAX_INPUT_BYTES),
            ("max_serialized_bytes", MAX_SERIALIZED_BYTES),
            ("max_records", MAX_RECORDS),
            ("max_identities", MAX_IDENTITIES),
            ("max_total_quantity", INT64_MAX),
        ):
            if not _integer(getattr(self, name), 1, ceiling):
                raise InputRefused("INVALID_LIMITS")


@dataclass(frozen=True, slots=True)
class _Row:
    encoded: bytes
    message_ns: int | None
    available_ns: int | None
    parser_duplicate: bool


@dataclass(frozen=True, slots=True, init=False)
class FixtureLedger:
    """Immutable source order; every snapshot is independently reconstructed.

    Per-record body/clock/identity failures are scoped to the reached prefix.
    JSON syntax, fixture-envelope and whole-input resource refusal are separate.
    A reached unclocked row cannot be assumed future; a trustworthy earlier
    cutoff boundary prevents inspecting that row at all.
    """

    _metadata: bytes
    _rows: tuple[_Row, ...]
    _limits: Limits

    def __init__(self, *args, **kwargs):
        raise TypeError("construct with FixtureLedger.from_bytes")

    @classmethod
    def from_bytes(cls, payload: bytes, *, limits: Limits | None = None) -> FixtureLedger:
        limits = Limits() if limits is None else limits
        if type(limits) is not Limits:
            raise InputRefused("INVALID_LIMITS")
        if type(payload) is not bytes:
            raise InputRefused("BYTES_REQUIRED")
        if len(payload) > limits.max_input_bytes:
            raise InputRefused("INPUT_BYTE_CAP")
        try:
            value = json.loads(
                payload, parse_float=_unadmitted_number,
                parse_constant=_unadmitted_number, object_pairs_hook=_object,
            )
        except InputRefused:
            raise
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise InputRefused("INVALID_JSON") from exc
        if type(value) is not dict or set(value) != ENVELOPE_KEYS:
            raise InputRefused("INVALID_FIXTURE_ENVELOPE")
        if (value["schema"] != SCHEMA or value["fixture"] is not True
                or value["sourceKind"] != "SYNTHETIC"
                or value["quantityUnit"] != "contracts"):
            raise InputRefused("SYNTHETIC_ONLY")
        if not _token(value["fixtureId"]) or not _namespace(value["namespace"]):
            raise InputRefused("INVALID_FIXTURE_BINDING")
        if (type(value["priceScale"]) is not int
                or value["priceScale"] not in (1, 10, 100, 1000, 10000, 100000,
                                                1000000, 10000000, 100000000, 1000000000)):
            raise InputRefused("INVALID_PRICE_SCALE")
        records = value["records"]
        if type(records) is not list:
            raise InputRefused("INVALID_RECORD_LIST")
        if len(records) > limits.max_records:
            raise InputRefused("RECORD_CAP")
        rows = []
        try:
            metadata = {key: item for key, item in value.items() if key != "records"}
            encoded_metadata = _canonical(metadata, max_bytes=limits.max_serialized_bytes)
            remaining = limits.max_serialized_bytes - len(encoded_metadata)
            for record in records:
                encoded_record = _canonical(record, max_bytes=remaining)
                remaining -= len(encoded_record)
                rows.append(_Row(encoded_record,
                                 _clock(record, "messageTimeNs"),
                                 _clock(record, "availableTimeNs"),
                                 type(record) is _ParserDuplicate))
            obj = object.__new__(cls)
            object.__setattr__(obj, "_metadata", encoded_metadata)
            object.__setattr__(obj, "_rows", tuple(rows))
            object.__setattr__(obj, "_limits", limits)
            return obj
        except InputRefused:
            raise
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise InputRefused("UNREPRESENTABLE_JSON") from exc

    def snapshot_bytes(self, *, message_cutoff_ns: int, knowledge_cutoff_ns: int) -> bytes:
        return _canonical(self.snapshot(message_cutoff_ns=message_cutoff_ns,
                                        knowledge_cutoff_ns=knowledge_cutoff_ns))

    def snapshot(self, *, message_cutoff_ns: int, knowledge_cutoff_ns: int) -> dict:
        """Inclusive cutoffs over the observed source prefix, not a watermark.

        Stop before the first message beyond either cutoff. Never skip an
        unavailable prefix member to select a convenient later record.
        """
        if not (_integer(message_cutoff_ns, 0, UINT64_MAX - 1)
                and _integer(knowledge_cutoff_ns, 0, UINT64_MAX - 1)):
            raise InputRefused("INVALID_QUERY_CUTOFF")
        metadata = json.loads(self._metadata)
        seen = {}
        ordinal_positions = {}
        byte_positions = {}
        last_positions = {}
        groups = {}
        active = {}
        cancelled = []
        originals = []
        history = []
        issues = []
        gross = 0
        cancelled_quantity = 0
        previous_message = None
        previous_available = None
        refused = False

        for input_position, row in enumerate(self._rows):
            if ((row.message_ns is not None and row.message_ns > message_cutoff_ns)
                    or (row.available_ns is not None
                        and row.available_ns > knowledge_cutoff_ns)):
                break
            record = json.loads(row.encoded)
            source = _field(record, "source", parser_origin=row.parser_duplicate)
            source_valid = _source(source)
            report_id = _source_id(source) if source_valid else None
            errors = []
            if source_valid:
                key = _source_key(source)
                prior = seen.get(key)
                if prior == row.encoded:
                    continue  # Exact physical replay changes no query bytes.
                if prior is not None:
                    errors.append("CONFLICTING_PHYSICAL_REPORT")
                elif len(seen) >= self._limits.max_identities:
                    errors.append("IDENTITY_CAP")
                else:
                    seen[key] = row.encoded
                    ordinal_key = (source["artifactId"], source["ordinal"])
                    byte_key = (source["artifactId"], source["byteOffset"])
                    if (ordinal_key in ordinal_positions or byte_key in byte_positions):
                        errors.append("CONFLICTING_PHYSICAL_POSITION")
                    ordinal_positions[ordinal_key] = key
                    byte_positions[byte_key] = key
                    previous = last_positions.get(source["artifactId"])
                    if previous is not None and (
                        source["ordinal"] <= previous[0] or source["byteOffset"] <= previous[1]
                    ):
                        errors.append("PHYSICAL_POSITION_REGRESSION")
                    last_positions[source["artifactId"]] = (
                        source["ordinal"], source["byteOffset"],
                    )
            errors.extend(_record_errors(record, metadata["namespace"],
                                         parser_origin=row.parser_duplicate))
            if row.message_ns is None or row.available_ns is None:
                errors.append("UNSCOPED_RECORD_CLOCK")
            if row.message_ns is not None:
                if previous_message is not None and row.message_ns < previous_message:
                    errors.append("MESSAGE_TIME_REGRESSION")
                previous_message = row.message_ns
            if row.available_ns is not None:
                if previous_available is not None and row.available_ns < previous_available:
                    errors.append("KNOWLEDGE_TIME_REGRESSION")
                previous_available = row.available_ns
            entry = {"sourceReportId": report_id, "record": record}
            if report_id is None:
                entry["inputPosition"] = input_position
            if errors:
                entry["outcome"] = "REFUSED"
                entry["reasonCodes"] = list(dict.fromkeys(errors))
                issues.append({"sourceReportId": report_id,
                               "reasonCodes": entry["reasonCodes"][:]})
                refused = True
            elif refused:
                entry["outcome"] = "NOT_APPLIED_AFTER_REFUSAL"
            else:
                action = record["action"]
                group_id = record["mdTradeEntryId"]
                if action == "NEW":
                    if gross > self._limits.max_total_quantity - record["quantity"]:
                        errors = ["TOTAL_QUANTITY_CAP"]
                    else:
                        observation = {
                            "sourceReportId": report_id,
                            "originalSource": source.copy(),
                            "namespace": record["namespace"].copy(),
                            "mdTradeEntryId": group_id,
                            "originalPrice": record["price"],
                            "price": record["price"],
                            "priceScale": metadata["priceScale"],
                            "quantity": record["quantity"],
                            "aggressor": AGGRESSOR[record["aggressorSide"]],
                            "originalRawAggressorSide": record["aggressorSide"],
                            "originalEventTimeNs": record["eventTimeNs"],
                            "originalMessageTimeNs": row.message_ns,
                            "originalAvailableTimeNs": row.available_ns,
                            "priceKnownAtNs": row.available_ns,
                            "latestMessageTimeNs": row.message_ns,
                            "versionSourceReportIds": [report_id],
                        }
                        active[report_id] = observation
                        groups.setdefault(group_id, set()).add(report_id)
                        originals.append((record["quantity"], AGGRESSOR[record["aggressorSide"]]))
                        gross += record["quantity"]
                        entry["outcome"] = "APPLIED_NEW"
                else:
                    candidates = groups.get(group_id, set())
                    if not candidates:
                        errors = ["NO_ACTIVE_TARGET"]
                    elif len(candidates) != 1:
                        errors = ["AMBIGUOUS_NATIVE_TRADE_ID"]
                    else:
                        target_id = next(iter(candidates))
                        target = active[target_id]
                        entry["targetSourceReportId"] = target_id
                        if record["quantity"] != target["quantity"]:
                            errors = ["CORRECTION_QUANTITY_MISMATCH"]
                        elif action == "DELETE" and record["price"] != target["price"]:
                            errors = ["DELETE_PRICE_MISMATCH"]
                        elif action == "CHANGE":
                            target["price"] = record["price"]
                            target["priceKnownAtNs"] = row.available_ns
                            target["latestMessageTimeNs"] = row.message_ns
                            target["versionSourceReportIds"].append(report_id)
                            entry["outcome"] = "APPLIED_PRICE_CHANGE"
                        else:
                            del active[target_id]
                            groups[group_id].remove(target_id)
                            target["cancelSourceReportId"] = report_id
                            target["cancelMessageTimeNs"] = row.message_ns
                            target["cancelAvailableTimeNs"] = row.available_ns
                            target["versionSourceReportIds"].append(report_id)
                            cancelled.append(target)
                            cancelled_quantity += target["quantity"]
                            entry["outcome"] = "APPLIED_DELETE"
                if errors:
                    entry["outcome"] = "REFUSED"
                    entry["reasonCodes"] = errors
                    issues.append({"sourceReportId": report_id, "reasonCodes": errors[:]})
                    refused = True
            history.append(entry)

        active_quantity = sum(item["quantity"] for item in active.values())
        if not refused and gross != active_quantity + cancelled_quantity:
            raise AssertionError("internal conservation failure")
        totals = None
        if not refused:
            totals = {
                "quantityUnit": "contracts",
                "grossReportedQuantity": gross,
                "activeQuantity": active_quantity,
                "cancelledQuantity": cancelled_quantity,
                "newObservationCount": len(originals),
                "activeObservationCount": len(active),
                "cancelledObservationCount": len(cancelled),
                "distinctNativeOrderCount": None,
                "grossByAggressor": _partition(originals),
                "activeByAggressor": _partition(
                    (item["quantity"], item["aggressor"]) for item in active.values()),
                "cancelledByAggressor": _partition(
                    (item["quantity"], item["aggressor"]) for item in cancelled),
            }
        return {
            "schema": "CME_SYNTHETIC_LEDGER_SNAPSHOT_V1",
            "fixtureId": metadata["fixtureId"],
            "fixtureOnly": True,
            "publicConsumerEligible": False,
            "sourceKind": "SYNTHETIC",
            "scope": "SOURCE_SAMPLE_ARITHMETIC",
            "qualifiedFixtureSample": not refused,
            "completeCmeVolume": False,
            "nativeDecoderProven": False,
            "atomicCmeEventProven": False,
            "namespace": metadata["namespace"],
            "priceScale": metadata["priceScale"],
            "cutoffs": {"messageTimeNs": message_cutoff_ns,
                        "knowledgeTimeNs": knowledge_cutoff_ns},
            "totals": totals,
            "activeSourceObservations": list(active.values()) if not refused else [],
            "cancelledSourceObservations": cancelled if not refused else [],
            "history": history,
            "quality": {"status": "REFUSED" if refused else "FIXTURE_SAMPLE_VALID",
                        "issues": issues},
        }


def _partition(observations) -> dict:
    result = {side: 0 for side in SIDES}
    for quantity, side in observations:
        result[side] += quantity
    return result


def _record_errors(record: object, expected_namespace: dict, *,
                   parser_origin: bool = False) -> list[str]:
    if type(record) is not dict:
        return ["INVALID_RECORD_OBJECT"]
    errors = []
    if set(record) != RECORD_KEYS:
        errors.append("INVALID_RECORD_FIELDS")
    if not _source(_field(record, "source", parser_origin=parser_origin)):
        errors.append("INVALID_PHYSICAL_SOURCE")
    if not _namespace(_field(record, "namespace", parser_origin=parser_origin)) or _field(record, "namespace", parser_origin=parser_origin) != expected_namespace:
        errors.append("NAMESPACE_MISMATCH")
    if _field(record, "action", parser_origin=parser_origin) not in ("NEW", "CHANGE", "DELETE"):
        errors.append("UNSUPPORTED_ACTION")
    if not _integer(_field(record, "mdTradeEntryId", parser_origin=parser_origin), 1, UINT32_MAX):
        errors.append("INVALID_NATIVE_TRADE_ID")
    if not _integer(_field(record, "price", parser_origin=parser_origin), -(1 << 63), INT64_MAX - 1):
        errors.append("INVALID_PRICE")
    if not _integer(_field(record, "quantity", parser_origin=parser_origin), 1, UINT32_MAX - 1):
        errors.append("INVALID_QUANTITY")
    if not _integer(_field(record, "aggressorSide", parser_origin=parser_origin), 0, 2):
        errors.append("INVALID_AGGRESSOR")
    if _field(record, "action", parser_origin=parser_origin) in ("CHANGE", "DELETE") and _field(record, "aggressorSide", parser_origin=parser_origin) != 0:
        errors.append("UNSUPPORTED_CORRECTION_AGGRESSOR")
    if not _integer(_field(record, "eventTimeNs", parser_origin=parser_origin), 0, UINT64_MAX - 1):
        errors.append("INVALID_EVENT_TIME")
    else:
        message = _clock(record, "messageTimeNs", parser_origin=parser_origin)
        available = _clock(record, "availableTimeNs", parser_origin=parser_origin)
        if message is not None and available is not None and not (
            _field(record, "eventTimeNs", parser_origin=parser_origin) <= message <= available
        ):
            errors.append("INVALID_CLOCK_CHAIN")
    if _field(record, "eventComplete", parser_origin=parser_origin) is not True:
        errors.append("TRUNCATED_OR_UNPROVEN_EVENT")
    if not _integer(_field(record, "sequence", parser_origin=parser_origin), 0, UINT32_MAX):
        errors.append("INVALID_SOURCE_SEQUENCE")
    if not _integer(_field(record, "rptSeq", parser_origin=parser_origin), 0, UINT32_MAX):
        errors.append("INVALID_RPT_SEQUENCE")
    return errors
