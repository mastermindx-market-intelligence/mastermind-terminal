"""Recovery entry of the protected migration ownership publisher.

Real protected validators; service identity/HTTP/permissions are INERT fixtures.
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
from scripts import migration_merge_group as group
from test_migration_merge_group import (
    parallel_fixture, set_path, BASE, HEAD, NAME, RAW, ROW, SECOND_HEAD,
)
from test_supabase_migration_namespace import reservations_doc
from test_trusted_migration_ownership import Service, check_data, blob, APP, ROOT

PIN = "9" * 40
ANCHOR = "8" * 40
ACTOR = "recovery-admin"
OTHER_PIN = "7" * 40
RECOVERY_RUN = 85
PRIOR_RECOVERY_RUN = 86


def recovery_event(**sender):
    return {"repository": {"id": 123, "full_name": owner.REPO, "default_branch": "master"},
            "sender": sender or {"login": ACTOR, "type": "User"}}


def recovery_env(**overrides):
    env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
           "GITHUB_REPOSITORY": owner.REPO, "GITHUB_REPOSITORY_ID": "123",
           "GITHUB_REF": "refs/heads/master", "GITHUB_SHA": ANCHOR,
           "TRUSTED_CHECKOUT_SHA": PIN,
           "GITHUB_RUN_ID": str(RECOVERY_RUN), "GITHUB_RUN_ATTEMPT": "1",
           "RECOVERY_ISSUER_REVISION": PIN, "RECOVERY_TARGET_RUN": "71"}
    return env | overrides


class RecoveryService(Service):
    """Inert service with the additional recovery reads (compare, actor,
    live-issuer scan, validator identity, prior recovery issuers)."""

    def __init__(self, event="merge_group"):
        super().__init__(event)
        self.run.update(status="completed", conclusion="success")
        self.recovery = {"id": RECOVERY_RUN, "run_attempt": 1, "workflow_id": 19,
                         "path": owner.RECOVERY_ISSUER_WORKFLOW,
                         "name": owner.RECOVERY_ISSUER_NAME, "event": "workflow_dispatch",
                         "head_branch": "master", "head_sha": ANCHOR, "status": "in_progress",
                         "display_title": f"Migration owner recovery {self.run['id']} {PIN}",
                         "triggering_actor": {"login": ACTOR},
                         "repository": {"id": 123, "full_name": owner.REPO},
                         "head_repository": {"id": 123, "full_name": owner.REPO}}
        self.prior_recovery = {"id": PRIOR_RECOVERY_RUN, "run_attempt": 1, "workflow_id": 19,
                               "path": owner.RECOVERY_ISSUER_WORKFLOW,
                               "name": owner.RECOVERY_ISSUER_NAME, "event": "workflow_dispatch",
                               "head_branch": "master", "head_sha": ANCHOR, "status": "completed",
                               "conclusion": "success",
                               "display_title": f"Migration owner recovery {self.run['id']} {OTHER_PIN}",
                               "repository": {"id": 123, "full_name": owner.REPO},
                               "head_repository": {"id": 123, "full_name": owner.REPO}}
        self.compare = {"status": "ahead"}
        self.permission = {"permission": "write", "user": {"login": ACTOR}}
        self.live_issuers = {"total_count": 0, "workflow_runs": []}
        self.validators = {}
        self.created = None

    def request(self, method, path, body=None):
        if method != "GET":
            # Mutations echo the created check's own recovery identity (the
            # base fixture's defaults describe the automatic issuer instead).
            self.mutations.append((method, path, copy.deepcopy(body)))
            if self.lose == method:
                raise group.OwnershipUnqualified("original mutation response unknown")
            if method == "POST":
                result = check_data(self.run, **(body or {}))
                result["conclusion"] = None
                if self.after_create:
                    self.after_create()
                if self.post_override:
                    result.update(self.post_override)
                self.created = copy.deepcopy(result)
                return result
            assert self.created is not None, "PATCH before POST"
            return copy.deepcopy(self.created) | (body or {})
        if "/compare/" in path:
            assert path == f"/repos/{owner.REPO}/compare/{PIN}...master?per_page=1"
            return copy.deepcopy(self.compare)
        if "/collaborators/" in path:
            assert path == f"/repos/{owner.REPO}/collaborators/{ACTOR}/permission"
            return copy.deepcopy(self.permission)
        if path.startswith(f"/repos/{owner.REPO}/actions/runs?"):
            assert "event=workflow_run&status=in_progress&per_page=100" in path
            return copy.deepcopy(self.live_issuers)
        if path.endswith(f"/actions/runs/{RECOVERY_RUN}"):
            return copy.deepcopy(self.recovery)
        if path.endswith(f"/actions/runs/{PRIOR_RECOVERY_RUN}"):
            return copy.deepcopy(self.prior_recovery)
        if path.endswith("/actions/workflows/19"):
            return {"id": 19, "path": owner.RECOVERY_ISSUER_WORKFLOW,
                    "name": owner.RECOVERY_ISSUER_NAME, "state": "active"}
        return super().request(method, path, body)

    def graphql(self, query, variables):
        if query == owner.VALIDATOR_QUERY:
            sha = variables["p0"].split(":", 1)[0]
            ids = self.validators.get(sha, ("5" * 40, "6" * 40, "4" * 40))
            return {"repository": {"nameWithOwner": owner.REPO,
                                   **{f"p{i}": {"__typename": "Blob", "oid": oid}
                                      for i, oid in enumerate(ids)}}}
        return super().graphql(query, variables)


def mixed_service():
    """A no-migration candidate whose ordered queue prefix carries a
    migration-bearing predecessor (mixed-group bootstrap)."""
    api = RecoveryService()
    api.queue, _, _ = parallel_fixture()
    repo = api.queue["repository"]
    repo["nameWithOwner"] = owner.REPO
    for entry in repo["mergeQueue"]["entries"]["nodes"]:
        for key in ("baseRepository", "headRepository"):
            entry["pullRequest"][key]["nameWithOwner"] = owner.REPO
    api.run["head_sha"] = SECOND_HEAD
    api.issuer["display_title"] = f"Migration owner {api.run['id']}/{api.run['run_attempt']} {SECOND_HEAD}"
    api.recovery["display_title"] = f"Migration owner recovery {api.run['id']} {PIN}"
    api.doc = reservations_doc()
    api.doc["prefixes"]["0099"] = copy.deepcopy(ROW)
    api.sql = {NAME: RAW}
    return api


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("this source test must not open a network connection")
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)


@pytest.mark.parametrize("event", ["merge_group", "pull_request", "workflow_dispatch"])
def test_recovery_publishes_with_authenticated_provenance(event):
    api = RecoveryService(event)
    result = owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert result["state"] == "PUBLISHED" and result["head"] == api.run["head_sha"]
    assert result["by"] == ACTOR and result["issuer_revision"] == PIN
    assert [x[0] for x in api.mutations] == ["POST", "PATCH"]
    assert api.mutations[-1][2]["conclusion"] == "success"
    summary = api.mutations[-1][2]["output"]["summary"]
    assert ACTOR in summary and "write" in summary and PIN in summary
    external = api.mutations[0][2]["external_id"]
    assert external.endswith(":" + PIN) and api.run["head_sha"] in external
    assert api.mutations[0][2]["details_url"].endswith(f"/runs/{RECOVERY_RUN}/attempts/1")


def test_mixed_group_bootstrap_recovery_binds_predecessor_prefix_and_tree():
    api = mixed_service()
    assert owner.execute_recovery(recovery_event(), recovery_env(), api, APP)["state"] == "PUBLISHED"
    assert [x[0] for x in api.mutations] == ["POST", "PATCH"]
    assert api.mutations[-1][2]["conclusion"] == "success"


@pytest.mark.parametrize("change", ["foreign-owner", "chain", "foreign-tree"])
def test_mixed_group_negatives_refuse_before_any_publication(change):
    api = mixed_service()
    if change == "foreign-owner":
        api.doc["prefixes"]["0099"]["pr"] = 999
    elif change == "chain":
        api.queue["repository"]["mergeQueue"]["entries"]["nodes"][1]["baseCommit"]["oid"] = BASE
    else:
        # The head commit's ROOT tree must be the queue entry's integrated
        # tree, not a same-named other tree at the candidate head. (The
        # supabase/migrations subtree is a distinct, nested object.)
        api.contents_override = lambda v: v["repository"]["head"]["tree"].update(oid="7" * 40)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_automatic_issuer_also_binds_the_integrated_queue_tree():
    """The mixed-group binding is shared law, not recovery-only."""
    from test_trusted_migration_ownership import input_data
    api = mixed_service()
    envelope, env = input_data()
    envelope["workflow_run"] = copy.deepcopy(api.run)
    envelope["workflow_run"]["status"] = "in_progress"
    envelope["workflow_run"]["conclusion"] = None
    api.run.update(status="in_progress", conclusion=None)
    api.contents_override = lambda v: v["repository"]["head"]["tree"].update(oid="7" * 40)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute(envelope, env, api, APP)
    assert not api.mutations


@pytest.mark.parametrize("key,value", [("RECOVERY_ISSUER_REVISION", "not-a-sha"),
    ("RECOVERY_ISSUER_REVISION", ANCHOR), ("TRUSTED_CHECKOUT_SHA", ANCHOR),
    ("RECOVERY_TARGET_RUN", "abc"), ("RECOVERY_TARGET_RUN", "0"),
    ("RECOVERY_TARGET_RUN", "071"), ("GITHUB_SHA", "short"),
    ("GITHUB_REF", "refs/heads/other"), ("GITHUB_EVENT_NAME", "workflow_run"),
    ("GITHUB_REPOSITORY", "foreign/repo"), ("GITHUB_REPOSITORY_ID", "999")])
def test_untrusted_recovery_context_refuses(key, value):
    api = RecoveryService()
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(**{key: value}), api, APP)
    assert not api.mutations


@pytest.mark.parametrize("status", ["diverged", "behind", "unknown"])
def test_unreachable_or_unprotected_pinned_revision_refuses(status):
    api = RecoveryService()
    api.compare["status"] = status
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_pinned_master_tip_itself_is_reachable():
    api = RecoveryService()
    api.compare["status"] = "identical"
    assert owner.execute_recovery(recovery_event(), recovery_env(), api, APP)["state"] == "PUBLISHED"


def test_old_policy_issuer_revision_is_refused_anti_rollback():
    api = RecoveryService()
    api.validators[ANCHOR] = ("5" * 40, "6" * 40, "4" * 40)
    # The pin predates the current validator/issuer-law invariant (either the
    # validator or the issuer module itself rolled back).
    api.validators[PIN] = ("1" * 40, "6" * 40, "4" * 40)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_pinned_revision_with_rolled_back_issuer_module_is_refused():
    """Identical validator bytes cannot run weaker issuer law (review finding)."""
    api = RecoveryService()
    api.validators[PIN] = ("5" * 40, "6" * 40, "3" * 40)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


@pytest.mark.parametrize("shape", ["missing-at-pin", "missing-at-anchor"])
def test_validator_module_unavailable_refuses(shape):
    class Broken(RecoveryService):
        def graphql(self, query, variables):
            if query == owner.VALIDATOR_QUERY:
                sha = variables["p0"].split(":", 1)[0]
                data = super().graphql(query, variables)
                if sha == (PIN if shape == "missing-at-pin" else ANCHOR):
                    data["repository"]["p1"] = {"__typename": "Tree"}
                return data
            return super().graphql(query, variables)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), Broken(), APP)


@pytest.mark.parametrize("status,conclusion", [("in_progress", None), ("queued", None),
                                               ("completed", None), ("completed", "unknown")])
def test_unfinished_target_keeps_the_original_issuers_turn(status, conclusion):
    api = RecoveryService()
    api.run.update(status=status, conclusion=conclusion)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


@pytest.mark.parametrize("conclusion", ["failure", "neutral", "cancelled", "skipped"])
def test_any_completed_outcome_is_recoverable(conclusion):
    api = RecoveryService()
    api.run["conclusion"] = conclusion
    assert owner.execute_recovery(recovery_event(), recovery_env(), api, APP)["state"] == "PUBLISHED"


@pytest.mark.parametrize("field,value", [
    ("event", "workflow_run"), ("path", owner.ISSUER_WORKFLOW), ("name", owner.ISSUER_NAME),
    ("head_branch", "claude/foreign"), ("head_sha", PIN), ("run_attempt", 2),
    ("display_title", "Migration owner recovery 99 " + PIN),
    ("display_title", f"Migration owner 71/1 {HEAD}"), ("status", "completed"),
    ("id", 82), ("workflow_id", 18), ("repository.id", 999),
    ("head_repository.full_name", "foreign/repo"),
])
def test_recovery_run_spoof_refuses(field, value):
    api = RecoveryService()
    set_path(api.recovery, field, value)
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


@pytest.mark.parametrize("key,value", [("GITHUB_RUN_ID", "0"), ("GITHUB_RUN_ID", "x"),
    ("GITHUB_RUN_ID", "085"), ("GITHUB_RUN_ATTEMPT", "0"), ("GITHUB_RUN_ATTEMPT", "1.0"),
    ("GITHUB_RUN_ID", "")])
def test_noncanonical_recovery_identity_refuses(key, value):
    api = RecoveryService()
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(**{key: value}), api, APP)
    assert not api.mutations


def test_recovery_refuses_the_shared_actions_app():
    api = RecoveryService()
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, 15368)
    assert not api.mutations


@pytest.mark.parametrize("which", ["bot", "mismatched-trigger", "read-permission",
                                   "no-permission", "foreign-principal"])
def test_unqualified_dispatch_provenance_refuses(which):
    api = RecoveryService()
    event = recovery_event(sender={"login": ACTOR, "type": "Bot"}) if which == "bot" else recovery_event()
    if which == "mismatched-trigger":
        api.recovery["triggering_actor"] = {"login": "someone-else"}
    elif which == "read-permission":
        api.permission["permission"] = "read"
    elif which == "no-permission":
        api.permission["permission"] = "none"
    elif which == "foreign-principal":
        api.permission["user"] = {"login": "someone-else"}
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(event, recovery_env(), api, APP)
    assert not api.mutations


@pytest.mark.parametrize("field,value", [("path", ".github/workflows/attacker.yml"),
    ("name", "CI"), ("state", "disabled_manually"), ("id", 20)])
def test_wrong_recovery_workflow_identity_refuses(field, value):
    api = RecoveryService()
    original = api.request
    def wrong_workflow(method, path, body=None):
        if method == "GET" and path.endswith("/actions/workflows/19"):
            record = {"id": 19, "path": owner.RECOVERY_ISSUER_WORKFLOW,
                      "name": owner.RECOVERY_ISSUER_NAME, "state": "active"}
            record[field] = value
            return record
        return original(method, path, body)
    api.request = wrong_workflow
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_settled_original_issuer_check_reconciles_without_another_post():
    api = RecoveryService()
    api.previous = {"check_runs": [check_data()], "total_count": 1}
    result = owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert result == {"state": "RECONCILED", "conclusion": "success"}
    assert not api.mutations


def test_settled_prior_recovery_check_reconciles_with_other_pinned_revision():
    api = RecoveryService()
    check = check_data(details_url=f"https://github.com/{owner.REPO}/actions/runs/{PRIOR_RECOVERY_RUN}/attempts/1",
                       external_id=f"migration-owner:v1:{71}:{1}:{HEAD}:{OTHER_PIN}")
    api.previous = {"check_runs": [check], "total_count": 1}
    assert owner.execute_recovery(recovery_event(), recovery_env(), api, APP) == {
        "state": "RECONCILED", "conclusion": "success"}
    assert not api.mutations


def test_unsettled_original_check_is_never_replayed():
    api = RecoveryService()
    api.previous = {"check_runs": [check_data(status="in_progress", conclusion=None)],
                    "total_count": 1}
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_duplicate_original_operation_refuses():
    api = RecoveryService()
    api.previous = {"check_runs": [check_data(), check_data()], "total_count": 2}
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_foreign_same_name_check_is_not_this_operation_and_does_not_block():
    """A same-name check from another App is not this operation's record; it is
    neither reconciled nor allowed to wedge the recovery publication."""
    api = RecoveryService()
    api.previous = {"check_runs": [check_data(app={"id": 15368})], "total_count": 1}
    assert owner.execute_recovery(recovery_event(), recovery_env(), api, APP)["state"] == "PUBLISHED"
    assert [m[0] for m in api.mutations] == ["POST", "PATCH"]


def test_prior_check_with_unqualified_issuer_run_refuses():
    api = RecoveryService()
    check = check_data(details_url=f"https://github.com/{owner.REPO}/actions/runs/82/attempts/1")
    api.previous = {"check_runs": [check], "total_count": 1}
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_live_issuer_competition_refuses():
    api = RecoveryService()
    api.live_issuers = {"total_count": 1, "workflow_runs": [copy.deepcopy(api.issuer)]}
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert not api.mutations


def test_interrupted_publication_is_read_back_before_any_retry():
    api = RecoveryService()
    api.lose = "POST"
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert sum(m[0] == "POST" for m in api.mutations) == 1
    # The dispatch outcome is unknown: the same operation is only read back.
    api.lose = None
    settled = check_data(details_url=f"https://github.com/{owner.REPO}/actions/runs/{RECOVERY_RUN}/attempts/1",
                         external_id=f"migration-owner:v1:71:1:{HEAD}:{PIN}")
    api.previous = {"check_runs": [settled], "total_count": 1}
    assert owner.execute_recovery(recovery_event(), recovery_env(), api, APP)["state"] == "RECONCILED"
    assert sum(m[0] == "POST" for m in api.mutations) == 1


def test_interrupted_publication_unsettled_still_refuses():
    api = RecoveryService()
    api.lose = "POST"
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    api.lose = None
    unsettled = check_data(details_url=f"https://github.com/{owner.REPO}/actions/runs/{RECOVERY_RUN}/attempts/1",
                           external_id=f"migration-owner:v1:71:1:{HEAD}:{PIN}",
                           status="in_progress", conclusion=None)
    api.previous = {"check_runs": [unsettled], "total_count": 1}
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert sum(m[0] == "POST" for m in api.mutations) == 1


def test_later_recovery_attempt_is_reconcile_only():
    api = RecoveryService()
    api.recovery["run_attempt"] = 2
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(GITHUB_RUN_ATTEMPT="2"), api, APP)
    assert not api.mutations
    api.previous = {"check_runs": [check_data()], "total_count": 1}
    assert owner.execute_recovery(recovery_event(), recovery_env(GITHUB_RUN_ATTEMPT="2"), api, APP)["state"] == "RECONCILED"


def test_known_qualification_failure_concludes_failure_not_pending():
    api = RecoveryService()
    api.after_create = lambda: api.sql.update({NAME: b"-- changed\n"})
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert [m[0] for m in api.mutations] == ["POST", "PATCH"]
    assert api.mutations[-1][2]["conclusion"] == "failure"
    assert api.mutations[-1][1].endswith("/check-runs/91")


def test_failed_qualification_cannot_settle_a_superseded_principal():
    api = RecoveryService()
    def drift():
        api.sql.update({NAME: b"-- changed\n"})
        api.recovery["run_attempt"] = 2
    api.after_create = drift
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert [m[0] for m in api.mutations] == ["POST"]


def test_lost_mutation_response_never_retries():
    api = RecoveryService()
    api.lose = "PATCH"
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert [m[0] for m in api.mutations] == ["POST", "PATCH"]


@pytest.mark.parametrize("override", [{"app": {"id": 15368}}, {"head_sha": "f" * 40},
    {"external_id": "foreign"}, {"name": "Ingest + signal-layer tests"},
    {"details_url": f"https://github.com/{owner.REPO}/actions/runs/99/attempts/1"},
    {"status": "completed"}, {"conclusion": "success"}])
def test_wrong_created_producer_cannot_publish_success(override):
    api = RecoveryService()
    api.post_override = override
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    assert [m[0] for m in api.mutations] == ["POST"]


@pytest.mark.parametrize("which", ["target", "recovery", "material"])
def test_currentness_is_rechecked_before_success(which):
    api = RecoveryService()
    def drift():
        if which == "target":
            api.run["run_attempt"] = 2
        elif which == "recovery":
            api.recovery["run_attempt"] = 2
        else:
            api.sql[NAME] = b"-- changed\n"
    api.after_create = drift
    with pytest.raises(group.OwnershipUnqualified):
        owner.execute_recovery(recovery_event(), recovery_env(), api, APP)
    if which == "material":
        assert [m[0] for m in api.mutations] == ["POST", "PATCH"]
        assert api.mutations[-1][2]["conclusion"] == "failure"
    else:
        assert [m[0] for m in api.mutations] == ["POST"]


def write_event(tmp_path, event):
    path = tmp_path / "recovery-event.json"
    path.write_text(json.dumps(event))
    return str(path)


def run_main(monkeypatch, tmp_path, argv, env, api=None):
    env = dict(env)
    env["GITHUB_EVENT_PATH"] = write_event(tmp_path, recovery_event())
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    if api is not None:
        monkeypatch.setattr(owner, "Api", lambda token: api)
        monkeypatch.setattr(owner, "IssuerApi", lambda app, run: api)
    monkeypatch.setattr(owner.sys, "argv", ["owner"] + argv)
    return owner.main()


@pytest.mark.parametrize("selectors", [{"OWNERSHIP_APP_ID": "0", "EXPECTED_INSTALLATION": "0"},
    {"OWNERSHIP_APP_ID": "0", "EXPECTED_INSTALLATION": "999"},
    {"OWNERSHIP_APP_ID": str(APP), "EXPECTED_INSTALLATION": "0"}])
def test_dormant_selectors_stop_recovery_before_any_client_or_mint(tmp_path, monkeypatch, selectors):
    calls = []
    def unavailable(token):
        calls.append(token)
        raise AssertionError("dormant selectors must stop before any API client")
    monkeypatch.setattr(owner, "Api", unavailable)
    env = recovery_env(**selectors)
    assert run_main(monkeypatch, tmp_path, ["--recover-preflight"], env) == 1
    assert not calls


def test_recover_preflight_qualifies_without_mint(tmp_path, monkeypatch):
    api = RecoveryService()
    env = recovery_env(OWNERSHIP_APP_ID=str(APP), EXPECTED_INSTALLATION="999",
                       OWNERSHIP_RUN_TOKEN="INERT_RUN")
    assert run_main(monkeypatch, tmp_path, ["--recover-preflight"], env, api) == 0
    assert not api.mutations


def test_recover_preflight_rerun_refuses_before_mint(tmp_path, monkeypatch):
    api = RecoveryService()
    api.recovery["run_attempt"] = 2
    env = recovery_env(OWNERSHIP_APP_ID=str(APP), EXPECTED_INSTALLATION="999",
                       OWNERSHIP_RUN_TOKEN="INERT_RUN", GITHUB_RUN_ATTEMPT="2")
    assert run_main(monkeypatch, tmp_path, ["--recover-preflight"], env, api) == 1
    assert not api.mutations


def test_recover_main_entry_completes(tmp_path, monkeypatch):
    api = RecoveryService()
    env = recovery_env(OWNERSHIP_APP_ID=str(APP), EXPECTED_INSTALLATION="999",
                       OWNERSHIP_RUN_TOKEN="INERT_RUN", OWNERSHIP_TOKEN="INERT_APP")
    assert run_main(monkeypatch, tmp_path, ["--recover"], env, api) == 0
    assert [m[0] for m in api.mutations] == ["POST", "PATCH"]


def test_recovery_workflow_contract():
    workflow = yaml.safe_load(
        (ROOT / ".github/workflows/trusted-migration-ownership-recovery.yml").read_text())
    trigger = workflow.get("on", workflow.get(True))
    assert set(trigger) == {"workflow_dispatch"}
    assert "workflow_run" not in trigger  # survives a broken automatic issuer
    inputs = trigger["workflow_dispatch"]["inputs"]
    assert set(inputs) == {"issuer_revision", "ci_run_id"}
    assert all(inputs[key]["required"] is True for key in inputs)
    assert workflow["run-name"] == ("Migration owner recovery ${{ inputs.ci_run_id }} "
                                    "${{ inputs.issuer_revision }}")
    assert workflow["permissions"] == {}
    assert workflow["concurrency"]["group"] == "protected-migration-owner-recovery-${{ inputs.ci_run_id }}"
    assert workflow["concurrency"]["cancel-in-progress"] is False
    job = workflow["jobs"]["recover"]
    assert job["environment"] == "terminal-migration-owner"
    # A dispatch can target any ref carrying this file; only the environment's
    # master-only branch policy keeps hostile refs away from the key, and the
    # workflow must say so next to the environment it requires.
    raw_text = (ROOT / ".github/workflows/trusted-migration-ownership-recovery.yml").read_text()
    assert "BRANCH rule for master only" in raw_text
    assert job["permissions"] == {"contents": "read", "actions": "read"}
    guard = ("github.repository == 'mastermindx-market-intelligence/mastermind-terminal' && "
             "github.ref == 'refs/heads/master' && "
             "github.event.repository.default_branch == 'master'")
    assert job["if"].strip() == guard
    assert "MIGRATION_OWNER_APP_ID" not in job["if"]  # dormancy refuses loudly, never skips
    checkout, preflight, mint, invoke = job["steps"]
    assert checkout["with"]["ref"] == "${{ inputs.issuer_revision }}"
    assert checkout["with"]["persist-credentials"] is False
    assert checkout["with"]["sparse-checkout"] == ("scripts/trusted_migration_ownership.py\n"
        "scripts/migration_merge_group.py\nscripts/check_supabase_migration_namespace.py\n")
    assert "RECOVERY_ISSUER_REVISION" in preflight["env"] and "RECOVERY_TARGET_RUN" in preflight["env"]
    assert "OWNERSHIP_TOKEN" not in preflight["env"]
    assert preflight["run"].count("git rev-parse HEAD") == 1
    assert {k: v for k, v in mint["with"].items() if k.startswith("permission-")} == {
        "permission-merge-queues": "read", "permission-contents": "read",
        "permission-pull-requests": "read", "permission-checks": "write"}
    assert mint["with"]["repositories"] == "mastermind-terminal"
    assert mint["with"]["app-id"] == "${{ vars.MIGRATION_OWNER_APP_ID }}"
    assert invoke["env"]["OWNERSHIP_TOKEN"] == "${{ steps.installation.outputs.token }}"
    assert invoke["env"]["RECOVERY_ISSUER_REVISION"] == "${{ inputs.issuer_revision }}"
    assert invoke["run"].strip().endswith("--recover")
    assert all(len(s["uses"].split("@", 1)[1]) == 40 for s in job["steps"] if "uses" in s)
    text = json.dumps(workflow)
    for forbidden in ("download-artifact", "actions/cache", "npm ci", "pip install",
                      "check-suites", "actions/labeler"):
        assert forbidden not in text
