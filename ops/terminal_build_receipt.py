#!/usr/bin/env python3
"""Immutable W2B-B build receipt for the Terminal deploy owner.

This helper has no release authority.  It binds one already-admitted target and
its isolated build inputs to the serving bytes produced by Next.js, then writes
one immutable receipt before the shell owner is allowed to touch live state.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

SCHEMA = "mastermind.terminal.build_receipt.v1"
_FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
_FULL_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_MAX_IDENTITY_BYTES = 256 * 1024
_MAX_REQUIRED_SERVER_FILES = 20_000
_MAX_RECEIPT_BYTES = 4 * 1024 * 1024
_MAX_RECEIPTS = 4096


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _stable_regular_bytes(path: Path, *, limit: int) -> tuple[bytes, os.stat_result]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f"expected regular file: {path}")
        if before.st_size > limit:
            raise ValueError(f"file exceeds size bound: {path}")
        chunks: list[bytes] = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(fd, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > limit:
            raise ValueError(f"file exceeds size bound: {path}")
        after = os.fstat(fd)
        identity = lambda item: (
            item.st_dev,
            item.st_ino,
            item.st_mode,
            item.st_uid,
            item.st_gid,
            item.st_size,
            item.st_mtime_ns,
        )
        if identity(before) != identity(after):
            raise ValueError(f"file changed while read: {path}")
        return payload, after
    finally:
        os.close(fd)


def _json_object(path: Path, *, limit: int = _MAX_IDENTITY_BYTES) -> Mapping[str, Any]:
    payload, _ = _stable_regular_bytes(path, limit=limit)

    def unique(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key in {path}: {key}")
            result[key] = value
        return result

    value = json.loads(payload.decode("utf-8"), object_pairs_hook=unique)
    if not isinstance(value, Mapping):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def _file_row(root: Path, path: Path) -> tuple[str, int, int, str]:
    if path.is_symlink():
        raise ValueError(f"serving artifact must not be a symlink: {path}")
    payload, metadata = _stable_regular_bytes(path, limit=max(path.stat().st_size + 1, 1))
    relative = path.relative_to(root).as_posix()
    return relative, stat.S_IMODE(metadata.st_mode), len(payload), _sha256(payload)


def _digest_rows(rows: Iterable[tuple[str, int, int, str]]) -> tuple[str, int]:
    ordered = sorted(set(rows), key=lambda row: row[0])
    hasher = hashlib.sha256()
    for relative, mode, size, digest in ordered:
        hasher.update(f"{relative}\0{mode:o}\0{size}\0{digest}\n".encode("utf-8"))
    return hasher.hexdigest(), len(ordered)


def compute_serving_digest(terminal_root: str | os.PathLike[str]) -> tuple[str, int]:
    """Hash only serving-relevant Next output, not caches/traces/diagnostics."""
    root = Path(terminal_root).resolve(strict=True)
    next_dir = root / ".next"
    required_path = next_dir / "required-server-files.json"
    manifest = _json_object(required_path, limit=4 * 1024 * 1024)
    required = manifest.get("files")
    if not isinstance(required, list) or len(required) > _MAX_REQUIRED_SERVER_FILES:
        raise ValueError("required-server-files.json has invalid files list")

    paths: set[Path] = set()
    for raw in required:
        if not isinstance(raw, str) or not raw or "\x00" in raw:
            raise ValueError("required-server-files contains invalid path")
        relative = Path(raw)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"required serving file escapes build root: {raw}")
        candidate = root
        for part in relative.parts:
            candidate = candidate / part
            if candidate.is_symlink():
                raise ValueError(f"required serving file traverses symlink: {raw}")
        resolved = candidate.resolve(strict=True)
        if root not in resolved.parents and resolved != root:
            raise ValueError(f"required serving file escapes build root: {raw}")
        if not resolved.is_file():
            raise ValueError(f"required serving file is not a regular file: {raw}")
        paths.add(resolved)

    for subtree in (next_dir / "server", next_dir / "static"):
        if not subtree.is_dir() or subtree.is_symlink():
            raise ValueError(f"missing real serving subtree: {subtree}")
        for candidate in subtree.rglob("*"):
            if candidate.is_symlink():
                raise ValueError(f"serving subtree contains symlink: {candidate}")
            if candidate.is_file():
                paths.add(candidate.resolve(strict=True))

    return _digest_rows(_file_row(root, path) for path in paths)


def _identity_file(path: Path) -> Mapping[str, Any]:
    value = _json_object(path)
    # Identity files are deliberately value-free. Refuse raw-value fields at any depth.
    forbidden = {"value", "raw", "secret", "token", "key_value"}

    def walk(item: Any) -> None:
        if isinstance(item, Mapping):
            overlap = forbidden.intersection(str(key).lower() for key in item)
            if overlap:
                raise ValueError(f"identity file contains forbidden raw-value field: {path}")
            for child in item.values():
                walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)

    walk(value)
    return value


def _require_sha(name: str, value: str) -> str:
    if not _FULL_SHA.fullmatch(value):
        raise ValueError(f"{name} must be one full lower-case SHA")
    return value


def _require_digest(name: str, value: str) -> str:
    if not _FULL_DIGEST.fullmatch(value):
        raise ValueError(f"{name} must be one SHA-256 digest")
    return value


def _receipt_id(payload: Mapping[str, Any]) -> str:
    canonical = {k: v for k, v in payload.items() if k not in {"generated_at", "receipt_id"}}
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return _sha256(encoded)


def _input_fingerprint(payload: Mapping[str, Any]) -> str:
    keys = (
        "target_sha",
        "target_tree",
        "accepted_ref_sha",
        "preflight",
        "dependencies",
        "runtime",
        "public_build_env",
        "next_build_keys",
    )
    try:
        canonical = {key: payload[key] for key in keys}
    except KeyError as exc:
        raise ValueError(f"build receipt missing input field: {exc.args[0]}") from exc
    return _sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )


def _validated_receipt(path: Path) -> Mapping[str, Any]:
    value = _json_object(path, limit=_MAX_RECEIPT_BYTES)
    if value.get("schema") != SCHEMA:
        raise ValueError(f"unexpected build receipt schema: {path}")
    receipt_id = value.get("receipt_id")
    if not isinstance(receipt_id, str) or not _FULL_DIGEST.fullmatch(receipt_id):
        raise ValueError(f"invalid build receipt id: {path}")
    if receipt_id != _receipt_id(value):
        raise ValueError(f"build receipt id mismatch: {path}")
    fingerprint = value.get("input_fingerprint")
    if not isinstance(fingerprint, str) or not _FULL_DIGEST.fullmatch(fingerprint):
        raise ValueError(f"invalid build input fingerprint: {path}")
    if fingerprint != _input_fingerprint(value):
        raise ValueError(f"build input fingerprint mismatch: {path}")
    output = value.get("output")
    if not isinstance(output, Mapping):
        raise ValueError(f"build receipt output is invalid: {path}")
    digest = output.get("serving_digest")
    if not isinstance(digest, str) or not _FULL_DIGEST.fullmatch(digest):
        raise ValueError(f"build receipt serving digest is invalid: {path}")
    return value


def _enforce_reproducibility(root: Path, receipt: Mapping[str, Any]) -> None:
    fingerprint = receipt.get("input_fingerprint")
    output = receipt.get("output")
    if not isinstance(fingerprint, str) or not isinstance(output, Mapping):
        raise ValueError("new build receipt lacks reproducibility evidence")
    existing = sorted(root.glob("*.json"))
    if len(existing) > _MAX_RECEIPTS:
        raise ValueError("build receipt root exceeds bounded reproducibility history")
    for path in existing:
        prior = _validated_receipt(path)
        if prior.get("input_fingerprint") != fingerprint:
            continue
        prior_output = prior.get("output")
        assert isinstance(prior_output, Mapping)
        for key in ("serving_digest", "build_id", "serving_files"):
            if prior_output.get(key) != output.get(key):
                raise ValueError(
                    f"non-reproducible serving output for identical build inputs: {key}"
                )


def build_receipt(args: argparse.Namespace, *, now: datetime | None = None) -> dict[str, Any]:
    root = Path(args.terminal_root).resolve(strict=True)
    build_id_bytes, _ = _stable_regular_bytes(root / ".next" / "BUILD_ID", limit=4096)
    build_id = build_id_bytes.decode("utf-8").strip()
    if not build_id or any(ch in build_id for ch in "\r\n\t"):
        raise ValueError("BUILD_ID is invalid")
    serving_digest, serving_files = compute_serving_digest(root)
    package_bytes, _ = _stable_regular_bytes(root / "package.json", limit=4 * 1024 * 1024)
    lock_bytes, _ = _stable_regular_bytes(root / "package-lock.json", limit=64 * 1024 * 1024)
    public_env = _identity_file(Path(args.public_env_identity))
    if public_env.get("schema") != "mastermind.terminal.public_build_env_identity.v1":
        raise ValueError("public build env identity schema is invalid")
    build_keys = _identity_file(Path(args.build_key_identity))
    if build_keys.get("schema") != "mastermind.terminal.next_build_key_identity.v1":
        raise ValueError("Next build key identity schema is invalid")
    key_files = build_keys.get("files")
    if not isinstance(key_files, Mapping) or set(key_files) != {".previewinfo", ".rscinfo"}:
        raise ValueError("Next build key identity must bind exactly two cache files")
    for name, evidence in key_files.items():
        if not isinstance(evidence, Mapping):
            raise ValueError(f"Next build key evidence is invalid: {name}")
        expected = evidence.get("sha256")
        if not isinstance(expected, str) or not _FULL_DIGEST.fullmatch(expected):
            raise ValueError(f"Next build key digest is invalid: {name}")
        payload, _ = _stable_regular_bytes(root / ".next" / "cache" / name, limit=4096)
        if _sha256(payload) != expected:
            raise ValueError(f"Next build key cache changed during build: {name}")
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    receipt: dict[str, Any] = {
        "schema": SCHEMA,
        "generated_at": observed.isoformat().replace("+00:00", "Z"),
        "result": "BUILT",
        "target_sha": _require_sha("target_sha", args.target_sha),
        "target_tree": _require_sha("target_tree", args.target_tree),
        "accepted_ref_sha": _require_sha("accepted_ref_sha", args.accepted_ref_sha),
        "preflight": {
            "accepted_sha": _require_sha("preflight_accepted_sha", args.preflight_accepted_sha),
            "receipt_id": _require_digest("preflight_receipt_id", args.preflight_receipt_id),
            "source_audit_receipt_id": _require_digest(
                "preflight_source_receipt_id", args.preflight_source_receipt_id
            ),
            "policy_digest": _require_digest("preflight_policy_digest", args.preflight_policy_digest),
        },
        "dependencies": {
            "package_json_sha256": _sha256(package_bytes),
            "package_lock_sha256": _sha256(lock_bytes),
        },
        "runtime": {
            "node_path": args.node_path,
            "node": args.node_version,
            "npm_path": args.npm_path,
            "npm": args.npm_version,
            "os": args.build_os,
            "arch": args.build_arch,
            "os_id": args.os_id,
            "os_version_id": args.os_version_id,
            "libc": args.libc,
        },
        "public_build_env": public_env,
        "next_build_keys": build_keys,
        "output": {
            "build_id": build_id,
            "serving_digest": serving_digest,
            "serving_files": serving_files,
        },
    }
    receipt["input_fingerprint"] = _input_fingerprint(receipt)
    receipt["receipt_id"] = _receipt_id(receipt)
    return receipt


def _verify_receipt_dir(path: Path) -> Path:
    if not path.is_absolute():
        raise ValueError("build receipt root must be absolute")
    metadata = os.lstat(path)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError("build receipt root is not a real directory")
    resolved = path.resolve(strict=True)
    if resolved != path:
        raise ValueError("build receipt root must not traverse aliases or symlinks")
    if stat.S_IMODE(metadata.st_mode) != 0o750:
        raise ValueError("build receipt root must be mode 0750")
    if metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError("build receipt root must not be group/other writable")
    if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid():
        raise ValueError("build receipt root owner/group differs from executor")
    return resolved


def publish_receipt(receipt_dir: str | os.PathLike[str], receipt: Mapping[str, Any]) -> Path:
    root = _verify_receipt_dir(Path(receipt_dir))
    _enforce_reproducibility(root, receipt)
    receipt_id = receipt.get("receipt_id")
    target = receipt.get("target_sha")
    generated = receipt.get("generated_at")
    if not isinstance(receipt_id, str) or not _FULL_DIGEST.fullmatch(receipt_id):
        raise ValueError("receipt_id is invalid")
    if not isinstance(target, str) or not _FULL_SHA.fullmatch(target):
        raise ValueError("target_sha is invalid")
    if not isinstance(generated, str):
        raise ValueError("generated_at is invalid")
    stamp = re.sub(r"[^0-9TZ]", "", generated)[:16]
    final = root / f"{stamp}-{target}-{receipt_id}.json"
    payload = (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode("utf-8")
    fd, temporary_name = tempfile.mkstemp(prefix=".terminal-build.", dir=root)
    temporary = Path(temporary_name)
    linked = False
    try:
        os.fchmod(fd, 0o640)
        with os.fdopen(fd, "wb") as handle:
            fd = -1
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, final, follow_symlinks=False)
            linked = True
        except FileExistsError as exc:
            raise FileExistsError("immutable build receipt already exists") from exc
        directory_fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if fd >= 0:
            os.close(fd)
        temporary.unlink(missing_ok=True)
        directory_fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    if not linked:
        raise RuntimeError("build receipt publication failed")
    readback = _validated_receipt(final)
    if dict(readback) != dict(receipt):
        raise ValueError("published build receipt readback disagrees with generated evidence")
    metadata = os.lstat(final)
    if stat.S_IMODE(metadata.st_mode) != 0o640:
        raise ValueError("published build receipt mode is not 0640")
    if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid():
        raise ValueError("published build receipt owner/group differs from executor")
    return final


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--terminal-root", required=True)
    p.add_argument("--receipt-dir", required=True)
    p.add_argument("--target-sha", required=True)
    p.add_argument("--target-tree", required=True)
    p.add_argument("--accepted-ref-sha", required=True)
    p.add_argument("--preflight-accepted-sha", required=True)
    p.add_argument("--preflight-receipt-id", required=True)
    p.add_argument("--preflight-source-receipt-id", required=True)
    p.add_argument("--preflight-policy-digest", required=True)
    p.add_argument("--node-path", required=True)
    p.add_argument("--node-version", required=True)
    p.add_argument("--npm-path", required=True)
    p.add_argument("--npm-version", required=True)
    p.add_argument("--build-os", required=True)
    p.add_argument("--build-arch", required=True)
    p.add_argument("--os-id", required=True)
    p.add_argument("--os-version-id", required=True)
    p.add_argument("--libc", required=True)
    p.add_argument("--public-env-identity", required=True)
    p.add_argument("--build-key-identity", required=True)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    receipt = build_receipt(args)
    path = publish_receipt(args.receipt_dir, receipt)
    print(json.dumps({
        "schema": SCHEMA,
        "result": receipt["result"],
        "target_sha": receipt["target_sha"],
        "receipt_id": receipt["receipt_id"],
        "receipt_path": str(path),
        "input_fingerprint": receipt["input_fingerprint"],
        "serving_digest": receipt["output"]["serving_digest"],
        "serving_files": receipt["output"]["serving_files"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
