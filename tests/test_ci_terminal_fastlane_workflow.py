"""Terminal risk-tiered CI contract: real shell gate and hostile conditionals."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def jobs():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]


def gate(env):
    script = jobs()["terminal"]["steps"][0]["run"]
    result = subprocess.run(["bash", "-e", "-c", script], env={
        **os.environ, **env,
    }, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
    return result.returncode, result.stdout + result.stderr


def args(*, event="pull_request", scope="success", mode="passive",
         unit="success", e2e="skipped", visual="skipped"):
    return {
        "EVENT": event, "SCOPE": scope, "MODE": mode,
        "UNIT": unit, "E2E": e2e, "VISUAL": visual,
    }


def test_required_three_protected_contexts_retain_exact_names():
    j = jobs()
    assert j["hub"]["name"] == "Quote Hub tests"
    assert j["terminal"]["name"] == "Terminal typecheck + tests"
    assert j["python"]["name"] == "Ingest + signal-layer tests"
    assert j["terminal"]["if"] == "always()"
    assert j["terminal"]["needs"] == [
        "pr_scope", "pr_visual_smoke", "terminal-unit", "terminal-e2e",
    ]
    assert j["terminal-e2e"]["strategy"]["fail-fast"] is False


def test_selector_loaded_from_protected_base_never_pr_owned_source():
    j = jobs()
    scope = j["pr_scope"]
    assert scope["name"] == "Terminal PR risk scope"
    assert scope["if"] == "${{ github.event_name == 'pull_request' }}"
    assert scope["timeout-minutes"] == 3
    assert scope["steps"][0]["with"] == {
        "fetch-depth": 0, "persist-credentials": False,
    }
    code = scope["steps"][1]["run"]
    assert 'git archive "$PR_BASE_SHA" scripts/ci_terminal_pr_scope.py' in code
    assert 'python "$trusted/scripts/ci_terminal_pr_scope.py"' in code
    assert 'mode=full' in code
    assert "github.event.pull_request.base.sha" in str(scope["steps"][1]["env"])


def test_bootstrap_when_base_selector_missing_is_real_full_not_literal_backslash_n(tmp_path):
    code = jobs()["pr_scope"]["steps"][1]["run"]
    fallback = [
        x.strip() for x in code.splitlines()
        if x.strip().startswith("printf 'mode=full")
    ]
    assert len(fallback) == 1
    path = tmp_path / "out"
    result = subprocess.run(["bash", "-e", "-c", fallback[0]], env={
        **os.environ, "GITHUB_OUTPUT": str(path),
    }, timeout=5, capture_output=True, text=True)
    assert result.returncode == 0
    assert path.read_text().splitlines() == ["mode=full"]


def test_all_heavy_jobs_run_on_merge_groups_and_unknown_pr():
    j = jobs()
    for name in ("terminal-unit", "terminal-e2e", "python", "investigation-postgres"):
        job = j[name]
        assert job["needs"] == ["pr_scope"]
        cond = job["if"]
        assert "always()" in cond
        assert "github.event_name != 'pull_request'" in cond
    assert "needs.pr_scope.outputs.mode == 'full'" in j["terminal-e2e"]["if"]
    assert "needs.pr_scope.outputs.mode == 'full'" in j["investigation-postgres"]["if"]
    unit_steps = {s.get("name"): s for s in j["terminal-unit"]["steps"]}
    for name in (
        "Prepare Chromium for original mock captures",
        "Capture and validate evidence on this checkout",
    ):
        assert "needs.pr_scope.outputs.mode == 'full'" in unit_steps[name]["if"]
    assert j["terminal-e2e"]["strategy"]["matrix"]["include"]


def test_visual_smoke_runs_real_three_contract_viewports():
    j = jobs()["pr_visual_smoke"]
    assert j["needs"] == ["pr_scope"]
    assert j["timeout-minutes"] <= 15
    assert "needs.pr_scope.outputs.mode == 'visual'" in j["if"]
    browser = next(s for s in j["steps"] if s.get("name") == "Require responsive shell across all supported widths")
    code = browser["run"]
    assert "test:e2e:responsive" in code
    assert "e2e/responsive.spec.ts" in code
    for mode in ("desktop", "tablet", "mobile"):
        assert "--project=" + mode in code
    assert "--grep=" in code and "--retries=0" in code


def test_ingest_heavy_dependencies_are_absent_only_for_trusted_short_scope():
    steps = jobs()["python"]["steps"]
    assert steps[0]["uses"] == "actions/checkout@v4"
    scoped = steps[1]
    assert "scope.outputs.mode != 'full'" in scoped["if"]
    assert "passive|visual" in scoped["run"]
    for step in steps[2:]:
        assert "scope.outputs.mode == 'full'" in step["if"], step


@pytest.mark.parametrize("state", [
    args(),
    args(mode="visual", visual="success"),
    args(mode="full", e2e="success"),
    args(event="merge_group", scope="skipped", mode="", e2e="success"),
    args(event="workflow_dispatch", scope="skipped", mode="", e2e="success"),
])
def test_valid_qualification_only_passes_exact_proven_gates(state):
    rc, message = gate(state)
    assert rc == 0, message


@pytest.mark.parametrize("state", [
    args(scope="failure"),
    args(scope="skipped"),
    args(mode="other"),
    args(mode=""),
    args(unit="skipped"),
    args(mode="passive", e2e="success"),
    args(mode="visual", visual="failed"),
    args(mode="visual", visual="skipped"),
    args(mode="visual", e2e="success", visual="success"),
    args(mode="full", e2e="failure"),
    args(mode="full", e2e="skipped"),
    args(event="merge_group", scope="skipped", mode="", e2e="skipped"),
    args(event="workflow_dispatch", scope="skipped", mode="", e2e="failed"),
])
def test_unqualified_or_incomplete_full_suite_never_green(state):
    rc, _ = gate(state)
    assert rc != 0
