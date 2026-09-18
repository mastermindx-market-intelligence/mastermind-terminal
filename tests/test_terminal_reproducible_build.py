"""W2B-B contracts for isolated, receipted Terminal builds.

These tests keep the single incumbent deploy owner but force its expensive build
phase to become an immutable-input operation before any live-generation or
canonical-working-tree convergence effect.
"""
from __future__ import annotations

import importlib.util
import json
import os
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
    assert "flock -n" in _text()


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
    archive = body.index('git -C "$SRC" archive "$TARGET_SHA"')
    build = body.index("run_isolated_terminal_build")
    receipt = body.index("publish_build_receipt")
    reset = body.index('git -C "$SRC" reset -q --hard "$TARGET_SHA"')
    clean = body.index('git -C "$SRC" clean -qfd')
    generation = body.index('deploy_generation_begin "$APP"')
    assert archive < build < receipt < reset < clean < generation


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
        'git -C "$SRC" reset -q --hard "$TARGET_SHA"',
        'deploy_generation_begin "$APP"',
        'mv "$STAGE/.next" "$APP/.next"',
        "systemctl restart terminal",
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
    assert 'node_path=$(command -v node' in text
    assert 'npm_path=$(command -v npm' in text


def test_dependency_and_next_build_run_under_closed_environment() -> None:
    text = _text()
    start = text.index("run_isolated_terminal_build(){")
    end = text.index("\npublish_build_receipt(){", start)
    body = text[start:end]
    assert body.count("env -i") == 2
    assert 'PATH="$CLEAN_BUILD_PATH"' in body
    assert 'NPM_CONFIG_USERCONFIG=/dev/null' in body
    assert 'NPM_CONFIG_GLOBALCONFIG=/dev/null' in body
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
