"""Keep current inbox proof in the existing required capture job and artifact."""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_active_inbox_capture_is_required_bounded_and_retained():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    steps = workflow["jobs"]["terminal-unit"]["steps"]
    indexes = {step["name"]: i for i, step in enumerate(steps) if "name" in step}
    capture_index = indexes["Capture current-source recurring inbox evidence"]
    assert indexes["Prepare Chromium for original mock captures"] < capture_index
    assert capture_index < indexes["Capture and validate evidence on this checkout"]
    capture = steps[capture_index]
    assert capture["run"] == "node e2e/tools/capture_b_f11_7_recurring_briefs.cjs --active-inbox"
    assert capture["timeout-minutes"] == 8
    assert "if" not in capture
    assert not capture.get("continue-on-error", False)
    assert capture["env"] == {
        "TERMINAL_CROP_PORT": "47284",
        "TMPDIR": "${{ runner.temp }}/terminal-ci-evidence",
    }
    artifact = steps[indexes["Retain current-checkout mock evidence and failure diagnostics"]]
    assert artifact["if"] == "always()"
    assert "${{ runner.temp }}/terminal-ci-evidence/" in artifact["with"]["path"].splitlines()
    assert "terminal/docs/pr-crops/b-f11-7-active-inbox/" in artifact["with"]["path"].splitlines()
    synthetic = steps[indexes["Check immutable evidence orchestration (synthetic)"]]
    assert "e2e/tools/briefs_inbox_capture_contract.test.cjs" in synthetic["run"].split()
