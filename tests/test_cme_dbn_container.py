"""Synthetic independent-byte and integrated-normalizer controls; no file inputs."""
from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
import hashlib
import unittest

from ingest import cme_dbn_container as reader
from ingest import cme_databento_trades as trade

DAY = 1_791_158_400_000_000_000  # 2026-10-05T00:00:00Z
DAY_NS = 86_400_000_000_000
ACQUIRED = DAY + 2 * DAY_NS
META_K = ACQUIRED + 1_000
QUALIFIED = ACQUIRED + 2_000
PUBLISHED = ACQUIRED + 3_000


def fixed(text, width):
    raw = text.encode("ascii")
    if len(raw) >= width:
        raise ValueError("synthetic text too long")
    return raw + bytes(width - len(raw))


def native_record(*, size=1301, price=1_000_000_000, instrument=42,
                  event=DAY + 5, recv=DAY + 10, side="B", flags=128,
                  depth=0, delta=-1, sequence=7, action="T",
                  publisher=1, rtype=0, words=12):
    # Field placement is independently explicit, not production struct packing.
    b = bytearray(48)
    b[0], b[1] = words, rtype
    b[2:4] = publisher.to_bytes(2, "little")
    b[4:8] = instrument.to_bytes(4, "little")
    b[8:16] = event.to_bytes(8, "little")
    b[16:24] = price.to_bytes(8, "little", signed=True)
    b[24:28] = size.to_bytes(4, "little")
    b[28], b[29], b[30], b[31] = ord(action), ord(side), flags, depth
    b[32:40] = recv.to_bytes(8, "little")
    b[40:44] = delta.to_bytes(4, "little", signed=True)
    b[44:48] = sequence.to_bytes(4, "little")
    return bytes(b)


DEFAULT_MAPPINGS = (("MNQZ6", ((20261005, 20261006, "42"),)),)


def container(rows=(), *, dataset="GLBX.MDP3", schema=4, start=DAY,
              end=DAY + DAY_NS, limit=0, stype_in=1, stype_out=0,
              ts_out=0, width=71, reserved=None, schema_definition=0,
              symbols=("MNQZ6",), partial=(), not_found=(),
              mappings=DEFAULT_MAPPINGS):
    # Encoder is test-only; literal golden tests below independently fix bytes.
    b = bytearray()
    b += fixed(dataset, 16)
    b += schema.to_bytes(2, "little")
    for value in (start, end, limit):
        b += value.to_bytes(8, "little")
    b += bytes((stype_in, stype_out, ts_out))
    b += width.to_bytes(2, "little")
    b += bytes(53) if reserved is None else reserved
    b += schema_definition.to_bytes(4, "little")
    for values in (symbols, partial, not_found):
        b += len(values).to_bytes(4, "little")
        for text in values:
            b += fixed(text, width)
    b += len(mappings).to_bytes(4, "little")
    for raw_symbol, intervals in mappings:
        b += fixed(raw_symbol, width)
        b += len(intervals).to_bytes(4, "little")
        for left, right, symbol in intervals:
            b += left.to_bytes(4, "little") + right.to_bytes(4, "little")
            b += fixed(symbol, width)
    b += bytes((-len(b)) % 8)
    return b"DBN\x03" + len(b).to_bytes(4, "little") + bytes(b) + b"".join(rows)


def edit_uint(data, offset, size, value):
    b = bytearray(data)
    b[offset:offset + size] = value.to_bytes(size, "little")
    return bytes(b)


def evidence(name, kind, known=DAY, digest=None):
    return trade.EvidenceRef(name, digest or hashlib.sha256(name.encode()).hexdigest(),
                             known, kind)


def artifact(data, **changes):
    first = 8 + int.from_bytes(data[4:8], "little")
    a = trade.ArtifactBinding(
        "synthetic-container", hashlib.sha256(data).hexdigest(), len(data), first,
        "fixture", ACQUIRED,
        evidence("synthetic-header-metadata", "dbn_metadata_declaration", META_K,
                 hashlib.sha256(data[:first]).hexdigest()),
        evidence("synthetic-normalization-label", "normalization_provenance_declaration",
                 DAY), "synthetic-only-current-schema")
    return replace(a, **changes)


def mapping(*, instrument=42, symbol="MNQZ6", start="2026-10-05",
            end="2026-10-06", evidence_known=DAY):
    definition = trade.DefinitionBinding(
        evidence("synthetic-definition-" + symbol, "dbn_instrument_definition",
                 evidence_known),
        evidence("synthetic-tick-" + symbol, "dbn_instrument_definition",
                 evidence_known),
        "GLBX.MDP3", 1, instrument, symbol, "MNQ", "F", "FUT",
        DAY - DAY_NS, DAY + 3 * DAY_NS, DAY - 10, DAY - 5,
        250_000_000, 1_000_000_000, 2_000_000_000, 1_000_000_000)
    return trade.DatedMapping(
        "GLBX.MDP3", 1, instrument, symbol, start, end,
        evidence("synthetic-mapping-" + symbol, "symbol_mapping_interval",
                 evidence_known), definition)


def normalize(data, *, a=None, maps=None, q=QUALIFIED, p=PUBLISHED,
              semantics="half_open_query_ts_recv", limits=reader.Limits()):
    return reader.normalize_container(
        data, artifact(data) if a is None else a,
        (mapping(),) if maps is None else maps, q, p,
        metadata_range_semantics=semantics, limits=limits)


class ContainerControls(unittest.TestCase):
    def refuse(self, function, code):
        with self.assertRaises(reader.ContainerError) as caught:
            function()
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_literal_empty_golden_128_bytes(self):
        golden = bytes.fromhex(
            "44424e0378000000"
            "474c42582e4d44503300000000000000"
            "0400"
            "0000000000000000"
            "ffffffffffffffff"
            "0000000000000000"
            "0100004700"
            + "00" * 53 + "00000000" * 5)
        self.assertEqual(len(golden), 128)
        self.assertEqual(golden, container(start=0, end=(1 << 64) - 1,
                                          symbols=(), mappings=()))
        parsed = reader.parse_container(golden)
        self.assertEqual(parsed.first_record_offset, 128)
        self.assertEqual(parsed.metadata.payload_length, 120)
        self.assertEqual(parsed.records, ())
        self.assertEqual(parsed.metadata.symbols, ())
        self.assertIsNone(parsed.to_dict()["metadata"]["queryLimit"])
        self.assertFalse(parsed.to_dict()["publicConsumerEligible"])

    def test_default_metadata_layout_and_absolute_offsets(self):
        data = container((native_record(), native_record(size=501)))
        parsed = reader.parse_container(data)
        self.assertEqual(len(data), 456)
        self.assertEqual(parsed.metadata.payload_length, 352)
        self.assertEqual(parsed.first_record_offset, 360)
        self.assertEqual(parsed.metadata.padding_bytes, 7)
        self.assertEqual([x.offset for x in parsed.records], [360, 408])
        self.assertEqual(data[24:26], b"\x04\0")
        self.assertEqual(data[50:55], b"\x01\0\0G\0")
        self.assertEqual(int.from_bytes(data[112:116], "little"), 1)
        self.assertEqual(int.from_bytes(data[270:274], "little"), 1)
        self.assertEqual(int.from_bytes(data[274:278], "little"), 20261005)
        self.assertEqual(data[282:285], b"42\0")

    def test_complete_container_digest_and_metadata_digest_are_distinct(self):
        data = container((native_record(),))
        parsed = reader.parse_container(data)
        self.assertEqual(parsed.sha256, hashlib.sha256(data).hexdigest())
        self.assertEqual(parsed.metadata_region_sha256,
                         hashlib.sha256(data[:360]).hexdigest())
        self.assertNotEqual(parsed.sha256, parsed.metadata_region_sha256)

    def test_nondefault_field_driven_width_50(self):
        data = container((native_record(),), width=50)
        parsed = reader.parse_container(data)
        self.assertEqual(parsed.metadata.symbol_width, 50)
        self.assertEqual(parsed.first_record_offset, 296)
        result = normalize(data).to_dict()
        self.assertEqual(result["normalizer"]["grossReportedQuantity"], "1301")
        self.assertEqual(result["normalizer"]["observations"][0]["sourcePosition"]
                         ["uncompressedByteOffset"], "296")

    def test_width_one_empty_container(self):
        parsed = reader.parse_container(container(width=1, symbols=(), mappings=()))
        self.assertEqual(parsed.metadata.symbol_width, 1)
        self.assertFalse(parsed.records)

    def test_empty_bridge_explicitly_refuses(self):
        data = container(symbols=(), mappings=())
        self.refuse(lambda: normalize(data), "empty_container_normalization_unsupported")

    def test_mandatory_explicit_query_range_semantics(self):
        data = container((native_record(),))
        with self.assertRaises(TypeError):
            reader.normalize_container(data, artifact(data), (mapping(),),
                                       QUALIFIED, PUBLISHED)
        for value in ("split_file_inclusive", "unknown", None, 1):
            with self.subTest(value=value):
                self.refuse(lambda: normalize(data, semantics=value),
                            "unsupported_or_unknown_metadata_range_semantics")

    def test_split_single_timestamp_structural_parse_not_query_normalization(self):
        record = native_record(event=DAY, recv=DAY + 10)
        data = container((record,), start=DAY + 10, end=DAY + 10)
        self.assertEqual(len(reader.parse_container(data).records), 1)
        self.refuse(lambda: normalize(data), "capture_outside_declared_query_interval")

    def test_query_start_inclusive_end_exclusive_on_capture(self):
        at_start = container((native_record(recv=DAY, event=DAY - 1),))
        self.assertEqual(normalize(at_start).to_dict()["normalizer"]
                         ["uniqueObservations"], 1)
        at_end = container((native_record(recv=DAY + DAY_NS),))
        self.refuse(lambda: normalize(at_end), "capture_outside_declared_query_interval")
        before = container((native_record(recv=DAY - 1),))
        self.refuse(lambda: normalize(before), "capture_outside_declared_query_interval")

    def test_event_time_outside_query_preserved_without_sorting(self):
        rows = (native_record(event=DAY + DAY_NS + 1, recv=DAY + 10, size=2),
                native_record(event=DAY - 1, recv=DAY + 11, size=3))
        result = normalize(container(rows)).to_dict()["normalizer"]["observations"]
        self.assertEqual([x["nativeFields"]["ts_event"] for x in result],
                         [str(DAY + DAY_NS + 1), str(DAY - 1)])
        self.assertEqual([x["quantity"] for x in result], [2, 3])

    def test_null_end_and_zero_limit_are_not_empty_or_complete_market(self):
        data = container((native_record(),), end=(1 << 64) - 1, limit=0)
        out = normalize(data).to_dict()
        self.assertIsNone(out["container"]["metadata"]["declaredEndNs"])
        self.assertIsNone(out["container"]["metadata"]["queryLimit"])
        self.assertFalse(out["marketCompletenessVerified"])
        self.assertEqual(out["normalizer"]["uniqueObservations"], 1)

    def test_query_limit_count_consistency(self):
        data = container((native_record(), native_record()), limit=1)
        self.refuse(lambda: reader.parse_container(data),
                    "record_count_exceeds_declared_query_limit")

    def test_1301_is_quantity_not_order_count(self):
        out = normalize(container((native_record(size=1301),))).to_dict()
        row = out["normalizer"]["observations"][0]
        self.assertEqual(row["quantity"], 1301)
        self.assertEqual(row["quantityUnit"], "contracts")
        self.assertEqual(out["normalizer"]["uniqueObservations"], 1)
        self.assertIsNone(row["orderCount"])
        self.assertIsNone(row["nativeTradeId"])
        self.assertIsNone(row["nativeOrderId"])

    def test_same_sequence_and_economics_distinct_positions_retained(self):
        raw = native_record()
        out = normalize(container((raw, raw))).to_dict()["normalizer"]
        self.assertEqual(out["uniqueObservations"], 2)
        self.assertEqual(out["duplicates"], 0)
        self.assertEqual(out["grossReportedQuantity"], "2602")
        rows = out["observations"]
        self.assertEqual(rows[0]["nativeFields"], rows[1]["nativeFields"])
        self.assertNotEqual(rows[0]["observationId"], rows[1]["observationId"])
        self.assertEqual([x["sourceSequence"] for x in rows], ["7", "7"])
        self.assertEqual([x["sourcePosition"]["recordIndex"] for x in rows], [0, 1])

    def test_position_identity_uses_entire_container_not_record_region(self):
        raw = native_record()
        a = container((raw,), limit=0)
        b = container((raw,), limit=2)
        left, right = (normalize(x).to_dict()["normalizer"]["observations"][0]
                       for x in (a, b))
        self.assertEqual(left["recordSha256"], right["recordSha256"])
        self.assertNotEqual(left["sourceArtifactSha256"], right["sourceArtifactSha256"])
        self.assertNotEqual(left["observationId"], right["observationId"])

    def test_exact_partition_conservation_unknown_and_saturated_delta(self):
        data = container((native_record(size=1301, side="B"),
                          native_record(size=501, side="A", delta=(1 << 31) - 1),
                          native_record(size=300, side="N")))
        out = normalize(data).to_dict()["normalizer"]
        self.assertEqual(out["grossReportedQuantity"], "2102")
        self.assertEqual(out["sidePartitions"], {
            "buy": {"observations": 1, "quantity": "1301"},
            "sell": {"observations": 1, "quantity": "501"},
            "unknown": {"observations": 1, "quantity": "300"}})
        self.assertIsNone(out["observations"][1]["clocks"]["sourceSendingTimeExactNs"])
        self.assertEqual(out["observations"][0]["clocks"]["sourceSendingTimeExactNs"],
                         str(DAY + 11))

    def test_large_safe_integer_price_is_never_float_or_rounded(self):
        price = 9_007_199_250_000_000  # exact quarter-point multiple below 2**53
        out = normalize(container((native_record(price=price),))).to_dict()
        row = out["normalizer"]["observations"][0]
        self.assertIs(type(row["priceInt"]), int)
        self.assertEqual(row["priceInt"], price)
        self.assertEqual(row["nativeFields"]["price"], str(price))

    def test_reserved_quality_bits_preserved_without_qualification(self):
        data = container((native_record(flags=1 | 2 | 4 | 8 | 32),))
        out = normalize(data).to_dict()
        row = out["normalizer"]["observations"][0]
        self.assertEqual(row["nativeFields"]["flags"], 47)
        self.assertEqual(len(row["qualityExclusions"]), 5)
        self.assertFalse(out["publicConsumerEligible"])
        self.assertFalse(row["publicConsumerEligible"])

    def test_partial_and_not_found_metadata_not_completeness(self):
        data = container((native_record(),), symbols=("MNQZ6", "MNQH7"),
                         partial=("MNQZ6",), not_found=("MNQH7",))
        out = normalize(data).to_dict()
        self.assertEqual(out["metadataQuality"]["partialRequestedSymbols"], ["MNQZ6"])
        self.assertEqual(out["metadataQuality"]["notFoundRequestedSymbols"], ["MNQH7"])
        self.assertFalse(out["metadataQuality"]["absenceOfPartialFlagProvesCompleteness"])
        self.assertEqual(out["normalizer"]["grossReportedQuantity"], "1301")

    def test_record_for_not_found_symbol_refuses(self):
        data = container((native_record(),), not_found=("MNQZ6",))
        self.refuse(lambda: normalize(data), "record_for_not_found_symbol")

    def test_undeclared_partial_symbol_refuses(self):
        data = container((native_record(),), partial=("MNQH7",))
        self.refuse(lambda: normalize(data), "undeclared_partial_or_not_found_symbol")

    def test_partial_not_found_conflict_refuses(self):
        data = container((native_record(),), partial=("MNQZ6",), not_found=("MNQZ6",))
        self.refuse(lambda: normalize(data), "partial_and_not_found_conflict")

    def test_no_implicit_all_symbols_or_missing_mapping(self):
        data = container((native_record(),), symbols=(), mappings=())
        self.refuse(lambda: normalize(data), "explicit_requested_raw_symbols_required")
        data = container((native_record(),), mappings=())
        self.refuse(lambda: normalize(data), "missing_or_ambiguous_container_mapping")

    def test_mapping_raw_symbol_must_be_requested(self):
        data = container((native_record(),), symbols=("MNQH7",))
        self.refuse(lambda: normalize(data), "mapping_symbol_not_requested")

    def test_ambiguous_metadata_mapping_target_refuses(self):
        data = container((native_record(),), symbols=("MNQZ6", "MNQH7"),
                         mappings=DEFAULT_MAPPINGS +
                         (("MNQH7", ((20261005, 20261006, "42"),)),))
        self.refuse(lambda: normalize(data), "missing_or_ambiguous_container_mapping")

    def test_external_mapping_conflict_is_not_replaced_by_metadata(self):
        data = container((native_record(),))
        self.refuse(lambda: normalize(data, maps=(mapping(symbol="MNQH7"),)),
                    "external_mapping_conflicts_with_container_declaration")

    def test_metadata_does_not_supply_missing_external_definition(self):
        data = container((native_record(),))
        self.refuse(lambda: normalize(data, maps=()),
                    "normalizer_bounded_immutable_mappings_required")
        bad = replace(mapping(), definition=None)
        self.refuse(lambda: normalize(data, maps=(bad,)),
                    "normalizer_definition_binding_required")

    def test_dated_roll_same_instrument_id_and_exclusive_end(self):
        rows = (native_record(recv=DAY + DAY_NS - 1),
                native_record(recv=DAY + DAY_NS, event=DAY + DAY_NS))
        data = container(rows, end=DAY + 2 * DAY_NS,
                         symbols=("MNQZ6", "MNQH7"),
                         mappings=DEFAULT_MAPPINGS +
                         (("MNQH7", ((20261006, 20261007, "42"),)),))
        maps = (mapping(), mapping(symbol="MNQH7", start="2026-10-06", end="2026-10-07"))
        out = normalize(data, maps=maps).to_dict()["normalizer"]["observations"]
        self.assertEqual([x["instrument"]["rawSymbol"] for x in out], ["MNQZ6", "MNQH7"])
        self.assertEqual([x["instrument"]["indexDateUtc"] for x in out],
                         ["2026-10-05", "2026-10-06"])

    def test_missing_metadata_date_interval_refuses(self):
        data = container((native_record(recv=DAY + DAY_NS),),
                         end=DAY + 2 * DAY_NS)
        self.refuse(lambda: normalize(data), "missing_or_ambiguous_container_mapping")

    def test_missing_external_date_interval_remains_normalizer_refusal(self):
        data = container((native_record(),))
        out = normalize(data, maps=(mapping(start="2026-10-06",
                                           end="2026-10-07"),)).to_dict()
        self.assertEqual(out["status"], "refused_incomplete_normalizer_diagnostics")
        self.assertEqual(out["normalizer"]["refusal"]["code"],
                         "missing_or_ambiguous_dated_mapping")
        self.assertFalse(out["publicConsumerEligible"])

    def test_original_artifact_sha_size_and_first_offset_binding(self):
        data = container((native_record(),))
        for change in ({"sha256": "0" * 64}, {"byte_length": len(data) + 48},
                       {"first_record_offset": 0}):
            with self.subTest(change=change):
                self.refuse(lambda: normalize(data, a=artifact(data, **change)),
                            "original_container_binding_mismatch")

    def test_exact_metadata_prefix_evidence_digest_required(self):
        data = container((native_record(),))
        a = artifact(data)
        bad = replace(a, metadata_evidence=replace(a.metadata_evidence, sha256="0" * 64))
        self.refuse(lambda: normalize(data, a=bad), "metadata_prefix_digest_mismatch")

    def test_artifact_metadata_declaration_conflict(self):
        data = container((native_record(),))
        for change in ({"dataset": "OTHER"}, {"schema": "mbo"},
                       {"wire_version": 2}, {"ts_out": True},
                       {"compression": "zstd"}, {"input_symbol_type": "continuous"}):
            with self.subTest(change=change):
                self.refuse(lambda: normalize(data, a=artifact(data, **change)),
                            "artifact_metadata_declaration_conflict")

    def test_framing_knowledge_cannot_precede_acquisition(self):
        data = container((native_record(),))
        a = artifact(data)
        bad = replace(a, metadata_evidence=replace(a.metadata_evidence,
                                                  known_at_ns=ACQUIRED - 1))
        self.refuse(lambda: normalize(data, a=bad), "framing_knowledge_precedes_acquisition")

    def test_publication_gate_has_no_early_metadata_or_economic_output(self):
        result = normalize(container((native_record(),)))
        before = result.at_knowledge(PUBLISHED - 1)
        self.assertEqual(before, {
            "status": "unavailable_before_publication_knowledge",
            "publicConsumerEligible": False, "observations": [],
            "grossReportedQuantity": None})
        at = result.at_knowledge(PUBLISHED)
        self.assertEqual(at["normalizer"]["grossReportedQuantity"], "1301")
        self.assertEqual(at["normalizer"]["observations"][0]["clocks"]["availableAtNs"],
                         str(PUBLISHED))
        for invalid in (True, -1, (1 << 64) - 1, 1.0):
            with self.subTest(invalid=invalid):
                self.refuse(lambda: result.at_knowledge(invalid), "invalid_knowledge_cutoff")

    def test_definition_knowledge_and_publication_regression_refuse(self):
        data = container((native_record(),))
        self.refuse(lambda: normalize(data, maps=(mapping(evidence_known=PUBLISHED + 1),)),
                    "normalizer_knowledge_clock_chain_invalid")
        self.refuse(lambda: normalize(data, q=PUBLISHED, p=QUALIFIED),
                    "normalizer_knowledge_clock_chain_invalid")

    def test_source_event_after_acquisition_not_hidden_by_query_metadata(self):
        data = container((native_record(event=ACQUIRED + 1),))
        out = normalize(data).to_dict()
        self.assertEqual(out["normalizer"]["refusal"]["code"], "source_clock_after_acquisition")
        self.assertEqual(out["normalizer"]["uniqueObservations"], 0)
        self.assertEqual(out["status"], "refused_incomplete_normalizer_diagnostics")

    def test_negative_price_projection_is_refusal_not_native_corruption(self):
        data = container((native_record(price=-250_000_000),))
        self.assertEqual(reader.parse_container(data).records[0].raw.price, -250_000_000)
        out = normalize(data).to_dict()
        self.assertEqual(out["normalizer"]["refusal"]["category"], "projection")
        self.assertEqual(out["normalizer"]["refusal"]["code"], "unsupported_price_projection")

    def test_later_projection_failure_is_explicit_prefix_diagnostic(self):
        data = container((native_record(size=1301),
                          native_record(price=1_000_000_001, size=999)))
        out = normalize(data).to_dict()
        self.assertEqual(out["status"], "refused_incomplete_normalizer_diagnostics")
        self.assertEqual(out["normalizer"]["grossReportedQuantity"], "1301")
        self.assertEqual(out["normalizer"]["totalsScope"],
                         "successfully_retained_prefix_diagnostics_only")
        self.assertEqual(out["providedContainerRecords"], 2)
        self.assertEqual(out["normalizer"]["refusal"]["code"], "unsupported_tick_grid_projection")

    def test_historical_mode_retains_unverified_caller_provenance(self):
        data = container((native_record(),))
        out = normalize(data, a=artifact(data, mode="historical")).to_dict()
        self.assertEqual(out["clockAuthority"], "caller_supplied_unverified")
        self.assertEqual(out["normalizer"]["provenanceStatus"], "caller_supplied_unverified")
        self.assertFalse(out["exportAuthenticityVerified"])
        self.assertFalse(out["producerLibraryVersionAuthenticated"])
        self.assertFalse(out["normalizationEpochAuthenticated"])

    def test_live_mode_never_admitted(self):
        data = container((native_record(),))
        self.refuse(lambda: normalize(data, a=artifact(data, mode="live")),
                    "normalizer_unsupported_data_mode")

    def test_nested_component_scope_is_preserved(self):
        out = normalize(container((native_record(),))).to_dict()
        self.assertTrue(out["container"]["structuralFramingValidated"])
        self.assertFalse(out["normalizer"]["metadataFramingReaderImplemented"])
        self.assertFalse(out["normalizer"]["rightsVerified"])
        self.assertFalse(out["normalizer"]["publicConsumerEligible"])
        self.assertEqual(out["correctionCoverage"], "unsupported")
        self.assertIsNone(out["orderCount"])

    def test_returned_objects_cannot_mutate_sealed_views(self):
        data = container((native_record(),))
        parsed = reader.parse_container(data)
        with self.assertRaises(FrozenInstanceError):
            parsed.first_record_offset = 0
        view = parsed.to_dict()
        view["metadata"]["symbols"][0] = "FORGED"
        self.assertEqual(parsed.metadata.symbols, ("MNQZ6",))
        result = normalize(data)
        view = result.to_dict()
        view["normalizer"]["observations"][0]["quantity"] = 0
        view["publicConsumerEligible"] = True
        current = result.at_knowledge(PUBLISHED)
        self.assertEqual(current["normalizer"]["grossReportedQuantity"], "1301")
        self.assertEqual(current["normalizer"]["observations"][0]["quantity"], 1301)
        self.assertFalse(current["publicConsumerEligible"])

    def test_record_order_and_output_counts_use_original_positions(self):
        data = container((native_record(instrument=42, sequence=9),
                          native_record(instrument=42, sequence=1)))
        out = normalize(data).to_dict()
        self.assertEqual(out["providedContainerBytesConsumed"], len(data))
        self.assertEqual(out["normalizer"]["artifact"]["sha256"],
                         hashlib.sha256(data).hexdigest())
        self.assertEqual([x["sourceSequence"] for x in out["normalizer"]["observations"]],
                         ["9", "1"])
        self.assertEqual(out["normalizer"]["budgetedInputBytes"], 96)
        self.assertEqual(out["container"]["bytes"], 456)

    def test_bytes_only_input_and_short_preludes(self):
        for value in (bytearray(), memoryview(b"DBN"), "", None):
            with self.subTest(value=type(value).__name__):
                self.refuse(lambda: reader.parse_container(value),
                            "immutable_container_bytes_required")
        for length in range(8):
            with self.subTest(length=length):
                self.refuse(lambda: reader.parse_container(b"DBN\x03\0\0\0\0"[:length]),
                            "truncated_prelude")

    def test_compression_magic_and_signature_rejected_without_decompression(self):
        for prefix in (b"\x28\xb5\x2f\xfd", b"\x1f\x8b", b"BZh", b"\xfd7zXZ\0"):
            with self.subTest(prefix=prefix):
                self.refuse(lambda: reader.parse_container(prefix + bytes(128)),
                            "compressed_container_unsupported")
        self.refuse(lambda: reader.parse_container(b"JSON" + bytes(128)),
                    "unsupported_container_signature")

    def test_wrong_wire_schema_and_stypes(self):
        base = container()
        for version in (0, 1, 2, 4, 255):
            with self.subTest(version=version):
                self.refuse(lambda: reader.parse_container(edit_uint(base, 3, 1, version)),
                            "unsupported_dbn_wire_version")
        for schema in (0, 1, 3, 65535):
            with self.subTest(schema=schema):
                self.refuse(lambda: reader.parse_container(container(schema=schema)),
                            "unsupported_or_mixed_schema")
        for left, right in ((0, 0), (255, 0), (1, 1), (3, 0)):
            with self.subTest(stypes=(left, right)):
                self.refuse(lambda: reader.parse_container(container(stype_in=left,
                                                                     stype_out=right)),
                            "unsupported_symbol_types")

    def test_wrong_dataset_ts_out_and_invalid_boolean(self):
        self.refuse(lambda: reader.parse_container(container(dataset="XNAS.ITCH")),
                    "unsupported_dataset")
        self.refuse(lambda: reader.parse_container(container(ts_out=1)),
                    "appended_ts_out_unsupported")
        self.refuse(lambda: reader.parse_container(container(ts_out=2)),
                    "invalid_ts_out_encoding")

    def test_metadata_length_bounds_no_record_bytes_borrowed(self):
        base = container((native_record(),))
        self.refuse(lambda: reader.parse_container(edit_uint(base, 4, 4, 112)),
                    "metadata_length_below_fixed_minimum")
        self.refuse(lambda: reader.parse_container(edit_uint(base, 4, 4, 351)),
                    "canonical_metadata_alignment_required")
        self.refuse(lambda: reader.parse_container(edit_uint(base, 4, 4, 4096)),
                    "truncated_declared_metadata")
        # Empty metadata has only 12 bytes after its symbol count, but body has
        # many bytes. The count must not borrow those first-record bytes.
        empty_with_records = container((native_record(),) * 4, symbols=(), mappings=())
        bad = edit_uint(empty_with_records, 112, 4, 3)
        self.refuse(lambda: reader.parse_container(bad), "truncated_symbols")

    def test_schema_definition_and_reserved_are_explicit_profile_refusals(self):
        error = self.refuse(lambda: reader.parse_container(container(
            reserved=b"\x20" + bytes(52))), "canonical_zero_reserved_required")
        self.assertEqual(error.category, "profile")
        self.refuse(lambda: reader.parse_container(container(schema_definition=4)),
                    "schema_definition_unsupported")

    def test_string_termination_padding_and_charset(self):
        base = container()
        b = bytearray(base)
        b[116:187] = b"A" * 71
        self.refuse(lambda: reader.parse_container(bytes(b)), "canonical_nul_required_symbols")
        b = bytearray(base)
        b[122 + 1] = 1  # after MNQZ6's NUL
        self.refuse(lambda: reader.parse_container(bytes(b)),
                    "canonical_string_padding_required_symbols")
        b = bytearray(base)
        b[116] = 255
        self.refuse(lambda: reader.parse_container(bytes(b)), "unsupported_text_symbols")

    def test_unknown_width_duplicate_arrays_and_mapping_rows(self):
        self.refuse(lambda: reader.parse_container(edit_uint(container(), 53, 2, 0)),
                    "unsupported_symbol_width")
        self.refuse(lambda: reader.parse_container(container(symbols=("MNQZ6", "MNQZ6"))),
                    "duplicate_symbols_declaration")
        self.refuse(lambda: reader.parse_container(container(mappings=DEFAULT_MAPPINGS * 2)),
                    "duplicate_mapping_raw_symbol")

    def test_mapping_dates_order_and_numeric_target(self):
        for interval, code in (
            ((20260230, 20261006, "42"), "invalid_interval_start"),
            ((20261006, 20261005, "42"), "invalid_mapping_interval"),
            ((20261005, 20261006, "042"), "unsupported_instrument_id_mapping"),
            ((20261005, 20261006, "-1"), "unsupported_instrument_id_mapping"),
            ((20261005, 20261006, str(1 << 32)), "unsupported_instrument_id_mapping"),
        ):
            with self.subTest(interval=interval):
                self.refuse(lambda: reader.parse_container(container(
                    mappings=(("MNQZ6", (interval,)),))), code)
        self.refuse(lambda: reader.parse_container(container(mappings=(
            ("MNQZ6", ((20261005, 20261007, "42"), (20261006, 20261008, "43"))),))),
            "overlapping_or_unsorted_mapping_intervals")

    def test_exact_metadata_padding_and_no_extra_zero_tail(self):
        base = container()
        b = bytearray(base)
        b[359] = 1
        self.refuse(lambda: reader.parse_container(bytes(b)),
                    "canonical_zero_metadata_padding_required")
        # Extending declared metadata by a full zero block is not minimal padding.
        expanded = edit_uint(base + bytes(8), 4, 4, 360)
        self.refuse(lambda: reader.parse_container(expanded),
                    "canonical_metadata_tail_length_required")

    def test_body_truncation_trailing_and_concatenated_files(self):
        data = container((native_record(),))
        for tail in (data[:-1], data + b"\0", data + bytes(8)):
            with self.subTest(length=len(tail)):
                self.refuse(lambda: reader.parse_container(tail),
                            "record_region_truncated_or_trailing_bytes")
        self.refuse(lambda: reader.parse_container(data + bytes(48)), "record_header_length_not_12")
        # Append a canonical empty file (128B): not a second allowed container.
        self.refuse(lambda: reader.parse_container(data + container(symbols=(), mappings=())),
                    "record_region_truncated_or_trailing_bytes")

    def test_mixed_record_and_ts_out_header_refused(self):
        for change, code in (
            ({"rtype": 160}, "record_unsupported_rtype"),
            ({"publisher": 2}, "record_unsupported_publisher"),
            ({"words": 14}, "record_header_length_not_12"),
            ({"action": "F"}, "record_unsupported_action"),
            ({"side": "X"}, "record_unknown_side"),
        ):
            with self.subTest(change=change):
                self.refuse(lambda: reader.parse_container(container((native_record(**change),))),
                            code)

    def test_native_undefined_values_and_zero_quantity(self):
        for change, code in (
            ({"price": (1 << 63) - 1}, "record_undefined_price"),
            ({"size": (1 << 32) - 1}, "record_undefined_quantity"),
            ({"size": 0}, "record_zero_quantity"),
            ({"event": (1 << 64) - 1}, "record_undefined_event_time"),
            ({"recv": (1 << 64) - 1}, "record_undefined_capture_time"),
        ):
            with self.subTest(change=change):
                self.refuse(lambda: reader.parse_container(container((native_record(**change),))),
                            code)

    def test_later_bad_record_refuses_whole_parse_before_result(self):
        data = container((native_record(), native_record(rtype=160)))
        error = self.refuse(lambda: reader.parse_container(data), "record_unsupported_rtype")
        self.assertEqual(error.offset, 408)
        self.refuse(lambda: normalize(data), "record_unsupported_rtype")

    def test_container_metadata_record_and_string_caps(self):
        data = container((native_record(), native_record()))
        self.refuse(lambda: reader.parse_container(data, reader.Limits(
            max_container_bytes=len(data) - 1)), "container_byte_cap")
        self.refuse(lambda: reader.parse_container(data, reader.Limits(
            max_metadata_bytes=351)), "metadata_byte_cap")
        self.refuse(lambda: reader.parse_container(data, reader.Limits(
            max_records=1)), "record_count_cap")
        self.refuse(lambda: reader.parse_container(data, reader.Limits(
            max_metadata_strings=2)), "metadata_string_cap")

    def test_mapping_array_and_total_interval_caps(self):
        data = container()
        self.refuse(lambda: reader.parse_container(edit_uint(data, 195, 4, 65)),
                    "mappings_count_cap")
        self.refuse(lambda: reader.parse_container(edit_uint(data, 270, 4, 513)),
                    "intervals_count_cap")
        data = container(symbols=("MNQZ6", "MNQH7"), mappings=DEFAULT_MAPPINGS +
                         (("MNQH7", ((20261006, 20261007, "43"),)),))
        self.refuse(lambda: reader.parse_container(data, reader.Limits(max_intervals=1)),
                    "mapping_interval_total_cap")

    def test_huge_count_and_overlong_metadata_refuse_without_allocation(self):
        data = container()
        self.refuse(lambda: reader.parse_container(edit_uint(data, 112, 4, (1 << 32) - 1)),
                    "symbols_count_cap")
        self.refuse(lambda: reader.parse_container(edit_uint(data, 4, 4, (1 << 32) - 1)),
                    "metadata_byte_cap")

    def test_output_byte_cap_and_exact_boundary(self):
        data = container((native_record(),))
        out = normalize(data)
        self.refuse(lambda: normalize(data, limits=reader.Limits(
            max_output_bytes=out.serialized_bytes - 1)), "serialized_output_cap")
        same = normalize(data, limits=reader.Limits(max_output_bytes=out.serialized_bytes))
        self.assertEqual(out.to_dict(), same.to_dict())

    def test_invalid_limits_do_not_disable_bounds(self):
        for key, value in (("max_records", True), ("max_records", 4097),
                           ("max_container_bytes", 1), ("max_symbol_width", 257),
                           ("max_mappings", 0), ("max_output_bytes", 0)):
            with self.subTest(key=key, value=value):
                self.refuse(lambda: reader.parse_container(container(),
                    replace(reader.Limits(), **{key: value})), "invalid_" + key)


if __name__ == "__main__":
    unittest.main(verbosity=2)
