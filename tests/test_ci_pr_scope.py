"""scripts/ci_pr_scope.py decides ``docs`` only for an exactly qualified
inert-prose pull-request merge commit; everything else is ``full``."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import ci_pr_scope  # noqa: E402

_KW = {"base_ref": "main", "default_branch": "main"}
_CLI = ["--base-ref", "main", "--default-branch", "main"]


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
        _write(r, "docs/evidence/new.png", "png2\n")
        _write(r, "terminal/docs/note.md", "changed\n")
        _write(r, "terminal/docs/pr-crops/x/crop.webp", "webp\n")
        _write(r, "docs/new/HANDOFF.md", "handoff\n")
        (r / "docs/evidence/shot.png").unlink()
    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision.mode == "docs"
    assert decision.changed == 6


def test_renamed_markdown_stays_docs(repo: Path) -> None:
    def mutate(r: Path) -> None:
        (r / "docs/guide.md").rename(r / "docs/guide-2.md")
    base = _pr_merge(repo, mutate)
    assert ci_pr_scope.classify(repo, expected_base=base, **_KW).mode == "docs"


@pytest.mark.parametrize("path", [
    "terminal/lib/a.ts",
    "terminal/app/docs/api/route.ts",
    ".github/workflows/ci.yml",
    ".github/README.md",
    "scripts/ci_pr_scope.py",
    "docs.md.py",
    "hub/package.json",
    "README.md",                      # read by tests (reservations helper)
    "DEPLOY.md",                      # webhookSigning.test.ts
    "AGENTS.md",                      # instruction-recovery tests
    "terminal/CLAUDE.md",
    "supabase/migrations/README.md",  # migration namespace guard input
    "docs/evidence/new.json",         # only raster images are inert evidence
    "docs/evidence/new.svg",
    "docs/diagram.png",               # images outside the evidence trees
    "terminal/docs/x.json",
    "terminal/docs/pr-crops/x/capture.mjs",
    "terminal/docs/pr-crops/x/EVIDENCE.yml",
    "terminal/docs/api/API_V1_CONTRACT.md",   # served by the app
    "terminal/docs/specimens/news-flow.html",
    "terminal/docs/refs/x/copy_table.md",
    "docs/chart-engine-completion/bench.md",
    "docs/chart-engine/acceptance_coverage.json",
    "docs/F12_TENANT_SCOPE_CONTRACT_2026-09-06.md",
    "docs/FEATURE_GAP_AUDIT.md",
    "docs/LARGE_TRADES_ABSORPTION.md",
])
def test_any_source_or_consumed_path_is_full(repo: Path, path: str) -> None:
    base = _pr_merge(repo, lambda r: _write(r, path, "changed\n"))
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision.mode == "full"
    assert decision.reason.startswith("SOURCE_TOUCHED:")


def test_markdown_renamed_into_source_is_full(repo: Path) -> None:
    def mutate(r: Path) -> None:
        (r / "docs/guide.md").rename(r / "terminal/lib/guide.ts")
    base = _pr_merge(repo, mutate)
    assert ci_pr_scope.classify(repo, expected_base=base, **_KW).mode == "full"


def test_executable_markdown_is_unqualified(repo: Path) -> None:
    def mutate(r: Path) -> None:
        _write(r, "docs/run.md", "#!/bin/sh\n")
        os.chmod(r / "docs/run.md", 0o755)
    base = _pr_merge(repo, mutate)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="SYMLINK"):
        ci_pr_scope.classify(repo, expected_base=base, **_KW)


def test_symlink_under_docs_is_unqualified(repo: Path) -> None:
    def mutate(r: Path) -> None:
        os.symlink("../terminal/lib/a.ts", r / "docs/link.md")
    base = _pr_merge(repo, mutate)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="SYMLINK"):
        ci_pr_scope.classify(repo, expected_base=base, **_KW)


def test_head_that_is_not_a_merge_is_unqualified(repo: Path) -> None:
    base = _git(repo, "rev-parse", "HEAD")
    _write(repo, "docs/guide.md", "changed\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "direct")
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="TWO_PARENT"):
        ci_pr_scope.classify(repo, expected_base=base, **_KW)


def test_base_mismatch_is_unqualified(repo: Path) -> None:
    _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="EVENT_BASE"):
        ci_pr_scope.classify(repo, expected_base="0" * 40, **_KW)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="BASE_SHA"):
        ci_pr_scope.classify(repo, expected_base="not-a-sha", **_KW)


@pytest.mark.parametrize("base_ref,default_branch", [
    ("release", "main"), ("", "main"), ("main", ""), ("Main", "main"),
])
def test_pull_request_against_a_non_default_base_is_unqualified(
    repo: Path, base_ref: str, default_branch: str,
) -> None:
    # The classifier is only trusted from the protected default branch; a PR
    # that targets a writable side branch (which may carry a lenient copy of
    # this script) never gets docs mode, even before the workflow-level gate.
    base = _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="DEFAULT_BRANCH"):
        ci_pr_scope.classify(repo, expected_base=base, base_ref=base_ref, default_branch=default_branch)


_OUTPUT_LINE = re.compile(r"^(reason|changed|mode)=[A-Za-z0-9._/:+-]*$")


def _assert_output_shape(text: str, mode: str) -> list[str]:
    lines = text.splitlines()
    assert text.endswith("\n") and len(lines) == 3, text
    assert all(_OUTPUT_LINE.match(line) for line in lines), text
    assert lines[-1] == f"mode={mode}"
    assert [line.split("=", 1)[0] for line in lines] == ["reason", "changed", "mode"]
    return lines


def test_cli_falls_back_to_full_and_writes_github_output(repo: Path, tmp_path: Path) -> None:
    base = _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    out = tmp_path / "out.txt"
    rc = ci_pr_scope.main(["--repo", str(repo), "--base-sha", base, *_CLI, "--output", str(out)])
    assert rc == 0
    assert out.read_text() == "reason=PROSE_ONLY\nchanged=1\nmode=docs\n"
    out.unlink()
    rc = ci_pr_scope.main(["--repo", str(repo), "--base-sha", "0" * 40, *_CLI, "--output", str(out)])
    assert rc == 0
    lines = _assert_output_shape(out.read_text(), "full")
    assert lines[0].startswith("reason=UNQUALIFIED:MERGE_FIRST_PARENT")
    out.unlink()
    rc = ci_pr_scope.main(["--repo", str(repo), "--base-sha", base, "--base-ref", "side",
                           "--default-branch", "main", "--output", str(out)])
    assert rc == 0
    assert _assert_output_shape(out.read_text(), "full")[0] == "reason=UNQUALIFIED:BASE_IS_NOT_THE_DEFAULT_BRANCH"


def test_control_character_path_cannot_inject_github_output(repo: Path, tmp_path: Path) -> None:
    # A file name carrying a newline could otherwise append `mode=docs` as a
    # later (winning) key in GITHUB_OUTPUT next to a real source change.
    evil = "docs/!\nmode=docs\nz.md"

    def mutate(r: Path) -> None:
        _write(r, evil, "x\n")
        _write(r, "terminal/lib/evil.ts", "export const x = 1;\n")
    base = _pr_merge(repo, mutate)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="PATH_CONTROL_CHARACTER"):
        ci_pr_scope.classify(repo, expected_base=base, **_KW)
    out = tmp_path / "out.txt"
    assert ci_pr_scope.main(["--repo", str(repo), "--base-sha", base, *_CLI, "--output", str(out)]) == 0
    text = out.read_text()
    lines = _assert_output_shape(text, "full")
    assert lines[0] == "reason=UNQUALIFIED:PATH_CONTROL_CHARACTER"
    assert "mode=docs" not in text


def test_source_path_in_the_reason_is_reduced_to_the_output_alphabet(repo: Path, tmp_path: Path) -> None:
    path = "terminal/lib/a=b c;$(x).ts"
    base = _pr_merge(repo, lambda r: _write(r, path, "x\n"))
    out = tmp_path / "out.txt"
    assert ci_pr_scope.main(["--repo", str(repo), "--base-sha", base, *_CLI, "--output", str(out)]) == 0
    lines = _assert_output_shape(out.read_text(), "full")
    assert lines[0] == "reason=SOURCE_TOUCHED:terminal/lib/a_b_c___x_.ts"
    assert lines[1] == "changed=1"


def test_thousands_of_evidence_files_do_not_depend_on_argv_limits(repo: Path) -> None:
    def mutate(r: Path) -> None:
        for i in range(2500):
            _write(r, f"docs/evidence/batch/crop-{i:04d}.png", "p\n")
    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision == ci_pr_scope.ScopeDecision("docs", "PROSE_ONLY", 2500)


@pytest.mark.parametrize("path,expected", [
    ("docs/a.md", True), ("docs/evidence/x.png", True), ("docs/evidence/x.JPG", False),
    ("terminal/docs/x.md", True), ("terminal/docs/pr-crops/a/b.jpeg", True),
    ("terminal/docs/x.json", False), ("docs/evidence/x.json", False), ("docs/x.png", False),
    ("README.md", False), ("ops/runbook.md", False), (".github/pull_request_template.md", False),
    ("terminal/app/docs/page.tsx", False), ("docs", False), ("", False), ("xdocs/a.md", False),
    ("terminal/lib/a.md.ts", False), ("terminal/docs/api/API_V1_CONTRACT.md", False),
    ("docs/chart-engine-completion/bench.md", False), ("docs/FEATURE_GAP_AUDIT.md", False),
])
def test_is_docs_path(path: str, expected: bool) -> None:
    assert ci_pr_scope.is_docs_path(path) is expected


_LITERAL_REF = re.compile(r"""["'`]((?:\.\./|\./)?[A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,5})["'`]""")
_SOURCE_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".py", ".sh", ".yml", ".yaml")


def _literal_path_references() -> dict[str, set[str]]:
    """Every tracked file that some source file names by literal path."""
    raw = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], check=True,
                         capture_output=True).stdout.decode("utf-8", "surrogateescape")
    tracked = {name for name in raw.split("\0") if name}
    referenced: dict[str, set[str]] = {}
    for source in tracked:
        if not source.endswith(_SOURCE_SUFFIXES) or "node_modules" in source:
            continue
        if source.startswith(ci_pr_scope._DOCS_TREES):
            continue  # scripts inside the docs trees are not run by CI
        try:
            text = (ROOT / source).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        parent = Path(source).parent
        for match in _LITERAL_REF.finditer(text):
            literal = match.group(1)
            candidates = {literal.lstrip("./"), f"terminal/{literal.lstrip('./')}"}
            try:
                candidates.add((parent / literal).resolve().relative_to(ROOT.resolve()).as_posix())
            except ValueError:
                pass
            for candidate in candidates:
                if candidate in tracked and not candidate.endswith(ci_pr_scope._EVIDENCE_SUFFIXES):
                    # Raster evidence is written by specs (page.screenshot) and
                    # never compared: a changed PNG cannot change a test result.
                    referenced.setdefault(candidate, set()).add(source)
    return referenced


def test_no_literally_referenced_tracked_file_is_docs() -> None:
    """The allowlist must never contain a file that source names by path.

    This is the self-maintaining half of the docs allowlist: when a test or
    runtime module starts reading a Markdown file under docs/, this census
    fails until scripts/ci_pr_scope.py excludes it. Dynamic path building is
    outside its reach; keep the docs class narrow for that reason.
    """
    referenced = _literal_path_references()
    assert "terminal/docs/api/API_V1_CONTRACT.md" in referenced  # the census sees real consumers
    leaked = {path: sorted(sources) for path, sources in referenced.items() if ci_pr_scope.is_docs_path(path)}
    assert not leaked, leaked
