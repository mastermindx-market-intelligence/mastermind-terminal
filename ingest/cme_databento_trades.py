"""Private, pure DBN TradeMsg observation normalizer.

No I/O, vendor SDK, archive reader, public envelope, or correction authority.
All provenance and clocks are caller declarations (synthetic in fixture mode).
See docs/CME_LARGE_TRADES_ADMISSION.md for the explicit admission limits.
"""
from __future__ import annotations

from dataclasses import dataclass, fields, replace
from datetime import date, timedelta
import hashlib
import re
import struct

SOURCE_COMMIT = "d368005a636bae84bff443cd6ddae6430a0ffd00"
SDK_VERSION = "0.71.0"
DBN_VERSION = 3
SOURCE_RECORD_TYPE = "DATABENTO_GLBX_TRADES_MBP0"
PRICE_SCALE = 1_000_000_000
MNQ_TICK = 250_000_000
MNQ_MULTIPLIER = 2_000_000_000
MAX_SAFE_INTEGER = (1 << 53) - 1
UNDEF_PRICE = (1 << 63) - 1
UNDEF_SIZE = (1 << 32) - 1
UNDEF_TIMESTAMP = (1 << 64) - 1
DELTA_MIN, DELTA_MAX = -(1 << 31), (1 << 31) - 1
NS_DAY = 86_400_000_000_000
EPOCH = date(1970, 1, 1)
TRADE_STRUCT = struct.Struct("<BBHIQqIccBBQiI")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class NormalizationError(ValueError):
    """Explicit refusal, not necessarily corruption of a native record."""
    def __init__(self, code: str, category: str = "contract"):
        self.code = code
        self.category = category
        super().__init__(code)


def _require(condition: bool, code: str, category: str = "contract") -> None:
    if not condition:
        raise NormalizationError(code, category)


def _int(value: object, low: int, high: int, name: str) -> None:
    _require(type(value) is int and low <= value <= high, "invalid_" + name)


def _ns(value: object, name: str) -> None:
    _int(value, 0, UNDEF_TIMESTAMP - 1, name)


def _text(value: object, name: str, maximum: int = 128) -> None:
    _require(type(value) is str and 0 < len(value) <= maximum
             and all(32 <= ord(c) <= 126 for c in value), "invalid_" + name)


def _digest(value: object, name: str) -> None:
    _require(type(value) is str and HEX64.fullmatch(value) is not None,
             "invalid_" + name)


def _day_ns(value: object) -> int:
    _require(type(value) is str, "invalid_mapping_date")
    try:
        day = date.fromisoformat(value)
    except (TypeError, ValueError):
        raise NormalizationError("invalid_mapping_date") from None
    _require(day.isoformat() == value and day >= EPOCH, "invalid_mapping_date")
    return (day - EPOCH).days * NS_DAY


def _date_at_ns(value: int) -> str:
    return (EPOCH + timedelta(days=value // NS_DAY)).isoformat()


@dataclass(frozen=True, slots=True)
class EvidenceRef:
    evidence_id: str
    sha256: str
    known_at_ns: int
    kind: str


def _evidence(value: EvidenceRef, name: str, expected_kind: str) -> None:
    _require(type(value) is EvidenceRef, "invalid_" + name)
    _text(value.evidence_id, name + "_id")
    _digest(value.sha256, name + "_sha256")
    _ns(value.known_at_ns, name + "_known_at_ns")
    _require(value.kind == expected_kind, "unsupported_" + name + "_kind")


@dataclass(frozen=True, slots=True)
class ArtifactBinding:
    artifact_id: str
    sha256: str
    byte_length: int
    first_record_offset: int
    mode: str
    acquired_at_ns: int
    metadata_evidence: EvidenceRef
    normalization_evidence: EvidenceRef
    normalization_label: str
    dataset: str = "GLBX.MDP3"
    schema: str = "trades"
    wire_version: int = 3
    ts_out: bool = False
    compression: str = "none"
    input_representation: str = "exact_48_byte_record_blocks"
    price_encoding: str = "fixed_integer_1e-9"
    input_symbol_type: str = "raw_symbol"


@dataclass(frozen=True, slots=True)
class DefinitionBinding:
    evidence: EvidenceRef
    tick_evidence: EvidenceRef
    dataset: str
    publisher_id: int
    instrument_id: int
    raw_symbol: str
    product: str
    instrument_class: str
    security_type: str
    effective_from_ns: int
    effective_until_ns: int
    source_event_ns: int
    source_recv_ns: int
    tick_size_int: int
    price_scale: int
    contract_multiplier_int: int
    contract_multiplier_scale: int
    price_basis: str = "unadjusted"
    symbol_type: str = "raw_symbol"
    outright: bool = True


@dataclass(frozen=True, slots=True)
class DatedMapping:
    dataset: str
    publisher_id: int
    instrument_id: int
    raw_symbol: str
    start_date: str
    end_date: str
    evidence: EvidenceRef
    definition: DefinitionBinding
    declared_tick_size_int: int = MNQ_TICK


@dataclass(frozen=True, slots=True)
class Limits:
    max_records: int = 4096
    max_identities: int = 4096
    max_input_bytes: int = 48 * 4096
    max_mappings: int = 64


@dataclass(frozen=True, slots=True)
class RecordBlock:
    artifact_sha256: str
    offset: int
    data: bytes


@dataclass(frozen=True, slots=True)
class RawTrade:
    length_words: int
    rtype: int
    publisher_id: int
    instrument_id: int
    ts_event: int
    price: int
    size: int
    action: str
    side: str
    flags: int
    depth: int
    ts_recv: int
    ts_in_delta: int
    sequence: int

    def to_dict(self) -> dict:
        result = {f.name: getattr(self, f.name) for f in fields(self)}
        # Signed prices and epoch nanoseconds must not pass through JS floats.
        for name in ("ts_event", "price", "ts_recv"):
            result[name] = str(result[name])
        return result


def decode_record(data: bytes) -> RawTrade:
    """Decode exactly one block. Projection/binding validation is separate."""
    _require(type(data) is bytes, "immutable_bytes_required", "representation")
    _require(len(data) == TRADE_STRUCT.size == 48, "record_must_be_48_bytes",
             "framing")
    values = list(TRADE_STRUCT.unpack(data))
    values[7], values[8] = chr(values[7][0]), chr(values[8][0])
    raw = RawTrade(*values)
    _require(raw.length_words == 12, "header_length_not_12", "framing")
    _require(raw.rtype == 0, "unsupported_rtype", "scope")
    _require(raw.publisher_id == 1, "unsupported_publisher", "scope")
    _require(raw.action == "T", "unsupported_action", "scope")
    _require(raw.side in ("A", "B", "N"), "unknown_side", "enum")
    _require(raw.price != UNDEF_PRICE, "undefined_price", "undefined")
    _require(raw.size != UNDEF_SIZE, "undefined_quantity", "undefined")
    _require(raw.size > 0, "zero_quantity", "projection")
    _require(raw.ts_event != UNDEF_TIMESTAMP, "undefined_event_time", "undefined")
    _require(raw.ts_recv != UNDEF_TIMESTAMP, "undefined_capture_time", "undefined")
    return raw


@dataclass(frozen=True, slots=True)
class Observation:
    artifact_sha256: str
    artifact_id: str
    source_offset: int
    source_record_index: int
    record_sha256: str
    raw: RawTrade
    raw_symbol: str
    index_date: str
    mapping: DatedMapping
    aggressor_side: str
    source_sending_time_ns: int | None
    quality_exclusions: tuple[str, ...]
    mode: str
    acquired_at_ns: int
    metadata_known_at_ns: int
    normalization_known_at_ns: int
    mapping_known_at_ns: int
    definition_known_at_ns: int
    tick_known_at_ns: int
    qualification_at_ns: int
    publication_at_ns: int

    @property
    def observation_id(self) -> str:
        return "dbn-position:" + self.artifact_sha256 + ":" + str(self.source_offset)

    @property
    def available_at_ns(self) -> int:
        return max(self.acquired_at_ns, self.metadata_known_at_ns,
                   self.normalization_known_at_ns, self.mapping_known_at_ns,
                   self.definition_known_at_ns, self.tick_known_at_ns,
                   self.qualification_at_ns, self.publication_at_ns)

    def to_dict(self) -> dict:
        return {
            "observationId": self.observation_id,
            "identityKind": "artifact_position",
            "sourceRecordType": SOURCE_RECORD_TYPE,
            "sourceArtifactId": self.artifact_id,
            "sourceArtifactSha256": self.artifact_sha256,
            "sourcePosition": {"uncompressedByteOffset": str(self.source_offset),
                               "recordIndex": self.source_record_index},
            "recordSha256": self.record_sha256,
            "nativeTradeId": None,
            "nativeOrderId": None,
            "sourceSequence": str(self.raw.sequence),
            "sourceSequenceMeaning": "venue_message_sequence_not_execution_identity",
            "nativeFields": self.raw.to_dict(),
            "instrument": {
                "dataset": "GLBX.MDP3", "publisherId": 1,
                "instrumentId": self.raw.instrument_id, "rawSymbol": self.raw_symbol,
                "indexDateUtc": self.index_date, "product": "MNQ",
                "assetClass": "future", "instrumentClass": "F",
                "quantityUnit": "contracts", "priceBasis": "unadjusted",
                "priceScale": PRICE_SCALE, "tickSizeInt": MNQ_TICK,
                "contractMultiplierInt": MNQ_MULTIPLIER,
                "contractMultiplierScale": PRICE_SCALE,
            },
            "priceInt": self.raw.price, "priceScale": PRICE_SCALE,
            "quantity": self.raw.size, "quantityUnit": "contracts",
            "aggressorSide": self.aggressor_side,
            "sideEvidence": ("unknown" if self.aggressor_side == "unknown"
                             else "provider_reported_native_aggressor"),
            "orderCount": None,
            "volumeMeaning": "gross_as_reported",
            "correctionCoverage": "unsupported",
            "publicConsumerEligible": False,
            "qualityExclusions": list(self.quality_exclusions),
            "provenanceStatus": ("synthetic" if self.mode == "fixture"
                                 else "caller_supplied_unverified"),
            "mappingEvidence": _evidence_dict(self.mapping.evidence),
            "definitionEvidence": _evidence_dict(self.mapping.definition.evidence),
            "tickEvidence": _evidence_dict(self.mapping.definition.tick_evidence),
            "mappingInterval": {"startDateInclusive": self.mapping.start_date,
                                "endDateExclusive": self.mapping.end_date},
            "definitionSourceClocks": {
                "eventNs": str(self.mapping.definition.source_event_ns),
                "captureNs": str(self.mapping.definition.source_recv_ns),
                "effectiveFromNs": str(self.mapping.definition.effective_from_ns),
                "effectiveUntilNs": str(self.mapping.definition.effective_until_ns),
            },
            "clocks": {
                "clockAuthority": ("synthetic" if self.mode == "fixture"
                                   else "caller_supplied_unverified"),
                "eventNs": str(self.raw.ts_event),
                "vendorCaptureNs": str(self.raw.ts_recv),
                "sourceSendingTimeExactNs": (None if self.source_sending_time_ns is None
                                             else str(self.source_sending_time_ns)),
                "acquiredAtNs": str(self.acquired_at_ns),
                "metadataKnownAtNs": str(self.metadata_known_at_ns),
                "normalizationKnownAtNs": str(self.normalization_known_at_ns),
                "mappingKnownAtNs": str(self.mapping_known_at_ns),
                "definitionKnownAtNs": str(self.definition_known_at_ns),
                "tickKnownAtNs": str(self.tick_known_at_ns),
                "qualificationAtNs": str(self.qualification_at_ns),
                "publicationAtNs": str(self.publication_at_ns),
                "availableAtNs": str(self.available_at_ns),
            },
        }


def _evidence_dict(ref: EvidenceRef) -> dict:
    return {"evidenceId": ref.evidence_id, "sha256": ref.sha256,
            "knownAtNs": str(ref.known_at_ns), "kind": ref.kind, "verification": "not_performed"}


@dataclass(frozen=True, slots=True)
class Refusal:
    code: str
    category: str
    attempt: int
    offset: int | None
    input_bytes: int | None

    def to_dict(self) -> dict:
        return {"code": self.code, "category": self.category,
                "attempt": self.attempt,
                "sourceOffset": None if self.offset is None else str(self.offset),
                "inputBytes": self.input_bytes}


@dataclass(frozen=True, slots=True)
class BatchResult:
    artifact: ArtifactBinding
    observations: tuple[Observation, ...]
    attempts: int
    input_bytes: int
    duplicates: int
    refusal: Refusal | None
    qualification_at_ns: int
    publication_at_ns: int
    supplied_records: int | None = None

    def to_dict(self) -> dict:
        side_counts = {s: 0 for s in ("buy", "sell", "unknown")}
        side_qty = {s: 0 for s in side_counts}
        quality_qty = {"flaggedOrUnavailableClock": 0, "noListedExclusion": 0}
        instruments: dict[tuple, list[int]] = {}
        exclusions: dict[str, int] = {}
        for row in self.observations:
            side_counts[row.aggressor_side] += 1
            side_qty[row.aggressor_side] += row.raw.size
            quality_qty["flaggedOrUnavailableClock" if row.quality_exclusions
                        else "noListedExclusion"] += row.raw.size
            key = (row.index_date, row.raw.instrument_id, row.raw_symbol)
            counts = instruments.setdefault(key, [0, 0])
            counts[0] += 1
            counts[1] += row.raw.size
            for exclusion in row.quality_exclusions:
                exclusions[exclusion] = exclusions.get(exclusion, 0) + 1
        return {
            "contract": "private-databento-glbx-trades-observations-v1",
            "status": ("complete_private_observation_batch" if self.refusal is None
                       else "refused_incomplete_diagnostics"),
            "publicConsumerEligible": False,
            "volumeMeaning": "gross_as_reported",
            "correctionCoverage": "unsupported",
            "sourceRecordType": SOURCE_RECORD_TYPE,
            "artifactCoverage": "unverified_partial_or_unknown",
            "provenanceStatus": ("synthetic" if self.artifact.mode == "fixture"
                                 else "caller_supplied_unverified"),
            "metadataFramingReaderImplemented": False,
            "rightsVerified": False,
            "artifact": {
                "artifactId": self.artifact.artifact_id,
                "sha256": self.artifact.sha256,
                "declaredBytes": str(self.artifact.byte_length),
                "firstRecordOffset": str(self.artifact.first_record_offset),
                "dataset": self.artifact.dataset, "schema": self.artifact.schema,
                "wireVersion": self.artifact.wire_version,
                "mode": self.artifact.mode,
                "metadataEvidence": _evidence_dict(self.artifact.metadata_evidence),
                "normalizationEvidence": _evidence_dict(self.artifact.normalization_evidence),
                "normalizationLabel": self.artifact.normalization_label,
            },
            "qualificationAtNs": str(self.qualification_at_ns),
            "publicationAtNs": str(self.publication_at_ns),
            "attempts": self.attempts, "budgetedInputBytes": self.input_bytes,
            "suppliedRecords": self.supplied_records,
            "unconsumedSuppliedRecords": (None if self.supplied_records is None else
                                         max(0, self.supplied_records - self.attempts)),
            "uniqueObservations": len(self.observations), "duplicates": self.duplicates,
            "grossReportedQuantity": str(sum(side_qty.values())),
            "totalsScope": ("this_supplied_batch_only" if self.refusal is None
                            else "successfully_retained_prefix_diagnostics_only"),
            "sidePartitions": {
                s: {"observations": side_counts[s], "quantity": str(side_qty[s])}
                for s in side_counts},
            "qualityQuantityPartitions": {k: str(v) for k, v in quality_qty.items()},
            "qualityExclusionObservationCounts": exclusions,
            "instrumentPartitions": [
                {"indexDateUtc": key[0], "instrumentId": key[1],
                 "rawSymbol": key[2], "observations": value[0],
                 "quantity": str(value[1])}
                for key, value in instruments.items()],
            "refusal": None if self.refusal is None else self.refusal.to_dict(),
            "observations": [row.to_dict() for row in self.observations],
        }

    def at_knowledge(self, knowledge_cutoff_ns: int) -> dict:
        """An admission view, not a backdated diagnostic/raw-data accessor."""
        _ns(knowledge_cutoff_ns, "knowledge_cutoff_ns")
        if knowledge_cutoff_ns < self.publication_at_ns:
            return {"status": "unavailable_before_publication_knowledge",
                    "publicConsumerEligible": False,
                    "observations": [], "grossReportedQuantity": None}
        return self.to_dict()


def _validate_artifact(binding: ArtifactBinding) -> None:
    _require(type(binding) is ArtifactBinding, "artifact_binding_required")
    _text(binding.artifact_id, "artifact_id")
    _digest(binding.sha256, "artifact_sha256")
    _int(binding.byte_length, 48, MAX_SAFE_INTEGER, "artifact_byte_length")
    _int(binding.first_record_offset, 0, binding.byte_length - 48,
         "first_record_offset")
    _require((binding.byte_length - binding.first_record_offset) % 48 == 0,
             "declared_record_region_not_multiple_of_48", "framing")
    _require(binding.mode in ("historical", "fixture"), "unsupported_data_mode",
             "scope")
    _ns(binding.acquired_at_ns, "acquired_at_ns")
    _evidence(binding.metadata_evidence, "metadata_evidence", "dbn_metadata_declaration")
    _evidence(binding.normalization_evidence, "normalization_evidence", "normalization_provenance_declaration")
    _text(binding.normalization_label, "normalization_label")
    _require(binding.dataset == "GLBX.MDP3", "unsupported_dataset", "scope")
    _require(binding.schema == "trades", "unsupported_or_mixed_schema", "scope")
    _require(type(binding.wire_version) is int and binding.wire_version == 3,
             "unsupported_wire_version", "scope")
    _require(type(binding.ts_out) is bool and not binding.ts_out,
             "appended_ts_out_unsupported", "framing")
    _require(binding.compression == "none", "compressed_input_unsupported", "framing")
    _require(binding.input_representation == "exact_48_byte_record_blocks",
             "unsupported_input_representation", "representation")
    _require(binding.price_encoding == "fixed_integer_1e-9",
             "unsupported_price_encoding", "representation")
    _require(binding.input_symbol_type == "raw_symbol",
             "symbol_alias_input_unsupported", "scope")


def _validate_mappings(mappings: tuple[DatedMapping, ...], maximum: int) -> None:
    _require(type(mappings) is tuple and 0 < len(mappings) <= maximum,
             "bounded_immutable_mappings_required")
    intervals = []
    for mapping in mappings:
        _require(type(mapping) is DatedMapping, "invalid_dated_mapping")
        _evidence(mapping.evidence, "mapping_evidence", "symbol_mapping_interval")
        _require(mapping.dataset == "GLBX.MDP3" and mapping.publisher_id == 1
                 and type(mapping.publisher_id) is int, "mapping_dataset_publisher")
        _int(mapping.instrument_id, 0, (1 << 32) - 1, "mapping_instrument_id")
        _text(mapping.raw_symbol, "mapping_raw_symbol", 70)
        start, end = _day_ns(mapping.start_date), _day_ns(mapping.end_date)
        _require(start < end, "invalid_mapping_interval")
        _int(mapping.declared_tick_size_int, 1, MAX_SAFE_INTEGER,
             "declared_tick_size_int")
        definition = mapping.definition
        _require(type(definition) is DefinitionBinding, "definition_binding_required")
        _evidence(definition.evidence, "definition_evidence", "dbn_instrument_definition")
        _evidence(definition.tick_evidence, "tick_evidence", "dbn_instrument_definition")
        _require((definition.dataset, definition.publisher_id,
                  definition.instrument_id, definition.raw_symbol) ==
                 (mapping.dataset, mapping.publisher_id,
                  mapping.instrument_id, mapping.raw_symbol),
                 "mapping_definition_identity_conflict")
        _require(type(definition.publisher_id) is int
                 and type(definition.instrument_id) is int,
                 "invalid_definition_identity_types")
        _require(definition.product == "MNQ" and definition.instrument_class == "F"
                 and definition.security_type == "FUT"
                 and type(definition.outright) is bool and definition.outright,
                 "unsupported_instrument_projection", "scope")
        _require(definition.symbol_type == "raw_symbol"
                 and definition.price_basis == "unadjusted",
                 "unsupported_symbol_or_price_basis", "scope")
        for name in ("effective_from_ns", "effective_until_ns",
                     "source_event_ns", "source_recv_ns"):
            _ns(getattr(definition, name), "definition_" + name)
        _require(definition.effective_from_ns < definition.effective_until_ns,
                 "invalid_definition_effective_interval")
        _require(definition.evidence.known_at_ns >= max(
            definition.source_event_ns, definition.source_recv_ns),
            "definition_knowledge_precedes_source", "knowledge")
        for name in ("tick_size_int", "price_scale", "contract_multiplier_int",
                     "contract_multiplier_scale"):
            _int(getattr(definition, name), 1, MAX_SAFE_INTEGER, "definition_" + name)
        _require(definition.price_scale == PRICE_SCALE
                 and definition.tick_size_int == MNQ_TICK
                 and mapping.declared_tick_size_int == definition.tick_size_int,
                 "definition_tick_conflict", "projection")
        _require(definition.contract_multiplier_int == MNQ_MULTIPLIER
                 and definition.contract_multiplier_scale == PRICE_SCALE,
                 "definition_multiplier_conflict", "projection")
        for previous, left, right in intervals:
            if max(start, left) < min(end, right):
                _require(previous.instrument_id != mapping.instrument_id,
                         "overlapping_mapping_intervals")
                _require(previous.raw_symbol != mapping.raw_symbol,
                         "conflicting_symbol_bindings")
        intervals.append((mapping, start, end))


class Normalizer:
    """Bounded single-artifact batch. A fatal input permanently stops consumption."""

    def __init__(self, artifact: ArtifactBinding, mappings: tuple[DatedMapping, ...],
                 qualification_at_ns: int, publication_at_ns: int,
                 limits: Limits = Limits()):
        _require(type(limits) is Limits, "limits_required")
        _int(limits.max_records, 1, 65536, "max_records")
        _int(limits.max_identities, 1, 65536, "max_identities")
        _int(limits.max_input_bytes, 48, 48 * 65536, "max_input_bytes")
        _int(limits.max_mappings, 1, 64, "max_mappings")
        _validate_artifact(artifact)
        _validate_mappings(mappings, limits.max_mappings)
        _ns(qualification_at_ns, "qualification_at_ns")
        _ns(publication_at_ns, "publication_at_ns")
        required_knowledge = max(
            artifact.acquired_at_ns,
            artifact.metadata_evidence.known_at_ns,
            artifact.normalization_evidence.known_at_ns,
            *(ref.known_at_ns for mapping in mappings
              for ref in (mapping.evidence, mapping.definition.evidence,
                          mapping.definition.tick_evidence)))
        _require(required_knowledge <= qualification_at_ns <= publication_at_ns,
                 "knowledge_clock_chain_invalid", "knowledge")
        self._artifact = artifact
        self._mappings = mappings
        self._qualification = qualification_at_ns
        self._publication = publication_at_ns
        self._limits = limits
        self._seen: dict[int, bytes] = {}
        self._observations: list[Observation] = []
        self._attempts = self._input_bytes = self._duplicates = 0
        self._last_new_offset: int | None = None
        self._refusal: Refusal | None = None
        self._closed = False

    def consume(self, block: RecordBlock) -> Observation | None:
        if self._closed or self._refusal is not None:
            raise NormalizationError("batch_stopped", "lifecycle")
        try:
            self._attempts += 1
            _require(self._attempts <= self._limits.max_records,
                     "record_cap_exceeded", "capacity")
            _require(type(block) is RecordBlock, "record_block_required",
                     "representation")
            _require(type(block.data) is bytes, "immutable_bytes_required",
                     "representation")
            size = len(block.data)
            _require(size <= self._limits.max_input_bytes - self._input_bytes,
                     "input_byte_cap_exceeded", "capacity")
            self._input_bytes += size
            _digest(block.artifact_sha256, "block_artifact_sha256")
            _require(block.artifact_sha256 == self._artifact.sha256,
                     "cross_artifact_input_refused", "identity")
            _int(block.offset, self._artifact.first_record_offset,
                 self._artifact.byte_length - 48, "source_offset")
            _require((block.offset - self._artifact.first_record_offset) % 48 == 0,
                     "misaligned_source_position", "framing")
            previous = self._seen.get(block.offset)
            if previous is not None:
                _require(previous == block.data, "conflicting_artifact_position",
                         "identity")
                self._duplicates += 1
                return None
            raw = decode_record(block.data)
            _require(len(self._seen) < self._limits.max_identities,
                     "identity_cap_exceeded", "capacity")
            _require(self._last_new_offset is None or block.offset > self._last_new_offset,
                     "source_position_order_regression", "identity")
            row = self._project(raw, block)
            # Insert only after complete validation; one position cannot partially mutate totals.
            self._seen[block.offset] = block.data
            self._observations.append(row)
            self._last_new_offset = block.offset
            return row
        except NormalizationError as error:
            offset = block.offset if type(block) is RecordBlock and type(block.offset) is int else None
            size = len(block.data) if type(block) is RecordBlock and type(block.data) is bytes else None
            self._refusal = Refusal(error.code, error.category, self._attempts, offset, size)
            raise

    def _project(self, raw: RawTrade, block: RecordBlock) -> Observation:
        _require(0 < raw.price <= MAX_SAFE_INTEGER, "unsupported_price_projection",
                 "projection")
        _require(raw.size <= MAX_SAFE_INTEGER, "unsafe_quantity_projection",
                 "projection")
        _require(max(raw.ts_event, raw.ts_recv) <= self._artifact.acquired_at_ns,
                 "source_clock_after_acquisition", "knowledge")
        matches = tuple(m for m in self._mappings
                        if m.instrument_id == raw.instrument_id
                        and _day_ns(m.start_date) <= raw.ts_recv < _day_ns(m.end_date))
        _require(len(matches) == 1, "missing_or_ambiguous_dated_mapping", "mapping")
        mapping = matches[0]
        definition = mapping.definition
        _require(definition.effective_from_ns <= raw.ts_recv <
                 definition.effective_until_ns, "definition_not_effective", "mapping")
        _require(raw.price % definition.tick_size_int == 0,
                 "unsupported_tick_grid_projection", "projection")
        exclusions: list[str] = []
        for bit, reason in (
            (32, "snapshot_or_replay_flag_unqualified"),
            (8, "vendor_capture_timestamp_inaccurate"),
            (4, "vendor_reported_unrecoverable_channel_gap"),
            (2, "publisher_specific_flag_uninterpreted"),
            (1, "reserved_flag_preserved_uninterpreted"),
        ):
            if raw.flags & bit:
                exclusions.append(reason)
        send = None
        if raw.ts_in_delta in (DELTA_MIN, DELTA_MAX):
            exclusions.append("source_sending_time_unavailable_saturated_delta")
        else:
            derived = raw.ts_recv - raw.ts_in_delta
            if 0 <= derived < UNDEF_TIMESTAMP:
                send = derived
            else:
                exclusions.append("source_sending_time_out_of_range")
        return Observation(
            self._artifact.sha256, self._artifact.artifact_id, block.offset,
            (block.offset - self._artifact.first_record_offset) // 48,
            hashlib.sha256(block.data).hexdigest(), raw, mapping.raw_symbol,
            _date_at_ns(raw.ts_recv), mapping,
            {"A": "sell", "B": "buy", "N": "unknown"}[raw.side],
            send, tuple(exclusions), self._artifact.mode,
            self._artifact.acquired_at_ns, self._artifact.metadata_evidence.known_at_ns,
            self._artifact.normalization_evidence.known_at_ns,
            mapping.evidence.known_at_ns, definition.evidence.known_at_ns,
            definition.tick_evidence.known_at_ns,
            self._qualification, self._publication)

    def finish(self) -> BatchResult:
        _require(not self._closed, "batch_already_finished", "lifecycle")
        self._closed = True
        return BatchResult(
            self._artifact, tuple(self._observations), self._attempts,
            self._input_bytes, self._duplicates, self._refusal,
            self._qualification, self._publication)


def normalize_batch(artifact: ArtifactBinding, mappings: tuple[DatedMapping, ...],
                    blocks: tuple[RecordBlock, ...], qualification_at_ns: int,
                    publication_at_ns: int, limits: Limits = Limits()) -> BatchResult:
    """Consume a bounded immutable supplied batch. No stream or file is opened."""
    _require(type(blocks) is tuple, "immutable_block_batch_required", "representation")
    normalizer = Normalizer(artifact, mappings, qualification_at_ns, publication_at_ns, limits)
    for block in blocks:
        try:
            normalizer.consume(block)
        except NormalizationError:
            break
    return replace(normalizer.finish(), supplied_records=len(blocks))
