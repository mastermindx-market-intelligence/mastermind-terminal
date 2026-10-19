"""Adversarial transaction/transport tests; no vendor access or candle inputs."""
import io
import struct
from datetime import datetime, timezone

import pytest

from ingest.iex_deep_trades import (
    DecodeError, Decoder, Limits, decode_stream, transport_messages, validate_receipt,
)

STAMP = int(datetime(2026, 10, 5, 12, tzinfo=timezone.utc).timestamp()) * 10**9
RECEIPT = {
    "schema": "mastermind.iex_hist_acquisition.v1",
    "feed": "DPLS", "protocol": "IEXTP1", "version": "1.0",
    "scope": "IEX venue only", "sha256": "a" * 64, "date": "20261005",
    "acquired_at_utc": "2026-10-07T06:08:37+00:00",
    "actual_size_bytes": 1, "expected_size_bytes": 1,
    "source_url": "https://iex.example.test/recorded-historical-source",
}


def sym(symbol="SPY"):
    return symbol.encode().ljust(8, b" ")


def add(order=1, size=200, price=100_0000, side=b"5", stamp=STAMP, symbol="SPY"):
    return struct.pack("<ccq8sqIq", b"a", side, stamp, sym(symbol), order, size, price)


def modify(order=1, size=200, price=100_0000, flags=0, stamp=STAMP, symbol="SPY"):
    return struct.pack("<cBq8sqIq", b"M", flags, stamp, sym(symbol), order, size, price)


def execution(order=1, size=100, price=100_0000, trade=1, flags=0, stamp=STAMP + 10, symbol="SPY"):
    return struct.pack("<cBq8sqIqq", b"L", flags, stamp, sym(symbol), order, size, price, trade)


def trade(size=50, price=100_0000, trade=2, flags=0, stamp=STAMP + 20, symbol="SPY", kind=b"T"):
    return struct.pack("<cBq8sIqq", kind, flags, stamp, sym(symbol), size, price, trade)


def remove(order=1, stamp=STAMP, symbol="SPY"):
    return struct.pack("<cBq8sq", b"R", 0, stamp, sym(symbol), order)


def clear(stamp=STAMP, symbol="SPY"):
    return struct.pack("<cBq8s", b"C", 0, stamp, sym(symbol))


def transport(messages, sequence=1, offset=0, protocol=0x8005, channel=1, session=123):
    bodies = b"".join(struct.pack("<H", len(m)) + m for m in messages)
    return struct.pack("<BBHIIHHqqq", 1, 0, protocol, channel, session,
                       len(bodies), len(messages), offset, sequence, STAMP + 1_000_000) + bodies


def ethernet(payload, *, vlan=False, fragment=0, ipv6=False):
    udp = struct.pack("!HHHH", 10378, 10378, len(payload) + 8, 0) + payload
    if ipv6:
        ip = struct.pack("!IHBB16s16s", 6 << 28, len(udp), 17, 64, b"\x00" * 15 + b"\x01", b"\x00" * 15 + b"\x02")
        proto = 0x86DD
    else:
        ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, len(udp) + 20, 0, fragment,
                         64, 17, 0, b"\x7f\x00\x00\x01", b"\xe9\xd7\x15\x08")
        proto = 0x0800
    header = b"\x00" * 12 + struct.pack("!H", 0x8100 if vlan else proto)
    if vlan:
        header += struct.pack("!HH", 7, proto)
    return header + ip + udp


def classic(packets):
    head = struct.pack("<IHHiiII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
    return head + b"".join(struct.pack("<IIII", STAMP // 10**9, 2, len(p), len(p)) + p for p in packets)


def block(kind, body, endian="<"):
    assert len(body) % 4 == 0
    total = len(body) + 12
    return struct.pack(endian + "II", kind, total) + body + struct.pack(endian + "I", total)


def section(endian="<"):
    return block(0x0A0D0D0A, struct.pack(endian + "IHHq", 0x1A2B3C4D, 1, 0, -1), endian)


def interface(endian="<", resolution=9, offset_seconds=0, linktype=1):
    opts = struct.pack(endian + "HH", 9, 1) + bytes([resolution]) + b"\x00" * 3
    opts += struct.pack(endian + "HHq", 14, 8, offset_seconds)
    opts += struct.pack(endian + "HH", 0, 0)
    return block(1, struct.pack(endian + "HHI", linktype, 0, 65535) + opts, endian)


def enhanced(packet, endian="<", ticks=STAMP + 5, interface_id=0):
    body = struct.pack(endian + "IIIII", interface_id, ticks >> 32, ticks & 0xFFFFFFFF, len(packet), len(packet))
    body += packet + b"\x00" * (-len(packet) % 4)
    return block(6, body, endian)


def pcapng(packets, endian="<", resolution=9, offset_seconds=0):
    return section(endian) + interface(endian, resolution, offset_seconds) + b"".join(
        enhanced(p, endian) for p in packets
    )


def decode(messages, *, capture="pcapng", **kwargs):
    raw = ethernet(transport(messages))
    blob = pcapng([raw]) if capture == "pcapng" else classic([raw])
    return decode_stream(io.BytesIO(blob), RECEIPT, ["SPY"], **kwargs)


def test_l_and_t_both_count_executed_shares_and_break_targets_l():
    envelopes, audit, private = decode([
        add(), execution(size=150, trade=11), trade(size=75, trade=12),
        trade(size=150, trade=11, kind=b"B", stamp=STAMP + 30),
    ])
    rows = envelopes["SPY"]["prints"]
    assert [r["sourceRecordType"] for r in rows] == ["L", "T", "B"]
    assert rows[0]["side"] == "buy" and rows[0]["sideMethod"] == "resting_order"
    assert rows[1]["side"] == "unknown" and rows[2]["targetId"] == rows[0]["id"]
    assert audit["conservation"] == {
        "grossExecutedShares": 225, "matchedBrokenShares": 150,
        "netUnbrokenShares": 75, "unmatchedBreaksSubtractNothing": True,
    }
    assert private[0]["orderQuantityBefore"] == 200
    assert private[0]["source"]["captureTimestampNs"] == str(STAMP + 5)


def test_break_targets_non_displayed_trade_and_orphan_subtracts_nothing():
    _, audit, _ = decode([
        trade(size=50, trade=2), trade(size=50, trade=2, kind=b"B"),
        trade(size=999, trade=99, kind=b"B"),
    ])
    assert audit["conservation"]["netUnbrokenShares"] == 0
    assert audit["counters"]["unmatched_trade_breaks"] == 1


def test_break_does_not_restore_removed_order():
    envelopes, _, _ = decode([
        add(size=100), execution(size=100, trade=1),
        trade(size=100, trade=1, kind=b"B"), execution(size=100, trade=3),
    ])
    assert envelopes["SPY"]["prints"][-1]["side"] == "unknown"


def test_modified_size_is_new_total_and_overrun_keeps_quantity_but_abstains():
    envelopes, audit, _ = decode([add(size=200), modify(size=80), execution(size=90)])
    assert envelopes["SPY"]["prints"][0]["quantity"] == 90
    assert envelopes["SPY"]["prints"][0]["side"] == "unknown"
    assert audit["counters"]["execution_exceeds_known_order"] == 1


def test_remove_then_reuse_order_identifier_has_new_side():
    envelopes, _, _ = decode([add(), remove(), add(side=b"8"), execution()])
    assert envelopes["SPY"]["prints"][0]["side"] == "sell"


def test_cross_and_orphan_executions_have_no_aggressor_inference():
    envelopes, _, _ = decode([add(), execution(flags=8), execution(order=999, trade=2)])
    assert all(r["side"] == "unknown" for r in envelopes["SPY"]["prints"])


def test_native_stream_order_survives_decreasing_message_timestamps():
    envelopes, _, _ = decode([add(stamp=STAMP + 100), execution(stamp=STAMP + 50)])
    assert envelopes["SPY"]["prints"][0]["sideMethod"] == "resting_order"


def test_historical_clock_and_unit_contract_has_no_fake_responses():
    envelopes, audit, _ = decode([trade()])
    envelope = envelopes["SPY"]
    assert envelope["instrument"]["quantityUnit"] == "shares"
    assert envelope["instrument"]["priceScale"] == 10000
    assert envelope["instrument"]["tickSizeInt"] is None
    assert envelope["provenance"]["dataMode"] == "historical"
    assert envelope["provenance"]["evidenceMode"] == "HISTORICAL_REPLAY"
    assert envelope["provenance"]["receiptBasis"] == "archive_acquisition"
    assert envelope["provenance"]["coverage"] == "partial"
    assert all(int(r["availableNs"]) >= int(r["eventNs"]) for r in envelope["prints"])
    assert envelope["responses"] == [] and envelope["responseCoverage"] == "unavailable"
    assert audit["archiveSha256IndependentlyRecomputed"] is False
    assert audit["originalIntradayMastermindAvailabilityProven"] is False


@pytest.mark.parametrize("capture", ["pcap", "pcapng"])
def test_both_capture_formats_preserve_integer_price(capture):
    envelopes, _, _ = decode([trade(price=1234567, size=4_000_000_000)], capture=capture)
    assert envelopes["SPY"]["prints"][0]["priceInt"] == 1234567
    assert envelopes["SPY"]["prints"][0]["quantity"] == 4_000_000_000


def test_pcapng_endianness_resets_per_section_but_iex_is_always_little_endian():
    p1 = ethernet(transport([trade(trade=1)], session=123))
    p2 = ethernet(transport([trade(trade=2)], session=124))
    blob = pcapng([p1], endian="<") + pcapng([p2], endian=">")
    envelopes, audit, _ = decode_stream(io.BytesIO(blob), RECEIPT, ["SPY"])
    assert len(envelopes["SPY"]["prints"]) == 2
    assert audit["counters"]["pcapng_sections"] == 2


def test_capture_timestamp_high_low_resolution_and_signed_offset():
    packet = ethernet(transport([trade()]))
    ticks = (7 << 32) | 123
    blob = section() + interface(resolution=6, offset_seconds=-2) + enhanced(packet, ticks=ticks)
    _, _, private = decode_stream(io.BytesIO(blob), RECEIPT, ["SPY"])
    assert private[0]["source"]["captureTimestampNs"] == str(ticks * 1000 - 2_000_000_000)


def test_binary_capture_resolution_preserved_as_rational_if_not_whole_ns():
    packet = ethernet(transport([trade()]))
    blob = section() + interface(resolution=0x80 | 31) + enhanced(packet, ticks=1)
    _, _, private = decode_stream(io.BytesIO(blob), RECEIPT, ["SPY"])
    assert private[0]["source"]["captureTicksPerSecond"] == str(2**31)
    assert private[0]["source"]["captureTimestampNs"] is None


@pytest.mark.parametrize("kwargs", [{"vlan": True}, {"ipv6": True}])
def test_dynamic_network_headers(kwargs):
    packet = ethernet(transport([trade()]), **kwargs)
    envelopes, _, _ = decode_stream(io.BytesIO(classic([packet])), RECEIPT, ["SPY"])
    assert envelopes["SPY"]["prints"][0]["quantity"] == 50


def test_retransmission_dedup_handles_different_packet_grouping():
    a, t = add(), trade()
    packets = [
        ethernet(transport([a, t])),
        ethernet(transport([a])),
        ethernet(transport([t], sequence=2, offset=len(a) + 2)),
    ]
    envelopes, audit, _ = decode_stream(io.BytesIO(pcapng(packets)), RECEIPT, ["SPY"])
    assert len(envelopes["SPY"]["prints"]) == 1
    assert audit["counters"]["duplicate_messages"] == 2
    assert audit["counters"].get("sequence_gap_events", 0) == 0


def test_conflicting_retransmission_refuses():
    packets = [ethernet(transport([trade(price=p)])) for p in (100_0000, 101_0000)]
    with pytest.raises(DecodeError, match="conflicting retransmission"):
        decode_stream(io.BytesIO(pcapng(packets)), RECEIPT, ["SPY"])


def test_gap_invalidates_lifecycle_before_more_execution():
    a = add()
    packets = [
        ethernet(transport([a])),
        ethernet(transport([execution()], sequence=3, offset=len(a) + 2 + 10)),
    ]
    envelopes, audit, _ = decode_stream(io.BytesIO(pcapng(packets)), RECEIPT, ["SPY"])
    assert envelopes["SPY"]["prints"][0]["side"] == "unknown"
    assert audit["counters"]["sequence_gap_events"] == 1


def test_missing_prefix_abstains_until_native_clear_book_and_new_add():
    a, l, c, a2, l2 = add(), execution(), clear(), add(side=b"8"), execution(trade=2)
    packets = [ethernet(transport([a, l, c, a2, l2], sequence=100, offset=1000))]
    envelopes, audit, _ = decode_stream(io.BytesIO(pcapng(packets)), RECEIPT, ["SPY"])
    assert [r["side"] for r in envelopes["SPY"]["prints"]] == ["unknown", "sell"]
    assert audit["counters"]["unobserved_stream_prefixes"] == 1


def test_heartbeat_consumes_no_sequence_or_bytes():
    a, l = add(), execution()
    offset = len(a) + 2
    packets = [
        ethernet(transport([a])),
        ethernet(transport([], sequence=2, offset=offset)),
        ethernet(transport([l], sequence=2, offset=offset)),
    ]
    envelopes, audit, _ = decode_stream(io.BytesIO(pcapng(packets)), RECEIPT, ["SPY"])
    assert envelopes["SPY"]["prints"][0]["side"] == "buy"
    assert audit["counters"]["heartbeats"] == 1
    assert audit["counters"].get("sequence_gap_events", 0) == 0


def test_unknown_message_enum_preserves_volume_but_invalidates_side():
    envelopes, audit, _ = decode([add(), b"zunknown", execution()])
    assert envelopes["SPY"]["prints"][0]["quantity"] == 100
    assert envelopes["SPY"]["prints"][0]["side"] == "unknown"
    assert audit["counters"]["unknown_message_types"] == 1


@pytest.mark.parametrize("body,reason", [
    (add(side=b"Q"), "unknown native order side"),
    (execution(flags=1), "unknown trade flag"),
    (modify(flags=2), "unknown order-modification"),
    (trade(price=0), "invalid executed"),
    (trade(price=2**53), "invalid executed"),
    (trade(size=0), "invalid executed"),
    (execution()[:-1], "message length"),
])
def test_invalid_native_records_fail_closed(body, reason):
    with pytest.raises(DecodeError, match=reason):
        decode([body])


@pytest.mark.parametrize("bad", [
    transport([trade()], protocol=0x8004),
    transport([trade()])[:-1],
    transport([trade()]) + b"\x00",
])
def test_invalid_tp_protocol_and_payload_are_refused(bad):
    with pytest.raises(DecodeError):
        transport_messages(bad)


def test_trade_break_conflicting_size_is_not_silent_correction():
    with pytest.raises(DecodeError, match="break price/quantity"):
        decode([trade(size=50), trade(size=51, kind=b"B")])


def test_semantic_duplicate_trade_does_not_double_quantity():
    _, audit, _ = decode([trade(), trade()])
    assert audit["conservation"]["grossExecutedShares"] == 50
    assert audit["counters"]["semantic_duplicate_trades"] == 1


def test_duplicate_break_is_idempotent():
    _, audit, _ = decode([trade(), trade(kind=b"B"), trade(kind=b"B")])
    assert audit["conservation"]["matchedBrokenShares"] == 50
    assert audit["counters"]["duplicate_trade_breaks"] == 1


def test_conflicting_same_native_trade_id_is_refused():
    with pytest.raises(DecodeError, match="conflicting native trade"):
        decode([trade(size=50), trade(size=100)])


def test_same_id_different_symbols_has_distinct_scope():
    packet = ethernet(transport([trade(symbol="SPY"), trade(symbol="QQQ")]))
    envelopes, _, _ = decode_stream(io.BytesIO(pcapng([packet])), RECEIPT, ["SPY", "QQQ"])
    assert envelopes["SPY"]["prints"][0]["id"] != envelopes["QQQ"]["prints"][0]["id"]


def test_fragmented_ip_refuses_instead_of_skipping_event_bytes():
    packet = ethernet(transport([trade()]), fragment=0x2000)
    with pytest.raises(DecodeError, match="fragmented IPv4"):
        decode_stream(io.BytesIO(pcapng([packet])), RECEIPT, ["SPY"])


def test_pcapng_bad_trailer_and_unknown_interface_are_refused():
    packet = ethernet(transport([trade()]))
    bad = bytearray(pcapng([packet]))
    bad[-1] ^= 1
    with pytest.raises(DecodeError, match="trailer"):
        decode_stream(io.BytesIO(bad), RECEIPT, ["SPY"])
    bad = section() + interface() + enhanced(packet, interface_id=1)
    with pytest.raises(DecodeError, match="unknown PCAPNG interface"):
        decode_stream(io.BytesIO(bad), RECEIPT, ["SPY"])


def test_unsupported_linktype_and_simple_packet_block_refuse():
    with pytest.raises(DecodeError, match="linktype"):
        decode_stream(io.BytesIO(section() + interface(linktype=101)), RECEIPT, ["SPY"])
    with pytest.raises(DecodeError, match="unsupported legacy/simple"):
        decode_stream(io.BytesIO(section() + interface() + block(3, b"\x00" * 4)), RECEIPT, ["SPY"])


def test_output_cap_is_explicit_partial_evidence():
    envelopes, audit, _ = decode([trade(trade=1), trade(trade=2)], limits=Limits(max_output_records=1))
    assert len(envelopes["SPY"]["prints"]) == 1
    assert audit["stopReason"] == "selected_record_limit"
    assert audit["archiveExhausted"] is False
    assert audit["gzipFullIntegrityChecked"] is False


def test_decompressed_budget_is_hard_and_hashed_without_full_archive_claim():
    envelopes, audit, _ = decode([trade()], limits=Limits(max_decompressed_bytes=100))
    assert not envelopes
    assert audit["stopReason"] == "decompressed_byte_limit"
    assert audit["decompressedBytesRead"] <= 100
    assert len(audit["decompressedPrefixSha256"]) == 64


def test_time_filter_does_not_discard_prior_order_lifecycle():
    envelopes, _, _ = decode([add(stamp=STAMP), execution(stamp=STAMP + 100)], start_ns=STAMP + 50)
    assert envelopes["SPY"]["prints"][0]["side"] == "buy"


@pytest.mark.parametrize("patch", [
    {"feed": "DEEP"}, {"scope": "consolidated"}, {"sha256": "bad"},
    {"acquired_at_utc": "2026-10-07T00:00:00"}, {"date": "20260230"},
    {"actual_size_bytes": 2},
])
def test_invalid_receipt_never_upgrades_source(patch):
    with pytest.raises((DecodeError, ValueError)):
        validate_receipt({**RECEIPT, **patch})


def test_future_event_cannot_precede_archive_acquisition():
    with pytest.raises(DecodeError, match="acquisition"):
        decode([trade(stamp=STAMP + 7 * 86400 * 10**9)])


def test_semantic_duplicate_l_does_not_reduce_order_twice():
    envelopes, audit, _ = decode([add(size=200), execution(size=100, trade=1),
                                 execution(size=100, trade=1), execution(size=100, trade=3)])
    assert [r["side"] for r in envelopes["SPY"]["prints"]] == ["buy", "buy"]
    assert audit["conservation"]["grossExecutedShares"] == 200


def test_native_space_reserved_delete_and_clear_are_ignored_not_invented_enums():
    r = bytearray(remove()); r[1] = 0x20
    c = bytearray(clear()); c[1] = 0x20
    envelopes, audit, _ = decode([add(), bytes(r), add(side=b"8"), bytes(c), execution()])
    assert envelopes["SPY"]["prints"][0]["side"] == "unknown"
    assert audit["counters"]["R_reserved_0x20"] == 1
    assert audit["counters"]["C_reserved_0x20"] == 1


def test_retail_indicator_is_administrative_not_an_order_side():
    indicator = struct.pack("<cBq8s", b"I", 0x20, STAMP + 5, sym())
    envelopes, audit, _ = decode([add(), indicator, execution()])
    assert envelopes["SPY"]["prints"][0]["side"] == "buy"
    assert audit["counters"].get("unknown_message_types", 0) == 0


def test_packet_limit_does_not_read_next_packet_body():
    a = ethernet(transport([trade(trade=1)]))
    b = ethernet(transport([trade(trade=2)], sequence=2, offset=40))
    prefix = pcapng([a])
    data = prefix + enhanced(b)
    envelopes, audit, _ = decode_stream(io.BytesIO(data), RECEIPT, ["SPY"], Limits(max_packets=1))
    assert audit["decompressedBytesRead"] == len(prefix)
    assert audit["stopReason"] == "packet_limit"
    assert len(envelopes["SPY"]["prints"]) == 1


# Integrity review: semantic identity must precede lifecycle and output filtering.
@pytest.mark.parametrize("maker", [trade, execution])
def test_repeated_native_identity_with_different_event_time_is_conflicting(maker):
    with pytest.raises(DecodeError, match="conflicting native trade identity"):
        decode([maker(stamp=STAMP + 1), maker(stamp=STAMP + 2)])


def test_repeated_native_execution_identity_with_different_resting_order_is_conflicting():
    with pytest.raises(DecodeError, match="conflicting native trade identity"):
        decode([add(order=1), add(order=2), execution(order=1), execution(order=2)])


@pytest.mark.parametrize("second_channel,second_session", [(2, 123), (1, 124)])
def test_normalized_identity_and_cancel_target_are_scoped_to_native_stream(second_channel, second_session):
    packets = [
        ethernet(transport([trade(size=50, trade=7)], channel=1, session=123)),
        ethernet(transport([trade(size=60, trade=7), trade(size=60, trade=7, kind=b"B")],
                           channel=second_channel, session=second_session)),
    ]
    envelopes, audit, _ = decode_stream(io.BytesIO(pcapng(packets)), RECEIPT, ["SPY"])
    first, second, cancel = envelopes["SPY"]["prints"]
    assert first["id"] != second["id"]
    assert first["session"] != second["session"]
    assert len(first["session"]) <= 32 and len(second["session"]) <= 32
    assert cancel["session"] == second["session"]
    assert cancel["targetId"] == second["id"]
    assert cancel["targetId"] != first["id"]
    assert audit["conservation"]["netUnbrokenShares"] == 50


@pytest.mark.parametrize("channel,session", [(0, 0), (2**32 - 1, 2**32 - 1)])
def test_normalized_session_retains_full_unsigned_channel_and_session_fields(channel, session):
    packet = ethernet(transport([trade()], channel=channel, session=session))
    envelopes, _, _ = decode_stream(io.BytesIO(pcapng([packet])), RECEIPT, ["SPY"])
    assert envelopes["SPY"]["prints"][0]["session"] == f"20261005.8005.{channel:08x}.{session:08x}"


ADMIN_BODY_LENGTHS = {b"S": 10, b"D": 31, b"H": 22, b"I": 18, b"O": 18, b"P": 19, b"E": 18}


def admin_message(kind, stamp=STAMP + 5):
    body = bytearray(ADMIN_BODY_LENGTHS[kind])
    body[0:1] = kind
    body[1] = {b"S": ord("O"), b"D": 0, b"H": ord("T"), b"I": ord(" "),
               b"O": ord("O"), b"P": 0, b"E": ord("O")}[kind]
    struct.pack_into("<q", body, 2, stamp)
    if kind != b"S":
        body[10:18] = sym()
    return bytes(body)


@pytest.mark.parametrize("kind", ADMIN_BODY_LENGTHS)
@pytest.mark.parametrize("extra", [-1, 1])
def test_known_admin_body_length_must_match_specification(kind, extra):
    body = admin_message(kind)
    malformed = body[:-1] if extra == -1 else body + b"\x00"
    with pytest.raises(DecodeError, match="message length"):
        decode([add(), malformed, execution()])


@pytest.mark.parametrize("kind", ADMIN_BODY_LENGTHS)
def test_known_admin_full_frame_remains_non_execution_and_preserves_lifecycle(kind):
    envelopes, audit, _ = decode([add(), admin_message(kind), execution()])
    assert envelopes["SPY"]["prints"][0]["side"] == "buy"
    assert audit["conservation"]["grossExecutedShares"] == 100
    assert audit["counters"]["admin_messages"] == 1


@pytest.mark.parametrize("kind", ADMIN_BODY_LENGTHS)
def test_known_admin_invalid_source_clock_is_not_silently_accepted(kind):
    with pytest.raises(DecodeError, match="negative source timestamp"):
        decode([admin_message(kind, stamp=-1)])


def test_filtered_semantic_duplicate_l_does_not_reduce_resting_quantity_twice():
    envelopes, audit, private = decode([
        add(size=200), execution(size=100, trade=1, stamp=STAMP + 10),
        execution(size=100, trade=1, stamp=STAMP + 10),
        execution(size=100, trade=3, stamp=STAMP + 100),
    ], start_ns=STAMP + 50)
    assert [r["side"] for r in envelopes["SPY"]["prints"]] == ["buy"]
    assert private[0]["orderQuantityBefore"] == 100
    assert audit["conservation"]["grossExecutedShares"] == 100
    assert audit["counters"]["semantic_duplicate_trades"] == 1
    assert audit["counters"]["time_filtered_executions"] == 1


@pytest.mark.parametrize("patch", [{"size": 51}, {"price": 100_0001},
                                    {"stamp": STAMP + 21}, {"flags": 0x20}])
def test_repeated_break_conflicting_native_payload_is_never_idempotent(patch):
    with pytest.raises(DecodeError, match="conflicting native trade break|break price/quantity"):
        decode([trade(), trade(kind=b"B"), trade(kind=b"B", **patch)])


def test_break_of_filtered_trade_is_not_subtracted_from_selected_volume():
    envelopes, audit, _ = decode([
        trade(stamp=STAMP + 10), trade(kind=b"B", stamp=STAMP + 100),
    ], start_ns=STAMP + 50)
    assert [r["kind"] for r in envelopes["SPY"]["prints"]] == ["cancel"]
    assert audit["conservation"]["grossExecutedShares"] == 0
    assert audit["conservation"]["matchedBrokenShares"] == 0
    assert audit["conservation"]["netUnbrokenShares"] == 0
    assert audit["counters"]["break_targets_outside_selection"] == 1


def test_contradictory_break_outside_selection_is_still_rejected():
    with pytest.raises(DecodeError, match="conflicting native trade break|break price/quantity"):
        decode([trade(), trade(kind=b"B"), trade(kind=b"B", size=51)], start_ns=STAMP + 100)


def test_filtered_native_identity_memory_is_bounded_without_eviction():
    envelopes, audit, _ = decode([
        trade(trade=1), trade(trade=2), trade(trade=1),
    ], start_ns=STAMP + 100, limits=Limits(max_native_identities=1))
    assert envelopes == {}
    assert audit["stopReason"] == "native_identity_limit"
    assert audit["archiveExhausted"] is False
    assert audit["counters"]["native_identity_signatures"] == 1


def test_break_signature_memory_shares_the_native_identity_ceiling():
    envelopes, audit, _ = decode([
        trade(trade=1), trade(trade=1, kind=b"B"),
    ], limits=Limits(max_native_identities=1))
    assert [r["kind"] for r in envelopes["SPY"]["prints"]] == ["trade"]
    assert audit["stopReason"] == "native_identity_limit"
    assert audit["conservation"]["netUnbrokenShares"] == 50


# Independent review: native breaks target previously sent executions, and their
# break-event timestamp cannot precede the target execution's event timestamp.
@pytest.mark.parametrize("maker", [trade, execution])
def test_break_timestamp_cannot_precede_known_target_event(maker):
    with pytest.raises(DecodeError, match="trade break precedes target execution timestamp"):
        decode([maker(trade=9, size=100, stamp=STAMP + 100),
                trade(trade=9, size=100, kind=b"B", stamp=STAMP + 50)])


@pytest.mark.parametrize("maker", [trade, execution])
@pytest.mark.parametrize("size", [100, 101])
def test_unmatched_break_cannot_be_resolved_by_a_later_native_execution(maker, size):
    with pytest.raises(DecodeError, match="execution follows unmatched native trade break"):
        decode([trade(trade=9, size=100, kind=b"B", stamp=STAMP + 100),
                maker(trade=9, size=size, stamp=STAMP + 50)])


def test_known_execution_retransmitted_after_its_break_is_still_idempotent():
    t = trade(trade=9, size=100, stamp=STAMP + 50)
    _, audit, _ = decode([t, trade(trade=9, size=100, kind=b"B", stamp=STAMP + 100), t])
    assert audit["conservation"]["grossExecutedShares"] == 100
    assert audit["conservation"]["matchedBrokenShares"] == 100
    assert audit["conservation"]["netUnbrokenShares"] == 0
    assert audit["counters"]["semantic_duplicate_trades"] == 1


def test_break_may_share_its_prior_native_targets_event_timestamp():
    _, audit, _ = decode([trade(stamp=STAMP + 100), trade(kind=b"B", stamp=STAMP + 100)])
    assert audit["conservation"]["netUnbrokenShares"] == 0


def test_impossible_break_order_is_rejected_outside_the_output_time_selection():
    with pytest.raises(DecodeError, match="trade break precedes target execution timestamp"):
        decode([trade(stamp=STAMP + 100), trade(kind=b"B", stamp=STAMP + 50)],
               start_ns=STAMP + 1000)


@pytest.mark.parametrize("start_ns", [None, STAMP + 1000])
def test_execution_after_unmatched_break_rejects_before_book_or_identity_mutation(start_ns):
    decoder = Decoder(RECEIPT, ["SPY"], start_ns=start_ns)
    stream = (0x8005, 1, 123)
    decoder.consume_message(stream, 1, add(size=200), {})
    decoder.consume_message(stream, 2, trade(trade=9, size=100, kind=b"B", stamp=STAMP + 100), {})
    before_orders = {k: dict(v) for k, v in decoder.orders.items()}
    before_rows = list(decoder.prints["SPY"])
    with pytest.raises(DecodeError, match="execution follows unmatched native trade break"):
        decoder.consume_message(stream, 3, execution(trade=9, size=100, stamp=STAMP + 50), {})
    assert decoder.orders == before_orders
    assert decoder.prints["SPY"] == before_rows
    assert decoder.trades == {}
    assert decoder.stats["native_identity_signatures"] == 1
    assert decoder.stats["gross_executed_shares"] == 0


def test_early_break_rejects_before_break_identity_or_conservation_mutation():
    decoder = Decoder(RECEIPT, ["SPY"])
    stream = (0x8005, 1, 123)
    decoder.consume_message(stream, 1, add(size=200), {})
    decoder.consume_message(stream, 2, execution(trade=9, size=100, stamp=STAMP + 100), {})
    before_orders = {k: dict(v) for k, v in decoder.orders.items()}
    with pytest.raises(DecodeError, match="trade break precedes target execution timestamp"):
        decoder.consume_message(stream, 3, trade(trade=9, size=100, kind=b"B", stamp=STAMP + 50), {})
    assert decoder.orders == before_orders
    assert decoder.broken == {}
    assert decoder.stats["native_identity_signatures"] == 1
    assert decoder.stats["gross_executed_shares"] == 100
    assert decoder.stats["matched_break_shares"] == 0
