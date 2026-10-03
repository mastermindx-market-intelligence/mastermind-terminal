"""Offline MTF research CLI; consumes existing Terminal documents, never publishes.

Example:
  python ingest/research_mtf.py --data-dir /authorized/terminal/data \
      --request study.json --output /research/mtf-snapshot.json

Request schema: terminal-mtf-screen-request/v1. Each ticker names the existing
market owner's expected_session and closed_through; this script invents neither.
No network, credential, scheduler, live strategy, or production data writes.
"""
from __future__ import annotations

import argparse
from collections.abc import Mapping
from dataclasses import fields
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

# Ingest entrypoints run as scripts, including from outside the repository root.
CA_ROOT = Path(__file__).resolve().parents[1]
if str(CA_ROOT) not in sys.path:
    sys.path.insert(0, str(CA_ROOT))

from signal_layer.mtf_screener import ScreenPolicy, SYMBOL_RE, scan_universe  # noqa: E402
from signal_layer.mtf_evaluation import session_date  # noqa: E402

REQUEST_SCHEMA = "terminal-mtf-screen-request/v1"
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
MAX_SYMBOLS = 10000


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path, *, byte_limit: int):
    """Bounded regular-file read, with final-component symlink/race protection."""
    if path.is_symlink():
        raise ValueError("symlink input is not accepted")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > byte_limit:
            raise ValueError("input must be a bounded regular file")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            raw = stream.read(byte_limit + 1)
        after = os.fstat(descriptor)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        if len(raw) > byte_limit or identity(before) != identity(after):
            raise ValueError("input changed or exceeded its bound while reading")
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"nonfinite JSON: {value}")))
        return data, hashlib.sha256(raw).hexdigest()
    finally:
        os.close(descriptor)


def validate_request(request: dict) -> ScreenPolicy:
    if not isinstance(request, dict) or request.get("schema") != REQUEST_SCHEMA:
        raise ValueError(f"request schema must be {REQUEST_SCHEMA}")
    allowed = {"schema", "as_of", "policy", "tickers"}
    if set(request) - allowed:
        raise ValueError("unknown request fields")
    session_date(request.get("as_of"))
    tickers = request.get("tickers")
    if not isinstance(tickers, list) or not 1 <= len(tickers) <= MAX_SYMBOLS:
        raise ValueError("tickers must be a nonempty bounded list")
    seen = set()
    for entry in tickers:
        if not isinstance(entry, dict) or set(entry) != {"symbol", "market", "closed_through", "expected_session"}:
            raise ValueError("each ticker requires symbol, market, closed_through, expected_session")
        symbol = entry["symbol"]
        if not isinstance(symbol, str) or not SYMBOL_RE.fullmatch(symbol) or symbol in seen:
            raise ValueError("symbols must be unique validated path components")
        seen.add(symbol)
        if not isinstance(entry["market"], str) or not entry["market"].strip():
            raise ValueError("market must be a nonempty identifier")
        for key in ("closed_through", "expected_session"):
            session_date(entry[key])
    policy = request.get("policy", {})
    if not isinstance(policy, dict) or set(policy) - {f.name for f in fields(ScreenPolicy)}:
        raise ValueError("unknown policy fields")
    return ScreenPolicy(**policy)


def build_report(data_dir: Path, request: dict) -> dict:
    """Read each requested file once; preserve failed source reads in coverage."""
    policy = validate_request(request)
    if data_dir.is_symlink() or not data_dir.is_dir():
        raise ValueError("data-dir must be an explicit existing real directory")
    root = data_dir.resolve(strict=True)
    failures, digests = {}, {}
    symbols = [ticker["symbol"] for ticker in request["tickers"]]
    allowed_symbols = set(symbols)

    class Documents(Mapping):
        # The scanner calls get once per requested ticker. This retains only the
        # current input, not thousands of full OHLC histories in a universe bake.
        def __iter__(self):
            return iter(symbols)

        def __len__(self):
            return len(symbols)

        def __getitem__(self, symbol):
            if symbol not in allowed_symbols:
                raise KeyError(symbol)
            source = root / f"{symbol}.json"
            try:
                document, digest = read_json(source, byte_limit=MAX_DOCUMENT_BYTES)
                digests[symbol] = digest
                return document
            except FileNotFoundError:
                return None
            except (OSError, ValueError, UnicodeError) as exc:
                # Do not publish machine-specific paths from source read errors.
                failures[symbol] = type(exc).__name__
                return None

    documents = Documents()
    report = scan_universe(documents, request["tickers"], as_of=request["as_of"], policy=policy)
    for row in report["rows"]:
        symbol = row["symbol"]
        if symbol in failures:
            report["coverage"][row["state"]] -= 1
            row.update(state="unreadable_data", reason=failures[symbol])
            report["coverage"]["unreadable_data"] = report["coverage"].get("unreadable_data", 0) + 1
    report["coverage"] = {k: v for k, v in report["coverage"].items() if v}
    report["source_file_sha256"] = digests
    report["source_file_digest_scope"] = "Full input bytes; per-ticker input_sha256 binds the decision-time prefix."
    report["request_schema"] = REQUEST_SCHEMA
    return report


def write_report(output: Path, report: dict, *, data_dir: Path, request_path: Path):
    """Atomic research artifact creation; cannot overwrite sources or public data."""
    parent = output.parent.resolve(strict=True)
    target = parent / output.name
    source_root = data_dir.resolve(strict=True)
    if target == request_path.resolve(strict=True) or target.is_relative_to(source_root):
        raise ValueError("output must not overwrite the request or source-data directory")
    if "public" in target.parts or str(target).startswith("/opt/terminal/"):
        raise ValueError("this offline CLI cannot write a production/public artifact")
    if target.exists() or target.is_symlink():
        raise FileExistsError("output already exists; preserve it and choose a new research artifact")
    raw = (json.dumps(report, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
    fd, temp_name = tempfile.mkstemp(prefix=".mtf-", suffix=".json", dir=parent)
    temporary = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        # Atomic create, not replace: a raced existing artifact is never overwritten.
        os.link(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return hashlib.sha256(raw).hexdigest()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        request, request_digest = read_json(args.request, byte_limit=MAX_REQUEST_BYTES)
        report = build_report(args.data_dir, request)
        report["request_sha256"] = request_digest
        output_digest = write_report(args.output, report, data_dir=args.data_dir, request_path=args.request)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(f"MTF research refused: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"status": report["status"], "requested": report["requested_count"],
                      "coverage": report["coverage"], "artifact_sha256": output_digest,
                      "production_rank_authority": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
