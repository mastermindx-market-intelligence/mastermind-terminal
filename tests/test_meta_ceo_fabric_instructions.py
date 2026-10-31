"""Source contract: Terminal Codex and Claude share one Meta-CEO Fabric rule.

This is deliberately *not* a live admission or provider runtime test.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENTS = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
CLAUDE = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
NESTED = (ROOT / "terminal/AGENTS.md").read_text(encoding="utf-8")


def test_claude_imports_the_same_agents_contract_as_codex():
    assert CLAUDE.startswith("@AGENTS.md")
    assert AGENTS.count("## Assigned Meta-CEO and economical Fabric delegation") == 1


def test_meta_ceo_has_an_explicit_assignment_fence():
    assert "Only a **currently assigned** Codex or Claude principal" in AGENTS
    assert "does not self-promote" in AGENTS
    assert "before spending substantial frontier principal turns" in AGENTS


def test_worker_admission_reuses_original_fabric_and_exact_root():
    for phrase in (
        "mastermind-fabric-delegate",
        "fabric_task.py",
        "CODEX_THREAD_ID",
        "Executive/Capacity",
        "EFFECT_UNKNOWN",
        "stable child ID",
    ):
        assert phrase in AGENTS


def test_native_harnesses_use_shared_source_not_claude_memory_or_legacy_worktrees():
    assert "Claude project memory is optional" in AGENTS
    assert "not a mandatory startup" in AGENTS
    assert "currently installed\n  Mastermind workspace launcher" in AGENTS
    assert "Do not use a raw `git worktree add`" in AGENTS
    assert "does not pin a\nuniversal Opus/Sonnet/Haiku hierarchy" in NESTED
    assert "Claude-native Agent/Task routing hooks are not Codex-native capabilities" in NESTED
    assert "Do not run raw `git worktree add`" in NESTED


def test_principal_returns_are_compact_and_existing_owners_remain():
    for phrase in ("source hash", "test evidence", "next", "outside principal context"):
        assert phrase in AGENTS
    assert "canonical Macro Agent OS" in AGENTS
    assert "These source instructions do not install a" in AGENTS
    assert "do not spawn just to fill 114" in AGENTS.lower()
