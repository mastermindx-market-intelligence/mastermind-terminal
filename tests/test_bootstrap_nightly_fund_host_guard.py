"""Host guard for ops/bootstrap_nightly_fund.sh — the fund lane installer runs only on M1.

On 2026-08-01 the bootstrap ran on M2 (no host check) and re-loaded com.mastermind.fund
there; M1 and M2 then both rsynced *.fund.json to the VPS nightly for ~11 weeks. The guard
must refuse every other host BEFORE ~/Library/LaunchAgents or launchctl is touched.

Every case stubs the host identity or runs on a non-lane host with a throwaway HOME and a
missing ops clone, so no case can install or load anything.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "ops" / "bootstrap_nightly_fund.sh"


def guard(host: str, **env: str) -> subprocess.CompletedProcess:
    """Source the script (which defines and returns), stub the host, call the guard."""
    program = '. "$1"; stub="$2"; fund_lane_host_id() { printf "%s\\n" "$stub"; }; require_fund_lane_host'
    clean = {k: v for k, v in os.environ.items() if k != "MM_FUND_BOOTSTRAP_ALLOW_HOST"}
    return subprocess.run(["bash", "-c", program, "guard-test", str(SCRIPT), host],
                          env={**clean, **env}, capture_output=True, text=True)


def test_lane_host_passes_silently():
    r = guard("m1studio")
    assert r.returncode == 0 and r.stderr == "", r.stderr


@pytest.mark.parametrize("host", ["m2studio", "", "m1studio-2", "M1STUDIO"])
def test_every_other_host_is_refused(host):
    r = guard(host)
    assert r.returncode == 3, r.stderr
    assert "REFUSED" in r.stderr and "rollback-groupB-to-M2.sh" in r.stderr


@pytest.mark.parametrize("value", ["0", "true", "yes", ""])
def test_override_requires_exactly_one(value):
    assert guard("m2studio", MM_FUND_BOOTSTRAP_ALLOW_HOST=value).returncode == 3


def test_override_admits_other_host_loudly():
    r = guard("m2studio", MM_FUND_BOOTSTRAP_ALLOW_HOST="1")
    assert r.returncode == 0 and "WARNING" in r.stderr and "m2studio" in r.stderr


def test_guard_runs_before_any_launchagents_or_launchctl_effect():
    lines = SCRIPT.read_text().splitlines()
    call = next(i for i, l in enumerate(lines) if l.startswith("require_fund_lane_host ||"))
    effects = [i for i, l in enumerate(lines)
               if re.match(r"\s*(/bin/mkdir|/usr/bin/mktemp|/usr/bin/install|/bin/mv|/bin/launchctl|TMP_PLIST=)", l)]
    assert effects and call < min(effects)
    # Also ahead of the ops-clone checks, so `--check` and a fresh host are refused too.
    clone_check = next(i for i, l in enumerate(lines) if "--is-inside-work-tree" in l)
    assert call < clone_check


def _real_host() -> str:
    r = subprocess.run(["bash", "-c", '. "$1"; fund_lane_host_id', "id", str(SCRIPT)],
                       capture_output=True, text=True)
    return r.stdout.strip()


@pytest.mark.parametrize("args", [[], ["--check"], ["--run-now"]])
def test_whole_script_refuses_off_the_lane_host_without_effects(tmp_path, args):
    if _real_host() == "m1studio":
        pytest.skip("on the fund lane host the guard admits; never exercise the installer there")
    env = {k: v for k, v in os.environ.items() if k != "MM_FUND_BOOTSTRAP_ALLOW_HOST"}
    env.update(HOME=str(tmp_path), MM_FUND_OPS_ROOT=str(tmp_path / "missing-ops-clone"))
    r = subprocess.run(["/bin/bash", str(SCRIPT), *args], env=env, capture_output=True, text=True)
    assert r.returncode == 3, (r.returncode, r.stderr)
    assert "REFUSED" in r.stderr and "Missing standalone ops clone" not in r.stderr
    assert not (tmp_path / "Library").exists()
