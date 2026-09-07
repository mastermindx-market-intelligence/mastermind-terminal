#!/usr/bin/env python3
"""Fail-closed, read-only audit of deployed Terminal source against Git.

The source trees are never modified. The only optional write is an atomic JSON
receipt at a caller-supplied output path.
"""

from __future__ import annotations

if __package__:
    from .terminal_audit import EXIT_CLEAN, EXIT_UNKNOWN_STOP, audit_source
    from .terminal_audit.cli import main as _main
else:
    from terminal_audit import EXIT_CLEAN, EXIT_UNKNOWN_STOP, audit_source
    from terminal_audit.cli import main as _main

__all__ = ["EXIT_CLEAN", "EXIT_UNKNOWN_STOP", "audit_source"]


if __name__ == "__main__":
    raise SystemExit(_main(description=__doc__ or "Terminal source audit"))
