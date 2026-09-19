from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from .model import POLICY_SCHEMA, Allowance, SourceMapping

_FULL_GIT_OBJECT_RE = re.compile(r"^[0-9a-f]{40}$")
_ROOT_FIELDS = frozenset({"schema", "accepted_ref", "deployment_id_file", "mappings"})
_MAPPING_FIELDS = frozenset({"name", "repo_path", "live_path", "allowances"})
_ALLOWANCE_FIELDS = frozenset(
    {
        "path",
        "classification",
        "sensitive",
        "allow_tracked_absence",
        "allow_tracked_runtime_subtree",
        "allow_tracked_runtime_file",
        "canonical_git_tree",
        "canonical_git_blob",
        "canonical_git_mode",
        "expected_live_type",
    }
)


def _reject_unknown_fields(
    value: Mapping[str, Any], *, allowed: frozenset[str], field: str
) -> None:
    unknown = sorted(str(key) for key in value if key not in allowed)
    if unknown:
        raise ValueError(f"{field} has unknown fields: {', '.join(unknown)}")


def _optional_boolean(value: object, *, field: str) -> bool:
    if value is None:
        return False
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be a boolean")
    return value


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
    _reject_unknown_fields(policy, allowed=_ROOT_FIELDS, field="policy")
    if policy.get("schema") != POLICY_SCHEMA:
        raise ValueError(f"policy schema must be {POLICY_SCHEMA!r}")

    accepted_ref = policy.get("accepted_ref")
    if not isinstance(accepted_ref, str) or not accepted_ref.strip():
        raise ValueError("policy accepted_ref must be a non-empty string")
    accepted_ref = accepted_ref.strip()
    if accepted_ref.startswith("-") or any(
        character.isspace() for character in accepted_ref
    ):
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
        _reject_unknown_fields(
            raw, allowed=_MAPPING_FIELDS, field=f"mappings[{index}]"
        )
        name = raw.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"mappings[{index}].name must be a non-empty string")
        name = name.strip()
        if name in names:
            raise ValueError(f"duplicate mapping name: {name}")
        names.add(name)

        repo_path = _safe_relative_path(
            raw.get("repo_path"), field=f"mappings[{index}].repo_path"
        )
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
            field_prefix = f"mappings[{index}].allowances[{allowance_index}]"
            _reject_unknown_fields(
                allowance_raw, allowed=_ALLOWANCE_FIELDS, field=field_prefix
            )
            allowance_path = _safe_relative_path(
                allowance_raw.get("path"), field=f"{field_prefix}.path"
            )
            classification = allowance_raw.get("classification")
            if not isinstance(classification, str) or not classification.strip():
                raise ValueError(
                    f"{field_prefix}.classification must be a non-empty string"
                )
            if allowance_path in allowance_paths:
                raise ValueError(
                    f"duplicate allowance path in {name}: {allowance_path}"
                )
            allowance_paths.add(allowance_path)

            allow_tracked_absence = _optional_boolean(
                allowance_raw.get("allow_tracked_absence"),
                field=f"{field_prefix}.allow_tracked_absence",
            )
            allow_tracked_runtime_subtree = _optional_boolean(
                allowance_raw.get("allow_tracked_runtime_subtree"),
                field=f"{field_prefix}.allow_tracked_runtime_subtree",
            )
            allow_tracked_runtime_file = _optional_boolean(
                allowance_raw.get("allow_tracked_runtime_file"),
                field=f"{field_prefix}.allow_tracked_runtime_file",
            )
            special_contracts = sum(
                (
                    allow_tracked_absence,
                    allow_tracked_runtime_subtree,
                    allow_tracked_runtime_file,
                )
            )
            if special_contracts > 1:
                raise ValueError(
                    f"allowance {allowance_path} cannot combine special tracked contracts"
                )

            sensitive = _optional_boolean(
                allowance_raw.get("sensitive"),
                field=f"{field_prefix}.sensitive",
            )
            if sensitive and special_contracts:
                raise ValueError(
                    f"special tracked allowance {allowance_path} cannot be sensitive"
                )

            expected_live_type_value = allowance_raw.get("expected_live_type")
            expected_live_type: str | None = None
            if expected_live_type_value is not None:
                if expected_live_type_value not in {"file", "directory"}:
                    raise ValueError(
                        f"{field_prefix}.expected_live_type must be 'file' or 'directory'"
                    )
                if special_contracts:
                    raise ValueError(
                        f"{field_prefix}.expected_live_type is not valid for a special tracked contract"
                    )
                expected_live_type = expected_live_type_value

            canonical_git_tree_value = allowance_raw.get("canonical_git_tree")
            canonical_git_tree: str | None = None
            if allow_tracked_runtime_subtree:
                if not isinstance(
                    canonical_git_tree_value, str
                ) or not _FULL_GIT_OBJECT_RE.fullmatch(canonical_git_tree_value):
                    raise ValueError(
                        f"allowance {allowance_path} canonical_git_tree must be a full "
                        "lower-case 40-character Git object id"
                    )
                canonical_git_tree = canonical_git_tree_value
            elif canonical_git_tree_value is not None:
                raise ValueError(
                    f"allowance {allowance_path} canonical_git_tree requires "
                    "allow_tracked_runtime_subtree"
                )

            canonical_git_blob_value = allowance_raw.get("canonical_git_blob")
            canonical_git_blob: str | None = None
            if allow_tracked_runtime_file or allow_tracked_absence:
                if not isinstance(
                    canonical_git_blob_value, str
                ) or not _FULL_GIT_OBJECT_RE.fullmatch(canonical_git_blob_value):
                    raise ValueError(
                        f"allowance {allowance_path} canonical_git_blob must be a full "
                        "lower-case 40-character Git object id"
                    )
                canonical_git_blob = canonical_git_blob_value
            elif canonical_git_blob_value is not None:
                raise ValueError(
                    f"allowance {allowance_path} canonical_git_blob requires "
                    "allow_tracked_runtime_file or allow_tracked_absence"
                )

            canonical_git_mode_value = allowance_raw.get("canonical_git_mode")
            canonical_git_mode: str | None = None
            if allow_tracked_runtime_file or allow_tracked_absence:
                if canonical_git_mode_value not in {"100644", "100755"}:
                    raise ValueError(
                        f"allowance {allowance_path} canonical_git_mode must be "
                        "'100644' or '100755'"
                    )
                canonical_git_mode = canonical_git_mode_value
            elif canonical_git_mode_value is not None:
                raise ValueError(
                    f"allowance {allowance_path} canonical_git_mode requires "
                    "allow_tracked_runtime_file or allow_tracked_absence"
                )

            allowances.append(
                Allowance(
                    path=allowance_path,
                    classification=classification.strip(),
                    sensitive=sensitive,
                    allow_tracked_absence=allow_tracked_absence,
                    allow_tracked_runtime_subtree=allow_tracked_runtime_subtree,
                    allow_tracked_runtime_file=allow_tracked_runtime_file,
                    canonical_git_tree=canonical_git_tree,
                    canonical_git_blob=canonical_git_blob,
                    canonical_git_mode=canonical_git_mode,
                    expected_live_type=expected_live_type,
                )
            )

        for index, allowance in enumerate(allowances):
            allowance_is_special = (
                allowance.allow_tracked_absence
                or allowance.allow_tracked_runtime_subtree
                or allowance.allow_tracked_runtime_file
            )
            for other in allowances[index + 1 :]:
                other_is_special = (
                    other.allow_tracked_absence
                    or other.allow_tracked_runtime_subtree
                    or other.allow_tracked_runtime_file
                )
                if not (allowance_is_special or other_is_special):
                    continue
                paths_overlap = allowance.path.startswith(
                    f"{other.path}/"
                ) or other.path.startswith(f"{allowance.path}/")
                if paths_overlap:
                    raise ValueError(
                        f"special tracked allowance {allowance.path} "
                        f"overlaps allowance {other.path}"
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
