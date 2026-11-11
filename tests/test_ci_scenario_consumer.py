"""The broad Python job also qualifies the actual TypeScript Scenario consumer.

Keep its pinned Terminal runtime/dependencies before collection, while leaving
PostgreSQL's fail-closed binary gate and the actual HTTP/PG qualification intact.
"""
from copy import deepcopy
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def ingest_steps():
    return yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())["jobs"]["python"]["steps"]


def assert_consumer_runtime(steps):
    pytest_index = next(i for i, s in enumerate(steps) if s.get("run") == "python -m pytest tests/ -q")
    node_index = next((i for i, s in enumerate(steps) if s.get("uses") == "actions/setup-node@v4"
                       and str(s.get("with", {}).get("node-version")) == "20"
                       and s["with"].get("cache-dependency-path") == "terminal/package-lock.json"), None)
    install_index = next((i for i, s in enumerate(steps) if s.get("run") == "npm ci"
                          and s.get("working-directory") == "terminal"), None)
    assert node_index is not None, "Scenario HTTP consumer needs the pinned Terminal Node runtime"
    assert install_index is not None, "Scenario HTTP consumer needs the exact Terminal lockfile dependencies"
    assert node_index < install_index < pytest_index, "consumer runtime must exist before the Python qualification"
    assert any("command -v initdb" in s.get("run", "") and "command -v psql" in s["run"]
               for s in steps[:pytest_index]), "the PostgreSQL fail-closed binary gate must remain"


def test_ingest_has_actual_consumer_runtime_before_qualification():
    assert_consumer_runtime(ingest_steps())


@pytest.mark.parametrize("mutation", ["missing_node", "missing_dependencies", "late_dependencies"])
def test_runtime_guard_rejects_incomplete_or_late_setup(mutation):
    steps = deepcopy(ingest_steps())
    if mutation == "missing_node":
        steps = [s for s in steps if not s.get("uses", "").startswith("actions/setup-node@")]
    else:
        installs = [s for s in steps if s.get("run") == "npm ci" and s.get("working-directory") == "terminal"]
        steps = [s for s in steps if s not in installs]
        if mutation == "late_dependencies":
            steps.extend(installs)
    with pytest.raises(AssertionError):
        assert_consumer_runtime(steps)
