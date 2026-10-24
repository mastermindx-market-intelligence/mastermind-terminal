"""Hermetic production activation: real owner helpers/local Git, no host effects."""
from pathlib import Path
import os
import shlex
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ops/terminal-build.sh"
INSTALLED = "/etc/systemd/system/terminal.service.d/shared-shell.conf"
CANONICAL = b"[Service]\nEnvironment=MMX_SHARED_SHELL_BUILD=1\n"


@pytest.fixture
def host(tmp_path):
    repo = tmp_path / "repo"
    (repo / "ops").mkdir(parents=True)
    (repo / "ops/terminal-shared-shell.conf").write_bytes(CANONICAL)
    (repo / "terminal").mkdir()
    (repo / "terminal/package.json").write_text('{"scripts":{"start":"next start"}}')
    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()
    git("init", "-q")
    git("add", ".")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "canonical activation")
    sha = git("rev-parse", "HEAD")
    installed = tmp_path / "systemd/shared-shell.conf"
    installed.parent.mkdir(mode=0o755)
    script = tmp_path / "terminal-build.sh"
    script.write_text(SOURCE.read_text().replace(INSTALLED, str(installed)))
    binary = tmp_path / "bin"
    binary.mkdir()
    systemctl = binary / "systemctl"
    systemctl.write_text("""#!/bin/sh
if [ "$1" = show-environment ]; then printf '%s\\n' "$FIXTURE_MANAGER_ENV"; exit 0; fi
case "$3" in
 Environment) printf '%s\\n' "$FIXTURE_UNIT_ENV" ;;
 EnvironmentFiles) printf '%s\\n' "$FIXTURE_ENV_FILES" ;;
 PassEnvironment) printf '%s\\n' "$FIXTURE_PASS_ENV" ;;
 UnsetEnvironment) printf '%s\\n' "$FIXTURE_UNSET_ENV" ;;
 ExecStart) printf '%s\\n' "${FIXTURE_EXEC_START:-{ path=/usr/bin/npm ; argv[]=/usr/bin/npm run start ; }}" ;;
esac
""")
    systemctl.chmod(0o755)
    def run(body, unit="", target="production", props=None):
        return subprocess.run(["bash", "-c", f'. {shlex.quote(str(script))}\nset +e\n'
                               f'TARGET={target}\nSRC={shlex.quote(str(repo))}\nFULL_SHA={sha}\n'+body],
                              text=True, capture_output=True, timeout=20,
                              env={**os.environ, "PATH":str(binary)+os.pathsep+os.environ["PATH"],
                                   "FIXTURE_UNIT_ENV":unit, **(props or {})})
    return repo, installed, run


def test_production_absent_activation_stays_off_despite_caller(host):
    _, _, run = host
    result = run('export MMX_SHARED_SHELL=1; apply_profile_environment; '
                 'apply_production_shared_shell_profile; echo "VALUE=${MMX_SHARED_SHELL-unset}"')
    assert result.returncode == 0, result.stderr
    assert "VALUE=unset" in result.stdout


def test_exact_source_owned_activation_pins_new_build_only(host):
    _, installed, run = host
    installed.write_bytes(CANONICAL)
    result = run('apply_production_shared_shell_profile; production_shared_shell_profile_unchanged; '
                 'echo "VALUE=$MMX_SHARED_SHELL"', "MMX_SHARED_SHELL_BUILD=1")
    assert result.returncode == 0, result.stderr
    assert "VALUE=1" in result.stdout
    assert b"Environment=MMX_SHARED_SHELL=1" not in CANONICAL
    assert (ROOT / "ops/terminal-shared-shell.conf").read_bytes() == CANONICAL


@pytest.mark.parametrize("kind", ["missing_file", "missing_unit", "modified", "symlink",
                                   "writable_file", "writable_directory", "missing_blob", "runtime_flag"])
def test_unqualified_activation_refuses(host, kind):
    repo, installed, run = host
    installed.write_bytes(CANONICAL)
    unit = "MMX_SHARED_SHELL_BUILD=1"
    if kind == "missing_file": installed.unlink()
    elif kind == "missing_unit": unit = ""
    elif kind == "modified": installed.write_bytes(CANONICAL+b"Environment=OTHER=1\n")
    elif kind == "symlink":
        installed.unlink(); installed.symlink_to(repo / "ops/terminal-shared-shell.conf")
    elif kind == "writable_file": installed.chmod(0o666)
    elif kind == "writable_directory": installed.parent.chmod(0o777)
    elif kind == "missing_blob":
        subprocess.run(["git", "-C", str(repo), "rm", "-q", "ops/terminal-shared-shell.conf"], check=True)
        subprocess.run(["git", "-C", str(repo), "-c", "user.name=Fixture", "-c",
                        "user.email=fixture@example.test", "commit", "-qm", "withdraw source"], check=True)
    elif kind == "runtime_flag": unit += " MMX_SHARED_SHELL=1"
    body = 'production_shared_shell_state'
    if kind == "missing_blob": body = 'FULL_SHA=$(git -C "$SRC" rev-parse HEAD); '+body
    result = run(body, unit)
    assert result.returncode == 65, (kind, result.stdout, result.stderr)
    assert "not source/unit/custody qualified" in result.stderr


def test_beta_does_not_read_production_activation(host):
    _, installed, run = host
    installed.write_bytes(b"unrelated malformed production configuration")
    result = run('apply_profile_environment; apply_production_shared_shell_profile; '
                 'echo "VALUE=$MMX_SHARED_SHELL"', target="beta")
    assert result.returncode == 0, result.stderr
    assert "VALUE=1" in result.stdout


def test_activation_changed_during_build_refuses(host):
    _, installed, run = host
    installed.write_bytes(CANONICAL)
    result = run('PRODUCTION_SHARED_SHELL_ENABLED=0; production_shared_shell_profile_unchanged',
                 "MMX_SHARED_SHELL_BUILD=1")
    assert result.returncode == 65, result.stdout + result.stderr


def test_source_orders_admission_and_tuple_before_generation_commit():
    source = SOURCE.read_text()
    main = source[source.index('TARGET_REQUESTED=production'):]
    identity = main.index('[ "$FULL_SHA" = "$TARGET_SHA" ]')
    apply = main.index('apply_production_shared_shell_profile || exit $?')
    build = main.index('npm run build')
    recheck = main.index('if ! production_shared_shell_profile_unchanged; then')
    restart = main.index('if ! systemctl restart terminal; then')
    tuple_check = main.index('if ! shared_shell_status_verified "http://127.0.0.1:3000/api/shared-shell/status"')
    commit = main.index('deploy_generation_commit "$APP"')
    assert identity < apply < build < recheck < restart < tuple_check < commit
    config = (ROOT / 'terminal/next.config.ts').read_text()
    assert 'MMX_SHARED_SHELL: process.env.MMX_SHARED_SHELL === "1" ? "1" : "0"' in config

@pytest.mark.parametrize("indirection", ["manager", "pass", "unset", "file", "dotenv", "wrapper", "unknown_file_topology"])
def test_indirect_runtime_feature_sources_are_not_silently_ignored(host, indirection):
    repo, installed, run = host
    installed.write_bytes(CANONICAL)
    props = {}
    if indirection == "manager": props["FIXTURE_MANAGER_ENV"] = "MMX_SHARED_SHELL=1"
    elif indirection == "pass": props["FIXTURE_PASS_ENV"] = "MMX_SHARED_SHELL"
    elif indirection == "unset": props["FIXTURE_UNSET_ENV"] = "MMX_SHARED_SHELL_BUILD"
    elif indirection == "wrapper": props["FIXTURE_EXEC_START"] = "{ path=/usr/bin/env ; argv[]=/usr/bin/env MMX_SHARED_SHELL=1 npm run start ; }"
    elif indirection == "unknown_file_topology": props["FIXTURE_ENV_FILES"] = "unparsed topology"
    else:
        env_file = repo.parent / "credentials.env"
        if indirection == "dotenv":
            env_file = repo.parent / "terminal/.env.production.local"
            env_file.parent.mkdir(exist_ok=True)
        else: props["FIXTURE_ENV_FILES"] = str(env_file) + " (ignore_errors=no)"
        env_file.write_text("OTHER_SECRET=fixture-never-log\nexport MMX_SHARED_SHELL=1\n")
    result = run('production_shared_shell_state', "MMX_SHARED_SHELL_BUILD=1", props=props)
    assert result.returncode == 65, (indirection, result.stdout, result.stderr)
    assert "fixture-never-log" not in result.stdout + result.stderr


def test_legitimate_nonfeature_credentials_file_is_preserved(host):
    repo, installed, run = host
    installed.write_bytes(CANONICAL)
    env_file = repo.parent / 'credentials.env'
    env_file.write_text('OTHER_SECRET=fixture-never-log\n')
    result = run('production_shared_shell_state', 'MMX_SHARED_SHELL_BUILD=1',
                 props={'FIXTURE_ENV_FILES':str(env_file) + ' (ignore_errors=no)'})
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == '1'
    assert 'fixture-never-log' not in result.stdout + result.stderr
