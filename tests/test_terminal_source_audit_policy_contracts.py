from __future__ import annotations

import copy
import os
import shutil
import subprocess
from pathlib import Path

import pytest

import ops.terminal_audit.compare as audit_compare
from ops.terminal_source_audit import EXIT_CLEAN, EXIT_UNKNOWN_STOP, audit_source


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout.strip()


@pytest.fixture()
def policy_fixture(tmp_path: Path) -> dict[str, object]:
    repo = tmp_path / "repo"
    live = tmp_path / "live"
    repo.mkdir()
    live.mkdir()

    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.name", "Audit Contract Test")
    git(repo, "config", "user.email", "audit-contract@example.invalid")

    terminal = repo / "terminal"
    data = terminal / "public" / "data"
    data.mkdir(parents=True)
    (terminal / "app.py").write_text("print('canonical')\n", encoding="utf-8")
    (terminal / ".env.example").write_text("PUBLIC_SETTING=example\n", encoding="utf-8")
    (data / "seed.json").write_text('{"seed": 1}\n', encoding="utf-8")
    (data / "fixture.json").write_text('{"fixture": true}\n', encoding="utf-8")

    git(repo, "add", ".")
    git(repo, "commit", "-qm", "fixture")
    accepted_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", accepted_sha)

    shutil.copytree(terminal, live, dirs_exist_ok=True)
    marker = live / ".deployment-id"
    marker.write_text(f"{accepted_sha}\n", encoding="utf-8")

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
                    {
                        "path": ".deployment-id",
                        "classification": "deployment_marker",
                    }
                ],
            }
        ],
    }
    return {
        "repo": repo,
        "live": live,
        "sha": accepted_sha,
        "policy": policy,
    }


def run(fixture: dict[str, object], *, policy: dict[str, object] | None = None):
    return audit_source(
        canonical_repo=fixture["repo"],
        accepted_sha=fixture["sha"],
        policy=policy or fixture["policy"],
    )


def mapping_policy(fixture: dict[str, object]) -> dict[str, object]:
    policy = copy.deepcopy(fixture["policy"])
    assert isinstance(policy, dict)
    return policy


def allowances(policy: dict[str, object]) -> list[dict[str, object]]:
    mappings = policy["mappings"]
    assert isinstance(mappings, list)
    mapping = mappings[0]
    assert isinstance(mapping, dict)
    result = mapping["allowances"]
    assert isinstance(result, list)
    return result


def finding_codes(receipt: dict[str, object]) -> list[str]:
    findings = receipt["findings"]
    assert isinstance(findings, list)
    return [item["code"] for item in findings]


def runtime_tree_oid(fixture: dict[str, object]) -> str:
    repo = fixture["repo"]
    sha = fixture["sha"]
    assert isinstance(repo, Path)
    assert isinstance(sha, str)
    return git(repo, "rev-parse", f"{sha}:terminal/public/data")


def tracked_blob(fixture: dict[str, object], path: str = ".env.example") -> str:
    repo = fixture["repo"]
    sha = fixture["sha"]
    assert isinstance(repo, Path)
    assert isinstance(sha, str)
    return git(repo, "rev-parse", f"{sha}:terminal/{path}")


def add_tracked_absence(
    fixture: dict[str, object],
    policy: dict[str, object],
    path: str = ".env.example",
    *,
    blob_oid: str | None = None,
) -> None:
    allowances(policy).append(
        {
            "path": path,
            "classification": "tracked_non_deployed_template",
            "allow_tracked_absence": True,
            "canonical_git_blob": blob_oid or tracked_blob(fixture, path),
            "canonical_git_mode": "100644",
        }
    )


def add_runtime_subtree(
    fixture: dict[str, object],
    policy: dict[str, object],
    *,
    path: str = "public/data",
    tree_oid: str | None = None,
) -> None:
    allowances(policy).append(
        {
            "path": path,
            "classification": "host_owned_runtime_market_data",
            "allow_tracked_runtime_subtree": True,
            "canonical_git_tree": tree_oid or runtime_tree_oid(fixture),
        }
    )


def test_missing_tracked_blob_blocks_without_exact_absence_contract(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    (live / ".env.example").unlink()

    receipt, exit_code = run(policy_fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["TRACKED_MISSING"]


def test_exact_tracked_absence_is_recorded_not_silently_omitted(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    (live / ".env.example").unlink()
    policy = mapping_policy(policy_fixture)
    add_tracked_absence(policy_fixture, policy)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_CLEAN
    mapping = receipt["mappings"][0]
    assert mapping["allowed_tracked_absence_count"] == 1
    assert mapping["allowed_tracked_absences"] == [
        {
            "path": ".env.example",
            "classification": "tracked_non_deployed_template",
            "canonical_git_blob": git(
                policy_fixture["repo"],
                "rev-parse",
                f"{policy_fixture['sha']}:terminal/.env.example",
            ),
            "canonical_mode": "100644",
        }
    ]
    assert receipt["summary"]["allowed_tracked_absences"] == 1


@pytest.mark.parametrize("path", ["public/data", "does-not-exist.txt"])
def test_tracked_absence_contract_rejects_tree_or_untracked_path(
    policy_fixture: dict[str, object], path: str
) -> None:
    policy = mapping_policy(policy_fixture)
    blob_oid = None if path == "public/data" else "0" * 40
    add_tracked_absence(policy_fixture, policy, path, blob_oid=blob_oid)

    with pytest.raises(ValueError, match="exact tracked regular blob"):
        run(policy_fixture, policy=policy)


def test_present_but_modified_tracked_absence_contract_still_blocks(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    (live / ".env.example").write_text("PUBLIC_SETTING=changed\n", encoding="utf-8")
    policy = mapping_policy(policy_fixture)
    add_tracked_absence(policy_fixture, policy)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["TRACKED_MODIFIED"]
    assert receipt["mappings"][0]["allowed_tracked_absence_count"] == 0


def test_changing_allowed_path_does_not_hide_env_template_absence(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    (live / ".env.example").unlink()
    policy = mapping_policy(policy_fixture)
    add_tracked_absence(policy_fixture, policy, "app.py")

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["TRACKED_MISSING"]


def test_tracked_absence_pin_invalidates_after_canonical_blob_changes(
    policy_fixture: dict[str, object],
) -> None:
    repo = policy_fixture["repo"]
    live = policy_fixture["live"]
    assert isinstance(repo, Path)
    assert isinstance(live, Path)
    (live / ".env.example").unlink()
    policy = mapping_policy(policy_fixture)
    old_blob = tracked_blob(policy_fixture)
    add_tracked_absence(policy_fixture, policy, blob_oid=old_blob)

    first, first_exit = run(policy_fixture, policy=policy)
    assert first_exit == EXIT_CLEAN

    (repo / "terminal" / ".env.example").write_text(
        "PUBLIC_SETTING=new-canonical-example\n", encoding="utf-8"
    )
    git(repo, "add", "terminal/.env.example")
    git(repo, "commit", "-qm", "change template")
    new_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", new_sha)
    policy_fixture["sha"] = new_sha
    (live / ".deployment-id").write_text(f"{new_sha}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="tracked absence.*canonical_git_blob"):
        run(policy_fixture, policy=policy)


def test_normal_allowance_on_tracked_subtree_still_blocks(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {"path": "public/data", "classification": "host_owned_runtime_market_data"}
    )

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == [
        "ALLOWANCE_SHADOWS_TRACKED_PATH",
        "ALLOWANCE_SHADOWS_TRACKED_PATH",
    ]


def test_pinned_runtime_subtree_records_evidence_without_reading_content(
    policy_fixture: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    data = live / "public" / "data"
    (data / "seed.json").write_text('{"runtime": "changed"}\n', encoding="utf-8")
    (data / "fixture.json").unlink()
    (data / "runtime-only.json").write_text('{"live": true}\n', encoding="utf-8")
    policy = mapping_policy(policy_fixture)
    tree_oid = runtime_tree_oid(policy_fixture)
    add_runtime_subtree(policy_fixture, policy, tree_oid=tree_oid)

    real_live_blob = audit_compare.live_blob
    real_host_hash = audit_compare.sha256_file_or_link

    def refuse_runtime_blob(path: Path):
        if data in path.parents:
            raise AssertionError("runtime subtree content must not be opened or hashed")
        return real_live_blob(path)

    def refuse_runtime_host_hash(path: Path):
        if data in path.parents:
            raise AssertionError("runtime subtree host-only content must not be hashed")
        return real_host_hash(path)

    monkeypatch.setattr(audit_compare, "live_blob", refuse_runtime_blob)
    monkeypatch.setattr(audit_compare, "sha256_file_or_link", refuse_runtime_host_hash)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_CLEAN
    mapping = receipt["mappings"][0]
    assert mapping["allowed_tracked_runtime_subtree_count"] == 1
    assert mapping["allowed_tracked_runtime_subtrees"] == [
        {
            "path": "public/data",
            "classification": "host_owned_runtime_market_data",
            "canonical_git_tree": tree_oid,
            "tracked_paths": 2,
            "live_root_state": "PRESENT",
        }
    ]
    assert receipt["summary"]["allowed_tracked_runtime_subtrees"] == 1


@pytest.mark.parametrize(
    ("path", "tree_oid", "message"),
    [
        ("app.py", "0" * 40, "exact tracked tree"),
        ("does-not-exist", "0" * 40, "exact tracked tree"),
        ("public/data", "0" * 40, "canonical_git_tree"),
    ],
)
def test_runtime_subtree_contract_rejects_blob_missing_or_wrong_tree(
    policy_fixture: dict[str, object], path: str, tree_oid: str, message: str
) -> None:
    policy = mapping_policy(policy_fixture)
    add_runtime_subtree(policy_fixture, policy, path=path, tree_oid=tree_oid)

    with pytest.raises(ValueError, match=message):
        run(policy_fixture, policy=policy)


def test_runtime_subtree_pin_invalidates_after_tracked_tree_changes(
    policy_fixture: dict[str, object],
) -> None:
    repo = policy_fixture["repo"]
    live = policy_fixture["live"]
    assert isinstance(repo, Path)
    assert isinstance(live, Path)
    policy = mapping_policy(policy_fixture)
    old_tree = runtime_tree_oid(policy_fixture)
    add_runtime_subtree(policy_fixture, policy, tree_oid=old_tree)

    (repo / "terminal" / "public" / "data" / "new.json").write_text(
        '{"new": true}\n', encoding="utf-8"
    )
    git(repo, "add", "terminal/public/data/new.json")
    git(repo, "commit", "-qm", "change runtime tree")
    new_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", new_sha)
    policy_fixture["sha"] = new_sha
    (live / ".deployment-id").write_text(f"{new_sha}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="canonical_git_tree"):
        run(policy_fixture, policy=policy)


@pytest.mark.parametrize("replacement", ["missing", "symlink"])
def test_runtime_subtree_live_root_must_be_real_directory(
    policy_fixture: dict[str, object], replacement: str
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    data = live / "public" / "data"
    shutil.rmtree(data)
    if replacement == "symlink":
        target = live / "elsewhere"
        target.mkdir()
        os.symlink(target, data)
    policy = mapping_policy(policy_fixture)
    add_runtime_subtree(policy_fixture, policy)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    expected = (
        "ALLOWED_RUNTIME_SUBTREE_MISSING"
        if replacement == "missing"
        else "ALLOWED_RUNTIME_SUBTREE_TYPE_MISMATCH"
    )
    assert finding_codes(receipt) == [expected]


def test_runtime_subtree_contract_does_not_hide_outside_source_drift(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    (live / "app.py").write_text("print('host edit')\n", encoding="utf-8")
    policy = mapping_policy(policy_fixture)
    add_runtime_subtree(policy_fixture, policy)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["TRACKED_MODIFIED"]


def test_tracked_absence_contract_requires_canonical_blob_pin(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": ".env.example",
            "classification": "tracked_non_deployed_template",
            "allow_tracked_absence": True,
        }
    )

    with pytest.raises(ValueError, match="canonical_git_blob"):
        run(policy_fixture, policy=policy)


def test_special_allowance_flags_require_real_json_booleans(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": ".env.example",
            "classification": "tracked_non_deployed_template",
            "allow_tracked_absence": "true",
        }
    )

    with pytest.raises(ValueError, match="must be a boolean"):
        run(policy_fixture, policy=policy)


def test_sensitive_allowance_flag_requires_a_real_json_boolean(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": "host-only.conf",
            "classification": "host_local_config",
            "sensitive": "false",
        }
    )

    with pytest.raises(ValueError, match="sensitive must be a boolean"):
        run(policy_fixture, policy=policy)


def test_ordinary_allowance_root_must_match_declared_live_type(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    (live / "runtime-cache").mkdir()
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": "runtime-cache",
            "classification": "host_runtime_cache",
            "expected_live_type": "file",
        }
    )

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["ALLOWANCE_LIVE_TYPE_MISMATCH"]
    assert receipt["findings"][0]["expected_live_type"] == "file"
    assert receipt["findings"][0]["live_type"] == "directory"


def test_ordinary_allowance_root_symlink_never_counts_as_allowed(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    outside = live.parent / "outside-runtime"
    outside.mkdir()
    os.symlink(outside, live / "runtime-cache")
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": "runtime-cache",
            "classification": "host_runtime_cache",
            "expected_live_type": "directory",
        }
    )

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["ALLOWANCE_LIVE_TYPE_MISMATCH"]
    assert receipt["findings"][0]["live_type"] == "symlink"
    assert receipt["findings"][0]["path"] == "runtime-cache"
    # The valid deployment marker remains counted; the unsafe cache root does not.
    assert receipt["mappings"][0]["allowed_paths"] == 1


def test_classification_label_cannot_bypass_allowance_type_validation(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    outside = live.parent / "outside-runtime-label"
    outside.mkdir()
    os.symlink(outside, live / "runtime-cache")
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": "runtime-cache",
            "classification": "deployment_marker",
            "expected_live_type": "directory",
        }
    )

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["ALLOWANCE_LIVE_TYPE_MISMATCH"]
    assert receipt["findings"][0]["live_type"] == "symlink"


def test_expected_live_type_accepts_only_file_or_directory(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": "runtime-cache",
            "classification": "host_runtime_cache",
            "expected_live_type": "socket",
        }
    )

    with pytest.raises(ValueError, match="expected_live_type"):
        run(policy_fixture, policy=policy)


def test_runtime_subtree_descendant_symlink_blocks_without_following_target(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    data = live / "public" / "data"
    outside = live.parent / "outside-data"
    outside.mkdir()
    (outside / "secret.json").write_text('{"secret": true}\n', encoding="utf-8")
    os.symlink(outside, data / "escape")
    policy = mapping_policy(policy_fixture)
    add_runtime_subtree(policy_fixture, policy)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["ALLOWED_RUNTIME_SUBTREE_SYMLINK"]
    finding = receipt["findings"][0]
    assert finding["path"] == "public/data/escape"
    assert "secret" not in str(receipt)


def runtime_file_blob(fixture: dict[str, object], path: str = "app.py") -> str:
    repo = fixture["repo"]
    sha = fixture["sha"]
    assert isinstance(repo, Path)
    assert isinstance(sha, str)
    return git(repo, "rev-parse", f"{sha}:terminal/{path}")


def add_runtime_file(
    fixture: dict[str, object],
    policy: dict[str, object],
    *,
    path: str = "app.py",
    blob_oid: str | None = None,
) -> None:
    allowances(policy).append(
        {
            "path": path,
            "classification": "host_runtime_cache",
            "allow_tracked_runtime_file": True,
            "canonical_git_blob": blob_oid or runtime_file_blob(fixture, path),
            "canonical_git_mode": "100644",
        }
    )


def test_pinned_runtime_file_records_evidence_without_reading_content(
    policy_fixture: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    runtime_file = live / "app.py"
    runtime_file.write_text("runtime-owned bytes\n", encoding="utf-8")
    policy = mapping_policy(policy_fixture)
    blob_oid = runtime_file_blob(policy_fixture)
    add_runtime_file(policy_fixture, policy, blob_oid=blob_oid)

    real_live_blob = audit_compare.live_blob

    def refuse_runtime_blob(path: Path):
        if path == runtime_file:
            raise AssertionError("runtime file content must not be opened or hashed")
        return real_live_blob(path)

    monkeypatch.setattr(audit_compare, "live_blob", refuse_runtime_blob)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_CLEAN
    mapping = receipt["mappings"][0]
    assert mapping["allowed_tracked_runtime_file_count"] == 1
    assert mapping["allowed_tracked_runtime_files"] == [
        {
            "path": "app.py",
            "classification": "host_runtime_cache",
            "canonical_git_blob": blob_oid,
            "canonical_mode": "100644",
            "live_state": "PRESENT",
        }
    ]
    assert receipt["summary"]["allowed_tracked_runtime_files"] == 1


@pytest.mark.parametrize(
    ("path", "blob_oid", "message"),
    [
        ("public/data", "0" * 40, "exact tracked regular blob"),
        ("does-not-exist", "0" * 40, "exact tracked regular blob"),
        ("app.py", "0" * 40, "canonical_git_blob"),
    ],
)
def test_runtime_file_contract_rejects_tree_missing_or_wrong_blob(
    policy_fixture: dict[str, object], path: str, blob_oid: str, message: str
) -> None:
    policy = mapping_policy(policy_fixture)
    add_runtime_file(
        policy_fixture,
        policy,
        path=path,
        blob_oid=blob_oid,
    )

    with pytest.raises(ValueError, match=message):
        run(policy_fixture, policy=policy)


@pytest.mark.parametrize("replacement", ["missing", "symlink"])
def test_runtime_file_live_path_must_be_real_regular_file(
    policy_fixture: dict[str, object], replacement: str
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    runtime_file = live / "app.py"
    runtime_file.unlink()
    if replacement == "symlink":
        target = live.parent / "runtime-target"
        target.write_text("runtime\n", encoding="utf-8")
        os.symlink(target, runtime_file)
    policy = mapping_policy(policy_fixture)
    add_runtime_file(policy_fixture, policy)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    expected = (
        "ALLOWED_RUNTIME_FILE_MISSING"
        if replacement == "missing"
        else "ALLOWED_RUNTIME_FILE_TYPE_MISMATCH"
    )
    assert finding_codes(receipt) == [expected]


def test_runtime_file_pin_invalidates_after_tracked_blob_changes(
    policy_fixture: dict[str, object],
) -> None:
    repo = policy_fixture["repo"]
    live = policy_fixture["live"]
    assert isinstance(repo, Path)
    assert isinstance(live, Path)
    policy = mapping_policy(policy_fixture)
    old_blob = runtime_file_blob(policy_fixture)
    add_runtime_file(policy_fixture, policy, blob_oid=old_blob)

    (repo / "terminal" / "app.py").write_text(
        "print('new canonical')\n", encoding="utf-8"
    )
    git(repo, "add", "terminal/app.py")
    git(repo, "commit", "-qm", "change runtime file snapshot")
    new_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", new_sha)
    policy_fixture["sha"] = new_sha
    (live / ".deployment-id").write_text(f"{new_sha}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="canonical_git_blob"):
        run(policy_fixture, policy=policy)


def test_runtime_file_contract_does_not_hide_outside_source_drift(
    policy_fixture: dict[str, object],
) -> None:
    live = policy_fixture["live"]
    assert isinstance(live, Path)
    (live / "app.py").write_text("runtime-owned bytes\n", encoding="utf-8")
    (live / ".env.example").write_text("PUBLIC_SETTING=drift\n", encoding="utf-8")
    policy = mapping_policy(policy_fixture)
    add_runtime_file(policy_fixture, policy)

    receipt, exit_code = run(policy_fixture, policy=policy)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert finding_codes(receipt) == ["TRACKED_MODIFIED"]


def test_runtime_file_flag_requires_a_real_json_boolean(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": "app.py",
            "classification": "host_runtime_cache",
            "allow_tracked_runtime_file": "true",
            "canonical_git_blob": runtime_file_blob(policy_fixture),
        }
    )

    with pytest.raises(ValueError, match="must be a boolean"):
        run(policy_fixture, policy=policy)


def test_unknown_allowance_field_fails_closed(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    allowances(policy).append(
        {
            "path": "runtime-cache",
            "classification": "host_runtime_cache",
            "expected_live_typ": "directory",
        }
    )

    with pytest.raises(ValueError, match="unknown fields.*expected_live_typ"):
        run(policy_fixture, policy=policy)


@pytest.mark.parametrize("level", ["root", "mapping"])
def test_unknown_policy_structure_field_fails_closed(
    policy_fixture: dict[str, object], level: str
) -> None:
    policy = mapping_policy(policy_fixture)
    if level == "root":
        policy["accepted_refs"] = policy["accepted_ref"]
        unknown = "accepted_refs"
    else:
        mappings = policy["mappings"]
        assert isinstance(mappings, list)
        mapping = mappings[0]
        assert isinstance(mapping, dict)
        mapping["live_paths"] = mapping["live_path"]
        unknown = "live_paths"

    with pytest.raises(ValueError, match=rf"unknown fields.*{unknown}"):
        run(policy_fixture, policy=policy)


def test_tracked_absence_contract_requires_canonical_mode_pin(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    add_tracked_absence(policy_fixture, policy)
    allowances(policy)[-1].pop("canonical_git_mode")

    with pytest.raises(ValueError, match="canonical_git_mode"):
        run(policy_fixture, policy=policy)


def test_runtime_file_contract_requires_canonical_mode_pin(
    policy_fixture: dict[str, object],
) -> None:
    policy = mapping_policy(policy_fixture)
    add_runtime_file(policy_fixture, policy)
    allowances(policy)[-1].pop("canonical_git_mode")

    with pytest.raises(ValueError, match="canonical_git_mode"):
        run(policy_fixture, policy=policy)


def test_tracked_absence_pin_invalidates_after_canonical_mode_changes(
    policy_fixture: dict[str, object],
) -> None:
    repo = policy_fixture["repo"]
    live = policy_fixture["live"]
    assert isinstance(repo, Path)
    assert isinstance(live, Path)
    (live / ".env.example").unlink()
    policy = mapping_policy(policy_fixture)
    add_tracked_absence(policy_fixture, policy)

    git(repo, "update-index", "--chmod=+x", "terminal/.env.example")
    git(repo, "commit", "-qm", "change template mode")
    new_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", new_sha)
    policy_fixture["sha"] = new_sha
    (live / ".deployment-id").write_text(f"{new_sha}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="canonical_git_mode"):
        run(policy_fixture, policy=policy)


def test_runtime_file_pin_invalidates_after_canonical_mode_changes(
    policy_fixture: dict[str, object],
) -> None:
    repo = policy_fixture["repo"]
    live = policy_fixture["live"]
    assert isinstance(repo, Path)
    assert isinstance(live, Path)
    policy = mapping_policy(policy_fixture)
    add_runtime_file(policy_fixture, policy)

    git(repo, "update-index", "--chmod=+x", "terminal/app.py")
    git(repo, "commit", "-qm", "change runtime file mode")
    new_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", new_sha)
    policy_fixture["sha"] = new_sha
    (live / ".deployment-id").write_text(f"{new_sha}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="canonical_git_mode"):
        run(policy_fixture, policy=policy)


@pytest.mark.parametrize(
    "contract",
    ["absence", "runtime_subtree", "runtime_file"],
)
def test_special_tracked_contract_rejects_inert_expected_live_type(
    policy_fixture: dict[str, object], contract: str
) -> None:
    policy = mapping_policy(policy_fixture)
    if contract == "absence":
        add_tracked_absence(policy_fixture, policy)
    elif contract == "runtime_subtree":
        add_runtime_subtree(policy_fixture, policy)
    else:
        add_runtime_file(policy_fixture, policy)
    allowances(policy)[-1]["expected_live_type"] = "file"

    with pytest.raises(ValueError, match="expected_live_type.*special tracked"):
        run(policy_fixture, policy=policy)
