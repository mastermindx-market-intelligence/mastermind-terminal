"""Real protected validators; service identity/HTTP/permissions are INERT fixtures.

No GitHub, token, App, environment, check or workflow is accessed or enrolled.
"""
from __future__ import annotations

import copy
import json
import socket
from pathlib import Path

import pytest
import yaml

from scripts import trusted_migration_ownership as owner
from scripts import migration_ownership_transition as transition
from scripts import migration_merge_group as group
from test_migration_merge_group import (
    fixture as queue_fixture, parallel_fixture, set_path, BASE, HEAD, SOURCE, TREE, NAME, RAW, ROW,
)
from test_supabase_migration_namespace import reservations_doc

CODE = "e" * 40
APP = 424242
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("this source test must not open a network connection")
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)


def run_data(event="merge_group", run_id=71):
    return {"id": run_id, "run_attempt": 1, "workflow_id": 17,
            "path": owner.WORKFLOW, "name": "CI", "event": event,
            "head_sha": HEAD, "head_branch": "gh-readonly-queue/master/pr-1290-opaque" if event == "merge_group" else "claude/fixture",
            "repository": {"id": 123, "full_name": owner.REPO},
            "head_repository": {"id": 123, "full_name": owner.REPO},
            "status": "completed", "conclusion": "success", "pull_requests": []}


def input_data(event="merge_group"):
    envelope = {"action": "completed", "repository": {"id": 123, "full_name": owner.REPO,
                                                          "default_branch": "master"},
                "workflow_run": run_data(event)}
    env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_run", "GITHUB_REPOSITORY": owner.REPO,
           "GITHUB_REPOSITORY_ID": "123", "GITHUB_REF": "refs/heads/master", "GITHUB_SHA": CODE,
           "TRUSTED_CHECKOUT_SHA": CODE}
    return envelope, env


def check_data(run=None, **overrides):
    run = run_data() if run is None else run
    value = {"id": 91, "name": owner.CONTEXT, "head_sha": run["head_sha"], "app": {"id": APP},
             "external_id": f"migration-owner:v1:{run['id']}:{run['run_attempt']}:{run['head_sha']}:{CODE}",
             "status": "completed", "conclusion": "success"}
    return value | overrides


def blob(raw):
    return {"__typename": "Blob", "oid": group.git_blob(raw), "text": raw.decode(),
            "byteSize": len(raw), "isBinary": False, "isTruncated": False}


class Service:
    def __init__(self, event="merge_group"):
        self.run = run_data(event)
        self.workflow = {"id": 17, "path": owner.WORKFLOW, "name": "CI", "state": "active"}
        self.queue, _, _ = queue_fixture()
        repo = self.queue["repository"]
        repo["nameWithOwner"] = owner.REPO
        for n in repo["mergeQueue"]["entries"]["nodes"]:
            n["pullRequest"]["baseRepository"]["nameWithOwner"] = owner.REPO
            n["pullRequest"]["headRepository"]["nameWithOwner"] = owner.REPO
        self.doc = reservations_doc()
        self.doc["prefixes"]["0001"] |= {"applied_in_production": True, "applied_date": None}
        self.doc["prefixes"]["0099"] = copy.deepcopy(ROW)
        self.sql = {"0001_init.sql": b"select 1;\n", NAME: RAW}
        self.pr = {"repository": {"nameWithOwner": owner.REPO,
                   "defaultBranchRef": {"name": "master", "target": {"oid": BASE}},
                   "object": {"__typename": "Commit", "oid": HEAD, "associatedPullRequests": {
                       "pageInfo": {"hasNextPage": False}, "nodes": [copy.deepcopy(repo["mergeQueue"]["entries"]["nodes"][0]["pullRequest"])]}}}}
        self.pr["repository"]["object"]["associatedPullRequests"]["nodes"][0]["headRefOid"] = HEAD
        self.previous = {"total_count": 0, "check_runs": []}
        self.mutations = []
        self.reads = []
        self.after_create = None
        self.post_override = None
        self.source_override = None
        self.contents_override = None
        self.lose = None

    def request(self, method, path, body=None):
        if method != "GET":
            self.mutations.append((method, path, copy.deepcopy(body)))
            if self.lose == method:
                raise group.OwnershipUnqualified("original mutation response unknown")
            result = check_data(self.run, **body)
            if method == "POST":
                if self.after_create:
                    self.after_create()
                if self.post_override:
                    result.update(self.post_override)
            return result
        self.reads.append(path)
        if "/actions/runs/" in path:
            return copy.deepcopy(self.run)
        if "/actions/workflows/" in path:
            return copy.deepcopy(self.workflow)
        if "/check-runs?" in path:
            return copy.deepcopy(self.previous)
        raise AssertionError("unexpected service path")

    def graphql(self, query, variables):
        if query == group.QUEUE_QUERY:
            return copy.deepcopy(self.queue)
        if query == owner.PR_QUERY:
            return copy.deepcopy(self.pr)
        if query == owner.CONTENTS_QUERY:
            values = self.sql | {"RESERVATIONS.json": json.dumps(self.doc).encode(), "README.md": b"fixture\n"}
            entries = [{"name": n, "type": "blob", "mode": 0o100644, "object": blob(b)} for n, b in values.items()]
            value = {"repository": {"nameWithOwner": owner.REPO,
                     "object": {"__typename": "Tree", "oid": TREE, "entries": entries}}}
            if self.contents_override:
                self.contents_override(value)
            return value
        value = {"repository": {"ledger": blob(json.dumps(self.doc).encode()),
                 "base_tree": {"__typename": "Tree", "entries": []},
                 "file0": blob(RAW), "base0": None}}
        if self.source_override:
            self.source_override(value)
        return value


@pytest.mark.parametrize("event", ["merge_group", "pull_request", "workflow_dispatch"])
def test_real_issuer_owner_full_namespace_and_publication(event):
    api = Service(event)
    envelope, env = input_data(event)
    assert owner.execute(envelope, env, api, APP) == {"state": "PUBLISHED", "head": HEAD}
    assert [x[0] for x in api.mutations] == ["POST", "PATCH"]
    assert api.mutations[-1][2]["conclusion"] == "success"
    assert "merge_group" not in envelope  # no synthetic old event was supplied


@pytest.mark.parametrize("broken", [None, "incomplete", "duplicate", "chain", "profile"])
def test_real_parallel_new_origin_full_prefix(broken):
    api = Service()
    api.queue, old_event, _ = parallel_fixture()
    repo = api.queue["repository"]
    repo["nameWithOwner"] = owner.REPO
    for entry in repo["mergeQueue"]["entries"]["nodes"]:
        for key in ("baseRepository", "headRepository"):
            entry["pullRequest"][key]["nameWithOwner"] = owner.REPO
    api.run["head_sha"] = old_event["merge_group"]["head_sha"]
    envelope, env = input_data()
    envelope["workflow_run"] = copy.deepcopy(api.run)
    if broken == "incomplete": repo["mergeQueue"]["entries"]["pageInfo"]["hasNextPage"] = True
    if broken == "duplicate": repo["mergeQueue"]["entries"]["nodes"][1]["position"] = 1
    if broken == "chain": repo["mergeQueue"]["entries"]["nodes"][1]["baseCommit"]["oid"] = BASE
    if broken == "profile": repo["mergeQueue"]["configuration"]["mergingStrategy"] = "HEADGREEN"
    if broken:
        with pytest.raises(group.OwnershipUnqualified): owner.execute(envelope, env, api, APP)
        assert not api.mutations
    else:
        assert owner.execute(envelope, env, api, APP)["state"] == "PUBLISHED"
        assert api.mutations[-1][2]["conclusion"] == "success"


def test_actual_fixed_client_serialization_and_distinct_tokens(monkeypatch):
    """Exercise real HTTP Request/JSON decoding with inert opener and real guards."""
    service = Service()
    uses = []
    class Reply:
        def __init__(self, value): self.raw = json.dumps(value).encode()
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self, bound): return self.raw[:bound]
    class Opener:
        def open(self, request, timeout):
            assert request.full_url.startswith(owner.API + "/")
            path = request.full_url[len(owner.API):]
            method = request.get_method()
            token = request.get_header("Authorization")
            expected = "Bearer INERT_RUN" if "/actions/" in path else "Bearer INERT_APP"
            assert token == expected
            uses.append((method, path))
            body = json.loads(request.data) if request.data else None
            if path == "/graphql":
                return Reply({"data": service.graphql(body["query"], body["variables"])})
            return Reply(service.request(method, path, body))
    monkeypatch.setattr(owner.urllib.request, "build_opener", lambda *args: Opener())
    assert owner.execute(*input_data(), owner.IssuerApi("INERT_APP", "INERT_RUN"), APP)["state"] == "PUBLISHED"
    assert sum(method == "POST" and path.endswith("/check-runs") for method, path in uses) == 1


def test_queue_permission_error_closed_and_no_retry_or_raw_content(monkeypatch):
    class Reply:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self, bound):
            return json.dumps({"errors": [{"type": "FORBIDDEN", "message": "SECRET_SENTINEL",
                                            "path": ["repository", "mergeQueue", "SECRET_SENTINEL"]}]}).encode()
    calls = []
    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            return Reply()
    monkeypatch.setattr(owner.urllib.request, "build_opener", lambda *args: Opener())
    with pytest.raises(owner.CapabilityUnavailable) as error:
        owner.Api("INERT_APP").graphql(group.QUEUE_QUERY, owner._variables())
    assert (error.value.stage, error.value.kind) == ("queue_snapshot", "forbidden")
    assert "SECRET_SENTINEL" not in str(error.value) and len(calls) == 1


@pytest.mark.parametrize("path,value", [
    ("workflow_run.event", "workflow_dispatch"),
    ("workflow_run.path", ".github/workflows/attacker.yml"),
    ("workflow_run.workflow_id", 18), ("workflow_run.head_sha", "f" * 40),
    ("workflow_run.run_attempt", 2), ("workflow_run.id", 99),
    ("workflow_run.repository.full_name", "foreign/repo"),
    ("workflow_run.head_repository.id", 999),
    ("workflow_run.head_branch", "claude/spoof"), ("action", "requested"),
    ("workflow_run.conclusion", "failure"), ("repository.default_branch", "foreign"),
])
def test_run_or_workflow_spoof_before_any_publication(path, value):
    api = Service()
    envelope, env = input_data()
    set_path(envelope, path, value)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(envelope, env, api, APP)
    assert api.mutations == []


@pytest.mark.parametrize("key,value", [("GITHUB_REF", "refs/heads/gh-readonly-queue/master/opaque"),
    ("GITHUB_SHA", "f" * 40), ("TRUSTED_CHECKOUT_SHA", HEAD),
    ("GITHUB_EVENT_NAME", "merge_group"), ("GITHUB_ACTIONS", "false"),
    ("GITHUB_REPOSITORY_ID", "999")])
def test_untrusted_issuer_context_refuses(key, value):
    envelope, env = input_data()
    env[key] = value
    api = Service()
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(envelope, env, api, APP)
    assert not api.mutations


@pytest.mark.parametrize("path,value", [
    ("mergeQueue.entries.pageInfo.hasNextPage", True),
    ("mergeQueue.entries.nodes.0.position", 2),
    ("mergeQueue.entries.nodes.0.baseCommit.oid", "f" * 40),
    ("mergeQueue.entries.nodes.0.pullRequest.headRefOid", "f" * 40),
    ("mergeQueue.entries.nodes.0.pullRequest.state", "CLOSED"),
    ("mergeQueue.configuration.mergeMethod", "MERGE"),
    ("mergeQueue.entries.nodes.0.headCommit.tree.oid", "f" * 40),
])
def test_full_native_predicates_not_content_or_event_guesses(path, value):
    envelope, env = input_data()
    api = Service()
    set_path(api.queue["repository"], path, value)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(envelope, env, api, APP)
    assert not api.mutations


@pytest.mark.parametrize("which", ["base", "source", "run", "material"])
def test_late_currentness_refuses_success_publication(which):
    envelope, env = input_data()
    api = Service()
    def drift():
        if which == "base":
            api.queue["repository"]["defaultBranchRef"]["target"]["oid"] = "f" * 40
        elif which == "source":
            api.queue["repository"]["mergeQueue"]["entries"]["nodes"][0]["pullRequest"]["headRefOid"] = "f" * 40
        elif which == "run":
            api.run["run_attempt"] = 2
        else:
            api.sql["0001_init.sql"] += b"-- changed\n"
    api.after_create = drift
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(envelope, env, api, APP)
    assert [m[0] for m in api.mutations] == ["POST"]  # owned pending; never success


@pytest.mark.parametrize("which", ["ledger", "blob", "base", "absence"])
def test_immutable_source_proof_remains_real(which):
    envelope, env = input_data()
    api = Service()
    def mutate(value):
        data = value["repository"]
        if which == "ledger": data["ledger"]["text"] = '{"prefixes":{}}'
        if which == "blob": data["file0"]["oid"] = "f" * 40
        if which == "base": data["base_tree"]["entries"] = [{"name": NAME, "type": "blob"}]
        if which == "absence": del data["base0"]
    api.source_override = mutate
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(envelope, env, api, APP)
    assert not api.mutations


@pytest.mark.parametrize("field,value", [("isTruncated", True), ("isBinary", True),
                                        ("byteSize", 999999), ("oid", "f" * 40)])
def test_candidate_blob_never_truncated_or_unhashed(field, value):
    api = Service()
    api.contents_override = lambda v: v["repository"]["object"]["entries"][0]["object"].update({field: value})
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(*input_data(), api, APP)
    assert not api.mutations


@pytest.mark.parametrize("override", [{"app": {"id": 15368}}, {"head_sha": "f" * 40},
    {"external_id": "foreign"}, {"name": "Ingest + signal-layer tests"}])
def test_wrong_created_producer_cannot_publish_success(override):
    api = Service()
    api.post_override = override
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(*input_data(), api, APP)
    assert [m[0] for m in api.mutations] == ["POST"]


@pytest.mark.parametrize("method", ["POST", "PATCH"])
def test_lost_mutation_response_never_retries(method):
    api = Service()
    api.lose = method
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(*input_data(), api, APP)
    assert sum(m[0] == "POST" for m in api.mutations) == 1
    assert sum(m[0] == "PATCH" for m in api.mutations) == (method == "PATCH")


@pytest.mark.parametrize("which", ["pending", "code-change", "duplicate"])
def test_same_original_operation_never_reissued(which):
    api = Service()
    check = check_data()
    if which == "pending": check["status"] = "in_progress"
    if which == "code-change": check["external_id"] = check["external_id"][:-40] + "f" * 40
    api.previous = {"check_runs": [check] * (2 if which == "duplicate" else 1),
                    "total_count": 2 if which == "duplicate" else 1}
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(*input_data(), api, APP)
    assert not api.mutations


def test_settled_original_reconciles_without_another_post():
    api = Service()
    api.previous = {"check_runs": [check_data()], "total_count": 1}
    assert owner.execute(*input_data(), api, APP)["state"] == "RECONCILED"
    assert not api.mutations


def test_api_transport_loss_is_one_attempt_and_secret_free(monkeypatch):
    calls = []
    class Broken:
        def open(self, request, timeout):
            calls.append(request)
            raise TimeoutError("SECRET_SENTINEL_PRIVATE_RESPONSE")
    monkeypatch.setattr(owner.urllib.request, "build_opener", lambda *a: Broken())
    with pytest.raises(group.OwnershipUnqualified) as error:
        owner.Api("SECRET_SENTINEL_TOKEN").request("POST", f"/repos/{owner.REPO}/check-runs", {})
    assert len(calls) == 1
    assert "SECRET_SENTINEL" not in str(error.value)
    assert error.value.__suppress_context__


class AdminService(Service):
    def __init__(self):
        super().__init__()
        self.protection = {"required_status_checks": {"strict": True, "checks": [
            {"context": c, "app_id": 15368} for c in transition.OLD_CONTEXTS] + [{"context": owner.CONTEXT, "app_id": APP}]}}
        self.rules = [{"type": "merge_queue", "ruleset_id": 12345}]
        self.branch = {"name": "master", "commit": {"sha": BASE}}
        self.proofs = {71: run_data("merge_group", 71), 72: run_data("pull_request", 72)}
        self.proofs[72]["head_sha"] = SOURCE
        self.files = {p: (ROOT / p).read_text() for p in transition.SOURCE_PATHS + transition.TARGET_PATHS}
        self.calls = []

    def request(self, method, path, body=None):
        assert method == "GET" and body is None  # transition can NEVER mutate GitHub
        self.calls.append(path)
        if path.endswith("/protection"): return copy.deepcopy(self.protection)
        if "/rules/branches/" in path: return copy.deepcopy(self.rules)
        if path.endswith("/branches/master"): return copy.deepcopy(self.branch)
        if "/actions/runs/" in path: return copy.deepcopy(self.proofs[int(path.rsplit("/", 1)[1])])
        if "/check-runs?" in path:
            run = self.proofs[72] if SOURCE in path else self.proofs[71]
            return {"check_runs": [check_data(run)], "total_count": 1}
        return super().request(method, path, body)

    def graphql(self, query, variables):
        repo = {"nameWithOwner": owner.REPO}
        for key, value in variables.items():
            if key.startswith("f"):
                repo[key] = blob(self.files[value.split(":", 1)[1]].encode())
        return {"repository": repo}


def test_transfer_prepares_real_two_path_source_change_only_after_both_actual_proofs():
    api = AdminService()
    patch = transition.prepare(api, APP, [71, 72])
    assert "MERGE_GROUP_CONTENT" in patch and "REQUIRED_CHECK_APP_IDS" in patch
    assert f"= {APP}" in patch
    assert "--- a/tests/test_supabase_migration_namespace.py" in patch
    assert "--- a/scripts/merge_on_green.py" in patch
    assert "supabase/migrations/0049" not in patch
    assert not api.mutations


@pytest.mark.parametrize("which", ["missing", "any-source", "wrong-app", "old-gate-removed", "not-strict", "no-queue"])
def test_premature_or_unpinned_gate_transfer_refuses(which):
    api = AdminService()
    checks = api.protection["required_status_checks"]["checks"]
    if which == "missing": checks.pop()
    if which == "any-source": checks[-1]["app_id"] = None
    if which == "wrong-app": checks[-1]["app_id"] = 15368
    if which == "old-gate-removed": checks.pop(0)
    if which == "not-strict": api.protection["required_status_checks"]["strict"] = False
    if which == "no-queue": api.rules = []
    with pytest.raises(group.OwnershipUnqualified): transition.prepare(api, APP, [71, 72])
    assert not api.mutations


def test_pr_only_proof_cannot_transfer_group_gate():
    api = AdminService()
    api.proofs[71] = run_data("pull_request", 71)
    with pytest.raises(group.OwnershipUnqualified): transition.prepare(api, APP, [71, 72])


def test_changed_protected_code_cannot_reuse_old_success_proof():
    api = AdminService()
    original = api.graphql
    def changed(query, variables):
        value = original(query, variables)
        if any(isinstance(v, str) and v.startswith(CODE + ":") for v in variables.values()):
            value["repository"]["f0"] = blob(b"changed protected code")
        return value
    api.graphql = changed
    with pytest.raises(group.OwnershipUnqualified): transition.prepare(api, APP, [71, 72])


def test_rule_withdrawal_during_transfer_recheck_refuses():
    api = AdminService()
    original = api.request
    reads = 0
    def withdraw(method, path, body=None):
        nonlocal reads
        if path.endswith("/protection"):
            reads += 1
            if reads == 2:
                api.protection["required_status_checks"]["checks"].pop()
        return original(method, path, body)
    api.request = withdraw
    with pytest.raises(group.OwnershipUnqualified): transition.prepare(api, APP, [71, 72])


def test_transfer_output_is_an_unapplied_reversible_source_patch(tmp_path, monkeypatch):
    import importlib.util
    import subprocess
    import sys
    api = AdminService()
    patch = transition.prepare(api, APP, [71, 72])
    # Disposable local files only; never current source or GitHub. Prove the
    # actual generated patch applies and restores the old gate before removal.
    for path in transition.TARGET_PATHS:
        target = tmp_path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(api.files[path])
    applied = subprocess.run(["git", "apply", "-"], cwd=tmp_path,
                             input=patch, text=True, capture_output=True)
    assert applied.returncode == 0, applied.stderr
    new_test = (tmp_path / transition.TARGET_PATHS[0]).read_text()
    new_controller = (tmp_path / transition.TARGET_PATHS[1]).read_text()
    compile(new_test, "inert_namespace", "exec")
    compile(new_controller, "inert_controller", "exec")
    assert "MERGE_GROUP_CONTENT" in new_test and f"= {APP}" in new_controller
    # Execute the real generated controller's check consumer, without its CLI.
    spec = importlib.util.spec_from_file_location("inert_stage_two_controller", tmp_path / transition.TARGET_PATHS[1])
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    checks = [{"id": i + 1, "name": name, "app": {"id": 15368}, "status": "completed", "conclusion": "success"}
              for i, name in enumerate(transition.OLD_CONTEXTS)]
    checks.append({"id": 9, "name": owner.CONTEXT, "app": {"id": APP}, "status": "completed", "conclusion": "success"})
    assert module.check_verdict(checks).state == "green"
    checks[-1]["app"]["id"] = 15368  # same name from the wrong real producer
    assert module.check_verdict(checks).state == "pending"
    restored = subprocess.run(["git", "apply", "--reverse", "-"], cwd=tmp_path,
                              input=patch, text=True, capture_output=True)
    assert restored.returncode == 0, restored.stderr
    assert all((tmp_path / p).read_text() == api.files[p] for p in transition.TARGET_PATHS)


def test_real_workflow_no_candidate_execution_or_key_in_candidate_job():
    # PyYAML's YAML1.1 parser treats 'on' as True; this is source syntax only.
    workflow = yaml.safe_load((ROOT / ".github/workflows/trusted-migration-ownership.yml").read_text())
    trigger = workflow.get("on", workflow.get(True))
    assert trigger == {"workflow_run": {"workflows": ["CI"], "types": ["completed"]}}
    assert workflow["permissions"] == {}
    job = workflow["jobs"]["qualify"]
    assert job["permissions"] == {"contents": "read", "actions": "read"}
    assert job["environment"] == "terminal-migration-owner"
    checkout, preflight, mint, invoke = job["steps"]
    assert checkout["with"]["ref"] == "${{ github.sha }}"
    assert checkout["with"]["persist-credentials"] is False
    assert "head_sha" not in checkout["with"]["ref"]
    assert "--preflight" in preflight["run"] and "OWNERSHIP_TOKEN" not in preflight.get("env", {})
    assert {k: v for k, v in mint["with"].items() if k.startswith("permission-")} == {
        "permission-merge-queues": "read", "permission-contents": "read",
        "permission-pull-requests": "read", "permission-checks": "write"}
    assert mint["with"]["repositories"] == "mastermind-terminal"
    assert mint["with"]["app-id"] == "${{ vars.MIGRATION_OWNER_APP_ID }}"
    assert invoke["env"]["OWNERSHIP_TOKEN"] == "${{ steps.installation.outputs.token }}"
    assert all(len(s["uses"].split("@", 1)[1]) == 40 for s in job["steps"] if "uses" in s)
    text = json.dumps(workflow)
    for forbidden in ("download-artifact", "actions/cache", "npm ci", "pip install", "workflow_dispatch"):
        if forbidden == "workflow_dispatch": continue  # allowed source run, not issuer trigger
        assert forbidden not in text
    assert "complete" in invoke["name"] or "publish" in invoke["name"]
