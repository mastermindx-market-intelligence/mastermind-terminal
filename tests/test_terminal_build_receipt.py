from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from argparse import Namespace
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "ops" / "terminal_build_receipt.py"
spec = importlib.util.spec_from_file_location("terminal_build_receipt", MODULE_PATH)
assert spec and spec.loader
receipt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receipt)

SHA = "a" * 40
TREE = "b" * 40
ACCEPTED = "c" * 40
DIGEST_A = "1" * 64
DIGEST_B = "2" * 64
DIGEST_C = "3" * 64
PUBLIC_NAMES = (
    "NEXT_PUBLIC_LOGO_DEV_TOKEN",
    "NEXT_PUBLIC_MM_AUTH_COOKIE_DOMAIN",
    "NEXT_PUBLIC_POLYGON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path, Path, Path, Path]:
    root = tmp_path / "terminal"
    next_dir = root / ".next"
    server = next_dir / "server"
    static = next_dir / "static"
    cache = next_dir / "cache"
    for directory in (server, static, cache):
        directory.mkdir(parents=True, exist_ok=True)
    (root / "package.json").write_text('{"name":"terminal"}\n', encoding="utf-8")
    (root / "package-lock.json").write_text('{"lockfileVersion":3}\n', encoding="utf-8")
    (next_dir / "BUILD_ID").write_text("build-fixed\n", encoding="utf-8")
    (next_dir / "routes-manifest.json").write_text('{"version":3}\n', encoding="utf-8")
    (server / "app.js").write_text("export const app = 1;\n", encoding="utf-8")
    (static / "chunk.js").write_text("console.log('stable');\n", encoding="utf-8")
    (next_dir / "required-server-files.json").write_text(
        json.dumps({"files": [".next/routes-manifest.json"]}) + "\n",
        encoding="utf-8",
    )
    preview = b'{"preview":"opaque"}'
    rsc = b'{"rsc":"opaque"}'
    (cache / ".previewinfo").write_bytes(preview)
    (cache / ".rscinfo").write_bytes(rsc)

    public_value = "https://example.invalid"
    (root / ".env.production.local").write_text(
        f"NEXT_PUBLIC_SUPABASE_URL={public_value}\n", encoding="utf-8"
    )
    public_identity = tmp_path / "public-env.json"
    public_identity.write_text(
        json.dumps(
            {
                "schema": "mastermind.terminal.public_build_env_identity.v1",
                "entries": [
                    {
                        "name": name,
                        "present": name == "NEXT_PUBLIC_SUPABASE_URL",
                        "bytes": len(public_value.encode()) if name == "NEXT_PUBLIC_SUPABASE_URL" else 0,
                        "sha256": _sha(public_value.encode()) if name == "NEXT_PUBLIC_SUPABASE_URL" else None,
                    }
                    for name in PUBLIC_NAMES
                ],
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    key_identity = tmp_path / "keys.json"
    key_identity.write_text(
        json.dumps(
            {
                "schema": "mastermind.terminal.next_build_key_identity.v1",
                "source": "retained",
                "files": {
                    ".previewinfo": {"sha256": _sha(preview), "expire_at": 4102444800000},
                    ".rscinfo": {"sha256": _sha(rsc), "expire_at": 4102444800000},
                },
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    projection_identity = tmp_path / "projection.json"
    projection_payload = {
        "schema": "mastermind.terminal.build_projection.v1",
        "target_sha": SHA,
        "target_tree": TREE,
        "policy_sha256": "5" * 64,
        "included_roots": ["ingest", "terminal"],
        "included_root_objects": [
            {"path": "ingest", "mode": "040000", "type": "tree", "oid": "6" * 40},
            {"path": "terminal", "mode": "040000", "type": "tree", "oid": "7" * 40},
        ],
        "excluded_roots": [],
        "entries": [],
        "controller_evidence": {
            name: {
                "source_path": source_path,
                "file": file_name,
                "mode": "100644",
                "oid": format(index + 8, "x") * 40,
                "bytes": 1,
                "sha256": format(index + 8, "x") * 64,
            }
            for index, (name, source_path, file_name) in enumerate((
                ("projection_helper", "ops/terminal_build_projection.py", "projection-helper.py"),
                ("projection_policy", "ops/terminal_build_projection.json", "projection-policy.json"),
                ("receipt_helper", "ops/terminal_build_receipt.py", "receipt-helper.py"),
                ("package_json", "terminal/package.json", "package.json"),
                ("package_lock", "terminal/package-lock.json", "package-lock.json"),
            ))
        },
    }
    projection_payload["projection_sha256"] = _sha(
        json.dumps(projection_payload, sort_keys=True, separators=(",", ":")).encode()
    )
    projection_identity.write_text(
        json.dumps(projection_payload, sort_keys=True) + "\n", encoding="utf-8"
    )
    sandbox_identity = tmp_path / "sandbox.json"
    sandbox_identity.write_text(
        json.dumps(
            {
                "schema": "mastermind.terminal.build_sandbox_identity.v1",
                "systemd_run_path": "/usr/bin/systemd-run",
                "controller_entry": {
                    "controller_path": "/opt/terminal/terminal-build.sh",
                    "controller_sha256": "c" * 64,
                    "sudo_path": "/usr/bin/sudo",
                    "env_path": "/usr/bin/env",
                    "bash_path": "/usr/bin/bash",
                    "privileged_mode": True,
                    "clean_environment": True,
                },
                "common_properties": [
                    "AmbientCapabilities=",
                    "CapabilityBoundingSet=",
                    "LockPersonality=yes",
                    "NoNewPrivileges=yes",
                    "PrivateDevices=yes",
                    "PrivateTmp=yes",
                    "ProtectControlGroups=yes",
                    "ProtectHome=yes",
                    "ProtectKernelLogs=yes",
                    "ProtectKernelModules=yes",
                    "ProtectKernelTunables=yes",
                    "ProtectSystem=strict",
                    "RestrictRealtime=yes",
                    "RestrictSUIDSGID=yes",
                    "SupplementaryGroups=",
                    "RestrictAddressFamilies=AF_INET AF_INET6",
                    "UMask=0077",
                ],
                "phases": {
                    "identity": {
                        "private_network": True,
                        "read_only_inputs": [],
                        "writable_roots": [],
                    },
                    "install": {
                        "private_network": False,
                        "read_only_inputs": ["package.json", "package-lock.json"],
                        "writable_roots": ["dependencies", "home", "npm_cache", "temporary"],
                    },
                    "build": {
                        "private_network": True,
                        "read_only_inputs": ["source", "node_modules"],
                        "writable_roots": [".next", "home", "npm_cache", "temporary"],
                    },
                },
            },
            sort_keys=True,
        ) + "\n",
        encoding="utf-8",
    )
    receipt_dir = tmp_path / "receipts"
    receipt_dir.mkdir(mode=0o750)
    os.chmod(receipt_dir, 0o750)
    return root, public_identity, key_identity, projection_identity, sandbox_identity, receipt_dir


def _args(root: Path, public: Path, keys: Path, projection: Path, sandbox: Path, receipts: Path) -> Namespace:
    return Namespace(
        terminal_root=str(root),
        receipt_dir=str(receipts),
        target_sha=SHA,
        target_tree=TREE,
        accepted_ref_sha=ACCEPTED,
        preflight_accepted_sha=ACCEPTED,
        preflight_receipt_id=DIGEST_A,
        preflight_source_receipt_id=DIGEST_B,
        preflight_policy_digest=DIGEST_C,
        node_path="/usr/bin/node",
        node_version="v20.20.2",
        npm_path="/usr/bin/npm",
        npm_version="10.8.2",
        build_os="Linux",
        build_arch="x86_64",
        os_id="ubuntu",
        os_version_id="24.04",
        libc="glibc 2.39",
        public_env_identity=str(public),
        public_env_file=str(root / ".env.production.local"),
        build_key_identity=str(keys),
        build_uid=os.getuid(),
        build_gid=os.getgid(),
        projection_manifest=str(projection),
        sandbox_identity=str(sandbox),
        application_root=str(root.resolve()),
        build_user="mastermind-terminal-build",
        build_group="mastermind-terminal-build",
        build_home="/nonexistent",
        build_shell="/usr/sbin/nologin",
    )


def test_serving_digest_ignores_cache_and_changes_with_serving_bytes(tmp_path: Path) -> None:
    root, *_ = _fixture(tmp_path)
    first, count = receipt.compute_serving_digest(root)
    assert count == 3
    (root / ".next" / "cache" / "volatile.bin").write_bytes(b"changed cache")
    (root / ".next" / "trace").write_text("volatile trace\n", encoding="utf-8")
    second, second_count = receipt.compute_serving_digest(root)
    assert (second, second_count) == (first, count)
    (root / ".next" / "static" / "chunk.js").write_text(
        "console.log('different');\n", encoding="utf-8"
    )
    third, _ = receipt.compute_serving_digest(root)
    assert third != first


def test_serving_digest_refuses_required_file_escape(tmp_path: Path) -> None:
    root, *_ = _fixture(tmp_path)
    outside = tmp_path / "outside.json"
    outside.write_text("{}\n", encoding="utf-8")
    link = root / ".next" / "escape.json"
    link.symlink_to(outside)
    (root / ".next" / "required-server-files.json").write_text(
        json.dumps({"files": [".next/escape.json"]}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="escapes build root|regular file|traverses symlink"):
        receipt.compute_serving_digest(root)


def test_receipt_binds_inputs_without_raw_identity_values(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(
        _args(root, public, keys, projection, sandbox, receipts),
        now=datetime(2026, 9, 18, 3, 0, tzinfo=timezone.utc),
    )
    assert built["schema"] == receipt.SCHEMA
    assert built["target_sha"] == SHA
    assert built["target_tree"] == TREE
    assert built["runtime"] == {
        "node_path": "/usr/bin/node",
        "node": "v20.20.2",
        "npm_path": "/usr/bin/npm",
        "npm": "10.8.2",
        "os": "Linux",
        "arch": "x86_64",
        "os_id": "ubuntu",
        "os_version_id": "24.04",
        "libc": "glibc 2.39",
    }
    assert built["output"]["build_id"] == "build-fixed"
    assert len(built["output"]["serving_digest"]) == 64
    rendered = json.dumps(built, sort_keys=True)
    assert "https://example.invalid" not in rendered
    assert '"value"' not in rendered


def test_receipt_refuses_identity_with_raw_value_field(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    public.write_text(
        json.dumps(
            {
                "schema": "mastermind.terminal.public_build_env_identity.v1",
                "value": "must-not-survive",
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="forbidden raw-value field"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))


def test_receipt_refuses_next_key_cache_changed_after_identity(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    (root / ".next" / "cache" / ".rscinfo").write_bytes(b"rotated")
    with pytest.raises(ValueError, match="changed during build"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))


def test_publish_is_immutable_mode_0640_and_duplicate_refuses(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(
        _args(root, public, keys, projection, sandbox, receipts),
        now=datetime(2026, 9, 18, 3, 0, tzinfo=timezone.utc),
    )
    path = receipt.publish_receipt(receipts, built)
    assert path.is_file()
    assert path.stat().st_mode & 0o777 == 0o640
    assert json.loads(path.read_text(encoding="utf-8")) == built
    with pytest.raises(FileExistsError, match="immutable build receipt already exists"):
        receipt.publish_receipt(receipts, built)


def test_serving_digest_refuses_required_file_symlink_inside_build_root(tmp_path: Path) -> None:
    root, *_ = _fixture(tmp_path)
    real = root / ".next" / "real.json"
    real.write_text("{}\n", encoding="utf-8")
    alias = root / ".next" / "alias.json"
    alias.symlink_to(real.name)
    (root / ".next" / "required-server-files.json").write_text(
        json.dumps({"files": [".next/alias.json"]}), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="traverses symlink"):
        receipt.compute_serving_digest(root)


def test_receipt_refuses_nested_raw_identity_value(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    payload = json.loads(public.read_text(encoding="utf-8"))
    payload["entries"][0]["value"] = "must-not-survive"
    public.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="forbidden raw-value field"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))


def test_identical_inputs_refuse_changed_serving_output(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    first = receipt.build_receipt(
        _args(root, public, keys, projection, sandbox, receipts),
        now=datetime(2026, 9, 18, 3, 0, 0, tzinfo=timezone.utc),
    )
    receipt.publish_receipt(receipts, first)

    (root / ".next" / "static" / "chunk.js").write_text(
        "console.log('nondeterministic');\n", encoding="utf-8"
    )
    second = receipt.build_receipt(
        _args(root, public, keys, projection, sandbox, receipts),
        now=datetime(2026, 9, 18, 3, 1, 0, tzinfo=timezone.utc),
    )
    assert second["input_fingerprint"] == first["input_fingerprint"]
    assert second["output"]["serving_digest"] != first["output"]["serving_digest"]
    with pytest.raises(ValueError, match="non-reproducible serving output"):
        receipt.publish_receipt(receipts, second)


def test_publish_rereads_immutable_receipt_before_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(
        _args(root, public, keys, projection, sandbox, receipts),
        now=datetime(2026, 9, 18, 3, 2, 0, tzinfo=timezone.utc),
    )
    original = receipt._validated_receipt
    observed: list[Path] = []

    def wrapped(path: Path):
        observed.append(Path(path))
        return original(path)

    monkeypatch.setattr(receipt, "_validated_receipt", wrapped)
    path = receipt.publish_receipt(receipts, built)
    assert path in observed



def test_receipt_directory_symlink_is_rejected(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, real_receipts = _fixture(tmp_path)
    alias = tmp_path / "receipt-alias"
    alias.symlink_to(real_receipts, target_is_directory=True)
    built = receipt.build_receipt(
        _args(root, public, keys, projection, sandbox, real_receipts),
        now=datetime(2026, 9, 18, 3, 3, 0, tzinfo=timezone.utc),
    )
    with pytest.raises(ValueError, match="not a real directory|aliases or symlinks"):
        receipt.publish_receipt(alias, built)



def test_reproducibility_key_ignores_observation_only_preflight_identity(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    first_args = _args(root, public, keys, projection, sandbox, receipts)
    first = receipt.build_receipt(
        first_args, now=datetime(2026, 9, 18, 4, 0, tzinfo=timezone.utc)
    )
    receipt.publish_receipt(receipts, first)

    second_args = _args(root, public, keys, projection, sandbox, receipts)
    second_args.preflight_receipt_id = "9" * 64
    second_args.accepted_ref_sha = "d" * 40
    (root / ".next" / "static" / "chunk.js").write_text(
        "console.log('different under same byte inputs');\n", encoding="utf-8"
    )
    second = receipt.build_receipt(
        second_args, now=datetime(2026, 9, 18, 4, 1, tzinfo=timezone.utc)
    )
    assert second["preflight"]["receipt_id"] != first["preflight"]["receipt_id"]
    assert second["accepted_ref_sha"] != first["accepted_ref_sha"]
    assert second["input_fingerprint"] == first["input_fingerprint"]
    with pytest.raises(ValueError, match="non-reproducible serving output"):
        receipt.publish_receipt(receipts, second)


@pytest.mark.parametrize("identity_kind", ["public", "keys"])
def test_identity_documents_reject_unknown_fields(tmp_path: Path, identity_kind: str) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    target = public if identity_kind == "public" else keys
    payload = json.loads(target.read_text(encoding="utf-8"))
    payload["unexpected"] = "opaque-but-undeclared"
    target.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="schema|unknown|fields"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))


def test_public_env_identity_must_match_the_file_next_consumed(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    (root / ".env.production.local").write_text(
        "NEXT_PUBLIC_SUPABASE_URL=https://mutated.invalid\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="public build env.*disagree|identity"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))


def test_serving_digest_refuses_fifo_in_serving_subtree(tmp_path: Path) -> None:
    root, *_ = _fixture(tmp_path)
    fifo = root / ".next" / "server" / "unexpected.fifo"
    os.mkfifo(fifo)
    try:
        with pytest.raises(ValueError, match="special|regular|FIFO|serving"):
            receipt.compute_serving_digest(root)
    finally:
        fifo.unlink(missing_ok=True)


def test_next_key_cache_directory_must_be_real_and_trusted(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    real_cache = root / ".next" / "real-cache"
    cache = root / ".next" / "cache"
    cache.rename(real_cache)
    cache.symlink_to(real_cache, target_is_directory=True)
    with pytest.raises(ValueError, match="cache directory|symlink|alias"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))



def test_receipt_binds_exact_projection_identity(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
    assert built["projection"] == {
        "schema": "mastermind.terminal.build_projection.v1",
        "policy_sha256": "5" * 64,
        "projection_sha256": json.loads(projection.read_text())["projection_sha256"],
    }
    payload = json.loads(projection.read_text(encoding="utf-8"))
    payload["target_tree"] = "7" * 40
    projection.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="projection.*target|tree"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))



def test_next_key_cache_custody_is_bound_to_declared_build_principal(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    args = _args(root, public, keys, projection, sandbox, receipts)
    args.build_uid = os.getuid() + 1
    with pytest.raises(ValueError, match="cache directory.*owner|build principal|owner/group"):
        receipt.build_receipt(args)



def test_receipt_binds_builder_sandbox_and_application_root(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
    assert built["application_root"] == str(root.resolve())
    assert built["builder"] == {
        "user": "mastermind-terminal-build",
        "group": "mastermind-terminal-build",
        "uid": os.getuid(),
        "gid": os.getgid(),
        "home": "/nonexistent",
        "shell": "/usr/sbin/nologin",
    }
    assert built["sandbox"]["schema"] == "mastermind.terminal.build_sandbox_identity.v1"
    assert built["sandbox"]["phases"]["build"]["private_network"] is True
    assert built["sandbox"]["phases"]["install"]["private_network"] is False


def test_sandbox_identity_rejects_unknown_fields(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    payload = json.loads(sandbox.read_text(encoding="utf-8"))
    payload["unexpected"] = "unreviewed"
    sandbox.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="sandbox.*unknown|fields"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))


def test_application_root_and_sandbox_are_causal_fingerprint_inputs(tmp_path: Path) -> None:
    first_fixture = _fixture(tmp_path / "first")
    second_fixture = _fixture(tmp_path / "second")
    first = receipt.build_receipt(_args(*first_fixture))
    second = receipt.build_receipt(_args(*second_fixture))
    assert first["application_root"] != second["application_root"]
    assert first["input_fingerprint"] != second["input_fingerprint"]


def test_existing_receipt_with_unknown_root_field_fails_closed(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    first = receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
    path = receipt.publish_receipt(receipts, first)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["unexpected"] = "unreviewed"
    path.chmod(0o640)
    path.write_text(json.dumps(payload), encoding="utf-8")
    path.chmod(0o640)
    second = receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
    with pytest.raises(ValueError, match="unknown|fields|schema"):
        receipt.publish_receipt(receipts, second)



def _run_receipt_probe(code: str, *, timeout: float = 2.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def test_required_server_manifest_fifo_is_rejected_without_blocking(tmp_path: Path) -> None:
    root, *_ = _fixture(tmp_path)
    manifest = root / ".next" / "required-server-files.json"
    manifest.unlink()
    os.mkfifo(manifest)
    try:
        probe = f"""
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('receipt_probe', {str(MODULE_PATH)!r})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    module.compute_serving_digest({str(root)!r})
except ValueError as exc:
    print(exc)
    raise SystemExit(0)
raise SystemExit('FIFO was accepted')
"""
        result = _run_receipt_probe(probe)
        assert result.returncode == 0, result.stdout + result.stderr
        assert "regular" in result.stdout.lower() or "special" in result.stdout.lower()
    finally:
        manifest.unlink(missing_ok=True)


def test_next_key_fifo_is_rejected_without_blocking(tmp_path: Path) -> None:
    root, *_ = _fixture(tmp_path)
    cache = root / ".next" / "cache"
    key = cache / ".previewinfo"
    key.unlink()
    os.mkfifo(key)
    try:
        probe = f"""
import importlib.util, os
from pathlib import Path
spec = importlib.util.spec_from_file_location('receipt_probe', {str(MODULE_PATH)!r})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fd, _ = module._open_trusted_directory(Path({str(cache)!r}), expected_uid=os.getuid(), expected_gid=os.getgid())
try:
    module._stable_regular_bytes_at(fd, '.previewinfo', limit=4096)
except ValueError as exc:
    print(exc)
    raise SystemExit(0)
finally:
    os.close(fd)
raise SystemExit('FIFO was accepted')
"""
        result = _run_receipt_probe(probe)
        assert result.returncode == 0, result.stdout + result.stderr
        assert "regular" in result.stdout.lower() or "special" in result.stdout.lower()
    finally:
        key.unlink(missing_ok=True)


def test_projection_manifest_rejects_undeclared_nested_entry_fields(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    payload = json.loads(projection.read_text(encoding="utf-8"))
    payload["entries"] = [{
        "path": "terminal/package.json",
        "mode": "100644",
        "type": "blob",
        "oid": "d" * 40,
        "bytes": 2,
        "sha256": "e" * 64,
        "payload": {"secret": "synthetic-canary"},
    }]
    payload["projection_sha256"] = _sha(
        json.dumps(
            {key: value for key, value in payload.items() if key != "projection_sha256"},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    )
    projection.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="projection.*entry|unknown|fields"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))


def test_receipt_binds_closed_privileged_controller_entry(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    value = receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
    assert value["sandbox"]["controller_entry"] == {
        "controller_path": "/opt/terminal/terminal-build.sh",
        "controller_sha256": "c" * 64,
        "sudo_path": "/usr/bin/sudo",
        "env_path": "/usr/bin/env",
        "bash_path": "/usr/bin/bash",
        "privileged_mode": True,
        "clean_environment": True,
    }



def test_controller_digest_participates_in_complete_input_fingerprint(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    first = receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
    payload = json.loads(sandbox.read_text(encoding="utf-8"))
    payload["controller_entry"]["controller_sha256"] = "d" * 64
    sandbox.write_text(json.dumps(payload), encoding="utf-8")
    second = receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
    assert first["input_fingerprint"] != second["input_fingerprint"]


def test_projection_manifest_rejects_controller_evidence_source_substitution(tmp_path: Path) -> None:
    root, public, keys, projection, sandbox, receipts = _fixture(tmp_path)
    payload = json.loads(projection.read_text(encoding="utf-8"))
    payload["controller_evidence"]["package_json"]["source_path"] = "terminal/not-package.json"
    payload["projection_sha256"] = _sha(
        json.dumps(
            {key: value for key, value in payload.items() if key != "projection_sha256"},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    )
    projection.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="controller evidence.*source|source.*controller evidence"):
        receipt.build_receipt(_args(root, public, keys, projection, sandbox, receipts))
