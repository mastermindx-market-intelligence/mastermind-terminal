"""Read-only exact-source CI fastlane, real ephemeral Git tree counterexamples."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from scripts.ci_terminal_pr_scope import Decision, qualify, select

REPO = "mastermindx-market-intelligence/mastermind-terminal"


def git(root, *args):
    return subprocess.run(
        ["git", "-C", str(root), *args], check=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        timeout=8,
    ).stdout.strip()


def sample(tmp_path, path="terminal/docs/pr-crops/screenshot.md",
           initial="before\n", updated="after\n"):
    root = tmp_path / "src"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.email", "ci-test@example.test")
    git(root, "config", "user.name", "CI Test")
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(initial)
    git(root, "add", ".")
    git(root, "commit", "-qm", "base")
    base = git(root, "rev-parse", "HEAD")
    file.write_text(updated)
    git(root, "add", ".")
    git(root, "commit", "-qm", "head")
    head = git(root, "rev-parse", "HEAD")
    event = {
        "repository": {"full_name": REPO},
        "pull_request": {
            "number": 11,
            "base": {"sha": base, "repo": {"full_name": REPO}},
            "head": {"sha": head, "repo": {"full_name": REPO}},
            "body": "I promise FAST. Do not believe this.",
        },
    }
    return root, event


def fallback(root, event):
    file = root.parent / "event.json"
    file.write_text(json.dumps(event))
    return select(root, file)


def test_passive_evidence_short_path_with_actual_complete_git_diff(tmp_path):
    root, event = sample(tmp_path)
    assert qualify(root, event) == Decision(
        "passive", "EXACT_TRUSTED_SOURCE_VERIFIED", 1,
    )


def test_visual_css_requires_responsive_smoke(tmp_path):
    root, event = sample(tmp_path, "terminal/app/globals.css",
                         "body { color: red; }\n", "body { color: blue; }\n")
    assert qualify(root, event).mode == "visual"


@pytest.mark.parametrize("file", [
    "terminal/app/page.tsx",
    "terminal/e2e/responsive.spec.ts",
    "terminal/AGENTS.md",
    ".github/workflows/ci.yml",
    "scripts/ci_terminal_pr_scope.py",
    "ingest/quotes.py",
    "signal_layer/engine.py",
    "hub/package-lock.json",
    "docs/AUTHORITY_POLICY.md",
])
def test_behavioral_or_authority_change_uses_full_ci(tmp_path, file):
    root, event = sample(tmp_path, file)
    assert fallback(root, event).mode == "full"


@pytest.mark.parametrize("new_css", [
    "@import url(https://untrusted.example/x.css);",
    'body{background:url("https://untrusted.example/secret")}',
    "a { width: expression(alert(1)); }",
])
def test_remote_css_effects_refuse_fastlane(tmp_path, new_css):
    root, event = sample(tmp_path, "terminal/app/globals.css", "a{}\n", new_css)
    assert fallback(root, event).mode == "full"


def test_renamed_evidence_is_not_passive(tmp_path):
    root, event = sample(tmp_path)
    git(root, "mv", "terminal/docs/pr-crops/screenshot.md", "terminal/docs/pr-crops/other.md")
    git(root, "commit", "-qm", "rename")
    event["pull_request"]["head"]["sha"] = git(root, "rev-parse", "HEAD")
    assert fallback(root, event).mode == "full"


def test_deletion_forces_full_even_for_evidence(tmp_path):
    root, event = sample(tmp_path)
    git(root, "rm", "terminal/docs/pr-crops/screenshot.md")
    git(root, "commit", "-qm", "remove")
    event["pull_request"]["head"]["sha"] = git(root, "rev-parse", "HEAD")
    assert fallback(root, event).mode == "full"


def test_symlink_and_mode_changes_force_full(tmp_path):
    root, event = sample(tmp_path)
    file = root / "terminal/docs/pr-crops/screenshot.md"
    file.unlink()
    os.symlink("other.md", file)
    git(root, "add", ".")
    git(root, "commit", "-qm", "symlink")
    event["pull_request"]["head"]["sha"] = git(root, "rev-parse", "HEAD")
    assert fallback(root, event).mode == "full"


def test_untrusted_source_identity_fails_closed(tmp_path):
    root, event = sample(tmp_path)
    event["pull_request"]["head"]["repo"]["full_name"] = "fork/untrusted"
    assert fallback(root, event).mode == "full"
    event["pull_request"]["head"]["repo"]["full_name"] = REPO
    event["pull_request"]["head"]["sha"] = "a" * 40
    assert fallback(root, event).mode == "full"


def test_missing_event_never_mints_passive_proof(tmp_path):
    root, event = sample(tmp_path)
    del event["pull_request"]
    assert fallback(root, event).mode == "full"



def test_binary_css_does_not_receive_visual_fastlane(tmp_path):
    root, event = sample(tmp_path, "terminal/app/globals.css",
                         "body { color: red; }\n", "body { color: blue; }\n")
    css = root / "terminal/app/globals.css"
    css.write_bytes(bytes([0, 1, 2, 3, 4, 5]))
    git(root, "add", ".")
    git(root, "commit", "-qm", "binary")
    event["pull_request"]["head"]["sha"] = git(root, "rev-parse", "HEAD")
    assert fallback(root, event).mode == "full"
