"""Pytest mirror of terminal/lib/__tests__/investigationScenario.test.ts.

Covers the same JSON contract for ``investigation_scenario.py``: the
INPUT/REFERENCE-ONLY repair of the scenario capture. The ORIGINAL full-value
fixture (basis + result + source_as_of) MUST be refused everywhere it can
appear; the reference wire contract — exact keys at every level, strict
numeric/date/digest validation, clock ordering, lens/selection agreement,
selection-key bounds — is accepted and retained verbatim.

SCENARIO_REFERENCE_JSON below is byte-identical to the fixture embedded in
investigationScenario.test.ts — the two suites prove the same wire JSON
parses cross-language. No math is mirrored and no result exists in this
contract, so there is no oracle math here either.

No fixtures, no pytest-specific features: plain assert functions, runnable
under pytest and under a plain Python runner alike.
"""

from __future__ import annotations

import copy
import datetime as _dt
import json
import math
import pathlib
import sys

# Canonical repo layout is tests/ beside the module; fall back to beside this
# file. The parent's integration layout governs either way.
_HERE = pathlib.Path(__file__).resolve().parent
for _candidate in (_HERE.parent / "api", _HERE, _HERE.parent):
    if (_candidate / "investigation_scenario.py").is_file() and str(_candidate) not in sys.path:
        sys.path.insert(0, str(_candidate))

from investigation_scenario import (  # noqa: E402
    CLOCK_MAX,
    GEX_BYTES_MAX,
    MOVES_BYTES_MAX,
    SCENARIO_CAPTURE_SCHEMA,
    SCENARIO_VERSION,
    SELECTION_KEY_MAX,
    SELECTION_PAIRS_MAX,
    parse_scenario_capture,
    validate_scenario_capture,
    validate_scenario_inputs,
)

BASIS_SHA = "b9cc4728b6b52d78c47927ec4e17f1f466fdd633c27ec23e7e059e575eacd358"
GEX_SHA = "a9a5c765bc9ca21cd5b0509edbc4f848afdb976420036af64ce32d5797d7a51d"
MOVES_SHA = "643277d3ac8a4e361d77c7dfee3485bd116545d5d84a34bc88e638ef70e2b940"

SCENARIO_REFERENCE_JSON = (
    '{"schema":"investigation_scenario_reference.v1","model_version":"exposure-scenario/v1",'
    '"inputs":{"targetSpot":600,"deltaSigmaPts":-1,"days":0.25},'
    '"source":{"owner":"options_hub","root":"SPX","session":"2026-10-16",'
    '"source_as_of":"2026-10-16t21:14:09.000001-04:00","evaluated_at":"2026-10-16T21:14:10-04:00",'
    '"lens":{"kind":"all"},'
    '"selection_key":"2026-10-16|2026-10-16T20:00:00-04:00,2026-12-18|2026-12-18T20:00:00-05:00",'
    f'"basis_sha256":"{BASIS_SHA}","gex":{{"sha256":"{GEX_SHA}","byte_length":4096}},'
    f'"moves":{{"sha256":"{MOVES_SHA}","byte_length":512}}}}}}'
)

INPUTS = {"targetSpot": 600.0, "deltaSigmaPts": -1.0, "days": 0.25}

EXPECTED_SOURCE = {
    "owner": "options_hub",
    "root": "SPX",
    "session": "2026-10-16",
    "source_as_of": "2026-10-16t21:14:09.000001-04:00",
    "evaluated_at": "2026-10-16T21:14:10-04:00",
    "lens": {"kind": "all"},
    "selection_key": "2026-10-16|2026-10-16T20:00:00-04:00,2026-12-18|2026-12-18T20:00:00-05:00",
    "basis_sha256": BASIS_SHA,
    "gex": {"sha256": GEX_SHA, "byte_length": 4096},
    "moves": {"sha256": MOVES_SHA, "byte_length": 512},
}

LEGACY_BASIS = {
    "root": "SPX", "session": "2026-10-16", "referenceSpot": 600.24,
    "gexMn": -1383, "vexMn": 220, "cexMn": -80, "emPct": None,
    "qualification": "qualified", "sourceRef": None,
}


def _fixture() -> dict:
    return json.loads(SCENARIO_REFERENCE_JSON)


def _over(source_over: dict | None = None, inputs_over: dict | None = None,
          top_over: dict | None = None) -> dict:
    raw = _fixture()
    if source_over:
        raw["source"].update(source_over)
    if inputs_over:
        raw["inputs"].update(inputs_over)
    if top_over:
        raw.update(top_over)
    return raw


def _long_selection_key(n: int) -> str:
    parts = ["2026-10-16|2026-10-16T20:00:00-04:00"]
    day = _dt.date(2027, 1, 1)
    for i in range(n):
        d = (day + _dt.timedelta(days=i)).isoformat()
        parts.append(f"{d}|{d}T20:00:00-05:00")
    return ",".join(parts)


# ------------------------------------------------------------------ canonical ----


def test_canonical_reference_fixture_parses_and_round_trips():
    raw = _fixture()
    assert validate_scenario_capture(raw) is True
    parsed = parse_scenario_capture(raw)
    assert parsed == {
        "schema": SCENARIO_CAPTURE_SCHEMA,
        "model_version": SCENARIO_VERSION,
        "inputs": INPUTS,
        "source": EXPECTED_SOURCE,
    }
    # JSON round trip, key order immaterial:
    round_tripped = json.loads(json.dumps(parsed))
    assert validate_scenario_capture(round_tripped) is True
    reordered = {
        "source": raw["source"], "inputs": raw["inputs"],
        "schema": raw["schema"], "model_version": raw["model_version"],
    }
    assert parse_scenario_capture(reordered) == parsed
    # int JSON numbers land as exact floats/ints, never strings or bools:
    assert parsed["inputs"]["targetSpot"] == 600.0
    assert parsed["source"]["gex"]["byte_length"] == 4096


def test_clocks_and_digests_retained_verbatim_moves_null_stays_null():
    raw = _over(source_over={
        "root": "BRK.B",
        "source_as_of": None,
        "evaluated_at": "2026-10-16t14:30:00+05:45",
        "lens": {"kind": "zero"},
        "selection_key": "2026-10-16|2026-10-16T20:00:00-04:00",
        "basis_sha256": GEX_SHA,
        "gex": {"sha256": GEX_SHA, "byte_length": GEX_BYTES_MAX},
        "moves": None,
    })
    parsed = parse_scenario_capture(raw)
    assert parsed is not None
    assert parsed["source"]["source_as_of"] is None  # unknown stays an explicit null, no invention
    assert parsed["source"]["evaluated_at"] == "2026-10-16t14:30:00+05:45"  # lowercase t, offset kept
    assert parsed["source"]["selection_key"] == "2026-10-16|2026-10-16T20:00:00-04:00"
    assert parsed["source"]["moves"] is None  # no latest fallback, no gex-digest substitution
    assert parsed["source"]["gex"]["byte_length"] == GEX_BYTES_MAX  # 8 MiB boundary accepted
    assert parsed["source"]["root"] == "BRK.B"


# ------------------------------------------------------------ old contract ----


def test_original_full_value_capture_refused_everywhere():
    legacy = {
        "schema": "investigation_scenario_capture.v1",
        "model_version": SCENARIO_VERSION,
        "source_as_of": "2026-10-16",
        "basis": LEGACY_BASIS,
        "inputs": dict(INPUTS),
        "result": {
            "ok": True, "version": SCENARIO_VERSION,
            "moveFraction": -0.00039984015794078426, "movePct": -0.039984015794078426,
            "inputs": dict(INPUTS),
            "terms": {"spotMn": 55.297685843137, "volMn": 220, "timeMn": 20},
            "totalMn": 184.70211915233698, "joint": False, "missing": [],
        },
    }
    assert validate_scenario_capture(legacy) is False
    assert parse_scenario_capture(legacy) is None
    # Even re-dressed with the new discriminator, the full-value shape is refused:
    redressed = dict(legacy, schema=SCENARIO_CAPTURE_SCHEMA)
    assert validate_scenario_capture(redressed) is False
    # And the new capture with legacy keys ADDED is refused, not trimmed:
    added = _over(top_over={"basis": LEGACY_BASIS, "result": {"totalMn": 184.68}})
    assert validate_scenario_capture(added) is False


def test_extra_and_spoofed_fields_refused_at_every_level():
    assert validate_scenario_capture(_over(top_over={"attestation": "trust-me"})) is False
    assert validate_scenario_capture(_over(source_over={"bucket": "s3://nope"})) is False
    assert validate_scenario_capture(_over(source_over={"url": "https://x/eod.json"})) is False

    class Spoof(dict):  # dict subclass — not a plain JSON object
        pass

    assert validate_scenario_capture(Spoof(_fixture())) is False
    for bad in (None, "x", 42, [], True, (), {}):
        assert validate_scenario_capture(bad) is False
        assert parse_scenario_capture(bad) is None
    missing_source = _fixture()
    del missing_source["source"]
    assert validate_scenario_capture(missing_source) is False  # no invented reference
    assert validate_scenario_capture(_over(top_over={"source": None})) is False


# ---------------------------------------------------------------- numerics ----


def test_coerced_and_nonfinite_numerics_refused():
    assert validate_scenario_capture(_over(inputs_over={"targetSpot": "600"})) is False  # string number
    assert validate_scenario_capture(_over(inputs_over={"deltaSigmaPts": True})) is False  # boolean
    assert validate_scenario_capture(_over(inputs_over={"days": float("nan")})) is False
    assert validate_scenario_capture(_over(inputs_over={"targetSpot": float("inf")})) is False
    assert validate_scenario_capture(_over(inputs_over={"days": float("-inf")})) is False
    assert validate_scenario_capture(_over(source_over={"gex": {"sha256": GEX_SHA, "byte_length": True}})) is False
    # Python's JSON reader accepts NaN/Infinity literals; the contract refuses them:
    assert validate_scenario_capture(json.loads(
        '{"schema":"' + SCENARIO_CAPTURE_SCHEMA + '","model_version":"' + SCENARIO_VERSION +
        '","inputs":{"targetSpot":NaN,"deltaSigmaPts":0,"days":0},"source":null}')) is False
    # A JSON number beyond double range parses to inf and is refused:
    assert validate_scenario_inputs(json.loads("1e400")) is None


def test_bad_digests_and_byte_bounds_refused():
    assert validate_scenario_capture(_over(source_over={"basis_sha256": BASIS_SHA[:63]})) is False  # 63
    assert validate_scenario_capture(_over(source_over={"basis_sha256": BASIS_SHA + "0"})) is False  # 65
    assert validate_scenario_capture(_over(source_over={"basis_sha256": BASIS_SHA.upper()})) is False  # not lowercase
    assert validate_scenario_capture(_over(source_over={"basis_sha256": "g" * 64})) is False  # not hex
    assert validate_scenario_capture(_over(source_over={
        "gex": {"sha256": GEX_SHA, "byte_length": GEX_BYTES_MAX + 1}})) is False  # over 8 MiB
    assert validate_scenario_capture(_over(source_over={
        "moves": {"sha256": MOVES_SHA, "byte_length": MOVES_BYTES_MAX + 1}})) is False  # over 1 MiB
    assert validate_scenario_capture(_over(source_over={"gex": {"sha256": GEX_SHA, "byte_length": 0}})) is False
    assert validate_scenario_capture(_over(source_over={"gex": {"sha256": GEX_SHA, "byte_length": 4096.5}})) is False
    assert validate_scenario_capture(_over(source_over={"gex": {"sha256": GEX_SHA, "byte_length": "4096"}})) is False
    assert validate_scenario_capture(_over(source_over={"gex": {"sha256": GEX_SHA, "byte_length": 10 ** 20}})) is False
    assert validate_scenario_capture(_over(source_over={"moves": {"sha256": MOVES_SHA}})) is False  # missing length
    # JSON 4096.0 is the same wire number as 4096 and normalizes to the int:
    assert parse_scenario_capture(_over(source_over={
        "gex": {"sha256": GEX_SHA, "byte_length": 4096.0}}))["source"]["gex"]["byte_length"] == 4096


def test_bad_roots_and_owner_refused():
    assert validate_scenario_capture(_over(source_over={"owner": "moves_hub"})) is False
    assert validate_scenario_capture(_over(source_over={"owner": "options_hub "})) is False
    assert validate_scenario_capture(_over(source_over={"root": "spx"})) is False  # lowercase: not a native root
    assert validate_scenario_capture(_over(source_over={"root": "SPXWXXXXXXXX"})) is False  # breaks the root rule
    assert validate_scenario_capture(_over(source_over={"root": "gex:../../admin/secrets"})) is False
    assert validate_scenario_capture(_over(source_over={"root": ""})) is False


# ------------------------------------------------------------------ clocks ----


def test_invalid_clocks_and_schema_drift_refused():
    assert validate_scenario_capture(_over(source_over={"evaluated_at": "2026-10-16T21:14:10"})) is False  # naive
    assert validate_scenario_capture(_over(source_over={"evaluated_at": "2026-02-30T00:00:00Z"})) is False
    assert validate_scenario_capture(_over(source_over={"evaluated_at": "2026-10-16T23:59:60Z"})) is False
    assert validate_scenario_capture(_over(source_over={"evaluated_at": "2026-10-16T21:14:10+24:00"})) is False
    assert validate_scenario_capture(_over(source_over={"evaluated_at": 20261016})) is False
    assert validate_scenario_capture(_over(source_over={"source_as_of": "2026-13-01"})) is False
    assert validate_scenario_capture(_over(source_over={"source_as_of": ""})) is False
    assert validate_scenario_capture(_over(source_over={"session": "2026-2-16"})) is False
    assert validate_scenario_capture(_over(source_over={"session": "2026-10-16T00:00:00Z"})) is False
    assert validate_scenario_capture(_over(top_over={"schema": "investigation_scenario_capture.v1"})) is False
    assert validate_scenario_capture(_over(top_over={"model_version": "exposure-scenario/v2"})) is False


def test_clock_ordering_enforced_and_unknown_null_kept():
    # evaluated_at's calendar date cannot precede the session:
    assert validate_scenario_capture(_over(source_over={
        "evaluated_at": "2026-10-15T23:00:00-04:00"})) is False
    # source_as_of in the future of evaluated_at, judged across offsets:
    assert validate_scenario_capture(_over(source_over={
        "source_as_of": "2026-10-17T01:00:00-04:00",
        "evaluated_at": "2026-10-16T21:00:00-04:00"})) is False
    # …while an earlier-instant source clock on a later written date is fine:
    assert validate_scenario_capture(_over(source_over={
        "source_as_of": "2026-10-16T23:00:00+05:00",  # 17:30Z
        "evaluated_at": "2026-10-17T02:00:00+05:00"})) is True  # 21:00Z next day
    # A bare-date source clock after the evaluation date:
    assert validate_scenario_capture(_over(source_over={
        "source_as_of": "2026-10-17",
        "evaluated_at": "2026-10-16T21:14:10-04:00"})) is False
    # Sub-second ordering is exact:
    assert validate_scenario_capture(_over(source_over={
        "source_as_of": "2026-10-16T21:14:10.9Z",
        "evaluated_at": "2026-10-16T21:14:10.1Z"})) is False
    # Unknown stays an explicit null — accepted, never invented:
    kept = parse_scenario_capture(_over(source_over={"source_as_of": None}))
    assert kept is not None and kept["source"]["source_as_of"] is None


# -------------------------------------------------------------------- lens ----


def test_lens_contract_five_kinds_no_extras():
    def with_lens(lens):
        raw = _over(source_over={"lens": lens})
        if isinstance(lens, dict):
            exp = raw["source"]["session"] if lens.get("kind") == "zero" else lens.get("exp") if lens.get("kind") == "one" else None
            if isinstance(exp, str):
                raw["source"]["selection_key"] = ",".join(pair for pair in raw["source"]["selection_key"].split(",") if pair.startswith(exp + "|"))
        return raw

    assert validate_scenario_capture(with_lens({"kind": "all"})) is True
    assert validate_scenario_capture(with_lens({"kind": "zero"})) is True  # session is in the selection
    assert validate_scenario_capture(with_lens({"kind": "next-live"})) is True
    assert validate_scenario_capture(with_lens({"kind": "week"})) is True
    assert validate_scenario_capture(with_lens({"kind": "one", "exp": "2026-12-18"})) is True
    assert validate_scenario_capture(with_lens({"kind": "one"})) is False  # one needs its exp
    assert validate_scenario_capture(with_lens({"kind": "one", "exp": "2026-13-01"})) is False
    assert validate_scenario_capture(with_lens({"kind": "all", "exp": "2026-10-16"})) is False  # no extra exp
    assert validate_scenario_capture(with_lens({"kind": "ex-zero"})) is False  # not in the frozen contract
    assert validate_scenario_capture(with_lens({"kind": "gamma"})) is False
    assert validate_scenario_capture(with_lens("all")) is False


def test_lens_selection_agreement():
    assert validate_scenario_capture(_over(source_over={
        "lens": {"kind": "one", "exp": "2027-03-19"}})) is False  # not selected
    assert validate_scenario_capture(_over(source_over={"lens": {"kind": "zero"}})) is False
    missing = _over(source_over={
        "selection_key": "2026-12-18|2026-12-18T20:00:00-05:00",  # session not among the expiries
        "lens": {"kind": "zero"}})
    assert validate_scenario_capture(missing) is False


def test_selection_key_format_bounds_order_and_session_floor():
    def with_key(key):
        return _over(source_over={"selection_key": key})

    assert validate_scenario_capture(with_key("")) is False  # empty
    assert validate_scenario_capture(with_key("https://example.com/x.json")) is False  # a URI is not a selection
    assert validate_scenario_capture(with_key(
        "2026-12-18|2026-12-18T20:00:00-05:00,2026-10-16|2026-10-16T20:00:00-04:00")) is False  # unsorted
    assert validate_scenario_capture(with_key(
        "2026-10-16|2026-10-16T20:00:00-04:00,2026-10-16|2026-10-16T20:00:00-04:00")) is False  # duplicate full pair
    assert validate_scenario_capture(with_key("2026-10-16")) is False  # no pair separator
    assert validate_scenario_capture(with_key("2026-10-16|2026-10-16T20:00:00")) is False  # naive economic expiry
    assert validate_scenario_capture(with_key("2026-10-15|2026-10-15T20:00:00-04:00")) is False  # before session
    assert validate_scenario_capture(with_key("2026-10-16|2026-10-16T20:00:00-04:00|extra")) is False
    assert validate_scenario_capture(with_key(_long_selection_key(SELECTION_PAIRS_MAX - 1))) is True  # 128 pairs
    assert validate_scenario_capture(with_key(_long_selection_key(SELECTION_PAIRS_MAX))) is False  # 129 pairs
    assert validate_scenario_capture(with_key("x" * (SELECTION_KEY_MAX + 1))) is False  # > 16 KiB
    assert validate_scenario_capture(with_key(20261016)) is False


# ------------------------------------------------------------------ inputs ----


def test_validate_scenario_inputs_bounds_and_coercion():
    assert validate_scenario_inputs(dict(INPUTS)) == INPUTS
    assert validate_scenario_inputs({"targetSpot": 0.01, "deltaSigmaPts": -5, "days": 5}) == \
        {"targetSpot": 0.01, "deltaSigmaPts": -5.0, "days": 5.0}  # boundaries inclusive
    for bad in (None, 42, "x", [], {}):
        assert validate_scenario_inputs(bad) is None
    assert validate_scenario_inputs({"targetSpot": 0, "deltaSigmaPts": 0, "days": 0}) is None  # spot must be > 0
    assert validate_scenario_inputs({"targetSpot": 600, "deltaSigmaPts": 5.01, "days": 0}) is None
    assert validate_scenario_inputs({"targetSpot": 600, "deltaSigmaPts": -5.01, "days": 0}) is None
    assert validate_scenario_inputs({"targetSpot": 600, "deltaSigmaPts": 0, "days": 5.25}) is None
    assert validate_scenario_inputs({"targetSpot": 600, "deltaSigmaPts": 0, "days": -0.25}) is None
    assert validate_scenario_inputs({"targetSpot": "600", "deltaSigmaPts": 0, "days": 0}) is None
    assert validate_scenario_inputs({"targetSpot": True, "deltaSigmaPts": 0, "days": 0}) is None
    assert validate_scenario_inputs({"targetSpot": float("nan"), "deltaSigmaPts": 0, "days": 0}) is None
    assert validate_scenario_inputs({"targetSpot": 10 ** 400, "deltaSigmaPts": 0, "days": 0}) is None  # overflows
    assert validate_scenario_inputs({"targetSpot": 600, "deltaSigmaPts": 0}) is None  # missing days
    assert validate_scenario_inputs(dict(INPUTS, extra=1)) is None  # extra key


def test_input_parser_does_not_invent_relative_qualification():
    # The ±3% relative spot bound needs the protected exact basis; this parser
    # enforces only the absolute input bounds and must not guess a relative one.
    assert validate_scenario_inputs({"targetSpot": 1_000_000, "deltaSigmaPts": 0, "days": 0}) == \
        {"targetSpot": 1_000_000.0, "deltaSigmaPts": 0.0, "days": 0.0}


# ----------------------------------------------------------------- detach ----


def test_parse_detaches_caller_memory():
    raw = _fixture()
    parsed = parse_scenario_capture(raw)
    assert parsed is not None
    assert parsed is not raw and parsed["source"] is not raw["source"]
    raw["inputs"]["targetSpot"] = 1
    raw["source"]["root"] = "HACKED"
    raw["source"]["gex"]["byte_length"] = 1
    raw["schema"] = "investigation_scenario_capture.v1"
    assert parsed["inputs"]["targetSpot"] == 600.0
    assert parsed["source"]["root"] == "SPX"
    assert parsed["source"]["gex"]["byte_length"] == 4096
    assert parsed["schema"] == SCENARIO_CAPTURE_SCHEMA
    assert parsed == parse_scenario_capture(_fixture())


def test_source_kind_mixing_refused():
    mixed_source = _over(source_over={
        "basis": {"root": "SPX", "referenceSpot": 600.24, "gexMn": -1383},
        "result": {"totalMn": 184.68}})
    assert validate_scenario_capture(mixed_source) is False
    assert parse_scenario_capture(mixed_source) is None


def test_validate_agrees_with_parse_everywhere():
    cases = (
        _fixture(),
        _over(source_over={"source_as_of": None, "moves": None}),
        _over(source_over={"lens": {"kind": "all"}}),
        {"schema": SCENARIO_CAPTURE_SCHEMA},
        None,
    )
    for raw in cases:
        assert validate_scenario_capture(raw) == (parse_scenario_capture(raw) is not None)
    assert math.isfinite(1.0)  # keep the import honest; the contract itself does no math


def test_fixture_is_stable_against_copy_mutation():
    raw = copy.deepcopy(_fixture())
    snapshot = json.dumps(raw, sort_keys=True)
    assert validate_scenario_capture(raw) is True
    assert json.dumps(raw, sort_keys=True) == snapshot  # validation never edits the input


def test_captured_one_lens_cannot_contain_other_expiries():
    assert validate_scenario_capture(_over(source_over={"lens": {"kind": "one", "exp": "2026-10-16"}})) is False

def test_captured_zero_lens_cannot_contain_other_expiries():
    assert validate_scenario_capture(_over(source_over={"lens": {"kind": "zero"}})) is False


def test_native_multiple_economic_instants_for_one_expiry():
    raw = json.loads(SCENARIO_REFERENCE_JSON)
    raw["source"]["lens"] = {"kind": "one", "exp": "2026-10-16"}
    first = "2026-10-16|2026-10-16T09:30:00-04:00"
    second = "2026-10-16|2026-10-16T20:00:00-04:00"
    raw["source"]["selection_key"] = first + "," + second
    parsed = parse_scenario_capture(raw)
    assert parsed is not None
    assert parsed["source"]["selection_key"] == raw["source"]["selection_key"]
    for selection in (first + "," + first, second + "," + first):
        raw["source"]["selection_key"] = selection
        assert parse_scenario_capture(raw) is None
