"""Tests for `mastermind.reported-ownership/v1` (ingest/reported_ownership.py).

Covers the normalizer against the incumbent raw collector cache: the exact-bytes receipt, date and
error preservation, the deliberate absence of Value/pctChange and of every float, the degraded
retention path (which must never restamp old data as current), and the cross-language content-hash
golden that `terminal/lib/__tests__/reportedOwnership.test.ts` asserts against the same fixture.

The fixtures under `tests/fixtures/reported_ownership/` are SYNTHETIC. Their shape is copied from
the real collector cache; the rows, timestamps and hashes are invented for tests. Nothing here is
evidence of a live provider fetch.
"""
from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest import reported_ownership as ro  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures" / "reported_ownership"
CA_RAW = FIXTURES / "ca_institutional_holders.json"

# The cross-language golden. `reportedOwnership.test.ts` recomputes content_sha256 over the block
# this module produces and must land on the same string, byte for byte, through JSON.stringify.
GOLDEN_RAW_INPUT_SHA256 = "6ce24e30cb01094a17a2a8b5f772c7a53f8d2d2d2822120a9752a4c181688933"
GOLDEN_CONTENT_SHA256 = "6d895c41f7b2af4d5ab2b0d7aee2ab0611d4e4574eb6ce3939ff69ba03f0777e"


def raw_payload(**overrides):
    """A minimal realistic cache payload; `institutional_holders` is overridable per test."""
    payload = {
        "ticker": "RY.TO",
        "fetched_at": "2026-10-22T04:52:16Z",
        "institutional_holders": {
            "columns": ["Date Reported", "Holder", "pctHeld", "Shares", "Value", "pctChange"],
            "index": ["0"],
            "data": [["2026-06-30", "Royal Bank of Canada", 0.0507, 70220631, 19915975021, -0.0148]],
        },
        "_errors": [],
    }
    payload.update(overrides)
    return payload


def encode(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def build(payload_or_bytes, ticker="RY.TO", previous=None, latest_attempt_at=None):
    # bytes and Path are handed to the normalizer as-is (it accepts either); dicts are encoded.
    raw = payload_or_bytes if isinstance(payload_or_bytes, (bytes, Path)) else encode(payload_or_bytes)
    return ro.build_reported_ownership(
        raw, expected_ticker=ticker, previous=previous, latest_attempt_at=latest_attempt_at
    )


# ── the receipt is over the exact bytes, and the golden is stable ──────────────
def test_shared_fixture_receipt_is_over_the_exact_raw_bytes():
    block = build(CA_RAW.read_bytes())
    assert block["raw_input_sha256"] == GOLDEN_RAW_INPUT_SHA256
    assert hashlib.sha256(CA_RAW.read_bytes()).hexdigest() == GOLDEN_RAW_INPUT_SHA256


def test_cross_language_hash_golden():
    block = build(CA_RAW.read_bytes())
    assert block["content_sha256"] == GOLDEN_CONTENT_SHA256
    # Recomputing after a JSON round-trip must not move the hash.
    assert ro.content_sha256(json.loads(json.dumps(block))) == GOLDEN_CONTENT_SHA256


def test_terminal_side_block_fixture_is_what_this_normalizer_produces():
    """One block file, asserted on both sides, so the two languages cannot drift silently.

    `terminal/lib/__tests__/reportedOwnership.test.ts` re-hashes this exact file through
    JSON.stringify and must reach the same content_sha256 the normalizer wrote here.
    """
    fixture = ROOT / "terminal" / "lib" / "__tests__" / "fixtures" / "reported_ownership" / "ca_block.json"
    block = build(CA_RAW.read_bytes())
    assert json.loads(fixture.read_text(encoding="utf-8")) == block
    assert block["content_sha256"] == GOLDEN_CONTENT_SHA256


def test_cache_path_is_accepted_as_well_as_bytes():
    from_bytes = build(CA_RAW.read_bytes())
    from_path = build(CA_RAW)
    assert from_bytes == from_path


def test_block_holds_no_json_numbers_anywhere():
    """The whole point of canonical strings: Python and JS cannot disagree on a number."""

    def walk(node, path="$"):
        if isinstance(node, bool) or node is None or isinstance(node, str):
            return
        assert not isinstance(node, (int, float)), f"numeric leaf at {path}: {node!r}"
        if isinstance(node, list):
            for index, item in enumerate(node):
                walk(item, f"{path}[{index}]")
        else:
            for key, item in node.items():
                walk(item, f"{path}.{key}")

    walk(build(CA_RAW.read_bytes()))
    with pytest.raises(AssertionError):
        ro._assert_no_numbers({"nope": 1.5})


def test_canonical_json_is_sorted_compact_and_unescaped():
    canonical = ro.canonical_json({"b": "1", "a": {"d": "2", "c": ["3", "4"]}, "e": "中國信託"})
    assert canonical == '{"a":{"c":["3","4"],"d":"2"},"b":"1","e":"中國信託"}'
    assert " " not in canonical


# ── what the block preserves and what it refuses ──────────────────────────────
def test_dates_shares_and_fraction_are_preserved_verbatim():
    rows = build(CA_RAW.read_bytes())["rows"]
    assert rows[0] == {
        "holder_name": "Royal Bank of Canada",
        "reported_date": "2026-06-30",
        "shares": "70220631",
        "reported_fraction": "0.0507",
    }
    # The non-ASCII holder name survives normalization unescaped for the JS side to re-hash.
    assert rows[1]["holder_name"] == "中國信託金融控股"
    # A different report date per holder is preserved as stated, not collapsed to one date.
    assert {row["reported_date"] for row in rows} == {"2026-03-31", "2026-06-30"}


def test_value_and_pct_change_are_never_carried_through():
    """A value with no currency and a period change are both claims this panel does not make."""
    block = build(CA_RAW.read_bytes())
    canonical = ro.canonical_json(block)
    assert "19915975021" not in canonical  # Value
    assert "pctChange" not in canonical
    assert '"value"' not in canonical.lower()
    assert not any("count" in key or "total" in key for key in block)


def test_acquired_at_is_the_raw_fetched_at_and_publication_time_stays_null():
    # acquired_at is never re-derived from the clock; it is the raw fetched_at verbatim.
    block = build(raw_payload(fetched_at="2026-07-02T03:04:05Z"))
    assert block["acquired_at"] == "2026-07-02T03:04:05Z"
    assert block["latest_attempt_at"] == "2026-07-02T03:04:05Z"
    assert block["publication_time"] is None


def test_source_label_is_fixed_and_scoped_to_the_listing():
    block = build(CA_RAW.read_bytes())
    assert block["source"] == {
        "name": "Yahoo Finance",
        "adapter": "yfinance",
        "field": "institutional_holders",
        "url": "https://finance.yahoo.com/quote/RY.TO/holders/",
    }
    assert block["listing"] == {"ticker": "RY.TO", "market": "ca"}
    assert block["population"] == "vendor_institutional_holders"
    assert block["percentage_basis"] == "provider_reported_unspecified"


def test_hk_listing_is_scoped_to_hk():
    block = build(raw_payload(ticker="0700.HK"), ticker="0700.HK")
    assert block["listing"] == {"ticker": "0700.HK", "market": "hk"}
    assert block["source"]["url"] == "https://finance.yahoo.com/quote/0700.HK/holders/"


def test_unsupported_market_yields_no_block_rather_than_a_guessed_one():
    assert build(raw_payload(ticker="600519.SS"), ticker="600519.SS") is None
    assert build(raw_payload(ticker="AAPL"), ticker="AAPL") is None


def test_a_payload_for_another_listing_is_never_relabeled():
    block = build(raw_payload(ticker="SHOP.TO"), ticker="RY.TO")
    assert block["availability"] == ro.UNAVAILABLE
    assert block["unavailable_reason"] == ro.REASON_TICKER_MISMATCH
    assert block["rows"] == []


# ── missing receipts produce no qualified block ───────────────────────────────
def test_missing_fetched_at_means_no_qualified_block():
    payload = raw_payload()
    del payload["fetched_at"]
    block = build(payload)
    assert block["availability"] == ro.UNAVAILABLE
    assert block["unavailable_reason"] == ro.REASON_ACQUIRED_AT_MISSING
    assert block["rows"] == []
    assert block["raw_input_sha256"] is None


def test_unparsable_raw_is_a_status_not_a_crash():
    block = build(b"{not json")
    assert block["unavailable_reason"] == ro.REASON_RAW_UNPARSABLE
    assert block["acquired_at"] is None


def test_non_finite_json_constant_is_refused_not_nan_nulled():
    """A NaN must fail the parse; it must never become a null that reads as "not reported"."""
    raw = b'{"ticker":"RY.TO","fetched_at":"2026-10-22T04:52:16Z","_errors":[],"institutional_holders":{"columns":["Holder","pctHeld"],"data":[["A",NaN]]}}'
    block = ro.build_reported_ownership(raw, expected_ticker="RY.TO")
    assert block["unavailable_reason"] == ro.REASON_RAW_UNPARSABLE


# ── row qualification ─────────────────────────────────────────────────────────
def test_undated_rows_are_dropped_and_the_block_says_it_is_partial():
    payload = raw_payload(
        institutional_holders={
            "columns": ["Date Reported", "Holder", "pctHeld", "Shares"],
            "data": [
                ["2026-06-30", "Royal Bank of Canada", 0.0507, 70220631],
                [None, "Undated Manager", 0.01, 100],
                ["", "Blank Date Manager", 0.01, 100],
            ],
        }
    )
    block = build(payload)
    assert [row["holder_name"] for row in block["rows"]] == ["Royal Bank of Canada"]
    assert block["availability"] == ro.PARTIAL
    assert block["unavailable_reason"] == ro.REASON_ROWS_DROPPED


def test_impossible_calendar_dates_are_not_surviving_strings():
    payload = raw_payload(
        institutional_holders={
            "columns": ["Date Reported", "Holder", "pctHeld"],
            "data": [["2026-02-30", "Impossible Day", 0.01], ["2026-06-30", "Fine", 0.01]],
        }
    )
    rows = build(payload)["rows"]
    assert [row["holder_name"] for row in rows] == ["Fine"]


def test_a_report_date_after_acquisition_is_dropped_not_shown_as_recent():
    payload = raw_payload(
        fetched_at="2026-06-30T00:00:00Z",
        institutional_holders={
            "columns": ["Date Reported", "Holder", "pctHeld"],
            "data": [["2026-12-31", "From The Future", 0.01], ["2026-03-31", "Plausible", 0.01]],
        },
    )
    rows = build(payload)["rows"]
    assert [row["holder_name"] for row in rows] == ["Plausible"]


def test_fraction_bounds_are_decided_without_binary_floating_point():
    payload = raw_payload(
        institutional_holders={
            "columns": ["Date Reported", "Holder", "pctHeld"],
            "data": [
                ["2026-06-30", "Over One", 1.4],
                ["2026-06-30", "Negative", -0.01],
                ["2026-06-30", "Exactly One", 1.0],
                ["2026-06-30", "Tiny But Valid", 1e-05],
            ],
        }
    )
    rows = {row["holder_name"]: row["reported_fraction"] for row in build(payload)["rows"]}
    assert rows["Over One"] is None  # out of unit interval is unknown here, never clamped
    assert rows["Negative"] is None
    assert rows["Exactly One"] == "1"
    assert rows["Tiny But Valid"] == "0.00001"  # exponent input normalizes to plain decimal


def test_share_counts_that_are_not_integers_are_unknown_not_zero():
    payload = raw_payload(
        institutional_holders={
            "columns": ["Date Reported", "Holder", "Shares"],
            "data": [
                ["2026-06-30", "Fractional", 70220631.5],
                ["2026-06-30", "Integral Float", 70220631.0],
                ["2026-06-30", "Missing", None],
            ],
        }
    )
    shares = {row["holder_name"]: row["shares"] for row in build(payload)["rows"]}
    assert shares == {"Fractional": None, "Integral Float": "70220631", "Missing": None}


def test_no_qualifying_dated_rows_is_an_explicit_absence():
    payload = raw_payload(institutional_holders=None)
    block = build(payload)
    assert block["availability"] == ro.UNAVAILABLE
    assert block["unavailable_reason"] == ro.REASON_NO_DATED_ROWS
    assert block["rows"] == []


def test_columns_are_read_by_name_not_position():
    """The provider has reordered these columns before; a positional read would mis-attribute."""
    payload = raw_payload(
        institutional_holders={
            "columns": ["pctChange", "Holder", "Value", "Date Reported", "Shares", "pctHeld"],
            "data": [[-0.0148, "Reordered Manager", 19915975021, "2026-06-30", 70220631, 0.0507]],
        }
    )
    row = build(payload)["rows"][0]
    assert row == {
        "holder_name": "Reordered Manager",
        "reported_date": "2026-06-30",
        "shares": "70220631",
        "reported_fraction": "0.0507",
    }


def test_duplicate_holder_date_pairs_collapse():
    payload = raw_payload(
        institutional_holders={
            "columns": ["Date Reported", "Holder", "pctHeld"],
            "data": [
                ["2026-06-30", "Royal Bank of Canada", 0.0507],
                ["2026-06-30", "Royal Bank of Canada", 0.0507],
            ],
        }
    )
    assert len(build(payload)["rows"]) == 1


# ── collector error preservation ──────────────────────────────────────────────
def test_field_error_as_collector_list_form_degrades_the_block():
    payload = raw_payload(_errors=["institutional_holders:HTTPError", "info:KeyError"])
    block = build(payload)
    assert block["availability"] == ro.PARTIAL
    assert block["unavailable_reason"] == ro.REASON_FETCH_FIELD_ERROR
    assert len(block["rows"]) == 1


def test_an_empty_errors_object_is_not_a_field_error():
    """The `_errors` type differs between writers; an empty object means no errors, not a failure."""
    assert build(raw_payload(_errors={}))["availability"] == ro.AVAILABLE
    assert build(raw_payload(_errors=[]))["availability"] == ro.AVAILABLE
    assert build(raw_payload(_errors={"institutional_holders": "HTTPError"}))["unavailable_reason"] == (
        ro.REASON_FETCH_FIELD_ERROR
    )
    assert build(raw_payload(_errors=["info:KeyError"]))["availability"] == ro.AVAILABLE


def test_field_error_with_no_rows_is_a_source_error():
    payload = raw_payload(institutional_holders=None, _errors=["institutional_holders:HTTPError"])
    block = build(payload)
    assert block["availability"] == ro.SOURCE_ERROR
    assert block["unavailable_reason"] == ro.REASON_FETCH_FIELD_ERROR


# ── retention: keep the data, never restamp it ────────────────────────────────
def test_retained_rows_keep_their_original_acquisition_and_dates():
    qualified = build(CA_RAW.read_bytes())
    stale_attempt = raw_payload(
        fetched_at="2026-11-30T09:00:00Z", institutional_holders=None, _errors=["institutional_holders:HTTPError"]
    )
    degraded = build(stale_attempt, previous=qualified)

    assert degraded["availability"] == ro.PARTIAL
    assert degraded["unavailable_reason"] == ro.REASON_FETCH_FIELD_ERROR
    assert degraded["rows"] == qualified["rows"]
    # The receipt still describes the bytes the retained rows actually came from.
    assert degraded["raw_input_sha256"] == GOLDEN_RAW_INPUT_SHA256
    # The acquisition clock does NOT advance to the failed attempt.
    assert degraded["acquired_at"] == "2026-10-22T04:52:16Z"
    # ...but the attempt clock does, because an attempt really was made then.
    assert degraded["latest_attempt_at"] == "2026-11-30T09:00:00Z"
    assert ro.content_sha256(degraded) == degraded["content_sha256"]


def test_retained_block_without_a_known_attempt_time_stays_unknown():
    qualified = build(CA_RAW.read_bytes())
    degraded = build(raw_payload(institutional_holders=None, _errors=["institutional_holders:HTTPError"]), previous=qualified)
    assert degraded["latest_attempt_at"] == "2026-10-22T04:52:16Z"  # falls back to the prior attempt
    assert degraded["acquired_at"] == "2026-10-22T04:52:16Z"


def test_unreadable_raw_retains_rather_than_blanking_the_panel():
    qualified = build(CA_RAW.read_bytes())
    degraded = build(Path("/nonexistent/RY.TO.json"), previous=qualified)
    assert degraded["unavailable_reason"] == ro.REASON_RAW_UNAVAILABLE
    assert len(degraded["rows"]) == 3
    assert degraded["availability"] == ro.PARTIAL


def test_a_previous_block_for_another_listing_is_never_borrowed():
    qualified = build(CA_RAW.read_bytes())
    block = build(b"{broken", previous=qualified, ticker="SHOP.TO")
    assert block["listing"]["ticker"] == "SHOP.TO"
    assert block["rows"] == []


def test_a_corrupt_previous_block_is_not_retained():
    tampered = copy.deepcopy(build(CA_RAW.read_bytes()))
    tampered["raw_input_sha256"] = "not-a-hash"
    block = build(raw_payload(institutional_holders=None), previous=tampered)
    assert block["rows"] == []


def test_a_previous_block_whose_hash_no_longer_matches_its_own_content_is_not_retained():
    tampered = copy.deepcopy(build(CA_RAW.read_bytes()))
    tampered["rows"][0]["shares"] = "999999999"  # content changed without resealing
    assert tampered["content_sha256"] != ro.content_sha256(tampered)
    block = build(raw_payload(institutional_holders=None), previous=tampered)
    assert block["rows"] == []


def test_normalizer_version_and_schema_are_pinned():
    block = build(CA_RAW.read_bytes())
    assert block["schema"] == ro.SCHEMA == "mastermind.reported-ownership/v1"
    assert block["normalizer_version"] == "1"