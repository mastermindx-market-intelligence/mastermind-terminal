"""Source-enrollment regression tests, not human-comprehension or visual proof."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HumanFirstDesignContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        cls.app = (ROOT / "terminal/AGENTS.md").read_text(encoding="utf-8")

    def test_root_and_nested_claude_import_local_guide(self):
        for directory in (ROOT, ROOT / "terminal"):
            with self.subTest(directory=directory):
                text = (directory / "CLAUDE.md").read_text(encoding="utf-8")
                self.assertEqual(text.splitlines()[0], "@AGENTS.md")
                self.assertIn("human-first", text)

    def test_both_guides_reference_existing_design_owners(self):
        for text in (self.root, self.app):
            with self.subTest(guide=text.splitlines()[0]):
                self.assertIn("docs/DESIGN_DOCTRINE.md", text)
                self.assertIn("research/MASTER_PRODUCT_DESIGN_SYSTEM_V1.md", text)
                self.assertIn("accepted", text)

    def test_comprehension_and_depth_are_both_required(self):
        for text in (self.root, self.app):
            self.assertIn("3–4 seconds", text)
            self.assertIn("analytical depth", text)
            self.assertIn("return", text)
            self.assertIn("not yet tested", text)

    def test_terminal_implementation_and_rescission_survive(self):
        self.assertIn("terminal/app/globals.css", self.root)
        self.assertIn("terminal/app/observatory.css", self.root)
        self.assertIn("OPERATOR RESCISSION 2026-08-02", self.app)
        self.assertIn("does not reinstate the rescinded locked-layout rule", self.app)
        self.assertIn("Do not transplant Macro's theme.css", self.app)

    def test_nextjs_rules_and_responsive_contract_survive(self):
        self.assertIn("BEGIN:nextjs-agent-rules", self.app)
        self.assertIn("END:nextjs-agent-rules", self.app)
        self.assertIn("npm run test:e2e:responsive", self.app)
        self.assertIn("Never use an admin bypass", self.app)


if __name__ == "__main__":
    unittest.main()
