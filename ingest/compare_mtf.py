"""Run the existing frozen six-rule MTF study for one explicit ticker request.

Offline research only. Uses research_mtf's request, bounded-read and atomic-output
owners; it neither fetches market data nor publishes a production artifact.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from ingest.research_mtf import (MAX_DOCUMENT_BYTES, MAX_REQUEST_BYTES, read_json,
                                validate_request, write_report)
from signal_layer.mtf_screener import document_frame, screen_ticker
from signal_layer.mtf_evaluation import session_date
from signal_layer.mtf_experiments import compare_entry_rules

STUDY_REQUEST_VERSION = "terminal-mtf-single-ticker-study/v1"
HORIZONS = (5, 21, 63)
COSTS_BPS_PER_SIDE = (0, 5, 25)


def build_study(data_dir: Path, request: dict, *, holdout_start: str) -> dict:
    """Account for unavailable input before executing an immutable study recipe."""
    policy = validate_request(request)
    if len(request["tickers"]) != 1:
        raise ValueError("one explicit ticker is required for a single-ticker study")
    holdout = session_date(holdout_start)
    as_of = session_date(request["as_of"])
    if as_of >= holdout:
        raise ValueError("the study decision cutoff must precede the reserved holdout")
    if data_dir.is_symlink() or not data_dir.is_dir():
        raise ValueError("data-dir must be an explicit existing real directory")
    item = request["tickers"][0]
    result = {"schema": STUDY_REQUEST_VERSION, "status": "research_only_not_validated",
              "symbol": item["symbol"], "as_of": request["as_of"],
              "holdout_start": holdout.date().isoformat(), "holdout_status": "not_consumed",
              "source_file_sha256": None, "screen": None, "study": None,
              "production_rank_authority": False, "trade_authority": False,
              "recipe": {"preset": policy.preset, "horizons": list(HORIZONS),
                         "cost_bps_per_side": list(COSTS_BPS_PER_SIDE),
                         "min_train_years": 3, "min_train_rows": 252}}
    source = data_dir.resolve(strict=True) / f"{item['symbol']}.json"
    try:
        document, digest = read_json(source, byte_limit=MAX_DOCUMENT_BYTES)
    except FileNotFoundError:
        return {**result, "state": "missing_data"}
    except (OSError, ValueError, UnicodeError) as exc:
        return {**result, "state": "unreadable_data", "error_class": type(exc).__name__}
    result["source_file_sha256"] = digest
    result["source_digest_scope"] = "Full file bytes; screening input_sha256 binds its decision-time prefix."
    try:
        if not isinstance(document, dict) or len(document.get("bars", [])) > 25000:
            raise ValueError("a study document must contain at most 25000 daily bars")
        calendar = request.get("session_calendars", {}).get(item.get("calendar_id"))
        screen = screen_ticker(document, symbol=item["symbol"], market=item["market"],
                    as_of=request["as_of"], closed_through=item["closed_through"],
                    expected_session=item["expected_session"], policy=policy, session_calendar=calendar)
    except (ValueError, TypeError, KeyError) as exc:
        return {**result, "state": "invalid_data", "error_class": type(exc).__name__}
    result.update(state=screen["state"], screen=screen)
    if screen["state"] != "research_ready":
        return result
    daily, anchor, _ = document_frame(document, item["symbol"])
    cutoff = min(as_of, session_date(item["closed_through"]))
    # compare_entry_rules trims before both features and outcomes; future suffixes
    # cannot become training observations, trial results or model-selection evidence.
    result["study"] = compare_entry_rules(daily, bar_anchor=anchor,
         evaluation_end=cutoff, holdout_start=holdout, preset=policy.preset,
         horizons=HORIZONS, cost_bps=COSTS_BPS_PER_SIDE, min_train_years=3, min_train_rows=252)
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--holdout-start", required=True)
    args = parser.parse_args(argv)
    try:
        request, digest = read_json(args.request, byte_limit=MAX_REQUEST_BYTES)
        result = build_study(args.data_dir, request, holdout_start=args.holdout_start)
        result["request_sha256"] = digest
        artifact_digest = write_report(args.output, result, data_dir=args.data_dir, request_path=args.request)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(f"MTF comparison refused: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"status": result["status"], "symbol": result["symbol"],
                      "state": result["state"], "artifact_sha256": artifact_digest,
                      "trial_count": result["study"]["trial_count"] if result["study"] else 0,
                      "production_rank_authority": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())