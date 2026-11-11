"""Single-file compatibility envelope for qualified CN mixed-source financials.

Legacy clients keep reading the top-level financial view. Updated readers verify
and select the complete projection; the raw cached envelope is never mutated.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
import struct

SCHEMA = "mastermind.regional-financials/v1"
FIELD = "regional_financials"
KEYS = ("statements", "earnings", "src", "data_freshness")


def projection(document):
    return {key: copy.deepcopy(document.get(key)) for key in KEYS}


def canonical_projection(value):
    """Portable typed JSON; numbers use their IEEE754 binary64 identity."""
    def normalize(item, depth=0):
        if depth > 64:
            raise ValueError("financial projection nesting too deep")
        if item is None:
            return ["null"]
        if isinstance(item, bool):
            return ["boolean", item]
        if isinstance(item, (int, float)):
            number = float(item)
            if not math.isfinite(number):
                raise ValueError("financial projection number is not finite")
            return ["number", struct.pack(">d", number).hex()]
        if isinstance(item, str):
            return ["string", item]
        if isinstance(item, list):
            return ["array", [normalize(entry, depth + 1) for entry in item]]
        if isinstance(item, dict) and all(isinstance(key, str) and key.isascii() for key in item):
            return ["object", [[key, normalize(item[key], depth + 1)] for key in sorted(item)]]
        raise ValueError("invalid financial projection value")
    return json.dumps(normalize(value), separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def materialize_regional_fund(document, ticker):
    if not isinstance(document, dict):
        raise ValueError("invalid fund")
    if FIELD not in document:
        return document
    envelope = document[FIELD]
    if (document.get("schema") != "mastermind.fund/v1" or document.get("ticker") != ticker
            or document.get("quote_currency") != "CNY" or document.get("stmt_currency") != "CNY"
            or not isinstance(envelope, dict) or envelope.get("schema") != SCHEMA
            or envelope.get("ticker") != ticker
            or envelope.get("base_sha256") != digest(canonical_projection(projection(document)))):
        raise ValueError("regional projection identity or base mismatch")
    encoded = envelope.get("payload_json")
    if (not isinstance(encoded, str) or len(encoded) > 2_000_000
            or envelope.get("payload_sha256") != digest(encoded)):
        raise ValueError("regional projection content mismatch")
    selected = json.loads(encoded)
    if not isinstance(selected, dict) or set(selected) != set(KEYS):
        raise ValueError("invalid financial projection fields")
    result = copy.deepcopy(document)
    result.pop(FIELD)
    result.update(selected)
    return result


def wrap_regional_financials(qualified, previous):
    """Publish both views atomically, preserving the older consumer's financial basis."""
    ticker = qualified["ticker"]
    if previous is not None:
        materialize_regional_fund(previous, ticker)  # reject corrupt prior envelopes
    result = copy.deepcopy(qualified)
    result.pop(FIELD, None)
    if previous is None:
        # New listings have no legacy financial basis; do not expose new semantics to old tabs.
        legacy = {"statements": {"annual": None, "quarterly": None},
                  "earnings": {**copy.deepcopy(qualified.get("earnings") or {}), "q": [], "fy": []},
                  "src": {**copy.deepcopy(qualified.get("src") or {}), "statements": None},
                  "data_freshness": None}
        for key in ("statement_coverage_policy", "fallback_acquired_at", "fallback_raw_input_sha256"):
            legacy["src"].pop(key, None)
    else:
        legacy = projection(previous)
        # Keep the old period inventory, but do not preserve the known cumulative-EPS
        # subtraction defect. This correction is safe for legacy consumers as well.
        unsafe = {row.get("end") for row in (qualified.get("earnings") or {}).get("q") or []
                  if row.get("eps_basis") == "discrete_eps_unavailable" and row.get("end")}
        for row in (legacy.get("earnings") or {}).get("q") or []:
            if row.get("end") in unsafe:
                row["eps_a"] = None
                row["surp_pct"] = None
    for key, value in legacy.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = value
    selected = projection(qualified)
    encoded = json.dumps(selected, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    result[FIELD] = {"schema": SCHEMA, "ticker": ticker,
                     "base_sha256": digest(canonical_projection(projection(result))),
                     "payload_json": encoded, "payload_sha256": digest(encoded)}
    return result
