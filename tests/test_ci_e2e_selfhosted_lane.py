"""The `terminal-e2e` matrix job carries a repository-variable-gated lane switch
(Mastermind #917, phase 9). These tests pin its safety contract:

* with the variable unset, the hosted job runs on the GitHub-hosted
  `ubuntu-24.04` image (never `ubuntu-latest`, which the fleet also carries),
  one worker and ports 3108 / 31991 / 31992;
* this unchanged workflow routes a fork pull_request to hosted runners,
  regardless of the variable; the runbook retains the separate host boundary;
* native merge-group jobs never route to the self-hosted pool: the job's accepted
  scope condition skips them even with the variable set to `selfhosted`;
* the hosted fallback is a literal, so a broken expression cannot land on the host,
  and a fallback label the fleet also carries is rejected;
* only the accepted protected selector's matrix.projects and matrix.specs fields
  are spliced into browser run blocks; lane values travel as env and are bound by
  .github/scripts/terminal_e2e_lane.sh, which rejects bad input, including the
  retired `ubuntu0` token.
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
LANE_CONDITION = f"(vars.TERMINAL_E2E_LANE == 'selfhosted' && {SAME_REPO_GUARD})"
HOST_LABELS = '["self-hosted","linux","x64","terminal-e2e"]'


def ci() -> dict[str, Any]:
    return yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))


def e2e_job() -> dict[str, Any]:
    return ci()["jobs"]["terminal-e2e"]


HOSTED_FALLBACK = "ubuntu-24.04"
# Labels the fleet runners also carry. A hosted fallback must never be one of these:
# with `run-on: ... || 'ubuntu-latest'` the fleet hosts accept the "hosted" shards,
# where the fixed port 3108 collides with a neighbouring slot and `--with-deps` apt
# stalls (measured 2026-11-10: 16/26 fleet shard jobs failed versus 11/273 hosted).
FLEET_MATCHING_RUNNER_LABELS = frozenset({"ubuntu-latest"})
RUNS_ON_FALLBACK = re.compile(r"\|\|\s*'([^']+)'\s*\}\}$")


def hosted_fallback(runs_on: str) -> str:
    match = RUNS_ON_FALLBACK.search(runs_on)
    assert match, f"runs-on has no literal hosted fallback: {runs_on!r}"
    return match.group(1)


def assert_hosted_fallback_is_fleet_exclusive(runs_on: str) -> None:
    fallback = hosted_fallback(runs_on)
    assert fallback not in FLEET_MATCHING_RUNNER_LABELS, (
        f"hosted fallback {fallback!r} is rejected: it matches fleet runners"
    )


EXPECTED_RUNS_ON = f"${{{{ {LANE_CONDITION} && fromJSON('{HOST_LABELS}') || '{HOSTED_FALLBACK}' }}}}"


def test_runs_on_is_exactly_the_gated_expression_with_literal_fallback() -> None:
    # Exact equality: a widened condition (e.g. `|| head.repo.fork`) or a split between
    # runs-on and the lane env would otherwise slip past substring checks.
    assert e2e_job()["runs-on"] == EXPECTED_RUNS_ON


def test_hosted_fallback_is_a_github_hosted_image_no_fleet_runner_carries() -> None:
    assert hosted_fallback(e2e_job()["runs-on"]) == HOSTED_FALLBACK
    assert_hosted_fallback_is_fleet_exclusive(e2e_job()["runs-on"])


def test_negative_ubuntu_latest_hosted_fallback_is_rejected() -> None:
    # The pre-2026-11-10 expression. It must fail the fleet-exclusivity check, or the
    # invariant has no negative test behind it: ubuntu-latest is rejected because it
    # matches fleet runners.
    prior = EXPECTED_RUNS_ON.replace(f"'{HOSTED_FALLBACK}'", "'ubuntu-latest'")
    with pytest.raises(AssertionError, match="it matches fleet runners"):
        assert_hosted_fallback_is_fleet_exclusive(prior)


def test_check_names_are_unchanged_on_both_lanes() -> None:
    jobs = ci()["jobs"]
    assert jobs["terminal-e2e"]["name"] == "Terminal e2e ${{ matrix.shard }} (shard)"
    assert "terminal" in jobs, "the frozen aggregator job must keep its name"
    assert "terminal-e2e" in jobs["terminal"]["needs"]


def test_merge_group_never_routes_to_the_selfhosted_pool() -> None:
    # The runs-on guard alone does not exclude a merge_group (event_name is not
    # pull_request there); the job's accepted scope condition does. A merge_group run
    # must be skipped outright, so it can never land on the self-hosted pool however
    # the variable is set.
    assert "github.event_name != 'merge_group'" in e2e_job()["if"]


def test_lane_env_mirrors_the_runs_on_condition() -> None:
    env = e2e_job()["env"]
    lane = env["TERMINAL_E2E_LANE"]
    assert lane == f"${{{{ {LANE_CONDITION} && 'selfhosted' || 'hosted' }}}}"
    assert env["TERMINAL_E2E_LANE_WORKERS"] == "${{ vars.TERMINAL_E2E_WORKERS }}"


def test_no_expression_inside_any_run_block_except_bound_matrix_fields() -> None:
    for step in e2e_job()["steps"]:
        run = step.get("run")
        if not run:
            continue
        for expr in re.findall(r"\$\{\{(.*?)\}\}", run):
            assert expr.strip() in {"matrix.projects", "matrix.specs"}, f"expression spliced into run block: {expr!r}"


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


# Host digits are scheme samples for the runner name ubuntu<H>-e2e-<N>: the tests pin
# the naming SCHEME (host digit + slot), not which hosts the lane happens to run on.
# Only host digit 0 additionally carries the one-release `ubuntu0-e2e` transition label.
HOST_DIGITS = ("0", "1", "2")


def lane_env(host: str, slot: int) -> dict[str, str]:
    return {"TERMINAL_E2E_LANE": "selfhosted", "RUNNER_NAME": f"ubuntu{host}-e2e-{slot}"}


@pytest.mark.parametrize("host", HOST_DIGITS)
@pytest.mark.parametrize("slot", [1, 3, 9])
def test_selfhosted_slot_binds_distinct_ports_and_default_workers(tmp_path: Path, host: str, slot: int) -> None:
    rc, out, _ = run_lane(lane_env(host, slot), tmp_path)
    assert rc == 0
    store = f"/home/ghrunner/.cache/ms-playwright-ubuntu{host}-e2e-{slot}"
    assert out == {
        "lane": "selfhosted",
        "workers": "4",
        "port": str(3200 + slot),
        "port_investor": str(32000 + 10 * slot + 1),
        "port_shared": str(32000 + 10 * slot + 2),
        "browsers_path": store,
        "cache_suffix": f"-ubuntu{host}-e2e-{slot}",
        "__github_env__": f"PLAYWRIGHT_BROWSERS_PATH={store}\n",
    }


def test_same_slot_on_different_hosts_shares_ports_but_not_cache_keys(tmp_path: Path) -> None:
    # The cross-host collision invariant. Ports derive from the slot number only, and
    # hosts never share a network namespace, so the same slot on different hosts reuses
    # the numbers by design. The Playwright store and cache suffix derive from the FULL
    # runner name, which is globally unique across the lane, so two hosts can never
    # collide on a shared repo cache entry: a suffix regression fails here before it
    # can poison the store.
    outs = [run_lane(lane_env(host, 4), tmp_path)[1] for host in HOST_DIGITS]
    for field in ("port", "port_investor", "port_shared"):
        assert len({out[field] for out in outs}) == 1, f"{field} must derive from the slot only"
    for field in ("browsers_path", "cache_suffix"):
        assert len({out[field] for out in outs}) == len(HOST_DIGITS), f"{field} must be per runner name"


def test_selfhosted_slot_ports_never_collide_across_slots(tmp_path: Path) -> None:
    seen: set[str] = set()
    for slot in range(1, 10):
        _, out, _ = run_lane(lane_env("0", slot), tmp_path)
        ports = {out["port"], out["port_investor"], out["port_shared"], out["browsers_path"], out["cache_suffix"]}
        assert len(ports) == 5 and not (ports & seen)
        seen |= ports


@pytest.mark.parametrize("workers", ["1", "8", "16"])
def test_selfhosted_workers_variable_is_honoured(tmp_path: Path, workers: str) -> None:
    rc, out, _ = run_lane({**lane_env("0", 2), "TERMINAL_E2E_LANE_WORKERS": workers}, tmp_path)
    assert rc == 0 and out["workers"] == workers


@pytest.mark.parametrize("workers", ["0", "17", "100", "-1", "4; rm -rf /", "four", "08", " 4"])
def test_selfhosted_rejects_bad_workers_and_writes_nothing(tmp_path: Path, workers: str) -> None:
    rc, out, err = run_lane({**lane_env("0", 2), "TERMINAL_E2E_LANE_WORKERS": workers}, tmp_path)
    assert rc == 2 and out == {} and "::error::" in err


@pytest.mark.parametrize(
    "runner",
    [
        "",
        "ubuntu0-canary-4",
        "ubuntu0-e2e-0",
        "ubuntu0-e2e-10",
        "ubuntu0-e2e-1;id",
        "GitHub Actions 7",
        "ubuntu-e2e-1",
        "ubuntu10-e2e-1",
        "terminal-e2e-2",
        "Ubuntu1-e2e-2",
    ],
)
def test_selfhosted_rejects_unslotted_runner_names(tmp_path: Path, runner: str) -> None:
    rc, out, err = run_lane({"TERMINAL_E2E_LANE": "selfhosted", "RUNNER_NAME": runner}, tmp_path)
    assert rc == 2 and out == {} and "ubuntuH-e2e-N" in err


@pytest.mark.parametrize("lane", ["ubuntu1", "ubuntu0"])
def test_unknown_lane_is_rejected(tmp_path: Path, lane: str) -> None:
    # `ubuntu0` is the RETIRED token: this script and the workflow always come from the
    # same commit, so a revision that still resolves it carries the old script too. The
    # new script must refuse it loudly — never half-activate a lane it cannot bind.
    rc, out, err = run_lane({"TERMINAL_E2E_LANE": lane}, tmp_path)
    assert rc == 2 and out == {} and "::error::" in err


def test_runbook_names_the_variable_labels_slots_and_rollback() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")
    for needle in (
        "TERMINAL_E2E_LANE",
        "TERMINAL_E2E_WORKERS",
        "selfhosted",
        "terminal-e2e",
        "ubuntuH-e2e-N",
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
