from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any, Sequence

from .git_ops import (
    ignored_by_git,
    live_blob,
    object_identity,
    sha256_file_or_link,
    tree_entries,
)
from .model import (
    Allowance,
    GitCommandError,
    SourceMapping,
    TreeEntry,
    UnsupportedLiveFileType,
    finding,
)


def _covers(relative_path: str, allowance: Allowance) -> bool:
    return relative_path == allowance.path or relative_path.startswith(
        f"{allowance.path}/"
    )


def _host_allowance_for(
    relative_path: str, allowances: Sequence[Allowance]
) -> Allowance | None:
    for allowance in allowances:
        if allowance.allow_tracked_absence or allowance.allow_tracked_runtime_file:
            continue
        if _covers(relative_path, allowance):
            return allowance
    return None


def _tracked_shadowing_allowance_for(
    relative_path: str, allowances: Sequence[Allowance]
) -> Allowance | None:
    for allowance in allowances:
        if (
            allowance.allow_tracked_absence
            or allowance.allow_tracked_runtime_subtree
            or allowance.allow_tracked_runtime_file
        ):
            continue
        if _covers(relative_path, allowance):
            return allowance
    return None


def _tracked_absence_allowance_for(
    relative_path: str, allowances: Sequence[Allowance]
) -> Allowance | None:
    for allowance in allowances:
        if allowance.allow_tracked_absence and relative_path == allowance.path:
            return allowance
    return None


def _runtime_subtree_allowance_for(
    relative_path: str, allowances: Sequence[Allowance]
) -> Allowance | None:
    for allowance in allowances:
        if allowance.allow_tracked_runtime_subtree and _covers(
            relative_path, allowance
        ):
            return allowance
    return None


def _live_type(path: Path) -> str:
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode):
        return "symlink"
    if stat.S_ISREG(metadata.st_mode):
        return "file"
    if stat.S_ISDIR(metadata.st_mode):
        return "directory"
    return "special"


def _audit_ordinary_allowance_roots(
    mapping: SourceMapping,
    live_root: Path,
    allowances: Sequence[Allowance],
    *,
    deployment_id_file: Path | None,
) -> tuple[set[str], list[dict[str, Any]]]:
    present: set[str] = set()
    findings: list[dict[str, Any]] = []
    for allowance in allowances:
        candidate = live_root / allowance.path
        if not os.path.lexists(candidate):
            continue
        if deployment_id_file is not None and os.path.normpath(
            os.path.abspath(candidate)
        ) == os.path.normpath(os.path.abspath(deployment_id_file)):
            # Only the policy root's exact marker path has a dedicated bounded,
            # no-follow auditor. A free-form classification label must never
            # suppress ordinary allowance type validation.
            present.add(allowance.path)
            continue
        try:
            actual_type = _live_type(candidate)
        except OSError as exc:
            findings.append(
                finding(
                    "ALLOWANCE_LIVE_UNREADABLE",
                    "An allowed host path could not be inspected safely.",
                    mapping=mapping.name,
                    path=allowance.path,
                    allowance_classification=allowance.classification,
                    errno=exc.errno,
                )
            )
            continue
        expected_type = allowance.expected_live_type
        if actual_type in {"symlink", "special"} or (
            expected_type is not None and actual_type != expected_type
        ):
            findings.append(
                finding(
                    "ALLOWANCE_LIVE_TYPE_MISMATCH",
                    "An allowed host path has an unsafe or unexpected live type.",
                    mapping=mapping.name,
                    path=allowance.path,
                    allowance_classification=allowance.classification,
                    expected_live_type=expected_type or "file_or_directory",
                    live_type=actual_type,
                )
            )
            continue
        present.add(allowance.path)
    return present, findings


def _runtime_fd_path(
    allowance: Allowance, current_root: str, name: str | None = None
) -> str:
    relative_root = Path(current_root).as_posix()
    if relative_root == ".":
        relative_root = ""
    relative = "/".join(part for part in (relative_root, name or "") if part)
    return f"{allowance.path}/{relative}" if relative else allowance.path


def _live_type_from_mode(mode: int) -> str:
    if stat.S_ISLNK(mode):
        return "symlink"
    if stat.S_ISREG(mode):
        return "file"
    if stat.S_ISDIR(mode):
        return "directory"
    return "special"


def _audit_runtime_subtree_metadata(
    mapping: SourceMapping, allowance: Allowance, runtime_root: Path
) -> tuple[str, list[dict[str, Any]]]:
    findings: list[dict[str, Any]] = []
    walk_errors: list[OSError] = []
    state = "PRESENT"
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC

    try:
        root_descriptor = os.open(runtime_root, flags)
    except OSError as exc:
        try:
            actual_type = _live_type(runtime_root)
        except OSError as inspection_error:
            return (
                "UNREADABLE",
                [
                    finding(
                        "ALLOWED_RUNTIME_SUBTREE_UNREADABLE",
                        "Configured host-owned runtime subtree could not be opened safely.",
                        mapping=mapping.name,
                        path=allowance.path,
                        allowance_classification=allowance.classification,
                        errno=inspection_error.errno,
                    )
                ],
            )
        if actual_type != "directory":
            return (
                "TYPE_MISMATCH",
                [
                    finding(
                        "ALLOWED_RUNTIME_SUBTREE_TYPE_MISMATCH",
                        "Configured host-owned runtime subtree must remain a real directory.",
                        mapping=mapping.name,
                        path=allowance.path,
                        allowance_classification=allowance.classification,
                        live_type=actual_type,
                    )
                ],
            )
        return (
            "UNREADABLE",
            [
                finding(
                    "ALLOWED_RUNTIME_SUBTREE_UNREADABLE",
                    "Configured host-owned runtime subtree could not be opened safely.",
                    mapping=mapping.name,
                    path=allowance.path,
                    allowance_classification=allowance.classification,
                    errno=exc.errno,
                )
            ],
        )

    opened_metadata = os.fstat(root_descriptor)

    def record_walk_error(error: OSError) -> None:
        walk_errors.append(error)

    try:
        for current_root, dirnames, filenames, current_descriptor in os.fwalk(
            ".",
            topdown=True,
            follow_symlinks=False,
            onerror=record_walk_error,
            dir_fd=root_descriptor,
        ):
            retained_dirs: list[str] = []
            for dirname in sorted(dirnames):
                try:
                    metadata = os.stat(
                        dirname,
                        dir_fd=current_descriptor,
                        follow_symlinks=False,
                    )
                except OSError as exc:
                    findings.append(
                        finding(
                            "ALLOWED_RUNTIME_SUBTREE_UNREADABLE",
                            "Part of the host-owned runtime subtree could not be inspected.",
                            mapping=mapping.name,
                            path=_runtime_fd_path(allowance, current_root, dirname),
                            errno=exc.errno,
                        )
                    )
                    continue
                actual_type = _live_type_from_mode(metadata.st_mode)
                if actual_type == "symlink":
                    findings.append(
                        finding(
                            "ALLOWED_RUNTIME_SUBTREE_SYMLINK",
                            "A symlink inside the host-owned runtime subtree is not allowed.",
                            mapping=mapping.name,
                            path=_runtime_fd_path(allowance, current_root, dirname),
                        )
                    )
                    continue
                if actual_type != "directory":
                    findings.append(
                        finding(
                            "ALLOWED_RUNTIME_SUBTREE_SPECIAL_FILE",
                            "A special file inside the host-owned runtime subtree is not allowed.",
                            mapping=mapping.name,
                            path=_runtime_fd_path(allowance, current_root, dirname),
                            live_type=actual_type,
                        )
                    )
                    continue
                retained_dirs.append(dirname)
            dirnames[:] = retained_dirs

            for filename in sorted(filenames):
                try:
                    metadata = os.stat(
                        filename,
                        dir_fd=current_descriptor,
                        follow_symlinks=False,
                    )
                except OSError as exc:
                    findings.append(
                        finding(
                            "ALLOWED_RUNTIME_SUBTREE_UNREADABLE",
                            "Part of the host-owned runtime subtree could not be inspected.",
                            mapping=mapping.name,
                            path=_runtime_fd_path(allowance, current_root, filename),
                            errno=exc.errno,
                        )
                    )
                    continue
                actual_type = _live_type_from_mode(metadata.st_mode)
                if actual_type == "symlink":
                    findings.append(
                        finding(
                            "ALLOWED_RUNTIME_SUBTREE_SYMLINK",
                            "A symlink inside the host-owned runtime subtree is not allowed.",
                            mapping=mapping.name,
                            path=_runtime_fd_path(allowance, current_root, filename),
                        )
                    )
                elif actual_type != "file":
                    findings.append(
                        finding(
                            "ALLOWED_RUNTIME_SUBTREE_SPECIAL_FILE",
                            "A special file inside the host-owned runtime subtree is not allowed.",
                            mapping=mapping.name,
                            path=_runtime_fd_path(allowance, current_root, filename),
                            live_type=actual_type,
                        )
                    )

        for error in walk_errors:
            error_path = str(error.filename or ".")
            findings.append(
                finding(
                    "ALLOWED_RUNTIME_SUBTREE_UNREADABLE",
                    "Part of the host-owned runtime subtree could not be traversed.",
                    mapping=mapping.name,
                    path=_runtime_fd_path(allowance, error_path),
                    errno=error.errno,
                )
            )

        try:
            final_metadata = os.lstat(runtime_root)
        except OSError as exc:
            state = "UNREADABLE"
            findings.append(
                finding(
                    "ALLOWED_RUNTIME_SUBTREE_UNREADABLE",
                    "Configured host-owned runtime subtree changed during inspection.",
                    mapping=mapping.name,
                    path=allowance.path,
                    allowance_classification=allowance.classification,
                    errno=exc.errno,
                )
            )
        else:
            root_identity_changed = (
                not stat.S_ISDIR(final_metadata.st_mode)
                or final_metadata.st_dev != opened_metadata.st_dev
                or final_metadata.st_ino != opened_metadata.st_ino
            )
            if root_identity_changed:
                state = "TYPE_MISMATCH"
                findings.append(
                    finding(
                        "ALLOWED_RUNTIME_SUBTREE_TYPE_MISMATCH",
                        "Configured host-owned runtime subtree changed identity during inspection.",
                        mapping=mapping.name,
                        path=allowance.path,
                        allowance_classification=allowance.classification,
                        live_type=_live_type_from_mode(final_metadata.st_mode),
                    )
                )
    finally:
        os.close(root_descriptor)

    return state, findings

def _tracked_runtime_file_allowance_for(
    relative_path: str, allowances: Sequence[Allowance]
) -> Allowance | None:
    for allowance in allowances:
        if allowance.allow_tracked_runtime_file and relative_path == allowance.path:
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


def _validate_tracked_allowances(
    repo: Path,
    accepted_sha: str,
    mapping: SourceMapping,
    entries: Sequence[TreeEntry],
) -> tuple[
    list[tuple[Allowance, str, int]],
    list[tuple[Allowance, TreeEntry]],
]:
    entries_by_path = {entry.relative_path: entry for entry in entries}
    runtime_subtrees: list[tuple[Allowance, str, int]] = []
    runtime_files: list[tuple[Allowance, TreeEntry]] = []

    for allowance in mapping.allowances:
        exact_entry: TreeEntry | None = None
        if allowance.allow_tracked_absence or allowance.allow_tracked_runtime_file:
            contract = (
                "tracked runtime file"
                if allowance.allow_tracked_runtime_file
                else "tracked absence"
            )
            exact_entry = entries_by_path.get(allowance.path)
            if (
                exact_entry is None
                or exact_entry.object_type != "blob"
                or exact_entry.mode not in {"100644", "100755"}
            ):
                raise ValueError(
                    f"{contract} allowance {allowance.path} must name an "
                    "exact tracked regular blob"
                )
            if exact_entry.mode != allowance.canonical_git_mode:
                raise ValueError(
                    f"{contract} allowance {allowance.path} "
                    "canonical_git_mode does not match the accepted SHA"
                )

        if allowance.allow_tracked_absence:
            assert exact_entry is not None
            if exact_entry.blob_sha != allowance.canonical_git_blob:
                raise ValueError(
                    f"tracked absence allowance {allowance.path} "
                    "canonical_git_blob does not match the accepted SHA"
                )

        if allowance.allow_tracked_runtime_file:
            assert exact_entry is not None
            if exact_entry.blob_sha != allowance.canonical_git_blob:
                raise ValueError(
                    f"tracked runtime file allowance {allowance.path} "
                    "canonical_git_blob does not match the accepted SHA"
                )
            runtime_files.append((allowance, exact_entry))

        if allowance.allow_tracked_runtime_subtree:
            full_path = f"{mapping.repo_path}/{allowance.path}"
            identity = object_identity(repo, accepted_sha, full_path)
            if identity is None or identity[1] != "tree":
                raise ValueError(
                    f"tracked runtime subtree allowance {allowance.path} must name "
                    "an exact tracked tree"
                )
            _, _, actual_tree = identity
            if actual_tree != allowance.canonical_git_tree:
                raise ValueError(
                    f"tracked runtime subtree allowance {allowance.path} "
                    "canonical_git_tree does not match the accepted SHA"
                )
            prefix = f"{allowance.path}/"
            tracked_count = sum(
                1 for entry in entries if entry.relative_path.startswith(prefix)
            )
            if tracked_count == 0:
                raise ValueError(
                    f"tracked runtime subtree allowance {allowance.path} must name "
                    "an exact tracked tree"
                )
            runtime_subtrees.append((allowance, actual_tree, tracked_count))

    return runtime_subtrees, runtime_files


def audit_mapping(
    repo: Path,
    accepted_sha: str,
    mapping: SourceMapping,
    *,
    deployment_id_file: Path | None = None,
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
        "allowed_tracked_absence_count": 0,
        "allowed_tracked_absences": [],
        "allowed_tracked_runtime_subtree_count": 0,
        "allowed_tracked_runtime_subtrees": [],
        "allowed_tracked_runtime_file_count": 0,
        "allowed_tracked_runtime_files": [],
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

    runtime_subtrees, runtime_files = _validate_tracked_allowances(
        repo, accepted_sha, mapping, entries
    )

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

    runtime_file_evidence: list[dict[str, Any]] = []
    for allowance, entry in runtime_files:
        runtime_live_path = live_root / allowance.path
        state = "PRESENT"
        if not os.path.lexists(runtime_live_path):
            state = "MISSING"
            findings.append(
                finding(
                    "ALLOWED_RUNTIME_FILE_MISSING",
                    "Configured host-owned runtime file is missing.",
                    mapping=mapping.name,
                    path=allowance.path,
                    allowance_classification=allowance.classification,
                )
            )
        else:
            try:
                actual_type = _live_type(runtime_live_path)
            except OSError as exc:
                state = "UNREADABLE"
                findings.append(
                    finding(
                        "ALLOWED_RUNTIME_FILE_UNREADABLE",
                        "Configured host-owned runtime file could not be inspected.",
                        mapping=mapping.name,
                        path=allowance.path,
                        allowance_classification=allowance.classification,
                        errno=exc.errno,
                    )
                )
            else:
                if actual_type != "file":
                    state = "TYPE_MISMATCH"
                    findings.append(
                        finding(
                            "ALLOWED_RUNTIME_FILE_TYPE_MISMATCH",
                            "Configured host-owned runtime file must be a real regular file.",
                            mapping=mapping.name,
                            path=allowance.path,
                            allowance_classification=allowance.classification,
                            live_type=actual_type,
                        )
                    )
        runtime_file_evidence.append(
            {
                "path": allowance.path,
                "classification": allowance.classification,
                "canonical_git_blob": entry.blob_sha,
                "canonical_mode": entry.mode,
                "live_state": state,
            }
        )
    mapping_receipt["allowed_tracked_runtime_files"] = runtime_file_evidence
    mapping_receipt["allowed_tracked_runtime_file_count"] = len(runtime_file_evidence)

    runtime_evidence: list[dict[str, Any]] = []
    for allowance, tree_id, tracked_count in runtime_subtrees:
        runtime_live_root = live_root / allowance.path
        state = "PRESENT"
        if not os.path.lexists(runtime_live_root):
            state = "MISSING"
            findings.append(
                finding(
                    "ALLOWED_RUNTIME_SUBTREE_MISSING",
                    "Configured host-owned runtime subtree is missing.",
                    mapping=mapping.name,
                    path=allowance.path,
                    allowance_classification=allowance.classification,
                )
            )
        elif runtime_live_root.is_symlink() or not runtime_live_root.is_dir():
            state = "TYPE_MISMATCH"
            findings.append(
                finding(
                    "ALLOWED_RUNTIME_SUBTREE_TYPE_MISMATCH",
                    "Configured host-owned runtime subtree must be a real directory.",
                    mapping=mapping.name,
                    path=allowance.path,
                    allowance_classification=allowance.classification,
                )
            )
        else:
            state, subtree_findings = _audit_runtime_subtree_metadata(
                mapping, allowance, runtime_live_root
            )
            findings.extend(subtree_findings)
        runtime_evidence.append(
            {
                "path": allowance.path,
                "classification": allowance.classification,
                "canonical_git_tree": tree_id,
                "tracked_paths": tracked_count,
                "live_root_state": state,
            }
        )
    mapping_receipt["allowed_tracked_runtime_subtrees"] = runtime_evidence
    mapping_receipt["allowed_tracked_runtime_subtree_count"] = len(runtime_evidence)

    for entry in entries:
        if _runtime_subtree_allowance_for(entry.relative_path, mapping.allowances):
            continue
        if _tracked_runtime_file_allowance_for(entry.relative_path, mapping.allowances):
            continue

        absence_allowance = _tracked_absence_allowance_for(
            entry.relative_path, mapping.allowances
        )
        if absence_allowance is not None and not os.path.lexists(
            live_root / entry.relative_path
        ):
            mapping_receipt["allowed_tracked_absences"].append(
                {
                    "path": entry.relative_path,
                    "classification": absence_allowance.classification,
                    "canonical_git_blob": entry.blob_sha,
                    "canonical_mode": entry.mode,
                }
            )
            continue

        shadowing_allowance = _tracked_shadowing_allowance_for(
            entry.relative_path, mapping.allowances
        )
        if shadowing_allowance is not None:
            findings.append(
                finding(
                    "ALLOWANCE_SHADOWS_TRACKED_PATH",
                    "A policy allowance covers a path that is also tracked at the "
                    "accepted SHA; the audit blocks instead of reading or hashing it.",
                    mapping=mapping.name,
                    path=entry.relative_path,
                    allowance_path=shadowing_allowance.path,
                    allowance_classification=shadowing_allowance.classification,
                    sensitive=shadowing_allowance.sensitive,
                )
            )
            continue
        findings.extend(
            _compare_tracked_entry(
                mapping,
                entry.relative_path,
                entry.mode,
                entry.blob_sha,
                live_root / entry.relative_path,
            )
        )

    mapping_receipt["allowed_tracked_absence_count"] = len(
        mapping_receipt["allowed_tracked_absences"]
    )

    ordinary_allowances = [
        allowance
        for allowance in mapping.allowances
        if not allowance.allow_tracked_absence
        and not allowance.allow_tracked_runtime_subtree
        and not allowance.allow_tracked_runtime_file
    ]
    present_allowances, allowance_root_findings = _audit_ordinary_allowance_roots(
        mapping,
        live_root,
        ordinary_allowances,
        deployment_id_file=deployment_id_file,
    )
    findings.extend(allowance_root_findings)
    mapping_receipt["allowed_paths"] = len(present_allowances)
    mapping_receipt["allowance_classes"] = sorted(
        {
            allowance.classification
            for allowance in ordinary_allowances
            if allowance.path in present_allowances
        }
    )

    tracked_paths = {entry.relative_path for entry in entries}
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
            if _host_allowance_for(relative, mapping.allowances) is not None:
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
            if _host_allowance_for(relative, mapping.allowances) is not None:
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
