from __future__ import annotations

import re
from copy import deepcopy
from pathlib import Path
from typing import Any

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


class FakeApi:
    repo = "owner/repo"

    def __init__(self, pulls, runs=None, merge_errors=None):
        self.pulls = {item["number"]: deepcopy(item) for item in pulls}
        self.runs = runs or {item["head"]["sha"]: checks() for item in pulls}
        # number -> (status, message) to raise as ApiError instead of merging.
        self.merge_errors = merge_errors or {}
        self.actions = []

    def list_pulls(self):
        return [deepcopy(item) for item in self.pulls.values()]

    def pull(self, number):
        return deepcopy(self.pulls[number])

    def check_runs(self, sha):
        return deepcopy(self.runs.get(sha, []))

    def update_branch(self, number, head_sha):
        self.actions.append(("update", number, head_sha))

    def dispatch_ci(self, branch):
        self.actions.append(("dispatch_ci", branch))

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


def test_candidate_ci_explicitly_pins_read_only_contents_permission():
    workflow = ci_workflow()

    # Semantic parse, not byte position: reformatting this block or adding an
    # unrelated top-level key elsewhere in the file cannot defeat the check.
    assert workflow.get("permissions") == {"contents": "read"}
    # No candidate job may widen the top-level read-only grant.
    assert job_level_permissions(workflow) == {}


def test_job_level_permission_elevation_is_rejected_by_the_candidate_ci_guard():
    # Reviewer minor #3 on PR #487: the previous version of this test asserted
    # only the helper's return value, never that the guard itself (the same
    # `job_level_permissions(workflow) == {}` assertion used above in
    # test_candidate_ci_explicitly_pins_read_only_contents_permission) actually
    # FAILS when run against the mutant. Prove that here with pytest.raises,
    # mutation-testing style: the guard must kill this mutation, not merely
    # compute a value that happens to differ from it.
    workflow = ci_workflow()
    elevated = dict(workflow)
    elevated["jobs"] = dict(workflow["jobs"])
    elevated["jobs"]["probe"] = {
        "runs-on": "ubuntu-latest",
        "permissions": {"contents": "write"},
    }

    assert job_level_permissions(elevated) == {"probe": {"contents": "write"}}
    with pytest.raises(AssertionError):
        assert job_level_permissions(elevated) == {}


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
    api = FakeApi([pull(mergeable_state="behind")])
    result = sweep(api)
    assert ("update", 7, "head-7") in api.actions
    assert ("dispatch_ci", "claude/pr-7") in api.actions
    assert not any(action[0] == "merge" for action in api.actions)
    assert result == ["#7: updated onto current master; awaiting fresh CI"]


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
    assert ("dispatch_ci", "claude/pr-7") in api.actions
    assert not any(action[0] == "merge" for action in api.actions)
    assert result == ["#7: updated onto current master; awaiting fresh CI"]


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
    api = FakeApi(items)
    assert sweep(api) == []
    assert api.actions == []


def test_after_one_merge_the_next_stale_green_is_refreshed_not_merged():
    first = pull(1)
    second = pull(2, mergeable_state="behind")
    api = FakeApi([first, second])
    result = sweep(api)
    assert ("merge", 1, "head-1") in api.actions
    assert ("update", 2, "head-2") in api.actions
    assert ("dispatch_ci", "claude/pr-2") in api.actions
    assert ("merge", 2, "head-2") not in api.actions
    assert result == [
        "#1: merged and deleted claude/pr-1",
        "#2: updated onto current master; awaiting fresh CI",
    ]
