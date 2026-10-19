"""Queue ownership is earned from exact native identities, never a PR hint."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from scripts import migration_merge_group as group
from scripts.check_supabase_migration_namespace import collect_for_event

REPO = "example/terminal"
BASE, HEAD, SOURCE, TREE = (letter * 40 for letter in "abcd")
NAME = "0099_example.sql"
RAW = b"-- Ledger row: fixture\n-- Rollback: drop table if exists fixture;\ncreate table if not exists fixture(id int);\n"
ROW = {"state": "taken", "file": NAME, "packet": "test", "pr": 582,
       "pr_state": "open", "note": "fixture", "applied_in_production": False, "applied_date": None}


def fixture():
    env = {"GITHUB_EVENT_NAME": "merge_group", "GITHUB_REPOSITORY": REPO,
           "GITHUB_SHA": HEAD, "GITHUB_REF": "refs/heads/gh-readonly-queue/master/opaque"}
    event = {"action": "checks_requested", "repository": {"full_name": REPO},
             "merge_group": {"head_sha": HEAD, "base_sha": BASE,
                             "head_ref": env["GITHUB_REF"], "base_ref": "refs/heads/master"}}
    entry = {"id": "MQE-1", "position": 1, "baseCommit": {"oid": BASE},
             "headCommit": {"oid": HEAD, "tree": {"oid": TREE}, "parents": {"nodes": [{"oid": BASE}]}},
             "pullRequest": {"number": 582, "state": "OPEN", "baseRefName": "master", "headRefOid": SOURCE,
                             "baseRepository": {"nameWithOwner": REPO}, "headRepository": {"nameWithOwner": REPO},
                             "potentialMergeCommit": {"tree": {"oid": TREE}, "parents": {"nodes": [{"oid": BASE}, {"oid": SOURCE}]}}}}
    data = {"repository": {"nameWithOwner": REPO, "defaultBranchRef": {"name": "master", "target": {"oid": BASE}},
             "mergeQueue": {"configuration": {"mergeMethod": "SQUASH", "maximumEntriesToBuild": 1, "maximumEntriesToMerge": 1},
                            "entries": {"pageInfo": {"hasNextPage": False}, "nodes": [entry]}}}}
    return data, event, env


def set_path(obj, path, value):
    keys = path.split(".")
    for key in keys[:-1]:
        obj = obj[int(key)] if isinstance(obj, list) else obj[key]
    obj[int(keys[-1]) if isinstance(obj, list) else keys[-1]] = value


def test_exact_native_single_entry_is_qualified():
    data, event, env = fixture()
    env["PR_NUMBER"] = "9999"  # ignored, not an alternate source of ownership
    assert group.validate_snapshot(data, event, env, HEAD) == (582, SOURCE, BASE)


@pytest.mark.parametrize("path,value", [
    ("nameWithOwner", "foreign/repo"),
    ("defaultBranchRef.target.oid", "e" * 40),
    ("mergeQueue.configuration.mergeMethod", "MERGE"),
    ("mergeQueue.configuration.maximumEntriesToBuild", 4),
    ("mergeQueue.configuration.maximumEntriesToMerge", 2),
    ("mergeQueue.configuration.maximumEntriesToBuild", True),
    ("mergeQueue.entries.pageInfo.hasNextPage", True),
    ("mergeQueue.entries.nodes.0.position", 2),
    ("mergeQueue.entries.nodes.0.baseCommit.oid", "e" * 40),
    ("mergeQueue.entries.nodes.0.headCommit.oid", "e" * 40),
    ("mergeQueue.entries.nodes.0.headCommit.parents.nodes", []),
    ("mergeQueue.entries.nodes.0.pullRequest.number", True),
    ("mergeQueue.entries.nodes.0.pullRequest.state", "MERGED"),
    ("mergeQueue.entries.nodes.0.pullRequest.baseRefName", "other"),
    ("mergeQueue.entries.nodes.0.pullRequest.headRepository.nameWithOwner", "foreign/repo"),
    ("mergeQueue.entries.nodes.0.pullRequest.potentialMergeCommit", None),
    ("mergeQueue.entries.nodes.0.pullRequest.potentialMergeCommit.parents.nodes.1.oid", "e" * 40),
    ("mergeQueue.entries.nodes.0.pullRequest.potentialMergeCommit.tree.oid", "e" * 40),
])
def test_stale_foreign_multi_entry_or_unbound_snapshot_refuses(path, value):
    data, event, env = fixture()
    set_path(data["repository"], path, value)
    with pytest.raises(group.OwnershipUnqualified):
        group.validate_snapshot(data, event, env, HEAD)


@pytest.mark.parametrize("field,value", [("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_SHA", "e" * 40),
                                        ("GITHUB_REF", "refs/heads/other"), ("GITHUB_REPOSITORY", "foreign/repo")])
def test_environment_must_match_the_actual_event(field, value):
    data, event, env = fixture()
    env[field] = value
    with pytest.raises(group.OwnershipUnqualified):
        group.validate_snapshot(data, event, env, HEAD)


def test_wrong_checkout_and_duplicate_candidate_refuse():
    data, event, env = fixture()
    with pytest.raises(group.OwnershipUnqualified):
        group.validate_snapshot(data, event, env, "e" * 40)
    nodes = data["repository"]["mergeQueue"]["entries"]["nodes"]
    nodes.append(copy.deepcopy(nodes[0]))
    with pytest.raises(group.OwnershipUnqualified):
        group.validate_snapshot(data, event, env, HEAD)


def migration_fixture():
    doc = {"prefixes": {"0099": copy.deepcopy(ROW)}}
    source = {"ledger": {"__typename": "Blob", "text": json.dumps(doc)},
              "file0": {"__typename": "Blob", "oid": group.git_blob(RAW)}, "base0": None}
    return doc, source


def test_only_exact_new_owner_migration_bytes_qualify():
    doc, source = migration_fixture()
    group.validate_migrations(582, doc, {NAME: RAW}, source)


@pytest.mark.parametrize("change", ["owner", "ledger", "bytes", "base", "missing_base", "not_blob"])
def test_foreign_changed_inherited_or_missing_migration_proof_refuses(change):
    doc, source = migration_fixture()
    if change == "owner":
        doc["prefixes"]["0099"]["pr"] = 9999
    elif change == "ledger":
        source["ledger"]["text"] = '{"prefixes":{}}'
    elif change == "bytes":
        source["file0"]["oid"] = "e" * 40
    elif change == "base":
        source["base0"] = {"__typename": "Blob", "oid": group.git_blob(RAW)}
    elif change == "missing_base":
        del source["base0"]
    else:
        source["file0"]["__typename"] = "Tree"
    with pytest.raises(group.OwnershipUnqualified):
        group.validate_migrations(582, doc, {NAME: RAW}, source)


def repo_fixture(tmp_path):
    directory = tmp_path / "migrations"
    directory.mkdir()
    (directory / NAME).write_bytes(RAW)
    doc = {"header_required_from": "0015", "header_required_note": "test", "project_ref": "zzzzsyntheticref00000",
           "prefixes": {"0099": copy.deepcopy(ROW)}}
    ledger = tmp_path / "RESERVATIONS.json"
    ledger.write_text(json.dumps(doc))
    return directory, ledger


def test_actual_guard_uses_verified_owner_but_preserves_failed_and_force_strict_barriers(tmp_path, monkeypatch):
    directory, ledger = repo_fixture(tmp_path)
    env = {"GITHUB_EVENT_NAME": "merge_group", "PR_NUMBER": "9999"}
    monkeypatch.setattr(group, "qualify_owner", lambda *args: 582)
    findings, _, mode = collect_for_event(env, migrations_dir=directory, reservations=ledger)
    assert not any(f.code.startswith("OPEN_PR_STATE") for f in findings)
    assert "MERGE_GROUP_SINGLE_PR (#582" in mode
    findings, _, mode = collect_for_event(env, force_strict=True, migrations_dir=directory, reservations=ledger)
    assert any(f.code == "OPEN_PR_STATE_WITH_FILE_PRESENT" for f in findings)

    def unavailable(*args):
        raise group.OwnershipUnqualified("native membership unavailable")
    monkeypatch.setattr(group, "qualify_owner", unavailable)
    findings, _, mode = collect_for_event(env, migrations_dir=directory, reservations=ledger)
    assert {"MERGE_GROUP_OWNERSHIP_UNQUALIFIED", "OPEN_PR_STATE_WITH_FILE_PRESENT"} <= {f.code for f in findings}


def test_no_api_read_for_group_without_open_files_or_ordinary_pr(tmp_path, monkeypatch):
    directory, ledger = repo_fixture(tmp_path)
    def unexpected(*args):
        raise AssertionError("unexpected API read")
    monkeypatch.setattr(group, "qualify_owner", unexpected)
    collect_for_event({"GITHUB_EVENT_NAME": "pull_request", "PR_NUMBER": "582"}, migrations_dir=directory, reservations=ledger)
    doc = json.loads(ledger.read_text())
    doc["prefixes"]["0099"]["pr_state"] = "merged"
    ledger.write_text(json.dumps(doc))
    collect_for_event({"GITHUB_EVENT_NAME": "merge_group"}, migrations_dir=directory, reservations=ledger)


def test_missing_token_is_not_anonymous_or_alternate_authentication():
    with pytest.raises(group.OwnershipUnqualified, match="token is unavailable"):
        group.graphql_reader("")


def test_native_reader_pins_source_queries_and_never_uses_pr_hint(tmp_path, monkeypatch):
    data, event, env = fixture()
    doc, source = migration_fixture()
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(event))
    env.update(GITHUB_EVENT_PATH=str(event_path), GH_TOKEN="synthetic-token", PR_NUMBER="9999")
    calls = []
    def read(query, variables):
        calls.append((query, variables))
        return data if len(calls) == 1 else {"repository": source}
    monkeypatch.setattr(group, "graphql_reader", lambda token: read)
    monkeypatch.setattr(group.subprocess, "check_output", lambda *args, **kwargs: HEAD + "\n")
    assert group.qualify_owner(tmp_path, env, doc, {NAME: RAW}) == 582
    assert len(calls) == 2
    assert calls[0][1] == {"owner": "example", "name": "terminal"}
    expressions = calls[1][1]
    assert expressions["ledger"] == SOURCE + ":supabase/migrations/RESERVATIONS.json"
    assert expressions["file0"] == SOURCE + ":supabase/migrations/" + NAME
    assert expressions["base0"] == BASE + ":supabase/migrations/" + NAME
    assert "9999" not in str(calls) and "synthetic-token" not in str(calls)


def test_api_failure_keeps_credentials_out_of_guard_error(monkeypatch):
    def failure(*args, **kwargs):
        raise RuntimeError("sensitive synthetic-token request details")
    monkeypatch.setattr(group.urllib.request, "urlopen", failure)
    with pytest.raises(group.OwnershipUnqualified) as result:
        group.graphql_reader("synthetic-token")("query {}", {})
    assert str(result.value) == "GitHub ownership read failed"
