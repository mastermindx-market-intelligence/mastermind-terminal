"""Private TP-1 native-T conversion for the existing Large Trades engine.

No socket, signer, feed attestation, publisher or public admission. The input is
Macro's equity.tick_plane.stream_event/v0, never minute/R0 aggregates. Quantities
are all reported integral shares, gross before correction reconciliation and
without condition-qualified consolidated-volume or pressure authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path

SCHEMA = "equity.tick_plane.stream_event/v0"
MAX_SAFE = 2**53 - 1
MAX_NS = 10**20 - 1
MAX_BYTES = 16 * 1024 * 1024
MAX_RECORDS = 100_000
ID = re.compile(r"^[A-Za-z0-9_.:/@+\-]{1,240}$")
DECIMAL = re.compile(r"^(0|[1-9][0-9]*)(?:\.([0-9]+))?$")
SESSION = re.compile(r"^([0-9]{4}-[0-9]{2}-[0-9]{2}):(RTH|PRE|POST)$")
SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,19}$")
SHA = re.compile(r"^[a-f0-9]{64}$")


class Tp1TradeRefusal(ValueError):
    """Whole-candidate refusal; never silently truncate or publish a subset."""


def _integer(value, name, minimum=0, maximum=MAX_NS):
    if type(value) is not int or not minimum <= value <= maximum:
        raise Tp1TradeRefusal(name + ":invalid_integer")
    return value


def _text(value, name, limit=256):
    if not isinstance(value, str) or not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise Tp1TradeRefusal(name + ":invalid_text")
    return value


def _decimal(value, name):
    if not isinstance(value, str) or len(value) > 128:
        raise Tp1TradeRefusal(name + ":invalid_decimal")
    m = DECIMAL.fullmatch(value)
    if not m:
        raise Tp1TradeRefusal(name + ":invalid_decimal")
    whole, fraction = m.group(1), (m.group(2) or "").rstrip("0")
    if int(whole) == 0 and not fraction:
        raise Tp1TradeRefusal(name + ":nonpositive")
    return int(whole), fraction


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise Tp1TradeRefusal("duplicate_json_key:" + key)
        value[key] = item
    return value


def _invalid_constant(value):
    raise Tp1TradeRefusal("invalid_json_constant:" + value)


def convert_tp1_native_trades(
    raw: bytes, *, symbol: str, source_id: str, source_ref: str,
    fixture: bool = False, acquired_at_ns: int | None = None,
):
    """Return private evidence plus a v1 envelope; no output is public-feed eligible.

    Explicit fixture mode uses original synthetic receipts. Historical acquisition
    uses the later acquisition clock and preserves original receipt separately.
    Neither mode establishes authentic source custody. Native SIP time is reporting
    time at millisecond precision, not a reconstructed earlier execution time.
    """
    if type(raw) is not bytes or not raw or len(raw) > MAX_BYTES:
        raise Tp1TradeRefusal("input:byte_budget")
    if not SYMBOL.fullmatch(symbol) or not ID.fullmatch(source_id):
        raise Tp1TradeRefusal("input:identity")
    _text(source_ref, "source_ref", 500)
    if type(fixture) is not bool or fixture == (acquired_at_ns is not None):
        raise Tp1TradeRefusal("choose_fixture_or_historical_acquisition")
    if acquired_at_ns is not None:
        _integer(acquired_at_ns, "acquired_at_ns", 1)
    try:
        rows = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise Tp1TradeRefusal("input:invalid_json") from exc
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_RECORDS:
        raise Tp1TradeRefusal("input:record_budget")
    parsed, identities = [], {}
    total = 0
    for row in rows:
        if not isinstance(row, dict) or row.get("schema") != SCHEMA or row.get("event_type") != "T":
            raise Tp1TradeRefusal("native_T_required")
        native_fields = {
            "schema", "ticker", "session", "source", "event_type", "native_sequence",
            "sip_timestamp_ns", "participant_timestamp_ns", "source_timestamp_precision",
            "original_frame_received_ns", "source_receipt_id", "source_frame_sha256",
            "frame_event_index", "source_status", "correction_status", "eligible_for_pressure",
            "conditions_rules_ref", "market_tape", "trade_id", "dedup_key", "price",
            "size_integer_shares", "decimal_size_shares", "trade_conditions", "exchange",
            "trf_id", "trf_timestamp_ns", "venue_class", "trade_action",
        }
        if set(row) != native_fields or row["venue_class"] not in {"LIT", "TRF", "UNKNOWN"}:
            raise Tp1TradeRefusal("native_fields:unsupported")
        required = {
            "source": "MASSIVE_STOCKS_SIP_WS",
            "source_status": "RECEIPT_UNQUALIFIED_UNTIL_OWNER_ATTESTS",
            "correction_status": "STREAM_PROVISIONAL_UNRECONCILED",
            "trade_action": "UNRESOLVED_STREAM_ORIGINAL",
            "source_timestamp_precision": "MILLISECONDS",
            "ticker": symbol,
        }
        if any(row.get(k) != v for k, v in required.items()):
            raise Tp1TradeRefusal("native_contract_mismatch")
        if row.get("eligible_for_pressure") is not None or row.get("conditions_rules_ref") is not None:
            raise Tp1TradeRefusal("native_contract:unexpected_qualification")
        session = _text(row.get("session"), "session", 32)
        match = SESSION.fullmatch(session)
        if not match:
            raise Tp1TradeRefusal("session:invalid")
        try:
            date.fromisoformat(match.group(1))
        except ValueError as exc:
            raise Tp1TradeRefusal("session:invalid") from exc
        sip = _integer(row.get("sip_timestamp_ns"), "sip_timestamp_ns", 1)
        received = _integer(row.get("original_frame_received_ns"), "original_frame_received_ns", sip)
        if sip % 1_000_000:
            raise Tp1TradeRefusal("sip_timestamp_ns:precision_mismatch")
        if acquired_at_ns is not None and received > acquired_at_ns:
            raise Tp1TradeRefusal("acquisition_precedes_original_receipt")
        for name in ("participant_timestamp_ns", "trf_timestamp_ns"):
            value = row.get(name)
            if value is not None and _integer(value, name, 1) % 1_000_000:
                raise Tp1TradeRefusal(name + ":precision_mismatch")
        sequence = _integer(row.get("native_sequence"), "native_sequence")
        exchange = _integer(row.get("exchange"), "exchange", maximum=MAX_SAFE)
        trf = row.get("trf_id")
        if trf is not None:
            _integer(trf, "trf_id", maximum=MAX_SAFE)
        if row.get("market_tape") is not None:
            _integer(row["market_tape"], "market_tape", maximum=MAX_SAFE)
        _integer(row.get("frame_event_index"), "frame_event_index", maximum=1999)
        _text(row.get("source_receipt_id"), "source_receipt_id")
        if not isinstance(row.get("source_frame_sha256"), str) or not SHA.fullmatch(row["source_frame_sha256"]):
            raise Tp1TradeRefusal("source_frame_sha256:invalid")
        trade_id = _text(row.get("trade_id"), "trade_id")
        key = f"{session}:{symbol}:{exchange}:{trf if trf is not None else '-'}:{trade_id}:{sip}"
        if row.get("dedup_key") != key or not ID.fullmatch(key):
            raise Tp1TradeRefusal("dedup_key:contradictory_or_unrepresentable")
        quantity = _integer(row.get("size_integer_shares"), "size_integer_shares", maximum=MAX_SAFE)
        whole, fraction = _decimal(row.get("decimal_size_shares"), "decimal_size_shares")
        if fraction:
            raise Tp1TradeRefusal("UNSUPPORTED_FRACTIONAL_QUANTITY")
        if whole != quantity or quantity < 1:
            raise Tp1TradeRefusal("quantity:contradictory")
        price, places = _decimal(row.get("price"), "price")
        if len(places) > 9:
            raise Tp1TradeRefusal("UNSUPPORTED_PRICE_SCALE")
        conditions = row.get("trade_conditions")
        if not isinstance(conditions, list) or len(conditions) > 16:
            raise Tp1TradeRefusal("conditions:unsupported_count")
        for condition in conditions:
            _integer(condition, "condition", maximum=MAX_SAFE)
        # Transport metadata may change on retransmission; economics must not.
        economic = (price, places, quantity, tuple(conditions),
                    row.get("participant_timestamp_ns"), row.get("trf_timestamp_ns"))
        if key in identities and identities[key] != economic:
            raise Tp1TradeRefusal("CONFLICTING_ECONOMIC_ID")
        if key not in identities:
            total += quantity
            if total > MAX_SAFE:
                raise Tp1TradeRefusal("QUANTITY_OVERFLOW")
            identities[key] = economic
        parsed.append((row, key, sip, received, sequence, quantity, price, places))

    # A fixed unit keeps earlier prices invariant when later finer-price prints arrive.
    price_places, price_scale = 9, 10**9
    prints = []
    for row, key, sip, received, sequence, quantity, price, places in parsed:
        price_int = price * price_scale + int(places.ljust(price_places, "0") or "0")
        if not 1 <= price_int <= MAX_SAFE:
            raise Tp1TradeRefusal("UNSAFE_SCALED_PRICE")
        prints.append({
            "id": key, "kind": "trade", "eventNs": str(sip),
            "availableNs": str(received if fixture else acquired_at_ns),
            "sourceSequence": str(sequence), "session": row["session"],
            "priceInt": price_int, "quantity": quantity,
            "side": "unknown", "sideMethod": "unknown", "eligible": True,
            "conditions": [str(c) for c in row["trade_conditions"]],
            "sourceRecordType": "MASSIVE_T",
        })
    generated = max(int(p["availableNs"]) for p in prints)
    digest = hashlib.sha256(raw).hexdigest()
    envelope = {
        "schema": "mastermind.large_trades.v1",
        "instrument": {
            "symbol": symbol, "instrumentId": "tp1:" + symbol, "assetClass": "equity",
            "quantityUnit": "shares", "priceScale": price_scale,
            "tickSizeInt": None, "timezone": "America/New_York",
        },
        "provenance": {
            "provider": "Equity tick feed", "dataset": "TP-1 native T private conversion",
            "venue": "Supplied SIP reports", "scope": "consolidated",
            "dataMode": "fixture" if fixture else "historical",
            "evidenceMode": "FIXTURE" if fixture else "HISTORICAL_REPLAY",
            "sourceId": source_id, "sourceSha256": digest, "sourceRef": source_ref,
            "generatedAtNs": str(generated),
            "acquiredAtNs": None if fixture else str(acquired_at_ns),
            "receiptBasis": "fixture" if fixture else "archive_acquisition",
            "coverage": "unknown", "sequenceGaps": 0, "delayMs": None,
            "conditionPolicy": "All supplied native T reports; condition and consolidated-volume eligibility unqualified.",
            "attribution": "Synthetic native trade fixture. No market-feed evidence." if fixture else
                "Private historical reconstruction. Source authenticity and completeness are unverified.",
            "termsUrl": None, "timestampBasis": "sip_reporting_time",
            "timestampPrecision": "milliseconds",
        },
        "accounting": {
            "quantityBasis": "gross_as_reported", "correctionCoverage": "unsupported",
            "correctionEvidence": None,
        },
        "range": {"startNs": str(min(int(p["eventNs"]) for p in prints)),
                  "endNs": str(max(int(p["eventNs"]) for p in prints))},
        "prints": prints, "responses": [], "responseCoverage": "unavailable",
        "responseKnownAtNs": None,
    }
    return {
        "schema": "mastermind.large_trades.tp1_private_conversion.v1",
        "sourceAuthenticated": False, "productionApproved": False,
        "publicDeliveryAllowed": False,
        "evidenceMode": "FIXTURE" if fixture else "UNVERIFIED_PRIVATE_REPLAY",
        "originalByteSha256": digest, "uniqueReportedShares": total,
        "sourceRecords": rows, "envelope": envelope,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, help="Private evidence file; not a publisher path")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--source-ref", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--fixture", action="store_true")
    mode.add_argument("--acquired-at-ns", type=int)
    args = parser.parse_args()
    result = convert_tp1_native_trades(args.input.read_bytes(), symbol=args.symbol,
        source_id=args.source_id, source_ref=args.source_ref,
        fixture=args.fixture, acquired_at_ns=args.acquired_at_ns)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
