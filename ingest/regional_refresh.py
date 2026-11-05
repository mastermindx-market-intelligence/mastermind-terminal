"""Shared staging and outcome logic for the existing regional refresh shell drivers.

This is not a scheduler. Each requested market is independently collected, emitted,
validated and published by its existing driver. Collection/emission failures do not
publish. Transfer effects are journaled and reconciled before another publication.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import hashlib
import re
import shlex
import uuid
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
    if symbol.endswith((".TO", ".V")) and not symbol.startswith("^"):
        return "ca"
    return None


def record_outcome(path, run_id, market, phase, outcome, *, advance_success=True):
    path = Path(path)
    try:
        status = json.loads(path.read_text())
    except FileNotFoundError:
        status = {}
    market_status = status.setdefault("markets", {}).setdefault(market, {})
    phase_status = dict(outcome, run_id=outcome.get("run_id", run_id),
                        recorded_at=dt.datetime.now(dt.timezone.utc).isoformat())
    old = market_status.get(phase) or {}
    phase_status["last_success"] = old.get("last_success")
    phase_status["last_publication"] = old.get("last_publication")
    if advance_success and outcome.get("publication") == "published":
        phase_status["last_publication"] = phase_status["recorded_at"]
        if outcome.get("collection") == "completed":
            phase_status["last_success"] = phase_status["recorded_at"]
    market_status[phase] = phase_status
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w") as stream:
        stream.write(json.dumps(status, indent=2, allow_nan=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
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



def _file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _read_phase(args, market):
    try:
        status = json.loads(Path(args.status).read_text())
        return ((status.get("markets") or {}).get(market) or {}).get(args.phase) or {}
    except FileNotFoundError:
        return {}


_REMOTE_HASH_SCRIPT = """
import hashlib,json,pathlib,sys
request=json.load(sys.stdin)
root=pathlib.Path(request["root"])
result={}
for name in request["names"]:
 if pathlib.Path(name).name != name:
  raise ValueError("invalid artifact name")
 path=root/name
 if path.is_symlink():
  raise ValueError("unexpected symlink")
 result[name]=hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
print(json.dumps(result,sort_keys=True))
"""


def remote_hashes(args, names, *, runner=subprocess.run):
    match = re.fullmatch(r"([A-Za-z0-9_.@-]+):(/[^\r\n]*)", args.remote)
    if not match or ".." in Path(match.group(2)).parts:
        raise ValueError("invalid publication destination")
    command = ["ssh", "-i", args.key, "-o", "BatchMode=yes", "-o",
               "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", match.group(1),
               "python3 -c " + shlex.quote(_REMOTE_HASH_SCRIPT)]
    result = runner(command, input=json.dumps({"root": match.group(2), "names": sorted(names)}),
                    text=True, capture_output=True, check=False, timeout=60)
    if result.returncode:
        raise OSError("remote content reconciliation unavailable")
    hashes = json.loads(result.stdout)
    if not isinstance(hashes, dict) or set(hashes) != set(names):
        raise ValueError("incomplete remote content reconciliation")
    if any(value is not None and (not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value)) for value in hashes.values()):
        raise ValueError("invalid remote content identity")
    return hashes


def _finish_local(args, pending):
    stage = Path(pending["stage"])
    data = Path(args.data)
    data.mkdir(parents=True, exist_ok=True)
    for name, expected in pending["candidate_sha256"].items():
        path = stage / name
        if path.name != name or _file_hash(path) != expected:
            raise ValueError("retained publication candidate changed")
        target = data / name
        temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        shutil.copyfile(path, temporary)
        os.replace(temporary, target)


def reconcile_publication(args, market, outcome, *, runner=subprocess.run):
    """Read remote identities; a mixed/unknown transfer stays fenced without replay."""
    pending = outcome.get("pending_publication")
    if not pending:
        return "none"
    if pending.get("remote") != args.remote:
        outcome["publication"] = "reconciliation_required"
        outcome["error"] = "pending publication has a different destination"
        return "blocked"
    try:
        actual = remote_hashes(args, pending["candidate_sha256"], runner=runner)
        outcome["remote_sha256"] = actual
        if actual == pending["candidate_sha256"]:
            outcome["publication"] = "remote_applied_local_pending"
            _finish_local(args, pending)
            outcome["publication"] = "published"
            outcome["published_count"] = len(actual)
            outcome["publication_receipt"] = pending["receipt"]
            outcome.pop("pending_publication", None)
            outcome.pop("error", None)
            return "applied"
        if actual == pending["before_sha256"]:
            outcome["publication"] = "not_applied"
            outcome["publication_receipt"] = pending["receipt"]
            outcome.pop("pending_publication", None)
            return "not_applied"
        outcome["publication"] = "partially_applied"
        outcome["error"] = "remote files differ from both before and candidate; publication is fenced"
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        outcome["publication"] = "reconciliation_required"
        outcome["error"] = type(exc).__name__ + ": publication effects require reconciliation"
    return "blocked"


def snapshot_previous(data, destination, market):
    """Immutable emitter input: publication must still see these exact prior bytes."""
    destination = Path(destination)
    destination.mkdir(parents=True)
    hashes = {}
    for source in sorted(Path(data).glob("*.fund.json")):
        symbol = source.name.removesuffix(".fund.json")
        if market_of(symbol) != market:
            continue
        if source.is_symlink() or not source.is_file():
            raise ValueError("invalid previous artifact")
        target = destination / source.name
        shutil.copyfile(source, target)
        hashes[source.name] = _file_hash(target)
    return hashes



def validate_retained_history(candidate, previous):
    """Hold incompatible or contracted histories; a matching date alone is not a basis."""
    if not isinstance(previous, dict) or previous.get("schema") != "mastermind.fund/v1":
        raise ValueError("previous fund schema is unreadable or incompatible")
    for key in ("ticker", "quote_currency", "stmt_currency"):
        known = previous.get(key)
        if known is not None and candidate.get(key) != known:
            raise ValueError(f"candidate changes the incumbent {key}")
    if not isinstance(previous.get("stmt_currency"), str) or not previous["stmt_currency"]:
        # This exception retains the entire financial view, including absent families.
        # Unknown currency cannot support a new family, changed value, or relabelling.
        if (previous.get("statements") != candidate.get("statements")
                or candidate.get("stmt_currency") != previous.get("stmt_currency")):
            raise ValueError("changed statements require a known incumbent currency")
    identity_arrays = ("period_start", "source_period_start", "period_kind",
                       "period_duration_months", "is_cumulative", "comparison_basis")
    for basis in ("annual", "quarterly"):
        old = (previous.get("statements") or {}).get(basis)
        if not old:
            continue
        fresh = (candidate.get("statements") or {}).get(basis)
        indexes = []
        for block in (old, fresh):
            if not isinstance(block, dict):
                raise ValueError("candidate removed a statement family")
            ends, periods = block.get("period_end"), block.get("periods")
            if (not isinstance(ends, list) or not isinstance(periods, list)
                    or len(ends) != len(periods)
                    or any(not isinstance(end, str) or dt.date.fromisoformat(end).isoformat() != end for end in ends)
                    or len(ends) != len(set(ends))):
                raise ValueError("statement periods are invalid or unaligned")
            for key in identity_arrays:
                if key in block and (not isinstance(block[key], list) or len(block[key]) != len(ends)):
                    raise ValueError("statement basis metadata is unaligned")
            indexes.append({end: i for i, end in enumerate(ends)})
        if not set(indexes[0]).issubset(indexes[1]):
            raise ValueError("candidate would remove retained statement periods")
        if old.get("flow_basis") is not None and fresh.get("flow_basis") != old["flow_basis"]:
            raise ValueError("candidate changes the incumbent statement flow basis")
        for end, i in indexes[0].items():
            j = indexes[1][end]
            for key in identity_arrays:
                known = old.get(key, [None] * len(indexes[0]))[i]
                if known is not None and fresh.get(key, [None] * len(indexes[1]))[j] != known:
                    raise ValueError("candidate changes an incumbent period's reporting basis")


def publish_stage(args, market, stage, paths, outcome, *, previous_dir=None,
                  previous_sha256=None, runner=subprocess.run):
    names = [path.name for path in paths]
    before = remote_hashes(args, names, runner=runner)
    if args.phase == "fund":
        if previous_dir is None or previous_sha256 is None:
            raise ValueError("fund publication requires the emitter's immutable prior artifacts")
        expected_before = {name: previous_sha256.get(name) for name in names}
        if before != expected_before:
            outcome["publication"] = "baseline_mismatch"
            outcome["baseline_mismatch_count"] = sum(before[name] != expected_before[name] for name in names)
            raise ValueError("served history differs from emitter input; sync the current baseline and regenerate")
        for path in paths:
            prior_path = Path(previous_dir) / path.name
            if previous_sha256.get(path.name) is not None:
                validate_retained_history(json.loads(path.read_text()), json.loads(prior_path.read_text()))
    # Immutable candidate and previous bytes survive a transfer failure or process kill.
    receipt_dir = Path(args.status).parent / "cnhk_publish_receipts" / (market + "-" + args.phase) / uuid.uuid4().hex
    receipt_dir.mkdir(parents=True)
    for path in paths:
        shutil.copyfile(path, receipt_dir / path.name)
    candidate = {name: _file_hash(receipt_dir / name) for name in names}
    before_dir = receipt_dir / "before"
    if args.phase == "fund":
        before_dir.mkdir()
        for name, expected in before.items():
            if expected is None:
                continue
            source = Path(previous_dir) / name
            if source.is_symlink() or _file_hash(source) != expected:
                raise ValueError("immutable emitter baseline changed")
            shutil.copyfile(source, before_dir / name)
            if _file_hash(before_dir / name) != expected:
                raise ValueError("previous artifact backup failed validation")
    manifest = receipt_dir / "publish-list.txt"
    manifest.write_text("".join(name + "\n" for name in names))
    receipt = receipt_dir / "receipt.json"
    pending = {"stage": str(receipt_dir), "receipt": str(receipt),
               "remote": args.remote, "candidate_sha256": candidate, "before_sha256": before,
               "run_id": args.run_id,
               "previous_artifact_dir": str(before_dir) if args.phase == "fund" else None}
    with receipt.open("w") as stream:
        stream.write(json.dumps(pending, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    outcome["pending_publication"] = pending
    outcome["publication"] = "in_progress"
    # This durable status is the fence. It is written before the first remote mutation.
    record_outcome(args.status, args.run_id, market, args.phase, outcome)
    command = ["rsync", "-az", "--files-from=" + str(manifest),
               "-e", "ssh -i " + shlex.quote(args.key) +
               " -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15",
               str(receipt_dir) + "/", args.remote.rstrip("/") + "/"]
    result = runner(command, check=False)
    state = reconcile_publication(args, market, outcome, runner=runner)
    if state != "applied":
        outcome.setdefault("error", f"publication exited {result.returncode}; candidate retained for reconciliation")
        return 1
    return 0

def refresh_market(args, market, *, runner=subprocess.run):
    outcome = {"collection": "not_started", "emission": "not_started",
               "publication": "held", "published_count": 0,
               "source_mode": "retained_cache" if args.skip_collect else "collection"}
    if market == "ca" and (args.phase != "fund" or not args.skip_collect):
        outcome["error"] = "Canada uses the existing nightly collector; fund publication requires --skip-collect"
        return outcome, 1
    if not args.dry_run:
        try:
            previous = _read_phase(args, market)
        except (OSError, ValueError):
            outcome["publication"] = "reconciliation_required"
            outcome["error"] = "existing publication status cannot be read; no source or publication mutation"
            return outcome, 1
        if previous.get("pending_publication"):
            origin_run = previous.get("run_id") or previous["pending_publication"].get("run_id")
            state = reconcile_publication(args, market, previous, runner=runner)
            previous["run_id"] = origin_run
            previous["reconciliation"] = {"state": state,
                "checked_at": dt.datetime.now(dt.timezone.utc).isoformat()}
            # Resolving an old transfer is not evidence of a new source refresh.
            record_outcome(args.status, origin_run, market, args.phase, previous, advance_success=False)
            if state == "blocked":
                return previous, 1
            outcome["reconciled_publication"] = {"run_id": origin_run, "state": state,
                "receipt": previous.get("publication_receipt")}
            # The current run must still collect, emit and publish on its own merits.
    cn_fallback = market == "cn" and args.phase == "fund" and os.environ.get("MM_CN_FUND_SOURCE") == "yahoo"
    if cn_fallback:
        outcome["source_mode"] = "yahoo_append_only"
    script = Path(args.repo) / "ingest"
    data = Path(args.data)
    collection_receipt = None
    admitted_symbols = None
    def run(command):
        print("regional stage: " + " ".join(str(part) for part in command), flush=True)
        if args.dry_run:
            return 0
        return runner([str(part) for part in command], check=False).returncode
    try:
        if args.skip_collect:
            outcome["collection"] = "explicitly_skipped"
        elif market == "cn" and os.environ.get("MM_CN_SOURCE_DISABLED") == "1" and not cn_fallback:
            outcome["collection"] = "source_disabled"
            outcome["error"] = "CN source disabled pending a valid configured credential"
            return outcome, 1
        else:
            if args.phase == "fund":
                command = ([args.python, script / "run_bounded.py", "--seconds", "1800", "--",
                            args.python, script / "collect_cn_yahoo.py", "--deadline-seconds", "1790"]
                           if cn_fallback else
                           [args.python, script / "collect_cn_hk_fund.py", "--market", market])
                if cn_fallback and not args.dry_run:
                    collection_receipt = Path(args.status).parent / "cnhk_collection_receipts" / (uuid.uuid4().hex + ".json")
                    collection_receipt.parent.mkdir(parents=True, exist_ok=True)
                    command += ["--receipt", str(collection_receipt), "--run-id", args.run_id]
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
            if collection_receipt:
                # A process exit alone cannot qualify residual caches as this invocation's work.
                sys.path.insert(0, str(Path(args.repo)))
                from ingest.cn_yahoo_fallback import read_collection_receipt
                receipt = read_collection_receipt(collection_receipt, args.run_id)
                admitted_symbols = set(receipt["admitted"])
                outcome["collection_receipt"] = str(collection_receipt)
                outcome["source_counts"] = receipt["counts"]
                outcome["source_scope_sha256"] = receipt["scope_sha256"]
                outcome["collection"] = ("completed" if receipt["coverage_complete"] and receipt["scope"] == "manifest" else "partial")
                if not admitted_symbols:
                    outcome["error"] = "this collection admitted no source observations"
                    return outcome, 1
        if market == "hk" and args.phase == "fund" and not args.skip_collect:
            # Holder coverage has a separate availability contract; an empty named table
            # does not invalidate a qualified HK financial-statement refresh.
            holder_command = [args.python, script / "run_bounded.py", "--seconds", "1800", "--",
                              args.python, script / "collect_reported_ownership.py",
                              "--market", "hk", "--deadline-seconds", "1795"]
            if args.limit:
                holder_command += ["--limit", str(args.limit)]
            holder_code = run(holder_command)
            outcome["reported_holders"] = "completed" if holder_code == 0 else "partial_or_deferred"
        with tempfile.TemporaryDirectory(prefix=f"mm-regional-{market}-{args.phase}-") as stage:
            previous_dir = Path(stage) / "previous"
            previous_sha256 = None
            if args.phase == "fund":
                previous_sha256 = snapshot_previous(data, previous_dir, market)
                emitter = "gen_fund_us.py" if market == "ca" else "gen_fund_cn_yahoo.py" if cn_fallback else f"gen_fund_{market}.py"
                command = [args.python, script / emitter, "--out", stage, "--previous-dir", previous_dir]
                if market == "ca":
                    command += ["--canada"]
                if collection_receipt:
                    command += ["--collection-receipt", str(collection_receipt), "--expected-run-id", args.run_id]
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
            if admitted_symbols is not None and {path.name.removesuffix(".fund.json") for path in paths} != admitted_symbols:
                raise ValueError("emission differs from the collection's admitted listing scope")
            manifest = Path(stage) / "publish-list.txt"
            manifest.write_text("".join(path.name + "\n" for path in paths))
            hour = dt.datetime.now(dt.timezone.utc).strftime("%H%M")
            if "2100" <= hour < "2230":
                outcome["error"] = "publication window blocked (21:00–22:30 UTC)"
                return outcome, 1
            code = publish_stage(args, market, stage, paths, outcome,
                                 previous_dir=previous_dir, previous_sha256=previous_sha256, runner=runner)
            return outcome, code or int(outcome["collection"] == "partial")
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        if outcome.get("pending_publication"):
            outcome["publication"] = "reconciliation_required"
        outcome["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        return outcome, 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("fund", "intel"), required=True)
    parser.add_argument("--market", choices=("cn", "hk", "ca", "all"), default="all")
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
