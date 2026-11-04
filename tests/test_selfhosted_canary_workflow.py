"""The self-hosted e2e canary (.github/workflows/selfhosted-e2e-canary.yml) runs
collaborator-supplied `workflow_dispatch` inputs on a self-hosted host, so an input
must never become shell syntax (review finding on #1277). These tests pin the
contract: no workflow expression inside any `run:` block, inputs bound as env and
validated by .github/scripts/selfhosted_canary_inputs.sh against a fixed shard table
that mirrors the hosted `terminal-e2e` matrix, and metacharacters rejected with
nothing written to $GITHUB_ENV.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
CANARY_WORKFLOW = ROOT / ".github" / "workflows" / "selfhosted-e2e-canary.yml"
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
VALIDATOR = ROOT / ".github" / "scripts" / "selfhosted_canary_inputs.sh"

TABLE_LINE = re.compile(r'^\s*([a-z0-9-]+)\)\s+projects="([^"]*)"\s+;;\s*$', re.M)


def canary() -> dict[str, Any]:
    return yaml.safe_load(CANARY_WORKFLOW.read_text(encoding="utf-8"))


def run_validator(shard: str, workers: str, tmp_path: Path) -> tuple[int, str]:
    github_env = tmp_path / "github_env"
    github_env.write_text("", encoding="utf-8")
    env = {**os.environ, "CANARY_SHARD": shard, "CANARY_WORKERS": workers, "GITHUB_ENV": str(github_env)}
    proc = subprocess.run(["bash", str(VALIDATOR)], env=env, capture_output=True, text=True, timeout=30)
    return proc.returncode, github_env.read_text(encoding="utf-8")


def test_trigger_is_dispatch_only_with_read_only_token() -> None:
    wf = canary()
    assert list(wf[True].keys()) == ["workflow_dispatch"]
    assert wf["permissions"] == {"contents": "read"}
    assert set(wf[True]["workflow_dispatch"]["inputs"]) == {"shard", "workers"}


def test_no_workflow_expression_inside_any_run_block() -> None:
    offenders = [
        f"{job}: {step.get('name') or step.get('run', '')[:40]!r}"
        for job, spec in canary()["jobs"].items()
        for step in spec["steps"]
        if "run" in step and "${{" in step["run"]
    ]
    assert offenders == [], offenders


def test_inputs_are_bound_as_env_and_validated_before_use() -> None:
    job = canary()["jobs"]["canary"]
    assert job["env"]["CANARY_SHARD"] == "${{ inputs.shard }}"
    assert job["env"]["CANARY_WORKERS"] == "${{ inputs.workers }}"
    runs = [step.get("run", "") for step in job["steps"]]
    validate = next(i for i, r in enumerate(runs) if "selfhosted_canary_inputs.sh" in r)
    use = next(i for i, r in enumerate(runs) if "test:e2e:responsive" in r)
    assert validate < use
    assert '"${projects[@]}"' in runs[use] and '--workers="$CANARY_WORKERS_OK"' in runs[use]


RAW_INPUT = re.compile(r"\$\{?CANARY_(SHARD|WORKERS)\b(?!_OK)")


def test_no_run_step_touches_raw_inputs_or_eval() -> None:
    """Only the validator script may read CANARY_SHARD / CANARY_WORKERS; every run step
    uses the *_OK / CANARY_PROJECTS values it writes. `eval` is banned outright."""
    offenders = [
        f"{step.get('name') or step['run'][:40]!r}"
        for step in canary()["jobs"]["canary"]["steps"]
        if "run" in step and (RAW_INPUT.search(step["run"]) or re.search(r"\beval\b", step["run"]))
    ]
    assert offenders == [], offenders


def test_shard_table_mirrors_hosted_e2e_matrix() -> None:
    hosted = {
        entry["shard"]: " ".join(str(entry["projects"]).split())
        for entry in yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))["jobs"]["terminal-e2e"]["strategy"]["matrix"]["include"]
    }
    table = dict(TABLE_LINE.findall(VALIDATOR.read_text(encoding="utf-8")))
    assert table == hosted


@pytest.mark.parametrize("shard", ["desktop-1", "tablet-3", "serial"])
def test_valid_inputs_emit_fixed_selector(shard: str, tmp_path: Path) -> None:
    rc, written = run_validator(shard, "4", tmp_path)
    assert rc == 0
    table = dict(TABLE_LINE.findall(VALIDATOR.read_text(encoding="utf-8")))
    assert written == f"CANARY_SHARD_OK={shard}\nCANARY_PROJECTS={table[shard]}\nCANARY_WORKERS_OK=4\n"


@pytest.mark.parametrize(
    "shard",
    [
        "desktop-1; touch /tmp/pwned",
        'desktop-1" ; id ; "',
        "desktop-1 $(id)",
        "desktop-1`id`",
        "desktop-1\nid",
        "--project=desktop --shard=1/5",
        "desktop-6",
        "",
    ],
)
def test_shard_metacharacters_and_unknown_labels_are_rejected(shard: str, tmp_path: Path) -> None:
    rc, written = run_validator(shard, "1", tmp_path)
    assert rc != 0 and written == ""


@pytest.mark.parametrize("workers", ["1; id", "1 $(id)", '"1"', "-1", "0", "17", "1.5", "", "99999999999999999999", "08", "010", " 1", "0x10"])
def test_workers_must_be_bounded_integer(workers: str, tmp_path: Path) -> None:
    rc, written = run_validator("desktop-1", workers, tmp_path)
    assert rc != 0 and written == ""
