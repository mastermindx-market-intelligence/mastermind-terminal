"""The native merge queue runs integrated fast checks, not duplicate browser matrices.

The full responsive and screenshot suites still run on ordinary source PRs.
Native merge_group and independently qualified docs-only PRs may skip the browser
matrix; the browser selector remains mandatory in both cases.
The branch-protected Terminal aggregate must stay red if ANY of the checks
required for that event fail or are unexpectedly skipped.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml"


def jobs() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]


def aggregate_assertion_step() -> dict:
    return next(
        step for step in jobs()["terminal"]["steps"]
        if step.get("name") == "Assert all event-required Terminal checks passed"
    )


def test_full_browser_matrix_only_skips_for_qualified_event() -> None:
    all_jobs = jobs()
    e2e = all_jobs["terminal-e2e"]
    docs = (
        "github.event_name == 'pull_request' && needs.pr_scope.result == 'success' "
        "&& needs.pr_scope.outputs.mode == 'docs'"
    )
    assert e2e["if"] == (
        "${{ !cancelled() && needs.e2e-scope.result == 'success' "
        "&& github.event_name != 'merge_group' && !(" + docs + ") }}"
    )
    assert e2e["strategy"]["fail-fast"] is False
    from scripts.ci_e2e_scope import FULL_MATRIX
    assert len(FULL_MATRIX) == 17
    assert e2e["strategy"]["matrix"] == (
        chr(36) + "{{ fromJSON(needs.e2e-scope.outputs.matrix) }}"
    )
    assert e2e["needs"] == ["pr_scope", "e2e-scope"]
    assert any(
        "test:e2e:responsive -- ${{ matrix.projects }}" in str(step.get("run", ""))
        for step in e2e["steps"]
    )
    # Hub/python checks report on every uncancelled event, including docs PRs;
    # only the unit shard receives the explicitly qualified job-skip exemption.
    for job in ("hub", "python"):
        assert all_jobs[job]["if"] == "${{ !cancelled() }}"
    assert all_jobs["terminal"]["if"] == "always()"
    assert all_jobs["terminal-unit"]["if"] == (
        "${{ !cancelled() && needs.e2e-scope.result == 'success' && !(" + docs + ") }}"
    )


def test_pl6_vi_capture_is_selective_while_f11_keeps_its_browser_prerequisite() -> None:
    steps = jobs()["terminal-unit"]["steps"]
    by_name = {s["name"]: s for s in steps if "name" in s}
    condition = "github.event_name != 'merge_group' || steps.evidence_plan.outputs.capture == 'true'"
    assert "if" not in by_name["Prepare Chromium for original mock captures"]
    assert not by_name["Prepare Chromium for original mock captures"].get("continue-on-error", False)
    f11 = by_name["Capture provider-closed F11 theses entry on this checkout"]
    assert "if" not in f11
    assert f11["run"] == "node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs"
    assert f11["timeout-minutes"] == 8
    assert not f11.get("continue-on-error", False)
    assert by_name["Capture and validate evidence on this checkout"]["if"] == condition
    assert by_name["Plan current-source evidence capture"]["id"] == "evidence_plan"
    assert by_name["Plan current-source evidence capture"]["run"] == (
        "node scripts/ci/plan-evidence-capture.cjs"
    )
    synthetic = by_name["Check immutable evidence orchestration (synthetic)"]["run"]
    for name in (
        "scripts/ci/plan-evidence-capture.test.cjs",
        "e2e/tools/sharedShellSafeReporter.test.cjs",
        "e2e/tools/capture_b_f11_10_analysis_theses_entry.test.cjs",
        "e2e/tools/f11_provider_closed_policy.test.cjs",
    ):
        assert name in synthetic
    for step in steps:
        command = str(step.get("run", ""))
        if "npx tsc --noEmit" in command or command.strip() == "npm test":
            assert "if" not in step, "typecheck and unit tests must run on native merge_group"
    assert "if" not in by_name["Plain-language guard self-check"]
    assert "if" not in by_name["Plain-language guard (forward-only, added lines block)"]


def test_pr_time_evidence_drift_gate_feeds_the_planner() -> None:
    """Evidence-lock drift in a PR's own diff must fail the PR, not only the
    merge group: one workflow step records the PR-touched paths (from the
    synthetic merge commit's exact first parent), the unchanged planner step
    consumes EVIDENCE_PR_TOUCHED_FILE, and the recording step is ordered
    before it so the gate can never run on a stale environment."""
    steps = jobs()["terminal-unit"]["steps"]
    names = [s.get("name") for s in steps]
    record = next(
        s for s in steps if s.get("name") == "Record PR-touched paths for the evidence drift gate"
    )
    assert record["if"] == "github.event_name == 'pull_request'"
    run = record["run"]
    assert 'git diff --name-only --no-renames "${BASE}" HEAD' in run
    assert "git rev-parse HEAD^1" in run
    assert "EVIDENCE_PR_TOUCHED_FILE" in run and "GITHUB_ENV" in run
    assert names.index("Record PR-touched paths for the evidence drift gate") < names.index(
        "Plan current-source evidence capture"
    )
    # The merge-group backstop itself must remain byte-identical: the planner
    # step's command and both capture-skip conditions are pinned above.


def test_required_aggregate_keeps_original_check_name_and_dependencies() -> None:
    aggregate = jobs()["terminal"]
    assert aggregate["name"] == "Terminal typecheck + tests"
    assert aggregate["if"] == "always()"
    assert set(aggregate["needs"]) == {
        "pr_scope", "e2e-scope", "terminal-unit", "terminal-e2e"
    }
    step = aggregate_assertion_step()
    assert step["if"] == "${{ !cancelled() }}"
    assert step["env"] == {
        "SCOPE": chr(36) + "{{ needs.e2e-scope.result }}",
        "PR_SCOPE": "${{ needs.pr_scope.result }}",
        "PR_MODE": "${{ needs.pr_scope.outputs.mode }}",
        "UNIT": "${{ needs.terminal-unit.result }}",
        "E2E": "${{ needs.terminal-e2e.result }}",
        "EVENT": "${{ github.event_name }}",
    }
    assert "native merge group" in step["run"]
    assert 'if [ "$SCOPE" != "success" ]; then' in step["run"]


@pytest.mark.parametrize(
    ("event", "unit", "e2e", "should_pass"),
    [
        ("pull_request", "success", "success", True),
        ("pull_request", "success", "skipped", False),
        ("pull_request", "success", "failure", False),
        ("workflow_dispatch", "success", "skipped", False),
        ("merge_group", "success", "skipped", True),
        ("merge_group", "success", "success", True),
        ("merge_group", "success", "failure", False),
        ("merge_group", "success", "cancelled", False),
        ("merge_group", "skipped", "skipped", False),
        ("merge_group", "failure", "skipped", False),
    ],
)
def test_required_aggregate_refuses_missing_or_failed_event_checks(
    event: str, unit: str, e2e: str, should_pass: bool
) -> None:
    command = aggregate_assertion_step()["run"]
    result = subprocess.run(
        ["bash", "-e", "-c", command],
        env={**os.environ, "EVENT": event, "SCOPE": "success",
             "PR_SCOPE": "success", "PR_MODE": "full",
             "UNIT": unit, "E2E": e2e},
        capture_output=True,
        text=True,
        check=False,
    )
    assert (result.returncode == 0) is should_pass, (
        event, unit, e2e, result.stdout, result.stderr
    )


@pytest.mark.parametrize("scope_result", ["skipped", "failure", "cancelled", ""])
@pytest.mark.parametrize(("event", "e2e"), [
    ("pull_request", "success"), ("merge_group", "skipped")
])
def test_unqualified_scope_can_never_pass_event_aggregate(
    scope_result: str, event: str, e2e: str
) -> None:
    command = aggregate_assertion_step()["run"]
    result = subprocess.run(
        ["bash", "-e", "-c", command],
        env={**os.environ, "EVENT": event, "SCOPE": scope_result,
             "PR_SCOPE": "success", "PR_MODE": "full",
             "UNIT": "success", "E2E": e2e},
        capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0, (scope_result, event, result.stdout)
    assert "e2e-scope concluded" in result.stdout
