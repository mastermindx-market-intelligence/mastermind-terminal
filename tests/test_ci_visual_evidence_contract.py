"""The native Node contract runs once and remains a required CI dependency."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
COMMAND = "node --test e2e/tools/visualEvidence.node-unit.cjs"
CONTRACT = ROOT / "terminal/e2e/tools/visualEvidence.node-unit.cjs"
LEGACY = ROOT / "terminal/e2e/tools/visualEvidence.test.cjs"


def workflow() -> dict[str, Any]:
    return yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())


def gate_errors(data: dict[str, Any], *, contract_exists: bool = True,
                legacy_exists: bool = False) -> list[str]:
    jobs = data["jobs"]
    owners = [(name, step) for name, job in jobs.items()
              for step in job.get("steps", [])
              if "visualEvidence.node-unit.cjs" in step.get("run", "")]
    errors = []
    if not contract_exists:
        errors.append("native contract is missing")
    if legacy_exists:
        errors.append("native contract is again discoverable as a browser test")
    if len(owners) != 1 or owners[0][0] != "terminal-unit":
        errors.append("native contract must have exactly one existing unit-job owner")
        return errors
    unit = jobs["terminal-unit"]
    step = owners[0][1]
    if step.get("run", "").strip() != COMMAND:
        errors.append("native runner must execute the complete contract and propagate failure")
    if any(owner.get("continue-on-error") or "if" in owner for owner in (unit, step)):
        errors.append("native contract must not be conditional or fail-open")
    if "matrix" in unit.get("strategy", {}):
        errors.append("native contract must not be multiplied by a unit matrix")
    directory = step.get("working-directory", unit.get("defaults", {}).get("run", {}).get("working-directory"))
    if directory != "terminal":
        errors.append("native contract must run from the terminal package")
    if "terminal-unit" not in jobs["terminal"].get("needs", []):
        errors.append("native contract must feed the existing required terminal aggregate")
    return errors


def test_the_native_contract_has_one_fail_closed_required_gate():
    assert gate_errors(workflow(), contract_exists=CONTRACT.is_file(),
                       legacy_exists=LEGACY.exists()) == []


@pytest.mark.parametrize("fault", ["missing", "duplicate", "soft-fail", "conditional",
                                  "filtered", "masked-exit", "matrix", "wrong-directory", "ungated"])
def test_a_regressed_native_contract_gate_is_rejected(fault):
    data = deepcopy(workflow())
    unit = data["jobs"]["terminal-unit"]
    step = next(s for s in unit["steps"] if s.get("run") == COMMAND)
    if fault == "missing":
        unit["steps"].remove(step)
    elif fault == "duplicate":
        unit["steps"].append(deepcopy(step))
    elif fault == "soft-fail":
        step["continue-on-error"] = True
    elif fault == "conditional":
        step["if"] = "false"
    elif fault == "filtered":
        step["run"] = COMMAND.replace("node --test", "node --test --test-name-pattern=all30")
    elif fault == "masked-exit":
        step["run"] = COMMAND + " || true"
    elif fault == "matrix":
        unit["strategy"] = {"matrix": {"copy": [1, 2]}}
    elif fault == "wrong-directory":
        step["working-directory"] = "."
    elif fault == "ungated":
        data["jobs"]["terminal"]["needs"].remove("terminal-unit")
    assert gate_errors(data), fault


def test_missing_or_accidentally_rediscovered_source_is_rejected():
    assert gate_errors(workflow(), contract_exists=False)
    assert gate_errors(workflow(), legacy_exists=True)
