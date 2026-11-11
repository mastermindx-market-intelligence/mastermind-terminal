"""Native producer fixture -> private converter; no provider or publication access."""
import copy
import json
from pathlib import Path

import pytest

from ingest.tp1_large_trades import MAX_SAFE, Tp1TradeRefusal, convert_tp1_native_trades

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "terminal/lib/__tests__/fixtures"
RAW = (FIXTURES / "tp1LargeTrades.native.synthetic.v0.json").read_bytes()
ROWS = json.loads(RAW)
OPTIONS = dict(symbol="AAPL", source_id="fixture:tp1-large-trades-v1",
               source_ref="fixture:tp1-native-v0", fixture=True)


def convert(rows=None, **changes):
    return convert_tp1_native_trades(
        RAW if rows is None else (json.dumps(rows) + "\n").encode(),
        **(OPTIONS | changes))


def change_first(**changes):
    rows = copy.deepcopy(ROWS)
    rows[0].update(changes)
    return rows


def rekey(row):
    trf = row["trf_id"] if row["trf_id"] is not None else "-"
    row["dedup_key"] = (f'{row["session"]}:{row["ticker"]}:{row["exchange"]}:'
                        f'{trf}:{row["trade_id"]}:{row["sip_timestamp_ns"]}')
    return row


def test_native_producer_fixture_matches_consumed_golden_without_authenticity_claim():
    result = convert()
    assert result["envelope"] == json.loads(
        (FIXTURES / "tp1LargeTrades.envelope.synthetic.v1.json").read_text())
    assert result["uniqueReportedShares"] == 3101
    assert len(result["sourceRecords"]) == 6  # Includes a retransmission.
    assert result["sourceRecords"] == ROWS
    assert result["sourceAuthenticated"] is False
    assert result["productionApproved"] is False
    assert result["publicDeliveryAllowed"] is False
    assert result["envelope"]["accounting"] == {
        "quantityBasis": "gross_as_reported", "correctionCoverage": "unsupported",
        "correctionEvidence": None}
    assert all(p["side"] == p["sideMethod"] == "unknown"
               for p in result["envelope"]["prints"])
    assert result["envelope"]["instrument"]["tickSizeInt"] is None
    assert result["envelope"]["responses"] == []


def test_exact_native_clocks_price_and_sequence_survive():
    result = convert()
    p = result["envelope"]["prints"][0]
    assert p["sourceSequence"] == "9007199254740993"
    assert p["eventNs"] == str(ROWS[0]["sip_timestamp_ns"])
    assert p["availableNs"].endswith("123")
    assert p["priceInt"] == 225_000_000_000
    assert result["sourceRecords"][0]["participant_timestamp_ns"] < int(p["eventNs"])
    assert result["envelope"]["provenance"]["timestampBasis"] == "sip_reporting_time"
    assert result["envelope"]["provenance"]["timestampPrecision"] == "milliseconds"


@pytest.mark.parametrize(("integer", "decimal"), [(1, "1.5"), (0, "0.125"), (500, "500.0001")])
def test_fractional_candidate_is_refused_whole(integer, decimal):
    with pytest.raises(Tp1TradeRefusal, match="UNSUPPORTED_FRACTIONAL_QUANTITY"):
        convert(change_first(size_integer_shares=integer, decimal_size_shares=decimal))


def test_integral_decimal_spelling_and_retransmission_do_not_create_another_trade():
    a = copy.deepcopy(ROWS[0])
    b = copy.deepcopy(a)
    b.update(price="225.0000", decimal_size_shares="500.000",
             source_receipt_id="fixture:another-frame", source_frame_sha256="a" * 64)
    result = convert([a, b])
    assert result["uniqueReportedShares"] == 500
    assert result["envelope"]["prints"][0]["id"] == result["envelope"]["prints"][1]["id"]


def test_exchange_and_trf_scopes_remain_distinct():
    rows = [copy.deepcopy(ROWS[0]) for _ in range(3)]
    rows[1].update(exchange=4, trf_id=201, venue_class="TRF")
    rows[2].update(exchange=4, trf_id=202, venue_class="TRF")
    result = convert([rekey(r) for r in rows])
    assert result["uniqueReportedShares"] == 1500
    assert len({p["id"] for p in result["envelope"]["prints"]}) == 3


@pytest.mark.parametrize("changes", [
    {"size_integer_shares": 501, "decimal_size_shares": "501"},
    {"price": "225.01"}, {"trade_conditions": [12]},
])
def test_conflicting_economics_refuse_the_candidate(changes):
    a = copy.deepcopy(ROWS[0])
    b = copy.deepcopy(a)
    b.update(changes)
    with pytest.raises(Tp1TradeRefusal, match="CONFLICTING_ECONOMIC_ID"):
        convert([a, b])


@pytest.mark.parametrize(("field", "value"), [
    ("native_sequence", True), ("native_sequence", 1.5),
    ("sip_timestamp_ns", True), ("sip_timestamp_ns", float(ROWS[0]["sip_timestamp_ns"])),
    ("original_frame_received_ns", str(ROWS[0]["original_frame_received_ns"])),
    ("size_integer_shares", True), ("frame_event_index", 2000),
    ("trade_conditions", [1] * 17), ("source_frame_sha256", "missing"),
    ("dedup_key", "invented"), ("decimal_size_shares", "501"),
    ("price", "225.0000000001"), ("price", "10000000"),
    ("sip_timestamp_ns", ROWS[0]["sip_timestamp_ns"] + 1),
    ("source_timestamp_precision", "NANOSECONDS"),
])
def test_unsupported_or_inexact_native_fields_refuse(field, value):
    with pytest.raises(Tp1TradeRefusal):
        convert(change_first(**{field: value}))


@pytest.mark.parametrize("row", [
    {"schema": "equity.tick_plane.minute/v0", "event_type": "T"},
    {"schema": "equity.tick_plane.provisional_print_observation/v0"},
    {"schema": "equity.tick_plane.stream_event/v0", "event_type": "Q"},
])
def test_aggregates_quotes_and_signed_observations_are_not_native_trades(row):
    with pytest.raises(Tp1TradeRefusal, match="native_T_required"):
        convert([ROWS[0], row])


def test_later_side_decision_cannot_be_backdated_into_native_receipt():
    # The raw-native contract has no qualified side. A later signed observation
    # belongs to its existing owner and requires an explicit separate knowledge clock.
    with pytest.raises(Tp1TradeRefusal, match="native_fields"):
        convert(change_first(side="BUY", decision_ns=ROWS[0]["original_frame_received_ns"] + 1_000_000))


def test_historical_acquisition_is_later_knowledge_and_remains_unverified():
    acquired = max(r["original_frame_received_ns"] for r in ROWS) + 10_000_000_000
    result = convert(fixture=False, acquired_at_ns=acquired)
    assert {p["availableNs"] for p in result["envelope"]["prints"]} == {str(acquired)}
    assert result["sourceRecords"] == ROWS
    assert result["envelope"]["provenance"]["dataMode"] == "historical"
    assert result["envelope"]["provenance"]["receiptBasis"] == "archive_acquisition"
    assert result["evidenceMode"] == "UNVERIFIED_PRIVATE_REPLAY"
    assert result["sourceAuthenticated"] is result["publicDeliveryAllowed"] is False
    with pytest.raises(Tp1TradeRefusal, match="acquisition_precedes"):
        convert(fixture=False, acquired_at_ns=acquired - 20_000_000_000)


def test_unique_quantity_overflow_is_refused():
    rows = copy.deepcopy(ROWS[:2])
    rows[0].update(size_integer_shares=MAX_SAFE, decimal_size_shares=str(MAX_SAFE))
    with pytest.raises(Tp1TradeRefusal, match="QUANTITY_OVERFLOW"):
        convert(rows)


def test_future_price_precision_does_not_rewrite_prefix_prices_or_identity():
    prefix = convert(ROWS[:3])["envelope"]
    full = convert()["envelope"]
    assert prefix["instrument"] == full["instrument"]
    assert prefix["prints"] == full["prints"][:3]


def test_duplicate_json_keys_are_refused():
    raw = RAW.replace(b'"event_type": "T"', b'"event_type": "Q", "event_type": "T"', 1)
    with pytest.raises(Tp1TradeRefusal, match="duplicate_json_key"):
        convert_tp1_native_trades(raw, **OPTIONS)


def test_mode_is_explicit_and_cannot_claim_live():
    with pytest.raises(Tp1TradeRefusal, match="choose_fixture"):
        convert(fixture=False)
    with pytest.raises(Tp1TradeRefusal, match="choose_fixture"):
        convert(acquired_at_ns=ROWS[-1]["original_frame_received_ns"])
