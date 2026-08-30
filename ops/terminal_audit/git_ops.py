from __future__ import annotations

import errno
import hashlib
import os
import stat
import subprocess
from pathlib import Path

from .model import (
    GitCommandError,
    SourceMapping,
    TreeEntry,
    UnsupportedLiveFileType,
)

_READ_CHUNK = 1024 * 1024


def run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    environment = os.environ.copy()
    environment.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_NO_REPLACE_OBJECTS": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_TERMINAL_PROMPT": "0",
        }
    )
    completed = subprocess.run(
        [
            "git",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-C",
            str(repo),
            *args,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=environment,
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


def _file_type(mode: int) -> str:
    if stat.S_ISFIFO(mode):
        return "fifo"
    if stat.S_ISSOCK(mode):
        return "socket"
    if stat.S_ISCHR(mode):
        return "character_device"
    if stat.S_ISBLK(mode):
        return "block_device"
    if stat.S_ISDIR(mode):
        return "directory"
    return "special"


def _open_stable_regular(path: Path) -> tuple[int, os.stat_result]:
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode):
        raise UnsupportedLiveFileType(_file_type(before.st_mode))

    flags = os.O_RDONLY
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise UnsupportedLiveFileType(_file_type(opened.st_mode))
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise OSError(errno.EAGAIN, "live file changed while it was opened", str(path))
        return descriptor, opened
    except BaseException:
        os.close(descriptor)
        raise


def _hash_regular(path: Path, algorithm: str, *, git_blob: bool) -> tuple[str, int, int]:
    descriptor, opened = _open_stable_regular(path)
    try:
        digest = hashlib.new(algorithm)
        if git_blob:
            digest.update(f"blob {opened.st_size}\0".encode("ascii"))
        total = 0
        while True:
            chunk = os.read(descriptor, _READ_CHUNK)
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
        after = os.fstat(descriptor)
        if (
            total != opened.st_size
            or after.st_size != opened.st_size
            or after.st_mtime_ns != opened.st_mtime_ns
            or after.st_ctime_ns != opened.st_ctime_ns
        ):
            raise OSError(errno.EAGAIN, "live file changed while it was hashed", str(path))
        return digest.hexdigest(), total, opened.st_mode
    finally:
        os.close(descriptor)


def live_blob(path: Path) -> tuple[str, str, int]:
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode):
        data = os.readlink(path).encode("utf-8", "surrogateescape")
        header = f"blob {len(data)}\0".encode("ascii")
        return hashlib.sha1(header + data).hexdigest(), "120000", len(data)  # nosec: Git ID
    if not stat.S_ISREG(metadata.st_mode):
        raise UnsupportedLiveFileType(_file_type(metadata.st_mode))
    digest, size, opened_mode = _hash_regular(path, "sha1", git_blob=True)
    mode = "100755" if opened_mode & 0o111 else "100644"
    return digest, mode, size


def sha256_file_or_link(path: Path) -> tuple[str, int, str]:
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode):
        data = os.readlink(path).encode("utf-8", "surrogateescape")
        return hashlib.sha256(data).hexdigest(), len(data), "symlink"
    if not stat.S_ISREG(metadata.st_mode):
        raise UnsupportedLiveFileType(_file_type(metadata.st_mode))
    digest, size, _ = _hash_regular(path, "sha256", git_blob=False)
    return digest, size, "file"


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
