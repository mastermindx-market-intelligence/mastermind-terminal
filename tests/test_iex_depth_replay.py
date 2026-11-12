"""Read-only depth projection tests on the existing native order lifecycle."""
import io
import struct
from copy import deepcopy

import pytest
from ingest.iex_deep_trades import Decoder, Limits, decode_stream
from ingest.iex_depth_replay import DepthSampler
from test_iex_deep_trades import (
    STAMP, RECEIPT, add, modify, remove, clear, execution, trade, transport, ethernet, classic,
)


def packet(messages, sequence=1, offset=0, second=0, channel=1):
    wire = bytearray(transport(messages, sequence=sequence, offset=offset, channel=channel))
    struct.pack_into("<q", wire, 32, STAMP + second * 10**9)
    return ethernet(bytes(wire))


def size(messages):
    return sum(len(m) + 2 for m in messages)


def decoder(sampler=None, **options):
    sampler = sampler or DepthSampler(interval_ms=1)
    return Decoder(RECEIPT, ["SPY"], observer=sampler, **options), sampler


def test_snapshot_uses_actual_remaining_order_state_not_executed_volume():
    d, s = decoder()
    d.consume_packet(packet([add(order=1, side=b"8", size=200), add(order=2, size=300),
                             execution(order=2, size=80)], second=1), {})
    point = s.points["SPY"][-1]
    assert point["status"] == "observed"
    assert point["bids"] == [{"priceInt": 1000000, "quantity": 200}]
    assert point["asks"] == [{"priceInt": 1000000, "quantity": 220}]
    assert point["orderCount"] == 2
    assert d.stats["gross_executed_shares"] == 80
    assert point["availableNs"] == str(d.receipt["acquired_ns"])
    assert point["sourceSequence"] == "3"


def test_redundant_packet_does_not_apply_fill_or_add_snapshot_again():
    d, s = decoder()
    raw = packet([add(), execution()], second=1)
    d.consume_packet(raw, {})
    d.consume_packet(raw, {})
    assert len(s.points["SPY"]) == 1
    assert s.points["SPY"][0]["asks"][0]["quantity"] == 100
    assert d.stats["gross_executed_shares"] == 100


def test_modify_is_new_total_and_remove_is_not_a_trade():
    d, s = decoder()
    messages = [add(), modify(size=700, price=1000200), remove()]
    d.consume_packet(packet(messages, second=1), {})
    assert s.points["SPY"][-1]["asks"] == []
    assert s.points["SPY"][-1]["status"] == "observed"
    assert d.stats["gross_executed_shares"] == 0


def test_gap_withholds_depth_then_explicit_clear_restores_only_known_state():
    d, s = decoder()
    first = [add()]
    d.consume_packet(packet(first, second=1), {})
    second = [modify(size=900)]
    d.consume_packet(packet(second, sequence=3, offset=size(first) + 40, second=2), {})
    assert s.points["SPY"][-1]["status"] == "unavailable"
    assert s.points["SPY"][-1]["asks"] == []
    third = [clear(), add(order=2, size=90)]
    d.consume_packet(packet(third, sequence=4, offset=size(first) + 40 + size(second), second=3), {})
    assert s.points["SPY"][-1]["status"] == "observed"
    assert s.points["SPY"][-1]["asks"][0]["quantity"] == 90


@pytest.mark.parametrize("orphan", [modify(order=999), remove(order=999), execution(order=999)])
def test_incomplete_lifecycle_is_not_a_complete_book(orphan):
    d, s = decoder()
    d.consume_packet(packet([add(), orphan], second=1), {})
    assert s.points["SPY"][-1]["reason"] == "incomplete_order_chain"
    assert s.points["SPY"][-1]["bidTotal"] == 0
    assert s.points["SPY"][-1]["asks"] == []


def test_unknown_prefix_never_certifies_an_empty_book():
    d, s = decoder()
    d.consume_packet(packet([add()], sequence=50, offset=100, second=1), {})
    assert s.points["SPY"][-1]["reason"] == "source_gap_or_prefix"


def test_break_revises_trade_accounting_but_never_restores_displayed_order():
    d, s = decoder()
    d.consume_packet(packet([add(size=200), execution(size=100),
                             trade(kind=b"B", size=100, trade=1, stamp=STAMP+20)], second=1), {})
    assert s.points["SPY"][-1]["asks"][0]["quantity"] == 100
    assert d.stats["matched_break_shares"] == 100


def test_depth_limits_do_not_mutate_or_truncate_incumbent_execution_accounting():
    d, s = decoder(DepthSampler(interval_ms=1, max_frames=1, max_levels=1))
    first = [add(order=1, price=1000000), add(order=2, price=1000100), execution(order=1)]
    d.consume_packet(packet(first, second=1), {})
    d.consume_packet(packet([trade(size=70)], sequence=4, offset=size(first), second=2), {})
    point = s.points["SPY"][0]
    assert point["levelsTruncated"] is True
    assert len(point["asks"]) == 1
    assert point["askTotal"] == 300
    assert "SPY" in s.truncated
    assert d.stats["gross_executed_shares"] == 170


def test_sampled_observations_are_not_interpolated_into_missing_seconds():
    d, s = decoder(DepthSampler(interval_ms=5000))
    first = [add(), execution()]
    d.consume_packet(packet(first, second=1), {})
    d.consume_packet(packet([modify(size=900)], sequence=3, offset=size(first), second=8), {})
    assert [int(p["marketNs"]) for p in s.points["SPY"]] == [STAMP+10**9, STAMP+8*10**9]


def test_conflicting_symbol_streams_are_not_summed():
    d, s = decoder()
    d.consume_packet(packet([add()], second=1, channel=1), {})
    d.consume_packet(packet([add(size=999)], second=2, channel=2), {})
    d.consume_packet(packet([modify(size=900)], sequence=2, offset=size([add()]), second=3), {})
    assert s.points["SPY"][-1]["reason"] == "multiple_source_streams"


def test_attachment_preserves_every_original_execution_object(monkeypatch):
    monkeypatch.setattr("ingest.iex_deep_trades.time.time_ns", lambda: 1791430000000000000)
    raw = classic([packet([add(), execution(), trade()], second=1)])
    plain, plain_audit, plain_private = decode_stream(io.BytesIO(raw), RECEIPT, ["SPY"])
    sampled, audit, private = decode_stream(io.BytesIO(raw), RECEIPT, ["SPY"], observer=DepthSampler())
    depth = sampled["SPY"].pop("depthReplay")
    assert plain == sampled
    depth_audit = audit.pop("depthReplay")
    assert len(depth_audit["samplerSourceSha256"]) == 64
    assert depth_audit["samplesBySymbol"] == {"SPY": 1}
    assert plain_audit == audit
    assert plain_private == private
    assert depth["measurement"] == "discrete_observed_book_not_time_weighted"
    assert depth["priceScale"] == 10000
    assert depth["coverage"] == "partial"


def test_future_packet_clock_is_refused_without_a_mislabelled_frame():
    d, s = decoder()
    raw = bytearray(transport([add()]))
    struct.pack_into("<q", raw, 32, d.receipt["acquired_ns"]+1)
    with pytest.raises(ValueError, match="acquisition"):
        d.consume_packet(ethernet(bytes(raw)), {})
    assert not s.points["SPY"]


@pytest.mark.parametrize("kwargs", [{"interval_ms":0}, {"max_frames":2001}, {"max_levels":65}, {"max_frames":True}])
def test_settings_are_strictly_bounded(kwargs):
    with pytest.raises(ValueError):
        DepthSampler(**kwargs)
