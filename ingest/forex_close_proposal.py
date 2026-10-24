"""Inert Forex proposal preparation; no source, database or delivery transport.

This is a proposed internal contract, not a source-admission or activation path.
The installed 0038 rules remain inactive with feed=None and therefore withhold.
Callers must inject the canonical Macro evaluator and incumbent Terminal identity
functions. No engine registration, environment read, CLI or default callback exists.
The eventual atomic transaction must independently revalidate every expectation
after owner -> source -> alert locks and sample a fresh database wall clock.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import re
from typing import Callable, Literal
from uuid import UUID

FEED = "tiingo.fx.USDJPY.reported-close.utc4h.local/v1"
SCOPE = {
    "feed": FEED, "pair": "USDJPY", "interval": "4H",
    "calendar": "fx-utc-4h/v1", "quote_basis": "literal",
}
SNAPSHOT_SCHEMA = "forex.qualified-source-snapshot.proposal.v1"
PROPOSAL_SCHEMA = "forex.atomic-enqueue.proposal.v1"
_BAR_KEYS = (
    "observation_id", "revision", "pair", "feed", "interval", "calendar",
    "quote_basis", "status", "bar_end", "available_at", "expires_at",
    "bar_sequence", "close",
)
_RULE_REQUIRED = {
    "type", "schema_version", "condition_id", "revision", "kind", "pair",
    "quote_basis", "interval", "calendar", "operator", "threshold",
    "consecutive", "expires_at", "feed",
}
_EVIDENCE_KEYS = {
    "condition_id", "rule_revision", "rule", "outcome", "withheld_reasons",
    "observations", "supplied_observations", "evaluator_version",
}
_CLOCK = re.compile(
    r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})"
)
_HEX64 = re.compile(r"[0-9a-f]{64}")
_NS = 1_000_000_000
_SLOT = 14_400 * _NS
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class PreparedProposal:
    """Detached strict-JSON bytes. A proposal grants no permission to enqueue."""
    payload_json: str

    def as_dict(self) -> dict:
        return json.loads(self.payload_json)


@dataclass(frozen=True)
class PreparationResult:
    status: Literal["ready", "not_met", "withheld"]
    reasons: tuple[str, ...] = ()
    proposal: PreparedProposal | None = None
    evaluation_json: str | None = None


@dataclass(frozen=True)
class EnqueueResult:
    status: Literal["accepted", "replayed", "withheld", "conflict", "unconfirmed"]
    reasons: tuple[str, ...] = ()
    receipt_json: str | None = None
    # A replay is historical outcome recovery, never a freshness assertion.
    historical: bool = False


class _Invalid(ValueError):
    pass


def _require(ok: bool, reason: str) -> None:
    if not ok:
        raise _Invalid(reason)


def _json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def _copy(value):
    return json.loads(_json(value))


def _integer(value, maximum=2**63 - 1) -> bool:
    return type(value) is int and 0 < value <= maximum


def _uuid(value) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = UUID(value)
        return str(parsed) == value and parsed.version in {1, 2, 3, 4, 5}
    except (ValueError, AttributeError):
        return False


def _text(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _sha(value) -> bool:
    return isinstance(value, str) and _HEX64.fullmatch(value) is not None


def _clock(value) -> int:
    """Parse ISO clocks without discarding a fractional or nanosecond component."""
    _require(isinstance(value, str), "invalid_clock")
    match = _CLOCK.fullmatch(value)
    _require(match is not None, "invalid_clock")
    date, fraction, offset = match.groups()
    _require(offset == "Z" or (int(offset[1:3]) < 24 and int(offset[4:6]) < 60), "invalid_clock")
    try:
        dt = datetime.fromisoformat(date + ("+00:00" if offset == "Z" else offset))
        delta = dt.astimezone(timezone.utc) - _EPOCH
    except (ValueError, OverflowError):
        raise _Invalid("invalid_clock") from None
    return (delta.days * 86400 + delta.seconds) * _NS + int((fraction or "").ljust(9, "0"))


def _format_clock(value: int) -> str:
    seconds, fraction = divmod(value, _NS)
    dt = _EPOCH + timedelta(seconds=seconds)
    text = f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}T{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}"
    return text + (("." + f"{fraction:09d}".rstrip("0")) if fraction else "") + "Z"


def _slot(value) -> int:
    result = _clock(value)
    _require(result % _SLOT == 0, "invalid_4h_slot_boundary")
    return result


def _validate_alert(alert: dict, expected_owner: str, now_ns: int) -> dict:
    _require(isinstance(alert, dict), "invalid_alert")
    _require(_uuid(expected_owner) and alert.get("user_id") == expected_owner, "owner_conflict")
    _require(_uuid(alert.get("id")), "invalid_alert_identity")
    rule = alert.get("condition")
    _require(isinstance(rule, dict), "invalid_rule")
    _require(_RULE_REQUIRED <= rule.keys() <= _RULE_REQUIRED | {"origin_snapshot_id"}, "invalid_rule_keys")
    _require(alert.get("active") is True, "alert_inactive")
    _require(rule["type"] == "forex_price_close" and type(rule["schema_version"]) is int
             and rule["schema_version"] == 1, "unsupported_rule_schema")
    _require(rule["condition_id"] == alert["id"] and _integer(rule["revision"], 2**31 - 1),
             "invalid_rule_identity")
    _require(alert.get("symbol") == "USDJPY" and rule["kind"] == "price_close", "unsupported_rule")
    _require(all(rule.get(key) == value for key, value in SCOPE.items()), "unbound_or_wrong_source")
    _require(rule["operator"] in {"lt", "lte", "gt", "gte"}
             and type(rule["threshold"]) in {int, float}
             and math.isfinite(rule["threshold"]) and rule["threshold"] > 0, "invalid_price_rule")
    _require(_integer(rule["consecutive"], 10), "invalid_sequence_length")
    _require(isinstance(rule["expires_at"], str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", rule["expires_at"]) is not None,
        "noncanonical_stored_rule_expiry")
    _require(now_ns < _clock(rule["expires_at"]), "condition_expired")
    origin = rule.get("origin_snapshot_id")
    _require(origin is None or (_text(origin) and len(origin) <= 256), "invalid_origin_snapshot")
    return rule


def _validate_snapshot(snapshot: dict, now_ns: int) -> tuple[list[dict], int | None]:
    _require(isinstance(snapshot, dict) and snapshot.get("schema") == SNAPSHOT_SCHEMA, "unqualified_snapshot")
    _require(snapshot.get("scope") == SCOPE, "source_scope_mismatch")
    # These are expectations from a future authenticated owner readback, not
    # authentication. SQL must compare them to its actual protected source row.
    _require(snapshot.get("state") == "eligible" and snapshot.get("policy_adopted") is True
             and _text(snapshot.get("policy_id")), "source_not_adopted_or_eligible")
    _require(_integer(snapshot.get("generation")), "invalid_source_generation")
    _require(_text(snapshot.get("manifest_ref")) and _sha(snapshot.get("manifest_sha256")), "invalid_manifest")
    rows = snapshot.get("observations")
    _require(isinstance(rows, list) and bool(rows), "missing_observations")
    seen_ids, seen_ends = set(), set()
    previous_end = previous_sequence = None
    bars = []
    for row in rows:
        _require(isinstance(row, dict) and set(row) == set(_BAR_KEYS) | {"bar_start"}, "invalid_observation_shape")
        _require(type(row["revision"]) is int and row["revision"] == 1, "invalid_observation_revision")
        _require(all(row.get(key) == value for key, value in SCOPE.items()), "observation_scope_mismatch")
        _require(row["status"] == "final", "nonfinal_observation")
        start, end = _slot(row["bar_start"]), _slot(row["bar_end"])
        _require(end - start == _SLOT, "invalid_slot_duration")
        preimage = json.dumps(
            [FEED, "USDJPY", "4H", "fx-utc-4h/v1", _format_clock(start), _format_clock(end)],
            separators=(",", ":"), ensure_ascii=True,
        ).encode("ascii")
        identity = "sha256:" + hashlib.sha256(preimage).hexdigest()
        _require(row["observation_id"] == identity, "observation_identity_mismatch")
        _require(identity not in seen_ids and end not in seen_ends, "duplicate_observation")
        seen_ids.add(identity)
        seen_ends.add(end)
        sequence = row["bar_sequence"]
        _require(type(sequence) is int and sequence == start // _SLOT, "invalid_calendar_sequence")
        _require(previous_end is None or (end == previous_end + _SLOT and sequence == previous_sequence + 1),
                 "noncontiguous_observations")
        previous_end, previous_sequence = end, sequence
        _require(type(row["close"]) in {int, float} and math.isfinite(row["close"]) and row["close"] > 0,
                 "invalid_close")
        _require(end <= _clock(row["available_at"]) <= now_ns, "ineligible_observation_clock")
        _require(_clock(row["expires_at"]) == end + _SLOT, "source_expiry_changed")
        bars.append({key: row[key] for key in _BAR_KEYS})
    _require(now_ns < _clock(bars[-1]["expires_at"]), "latest_observation_expired")
    deadline = snapshot.get("eligibility_deadline")
    if deadline is not None:
        _require(isinstance(deadline, dict) and set(deadline) == {"not_after", "reason", "evidence_id"}
                 and _text(deadline["reason"]) and _text(deadline["evidence_id"]), "invalid_eligibility_deadline")
        deadline_ns = _clock(deadline["not_after"])
        _require(deadline_ns <= _clock(bars[-1]["expires_at"]), "eligibility_deadline_cannot_extend_source")
        _require(now_ns < deadline_ns, "eligibility_expired")
    else:
        deadline_ns = None
    return bars, deadline_ns


def _validate_evaluation(value: dict, rule: dict, bars: list[dict], now: str) -> dict:
    _require(isinstance(value, dict), "invalid_evaluator_result")
    expected_keys = _EVIDENCE_KEYS | {"evaluation_id", "evaluated_at", "authority", "forecast_probability", "activation"}
    _require(set(value) == expected_keys, "invalid_evaluator_shape")
    _require(_json(value["rule"]) == _json(rule) and value["condition_id"] == rule["condition_id"]
             and type(value["rule_revision"]) is int and value["rule_revision"] == rule["revision"],
             "evaluator_rule_mismatch")
    _require(value["evaluator_version"] == "forex.final-close.v1"
             and value["authority"] == "condition_observation_only"
             and value["activation"] == "not_performed" and value["forecast_probability"] is None
             and value["evaluated_at"] == now, "evaluator_authority_mismatch")
    selected = bars[-rule["consecutive"]:]
    expected = [{key: bar[key] for key in ("observation_id", "revision", "bar_end", "bar_sequence", "close")}
                for bar in selected]
    _require(_json(value["observations"]) == _json(expected)
             and _json(value["supplied_observations"]) == _json(bars), "evaluator_window_mismatch")
    _require(value["outcome"] in {"met", "not_met", "withheld"}, "invalid_evaluator_outcome")
    reasons = value["withheld_reasons"]
    _require(isinstance(reasons, list) and all(_text(reason) for reason in reasons), "invalid_evaluator_reasons")
    _require((value["outcome"] == "withheld") == bool(reasons), "inconsistent_evaluator_outcome")
    digest = hashlib.sha256(_json({key: value[key] for key in _EVIDENCE_KEYS}).encode()).hexdigest()
    _require(value["evaluation_id"] == digest, "evaluator_digest_mismatch")
    return value


def prepare_forex_enqueue(
    alert: dict,
    qualified_snapshot: dict,
    *,
    expected_owner: str,
    now: str,
    evaluator: Callable,
    condition_version_fn: Callable,
    mint_fire_event_id_fn: Callable,
) -> PreparationResult:
    """Prepare expectations only. No callback here can enqueue or disarm an alert.

    Current inactive/null-feed rules withhold. An eligible fixture demonstrates a
    future interface; it never installs/adopts the source or changes 0038.
    """
    try:
        owned_alert, snapshot = _copy(alert), _copy(qualified_snapshot)
        now_ns = _clock(now)
        rule = _validate_alert(owned_alert, expected_owner, now_ns)
        bars, eligibility_deadline = _validate_snapshot(snapshot, now_ns)
        _require(len(bars) >= rule["consecutive"], "insufficient_observations")
    except (ValueError, TypeError, OverflowError, RecursionError) as exc:
        reason = str(exc) if isinstance(exc, _Invalid) else "invalid_input_json"
        return PreparationResult("withheld", (reason,))
    try:
        evaluation = _copy(evaluator(_copy(rule), _copy(bars), now=now))
        _validate_evaluation(evaluation, rule, bars, now)
    except _Invalid as exc:
        return PreparationResult("withheld", (str(exc),))
    except Exception:
        return PreparationResult("withheld", ("evaluator_unavailable_or_invalid",))
    evidence_json = _json(evaluation)
    if evaluation["outcome"] != "met":
        return PreparationResult(
            "not_met" if evaluation["outcome"] == "not_met" else "withheld",
            tuple(evaluation["withheld_reasons"]), evaluation_json=evidence_json,
        )
    selected = snapshot["observations"][-rule["consecutive"]:]
    window = [[row["observation_id"], row["revision"]] for row in selected]
    vintage_bytes = json.dumps(["forex-price-close-window/v1", FEED, window], separators=(",", ":"), ensure_ascii=True).encode("ascii")
    vintage = "forex-4h/v1:sha256:" + hashlib.sha256(vintage_bytes).hexdigest()
    try:
        condition_version = condition_version_fn(_copy(rule))
        fire_event_id = mint_fire_event_id_fn(_copy(owned_alert), vintage)
        _require(isinstance(condition_version, str) and re.fullmatch(r"[0-9a-f]{16}", condition_version) is not None,
                 "invalid_condition_version")
        _require(_sha(fire_event_id), "invalid_fire_event_id")
    except Exception:
        return PreparationResult("withheld", ("identity_unavailable_or_invalid",), evaluation_json=evidence_json)
    deadlines = [_clock(rule["expires_at"]), _clock(selected[-1]["expires_at"])]
    if eligibility_deadline is not None:
        deadlines.append(eligibility_deadline)
    proposal = {
        "schema": PROPOSAL_SCHEMA, "authority": "proposal_only", "activation": "not_performed",
        "owner_id": expected_owner, "alert_id": owned_alert["id"],
        "expected_rule_revision": rule["revision"], "condition_version": condition_version,
        "condition": rule, "source_scope": snapshot["scope"], "policy_id": snapshot["policy_id"],
        "source_generation": snapshot["generation"], "manifest_ref": snapshot["manifest_ref"],
        "manifest_sha256": snapshot["manifest_sha256"], "window": selected,
        "vintage": vintage, "fire_event_id": fire_event_id,
        "evaluation": evaluation, "evaluation_id": evaluation["evaluation_id"],
        "prepared_at": now, "not_after": _format_clock(min(deadlines)),
        "eligibility_deadline": snapshot.get("eligibility_deadline"),
    }
    return PreparationResult("ready", proposal=PreparedProposal(_json(proposal)), evaluation_json=evidence_json)


def _validate_proposal(payload: dict) -> None:
    """Reject malformed/tampered wire data before calling an effectful callback.

    This is shape/evidence validation, not authentication. Only the future SQL
    owner can prove actual active intent, source admission and atomic effects.
    """
    keys = {
        "schema", "authority", "activation", "owner_id", "alert_id",
        "expected_rule_revision", "condition_version", "condition", "source_scope",
        "policy_id", "source_generation", "manifest_ref", "manifest_sha256", "window",
        "vintage", "fire_event_id", "evaluation", "evaluation_id", "prepared_at",
        "not_after", "eligibility_deadline",
    }
    _require(isinstance(payload, dict) and set(payload) == keys, "invalid_proposal_shape")
    _require(payload["schema"] == PROPOSAL_SCHEMA and payload["authority"] == "proposal_only"
             and payload["activation"] == "not_performed", "invalid_proposal_authority")
    _require(_integer(payload["expected_rule_revision"], 2**31 - 1)
             and isinstance(payload["condition_version"], str)
             and re.fullmatch(r"[0-9a-f]{16}", payload["condition_version"]) is not None
             and _sha(payload["fire_event_id"]), "invalid_proposal_identity")
    now_ns = _clock(payload["prepared_at"])
    alert = {"id": payload["alert_id"], "user_id": payload["owner_id"],
             "symbol": "USDJPY", "active": True, "condition": payload["condition"]}
    rule = _validate_alert(alert, payload["owner_id"], now_ns)
    _require(rule["revision"] == payload["expected_rule_revision"], "proposal_revision_mismatch")
    snapshot = {
        "schema": SNAPSHOT_SCHEMA, "scope": payload["source_scope"],
        "policy_id": payload["policy_id"], "policy_adopted": True, "state": "eligible",
        "generation": payload["source_generation"], "manifest_ref": payload["manifest_ref"],
        "manifest_sha256": payload["manifest_sha256"], "observations": payload["window"],
        "eligibility_deadline": payload["eligibility_deadline"],
    }
    selected, eligibility_deadline = _validate_snapshot(snapshot, now_ns)
    _require(len(selected) == rule["consecutive"], "proposal_window_mismatch")
    evaluation = payload["evaluation"]
    _require(isinstance(evaluation, dict) and isinstance(evaluation.get("supplied_observations"), list),
             "invalid_proposal_evidence")
    supplied = evaluation["supplied_observations"]
    _require(len(supplied) >= len(selected) and _json(supplied[-len(selected):]) == _json(selected),
             "proposal_window_mismatch")
    # The full evaluated window remains visible; reconstruct only the fixed
    # preceding boundary for validation, never a price or an observation.
    complete = []
    for bar in supplied:
        _require(isinstance(bar, dict) and set(bar) == set(_BAR_KEYS), "invalid_proposal_bar")
        complete.append({**bar, "bar_start": _format_clock(_slot(bar["bar_end"]) - _SLOT)})
    _validate_snapshot({**snapshot, "observations": complete}, now_ns)
    _validate_evaluation(evaluation, rule, supplied, payload["prepared_at"])
    _require(evaluation["outcome"] == "met" and payload["evaluation_id"] == evaluation["evaluation_id"],
             "proposal_evaluation_mismatch")
    window = [[bar["observation_id"], bar["revision"]] for bar in selected]
    encoded = json.dumps(["forex-price-close-window/v1", FEED, window],
                         separators=(",", ":"), ensure_ascii=True).encode("ascii")
    _require(payload["vintage"] == "forex-4h/v1:sha256:" + hashlib.sha256(encoded).hexdigest(),
             "proposal_vintage_mismatch")
    deadlines = [_clock(rule["expires_at"]), _clock(selected[-1]["expires_at"])]
    if eligibility_deadline is not None:
        deadlines.append(eligibility_deadline)
    _require(payload["not_after"] == _format_clock(min(deadlines)), "proposal_deadline_mismatch")


def submit_prepared(proposal: PreparedProposal, *, enqueue: Callable) -> EnqueueResult:
    """One explicit call to an injected future atomic boundary; never auto-retry.

    Exceptions or unqualified acknowledgements leave the original event
    unconfirmed. Reconciliation must query that original event through its owner.
    No insert_outbox, Supa.fire, alert update, disarm or network client is supplied.
    """
    try:
        payload = proposal.as_dict()
        _validate_proposal(payload)
        expected = {key: payload[key] for key in ("owner_id", "alert_id", "condition_version", "fire_event_id", "vintage")}
        expected["rule_revision"] = payload["expected_rule_revision"]
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError, RecursionError):
        return EnqueueResult("unconfirmed", ("invalid_proposal",))
    try:
        response = _copy(enqueue(_copy(payload)))
    except Exception:
        return EnqueueResult("unconfirmed", ("enqueue_acknowledgement_unavailable",))
    try:
        _require(isinstance(response, dict) and _integer(response.get("rule_revision"), 2**31 - 1)
                 and all(response.get(key) == value for key, value in expected.items()),
                 "enqueue_identity_mismatch")
        status = response.get("status")
        _require(status in {"accepted", "replayed", "withheld", "conflict"}, "invalid_enqueue_status")
        if status in {"withheld", "conflict"}:
            reasons = response.get("reasons")
            _require(isinstance(reasons, list) and bool(reasons) and all(_text(reason) for reason in reasons),
                     "invalid_enqueue_reasons")
            return EnqueueResult(status, tuple(reasons))
        receipt = response.get("receipt")
        _require(isinstance(receipt, dict) and _uuid(receipt.get("outbox_id"))
                 and _sha(receipt.get("evaluation_id")) and _integer(receipt.get("source_generation"))
                 and _sha(receipt.get("manifest_sha256")), "invalid_enqueue_receipt")
        _clock(receipt.get("not_after"))
        if status == "accepted":
            _require(all(receipt[key] == payload[key] for key in (
                "evaluation_id", "source_generation", "manifest_sha256", "not_after",
            )), "accepted_receipt_mismatch")
        # A replay retains the first evidence, even when an equal reread has a
        # different generation/manifest/evaluation digest or is now expired.
        return EnqueueResult(status, receipt_json=_json(response), historical=status == "replayed")
    except (KeyError, TypeError, ValueError) as exc:
        reason = str(exc) if isinstance(exc, _Invalid) else "invalid_enqueue_acknowledgement"
        return EnqueueResult("unconfirmed", (reason,))
