"""Publication integrity for Terminal OHLC JSON."""

import pandas as pd
import json
import pytest

from ingest.build_universe import build_ohlc_json
from ingest import build_universe as U


def test_build_ohlc_json_drops_only_zero_volume_flat_non_trading_rows():
    """Suspension placeholders are omitted without deleting a genuinely traded flat day."""
    idx = pd.to_datetime(["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24"])
    source = pd.DataFrame(
        {
            "open": [24.34, 24.56, 25.00, 26.00],
            "close": [24.56, 24.56, 25.00, 26.00],
            "high": [25.39, 24.56, 25.00, 26.00],
            "low": [24.20, 24.56, 25.00, 26.00],
            "volume": [47_735_572.0, 0.0, 10_000.0, float("nan")],
        },
        index=idx,
    )

    doc = build_ohlc_json("002155.SZ", source)

    assert [bar[0] for bar in doc["bars"]] == [
        "2026-08-19",
        "2026-08-21",
        "2026-08-24",
    ]
    assert doc["bars"][1][-1] == 10_000.0
    assert doc["bars"][2][-1] is None


@pytest.mark.parametrize("primary_present", [True, False])
def test_us_constituent_union_admits_off_index_equity_without_inventing_history(
    tmp_path, monkeypatch, primary_present,
):
    """Dossier membership must reach the existing backfill even outside the top-volume set."""
    macro = tmp_path / "macro"
    out = tmp_path / "served"
    out.mkdir()
    existing = {"name": "Existing rich row", "mkt": "NASDAQ", "sec": "Equities",
                "px": 100, "verdict": "BUY", "gics": "Existing sector"}
    manifest = {"as_of": "2026-10-14", "symbols": {"AAPL": existing}}
    (out / "manifest.json").write_text(json.dumps(manifest))
    groups = {
        "smallcap_breadth": {"SMALL": "Small company"},
        "midcap_breadth": {"MID": "Mid company"},
        "russell_breadth": {"CNDT": "Conduent Inc", "AAPL": "Do not replace"},
    }
    if primary_present:
        groups["breadth"] = {"LARGE": "Large company"}
    for group, members in groups.items():
        directory = macro / "data" / group
        directory.mkdir(parents=True)
        pd.DataFrame({"name": members, "sector": "Technology"}).to_parquet(
            directory / "constituents.parquet")
    monkeypatch.setattr(U, "MACRO", macro)
    monkeypatch.setattr(U, "OUT", out)
    monkeypatch.setattr(U, "MANIFEST", out / "manifest.json")
    monkeypatch.setattr(U, "us_exchange_map", lambda: {})
    monkeypatch.setattr(U, "_load_polygon_reference", lambda: ({}, {}))
    monkeypatch.setattr(U, "reconcile_flagship_verdicts", lambda *a: {
        "rederived": 0, "demoted": 0, "matched": 0})

    U.main(["--ohlc", "all"])

    actual = json.loads((out / "manifest.json").read_text())
    assert {"SMALL", "MID", "CNDT", "AAPL"} <= actual["symbols"].keys()
    assert actual["symbols"]["CNDT"]["name"] == "Conduent Inc"
    assert actual["symbols"]["CNDT"]["mkt"] == "US"
    assert actual["symbols"]["AAPL"] == existing
    assert "px" not in actual["symbols"]["CNDT"]
    assert actual["as_of"] == "2026-10-14"
    assert not (out / "CNDT.json").exists()


def test_us_members_keep_source_priority_and_survive_one_unreadable_group(tmp_path):
    for group, name in (("breadth", "Primary name"), ("russell_breadth", "Later name")):
        directory = tmp_path / "data" / group
        directory.mkdir(parents=True)
        pd.DataFrame({"name": {"SAME": name}, "sector": "Technology"}).to_parquet(
            directory / "constituents.parquet")
    broken = tmp_path / "data" / "smallcap_breadth"
    broken.mkdir()
    (broken / "constituents.parquet").write_bytes(b"not parquet")
    members = U.load_us_members(tmp_path)
    assert list(members.index) == ["SAME"]
    assert members.loc["SAME", "name"] == "Primary name"
