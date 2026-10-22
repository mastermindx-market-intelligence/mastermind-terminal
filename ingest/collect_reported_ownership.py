"""Acquire dated provider-reported HK institutional holders into a separate source cache."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import random
import re
import sys
import time
import urllib.request

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from ingest.collect_us_fund import df_to_records
from ingest.reported_ownership import build_reported_ownership

MANIFEST_URL = "https://app.mastermind-x.com/data/manifest.json"


def utc_now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    os.replace(temporary, path)


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return {}


def recent(stamp, stale_days, now=None):
    try:
        acquired = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if acquired.tzinfo is None:
            return False
        age = ((now or dt.datetime.now(dt.timezone.utc)) - acquired).total_seconds()
        return 0 <= age < stale_days * 86400
    except (AttributeError, TypeError, ValueError):
        return False


def select_symbols(manifest):
    return sorted(symbol for symbol in (manifest.get("symbols") or {})
                  if re.fullmatch(r"[0-9]{4,5}\.HK", symbol))


def fetch_one(symbol):
    import yfinance as yf
    frame = yf.Ticker(symbol).institutional_holders
    return {"ticker": symbol, "fetched_at": utc_now(),
            "institutional_holders": df_to_records(frame), "_errors": []}


def collect(symbols, out, *, stale_days=7, delay=(1.5, 2.5), seconds=1800, fetcher=fetch_one):
    out = Path(out)
    stop = time.monotonic() + seconds
    counts = {"available": 0, "unavailable": 0, "source_error": 0, "fresh": 0, "deferred": 0}
    for index, symbol in enumerate(symbols):
        if time.monotonic() >= stop:
            counts["deferred"] = len(symbols) - index
            break
        raw_path, attempt_path = out / f"{symbol}.json", out / "_attempts" / f"{symbol}.json"
        prior, attempt = read_json(raw_path), read_json(attempt_path)
        if recent(prior.get("fetched_at"), stale_days) and attempt.get("availability") not in ("source_error", "unavailable"):
            counts["fresh"] += 1
            continue
        if not prior and attempt.get("availability") == "unavailable" and recent(attempt.get("attempted_at"), stale_days):
            counts["fresh"] += 1
            continue
        time.sleep(min(random.uniform(*delay), max(0, stop - time.monotonic())))
        if time.monotonic() >= stop:
            counts["deferred"] = len(symbols) - index
            break
        try:
            payload = fetcher(symbol)
            attempted = utc_now()
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
            normalized = build_reported_ownership(raw, expected_ticker=symbol)
            if normalized and normalized.get("rows"):
                atomic_json(raw_path, payload)
                availability = "available"
            else:
                availability = "unavailable"
            outcome = {"ticker": symbol, "attempted_at": attempted, "availability": availability,
                       "reason": None if availability == "available" else "no_dated_rows"}
        except Exception as exc:
            attempted = utc_now()
            availability = "source_error"
            outcome = {"ticker": symbol, "attempted_at": attempted, "availability": availability,
                       "reason": "fetch_field_error", "error_type": type(exc).__name__}
        # A failed or empty attempt never replaces the last source bytes or advances their clock.
        atomic_json(attempt_path, outcome)
        counts[availability] += 1
        print(json.dumps({"ticker": symbol, **outcome}), flush=True)
    print(json.dumps({"summary": counts}), flush=True)
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", choices=["hk"], default="hk")
    parser.add_argument("--only")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--manifest")
    parser.add_argument("--stale-days", type=int, default=7)
    parser.add_argument("--deadline-seconds", type=float, default=1800)
    parser.add_argument("--delay", type=float, nargs=2, default=(1.5, 2.5))
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    out = Path(args.out) if args.out else Path(os.environ.get("MACRO_REPO", ".")) / "data/reported_ownership/hk"
    if args.only:
        symbols = sorted({part.strip().upper() for part in args.only.split(",") if part.strip()})
        if any(not re.fullmatch(r"[0-9]{4,5}\.HK", symbol) for symbol in symbols):
            parser.error("--only requires exact HK listing symbols")
    else:
        if args.manifest:
            manifest = json.loads(Path(args.manifest).read_text())
        else:
            with urllib.request.urlopen(MANIFEST_URL, timeout=30) as response:
                manifest = json.load(response)
        symbols = select_symbols(manifest)
    if args.limit:
        symbols = symbols[:args.limit]
    if not symbols:
        parser.error("no HK listings in requested scope")
    result = collect(symbols, out, stale_days=args.stale_days, delay=tuple(args.delay),
                     seconds=args.deadline_seconds)
    return 1 if result["source_error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
