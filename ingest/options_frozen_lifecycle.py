"""Explicit adapter to protected lifecycle/state RPCs on the incumbent alerts row.

No source/action grant, default reader, network client, enrollment or fire operation.
The engine supplies its incumbent identity/time/state validators; this module does
not create a second target fingerprint or sampled-proximity calculation.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from uuid import UUID


def stable_predicate(condition):
    """Full JSON value, excluding only this type's two identified output fields."""
    if not isinstance(condition, dict):
        return None
    try:
        return json.loads(json.dumps({k: v for k, v in condition.items()
                                      if k not in {"_fnp", "triggered"}}, allow_nan=False))
    except (TypeError, ValueError, OverflowError, RecursionError):
        return None


def _json_equal(a, b):
    # Match JSON value/JSONB numeric semantics without bool==1 or lossy hashes.
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_json_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_json_equal(x, y) for x, y in zip(a, b))
    numeric = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
    if numeric(a) and numeric(b):
        return a == b
    return type(a) is type(b) and a == b


@dataclass(frozen=True)
class FrozenRuntime:
    alert_id: str
    principal: str
    generation: str
    revision: int
    created_at: str
    arming_epoch: str
    evaluation_at: str
    target_fingerprint: str
    within_pct: float
    predicate_json: str
    prior_json: str

    @property
    def predicate(self):
        return json.loads(self.predicate_json)

    @property
    def prior_state(self):
        return json.loads(self.prior_json)


class FrozenNodeLifecycleAdapter:
    """Injected service-RPC transport only; constructing this adapter does no IO.

    Only explicit future callers may supply one to the engine. A protected runtime
    attests lifecycle/state provenance, never source/action authorization.
    """
    def __init__(self, rpc, *, fingerprint, instant_micros, normalize_state,
                 format_instant, default_within_pct, source_origin=None):
        self.source_origin = source_origin  # Host transport provenance, never persisted row data.
        self.rpc = rpc
        self.fingerprint = fingerprint
        self.instant = instant_micros
        self.normalize_state = normalize_state
        self.format_instant = format_instant
        self.default_within_pct = default_within_pct

    def _validate(self, alert, result, evaluation_at):
        try:
            if not isinstance(result, dict) or result.get("kind") != "data":
                return None
            runtime = result.get("runtime")
            keys = {"schema", "alertId", "principal", "generation", "createdAt", "armingEpoch",
                    "predicate", "revision", "priorState"}
            if not isinstance(runtime, dict) or set(runtime) != keys:
                return None
            if runtime["schema"] != "options.frozen_runtime/v1":
                return None
            if runtime["alertId"] != alert.get("id") or runtime["principal"] != alert.get("user_id"):
                return None
            if not all(isinstance(runtime[k], str) and runtime[k] for k in ("alertId", "principal", "generation")):
                return None
            if str(UUID(runtime["generation"])) != runtime["generation"]:
                return None
            revision = runtime["revision"]
            if type(revision) is not int or revision < 0:
                return None
            predicate = stable_predicate(alert.get("condition"))
            if not predicate or predicate.get("type") != "opt_frozen_node_proximity":
                return None
            if not _json_equal(predicate, runtime["predicate"]):
                return None
            fp = self.fingerprint(predicate.get("target"))
            if not fp:
                return None
            created, epoch, at = (self.instant(runtime["createdAt"]),
                                  self.instant(runtime["armingEpoch"]), self.instant(evaluation_at))
            if created is None or epoch is None or at is None or not created == epoch <= at:
                return None
            within = predicate.get("within_pct", self.default_within_pct)
            if isinstance(within, bool) or not isinstance(within, (int, float)) or not math.isfinite(within) or within < 0:
                return None
            prior = runtime["priorState"]
            if (revision == 0) != (prior is None):
                return None
            if prior is not None:
                prior = self.normalize_state(prior, fp)
                if not prior or prior["armingEpoch"] != self.format_instant(epoch):
                    return None
                quote = self.instant(prior["lastQuoteAt"])
                if quote is None or not epoch < quote <= at or prior["withinPct"] != within:
                    return None
            return FrozenRuntime(runtime["alertId"], runtime["principal"], runtime["generation"], revision,
                                 self.format_instant(created), self.format_instant(epoch), evaluation_at,
                                 fp, float(within), json.dumps(predicate, sort_keys=True, allow_nan=False),
                                 json.dumps(prior, sort_keys=True, allow_nan=False))
        except (TypeError, ValueError, KeyError, OverflowError, RecursionError):
            return None

    def read(self, alert, evaluation_at):
        predicate = stable_predicate(alert.get("condition"))
        if not predicate:
            return None
        try:
            reply = self.rpc("read_frozen_node_runtime", {
                "p_alert_id": alert.get("id"), "p_principal": alert.get("user_id"), "p_predicate": predicate,
            })
            return self._validate(alert, reply, evaluation_at)
        except Exception:
            return None

    def commit(self, snapshot, next_state):
        """State-only CAS. Never fallback to an ordinary table PATCH or outbox."""
        if not isinstance(snapshot, FrozenRuntime):
            return False
        try:
            state = self.normalize_state(next_state, snapshot.target_fingerprint)
            if not state or state["armingEpoch"] != snapshot.arming_epoch or state["withinPct"] != snapshot.within_pct:
                return False
            quote = self.instant(state["lastQuoteAt"])
            prior = snapshot.prior_state
            if (quote is None or quote <= self.instant(snapshot.arming_epoch)
                    or quote > self.instant(snapshot.evaluation_at)
                    or (prior and quote <= self.instant(prior["lastQuoteAt"]))):
                return False
            reply = self.rpc("commit_frozen_node_state", {
                "p_alert_id": snapshot.alert_id, "p_principal": snapshot.principal,
                "p_predicate": snapshot.predicate, "p_generation": snapshot.generation,
                "p_revision": snapshot.revision, "p_next_state": state,
            })
            alert = {"id": snapshot.alert_id, "user_id": snapshot.principal, "condition": snapshot.predicate}
            current = self._validate(alert, reply, snapshot.evaluation_at)
            return bool(current and current.generation == snapshot.generation
                        and current.revision == snapshot.revision + 1
                        and current.created_at == snapshot.created_at and current.arming_epoch == snapshot.arming_epoch
                        and _json_equal(current.prior_state, state))
        except Exception:
            return False
