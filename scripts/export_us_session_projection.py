#!/usr/bin/env python3
"""Compile Terminal's immutable session input from Macro's existing clock owners.

Development/release tool only: the deployed Terminal never imports another repo.
No holiday arithmetic, price reads, credential access, or outcome evaluation here.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
import hashlib
import importlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "terminal/lib/usEquitySessionProjection.json"
SOURCE_FILES = ("lib/__init__.py", "lib/nyse_calendar.py",
                "engine/__init__.py", "engine/session_digest.py")


def verified_sources(root: Path, revision: str) -> dict[str, str]:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("source revision must be an exact Git commit")
    receipts = {}
    for name in SOURCE_FILES:
        expected = subprocess.check_output(["git", "-C", str(root), "show", f"{revision}:{name}"])
        if (root / name).read_bytes() != expected:
            raise ValueError(f"source bytes do not match the pinned owner: {name}")
        receipts[name] = hashlib.sha256(expected).hexdigest()
    return receipts


def compile_projection(root: Path, revision: str) -> bytes:
    receipts = verified_sources(root, revision)
    sys.path.insert(0, str(root))
    calendar = importlib.import_module("lib.nyse_calendar")
    clock = importlib.import_module("engine.session_digest")
    for module, name in ((calendar, "lib/nyse_calendar.py"), (clock, "engine/session_digest.py")):
        if Path(module.__file__).resolve() != (root / name).resolve():
            raise ValueError("unexpected source module location")
    start, end = date(2016, 1, 1), date(2028, 12, 31)
    sessions = {}
    day = start
    while day <= end:
        if calendar.is_session(day):
            opened, closed = clock.session_window_et(day)
            sessions[day.isoformat()] = [opened.hour * 60 + opened.minute,
                                         closed.hour * 60 + closed.minute]
        day += timedelta(days=1)
    if verified_sources(root, revision) != receipts:
        raise ValueError("source changed during projection")
    result = {"schema": "mastermind.us_equity_session_projection.v1",
              "source": {"repository": "mastermindx-market-intelligence/macro",
                         "revision": revision, "files": receipts},
              "timezone": "America/New_York",
              "coverage": {"start": start.isoformat(), "end": end.isoformat()},
              "sessions": sessions}
    return (json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--macro-root", type=Path, required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        payload = compile_projection(args.macro_root.resolve(), args.source_revision)
        if args.check:
            if OUTPUT.read_bytes() != payload:
                raise ValueError("projection differs from pinned canonical sources")
        else:
            temporary = OUTPUT.with_suffix(".json.tmp")
            temporary.write_bytes(payload)
            temporary.replace(OUTPUT)
        print(json.dumps({"output": str(OUTPUT.relative_to(ROOT)),
                          "sha256": hashlib.sha256(payload).hexdigest(),
                          "sessions": len(json.loads(payload)["sessions"]),
                          "checked": args.check}))
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"session projection refused: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
