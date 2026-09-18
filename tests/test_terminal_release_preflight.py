from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest

import ops.terminal_release_preflight as preflight
from ops.terminal_audit.model import EXIT_CLEAN, EXIT_INPUT_ERROR, EXIT_UNKNOWN_STOP
from ops.terminal_audit.policy import parse_policy

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FIXED_NOW = datetime(2026, 9, 17, 4, 0, 0, tzinfo=timezone.utc)


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout.strip()


def git_mode(repo: Path, revision: str, path: str) -> str:
    record = git(repo, "ls-tree", revision, "--", path)
    return record.split(" ", 1)[0]


@pytest.fixture()
def preflight_fixture(tmp_path: Path) -> dict[str, object]:
    repo = tmp_path / "repo"
    live = tmp_path / "live"
    receipt_dir = tmp_path / "receipts"
    repo.mkdir()
    live.mkdir()

    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.name", "Preflight Test")
    git(repo, "config", "user.email", "preflight@example.invalid")

    terminal = repo / "terminal"
    terminal.mkdir()
    (terminal / "app.py").write_text("print('canonical')\n", encoding="utf-8")
    shutil.copytree(terminal, live, dirs_exist_ok=True)
    marker = live / ".deployment-id"

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
    ops = repo / "ops"
    ops.mkdir()
    policy_path = ops / "terminal_source_audit.production.json"
    policy_path.write_text(json.dumps(policy, sort_keys=True), encoding="utf-8")

    git(repo, "add", ".")
    git(repo, "commit", "-qm", "fixture")
    accepted_sha = git(repo, "rev-parse", "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/master", accepted_sha)
    marker.write_text(f"{accepted_sha}\n", encoding="utf-8")

    return {
        "repo": repo,
        "live": live,
        "marker": marker,
        "policy": policy,
        "policy_path": policy_path,
        "receipt_dir": receipt_dir,
        "sha": accepted_sha,
    }


def run_fixture(fixture: dict[str, object]):
    return preflight.run_preflight(
        canonical_repo=fixture["repo"],
        policy_path=fixture["policy_path"],
        receipt_dir=fixture["receipt_dir"],
        now=FIXED_NOW,
    )


def test_release_preflight_owner_exists() -> None:
    assert (PROJECT_ROOT / "ops" / "terminal_release_preflight.py").is_file()


def test_production_source_audit_policy_exists() -> None:
    assert (PROJECT_ROOT / "ops" / "terminal_source_audit.production.json").is_file()


def test_clean_preflight_reads_marker_and_writes_immutable_receipt(
    preflight_fixture: dict[str, object],
) -> None:
    receipt, exit_code, receipt_path = run_fixture(preflight_fixture)

    assert exit_code == EXIT_CLEAN
    assert receipt["schema"] == "mastermind.terminal.release_preflight_receipt.v1"
    assert receipt["result"] == "CLEAN"
    assert receipt["accepted_sha"] == preflight_fixture["sha"]
    assert receipt["source_audit"]["status"] == "CLEAN"
    assert receipt["source_audit_receipt_id"] == receipt["source_audit"]["receipt_id"]
    assert receipt["policy_digest"] == receipt["source_audit"]["policy_digest"]
    assert receipt_path.parent == preflight_fixture["receipt_dir"]
    assert receipt_path.is_file()
    assert stat.S_IMODE(receipt_path.stat().st_mode) == 0o640
    assert json.loads(receipt_path.read_text(encoding="utf-8")) == receipt
    assert receipt_path.name.startswith("20260917T040000Z-")


def test_reviewed_policy_artifact_may_live_outside_current_deployed_checkout(
    preflight_fixture: dict[str, object], tmp_path: Path
) -> None:
    original = preflight_fixture["policy_path"]
    assert isinstance(original, Path)
    reviewed_policy = tmp_path / "reviewed-production-policy.json"
    reviewed_policy.write_bytes(original.read_bytes())

    receipt, exit_code, receipt_path = preflight.run_preflight(
        canonical_repo=preflight_fixture["repo"],
        policy_path=reviewed_policy,
        receipt_dir=preflight_fixture["receipt_dir"],
        now=FIXED_NOW,
    )

    assert exit_code == EXIT_CLEAN
    assert receipt["policy_path"] == str(reviewed_policy.resolve())
    assert receipt["source_audit"]["policy_digest"]
    assert receipt_path.is_file()


def test_blocked_preflight_publishes_unknown_stop_receipt(
    preflight_fixture: dict[str, object],
) -> None:
    live = preflight_fixture["live"]
    assert isinstance(live, Path)
    (live / "app.py").write_text("print('host edit')\n", encoding="utf-8")

    receipt, exit_code, receipt_path = run_fixture(preflight_fixture)

    assert exit_code == EXIT_UNKNOWN_STOP
    assert receipt["result"] == "UNKNOWN_STOP"
    assert receipt_path.is_file()
    assert [item["code"] for item in receipt["source_audit"]["findings"]] == [
        "TRACKED_MODIFIED"
    ]


@pytest.mark.parametrize("root_key", ["repo", "live"])
def test_preflight_refuses_receipt_directory_inside_source_roots(
    preflight_fixture: dict[str, object], root_key: str
) -> None:
    root = preflight_fixture[root_key]
    assert isinstance(root, Path)

    with pytest.raises(ValueError, match="outside canonical and live source roots"):
        preflight.run_preflight(
            canonical_repo=preflight_fixture["repo"],
            policy_path=preflight_fixture["policy_path"],
            receipt_dir=root / "receipts",
            now=FIXED_NOW,
        )


def test_preflight_never_clobbers_an_existing_receipt(
    preflight_fixture: dict[str, object],
) -> None:
    _, first_exit, first_path = run_fixture(preflight_fixture)
    assert first_exit == EXIT_CLEAN

    with pytest.raises(
        FileExistsError, match="immutable preflight receipt already exists"
    ):
        run_fixture(preflight_fixture)

    assert first_path.is_file()


def test_cli_invalid_marker_returns_documented_input_error(
    preflight_fixture: dict[str, object], capsys: pytest.CaptureFixture[str]
) -> None:
    marker = preflight_fixture["marker"]
    assert isinstance(marker, Path)
    marker.write_text("not-a-sha\n", encoding="utf-8")

    exit_code = preflight.main(
        [
            "--canonical-repo",
            str(preflight_fixture["repo"]),
            "--policy",
            str(preflight_fixture["policy_path"]),
            "--receipt-dir",
            str(preflight_fixture["receipt_dir"]),
        ]
    )

    assert exit_code == EXIT_INPUT_ERROR
    assert "input/audit error" in capsys.readouterr().err
    assert not Path(preflight_fixture["receipt_dir"]).exists()


def test_production_policy_is_complete_narrow_and_tree_pinned() -> None:
    policy_path = PROJECT_ROOT / "ops" / "terminal_source_audit.production.json"
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    parse_policy(policy)

    mappings = policy["mappings"]
    by_name = {item["name"]: item for item in mappings}
    assert set(by_name) == {
        "terminal-app",
        "terminal-ingest",
        "terminal-scripts",
        "terminal-config",
        "terminal-contracts",
        "terminal-hub",
        "terminal-signal-layer",
        "terminal-data-wrapper",
        "terminal-build-wrapper",
    }
    assert by_name["terminal-app"]["repo_path"] == "terminal"
    assert by_name["terminal-app"]["live_path"] == "/opt/terminal/terminal"
    assert by_name["terminal-data-wrapper"] == {
        "name": "terminal-data-wrapper",
        "repo_path": "ops/terminal-data",
        "live_path": "/usr/local/bin/terminal-data",
    }
    assert by_name["terminal-build-wrapper"] == {
        "name": "terminal-build-wrapper",
        "repo_path": "ops/terminal-build.sh",
        "live_path": "/opt/terminal/terminal-build.sh",
    }

    app_allowances = {
        item["path"]: item for item in by_name["terminal-app"]["allowances"]
    }
    assert set(app_allowances) == {
        ".deployment-id",
        ".env",
        ".env.local",
        ".env.local.bak-20260706",
        ".env.example",
        ".next",
        ".next.bak",
        "node_modules",
        "public/data",
    }
    env_template = app_allowances[".env.example"]
    assert env_template["allow_tracked_absence"] is True
    assert env_template["canonical_git_blob"] == git(
        PROJECT_ROOT, "rev-parse", "HEAD:terminal/.env.example"
    )
    assert env_template["canonical_git_mode"] == git_mode(
        PROJECT_ROOT, "HEAD", "terminal/.env.example"
    ) == "100644"
    expected_app_types = {
        ".deployment-id": "file",
        ".env": "file",
        ".env.local": "file",
        ".env.local.bak-20260706": "file",
        ".next": "directory",
        ".next.bak": "directory",
        "node_modules": "directory",
    }
    assert {
        path: app_allowances[path]["expected_live_type"] for path in expected_app_types
    } == expected_app_types
    runtime_data = app_allowances["public/data"]
    assert runtime_data["allow_tracked_runtime_subtree"] is True
    expected_tree = git(PROJECT_ROOT, "rev-parse", "HEAD:terminal/public/data")
    assert runtime_data["canonical_git_tree"] == expected_tree

    ingest_allowances = {
        item["path"]: item for item in by_name["terminal-ingest"]["allowances"]
    }
    assert set(ingest_allowances) == {
        ".polygon_exchanges.json",
        ".polygon_us_ref.json",
        "__pycache__",
        "backfill_ohlc.py.bak-preintl",
        "build_universe.py.bak-preintl",
        "dist",
        "hk_universe_cache.json",
        "zh_cache.json",
    }
    runtime_cache = ingest_allowances["hk_universe_cache.json"]
    assert runtime_cache["allow_tracked_runtime_file"] is True
    expected_blob = git(PROJECT_ROOT, "rev-parse", "HEAD:ingest/hk_universe_cache.json")
    assert runtime_cache["canonical_git_blob"] == expected_blob
    assert runtime_cache["canonical_git_mode"] == git_mode(
        PROJECT_ROOT, "HEAD", "ingest/hk_universe_cache.json"
    ) == "100644"
    assert "expected_live_type" not in runtime_cache

    special_contracts = {
        (mapping["name"], allowance["path"], field)
        for mapping in mappings
        for allowance in mapping.get("allowances", [])
        for field in (
            "allow_tracked_absence",
            "allow_tracked_runtime_subtree",
            "allow_tracked_runtime_file",
        )
        if allowance.get(field) is True
    }
    assert special_contracts == {
        ("terminal-app", ".env.example", "allow_tracked_absence"),
        ("terminal-app", "public/data", "allow_tracked_runtime_subtree"),
        (
            "terminal-ingest",
            "hk_universe_cache.json",
            "allow_tracked_runtime_file",
        ),
    }

    serialized = json.dumps(policy, sort_keys=True)
    assert "*" not in serialized
    assert ".env*" not in serialized
    assert policy["deployment_id_file"] == "/opt/terminal/terminal/.deployment-id"


def test_relative_policy_path_is_rejected_before_any_file_read(
    preflight_fixture: dict[str, object],
) -> None:
    with pytest.raises(ValueError, match="policy path must be an absolute path"):
        preflight.run_preflight(
            canonical_repo=preflight_fixture["repo"],
            policy_path=Path("relative-policy.json"),
            receipt_dir=preflight_fixture["receipt_dir"],
            now=FIXED_NOW,
        )


def test_preflight_refuses_writable_receipt_directory(
    preflight_fixture: dict[str, object],
) -> None:
    receipt_dir = preflight_fixture["receipt_dir"]
    assert isinstance(receipt_dir, Path)
    receipt_dir.mkdir()
    receipt_dir.chmod(0o777)

    with pytest.raises(ValueError, match="must not be group or other writable"):
        run_fixture(preflight_fixture)

    assert list(receipt_dir.iterdir()) == []


@pytest.mark.parametrize("input_kind", ["marker", "policy"])
def test_cli_symlink_input_returns_documented_input_error(
    preflight_fixture: dict[str, object],
    capsys: pytest.CaptureFixture[str],
    input_kind: str,
) -> None:
    source = preflight_fixture[input_kind if input_kind == "marker" else "policy_path"]
    assert isinstance(source, Path)
    target = source.with_name(f"{source.name}.real")
    source.rename(target)
    source.symlink_to(target.name)

    exit_code = preflight.main(
        [
            "--canonical-repo",
            str(preflight_fixture["repo"]),
            "--policy",
            str(preflight_fixture["policy_path"]),
            "--receipt-dir",
            str(preflight_fixture["receipt_dir"]),
        ]
    )

    assert exit_code == EXIT_INPUT_ERROR
    assert "input/audit error" in capsys.readouterr().err
    assert not Path(preflight_fixture["receipt_dir"]).exists()


def test_receipt_directory_is_rechecked_after_resolution_race(
    preflight_fixture: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    receipt_dir = preflight_fixture["receipt_dir"]
    live = preflight_fixture["live"]
    assert isinstance(receipt_dir, Path)
    assert isinstance(live, Path)
    original_resolve = Path.resolve
    receipt_resolves = 0

    def racing_resolve(path: Path, strict: bool = False) -> Path:
        nonlocal receipt_resolves
        if path == receipt_dir:
            receipt_resolves += 1
            if receipt_resolves >= 4:
                return original_resolve(live, strict=True)
        return original_resolve(path, strict=strict)

    def unexpected_render(_: object) -> bytes:
        pytest.fail("receipt bytes were rendered after containment changed")

    monkeypatch.setattr(Path, "resolve", racing_resolve)
    monkeypatch.setattr(preflight, "_render_receipt", unexpected_render)

    with pytest.raises(ValueError, match="outside canonical and live source roots"):
        run_fixture(preflight_fixture)
