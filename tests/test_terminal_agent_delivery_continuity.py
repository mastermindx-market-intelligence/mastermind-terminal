"""Guard Terminal agent instructions against premature stop-at-blocker closeouts.

Source-contract tests only: passing is NOT fresh served-model behavior or deployment proof.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ROOT_GUARDS = (
    "A held release step blocks that effect, not the whole session",
    "name and execute the next independent authorized source, test, integration, or real-path verification action",
    "An issue, reviewer request, CI observation, or preserved branch is not completion",
    "original managed workspace",
    "proven pre-effect technical failure",
    "only on material same-carrier recovery evidence",
    "An explicit safety/permission denial ends retries of that effect",
    "EFFECT_UNKNOWN",
    "reconciled on its original carrier before retry",
    "Do not force, create a replacement branch",
    "Report the exact blocker and recovery action only when no safe useful work remains",
)
NESTED_GUARDS = (
    "A CI/review/deployment hold stops that release effect, not the whole assigned session",
    "complete the next genuinely independent authorized source, test, integration or browser-proof action",
    "An issue, reviewer request, green local tests or blocker report is not completion",
    "original managed branch",
    "never retry an explicit safety/permission denial",
    "reconcile EFFECT_UNKNOWN on the same carrier",
    "Do not claim a pushed remote branch when publication did not occur",
    "fresh incognito end-to-end pass",
    "merge-on-green",
)
WORKSPACE_GUARDS = (
    "through the installed `mmx-workspace` owner",
    "Do not create a second worktree",
)


def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def _norm(text: str) -> str:
    return " ".join(text.split())


def _contract_ok(root: str, nested: str) -> bool:
    return (
        all(guard in _norm(root) for guard in ROOT_GUARDS)
        and all(guard in _norm(nested) for guard in NESTED_GUARDS)
        and all(guard in _norm(nested) for guard in WORKSPACE_GUARDS)
    )


def test_two_terminal_agent_guides_preserve_action_and_effect_fences():
    assert _contract_ok(_read("AGENTS.md"), _read("terminal/AGENTS.md"))


@pytest.mark.parametrize("guard", ROOT_GUARDS)
def test_missing_root_safety_or_forward_action_clause_is_a_regression(guard: str):
    root, nested = _read("AGENTS.md"), _read("terminal/AGENTS.md")
    normal = _norm(root)
    assert guard in normal
    assert not _contract_ok(normal.replace(guard, "", 1), nested)


@pytest.mark.parametrize("guard", NESTED_GUARDS + WORKSPACE_GUARDS)
def test_missing_nested_safety_or_forward_action_clause_is_a_regression(guard: str):
    root, nested = _read("AGENTS.md"), _read("terminal/AGENTS.md")
    normal = _norm(nested)
    assert guard in normal
    assert not _contract_ok(root, normal.replace(guard, "", 1))


@pytest.mark.parametrize("relative", ("CLAUDE.md", "terminal/CLAUDE.md"))
def test_claude_imports_guides_without_a_separate_competing_policy(relative: str):
    text = _read(relative)
    assert text.startswith("@AGENTS.md\n")
    assert text.count("@AGENTS.md") == 1
    assert "lane-local" in text or "blocked-release" in text


def test_nested_workspace_instruction_does_not_order_raw_git_worktree():
    guide = _read("terminal/AGENTS.md")
    assert "ALWAYS `git worktree add`" not in guide
    assert "Do not create a second worktree" in guide
