#!/usr/bin/env python3
"""Trusted-base PR scope for Terminal CI.

A pull request whose effective change is prose only (``docs/**``,
``terminal/docs/**`` and Markdown outside ``.github/``) gets ``mode=docs``:
the workflow then skips the unit, e2e, ingest and PostgreSQL machinery and
reports the required contexts green from their own bounded steps. Anything
else, and anything this script cannot qualify, is ``mode=full`` — the exact
behaviour the workflow had before this script existed.

The decision is taken from Git objects only, never from PR text, and the
workflow executes this file from the protected base commit (``HEAD^1`` of the
pull-request merge commit), so a pull request cannot reclassify itself.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

_SHA_LEN = 40
_DOCS_TREES = ("docs/", "terminal/docs/")
_NEVER_DOCS_PREFIX = (".github/",)


class ScopeUnqualified(ValueError):
    """The diff could not be qualified; the caller must fall back to full."""


@dataclass(frozen=True)
class ScopeDecision:
    mode: str
    reason: str
    changed: int

    def as_output(self) -> str:
        return f"mode={self.mode}\nreason={self.reason}\nchanged={self.changed}\n"


def _git(root: Path, *args: str) -> bytes:
    proc = subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        check=False,
        timeout=120,
    )
    if proc.returncode != 0:
        raise ScopeUnqualified(
            "GIT_" + (args[0].upper().replace("-", "_")) + "_FAILED: "
            + proc.stderr.decode("utf-8", "replace").strip()[:200]
        )
    return proc.stdout


def _decode(name: bytes) -> str:
    try:
        return name.decode("utf-8")
    except UnicodeDecodeError:
        raise ScopeUnqualified("PATH_NOT_UTF8") from None


def is_docs_path(path: str) -> bool:
    """Prose and evidence trees whose content nothing in CI executes or imports."""
    if not path or path.startswith(_NEVER_DOCS_PREFIX):
        return False
    if path.startswith(_DOCS_TREES):
        return True
    return path.endswith(".md")


def _name_status(raw: bytes) -> list[tuple[str, tuple[str, ...]]]:
    """Parse ``git diff --name-status -z`` into (status, paths) rows."""
    fields = raw.split(b"\x00")
    if fields and fields[-1] == b"":
        fields.pop()
    rows: list[tuple[str, tuple[str, ...]]] = []
    i = 0
    while i < len(fields):
        status = _decode(fields[i])
        kind = status[:1]
        if kind in ("R", "C"):
            if i + 2 >= len(fields):
                raise ScopeUnqualified("DIFF_RENAME_ROW_TRUNCATED")
            rows.append((kind, (_decode(fields[i + 1]), _decode(fields[i + 2]))))
            i += 3
        elif kind in ("A", "M", "D", "T"):
            if i + 1 >= len(fields):
                raise ScopeUnqualified("DIFF_ROW_TRUNCATED")
            rows.append((kind, (_decode(fields[i + 1]),)))
            i += 2
        else:
            raise ScopeUnqualified(f"DIFF_STATUS_UNKNOWN:{status[:8]}")
    return rows


def classify(repo: Path, *, expected_base: str) -> ScopeDecision:
    root = repo.resolve(strict=True)
    if len(expected_base) != _SHA_LEN or any(c not in "0123456789abcdef" for c in expected_base):
        raise ScopeUnqualified("BASE_SHA_UNQUALIFIED")
    parents = _git(root, "rev-list", "--parents", "-n", "1", "HEAD").decode("ascii").split()
    if len(parents) != 3:
        raise ScopeUnqualified("HEAD_NOT_A_TWO_PARENT_MERGE")
    if parents[1] != expected_base:
        raise ScopeUnqualified("MERGE_FIRST_PARENT_IS_NOT_THE_EVENT_BASE")
    rows = _name_status(_git(
        root, "diff", "--name-status", "-z", "--find-renames", "--no-ext-diff",
        "HEAD^1", "HEAD",
    ))
    if not rows:
        raise ScopeUnqualified("DIFF_EMPTY")
    touched: set[str] = set()
    present: set[str] = set()
    for kind, paths in rows:
        touched.update(paths)
        if kind != "D":
            present.add(paths[-1])
    # A symlink, executable bit, submodule or type change can be a new
    # execution or data boundary even under a prose-looking name. Every
    # surviving path must be an exact regular 100644 blob in the head tree.
    if present:
        raw_tree = _git(root, "ls-tree", "-r", "-z", "HEAD", "--", *sorted(present))
        if not raw_tree.endswith(b"\x00"):
            raise ScopeUnqualified("GIT_TREE_INCOMPLETE")
        seen: set[str] = set()
        for record in raw_tree[:-1].split(b"\x00"):
            try:
                metadata, name = record.split(b"\t", 1)
                mode, kind, _ = metadata.split(b" ")
            except ValueError:
                raise ScopeUnqualified("GIT_TREE_RECORD_MALFORMED") from None
            path = _decode(name)
            if mode != b"100644" or kind != b"blob" or path in seen:
                raise ScopeUnqualified("GIT_EXECUTABLE_SYMLINK_OR_SUBMODULE")
            seen.add(path)
        if seen != present:
            raise ScopeUnqualified("GIT_TREE_FILE_COVERAGE_INVALID")
    non_docs = sorted(path for path in touched if not is_docs_path(path))
    if non_docs:
        return ScopeDecision("full", "SOURCE_TOUCHED:" + non_docs[0][:120], len(touched))
    return ScopeDecision("docs", "PROSE_ONLY", len(touched))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Trusted-base Terminal CI scope")
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--output", type=Path, help="GITHUB_OUTPUT file to append to")
    args = parser.parse_args(argv)
    try:
        decision = classify(args.repo, expected_base=args.base_sha)
    except (ScopeUnqualified, OSError, subprocess.SubprocessError, ValueError) as exc:
        decision = ScopeDecision("full", f"UNQUALIFIED:{str(exc)[:160]}", 0)
    if args.output is not None:
        with args.output.open("a", encoding="utf-8") as handle:
            handle.write(decision.as_output())
    print(f"CI_SCOPE mode={decision.mode} changed={decision.changed} reason={decision.reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
