"""Bound an existing collector process without leaving request threads alive."""
from __future__ import annotations

import argparse
import datetime as dt
import os
import signal
import subprocess
import sys


def daily_budget(now: dt.datetime, stop: dt.time = dt.time(17, 15), maximum: int = 1800) -> int:
    """Seconds remaining in today's local collection window; never rolls to tomorrow."""
    cutoff = now.replace(hour=stop.hour, minute=stop.minute, second=stop.second, microsecond=0)
    return max(0, min(maximum, int((cutoff - now).total_seconds())))


def run_bounded(command: list[str], seconds: float, *, grace: float = 3.0) -> int:
    if seconds <= 0:
        return 124
    child = subprocess.Popen(command, start_new_session=True)
    try:
        return child.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        print("collector deadline reached; completed atomic writes retained, unfinished names deferred",
              flush=True)
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        return 124
    except BaseException:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        raise


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--daily-budget", action="store_true")
    parser.add_argument("--seconds", type=float)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.daily_budget:
        print(daily_budget(dt.datetime.now()))
        return 0
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.seconds is None:
        parser.error("--seconds and a command are required")
    return run_bounded(command, args.seconds)


if __name__ == "__main__":
    sys.exit(main())
