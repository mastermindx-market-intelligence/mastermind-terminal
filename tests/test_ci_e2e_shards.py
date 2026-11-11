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

import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from copy import deepcopy
from functools import lru_cache
from itertools import product
from pathlib import Path
from typing import Any

from scripts import ci_e2e_scope as scope
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
# Tablet's minimum is four: #1296 run 42547252309 job 128935057706 selected
# 513 cases on one worker in shard 3/3, continued producing captures through
# 02:48:22 UTC on 2026-11-09, and was cancelled at 02:49:31 after its 60-minute
# job cap. The earlier transport reset did not stop subsequent passing work.
# Keep every case and the cap; give each tablet shard a smaller allocation.
# Desktop1/5 reached its fixed cap again in #801 run42550254306/job128946320810.
# The annotation proves the one-hour cancellation; no late-progress claim is made.
# Six full shards reduce allocation while preserving every case and the same cap.
# Mobile's minimum is now five, not three: #1411 run 42753497499 on 2026-11-10 had
# mobile-1 at 54 min and mobile-3 at 58 min, while mobile-2 was cancelled at the
# 60-minute cap twice with ZERO test failures — on attempt 2 the suite alone took
# 58.0 min on the single CI worker, leaving no room for artifact upload. Fifths shrink each
# mobile allocation under the same cap while keeping every case.
MIN_SHARDS = {"desktop": 6, "tablet": 4, "mobile": 5}


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


def test_mobile_runs_in_exactly_five_shards():
    # #1411: mobile thirds hit the unchanged 60-minute cap with zero failures
    # (run 42753497499; mobile-2 cancelled twice; suite alone 58.0 min). Fifths
    # shrink each allocation without raising the cap or dropping a case.
    entries = [
        item for item in e2e_matrix(ci_workflow())
        if "--project=mobile" in str(item["projects"]).split()
    ]
    assert [item["shard"] for item in entries] == [f"mobile-{i}" for i in range(1, 6)]
    assert [shard_coordinates(item) for item in entries] == [(i, 5) for i in range(1, 6)]


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


def test_the_two_standalone_projects_run_whole_in_their_own_row():
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
    # Their row is not the chain's row, and it is not `serial`: the two opt-in
    # qualification steps stay bound to `serial` and must run exactly once.
    assert row["shard"] != "serial", row
    chain_row = next(
        item for item in include
        if f"--project={COMPANY_CHAIN[0]}" in str(item["projects"]).split()
    )
    assert chain_row["shard"] != row["shard"], (chain_row, row)


def test_all_opt_in_qualifications_still_run_only_in_the_serial_row():
    steps = ci_workflow()["jobs"]["terminal-e2e"]["steps"]
    opt_ins = [step for step in steps if str(step.get("name", "")).startswith("Qualify ")]
    assert len(opt_ins) == 3, opt_ins
    assert {step["name"] for step in opt_ins} == {
        "Qualify investor shell opt-in",
        "Qualify Shared Shell beta presentation",
        "Qualify Intelligence native beta routes (fixture browser)",
    }
    for step in opt_ins:
        assert step.get("if") == "matrix.shard == 'serial'", step


def test_e2e_artifacts_stay_distinct_per_matrix_row():
    steps = ci_workflow()["jobs"]["terminal-e2e"]["steps"]
    uploads = [
        step for step in steps
        if str(step.get("uses", "")).startswith("actions/upload-artifact")
    ]
    assert len(uploads) == 3, uploads
    assert {step["name"] for step in uploads} == {
        "Retain bounded Shared Shell outcome",
        "Upload Intelligence fixture-browser evidence",
        "Upload responsive QA screenshots",
    }
    by_name = {step["name"]: step for step in uploads}
    general = by_name["Upload responsive QA screenshots"]
    assert general["if"] == "always()"
    assert "${{ matrix.shard }}" in general["with"]["name"], general
    summary = by_name["Retain bounded Shared Shell outcome"]
    assert summary["if"] == (
        "${{ always() && matrix.shard == 'serial' && "
        "steps.safe_shared_shell_summary.outcome == 'success' && "
        "steps.safe_shared_shell_summary.outputs.safe_shared_shell_summary_ready == 'true' }}"
    )
    assert "-serial-safe-summary-" in summary["with"]["name"]
    intelligence = by_name["Upload Intelligence fixture-browser evidence"]
    assert intelligence["if"] == "always() && matrix.shard == 'serial'"
    assert intelligence["with"]["name"] == (
        "intelligence-beta-qa-${{ github.run_id }}-${{ github.run_attempt }}"
    )
    assert intelligence["with"]["path"] == (
        "terminal/docs/pr-crops/shared-shell-intelligence-20261103/"
        "ci-intelligence-${{ github.run_id }}-${{ github.run_attempt }}"
    )
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
    assert any(item["shard"] == "serial-standalone" for item in include)
    aggregate = workflow["jobs"]["terminal"]
    assert "terminal-e2e" in aggregate["needs"]
    assert aggregate["if"] == "always()"
    step = next(step for step in aggregate["steps"] if step.get("name") == "Assert all event-required Terminal checks passed")
    # Run the actual aggregate shell with the matrix-level result GitHub supplies.
    # A new row remains inside terminal-e2e, so its failure/cancellation makes this
    # matrix result unsuccessful; no new optional job or aggregate exception exists.
    result = subprocess.run(
        ["bash", "-c", step["run"]],
        env={**os.environ, "EVENT": "pull_request", "PR_SCOPE": "success",
             "PR_MODE": "full", "SCOPE": "success", "UNIT": "success", "E2E": matrix_result,
             # The prod lane is held at its passing state so that the dev
             # matrix result alone decides this gate.
             "BUILD": "success", "PRODBUILD": "success", "PRODBUILD_COUNT": "4"},
        capture_output=True, text=True, check=False,
    )
    assert (result.returncode == 0) is (matrix_result == "success"), result.stdout


# ---------------------------------------------------------------------------
# Stage 1 production-build lane.
#
# Specs listed in terminal/e2e/prodbuild-allowlist.txt run against one
# `next build` + `next start` (terminal-e2e-build -> terminal-e2e-prodbuild);
# every other spec stays on the `next dev` rows above. Moving specs between
# lanes adds three ways to lose coverage with every job green: a spec routed to
# neither lane, a prod lane that skips without failing the required check, and
# a dev-only journey (admin, /dev/*, opt-in flags) sent to a server that cannot
# serve it. The tests below parse the real workflow, selector and spec tree.
# ---------------------------------------------------------------------------

E2E_DIR = ROOT / "terminal" / "e2e"
ALLOWLIST = E2E_DIR / "prodbuild-allowlist.txt"
RESPONSIVE = ("desktop", "tablet", "mobile")
GATE_STEP = "Assert all event-required Terminal checks passed"
GATE_RESULTS = ("success", "failure", "cancelled", "skipped", "timed_out", "unknown", "")
# Playwright's default testMatch: these are the files it would load on its own.
PLAYWRIGHT_TEST_FILE = re.compile(r"\.(spec|test)\.[cm]?[jt]sx?\Z")
DOCS_PR = ("github.event_name == 'pull_request' && needs.pr_scope.result == 'success' "
           "&& needs.pr_scope.outputs.mode == 'docs'")


def allowlist() -> list[str]:
    return scope.read_prodbuild_allowlist(ALLOWLIST)


def spec_names() -> list[str]:
    return scope.e2e_spec_names(E2E_DIR)


def lanes() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(dev, prod) exactly as a full non-merge-group run receives them."""
    return scope.split_lanes(FULL_MATRIX, allowlist(), E2E_DIR)


def selected_projects(item: dict[str, Any]) -> list[str]:
    return [match.group(1) for token in str(item["projects"]).split()
            if (match := PROJECT_FLAG.match(token))]


def files_selected(item: dict[str, Any], names: list[str]) -> set[str]:
    """Spec files one matrix row hands to Playwright. A positional argument is a
    case-insensitive regular expression searched in the absolute file path, and
    no argument at all selects every file."""
    filters = str(item["specs"]).split()
    if not filters:
        return set(names)
    patterns = [re.compile(text, re.IGNORECASE) for text in filters]
    return {
        name for name in names
        if any(pattern.search(f"/checkout/terminal/e2e/{name}") for pattern in patterns)
    }


def lane_assignment_errors(dev: list[dict[str, Any]], prod: list[dict[str, Any]],
                           names: list[str]) -> list[str]:
    """Every way a responsive project could run a spec zero times or in both
    lanes. An empty list means each spec runs in exactly one lane."""
    errors: list[str] = []
    for project in RESPONSIVE:
        selected: dict[str, set[str]] = {}
        for lane, rows in (("dev", dev), ("prod", prod)):
            mine = [row for row in rows if project in selected_projects(row)]
            # --shard=i/N partitions ONE selection; shards with different file
            # lists would each drop a different part of it.
            if len({str(row["specs"]) for row in mine}) > 1:
                errors.append(f"{project}: {lane} shards disagree on the spec list")
            selected[lane] = set().union(*(files_selected(row, names) for row in mine))
        for name in sorted(selected["dev"] & selected["prod"]):
            errors.append(f"{project}: {name} runs in both lanes")
        for name in sorted(set(names) - selected["dev"] - selected["prod"]):
            errors.append(f"{project}: {name} runs in neither lane")
    return errors


def test_the_lane_split_is_real():
    # Non-vacuity: with no prod lane, "exactly one lane" would hold trivially.
    dev, prod = lanes()
    names = spec_names()
    assert len(names) > 300
    assert allowlist() and len(set(names) - set(allowlist())) > 100
    for project in RESPONSIVE:
        assert files_selected(project_entries(prod, project)[0], names) == set(allowlist())
        assert files_selected(project_entries(dev, project)[0], names) == set(names) - set(allowlist())


def test_every_spec_runs_in_exactly_one_lane():
    dev, prod = lanes()
    assert lane_assignment_errors(dev, prod, spec_names()) == []


def test_both_lanes_still_run_every_project_and_shard_exactly_once():
    dev, prod = lanes()
    assert matrix_coverage_errors(dev, playwright_projects()) == []
    assert matrix_coverage_errors(prod, set(RESPONSIVE)) == []
    # Artifact names and concurrency groups are derived from `shard`.
    assert not {row["shard"] for row in dev} & {row["shard"] for row in prod}
    assert all(row["shard"].startswith("prodbuild-") for row in prod)


def test_the_dev_matrix_keeps_its_measured_shape_after_the_split():
    # Stage 1 keeps 6/4/5: every minimum above is a measured cap incident, and
    # no hosted run of the reduced dev load exists yet to justify fewer shards.
    dev, prod = lanes()
    assert [(row["shard"], row["projects"]) for row in dev] == [
        (row["shard"], row["projects"]) for row in FULL_MATRIX
    ]
    assert entry(dev, "serial") == entry(FULL_MATRIX, "serial")
    # Fewer, fuller prod shards: each one pays the install + download again.
    assert [row["shard"] for row in prod] == [
        "prodbuild-desktop-1", "prodbuild-desktop-2", "prodbuild-tablet-1", "prodbuild-mobile-1",
    ]


def test_a_spec_dropped_from_the_dev_list_is_reported():
    dev, prod = lanes()
    victim = next(name for name in spec_names() if name not in allowlist())
    for row in project_entries(dev, "tablet"):
        row["specs"] = " ".join(t for t in row["specs"].split() if t != f"e2e/{victim}")
    assert f"tablet: {victim} runs in neither lane" in lane_assignment_errors(dev, prod, spec_names())


def test_a_spec_run_by_both_lanes_is_reported():
    dev, prod = lanes()
    victim = allowlist()[0]
    for row in project_entries(dev, "mobile"):
        row["specs"] += f" e2e/{victim}"
    assert f"mobile: {victim} runs in both lanes" in lane_assignment_errors(dev, prod, spec_names())


def test_an_unfiltered_dev_row_beside_a_prod_lane_is_reported():
    # The pre-split shape: dev runs everything while prod also runs its list.
    dev, prod = lanes()
    entry(dev, "desktop-3")["specs"] = ""
    errors = lane_assignment_errors(dev, prod, spec_names())
    assert "desktop: dev shards disagree on the spec list" in errors
    assert f"desktop: {allowlist()[0]} runs in both lanes" in errors


def test_a_prod_shard_with_a_shorter_list_is_reported():
    dev, prod = lanes()
    entry(prod, "prodbuild-desktop-2")["specs"] = f"e2e/{allowlist()[0]}"
    assert "desktop: prod shards disagree on the spec list" in lane_assignment_errors(
        dev, prod, spec_names()
    )


def test_a_filter_that_also_matches_a_neighbouring_file_is_reported():
    # Filters are regular expressions: `a.spec.ts` also selects `a-spec.ts`.
    names = ["a.spec.ts", "a-spec.ts", "b.spec.ts"]
    dev = [{"shard": "desktop-1", "projects": "--project=desktop", "specs": "e2e/a-spec.ts e2e/b.spec.ts"}]
    prod = [{"shard": "prodbuild-desktop-1", "projects": "--project=desktop", "specs": "e2e/a.spec.ts"}]
    assert "desktop: a-spec.ts runs in both lanes" in lane_assignment_errors(dev, prod, names)


def _tree(tmp_path: Path, files: list[str], listed: list[str]) -> Path:
    root = tmp_path / "terminal" / "e2e"
    for name in files:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("// fixture\n", encoding="utf-8")
    (root / "prodbuild-allowlist.txt").write_text("".join(f"{n}\n" for n in listed), encoding="utf-8")
    return root


def test_a_new_spec_defaults_to_the_dev_lane(tmp_path):
    root = _tree(tmp_path, ["a.spec.ts", "b.spec.ts"], ["a.spec.ts"])
    dev, prod = scope.split_lanes(FULL_MATRIX, ["a.spec.ts"], root)
    assert entry(prod, "prodbuild-mobile-1")["specs"] == "e2e/a.spec.ts"
    (root / "brand-new.spec.ts").write_text("// fixture\n", encoding="utf-8")
    dev, prod = scope.split_lanes(FULL_MATRIX, ["a.spec.ts"], root)
    assert entry(dev, "mobile-1")["specs"] == "e2e/b.spec.ts e2e/brand-new.spec.ts"
    assert entry(prod, "prodbuild-mobile-1")["specs"] == "e2e/a.spec.ts"
    assert lane_assignment_errors(dev, prod, scope.e2e_spec_names(root)) == []


# Trees the split must refuse: an explicit `e2e/<name>` list would lose or
# mangle one of their files, so dev keeps running everything unfiltered.
UNSPLITTABLE = {
    "nested spec": (["a.spec.ts", "b.spec.ts", "sub/c.spec.ts"], ["a.spec.ts"]),
    "other extension": (["a.spec.ts", "b.spec.ts", "c.spec.tsx"], ["a.spec.ts"]),
    "shell metacharacter": (["a.spec.ts", "b.spec.ts", "c;id.spec.ts"], ["a.spec.ts"]),
    "space in name": (["a.spec.ts", "b.spec.ts", "c d.spec.ts"], ["a.spec.ts"]),
    "everything allowlisted": (["a.spec.ts", "b.spec.ts"], ["a.spec.ts", "b.spec.ts"]),
    "nothing allowlisted exists": (["a.spec.ts", "b.spec.ts"], ["gone.spec.ts"]),
    "empty allowlist": (["a.spec.ts", "b.spec.ts"], []),
}
SPLITTABLE = {
    "plain": (["a.spec.ts", "b.spec.ts", "c.spec.ts"], ["b.spec.ts"]),
    "stale entry ignored": (["a.spec.ts", "b.spec.ts"], ["b.spec.ts", "gone.spec.ts"]),
    "path entry ignored": (["a.spec.ts", "b.spec.ts"], ["b.spec.ts", "../a.spec.ts", "e2e/a.spec.ts"]),
    "node:test helper beside specs": (["a.spec.ts", "b.spec.ts", "tools/x.test.cjs"], ["a.spec.ts"]),
}


@pytest.mark.parametrize("case", sorted(UNSPLITTABLE))
def test_an_unprovable_split_leaves_dev_running_everything(tmp_path, case):
    files, listed = UNSPLITTABLE[case]
    dev, prod = scope.split_lanes(FULL_MATRIX, listed, _tree(tmp_path, files, listed))
    assert dev == FULL_MATRIX and prod == []


def test_a_row_shape_the_split_does_not_recognize_is_left_alone(tmp_path):
    root = _tree(tmp_path, ["a.spec.ts", "b.spec.ts"], ["a.spec.ts"])
    # A project whose rows are not all unfiltered single-project rows keeps its
    # dev rows and gets no prod shard; the other projects still split.
    matrix = deepcopy(FULL_MATRIX)
    entry(matrix, "tablet-2")["specs"] = "e2e/b.spec.ts"
    dev, prod = scope.split_lanes(matrix, ["a.spec.ts"], root)
    assert project_entries(dev, "tablet") == project_entries(matrix, "tablet")
    assert project_entries(prod, "tablet") == []
    assert len(project_entries(prod, "desktop")) == 2
    assert scope.split_lanes(FOCUSED_MATRIX, ["a.spec.ts"], root) == (FOCUSED_MATRIX, [])


def run_scope_step(cwd: Path, tmp_path: Path, event: str) -> dict[str, str]:
    """Execute the workflow's real selector step for a non-PR event and return
    the outputs GitHub would read (the last write of a key wins)."""
    shell = ci_workflow()["jobs"]["e2e-scope"]["steps"][-1]["run"]
    output = tmp_path / f"github-output-{event}"
    output.write_text("", encoding="utf-8")
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", shell], cwd=cwd, text=True,
        capture_output=True, timeout=30,
        env={**os.environ, "GITHUB_EVENT_NAME": event, "GITHUB_OUTPUT": str(output),
             "GITHUB_SHA": "0" * 40, "GITHUB_REF": "refs/heads/master",
             "PR_HEAD_SHA": "", "RUNNER_TEMP": str(tmp_path)},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return dict(line.split("=", 1) for line in output.read_text().splitlines() if "=" in line)


def assert_step_outputs(fields: dict[str, str], dev: list[dict], prod: list[dict]) -> None:
    assert fields["mode"] == "full"
    assert json.loads(fields["matrix"]) == {"include": dev}
    assert json.loads(fields["prodbuild_matrix"]) == {"include": prod}
    assert fields["prodbuild_count"] == str(len(prod))


@pytest.mark.parametrize("event", ["push", "schedule", "workflow_dispatch"])
def test_events_without_a_protected_selector_get_the_same_split(tmp_path, event):
    # These events never execute scripts/ci_e2e_scope.py: the workflow's inline
    # rule must produce exactly what the selector would.
    dev, prod = lanes()
    assert prod
    assert_step_outputs(run_scope_step(ROOT, tmp_path, event), dev, prod)


def test_the_selector_itself_emits_the_split_for_a_full_pull_request(tmp_path):
    # After this selector is the protected base, PR runs take this path and the
    # workflow's inline rule stands down (it sees prodbuild_count already set).
    output = tmp_path / "github-output"
    output.write_text("", encoding="utf-8")
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "ci_e2e_scope.py")], cwd=ROOT, check=True,
        capture_output=True, timeout=30,
        env={**os.environ, "GITHUB_EVENT_NAME": "pull_request", "GITHUB_OUTPUT": str(output),
             "GITHUB_REF": "refs/heads/not-a-merge-ref", "GITHUB_SHA": "", "PR_HEAD_SHA": ""},
    )
    fields = dict(line.split("=", 1) for line in output.read_text().splitlines() if "=" in line)
    assert_step_outputs(fields, *lanes())
    shell = ci_workflow()["jobs"]["e2e-scope"]["steps"][-1]["run"]
    assert 'if "prodbuild_count" not in fields:' in shell


def test_a_merge_group_selects_only_the_production_lane_for_execution(tmp_path):
    dev, prod = lanes()
    assert_step_outputs(run_scope_step(ROOT, tmp_path, "merge_group"), dev, prod)
    output = tmp_path / "selector-output"
    output.write_text("", encoding="utf-8")
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "ci_e2e_scope.py")], cwd=ROOT, check=True,
        capture_output=True, timeout=30,
        env={**os.environ, "GITHUB_EVENT_NAME": "merge_group", "GITHUB_OUTPUT": str(output)},
    )
    fields = dict(line.split("=", 1) for line in output.read_text().splitlines() if "=" in line)
    # The dev matrix keeps its ordinary selection semantics, but the job-level
    # merge-group exclusion means only these four production rows execute.
    assert_step_outputs(fields, dev, prod)


@pytest.mark.parametrize("case", sorted({**UNSPLITTABLE, **SPLITTABLE}))
def test_the_inline_rule_and_the_selector_agree_on_every_tree(tmp_path, case):
    files, listed = {**UNSPLITTABLE, **SPLITTABLE}[case]
    root = _tree(tmp_path, files, listed)
    dev, prod = scope.split_lanes(FULL_MATRIX, scope.read_prodbuild_allowlist(root / ALLOWLIST.name), root)
    assert bool(prod) is (case in SPLITTABLE)
    assert_step_outputs(run_scope_step(tmp_path, tmp_path, "push"), dev, prod)
    if prod:
        assert lane_assignment_errors(dev, prod, scope.e2e_spec_names(root)) == []


def test_every_file_playwright_would_load_is_routed_or_is_not_a_browser_test():
    # The lanes route top-level `<name>.spec.ts` files by name. Anything else
    # Playwright's default testMatch picks up would silently leave both lanes
    # once the dev rows carry an explicit list.
    assert scope.unroutable_specs(E2E_DIR) == []
    others = sorted(
        path.relative_to(E2E_DIR).as_posix() for path in E2E_DIR.rglob("*")
        if path.is_file() and PLAYWRIGHT_TEST_FILE.search(path.name)
        and not (path.parent == E2E_DIR and path.name.endswith(".spec.ts"))
    )
    # node:test suites: they import no Playwright `test`, so they contribute no
    # browser test to any shard, filtered or not.
    assert others and all(re.fullmatch(r"tools/[A-Za-z0-9_]+\.test\.cjs", name) for name in others), others
    for name in others:
        text = (E2E_DIR / name).read_text(encoding="utf-8")
        assert re.search(r"""require\(["']node:test["']\)""", text), name
        assert not re.search(r"""(require\(|from\s+)["']@playwright/test["']""", text), name


# --- allowlist contents ------------------------------------------------------

OPT_IN_ENV = ("MMX_SHARED_SHELL", "MMX_INVESTOR_SHELL_PREVIEW",
              "TERMINAL_E2E_CLOSED_CANONICAL_TRANSPORT")
# `[class*="__topic"]` and friends match the dev compiler's CSS-module names
# (`<File>-module__<hash>__<local>`). `next build` on Next 16.4.6 emits
# `<hash>_<local>`, so such a selector finds nothing against `next start`.
COMPILED_CLASS_SELECTOR = re.compile(r"""\[class[*^$|~]?=["'][^"'\]]*__""")


@lru_cache(maxsize=None)
def serial_project_specs() -> frozenset[str]:
    """Files the responsive projects `testIgnore` and a serial project owns."""
    text = PLAYWRIGHT_CONFIG.read_text(encoding="utf-8")
    patterns = dict(re.findall(r"^const (\w+Spec) = /(.+)/;$", text, re.MULTILINE))
    ignored = set(re.findall(r"\b(\w+Spec)\b", text[text.index("projects: ["):text.index("webServer:")]))
    assert ignored and ignored <= set(patterns)
    return frozenset(name for name in spec_names()
                     if any(re.search(patterns[key], name) for key in ignored))


@lru_cache(maxsize=None)
def serial_opt_in_specs() -> frozenset[str]:
    """Specs the serial shard re-runs under a feature flag the default server
    (and therefore the one production build) does not carry."""
    found: set[str] = set()
    for step in ci_workflow()["jobs"]["terminal-e2e"]["steps"]:
        # A serial evidence capture uses the ordinary server environment.
        # Only a step that actually supplies an opt-in feature flag changes
        # whether a spec can run against the shared production build.
        if ("matrix.shard == 'serial'" in str(step.get("if", ""))
                and any(flag in step.get("env", {}) for flag in OPT_IN_ENV)):
            found.update(re.findall(r"\be2e/([A-Za-z0-9._-]+\.spec\.ts)\b", str(step.get("run", ""))))
    return frozenset(found)


def dev_only_reasons(name: str) -> list[str]:
    """Why a spec can only pass against `next dev` with its fixture seams."""
    text = (E2E_DIR / name).read_text(encoding="utf-8")
    reasons = []
    if name.startswith("admin-") or re.search(r"/admin\b", text) or "ADMIN_DEV" in text:
        reasons.append("admin console (adminGate needs NODE_ENV=development)")
    if "/dev/" in text:
        reasons.append("/dev/* page (notFound in a production build)")
    if name == "plat-dev-indicator.spec.ts":
        reasons.append("asserts the Next dev indicator")
    if name in serial_project_specs():
        reasons.append("owned by a serial project")
    if name in serial_opt_in_specs():
        reasons.append("serial opt-in spec")
    if any(flag in text for flag in OPT_IN_ENV):
        reasons.append("needs a separate opt-in server environment")
    if COMPILED_CLASS_SELECTOR.search(text):
        reasons.append("selects dev-compiled CSS-module class names")
    if re.search(r"/analysis\b", text):
        reasons.append("reaches /analysis (its local preview needs NODE_ENV != production)")
    return reasons


def allowlist_errors(entries: list[str]) -> list[str]:
    errors: list[str] = []
    if entries != sorted(set(entries)):
        errors.append("allowlist is not sorted and free of duplicates")
    for name in entries:
        if not scope.SAFE_SPEC_NAME.fullmatch(name):
            errors.append(f"{name}: not a bare spec filename")
        elif not (E2E_DIR / name).is_file():
            errors.append(f"{name}: no such spec")
        else:
            errors.extend(f"{name}: {reason}" for reason in dev_only_reasons(name))
    return errors


def test_every_allowlist_entry_exists_and_none_is_a_dev_only_spec():
    assert allowlist_errors(allowlist()) == []


def test_the_dev_only_rules_see_the_real_dev_only_specs():
    # Non-vacuity: each rule must fire on the specs it exists to keep out.
    assert serial_project_specs() == {
        "company-intelligence.spec.ts", "terminal-chrome-responsive.spec.ts", "w2a-workspaces.spec.ts",
    }
    assert serial_opt_in_specs() == {
        "investor-shell-preview.spec.ts", "shared-shell-refinement.spec.ts",
        "intl-history-date-intent.spec.ts", "discover-focus-continuity.spec.ts",
    }
    flagged = {name for name in spec_names() if dev_only_reasons(name)}
    assert {"admin-log-crops.spec.ts", "admin-log-responsive.spec.ts", "plat-dev-indicator.spec.ts",
            "account-export-integrity.spec.ts", "shared-shell-access.spec.ts",
            "news-flow-responsive.spec.ts", "command-palette.spec.ts"} <= flagged
    assert sum("/dev/" in " ".join(dev_only_reasons(name)) for name in spec_names()) >= 8
    assert not flagged & set(allowlist())


@pytest.mark.parametrize("name,reason", [
    ("admin-log-responsive.spec.ts", "admin console"),
    ("account-export-integrity.spec.ts", "/dev/* page"),
    ("plat-dev-indicator.spec.ts", "Next dev indicator"),
    ("company-intelligence.spec.ts", "owned by a serial project"),
    ("investor-shell-preview.spec.ts", "serial opt-in spec"),
    ("shared-shell-access.spec.ts", "separate opt-in server environment"),
    ("news-flow-responsive.spec.ts", "dev-compiled CSS-module class names"),
    ("command-palette.spec.ts", "reaches /analysis"),
])
def test_allowlisting_a_dev_only_spec_is_reported(name, reason):
    errors = allowlist_errors(sorted([*allowlist(), name]))
    assert any(error.startswith(f"{name}: ") and reason in error for error in errors), errors


def test_allowlist_hygiene_mutations_are_reported():
    entries = allowlist()
    assert "gone.spec.ts: no such spec" in allowlist_errors(sorted([*entries, "gone.spec.ts"]))
    assert "allowlist is not sorted and free of duplicates" in allowlist_errors([*entries, entries[0]])
    assert "allowlist is not sorted and free of duplicates" in allowlist_errors(entries[::-1])
    assert any("not a bare spec filename" in error
               for error in allowlist_errors(sorted([*entries, "e2e/alerts.spec.ts"])))


# --- workflow wiring ---------------------------------------------------------

def webserver_env() -> dict[str, str]:
    text = PLAYWRIGHT_CONFIG.read_text(encoding="utf-8")
    block = text[text.index("env: {", text.index("webServer:")):]
    block = block[:block.index("\n    },")]
    return dict(re.findall(r'^\s+([A-Z][A-Z0-9_]*): "([^"]*)",$', block, re.MULTILINE))


def test_the_production_lane_also_runs_on_merge_groups_where_dev_is_skipped():
    jobs = ci_workflow()["jobs"]
    dev_if = jobs["terminal-e2e"]["if"]
    assert dev_if == (
        "${{ !cancelled() && needs.e2e-scope.result == 'success' "
        "&& github.event_name != 'merge_group' && !(" + DOCS_PR + ") }}"
    )
    build = jobs["terminal-e2e-build"]
    # The dev condition without only its merge-group exclusion, plus "the
    # selector emitted prod shards": no docs-only PR run or failed selector.
    assert build["if"] == dev_if.replace(
        "&& github.event_name != 'merge_group' ",
        "&& needs.e2e-scope.outputs.prodbuild_count != '0' ",
    )
    assert "github.event_name != 'merge_group'" not in build["if"]
    assert build["needs"] == ["pr_scope", "e2e-scope"]
    shards = jobs["terminal-e2e-prodbuild"]
    assert shards["if"] == build["if"].replace(
        "needs.e2e-scope.result == 'success' ",
        "needs.e2e-scope.result == 'success' && needs.terminal-e2e-build.result == 'success' ",
    )
    assert shards["if"] != build["if"]
    assert shards["needs"] == ["pr_scope", "e2e-scope", "terminal-e2e-build"]
    assert shards["strategy"] == {
        "fail-fast": False,
        "matrix": "${{ fromJSON(needs.e2e-scope.outputs.prodbuild_matrix) }}",
    }
    outputs = jobs["e2e-scope"]["outputs"]
    assert outputs["prodbuild_matrix"] == "${{ steps.select.outputs.prodbuild_matrix }}"
    assert outputs["prodbuild_count"] == "${{ steps.select.outputs.prodbuild_count }}"


def test_the_build_job_builds_with_npx_next_build_and_the_e2e_environment():
    build = ci_workflow()["jobs"]["terminal-e2e-build"]
    commands = [str(step.get("run", "")) for step in build["steps"]]
    builders = [command for command in commands if "next build" in command]
    assert len(builders) == 1
    assert re.search(r"^\s*npx next build\s*$", builders[0], re.MULTILINE)
    # `npm run build` would run the prebuild hook; ops/terminal-build.sh is the
    # deploy build. Neither belongs in CI's fixture build.
    assert not any(re.search(r"npm run build|terminal-build\.sh", command) for command in commands)
    # NEXT_PUBLIC_* are inlined at build time, so the build must see exactly the
    # values the dev lane's server gets from playwright.config.ts.
    expected = webserver_env()
    assert {"NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "TERMINAL_E2E_FIXTURE"} <= set(expected)
    assert build["env"] == expected
    assert not any("env" in step for step in build["steps"])
    text = CI_WORKFLOW.read_text(encoding="utf-8")
    section = text[text.index("\n  terminal-e2e-build:"):text.index("\n  terminal:\n")]
    assert not any(flag in section for flag in OPT_IN_ENV)


def test_prod_shards_run_only_this_runs_build_through_the_prodbuild_config():
    jobs = ci_workflow()["jobs"]
    upload = next(step for step in jobs["terminal-e2e-build"]["steps"]
                  if str(step.get("uses", "")).startswith("actions/upload-artifact@"))
    steps = jobs["terminal-e2e-prodbuild"]["steps"]
    download = next(step for step in steps
                    if str(step.get("uses", "")).startswith("actions/download-artifact@"))
    # Same run only: the name is bound to the run id, and download-artifact is
    # given no run-id/repository/token that could reach another run.
    assert upload["with"]["name"] == download["with"]["name"] == "e2e-prodbuild-${{ github.run_id }}"
    assert set(download["with"]) == {"name", "path"}
    assert upload["with"]["retention-days"] == 1
    # An expired or missing build (a prod shard re-run more than a day later)
    # must say what to do, in the step straight after the failed download.
    guard = steps[steps.index(download) + 1]
    assert guard["if"] == f"failure() && steps.{download['id']}.outcome == 'failure'"
    assert "::error" in guard["run"] and "Re-run all jobs" in guard["run"]
    assert re.search(r"missing or expired.*1 day", guard["run"])
    assert guard["run"].rstrip().endswith("exit 1")
    assert not guard.get("continue-on-error", False)
    runs = [str(step.get("run", "")) for step in steps if "test:e2e:responsive" in str(step.get("run", ""))]
    assert len(runs) == 1
    assert runs[0].split() == (
        "npm run test:e2e:responsive -- -c playwright.prodbuild.config.ts "
        "${{ matrix.projects }} ${{ matrix.specs }} --workers=1"
    ).split()
    config = (ROOT / "terminal" / "playwright.prodbuild.config.ts").read_text(encoding="utf-8")
    assert "...baseConfig" in config
    # The one server command this config can start is `next start`.
    assert re.findall(r"^\s*command: `(.+)`,$", config, re.MULTILINE) == [
        "npm run start -- --hostname 127.0.0.1 --port ${port}"
    ]
    names = [str(step.get("name", "")) for step in steps]
    assert names.index("Unpack production build") < names.index("Run allowlisted specs against next start")
    assert not any("next build" in str(step.get("run", "")) for step in steps)


def test_the_prod_lane_adds_no_write_authority_and_saves_no_shared_cache():
    workflow = ci_workflow()
    assert workflow["permissions"] == {"contents": "read"}
    # PyYAML reads the bare key `on` as True.
    dispatch = workflow[True]["workflow_dispatch"]
    assert set(dispatch["inputs"]) == {"pr_number"}
    assert_merge_group_production_shape(workflow["jobs"])
    for job in ("terminal-e2e-build", "terminal-e2e-prodbuild"):
        config = workflow["jobs"][job]
        assert "permissions" not in config
        uses = [str(step.get("uses", "")) for step in config["steps"]]
        # Restore-only browser cache; `actions/cache@` would also SAVE.
        assert not any(action.startswith("actions/cache@") for action in uses), job
        checkout = next(step for step in config["steps"]
                        if str(step.get("uses", "")).startswith("actions/checkout@"))
        # No `ref`: only the event's own commit is ever built or tested.
        assert checkout.get("with") == {"persist-credentials": False}, job
        text = json.dumps(config)
        assert "secrets." not in text and "inputs." not in text and "github.head_ref" not in text
        group = config["concurrency"]["group"]
        assert group.startswith("terminal-ci-${{ github.event.pull_request.number || github.ref }}-" + job)
        assert config["concurrency"]["cancel-in-progress"] is True
    assert workflow["jobs"]["terminal-e2e-prodbuild"]["concurrency"]["group"].endswith("-${{ matrix.shard }}")


def assert_merge_group_production_shape(jobs: dict[str, Any]) -> None:
    """Pin the production-only, fixed-hosted merge-group qualification shape.

    Selector/output results are exercised separately by ``run_scope_step`` and
    ``run_gate`` with the real shell blocks: an empty or unsuccessful lane must
    fail even if the static workflow shape remains correct.
    """
    dev, prod = lanes()
    assert len(prod) == 4
    assert "terminal-e2e-build" in jobs and "terminal-e2e-prodbuild" in jobs
    assert matrix_coverage_errors(dev, playwright_projects()) == []
    assert matrix_coverage_errors(prod, set(RESPONSIVE)) == []
    assert "github.event_name != 'merge_group'" in jobs["terminal-e2e"]["if"]
    run = next(step["run"] for step in jobs["terminal"]["steps"] if step.get("name") == GATE_STEP)
    assert run.count('[ "$EVENT" = "merge_group" ] && [ "$PRODBUILD_COUNT" != "4" ]; then') == 1
    assert run.count('[ "$EVENT" != "merge_group" ] && [ "$PRODBUILD_COUNT" = "0" ]') == 2
    expected_needs = {
        "terminal-e2e-build": ["pr_scope", "e2e-scope"],
        "terminal-e2e-prodbuild": ["pr_scope", "e2e-scope", "terminal-e2e-build"],
    }
    for name, dependencies in expected_needs.items():
        job = jobs[name]
        # Fixed hosted image only; reject self-hosted or dynamic labels.
        assert job["runs-on"] == "ubuntu-24.04"
        assert "github.event_name != 'merge_group'" not in job["if"]
        assert name in jobs["terminal"]["needs"]
        assert job["needs"] == dependencies
        assert 'needs.e2e-scope.outputs.prodbuild_count != \'0\'' in job["if"]


@pytest.mark.parametrize(("job", "mutation"), [
    (name, mutation) for name in ("terminal-e2e-build", "terminal-e2e-prodbuild")
    for mutation in ("removed", "exclude-merge-group", "ubuntu-latest",
                     "self-hosted", "dynamic-label",
                     "remove-count-prerequisite", "remove-merge-count-assertion")
])
def test_mutations_cannot_remove_or_reroute_merge_group_production(job, mutation):
    jobs = deepcopy(ci_workflow()["jobs"])
    count = run_gate(EVENT="merge_group", PR_SCOPE="skipped", PR_MODE="full", E2E="skipped")
    assert count.returncode == 0, count.stdout
    if mutation == "removed":
        del jobs[job]
        jobs["terminal"]["needs"].remove(job)
    elif mutation == "exclude-merge-group":
        jobs[job]["if"] = jobs[job]["if"].replace(
            "needs.e2e-scope.outputs.prodbuild_count != '0'",
            "github.event_name != 'merge_group' && needs.e2e-scope.outputs.prodbuild_count != '0'",
        )
    elif mutation == "ubuntu-latest":
        jobs[job]["runs-on"] = "ubuntu-latest"
    elif mutation == "self-hosted":
        jobs[job]["runs-on"] = ["self-hosted", "linux", "x64"]
    elif mutation == "dynamic-label":
        jobs[job]["runs-on"] = "${{ vars.TERMINAL_E2E_LANE }}"
    elif mutation == "remove-merge-count-assertion":
        step = next(step for step in jobs["terminal"]["steps"] if step.get("name") == GATE_STEP)
        if job == "terminal-e2e-build":
            step["run"] = step["run"].replace(
                'if [ "$EVENT" = "merge_group" ] && [ "$PRODBUILD_COUNT" != "4" ]; then',
                'if [ "$EVENT" = "pull_request" ] && [ "$PRODBUILD_COUNT" = "unexpected" ]; then',
            )
        else:
            start = step["run"].index('if [ "$PRODBUILD" = "success" ]; then')
            run = step["run"][start:]
            run = run.replace('{ [ "$EVENT" != "merge_group" ] && [ "$PRODBUILD_COUNT" = "0" ]; }', '[ "$PRODBUILD_COUNT" = "0" ]')
            step["run"] = step["run"][:start] + run
    elif mutation == "remove-count-prerequisite":
        # A nonempty selector is part of the fail-closed production schedule.
        jobs[job]["if"] = jobs[job]["if"].replace("needs.e2e-scope.outputs.prodbuild_count", "needs.e2e-scope.outputs.other")
    with pytest.raises(AssertionError):
        assert_merge_group_production_shape(jobs)


def test_the_three_required_check_names_are_unchanged():
    jobs = ci_workflow()["jobs"]
    assert jobs["terminal"]["name"] == "Terminal typecheck + tests"
    assert jobs["python"]["name"] == "Ingest + signal-layer tests"
    assert jobs["hub"]["name"] == "Quote Hub tests"
    names = [str(job.get("name", "")) for job in jobs.values()]
    for required in ("Terminal typecheck + tests", "Ingest + signal-layer tests", "Quote Hub tests"):
        assert names.count(required) == 1


def test_the_required_aggregate_needs_the_build_and_the_prod_shards():
    aggregate = ci_workflow()["jobs"]["terminal"]
    assert {"terminal-e2e", "terminal-e2e-build", "terminal-e2e-prodbuild"} <= set(aggregate["needs"])
    step = next(step for step in aggregate["steps"] if step.get("name") == GATE_STEP)
    assert step["env"]["BUILD"] == "${{ needs.terminal-e2e-build.result }}"
    assert step["env"]["PRODBUILD"] == "${{ needs.terminal-e2e-prodbuild.result }}"
    assert step["env"]["PRODBUILD_COUNT"] == "${{ needs.e2e-scope.outputs.prodbuild_count }}"


def run_gate(**overrides: str) -> subprocess.CompletedProcess:
    """Execute the required check's real shell. Defaults: an ordinary source
    pull request on which every job, including the four prod shards, passed."""
    aggregate = ci_workflow()["jobs"]["terminal"]
    step = next(step for step in aggregate["steps"] if step.get("name") == GATE_STEP)
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "EVENT": "pull_request", "PR_SCOPE": "success", "PR_MODE": "full",
        "SCOPE": "success", "UNIT": "success", "E2E": "success",
        "BUILD": "success", "PRODBUILD": "success", "PRODBUILD_COUNT": "4", **overrides,
    }
    assert set(env) - {"PATH"} == set(step["env"])
    return subprocess.run(["bash", "-e", "-c", step["run"]], env=env,
                          capture_output=True, text=True, timeout=10)


@pytest.mark.parametrize(("build", "prod"), list(product(GATE_RESULTS, repeat=2)))
def test_the_gate_passes_a_source_pr_only_when_build_and_prod_shards_succeed(build, prod):
    result = run_gate(BUILD=build, PRODBUILD=prod)
    assert (result.returncode == 0) is (build == prod == "success"), result.stdout


@pytest.mark.parametrize("event", ["pull_request", "push", "schedule", "workflow_dispatch"])
def test_a_failed_build_fails_the_gate_and_its_skipped_shards_do_not_hide_it(event):
    # What GitHub reports when the build fails: the build is `failure` and the
    # prod shards, which need it, are `skipped`.
    result = run_gate(EVENT=event, BUILD="failure", PRODBUILD="skipped")
    assert result.returncode != 0
    assert "terminal-e2e-build concluded 'failure'" in result.stdout
    assert "terminal-e2e-prodbuild concluded 'skipped'" in result.stdout
    for build, prod in (("cancelled", "skipped"), ("success", "failure"),
                        ("success", "cancelled"), ("success", "skipped"), ("skipped", "skipped")):
        assert run_gate(EVENT=event, BUILD=build, PRODBUILD=prod).returncode != 0, (build, prod)


@pytest.mark.parametrize("overrides", [
    # Only the qualified docs PR and non-queue empty-lane skips remain lawful.
    {"PR_MODE": "docs", "UNIT": "skipped", "E2E": "skipped"},
    {"PRODBUILD_COUNT": "0"},
])
def test_the_prod_lane_may_skip_only_where_its_jobs_are_allowed_to(overrides):
    assert run_gate(BUILD="skipped", PRODBUILD="skipped", **overrides).returncode == 0
    for status in ("failure", "cancelled", "timed_out", ""):
        assert run_gate(BUILD=status, PRODBUILD="skipped", **overrides).returncode != 0
        assert run_gate(BUILD="skipped", PRODBUILD=status, **overrides).returncode != 0


@pytest.mark.parametrize("count", ["", "4", "1", "00", "none"])
def test_a_skipped_prod_lane_with_shards_to_run_is_never_green(count):
    result = run_gate(BUILD="skipped", PRODBUILD="skipped", PRODBUILD_COUNT=count)
    assert result.returncode != 0, result.stdout


def test_merge_group_requires_four_successful_production_shards_not_dev_matrix():
    result = run_gate(EVENT="merge_group", PR_SCOPE="skipped", PR_MODE="", E2E="skipped")
    assert result.returncode == 0, result.stdout
    # The required aggregate can still absorb an additional successful dev
    # matrix, but production evidence is always independently mandatory.
    assert run_gate(EVENT="merge_group", E2E="success").returncode == 0


@pytest.mark.parametrize("count", ["", "0", "1", "3", "5", "4.0", "04", "4 ", "unknown", "-1"])
def test_merge_group_rejects_a_missing_empty_or_malformed_production_selection(count):
    for skipped in (False, True):
        values = {"BUILD": "skipped", "PRODBUILD": "skipped"} if skipped else {}
        result = run_gate(EVENT="merge_group", PR_SCOPE="skipped", PR_MODE="",
                          E2E="skipped", PRODBUILD_COUNT=count, **values)
        assert result.returncode != 0, (count, skipped, result.stdout)
        assert "native merge group selected" in result.stdout
