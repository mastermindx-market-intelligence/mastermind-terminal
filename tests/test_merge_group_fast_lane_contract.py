"""The native merge queue runs fast checks plus hosted production-browser proof.

The full responsive and screenshot suites still run on ordinary source PRs.
A native merge_group skips the full dev matrix, but its production build and
four browser shards are mandatory and feed the existing required aggregate.
Independently qualified docs-only PRs may skip browser work; the selector
remains mandatory in both cases. The Terminal aggregate must stay red if ANY
check required for that event fails, is unexpectedly skipped, or selects no
production qualification for an integrated candidate.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml"


def jobs() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]


def aggregate_assertion_step() -> dict:
    return next(
        step for step in jobs()["terminal"]["steps"]
        if step.get("name") == "Assert all event-required Terminal checks passed"
    )


def test_full_browser_matrix_only_skips_for_qualified_event() -> None:
    all_jobs = jobs()
    e2e = all_jobs["terminal-e2e"]
    docs = (
        "github.event_name == 'pull_request' && needs.pr_scope.result == 'success' "
        "&& needs.pr_scope.outputs.mode == 'docs'"
    )
    assert e2e["if"] == (
        "${{ !cancelled() && needs.e2e-scope.result == 'success' "
        "&& github.event_name != 'merge_group' && !(" + docs + ") }}"
    )
    assert e2e["strategy"]["fail-fast"] is False
    from scripts.ci_e2e_scope import FULL_MATRIX
    assert len(FULL_MATRIX) == 17
    assert e2e["strategy"]["matrix"] == (
        chr(36) + "{{ fromJSON(needs.e2e-scope.outputs.matrix) }}"
    )
    assert e2e["needs"] == ["pr_scope", "e2e-scope"]
    assert any(
        "test:e2e:responsive -- ${{ matrix.projects }}" in str(step.get("run", ""))
        for step in e2e["steps"]
    )
    # Hub/python checks report on every uncancelled event, including docs PRs;
    # only the unit shard receives the explicitly qualified job-skip exemption.
    for job in ("hub", "python"):
        assert all_jobs[job]["if"] == "${{ !cancelled() }}"
    assert all_jobs["terminal"]["if"] == "always()"
    assert all_jobs["terminal-unit"]["if"] == (
        "${{ !cancelled() && needs.e2e-scope.result == 'success' && !(" + docs + ") }}"
    )
    # The split typecheck and unit-shard lanes share the evidence lane's gate:
    # mandatory browser selector, docs-only skip only, and no merge_group skip.
    for job in ("terminal-typecheck", "terminal-unit-shards", "terminal-f11-evidence"):
        assert all_jobs[job]["if"] == (
            "${{ !cancelled() && needs.e2e-scope.result == 'success' && !(" + docs + ") }}"
        )
        assert all_jobs[job]["needs"] == ["pr_scope", "e2e-scope"]
    unit_shards = all_jobs["terminal-unit-shards"]
    assert unit_shards["strategy"]["fail-fast"] is False
    assert unit_shards["strategy"]["matrix"]["shard"] == [1, 2, 3]


def test_pl6_vi_capture_is_selective_while_f11_keeps_its_browser_prerequisite() -> None:
    steps = jobs()["terminal-unit"]["steps"]
    by_name = {s["name"]: s for s in steps if "name" in s}
    condition = "github.event_name != 'merge_group' || steps.evidence_plan.outputs.capture == 'true'"
    # Chromium follows the selective capture; F11 keeps its browser in its own job.
    assert by_name["Prepare Chromium for original mock captures"]["if"] == condition
    assert not by_name["Prepare Chromium for original mock captures"].get("continue-on-error", False)
    assert "Capture provider-closed F11 theses entry on this checkout" not in by_name
    f11_steps = jobs()["terminal-f11-evidence"]["steps"]
    f11_by_name = {s["name"]: s for s in f11_steps if "name" in s}
    assert "if" not in f11_by_name["Prepare Chromium for the F11 capture"]
    assert not f11_by_name["Prepare Chromium for the F11 capture"].get("continue-on-error", False)
    for step in f11_steps:
        assert "if" not in step or step.get("uses", "").startswith("actions/upload-artifact"), (
            "F11 must qualify every admitted checkout, including native merge groups")
        assert "TERMINAL_EVIDENCE" not in str(step.get("run", ""))
    names = [s.get("name") for s in f11_steps]
    assert names.index("Prepare Chromium for the F11 capture") < names.index(
        "Capture provider-closed F11 theses entry on this checkout")
    f11 = f11_by_name["Capture provider-closed F11 theses entry on this checkout"]
    assert "if" not in f11
    assert f11["run"] == "node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs"
    assert f11["timeout-minutes"] == 8
    assert not f11.get("continue-on-error", False)
    assert by_name["Capture and validate evidence on this checkout"]["if"] == condition
    assert by_name["Plan current-source evidence capture"]["id"] == "evidence_plan"
    assert by_name["Plan current-source evidence capture"]["run"] == (
        "node scripts/ci/plan-evidence-capture.cjs"
    )
    synthetic = by_name["Check immutable evidence orchestration (synthetic)"]["run"]
    for name in (
        "scripts/ci/plan-evidence-capture.test.cjs",
        "e2e/tools/sharedShellSafeReporter.test.cjs",
        "e2e/tools/capture_b_f11_10_analysis_theses_entry.test.cjs",
        "e2e/tools/f11_provider_closed_policy.test.cjs",
    ):
        assert name in synthetic
    for step in steps:
        command = str(step.get("run", ""))
        if "evidence-lock-suites.sh" in command:
            assert "if" not in step, "records-mode evidence validation must follow every capture"
    assert "if" not in by_name["Plain-language guard self-check"]
    assert "if" not in by_name["Plain-language guard (forward-only, added lines block)"]


def test_split_typecheck_and_unit_shards_run_on_every_qualified_event() -> None:
    """Typecheck and the sharded vitest suite left the serial evidence lane:
    they must run on native merge groups (no merge_group skip on any step),
    shard deterministically through vitest's native --shard, and run without
    the evidence env so they behave exactly like a local `npm test`."""
    typecheck_steps = jobs()["terminal-typecheck"]["steps"]
    by_run = {str(step.get("run", "")): step for step in typecheck_steps}
    assert "npx next typegen" in by_run
    assert "if" not in by_run["npx tsc --noEmit"]
    for step in typecheck_steps:
        assert "if" not in step, "typecheck must run on native merge_group"
    shard_steps = jobs()["terminal-unit-shards"]["steps"]
    vitest = next(
        step for step in shard_steps
        if "npx vitest run --shard=" in str(step.get("run", ""))
    )
    assert "${{ matrix.shard }}/3" in vitest["run"]
    assert "if" not in vitest, "unit shards must run on native merge_group"
    for step in shard_steps:
        command = str(step.get("run", ""))
        assert "TERMINAL_EVIDENCE" not in command, (
            "unit shards must not depend on the evidence lane's captured records"
        )


def test_unit_shards_exclude_exactly_the_evidence_lane_suites() -> None:
    """Suites that read capture-produced evidence (records-mode readers and
    sha256 evidence locks) run only in the evidence lane after capture. One
    list script feeds both the evidence step and the shard excludes, and it
    must select every such suite and nothing else."""
    import re
    root = Path(__file__).resolve().parents[1]
    tests_dir = root / "terminal" / "lib" / "__tests__"
    marker = re.compile(
        r"selectedComposition\(|without (a )?recaptur|assertCapturedLexProjection\("
    )
    expected = sorted(
        "lib/__tests__/" + path.name
        for pattern in ("*.test.ts", "*.test.tsx")
        for path in tests_dir.glob(pattern)
        if marker.search(path.read_text(encoding="utf-8"))
    )
    assert "lib/__tests__/b_pl_6Batch1Evidence.test.ts" in expected
    assert "lib/__tests__/visualIntelligenceEvidence.test.ts" in expected
    assert "lib/__tests__/lexEvidenceProjection.test.ts" in expected
    def listed(*group: str) -> list[str]:
        return subprocess.run(
            ["bash", "scripts/ci/evidence-lock-suites.sh", *group],
            cwd=root / "terminal", check=True, capture_output=True, text=True,
            env={**os.environ, "LC_ALL": "C"},
        ).stdout.split()
    assert sorted(listed()) == expected
    assert listed("all") == listed()
    # The F11 group is exactly the suites that read the F11 packet, which only
    # terminal-f11-evidence captures; the evidence group is the remainder.
    f11_expected = sorted(
        suite for suite in expected
        if "b-f11-10-analysis-theses-entry" in (root / "terminal" / suite).read_text(encoding="utf-8")
    )
    assert "lib/__tests__/b_f11_10AnalysisThesesEntryEvidence.test.ts" in f11_expected
    assert sorted(listed("f11")) == f11_expected
    assert sorted(listed("evidence")) == sorted(set(expected) - set(f11_expected))
    assert not set(listed("evidence")) & set(listed("f11"))
    refused = subprocess.run(
        ["bash", "scripts/ci/evidence-lock-suites.sh", "bogus"],
        cwd=root / "terminal", capture_output=True, text=True,
    )
    assert refused.returncode != 0 and not refused.stdout
    lane = next(
        str(step["run"]) for step in jobs()["terminal-unit"]["steps"]
        if step.get("name") == "Validate fresh evidence through the unit readers"
    )
    f11_steps = jobs()["terminal-f11-evidence"]["steps"]
    f11_names = [step.get("name") for step in f11_steps]
    f11_lane = next(
        str(step["run"]) for step in f11_steps
        if step.get("name") == "Validate fresh F11 evidence through the unit readers"
    )
    assert f11_names.index("Capture provider-closed F11 theses entry on this checkout") < f11_names.index(
        "Validate fresh F11 evidence through the unit readers"
    ), "F11 lock suites must run after the F11 capture"
    shard = next(
        str(step["run"]) for step in jobs()["terminal-unit-shards"]["steps"]
        if "npx vitest run --shard=" in str(step.get("run", ""))
    )
    for command, group in ((lane, "evidence"), (f11_lane, "f11"), (shard, "all")):
        assert f"bash scripts/ci/evidence-lock-suites.sh {group})" in command
        assert 'exit 1' in command, "an empty list must fail, not run everything"
    assert '--exclude "$suite"' in shard
    for step in f11_steps:
        if step.get("name") == "Validate fresh F11 evidence through the unit readers":
            assert "if" not in step and not step.get("continue-on-error", False)


def test_pr_time_evidence_drift_gate_feeds_the_planner() -> None:
    """Evidence-lock drift in a PR's own diff must fail the PR, not only the
    merge group: one workflow step records the PR-touched paths (from the
    synthetic merge commit's exact first parent), the unchanged planner step
    consumes EVIDENCE_PR_TOUCHED_FILE, and the recording step is ordered
    before it so the gate can never run on a stale environment."""
    steps = jobs()["terminal-unit"]["steps"]
    names = [s.get("name") for s in steps]
    record = next(
        s for s in steps if s.get("name") == "Record PR-touched paths for the evidence drift gate"
    )
    assert record["if"] == "github.event_name == 'pull_request'"
    run = record["run"]
    assert 'git diff --name-only --no-renames "${BASE}" HEAD' in run
    assert "git rev-parse HEAD^1" in run
    assert "EVIDENCE_PR_TOUCHED_FILE" in run and "GITHUB_ENV" in run
    assert names.index("Record PR-touched paths for the evidence drift gate") < names.index(
        "Plan current-source evidence capture"
    )
    # The merge-group backstop itself must remain byte-identical: the planner
    # step's command and both capture-skip conditions are pinned above.


def test_required_aggregate_keeps_original_check_name_and_dependencies() -> None:
    aggregate = jobs()["terminal"]
    assert aggregate["name"] == "Terminal typecheck + tests"
    assert aggregate["if"] == "always()"
    assert set(aggregate["needs"]) == {
        "pr_scope", "e2e-scope", "terminal-unit", "terminal-f11-evidence",
        "terminal-typecheck", "terminal-unit-shards", "terminal-e2e",
        "terminal-e2e-build", "terminal-e2e-prodbuild",
    }
    step = aggregate_assertion_step()
    assert step["if"] == "${{ !cancelled() }}"
    assert step["env"] == {
        "SCOPE": chr(36) + "{{ needs.e2e-scope.result }}",
        "PR_SCOPE": "${{ needs.pr_scope.result }}",
        "PR_MODE": "${{ needs.pr_scope.outputs.mode }}",
        "UNIT": "${{ needs.terminal-unit.result }}",
        "F11": "${{ needs.terminal-f11-evidence.result }}",
        "TYPECHECK": "${{ needs.terminal-typecheck.result }}",
        "UNITS": "${{ needs.terminal-unit-shards.result }}",
        "E2E": "${{ needs.terminal-e2e.result }}",
        "BUILD": "${{ needs.terminal-e2e-build.result }}",
        "PRODBUILD": "${{ needs.terminal-e2e-prodbuild.result }}",
        "PRODBUILD_COUNT": "${{ needs.e2e-scope.outputs.prodbuild_count }}",
        "EVENT": "${{ github.event_name }}",
    }
    assert "native merge group" in step["run"]
    assert 'if [ "$SCOPE" != "success" ]; then' in step["run"]


def prod_lane_results(event: str) -> dict[str, str]:
    """Four successful production shards are required on every full run,
    including the native merge group's production-only browser qualification."""
    return {"BUILD": "success", "PRODBUILD": "success", "PRODBUILD_COUNT": "4"}


@pytest.mark.parametrize(
    ("event", "unit", "e2e", "should_pass"),
    [
        ("pull_request", "success", "success", True),
        ("pull_request", "success", "skipped", False),
        ("pull_request", "success", "failure", False),
        ("workflow_dispatch", "success", "skipped", False),
        ("merge_group", "success", "skipped", True),
        ("merge_group", "success", "success", True),
        ("merge_group", "success", "failure", False),
        ("merge_group", "success", "cancelled", False),
        ("merge_group", "skipped", "skipped", False),
        ("merge_group", "failure", "skipped", False),
    ],
)
def test_required_aggregate_refuses_missing_or_failed_event_checks(
    event: str, unit: str, e2e: str, should_pass: bool
) -> None:
    command = aggregate_assertion_step()["run"]
    result = subprocess.run(
        ["bash", "-e", "-c", command],
        env={**os.environ, "EVENT": event, "SCOPE": "success",
             "PR_SCOPE": "success", "PR_MODE": "full",
             "UNIT": unit, "F11": "success", "TYPECHECK": "success", "UNITS": "success",
             "E2E": e2e, **prod_lane_results(event)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert (result.returncode == 0) is should_pass, (
        event, unit, e2e, result.stdout, result.stderr
    )


@pytest.mark.parametrize("lane", ["F11", "TYPECHECK", "UNITS"])
@pytest.mark.parametrize("event", ["pull_request", "merge_group"])
@pytest.mark.parametrize("status", ["skipped", "failure", "cancelled", ""])
def test_required_aggregate_refuses_an_incomplete_split_lane(
    lane: str, event: str, status: str
) -> None:
    """A skipped or failed typecheck/unit-shard lane can never qualify any
    event, including the native merge group; only the trusted docs-only PR
    skip is lawful and that is covered by the docs-mode tests."""
    result = subprocess.run(
        ["bash", "-e", "-c", aggregate_assertion_step()["run"]],
        env={**os.environ, "EVENT": event, "SCOPE": "success",
             "PR_SCOPE": "success", "PR_MODE": "full",
             "UNIT": "success", "F11": "success", "TYPECHECK": "success", "UNITS": "success",
             "E2E": "success" if event == "pull_request" else "skipped",
             lane: status, **prod_lane_results(event)},
        capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0, (lane, event, status, result.stdout)


@pytest.mark.parametrize(("build", "prod", "count"), [
    *((build, prod, "4") for build, prod in (
        ("skipped", "skipped"), ("failure", "skipped"),
        ("cancelled", "skipped"), ("", ""),
        ("timed_out", "skipped"), ("success", "skipped"),
        ("success", "cancelled"), ("success", "failure"),
        ("success", ""),
    )),
    *((status, status, count) for status in ("success", "skipped")
      for count in ("", "0", "3", "4.0", "four", "5", "-1")),
    ("success", "skipped", "unknown"),
    ("failure", "skipped", "0"),
])
def test_merge_group_never_accepts_missing_empty_or_unsuccessful_production(
    build: str, prod: str, count: str,
) -> None:
    result = subprocess.run(
        ["bash", "-e", "-c", aggregate_assertion_step()["run"]],
        env={**os.environ, "EVENT": "merge_group", "SCOPE": "success",
             "PR_SCOPE": "success", "PR_MODE": "full", "UNIT": "success",
             "F11": "success", "TYPECHECK": "success", "UNITS": "success",
             "E2E": "skipped", "BUILD": build, "PRODBUILD": prod,
             "PRODBUILD_COUNT": count},
        capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0, (build, prod, count, result.stdout)


@pytest.mark.parametrize("scope_result", ["skipped", "failure", "cancelled", ""])
@pytest.mark.parametrize(("event", "e2e"), [
    ("pull_request", "success"), ("merge_group", "skipped")
])
def test_unqualified_scope_can_never_pass_event_aggregate(
    scope_result: str, event: str, e2e: str
) -> None:
    command = aggregate_assertion_step()["run"]
    result = subprocess.run(
        ["bash", "-e", "-c", command],
        env={**os.environ, "EVENT": event, "SCOPE": scope_result,
             "PR_SCOPE": "success", "PR_MODE": "full",
             "UNIT": "success", "F11": "success", "TYPECHECK": "success", "UNITS": "success",
             "E2E": e2e, **prod_lane_results(event)},
        capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0, (scope_result, event, result.stdout)
    assert "e2e-scope concluded" in result.stdout


CAPTURE_SHARDS = ["pl6", "vi-desktop", "vi-tablet", "vi-mobile"]
SELECTIVE = "github.event_name != 'merge_group' || steps.evidence_plan.outputs.capture == 'true'"


def test_evidence_capture_fans_out_and_terminal_unit_fans_in() -> None:
    """PL6/legacy and three VI viewport captures run as one matrix on the same
    SHA; terminal-unit downloads exactly those four shards and composes them."""
    capture = jobs()["terminal-evidence-capture"]
    assert capture["strategy"]["fail-fast"] is False
    assert capture["strategy"]["matrix"]["shard"] == CAPTURE_SHARDS
    by_name = {s["name"]: s for s in capture["steps"] if "name" in s}
    assert by_name["Plan current-source evidence capture"]["run"] == "node scripts/ci/plan-evidence-capture.cjs"
    run = by_name["Capture this evidence shard"]
    assert run["run"] == "node e2e/tools/capture_ci_evidence.cjs --shard ${{ matrix.shard }}"
    assert run["if"] == SELECTIVE and not run.get("continue-on-error", False)
    upload = by_name["Retain this shard's bytes and receipt"]
    assert upload["if"] == SELECTIVE
    assert upload["with"]["name"] == "evidence-shard-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}"
    assert upload["with"]["if-no-files-found"] == "error"
    for step in capture["steps"]:
        assert "TERMINAL_EVIDENCE" not in str(step.get("run", "")), "shards never select records"

    steps = jobs()["terminal-unit"]["steps"]
    names = [s.get("name") for s in steps]
    unit = {s["name"]: s for s in steps if "name" in s}
    downloads = [s for s in steps if str(s.get("uses", "")).startswith("actions/download-artifact")]
    assert [d["with"]["name"] for d in downloads] == [
        f"evidence-shard-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}-{shard}" for shard in CAPTURE_SHARDS]
    assert [d["with"]["path"] for d in downloads] == [
        f"${{{{ runner.temp }}}}/terminal-ci-evidence-shards/{shard}" for shard in CAPTURE_SHARDS]
    assert all(d["if"] == SELECTIVE and not d.get("continue-on-error", False) for d in downloads)
    fan = unit["Capture and validate evidence on this checkout"]
    assert fan["run"] == "node e2e/tools/capture_ci_evidence.cjs --fan-in" and fan["if"] == SELECTIVE
    guard = names.index("Require every evidence capture shard")
    first_download = steps.index(downloads[0])
    assert guard < first_download < steps.index(downloads[-1]) < names.index("Capture and validate evidence on this checkout") \
        < names.index("Validate fresh evidence through the unit readers")
    assert "if" not in unit["Require every evidence capture shard"]


@pytest.mark.parametrize("result", ["success", "failure", "cancelled", "skipped", ""])
def test_fan_in_fails_unless_every_capture_shard_succeeded(result: str) -> None:
    step = next(s for s in jobs()["terminal-unit"]["steps"] if s.get("name") == "Require every evidence capture shard")
    assert step["env"] == {"SHARDS": "${{ needs.terminal-evidence-capture.result }}"}
    completed = subprocess.run(["bash", "-e", "-c", step["run"]], env={**os.environ, "SHARDS": result},
                               capture_output=True, text=True, check=False)
    assert (completed.returncode == 0) is (result == "success"), completed.stdout
