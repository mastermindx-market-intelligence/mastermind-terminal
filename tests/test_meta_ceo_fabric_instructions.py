"""Source contract: Terminal's assigned principals share one delegation rule.

This is deliberately *not* a live admission or provider runtime test.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENTS = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
CLAUDE = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
NESTED = (ROOT / "terminal/AGENTS.md").read_text(encoding="utf-8")


def _flat(text: str) -> str:
    """Collapse wrapping so a contract phrase is matched, not a line break."""
    return " ".join(text.split())


def test_claude_imports_the_same_agents_contract_as_codex():
    assert CLAUDE.startswith("@AGENTS.md")
    assert AGENTS.count("## Assigned Meta-CEO and economical Fabric delegation") == 1


def test_meta_ceo_has_an_explicit_assignment_fence():
    flat = _flat(AGENTS)
    assert "Only a **currently assigned** principal or AI CEO owns" in flat
    assert "Assignment is the fence; a client list is not." in flat
    assert "an attended ChatGPT Web session" in flat
    assert "Only a **currently assigned** Codex or Claude principal" not in flat
    assert "does not self-promote" in flat
    assert "before spending substantial frontier principal turns" in flat


def test_worker_admission_reuses_original_fabric_and_exact_root():
    flat = _flat(AGENTS)
    for phrase in (
        "mastermind-fabric-delegate",
        "fabric_task.py",
        "CODEX_THREAD_ID",
        "Executive/Capacity",
        "EFFECT_UNKNOWN",
        "stable child ID",
    ):
        assert phrase in flat
    assert "Those paths apply only inside that actual harness and existing admission" in flat
    assert "an installed skill or adapter is not itself admission" in flat
    assert "Never duplicate an existing run, change carrier after `EFFECT_UNKNOWN`" in flat


def test_native_harnesses_use_shared_source_not_claude_memory_or_legacy_worktrees():
    flat = _flat(AGENTS)
    nested = _flat(NESTED)
    # Optional memory: context only. It never starts work and never grants authority.
    assert "local Claude project memory as optional context, not a startup or delivery gate" in flat
    assert "not a mandatory startup dependency for Codex, ChatGPT Web or Fabric workers" in flat
    assert "Local memory never establishes a live owner, permission, or effect clearance" in flat
    assert "old memory instructions never override current repository, protected Mastermind or release rules" in flat
    # Workspace custody: the installed owner, the assigned launcher, no raw escape.
    assert "installed `mmx-workspace` owner" in flat
    assert "only those with an approved direct-worktree contract may create one under its designated root" in flat
    assert (
        "Do not create an alternate worktree or force/re-home an existing operation "
        "to bypass a refusal, exclusive writer, or uncertain effect"
    ) in flat
    assert "installed `mmx-workspace` owner" in nested
    assert (
        "Do not create a second worktree to route around any existing writer, "
        "permission refusal, or EFFECT_UNKNOWN"
    ) in nested
    # The current session-owned review and delivery ownership survive the composition.
    assert "## Session-owned PR/source review (Chairman 2026-11-03)" in AGENTS
    assert "do not impose a blanket independent technical reviewer" in flat
    assert "## Finish the existing release, not the draft" in AGENTS
    assert "## Current receiver and executable handoffs" in AGENTS
    assert "## Review without another session" in NESTED
    assert "## Original-PR delivery ownership" in NESTED
    # Nested routing follows protected policy and actual grants, not a pinned tier set.
    assert "does not pin a universal Opus/Sonnet/Haiku hierarchy" in nested
    assert "Claude-native Agent/Task routing hooks are not Codex-native capabilities" in nested


def test_principal_returns_are_compact_and_existing_owners_remain():
    flat = _flat(AGENTS)
    for phrase in ("source hash", "test evidence", "next", "outside principal context"):
        assert phrase in flat
    assert "canonical Macro Agent OS" in flat
    assert "These source instructions do not install a" in flat
    assert "do not spawn just to fill 114" in flat.lower()
