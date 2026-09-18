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
_PUBLIC_ENV_NAMES = (
    "NEXT_PUBLIC_LOGO_DEV_TOKEN",
    "NEXT_PUBLIC_MM_AUTH_COOKIE_DOMAIN",
    "NEXT_PUBLIC_POLYGON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
)
_KEY_FILES = (".previewinfo", ".rscinfo")
_RECEIPT_FIELDS = {
    "schema", "generated_at", "result", "target_sha", "target_tree",
    "projection", "application_root", "accepted_ref_sha", "preflight",
    "dependencies", "runtime", "builder", "sandbox", "public_build_env",
    "next_build_keys", "output", "input_fingerprint", "receipt_id",
}
_SANDBOX_COMMON_PROPERTIES = (
    "AmbientCapabilities=",
    "CapabilityBoundingSet=",
    "LockPersonality=yes",
    "NoNewPrivileges=yes",
    "PrivateDevices=yes",
    "PrivateTmp=yes",
    "ProtectControlGroups=yes",
    "ProtectHome=yes",
    "ProtectKernelLogs=yes",
    "ProtectKernelModules=yes",
    "ProtectKernelTunables=yes",
    "ProtectSystem=strict",
    "RestrictRealtime=yes",
    "RestrictSUIDSGID=yes",
    "UMask=0077",
)
_SANDBOX_PHASES = {
    "install": {
        "private_network": False,
        "read_only_inputs": ["package.json", "package-lock.json"],
        "writable_roots": ["dependencies", "home", "npm_cache", "temporary"],
    },
    "build": {
        "private_network": True,
        "read_only_inputs": ["source", "node_modules"],
        "writable_roots": [".next", "home", "npm_cache", "temporary"],
    },
}


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
            metadata = os.lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode):
                raise ValueError(f"serving subtree contains symlink: {candidate}")
            if stat.S_ISDIR(metadata.st_mode):
                continue
            if not stat.S_ISREG(metadata.st_mode):
                raise ValueError(f"serving subtree contains special file: {candidate}")
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



def _validate_public_identity(value: Mapping[str, Any]) -> Mapping[str, Any]:
    if set(value) != {"schema", "entries"}:
        raise ValueError("public build env identity has unknown or missing fields")
    if value.get("schema") != "mastermind.terminal.public_build_env_identity.v1":
        raise ValueError("public build env identity schema is invalid")
    entries = value.get("entries")
    if not isinstance(entries, list) or len(entries) != len(_PUBLIC_ENV_NAMES):
        raise ValueError("public build env identity entries are invalid")
    for expected_name, entry in zip(_PUBLIC_ENV_NAMES, entries, strict=True):
        if not isinstance(entry, Mapping) or set(entry) != {"name", "present", "bytes", "sha256"}:
            raise ValueError("public build env identity entry has unknown or missing fields")
        if entry.get("name") != expected_name or type(entry.get("present")) is not bool:
            raise ValueError("public build env identity entry is inconsistent")
        size = entry.get("bytes")
        digest = entry.get("sha256")
        if type(size) is not int or size < 0:
            raise ValueError("public build env identity byte count is invalid")
        if entry["present"]:
            if not isinstance(digest, str) or not _FULL_DIGEST.fullmatch(digest):
                raise ValueError("public build env identity digest is invalid")
        elif size != 0 or digest is not None:
            raise ValueError("absent public build env identity entry is inconsistent")
    return value


def _validate_key_identity(value: Mapping[str, Any]) -> Mapping[str, Any]:
    if set(value) != {"schema", "source", "files"}:
        raise ValueError("Next build key identity has unknown or missing fields")
    if value.get("schema") != "mastermind.terminal.next_build_key_identity.v1":
        raise ValueError("Next build key identity schema is invalid")
    if value.get("source") not in {"retained", "rotated"}:
        raise ValueError("Next build key identity source is invalid")
    files = value.get("files")
    if not isinstance(files, Mapping) or set(files) != set(_KEY_FILES):
        raise ValueError("Next build key identity must bind exactly two cache files")
    for name in _KEY_FILES:
        evidence = files[name]
        if not isinstance(evidence, Mapping) or set(evidence) != {"sha256", "expire_at"}:
            raise ValueError(f"Next build key evidence has unknown or missing fields: {name}")
        digest = evidence.get("sha256")
        expiry = evidence.get("expire_at")
        if not isinstance(digest, str) or not _FULL_DIGEST.fullmatch(digest):
            raise ValueError(f"Next build key digest is invalid: {name}")
        if type(expiry) is not int or expiry <= 0:
            raise ValueError(f"Next build key expiry is invalid: {name}")
    return value


def _public_env_file_identity(path: Path) -> list[dict[str, Any]]:
    payload, _ = _stable_regular_bytes(path, limit=_MAX_IDENTITY_BYTES)
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("public build env file must be UTF-8") from exc
    values: dict[str, str] = {}
    for line_no, raw in enumerate(text.splitlines(), 1):
        if not raw:
            continue
        if "=" not in raw:
            raise ValueError(f"public build env file has invalid line {line_no}")
        name, value = raw.split("=", 1)
        if name not in _PUBLIC_ENV_NAMES or name in values:
            raise ValueError(f"public build env file has undeclared or duplicate name: {name}")
        if "\r" in value or "\n" in value or "\x00" in value:
            raise ValueError("public build env file has invalid value")
        values[name] = value
    entries: list[dict[str, Any]] = []
    for name in _PUBLIC_ENV_NAMES:
        if name not in values:
            entries.append({"name": name, "present": False, "bytes": 0, "sha256": None})
            continue
        encoded = values[name].encode("utf-8")
        entries.append({
            "name": name,
            "present": True,
            "bytes": len(encoded),
            "sha256": _sha256(encoded),
        })
    return entries


def _open_trusted_directory(path: Path, *, expected_uid: int, expected_gid: int) -> tuple[int, os.stat_result]:
    expected = os.lstat(path)
    if stat.S_ISLNK(expected.st_mode) or not stat.S_ISDIR(expected.st_mode):
        raise ValueError(f"cache directory must be a real directory: {path}")
    if expected.st_uid != expected_uid or expected.st_gid != expected_gid:
        raise ValueError(f"cache directory owner/group differs from declared build principal: {path}")
    if expected.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError(f"cache directory is group/other writable: {path}")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    actual = os.fstat(fd)
    identity = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid)
    if identity(actual) != identity(expected):
        os.close(fd)
        raise ValueError(f"cache directory changed before open: {path}")
    return fd, actual


def _stable_regular_bytes_at(directory_fd: int, name: str, *, limit: int) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(name, flags, dir_fd=directory_fd)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError(f"cache entry is not a bounded regular file: {name}")
        chunks: list[bytes] = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(fd, min(remaining, 64 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        after = os.fstat(fd)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid, item.st_size, item.st_mtime_ns)
        if len(payload) > limit or identity(before) != identity(after):
            raise ValueError(f"cache entry changed while read: {name}")
        return payload
    finally:
        os.close(fd)

def _validate_sandbox_identity(value: Mapping[str, Any]) -> Mapping[str, Any]:
    if set(value) != {"schema", "systemd_run_path", "common_properties", "phases"}:
        raise ValueError("sandbox identity has unknown or missing fields")
    if value.get("schema") != "mastermind.terminal.build_sandbox_identity.v1":
        raise ValueError("sandbox identity schema is invalid")
    if value.get("systemd_run_path") != "/usr/bin/systemd-run":
        raise ValueError("sandbox systemd-run identity is invalid")
    if value.get("common_properties") != list(_SANDBOX_COMMON_PROPERTIES):
        raise ValueError("sandbox common property contract is invalid")
    phases = value.get("phases")
    if not isinstance(phases, Mapping) or set(phases) != set(_SANDBOX_PHASES):
        raise ValueError("sandbox phase contract is invalid")
    for name, expected in _SANDBOX_PHASES.items():
        actual = phases[name]
        if not isinstance(actual, Mapping) or set(actual) != set(expected):
            raise ValueError(f"sandbox phase has unknown or missing fields: {name}")
        if dict(actual) != expected:
            raise ValueError(f"sandbox phase contract is invalid: {name}")
    return value


def _validate_builder(value: Mapping[str, Any]) -> Mapping[str, Any]:
    if set(value) != {"user", "group", "uid", "gid", "home", "shell"}:
        raise ValueError("builder identity has unknown or missing fields")
    if value.get("user") != "mastermind-terminal-build":
        raise ValueError("builder user is invalid")
    if value.get("group") != "mastermind-terminal-build":
        raise ValueError("builder group is invalid")
    if value.get("home") != "/nonexistent" or value.get("shell") != "/usr/sbin/nologin":
        raise ValueError("builder home/shell is invalid")
    if type(value.get("uid")) is not int or int(value["uid"]) < 0:
        raise ValueError("builder UID is invalid")
    if type(value.get("gid")) is not int or int(value["gid"]) < 0:
        raise ValueError("builder GID is invalid")
    return value


def _validate_application_root(value: Any, *, terminal_root: Path | None = None) -> str:
    if not isinstance(value, str) or not value.startswith("/"):
        raise ValueError("application_root must be one absolute path")
    if any(char in value for char in "\r\n\t\x00"):
        raise ValueError("application_root contains control characters")
    path = Path(value)
    if terminal_root is not None:
        resolved = path.resolve(strict=True)
        if resolved != terminal_root or path != resolved:
            raise ValueError("application_root disagrees with the exact built Terminal root")
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
    # Admission observations remain in the receipt, but only byte-affecting inputs
    # participate in the reproducibility key.
    keys = (
        "target_sha",
        "target_tree",
        "projection",
        "application_root",
        "builder",
        "sandbox",
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


def _validate_receipt_structure(value: Mapping[str, Any], *, label: str) -> None:
    if set(value) != _RECEIPT_FIELDS:
        raise ValueError(f"{label} has unknown or missing fields")
    if value.get("schema") != SCHEMA or value.get("result") != "BUILT":
        raise ValueError(f"{label} schema/result is invalid")
    generated = value.get("generated_at")
    if not isinstance(generated, str) or not generated.endswith("Z"):
        raise ValueError(f"{label} generated_at is invalid")
    if any(char in generated for char in "\r\n\t"):
        raise ValueError(f"{label} generated_at contains controls")
    _require_sha("target_sha", value.get("target_sha"))
    _require_sha("target_tree", value.get("target_tree"))
    _require_sha("accepted_ref_sha", value.get("accepted_ref_sha"))
    _validate_application_root(value.get("application_root"))

    builder = value.get("builder")
    if not isinstance(builder, Mapping):
        raise ValueError(f"{label} builder identity is invalid")
    _validate_builder(builder)
    sandbox = value.get("sandbox")
    if not isinstance(sandbox, Mapping):
        raise ValueError(f"{label} sandbox identity is invalid")
    _validate_sandbox_identity(sandbox)

    projection = value.get("projection")
    if not isinstance(projection, Mapping):
        raise ValueError(f"{label} projection identity is invalid")
    if set(projection) != {"schema", "policy_sha256", "projection_sha256"}:
        raise ValueError(f"{label} projection identity has unknown or missing fields")
    if projection.get("schema") != "mastermind.terminal.build_projection.v1":
        raise ValueError(f"{label} projection schema is invalid")
    _require_digest("projection policy_sha256", projection.get("policy_sha256"))
    _require_digest("projection projection_sha256", projection.get("projection_sha256"))

    preflight = value.get("preflight")
    preflight_fields = {"accepted_sha", "receipt_id", "source_audit_receipt_id", "policy_digest"}
    if not isinstance(preflight, Mapping) or set(preflight) != preflight_fields:
        raise ValueError(f"{label} preflight identity is invalid")
    _require_sha("preflight accepted_sha", preflight.get("accepted_sha"))
    for key in ("receipt_id", "source_audit_receipt_id", "policy_digest"):
        _require_digest(f"preflight {key}", preflight.get(key))

    dependencies = value.get("dependencies")
    dependency_fields = {"package_json_sha256", "package_lock_sha256"}
    if not isinstance(dependencies, Mapping) or set(dependencies) != dependency_fields:
        raise ValueError(f"{label} dependency identity is invalid")
    for key in dependency_fields:
        _require_digest(key, dependencies.get(key))

    runtime = value.get("runtime")
    runtime_fields = {
        "node_path", "node", "npm_path", "npm", "os", "arch",
        "os_id", "os_version_id", "libc",
    }
    if not isinstance(runtime, Mapping) or set(runtime) != runtime_fields:
        raise ValueError(f"{label} runtime identity is invalid")
    if any(not isinstance(item, str) or not item for item in runtime.values()):
        raise ValueError(f"{label} runtime identity contains invalid values")

    public = value.get("public_build_env")
    if not isinstance(public, Mapping):
        raise ValueError(f"{label} public build identity is invalid")
    _validate_public_identity(public)
    keys = value.get("next_build_keys")
    if not isinstance(keys, Mapping):
        raise ValueError(f"{label} Next build-key identity is invalid")
    _validate_key_identity(keys)

    output = value.get("output")
    if not isinstance(output, Mapping):
        raise ValueError(f"{label} output identity is invalid")
    if set(output) != {"build_id", "serving_digest", "serving_files"}:
        raise ValueError(f"{label} output identity has unknown or missing fields")
    if not isinstance(output.get("build_id"), str) or not output["build_id"]:
        raise ValueError(f"{label} build_id is invalid")
    _require_digest("serving_digest", output.get("serving_digest"))
    if type(output.get("serving_files")) is not int or int(output["serving_files"]) <= 0:
        raise ValueError(f"{label} serving_files is invalid")
    _require_digest("input_fingerprint", value.get("input_fingerprint"))
    _require_digest("receipt_id", value.get("receipt_id"))


def _validated_receipt(path: Path) -> Mapping[str, Any]:
    value = _json_object(path, limit=_MAX_RECEIPT_BYTES)
    _validate_receipt_structure(value, label=f"build receipt {path}")
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



def _projection_identity(path: Path, *, target_sha: str, target_tree: str) -> Mapping[str, str]:
    value = _json_object(path, limit=_MAX_RECEIPT_BYTES)
    expected_fields = {
        "schema", "target_sha", "target_tree", "policy_sha256", "projection_sha256",
        "included_roots", "included_root_objects", "excluded_roots", "entries",
        "controller_evidence",
    }
    if set(value) != expected_fields:
        raise ValueError("projection manifest has unknown or missing fields")
    if value.get("schema") != "mastermind.terminal.build_projection.v1":
        raise ValueError("projection manifest schema is invalid")
    if value.get("target_sha") != target_sha or value.get("target_tree") != target_tree:
        raise ValueError("projection manifest target/tree disagrees with admitted build")
    policy_digest = value.get("policy_sha256")
    projection_digest = value.get("projection_sha256")
    if not isinstance(policy_digest, str) or not _FULL_DIGEST.fullmatch(policy_digest):
        raise ValueError("projection policy digest is invalid")
    if not isinstance(projection_digest, str) or not _FULL_DIGEST.fullmatch(projection_digest):
        raise ValueError("projection digest is invalid")
    canonical = {key: item for key, item in value.items() if key != "projection_sha256"}
    if _sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")) != projection_digest:
        raise ValueError("projection digest disagrees with manifest")
    return {
        "schema": str(value["schema"]),
        "policy_sha256": policy_digest,
        "projection_sha256": projection_digest,
    }

def build_receipt(args: argparse.Namespace, *, now: datetime | None = None) -> dict[str, Any]:
    root = Path(args.terminal_root).resolve(strict=True)
    build_id_bytes, _ = _stable_regular_bytes(root / ".next" / "BUILD_ID", limit=4096)
    build_id = build_id_bytes.decode("utf-8").strip()
    if not build_id or any(ch in build_id for ch in "\r\n\t"):
        raise ValueError("BUILD_ID is invalid")
    serving_digest, serving_files = compute_serving_digest(root)
    package_bytes, _ = _stable_regular_bytes(root / "package.json", limit=4 * 1024 * 1024)
    lock_bytes, _ = _stable_regular_bytes(root / "package-lock.json", limit=64 * 1024 * 1024)
    public_env = _validate_public_identity(_identity_file(Path(args.public_env_identity)))
    observed_public_entries = _public_env_file_identity(Path(args.public_env_file))
    if observed_public_entries != public_env["entries"]:
        raise ValueError("public build env identity and consumed file disagree")
    build_keys = _validate_key_identity(_identity_file(Path(args.build_key_identity)))
    key_files = build_keys["files"]
    cache_dir = root / ".next" / "cache"
    build_uid = int(args.build_uid)
    build_gid = int(args.build_gid)
    if build_uid < 0 or build_gid < 0:
        raise ValueError("build principal UID/GID is invalid")
    cache_fd, cache_before = _open_trusted_directory(
        cache_dir, expected_uid=build_uid, expected_gid=build_gid
    )
    try:
        for name in _KEY_FILES:
            expected = key_files[name]["sha256"]
            payload = _stable_regular_bytes_at(cache_fd, name, limit=4096)
            if _sha256(payload) != expected:
                raise ValueError(f"Next build key cache changed during build: {name}")
        cache_after = os.fstat(cache_fd)
        before_identity = (cache_before.st_dev, cache_before.st_ino, cache_before.st_mode, cache_before.st_uid, cache_before.st_gid)
        after_identity = (cache_after.st_dev, cache_after.st_ino, cache_after.st_mode, cache_after.st_uid, cache_after.st_gid)
        if before_identity != after_identity:
            raise ValueError("Next build key cache directory changed during read")
    finally:
        os.close(cache_fd)
    target_sha = _require_sha("target_sha", args.target_sha)
    target_tree = _require_sha("target_tree", args.target_tree)
    projection = _projection_identity(
        Path(args.projection_manifest), target_sha=target_sha, target_tree=target_tree
    )
    application_root = _validate_application_root(
        args.application_root, terminal_root=root
    )
    builder = _validate_builder({
        "user": args.build_user,
        "group": args.build_group,
        "uid": build_uid,
        "gid": build_gid,
        "home": args.build_home,
        "shell": args.build_shell,
    })
    sandbox = _validate_sandbox_identity(
        _identity_file(Path(args.sandbox_identity))
    )
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    receipt: dict[str, Any] = {
        "schema": SCHEMA,
        "generated_at": observed.isoformat().replace("+00:00", "Z"),
        "result": "BUILT",
        "target_sha": target_sha,
        "target_tree": target_tree,
        "projection": projection,
        "application_root": application_root,
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
        "builder": builder,
        "sandbox": sandbox,
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
    _validate_receipt_structure(receipt, label="generated build receipt")
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
    p.add_argument("--public-env-file", required=True)
    p.add_argument("--build-key-identity", required=True)
    p.add_argument("--projection-manifest", required=True)
    p.add_argument("--build-uid", required=True, type=int)
    p.add_argument("--build-gid", required=True, type=int)
    p.add_argument("--build-user", required=True)
    p.add_argument("--build-group", required=True)
    p.add_argument("--build-home", required=True)
    p.add_argument("--build-shell", required=True)
    p.add_argument("--sandbox-identity", required=True)
    p.add_argument("--application-root", required=True)
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
