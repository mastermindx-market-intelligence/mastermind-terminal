from __future__ import annotations

import errno
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from .compare import audit_mapping, path_is_within
from .git_ops import read_stable_regular_bytes, run_git
from .model import (
    EXIT_CLEAN,
    EXIT_UNKNOWN_STOP,
    RECEIPT_SCHEMA,
    GitCommandError,
    UnsupportedLiveFileType,
    finding,
    receipt_id,
)
from .policy import parse_policy

_FULL_SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")
_MARKER_MAX_BYTES = 128


def audit_source(
    *,
    canonical_repo: str | os.PathLike[str],
    accepted_sha: str,
    policy: Mapping[str, Any],
    now: Callable[[], datetime] | None = None,
) -> tuple[dict[str, Any], int]:
    """Audit source state and return a sanitized receipt plus process exit code."""

    repo = Path(canonical_repo)
    if not _FULL_SHA_RE.fullmatch(accepted_sha):
        raise ValueError(
            "accepted_sha must be a full 40-character hexadecimal commit SHA"
        )
    accepted_sha = accepted_sha.lower()
    if not repo.is_dir():
        raise ValueError(f"canonical_repo is not a directory: {repo}")
    if not (repo / ".git").exists():
        raise ValueError(f"canonical_repo is not a Git checkout: {repo}")

    accepted_ref, deployment_id_file, mappings = parse_policy(policy)
    policy_digest = hashlib.sha256(
        json.dumps(policy, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    resolved_commit = run_git(
        repo, "rev-parse", "--verify", f"{accepted_sha}^{{commit}}"
    )
    resolved_sha = resolved_commit.stdout.decode("ascii").strip().lower()
    if resolved_sha != accepted_sha:
        raise ValueError("accepted_sha did not resolve to the exact requested commit")

    findings: list[dict[str, Any]] = []
    head_result = run_git(repo, "rev-parse", "HEAD")
    repo_head = head_result.stdout.decode("ascii").strip().lower()
    if repo_head != accepted_sha:
        findings.append(
            finding(
                "CANONICAL_HEAD_MISMATCH",
                "Canonical checkout HEAD differs from the requested accepted SHA.",
                path=str(repo),
                canonical_repo_head=repo_head,
            )
        )

    status_result = run_git(
        repo, "status", "--porcelain=v1", "-z", "--untracked-files=all"
    )
    status_records = sorted(
        record.decode("utf-8", "surrogateescape")
        for record in status_result.stdout.split(b"\0")
        if record
    )
    if status_records:
        findings.append(
            finding(
                "CANONICAL_WORKTREE_DIRTY",
                "Canonical checkout contains tracked or untracked working-tree changes.",
                path=str(repo),
                status_entries=status_records,
            )
        )

    ref_result = run_git(
        repo,
        "rev-parse",
        "--verify",
        f"{accepted_ref}^{{commit}}",
        check=False,
    )
    if ref_result.returncode == 0:
        ref_sha = ref_result.stdout.decode("ascii").strip().lower()
        ancestor_result = run_git(
            repo,
            "merge-base",
            "--is-ancestor",
            accepted_sha,
            accepted_ref,
            check=False,
        )
        if ancestor_result.returncode not in {0, 1}:
            raise GitCommandError(
                ("merge-base", "--is-ancestor", accepted_sha, accepted_ref),
                ancestor_result.returncode,
                ancestor_result.stderr.decode("utf-8", "replace"),
            )
        contains_sha = ancestor_result.returncode == 0
        if not contains_sha:
            findings.append(
                finding(
                    "SHA_NOT_ACCEPTED_ON_REF",
                    "Requested deployment SHA is not an ancestor of the configured accepted ref.",
                    path=accepted_ref,
                    ref_sha=ref_sha,
                )
            )
    else:
        ref_sha = None
        contains_sha = False
        findings.append(
            finding(
                "ACCEPTED_REF_UNKNOWN",
                "Configured accepted ref is unavailable in the canonical checkout.",
                path=accepted_ref,
            )
        )

    mapping_receipts: list[dict[str, Any]] = []
    missing_live_roots: list[Path] = []
    for mapping in mappings:
        mapping_receipt, mapping_findings = audit_mapping(
            repo, accepted_sha, mapping
        )
        mapping_receipts.append(mapping_receipt)
        findings.extend(mapping_findings)
        if any(
            item["code"] == "LIVE_PATH_MISSING" for item in mapping_findings
        ):
            missing_live_roots.append(mapping.live_path)

    marker_suppressed = any(
        path_is_within(deployment_id_file, root) for root in missing_live_roots
    )
    marker_state, deployment_sha, marker_findings = _audit_marker(
        deployment_id_file, accepted_sha, marker_suppressed
    )
    findings.extend(marker_findings)

    findings.sort(
        key=lambda item: (
            item.get("mapping", ""),
            item.get("path", ""),
            item["code"],
        )
    )
    status = "CLEAN" if not findings else "UNKNOWN_STOP"
    current_time = (now or (lambda: datetime.now(timezone.utc)))()
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)

    receipt: dict[str, Any] = {
        "schema": RECEIPT_SCHEMA,
        "generated_at": current_time.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "status": status,
        "accepted_sha": accepted_sha,
        "policy_digest": policy_digest,
        "canonical_repo": str(repo.resolve()),
        "canonical_repo_head": repo_head,
        "accepted_ref": {
            "name": accepted_ref,
            "sha": ref_sha,
            "contains_sha": contains_sha,
        },
        "deployment": {
            "marker_path": str(deployment_id_file),
            "marker_state": marker_state,
            "sha": deployment_sha,
        },
        "mappings": mapping_receipts,
        "summary": {
            "blocking_findings": len(findings),
            "tracked_paths": sum(
                item["tracked_paths"] for item in mapping_receipts
            ),
            "allowed_paths": sum(
                item["allowed_paths"] for item in mapping_receipts
            ),
        },
        "findings": findings,
    }
    receipt["receipt_id"] = receipt_id(receipt)
    return receipt, EXIT_CLEAN if status == "CLEAN" else EXIT_UNKNOWN_STOP


def _audit_marker(
    marker: Path, accepted_sha: str, suppress_missing: bool
) -> tuple[str, str | None, list[dict[str, Any]]]:
    findings: list[dict[str, Any]] = []
    if not os.path.lexists(marker):
        if suppress_missing:
            return "UNAVAILABLE", None, findings
        return (
            "MISSING",
            None,
            [
                finding(
                    "DEPLOYMENT_MARKER_MISSING",
                    "Deployment marker file is missing.",
                    path=str(marker),
                )
            ],
        )
    try:
        marker_bytes = read_stable_regular_bytes(
            marker, max_bytes=_MARKER_MAX_BYTES
        )
    except UnsupportedLiveFileType as exc:
        return (
            "INVALID_TYPE",
            None,
            [
                finding(
                    "DEPLOYMENT_MARKER_INVALID_TYPE",
                    "Deployment marker must be a real regular file and is never followed as a link or opened as a special file.",
                    path=str(marker),
                    live_type=exc.live_type,
                )
            ],
        )
    except OSError as exc:
        if exc.errno == errno.EFBIG:
            return (
                "INVALID",
                None,
                [
                    finding(
                        "DEPLOYMENT_MARKER_INVALID",
                        "Deployment marker exceeds the bounded full-SHA receipt size.",
                        path=str(marker),
                    )
                ],
            )
        return (
            "UNREADABLE",
            None,
            [
                finding(
                    "DEPLOYMENT_MARKER_UNREADABLE",
                    "Deployment marker could not be read as one stable regular file.",
                    path=str(marker),
                    errno=exc.errno,
                )
            ],
        )
    try:
        marker_value = marker_bytes.decode("ascii").strip()
    except UnicodeDecodeError:
        marker_value = ""
    if not _FULL_SHA_RE.fullmatch(marker_value):
        return (
            "INVALID",
            None,
            [
                finding(
                    "DEPLOYMENT_MARKER_INVALID",
                    "Deployment marker does not contain exactly one full commit SHA.",
                    path=str(marker),
                )
            ],
        )
    deployment_sha = marker_value.lower()
    if deployment_sha != accepted_sha:
        findings.append(
            finding(
                "DEPLOYMENT_SHA_MISMATCH",
                "Deployment marker SHA differs from the requested accepted SHA.",
                path=str(marker),
                deployed_sha=deployment_sha,
            )
        )
    return "VALID", deployment_sha, findings
