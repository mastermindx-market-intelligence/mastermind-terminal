"""Behavioral and adversarial tests for the base-pinned static-change fast lane."""
from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.ci_fast_lane import classify, _svg_ok, _asset_ok


REPO = "mastermindx-market-intelligence/mastermind-terminal"
SAFE_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20 L12 12 L22 4" stroke="#77ccff" fill="none"/></svg>'


class IsolatedGit(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.repo = Path(self.scratch.name)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.test")
        self.git("config", "user.name", "Fixture")
        self.write("README.md", b"accepted baseline\n")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True)

    def write(self, path, data):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "fixture")
        return self.git("rev-parse", "HEAD").strip()

    def verdict(self, event="pull_request", head_repo=REPO):
        return classify(self.repo, self.base, self.git("rev-parse", "HEAD").strip(),
                        event, head_repo, REPO)[0]

    def test_single_static_svg_can_be_fast(self):
        self.write("terminal/public/icons/prophet.svg", SAFE_SVG)
        self.commit()
        self.assertEqual(self.verdict(), "fast")

    def test_small_ux_note_can_be_fast(self):
        self.write("terminal/docs/ux-notes/prophet.md", b"Preview notes\n")
        self.commit()
        self.assertEqual(self.verdict(), "fast")

    def test_small_readme_can_not_change_governing_instructions_on_fast_path(self):
        self.write("AGENTS.md", b"Not static visual documentation\n")
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_actual_prophet_chart_renderer_change_is_full_until_component_is_isolated(self):
        self.write("terminal/components/ChartPanel.tsx", b"const signal = 'changed';\n")
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_mixed_svg_and_workflow_change_is_full(self):
        self.write("terminal/public/icons/prophet.svg", SAFE_SVG)
        self.write(".github/workflows/ci.yml", b"name: replaced\n")
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_invalid_svg_reverts_to_full(self):
        self.write("terminal/public/icons/prophet.svg", b'<svg onload="alert(1)"/>')
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_oversized_svg_reverts_to_full(self):
        self.write("terminal/public/icons/prophet.svg", SAFE_SVG + b"x" * (256 * 1024))
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_symlink_reverts_to_full(self):
        target = self.repo / "terminal/public/icons/prophet.svg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to("../../../README.md")
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_rename_reverts_to_full(self):
        self.write("terminal/public/icons/before.svg", SAFE_SVG)
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("mv", "terminal/public/icons/before.svg", "terminal/public/icons/after.svg")
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_deletion_reverts_to_full(self):
        self.write("terminal/public/icons/delete.svg", SAFE_SVG)
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("rm", "terminal/public/icons/delete.svg")
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_large_copy_change_is_full(self):
        self.write("terminal/docs/ux-notes/long.md", (b"a\n" * 85))
        self.commit()
        self.assertEqual(self.verdict(), "full")

    def test_non_pr_or_fork_is_full(self):
        self.write("terminal/public/icons/prophet.svg", SAFE_SVG)
        self.commit()
        self.assertEqual(self.verdict("workflow_dispatch"), "full")
        self.assertEqual(self.verdict("merge_group"), "full")
        self.assertEqual(self.verdict(head_repo="external/fork"), "full")

    def test_no_change_is_full(self):
        self.assertEqual(self.verdict(), "full")

    def test_many_static_files_are_full(self):
        for i in range(7):
            self.write(f"terminal/public/icons/icon{i}.svg", SAFE_SVG)
        self.commit()
        self.assertEqual(self.verdict(), "full")


class SvgGuard(unittest.TestCase):
    def test_static_svg_is_accepted(self):
        self.assertTrue(_svg_ok(SAFE_SVG))

    def test_svg_active_content_is_rejected(self):
        for payload in [
            b'<svg><script>pwn()</script></svg>',
            b'<svg><foreignObject><div>unsafe</div></foreignObject></svg>',
            b'<svg><a href="https://malicious.example/">link</a></svg>',
            b'<svg><image href="data:image/png;base64,AAAA"/></svg>',
            b'<svg><path onmouseover="alert(1)" d="M0 0"/></svg>',
            b'<!DOCTYPE svg [<!ENTITY test SYSTEM "file:///etc/passwd">]><svg>&test;</svg>',
        ]:
            with self.subTest(payload=payload):
                self.assertFalse(_svg_ok(payload))

    def test_binary_signatures_are_verified(self):
        self.assertFalse(_asset_ok("terminal/public/icons/sneak.png", b"not a png"))
        self.assertFalse(_asset_ok("terminal/public/icons/sneak.jpg", b"not a jpeg"))


class WorkflowWiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import yaml
        cls.workflow = yaml.safe_load((Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml").read_text())
        cls.jobs = cls.workflow["jobs"]

    def test_frozen_required_status_contexts_are_not_renamed(self):
        self.assertEqual(self.jobs["hub"]["name"], "Quote Hub tests")
        self.assertEqual(self.jobs["terminal"]["name"], "Terminal typecheck + tests")
        self.assertEqual(self.jobs["python"]["name"], "Ingest + signal-layer tests")

    def test_classifier_executes_base_version_not_candidate_script(self):
        steps = self.jobs["classify"]["steps"]
        run = steps[1]["run"]
        self.assertIn('git show "HEAD^1:scripts/ci_fast_lane.py"', run)
        self.assertIn("--base HEAD^1 --head HEAD", run)
        self.assertIn('git cat-file -e "HEAD^1:scripts/ci_fast_lane.py"', run)
        self.assertIn("lane=full", run)
        self.assertEqual(self.jobs["classify"]["outputs"]["lane"], "${{ steps.route.outputs.lane }}")

    def test_unrelated_required_jobs_do_no_heavy_work_in_static_route(self):
        for key in ("hub", "python"):
            job = self.jobs[key]
            self.assertEqual(job["needs"], "classify")
            for step in job["steps"]:
                if step.get("name") == "Explain approved static-only fast path":
                    continue
                self.assertEqual(step.get("if"), "needs.classify.outputs.lane != 'fast'")
            fast = [step for step in job["steps"] if step.get("if") == "needs.classify.outputs.lane == 'fast'"]
            self.assertEqual(len(fast), 1)
        hub_fast = [step for step in self.jobs["hub"]["steps"] if step.get("if") == "needs.classify.outputs.lane == 'fast'"][0]
        self.assertEqual(hub_fast.get("working-directory"), "${{ github.workspace }}")

    def test_fast_route_disables_full_matrix_without_weakening_matrix_definition(self):
        for key in ("terminal-unit", "terminal-e2e", "investigation-postgres"):
            self.assertEqual(self.jobs[key].get("needs"), "classify")
            self.assertEqual(self.jobs[key].get("if"), "needs.classify.outputs.lane != 'fast'")
        self.assertEqual(len(self.jobs["terminal-e2e"]["strategy"]["matrix"]["include"]), 12)

    def test_required_terminal_gate_refuses_mixed_or_unqualified_results(self):
        gate = self.jobs["terminal"]
        self.assertEqual(gate.get("if"), "always()")
        self.assertEqual(gate["needs"], ["classify", "terminal-unit", "terminal-e2e"])
        script = gate["steps"][0]["run"]
        self.assertIn('if [ "$ROUTE_JOB" != "success" ]', script)
        self.assertIn('if [ "$UNIT" != "skipped" ] || [ "$E2E" != "skipped" ]', script)
        self.assertIn('if [ "$res" != "success" ]', script)
        self.assertIn('echo "::error title=terminal-ci::Missing or unknown route"', script)

    def test_required_terminal_gate_bash_truth_table(self):
        import os
        job = self.jobs["terminal"]
        script = job["steps"][0]["run"]
        for name, route, classifier, unit, e2e, ok in [
            ("fast-safe", "fast", "success", "skipped", "skipped", True),
            ("full-green", "full", "success", "success", "success", True),
            ("fast-mixed", "fast", "success", "success", "skipped", False),
            ("fast-not-classified", "fast", "failure", "skipped", "skipped", False),
            ("full-skipped", "full", "success", "skipped", "success", False),
            ("full-failed", "full", "success", "failure", "success", False),
            ("unknown-mode", "unknown", "success", "skipped", "skipped", False),
        ]:
            with self.subTest(name=name):
                result = subprocess.run(["bash", "-e"], input=script, text=True,
                                        env={**os.environ, "ROUTE": route, "ROUTE_JOB": classifier,
                                             "UNIT": unit, "E2E": e2e}, capture_output=True, timeout=5)
                self.assertEqual(result.returncode == 0, ok,
                                 f"{name}: code={result.returncode} stdout={result.stdout} stderr={result.stderr}")


if __name__ == "__main__":
    unittest.main()
