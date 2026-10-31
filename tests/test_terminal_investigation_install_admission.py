"""Fail-closed Investigation candidate installation admission (IW2 cutover-0030).

This suite never contacts production, never runs the installer main, never
talks to a real systemd manager and never reads a real /proc process entry.
It extracts the exact inline verifier from the incumbent deploy owner into a
non-main namespace, injects fake git/unit/manager/filesystem/proc readers as
ordinary test dependencies, and drives the pure classification against
meaningful fake process and configuration fixtures. The bash-level cases run
the real library hooks against tiny local Git fixtures with a PATH shim for
systemctl only.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "ops" / "terminal-build.sh"
PRIMITIVE = "terminal/lib/investigationApiAdmission.ts"

OLD_SHA = "1" * 40
NEW_SHA = "2" * 40
TREE_SHA = "3" * 40
MAIN_PID = 4200
SHIM_PID = 4201
SERVER_PID = 4202
UNIT_CGROUP = "/system.slice/terminal.service"
PACKAGE_JSON = b'{"scripts":{"start":"next start"}}\n'
PROD_CLOSED_ENV = '"NODE_ENV=production" "INVESTIGATION_API_ADMISSION=closed"'
PROD_OPEN_ENV = '"NODE_ENV=production" "INVESTIGATION_API_ADMISSION=open"'
EXEC_START_NPM = "{ path=/usr/bin/npm ; argv[]=/usr/bin/npm run start ; ignore_errors=no ; }"
EXEC_START_NEXT = (
    "{ path=/usr/bin/env ; argv[]=/usr/bin/env node "
    "node_modules/next/dist/bin/next start --port 3001 --hostname 127.0.0.1 ; "
    "ignore_errors=no ; }"
)


# ── extraction of the exact inline verifier under a non-main namespace ──────
def _library_text() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def _main_body(*, code_only: bool = False) -> str:
    text = SCRIPT.read_text(encoding="utf-8")
    body = text[text.rindex('if [ "${BASH_SOURCE[0]}" != "$0" ]') :]
    if code_only:
        body = "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )
    return body


@pytest.fixture()
def verifier():
    text = _library_text()
    marker = "<<'PY_INVESTIGATION_INSTALL'"
    start = text.index(marker) + len(marker) + 1
    end = text.index("\nPY_INVESTIGATION_INSTALL\n", start)
    body = text[start:end]
    assert 'if __name__ == "__main__":' in body, (
        "the extracted verifier must keep its main guard so the test namespace "
        "never executes production main"
    )
    namespace = {"__name__": "terminal_investigation_install_under_test"}
    exec(compile(body, "<extracted investigation verifier>", "exec"), namespace)
    return namespace


# ── fake hosts ───────────────────────────────────────────────────────────────
class FakeGitHost:
    """Fake git/unit/manager readers. Every call is recorded."""

    def __init__(
        self,
        *,
        tree_listing: bytes = b"",
        object_kind: str | None = "commit",
        unit: dict[str, str] | None = None,
        manager: str = "",
        package: bytes = PACKAGE_JSON,
        installed_package: bytes = PACKAGE_JSON,
    ):
        self.git_calls: list[list[str]] = []
        self.unit_calls: list[str] = []
        self.tree_listing = tree_listing
        self.object_kind = object_kind
        self.unit = unit or {}
        self.manager = manager
        self.package = package
        self.installed_package = installed_package

    def install(self, ns) -> FakeGitHost:
        host = self

        def run_git(repository, arguments, failure_code):
            host.git_calls.append(list(arguments))
            if arguments[:2] == ["cat-file", "-t"]:
                if host.object_kind is None:
                    raise ns["Refused"](failure_code)
                return (host.object_kind + "\n").encode()
            if arguments[:2] == ["ls-tree", "-r"]:
                if host.tree_listing is None:
                    raise ns["Refused"](failure_code)
                return host.tree_listing
            if arguments[:2] == ["cat-file", "blob"]:
                return host.package
            raise AssertionError(f"unexpected git call {arguments}")

        def unit_property(unit_name, prop):
            host.unit_calls.append(prop)
            if prop not in host.unit:
                raise ns["Refused"]("unit-inspection-unavailable")
            return host.unit[prop]

        def manager_environment():
            host.unit_calls.append("manager-environment")
            return host.manager

        ns["installed_package_json"] = lambda app: host.installed_package
        ns["run_git"] = run_git
        ns["unit_property"] = unit_property
        ns["manager_environment"] = manager_environment
        return self


def tree_listing_for(entries: dict[str, str]) -> bytes:
    payload = b""
    for path, mode in entries.items():
        oid = hashlib.sha1(path.encode()).hexdigest()
        payload += f"{mode} blob {oid}\t{path}\0".encode()
    return payload


def closed_prod_unit(**overrides) -> dict[str, str]:
    unit = {
        "LoadState": "loaded", "NeedDaemonReload": "no", "ActiveState": "active",
        "WorkingDirectory": "/opt/terminal/terminal", "ControlGroup": UNIT_CGROUP,
        "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStopPost": "", "RootDirectory": "", "RootImage": "", "PAMName": "",
        "Environment": PROD_CLOSED_ENV,
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
    }
    unit.update(overrides)
    return unit


def closed_beta_unit(env_file: str, **overrides) -> dict[str, str]:
    unit = {
        "LoadState": "loaded", "NeedDaemonReload": "no", "ActiveState": "active",
        "WorkingDirectory": "/opt/terminal/beta/terminal", "ControlGroup": "/system.slice/terminal-beta.service",
        "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStopPost": "", "RootDirectory": "", "RootImage": "", "PAMName": "",
        "Environment": '"MMX_SHARED_SHELL=1" "PORT=3001"',
        "EnvironmentFiles": f"{env_file} (ignore_errors=no)",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NEXT,
    }
    unit.update(overrides)
    return unit


def fake_stat(pid: int, comm: str, ppid: int, starttime: int = 12345) -> str:
    # /proc/<pid>/stat tail after "(comm)": state(3) ppid(4) ... starttime(22).
    fields = ["S", str(ppid)] + ["0"] * 17 + [str(starttime)]
    return f"{pid} ({comm}) " + " ".join(fields)


def install_proc_fakes(ns, procs: dict[int, dict], app_identity) -> None:
    def payload(pid: int, key: str):
        entry = procs.get(pid)
        if entry is None or key not in entry:
            raise ns["Refused"]("serving-process-unreadable")
        return entry[key]

    def proc_bytes(pid, name, limit):
        blob = payload(pid, name)
        data = blob.encode() if isinstance(blob, str) else blob
        if len(data) > limit:
            raise ns["Refused"]("serving-process-environment-oversized")
        return data

    def stat_fields(pid):
        fields = proc_bytes(pid, "stat", 4096).decode("utf-8", "replace")
        tail = fields.rpartition(")")[2].split()
        assert len(tail) >= 20, f"fake stat for {pid} is malformed"
        return tail

    def proc_starttime(pid):
        return stat_fields(pid)[19]

    def proc_ppid(pid):
        return int(stat_fields(pid)[1])

    def proc_comm(pid):
        return proc_bytes(pid, "comm", 256).decode().strip("\n")

    def proc_cmdline(pid):
        return [item for item in payload(pid, "cmdline")]

    def proc_cgroup_path(pid):
        return payload(pid, "cgroup")

    def proc_children(pid):
        return list(payload(pid, "children"))

    def proc_cwd_identity(pid):
        return payload(pid, "cwd")

    ns["proc_bytes"] = proc_bytes
    ns["proc_starttime"] = proc_starttime
    ns["proc_ppid"] = proc_ppid
    ns["proc_comm"] = proc_comm
    ns["proc_cmdline"] = proc_cmdline
    ns["proc_cgroup_path"] = proc_cgroup_path
    ns["proc_children"] = proc_children
    ns["proc_cwd_identity"] = proc_cwd_identity
    ns["app_root_identity"] = lambda app_root: SimpleNamespace(
        st_dev=app_identity[0], st_ino=app_identity[1]
    )


def serving_fixture(
    *, environ=b"INVESTIGATION_API_ADMISSION=closed\0NODE_ENV=production\0"
) -> dict[int, dict]:
    cwd = SimpleNamespace(st_dev=7, st_ino=99)
    npm_chain = {
        MAIN_PID: {
            "cmdline": ["/usr/bin/npm", "run", "start"],
            "stat": fake_stat(MAIN_PID, "npm", 1),
            "comm": "npm",
            "cgroup": UNIT_CGROUP,
            "children": [SHIM_PID],
            "environ": environ,
            "cwd": cwd,
        },
        SHIM_PID: {
            "cmdline": ["/bin/sh", "-c", "next start"],
            "stat": fake_stat(SHIM_PID, "sh", MAIN_PID),
            "comm": "sh",
            "cgroup": UNIT_CGROUP,
            "children": [SERVER_PID],
            "environ": environ,
            "cwd": cwd,
        },
        SERVER_PID: {
            "cmdline": [
                "/usr/bin/node",
                "node_modules/next/dist/bin/next",
                "start",
            ],
            "stat": fake_stat(SERVER_PID, "next-server (v15)", SHIM_PID),
            "comm": "next-server (v15)",
            "cgroup": UNIT_CGROUP,
            "children": [],
            "environ": environ,
            "cwd": cwd,
        },
    }
    return npm_chain


def primitive_entry(path: str = PRIMITIVE, mode: str = "100644") -> bytes:
    return tree_listing_for({path: mode})


# ── trigger decisions (fake git) ─────────────────────────────────────────────
def _decide(ns, host, phase="prestart", revision=NEW_SHA, app=None,
            unit_name="terminal", env_dir="/tmp", profile="production", capsys=None):
    host.install(ns)
    captured = capsys
    decision = ns["main"](
        [str(app or "/opt/terminal/terminal"), revision, phase, str(app or "."),
         unit_name, env_dir, profile]
    )
    return decision


def test_old_target_decision_never_inspects_the_unit(verifier, capsys):
    host = FakeGitHost(tree_listing=tree_listing_for(
        {"terminal/lib/other.ts": "100644"}))
    host.install(verifier)
    assert verifier["main"](
        ["/opt/terminal/terminal", NEW_SHA, "prestart", "/opt/terminal/terminal",
         "terminal", "/tmp", "production"]) == 0
    assert capsys.readouterr().out.strip() == "old-target"
    assert host.unit_calls == [], (
        "an old target must keep incumbent behavior with zero unit inspection"
    )
    assert host.git_calls == [["cat-file", "-t", NEW_SHA], ["ls-tree", "-r", "-z", NEW_SHA]], host.git_calls


def test_primitive_requires_a_regular_blob_entry(verifier):
    host = FakeGitHost(tree_listing=primitive_entry(mode="120000"))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "primitive-not-a-regular-blob"

    host = FakeGitHost(tree_listing=primitive_entry(mode="160000"))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "primitive-not-a-regular-blob"


def test_non_commit_identity_carrying_the_path_is_a_refusal(verifier):
    host = FakeGitHost(tree_listing=primitive_entry(), object_kind="tree")
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "target-identity-unresolvable"


def test_unreadable_tree_is_a_refusal_not_an_old_target(verifier):
    host = FakeGitHost(tree_listing=None)
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "target-tree-unreadable"


def test_oversized_tree_inventory_is_a_refusal(verifier):
    ns = verifier
    ns["MAX_TREE_LIST_BYTES"] = 16
    host = FakeGitHost(tree_listing=primitive_entry())
    host.install(ns)
    with pytest.raises(ns["Refused"]) as raised:
        ns["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                    "/tmp", "production"])
    assert raised.value.code == "target-tree-oversized"


def test_malformed_verifier_invocation_is_refused(verifier):
    host = FakeGitHost(tree_listing=primitive_entry())
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart"])
    assert raised.value.code == "verifier-invocation-invalid"
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "someday", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "verifier-invocation-invalid"


# ── explicit closed classification ───────────────────────────────────────────
def test_explicit_unit_closed_is_admitted_prestart_and_poststart(
    verifier, capsys, tmp_path
):
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(
            ActiveState="active", MainPID=str(MAIN_PID)),
    )
    procs = serving_fixture()
    install_proc_fakes(verifier, procs, (7, 99))
    host.install(verifier)
    assert verifier["main"](
        ["/opt/terminal/terminal", NEW_SHA, "prestart",
         str(tmp_path), "terminal", str(tmp_path), "production"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"

    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    host.install(verifier)
    assert verifier["main"](
        ["/opt/terminal/terminal", NEW_SHA, "poststart",
         str(tmp_path), "terminal", str(tmp_path), "production"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"


def test_inactive_unit_with_qualified_config_passes_prestart_only(
    verifier, capsys
):
    host = FakeGitHost(tree_listing=primitive_entry(),
                       unit=closed_prod_unit())
    host.install(verifier)
    assert verifier["main"](
        ["/app", NEW_SHA, "prestart", "/app", "terminal", "/tmp",
         "production"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"

    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="inactive"),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "service-not-active"


@pytest.mark.parametrize(
    ("environment", "expected"),
    [
        ('"NODE_ENV=production"', "missing-explicit-closed"),
        ('"NODE_ENV=production" "INVESTIGATION_API_ADMISSION=open"',
         "unit-admission-not-closed"),
        ('"INVESTIGATION_API_ADMISSION=CLOSED"', "unit-admission-not-closed"),
        ('"INVESTIGATION_API_ADMISSION=closed "', "unit-admission-not-closed"),
        ('"INVESTIGATION_API_ADMISSION="', "unit-admission-not-closed"),
        ("INVESTIGATION_API_ADMISSION", "malformed-admission-assignment"),
        ('"INVESTIGATION_API_ADMISSION=closed" "INVESTIGATION_API_ADMISSION=closed"',
         "conflicting-admission-declaration"),
    ],
)
def test_unit_environment_matrix_refuses(verifier, environment, expected):
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(Environment=environment),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == expected, raised.value.code


def test_environment_file_declarations_are_classified_with_the_unit(
    verifier, tmp_path
):
    env_file = tmp_path / "environment"
    env_file.write_text("OTHER_SECRET=fixture-never-log\n", encoding="utf-8")
    os.chmod(env_file, 0o600)
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_beta_unit(str(env_file)),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", str(tmp_path),
                          "terminal-beta", str(tmp_path), "beta"])
    assert raised.value.code == "missing-explicit-closed"

    env_file.write_text(
        "OTHER_SECRET=fixture-never-log\nINVESTIGATION_API_ADMISSION=closed\n",
        encoding="utf-8")
    os.chmod(env_file, 0o600)
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_beta_unit(str(env_file)),
    )
    host.install(verifier)
    assert verifier["main"](
        ["/app", NEW_SHA, "prestart", str(tmp_path), "terminal-beta",
         str(tmp_path), "beta"]) == 0

    env_file.write_text(
        "OTHER_SECRET=fixture-never-log\nINVESTIGATION_API_ADMISSION=closed\n",
        encoding="utf-8")
    os.chmod(env_file, 0o600)
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_beta_unit(
            str(env_file), Environment=PROD_CLOSED_ENV),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", str(tmp_path),
                          "terminal-beta", str(tmp_path), "beta"])
    assert raised.value.code == "conflicting-admission-declaration"

    env_file.write_text(
        "OTHER_SECRET=fixture-never-log\nINVESTIGATION_API_ADMISSION=open\n",
        encoding="utf-8")
    os.chmod(env_file, 0o600)
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_beta_unit(
            str(env_file), Environment=PROD_CLOSED_ENV),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", str(tmp_path),
                          "terminal-beta", str(tmp_path), "beta"])
    assert raised.value.code == "conflicting-admission-declaration"


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"PassEnvironment": "INVESTIGATION_API_ADMISSION"},
         "admission-key-in-indirect-unit-environment"),
        ({"UnsetEnvironment": "INVESTIGATION_API_ADMISSION"},
         "admission-key-in-indirect-unit-environment"),
        ({}, "admission-key-in-manager-environment"),
    ],
)
def test_indirect_channels_and_manager_inheritance_refuse(
    verifier, overrides, expected
):
    manager = "INVESTIGATION_API_ADMISSION=open\n" if expected.startswith(
        "admission-key-in-manager") else ""
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(**overrides),
        manager=manager,
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("INVESTIGATION_API_ADMISSION=closed\n", "dotenv-admission-conflict"),
        ("INVESTIGATION_API_ADMISSION: open\n", "dotenv-admission-conflict"),
        ("export INVESTIGATION_API_ADMISSION=closed\n",
         "dotenv-admission-conflict"),
        ('INVESTIGATION_API_ADMISSION="closed"\n', "dotenv-admission-conflict"),
        ("INVESTIGATION_API_ADMISSION_EXTRA=closed\n", None),
        ("INVESTIGATION_API_ADM=closed\n", None),
    ],
)
def test_next_dotenv_sources_must_stay_silent(
    verifier, tmp_path, text, expected
):
    (tmp_path / ".env.production").write_text(
        "OTHER_SECRET=fixture-never-log\n" + text, encoding="utf-8")
    os.chmod(tmp_path / ".env.production", 0o600)
    host = FakeGitHost(
        tree_listing=primitive_entry(), unit=closed_prod_unit())
    host.install(verifier)
    if expected is None:
        assert verifier["main"](
            ["/app", NEW_SHA, "prestart", str(tmp_path), "terminal",
             str(tmp_path), "production"]) == 0
    else:
        with pytest.raises(verifier["Refused"]) as raised:
            verifier["main"](["/app", NEW_SHA, "prestart", str(tmp_path),
                              "terminal", str(tmp_path), "production"])
        assert raised.value.code == expected


def _bounded_file(path: Path, text: str, mode: int) -> str:
    path.write_text(text, encoding="utf-8")
    os.chmod(path, mode)
    return str(path)


def test_env_file_custody_refusals(verifier, tmp_path):
    cases = []
    for name, text, mode, expected in (
        ("unreadable", "x=1\n", 0o000, "env-file-unreadable"),
        ("writable", "INVESTIGATION_API_ADMISSION=closed\n", 0o664,
         "env-file-group-or-other-writable"),
        ("oversized", "pad=" + "x" * (1024 * 1024 + 1) + "\n", 0o600,
         "env-file-oversized"),
    ):
        holder = tmp_path / name
        holder.mkdir()
        path = _bounded_file(holder / "environment", text, mode)
        cases.append((path, holder, expected))
    # A non-regular file at the approved EnvironmentFile path is refused.
    holder = tmp_path / "adir"
    (holder / "environment").mkdir(parents=True)
    cases.append((str(holder / "environment"), holder, "env-file-not-regular"))
    target_holder = tmp_path / "target-holder"
    target_holder.mkdir()
    _bounded_file(target_holder / "environment", "x=1\n", 0o600)
    linked_holder = tmp_path / "linked-holder"
    linked_holder.mkdir()
    os.symlink(target_holder / "environment", linked_holder / "environment")
    cases.append((str(linked_holder / "environment"), linked_holder,
                  "env-file-unreadable"))

    for path, holder, expected in cases:
        host = FakeGitHost(
            tree_listing=primitive_entry(),
            unit=closed_beta_unit(path),
        )
        host.install(verifier)
        with pytest.raises(verifier["Refused"]) as raised:
            verifier["main"](["/app", NEW_SHA, "prestart", "/app",
                              "terminal-beta", str(holder), "beta"])
        assert raised.value.code == expected, (path, raised.value.code)


def test_foreign_owner_env_file_refuses(verifier, tmp_path, monkeypatch):
    holder = tmp_path / "host"
    holder.mkdir()
    path = _bounded_file(
        holder / "environment", "INVESTIGATION_API_ADMISSION=closed\n", 0o600)
    real_os = os

    class ForeignOs:
        def __getattr__(self, name):
            return getattr(real_os, name)

        @staticmethod
        def fstat(fd):
            source = real_os.fstat(fd)
            return real_os.stat_result(
                (source.st_mode, source.st_ino, source.st_dev, source.st_nlink,
                 source.st_uid + 1, source.st_gid, source.st_size,
                 source.st_atime, source.st_mtime, source.st_ctime))

    monkeypatch.setitem(verifier, "os", ForeignOs())
    host = FakeGitHost(
        tree_listing=primitive_entry(), unit=closed_beta_unit(path))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal-beta",
                          str(holder), "beta"])
    assert raised.value.code == "env-file-foreign-owner"


def test_env_file_topology_must_be_the_approved_beta_file_or_none(verifier):
    cases = [
        (closed_prod_unit(EnvironmentFiles="/etc/other.env (ignore_errors=no)"),
         "production"),
        (closed_beta_unit(""), "beta"),
        (closed_beta_unit("/elsewhere/environment"), "beta"),
        (closed_beta_unit("/var/lib/mastermind-terminal-beta/host/environment "
                          "(ignore_errors=yes)"), "beta"),
        (closed_beta_unit(
            "/var/lib/mastermind-terminal-beta/host/environment "
            "(ignore_errors=no) /etc/extra (ignore_errors=no)"), "beta"),
    ]
    for unit, profile in cases:
        host = FakeGitHost(tree_listing=primitive_entry(), unit=unit)
        host.install(verifier)
        with pytest.raises(verifier["Refused"]) as raised:
            verifier["main"](["/app", NEW_SHA, "prestart", "/app",
                              "terminal-beta" if profile == "beta" else "terminal",
                              "/var/lib/mastermind-terminal-beta/host"
                              if profile == "beta" else "/tmp", profile])
        assert raised.value.code == "unsupported-env-file-topology"


def test_beta_env_file_malformed_key_line_refuses(verifier, tmp_path):
    path = _bounded_file(
        tmp_path / "environment", "INVESTIGATION_API_ADMISSION closed\n", 0o600)
    host = FakeGitHost(
        tree_listing=primitive_entry(), unit=closed_beta_unit(path))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", str(tmp_path),
                          "terminal-beta", str(tmp_path), "beta"])
    # Service files use the reviewed systemd grammar, not the dotenv scanner.
    assert raised.value.code == "unsupported-env-file-syntax"


def test_production_launch_wrapper_matrix(verifier):
    good = FakeGitHost(tree_listing=primitive_entry(),
                       unit=closed_prod_unit())
    good.install(verifier)
    assert verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                             "/tmp", "production"]) == 0

    for start in (
        "path=/usr/bin/env ; argv[]=/usr/bin/env npm run start ;",
        "path=/usr/bin/npm ; argv[]=/usr/bin/npm run start ; argv[]=extra ;",
        "path=/usr/bin/npm-run ; argv[]=/usr/bin/npm run start ;",
        "unparsed topology",
    ):
        host = FakeGitHost(tree_listing=primitive_entry(),
                           unit=closed_prod_unit(ExecStart=start))
        host.install(verifier)
        with pytest.raises(verifier["Refused"]) as raised:
            verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                              "/tmp", "production"])
        assert raised.value.code == "unsupported-launch-wrapper", start

    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(),
        package=b'{"scripts":{"start":"next start --turbopack"}}\n',
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "unsupported-start-command"


def test_beta_launch_wrapper_matrix(verifier, tmp_path):
    env_file = _bounded_file(
        tmp_path / "environment", "INVESTIGATION_API_ADMISSION=closed\n", 0o600)

    def beta_unit_with(start):
        return closed_beta_unit(env_file, ExecStart=start)

    good = FakeGitHost(tree_listing=primitive_entry(),
                       unit=beta_unit_with(EXEC_START_NEXT))
    good.install(verifier)
    assert verifier["main"](["/app", NEW_SHA, "prestart", str(tmp_path),
                             "terminal-beta", str(tmp_path), "beta"]) == 0

    for start in (
        "path=/bin/sh ; argv[]=/bin/sh ; argv[]=-c ; "
        "argv[]=node node_modules/next/dist/bin/next start ;",
        "path=/usr/bin/env ; argv[]=/usr/bin/env ; argv[]=bash ; "
        "argv[]=node_modules/next/dist/bin/next ; argv[]=start ;",
        "path=/usr/bin/env ; argv[]=/usr/bin/env ; argv[]=node ; "
        "argv[]=next/dist/bin/next ; argv[]=start ;",
        "path=/usr/bin/env ; argv[]='/usr/bin/env node next start' ;",
        "path=/usr/bin/npm ; argv[]=/usr/bin/npm run start ;",
        "path=/usr/bin/env ; argv[]=/usr/bin/env ; argv[]=node ; "
        "argv[]=node_modules/next/dist/bin/next ; argv[]=dev ;",
    ):
        host = FakeGitHost(tree_listing=primitive_entry(),
                           unit=beta_unit_with(start))
        host.install(verifier)
        with pytest.raises(verifier["Refused"]) as raised:
            verifier["main"](["/app", NEW_SHA, "prestart", str(tmp_path),
                              "terminal-beta", str(tmp_path), "beta"])
        assert raised.value.code == "unsupported-launch-wrapper", start


# ── poststart process binding (fake /proc readers only) ─────────────────────
def test_poststart_requires_active_unit_with_a_live_mainpid(verifier):
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="inactive"),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "service-not-active"

    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID="0"),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "mainpid-absent"


def test_correct_mainpid_with_a_bad_next_child_is_rejected(verifier):
    base = serving_fixture()
    for mutation, expected in (
        ({"environ": b"INVESTIGATION_API_ADMISSION=open\0"},
         "serving-process-admission-not-closed"),
        ({"environ": b"NODE_ENV=production\0"},
         "serving-process-admission-not-closed"),
        ({"environ": b"INVESTIGATION_API_ADMISSION=closed\0"
                     b"INVESTIGATION_API_ADMISSION=open\0"},
         "serving-process-admission-conflict"),
    ):
        procs = serving_fixture()
        procs[SERVER_PID].update(mutation)
        host = FakeGitHost(
            tree_listing=primitive_entry(),
            unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
        )
        install_proc_fakes(verifier, procs, (7, 99))
        host.install(verifier)
        with pytest.raises(verifier["Refused"]) as raised:
            verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                              "/tmp", "production"])
        assert raised.value.code == expected, mutation


def test_npm_mainpid_alone_is_inadequate(verifier):
    procs = serving_fixture()
    procs[MAIN_PID]["children"] = []
    del procs[SHIM_PID]
    del procs[SERVER_PID]
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "no-next-serving-process"


def test_unknown_descendant_is_rejected(verifier):
    procs = serving_fixture()
    procs[SERVER_PID]["children"] = [4299]
    procs[4299] = {
        "cmdline": ["/usr/bin/tail", "-f", "/var/log/whatever"],
        "stat": fake_stat(4299, "tail", SERVER_PID),
        "comm": "tail",
        "cgroup": UNIT_CGROUP,
        "children": [],
        "environ": b"INVESTIGATION_API_ADMISSION=closed\0",
        "cwd": procs[SERVER_PID]["cwd"],
    }
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "unexpected-serving-process"


def test_cgroup_membership_and_moves_are_rejected(verifier):
    procs = serving_fixture()
    procs[MAIN_PID]["cgroup"] = "/system.slice/other.service"
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "mainpid-outside-target-unit"

    procs = serving_fixture()
    procs[SERVER_PID]["cgroup"] = "/system.slice/terminal.service.scope"
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "serving-process-outside-target-cgroup"


def test_pid_reuse_and_identity_races_are_rejected(verifier):
    # A reused PID reports a different starttime on the stability re-read.
    procs = serving_fixture()
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    original = verifier["proc_starttime"]
    server_reads = {"n": 0}

    def reused_starttime(pid):
        if pid == SERVER_PID:
            server_reads["n"] += 1
            if server_reads["n"] >= 2:
                return "99999"
        return original(pid)

    verifier["proc_starttime"] = reused_starttime
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "process-identity-changed-during-verification"

    # A cgroup move between reads is the same refusal class.
    procs = serving_fixture()
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    original_cgroup = verifier["proc_cgroup_path"]
    server_cgroup_reads = {"n": 0}

    def moving_cgroup(pid):
        if pid == SERVER_PID:
            server_cgroup_reads["n"] += 1
            if server_cgroup_reads["n"] >= 2:
                return "/system.slice/moved.service"
        return original_cgroup(pid)

    verifier["proc_cgroup_path"] = moving_cgroup
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "process-identity-changed-during-verification"


def test_broken_ancestry_and_foreign_cwd_are_rejected(verifier):
    procs = serving_fixture()
    procs[SERVER_PID]["stat"] = fake_stat(SERVER_PID, "next-server (v15)", 1)
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "serving-process-ancestry-unknown"

    procs = serving_fixture()
    procs[SERVER_PID]["cwd"] = SimpleNamespace(st_dev=7, st_ino=555)
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, procs, (7, 99))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "serving-process-foreign-working-directory"


# ── caller environment and shared-shell independence ────────────────────────
def test_caller_environment_is_never_consulted(
    verifier, capsys, monkeypatch
):
    body = _library_text()
    marker = "<<'PY_INVESTIGATION_INSTALL'"
    start = body.index(marker) + len(marker) + 1
    end = body.index("\nPY_INVESTIGATION_INSTALL\n", start)
    extracted = body[start:end]
    assert "os.environ" not in extracted and "getenv" not in extracted, (
        "the verifier must have no caller environment channel at all"
    )
    monkeypatch.setenv("INVESTIGATION_API_ADMISSION", "open")
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)),
    )
    install_proc_fakes(verifier, serving_fixture(), (7, 99))
    host.install(verifier)
    assert verifier["main"](
        ["/app", NEW_SHA, "prestart", "/app", "terminal", "/tmp",
         "production"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"

    monkeypatch.setenv("INVESTIGATION_API_ADMISSION", "closed")
    host = FakeGitHost(tree_listing=primitive_entry(),
                       unit=closed_prod_unit(Environment=PROD_OPEN_ENV))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "unit-admission-not-closed"


def test_production_shared_shell_off_still_checks(verifier, capsys):
    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(Environment='"MMX_SHARED_SHELL_BUILD=1"'),
    )
    host.install(verifier)
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal",
                          "/tmp", "production"])
    assert raised.value.code == "missing-explicit-closed"

    host = FakeGitHost(
        tree_listing=primitive_entry(),
        unit=closed_prod_unit(
            Environment='"MMX_SHARED_SHELL_BUILD=1" '
                        '"INVESTIGATION_API_ADMISSION=closed"'),
    )
    host.install(verifier)
    assert verifier["main"](
        ["/app", NEW_SHA, "prestart", "/app", "terminal", "/tmp",
         "production"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"


# ── bash-level hooks against tiny local Git fixtures ────────────────────────
def _bash() -> str:
    found = shutil.which("bash")
    assert found, "bash is required to exercise the deploy owner"
    return found


def run_gen(body: str, *, env: dict[str, str] | None = None):
    driver = textwrap.dedent(
        f"""
        . "{SCRIPT}"
        set +e
        {textwrap.dedent(body)}
        """
    )
    process_env = dict(os.environ)
    process_env.pop("INVESTIGATION_API_ADMISSION", None)
    if env:
        process_env.update(env)
    return subprocess.run(
        [_bash(), "-c", driver], capture_output=True, text=True,
        timeout=120, env=process_env,
    )


def _fixture_repo(tmp_path: Path, *, with_primitive: bool, decoy: bool = False,
                  name: str = "src"):
    repo = tmp_path / name
    (repo / "terminal" / "lib").mkdir(parents=True)
    if with_primitive:
        (repo / PRIMITIVE).write_text(
            'export function investigationApiAdmission(value: unknown)'
            ': boolean { return value === "open"; }\n', encoding="utf-8")
    (repo / "terminal" / "package.json").write_text(
        '{"scripts":{"start":"next start"}}\n', encoding="utf-8")

    def git(*args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(repo), *args], text=True).strip()

    git("init", "-q", "-b", "master")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    git("add", "-A")
    git("commit", "-q", "-m", "fixture")
    sha = git("rev-parse", "HEAD")
    if decoy:
        # Mutable-checkout decoys: the committed tree decides, never the worktree.
        (repo / PRIMITIVE).unlink(missing_ok=True)
        (repo / "terminal" / "lib" / "decoy.txt").write_text(
            "decoy\n", encoding="utf-8")
    return repo, sha


def _systemctl_shim(tmp_path: Path, props: dict[str, str]) -> dict[str, str]:
    props = {"NeedDaemonReload": "no", "ActiveState": "active",
             "WorkingDirectory": "/opt/terminal/terminal", "ControlGroup": UNIT_CGROUP,
             "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStopPost": "", "RootDirectory": "", "RootImage": "", "PAMName": "", **props}
    # Production npm reads the installed package even when the lock is unchanged.
    app_package = tmp_path / "app" / "package.json"
    if app_package.parent.is_dir() and not app_package.exists():
        app_package.write_bytes(PACKAGE_JSON)
    shim_dir = tmp_path / "bin"
    shim_dir.mkdir(exist_ok=True)
    # Longest property names first: a "-p EnvironmentFiles" query must not be
    # swallowed by the "-p Environment" glob.
    cases = "".join(
        f'  *"-p {prop}"*) printf \'%s\\n\' "{value}" ;;\n'
        for prop, value in sorted(
            props.items(), key=lambda item: len(item[0]), reverse=True)
    )
    (shim_dir / "systemctl").write_text(
        "#!/bin/sh\n"
        'if [ "$1" != show ]; then exit 0; fi\n'
        "case \"$*\" in\n"
        + cases +
        "  *) exit 4 ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    (shim_dir / "systemctl").chmod(0o755)
    return {"PATH": f"{shim_dir}:{os.environ['PATH']}"}


def _tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        digest.update(str(path.relative_to(root)).encode())
        if path.is_file():
            digest.update(path.read_bytes())
    return digest.hexdigest()


def _owner_globals(repo: Path, app: Path, profile="production") -> str:
    return (
        f'TARGET={profile}\nSRC="{repo}"\nAPP="{app}"\n'
        f'SERVICE_NAME={"terminal-beta" if profile == "beta" else "terminal"}\n'
        f'ENV_SOURCE_DIR="{app}"\n'
    )


def test_old_target_hook_keeps_incumbent_behavior(tmp_path):
    repo, sha = _fixture_repo(tmp_path, with_primitive=False)
    app = tmp_path / "app"
    app.mkdir()
    before = _tree_digest(tmp_path)
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        decision=$(investigation_install_state "{sha}" prestart); rc=$?
        printf 'STATE=%s\\n' "$decision"
        require_investigation_closed_before_start "{sha}"; printf 'HOOK=%s\\n' "$?"
        investigation_restoration_activation_allowed "{sha}"; printf 'RESTORE=%s\\n' "$?"
        """,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "STATE=old-target" in result.stdout
    assert "HOOK=0" in result.stdout
    assert "RESTORE=0" in result.stdout
    assert "FATAL" not in result.stdout + result.stderr
    assert _tree_digest(tmp_path) == before, (
        "an old-target admission must leave no effects at all"
    )


def test_admitted_target_gate_passes_with_a_fake_closed_unit(tmp_path):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    shim = _systemctl_shim(tmp_path, {
        "LoadState": "loaded", "NeedDaemonReload": "no", "ActiveState": "active",
        "WorkingDirectory": "/opt/terminal/terminal", "ControlGroup": UNIT_CGROUP,
        "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStopPost": "", "RootDirectory": "", "RootImage": "", "PAMName": "",
        "Environment": PROD_CLOSED_ENV,
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
    })
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        decision=$(investigation_install_state "{sha}" prestart); rc=$?
        printf 'STATE=%s\\n' "$decision"
        require_investigation_closed_before_start "{sha}"; printf 'HOOK=%s\\n' "$?"
        """,
        env=shim,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "STATE=explicitly-closed" in result.stdout
    assert "HOOK=0" in result.stdout


@pytest.mark.parametrize(
    ("unit_env", "caller", "expected_rc"),
    [
        (PROD_OPEN_ENV, "closed", 65),
        (PROD_CLOSED_ENV, "open", 0),
    ],
)
def test_service_setting_decides_and_caller_env_has_no_authority(
    tmp_path, unit_env, caller, expected_rc
):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    shim = _systemctl_shim(tmp_path, {
        "LoadState": "loaded",
        "Environment": unit_env,
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
    })
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        require_investigation_closed_before_start "{sha}"; printf 'HOOK=%s\\n' "$?"
        """,
        env={**shim, "INVESTIGATION_API_ADMISSION": caller},
    )
    assert f"HOOK={expected_rc}" in result.stdout, result.stdout + result.stderr
    if expected_rc == 65:
        assert "unit-admission-not-closed" in result.stderr


def test_shared_shell_off_production_still_checks(tmp_path):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    shim = _systemctl_shim(tmp_path, {
        "LoadState": "loaded",
        "Environment": '"MMX_SHARED_SHELL_BUILD=1"',
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
    })
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        PRODUCTION_SHARED_SHELL_ENABLED=0
        require_investigation_closed_before_start "{sha}"; printf 'HOOK=%s\\n' "$?"
        """,
        env=shim,
    )
    assert "HOOK=65" in result.stdout, result.stdout + result.stderr
    assert "missing-explicit-closed" in result.stderr


def test_unknown_and_non_commit_identities_refuse(tmp_path):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    tree_sha = subprocess.check_output(
        ["git", "-C", str(repo), "rev-parse", "HEAD^{tree}"], text=True).strip()
    blob_sha = subprocess.check_output(
        ["git", "-C", str(repo), "rev-parse", f"HEAD:{PRIMITIVE}"],
        text=True).strip()
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        require_investigation_closed_before_start "{"f" * 40}"; printf 'UNKNOWN=%s\\n' "$?"
        require_investigation_closed_before_start "{tree_sha}"; printf 'TREE=%s\\n' "$?"
        require_investigation_closed_before_start "{blob_sha}"; printf 'BLOB=%s\\n' "$?"
        """,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UNKNOWN=65" in result.stdout
    assert "TREE=65" in result.stdout
    assert "BLOB=65" in result.stdout
    assert "target-identity-unresolvable" in result.stderr


def test_mutable_checkout_decoy_does_not_flip_the_trigger(tmp_path):
    # A proven old target with a checkout decoy stays old-target.
    repo, sha = _fixture_repo(tmp_path, with_primitive=False, decoy=True)
    app = tmp_path / "app"
    app.mkdir()
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        decision=$(investigation_install_state "{sha}" prestart); rc=$?
        printf 'STATE=%s\\n' "$decision"
        """,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "STATE=old-target" in result.stdout

    # A primitive-bearing tree decides the gate even though the mutable
    # checkout no longer carries the file.
    repo, sha = _fixture_repo(tmp_path, with_primitive=True, decoy=True,
                              name="src2")
    shim = _systemctl_shim(tmp_path, {
        "LoadState": "loaded", "NeedDaemonReload": "no", "ActiveState": "active",
        "WorkingDirectory": "/opt/terminal/terminal", "ControlGroup": UNIT_CGROUP,
        "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStopPost": "", "RootDirectory": "", "RootImage": "", "PAMName": "",
        "Environment": PROD_CLOSED_ENV,
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
    })
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        decision=$(investigation_install_state "{sha}" prestart); rc=$?
        printf 'STATE=%s\\n' "$decision"
        """,
        env=shim,
    )
    assert "STATE=explicitly-closed" in result.stdout, (
        result.stdout + result.stderr
    )


def test_phase_and_identity_arguments_are_validated(tmp_path):
    repo, sha = _fixture_repo(tmp_path, with_primitive=False)
    app = tmp_path / "app"
    app.mkdir()
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        investigation_install_state "{sha}" someday; printf 'PHASE=%s\\n' "$?"
        investigation_install_state "" prestart; printf 'EMPTY=%s\\n' "$?"
        investigation_install_state "abc" prestart; printf 'SHORT=%s\\n' "$?"
        """,
    )
    assert "PHASE=64" in result.stdout
    assert "EMPTY=65" in result.stdout
    assert "SHORT=65" in result.stdout


def test_restoration_gate_allows_qualified_prior_and_withholds_unknown(
    tmp_path,
):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    shim = _systemctl_shim(tmp_path, {
        "LoadState": "loaded", "NeedDaemonReload": "no", "ActiveState": "active",
        "WorkingDirectory": "/opt/terminal/terminal", "ControlGroup": UNIT_CGROUP,
        "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStopPost": "", "RootDirectory": "", "RootImage": "", "PAMName": "",
        "Environment": PROD_CLOSED_ENV,
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
    })
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        investigation_restoration_activation_allowed "{sha}"; printf 'CLOSED=%s\\n' "$?"
        investigation_restoration_activation_allowed "{"f" * 40}"; printf 'UNKNOWN=%s\\n' "$?"
        """,
        env=shim,
    )
    assert "CLOSED=0" in result.stdout
    assert "UNKNOWN=1" in result.stdout


def test_poststart_refuses_with_no_running_process_without_proc_reads(
    tmp_path,
):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    shim = _systemctl_shim(tmp_path, {
        "LoadState": "loaded", "NeedDaemonReload": "no", "ActiveState": "active",
        "WorkingDirectory": "/opt/terminal/terminal", "ControlGroup": UNIT_CGROUP,
        "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStopPost": "", "RootDirectory": "", "RootImage": "", "PAMName": "",
        "Environment": PROD_CLOSED_ENV,
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
        "ActiveState": "inactive",
    })
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        require_investigation_closed_after_start "{sha}" "build-1"; printf 'HOOK=%s\\n' "$?"
        """,
        env=shim,
    )
    assert "HOOK=65" in result.stdout, result.stdout + result.stderr
    assert "service-not-active" in result.stderr


@pytest.mark.parametrize("sentinel", ["MMX-SECRET-SENTINEL"])
def test_refusals_never_leak_secret_values(tmp_path, sentinel):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    (app / ".env.production").write_text(
        f"OTHER_SECRET={sentinel}\nINVESTIGATION_API_ADMISSION=closed\n",
        encoding="utf-8")
    os.chmod(app / ".env.production", 0o600)
    shim = _systemctl_shim(tmp_path, {
        "LoadState": "loaded",
        "Environment": f'"OTHER={sentinel}" {PROD_CLOSED_ENV}',
        "EnvironmentFiles": "",
        "PassEnvironment": "",
        "UnsetEnvironment": "",
        "ExecStart": EXEC_START_NPM,
    })
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        require_investigation_closed_before_start "{sha}"; printf 'HOOK=%s\\n' "$?"
        """,
        env=shim,
    )
    assert "HOOK=65" in result.stdout, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert sentinel not in combined, combined
    assert re.search(r"reason=[a-z0-9-]+\n?$", combined.strip()), combined
    for line in combined.strip().splitlines():
        assert line.startswith(("[build] ", "HOOK=", "STATE=")), line


def test_refusals_leave_no_filesystem_effects(tmp_path):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    before = _tree_digest(tmp_path)
    result = run_gen(
        f"""
        {_owner_globals(repo, app)}
        require_investigation_closed_before_start "{sha}"; printf 'HOOK=%s\\n' "$?"
        """,
    )
    assert "HOOK=65" in result.stdout
    assert _tree_digest(tmp_path) == before, (
        "a refused admission must not mutate the checkout, app root or repo"
    )


# ── wiring: every candidate start/restart and the rollback paths ────────────
def _numbered_body() -> list[str]:
    return _main_body(code_only=True).splitlines()


def _positions(lines: list[str], needle: str) -> list[int]:
    return [index for index, line in enumerate(lines) if needle in line]


def test_precheck_follows_admission_and_precedes_mutations_everywhere():
    body = _main_body(code_only=True)
    lines = body.splitlines()
    hooks = _positions(lines, "require_investigation_closed_before_start")
    assert len(hooks) >= 5, hooks  # three entrances + two immediate repeats
    ordinary_admit = body.index("admit_target_sha")
    ordinary_reset = body.index('git -C "$SRC" reset -q --hard "$TARGET_SHA"')
    assert any(ordinary_admit < body.index(
        'require_investigation_closed_before_start "$TARGET_SHA"', ordinary_admit)
        < ordinary_reset for _ in [0]), "ordinary entrance precheck is misplaced"
    bootstrap_provision = body.index("beta_bootstrap_provision")
    assert body.rindex(
        'require_investigation_closed_before_start "$TARGET_SHA"',
        0, bootstrap_provision) > body.rindex(
        "admit_target_sha", 0, bootstrap_provision), (
        "bootstrap precheck must follow admission and precede provisioning")
    recover = body.index("beta_txn_recover")
    assert body.rindex(
        'require_investigation_closed_before_start "$TARGET_SHA"',
        0, recover) > body.rindex("admit_target_sha", 0, recover), (
        "recovery precheck must follow admission and precede recovery claim")


def test_every_candidate_start_and_restart_is_instantly_preceded():
    lines = _numbered_body()
    starts = _positions(lines, 'if ! systemctl start "$SERVICE_NAME"')
    beta_restarts = _positions(lines, 'if ! systemctl restart "$SERVICE_NAME"')
    prod_restart = _positions(lines, "if ! systemctl restart terminal; then")
    assert len(starts) == 1 and len(prod_restart) == 1
    assert len(beta_restarts) == 2, beta_restarts  # activation + final reflection
    guarded = starts + beta_restarts + prod_restart
    for position in guarded:
        window = "\n".join(lines[max(0, position - 6):position])
        assert "require_investigation_closed_before_start" in window, (
            f"an unguarded candidate start at body line {position}:\n{window}"
        )


def test_poststart_precedes_every_acceptance():
    lines = _numbered_body()
    text = "\n".join(lines)
    activation = text.index('require_investigation_closed_after_start "$FULL_SHA"')
    tuple_check = text.index("shared_shell_status_verified")
    assert activation < tuple_check, (
        "the pending beta acceptance tuple must run after the poststart gate"
    )
    library = _library_text()
    commit_start = library.index("beta_txn_commit(){")
    commit_body = library[commit_start:library.index("\n}", commit_start)]
    gate = commit_body.index("require_investigation_closed_after_start")
    assert gate < commit_body.index("shared_shell_status_verified"), (
        "beta transaction acceptance must be preceded by the poststart gate"
    )
    assert commit_body.index('[ "$TARGET" = beta ] || return 0') < gate, (
        "the commit gate must stay beta-only like the rest of beta_txn_commit"
    )


def test_rollback_restoration_is_gated_but_source_restoration_is_not():
    library = _library_text()
    abort_start = library.index("beta_txn_abort(){")
    abort_body = library[abort_start:library.index("\n}", abort_start)]
    reset = abort_body.index('git -C "$SRC" reset -q --hard "$BETA_PRIOR_SHA"')
    restart = abort_body.index('systemctl restart "$SERVICE_NAME"')
    gate = abort_body.index("investigation_restoration_activation_allowed")
    assert reset < gate < restart, (
        "the restoration gate must wrap only the reactivation, never the "
        "source/build restoration"
    )
    production = library[library.index("deploy_generation_abort(){"):]
    production = production[:production.index("\n}")]
    assert production.index("deploy_generation_rollback") < production.index("investigation_restoration_activation_allowed") < production.index("systemctl restart terminal")
    assert "require_investigation_closed_after_start" in production
    for frozen in ("deploy_generation_rollback(){",):
        start = library.index(frozen)
        body = library[start:library.index("\n}", start)]
        assert "investigation_" not in body, (
            f"{frozen} must keep its incumbent restoration behavior verbatim"
        )
    for restore in ("recover_canonical_head_mismatch(){",
                    "cleanup_deploy_attempt(){"):
        start = library.index(restore)
        body = library[start:library.index("\n}", start)]
        assert "investigation_" not in body


def test_verifier_is_read_only_by_construction(verifier):
    text = _library_text()
    marker = "<<'PY_INVESTIGATION_INSTALL'"
    start = text.index(marker) + len(marker) + 1
    end = text.index("\nPY_INVESTIGATION_INSTALL\n", start)
    extracted = text[start:end]
    for forbidden in (
        "O_WRONLY", "O_CREAT", "O_TRUNC", "O_RDWR",
        "os.truncate", "os.unlink", "os.remove", "os.rename", "os.replace",
        "os.mkdir", "os.makedirs", "os.chmod", "os.chown", "shutil",
        "subprocess.run([\"systemctl\", \"start\"",
        "systemctl restart", "systemctl stop", "systemctl set-environment",
        "daemon-reload", "copyfile",
        'open(path, "w', 'open(path, \'w', "write_text",
    ):
        assert forbidden not in extracted, forbidden
    assert "O_RDONLY | getattr" in extracted
    writes = [line for line in extracted.splitlines()
              if ".write" in line and "stderr.write" not in line]
    assert writes == [], writes


def test_verifier_has_no_flag_or_environment_bypass():
    text = _library_text()
    marker = "<<'PY_INVESTIGATION_INSTALL'"
    start = text.index(marker) + len(marker) + 1
    end = text.index("\nPY_INVESTIGATION_INSTALL\n", start)
    extracted = text[start:end]
    for forbidden in ("os.environ", "getenv", "input(", "argparse",
                      "--fake", "--root=", "--bypass", "--skip"):
        assert forbidden not in extracted, forbidden
    bash_wrapper = text[text.index("investigation_install_state(){"):]
    bash_wrapper = bash_wrapper[:bash_wrapper.index("\n}\n")]
    assert "PY_INVESTIGATION_INSTALL" in bash_wrapper
    assert bash_wrapper.count('python3 -I - "$SRC"') == 1
    assert "INVESTIGATION" + "_OVERRIDE" not in text


def test_empty_tree_identity_must_still_be_a_commit(verifier):
    host = FakeGitHost(tree_listing=b"", object_kind="tree")
    host.install(verifier)
    with pytest.raises(verifier["Refused"]):
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal", "/app", "production"])


def test_env_scan_overflow_refuses_instead_of_hiding_a_late_key(verifier):
    text = "# line\n" * verifier["MAX_SCAN_LINES"] + "INVESTIGATION_API_ADMISSION=open\n"
    with pytest.raises(verifier["Refused"]):
        verifier["admission_values_in_text"](text)


def test_unit_mainpid_change_is_not_a_stable_poststart_binding(verifier):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)))
    install_proc_fakes(verifier, serving_fixture(), (7, 99))
    host.install(verifier)
    original = verifier["unit_property"]
    reads = []
    def moving_unit(unit, prop):
        if prop == "MainPID":
            reads.append(prop)
            return str(MAIN_PID if len(reads) == 1 else MAIN_PID + 100)
        return original(unit, prop)
    verifier["unit_property"] = moving_unit
    with pytest.raises(verifier["Refused"]):
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal", "/app", "production"])


@pytest.mark.parametrize("prop", ["ExecStartPre", "ExecStartPost", "ExecCondition", "ExecStopPost", "PAMName"])
def test_unsupported_service_launch_hooks_refuse(verifier, prop):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(**{prop: "/untrusted/hook"}))
    host.install(verifier)
    with pytest.raises(verifier["Refused"]):
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal", "/app", "production"])


@pytest.mark.parametrize("hook", ["prestart", "poststart"])
def test_npm_lifecycle_hook_is_not_a_supported_next_launch(verifier, hook):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(),
                      package=json.dumps({"scripts": {"start": "next start", hook: "untrusted-hook"}}).encode())
    host.install(verifier)
    with pytest.raises(verifier["Refused"]):
        verifier["main"](["/app", NEW_SHA, "prestart", "/app", "terminal", "/app", "production"])


@pytest.mark.parametrize("pid", [MAIN_PID, SHIM_PID])
def test_every_launcher_initial_environment_is_also_closed(verifier, pid):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)))
    procs = serving_fixture(); procs[pid]["environ"] = b"INVESTIGATION_API_ADMISSION=open\0"
    install_proc_fakes(verifier, procs, (7, 99)); host.install(verifier)
    with pytest.raises(verifier["Refused"]):
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal", "/app", "production"])


@pytest.mark.parametrize("argv", [["npm run start"], ["/usr/bin/node", "/usr/bin/npm", "run", "start"]])
def test_supported_production_npm_process_titles(verifier, argv, capsys):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)))
    procs = serving_fixture(); procs[MAIN_PID]["cmdline"] = argv
    install_proc_fakes(verifier, procs, (7, 99)); host.install(verifier)
    assert verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal", "/app", "production"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"


def test_full_process_cap_is_not_a_truncation_bypass(verifier):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)))
    procs = serving_fixture(); procs[SERVER_PID]["children"] = [99999]
    verifier["MAX_PROCS"] = 3
    install_proc_fakes(verifier, procs, (7, 99)); host.install(verifier)
    with pytest.raises(verifier["Refused"]):
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal", "/app", "production"])


def test_late_descendant_cannot_escape_the_poststart_inventory(verifier):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(ActiveState="active", MainPID=str(MAIN_PID)))
    procs = serving_fixture(); install_proc_fakes(verifier, procs, (7, 99)); host.install(verifier)
    original = verifier["proc_children"]; reads = []
    def moving_children(pid):
        if pid == MAIN_PID:
            reads.append(pid)
            if len(reads) > 1:
                return [SHIM_PID, 99999]
        return original(pid)
    verifier["proc_children"] = moving_children
    with pytest.raises(verifier["Refused"]):
        verifier["main"](["/app", NEW_SHA, "poststart", "/app", "terminal", "/app", "production"])


@pytest.mark.parametrize("key", ["NODE_OPTIONS", "npm_config_script_shell"])
def test_launch_environment_override_refuses_without_disclosing_value(verifier, key):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(
        Environment=PROD_CLOSED_ENV + f' "{key}=private-sentinel"'))
    with pytest.raises(verifier["Refused"]) as raised:
        _decide(verifier, host)
    assert raised.value.code == "unsupported-launch-environment-override"
    assert "private-sentinel" not in str(raised.value)


def test_beta_direct_next_mainpid_supported_closed_process(verifier, tmp_path, capsys):
    app = tmp_path / "app"
    app.mkdir()
    env_file = tmp_path / "environment"
    env_file.write_text("INVESTIGATION_API_ADMISSION=closed\n")
    procs = serving_fixture()
    server = procs[SERVER_PID]
    server["stat"] = fake_stat(SERVER_PID, "next-server (v16)", 1)
    server["cgroup"] = "/system.slice/terminal-beta.service"
    install_proc_fakes(verifier, {SERVER_PID: server}, (7, 99))
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_beta_unit(
        str(env_file), MainPID=str(SERVER_PID)))
    host.install(verifier)
    assert verifier["main"](["/repo", NEW_SHA, "poststart", str(app),
                              "terminal-beta", str(tmp_path), "beta"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"


@pytest.mark.parametrize("prior,closed,post_ok,expected_actions", [
    ("old", False, True, "restart terminal"),
    ("candidate", True, True, "restart terminal"),
    ("candidate", False, True, "stop terminal"),
    ("unknown", True, True, "stop terminal"),
    ("candidate", True, False, "restart terminal\nstop terminal"),
])
def test_production_abort_restores_real_generation_before_qualified_activation(
    tmp_path, prior, closed, post_ok, expected_actions
):
    # Real source identity/config classification and generation restoration;
    # only the external service effects and post-start process observation are
    # fake. The process classifier has separate positive/negative fixtures.
    repo, sha = _fixture_repo(tmp_path, with_primitive=prior == "candidate")
    prior_sha = "f" * 40 if prior == "unknown" else sha
    app = tmp_path / "app"
    app.mkdir()
    (app / ".deployment-id").write_text(prior_sha + "\n")
    (app / ".next").mkdir()
    (app / ".next" / "BUILD_ID").write_text("prior-build\n")
    staged = tmp_path / "staged"
    staged.write_text(NEW_SHA + "\n")
    shim = _systemctl_shim(tmp_path, closed_prod_unit(
        Environment=PROD_CLOSED_ENV if closed else PROD_OPEN_ENV))
    calls = tmp_path / "service-calls"
    post = tmp_path / "post-calls"
    result = run_gen(f'''
        {_owner_globals(repo, app)}
        systemctl() {{ printf '%s\\n' "$*" >> "{calls}"; }}
        require_investigation_closed_after_start() {{
          printf '%s %s\\n' "$1" "$2" >> "{post}"
          test "$(cat "$APP/.deployment-id")" = "{prior_sha}" || return 99
          test "$(cat "$APP/.next/BUILD_ID")" = prior-build || return 99
          return {0 if post_ok else 65}
        }}
        deploy_generation_begin "$APP" "{staged}"
        mv "$APP/.next" "$APP/.next.bak"
        mkdir "$APP/.next"
        printf 'failed-build\\n' > "$APP/.next/BUILD_ID"
        deploy_generation_abort "$APP" "{NEW_SHA}" 1 fixture-failure
        printf 'ABORT_RC=%s\\n' "$?"
    ''', env=shim)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ABORT_RC=1" in result.stdout
    assert (app / ".deployment-id").read_text().strip() == prior_sha
    assert (app / ".next" / "BUILD_ID").read_text().strip() == "prior-build"
    assert (app / ".next.broken" / "BUILD_ID").read_text().strip() == "failed-build"
    assert calls.read_text().strip() == expected_actions
    if expected_actions.startswith("restart"):
        assert post.read_text().strip() == f"{prior_sha} prior-build"
    else:
        assert not post.exists()
    if "stop" in expected_actions:
        assert "ROLLBACK INCOMPLETE" in result.stdout
    else:
        assert "rolled back —" in result.stdout


@pytest.mark.parametrize("post_ok", [True, False])
def test_actual_production_acceptance_branch_routes_poststart_failure(tmp_path, post_ok):
    text = _library_text()
    start = text.index("DEPLOY_OK=1", text.index("# 7) Beta activates"))
    end = text.index("\nfi\n\n# 8) RUNTIME-CODE SYNC", start)
    branch = text[start:end]
    # Execute the exact acceptance branch with all external dependencies faked.
    result = run_gen(f'''
        APP="{tmp_path}"
        FULL_SHA={NEW_SHA}
        NEW_BUILD_ID=fixture-build
        SWAPPED=1
        PRODUCTION_SHARED_SHELL_ENABLED=0
        curl() {{ return 0; }}
        deploy_identity_verified() {{ return 0; }}
        require_investigation_closed_after_start() {{ echo POSTSTART; return {0 if post_ok else 65}; }}
        deploy_generation_commit() {{ echo COMMITTED; }}
        deploy_generation_abort() {{ echo ABORTED; return 1; }}
        {branch}
    ''')
    assert "POSTSTART" in result.stdout
    assert ("COMMITTED" in result.stdout) == post_ok
    assert ("ABORTED" in result.stdout) != post_ok
    assert result.returncode == (0 if post_ok else 1), result.stdout + result.stderr


@pytest.mark.parametrize("source", ["candidate", "live"])
def test_project_local_npm_override_is_not_supported(verifier, tmp_path, source):
    app = tmp_path / "app"
    app.mkdir()
    listing = primitive_entry()
    if source == "candidate":
        listing += tree_listing_for({"terminal/.npmrc": "100644"})
    else:
        (app / ".npmrc").write_text("script-shell=${PRIVATE_SHELL}\n")
    host = FakeGitHost(tree_listing=listing, unit=closed_prod_unit())
    with pytest.raises(verifier["Refused"]) as raised:
        _decide(verifier, host, app=app)
    assert raised.value.code == "unsupported-project-npm-configuration"


def test_empty_project_npm_config_is_supported(verifier, tmp_path, capsys):
    app = tmp_path / "app"
    app.mkdir()
    (app / ".npmrc").write_text("# no overrides\n\n")
    assert _decide(verifier, FakeGitHost(tree_listing=primitive_entry(),
                                        unit=closed_prod_unit()), app=app) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"


def test_configured_fifo_is_refused_without_blocking_open(tmp_path):
    fifo = tmp_path / "configured-env"
    os.mkfifo(fifo)
    # A child timeout makes the original blocking-open defect a bounded test
    # failure; execute only the exact read-only inline collector, never main.
    program = '''from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
marker="<<'PY_INVESTIGATION_INSTALL'"
start=text.index(marker)+len(marker)+1
body=text[start:text.index("\\nPY_INVESTIGATION_INSTALL\\n",start)]
ns={"__name__":"fifo_collector_test"}
exec(compile(body,"<exact inline verifier>","exec"),ns)
try:
 ns["read_bounded_regular_file"](sys.argv[2],1024,"env-file")
except ns["Refused"] as error:
 print(error.code)
 raise SystemExit(65)
raise SystemExit(1)
'''
    result = subprocess.run([sys.executable, "-c", program, str(SCRIPT), str(fifo)],
                            capture_output=True, text=True, timeout=5)
    assert result.returncode == 65, result.stderr
    assert result.stdout.strip() == "env-file-not-regular"


@pytest.mark.parametrize("profile", ["production", "beta"])
def test_after_build_recheck_refuses_before_any_live_generation_mutation(tmp_path, profile):
    text = _library_text()
    start = text.index('if ! require_investigation_closed_before_start "$FULL_SHA";',
                       text.index("# 4) verify the new build"))
    end = text.index("# 5) Pin the same deployment id", start)
    block = text[start:end]
    generation = text.index('deploy_generation_begin "$APP" "$STAGE/.deployment-id"', end)
    swap = text.index('# 6) atomic swap', generation)
    assert start < end < generation < swap
    app = tmp_path / "app"
    app.mkdir()
    marker = app / ".deployment-id"
    marker.write_text(OLD_SHA + "\n")
    result = run_gen(f'''
        TARGET={profile}
        FULL_SHA={NEW_SHA}
        trap 'echo EXISTING_EXIT_CLEANUP' EXIT
        require_investigation_closed_before_start() {{ return 65; }}
        beta_txn_abort() {{ echo EXISTING_BETA_ABORT; return 1; }}
        {block}
        printf MUTATED > "{marker}"
    ''')
    assert result.returncode == (1 if profile == "beta" else 65)
    assert marker.read_text().strip() == OLD_SHA
    assert "EXISTING_EXIT_CLEANUP" in result.stdout
    assert ("EXISTING_BETA_ABORT" in result.stdout) == (profile == "beta")


def test_actual_installed_package_hooks_refuse_even_when_lock_unchanged(tmp_path):
    repo, sha = _fixture_repo(tmp_path, with_primitive=True)
    app = tmp_path / "app"
    app.mkdir()
    # Unchanged locks select the incumbent path that skips package reflection
    # until after first restart. The actual old package must be classified too.
    for parent in (repo / "terminal", app):
        (parent / "package-lock.json").write_text("same-lock\n")
    (app / "package.json").write_text(json.dumps({"scripts": {
        "start": "next start", "prestart": "private-command"}}))
    shim = _systemctl_shim(tmp_path, closed_prod_unit())
    result = run_gen(f'''
        {_owner_globals(repo, app)}
        require_investigation_closed_before_start "{sha}"
        printf 'RC=%s\\n' "$?"
    ''', env=shim)
    assert "RC=65" in result.stdout
    assert "unsupported-start-command" in result.stderr
    assert "private-command" not in result.stdout + result.stderr
    assert (app / "package-lock.json").read_bytes() == (repo / "terminal" / "package-lock.json").read_bytes()


@pytest.mark.parametrize("prop,value", [
    ("Environment", PROD_CLOSED_ENV + ' "PATH=/alternate"'),
    ("Environment", PROD_CLOSED_ENV + ' "HOME=/alternate"'),
    ("Environment", PROD_CLOSED_ENV + ' "npm_config_workspace=other"'),
    ("PassEnvironment", "NODE_OPTIONS"),
    ("UnsetEnvironment", "npm_config_script_shell"),
])
def test_selected_launch_config_indirections_are_not_supported(verifier, prop, value):
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(**{prop: value}))
    with pytest.raises(verifier["Refused"]) as raised:
        _decide(verifier, host)
    assert raised.value.code == "unsupported-launch-environment-override"


def test_trusted_manager_defaults_and_npm_injected_metadata_remain_supported(verifier, capsys):
    procs = serving_fixture()
    for proc in procs.values():
        proc["environ"] += b"PATH=/usr/bin\0HOME=/root\0npm_config_user_agent=npm/10\0"
    install_proc_fakes(verifier, procs, (7, 99))
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit(MainPID=str(MAIN_PID)),
                       manager="PATH=/usr/bin\nHOME=/root\n")
    host.install(verifier)
    assert verifier["main"](["/repo", NEW_SHA, "poststart", "/app", "terminal", "/tmp", "production"]) == 0
    assert capsys.readouterr().out.strip() == "explicitly-closed"


@pytest.mark.parametrize("source", ["env-file", "dotenv"])
def test_selected_file_launch_overrides_refuse(verifier, tmp_path, source):
    app = tmp_path / "app"
    app.mkdir()
    if source == "env-file":
        env_file = tmp_path / "environment"
        env_file.write_text("INVESTIGATION_API_ADMISSION=closed\nnpm_config_workspace=other\n")
        host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_beta_unit(str(env_file)))
        args = dict(profile="beta", unit_name="terminal-beta", env_dir=str(tmp_path))
    else:
        (app / ".env.local").write_text("HOME: /alternate\n")
        host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_prod_unit())
        args = {}
    with pytest.raises(verifier["Refused"]) as raised:
        _decide(verifier, host, app=app, **args)
    assert raised.value.code == "unsupported-launch-environment-override"


@pytest.mark.parametrize(("prefix", "separator"), [
    ("", " "), ("", "\t"), ("\ufeff", ""), ("", "\ufeff"),
])
def test_next_supported_export_whitespace_cannot_hide_launch_override(verifier, prefix, separator):
    # Next's dotenv parser accepts export\s+, including a tab. The known key
    # must be refused before activation for every supported export separator.
    declaration_prefix = prefix + ("export" + separator if separator else "")
    assert verifier["admission_values_in_text"](
        declaration_prefix + "INVESTIGATION_API_ADMISSION=closed\n") == ["closed"]
    with pytest.raises(verifier["Refused"]) as raised:
        verifier["refuse_file_launch_overrides"](
            declaration_prefix + "NODE_OPTIONS=--require=fixture-preload\n", selected=True)
    assert raised.value.code == "unsupported-launch-environment-override"


@pytest.mark.parametrize("content", [
    "export INVESTIGATION_API_ADMISSION=closed\n",
    "INVESTIGATION_API_ADMISSION: closed\n",
    'OTHER="first\nINVESTIGATION_API_ADMISSION=closed\nlast"\n',
    "OTHER=first\\\nINVESTIGATION_API_ADMISSION=closed\n",
    "\ufeffINVESTIGATION_API_ADMISSION=closed\n",
    "OTHER=first\u0085INVESTIGATION_API_ADMISSION=closed\n",
    'INVESTIGATION_API_ADMISSION=" closed "\n',
])
def test_systemd_environment_file_never_credits_dotenv_or_absorbed_assignments(verifier, tmp_path, content):
    env_file = tmp_path / "environment"
    env_file.write_text(content)
    app = tmp_path / "app"
    app.mkdir()
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_beta_unit(str(env_file)))
    with pytest.raises(verifier["Refused"]):
        _decide(verifier, host, app=app, profile="beta", unit_name="terminal-beta", env_dir=str(tmp_path))


@pytest.mark.parametrize("value", ["closed", '"closed"', "'closed'"])
def test_systemd_environment_file_supported_single_line_declaration(verifier, tmp_path, value):
    env_file = tmp_path / "environment"
    env_file.write_text('# comment\nNODE_ENV=production\nOTHER="opaque text"\nINVESTIGATION_API_ADMISSION=' + value + '\n')
    app = tmp_path / "app"
    app.mkdir()
    host = FakeGitHost(tree_listing=primitive_entry(), unit=closed_beta_unit(str(env_file)))
    assert _decide(verifier, host, app=app, profile="beta", unit_name="terminal-beta", env_dir=str(tmp_path)) == 0
