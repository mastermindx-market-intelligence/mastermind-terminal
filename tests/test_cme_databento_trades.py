"""Synthetic contract falsifiers. No market file, SDK, network, or fixture download.

The golden byte vector and expected fields below are literal and independent of
the implementation's struct. Other test records use a local explicit wire format.
"""
from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from datetime import date
import json
import struct
import unittest

from ingest.cme_databento_trades import (
    ArtifactBinding, BatchResult, DatedMapping, DefinitionBinding, EvidenceRef,
    Limits, NormalizationError, Normalizer, RecordBlock, decode_record,
    normalize_batch,
)

DAY = 86_400_000_000_000
D0 = (date(2026, 10, 5) - date(1970, 1, 1)).days * DAY
ACQUIRED = D0 + 3 * DAY
QUALIFIED = D0 + 4 * DAY
PUBLISHED = D0 + 5 * DAY
SHA = "a" * 64
OTHER_SHA = "b" * 64
PX = 23_000_250_000_000
TICK = 250_000_000
MAX_PRICE = (1 << 63) - 1
MAX_SIZE = (1 << 32) - 1
MAX_TIME = (1 << 64) - 1


def evidence(name="mapping", kind="symbol_mapping_interval", known=ACQUIRED):
    return EvidenceRef("synthetic-" + name, "c" * 64, known, kind)


def artifact(**changes):
    a = ArtifactBinding(
        artifact_id="synthetic-export",
        sha256=SHA,
        byte_length=48 * 4096,
        first_record_offset=0,
        mode="fixture",
        acquired_at_ns=ACQUIRED,
        metadata_evidence=evidence("metadata", "dbn_metadata_declaration"),
        normalization_evidence=evidence(
            "normalization", "normalization_provenance_declaration"),
        normalization_label="synthetic-export-normalization-no-market-data",
    )
    return replace(a, **changes)


def mapping(instrument_id=42, symbol="MNQZ26", start="2026-10-05",
            end="2026-10-06", **changes):
    left = (date.fromisoformat(start) - date(1970, 1, 1)).days * DAY
    right = (date.fromisoformat(end) - date(1970, 1, 1)).days * DAY
    d = DefinitionBinding(
        evidence=evidence("definition", "dbn_instrument_definition"),
        tick_evidence=evidence("tick", "dbn_instrument_definition"),
        dataset="GLBX.MDP3", publisher_id=1, instrument_id=instrument_id,
        raw_symbol=symbol, product="MNQ", instrument_class="F", security_type="FUT",
        effective_from_ns=left, effective_until_ns=right,
        source_event_ns=left - 100, source_recv_ns=left - 10,
        tick_size_int=TICK, price_scale=1_000_000_000,
        contract_multiplier_int=2_000_000_000,
        contract_multiplier_scale=1_000_000_000,
    )
    m = DatedMapping(
        "GLBX.MDP3", 1, instrument_id, symbol, start, end,
        evidence("mapping"), d, TICK)
    return replace(m, **changes)


def wire(**changes):
    v = dict(length=12, rtype=0, publisher=1, instrument=42,
             event=D0 + 1_000_000_000, price=PX, size=1301,
             action=b"T", side=b"B", flags=128, depth=0,
             recv=D0 + 1_000_000_100, delta=25, sequence=71)
    v.update(changes)
    return struct.pack(
        "<BBHIQqIccBBQiI", v["length"], v["rtype"], v["publisher"],
        v["instrument"], v["event"], v["price"], v["size"],
        v["action"], v["side"], v["flags"], v["depth"],
        v["recv"], v["delta"], v["sequence"])


def block(offset=0, data=None, sha=SHA, **changes):
    return RecordBlock(sha, offset, wire(**changes) if data is None else data)


def batch(*blocks, a=None, maps=None, limits=Limits(), qualification=QUALIFIED,
          publication=PUBLISHED):
    return normalize_batch(
        artifact() if a is None else a,
        (mapping(),) if maps is None else maps,
        tuple(blocks), qualification, publication, limits)


class ContractCase(unittest.TestCase):
    def refusal(self, result, code, count=0):
        self.assertEqual(result.refusal.code, code)
        self.assertEqual(len(result.observations), count)
        doc = result.to_dict()
        self.assertEqual(doc["status"], "refused_incomplete_diagnostics")
        self.assertFalse(doc["publicConsumerEligible"])
        self.assertEqual(doc["totalsScope"],
                         "successfully_retained_prefix_diagnostics_only")
        return doc

    def error(self, code, fn):
        with self.assertRaises(NormalizationError) as cm:
            fn()
        self.assertEqual(cm.exception.code, code)


class WireTests(ContractCase):
    def test_literal_golden_vector_all_field_offsets(self):
        # Literal bytes; deliberately distinct patterns for every field.
        literal = bytes.fromhex(
            "0c000100040302010807060504030201"
            "01000000010000004433221154428107"
            "0a09060504030201efffffffd4c3b2a1")
        self.assertEqual(len(literal), 48)
        r = decode_record(literal)
        self.assertEqual(
            (r.length_words, r.rtype, r.publisher_id, r.instrument_id,
             r.ts_event, r.price, r.size, r.action, r.side, r.flags, r.depth,
             r.ts_recv, r.ts_in_delta, r.sequence),
            (12, 0, 1, 0x01020304, 0x0102030405060708,
             4_294_967_297, 0x11223344, "T", "B", 0x81, 7,
             0x010203040506090A, -17, 0xA1B2C3D4))
        self.assertEqual(r.to_dict()["price"], "4294967297")

    def test_exact_48_bytes_rejects_truncated_extended_framed(self):
        for n in (0, 47, 49, 56, 96):
            with self.subTest(bytes=n):
                self.error("record_must_be_48_bytes",
                           lambda n=n: decode_record(b"x" * n))

    def test_immutable_binary_input_only(self):
        for value in (bytearray(wire()), memoryview(wire()), {},
                      '{"price":23000.25}', 1.0):
            with self.subTest(kind=type(value).__name__):
                self.error("immutable_bytes_required",
                           lambda value=value: decode_record(value))

    def test_wrong_header_word_length(self):
        self.refusal(batch(block(length=14)), "header_length_not_12")

    def test_unsupported_schema_record_types(self):
        for rtype in (1, 10, 18, 19, 160, 177):
            with self.subTest(rtype=rtype):
                self.refusal(batch(block(rtype=rtype)), "unsupported_rtype")

    def test_wrong_publisher(self):
        self.refusal(batch(block(publisher=2)), "unsupported_publisher")

    def test_order_actions_are_not_trade_or_busts(self):
        for action in (b"A", b"M", b"C", b"R", b"F", b"N", b"\xff"):
            with self.subTest(action=action):
                self.refusal(batch(block(action=action)), "unsupported_action")

    def test_unknown_aggressor_enum_is_refused(self):
        self.refusal(batch(block(side=b"Z")), "unknown_side")

    def test_undefined_native_sentinels(self):
        for field, value, code in (
            ("price", MAX_PRICE, "undefined_price"),
            ("size", MAX_SIZE, "undefined_quantity"),
            ("event", MAX_TIME, "undefined_event_time"),
            ("recv", MAX_TIME, "undefined_capture_time"),
        ):
            with self.subTest(field=field):
                self.refusal(batch(block(**{field: value})), code)

    def test_zero_quantity_is_not_a_trade(self):
        self.refusal(batch(block(size=0)), "zero_quantity")

    def test_negative_zero_unsafe_price_fail_projection_not_native_corruption(self):
        for price in (-TICK, 0, 9_007_199_500_000_000):
            with self.subTest(price=price):
                self.assertEqual(decode_record(wire(price=price)).price, price)
                r = batch(block(price=price))
                self.refusal(r, "unsupported_price_projection")
                self.assertEqual(r.refusal.category, "projection")

    def test_off_tick_execution_is_not_rounded(self):
        native = PX + 1
        self.assertEqual(decode_record(wire(price=native)).price, native)
        self.refusal(batch(block(price=native)), "unsupported_tick_grid_projection")

    def test_exact_large_safe_price_and_quantity(self):
        price = 9_007_199_250_000_000
        r = batch(block(price=price, size=4_294_967_294))
        self.assertIsNone(r.refusal)
        row = r.to_dict()["observations"][0]
        self.assertEqual(row["priceInt"], price)
        self.assertEqual(row["nativeFields"]["price"], "9007199250000000")
        self.assertEqual(row["quantity"], 4_294_967_294)
        self.assertEqual(r.to_dict()["grossReportedQuantity"], "4294967294")
        self.assertNotIsInstance(row["priceInt"], float)

    def test_depth_is_preserved_without_invented_zero_requirement(self):
        r = batch(block(depth=255))
        self.assertIsNone(r.refusal)
        self.assertEqual(r.observations[0].raw.depth, 255)


class EconomicsIdentityTests(ContractCase):
    def test_1301_means_one_observation_of_1301_contracts_not_orders(self):
        r = batch(block(size=1301))
        doc = r.to_dict()
        self.assertEqual(doc["uniqueObservations"], 1)
        self.assertEqual(doc["grossReportedQuantity"], "1301")
        row = doc["observations"][0]
        self.assertEqual(row["quantity"], 1301)
        self.assertEqual(row["quantityUnit"], "contracts")
        self.assertIsNone(row["orderCount"])
        self.assertIsNone(row["nativeOrderId"])
        self.assertIsNone(row["nativeTradeId"])
        self.assertEqual(row["volumeMeaning"], "gross_as_reported")
        self.assertEqual(row["correctionCoverage"], "unsupported")
        self.assertFalse(row["publicConsumerEligible"])

    def test_distinct_positions_identical_packet_sequence_economics_are_retained(self):
        r = batch(block(0), block(48))
        doc = r.to_dict()
        self.assertEqual(doc["uniqueObservations"], 2)
        self.assertEqual(doc["duplicates"], 0)
        self.assertEqual(doc["grossReportedQuantity"], "2602")
        a, b = doc["observations"]
        self.assertEqual(a["nativeFields"], b["nativeFields"])
        self.assertEqual(a["sourceSequence"], "71")
        self.assertNotEqual(a["observationId"], b["observationId"])
        self.assertEqual(a["identityKind"], "artifact_position")

    def test_exact_physical_replay_is_idempotent_and_does_not_reorder(self):
        first, second = block(0, size=7), block(48, size=11)
        r = batch(first, second, first)
        doc = r.to_dict()
        self.assertEqual(doc["grossReportedQuantity"], "18")
        self.assertEqual(doc["attempts"], 3)
        self.assertEqual(doc["duplicates"], 1)
        self.assertEqual(doc["budgetedInputBytes"], 144)
        self.assertEqual([x.source_offset for x in r.observations], [0, 48])

    def test_conflicting_position_refuses_and_preserves_diagnostic_prefix(self):
        r = batch(block(0, size=7), block(0, size=8), block(48, size=9))
        doc = self.refusal(r, "conflicting_artifact_position", 1)
        self.assertEqual(doc["grossReportedQuantity"], "7")
        self.assertEqual(doc["unconsumedSuppliedRecords"], 1)

    def test_conflict_is_identity_failure_even_if_second_header_is_invalid(self):
        r = batch(block(0), block(0, rtype=160))
        self.refusal(r, "conflicting_artifact_position", 1)

    def test_packet_sequence_reuse_and_wrap_are_not_identity_or_continuity(self):
        r = batch(block(0, sequence=0xFFFFFFFF, size=1),
                  block(48, sequence=0, size=2),
                  block(96, sequence=0, size=3))
        self.assertIsNone(r.refusal)
        self.assertEqual(r.to_dict()["grossReportedQuantity"], "6")
        self.assertEqual([x.raw.sequence for x in r.observations],
                         [0xFFFFFFFF, 0, 0])
        self.assertEqual(r.to_dict()["artifactCoverage"], "unverified_partial_or_unknown")

    def test_new_physical_positions_cannot_be_resorted(self):
        r = batch(block(48), block(0))
        self.refusal(r, "source_position_order_regression", 1)

    def test_no_cross_artifact_merge_even_for_identical_bytes(self):
        r = batch(block(0), block(48, sha=OTHER_SHA))
        self.refusal(r, "cross_artifact_input_refused", 1)

    def test_exact_side_and_quantity_conservation(self):
        r = batch(block(0, size=1301, side=b"B"),
                  block(48, size=501, side=b"A"),
                  block(96, size=300, side=b"N"))
        d = r.to_dict()
        self.assertEqual(d["grossReportedQuantity"], "2102")
        self.assertEqual(d["sidePartitions"], {
            "buy": {"observations": 1, "quantity": "1301"},
            "sell": {"observations": 1, "quantity": "501"},
            "unknown": {"observations": 1, "quantity": "300"},
        })
        self.assertEqual(d["observations"][2]["sideEvidence"], "unknown")
        self.assertNotIn("responses", d)
        self.assertNotIn("cancellations", d)
        self.assertNotIn("absorption", d)

    def test_result_and_deep_bindings_are_immutable(self):
        r = batch(block())
        with self.assertRaises(FrozenInstanceError):
            r.observations[0].raw.size = 9
        with self.assertRaises(FrozenInstanceError):
            r.observations[0].mapping.definition.tick_size_int = 1
        snapshot = r.to_dict()
        snapshot["observations"][0]["quantity"] = 9
        snapshot["sidePartitions"]["buy"]["quantity"] = "9"
        self.assertEqual(r.to_dict()["observations"][0]["quantity"], 1301)
        self.assertEqual(r.to_dict()["grossReportedQuantity"], "1301")


class ClockQualityTests(ContractCase):
    def test_negative_sender_delta_is_valid_and_unadjusted(self):
        r = batch(block(delta=-17))
        row = r.observations[0]
        self.assertEqual(row.source_sending_time_ns, row.raw.ts_recv + 17)
        self.assertEqual(row.raw.ts_in_delta, -17)
        self.assertEqual(row.quality_exclusions, ())

    def test_saturated_sender_delta_has_no_exact_derived_time(self):
        r = batch(block(0, delta=-(1 << 31), size=2),
                  block(48, delta=(1 << 31) - 1, size=3))
        self.assertEqual(r.to_dict()["grossReportedQuantity"], "5")
        for row in r.observations:
            self.assertIsNone(row.source_sending_time_ns)
            self.assertIn("source_sending_time_unavailable_saturated_delta",
                          row.quality_exclusions)

    def test_nonmonotone_native_event_clock_is_not_sorted_or_rewritten(self):
        r = batch(block(0, event=D0 + 200, size=2),
                  block(48, event=D0 + 100, size=3))
        self.assertIsNone(r.refusal)
        self.assertEqual([x.raw.ts_event for x in r.observations],
                         [D0 + 200, D0 + 100])
        self.assertEqual([x.source_offset for x in r.observations], [0, 48])

    def test_capture_is_not_relabelled_mastermind_live_receipt(self):
        r = batch(block(), a=artifact(mode="historical"))
        d = r.to_dict()
        self.assertEqual(d["provenanceStatus"], "caller_supplied_unverified")
        self.assertFalse(d["rightsVerified"])
        self.assertFalse(d["metadataFramingReaderImplemented"])
        clocks = d["observations"][0]["clocks"]
        self.assertEqual(clocks["vendorCaptureNs"], str(D0 + 1_000_000_100))
        self.assertEqual(clocks["acquiredAtNs"], str(ACQUIRED))
        self.assertEqual(clocks["qualificationAtNs"], str(QUALIFIED))
        self.assertEqual(clocks["publicationAtNs"], str(PUBLISHED))
        self.assertNotIn("liveReceivedAtNs", clocks)

    def test_fixture_mode_is_explicitly_synthetic(self):
        d = batch(block()).to_dict()
        self.assertEqual(d["provenanceStatus"], "synthetic")
        self.assertEqual(d["observations"][0]["clocks"]["clockAuthority"], "synthetic")

    def test_source_event_or_capture_after_acquisition_refuses(self):
        for name in ("event", "recv"):
            with self.subTest(clock=name):
                self.refusal(batch(block(**{name: ACQUIRED + 1})),
                             "source_clock_after_acquisition")

    def test_qualification_requires_all_dependency_knowledge(self):
        m = mapping(evidence=evidence(known=QUALIFIED + 1))
        self.error("knowledge_clock_chain_invalid",
                   lambda: batch(block(), maps=(m,)))
        late_def = replace(mapping().definition,
                           tick_evidence=evidence("tick", "dbn_instrument_definition",
                                                  QUALIFIED + 1))
        self.error("knowledge_clock_chain_invalid",
                   lambda: batch(block(), maps=(mapping(definition=late_def),)))

    def test_metadata_and_acquisition_knowledge_cannot_be_backdated(self):
        for a in (
            artifact(acquired_at_ns=QUALIFIED + 1),
            artifact(metadata_evidence=evidence(
                "metadata", "dbn_metadata_declaration", QUALIFIED + 1)),
            artifact(normalization_evidence=evidence(
                "normalization", "normalization_provenance_declaration",
                QUALIFIED + 1)),
        ):
            with self.subTest(binding=a):
                self.error("knowledge_clock_chain_invalid", lambda a=a: batch(block(), a=a))

    def test_publication_cannot_precede_qualification(self):
        self.error("knowledge_clock_chain_invalid",
                   lambda: batch(block(), publication=QUALIFIED - 1))

    def test_no_numerical_cutoff_view_before_publication_or_known_mapping(self):
        r = batch(block())
        hidden = r.at_knowledge(PUBLISHED - 1)
        self.assertEqual(hidden["observations"], [])
        self.assertIsNone(hidden["grossReportedQuantity"])
        self.assertNotIn("nativeFields", json.dumps(hidden))
        admitted = r.at_knowledge(PUBLISHED)
        self.assertEqual(admitted["grossReportedQuantity"], "1301")
        self.assertEqual(admitted["observations"][0]["clocks"]["mappingKnownAtNs"],
                         str(ACQUIRED))

    def test_all_quality_flags_preserved_with_exact_quantity_partitions(self):
        r = batch(block(0, flags=255, size=7),
                  block(48, flags=128 | 64 | 16, size=11))
        d = r.to_dict()
        self.assertEqual(d["grossReportedQuantity"], "18")
        self.assertEqual(d["qualityQuantityPartitions"],
                         {"flaggedOrUnavailableClock": "7", "noListedExclusion": "11"})
        self.assertEqual(r.observations[0].raw.flags, 255)
        self.assertEqual(len(r.observations[0].quality_exclusions), 5)
        self.assertEqual(r.observations[1].quality_exclusions, ())
        self.assertFalse(d["publicConsumerEligible"])
        self.assertEqual(d["correctionCoverage"], "unsupported")

    def test_last_and_unflagged_records_never_claim_completeness(self):
        for flags in (0, 128):
            with self.subTest(flags=flags):
                d = batch(block(flags=flags)).to_dict()
                self.assertEqual(d["artifactCoverage"], "unverified_partial_or_unknown")
                self.assertFalse(d["publicConsumerEligible"])
                self.assertEqual(d["correctionCoverage"], "unsupported")


class MappingTests(ContractCase):
    def test_index_clock_is_capture_utc_not_exchange_event_day(self):
        r = batch(block(event=D0 - 1, recv=D0))
        self.assertIsNone(r.refusal)
        self.assertEqual(r.observations[0].index_date, "2026-10-05")

    def test_mapping_interval_start_inclusive_end_exclusive(self):
        left = batch(block(event=D0, recv=D0))
        self.assertIsNone(left.refusal)
        right = batch(block(event=D0 + DAY - 1, recv=D0 + DAY))
        self.refusal(right, "missing_or_ambiguous_dated_mapping")
        before = batch(block(event=D0 - 2, recv=D0 - 1))
        self.refusal(before, "missing_or_ambiguous_dated_mapping")

    def test_day_scoped_id_reuse_and_roll_resolve_actual_dated_symbol(self):
        maps = (mapping(), mapping(42, "MNQH27", "2026-10-06", "2026-10-07"))
        r = batch(block(0, size=5), block(48, event=D0 + DAY, recv=D0 + DAY, size=7),
                  maps=maps)
        self.assertIsNone(r.refusal)
        self.assertEqual([x.raw_symbol for x in r.observations], ["MNQZ26", "MNQH27"])
        self.assertEqual(r.to_dict()["instrumentPartitions"], [
            {"indexDateUtc": "2026-10-05", "instrumentId": 42,
             "rawSymbol": "MNQZ26", "observations": 1, "quantity": "5"},
            {"indexDateUtc": "2026-10-06", "instrumentId": 42,
             "rawSymbol": "MNQH27", "observations": 1, "quantity": "7"},
        ])

    def test_missing_instrument_mapping_refuses(self):
        self.refusal(batch(block(instrument=43)), "missing_or_ambiguous_dated_mapping")

    def test_absent_or_mutable_mapping_collection_refuses(self):
        for maps in ((), [mapping()]):
            with self.subTest(type=type(maps).__name__):
                self.error("bounded_immutable_mappings_required",
                           lambda maps=maps: batch(block(), maps=maps))

    def test_overlapping_id_mappings_refuse_even_when_same_economics(self):
        self.error("overlapping_mapping_intervals",
                   lambda: batch(block(), maps=(mapping(), mapping())))

    def test_same_symbol_different_id_conflict_refuses(self):
        self.error("conflicting_symbol_bindings",
                   lambda: batch(block(), maps=(mapping(), mapping(instrument_id=43))))

    def test_mapping_definition_identity_must_match_exactly(self):
        bad = replace(mapping().definition, raw_symbol="MNQH27")
        self.error("mapping_definition_identity_conflict",
                   lambda: batch(block(), maps=(mapping(definition=bad),)))

    def test_tick_claim_without_definition_record_evidence_refuses(self):
        rule_only = evidence("rulebook", "cme_rulebook")
        bad = replace(mapping().definition, evidence=rule_only)
        self.error("unsupported_definition_evidence_kind",
                   lambda: batch(block(), maps=(mapping(definition=bad),)))

    def test_missing_bad_definition_digest_refuses(self):
        bad = replace(mapping().definition,
                      evidence=replace(mapping().definition.evidence, sha256=""))
        self.error("invalid_definition_evidence_sha256",
                   lambda: batch(block(), maps=(mapping(definition=bad),)))

    def test_declared_tick_definition_tick_scale_and_multiplier_conflicts(self):
        changes = (
            ({"tick_size_int": 50_000_000}, "definition_tick_conflict"),
            ({"price_scale": 10_000}, "definition_tick_conflict"),
            ({"contract_multiplier_int": 20_000_000_000}, "definition_multiplier_conflict"),
        )
        for values, code in changes:
            with self.subTest(values=values):
                bad = replace(mapping().definition, **values)
                self.error(code, lambda bad=bad: batch(block(), maps=(mapping(definition=bad),)))
        self.error("definition_tick_conflict",
                   lambda: batch(block(), maps=(mapping(declared_tick_size_int=1),)))

    def test_definition_source_knowledge_order(self):
        bad = replace(mapping().definition,
                      source_recv_ns=ACQUIRED + 1)
        self.error("definition_knowledge_precedes_source",
                   lambda: batch(block(), maps=(mapping(definition=bad),)))

    def test_definition_effective_range_must_cover_capture(self):
        bad = replace(mapping().definition, effective_from_ns=D0 + 2_000_000_000)
        self.refusal(batch(block(), maps=(mapping(definition=bad),)),
                     "definition_not_effective")

    def test_spreads_options_other_products_and_adjusted_basis_are_not_projected(self):
        changes = (
            {"instrument_class": "S"}, {"instrument_class": "C"},
            {"security_type": "OPT"}, {"product": "NQ"}, {"outright": False})
        for values in changes:
            with self.subTest(values=values):
                bad = replace(mapping().definition, **values)
                self.error("unsupported_instrument_projection",
                           lambda bad=bad: batch(block(), maps=(mapping(definition=bad),)))
        for values in ({"price_basis": "back_adjusted"}, {"symbol_type": "continuous"}):
            with self.subTest(values=values):
                bad = replace(mapping().definition, **values)
                self.error("unsupported_symbol_or_price_basis",
                           lambda bad=bad: batch(block(), maps=(mapping(definition=bad),)))

    def test_alias_query_is_not_assumed_to_be_a_dated_raw_symbol(self):
        self.error("symbol_alias_input_unsupported",
                   lambda: batch(block(), a=artifact(input_symbol_type="continuous")))

    def test_invalid_dates_and_float_binding_numbers_refuse(self):
        self.error("invalid_mapping_date",
                   lambda: batch(block(), maps=(replace(mapping(), start_date="2026-10-5"),)))
        bad = replace(mapping().definition, tick_size_int=250_000_000.0)
        self.error("invalid_definition_tick_size_int",
                   lambda: batch(block(), maps=(mapping(definition=bad),)))
        self.error("invalid_mapping_instrument_id",
                   lambda: batch(block(), maps=(mapping(instrument_id=True),)))


class ScopeBoundsTests(ContractCase):
    def test_wrong_metadata_representation_schema_and_mode(self):
        scenarios = (
            ({"dataset": "XNAS.ITCH"}, "unsupported_dataset"),
            ({"schema": None}, "unsupported_or_mixed_schema"),
            ({"schema": "mbo"}, "unsupported_or_mixed_schema"),
            ({"wire_version": 2}, "unsupported_wire_version"),
            ({"wire_version": 3.0}, "unsupported_wire_version"),
            ({"ts_out": True}, "appended_ts_out_unsupported"),
            ({"compression": "zstd"}, "compressed_input_unsupported"),
            ({"input_representation": "whole_dbn_file"}, "unsupported_input_representation"),
            ({"price_encoding": "pretty_decimal"}, "unsupported_price_encoding"),
            ({"mode": "live"}, "unsupported_data_mode"),
        )
        for change, code in scenarios:
            with self.subTest(change=change):
                self.error(code, lambda change=change: batch(block(), a=artifact(**change)))

    def test_source_positions_are_aligned_and_within_artifact(self):
        self.refusal(batch(block(offset=1)), "misaligned_source_position")
        self.refusal(batch(block(offset=48 * 4096)), "invalid_source_offset")

    def test_record_cap_refuses_without_silent_truncation(self):
        r = batch(block(0), block(48), block(96), limits=Limits(max_records=1))
        d = self.refusal(r, "record_cap_exceeded", 1)
        self.assertEqual(d["attempts"], 2)
        self.assertEqual(d["suppliedRecords"], 3)
        self.assertEqual(d["unconsumedSuppliedRecords"], 1)

    def test_identity_cap_does_not_evict_or_conflate(self):
        r = batch(block(0), block(48), limits=Limits(max_identities=1))
        self.refusal(r, "identity_cap_exceeded", 1)

    def test_duplicate_attempts_consume_input_byte_budget(self):
        r = batch(block(), block(), limits=Limits(max_input_bytes=48))
        d = self.refusal(r, "input_byte_cap_exceeded", 1)
        self.assertEqual(d["budgetedInputBytes"], 48)
        self.assertEqual(d["refusal"]["inputBytes"], 48)
        self.assertEqual(d["duplicates"], 0)

    def test_oversized_input_refuses_before_decode_or_hash(self):
        r = batch(block(data=b"x" * 97), limits=Limits(max_input_bytes=96))
        d = self.refusal(r, "input_byte_cap_exceeded")
        self.assertEqual(d["budgetedInputBytes"], 0)
        self.assertEqual(d["refusal"]["inputBytes"], 97)

    def test_hard_limits_and_mapping_count_are_bounded(self):
        for limit, code in (
            (Limits(max_records=65537), "invalid_max_records"),
            (Limits(max_identities=65537), "invalid_max_identities"),
            (Limits(max_input_bytes=48 * 65536 + 1), "invalid_max_input_bytes"),
            (Limits(max_mappings=65), "invalid_max_mappings"),
        ):
            with self.subTest(limits=limit):
                self.error(code, lambda limit=limit: batch(block(), limits=limit))
        self.error("bounded_immutable_mappings_required",
                   lambda: batch(block(), maps=(mapping(),) * 65))

    def test_fatal_refusal_permanently_stops_state_mutation(self):
        n = Normalizer(artifact(), (mapping(),), QUALIFIED, PUBLISHED)
        first = n.consume(block())
        frozen = first.to_dict()
        self.error("conflicting_artifact_position", lambda: n.consume(block(size=9)))
        self.error("batch_stopped", lambda: n.consume(block(48)))
        r = n.finish()
        self.assertEqual(r.to_dict()["grossReportedQuantity"], "1301")
        self.assertEqual(first.to_dict(), frozen)
        self.assertEqual(r.attempts, 2)

    def test_finish_seals_batch_and_cannot_be_repeated(self):
        n = Normalizer(artifact(), (mapping(),), QUALIFIED, PUBLISHED)
        n.consume(block())
        n.finish()
        self.error("batch_stopped", lambda: n.consume(block(48)))
        self.error("batch_already_finished", n.finish)

    def test_mutable_or_json_batch_is_not_accepted(self):
        self.error("immutable_block_batch_required",
                   lambda: normalize_batch(artifact(), (mapping(),), [block()],
                                           QUALIFIED, PUBLISHED))

    def test_empty_batch_is_not_claimed_to_be_a_complete_market_export(self):
        d = batch().to_dict()
        self.assertEqual(d["uniqueObservations"], 0)
        self.assertEqual(d["grossReportedQuantity"], "0")
        self.assertEqual(d["totalsScope"], "this_supplied_batch_only")
        self.assertEqual(d["artifactCoverage"], "unverified_partial_or_unknown")
        self.assertFalse(d["publicConsumerEligible"])


if __name__ == "__main__":
    unittest.main()
