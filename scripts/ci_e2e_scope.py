#!/usr/bin/env python3
"""Fail-closed, source-bound Terminal browser scope selection.

Only a short, reviewed set of Screener-local presentation/test files earns two
focused responsive browser projects. Every other path, unknown event, uncertain
Git observation or merge-group candidate retains the complete existing matrix.
This script selects tests only; it never changes the three protected CI contexts.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

FULL_MATRIX = [
    {"shard": f"desktop-{i}", "projects": f"--project=desktop --shard={i}/5", "specs": ""}
    for i in range(1, 6)
] + [
    {"shard": f"tablet-{i}", "projects": f"--project=tablet --shard={i}/3", "specs": ""}
    for i in range(1, 4)
] + [
    {"shard": f"mobile-{i}", "projects": f"--project=mobile --shard={i}/3", "specs": ""}
    for i in range(1, 4)
] + [{
    "shard": "serial",
    "projects": (
        "--project=company-intelligence-desktop "
        "--project=company-intelligence-tablet "
        "--project=company-intelligence-mobile "
        "--project=terminal-chrome-intermediate "
        "--project=w2a-workspaces"
    ),
    "specs": "",
}]

# Existing, known mock/browser specs only. An unrecognized new spec or source
# path falls back to the full matrix until reviewed and explicitly enrolled.
SCREENER_SPECS = (
    # Crop generators are skipped in normal CI; changing one cannot earn a
    # focused pass that never actually exercises the modified test.
    "e2e/screener-fundamental.spec.ts",
    "e2e/screener-cross-market.spec.ts",
    "e2e/screener-technical-scan.spec.ts",
    "e2e/screener-failure-state.spec.ts",
)
FOCUSED_MATRIX = [
    {"shard": f"screener-{project}", "projects": f"--project={project}",
     "specs": " ".join(SCREENER_SPECS)}
    for project in ("desktop", "mobile")
]
SCOPED_PATHS = frozenset({
    "terminal/components/screener/fundamentalScreen.module.css",
    "terminal/components/screener/CrossMarketStrip.module.css",
    "terminal/components/screener/TechnicalScreenBar.module.css",
    *(f"terminal/{name}" for name in SCREENER_SPECS),
})
PR_MERGE_REF = re.compile(r"refs/pull/[1-9][0-9]*/merge\Z")
SHA40 = re.compile(r"[0-9a-f]{40}\Z")


def classify_paths(paths: list[str]) -> tuple[str, str]:
    """An explicit all-path allowlist, not a permissive directory prefix."""
    if not paths or len(paths) > 20:
        return "full", "empty_or_large_change"
    if len(paths) != len(set(paths)):
        return "full", "duplicate_change_path"
    if any(path not in SCOPED_PATHS for path in paths):
        return "full", "unknown_or_elevated_path"
    return "focused", "reviewed_screener_presentation_or_tests"


def git(*args: str) -> bytes:
    result = subprocess.run(
        ["git", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        check=True, timeout=15,
        env={**os.environ, "GIT_NO_LAZY_FETCH": "1", "GIT_OPTIONAL_LOCKS": "0"},
    )
    return result.stdout


def select(event: str, github_ref: str, github_sha: str,
           pr_head_sha: str) -> tuple[str, str]:
    # merge_group, dispatch, push, unknown and missing event fields FULL.
    if event != "pull_request":
        return "full", "unscoped_event"
    if not PR_MERGE_REF.fullmatch(github_ref):
        return "full", "not_an_exact_pr_merge_ref"
    if not (SHA40.fullmatch(github_sha) and SHA40.fullmatch(pr_head_sha)):
        return "full", "missing_commit_identity"
    try:
        parents = git("rev-list", "--parents", "-n", "1", "HEAD").decode("ascii").strip().split()
        if (len(parents) != 3 or parents[0] != github_sha
                or parents[2] != pr_head_sha):
            return "full", "unexpected_merge_checkout"
        # --no-renames ensures both removed and added paths are visible. -z
        # handles adversarial names without shell/newline parsing.
        changed = git(
            "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z",
            f"{parents[1]}^{{tree}}", f"{parents[0]}^{{tree}}", "--"
        )
        if not changed.endswith(b"\0"):
            return "full", "unqualified_diff"
        paths = [part.decode("utf-8", "strict") for part in changed[:-1].split(b"\0")]
        return classify_paths(paths)
    except (subprocess.SubprocessError, UnicodeError, OSError, ValueError):
        return "full", "git_observation_failed"


def main() -> None:
    mode, reason = select(
        os.environ.get("GITHUB_EVENT_NAME", ""),
        os.environ.get("GITHUB_REF", ""),
        os.environ.get("GITHUB_SHA", ""),
        os.environ.get("PR_HEAD_SHA", ""),
    )
    assert mode in ("full", "focused")
    matrix = FULL_MATRIX if mode == "full" else FOCUSED_MATRIX
    assert matrix and all(m["projects"] and m["shard"] for m in matrix)
    outputs = {
        "mode": mode,
        "reason": reason,
        "matrix": json.dumps({"include": matrix}, separators=(",", ":")),
    }
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with Path(target).open("a", encoding="utf-8") as out:
            for key, value in outputs.items():
                out.write(f"{key}={value}\n")
    print(f"e2e-scope: {mode} ({reason}); {len(matrix)} browser shard(s)")


if __name__ == "__main__":
    main()
