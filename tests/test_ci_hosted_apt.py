"""Hosted mirror repair changes transport only and cannot admit missing fonts."""
import importlib.util
import os
from pathlib import Path
import subprocess
import stat
from types import SimpleNamespace

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "terminal_hosted_apt", ROOT / ".github/scripts/terminal_hosted_apt.py"
)
APT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APT)
MIRROR = "mirror+file:/etc/apt/apt-mirrors.txt"
SOURCES = f"""# Ubuntu base sources
Types: deb
URIs: {MIRROR}
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Architectures: amd64
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

# Security retains its own archive
Types: deb
URIs: {MIRROR}
Suites: noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
"""


@pytest.mark.parametrize("uri", sorted(APT.MIRRORS))
@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_known_mirror_changes_only_uris_and_is_idempotent(uri, newline):
    original = SOURCES.replace(MIRROR, uri).replace("\n", newline)
    wanted = original.replace(uri, "https://archive.ubuntu.com/ubuntu/", 1)
    wanted = wanted.replace(uri, "https://security.ubuntu.com/ubuntu/", 1)
    actual = APT.direct_ubuntu_sources(original)
    assert actual == wanted
    assert APT.direct_ubuntu_sources(actual) == actual
    assert [s for s in actual.splitlines() if not s.startswith("URIs:")] == [
        s for s in original.splitlines() if not s.startswith("URIs:")
    ]


@pytest.mark.parametrize("bad", [
    SOURCES.replace(MIRROR, "https://unrecognized.example/ubuntu"),
    SOURCES.replace(MIRROR, MIRROR + " https://archive.ubuntu.com/ubuntu/"),
    SOURCES.replace("Suites: noble-security", "Suites: noble noble-security"),
    SOURCES.replace("noble-backports", "noble-proposed"),
    SOURCES.replace("Suites: noble-security", "Suites: noble-security noble-security"),
    SOURCES.replace("URIs:", "URIs: duplicate\nURIs:", 1),
    SOURCES.replace("URIs:", "URIs: duplicate\nuris:", 1),
    SOURCES.replace("Suites:", "Suites: duplicate\nSuites:", 1),
    SOURCES.replace("Types: deb", "malformed", 1),
    SOURCES.replace(MIRROR, "\n " + MIRROR, 1),
    SOURCES.replace("Suites: noble-security", "Suites: noble-security\n noble"),
    SOURCES.replace("URIs:", "Unknown:", 1),
    "# no active source\n",
])
def test_unknown_or_ambiguous_source_is_rejected_before_any_write(bad):
    with pytest.raises(ValueError):
        APT.direct_ubuntu_sources(bad)


def test_spacing_comments_multiline_key_and_other_options_are_preserved():
    original = SOURCES.replace("URIs: ", "URIs:\t  ").replace(
        "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
        "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n # retained comment",
    )
    actual = APT.direct_ubuntu_sources(original)
    assert actual == original.replace(MIRROR, "https://archive.ubuntu.com/ubuntu/", 1).replace(
        MIRROR, "https://security.ubuntu.com/ubuntu/", 1
    )


HOSTED = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
          "RUNNER_OS": "Linux", "RUNNER_ARCH": "X64"}


def test_only_the_actual_hosted_noble_x64_context_is_admitted():
    APT.validate_runner(HOSTED, {"ID": "ubuntu", "VERSION_ID": "24.04"}, "x86_64")
    for key in HOSTED:
        for value in (None, "", "self-hosted", "false"):
            env = dict(HOSTED)
            if value is None:
                del env[key]
            else:
                env[key] = value
            with pytest.raises(ValueError):
                APT.validate_runner(env, {"ID": "ubuntu", "VERSION_ID": "24.04"}, "x86_64")
    for release, machine in [({"ID": "debian", "VERSION_ID": "24.04"}, "x86_64"),
                             ({"ID": "ubuntu", "VERSION_ID": "22.04"}, "x86_64"),
                             ({"ID": "ubuntu", "VERSION_ID": "24.04"}, "aarch64")]:
        with pytest.raises(ValueError):
            APT.validate_runner(HOSTED, release, machine)


@pytest.mark.parametrize(("field", "value"), [
    ("st_dev", 2), ("st_ino", 2), ("st_nlink", 0), ("st_nlink", 2),
    ("st_uid", 1001), ("st_mode", stat.S_IFLNK | 0o644),
])
@pytest.mark.parametrize("changed", ["opened", "named"])
def test_replacement_unlink_or_custody_change_cannot_pass_readback(field, value, changed):
    original = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_dev=1, st_ino=1,
                               st_nlink=1, st_uid=0)
    opened = SimpleNamespace(**vars(original))
    named = SimpleNamespace(**vars(original))
    APT.validate_source_identity(original, opened, named)
    setattr(opened if changed == "opened" else named, field, value)
    with pytest.raises(ValueError):
        APT.validate_source_identity(original, opened, named)


def test_workflow_keeps_dependency_failures_required_and_fleet_untouched():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    for job_id in ("terminal-e2e", "terminal-e2e-prodbuild"):
        steps = workflow["jobs"][job_id]["steps"]
        prepare_i, prepare = next((i, s) for i, s in enumerate(steps)
                                  if s.get("name") == "Prepare hosted Ubuntu browser dependencies")
        install_i, install = next((i, s) for i, s in enumerate(steps)
                                  if s.get("name") == "Ensure browser present on cache hit")
        verify_i, verify = next((i, s) for i, s in enumerate(steps)
                                if s.get("name") == "Verify hosted Chromium system dependencies")
        assert prepare_i < install_i < verify_i
        assert "--preserve-env=GITHUB_ACTIONS,RUNNER_ENVIRONMENT,RUNNER_OS,RUNNER_ARCH" in prepare["run"]
        assert "timeout --signal=TERM --kill-after=15s 240s npx playwright install --with-deps chromium" in install["run"]
        assert install["timeout-minutes"] == 6
        assert verify["run"] == "timeout --signal=TERM --kill-after=15s 30s env LC_ALL=C npx playwright install-deps --dry-run chromium"
        for step in (prepare, install, verify):
            assert not step.get("continue-on-error", False)
        assert prepare["timeout-minutes"] == verify["timeout-minutes"] == 1
        if job_id == "terminal-e2e":
            assert prepare["if"] == verify["if"] == "env.TERMINAL_E2E_LANE == 'hosted'"
            consumer_i = next(i for i, s in enumerate(steps)
                              if s.get("run", "").startswith("npm run test:e2e:responsive --"))
            assert "else\n  npx playwright install chromium\nfi" in install["run"]
        else:
            assert workflow["jobs"][job_id]["runs-on"] == "ubuntu-24.04"
            assert "if" not in prepare and "if" not in verify
            consumer_i = next(i for i, s in enumerate(steps)
                              if s.get("name") == "Download production build artifact (this run only)")
        assert verify_i < consumer_i


@pytest.mark.parametrize("exit_code", [0, 1, 124, 137])
def test_actual_postcondition_shell_cannot_reach_tests_after_failure(exit_code):
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    step = next(s for s in workflow["jobs"]["terminal-e2e"]["steps"]
                if s.get("name") == "Verify hosted Chromium system dependencies")
    mock = "timeout() { [ \"$*\" = '--signal=TERM --kill-after=15s 30s env LC_ALL=C npx playwright install-deps --dry-run chromium' ] || return 99; return \"$VERIFY_TEST_EXIT\"; }\n"
    result = subprocess.run(["bash", "-e", "-c", mock + step["run"] + "\necho REACHED_TESTS\n"],
                            env=dict(os.environ, VERIFY_TEST_EXIT=str(exit_code)),
                            capture_output=True, text=True, timeout=5)
    assert (result.returncode == 0) is (exit_code == 0)
    assert ("REACHED_TESTS" in result.stdout) is (exit_code == 0)
