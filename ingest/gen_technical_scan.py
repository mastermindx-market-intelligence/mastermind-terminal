#!/usr/bin/env python3
"""Project the published 3D confluence slices into ONE compact screener scan generation.

    $PY ingest/gen_technical_scan.py [--data-dir DIR] [--limit N] [--budget-seconds S] [--now T]

WHAT IT IS. The Screener reads one bounded document, ``/data/scan/technical.json``
(``mastermind.screener_scan/v1``, family ``technical`` v1, the contract frozen in
``terminal/lib/screenerScan.ts`` + ``terminal/lib/technicalScan.ts``), instead of fetching one
OHLC file per ticker (AC-E01-04). This file writes that document.

WHAT IT IS NOT. It computes no signal, score, rank or indicator value. Every observed row is
a verbatim allow-list projection of the ``indicator`` block an incumbent slice writer
(``gen_slices_all`` / ``regen_flagship_slices`` / ``build_polygon_universe``) already published
into ``<SYM>.slice.json``. A slice that cannot state a qualified completed-bar ``cutoff`` (for
example the intraday ``fast_flagship`` projection, which is forming and carries none) is
published as ``unsupported/cutoff_unqualified`` — the falsifier is that the screen says
"unsupported", never that it infers a cutoff. The only reads outside the slice are the
manifest (the requested universe) and, for names WITHOUT a slice, the OHLC file's own
``bar_quality`` and session count, so the "why is there no value" reason is a fact rather
than a guess.

COVERAGE. Every manifest key gets exactly one row, so ``rows.length == universe.count`` and the
consumer's evaluated + stale + unsupported + unavailable sum equals the requested universe
(AC-E01-02). Names the run did not reach (``--limit`` / ``--budget-seconds``) are
``unavailable/not_processed`` and the generation is ``complete: false``.

PUBLICATION. The same adoption rule the client applies (``adoptGeneration``, mirrored in
``adopt_generation`` below) guards the atomic replace: an incomplete generation never
replaces a complete one, and nothing older or equal replaces what is held (AC-E01-03). Every
run, published or not, writes ``scan/technical.receipt.json`` saying what it decided and why.
Both writes are tmp + fsync + ``os.replace`` — ``public/data`` is a hardlink farm after a
deploy, so an in-place write would write THROUGH the link.

Runs as a script from the nightly (``ops/terminal-data``), so ``sys.path[0]`` is ``ingest/``;
the house bootstrap below puts the repo root on the path before the package imports.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

CA_ROOT = Path(__file__).resolve().parents[1]
if str(CA_ROOT) not in sys.path:
    sys.path.insert(0, str(CA_ROOT))

from signal_layer import SIGNAL_ERA, SIGNAL_ERA_PRE  # noqa: E402
from signal_layer.contracts import (  # noqa: E402
    CONFLUENCE_ENGINE,
    CONFLUENCE_INDICATOR_ID,
    SCHEMA_INDICATOR,
)

DEFAULT_DATA_DIR = CA_ROOT / "terminal" / "public" / "data"
SCAN_DIRNAME = "scan"
SCAN_FILENAME = "technical.json"
RECEIPT_FILENAME = "technical.receipt.json"

SCAN_SCHEMA = "mastermind.screener_scan/v1"
RECEIPT_SCHEMA = "mastermind.screener_scan_receipt/v1"
FAMILY = "technical"
FAMILY_VERSION = 1
TIMEFRAME = "3D"   # the only timeframe the slice writers produce (v1)

# The keys projected from ``indicator.state`` (terminal/lib/technicalScan.ts
# TECHNICAL_STATE_KEYS). ``extended`` is the deprecated alias of strong_bull and is never
# projected; the flagship track record (wr/pf/cagr/verdict) never enters the scan.
STATE_KEYS = (
    "position_hint", "last_signal", "last_scored_signal", "last_scored_ts",
    "last_scored_basis", "bars_since_signal", "strong_bull", "overbought",
    "weeklyBull", "above200",
)
BOOL_STATE_KEYS = ("strong_bull", "overbought", "weeklyBull", "above200")

# Restated from ingest/gen_slices_all.py (importing it would pull the whole slice builder);
# tests/test_technical_scan_producer.py pins the two sets equal.
RATE_TICKERS = {"^IRX", "^FVX", "^TNX", "^TYX"}

# The fewest daily sessions for which ``confluence.compute_signals`` can return a frame
# under ANY bar anchor (it refuses fewer than 90 3D bars; anchor 0 reaches 90 bars first).
# Below this the missing slice is a fact of history length, not a missing run. Pinned
# against the oracle by tests/test_technical_scan_producer.py.
MIN_SESSIONS = 266

# Producer reason vocabulary (terminal/lib/technicalScan.ts TECHNICAL_PRODUCER_REASONS).
REASONS = {
    "unsupported": ("rate_series", "single_value_series", "cutoff_unqualified", "not_leakfree"),
    "unavailable": ("no_ohlc", "insufficient_history", "no_slice", "slice_unreadable",
                    "not_processed"),
}
STATUS_OF = {r: s for s, rs in REASONS.items() for r in rs}

REASON_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
SIGNAL_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,31}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ── small validators (mirrors of the TS reader, so the producer never publishes a row the
#    consumer would mark malformed) ─────────────────────────────────────────────────────
def is_iso_date(v: Any) -> bool:
    if not isinstance(v, str) or not DATE_RE.match(v):
        return False
    try:
        return dt.date.fromisoformat(v).isoformat() == v
    except ValueError:
        return False


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _bool_or_none(v: Any) -> bool:
    return v is None or isinstance(v, bool)


def qualified_cutoff(raw: Any) -> dict | None:
    """The slice's own completed-bar cutoff, or None when it cannot state a qualified one.

    Read verbatim — never derived. ``bar_open`` after ``session`` is a future-bar leak and is
    refused, exactly like the consumer's ``cutoff_inverted``."""
    if not isinstance(raw, dict):
        return None
    session, bar_open = raw.get("session"), raw.get("bar_open")
    bar_closed = raw.get("bar_closed")
    if not is_iso_date(session) or not is_iso_date(bar_open) or not _bool_or_none(bar_closed):
        return None
    if bar_open > session:
        return None
    return {"session": session, "bar_open": bar_open, "bar_closed": bar_closed}


def project_state(raw: Any) -> dict | None:
    """Allow-list projection of ``indicator.state``; None when any projected key is invalid."""
    if not isinstance(raw, dict):
        return None
    out = {k: raw.get(k) for k in STATE_KEYS}
    if out["position_hint"] not in (None, "long", "flat"):
        return None
    for k in ("last_signal", "last_scored_signal"):
        v = out[k]
        if v is not None and not (isinstance(v, str) and SIGNAL_RE.match(v)):
            return None
    if out["last_scored_ts"] is not None and not is_iso_date(out["last_scored_ts"]):
        return None
    if out["last_scored_basis"] is not None and not isinstance(out["last_scored_basis"], str):
        return None
    bss = out["bars_since_signal"]
    if bss is not None and not (_is_int(bss) and bss >= 0):
        return None
    for k in BOOL_STATE_KEYS:
        if not _bool_or_none(out[k]):
            return None
    return out


def engine_key(identity: tuple[str, str, str, str | None]) -> str:
    """Stable key for one (indicator_id, engine, signal_era, source_hash) — the era leads so
    the key is readable; the digest keeps flagship and broad hashes (which legitimately
    differ) distinct."""
    digest = hashlib.sha256(json.dumps(list(identity)).encode()).hexdigest()[:8]
    return f"{identity[2]}_{digest}"


CURRENT_IDENTITY = (CONFLUENCE_INDICATOR_ID, CONFLUENCE_ENGINE, SIGNAL_ERA)


# ── per-symbol classification ───────────────────────────────────────────────────────────
def _not_observed(reason: str) -> dict:
    return {"status": STATUS_OF[reason], "reason": reason}


def _read_json(path: Path) -> Any:
    with open(path, "rb") as fh:
        return json.loads(fh.read())


def _session_count(bars: Any) -> int:
    if not isinstance(bars, list):
        return 0
    n = 0
    for b in bars:
        if isinstance(b, (list, tuple)) and len(b) > 4:
            c = b[4]
            if isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c):
                n += 1
    return n


def _safe_name(sym: str) -> bool:
    return bool(sym) and "/" not in sym and "\\" not in sym and sym not in (".", "..") \
        and "\x00" not in sym


def _no_slice_reason(data_dir: Path, sym: str) -> str:
    ohlc = data_dir / f"{sym}.json"
    if not ohlc.is_file():
        return "no_ohlc"
    try:
        d = _read_json(ohlc)
    except Exception:  # noqa: BLE001 — an unreadable OHLC file is still "no slice"
        return "no_slice"
    if not isinstance(d, dict):
        return "no_slice"
    if d.get("bar_quality") == "single_value_daily":
        return "single_value_series"
    if _session_count(d.get("bars")) < MIN_SESSIONS:
        return "insufficient_history"
    return "no_slice"


def classify_symbol(data_dir: Path, sym: str) -> tuple[dict, tuple | None]:
    """One observation for ``sym`` and, when observed, its engine identity.

    Reason order is part of the contract: a design-level ``unsupported`` outranks a missing
    file, and a slice that exists but cannot state a qualified cutoff is unsupported rather
    than guessed at."""
    if sym in RATE_TICKERS:
        return _not_observed("rate_series"), None
    if not _safe_name(sym):
        return _not_observed("no_ohlc"), None
    slice_path = data_dir / f"{sym}.slice.json"
    if not slice_path.is_file():
        return _not_observed(_no_slice_reason(data_dir, sym)), None
    try:
        doc = _read_json(slice_path)
    except Exception:  # noqa: BLE001
        return _not_observed("slice_unreadable"), None
    if not isinstance(doc, dict):
        return _not_observed("slice_unreadable"), None
    ind = doc.get("indicator")
    if ind is None:
        return _not_observed("no_slice"), None
    if not isinstance(ind, dict) or ind.get("schema") != SCHEMA_INDICATOR:
        return _not_observed("slice_unreadable"), None
    if "symbol" in ind and ind.get("symbol") != sym:
        return _not_observed("slice_unreadable"), None
    if ind.get("timeframe") != TIMEFRAME:
        return _not_observed("no_slice"), None
    state_raw = ind.get("state")
    cutoff = qualified_cutoff(ind.get("cutoff"))
    if cutoff is None or (isinstance(state_raw, dict) and state_raw.get("forming")):
        # the falsifier: no qualified completed-bar cutoff ⇒ unsupported, never inferred
        return _not_observed("cutoff_unqualified"), None
    meta = ind.get("meta") if isinstance(ind.get("meta"), dict) else {}
    if meta.get("leakfree") is not True:
        return _not_observed("not_leakfree"), None
    spec = ind.get("indicator")
    if not isinstance(spec, dict):
        return _not_observed("slice_unreadable"), None
    ind_id, engine = spec.get("id"), spec.get("engine")
    era = ind.get("signal_era", SIGNAL_ERA_PRE)
    src_hash = spec.get("source_hash")
    if not (isinstance(ind_id, str) and ind_id and isinstance(engine, str) and engine
            and isinstance(era, str) and era):
        return _not_observed("slice_unreadable"), None
    if src_hash is not None and not isinstance(src_hash, str):
        return _not_observed("slice_unreadable"), None
    state = project_state(state_raw)
    if state is None:
        return _not_observed("slice_unreadable"), None
    bq = ind.get("bar_quality")
    sb = meta.get("score_basis")
    obs = {
        "status": "observed",
        "reason": "ok",
        "cutoff": cutoff,
        "engine": None,   # filled once the engine table is known
        "bar_quality": bq if isinstance(bq, str) else None,
        "score_basis": sb if sb in ("full", "partial") else None,
        "state": state,
    }
    return obs, (ind_id, engine, era, src_hash)


# ── the requested universe ──────────────────────────────────────────────────────────────
def read_universe(data_dir: Path) -> tuple[str, dict[str, dict]]:
    """``(as_of, {sym: manifest_row})``. Raises on an unreadable manifest — a scan with no
    requested universe is not a generation."""
    man = _read_json(data_dir / "manifest.json")
    if not isinstance(man, dict) or not isinstance(man.get("symbols"), dict):
        raise ValueError("manifest has no symbols map")
    as_of = man.get("as_of")
    syms = {k: (v if isinstance(v, dict) else {}) for k, v in man["symbols"].items()
            if isinstance(k, str) and k}
    return (as_of if isinstance(as_of, str) else ""), syms


# ── the generation ──────────────────────────────────────────────────────────────────────
def build_scan(data_dir: Path, now: int, limit: int = 0, budget_seconds: float = 0.0,
               clock=time.monotonic) -> dict:
    as_of, universe = read_universe(data_dir)
    started = clock()
    rows: list[dict] = []
    identities: dict[str, tuple] = {}
    uses: dict[str, int] = {}
    complete = True
    for i, sym in enumerate(sorted(universe)):
        mrow = universe[sym]
        row: dict[str, Any] = {"sym": sym}
        for k in ("mkt", "sec"):
            v = mrow.get(k)
            if isinstance(v, str) and v:
                row[k] = v
        over_limit = bool(limit) and i >= limit
        over_budget = bool(budget_seconds) and (clock() - started) > budget_seconds
        if over_limit or over_budget:
            complete = False
            obs, ident = _not_observed("not_processed"), None
        else:
            try:
                obs, ident = classify_symbol(data_dir, sym)
            except Exception:  # noqa: BLE001 — one bad file never aborts the generation
                obs, ident = _not_observed("slice_unreadable"), None
        if ident is not None:
            key = engine_key(ident)
            identities[key] = ident
            uses[key] = uses.get(key, 0) + 1
            obs["engine"] = key
        row["tf"] = {TIMEFRAME: obs}
        rows.append(row)

    # The produced timeframe points at the CURRENT engine identity; a row on any other
    # identity is shown by the consumer as stale/engine_mismatch, never pooled.
    current = sorted((k for k, ident in identities.items() if ident[:3] == CURRENT_IDENTITY),
                     key=lambda k: (-uses[k], k))
    if current:
        tf_engine = current[0]
    else:
        ident = (*CURRENT_IDENTITY, None)
        tf_engine = engine_key(ident)
        identities[tf_engine] = ident
    engines = {
        k: {"indicator_id": ident[0], "engine": ident[1], "signal_era": ident[2],
            "source_hash": ident[3]}
        for k, ident in sorted(identities.items())
    }
    return {
        "schema": SCAN_SCHEMA,
        "family": FAMILY,
        "family_version": FAMILY_VERSION,
        "generation": int(now),
        "generated_at": dt.datetime.fromtimestamp(int(now), dt.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "complete": complete,
        "universe": {"source": "manifest", "as_of": as_of, "count": len(rows)},
        "engines": engines,
        "timeframes": {TIMEFRAME: {"engine": tf_engine}},
        "rows": rows,
    }


def validate_scan(doc: Any) -> str | None:
    """Whole-document invariants the consumer enforces; None when the document is valid.
    The producer refuses to publish anything this rejects (adoption: invalid_incoming)."""
    if not isinstance(doc, dict):
        return "document_invalid"
    if doc.get("schema") != SCAN_SCHEMA:
        return "schema_unsupported"
    if doc.get("family") != FAMILY or doc.get("family_version") != FAMILY_VERSION:
        return "family_invalid"
    gen = doc.get("generation")
    if not (_is_int(gen) and gen > 0):
        return "generation_invalid"
    if not isinstance(doc.get("complete"), bool):
        return "complete_invalid"
    uni, rows = doc.get("universe"), doc.get("rows")
    if not (isinstance(uni, dict) and uni.get("source") == "manifest"
            and isinstance(uni.get("as_of"), str) and _is_int(uni.get("count"))):
        return "universe_invalid"
    if not isinstance(rows, list) or len(rows) != uni["count"]:
        return "row_count_mismatch"
    engines, tfs = doc.get("engines"), doc.get("timeframes")
    if not isinstance(engines, dict) or not engines:
        return "engines_invalid"
    if not isinstance(tfs, dict) or set(tfs) != {TIMEFRAME} \
            or tfs[TIMEFRAME].get("engine") not in engines:
        return "timeframes_invalid"
    seen: set[str] = set()
    for r in rows:
        sym = r.get("sym") if isinstance(r, dict) else None
        if not isinstance(sym, str) or not sym:
            return "row_identity_invalid"
        if sym in seen:
            return "row_identity_duplicate"
        seen.add(sym)
        tf = r.get("tf")
        obs = tf.get(TIMEFRAME) if isinstance(tf, dict) else None
        if not isinstance(obs, dict):
            return "row_observation_invalid"
        status, reason = obs.get("status"), obs.get("reason")
        if not (isinstance(reason, str) and REASON_RE.match(reason)):
            return "row_observation_invalid"
        if status == "observed":
            if reason != "ok" or obs.get("engine") not in engines \
                    or qualified_cutoff(obs.get("cutoff")) is None \
                    or project_state(obs.get("state")) is None:
                return "row_observation_invalid"
        elif STATUS_OF.get(reason) != status:
            return "row_observation_invalid"
        if doc["complete"] and reason == "not_processed":
            return "complete_with_not_processed"
    return None


# ── publication ─────────────────────────────────────────────────────────────────────────
def adopt_generation(current: dict | None, incoming: dict | None) -> tuple[bool, str]:
    """Mirror of terminal/lib/screenerScan.ts ``adoptGeneration`` — same rules, same order."""
    if incoming is None or not _is_int(incoming.get("generation")) \
            or incoming["generation"] <= 0 or not isinstance(incoming.get("complete"), bool):
        return False, "invalid_incoming"
    if current is None:
        return True, "first"
    if incoming["generation"] <= current["generation"]:
        return False, "not_newer"
    if incoming["complete"]:
        return True, "newer_complete"
    if current["complete"]:
        return False, "incomplete_over_complete"
    return True, "newer_incomplete"


def held_generation(path: Path) -> dict | None:
    """The published generation's adoption metadata, or None when nothing valid is held."""
    try:
        doc = _read_json(path)
    except Exception:  # noqa: BLE001 — absent or unreadable ⇒ nothing is held
        return None
    if validate_scan(doc) is not None:
        return None
    return {"generation": doc["generation"], "complete": doc["complete"]}


def write_atomic(path: Path, data: bytes) -> None:
    """Unique sibling temp + fsync + os.replace (never in place: public/data is hardlinked)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def encode(doc: dict) -> bytes:
    return (json.dumps(doc, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
            + "\n").encode()


def summarize(doc: dict) -> dict:
    by_status: dict[str, int] = {"observed": 0, "unsupported": 0, "unavailable": 0}
    by_reason: dict[str, dict[str, int]] = {}
    for r in doc["rows"]:
        obs = r["tf"][TIMEFRAME]
        by_status[obs["status"]] = by_status.get(obs["status"], 0) + 1
        bucket = by_reason.setdefault(obs["status"], {})
        bucket[obs["reason"]] = bucket.get(obs["reason"], 0) + 1
    return {"by_status": by_status,
            "by_reason": {s: dict(sorted(v.items())) for s, v in sorted(by_reason.items())}}


def publish(data_dir: Path, doc: dict | None, *, error: str | None = None) -> dict:
    scan_path = data_dir / SCAN_DIRNAME / SCAN_FILENAME
    held = held_generation(scan_path)
    invalid = error or (validate_scan(doc) if doc is not None else "no_document")
    if invalid:
        adopt, reason = False, "invalid_incoming"
    else:
        adopt, reason = adopt_generation(held, doc)
    payload = encode(doc) if (doc is not None and not invalid) else None
    if adopt and payload is not None:
        write_atomic(scan_path, payload)
    # What a reader of /data/scan/technical.json receives AFTER this run's decision — the
    # receipt and a real covered-root read must agree on these two (AC-E01-06).
    try:
        live_bytes = scan_path.read_bytes()
    except OSError:
        live_bytes = None
    live = held_generation(scan_path) if live_bytes is not None else None
    receipt: dict[str, Any] = {
        "schema": RECEIPT_SCHEMA,
        "family": FAMILY,
        "decision": reason,
        "published": bool(adopt),
        "error": invalid,
        "held_generation": held,
        "generation": doc.get("generation") if isinstance(doc, dict) else None,
        "generated_at": doc.get("generated_at") if isinstance(doc, dict) else None,
        "complete": doc.get("complete") if isinstance(doc, dict) else None,
        "universe": doc.get("universe") if isinstance(doc, dict) else None,
        "timeframes": doc.get("timeframes") if isinstance(doc, dict) else None,
        "sha256": hashlib.sha256(payload).hexdigest() if payload is not None else None,
        "bytes": len(payload) if payload is not None else None,
        "live_generation": live,
        "live_sha256": hashlib.sha256(live_bytes).hexdigest() if live_bytes is not None else None,
    }
    if isinstance(doc, dict) and not invalid:
        receipt.update(summarize(doc))
    write_atomic(data_dir / SCAN_DIRNAME / RECEIPT_FILENAME, encode(receipt))
    return receipt


def _parse_now(raw: str | None) -> int:
    if raw is None:
        return int(time.time())
    try:
        return int(raw)
    except ValueError:
        t = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        return int(t.timestamp())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    ap.add_argument("--limit", type=int, default=0,
                    help="process only the first N names (the rest: not_processed, incomplete)")
    ap.add_argument("--budget-seconds", type=float, default=0.0,
                    help="stop classifying after S seconds (the rest: not_processed)")
    ap.add_argument("--now", default=None, help="generation clock: epoch seconds or ISO-8601")
    args = ap.parse_args(argv)
    data_dir: Path = args.data_dir
    now = _parse_now(args.now)
    t0 = time.time()
    try:
        doc = build_scan(data_dir, now, limit=args.limit, budget_seconds=args.budget_seconds)
    except Exception as exc:  # noqa: BLE001 — no requested universe ⇒ no generation
        receipt = publish(data_dir, None, error=f"aborted:{type(exc).__name__}")
        print(f"[gen_technical_scan] ABORTED ({exc}); held={receipt['held_generation']}",
              flush=True)
        return 2
    receipt = publish(data_dir, doc)
    st = receipt.get("by_status", {})
    print(f"[gen_technical_scan] generation={receipt['generation']} "
          f"complete={receipt['complete']} rows={doc['universe']['count']} "
          f"observed={st.get('observed', 0)} unsupported={st.get('unsupported', 0)} "
          f"unavailable={st.get('unavailable', 0)} decision={receipt['decision']} "
          f"published={receipt['published']} ({time.time() - t0:.1f}s)", flush=True)
    return 0 if receipt["error"] is None else 1


if __name__ == "__main__":
    sys.exit(main())
