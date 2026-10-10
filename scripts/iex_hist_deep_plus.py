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
import shutil
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK_BYTES), b""):
            h.update(chunk)
    return h.hexdigest()


def download(obj: HistObject, root: Path, reserve_bytes: int) -> Path:
    final_path = destination_for(root, obj)
    final_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path = receipt_path_for(final_path)

    if final_path.exists():
        actual = final_path.stat().st_size
        if actual != obj.size:
            raise SystemExit(
                f"Existing file has wrong size: {final_path} = {actual:,}; expected {obj.size:,}"
            )
        if receipt_path.exists():
            print(f"already_complete {final_path}")
            return final_path
        sha256 = hash_file(final_path)
        write_receipt(obj, final_path, receipt_path, sha256, reused=True)
        return final_path

    ensure_capacity(root, obj.size, reserve_bytes)
    partial = final_path.with_suffix(final_path.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > obj.size:
        partial.unlink()
        offset = 0

    headers = {"User-Agent": "Mastermind-IEX-HIST/1.0"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    req = urllib.request.Request(obj.link, headers=headers)
    started = time.monotonic()
    mode = "ab" if offset else "wb"
    with urllib.request.urlopen(req, timeout=120) as response, partial.open(mode) as out:
        status = getattr(response, "status", None)
        if offset and status != 206:
            out.close()
            partial.unlink(missing_ok=True)
            return download(obj, root, reserve_bytes)
        while True:
            chunk = response.read(CHUNK_BYTES)
            if not chunk:
                break
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())

    actual = partial.stat().st_size
    if actual != obj.size:
        raise SystemExit(
            f"Incomplete download: {actual:,} bytes; expected {obj.size:,}. "
            f"Partial preserved at {partial}"
        )

    os.replace(partial, final_path)
    sha256 = hash_file(final_path)
    write_receipt(obj, final_path, receipt_path, sha256, reused=False)
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
