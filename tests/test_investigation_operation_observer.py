"""Existing native receipt read protocol only; no DB or reconciliation effect."""
import importlib.util
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "ops/investigation_operation_observer.py"


def module():
    spec = importlib.util.spec_from_file_location("operation_observer", PATH)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


ACTOR = "10000000-0000-4000-8000-000000000001"
OP = "20000000-0000-4000-8000-000000000001"
ITEM = "30000000-0000-4000-8000-000000000001"
DIGEST = "a" * 64


def committed():
    return {"status": "committed", "id": ITEM, "investigation_id": ITEM,
            "operation_id": OP, "author_ref": ACTOR, "manifest_digest": DIGEST,
            "revision": 1, "sequence": 1, "revision_id": "40000000-0000-4000-8000-000000000001",
            "parent_revision_id": None, "lifecycle": "active",
            "manifest": {"schema": "investigation_manifest.v2"},
            "committed_at": "2026-11-05T01:00:00+00:00", "recorded_at": "2026-11-05T01:00:00+00:00"}


def observe(data, **overrides):
    calls = []
    def rpc(name, args):
        calls.append((name, args))
        return {"data": data, "error": None}
    options = dict(principal=ACTOR, operation_id=OP, investigation_id=ITEM,
                   expected_manifest_digest=DIGEST, expected_revision=0, get_subject=lambda: ACTOR, rpc=rpc)
    options.update(overrides)
    return module().observe_original_operation(**options), calls


def test_recorded_fence_is_distinguished_from_read_miss():
    result, calls = observe({"status": "not_applied", "id": ITEM, "operation_id": OP})
    assert result["observation"] == "canonical_not_applied"
    assert result["observation_scope"] == "canonical_database_only"
    assert result["native_capture_outcome"] == "not_established"
    assert result["whole_request_settled"] is False
    assert result["cutover_qualified"] is False
    assert result["requires"] == "actual-schema-grants-and-receipt-immutability-qualification"
    assert calls == [("read_investigation_operation_v2", {"p_operation_id": OP})]


def test_commit_requires_native_operation_principal_and_original_digest():
    data = committed()
    result, _ = observe(data)
    assert result["observation"] == "recorded_commit" and not result["cutover_qualified"]
    for key in ["operation_id", "author_ref", "manifest_digest"]:
        changed = dict(data, **{key: "wrong"})
        assert observe(changed)[0]["observation"] == "unresolved"


def test_miss_pending_failure_and_label_alone_never_reconcile():
    for data in [None, {}, {"status": "not_found"}, {"status": "pending"},
                 {"status": "not_applied"}, {"status": "committed"},
                 {"status": "not_applied", "id": ITEM, "operation_id": OP, "reason": "limit_reached"}]:
        assert observe(data)[0]["observation"] == "unresolved"


def test_wrong_subject_and_operation_never_use_another_key():
    result, calls = observe({}, get_subject=lambda: "different")
    assert result["observation"] == "unresolved" and calls == []
    result, calls = observe({}, operation_id="")
    assert result["observation"] == "unresolved" and calls == []
    assert observe({"status": "not_applied", "id": ITEM, "operation_id": "wrong"})[0]["observation"] == "unresolved"


def test_account_change_during_read_preserves_unknown():
    subjects = iter([ACTOR, "different"])
    result, calls = observe({"status": "not_applied", "id": ITEM, "operation_id": OP}, get_subject=lambda: next(subjects))
    assert result["observation"] == "unresolved" and len(calls) == 1


def test_errors_do_not_leak_or_retry():
    calls = []
    def rpc(name, args):
        calls.append(name)
        raise RuntimeError("SECRET-CREDENTIAL")
    result, _ = observe({}, rpc=rpc)
    assert result["observation"] == "unresolved"
    assert "SECRET" not in str(result) and calls == ["read_investigation_operation_v2"]


def test_rpc_error_cannot_be_promoted_by_a_ready_field():
    result, _ = observe({}, rpc=lambda *_: {"data": {"ready": True}, "error": "SECRET"})
    assert result["observation"] == "unresolved" and "SECRET" not in str(result)


def test_no_manifest_or_raw_receipt_export():
    data = committed()
    data["manifest"]["secret"] = "PRIVATE-PLAN"
    result, _ = observe(data)
    assert result["observation"] == "recorded_commit"
    assert "PRIVATE" not in str(result) and "manifest" not in result


def test_partial_commit_missing_native_lineage_is_unknown():
    for key in ["revision_id", "sequence", "parent_revision_id", "recorded_at", "manifest"]:
        data = committed()
        del data[key]
        assert observe(data)[0]["observation"] == "unresolved"


def test_a_late_completion_after_miss_is_not_polled_or_inferred():
    replies = iter([{"status": "not_found"}, committed()])
    calls = []
    def rpc(name, args):
        calls.append((name, args))
        return {"data": next(replies), "error": None}
    result, _ = observe({}, rpc=rpc)
    assert result["observation"] == "unresolved" and len(calls) == 1
    assert next(replies)["status"] == "committed"


def test_first_revision_cannot_have_a_parent():
    data = committed()
    data["parent_revision_id"] = "50000000-0000-4000-8000-000000000001"
    assert observe(data)[0]["observation"] == "unresolved"


def test_later_revision_requires_a_parent():
    data = committed()
    data.update(revision=2, sequence=2)
    assert observe(data, expected_revision=1)[0]["observation"] == "unresolved"


def test_native_first_and_later_revision_parent_controls():
    assert observe(committed())[0]["observation"] == "recorded_commit"
    data = committed()
    data.update(revision=2, sequence=2,
                parent_revision_id="50000000-0000-4000-8000-000000000001")
    assert observe(data, expected_revision=1)[0]["observation"] == "recorded_commit"
