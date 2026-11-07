"""Fail-closed scoped responsive CI and required-check retention tests."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
import yaml

from scripts import ci_e2e_scope as scope

ROOT = Path(__file__).resolve().parents[1]
CI = ROOT / ".github" / "workflows" / "ci.yml"
SHA_A, SHA_B, SHA_C = "a" * 40, "b" * 40, "c" * 40
MERGE_REF = "refs/pull/123/merge"


def test_full_and_focused_shard_contracts():
    assert len(scope.FULL_MATRIX) == 12
    assert {x["shard"] for x in scope.FULL_MATRIX} == {
        *(f"desktop-{i}" for i in range(1, 6)),
        *(f"tablet-{i}" for i in range(1, 4)),
        *(f"mobile-{i}" for i in range(1, 4)),
        "serial",
    }
    assert all(item["specs"] == "" for item in scope.FULL_MATRIX)
    assert [x["shard"] for x in scope.FOCUSED_MATRIX] == [
        "screener-desktop", "screener-mobile"
    ]
    for item in scope.FOCUSED_MATRIX:
        assert item["projects"] in ("--project=desktop", "--project=mobile")
        for name in scope.SCREENER_SPECS:
            assert name in item["specs"].split()
            assert (ROOT / "terminal" / name).is_file(), name


@pytest.mark.parametrize("path", sorted(scope.SCOPED_PATHS))
def test_only_reviewed_existing_paths_qualify(path):
    assert (ROOT / path).is_file(), path
    assert scope.classify_paths([path])[0] == "focused"


@pytest.mark.parametrize("path", [
    "AGENTS.md", "CLAUDE.md", "terminal/AGENTS.md",
    ".github/workflows/ci.yml", "scripts/ci_e2e_scope.py",
    "tests/test_ci_e2e_scope.py", "terminal/app/globals.css",
    "terminal/app/layout.tsx", "terminal/lib/screenerScan.ts",
    "terminal/components/screener/SmartScreensPanel.tsx",
    "terminal/components/screener/UNKNOWN.module.css",
    "terminal/e2e/brand-new.spec.ts", "terminal/lib/auth.ts",
    # These real crop-generation specs intentionally test.skip without special
    # CI env; a changed but skipped spec must never qualify as focused-green.
    "terminal/e2e/screener-fundamental-crops.spec.ts",
    "terminal/e2e/screener-cross-market-crops.spec.ts",
    "ingest/gen_fund_us.py", "hub/src/index.ts",
])
def test_unknown_or_high_risk_path_always_runs_full(path):
    assert scope.classify_paths([path])[0] == "full"
    assert scope.classify_paths([next(iter(scope.SCOPED_PATHS)), path])[0] == "full"


def test_empty_duplicate_and_large_change_sets_fail_closed():
    assert scope.classify_paths([])[0] == "full"
    one = next(iter(scope.SCOPED_PATHS))
    assert scope.classify_paths([one, one])[0] == "full"
    assert scope.classify_paths([one] * 21)[0] == "full"


@pytest.mark.parametrize("event", [
    "", "merge_group", "workflow_dispatch", "push", "schedule", "pull_request_target"
])
def test_every_non_pr_event_is_full_without_git(monkeypatch, event):
    monkeypatch.setattr(scope, "git", lambda *args: 1 / 0)
    assert scope.select(event, MERGE_REF, SHA_A, SHA_C)[0] == "full"


@pytest.mark.parametrize("ref,sha,head", [
    ("refs/heads/master", SHA_A, SHA_C), ("refs/pull/123/head", SHA_A, SHA_C),
    ("refs/pull/0/merge", SHA_A, SHA_C), (MERGE_REF, "", SHA_C),
    (MERGE_REF, SHA_A, ""), (MERGE_REF, "bad-sha", SHA_C),
])
def test_untrusted_checkout_identity_is_full(ref, sha, head):
    assert scope.select("pull_request", ref, sha, head)[0] == "full"


@pytest.mark.parametrize("parents", [
    f"{SHA_A} {SHA_B}\n", f"{SHA_A} {SHA_B} {SHA_B}\n",
    f"{SHA_B} {SHA_B} {SHA_C}\n", f"{SHA_A} {SHA_B} {SHA_C} {SHA_B}\n",
])
def test_unexpected_pr_parents_are_full(monkeypatch, parents):
    monkeypatch.setattr(scope, "git", lambda *args: parents.encode())
    assert scope.select("pull_request", MERGE_REF, SHA_A, SHA_C)[0] == "full"


def test_exact_pr_merge_diff_enables_focused_and_tracks_renames(monkeypatch):
    commands = []
    def git(*args):
        commands.append(args)
        if args[0] == "rev-list":
            return f"{SHA_A} {SHA_B} {SHA_C}\n".encode()
        return b"M\0terminal/e2e/screener-cross-market.spec.ts\0"
    monkeypatch.setattr(scope, "git", git)
    assert scope.select("pull_request", MERGE_REF, SHA_A, SHA_C)[0] == "focused"
    assert "--no-renames" in commands[1] and "-z" in commands[1]
    assert "--name-status" in commands[1] and "--name-only" not in commands[1]
    assert commands[1][-1] == "--"
    assert f"{SHA_B}^{{tree}}" in commands[1]
    assert f"{SHA_A}^{{tree}}" in commands[1]


@pytest.mark.parametrize("diff", [
    b"", b"bad-unterminated", b"\xff\0",
    b"terminal/app/layout.tsx\0terminal/e2e/screener-cross-market-crops.spec.ts\0",
])
def test_invalid_git_diff_and_unsafe_rename_are_full(monkeypatch, diff):
    monkeypatch.setattr(scope, "git", lambda *args:
        f"{SHA_A} {SHA_B} {SHA_C}\n".encode() if args[0] == "rev-list" else diff)
    assert scope.select("pull_request", MERGE_REF, SHA_A, SHA_C)[0] == "full"


def test_git_observation_error_is_full(monkeypatch):
    def broken(*args):
        raise subprocess.CalledProcessError(128, ["git"])
    monkeypatch.setattr(scope, "git", broken)
    assert scope.select("pull_request", MERGE_REF, SHA_A, SHA_C)[0] == "full"


def test_dynamic_matrix_output_can_be_parsed(monkeypatch, tmp_path):
    output = tmp_path / "output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("GITHUB_EVENT_NAME", "merge_group")
    scope.main()
    fields = dict(line.split("=", 1) for line in output.read_text().splitlines())
    assert fields["mode"] == "full"
    assert json.loads(fields["matrix"]) == {"include": scope.FULL_MATRIX}


def test_required_check_never_launders_skipped_or_failed_scope():
    jobs = yaml.safe_load(CI.read_text())["jobs"]
    aggregate = jobs["terminal"]
    assert aggregate["name"] == "Terminal typecheck + tests"
    assert aggregate["if"] == "always()"
    assert set(aggregate["needs"]) == {"pr_scope", "e2e-scope", "terminal-unit", "terminal-e2e"}
    run = next(step["run"] for step in aggregate["steps"]
               if step["name"] == "Assert all event-required Terminal checks passed")
    for dep in ["e2e-scope:$SCOPE", "terminal-unit:$UNIT", "terminal-e2e:$E2E"]:
        assert dep in run
    assert '[ "$fail" -eq 0 ] || exit 1' in run
    assert jobs["terminal-unit"]["needs"] == ["pr_scope", "e2e-scope"]
    assert jobs["terminal-e2e"]["needs"] == ["pr_scope", "e2e-scope"]
    # Full audited PR matrix or safe focused subset; native merge_group must
    # not duplicate the separately proven browser work.
    docs = ("github.event_name == 'pull_request' && "
            "needs.pr_scope.result == 'success' && needs.pr_scope.outputs.mode == 'docs'")
    assert jobs["terminal-unit"]["if"] == (
        "${{ !cancelled() && needs.e2e-scope.result == 'success' && !(" + docs + ") }}"
    )
    assert jobs["terminal-e2e"]["if"] == (
        "${{ !cancelled() && needs.e2e-scope.result == 'success' && "
        "github.event_name != 'merge_group' && !(" + docs + ") }}"
    )
    assert jobs["terminal-e2e"]["strategy"]["fail-fast"] is False
    assert jobs["terminal-e2e"]["strategy"]["matrix"] == (
        "${{ fromJSON(needs.e2e-scope.outputs.matrix) }}"
    )
    assert jobs["e2e-scope"]["steps"][0]["with"]["fetch-depth"] == 2
    assert "ci_e2e_scope.py" in jobs["e2e-scope"]["steps"][-1]["run"]
    for step in jobs["terminal-unit"]["steps"]:
        if step.get("name") in ("Prepare Chromium for original mock captures",
                                "Capture and validate evidence on this checkout"):
            assert step["if"] == (
                "github.event_name != 'merge_group' || "
                "steps.evidence_plan.outputs.capture == 'true'"
            )
    command = next(step["run"] for step in jobs["terminal-e2e"]["steps"]
                   if "test:e2e:responsive" in step.get("run", ""))
    assert "${{ matrix.projects }}" in command
    assert "${{ matrix.specs }}" in command


def test_protected_default_branch_has_nightly_full_matrix():
    # PyYAML 1.1 interprets the GitHub key "on" as True.
    config = yaml.safe_load(CI.read_text())
    triggers = config.get("on", config.get(True))
    assert triggers["schedule"] == [{"cron": "17 9 * * *"}]
    assert scope.select("schedule", "refs/heads/master", SHA_A, "")[0] == "full"


def test_real_synthetic_pr_merge_uses_exact_parent_and_source_diff(tmp_path, monkeypatch):
    # Exercise real git, not only the mocked selector arguments. No network.
    repo = tmp_path / "repository"
    repo.mkdir()

    def call(*args):
        return subprocess.check_output(
            ["git", "-C", str(repo), *args], stderr=subprocess.PIPE
        ).decode().strip()

    call("init", "-b", "master")
    call("config", "user.name", "Scoped CI Test")
    call("config", "user.email", "scoped-ci-test@example.invalid")
    local = repo / "terminal" / "components" / "screener"
    local.mkdir(parents=True)
    css = local / "CrossMarketStrip.module.css"
    css.write_text(".a { color: black; }\n")
    (repo / "README.md").write_text("source\n")
    call("add", ".")
    call("commit", "-m", "base")
    call("checkout", "-b", "local-ui")
    css.write_text(".a { color: white; }\n")
    call("add", ".")
    call("commit", "-m", "local CSS")
    head_sha = call("rev-parse", "HEAD")
    call("checkout", "master")
    call("merge", "--no-ff", "--no-edit", "local-ui")
    merge_sha = call("rev-parse", "HEAD")
    monkeypatch.chdir(repo)
    assert scope.select("pull_request", MERGE_REF, merge_sha, head_sha) == (
        "focused", "reviewed_screener_presentation_or_tests"
    )
    assert scope.select("merge_group", MERGE_REF, merge_sha, head_sha)[0] == "full"


def _run_workflow_selector_in_git_checkout(tmp_path, *, install_base_selector,
                                           tamper_with_selector=False, delete_css=False):
    """Run actual GitHub Actions shell after a synthetic two-parent PR merge."""
    import os

    repo = tmp_path / "checkout"
    repo.mkdir()

    def git(*args):
        return subprocess.check_output(
            ["git", "-C", str(repo), *args], stderr=subprocess.PIPE
        ).decode().strip()

    git("init", "-b", "master")
    git("config", "user.name", "CI Scope Integration")
    git("config", "user.email", "ci-scope@example.invalid")
    css = repo / "terminal" / "components" / "screener" / "CrossMarketStrip.module.css"
    css.parent.mkdir(parents=True)
    css.write_text(".x { padding: 1px; }\n")
    (repo / "README.md").write_text("root\n")
    if install_base_selector:
        script = repo / "scripts" / "ci_e2e_scope.py"
        script.parent.mkdir(parents=True)
        script.write_bytes((ROOT / "scripts" / "ci_e2e_scope.py").read_bytes())
    git("add", ".")
    git("commit", "-m", "protected master")
    git("checkout", "-b", "scoped-pr")
    if delete_css:
        css.unlink()
    else:
        css.write_text(".x { padding: 2px; }\n")
    if tamper_with_selector:
        assert install_base_selector
        # Candidate script deliberately lies; immutable protected script must
        # run instead and see the candidate's script change as a FULL trigger.
        script.write_text("raise RuntimeError('PR script must not execute')\n")
    git("add", ".")
    git("commit", "-m", "candidate")
    candidate_sha = git("rev-parse", "HEAD")
    git("checkout", "master")
    git("merge", "--no-ff", "--no-edit", "scoped-pr")
    merge_sha = git("rev-parse", "HEAD")
    workflow = yaml.safe_load(CI.read_text())
    shell = workflow["jobs"]["e2e-scope"]["steps"][-1]["run"]
    assert "git show" in shell and 'HEAD^1' in shell
    output = tmp_path / "action-output"
    output.touch()
    env = {
        **os.environ,
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_SHA": merge_sha,
        "GITHUB_REF": MERGE_REF,
        "PR_HEAD_SHA": candidate_sha,
        "GITHUB_OUTPUT": str(output),
        "RUNNER_TEMP": str(tmp_path),
    }
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", shell],
        cwd=repo, env=env, text=True, capture_output=True, timeout=20,
    )
    assert result.returncode == 0, (result.stdout, result.stderr)
    fields = dict(line.split("=", 1) for line in output.read_text().splitlines())
    return fields["mode"], json.loads(fields["matrix"])["include"], result.stdout


def test_real_workflow_bootstrap_cannot_use_new_unprotected_selector(tmp_path):
    mode, matrix, stdout = _run_workflow_selector_in_git_checkout(
        tmp_path, install_base_selector=False
    )
    assert mode == "full"
    assert matrix == scope.FULL_MATRIX
    assert "immutable protected selector unavailable" in stdout


def test_real_workflow_uses_protected_selector_for_scoped_css(tmp_path):
    mode, matrix, stdout = _run_workflow_selector_in_git_checkout(
        tmp_path, install_base_selector=True
    )
    assert mode == "focused"
    assert matrix == scope.FOCUSED_MATRIX
    assert "reviewed_screener_presentation_or_tests" in stdout


def test_real_workflow_rejects_candidate_selector_tampering(tmp_path):
    mode, matrix, stdout = _run_workflow_selector_in_git_checkout(
        tmp_path, install_base_selector=True, tamper_with_selector=True
    )
    assert mode == "full"
    assert matrix == scope.FULL_MATRIX
    assert "unknown_or_elevated_path" in stdout


def test_real_workflow_merge_group_always_bootstraps_full(tmp_path, monkeypatch):
    import os

    shell = yaml.safe_load(CI.read_text())["jobs"]["e2e-scope"]["steps"][-1]["run"]
    output = tmp_path / "action-output"
    output.touch()
    monkeypatch.setenv("GITHUB_EVENT_NAME", "merge_group")
    monkeypatch.setenv("GITHUB_SHA", SHA_A)
    monkeypatch.setenv("PR_HEAD_SHA", SHA_C)
    monkeypatch.setenv("GITHUB_REF", "refs/heads/gh-readonly-queue/master/pr-123")
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("RUNNER_TEMP", str(tmp_path))
    result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", shell],
                            cwd=ROOT, env=os.environ.copy(), capture_output=True,
                            text=True, timeout=20)
    assert result.returncode == 0, (result.stdout, result.stderr)
    fields = dict(line.split("=", 1) for line in output.read_text().splitlines())
    assert fields["mode"] == "full"
    assert json.loads(fields["matrix"]) == {"include": scope.FULL_MATRIX}


@pytest.mark.parametrize("status", ["A", "D", "T", "R100", "M100"])
def test_allowlisted_path_with_nonmodification_status_stays_full(monkeypatch, status):
    def fake_git(*args):
        if args[0] == "rev-list":
            return f"{SHA_A} {SHA_B} {SHA_C}\n".encode()
        return status.encode("ascii") + b"\0terminal/e2e/screener-cross-market.spec.ts\0"
    monkeypatch.setattr(scope, "git", fake_git)
    assert scope.select("pull_request", MERGE_REF, SHA_A, SHA_C) == (
        "full", "non_modification_change"
    )


def test_deleted_allowlisted_css_really_runs_full_through_workflow(tmp_path):
    mode, matrix, stdout = _run_workflow_selector_in_git_checkout(
        tmp_path, install_base_selector=True, delete_css=True,
    )
    assert mode == "full"
    assert matrix == scope.FULL_MATRIX
    assert "non_modification_change" in stdout



def test_ci_workflow_has_no_duplicate_yaml_mapping_keys():
    # Git's textual merge can leave two needs/if/SCOPE keys without a conflict
    # marker. PyYAML normally keeps only the last value, masking lost gates.
    def check(node, path="workflow"):
        if isinstance(node, yaml.MappingNode):
            keys = [key.value for key, _ in node.value]
            assert len(keys) == len(set(keys)), (path, keys)
            for key, value in node.value:
                check(value, f"{path}.{key.value}")
        elif isinstance(node, yaml.SequenceNode):
            for index, value in enumerate(node.value):
                check(value, f"{path}[{index}]")

    check(yaml.compose(CI.read_text(), Loader=yaml.BaseLoader))


def _execute_required_aggregate(**overrides):
    import os

    job = yaml.safe_load(CI.read_text())["jobs"]["terminal"]
    step = next(step for step in job["steps"]
                if step["name"] == "Assert all event-required Terminal checks passed")
    assert step["if"] == "${{ !cancelled() }}"
    env = {
        **os.environ,
        "EVENT": "pull_request", "PR_SCOPE": "success", "PR_MODE": "full",
        "SCOPE": "success", "UNIT": "success", "E2E": "success", **overrides,
    }
    return subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", step["run"]],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=10,
    )


@pytest.mark.parametrize("unit,e2e", [
    ("success", "success"), ("success", "skipped"),
    ("skipped", "success"), ("skipped", "skipped"),
])
def test_qualified_docs_pr_can_skip_each_test_job(unit, e2e):
    result = _execute_required_aggregate(PR_MODE="docs", UNIT=unit, E2E=e2e)
    assert result.returncode == 0, result.stdout


@pytest.mark.parametrize("pr_scope,mode", [
    ("failure", "docs"), ("skipped", "docs"), ("cancelled", "docs"),
    ("", "docs"), ("success", ""), ("success", "invalid"),
    ("success", "DOCS"), ("failure", ""),
])
def test_unqualified_pr_scope_permits_successful_normal_testing(pr_scope, mode):
    result = _execute_required_aggregate(PR_SCOPE=pr_scope, PR_MODE=mode)
    assert result.returncode == 0, result.stdout


@pytest.mark.parametrize("pr_scope,mode", [
    ("failure", "docs"), ("skipped", "docs"), ("cancelled", "docs"),
    ("", "docs"), ("success", ""), ("success", "invalid"),
    ("success", "DOCS"),
])
@pytest.mark.parametrize("job", ["UNIT", "E2E"])
def test_unqualified_pr_scope_cannot_authorize_a_skipped_job(pr_scope, mode, job):
    result = _execute_required_aggregate(PR_SCOPE=pr_scope, PR_MODE=mode, **{job: "skipped"})
    assert result.returncode != 0, result.stdout


@pytest.mark.parametrize("status", ["failure", "cancelled", "skipped", "", "unknown"])
def test_docs_qualification_cannot_replace_the_browser_selector(status):
    result = _execute_required_aggregate(
        PR_MODE="docs", SCOPE=status, UNIT="skipped", E2E="skipped",
    )
    assert result.returncode != 0, result.stdout


@pytest.mark.parametrize("status", ["failure", "cancelled", "", "unknown"])
@pytest.mark.parametrize("job", ["UNIT", "E2E"])
def test_docs_qualification_never_excuses_a_failed_or_cancelled_test(status, job):
    values = {"UNIT": "skipped", "E2E": "skipped", job: status}
    result = _execute_required_aggregate(PR_MODE="docs", **values)
    assert result.returncode != 0, result.stdout


def test_native_merge_group_keeps_only_its_accepted_browser_skip():
    result = _execute_required_aggregate(
        EVENT="merge_group", PR_SCOPE="skipped", PR_MODE="", E2E="skipped",
    )
    assert result.returncode == 0, result.stdout
    result = _execute_required_aggregate(
        EVENT="merge_group", PR_MODE="docs", UNIT="skipped", E2E="skipped",
    )
    assert result.returncode != 0, result.stdout


@pytest.mark.parametrize("event", ["workflow_dispatch", "schedule", "push"])
def test_other_events_cannot_inherit_a_docs_pr_exemption(event):
    result = _execute_required_aggregate(EVENT=event, PR_MODE="docs")
    assert result.returncode == 0, result.stdout
    result = _execute_required_aggregate(
        EVENT=event, PR_MODE="docs", UNIT="skipped", E2E="skipped",
    )
    assert result.returncode != 0, result.stdout


def test_cancelled_workflow_has_an_explicit_failing_aggregate_step():
    # always() permits the aggregate to start after cancellation. It must
    # reject cancellation rather than interpret cancellation skips as docs.
    job = yaml.safe_load(CI.read_text())["jobs"]["terminal"]
    assert job["if"] == "always()"
    step = job["steps"][0]
    assert step["name"] == "Refuse cancelled qualification"
    assert step["if"] == "cancelled()"
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", step["run"]],
        cwd=ROOT, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode != 0
    assert "cancellation" in result.stdout
