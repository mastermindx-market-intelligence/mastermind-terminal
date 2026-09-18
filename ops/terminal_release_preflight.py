#!/usr/bin/env python3
"""Read-only production release preflight for the canonical Terminal deploy owner."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

if __package__:
    from .terminal_audit.audit import audit_source
    from .terminal_audit.compare import path_is_within
    from .terminal_audit.git_ops import read_stable_regular_bytes
    from .terminal_audit.model import (
        EXIT_INPUT_ERROR,
        EXIT_INTERNAL_ERROR,
        GitCommandError,
        UnsupportedLiveFileType,
        receipt_id,
    )
    from .terminal_audit.policy import parse_policy
else:
    from terminal_audit.audit import audit_source
    from terminal_audit.compare import path_is_within
    from terminal_audit.git_ops import read_stable_regular_bytes
    from terminal_audit.model import (
        EXIT_INPUT_ERROR,
        EXIT_INTERNAL_ERROR,
        GitCommandError,
        UnsupportedLiveFileType,
        receipt_id,
    )
    from terminal_audit.policy import parse_policy

_PREFLIGHT_SCHEMA = "mastermind.terminal.release_preflight_receipt.v1"
_FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_POLICY_MAX_BYTES = 1024 * 1024
_MARKER_MAX_BYTES = 128
_DEFAULT_CANONICAL_REPO = Path("/opt/terminal/.gitsrc")
_DEFAULT_POLICY = _DEFAULT_CANONICAL_REPO / "ops/terminal_source_audit.production.json"
_DEFAULT_RECEIPT_DIR = Path("/var/lib/mastermind-terminal/release-preflight")


def _normalized_now(value: datetime | None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def _read_policy(path: Path) -> Mapping[str, Any]:
    payload = read_stable_regular_bytes(path, max_bytes=_POLICY_MAX_BYTES)
    decoded = payload.decode("utf-8")
    policy = json.loads(decoded)
    if not isinstance(policy, Mapping):
        raise ValueError("policy JSON root must be an object")
    return policy


def _read_accepted_sha(marker: Path) -> str:
    marker_bytes = read_stable_regular_bytes(marker, max_bytes=_MARKER_MAX_BYTES)
    try:
        value = marker_bytes.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ValueError(
            "deployment marker must contain one lower-case full SHA"
        ) from exc
    if not _FULL_SHA_RE.fullmatch(value):
        raise ValueError("deployment marker must contain one lower-case full SHA")
    return value


def _validate_paths(
    *,
    canonical_repo: Path,
    policy_path: Path,
    receipt_dir: Path,
    deployment_marker: Path,
    mappings: Sequence[Any],
) -> tuple[Path, ...]:
    if not canonical_repo.is_absolute():
        raise ValueError("canonical_repo must be an absolute path")
    if not policy_path.is_absolute():
        raise ValueError("policy path must be an absolute path")
    if not receipt_dir.is_absolute():
        raise ValueError("receipt directory must be an absolute path")

    live_roots = [mapping.live_path for mapping in mappings]
    if not any(path_is_within(deployment_marker, root) for root in live_roots):
        raise ValueError(
            "deployment marker must remain inside a configured live source root"
        )

    resolved_receipt_dir = receipt_dir.resolve(strict=False)
    protected_roots = [canonical_repo, *live_roots]
    _assert_receipt_directory_outside_sources(
        resolved_receipt_dir, protected_roots
    )
    if os.path.lexists(receipt_dir):
        _validate_receipt_directory(receipt_dir)
    return tuple(protected_roots)


def _assert_receipt_directory_outside_sources(
    receipt_dir: Path, protected_roots: Sequence[Path]
) -> None:
    if any(path_is_within(receipt_dir, root) for root in protected_roots):
        raise ValueError(
            "receipt directory must remain outside canonical and live source roots"
        )


def _validate_receipt_directory(path: Path) -> None:
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise ValueError(
            "receipt directory must be a real directory, not a file or symlink"
        )
    if metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError("receipt directory must not be group or other writable")


def _render_receipt(payload: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(payload, sort_keys=True, indent=2, separators=None) + "\n"
    ).encode("utf-8")


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_immutable_receipt(
    *,
    receipt_dir: Path,
    filename: str,
    payload: Mapping[str, Any],
    protected_roots: Sequence[Path],
) -> Path:
    receipt_dir.mkdir(mode=0o750, parents=True, exist_ok=True)
    _validate_receipt_directory(receipt_dir)
    resolved_dir = receipt_dir.resolve(strict=True)
    _assert_receipt_directory_outside_sources(resolved_dir, protected_roots)
    final_path = resolved_dir / filename
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".terminal-preflight.", dir=resolved_dir
    )
    temporary_path = Path(temporary_name)
    linked = False
    try:
        os.fchmod(descriptor, 0o640)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = -1
            handle.write(_render_receipt(payload))
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary_path, final_path, follow_symlinks=False)
            linked = True
        except FileExistsError as exc:
            raise FileExistsError(
                exc.errno,
                "immutable preflight receipt already exists",
                str(final_path),
            ) from exc
        _fsync_directory(resolved_dir)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass
        if linked:
            _fsync_directory(resolved_dir)
    return final_path


def run_preflight(
    *,
    canonical_repo: str | os.PathLike[str],
    policy_path: str | os.PathLike[str],
    receipt_dir: str | os.PathLike[str],
    now: datetime | None = None,
) -> tuple[dict[str, Any], int, Path]:
    repo = Path(canonical_repo)
    policy_file = Path(policy_path)
    receipts = Path(receipt_dir)
    if not repo.is_absolute():
        raise ValueError("canonical_repo must be an absolute path")
    if not policy_file.is_absolute():
        raise ValueError("policy path must be an absolute path")
    if not receipts.is_absolute():
        raise ValueError("receipt directory must be an absolute path")
    policy = _read_policy(policy_file)
    _, deployment_marker, mappings = parse_policy(policy)
    protected_roots = _validate_paths(
        canonical_repo=repo,
        policy_path=policy_file,
        receipt_dir=receipts,
        deployment_marker=deployment_marker,
        mappings=mappings,
    )
    accepted_sha = _read_accepted_sha(deployment_marker)
    observed_at = _normalized_now(now)
    source_receipt, exit_code = audit_source(
        canonical_repo=repo,
        accepted_sha=accepted_sha,
        policy=policy,
        now=lambda: observed_at,
    )
    generated_at = observed_at.isoformat().replace("+00:00", "Z")
    result = "CLEAN" if exit_code == 0 else "UNKNOWN_STOP"
    receipt: dict[str, Any] = {
        "schema": _PREFLIGHT_SCHEMA,
        "generated_at": generated_at,
        "result": result,
        "accepted_sha": accepted_sha,
        "canonical_repo": str(repo.resolve()),
        "policy_path": str(policy_file.resolve()),
        "policy_digest": source_receipt["policy_digest"],
        "source_audit_receipt_id": source_receipt["receipt_id"],
        "source_audit": source_receipt,
    }
    receipt["receipt_id"] = receipt_id(receipt)
    stamp = observed_at.strftime("%Y%m%dT%H%M%SZ")
    filename = f"{stamp}-{accepted_sha}-{receipt['receipt_id']}.json"
    receipt_path = _write_immutable_receipt(
        receipt_dir=receipts,
        filename=filename,
        payload=receipt,
        protected_roots=protected_roots,
    )
    return receipt, exit_code, receipt_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical-repo", type=Path, default=_DEFAULT_CANONICAL_REPO)
    parser.add_argument("--policy", type=Path, default=_DEFAULT_POLICY)
    parser.add_argument("--receipt-dir", type=Path, default=_DEFAULT_RECEIPT_DIR)
    return parser


def _emit_stdout(payload: Mapping[str, Any]) -> None:
    try:
        print(json.dumps(payload, sort_keys=True))
        sys.stdout.flush()
    except OSError:
        devnull_descriptor = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(devnull_descriptor, 1)
        finally:
            os.close(devnull_descriptor)
        raise


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        receipt, exit_code, receipt_path = run_preflight(
            canonical_repo=args.canonical_repo,
            policy_path=args.policy,
            receipt_dir=args.receipt_dir,
        )
        _emit_stdout(
            {
                "schema": receipt["schema"],
                "result": receipt["result"],
                "accepted_sha": receipt["accepted_sha"],
                "receipt_id": receipt["receipt_id"],
                "source_audit_receipt_id": receipt["source_audit_receipt_id"],
                "receipt_path": str(receipt_path),
            }
        )
        return exit_code
    except (
        OSError,
        UnicodeError,
        ValueError,
        GitCommandError,
        UnsupportedLiveFileType,
        json.JSONDecodeError,
    ) as exc:
        print(f"terminal-release-preflight: input/audit error: {exc}", file=sys.stderr)
        return EXIT_INPUT_ERROR
    except Exception as exc:  # pragma: no cover - last-resort containment
        print(f"terminal-release-preflight: internal error: {exc}", file=sys.stderr)
        return EXIT_INTERNAL_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
