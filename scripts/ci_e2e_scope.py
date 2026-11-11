#!/usr/bin/env python3
"""Fail-closed, source-bound Terminal browser scope selection.

Only a short, reviewed set of Screener-local presentation/test files earns
focused responsive browser projects. Shared Screener CSS includes tablet;
spec-only changes retain desktop/mobile. Every other path, unknown event or uncertain
Git observation retains the complete existing matrix. A merge-group candidate
runs only the production-build lane; the required Terminal aggregate owns its proof.
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
    {"shard": f"desktop-{i}", "projects": f"--project=desktop --shard={i}/6", "specs": ""}
    for i in range(1, 7)
] + [
    {"shard": f"tablet-{i}", "projects": f"--project=tablet --shard={i}/4", "specs": ""}
    for i in range(1, 5)
] + [
    {"shard": f"mobile-{i}", "projects": f"--project=mobile --shard={i}/5", "specs": ""}
    for i in range(1, 6)
] + [{
    "shard": "serial",
    "projects": (
        "--project=company-intelligence-desktop "
        "--project=company-intelligence-tablet "
        "--project=company-intelligence-mobile"
    ),
    "specs": "",
}, {
    "shard": "serial-standalone",
    "projects": (
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
SCREENER_LAYOUT_MATRIX = [
    {"shard": f"screener-{project}", "projects": f"--project={project}",
     "specs": " ".join(SCREENER_SPECS)}
    for project in ("desktop", "tablet", "mobile")
]
SCREENER_LAYOUT_PATHS = frozenset({
    "terminal/components/screener/fundamentalScreen.module.css",
    "terminal/components/screener/CrossMarketStrip.module.css",
    "terminal/components/screener/TechnicalScreenBar.module.css",
})
SCOPED_PATHS = SCREENER_LAYOUT_PATHS | frozenset({
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
    if any(path in SCREENER_LAYOUT_PATHS for path in paths):
        return "focused", "reviewed_screener_shared_layout"
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
        # --name-status (not --name-only) rejects deleted/added/test-skipped
        # source. A removed allowlisted test must never count as covered.
        # --no-renames exposes both endpoints; -z preserves adversarial names.
        changed = git(
            "diff", "--no-ext-diff", "--no-renames", "--name-status", "-z",
            f"{parents[1]}^{{tree}}", f"{parents[0]}^{{tree}}", "--"
        )
        if not changed.endswith(b"\0"):
            return "full", "unqualified_diff"
        parts = changed[:-1].split(b"\0")
        if len(parts) % 2:
            return "full", "unqualified_diff"
        paths: list[str] = []
        for status, path in zip(parts[::2], parts[1::2]):
            if status != b"M":
                return "full", "non_modification_change"
            paths.append(path.decode("utf-8", "strict"))
        return classify_paths(paths)
    except (subprocess.SubprocessError, UnicodeError, OSError, ValueError):
        return "full", "git_observation_failed"


# PR runs execute this selector from RUNNER_TEMP (the protected base copy), but
# the allowlist and specs are candidate DATA in the Actions checkout. Never
# resolve them relative to this script's temporary location.
ALLOWLIST_PATH = Path("terminal/e2e/prodbuild-allowlist.txt")
RESPONSIVE_PROJECTS = ("desktop", "tablet", "mobile")
# Census sizing: allowlisted tests are ~26% of dev duration, or ~42 prod
# test-min at the measured ~3x speedup. Two desktop shards avoid the 60-min
# cap; tablet and mobile each fit one shard. Each added shard costs ~2.5 min
# of setup, so fewer, fuller shards are intentional.
PRODBUILD_SHARDS = (("desktop", 2), ("tablet", 1), ("mobile", 1))
# Spec names are spliced into a workflow `run:` line, so only plain filenames
# may ever be routed by name.
SAFE_SPEC_NAME = re.compile(r"[A-Za-z0-9._-]+\.spec\.ts\Z")


def read_prodbuild_allowlist(path: Path = ALLOWLIST_PATH) -> list[str]:
    """Bare spec filenames proven clean under `next build` + `next start`.

    This is an allowlist, not a denylist: new specs stay on the dev lane until
    production-build qualification adds them here.
    """
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def e2e_spec_names(specs_root: Path = ALLOWLIST_PATH.parent) -> list[str]:
    """Every responsive spec file on this checkout, sorted by bare filename."""
    return sorted(p.name for p in specs_root.glob("*.spec.ts"))


def unroutable_specs(specs_root: Path = ALLOWLIST_PATH.parent) -> list[str]:
    """Spec files that an explicit `e2e/<name>` list could miss or mangle.

    Playwright discovers specs recursively and in several extensions, while the
    lanes route by top-level `<name>.spec.ts`. A nested spec, another extension
    or a filename that is not shell-plain would land in neither lane, so any of
    them disables the split (the dev lane then runs everything, as before).
    """
    return sorted(
        path.relative_to(specs_root).as_posix()
        for path in specs_root.rglob("*.spec.*")
        if path.parent != specs_root or not SAFE_SPEC_NAME.fullmatch(path.name)
    )


def split_lanes(matrix: list[dict], allowlist: list[str],
                specs_root: Path = ALLOWLIST_PATH.parent) -> tuple[list[dict], list[dict]]:
    """Return (dev, prodbuild) matrices with every spec in exactly one lane.

    The allowlist stores bare filenames; matrix spec arguments use the Playwright
    paths `e2e/<filename>`. A project is split only when every row that selects
    it is an unfiltered single-project row: those rows then run exactly the
    non-allowlisted specs and the prod shards run exactly the allowlisted ones.
    Serial and focused rows keep their explicit assignments on dev. Whenever the
    split cannot be proven complete the matrix is returned unchanged with an
    empty prod lane, so dev still runs every spec.

    `.github/workflows/ci.yml` carries the same rule inline for events that do
    not execute this selector; tests/test_ci_e2e_shards.py holds them equal.
    """
    unchanged = [dict(entry) for entry in matrix]
    moved = set(allowlist)
    all_specs = e2e_spec_names(specs_root)
    prod_specs = " ".join(f"e2e/{name}" for name in all_specs if name in moved)
    dev_specs = " ".join(f"e2e/{name}" for name in all_specs if name not in moved)
    if not prod_specs or not dev_specs or unroutable_specs(specs_root):
        return unchanged, []

    def projects(entry: dict) -> list[str]:
        return [token.split("=", 1)[1] for token in entry["projects"].split()
                if token.startswith("--project=")]

    split = [
        project for project in RESPONSIVE_PROJECTS
        if any(project in projects(entry) for entry in matrix)
        and all(projects(entry) == [project] and entry["specs"] == ""
                for entry in matrix if project in projects(entry))
    ]
    if not split:
        return unchanged, []
    dev = [
        {**entry, "specs": dev_specs}
        if any(project in split for project in projects(entry)) else dict(entry)
        for entry in matrix
    ]
    prod = [
        {"shard": f"prodbuild-{project}-{index}",
         "projects": f"--project={project}" + (f" --shard={index}/{count}" if count > 1 else ""),
         "specs": prod_specs}
        for project, count in PRODBUILD_SHARDS if project in split
        for index in range(1, count + 1)
    ]
    return dev, prod


def main() -> None:
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    mode, reason = select(
        event,
        os.environ.get("GITHUB_REF", ""),
        os.environ.get("GITHUB_SHA", ""),
        os.environ.get("PR_HEAD_SHA", ""),
    )
    assert mode in ("full", "focused")
    focused_matrices = {
        "reviewed_screener_presentation_or_tests": FOCUSED_MATRIX,
        "reviewed_screener_shared_layout": SCREENER_LAYOUT_MATRIX,
    }
    if mode == "focused" and reason not in focused_matrices:
        mode, reason = "full", "unrecognized_focused_reason"
    matrix = FULL_MATRIX if mode == "full" else focused_matrices[reason]
    assert matrix and all(m["projects"] and m["shard"] for m in matrix)
    allowlist = read_prodbuild_allowlist() if ALLOWLIST_PATH.is_file() else []
    # Native merge groups run only the production lane; the dev matrix is skipped
    # by its job condition. Focused PRs keep their explicit dev rows. An empty
    # merge-group lane is rejected by the existing required Terminal aggregate.
    if mode == "full" and allowlist:
        dev_matrix, prodbuild_matrix = split_lanes(matrix, allowlist)
    else:
        dev_matrix, prodbuild_matrix = matrix, []
    outputs = {
        "mode": mode,
        "reason": reason,
        "matrix": json.dumps({"include": dev_matrix}, separators=(",", ":")),
        "prodbuild_matrix": json.dumps({"include": prodbuild_matrix}, separators=(",", ":")),
        "prodbuild_count": str(len(prodbuild_matrix)),
    }
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with Path(target).open("a", encoding="utf-8") as out:
            for key, value in outputs.items():
                out.write(f"{key}={value}\n")
    print(
        f"e2e-scope: {mode} ({reason}); {len(dev_matrix)} dev shard(s), "
        f"{len(prodbuild_matrix)} prodbuild shard(s), {len(allowlist)} allowlisted spec(s)"
    )


if __name__ == "__main__":
    main()
