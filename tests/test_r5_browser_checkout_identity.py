"""Qualify the exporter against real merge graphs, including a shallow clone."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXPORTER = Path("terminal/e2e/tools/qualify_r5_alignment_browser.py")
REPOSITORY = "mastermindx-market-intelligence/mastermind-terminal"
GIT_ENV = dict(os.environ, GIT_AUTHOR_NAME="fixture", GIT_AUTHOR_EMAIL="fixture@example.test",
               GIT_COMMITTER_NAME="fixture", GIT_COMMITTER_EMAIL="fixture@example.test",
               GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_TERMINAL_PROMPT="0")


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], env=GIT_ENV, text=True).strip()


def graph_at(repo: Path, advances: int = 3) -> dict:
    repo.mkdir()
    git(repo, "init", "-q", "-b", "master")
    script = repo / EXPORTER
    script.parent.mkdir(parents=True)
    script.write_bytes((ROOT / EXPORTER).read_bytes())
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "event base")
    event_base = git(repo, "rev-parse", "HEAD")
    git(repo, "branch", "feature")
    for number in range(advances):
        (repo / "protected.txt").write_text(str(number))
        git(repo, "add", "protected.txt")
        git(repo, "commit", "-q", "-m", "protected advance " + str(number))
    actual_base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "feature")
    (repo / "feature.txt").write_text("owned source")
    git(repo, "add", "feature.txt")
    git(repo, "commit", "-q", "-m", "owned head")
    head = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "master")
    git(repo, "merge", "-q", "--no-ff", "--no-edit", "feature")
    return {"repo": repo, "event_base": event_base, "base": actual_base, "head": head,
            "merge": git(repo, "rev-parse", "HEAD"), "tree": git(repo, "rev-parse", "HEAD^{tree}")}


@pytest.fixture
def graph(tmp_path: Path) -> dict:
    return graph_at(tmp_path / "origin")


def configure(monkeypatch, tmp_path: Path, graph: dict, repo: Path | None = None):
    repo = repo or graph["repo"]
    event = {"number": 646, "pull_request": {"number": 646,
        "head": {"sha": graph["head"], "repo": {"full_name": REPOSITORY}},
        "base": {"sha": graph["event_base"], "ref": "master", "repo": {"full_name": REPOSITORY}}}}
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(event))
    for key, value in {
        "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "pull_request", "GITHUB_JOB": "terminal-e2e",
        "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_EVENT_PATH": str(event_path),
        "GITHUB_SHA": git(repo, "rev-parse", "HEAD"), "GITHUB_REF": "refs/pull/646/merge",
        "GITHUB_RUN_ID": "42851905002", "GITHUB_RUN_ATTEMPT": "1",
    }.items():
        monkeypatch.setenv(key, value)
    spec = importlib.util.spec_from_file_location("r5_exporter_fixture", repo / EXPORTER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, event, event_path


def spy_fetch(monkeypatch, module, failure=None):
    calls = []
    original = subprocess.run

    def run(command, *args, **kwargs):
        if len(command) > 3 and command[:1] == ["git"] and command[3] == "fetch":
            calls.append((list(command), dict(kwargs)))
            if failure == "timeout":
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            if failure == "error":
                return subprocess.CompletedProcess(command, 128, "", "fixture unavailable")
        return original(command, *args, **kwargs)

    monkeypatch.setattr(module.subprocess, "run", run)
    return calls


def shallow_clone(tmp_path: Path, graph: dict) -> Path:
    clone = tmp_path / "shallow"
    subprocess.run(["git", "clone", "-q", "--depth=1", "--no-tags", graph["repo"].as_uri(), str(clone)],
                   env=GIT_ENV, check=True, capture_output=True, text=True)
    assert git(clone, "rev-parse", "--is-shallow-repository") == "true"
    return clone


def checkout_state(repo: Path):
    fetch_head = repo / ".git/FETCH_HEAD"
    return (git(repo, "rev-parse", "HEAD"), git(repo, "rev-parse", "HEAD^{tree}"),
            git(repo, "cat-file", "-p", "HEAD"), git(repo, "status", "--porcelain=v1"),
            git(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
            fetch_head.read_bytes() if fetch_head.exists() else None)


def test_exact_event_base_needs_no_fetch(monkeypatch, tmp_path, graph):
    graph["event_base"] = graph["base"]
    module, _, _ = configure(monkeypatch, tmp_path, graph)
    calls = spy_fetch(monkeypatch, module)
    result = module.checkout_identity()
    assert result["protectedMaster"] == result["observedEventBase"] == graph["base"]
    assert result["baseRelationship"] == {"state": "EXACT_EVENT_BASE", "fetchAttempted": False}
    assert not calls and not module.PROOF.exists()


def test_stale_ancestor_in_full_checkout(monkeypatch, tmp_path, graph):
    module, _, _ = configure(monkeypatch, tmp_path, graph)
    calls = spy_fetch(monkeypatch, module)
    result = module.checkout_identity()
    assert result["observedEventBase"] == graph["event_base"]
    assert result["protectedMaster"] == result["integratedDependency"] == graph["base"]
    assert result["observedEventHead"] == result["branchHead"] == graph["head"]
    assert result["checkoutCommit"] == graph["merge"] and result["checkoutTree"] == graph["tree"]
    assert result["checkoutParents"] == [graph["base"], graph["head"]]
    assert result["baseRelationship"]["state"] == "EVENT_BASE_ANCESTOR"
    assert result["baseRelationship"]["ancestryExit"] == 0
    assert not calls and not module.PROOF.exists()


def test_shallow_stale_ancestor_fetches_only_exact_base_once(monkeypatch, tmp_path, graph):
    clone = shallow_clone(tmp_path, graph)
    module, _, _ = configure(monkeypatch, tmp_path, graph, clone)
    before = checkout_state(clone)
    calls = spy_fetch(monkeypatch, module)
    result = module.checkout_identity()
    assert checkout_state(clone) == before
    assert result["protectedMaster"] == graph["base"]
    assert result["observedEventBase"] == graph["event_base"]
    assert result["baseRelationship"]["fetchAttempted"] is True
    assert result["baseRelationship"]["ancestryExit"] == 0
    assert len(calls) == 1
    assert calls[0][0] == ["git", "-C", str(clone), "fetch", "--no-tags", "--no-write-fetch-head",
                           "--no-recurse-submodules", "--no-auto-maintenance", "--refmap=", "--depth=64",
                           "origin", graph["base"]]
    assert calls[0][1]["timeout"] == 60
    assert not module.PROOF.exists()


@pytest.mark.parametrize("key,value", [
    ("GITHUB_ACTIONS", "false"), ("GITHUB_EVENT_NAME", "push"), ("GITHUB_JOB", "another-job"),
    ("GITHUB_REPOSITORY", "another/repository"), ("GITHUB_SHA", "0" * 40),
    ("GITHUB_REF", "refs/heads/master"), ("GITHUB_REF", "refs/pull/647/merge"),
    ("GITHUB_REF", "refs/pull/646/head"),
])
def test_wrong_workflow_identity_rejected_before_fetch(monkeypatch, tmp_path, graph, key, value):
    clone = shallow_clone(tmp_path, graph)
    module, _, _ = configure(monkeypatch, tmp_path, graph, clone)
    calls = spy_fetch(monkeypatch, module)
    monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError):
        module.checkout_identity()
    assert not calls and not module.PROOF.exists()


@pytest.mark.parametrize("change", ["event_number", "pr_number", "head_repo", "base_repo", "base_ref", "head", "bad_sha"])
def test_wrong_event_identity_rejected_before_fetch(monkeypatch, tmp_path, graph, change):
    clone = shallow_clone(tmp_path, graph)
    module, event, event_path = configure(monkeypatch, tmp_path, graph, clone)
    calls = spy_fetch(monkeypatch, module)
    pr = event["pull_request"]
    if change == "event_number": event["number"] = 647
    elif change == "pr_number": pr["number"] = 647
    elif change == "head_repo": pr["head"]["repo"]["full_name"] = "fork/repository"
    elif change == "base_repo": pr["base"]["repo"]["full_name"] = "another/repository"
    elif change == "base_ref": pr["base"]["ref"] = "release"
    elif change == "head": pr["head"]["sha"] = graph["base"]
    else: pr["base"]["sha"] = "not-a-commit"
    event_path.write_text(json.dumps(event))
    with pytest.raises(RuntimeError):
        module.checkout_identity()
    assert not calls and not module.PROOF.exists()


@pytest.mark.parametrize("kind", ["unrelated", "newer", "missing"])
def test_unproven_or_reversed_ancestry_is_rejected(monkeypatch, tmp_path, graph, kind, capsys):
    if kind == "unrelated":
        graph["event_base"] = git(graph["repo"], "commit-tree", graph["tree"], "-p", graph["event_base"], "-m", "cousin")
    elif kind == "newer": graph["event_base"] = graph["merge"]
    else: graph["event_base"] = "0" * 40
    module, _, _ = configure(monkeypatch, tmp_path, graph)
    calls = spy_fetch(monkeypatch, module)
    with pytest.raises(RuntimeError, match="ancestry is unproven"):
        module.checkout_identity()
    diagnostic = json.loads(capsys.readouterr().out)
    assert diagnostic["state"] == "CHECKOUT_BASE_ANCESTRY_REJECTED"
    assert diagnostic["checkoutCommit"] == graph["merge"]
    assert diagnostic["observedEventBase"] == graph["event_base"]
    assert diagnostic["baseRelationship"]["fetchAttempted"] is False
    assert not calls and not module.PROOF.exists()


@pytest.mark.parametrize("failure", ["error", "timeout"])
def test_unavailable_shallow_history_fails_without_retry(monkeypatch, tmp_path, graph, failure, capsys):
    clone = shallow_clone(tmp_path, graph)
    module, _, _ = configure(monkeypatch, tmp_path, graph, clone)
    calls = spy_fetch(monkeypatch, module, failure)
    with pytest.raises((RuntimeError, subprocess.TimeoutExpired)):
        module.checkout_identity()
    assert len(calls) == 1 and not module.PROOF.exists()
    diagnostic = json.loads(capsys.readouterr().out)
    assert diagnostic["baseRelationship"]["fetchAttempted"] is True
    assert diagnostic["baseRelationship"]["state"] == "UNPROVEN"


def test_history_beyond_fetch_bound_stays_unqualified(monkeypatch, tmp_path):
    graph = graph_at(tmp_path / "origin", advances=70)
    clone = shallow_clone(tmp_path, graph)
    module, _, _ = configure(monkeypatch, tmp_path, graph, clone)
    calls = spy_fetch(monkeypatch, module)
    with pytest.raises(RuntimeError, match="not a proven ancestor"):
        module.checkout_identity()
    assert len(calls) == 1 and not module.PROOF.exists()


@pytest.mark.parametrize("parent_count", [1, 3])
def test_non_two_parent_checkout_is_rejected(monkeypatch, tmp_path, graph, parent_count):
    parents = [graph["base"]]
    if parent_count == 3:
        cousin = git(graph["repo"], "commit-tree", graph["tree"], "-p", graph["event_base"], "-m", "third parent")
        parents.extend([graph["head"], cousin])
    args = [part for parent in parents for part in ["-p", parent]]
    commit = git(graph["repo"], "commit-tree", graph["tree"], *args, "-m", "invalid merge shape")
    git(graph["repo"], "checkout", "-q", "--detach", commit)
    module, _, _ = configure(monkeypatch, tmp_path, graph)
    calls = spy_fetch(monkeypatch, module)
    with pytest.raises(RuntimeError, match="declared PR merge"):
        module.checkout_identity()
    assert not calls and not module.PROOF.exists()


def test_parent_like_commit_message_is_not_a_parent(monkeypatch, tmp_path, graph):
    commit = git(graph["repo"], "commit-tree", graph["tree"], "-p", graph["base"], "-p", graph["head"],
                 "-m", "merge message\n\nparent " + "f" * 40)
    git(graph["repo"], "checkout", "-q", "--detach", commit)
    graph["event_base"] = graph["base"]
    module, _, _ = configure(monkeypatch, tmp_path, graph)
    assert module.checkout_identity()["checkoutParents"] == [graph["base"], graph["head"]]


def test_checkout_movement_during_fetch_is_rejected(monkeypatch, tmp_path, graph):
    clone = shallow_clone(tmp_path, graph)
    module, _, _ = configure(monkeypatch, tmp_path, graph, clone)
    original = module.qualify_base_ancestry

    def moved(*args):
        result = original(*args)
        git(clone, "checkout", "-q", "--detach", graph["base"])
        return result

    monkeypatch.setattr(module, "qualify_base_ancestry", moved)
    with pytest.raises(RuntimeError, match="checkout changed"):
        module.checkout_identity()
    assert not module.PROOF.exists()
