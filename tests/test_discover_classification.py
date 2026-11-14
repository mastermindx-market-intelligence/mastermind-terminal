"""Discover's live classification fault: statement enrichment cannot erase profile lineage.

Exercise actual producers, with independent source dates; no network or live writes.
"""
from copy import deepcopy

import pandas as pd
import pytest

from ingest import build_universe as universe
from ingest import gen_classification_scan as scan
from ingest import gen_fund_us as fund


def record(sector="Technology", **profile):
    return {"asof": "2026-11-13", "src": {"statements": "yfinance+massive", "cache_fetched_at": "2026-11-01T12:00:00Z"},
            "profile": {"sector": sector, "industry": "Semiconductors", **profile}}


def cells(rec, label="Information Technology", observed=None):
    lane = scan.LANE_OF_STATEMENTS.get(rec["src"]["statements"])
    return scan.classify_sectors(lane, rec, "ok", label, observed)


def test_exact_statement_alias_preserves_the_profile_lane():
    original = record()
    original["src"]["statements"] = "yfinance"
    assert cells(original) == cells(record())
    assert cells(record())["yahoo_sector"]["status"] == "evaluated"
    unknown = record()
    unknown["src"]["statements"] = "yfinance+unverified"
    assert cells(unknown)["yahoo_sector"]["reason"] == "lane_unrecognized"


def test_legacy_emission_date_and_new_source_date_have_distinct_contracts():
    assert cells(record())["yahoo_sector"]["as_of"] == "2026-11-13"
    assert cells(record(sector_asof="2026-11-01"))["yahoo_sector"]["as_of"] == "2026-11-01"
    undated = cells(record(sector_asof=None))["yahoo_sector"]
    assert (undated["status"], undated["reason"], undated["as_of"]) == ("stale", "record_undated", None)


@pytest.mark.parametrize("observed", ["2026-11-01", None])
def test_newer_gics_reference_is_not_replaced_by_older_or_undated_profile(observed):
    value = cells(record("Financials", sector_asof=observed), observed="2026-11-13")["gics_sector"]
    assert (value["label"], value["as_of"], value["source"]) == ("Information Technology", "2026-11-13", "manifest_gics")
    assert "reclassified_from" not in value


def test_reclassification_requires_a_supported_temporal_direction():
    value = cells(record("Financials", sector_asof="2026-11-14"), observed="2026-11-13")["gics_sector"]
    assert value["reclassified_from"] == "Information Technology"
    assert value["label"] == "Financials"
    assert "reclassified_from" not in cells(record("Financials"))["gics_sector"]


def test_field_specific_yahoo_provenance_resolves_shared_vocabulary():
    assert cells(record("Energy"))["yahoo_sector"]["reason"] == "taxonomy_ambiguous"
    assert cells(record("Energy", sector_source="yfinance", sector_asof="2026-11-12"))["yahoo_sector"]["status"] == "evaluated"


def test_industry_source_and_date_are_independent_of_sector():
    rec = record("Information Technology", sector_source="site_profile", sector_asof=None,
                 industry_source="yfinance", industry_asof="2026-11-12")
    value = cells(rec)["yahoo_industry"]
    assert (value["status"], value["as_of"]) == ("evaluated", "2026-11-12")
    rec["profile"]["industry_asof"] = None
    assert cells(rec)["yahoo_industry"]["reason"] == "record_undated"
    rec["profile"]["industry_source"] = "site_profile_sic"
    assert cells(rec)["yahoo_industry"]["reason"] == "taxonomy_not_supplied"


def test_profile_builder_dates_only_the_branch_that_supplied_each_field():
    cache = {"info": {"sector": "Technology"}, "fetched_at": "2026-11-12T16:00:00Z"}
    site = {"profile": {"sector": "Information Technology", "sic_description": "Semiconductors"}}
    profile = fund.build_profile(cache, site)
    assert (profile["sector_source"], profile["sector_asof"]) == ("yfinance", "2026-11-12")
    assert (profile["industry_source"], profile["industry_asof"]) == ("site_profile_sic", None)
    cache["info"] = {"industry": "Semiconductors"}
    profile = fund.build_profile(cache, site)
    assert (profile["sector_source"], profile["sector_asof"]) == ("site_profile", None)
    assert (profile["industry_source"], profile["industry_asof"]) == ("yfinance", "2026-11-12")


def test_reference_replacement_keeps_value_date_pairs_and_preserves_newer_evidence():
    original = {"gics": "Technology", "gics_asof": "2026-11-12", "mcap": 100, "mcap_asof": "2026-11-12"}
    for date in (None, "2026-11-11"):
        actual = deepcopy(original)
        universe.apply_reference(actual, "Financials", 200, date)
        assert actual == original
    universe.apply_reference(original, "Financials", None, "2026-11-13")
    assert original == {"gics": "Financials", "gics_asof": "2026-11-13", "mcap": 100, "mcap_asof": "2026-11-12"}
    orphan = {"gics_asof": "2026-11-12", "mcap_asof": "2026-11-12"}
    universe.apply_reference(orphan, "Technology", 150, None)
    assert orphan == {"gics": "Technology", "mcap": 150}


def test_reference_loader_copies_source_dates_and_never_the_build_clock(monkeypatch, tmp_path):
    source = tmp_path / "reference.parquet"
    source.touch()
    monkeypatch.setattr(universe, "_REF_PARQUET", source)
    monkeypatch.setattr(pd, "read_parquet", lambda _: pd.DataFrame([
        {"gics_sector": "Information Technology", "market_cap_usd": 250, "asof": "2026-11-12"},
        {"gics_sector": "Financials", "market_cap_usd": 100, "asof": "invalid"},
    ], index=["AAA", "BBB"]))
    sector, cap, dates = universe._load_polygon_reference()
    assert sector["AAA"] == "Information Technology" and cap["AAA"] == 250
    assert dates == {"AAA": "2026-11-12"}
