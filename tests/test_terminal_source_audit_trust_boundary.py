from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

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


def make_fixture(tmp_path: Path) -> dict[str, object]:
    repo = tmp_path / "repo"
    live = tmp_path / "live"
    clean_work_tree = tmp_path / "clean-work-tree"
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

    shutil.copytree(terminal, live, dirs_exist_ok=True)
    (clean_work_tree / "terminal").mkdir(parents=True)
    shutil.copy2(terminal / "app.py", clean_work_tree / "terminal" / "app.py")

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
    return {
        "repo": repo,
        "live": live,
        "clean_work_tree": clean_work_tree,
        "marker": marker,
        "sha": accepted_sha,
        "policy": policy,
    }


def run(fixture: dict[str, object]):
    return audit_source(
        canonical_repo=fixture["repo"],
        accepted_sha=fixture["sha"],
        policy=fixture["policy"],
    )


def finding_codes(receipt: dict[str, object]) -> list[str]:
    return [finding["code"] for finding in receipt["findings"]]


def test_ambient_git_work_tree_cannot_hide_dirty_canonical_checkout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = make_fixture(tmp_path)
    repo = fixture["repo"]
    clean_work_tree = fixture["clean_work_tree"]
    assert isinstance(repo, Path)
    assert isinstance(clean_work_tree, Path)

    (repo / "terminal" / "app.py").write_text("dirty host edit\n", encoding="utf-8")
    monkeypatch.setenv("GIT_WORK_TREE", str(clean_work_tree))

    receipt, exit_code = run(fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert "CANONICAL_WORKTREE_DIRTY" in finding_codes(receipt)


def test_ambient_git_dir_cannot_redirect_canonical_repository(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = make_fixture(tmp_path)
    other = tmp_path / "other-repo"
    other.mkdir()
    git(other, "init", "-q", "-b", "master")
    git(other, "config", "user.name", "Other")
    git(other, "config", "user.email", "other@example.invalid")
    (other / "other.txt").write_text("other\n", encoding="utf-8")
    git(other, "add", ".")
    git(other, "commit", "-qm", "other")
    monkeypatch.setenv("GIT_DIR", str(other / ".git"))

    receipt, exit_code = run(fixture)

    assert exit_code == EXIT_CLEAN
    assert receipt["canonical_repo_head"] == fixture["sha"]


def test_deployment_marker_symlink_is_invalid_and_never_followed(tmp_path: Path) -> None:
    fixture = make_fixture(tmp_path)
    marker = fixture["marker"]
    accepted_sha = fixture["sha"]
    assert isinstance(marker, Path)
    assert isinstance(accepted_sha, str)

    target = tmp_path / "unrelated-marker-target"
    target.write_text(f"{accepted_sha}\n", encoding="utf-8")
    marker.unlink()
    os.symlink(target, marker)

    receipt, exit_code = run(fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert receipt["deployment"]["marker_state"] == "INVALID_TYPE"
    assert finding_codes(receipt) == ["DEPLOYMENT_MARKER_INVALID_TYPE"]
