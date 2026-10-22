"""Emit only qualified mainland Yahoo coverage extensions; preserve overlapping observations."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ingest.cn_yahoo_fallback import build_fund, valid_symbol
from ingest.collect_reported_ownership import atomic_json


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", default=str(ROOT / "terminal/public/data"))
    parser.add_argument("--previous-dir")
    parser.add_argument("--cache-dir")
    args = parser.parse_args(argv)
    macro = Path(os.environ.get("MACRO_REPO") or os.environ.get("MACRO_ROOT") or
                 "/Users/chriswong/Documents/Cluade/Macro Dashboard")
    cache = Path(args.cache_dir) if args.cache_dir else macro / "data/cn_yahoo"
    out = Path(args.out)
    previous_dir = Path(args.previous_dir or args.out)
    symbols = args.only.split(",") if args.only else sorted(path.stem for path in cache.glob("*.json") if valid_symbol(path.stem))
    if args.limit:
        symbols = symbols[:args.limit]
    counts = {"written": 0, "errors": 0, "added_annual": 0, "added_interim": 0}
    for symbol in symbols:
        try:
            raw = (cache / (symbol + ".json")).read_bytes()
            prior_path = previous_dir / (symbol + ".fund.json")
            previous = json.loads(prior_path.read_text()) if prior_path.exists() else None
            fund = build_fund(raw, symbol, previous)
            atomic_json(out / (symbol + ".fund.json"), fund)
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
