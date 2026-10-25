"""Optional read-only depth sampler on the incumbent IEX DEEP+ Decoder.

No source download, packet parser, order lifecycle, trade accounting or writer
is duplicated here. Samples are discrete book observations, NOT time-weighted
liquidity or a continuous quote history. The existing decoder owns all state.
"""
from __future__ import annotations

from collections import defaultdict
import struct

JS_MAX = 2**53 - 1


class DepthSampler:
    def __init__(self, interval_ms: int = 5000, max_frames: int = 480,
                 max_levels: int = 32):
        if (type(interval_ms) is not int or not 1 <= interval_ms <= 60000
                or type(max_frames) is not int or not 1 <= max_frames <= 2000
                or type(max_levels) is not int or not 1 <= max_levels <= 64):
            raise ValueError("invalid bounded depth sample settings")
        self.interval_ms, self.max_frames, self.max_levels = interval_ms, max_frames, max_levels
        self.points = defaultdict(list)
        self.binding = {}
        self.multiple_streams = set()
        self.unsafe = {}
        self.watermarks = {}
        self.last_errors = 0
        self.truncated = set()

    def after_message(self, decoder, stream, sequence, body, meta):
        # Native state has already been validated, deduplicated and applied.
        if body[:1] not in (b"S", b"D", b"H", b"I", b"O", b"P", b"E", b"a", b"M", b"R", b"C", b"L", b"T", b"B"):
            return
        stamp = struct.unpack_from("<q", body, 2)[0]
        self.watermarks[stream] = max(stamp, self.watermarks.get(stream, 0))
        if len(body) < 18 or body[:1] == b"S":
            return
        symbol = body[10:18].decode("ascii").rstrip(" ")
        if symbol not in decoder.symbols or body[:1] not in (b"a", b"M", b"R", b"C", b"L", b"T", b"B"):
            return
        if symbol in self.binding and self.binding[symbol] != stream:
            # Separate transports are not blindly combined into a single book.
            self.multiple_streams.add(symbol)
        else:
            self.binding[symbol] = stream
        errors = sum(decoder.stats[name] for name in (
            "orphan_removes", "orphan_modifications", "orphan_executions",
            "execution_exceeds_known_order", "order_capacity_refusals"))
        key = (stream, symbol)
        if body[:1] == b"C":
            self.unsafe.pop(key, None)
        elif errors > self.last_errors:
            self.unsafe[key] = "incomplete_order_chain"
        self.last_errors = errors

    def after_packet(self, decoder, stream, meta):
        state = decoder.streams.get(stream)
        if not state:
            return
        send_ns = int(meta["sendTimestampNs"])
        market_ns = max(send_ns, self.watermarks.get(stream, 0))
        if market_ns < 0 or market_ns > decoder.receipt["acquired_ns"]:
            raise ValueError("depth packet clock exceeds archive acquisition")
        if decoder.start_ns is not None and market_ns < decoder.start_ns:
            return
        if decoder.end_ns is not None and market_ns >= decoder.end_ns:
            return
        for symbol, bound in self.binding.items():
            if bound != stream:
                continue
            key = (stream, symbol)
            reason = ("multiple_source_streams" if symbol in self.multiple_streams else
                      "source_gap_or_prefix" if stream in decoder.tainted and key not in decoder.reset_symbols else
                      self.unsafe.get(key))
            points = self.points[symbol]
            sequence = state["next"] - 1
            if points:
                previous = points[-1]
                # A retransmission/heartbeat may carry an older wire timestamp
                # but cannot describe a new book state at that old timestamp.
                if sequence <= int(previous["sourceSequence"]) and reason == previous["reason"]:
                    continue
                if market_ns < int(previous["marketNs"]):
                    raise ValueError("depth observation clock regressed after a new source state")
                changed_quality = reason != previous["reason"]
                if not changed_quality and market_ns - int(previous["marketNs"]) < self.interval_ms * 1_000_000:
                    continue
            if len(points) >= self.max_frames:
                self.truncated.add(symbol)
                points.pop(0)  # bounded recent observations, never a fabricated continuous history
            bids, asks = defaultdict(int), defaultdict(int)
            order_count = 0
            if reason is None:
                for (order_stream, order_symbol, _), order in decoder.orders.items():
                    if order_stream != stream or order_symbol != symbol:
                        continue
                    if not order["qualified"]:
                        reason = "incomplete_order_chain"
                        break
                    target = bids if order["side"] == "buy" else asks
                    target[order["price"]] += order["quantity"]
                    if target[order["price"]] > JS_MAX:
                        raise ValueError("depth level exceeds exact integer capacity")
                    order_count += 1
            if reason is not None:
                bids.clear()
                asks.clear()
                order_count = 0
            bid_total, ask_total = sum(bids.values()), sum(asks.values())
            if max(bid_total, ask_total) > JS_MAX:
                raise ValueError("depth total exceeds exact integer capacity")
            points.append({
                "marketNs": str(market_ns), "transportSendNs": str(send_ns),
                "availableNs": str(decoder.receipt["acquired_ns"]),
                "sourceSequence": str(sequence), "session": decoder.normalized_session(stream),
                "status": "unavailable" if reason else "observed", "reason": reason,
                "bids": [{"priceInt": p, "quantity": q} for p, q in sorted(bids.items(), reverse=True)[:self.max_levels]],
                "asks": [{"priceInt": p, "quantity": q} for p, q in sorted(asks.items())[:self.max_levels]],
                "bidTotal": bid_total, "askTotal": ask_total, "orderCount": order_count,
                "levelsTruncated": len(bids) > self.max_levels or len(asks) > self.max_levels,
            })

    def attach(self, envelopes, decoder):
        for symbol, envelope in envelopes.items():
            points = self.points[symbol]
            envelope["depthReplay"] = {
                "schema": "mastermind.iex_depth_snapshots.v1", "symbol": symbol,
                "sourceSha256": decoder.receipt["sha256"], "priceScale": envelope["instrument"]["priceScale"],
                "quantityUnit": "shares", "venue": "IEX", "coverage": "partial",
                "measurement": "discrete_observed_book_not_time_weighted",
                "availabilityBasis": "archive_acquisition",
                "intervalMs": self.interval_ms, "maxLevelsPerSide": self.max_levels,
                "samplingTruncated": symbol in self.truncated, "samples": points,
            }
