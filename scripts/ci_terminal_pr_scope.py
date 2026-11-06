"""Trusted-base Terminal CI scope: passive evidence or bounded visual stylesheet.

This must run from the PROTECTED PR BASE checkout, never PR-authored source.
The existing three protected check names stay unchanged; no queue, approval,
deployment or branch-protection side effect is created here.

Only proven passive evidence/docs or static CSS qualifies for shorter PR CI.
Everything else (unknown/source-law/CI/backend/trading/auth/tests/symlinks,
deletion/rename/executable/binary) runs the existing full Terminal E2E suite.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

_SHA = re.compile(r"^[0-9a-f]{40}$")
_REPOSITORY = "mastermindx-market-intelligence/mastermind-terminal"
_PASSIVE_PREFIXES = ("docs/pr-crops/", "terminal/docs/pr-crops/")
_PASSIVE_SUFFIXES = (".md", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".json")
_CSS_PREFIXES = ("terminal/app/", "terminal/styles/")
_MAX_FILES = 12
_MAX_LINES = 200
_MAX_GIT_OUTPUT = 200_000
_MAX_CSS_BYTES = 180_000
_MAX_EVENT_BYTES = 800_000
_CSS_REMOTE_RE = re.compile(rb"@import\b|url\s*\(|expression\s*\(", re.I)


@dataclass(frozen=True)
class Decision:
    mode: str
    reason: str
    count: int = 0


class Unqualified(ValueError):
    """Missing exact trusted diff or a path outside the safe PR fastlane."""


def _git(root: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            check=True, timeout=12,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        raise Unqualified("GIT_SOURCE_UNAVAILABLE") from None
    if len(result) > _MAX_GIT_OUTPUT:
        raise Unqualified("GIT_SOURCE_OVER_BOUND")
    return result


def _name(raw: bytes) -> str:
    try:
        path = raw.decode("utf-8")
    except UnicodeError:
        raise Unqualified("PATH_ENCODING_UNQUALIFIED") from None
    if not path or "\x00" in path or "\n" in path or "\r" in path or path.startswith("/"):
        raise Unqualified("PATH_UNQUALIFIED")
    return path


def _rows(raw: bytes, *, stat: bool) -> dict[str, tuple[int, int] | str]:
    if not raw.endswith(b"\x00"):
        raise Unqualified("INCOMPLETE_DIFF")
    result = {}
    if not stat:
        # git diff --name-status -z emits STATUS NUL PATH NUL, not a
        # tab-delimited text line. Renames emit multiple path operands and
        # therefore deliberately fail this strict paired-status parser.
        tokens = raw[:-1].split(b"\x00")
        if len(tokens) % 2:
            raise Unqualified("STATUS_PATHS_INCOMPLETE")
        for i in range(0, len(tokens), 2):
            status, name = tokens[i], tokens[i + 1]
            if status not in (b"M", b"A"):
                raise Unqualified("RENAME_DELETE_MODE_CHANGE")
            path = _name(name)
            if path in result:
                raise Unqualified("DUPLICATE_PATH")
            result[path] = status.decode("ascii")
        return result
    for record in raw[:-1].split(b"\x00"):
        if stat:
            fields = record.split(b"\t", 2)
            if len(fields) != 3:
                raise Unqualified("INVALID_NUMSTAT")
            a, d, file = fields
            path = _name(file)
            if a == d == b"-":
                count = (0, 0)
            elif a.isdigit() and d.isdigit():
                count = (int(a), int(d))
            else:
                raise Unqualified("NUMSTAT_INVALID")
            value = count
        else:
            fields = record.split(b"\t", 1)
            if len(fields) != 2 or fields[0] not in (b"M", b"A"):
                raise Unqualified("RENAME_DELETE_MODE_CHANGE")
            path = _name(fields[1])
            value = fields[0].decode("ascii")
        if path in result:
            raise Unqualified("DUPLICATE_PATH")
        result[path] = value
    return result


def _mode(root: Path, head: str, paths: tuple[str, ...]) -> None:
    tree = _git(root, "ls-tree", "-r", "-z", head, "--", *paths)
    if not tree.endswith(b"\x00"):
        raise Unqualified("TREE_UNAVAILABLE")
    matched = set()
    for record in tree[:-1].split(b"\x00"):
        try:
            prefix, raw_path = record.split(b"\t", 1)
            mode, kind, _ = prefix.split(b" ")
        except ValueError:
            raise Unqualified("TREE_INVALID") from None
        path = _name(raw_path)
        if mode != b"100644" or kind != b"blob" or path in matched:
            raise Unqualified("EXECUTABLE_SYMLINK_OR_SUBMODULE")
        matched.add(path)
    if matched != set(paths):
        raise Unqualified("TREE_PATHS_INCOMPLETE")


def qualify(root: Path, event: dict) -> Decision:
    """Classify exact source changes based only on Git and GitHub-owned event."""
    try:
        pr = event["pull_request"]
        num = pr["number"]
        base = pr["base"]["sha"]
        head = pr["head"]["sha"]
        repository = event["repository"]["full_name"]
        head_repo = pr["head"]["repo"]["full_name"]
        base_repo = pr["base"]["repo"]["full_name"]
    except (ValueError, TypeError, KeyError):
        raise Unqualified("SIGNED_EVENT_INCOMPLETE") from None
    if (type(num) is not int or num <= 0 or repository != _REPOSITORY
            or head_repo != _REPOSITORY or base_repo != _REPOSITORY
            or type(base) is not str or type(head) is not str
            or _SHA.fullmatch(base) is None or _SHA.fullmatch(head) is None):
        raise Unqualified("SIGNED_IDENTITY_INVALID")
    root = root.resolve(strict=True)
    if not (root / ".git").exists():
        raise Unqualified("CHECKOUT_UNQUALIFIED")
    _git(root, "cat-file", "-e", base + "^{commit}")
    _git(root, "cat-file", "-e", head + "^{commit}")
    ancestor = _git(root, "merge-base", base, head).decode("ascii").strip()
    if _SHA.fullmatch(ancestor) is None:
        raise Unqualified("MERGE_BASE_INVALID")
    status = _rows(_git(root, "diff", "--name-status", "-z", "--find-renames",
                        "--no-ext-diff", ancestor, head), stat=False)
    numbers = _rows(_git(root, "diff", "--numstat", "-z", "--no-renames",
                         "--no-ext-diff", ancestor, head), stat=True)
    if not status or status.keys() != numbers.keys() or len(status) > _MAX_FILES:
        raise Unqualified("SCOPE_INCOMPLETE_OR_WIDE")
    paths = tuple(sorted(status))
    _mode(root, head, paths)
    total_lines = sum(a + d for a, d in numbers.values())
    if total_lines > _MAX_LINES:
        raise Unqualified("LINES_OVER_LIMIT")
    for path in paths:
        low = path.lower()
        if low.startswith(_PASSIVE_PREFIXES) and low.endswith(_PASSIVE_SUFFIXES):
            continue
        if low.startswith(_CSS_PREFIXES) and low.endswith(".css"):
            raw = _git(root, "show", head + ":" + path)
            if (len(raw) > _MAX_CSS_BYTES or b"\x00" in raw
                    or _CSS_REMOTE_RE.search(raw)):
                raise Unqualified("REMOTE_BINARY_OR_OVERSIZE_STYLESHEET")
            continue
        raise Unqualified("BEHAVIORAL_OR_AUTHORITY_CHANGE")
    visual = any(path.lower().endswith(".css") for path in paths)
    mode = "visual" if visual else "passive"
    return Decision(mode, "EXACT_TRUSTED_SOURCE_VERIFIED", len(paths))


def select(root: Path, event_file: Path) -> Decision:
    try:
        if event_file.stat().st_size > _MAX_EVENT_BYTES:
            raise Unqualified("EVENT_OVER_BOUND")
        event = json.loads(event_file.read_text(encoding="utf-8"))
        if type(event) is not dict:
            raise Unqualified("EVENT_SHAPE_INVALID")
        return qualify(root, event)
    except (Unqualified, OSError, UnicodeError, ValueError, TypeError) as exc:
        return Decision("full", "UNQUALIFIED_SOURCE_OR_CONSEQUENTIAL_PATH")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--event", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    decision = select(args.repo, args.event)
    with args.output.open("a", encoding="ascii") as target:
        target.write("mode=" + decision.mode + "\n")
    print("TERMINAL_PR_SCOPE",decision.mode,decision.reason,decision.count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
