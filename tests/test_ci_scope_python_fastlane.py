"""A qualified Screener-only PR skips unrelated ingest work without faking a failed planner GREEN."""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def jobs():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]


def test_ingest_required_check_is_never_skipped_on_planner_failure():
    entries = jobs()
    ingest = entries["python"]
    assert ingest["name"] == "Ingest + signal-layer tests"
    assert ingest["needs"] == "ci-scope"
    assert ingest["if"] == "always()"
    steps = ingest["steps"]
    assert steps[0]["name"] == "Assert trusted scope; disclose omitted unrelated ingest tests"
    assert steps[0]["env"]["PLAN"] == "${{ needs.ci-scope.result }}"
    assert steps[0]["env"]["MODE"] == "${{ needs.ci-scope.outputs.mode }}"
    guard = steps[0]["run"]
    assert 'if [ "$PLAN" != "success" ]' in guard
    assert 'screener)' in guard and 'full)' in guard
    assert "invalid scope mode" in guard
    assert not steps[0].get("continue-on-error", False)


def test_all_expensive_ingest_steps_only_run_in_full_mode():
    steps = jobs()["python"]["steps"]
    assert len(steps) >= 8
    for step in steps[1:]:
        assert step["if"] == "needs.ci-scope.outputs.mode == 'full'", step
        assert step.get("continue-on-error") is None


def test_independent_postgres_suite_retained_for_full_and_merge_group():
    entries = jobs()
    investigation = entries["investigation-postgres"]
    assert investigation["needs"] == "ci-scope"
    assert investigation["if"] == "needs.ci-scope.outputs.mode == 'full'"
    planner = entries["ci-scope"]
    step = next(s for s in planner["steps"] if s.get("id") == "scope")
    assert "git show 'HEAD^1:terminal/scripts/ci/plan-e2e-scope.mjs'" in step["run"]
    assert "mode=full" in step["run"]
    assert entries["terminal"]["name"] == "Terminal typecheck + tests"
    assert entries["hub"]["name"] == "Quote Hub tests"
