from __future__ import annotations

import errno
import json
import socket
import subprocess
from pathlib import Path

import pytest

import ops.terminal_audit.cli as audit_cli
from ops.terminal_audit.model import EXIT_INPUT_ERROR
from ops.terminal_source_audit import EXIT_UNKNOWN_STOP, audit_source


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout.strip()


@pytest.fixture()
def cli_fixture(tmp_path: Path) -> dict[str, object]:
    repo = tmp_path / "repo"
    live = tmp_path / "live"
    repo.mkdir()
    live.mkdir()

    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.name", "Audit Test")
    git(repo, "config", "user.email", "audit@example.invalid")
    terminal = repo / "terminal"
    terminal.mkdir()
    (terminal / "app.py").write_text("canonical\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "fixture")
    accepted_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", accepted_sha)
    (live / "app.py").write_text("canonical\n", encoding="utf-8")

    marker = live / ".deployment-id"
    marker.write_text(f"{accepted_sha}\n", encoding="utf-8")
    policy = {
        "schema": "mastermind.terminal.source_audit_policy.v1",
        "accepted_ref": "refs/remotes/origin/master",
        "deployment_id_file": str(marker),
        "mappings": [
            {
                "name": "terminal-app",
                "repo_path": "terminal",
                "live_path": str(live),
                "allowances": [
                    {
                        "path": ".deployment-id",
                        "classification": "deployment_marker",
                    }
                ],
            }
        ],
    }
    policy_path = tmp_path / "policy.json"
    policy_path.write_text(json.dumps(policy), encoding="utf-8")
    return {
        "repo": repo,
        "live": live,
        "marker": marker,
        "sha": accepted_sha,
        "policy": policy,
        "policy_path": policy_path,
    }


def test_cli_receipt_write_failure_returns_documented_blocking_code(
    cli_fixture: dict[str, object],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    repo = cli_fixture["repo"]
    accepted_sha = cli_fixture["sha"]
    policy_path = cli_fixture["policy_path"]
    assert isinstance(repo, Path)
    assert isinstance(accepted_sha, str)
    assert isinstance(policy_path, Path)
    output = tmp_path / "receipts" / "audit.json"

    def fail_write(*_args: object, **_kwargs: object) -> None:
        raise OSError(errno.ENOSPC, "synthetic receipt filesystem full")

    monkeypatch.setattr(audit_cli, "_atomic_write_json", fail_write)

    exit_code = audit_cli.main(
        [
            "--canonical-repo",
            str(repo),
            "--accepted-sha",
            accepted_sha,
            "--policy",
            str(policy_path),
            "--output",
            str(output),
        ]
    )

    assert exit_code == EXIT_INPUT_ERROR
    assert not output.exists()
    assert "input/audit error" in capsys.readouterr().err


def test_deployment_marker_socket_is_invalid_without_content_read(
    cli_fixture: dict[str, object],
) -> None:
    repo = cli_fixture["repo"]
    accepted_sha = cli_fixture["sha"]
    policy = cli_fixture["policy"]
    marker = cli_fixture["marker"]
    assert isinstance(repo, Path)
    assert isinstance(accepted_sha, str)
    assert isinstance(policy, dict)
    assert isinstance(marker, Path)

    marker.unlink()
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(marker))
    try:
        receipt, exit_code = audit_source(
            canonical_repo=repo,
            accepted_sha=accepted_sha,
            policy=policy,
        )
    finally:
        server.close()

    assert exit_code == EXIT_UNKNOWN_STOP
    assert receipt["deployment"]["marker_state"] == "INVALID_TYPE"
    assert [finding["code"] for finding in receipt["findings"]] == [
        "DEPLOYMENT_MARKER_INVALID_TYPE"
    ]
    assert receipt["findings"][0]["live_type"] == "socket"
