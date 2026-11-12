"""scripts/ci_pr_scope.py decides ``docs`` only for an exactly qualified
inert-prose pull-request merge commit or merge group; everything else --
including any delete/rename/copy/type-change row, any change above the file
cap, and any fork-headed pull request -- is ``full``."""
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
    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision.mode == "docs"
    assert decision.changed == 5


@pytest.mark.parametrize("operation", ["delete", "rename"])
def test_deleted_or_renamed_docs_file_is_full(repo: Path, operation: str) -> None:
    # Only adds and modifies qualify: deleting or moving inert prose can
    # reshape what a reader (or a future allowlist exception) sees, so the
    # change must run the full suite.
    def mutate(r: Path) -> None:
        if operation == "delete":
            (r / "docs/evidence/shot.png").unlink()
        else:
            (r / "docs/guide.md").rename(r / "docs/guide-2.md")
    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision.mode == "full"
    assert decision.reason.startswith("STATUS_")


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
    "docs/AGENTS.md",
    "docs/pr-crops/CLAUDE.md",
    "terminal/docs/CLAUDE.md",
    "terminal/docs/pr-crops/nested/AGENTS.md",
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


@pytest.mark.parametrize("path", ["docs/nested/CLAUDE.md", "terminal/docs/pr-crops/AGENTS.md"])
@pytest.mark.parametrize("operation", ["modify", "delete"])
def test_nested_instruction_modification_or_deletion_is_full(
    repo: Path, path: str, operation: str,
) -> None:
    _write(repo, path, "original instructions\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "instruction baseline")

    def mutate(r: Path) -> None:
        if operation == "delete":
            (r / path).unlink()
        else:
            _write(r, path, "changed instructions\n")

    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision.mode == "full"
    assert decision.reason == "SOURCE_TOUCHED:" + path


@pytest.mark.parametrize("path", ["docs/nested/AGENTS.md", "terminal/docs/pr-crops/CLAUDE.md"])
@pytest.mark.parametrize("into_instruction", [True, False])
def test_rename_into_or_out_of_nested_instructions_is_full(
    repo: Path, path: str, into_instruction: bool,
) -> None:
    guide = str(Path(path).with_name("guide.md"))
    before, after = (guide, path) if into_instruction else (path, guide)
    _write(repo, before, "unchanged instruction text\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "rename baseline")
    base = _pr_merge(repo, lambda r: (r / before).rename(r / after))
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision.mode == "full"
    assert decision.reason == "SOURCE_TOUCHED:" + path
    assert decision.changed == 2


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


@pytest.mark.parametrize("head_repo,repository", [
    ("someone_else/fork", "owner/repo"),
    ("", "owner/repo"),                      # a deleted/absent head repository
    ("owner/repo", ""),                      # an absent repository identity
])
def test_fork_head_repository_is_unqualified(
    repo: Path, head_repo: str, repository: str,
) -> None:
    base = _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="FORK_HEAD_REPOSITORY"):
        ci_pr_scope.classify(
            repo, expected_base=base, **_KW,
            head_repo=head_repo, repository=repository,
        )


def test_same_repository_head_qualifies_as_before(repo: Path) -> None:
    base = _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    decision = ci_pr_scope.classify(
        repo, expected_base=base, **_KW,
        head_repo="owner/repo", repository="owner/repo",
    )
    assert decision.mode == "docs"


def test_half_supplied_repository_identity_is_unqualified(repo: Path) -> None:
    base = _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="REPOSITORY_IDENTITY_INCOMPLETE"):
        ci_pr_scope.classify(repo, expected_base=base, **_KW, head_repo="owner/repo")
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="REPOSITORY_IDENTITY_INCOMPLETE"):
        ci_pr_scope.classify(repo, expected_base=base, **_KW, repository="owner/repo")


# --- native merge-group classification --------------------------------------


def _group_head(repo: Path, mutate) -> str:
    """Apply ``mutate`` as a direct commit (the queue's group head) and return
    the base sha it was built on."""
    base = _git(repo, "rev-parse", "HEAD")
    mutate(repo)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "group head")
    return base


def test_prose_only_group_is_docs(repo: Path) -> None:
    base = _group_head(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    decision = ci_pr_scope.classify_group(repo, base_sha=base, head_sha=_git(repo, "rev-parse", "HEAD"))
    assert decision == ci_pr_scope.ScopeDecision("docs", "PROSE_ONLY", 1)


def test_group_with_any_source_file_is_full(repo: Path) -> None:
    def mutate(r: Path) -> None:
        _write(r, "docs/guide.md", "changed\n")
        _write(r, "terminal/lib/b.ts", "export const b = 2;\n")
    base = _group_head(repo, mutate)
    decision = ci_pr_scope.classify_group(repo, base_sha=base, head_sha=_git(repo, "rev-parse", "HEAD"))
    assert decision.mode == "full"
    assert decision.reason == "SOURCE_TOUCHED:terminal/lib/b.ts"


@pytest.mark.parametrize("operation", ["delete", "rename"])
def test_group_deleting_or_renaming_docs_is_full(repo: Path, operation: str) -> None:
    def mutate(r: Path) -> None:
        if operation == "delete":
            (r / "docs/guide.md").unlink()
        else:
            (r / "docs/guide.md").rename(r / "docs/renamed.md")
    base = _group_head(repo, mutate)
    decision = ci_pr_scope.classify_group(repo, base_sha=base, head_sha=_git(repo, "rev-parse", "HEAD"))
    assert decision.mode == "full"
    assert decision.reason.startswith("STATUS_")


def test_group_above_the_cap_is_full(repo: Path) -> None:
    def mutate(r: Path) -> None:
        for i in range(ci_pr_scope._MAX_CHANGES + 1):
            _write(r, f"docs/evidence/group/crop-{i:04d}.png", "p\n")
    base = _group_head(repo, mutate)
    decision = ci_pr_scope.classify_group(repo, base_sha=base, head_sha=_git(repo, "rev-parse", "HEAD"))
    assert decision == ci_pr_scope.ScopeDecision(
        "full", "CHANGE_COUNT_ABOVE_CAP", ci_pr_scope._MAX_CHANGES + 1,
    )


def test_group_symlink_stays_unqualified(repo: Path) -> None:
    def mutate(r: Path) -> None:
        os.symlink("../terminal/lib/a.ts", r / "docs/link.md")
    base = _group_head(repo, mutate)
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="SYMLINK"):
        ci_pr_scope.classify_group(repo, base_sha=base, head_sha=_git(repo, "rev-parse", "HEAD"))


@pytest.mark.parametrize("base_sha,head_sha,match", [
    ("", "0" * 40, "GROUP_BASE_SHA"),           # not a sha
    ("0" * 40, "short", "GROUP_HEAD_SHA"),      # not a sha
    ("0" * 40, "0" * 40, "GROUP_BASE_EQUALS_HEAD"),
])
def test_group_identity_mismatch_is_unqualified(
    repo: Path, base_sha: str, head_sha: str, match: str,
) -> None:
    _group_head(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match=match):
        ci_pr_scope.classify_group(repo, base_sha=base_sha, head_sha=head_sha)


def test_group_head_that_is_not_the_checkout_is_unqualified(repo: Path) -> None:
    _group_head(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    head = _git(repo, "rev-parse", "HEAD")
    # A base that exists but whose head is not the checked-out commit: the
    # classifier must refuse rather than classify some other tree.
    _group_head(repo, lambda r: _write(r, "docs/other.md", "changed\n"))
    newer = _git(repo, "rev-parse", "HEAD")
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="GROUP_HEAD_IS_NOT_THE_CHECKOUT"):
        ci_pr_scope.classify_group(repo, base_sha=newer, head_sha=head)


def test_group_base_that_is_not_a_commit_is_unqualified(repo: Path) -> None:
    _group_head(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    head = _git(repo, "rev-parse", "HEAD")
    # A tree object is not a commit; the classifier refuses.
    tree = _git(repo, "rev-parse", "HEAD^{tree}")
    with pytest.raises(ci_pr_scope.ScopeUnqualified, match="GROUP_BASE_NOT_A_COMMIT"):
        ci_pr_scope.classify_group(repo, base_sha=tree, head_sha=head)


def test_group_cli_writes_output_and_falls_back_to_full(repo: Path, tmp_path: Path) -> None:
    base = _group_head(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    head = _git(repo, "rev-parse", "HEAD")
    out = tmp_path / "group-out.txt"
    rc = ci_pr_scope.main([
        "--repo", str(repo), "--event", "merge-group",
        "--group-base-sha", base, "--group-head-sha", head, "--output", str(out),
    ])
    assert rc == 0
    assert out.read_text() == f"reason=PROSE_ONLY\nchanged=1\nmode=docs\n"
    out.unlink()
    rc = ci_pr_scope.main([
        "--repo", str(repo), "--event", "merge-group",
        "--group-base-sha", base, "--group-head-sha", "0" * 40, "--output", str(out),
    ])
    assert rc == 0
    lines = _assert_output_shape(out.read_text(), "full")
    assert lines[0].startswith("reason=UNQUALIFIED:GROUP_HEAD_IS_NOT_THE_CHECKOUT")
    out.unlink()
    # Missing group arguments can never classify anything as docs.
    rc = ci_pr_scope.main([
        "--repo", str(repo), "--event", "merge-group", "--output", str(out),
    ])
    assert rc == 0
    lines = _assert_output_shape(out.read_text(), "full")
    assert lines[0] == "reason=UNQUALIFIED:GROUP_ARGS_MISSING:--group-base-sha:--group-head-sha"


def test_pr_cli_requires_its_arguments(repo: Path, tmp_path: Path) -> None:
    out = tmp_path / "pr-out.txt"
    rc = ci_pr_scope.main(["--repo", str(repo), "--output", str(out)])
    assert rc == 0
    lines = _assert_output_shape(out.read_text(), "full")
    assert lines[0] == (
        "reason=UNQUALIFIED:PR_ARGS_MISSING:--base-sha:--base-ref:--default-branch"
    )


def test_pr_cli_passes_the_fork_guard(repo: Path, tmp_path: Path) -> None:
    base = _pr_merge(repo, lambda r: _write(r, "docs/guide.md", "changed\n"))
    out = tmp_path / "fork-out.txt"
    rc = ci_pr_scope.main([
        "--repo", str(repo), "--base-sha", base, *_CLI,
        "--head-repo", "someone_else/fork", "--repository", "owner/repo",
        "--output", str(out),
    ])
    assert rc == 0
    lines = _assert_output_shape(out.read_text(), "full")
    assert lines[0] == "reason=UNQUALIFIED:FORK_HEAD_REPOSITORY"


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


def test_a_change_at_exactly_the_cap_is_docs_without_argv_limits(repo: Path) -> None:
    def mutate(r: Path) -> None:
        for i in range(ci_pr_scope._MAX_CHANGES):
            _write(r, f"docs/evidence/batch/crop-{i:04d}.png", "p\n")
    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision == ci_pr_scope.ScopeDecision("docs", "PROSE_ONLY", ci_pr_scope._MAX_CHANGES)


def test_a_change_above_the_cap_is_full(repo: Path) -> None:
    def mutate(r: Path) -> None:
        for i in range(ci_pr_scope._MAX_CHANGES + 1):
            _write(r, f"docs/evidence/batch/crop-{i:04d}.png", "p\n")
    base = _pr_merge(repo, mutate)
    decision = ci_pr_scope.classify(repo, expected_base=base, **_KW)
    assert decision == ci_pr_scope.ScopeDecision(
        "full", "CHANGE_COUNT_ABOVE_CAP", ci_pr_scope._MAX_CHANGES + 1,
    )


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


# --- the workflow's own classification step, executed verbatim ---------------


def _scope_step_shell() -> str:
    import yaml

    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text())
    step = workflow["jobs"]["pr_scope"]["steps"][1]
    assert step["name"] == "Classify the exact change using protected base code"
    return step["run"]


def _seed_classifier(repo: Path) -> None:
    # The protected base carries this classifier; candidate commits never
    # modify it in these scenarios.
    _write(repo, "scripts/ci_pr_scope.py", (ROOT / "scripts" / "ci_pr_scope.py").read_text())


def _run_scope_step(repo: Path, tmp_path: Path, event: str, **env_extra: str) -> dict[str, str]:
    _git(repo, "remote", "add", "origin", str(repo.resolve()))
    output = tmp_path / f"github-output-{event}-{len(env_extra)}"
    output.write_text("", encoding="utf-8")
    runner_temp = tmp_path / "runner-temp"
    runner_temp.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "GITHUB_EVENT_NAME": event,
        "GITHUB_OUTPUT": str(output),
        "GITHUB_WORKSPACE": str(repo),
        "RUNNER_TEMP": str(runner_temp),
        # Pull-request identity (unused on the merge-group path).
        "PR_BASE_REF": "main",
        "DEFAULT_BRANCH": "main",
        "PR_HEAD_REPO": "owner/repo",
        "REPOSITORY": "owner/repo",
        # Merge-group identity (unused on the pull-request path).
        "MG_BASE_REF": "refs/heads/main",
        "MG_HEAD_REF": "refs/heads/gh-readonly-queue/main/pr-1-abc",
        "GITHUB_REF": "refs/heads/gh-readonly-queue/main/pr-1-abc",
        **env_extra,
    }
    result = subprocess.run(
        ["bash", "-c", _scope_step_shell()], cwd=repo, env=env,
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return dict(line.split("=", 1) for line in output.read_text().splitlines() if "=" in line)


def test_the_workflow_step_classifies_a_docs_pr(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _write(repo, "README.md", "# t\n")
    _write(repo, "docs/guide.md", "guide\n")
    _seed_classifier(repo)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    base = _git(repo, "rev-parse", "HEAD")
    # A candidate that tries to reclassify itself: its own copy of the
    # classifier is never executed -- the base's copy runs, sees the
    # tampered classifier path in the diff and answers mode=full.
    _git(repo, "checkout", "-q", "-b", "candidate")
    _write(repo, "docs/guide.md", "changed\n")
    _write(repo, "scripts/ci_pr_scope.py", "print('mode=docs')  # attacker\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "evil candidate")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--no-ff", "--no-edit", "candidate")
    fields = _run_scope_step(repo, tmp_path, "pull_request", PR_BASE_SHA=base)
    assert fields["mode"] == "full"
    assert fields["reason"] == "SOURCE_TOUCHED:scripts/ci_pr_scope.py"


def test_the_workflow_step_classifies_a_docs_merge_group(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _write(repo, "README.md", "# t\n")
    _write(repo, "docs/guide.md", "guide\n")
    _seed_classifier(repo)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    base = _git(repo, "rev-parse", "HEAD")
    _write(repo, "docs/guide.md", "changed\n")
    _write(repo, "docs/evidence/shot.png", "png\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "group head")
    head = _git(repo, "rev-parse", "HEAD")
    fields = _run_scope_step(
        repo, tmp_path, "merge_group",
        MG_BASE_SHA=base, MG_HEAD_SHA=head, GITHUB_SHA=head,
    )
    assert fields["mode"] == "docs"
    assert fields["reason"] == "PROSE_ONLY"
    assert fields["changed"] == "2"


def test_the_workflow_step_refuses_a_merge_group_with_a_drifted_identity(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _write(repo, "README.md", "# t\n")
    _seed_classifier(repo)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    base = _git(repo, "rev-parse", "HEAD")
    _write(repo, "docs/guide.md", "changed\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "group head")
    head = _git(repo, "rev-parse", "HEAD")
    # The workflow SHA does not match the group head: the step must exit
    # nonzero (no mode output at all), leaving every heavy job full.
    _git(repo, "remote", "add", "origin", str(repo.resolve()))
    output = tmp_path / "github-output-drift"
    output.write_text("", encoding="utf-8")
    runner_temp = tmp_path / "runner-temp-drift"
    runner_temp.mkdir()
    env = {
        **os.environ,
        "GITHUB_EVENT_NAME": "merge_group",
        "GITHUB_OUTPUT": str(output),
        "GITHUB_WORKSPACE": str(repo),
        "RUNNER_TEMP": str(runner_temp),
        "MG_BASE_SHA": base, "MG_HEAD_SHA": head,
        "MG_BASE_REF": "refs/heads/main",
        "MG_HEAD_REF": "refs/heads/gh-readonly-queue/main/pr-1-abc",
        "GITHUB_REF": "refs/heads/gh-readonly-queue/main/pr-1-abc",
        "GITHUB_SHA": "f" * 40,
        "DEFAULT_BRANCH": "main",
    }
    result = subprocess.run(
        ["bash", "-c", _scope_step_shell()], cwd=repo, env=env,
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode != 0
    assert "Merge-group SHA differs from workflow SHA" in result.stderr
    assert output.read_text() == ""


def test_the_workflow_step_sends_a_fork_pr_to_full(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _write(repo, "README.md", "# t\n")
    _write(repo, "docs/guide.md", "guide\n")
    _seed_classifier(repo)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    base = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "-b", "candidate")
    _write(repo, "docs/guide.md", "changed\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "candidate")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--no-ff", "--no-edit", "candidate")
    fields = _run_scope_step(
        repo, tmp_path, "pull_request",
        PR_BASE_SHA=base, PR_HEAD_REPO="someone_else/fork", REPOSITORY="owner/repo",
    )
    assert fields["mode"] == "full"
    assert fields["reason"] == "UNQUALIFIED:FORK_HEAD_REPOSITORY"
