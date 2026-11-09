"""The self-hosted e2e canary (.github/workflows/selfhosted-e2e-canary.yml) runs
collaborator-supplied `workflow_dispatch` inputs on a self-hosted host, so an input
must never become shell syntax (review finding on #1277). These tests pin the
contract: no workflow expression inside any `run:` block, inputs bound as env and
validated by .github/scripts/selfhosted_canary_inputs.sh against a fixed shard table
that mirrors the hosted `terminal-e2e` matrix, and metacharacters rejected with
nothing written to $GITHUB_ENV.
"""
from __future__ import annotations

import copy
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
    admission = canary()["jobs"]["admit"]
    assert admission["env"]["CANARY_SHARD"] == "${{ inputs.shard }}"
    assert admission["env"]["CANARY_WORKERS"] == "${{ inputs.workers }}"
    runs = [step.get("run", "") for step in admission["steps"]]
    validate = next(i for i, run in enumerate(runs) if "selfhosted_canary_inputs.sh" in run)
    release = next(i for i, step in enumerate(admission["steps"]) if step.get("id") == "release")
    assert validate < release
    job = canary()["jobs"]["canary"]
    assert job["env"]["CANARY_PROJECTS"] == "${{ needs.admit.outputs.projects }}"
    assert job["env"]["CANARY_WORKERS_OK"] == "${{ needs.admit.outputs.workers }}"
    runs = [step.get("run", "") for step in job["steps"]]
    use = next(run for run in runs if "test:e2e:responsive" in run)
    assert '"${projects[@]}"' in use and '--workers="$CANARY_WORKERS_OK"' in use
    assert not any("selfhosted_canary_inputs.sh" in run for run in runs)


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
    # The CI workflow now evaluates the dynamic, protected-parent scope selector.
    # Compare the canary against the complete FULL matrix that selector emits,
    # while also proving CI still consumes the selector's output rather than an
    # unrelated/hand-edited matrix. This cannot be reduced by a focused PR.
    from scripts.ci_e2e_scope import FULL_MATRIX

    workflow = yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))
    browser = workflow["jobs"]["terminal-e2e"]
    assert browser["needs"] == ["pr_scope", "e2e-scope"]
    assert browser["strategy"]["matrix"] == "${{ fromJSON(needs.e2e-scope.outputs.matrix) }}"
    assert "scripts/ci_e2e_scope.py" in workflow["jobs"]["e2e-scope"]["steps"][-1]["run"]
    hosted = {
        entry["shard"]: " ".join(str(entry["projects"]).split())
        for entry in FULL_MATRIX
    }
    assert len(hosted) == len(FULL_MATRIX) == 15
    assert all(entry["specs"] == "" for entry in FULL_MATRIX)
    table = dict(TABLE_LINE.findall(VALIDATOR.read_text(encoding="utf-8")))
    assert table == hosted


@pytest.mark.parametrize("shard", ["desktop-1", "desktop-6", "tablet-3", "tablet-4", "serial", "serial-standalone"])
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
        "desktop-7",
        "tablet-5",
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


TRUSTED_SHA = "a" * 40
SOURCE_CONTEXT = {
    "CANARY_REPOSITORY": "mastermindx-market-intelligence/mastermind-terminal",
    "CANARY_EVENT": "workflow_dispatch",
    "CANARY_REF_TYPE": "branch",
    "CANARY_REF": "refs/heads/master",
    "CANARY_REF_PROTECTED": "true",
    "CANARY_WORKFLOW_REF": (
        "mastermindx-market-intelligence/mastermind-terminal/"
        ".github/workflows/selfhosted-e2e-canary.yml@refs/heads/master"
    ),
    "CANARY_EVENT_SHA": TRUSTED_SHA,
    "CANARY_WORKFLOW_SHA": TRUSTED_SHA,
}
ADMISSION_IF = (
    "needs.admit.result == 'success' && "
    "needs.admit.outputs.admitted == 'true' && "
    "needs.admit.outputs.sha == github.sha"
)


def assert_admission_wiring(wf: dict[str, Any]) -> None:
    jobs = wf["jobs"]
    assert "admit" in jobs, "hosted admission must exist before self-hosted allocation"
    admission, job = jobs["admit"], jobs["canary"]
    assert admission["runs-on"] == "ubuntu-latest"
    assert admission["timeout-minutes"] <= 5
    assert job.get("needs") == "admit"
    assert " ".join(job.get("if", "").split()) == ADMISSION_IF
    assert set(jobs) == {"admit", "canary"}
    assert job["runs-on"] == ["self-hosted", "linux", "x64", "ubuntu0-canary"]
    steps = admission["steps"]
    assert steps[0].get("id") == "source"
    expected_context = {
        "CANARY_REPOSITORY": "${{ github.repository }}",
        "CANARY_EVENT": "${{ github.event_name }}",
        "CANARY_REF_TYPE": "${{ github.ref_type }}",
        "CANARY_REF": "${{ github.ref }}",
        "CANARY_REF_PROTECTED": "${{ github.ref_protected }}",
        "CANARY_WORKFLOW_REF": "${{ github.workflow_ref }}",
        "CANARY_EVENT_SHA": "${{ github.sha }}",
        "CANARY_WORKFLOW_SHA": "${{ github.workflow_sha }}",
    }
    assert steps[0]["env"] == expected_context
    checkouts = [step for step in steps if step.get("uses", "").startswith("actions/checkout@")]
    assert len(checkouts) == 1 and steps.index(checkouts[0]) == 1
    assert checkouts[0]["with"] == {
        "ref": "${{ github.sha }}", "persist-credentials": False
    }
    validator = [i for i, step in enumerate(steps)
                 if "selfhosted_canary_inputs.sh" in step.get("run", "")]
    assert len(validator) == 1
    releases = [i for i, step in enumerate(steps) if step.get("id") == "release"]
    assert len(releases) == 1 and validator[0] < releases[0]
    assert steps[releases[0]].get("if", "success()") == "success()"
    assert steps[releases[0]]["env"]["CANARY_SHA"] == "${{ steps.source.outputs.sha }}"
    assert admission["outputs"] == {
        key: "${{ steps.release.outputs." + key + " }}"
        for key in ("admitted", "sha", "shard", "projects", "workers")
    }
    host_checkouts = [step for step in job["steps"]
                      if step.get("uses", "").startswith("actions/checkout@")]
    assert len(host_checkouts) == 1
    assert host_checkouts[0]["with"] == {
        "ref": "${{ github.sha }}", "persist-credentials": False
    }
    assert job["env"] == {
        "CI": "1",
        "CANARY_SHARD_OK": "${{ needs.admit.outputs.shard }}",
        "CANARY_PROJECTS": "${{ needs.admit.outputs.projects }}",
        "CANARY_WORKERS_OK": "${{ needs.admit.outputs.workers }}",
    }
    assert "inputs." not in str(job)


def test_selfhosted_allocation_waits_for_trusted_admission() -> None:
    assert_admission_wiring(canary())


@pytest.mark.parametrize("mutation", [
    "no-needs", "unconditional", "floating-checkout", "raw-host-input",
    "selfhosted-admission", "checkout-before-source", "late-validation",
    "hosted-output-checkout", "selfhosted-output-checkout",
])
def test_admission_wiring_mutations_are_rejected(mutation: str) -> None:
    wf = copy.deepcopy(canary())
    job, admission = wf["jobs"]["canary"], wf["jobs"]["admit"]
    if mutation == "no-needs":
        job.pop("needs")
    elif mutation == "unconditional":
        job["if"] = "always()"
    elif mutation == "floating-checkout":
        next(step for step in job["steps"]
             if step.get("uses", "").startswith("actions/checkout@"))["with"]["ref"] = "master"
    elif mutation == "hosted-output-checkout":
        admission["steps"][1]["with"]["ref"] = '${{ steps.source.outputs.sha }}'
    elif mutation == "selfhosted-output-checkout":
        next(step for step in job["steps"]
             if step.get("uses", "").startswith("actions/checkout@"))["with"]["ref"] = '${{ needs.admit.outputs.sha }}'
    elif mutation == "raw-host-input":
        job["env"]["CANARY_WORKERS"] = "${{ inputs.workers }}"
    elif mutation == "selfhosted-admission":
        admission["runs-on"] = job["runs-on"]
    elif mutation == "checkout-before-source":
        admission["steps"][0], admission["steps"][1] = admission["steps"][1], admission["steps"][0]
    else:
        validator = next(step for step in admission["steps"]
                         if "selfhosted_canary_inputs.sh" in step.get("run", ""))
        admission["steps"].remove(validator)
        job["steps"].append(validator)
    with pytest.raises(AssertionError):
        assert_admission_wiring(wf)


def run_hosted_admission(
    tmp_path: Path, *, context: dict[str, str] | None = None,
    shard: str = "desktop-1", workers: str = "1",
) -> tuple[int, str, str]:
    """Execute the actual source gate, validator and publication shell blocks.

    Checkout and GitHub scheduling are checked structurally above; no checkout,
    host registration, workflow dispatch or self-hosted process is performed.
    """
    steps = canary()["jobs"]["admit"]["steps"]
    source = next(step for step in steps if step.get("id") == "source")
    release = next(step for step in steps if step.get("id") == "release")
    source_out, result_out, github_env = (
        tmp_path / name for name in ("source_output", "admission_output", "github_env")
    )
    for path in (source_out, result_out, github_env):
        path.write_text("", encoding="utf-8")
    env = {
        **os.environ, **SOURCE_CONTEXT, **(context or {}),
        "CANARY_SHARD": shard, "CANARY_WORKERS": workers,
        "GITHUB_OUTPUT": str(source_out), "GITHUB_ENV": str(github_env),
    }
    proc = subprocess.run(["bash", "-euo", "pipefail", "-c", source["run"]],
                          env=env, cwd=ROOT, capture_output=True, text=True, timeout=30)
    if proc.returncode:
        return proc.returncode, result_out.read_text(), source_out.read_text()
    source_values = dict(line.split("=", 1) for line in source_out.read_text().splitlines())
    proc = subprocess.run(["bash", str(VALIDATOR)], env=env, cwd=ROOT,
                          capture_output=True, text=True, timeout=30)
    if proc.returncode:
        return proc.returncode, result_out.read_text(), source_out.read_text()
    env.update(dict(line.split("=", 1) for line in github_env.read_text().splitlines()))
    env.update(CANARY_SHA=source_values["sha"], GITHUB_OUTPUT=str(result_out))
    proc = subprocess.run(["bash", "-euo", "pipefail", "-c", release["run"]],
                          env=env, cwd=ROOT, capture_output=True, text=True, timeout=30)
    return proc.returncode, result_out.read_text(), source_out.read_text()


@pytest.mark.parametrize("context", [
    {"CANARY_REPOSITORY": "someone/mastermind-terminal"},
    {"CANARY_REPOSITORY": "Mastermindx-market-intelligence/mastermind-terminal"},
    {"CANARY_EVENT": "push"}, {"CANARY_EVENT": "pull_request"},
    {"CANARY_REF_TYPE": "tag"}, {"CANARY_REF": "refs/tags/master"},
    {"CANARY_REF": "refs/heads/feature"}, {"CANARY_REF": "refs/heads/Master"},
    {"CANARY_REF_PROTECTED": "false"}, {"CANARY_REF_PROTECTED": "True"},
    {"CANARY_WORKFLOW_REF": SOURCE_CONTEXT["CANARY_WORKFLOW_REF"].replace("master", "feature")},
    {"CANARY_WORKFLOW_REF": SOURCE_CONTEXT["CANARY_WORKFLOW_REF"].replace("selfhosted-e2e-canary.yml", "other.yml")},
    {"CANARY_EVENT_SHA": ""}, {"CANARY_EVENT_SHA": "a" * 39},
    {"CANARY_EVENT_SHA": "a" * 41}, {"CANARY_EVENT_SHA": "z" * 40},
    {"CANARY_EVENT_SHA": "A" * 40},
    {"CANARY_WORKFLOW_SHA": "b" * 40},
])
def test_untrusted_source_cannot_publish_any_admission_output(
    context: dict[str, str], tmp_path: Path,
) -> None:
    rc, admitted, source = run_hosted_admission(tmp_path, context=context)
    assert rc != 0 and admitted == "" and source == ""


@pytest.mark.parametrize(("shard", "workers"), [
    ("desktop-7", "1"), ("desktop-1; id", "1"),
    ("desktop-1\nid", "1"), ("--project=desktop --shard=1/5", "1"),
    ("desktop-1", "0"), ("desktop-1", "17"), ("desktop-1", "08"),
    ("desktop-1", "99999999999999999999"), ("desktop-1", "1 $(id)"),
])
def test_invalid_inputs_never_publish_selfhosted_admission(
    shard: str, workers: str, tmp_path: Path,
) -> None:
    rc, admitted, source = run_hosted_admission(tmp_path, shard=shard, workers=workers)
    assert rc != 0 and admitted == ""
    assert source == f"sha={TRUSTED_SHA}\n"


@pytest.mark.parametrize(("shard", "workers"), [
    ("desktop-1", "1"), ("desktop-6", "1"), ("tablet-3", "4"), ("serial", "16"),
    ("serial-standalone", "4"),
])
def test_valid_admission_binds_fixed_inputs_and_same_immutable_sha(
    shard: str, workers: str, tmp_path: Path,
) -> None:
    rc, admitted, source = run_hosted_admission(tmp_path, shard=shard, workers=workers)
    table = dict(TABLE_LINE.findall(VALIDATOR.read_text(encoding="utf-8")))
    assert rc == 0
    assert source == f"sha={TRUSTED_SHA}\n"
    assert admitted == (
        f"admitted=true\nsha={TRUSTED_SHA}\nshard={shard}\n"
        f"projects={table[shard]}\nworkers={workers}\n"
    )
