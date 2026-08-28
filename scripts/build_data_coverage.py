#!/usr/bin/env python3
"""
build_data_coverage.py — generate public/data/coverage.json listing which
per-symbol data files exist in public/data/.

The client consults coverage.json before its first fetch so a symbol outside the
deep-coverage universe costs no request at all.

WHEN THIS MUST RUN — this file is a claim about the CURRENT contents of the data
directory, and it is only true for as long as nothing has been published since.
It used to be generated ONLY by the Next package's `prebuild`, i.e. during a
deploy, while the nightly `terminal-data` publisher writes per-symbol artifacts
on a completely independent schedule. Between a nightly publish and the next
deploy the index therefore asserted absences that were no longer true, and the
client believed them before making any request. `ops/terminal-data` now runs
this as its final publish step (pinned by tests/test_nightly_wiring.py).

Output shape:
  {
    "as_of": "2026-07-09T12:00:00Z",   # ISO-8601 UTC, the client's freshness gate
    "generation": 1783771200,          # same instant, epoch seconds — the publish
                                       # epoch a consumer can compare cheaply
    "intel": ["AAPL", "NVDA", ...],
    "fund":  ["AAPL", "NVDA", ...],
    "opts":  ["AAPL", ...],
    "ohlc":  ["AAPL", "BTC-USD", ...]    # .json (OHLC bars)
  }

The write is ATOMIC (tmp file + os.replace in the same directory). Two reasons,
both real: a reader must never see a half-written index, and the deploy stages
public/data as a HARDLINK farm (`cp -al` in ops/terminal-build.sh) — an in-place
truncating write from the staged build would have written through the shared
inode into the LIVE coverage.json. os.replace leaves the other link untouched.

Usage:
  python scripts/build_data_coverage.py [--data-dir terminal/public/data]
"""

import argparse
import datetime
import json
import os
import sys
from pathlib import Path

SUFFIXES = {
    "intel": ".intel.json",
    "fund":  ".fund.json",
    "opts":  ".opts.json",
    "ohlc":  ".json",          # plain <SYM>.json = OHLC bars
}

# Files in public/data/ that are NOT symbol files (fixtures, manifests, …)
NON_SYMBOL_FILES = {
    "manifest.json",
    "coverage.json",
    "chain_heat_fixture.json",
    "ctx_fixture.json",
    "dte_fixture.json",
    "enrich_fixture.json",
    "flow_fixture.json",
    "gex_fixture.json",
    "gexstate_fixture.json",
    "matrix_fixture.json",
    "oiconf_fixture.json",
    "prophet_fixture.json",
    "prophet_marks_fixture.json",
    "screener_fixture.json",
    "tctx_fixture.json",
    "ticker_fixture.json",
    "tide_fixture.json",
    "vol_fixture.json",
    "seed.js",
}


def write_atomic(out_path: Path, text: str) -> None:
    """Write via a sibling temp file + os.replace — never in place.

    In place would (a) let a reader see a truncated index and (b) write THROUGH the
    deploy's `cp -al` hardlink into the live public/data. os.replace creates a new
    inode in the same directory and swaps it in with a single rename.
    """
    tmp_path = out_path.with_name(out_path.name + ".tmp")
    with open(tmp_path, "w") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_path, out_path)


def collect(data_dir: Path) -> dict:
    result: dict[str, list[str]] = {k: [] for k in SUFFIXES}

    if not data_dir.is_dir():
        print(f"[warn] data directory not found: {data_dir}", file=sys.stderr)
        return result

    for path in sorted(data_dir.iterdir()):
        name = path.name
        if name in NON_SYMBOL_FILES:
            continue

        for key, suffix in SUFFIXES.items():
            if key == "ohlc":
                # plain .json but not insider/slice/fund/intel/opts
                if (
                    name.endswith(".json")
                    and not name.endswith(".insider.json")
                    and not name.endswith(".slice.json")
                    and not name.endswith(".fund.json")
                    and not name.endswith(".intel.json")
                    and not name.endswith(".opts.json")
                ):
                    sym = name[:-5]
                    result["ohlc"].append(sym)
            else:
                if name.endswith(suffix):
                    sym = name[: -len(suffix)]
                    result[key].append(sym)

    return result


def main():
    parser = argparse.ArgumentParser(description="Build data/coverage.json")
    parser.add_argument(
        "--data-dir",
        default=os.path.join(
            os.path.dirname(__file__), "..", "terminal", "public", "data"
        ),
        help="Path to public/data directory (default: terminal/public/data relative to repo root)",
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir).resolve()
    if not data_dir.is_dir():
        # Nothing to describe, so write NOTHING. The old behaviour emitted an index with every
        # list empty and a fresh `as_of` — i.e. a freshly-stamped claim that no symbol has any
        # artifact — which the client trusts and pre-seeds from. `terminal/public/data` is not
        # tracked in git, so that is exactly what a clean clone produced. Skipping is safe: with
        # no index the client falls back to runtime absence, which costs requests but hides
        # nothing. Exit 0 so `npm run build` still works on a fresh checkout.
        print(f"[coverage] data directory not found: {data_dir} — nothing written", file=sys.stderr)
        return 0

    coverage = collect(data_dir)
    now = datetime.datetime.now(datetime.timezone.utc)
    coverage["as_of"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    # The publish epoch, as an integer. `as_of` is what the client's freshness gate parses;
    # `generation` is the cheap equality check for "is this the same index I already read".
    coverage["generation"] = int(now.timestamp())

    write_atomic(data_dir / "coverage.json", json.dumps(coverage, indent=2))
    print(
        f"[coverage] wrote {data_dir / 'coverage.json'} — "
        f"intel:{len(coverage['intel'])} fund:{len(coverage['fund'])} "
        f"opts:{len(coverage['opts'])} ohlc:{len(coverage['ohlc'])} "
        f"generation:{coverage['generation']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
