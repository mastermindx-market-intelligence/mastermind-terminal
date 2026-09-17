"""Fail-closed W2B-A contract for exact-target Terminal deploy admission.

This suite never contacts production.  It sources the incumbent deploy owner as a
library, drives its pure/read-only admission helpers against temporary fixtures,
and pins the executable-body order that keeps source mutation behind W2A proof.
"""

from __future__ import annotations

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


def run_gen(body: str) -> subprocess.CompletedProcess[str]:
    driver = textwrap.dedent(
        f"""
        . "{SCRIPT}"
        set +e
        {textwrap.dedent(body)}
        """
    )
    return subprocess.run(
        [_bash(), "-c", driver], capture_output=True, text=True, timeout=60
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
        select_preflight_artifacts "{tmp_path / 'owner-ops'}" "{tmp_path / 'canonical-ops'}"
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
        select_preflight_artifacts "{owner}" "{tmp_path / 'canonical-ops'}"
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
        select_preflight_artifacts "{owner}" "{tmp_path / 'canonical-ops'}"
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
        select_preflight_artifacts "{owner}" "{tmp_path / 'canonical-ops'}"
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
        f'select_preflight_artifacts "{first}" "{second}"'
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
    fake = tmp_path / "preflight.py"
    fake.write_text(
        """import json
from pathlib import Path
Path('"""
        + str(receipt)
        + """').write_text('{}', encoding='utf-8')
print(json.dumps({
  'schema': 'mastermind.terminal.release_preflight_receipt.v1',
  'result': 'CLEAN',
  'accepted_sha': '"""
        + VALID_SHA
        + """',
  'receipt_path': '"""
        + str(receipt)
        + """',
  'receipt_id': 'outer-id',
  'source_audit_receipt_id': 'inner-id',
}))
""",
        encoding="utf-8",
    )
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    canonical = tmp_path / "canonical"
    canonical.mkdir()
    result = run_gen(
        f"""
        run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"
        rc=$?
        printf 'RC=%s\\nACCEPTED=%s\\nPATH=%s\\nOUTER=%s\\nINNER=%s\\n' \\
          "$rc" "$PREFLIGHT_ACCEPTED_SHA" "$PREFLIGHT_RECEIPT_PATH" \\
          "$PREFLIGHT_RECEIPT_ID" "$PREFLIGHT_SOURCE_RECEIPT_ID"
        exit "$rc"
        """
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"ACCEPTED={VALID_SHA}" in result.stdout
    assert f"PATH={receipt}" in result.stdout
    assert "OUTER=outer-id" in result.stdout
    assert "INNER=inner-id" in result.stdout


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
        f'admit_target_sha "{repo}" "{accepted}" "refs/heads/master"'
    )
    bad = run_gen(
        f'admit_target_sha "{repo}" "{unaccepted}" "refs/heads/master"'
    )
    assert good.returncode == 0, good.stdout + good.stderr
    assert bad.returncode != 0, "a commit outside the accepted ref was admitted"


def test_preflight_is_before_every_source_or_build_mutation() -> None:
    body = _deploy_body(code_only=True)
    preflight = body.index("run_release_preflight")
    mutation_tokens = (
        'git -C "$SRC" fetch',
        'git -C "$SRC" reset',
        'git -C "$SRC" clean',
        "npm ci",
        "npm run build",
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
    assert "group or other writable" in library

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
    fake = tmp_path / "preflight.py"
    fake.write_text(
        """import json
from pathlib import Path
Path('"""
        + str(receipt)
        + """').write_text('{}', encoding='utf-8')
print(json.dumps({
  'schema': '"""
        + schema
        + """',
  'result': 'CLEAN',
  'accepted_sha': '"""
        + accepted_sha
        + """',
  'receipt_path': '"""
        + str(receipt)
        + """',
  'receipt_id': 'outer-id',
  'source_audit_receipt_id': 'inner-id',
}))
""",
        encoding="utf-8",
    )
    policy = tmp_path / "policy.json"
    policy.write_text("{}\n", encoding="utf-8")
    canonical = tmp_path / "canonical"
    canonical.mkdir()
    result = run_gen(
        f'run_release_preflight "{fake}" "{policy}" "{canonical}" "{receipts}"'
    )
    assert result.returncode == 64, result.stdout + result.stderr
