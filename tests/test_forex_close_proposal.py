"""Contract tests for an inert proposal, not SQL atomicity or production proof."""
from copy import deepcopy
from datetime import datetime
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from ingest.alerts_engine import condition_version, mint_fire_event_id
from ingest.forex_close_proposal import (
    FEED, SCOPE, SNAPSHOT_SCHEMA, PreparedProposal,
    prepare_forex_enqueue, submit_prepared,
)

OWNER = "11111111-1111-4111-8111-111111111111"
ALERT = "22222222-2222-4222-8222-222222222222"
OUTBOX = "33333333-3333-4333-8333-333333333333"
NOW = "2026-10-22T17:00:00Z"
VINTAGE = "forex-4h/v1:sha256:efc8b496369b6aa9faa5a13637df9af548ddf4bbd8e57676247eb8cb576cb155"


def fixture_inputs():
    alert = {
        "id": ALERT, "user_id": OWNER, "symbol": "USDJPY", "active": True,
        "condition": {
            "type": "forex_price_close", "schema_version": 1,
            "condition_id": ALERT, "revision": 1, "kind": "price_close",
            **SCOPE, "operator": "gt", "threshold": 140.0, "consecutive": 2,
            "expires_at": "2026-10-22T21:00:00.000Z", "origin_snapshot_id": None,
        },
    }
    rows = []
    for start, end, expiry, identity in (
        ("08", "12", "16", "11bd014973059403cf8a8d8b6fa8b617ce1b9270979431398d5f1190de313e57"),
        ("12", "16", "20", "52df079d29892cec2ca624d44bf32ae4bfd5dd994ba8fc6adf26b5451887433e"),
    ):
        start_text = f"2026-10-22T{start}:00:00Z"
        rows.append({
            **SCOPE, "status": "final", "revision": 1,
            "observation_id": "sha256:" + identity,
            "bar_start": start_text, "bar_end": f"2026-10-22T{end}:00:00Z",
            "available_at": f"2026-10-22T{end}:02:00Z",
            "expires_at": f"2026-10-22T{expiry}:00:00Z",
            "bar_sequence": int(datetime.fromisoformat(start_text.replace("Z", "+00:00")).timestamp()) // 14400,
            "close": 143.2,
        })
    snapshot = {
        "schema": SNAPSHOT_SCHEMA, "scope": dict(SCOPE),
        "policy_id": "fixture-only-adopted-policy", "policy_adopted": True,
        "state": "eligible", "generation": 4,
        "manifest_ref": "fixture://immutable-source/abcd", "manifest_sha256": "a" * 64,
        "observations": rows,
    }
    return alert, snapshot


def evaluator_double(outcome="met"):
    """Only echoes the canonical wire contract; contains no price predicate."""
    def evaluate(rule, bars, *, now):
        evidence = {
            "condition_id": rule["condition_id"], "rule_revision": rule["revision"],
            "rule": rule, "outcome": outcome,
            "withheld_reasons": ["fixture_owner_withheld"] if outcome == "withheld" else [],
            "observations": [{key: bar[key] for key in (
                "observation_id", "revision", "bar_end", "bar_sequence", "close",
            )} for bar in bars[-rule["consecutive"]:]],
            "supplied_observations": bars, "evaluator_version": "forex.final-close.v1",
        }
        raw = json.dumps(evidence, sort_keys=True, separators=(",", ":"), allow_nan=False)
        return {
            **evidence, "evaluation_id": hashlib.sha256(raw.encode()).hexdigest(),
            "evaluated_at": now, "authority": "condition_observation_only",
            "forecast_probability": None, "activation": "not_performed",
        }
    return evaluate


def prepare(alert=None, snapshot=None, **kwargs):
    a, s = fixture_inputs()
    return prepare_forex_enqueue(
        a if alert is None else alert, s if snapshot is None else snapshot,
        expected_owner=kwargs.pop("expected_owner", OWNER),
        now=kwargs.pop("now", NOW),
        evaluator=kwargs.pop("evaluator", evaluator_double()),
        condition_version_fn=kwargs.pop("condition_version_fn", condition_version),
        mint_fire_event_id_fn=kwargs.pop("mint_fire_event_id_fn", mint_fire_event_id),
        **kwargs,
    )


def acknowledgement(payload, status="accepted"):
    return {
        "status": status, "owner_id": payload["owner_id"], "alert_id": payload["alert_id"],
        "rule_revision": payload["expected_rule_revision"],
        "condition_version": payload["condition_version"],
        "fire_event_id": payload["fire_event_id"], "vintage": payload["vintage"],
        "receipt": {
            "outbox_id": OUTBOX, "evaluation_id": payload["evaluation_id"],
            "source_generation": payload["source_generation"],
            "manifest_sha256": payload["manifest_sha256"], "not_after": payload["not_after"],
        },
    }


def test_ready_uses_published_vintage_and_incumbent_identity_without_effect():
    alert, snapshot = fixture_inputs()
    original = deepcopy((alert, snapshot))
    result = prepare(alert, snapshot)
    assert result.status == "ready"
    payload = result.proposal.as_dict()
    assert payload["vintage"] == VINTAGE
    assert payload["condition_version"] == condition_version(alert["condition"])
    assert payload["fire_event_id"] == mint_fire_event_id(alert, VINTAGE)
    assert payload["not_after"] == "2026-10-22T20:00:00Z"
    assert payload["authority"] == "proposal_only"
    assert (alert, snapshot) == original


@pytest.mark.parametrize("outcome,expected", [("not_met", "not_met"), ("withheld", "withheld")])
def test_unmet_and_withheld_never_prepare_event(outcome, expected):
    def forbidden(*args):
        pytest.fail("identity work must not run without a met condition")
    result = prepare(evaluator=evaluator_double(outcome), mint_fire_event_id_fn=forbidden)
    assert result.status == expected
    assert result.proposal is None
    assert json.loads(result.evaluation_json)["outcome"] == outcome


@pytest.mark.parametrize("mutation,reason", [
    (lambda a, s: a.update(active=False), "alert_inactive"),
    (lambda a, s: a["condition"].update(feed=None), "unbound_or_wrong_source"),
    (lambda a, s: a["condition"].update(triggered=True), "invalid_rule_keys"),
    (lambda a, s: a["condition"].update(revision=True), "invalid_rule_identity"),
    (lambda a, s: a["condition"].update(schema_version=True), "unsupported_rule_schema"),
    (lambda a, s: a["condition"].update(consecutive=2.0), "invalid_sequence_length"),
    (lambda a, s: a["condition"].update(expires_at="2026-10-22T21:00:00Z"), "noncanonical_stored_rule_expiry"),
    (lambda a, s: a["condition"].update(expires_at="2026-10-22T21:00:00.000000001Z"), "noncanonical_stored_rule_expiry"),
    (lambda a, s: s.update(policy_adopted=False), "source_not_adopted_or_eligible"),
    (lambda a, s: s.update(state="CANDIDATE_NOT_ADOPTED"), "source_not_adopted_or_eligible"),
    (lambda a, s: s.update(generation=True), "invalid_source_generation"),
    (lambda a, s: s.update(generation=2**63), "invalid_source_generation"),
    (lambda a, s: s.update(manifest_sha256="A" * 64), "invalid_manifest"),
    (lambda a, s: s["scope"].update(feed=FEED + " "), "source_scope_mismatch"),
    (lambda a, s: s["observations"][0].update(revision=2), "invalid_observation_revision"),
    (lambda a, s: s["observations"][0].update(revision=1.0), "invalid_observation_revision"),
    (lambda a, s: s["observations"][0].update(revision=True), "invalid_observation_revision"),
    (lambda a, s: s["observations"][0].update(observation_id="sha256:" + "b" * 64), "observation_identity_mismatch"),
    (lambda a, s: s["observations"][0].update(bar_start="2026-10-22T08:00:00.000000001Z"), "invalid_4h_slot_boundary"),
    (lambda a, s: s["observations"][0].update(bar_sequence=True), "invalid_calendar_sequence"),
    (lambda a, s: s["observations"][0].update(close=True), "invalid_close"),
    (lambda a, s: s["observations"][0].update(status="candidate"), "nonfinal_observation"),
    (lambda a, s: s["observations"][-1].update(expires_at="2026-10-22T21:00:00Z"), "source_expiry_changed"),
    (lambda a, s: s["observations"][-1].update(available_at="2026-10-22T17:00:00.000000001Z"), "ineligible_observation_clock"),
])
def test_invalid_input_is_withheld_before_evaluation(mutation, reason):
    alert, snapshot = fixture_inputs()
    mutation(alert, snapshot)
    def forbidden(*args, **kwargs):
        pytest.fail("invalid/unadopted input must not reach the evaluator")
    result = prepare(alert, snapshot, evaluator=forbidden)
    assert result.status == "withheld"
    assert result.reasons == (reason,)
    assert result.proposal is None


def test_owner_mismatch_withholds():
    result = prepare(expected_owner=OUTBOX)
    assert result.reasons == ("owner_conflict",)


def test_full_window_duplicate_is_not_hidden_by_tail_selection():
    alert, snapshot = fixture_inputs()
    alert["condition"]["consecutive"] = 1
    snapshot["observations"].insert(0, deepcopy(snapshot["observations"][0]))
    assert prepare(alert, snapshot).reasons == ("duplicate_observation",)


def test_full_window_is_passed_to_evaluator_and_only_evaluated_tail_sets_vintage():
    alert, snapshot = fixture_inputs()
    alert["condition"]["consecutive"] = 1
    calls = []
    def evaluate(rule, bars, *, now):
        calls.append(deepcopy(bars))
        return evaluator_double()(rule, bars, now=now)
    result = prepare(alert, snapshot, evaluator=evaluate)
    assert result.status == "ready"
    assert len(calls[0]) == 2 and len(result.proposal.as_dict()["window"]) == 1
    assert result.proposal.as_dict()["vintage"] != VINTAGE


def test_gap_is_rejected_even_with_self_consistent_slot_identity():
    alert, snapshot = fixture_inputs()
    row = snapshot["observations"][0]
    row.update(bar_start="2026-10-22T04:00:00Z", bar_end="2026-10-22T08:00:00Z",
               available_at="2026-10-22T08:02:00Z", expires_at="2026-10-22T12:00:00Z",
               bar_sequence=row["bar_sequence"] - 1)
    preimage = [FEED, "USDJPY", "4H", "fx-utc-4h/v1", row["bar_start"], row["bar_end"]]
    row["observation_id"] = "sha256:" + hashlib.sha256(json.dumps(preimage, separators=(",", ":")).encode()).hexdigest()
    assert prepare(alert, snapshot).reasons == ("noncontiguous_observations",)


@pytest.mark.parametrize("now", ["2026-10-22T20:00:00Z", "2026-10-22T20:00:00.000000001Z"])
def test_newest_expiry_is_strict_but_older_supporting_slot_may_be_expired(now):
    assert prepare().status == "ready"  # The first supporting slot expired at16:00.
    assert prepare(now=now).reasons == ("latest_observation_expired",)


def test_rule_expiry_and_authoritative_deadline_shorten_without_renewing():
    alert, snapshot = fixture_inputs()
    alert["condition"]["expires_at"] = "2026-10-22T18:00:00.123Z"
    assert prepare(alert, snapshot).proposal.as_dict()["not_after"] == alert["condition"]["expires_at"]
    snapshot["eligibility_deadline"] = {
        "not_after": "2026-10-22T17:30:00Z", "reason": "fixture_owner_cutoff", "evidence_id": "fixture:e1",
    }
    assert prepare(alert, snapshot).proposal.as_dict()["not_after"] == "2026-10-22T17:30:00Z"
    assert prepare(alert, snapshot, now="2026-10-22T17:30:00Z").reasons == ("eligibility_expired",)
    snapshot["eligibility_deadline"]["not_after"] = "2026-10-22T22:00:00Z"
    assert prepare(alert, snapshot).reasons == ("eligibility_deadline_cannot_extend_source",)


def test_equal_readback_keeps_event_identity_but_rearm_changes_it():
    alert, snapshot = fixture_inputs()
    first = prepare(alert, snapshot).proposal.as_dict()
    snapshot.update(generation=6, manifest_ref="fixture://new-witness", manifest_sha256="b" * 64)
    snapshot["observations"][-1]["available_at"] = "2026-10-22T16:03:00Z"
    second = prepare(alert, snapshot, now="2026-10-22T17:01:00Z").proposal.as_dict()
    assert first["vintage"] == second["vintage"] == VINTAGE
    assert first["fire_event_id"] == second["fire_event_id"]
    assert first["evaluation_id"] != second["evaluation_id"]
    assert first["not_after"] == second["not_after"]
    alert["condition"]["revision"] = 2
    rearmed = prepare(alert, snapshot).proposal.as_dict()
    assert rearmed["vintage"] == VINTAGE
    assert rearmed["condition_version"] != first["condition_version"]
    assert rearmed["fire_event_id"] != first["fire_event_id"]


def test_prepared_request_is_detached_from_all_mutable_inputs_and_exports():
    alert, snapshot = fixture_inputs()
    result = prepare(alert, snapshot)
    before = result.proposal.payload_json
    alert["condition"]["threshold"] = 1
    snapshot["generation"] = 100
    snapshot["observations"][0]["close"] = 1
    exported = result.proposal.as_dict()
    exported["source_generation"] = 101
    assert result.proposal.payload_json == before


@pytest.mark.parametrize("field,value", [
    ("rule_revision", 2), ("evaluation_id", "b" * 64),
    ("authority", "enqueue_allowed"), ("activation", "performed"),
    ("supplied_observations", []), ("observations", []), ("evaluated_at", "2026-10-22T18:00:00Z"),
])
def test_inconsistent_evaluator_result_fails_closed(field, value):
    def evaluate(rule, bars, *, now):
        result = evaluator_double()(rule, bars, now=now)
        result[field] = value
        return result
    assert prepare(evaluator=evaluate).status == "withheld"


def test_evaluator_exception_and_identity_exception_are_typed():
    def unavailable(*args, **kwargs):
        raise RuntimeError("sensitive detail must not escape")
    assert prepare(evaluator=unavailable).reasons == ("evaluator_unavailable_or_invalid",)
    assert prepare(condition_version_fn=unavailable).reasons == ("identity_unavailable_or_invalid",)


def test_explicit_submit_calls_once_and_does_not_mutate_or_disarm():
    proposal = prepare().proposal
    before = proposal.payload_json
    calls = []
    def enqueue(payload):
        calls.append(payload)
        response = acknowledgement(payload)
        payload["source_generation"] = 999
        return response
    result = submit_prepared(proposal, enqueue=enqueue)
    assert result.status == "accepted" and len(calls) == 1
    assert not result.historical
    assert proposal.payload_json == before


def test_submission_timeout_is_unconfirmed_with_no_retry():
    calls = []
    def enqueue(payload):
        calls.append(payload["fire_event_id"])
        raise TimeoutError("unknown effect")
    result = submit_prepared(prepare().proposal, enqueue=enqueue)
    assert result.status == "unconfirmed"
    assert len(calls) == 1 and calls[0] == prepare().proposal.as_dict()["fire_event_id"]


@pytest.mark.parametrize("mutate", [
    lambda response: response.update(owner_id=OUTBOX),
    lambda response: response.update(rule_revision=True),
    lambda response: response.update(status="sent"),
    lambda response: response["receipt"].update(source_generation=True),
    lambda response: response["receipt"].update(evaluation_id="b" * 64),
    lambda response: response["receipt"].update(outbox_id="not-a-uuid"),
])
def test_bad_acknowledgement_stays_unconfirmed(mutate):
    def enqueue(payload):
        response = acknowledgement(payload)
        mutate(response)
        return response
    assert submit_prepared(prepare().proposal, enqueue=enqueue).status == "unconfirmed"


def test_replay_returns_original_evidence_without_renewing_it():
    proposal = prepare().proposal
    def enqueue(payload):
        response = acknowledgement(payload, "replayed")
        response["receipt"].update(evaluation_id="b" * 64, source_generation=2,
                                   manifest_sha256="c" * 64, not_after="2026-10-21T20:00:00Z")
        return response
    result = submit_prepared(proposal, enqueue=enqueue)
    assert result.status == "replayed" and result.historical
    assert json.loads(result.receipt_json)["receipt"]["source_generation"] == 2


@pytest.mark.parametrize("status", ["withheld", "conflict"])
def test_transaction_rejection_has_no_fallback(status):
    calls = []
    def enqueue(payload):
        calls.append(payload)
        response = acknowledgement(payload, status)
        response.pop("receipt")
        response["reasons"] = ["fixture_locked_source_changed"]
        return response
    result = submit_prepared(prepare().proposal, enqueue=enqueue)
    assert result.status == status and len(calls) == 1
    assert result.receipt_json is None


def test_malformed_proposal_never_reaches_transport():
    def forbidden(payload):
        pytest.fail("invalid proposal reached transport")
    assert submit_prepared(PreparedProposal("{}"), enqueue=forbidden).status == "unconfirmed"


def test_module_import_has_no_source_or_transport_acquisition():
    root = Path(__file__).resolve().parents[1]
    code = """
import pathlib, sys
sys.path.insert(0, sys.argv[1])
def guard(event, args):
    if event.startswith("socket.") or event in {"subprocess.Popen", "os.system"}:
        raise AssertionError("unexpected transport")
    if event == "open" and isinstance(args[0], str):
        name = pathlib.Path(args[0]).name
        if name.startswith(".env"):
            raise AssertionError("unexpected credential/environment read")
sys.addaudithook(guard)
import ingest.forex_close_proposal
print("IMPORT_INERT")
"""
    result = subprocess.run([sys.executable, "-I", "-c", code, str(root)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "IMPORT_INERT"


def test_actual_pinned_macro_evaluator_and_incumbent_identity():
    """Optional cross-repository proof; explicit exact source, never an ambient checkout."""
    supplied = os.environ.get("FOREX_CANONICAL_PROOF_ROOT")
    if not supplied:
        pytest.skip("explicit credential-free pinned Macro source image required for cross-repository proof")
    source = Path(supplied).resolve()
    expected_blobs = {
        "engine/forex_alerts.py": "aea6b913a9642a34b6cfb26657c0c970ee639ede",
        "lib/config.py": "b6fc888269876242597da354aaa726c20ed95802",
    }
    assert not (source / ".env").exists()
    for name, digest in expected_blobs.items():
        data = (source / name).read_bytes()
        assert hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest() == digest
    root = Path(__file__).resolve().parents[1]
    dependency_roots = sorted({str(Path(importlib.util.find_spec(name).origin).resolve().parent.parent)
                               for name in ("yaml", "pytest")})
    code = """
import copy, importlib.util, json, pathlib, sys
sys.path[:0] = [sys.argv[2], sys.argv[1]]
sys.path.extend(json.loads(sys.argv[3]))
def guard(event, args):
    if event.startswith("socket.") or event in {"subprocess.Popen", "os.system"}:
        raise AssertionError("unexpected proof transport")
    if event == "open" and isinstance(args[0], str) and pathlib.Path(args[0]).name.startswith(".env"):
        raise AssertionError("unexpected credential read")
sys.addaudithook(guard)
from engine.forex_alerts import evaluate_price_condition
from ingest.alerts_engine import condition_version, mint_fire_event_id
from ingest.forex_close_proposal import prepare_forex_enqueue
spec = importlib.util.spec_from_file_location("proposal_fixtures", pathlib.Path(sys.argv[1]) / "tests/test_forex_close_proposal.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
alert, snapshot = module.fixture_inputs()
def prepare(a, s, now=module.NOW):
    return prepare_forex_enqueue(a, s, expected_owner=module.OWNER, now=now,
        evaluator=evaluate_price_condition, condition_version_fn=condition_version,
        mint_fire_event_id_fn=mint_fire_event_id)
met = prepare(alert, snapshot)
assert met.status == "ready"
assert met.proposal.as_dict()["vintage"] == module.VINTAGE
assert met.proposal.as_dict()["fire_event_id"] == mint_fire_event_id(alert, module.VINTAGE)
alert["condition"]["threshold"] = 200
assert prepare(alert, snapshot).status == "not_met"
alert["condition"]["threshold"] = 140.0
assert prepare(alert, snapshot, "2026-10-22T20:00:00Z").status == "withheld"
saved = copy.deepcopy(alert)
saved["active"] = False
saved["condition"]["feed"] = None
assert prepare(saved, snapshot).status == "withheld"
first = met.proposal.as_dict()
snapshot.update(generation=6, manifest_sha256="b" * 64)
snapshot["observations"][-1]["available_at"] = "2026-10-22T16:03:00Z"
reread = prepare(alert, snapshot, "2026-10-22T17:01:00Z").proposal.as_dict()
assert reread["fire_event_id"] == first["fire_event_id"]
assert reread["evaluation_id"] != first["evaluation_id"]
alert["condition"]["revision"] = 2
rearmed = prepare(alert, snapshot).proposal.as_dict()
assert rearmed["fire_event_id"] != first["fire_event_id"]
assert rearmed["vintage"] == first["vintage"]
print(json.dumps({"actual_evaluator": "PASS", "met": True, "not_met": True, "expiry": True,
    "inactive": True, "equal_reread": True, "rearm": True}))
"""
    result = subprocess.run([sys.executable, "-I", "-c", code, str(root), str(source), json.dumps(dependency_roots)],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["actual_evaluator"] == "PASS"


@pytest.mark.parametrize("field", ["condition", "window", "evaluation", "not_after", "manifest_sha256"])
def test_truncated_proposal_never_reaches_transport(field):
    payload = prepare().proposal.as_dict()
    del payload[field]
    def forbidden(payload):
        pytest.fail("truncated proposal reached transport")
    result = submit_prepared(PreparedProposal(json.dumps(payload)), enqueue=forbidden)
    assert result.status == "unconfirmed"


@pytest.mark.parametrize("change", [
    lambda p: p.update(vintage="forex-4h/v1:sha256:" + "a" * 64),
    lambda p: p.update(not_after="2026-10-22T22:00:00Z"),
    lambda p: p.update(expected_rule_revision=True),
    lambda p: p["window"][0].update(revision=True),
    lambda p: p["window"][0].update(close=1),
])
def test_tampered_proposal_never_reaches_transport(change):
    payload = prepare().proposal.as_dict()
    change(payload)
    def forbidden(payload):
        pytest.fail("tampered proposal reached transport")
    assert submit_prepared(PreparedProposal(json.dumps(payload)), enqueue=forbidden).status == "unconfirmed"


def test_rehashed_boolean_evidence_does_not_alias_integer_rule_revision():
    def evaluate(rule, bars, *, now):
        result = evaluator_double()(rule, bars, now=now)
        result["rule_revision"] = True
        evidence = {key: result[key] for key in (
            "condition_id", "rule_revision", "rule", "outcome", "withheld_reasons",
            "observations", "supplied_observations", "evaluator_version",
        )}
        result["evaluation_id"] = hashlib.sha256(
            json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        return result
    assert prepare(evaluator=evaluate).reasons == ("evaluator_rule_mismatch",)


def test_deeply_nested_input_is_typed_withheld():
    nested = []
    for _ in range(2000):
        nested = [nested]
    result = prepare_forex_enqueue(nested, {}, expected_owner=OWNER, now=NOW,
        evaluator=evaluator_double(), condition_version_fn=condition_version,
        mint_fire_event_id_fn=mint_fire_event_id)
    assert result.status == "withheld"
    assert result.reasons in {("invalid_input_json",), ("invalid_alert",)}
