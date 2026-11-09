"""Private bounded canonical-profile DBN v3 container reader.

Pure bytes API; no file, network, decompression, producer authentication or public
consumer authority. Compose the separately reviewed record normalizer unchanged.
See docs/CME_DBN_CONTAINER.md and
docs/evidence/large-trades/cme-dbn-container-policy.json.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import hashlib
import json

from ingest import cme_databento_trades as trade

PINNED_DBN_COMMIT = "d368005a636bae84bff443cd6ddae6430a0ffd00"
PINNED_DBN_VERSION = "0.71.0"
NORMALIZER_SHA256 = "879fbfa8ec0c16923330683f8a756f5782bc3127efbf9f88b15ff76dc90691fe"
PROFILE = "private-dbn-v3-glbx-trades-canonical-uncompressed-v1"
UNDEF_TIMESTAMP = (1 << 64) - 1
NS_DAY = 86_400_000_000_000
EPOCH = date(1970, 1, 1)


class ContainerError(ValueError):
    """Explicit unsupported-profile, framing, capacity or binding refusal."""
    def __init__(self, code: str, category: str = "contract", offset: int | None = None):
        self.code, self.category, self.offset = code, category, offset
        super().__init__(code)


def _need(condition: bool, code: str, category: str = "contract",
          offset: int | None = None) -> None:
    if not condition:
        raise ContainerError(code, category, offset)


@dataclass(frozen=True, slots=True)
class Limits:
    max_container_bytes: int = 2 * 1024 * 1024
    max_metadata_bytes: int = 1024 * 1024
    max_records: int = 4096
    max_symbol_width: int = 256
    max_metadata_strings: int = 1024
    max_mappings: int = 64
    max_intervals: int = 512
    max_output_bytes: int = 16 * 1024 * 1024


def _limits(value: Limits) -> None:
    _need(type(value) is Limits, "limits_required")
    for name, low, high in (
        ("max_container_bytes", 128, 4 * 1024 * 1024),
        ("max_metadata_bytes", 120, 1024 * 1024),
        ("max_records", 1, 4096),
        ("max_symbol_width", 1, 256),
        ("max_metadata_strings", 1, 1024),
        ("max_mappings", 1, 64),
        ("max_intervals", 1, 512),
        ("max_output_bytes", 1, 32 * 1024 * 1024),
    ):
        number = getattr(value, name)
        _need(type(number) is int and low <= number <= high, "invalid_" + name)


class _Cursor:
    def __init__(self, data: bytes, start: int, end: int, limits: Limits):
        self.data, self.pos, self.end, self.limits = data, start, end, limits
        self.strings = self.intervals = 0

    def take(self, count: int, name: str) -> bytes:
        start = self.pos
        _need(count <= self.end - start, "truncated_" + name, "framing", start)
        self.pos += count
        return self.data[start:self.pos]

    def uint(self, count: int, name: str) -> int:
        return int.from_bytes(self.take(count, name), "little")

    def count(self, name: str, maximum: int, item_minimum: int) -> int:
        pos = self.pos
        count = self.uint(4, name + "_count")
        _need(count <= maximum, name + "_count_cap", "capacity", pos)
        _need(count * item_minimum <= self.end - self.pos,
              "truncated_" + name, "framing", self.pos)
        return count

    def cstr(self, width: int, name: str, budget: bool = True) -> str:
        start = self.pos
        raw = self.take(width, name)
        if budget:
            self.strings += 1
            _need(self.strings <= self.limits.max_metadata_strings,
                  "metadata_string_cap", "capacity", start)
        nul = raw.find(b"\0")
        _need(nul >= 0, "canonical_nul_required_" + name, "profile", start)
        _need(all(x == 0 for x in raw[nul:]),
              "canonical_string_padding_required_" + name, "profile", start)
        value = raw[:nul]
        _need(len(value) > 0 and all(33 <= x <= 126 for x in value),
              "unsupported_text_" + name, "profile", start)
        return value.decode("ascii")


@dataclass(frozen=True, slots=True)
class MappingInterval:
    start_date: int
    end_date: int
    symbol: str

    def to_dict(self) -> dict:
        return {"startDateInclusive": self.start_date,
                "endDateExclusive": self.end_date, "symbol": self.symbol}


@dataclass(frozen=True, slots=True)
class SymbolMapping:
    raw_symbol: str
    intervals: tuple[MappingInterval, ...]

    def to_dict(self) -> dict:
        return {"rawSymbol": self.raw_symbol,
                "intervals": [x.to_dict() for x in self.intervals]}


@dataclass(frozen=True, slots=True)
class Metadata:
    payload_length: int
    dataset: str
    schema: int
    start: int
    end: int
    limit: int
    stype_in: int
    stype_out: int
    ts_out: bool
    symbol_width: int
    reserved: bytes
    symbols: tuple[str, ...]
    partial: tuple[str, ...]
    not_found: tuple[str, ...]
    mappings: tuple[SymbolMapping, ...]
    padding_bytes: int

    def to_dict(self) -> dict:
        return {
            "payloadLength": self.payload_length, "dataset": self.dataset,
            "schemaCode": self.schema, "schema": "trades",
            "declaredStartNs": str(self.start),
            "declaredEndNs": None if self.end == UNDEF_TIMESTAMP else str(self.end),
            "rawDeclaredEndNs": str(self.end),
            "queryLimit": None if self.limit == 0 else str(self.limit),
            "rawQueryLimit": str(self.limit),
            "timeBoundsMeaning": "unverified_query_or_split_file_declaration",
            "requestRangeIndexWhenApplicable": "ts_recv", "stypeIn": self.stype_in,
            "stypeOut": self.stype_out, "tsOut": self.ts_out,
            "symbolCstrWidth": self.symbol_width,
            "reservedHex": self.reserved.hex(),
            "symbols": list(self.symbols), "partial": list(self.partial),
            "notFound": list(self.not_found),
            "mappings": [m.to_dict() for m in self.mappings],
            "alignmentPaddingBytes": self.padding_bytes,
            "meaning": "structural query and mapping declarations; authenticity unverified",
        }


@dataclass(frozen=True, slots=True)
class RecordSpan:
    offset: int
    raw: trade.RawTrade


@dataclass(frozen=True, slots=True)
class ParsedContainer:
    container: bytes
    sha256: str
    metadata_region_sha256: str
    first_record_offset: int
    metadata: Metadata
    records: tuple[RecordSpan, ...]

    def to_dict(self) -> dict:
        return {
            "profile": PROFILE, "wireVersion": 3,
            "sha256": self.sha256, "bytes": len(self.container),
            "headerAndMetadataSha256": self.metadata_region_sha256,
            "firstRecordOffset": self.first_record_offset,
            "recordCount": len(self.records), "recordLength": 48,
            "recordPositions": [str(x.offset) for x in self.records],
            "metadata": self.metadata.to_dict(),
            "structuralFramingValidated": True,
            "canonicalProfileValidated": True,
            "producerLibraryVersionAuthenticated": False,
            "exportAuthenticityVerified": False,
            "marketCompletenessVerified": False,
            "rightsVerified": False, "publicConsumerEligible": False,
        }


def _ymd(value: int, name: str, offset: int) -> date:
    try:
        return date(value // 10000, (value // 100) % 100, value % 100)
    except ValueError:
        raise ContainerError("invalid_" + name, "framing", offset) from None


def _strings(cursor: _Cursor, width: int, name: str) -> tuple[str, ...]:
    count = cursor.count(name, cursor.limits.max_metadata_strings, width)
    values = tuple(cursor.cstr(width, name) for _ in range(count))
    _need(len(set(values)) == len(values), "duplicate_" + name + "_declaration",
          "profile")
    return values


def parse_container(data: bytes, limits: Limits = Limits()) -> ParsedContainer:
    """Validate one entire bounded immutable uncompressed canonical DBN v3 file.

    Empty containers are structurally supported. No bytes are yielded before all
    metadata and record boundaries validate. No suffix or extension is trusted.
    """
    _limits(limits)
    _need(type(data) is bytes, "immutable_container_bytes_required", "representation")
    _need(len(data) <= limits.max_container_bytes, "container_byte_cap", "capacity")
    for magic in (b"\x28\xb5\x2f\xfd", b"\x1f\x8b", b"BZh", b"\xfd7zXZ\0"):
        _need(not data.startswith(magic), "compressed_container_unsupported", "scope", 0)
    _need(len(data) >= 8, "truncated_prelude", "framing", 0)
    _need(data[:3] == b"DBN", "unsupported_container_signature", "scope", 0)
    _need(data[3] == 3, "unsupported_dbn_wire_version", "scope", 3)
    declared = int.from_bytes(data[4:8], "little")
    _need(declared >= 120, "metadata_length_below_fixed_minimum", "framing", 4)
    _need(declared <= limits.max_metadata_bytes, "metadata_byte_cap", "capacity", 4)
    _need(declared % 8 == 0, "canonical_metadata_alignment_required", "profile", 4)
    end = 8 + declared
    _need(end <= len(data), "truncated_declared_metadata", "framing", 8)
    cursor = _Cursor(data, 8, end, limits)
    dataset = cursor.cstr(16, "dataset", budget=False)
    _need(dataset == "GLBX.MDP3", "unsupported_dataset", "scope", 8)
    schema = cursor.uint(2, "schema")
    _need(schema == 4, "unsupported_or_mixed_schema", "scope", 24)
    start, finish, limit = (cursor.uint(8, n) for n in ("start", "end", "limit"))
    _need(start != UNDEF_TIMESTAMP, "undefined_query_start", "scope", 26)
    _need(finish == UNDEF_TIMESTAMP or start <= finish,
          "inverted_declared_time_bounds", "declaration", 34)
    stype_in, stype_out, ts_out_raw = (cursor.uint(1, n) for n in
                                      ("stype_in", "stype_out", "ts_out"))
    _need(stype_in == 1 and stype_out == 0, "unsupported_symbol_types", "scope", 50)
    _need(ts_out_raw in (0, 1), "invalid_ts_out_encoding", "framing", 52)
    _need(ts_out_raw == 0, "appended_ts_out_unsupported", "scope", 52)
    width = cursor.uint(2, "symbol_cstr_width")
    _need(1 <= width <= limits.max_symbol_width,
          "unsupported_symbol_width", "profile", 53)
    reserved = cursor.take(53, "reserved")
    _need(not any(reserved), "canonical_zero_reserved_required", "profile", 55)
    _need(cursor.uint(4, "schema_definition_length") == 0,
          "schema_definition_unsupported", "scope", 108)
    symbols = _strings(cursor, width, "symbols")
    partial = _strings(cursor, width, "partial")
    not_found = _strings(cursor, width, "not_found")
    mapping_count = cursor.count("mappings", limits.max_mappings, width + 4)
    mappings: list[SymbolMapping] = []
    raw_symbols: set[str] = set()
    for _ in range(mapping_count):
        raw_symbol = cursor.cstr(width, "mapping_raw_symbol")
        _need(raw_symbol not in raw_symbols, "duplicate_mapping_raw_symbol", "profile")
        raw_symbols.add(raw_symbol)
        count = cursor.count("intervals", limits.max_intervals, 8 + width)
        _need(count <= limits.max_intervals - cursor.intervals,
              "mapping_interval_total_cap", "capacity", cursor.pos - 4)
        cursor.intervals += count
        intervals: list[MappingInterval] = []
        previous_end: date | None = None
        for _ in range(count):
            offset = cursor.pos
            left, right = cursor.uint(4, "interval_start"), cursor.uint(4, "interval_end")
            left_day, right_day = _ymd(left, "interval_start", offset), _ymd(
                right, "interval_end", offset + 4)
            _need(left_day < right_day, "invalid_mapping_interval", "declaration", offset)
            _need(previous_end is None or previous_end <= left_day,
                  "overlapping_or_unsorted_mapping_intervals", "profile", offset)
            mapped_symbol = cursor.cstr(width, "mapped_symbol")
            _need(mapped_symbol.isascii() and mapped_symbol.isdecimal()
                  and str(int(mapped_symbol)) == mapped_symbol
                  and int(mapped_symbol) <= (1 << 32) - 1,
                  "unsupported_instrument_id_mapping", "profile", offset + 8)
            intervals.append(MappingInterval(left, right, mapped_symbol))
            previous_end = right_day
        mappings.append(SymbolMapping(raw_symbol, tuple(intervals)))
    padding = (-(cursor.pos - 8)) % 8
    _need(end - cursor.pos == padding, "canonical_metadata_tail_length_required",
          "profile", cursor.pos)
    _need(not any(cursor.take(padding, "metadata_padding")),
          "canonical_zero_metadata_padding_required", "profile", end - padding)
    remaining = len(data) - end
    _need(remaining % 48 == 0, "record_region_truncated_or_trailing_bytes", "framing", end)
    count = remaining // 48
    _need(count <= limits.max_records, "record_count_cap", "capacity", end)
    _need(limit == 0 or count <= limit, "record_count_exceeds_declared_query_limit",
          "declaration", 42)
    spans: list[RecordSpan] = []
    for offset in range(end, len(data), 48):
        try:
            raw = trade.decode_record(data[offset:offset + 48])
        except trade.NormalizationError as error:
            raise ContainerError("record_" + error.code, error.category, offset) from None
        spans.append(RecordSpan(offset, raw))
    meta = Metadata(declared, dataset, schema, start, finish, limit, stype_in,
                    stype_out, False, width, reserved, symbols, partial,
                    not_found, tuple(mappings), padding)
    return ParsedContainer(data, hashlib.sha256(data).hexdigest(),
                           hashlib.sha256(data[:end]).hexdigest(), end,
                           meta, tuple(spans))


def _metadata_row_symbols(parsed: ParsedContainer) -> dict[int, str]:
    """Check declaration consistency only; do not manufacture source definitions."""
    meta = parsed.metadata
    requested = set(meta.symbols)
    _need(bool(requested), "explicit_requested_raw_symbols_required", "scope")
    _need(set(meta.partial) <= requested and set(meta.not_found) <= requested,
          "undeclared_partial_or_not_found_symbol", "declaration")
    _need(not set(meta.partial).intersection(meta.not_found),
          "partial_and_not_found_conflict", "declaration")
    _need(all(m.raw_symbol in requested for m in meta.mappings),
          "mapping_symbol_not_requested", "declaration")
    by_offset: dict[int, str] = {}
    for span in parsed.records:
        day = EPOCH + timedelta(days=span.raw.ts_recv // NS_DAY)
        ymd = day.year * 10000 + day.month * 100 + day.day
        matches = [m.raw_symbol for m in meta.mappings
                   for interval in m.intervals
                   if interval.start_date <= ymd < interval.end_date
                   and interval.symbol == str(span.raw.instrument_id)]
        _need(len(matches) == 1, "missing_or_ambiguous_container_mapping",
              "declaration", span.offset)
        _need(matches[0] not in meta.not_found, "record_for_not_found_symbol",
              "declaration", span.offset)
        by_offset[span.offset] = matches[0]
    return by_offset


def _encode_bounded(value: dict, maximum: int) -> bytes:
    result = bytearray()
    for chunk in json.JSONEncoder(ensure_ascii=True, separators=(",", ":"),
                                  sort_keys=True, allow_nan=False).iterencode(value):
        encoded = chunk.encode("utf-8")
        _need(len(encoded) <= maximum - len(result), "serialized_output_cap", "capacity")
        result.extend(encoded)
    return bytes(result)


@dataclass(frozen=True, slots=True)
class ContainerResult:
    _canonical_json: bytes
    publication_at_ns: int

    def to_dict(self) -> dict:
        """Fresh diagnostic copy; changing it never changes the sealed result."""
        return json.loads(self._canonical_json)

    def at_knowledge(self, knowledge_cutoff_ns: int) -> dict:
        _need(type(knowledge_cutoff_ns) is int
              and 0 <= knowledge_cutoff_ns < UNDEF_TIMESTAMP,
              "invalid_knowledge_cutoff")
        if knowledge_cutoff_ns < self.publication_at_ns:
            return {"status": "unavailable_before_publication_knowledge",
                    "publicConsumerEligible": False, "observations": [],
                    "grossReportedQuantity": None}
        return self.to_dict()

    @property
    def serialized_bytes(self) -> int:
        return len(self._canonical_json)


def normalize_container(
    data: bytes, artifact: trade.ArtifactBinding,
    mappings: tuple[trade.DatedMapping, ...],
    qualification_at_ns: int, publication_at_ns: int, *,
    metadata_range_semantics: str, limits: Limits = Limits(),
) -> ContainerResult:
    """Bridge validated full-container bytes to unchanged record normalization.

    Metadata evidence SHA must bind the exact first_record_offset prefix, including
    the eight-byte DBN prelude. Its caller-supplied known_at_ns must not precede
    acquisition. It is a declaration/knowledge fence, never export authentication.
    metadata_range_semantics must explicitly declare half_open_query_ts_recv.
    Unknown or split-file endpoint semantics are not supported by this bridge.
    """
    parsed = parse_container(data, limits)
    _need(bool(parsed.records), "empty_container_normalization_unsupported", "scope")
    _need(type(metadata_range_semantics) is str
          and metadata_range_semantics == "half_open_query_ts_recv",
          "unsupported_or_unknown_metadata_range_semantics", "scope")
    for span in parsed.records:
        _need(parsed.metadata.start <= span.raw.ts_recv and
              (parsed.metadata.end == UNDEF_TIMESTAMP
               or span.raw.ts_recv < parsed.metadata.end),
              "capture_outside_declared_query_interval", "declaration", span.offset + 32)
    _need(type(artifact) is trade.ArtifactBinding, "artifact_binding_required")
    _need((artifact.sha256, artifact.byte_length, artifact.first_record_offset) ==
          (parsed.sha256, len(data), parsed.first_record_offset),
          "original_container_binding_mismatch", "identity")
    _need((artifact.dataset, artifact.schema, artifact.wire_version, artifact.ts_out,
           artifact.compression, artifact.input_symbol_type) ==
          (parsed.metadata.dataset, "trades", 3, False, "none", "raw_symbol"),
          "artifact_metadata_declaration_conflict", "declaration")
    _need(type(artifact.metadata_evidence) is trade.EvidenceRef,
          "metadata_evidence_required")
    _need(artifact.metadata_evidence.sha256 == parsed.metadata_region_sha256,
          "metadata_prefix_digest_mismatch", "identity")
    _need(type(artifact.metadata_evidence.known_at_ns) is int
          and type(artifact.acquired_at_ns) is int
          and artifact.metadata_evidence.known_at_ns >= artifact.acquired_at_ns,
          "framing_knowledge_precedes_acquisition", "knowledge")
    declared_symbols = _metadata_row_symbols(parsed)
    blocks = tuple(trade.RecordBlock(parsed.sha256, span.offset,
                                    data[span.offset:span.offset + 48])
                   for span in parsed.records)
    try:
        batch = trade.normalize_batch(
            artifact, mappings, blocks, qualification_at_ns, publication_at_ns,
            trade.Limits(max_records=len(blocks), max_identities=len(blocks),
                         max_input_bytes=48 * len(blocks), max_mappings=64))
    except trade.NormalizationError as error:
        raise ContainerError("normalizer_" + error.code, error.category) from None
    for row in batch.observations:
        _need(row.raw_symbol == declared_symbols[row.source_offset],
              "external_mapping_conflicts_with_container_declaration",
              "declaration", row.source_offset)
    result = {
        "contract": "private-dbn-v3-container-observations-v1",
        "status": ("complete_private_container_observations" if batch.refusal is None
                   else "refused_incomplete_normalizer_diagnostics"),
        "container": parsed.to_dict(),
        "normalizer": batch.to_dict(),
        "normalizerComponentScope": (
            "The unchanged record-only component reports metadataFramingReaderImplemented=false. "
            "Outer structural/canonical validation does not change its unverified provenance, "
            "rights, correction, coverage or public-consumer status."),
        "declaredMetadataRangeSemantics": metadata_range_semantics,
        "metadataRangeSemanticsAuthenticated": False,
        "providedContainerBytesConsumed": len(data),
        "providedContainerRecords": len(blocks),
        "allProvidedContainerRecordBoundariesValidated": True,
        "producerLibraryVersionAuthenticated": False,
        "normalizationEpochAuthenticated": False,
        "exportAuthenticityVerified": False,
        "instrumentDefinitionsAuthenticated": False,
        "rightsVerified": False,
        "marketCompletenessVerified": False,
        "publicConsumerEligible": False,
        "volumeMeaning": "gross_as_reported",
        "correctionCoverage": "unsupported",
        "orderCount": None,
        "metadataQuality": {
            "partialRequestedSymbols": list(parsed.metadata.partial),
            "notFoundRequestedSymbols": list(parsed.metadata.not_found),
            "absenceOfPartialFlagProvesCompleteness": False,
        },
        "clockAuthority": "synthetic" if artifact.mode == "fixture"
                          else "caller_supplied_unverified",
        "qualificationAtNs": str(qualification_at_ns),
        "publicationAtNs": str(publication_at_ns),
        "noResponseOrAbsorptionOutput": True,
    }
    return ContainerResult(_encode_bounded(result, limits.max_output_bytes),
                           publication_at_ns)
