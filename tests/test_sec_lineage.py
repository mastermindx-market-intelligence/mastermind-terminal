"""SEC filing lineage on statement columns (E11-03, #922) — ingest/annotate_sec_lineage.py.

WHY THIS FILE EXISTS. Production served GE FY2022 revenue as 29,139M with no lineage. SEC
companyfacts shows that figure is GE's THIRD version of FY2022 revenue (76,555M in the 10-K of
2023-02-10, recast to 58,100M on 2023-04-25, to 29,139M in the 10-K of 2025-02-03), so the
column showed a recast number as if it were the originally published fact. The UI already
discloses a restatement from `filed_by_period[]` / `restated_by_period[]`; nothing in the
nightly wrote them. These tests pin the claim the new pass makes and, just as hard, the claims
it must refuse: a displayed number SEC has since replaced, a number SEC never reported,
rounding noise posing as a restatement, and two revenue tags pooled into a fake restatement.

The fixtures below are GE's real companyfacts rows (CIK 40545), trimmed to the columns tested.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest import annotate_sec_lineage as sl  # noqa: E402
from ingest.gen_fund_us import dump  # noqa: E402

GE_CIK = 40545
NOW = dt.datetime(2026, 10, 19, 0, 30, tzinfo=dt.timezone.utc)

GE_REVENUES = [
    ["2022-01-01", "2022-12-31", 76555000000, "2023-02-10", "10-K", "0000040545-23-000023"],
    ["2022-01-01", "2022-12-31", 58100000000, "2023-04-25", "8-K", "0000040545-23-000137"],
    ["2022-01-01", "2022-12-31", 58100000000, "2024-02-02", "10-K", "0000040545-24-000027"],
    ["2022-01-01", "2022-12-31", 29139000000, "2025-02-03", "10-K", "0000040545-25-000015"],
    ["2023-01-01", "2023-12-31", 67954000000, "2024-02-02", "10-K", "0000040545-24-000027"],
    ["2023-01-01", "2023-12-31", 35348000000, "2025-02-03", "10-K", "0000040545-25-000015"],
    ["2023-01-01", "2023-12-31", 35348000000, "2026-01-29", "10-K", "0000040545-26-000008"],
    ["2025-01-01", "2025-12-31", 45855000000, "2026-01-29", "10-K", "0000040545-26-000008"],
    # Quarter and nine-month facts ending on the same day as an annual or quarterly column.
    ["2025-07-01", "2025-09-30", 12181000000, "2025-10-21", "10-Q", "0000040545-25-000200"],
    ["2025-01-01", "2025-09-30", 34400000000, "2025-10-21", "10-Q", "0000040545-25-000200"],
]
GE_NET_INCOME = [
    ["2022-01-01", "2022-12-31", 225000000, "2023-02-10", "10-K", "0000040545-23-000023"],
    ["2022-01-01", "2022-12-31", 339000000, "2023-04-25", "8-K", "0000040545-23-000137"],
    ["2022-01-01", "2022-12-31", 339000000, "2024-02-02", "10-K", "0000040545-24-000027"],
    ["2022-01-01", "2022-12-31", 336000000, "2025-02-03", "10-K", "0000040545-25-000015"],
    # 9,481M vs 9,482M is rounding between filings, not a restatement.
    ["2023-01-01", "2023-12-31", 9481000000, "2024-02-02", "10-K", "0000040545-24-000027"],
    ["2023-01-01", "2023-12-31", 9482000000, "2025-02-03", "10-K", "0000040545-25-000015"],
    ["2023-01-01", "2023-12-31", 9482000000, "2026-01-29", "10-K", "0000040545-26-000008"],
    ["2025-01-01", "2025-12-31", 8704000000, "2026-01-29", "10-K", "0000040545-26-000008"],
    ["2025-07-01", "2025-09-30", 2157000000, "2025-10-21", "10-Q", "0000040545-25-000200"],
]
GE_ASSETS = [
    [None, "2022-12-31", 187788000000, "2023-02-10", "10-K", "0000040545-23-000023"],
    [None, "2022-12-31", 188851000000, "2023-04-25", "10-Q", "0000040545-23-000136"],
    [None, "2022-12-31", 188851000000, "2024-02-02", "10-K", "0000040545-24-000027"],
    [None, "2023-12-31", 163045000000, "2024-02-02", "10-K", "0000040545-24-000027"],
    [None, "2023-12-31", 173300000000, "2024-07-23", "10-Q", "0000040545-24-000176"],
    [None, "2023-12-31", 173300000000, "2025-02-03", "10-K", "0000040545-25-000015"],
    [None, "2025-09-30", 128243000000, "2025-10-21", "10-Q", "0000040545-25-000200"],
    [None, "2025-12-31", 130169000000, "2026-01-29", "10-K", "0000040545-26-000008"],
]
GE_CONCEPTS = {"Revenues": GE_REVENUES, "NetIncomeLoss": GE_NET_INCOME, "Assets": GE_ASSETS}

FY22 = dt.date(2022, 12, 31)
FY23 = dt.date(2023, 12, 31)


def ge_doc() -> dict:
    """GE's production fund.json shape, cut to three annual and one quarterly column."""
    return {
        "schema": 1, "ticker": "GE", "asof": "2026-10-18", "quote_currency": "USD",
        "stmt_currency": "USD",
        "src": {"statements": "yfinance", "estimates": None, "dividends": "yfinance"},
        "stats": {"mktcap": 3.0e11},
        "statements": {
            "annual": {
                "periods": ["2022", "2023", "2025"],
                "period_end": ["2022-12-31", "2023-12-31", "2025-12-31"],
                "income": {"revenue": [29139000000, 35348000000, 45855000000],
                           "net_income": [336000000, 9482000000, 8704000000]},
                "balance": {"assets": [188851000000, 173300000000, 130169000000]},
                "cashflow": {"fcf": [1, 2, 3]},
            },
            "quarterly": {
                "periods": ["Q3 '25"],
                "period_end": ["2025-09-30"],
                "income": {"revenue": [12181000000], "net_income": [2157000000]},
                "balance": {"assets": [128243000000]},
                "cashflow": {},
            },
        },
        "ratios": {"current": {"ev_sales": 4.2}},
    }


def outcome(rows, end, displayed, timeframe="annual", instant=False):
    return sl.concept_outcome(rows, end, timeframe, instant, displayed)


# ───────────────────────────── one concept, one column ─────────────────────────────
def test_ge_fy2022_revenue_is_the_recast_figure_and_says_so():
    got = outcome(GE_REVENUES, FY22, 29139000000)
    assert got["status"] == "matched"
    assert got["filed"] == "2025-02-03"
    assert got["restated"] is True


def test_rounding_between_filings_is_not_a_restatement():
    got = outcome(GE_NET_INCOME, FY23, 9482000000)
    assert got == {"status": "matched", "filed": "2024-02-02", "restated": False, "last_filed": "2026-01-29"}


def test_a_displayed_figure_sec_has_since_replaced_makes_no_claim():
    # The ORIGINAL 76,555M is a real SEC figure, but no longer the current one: stamping it
    # with any date would present a superseded number as the filed fact.
    assert outcome(GE_REVENUES, FY22, 76555000000) == {"status": "superseded"}
    assert outcome(GE_REVENUES, FY22, 58100000000) == {"status": "superseded"}


def test_a_figure_sec_never_reported_is_unmatched():
    assert outcome(GE_REVENUES, FY22, 12345) == {"status": "unmatched"}


def test_no_facts_or_no_displayed_value_is_absent():
    assert outcome([], FY22, 29139000000) == {"status": "absent"}
    assert outcome(GE_REVENUES, FY22, None) == {"status": "absent"}
    assert outcome(GE_REVENUES, dt.date(2019, 12, 31), 1.0) == {"status": "absent"}


def test_duration_filter_keeps_quarters_and_nine_months_out_of_the_wrong_column():
    q3 = dt.date(2025, 9, 30)
    assert outcome(GE_REVENUES, q3, 12181000000, "quarterly")["status"] == "matched"
    # The nine-month YTD fact ends the same day; it must never match a quarterly column.
    assert outcome(GE_REVENUES, q3, 34400000000, "quarterly") == {"status": "unmatched"}
    # Nor may a quarter or a nine-month fact match an annual column ending that day.
    assert outcome(GE_REVENUES, q3, 12181000000, "annual") == {"status": "absent"}


def test_end_date_window_absorbs_month_end_normalisation_only():
    rows = [["2024-09-29", "2025-09-27", 416161000000, "2025-10-31", "10-K", "a"]]
    assert outcome(rows, dt.date(2025, 9, 30), 416161000000)["status"] == "matched"   # AAPL, 3 days
    assert outcome(rows, dt.date(2025, 10, 7), 416161000000)["status"] == "matched"   # 10 days
    assert outcome(rows, dt.date(2025, 10, 8), 416161000000) == {"status": "absent"}  # 11 days


def test_instant_anchor_ignores_duration_facts_and_flows_ignore_instants():
    flow_as_instant = [["2022-01-01", "2022-12-31", 188851000000, "2024-02-02", "10-K", "a"]]
    assert outcome(flow_as_instant, FY22, 188851000000, instant=True) == {"status": "absent"}
    instant_as_flow = [[None, "2022-12-31", 29139000000, "2025-02-03", "10-K", "a"]]
    assert outcome(instant_as_flow, FY22, 29139000000) == {"status": "absent"}


def test_balance_sheet_recast_after_spin_off_is_a_restatement():
    got = outcome(GE_ASSETS, FY22, 188851000000, instant=True)
    assert got["status"] == "matched" and got["filed"] == "2023-04-25" and got["restated"] is True


# ───────────────────────────── anchors and columns ─────────────────────────────
def test_two_revenue_tags_are_never_pooled_into_a_fake_restatement():
    # A filer carrying total revenue under one tag and contract revenue under another: the
    # contract figure is a different measure, not an earlier version of the total.
    concepts = {
        "Revenues": [["2023-01-01", "2023-12-31", 100.0e9, "2024-02-02", "10-K", "a"]],
        "RevenueFromContractWithCustomerExcludingAssessedTax":
            [["2023-01-01", "2023-12-31", 90.0e9, "2023-02-02", "10-K", "b"]],
    }
    period_set = {"periods": ["2023"], "period_end": ["2023-12-31"],
                  "income": {"revenue": [100.0e9]}, "balance": {}}
    cols = sl.set_lineage(period_set, "annual", concepts)
    assert cols == [{"kind": "attributed", "filed": "2024-02-02", "restated": False}]


def test_column_claim_combines_anchors():
    m = lambda f, r=False, last=None: {"status": "matched", "filed": f, "restated": r, "last_filed": last or f}  # noqa: E731
    assert sl.column_lineage([m("2025-02-03", True), m("2024-02-02"), m("2023-04-25", True)]) == \
        {"kind": "attributed", "filed": "2025-02-03", "restated": True}
    assert sl.column_lineage([m("2024-02-02"), {"status": "absent"}]) == \
        {"kind": "attributed", "filed": "2024-02-02", "restated": False}
    # One anchor disagreeing with SEC voids the whole column's claim.
    assert sl.column_lineage([m("2025-02-03", True), {"status": "superseded"}])["kind"] == "superseded_display"
    assert sl.column_lineage([m("2025-02-03", True), {"status": "unmatched"}]) == \
        {"kind": "unattributed", "filed": None, "restated": False}
    assert sl.column_lineage([{"status": "absent"}] * 3)["kind"] == "no_anchor"


def test_ge_columns_end_to_end():
    out, counts = sl.annotate_doc(ge_doc(), GE_CONCEPTS)
    annual = out["statements"]["annual"]
    assert annual["filed_by_period"] == ["2025-02-03", "2025-02-03", "2026-01-29"]
    assert annual["restated_by_period"] == [True, True, False]
    quarterly = out["statements"]["quarterly"]
    assert quarterly["filed_by_period"] == ["2025-10-21"]
    assert quarterly["restated_by_period"] == [False]
    assert out["src"]["statement_lineage"] == "sec_companyfacts"
    assert counts["attributed"] == 4 and counts["restated"] == 2


def test_a_column_showing_the_superseded_figure_is_not_stamped():
    doc = ge_doc()
    doc["statements"]["annual"]["income"]["revenue"][0] = 76555000000
    out, counts = sl.annotate_doc(doc, GE_CONCEPTS)
    annual = out["statements"]["annual"]
    assert annual["filed_by_period"][0] is None and annual["restated_by_period"][0] is False
    assert counts["superseded_display"] == 1


# ───────────────────────────── what the file may and may not gain ─────────────────────────────
def strip_lineage(doc: dict) -> dict:
    doc = json.loads(json.dumps(doc))
    doc.get("src", {}).pop("statement_lineage", None)
    for s in (doc.get("statements") or {}).values():
        s.pop("filed_by_period", None)
        s.pop("restated_by_period", None)
    return doc


def test_nothing_but_the_two_arrays_and_the_source_tag_changes():
    before = ge_doc()
    out, _ = sl.annotate_doc(before, GE_CONCEPTS)
    assert strip_lineage(out) == before
    assert before == ge_doc(), "the input document must not be mutated"


def test_an_existing_stamp_is_kept_and_restated_only_accumulates():
    doc = ge_doc()
    doc["statements"]["annual"]["filed_by_period"] = ["2025-02-04", None, None]
    doc["statements"]["annual"]["restated_by_period"] = [False, False, True]
    out, _ = sl.annotate_doc(doc, GE_CONCEPTS)
    assert out["statements"]["annual"]["filed_by_period"] == ["2025-02-04", "2025-02-03", "2026-01-29"]
    assert out["statements"]["annual"]["restated_by_period"] == [True, True, True]


def test_no_arrays_and_no_source_tag_without_an_attribution():
    doc = ge_doc()
    out, counts = sl.annotate_doc(doc, {})
    assert out == doc
    assert counts["no_anchor"] == 4


def test_misaligned_arrays_skip_the_set():
    doc = ge_doc()
    doc["statements"]["annual"]["income"]["revenue"] = [29139000000]
    out, _ = sl.annotate_doc(doc, GE_CONCEPTS)
    assert "filed_by_period" not in out["statements"]["annual"]
    assert out["statements"]["quarterly"]["filed_by_period"] == ["2025-10-21"]


# ───────────────────────────── refresh order, index, client ─────────────────────────────
def test_refresh_order_filed_then_uncached_by_size_then_oldest_stale():
    old = lambda days: {"status": "ok", "concepts": {}, "fetched_at": (NOW - dt.timedelta(days=days)).isoformat()}  # noqa: E731
    entries = {1: old(1), 2: None, 3: None, 4: old(40), 5: old(90), 6: None, 7: old(31)}
    mktcap = {1: 5.0, 2: 1.0, 3: 9.0, 6: None}
    order = sl.plan_refresh([1, 2, 3, 4, 5, 6, 7], entries, flagged={1, 99}, mktcap=mktcap, now=NOW, max_fetch=100)
    assert order == [1, 3, 2, 6, 5, 4, 7]
    assert sl.plan_refresh([1, 2, 3, 4, 5, 6, 7], entries, {1}, mktcap, NOW, max_fetch=3) == [1, 3, 2]


def test_daily_index_parsing_keeps_only_statement_forms():
    text = (
        "Description:           Daily Index of EDGAR Dissemination Feed by Form Type\n"
        "Form Type   Company Name                                                  CIK         Date Filed  File Name\n"
        "---------------------------------------------------------------------------------------------------------\n"
        "10-K        GENERAL ELECTRIC CO                                           40545       20260129    edgar/data/40545/0000040545-26-000008.txt\n"
        "10-Q/A      SOME CO                                                       1234        20260129    edgar/data/1234/0000001234-26-000001.txt\n"
        "8-K         APPLE INC                                                     320193      20260129    edgar/data/320193/0000320193-26-000002.txt\n"
        "4           INSIDER FILING                                                777         20260129    edgar/data/777/0000000777-26-000001.txt\n"
        "SC 13G      HOLDER                                                        888         20260129    edgar/data/888/0000000888-26-000001.txt\n"
    )
    assert sl.parse_daily_index(text) == {40545, 1234, 320193}


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.urls = []

    def get(self, url):
        self.urls.append(url)
        for key, value in self.responses.items():
            if key in url:
                return value
        return 404, None


def idx(ciks):
    return ("\n".join(f"10-K        CO {c}    {c}    20261015    edgar/data/{c}/x.txt" for c in ciks)).encode()


def test_index_skips_missing_days_and_advances_only_to_the_last_published_day():
    client = FakeClient({"form.20261015": (200, idx([1])), "form.20261016": (200, idx([2])),
                         "form.20261017": (403, None), "form.20261018": (403, None)})
    ok, flagged, last = sl.read_index(client, {"last_date": "2026-10-14"}, dt.date(2026, 10, 19))
    assert (ok, flagged, last) == (True, {1, 2}, "2026-10-16")
    assert [u.rsplit(".", 2)[-2] for u in client.urls] == ["20261015", "20261016", "20261017", "20261018", "20261019"]
    assert "QTR4" in client.urls[0]


def test_index_failure_reports_not_ok_and_keeps_the_processed_day():
    client = FakeClient({"form.20261015": (200, idx([1])), "form.20261016": (500, None)})
    assert sl.read_index(client, {"last_date": "2026-10-14"}, dt.date(2026, 10, 19)) == (False, set(), "2026-10-14")


def test_index_first_run_looks_back_ten_days():
    client = FakeClient({})
    sl.read_index(client, {}, dt.date(2026, 10, 19))
    assert len(client.urls) == 11 and "20261009" in client.urls[0]


def test_client_retries_throttling_and_server_errors_but_not_missing():
    calls, sleeps, clock = [], [], [0.0]

    def fetch(url):
        calls.append(url)
        return {1: (429, None), 2: (503, None)}.get(len(calls), (200, b"{}"))

    c = sl.SecClient(fetch=fetch, sleep=lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)),
                     clock=lambda: clock[0])
    assert c.get("u") == (200, b"{}") and len(calls) == 3
    calls.clear()
    c2 = sl.SecClient(fetch=lambda u: (calls.append(u), (404, None))[1], sleep=lambda s: None, clock=lambda: 0.0)
    assert c2.get("u") == (404, None) and len(calls) == 1


def test_client_throttles_to_five_requests_per_second():
    sleeps, clock = [], [0.0]
    c = sl.SecClient(fetch=lambda u: (200, b""), sleep=lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)),
                     clock=lambda: clock[0])
    for _ in range(3):
        c.get("u")
    assert sleeps == [pytest.approx(0.2), pytest.approx(0.2)]


def test_compact_extract_keeps_only_anchor_usd_facts():
    facts = {"facts": {"us-gaap": {
        "Revenues": {"units": {"USD": [{"start": "2022-01-01", "end": "2022-12-31", "val": 29139000000,
                                        "filed": "2025-02-03", "form": "10-K", "accn": "x"},
                                       {"end": "2022-12-31", "filed": "2025-02-03"}]}},
        "Assets": {"units": {"EUR": [{"end": "2022-12-31", "val": 1, "filed": "2025-02-03"}]}},
        "Goodwill": {"units": {"USD": [{"end": "2022-12-31", "val": 1, "filed": "2025-02-03"}]}},
    }}}
    assert sl.compact_extract(facts) == {"Revenues": [["2022-01-01", "2022-12-31", 29139000000, "2025-02-03", "10-K", "x"]]}


# ───────────────────────────── the pass, end to end ─────────────────────────────
def companyfacts_body() -> bytes:
    def units(rows):
        return {"units": {"USD": [{"start": r[0], "end": r[1], "val": r[2], "filed": r[3], "form": r[4], "accn": r[5]}
                                  if r[0] else {"end": r[1], "val": r[2], "filed": r[3], "form": r[4], "accn": r[5]}
                                  for r in rows]}}
    return json.dumps({"cik": GE_CIK, "facts": {"us-gaap": {k: units(v) for k, v in GE_CONCEPTS.items()}}}).encode()


TICKERS = json.dumps({"0": {"cik_str": GE_CIK, "ticker": "GE", "title": "GE"},
                      "1": {"cik_str": 1067983, "ticker": "BRK-B", "title": "Berkshire"}}).encode()


@pytest.fixture
def world(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    cache = tmp_path / "cache"
    monkeypatch.setenv("SEC_LINEAGE_CACHE", str(cache))
    (data / "GE.fund.json").write_text(dump(ge_doc()))
    hk = ge_doc()
    hk["ticker"], hk["stmt_currency"] = "0700.HK", "HKD"
    (data / "0700.HK.fund.json").write_text(dump(hk))
    unknown = ge_doc()
    unknown["ticker"] = "ZZZZ"
    (data / "ZZZZ.fund.json").write_text(dump(unknown))
    client = FakeClient({"company_tickers.json": (200, TICKERS), f"CIK{GE_CIK:010d}": (200, companyfacts_body())})
    return data, cache, client


def run(data, client, *extra):
    return sl.run(["--data-dir", str(data), *extra], client=client, now=NOW)


def test_run_stamps_the_file_and_a_second_run_is_byte_identical(world, capsys):
    data, cache, client = world
    assert run(data, client) == 0
    receipt = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert receipt["schema"] == "mastermind.sec_lineage_receipt/v1"
    assert (receipt["files"], receipt["usd"], receipt["no_cik"], receipt["fetched"]) == (3, 2, 1, 1)
    assert receipt["annotated_files"] == 1 and receipt["columns"]["restated"] == 2
    assert receipt["index_ok"] is True
    ge = json.loads((data / "GE.fund.json").read_text())
    assert ge["statements"]["annual"]["filed_by_period"] == ["2025-02-03", "2025-02-03", "2026-01-29"]
    assert strip_lineage(ge) == ge_doc()
    assert json.loads((cache / "last_receipt.json").read_text()) == receipt
    state = json.loads((cache / "index_state.json").read_text())
    assert state == {"last_date": None, "pending": []}

    before = {p.name: p.read_bytes() for p in data.iterdir()}
    mtimes = {p.name: p.stat().st_mtime_ns for p in data.iterdir()}
    assert run(data, None, "--offline") == 0
    receipt2 = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert receipt2["fetched"] == 0 and receipt2["annotated_files"] == 0
    assert {p.name: p.read_bytes() for p in data.iterdir()} == before
    assert {p.name: p.stat().st_mtime_ns for p in data.iterdir()} == mtimes


def test_gen_fund_us_rebuild_drops_the_arrays_and_the_cache_restores_them(world, capsys):
    data, cache, client = world
    run(data, client)
    (data / "GE.fund.json").write_text(dump(ge_doc()))   # tonight's gen_fund_us output
    assert run(data, None, "--offline") == 0
    ge = json.loads((data / "GE.fund.json").read_text())
    assert ge["statements"]["annual"]["restated_by_period"] == [True, True, False]


def test_dry_run_writes_no_data_and_does_not_advance_the_index(world, capsys):
    data, cache, client = world
    before = (data / "GE.fund.json").read_bytes()
    assert run(data, client, "--dry-run") == 0
    receipt = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert receipt["dry_run"] is True and receipt["annotated_files"] == 1
    assert (data / "GE.fund.json").read_bytes() == before
    assert not (cache / "index_state.json").exists()


def test_a_file_dump_would_rewrite_differently_is_never_touched(world, capsys):
    data, cache, client = world
    foreign = ge_doc()
    foreign["lineage_note"] = "kept by some other writer"
    (data / "GE.fund.json").write_text(json.dumps(foreign))
    before = (data / "GE.fund.json").read_bytes()
    assert run(data, client) == 0
    receipt = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert receipt["unsafe_shape"] == 1 and receipt["annotated_files"] == 0
    assert (data / "GE.fund.json").read_bytes() == before
    # Same top-level keys, different serialisation: also untouched.
    (data / "GE.fund.json").write_text(json.dumps(ge_doc(), indent=1))
    assert run(data, None, "--offline") == 0
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["unsafe_shape"] == 1


def test_companyfacts_404_is_cached_and_annotates_nothing(world, capsys):
    data, cache, _ = world
    client = FakeClient({"company_tickers.json": (200, TICKERS), f"CIK{GE_CIK:010d}": (404, None)})
    assert run(data, client) == 0
    receipt = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert receipt["no_companyfacts"] == 1 and receipt["annotated_files"] == 0
    assert json.loads((cache / "facts" / f"CIK{GE_CIK:010d}.json").read_text())["status"] == "no_companyfacts"


def test_fetch_errors_are_partial_failure_and_a_corrupt_cache_entry_is_refetched(world, capsys):
    data, cache, _ = world
    bad = FakeClient({"company_tickers.json": (200, TICKERS), f"CIK{GE_CIK:010d}": (500, None)})
    assert run(data, bad) == 0
    receipt = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert receipt["fetch_errors"] == 1 and receipt["annotated_files"] == 0
    (cache / "facts").mkdir(parents=True, exist_ok=True)
    (cache / "facts" / f"CIK{GE_CIK:010d}.json").write_text("{not json")
    good = FakeClient({"company_tickers.json": (200, TICKERS), f"CIK{GE_CIK:010d}": (200, companyfacts_body())})
    assert run(data, good) == 0
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["fetched"] == 1


def test_an_unrefreshed_flagged_filer_stays_pending(world, capsys):
    data, cache, _ = world
    client = FakeClient({"company_tickers.json": (200, TICKERS),
                         "form.20261016": (200, idx([GE_CIK])), f"CIK{GE_CIK:010d}": (500, None)})
    run(data, client)
    assert json.loads((cache / "index_state.json").read_text()) == {"last_date": "2026-10-16", "pending": [GE_CIK]}


def test_no_ticker_map_at_all_is_the_only_hard_failure(world, capsys):
    data, cache, _ = world
    assert run(data, FakeClient({"company_tickers.json": (503, None)})) == 1
    assert run(data, None, "--offline") == 1


def test_gzip_bodies_are_decoded(monkeypatch):
    class Resp:
        status = 200
        headers = {"Content-Encoding": "gzip"}

        def read(self):
            return gzip.compress(b'{"ok":1}')

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    seen = {}

    def fake_urlopen(req, timeout):
        seen["ua"], seen["timeout"] = req.get_header("User-agent"), timeout
        return Resp()

    monkeypatch.setattr(sl.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    assert sl.urlopen_fetch("https://data.sec.gov/x") == (200, b'{"ok":1}')
    assert seen == {"ua": sl.DEFAULT_UA, "timeout": 30}


# ───────────────────────────── wiring ─────────────────────────────
NIGHTLY_FUND = ROOT / "ops" / "nightly_fund.sh"


def test_the_nightly_runs_the_pass_after_gen_and_before_the_deploy_gates():
    text = NIGHTLY_FUND.read_text()
    gen = text.index('"$PY" "$DEPLOY/ingest/gen_fund_us.py"')
    stage = text.index('"$PY" "$DEPLOY/ingest/annotate_sec_lineage.py"')
    gates = text.index("# 4. SAFETY GATES")
    rsync = text.index("# 5. rsync")
    assert gen < stage < gates < rsync
    # A lineage failure must never stop the fundamentals deploy: no stamp is the safe state.
    line = text[stage:text.index("\n", text.index("\n", stage) + 1)]
    assert "|| echo" in line and "exit" not in line


def test_the_pass_imports_as_the_nightly_runs_it():
    # The nightly runs `$PY ingest/annotate_sec_lineage.py`, so sys.path[0] is ingest/, not the root.
    res = subprocess.run([sys.executable, "-c", "import annotate_sec_lineage"], cwd=ROOT / "ingest",
                         capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
