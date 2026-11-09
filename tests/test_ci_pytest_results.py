"""Synthetic metadata-only controls: no production tests, services or network."""
from pathlib import Path
import json
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
from types import SimpleNamespace

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
# An isolated module instance keeps hook/unit controls from mutating the real
# reporter when this file itself runs inside the canonical Ingest suite.
_spec = importlib.util.spec_from_file_location("_safe_pytest_reporter_under_test", ROOT / "scripts/ci_pytest_results.py")
assert _spec is not None and _spec.loader is not None
safe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(safe)


def frame():
    return {"runId": "101", "runAttempt": "1", "commit": "a" * 40}


class PayloadBomb:
    outcome = "failed"
    nodeid = "tests/test_sample.py::test_case[private-parameter]"
    when = "call"
    wasxfail = False

    def __getattr__(self, name):
        raise AssertionError("forbidden report payload field " + name)


def test_projection_never_reads_or_emits_payloads_and_counts_phases():
    recorder = safe.Recorder(ROOT, frame())
    recorder.observe(PayloadBomb(), "call")
    recorder.observe(SimpleNamespace(outcome="passed", wasxfail=False), "setup")
    recorder.observe(SimpleNamespace(outcome="skipped", wasxfail="private-xfail-reason"), "call")
    row = recorder.project(1, True)
    assert row["phaseCounts"]["call"] == {"passed": 0, "failed": 1, "skipped": 1}
    assert row["phaseCounts"]["setup"]["passed"] == 1
    assert row["xfailReports"] == 1 and row["exitCode"] == 1
    assert row["failedReports"][0]["baseNodeIdSha256"] == hashlib.sha256(b"tests/test_sample.py::test_case").hexdigest()
    assert "test" not in row["failedReports"][0]
    assert "private-" not in json.dumps(row)
    assert row["countsAreReportPhasesNotDistinctTests"] is True


@pytest.mark.parametrize("nodeid", ["/private/secret.py::test", "tests/../secret.py::test", "tests/test_a.py::test[private-token]", "x" * 9000])
def test_identity_is_bounded_and_opaque_parameter_text_never_survives(nodeid):
    row = safe.identity(nodeid)
    assert "private" not in json.dumps(row)
    if ".." in nodeid or nodeid.startswith("/"):
        assert "test" not in row
    if len(nodeid) > 8192:
        assert row == {"identity": "unavailable"}


def test_failure_identity_cap_keeps_truthful_counts():
    recorder = safe.Recorder(ROOT, frame())
    for _ in range(safe.MAX_RECORDS + 2):
        recorder.observe(PayloadBomb(), "call")
    row = recorder.project()
    assert len(row["failedReports"]) == safe.MAX_RECORDS
    assert row["droppedFailedReports"] == 2
    assert row["phaseCounts"]["call"]["failed"] == safe.MAX_RECORDS + 2
    assert row["state"] == "incomplete" and row["exitCode"] is None


def test_atomic_output_and_existing_run_or_alias_refusal(tmp_path):
    output = safe.Output(tmp_path, frame())
    recorder = safe.Recorder(ROOT, frame())
    output.write(recorder.project())
    assert json.loads(output.path.read_text())["state"] == "incomplete"
    recorder.observe(PayloadBomb(), "collect")
    output.write(recorder.project(2, True))
    assert json.loads(output.path.read_text())["phaseCounts"]["collect"]["failed"] == 1
    assert list(output.directory.iterdir()) == [output.path]
    with pytest.raises(FileExistsError):
        safe.Output(tmp_path, frame())
    other = tmp_path / "outside"
    other.write_text("sentinel")
    output.path.unlink()
    output.path.symlink_to(other)
    with pytest.raises(ValueError):
        output.write(recorder.project(0, True))
    assert other.read_text() == "sentinel"


def test_output_directory_substitution_is_not_followed(tmp_path):
    output = safe.Output(tmp_path, frame())
    output.directory.rename(output.directory.with_name("old"))
    outside = tmp_path / "outside"
    outside.mkdir()
    output.directory.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        output.write({"state": "complete"})
    assert not list(outside.iterdir())


def fake_sources(tmp_path):
    for name in (".github/workflows/ci.yml", "scripts/ci_pytest_results.py", "tests/conftest.py"):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source")


def test_binding_is_exact_run_checkout_and_never_emits_other_environment(tmp_path):
    fake_sources(tmp_path)
    env = {"GITHUB_SHA": "a" * 40, "GITHUB_EVENT_NAME": "merge_group", "GITHUB_RUN_ID": "101",
           "GITHUB_RUN_ATTEMPT": "1", "GITHUB_REPOSITORY": "mastermindx-market-intelligence/mastermind-terminal",
           "GITHUB_JOB": "python", "GITHUB_WORKFLOW": "CI", "UNRELATED_SECRET": "private-secret"}
    git = lambda root, *args: "b" * 40 if args[-1] == "HEAD^{tree}" else "a" * 40
    row = safe.binding(tmp_path, env, git)
    assert row["commit"] == "a" * 40 and "private" not in json.dumps(row)
    for key, value in (("GITHUB_SHA", "c" * 40), ("GITHUB_RUN_ID", "../bad"), ("GITHUB_EVENT_NAME", "unknown")):
        with pytest.raises(ValueError):
            safe.binding(tmp_path, dict(env, **{key: value}), git)


def test_reporter_errors_do_not_change_session_exitstatus(monkeypatch):
    session = SimpleNamespace(exitstatus=1)
    recorder = safe.Recorder(ROOT, frame())
    class Unavailable:
        def write(self, row):
            raise OSError("private-secret")
    monkeypatch.setattr(safe, "_state", (recorder, Unavailable()))
    monkeypatch.setattr(safe, "binding", lambda *args: frame())
    safe.pytest_sessionfinish(session, 1)
    assert session.exitstatus == 1


@pytest.mark.parametrize("source,expected,collected", [
    ("def test_ok(): pass\n", 0, 1),
    ("def test_ok(): pass\ndef test_bad():\n print('private-stdout'); assert False, 'private-traceback'\n", 1, 2),
    ("def test_broken(: # private-source\n pass\n", 2, 0),
    ("def test_interrupt(): raise KeyboardInterrupt('private-interrupt')\n", 2, 1),
])
def test_actual_synthetic_pytest_exit_and_no_payload_retention(tmp_path, source, expected, collected):
    root = tmp_path / "repo"
    root.mkdir()
    (root / "scripts").mkdir()
    (root / "tests").mkdir()
    (root / ".github/workflows").mkdir(parents=True)
    shutil.copyfile(ROOT / "scripts/ci_pytest_results.py", root / "scripts/ci_pytest_results.py")
    (root / ".github/workflows/ci.yml").write_text("synthetic: true\n")
    (root / "tests/test_case.py").write_text(source)
    (root / "tests/conftest.py").write_text('pytest_plugins = ["scripts.ci_pytest_results"]\n')
    for args in (["init", "-q"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]):
        subprocess.run(["git", "-C", str(root), *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    temp = tmp_path / "runner"
    temp.mkdir()
    step_output = tmp_path / "step-output"
    step_output.write_text("")
    env = dict(os.environ, PYTEST_DISABLE_PLUGIN_AUTOLOAD="1", GITHUB_SHA=commit,
               GITHUB_EVENT_NAME="merge_group", GITHUB_RUN_ID="101", GITHUB_RUN_ATTEMPT="1",
               GITHUB_REPOSITORY="mastermindx-market-intelligence/mastermind-terminal",
               RUNNER_TEMP=str(temp), GITHUB_OUTPUT=str(step_output), GITHUB_JOB="python", GITHUB_WORKFLOW="CI")
    result = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q"],
                            cwd=root, env=env, capture_output=True, timeout=30)
    assert result.returncode == expected
    raw = (temp / "terminal-pytest-results/101-1/safe-results.json").read_text()
    row = json.loads(raw)
    assert row["state"] == "complete" and row["exitCode"] == expected and row["bindingStable"] is True
    assert row["binding"]["commit"] == commit
    assert row["collected"] == collected
    assert "private-" not in raw and "traceback" not in raw and "stdout" not in raw
    assert "safe_pytest_report_initialized=true\n" in step_output.read_text()
    assert "safe_pytest_file_sha256=" in step_output.read_text()


def test_workflow_preserves_selection_environment_and_always_uploads_only_initialized_result():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    job = workflow["jobs"]["python"]
    step = next(s for s in job["steps"] if s.get("id") == "ingest_tests")
    assert step["run"] == "python -m pytest tests/ -q"
    assert 'pytest_plugins = ["scripts.ci_pytest_results"]' in (ROOT / "tests/conftest.py").read_text()
    assert set(step["env"]) == {"PR_NUMBER", "GH_TOKEN"} and step["env"]["GH_TOKEN"] == ""
    assert not step.get("continue-on-error")
    upload = next(s for s in job["steps"] if s.get("name") == "Retain bounded Ingest pytest outcome")
    assert "always()" in upload["if"] and "safe_pytest_summary_ready == 'true'" in upload["if"]
    assert "safe_ingest_summary.outcome == 'success'" in upload["if"]
    assert upload["uses"] == "actions/upload-artifact@v4"
    assert upload["with"]["path"] == "${{ steps.safe_ingest_summary.outputs.safe_pytest_summary_path }}"
    validate = next(s for s in job["steps"] if s.get("id") == "safe_ingest_summary")
    assert validate["continue-on-error"] is True and validate["timeout-minutes"] == 1
    assert "always()" in validate["if"] and "safe_pytest_report_initialized" in validate["if"]


def test_stale_run_does_not_publish_initialization_flag(tmp_path, monkeypatch):
    fake_sources(tmp_path)
    temp = tmp_path / "runner"
    temp.mkdir()
    old = safe.Output(temp, frame())
    old.write({"state": "complete", "exitCode": 0})
    output = tmp_path / "step-output"
    output.write_text("")
    monkeypatch.setattr(safe, "binding", lambda *args: frame())
    monkeypatch.setenv("RUNNER_TEMP", str(temp))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("GITHUB_JOB", "python")
    monkeypatch.setenv("GITHUB_WORKFLOW", "CI")
    monkeypatch.setattr(safe, "_state", None)
    safe.pytest_configure(SimpleNamespace(rootpath=tmp_path))
    assert safe._state is None and output.read_text() == ""
    assert json.loads(old.path.read_text()) == {"state": "complete", "exitCode": 0}


def test_source_drift_is_reported_without_altering_test_exit(tmp_path, monkeypatch):
    recorder = safe.Recorder(ROOT, frame())
    output = safe.Output(tmp_path, frame())
    output.write(recorder.project())
    monkeypatch.setattr(safe, "_state", (recorder, output))
    monkeypatch.setattr(safe, "binding", lambda *args: {**frame(), "commit": "b" * 40})
    session = SimpleNamespace(exitstatus=0)
    safe.pytest_sessionfinish(session, 0)
    row = json.loads(output.path.read_text())
    assert row["exitCode"] == 0 and row["bindingStable"] is False
    assert session.exitstatus == 0


def test_other_jobs_and_local_runs_do_not_initialize_reporter(monkeypatch):
    class UnreadableConfig:
        @property
        def rootpath(self):
            raise AssertionError("must not inspect a different job")
    for job, workflow in (("terminal-unit", "CI"), ("python", "Other workflow"), ("", "")):
        monkeypatch.setenv("GITHUB_JOB", job)
        monkeypatch.setenv("GITHUB_WORKFLOW", workflow)
        safe.pytest_configure(UnreadableConfig())
        assert safe._state is None


def test_r1_generated_and_static_bases_are_hash_only_with_distinct_base_hash():
    base = "tests/test_ci_pytest_results.py::test_projection_never_reads_or_emits_payloads_and_counts_phases"
    for node in (base, base + "[private-parameter]", "tests/test_sample.py::test_case_SECRET_PARAMETER_VALUE"):
        row = safe.identity(node)
        assert "test" not in row and "SECRET_PARAMETER_VALUE" not in json.dumps(row)
        assert row["nodeIdSha256"] == hashlib.sha256(node.encode()).hexdigest()
        assert row["baseNodeIdSha256"] == hashlib.sha256(node.partition("[")[0].encode()).hexdigest()
    assert safe.identity(base)["baseNodeIdSha256"] == safe.identity(base + "[private-parameter]")["baseNodeIdSha256"]


def publication_fixture(tmp_path, monkeypatch, complete=True):
    recorder = safe.Recorder(ROOT, frame())
    output = safe.Output(tmp_path, frame())
    output.step_output = str(tmp_path / "author-step")
    Path(output.step_output).write_text("")
    output.write(recorder.project(1, True) if complete else recorder.project())
    safe.mark_snapshot(output, initialized=True)
    final_output = tmp_path / "publication-step"
    final_output.write_text("")
    env = {"RUNNER_TEMP": str(tmp_path), "GITHUB_OUTPUT": str(final_output),
           "PYTEST_DIRECTORY_DEV": str(output.directory_identity[0]),
           "PYTEST_DIRECTORY_INO": str(output.directory_identity[1]),
           "PYTEST_FILE_DEV": str(output.previous[0]), "PYTEST_FILE_INO": str(output.previous[1]),
           "PYTEST_FILE_SHA256": output.payload_sha256, "PYTEST_STEP_OUTCOME": "failure"}
    monkeypatch.setattr(safe, "binding", lambda *args: frame())
    return recorder, output, final_output, env


@pytest.mark.parametrize("complete", [True, False])
def test_finalizer_reprojects_owned_failed_or_incomplete_result_to_fresh_ready_file(tmp_path, monkeypatch, complete):
    recorder, output, step, env = publication_fixture(tmp_path, monkeypatch, complete)
    target = safe.publish_safe_summary(ROOT, env)
    assert target != output.path and target.is_file() and not target.is_symlink()
    row = json.loads(target.read_text())
    assert row["state"] == ("complete" if complete else "incomplete")
    assert row["exitCode"] == (1 if complete else None)
    assert row["stepOutcome"] == "failure"
    assert "safe_pytest_summary_ready=true\n" in step.read_text()
    assert "safe_pytest_summary_path=" + str(target) + "\n" in step.read_text()


def test_r2_directory_substitution_cannot_publish_upload_readiness(tmp_path, monkeypatch):
    _, output, step, env = publication_fixture(tmp_path, monkeypatch)
    output.directory.rename(output.directory.with_name("old"))
    outside = tmp_path / "unqualified"
    outside.mkdir()
    sentinel = outside / "safe-results.json"
    sentinel.write_text('{"captured_stdout":"private-sentinel"}')
    output.directory.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        safe.publish_safe_summary(ROOT, env)
    assert step.read_text() == "" and sentinel.read_text() == '{"captured_stdout":"private-sentinel"}'


@pytest.mark.parametrize("change", ["symlink", "replacement", "inplace", "extra_payload"])
def test_finalizer_refuses_file_alias_replacement_digest_drift_or_unapproved_json(tmp_path, monkeypatch, change):
    recorder, output, step, env = publication_fixture(tmp_path, monkeypatch)
    if change == "symlink":
        external = tmp_path / "external"
        external.write_text("private-sentinel")
        output.path.unlink()
        output.path.symlink_to(external)
    elif change == "replacement":
        body = output.path.read_bytes()
        output.path.rename(output.path.with_name("old"))
        output.path.write_bytes(body)  # Same bytes cannot borrow another inode's custody.
    elif change == "inplace":
        output.path.write_text("private-sentinel")
    else:
        # Even a producer-bound file may not add captured payload fields.
        row = recorder.project(1, True)
        row["captured_stdout"] = "private-sentinel"
        output.write(row)
        env.update(PYTEST_FILE_DEV=str(output.previous[0]), PYTEST_FILE_INO=str(output.previous[1]),
                   PYTEST_FILE_SHA256=output.payload_sha256)
    with pytest.raises((ValueError, OSError)):
        safe.publish_safe_summary(ROOT, env)
    assert step.read_text() == ""
