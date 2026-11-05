"""scripts/ci_pr_scope.py decides ``docs`` only for an exactly qualified
prose-only pull-request merge commit; everything else is ``full``."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import ci_pr_scope  # noqa: E402


def _git(repo: Path, *args: str) -> str:
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t",
               GIT_COMMITTER_EMAIL="t@x", GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                          text=True, env=env).stdout.strip()


def _write(repo: Path, rel: str, text: str = "x\n") -> None:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _write(repo, "README.md", "# t\n")
    _write(repo, "docs/guide.md", "guide\n")
    _write(repo, "docs/evidence/shot.png", "png\n")
    _write(repo, "terminal/lib/a.ts", "export const a = 1;\n")
    _write(repo, "terminal/docs/note.md", "note\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    return repo


def _pr_merge(repo: Path, mutate) -> str:
    """Apply ``mutate`` on a branch and merge it like refs/pull/N/merge; return base sha."""
    base = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "-b", "topic")
    mutate(repo)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "topic")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--no-ff", "--no-edit", "topic")
    return base


def test_prose_only_change_is_docs(repo: Path) -> None:
    def mutate(r: Path) -> None:
        _write(r, "docs/guide.md", "changed\n")
        _write(r, "docs/evidence/new.json", "{}\n")
        _write(r, "terminal/docs/note.md", "changed\n")
        _write(r, "HANDOFF.md", "handoff\n")
        (r / "README.md").unlink()
    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base)
    assert decision.mode == "docs"
    assert decision.changed == 5


def test_renamed_markdown_stays_docs(repo: Path) -> None:
    def mutate(r: Path) -> None:
        (r / "docs/guide.md").rename(r / "docs/guide-2.md")
    base = _pr_merge(repo, mutate)
    assert ci_pr_scope.classify(repo, expected_base=base).mode == "docs"


@pytest.mark.parametrize("path", [
    "terminal/lib/a.ts",
    "terminal/app/docs/api/route.ts",
    ".github/workflows/ci.yml",
    ".github/README.md",
    "scripts/ci_pr_scope.py",
    "docs.md.py",
    "hub/package.json",
])
def test_any_source_path_is_full(repo: Path, path: str) -> None:
    base = _pr_merge(repo, lambda r: _write(r, path, "changed\n"))
    decision = ci_pr_scope.classify(repo, expected_base=base)
    assert decision.mode == "full"
    assert decision.reason.startswith("SOURCE_TOUCHED:")


def test_markdown_renamed_into_source_is_full(repo: Path) -> None:
    def mutate(r: Path) -> None:
        (r / "docs/guide.md").rename(r / "terminal/lib/guide.ts")
    base = _pr_merge(repo, mutate)
    assert ci_pr_scope.classify(repo, expected_base=base).mode == "full"


def test_executable_markdown_is_unqualified(repo: Path) -> None:
    def mutate(r: Path) -> None:
        _write(r, "docs/run.md", "#!/bin/sh\n")
        os.chmod(r / "docs/run.md", 0o755)
    base = _pr_merge(repo, mutate)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="SYMLINK"):
        ci_pr_scope.classify(repo, expected_base=base)


def test_symlink_under_docs_is_unqualified(repo: Path) -> None:
    def mutate(r: Path) -> None:
        os.symlink("../terminal/lib/a.ts", r / "docs/link.md")
    base = _pr_merge(repo, mutate)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="SYMLINK"):
        ci_pr_scope.classify(repo, expected_base=base)


def test_head_that_is_not_a_merge_is_unqualified(repo: Path) -> None:
    base = _git(repo, "rev-parse", "HEAD")
    _write(repo, "docs/guide.md", "changed\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "direct")
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="TWO_PARENT"):
        ci_pr_scope.classify(repo, expected_base=base)


def test_base_mismatch_is_unqualified(repo: Path) -> None:
    _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="EVENT_BASE"):
        ci_pr_scope.classify(repo, expected_base="0" * 40)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="BASE_SHA"):
        ci_pr_scope.classify(repo, expected_base="not-a-sha")


def test_cli_falls_back_to_full_and_writes_github_output(repo: Path, tmp_path: Path) -> None:
    base = _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    out = tmp_path / "out.txt"
    rc = ci_pr_scope.main(["--repo", str(repo), "--base-sha", base, "--output", str(out)])
    assert rc == 0
    assert out.read_text() == "mode=docs\nreason=PROSE_ONLY\nchanged=1\n"
    out.unlink()
    rc = ci_pr_scope.main(["--repo", str(repo), "--base-sha", "0" * 40, "--output", str(out)])
    assert rc == 0
    assert out.read_text().startswith("mode=full\nreason=UNQUALIFIED:MERGE_FIRST_PARENT")


@pytest.mark.parametrize("path,expected", [
    ("docs/a.md", True), ("docs/evidence/x.png", True), ("terminal/docs/x.json", True),
    ("README.md", True), ("ops/runbook.md", True), (".github/pull_request_template.md", False),
    ("terminal/app/docs/page.tsx", False), ("docs", False), ("", False), ("xdocs/a.md", True),
    ("terminal/lib/a.md.ts", False),
])
def test_is_docs_path(path: str, expected: bool) -> None:
    assert ci_pr_scope.is_docs_path(path) is expected
