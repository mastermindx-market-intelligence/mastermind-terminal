from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

from .audit import audit_source
from .compare import path_is_within
from .model import EXIT_INPUT_ERROR, EXIT_INTERNAL_ERROR, GitCommandError
from .policy import parse_policy


def _atomic_write_json(
    path: Path, payload: Mapping[str, Any], *, pretty: bool
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = (
        json.dumps(
            payload,
            sort_keys=True,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
        )
        + "\n"
    )
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent, text=True
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _validate_output_path(
    output: Path,
    *,
    canonical_repo: Path,
    policy_path: Path,
    policy: Mapping[str, Any],
) -> None:
    _, deployment_id_file, mappings = parse_policy(policy)
    resolved_output = output.resolve(strict=False)
    protected_roots = [canonical_repo, *(mapping.live_path for mapping in mappings)]
    if any(path_is_within(resolved_output, root) for root in protected_roots):
        raise ValueError(
            "receipt output must remain outside canonical and live source roots"
        )
    if resolved_output in {
        policy_path.resolve(strict=False),
        deployment_id_file.resolve(strict=False),
    }:
        raise ValueError(
            "receipt output must not replace the policy or deployment marker"
        )


def build_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--canonical-repo", required=True, type=Path)
    parser.add_argument("--accepted-sha", required=True)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--pretty", action="store_true")
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    description: str = "Fail-closed, read-only Terminal source audit.",
) -> int:
    args = build_parser(description).parse_args(argv)
    try:
        policy = json.loads(args.policy.read_text(encoding="utf-8"))
        if not isinstance(policy, Mapping):
            raise ValueError("policy JSON root must be an object")
        if args.output:
            _validate_output_path(
                args.output,
                canonical_repo=args.canonical_repo,
                policy_path=args.policy,
                policy=policy,
            )
        receipt, exit_code = audit_source(
            canonical_repo=args.canonical_repo,
            accepted_sha=args.accepted_sha,
            policy=policy,
        )
        if args.output:
            _atomic_write_json(args.output, receipt, pretty=args.pretty)
        else:
            print(
                json.dumps(
                    receipt,
                    sort_keys=True,
                    indent=2 if args.pretty else None,
                )
            )
    except (OSError, ValueError, GitCommandError, json.JSONDecodeError) as exc:
        print(f"terminal-source-audit: input/audit error: {exc}", file=sys.stderr)
        return EXIT_INPUT_ERROR
    except Exception as exc:  # pragma: no cover - last-resort containment
        print(f"terminal-source-audit: internal error: {exc}", file=sys.stderr)
        return EXIT_INTERNAL_ERROR

    return exit_code
