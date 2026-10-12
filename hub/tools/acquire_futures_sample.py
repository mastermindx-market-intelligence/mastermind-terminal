#!/usr/bin/env python3
"""Bounded internal research prefix of the two publicly advertised CME CSV samples.

No paid API, token, credentials or arbitrary URL. Raw samples stay in a private
ignored worktree directory. The result is NOT a commercial redistribution grant.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen
from futures_csv import timestamp_ns, normalize_mbo, normalize_reference

URLS = {schema: f"https://hist.databento.com/v0/dataset/sample/download/glbx.mdp3/{schema}?sample_type=futures"
        for schema in ("mbo", "mbp-1")}
ROOT = Path(__file__).resolve().parents[2] / ".local-futures"


def acquire(schema: str, seconds: int = 300) -> dict:
    if schema not in URLS or not isinstance(seconds, int) or isinstance(seconds, bool) or not 1 <= seconds <= 900:
        raise ValueError("invalid_sample_request")
    ROOT.mkdir(exist_ok=True)
    ignore = ROOT / ".gitignore"
    if not ignore.exists():
        ignore.write_text("*\n")
    final = ROOT / f"public-{schema}-{seconds}s"
    if final.exists():
        receipt = json.loads((final / "receipt.json").read_text())
        if receipt["sourceUrl"] != URLS[schema] or receipt["requestedSeconds"] != seconds:
            raise ValueError("existing_receipt_disagrees")
        for name, key in (("prefix.csv", "rawPrefixSha256"), ("normalized.jsonl", "normalizedSha256")):
            if hashlib.sha256((final / name).read_bytes()).hexdigest() != receipt[key]:
                raise ValueError("existing_sample_digest_mismatch")
        return {**receipt, "localDirectory": str(final), "reused": True}
    staging = Path(tempfile.mkdtemp(prefix=f".sample-{schema}-", dir=ROOT))
    raw = staging / "prefix.csv"
    counts = 0
    raw_hash = hashlib.sha256()
    first_ns, last_ns, expected_end = None, None, None
    total_bytes = 0
    instruments: set[tuple[str, str, str]] = set()
    try:
        request = Request(URLS[schema], headers={"Accept": "text/csv"})
        with urlopen(request, timeout=20) as response, raw.open("xb") as target:
            if response.status != 200 or "text/csv" not in response.headers.get("Content-Type", ""):
                raise ValueError("not_public_csv_sample")
            header_bytes = response.readline(65537)
            header = next(csv.reader([header_bytes.decode("utf-8")]))
            if len(header_bytes) > 65536 or "ts_recv" not in header or "flags" not in header or "symbol" not in header:
                raise ValueError("unexpected_sample_header")
            target.write(header_bytes); raw_hash.update(header_bytes); total_bytes += len(header_bytes)
            previous_time = None
            while True:
                line = response.readline(65537)
                if not line:
                    raise ValueError("sample_ended_before_requested_complete_event")
                if len(line) > 65536:
                    raise ValueError("oversized_csv_row")
                fields = next(csv.reader([line.decode("utf-8")]))
                if len(fields) != len(header):
                    raise ValueError("csv_column_mismatch")
                row = dict(zip(header, fields))
                current = int(timestamp_ns(row["ts_recv"]))
                if previous_time is not None and current < previous_time:
                    raise ValueError("sample_receive_clock_regression")
                previous_time = current
                if first_ns is None:
                    first_ns = current; expected_end = current + seconds * 1_000_000_000
                instruments.add((row["publisher_id"], row["instrument_id"], row["symbol"]))
                if len(instruments) > 16:
                    raise ValueError("sample_instrument_capacity")
                # Parse every admitted row before retaining its bytes.
                (normalize_mbo if schema == "mbo" else normalize_reference)(row)
                counts += 1; total_bytes += len(line)
                if counts > 250000 or total_bytes > 128 * 1024**2:
                    raise ValueError("sample_prefix_capacity")
                target.write(line); raw_hash.update(line); last_ns = current
                if current >= expected_end and int(row["flags"]) & 128:
                    break
            target.flush(); os.fsync(target.fileno())
        raw_digest = raw_hash.hexdigest(); source_id = "sha256:" + raw_digest
        output_hash = hashlib.sha256()
        with (staging / "normalized.jsonl").open("xb") as output, raw.open(newline="") as source:
            metadata = {"kind": "metadata", "schema": "hub.futures_source_records/v1" if schema == "mbo" else "hub.futures_bbo_reference/v1",
                "dataset": "GLBX.MDP3", "sourceSchema": schema, "sourceId": source_id,
                "inputSha256": raw_digest, "availabilityBasis": "vendor_capture_retrospective",
                "decoder": "strict_csv_fixedpoint_ns/v1", "scope": "public_sample_prefix_not_full_file"}
            def emit(value):
                line = (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()
                output.write(line); output_hash.update(line)
            emit(metadata)
            for ordinal, row in enumerate(csv.DictReader(source)):
                normalized = (normalize_mbo if schema == "mbo" else normalize_reference)(row)
                emit({"kind": "record", "sourceId": source_id, "ordinal": ordinal,
                      "availableAtNs": timestamp_ns(row["ts_recv"]), "record": normalized})
            output.flush(); os.fsync(output.fileno())
        receipt = {"schema": "futures.public_sample_acquisition/v1", "sourceUrl": URLS[schema],
            "landingPage": "https://databento.com/tick-data", "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "requestedSeconds": seconds, "recordCount": counts, "rawBytes": total_bytes,
            "firstReceiveNs": str(first_ns), "lastReceiveNs": str(last_ns),
            "requestedEndNs": str(expected_end), "endRule": "first_complete_event_at_or_after_requested_end",
            "rawPrefixSha256": raw_digest, "normalizedSha256": output_hash.hexdigest(),
            "instruments": [{"publisherId": int(a), "instrumentId": int(b), "symbol": c} for a, b, c in sorted(instruments)],
            "sourceSchema": schema, "fullFile": False, "live": False,
            "dataRights": "public_research_sample_not_commercial_display_clearance"}
        (staging / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        # Directory rename fails when a competing nonempty receipt directory exists.
        os.rename(staging, final)
        return {**receipt, "localDirectory": str(final), "reused": False}
    except Exception:
        # Preserve exact partial acquisition for inspection; do not retry or call it complete.
        print(json.dumps({"status": "incomplete", "partialDirectory": str(staging)}), flush=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("schema", choices=URLS)
    parser.add_argument("--seconds", type=int, default=300)
    args = parser.parse_args()
    print(json.dumps(acquire(args.schema, args.seconds), indent=2))
