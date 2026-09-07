from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from .model import POLICY_SCHEMA, Allowance, SourceMapping


def _safe_relative_path(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    raw = value.strip().replace("\\", "/")
    if raw.startswith("/") or raw.endswith("/") or "//" in raw:
        raise ValueError(f"{field} must be a normalized relative path")
    parts = raw.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"{field} must be a normalized relative path without '..'")
    normalized = PurePosixPath(raw).as_posix()
    if normalized != raw:
        raise ValueError(f"{field} must be a normalized relative path")
    return normalized


def parse_policy(
    policy: Mapping[str, Any],
) -> tuple[str, Path, tuple[SourceMapping, ...]]:
    if policy.get("schema") != POLICY_SCHEMA:
        raise ValueError(f"policy schema must be {POLICY_SCHEMA!r}")

    accepted_ref = policy.get("accepted_ref")
    if not isinstance(accepted_ref, str) or not accepted_ref.strip():
        raise ValueError("policy accepted_ref must be a non-empty string")
    accepted_ref = accepted_ref.strip()
    if accepted_ref.startswith("-") or any(character.isspace() for character in accepted_ref):
        raise ValueError("policy accepted_ref must be a safe Git revision name")

    marker_value = policy.get("deployment_id_file")
    if not isinstance(marker_value, str) or not marker_value.strip():
        raise ValueError("policy deployment_id_file must be a non-empty path")
    deployment_id_file = Path(marker_value)
    if not deployment_id_file.is_absolute():
        raise ValueError("policy deployment_id_file must be an absolute path")

    raw_mappings = policy.get("mappings")
    if not isinstance(raw_mappings, list) or not raw_mappings:
        raise ValueError("policy mappings must be a non-empty list")

    names: set[str] = set()
    live_paths: set[Path] = set()
    mappings: list[SourceMapping] = []
    for index, raw in enumerate(raw_mappings):
        if not isinstance(raw, Mapping):
            raise ValueError(f"mappings[{index}] must be an object")
        name = raw.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"mappings[{index}].name must be a non-empty string")
        name = name.strip()
        if name in names:
            raise ValueError(f"duplicate mapping name: {name}")
        names.add(name)

        repo_path = _safe_relative_path(raw.get("repo_path"), field=f"mappings[{index}].repo_path")
        live_value = raw.get("live_path")
        if not isinstance(live_value, str) or not live_value.strip():
            raise ValueError(f"mappings[{index}].live_path must be a non-empty path")
        live_path = Path(live_value)
        if not live_path.is_absolute():
            raise ValueError(f"mappings[{index}].live_path must be an absolute path")
        if live_path in live_paths:
            raise ValueError(f"duplicate live path: {live_path}")
        live_paths.add(live_path)

        raw_allowances = raw.get("allowances", [])
        if not isinstance(raw_allowances, list):
            raise ValueError(f"mappings[{index}].allowances must be a list")
        allowances: list[Allowance] = []
        allowance_paths: set[str] = set()
        for allowance_index, allowance_raw in enumerate(raw_allowances):
            if not isinstance(allowance_raw, Mapping):
                raise ValueError(
                    f"mappings[{index}].allowances[{allowance_index}] must be an object"
                )
            allowance_path = _safe_relative_path(
                allowance_raw.get("path"),
                field=f"mappings[{index}].allowances[{allowance_index}].path",
            )
            classification = allowance_raw.get("classification")
            if not isinstance(classification, str) or not classification.strip():
                raise ValueError(
                    f"mappings[{index}].allowances[{allowance_index}].classification "
                    "must be a non-empty string"
                )
            if allowance_path in allowance_paths:
                raise ValueError(f"duplicate allowance path in {name}: {allowance_path}")
            allowance_paths.add(allowance_path)
            allowances.append(
                Allowance(
                    path=allowance_path,
                    classification=classification.strip(),
                    sensitive=bool(allowance_raw.get("sensitive", False)),
                )
            )

        mappings.append(
            SourceMapping(
                name=name,
                repo_path=repo_path,
                live_path=live_path,
                allowances=tuple(sorted(allowances, key=lambda item: item.path)),
            )
        )

    return accepted_ref, deployment_id_file, tuple(mappings)
