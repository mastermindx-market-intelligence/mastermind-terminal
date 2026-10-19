"""Fail-closed guarantee: the default-off investor shell receives real hosted e2e proof.

No second workflow, runner, release job, preview identity, or access path.
The existing terminal-e2e serial shard supplies the exact three-viewport proof.
"""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "ci.yml"


def steps():
    workflow = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))
    return workflow["jobs"]["terminal-e2e"]["steps"], workflow


def preview_step():
    job_steps, _ = steps()
    found = [step for step in job_steps if step.get("name") == "Qualify investor shell opt-in"]
    assert len(found) == 1, "exactly one real investor preview proof step is required"
    return found[0]


def test_serial_shard_only_runs_preview_after_ordinary_e2e():
    all_steps, _ = steps()
    step = preview_step()
    assert step.get("if") == "matrix.shard == 'serial'"
    index = all_steps.index(step)
    ordinary = [i for i, s in enumerate(all_steps) if "test:e2e:responsive -- ${{ matrix.projects }}" in str(s.get("run", ""))]
    uploads = [i for i, s in enumerate(all_steps) if s.get("name") == "Upload responsive QA screenshots"]
    assert len(ordinary) == len(uploads) == 1
    assert ordinary[0] < index < uploads[0]


def test_private_opt_in_is_step_local_and_cannot_succeed_on_skips():
    step = preview_step()
    env = step.get("env", {})
    assert env.get("MMX_INVESTOR_SHELL_PREVIEW") == "1"
    assert env.get("CI") == "1"
    assert env.get("TERMINAL_E2E_PORT") == "31991"
    assert "continue-on-error" not in step
    assert not any(k.startswith("NEXT_PUBLIC_") for k in env)
    all_steps, workflow = steps()
    assert "MMX_INVESTOR_SHELL_PREVIEW" not in workflow["jobs"]["terminal-e2e"].get("env", {})
    assert all("MMX_INVESTOR_SHELL_PREVIEW" not in other.get("env", {}) for other in all_steps if other.get("name") != "Qualify investor shell opt-in")


def test_proof_uses_all_three_viewports_and_a_fresh_server_without_retry():
    run = str(preview_step()["run"]).split()
    assert "e2e/investor-shell-preview.spec.ts" in run
    assert {f"--project={p}" for p in ("desktop", "tablet", "mobile")} <= set(run)
    assert "--workers=1" in run
    assert "--retries=0" in run
    assert "--output=test-results/investor-shell-preview" in run
    assert not any("||" in part or "exit=0" in part for part in run)


def test_hosted_proof_remains_required_under_frozen_aggregate():
    _, workflow = steps()
    jobs = workflow["jobs"]
    assert jobs["terminal"]["name"] == "Terminal typecheck + tests"
    assert "terminal-e2e" in jobs["terminal"]["needs"]
    assert jobs["terminal-e2e"]["strategy"]["fail-fast"] is False


def test_preview_test_file_itself_does_not_fake_an_unset_flag():
    text = (ROOT / "terminal/e2e/investor-shell-preview.spec.ts").read_text(encoding="utf-8")
    assert 'test.skip(process.env.MMX_INVESTOR_SHELL_PREVIEW !== "1"' in text
    assert 'if (process.env.MMX_INVESTOR_SHELL_PREVIEW === "1" && !process.env.CI)' in text
