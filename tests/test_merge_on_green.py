from __future__ import annotations

import re
from copy import deepcopy
from pathlib import Path

from scripts.merge_on_green import (
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


def pull(number: int = 7, *, labels=None, mergeable=True, draft=False, fork=False):
    selected_labels = [ARM_LABEL] if labels is None else labels
    return {
        "number": number,
        "created_at": f"2026-08-{number:02d}T00:00:00Z",
        "draft": draft,
        "mergeable": mergeable,
        "mergeable_state": "clean" if mergeable else "dirty",
        "labels": [{"name": name} for name in selected_labels],
        "base": {"ref": "master", "sha": "base-sha"},
        "head": {
            "ref": f"claude/pr-{number}",
            "sha": f"head-{number}",
            "repo": {"full_name": "owner/repo" if not fork else "fork/repo"},
        },
    }


class FakeApi:
    repo = "owner/repo"

    def __init__(self, pulls, runs=None, relations=None):
        self.pulls = {item["number"]: deepcopy(item) for item in pulls}
        self.runs = runs or {item["head"]["sha"]: checks() for item in pulls}
        self.relations = relations or {item["number"]: "ahead" for item in pulls}
        self.actions = []

    def list_pulls(self):
        return [deepcopy(item) for item in self.pulls.values()]

    def pull(self, number):
        return deepcopy(self.pulls[number])

    def check_runs(self, sha):
        return deepcopy(self.runs.get(sha, []))

    def compare(self, base_sha, head_sha):
        number = int(head_sha.rsplit("-", 1)[1])
        self.actions.append(("compare", number, base_sha, head_sha))
        return self.relations[number]

    def update_branch(self, number, head_sha):
        self.actions.append(("update", number, head_sha))

    def dispatch_ci(self, branch):
        self.actions.append(("dispatch_ci", branch))

    def merge(self, number, head_sha):
        self.actions.append(("merge", number, head_sha))
        return {"merged": True}

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


JOB_LEVEL_PERMISSIONS = re.compile(r"(?m)^[ \t]+permissions:")


def ci_workflow_text() -> str:
    return (
        Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml"
    ).read_text(encoding="utf-8")


def test_candidate_ci_explicitly_pins_read_only_contents_permission():
    workflow = ci_workflow_text()
    pre_jobs, separator, _ = workflow.partition("\njobs:\n")

    assert separator, "ci.yml must retain one top-level jobs mapping"
    assert "\npermissions:\n  contents: read\n" in pre_jobs
    assert workflow.count("\npermissions:\n") == 1
    # That count only matches a column-0 key, so an indented job-level block is
    # invisible to it. No candidate job may widen the top-level read-only grant.
    assert JOB_LEVEL_PERMISSIONS.search(workflow) is None


def test_job_level_permission_elevation_is_rejected_by_the_candidate_ci_guard():
    # The guard must kill the forbidden mutation, not merely pass on today's file.
    head, separator, jobs = ci_workflow_text().partition("\njobs:\n")
    assert separator, "ci.yml must retain one top-level jobs mapping"
    elevated = f"{head}{separator}  probe:\n    permissions:\n      contents: write\n{jobs}"

    # The pre-existing column-0 count is blind to the elevation ...
    assert elevated.count("\npermissions:\n") == 1
    # ... the indent-aware guard is not.
    assert JOB_LEVEL_PERMISSIONS.search(elevated) is not None


def test_green_current_head_is_sha_pinned_merged_and_deleted():
    api = FakeApi([pull()])
    result = sweep(api)
    assert ("merge", 7, "head-7") in api.actions
    assert ("delete", "claude/pr-7") in api.actions
    assert result[0] == "#7: merged and deleted claude/pr-7"


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


def test_green_stale_head_is_updated_then_waits_for_fresh_ci():
    api = FakeApi([pull()], relations={7: "diverged"})
    result = sweep(api)
    assert ("update", 7, "head-7") in api.actions
    assert ("dispatch_ci", "claude/pr-7") in api.actions
    assert not any(action[0] == "merge" for action in api.actions)
    assert result == ["#7: updated onto current master; awaiting fresh CI"]


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
    api = FakeApi(items)
    assert sweep(api) == []
    assert api.actions == []


def test_after_one_merge_the_next_stale_green_is_refreshed_not_merged():
    first = pull(1)
    second = pull(2)
    api = FakeApi([first, second], relations={1: "ahead", 2: "diverged"})
    result = sweep(api)
    assert ("merge", 1, "head-1") in api.actions
    assert ("update", 2, "head-2") in api.actions
    assert ("dispatch_ci", "claude/pr-2") in api.actions
    assert ("merge", 2, "head-2") not in api.actions
    assert result == [
        "#1: merged and deleted claude/pr-1",
        "#2: updated onto current master; awaiting fresh CI",
    ]
