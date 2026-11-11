"""Bound unit evidence browser setup without hiding a missing browser.

Run the actual YAML shell under mocked installers: no package download or
scheduler behavior is simulated or claimed. Real capture remains the CI proof.
"""
from itertools import product
import os
from pathlib import Path
import re
import subprocess

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
PREPARE = "Prepare Chromium for original mock captures"
CAPTURE = "Capture and validate evidence on this checkout"


def _steps():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"))
    return workflow["jobs"]["terminal-unit"]["steps"]


def _prepare():
    return next(step for step in _steps() if step.get("name") == PREPARE)


def test_install_and_kill_grace_fit_inside_the_unchanged_step_budget():
    step = _prepare()
    budgets = re.findall(
        r"timeout --signal=TERM --kill-after=(\d+)s (\d+)s npx playwright install", step["run"]
    )
    assert len(budgets) == 2
    assert step["timeout-minutes"] == 10
    assert sum(int(grace) + int(duration) for grace, duration in budgets) < 600
    assert all(0 < int(grace) <= 15 and 0 < int(duration) <= 240 for grace, duration in budgets)


def test_real_capture_still_follows_install_and_is_not_optional_on_failure():
    steps = _steps()
    prepare_index = next(i for i, step in enumerate(steps) if step.get("name") == PREPARE)
    capture_index = next(i for i, step in enumerate(steps) if step.get("name") == CAPTURE)
    assert prepare_index < capture_index
    assert steps[capture_index]["run"] == "node e2e/tools/capture_ci_evidence.cjs"
    # Preserve the existing workflow budget for complete native evidence.
    assert steps[capture_index]["timeout-minutes"] == 85
    assert not steps[prepare_index].get("continue-on-error", False)
    assert not steps[capture_index].get("continue-on-error", False)
    assert "if" not in steps[prepare_index]
    assert steps[capture_index]["if"] == (
        "github.event_name != 'merge_group' || steps.evidence_plan.outputs.capture == 'true'"
    )
    f11_index = next(i for i, step in enumerate(steps)
                     if step.get("name") == "Capture provider-closed F11 theses entry on this checkout")
    unit_index = next(i for i, step in enumerate(steps) if step.get("run") == "npm test")
    assert prepare_index < capture_index < f11_index < unit_index
    f11 = steps[f11_index]
    assert "if" not in f11
    assert f11["run"] == "node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs"
    assert f11["timeout-minutes"] == 8
    assert not f11.get("continue-on-error", False)


def test_e18_current_source_capture_is_required_and_its_packet_is_retained():
    steps = _steps()
    index = {step["name"]: i for i, step in enumerate(steps) if "name" in step}
    capture_index = index["Capture current-source E18 alert-management evidence"]
    assert index[PREPARE] < capture_index < index[CAPTURE]
    capture = steps[capture_index]
    assert capture["run"] == "node e2e/tools/capture_e18_alert_management.cjs"
    assert capture["timeout-minutes"] == 8
    assert "if" not in capture
    assert not capture.get("continue-on-error", False)
    assert capture["env"] == {
        "TERMINAL_CROP_PORT": "47283",
        "TMPDIR": "${{ runner.temp }}/terminal-ci-evidence",
    }
    checkout_index = next(i for i, step in enumerate(steps)
                          if step.get("run") == "node e2e/tools/capture_ci_evidence.cjs --checkout-only")
    assert checkout_index < capture_index
    artifact = steps[index["Retain current-checkout mock evidence and failure diagnostics"]]
    assert artifact["if"] == "always()"
    assert "${{ runner.temp }}/terminal-ci-evidence/" in artifact["with"]["path"].splitlines()
    assert "terminal/docs/pr-crops/e18-alert-management/" in artifact["with"]["path"].splitlines()


MOCK_INSTALLERS = r'''
npx() { echo "UNBOUNDED_NPX"; return 99; }
timeout() {
  printf 'TIMEOUT %s\n' "$*"
  [ "$1" = "--signal=TERM" ] && [ "$2" = "--kill-after=15s" ] || return 98
  duration=$3
  shift 3
  [ "$1 $2 $3" = "npx playwright install" ] || return 97
  if [ "$duration" = "240s" ] && [ "${4-}" = "--with-deps" ] && [ "${5-}" = "chromium" ]; then
    return "$FULL_EXIT"
  fi
  if [ "$duration" = "180s" ] && [ "${4-}" = "chromium" ]; then
    return "$BROWSER_EXIT"
  fi
  return 96
}
'''


@pytest.mark.parametrize(("full_exit", "browser_exit"), list(product((0, 1, 124, 137), repeat=2)))
def test_real_install_shell_falls_back_once_and_preserves_failure(full_exit, browser_exit):
    script = MOCK_INSTALLERS + "\n" + _prepare()["run"] + "\necho REACHED_CAPTURE\n"
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "FULL_EXIT": str(full_exit),
        "BROWSER_EXIT": str(browser_exit),
    }
    result = subprocess.run(
        ["bash", "-e", "-c", script], env=env, capture_output=True, text=True, timeout=5
    )
    should_pass = full_exit == 0 or browser_exit == 0
    assert (result.returncode == 0) is should_pass, result.stdout + result.stderr
    assert ("REACHED_CAPTURE" in result.stdout) is should_pass
    assert "UNBOUNDED_NPX" not in result.stdout
    assert result.stdout.count("TIMEOUT ") == (1 if full_exit == 0 else 2)
    assert ("::warning::" in result.stdout) is (full_exit != 0)


# Cache-hit browser steps in the e2e and prodbuild jobs. A hosted runner whose
# Ubuntu mirror is unreachable must not fail the job before any test runs; the
# cached browser is kept and missing system libraries fail the tests visibly.
CACHE_HIT = "Ensure browser present on cache hit"

CACHE_HIT_MOCKS = r'''
npx() { echo "UNBOUNDED_NPX $*"; return "${UNBOUNDED_EXIT:-0}"; }
timeout() {
  printf 'TIMEOUT %s\n' "$*"
  [ "$1" = "--signal=TERM" ] && [ "$2" = "--kill-after=15s" ] || return 98
  duration=$3
  shift 3
  [ "$1 $2 $3" = "npx playwright install" ] || return 97
  if [ "$duration" = "240s" ] && [ "${4-}" = "--with-deps" ] && [ "${5-}" = "chromium" ]; then
    return "$FULL_EXIT"
  fi
  if [ "$duration" = "60s" ] && [ "${4-}" = "chromium" ] && [ -z "${5-}" ]; then
    return "$BROWSER_EXIT"
  fi
  return 96
}
'''


def _cache_hit_step(job, workflow_file="ci.yml"):
    workflow = yaml.safe_load((ROOT / ".github/workflows" / workflow_file).read_text(encoding="utf-8"))
    steps = [s for s in workflow["jobs"][job]["steps"] if s.get("name") == CACHE_HIT]
    assert len(steps) == 1, job
    return steps[0]


def _cache_hit_jobs():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"))
    return sorted(job for job, body in workflow["jobs"].items()
                  if any(s.get("name") == CACHE_HIT for s in body.get("steps", [])))


def test_every_cache_hit_step_is_covered_and_fits_its_budget():
    jobs = _cache_hit_jobs()
    assert len(jobs) == 2, jobs
    for job in jobs:
        step = _cache_hit_step(job)
        assert step["if"] == "steps.pwcache.outputs.cache-hit == 'true'"
        assert not step.get("continue-on-error", False)
        budgets = re.findall(
            r"timeout --signal=TERM --kill-after=(\d+)s (\d+)s npx playwright install", step["run"])
        assert len(budgets) == 2, job
        assert sum(int(g) + int(d) for g, d in budgets) < step["timeout-minutes"] * 60


@pytest.mark.parametrize("job", ["terminal-e2e", "terminal-e2e-prodbuild"])
@pytest.mark.parametrize(("full_exit", "browser_exit"), list(product((0, 100, 124, 137), (0, 1))))
def test_cache_hit_install_falls_back_to_browser_only_and_preserves_failure(job, full_exit, browser_exit):
    script = CACHE_HIT_MOCKS + "\n" + _cache_hit_step(job)["run"] + "\necho REACHED_TESTS\n"
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "FULL_EXIT": str(full_exit),
        "BROWSER_EXIT": str(browser_exit),
        "TERMINAL_E2E_LANE": "hosted",
    }
    result = subprocess.run(
        ["bash", "-e", "-c", script], env=env, capture_output=True, text=True, timeout=5)
    should_pass = full_exit == 0 or browser_exit == 0
    assert (result.returncode == 0) is should_pass, result.stdout + result.stderr
    assert ("REACHED_TESTS" in result.stdout) is should_pass
    assert "UNBOUNDED_NPX" not in result.stdout
    assert result.stdout.count("TIMEOUT ") == (1 if full_exit == 0 else 2)
    assert ("::warning::" in result.stdout) is (full_exit != 0)


def test_self_hosted_cache_hit_path_is_unchanged():
    script = CACHE_HIT_MOCKS + "\n" + _cache_hit_step("terminal-e2e")["run"] + "\necho REACHED_TESTS\n"
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "FULL_EXIT": "1",
           "BROWSER_EXIT": "1", "TERMINAL_E2E_LANE": "ubuntu0"}
    result = subprocess.run(
        ["bash", "-e", "-c", script], env=env, capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UNBOUNDED_NPX playwright install chromium" in result.stdout
    assert "TIMEOUT " not in result.stdout


def test_prodbuild_canary_cache_hit_step_matches_ci_exactly():
    # The canary documents that it mirrors the hosted e2e lane's browser steps.
    canary = yaml.safe_load(
        (ROOT / ".github/workflows/e2e-prodbuild-canary.yml").read_text(encoding="utf-8"))
    steps = [s for body in canary["jobs"].values() for s in body.get("steps", [])
             if s.get("name") == CACHE_HIT]
    assert len(steps) == 1
    ci_step = _cache_hit_step("terminal-e2e-prodbuild")
    assert steps[0]["run"] == ci_step["run"]
    assert steps[0]["timeout-minutes"] == ci_step["timeout-minutes"]
    assert steps[0]["if"] == ci_step["if"]
