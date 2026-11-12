#!/usr/bin/env python3
"""Trusted-base PR scope for Terminal CI.

A pull request -- or a native merge group -- whose effective change is inert
prose or evidence only gets ``mode=docs``: the workflow then skips the unit,
e2e, ingest and PostgreSQL machinery and reports the required contexts green
from their own bounded steps. Anything else, and anything this script cannot
qualify, is ``mode=full`` -- the exact behaviour the workflow had before this
script existed.

"Docs" is a positive allowlist, not "everything under docs/":

* Markdown under ``docs/`` or ``terminal/docs/``, minus agent instruction
  files at any depth and the sub-trees and
  files that runtime code or tests read (``terminal/docs/api/`` is served by
  ``terminal/app/docs/api/contract/route.ts``; specimens, refs and the
  chart-engine receipts are test inputs; a few named contracts are compared
  byte-for-byte by tests).
* Raster evidence images under ``docs/evidence/``. The pr-crops tree is
  deliberately absent: evidence-lock suites hash those crops, so a changed
  crop can change a test result.

Top-level and package Markdown (README, AGENTS, CLAUDE, DEPLOY, HANDOFF ...)
is read by tests and therefore never docs. ``tests/test_ci_pr_scope.py`` pins
this allowlist against a census of literal path references in source.

A change qualifies as docs only when every diff row is an add or a modify (a
delete, rename, copy or type change is full), every touched path is on the
allowlist, and the change touches at most ``_MAX_CHANGES`` files. A pull
request additionally qualifies only when its head repository is this
repository (never a fork).

The decision is taken from Git objects only, never from PR text. For a pull
request the workflow executes this file from the protected base commit
(``HEAD^1`` of the pull-request merge commit) and only for pull requests whose
base is the repository default branch; for a merge group it executes this
file from the group's base commit (the protected default-branch commit the
queue built on) and classifies the whole group diff. Neither a pull request
nor a queued group can reclassify itself.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

_SHA_LEN = 40
_MODES = ("docs", "full")
_DOCS_TREES = ("docs/", "terminal/docs/")
# These files direct repository work regardless of their nesting depth.
_INSTRUCTION_FILES = frozenset({"AGENTS.md", "CLAUDE.md"})
# Sub-trees of the docs trees that CI executes, serves or compares.
_CONSUMED_TREES = (
    "terminal/docs/api/",        # served by terminal/app/docs/api/contract/route.ts
    "terminal/docs/specimens/",  # read by unit + e2e specs
    "terminal/docs/refs/",       # build.py / shoot.sh inputs
    "docs/chart-engine",         # receipt schema, census and bench inputs
)
# Individual prose files compared or parsed by source.
_CONSUMED_FILES = frozenset({
    "docs/F12_TENANT_SCOPE_CONTRACT_2026-09-06.md",  # tenantScopeConformance.test.ts
    "docs/FEATURE_GAP_AUDIT.md",                     # terminal/lib/replayContract.ts
    "docs/LARGE_TRADES_ABSORPTION.md",               # terminal/scripts/verify-large-trades.mjs
    "docs/CI_TERMINAL_E2E_SELFHOSTED_LANE.md",       # tests/test_ci_e2e_selfhosted_lane.py +
                                                     # tests/test_ci_e2e_lane_host_files.py
})
# Written by specs and never compared: a changed image here cannot change a
# test result. (terminal/docs/pr-crops is NOT here: evidence-lock suites
# hash those crops, so pr-crops changes must run the full suite.)
_EVIDENCE_TREES = ("docs/evidence/",)
_EVIDENCE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp")
# A docs-tier change is bounded: a diff large enough to reshape a tree is not
# a prose edit and must run the full suite.
_MAX_CHANGES = 50
# Everything written to GITHUB_OUTPUT is reduced to this alphabet first, so a
# crafted path can never add a line (and therefore a key) to the output file.
_OUTPUT_TOKEN = re.compile(r"[^A-Za-z0-9._/:+-]")


class ScopeUnqualified(ValueError):
    """The diff could not be qualified; the caller must fall back to full."""


def _output_token(text: str, limit: int = 160) -> str:
    return _OUTPUT_TOKEN.sub("_", text)[:limit] or "EMPTY"


@dataclass(frozen=True)
class ScopeDecision:
    mode: str
    reason: str
    changed: int

    def as_output(self) -> str:
        # Fixed keys, sanitised values, `mode` last and from a closed set: a
        # later duplicate key wins in the Actions runner, so the mode line is
        # the final word even if an earlier value were ever malformed.
        mode = self.mode if self.mode in _MODES else "full"
        return (
            f"reason={_output_token(self.reason)}\n"
            f"changed={int(self.changed)}\n"
            f"mode={mode}\n"
        )


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
        text = name.decode("utf-8")
    except UnicodeDecodeError:
        raise ScopeUnqualified("PATH_NOT_UTF8") from None
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in text):
        raise ScopeUnqualified("PATH_CONTROL_CHARACTER")
    return text


def is_docs_path(path: str) -> bool:
    """True only for inert prose or evidence that nothing in CI reads."""
    if not path or not path.startswith(_DOCS_TREES):
        return False
    if path.rsplit("/", 1)[-1] in _INSTRUCTION_FILES:
        return False
    if path.startswith(_CONSUMED_TREES) or path in _CONSUMED_FILES:
        return False
    if path.endswith(".md"):
        return True
    return path.startswith(_EVIDENCE_TREES) and path.endswith(_EVIDENCE_SUFFIXES)


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


def _head_tree_modes(root: Path, head: str) -> dict[str, tuple[bytes, bytes]]:
    """Every path in the ``head`` tree with its (mode, object kind); one
    call, no per-path arguments, so the size of the change never hits an
    argv limit."""
    raw_tree = _git(root, "ls-tree", "-r", "-z", head)
    if raw_tree and not raw_tree.endswith(b"\x00"):
        raise ScopeUnqualified("GIT_TREE_INCOMPLETE")
    modes: dict[str, tuple[bytes, bytes]] = {}
    for record in raw_tree[:-1].split(b"\x00") if raw_tree else []:
        try:
            metadata, name = record.split(b"\t", 1)
            mode, kind, _ = metadata.split(b" ")
        except ValueError:
            raise ScopeUnqualified("GIT_TREE_RECORD_MALFORMED") from None
        path = _decode(name)
        if path in modes:
            raise ScopeUnqualified("GIT_TREE_DUPLICATE_PATH")
        modes[path] = (mode, kind)
    return modes


def _decide(root: Path, base: str, head: str) -> ScopeDecision:
    """Classify the two-tree diff ``base..head`` against the docs allowlist."""
    rows = _name_status(_git(
        root, "diff", "--name-status", "-z", "--find-renames", "--no-ext-diff",
        base, head,
    ))
    if not rows:
        raise ScopeUnqualified("DIFF_EMPTY")
    touched: set[str] = set()
    present: set[str] = set()
    for kind, paths in rows:
        touched.update(paths)
        if kind != "D":
            present.add(paths[-1])
    non_docs = sorted(path for path in touched if not is_docs_path(path))
    if non_docs:
        return ScopeDecision("full", "SOURCE_TOUCHED:" + non_docs[0][:120], len(touched))
    for kind, paths in rows:
        if kind not in ("A", "M"):
            return ScopeDecision(
                "full", f"STATUS_{kind}_NOT_ADD_OR_MODIFY:" + paths[-1][:100], len(touched),
            )
    if len(touched) > _MAX_CHANGES:
        return ScopeDecision("full", "CHANGE_COUNT_ABOVE_CAP", len(touched))
    # A symlink, executable bit, submodule or type change can be a new
    # execution or data boundary even under a prose-looking name. Every
    # surviving path must be an exact regular 100644 blob in the head tree.
    if present:
        modes = _head_tree_modes(root, head)
        if any(path not in modes for path in present):
            raise ScopeUnqualified("GIT_TREE_FILE_COVERAGE_INVALID")
        if any(modes[path] != (b"100644", b"blob") for path in present):
            raise ScopeUnqualified("GIT_EXECUTABLE_SYMLINK_OR_SUBMODULE")
    return ScopeDecision("docs", "PROSE_ONLY", len(touched))


def _is_sha(value: str) -> bool:
    return (
        len(value) == _SHA_LEN
        and all(c in "0123456789abcdef" for c in value)
    )


def classify(
    repo: Path, *, expected_base: str, base_ref: str, default_branch: str,
    head_repo: str | None = None, repository: str | None = None,
) -> ScopeDecision:
    """Classify a pull-request merge commit (HEAD with two parents)."""
    root = repo.resolve(strict=True)
    if not default_branch or base_ref != default_branch:
        # Only the protected default branch carries this classifier's
        # authority; a PR against any other branch runs everything.
        raise ScopeUnqualified("BASE_IS_NOT_THE_DEFAULT_BRANCH")
    if not _is_sha(expected_base):
        raise ScopeUnqualified("BASE_SHA_UNQUALIFIED")
    if (head_repo is None) != (repository is None):
        raise ScopeUnqualified("REPOSITORY_IDENTITY_INCOMPLETE")
    if head_repo is not None and head_repo != repository:
        # A fork's head repository is not this repository: never docs.
        raise ScopeUnqualified("FORK_HEAD_REPOSITORY")
    parents = _git(root, "rev-list", "--parents", "-n", "1", "HEAD").decode("ascii").split()
    if len(parents) != 3:
        raise ScopeUnqualified("HEAD_NOT_A_TWO_PARENT_MERGE")
    if parents[1] != expected_base:
        raise ScopeUnqualified("MERGE_FIRST_PARENT_IS_NOT_THE_EVENT_BASE")
    return _decide(root, "HEAD^1", "HEAD")


def classify_group(
    repo: Path, *, base_sha: str, head_sha: str,
) -> ScopeDecision:
    """Classify a native merge group: the whole group diff ``base..head``.

    The workflow has already frozen the event identity (refs, workflow SHA and
    the checkout agree); this re-verifies the two SHAs against the checkout
    before deciding, so a mismatched object can never be classified. It does
    NOT itself prove that ``base_sha`` is an ancestor of ``head_sha`` (or of
    the checked-out group head): that ancestry is part of the workflow's
    frozen-ref contract, not something this script re-derives.
    """
    root = repo.resolve(strict=True)
    if not _is_sha(base_sha):
        raise ScopeUnqualified("GROUP_BASE_SHA_UNQUALIFIED")
    if not _is_sha(head_sha):
        raise ScopeUnqualified("GROUP_HEAD_SHA_UNQUALIFIED")
    if base_sha == head_sha:
        raise ScopeUnqualified("GROUP_BASE_EQUALS_HEAD")
    if _git(root, "rev-parse", "HEAD").decode("ascii").strip() != head_sha:
        raise ScopeUnqualified("GROUP_HEAD_IS_NOT_THE_CHECKOUT")
    if _git(root, "cat-file", "-t", base_sha).decode("ascii").strip() != "commit":
        raise ScopeUnqualified("GROUP_BASE_NOT_A_COMMIT")
    return _decide(root, base_sha, head_sha)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Trusted-base Terminal CI scope")
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument(
        "--event", choices=("pull-request", "merge-group"), default="pull-request",
        help="which event is being classified",
    )
    parser.add_argument("--base-sha", help="pull_request.base.sha")
    parser.add_argument("--base-ref", help="pull_request.base.ref")
    parser.add_argument("--default-branch", help="repository.default_branch")
    parser.add_argument(
        "--head-repo", help="pull_request.head.repo.full_name (fork guard)",
    )
    parser.add_argument("--repository", help="github.repository (fork guard)")
    parser.add_argument("--group-base-sha", help="merge_group.base_sha")
    parser.add_argument("--group-head-sha", help="merge_group.head_sha")
    parser.add_argument("--output", type=Path, help="GITHUB_OUTPUT file to append to")
    args = parser.parse_args(argv)
    try:
        if args.event == "merge-group":
            missing = [
                name for name, value in (
                    ("--group-base-sha", args.group_base_sha),
                    ("--group-head-sha", args.group_head_sha),
                ) if not value
            ]
            if missing:
                raise ScopeUnqualified("GROUP_ARGS_MISSING:" + ":".join(missing))
            decision = classify_group(
                args.repo,
                base_sha=args.group_base_sha,
                head_sha=args.group_head_sha,
            )
        else:
            missing = [
                name for name, value in (
                    ("--base-sha", args.base_sha),
                    ("--base-ref", args.base_ref),
                    ("--default-branch", args.default_branch),
                ) if not value
            ]
            if missing:
                raise ScopeUnqualified("PR_ARGS_MISSING:" + ":".join(missing))
            decision = classify(
                args.repo,
                expected_base=args.base_sha,
                base_ref=args.base_ref,
                default_branch=args.default_branch,
                head_repo=args.head_repo,
                repository=args.repository,
            )
    except (ScopeUnqualified, OSError, subprocess.SubprocessError, ValueError) as exc:
        decision = ScopeDecision("full", f"UNQUALIFIED:{str(exc)[:140]}", 0)
    if args.output is not None:
        with args.output.open("a", encoding="utf-8") as handle:
            handle.write(decision.as_output())
    print(
        f"CI_SCOPE mode={decision.mode} changed={decision.changed} "
        f"reason={_output_token(decision.reason)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
