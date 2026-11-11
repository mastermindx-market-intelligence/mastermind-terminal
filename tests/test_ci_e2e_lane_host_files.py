"""Host files of the ubuntu0 Terminal e2e lane (ops/terminal-e2e-lane/).

The slot loop and unit run as root on the host, so they are not executed here; these
tests pin the invariants a careless edit would break. mint-jitconfig is exercised
against a fake GitHub API: its 409 recovery must delete only a provably stale
registration and its exit codes decide whether a slot retries or stops.
"""
from __future__ import annotations

import email.message
import importlib.util
import re
import shutil
import subprocess
from importlib.machinery import SourceFileLoader
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]
LANE = ROOT / "ops" / "terminal-e2e-lane"
SLOT = LANE / "terminal-e2e-slot"
UNIT = LANE / "terminal-e2e-slot@.service"
SLICE = LANE / "terminal_e2e.slice"
MINT = LANE / "mint-jitconfig"
PROVISION = LANE / "provision.sh"
RUNBOOK = ROOT / "docs" / "CI_TERMINAL_E2E_SELFHOSTED_LANE.md"
ORG = "mastermindx-market-intelligence"
NAME = "ubuntu0-e2e-1"
LABELS = "self-hosted,linux,x64,ubuntu0-e2e"
GID = 8


# --- slot loop, unit, slice, provisioning: static invariants -------------------------------

@pytest.mark.parametrize("script", [SLOT, PROVISION])
def test_shell_scripts_parse_and_are_strict(script: Path) -> None:
    subprocess.run(["bash", "-n", str(script)], check=True)
    assert "\nset -euo pipefail\n" in script.read_text(encoding="utf-8")


def test_jit_config_never_reaches_argv_or_output() -> None:
    text = SLOT.read_text(encoding="utf-8")
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert "--jitconfig" not in code
    assert 'ACTIONS_RUNNER_INPUT_JITCONFIG="$jit"' in code
    assert "exec setpriv --reuid=" in code and "sudo -u \"$u\"" not in code and "sudo -H" not in code
    assert not re.search(r"(echo|printf)[^\n]*\$\{?jit\b", code), "the JIT config must never be printed"
    assert "systemd-run" not in code


def test_slot_fails_closed_and_retries_only_api_failures() -> None:
    code = SLOT.read_text(encoding="utf-8")
    assert 'if [ "$mrc" = 75 ]; then' in code
    assert "die \"mint refused" in code
    assert "die \"runner failed to start" in code
    assert "RETRYING_CLEANUP_BLOCKED" in code and "$(seq 300)" in code
    assert "2>/dev/null; pkill" not in code and "pkill -KILL -u \"$u\" || prc=$?" in code
    # crontab: removed only if present, and its absence verified afterwards
    assert 'crontab -r -u "$u" || die' in code and 'die "crontab for $u survived"' in code
    # linger is read from its persisted file, never from a logind query that can fail open
    assert '[ ! -e "/var/lib/systemd/linger/$u" ] || die' in code
    assert "[ ! -e /var/lib/systemd/linger/ghrunner ] || die" in code
    assert "Linger --value" not in code
    # the job cgroup exists before the mint, so nothing local can fail after a registration
    assert code.index('mkdir "$job_cg"') < code.index("mint-jitconfig mint")
    # ipcrm --all is only safe in the unit's private IPC namespace, which is asserted first
    assert code.index("PrivateIPC=yes missing") < code.index("ipcrm --all || die")


def test_unit_and_slice_carry_the_sandbox_the_slot_asserts() -> None:
    unit = UNIT.read_text(encoding="utf-8")
    for line in (
        "ExecStart=/usr/local/sbin/terminal-e2e-slot %i",
        "Slice=terminal_e2e.slice",
        "PrivateTmp=yes",
        "PrivateIPC=yes",
        "ProtectProc=invisible",
        "Delegate=yes",
        "KillMode=control-group",
        "LimitCORE=0",
        "Restart=no",
        "ReadOnlyPaths=-/var/crash -/var/metrics -/var/lib/BrlAPI",
    ):
        assert f"\n{line}\n" in unit, line
    slot = SLOT.read_text(encoding="utf-8")
    assert "/sys/fs/cgroup/terminal_e2e.slice/terminal-e2e-slot@$N.service" in slot
    assert "hidepid=invisible" in slot
    slice_text = SLICE.read_text(encoding="utf-8")
    assert "\nMemoryHigh=22G\n" in slice_text and "\nMemoryMax=24G\n" in slice_text


def test_provision_retires_other_runners_and_the_canary_account() -> None:
    text = PROVISION.read_text(encoding="utf-8")
    assert "DenyUsers ghrunner ghrunner-*" in text
    assert "systemctl reload ssh || die" in text
    assert "usermod -s /usr/sbin/nologin ghrunner\n" in text
    assert "  passwd -l ghrunner >/dev/null\n" in text
    assert "loginctl disable-linger ghrunner" in text
    assert "retirement did not complete" in text
    assert "!log_allowed" not in text
    # a failed enumeration must stop provisioning, not read as "no runner services"
    assert 'runner_list="$(systemctl list-unit-files' in text
    assert '|| die "cannot list actions runner services"' in text
    assert "mapfile -t runner_units < <(" not in text
    assert 'cg="$(systemctl show -p ControlGroup --value "$1")" || die' in text


DENY_PATTERNS = re.compile(r"grep -qiE '(\^denyusers[^']*)' <<<\"\$sshd_cfg\"")
SSHD_BOTH = "port 22\ndenyusers ghrunner\ndenyusers ghrunner-*\nallowusers ubuntu0\n"


@pytest.mark.parametrize("script", [SLOT, PROVISION])
@pytest.mark.parametrize(
    "sshd_t, wildcard_ok, canary_ok",
    [
        (SSHD_BOTH, True, True),
        ("denyusers ghrunner ghrunner-*\n", True, True),
        ("denyusers ghrunner-*\n", True, False),
        ("denyusers ghrunner\n", False, True),
        ("denyusers ghrunner-1\ndenyusers ghrunnerx\n", False, False),
        ("allowusers ghrunner ghrunner-*\n", False, False),
        ("# denyusers ghrunner ghrunner-*\n", False, False),
    ],
    ids=["both", "one-line", "wildcard-only", "canary-only", "near-misses", "allowusers", "comment"],
)
def test_sshd_readback_patterns(script, sshd_t, wildcard_ok, canary_ok) -> None:
    patterns = DENY_PATTERNS.findall(script.read_text(encoding="utf-8"))
    assert len(patterns) == 2, patterns
    wildcard, canary = sorted(patterns, key=lambda p: "\\*" not in p)
    for pattern, expected in ((wildcard, wildcard_ok), (canary, canary_ok)):
        found = subprocess.run(["grep", "-qiE", pattern], input=sshd_t, text=True).returncode == 0
        assert found is expected, (pattern, sshd_t)


def _bash4():
    for candidate in ("bash", "/opt/homebrew/bin/bash", "/usr/local/bin/bash"):
        path = shutil.which(candidate)
        if path and subprocess.run([path, "-c", "((BASH_VERSINFO[0] >= 4))"]).returncode == 0:
            return path
    return None


def _handoff_subshell(exec_line: str) -> str:
    """The loop's runner subshell, with the host-only lines swapped for test doubles."""
    text = SLOT.read_text(encoding="utf-8")
    start = text.index("  (\n    lang=")
    end = text.index("  ) || rc=$?", start)
    block = text[start:end] + "  ) || rc=$?\n"
    swaps = {
        'login_shell="$(getent passwd "$u" | cut -d: -f7)" || exit 1': "login_shell=/usr/sbin/nologin",
        'echo "$BASHPID" > "$job_cg/cgroup.procs" || exit 1': ":",
        'cd "/home/$u" || exit 1': ":",
        'exec setpriv --reuid="$u" --regid="$u" --init-groups "$slot/run.sh"': exec_line,
    }
    for old, new in swaps.items():
        assert block.count(old) == 1, old
        block = block.replace(old, new)
    return block


def test_handoff_subshell_passes_only_the_intended_environment() -> None:
    bash = _bash4()
    if bash is None:
        pytest.skip("needs bash >= 4 (mapfile)")
    script = (
        "set -euo pipefail\nexport LEAK_VAR=secret-looking OTHER=1\nleak_fn() { :; }\nexport -f leak_fn\n"
        "u=ghrunner-1; slot=/nonexistent; job_cg=/nonexistent; jit=DUMMY; rc=0\n"
        + _handoff_subshell("exec env")
        + 'echo "rc=$rc"\n'
    )
    out = subprocess.run([bash, "-c", script], capture_output=True, text=True, check=True).stdout
    lines = out.splitlines()
    assert lines[-1] == "rc=0"
    env = dict(line.split("=", 1) for line in lines[:-1])
    # bash may add "_" (the command path) to an exec'd command's environment; nothing else
    assert set(env) - {"_"} == {"HOME", "USER", "LOGNAME", "LANG", "SHELL", "PATH", "ACTIONS_RUNNER_INPUT_JITCONFIG"}
    assert env["ACTIONS_RUNNER_INPUT_JITCONFIG"] == "DUMMY"
    assert env["HOME"] == "/home/ghrunner-1" and env["SHELL"] == "/usr/sbin/nologin"
    assert env["PATH"] == "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"


def test_handoff_subshell_fails_closed_when_the_purge_leaves_a_survivor() -> None:
    bash = _bash4()
    if bash is None:
        pytest.skip("needs bash >= 4 (mapfile)")
    # a readonly exported variable cannot be unset: the subshell must exit before exec
    script = (
        "export STUCK=1; readonly STUCK\nu=ghrunner-1; slot=/x; job_cg=/x; jit=DUMMY; rc=0\n"
        + _handoff_subshell("exec env")
        + 'echo "rc=$rc"\n'
    )
    out = subprocess.run([bash, "-c", script], capture_output=True, text=True).stdout
    assert out.splitlines()[-1] == "rc=1"
    assert "ACTIONS_RUNNER_INPUT_JITCONFIG" not in out


def test_runbook_points_at_the_host_files() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")
    assert "ops/terminal-e2e-lane/" in text


# --- mint-jitconfig against a fake API -----------------------------------------------------

MISSING = object()


def runner(rid=7, name=NAME, status="offline", busy=False, labels=("self-hosted", "Linux", "X64", "ubuntu0-e2e")):
    r = {"id": rid, "name": name, "status": status, "labels": [{"name": label} for label in labels]}
    if busy is not MISSING:
        r["busy"] = busy
    return r


class FakeAPI:
    def __init__(self, posts, org=(), group=None, delete_status=204, totals=None):
        self.posts = list(posts)
        self.org = list(org)
        self.group = list(self.org if group is None else group)
        self.delete_status = delete_status
        self.totals = totals or {}
        self.calls: list[tuple[str, str]] = []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path))
        if method == "POST":
            return self.posts.pop(0)
        if method == "DELETE":
            return self.delete_status, None
        split = urlsplit(path)
        query = parse_qs(split.query)
        page, per_page = int(query["page"][0]), int(query["per_page"][0])
        if split.path == f"/orgs/{ORG}/actions/runners":
            kind, items = "org", self.org
        elif split.path == f"/orgs/{ORG}/actions/runner-groups/{GID}/runners":
            kind, items = "group", self.group
        else:
            raise AssertionError(f"unexpected GET {path}")
        chunk = items[(page - 1) * per_page: page * per_page]
        return 200, {"total_count": self.totals.get(kind, len(items)), "runners": chunk}

    @property
    def deletes(self):
        return [path for method, path in self.calls if method == "DELETE"]


def load_mint():
    loader = SourceFileLoader("mint_jitconfig_under_test", str(MINT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def run_mint(api, capsys, name=NAME, labels=LABELS, per_page=None):
    mint = load_mint()
    mint._call = api
    if per_page:
        mint.PER_PAGE = per_page
    code = 0
    try:
        mint.mint(name, labels, GID)
    except SystemExit as exc:
        code = exc.code
    out = capsys.readouterr().out
    return code, out


OK = (201, {"encoded_jit_config": "JIT-BLOB"})
CONFLICT = (409, None)


def test_mint_writes_only_the_config(capsys) -> None:
    api = FakeAPI([OK])
    assert run_mint(api, capsys) == (0, "JIT-BLOB")


def test_409_deletes_the_one_stale_offline_idle_registration(capsys) -> None:
    api = FakeAPI([CONFLICT, OK], org=[runner()])
    assert run_mint(api, capsys) == (0, "JIT-BLOB")
    assert api.deletes == [f"/orgs/{ORG}/actions/runners/7"]


def test_409_candidate_found_on_a_later_page(capsys) -> None:
    others = [runner(rid=100 + i, name=f"other-{i}") for i in range(5)]
    api = FakeAPI([CONFLICT, OK], org=[runner()], group=others + [runner()])
    assert run_mint(api, capsys, per_page=2) == (0, "JIT-BLOB")
    assert api.deletes == [f"/orgs/{ORG}/actions/runners/7"]


@pytest.mark.parametrize(
    "org, group",
    [
        ([runner(busy=True)], None),
        ([runner(busy=MISSING)], None),
        ([runner(busy=None)], None),
        ([runner(status="online")], None),
        ([runner(), runner(rid=8)], None),
        ([runner()], []),  # not in this lane's group
        ([runner(labels=("self-hosted", "Linux", "X64", "ubuntu0-e2e", "extra"))], None),
        ([runner(labels=("self-hosted", "Linux", "X64"))], None),
        ([runner(rid=True)], None),
        ([runner(rid="7")], None),
    ],
    ids=["busy", "busy-missing", "busy-null", "online", "duplicate", "foreign-group",
         "extra-label", "missing-label", "bool-id", "string-id"],
)
def test_409_never_deletes_an_unproven_registration(capsys, org, group) -> None:
    api = FakeAPI([CONFLICT, OK], org=org, group=group)
    code, out = run_mint(api, capsys)
    assert (code, out) == (3, "")
    assert api.deletes == []


def test_409_without_candidate_retries_once_then_backs_off(capsys) -> None:
    api = FakeAPI([CONFLICT, CONFLICT], org=[])
    assert run_mint(api, capsys) == (75, "")
    assert api.deletes == []


def test_incomplete_pagination_is_never_used(capsys) -> None:
    api = FakeAPI([CONFLICT, OK], org=[runner()], totals={"group": 150})
    code, out = run_mint(api, capsys, per_page=2)
    assert (code, out) == (75, "")
    assert api.deletes == []


@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_api_failures_are_transient(capsys, status) -> None:
    assert run_mint(FakeAPI([(status, None)]), capsys) == (75, "")


@pytest.mark.parametrize("status", [401, 403, 404, 422])
def test_credential_or_group_refusals_stop_the_slot(capsys, status) -> None:
    assert run_mint(FakeAPI([(status, None)]), capsys) == (3, "")


def test_permanent_refusal_while_listing_stops_the_slot(capsys) -> None:
    api = FakeAPI([CONFLICT, OK], org=[runner()])
    real = api.__call__

    def call(method, path, body=None):
        if method == "GET":
            api.calls.append((method, path))
            return 404, None
        return real(method, path, body)

    assert run_mint(call, capsys) == (3, "")
    assert api.deletes == []


@pytest.mark.parametrize(
    "headers, expected",
    [({"Retry-After": "60"}, 429), ({"X-RateLimit-Remaining": "0"}, 429), ({}, 403)],
    ids=["retry-after", "quota-exhausted", "plain-403"],
)
def test_rate_limited_403_is_reported_as_429(monkeypatch, headers, expected) -> None:
    mint = load_mint()
    monkeypatch.setattr(mint, "_token", lambda: "t")
    message = email.message.Message()
    for key, value in headers.items():
        message[key] = value

    def refuse(*_args, **_kwargs):
        raise mint.urllib.error.HTTPError("https://api.github.com/x", 403, "Forbidden", message, None)

    monkeypatch.setattr(mint.urllib.request, "urlopen", refuse)
    assert mint._call("GET", "/x") == (expected, None)


def test_failed_delete_backs_off_without_reminting(capsys) -> None:
    api = FakeAPI([CONFLICT, OK], org=[runner()], delete_status=500)
    assert run_mint(api, capsys) == (75, "")
    assert len(api.posts) == 1


@pytest.mark.parametrize("name, labels", [("ubuntu0-e2e-0", LABELS), ("ghrunner-1", LABELS), (NAME, "self-hosted,linux")])
def test_bad_input_is_refused_before_any_call(capsys, name, labels) -> None:
    api = FakeAPI([OK])
    assert run_mint(api, capsys, name=name, labels=labels) == (2, "")
    assert api.calls == []


def test_network_error_is_transient(capsys, monkeypatch) -> None:
    mint = load_mint()
    monkeypatch.setattr(mint, "_token", lambda: "t")

    def refuse(*_args, **_kwargs):
        raise mint.urllib.error.URLError("down")

    monkeypatch.setattr(mint.urllib.request, "urlopen", refuse)
    with pytest.raises(SystemExit) as exc:
        mint.mint(NAME, LABELS, GID)
    assert exc.value.code == 75
    assert capsys.readouterr().out == ""
