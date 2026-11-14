"""Project the public Macro glossary into the native reader.

Usage: python terminal/scripts/export_market_reference.py /path/to/macro
The supplied checkout owns validation, editorial copy, source labels and taxonomy.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("macro", type=Path)
    args = parser.parse_args()
    root = args.macro.resolve()
    sys.path.insert(0, str(root))
    from scripts import build_market_reference as owner

    source = root / "config" / "market_reference.yml"
    raw = owner.load_registry(source)
    entries = owner.validate(raw, repo_root=root)
    coverage = owner.validate_coverage_exceptions(raw, entries)
    ordered, families, _ = owner.build_view_model(entries)

    def localized(row, field, english_suffix="_en"):
        return {"en": row.get(field + english_suffix), "zh": row.get(field + "_zh")}

    terms = []
    for entry in ordered:
        terms.append({
            "id": entry["id"], "kind": entry["kind"], "family": entry["family"],
            "label": localized(entry, "label"), "aliases": localized(entry, "aliases"),
            "definition": localized(entry, "short_definition"), "why": localized(entry, "why_it_matters"),
            "basis": localized(entry, "unit_or_basis"), "caveats": localized(entry, "caveats"),
            "up": localized(entry, "interpretation_up"), "down": localized(entry, "interpretation_down"),
            "neutral": localized(entry, "interpretation_neutral"), "status": entry["status"],
            "successor": entry.get("superseded_by"), "search": entry["search_key"],
            "owners": [{"path": v["href"], "label": localized(v, "label")} for v in entry["owner_refs"]],
            "sources": entry["public_source_refs"], "related": entry["related_ids"],
        })
    product = {
        "registrySha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "families": [{"id": f["id"], "label": localized(f, "label")} for f in families],
        "terms": terms,
        "coverage": [{
            "label": localized(c, "element"), "reason": localized(c, "reason"),
            "surface": localized(c, "surface_label"), "state": c["state"],
            "related": [entry["id"] for entry in c["see"]],
        } for c in owner.build_coverage_view_model(coverage, entries)],
    }
    output = Path(__file__).resolve().parents[1] / "lib/market-reference/registry.generated.json"
    output.write_text(json.dumps(product, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
