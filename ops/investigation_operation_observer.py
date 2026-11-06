"""Observe one named original operation through its incumbent read-only RPC.

The supplied callbacks belong to the same authenticated incumbent client:
get_subject reads its actual subject and rpc executes the existing RPC. There
is no client construction, credential/config input, reconciliation call, retry,
write or public endpoint here. Tests inject these two observation boundaries.

0028 read_investigation_operation_v2 selects the stored result by auth.uid()
and operation_id. Under the qualified 0030 state machine, a stored not_applied
result is a terminal fence: reconcile inserts it under the operation lock and
apply consults that same immutable receipt before writing. A read miss is NOT
that fence. The capacity branch's unstored limit_reached answer is deliberately
not accepted as a stored receipt. Receipt immutability/current schema/grants
still need their actual separate qualification; this helper never clears OPEN.
This is canonical database scope only. Private capture can precede that SQL
owner and remain active/UNKNOWN after its fence or commit; no handler count,
receipt miss or canonical result establishes whole-request settlement.
"""
import re
from datetime import datetime

READ_RPC = "read_investigation_operation_v2"
_UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_REQUIRES = "actual-schema-grants-and-receipt-immutability-qualification"


def _valid(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _result(observation, reason):
    return {"observation": observation, "reason": reason,
            "observation_scope": "canonical_database_only",
            "native_capture_outcome": "not_established", "whole_request_settled": False,
            "cutover_qualified": False, "requires": _REQUIRES}


def observe_original_operation(*, principal, operation_id, investigation_id,
                               get_subject, rpc, expected_manifest_digest=None,
                               expected_revision=None):
    """Read once, bind the same subject/key, report only recorded observations.

    An empty/unknown original inventory cannot call this function successfully:
    each observation needs explicit original principal, operation and target.
    This is not a claim that the supplied named set is globally exhaustive.
    """
    unresolved = lambda reason: _result("unresolved", reason)
    if not all(_valid(_UUID, value) for value in (principal, operation_id, investigation_id)):
        return unresolved("original_identity_unavailable")
    if not callable(get_subject) or not callable(rpc):
        return unresolved("incumbent_reader_unavailable")
    try:
        if get_subject() != principal:
            return unresolved("principal_unavailable_or_changed")
        reply = rpc(READ_RPC, {"p_operation_id": operation_id})
        if get_subject() != principal:
            return unresolved("principal_unavailable_or_changed")
    except Exception:
        return unresolved("read_unavailable")
    if type(reply) is not dict or reply.get("error", True) is not None:
        return unresolved("read_unavailable")
    data = reply.get("data")
    if type(data) is not dict:
        return unresolved("receipt_unavailable")
    if data.get("id") != investigation_id or data.get("operation_id") != operation_id:
        return unresolved("receipt_identity_unavailable_or_mismatched")
    if data.get("status") == "not_applied":
        # The persistent 0030 fence is exactly this shape. In particular, do
        # not accept an unstored capacity response or caller-supplied label.
        if set(data) != {"status", "id", "operation_id"}:
            return unresolved("recorded_fence_not_established")
        return _result("canonical_not_applied", "stored_original_key_canonical_fence")
    if data.get("status") == "committed":
        if (data.get("author_ref") != principal
                or not _valid(_DIGEST, expected_manifest_digest)
                or data.get("manifest_digest") != expected_manifest_digest
                or type(expected_revision) is not int or not 0 <= expected_revision < 2147483647
                or type(data.get("revision")) is not int or data["revision"] != expected_revision + 1
                or data.get("investigation_id") != investigation_id
                or not _valid(_UUID, data.get("revision_id"))
                or type(data.get("sequence")) is not int or data["sequence"] != data["revision"]
                or "parent_revision_id" not in data
                or (data["parent_revision_id"] is not None and not _valid(_UUID, data["parent_revision_id"]))
                or ((data["revision"] == 1) != (data["parent_revision_id"] is None))
                or data.get("lifecycle") not in ("active", "removed")
                or type(data.get("manifest")) is not dict
                or data["manifest"].get("schema") != "investigation_manifest.v2"
                or not isinstance(data.get("committed_at"), str)
                or data.get("recorded_at") != data["committed_at"]):
            return unresolved("original_commit_binding_not_established")
        try:
            if datetime.fromisoformat(data["committed_at"]).utcoffset() is None:
                return unresolved("original_commit_binding_not_established")
        except (ValueError, TypeError):
            return unresolved("original_commit_binding_not_established")
        return _result("recorded_commit", "stored_original_key_commit")
    return unresolved("no_recorded_terminal_disposition")
