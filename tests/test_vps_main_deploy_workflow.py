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
    assert "bash /opt/terminal/terminal-build.sh --target production --target-sha" in command
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
    assert command.count("bash /opt/terminal/terminal-build.sh --target production") == 1
    assert command.count("bash /opt/terminal/terminal-build.sh --target beta") == 1
    assert command.count("--target-sha '$TARGET_SHA'") == 2
    assert "systemctl is-active --quiet terminal-beta.service && systemctl is-enabled --quiet terminal-beta.service" in command
    assert "test -L /opt/terminal/beta/.runtime-accepted" in command
    assert command.index('test \\"\\$installed\\"') < command.index("systemctl is-active")
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
