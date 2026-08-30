from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

POLICY_SCHEMA = "mastermind.terminal.source_audit_policy.v1"
RECEIPT_SCHEMA = "mastermind.terminal.source_audit_receipt.v1"
EXIT_CLEAN = 0
EXIT_UNKNOWN_STOP = 2
EXIT_INPUT_ERROR = 64
EXIT_INTERNAL_ERROR = 70


@dataclass(frozen=True)
class Allowance:
    path: str
    classification: str
    sensitive: bool = False


@dataclass(frozen=True)
class SourceMapping:
    name: str
    repo_path: str
    live_path: Path
    allowances: tuple[Allowance, ...]


@dataclass(frozen=True)
class TreeEntry:
    mode: str
    object_type: str
    blob_sha: str
    repo_path: str
    relative_path: str


class GitCommandError(RuntimeError):
    def __init__(self, args: Sequence[str], returncode: int, stderr: str) -> None:
        super().__init__(f"git command failed ({returncode}): {' '.join(args)}: {stderr.strip()}")
        self.returncode = returncode
        self.stderr = stderr


def finding(
    code: str,
    message: str,
    *,
    mapping: str | None = None,
    path: str | None = None,
    **evidence: Any,
) -> dict[str, Any]:
    result: dict[str, Any] = {"code": code, "severity": "BLOCK", "message": message}
    if mapping is not None:
        result["mapping"] = mapping
    if path is not None:
        result["path"] = path
    result.update(evidence)
    return result


def receipt_id(receipt: Mapping[str, Any]) -> str:
    canonical = {
        key: value
        for key, value in receipt.items()
        if key not in {"generated_at", "receipt_id"}
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
