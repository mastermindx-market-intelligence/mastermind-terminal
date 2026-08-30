from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
from pathlib import Path

import pytest

from ops.terminal_audit.cli import main as audit_cli_main
from ops.terminal_audit.model import EXIT_INPUT_ERROR
from ops.terminal_source_audit import EXIT_CLEAN, EXIT_UNKNOWN_STOP, audit_source


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
def source_fixture(tmp_path: Path) -> dict[str, object]:
    repo = tmp_path / "repo"
    live = tmp_path / "live"
    repo.mkdir()
    live.mkdir()

    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.name", "Audit Test")
    git(repo, "config", "user.email", "audit@example.invalid")

    terminal = repo / "terminal"
    terminal.mkdir()
    (terminal / "app.py").write_text("print('canonical')\n", encoding="utf-8")
    executable = terminal / "run.sh"
    executable.write_text("#!/bin/sh\necho ok\n", encoding="utf-8")
    executable.chmod(0o755)
    (terminal / ".gitignore").write_text("*.host-secret\n", encoding="utf-8")
    os.symlink("app.py", terminal / "app-link")

    git(repo, "add", ".")
    git(repo, "commit", "-qm", "fixture")
    accepted_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", accepted_sha)

    shutil.copytree(terminal, live, symlinks=True, dirs_exist_ok=True)
    (live / ".next").mkdir()
    (live / ".next" / "BUILD_ID").write_text("build\n", encoding="utf-8")
    (live / ".env.local").write_text("SUPER_SECRET=do-not-leak\n", encoding="utf-8")
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
                    {"path": ".next", "classification": "generated_build_artifact"},
                    {
                        "path": ".env.local",
                        "classification": "host_local_secret_config",
                        "sensitive": True,
                    },
                    {"path": ".deployment-id", "classification": "deployment_marker"},
                ],
            }
        ],
    }
    return {"repo": repo, "live": live, "sha": accepted_sha, "policy": policy}


def run(fixture: dict[str, object], **overrides: object):
    kwargs = {
        "canonical_repo": fixture["repo"],
        "accepted_sha": fixture["sha"],
        "policy": fixture["policy"],
    }
    kwargs.update(overrides)
    return audit_source(**kwargs)


def finding_codes(receipt: dict[str, object]) -> list[str]:
    return [finding["code"] for finding in receipt["findings"]]


def test_clean_tree_returns_clean_sanitized_receipt(source_fixture: dict[str, object]) -> None:
    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_CLEAN
    assert receipt["status"] == "CLEAN"
    assert receipt["accepted_sha"] == source_fixture["sha"]
    assert receipt["deployment"]["sha"] == source_fixture["sha"]
    assert receipt["deployment"]["marker_state"] == "VALID"
    assert receipt["accepted_ref"]["contains_sha"] is True
    assert receipt["summary"]["blocking_findings"] == 0
    assert receipt["summary"]["allowed_paths"] == 3
    serialized = json.dumps(receipt, sort_keys=True)
    assert "SUPER_SECRET" not in serialized
    assert "do-not-leak" not in serialized


def test_modified_and_missing_tracked_files_fail_closed(source_fixture: dict[str, object]) -> None:
    live = source_fixture["live"]
    assert isinstance(live, Path)
    (live / "app.py").write_text("print('host edit')\n", encoding="utf-8")
    (live / "run.sh").unlink()

    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert receipt["status"] == "UNKNOWN_STOP"
    assert finding_codes(receipt) == ["TRACKED_MODIFIED", "TRACKED_MISSING"]
    assert receipt["summary"]["blocking_findings"] == 2


def test_untracked_and_gitignored_host_files_are_distinguished(source_fixture: dict[str, object]) -> None:
    live = source_fixture["live"]
    assert isinstance(live, Path)
    (live / "surprise.py").write_text("host only\n", encoding="utf-8")
    (live / "credentials.host-secret").write_text("not printed\n", encoding="utf-8")

    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == [
        "IGNORED_IMPLEMENTATION_CANDIDATE",
        "HOST_ONLY_UNTRACKED",
    ]
    secret_finding = receipt["findings"][0]
    assert secret_finding["path"] == "credentials.host-secret"
    assert "hash" not in secret_finding


def test_executable_mode_and_symlink_target_are_audited(source_fixture: dict[str, object]) -> None:
    live = source_fixture["live"]
    assert isinstance(live, Path)
    (live / "run.sh").chmod(0o644)
    (live / "app-link").unlink()
    os.symlink("run.sh", live / "app-link")

    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["TRACKED_SYMLINK_MODIFIED", "TRACKED_MODE_MISMATCH"]


def test_invalid_or_mismatched_deployment_marker_fails_closed(source_fixture: dict[str, object]) -> None:
    policy = source_fixture["policy"]
    assert isinstance(policy, dict)
    marker = Path(policy["deployment_id_file"])
    marker.write_text("not-a-sha\n", encoding="utf-8")

    invalid_receipt, invalid_exit = run(source_fixture)
    assert invalid_exit == EXIT_UNKNOWN_STOP
    assert invalid_receipt["deployment"]["marker_state"] == "INVALID"
    assert finding_codes(invalid_receipt) == ["DEPLOYMENT_MARKER_INVALID"]

    other_sha = "f" * 40
    marker.write_text(f"{other_sha}\n", encoding="utf-8")
    mismatch_receipt, mismatch_exit = run(source_fixture)
    assert mismatch_exit == EXIT_UNKNOWN_STOP
    assert mismatch_receipt["deployment"]["marker_state"] == "VALID"
    assert finding_codes(mismatch_receipt) == ["DEPLOYMENT_SHA_MISMATCH"]


def test_sha_must_be_full_commit_and_accepted_on_ref(source_fixture: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="full 40-character"):
        run(source_fixture, accepted_sha="abc123")

    repo = source_fixture["repo"]
    assert isinstance(repo, Path)
    terminal = repo / "terminal"
    (terminal / "new.py").write_text("new\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "unaccepted")
    unaccepted_sha = git(repo, "rev-parse", "HEAD")

    receipt, exit_code = run(source_fixture, accepted_sha=unaccepted_sha)
    assert exit_code == EXIT_UNKNOWN_STOP
    assert receipt["accepted_ref"]["contains_sha"] is False
    assert "SHA_NOT_ACCEPTED_ON_REF" in finding_codes(receipt)


def test_missing_live_root_is_unknown_stop_not_input_normalization(source_fixture: dict[str, object]) -> None:
    live = source_fixture["live"]
    assert isinstance(live, Path)
    shutil.rmtree(live)

    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["LIVE_PATH_MISSING"]


def test_canonical_checkout_head_and_worktree_must_match_target(source_fixture: dict[str, object]) -> None:
    repo = source_fixture["repo"]
    assert isinstance(repo, Path)
    accepted_sha = source_fixture["sha"]
    assert isinstance(accepted_sha, str)

    (repo / "terminal" / "later.py").write_text("later\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "later")
    (repo / "scratch.txt").write_text("untracked\n", encoding="utf-8")

    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert "CANONICAL_HEAD_MISMATCH" in finding_codes(receipt)
    assert "CANONICAL_WORKTREE_DIRTY" in finding_codes(receipt)
    assert receipt["canonical_repo_head"] != accepted_sha
    assert len(receipt["policy_digest"]) == 64


def test_git_replace_refs_cannot_rewrite_canonical_evidence(
    source_fixture: dict[str, object],
) -> None:
    repo = source_fixture["repo"]
    accepted_sha = source_fixture["sha"]
    assert isinstance(repo, Path)
    assert isinstance(accepted_sha, str)

    git(repo, "switch", "-qc", "replacement")
    (repo / "terminal" / "app.py").write_text("print('replacement')\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "replacement commit")
    replacement_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "switch", "--detach", accepted_sha)
    git(repo, "update-ref", "refs/remotes/origin/master", accepted_sha)
    git(repo, "replace", accepted_sha, replacement_sha)

    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_CLEAN
    assert receipt["status"] == "CLEAN"
    assert receipt["canonical_repo_head"] == accepted_sha


def test_special_host_file_fails_closed_without_content_read(
    source_fixture: dict[str, object],
) -> None:
    live = source_fixture["live"]
    assert isinstance(live, Path)
    socket_path = live / "runtime.sock"
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(socket_path))
    try:
        receipt, exit_code = run(source_fixture)
    finally:
        server.close()

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["HOST_ONLY_SPECIAL_FILE"]
    assert receipt["findings"][0]["live_type"] == "socket"
    assert "sha256" not in receipt["findings"][0]


def test_cli_refuses_receipt_output_inside_canonical_or_live_source(
    source_fixture: dict[str, object], capsys: pytest.CaptureFixture[str]
) -> None:
    repo = source_fixture["repo"]
    live = source_fixture["live"]
    accepted_sha = source_fixture["sha"]
    policy = source_fixture["policy"]
    assert isinstance(repo, Path)
    assert isinstance(live, Path)
    assert isinstance(accepted_sha, str)
    assert isinstance(policy, dict)

    policy_path = repo.parent / "policy.json"
    policy_path.write_text(json.dumps(policy), encoding="utf-8")

    for output_path in (repo / "receipt.json", live / "receipt.json"):
        exit_code = audit_cli_main(
            [
                "--canonical-repo",
                str(repo),
                "--accepted-sha",
                accepted_sha,
                "--policy",
                str(policy_path),
                "--output",
                str(output_path),
            ]
        )
        assert exit_code == EXIT_INPUT_ERROR
        assert not output_path.exists()

    assert "outside canonical and live source roots" in capsys.readouterr().err


def test_repository_fsmonitor_command_is_disabled_during_audit(
    source_fixture: dict[str, object],
) -> None:
    repo = source_fixture["repo"]
    assert isinstance(repo, Path)
    sentinel = repo.parent / "fsmonitor-ran"
    hook = repo.parent / "fsmonitor.sh"
    hook.write_text(
        "#!/bin/sh\nprintf ran > " + repr(str(sentinel)) + "\nprintf '0\\n'\n",
        encoding="utf-8",
    )
    hook.chmod(0o755)
    git(repo, "config", "core.fsmonitor", str(hook))

    receipt, exit_code = run(source_fixture)

    assert exit_code == EXIT_CLEAN
    assert receipt["status"] == "CLEAN"
    assert not sentinel.exists()
