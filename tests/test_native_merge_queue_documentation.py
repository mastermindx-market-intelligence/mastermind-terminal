"""Keep documented native merge-queue commands executable and head-leased.

GitHub rejects --delete-branch during merge-queue enrollment. This guard
prevents an agent handoff from instructing a command that immediately fails.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
GUIDES = ("AGENTS.md", "terminal/AGENTS.md")
REPO = "mastermindx-market-intelligence/mastermind-terminal"


def _merge_commands(text: str) -> list[str]:
    return re.findall(r"`(gh pr merge[^`]+)`", text)


def test_native_merge_queue_examples_are_valid_and_head_leased():
    for guide in GUIDES:
        commands = _merge_commands((ROOT / guide).read_text(encoding="utf-8"))
        assert len(commands) == 1, f"{guide}: expected one native merge example, got {commands}"
        command = commands[0]
        assert "--auto" in command
        assert "--squash" in command
        assert "--repo " + REPO in command
        assert "--match-head-commit <CURRENT_40_HEX_HEAD>" in command
        assert "--delete-branch" not in command
        assert "--admin" not in command


def test_terminal_guide_inherits_the_current_root_command():
    root = _merge_commands((ROOT / GUIDES[0]).read_text(encoding="utf-8"))
    nested = _merge_commands((ROOT / GUIDES[1]).read_text(encoding="utf-8"))
    assert root == nested



def test_github_native_source_authoring_has_no_host_worktree_prerequisite():
    root = (ROOT / GUIDES[0]).read_text(encoding="utf-8")
    nested = (ROOT / GUIDES[1]).read_text(encoding="utf-8")
    assert "**GitHub-native** source" in root
    assert "requires no M2 worktree" in root
    assert "Independently authorized GitHub-native" in nested
    assert "does not require an M2 worktree" in nested
    assert "blob" in root and "blob" in nested
    assert "Never switch" in root and "Never switch" in nested
    assert "Attended Web/Studio sessions must reuse or acquire" not in nested
