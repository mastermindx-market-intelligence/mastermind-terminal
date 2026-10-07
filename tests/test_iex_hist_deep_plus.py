from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "scripts" / "iex_hist_deep_plus.py"
SPEC = importlib.util.spec_from_file_location("iex_hist_deep_plus", MODULE_PATH)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)


def catalog():
    return {
        "20261001": [
            {
                "date": "20261001",
                "feed": "DEEP",
                "version": "1.0",
                "protocol": "IEXTP1",
                "size": "900",
                "link": "https://example.test/deep",
            },
            {
                "date": "20261001",
                "feed": "DPLS",
                "version": "1.0",
                "protocol": "IEXTP1",
                "size": "1000",
                "link": "https://example.test/dpls1",
            },
        ],
        "20261002": [
            {
                "date": "20261002",
                "feed": "DPLS",
                "version": "1.0",
                "protocol": "IEXTP1",
                "size": "1200",
                "link": "https://example.test/dpls2",
            }
        ],
    }


def test_dpls_is_selected_separately_from_deep():
    rows = mod.feed_objects(catalog(), "DPLS")
    assert [row.date for row in rows] == ["20261001", "20261002"]
    assert all(row.feed == "DPLS" for row in rows)


def test_latest_dpls_selection():
    row = mod.select_object(catalog(), "DPLS", "latest")
    assert row.date == "20261002"
    assert row.size == 1200


def test_explicit_date_accepts_dashes():
    row = mod.select_object(catalog(), "DPLS", "2026-10-01")
    assert row.date == "20261001"


def test_destination_is_partitioned_by_feed_year_month(tmp_path):
    row = mod.select_object(catalog(), "DPLS", "20261002")
    path = mod.destination_for(tmp_path, row)
    assert path == (
        tmp_path
        / "raw"
        / "DPLS"
        / "2026"
        / "10"
        / "20261002_IEXTP1_DPLS1.0.pcap.gz"
    )


def test_receipt_records_source_scope_and_no_key(tmp_path):
    row = mod.select_object(catalog(), "DPLS", "20261002")
    final = mod.destination_for(tmp_path, row)
    final.parent.mkdir(parents=True)
    final.write_bytes(b"x" * 1200)
    receipt = mod.receipt_path_for(final)

    mod.write_receipt(row, final, receipt, "abc123", reused=False)
    payload = json.loads(receipt.read_text())

    assert payload["schema"] == "mastermind.iex_hist_acquisition.v1"
    assert payload["product"] == "DEEP+"
    assert payload["scope"] == "IEX venue only"
    assert payload["api_key_required"] is False
    assert payload["expected_size_bytes"] == 1200
    assert payload["actual_size_bytes"] == 1200


def test_capacity_guard_fails_closed(monkeypatch, tmp_path):
    usage = type("Usage", (), {"total": 1000, "used": 900, "free": 100})()
    monkeypatch.setattr(mod.shutil, "disk_usage", lambda _: usage)
    try:
        mod.ensure_capacity(tmp_path, required_bytes=60, reserve_bytes=50)
    except SystemExit as exc:
        assert "Insufficient free space" in str(exc)
    else:
        raise AssertionError("capacity guard should fail closed")
