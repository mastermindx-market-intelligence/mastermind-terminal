from __future__ import annotations

import hashlib
import importlib.util
import json
import os
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


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
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

    public_identity = tmp_path / "public-env.json"
    public_identity.write_text(
        json.dumps(
            {
                "schema": "mastermind.terminal.public_build_env_identity.v1",
                "entries": [
                    {
                        "name": "NEXT_PUBLIC_SUPABASE_URL",
                        "present": True,
                        "bytes": 12,
                        "sha256": "4" * 64,
                    }
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
    receipt_dir = tmp_path / "receipts"
    receipt_dir.mkdir(mode=0o750)
    os.chmod(receipt_dir, 0o750)
    return root, public_identity, key_identity, receipt_dir


def _args(root: Path, public: Path, keys: Path, receipts: Path) -> Namespace:
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
        build_key_identity=str(keys),
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
    root, public, keys, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(
        _args(root, public, keys, receipts),
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
    root, public, keys, receipts = _fixture(tmp_path)
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
        receipt.build_receipt(_args(root, public, keys, receipts))


def test_receipt_refuses_next_key_cache_changed_after_identity(tmp_path: Path) -> None:
    root, public, keys, receipts = _fixture(tmp_path)
    (root / ".next" / "cache" / ".rscinfo").write_bytes(b"rotated")
    with pytest.raises(ValueError, match="changed during build"):
        receipt.build_receipt(_args(root, public, keys, receipts))


def test_publish_is_immutable_mode_0640_and_duplicate_refuses(tmp_path: Path) -> None:
    root, public, keys, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(
        _args(root, public, keys, receipts),
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
    root, public, keys, receipts = _fixture(tmp_path)
    payload = json.loads(public.read_text(encoding="utf-8"))
    payload["entries"][0]["value"] = "must-not-survive"
    public.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="forbidden raw-value field"):
        receipt.build_receipt(_args(root, public, keys, receipts))


def test_identical_inputs_refuse_changed_serving_output(tmp_path: Path) -> None:
    root, public, keys, receipts = _fixture(tmp_path)
    first = receipt.build_receipt(
        _args(root, public, keys, receipts),
        now=datetime(2026, 9, 18, 3, 0, 0, tzinfo=timezone.utc),
    )
    receipt.publish_receipt(receipts, first)

    (root / ".next" / "static" / "chunk.js").write_text(
        "console.log('nondeterministic');\n", encoding="utf-8"
    )
    second = receipt.build_receipt(
        _args(root, public, keys, receipts),
        now=datetime(2026, 9, 18, 3, 1, 0, tzinfo=timezone.utc),
    )
    assert second["input_fingerprint"] == first["input_fingerprint"]
    assert second["output"]["serving_digest"] != first["output"]["serving_digest"]
    with pytest.raises(ValueError, match="non-reproducible serving output"):
        receipt.publish_receipt(receipts, second)


def test_publish_rereads_immutable_receipt_before_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, public, keys, receipts = _fixture(tmp_path)
    built = receipt.build_receipt(
        _args(root, public, keys, receipts),
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
    root, public, keys, real_receipts = _fixture(tmp_path)
    alias = tmp_path / "receipt-alias"
    alias.symlink_to(real_receipts, target_is_directory=True)
    built = receipt.build_receipt(
        _args(root, public, keys, real_receipts),
        now=datetime(2026, 9, 18, 3, 3, 0, tzinfo=timezone.utc),
    )
    with pytest.raises(ValueError, match="not a real directory|aliases or symlinks"):
        receipt.publish_receipt(alias, built)
