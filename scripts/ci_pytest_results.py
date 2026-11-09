"""Opt-in safe Ingest result metadata. Never reads pytest's captured payloads.

The existing tests/conftest.py registers this reporter; only CI/python enables it.
It observes, never
changes selection, reports, exceptions or exitstatus. Missing/partial output is
not a successful test result. The CI job owns one fresh run/attempt directory.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import subprocess
import tempfile

MAX_RECORDS = 1000
MAX_BYTES = 1024 * 1024
PHASES = ("setup", "call", "teardown", "collect")
OUTCOMES = ("passed", "failed", "skipped")
EVENTS = {"pull_request", "merge_group", "workflow_dispatch", "schedule", "push"}
_state = None


def _git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), *args], stderr=subprocess.DEVNULL,
        timeout=10, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_LAZY_FETCH": "1"},
    ).decode("ascii").strip()


def binding(root, env, git=_git):
    if env.get("GITHUB_JOB") != "python" or env.get("GITHUB_WORKFLOW") != "CI":
        raise ValueError("job_identity")
    commit = git(root, "rev-parse", "HEAD")
    tree = git(root, "rev-parse", "HEAD^{tree}")
    parents = git(root, "show", "-s", "--format=%P", "HEAD").split()
    if not all(re.fullmatch(r"[0-9a-f]{40}", x) for x in [commit, tree, *parents]) or len(parents) > 2:
        raise ValueError("checkout_identity")
    if env.get("GITHUB_SHA") != commit or env.get("GITHUB_EVENT_NAME") not in EVENTS:
        raise ValueError("run_checkout_binding")
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        if not re.fullmatch(r"[1-9][0-9]{0,19}", env.get(key, "")):
            raise ValueError("run_identity")
    if env.get("GITHUB_REPOSITORY") != "mastermindx-market-intelligence/mastermind-terminal":
        raise ValueError("repository_identity")
    sources = {}
    for name in (".github/workflows/ci.yml", "scripts/ci_pytest_results.py", "tests/conftest.py"):
        path = root / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
            raise ValueError("source_identity")
        sources[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"commit": commit, "tree": tree, "parents": parents,
            "runId": env["GITHUB_RUN_ID"], "runAttempt": env["GITHUB_RUN_ATTEMPT"],
            "event": env["GITHUB_EVENT_NAME"], "job": "python", "workflow": "CI", "sources": sources}


def identity(nodeid):
    if not isinstance(nodeid, str) or len(nodeid.encode("utf-8")) > 8192:
        return {"identity": "unavailable"}
    base, bracket, parameter = nodeid.partition("[")
    # Even a regex-shaped base can come from a generated collector identity.
    # Opaque base hashes can be matched to bound source without disclosing it.
    result = {"nodeIdSha256": hashlib.sha256(nodeid.encode()).hexdigest(),
              "baseNodeIdSha256": hashlib.sha256(base.encode()).hexdigest()}
    if bracket:
        result["parameterSha256"] = hashlib.sha256(parameter.encode()).hexdigest()
    return result


class Recorder:
    def __init__(self, root, frame):
        self.root, self.frame = root, frame
        self.counts = {phase: {outcome: 0 for outcome in OUTCOMES} for phase in PHASES}
        self.collected = None
        self.records = []
        self.dropped = 0
        self.xfail_reports = 0
        self.invalid_reports = 0

    def observe(self, report, phase):
        # Deliberately never touches longrepr, sections, capstdout, capstderr,
        # caplog, user_properties, exception text, traceback or fixture locals.
        outcome = report.outcome
        if not isinstance(phase, str) or not isinstance(outcome, str) or phase not in PHASES or outcome not in OUTCOMES:
            self.invalid_reports += 1
            return
        self.counts[phase][outcome] += 1
        if bool(getattr(report, "wasxfail", False)):
            self.xfail_reports += 1
        if outcome == "failed":
            if len(self.records) < MAX_RECORDS:
                self.records.append({**identity(report.nodeid), "phase": phase, "outcome": outcome})
            else:
                self.dropped += 1

    def project(self, exit_code=None, stable=None):
        return {"schema": "terminal.pytest.safe-result.v1", "binding": self.frame,
                "state": "complete" if exit_code is not None else "incomplete",
                "exitCode": exit_code, "bindingStable": stable, "collected": self.collected,
                "phaseCounts": self.counts, "xfailReports": self.xfail_reports,
                "invalidReports": self.invalid_reports, "failedReports": self.records,
                "droppedFailedReports": self.dropped, "countsAreReportPhasesNotDistinctTests": True}


class Output:
    def __init__(self, temp, frame):
        parent = Path(temp)
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("output_parent")
        base = parent / "terminal-pytest-results"
        try:
            base.mkdir(mode=0o700)
        except FileExistsError:
            pass
        info = base.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise ValueError("output_base")
        self.directory = base / (frame["runId"] + "-" + frame["runAttempt"])
        self.directory.mkdir(mode=0o700)  # Existing/unknown run ownership refuses.
        self.path = self.directory / "safe-results.json"
        self.previous = None
        info = self.directory.lstat()
        self.directory_identity = (info.st_dev, info.st_ino)

    def write(self, value):
        directory = self.directory.lstat()
        if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid()
                or directory.st_mode & 0o022
                or (directory.st_dev, directory.st_ino) != self.directory_identity):
            raise ValueError("output_directory_changed")
        payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if len(payload) > MAX_BYTES:
            raise ValueError("output_bound")
        if self.previous is not None:
            info = self.path.lstat()
            now = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
            if now != self.previous or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("output_changed")
        elif self.path.exists() or self.path.is_symlink():
            raise ValueError("output_exists")
        fd, name = tempfile.mkstemp(prefix=".safe-", dir=self.directory)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, self.path)
            info = self.path.lstat()
            self.previous = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
            self.payload_sha256 = hashlib.sha256(payload).hexdigest()
        finally:
            if os.path.lexists(name):
                os.unlink(name)  # Only the exact file created by this write.


def step_outputs(path, values):
    # Same fixed-field per-step output convention as the safe unit reporter.
    payload = "".join(key + "=" + str(value) + "\n" for key, value in values.items())
    if any("\n" in str(value) or "\r" in str(value) for value in values.values()):
        raise ValueError("step_output_shape")
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_size > MAX_BYTES:
            raise ValueError("step_output")
        data = payload.encode()
        if os.write(fd, data) != len(data):
            raise ValueError("step_output_short_write")
    finally:
        os.close(fd)


def mark_snapshot(output, initialized=False):
    values = {
        "safe_pytest_directory_dev": output.directory_identity[0],
        "safe_pytest_directory_ino": output.directory_identity[1],
        "safe_pytest_file_dev": output.previous[0],
        "safe_pytest_file_ino": output.previous[1],
        "safe_pytest_file_sha256": output.payload_sha256,
    }
    if initialized:
        values["safe_pytest_report_initialized"] = "true"
    step_outputs(output.step_output, values)


def pytest_configure(config):
    global _state
    _state = None
    if os.environ.get("GITHUB_JOB") != "python" or os.environ.get("GITHUB_WORKFLOW") != "CI":
        return
    try:
        root = Path(config.rootpath)
        frame = binding(root, os.environ)
        recorder = Recorder(root, frame)
        output = Output(os.environ["RUNNER_TEMP"], frame)
        output.write(recorder.project())
        output.step_output = os.environ["GITHUB_OUTPUT"]
        mark_snapshot(output, initialized=True)
        _state = (recorder, output)
    except Exception:
        _state = None  # Reporter failure never alters pytest exit behaviour.


def pytest_collection_finish(session):
    if _state is not None:
        _state[0].collected = len(session.items)


def pytest_runtest_logreport(report):
    if _state is not None:
        try:
            _state[0].observe(report, report.when)
        except Exception:
            _state[0].invalid_reports += 1


def pytest_collectreport(report):
    if _state is not None:
        try:
            _state[0].observe(report, "collect")
        except Exception:
            _state[0].invalid_reports += 1


def pytest_sessionfinish(session, exitstatus):
    if _state is None:
        return
    recorder, output = _state
    try:
        stable = binding(recorder.root, os.environ) == recorder.frame
        code = int(exitstatus)
        if code not in range(6):
            raise ValueError("exit_code")
        output.write(recorder.project(code, stable))
        mark_snapshot(output)
    except Exception:
        pass  # Existing incomplete artifact stays visibly incomplete.


def safe_projection(row, expected):
    """Reconstruct only authored fields; never copy arbitrary input JSON."""
    keys = {"schema", "binding", "state", "exitCode", "bindingStable", "collected",
            "phaseCounts", "xfailReports", "invalidReports", "failedReports",
            "droppedFailedReports", "countsAreReportPhasesNotDistinctTests"}
    if not isinstance(row, dict) or set(row) != keys or row["schema"] != "terminal.pytest.safe-result.v1" or row["binding"] != expected:
        raise ValueError("summary_schema")
    integer = lambda n: type(n) is int and 0 <= n <= 10**9
    if row["state"] not in {"complete", "incomplete"} or row["countsAreReportPhasesNotDistinctTests"] is not True:
        raise ValueError("summary_state")
    if row["state"] == "complete":
        if type(row["exitCode"]) is not int or row["exitCode"] not in range(6) or type(row["bindingStable"]) is not bool:
            raise ValueError("summary_exit")
    elif row["exitCode"] is not None or row["bindingStable"] is not None:
        raise ValueError("summary_incomplete")
    if row["collected"] is not None and not integer(row["collected"]):
        raise ValueError("summary_counts")
    counts = row["phaseCounts"]
    if not isinstance(counts, dict) or set(counts) != set(PHASES):
        raise ValueError("summary_counts")
    for phase in PHASES:
        if not isinstance(counts[phase], dict) or set(counts[phase]) != set(OUTCOMES) or not all(integer(n) for n in counts[phase].values()):
            raise ValueError("summary_counts")
    if not all(integer(row[key]) for key in ("xfailReports", "invalidReports", "droppedFailedReports")):
        raise ValueError("summary_counts")
    records = row["failedReports"]
    if not isinstance(records, list) or len(records) > MAX_RECORDS:
        raise ValueError("summary_records")
    projected = []
    for record in records:
        if not isinstance(record, dict) or record.get("phase") not in PHASES or record.get("outcome") != "failed":
            raise ValueError("summary_record")
        copy = {"phase": record["phase"], "outcome": "failed"}
        if record.get("identity") == "unavailable":
            if set(record) != {"identity", "phase", "outcome"}:
                raise ValueError("summary_record")
            copy["identity"] = "unavailable"
        else:
            required = {"nodeIdSha256", "baseNodeIdSha256", "phase", "outcome"}
            if set(record) not in (required, required | {"parameterSha256"}):
                raise ValueError("summary_record")
            for key in set(record) - {"phase", "outcome"}:
                if not isinstance(record[key], str) or not re.fullmatch(r"[0-9a-f]{64}", record[key]):
                    raise ValueError("summary_identity")
                copy[key] = record[key]
        projected.append(copy)
    result = {key: row[key] for key in keys - {"binding", "failedReports", "phaseCounts"}}
    result.update(binding=expected, failedReports=projected,
                  phaseCounts={phase: {outcome: counts[phase][outcome] for outcome in OUTCOMES} for phase in PHASES})
    return result


def publish_safe_summary(root, env):
    """Bounded local finalizer. No captured logs or arbitrary input paths."""
    expected = binding(root, env)
    temp = Path(env["RUNNER_TEMP"])
    directory = temp / "terminal-pytest-results" / (expected["runId"] + "-" + expected["runAttempt"])
    chain = []
    for path in (temp, directory.parent, directory):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or (path != temp and info.st_mode & 0o022):
            raise ValueError("summary_directory")
        chain.append((path, info.st_dev, info.st_ino))
    numbers = []
    for key in ("PYTEST_DIRECTORY_DEV", "PYTEST_DIRECTORY_INO", "PYTEST_FILE_DEV", "PYTEST_FILE_INO"):
        value = env.get(key, "")
        if not re.fullmatch(r"[0-9]{1,20}", value):
            raise ValueError("summary_custody")
        numbers.append(int(value))
    digest = env.get("PYTEST_FILE_SHA256", "")
    if not re.fullmatch(r"[0-9a-f]{64}", digest) or tuple(numbers[:2]) != chain[-1][1:]:
        raise ValueError("summary_custody")
    dirfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(dirfd)
        if (info.st_dev, info.st_ino) != tuple(numbers[:2]):
            raise ValueError("summary_custody")
        fd = os.open("safe-results.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1
                    or before.st_mode & 0o022 or before.st_size > MAX_BYTES
                    or (before.st_dev, before.st_ino) != tuple(numbers[2:])):
                raise ValueError("summary_file")
            payload = os.read(fd, MAX_BYTES + 1)
            after = os.fstat(fd)
            selected = os.stat("safe-results.json", dir_fd=dirfd, follow_symlinks=False)
            version = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
            if version(before) != version(after) or version(after) != version(selected):
                raise ValueError("summary_file_changed")
        finally:
            os.close(fd)
    finally:
        os.close(dirfd)
    if len(payload) > MAX_BYTES or hashlib.sha256(payload).hexdigest() != digest:
        raise ValueError("summary_file_changed")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("summary_duplicate_key")
            result[key] = value
        return result
    summary = safe_projection(json.loads(payload, object_pairs_hook=unique), expected)
    outcome = env.get("PYTEST_STEP_OUTCOME")
    if outcome not in {"success", "failure", "cancelled", "skipped"}:
        raise ValueError("summary_step_outcome")
    summary["stepOutcome"] = outcome  # Distinct from pytest's reported exit.
    for path, dev, ino in chain:
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != (dev, ino):
            raise ValueError("summary_directory_changed")
    if binding(root, env) != expected:
        raise ValueError("summary_binding_changed")
    upload = Path(tempfile.mkdtemp(prefix="terminal-pytest-upload-", dir=temp))
    info = upload.lstat()
    target = upload / "safe-summary.json"
    encoded = (json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(encoded) > MAX_BYTES:
        raise ValueError("summary_bound")
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(encoded)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise ValueError("summary_write")
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    now = upload.lstat()
    if not stat.S_ISDIR(now.st_mode) or (now.st_dev, now.st_ino) != (info.st_dev, info.st_ino):
        raise ValueError("summary_destination_changed")
    step_outputs(env["GITHUB_OUTPUT"], {"safe_pytest_summary_path": str(target), "safe_pytest_summary_ready": "true"})
    return target


if __name__ == "__main__":
    try:
        if sys.argv[1:] != ["--publish-safe-summary"]:
            raise ValueError("summary_command")
        publish_safe_summary(Path(__file__).resolve().parents[1], os.environ)
    except Exception:
        print("Safe pytest summary unavailable; no upload readiness published.")
        raise SystemExit(1)
