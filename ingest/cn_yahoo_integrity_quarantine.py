"""Scoped, receipt-bound withdrawal of self-contradicting mainland Yahoo periods.

The coverage extension is append-only: it never revisits a period it already admitted, so
a period published before the producer-side integrity policy existed keeps displaying
contradictory vendor figures until it is explicitly withdrawn. This helper is that narrow
withdrawal, and it is not a collector, emitter or publication path.

It reads one already-published artifact plus the immutable raw receipts that artifact's own
provenance names, proves each receipt against its recorded hash and acquisition stamp, and
writes one corrected candidate. It never contacts a provider, never calculates a replacement
number, and never touches a period this extension does not own. The legacy compatibility view
and its base digest are retained byte-for-byte; only the selected projection changes, and only
by nulling observations and withholding the earnings actuals derived from them.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ingest.cn_yahoo_fallback import (CACHE_SCHEMA, FIELDS, PERIOD_ARRAYS, PROVIDER,
                                       QUARANTINE_FAMILY, QUARANTINE_KEY, QUARANTINE_ORIGIN,
                                       QUARANTINE_POLICY, rebuild_earnings, valid_symbol,
                                       withdraw_block_periods)
from ingest.collect_reported_ownership import atomic_json
from ingest.regional_financial_projection import (FIELD, KEYS, materialize_regional_fund,
                                                  projection, wrap_regional_financials)

WITHHELD_ACTUALS = ("eps_a", "rev_a", "surp_pct")
BASIS_FIELDS = ("flow_basis", "source_market", "reporting_cadence", "source_family",
                "source_family_basis")


def bound_receipts(ticker, statements, receipt_root):
    """Prove each Yahoo-owned provider-period against its own immutable source receipt.

    The receipt file's bytes must hash to exactly the identity its provenance already
    records, and its acquisition stamp must equal the one recorded for that period. A
    receipt that is absent, altered, or from a different acquisition fails closed: the
    correction may not proceed on an unproven origin.
    """
    proofs = {}
    root = Path(receipt_root)
    for basis in ("annual", "quarterly"):
        block = (statements or {}).get(basis)
        if not block:
            continue
        ends = block.get("period_end") or []
        receipts = block.get("period_provenance") or {}
        for index, end in enumerate(ends):
            for section in FIELDS:
                entry = (receipts.get(section) or [])
                if not (index < len(entry) and isinstance(entry[index], dict)):
                    continue
                receipt = entry[index]
                if (receipt.get("origin") != QUARANTINE_ORIGIN
                        or receipt.get("provider") != PROVIDER or not receipt.get("raw_input_sha256")):
                    continue
                identity = receipt["raw_input_sha256"]
                path = root / ticker / (identity + ".json")
                if not path.is_file() or path.is_symlink():
                    raise ValueError(f"immutable source receipt unavailable for {end}")
                raw = path.read_bytes()
                if hashlib.sha256(raw).hexdigest() != identity:
                    raise ValueError(f"immutable source receipt changed for {end}")
                try:
                    payload = json.loads(raw)
                except ValueError:
                    raise ValueError(f"immutable source receipt is unreadable for {end}") from None
                if (payload.get("schema") != CACHE_SCHEMA or payload.get("ticker") != ticker
                        or payload.get("fetched_at") != receipt.get("acquired_at")):
                    raise ValueError(f"immutable source receipt does not match this period's origin for {end}")
                proofs[(basis, end)] = {"raw_input_sha256": identity,
                                        "acquired_at": receipt.get("acquired_at"),
                                        "source_period_type": receipt.get("source_period_type"),
                                        "receipt_path": str(path)}
    return proofs


def repair_document(previous_raw, ticker, receipt_root):
    """Return (candidate document, report) with contradicted periods withdrawn."""
    if not valid_symbol(ticker) or (previous_raw or {}).get("ticker") != ticker:
        raise ValueError("artifact identity differs from the requested listing")
    selected = materialize_regional_fund(copy.deepcopy(previous_raw), ticker)
    proofs = bound_receipts(ticker, selected.get("statements"), receipt_root)
    repaired = copy.deepcopy(selected)
    withdrawn = {}
    for basis in ("annual", "quarterly"):
        block = (repaired.get("statements") or {}).get(basis)
        if block:
            for end, marker in withdraw_block_periods(block).items():
                withdrawn[basis + ":" + end] = marker
    repaired["earnings"] = rebuild_earnings(repaired["statements"],
                                            copy.deepcopy(repaired.get("earnings")))
    candidate = wrap_regional_financials(repaired, copy.deepcopy(previous_raw))
    report = validate_quarantine_scope(previous_raw, candidate, ticker)
    report["bound_receipts"] = len(proofs)
    report["withdrawn_periods"] = {key: {"rules": marker["rules"],
                                         "withdrawn_observations": marker["withdrawn_observations"]}
                                   for key, marker in sorted(withdrawn.items())}
    report["policy"] = QUARANTINE_POLICY
    return candidate, report


def _series_at(block, section, field, index):
    values = (block.get(section) or {}).get(field)
    return values[index] if isinstance(values, list) and index < len(values) else None


def _receipt_at(block, section, index):
    receipts = (block.get("period_provenance") or {}).get(section) or []
    return receipts[index] if index < len(receipts) and isinstance(receipts[index], dict) else {}


def _statement_withdrawals(before, after):
    """Every statement leaf the correction changed, proven to be an explicit withdrawal."""
    withdrawn, marked = [], set()
    for basis in ("annual", "quarterly"):
        old, new = (before or {}).get(basis), (after or {}).get(basis)
        if old is None and new is None:
            continue
        if old is None or new is None:
            raise ValueError("correction removed or added a statement family")
        for key in ("periods", "period_end", *PERIOD_ARRAYS, *BASIS_FIELDS):
            if old.get(key) != new.get(key):
                raise ValueError(f"correction changed statement identity {basis}.{key}")
        ends = new.get("period_end") or []
        families = new.get("source_family_by_period") or []
        for section in FIELDS:
            for index, end in enumerate(ends):
                prior, receipt = _receipt_at(old, section, index), _receipt_at(new, section, index)
                if prior != receipt:
                    family = families[index] if index < len(families) else None
                    if (QUARANTINE_KEY not in receipt or prior.get("origin") != QUARANTINE_ORIGIN
                            or family != QUARANTINE_FAMILY):
                        raise ValueError("correction rewrote source provenance outside an explicit withdrawal")
                    expected = dict(prior, **{QUARANTINE_KEY: receipt[QUARANTINE_KEY]})
                    if expected != receipt:
                        raise ValueError("correction changed a source receipt field")
                    marked.add((basis, end))
                for field in sorted(set(old.get(section) or {}) | set(new.get(section) or {})):
                    first, second = _series_at(old, section, field, index), _series_at(new, section, field, index)
                    if first == second:
                        continue
                    if (second is not None or QUARANTINE_KEY not in receipt
                            or prior.get("origin") != QUARANTINE_ORIGIN):
                        raise ValueError("correction changed an observation outside an explicit withdrawal")
                    withdrawn.append({"basis": basis, "period_end": end, "section": section, "field": field})
    return withdrawn, marked


def _earnings_withdrawals(before, after, marked):
    """Every earnings leaf the correction changed, tied to a withdrawn provider-period."""
    withdrawn = []
    for key in ("q", "fy"):
        old_rows = {row.get("end") or row.get("period"): row for row in (before or {}).get(key) or []}
        new_rows = {row.get("end") or row.get("period"): row for row in (after or {}).get(key) or []}
        if set(old_rows) != set(new_rows):
            raise ValueError("correction changed the earnings period inventory")
        for identity, old_row in old_rows.items():
            new_row = new_rows[identity]
            for field in sorted(set(old_row) | set(new_row)):
                if old_row.get(field) == new_row.get(field):
                    continue
                if field == "actuals_provenance":
                    prior = old_row.get(field) or {}
                    expected = dict(prior, **{QUARANTINE_KEY: (new_row[field] or {}).get(QUARANTINE_KEY)})
                    if expected != new_row[field] or QUARANTINE_KEY not in (new_row[field] or {}):
                        raise ValueError("correction changed an actuals provenance field")
                    continue
                if field not in WITHHELD_ACTUALS or new_row.get(field) is not None:
                    raise ValueError("correction changed an earnings field outside an explicit withdrawal")
                if not any(end == identity for _, end in marked):
                    raise ValueError("correction withheld an earnings actual for a period it did not withdraw")
                withdrawn.append({"series": key, "period_end": identity, "field": field})
    return withdrawn


def validate_quarantine_scope(previous_raw, candidate_raw, ticker):
    """Prove a correction changed only withdrawn observations and their dependents.

    The publication history validator reads the raw outer compatibility financials, which
    this correction must leave untouched. This compares the materialized selected views as
    well, so a withdrawal cannot smuggle in a restated period, currency, basis, source
    clock or synthetic value.
    """
    before, after = materialize_regional_fund(copy.deepcopy(previous_raw), ticker), \
        materialize_regional_fund(copy.deepcopy(candidate_raw), ticker)
    if (before.get("ticker"), after.get("ticker")) != (ticker, ticker):
        raise ValueError("correction identity differs from the requested listing")
    for key in ("stmt_currency", "quote_currency"):
        if before.get(key) != after.get(key):
            raise ValueError(f"correction changes the {key}")
    if previous_raw[FIELD]["base_sha256"] != candidate_raw[FIELD]["base_sha256"]:
        raise ValueError("correction changes the compatibility base digest")
    if projection(previous_raw) != projection(candidate_raw):
        raise ValueError("correction changes the legacy compatibility view")
    for key in ("src", "data_freshness"):
        if before.get(key) != after.get(key):
            raise ValueError(f"correction relabels {key}")
    statements, marked = _statement_withdrawals(before.get("statements"), after.get("statements"))
    earnings = _earnings_withdrawals(before.get("earnings"), after.get("earnings"), marked)
    return {"ticker": ticker, "withdrawn_observations": len(statements),
            "withheld_actuals": len(earnings), "marked_periods": sorted(f"{b}:{e}" for b, e in marked),
            "compatibility_base": candidate_raw[FIELD]["base_sha256"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fund", required=True, help="already-published artifact to correct")
    parser.add_argument("--receipt-root", required=True, help="immutable data/cn_yahoo/_receipts root")
    parser.add_argument("--out", required=True, help="candidate directory; never the served data directory")
    args = parser.parse_args(argv)
    counts = {"corrected": 0, "unchanged": 0, "errors": 0}
    target = Path(args.fund)
    for path in sorted(target.glob("*.fund.json")) if target.is_dir() else [target]:
        symbol = path.name.removesuffix(".fund.json")
        try:
            previous = json.loads(path.read_text())
            candidate, report = repair_document(previous, symbol, args.receipt_root)
            atomic_json(Path(args.out) / path.name, candidate)
            counts["corrected" if report["withdrawn_observations"] else "unchanged"] += 1
            print(json.dumps({"ticker": symbol, **report}), flush=True)
        except (OSError, ValueError, TypeError) as exc:
            counts["errors"] += 1
            print(json.dumps({"ticker": symbol, "status": "held", "error_type": type(exc).__name__,
                              "error": str(exc)[:160]}), flush=True)
    print(json.dumps({"summary": counts}), flush=True)
    return 1 if counts["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())