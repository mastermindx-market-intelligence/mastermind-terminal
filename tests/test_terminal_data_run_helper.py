"""ops/terminal-data `run()` helper: the WARN line must carry the worker's real exit code.

The pre-fix helper expanded ``$?`` after a ``$(ts)`` command substitution inside the same
echo, so every WARN line logged ``exited 0`` whatever the step returned (measured on the
VPS 2026-10-03 22:10:54Z: a worker that exits 2 was logged as ``exited 0``). Receipts that
quoted the wrapper's status were therefore evidence of nothing.

This test runs the helper AS IT EXISTS in ops/terminal-data (extracted by regex, never
transcribed) under bash with an inert ``ts`` and an inert fake worker — no external
commands, no ``date``, no network, PATH deliberately empty — and pins: the logged code
equals the worker's code; success logs no WARN; the wrapper stays best-effort (returns 0
and the next step still runs); the worker runs exactly once with its arguments preserved.
A final case runs the pre-fix helper text through the same harness to prove the harness
would have rejected it.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "ops" / "terminal-data"
RUN_LINE = re.compile(r"^run\(\)\{.*\}$", re.MULTILINE)
TS = "2000-01-01 00:00:00"
PRE_FIX_HELPER = '''run(){ echo "[$(ts)] -> $*"; "$@" || echo "[$(ts)] WARN: '$*' exited $?"; }'''

HARNESS = r"""
set -u
status=$1; shift
calls=0; later=0
ts(){ printf '%s' '2000-01-01 00:00:00'; }
fake_worker(){ calls=$((calls+1)); printf 'ARG:%s\n' "$@" >&2; return "$status"; }
later_step(){ later=$((later+1)); }
__RUN_HELPER__
run fake_worker "$@"
wrapper=$?
later_step
printf 'SUMMARY wrapper=%s calls=%s later=%s\n' "$wrapper" "$calls" "$later" >&2
"""

ARGS = ["plain", "two words", "-n", "$(marker)", "*?[abc]"]


def helper_line() -> str:
    matches = RUN_LINE.findall(SOURCE.read_text(encoding="utf-8"))
    assert len(matches) == 1, matches
    return matches[0]


def run_helper(helper: str, status: int, args: list[str]) -> tuple[str, dict[str, int], list[str]]:
    bash = shutil.which("bash")
    assert bash, "bash is required for this test"
    script = HARNESS.replace("__RUN_HELPER__", helper)
    completed = subprocess.run(
        [bash, "--noprofile", "--norc", "-c", script, "run-helper-test", str(status), *args],
        env={"PATH": "/nonexistent", "LC_ALL": "C"},
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert completed.returncode == 0, completed.stderr
    received = [line[4:] for line in completed.stderr.splitlines() if line.startswith("ARG:")]
    summary_lines = [line for line in completed.stderr.splitlines() if line.startswith("SUMMARY ")]
    assert len(summary_lines) == 1, completed.stderr
    summary = {k: int(v) for k, v in (kv.split("=") for kv in summary_lines[0].split()[1:])}
    return completed.stdout, summary, received


def expected_stdout(status: int, args: list[str]) -> str:
    cmd = " ".join(["fake_worker", *args])
    out = f"[{TS}] -> {cmd}\n"
    if status:
        out += f"[{TS}] WARN: '{cmd}' exited {status}\n"
    return out


@pytest.mark.parametrize("status", [1, 2, 64, 130])
def test_warn_line_carries_the_real_exit_code(status: int) -> None:
    stdout, summary, received = run_helper(helper_line(), status, ARGS)
    assert stdout == expected_stdout(status, ARGS)
    assert summary == {"wrapper": 0, "calls": 1, "later": 1}
    assert received == ARGS


def test_success_logs_invocation_only() -> None:
    stdout, summary, received = run_helper(helper_line(), 0, ARGS)
    assert stdout == expected_stdout(0, ARGS)
    assert "WARN" not in stdout
    assert summary == {"wrapper": 0, "calls": 1, "later": 1}
    assert received == ARGS


def test_pre_fix_helper_is_rejected_by_this_harness() -> None:
    """The defect this test pins: the old helper logged ``exited 0`` for a worker that exited 2."""
    stdout, summary, _ = run_helper(PRE_FIX_HELPER, 2, ARGS)
    assert stdout != expected_stdout(2, ARGS)
    assert stdout.endswith("exited 0\n")
    assert summary == {"wrapper": 0, "calls": 1, "later": 1}
