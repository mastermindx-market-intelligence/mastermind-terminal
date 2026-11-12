"""Tests for the Massive `stocks/financials/v1` statements backfill (#364).

The old `vX/reference/financials` endpoint answers 410 since its 2026-10-09 sunset, and the
nightly never ran the backfill, so production fund.json carried ~5 yfinance periods. These pin
the migration to the three per-statement v1 endpoints and the merge contract it feeds:

  1. MAPPING. v1 rows are FLAT (no nested blocks, no {value} cells). `total_operating_expenses`
     EXCLUDES cost of revenue, matching yfinance's "Operating Expense"; derived fields are
     derived only when every input is stated.
  2. LABELS. The vendor's own fiscal_year / fiscal_quarter key each column. gen_fund_us's
     date arithmetic mis-buckets 52/53-week periods that close on the 1st of a month (AAPL
     Q3 FY2017 ended 2017-07-01; WEN FY2022 ended 2023-01-01) and would collapse two real
     periods into one column. It stays the fallback.
  3. JOIN. Three endpoints → one row per period end within the live registrant; the vendor's
     rare duplicate labels for one period (CULP, PBT) resolve to one column.
  4. MERGE. Prepend older periods, never overwrite a non-null value, the later filing wins on
     a clash, a set the label-keyed merge cannot carry is left exactly as emitted.
  5. KEY SAFETY + FAILURE. The key travels only in an Authorization header fed on curl's
     stdin; a 410 / 404 / 401 leaves every fund.json byte-identical and the run returns
     without raising.

The tests use the SAME module objects the driver imports (`massive_financials`, top-level,
via the driver's sys.path bootstrap) — `ingest.massive_financials` would be a second copy
with its own exception classes, which the driver would not catch.
"""
from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

import ingest.backfill_fund_statements_massive as bf

mf = importlib.import_module("massive_financials")  # the object bf itself imported
assert bf.fetch_batch is mf.fetch_batch

ROOT = Path(__file__).resolve().parents[1]
BACKFILL = ROOT / "ingest" / "backfill_fund_statements_massive.py"
FAKE_KEY = "test-key-Zq81"  # a synthetic value; asserted absent from every output

CIK = "0000320193"

# AAPL FY2025 line items as the v1 endpoints name them.
INC = {
    "revenue": 416_161_000_000.0,
    "cost_of_revenue": 220_960_000_000.0,
    "gross_profit": 195_201_000_000.0,
    "total_operating_expenses": 62_151_000_000.0,
    "operating_income": 133_050_000_000.0,
    "total_other_income_expense": -321_000_000.0,
    "income_before_income_taxes": 132_729_000_000.0,
    "income_taxes": 20_719_000_000.0,
    "net_income_loss_attributable_common_shareholders": 112_010_000_000.0,
    "consolidated_net_income_loss": 112_010_000_000.0,
    "basic_earnings_per_share": 7.49,
    "diluted_earnings_per_share": 7.46,
    "ebitda": 144_748_000_000.0,
}
BAL = {
    "total_assets": 359_241_000_000.0,
    "total_current_assets": 147_957_000_000.0,
    "total_liabilities": 285_508_000_000.0,
    "total_current_liabilities": 165_631_000_000.0,
    "total_equity_attributable_to_parent": 73_733_000_000.0,
    "total_equity": 73_733_000_000.0,
    "debt_current": 20_329_000_000.0,
    "long_term_debt_and_capital_lease_obligations": 78_328_000_000.0,
    "cash_and_equivalents": 35_934_000_000.0,
}
CFS = {
    "net_cash_from_operating_activities": 111_482_000_000.0,
    "cash_from_operating_activities_continuing_operations": 111_482_000_000.0,
    "net_cash_from_investing_activities": 15_195_000_000.0,
    "net_cash_from_financing_activities": -120_686_000_000.0,
    "purchase_of_property_plant_and_equipment": -12_715_000_000.0,
}
FIELDS = {"income": INC, "balance": BAL, "cashflow": CFS}


# ── fixtures shaped like the live v1 payload ─────────────────────────────────
def vrow(block, end, fy, fq=4, filed="2025-10-31", tf="annual", cik=CIK, tickers=("AAPL",), **over):
    """One flat v1 row for one statement endpoint. A field overridden to None is absent."""
    row = {
        "tickers": list(tickers),
        "cik": cik,
        "period_end": end,
        "filing_date": filed,
        "fiscal_year": fy,
        "fiscal_quarter": fq,
        "timeframe": tf,
    }
    row.update(FIELDS[block])
    row.update(over)
    return {k: v for k, v in row.items() if v is not None}


def jrow(end, fy, fq=4, filed="2025-10-31", tf="annual", inc=None, bal=None, cfs=None):
    """A joined row (one period, three statements) built through the real join."""
    by_block = {
        "income": [vrow("income", end, fy, fq, filed, tf, **(inc or {}))],
        "balance": [vrow("balance", end, fy, fq, filed, tf, **(bal or {}))],
        "cashflow": [vrow("cashflow", end, fy, fq, filed, tf, **(cfs or {}))],
    }
    (row,) = mf.join_statements(by_block)
    return row


def annual(y, revenue=None, filed=None, end=None):
    return jrow(end or f"{y}-09-26", y, 4, filed or f"{y}-10-30", "annual",
                inc={} if revenue is None else {"revenue": revenue})


def existing_set():
    """A yfinance-emitted annual set: two periods, one null hole (2025 net income)."""
    return {
        "periods": ["2024", "2025"],
        "period_end": ["2024-09-30", "2025-09-30"],
        "income": {"revenue": [391_035_000_000.0, 416_161_000_000.0], "net_income": [93_736_000_000.0, None]},
        "balance": {"assets": [364_980_000_000.0, 359_241_000_000.0]},
        "cashflow": {"cfo": [118_254_000_000.0, 111_482_000_000.0]},
    }


# ── 1. mapping ───────────────────────────────────────────────────────────────
def test_flat_v1_line_items_map_onto_the_contract_keys():
    m = mf.map_row(jrow("2025-09-27", 2025))
    inc, bal, cfs = m["income"], m["balance"], m["cashflow"]
    assert inc["revenue"] == 416_161_000_000.0
    assert inc["cogs"] == 220_960_000_000.0
    assert inc["op_income"] == 133_050_000_000.0
    assert inc["nonop_income"] == -321_000_000.0
    assert inc["pretax_income"] == 132_729_000_000.0
    assert inc["taxes"] == 20_719_000_000.0
    assert inc["net_income"] == 112_010_000_000.0
    assert (inc["eps_basic"], inc["eps_diluted"]) == (7.49, 7.46)
    assert bal["assets_lt"] == 359_241_000_000.0 - 147_957_000_000.0
    assert bal["liab_lt"] == 285_508_000_000.0 - 165_631_000_000.0
    assert bal["equity"] == 73_733_000_000.0
    assert bal["cash"] == 35_934_000_000.0
    assert cfs["cfo"] == 111_482_000_000.0
    assert cfs["cfi"] == 15_195_000_000.0
    assert cfs["cff"] == -120_686_000_000.0
    assert cfs["capex"] == -12_715_000_000.0          # an outflow, kept negative
    assert cfs["fcf"] == 111_482_000_000.0 - 12_715_000_000.0


def test_opex_excludes_cogs_and_reconciles_to_operating_income():
    inc = mf.map_row(jrow("2025-09-27", 2025))["income"]
    assert inc["opex"] == 62_151_000_000.0
    assert inc["gross_profit"] - inc["opex"] == inc["op_income"]


def test_rows_defined_differently_from_yfinance_stay_null_even_when_the_vendor_states_them():
    """v1 total debt has no lease line and its EBITDA is another definition; stitched onto the
    yfinance columns either would show a level shift that is not in the business."""
    row = jrow("2025-09-27", 2025)
    st = row["statements"]
    assert st["income"]["ebitda"] and st["balance"]["debt_current"] is not None
    m = mf.map_row(row)
    for block, fields in mf.UNCOVERED.items():
        for f in fields:
            assert m[block][f] is None, (block, f)
    assert mf.statement_coverage() == {"income": ["ebitda"], "balance": ["debt", "net_debt"],
                                       "cashflow": []}


def test_zero_cash_flow_is_kept_not_treated_as_missing():
    cfs = mf.map_row(jrow("2025-09-27", 2025, cfs={
        "net_cash_from_operating_activities": 0.0,
        "cash_from_operating_activities_continuing_operations": 5.0,
    }))["cashflow"]
    assert cfs["cfo"] == 0.0
    assert cfs["fcf"] == -12_715_000_000.0


def test_a_positive_capex_outflow_reads_as_null_and_takes_fcf_with_it():
    """CULP fiscal Q2 2025: v1 serves capex +1,671,000 against cfo 3,097,000. Flipping the
    sign would invent a figure; keeping it would report fcf 4.77M instead of ~1.4M."""
    cfs = mf.map_row(jrow("2024-10-27", 2025, cfs={
        "net_cash_from_operating_activities": 3_097_000.0,
        "purchase_of_property_plant_and_equipment": 1_671_000.0,
    }))["cashflow"]
    assert cfs["cfo"] == 3_097_000.0
    assert cfs["capex"] is None and cfs["fcf"] is None
    zero = mf.map_row(jrow("2024-10-27", 2025, cfs={
        "net_cash_from_operating_activities": 3_097_000.0,
        "purchase_of_property_plant_and_equipment": 0.0,
    }))["cashflow"]
    assert zero["capex"] == 0.0 and zero["fcf"] == 3_097_000.0


def test_fallbacks_apply_only_when_the_primary_line_is_absent():
    m = mf.map_row(jrow(
        "2025-09-27", 2025,
        inc={"net_income_loss_attributable_common_shareholders": None, "consolidated_net_income_loss": 9.0},
        bal={"total_equity_attributable_to_parent": None, "total_equity": 8.0},
        cfs={"net_cash_from_operating_activities": None,
             "cash_from_operating_activities_continuing_operations": 7.0},
    ))
    assert m["income"]["net_income"] == 9.0
    assert m["balance"]["equity"] == 8.0
    assert m["cashflow"]["cfo"] == 7.0


def test_a_missing_statement_maps_to_all_nulls_with_every_contract_key_present():
    full = mf.map_row(jrow("2025-09-27", 2025))
    bare = mf.map_row({"period_end": "2025-09-27", "statements": {}})
    for block in bf.BLOCKS:
        assert set(bare[block]) == set(full[block])
        assert all(v is None for v in bare[block].values())


def test_non_numeric_and_non_finite_cells_read_as_null():
    inc = mf.map_row(jrow("2025-09-27", 2025, inc={
        "revenue": "n/a", "cost_of_revenue": float("nan"), "gross_profit": True, "income_taxes": "12.5",
    }))["income"]
    assert inc["revenue"] is None and inc["cogs"] is None and inc["gross_profit"] is None
    assert inc["taxes"] == 12.5


def test_the_gapped_rows_are_disclosed_on_every_merged_period_set():
    out, _ = bf.merge_period_set(None, [annual(2020)], 9, "annual", "yfinance")
    assert out["vendor_gaps"] == mf.statement_coverage()
    assert out["income"]["ebitda"] == [None] and out["balance"]["debt"] == [None]


# ── 2. labels ────────────────────────────────────────────────────────────────
def test_vendor_label_shapes_match_the_contract():
    assert mf.vendor_label({"fiscal_year": 2025, "fiscal_quarter": 4}, "annual") == "2025"
    assert mf.vendor_label({"fiscal_year": 2026, "fiscal_quarter": 1}, "quarterly") == "Q1 '26"
    assert mf.vendor_label({"fiscal_year": "2009", "fiscal_quarter": 3}, "quarterly") == "Q3 '09"
    assert mf.vendor_label({"fiscal_year": 2026}, "quarterly") is None
    assert mf.vendor_label({"fiscal_year": 2026, "fiscal_quarter": 5}, "quarterly") is None
    assert mf.vendor_label({}, "annual") is None


def test_52_53_week_quarter_ending_on_the_first_does_not_collide():
    """AAPL fiscal Q3 2017 closed 2017-07-01; the date arithmetic calls it Q4 '17 — the label
    of the real Q4 (closed 2017-09-30). Keyed on the vendor label, both quarters survive."""
    assert bf.label_for("2017-07-01", 9, "quarterly") == "Q4 '17"
    q3 = jrow("2017-07-01", 2017, 3, "2017-08-02", "quarterly")
    q4 = jrow("2017-09-30", 2017, 4, "2017-11-03", "quarterly")
    assert bf.vendor_row_label(q3, "2017-07-01", 9, "quarterly") == "Q3 '17"
    out, _ = bf.merge_period_set(None, [q3, q4], 9, "quarterly", "yfinance")
    assert out["periods"] == ["Q3 '17", "Q4 '17"]


def test_a_53_week_year_closing_on_january_first_keeps_its_own_fiscal_year():
    """WEN's FY2022 closed 2023-01-01. Date arithmetic labels it 2023 and collides with the
    real FY2023 (closed 2023-12-31)."""
    assert bf.label_for("2023-01-01", 12, "annual") == "2023"
    fy22 = jrow("2023-01-01", 2022, filed="2023-03-01")
    fy23 = jrow("2023-12-31", 2023, filed="2024-02-28")
    out, stats = bf.merge_period_set(None, [fy22, fy23], 12, "annual", "yfinance")
    assert out["periods"] == ["2022", "2023"]
    assert stats["added"] == 2 and stats["skipped"] == 0


def test_label_falls_back_to_date_arithmetic_when_the_vendor_omits_fiscal_fields():
    row = {"period_end": "2024-12-28"}
    assert bf.vendor_row_label(row, "2024-12-28", 9, "quarterly") == bf.label_for("2024-12-28", 9, "quarterly")
    assert bf.vendor_row_label(row, "2024-09-28", 9, "annual") == "2024"


def test_fy_end_month_reads_the_newest_annual_period_end():
    assert bf.fy_end_month_from(["2023-12-31", "2024-09-28", ""]) == 9
    assert bf.fy_end_month_from([]) == 12
    assert bf.fy_end_month_from(["garbage"]) == 12


# ── 3. join ──────────────────────────────────────────────────────────────────
def test_the_three_endpoints_join_into_one_row_per_period_end():
    by_block = {
        "income": [vrow("income", "2024-09-28", 2024, filed="2024-11-01"),
                   vrow("income", "2025-09-27", 2025, filed="2025-10-31")],
        "balance": [vrow("balance", "2025-09-27", 2025, filed="2025-10-31"),
                    vrow("balance", "2024-09-28", 2024, filed="2025-10-31")],  # last re-reported later
        "cashflow": [vrow("cashflow", "2024-09-28", 2024, filed="2024-11-01")],
    }
    rows = mf.join_statements(by_block)
    assert [r["period_end"] for r in rows] == ["2024-09-28", "2025-09-27"]
    fy24, fy25 = rows
    assert set(fy24["statements"]) == {"income", "balance", "cashflow"}
    assert set(fy25["statements"]) == {"income", "balance"}       # no cash-flow row → nulls later
    assert fy24["filing_date"] == "2025-10-31"                     # public once the LAST part is
    assert mf.map_row(fy25)["cashflow"]["cfo"] is None


def test_a_reused_ticker_keeps_only_the_registrant_that_reported_last():
    """AMR: AMR Corp to 2013, Alpha Metallurgical since — never interleave two companies."""
    old = [vrow(b, "2012-12-31", 2012, cik="0000006201", filed="2013-02-20") for b in bf.BLOCKS]
    new = [vrow(b, "2023-12-31", 2023, cik="0001704715", filed="2024-02-29") for b in bf.BLOCKS]
    rows = mf.join_statements({b: [old[i], new[i]] for i, b in enumerate(bf.BLOCKS)})
    assert [r["period_end"] for r in rows] == ["2023-12-31"]
    assert rows[0]["cik"] == "0001704715"


def test_a_period_the_vendor_labels_twice_becomes_one_column():
    """CULP's quarter ended 2024-10-27 is FY2025 Q2 in the 10-Q that first reported it and
    "FY2024 Q4" in a comparative filed 20 months later. The label comes from the first filing;
    the figures from the latest."""
    first = vrow("income", "2024-10-27", 2025, 2, "2024-12-11", "quarterly", revenue=55.0)
    retag = vrow("income", "2024-10-27", 2024, 4, "2026-06-30", "quarterly", revenue=56.0)
    (row,) = mf.join_statements({"income": [retag, first], "balance": [], "cashflow": []})
    assert mf.vendor_label(row, "quarterly") == "Q2 '25"
    assert mf.map_row(row)["income"]["revenue"] == 56.0
    assert row["filing_date"] == "2026-06-30"


def test_an_implausible_fiscal_year_never_supplies_the_label():
    """PBT: a 2025-12-31 period served once as FY2023 — earlier-filed, but not plausible."""
    bad = vrow("income", "2025-12-31", 2023, filed="2026-02-01")
    good = vrow("income", "2025-12-31", 2025, filed="2026-03-01")
    (row,) = mf.join_statements({"income": [bad, good]})
    assert mf.vendor_label(row, "annual") == "2025"


# ── 4. merge contract ────────────────────────────────────────────────────────
def test_backfill_prepends_older_periods_oldest_first():
    vendor = [annual(y, revenue=float(y)) for y in range(2010, 2026)]
    out, stats = bf.merge_period_set(existing_set(), vendor, 9, "annual", "yfinance")
    assert out["periods"] == [str(y) for y in range(2010, 2026)]
    assert out["period_end"] == sorted(out["period_end"])
    assert stats["before"] == 2 and stats["total"] == 16 and stats["added"] == 14


def test_merge_never_overwrites_an_existing_value_but_does_fill_a_null_hole():
    vendor = [annual(2024, revenue=1.0), annual(2025, revenue=2.0)]
    out, stats = bf.merge_period_set(existing_set(), vendor, 9, "annual", "yfinance")
    assert out["income"]["revenue"] == [391_035_000_000.0, 416_161_000_000.0]   # yfinance kept
    assert out["income"]["net_income"] == [93_736_000_000.0, 112_010_000_000.0]  # hole filled
    assert out["income"]["cogs"] == [220_960_000_000.0, 220_960_000_000.0]       # new field filled
    assert stats["added"] == 0 and stats["filled"] == 2
    assert out["src_by_period"] == ["yfinance+massive", "yfinance+massive"]


def test_a_vendor_date_within_two_weeks_is_the_same_column_and_does_not_move_period_end():
    """yfinance normalises AAPL FY2025 to 2025-09-30; the vendor reports the true 52/53-week
    close 2025-09-27. One period, one column, the transcript join's period_end untouched."""
    out, _ = bf.merge_period_set(existing_set(), [annual(2025, end="2025-09-27")], 9, "annual", "yfinance")
    assert out["periods"] == ["2024", "2025"]
    assert out["period_end"] == ["2024-09-30", "2025-09-30"]


def test_the_date_match_wins_over_a_disagreeing_vendor_label():
    """1 of 541 date-matched quarterly columns disagreed on the label (measured 2026-10-18)."""
    existing = {"periods": ["Q1 '26"], "period_end": ["2025-12-31"], "income": {"revenue": [1.0]}}
    row = jrow("2025-12-27", 2025, 4, "2026-01-30", "quarterly")
    out, stats = bf.merge_period_set(existing, [row], 9, "quarterly", "yfinance")
    assert out["periods"] == ["Q1 '26"] and stats["added"] == 0 and stats["filled"] == 1


def test_a_label_held_by_another_period_falls_back_to_date_arithmetic_or_is_skipped():
    existing = {"periods": ["2023"], "period_end": ["2023-12-31"], "income": {"revenue": [9.0]}}
    stray = jrow("2022-12-31", 2023)  # vendor label "2023" — a different period than the column
    out, stats = bf.merge_period_set(existing, [stray], 12, "annual", "yfinance")
    assert out["periods"] == ["2022", "2023"] and stats["relabeled"] == 1
    assert out["income"]["revenue"] == [416_161_000_000.0, 9.0]   # never filled from 2022

    held = {"periods": ["2021", "2023"], "period_end": ["2021-06-30", "2023-12-31"],
            "income": {"revenue": [7.0, 9.0]}}
    stray = jrow("2021-12-31", 2023)  # vendor "2023" held; date arithmetic "2021" held too
    out, stats = bf.merge_period_set(held, [stray], 12, "annual", "yfinance")
    assert out["periods"] == ["2021", "2023"] and stats["skipped"] == 1
    assert out["income"]["revenue"] == [7.0, 9.0]


def test_the_later_filing_wins_a_clash_whatever_the_wire_order():
    original = annual(2023, revenue=383_285_000_000.0, filed="2023-11-03")
    restated = annual(2023, revenue=383_100_000_000.0, filed="2024-08-02", end="2023-09-30")
    for wire in ([original, restated], [restated, original]):
        out, _ = bf.merge_period_set(None, list(wire), 9, "annual", "yfinance")
        assert out["periods"] == ["2023"]
        assert out["income"]["revenue"] == [383_100_000_000.0]
        assert out["filed_by_period"] == ["2024-08-02"]


def test_an_older_filing_still_fills_a_field_the_later_one_omitted():
    original = annual(2023, revenue=1.0, filed="2023-11-03")
    later = jrow("2023-09-30", 2023, filed="2024-08-02",
                 inc={"revenue": 2.0, "net_income_loss_attributable_common_shareholders": None,
                      "consolidated_net_income_loss": None})
    out, _ = bf.merge_period_set(None, [original, later], 9, "annual", "yfinance")
    assert out["income"]["revenue"] == [2.0]
    assert out["income"]["net_income"] == [112_010_000_000.0]
    assert out["filed_by_period"] == ["2024-08-02"]


def test_rows_are_ordered_newest_filing_first_and_undated_rows_rank_last():
    rows = [annual(2021, filed="2021-11-01"), {**annual(2023), "filing_date": None}, annual(2022, filed="2022-11-01")]
    order = [r.get("filing_date") for r in bf.vendor_rows_newest_filing_first(rows)]
    assert order == ["2022-11-01", "2021-11-01", None]


def test_v1_never_claims_a_restatement_it_cannot_observe():
    """v1 serves the LATEST filing per period only — a False would be a claim the data cannot
    back, so the column reads null ("not established")."""
    assert mf.SERVES_FILING_HISTORY is False
    two = [annual(2023, filed="2023-11-03"), annual(2023, filed="2024-08-02", end="2023-09-30")]
    out, _ = bf.merge_period_set(existing_set(), two, 9, "annual", "yfinance")
    assert out["restated_by_period"] == [None, None, None]


def test_a_source_serving_filing_history_flags_two_filings_and_a_carried_true_survives():
    two = [annual(2023, filed="2023-11-03"), annual(2023, filed="2024-08-02", end="2023-09-30")]
    out, _ = bf.merge_period_set(None, two, 9, "annual", "yfinance", serves_history=True)
    assert out["restated_by_period"] == [True]
    one, _ = bf.merge_period_set(None, [annual(2023)], 9, "annual", "yfinance", serves_history=True)
    assert one["restated_by_period"] == [False]
    carried, _ = bf.merge_period_set(out, [annual(2022)], 9, "annual", "yfinance")
    assert carried["restated_by_period"] == [None, True]


def test_every_array_stays_aligned_to_periods():
    out, _ = bf.merge_period_set(existing_set(), [annual(y) for y in range(2015, 2024)], 9, "annual", "yfinance")
    n = len(out["periods"])
    assert len(out["period_end"]) == n
    for block in bf.BLOCKS:
        for field, arr in out[block].items():
            assert len(arr) == n, (block, field)
    for key in ("src_by_period", "filed_by_period", "restated_by_period"):
        assert len(out[key]) == n, key


def test_a_re_run_keeps_every_stamp_including_vendor_only_columns():
    night1, _ = bf.merge_period_set(existing_set(), [annual(2020), annual(2025)], 9, "annual", "yfinance")
    assert night1["src_by_period"] == ["massive", "yfinance", "yfinance+massive"]   # 2024 untouched
    night2, stats = bf.merge_period_set(night1, [annual(2020), annual(2025)], 9, "annual", "yfinance+massive")
    assert stats["added"] == 0 and stats["filled"] == 0
    assert night2 == night1


def test_a_later_filing_that_contributes_advances_the_stamp():
    first = jrow("2023-09-30", 2023, filed="2023-11-03", inc={
        "net_income_loss_attributable_common_shareholders": None, "consolidated_net_income_loss": None})
    night1, _ = bf.merge_period_set(None, [first], 9, "annual", "yfinance")
    assert night1["filed_by_period"] == ["2023-11-03"] and night1["income"]["net_income"] == [None]
    later = annual(2023, revenue=999.0, filed="2024-08-02", end="2023-09-30")
    night2, _ = bf.merge_period_set(night1, [later], 9, "annual", "yfinance")
    assert night2["income"]["revenue"] == [416_161_000_000.0]   # never overwritten
    assert night2["income"]["net_income"] == [112_010_000_000.0]
    assert night2["filed_by_period"] == ["2024-08-02"]


def test_a_column_no_vendor_row_touched_claims_no_filing():
    out, _ = bf.merge_period_set(existing_set(), [annual(2010)], 9, "annual", "yfinance")
    assert out["filed_by_period"] == ["2010-10-30", None, None]


def sec_stamped_set():
    """existing_set() as annotate_sec_lineage leaves it: 2024 attributed (first filed
    2024-11-01, recast), 2025 judged with no claim (null date, restated False)."""
    return {**existing_set(), "filed_by_period": ["2024-11-01", None], "restated_by_period": [True, False]}


def test_sec_lineage_keeps_the_annotators_verdict_on_every_column_it_judged():
    """The annotator runs first in the nightly and its first-filed date is the stronger claim:
    a vendor fill never displaces it, never turns its restated False into null, and never
    stamps a column it left silent. The flag is what decides — without it, the vendor's
    latest filing claims both columns."""
    rows = [annual(2015), annual(2024, filed="2025-10-30", end="2024-09-28"), annual(2025)]
    sec, _ = bf.merge_period_set(sec_stamped_set(), rows, 9, "annual", "yfinance", sec_lineage=True)
    assert sec["src_by_period"] == ["massive", "yfinance+massive", "yfinance+massive"]
    assert sec["income"]["net_income"][2] == 112_010_000_000.0      # the hole is still filled
    assert sec["filed_by_period"] == ["2015-10-30", "2024-11-01", None]
    assert sec["restated_by_period"] == [None, True, False]
    plain, _ = bf.merge_period_set(sec_stamped_set(), rows, 9, "annual", "yfinance")
    assert plain["filed_by_period"] == ["2015-10-30", "2025-10-30", "2025-10-30"]
    assert plain["restated_by_period"] == [None, True, None]


def test_a_set_the_annotator_left_unstamped_stays_silent_under_sec_lineage():
    """The annotator drops both arrays when it makes no claim on any column of a set; that
    is still a verdict, so a vendor fill does not date those columns."""
    out, _ = bf.merge_period_set(existing_set(), [annual(2015), annual(2025)], 9, "annual", "yfinance",
                                 sec_lineage=True)
    assert out["filed_by_period"] == ["2015-10-30", None, None]
    assert out["restated_by_period"] == [None, None, None]


def test_a_vendor_only_column_stays_ours_unless_the_annotator_judged_it():
    first = jrow("2023-09-30", 2023, filed="2023-11-03", inc={
        "net_income_loss_attributable_common_shareholders": None, "consolidated_net_income_loss": None})
    later = annual(2023, revenue=999.0, filed="2024-08-02", end="2023-09-30")
    night1, _ = bf.merge_period_set(sec_stamped_set(), [first], 9, "annual", "yfinance", sec_lineage=True)
    assert night1["src_by_period"][0] == "massive" and night1["restated_by_period"][0] is None
    night2, _ = bf.merge_period_set(night1, [later], 9, "annual", "yfinance", sec_lineage=True)
    assert night2["filed_by_period"] == ["2024-08-02", "2024-11-01", None]
    assert night2["restated_by_period"] == [None, True, False]
    # A file gen_fund_us did not rebuild keeps the vendor columns, and the annotator judges them.
    rejudged = {**night1, "filed_by_period": ["2023-11-01", "2024-11-01", None],
                "restated_by_period": [False, True, False]}
    kept, _ = bf.merge_period_set(rejudged, [later], 9, "annual", "yfinance", sec_lineage=True)
    assert kept["filed_by_period"] == ["2023-11-01", "2024-11-01", None]
    assert kept["restated_by_period"] == [False, True, False]


@pytest.mark.parametrize(
    "mutate,reason",
    [
        (lambda s: s.update(periods=["2024", "2024"]), "repeated period label"),
        (lambda s: s.update(periods=["", "2025"]), "blank period label"),
        (lambda s: s.update(period_kind=["fy", "fy"]), "unknown key period_kind"),
        (lambda s: s.update(periods=["2024", 2025]), "non-string period label"),
        (lambda s: s.update(period_end=["2025-09-30"]), "misaligned period_end"),
        (lambda s: s["income"].update(revenue=[416_161_000_000.0]), "misaligned income.revenue"),
        (lambda s: s.update(balance=[1.0, 2.0]), "misaligned balance"),
        (lambda s: s.update(src_by_period=["yfinance", 7]), "misaligned src_by_period"),
        (lambda s: s.update(filed_by_period="2025-10-31"), "misaligned filed_by_period"),
        (lambda s: s.update(restated_by_period=["yes", None]), "misaligned restated_by_period"),
    ],
    ids=["fiscal-year-end-change", "blank-label", "cn-hk-extra-key", "non-string-label",
         "short-period-end", "short-field", "block-not-an-object", "non-string-source",
         "scalar-filed", "non-bool-restated"],
)
def test_a_set_the_label_keyed_merge_cannot_carry_is_left_exactly_as_emitted(mutate, reason):
    """gen_fund_us repeats a label when an issuer moves its fiscal year end (GEF, JACK — 23 of
    19,942 sets on M1); the CN/HK generators add per-period keys the merge does not own. Merging
    would drop a published column or misalign a key."""
    existing = existing_set()
    mutate(existing)
    frozen = json.dumps(existing, sort_keys=True)
    out, stats = bf.merge_period_set(existing, [annual(y) for y in range(2010, 2026)], 9, "annual", "yfinance")
    assert stats["held"] == reason and stats["added"] == 0 and stats["filled"] == 0
    assert json.dumps(out, sort_keys=True) == frozen
    assert json.dumps(existing, sort_keys=True) == frozen


def test_merging_into_an_absent_set_builds_one_from_the_vendor_alone():
    out, stats = bf.merge_period_set(None, [annual(2019), annual(2020)], 9, "annual", "yfinance")
    assert out["periods"] == ["2019", "2020"] and stats["added"] == 2
    assert out["src_by_period"] == ["massive", "massive"]


def test_bare_sweep_targets_us_listings_only():
    for sym in ("AAPL", "BRK-B", "BRK.B", "TSM", "RDS.A"):
        assert bf.is_vendor_market(sym), sym
    for sym in ("600519.SS", "0700.HK", "005930.KS", "7203.T", "SHOP.TO"):
        assert not bf.is_vendor_market(sym), sym


# ── 4b. one file ─────────────────────────────────────────────────────────────
def fund_file(tmp_path: Path, sym="AAPL", quarterly=None, mktcap=None, **top) -> Path:
    fund = {
        "schema": "mastermind.fund/v1",
        "ticker": sym,
        "stmt_currency": "USD",
        "src": {"statements": "yfinance"},
        "stats": {"mktcap": mktcap},
        "ratios": {"current": {"ev_sales": 8.1}},
        "statements": {"annual": existing_set(), "quarterly": quarterly},
        **top,
    }
    path = tmp_path / f"{sym}.fund.json"
    path.write_text(json.dumps(fund, indent=1))
    return path


def test_apply_merges_deep_history_and_stamps_the_source(tmp_path):
    path = fund_file(tmp_path)
    st = bf.apply_vendor_rows("AAPL", path, [annual(y) for y in range(2010, 2026)], [])
    assert st["status"] == "ok" and st["changed"] is True
    fund = json.loads(path.read_text())
    ann = fund["statements"]["annual"]
    assert ann["periods"][0] == "2010" and len(ann["periods"]) == 16
    assert ann["filed_by_period"][0] == "2010-10-30"
    assert fund["src"]["statements"] == "yfinance+massive"
    assert fund["statements"]["quarterly"] is None          # no rows → a null basis stays null
    assert fund["ratios"] == {"current": {"ev_sales": 8.1}}  # nothing outside statements moves


def test_apply_reads_sec_lineage_from_the_file_and_keeps_its_tag(tmp_path):
    path = fund_file(tmp_path)
    fund = json.loads(path.read_text())
    fund["src"]["statement_lineage"] = "sec_companyfacts"
    fund["statements"]["annual"] = sec_stamped_set()
    path.write_text(json.dumps(fund, indent=1))
    rows = [annual(2015), annual(2024, filed="2025-10-30", end="2024-09-28"), annual(2025)]
    assert bf.apply_vendor_rows("AAPL", path, rows, [])["changed"] is True
    out = json.loads(path.read_text())
    ann = out["statements"]["annual"]
    assert ann["filed_by_period"] == ["2015-10-30", "2024-11-01", None]
    assert ann["restated_by_period"] == [None, True, False]
    assert out["src"] == {"statements": "yfinance+massive", "statement_lineage": "sec_companyfacts"}


def test_a_re_run_with_nothing_new_leaves_the_file_byte_identical(tmp_path):
    path = fund_file(tmp_path)
    rows = [annual(y) for y in range(2010, 2026)]
    bf.apply_vendor_rows("AAPL", path, rows, [])
    before, mtime = path.read_bytes(), path.stat().st_mtime_ns
    time.sleep(0.01)
    st = bf.apply_vendor_rows("AAPL", path, rows, [])
    assert st["changed"] is False
    assert path.read_bytes() == before and path.stat().st_mtime_ns == mtime
    assert json.loads(before)["src"]["statements"] == "yfinance+massive"   # never doubled


def test_a_held_set_is_untouched_while_the_other_timeframe_still_merges(tmp_path):
    quarterly = {"periods": ["Q4 '25", "Q4 '25"], "period_end": ["2025-06-30", "2025-09-30"],
                 "income": {"revenue": [1.0, 2.0]}}
    path = fund_file(tmp_path, quarterly=quarterly)
    qrows = [jrow("2025-03-29", 2025, 2, "2025-05-02", "quarterly")]
    st = bf.apply_vendor_rows("AAPL", path, [annual(2015)], qrows)
    assert st["quarterly"]["held"] == "repeated period label"
    fund = json.loads(path.read_text())
    assert fund["statements"]["quarterly"] == quarterly
    assert fund["statements"]["annual"]["periods"][0] == "2015"


@pytest.mark.parametrize("ccy", ["TWD", "CNY", None], ids=["twd", "cny", "unstated"])
def test_statements_not_in_usd_are_never_mixed_with_vendor_figures(tmp_path, ccy):
    """Vendor rows carry no currency (TSM files TWD, BABA CNY on prod, 2026-10-30)."""
    path = fund_file(tmp_path, "TSM", stmt_currency=ccy)
    before = path.read_bytes()
    st = bf.apply_vendor_rows("TSM", path, [annual(y) for y in range(2010, 2026)], [])
    assert st == {"sym": "TSM", "status": "not-usd", "detail": str(ccy)}
    assert path.read_bytes() == before


def test_a_top_level_key_the_rewrite_would_drop_holds_the_whole_file(tmp_path):
    path = fund_file(tmp_path, notes={"kept": True})
    before = path.read_bytes()
    st = bf.apply_vendor_rows("AAPL", path, [annual(y) for y in range(2010, 2026)], [])
    assert st["status"] == "unsafe-shape" and "notes" in st["detail"]
    assert path.read_bytes() == before


def test_an_empty_vendor_answer_or_a_dry_run_never_writes(tmp_path):
    path = fund_file(tmp_path)
    before = path.read_bytes()
    assert bf.apply_vendor_rows("AAPL", path, [], [])["status"] == "no-vendor-coverage"
    st = bf.apply_vendor_rows("AAPL", path, [annual(2012)], [], dry_run=True)
    assert st["changed"] is True and path.read_bytes() == before


# ── 5. the request: key safety, batching, pagination, deadline ───────────────
class FakeCurl:
    """Stands in for subprocess.run inside massive_financials._get."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.calls = []

    def __call__(self, argv, input=None, capture_output=None, text=None, env=None):
        self.calls.append({"argv": argv, "stdin": input, "env": env})
        status, body = self.pages.pop(0) if self.pages else ("200", {"results": []})
        return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(body) + "\n" + status, stderr="")


def test_the_key_travels_only_in_a_bearer_header_on_stdin(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", FAKE_KEY)
    curl = FakeCurl([("200", {"results": []})])
    monkeypatch.setattr(mf.subprocess, "run", curl)
    mf.fetch_rows("income", ["AAPL"], "annual", FAKE_KEY)
    (call,) = curl.calls
    assert all(FAKE_KEY not in a for a in call["argv"])                    # not visible to `ps`
    assert call["stdin"] == f'header = "Authorization: Bearer {FAKE_KEY}"\n'
    assert "-K" in call["argv"] and call["argv"][call["argv"].index("-K") + 1] == "-"
    assert call["argv"][1] == "-q"          # curl reads ~/.curlrc unless -q comes first
    assert "-g" in call["argv"]             # a URL's []/{} are never globbed
    assert not set(mf.KEY_VARS) & set(call["env"])                         # curl's env is clean
    assert "apiKey" not in call["argv"][-1]


def test_the_request_names_the_v1_endpoint_sort_and_batch_filter(monkeypatch):
    curl = FakeCurl([])
    monkeypatch.setattr(mf.subprocess, "run", curl)
    mf.fetch_rows("cashflow", ["AAPL"], "quarterly", FAKE_KEY)
    mf.fetch_rows("balance", ["AAPL", "BRK.B"], "annual", FAKE_KEY)
    one, many = (c["argv"][-1] for c in curl.calls)
    assert one.startswith("https://api.massive.com/stocks/financials/v1/cash-flow-statements?tickers=AAPL&")
    assert "timeframe=quarterly" in one and "sort=period_end.asc" in one and "limit=50000" in one
    # `tickers=A,B` returns nothing and `tickers.in` is ignored — a batch must use any_of
    assert "/balance-sheets?tickers.any_of=AAPL,BRK.B&" in many


def test_pagination_follows_next_url_and_a_runaway_cursor_raises(monkeypatch):
    nxt = "https://api.massive.com/stocks/financials/v1/income-statements?cursor=abc"
    curl = FakeCurl([("200", {"results": [{"a": 1}], "next_url": nxt}), ("200", {"results": [{"a": 2}]})])
    monkeypatch.setattr(mf.subprocess, "run", curl)
    assert mf.fetch_rows("income", ["AAPL"], "annual", FAKE_KEY) == [{"a": 1}, {"a": 2}]
    assert curl.calls[1]["argv"][-1] == nxt

    loop = FakeCurl([("200", {"results": [{"a": 1}], "next_url": nxt})] * 5)
    monkeypatch.setattr(mf.subprocess, "run", loop)
    with pytest.raises(mf.VendorHTTPError, match="cursor still open"):
        mf.fetch_rows("income", ["AAPL"], "annual", FAKE_KEY, max_pages=3)


def test_a_cursor_never_sends_the_key_off_host_or_on_the_command_line():
    with pytest.raises(mf.VendorHTTPError):
        mf._checked_url("https://evil.example.com/stocks/financials/v1/income-statements")
    with pytest.raises(mf.VendorHTTPError):
        mf._checked_url("http://api.massive.com/stocks/financials/v1/income-statements")
    url = mf._checked_url("https://api.massive.com/x?cursor=1&apiKey=leak")
    assert "leak" not in url and "cursor=1" in url
    with pytest.raises(RuntimeError):
        mf._curl_config("abc\ndef")


def test_an_error_body_echoing_the_key_is_scrubbed(monkeypatch):
    curl = FakeCurl([("404", {"status": "ERROR", "error": f"Unknown API Key {FAKE_KEY}"})])
    monkeypatch.setattr(mf.subprocess, "run", curl)
    with pytest.raises(mf.VendorHTTPError) as exc:
        mf.fetch_rows("income", ["AAPL"], "annual", FAKE_KEY)
    assert exc.value.status == "404" and FAKE_KEY not in str(exc.value)
    assert len(curl.calls) == 1                 # a 404 is not retried


def test_a_spent_deadline_starts_no_request_and_a_retry_never_crosses_it(monkeypatch):
    curl = FakeCurl([("503", {})] * 3)
    monkeypatch.setattr(mf.subprocess, "run", curl)
    monkeypatch.setattr(mf.time, "sleep", lambda s: pytest.fail("slept past the deadline"))
    with pytest.raises(mf.DeadlineReached):
        mf.fetch_rows("income", ["AAPL"], "annual", FAKE_KEY, deadline=time.monotonic() - 1)
    assert curl.calls == []
    with pytest.raises(mf.DeadlineReached):
        # 1.8s left: the request runs (capped to the budget), the 2s retry pause would cross it
        mf.fetch_rows("income", ["AAPL"], "annual", FAKE_KEY, deadline=time.monotonic() + 1.8)
    assert len(curl.calls) == 1
    assert curl.calls[0]["argv"][curl.calls[0]["argv"].index("-m") + 1] == "1"


def test_fetch_batch_routes_rows_per_symbol_and_maps_class_shares(monkeypatch):
    def fake_rows(block, tickers, timeframe, key, deadline=None):
        assert tickers == ["AAPL", "BRK.B", "ZZZZ"]
        return [vrow(block, "2025-09-27", 2025), vrow(block, "2025-12-31", 2025, cik="0001067983", tickers=("BRK.A", "BRK.B"))]

    monkeypatch.setattr(mf, "fetch_rows", fake_rows)
    out = mf.fetch_batch(["AAPL", "BRK-B", "ZZZZ"], "annual", FAKE_KEY)
    assert [r["period_end"] for r in out["AAPL"]] == ["2025-09-27"]
    assert [r["period_end"] for r in out["BRK-B"]] == ["2025-12-31"]
    assert out["ZZZZ"] == []


def test_key_from_env_file_reads_only_the_key_lines(tmp_path):
    env = tmp_path / ".env"
    env.write_text(
        "# comment\nOTHER=1\nexport POLYGON_API_KEY='poly'\nMASSIVE_API_KEY=\"mass\"\nEMPTY=\n"
    )
    assert mf.key_from_env_file(env) == "mass"
    env.write_text("POLYGON_API_KEY=poly\n")
    assert mf.key_from_env_file(env) == "poly"
    env.write_text("MASSIVE_API_KEY=\n")
    assert mf.key_from_env_file(env) is None
    assert mf.key_from_env_file(tmp_path / "absent") is None
    for line, want in [
        ("MASSIVE_API_KEY=abc # rotated 10-01", "abc"),        # an inline comment is not the key
        ("MASSIVE_API_KEY=\"abc\" # note", "abc"),
        ("MASSIVE_API_KEY='a b#c'", "a b#c"),                  # quoted: runs to the closing quote
        ("MASSIVE_API_KEY=ab#c", "ab#c"),                      # no space before `#`: part of it
        ("MASSIVE_API_KEY=\"abc", None),                       # unterminated: no key, not a mangled one
    ]:
        env.write_text(line + "\n")
        assert mf.key_from_env_file(env) == want, line


# ── 6. the driver: failure contract ──────────────────────────────────────────
def two_files(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    paths = [fund_file(data, s) for s in ("AAPL", "MSFT")]
    return data, {p: p.read_bytes() for p in paths}


@pytest.mark.parametrize("status", ["410", "404", "401"])
def test_a_systemic_status_leaves_every_file_byte_identical_and_returns_nonzero(tmp_path, monkeypatch, capsys, status):
    data, before = two_files(tmp_path)
    calls = []

    def dead(symbols, timeframe, key=None, deadline=None):
        calls.append(symbols)
        raise bf.VendorHTTPError(status, "gone")

    monkeypatch.setattr(bf, "fetch_batch", dead)
    monkeypatch.setenv("MASSIVE_API_KEY", FAKE_KEY)
    rc = bf.main(["--data-dir", str(data), "--batch-size", "1"])
    assert rc == 1
    assert len(calls) == 1                                 # the sweep stopped at once
    assert {p: p.read_bytes() for p in before} == before
    err = capsys.readouterr()
    assert "ABORT" in err.err and FAKE_KEY not in err.out + err.err


def test_transient_batch_errors_continue_then_abort_after_three_in_a_row(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    for s in ("A", "B", "C", "D", "E"):
        fund_file(data, s)
    calls = []

    def flaky(symbols, timeframe, key=None, deadline=None):
        calls.append(symbols[0])
        raise bf.VendorHTTPError("503")

    monkeypatch.setattr(bf, "fetch_batch", flaky)
    monkeypatch.setenv("MASSIVE_API_KEY", FAKE_KEY)
    assert bf.main(["--data-dir", str(data), "--batch-size", "1", "--quiet"]) == 1
    assert calls == ["A", "B", "C"]


def test_a_spent_budget_stops_the_sweep_without_failing(tmp_path, monkeypatch, capsys):
    data, before = two_files(tmp_path)

    def late(symbols, timeframe, key=None, deadline=None):
        raise bf.DeadlineReached("time budget spent")

    monkeypatch.setattr(bf, "fetch_batch", late)
    monkeypatch.setenv("MASSIVE_API_KEY", FAKE_KEY)
    assert bf.main(["--data-dir", str(data), "--deadline-seconds", "5"]) == 0
    assert {p: p.read_bytes() for p in before} == before
    err = capsys.readouterr().err
    assert "2 symbols not reached (from AAPL); they keep the periods already on file" in err


def test_the_bare_sweep_runs_largest_market_cap_first(tmp_path, monkeypatch):
    """A spent budget drops the tail of the sweep, so the tail must be the smallest names."""
    data = tmp_path / "data"
    data.mkdir()
    for sym, cap in [("AAA", 2e9), ("BIG", 3e12), ("MID", 5e10), ("NONE", None), ("BOOL", True)]:
        fund_file(data, sym, mktcap=cap)
    (data / "BAD.fund.json").write_text("{not json")
    calls = []

    def record(symbols, timeframe, key=None, deadline=None):
        if timeframe == "annual":
            calls.append(symbols[0])
        return {s: [] for s in symbols}

    monkeypatch.setattr(bf, "fetch_batch", record)
    monkeypatch.setenv("MASSIVE_API_KEY", FAKE_KEY)
    assert bf.main(["--data-dir", str(data), "--batch-size", "1", "--quiet"]) == 0
    assert calls == ["BIG", "MID", "AAA", "BAD", "BOOL", "NONE"]
    calls.clear()
    bf.main(["--data-dir", str(data), "--batch-size", "1", "--quiet", "--limit", "2"])
    assert calls == ["BIG", "MID"]


def test_one_file_that_breaks_the_merge_is_counted_and_the_sweep_goes_on(tmp_path, monkeypatch, capsys):
    data, before = two_files(tmp_path)
    real = bf.apply_vendor_rows

    def brittle(sym, path, *a, **k):
        if sym == "AAPL":
            raise TypeError("unexpected shape")
        return real(sym, path, *a, **k)

    monkeypatch.setattr(bf, "apply_vendor_rows", brittle)
    monkeypatch.setattr(bf, "fetch_batch", lambda symbols, timeframe, key=None, deadline=None:
                        {s: [annual(2012)] if timeframe == "annual" else [] for s in symbols})
    monkeypatch.setenv("MASSIVE_API_KEY", FAKE_KEY)
    assert bf.main(["--data-dir", str(data), "--batch-size", "1"]) == 0
    out = capsys.readouterr()
    assert "AAPL     failed: TypeError — file left unchanged" in out.err
    assert "1 merged (1 changed)" in out.out and "1 errors" in out.out
    aapl, msft = sorted(before)
    assert aapl.read_bytes() == before[aapl] and msft.read_bytes() != before[msft]


def test_no_key_fetches_nothing_and_returns_two(tmp_path, monkeypatch):
    data, before = two_files(tmp_path)
    for var in mf.KEY_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(bf, "fetch_batch", lambda *a, **k: pytest.fail("fetched without a key"))
    assert bf.main(["--data-dir", str(data), "--env-file", str(tmp_path / "absent.env")]) == 2


def test_the_env_file_key_is_used_and_never_printed(tmp_path, monkeypatch, capsys):
    data, _ = two_files(tmp_path)
    env = tmp_path / ".env"
    env.write_text(f"MASSIVE_API_KEY={FAKE_KEY}\n")
    for var in mf.KEY_VARS:
        monkeypatch.delenv(var, raising=False)
    seen = []

    def ok(symbols, timeframe, key=None, deadline=None):
        seen.append(key)
        return {s: [annual(2012)] if timeframe == "annual" else [] for s in symbols}

    monkeypatch.setattr(bf, "fetch_batch", ok)
    assert bf.main(["--data-dir", str(data), "--env-file", str(env)]) == 0
    assert set(seen) == {FAKE_KEY}
    assert not set(mf.KEY_VARS) & set(os.environ)            # nothing exported
    out = capsys.readouterr()
    assert FAKE_KEY not in out.out + out.err
    assert "2 merged (2 changed)" in out.out


def write_fake_curl(bin_dir: Path, status: str) -> Path:
    """A `curl` that records its argv and stdin and answers `status` — the real subprocess
    boundary, so the test sees exactly what `ps` and the vendor would."""
    bin_dir.mkdir()
    log = bin_dir / "argv.log"
    curl = bin_dir / "curl"
    curl.write_text(
        "#!/bin/bash\n"
        f'printf "%s\\n" "$@" >> "{log}"\n'
        f'cat >> "{bin_dir / "stdin.log"}"\n'
        f"printf '{{\"status\":\"ERROR\",\"error\":\"gone\"}}\\n{status}'\n"
    )
    curl.chmod(0o755)
    return log


@pytest.mark.parametrize("status", ["410", "401"])
def test_the_script_run_as_the_nightly_runs_it_survives_a_dead_endpoint(tmp_path, status):
    """End to end through the real script entry point (sys.path[0] = ingest/, as in the
    nightly) and a real curl subprocess boundary: files byte-identical, no traceback, the key
    on neither the command line nor the output."""
    data, before = two_files(tmp_path)
    argv_log = write_fake_curl(tmp_path / "bin", status)
    env_file = tmp_path / ".env"
    env_file.write_text(f"MASSIVE_API_KEY={FAKE_KEY}\n")
    env = {k: v for k, v in os.environ.items() if k not in mf.KEY_VARS}
    env["PATH"] = f"{tmp_path / 'bin'}:{env['PATH']}"
    proc = subprocess.run(
        [sys.executable, str(BACKFILL), "--data-dir", str(data), "--env-file", str(env_file),
         "--deadline-seconds", "60", "--quiet"],
        capture_output=True, text=True, env=env, timeout=60,
    )
    assert proc.returncode == 1, proc.stderr
    assert "Traceback" not in proc.stderr
    assert f"HTTP {status}" in proc.stderr and "files left unchanged" in proc.stderr
    assert {p: p.read_bytes() for p in before} == before
    assert FAKE_KEY not in proc.stdout + proc.stderr + argv_log.read_text()
    assert f"Authorization: Bearer {FAKE_KEY}" in (tmp_path / "bin" / "stdin.log").read_text()
