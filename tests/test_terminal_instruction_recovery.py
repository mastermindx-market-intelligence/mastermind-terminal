"""Static Terminal root-instruction regressions, not served-client behavior proof."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TerminalInstructionRecoveryTests(unittest.TestCase):
    def test_current_receiver_does_not_wait_for_archived_original_parent(self):
        guide = (ROOT / "AGENTS.md").read_text()
        for phrase in (
            "only the original writer/parent must act",
            "currently assigned receiver",
            "original PR/workspace",
            "live writer/lease",
            "next permitted recovery action",
            "archived chat",
        ):
            with self.subTest(phrase=phrase):
                self.assertTrue(phrase in guide, "Missing required clause: "+phrase)

    def test_started_work_and_effect_unknown_remain_fenced(self):
        guide = (ROOT / "AGENTS.md").read_text()
        for phrase in (
            "STARTed exact-session",
            "EFFECT_UNKNOWN",
            "existing carrier",
            "handoff text never transfers",
            "source/effect checks",
        ):
            with self.subTest(phrase=phrase):
                self.assertTrue(phrase in guide, "Missing required clause: "+phrase)

    def test_local_claude_memory_is_advisory_not_a_mandatory_gate(self):
        guide = (ROOT / "AGENTS.md").read_text()
        self.assertIn("Treat local Claude project memory as optional context", guide)
        self.assertNotIn("Search the Claude project memory index at", guide)
        self.assertNotIn("Delivery work must include", guide)
        self.assertIn("Agent OS", guide)

    def test_claude_still_imports_exact_root_entrypoint(self):
        claude = (ROOT / "CLAUDE.md").read_text()
        self.assertTrue(claude.startswith("@AGENTS.md"))
        self.assertIn("delivery contracts are imported from AGENTS.md", claude)


if __name__ == "__main__":
    unittest.main()
