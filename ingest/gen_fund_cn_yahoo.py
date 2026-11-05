"""Emit only qualified mainland Yahoo coverage extensions; preserve overlapping observations."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ingest.cn_yahoo_fallback import build_fund, valid_symbol, read_collection_receipt
from ingest.collect_reported_ownership import atomic_json
from ingest.regional_financial_projection import materialize_regional_fund, wrap_regional_financials


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", default=str(ROOT / "terminal/public/data"))
    parser.add_argument("--previous-dir")
    parser.add_argument("--cache-dir")
    parser.add_argument("--collection-receipt")
    parser.add_argument("--expected-run-id")
    args = parser.parse_args(argv)
    macro = Path(os.environ.get("MACRO_REPO") or os.environ.get("MACRO_ROOT") or
                 "/Users/chriswong/Documents/Cluade/Macro Dashboard")
    cache = Path(args.cache_dir) if args.cache_dir else macro / "data/cn_yahoo"
    out = Path(args.out)
    previous_dir = Path(args.previous_dir or args.out)
    receipt = read_collection_receipt(args.collection_receipt, args.expected_run_id) if args.collection_receipt else None
    symbols = (sorted(receipt["admitted"]) if receipt else args.only.split(",") if args.only else
               sorted(path.stem for path in cache.glob("*.json") if valid_symbol(path.stem)))
    if args.limit and not receipt:
        symbols = symbols[:args.limit]
    counts = {"written": 0, "errors": 0, "added_annual": 0, "added_interim": 0}
    for symbol in symbols:
        try:
            raw = (cache / (symbol + ".json")).read_bytes()
            if receipt and hashlib.sha256(raw).hexdigest() != receipt["admitted"][symbol]["raw_input_sha256"]:
                raise ValueError("acquired source changed after collection admission")
            prior_path = previous_dir / (symbol + ".fund.json")
            previous = json.loads(prior_path.read_text()) if prior_path.exists() else None
            selected_previous = materialize_regional_fund(previous, symbol) if previous else None
            fund = build_fund(raw, symbol, selected_previous)
            atomic_json(out / (symbol + ".fund.json"), wrap_regional_financials(fund, previous))
            counts["written"] += 1
            additions = fund["data_freshness"]["added_periods"]
            counts["added_annual"] += len(additions["annual"])
            counts["added_interim"] += len(additions["quarterly"])
        except (OSError, ValueError, TypeError) as exc:
            counts["errors"] += 1
            print(json.dumps({"ticker": symbol, "status": "held", "error_type": type(exc).__name__}), flush=True)
    print(json.dumps({"summary": counts}), flush=True)
    return 1 if counts["errors"] or not counts["written"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
