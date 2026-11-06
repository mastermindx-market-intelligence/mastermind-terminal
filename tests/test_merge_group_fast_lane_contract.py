"""The native merge queue runs integrated fast checks, not duplicate browser matrices.

The full responsive and screenshot suites still run on each ordinary PR head.
Only the trusted GitHub merge_group event may skip those expensive repetitions.
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


def test_full_browser_matrix_only_skips_on_native_merge_group() -> None:
    all_jobs = jobs()
    e2e = all_jobs["terminal-e2e"]
    assert e2e["if"] == "github.event_name != 'merge_group'"
    assert e2e["strategy"]["fail-fast"] is False
    assert len(e2e["strategy"]["matrix"]["include"]) == 12
    assert any(
        "test:e2e:responsive -- ${{ matrix.projects }}" in str(step.get("run", ""))
        for step in e2e["steps"]
    )
    # None of the three independently required protected checks are gated.
    for job in ("hub", "python", "terminal-unit"):
        assert "if" not in all_jobs[job]


def test_only_original_browser_capture_steps_skip_on_merge_group() -> None:
    steps = jobs()["terminal-unit"]["steps"]
    by_name = {s["name"]: s for s in steps if "name" in s}
    assert by_name["Prepare Chromium for original mock captures"]["if"] == (
        "github.event_name != 'merge_group'"
    )
    assert by_name["Capture and validate evidence on this checkout"]["if"] == (
        "github.event_name != 'merge_group'"
    )
    for step in steps:
        command = str(step.get("run", ""))
        if "npx tsc --noEmit" in command or command.strip() == "npm test":
            assert "if" not in step, "typecheck and unit tests must run on native merge_group"
    assert "if" not in by_name["Plain-language guard self-check"]
    assert "if" not in by_name["Plain-language guard (forward-only, added lines block)"]


def test_required_aggregate_keeps_original_check_name_and_dependencies() -> None:
    aggregate = jobs()["terminal"]
    assert aggregate["name"] == "Terminal typecheck + tests"
    assert aggregate["if"] == "always()"
    assert set(aggregate["needs"]) == {"terminal-unit", "terminal-e2e"}
    step = aggregate["steps"][0]
    assert step["env"] == {
        "UNIT": "${{ needs.terminal-unit.result }}",
        "E2E": "${{ needs.terminal-e2e.result }}",
        "EVENT": "${{ github.event_name }}",
    }
    assert "Merge-group fast lane" in step["run"]


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
    command = jobs()["terminal"]["steps"][0]["run"]
    result = subprocess.run(
        ["bash", "-e", "-c", command],
        env={**os.environ, "EVENT": event, "UNIT": unit, "E2E": e2e},
        capture_output=True,
        text=True,
        check=False,
    )
    assert (result.returncode == 0) is should_pass, (
        event, unit, e2e, result.stdout, result.stderr
    )
