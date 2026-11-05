"""Exercise the installed volume guard entrance without running build/data work."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
GUARD = "/usr/local/sbin/terminal-volume-guard"
VALID_SHA = "a" * 40


def run_entry(
    tmp_path: Path,
    name: str,
    state: str,
    args: list[str] | None = None,
    *,
    sourced: bool = False,
) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    """Relocate host paths; stop at each entry's existing bootstrap boundary."""
    bash = shutil.which("bash")
    assert bash
    trace = tmp_path / "trace"
    guard = tmp_path / "volume-guard"
    if state in {"accept", "reject", "nonexecutable"}:
        guard.write_text(
            '#!/bin/sh\nprintf "guard\\n" >> "$GUARD_TRACE"\n'
            f"exit {78 if state == 'reject' else 0}\n",
            encoding="utf-8",
        )
        guard.chmod(0o644 if state == "nonexecutable" else 0o755)
    elif state == "dangling":
        guard.symlink_to(tmp_path / "missing-guard")

    terminal = tmp_path / "terminal-root"
    terminal.mkdir()
    # terminal-data sources this before it opens its lock or invokes producers.
    (terminal / ".env").write_text(
        'printf "data-bootstrap\\n" >> "$GUARD_TRACE"\nexit 91\n',
        encoding="utf-8",
    )
    script = tmp_path / name
    script.write_text(
        (REPO / "ops" / name).read_text(encoding="utf-8")
        .replace(GUARD, str(guard))
        .replace("/opt/terminal", str(terminal)),
        encoding="utf-8",
    )
    commands = tmp_path / "commands"
    commands.mkdir()
    # Any unexpected effect is recorded and refused; no producer/build is run.
    for command in (
        "git", "npm", "npx", "node", "python3", "flock", "mkdir",
        "rm", "cp", "mv", "install", "rsync", "systemctl", "curl",
    ):
        stub = commands / command
        body = '#!/bin/sh\nprintf "unexpected-effect:%s\\n" "$0" >> "$GUARD_TRACE"\nexit 99\n'
        if name == "terminal-build.sh" and command == "mkdir":
            # The shared build lock is now the first mutable owner boundary.
            # Recognize only that exact invocation and stop there without making
            # a directory. Moving the volume guard behind it changes event order
            # and fails this contract; every other command stays denied.
            body = (
                '#!/bin/sh\n'
                'if [ "$#" -eq 2 ] && [ "$1" = -- ] '
                f'&& [ "$2" = "{terminal}/.terminal-build-resource.lock" ]; then\n'
                '  printf "build-bootstrap\\n" >> "$GUARD_TRACE"\n  exit 99\nfi\n'
                'printf "unexpected-effect:%s\\n" "$0" >> "$GUARD_TRACE"\nexit 99\n'
            )
        stub.write_text(body, encoding="utf-8")
        stub.chmod(0o755)
    default_args = ["--target-sha", VALID_SHA] if name == "terminal-build.sh" else []
    invocation = [str(script), *(default_args if args is None else args)]
    if sourced:
        invocation = ["-c", '. "$1"', "guard-library-test", str(script)]
    result = subprocess.run(
        [bash, "--noprofile", "--norc", *invocation],
        env={**os.environ, "GUARD_TRACE": str(trace), "PATH": f"{commands}:/usr/bin:/bin"},
        capture_output=True,
        text=True,
        timeout=10,
    )
    events = trace.read_text(encoding="utf-8").splitlines() if trace.exists() else []
    return result, events


@pytest.mark.parametrize("name", ["terminal-data", "terminal-build.sh"])
@pytest.mark.parametrize("state,code", [("reject", 78), ("nonexecutable", 126), ("dangling", 127)])
def test_installed_guard_failure_stops_entry_before_effects(
    tmp_path: Path, name: str, state: str, code: int
) -> None:
    result, events = run_entry(tmp_path, name, state)
    assert result.returncode == code, result.stdout + result.stderr
    assert events == (["guard"] if state == "reject" else [])


@pytest.mark.parametrize("name", ["terminal-data", "terminal-build.sh"])
@pytest.mark.parametrize("state", ["accept", "absent"])
def test_accepted_or_absent_guard_reaches_entry_bootstrap(
    tmp_path: Path, name: str, state: str
) -> None:
    result, events = run_entry(tmp_path, name, state)
    expected = ["guard"] if state == "accept" else []
    if name == "terminal-data":
        assert result.returncode == 91, result.stdout + result.stderr
        expected.append("data-bootstrap")
    else:
        # The fixture deliberately refuses the first shared-lock mkdir. The
        # owner must reach it only after the accepted/absent volume guard.
        assert result.returncode == 73, result.stdout + result.stderr
        assert "shared build lock path" in result.stdout
        expected.append("build-bootstrap")
    assert events == expected


@pytest.mark.parametrize("args", [["--help"], ["--target-sha", "bad-sha"]])
def test_build_argument_validation_still_precedes_guard(tmp_path: Path, args: list[str]) -> None:
    result, events = run_entry(tmp_path, "terminal-build.sh", "reject", args=args)
    assert result.returncode == 64
    assert events == []


def test_sourcing_build_still_exposes_library_without_guard(tmp_path: Path) -> None:
    result, events = run_entry(tmp_path, "terminal-build.sh", "reject", sourced=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert events == []
