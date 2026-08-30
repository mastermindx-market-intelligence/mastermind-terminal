from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

from .model import GitCommandError, SourceMapping, TreeEntry


def run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    completed = subprocess.run(
        ["git", "-C", str(repo), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and completed.returncode != 0:
        raise GitCommandError(args, completed.returncode, completed.stderr.decode("utf-8", "replace"))
    return completed


def tree_entries(
    repo: Path, accepted_sha: str, mapping: SourceMapping
) -> tuple[str, list[TreeEntry]]:
    root_result = run_git(repo, "ls-tree", "-z", accepted_sha, "--", mapping.repo_path)
    root_records = [record for record in root_result.stdout.split(b"\0") if record]
    if not root_records:
        return "missing", []

    metadata, _, encoded_path = root_records[0].partition(b"\t")
    mode, object_type, blob_sha = metadata.decode("ascii").split(" ", 2)
    root_path = encoded_path.decode("utf-8", "surrogateescape")
    if root_path != mapping.repo_path:
        return "missing", []

    if object_type == "blob":
        return "blob", [
            TreeEntry(
                mode=mode,
                object_type=object_type,
                blob_sha=blob_sha,
                repo_path=root_path,
                relative_path=Path(root_path).name,
            )
        ]
    if object_type != "tree":
        return object_type, []

    recursive = run_git(repo, "ls-tree", "-r", "-z", accepted_sha, "--", mapping.repo_path)
    entries: list[TreeEntry] = []
    prefix = f"{mapping.repo_path}/"
    for record in recursive.stdout.split(b"\0"):
        if not record:
            continue
        metadata, separator, encoded_path = record.partition(b"\t")
        if not separator:
            raise ValueError(f"malformed git ls-tree record for mapping {mapping.name}")
        entry_mode, entry_type, entry_sha = metadata.decode("ascii").split(" ", 2)
        repo_path = encoded_path.decode("utf-8", "surrogateescape")
        if not repo_path.startswith(prefix):
            raise ValueError(f"git returned path outside mapping {mapping.name}: {repo_path}")
        entries.append(
            TreeEntry(
                mode=entry_mode,
                object_type=entry_type,
                blob_sha=entry_sha,
                repo_path=repo_path,
                relative_path=repo_path[len(prefix) :],
            )
        )
    return "tree", sorted(entries, key=lambda entry: entry.relative_path)


def _git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()  # nosec: Git identity, not security


def live_blob(path: Path) -> tuple[str, str, int]:
    if path.is_symlink():
        data = os.readlink(path).encode("utf-8", "surrogateescape")
        return _git_blob_sha(data), "120000", len(data)
    data = path.read_bytes()
    mode = "100755" if path.stat().st_mode & 0o111 else "100644"
    return _git_blob_sha(data), mode, len(data)


def sha256_file_or_link(path: Path) -> tuple[str, int, str]:
    if path.is_symlink():
        data = os.readlink(path).encode("utf-8", "surrogateescape")
        kind = "symlink"
    else:
        data = path.read_bytes()
        kind = "file"
    return hashlib.sha256(data).hexdigest(), len(data), kind


def ignored_by_git(repo: Path, repo_relative_path: str) -> bool:
    completed = run_git(
        repo,
        "check-ignore",
        "--no-index",
        "--quiet",
        "--",
        repo_relative_path,
        check=False,
    )
    if completed.returncode == 0:
        return True
    if completed.returncode == 1:
        return False
    raise GitCommandError(
        ("check-ignore", "--no-index", "--quiet", "--", repo_relative_path),
        completed.returncode,
        completed.stderr.decode("utf-8", "replace"),
    )
