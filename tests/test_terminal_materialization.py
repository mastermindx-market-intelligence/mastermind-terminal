"""Boundary tests for the existing nightly's read-only Data OS file adapter."""
import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from ingest import dataos_materialization as adapter
from ingest.polygon_bars import merge_refresh

OWNER = b'''API_VERSION = "dataos.terminal_yahoo_materialization.v1"
def bind_terminal_yahoo_materialization(document, **kwargs):
    return {"status": "bound", "view": {"document": document, "inputs": kwargs}, "refusal_reasons": []}
'''
IDENTITY = b'''class VendorAliasTable:
    @classmethod
    def from_records(cls, records):
        return records
def parse_listing_key(value):
    return value
'''


def trees(tmp_path):
    terminal, macro = tmp_path / "terminal", tmp_path / "macro"
    for name in adapter.PRODUCER_FILES:
        p = terminal / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"# actual installed source: " + name.encode())
    for name, raw in zip(adapter.OWNER_FILES, (OWNER, IDENTITY)):
        p = macro / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw)
    reference = macro / "data/reference"
    reference.mkdir(parents=True)
    pd.DataFrame([
        {"vendor": "store", "vendor_symbol": "ZQXA", "security_id": "SEC:FIXTURE", "valid_to": None},
        {"vendor": "yahoo_fetch", "vendor_symbol": "ZQXA", "security_id": "SEC:FIXTURE", "valid_to": None},
        {"vendor": "yahoo", "vendor_symbol": "OLD", "security_id": "SEC:HISTORICAL", "valid_to": None},
    ]).to_parquet(reference / "vendor_aliases.parquet", index=False)
    pd.DataFrame([{"security_id": "SEC:FIXTURE", "listing_key": "US-XNAS-ZQXA", "valid_to": None}]).to_parquet(
        reference / "security_master.parquet", index=False)
    return terminal, macro


def test_loads_actual_bytes_without_package_shadowing_or_writes(tmp_path):
    terminal, macro = trees(tmp_path)
    before = {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    search_path = list(sys.path)
    context = adapter.load_materialization_context(terminal, macro)
    document = {"t": "ZQXA", "bars": []}
    bound = context.bind(document)
    assert bound["status"] == "bound" and bound["view"]["document"] is document
    inputs = bound["view"]["inputs"]
    assert {r["vendor"] for r in inputs["alias_table"]} == {"store", "yahoo_fetch"}
    assert all(r["valid_to"] is None for r in inputs["alias_table"])
    assert inputs["master_records"][0]["valid_to"] is None
    assert sys.path == search_path
    assert {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before
    for version, base, names in ((inputs["owner_version"], macro, adapter.OWNER_FILES),
                                 (inputs["producer_version"], terminal, adapter.PRODUCER_FILES)):
        assert version["commit"] is None
        assert version["files_sha256"] == {name: hashlib.sha256((base / name).read_bytes()).hexdigest() for name in names}
    ref = inputs["reference"]
    assert ref["generation_id"] is None and ref["generation_attested"] is False
    assert set(ref["files_sha256"]) == set(adapter.REFERENCE_FILES)


def test_no_configured_owner_does_not_search_other_roots(monkeypatch, tmp_path):
    monkeypatch.delenv("MACRO_REPO", raising=False)
    assert adapter.load_materialization_context(tmp_path).bind({})["refusal_reasons"] == ["MATERIALIZATION_OWNER_UNAVAILABLE"]


@pytest.mark.parametrize("failure", ["missing-owner", "wrong-api", "broken-reference"])
def test_owner_and_reference_failures_stay_typed(tmp_path, failure):
    terminal, macro = trees(tmp_path)
    owner = macro / adapter.OWNER_FILES[0]
    if failure == "missing-owner":
        owner.unlink()
    elif failure == "wrong-api":
        owner.write_bytes(OWNER.replace(b".v1", b".v999"))
    else:
        (macro / "data/reference/vendor_aliases.parquet").write_bytes(b"not parquet")
    reasons = {"missing-owner": "MATERIALIZATION_OWNER_UNAVAILABLE",
               "wrong-api": "MATERIALIZATION_OWNER_VERSION_UNSUPPORTED",
               "broken-reference": "MATERIALIZATION_REFERENCE_UNAVAILABLE"}
    result = adapter.load_materialization_context(terminal, macro).bind({})
    assert result == {"status": "refused", "view": None, "refusal_reasons": [reasons[failure]]}


def test_reference_change_during_read_cannot_be_bound(monkeypatch, tmp_path):
    terminal, macro = trees(tmp_path)
    read = adapter._bytes
    counts = {}
    def changing(path, limit):
        raw = read(path, limit)
        counts[path] = counts.get(path, 0) + 1
        return raw + b"changed" if path.name == "vendor_aliases.parquet" and counts[path] > 1 else raw
    monkeypatch.setattr(adapter, "_bytes", changing)
    assert adapter.load_materialization_context(terminal, macro).refusal == "MATERIALIZATION_REFERENCE_CHANGED"


def test_reference_size_is_bounded_before_parquet_decode(monkeypatch, tmp_path):
    terminal, macro = trees(tmp_path)
    monkeypatch.setattr(adapter, "MAX_REFERENCE_BYTES", 32)
    monkeypatch.setattr(adapter.pd, "read_parquet", lambda *_: pytest.fail("oversize file reached decoder"))
    assert adapter.load_materialization_context(terminal, macro).refusal == "MATERIALIZATION_REFERENCE_UNAVAILABLE"


def test_code_hashes_describe_installed_bytes_not_a_newer_checkout(monkeypatch, tmp_path):
    (tmp_path / ".gitsrc/.git").mkdir(parents=True)
    sha = "d" * 40
    def git(command, **_):
        data = (sha + "\n").encode() if "rev-parse" in command else b"new checkout code"
        return SimpleNamespace(stdout=data)
    monkeypatch.setattr(adapter.subprocess, "run", git)
    old = adapter._code_version(tmp_path, "fixture", {"ingest/f.py": b"old installed code"})
    current = adapter._code_version(tmp_path, "fixture", {"ingest/f.py": b"new checkout code"})
    assert old["commit"] is None and current["commit"] == sha
    assert old["files_sha256"]["ingest/f.py"] == hashlib.sha256(b"old installed code").hexdigest()


def test_loaded_module_executes_the_hashed_bytes_not_a_later_file(tmp_path):
    p = tmp_path / "stdlib_leaf.py"
    raw = b"from dataclasses import dataclass\n@dataclass\nclass Value:\n    content: str = 'hashed version'\n"
    p.write_bytes(b"raise RuntimeError('later disk contents')\n")
    module = adapter._load_leaf(p, raw)
    assert module.Value().content == "hashed version"


def test_owner_exception_does_not_leak_internal_paths():
    def fail(*_, **__):
        raise ValueError("/private/owner/path: do not expose")
    context = adapter.MaterializationContext(owner=SimpleNamespace(bind_terminal_yahoo_materialization=fail),
                                             identity=SimpleNamespace(parse_listing_key=lambda x: x))
    assert context.bind({}) == {"status": "refused", "view": None,
                                "refusal_reasons": ["MATERIALIZATION_BINDING_UNAVAILABLE"]}


def direct_document():
    # Refresh owns no right to extend any direct materialization, even when
    # a new Polygon close happens to equal the Yahoo basis on overlap.
    return {"t": "ZQXA", "src": "yahoo", "o": 1, "bar_quality": "real_ohlc",
            "bars": [["2026-10-15", 100, 101, 99, 100, 1000],
                     ["2026-10-16", 100, 102, 99, 101, 1000]],
            "source_observation": {"observed_at": "2026-10-17T00:00:00Z"},
            "view": {"schema": "terminal.ohlc_view.v1", "listing": {"src": "yahoo"},
                     "contract": {"materialization": {"schema": adapter.API_VERSION}},
                     "segments": [{"from": "2026-10-15", "to": "2026-10-16", "src": "yahoo", "bar_quality": "real_ohlc"}],
                     "basis_drift": None, "suspected_breaks": [], "refusal_reasons": []}}


def test_no_change_preserves_exact_document_and_binding():
    document = direct_document()
    before = json.dumps(document)
    result, count, report = merge_refresh("ZQXA", document, [document["bars"][-1]])
    assert result is document and count == 0 and not report["basis_drift"]
    assert json.dumps(document) == before


def test_append_invalidates_binding_and_the_refusal_survives_later_refreshes():
    document = direct_document()
    before = deepcopy(document)
    changed, count, _ = merge_refresh("ZQXA", document, [["2026-10-19", 101, 103, 100, 102, 1200]])
    assert count == 1 and document == before
    assert "MATERIALIZATION_CONTENT_CHANGED" in changed["view"]["refusal_reasons"]
    assert changed["view"]["contract"] == document["view"]["contract"]
    assert changed["source_observation"] == document["source_observation"]
    again, count, _ = merge_refresh("ZQXA", changed, [["2026-10-20", 102, 104, 101, 103, 1100]])
    assert count == 1 and "MATERIALIZATION_CONTENT_CHANGED" in again["view"]["refusal_reasons"]
    unchanged, count, _ = merge_refresh("ZQXA", again, again["bars"][-1:])
    assert count == 0 and unchanged is again
