#!/usr/bin/env python3
"""Offline, lossless DBN normalization for the existing futures source adapter.

Uses Databento's official native decoder, never a hand-written binary parser.
No API client, credentials, network, purchase, archive writer or live-data claim.
The input digest must match before decoding; output is new-file-only and committed
atomically after complete metadata/record/compression validation. Raw/normalized
hashes bind evidence, not market-data rights or historical Mastermind availability.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any, BinaryIO, Iterator

CHUNK = 64 * 1024
MAX_DECOMPRESSED = 4 * 1024**3
NS_FIELDS = ("ts_event", "ts_recv")
MBO_STRINGS = ("order_id", "price")
MBO_INTS = ("publisher_id", "instrument_id", "flags", "channel_id", "sequence", "size", "ts_in_delta")
DEF_STRINGS = ("raw_symbol", "instrument_class", "security_update_action", "currency", "exchange", "asset")
DEF_NUMERIC_STRINGS = ("min_price_increment", "activation", "expiration", "unit_of_measure_qty")
STATUS_STRINGS = ("is_trading", "is_quoting", "is_short_sell_restricted")


def encode_record(record: Any) -> dict[str, Any]:
    """Only explicit, inspected SDK fields cross the JSON boundary."""
    rtype = int(record.rtype)
    out: dict[str, Any] = {"rtype": rtype}
    if rtype not in (160, 18, 19):
        raise ValueError(f"unsupported_record_type:{rtype}")
    out.update({key: str(int(getattr(record, key))) for key in NS_FIELDS})
    if rtype == 160:
        out.update({key: str(int(getattr(record, key))) for key in MBO_STRINGS})
        out.update({key: int(getattr(record, key)) for key in MBO_INTS})
        out.update(action=str(record.action), side=str(record.side))
    else:
        out.update(publisher_id=int(record.publisher_id), instrument_id=int(record.instrument_id))
        if rtype == 19:
            out.update({key: str(getattr(record, key)) for key in DEF_STRINGS})
            out.update({key: str(int(getattr(record, key))) for key in DEF_NUMERIC_STRINGS})
        else:
            # Native SDK exposes these tri-state fields as bool | None, not its repr glyph.
            for key in STATUS_STRINGS:
                value = getattr(record, key)
                if value is not True and value is not False and value is not None:
                    raise ValueError("invalid_sdk_tristate")
                out[key] = "Y" if value is True else "N" if value is False else "~"
            out.update(action=int(record.action), reason=int(record.reason), trading_event=int(record.trading_event))
    return out


def decoded_chunks(source: BinaryIO) -> Iterator[bytes]:
    """Bounded raw reads; reject incomplete/trailing zstd frames, including concatenated frames."""
    first = source.read(CHUNK)
    if not first:
        raise ValueError("empty_source")
    compressed = first[:4] == b"\x28\xb5\x2f\xfd"
    if not compressed:
        yield first
        while data := source.read(CHUNK):
            yield data
        return
    import zstandard
    decompressor = zstandard.ZstdDecompressor(max_window_size=128 * 1024**2).decompressobj()
    total = 0
    data = first
    while data:
        if decompressor.eof:
            decompressor = zstandard.ZstdDecompressor(max_window_size=128 * 1024**2).decompressobj()
        plain = decompressor.decompress(data)
        total += len(plain)
        if total > MAX_DECOMPRESSED:
            raise ValueError("decompressed_capacity")
        for offset in range(0, len(plain), CHUNK):
            yield plain[offset:offset + CHUNK]
        data = decompressor.unused_data or source.read(CHUNK)
    if not decompressor.eof:
        raise ValueError("truncated_compression_frame")


def normalize(input_path: Path, output_path: Path, expected_sha256: str,
              max_records: int = 1_000_000) -> dict[str, Any]:
    import databento_dbn as dbn
    if not (len(expected_sha256) == 64 and all(c in "0123456789abcdef" for c in expected_sha256)):
        raise ValueError("invalid_expected_digest")
    if not isinstance(max_records, int) or isinstance(max_records, bool) or max_records < 1:
        raise ValueError("invalid_record_limit")
    if output_path.exists() or input_path.resolve() == output_path.resolve():
        raise ValueError("output_exists_or_is_input")
    if not input_path.is_file():
        raise ValueError("source_not_file")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    raw_hash = hashlib.sha256()
    # Verify and decode the SAME open file descriptor. Verify it again after decoding
    # to catch in-place changes; a changing source never produces a success receipt.
    with input_path.open("rb") as source:
        before = os.fstat(source.fileno())
        while chunk := source.read(CHUNK):
            raw_hash.update(chunk)
        if raw_hash.hexdigest() != expected_sha256:
            raise ValueError("source_digest_mismatch")
        source.seek(0)
        decoder = dbn.DBNDecoder(upgrade_policy=dbn.VersionUpgradePolicy.UPGRADE_TO_V3)
        source_id = f"sha256:{expected_sha256}"
        fd, temporary = tempfile.mkstemp(prefix=".futures-normalize-", dir=output_path.parent)
        count, metadata = 0, None
        first_recv: str | None = None
        last_recv: str | None = None
        kinds: dict[str, int] = {}
        normalized_hash = hashlib.sha256()
        try:
            with os.fdopen(fd, "wb") as target:
                def write(value: dict[str, Any]) -> None:
                    data = (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()
                    if len(data) > 2 * 1024**2:
                        raise ValueError("record_or_metadata_capacity")
                    normalized_hash.update(data)
                    target.write(data)
                for chunk in decoded_chunks(source):
                    for item in decoder.write_and_decode(chunk):
                        if isinstance(item, dbn.Metadata):
                            if metadata is not None or count:
                                raise ValueError("duplicate_or_late_metadata")
                            if item.dataset != "GLBX.MDP3" or str(item.schema) not in ("mbo", "status", "definition"):
                                raise ValueError("unsupported_dataset_or_schema")
                            metadata = {"kind": "metadata", "schema": "hub.futures_source_records/v1",
                                "sourceId": source_id, "inputSha256": expected_sha256,
                                "dataset": item.dataset, "sourceSchema": str(item.schema),
                                "dbnVersion": int(item.version), "startNs": str(item.start),
                                "endNs": None if item.end is None else str(item.end),
                                "availabilityBasis": "vendor_capture_retrospective",
                                "decoder": f"databento-dbn=={importlib.metadata.version('databento-dbn')}",
                                "symbols": list(item.symbols),
                                "mappings": {symbol: [{"startDate": row["start_date"].isoformat(),
                                    "endDate": row["end_date"].isoformat(), "instrumentId": row["symbol"]}
                                    for row in intervals] for symbol, intervals in item.mappings.items()}}
                            write(metadata)
                            continue
                        if metadata is None:
                            raise ValueError("missing_metadata")
                        if count >= max_records:
                            raise ValueError("record_limit_exceeded")
                        record = encode_record(item)
                        if record["rtype"] != {"mbo": 160, "status": 18, "definition": 19}[metadata["sourceSchema"]]:
                            raise ValueError("record_schema_mismatch")
                        # This is VENDOR capture time, not when a Mastermind decision saw the record.
                        received = record["ts_recv"]
                        first_recv = received if first_recv is None else first_recv
                        last_recv = received
                        kinds[str(record["rtype"])] = kinds.get(str(record["rtype"]), 0) + 1
                        write({"kind": "record", "sourceId": source_id, "ordinal": count,
                               "availableAtNs": received, "record": record})
                        count += 1
                # Official decoder needs a final drain to reveal a partial trailing record.
                if decoder.decode() or decoder.buffer():
                    raise ValueError("truncated_or_unconsumed_dbn_record")
                if metadata is None:
                    raise ValueError("missing_metadata")
                target.flush()
                os.fsync(target.fileno())
            source.seek(0)
            after_hash = hashlib.sha256()
            while chunk := source.read(CHUNK):
                after_hash.update(chunk)
            after = os.fstat(source.fileno())
            if (after_hash.hexdigest() != expected_sha256 or before.st_size != after.st_size or
                    before.st_mtime_ns != after.st_mtime_ns):
                raise ValueError("source_changed_during_decode")
            # Link is atomic and fails if another writer already created this output.
            os.link(temporary, output_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return {"schema": "hub.futures_normalization_receipt/v1", "sourceId": source_id,
            "inputSha256": expected_sha256, "outputSha256": normalized_hash.hexdigest(),
            "recordCount": count, "recordTypes": kinds, "dataset": metadata["dataset"],
            "sourceSchema": metadata["sourceSchema"], "decoder": metadata["decoder"],
            "firstReceiveNs": first_recv, "lastReceiveNs": last_recv,
            "availabilityBasis": "vendor_capture_retrospective",
            "marketDataRights": "not_established_by_decoder", "live": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--max-records", type=int, default=1_000_000)
    args = parser.parse_args()
    try:
        receipt = normalize(args.input, args.output, args.sha256, args.max_records)
    except Exception as error:
        print(json.dumps({"status": "refused", "reason": str(error)}), file=sys.stderr)
        return 2
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
