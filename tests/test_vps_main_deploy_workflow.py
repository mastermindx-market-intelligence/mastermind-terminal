"""Accepted protected Terminal master -> existing zero-downtime VPS build, shape tests."""
from pathlib import Path
import subprocess

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/vps-main-deploy.yml"
PIN = ROOT / "ops/vps_origin_known_hosts"
EXPECTED_PIN = (
    "146.190.142.17 ssh-ed25519 "
    "AAAAC3NzaC1lZDI1NTE5AAAAIEc8ibhWOj35RC4FXjydG27GMxKfjiVXOw0s7hiCySkk\n"
)


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_terminal_vps_wake_requires_protected_master_and_no_privilege() -> None:
    wf = _workflow()
    events = wf.get("on", wf.get(True))
    assert set(events) == {"push", "workflow_dispatch"}
    assert events["workflow_dispatch"] == {}
    assert events["push"]["branches"] == ["master"]
    assert {"terminal/**", "ingest/**", "signal_layer/**", "ops/terminal-build.sh"} <= set(
        events["push"]["paths"]
    )
    assert "pull_request_target" not in events and "pull_request" not in events
    assert wf["permissions"] == {"contents": "read"}
    assert wf["concurrency"]["cancel-in-progress"] is False
    assert list(wf["jobs"]) == ["deploy"]
    job = wf["jobs"]["deploy"]
    assert "github.repository == 'mastermindx-market-intelligence/mastermind-terminal'" in job["if"]
    assert "github.ref == 'refs/heads/master'" in job["if"]


def test_terminal_vps_wake_preserves_builder_release_ownership() -> None:
    assert PIN.read_text(encoding="utf-8") == EXPECTED_PIN
    steps = _workflow()["jobs"]["deploy"]["steps"]
    assert len(steps) == 2
    assert steps[0]["uses"] == "actions/checkout@v4"
    assert steps[0]["with"]["sparse-checkout"] == "ops/vps_origin_known_hosts"
    assert steps[1]["env"] == {"VPS_DEPLOY_KEY": "${{ secrets.VPS_DEPLOY_KEY }}"}
    command = steps[1]["run"]
    assert 'TARGET_SHA="$(git ls-remote origin refs/heads/master' in command
    assert '[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]' in command
    assert "StrictHostKeyChecking=yes" in command
    assert 'UserKnownHostsFile="$PIN"' in command
    # The stale installed copy must never be INVOKED: the builder bytes are
    # staged from TARGET_SHA out of the host's .gitsrc mirror and the staged
    # copy runs instead (bootstrap-deadlock break, CI Lightning F2).
    assert "bash /opt/terminal/terminal-build.sh --target" not in command
    assert 'bash "$staged" --target production --target-sha "$target_sha"' in command
    assert "git -C /opt/terminal/.gitsrc fetch --no-tags origin master" in command
    assert 'test "$fetched_head" = "$target_sha"' in command
    assert 'git -C /opt/terminal/.gitsrc show "${target_sha}:ops/terminal-build.sh" > "$staged"' in command
    assert 'test "$staged_blob" = "$target_blob"' in command
    assert 'chmod 0700 "$staged"' in command
    assert "trap 'rm -f \"$staged\"' EXIT" in command
    assert "/opt/terminal/terminal/.deployment-id" in command
    assert "trap 'rm -f" in command
    executable = "\n".join(
        line for line in command.splitlines() if not line.lstrip().startswith("#")
    )
    for forbidden in ("ssh-keyscan", "accept-new", "rsync ", "git push",
                      "gh pr merge", "systemctl restart", "--admin"):
        assert forbidden not in executable


def test_deploy_command_shell_parses_without_running() -> None:
    command = _workflow()["jobs"]["deploy"]["steps"][-1]["run"]
    parsed = subprocess.run(["bash", "-n"], input=command, text=True,
                            capture_output=True, check=False)
    assert parsed.returncode == 0, parsed.stderr



def test_active_beta_reuses_the_same_exact_source_publisher_and_receipt() -> None:
    wf = _workflow()
    command = wf["jobs"]["deploy"]["steps"][1]["run"]
    assert '.github/workflows/vps-main-deploy.yml' in wf.get("on", wf.get(True))["push"]["paths"]
    assert command.count('bash "$staged" --target production') == 1
    assert command.count('bash "$staged" --target beta') == 1
    assert command.count('--target-sha "$target_sha"') == 2
    assert "bash -s -- \"$TARGET_SHA\" <<'MMX_RELEASE_SCRIPT'" in command
    assert 'target_sha="$1"' in command
    assert "systemctl is-active --quiet terminal-beta.service && systemctl is-enabled --quiet terminal-beta.service" in command
    assert "test -L /opt/terminal/beta/.runtime-accepted" in command
    assert command.index('test "$installed" = "$target_sha"') < command.index("systemctl is-active")
    assert command.index("systemctl is-active") < command.index("--target beta")
    assert command.index("--target beta") < command.index("python3 -c")
    assert "existing stop/start policy preserved" in command
    assert "/opt/terminal/beta/.deployment-id" not in command
    for forbidden in ("--bootstrap", "--recover-attempt", "systemctl start", "systemctl enable", "systemctl reset-failed", "crontab", "sleep "):
        assert forbidden not in command


def test_beta_receipt_and_runtime_check_fails_closed() -> None:
    import contextlib
    import io
    import json
    import re
    import sys
    from unittest import mock

    command = _workflow()["jobs"]["deploy"]["steps"][1]["run"]
    match = re.search(r"python3 -c '([^']+)' /opt/terminal/beta/\.runtime-accepted", command)
    assert match is not None
    code = match.group(1).replace('\\"', '"')
    compiled = compile(code, "<beta-receipt-origin-check>", "exec")
    expected = "a" * 40
    cases = [
        ({"accepted_sha": expected}, {"buildId": expected, "enabled": True}, 0),
        ({"accepted_sha": "b" * 40}, {"buildId": expected, "enabled": True}, 1),
        ({"accepted_sha": expected}, {"buildId": "b" * 40, "enabled": True}, 1),
        ({"accepted_sha": expected}, {"buildId": expected, "enabled": False}, 1),
        ({"accepted_sha": expected}, {"buildId": expected, "enabled": "true"}, 1),
        ({}, {}, 1),
    ]
    for receipt, status, exit_code in cases:
        with (mock.patch("builtins.open", return_value=io.StringIO(json.dumps(receipt))) as opened,
              mock.patch("urllib.request.urlopen", return_value=io.StringIO(json.dumps(status))) as fetched,
              mock.patch.object(sys, "argv", ["check", "/opt/terminal/beta/.runtime-accepted", expected]),
              contextlib.redirect_stdout(io.StringIO())):
            try:
                exec(compiled, {})
            except SystemExit as exc:
                assert exc.code == exit_code
            else:
                raise AssertionError("release validator must declare its outcome")
            opened.assert_called_once_with("/opt/terminal/beta/.runtime-accepted")
            fetched.assert_called_once_with("http://127.0.0.1:3001/api/shared-shell/status", timeout=15)



REMOTE_STUB_PREFIX = r'''
EXPECTED=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
git() { if [ "$1" != -C ] || [ "$2" != /opt/terminal/.gitsrc ]; then printf 'unexpected git call: %s\n' "$*" >&2; return 99; fi
      case "$3" in
        fetch) if [ "$5" = origin ] && [ "$6" = master ]; then return "${FETCH_EXIT:-0}"; else printf 'unexpected fetch: %s\n' "$*" >&2; return 99; fi;;
        rev-parse) if [ "$4" = FETCH_HEAD ]; then printf '%s\n' "${FETCHED_HEAD:-$EXPECTED}"; elif [ "$4" = "${EXPECTED}:ops/terminal-build.sh" ]; then if [ "${TARGET_BLOB_MISSING:-0}" = 1 ]; then printf 'fatal: path does not exist\n' >&2; return 128; fi; printf '%s\n' "${TARGET_BLOB:-blob-ok}"; else printf 'unexpected rev-parse: %s\n' "$4" >&2; return 99; fi;;
        show) if [ "$4" = "${EXPECTED}:ops/terminal-build.sh" ]; then printf '%s\n' "${SHOW_BYTES:-STAGED_BUILDER_BYTES}"; else printf 'unexpected show: %s\n' "$4" >&2; return 99; fi;;
        hash-object) printf '%s\n' "${STAGED_BLOB:-blob-ok}";;
        *) printf 'unexpected git verb: %s\n' "$3" >&2; return 99;;
      esac; }
mktemp() { printf '%s\n' "${STAGED_PATH:-/tmp/mm-staged-build.XXXX}"; }
chmod() { builtin test "$1" = 0700; return 0; }
rm() { builtin test "$2" = "${STAGED_PATH:-/tmp/mm-staged-build.XXXX}"; printf 'STAGED_REMOVED\n'; return 0; }
bash() { builtin test "$1" = "${STAGED_PATH:-/tmp/mm-staged-build.XXXX}"; builtin test "$2" = --target; builtin test "$4" = --target-sha; builtin test "$5" = "$EXPECTED"; printf 'PUBLISH:%s\n' "$3"; if [ "$3" = production ]; then return "$PROD_EXIT"; else return "$BETA_EXIT"; fi; }
test() { if [ "$1" = -r ]; then return 0; elif [ "$1" = -L ]; then return "$POINTER_EXIT"; else builtin test "$@"; fi; }
cat() { if [ "$MARKER_OK" = 1 ]; then printf '%s' "$EXPECTED"; else printf 'wrong'; fi; }
systemctl() { if [ "$1" = is-active ]; then return "$ACTIVE_EXIT"; elif [ "$1" = is-enabled ]; then return "$ENABLED_EXIT"; else return 98; fi; }
python3() { printf 'VERIFY_BETA\n'; return "$VERIFY_EXIT"; }
'''
STAGED_PATH_DEFAULT = "/tmp/mm-staged-build.XXXX"


def test_literal_remote_script_preserves_stop_and_refusal_edges() -> None:
    import contextlib
    import os

    command = _workflow()["jobs"]["deploy"]["steps"][1]["run"]
    script = command.split("<<'MMX_RELEASE_SCRIPT'\n", 1)[1].rsplit("\nMMX_RELEASE_SCRIPT", 1)[0]
    assert script.startswith('set -eu\ntarget_sha="$1"\n')
    expected = "a" * 40
    defaults = dict(PROD_EXIT="0", BETA_EXIT="0", POINTER_EXIT="0", ACTIVE_EXIT="0", ENABLED_EXIT="0", MARKER_OK="1", VERIFY_EXIT="0")
    cases = [
        # name, env overrides, exit code, production published, beta published, beta verified, staged copy removed
        ("active", {}, 0, True, True, True, True),
        ("stopped", dict(ACTIVE_EXIT="1"), 0, True, False, False, True),
        ("disabled", dict(ENABLED_EXIT="1"), 0, True, False, False, True),
        ("missing receipt", dict(POINTER_EXIT="1"), 1, True, False, False, True),
        ("production refusal", dict(PROD_EXIT="7"), 7, True, False, False, True),
        ("wrong production", dict(MARKER_OK="0"), 1, True, False, False, True),
        ("beta refusal", dict(BETA_EXIT="8"), 8, True, True, False, True),
        ("wrong beta result", dict(VERIFY_EXIT="1"), 1, True, True, True, True),
        ("fetch lands a different head", dict(FETCHED_HEAD="b" * 40), 1, False, False, False, False),
        ("staged bytes drift from the target blob", dict(STAGED_BLOB="deadbeef"), 1, False, False, False, True),
        ("target commit lacks the builder blob", dict(TARGET_BLOB_MISSING="1"), 128, False, False, False, True),
    ]
    try:
        for name, overrides, exit_code, prod_called, beta_called, verified, staged_removed in cases:
            result = subprocess.run(["bash", "-c", REMOTE_STUB_PREFIX + "\n" + script, "candidate", expected],
                                    env={**os.environ, **defaults, **overrides}, text=True, capture_output=True, check=False)
            assert result.returncode == exit_code, (name, result.stdout, result.stderr)
            assert ("PUBLISH:production" in result.stdout) == prod_called, (name, result.stdout)
            assert ("PUBLISH:beta" in result.stdout) == beta_called, (name, result.stdout)
            assert ("VERIFY_BETA" in result.stdout) == verified, (name, result.stdout)
            assert ("STAGED_REMOVED" in result.stdout) == staged_removed, (name, "staged builder cleanup", result.stdout)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.remove(STAGED_PATH_DEFAULT)



def test_complete_local_to_remote_command_preserves_key_pin_and_stop_edges() -> None:
    import os
    import sys
    import tempfile

    command = _workflow()["jobs"]["deploy"]["steps"][1]["run"]
    expected = "a" * 40
    defaults = dict(PROD_EXIT="0", BETA_EXIT="0", POINTER_EXIT="0", ACTIVE_EXIT="0", ENABLED_EXIT="0", MARKER_OK="1", VERIFY_EXIT="0", TEST_REMOTE_SHA=expected)
    scenarios = [
        ("active", {}, 0, True, True, True),
        ("stopped", dict(ACTIVE_EXIT="1"), 0, True, False, False),
        ("disabled", dict(ENABLED_EXIT="1"), 0, True, False, False),
        ("missing receipt", dict(POINTER_EXIT="1"), 1, True, False, False),
        ("production refusal", dict(PROD_EXIT="7"), 7, True, False, False),
        ("wrong production", dict(MARKER_OK="0"), 1, True, False, False),
        ("beta refusal", dict(BETA_EXIT="8"), 8, True, True, False),
        ("wrong beta", dict(VERIFY_EXIT="1"), 1, True, True, True),
        ("remote staged-builder refusal", dict(FETCHED_HEAD="b" * 40), 1, True, False, False),
        ("malformed protected SHA", dict(TEST_REMOTE_SHA="not-a-commit"), 1, False, False, False),
        ("missing key", dict(VPS_DEPLOY_KEY=""), 1, False, False, False),
        ("wrong host pin", dict(TEST_BAD_PIN="1"), 1, False, False, False),
    ]
    with tempfile.TemporaryDirectory(prefix="terminal-release-contract-") as temporary:
        root = Path(temporary); binaries = root / "bin"; binaries.mkdir()
        workspace = root / "checkout"; (workspace / "ops").mkdir(parents=True)
        runner = root / "runner"; runner.mkdir()
        pin = workspace / "ops/vps_origin_known_hosts"
        fake_git = binaries / "git"
        fake_git.write_text('#!/bin/sh\n[ "$*" = "ls-remote origin refs/heads/master" ] || exit 98\nprintf "%s\\trefs/heads/master\\n" "$TEST_REMOTE_SHA"\n')
        fake_git.chmod(0o700)
        fake_ssh = binaries / "ssh"
        fake_ssh.write_text(
            "#!" + sys.executable + "\n"
            "import os, pathlib, stat, subprocess, sys\n"
            "args = sys.argv[1:]\n"
            "assert args[:2] == ['-F', '/dev/null'], args\n"
            "key = pathlib.Path(args[args.index('-i') + 1])\n"
            "assert key.read_text() == 'fixture-not-a-real-key\\n'\n"
            "assert stat.S_IMODE(key.stat().st_mode) == 0o600\n"
            "opts = [args[i + 1] for i, v in enumerate(args) if v == '-o']\n"
            "for required in ['BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes',\n"
            "                 'GlobalKnownHostsFile=/dev/null', 'ConnectTimeout=15',\n"
            "                 'ServerAliveInterval=20', 'ServerAliveCountMax=15']:\n"
            "    assert required in opts, required\n"
            "assert 'UserKnownHostsFile=' + os.environ['GITHUB_WORKSPACE'] + '/ops/vps_origin_known_hosts' in opts\n"
            "assert args[-5:] == ['root@146.190.142.17', 'bash', '-s', '--', 'a' * 40], args[-5:]\n"
            "script = sys.stdin.read()\n"
            "assert script.startswith('set -eu\\ntarget_sha=\"$1\"\\n')\n"
            "print('QUALIFIED_SSH_CALLED', flush=True)\n"
            "prefix = os.environ.get('REMOTE_STUB_PREFIX', '')\n"
            "result = subprocess.run(['bash', '-c', prefix + '\\n' + script, 'candidate', args[-1]],\n"
            "                       text=True, capture_output=True)\n"
            "print(result.stdout, end='')\n"
            "print(result.stderr, end='', file=sys.stderr)\n"
            "sys.exit(result.returncode)\n"
        )
        fake_ssh.chmod(0o700)
        for name, overrides, status, ssh_called, beta_called, verified in scenarios:
            pin.write_text("wrong-host-pin\n" if overrides.get("TEST_BAD_PIN") else EXPECTED_PIN)
            env = {**os.environ, **defaults, "REMOTE_STUB_PREFIX": REMOTE_STUB_PREFIX, "VPS_DEPLOY_KEY": "fixture-not-a-real-key", "GITHUB_WORKSPACE": str(workspace), "RUNNER_TEMP": str(runner), "PATH": str(binaries) + os.pathsep + os.environ["PATH"], **overrides}
            result = subprocess.run(["bash", "-c", command], env=env, text=True, capture_output=True, check=False)
            assert result.returncode == status, (name, result.stdout, result.stderr)
            assert ("QUALIFIED_SSH_CALLED" in result.stdout) == ssh_called, (name, result.stdout, result.stderr)
            assert ("PUBLISH:beta" in result.stdout) == beta_called, (name, result.stdout)
            assert ("VERIFY_BETA" in result.stdout) == verified, (name, result.stdout)
            assert list(runner.iterdir()) == [], (name, "temporary fixture key leaked")
