from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Sequence

from .git_ops import ignored_by_git, live_blob, sha256_file_or_link, tree_entries
from .model import (
    Allowance,
    GitCommandError,
    SourceMapping,
    UnsupportedLiveFileType,
    finding,
)


def _allowance_for(
    relative_path: str, allowances: Sequence[Allowance]
) -> Allowance | None:
    for allowance in allowances:
        if relative_path == allowance.path or relative_path.startswith(
            f"{allowance.path}/"
        ):
            return allowance
    return None


def _host_only_finding(
    repo: Path,
    mapping: SourceMapping,
    relative: str,
    candidate: Path,
) -> dict[str, Any]:
    repo_relative = f"{mapping.repo_path}/{relative}"
    try:
        ignored = ignored_by_git(repo, repo_relative)
    except GitCommandError as exc:
        return finding(
            "IGNORE_CLASSIFICATION_FAILED",
            "Git ignore classification failed for a host-only path.",
            mapping=mapping.name,
            path=relative,
            git_returncode=exc.returncode,
        )
    if ignored:
        return finding(
            "IGNORED_IMPLEMENTATION_CANDIDATE",
            "Host-only path is ignored by Git and requires explicit classification.",
            mapping=mapping.name,
            path=relative,
            live_type="symlink" if candidate.is_symlink() else "file",
        )
    try:
        digest, size, kind = sha256_file_or_link(candidate)
    except UnsupportedLiveFileType as exc:
        return finding(
            "HOST_ONLY_SPECIAL_FILE",
            "Host-only path is a special file and was not opened or hashed.",
            mapping=mapping.name,
            path=relative,
            live_type=exc.live_type,
        )
    except OSError as exc:
        return finding(
            "HOST_ONLY_UNREADABLE",
            "Host-only path could not be read for deterministic hashing.",
            mapping=mapping.name,
            path=relative,
            errno=exc.errno,
        )
    return finding(
        "HOST_ONLY_UNTRACKED",
        "Host-only path is not represented by the accepted Git tree.",
        mapping=mapping.name,
        path=relative,
        live_type=kind,
        sha256=digest,
        live_size=size,
    )


def _compare_tracked_entry(
    mapping: SourceMapping,
    relative_path: str,
    canonical_mode: str,
    canonical_blob: str,
    live_path: Path,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not os.path.lexists(live_path):
        return [
            finding(
                "TRACKED_MISSING",
                "Tracked file from the accepted SHA is missing from the live tree.",
                mapping=mapping.name,
                path=relative_path,
                canonical_git_blob=canonical_blob,
            )
        ]
    if live_path.is_dir() and not live_path.is_symlink():
        return [
            finding(
                "TRACKED_TYPE_MISMATCH",
                "Live path is a directory but the accepted Git path is a file.",
                mapping=mapping.name,
                path=relative_path,
                canonical_mode=canonical_mode,
                live_type="directory",
            )
        ]
    try:
        live_sha, live_mode, live_size = live_blob(live_path)
    except UnsupportedLiveFileType as exc:
        return [
            finding(
                "TRACKED_SPECIAL_FILE",
                "Live tracked path is a special file and was not opened or hashed.",
                mapping=mapping.name,
                path=relative_path,
                live_type=exc.live_type,
            )
        ]
    except OSError as exc:
        return [
            finding(
                "TRACKED_UNREADABLE",
                "Live tracked file could not be read for comparison.",
                mapping=mapping.name,
                path=relative_path,
                errno=exc.errno,
            )
        ]

    if live_sha != canonical_blob:
        code = (
            "TRACKED_SYMLINK_MODIFIED"
            if canonical_mode == "120000"
            else "TRACKED_MODIFIED"
        )
        findings.append(
            finding(
                code,
                "Live tracked content differs from the accepted Git blob.",
                mapping=mapping.name,
                path=relative_path,
                canonical_git_blob=canonical_blob,
                live_git_blob=live_sha,
                live_size=live_size,
            )
        )
    if live_mode != canonical_mode:
        findings.append(
            finding(
                "TRACKED_MODE_MISMATCH",
                "Live tracked file mode differs from the accepted Git mode.",
                mapping=mapping.name,
                path=relative_path,
                canonical_mode=canonical_mode,
                live_mode=live_mode,
            )
        )
    return findings


def audit_mapping(
    repo: Path,
    accepted_sha: str,
    mapping: SourceMapping,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    root_kind, entries = tree_entries(repo, accepted_sha, mapping)
    findings: list[dict[str, Any]] = []
    mapping_receipt: dict[str, Any] = {
        "name": mapping.name,
        "repo_path": mapping.repo_path,
        "live_path": str(mapping.live_path),
        "canonical_kind": root_kind,
        "tracked_paths": len(entries),
        "allowed_paths": 0,
    }

    if root_kind == "missing":
        findings.append(
            finding(
                "CANONICAL_PATH_MISSING",
                "Configured repository path does not exist at the accepted SHA.",
                mapping=mapping.name,
                path=mapping.repo_path,
            )
        )
        return mapping_receipt, findings

    if root_kind == "blob":
        if mapping.allowances:
            raise ValueError(
                f"file mapping {mapping.name} cannot declare subtree allowances"
            )
        entry = entries[0]
        findings.extend(
            _compare_tracked_entry(
                mapping,
                str(mapping.live_path),
                entry.mode,
                entry.blob_sha,
                mapping.live_path,
            )
        )
        return mapping_receipt, findings

    if root_kind != "tree":
        findings.append(
            finding(
                "CANONICAL_PATH_UNSUPPORTED",
                "Configured repository path is not a tree or blob.",
                mapping=mapping.name,
                path=mapping.repo_path,
                object_type=root_kind,
            )
        )
        return mapping_receipt, findings

    live_root = mapping.live_path
    if not os.path.lexists(live_root):
        findings.append(
            finding(
                "LIVE_PATH_MISSING",
                "Configured live source directory is missing.",
                mapping=mapping.name,
                path=str(live_root),
            )
        )
        return mapping_receipt, findings
    if live_root.is_symlink() or not live_root.is_dir():
        findings.append(
            finding(
                "LIVE_PATH_TYPE_MISMATCH",
                "Configured live source root must be a real directory, not a file or symlink.",
                mapping=mapping.name,
                path=str(live_root),
            )
        )
        return mapping_receipt, findings

    tracked_paths = {entry.relative_path for entry in entries}
    for entry in entries:
        findings.extend(
            _compare_tracked_entry(
                mapping,
                entry.relative_path,
                entry.mode,
                entry.blob_sha,
                live_root / entry.relative_path,
            )
        )

    present_allowances = {
        allowance.path
        for allowance in mapping.allowances
        if os.path.lexists(live_root / allowance.path)
    }
    mapping_receipt["allowed_paths"] = len(present_allowances)
    mapping_receipt["allowance_classes"] = sorted(
        {
            allowance.classification
            for allowance in mapping.allowances
            if allowance.path in present_allowances
        }
    )

    walk_errors: list[OSError] = []

    def record_walk_error(error: OSError) -> None:
        walk_errors.append(error)

    for current_root, dirnames, filenames in os.walk(
        live_root,
        topdown=True,
        followlinks=False,
        onerror=record_walk_error,
    ):
        current = Path(current_root)
        current_relative = current.relative_to(live_root).as_posix()
        if current_relative == ".":
            current_relative = ""

        retained_dirs: list[str] = []
        for dirname in sorted(dirnames):
            relative = f"{current_relative}/{dirname}".strip("/")
            candidate = current / dirname
            if _allowance_for(relative, mapping.allowances) is not None:
                continue
            if candidate.is_symlink():
                if relative not in tracked_paths:
                    findings.append(
                        _host_only_finding(repo, mapping, relative, candidate)
                    )
                continue
            retained_dirs.append(dirname)
        dirnames[:] = retained_dirs

        for filename in sorted(filenames):
            relative = f"{current_relative}/{filename}".strip("/")
            if relative in tracked_paths:
                continue
            if _allowance_for(relative, mapping.allowances) is not None:
                continue
            findings.append(
                _host_only_finding(repo, mapping, relative, current / filename)
            )

    for error in walk_errors:
        error_path = str(error.filename or live_root)
        try:
            error_path = Path(error_path).relative_to(live_root).as_posix()
        except ValueError:
            pass
        findings.append(
            finding(
                "LIVE_PATH_UNREADABLE",
                "Part of the live source tree could not be traversed.",
                mapping=mapping.name,
                path=error_path,
                errno=error.errno,
            )
        )

    return mapping_receipt, findings


def path_is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False
