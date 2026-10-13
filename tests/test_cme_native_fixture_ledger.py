"""Deterministic falsifiers for the synthetic-only correction ledger."""
from dataclasses import FrozenInstanceError
import json
import unittest
from unittest.mock import patch

from ingest.cme_native_fixture_ledger import FixtureLedger, InputRefused, Limits, SCHEMA
from ingest.cme_native_fixture_ledger import INT64_MAX, UINT32_MAX, UINT64_MAX
from ingest.cme_native_fixture_ledger import MAX_SERIALIZED_BYTES, STRING_CHUNK_CHARS, _canonical

NS = {"channelId": 310, "sessionId": "2026-10-05",
      "instrumentId": 12345, "rawSymbol": "MNQZ6"}


def record(index=0, action="NEW", **overrides):
    out = {
        "source": {"artifactId": "synthetic-a", "ordinal": index, "byteOffset": index * 64},
        "namespace": NS.copy(), "action": action, "mdTradeEntryId": 1123,
        "price": 100000000000, "quantity": 5,
        "aggressorSide": 1 if action == "NEW" else 0,
        "eventTimeNs": 100 + index * 100,
        "messageTimeNs": 110 + index * 100,
        "availableTimeNs": 120 + index * 100,
        "sequence": 100 + index, "rptSeq": 10 + index,
        "eventComplete": True,
    }
    out.update(overrides)
    return out


def envelope(rows, **overrides):
    out = {
        "schema": SCHEMA, "fixture": True, "sourceKind": "SYNTHETIC",
        "fixtureId": "synthetic-cme-corrections", "quantityUnit": "contracts",
        "priceScale": 1000000000, "namespace": NS.copy(), "records": rows,
    }
    out.update(overrides)
    return out


def encoded(rows, **overrides):
    return json.dumps(envelope(rows, **overrides), separators=(",", ":")).encode()


def ledger(rows, limits=None):
    return FixtureLedger.from_bytes(encoded(rows), limits=limits)


def query(subject, m=10000, k=10000):
    return subject.snapshot(message_cutoff_ns=m, knowledge_cutoff_ns=k)


def query_bytes(subject, m=10000, k=10000):
    return subject.snapshot_bytes(message_cutoff_ns=m, knowledge_cutoff_ns=k)


def reasons(snapshot):
    return {reason for issue in snapshot["quality"]["issues"] for reason in issue["reasonCodes"]}


class RefusalAssertions:
    def assert_refused(self, snap, reason):
        self.assertFalse(snap["qualifiedFixtureSample"])
        self.assertEqual(snap["quality"]["status"], "REFUSED")
        self.assertIn(reason, reasons(snap))
        self.assertIsNone(snap["totals"])
        self.assertEqual(snap["activeSourceObservations"], [])
        self.assertEqual(snap["cancelledSourceObservations"], [])
        self.assertFalse(snap["publicConsumerEligible"])

class Accounting(RefusalAssertions, unittest.TestCase):
    def test_five_to_five_to_zero_price_only_then_bust(self):
        rows = [record(), record(1, "CHANGE", price=95000000000),
                record(2, "DELETE", price=95000000000)]
        obj = ledger(rows)
        new = query(obj, 110, 120)
        changed = query(obj, 210, 220)
        deleted = query(obj, 310, 320)
        self.assertEqual([s["totals"]["activeQuantity"] for s in (new, changed, deleted)], [5, 5, 0])
        self.assertEqual([s["totals"]["grossReportedQuantity"] for s in (new, changed, deleted)], [5, 5, 5])
        self.assertEqual(deleted["totals"]["cancelledQuantity"], 5)
        amended = changed["activeSourceObservations"][0]
        self.assertEqual(amended["price"], 95000000000)
        self.assertEqual(amended["originalPrice"], 100000000000)
        self.assertEqual(amended["originalEventTimeNs"], 100)
        self.assertEqual(amended["originalAvailableTimeNs"], 120)
        self.assertEqual(amended["priceKnownAtNs"], 220)
        self.assertEqual(amended["aggressor"], "BUY")
        self.assertEqual(amended["originalRawAggressorSide"], 1)
        self.assertEqual(changed["history"][1]["record"]["aggressorSide"], 0)
        self.assertEqual(changed["history"][1]["record"]["eventTimeNs"], 200)
        self.assertEqual(changed["history"][1]["record"]["messageTimeNs"], 210)
        self.assertEqual(deleted["cancelledSourceObservations"][0]["cancelAvailableTimeNs"], 320)
        self.assertIsNone(deleted["totals"]["distinctNativeOrderCount"])

    def test_prior_snapshot_bytes_invariant_after_amendment_and_bust(self):
        original = ledger([record()])
        amended = ledger([record(), record(1, "CHANGE", price=95000000000)])
        busted = ledger([record(), record(1, "CHANGE", price=95000000000),
                         record(2, "DELETE", price=95000000000)])
        old = query_bytes(original, 110, 120)
        self.assertEqual(old, query_bytes(amended, 110, 120))
        self.assertEqual(old, query_bytes(busted, 110, 120))
        self.assertEqual(query_bytes(amended, 210, 220), query_bytes(busted, 210, 220))

    def test_conservation_partition_across_three_original_sides(self):
        rows = [record(0, mdTradeEntryId=1, quantity=5, aggressorSide=1),
                record(1, mdTradeEntryId=2, quantity=7, aggressorSide=2),
                record(2, mdTradeEntryId=3, quantity=11, aggressorSide=0),
                record(3, "DELETE", mdTradeEntryId=2, quantity=7)]
        snap = query(ledger(rows))
        totals = snap["totals"]
        self.assertEqual((totals["grossReportedQuantity"], totals["activeQuantity"],
                          totals["cancelledQuantity"]), (23, 16, 7))
        self.assertEqual(totals["grossByAggressor"], {"BUY": 5, "SELL": 7, "NO_AGGRESSOR": 11})
        for side in ("BUY", "SELL", "NO_AGGRESSOR"):
            self.assertEqual(totals["grossByAggressor"][side],
                             totals["activeByAggressor"][side] + totals["cancelledByAggressor"][side])

    def test_unknown_and_known_original_side_are_never_reinferred(self):
        for side, label in ((0, "NO_AGGRESSOR"), (1, "BUY"), (2, "SELL")):
            with self.subTest(side=side):
                snap = query(ledger([record(aggressorSide=side), record(1, "CHANGE", price=-1)]))
                active = snap["activeSourceObservations"][0]
                self.assertEqual((active["aggressor"], active["originalRawAggressorSide"]), (label, side))
                self.assertEqual(snap["history"][1]["record"]["aggressorSide"], 0)

    def test_correction_known_side_is_unsupported_not_original_side_update(self):
        for side in (1, 2):
            with self.subTest(side=side):
                snap = query(ledger([record(), record(1, "CHANGE", aggressorSide=side)]))
                self.assert_refused(snap, "UNSUPPORTED_CORRECTION_AGGRESSOR")

    def test_repeated_native_id_creates_two_new_observations(self):
        snap = query(ledger([record(), record(1)]))
        self.assertTrue(snap["qualifiedFixtureSample"])
        self.assertEqual(snap["totals"]["activeQuantity"], 10)
        self.assertEqual(snap["totals"]["newObservationCount"], 2)
        ids = [r["sourceReportId"] for r in snap["activeSourceObservations"]]
        self.assertEqual(len(set(ids)), 2)

    def test_shared_native_id_never_targets_by_price_or_latest(self):
        for same_price in (False, True):
            for action in ("CHANGE", "DELETE"):
                with self.subTest(same_price=same_price, action=action):
                    second_price = 100000000000 if same_price else 99000000000
                    rows = [record(), record(1, price=second_price),
                            record(2, action, price=second_price)]
                    self.assert_refused(query(ledger(rows)), "AMBIGUOUS_NATIVE_TRADE_ID")

    def test_quantity_change_never_reinterpreted_as_cancel_replace(self):
        self.assert_refused(query(ledger([record(), record(1, "CHANGE", quantity=6)])),
                            "CORRECTION_QUANTITY_MISMATCH")

    def test_delete_matches_current_price_and_quantity(self):
        for change in ({"price": 99000000000}, {"quantity": 4}):
            with self.subTest(change=change):
                reason = "DELETE_PRICE_MISMATCH" if "price" in change else "CORRECTION_QUANTITY_MISMATCH"
                self.assert_refused(query(ledger([record(), record(1, "DELETE", **change)])), reason)

    def test_delete_original_price_after_change_is_refused(self):
        self.assert_refused(query(ledger([record(), record(1, "CHANGE", price=95000000000),
                                          record(2, "DELETE")])), "DELETE_PRICE_MISMATCH")

    def test_unknown_change_and_cancel_refuse(self):
        for action in ("CHANGE", "DELETE"):
            with self.subTest(action=action):
                self.assert_refused(query(ledger([record(0, action)])), "NO_ACTIVE_TARGET")

    def test_different_update_after_delete_is_not_duplicate(self):
        for action in ("CHANGE", "DELETE"):
            with self.subTest(action=action):
                self.assert_refused(query(ledger([record(), record(1, "DELETE"),
                                                  record(2, action)])), "NO_ACTIVE_TARGET")

    def test_exact_physical_replay_does_not_double_new_or_delete(self):
        a, b = record(), record(1, "DELETE")
        self.assertEqual(query_bytes(ledger([a, b])), query_bytes(ledger([a, a, b, b])))

    def test_exact_amendment_replay_preserves_full_snapshot_bytes(self):
        a, b = record(), record(1, "CHANGE", price=95000000000)
        self.assertEqual(query_bytes(ledger([a, b])), query_bytes(ledger([a, b, a, b])))

    def test_conflicting_physical_identity_refuses_reached_prefix_only(self):
        a = record()
        conflict = record(1, quantity=6, source=a["source"])
        self.assertEqual(query_bytes(ledger([a]), 110, 120),
                         query_bytes(ledger([a, conflict]), 110, 120))
        self.assert_refused(query(ledger([a, conflict])), "CONFLICTING_PHYSICAL_REPORT")

    def test_ordinal_and_byte_offset_collisions_and_regression(self):
        for source, expected in (
            ({"artifactId": "synthetic-a", "ordinal": 0, "byteOffset": 64}, "CONFLICTING_PHYSICAL_POSITION"),
            ({"artifactId": "synthetic-a", "ordinal": 1, "byteOffset": 0}, "CONFLICTING_PHYSICAL_POSITION"),
            ({"artifactId": "synthetic-a", "ordinal": 4, "byteOffset": 64}, "PHYSICAL_POSITION_REGRESSION"),
        ):
            with self.subTest(source=source):
                first = record(5) if expected == "PHYSICAL_POSITION_REGRESSION" else record()
                second = record(6, source=source)
                self.assert_refused(query(ledger([first, second])), expected)

    def test_source_sequences_are_data_not_identity_or_gap_authority(self):
        rows = [record(sequence=500, rptSeq=123),
                record(1, mdTradeEntryId=2, sequence=500, rptSeq=1),
                record(2, mdTradeEntryId=3, sequence=9000, rptSeq=125)]
        snap = query(ledger(rows))
        self.assertTrue(snap["qualifiedFixtureSample"])
        self.assertEqual([x["record"]["sequence"] for x in snap["history"]], [500, 500, 9000])
        self.assertFalse(snap["completeCmeVolume"])

    def test_namespace_mismatch_refuses_without_partial_totals(self):
        for key, value in (("channelId", 311), ("sessionId", "2026-10-06"),
                           ("instrumentId", 54321), ("rawSymbol", "MNQH7")):
            with self.subTest(key=key):
                wrong = NS | {key: value}
                self.assert_refused(query(ledger([record(), record(1, "DELETE", namespace=wrong)])),
                                    "NAMESPACE_MISMATCH")

    def test_later_rows_after_refusal_are_history_only(self):
        snap = query(ledger([record(), record(1, "DELETE", quantity=4),
                             record(2, mdTradeEntryId=99)]))
        self.assert_refused(snap, "CORRECTION_QUANTITY_MISMATCH")
        self.assertEqual([item["outcome"] for item in snap["history"]],
                         ["APPLIED_NEW", "REFUSED", "NOT_APPLIED_AFTER_REFUSAL"])

    def test_empty_sample_is_explicit_fixture_arithmetic(self):
        snap = query(ledger([]))
        self.assertEqual(snap["totals"]["activeQuantity"], 0)
        self.assertTrue(snap["fixtureOnly"])
        for key in ("publicConsumerEligible", "completeCmeVolume", "nativeDecoderProven",
                    "atomicCmeEventProven"):
            self.assertFalse(snap[key])


class PrefixClocks(RefusalAssertions, unittest.TestCase):
    def test_inclusive_new_and_amendment_boundaries_require_both_clocks(self):
        obj = ledger([record(), record(1, "CHANGE", price=95000000000)])
        for m, k, active, price in (
            (109, 120, 0, None), (110, 119, 0, None),
            (110, 120, 5, 100000000000), (209, 220, 5, 100000000000),
            (210, 219, 5, 100000000000), (210, 220, 5, 95000000000),
        ):
            with self.subTest(m=m, k=k):
                snap = query(obj, m, k)
                self.assertEqual(snap["totals"]["activeQuantity"], active)
                self.assertEqual(snap["activeSourceObservations"][0]["price"] if active else None, price)

    def test_native_event_time_can_decrease_without_reordering(self):
        rows = [record(eventTimeNs=100), record(1, mdTradeEntryId=99, eventTimeNs=50)]
        snap = query(ledger(rows))
        self.assertTrue(snap["qualifiedFixtureSample"])
        self.assertEqual([x["record"]["eventTimeNs"] for x in snap["history"]], [100, 50])

    def test_message_and_actual_knowledge_regression_refuse_when_reached(self):
        for changes, reason in (({"eventTimeNs": 90, "messageTimeNs": 100}, "MESSAGE_TIME_REGRESSION"),
                                ({"eventTimeNs": 90, "messageTimeNs": 110, "availableTimeNs": 115},
                                 "KNOWLEDGE_TIME_REGRESSION")):
            with self.subTest(reason=reason):
                self.assert_refused(query(ledger([record(), record(1, **changes)])), reason)

    def test_clock_chain_cannot_precede_source_event_or_receipt(self):
        for changes in ({"eventTimeNs": 111}, {"availableTimeNs": 109}):
            with self.subTest(changes=changes):
                self.assert_refused(query(ledger([record(**changes)])), "INVALID_CLOCK_CHAIN")

    def test_first_unavailable_source_member_blocks_later_convenient_row(self):
        rows = [record(), record(1, availableTimeNs=900),
                record(2, mdTradeEntryId=99, availableTimeNs=400)]
        snap = query(ledger(rows), 1000, 500)
        self.assertEqual(snap["totals"]["activeQuantity"], 5)
        self.assertEqual(len(snap["history"]), 1)
        self.assertEqual(snap["quality"]["issues"], [])
        self.assert_refused(query(ledger(rows), 1000, 1000), "KNOWLEDGE_TIME_REGRESSION")

    def test_malformed_future_body_does_not_change_snapshot_or_diagnostics(self):
        base = query_bytes(ledger([record()]), 110, 120)
        future_bodies = [
            record(1, quantity=1.5), record(1, price=True), record(1, action="REPLACE"),
            record(1, eventComplete=False), record(1, namespace={"wrong": True}),
            record(1, source={"wrong": True}), record(1, eventTimeNs=-1),
        ]
        for future in future_bodies:
            with self.subTest(future=future):
                self.assertEqual(base, query_bytes(ledger([record(), future]), 110, 120))
                self.assertFalse(query(ledger([record(), future]))["qualifiedFixtureSample"])

    def test_unclocked_malformed_tail_after_future_boundary_is_never_visited(self):
        rows = [record(), record(1, "CHANGE"), None, [], {"bad": "no clocks"}]
        self.assertEqual(query_bytes(ledger([record()]), 110, 120),
                         query_bytes(ledger(rows), 110, 120))
        self.assert_refused(query(ledger(rows)), "UNSCOPED_RECORD_CLOCK")

    def test_one_trustworthy_future_clock_suffices_to_exclude_bad_body(self):
        for changes, m, k in (({"messageTimeNs": None}, 10000, 120),
                               ({"availableTimeNs": None}, 110, 10000)):
            with self.subTest(changes=changes):
                future = record(1, quantity=0, **changes)
                self.assertEqual(query_bytes(ledger([record()]), m, k),
                                 query_bytes(ledger([record(), future]), m, k))
                self.assert_refused(query(ledger([record(), future])), "UNSCOPED_RECORD_CLOCK")

    def test_reached_unclocked_row_refuses_rather_than_inventing_future_time(self):
        for bad in (None, [], {"bad": "no clocks"}, record(messageTimeNs=None),
                    record(availableTimeNs=None)):
            with self.subTest(bad=bad):
                self.assert_refused(query(ledger([bad])), "UNSCOPED_RECORD_CLOCK")

    def test_duplicate_future_body_key_preserves_earlier_bytes(self):
        payload = encoded([record(), record(1)]).replace(
            b'"quantity":5,"aggressorSide":1,"eventTimeNs":200',
            b'"quantity":5,"quantity":6,"aggressorSide":1,"eventTimeNs":200')
        obj = FixtureLedger.from_bytes(payload)
        self.assertEqual(query_bytes(ledger([record()]), 110, 120), query_bytes(obj, 110, 120))
        snap = query(obj)
        self.assert_refused(snap, "INVALID_RECORD_FIELDS")
        self.assertEqual(snap["history"][1]["record"]["__duplicate_json_fields__"]["keys"], ["quantity"])

    def test_duplicate_clock_is_untrusted_but_other_future_clock_is_respected(self):
        payload = encoded([record(), record(1)]).replace(
            b'"messageTimeNs":210', b'"messageTimeNs":1,"messageTimeNs":210')
        obj = FixtureLedger.from_bytes(payload)
        self.assertEqual(query_bytes(ledger([record()]), 10000, 120), query_bytes(obj, 10000, 120))
        self.assert_refused(query(obj), "UNSCOPED_RECORD_CLOCK")

    def test_future_conflict_truncation_and_unknown_action_leave_all_old_fields_identical(self):
        first = record()
        base = query_bytes(ledger([first]), 110, 120)
        for future in (record(1, source=first["source"]), record(1, eventComplete=False),
                       record(1, action="FILL")):
            with self.subTest(future=future):
                self.assertEqual(base, query_bytes(ledger([first, future]), 110, 120))

    def test_immutable_input_and_returned_nested_objects(self):
        obj = ledger([record(), record(1, "CHANGE")])
        expected = query_bytes(obj)
        snap = query(obj)
        snap["namespace"]["channelId"] = 1
        snap["history"][0]["record"]["source"]["ordinal"] = 200
        snap["activeSourceObservations"][0]["versionSourceReportIds"].clear()
        self.assertEqual(expected, query_bytes(obj))
        with self.assertRaises(FrozenInstanceError):
            obj._metadata = b"{}"


class Validation(RefusalAssertions, unittest.TestCase):
    def test_reached_invalid_quantity_rejects_float_bool_zero_sentinels(self):
        for value in (0, -1, True, 1.5, UINT32_MAX, UINT64_MAX, "5", None, float("nan")):
            with self.subTest(value=value):
                self.assert_refused(query(ledger([record(quantity=value)])), "INVALID_QUANTITY")

    def test_negative_integer_prices_are_exact_and_sentinel_is_refused(self):
        for value in (-(1 << 63), -123, 0, INT64_MAX - 1):
            with self.subTest(value=value):
                snap = query(ledger([record(price=value)]))
                self.assertEqual(snap["activeSourceObservations"][0]["price"], value)
        for value in (-(1 << 63) - 1, INT64_MAX, 1.25, True, "100"):
            with self.subTest(value=value):
                self.assert_refused(query(ledger([record(price=value)])), "INVALID_PRICE")

    def test_unsupported_actions_and_unproved_truncation_refuse(self):
        for action in ("FILL", "REPLACE", "N", 0, None):
            with self.subTest(action=action):
                self.assert_refused(query(ledger([record(action=action)])), "UNSUPPORTED_ACTION")
        for complete in (False, None, 1):
            with self.subTest(complete=complete):
                self.assert_refused(query(ledger([record(eventComplete=complete)])),
                                    "TRUNCATED_OR_UNPROVEN_EVENT")

    def test_integer_admission_clocks_and_cutoffs_never_invent_time(self):
        for field in ("messageTimeNs", "availableTimeNs"):
            for value in (True, -1, 1.2, UINT64_MAX, None):
                with self.subTest(field=field, value=value):
                    self.assert_refused(query(ledger([record(**{field: value})])), "UNSCOPED_RECORD_CLOCK")
        for m, k in ((-1, 1000), (1000, True), (1.5, 1000), (1000, UINT64_MAX)):
            with self.subTest(m=m, k=k), self.assertRaises(InputRefused):
                query(ledger([]), m, k)

    def test_input_syntax_envelope_and_nonfixture_are_transport_refusals(self):
        for payload in (b"{broken", b"[]", b"null"):
            with self.subTest(payload=payload), self.assertRaises(InputRefused):
                FixtureLedger.from_bytes(payload)
        for override in ({"sourceKind": "LIVE"}, {"sourceKind": "HISTORICAL"},
                         {"schema": "DBN"}, {"fixture": False}, {"quantityUnit": "shares"}):
            with self.subTest(override=override), self.assertRaises(InputRefused):
                FixtureLedger.from_bytes(encoded([], **override))
        duplicate_envelope = encoded([]).replace(b'"fixture":true', b'"fixture":true,"fixture":true')
        with self.assertRaises(InputRefused):
            FixtureLedger.from_bytes(duplicate_envelope)

    def test_invalid_scale_and_binding_are_never_inferred(self):
        for override in ({"priceScale": 0}, {"priceScale": 100.0}, {"priceScale": 3},
                         {"priceScale": True}, {"namespace": NS | {"instrumentId": None}},
                         {"namespace": NS | {"rawSymbol": ""}}):
            with self.subTest(override=override), self.assertRaises(InputRefused):
                FixtureLedger.from_bytes(encoded([], **override))

    def test_whole_input_byte_and_record_caps_are_separate_transport_limits(self):
        payload = encoded([record()])
        self.assertEqual(query(FixtureLedger.from_bytes(payload, limits=Limits(max_input_bytes=len(payload))))
                         ["totals"]["activeQuantity"], 5)
        with self.assertRaisesRegex(InputRefused, "INPUT_BYTE_CAP"):
            FixtureLedger.from_bytes(payload, limits=Limits(max_input_bytes=len(payload) - 1))
        with self.assertRaisesRegex(InputRefused, "RECORD_CAP"):
            ledger([record(), record(1)], Limits(max_records=1))

    def test_identity_cap_has_no_eviction_and_replays_do_not_consume_it(self):
        one = record()
        two = record(1, mdTradeEntryId=99)
        self.assertEqual(query(ledger([one, one], Limits(max_identities=1)))["totals"]["activeQuantity"], 5)
        self.assert_refused(query(ledger([one, two, one], Limits(max_identities=1))), "IDENTITY_CAP")
        self.assertEqual(query_bytes(ledger([one], Limits(max_identities=1)), 110, 120),
                         query_bytes(ledger([one, two], Limits(max_identities=1)), 110, 120))

    def test_total_quantity_cap_refuses_without_partial_authoritative_sum(self):
        self.assert_refused(query(ledger([record(), record(1, mdTradeEntryId=2)],
                                         Limits(max_total_quantity=9))), "TOTAL_QUANTITY_CAP")
        good = query(ledger([record(), record(1, mdTradeEntryId=2)], Limits(max_total_quantity=10)))
        self.assertEqual(good["totals"]["grossReportedQuantity"], 10)

    def test_direct_construction_cannot_bypass_fixture_envelope(self):
        with self.assertRaisesRegex(TypeError, "from_bytes"):
            FixtureLedger()

    def test_hard_limits_cannot_be_disabled_or_increased(self):
        for kwargs in ({"max_records": 4097}, {"max_records": 0},
                       {"max_identities": True}, {"max_input_bytes": 4 * 1024 * 1024 + 1},
                       {"max_total_quantity": INT64_MAX + 1},
                       {"max_serialized_bytes": MAX_SERIALIZED_BYTES + 1},
                       {"max_serialized_bytes": 0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(InputRefused):
                Limits(**kwargs)

    def test_invalid_marker_shaped_body_is_inert_until_reached(self):
        malformed = record(1)
        malformed["__duplicate_json_fields__"] = {"keys": 123}
        obj = ledger([record(), malformed])
        self.assertEqual(query_bytes(ledger([record()]), 110, 120), query_bytes(obj, 110, 120))
        self.assert_refused(query(obj), "INVALID_RECORD_FIELDS")


def raw_envelope(raw_rows):
    return encoded([]).replace(b'"records":[]', b'"records":[' + b",".join(raw_rows) + b"]")


class DuplicateStorageBounds(RefusalAssertions, unittest.TestCase):
    def test_safe_nested_duplicate_depths_grow_linearly_and_stay_out_of_past(self):
        first = json.dumps(record(), separators=(",", ":")).encode()
        expected = query_bytes(ledger([record()]), 110, 120)
        sizes = []
        samples = []
        for depth in (0, 4, 8, 12):
            nested = b"0"
            for _ in range(depth):
                nested = b'{"x":0,"x":' + nested + b"}"
            future = json.dumps(record(1), separators=(",", ":")).encode()
            future = future[:-1] + b',"malformedBody":' + nested + b"}"
            payload = raw_envelope([first, future])
            obj = FixtureLedger.from_bytes(payload)
            sizes.append(len(obj._rows[1].encoded))
            samples.append({"depth": depth, "inputBytes": len(payload),
                            "storedFutureRowBytes": len(obj._rows[1].encoded)})
            self.assertEqual(expected, query_bytes(obj, 110, 120))
            self.assert_refused(query(obj), "INVALID_RECORD_FIELDS")
            self.assertLess(len(obj._rows[1].encoded), 8 * len(payload))
        print("BOUNDED_DUPLICATE_GROWTH " + json.dumps(samples, sort_keys=True))
        increments = [right - left for left, right in zip(sizes, sizes[1:])]
        self.assertGreater(increments[0], 0)
        self.assertEqual(len(set(increments)), 1)

    def test_duplicate_values_remain_distinct_under_same_physical_identity(self):
        first = json.dumps(record(), separators=(",", ":")).encode()
        second = json.dumps(record(1), separators=(",", ":")).encode()
        a = second.replace(b'"quantity":5', b'"quantity":5,"quantity":6')
        b = second.replace(b'"quantity":5', b'"quantity":7,"quantity":6')
        single = FixtureLedger.from_bytes(raw_envelope([first, a]))
        replay = FixtureLedger.from_bytes(raw_envelope([first, a, a]))
        conflict = FixtureLedger.from_bytes(raw_envelope([first, a, b]))
        self.assertEqual(query_bytes(single), query_bytes(replay))
        snap = query(conflict)
        self.assert_refused(snap, "CONFLICTING_PHYSICAL_REPORT")
        self.assertIsNotNone(snap["history"][1]["sourceReportId"])
        self.assertEqual(snap["history"][1]["sourceReportId"], snap["history"][2]["sourceReportId"])
        self.assertNotEqual(snap["history"][1]["record"], snap["history"][2]["record"])
        self.assertEqual(query_bytes(ledger([record()]), 110, 120),
                         query_bytes(conflict, 110, 120))

    def test_cumulative_storage_budget_has_exact_inclusive_boundary(self):
        payload = encoded([record(), record(1, "CHANGE")])
        obj = FixtureLedger.from_bytes(payload)
        total = len(obj._metadata) + sum(len(row.encoded) for row in obj._rows)
        exact = FixtureLedger.from_bytes(payload, limits=Limits(max_serialized_bytes=total))
        self.assertEqual(query_bytes(obj), query_bytes(exact))
        with self.assertRaisesRegex(InputRefused, "SERIALIZED_BYTE_CAP"):
            FixtureLedger.from_bytes(payload, limits=Limits(max_serialized_bytes=total - 1))

    def test_future_storage_over_budget_is_transport_refusal_not_past_issue(self):
        first = json.dumps(record(), separators=(",", ":")).encode()
        future = json.dumps(record(1), separators=(",", ":")).encode()
        future = future[:-1] + b',"extra":{"x":0,"x":{"y":0,"y":1}}}'
        payload = raw_envelope([first, future])
        obj = FixtureLedger.from_bytes(payload)
        total = len(obj._metadata) + sum(len(row.encoded) for row in obj._rows)
        exact = FixtureLedger.from_bytes(payload, limits=Limits(max_serialized_bytes=total))
        self.assertEqual(query_bytes(ledger([record()]), 110, 120),
                         query_bytes(exact, 110, 120))
        with self.assertRaisesRegex(InputRefused, "SERIALIZED_BYTE_CAP"):
            FixtureLedger.from_bytes(payload, limits=Limits(max_serialized_bytes=total - 1))

    def test_canonical_writer_matches_stdlib_escaping_and_exact_byte_limit(self):
        value = {"z": [None, True, False, -(1 << 63), (1 << 64) - 2],
                 "a": ("\u0000\n\t\\\"é😀" * 90), "nested": {"b": [], "a": {}}}
        expected = json.dumps(value, sort_keys=True, separators=(",", ":"),
                              ensure_ascii=True, allow_nan=False).encode("ascii")
        self.assertEqual(_canonical(value, max_bytes=len(expected)), expected)
        with self.assertRaisesRegex(InputRefused, "SERIALIZED_BYTE_CAP"):
            _canonical(value, max_bytes=len(expected) - 1)

    def test_low_budget_stops_during_bounded_string_chunks(self):
        real_dumps = json.dumps
        encoded_chunks = []
        def bounded_observer(value, *args, **kwargs):
            self.assertIs(type(value), str)
            encoded_chunks.append(len(value))
            self.assertLessEqual(len(value), STRING_CHUNK_CHARS)
            return real_dumps(value, *args, **kwargs)
        with patch("ingest.cme_native_fixture_ledger.json.dumps", side_effect=bounded_observer):
            with self.assertRaisesRegex(InputRefused, "SERIALIZED_BYTE_CAP"):
                _canonical({"s": "\\" * 8192}, max_bytes=500)
        self.assertGreater(len(encoded_chunks), 0)
        self.assertLess(sum(encoded_chunks), 8192)
        self.assertLessEqual(len(encoded_chunks), 3)


class ParserOriginBoundaries(RefusalAssertions, unittest.TestCase):
    @staticmethod
    def marker():
        return {"__duplicate_json_fields__": {
            "keys": ["quantity"],
            "pairs": [["messageTimeNs", 300], ["availableTimeNs", 310]],
        }}

    def test_literal_marker_cannot_launder_missing_raw_clocks(self):
        first = record(quantity=1301, eventTimeNs=90, messageTimeNs=100, availableTimeNs=110)
        marker = self.marker()
        control = query(ledger([first, {"malformed": True}]), 100, 110)
        self.assert_refused(control, "UNSCOPED_RECORD_CLOCK")
        for literal in (marker, marker | {"parser_duplicate": True},
                        marker | {"parser_origin": True}):
            with self.subTest(literal=literal):
                obj = ledger([first, literal])
                snap = query(obj, 100, 110)
                self.assert_refused(snap, "UNSCOPED_RECORD_CLOCK")
                self.assertEqual(len(snap["history"]), 2)
                self.assertFalse(obj._rows[1].parser_duplicate)
                self.assertIsNone(obj._rows[1].message_ns)
                self.assertIsNone(obj._rows[1].available_ns)

    def test_literal_marker_with_genuine_future_top_fields_stays_excluded(self):
        first = record(quantity=1301, eventTimeNs=90, messageTimeNs=100, availableTimeNs=110)
        future = self.marker() | {"messageTimeNs": 300, "availableTimeNs": 310}
        obj = ledger([first, future])
        self.assertEqual(query_bytes(ledger([first]), 100, 110), query_bytes(obj, 100, 110))
        self.assertFalse(obj._rows[1].parser_duplicate)
        self.assertEqual((obj._rows[1].message_ns, obj._rows[1].available_ns), (300, 310))
        self.assert_refused(query(obj), "INVALID_RECORD_FIELDS")

    def test_actual_parser_duplicate_keeps_unique_raw_future_clocks(self):
        first = json.dumps(record(), separators=(",", ":")).encode()
        future = json.dumps(record(1), separators=(",", ":")).encode().replace(
            b'"quantity":5', b'"quantity":5,"quantity":6')
        obj = FixtureLedger.from_bytes(raw_envelope([first, future]))
        self.assertTrue(obj._rows[1].parser_duplicate)
        self.assertEqual((obj._rows[1].message_ns, obj._rows[1].available_ns), (210, 220))
        self.assertEqual(query_bytes(ledger([record()]), 110, 120), query_bytes(obj, 110, 120))
        snap = query(obj)
        self.assert_refused(snap, "INVALID_RECORD_FIELDS")
        self.assertIsNotNone(snap["history"][1]["sourceReportId"])

    def test_actual_duplicated_clock_never_borrows_its_last_future_value(self):
        first = record(quantity=1301, eventTimeNs=90, messageTimeNs=100, availableTimeNs=110)
        raw_first = json.dumps(first, separators=(",", ":")).encode()
        future = json.dumps(record(1, availableTimeNs=310), separators=(",", ":")).encode()
        future = future.replace(b'"messageTimeNs":210', b'"messageTimeNs":1,"messageTimeNs":300')
        obj = FixtureLedger.from_bytes(raw_envelope([raw_first, future]))
        self.assertTrue(obj._rows[1].parser_duplicate)
        self.assertIsNone(obj._rows[1].message_ns)
        self.assertEqual(obj._rows[1].available_ns, 310)
        # K admits the genuine availability. No unique message clock can hide it.
        self.assert_refused(query(obj, 100, 1000), "UNSCOPED_RECORD_CLOCK")
        # A genuinely future availability remains a sufficient independent fence.
        self.assertEqual(query_bytes(ledger([first]), 100, 110), query_bytes(obj, 100, 110))

    def test_literal_marker_cannot_authenticate_physical_source_identity(self):
        first = record()
        forged = {"__duplicate_json_fields__": {
            "keys": ["quantity"], "pairs": list(record(1).items()),
        }, "messageTimeNs": 210, "availableTimeNs": 220}
        snap = query(ledger([first, forged]))
        self.assert_refused(snap, "INVALID_PHYSICAL_SOURCE")
        self.assertIsNone(snap["history"][1]["sourceReportId"])

    def test_real_unrelated_duplicate_does_not_authenticate_nested_marker_fields(self):
        first = json.dumps(record(), separators=(",", ":")).encode()
        inner = json.dumps(self.marker()["__duplicate_json_fields__"],
                           separators=(",", ":")).encode()
        raw = b'{"unrelated":1,"unrelated":2,"__duplicate_json_fields__":' + inner + b"}"
        obj = FixtureLedger.from_bytes(raw_envelope([first, raw]))
        self.assertTrue(obj._rows[1].parser_duplicate)
        self.assertIsNone(obj._rows[1].message_ns)
        self.assertIsNone(obj._rows[1].available_ns)
        self.assert_refused(query(obj, 110, 120), "UNSCOPED_RECORD_CLOCK")


if __name__ == "__main__":
    unittest.main()
