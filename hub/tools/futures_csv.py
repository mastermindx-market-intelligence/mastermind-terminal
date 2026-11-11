"""Lossless public-sample CSV field adapter; not a vendor binary decoder or API client."""
from __future__ import annotations
import calendar
import datetime as dt
import re

STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{9})Z$")
PRICE = re.compile(r"^(-?)(\d+)\.(\d{9})$")


def timestamp_ns(value: str) -> str:
    match = STAMP.fullmatch(value)
    if not match:
        raise ValueError("csv_timestamp_requires_utc_nanoseconds")
    whole = dt.datetime.strptime(match[1], "%Y-%m-%dT%H:%M:%S")
    ns = calendar.timegm(whole.timetuple()) * 1_000_000_000 + int(match[2])
    if not 0 <= ns < 2**64 - 1:
        raise ValueError("csv_timestamp_range")
    return str(ns)


def fixed_price(value: str) -> str:
    if value == "":
        return str(2**63 - 1)
    match = PRICE.fullmatch(value)
    if not match:
        raise ValueError("csv_price_requires_fixed_9_decimals")
    number = (int(match[2]) * 1_000_000_000 + int(match[3])) * (-1 if match[1] else 1)
    if not -(2**63) <= number < 2**63:
        raise ValueError("csv_price_range")
    return str(number)


def integer(value: str, bits: int = 32) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0|[1-9]\d*", value):
        raise ValueError("csv_integer")
    number = int(value)
    if not 0 <= number < 2**bits:
        raise ValueError("csv_integer_range")
    return number


def normalize_mbo(row: dict[str, str]) -> dict:
    if integer(row["rtype"]) != 160:
        raise ValueError("csv_not_mbo")
    return {"rtype": 160, "publisher_id": integer(row["publisher_id"], 16),
        "instrument_id": integer(row["instrument_id"]), "action": row["action"], "side": row["side"],
        "order_id": str(integer(row["order_id"], 64)), "price": fixed_price(row["price"]),
        "size": integer(row["size"]), "flags": integer(row["flags"], 8),
        "sequence": integer(row["sequence"]), "channel_id": integer(row["channel_id"], 8),
        "ts_event": timestamp_ns(row["ts_event"]), "ts_recv": timestamp_ns(row["ts_recv"])}


def normalize_reference(row: dict[str, str]) -> dict:
    if integer(row["rtype"]) != 1:
        raise ValueError("csv_not_mbp_1")
    return {"publisherId": integer(row["publisher_id"], 16), "instrumentId": integer(row["instrument_id"]),
        "receiveTimeNs": timestamp_ns(row["ts_recv"]), "sequence": integer(row["sequence"]),
        "flags": integer(row["flags"], 8), "symbol": row["symbol"],
        "bidPrice": fixed_price(row["bid_px_00"]), "askPrice": fixed_price(row["ask_px_00"]),
        "bidSize": integer(row["bid_sz_00"]), "askSize": integer(row["ask_sz_00"]),
        "bidCount": integer(row["bid_ct_00"]), "askCount": integer(row["ask_ct_00"])}


def normalize_depth_reference(row: dict[str, str]) -> dict:
    """Independent top-ten reference rows; do not reconstruct them from the MBO test input."""
    if integer(row["rtype"]) != 10:
        raise ValueError("csv_not_mbp_10")
    result = {"publisherId": integer(row["publisher_id"], 16), "instrumentId": integer(row["instrument_id"]),
        "receiveTimeNs": timestamp_ns(row["ts_recv"]), "sequence": integer(row["sequence"]),
        "flags": integer(row["flags"], 8), "symbol": row["symbol"], "levels": []}
    for level in range(10):
        suffix = f"{level:02d}"
        result["levels"].append({"bidPrice": fixed_price(row[f"bid_px_{suffix}"]),
            "askPrice": fixed_price(row[f"ask_px_{suffix}"]), "bidSize": integer(row[f"bid_sz_{suffix}"]),
            "askSize": integer(row[f"ask_sz_{suffix}"]), "bidCount": integer(row[f"bid_ct_{suffix}"]),
            "askCount": integer(row[f"ask_ct_{suffix}"])})
    return result
