"""The `terminal-e2e` matrix job carries a repository-variable-gated lane switch
(Mastermind #917, phase 9). These tests pin its safety contract:

* with the variable unset the job is byte-for-byte the hosted job it was before
  (ubuntu-latest, one worker, ports 3108 / 31991 / 31992);
* a `pull_request` from a fork never reaches the self-hosted host, whatever the
  variable says (public repository);
* the hosted fallback is a literal, so a broken expression cannot land on the host;
* no workflow expression is spliced into a `run:` block (lane values travel as env
  and are bound by .github/scripts/terminal_e2e_lane.sh, which rejects bad input).
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
LANE_SCRIPT = ROOT / ".github" / "scripts" / "terminal_e2e_lane.sh"
RUNBOOK = ROOT / "docs" / "CI_TERMINAL_E2E_SELFHOSTED_LANE.md"

SAME_REPO_GUARD = (
    "(github.event_name != 'pull_request' "
    "|| github.event.pull_request.head.repo.full_name == github.repository)"
)
LANE_CONDITION = f"(vars.TERMINAL_E2E_LANE == 'ubuntu0' && {SAME_REPO_GUARD})"
HOST_LABELS = '["self-hosted","linux","x64","ubuntu0-e2e"]'


def ci() -> dict[str, Any]:
    return yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))


def e2e_job() -> dict[str, Any]:
    return ci()["jobs"]["terminal-e2e"]


EXPECTED_RUNS_ON = f"${{{{ {LANE_CONDITION} && fromJSON('{HOST_LABELS}') || 'ubuntu-latest' }}}}"


def test_runs_on_is_exactly_the_gated_expression_with_literal_fallback() -> None:
    # Exact equality: a widened condition (e.g. `|| head.repo.fork`) or a split between
    # runs-on and the lane env would otherwise slip past substring checks.
    assert e2e_job()["runs-on"] == EXPECTED_RUNS_ON


def test_check_names_are_unchanged_on_both_lanes() -> None:
    jobs = ci()["jobs"]
    assert jobs["terminal-e2e"]["name"] == "Terminal e2e ${{ matrix.shard }} (shard)"
    assert "terminal" in jobs, "the frozen aggregator job must keep its name"
    assert "terminal-e2e" in jobs["terminal"]["needs"]


def test_lane_env_mirrors_the_runs_on_condition() -> None:
    env = e2e_job()["env"]
    lane = env["TERMINAL_E2E_LANE"]
    assert lane == f"${{{{ {LANE_CONDITION} && 'ubuntu0' || 'hosted' }}}}"
    assert env["TERMINAL_E2E_LANE_WORKERS"] == "${{ vars.TERMINAL_E2E_WORKERS }}"


def test_no_expression_inside_any_run_block_except_matrix_projects() -> None:
    for step in e2e_job()["steps"]:
        run = step.get("run")
        if not run:
            continue
        for expr in re.findall(r"\$\{\{(.*?)\}\}", run):
            assert expr.strip() == "matrix.projects", f"expression spliced into run block: {expr!r}"


def test_playwright_cache_is_bound_per_lane() -> None:
    cache = next(s for s in e2e_job()["steps"] if s.get("id") == "pwcache")
    assert cache["with"]["path"] == "${{ steps.lane.outputs.browsers_path }}"
    assert cache["with"]["key"] == "pw-${{ runner.os }}-${{ steps.pw.outputs.version }}${{ steps.lane.outputs.cache_suffix }}"


def test_lane_bind_step_precedes_node_setup_and_feeds_the_test_steps() -> None:
    steps = e2e_job()["steps"]
    names = [s.get("name") or s.get("uses") or s.get("run", "")[:30] for s in steps]
    bind = next(i for i, s in enumerate(steps) if s.get("id") == "lane")
    assert steps[bind]["run"] == "bash ../.github/scripts/terminal_e2e_lane.sh"
    assert names[bind - 1] == "actions/checkout@v4"
    main = next(s for s in steps if str(s.get("run", "")).startswith("npm run test:e2e:responsive -- ${{ matrix.projects }}"))
    assert main["run"].endswith('--workers="$TERMINAL_E2E_WORKERS"')
    assert main["env"]["TERMINAL_E2E_PORT"] == "${{ steps.lane.outputs.port }}"
    assert main["env"]["TERMINAL_E2E_WORKERS"] == "${{ steps.lane.outputs.workers }}"
    investor = next(s for s in steps if s.get("name") == "Qualify investor shell opt-in")
    shared = next(s for s in steps if s.get("name") == "Qualify Shared Shell beta presentation")
    assert investor["env"]["TERMINAL_E2E_PORT"] == "${{ steps.lane.outputs.port_investor }}"
    assert shared["env"]["TERMINAL_E2E_PORT"] == "${{ steps.lane.outputs.port_shared }}"
    for serial in (investor, shared):
        assert "--workers=1" in serial["run"], "serial opt-ins stay single-worker on every lane"


def run_lane(env_overrides: dict[str, str], tmp_path: Path) -> tuple[int, dict[str, str], str]:
    out = tmp_path / "github_output"
    out.write_text("", encoding="utf-8")
    github_env = tmp_path / "github_env"
    github_env.write_text("", encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if not k.startswith("TERMINAL_E2E_") and k != "RUNNER_NAME"}
    env.update({"GITHUB_OUTPUT": str(out), "GITHUB_ENV": str(github_env), "HOME": "/home/ghrunner", **env_overrides})
    proc = subprocess.run(["bash", str(LANE_SCRIPT)], env=env, capture_output=True, text=True, timeout=30)
    parsed = dict(line.split("=", 1) for line in out.read_text(encoding="utf-8").splitlines() if "=" in line)
    exported = github_env.read_text(encoding="utf-8")
    if exported:
        parsed["__github_env__"] = exported
    return proc.returncode, parsed, proc.stderr


HOSTED = {
    "lane": "hosted",
    "workers": "1",
    "port": "3108",
    "port_investor": "31991",
    "port_shared": "31992",
    "browsers_path": "~/.cache/ms-playwright",
    "cache_suffix": "",
}


def test_script_is_executable_and_strict() -> None:
    assert os.access(LANE_SCRIPT, os.X_OK)
    assert "set -euo pipefail" in LANE_SCRIPT.read_text(encoding="utf-8")


def test_hosted_lane_is_todays_behaviour(tmp_path: Path) -> None:
    rc, out, _ = run_lane({}, tmp_path)
    assert rc == 0
    assert out == HOSTED, "hosted lane must reproduce today's literal values and export nothing to GITHUB_ENV"
    # The hosted lane ignores the workers variable: today's hosted job runs one worker.
    rc, out2, _ = run_lane({"TERMINAL_E2E_LANE": "hosted", "TERMINAL_E2E_LANE_WORKERS": "8"}, tmp_path)
    assert rc == 0 and out2 == out


@pytest.mark.parametrize("slot", [1, 3, 9])
def test_ubuntu0_slot_binds_distinct_ports_and_default_workers(tmp_path: Path, slot: int) -> None:
    rc, out, _ = run_lane({"TERMINAL_E2E_LANE": "ubuntu0", "RUNNER_NAME": f"ubuntu0-e2e-{slot}"}, tmp_path)
    assert rc == 0
    store = f"/home/ghrunner/.cache/ms-playwright-ubuntu0-e2e-{slot}"
    assert out == {
        "lane": "ubuntu0",
        "workers": "4",
        "port": str(3200 + slot),
        "port_investor": str(32000 + 10 * slot + 1),
        "port_shared": str(32000 + 10 * slot + 2),
        "browsers_path": store,
        "cache_suffix": f"-ubuntu0-e2e-{slot}",
        "__github_env__": f"PLAYWRIGHT_BROWSERS_PATH={store}\n",
    }


def test_ubuntu0_slot_ports_never_collide_across_slots(tmp_path: Path) -> None:
    seen: set[str] = set()
    for slot in range(1, 10):
        _, out, _ = run_lane({"TERMINAL_E2E_LANE": "ubuntu0", "RUNNER_NAME": f"ubuntu0-e2e-{slot}"}, tmp_path)
        ports = {out["port"], out["port_investor"], out["port_shared"], out["browsers_path"], out["cache_suffix"]}
        assert len(ports) == 5 and not (ports & seen)
        seen |= ports


@pytest.mark.parametrize("workers", ["1", "8", "16"])
def test_ubuntu0_workers_variable_is_honoured(tmp_path: Path, workers: str) -> None:
    rc, out, _ = run_lane(
        {"TERMINAL_E2E_LANE": "ubuntu0", "RUNNER_NAME": "ubuntu0-e2e-2", "TERMINAL_E2E_LANE_WORKERS": workers}, tmp_path
    )
    assert rc == 0 and out["workers"] == workers


@pytest.mark.parametrize("workers", ["0", "17", "100", "-1", "4; rm -rf /", "four", "08", " 4"])
def test_ubuntu0_rejects_bad_workers_and_writes_nothing(tmp_path: Path, workers: str) -> None:
    rc, out, err = run_lane(
        {"TERMINAL_E2E_LANE": "ubuntu0", "RUNNER_NAME": "ubuntu0-e2e-2", "TERMINAL_E2E_LANE_WORKERS": workers}, tmp_path
    )
    assert rc == 2 and out == {} and "::error::" in err


@pytest.mark.parametrize("runner", ["", "ubuntu0-canary-4", "ubuntu0-e2e-0", "ubuntu0-e2e-10", "ubuntu0-e2e-1;id", "GitHub Actions 7"])
def test_ubuntu0_rejects_unslotted_runner_names(tmp_path: Path, runner: str) -> None:
    rc, out, err = run_lane({"TERMINAL_E2E_LANE": "ubuntu0", "RUNNER_NAME": runner}, tmp_path)
    assert rc == 2 and out == {} and "ubuntu0-e2e-N" in err


def test_unknown_lane_is_rejected(tmp_path: Path) -> None:
    rc, out, err = run_lane({"TERMINAL_E2E_LANE": "ubuntu1"}, tmp_path)
    assert rc == 2 and out == {} and "::error::" in err


def test_runbook_names_the_variable_labels_slots_and_rollback() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")
    for needle in (
        "TERMINAL_E2E_LANE",
        "TERMINAL_E2E_WORKERS",
        "ubuntu0-e2e-N",
        "ubuntu0-e2e",
        "42029519496",
        "rollback",
        "generate-jitconfig",
        "hidepid=2",
        "ghrunner-N",
        "routing only",
        "svc.sh stop",
        "PLAYWRIGHT_BROWSERS_PATH",
    ):
        assert needle in text, needle
