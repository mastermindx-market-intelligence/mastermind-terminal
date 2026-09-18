"""Fail-closed W2B-A contract for exact-target Terminal deploy admission.

This suite never contacts production.  It sources the incumbent deploy owner as a
library, drives its pure/read-only admission helpers against temporary fixtures,
and pins the executable-body order that keeps source mutation behind W2A proof.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "ops" / "terminal-build.sh"
VALID_SHA = "a" * 40
OTHER_SHA = "b" * 40


def _bash() -> str:
    found = shutil.which("bash")
    assert found, "bash is required to exercise the deploy owner"
    return found


def run_gen(
    body: str, *, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    driver = textwrap.dedent(
        f"""
        . "{SCRIPT}"
        set +e
        {textwrap.dedent(body)}
        """
    )
    process_env = dict(os.environ)
    if env:
        process_env.update(env)
    return subprocess.run(
        [_bash(), "-c", driver],
        capture_output=True,
        text=True,
        timeout=60,
        env=process_env,
    )


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_bash(), str(SCRIPT), *args], capture_output=True, text=True, timeout=60
    )


def _deploy_body(*, code_only: bool = False) -> str:
    text = SCRIPT.read_text(encoding="utf-8")
    body = text[text.rindex('if [ "${BASH_SOURCE[0]}" != "$0" ]') :]
    if code_only:
        body = "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )
    return body


def _write_pair(directory: Path) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    script = directory / "terminal_release_preflight.py"
    policy = directory / "terminal_source_audit.production.json"
    script.write_text("# preflight\n", encoding="utf-8")
    policy.write_text("{}\n", encoding="utf-8")
    runtime = directory / "terminal_audit"
    runtime.mkdir()
    (runtime / "__init__.py").write_text("# runtime\n", encoding="utf-8")
    return script, policy


def _receipt_id(payload: dict[str, object]) -> str:
    canonical = {
        key: value
        for key, value in payload.items()
        if key not in {"generated_at", "receipt_id"}
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _policy_digest(policy: Path) -> str:
    value = json.loads(policy.read_text(encoding="utf-8"))
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _clean_receipt(accepted_sha: str, policy_digest: str) -> dict[str, object]:
    inner: dict[str, object] = {
        "schema": "mastermind.terminal.source_audit_receipt.v1",
        "generated_at": "2026-09-17T00:00:00Z",
        "status": "CLEAN",
        "accepted_sha": accepted_sha,
        "policy_digest": policy_digest,
        "canonical_repo": "/tmp/canonical",
        "canonical_repo_head": accepted_sha,
        "accepted_ref": {
            "name": "refs/heads/master",
            "sha": accepted_sha,
            "contains_sha": True,
        },
        "deployment": {
            "marker_path": "/tmp/live/.deployment-id",
            "marker_state": "VALID",
            "sha": accepted_sha,
        },
        "mappings": [],
        "summary": {
            "blocking_findings": 0,
            "tracked_paths": 0,
            "allowed_paths": 0,
        },
        "findings": [],
    }
    inner["receipt_id"] = _receipt_id(inner)
    outer: dict[str, object] = {
        "schema": "mastermind.terminal.release_preflight_receipt.v1",
        "generated_at": "2026-09-17T00:00:01Z",
        "result": "CLEAN",
        "accepted_sha": accepted_sha,
        "policy_digest": policy_digest,
        "source_audit_receipt_id": inner["receipt_id"],
        "source_audit": inner,
    }
    outer["receipt_id"] = _receipt_id(outer)
    return outer


def _write_fake_preflight(
    script: Path,
    receipt: Path,
    policy: Path,
    *,
    accepted_sha: str = VALID_SHA,
    receipt_payload: dict[str, object] | None = None,
    summary_updates: dict[str, object] | None = None,
    create_receipt: bool = True,
    extra_entries: tuple[Path, ...] = (),
) -> dict[str, object]:
    payload = receipt_payload or _clean_receipt(accepted_sha, _policy_digest(policy))
    summary: dict[str, object] = {
        "schema": "mastermind.terminal.release_preflight_receipt.v1",
        "result": "CLEAN",
        "accepted_sha": accepted_sha,
        "receipt_path": str(receipt),
        "receipt_id": payload["receipt_id"],
        "source_audit_receipt_id": payload["source_audit_receipt_id"],
    }
    if summary_updates:
        summary.update(summary_updates)
    lines = ["import json", "import os", "from pathlib import Path"]
    if create_receipt:
        rendered = json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n"
        lines.extend(
            (
                f"Path({str(receipt)!r}).write_text({rendered!r}, encoding='utf-8')",
                f"os.chmod({str(receipt)!r}, 0o640)",
            )
        )
    for extra in extra_entries:
        lines.extend(
            (
                f"Path({str(extra)!r}).write_text('{{}}\\n', encoding='utf-8')",
                f"os.chmod({str(extra)!r}, 0o640)",
            )
        )
    lines.append(f"print(json.dumps({summary!r}, sort_keys=True))")
    script.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary


def _git(repo: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], text=True
    ).strip()


def _commit(repo: Path, name: str) -> str:
    (repo / "state.txt").write_text(name + "\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "state.txt"], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-q", "-m", name], check=True
    )
    return _git(repo, "rev-parse", "HEAD")


def _real_preflight_owner_fixture(tmp_path: Path) -> tuple[Path, Path, Path, str]:
    """Build a tiny canonical checkout that executes the real W2A package in-place."""
    repo = tmp_path / "canonical"
    live = tmp_path / "live"
    receipts = tmp_path / "receipts"
    subprocess.run(["git", "init", "-q", "-b", "master", str(repo)], check=True)
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")

    terminal = repo / "terminal"
    terminal.mkdir()
    (terminal / "app.py").write_text("print('canonical')\n", encoding="utf-8")
    live.mkdir()
    shutil.copy2(terminal / "app.py", live / "app.py")
    marker = live / ".deployment-id"

    ops = repo / "ops"
    ops.mkdir()
    shutil.copy2(REPO / "ops" / "terminal_release_preflight.py", ops / "terminal_release_preflight.py")
    shutil.copytree(
        REPO / "ops" / "terminal_audit",
        ops / "terminal_audit",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    policy = {
        "schema": "mastermind.terminal.source_audit_policy.v1",
        "accepted_ref": "refs/remotes/origin/master",
        "deployment_id_file": str(marker),
        "mappings": [
            {
                "name": "terminal-app",
                "repo_path": "terminal",
                "live_path": str(live),
                "allowances": [
                    {"path": ".deployment-id", "classification": "deployment_marker"}
                ],
            }
        ],
    }
    (ops / "terminal_source_audit.production.json").write_text(
        json.dumps(policy, sort_keys=True) + "\n", encoding="utf-8"
    )
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", "fixture"], check=True)
    accepted = _git(repo, "rev-parse", "HEAD")
    _git(repo, "update-ref", "refs/remotes/origin/master", accepted)
    marker.write_text(accepted + "\n", encoding="utf-8")
    receipts.mkdir(mode=0o750)
    return repo, ops, receipts, accepted


@pytest.mark.parametrize(
    "value",
    ["master", "ABCDEF" * 7, "abc", "0" * 39, "0" * 41, "g" * 40, ""],
)
def test_target_sha_validation_rejects_every_noncanonical_value(value: str) -> None:
    result = run_gen(f'validate_target_sha "{value}"')
    assert result.returncode == 64, result.stdout + result.stderr


def test_target_sha_validation_accepts_one_full_lowercase_sha() -> None:
    result = run_gen(f'validate_target_sha "{VALID_SHA}"')
    assert result.returncode == 0, result.stdout + result.stderr


def test_cli_requires_exact_target_flag_before_touching_node_or_git() -> None:
    missing = run_script()
    malformed = run_script("--target-sha", "master")
    extra = run_script("--target-sha", VALID_SHA, "unexpected")
    for result in (missing, malformed, extra):
        assert result.returncode == 64, result.stdout + result.stderr
        assert "fetching origin" not in result.stdout
        assert "node " not in result.stdout


def test_complete_executing_owner_pair_wins_for_first_adoption(tmp_path: Path) -> None:
    owner_script, owner_policy = _write_pair(tmp_path / "owner-ops")
    _write_pair(tmp_path / "canonical-ops")
    result = run_gen(
        f"""
        select_preflight_artifacts "{os.getuid()}" "{tmp_path / 'owner-ops'}" "{tmp_path / 'canonical-ops'}"
        rc=$?
        printf 'RC=%s\\nSCRIPT=%s\\nPOLICY=%s\\n' "$rc" "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY"
        exit "$rc"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"SCRIPT={owner_script}" in result.stdout
    assert f"POLICY={owner_policy}" in result.stdout


def test_incomplete_owner_pair_falls_back_without_mixing(tmp_path: Path) -> None:
    owner = tmp_path / "owner-ops"
    owner.mkdir()
    (owner / "terminal_release_preflight.py").write_text("# orphan\n")
    canonical_script, canonical_policy = _write_pair(tmp_path / "canonical-ops")
    result = run_gen(
        f"""
        select_preflight_artifacts "{os.getuid()}" "{owner}" "{tmp_path / 'canonical-ops'}"
        rc=$?
        printf 'RC=%s\\nSCRIPT=%s\\nPOLICY=%s\\n' "$rc" "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY"
        exit "$rc"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"SCRIPT={canonical_script}" in result.stdout
    assert f"POLICY={canonical_policy}" in result.stdout
    assert str(owner) not in result.stdout


def test_symlinked_owner_artifact_is_rejected_as_a_pair(tmp_path: Path) -> None:
    owner = tmp_path / "owner-ops"
    owner.mkdir()
    real = tmp_path / "real.py"
    real.write_text("# real\n")
    (owner / "terminal_release_preflight.py").symlink_to(real)
    (owner / "terminal_source_audit.production.json").write_text("{}\n")
    canonical_script, canonical_policy = _write_pair(tmp_path / "canonical-ops")
    result = run_gen(
        f"""
        select_preflight_artifacts "{os.getuid()}" "{owner}" "{tmp_path / 'canonical-ops'}"
        rc=$?
        printf 'RC=%s\\nSCRIPT=%s\\nPOLICY=%s\\n' "$rc" "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY"
        exit "$rc"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"SCRIPT={canonical_script}" in result.stdout
    assert f"POLICY={canonical_policy}" in result.stdout


def test_symlinked_runtime_package_rejects_the_owner_pair(tmp_path: Path) -> None:
    owner = tmp_path / "owner-ops"
    owner.mkdir()
    (owner / "terminal_release_preflight.py").write_text("# owner\n")
    (owner / "terminal_source_audit.production.json").write_text("{}\n")
    real_runtime = tmp_path / "real-runtime"
    real_runtime.mkdir()
    (real_runtime / "__init__.py").write_text("# untrusted\n")
    (owner / "terminal_audit").symlink_to(real_runtime, target_is_directory=True)
    canonical_script, canonical_policy = _write_pair(tmp_path / "canonical-ops")
    result = run_gen(
        f"""
        select_preflight_artifacts "{os.getuid()}" "{owner}" "{tmp_path / 'canonical-ops'}"
        rc=$?
        printf 'RC=%s\\nSCRIPT=%s\\nPOLICY=%s\\n' "$rc" "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY"
        exit "$rc"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"SCRIPT={canonical_script}" in result.stdout
    assert f"POLICY={canonical_policy}" in result.stdout
    assert str(owner) not in result.stdout


def test_artifact_selection_fails_when_no_complete_real_pair_exists(
    tmp_path: Path,
) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    (first / "terminal_release_preflight.py").write_text("# only script\n")
    (second / "terminal_source_audit.production.json").write_text("{}\n")
    result = run_gen(
        f'type -t select_preflight_artifacts >/dev/null || exit 90; '
        f'select_preflight_artifacts "{os.getuid()}" "{first}" "{second}"'
    )
    assert result.returncode == 66, result.stdout + result.stderr


def test_preflight_exit_code_is_propagated(tmp_path: Path) -> None:
    fake = tmp_path / "preflight.py"
    fake.write_text(
        "import sys\nprint('typed failure', file=sys.stderr)\nraise SystemExit(2)\n",
        encoding="utf-8",
    )
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    canonical = tmp_path / "canonical"
    canonical.mkdir()
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    result = run_gen(
        f'run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"'
    )
    assert result.returncode == 2, result.stdout + result.stderr
    assert "typed failure" in result.stderr


def test_preflight_clean_summary_binds_receipt_evidence(tmp_path: Path) -> None:
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    receipt = receipts / "receipt.json"
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    fake = tmp_path / "preflight.py"
    summary = _write_fake_preflight(fake, receipt, policy)
    canonical = tmp_path / "canonical"
    canonical.mkdir()
    result = run_gen(
        f"""
        run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"
        rc=$?
        printf 'RC=%s\\nACCEPTED=%s\\nPATH=%s\\nOUTER=%s\\nINNER=%s\\nPOLICY=%s\\n' \\
          "$rc" "$PREFLIGHT_ACCEPTED_SHA" "$PREFLIGHT_RECEIPT_PATH" \\
          "$PREFLIGHT_RECEIPT_ID" "$PREFLIGHT_SOURCE_RECEIPT_ID" \\
          "$PREFLIGHT_POLICY_DIGEST"
        exit "$rc"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"ACCEPTED={VALID_SHA}" in result.stdout
    assert f"PATH={receipt}" in result.stdout
    assert f"OUTER={summary['receipt_id']}" in result.stdout
    assert f"INNER={summary['source_audit_receipt_id']}" in result.stdout
    assert f"POLICY={_policy_digest(policy)}" in result.stdout


def test_admit_target_accepts_only_commit_contained_by_accepted_ref(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", "-q", "-b", "master", str(repo)], check=True)
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    first = _commit(repo, "first")
    accepted = _commit(repo, "accepted")
    subprocess.run(
        ["git", "-C", str(repo), "checkout", "-q", "-b", "side", first],
        check=True,
    )
    unaccepted = _commit(repo, "unaccepted")
    _git(repo, "checkout", "-q", "master")

    good = run_gen(
        f'admit_target_sha "{repo}" "{accepted}" "{accepted}"'
    )
    bad = run_gen(
        f'admit_target_sha "{repo}" "{unaccepted}" "{accepted}"'
    )
    assert good.returncode == 0, good.stdout + good.stderr
    assert bad.returncode != 0, "a commit outside the accepted ref was admitted"


def test_preflight_is_before_every_source_or_build_mutation() -> None:
    body = _deploy_body(code_only=True)
    preflight = body.index("run_release_preflight")
    mutation_tokens = (
        'fetch_accepted_ref "$SRC"',
        'git -C "$SRC" archive "$TARGET_SHA"',
        'run_isolated_terminal_build "$STAGE"',
        'git -C "$SRC" reset',
        'git -C "$SRC" clean',
        "rsync -a --delete",
        "systemctl restart terminal",
    )
    for token in mutation_tokens:
        assert preflight < body.index(token), f"preflight occurs after {token}"


def test_deploy_resets_only_to_the_explicit_target_sha() -> None:
    body = _deploy_body(code_only=True)
    assert 'git -C "$SRC" reset -q --hard "$TARGET_SHA"' in body
    assert 'git -C "$SRC" reset -q --hard "origin/$BRANCH"' not in body
    assert 'FULL_SHA=$(git -C "$SRC" rev-parse HEAD)' in body
    assert '[ "$FULL_SHA" = "$TARGET_SHA" ]' in body


def test_target_cli_and_preflight_artifacts_have_no_environment_fallback() -> None:
    body = _deploy_body(code_only=True)
    assert re.search(r'\[ "\$#" -eq 2 \].*"\$1" = "--target-sha"', body)
    assert "TARGET_SHA=${TARGET_SHA" not in body
    assert "PREFLIGHT_SCRIPT=${PREFLIGHT_SCRIPT" not in body
    assert "PREFLIGHT_POLICY=${PREFLIGHT_POLICY" not in body


def test_receipt_directory_is_prepared_as_root_owned_0750_before_preflight() -> None:
    body = _deploy_body(code_only=True)
    prepare = body.index("prepare_preflight_receipt_dir")
    preflight = body.index("run_release_preflight")
    assert prepare < preflight
    library = SCRIPT.read_text(encoding="utf-8")[: SCRIPT.read_text(encoding="utf-8").rindex(
        'if [ "${BASH_SOURCE[0]}" != "$0" ]'
    )]
    assert "install -d -o root -g root -m 0750" in library
    assert "existing state is never normalized" in library

@pytest.mark.parametrize(
    ("schema", "accepted_sha"),
    [
        ("mastermind.terminal.wrong.v1", VALID_SHA),
        ("mastermind.terminal.release_preflight_receipt.v1", "not-a-full-sha"),
    ],
)
def test_preflight_rejects_malformed_clean_summary_identity(
    tmp_path: Path, schema: str, accepted_sha: str
) -> None:
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    receipt = receipts / "receipt.json"
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    fake = tmp_path / "preflight.py"
    _write_fake_preflight(
        fake,
        receipt,
        policy,
        summary_updates={"schema": schema, "accepted_sha": accepted_sha},
    )
    canonical = tmp_path / "canonical"
    canonical.mkdir()
    result = run_gen(
        f'run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"'
    )
    assert result.returncode == 64, result.stdout + result.stderr



def test_admit_target_refuses_ambient_repository_redirection(tmp_path: Path) -> None:
    legitimate = tmp_path / "legitimate"
    redirected = tmp_path / "redirected"
    for repo, label in ((legitimate, "legitimate"), (redirected, "redirected")):
        subprocess.run(["git", "init", "-q", "-b", "master", str(repo)], check=True)
        _git(repo, "config", "user.email", "test@example.com")
        _git(repo, "config", "user.name", "Test")
        _commit(repo, label)

    legitimate_sha = _git(legitimate, "rev-parse", "HEAD")
    redirected_sha = _git(redirected, "rev-parse", "HEAD")
    hostile_env = {
        "GIT_DIR": str(redirected / ".git"),
        "GIT_WORK_TREE": str(redirected),
        "GIT_CONFIG_GLOBAL": str(tmp_path / "attacker-global-config"),
        "GIT_CONFIG_SYSTEM": str(tmp_path / "attacker-system-config"),
    }

    rejected = run_gen(
        f'admit_target_sha "{legitimate}" "{redirected_sha}" "{legitimate_sha}"',
        env=hostile_env,
    )
    accepted = run_gen(
        f'admit_target_sha "{legitimate}" "{legitimate_sha}" "{legitimate_sha}"',
        env=hostile_env,
    )

    assert rejected.returncode == 65, rejected.stdout + rejected.stderr
    assert accepted.returncode == 0, accepted.stdout + accepted.stderr


def test_executable_sanitizes_git_environment_before_preflight_or_fetch() -> None:
    body = _deploy_body(code_only=True)
    main = body.index("TARGET_SHA=$2")
    sanitize = body.index("sanitize_git_environment", main)
    preflight = body.index("run_release_preflight", main)
    fetch = body.index("fetch_accepted_ref", main)
    assert sanitize < preflight < fetch


def test_existing_insecure_receipt_directory_is_not_normalized_before_refusal(
    tmp_path: Path,
) -> None:
    parent = tmp_path / "state"
    receipt_dir = parent / "release-preflight"
    receipt_dir.mkdir(parents=True)
    shim_dir = tmp_path / "shims"
    shim_dir.mkdir()
    install_log = tmp_path / "install-called"
    install = shim_dir / "install"
    install.write_text(
        "#!/bin/sh\nprintf 'called\\n' >> \"$INSTALL_LOG\"\nexit 0\n",
        encoding="utf-8",
    )
    install.chmod(0o755)
    stat = shim_dir / "stat"
    stat.write_text(
        "#!/bin/sh\nprintf 'directory:777:0:0\\n'\n",
        encoding="utf-8",
    )
    stat.chmod(0o755)

    result = run_gen(
        f'prepare_preflight_receipt_dir "{receipt_dir}"',
        env={
            "PATH": f"{shim_dir}:{os.environ['PATH']}",
            "INSTALL_LOG": str(install_log),
        },
    )

    assert result.returncode == 73, result.stdout + result.stderr
    assert not install_log.exists(), (
        "the gate normalized unexplained existing state before refusing it"
    )


def test_admit_target_refuses_repository_with_replace_refs(tmp_path: Path) -> None:
    repo = tmp_path / "repo-with-replace"
    subprocess.run(["git", "init", "-q", "-b", "master", str(repo)], check=True)
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    first = _commit(repo, "first")
    target = _commit(repo, "target")
    subprocess.run(["git", "-C", str(repo), "replace", target, first], check=True)

    result = run_gen(
        f'admit_target_sha "{repo}" "{target}" "{target}"'
    )

    assert result.returncode == 65, result.stdout + result.stderr


def test_fetch_accepted_ref_ignores_missing_remote_fetch_config(
    tmp_path: Path,
) -> None:
    remote = tmp_path / "remote.git"
    seed = tmp_path / "seed"
    local = tmp_path / "local"
    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
    subprocess.run(["git", "init", "-q", "-b", "master", str(seed)], check=True)
    _git(seed, "config", "user.email", "test@example.com")
    _git(seed, "config", "user.name", "Test")
    remote_tip = _commit(seed, "protected-tip")
    subprocess.run(
        ["git", "-C", str(seed), "remote", "add", "origin", str(remote)], check=True
    )
    subprocess.run(["git", "-C", str(seed), "push", "-q", "origin", "master"], check=True)
    subprocess.run(["git", "init", "-q", str(local)], check=True)
    subprocess.run(
        ["git", "-C", str(local), "remote", "add", "origin", str(remote)], check=True
    )
    subprocess.run(
        ["git", "-C", str(local), "config", "--unset-all", "remote.origin.fetch"],
        check=True,
    )

    result = run_gen(
        f"""
        fetch_accepted_ref "{local}" origin master refs/remotes/origin/master
        rc=$?
        printf 'RC=%s\\nSHA=%s\\n' "$rc" "$ACCEPTED_REF_SHA"
        exit "$rc"
        """
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"SHA={remote_tip}" in result.stdout
    assert _git(local, "rev-parse", "refs/remotes/origin/master") == remote_tip


def test_executable_uses_explicit_fetch_helper_before_target_admission() -> None:
    body = _deploy_body(code_only=True)
    fetch = body.index("fetch_accepted_ref")
    admit = body.index("admit_target_sha")
    assert fetch < admit
    assert 'git -C "$SRC" fetch -q origin "$BRANCH"' not in body


def test_executable_binds_admission_to_captured_accepted_ref_sha() -> None:
    body = _deploy_body(code_only=True)
    assert 'admit_target_sha "$SRC" "$TARGET_SHA" "$ACCEPTED_REF_SHA"' in body
    assert 'admit_target_sha "$SRC" "$TARGET_SHA" "$ACCEPTED_REF"' not in body


def test_admission_rejects_target_outside_captured_tip_after_ref_moves(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", "-q", "-b", "master", str(repo)], check=True)
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    first = _commit(repo, "first")
    observed_tip = _commit(repo, "observed-tip")
    subprocess.run(
        ["git", "-C", str(repo), "checkout", "-q", "-b", "later", first],
        check=True,
    )
    outside_observation = _commit(repo, "outside-observation")
    _git(repo, "checkout", "-q", "master")
    _git(repo, "update-ref", "refs/remotes/origin/master", observed_tip)
    _git(repo, "update-ref", "refs/remotes/origin/master", outside_observation)

    result = run_gen(
        f'admit_target_sha "{repo}" "{outside_observation}" "{observed_tip}"'
    )
    assert result.returncode == 65, result.stdout + result.stderr


def test_real_w2a_through_owner_never_writes_runtime_bytecode(tmp_path: Path) -> None:
    repo, ops, receipts, _accepted = _real_preflight_owner_fixture(tmp_path)
    runtime = ops / "terminal_audit"
    result = run_gen(
        f"""
        select_preflight_artifacts "{os.getuid()}" "{ops}"
        first=$?
        [ "$first" -eq 0 ] || exit "$first"
        run_release_preflight "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY" "{repo}" "{receipts}"
        rc=$?
        [ "$rc" -eq 0 ] || exit "$rc"
        select_preflight_artifacts "{os.getuid()}" "{ops}"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert not list(runtime.rglob("__pycache__")), (
        "real W2A imports mutated the trusted source bundle with Python bytecode"
    )


def test_python_trust_decisions_use_isolated_interpreters() -> None:
    library = SCRIPT.read_text(encoding="utf-8")
    assert 'python3 -B -E -s "$script"' in library
    assert 'python3 -I - "$stdout_file" "$receipt_dir"' in library


@pytest.mark.parametrize("untrusted_part", ["directory", "policy", "runtime-file"])
def test_untrusted_complete_bundle_is_skipped_for_next_candidate(
    tmp_path: Path, untrusted_part: str
) -> None:
    owner = tmp_path / "owner-ops"
    _write_pair(owner)
    if untrusted_part == "directory":
        owner.chmod(0o777)
    elif untrusted_part == "policy":
        (owner / "terminal_source_audit.production.json").chmod(0o666)
    else:
        (owner / "terminal_audit" / "__init__.py").chmod(0o666)
    canonical_script, canonical_policy = _write_pair(tmp_path / "canonical-ops")

    result = run_gen(
        f"""
        select_preflight_artifacts "{os.getuid()}" "{owner}" "{tmp_path / 'canonical-ops'}"
        rc=$?
        printf 'RC=%s\\nSCRIPT=%s\\nPOLICY=%s\\n' "$rc" "$PREFLIGHT_SCRIPT" "$PREFLIGHT_POLICY"
        exit "$rc"
        """
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"SCRIPT={canonical_script}" in result.stdout
    assert f"POLICY={canonical_policy}" in result.stdout


def test_bundle_selection_rejects_wrong_expected_owner(tmp_path: Path) -> None:
    owner = tmp_path / "owner-ops"
    _write_pair(owner)
    result = run_gen(
        f'select_preflight_artifacts "{os.getuid() + 1}" "{owner}"'
    )
    assert result.returncode == 66, result.stdout + result.stderr


def test_selected_bundle_binds_all_executed_artifact_digests(tmp_path: Path) -> None:
    owner = tmp_path / "owner-ops"
    _write_pair(owner)
    result = run_gen(
        f"""
        select_preflight_artifacts "{os.getuid()}" "{owner}"
        rc=$?
        printf 'SCRIPT_SHA=%s\\nPOLICY_DIGEST=%s\\nRUNTIME_SHA=%s\\n' \\
          "$PREFLIGHT_SCRIPT_SHA256" "$PREFLIGHT_POLICY_DIGEST" \\
          "$PREFLIGHT_RUNTIME_SHA256"
        exit "$rc"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    for label in ("SCRIPT_SHA", "POLICY_DIGEST", "RUNTIME_SHA"):
        match = re.search(rf"^{label}=([0-9a-f]{{64}})$", result.stdout, re.MULTILINE)
        assert match, result.stdout


def test_executable_requires_root_owned_preflight_bundle() -> None:
    body = _deploy_body(code_only=True)
    assert 'select_preflight_artifacts 0 "$AUTHORING_OPS_DIR" "$SRC/ops"' in body
    assert "script_sha256=$PREFLIGHT_SCRIPT_SHA256" in body
    assert "policy_digest=$PREFLIGHT_POLICY_DIGEST" in body


def test_preflight_rejects_preexisting_receipt_named_by_clean_summary(
    tmp_path: Path,
) -> None:
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    receipt = receipts / "old-receipt.json"
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    payload = _clean_receipt(VALID_SHA, _policy_digest(policy))
    receipt.write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    receipt.chmod(0o640)
    fake = tmp_path / "preflight.py"
    _write_fake_preflight(
        fake, receipt, policy, receipt_payload=payload, create_receipt=False
    )
    canonical = tmp_path / "canonical"
    canonical.mkdir()

    result = run_gen(
        f'run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"'
    )

    assert result.returncode == 64, result.stdout + result.stderr


@pytest.mark.parametrize("mutation", ["accepted-sha", "policy-digest", "receipt-id"])
def test_preflight_rejects_receipt_content_disagreeing_with_summary(
    tmp_path: Path, mutation: str
) -> None:
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    receipt = receipts / "receipt.json"
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    payload = _clean_receipt(VALID_SHA, _policy_digest(policy))
    if mutation == "accepted-sha":
        payload = _clean_receipt(OTHER_SHA, _policy_digest(policy))
    elif mutation == "policy-digest":
        payload = _clean_receipt(VALID_SHA, "0" * 64)
    else:
        payload["receipt_id"] = "c" * 64
    fake = tmp_path / "preflight.py"
    _write_fake_preflight(fake, receipt, policy, receipt_payload=payload)
    canonical = tmp_path / "canonical"
    canonical.mkdir()

    result = run_gen(
        f'run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"'
    )

    assert result.returncode == 64, result.stdout + result.stderr


def test_preflight_rejects_multiple_new_receipt_entries(tmp_path: Path) -> None:
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    receipt = receipts / "receipt.json"
    decoy = receipts / "decoy.json"
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    fake = tmp_path / "preflight.py"
    _write_fake_preflight(fake, receipt, policy, extra_entries=(decoy,))
    canonical = tmp_path / "canonical"
    canonical.mkdir()

    result = run_gen(
        f'run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"'
    )

    assert result.returncode == 64, result.stdout + result.stderr
