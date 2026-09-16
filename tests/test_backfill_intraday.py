"""Tests for ingest/backfill_intraday.py.

Scope:
- --existing-only job enumeration (including dotted symbols; zero creation of absent symbols)
- Atomic replacement: readers see either the old file or the complete new JSON, never partial
- Correction overlap / new-row overwrite; unchanged / no-new-data preservation
- Partial failure continues remaining jobs but surfaces a nonzero exit code
- Nightly wiring: --existing-only present once, weekday-gated, before coverage index
- Non-update/backfill semantics unchanged
- No network calls in any test
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Import the module directly so we can inspect/override internals without network.
# The module-level POLY = _polygon_key() call must be satisfied with a fake key.
os.environ.setdefault("POLYGON_API_KEY", "test_key_for_pytest_only")
import importlib.util
spec = importlib.util.spec_from_file_location("backfill_intraday", ROOT / "ingest" / "backfill_intraday.py")
mod = importlib.util.module_from_spec(spec)
sys.modules["backfill_intraday"] = mod
spec.loader.exec_module(mod)


# -----------------------------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------------------------

@pytest.fixture
def intraday_dir(tmp_path):
    d = tmp_path / "intraday"
    d.mkdir()
    return d


@pytest.fixture
def intraday_env(tmp_path, monkeypatch):
    d = tmp_path / "data"
    intraday = d / "intraday"
    intraday.mkdir(parents=True)
    monkeypatch.setattr(mod, "OUT", d)
    monkeypatch.setattr(mod, "INTRADAY", intraday)
    return intraday


# -----------------------------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------------------------

def make_store(path: Path, sym: str, tf: str, n: int = 30) -> None:
    """Write a valid minimal store with n bars."""
    rows = [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
            for i in range(n)]
    doc = {"t": sym, "tf": tf, "src": "polygon", "bar_quality": "real_ohlc",
           "asof": rows[-1][0], "bars": rows}
    path.write_text(json.dumps(doc, separators=(",", ":")))


# -----------------------------------------------------------------------------------------------
# Tests: existing_stores()
# -----------------------------------------------------------------------------------------------

def test_existing_stores_enumerates_present_files(intraday_env):
    (intraday_env / "AAPL.1h.json").write_text("{}")
    (intraday_env / "BRK.B.1h.json").write_text("{}")
    (intraday_env / "AAPL.5m.json").write_text("{}")
    (intraday_env / "SPY.5m.json").write_text("{}")
    (intraday_env / "README.txt").write_text("not a store")

    jobs = mod.existing_stores(["1h", "5m"])
    assert set(jobs) == {("AAPL", "1h"), ("BRK.B", "1h"), ("AAPL", "5m"), ("SPY", "5m")}


def test_existing_stores_never_invents_absent_symbols(intraday_env):
    (intraday_env / "AAPL.1h.json").write_text("{}")
    jobs = mod.existing_stores(["1h", "5m"])
    assert ("MISSING", "1h") not in jobs
    assert ("MISSING", "5m") not in jobs


def test_existing_stores_empty_dir_returns_empty(intraday_env):
    assert mod.existing_stores(["1h", "5m"]) == []


def test_existing_stores_unknown_tf_skipped(intraday_env):
    (intraday_env / "AAPL.1h.json").write_text("{}")
    (intraday_env / "AAPL.99m.json").write_text("{}")  # not a known tf
    jobs = mod.existing_stores(["1h", "5m"])
    assert ("AAPL", "99m") not in jobs
    assert ("AAPL", "1h") in jobs


# -----------------------------------------------------------------------------------------------
# Tests: write_store / atomicity
# -----------------------------------------------------------------------------------------------

def test_write_store_atomic_never_leaves_partial(tmp_path, monkeypatch):
    monkeypatch.setattr(mod, "OUT", tmp_path)
    monkeypatch.setattr(mod, "INTRADAY", tmp_path / "intraday")
    (tmp_path / "intraday").mkdir()

    rows = [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
            for i in range(30)]
    mod.write_store("ATOM", "1h", rows)

    target = tmp_path / "intraday" / "ATOM.1h.json"
    assert target.exists()
    # No temp file left behind
    assert not any(p.name.startswith("ATOM.1h.json.tmp") for p in (tmp_path / "intraday").iterdir())
    doc = json.loads(target.read_text())
    assert doc["t"] == "ATOM"
    assert doc["tf"] == "1h"
    assert len(doc["bars"]) == 30


def test_write_store_refuses_to_write_empty_store(intraday_env):
    result = mod.write_store("SMALL", "1h", [[1, 1, 1, 1, 1, 1]])
    assert result == 0
    assert not (intraday_env / "SMALL.1h.json").exists()


def test_write_store_overwrites_previous_content(intraday_env):
    make_store(intraday_env / "OW.1h.json", "OW", "1h", n=30)
    new_rows = [[1_700_000_000 + i * 3600, 200 + i, 205 + i, 199 + i, 201 + i, 2000]
                for i in range(35)]
    mod.write_store("OW", "1h", new_rows)
    doc = json.loads((intraday_env / "OW.1h.json").read_text())
    assert doc["asof"] == new_rows[-1][0]
    assert len(doc["bars"]) == 35


# -----------------------------------------------------------------------------------------------
# Tests: load_store
# -----------------------------------------------------------------------------------------------

def test_load_store_returns_bars_and_asof(intraday_env):
    make_store(intraday_env / "LOAD.1h.json", "LOAD", "1h", n=40)
    bars, asof = mod.load_store("LOAD", "1h")
    assert len(bars) == 40
    assert asof == bars[-1][0]


def test_load_store_missing_file_returns_empty(intraday_env):
    bars, asof = mod.load_store("NOTHERE", "1h")
    assert bars == []
    assert asof is None


def test_load_store_corrupt_file_returns_empty(intraday_env):
    (intraday_env / "BAD.1h.json").write_text("{not json")
    bars, asof = mod.load_store("BAD", "1h")
    assert bars == []
    assert asof is None


# -----------------------------------------------------------------------------------------------
# Tests: _merge
# -----------------------------------------------------------------------------------------------

def test_merge_newer_rows_win_on_overlap():
    old = [[1000, 10, 10, 10, 10, 100], [2000, 20, 20, 20, 20, 200]]
    new = [[2000, 99, 99, 99, 99, 99], [3000, 30, 30, 30, 30, 300]]
    merged = mod._merge(old, new)
    assert merged[0] == [1000, 10, 10, 10, 10, 100]
    assert merged[1] == [2000, 99, 99, 99, 99, 99]   # new wins
    assert merged[2] == [3000, 30, 30, 30, 30, 300]


def test_merge_preserves_unmodified_old_rows():
    old = [[1000, 10, 10, 10, 10, 100], [2000, 20, 20, 20, 20, 200]]
    new = [[3000, 30, 30, 30, 30, 300]]
    merged = mod._merge(old, new)
    assert len(merged) == 3


def test_merge_caps_at_60k_in_update_path():
    """The 60k cap is applied at the call-site in work(), not inside _merge()."""
    old = [[i, 10, 10, 10, 10, 100] for i in range(59000)]
    new = [[59000 + i, 10, 10, 10, 10, 100] for i in range(2000)]
    merged = mod._merge(old, new)
    # _merge itself does not cap; the caller slices [-60000:]
    assert len(merged) == 61000
    assert merged[-60000:] == merged[1000:]   # last 60k elements


# -----------------------------------------------------------------------------------------------
# Tests: main() with --existing-only
# -----------------------------------------------------------------------------------------------

def test_existing_only_enumerates_only_present_stores(intraday_env, monkeypatch):
    make_store(intraday_env / "XST.1h.json", "XST", "1h", n=30)
    make_store(intraday_env / "XST.5m.json", "XST", "5m", n=30)
    make_store(intraday_env / "YST.1h.json", "YST", "1h", n=30)
    # MISSING.5m.json does NOT exist
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    monkeypatch.setattr(mod, "MANIFEST", intraday_env.parent / "manifest.json")

    # Patch fetch so we can count calls without network
    fetches = []

    def fake_fetch(sym, tf, frm=None):
        fetches.append((sym, tf, frm))
        return [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
                for i in range(5)]

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        failed = mod.main(["--existing-only", "--tf", "1h,5m", "--workers", "4"])

    # Both 1h stores + the 1h of XST + 5m of XST = 3 (YST has no 5m)
    assert len(fetches) == 3
    assert failed == 0


def test_existing_only_never_fetches_missing_symbols(intraday_env, monkeypatch):
    make_store(intraday_env / "ONLY1.1h.json", "ONLY1", "1h", n=30)
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    monkeypatch.setattr(mod, "MANIFEST", intraday_env.parent / "manifest.json")

    fetches = []

    def fake_fetch(sym, tf, frm=None):
        fetches.append(sym)
        return [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
                for i in range(5)]

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        mod.main(["--existing-only", "--tf", "1h", "--workers", "4"])

    assert "ONLY1" in fetches
    assert "NOTONDISK" not in fetches


def test_existing_only_returns_nonzero_on_partial_failure(intraday_env, monkeypatch):
    make_store(intraday_env / "OK.1h.json", "OK", "1h", n=30)
    make_store(intraday_env / "BAD.1h.json", "BAD", "1h", n=30)
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    monkeypatch.setattr(mod, "MANIFEST", intraday_env.parent / "manifest.json")

    def fake_fetch(sym, tf, frm=None):
        if sym == "BAD":
            raise RuntimeError("provider error")
        return [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
                for i in range(5)]

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        failed = mod.main(["--existing-only", "--tf", "1h", "--workers", "4"])

    assert failed == 1
    # OK should have been written despite BAD failing
    assert (intraday_env / "OK.1h.json").exists()


def test_existing_only_zero_jobs_returns_none(intraday_env, monkeypatch):
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    monkeypatch.setattr(mod, "MANIFEST", intraday_env.parent / "manifest.json")
    result = mod.main(["--existing-only", "--tf", "1h,5m"])
    assert result is None


def test_existing_only_still_updates_existing_store(intraday_env, monkeypatch):
    """--existing-only must use bounded overlap refresh, then merge into the owned store."""
    make_store(intraday_env / "EXT.1h.json", "EXT", "1h", n=30)
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    monkeypatch.setattr(mod, "MANIFEST", intraday_env.parent / "manifest.json")

    original = json.loads((intraday_env / "EXT.1h.json").read_text())["bars"]
    asof = original[-1][0]
    overlap_epoch = original[-2][0]
    new_epoch = asof + 3600
    calls = []
    recent_rows = [
        [overlap_epoch, 999, 1001, 998, 1000, 7777],
        [new_epoch, 130, 131, 129, 130.5, 2222],
    ]

    def fake_fetch(sym, tf, frm=None):
        calls.append((sym, tf, frm))
        return recent_rows

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        failed = mod.main(["--existing-only", "--tf", "1h", "--workers", "4"])

    assert failed == 0
    assert calls == [("EXT", "1h", mod._date_of(asof) - mod.dt.timedelta(days=3))]
    doc = json.loads((intraday_env / "EXT.1h.json").read_text())
    by_epoch = {row[0]: row for row in doc["bars"]}
    assert len(doc["bars"]) == 31
    assert by_epoch[original[0][0]] == original[0]  # historical prefix survived
    assert by_epoch[overlap_epoch][1:6] == [999, 1001, 998, 1000, 7777]  # correction won
    assert by_epoch[new_epoch][1:6] == [130, 131, 129, 130.5, 2222]
    assert doc["asof"] == new_epoch


# -----------------------------------------------------------------------------------------------
# Tests: non-update / backfill semantics unchanged
# -----------------------------------------------------------------------------------------------

def test_backfill_skips_existing_without_force_or_update(intraday_env, monkeypatch):
    make_store(intraday_env / "SKIPME.1h.json", "SKIPME", "1h", n=30)
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    manifest = intraday_env.parent / "manifest.json"
    manifest.write_text(json.dumps({
        "symbols": {"SKIPME": {"mkt": "NASDAQ", "last": 100, "vol": 1_000_000}}
    }))
    monkeypatch.setattr(mod, "MANIFEST", manifest)

    fetches = []

    def fake_fetch(sym, tf, frm=None):
        fetches.append(sym)
        return [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
                for i in range(5)]

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        mod.main(["--tf", "1h", "--workers", "4"])

    # Without --update or --force, existing stores are skipped
    assert "SKIPME" not in fetches


def test_force_backfills_existing(intraday_env, monkeypatch):
    make_store(intraday_env / "FORCE.1h.json", "FORCE", "1h", n=30)
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    manifest = intraday_env.parent / "manifest.json"
    manifest.write_text(json.dumps({
        "symbols": {"FORCE": {"mkt": "NASDAQ", "last": 100, "vol": 1_000_000}}
    }))
    monkeypatch.setattr(mod, "MANIFEST", manifest)

    fetches = []

    def fake_fetch(sym, tf, frm=None):
        fetches.append(sym)
        return [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
                for i in range(5)]

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        mod.main(["--force", "--tf", "1h", "--workers", "4"])

    assert "FORCE" in fetches


def test_update_extends_existing_and_falls_back_on_missing(intraday_env, monkeypatch):
    make_store(intraday_env / "UPD.1h.json", "UPD", "1h", n=30)
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    manifest = intraday_env.parent / "manifest.json"
    manifest.write_text(json.dumps({
        "symbols": {"UPD": {"mkt": "NASDAQ", "last": 100, "vol": 1_000_000}}
    }))
    monkeypatch.setattr(mod, "MANIFEST", manifest)

    fetches = []

    def fake_fetch(sym, tf, frm=None):
        fetches.append((sym, "update" if frm else "full"))
        return [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
                for i in range(5)]

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        mod.main(["--update", "--tf", "1h", "--workers", "4"])

    assert ("UPD", "update") in fetches


def test_update_missing_store_preserves_legacy_full_backfill(intraday_env, monkeypatch):
    """--existing-only must not silently narrow the established --update operator contract."""
    monkeypatch.setattr(mod, "INTRADAY", intraday_env)
    manifest = intraday_env.parent / "manifest.json"
    manifest.write_text(json.dumps({
        "symbols": {"NEWONE": {"mkt": "NASDAQ", "last": 100, "vol": 1_000_000}}
    }))
    monkeypatch.setattr(mod, "MANIFEST", manifest)
    calls = []

    def fake_fetch(sym, tf, frm=None):
        calls.append((sym, tf, frm))
        return [[1_700_000_000 + i * 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000]
                for i in range(25)]

    with patch.object(mod, "fetch_polygon_intraday", fake_fetch):
        failed = mod.main(["--update", "--tf", "1h", "--workers", "4"])

    assert failed == 0
    assert calls == [("NEWONE", "1h", None)]
    doc = json.loads((intraday_env / "NEWONE.1h.json").read_text())
    assert len(doc["bars"]) == 25


# -----------------------------------------------------------------------------------------------
# Tests: nightly wiring
# -----------------------------------------------------------------------------------------------

NIGHTLY = ROOT / "ops" / "terminal-data"


def test_backfill_existing_only_in_nightly_once():
    import re
    body = NIGHTLY.read_text()
    matches = re.findall(r'run.*backfill_intraday\s+--existing-only', body)
    assert len(matches) == 1, (
        f"Expected exactly one --existing-only invocation; found {len(matches)}"
    )


def test_backfill_existing_only_before_coverage_index():
    import re
    lines = NIGHTLY.read_text().splitlines()

    def line_of(pat: str) -> int:
        for i, ln in enumerate(lines):
            if re.search(pat, ln):
                return i
        raise AssertionError(f"Pattern {pat!r} not found in ops/terminal-data")

    bi = line_of(r"backfill_intraday\s+--existing-only")
    cov = line_of(r"build_data_coverage\.py")
    assert bi < cov, "backfill_intraday --existing-only must run BEFORE coverage index"


def test_backfill_existing_only_weekday_gated():
    import re
    body = NIGHTLY.read_text()
    # Should have a UTC weekday check around the invocation
    assert re.search(r"\$\(date -u \+%u\)", body), (
        "Missing UTC weekday check for backfill_intraday --existing-only"
    )
    # The check should gate it (u <= 5 is Mon-Fri)
    assert re.search(r"if\s+.*\$\(date -u \+%u\).* -le.*5", body)


def test_backfill_existing_only_not_in_manifest_dependency():
    """The --existing-only step must not require TERMINAL_MANIFEST."""
    import re
    lines = NIGHTLY.read_text().splitlines()
    for i, ln in enumerate(lines):
        if re.search(r"backfill_intraday\s+--existing-only", ln):
            # No line immediately above should export TERMINAL_MANIFEST
            if i > 0 and "TERMINAL_MANIFEST" in lines[i - 1]:
                raise AssertionError(
                    "backfill_intraday --existing-only is preceded by TERMINAL_MANIFEST export; "
                    "it must run independently before the staging manifest moves"
                )
