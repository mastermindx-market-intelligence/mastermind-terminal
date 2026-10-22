"""Shared staging and outcome logic for the existing regional refresh shell drivers.

This is not a scheduler. Each requested market is independently collected, emitted,
validated and published by its existing driver. Failed groups leave served files alone.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def market_of(symbol):
    if symbol.endswith((".SS", ".SZ", ".BJ")):
        return "cn"
    if symbol.endswith(".HK"):
        return "hk"
    return None


def record_outcome(path, run_id, market, phase, outcome):
    path = Path(path)
    try:
        status = json.loads(path.read_text())
    except (OSError, ValueError):
        status = {}
    market_status = status.setdefault("markets", {}).setdefault(market, {})
    phase_status = dict(outcome, run_id=run_id,
                        recorded_at=dt.datetime.now(dt.timezone.utc).isoformat())
    old = market_status.get(phase) or {}
    phase_status["last_success"] = old.get("last_success")
    if outcome.get("publication") == "published":
        phase_status["last_success"] = phase_status["recorded_at"]
    market_status[phase] = phase_status
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(status, indent=2, allow_nan=False) + "\n")
    os.replace(temporary, path)


def validate_stage(stage, market, phase):
    suffix = ".fund.json" if phase == "fund" else ".intel.json"
    paths = sorted(Path(stage).glob("*" + suffix))
    if not paths:
        raise ValueError("emitter produced no expected artifacts")
    for path in paths:
        symbol = path.name[:-len(suffix)]
        if path.is_symlink() or market_of(symbol) != market:
            raise ValueError("emitter escaped its market scope")
        payload = json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        if not isinstance(payload, dict) or payload.get("ticker") != symbol:
            raise ValueError("artifact identity differs from filename")
        expected = "mastermind.fund/v1" if phase == "fund" else "intel/v1"
        if payload.get("schema") != expected:
            raise ValueError("unexpected artifact schema")
    return paths


def refresh_market(args, market, *, runner=subprocess.run):
    outcome = {"collection": "not_started", "emission": "not_started",
               "publication": "held", "published_count": 0,
               "source_mode": "retained_cache" if args.skip_collect else "collection"}
    script = Path(args.repo) / "ingest"
    data = Path(args.data)
    def run(command):
        print("regional stage: " + " ".join(str(part) for part in command), flush=True)
        if args.dry_run:
            return 0
        return runner([str(part) for part in command], check=False).returncode
    try:
        if args.skip_collect:
            outcome["collection"] = "explicitly_skipped"
        elif market == "cn" and os.environ.get("MM_CN_SOURCE_DISABLED") == "1":
            outcome["collection"] = "source_disabled"
            outcome["error"] = "CN source disabled pending a valid configured credential"
            return outcome, 1
        else:
            if args.phase == "fund":
                command = [args.python, script / "collect_cn_hk_fund.py", "--market", market]
                if args.limit:
                    command += ["--limit", str(args.limit)]
            else:
                command = [args.python, script / f"collect_{market}_deep.py"]
                if market == "hk":
                    command += ["--workers", "4"]
                    if args.force_hk:
                        command += ["--force"]
            code = run(command)
            outcome["collection"] = "completed" if code == 0 else "failed"
            if code:
                outcome["error"] = f"collector exited {code}"
                return outcome, 1
        with tempfile.TemporaryDirectory(prefix=f"mm-regional-{market}-{args.phase}-") as stage:
            if args.phase == "fund":
                command = [args.python, script / f"gen_fund_{market}.py",
                           "--out", stage, "--previous-dir", data]
                if args.limit:
                    command += ["--limit", str(args.limit)]
            else:
                command = [args.python, script / "pull_cn_hk_intel.py",
                           "--market", market, "--out", stage]
            code = run(command)
            outcome["emission"] = "completed" if code == 0 else "failed"
            if code:
                outcome["error"] = f"emitter exited {code}"
                return outcome, 1
            if args.dry_run:
                outcome["publication"] = "dry_run"
                return outcome, 0
            paths = validate_stage(stage, market, args.phase)
            manifest = Path(stage) / "publish-list.txt"
            manifest.write_text("".join(path.name + "\n" for path in paths))
            hour = dt.datetime.now(dt.timezone.utc).strftime("%H%M")
            if "2100" <= hour < "2230":
                outcome["error"] = "publication window blocked (21:00–22:30 UTC)"
                return outcome, 1
            command = ["rsync", "-az", "--files-from=" + str(manifest),
                       "-e", "ssh -i " + args.key + " -o BatchMode=yes -o StrictHostKeyChecking=yes",
                       stage + "/", args.remote.rstrip("/") + "/"]
            code = run(command)
            if code:
                outcome["error"] = f"publication exited {code}; verify remote files before any replay"
                outcome["publication"] = "failed"
                return outcome, 1
            # Local canonical artifacts advance only after the complete emission and successful transfer.
            data.mkdir(parents=True, exist_ok=True)
            for path in paths:
                target = data / path.name
                temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
                shutil.copyfile(path, temporary)
                os.replace(temporary, target)
            outcome["publication"] = "published"
            outcome["published_count"] = len(paths)
            return outcome, 0
    except (OSError, ValueError) as exc:
        outcome["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        return outcome, 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("fund", "intel"), required=True)
    parser.add_argument("--market", choices=("cn", "hk", "all"), default="all")
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--data")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--key", default=str(Path.home() / ".ssh/macro_dashboard_deploy_v2"))
    parser.add_argument("--remote", default="root@146.190.142.17:/opt/terminal/terminal/public/data")
    parser.add_argument("--status", default=str(Path(os.environ.get("MACRO_REPO", ".")) / "cnhk_status.json"))
    parser.add_argument("--run-id", default=os.environ.get("MM_REFRESH_RUN_ID") or dt.datetime.now(dt.timezone.utc).isoformat())
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--force-hk", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    args.data = args.data or str(Path(args.repo) / "terminal/public/data")
    markets = ("cn", "hk") if args.market == "all" else (args.market,)
    failed = False
    for market in markets:
        outcome, code = refresh_market(args, market)
        if not args.dry_run:
            record_outcome(args.status, args.run_id, market, args.phase, outcome)
        print(json.dumps({"market": market, "phase": args.phase, **outcome}), flush=True)
        failed = failed or bool(code)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
