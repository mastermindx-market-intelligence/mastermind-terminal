"""Evaluate one existing Terminal daily file; never collect or publish market data.

Example: python research/evaluate_returns.py --source /tmp/NVDA.json --symbol NVDA
  --through 2026-10-16 --exploratory --output /tmp/returns-nvda-research.json

The current OHLC view does not attest historical availability. Strict mode emits
a blocked report; --exploratory permits explicitly unqualified retrospective work.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from signal_layer.returns_research import HORIZONS, Procedure, evaluate  # noqa: E402


def read_inputs(source: Path, symbol: str, through: str) -> tuple[list[str], np.ndarray, dict]:
    if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", symbol):
        raise ValueError("Invalid symbol")
    if date.fromisoformat(through).isoformat() != through:
        raise ValueError("Invalid cutoff")
    with source.open("rb") as handle:
        raw = handle.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("Source exceeds 8 MiB research bound")
    doc = json.loads(raw)
    if doc.get("t") != symbol or not isinstance(doc.get("bars"), list) or len(doc["bars"]) > 30000:
        raise ValueError("Source identity or row count invalid")
    projection_path = ROOT / "terminal/lib/usEquitySessionProjection.json"
    projection_raw = projection_path.read_bytes()
    projection = json.loads(projection_raw)
    if projection.get("schema") != "mastermind.us_equity_session_projection.v1":
        raise ValueError("Existing session projection unavailable")
    if not projection["coverage"]["start"] <= through <= projection["coverage"]["end"]:
        raise ValueError("Cutoff outside the existing session owner's coverage")
    mapping: dict[str, float] = {}
    conflicts: set[str] = set()
    invalid_rows = 0
    for row in doc["bars"]:
        if not isinstance(row, list) or len(row) < 5:
            invalid_rows += 1
            continue
        day, close = row[0], row[4]
        try:
            valid_day = isinstance(day, str) and date.fromisoformat(day).isoformat() == day
        except (ValueError, TypeError):
            valid_day = False
        if not valid_day or isinstance(close, bool) or not isinstance(close, (int, float)) or not math.isfinite(close) or close <= 0:
            invalid_rows += 1
            continue
        if day > through:
            continue
        if day in mapping and mapping[day] != close:
            conflicts.add(day)
        mapping[day] = float(close)
    for day in conflicts:
        del mapping[day]
    if not mapping:
        raise ValueError("No usable closes")
    start = max(min(mapping), projection["coverage"]["start"])
    dates = [d for d in sorted(projection["sessions"]) if start <= d <= through]
    if not dates:
        raise ValueError("No supported sessions")
    closes = np.array([mapping.get(d, np.nan) for d in dates])
    view = doc.get("view") if isinstance(doc.get("view"), dict) else {}
    contract = view.get("contract") if isinstance(view.get("contract"), dict) else {}
    adjustment = contract.get("adjustment_reference") if isinstance(contract.get("adjustment_reference"), dict) else {}
    holds = ["CURRENT_VINTAGE_IS_NOT_HISTORICAL_AVAILABILITY"]
    if view.get("basis_drift") or view.get("refusal_reasons") or view.get("suspected_breaks"):
        # Exploratory does not waive a known corrupt/identity-breaking source.
        raise ValueError("The source owner refuses or flags this price basis")
    evidence = {"reference": str(source), "sha256": hashlib.sha256(raw).hexdigest(),
        "provider_label": doc.get("src"), "input_view_schema": view.get("schema"),
        "declared_adjustment_basis": adjustment.get("basis"),
        "price_basis": "unverified", "historical_availability": "current_vintage_only",
        "owner_qualification_reference": None, "holds": holds,
        "source_max_available_at": None, "first_session": dates[0], "last_session": dates[-1],
        "missing_session_closes": int(np.isnan(closes).sum()), "invalid_rows": invalid_rows,
        "conflicting_dates_removed": sorted(conflicts),
        "session_projection_sha256": hashlib.sha256(projection_raw).hexdigest(),
        "session_projection_source": projection["source"]}
    return dates, closes, evidence


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--through", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--exploratory", action="store_true")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if source == output or (ROOT / "terminal/public").resolve() in output.parents:
        parser.error("Research output cannot replace inputs or write the public data tree")
    if output.exists():
        parser.error("Output already exists; choose a distinct research artifact")
    dates, closes, evidence = read_inputs(source, args.symbol, args.through)
    report = {"schema": "returns.research_bundle.v1", "research_only": True,
        "source_commit": None, "procedure_sha256": hashlib.sha256((ROOT / "signal_layer/returns_research.py").read_bytes()).hexdigest(),
        "numpy_version": np.__version__, "procedures_evaluated": 3,
        "configuration_selection": "three predeclared horizons; one fixed feature procedure; no strategy sweep",
        "temperature_selection": "41 fixed temperatures on calibration only, repeated at the declared refit cadence",
        "market_skill_or_admission_claim": False,
        "results": [evaluate(args.symbol, dates, closes, evidence, h, exploratory=args.exploratory, spec=Procedure()) for h in HORIZONS]}
    payload = json.dumps(report, indent=2, allow_nan=False) + "\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation keeps an earlier evaluation immutable instead of overwriting it.
    with output.open("x", encoding="utf-8") as handle:
        handle.write(payload)
    print(json.dumps({"output": str(output), "sha256": hashlib.sha256(payload.encode()).hexdigest(),
        "results": [{"horizon": r["horizon"], "status": r["status"], "observations": r.get("observations", 0),
                     "folds": len(r["folds"]), "models": r["scores"]["models"] if r["scores"] else None} for r in report["results"]]}))


if __name__ == "__main__":
    main()
