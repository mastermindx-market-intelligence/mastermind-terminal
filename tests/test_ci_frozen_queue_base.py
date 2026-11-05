"""Run the actual CI shell step against a local git remote and a moving master."""
import os
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def workflow_step():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    return next(step for step in workflow["jobs"]["terminal-unit"]["steps"]
                if step.get("name") == "Plain-language guard (forward-only, added lines block)")


def git(cwd, *args):
    return subprocess.check_output(["git", *args], cwd=cwd, text=True,
                                   stderr=subprocess.DEVNULL).strip()


@pytest.fixture
def graph(tmp_path):
    remote = tmp_path / "origin.git"
    git(tmp_path, "init", "--bare", str(remote))
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-b", "master")
    git(repo, "config", "user.name", "Fixture")
    git(repo, "config", "user.email", "fixture@example.invalid")
    git(repo, "remote", "add", "origin", str(remote))
    component = repo / "terminal/components/Example.tsx"
    component.parent.mkdir(parents=True)
    component.write_text('export const oldLabel = "BOTTOM_WATCH";\n')
    git(repo, "add", ".")
    git(repo, "commit", "-m", "frozen base with legacy label")
    base = git(repo, "rev-parse", "HEAD")
    component.write_text('export const oldLabel = "Watching for a bottom";\n')
    git(repo, "commit", "-am", "later master fixes legacy label")
    git(repo, "push", "origin", "master")
    git(repo, "checkout", "-b", "queue-candidate", base)
    with component.open("a") as out:
        out.write('export const newLabel = "New label";\n')
    git(repo, "commit", "-am", "candidate adds safe label")
    head = git(repo, "rev-parse", "HEAD")
    shim = tmp_path / "bin"
    shim.mkdir()
    node = shim / "node"
    node.write_text('#!/bin/sh\ncp "$RUNNER_TEMP/plain-language.diff" "$RESULT"\n')
    node.chmod(0o700)
    result = tmp_path / "node-diff"
    env = dict(os.environ, PATH=str(shim) + os.pathsep + os.environ["PATH"],
               BASE_REF="master", GITHUB_EVENT_NAME="merge_group", GITHUB_SHA=head,
               GITHUB_REF="refs/heads/gh-readonly-queue/master/pr-987-fixture",
               MERGE_GROUP_BASE_REF="refs/heads/master", MERGE_GROUP_BASE_SHA=base,
               MERGE_GROUP_HEAD_SHA=head,
               MERGE_GROUP_HEAD_REF="refs/heads/gh-readonly-queue/master/pr-987-fixture",
               RUNNER_TEMP=str(tmp_path), RESULT=str(result))
    return repo, env, result, base, head


def execute(graph, changes=None):
    repo, env, result, _, _ = graph
    env = dict(env, **(changes or {}))
    run = subprocess.run(["bash", "-c", workflow_step()["run"]],
                         cwd=repo / "terminal", env=env, text=True, capture_output=True)
    return run, result.read_text() if result.exists() else None


def test_queue_diff_uses_frozen_base_even_after_master_moves(graph):
    run, diff = execute(graph)
    assert run.returncode == 0, run.stderr
    assert '+export const newLabel = "New label";' in diff
    assert '+export const oldLabel = "BOTTOM_WATCH";' not in diff


def test_pull_request_still_uses_first_parent(graph):
    run, diff = execute(graph, {"GITHUB_EVENT_NAME": "pull_request"})
    assert run.returncode == 0, run.stderr
    assert '+export const oldLabel = "BOTTOM_WATCH";' not in diff


def test_dispatch_keeps_explicit_master_comparison(graph):
    run, diff = execute(graph, {"GITHUB_EVENT_NAME": "workflow_dispatch"})
    assert run.returncode == 0, run.stderr
    assert '+export const oldLabel = "BOTTOM_WATCH";' in diff


@pytest.mark.parametrize("changes", [
    {"MERGE_GROUP_BASE_SHA": ""},
    {"MERGE_GROUP_BASE_SHA": "$(touch injected)"},
    {"MERGE_GROUP_BASE_SHA": "f" * 40},
    {"MERGE_GROUP_HEAD_SHA": "a" * 40},
    {"GITHUB_SHA": "a" * 40},
    {"MERGE_GROUP_BASE_REF": "refs/heads/other"},
    {"MERGE_GROUP_HEAD_REF": "refs/heads/other"},
    {"GITHUB_REF": "refs/heads/other"},
    {"MERGE_GROUP_HEAD_REF": "", "GITHUB_REF": ""},
])
def test_bad_queue_identity_fails_before_guard(graph, changes):
    run, diff = execute(graph, changes)
    assert run.returncode != 0
    assert diff is None
    assert not (graph[0] / "terminal/injected").exists()


def test_workflow_supplies_event_fields_without_shell_interpolation():
    step = workflow_step()
    for key, field in [("BASE_SHA", "base_sha"), ("HEAD_SHA", "head_sha"),
                       ("BASE_REF", "base_ref"), ("HEAD_REF", "head_ref")]:
        assert step["env"]["MERGE_GROUP_" + key] == "${{ github.event.merge_group." + field + " }}"
    assert "${{" not in step["run"]
