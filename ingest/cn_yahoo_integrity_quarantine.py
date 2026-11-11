"""Receipt-bound withdrawal of contradictory historical mainland Yahoo observations.

Only the envelope payload and its digest may change. Every withdrawal is derived
from qualified immutable source bytes, never from a candidate's quarantine marker.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ingest.cn_yahoo_fallback import (FIELDS, PERIOD_ARRAYS, QUARANTINE_KEY,
    QUARANTINE_POLICY, _metadata, _finite, qualify_source, quarantine_provider_period,
    source_family, statement_column, valid_symbol, yahoo_owned_sections)
from ingest.collect_reported_ownership import atomic_json
from ingest.regional_financial_projection import (FIELD, canonical_projection,
    materialize_regional_fund, projection)

WITHHELD_ACTUALS = ("eps_a", "rev_a", "surp_pct")


def same(first, second):
    """Typed, order-preserving equality; a boolean is not a financial number."""
    return canonical_projection(first) == canonical_projection(second)


def bound_receipts(ticker, statements, receipt_root):
    """Reconstruct each owned column from its exact, fully qualified raw receipts."""
    proofs, qualified = {}, {}
    root = Path(receipt_root)
    for basis in ("annual", "quarterly"):
        block = (statements or {}).get(basis)
        if not block:
            continue
        ends = block.get("period_end") or []
        if len(set(ends)) != len(ends):
            raise ValueError("duplicate retained period")
        for key in ("periods", *PERIOD_ARRAYS):
            if not isinstance(block.get(key), list) or len(block[key]) != len(ends):
                raise ValueError("retained period metadata is misaligned")
        for section in FIELDS:
            values = block.get(section) or {}
            entries = (block.get("period_provenance") or {}).get(section) or []
            if (not isinstance(values, dict) or not isinstance(entries, list)
                    or len(entries) != len(ends)
                    or any(not isinstance(arr, list) or len(arr) != len(ends)
                           for arr in values.values())):
                raise ValueError("retained section is misaligned")
        for index, end in enumerate(ends):
            current = statement_column(block, index)
            owned = yahoo_owned_sections(current)
            if not owned:
                continue
            original = copy.deepcopy(current)
            evidence = {}
            for section, receipt in owned.items():
                identity = receipt["raw_input_sha256"]
                if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{64}", identity):
                    raise ValueError("invalid immutable source identity")
                if identity not in qualified:
                    path = root / ticker / (identity + ".json")
                    if not path.is_file() or path.is_symlink():
                        raise ValueError(f"immutable source receipt unavailable for {end}")
                    raw = path.read_bytes()
                    if hashlib.sha256(raw).hexdigest() != identity:
                        raise ValueError(f"immutable source receipt changed for {end}")
                    qualified[identity] = (*qualify_source(raw, ticker), str(path))
                payload, observations, digest, path = qualified[identity]
                family = source_family(payload["info"])
                metadata = _metadata(end, basis, family=family)
                if (digest != identity or receipt.get("acquired_at") != payload["fetched_at"]
                        or receipt.get("source_period_type") != ("12M" if basis == "annual" else "3M")
                        or receipt.get("scope") != "vendor_reported_unverified"):
                    raise ValueError(f"immutable receipt provenance mismatch for {end}")
                for key in ("periods", *PERIOD_ARRAYS):
                    if not same(block[key][index], metadata[key]):
                        raise ValueError(f"immutable receipt period convention mismatch: {basis}.{end}.{key}")
                source = observations[basis].get(end, {}).get(section)
                if not source:
                    raise ValueError(f"immutable receipt lacks retained section: {basis}.{end}.{section}")
                fields = current["blocks"][section]
                if set(source) - set(fields):
                    raise ValueError("retained section omitted an acquired observation")
                if any(field not in FIELDS[section] and value is not None for field, value in fields.items()):
                    raise ValueError("retained section claims an unmapped observation")
                original["blocks"][section] = {field: source.get(field) for field in fields}
                original["provenance"][section].pop(QUARANTINE_KEY, None)
                evidence[section] = {"raw_input_sha256": identity, "acquired_at": payload["fetched_at"],
                                     "source_period_type": receipt["source_period_type"],
                                     "receipt_path": path}
            authorized = copy.deepcopy(original)
            marker = quarantine_provider_period(authorized)
            already = any(QUARANTINE_KEY in receipt for receipt in owned.values())
            if already:
                if marker is None or not same(current, authorized):
                    raise ValueError(f"retained quarantine disagrees with its immutable receipt: {basis}.{end}")
            elif not same(current, original):
                raise ValueError(f"retained observation differs from its immutable receipt: {basis}.{end}")
            proofs[(basis, end)] = {"index": index, "sections": list(owned),
                                    "before": current, "after": authorized,
                                    "marker": marker, "new": marker is not None and not already,
                                    "evidence": evidence}
    return proofs


def _authorized_repair(previous_raw, ticker, receipt_root):
    if (not valid_symbol(ticker) or not isinstance(previous_raw, dict)
            or previous_raw.get("ticker") != ticker or FIELD not in previous_raw):
        raise ValueError("artifact identity or qualified projection is missing")
    before = materialize_regional_fund(copy.deepcopy(previous_raw), ticker)
    proofs = bound_receipts(ticker, before.get("statements"), receipt_root)
    selected = copy.deepcopy(before)
    withdrawn, actuals, marked = [], [], {}
    for (basis, end), proof in proofs.items():
        if not proof["new"]:
            continue
        index, column = proof["index"], proof["after"]
        block = selected["statements"][basis]
        marked[basis + ":" + end] = proof["marker"]
        for section in proof["sections"]:
            for field, value in column["blocks"][section].items():
                old = block[section][field][index]
                if not same(old, value):
                    if not _finite(old) or value is not None:
                        raise ValueError("authorized mask contains a non-withdrawal")
                    withdrawn.append({"basis": basis, "period_end": end, "section": section, "field": field})
                block[section][field][index] = value
            block["period_provenance"][section][index] = copy.deepcopy(column["provenance"][section])
        # Only actuals carrying this exact income origin are dependents. An independent
        # estimate, another provider's actual or unrelated row metadata remains intact.
        if "income" in proof["sections"]:
            series = "fy" if basis == "annual" else "q"
            for row in (selected.get("earnings") or {}).get(series) or []:
                if (row.get("end") != end or not same(row.get("actuals_provenance"),
                                                     proof["before"]["provenance"]["income"])):
                    continue
                for field in WITHHELD_ACTUALS:
                    if field in row and row[field] is not None:
                        if not _finite(row[field]):
                            raise ValueError("dependent actual is not finite")
                        row[field] = None
                        actuals.append({"series": series, "period_end": end, "field": field})
                row["actuals_provenance"] = copy.deepcopy(column["provenance"]["income"])
    candidate = copy.deepcopy(previous_raw)
    if marked:
        encoded = json.dumps(projection(selected), separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        candidate[FIELD]["payload_json"] = encoded
        candidate[FIELD]["payload_sha256"] = hashlib.sha256(encoded.encode()).hexdigest()
    report = {"ticker": ticker, "withdrawn_observations": len(withdrawn),
              "withheld_actuals": len(actuals), "marked_periods": sorted(marked),
              "compatibility_base": candidate[FIELD]["base_sha256"], "bound_receipts": len(proofs),
              "withdrawn_periods": {key: {"rules": marker["rules"],
                  "withdrawn_observations": marker["withdrawn_observations"]}
                  for key, marker in sorted(marked.items())},
              "policy": QUARANTINE_POLICY, "complete_materialized_delta_verified": True,
              "complete_outer_delta_verified": True}
    return candidate, selected, report


def validate_quarantine_scope(previous_raw, candidate_raw, ticker, receipt_root):
    """Check the entire raw and selected documents against the receipt-derived mask."""
    expected, selected, report = _authorized_repair(previous_raw, ticker, receipt_root)
    actual = materialize_regional_fund(copy.deepcopy(candidate_raw), ticker)
    if not same(actual, selected):
        raise ValueError("correction changes the selected document outside the receipt-authorized mask")
    if not same(candidate_raw, expected):
        raise ValueError("correction changes the raw document outside the receipt-authorized mask")
    return report


def repair_document(previous_raw, ticker, receipt_root):
    """Return the exact authorized candidate; input and compatibility view are untouched."""
    candidate, selected, report = _authorized_repair(previous_raw, ticker, receipt_root)
    if not same(materialize_regional_fund(copy.deepcopy(candidate), ticker), selected):
        raise ValueError("corrected projection does not materialize to the authorized document")
    return candidate, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fund", required=True, help="already-published artifact or directory to correct")
    parser.add_argument("--receipt-root", required=True, help="immutable data/cn_yahoo/_receipts root")
    parser.add_argument("--out", required=True, help="separate candidate directory; never served data")
    args = parser.parse_args(argv)
    target, out = Path(args.fund), Path(args.out)
    if out.resolve() == (target if target.is_dir() else target.parent).resolve():
        parser.error("candidate output must be separate from the input directory")
    counts = {"corrected": 0, "unchanged": 0, "errors": 0}
    pending = []
    for path in sorted(target.glob("*.fund.json")) if target.is_dir() else [target]:
        symbol = path.name.removesuffix(".fund.json")
        try:
            previous = json.loads(path.read_text())
            candidate, report = repair_document(previous, symbol, args.receipt_root)
            pending.append((path.name, candidate))
            counts["corrected" if report["withdrawn_observations"] else "unchanged"] += 1
            print(json.dumps({"ticker": symbol, **report}), flush=True)
        except (OSError, ValueError, TypeError) as exc:
            counts["errors"] += 1
            print(json.dumps({"ticker": symbol, "status": "held", "error_type": type(exc).__name__,
                              "error": str(exc)[:160]}), flush=True)
    # No output from a partially validated batch may be mistaken for a complete repair.
    if not counts["errors"]:
        for name, candidate in pending:
            atomic_json(out / name, candidate)
    print(json.dumps({"summary": counts}), flush=True)
    return 1 if counts["errors"] or not pending else 0


if __name__ == "__main__":
    raise SystemExit(main())
