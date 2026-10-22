"""CN statement refresh: per-period completeness, revision precedence, and honest quarterly EPS.

THE DEFECTS THESE PIN (all three were live on the CN path):

  1. COLLECTOR — completion was inferred from `set(cached end_dates)`, so a period counted as
     done the moment ONE ticker had a row. A pull that returned a fraction of the market was
     recorded as finished and never revisited. Completeness is now a per-period receipt, and a
     period that did not close is retried.

  2. COLLECTOR — rows carried no ann_date/f_ann_date/report_type/update_flag, so competing
     revisions were deduplicated by `keep="last"`, i.e. by arrival order. A restatement could
     lose to the original purely because the API listed it second. Precedence is now decided by
     the vendor's own filing facts.

  3. EMITTER — quarterly EPS was produced by differencing a WEIGHTED-AVERAGE year-to-date
     figure, which is not the quarter. Worse, `i == 0` meant "first row present", so a missing
     Q1 promoted Q2 into that slot and published the six-month total as "Q2" — the production
     symptom. EPS is now withheld outside Q1 with a stated reason; additive flows are
     differenced only across a contiguous same-fiscal-year quarter boundary.

No test here touches the network, a TUSHARE_TOKEN, or a production cache: the vendor call is
injected, the cache directory is a tmp_path, and every assertion is on values that were fed in.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest import cn_statement_rules as R                     # noqa: E402
from ingest.collect_cn_hk_fund import (                        # noqa: E402
    CASHFLOW_FIELDS, INCOME_FIELDS, collect_cn_statements, merge_statement_rows,
)
from ingest.gen_fund_cn import _earnings_from_existing_stmts, build_earnings_q  # noqa: E402

IDENTITY = ["ts_code", "end_date", "ann_date", "f_ann_date", "report_type", "update_flag",
            "comp_type"]


# ─────────────────────────────── fakes ───────────────────────────────
class FakeTushare:
    """Stands in for ts_call_detail. Records every call so retry/overlap can be asserted."""

    def __init__(self, responses):
        # period -> (fields, items) | callable | Exception
        self.responses = responses
        self.calls: list[str] = []

    def __call__(self, api, params, fields, retries=4):
        period = params["period"]
        self.calls.append(period)
        entry = self.responses.get(period)
        if callable(entry):
            entry = entry()
        if entry is None:
            return [], [], "no response configured"
        if isinstance(entry, Exception):
            return [], [], f"{type(entry).__name__}: {entry}"
        return entry


def rows_response(period, rows):
    """Wire-format (fields, items) for the given row dicts, in the declared field order."""
    fields = INCOME_FIELDS.split(",")
    items = [[r.get(f) for f in fields] for r in rows]
    return fields, items, None


def make_row(code, period, **values):
    row = {
        "ts_code": code, "end_date": period, "ann_date": period, "f_ann_date": period,
        "report_type": "1", "update_flag": "1", "comp_type": "1",
        "total_revenue": 100.0, "basic_eps": 1.0,
    }
    row.update(values)
    return row


def read_cache(out: Path, kind="income"):
    return pd.read_parquet(out / f"stmt_{kind}.parquet").to_dict("records")


def read_receipts(out: Path, kind="income"):
    return json.loads((out / f"stmt_{kind}.periods.json").read_text())


# ─────────────────────────────── collector: completeness ───────────────────────────────
def test_partial_cached_period_is_refetched(tmp_path):
    """A period whose cache holds only a few rows must NOT count as complete.

    This is the production failure: 1709 populated names, every one of them carrying a
    20260331 row, so `p not in cached end_dates` was False for every period and the collector
    skipped all of them — while the underlying market pull had returned almost nothing.
    refresh_periods=0 removes the rolling-overlap path from the equation, so a refetch can
    only come from the receipt ledger.
    """
    out = tmp_path
    pd.DataFrame([make_row(f"60000{i}.SH", "20260331") for i in range(3)]).to_parquet(
        out / "stmt_income.parquet", index=False)
    # No receipt ledger at all — the legacy cache predates it.
    assert not (out / "stmt_income.periods.json").exists()

    fake = FakeTushare({
        "20260331": rows_response("20260331",
                                  [make_row(f"60000{i}.SH", "20260331") for i in range(10)]),
        "20251231": rows_response("20251231",
                                  [make_row(f"60000{i}.SH", "20251231") for i in range(10)]),
    })
    collect_cn_statements(["20260331", "20251231"], force=False,
                          refresh_periods=0, out_dir=out, client=fake, kinds=("income",))

    assert "20260331" in fake.calls, "a partially-cached period was skipped"
    rows = [r for r in read_cache(out) if r["end_date"] == "20260331"]
    assert len(rows) == 10, "the full market result was not merged over the partial cache"
    assert read_receipts(out)["20260331"]["status"] == R.COMPLETE


def test_complete_period_is_not_refetched_outside_the_window(tmp_path):
    """Efficiency must survive the fix: a period with a COMPLETE receipt is not re-pulled."""
    out = tmp_path
    R.save_period_receipts(out / "stmt_income.periods.json", {
        "20231231": {"status": R.COMPLETE, "tickers": 100, "rows": 100},
        "20240930": {"status": R.COMPLETE, "tickers": 100, "rows": 100},
    })
    pd.DataFrame([make_row("600000.SH", "20231231")]).to_parquet(
        out / "stmt_income.parquet", index=False)

    fake = FakeTushare({})
    collect_cn_statements(["20240930", "20231231"], force=False,
                          refresh_periods=0, out_dir=out, client=fake, kinds=("income",))

    assert "20231231" not in fake.calls
    assert "20240930" not in fake.calls


def test_truncated_pull_is_not_complete_and_is_retried(tmp_path):
    """A thin cross-section keeps its rows but leaves the period open for the next run.

    The vendor documents no limit/offset for these endpoints, so no page split is invented;
    a short market-wide result is instead detected against the same quarter a year earlier
    and retried.
    """
    out = tmp_path
    R.save_period_receipts(out / "stmt_income.periods.json", {
        "20250331": {"status": R.COMPLETE, "tickers": 1000, "rows": 1000},
    })
    fake = FakeTushare({
        "20260331": rows_response("20260331",
                                  [make_row(f"60000{i}.SH", "20260331") for i in range(50)]),
    })
    collect_cn_statements(["20260331"], force=False, refresh_periods=0,
                          out_dir=out, client=fake, kinds=("income",))

    receipt = read_receipts(out)["20260331"]
    assert receipt["status"] == R.TRUNCATED
    assert receipt["tickers"] == 50
    # The rows we did get are real and are kept — a short pull is not a reason to lose data.
    assert len(read_cache(out)) == 50
    # And because it never completed, the next run asks again.
    again = FakeTushare({"20260331": rows_response(
        "20260331", [make_row(f"60000{i}.SH", "20260331") for i in range(1000)])})
    collect_cn_statements(["20260331"], force=False, refresh_periods=0,
                          out_dir=out, client=again, kinds=("income",))
    assert "20260331" in again.calls
    assert read_receipts(out)["20260331"]["status"] == R.COMPLETE


def test_cold_start_detects_a_short_period_against_the_runs_own_breadth(tmp_path):
    """With no receipt ledger at all, the run's widest pull is the reference.

    This is the production case: a cold (or legacy) cache has no prior-year receipts, so a
    prior-year comparison is unavailable. Without an in-run reference every period would be
    accepted, and a market-wide pull that returned a sliver would again be filed as complete.
    """
    out = tmp_path
    full = [make_row(f"60000{i}.SH", "20260331") for i in range(100)]
    fake = FakeTushare({
        "20260331": rows_response("20260331", full),
        "20251231": rows_response("20251231", [make_row("600000.SH", "20251231")]),
        "20250930": rows_response("20250930", full),
        "20250630": rows_response("20250630", full),
    })
    collect_cn_statements(["20260331", "20251231", "20250930", "20250630"],
                          force=True, refresh_periods=0, out_dir=out,
                          client=fake, kinds=("income",))

    receipts = read_receipts(out)
    assert receipts["20260331"]["status"] == R.COMPLETE
    assert receipts["20250930"]["status"] == R.COMPLETE
    assert receipts["20251231"]["status"] == R.TRUNCATED
    assert receipts["20251231"]["tickers"] == 1
    # The short period's single row is still kept — thin is not the same as worthless.
    assert any(r["end_date"] == "20251231" for r in read_cache(out))


def test_rolling_overlap_refetches_the_newest_periods(tmp_path):
    """The newest N periods are re-pulled every run so late restatements are picked up.

    Driven by the period VALUES rather than the caller's ordering, so a caller that passes
    oldest-first still gets the newest window.
    """
    out = tmp_path
    R.save_period_receipts(out / "stmt_income.periods.json", {
        p: {"status": R.COMPLETE, "tickers": 10, "rows": 10}
        for p in ("20250630", "20250930", "20251231", "20260331")
    })
    fake = FakeTushare({})
    collect_cn_statements(["20250630", "20250930", "20251231", "20260331"],
                          force=False, refresh_periods=2, out_dir=out, client=fake, kinds=("income",))
    assert sorted(set(fake.calls)) == ["20251231", "20260331"], fake.calls


def test_period_window_advances_with_the_clock(tmp_path):
    """The overlap window tracks the current period set, not a frozen list of dates."""
    out = tmp_path
    completed = ("20250930", "20251231", "20260331")
    R.save_period_receipts(out / "stmt_income.periods.json", {
        p: {"status": R.COMPLETE, "tickers": 10, "rows": 10} for p in completed})
    fake = FakeTushare({})
    # A new quarter has opened; 20250930 has aged out of the 2-period window.
    collect_cn_statements(["20251231", "20260331", "20260630"],
                          force=False, refresh_periods=2, out_dir=out, client=fake, kinds=("income",))
    assert sorted(set(fake.calls)) == ["20260331", "20260630"], fake.calls


def test_quarter_periods_is_rolling_under_a_frozen_clock():
    """Period selection derives from the supplied date, so no year is ever hard-coded."""
    import datetime as dt

    from ingest.collect_cn_hk_fund import quarter_periods

    assert quarter_periods(3, today=dt.date(2026, 10, 21)) == ["20260930", "20260630", "20260331"]
    assert quarter_periods(3, today=dt.date(2027, 2, 1)) == ["20261231", "20260930", "20260630"]


# ─────────────────────────────── collector: revisions ───────────────────────────────
def test_restatement_wins_on_later_actual_announcement():
    """A later f_ann_date is a restatement and supersedes the original filing."""
    original = make_row("600519.SH", "20260630", total_revenue=250.0, ann_date="20260820",
                        f_ann_date="20260820", update_flag="0")
    restated = make_row("600519.SH", "20260630", total_revenue=261.5, ann_date="20261005",
                        f_ann_date="20261005", update_flag="1")
    winner = R.pick_revision([original, restated])
    assert winner["total_revenue"] == 261.5
    # Arrival order must not decide it.
    assert R.pick_revision([restated, original])["total_revenue"] == 261.5


def test_consolidated_scope_beats_parent_only():
    """A parent-only (母公司) filing is a different entity and must never displace the group."""
    consolidated = make_row("600519.SH", "20260630", total_revenue=250.0, report_type="1")
    parent = make_row("600519.SH", "20260630", total_revenue=999.0, report_type="6",
                      f_ann_date="20991231", update_flag="1")
    assert R.pick_revision([consolidated, parent])["total_revenue"] == 250.0
    assert R.pick_revision([parent, consolidated])["total_revenue"] == 250.0


def test_parent_only_rows_are_filtered_from_a_pull(tmp_path):
    """A mixed-scope response stores only the consolidated rows."""
    out = tmp_path
    fake = FakeTushare({"20260630": rows_response("20260630", [
        make_row("600519.SH", "20260630", report_type="1", total_revenue=250.0),
        make_row("600519.SH", "20260630", report_type="6", total_revenue=999.0),
    ])})
    collect_cn_statements(["20260630"], force=False, refresh_periods=0,
                          out_dir=out, client=fake, kinds=("income",))
    rows = read_cache(out)
    assert len(rows) == 1
    assert rows[0]["total_revenue"] == 250.0


def test_rows_absent_from_a_pull_keep_their_cached_values(tmp_path):
    """A thin refresh must not delete good history for tickers it did not return."""
    out = tmp_path
    pd.DataFrame([
        make_row("600000.SH", "20251231", total_revenue=10.0),
        make_row("600001.SH", "20251231", total_revenue=20.0),
    ]).to_parquet(out / "stmt_income.parquet", index=False)

    fake = FakeTushare({"20260331": rows_response(
        "20260331", [make_row("600000.SH", "20260331", total_revenue=11.0)])})
    collect_cn_statements(["20260331"], force=False, refresh_periods=0,
                          out_dir=out, client=fake, kinds=("income",))

    rows = read_cache(out)
    kept = {(r["ts_code"], r["end_date"]): r["total_revenue"] for r in rows}
    assert kept[("600001.SH", "20251231")] == 20.0, "a cached row was dropped"
    assert kept[("600000.SH", "20251231")] == 10.0
    assert kept[("600000.SH", "20260331")] == 11.0


# ─────────────────────────────── collector: failure handling ───────────────────────────────
@pytest.mark.parametrize("outcome", ["empty", "error"])
def test_failed_or_empty_pull_retains_cached_rows_and_leaves_the_cache_unstamped(tmp_path, outcome):
    """Good rows survive a bad night, and a run that accepted nothing does not rewrite the file."""
    out = tmp_path
    original = pd.DataFrame([make_row("600000.SH", "20251231", total_revenue=10.0)])
    original.to_parquet(out / "stmt_income.parquet", index=False)
    before = (out / "stmt_income.parquet").read_bytes()

    # empty == a successful call with no rows; error == the call failed
    response = ([], [], "") if outcome == "empty" else ([], [], "URLError: timed out")
    fake = FakeTushare({"20260331": response})
    collect_cn_statements(["20260331"], force=False, refresh_periods=0,
                          out_dir=out, client=fake, kinds=("income",), now="2026-10-21T00:00:00")

    receipt = read_receipts(out)["20260331"]
    assert receipt["status"] == (R.EMPTY if outcome == "empty" else R.FAILED)
    assert receipt["status"] != R.COMPLETE, "a failed pull was recorded as complete"
    # Cache byte-identical: a failed night must not make the file look fresh.
    assert (out / "stmt_income.parquet").read_bytes() == before
    assert read_cache(out)[0]["total_revenue"] == 10.0


def test_merge_keeps_cached_row_when_a_pull_returns_nothing_at_all(tmp_path):
    """merge_statement_rows is pure: an empty incoming set changes nothing."""
    cached = [make_row("600000.SH", "20251231", total_revenue=10.0)]
    assert merge_statement_rows(cached, []) == cached


# ─────────────────────────────── source fields ───────────────────────────────
def test_statement_fields_carry_the_vendor_identity_block():
    """The fields that make a revision decidable are actually requested."""
    for fields in (INCOME_FIELDS, CASHFLOW_FIELDS):
        for name in ("ann_date", "f_ann_date", "report_type", "update_flag"):
            assert name in fields.split(","), f"{name} missing from requested fields"


def test_identity_fields_survive_as_strings_and_numbers_are_coerced():
    """Dates/scopes stay text; figures are coerced to float or None."""
    from ingest.collect_cn_hk_fund import _rows_from_items

    fields = INCOME_FIELDS.split(",")
    row = {f: None for f in fields}
    row.update({"ts_code": "600519.SH", "end_date": "20260630", "ann_date": "20260820",
                "f_ann_date": "20260821", "report_type": "1", "update_flag": "1",
                "total_revenue": "250.5", "basic_eps": None})
    [parsed] = _rows_from_items(fields, [[row[f] for f in fields]])
    assert parsed["ann_date"] == "20260820"
    assert parsed["f_ann_date"] == "20260821"
    assert parsed["report_type"] == "1"
    assert parsed["update_flag"] == "1"
    assert parsed["total_revenue"] == 250.5
    assert parsed["basic_eps"] is None


# ─────────────────────────────── emitter: EPS ───────────────────────────────
def income_stmts(entries):
    """entries: list of (end_date, eps, revenue) → the shape build_earnings_q consumes."""
    inc = {}
    for end, eps, rev in entries:
        inc[end] = {"basic_eps": eps, "total_revenue": rev,
                    "n_income_attr_p": (rev / 10.0 if rev is not None else None),
                    "ann_date": end, "f_ann_date": end}
    return {"income": {"600519.SH": inc}}


def test_q1_eps_is_the_filed_figure_and_q2_eps_is_withheld():
    """EPS is discrete at Q1 (the cumulative window IS the quarter) and withheld after it."""
    rows = build_earnings_q("600519.SH", income_stmts([
        ("20260331", 2.00, 100.0),
        ("20260630", 4.50, 250.0),
    ]), {})
    q1, q2 = rows
    assert (q1["eps_a"], q1["eps_basis"]) == (2.0, "as_reported")
    # 4.50 is the six-month weighted average, NOT Q2. It is not published as a quarter.
    assert q2["eps_a"] is None
    assert q2["eps_basis"] == "not_disclosable"
    # Revenue IS additive, so Q2 is a real difference.
    assert (q2["rev_a"], q2["rev_basis"]) == (150.0, "derived")


def test_q2_without_q1_publishes_neither_a_total_nor_a_phantom_quarter():
    """THE PRODUCTION BUG.

    With Q1 missing, the old code saw Q2 at index 0 and published the six-month cumulative
    figures as "Q2". Now Q2 has no base: revenue is null with a stated reason, and EPS is
    withheld regardless.

    Q3 is still recovered: differencing needs the prior quarter's CUMULATIVE figure, which Q2
    carries correctly, so Q3 = 9M − 6M stands even though Q2's own discrete value was not
    derivable. The base has to be present, not itself published.
    """
    rows = build_earnings_q("600519.SH", income_stmts([
        ("20260630", 4.50, 250.0),
        ("20260930", 7.00, 400.0),
    ]), {})
    q2, q3 = rows
    assert q2["rev_a"] is None and q2["rev_basis"] == "no_base"
    assert q2["eps_a"] is None and q2["eps_basis"] == "not_disclosable"
    assert (q3["rev_a"], q3["rev_basis"]) == (150.0, "derived")
    assert q3["eps_a"] is None and q3["eps_basis"] == "not_disclosable"


def test_full_year_differences_the_additive_flows():
    """With every quarter present, additive flows difference correctly across the year."""
    rows = build_earnings_q("600519.SH", income_stmts([
        ("20260331", 1.0, 100.0), ("20260630", 2.0, 300.0),
        ("20260930", 3.0, 600.0), ("20261231", 4.0, 1000.0),
    ]), {})
    assert [r["rev_a"] for r in rows] == [100.0, 200.0, 300.0, 400.0]
    assert [r["rev_basis"] for r in rows] == ["as_reported"] + ["derived"] * 3
    assert [r["eps_a"] for r in rows] == [1.0, None, None, None]


def test_absent_value_is_reported_as_missing_not_as_withheld():
    """A dash from no data and a dash from unsafe arithmetic are different facts."""
    rows = build_earnings_q("600519.SH", {"income": {"600519.SH": {
        "20260331": {"basic_eps": None, "total_revenue": None, "n_income_attr_p": None,
                     "ann_date": "20260425"}}}}, {})
    [row] = rows
    assert row["eps_a"] is None and row["eps_basis"] == "missing"
    assert row["rev_a"] is None and row["rev_basis"] == "missing"


def test_missing_is_null_and_never_zero():
    """A withheld figure is null, not 0 — 0 is a real reported quarter."""
    rows = build_earnings_q("600519.SH", income_stmts([
        ("20260630", 4.50, 250.0), ("20260930", None, None),
    ]), {})
    for row in rows:
        assert row["eps_a"] is None
        assert row["rev_a"] is None
        assert row["eps_a"] != 0 and row["rev_a"] != 0


def test_report_date_uses_the_vendor_announcement_fields():
    """report_date is populated from ann_date/f_ann_date, which the old field list omitted —
    which is why it was always null in production."""
    stmts = {"income": {"600519.SH": {
        "20260331": {"basic_eps": 1.0, "total_revenue": 100.0,
                     "ann_date": "20260425", "f_ann_date": "20260426"}}}}
    [row] = build_earnings_q("600519.SH", stmts, {})
    assert row["report_date"] == "2026-04-26"     # f_ann_date preferred
    assert row["period"] == "Q1 2026"
    assert row["end"] == "2026-03-31"


def test_existing_stmts_fallback_applies_the_same_rule():
    """The merge-mode fallback must not resurrect the same defect from a different copy."""
    existing = {"statements": {"quarterly": {
        "periods": ["Q2 2026", "Q3 2026"],
        "period_end": ["2026-06-30", "2026-09-30"],
        "income": {"eps_basic": [4.5, 7.0], "revenue": [250.0, 400.0],
                   "net_income": [25.0, 40.0]},
    }}}
    q_rows, _fy, _nd, _np = _earnings_from_existing_stmts(existing, {}, "600519.SH")
    # Q2 has no Q1 base, so the six-month cumulative total is never published as a quarter.
    assert q_rows[0]["rev_a"] is None and q_rows[0]["rev_basis"] == "no_base"
    assert q_rows[0]["eps_a"] is None
    # Q3 differences against Q2's cumulative figure, which is present and correct.
    assert (q_rows[1]["rev_a"], q_rows[1]["rev_basis"]) == (150.0, "derived")
    assert [r["eps_a"] for r in q_rows] == [None, None]


# ─────────────────────────────── merge-mode freshness ───────────────────────────────
def test_freshness_reports_the_period_the_data_really_reaches():
    """asof advances daily; the reporting period does not. Both are published."""
    from ingest.gen_fund_cn import _statement_freshness

    fund = {"statements": {"quarterly": {"period_end": ["2026-03-31", "2026-06-30"]},
                           "annual": None},
            "src": {"statements": "tushare"}}
    freshness = _statement_freshness(fund)
    assert freshness["latest_report_period"] == "2026-06-30"
    assert freshness["periods"] == 2
    assert freshness["source"] == "tushare"


def test_merge_mode_preserves_statements_and_reports_their_real_period():
    """A failed refresh keeps the old good block AND still reports how old it is."""
    from ingest.gen_fund_cn import _merge_fund

    existing = {
        "asof": "2026-10-20",
        "statements": {"annual": None,
                       "quarterly": {"period_end": ["2026-03-31"], "periods": ["Q1 2026"]}},
        "earnings": {"q": [{"period": "Q1 2026", "eps_a": 1.0}], "fy": []},
        "src": {"statements": "tushare"},
    }
    fresh = {"statements": {"annual": None, "quarterly": None},
             "earnings": {"q": [], "fy": []}, "src": {"statements": "tushare"}}

    merged = _merge_fund(fresh, existing)
    assert merged["statements"]["quarterly"]["period_end"] == ["2026-03-31"]
    assert merged["asof_semantics"] == "build_date"
    assert merged["data_freshness"]["latest_report_period"] == "2026-03-31"


# ─────────────────────────────── script-mode import smoke ───────────────────────────────
@pytest.mark.parametrize("module", ["collect_cn_hk_fund", "gen_fund_cn", "cn_statement_rules"])
def test_ingest_modules_import_in_script_mode(module):
    """ingest/ runs with sys.path[0]=ingest/, NOT the repo root (see AGENTS.md).

    A bare `from ingest.<mod> import` passes pytest and raises ModuleNotFoundError in the
    nightly, aborting the run before deploy. This pins the real invocation.
    """
    result = subprocess.run([sys.executable, "-c", f"import {module}"],
                            cwd=ROOT / "ingest", capture_output=True, text=True)
    assert result.returncode == 0, result.stderr