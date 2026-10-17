"""TCC-safe local state mutations for the launchd-owned fund/transcript lane.

The M1 production lane keeps ``fund-src`` on an external volume behind a home-directory
symlink.  Under launchd, shell ``mv``/``touch`` can be denied by macOS privacy controls
while the lane's Python process is allowed to write the same state directory.  Keep
these operations on the existing files; this module is a filesystem transport helper,
not a second state plane.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path


def replace_file(source: Path, destination: Path) -> None:
    """Copy ``source`` onto destination's filesystem, atomically replace, then unlink source.

    Copying through a sibling temporary file is intentional: the validated transcript
    index starts in ``/tmp`` while the durable cache may live on another filesystem, so
    a direct ``os.replace(source, destination)`` is not cross-filesystem safe.
    """
    source = Path(source)
    destination = Path(destination)
    payload = source.read_bytes()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_name(f".{destination.name}.fund-state-{os.getpid()}.tmp")
    try:
        with temp.open("wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)
    source.unlink()


def touch_file(path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TCC-safe fund-lane local state mutations")
    sub = parser.add_subparsers(dest="command", required=True)
    replace = sub.add_parser("replace")
    replace.add_argument("source", type=Path)
    replace.add_argument("destination", type=Path)
    touch = sub.add_parser("touch")
    touch.add_argument("path", type=Path)
    args = parser.parse_args(argv)
    if args.command == "replace":
        replace_file(args.source, args.destination)
    else:
        touch_file(args.path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
