"""The `terminal-e2e` matrix in .github/workflows/ci.yml must run every
Playwright project in terminal/playwright.config.ts exactly once.

The desktop project outgrew one 60-minute job (PR #677: 55.3 min green, then
cancelled at the cap on a slower runner), so it is split with Playwright's own
`--shard=i/N`. A split adds a new way to lose coverage silently: a half that is
deleted, renumbered, or given a different total still leaves every remaining
job green, and the required "Terminal typecheck + tests" check aggregates only
the jobs that exist. These tests parse the real workflow and config and fail on
any such gap; the mutation tests below prove the checker can fail.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
PLAYWRIGHT_CONFIG = ROOT / "terminal" / "playwright.config.ts"

PROJECT_FLAG = re.compile(r"^--project=(\S+)$")
SHARD_FLAG = re.compile(r"^--shard=(\d+)/(\d+)$")


def ci_workflow() -> dict[str, Any]:
    return yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))


def e2e_matrix(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    return workflow["jobs"]["terminal-e2e"]["strategy"]["matrix"]["include"]


def playwright_projects() -> set[str]:
    """Project names declared in the `projects: [...]` array. The config is
    TypeScript, so read the `name: "..."` keys between `projects:` and the next
    top-level key (`webServer:`) instead of importing it."""
    text = PLAYWRIGHT_CONFIG.read_text(encoding="utf-8")
    start = text.index("projects: [")
    end = text.index("webServer:", start)
    return set(re.findall(r'\bname:\s*"([^"]+)"', text[start:end]))


def matrix_coverage_errors(include: list[dict[str, Any]], projects: set[str]) -> list[str]:
    """Every problem that would make the e2e matrix run a project zero times,
    more than once, or only partly. An empty list means full coverage."""
    errors: list[str] = []

    # upload-artifact@v4 hard-fails on a duplicate artifact name across a matrix,
    # and the artifact name is derived from `shard`.
    for name, count in Counter(entry.get("shard") for entry in include).items():
        if count > 1:
            errors.append(f"shard name {name!r} is used by {count} matrix entries")

    runs: Counter[str] = Counter()
    sharded: dict[tuple[str, ...], list[tuple[str, int, int]]] = defaultdict(list)
    for entry in include:
        label = entry.get("shard")
        selected: list[str] = []
        shard: tuple[int, int] | None = None
        for token in str(entry.get("projects", "")).split():
            if match := PROJECT_FLAG.match(token):
                selected.append(match.group(1))
            elif match := SHARD_FLAG.match(token):
                shard = (int(match.group(1)), int(match.group(2)))
            else:
                # Anything else (a --grep, a file filter, a stray flag) could
                # silently narrow what the entry runs.
                errors.append(f"{label}: unexpected Playwright argument {token!r}")
        if not selected:
            errors.append(f"{label}: selects no --project, so it would run every project")
            continue
        if shard is None:
            runs.update(selected)
            continue
        index, total = shard
        if total < 2 or not 1 <= index <= total:
            errors.append(f"{label}: invalid --shard={index}/{total}")
        sharded[tuple(sorted(selected))].append((label, index, total))

    for selection, parts in sharded.items():
        names = ", ".join(selection)
        totals = {total for _, _, total in parts}
        if len(totals) != 1:
            errors.append(f"{names}: shards disagree on the total {sorted(totals)}")
        else:
            total = totals.pop()
            indexes = sorted(index for _, index, _ in parts)
            if indexes != list(range(1, total + 1)):
                errors.append(f"{names}: shard indexes {indexes} do not cover 1..{total} exactly once")
        runs.update(selection)

    for project in sorted(projects):
        if runs[project] == 0:
            errors.append(f"{project}: no e2e matrix entry runs it")
        elif runs[project] > 1:
            errors.append(f"{project}: run by {runs[project]} separate matrix entries / shard sets")
    for project in sorted(set(runs) - projects):
        errors.append(f"{project}: not a project in playwright.config.ts")
    return errors


def entry(include: list[dict[str, Any]], shard: str) -> dict[str, Any]:
    return next(item for item in include if item["shard"] == shard)


def test_config_parser_sees_the_real_projects():
    # Non-vacuity: if the parser ever returned nothing, "every project is
    # covered" would hold trivially.
    projects = playwright_projects()
    assert {"desktop", "tablet", "mobile", "company-intelligence-desktop", "w2a-workspaces"} <= projects
    assert len(projects) >= 8


def test_every_playwright_project_runs_exactly_once_across_the_e2e_matrix():
    assert matrix_coverage_errors(e2e_matrix(ci_workflow()), playwright_projects()) == []


def test_desktop_is_split_so_no_single_job_carries_the_whole_project():
    desktop = [
        item for item in e2e_matrix(ci_workflow())
        if "--project=desktop" in str(item["projects"]).split()
    ]
    assert len(desktop) >= 2
    assert all(
        any(SHARD_FLAG.match(token) for token in str(item["projects"]).split())
        for item in desktop
    )


def test_the_required_aggregate_still_gates_every_e2e_shard():
    jobs = ci_workflow()["jobs"]
    aggregate = jobs["terminal"]
    # FROZEN: master's branch protection keys on this exact name.
    assert aggregate["name"] == "Terminal typecheck + tests"
    assert "terminal-e2e" in aggregate["needs"]
    assert aggregate["if"] == "always()"
    # A matrix job's `needs.<job>.result` is success only when EVERY entry is,
    # so both desktop halves feed the required check without a needs change.
    assert jobs["terminal-e2e"]["strategy"]["fail-fast"] is False
    run_steps = [step.get("run", "") for step in jobs["terminal-e2e"]["steps"]]
    assert any("test:e2e:responsive -- ${{ matrix.projects }}" in step for step in run_steps)


# Mutation tests: each realistic regression must make the checker report it.

def mutated() -> list[dict[str, Any]]:
    return deepcopy(e2e_matrix(ci_workflow()))


def test_a_missing_desktop_half_is_reported():
    include = [item for item in mutated() if item["shard"] != "desktop-2"]
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any("do not cover 1..2" in error for error in errors), errors


def test_a_duplicated_shard_index_is_reported():
    include = mutated()
    entry(include, "desktop-2")["projects"] = "--project=desktop --shard=1/2"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any("do not cover 1..2" in error for error in errors), errors


def test_a_raised_shard_total_without_the_new_half_is_reported():
    include = mutated()
    for name, index in (("desktop-1", 1), ("desktop-2", 2)):
        entry(include, name)["projects"] = f"--project=desktop --shard={index}/3"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any("do not cover 1..3" in error for error in errors), errors


def test_mismatched_shard_totals_are_reported():
    include = mutated()
    entry(include, "desktop-2")["projects"] = "--project=desktop --shard=2/3"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any("disagree on the total" in error for error in errors), errors


def test_a_project_no_entry_runs_is_reported():
    include = [item for item in mutated() if item["shard"] != "mobile"]
    errors = matrix_coverage_errors(include, playwright_projects())
    assert "mobile: no e2e matrix entry runs it" in errors


def test_a_project_run_whole_and_sharded_is_reported():
    include = mutated() + [{"shard": "desktop", "projects": "--project=desktop"}]
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any(error.startswith("desktop: run by 2") for error in errors), errors


def test_a_narrowing_filter_is_reported():
    include = mutated()
    entry(include, "desktop-1")["projects"] += " --grep=chart"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert "desktop-1: unexpected Playwright argument '--grep=chart'" in errors


def test_a_duplicate_shard_name_is_reported():
    include = mutated()
    entry(include, "desktop-2")["shard"] = "desktop-1"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any("'desktop-1' is used by 2" in error for error in errors), errors
