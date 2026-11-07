"""Inert API responses exercise the real ownership entry and fixed diagnostics."""
import io
import json
import traceback
import urllib.error

import pytest

from scripts import migration_merge_group as group
import test_migration_merge_group as original


CANARY = "inert-ownership-private-canary-7782"


def owner_inputs(tmp_path, monkeypatch, parallel=False):
    if parallel:
        data, event, env = original.parallel_fixture()
        _, doc, files, source_read, _ = original.parallel_migration_fixture()
        expected = frozenset({582, 583})
    else:
        data, event, env = original.fixture()
        doc, source = original.migration_fixture()
        files, expected = {original.NAME: original.RAW}, 582
        source_read = lambda query, variables: {"repository": source}
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(event))
    env.update(GITHUB_EVENT_PATH=str(event_path), GH_TOKEN=CANARY)
    monkeypatch.setattr(group.subprocess, "check_output",
                        lambda *args, **kwargs: env["GITHUB_SHA"] + "\n")
    return data, env, doc, files, source_read, expected


@pytest.mark.parametrize("parallel", [False, True])
@pytest.mark.parametrize("stage", ["queue_snapshot", "immutable_source"])
def test_owner_entry_reports_fixed_stage_without_payload(tmp_path, monkeypatch, capsys, parallel, stage):
    data, env, doc, files, _, _ = owner_inputs(tmp_path, monkeypatch, parallel)
    calls = []

    def urlopen(request, **kwargs):
        calls.append(request)
        payload = {"data": data} if stage == "immutable_source" and len(calls) == 1 else {
            "errors": [{"type": "FORBIDDEN", "message": CANARY,
                        "path": ["repository", "mergeQueue" if stage == "queue_snapshot" else "ledger"]}],
            "data": {"repository": None},
        }
        return io.StringIO(json.dumps(payload))

    monkeypatch.setattr(group.urllib.request, "urlopen", urlopen)
    with pytest.raises(group.OwnershipUnqualified) as caught:
        group.qualify_owner(tmp_path, env, doc, files)
    message = str(caught.value)
    assert "stage=" + stage in message
    assert "kind=forbidden" in message
    assert len(calls) == (1 if stage == "queue_snapshot" else 2)
    rendered = "".join(traceback.format_exception(caught.value))
    captured = capsys.readouterr()
    if CANARY in message + rendered + captured.out + captured.err:
        raise AssertionError("ownership diagnostic exposed private response material")
    assert len(message.encode()) < 256


@pytest.mark.parametrize("parallel", [False, True])
@pytest.mark.parametrize("invalid", [False, True])
def test_real_owner_success_and_original_proof_refusal(tmp_path, monkeypatch, parallel, invalid):
    data, env, doc, files, source_read, expected = owner_inputs(tmp_path, monkeypatch, parallel)
    if invalid:
        data["repository"]["mergeQueue"]["entries"]["nodes"][0]["headCommit"]["parents"]["nodes"] = []
    calls = []

    def urlopen(request, **kwargs):
        body = json.loads(request.data)
        calls.append(body)
        result = data if len(calls) == 1 else source_read(body["query"], body["variables"])
        return io.StringIO(json.dumps({"data": result}))

    monkeypatch.setattr(group.urllib.request, "urlopen", urlopen)
    if invalid:
        with pytest.raises(group.OwnershipUnqualified, match="single-parent squash") as caught:
            group.qualify_owner(tmp_path, env, doc, files)
        assert "stage=" not in str(caught.value)
        assert len(calls) == 1
    else:
        assert group.qualify_owner(tmp_path, env, doc, files) == expected
        assert len(calls) == (3 if parallel else 2)


@pytest.mark.parametrize("payload,kind,scope", [
    ({"errors": [{"type": "FORBIDDEN", "path": ["repository", "mergeQueue"], "message": CANARY}]}, "forbidden", "queue"),
    ({"errors": [{"extensions": {"code": "RATE_LIMITED"}, "path": ["repository", "file0"]}]}, "rate_limited", "source"),
    ({"errors": [{"type": "UNAUTHORIZED"}]}, "unauthorized", "other"),
    ({"errors": [{"type": "NOT_FOUND"}]}, "not_found", "other"),
    ({"errors": [{"extensions": {"code": "GRAPHQL_VALIDATION_FAILED"}}]}, "validation", "other"),
    ({"errors": [{"type": CANARY, "path": [CANARY], "extensions": {"code": CANARY}}]}, "graphql_error", "other"),
    ({"errors": [{"type": "FORBIDDEN"}, {"type": "RATE_LIMITED"}]}, "mixed_errors", "other"),
    ({"errors": CANARY}, "malformed_errors", "other"),
    ({"errors": [CANARY]}, "malformed_errors", "other"),
    ({"errors": [{"message": CANARY}] * 9}, "graphql_error", "other"),
    ({"errors": [{"type": "FORBIDDEN", "path": ["repository", "mergeQueue"]},
                 {"type": "FORBIDDEN", "path": ["repository", "ledger"]}]}, "forbidden", "other"),
    ({"data": CANARY}, "response_shape", "other"),
    ([CANARY], "response_shape", "other"),
])
def test_closed_response_classification(monkeypatch, capsys, payload, kind, scope):
    monkeypatch.setattr(group.urllib.request, "urlopen", lambda *args, **kwargs: io.StringIO(json.dumps(payload)))
    with pytest.raises(group.OwnershipUnqualified) as caught:
        group._read_at_stage(group.graphql_reader(CANARY), "queue_snapshot", "query {}", {})
    message = str(caught.value)
    assert "kind=" + kind in message and "scope=" + scope in message
    captured = capsys.readouterr()
    if CANARY in message + captured.out + captured.err:
        raise AssertionError("ownership diagnostic exposed private response material")
    assert len(message.encode()) < 256


@pytest.mark.parametrize("failure,kind", [
    (RuntimeError(CANARY), "transport"),
    (json.JSONDecodeError(CANARY, CANARY, 0), "json_decode"),
    (urllib.error.HTTPError("https://example.invalid/" + CANARY, 401, CANARY, {}, None), "http_unauthorized"),
    (urllib.error.HTTPError("https://example.invalid/" + CANARY, 403, CANARY, {}, None), "http_forbidden"),
    (urllib.error.HTTPError("https://example.invalid/" + CANARY, 429, CANARY, {}, None), "http_rate_limited"),
    (urllib.error.HTTPError("https://example.invalid/" + CANARY, 599, CANARY, {}, None), "http_other"),
])
def test_exception_projection_never_formats_original(monkeypatch, capsys, failure, kind):
    def urlopen(*args, **kwargs):
        raise failure
    monkeypatch.setattr(group.urllib.request, "urlopen", urlopen)
    with pytest.raises(group.OwnershipUnqualified) as caught:
        group._read_at_stage(group.graphql_reader(CANARY), "immutable_source", "query {}", {})
    assert "kind=" + kind in str(caught.value)
    captured = capsys.readouterr()
    rendered = "".join(traceback.format_exception(caught.value))
    if CANARY in rendered + captured.out + captured.err:
        raise AssertionError("ownership diagnostic exposed private exception material")


def test_invalid_stage_refuses_before_read():
    def no_read(*args):
        raise AssertionError("invalid stage reached reader")
    with pytest.raises(group.OwnershipUnqualified, match="diagnostic stage invalid"):
        group._read_at_stage(no_read, CANARY, "query {}", {})


def test_actual_namespace_guard_retains_strict_barrier_and_safe_diagnostic(tmp_path, monkeypatch):
    _, env, _, _, _, _ = owner_inputs(tmp_path, monkeypatch)
    directory, ledger = original.repo_fixture(tmp_path)
    payload = {"errors": [{"type": "FORBIDDEN", "message": CANARY,
                           "path": ["repository", "mergeQueue"]}]}
    monkeypatch.setattr(group.urllib.request, "urlopen",
                        lambda *args, **kwargs: io.StringIO(json.dumps(payload)))
    findings, _, mode = original.collect_for_event(env, migrations_dir=directory, reservations=ledger)
    assert "STRICT" in mode
    assert {"MERGE_GROUP_OWNERSHIP_UNQUALIFIED", "OPEN_PR_STATE_WITH_FILE_PRESENT"} <= {f.code for f in findings}
    detail = next(f.detail for f in findings if f.code == "MERGE_GROUP_OWNERSHIP_UNQUALIFIED")
    assert "stage=queue_snapshot; kind=forbidden; scope=queue" in detail
    if CANARY in str(findings):
        raise AssertionError("namespace finding exposed private response material")


@pytest.mark.parametrize("errors", [None, [], {}, "", False, 0])
def test_original_success_predicate_is_preserved(monkeypatch, errors):
    payload = {"data": {"exact": [1, 2]}, "errors": errors}
    monkeypatch.setattr(group.urllib.request, "urlopen", lambda *args, **kwargs: io.StringIO(json.dumps(payload)))
    assert group._read_at_stage(group.graphql_reader(CANARY), "queue_snapshot", "query {}", {}) == payload["data"]
