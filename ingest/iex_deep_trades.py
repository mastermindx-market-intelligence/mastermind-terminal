"""Bounded offline IEX DEEP+ 1.0 execution decoder; no network or live source.

Native executions L and T are separate volume populations. B is a later trade
break, never a new execution. Historical acquisition is the knowledge clock;
capture and exchange timestamps do not establish Mastermind live possession.
"""
from __future__ import annotations

import argparse
from collections import Counter, OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import struct
import sys
import time
from typing import BinaryIO, Iterator

SCHEMA = "mastermind.large_trades.v1"
PROTOCOL = 0x8005
PRICE_SCALE = 10000
JS_MAX = 2**53 - 1
TERMS_URL = "https://www.iex.io/legal/hist-data-terms"
ATTRIBUTION = (
    "Data provided for free by IEX. By accessing or using IEX Historical Data, "
    "you agree to the IEX Historical Data Terms of Use."
)
SPECS = {
    "deep_plus": "https://www.iex.io/documents/iex-deep-plus-specification",
    "transport": "https://www.iex.io/documents/iex-tp-v1",
    "pcapng": "https://www.ietf.org/ietf-ftp/internet-drafts/draft-ietf-opsawg-pcapng-06.html",
}
TRADE_FLAGS = {
    0x80: "intermarket_sweep", 0x40: "extended_hours", 0x20: "odd_lot",
    0x10: "trade_through_exempt", 0x08: "single_price_cross",
}
# These messages do not change displayed-order lifecycle. Unknown message types
# invalidate dependent side inference instead of being treated as harmless.
ADMIN_TYPES = {b"S", b"D", b"H", b"O", b"P", b"E", b"I"}
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,7}$")


class DecodeError(ValueError):
    """Malformed or contradictory source data; do not publish a success."""


class LimitReached(Exception):
    """An explicit scan ceiling, not evidence of file/session completeness."""


@dataclass(frozen=True)
class Limits:
    max_decompressed_bytes: int = 512 * 1024 * 1024
    max_packets: int = 2_000_000
    max_messages: int = 8_000_000
    max_output_records: int = 10_000
    max_orders: int = 100_000
    recent_sequences: int = 65_536
    max_streams: int = 32

    def __post_init__(self):
        for name, value in vars(self).items():
            if type(value) is not int or value <= 0:
                raise ValueError(f"{name} must be a positive integer")


class BoundedReader:
    def __init__(self, raw: BinaryIO, limit: int):
        self.raw, self.limit, self.bytes_read = raw, limit, 0
        self.digest = hashlib.sha256()

    def exact(self, n: int, *, eof_ok: bool = False) -> bytes | None:
        if n < 0:
            raise DecodeError("negative read size")
        if self.bytes_read + n > self.limit:
            raise LimitReached("decompressed_byte_limit")
        data = self.raw.read(n)
        self.bytes_read += len(data)
        self.digest.update(data)
        if not data and eof_ok:
            return None
        if len(data) != n:
            raise DecodeError("truncated capture")
        return data


def _options(data: bytes, endian: str) -> dict[int, bytes]:
    result = {}
    i = 0
    while i < len(data):
        if i + 4 > len(data):
            raise DecodeError("truncated PCAPNG option header")
        code, length = struct.unpack_from(endian + "HH", data, i)
        i += 4
        if code == 0:
            if length != 0 or any(data[i:]):
                raise DecodeError("invalid PCAPNG option terminator")
            break
        end = i + length
        padded = (end + 3) & ~3
        if padded > len(data):
            raise DecodeError("truncated PCAPNG option value")
        if code in (9, 14) and code in result:
            raise DecodeError("duplicate PCAPNG clock option")
        result[code] = data[i:end]
        i = padded
    return result


def _clock(ticks: int, denominator: int, offset_seconds: int) -> dict:
    numerator = ticks * 1_000_000_000
    exact_ns = offset_seconds * 1_000_000_000 + numerator // denominator
    return {
        "captureTicks": str(ticks),
        "captureTicksPerSecond": str(denominator),
        "captureOffsetSeconds": str(offset_seconds),
        "captureTimestampNs": str(exact_ns) if numerator % denominator == 0 else None,
    }


def capture_packets(reader: BoundedReader, stats: Counter, limits: Limits) -> Iterator[tuple[bytes, dict]]:
    """Read classic PCAP or section-aware PCAPNG without unpacking the archive."""
    magic = reader.exact(4, eof_ok=True)
    if magic is None:
        raise DecodeError("empty capture")
    pcap = {
        b"\xd4\xc3\xb2\xa1": ("<", 1_000_000),
        b"\xa1\xb2\xc3\xd4": (">", 1_000_000),
        b"\x4d\x3c\xb2\xa1": ("<", 1_000_000_000),
        b"\xa1\xb2\x3c\x4d": (">", 1_000_000_000),
    }
    if magic in pcap:
        endian, denominator = pcap[magic]
        header = reader.exact(20)
        major, minor, _, _, snaplen, linktype = struct.unpack(endian + "HHiiII", header)
        if (major, minor) != (2, 4) or linktype != 1 or not 0 < snaplen <= 16 * 1024 * 1024:
            raise DecodeError("unsupported PCAP version, linktype, or snaplen")
        stats["classic_pcap_sections"] += 1
        while True:
            if stats["packets"] >= limits.max_packets:
                raise LimitReached("packet_limit")
            h = reader.exact(16, eof_ok=True)
            if h is None:
                return
            sec, fraction, captured, original = struct.unpack(endian + "IIII", h)
            if fraction >= denominator or captured > snaplen or captured > original:
                raise DecodeError("invalid PCAP packet header")
            if captured != original:
                raise DecodeError("truncated on-wire PCAP packet")
            packet = reader.exact(captured)
            stats["packets"] += 1
            yield packet, {
                "container": "PCAP", "packetIndex": stats["packets"], "interfaceId": 0,
                **_clock(sec * denominator + fraction, denominator, 0),
            }
    elif magic == b"\x0a\x0d\x0d\x0a":
        endian = None
        interfaces = []
        block_type_bytes = magic
        while True:
            length_bytes = reader.exact(4)
            if block_type_bytes == b"\x0a\x0d\x0d\x0a":
                bom = reader.exact(4)
                if bom == b"\x4d\x3c\x2b\x1a":
                    endian = "<"
                elif bom == b"\x1a\x2b\x3c\x4d":
                    endian = ">"
                else:
                    raise DecodeError("invalid PCAPNG byte-order magic")
                total = struct.unpack(endian + "I", length_bytes)[0]
                if total < 28 or total % 4 or total > 16 * 1024 * 1024:
                    raise DecodeError("invalid PCAPNG section length")
                block = bom + reader.exact(total - 12)
                if struct.unpack_from(endian + "I", block, len(block) - 4)[0] != total:
                    raise DecodeError("PCAPNG block trailer mismatch")
                if struct.unpack_from(endian + "HH", block, 4) != (1, 0):
                    raise DecodeError("unsupported PCAPNG section version")
                _options(block[16:-4], endian)
                interfaces = []
                stats["pcapng_sections"] += 1
            else:
                if endian is None:
                    raise DecodeError("PCAPNG block before section")
                block_type = struct.unpack(endian + "I", block_type_bytes)[0]
                total = struct.unpack(endian + "I", length_bytes)[0]
                if total < 12 or total % 4 or total > 16 * 1024 * 1024:
                    raise DecodeError("invalid PCAPNG block length")
                block = reader.exact(total - 8)
                if struct.unpack_from(endian + "I", block, len(block) - 4)[0] != total:
                    raise DecodeError("PCAPNG block trailer mismatch")
                body = block[:-4]
                if block_type == 1:
                    if len(body) < 8:
                        raise DecodeError("short PCAPNG interface")
                    linktype, reserved, snaplen = struct.unpack_from(endian + "HHI", body)
                    if linktype != 1 or reserved != 0 or snaplen > 16 * 1024 * 1024:
                        raise DecodeError("unsupported PCAPNG interface linktype")
                    options = _options(body[8:], endian)
                    resolution = options.get(9, b"\x06")
                    offset = options.get(14, b"\x00" * 8)
                    if len(resolution) != 1 or len(offset) != 8:
                        raise DecodeError("invalid PCAPNG timestamp option")
                    exponent = resolution[0] & 0x7F
                    if exponent > 63:
                        raise DecodeError("unsupported timestamp precision")
                    denominator = (2 if resolution[0] & 0x80 else 10) ** exponent
                    interfaces.append((snaplen, denominator, struct.unpack(endian + "q", offset)[0]))
                elif block_type == 6:
                    if stats["packets"] >= limits.max_packets:
                        raise LimitReached("packet_limit")
                    if len(body) < 20:
                        raise DecodeError("short PCAPNG enhanced packet")
                    interface, high, low, captured, original = struct.unpack_from(endian + "IIIII", body)
                    if interface >= len(interfaces):
                        raise DecodeError("unknown PCAPNG interface")
                    snaplen, denominator, offset = interfaces[interface]
                    padded = (captured + 3) & ~3
                    if captured != original or (snaplen and captured > snaplen) or 20 + padded > len(body):
                        raise DecodeError("truncated or invalid PCAPNG packet")
                    _options(body[20 + padded:], endian)
                    stats["packets"] += 1
                    yield body[20:20 + captured], {
                        "container": "PCAPNG", "packetIndex": stats["packets"], "interfaceId": interface,
                        **_clock((high << 32) | low, denominator, offset),
                    }
                    if stats["packets"] >= limits.max_packets:
                        raise LimitReached("packet_limit")
                elif block_type in (2, 3):
                    raise DecodeError("unsupported legacy/simple PCAPNG packet block")
                else:
                    stats["pcapng_nonpacket_blocks"] += 1
            block_type_bytes = reader.exact(4, eof_ok=True)
            if block_type_bytes is None:
                return
    else:
        raise DecodeError("unsupported capture magic")


def udp_payload(packet: bytes, stats: Counter) -> tuple[bytes, dict] | None:
    if len(packet) < 14:
        raise DecodeError("short Ethernet frame")
    ethertype = struct.unpack_from("!H", packet, 12)[0]
    offset = 14
    vlan_count = 0
    while ethertype in (0x8100, 0x88A8, 0x9100):
        if offset + 4 > len(packet) or vlan_count >= 4:
            raise DecodeError("invalid Ethernet VLAN stack")
        ethertype = struct.unpack_from("!H", packet, offset + 2)[0]
        offset += 4
        vlan_count += 1
    if ethertype == 0x0800:
        if len(packet) < offset + 20:
            raise DecodeError("short IPv4 packet")
        header_len = (packet[offset] & 0x0F) * 4
        total = struct.unpack_from("!H", packet, offset + 2)[0]
        if packet[offset] >> 4 != 4 or header_len < 20 or total < header_len or offset + total > len(packet):
            raise DecodeError("invalid IPv4 lengths")
        if struct.unpack_from("!H", packet, offset + 6)[0] & 0x3FFF:
            raise DecodeError("fragmented IPv4 unsupported")
        if packet[offset + 9] != 17:
            stats["non_udp_packets"] += 1
            return None
        source = str(ipaddress.ip_address(packet[offset + 12:offset + 16]))
        dest = str(ipaddress.ip_address(packet[offset + 16:offset + 20]))
        end, udp = offset + total, offset + header_len
    elif ethertype == 0x86DD:
        if len(packet) < offset + 40 or packet[offset] >> 4 != 6:
            raise DecodeError("invalid IPv6 packet")
        payload_len = struct.unpack_from("!H", packet, offset + 4)[0]
        end = offset + 40 + payload_len
        if end > len(packet) or payload_len == 0:
            raise DecodeError("invalid IPv6 length")
        source = str(ipaddress.ip_address(packet[offset + 8:offset + 24]))
        dest = str(ipaddress.ip_address(packet[offset + 24:offset + 40]))
        next_header, udp = packet[offset + 6], offset + 40
        for _ in range(8):
            if next_header not in (0, 43, 60, 51):
                break
            if udp + 2 > end:
                raise DecodeError("short IPv6 extension")
            length = (packet[udp + 1] + (2 if next_header == 51 else 1)) * (4 if next_header == 51 else 8)
            next_header = packet[udp]
            udp += length
            if udp > end:
                raise DecodeError("invalid IPv6 extension")
        if next_header == 44:
            raise DecodeError("fragmented IPv6 unsupported")
        if next_header != 17:
            stats["non_udp_packets"] += 1
            return None
    else:
        stats["non_ip_packets"] += 1
        return None
    if udp + 8 > end:
        raise DecodeError("short UDP header")
    source_port, dest_port, length, _ = struct.unpack_from("!HHHH", packet, udp)
    if length < 8 or udp + length != end:
        raise DecodeError("UDP length disagrees with IP payload")
    stats["udp_packets"] += 1
    return packet[udp + 8:end], {
        "ipSource": source, "ipDestination": dest,
        "udpSourcePort": source_port, "udpDestinationPort": dest_port,
    }


def transport_messages(payload: bytes) -> tuple[dict, list[tuple[int, int, bytes]]]:
    if len(payload) < 40:
        raise DecodeError("short IEX-TP header")
    version, reserved, protocol, channel, session, length, count, stream_offset, sequence, sent = struct.unpack_from(
        "<BBHIIHHqqq", payload
    )
    if version != 1 or reserved != 0 or protocol != PROTOCOL:
        raise DecodeError("expected IEX-TP1 DPLS protocol 0x8005")
    if length != len(payload) - 40 or min(stream_offset, sequence, sent) < 0:
        raise DecodeError("invalid IEX-TP length or clock")
    if (count == 0) != (length == 0):
        raise DecodeError("invalid heartbeat framing")
    out = []
    offset = 40
    relative = 0
    for i in range(count):
        if offset + 2 > len(payload):
            raise DecodeError("truncated message prefix")
        size = struct.unpack_from("<H", payload, offset)[0]
        if size == 0 or offset + 2 + size > len(payload):
            raise DecodeError("invalid message length")
        out.append((sequence + i, stream_offset + relative, payload[offset + 2:offset + 2 + size]))
        offset += 2 + size
        relative += 2 + size
    if offset != len(payload):
        raise DecodeError("IEX-TP message count/payload mismatch")
    return {
        "protocol": protocol, "channel": channel, "sessionId": session,
        "firstSequence": sequence, "streamOffset": stream_offset,
        "sendTimestampNs": str(sent), "messageCount": count,
    }, out


def _symbol(body: bytes) -> str:
    if len(body) < 18:
        raise DecodeError("short symbol-bearing message")
    try:
        symbol = body[10:18].decode("ascii").rstrip(" ")
    except UnicodeDecodeError as exc:
        raise DecodeError("non-ASCII symbol") from exc
    if not symbol or len(symbol) > 8 or any(ord(c) < 33 or ord(c) > 126 for c in symbol):
        raise DecodeError("invalid source symbol")
    return symbol


def _epoch_ns(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone-aware timestamp required")
    utc = parsed.astimezone(timezone.utc)
    delta = utc - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000_000 + delta.microseconds * 1000


def validate_receipt(receipt: dict, archive: Path | None = None) -> dict:
    if (receipt.get("schema") != "mastermind.iex_hist_acquisition.v1"
            or receipt.get("feed") != "DPLS" or receipt.get("protocol") != "IEXTP1"
            or receipt.get("version") != "1.0" or receipt.get("scope") != "IEX venue only"):
        raise DecodeError("unqualified IEX acquisition receipt")
    digest = receipt.get("sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise DecodeError("invalid recorded archive hash")
    day = receipt.get("date")
    if not isinstance(day, str) or not re.fullmatch(r"\d{8}", day):
        raise DecodeError("invalid trading date")
    datetime.strptime(day, "%Y%m%d")
    acquired = _epoch_ns(receipt["acquired_at_utc"])
    if acquired < 0:
        raise DecodeError("invalid acquisition time")
    actual, expected = receipt.get("actual_size_bytes"), receipt.get("expected_size_bytes")
    if type(actual) is not int or actual <= 0 or actual != expected:
        raise DecodeError("acquisition receipt size mismatch")
    if archive is not None and archive.stat().st_size != actual:
        raise DecodeError("archive size no longer matches acquisition receipt")
    return {**receipt, "acquired_ns": acquired}


class Decoder:
    def __init__(self, receipt: dict, symbols: list[str], limits: Limits | None = None,
                 start_ns: int | None = None, end_ns: int | None = None):
        self.receipt = validate_receipt(receipt)
        if not symbols or len(symbols) > 20 or len(set(symbols)) != len(symbols):
            raise ValueError("supply 1-20 unique symbols")
        if any(not SYMBOL_RE.fullmatch(s) for s in symbols):
            raise ValueError("unsafe/unsupported selected symbol spelling")
        if start_ns is not None and end_ns is not None and start_ns >= end_ns:
            raise ValueError("empty time selection")
        self.symbols = set(symbols)
        self.limits = limits or Limits()
        self.start_ns, self.end_ns = start_ns, end_ns
        self.stats = Counter()
        self.type_counts = Counter()
        self.streams = {}
        self.tainted = set()
        self.reset_symbols = set()
        self.orders = {}
        self.trades = {}
        self.broken = set()
        self.prints = {symbol: [] for symbol in symbols}
        self.private_records = []
        self.gaps = []
        self.first_event_ns = None
        self.last_event_ns = None

    def _invalidate(self, stream: tuple, reason: str):
        self.tainted.add(stream)
        self.reset_symbols = {key for key in self.reset_symbols if key[0] != stream}
        self.orders = {key: value for key, value in self.orders.items() if key[0] != stream}
        self.stats["lifecycle_invalidations"] += 1
        if len(self.gaps) < 100:
            self.gaps.append({"stream": list(stream), "reason": reason})

    def _accept_sequence(self, stream: tuple, sequence: int, offset: int, body: bytes) -> bool:
        state = self.streams.get(stream)
        if state is None:
            if len(self.streams) >= self.limits.max_streams:
                raise DecodeError("too many source streams")
            state = {"next": sequence, "offset": offset, "recent": OrderedDict()}
            self.streams[stream] = state
            if sequence > 1 or offset != 0:
                self.stats["unobserved_stream_prefixes"] += 1
                self._invalidate(stream, "unobserved_stream_prefix")
        digest = hashlib.sha256(body).digest()
        signature = (offset, digest)
        recent = state["recent"]
        if sequence < state["next"]:
            if sequence in recent:
                if recent[sequence] != signature:
                    raise DecodeError("conflicting retransmission at identical source sequence")
                self.stats["duplicate_messages"] += 1
            else:
                self.stats["replays_outside_cache"] += 1
                self._invalidate(stream, "unverifiable_replay_outside_cache")
            return False
        if sequence > state["next"] or offset != state["offset"]:
            self.stats["sequence_gap_events"] += 1
            self.stats["missing_message_sequences"] += max(0, sequence - state["next"])
            self._invalidate(stream, "sequence_or_byte_offset_gap")
        recent[sequence] = signature
        if len(recent) > self.limits.recent_sequences:
            recent.popitem(last=False)
        state["next"] = sequence + 1
        state["offset"] = offset + 2 + len(body)
        return True

    def consume_packet(self, packet: bytes, packet_meta: dict):
        udp = udp_payload(packet, self.stats)
        if udp is None:
            return
        payload, network = udp
        header, messages = transport_messages(payload)
        stream = (header["protocol"], header["channel"], header["sessionId"])
        if not messages:
            self.stats["heartbeats"] += 1
            state = self.streams.get(stream)
            if state and header["firstSequence"] > state["next"]:
                self.stats["sequence_gap_events"] += 1
                self.stats["missing_message_sequences"] += header["firstSequence"] - state["next"]
                self._invalidate(stream, "heartbeat_observed_missing_messages")
                state["next"], state["offset"] = header["firstSequence"], header["streamOffset"]
            return
        self.stats["data_packets"] += 1
        for sequence, offset, body in messages:
            if self.stats["message_records_seen"] >= self.limits.max_messages:
                raise LimitReached("message_limit")
            self.stats["message_records_seen"] += 1
            if not self._accept_sequence(stream, sequence, offset, body):
                continue
            self.stats["unique_messages"] += 1
            message_meta = {
                **packet_meta, **network, **header,
                "messageSequence": str(sequence), "messageStreamOffset": str(offset),
                "rawMessageSha256": hashlib.sha256(body).hexdigest(),
            }
            self.consume_message(stream, sequence, body, message_meta)

    def consume_message(self, stream: tuple, sequence: int, body: bytes, meta: dict):
        kind = body[:1]
        self.type_counts[kind.hex()] += 1
        if kind in ADMIN_TYPES:
            self.stats["admin_messages"] += 1
            return
        if kind not in {b"a", b"M", b"R", b"C", b"L", b"T", b"B"}:
            self.stats["unknown_message_types"] += 1
            self._invalidate(stream, "unknown_message_type_" + kind.hex())
            return
        required = {b"a": 38, b"M": 38, b"R": 26, b"C": 18, b"L": 46, b"T": 38, b"B": 38}[kind]
        if len(body) != required:
            raise DecodeError("invalid native " + kind.decode() + " message length")
        stamp = struct.unpack_from("<q", body, 2)[0]
        if stamp < 0:
            raise DecodeError("negative source timestamp")
        if stamp > self.receipt["acquired_ns"]:
            raise DecodeError("source event occurs after archive acquisition")
        symbol = _symbol(body)
        if symbol not in self.symbols:
            return
        if self.first_event_ns is None:
            self.first_event_ns = stamp
        self.last_event_ns = stamp
        order_key = None
        if kind in (b"a", b"M", b"R", b"L"):
            order_id = struct.unpack_from("<q", body, 18)[0]
            if order_id < 0:
                raise DecodeError("negative native order identifier")
            order_key = (stream, symbol, order_id)
        if kind == b"C":
            # DEEP+ defines this byte as reserved, without a mandatory value.
            self.stats["C_reserved_" + hex(body[1])] += 1
            self.orders = {key: value for key, value in self.orders.items() if key[:2] != (stream, symbol)}
            self.reset_symbols.add((stream, symbol))
            self.stats["clear_book_messages"] += 1
            return
        if kind == b"R":
            # Actual HIST uses 0x20; the documentation example uses 0x00.
            # Neither value is a side or a future-use semantic assertion.
            self.stats["R_reserved_" + hex(body[1])] += 1
            if self.orders.pop(order_key, None) is None:
                self.stats["orphan_removes"] += 1
            return
        if kind in (b"a", b"M"):
            size, price = struct.unpack_from("<Iq", body, 26)
            if price <= 0 or price > JS_MAX or size == 0:
                raise DecodeError("invalid displayed order price/size")
            if kind == b"a":
                if body[1] not in (ord("8"), ord("5")):
                    raise DecodeError("unknown native order side")
                if order_key in self.orders:
                    raise DecodeError("duplicate active native order ID")
                if len(self.orders) >= self.limits.max_orders:
                    self.stats["order_capacity_refusals"] += 1
                    self._invalidate(stream, "bounded_order_capacity")
                    return
                self.orders[order_key] = {
                    "side": "buy" if body[1] == ord("8") else "sell",
                    "quantity": size, "price": price,
                    "qualified": stream not in self.tainted or (stream, symbol) in self.reset_symbols,
                }
            else:
                if body[1] & ~1:
                    raise DecodeError("unknown order-modification flag")
                order = self.orders.get(order_key)
                if order is None:
                    self.stats["orphan_modifications"] += 1
                else:
                    order.update(quantity=size, price=price)
            return
        flags = body[1]
        if flags & ~0xF8:
            raise DecodeError("unknown trade flag bits")
        if kind == b"L":
            size, price, trade_id = struct.unpack_from("<Iqq", body, 26)
        else:
            size, price, trade_id = struct.unpack_from("<Iqq", body, 18)
        if size == 0 or price <= 0 or price > JS_MAX or trade_id < 0:
            raise DecodeError("invalid executed quantity/price/trade ID")
        trade_key = f"iex-dpls:{self.receipt['date']}:{stream[0]}:{stream[2]}:{symbol}:{trade_id}"
        signature = (kind.decode(), size, price, flags)
        if kind != b"B" and trade_key in self.trades:
            if self.trades[trade_key] != signature:
                raise DecodeError("conflicting native trade identity")
            self.stats["semantic_duplicate_trades"] += 1
            return
        side, side_method = "unknown", "unknown"
        native_order = self.orders.get(order_key) if kind == b"L" else None
        before = native_order["quantity"] if native_order else None
        if kind == b"L":
            if native_order is None:
                self.stats["orphan_executions"] += 1
            else:
                if size > native_order["quantity"]:
                    self.stats["execution_exceeds_known_order"] += 1
                    native_order["qualified"] = False
                if native_order["qualified"] and not flags & 0x08:
                    side = "sell" if native_order["side"] == "buy" else "buy"
                    side_method = "resting_order"
                remaining = native_order["quantity"] - size
                if remaining > 0:
                    native_order["quantity"] = remaining
                else:
                    self.orders.pop(order_key, None)
        # Native event order, not timestamp sorting, updates lifecycle. An event
        # time filter affects emitted records only and never creates a new book.
        if (self.start_ns is not None and stamp < self.start_ns) or (self.end_ns is not None and stamp >= self.end_ns):
            self.stats["time_filtered_executions"] += 1
            return
        if kind != b"B":
            self.trades[trade_key] = signature
            self.stats["gross_executed_shares"] += size
            self.stats["native_" + kind.decode() + "_executions"] += 1
            record_id, target_id = trade_key, None
        else:
            previous = self.trades.get(trade_key)
            if trade_key in self.broken:
                self.stats["duplicate_trade_breaks"] += 1
                return
            if previous is not None:
                if previous[1:3] != (size, price):
                    raise DecodeError("trade break price/quantity disagrees with target")
                self.stats["matched_break_shares"] += size
            else:
                self.stats["unmatched_trade_breaks"] += 1
            self.broken.add(trade_key)
            self.stats["native_B_breaks"] += 1
            record_id, target_id = f"{trade_key}:break:{sequence}", trade_key
            side, side_method = "unknown", "unknown"
        row = {
            "id": record_id, "kind": "cancel" if kind == b"B" else "trade",
            "eventNs": str(stamp), "availableNs": str(self.receipt["acquired_ns"]),
            "sourceSequence": str(sequence), "session": self.receipt["date"],
            "priceInt": price, "quantity": size, "side": side, "sideMethod": side_method,
            "eligible": True,
            "conditions": [name for bit, name in TRADE_FLAGS.items() if flags & bit],
            "sourceRecordType": kind.decode(),
        }
        if target_id is not None:
            row["targetId"] = target_id
        self.prints[symbol].append(row)
        self.private_records.append({
            "printId": record_id, "symbol": symbol, "nativeTradeId": str(trade_id),
            "restingOrderId": str(order_key[2]) if order_key is not None else None,
            "restingSideBefore": native_order["side"] if native_order else None,
            "orderQuantityBefore": before, "sideInferenceQualified": side_method == "resting_order",
            "nativeFlags": flags, "source": meta,
        })
        if sum(len(rows) for rows in self.prints.values()) >= self.limits.max_output_records:
            raise LimitReached("selected_record_limit")

    def envelopes(self, generated_ns: int) -> dict[str, dict]:
        out = {}
        for symbol, rows in self.prints.items():
            if not rows:
                continue
            stamps = [int(row["eventNs"]) for row in rows]
            out[symbol] = {
                "schema": SCHEMA,
                "instrument": {
                    "symbol": symbol, "instrumentId": "IEX:" + symbol,
                    "assetClass": "equity", "quantityUnit": "shares",
                    "priceScale": PRICE_SCALE, "tickSizeInt": None,
                    "timezone": "America/New_York",
                },
                "provenance": {
                    "provider": "IEX", "dataset": "HIST DEEP+ 1.0", "venue": "IEX",
                    "scope": "venue", "dataMode": "historical",
                    "evidenceMode": "HISTORICAL_REPLAY",
                    "sourceId": "iex-hist-dpls:" + self.receipt["date"] + ":" + self.receipt["sha256"][:16],
                    "sourceSha256": self.receipt["sha256"],
                    "sourceRef": self.receipt.get("source_url", SPECS["deep_plus"]),
                    "generatedAtNs": str(generated_ns), "acquiredAtNs": str(self.receipt["acquired_ns"]),
                    "receiptBasis": "archive_acquisition", "coverage": "partial",
                    "sequenceGaps": self.stats["sequence_gap_events"],
                    "delayMs": None,
                    "conditionPolicy": "IEX_DEEP_PLUS_1_0_NATIVE_L_T_VOLUME_ALL_DEFINED_FLAGS_V1",
                    "attribution": ATTRIBUTION, "termsUrl": TERMS_URL,
                },
                "range": {"startNs": str(min(stamps)), "endNs": str(max(stamps) + 1)},
                "prints": rows, "responses": [], "responseCoverage": "unavailable",
                "responseKnownAtNs": None,
            }
        return out


def decode_stream(raw: BinaryIO, receipt: dict, symbols: list[str], limits: Limits | None = None,
                  start_ns: int | None = None, end_ns: int | None = None,
                  progress=None) -> tuple[dict, dict, list[dict]]:
    decoder = Decoder(receipt, symbols, limits, start_ns, end_ns)
    reader = BoundedReader(raw, decoder.limits.max_decompressed_bytes)
    stop_reason, exhausted = "end_of_file", False
    try:
        for packet, meta in capture_packets(reader, decoder.stats, decoder.limits):
            decoder.consume_packet(packet, meta)
            if progress and decoder.stats["packets"] % 100_000 == 0:
                progress({
                    "packets": decoder.stats["packets"], "decompressedBytes": reader.bytes_read,
                    "uniqueMessages": decoder.stats["unique_messages"],
                    "selectedRecords": sum(len(r) for r in decoder.prints.values()),
                })
        exhausted = True
    except LimitReached as exc:
        stop_reason = str(exc)
    generated = time.time_ns()
    envelopes = decoder.envelopes(generated)
    audit = {
        "schema": "mastermind.iex_large_trades_decode.v1",
        "generatedAtNs": str(generated), "symbols": symbols,
        "requestedStartNs": str(start_ns) if start_ns is not None else None,
        "requestedEndNs": str(end_ns) if end_ns is not None else None,
        "limits": vars(decoder.limits),
        "stopReason": stop_reason, "archiveExhausted": exhausted,
        "gzipFullIntegrityChecked": False,
        "decompressedBytesRead": reader.bytes_read,
        "decompressedPrefixSha256": reader.digest.hexdigest(),
        "recordedArchiveSha256": decoder.receipt["sha256"],
        "archiveSha256IndependentlyRecomputed": False,
        "acquisitionReceipt": {k: v for k, v in decoder.receipt.items() if k != "acquired_ns"},
        "counters": dict(decoder.stats), "nativeMessageTypeHexCounts": dict(decoder.type_counts),
        "gapExamples": decoder.gaps,
        "rowsBySymbol": {s: len(rows) for s, rows in decoder.prints.items()},
        "conservation": {
            "grossExecutedShares": decoder.stats["gross_executed_shares"],
            "matchedBrokenShares": decoder.stats["matched_break_shares"],
            "netUnbrokenShares": decoder.stats["gross_executed_shares"] - decoder.stats["matched_break_shares"],
            "unmatchedBreaksSubtractNothing": True,
        },
        "coverage": "partial", "sideMethod": "native_resting_order_chain_inference_or_unknown",
        "originalIntradayMastermindAvailabilityProven": False,
        "consolidatedNbboAvailable": False, "responseCoverage": "unavailable",
        "predictiveValidation": False,
        "checksumValidation": "container_and_lengths_only_not_network_checksums_or_source_authentication",
        "sourceSpecifications": SPECS,
    }
    return envelopes, audit, decoder.private_records


def _write_private_json(path: Path, value):
    content = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    return {"file": path.name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--symbols", required=True, help="1-20 exact comma-separated source symbols")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    parser.add_argument("--max-packets", type=int, default=2_000_000)
    parser.add_argument("--max-messages", type=int, default=8_000_000)
    parser.add_argument("--max-records", type=int, default=10_000)
    args = parser.parse_args(argv)
    receipt_path = args.receipt or Path(str(args.archive) + ".receipt.json")
    receipt_bytes = receipt_path.read_bytes()
    receipt = validate_receipt(json.loads(receipt_bytes), args.archive)
    if args.output_dir.exists():
        raise DecodeError("output directory already exists; reconcile it before another write")
    limits = Limits(
        max_decompressed_bytes=args.max_bytes, max_packets=args.max_packets,
        max_messages=args.max_messages, max_output_records=args.max_records,
    )
    started = time.monotonic()
    with gzip.open(args.archive, "rb") as raw:
        envelopes, audit, private = decode_stream(
            raw, receipt, args.symbols.split(","), limits,
            _epoch_ns(args.start) if args.start else None,
            _epoch_ns(args.end) if args.end else None,
            progress=lambda state: print(json.dumps({"progress": state}), flush=True),
        )
    audit["gzipFullIntegrityChecked"] = audit["archiveExhausted"]
    audit.update(
        acquisitionReceiptSha256=hashlib.sha256(receipt_bytes).hexdigest(),
        decoderSourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        elapsedSeconds=round(time.monotonic() - started, 3),
        archivePath=str(args.archive.resolve()),
    )
    args.output_dir.mkdir(parents=True, mode=0o700, exist_ok=False)
    artifacts = [_write_private_json(args.output_dir / (symbol + ".json"), envelope)
                 for symbol, envelope in envelopes.items()]
    artifacts.append(_write_private_json(args.output_dir / "native-record-provenance.json", private))
    audit["artifacts"] = artifacts
    receipt_artifact = _write_private_json(args.output_dir / "decode-receipt.json", audit)
    print(json.dumps({
        "status": "BOUNDED_HISTORICAL_SAMPLE", "outputDir": str(args.output_dir),
        "stopReason": audit["stopReason"], "rowsBySymbol": audit["rowsBySymbol"],
        "counters": audit["counters"], "conservation": audit["conservation"],
        "decompressedBytesRead": audit["decompressedBytesRead"],
        "decompressedPrefixSha256": audit["decompressedPrefixSha256"],
        "receipt": receipt_artifact, "elapsedSeconds": audit["elapsedSeconds"],
    }), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (DecodeError, ValueError, OSError, EOFError) as exc:
        print(json.dumps({"status": "REFUSED", "reason": str(exc)}), file=sys.stderr)
        raise SystemExit(2)
