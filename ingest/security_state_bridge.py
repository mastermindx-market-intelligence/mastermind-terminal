"""Validate and forward the existing Macro security_state.v1 display envelope.

Owner: mastermindx-market-intelligence/macro, ab5156a4b2c336181f3c5256e7c0766f04f99598.
Schema: contracts/market_os/security_state.v1.schema.json (vendored unchanged).
Digest exclusions match engine/security_state.py::_content_sha256 at that pin.
No new compiler, coverage expansion, signal, sizing or private user overlay.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from functools import lru_cache
from hashlib import sha256
import json
import logging
import re
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema = json.loads((Path(__file__).parent / "contracts/security_state.v1.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    checker = FormatChecker()
    # jsonschema's RFC3339 validator is an optional dependency. Register the
    # producer's timestamp subset explicitly so missing extras cannot turn a
    # malformed observation clock into an accepted receipt.
    @checker.checks("date-time", raises=(ValueError, TypeError))
    def timestamp(value):
        if not isinstance(value, str):
            return True  # The schema's type constraint handles non-strings.
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value):
            return False
        return datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    return Draft202012Validator(schema, format_checker=checker)


def security_state_digest(state: dict) -> str:
    """Verify owner content identity without rewriting the published receipt."""
    payload = deepcopy(state)
    payload.pop("content_sha256", None)
    payload.pop("generated_at", None)
    payload.get("as_of", {}).pop("state_compiled_at", None)
    for leg in payload.get("identity_proof", {}).get("legs", []):
        leg["values_read"] = [item for item in leg.get("values_read", []) if item.get("field") != "owner_decision_date"]
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return sha256(canonical.encode("utf-8")).hexdigest()


def read_security_state(raw: object, symbol: str) -> tuple[dict | None, str]:
    """Accepted means the original envelope passed the boundary, not ENTRY_OPEN.

    Its own coverage, identity proof and degradation remain authoritative. A
    partial/stale/failed compilation is carried as such, never painted current.
    The closed owner schema also forbids personal holdings in this public path.
    """
    if raw is None:
        return None, "not_published"
    if not isinstance(raw, dict):
        return None, "invalid"
    if raw.get("schema") != "security_state.v1" or raw.get("version") != "1.0.0":
        return None, "unsupported_contract"
    try:
        validator = _validator()
        if not validator.is_valid(raw):
            return None, "invalid"
        if raw["generated_at"] != raw["as_of"]["state_compiled_at"]:
            return None, "invalid"
        if raw["ticker_display"].upper() != symbol.upper() or raw["security_id"] != f"SEC:{raw['listing_key']}":
            return None, "identity_mismatch"
        if security_state_digest(raw) != raw["content_sha256"]:
            return None, "digest_mismatch"
    except (OSError, ValueError, TypeError, KeyError) as exc:
        logging.warning("Security-state read unavailable for %s (%s)", symbol, type(exc).__name__)
        return None, "unavailable"
    return deepcopy(raw), "accepted"
