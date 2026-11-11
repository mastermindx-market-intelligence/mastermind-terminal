#!/usr/bin/env python3
"""Acquire free IEX HIST DEEP+ (DPLS) order-by-order PCAPs safely.

The HIST catalog is public and requires no API key.  DPLS is the DEEP+
order-by-order equities feed.  This command deliberately downloads one trading
day at a time and records immutable acquisition metadata; it does not mirror the
entire multi-terabyte archive by default.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NoReturn

HIST_INDEX_URL = "https://iextrading.com/api/1.0/hist"
DEFAULT_ROOT = Path("/Volumes/Mastermind/market-data/iex/hist")
DEFAULT_FEED = "DPLS"
CHUNK_BYTES = 8 * 1024 * 1024
MIN_FREE_RESERVE_BYTES = 50 * 1024**3


@dataclass(frozen=True)
class HistObject:
    date: str
    feed: str
    version: str
    protocol: str
    size: int
    link: str

    @classmethod
    def from_json(cls, row: dict[str, Any]) -> "HistObject":
        return cls(
            date=str(row["date"]),
            feed=str(row["feed"]),
            version=str(row["version"]),
            protocol=str(row["protocol"]),
            size=int(row["size"]),
            link=str(row["link"]),
        )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_catalog(url: str = HIST_INDEX_URL) -> dict[str, list[dict[str, Any]]]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mastermind-IEX-HIST/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def feed_objects(catalog: dict[str, list[dict[str, Any]]], feed: str) -> list[HistObject]:
    rows = [
        HistObject.from_json(row)
        for day_rows in catalog.values()
        for row in day_rows
        if str(row.get("feed", "")).upper() == feed.upper()
    ]
    return sorted(rows, key=lambda row: row.date)


def select_object(
    catalog: dict[str, list[dict[str, Any]]], feed: str, date: str | None
) -> HistObject:
    rows = feed_objects(catalog, feed)
    if not rows:
        raise SystemExit(f"No {feed} files found in IEX HIST catalog")
    if date is None or date == "latest":
        return rows[-1]
    for row in rows:
        if row.date == date.replace("-", ""):
            return row
    raise SystemExit(f"No {feed} file for {date}")


def ensure_capacity(root: Path, required_bytes: int, reserve_bytes: int) -> None:
    root.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(root).free
    required = required_bytes + reserve_bytes
    if free < required:
        raise SystemExit(
            f"Insufficient free space: {free:,} bytes free; "
            f"need {required_bytes:,} for file plus {reserve_bytes:,} reserve"
        )


def receipt_path_for(final_path: Path) -> Path:
    return final_path.with_suffix(final_path.suffix + ".receipt.json")


def destination_for(root: Path, obj: HistObject) -> Path:
    year, month = obj.date[:4], obj.date[4:6]
    name = f"{obj.date}_IEXTP1_{obj.feed}{obj.version}.pcap.gz"
    return root / "raw" / obj.feed / year / month / name


def _hash_state(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK_BYTES), b""):
            h.update(chunk)
    return h


def hash_file(path: Path) -> str:
    return _hash_state(path).hexdigest()


def _refuse(path: Path, reason: str) -> NoReturn:
    raise SystemExit(f"Refusing {path}: {reason}; existing artifacts preserved")


def _read_record(path: Path, schema: str) -> dict[str, Any]:
    try:
        record = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        _refuse(path, f"missing or unreadable metadata ({exc})")
    if not isinstance(record, dict) or record.get("schema") != schema:
        _refuse(path, "unsupported metadata schema")
    return record


def _object_identity(obj: HistObject) -> dict[str, Any]:
    return {
        "feed": obj.feed,
        "date": obj.date,
        "protocol": obj.protocol,
        "version": obj.version,
        "source_url": obj.link,
        "expected_size_bytes": obj.size,
    }


def _validate_identity(record: dict[str, Any], obj: HistObject, path: Path) -> None:
    for key, expected in _object_identity(obj).items():
        actual = record.get(key)
        if type(actual) is not type(expected) or actual != expected:
            _refuse(path, f"selected object mismatch: {key}")


def _digest_matches(record: dict[str, Any], digest: str) -> bool:
    saved = record.get("sha256")
    return (
        isinstance(saved, str)
        and re.fullmatch(r"[0-9a-fA-F]{64}", saved) is not None
        and saved.lower() == digest
    )


def _validate_receipt(obj: HistObject, final_path: Path, receipt_path: Path) -> None:
    record = _read_record(receipt_path, "mastermind.iex_hist_acquisition.v1")
    _validate_identity(record, obj, receipt_path)
    labels = {
        "source": "IEX HIST",
        "product": "DEEP+" if obj.feed == "DPLS" else obj.feed,
        "scope": "IEX venue only",
        "api_key_required": False,
    }
    for key, expected in labels.items():
        if type(record.get(key)) is not type(expected) or record[key] != expected:
            _refuse(receipt_path, f"invalid acquisition field: {key}")
    actual = record.get("actual_size_bytes")
    if type(actual) is not int or actual != obj.size or final_path.stat().st_size != actual:
        _refuse(final_path, "file and receipt sizes do not match the selected object")
    if not isinstance(record.get("local_path"), str) or not record["local_path"]:
        _refuse(receipt_path, "invalid historical local_path")
    if type(record.get("reused_existing_file")) is not bool:
        _refuse(receipt_path, "invalid reuse history")
    try:
        acquired = datetime.fromisoformat(record["acquired_at_utc"])
        if acquired.utcoffset() != timezone.utc.utcoffset(acquired):
            raise ValueError("timestamp must carry UTC")
    except (KeyError, TypeError, ValueError):
        _refuse(receipt_path, "invalid acquisition timestamp")
    if not _digest_matches(record, hash_file(final_path)):
        _refuse(final_path, "saved acquisition SHA-256 does not match current bytes")


def _strong_etag(value: Any) -> bool:
    # An opaque, quoted strong HTTP entity tag. Never upgrade W/ or a date to one.
    return isinstance(value, str) and re.fullmatch(r'"[\x21\x23-\x7e\x80-\xff]*"', value) is not None


def _response_header(response, name: str) -> str | None:
    values = response.headers.get_all(name, [])
    if len(values) > 1:
        raise SystemExit(f"Ambiguous {name} response header; partial preserved")
    return values[0] if values else None


def _write_partial_record(path: Path, record: dict[str, Any]) -> None:
    # Only the current, validated transfer owns this sidecar. An abandoned temp
    # is evidence requiring reconciliation, not permission to overwrite it.
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("x") as out:
        out.write(json.dumps(record, sort_keys=True, indent=2) + "\n")
        out.flush()
        os.fsync(out.fileno())
    os.replace(temp, path)


def download(obj: HistObject, root: Path, reserve_bytes: int) -> Path:
    if type(obj.size) is not int or obj.size <= 0:
        raise SystemExit("Selected HIST object must have a positive integer size")
    final_path = destination_for(root, obj)
    final_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path = receipt_path_for(final_path)

    if final_path.exists():
        _validate_receipt(obj, final_path, receipt_path)
        print(f"already_complete {final_path}")
        return final_path
    if receipt_path.exists():
        _refuse(receipt_path, "acquisition receipt exists without its final file")

    partial = final_path.with_suffix(final_path.suffix + ".part")
    metadata_path = partial.with_suffix(partial.suffix + ".json")
    for path in (receipt_path, metadata_path):
        temp = path.with_suffix(path.suffix + ".tmp")
        if temp.exists():
            _refuse(temp, "unfinished metadata publication")
    previous = None
    offset = 0
    digest = hashlib.sha256()
    if partial.exists():
        previous = _read_record(metadata_path, "mastermind.iex_hist_partial.v1")
        _validate_identity(previous, obj, metadata_path)
        offset = partial.stat().st_size
        if not 0 < offset < obj.size:
            _refuse(partial, "partial length is not a resumable prefix")
        if type(previous.get("size_bytes")) is not int or previous["size_bytes"] != offset:
            _refuse(partial, "retained length does not match its checkpoint")
        if not _strong_etag(previous.get("etag")):
            _refuse(metadata_path, "partial has no recorded strong ETag")
        if previous.get("content_encoding") != "identity":
            _refuse(metadata_path, "partial representation is not identity encoded")
        if not isinstance(previous.get("response_url"), str) or not previous["response_url"]:
            _refuse(metadata_path, "partial has no recorded effective resource URL")
        digest = _hash_state(partial)
        if not _digest_matches(previous, digest.hexdigest()):
            _refuse(partial, "retained prefix SHA-256 does not match its checkpoint")
    elif metadata_path.exists():
        _refuse(metadata_path, "partial metadata exists without its bytes")

    # The existing prefix already occupies disk; only the remaining bytes are
    # newly allocated. Keep the same reserve after a fresh or resumed transfer.
    ensure_capacity(root, obj.size - offset, reserve_bytes)
    headers = {"User-Agent": "Mastermind-IEX-HIST/1.0", "Accept-Encoding": "identity"}
    if offset:
        headers["Range"] = f"bytes={offset}-{obj.size - 1}"
        headers["If-Range"] = previous["etag"]
    req = urllib.request.Request(obj.link, headers=headers)
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=120) as response:
        expected_status = 206 if offset else 200
        if response.status != expected_status:
            _refuse(partial, f"expected HTTP {expected_status}, received {response.status}")
        encoding = _response_header(response, "Content-Encoding")
        if encoding is not None and encoding.strip().lower() != "identity":
            _refuse(partial, "response changed the byte representation")
        content_type = _response_header(response, "Content-Type")
        if content_type and content_type.strip().lower().startswith("multipart/"):
            _refuse(partial, "multipart range responses are not supported")
        response_url = response.geturl()
        if not isinstance(response_url, str) or not response_url:
            _refuse(partial, "response has no effective resource URL")
        etag = _response_header(response, "ETag")
        content_range = _response_header(response, "Content-Range")
        if offset:
            if response_url != previous["response_url"]:
                _refuse(partial, "effective resource URL changed")
            if not _strong_etag(etag) or etag != previous["etag"]:
                _refuse(partial, "strong ETag changed or is absent")
            if content_range != f"bytes {offset}-{obj.size - 1}/{obj.size}":
                _refuse(partial, "Content-Range does not match the complete requested remainder")
        elif content_range is not None:
            _refuse(partial, "unexpected Content-Range for a fresh full response")
        content_length = _response_header(response, "Content-Length")
        if content_length is not None and (
            not re.fullmatch(r"[0-9]{1,20}", content_length.strip())
            or int(content_length) != obj.size - offset
        ):
            _refuse(partial, "Content-Length does not match the expected response body")

        record = {
            "schema": "mastermind.iex_hist_partial.v1",
            **_object_identity(obj),
            "response_url": response_url,
            "etag": etag,
            "content_encoding": "identity",
        }
        # Header rejection above never opens the existing file for append.
        # Fresh acquisition is exclusive: never truncate a file that appeared.
        with partial.open("ab" if offset else "xb") as out:
            if os.fstat(out.fileno()).st_size != offset:
                _refuse(partial, "partial length changed before streaming")
            written = offset
            try:
                while True:
                    chunk = response.read(min(CHUNK_BYTES, obj.size - written + 1))
                    if not chunk:
                        break
                    if len(chunk) > obj.size - written:
                        _refuse(partial, "response body exceeds the selected object size")
                    out.write(chunk)
                    digest.update(chunk)
                    written += len(chunk)
            finally:
                # Controlled interruption can retain a provable prefix. A hard
                # crash before this checkpoint leaves a mismatch and is refused.
                out.flush()
                os.fsync(out.fileno())
                if os.fstat(out.fileno()).st_size != written:
                    _refuse(partial, "stored length changed while streaming")
                _write_partial_record(
                    metadata_path,
                    {**record, "size_bytes": written, "sha256": digest.hexdigest()},
                )

    actual = partial.stat().st_size
    if actual != obj.size:
        raise SystemExit(
            f"Incomplete download: {actual:,} bytes; expected {obj.size:,}. "
            f"Partial preserved at {partial}"
        )

    sha256 = digest.hexdigest()
    if hash_file(partial) != sha256:
        _refuse(partial, "stored bytes do not match the completed response digest")
    if final_path.exists() or receipt_path.exists():
        _refuse(final_path, "another final artifact appeared during acquisition")
    os.replace(partial, final_path)
    write_receipt(obj, final_path, receipt_path, sha256, reused=False)
    metadata_path.unlink()
    elapsed = max(time.monotonic() - started, 0.001)
    print(f"downloaded {final_path} bytes={actual} seconds={elapsed:.1f} sha256={sha256}")
    return final_path


def write_receipt(
    obj: HistObject,
    final_path: Path,
    receipt_path: Path,
    sha256: str,
    *,
    reused: bool,
) -> None:
    payload = {
        "schema": "mastermind.iex_hist_acquisition.v1",
        "source": "IEX HIST",
        "feed": obj.feed,
        "product": "DEEP+" if obj.feed == "DPLS" else obj.feed,
        "scope": "IEX venue only",
        "date": obj.date,
        "protocol": obj.protocol,
        "version": obj.version,
        "source_url": obj.link,
        "expected_size_bytes": obj.size,
        "actual_size_bytes": final_path.stat().st_size,
        "sha256": sha256,
        "local_path": str(final_path),
        "acquired_at_utc": utc_now(),
        "reused_existing_file": reused,
        "api_key_required": False,
    }
    temp = receipt_path.with_suffix(receipt_path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n")
    os.replace(temp, receipt_path)


def cmd_inventory(args: argparse.Namespace) -> int:
    catalog = fetch_catalog(args.index_url)
    rows = feed_objects(catalog, args.feed)
    if not rows:
        raise SystemExit(f"No {args.feed} rows")
    total = sum(row.size for row in rows)
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    usage = shutil.disk_usage(root)
    print(
        json.dumps(
            {
                "feed": args.feed,
                "product": "DEEP+" if args.feed.upper() == "DPLS" else args.feed,
                "files": len(rows),
                "first_date": rows[0].date,
                "last_date": rows[-1].date,
                "archive_compressed_bytes": total,
                "archive_compressed_tb_decimal": round(total / 1e12, 3),
                "root": str(root),
                "filesystem_total_bytes": usage.total,
                "filesystem_free_bytes": usage.free,
                "latest": rows[-1].__dict__,
                "api_key_required": False,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def cmd_download(args: argparse.Namespace) -> int:
    catalog = fetch_catalog(args.index_url)
    obj = select_object(catalog, args.feed, args.date)
    print(
        f"selected feed={obj.feed} date={obj.date} size={obj.size:,} "
        f"protocol={obj.protocol} version={obj.version}"
    )
    download(obj, Path(args.root), int(args.reserve_gib * 1024**3))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--index-url", default=HIST_INDEX_URL)
    parser.add_argument("--feed", default=DEFAULT_FEED)
    sub = parser.add_subparsers(dest="command", required=True)

    inv = sub.add_parser("inventory", help="show catalog size and local free space")
    inv.set_defaults(func=cmd_inventory)

    dl = sub.add_parser("download", help="download exactly one trading day")
    dl.add_argument("--date", default="latest", help="YYYYMMDD, YYYY-MM-DD, or latest")
    dl.add_argument(
        "--reserve-gib",
        type=float,
        default=50.0,
        help="minimum free space to keep after download (default 50 GiB)",
    )
    dl.set_defaults(func=cmd_download)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
