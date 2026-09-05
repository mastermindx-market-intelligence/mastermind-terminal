from __future__ import annotations

import re
from pathlib import Path


CONFIG = Path(__file__).resolve().parents[1] / "terminal" / "playwright.config.ts"


def _config_source() -> str:
    return CONFIG.read_text(encoding="utf-8")


def test_ci_retries_remain_diagnostic_but_cannot_turn_flaky_into_green() -> None:
    source = _config_source()

    assert re.search(
        r"\bretries\s*:\s*process\.env\.CI\s*\?\s*2\s*:\s*0\s*,",
        source,
    ), "CI should retain two retries as diagnostic attempts"
    assert re.search(
        r"\bfailOnFlakyTests\s*:\s*!!process\.env\.CI\s*,",
        source,
    ), (
        "CI must exit non-zero when a test passes only on retry; otherwise the "
        "required Terminal check can launder a first-attempt product failure green"
    )


def test_flaky_failure_policy_is_one_top_level_ci_gate() -> None:
    source = _config_source()

    assert source.count("failOnFlakyTests") == 1
    policy_offset = source.index("failOnFlakyTests")
    projects_offset = source.index("projects:")
    assert policy_offset < projects_offset, (
        "failOnFlakyTests must be a suite-level release policy, not a project-local exception"
    )
