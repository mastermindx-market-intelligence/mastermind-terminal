from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "ops" / "terminal_build_projection.py"
POLICY_PATH = REPO / "ops" / "terminal_build_projection.json"


def _git() -> str:
    found = shutil.which("git")
    assert found
    return str(Path(found).resolve(strict=True))


def _run(repo: Path, *args: str, input_bytes: bytes | None = None) -> str:
    result = subprocess.run(
        [_git(), "-C", str(repo), *args],
        input=input_bytes,
        capture_output=True,
        check=True,
    )
    return result.stdout.decode().strip()


def _repo(tmp_path: Path) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    _run(repo, "init", "-q")
    _run(repo, "config", "user.email", "test@example.invalid")
    _run(repo, "config", "user.name", "Projection Test")
    files = {
        "terminal/package.json": '{"name":"terminal"}\n',
        "terminal/package-lock.json": '{"lockfileVersion":3}\n',
        "terminal/app/route.ts": "export const route = 1;\n",
        "ingest/webhook_delivery.ts": "export const delivery = 1;\n",
        "ops/terminal_build_receipt.py": "SCHEMA = 'receipt'\n",
        "ops/terminal_build_projection.py": "HELPER = 'projection'\n",
        "README.md": "excluded\n",
    }
    for relative, content in files.items():
        path = repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    (repo / "macro-site-link").symlink_to("/Users/example/absolute/site")
    roots = sorted(["README.md", "ingest", "macro-site-link", "ops", "terminal"])
    fixture_policy = {
        "schema": "mastermind.terminal.build_projection_policy.v1",
        "included_roots": ["ingest", "terminal"],
        "excluded_roots": sorted(set(roots) - {"ingest", "terminal"}),
        "controller_evidence": {
            "projection_helper": "ops/terminal_build_projection.py",
            "projection_policy": "ops/terminal_build_projection.json",
            "receipt_helper": "ops/terminal_build_receipt.py",
            "package_json": "terminal/package.json",
            "package_lock": "terminal/package-lock.json",
        },
    }
    (repo / "ops/terminal_build_projection.json").write_text(
        json.dumps(fixture_policy, sort_keys=True) + "\n", encoding="utf-8"
    )
    _run(repo, "add", "-A")
    _run(repo, "commit", "-qm", "fixture")
    return repo, _run(repo, "rev-parse", "HEAD")


def _policy(tmp_path: Path, repo: Path) -> Path:
    path = tmp_path / "policy.json"
    path.write_bytes((repo / "ops/terminal_build_projection.json").read_bytes())
    return path


def _load_module():
    spec = importlib.util.spec_from_file_location("terminal_build_projection", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_policy_is_closed_and_names_the_exact_current_projection() -> None:
    payload = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    assert set(payload) == {
        "schema", "included_roots", "excluded_roots", "controller_evidence"
    }
    assert payload["included_roots"] == ["ingest", "terminal"]
    assert set(payload["controller_evidence"]) == {
        "projection_helper", "projection_policy", "receipt_helper",
        "package_json", "package_lock"
    }
    assert "macro-site-link" in payload["excluded_roots"]


def test_projection_materializes_exact_git_objects_and_controller_evidence(tmp_path: Path) -> None:
    projection = _load_module()
    repo, target = _repo(tmp_path)
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir(mode=0o755)
    evidence.mkdir(mode=0o700)
    result = projection.materialize_projection(
        repository=repo,
        target_sha=target,
        destination=destination,
        evidence_dir=evidence,
        policy_path=_policy(tmp_path, repo),
        git_path=_git(),
    )
    assert (destination / "terminal/app/route.ts").read_text() == "export const route = 1;\n"
    assert (destination / "ingest/webhook_delivery.ts").is_file()
    assert not (destination / "README.md").exists()
    assert not (destination / "macro-site-link").exists()
    assert result["target_sha"] == target
    assert result["target_tree"] == _run(repo, "rev-parse", f"{target}^{{tree}}")
    assert result["included_roots"] == ["ingest", "terminal"]
    assert {item["path"] for item in result["excluded_roots"]} >= {"README.md", "macro-site-link"}
    manifest = json.loads((evidence / "projection-manifest.json").read_text())
    assert manifest == result
    assert (evidence / "projection-helper.py").read_text() == "HELPER = 'projection'\n"
    assert json.loads((evidence / "projection-policy.json").read_text())["schema"] == "mastermind.terminal.build_projection_policy.v1"
    assert (evidence / "receipt-helper.py").read_text() == "SCHEMA = 'receipt'\n"
    assert (evidence / "package.json").read_text() == '{"name":"terminal"}\n'
    assert (evidence / "package-lock.json").read_text() == '{"lockfileVersion":3}\n'


def test_repository_local_archive_attributes_cannot_omit_an_accepted_blob(tmp_path: Path) -> None:
    projection = _load_module()
    repo, target = _repo(tmp_path)
    info = repo / ".git/info"
    info.mkdir(parents=True, exist_ok=True)
    (info / "attributes").write_text("terminal/app/route.ts export-ignore\n", encoding="utf-8")
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir()
    evidence.mkdir(mode=0o700)
    projection.materialize_projection(
        repository=repo,
        target_sha=target,
        destination=destination,
        evidence_dir=evidence,
        policy_path=_policy(tmp_path, repo),
        git_path=_git(),
    )
    assert (destination / "terminal/app/route.ts").is_file()


def test_new_root_outside_closed_policy_fails(tmp_path: Path) -> None:
    projection = _load_module()
    repo, _ = _repo(tmp_path)
    policy_path = _policy(tmp_path, repo)
    (repo / "surprise-root").mkdir()
    (repo / "surprise-root/input.ts").write_text("export {};\n", encoding="utf-8")
    _run(repo, "add", "surprise-root/input.ts")
    _run(repo, "commit", "-qm", "new root")
    target = _run(repo, "rev-parse", "HEAD")
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir()
    evidence.mkdir(mode=0o700)
    with pytest.raises(ValueError, match="root|policy|unexpected"):
        projection.materialize_projection(
            repository=repo,
            target_sha=target,
            destination=destination,
            evidence_dir=evidence,
            policy_path=policy_path,
            git_path=_git(),
        )


def test_absolute_or_escaping_symlink_inside_projection_fails(tmp_path: Path) -> None:
    projection = _load_module()
    for target_value in ("/etc/passwd", "../../README.md"):
        case = tmp_path / target_value.replace("/", "_").replace("..", "up")
        case.mkdir()
        repo, _ = _repo(case)
        link = repo / "terminal/escape"
        link.symlink_to(target_value)
        _run(repo, "add", "terminal/escape")
        _run(repo, "commit", "-qm", "bad symlink")
        target = _run(repo, "rev-parse", "HEAD")
        destination = case / "projection"
        evidence = case / "evidence"
        destination.mkdir()
        evidence.mkdir(mode=0o700)
        with pytest.raises(ValueError, match="symlink|escape|absolute"):
            projection.materialize_projection(
                repository=repo,
                target_sha=target,
                destination=destination,
                evidence_dir=evidence,
                policy_path=_policy(case, repo),
                git_path=_git(),
            )



def test_chained_symlink_cannot_escape_through_an_allowed_intermediate_root(tmp_path: Path) -> None:
    projection = _load_module()
    repo, _ = _repo(tmp_path)
    deep = repo / "terminal/deep"
    deep.mkdir()
    (deep / "a").symlink_to("../../ingest")
    (deep / "b").symlink_to("a/../../terminal/app/route.ts")
    _run(repo, "add", "terminal/deep/a", "terminal/deep/b")
    _run(repo, "commit", "-qm", "chained symlink escape")
    target = _run(repo, "rev-parse", "HEAD")
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir()
    evidence.mkdir(mode=0o700)
    with pytest.raises(ValueError, match="symlink|escape|cycle"):
        projection.materialize_projection(
            repository=repo,
            target_sha=target,
            destination=destination,
            evidence_dir=evidence,
            policy_path=_policy(tmp_path, repo),
            git_path=_git(),
        )


def test_projection_symlink_cycle_is_rejected_before_materialization(tmp_path: Path) -> None:
    projection = _load_module()
    repo, _ = _repo(tmp_path)
    (repo / "terminal/a").symlink_to("b")
    (repo / "terminal/b").symlink_to("a")
    _run(repo, "add", "terminal/a", "terminal/b")
    _run(repo, "commit", "-qm", "symlink cycle")
    target = _run(repo, "rev-parse", "HEAD")
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir()
    evidence.mkdir(mode=0o700)
    with pytest.raises(ValueError, match="symlink|cycle"):
        projection.materialize_projection(
            repository=repo,
            target_sha=target,
            destination=destination,
            evidence_dir=evidence,
            policy_path=_policy(tmp_path, repo),
            git_path=_git(),
        )

def test_gitlink_inside_projection_fails(tmp_path: Path) -> None:
    projection = _load_module()
    repo, target = _repo(tmp_path)
    _run(repo, "update-index", "--add", "--cacheinfo", f"160000,{target},terminal/submodule")
    _run(repo, "commit", "-qm", "gitlink")
    target = _run(repo, "rev-parse", "HEAD")
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir()
    evidence.mkdir(mode=0o700)
    with pytest.raises(ValueError, match="gitlink|mode|submodule"):
        projection.materialize_projection(
            repository=repo,
            target_sha=target,
            destination=destination,
            evidence_dir=evidence,
            policy_path=_policy(tmp_path, repo),
            git_path=_git(),
        )


def _preseed_controller_evidence(repo: Path, target: str, evidence: Path, policy_path: Path) -> None:
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    names = {
        "projection_helper": "projection-helper.py",
        "projection_policy": "projection-policy.json",
        "receipt_helper": "receipt-helper.py",
        "package_json": "package.json",
        "package_lock": "package-lock.json",
    }
    for key, source in policy["controller_evidence"].items():
        oid = _run(repo, "rev-parse", f"{target}:{source}")
        payload = subprocess.run(
            [_git(), "-C", str(repo), "cat-file", "blob", oid],
            check=True,
            capture_output=True,
        ).stdout
        path = evidence / names[key]
        path.write_bytes(payload)
        path.chmod(0o444 if key in {"package_json", "package_lock"} else 0o400)


def test_exact_preseeded_controller_evidence_is_accepted(tmp_path: Path) -> None:
    projection = _load_module()
    repo, target = _repo(tmp_path)
    policy_path = _policy(tmp_path, repo)
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir()
    evidence.mkdir(mode=0o700)
    _preseed_controller_evidence(repo, target, evidence, policy_path)
    result = projection.materialize_projection(
        repository=repo,
        target_sha=target,
        destination=destination,
        evidence_dir=evidence,
        policy_path=policy_path,
        git_path=_git(),
    )
    assert result["controller_evidence"]["receipt_helper"]["sha256"] == hashlib.sha256(
        (evidence / "receipt-helper.py").read_bytes()
    ).hexdigest()
    assert stat.S_IMODE((evidence / "projection-helper.py").stat().st_mode) == 0o400
    assert stat.S_IMODE((evidence / "package.json").stat().st_mode) == 0o444
    assert stat.S_IMODE((evidence / "package-lock.json").stat().st_mode) == 0o444


def test_mutated_preseeded_controller_evidence_is_rejected(tmp_path: Path) -> None:
    projection = _load_module()
    repo, target = _repo(tmp_path)
    policy_path = _policy(tmp_path, repo)
    destination = tmp_path / "projection"
    evidence = tmp_path / "evidence"
    destination.mkdir()
    evidence.mkdir(mode=0o700)
    _preseed_controller_evidence(repo, target, evidence, policy_path)
    helper = evidence / "projection-helper.py"
    helper.chmod(0o600)
    helper.write_text("MUTATED = True\n", encoding="utf-8")
    helper.chmod(0o400)
    with pytest.raises(ValueError, match="controller evidence|preseed|disagree"):
        projection.materialize_projection(
            repository=repo,
            target_sha=target,
            destination=destination,
            evidence_dir=evidence,
            policy_path=policy_path,
            git_path=_git(),
        )
