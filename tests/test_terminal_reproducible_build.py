"""W2B-B contracts for isolated, receipted Terminal builds.

These tests keep the single incumbent deploy owner but force its expensive build
phase to become an immutable-input operation before any live-generation or
canonical-working-tree convergence effect.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "ops" / "terminal-build.sh"
RECEIPT_HELPER = REPO / "ops" / "terminal_build_receipt.py"


def _text() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def _main() -> str:
    text = _text()
    return text[text.rindex('if [ "${BASH_SOURCE[0]}" != "$0" ]') :]


def test_deploy_owner_serializes_before_preflight() -> None:
    body = _main()
    lock = body.index("acquire_deploy_lock")
    preflight = body.index("run_release_preflight")
    assert lock < preflight
    assert "BUILD_LOCK_DIR=/run/mastermind-terminal" in _text()
    assert 'BUILD_LOCK_FILE="$BUILD_LOCK_DIR/deploy.lock"' in _text()
    assert 'EXPECTED_FLOCK_PATH="/usr/bin/flock"' in _text()
    assert '"$EXPECTED_FLOCK_PATH" -n 9' in _text()


def test_exact_production_build_runtime_is_a_fail_closed_contract() -> None:
    text = _text()
    for token in (
        'EXPECTED_NODE_VERSION="v20.20.2"',
        'EXPECTED_NPM_VERSION="10.8.2"',
        'EXPECTED_BUILD_OS="Linux"',
        'EXPECTED_BUILD_ARCH="x86_64"',
        'EXPECTED_OS_ID="ubuntu"',
        'EXPECTED_OS_VERSION_ID="24.04"',
        'EXPECTED_LIBC="glibc 2.39"',
        "verify_build_runtime",
    ):
        assert token in text


def test_isolated_build_materializes_exact_object_before_checkout_convergence() -> None:
    body = _main()
    projection = body.index("materialize_build_projection")
    build = body.index("run_isolated_terminal_build")
    receipt = body.index("publish_build_receipt")
    reset = body.index('"$EXPECTED_GIT_PATH" -C "$SRC" reset -q --hard "$TARGET_SHA"')
    clean = body.index('"$EXPECTED_GIT_PATH" -C "$SRC" clean -qfd')
    generation = body.index('deploy_generation_begin "$APP"')
    assert projection < build < receipt < reset < clean < generation


def test_build_never_reuses_live_dependencies_or_falls_back_to_npm_install() -> None:
    body = _main()
    build_prefix = body[: body.index("publish_build_receipt")]
    assert 'cp -al "$APP/node_modules"' not in build_prefix
    assert "npm ci || npm install" not in build_prefix
    assert "npm install" not in build_prefix
    assert "run_isolated_terminal_build" in build_prefix
    library = _text()
    assert 'npm ci' in library


def test_build_does_not_consume_live_runtime_data_or_whole_secret_env_files() -> None:
    body = _main()
    before_receipt = body[: body.index("publish_build_receipt")]
    assert 'cp -al "$APP/public/data"' not in before_receipt
    assert 'rsync -a "$APP/public/data/' not in before_receipt
    assert 'cp -a "$APP/.env"' not in before_receipt
    assert 'cp -a "$APP/.env.local"' not in before_receipt
    assert 'ln -s "$(dirname "$APP")/scripts"' not in before_receipt
    assert "npm run build" not in before_receipt


def test_public_build_env_is_allowlisted_and_receipted_without_values() -> None:
    text = _text()
    assert "NEXT_PUBLIC_SUPABASE_URL" in text
    assert "NEXT_PUBLIC_SUPABASE_ANON_KEY" in text
    assert "BUILD_PUBLIC_ENV_IDENTITY" in text
    assert "prepare_public_build_env" in text


def test_next_build_key_cache_is_an_explicit_input_not_a_new_secret_store() -> None:
    text = _text()
    assert ".previewinfo" in text
    assert ".rscinfo" in text
    assert "prepare_next_build_keys" in text
    assert "BUILD_KEY_IDENTITY" in text


def test_build_receipt_helper_is_versioned_and_computes_serving_digest() -> None:
    assert RECEIPT_HELPER.is_file()
    spec = importlib.util.spec_from_file_location("terminal_build_receipt", RECEIPT_HELPER)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.SCHEMA == "mastermind.terminal.build_receipt.v1"
    assert callable(module.compute_serving_digest)
    assert callable(module.publish_receipt)


def test_build_receipt_is_published_before_any_live_generation_effect() -> None:
    body = _main()
    receipt = body.index("publish_build_receipt")
    for token in (
        '"$EXPECTED_GIT_PATH" -C "$SRC" reset -q --hard "$TARGET_SHA"',
        'deploy_generation_begin "$APP"',
        'mv "$STAGE/.next" "$APP/.next"',
        '"$EXPECTED_SYSTEMCTL_PATH" restart terminal',
    ):
        assert receipt < body.index(token)



def _bash() -> str:
    found = shutil.which("bash")
    assert found
    return found


def _run_library(body: str) -> subprocess.CompletedProcess[str]:
    driver = textwrap.dedent(
        f"""
        . "{SCRIPT}"
        set +e
        {textwrap.dedent(body)}
        """
    )
    return subprocess.run([_bash(), "-c", driver], capture_output=True, text=True, timeout=30)


def test_deploy_lock_rejects_symlink_before_opening_as_root(tmp_path: Path) -> None:
    lock_dir = tmp_path / "lock"
    lock_dir.mkdir(mode=0o755)
    victim = tmp_path / "victim"
    victim.write_text("preserve-me\n", encoding="utf-8")
    lock_file = lock_dir / "deploy.lock"
    lock_file.symlink_to(victim)
    result = _run_library(
        f"""
        BUILD_LOCK_DIR={str(lock_dir)!r}
        BUILD_LOCK_FILE={str(lock_file)!r}
        EXPECTED_LOCK_UID={os.getuid()}
        EXPECTED_LOCK_GID={os.getgid()}
        acquire_deploy_lock
        rc=$?
        printf 'RC=%s\\n' "$rc"
        exit "$rc"
        """
    )
    assert result.returncode == 73, result.stdout + result.stderr
    assert victim.read_text(encoding="utf-8") == "preserve-me\n"


def test_runtime_contract_pins_binary_paths_as_well_as_versions() -> None:
    text = _text()
    assert 'EXPECTED_NODE_PATH="/usr/bin/node"' in text
    assert 'EXPECTED_NPM_PATH="/usr/bin/npm"' in text
    assert 'EXPECTED_FLOCK_PATH="/usr/bin/flock"' in text
    assert 'EXPECTED_SYSTEMD_RUN_PATH="/usr/bin/systemd-run"' in text
    assert 'EXPECTED_GIT_PATH="/usr/bin/git"' in text
    assert 'EXPECTED_PYTHON_PATH="/usr/bin/python3"' in text


def test_dependency_and_next_build_run_under_closed_environment() -> None:
    text = _text()
    start = text.index("run_isolated_terminal_build(){")
    end = text.index("\npublish_build_receipt(){", start)
    body = text[start:end]
    assert body.count('"$EXPECTED_ENV_PATH" -i') == 2
    assert 'PATH="$CLEAN_BUILD_PATH"' in body
    assert 'NPM_CONFIG_USERCONFIG="$npm_userconfig"' in body
    assert 'NPM_CONFIG_GLOBALCONFIG="$npm_globalconfig"' in body
    assert 'npm_userconfig="$BUILD_HOME_DIR/.npm-userconfig"' in body
    assert 'npm_globalconfig="$BUILD_HOME_DIR/.npm-globalconfig"' in body
    assert '"$EXPECTED_NPM_PATH" ci' in body
    assert 'NODE_ENV=production' in body


def test_build_receipt_enforces_same_input_reproducibility_and_readback() -> None:
    text = RECEIPT_HELPER.read_text(encoding="utf-8")
    assert "_enforce_reproducibility" in text
    assert "non-reproducible serving output for identical build inputs" in text
    assert "published build receipt readback disagrees" in text


def test_build_receipt_summary_is_bound_to_dedicated_receipt_root() -> None:
    text = _text()
    assert '"$summary_file" "$TARGET_SHA" "$BUILD_RECEIPT_DIR"' in text
    assert 'path.parent != receipt_root' in text



def test_missing_next_build_key_pair_rotates_only_inside_isolated_stage(tmp_path: Path) -> None:
    live = tmp_path / "live"
    stage = tmp_path / "stage"
    identity = tmp_path / "identity.json"
    (live / ".next" / "cache").mkdir(parents=True)
    stage.mkdir()
    result = _run_library(
        f'prepare_next_build_keys "{live}" "{stage}" "{identity}"'
    )
    assert result.returncode == 0, result.stdout + result.stderr
    evidence = json.loads(identity.read_text(encoding="utf-8"))
    assert evidence["source"] == "rotated"
    assert set(evidence["files"]) == {".previewinfo", ".rscinfo"}
    assert (stage / ".next" / "cache" / ".previewinfo").is_file()
    assert (stage / ".next" / "cache" / ".rscinfo").is_file()
    assert not list((live / ".next" / "cache").iterdir())


def test_partial_next_build_key_pair_is_unknown_stop_not_rotation(tmp_path: Path) -> None:
    live = tmp_path / "live"
    stage = tmp_path / "stage"
    identity = tmp_path / "identity.json"
    cache = live / ".next" / "cache"
    cache.mkdir(parents=True)
    stage.mkdir()
    (cache / ".previewinfo").write_text("{}\n", encoding="utf-8")
    result = _run_library(
        f'prepare_next_build_keys "{live}" "{stage}" "{identity}"'
    )
    assert result.returncode == 64, result.stdout + result.stderr
    assert "could not prepare explicit Next build-key inputs" in result.stdout
    assert not identity.exists()


def test_symlinked_next_build_key_pair_is_unknown_stop_not_rotation(tmp_path: Path) -> None:
    live = tmp_path / "live"
    stage = tmp_path / "stage"
    identity = tmp_path / "identity.json"
    cache = live / ".next" / "cache"
    cache.mkdir(parents=True)
    stage.mkdir()
    victim = tmp_path / "victim"
    victim.write_text("{}\n", encoding="utf-8")
    (cache / ".previewinfo").symlink_to(victim)
    (cache / ".rscinfo").symlink_to(victim)
    result = _run_library(
        f'prepare_next_build_keys "{live}" "{stage}" "{identity}"'
    )
    assert result.returncode == 64, result.stdout + result.stderr
    assert "could not prepare explicit Next build-key inputs" in result.stdout
    assert victim.read_text(encoding="utf-8") == "{}\n"
    assert not identity.exists()


def _write_executable(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\nset -eu\n" + body, encoding="utf-8")
    path.chmod(0o755)


def _systemd_shim(path: Path) -> Path:
    _write_executable(
        path,
        """
working=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --working-directory=*) working=${1#*=} ;;
    --) shift; break ;;
  esac
  shift
done
[ -n "$working" ] && cd "$working"
exec "$@"
""",
    )
    return path


def _sandbox_globals(tmp_path: Path, stage: Path, stage_root: Path, live: Path) -> tuple[Path, str]:
    deps = stage_root / "deps"
    home = stage_root / "home"
    cache = stage_root / "cache"
    private_tmp = stage_root / "tmp"
    evidence = stage_root / "evidence"
    for path in (deps, home, cache, private_tmp, evidence):
        path.mkdir(exist_ok=True)
    (evidence / "package.json").write_text("{}\n", encoding="utf-8")
    (evidence / "package-lock.json").write_text('{"lockfileVersion":3}\n', encoding="utf-8")
    shim = _systemd_shim(tmp_path / "systemd-run")
    assignments = "\n".join(
        (
            f"EXPECTED_BUILD_UID={os.getuid()}",
            f"EXPECTED_BUILD_GID={os.getgid()}",
            f"EXPECTED_SYSTEMD_RUN_PATH={str(shim)!r}",
            f"EXPECTED_ENV_PATH={shutil.which('env')!r}",
            f"BUILD_DEPS_ROOT={str(deps)!r}",
            f"BUILD_HOME_DIR={str(home)!r}",
            f"BUILD_NPM_CACHE={str(cache)!r}",
            f"BUILD_TMP_DIR={str(private_tmp)!r}",
            f"BUILD_EVIDENCE_DIR={str(evidence)!r}",
            f"BUILD_SOURCE_ROOT={str(stage.parent)!r}",
            f"APP={str(live)!r}",
            f"SRC={str(tmp_path / 'source-owner')!r}",
            f"PREFLIGHT_RECEIPT_DIR={str(tmp_path / 'preflight')!r}",
            f"BUILD_RECEIPT_DIR={str(tmp_path / 'receipts')!r}",
            f"BUILD_LOCK_DIR={str(tmp_path / 'lock')!r}",
        )
    )
    return private_tmp, assignments


def test_deploy_lock_uses_pinned_flock_even_with_hostile_path(tmp_path: Path) -> None:
    lock_dir = tmp_path / "lock"
    trusted = tmp_path / "trusted" / "flock"
    hostile = tmp_path / "hostile" / "flock"
    trusted_seen = tmp_path / "trusted-seen"
    hostile_seen = tmp_path / "hostile-seen"
    _write_executable(trusted, f": > {str(trusted_seen)!r}\nexit 0\n")
    _write_executable(hostile, f": > {str(hostile_seen)!r}\nexit 0\n")
    result = _run_library(
        f"""
        BUILD_LOCK_DIR={str(lock_dir)!r}
        BUILD_LOCK_FILE={str(lock_dir / 'deploy.lock')!r}
        EXPECTED_LOCK_UID={os.getuid()}
        EXPECTED_LOCK_GID={os.getgid()}
        EXPECTED_FLOCK_PATH={str(trusted)!r}
        PATH={str(hostile)!r}:$PATH
        acquire_deploy_lock
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert trusted_seen.exists()
    assert not hostile_seen.exists()


def test_failed_dependency_install_stops_every_later_build_phase(tmp_path: Path) -> None:
    stage = tmp_path / "stage"
    stage_root = tmp_path / "root"
    live = tmp_path / "live"
    for path in (stage, stage_root, live):
        path.mkdir()
    fake_npm = tmp_path / "npm"
    next_called = tmp_path / "next-called"
    _write_executable(fake_npm, "echo npm-failed >&2\nexit 37\n")
    _private_tmp, globals_block = _sandbox_globals(tmp_path, stage, stage_root, live)
    result = _run_library(
        f"""
        {globals_block}
        EXPECTED_NPM_PATH={str(fake_npm)!r}
        CLEAN_BUILD_PATH=/usr/bin:/bin
        TARGET_SHA={'a'*40!r}
        prepare_public_build_env() {{ echo public-called; : > "$2/.env.production.local"; return 0; }}
        prepare_next_build_keys() {{ echo keys-called; return 0; }}
        run_isolated_terminal_build {str(stage)!r} {str(live)!r} {str(stage_root)!r}
        rc=$?
        printf 'RC=%s\\n' "$rc"
        exit "$rc"
        """
    )
    assert result.returncode == 37, result.stdout + result.stderr
    assert not next_called.exists()
    assert "public-called" in result.stdout
    assert "keys-called" in result.stdout
    assert "next build" not in result.stdout


def test_install_and_next_receive_private_stage_temp(tmp_path: Path) -> None:
    stage = tmp_path / "stage"
    stage_root = tmp_path / "root"
    live = tmp_path / "live"
    for path in (stage, stage_root, live):
        path.mkdir()
    env_log = tmp_path / "env.log"
    fake_npm = tmp_path / "npm"
    next_script = "#!/bin/sh\nset -eu\nenv | grep -E '^(TMPDIR|TMP|TEMP)=' >> " + repr(str(env_log)) + "\n"
    _write_executable(
        fake_npm,
        "mkdir -p node_modules/.bin\n"
        "cat > node_modules/.bin/next <<'NEXT'\n" + next_script + "NEXT\n"
        "chmod +x node_modules/.bin/next\n"
        f"env | grep -E '^(TMPDIR|TMP|TEMP)=' >> {str(env_log)!r}\n"
        "exit 0\n",
    )
    private_tmp, globals_block = _sandbox_globals(tmp_path, stage, stage_root, live)
    result = _run_library(
        f"""
        {globals_block}
        EXPECTED_NPM_PATH={str(fake_npm)!r}
        CLEAN_BUILD_PATH=/usr/bin:/bin
        TARGET_SHA={'a'*40!r}
        prepare_public_build_env() {{ : > "$2/.env.production.local"; }}
        prepare_next_build_keys() {{ :; }}
        run_isolated_terminal_build {str(stage)!r} {str(live)!r} {str(stage_root)!r}
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert private_tmp.is_dir()
    lines = env_log.read_text(encoding="utf-8").splitlines()
    assert lines.count(f"TMPDIR={private_tmp}") == 2
    assert lines.count(f"TMP={private_tmp}") == 2
    assert lines.count(f"TEMP={private_tmp}") == 2


def test_broken_governed_env_symlink_is_refused(tmp_path: Path) -> None:
    live = tmp_path / "live"
    stage = tmp_path / "stage"
    live.mkdir()
    stage.mkdir()
    (live / ".env").symlink_to(tmp_path / "missing")
    identity = tmp_path / "identity.json"
    result = _run_library(
        f'prepare_public_build_env {str(live)!r} {str(stage)!r} {str(identity)!r}'
    )
    assert result.returncode == 64, result.stdout + result.stderr
    assert not identity.exists()


def test_runtime_admission_uses_closed_environment_and_real_ubuntu_identity() -> None:
    text = _text()
    assert 'EXPECTED_OS_RELEASE_FILE="/usr/lib/os-release"' in text
    assert 'EXPECTED_FLOCK_PATH="/usr/bin/flock"' in text
    assert 'EXPECTED_SYSTEMD_RUN_PATH="/usr/bin/systemd-run"' in text
    start = text.index("verify_build_runtime(){")
    end = text.index("\nprepare_build_receipt_dir(){", start)
    body = text[start:end]
    assert "env -i" in body
    assert "NODE_OPTIONS" not in body


def test_receipt_is_bound_to_the_exact_public_env_file_next_consumed() -> None:
    text = _text()
    start = text.index("publish_build_receipt(){")
    end = text.index("\n# ── deploy generation", start)
    body = text[start:end]
    assert '--public-env-file "$stage/.env.production.local"' in body


def test_exact_projection_replaces_git_archive_and_uses_stable_target_path() -> None:
    body = _main()
    assert 'git -C "$SRC" archive "$TARGET_SHA"' not in body
    projection = body.index("materialize_build_projection")
    build = body.index("run_isolated_terminal_build")
    receipt = body.index("publish_build_receipt")
    assert projection < build < receipt
    text = _text()
    assert 'BUILD_WORK_ROOT_BASE=/opt/terminal/.build-work' in text
    assert '[ "$BUILD_TARGET_ROOT" = "$BUILD_WORK_ROOT_BASE/$TARGET_TREE" ]' in text
    assert "BUILD_SOURCE_ROOT" in text
    assert 'source_root = target_root / "source"' in text
    assert "terminal_build_projection.py" in text
    assert "terminal_build_projection.json" in text


def test_receipt_attestor_and_projection_manifest_come_from_controller_evidence() -> None:
    body = _main()
    assert 'publish_build_receipt "$BUILD_EVIDENCE_DIR/receipt-helper.py"' in body
    text = _text()
    start = text.index("publish_build_receipt(){")
    end = text.index("\n# ── deploy generation", start)
    receipt_body = text[start:end]
    assert '--projection-manifest "$BUILD_PROJECTION_MANIFEST"' in receipt_body
    assert '"$stage_root/ops/terminal_build_receipt.py"' not in body


def test_static_build_principal_and_systemd_sandbox_are_fail_closed() -> None:
    text = _text()
    for token in (
        'EXPECTED_BUILD_USER="mastermind-terminal-build"',
        'EXPECTED_BUILD_GROUP="mastermind-terminal-build"',
        "EXPECTED_BUILD_UID=980",
        "EXPECTED_BUILD_GID=980",
        'EXPECTED_SYSTEMD_RUN_PATH="/usr/bin/systemd-run"',
        "verify_build_principal",
        "NoNewPrivileges=yes",
        "CapabilityBoundingSet=",
        "AmbientCapabilities=",
        "ProtectSystem=strict",
        "ProtectHome=yes",
        "PrivateTmp=yes",
        "PrivateDevices=yes",
        "ProtectKernelTunables=yes",
        "ProtectKernelModules=yes",
        "ProtectControlGroups=yes",
        "RestrictSUIDSGID=yes",
        "UMask=0077",
    ):
        assert token in text


def test_install_and_build_have_separate_network_and_write_contracts() -> None:
    text = _text()
    start = text.index("run_isolated_terminal_build(){")
    end = text.index("\npublish_build_receipt(){", start)
    body = text[start:end]
    assert 'run_sandboxed_phase install' in body
    assert 'run_sandboxed_phase build' in body
    assert '--property="PrivateNetwork=$private_network"' in text
    assert 'run_sandboxed_phase install "$BUILD_DEPS_ROOT" no' in body
    assert 'run_sandboxed_phase build "$stage" yes' in body
    assert 'BindReadOnlyPaths=' in text
    assert 'ReadWritePaths=' in text
    assert '--property="InaccessiblePaths=$APP"' in text
    assert '--property="InaccessiblePaths=$SRC"' in text
    assert '--property="InaccessiblePaths=$BUILD_EVIDENCE_DIR"' in text


def test_build_principal_absence_refuses_before_target_code(tmp_path: Path) -> None:
    result = _run_library(
        """
        EXPECTED_BUILD_USER=definitely-no-such-terminal-build-user
        EXPECTED_BUILD_GROUP=definitely-no-such-terminal-build-group
        EXPECTED_BUILD_UID=65000
        EXPECTED_BUILD_GID=65000
        verify_build_principal
        rc=$?
        printf 'RC=%s\n' "$rc"
        exit "$rc"
        """
    )
    assert result.returncode != 0, result.stdout + result.stderr
    assert "build principal" in (result.stdout + result.stderr).lower()


def test_build_attestor_is_not_executed_from_build_writable_source() -> None:
    body = _main()
    assert 'publish_build_receipt "$BUILD_EVIDENCE_DIR/receipt-helper.py"' in body
    assert 'publish_build_receipt "$STAGE' not in body
    text = _text()
    assert '--property="InaccessiblePaths=$BUILD_EVIDENCE_DIR"' in text


def test_controller_evidence_is_bootstrapped_before_any_target_helper_executes() -> None:
    body = _main()
    bootstrap = body.index("bootstrap_controller_evidence")
    projection = body.index("materialize_build_projection")
    install = body.index("run_isolated_terminal_build")
    assert bootstrap < projection < install
    text = _text()
    start = text.index("materialize_build_projection(){")
    end = text.index("\nprepare_build_mountpoints(){", start)
    function = text[start:end]
    assert '"$BUILD_EVIDENCE_DIR/projection-helper.py"' in function
    assert '"$BUILD_EVIDENCE_DIR/projection-policy.json"' in function
    assert '"$BUILD_PROJECTION_HELPER" -I' not in function


def test_systemd_runner_receives_exact_install_and_build_sandbox_arguments(tmp_path: Path) -> None:
    stage = tmp_path / "source" / "terminal"
    stage_root = tmp_path / "root"
    live = tmp_path / "live"
    stage.mkdir(parents=True)
    stage_root.mkdir()
    live.mkdir()
    (stage / ".next").mkdir()
    log = tmp_path / "systemd-args.log"
    shim = tmp_path / "systemd-run-log"
    _write_executable(
        shim,
        f"""
printf '%s\\n' '---' >> {str(log)!r}
working=
while [ "$#" -gt 0 ]; do
  printf '%s\\n' "$1" >> {str(log)!r}
  case "$1" in
    --working-directory=*) working=${{1#*=}} ;;
    --) shift; break ;;
  esac
  shift
done
[ -n "$working" ] && cd "$working"
exec "$@"
""",
    )
    _tmp, globals_block = _sandbox_globals(tmp_path, stage, stage_root, live)
    result = _run_library(
        f"""
        {globals_block}
        EXPECTED_SYSTEMD_RUN_PATH={str(shim)!r}
        TARGET_SHA={'a'*40!r}
        run_sandboxed_phase install "$BUILD_DEPS_ROOT" no /usr/bin/true
        run_sandboxed_phase build {str(stage)!r} yes /usr/bin/true
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    phases = log.read_text(encoding="utf-8").split("---\n")[1:]
    assert len(phases) == 2
    install, build = phases
    common = (
        f"--uid={os.getuid()}", f"--gid={os.getgid()}", "--property=NoNewPrivileges=yes",
        "--property=CapabilityBoundingSet=", "--property=AmbientCapabilities=",
        "--property=ProtectSystem=strict", "--property=ProtectHome=yes",
        "--property=PrivateTmp=yes", "--property=PrivateDevices=yes",
        "--property=RestrictSUIDSGID=yes", "--property=UMask=0077",
    )
    for token in common:
        assert token in install
        assert token in build
    assert "--property=PrivateNetwork=no" in install
    assert "--property=PrivateNetwork=yes" in build
    assert f"--property=BindReadOnlyPaths={stage_root / 'evidence/package.json'}:{stage_root / 'deps/package.json'}" in install
    assert f"--property=ReadOnlyPaths={stage.parent}" in build
    assert f"--property=ReadWritePaths={stage / '.next'}" in build
    assert f"--property=InaccessiblePaths={stage_root / 'evidence'}" in build


def test_authority_binaries_are_absolute_and_path_is_closed() -> None:
    text = _text()
    assert text.startswith("#!/usr/bin/bash\n")
    assert 'export PATH="/usr/bin:/bin"' in text
    for token in (
        'EXPECTED_GIT_PATH="/usr/bin/git"',
        'EXPECTED_PYTHON_PATH="/usr/bin/python3"',
        'EXPECTED_TAR_PATH="/usr/bin/tar"',
        'EXPECTED_SYSTEMCTL_PATH="/usr/bin/systemctl"',
        'EXPECTED_CURL_PATH="/usr/bin/curl"',
        'EXPECTED_RSYNC_PATH="/usr/bin/rsync"',
        'EXPECTED_SHA256SUM_PATH="/usr/bin/sha256sum"',
    ):
        assert token in text
    executable = "\n".join(
        line for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )
    assert "python3 -I" not in executable
    assert "git -C" not in executable
    assert " tar -x" not in executable
    assert re.search(r"(?m)(?:^|[;&|()]\s*)(?:if\s+!\s+)?systemctl(?:\s|$)", executable) is None
    assert "curl -" not in executable


def test_sandbox_identity_and_input_sidecars_precede_dependency_code() -> None:
    text = _text()
    start = text.index("run_isolated_terminal_build(){")
    end = text.index("\npublish_build_receipt(){", start)
    body = text[start:end]
    mount = body.index("prepare_build_mountpoints")
    public = body.index("prepare_public_build_env")
    keys = body.index("prepare_next_build_keys")
    sandbox = body.index("prepare_sandbox_identity")
    custody = body.index("grant_build_output_custody")
    install = body.index("run_sandboxed_phase install")
    build = body.index("run_sandboxed_phase build")
    assert mount < public < keys < sandbox < custody < install < build
    assert '--property="InaccessiblePaths=$BUILD_SOURCE_ROOT"' in text


def test_receipt_binds_builder_sandbox_and_stable_application_root() -> None:
    text = _text()
    start = text.index("publish_build_receipt(){")
    end = text.index("\n# ── deploy generation", start)
    body = text[start:end]
    for token in (
        '--build-user "$EXPECTED_BUILD_USER"',
        '--build-group "$EXPECTED_BUILD_GROUP"',
        '--build-home "$EXPECTED_BUILD_HOME"',
        '--build-shell "$EXPECTED_BUILD_SHELL"',
        '--sandbox-identity "$BUILD_SANDBOX_IDENTITY"',
        '--application-root "$stage"',
    ):
        assert token in body


def test_npm_configs_are_created_inside_build_owned_home() -> None:
    text = _text()
    start = text.index("run_isolated_terminal_build(){")
    end = text.index("\npublish_build_receipt(){", start)
    body = text[start:end]
    assert 'npm_userconfig="$BUILD_HOME_DIR/.npm-userconfig"' in body
    assert 'npm_globalconfig="$BUILD_HOME_DIR/.npm-globalconfig"' in body
    assert "prepare_npm_configs" in body
    assert ': > "$npm_userconfig"' not in body


def test_next_key_source_cache_parent_symlink_is_refused(tmp_path: Path) -> None:
    live = tmp_path / "live"
    real_cache = tmp_path / "real-cache"
    stage = tmp_path / "stage"
    identity = tmp_path / "identity.json"
    (live / ".next").mkdir(parents=True)
    real_cache.mkdir()
    stage.mkdir()
    future = 4_102_444_800_000
    (real_cache / ".previewinfo").write_text(
        json.dumps({
            "previewModeId": "1" * 32,
            "previewModeSigningKey": "2" * 64,
            "previewModeEncryptionKey": "3" * 64,
            "expireAt": future,
        }), encoding="utf-8"
    )
    import base64
    (real_cache / ".rscinfo").write_text(
        json.dumps({
            "encryption.key": base64.b64encode(b"k" * 32).decode("ascii"),
            "encryption.expire_at": future,
        }), encoding="utf-8"
    )
    (live / ".next" / "cache").symlink_to(real_cache, target_is_directory=True)
    result = _run_library(
        f"prepare_next_build_keys {str(live)!r} {str(stage)!r} {str(identity)!r}"
    )
    assert result.returncode != 0, result.stdout + result.stderr
    assert not identity.exists()


def test_next_key_reader_opens_cache_parent_once_with_nofollow() -> None:
    text = _text()
    start = text.index("prepare_next_build_keys(){")
    end = text.index("\nverify_build_principal(){", start)
    body = text[start:end]
    assert "O_DIRECTORY" in body
    assert "O_NOFOLLOW" in body
    assert "dir_fd=source_fd" in body
    assert "source directory changed while read" in body
