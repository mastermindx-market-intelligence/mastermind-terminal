import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import qualify_eod_v2_browser as driver
import qualify_r5_alignment_browser as shared


class ExportIdentityTests(unittest.TestCase):
    def identity(self, *, profile="eod-v2", change=None):
        head, base, commit, tree = [letter * 40 for letter in "abcd"]
        number, job = (895, "terminal-unit") if profile == "eod-v2" else (646, "terminal-e2e")
        repository = "mastermindx-market-intelligence/mastermind-terminal"
        event = {"number": number, "pull_request": {"number": number,
            "head": {"sha": head, "repo": {"full_name": repository}},
            "base": {"sha": base, "ref": "master", "repo": {"full_name": repository}}}}
        env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "pull_request", "GITHUB_JOB": job,
            "GITHUB_REPOSITORY": repository, "GITHUB_SHA": commit, "GITHUB_REF": f"refs/pull/{number}/merge",
            "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}
        parents = [base, head]
        if change:
            change(env, event, parents)
        def git(*args):
            return {("rev-parse", "HEAD"): commit, ("rev-parse", "HEAD^{tree}"): tree,
                    ("diff", "--name-only", "--diff-filter=U"): ""}[args]
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "event.json"
            file.write_text(json.dumps(event))
            env["GITHUB_EVENT_PATH"] = str(file)
            with patch.dict(os.environ, env, clear=True), patch.object(shared, "git", side_effect=git), \
                 patch.object(shared, "checkout_parents", return_value=parents):
                return shared.checkout_identity(profile)

    def test_original_r5_identity_is_preserved(self):
        result = self.identity(profile="r5")
        self.assertEqual((result["workflowJob"], result["shard"]), ("terminal-e2e", "serial"))

    def test_owned_unit_identity_preserves_actual_merge_and_event(self):
        result = self.identity()
        self.assertEqual(result["checkoutParents"], [result["protectedMaster"], result["branchHead"]])
        self.assertNotEqual(result["checkoutCommit"], result["branchHead"])
        self.assertEqual(result["baseRelationship"]["state"], "EXACT_EVENT_BASE")
        self.assertEqual((result["workflowJob"], result["shard"]), ("terminal-unit", "unit"))

    def test_foreign_event_job_fork_and_reversed_parents_are_rejected(self):
        changes = [lambda e, v, p: e.update(GITHUB_JOB="terminal-e2e"),
            lambda e, v, p: e.update(GITHUB_REF="refs/pull/646/merge"),
            lambda e, v, p: e.update(GITHUB_EVENT_NAME="workflow_dispatch"),
            lambda e, v, p: v.update(number=646),
            lambda e, v, p: v["pull_request"]["head"]["repo"].update(full_name="someone/fork"),
            lambda e, v, p: p.reverse(), lambda e, v, p: e.update(GITHUB_RUN_ATTEMPT="0")]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.identity(change=change)


class ExportRetentionTests(unittest.TestCase):
    def test_cli_success_is_not_server_settlement(self):
        result = {"closed": True, "status": 0, "signal": None, "timedOut": False, "error": None, "serverSettled": True}
        self.assertTrue(driver.require_cli_result(result))
        for patch_value in [{"closed": False}, {"status": 1}, {"signal": "SIGTERM"},
                            {"timedOut": True}, {"error": {"code": "EPERM"}}]:
            self.assertFalse(driver.require_cli_result({**result, **patch_value}))

    def test_bundle_preserves_hidden_results_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            hidden = root / "browser/playwright/.last-run.json"
            hidden.parent.mkdir(parents=True)
            hidden.write_text('{"status":"passed","failedTests":[]}\n')
            (root / "export-status.json").write_text('{"state":"RAW_CAPTURES_QUALIFIED_PENDING_SUCCESSOR_IMPORT"}\n')
            driver.retained_bundle(root)
            with zipfile.ZipFile(root / "export.zip") as archive:
                self.assertEqual(archive.read("browser/playwright/.last-run.json"), hidden.read_bytes())
            receipt = json.loads((root / "archive-receipt.json").read_text())
            self.assertEqual(receipt["hiddenMembers"], ["browser/playwright/.last-run.json"])
            with self.assertRaises(RuntimeError):
                driver.retained_bundle(root)

    def test_bundle_rejects_symlink_members(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "target").write_text("proof")
            (root / "link").symlink_to(root / "target")
            with self.assertRaises(RuntimeError):
                driver.retained_bundle(root)


if __name__ == "__main__":
    unittest.main()
