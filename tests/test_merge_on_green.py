from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
import yaml

from scripts import merge_on_green as mog
from scripts.merge_on_green import (
    ApiError,
    ARM_LABEL,
    BLOCK_LABEL,
    REQUIRED_CHECK_APP_ID,
    REQUIRED_CHECKS,
    check_verdict,
    sweep,
)


def checks(
    *,
    conclusion: str = "success",
    status: str = "completed",
    start_id: int = 10,
    app_id: int | str | bool | None = REQUIRED_CHECK_APP_ID,
    include_app: bool = True,
):
    result = []
    for index, name in enumerate(REQUIRED_CHECKS):
        run = {
            "id": start_id + index,
            "name": name,
            "status": status,
            "conclusion": conclusion,
        }
        if include_app:
            run["app"] = {"id": app_id}
        result.append(run)
    return result


def pull(
    number: int = 7,
    *,
    labels=None,
    mergeable=True,
    mergeable_state=None,
    base_sha="base-sha",
    draft=False,
    fork=False,
):
    selected_labels = [ARM_LABEL] if labels is None else labels
    # mergeable_state, when given explicitly, is the live GitHub relation to the
    # CURRENT base branch tip and is independent of base_sha (which the sweeper
    # must never trust for this decision -- see the "behind" tests below, which
    # deliberately set a base_sha that would look fine under the old base_sha
    # comparison while mergeable_state is the live "behind").
    state = mergeable_state if mergeable_state is not None else ("clean" if mergeable else "dirty")
    return {
        "number": number,
        "node_id": f"PR-node-{number}",
        "created_at": f"2026-08-{number:02d}T00:00:00Z",
        "draft": draft,
        "mergeable": mergeable,
        "mergeable_state": state,
        "labels": [{"name": name} for name in selected_labels],
        "base": {"ref": "master", "sha": base_sha},
        "head": {
            "ref": f"claude/pr-{number}",
            "sha": f"head-{number}",
            "repo": {"full_name": "owner/repo" if not fork else "fork/repo"},
        },
    }


def ci_run(
    run_id: int = 9001,
    *,
    sha: str = "head-7",
    status: str = "completed",
    conclusion: str | None = "action_required",
    actor: str = "github-actions[bot]",
    attempt: int = 1,
    event: str = "pull_request",
    head_repo: str = "owner/repo",
):
    """One ci.yml workflow run as the Actions runs API reports it. The defaults
    are the held run GitHub creates after a GITHUB_TOKEN branch update (#874)."""
    return {
        "id": run_id,
        "event": event,
        "head_sha": sha,
        "status": status,
        "conclusion": conclusion,
        "run_attempt": attempt,
        "actor": {"login": actor},
        "head_repository": {"full_name": head_repo},
    }


class FakeApi:
    repo = "owner/repo"

    def __init__(
        self,
        pulls,
        runs=None,
        merge_errors=None,
        *,
        queue_enabled=False,
        queue_entries=None,
        enqueue_errors=None,
        ci_runs=None,
        refresh_run="held",
        rerun_errors=None,
    ):
        self.pulls = {item["number"]: deepcopy(item) for item in pulls}
        self.runs = runs or {item["head"]["sha"]: checks() for item in pulls}
        # number -> (status, message) to raise as ApiError instead of merging.
        self.merge_errors = merge_errors or {}
        self.queue_enabled = queue_enabled
        self.queue_entries = dict(queue_entries or {})
        self.enqueue_errors = dict(enqueue_errors or {})
        self.actions = []
        self.dispatched: list[tuple[str, int | None]] = []
        # sha -> pull_request ci.yml runs for that head.
        self.ci_runs = {sha: [deepcopy(run) for run in runs_for] for sha, runs_for in (ci_runs or {}).items()}
        # What GitHub creates for the head update-branch writes: "held" (observed
        # 2026-10-13 for every GITHUB_TOKEN update), "queued", or None (no run).
        self.refresh_run = refresh_run
        # number -> new head written by update_branch. Applied on read so a
        # subclass that swaps self.pulls between reads still sees the refresh.
        self.refreshed: dict[int, str] = {}
        # run id -> (status, message) to raise as ApiError instead of re-running.
        self.rerun_errors = dict(rerun_errors or {})
        self.next_run_id = 9101

    def list_pulls(self):
        return [deepcopy(item) for item in self.pulls.values()]

    def pull(self, number):
        item = deepcopy(self.pulls[number])
        if number in self.refreshed:
            item["head"]["sha"] = self.refreshed[number]
        return item

    def check_runs(self, sha):
        return deepcopy(self.runs.get(sha, []))

    def pull_request_ci_runs(self, sha):
        return deepcopy(self.ci_runs.get(sha, []))

    def rerun_workflow_run(self, run_id):
        self.actions.append(("rerun", run_id))
        if run_id in self.rerun_errors:
            status, message = self.rerun_errors[run_id]
            raise ApiError(status, message)
        for runs_for in self.ci_runs.values():
            for run in runs_for:
                if run["id"] == run_id:
                    run.update(status="queued", conclusion=None, run_attempt=run["run_attempt"] + 1)

    def update_branch(self, number, head_sha):
        self.actions.append(("update", number, head_sha))
        new_head = f"{head_sha}-refreshed"
        self.refreshed[number] = new_head
        if self.refresh_run is not None:
            run_id, self.next_run_id = self.next_run_id, self.next_run_id + 1
            if self.refresh_run == "held":
                created = ci_run(run_id, sha=new_head)
            else:
                created = ci_run(run_id, sha=new_head, status=self.refresh_run, conclusion=None)
            self.ci_runs.setdefault(new_head, []).append(created)

    def dispatch_ci(self, branch, pr_number=None):
        # The ("dispatch_ci", branch) shape is what the older tests assert on and
        # is kept; `dispatched` additionally records the number the sweeper hands
        # down, which is what makes the refreshed head's CI run provable.
        self.actions.append(("dispatch_ci", branch))
        self.dispatched.append((branch, pr_number))

    def merge_queue_enabled(self, base_ref):
        assert base_ref == "master"
        return self.queue_enabled

    def queue_entry(self, pull_request_id):
        return self.queue_entries.get(pull_request_id)

    def enqueue(self, pull_request_id, head_sha):
        self.actions.append(("enqueue", pull_request_id, head_sha))
        number = int(pull_request_id.rsplit("-", 1)[-1])
        if number in self.enqueue_errors:
            status, message = self.enqueue_errors[number]
            raise ApiError(status, message)
        entry_id = f"MQE-{pull_request_id}"
        self.queue_entries[pull_request_id] = entry_id
        return entry_id

    def merge(self, number, head_sha):
        self.actions.append(("merge", number, head_sha))
        if number in self.merge_errors:
            status, message = self.merge_errors[number]
            raise ApiError(status, message)
        return {"merged": True}

    def compare(self, base_sha, head_sha):
        # Current `sweep()` never calls this -- the refresh-vs-merge decision
        # reads live `mergeable_state` (see the "behind" tests below), not a
        # base/head comparison. Kept ONLY so a historical regression replay of
        # these tests against a pre-fix `scripts/merge_on_green.py` (which does
        # call `api.compare(base_sha, head_sha)`) exercises that old code's
        # real branch-relation logic instead of dying on a missing attribute --
        # reviewer minor #1 on PR #487 found 3 of the 4 new sweeper tests
        # failing on the previous head with `AttributeError` rather than a
        # genuine behavioural difference. "ahead" matches what the old
        # comparison returned for this fixture's default base_sha, so the old
        # code's real bug (trusting a stale base_sha instead of live
        # mergeable_state) reproduces honestly under replay.
        self.actions.append(("compare", base_sha, head_sha))
        return "ahead"

    def add_labels(self, number, labels):
        self.actions.append(("add_labels", number, tuple(labels)))
        existing = {label["name"] for label in self.pulls[number]["labels"]}
        self.pulls[number]["labels"].extend(
            {"name": label} for label in labels if label not in existing
        )

    def remove_label(self, number, label):
        self.actions.append(("remove_label", number, label))
        self.pulls[number]["labels"] = [
            item for item in self.pulls[number]["labels"] if item["name"] != label
        ]

    def comment(self, number, body):
        self.actions.append(("comment", number, body))

    def delete_branch(self, branch):
        self.actions.append(("delete", branch))


def paged_pull_reader(monkeypatch, pages):
    """Exercise the real REST reader while controlling only HTTP responses."""
    api = mog.GitHubApi("owner/repo", "fictional-test-token")
    visited = []

    def request(method, path, payload=None):
        assert method == "GET" and urlsplit(path).path == "/pulls"
        page = int(parse_qs(urlsplit(path).query).get("page", ["1"])[0])
        visited.append(page)
        result = pages[page]
        if isinstance(result, Exception):
            raise result
        return deepcopy(result)

    monkeypatch.setattr(api, "request", request)
    return api, visited


def test_trigger_after_first_hundred_open_pulls_reaches_the_existing_sweep(monkeypatch):
    older = [pull(number, labels=[]) for number in range(1, 101)]
    target = pull(861)
    reader, visited = paged_pull_reader(monkeypatch, {1: older, 2: [target]})
    api = FakeApi(older + [target])
    monkeypatch.setattr(api, "list_pulls", reader.list_pulls)
    sweep(api, trigger_number=861)
    assert ("merge", 861, "head-861") in api.actions
    assert visited == [1, 2]


def test_exact_full_pull_page_reads_empty_end_before_reporting_complete(monkeypatch):
    page = [pull(number, labels=[]) for number in range(1, 101)]
    reader, visited = paged_pull_reader(monkeypatch, {1: page, 2: []})
    assert len(reader.list_pulls()) == 100
    assert visited == [1, 2]


def test_short_open_pull_page_needs_no_further_request(monkeypatch):
    reader, visited = paged_pull_reader(monkeypatch, {1: [pull(7)]})
    assert [item["number"] for item in reader.list_pulls()] == [7]
    assert visited == [1]


def test_later_pull_page_failure_does_not_return_a_partial_census(monkeypatch):
    page = [pull(number, labels=[]) for number in range(1, 101)]
    reader, visited = paged_pull_reader(monkeypatch, {1: page, 2: ApiError(503, "unavailable")})
    with pytest.raises(ApiError, match="unavailable"):
        reader.list_pulls()
    assert visited == [1, 2]


def test_latest_rerun_wins_over_an_older_green_check():
    runs = checks()
    runs.append(
        {
            "id": 999,
            "name": REQUIRED_CHECKS[0],
            "status": "queued",
            "conclusion": None,
            "app": {"id": REQUIRED_CHECK_APP_ID},
        }
    )
    verdict = check_verdict(runs)
    assert verdict.state == "pending"
    assert REQUIRED_CHECKS[0] in verdict.detail


def test_missing_check_is_pending_not_a_pass():
    verdict = check_verdict(checks()[:-1])
    assert verdict.state == "pending"
    assert REQUIRED_CHECKS[-1] in verdict.detail


def test_wrong_app_cannot_satisfy_required_checks():
    verdict = check_verdict(checks(app_id=999999))
    assert verdict.state == "pending"
    assert f"trusted App {REQUIRED_CHECK_APP_ID}" in verdict.detail
    assert all(name in verdict.detail for name in REQUIRED_CHECKS)


def test_missing_or_malformed_app_metadata_cannot_satisfy_required_checks():
    runs = checks()
    runs[0].pop("app")
    runs[1]["app"] = {"id": "not-an-integer"}
    runs[2]["app"] = {"id": True}

    verdict = check_verdict(runs)

    assert verdict.state == "pending"
    assert f"trusted App {REQUIRED_CHECK_APP_ID}" in verdict.detail
    assert all(name in verdict.detail for name in REQUIRED_CHECKS)


def test_later_wrong_app_duplicate_does_not_erase_trusted_green():
    runs = checks()
    runs.append(
        {
            "id": 999,
            "name": REQUIRED_CHECKS[0],
            "status": "completed",
            "conclusion": "failure",
            "app": {"id": 999999},
        }
    )

    verdict = check_verdict(runs)

    assert verdict.state == "green"


def test_newer_wrong_app_duplicate_does_not_erase_trusted_red():
    runs = checks()
    runs[0]["conclusion"] = "failure"
    runs.append(
        {
            "id": 999,
            "name": REQUIRED_CHECKS[0],
            "status": "completed",
            "conclusion": "success",
            "app": {"id": 999999},
        }
    )

    verdict = check_verdict(runs)

    assert verdict.state == "red"
    assert f"{REQUIRED_CHECKS[0]}=failure" in verdict.detail


def test_newer_trusted_pending_supersedes_green_even_when_wrong_app_is_newest():
    runs = checks()
    runs.extend(
        [
            {
                "id": 998,
                "name": REQUIRED_CHECKS[0],
                "status": "queued",
                "conclusion": None,
                "app": {"id": REQUIRED_CHECK_APP_ID},
            },
            {
                "id": 999,
                "name": REQUIRED_CHECKS[0],
                "status": "completed",
                "conclusion": "success",
                "app": {"id": 999999},
            },
        ]
    )

    verdict = check_verdict(runs)

    assert verdict.state == "pending"
    assert REQUIRED_CHECKS[0] in verdict.detail


# A raw text/regex scan over the workflow's source cannot tell a real YAML
# `permissions:` key from the same word inside a shell heredoc or a comment,
# and it forbids ever reflowing the top-level block or adding an unrelated
# top-level key elsewhere in the file (reviewer minors #2/#3 on PR #487: the
# guard must reason about the parsed document, not its bytes).
JOB_LEVEL_PERMISSIONS_TEXT_ONLY = re.compile(r"(?m)^[ \t]+permissions:")


def ci_workflow_text() -> str:
    return (
        Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml"
    ).read_text(encoding="utf-8")


def ci_workflow() -> dict[str, Any]:
    return yaml.safe_load(ci_workflow_text())


def job_level_permissions(workflow: dict[str, Any]) -> dict[str, Any]:
    """Map of job name -> its own `permissions:` value, for every job that
    declares one. Parses the real document, so comments, shell text inside a
    `run:` block, and formatting cannot produce a false positive or a false
    negative."""
    jobs = workflow.get("jobs") or {}
    return {
        name: job["permissions"]
        for name, job in jobs.items()
        if isinstance(job, dict) and "permissions" in job
    }


def test_a_text_only_regex_guard_misfires_on_a_comment_or_shell_block():
    # Demonstrates the defect the semantic checks below replace: the raw-text
    # guard flags a job step whose `run:` shell text merely contains the word
    # "permissions:" at non-zero indent, even though no real YAML key exists.
    decorated = (
        "name: CI\npermissions:\n  contents: read\njobs:\n"
        "  hub:\n    runs-on: ubuntu-latest\n    steps:\n"
        "      - run: |\n          cat <<'EOF'\n          permissions:\n"
        "            contents: write\n          EOF\n"
    )
    assert yaml.safe_load(decorated)["jobs"]["hub"] is not None
    assert JOB_LEVEL_PERMISSIONS_TEXT_ONLY.search(decorated) is not None
    assert job_level_permissions(yaml.safe_load(decorated)) == {}


APPROVED_CI_JOB_PERMISSIONS = {
    "python": {"contents": "read", "pull-requests": "read"},
}


def assert_candidate_ci_permissions(workflow: dict[str, Any]) -> None:
    # The namespace guard reads native queue/PR membership only in the Python
    # job. No other job, extra scope or write privilege is approved.
    assert workflow.get("permissions") == {"contents": "read"}
    assert job_level_permissions(workflow) == APPROVED_CI_JOB_PERMISSIONS


def test_candidate_ci_explicitly_pins_read_only_contents_permission():
    # Semantic parse, not byte position: reformatting this block or adding an
    # unrelated top-level key elsewhere in the file cannot defeat the check.
    assert_candidate_ci_permissions(ci_workflow())


def test_candidate_ci_runs_for_native_merge_queue_heads():
    text = ci_workflow_text()
    assert "\n  merge_group:\n    types: [checks_requested]\n" in text



def test_job_level_permission_elevation_is_rejected_by_the_candidate_ci_guard():
    # Exercise the same guard as the real-workflow test against a forbidden
    # write grant, while retaining the one approved read-only Python job.
    workflow = ci_workflow()
    assert_candidate_ci_permissions(workflow)
    elevated = deepcopy(workflow)
    elevated["jobs"]["probe"] = {
        "runs-on": "ubuntu-latest",
        "permissions": {"contents": "write"},
    }

    assert job_level_permissions(elevated) == {
        **APPROVED_CI_JOB_PERMISSIONS,
        "probe": {"contents": "write"},
    }
    with pytest.raises(AssertionError):
        assert_candidate_ci_permissions(elevated)


@pytest.mark.parametrize(
    ("job", "permissions"),
    [
        pytest.param("python", {"contents": "write", "pull-requests": "read"}, id="contents-write"),
        pytest.param("python", {"contents": "read", "pull-requests": "write"}, id="pull-requests-write"),
        pytest.param("python", {"contents": "read", "pull-requests": "read", "issues": "read"}, id="extra-read-scope"),
        pytest.param("python", {"contents": "read", "pull-requests": "read", "id-token": "write"}, id="extra-write-scope"),
        pytest.param("python", "read-all", id="python-read-all"),
        pytest.param("python", "write-all", id="python-write-all"),
        pytest.param("python", {}, id="missing-python-scopes"),
        pytest.param("python", {"contents": "read"}, id="missing-pr-scope"),
        pytest.param("probe", {"contents": "read"}, id="unapproved-read-only-job"),
        pytest.param("probe", {}, id="unapproved-empty-job-grant"),
    ],
)
def test_candidate_ci_rejects_unapproved_job_permission_changes(job, permissions):
    workflow = deepcopy(ci_workflow())
    workflow["jobs"].setdefault(job, {"runs-on": "ubuntu-latest"})["permissions"] = permissions

    with pytest.raises(AssertionError):
        assert_candidate_ci_permissions(workflow)


@pytest.mark.parametrize(
    "permissions",
    [None, {}, "read-all", "write-all", {"contents": "write"},
     {"contents": "read", "pull-requests": "read"}],
)
def test_candidate_ci_rejects_top_level_permission_changes(permissions):
    workflow = deepcopy(ci_workflow())
    workflow["permissions"] = permissions

    with pytest.raises(AssertionError):
        assert_candidate_ci_permissions(workflow)


def test_green_current_head_is_sha_pinned_merged_and_deleted():
    api = FakeApi([pull()])
    result = sweep(api)
    assert ("merge", 7, "head-7") in api.actions
    assert ("delete", "claude/pr-7") in api.actions
    assert result[0] == "#7: merged and deleted claude/pr-7"


READY_REPORT = (
    "#{n}: ready for the merge queue; native user admission required "
    "(gh pr merge {n} --auto --match-head-commit head-{n}); head head-{n} verified green by this sweep"
)


def test_queue_mode_reports_green_heads_ready_and_never_enqueues():
    # A successful workflow-token enqueue does not establish downstream event
    # delivery. Green heads remain eligible, but this sweep only reports them;
    # the native user path pins the exact verified head at admission.
    api = FakeApi(
        [pull(1), pull(2, mergeable_state="behind")],
        queue_enabled=True,
    )

    result = sweep(api)

    assert api.actions == []
    assert api.queue_entries == {}
    assert api.dispatched == []
    assert result == [READY_REPORT.format(n=1), READY_REPORT.format(n=2)]


def test_queue_mode_is_idempotent_for_an_already_enqueued_head():
    api = FakeApi(
        [pull()],
        queue_enabled=True,
        queue_entries={"PR-node-7": "MQE-existing"},
    )

    result = sweep(api)

    assert result == ["#7: already queued (MQE-existing)"]
    assert not any(action[0] in {"enqueue", "merge", "update", "delete"} for action in api.actions)


def test_queue_mode_reports_an_existing_entry_read_only_and_still_sees_the_next_head():
    # A head already holding a queue entry is reported exactly as before --
    # read-only, no mutation -- and its outcome must not hide the next armed
    # head, which (holding no entry) is reported ready rather than enqueued.
    api = FakeApi(
        [pull(1), pull(2)],
        queue_enabled=True,
        queue_entries={"PR-node-1": "MQE-existing"},
    )

    result = sweep(api)

    assert result == ["#1: already queued (MQE-existing)", READY_REPORT.format(n=2)]
    assert api.actions == []
    assert api.queue_entries == {"PR-node-1": "MQE-existing"}


# --- native queue admission is a user action (2026-11-05) ----------------------
#
# The workflow-token enqueue result is not downstream event-delivery proof.
# This sweep therefore never enqueues. A red, pending,
# foreign-App or held head is refused exactly as before, and a fully green head
# with no entry is reported ready for `gh pr merge --auto` instead.


def test_queue_mode_red_head_is_quarantined_and_never_enqueued():
    api = FakeApi([pull()], queue_enabled=True, runs={"head-7": checks(conclusion="failure")})

    result = sweep(api)

    assert result == ["#7: red"]
    assert ("add_labels", 7, (BLOCK_LABEL,)) in api.actions
    assert not any(action[0] == "enqueue" for action in api.actions)
    assert api.queue_entries == {}


def test_queue_mode_pending_head_waits_and_never_enqueues():
    runs = checks()
    runs.append(
        {
            "id": 999,
            "name": REQUIRED_CHECKS[0],
            "status": "in_progress",
            "conclusion": None,
            "app": {"id": REQUIRED_CHECK_APP_ID},
        }
    )
    api = FakeApi([pull()], queue_enabled=True, runs={"head-7": runs})

    result = sweep(api)

    assert result == [f"#7: pending: {REQUIRED_CHECKS[0]}"]
    assert api.actions == []
    assert api.queue_entries == {}


def test_queue_mode_foreign_app_green_waits_and_never_enqueues():
    api = FakeApi([pull()], queue_enabled=True, runs={"head-7": checks(app_id=999999)})

    result = sweep(api)

    assert result == [
        f"#7: missing trusted App {REQUIRED_CHECK_APP_ID} checks: " + ", ".join(REQUIRED_CHECKS)
    ]
    assert api.actions == []
    assert api.queue_entries == {}


def test_queue_mode_held_run_is_released_and_never_enqueues():
    # A held pull_request run is still released (it is the only way checks can
    # ever arrive) -- and the sweep still performs no queue admission itself.
    api = FakeApi([pull()], queue_enabled=True, runs={"head-7": []}, ci_runs={"head-7": [ci_run()]})

    result = sweep(api)

    assert result == ["#7: re-ran held pull_request CI run 9001 for head-7; awaiting PR-linked CI"]
    assert api.actions == [("rerun", 9001)]
    assert api.queue_entries == {}


def test_wrong_app_green_never_reaches_merge_or_quarantine():
    api = FakeApi([pull()], runs={"head-7": checks(app_id=999999)})

    result = sweep(api)

    assert result == [
        f"#7: missing trusted App {REQUIRED_CHECK_APP_ID} checks: "
        + ", ".join(REQUIRED_CHECKS)
    ]
    assert not any(action[0] == "merge" for action in api.actions)
    assert not any(action[0] == "delete" for action in api.actions)
    assert not any(action[0] == "add_labels" for action in api.actions)
    assert not any(action[0] == "comment" for action in api.actions)


REFRESHED = (
    "updated onto current master; re-ran held pull_request CI run 9101 "
    "for head-{n}-refreshed; awaiting PR-linked CI"
)


def test_green_stale_head_is_updated_then_waits_for_fresh_ci():
    api = FakeApi([pull(mergeable_state="behind")])
    result = sweep(api)
    assert ("update", 7, "head-7") in api.actions
    # The held pull_request run of the new head is re-run; nothing is dispatched,
    # because dispatched checks never satisfy the pull request's rollup (#874).
    assert ("rerun", 9101) in api.actions
    assert not any(action[0] == "dispatch_ci" for action in api.actions)
    assert not any(action[0] == "merge" for action in api.actions)
    assert result == ["#7: " + REFRESHED.format(n=7)]


def test_stale_base_sha_with_live_behind_mergeable_state_takes_the_refresh_path():
    # Regression for the 405 sweeper defect (#422): pull.base.sha here is set to
    # a value that would have satisfied the OLD base_sha-vs-head compare() logic
    # (it is exactly the sha the fixture always used, i.e. indistinguishable from
    # "not stale" under that check), while mergeable_state -- GitHub's own LIVE
    # relation to the current master tip -- reads "behind". The refresh path
    # must be taken from mergeable_state alone, and merge() must never be called.
    api = FakeApi([pull(base_sha="base-sha", mergeable_state="behind")])
    result = sweep(api)
    assert ("update", 7, "head-7") in api.actions
    assert ("rerun", 9101) in api.actions
    assert not any(action[0] == "merge" for action in api.actions)
    assert result == ["#7: " + REFRESHED.format(n=7)]


def test_blocked_or_unstable_mergeable_state_waits_without_attempting_merge():
    for state in ("blocked", "unstable", "unknown", "has_hooks"):
        api = FakeApi([pull(mergeable_state=state)])
        result = sweep(api)
        assert not any(action[0] == "merge" for action in api.actions), state
        assert result == [f"#7: waiting (mergeable_state={state})"], state


def test_405_on_merge_is_declined_for_that_pr_and_the_sweep_continues():
    # Regression for the sweeper-dead defect diagnosed 2026-09-06 16:30Z: a
    # merge attempt GitHub itself refuses with a 4xx (405 under strict required
    # -status protection was the observed case on #422) must be recorded as a
    # per-PR "declined" outcome, and the sweep must still evaluate every other
    # armed PR -- never abort the whole sweep on the first such error.
    first = pull(1)
    second = pull(2)
    api = FakeApi(
        [first, second],
        merge_errors={1: (405, "3 of 3 required status checks are expected.")},
    )

    result = sweep(api)

    assert ("merge", 1, "head-1") in api.actions
    # The sweep proceeded past the declined PR and evaluated/merged the next one.
    assert ("merge", 2, "head-2") in api.actions
    assert ("delete", "claude/pr-2") in api.actions
    assert result == [
        "#1: declined: GitHub API 405: 3 of 3 required status checks are expected.",
        "#2: merged and deleted claude/pr-2",
        "no additional armed green branch required a base refresh",
    ]


def test_5xx_on_merge_is_not_swallowed_as_declined_and_still_aborts_the_sweep():
    # Reviewer minor #2 on PR #487: the ruling's carve-out is for GitHub
    # itself DECLINING a merge on the merits (a 4xx, 405 in particular). A
    # 5xx/429/etc is the API failing, not a considered refusal, and that word
    # would misdescribe it -- it must still propagate like any other
    # unhandled ApiError rather than being recorded as "declined" and letting
    # the sweep move on to the next PR.
    first = pull(1)
    second = pull(2)
    api = FakeApi(
        [first, second],
        merge_errors={1: (500, "Internal Server Error")},
    )

    with pytest.raises(ApiError) as excinfo:
        sweep(api)

    assert excinfo.value.status == 500
    assert ("merge", 1, "head-1") in api.actions
    # The sweep must not have gone on to evaluate PR #2 after the raise.
    assert not any(action[0] == "merge" and action[1] == 2 for action in api.actions)


def test_main_exits_non_zero_when_any_pr_was_declined_but_never_mid_sweep(monkeypatch, capsys):
    monkeypatch.setenv("GH_REPO", "owner/repo")
    monkeypatch.setenv("MERGE_TOKEN", "token")
    monkeypatch.delenv("TRIGGER_PR_NUMBER", raising=False)
    monkeypatch.setattr(
        mog,
        "sweep",
        lambda api, trigger: [
            "#1: declined: GitHub API 405: nope",
            "#2: merged and deleted claude/pr-2",
        ],
    )

    exit_code = mog.main()

    out = capsys.readouterr().out
    assert exit_code == 1
    # Both notices were printed -- the non-zero exit is end-of-sweep reporting,
    # never a signal that the sweep stopped early.
    assert "#1: declined" in out
    assert "#2: merged and deleted claude/pr-2" in out


def test_conflict_is_quarantined_once_without_admin_merge():
    conflicted = pull(7, mergeable=False)
    api = FakeApi([conflicted])
    sweep(api)
    assert ("add_labels", 7, (BLOCK_LABEL,)) in api.actions
    assert sum(action[0] == "comment" for action in api.actions) == 1
    assert not any(action[0] == "merge" for action in api.actions)

    api.actions.clear()
    sweep(api)
    assert not any(action[0] == "comment" for action in api.actions)


def test_red_latest_check_is_quarantined():
    item = pull()
    api = FakeApi([item], runs={"head-7": checks(conclusion="failure")})
    result = sweep(api)
    assert result == ["#7: red"]
    assert ("add_labels", 7, (BLOCK_LABEL,)) in api.actions
    assert not any(action[0] == "merge" for action in api.actions)


def test_recovered_green_removes_blocked_label_before_merge():
    item = pull(labels=[ARM_LABEL, BLOCK_LABEL])
    api = FakeApi([item])
    sweep(api)
    remove_index = api.actions.index(("remove_label", 7, BLOCK_LABEL))
    merge_index = api.actions.index(("merge", 7, "head-7"))
    assert remove_index < merge_index


def test_draft_fork_unarmed_and_hold_pull_requests_are_never_candidates():
    items = [
        pull(1, draft=True),
        pull(2, fork=True),
        pull(3, labels=[]),
        pull(4, labels=[ARM_LABEL, "hold"]),
        pull(5, labels=[ARM_LABEL, "do-not-merge"]),
    ]
    # A held run on each head must not turn any refusal into a re-run.
    held = {f"head-{n}": [ci_run(9000 + n, sha=f"head-{n}")] for n in range(1, 6)}
    held["head-2"] = [ci_run(9002, sha="head-2", head_repo="fork/repo")]
    api = FakeApi(items, ci_runs=held)
    assert sweep(api) == []
    assert api.actions == []


def test_after_one_merge_the_next_stale_green_is_refreshed_not_merged():
    first = pull(1)
    second = pull(2, mergeable_state="behind")
    api = FakeApi([first, second])
    result = sweep(api)
    assert ("merge", 1, "head-1") in api.actions
    assert ("update", 2, "head-2") in api.actions
    assert ("rerun", 9101) in api.actions
    assert ("merge", 2, "head-2") not in api.actions
    assert result == [
        "#1: merged and deleted claude/pr-1",
        "#2: " + REFRESHED.format(n=2),
    ]


def test_older_behind_head_does_not_hide_a_later_ready_head():
    api = FakeApi([pull(1, mergeable_state="behind"), pull(2)])
    waits = []

    result = sweep(api, wait=waits.append)

    assert api.actions == [
        ("merge", 2, "head-2"),
        ("delete", "claude/pr-2"),
        ("update", 1, "head-1"),
        ("rerun", 9101),
    ]
    assert result == ["#2: merged and deleted claude/pr-2", "#1: " + REFRESHED.format(n=1)]
    assert waits == []


def test_ready_heads_keep_their_order_before_one_deferred_refresh():
    class MovingBaseApi(FakeApi):
        def merge(self, number, head_sha):
            result = super().merge(number, head_sha)
            for other in self.pulls.values():
                if other["number"] != number:
                    other["mergeable_state"] = "behind"
            return result

    api = MovingBaseApi([
        pull(1, mergeable_state="behind"), pull(2), pull(3),
        pull(4, mergeable_state="behind"),
    ])

    sweep(api, wait=lambda _: None)

    assert [action[1] for action in api.actions if action[0] == "merge"] == [2]
    assert [action[1] for action in api.actions if action[0] == "update"] == [1]


@pytest.mark.parametrize("change", ["hold", "draft", "new_head", "conflict", "pending"])
def test_deferred_refresh_rechecks_current_release_gates(change):
    class ChangedDeferredApi(FakeApi):
        reads = 0

        def pull(self, number):
            item = super().pull(number)
            if number == 1:
                self.reads += 1
                if self.reads == 2:
                    if change == "hold":
                        item["labels"].append({"name": "hold"})
                    elif change == "draft":
                        item["draft"] = True
                    elif change == "new_head":
                        item["head"]["sha"] = "unqualified-new-head"
                    elif change == "conflict":
                        item["mergeable"] = False
                    else:
                        item["mergeable"] = None
            return item

    api = ChangedDeferredApi([pull(1, mergeable_state="behind"), pull(2)])

    sweep(api, wait=lambda _: None)

    assert ("merge", 2, "head-2") in api.actions
    assert not any(action[0] in {"update", "rerun", "dispatch_ci"} for action in api.actions)


# --- review round 4, MAJOR 2 -------------------------------------------------
#
# When no pull_request run appears for a GITHUB_TOKEN-refreshed head, the run this
# controller dispatches is the ONLY CI run for the sha that then merges. (The
# usual path re-runs the held pull_request run instead; see the #874 tests below.)
# On a workflow_dispatch `github.event.pull_request.number` is empty, so the
# supabase/migrations namespace guard resolved that gating run to its LENIENT rule
# set and its one enforcement rule was inert on exactly the head that merges. ci.yml now takes a `pr_number` input and the number is passed through.
#
# Every test here drives a stub in place of the HTTP layer: nothing touches the
# network, and no token or project reference appears anywhere.


class RecordingGraphQLApi(mog.GitHubApi):
    def __init__(self, responses):
        super().__init__("owner/repo", "unused-in-this-test")
        self.responses = list(responses)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def graphql_request(self, query, variables):  # type: ignore[override]
        self.calls.append((query, deepcopy(variables)))
        return deepcopy(self.responses.pop(0))


def test_merge_queue_probe_is_bound_to_the_exact_repository_and_base():
    api = RecordingGraphQLApi(
        [{"repository": {"mergeQueue": {"id": "MQ-main"}}}]
    )

    assert api.merge_queue_enabled("master") is True
    assert api.calls[0][1] == {
        "owner": "owner",
        "name": "repo",
        "branch": "master",
    }


def test_enqueue_mutation_pins_the_exact_pull_request_and_head(monkeypatch):
    api = RecordingGraphQLApi(
        [{"enqueuePullRequest": {"mergeQueueEntry": {"id": "MQE-7"}}}]
    )

    # This existing test isolates mutation shape; issuer tests exercise the real preflight.
    monkeypatch.setattr(api, "native_enqueue_api", lambda: api)
    assert api.enqueue("PR-node-7", "head-7") == "MQE-7"
    assert api.calls[0][1] == {
        "pullRequestId": "PR-node-7",
        "expectedHeadOid": "head-7",
    }


class RecordingApi(mog.GitHubApi):
    """A real GitHubApi with only `request` replaced, so the payload under test is
    the one the production method actually builds.
    """

    def __init__(self, fail_statuses: list[int] | None = None, reply: Any = None):
        super().__init__("owner/repo", "unused-in-this-test")
        self.calls: list[tuple[str, str, dict[str, Any] | None]] = []
        self.fail_statuses = list(fail_statuses or [])
        self.reply = reply

    def request(self, method, path, payload=None):  # type: ignore[override]
        self.calls.append((method, path, deepcopy(payload)))
        if self.fail_statuses:
            raise ApiError(self.fail_statuses.pop(0), "Unexpected inputs provided")
        return deepcopy(self.reply)


def test_dispatch_carries_the_pull_request_number_as_a_workflow_input():
    api = RecordingApi()
    api.dispatch_ci("claude/pr-7", 543)
    assert api.calls == [
        (
            "POST",
            "/actions/workflows/ci.yml/dispatches",
            {"ref": "claude/pr-7", "inputs": {"pr_number": "543"}},
        )
    ]


def test_dispatch_without_a_number_sends_no_inputs_key():
    api = RecordingApi()
    api.dispatch_ci("claude/pr-7")
    assert api.calls == [("POST", "/actions/workflows/ci.yml/dispatches", {"ref": "claude/pr-7"})]


def test_a_422_on_the_input_retries_once_without_it_and_says_the_run_is_lenient(capsys):
    """A branch whose ci.yml predates the input answers 422. Ordering the proof
    matters more than ordering it in the stricter mode -- but the fallback must
    say out loud that the dispatched run will not assert the pull-request rule,
    rather than let a reader assume it did.
    """
    api = RecordingApi(fail_statuses=[422])
    api.dispatch_ci("claude/pr-7", 543)

    assert [call[2] for call in api.calls] == [
        {"ref": "claude/pr-7", "inputs": {"pr_number": "543"}},
        {"ref": "claude/pr-7"},
    ]
    printed = capsys.readouterr().out
    assert "LENIENT" in printed and "422" in printed and "claude/pr-7" in printed


def test_a_non_422_dispatch_error_is_not_swallowed():
    """Only the "this workflow does not take that input" case is retried. A 404 or
    a 5xx is a real failure and must reach the sweep's error path.
    """
    api = RecordingApi(fail_statuses=[404])
    with pytest.raises(ApiError):
        api.dispatch_ci("claude/pr-7", 543)
    assert len(api.calls) == 1


def test_a_422_without_inputs_is_not_retried_forever():
    api = RecordingApi(fail_statuses=[422])
    with pytest.raises(ApiError):
        api.dispatch_ci("claude/pr-7")
    assert len(api.calls) == 1


def test_the_refresh_path_hands_the_number_to_the_dispatched_run():
    """The wiring through sweep(), not just the leaf method: when no pull_request
    run appears for the refreshed head, the fallback dispatch must still carry
    the number to the run that will gate the merge.
    """
    api = FakeApi([pull(7, mergeable_state="behind")], refresh_run=None)
    waits = []
    result = sweep(api, wait=waits.append)
    assert api.dispatched == [("claude/pr-7", 7)]
    # Bounded: the first read is immediate, every later one is spaced.
    assert waits == [mog.REFRESH_RUN_POLL_SECONDS] * (mog.REFRESH_RUN_POLLS - 1)
    assert not any(action[0] == "rerun" for action in api.actions)
    assert result == [
        "#7: updated onto current master; no pull_request CI run appeared for the "
        "new head; dispatched CI; awaiting fresh CI"
    ]


# --- held pull_request runs (#874, 2026-10-13) ---------------------------------
#
# A GITHUB_TOKEN branch update makes GitHub create the new head's pull_request CI
# run already completed as action_required, with no jobs. The pull request's
# required-check rollup reads that run's suite, so green checks from a dispatched
# run on the same commit left #874 BLOCKED while the sweep only logged "waiting".
# Probe PR #988 showed a GITHUB_TOKEN `POST /actions/runs/{id}/rerun` executes the
# held run's jobs. The controller re-runs only its own held runs, once.


def test_held_run_on_a_green_blocked_head_is_re_run_instead_of_waiting():
    # The #874 shape: commit-level checks green (from the dispatched run), PR
    # BLOCKED because its own pull_request run never executed.
    api = FakeApi(
        [pull(mergeable_state="blocked")],
        ci_runs={"head-7": [ci_run(38370600573)]},
    )

    result = sweep(api)

    assert result == [
        "#7: re-ran held pull_request CI run 38370600573 for head-7; awaiting PR-linked CI"
    ]
    assert api.actions == [("rerun", 38370600573)]


def test_held_run_with_missing_required_checks_is_re_run():
    # A GITHUB_TOKEN commit nobody dispatched for: no checks will ever arrive.
    api = FakeApi([pull()], runs={"head-7": []}, ci_runs={"head-7": [ci_run()]})

    result = sweep(api)

    assert result == ["#7: re-ran held pull_request CI run 9001 for head-7; awaiting PR-linked CI"]
    assert api.actions == [("rerun", 9001)]


def test_held_run_is_re_run_in_merge_queue_mode_too():
    api = FakeApi(
        [pull(mergeable_state="blocked")],
        queue_enabled=True,
        ci_runs={"head-7": [ci_run()]},
    )

    result = sweep(api)

    assert result == ["#7: re-ran held pull_request CI run 9001 for head-7; awaiting PR-linked CI"]
    assert api.actions == [("rerun", 9001)]


@pytest.mark.parametrize(
    ("runs", "detail"),
    [
        pytest.param([], "waiting (mergeable_state=blocked)", id="no-run"),
        pytest.param(
            [ci_run(head_repo="fork/repo")], "waiting (mergeable_state=blocked)", id="other-repo-head"
        ),
        pytest.param([ci_run(sha="head-6")], "waiting (mergeable_state=blocked)", id="other-head-sha"),
        pytest.param(
            [ci_run(event="workflow_dispatch")], "waiting (mergeable_state=blocked)", id="not-pull-request"
        ),
        pytest.param(
            [ci_run(status="in_progress", conclusion=None)],
            "waiting (mergeable_state=blocked)",
            id="already-running",
        ),
        pytest.param(
            # A workflow-file error: completed failure with no jobs. A re-run
            # cannot fix it, so it is not treated as held.
            [ci_run(conclusion="failure")],
            "waiting (mergeable_state=blocked)",
            id="workflow-file-failure",
        ),
        pytest.param(
            [ci_run(9001), ci_run(9002, status="queued", conclusion=None)],
            "waiting (mergeable_state=blocked)",
            id="older-held-newer-running",
        ),
        pytest.param(
            [ci_run(actor="outside-contributor")],
            "pull_request CI run 9001 is waiting for a maintainer to approve outside-contributor's run",
            id="someone-else's-held-run",
        ),
        pytest.param(
            [ci_run(attempt=2)],
            "pull_request CI run 9001 is still held after 2 attempts; a maintainer must re-run it",
            id="held-again-after-a-re-run",
        ),
    ],
)
def test_only_the_controllers_own_first_held_run_is_ever_re_run(runs, detail):
    api = FakeApi([pull(mergeable_state="blocked")], ci_runs={"head-7": runs})

    result = sweep(api)

    assert result == [f"#7: {detail}"]
    assert api.actions == []


def test_a_refused_re_run_is_declined_for_that_pr_and_the_sweep_continues():
    api = FakeApi(
        [pull(1, mergeable_state="blocked"), pull(2)],
        ci_runs={"head-1": [ci_run(sha="head-1")]},
        rerun_errors={9001: (403, "Resource not accessible by integration")},
    )

    result = sweep(api)

    assert result[:2] == [
        "#1: declined: re-run of held pull_request CI run 9001: "
        "GitHub API 403: Resource not accessible by integration",
        "#2: merged and deleted claude/pr-2",
    ]


def test_a_5xx_on_re_run_is_not_swallowed():
    api = FakeApi(
        [pull(mergeable_state="blocked")],
        ci_runs={"head-7": [ci_run()]},
        rerun_errors={9001: (502, "Bad Gateway")},
    )

    with pytest.raises(ApiError) as excinfo:
        sweep(api)

    assert excinfo.value.status == 502


def test_a_refused_re_run_inside_a_refresh_line_still_exits_non_zero(monkeypatch, capsys):
    monkeypatch.setenv("GH_REPO", "owner/repo")
    monkeypatch.setenv("MERGE_TOKEN", "token")
    monkeypatch.delenv("TRIGGER_PR_NUMBER", raising=False)
    monkeypatch.setattr(
        mog,
        "sweep",
        lambda api, trigger: [
            "#7: updated onto current master; declined: re-run of held pull_request "
            "CI run 9101: GitHub API 403: nope",
        ],
    )

    assert mog.main() == 1
    assert "declined: re-run" in capsys.readouterr().out


def test_a_refused_re_run_after_a_real_refresh_exits_non_zero(monkeypatch, capsys):
    monkeypatch.setenv("GH_REPO", "owner/repo")
    monkeypatch.setenv("MERGE_TOKEN", "token")
    monkeypatch.delenv("TRIGGER_PR_NUMBER", raising=False)
    api = FakeApi(
        [pull(mergeable_state="behind")],
        rerun_errors={9101: (403, "Resource not accessible by integration")},
    )
    monkeypatch.setattr(mog, "GitHubApi", lambda repo, token: api)

    assert mog.main() == 1
    assert api.actions == [("update", 7, "head-7"), ("rerun", 9101)]
    assert (
        "#7: updated onto current master; declined: re-run of held pull_request CI run 9101"
        in capsys.readouterr().out
    )


def test_a_waiting_or_merge_declined_line_alone_does_not_exit_non_zero(monkeypatch):
    monkeypatch.setenv("GH_REPO", "owner/repo")
    monkeypatch.setenv("MERGE_TOKEN", "token")
    monkeypatch.delenv("TRIGGER_PR_NUMBER", raising=False)
    monkeypatch.setattr(
        mog,
        "sweep",
        lambda api, trigger: [
            "#7: waiting (mergeable_state=blocked)",
            "#8: merge declined (state changed)",
            "#9: pull_request CI run 9001 is still held after 2 attempts; a maintainer must re-run it",
        ],
    )

    assert mog.main() == 0


def test_the_refresh_path_leaves_an_already_running_pull_request_run_alone():
    api = FakeApi([pull(mergeable_state="behind")], refresh_run="queued")

    result = sweep(api)

    assert not any(action[0] in {"rerun", "dispatch_ci"} for action in api.actions)
    assert result == [
        "#7: updated onto current master; pull_request CI run 9101 is queued; awaiting PR-linked CI"
    ]


class LateHeadApi(FakeApi):
    """update-branch answers 202 before the merge commit exists: the pull request
    keeps reporting its old head for a few reads after the update."""

    def __init__(self, *args, stale_reads=2, **kwargs):
        super().__init__(*args, **kwargs)
        self.stale_reads = stale_reads

    def pull(self, number):
        if number in self.refreshed and self.stale_reads:
            self.stale_reads -= 1
            return deepcopy(self.pulls[number])
        return super().pull(number)


def test_the_refresh_path_waits_for_the_new_head_before_looking_for_its_run():
    # The old head carries its own held attempt-1 run: reading runs before the
    # head moves would re-run the wrong head's CI.
    api = LateHeadApi(
        [pull(mergeable_state="behind")],
        ci_runs={"head-7": [ci_run(9001, sha="head-7")]},
        stale_reads=2,
    )
    waits = []

    result = sweep(api, wait=waits.append)

    assert waits == [mog.REFRESH_RUN_POLL_SECONDS] * 2
    assert api.actions == [("update", 7, "head-7"), ("rerun", 9101)]
    assert result == ["#7: " + REFRESHED.format(n=7)]


def test_a_head_that_never_moves_is_not_dispatched_against():
    api = LateHeadApi([pull(mergeable_state="behind")], stale_reads=mog.REFRESH_RUN_POLLS)
    waits = []

    result = sweep(api, wait=waits.append)

    assert waits == [mog.REFRESH_RUN_POLL_SECONDS] * (mog.REFRESH_RUN_POLLS - 1)
    assert api.actions == [("update", 7, "head-7")]
    assert api.dispatched == []
    assert result == [
        "#7: updated onto current master; "
        "update-branch has not written a new head yet; a later sweep re-checks it"
    ]


def test_runs_lookup_is_bound_to_ci_yml_pull_request_events_and_the_exact_head():
    api = RecordingApi(reply={"workflow_runs": [ci_run()]})

    assert api.pull_request_ci_runs("abc/123") == [ci_run()]
    assert api.calls == [
        (
            "GET",
            "/actions/workflows/ci.yml/runs?event=pull_request&head_sha=abc%2F123&per_page=20",
            None,
        )
    ]


def test_re_run_posts_to_the_exact_run():
    api = RecordingApi()

    api.rerun_workflow_run(38370600573)

    assert api.calls == [("POST", "/actions/runs/38370600573/rerun", None)]


# --- optional target_pr workflow_dispatch input --------------------------------
#
# A manually dispatched run may name exactly one pull request. The input is
# validated before any API client is built, and a targeted run reconciles only
# that pull request: every incumbent guard still applies to it, and no other
# pull request is ever considered, merged, refreshed or enqueued as a fallback.
#
# Every test here drives a stub in place of the HTTP layer: nothing touches the
# network.


def mog_workflow_text() -> str:
    return (
        Path(__file__).resolve().parents[1]
        / ".github"
        / "workflows"
        / "merge-on-green.yml"
    ).read_text(encoding="utf-8")


def mog_workflow() -> dict[str, Any]:
    return yaml.safe_load(mog_workflow_text())


def workflow_triggers(workflow: dict[str, Any]) -> dict[str, Any]:
    # PyYAML resolves the bare key `on` to the boolean True (YAML 1.1), so the
    # trigger map may be stored under either spelling.
    triggers = workflow.get("on")
    if not isinstance(triggers, dict):
        triggers = workflow.get(True)
    return triggers or {}


def test_the_dispatch_trigger_gains_an_optional_string_target_pr_input():
    triggers = workflow_triggers(mog_workflow())

    # The incumbent triggers are untouched; only workflow_dispatch gains an input.
    assert set(triggers) == {
        "workflow_run",
        "pull_request_target",
        "schedule",
        "workflow_dispatch",
    }
    inputs = triggers["workflow_dispatch"]["inputs"]
    assert inputs["target_pr"]["required"] is False
    assert inputs["target_pr"]["default"] == ""
    assert inputs["target_pr"]["type"] == "string"


def test_target_pr_reaches_the_script_through_env_never_the_shell():
    workflow = mog_workflow()

    step = workflow["jobs"]["sweep"]["steps"][1]
    env = step["env"]
    # Routed as workflow-context expressions through the step environment, so the
    # shell never interpolates the value.
    assert env["TARGET_PR"] == "${{ inputs.target_pr }}"
    assert env["GITHUB_EVENT_NAME"] == "${{ github.event_name }}"
    assert env["TRIGGER_PR_NUMBER"] == "${{ github.event.pull_request.number }}"
    assert "${{" not in step["run"]
    assert "target_pr" not in step["run"]
    assert "TARGET_PR" not in step["run"]


@pytest.mark.parametrize(
    "raw",
    ["7", "861", "2147483647"],
)
def test_target_pr_accepts_exactly_a_canonical_ascii_positive_number(raw):
    assert mog.parse_target_pr(raw) == int(raw)


def test_an_omitted_or_empty_target_pr_means_no_target():
    assert mog.parse_target_pr(None) is None
    assert mog.parse_target_pr("") is None


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(" 7", id="leading-space"),
        pytest.param("7 ", id="trailing-space"),
        pytest.param("7\n", id="newline"),
        pytest.param("+7", id="plus-sign"),
        pytest.param("-7", id="minus-sign"),
        pytest.param("0", id="zero"),
        pytest.param("00", id="double-zero"),
        pytest.param("1_000", id="underscore"),
        pytest.param("0x10", id="hex-prefix"),
        pytest.param("7.0", id="decimal-point"),
        pytest.param("seven", id="word"),
        pytest.param("١٢", id="arabic-indic-digits"),
        pytest.param("７", id="fullwidth-digit"),
        pytest.param("²", id="superscript-two"),
        pytest.param("2147483648", id="just-past-2^31-1"),
        pytest.param("99999999999", id="far-overflow"),
    ],
)
def test_target_pr_rejects_anything_but_a_plain_positive_number(raw):
    with pytest.raises(ValueError):
        mog.parse_target_pr(raw)


def main_env(monkeypatch, *, event="workflow_dispatch", trigger=None, target=None):
    monkeypatch.setenv("GH_REPO", "owner/repo")
    monkeypatch.setenv("MERGE_TOKEN", "token")
    if event is None:
        monkeypatch.delenv("GITHUB_EVENT_NAME", raising=False)
    else:
        monkeypatch.setenv("GITHUB_EVENT_NAME", event)
    if trigger is None:
        monkeypatch.delenv("TRIGGER_PR_NUMBER", raising=False)
    else:
        monkeypatch.setenv("TRIGGER_PR_NUMBER", str(trigger))
    if target is None:
        monkeypatch.delenv("TARGET_PR", raising=False)
    else:
        monkeypatch.setenv("TARGET_PR", str(target))


@pytest.mark.parametrize(
    "raw",
    [" 7", "+7", "-7", "0", "７", "2147483648", "seven"],
)
def test_an_invalid_target_pr_fails_before_any_api_client_exists(monkeypatch, capsys, raw):
    main_env(monkeypatch, event="workflow_dispatch", target=raw)
    constructed = []

    def forbidden(repo, token):
        constructed.append((repo, token))
        raise AssertionError("GitHubApi must not be constructed for an invalid target_pr")

    monkeypatch.setattr(mog, "GitHubApi", forbidden)
    monkeypatch.setattr(mog, "sweep", forbidden)

    assert mog.main() == 2
    assert "target_pr" in capsys.readouterr().err
    assert constructed == []


@pytest.mark.parametrize(
    "event",
    ["schedule", "workflow_run", "pull_request_target", None],
    ids=["schedule", "workflow_run", "pull_request_target", "event-unset"],
)
def test_a_target_pr_is_rejected_on_any_non_dispatch_event_before_api_construction(
    monkeypatch, capsys, event
):
    main_env(monkeypatch, event=event, target="861")
    constructed = []
    monkeypatch.setattr(mog, "GitHubApi", lambda repo, token: constructed.append((repo, token)))

    assert mog.main() == 2
    assert constructed == []
    assert "workflow_dispatch" in capsys.readouterr().err


def test_a_target_pr_conflicting_with_the_event_trigger_is_rejected(monkeypatch, capsys):
    main_env(monkeypatch, event="workflow_dispatch", trigger=5, target="861")
    constructed = []
    monkeypatch.setattr(mog, "GitHubApi", lambda repo, token: constructed.append((repo, token)))

    assert mog.main() == 2
    assert constructed == []
    assert "conflicts" in capsys.readouterr().err


@pytest.mark.parametrize("target", [None, ""], ids=["unset", "empty"])
def test_an_omitted_or_empty_target_pr_preserves_the_untargeted_sweep(monkeypatch, target):
    main_env(monkeypatch, event="workflow_dispatch", target=target)
    calls = []

    def recording_sweep(api, trigger_number=None, **kwargs):
        calls.append((api, trigger_number, kwargs))
        return []

    monkeypatch.setattr(mog, "sweep", recording_sweep)

    assert mog.main() == 0
    assert len(calls) == 1
    api, trigger_number, kwargs = calls[0]
    assert isinstance(api, mog.GitHubApi)
    assert trigger_number is None
    # No target argument at all: the incumbent sweep entry point is unchanged.
    assert kwargs == {}


def test_an_explicit_target_pr_is_routed_into_the_sweep(monkeypatch, capsys):
    main_env(monkeypatch, event="workflow_dispatch", target="861")
    calls = []

    def recording_sweep(api, trigger_number=None, **kwargs):
        calls.append((api, trigger_number, kwargs))
        return ["#861: merged and deleted claude/pr-861"]

    monkeypatch.setattr(mog, "sweep", recording_sweep)

    assert mog.main() == 0
    assert calls[0][2] == {"target_number": 861}
    assert "#861: merged and deleted claude/pr-861" in capsys.readouterr().out


def test_a_targeted_sweep_considers_only_the_named_pull_request():
    api = FakeApi([pull(7), pull(8)])

    result = sweep(api, target_number=8)

    assert ("merge", 8, "head-8") in api.actions
    assert ("delete", "claude/pr-8") in api.actions
    # The other armed green pull request was never evaluated, let alone acted on.
    assert not any(len(action) > 1 and action[1] == 7 for action in api.actions)
    assert result == [
        "#8: merged and deleted claude/pr-8",
        "no additional armed green branch required a base refresh",
    ]


@pytest.mark.parametrize(
    "candidate",
    [
        pytest.param(dict(labels=[]), id="unarmed"),
        pytest.param(dict(labels=[ARM_LABEL, "hold"]), id="hold"),
        pytest.param(dict(labels=[ARM_LABEL, "do-not-merge"]), id="do-not-merge"),
        pytest.param(dict(draft=True), id="draft"),
        pytest.param(dict(fork=True), id="fork"),
    ],
)
def test_a_targeted_sweep_never_falls_back_when_the_target_is_not_a_candidate(candidate):
    # Pull request #9 is armed and green: a fallback sweep would merge it.
    api = FakeApi([pull(8, **candidate), pull(9)])

    assert sweep(api, target_number=8) == []
    assert api.actions == []


def test_a_targeted_sweep_keeps_the_red_ci_quarantine_for_the_target_alone():
    api = FakeApi(
        [pull(7), pull(8)],
        runs={"head-7": checks(conclusion="failure")},
    )

    result = sweep(api, target_number=7)

    assert result == ["#7: red"]
    assert ("add_labels", 7, (BLOCK_LABEL,)) in api.actions
    assert sum(action[0] == "comment" for action in api.actions) == 1
    assert not any(action[0] == "merge" for action in api.actions)
    assert not any(len(action) > 1 and action[1] == 8 for action in api.actions)


def test_a_targeted_sweep_quarantines_a_conflicting_target_without_admin_merge():
    api = FakeApi([pull(7, mergeable=False), pull(8)])

    result = sweep(api, target_number=7)

    assert result[0] == "#7: conflict"
    assert ("add_labels", 7, (BLOCK_LABEL,)) in api.actions
    assert not any(action[0] == "merge" for action in api.actions)
    assert not any(len(action) > 1 and action[1] == 8 for action in api.actions)


def test_a_targeted_sweep_refreshes_a_stale_head_instead_of_merging_it():
    api = FakeApi([pull(7, mergeable_state="behind"), pull(8)])

    result = sweep(api, target_number=7)

    assert ("update", 7, "head-7") in api.actions
    assert ("rerun", 9101) in api.actions
    assert not any(action[0] == "merge" for action in api.actions)
    assert not any(len(action) > 1 and action[1] == 8 for action in api.actions)
    assert result == ["#7: " + REFRESHED.format(n=7)]


def test_a_targeted_sweep_merges_a_current_clean_base_and_touches_nothing_else():
    api = FakeApi([pull(7, mergeable_state="clean"), pull(8, mergeable_state="behind")])

    result = sweep(api, target_number=7)

    assert ("merge", 7, "head-7") in api.actions
    assert not any(action[0] == "update" for action in api.actions)
    assert not any(len(action) > 1 and action[1] == 8 for action in api.actions)


def test_a_targeted_sweep_waits_on_a_blocked_state_without_a_held_run():
    api = FakeApi([pull(7, mergeable_state="blocked"), pull(8)])

    result = sweep(api, target_number=7)

    assert result == ["#7: waiting (mergeable_state=blocked)"]
    assert api.actions == []


def test_a_targeted_sweep_releases_only_the_targets_held_run():
    api = FakeApi(
        [pull(7, mergeable_state="blocked"), pull(8, mergeable_state="blocked")],
        ci_runs={"head-7": [ci_run(38370600573, sha="head-7")]},
    )

    result = sweep(api, target_number=7)

    assert api.actions == [("rerun", 38370600573)]
    assert result == [
        "#7: re-ran held pull_request CI run 38370600573 for head-7; awaiting PR-linked CI"
    ]


@pytest.mark.parametrize("mergeable_state", ["clean", "behind"])
@pytest.mark.parametrize(
    "queue_entries, expected",
    [
        ({}, READY_REPORT.format(n=7)),
        ({"PR-node-7": "MQE-existing"}, "#7: already queued (MQE-existing)"),
    ],
    ids=["ready", "already-queued"],
)
def test_a_targeted_sweep_only_reports_the_target_when_the_queue_is_enabled(
    mergeable_state, queue_entries, expected
):
    reads = []

    class TargetReadApi(FakeApi):
        def pull(self, number):
            reads.append(("pull", number))
            return super().pull(number)

        def check_runs(self, sha):
            reads.append(("check_runs", sha))
            return super().check_runs(sha)

        def queue_entry(self, pull_request_id):
            reads.append(("queue_entry", pull_request_id))
            return super().queue_entry(pull_request_id)

    api = TargetReadApi(
        [pull(7, mergeable_state=mergeable_state), pull(8)],
        queue_enabled=True,
        queue_entries=dict(queue_entries),
    )

    result = sweep(api, target_number=7)

    # Workflow-token admission cannot establish merge_group event delivery.
    # Targeting narrows observation; it never mutates or falls back to PR #8.
    assert api.actions == []
    assert api.queue_entries == queue_entries
    assert api.dispatched == []
    assert result == [expected]
    assert set(reads) == {
        ("pull", 7),
        ("check_runs", "head-7"),
        ("queue_entry", "PR-node-7"),
    }


def test_a_main_run_with_a_target_merges_only_that_pull_request(monkeypatch, capsys):
    main_env(monkeypatch, event="workflow_dispatch", target="7")
    api = FakeApi([pull(7), pull(8)])
    monkeypatch.setattr(mog, "GitHubApi", lambda repo, token: api)

    assert mog.main() == 0

    assert ("merge", 7, "head-7") in api.actions
    assert not any(action[0] == "merge" and action[1] == 8 for action in api.actions)
    out = capsys.readouterr().out
    assert "#7: merged and deleted claude/pr-7" in out
    assert "#8" not in out


def test_a_main_run_with_an_untargetable_target_considers_nothing_else(monkeypatch, capsys):
    main_env(monkeypatch, event="workflow_dispatch", target="8")
    api = FakeApi([pull(8, labels=[]), pull(9)])  # only #9 is armed and green
    monkeypatch.setattr(mog, "GitHubApi", lambda repo, token: api)

    assert mog.main() == 0

    assert api.actions == []
    out = capsys.readouterr().out
    assert "no other pull request was considered" in out
    assert "#9" not in out


def test_a_missing_explicit_target_never_sweeps_an_armed_neighbor():
    api = FakeApi([pull(9)])
    assert sweep(api, target_number=8) == []
    assert api.actions == []


def test_a_target_for_another_base_never_reaches_release():
    target = pull(8)
    target["base"]["ref"] = "other-branch"
    api = FakeApi([target, pull(9)])
    assert sweep(api, target_number=8) == []
    assert api.actions == []


def test_a_targeted_run_proves_the_refreshed_head_instead_of_the_listed_head():
    class AdvancedHeadApi(FakeApi):
        def pull(self, number):
            current = super().pull(number)
            current["head"]["sha"] = "new-head-without-checks"
            return current

    api = AdvancedHeadApi([pull(8), pull(9)])
    result = sweep(api, target_number=8)
    assert "missing trusted App" in result[0]
    assert api.actions == []


# Native enqueue must use an authenticated event-generating user credential.
# All network boundaries below are replaced; token strings are test-owned sentinels.
@pytest.fixture
def native_issuer_transport(monkeypatch):
    monkeypatch.setenv("NATIVE_ENQUEUE_TOKEN", "test-native-user-credential")
    monkeypatch.setenv("NATIVE_ENQUEUE_ISSUER_LOGIN", "release-user")
    monkeypatch.setenv("NATIVE_ENQUEUE_ISSUER_ID", "42")
    monkeypatch.setenv("GITHUB_REPOSITORY_ID", "71")
    monkeypatch.setenv("GITHUB_TOKEN", "test-job-credential")
    identity = {
        "viewer": {"__typename": "User", "login": "release-user", "databaseId": 42},
        "repository": {"nameWithOwner": "mastermindx-market-intelligence/mastermind-terminal",
                       "databaseId": 71, "viewerPermission": "WRITE"},
    }
    calls = []
    def transport(api, query, variables):
        calls.append((api.token, query, deepcopy(variables)))
        if "mutation" in query:
            return {"enqueuePullRequest": {"mergeQueueEntry": {"id": "MQE-test"}}}
        return deepcopy(identity)
    monkeypatch.setattr(mog.GitHubApi, "graphql_request", transport)
    def no_http(*args, **kwargs):
        raise AssertionError("no provider transport allowed")
    monkeypatch.setattr(mog.urllib.request, "urlopen", no_http)
    api = mog.GitHubApi("mastermindx-market-intelligence/mastermind-terminal", "test-job-credential")
    return api, identity, calls


def test_native_enqueue_uses_only_qualified_user_credential(native_issuer_transport):
    api, _, calls = native_issuer_transport
    assert api.enqueue("PR-exact", "head-exact") == "MQE-test"
    assert len(calls) == 2
    assert all(row[0] == "test-native-user-credential" for row in calls)
    assert "viewer" in calls[0][1] and "repository" in calls[0][1]
    assert calls[0][2] == {"owner": "mastermindx-market-intelligence", "name": "mastermind-terminal"}
    assert calls[1][2] == {"pullRequestId": "PR-exact", "expectedHeadOid": "head-exact"}
    assert api.token == "test-job-credential"  # Other incumbent operations are unchanged.


@pytest.mark.parametrize("field,value", [
    ("NATIVE_ENQUEUE_TOKEN", ""),
    ("NATIVE_ENQUEUE_TOKEN", "test-job-credential"),
    ("NATIVE_ENQUEUE_ISSUER_LOGIN", ""),
    ("NATIVE_ENQUEUE_ISSUER_ID", ""),
    ("NATIVE_ENQUEUE_ISSUER_ID", "not-an-id"),
    ("GITHUB_REPOSITORY_ID", ""),
])
def test_native_enqueue_missing_or_job_token_never_mutates(native_issuer_transport, monkeypatch, field, value):
    api, _, calls = native_issuer_transport
    monkeypatch.setenv(field, value)
    with pytest.raises(ApiError):
        api.enqueue("PR-exact", "head-exact")
    assert calls == []


@pytest.mark.parametrize("section,field,value", [
    ("viewer", "__typename", "Bot"),
    ("viewer", "login", "github-actions[bot]"),
    ("viewer", "login", "different-user"),
    ("viewer", "databaseId", 43),
    ("viewer", "databaseId", True),
    ("repository", "nameWithOwner", "other/repository"),
    ("repository", "databaseId", 72),
    ("repository", "viewerPermission", "READ"),
    ("repository", "viewerPermission", None),
])
def test_native_enqueue_wrong_identity_or_repository_never_mutates(native_issuer_transport, section, field, value):
    api, identity, calls = native_issuer_transport
    identity[section][field] = value
    with pytest.raises(ApiError):
        api.enqueue("PR-exact", "head-exact")
    assert len(calls) == 1 and "mutation" not in calls[0][1]


def test_native_enqueue_wrong_configured_repository_never_reads(native_issuer_transport):
    api, _, calls = native_issuer_transport
    api.repo = "foreign/repository"
    with pytest.raises(ApiError):
        api.enqueue("PR-exact", "head-exact")
    assert calls == []


@pytest.mark.parametrize("response", [None, {}, {"viewer": None, "repository": None}])
def test_native_enqueue_incomplete_identity_never_mutates(native_issuer_transport, monkeypatch, response):
    api, _, calls = native_issuer_transport
    def incomplete(client, query, variables):
        calls.append((client.token, query, variables))
        return response
    monkeypatch.setattr(mog.GitHubApi, "graphql_request", incomplete)
    with pytest.raises(ApiError):
        api.enqueue("PR-exact", "head-exact")
    assert len(calls) == 1 and "mutation" not in calls[0][1]


def test_native_enqueue_identity_failure_is_not_retried(native_issuer_transport, monkeypatch):
    api, _, calls = native_issuer_transport
    def denied(client, query, variables):
        calls.append((client.token, query, variables))
        raise ApiError(403, "test refusal")
    monkeypatch.setattr(mog.GitHubApi, "graphql_request", denied)
    with pytest.raises(ApiError):
        api.enqueue("PR-exact", "head-exact")
    assert len(calls) == 1


def test_native_enqueue_requalifies_each_original_attempt(native_issuer_transport):
    api, identity, calls = native_issuer_transport
    assert api.enqueue("PR-first", "head-first") == "MQE-test"
    identity["viewer"]["databaseId"] = 99
    with pytest.raises(ApiError):
        api.enqueue("PR-second", "head-second")
    assert len(calls) == 3
    assert sum("mutation" in row[1] for row in calls) == 1



def test_native_enqueue_lost_response_has_one_mutation_and_no_fallback(native_issuer_transport, monkeypatch):
    api, identity, calls = native_issuer_transport
    def lost(client, query, variables):
        calls.append((client.token, query, deepcopy(variables)))
        if "mutation" in query:
            raise TimeoutError("test-owned lost response")
        return deepcopy(identity)
    monkeypatch.setattr(mog.GitHubApi, "graphql_request", lost)
    with pytest.raises(TimeoutError):
        api.enqueue("PR-exact", "head-exact")
    assert len(calls) == 2
    assert sum("mutation" in row[1] for row in calls) == 1
    assert all(row[0] == "test-native-user-credential" for row in calls)


def test_reporting_workflow_requires_explicit_opt_in_for_native_user_credentials():
    document = yaml.safe_load((Path(__file__).resolve().parents[1] / ".github/workflows/merge-on-green.yml").read_text())
    steps = document["jobs"]["sweep"]["steps"]
    step = next(s for s in steps if s.get("name") == "reconcile armed pull requests")
    assert step["env"]["MERGE_TOKEN"] == "${{ secrets.GITHUB_TOKEN }}"
    assert step["env"]["NATIVE_QUEUE_AUTO_ADMIT"] == "${{ vars.NATIVE_QUEUE_AUTO_ADMIT || 'off' }}"
    assert step["env"]["NATIVE_ENQUEUE_TOKEN"] == (
        "${{ (vars.NATIVE_QUEUE_AUTO_ADMIT == 'canary' || vars.NATIVE_QUEUE_AUTO_ADMIT == 'enabled') && secrets.NATIVE_ENQUEUE_TOKEN || '' }}"
    )
    assert step["env"]["GITHUB_REPOSITORY_ID"] == "${{ github.event.repository.id }}"
    assert "ADMIN_GH_TOKEN" not in json.dumps(document)
    assert document["concurrency"]["cancel-in-progress"] is False
    assert document["jobs"]["sweep"]["timeout-minutes"] == 10


def test_configured_user_enrollment_does_not_enable_workflow_queue_admission(monkeypatch):
    for name, value in {
        "NATIVE_ENQUEUE_TOKEN": "test-explicit-user-credential",
        "NATIVE_ENQUEUE_ISSUER_LOGIN": "test-user",
        "NATIVE_ENQUEUE_ISSUER_ID": "123",
        "GITHUB_REPOSITORY_ID": "456",
    }.items():
        monkeypatch.setenv(name, value)
    api = FakeApi([pull(1)], queue_enabled=True)

    def forbidden_enqueue(*args):
        raise AssertionError("configured credentials must not activate sweep admission")

    monkeypatch.setattr(api, "enqueue", forbidden_enqueue)
    assert sweep(api) == [READY_REPORT.format(n=1)]
    assert api.actions == []
    assert api.queue_entries == {}



# Native automatic admission remains OFF unless the trusted protected workflow
# explicitly enrolls a canary or enabled mode with a separate verified user.
def test_automatic_enqueue_consumes_label_once_before_mutation():
    api = FakeApi([pull()], queue_enabled=True)
    api.release_comments = lambda number: []
    api.native_enqueue_api = lambda: api
    assert sweep(api, native_admission=True) == [
        "#7: native enqueue submitted (MQE-PR-node-7); merge_group and final protected release still unproven"
    ]
    assert ("remove_label", 7, ARM_LABEL) in api.actions
    assert ("enqueue", "PR-node-7", "head-7") in api.actions
    assert api.actions.index(("remove_label", 7, ARM_LABEL)) < api.actions.index(
        ("enqueue", "PR-node-7", "head-7")
    )
    assert sweep(api, native_admission=True) == []
    assert [a for a in api.actions if a[0] == "enqueue"] == [("enqueue", "PR-node-7", "head-7")]


def test_automatic_enqueue_failure_is_fenced_without_replay():
    api = FakeApi([pull()], queue_enabled=True)
    api.release_comments = lambda number: []
    api.native_enqueue_api = lambda: api
    def lost(*args):
        api.actions.append(("enqueue_lost", args))
        raise TimeoutError("unknown native queue outcome")
    api.enqueue = lost
    with pytest.raises(TimeoutError):
        sweep(api, native_admission=True)
    assert ("remove_label", 7, ARM_LABEL) in api.actions
    assert sweep(api, native_admission=True) == []
    assert len([a for a in api.actions if a[0] == "enqueue_lost"]) == 1


@pytest.mark.parametrize("blocked", ["body", "comment", "hold", "draft", "red"])
def test_native_automatic_enqueue_never_arms_blocked_candidate(blocked):
    candidate = pull(labels=[ARM_LABEL, "hold"] if blocked == "hold" else None,
                     draft=blocked == "draft")
    if blocked == "body":
        candidate["body"] = "HOLD: release review pending"
    comments = [{"body": "STOP: owner review pending"}] if blocked == "comment" else []
    api = FakeApi([candidate], queue_enabled=True,
                  runs={"head-7": checks(conclusion="failure")} if blocked == "red" else None)
    api.release_comments = lambda number: comments
    api.native_enqueue_api = lambda: api
    result = sweep(api, native_admission=True)
    assert not any(a[0] == "enqueue" for a in api.actions)
    assert ARM_LABEL in mog.label_names(api.pulls[7])


def test_native_automatic_enqueue_preflight_denial_has_no_effect():
    api = FakeApi([pull()], queue_enabled=True)
    api.release_comments = lambda number: []
    def refuse():
        raise ApiError(412, "native enrollment unavailable")
    api.native_enqueue_api = refuse
    assert "not qualified" in sweep(api, native_admission=True)[0]
    assert api.actions == []
    assert ARM_LABEL in mog.label_names(api.pulls[7])


def test_native_auto_admission_changed_head_withholds_without_effect():
    api = FakeApi([pull()], queue_enabled=True)
    api.release_comments = lambda number: []
    api.native_enqueue_api = lambda: api
    original = api.pull
    reads = [0]
    def moved(number):
        reads[0] += 1
        item = original(number)
        if reads[0] >= 2:
            item["head"]["sha"] = "different-head"
        return item
    api.pull = moved
    assert "source/hold changed" in sweep(api, native_admission=True)[0]
    assert api.actions == []
    assert ARM_LABEL in mog.label_names(api.pulls[7])


@pytest.mark.parametrize("text", [
    "HOLD: no merge", "- HOLD-FOR-SOL: not released", "DO NOT MERGE", "STOP -- critical",
])
def test_automatic_admission_hold_parser_is_fail_closed(text):
    assert mog.has_recorded_hold({"body": text}, [])
    assert mog.has_recorded_hold({"body": ""}, [{"body": text}])


def test_automatic_admission_has_no_unconditional_systemwide_mode():
    assert "NATIVE_QUEUE_AUTO_ADMIT" in Path(mog.__file__).read_text()
    assert "enrollment == \"canary\"" in Path(mog.__file__).read_text()
    assert "event_name == \"workflow_dispatch\"" in Path(mog.__file__).read_text()


def assert_privileged_controller_source(document):
    events = document.get("on", document.get(True))
    assert set(events) == {"workflow_run", "pull_request_target", "schedule", "workflow_dispatch"}
    assert events["workflow_run"] == {"workflows": ["CI"], "types": ["completed"]}
    assert events["pull_request_target"] == {"types": ["labeled", "reopened", "ready_for_review"]}
    assert events["schedule"] == [{"cron": "*/10 * * * *"}]
    checkout = document["jobs"]["sweep"]["steps"][0]
    assert checkout["uses"] == "actions/checkout@v4"
    assert checkout["with"]["ref"] == "${{ github.sha }}"
    assert checkout["with"]["sparse-checkout"] == "scripts/merge_on_green.py"
    assert checkout["with"]["sparse-checkout-cone-mode"] is False


def controller_source_document():
    return yaml.safe_load((Path(__file__).resolve().parents[1] / ".github/workflows/merge-on-green.yml").read_text())


def test_privileged_controller_pins_immutable_event_source():
    assert_privileged_controller_source(controller_source_document())


@pytest.mark.parametrize("ref", ["master", "${{ github.event.pull_request.head.sha }}", "${{ github.event.workflow_run.head_sha }}", ""])
def test_privileged_controller_rejects_mutable_or_untrusted_source(ref):
    document = controller_source_document()
    document["jobs"]["sweep"]["steps"][0]["with"]["ref"] = ref
    with pytest.raises(AssertionError):
        assert_privileged_controller_source(document)


def test_privileged_controller_rejects_candidate_event_and_sparse_expansion():
    document = controller_source_document()
    events = document.get("on", document.get(True))
    events["pull_request"] = events.pop("pull_request_target")
    with pytest.raises(AssertionError):
        assert_privileged_controller_source(document)
    document = controller_source_document()
    document["jobs"]["sweep"]["steps"][0]["with"]["sparse-checkout"] = "."
    with pytest.raises(AssertionError):
        assert_privileged_controller_source(document)



def evaluate_controller_job_gate(document, *, repository, ref, default_branch):
    # Evaluate the actual YAML expression over test-owned event context. This
    # small harness supports only the operators/functions used by this gate.
    expression = document["jobs"]["sweep"].get("if")
    assert isinstance(expression, str), "privileged job has no source gate"
    expression = expression.strip()
    assert expression.startswith("${{") and expression.endswith("}}")
    expression = expression[3:-2].strip()
    for name, value in {
        "github.event.repository.default_branch": default_branch,
        "github.repository": repository,
        "github.ref": ref,
    }.items():
        expression = expression.replace(name, repr(value))
    expression = expression.replace("&&", " and ").replace("||", " or ")
    return eval(expression, {"__builtins__": {}, "format": lambda pattern, value: pattern.format(value)})


@pytest.mark.parametrize("event,ref", [
    ("schedule", "refs/heads/master"),
    ("workflow_run", "refs/heads/master"),
    ("pull_request_target", "refs/heads/master"),
    ("workflow_dispatch", "refs/heads/master"),
])
def test_controller_job_gate_accepts_default_branch_events(event, ref):
    document = controller_source_document()
    events = document.get("on", document.get(True))
    assert event in events
    assert evaluate_controller_job_gate(document, repository="mastermindx-market-intelligence/mastermind-terminal", ref=ref, default_branch="master") is True
    assert document["jobs"]["sweep"]["steps"][0]["with"]["ref"] == "${{ github.sha }}"


@pytest.mark.parametrize("event,repository,ref,default_branch", [
    ("workflow_dispatch", "mastermindx-market-intelligence/mastermind-terminal", "refs/heads/feature", "master"),
    ("workflow_dispatch", "mastermindx-market-intelligence/mastermind-terminal", "refs/tags/master", "master"),
    ("pull_request_target", "mastermindx-market-intelligence/mastermind-terminal", "refs/heads/release", "master"),
    ("workflow_run", "mastermindx-market-intelligence/mastermind-terminal", "refs/heads/feature", "master"),
    ("schedule", "foreign/mastermind-terminal", "refs/heads/master", "master"),
    ("workflow_dispatch", "mastermindx-market-intelligence/mastermind-terminal", "refs/heads/master", "main"),
])
def test_controller_job_gate_rejects_untrusted_event_source(event, repository, ref, default_branch):
    document = controller_source_document()
    assert event in document.get("on", document.get(True))
    assert evaluate_controller_job_gate(document, repository=repository, ref=ref, default_branch=default_branch) is False


def test_controller_source_gate_cannot_be_moved_after_checkout():
    document = controller_source_document()
    expression = document["jobs"]["sweep"].pop("if", None)
    document["jobs"]["sweep"]["steps"][1]["if"] = expression
    with pytest.raises(AssertionError, match="no source gate"):
        evaluate_controller_job_gate(document, repository="mastermindx-market-intelligence/mastermind-terminal", ref="refs/heads/master", default_branch="master")
