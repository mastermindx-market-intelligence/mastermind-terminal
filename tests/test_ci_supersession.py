"""Superseded CI must not lock the next head behind its required verdict.

Only expensive jobs share cancellation groups. The required final job remains
always-on and strict: skipped required checks can otherwise permit a merge.
These source/shell tests do not simulate GitHub's scheduler or prove latency.
"""
from copy import deepcopy
from itertools import product
import os
from pathlib import Path
import subprocess

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
LANES = ("hub", "terminal-unit", "terminal-e2e", "python", "investigation-postgres")
PREFIX = "terminal-ci-${{ github.event.pull_request.number || github.ref }}-"
RESULTS = ("success", "failure", "cancelled", "skipped", "timed_out", "unknown", "")


def _workflow():
    return yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"))


def _errors(workflow):
    errors = []
    if "concurrency" in workflow:
        errors.append("whole-workflow-lock")
    for lane in LANES:
        expected = PREFIX + lane
        if lane == "terminal-e2e":
            expected += "-${{ matrix.shard }}"
        config = workflow["jobs"][lane].get("concurrency", {})
        if config.get("group") != expected:
            errors.append("group:" + lane)
        if config.get("cancel-in-progress") is not True:
            errors.append("cancel:" + lane)
    gate = workflow["jobs"]["terminal"]
    if "concurrency" in gate:
        errors.append("verdict-lock")
    if gate.get("if") != "always()":
        errors.append("verdict-may-skip")
    if gate.get("name") != "Terminal typecheck + tests":
        errors.append("required-name")
    if not {"terminal-unit", "terminal-e2e"} <= set(gate.get("needs", [])):
        errors.append("required-inputs")
    return errors


def _keys(workflow, shards):
    keys = []
    for lane in LANES:
        group = workflow["jobs"][lane]["concurrency"]["group"]
        if lane == "terminal-e2e":
            keys.extend(group.replace("${{ matrix.shard }}", shard) for shard in shards)
        else:
            keys.append(group)
    return keys


def test_new_head_is_not_locked_behind_the_previous_verdict():
    assert _errors(_workflow()) == []


def test_shard_identity_separates_e2e_keys_from_other_jobs():
    # This guards key separation, not matrix coverage. The existing browser
    # coverage tests own actual static or dynamically selected project coverage.
    keys = _keys(_workflow(), ("desktop-1", "desktop-2", "mobile-1", "serial"))
    assert len(keys) == len(set(keys))


def test_dynamic_matrix_does_not_change_the_supersession_contract():
    workflow = deepcopy(_workflow())
    workflow["jobs"]["terminal-e2e"]["strategy"]["matrix"] = (
        "${{ fromJSON(needs.e2e-scope.outputs.matrix) }}"
    )
    assert _errors(workflow) == []
    keys = _keys(workflow, ("desktop-1", "mobile-1"))
    assert len(keys) == len(set(keys))


@pytest.mark.parametrize("lane", LANES)
def test_disabled_supersession_is_detected(lane):
    workflow = deepcopy(_workflow())
    workflow["jobs"][lane]["concurrency"]["cancel-in-progress"] = False
    assert "cancel:" + lane in _errors(workflow)


def test_matrix_key_without_shard_identity_is_detected():
    workflow = deepcopy(_workflow())
    workflow["jobs"]["terminal-e2e"]["concurrency"]["group"] = PREFIX + "terminal-e2e"
    assert "group:terminal-e2e" in _errors(workflow)


@pytest.mark.parametrize("mutation", ("workflow-lock", "verdict-lock", "skip-verdict"))
def test_blocking_or_false_green_mutations_are_detected(mutation):
    workflow = deepcopy(_workflow())
    if mutation == "workflow-lock":
        workflow["concurrency"] = {"group": "ci-test", "cancel-in-progress": True}
        expected = "whole-workflow-lock"
    elif mutation == "verdict-lock":
        workflow["jobs"]["terminal"]["concurrency"] = {"group": "ci-verdict"}
        expected = "verdict-lock"
    else:
        workflow["jobs"]["terminal"]["if"] = "${{ !cancelled() }}"
        expected = "verdict-may-skip"
    assert expected in _errors(workflow)


@pytest.mark.parametrize(("unit", "e2e"), list(product(RESULTS, repeat=2)))
def test_real_required_gate_rejects_every_incomplete_pr_result(unit, e2e):
    gate = _workflow()["jobs"]["terminal"]
    step = next(step for step in gate["steps"] if step.get("name") == "Assert all event-required Terminal checks passed")
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "SCOPE": "success", "PR_SCOPE": "success", "PR_MODE": "full",
        "UNIT": unit, "E2E": e2e, "EVENT": "pull_request",
    }
    assert set(step["env"]) == {"SCOPE", "PR_SCOPE", "PR_MODE", "UNIT", "E2E", "EVENT"}
    result = subprocess.run(
        ["bash", "-e", "-c", step["run"]], env=env, capture_output=True, text=True, timeout=5
    )
    assert (result.returncode == 0) is (unit == e2e == "success"), result.stdout + result.stderr
