"""Stamp every published OHLC document with its canonical 2D/3D session anchor.

The chart buckets daily sessions into 2D/3D bars in the browser. The phase of that grid is a
property of the symbol's session calendar counted from its IPO — it is NOT derivable from the
truncated feed the browser holds, and inventing it there is how the chart and the Golden Oracle
ended up disagreeing about which sessions share a 3D bar. ``ingest/session_anchor.py`` documents
the contract; this is the pass that publishes it.

WHERE IT RUNS
    ``ops/terminal-data``, after the LAST OHLC writer (``refresh_crypto_ohlc.py``) and before
    ``gen_slices_all.py``. Every writer ahead of it either rebuilds a document from scratch
    (build_universe / backfill_ohlc / build_macro_symbols / fetch_fred_daily /
    refresh_crypto_ohlc) or mutates ``bars`` in place and preserves unknown keys
    (refresh_ohlc), so one pass at the end leaves the whole published universe stamped.
    ``tests/test_nightly_wiring.py`` pins the seam — an unwired producer is invisible from
    inside the app.

WHAT IT TOUCHES
    Only ``<SYM>.json`` OHLC documents (a top-level ``bars`` list). Sidecars — ``.slice.json``,
    ``.intel.json``, ``.fund.json``, ``.opts.json``, ``.insider.json``, ``manifest.json``,
    ``coverage.json`` — are skipped by name. Writes are atomic and happen only when the anchor
    actually changed, so a re-run over a stamped universe is a no-op.

Usage:
    python3 ingest/stamp_session_anchors.py [--data-dir DIR] [--limit N] [--dry-run]
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

CA_ROOT = Path(__file__).resolve().parents[1]
if str(CA_ROOT) not in sys.path:
    sys.path.insert(0, str(CA_ROOT))

from ingest.session_anchor import FIELD, stamp  # noqa: E402

DEFAULT_OUT = CA_ROOT / "terminal" / "public" / "data"

# Sidecar documents that live in the same directory and are not OHLC.
SIDECAR_SUFFIXES = (
    ".slice.json", ".intel.json", ".fund.json", ".opts.json",
    ".insider.json", ".backtest.json",
)
# Directory-level documents that are not per-symbol.
NON_SYMBOL = {"manifest.json", "coverage.json", "washout_history.json", "washout.json"}


def _arg(flag: str, default: str | None = None) -> str | None:
    if flag in sys.argv:
        try:
            return sys.argv[sys.argv.index(flag) + 1]
        except IndexError:
            pass
    return default


def is_ohlc_document(path: Path) -> bool:
    """True when this filename is a per-symbol OHLC document (``<SYM>.json``)."""
    name = path.name
    if name in NON_SYMBOL or name.startswith("_"):
        return False
    return not any(name.endswith(sfx) for sfx in SIDECAR_SUFFIXES)


def main() -> int:
    out = Path(_arg("--data-dir") or os.environ.get("TERMINAL_DATA_DIR") or DEFAULT_OUT)
    dry = "--dry-run" in sys.argv
    limit = int(_arg("--limit") or 0)

    if not out.is_dir():
        print(f"[stamp_session_anchors] no data dir at {out} — nothing to do")
        return 0

    t0 = time.time()
    n_seen = n_write = n_same = n_skip = 0
    by_basis: dict[str, int] = {}

    for jf in sorted(out.glob("*.json")):
        if not is_ohlc_document(jf):
            continue
        if limit and n_seen >= limit:
            break
        n_seen += 1
        sym = jf.stem
        try:
            doc = json.loads(jf.read_text())
        except Exception as exc:
            print(f"[stamp_session_anchors] {sym}: unreadable ({exc}) — skip")
            n_skip += 1
            continue
        if not isinstance(doc, dict) or not doc.get("bars"):
            n_skip += 1
            continue
        changed = stamp(doc, sym)
        basis = (doc.get(FIELD) or {}).get("basis")
        if basis:
            by_basis[basis] = by_basis.get(basis, 0) + 1
        if not changed:
            n_same += 1
            continue
        n_write += 1
        if dry:
            continue
        tmp = jf.with_suffix(jf.suffix + ".anchor.tmp")
        tmp.write_text(json.dumps(doc, separators=(",", ":")))
        os.replace(tmp, jf)

    bases = " ".join(f"{k}={v}" for k, v in sorted(by_basis.items())) or "none"
    print(f"[stamp_session_anchors] {n_seen} OHLC docs | stamped {n_write} | unchanged {n_same} "
          f"| skipped {n_skip} | basis {bases} | {time.time() - t0:.1f}s"
          + (" | DRY-RUN" if dry else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
