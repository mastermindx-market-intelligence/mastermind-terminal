"""Retain statement observations without mixing fields from different revisions."""
from __future__ import annotations

from copy import deepcopy
import datetime as dt

FAMILIES = ("income", "balance", "cashflow")


def _dates(block):
    ends = (block or {}).get("period_end") or []
    labels = (block or {}).get("periods") or []
    if len(ends) != len(labels) or len(set(ends)) != len(ends):
        raise ValueError("statement history has ambiguous period identities")
    for end in ends:
        if not isinstance(end, str) or dt.date.fromisoformat(end).isoformat() != end:
            raise ValueError("statement history has invalid period end")
    for family in FAMILIES:
        for values in ((block or {}).get(family) or {}).values():
            if not isinstance(values, list) or len(values) != len(ends):
                raise ValueError("statement values are not aligned to period ends")
    return ends


def _observation(block, family, index):
    return {key: values[index] for key, values in (block.get(family) or {}).items()}


def _has_values(observation):
    return any(value is not None for value in observation.values())


def _provenance(block, family, index, fallback):
    rows = (block.get("period_provenance") or {}).get(family) or []
    value = rows[index] if index < len(rows) and isinstance(rows[index], dict) else fallback
    return deepcopy(value)


def merge_statement_block(fresh, previous, *, current_acquired=None, previous_acquired=None):
    """Prefer each fresh family/period as a unit; retain only missing observations.

    Retained acquisition dates stay original or unknown. In particular a missing
    fresh line item never borrows a value from a different filing revision.
    """
    fresh, previous = fresh or {}, previous or {}
    new_ends, old_ends = _dates(fresh), _dates(previous)
    ends = sorted(set(new_ends) | set(old_ends))
    if not ends:
        return None
    ni, oi = {e: i for i, e in enumerate(new_ends)}, {e: i for i, e in enumerate(old_ends)}
    labels = {e: previous["periods"][i] for e, i in oi.items()}
    labels.update({e: fresh["periods"][i] for e, i in ni.items()})
    result = {"periods": [labels[e] for e in ends], "period_end": ends, "period_provenance": {}}
    for family in FAMILIES:
        fields = sorted(set(fresh.get(family) or {}) | set(previous.get(family) or {}))
        observations, provenance = [], []
        for end in ends:
            new = _observation(fresh, family, ni[end]) if end in ni else {}
            old = _observation(previous, family, oi[end]) if end in oi else {}
            if _has_values(new):
                observations.append(new)
                provenance.append(_provenance(fresh, family, ni[end], {
                    "origin": "source_cache", "acquired_at": current_acquired,
                    "scope": "vendor_reported_unverified",
                }))
            elif _has_values(old):
                observations.append(old)
                meta = _provenance(previous, family, oi[end], {
                    "origin": "retained_history", "acquired_at": previous_acquired,
                    "scope": "legacy_unknown",
                })
                meta["origin"] = "retained_history"
                provenance.append(meta)
            else:
                observations.append({})
                provenance.append({"origin": "unavailable", "acquired_at": None, "scope": "unknown"})
        result[family] = {field: [row.get(field) for row in observations] for field in fields}
        result["period_provenance"][family] = provenance
    return result


def merge_statement_history(fresh, previous):
    """Merge only same-contract, same-listing, same-reporting-currency histories."""
    if not previous:
        previous = {}
    if previous:
        for key in ("schema", "ticker", "stmt_currency"):
            if not fresh.get(key) or fresh.get(key) != previous.get(key):
                raise ValueError(f"cannot retain statements across changed {key}")
        new_source = (fresh.get("src") or {}).get("statements")
        old_source = (previous.get("src") or {}).get("statements")
        if not new_source or new_source != old_source:
            raise ValueError("cannot merge different statement source conventions")
    new_statements, old_statements = fresh.get("statements") or {}, previous.get("statements") or {}
    result = deepcopy(fresh)
    result["statements"] = {
        basis: merge_statement_block(
            new_statements.get(basis), old_statements.get(basis),
            current_acquired=(fresh.get("src") or {}).get("cache_fetched_at"),
            previous_acquired=(previous.get("src") or {}).get("cache_fetched_at"),
        ) for basis in ("annual", "quarterly")
    }
    return result
