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
    assert steps[capture_index]["timeout-minutes"] == 55
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
