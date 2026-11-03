"""investigation_scenario — JSON validation mirror of the TS scenario-capture contract.

Mirrors ``terminal/lib/investigationScenario.ts`` for the canonical
Investigation manifest's optional ``scenario_capture`` object:

    {schema: "investigation_scenario_reference.v1",
     model_version: "exposure-scenario/v1",
     inputs: {targetSpot, deltaSigmaPts, days},
     source: {owner: "options_hub", root, session, source_as_of, evaluated_at,
              lens, selection_key, basis_sha256, gex, moves}}

REPAIR CONTRACT. An earlier draft stored the full scenario capture: the
protected ``ScenarioBasis`` (reference spot, per-greek $mn summaries, emPct),
the frozen ``ScenarioValue`` result, and a recomputation of that result
offline. Even derived result/summary values are protected Options data, and
persisting or returning that capture through the generic canonical
Investigation surface (directSQL/RPC) would bypass the CURRENT recipient's
source-use rights. Nothing of that shape survives here: the stored object is
an INPUT/REFERENCE-ONLY request — the caller's own panel inputs plus a
pointer to the options_hub source (root/session/lens/selection and the sha256
digests and byte lengths of retained native bytes).

``basis_sha256`` is a DIGEST ONLY — not the protected basis, not a
``capture:sha256`` input digest and not a Matrix version. The ``gex``/
``moves`` hashes refer to exact retained native bytes held elsewhere; this
module never reads them and cannot prove they are in fact retained.

THE PARSER PROVES NO RIGHTS. Parsing here cannot prove actual retention, a
private destination, action rights, or that the referenced source is
native-qualified; it validates shape, bounds and internal consistency and
nothing more. Real creation/save/resolution lives elsewhere and must refuse
absent a qualified private destination, current authorizers and a retained
source. A missing source MUST NOT invent a reference, mint an identifier,
succeed as an unresolved capture, or substitute the latest one.

This is a PURE validation mirror, not a math mirror: the native engine's
``localScenarioValue`` is deliberately NOT duplicated and no result, summary
or sufficient statistic is stored, returned or recomputed. The relative ±3%
spot bound needs the protected exact basis and stays native resolution
validation — it is not guessed here. No I/O, no fetches, no clocks consulted,
no identifiers minted; every refusal is a ``None``/``False``, never an
exception.

Python JSON semantics: ``json.loads`` values only (plain ``dict`` — dict
subclasses are refused, mirroring the TS plain-prototype rule); booleans are
never numbers; ints are coerced with ``float()`` (exact for JSON-representable
magnitudes, ``OverflowError`` refuses); JSON ``NaN``/``Infinity`` are refused
as non-finite. Clocks are validated and retained VERBATIM — never normalized;
ordering between two declared instants uses only the offsets carried in the
strings, never a timezone database.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional

SCENARIO_VERSION = "exposure-scenario/v1"
SCENARIO_CAPTURE_SCHEMA = "investigation_scenario_reference.v1"

# Defensive wire bounds: gex/moves ceilings on the retained native payloads
# the digests refer to; the clock cap is defense-in-depth (longest accepted
# form is 35 chars); the selection bounds mirror the native selectionKey limits.
CLOCK_MAX = 40
SELECTION_PAIRS_MAX = 128
SELECTION_KEY_MAX = 16 * 1024
GEX_BYTES_MAX = 8 * 1024 * 1024
MOVES_BYTES_MAX = 1024 * 1024

_KEYS_CAPTURE = ("schema", "model_version", "inputs", "source")
_KEYS_SOURCE = ("owner", "root", "session", "source_as_of", "evaluated_at",
                "lens", "selection_key", "basis_sha256", "gex", "moves")
_KEYS_INPUTS = ("targetSpot", "deltaSigmaPts", "days")
_KEYS_DIGEST = ("sha256", "byte_length")
_LENS_KINDS = ("all", "zero", "next-live", "week")

_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_DATETIME_RE = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?"
    r"(?:[Zz]|([+-])(\d{2}):(\d{2}))"
)
_HEX64_RE = re.compile(r"[0-9a-f]{64}")


def _is_plain_dict(raw: Any) -> bool:
    """A plain JSON object: exactly ``dict`` (subclasses refused, mirroring the TS prototype rule)."""
    return type(raw) is dict


def _is_single_line(value: str) -> bool:
    return not any(
        ord(ch) < 0x20 or ord(ch) == 0x7F or ch in (" ", " ") for ch in value
    )


def _days_in_month(year: int, month: int) -> Optional[int]:
    if month in (1, 3, 5, 7, 8, 10, 12):
        return 31
    if month in (4, 6, 9, 11):
        return 30
    if month == 2:
        leap = (year % 4 == 0 and year % 100 != 0) or year % 400 == 0
        return 29 if leap else 28
    return None


def is_calendar_date(value: str) -> bool:
    """Exactly YYYY-MM-DD, a REAL calendar date (no 2026-02-30, no 1-digit month)."""
    m = _DATE_RE.fullmatch(value)
    if not m:
        return False
    dim = _days_in_month(int(m.group(1)), int(m.group(2)))
    return dim is not None and 1 <= int(m.group(3)) <= dim


def is_iso_datetime_with_zone(value: str) -> bool:
    """Zone-bearing ISO date-time; a naive local time is not a source clock.

    ``t``/``z`` lowercase is accepted (RFC 3339 permits it); leap seconds are
    not; absurd offsets (> 23:59) are not. Validated, never parsed into a
    datetime and never normalized.
    """
    m = _DATETIME_RE.fullmatch(value)
    if not m:
        return False
    if not is_calendar_date(f"{m.group(1)}-{m.group(2)}-{m.group(3)}"):
        return False
    if int(m.group(4)) > 23 or int(m.group(5)) > 59 or int(m.group(6)) > 59:
        return False
    if m.group(9) is not None and (int(m.group(9)) > 23 or int(m.group(10)) > 59):
        return False
    return True


def is_valid_source_clock(value: Any) -> bool:
    """None (unknown clock) or a real date / zone-bearing date-time within the bound."""
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    if not 1 <= len(value) <= CLOCK_MAX:
        return False
    return is_calendar_date(value) or is_iso_datetime_with_zone(value)


def _instant_parts(value: str) -> Optional[tuple[int, str]]:
    """(UTC seconds, zero-padded fraction) of a zone-bearing instant.

    The UTC shift uses ONLY the offset carried in the string — arithmetic on
    the declared offset, never a timezone normalization.
    """
    m = _DATETIME_RE.fullmatch(value)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    yy = y - 1 if mo <= 2 else y
    era = yy // 400
    yoe = yy - era * 400
    doy = (153 * (mo + (-3 if mo > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    days = era * 146097 + doe - 719468
    secs = days * 86400 + int(m.group(4)) * 3600 + int(m.group(5)) * 60 + int(m.group(6))
    if m.group(8) is None:
        offset = 0
    else:
        offset = int(m.group(9)) * 3600 + int(m.group(10)) * 60
        offset = -offset if m.group(8) == "-" else offset
    frac = (m.group(7) or "").ljust(9, "0")
    return secs - offset, frac


def _as_finite_number(value: Any) -> Optional[float]:
    """A JSON number as an IEEE double — booleans are not numbers, NaN/±∞ are not finite."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        f = float(value)
    except (OverflowError, ValueError):
        return None
    return f if math.isfinite(f) else None


def validate_scenario_inputs(raw: Any) -> Optional[dict]:
    """Strict ScenarioInputs shape + the LOCAL absolute bounds, or None.

    Enforces exactly: plain dict, exact key set, finite JSON numbers (no
    booleans, no coercion), targetSpot > 0, deltaSigmaPts in [-5, 5], days in
    [0, 5]. The relative ±3% spot bound is deliberately NOT invented here —
    it needs the protected exact basis and stays native resolution validation.
    """
    if not _is_plain_dict(raw) or set(raw.keys()) != set(_KEYS_INPUTS):
        return None
    target = _as_finite_number(raw["targetSpot"])
    dv = _as_finite_number(raw["deltaSigmaPts"])
    days = _as_finite_number(raw["days"])
    if target is None or dv is None or days is None:
        return None
    if target <= 0 or not -5.0 <= dv <= 5.0 or not 0.0 <= days <= 5.0:
        return None
    return {"targetSpot": target, "deltaSigmaPts": dv, "days": days}


def _parse_digest(raw: Any, max_bytes: int) -> Optional[dict]:
    """A digest reference (gex ≤ 8 MiB, moves ≤ 1 MiB), or None."""
    if not _is_plain_dict(raw) or set(raw.keys()) != set(_KEYS_DIGEST):
        return None
    sha = raw["sha256"]
    if not isinstance(sha, str) or not _HEX64_RE.fullmatch(sha):
        return None
    length = raw["byte_length"]
    if isinstance(length, bool):
        return None
    if isinstance(length, int):
        byte_length = length
    elif isinstance(length, float) and math.isfinite(length) and length.is_integer():
        byte_length = int(length)  # JSON 4096.0 is the same wire number as 4096
    else:
        return None
    if not 1 <= byte_length <= max_bytes:
        return None
    return {"sha256": sha, "byte_length": byte_length}


def _parse_selection_key(raw: Any, session: str) -> Optional[list[str]]:
    """The native read.selectionKey format: ``expiry|economic_expiry_at`` pairs.

    Bounded (≤128 pairs, ≤16 KiB), single-line, each expiry a real YYYY-MM-DD
    at/after the source session, each economic expiry a zone-bearing instant,
    pairs unique and strictly sorted as full expiry/economic-instant strings. A URL or any other user-URI
    shape cannot parse as pairs. What is NOT checked here: whether the
    economic expiry's America/New_York date equals its expiry — that needs the
    native timezone convention and is native resolution validation, not
    guessed here.
    """
    if not isinstance(raw, str):
        return None
    if not 1 <= len(raw) <= SELECTION_KEY_MAX or not _is_single_line(raw):
        return None
    parts = raw.split(",")
    if len(parts) > SELECTION_PAIRS_MAX:
        return None
    prev: Optional[str] = None
    for part in parts:
        sep = part.find("|")
        if sep < 0:
            return None
        expiry, economic = part[:sep], part[sep + 1:]
        if not is_calendar_date(expiry) or not is_iso_datetime_with_zone(economic):
            return None
        if expiry < session:
            return None
        if prev is not None and not prev < part:
            return None
        prev = part
    return parts


def _parse_lens(raw: Any, session: str, expiries: frozenset[str]) -> Optional[dict]:
    """The lens: exactly all/zero/next-live/week (kind only), or one + real exp."""
    if not _is_plain_dict(raw):
        return None
    kind = raw.get("kind")
    if not isinstance(kind, str):
        return None
    if kind == "one":
        if len(raw) != 2 or "exp" not in raw:
            return None
        exp = raw["exp"]
        if not isinstance(exp, str) or not is_calendar_date(exp):
            return None
        if expiries != frozenset((exp,)):
            return None
        return {"kind": "one", "exp": exp}
    if kind in _LENS_KINDS:
        if len(raw) != 1:
            return None
        if kind == "zero" and expiries != frozenset((session,)):
            return None
        return {"kind": kind}
    return None


def _parse_source(raw: Any) -> Optional[dict]:
    """Strict ScenarioSourceReference shape, or None.

    Enforces, in order: plain dict, exact keys, hub owner, native root rule,
    real session, verbatim source clock (null kept null), zone-bearing
    evaluated_at, clock ordering (evaluated_at cannot precede the session nor
    a known source_as_of), the selection key, digest shapes and bounds, and
    the lens/selection agreement. Everything is rebuilt — the result shares no
    structure with ``raw``.
    """
    if not _is_plain_dict(raw) or set(raw.keys()) != set(_KEYS_SOURCE):
        return None
    if raw["owner"] != "options_hub":
        return None
    root = raw["root"]
    if not isinstance(root, str) or not _is_native_root(root):
        return None
    session = raw["session"]
    if not isinstance(session, str) or not is_calendar_date(session):
        return None
    source_as_of = raw["source_as_of"]
    if not is_valid_source_clock(source_as_of):
        return None
    evaluated_at = raw["evaluated_at"]
    if not isinstance(evaluated_at, str) or not 1 <= len(evaluated_at) <= CLOCK_MAX \
            or not is_iso_datetime_with_zone(evaluated_at):
        return None
    # Clock ordering: a bare date compares by its calendar date; two instants
    # compare exactly via the offsets they carry (fractions included). Nothing
    # is normalized.
    if evaluated_at[:10] < session:
        return None
    if isinstance(source_as_of, str):
        if is_iso_datetime_with_zone(source_as_of):
            src = _instant_parts(source_as_of)
            ev = _instant_parts(evaluated_at)
            if src is None or ev is None or src > ev:
                return None
        elif source_as_of > evaluated_at[:10]:
            return None
    selection_key = _parse_selection_key(raw["selection_key"], session)
    if selection_key is None:
        return None
    basis_sha256 = raw["basis_sha256"]
    if not isinstance(basis_sha256, str) or not _HEX64_RE.fullmatch(basis_sha256):
        return None
    gex = _parse_digest(raw["gex"], GEX_BYTES_MAX)
    if gex is None:
        return None
    if raw["moves"] is None:
        moves: Optional[dict] = None
    else:
        moves = _parse_digest(raw["moves"], MOVES_BYTES_MAX)
        if moves is None:
            return None
    expiries = frozenset(part[:part.find("|")] for part in selection_key)
    lens = _parse_lens(raw["lens"], session, expiries)
    if lens is None:
        return None
    return {
        "owner": "options_hub",
        "root": root,
        "session": session,
        "source_as_of": source_as_of,
        "evaluated_at": evaluated_at,
        "lens": lens,
        "selection_key": raw["selection_key"],
        "basis_sha256": basis_sha256,
        "gex": gex,
        "moves": moves,
    }


def _is_native_root(root: str) -> bool:
    """The native option root rule (flowRoot.isValidRoot), mirrored exactly."""
    if not 0 < len(root) <= 12:
        return False
    return re.fullmatch(r"[A-Z0-9]{1,10}(?:[.-][A-Z0-9]{1,4})?", root) is not None


def parse_scenario_capture(raw: Any) -> Optional[dict]:
    """Parse a stored reference-only scenario capture, or None.

    A pure shape read: no clock, no live data, no availability argument, no
    rights judgment, no math. Enforces exactly the frozen wire contract —
    schema discriminator, frozen engine version, exact key sets at both
    levels, strict input bounds, and the full source reference rules. Anything
    extra (including an old full-value basis or result) is refused, never
    dropped and never converted.
    """
    if not _is_plain_dict(raw) or set(raw.keys()) != set(_KEYS_CAPTURE):
        return None
    if raw["schema"] != SCENARIO_CAPTURE_SCHEMA or raw["model_version"] != SCENARIO_VERSION:
        return None
    inputs = validate_scenario_inputs(raw["inputs"])
    if inputs is None:
        return None
    source = _parse_source(raw["source"])
    if source is None:
        return None
    return {
        "schema": SCENARIO_CAPTURE_SCHEMA,
        "model_version": SCENARIO_VERSION,
        "inputs": inputs,
        "source": source,
    }


def validate_scenario_capture(raw: Any) -> bool:
    """True when ``raw`` is a complete reference-only scenario capture.

    Pure validation: one source of truth with ``parse_scenario_capture``.
    Never promotes a model, never fetches anything, and never asserts a right.
    """
    return parse_scenario_capture(raw) is not None
