#!/usr/bin/env python3
"""Materialize the reviewed Terminal build projection from exact Git objects.

This helper deliberately does not use ``git archive``: repository-local
attributes may transform or omit paths without changing the admitted tree.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Sequence

SCHEMA = "mastermind.terminal.build_projection.v1"
POLICY_SCHEMA = "mastermind.terminal.build_projection_policy.v1"
_FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
_SAFE_ROOT = re.compile(r"^[A-Za-z0-9._-]+$")
_EVIDENCE_FILENAMES = {
    "projection_helper": "projection-helper.py",
    "projection_policy": "projection-policy.json",
    "receipt_helper": "receipt-helper.py",
    "package_json": "package.json",
    "package_lock": "package-lock.json",
}
_ALLOWED_FILE_MODES = {"100644", "100755", "120000"}
_READABLE_EVIDENCE_FILES = {"package.json", "package-lock.json"}


def _evidence_mode(name: str) -> int:
    return 0o444 if name in _READABLE_EVIDENCE_FILES else 0o400


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _stable_bytes(path: Path, *, limit: int = 4 * 1024 * 1024) -> bytes:
    expected = os.lstat(path)
    if stat.S_ISLNK(expected.st_mode) or not stat.S_ISREG(expected.st_mode):
        raise ValueError(f"expected real regular file: {path}")
    if expected.st_size > limit:
        raise ValueError(f"file exceeds size bound: {path}")
    flags = (
        os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    )
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        payload = os.read(fd, limit + 1)
        after = os.fstat(fd)
    finally:
        os.close(fd)
    identity = lambda item: (
        item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid,
        item.st_size, item.st_mtime_ns,
    )
    if len(payload) > limit or identity(expected) != identity(before) or identity(before) != identity(after):
        raise ValueError(f"file changed while read: {path}")
    return payload


def _load_json(path: Path) -> Mapping[str, Any]:
    payload = _stable_bytes(path)

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


def _closed_git_env() -> dict[str, str]:
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": "/nonexistent",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "UTC",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_SYSTEM": "/dev/null",
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "/bin/false",
        "GIT_LITERAL_PATHSPECS": "1",
    }


def _git(git_path: str, repository: Path, *args: str, input_bytes: bytes | None = None) -> bytes:
    result = subprocess.run(
        [git_path, "-C", str(repository), *args],
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_closed_git_env(),
        check=False,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"Git object read failed ({' '.join(args)}): {detail}")
    return result.stdout


def _parse_tree(payload: bytes) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in payload.split(b"\0"):
        if not raw:
            continue
        try:
            metadata, path_bytes = raw.split(b"\t", 1)
            mode_b, kind_b, oid_b = metadata.split(b" ", 2)
            path = path_bytes.decode("utf-8")
            mode = mode_b.decode("ascii")
            kind = kind_b.decode("ascii")
            oid = oid_b.decode("ascii")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError("Git tree record is malformed") from exc
        if path in seen:
            raise ValueError(f"duplicate Git tree path: {path}")
        if not _FULL_SHA.fullmatch(oid):
            raise ValueError(f"Git tree object id is invalid: {path}")
        seen.add(path)
        rows.append({"path": path, "mode": mode, "type": kind, "oid": oid})
    return rows


def _validate_policy(value: Mapping[str, Any]) -> tuple[list[str], list[str], Mapping[str, str]]:
    if set(value) != {"schema", "included_roots", "excluded_roots", "controller_evidence"}:
        raise ValueError("projection policy has unknown or missing fields")
    if value.get("schema") != POLICY_SCHEMA:
        raise ValueError("projection policy schema is invalid")

    def roots(name: str) -> list[str]:
        raw = value.get(name)
        if not isinstance(raw, list) or not raw or any(not isinstance(item, str) for item in raw):
            raise ValueError(f"projection policy {name} is invalid")
        if raw != sorted(set(raw)):
            raise ValueError(f"projection policy {name} must be sorted and unique")
        if any(not _SAFE_ROOT.fullmatch(item) or "/" in item or item in {".", ".."} for item in raw):
            raise ValueError(f"projection policy {name} contains an invalid root")
        return list(raw)

    included = roots("included_roots")
    excluded = roots("excluded_roots")
    if set(included).intersection(excluded):
        raise ValueError("projection policy root sets overlap")
    evidence = value.get("controller_evidence")
    if not isinstance(evidence, Mapping) or set(evidence) != set(_EVIDENCE_FILENAMES):
        raise ValueError("projection policy controller evidence is invalid")
    normalized: dict[str, str] = {}
    for name, raw_path in evidence.items():
        if not isinstance(raw_path, str):
            raise ValueError("projection policy evidence path is invalid")
        parsed = PurePosixPath(raw_path)
        if parsed.is_absolute() or not parsed.parts or any(part in {"", ".", ".."} for part in parsed.parts):
            raise ValueError("projection policy evidence path escapes the repository")
        normalized[str(name)] = parsed.as_posix()
    return included, excluded, normalized


def _real_empty_directory(path: Path, *, evidence: bool = False) -> Path:
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise ValueError(f"projection destination must be a real directory: {path}")
    if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid():
        raise ValueError(f"projection destination owner/group differs from executor: {path}")
    if metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError(f"projection destination is group/other writable: {path}")
    if evidence and stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError(f"controller evidence directory must be private: {path}")
    entries = list(path.iterdir())
    if evidence:
        allowed = set(_EVIDENCE_FILENAMES.values())
        unexpected = sorted(item.name for item in entries if item.name not in allowed)
        if unexpected:
            raise ValueError(f"controller evidence directory has unexpected preseeded paths: {unexpected}")
        for item in entries:
            item_metadata = os.lstat(item)
            if stat.S_ISLNK(item_metadata.st_mode) or not stat.S_ISREG(item_metadata.st_mode):
                raise ValueError(f"preseeded controller evidence is not a real file: {item}")
            if item_metadata.st_uid != os.geteuid() or item_metadata.st_gid != os.getegid():
                raise ValueError(f"preseeded controller evidence owner/group differs from executor: {item}")
            expected_mode = _evidence_mode(item.name)
            if stat.S_IMODE(item_metadata.st_mode) != expected_mode:
                raise ValueError(
                    f"preseeded controller evidence mode must be {expected_mode:04o}: {item}"
                )
    elif entries:
        raise ValueError(f"projection destination is not empty: {path}")
    resolved = path.resolve(strict=True)
    if resolved != path:
        raise ValueError(f"projection destination traverses an alias: {path}")
    return resolved


def _safe_repo_path(raw: str, included_roots: set[str]) -> PurePosixPath:
    parsed = PurePosixPath(raw)
    if parsed.is_absolute() or not parsed.parts or any(part in {"", ".", ".."} for part in parsed.parts):
        raise ValueError(f"Git projection path escapes its root: {raw}")
    if parsed.parts[0] not in included_roots:
        raise ValueError(f"Git projection path is outside included roots: {raw}")
    if any(ord(char) < 32 or ord(char) == 127 for char in raw):
        raise ValueError(f"Git projection path contains control characters: {raw!r}")
    return parsed


def _resolved_link(path: PurePosixPath, target: str, included_roots: set[str]) -> PurePosixPath:
    link = PurePosixPath(target)
    if link.is_absolute() or "\x00" in target or "\n" in target or "\r" in target:
        raise ValueError(f"projection symlink is absolute or malformed: {path}")
    parts = list(path.parent.parts)
    for part in link.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if not parts:
                raise ValueError(f"projection symlink escapes the projection: {path}")
            parts.pop()
        else:
            parts.append(part)
    if not parts or parts[0] not in included_roots:
        raise ValueError(f"projection symlink escapes the projection: {path}")
    return PurePosixPath(*parts)


def _validate_symlink_graph(
    links: Mapping[PurePosixPath, str], included_roots: set[str]
) -> None:
    """Resolve every projected link component-by-component before writing bytes.

    A lexical target may look in-bounds while an intermediate symlink changes the
    meaning of later ``..`` components. Resolve the complete admitted link graph,
    reject repeated links/cycles, and refuse the first attempt to walk above the
    projection root.
    """

    def resolve(link_path: PurePosixPath) -> PurePosixPath:
        target = links[link_path]
        target_path = PurePosixPath(target)
        if target_path.is_absolute() or any(char in target for char in "\x00\n\r"):
            raise ValueError(f"projection symlink is absolute or malformed: {link_path}")
        queue = list(link_path.parent.parts) + list(target_path.parts)
        resolved: list[str] = []
        visited: set[PurePosixPath] = set()
        hops = 0
        while queue:
            part = queue.pop(0)
            if part in {"", "."}:
                continue
            if part == "..":
                if not resolved:
                    raise ValueError(f"projection symlink escapes the projection: {link_path}")
                resolved.pop()
                continue
            resolved.append(part)
            candidate = PurePosixPath(*resolved)
            nested = links.get(candidate)
            if nested is None:
                continue
            if candidate in visited:
                raise ValueError(f"projection symlink cycle/revisit is forbidden: {link_path}")
            visited.add(candidate)
            hops += 1
            if hops > len(links) + 1:
                raise ValueError(f"projection symlink cycle is forbidden: {link_path}")
            nested_path = PurePosixPath(nested)
            if nested_path.is_absolute() or any(char in nested for char in "\x00\n\r"):
                raise ValueError(f"projection symlink is absolute or malformed: {candidate}")
            resolved.pop()
            queue = list(nested_path.parts) + queue
        if not resolved or resolved[0] not in included_roots:
            raise ValueError(f"projection symlink escapes the projection: {link_path}")
        return PurePosixPath(*resolved)

    for link_path in sorted(links, key=lambda item: item.as_posix()):
        resolve(link_path)


def _write_regular(path: Path, payload: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o600)
    try:
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
        os.fchmod(fd, mode)
    finally:
        os.close(fd)


def _single_path_entry(git_path: str, repository: Path, target_sha: str, path: str) -> dict[str, str]:
    rows = _parse_tree(_git(git_path, repository, "ls-tree", "-z", target_sha, "--", path))
    if len(rows) != 1 or rows[0]["path"] != path:
        raise ValueError(f"controller evidence path is absent or ambiguous: {path}")
    row = rows[0]
    if row["type"] != "blob" or row["mode"] not in {"100644", "100755"}:
        raise ValueError(f"controller evidence path is not a regular blob: {path}")
    return row


def _verify_projection(destination: Path, entries: list[Mapping[str, Any]]) -> None:
    expected_leaves = {str(entry["path"]) for entry in entries}
    actual_leaves: set[str] = set()
    for path in destination.rglob("*"):
        relative = path.relative_to(destination).as_posix()
        metadata = os.lstat(path)
        if stat.S_ISDIR(metadata.st_mode):
            continue
        actual_leaves.add(relative)
    if actual_leaves != expected_leaves:
        raise ValueError("materialized projection path inventory disagrees with admitted tree")
    for entry in entries:
        path = destination / str(entry["path"])
        metadata = os.lstat(path)
        mode = str(entry["mode"])
        if mode == "120000":
            if not stat.S_ISLNK(metadata.st_mode) or os.readlink(path) != entry["target"]:
                raise ValueError(f"materialized symlink disagrees with admitted tree: {path}")
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"materialized projection contains a non-regular file: {path}")
        payload = _stable_bytes(path, limit=max(int(entry["bytes"]), 1))
        if len(payload) != entry["bytes"] or _sha256(payload) != entry["sha256"]:
            raise ValueError(f"materialized projection blob disagrees with admitted tree: {path}")
        expected_mode = 0o755 if mode == "100755" else 0o644
        if stat.S_IMODE(metadata.st_mode) != expected_mode:
            raise ValueError(f"materialized projection mode disagrees with admitted tree: {path}")


def _atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    data = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            fd = -1
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if fd >= 0:
            os.close(fd)
        temporary.unlink(missing_ok=True)


def materialize_projection(
    *,
    repository: str | os.PathLike[str],
    target_sha: str,
    destination: str | os.PathLike[str],
    evidence_dir: str | os.PathLike[str],
    policy_path: str | os.PathLike[str],
    git_path: str = "/usr/bin/git",
) -> dict[str, Any]:
    repo = Path(repository).resolve(strict=True)
    dest = _real_empty_directory(Path(destination).resolve(strict=True))
    evidence_root = _real_empty_directory(Path(evidence_dir).resolve(strict=True), evidence=True)
    if not Path(git_path).is_absolute() or not Path(git_path).is_file() or Path(git_path).is_symlink():
        raise ValueError("Git executable must be one pinned real absolute file")
    if not _FULL_SHA.fullmatch(target_sha):
        raise ValueError("target_sha must be one full lower-case commit SHA")
    policy_file = Path(policy_path).resolve(strict=True)
    policy_value = _load_json(policy_file)
    included, excluded, evidence_paths = _validate_policy(policy_value)
    policy_digest = _sha256(_canonical(policy_value))

    resolved = _git(git_path, repo, "rev-parse", "--verify", f"{target_sha}^{{commit}}").decode().strip()
    if resolved != target_sha:
        raise ValueError("target_sha did not resolve to the exact commit")
    target_tree = _git(git_path, repo, "rev-parse", "--verify", f"{target_sha}^{{tree}}").decode().strip()
    if not _FULL_SHA.fullmatch(target_tree):
        raise ValueError("target tree identity is invalid")

    root_rows = _parse_tree(_git(git_path, repo, "ls-tree", "-z", target_sha))
    root_by_path = {row["path"]: row for row in root_rows}
    policy_roots = set(included) | set(excluded)
    if set(root_by_path) != policy_roots:
        missing = sorted(policy_roots - set(root_by_path))
        unexpected = sorted(set(root_by_path) - policy_roots)
        raise ValueError(f"repository root disagrees with closed projection policy: missing={missing} unexpected={unexpected}")
    for root in included:
        row = root_by_path[root]
        if row["mode"] != "040000" or row["type"] != "tree":
            raise ValueError(f"included projection root is not a tree: {root}")

    entries = _parse_tree(
        _git(git_path, repo, "ls-tree", "-r", "-z", "--full-tree", target_sha, "--", *included)
    )
    included_set = set(included)
    symlink_targets: dict[PurePosixPath, str] = {}
    for row in entries:
        if row["mode"] != "120000":
            continue
        parsed = _safe_repo_path(row["path"], included_set)
        payload = _git(git_path, repo, "cat-file", "blob", row["oid"])
        try:
            target = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(f"projection symlink target is not UTF-8: {row['path']}") from exc
        _resolved_link(parsed, target, included_set)
        symlink_targets[parsed] = target
    _validate_symlink_graph(symlink_targets, included_set)

    manifest_entries: list[dict[str, Any]] = []
    symlinks: list[tuple[Path, str]] = []
    for row in entries:
        parsed = _safe_repo_path(row["path"], included_set)
        if row["mode"] == "160000" or row["type"] == "commit":
            raise ValueError(f"gitlink/submodule is forbidden in build projection: {row['path']}")
        if row["type"] != "blob" or row["mode"] not in _ALLOWED_FILE_MODES:
            raise ValueError(f"unsupported Git mode in build projection: {row['path']} mode={row['mode']}")
        payload = _git(git_path, repo, "cat-file", "blob", row["oid"])
        output = dest / parsed.as_posix()
        manifest_entry: dict[str, Any] = dict(row)
        manifest_entry["bytes"] = len(payload)
        manifest_entry["sha256"] = _sha256(payload)
        if row["mode"] == "120000":
            try:
                target = payload.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ValueError(f"projection symlink target is not UTF-8: {row['path']}") from exc
            _resolved_link(parsed, target, included_set)
            output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            symlinks.append((output, target))
            manifest_entry["target"] = target
        else:
            _write_regular(output, payload, 0o755 if row["mode"] == "100755" else 0o644)
        manifest_entries.append(manifest_entry)
    for output, target in symlinks:
        os.symlink(target, output)

    evidence_manifest: dict[str, Any] = {}
    for name, source_path in evidence_paths.items():
        row = _single_path_entry(git_path, repo, target_sha, source_path)
        payload = _git(git_path, repo, "cat-file", "blob", row["oid"])
        output_name = _EVIDENCE_FILENAMES[name]
        output_path = evidence_root / output_name
        expected_mode = _evidence_mode(output_name)
        if output_path.exists():
            existing = _stable_bytes(output_path, limit=max(len(payload), 1))
            metadata = os.lstat(output_path)
            if existing != payload or stat.S_IMODE(metadata.st_mode) != expected_mode:
                raise ValueError(f"preseeded controller evidence disagrees with admitted target: {source_path}")
        else:
            _write_regular(output_path, payload, expected_mode)
        evidence_manifest[name] = {
            "source_path": source_path,
            "file": output_name,
            "mode": row["mode"],
            "oid": row["oid"],
            "bytes": len(payload),
            "sha256": _sha256(payload),
        }

    _verify_projection(dest, manifest_entries)
    result: dict[str, Any] = {
        "schema": SCHEMA,
        "target_sha": target_sha,
        "target_tree": target_tree,
        "policy_sha256": policy_digest,
        "included_roots": included,
        "included_root_objects": [root_by_path[name] for name in included],
        "excluded_roots": [root_by_path[name] for name in excluded],
        "entries": manifest_entries,
        "controller_evidence": evidence_manifest,
    }
    result["projection_sha256"] = _sha256(_canonical(result))
    _atomic_json(evidence_root / "projection-manifest.json", result)
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--git-path", default="/usr/bin/git")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    result = materialize_projection(
        repository=args.repository,
        target_sha=args.target_sha,
        destination=args.destination,
        evidence_dir=args.evidence_dir,
        policy_path=args.policy,
        git_path=args.git_path,
    )
    print(json.dumps({
        "schema": result["schema"],
        "target_sha": result["target_sha"],
        "target_tree": result["target_tree"],
        "projection_sha256": result["projection_sha256"],
        "manifest": str(Path(args.evidence_dir) / "projection-manifest.json"),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
