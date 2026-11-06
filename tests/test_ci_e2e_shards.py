"""The `terminal-e2e` matrix in .github/workflows/ci.yml must run every
Playwright project in terminal/playwright.config.ts exactly once.

The desktop project outgrew one 60-minute job (PR #677: 55.3 min green, then
cancelled at the cap on a slower runner), and tablet and mobile followed on
2026-10-12 (47-59 and 44-56 min green, then cancelled at the cap on #960, #954
and #959), so each is split with Playwright's own `--shard=i/N`. A split adds a new way to lose coverage silently: a shard that is
deleted, renumbered, or given a different total still leaves every remaining
job green, and the required "Terminal typecheck + tests" check aggregates only
the jobs that exist. These tests parse the real workflow and config and fail on
any such gap; the mutation tests below prove the checker can fail.
"""
from __future__ import annotations

import re
import os
import subprocess
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path
from typing import Any

from scripts.ci_e2e_scope import FULL_MATRIX, FOCUSED_MATRIX

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
PLAYWRIGHT_CONFIG = ROOT / "terminal" / "playwright.config.ts"

PROJECT_FLAG = re.compile(r"^--project=(\S+)$")
SHARD_FLAG = re.compile(r"^--shard=(\d+)/(\d+)$")


def ci_workflow() -> dict[str, Any]:
    return yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))


def e2e_matrix(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    """Read the full audited shard contract, now emitted by the selector."""
    assert workflow["jobs"]["terminal-e2e"]["strategy"]["matrix"] == (
        "${{ fromJSON(needs.e2e-scope.outputs.matrix) }}"
    )
    return FULL_MATRIX


def playwright_projects() -> set[str]:
    """Project names declared in the `projects: [...]` array. The config is
    TypeScript, so read the `name: "..."` keys between `projects:` and the next
    top-level key (`webServer:`) instead of importing it."""
    text = PLAYWRIGHT_CONFIG.read_text(encoding="utf-8")
    start = text.index("projects: [")
    end = text.index("webServer:", start)
    return set(re.findall(r'\bname:\s*"([^"]+)"', text[start:end]))


def playwright_dependencies() -> dict[str, tuple[str, ...]]:
    """The implicit `dependencies:` edges declared in playwright.config.ts.

    A project that names `dependencies` runs its dependency FIRST, inside the
    SAME Playwright invocation, even when that dependency was not selected on
    the command line. The relationship never appears as a --project= flag, so
    counting flags cannot see a matrix that splits a dependency chain across
    two entries: every project still appears exactly once while the
    dependent's entry silently re-runs the upstream project's specs."""
    text = PLAYWRIGHT_CONFIG.read_text(encoding="utf-8")
    start = text.index("projects: [")
    end = text.index("webServer:", start)
    region = text[start:end]
    declarations = [
        (match.start(), match.group(1))
        for match in re.finditer(r'name:\s*"([^"]+)"', region)
    ]
    edges: dict[str, tuple[str, ...]] = {}
    for index, (position, name) in enumerate(declarations):
        stop = declarations[index + 1][0] if index + 1 < len(declarations) else len(region)
        block = region[position:stop]
        found = re.search(r"dependencies:\s*\[([^\]]*)\]", block)
        if found:
            edges[name] = tuple(re.findall(r'"([^"]+)"', found.group(1)))
    return edges


def matrix_coverage_errors(include: list[dict[str, Any]], projects: set[str]) -> list[str]:
    """Every problem that would make the e2e matrix run a project zero times,
    more than once, only partly, or twice because an implicit Playwright
    dependency chain was split across two entries. An empty list means full
    coverage."""
    errors: list[str] = []

    # upload-artifact@v4 hard-fails on a duplicate artifact name across a matrix,
    # and the artifact name is derived from `shard`.
    for name, count in Counter(entry.get("shard") for entry in include).items():
        if count > 1:
            errors.append(f"shard name {name!r} is used by {count} matrix entries")

    runs: Counter[str] = Counter()
    # Which matrix entry selects each project, so an IMPLICIT Playwright
    # dependency edge can be checked for straddling two entries below.
    entry_projects: dict[str, list[str]] = defaultdict(list)
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
        for project in selected:
            entry_projects[project].append(label)
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
    # A Playwright `dependencies` edge is implicit: selecting the dependent
    # project pulls its dependency into the SAME entry. A matrix that splits
    # such a chain across two entries therefore still lists every --project=
    # exactly once -- invisible to the run counts above -- while the
    # dependent's entry re-runs the upstream project's specs.
    for dependent, dependencies in playwright_dependencies().items():
        for dependency in dependencies:
            dependent_entries = set(entry_projects.get(dependent, ()))
            dependency_entries = set(entry_projects.get(dependency, ()))
            if dependent_entries and dependency_entries and dependent_entries != dependency_entries:
                errors.append(
                    f"{dependent}: implicit dependency {dependency} is selected by a different "
                    f"matrix entry ({sorted(dependency_entries)} vs {sorted(dependent_entries)}) "
                    f"- Playwright pulls {dependency} into {dependent}'s entry, so a split "
                    f"dependency chain runs those specs twice"
                )
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


# Every project that has already been cancelled at the 60-minute cap. A project
# that creeps toward the cap joins this tuple together with its matrix shards;
# the cap itself is never raised (see the comment on `timeout-minutes`).
SPLIT_PROJECTS = ("desktop", "tablet", "mobile")

# The measured minimum number of --shard entries each of those projects must be
# split across, so that no single job again carries enough of a project to
# reach the cap. Mobile's minimum is three, not two: with the matrix at halves,
# run 39403170318 job 118563127930 (PR #1061) started 09:48:07 UTC on
# 2026-10-20, selected 513 tests on the single CI worker at 09:49:29, and was
# still passing with no assertion failure when the host cancelled it at
# 10:48:24 (60m17s, the unchanged cap). Desktop's minimum is five, not four:
# with the matrix at quarters, run 39655439015 job 119414325187 (required
# desktop-1) reported a drawing recovery assertion at 19:37:52 and seven
# subsequent passes at 19:39:49 before cancellation at 19:45:28 on 2026-10-21.
# The assertion is repaired separately; the unchanged cap still detects hangs.
# Green predecessor heads 7579 (58m50) and 60c2 (57m17) had little headroom.
# Tablet's minimum is three: #1061 run 39416005343 tablet-1 passed in
# 56m47s and #1090 run 39415184138 in 55m40s, approaching the same cap.
MIN_SHARDS = {"desktop": 5, "tablet": 3, "mobile": 3}


@pytest.mark.parametrize("project", SPLIT_PROJECTS)
def test_each_large_project_is_split_so_no_single_job_carries_it_whole(project):
    entries = [
        item for item in e2e_matrix(ci_workflow())
        if f"--project={project}" in str(item["projects"]).split()
    ]
    assert len(entries) >= MIN_SHARDS[project], (
        f"{project} must run as at least {MIN_SHARDS[project]} --shard entries, not one whole job"
    )
    assert all(
        any(SHARD_FLAG.match(token) for token in str(item["projects"]).split())
        for item in entries
    ), f"every {project} entry must carry a --shard=i/N flag"


def test_the_required_aggregate_still_gates_every_e2e_shard():
    jobs = ci_workflow()["jobs"]
    aggregate = jobs["terminal"]
    # FROZEN: master's branch protection keys on this exact name.
    assert aggregate["name"] == "Terminal typecheck + tests"
    assert "terminal-e2e" in aggregate["needs"]
    assert aggregate["if"] == "always()"
    # A matrix job's `needs.<job>.result` is success only when EVERY entry is,
    # so every desktop/tablet/mobile shard feeds the required check without a
    # needs change.
    assert jobs["terminal-e2e"]["strategy"]["fail-fast"] is False
    run_steps = [step.get("run", "") for step in jobs["terminal-e2e"]["steps"]]
    assert any("test:e2e:responsive -- ${{ matrix.projects }}" in step for step in run_steps)


# Mutation tests: each realistic regression must make the checker report it.

def mutated() -> list[dict[str, Any]]:
    return deepcopy(e2e_matrix(ci_workflow()))


def project_entries(include: list[dict[str, Any]], project: str) -> list[dict[str, Any]]:
    return [
        item for item in include
        if f"--project={project}" in str(item["projects"]).split()
    ]


def shard_coordinates(item: dict[str, Any]) -> tuple[int, int]:
    matches = [
        match for token in str(item["projects"]).split()
        if (match := SHARD_FLAG.match(token))
    ]
    assert len(matches) == 1, item
    return int(matches[0].group(1)), int(matches[0].group(2))


@pytest.mark.parametrize("project", SPLIT_PROJECTS)
def test_a_missing_shard_is_reported(project):
    include = mutated()
    removed = project_entries(include, project)[-1]
    _, total = shard_coordinates(removed)
    include.remove(removed)
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any(f"do not cover 1..{total}" in error for error in errors), errors


@pytest.mark.parametrize("project", SPLIT_PROJECTS)
def test_a_duplicated_shard_index_is_reported(project):
    include = mutated()
    parts = project_entries(include, project)
    first_index, total = shard_coordinates(parts[0])
    parts[1]["projects"] = f"--project={project} --shard={first_index}/{total}"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any(f"do not cover 1..{total}" in error for error in errors), errors


@pytest.mark.parametrize("project", SPLIT_PROJECTS)
def test_a_raised_shard_total_without_the_new_shard_is_reported(project):
    include = mutated()
    parts = project_entries(include, project)
    _, total = shard_coordinates(parts[0])
    for part in parts:
        index, _ = shard_coordinates(part)
        part["projects"] = f"--project={project} --shard={index}/{total + 1}"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any(f"do not cover 1..{total + 1}" in error for error in errors), errors


@pytest.mark.parametrize("project", SPLIT_PROJECTS)
def test_mismatched_shard_totals_are_reported(project):
    include = mutated()
    part = project_entries(include, project)[-1]
    index, total = shard_coordinates(part)
    part["projects"] = f"--project={project} --shard={index}/{total + 1}"
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any("disagree on the total" in error for error in errors), errors


def test_a_project_no_entry_runs_is_reported():
    # Drop EVERY entry that runs mobile, however many shards it currently has:
    # hardcoding the old two shard names would leave the third mobile entry
    # behind, so the mutation would no longer model a missing project.
    include = [
        item for item in mutated()
        if "--project=mobile" not in str(item["projects"]).split()
    ]
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


# The Company Intelligence chain is the only project set with an implicit
# Playwright `dependencies` edge (playwright.config.ts). Playwright runs a
# declared dependency FIRST, inside the SAME invocation, even when that
# dependency was not selected on the command line. The chain therefore has to
# live in ONE matrix entry: two entries would each pull the upstream project
# in and run its specs twice.
COMPANY_CHAIN = (
    "company-intelligence-desktop",
    "company-intelligence-tablet",
    "company-intelligence-mobile",
)

STANDALONE_PROJECTS = ("terminal-chrome-intermediate", "w2a-workspaces")


def test_the_company_dependency_chain_stays_in_one_matrix_entry():
    include = e2e_matrix(ci_workflow())
    carriers = {
        project: tuple(item["shard"] for item in project_entries(include, project))
        for project in COMPANY_CHAIN
    }
    assert all(carriers[project] for project in COMPANY_CHAIN), carriers
    assert len(set(carriers.values())) == 1, carriers
    row = next(item for item in include if item["shard"] == carriers[COMPANY_CHAIN[0]][0])
    assert not any(SHARD_FLAG.match(token) for token in str(row["projects"]).split()), row


def test_the_two_standalone_projects_run_whole_once_in_the_current_matrix():
    include = e2e_matrix(ci_workflow())
    rows = [
        item for item in include
        if {f"--project={project}" for project in STANDALONE_PROJECTS}
        <= set(str(item["projects"]).split())
    ]
    assert len(rows) == 1, rows
    row = rows[0]
    # No --shard and no filter: neither project has a Playwright dependency and
    # both are excluded from desktop/tablet/mobile, so they run once, whole.
    assert not any(SHARD_FLAG.match(token) for token in str(row["projects"]).split()), row
    # The current protected planner co-locates the whole standalone projects
    # with the complete Company chain in its one serial row. Sharing a row is
    # not a split dependency or a second invocation; preserve that newer plan.
    assert row["shard"] == "serial", row
    assert all(len(project_entries(include,project))==1 for project in STANDALONE_PROJECTS)
    assert e2e_matrix(ci_workflow()) == FULL_MATRIX


def test_the_two_opt_in_qualifications_still_run_only_in_the_serial_row():
    steps = ci_workflow()["jobs"]["terminal-e2e"]["steps"]
    opt_ins = [step for step in steps if str(step.get("name", "")).startswith("Qualify ")]
    assert len(opt_ins) == 2, opt_ins
    for step in opt_ins:
        assert step.get("if") == "matrix.shard == 'serial'", step


def test_e2e_artifacts_stay_distinct_per_matrix_row():
    steps = ci_workflow()["jobs"]["terminal-e2e"]["steps"]
    uploads = [
        step for step in steps
        if str(step.get("uses", "")).startswith("actions/upload-artifact")
    ]
    assert len(uploads) == 1, uploads
    assert "${{ matrix.shard }}" in uploads[0]["with"]["name"], uploads[0]
    shards = [item["shard"] for item in e2e_matrix(ci_workflow())]
    assert len(set(shards)) == len(shards), shards


def test_a_split_implicit_dependency_chain_is_reported():
    # The Company chain's dependency edges live in playwright.config.ts, not in
    # the workflow, so splitting the chain across two entries still lists every
    # --project= exactly once. The explicit run counts cannot see it; only the
    # implicit-edge check can.
    include = mutated()
    chain = entry(include, "serial")
    chain["projects"] = (
        "--project=company-intelligence-desktop --project=company-intelligence-tablet"
    )
    include.append({
        "shard": "serial-split",
        "projects": "--project=company-intelligence-mobile",
    })
    errors = matrix_coverage_errors(include, playwright_projects())
    assert any(
        "company-intelligence-mobile" in error and "company-intelligence-tablet" in error
        for error in errors
    ), errors
    # The explicit run counts really cannot see this one.
    assert not any("run by 2" in error for error in errors), errors


@pytest.mark.parametrize("matrix_result", ["success", "failure", "cancelled", "skipped"])
def test_required_aggregate_rejects_unsuccessful_expanded_matrix(matrix_result):
    workflow = ci_workflow()
    include = e2e_matrix(workflow)
    assert include == FULL_MATRIX
    assert any(item["shard"] == "serial" for item in include)
    aggregate = workflow["jobs"]["terminal"]
    assert "terminal-e2e" in aggregate["needs"]
    assert aggregate["if"] == "always()"
    step = next(step for step in aggregate["steps"] if step.get("name") == "Assert every terminal shard succeeded")
    # Run the actual aggregate shell with the matrix-level result GitHub supplies.
    # A new row remains inside terminal-e2e, so its failure/cancellation makes this
    # matrix result unsuccessful; no new optional job or aggregate exception exists.
    result = subprocess.run(
        ["bash", "-c", step["run"]],
        env={**os.environ, "SCOPE": "success", "UNIT": "success", "E2E": matrix_result, "EVENT": "pull_request"},
        capture_output=True, text=True, check=False,
    )
    assert (result.returncode == 0) is (matrix_result == "success"), result.stdout
