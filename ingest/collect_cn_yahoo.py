"""Bounded, resumable mainland Yahoo coverage acquisition with immutable source receipts."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import random
import sys
import time
import uuid
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ingest.cn_yahoo_fallback import CACHE_SCHEMA, FIELDS, qualify_source, valid_symbol
from ingest.collect_reported_ownership import atomic_json, read_json, recent, utc_now

MANIFEST_URL = "https://app.mastermind-x.com/data/manifest.json"


def select_symbols(manifest):
    return sorted(symbol for symbol, row in (manifest.get("symbols") or {}).items()
                  if valid_symbol(symbol) and isinstance(row, dict) and row.get("sec", "Equities") == "Equities")


def fetch_one(symbol):
    import yfinance as yf
    ticker = yf.Ticker(symbol)
    info = ticker.info
    if not isinstance(info, dict) or info.get("symbol") != symbol:
        raise ValueError("listing identity unavailable")
    fields = [prefix + field for prefix in ("annual", "quarterly")
              for family in FIELDS.values() for field in family.values()]
    now = dt.datetime.now(dt.timezone.utc)
    query = urllib.parse.urlencode({"symbol": symbol, "type": ",".join(fields),
        "period1": int((now - dt.timedelta(days=6 * 366)).timestamp()), "period2": int(now.timestamp())})
    url = "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/" + symbol + "?" + query
    # yfinance's DataFrame conversion discards periodType and currencyCode. Keep the
    # actual response instead; a library/endpoint change fails qualification, retaining old data.
    response = ticker._data.cache_get(url=url, timeout=20)
    if response.status_code != 200:
        raise OSError("time-series request failed")
    body = response.text
    return {"schema": CACHE_SCHEMA, "ticker": symbol, "fetched_at": utc_now(), "info": info,
            "timeseries_body": body, "timeseries_sha256": hashlib.sha256(body.encode()).hexdigest(),
            "source_endpoint": url, "adapter": "yfinance", "adapter_version": yf.__version__}


def collect(symbols, out, *, seconds=1790, stale_days=7, delay=(1.5, 2.5), fetcher=fetch_one,
            run_id=None, receipt_path=None, scope="explicit_subset"):
    out = Path(out)
    stop = time.monotonic() + seconds
    requested = sorted(set(symbols))
    run_id = run_id or uuid.uuid4().hex
    receipt_path = Path(receipt_path) if receipt_path else out / "_collections" / (uuid.uuid4().hex + ".json")
    outcomes = {symbol: {"status": "deferred"} for symbol in requested}
    admitted = {}
    # Never-attempted names lead; repeated failures cannot starve the tail of a large universe.
    symbols = sorted(requested, key=lambda symbol: (
        (read_json(out / "_attempts" / (symbol + ".json")).get("attempted_at") or ""), symbol))
    counts = {"qualified": 0, "fresh": 0, "unavailable": 0, "source_error": 0, "deferred": 0}
    for index, symbol in enumerate(symbols):
        if time.monotonic() >= stop:
            counts["deferred"] = len(symbols) - index
            break
        path, attempt_path = out / (symbol + ".json"), out / "_attempts" / (symbol + ".json")
        previous, attempt = read_json(path), read_json(attempt_path)
        if recent(previous.get("fetched_at"), stale_days) and attempt.get("status") not in ("unavailable", "source_error"):
            try:
                cached, _, receipt = qualify_source(path.read_bytes(), symbol)
                counts["fresh"] += 1
                admitted[symbol] = {"raw_input_sha256": receipt, "acquired_at": cached["fetched_at"], "status": "fresh"}
                outcomes[symbol] = {"status": "fresh", "source_attempt_at": attempt.get("attempted_at")}
                continue
            except (OSError, TypeError, ValueError):
                pass
        # Let a bounded daily pass reach the rest of the universe without hammering unavailable names.
        if attempt.get("status") in ("unavailable", "source_error") and recent(attempt.get("attempted_at"), 1):
            counts[attempt["status"]] += 1
            outcomes[symbol] = {"status": attempt["status"], "source_attempt_at": attempt.get("attempted_at"),
                                "reason": attempt.get("reason")}
            continue
        time.sleep(min(random.uniform(*delay), max(0, stop - time.monotonic())))
        if time.monotonic() >= stop:
            counts["deferred"] = len(symbols) - index
            break
        try:
            payload = fetcher(symbol)
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
            _, observations, receipt = qualify_source(raw, symbol)
            raw_receipt_path = out / "_receipts" / symbol / (receipt + ".json")
            raw_receipt_path.parent.mkdir(parents=True, exist_ok=True)
            if raw_receipt_path.exists() and raw_receipt_path.read_bytes() != raw:
                raise ValueError("immutable receipt changed")
            if not raw_receipt_path.exists():
                with raw_receipt_path.open("xb") as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
            atomic_json(path, payload)
            status = "qualified"
            admitted[symbol] = {"raw_input_sha256": receipt, "acquired_at": payload["fetched_at"], "status": status}
            outcome = {"ticker": symbol, "status": status, "attempted_at": utc_now(),
                "acquired_at": payload["fetched_at"], "raw_input_sha256": receipt,
                "periods": {basis: sorted(periods) for basis, periods in observations.items()}}
        except ValueError:
            status = "unavailable"
            outcome = {"ticker": symbol, "status": status, "attempted_at": utc_now(),
                       "reason": "listing_or_period_metadata_unqualified"}
        except Exception as exc:
            status = "source_error"
            outcome = {"ticker": symbol, "status": status, "attempted_at": utc_now(),
                       "reason": "source_request_failed", "error_type": type(exc).__name__}
        # Failed/empty attempts never replace an acquired source or its source clock.
        atomic_json(attempt_path, outcome)
        counts[status] += 1
        outcomes[symbol] = outcome
        print(json.dumps(outcome), flush=True)
        if outcome.get("error_type") == "YFRateLimitError":
            break  # Respect a provider throttle; untouched names remain explicitly deferred.
    counts = {status: sum(item["status"] == status for item in outcomes.values()) for status in counts}
    summary = {"schema": "mastermind.cn-yahoo-collection/v1", "run_id": run_id,
               "requested": len(requested), "requested_symbols": requested, "scope": scope,
               "scope_sha256": hashlib.sha256(json.dumps(requested, separators=(",", ":")).encode()).hexdigest(),
               "completed_at": utc_now(), "finalized": True, "counts": counts,
               "admitted": admitted, "outcomes": outcomes,
               "coverage_complete": counts["deferred"] == counts["unavailable"] == counts["source_error"] == 0}
    atomic_json(receipt_path, summary)
    atomic_json(out / "_summary.json", summary)
    print(json.dumps({"summary": summary}), flush=True)
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--manifest")
    parser.add_argument("--out")
    parser.add_argument("--receipt")
    parser.add_argument("--run-id")
    parser.add_argument("--deadline-seconds", type=float, default=1790)
    parser.add_argument("--stale-days", type=int, default=7)
    parser.add_argument("--delay", type=float, nargs=2, default=(1.5, 2.5))
    args = parser.parse_args(argv)
    if args.only:
        symbols = [symbol.strip() for symbol in args.only.split(",")]
        if not symbols or any(not valid_symbol(symbol) for symbol in symbols):
            parser.error("--only contains an unsupported listing")
    else:
        if args.manifest:
            manifest = json.loads(Path(args.manifest).read_text())
        else:
            with urllib.request.urlopen(MANIFEST_URL, timeout=20) as response:
                manifest = json.load(response)
        symbols = select_symbols(manifest)
    if args.limit:
        symbols = symbols[:args.limit]
    macro = Path(os.environ.get("MACRO_REPO") or os.environ.get("MACRO_ROOT") or
                 "/Users/chriswong/Documents/Cluade/Macro Dashboard")
    out = Path(args.out) if args.out else macro / "data/cn_yahoo"
    counts = collect(symbols, out, seconds=args.deadline_seconds, stale_days=args.stale_days, delay=tuple(args.delay),
                     run_id=args.run_id, receipt_path=args.receipt,
                     scope="limited" if args.limit else "explicit_subset" if args.only else "manifest")
    return 0 if counts["qualified"] + counts["fresh"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
