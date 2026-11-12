"""The existing serial owner can retain a complete ticker packet without relaxing its gate."""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_serial_capture_preserves_existing_lane_and_artifact_owner():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    job = workflow["jobs"]["terminal-e2e"]
    steps = job["steps"]
    capture = next(step for step in steps if step.get("name") == "Capture current ticker News evidence")
    ordinary = next(step for step in steps if "${{ matrix.projects }}" in step.get("run", ""))
    opt_in = next(step for step in steps if step.get("name") == "Qualify investor shell opt-in")
    assert steps.index(ordinary) < steps.index(capture) < steps.index(opt_in)
    assert capture["if"] == "matrix.shard == 'serial'"
    assert capture["timeout-minutes"] == 15
    assert not capture.get("continue-on-error", False)
    assert job["timeout-minutes"] == 60
    assert capture["env"] == {
        "CI": "1", "TERMINAL_CROPS": "1",
        "TERMINAL_TICKER_NEWS_CAPTURE_PACKET": "ticker-news",
        "TERMINAL_E2E_PORT": "${{ steps.lane.outputs.port }}",
        "PLAYWRIGHT_JSON_OUTPUT_NAME": "test-results/ticker-news-current/report.json",
    }
    command = capture["run"]
    assert command.index("--prepare") < command.index("npm run test:e2e:responsive") < command.index("--verify")
    for token in ["e2e/ticker-news.spec.ts", "--project=desktop", "--project=tablet", "--project=mobile",
                  "--workers=1", "--retries=0", "--reporter=github,json",
                  "--output=test-results/ticker-news-current/playwright"]:
        assert token in command
    assert "||" not in command
    uploads = [step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")]
    assert len(uploads) == 3
    uploader = next(step for step in uploads if step["name"] == "Upload responsive QA screenshots")
    assert uploader["with"]["path"] == "terminal/test-results"
    synthetic = next(step for step in workflow["jobs"]["terminal-unit"]["steps"]
                     if step.get("name") == "Check immutable evidence orchestration (synthetic)")
    assert "e2e/tools/ticker_news_capture_receipt.test.cjs" in synthetic["run"]
