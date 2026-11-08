"""Accepted protected Terminal master -> existing zero-downtime VPS build, shape tests."""
from pathlib import Path

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
