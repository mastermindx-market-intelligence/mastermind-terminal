"""The ``fund.earnings.next_date`` temporal contract, shared by all three emitters.

``next_date`` is a claim about the future. Every fundamentals family (US / HK / CN) must
publish either a present-or-future calendar day or nothing at all — see
mastermind-terminal#474, where three separate production artifacts violated this at once:

    KRUS       next_date '2026-07-07'  (50 days past)   — US emitter
    9988.HK    next_date '2026-08-20'  (6 days past)    — HK emitter
    600519.SS  next_date 'nan'         (malformed)      — CN emitter
"""

import datetime as dt

import pytest

from ingest import collect_cn_hk_fund, earnings_calendar, gen_fund_cn, gen_fund_hk
from ingest.earnings_calendar import select_next_earnings_date

OBSERVATION_DAY = dt.date(2026, 8, 26)


@pytest.fixture(autouse=True)
def _frozen_observation_day(monkeypatch):
    monkeypatch.setattr(earnings_calendar, "utc_today", lambda: OBSERVATION_DAY)


# ── the selector itself ──────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (["2026-08-25"], None),
        (["2026-07-07"], None),
        (["2026-08-26"], "2026-08-26"),
        (["2026-08-27"], "2026-08-27"),
        (["2026-10-01", "2026-09-15"], "2026-09-15"),
        (["2026-08-25", "2026-10-01", "2026-09-15"], "2026-09-15"),
        ("2026-10-29", "2026-10-29"),
        (None, None),
        ([], None),
        (["nan"], None),
        (["NaT"], None),
        (["None"], None),
        ([""], None),
        ([float("nan")], None),
        ([None, "2026-09-20"], "2026-09-20"),
        (["not-a-date", "2026-09-20"], "2026-09-20"),
        (["2026-13-45"], None),
        ([dt.date(2026, 9, 1)], "2026-09-01"),
        ([dt.datetime(2026, 9, 1, 23, 30)], "2026-09-01"),
        (["2026-09-01 00:00:00"], "2026-09-01"),
    ],
    ids=[
        "yesterday", "krus-50-days-past", "today-is-valid", "tomorrow",
        "earliest-of-two-future", "earliest-non-past-of-mixed", "bare-string",
        "none", "empty", "nan-string", "nat-string", "none-string", "empty-string",
        "float-nan", "none-in-list", "malformed-plus-future", "impossible-calendar-day",
        "date-object", "datetime-object", "datetime-string",
    ],
)
def test_selector_publishes_only_a_present_or_future_calendar_day(raw, expected):
    assert select_next_earnings_date(raw, today=OBSERVATION_DAY) == expected


def test_the_today_boundary_is_inclusive():
    """A date-only source cannot prove a same-day report already happened, so today stands.

    NVDA and CRM both served next_date == today on 2026-08-26; an exclusive ``> today``
    boundary would have silently deleted two real upcoming events.
    """
    assert select_next_earnings_date(["2026-08-26"], today=OBSERVATION_DAY) == "2026-08-26"
    assert select_next_earnings_date(["2026-08-25"], today=OBSERVATION_DAY) is None


def test_a_future_date_becomes_null_once_it_crosses_into_the_past():
    """The same artifact value, read on two different days, must not stay 'next' forever."""
    raw = ["2026-08-27"]
    assert select_next_earnings_date(raw, today=dt.date(2026, 8, 26)) == "2026-08-27"
    assert select_next_earnings_date(raw, today=dt.date(2026, 8, 28)) is None


def test_a_withdrawn_vendor_date_is_removed_not_retained():
    assert select_next_earnings_date([], today=OBSERVATION_DAY) is None


# ── HK emitter ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("next_earnings", "expected"),
    [("2026-08-20", None), ("2026-11-12", "2026-11-12"), ("2026-08-26", "2026-08-26"),
     (None, None), ("nan", None)],
    ids=("alibaba-past", "tencent-future", "today", "missing", "malformed"),
)
def test_hk_emitter_never_publishes_a_past_next_date(next_earnings, expected):
    earnings = gen_fund_hk.build_earnings({"next_earnings": next_earnings})
    assert earnings["next_date"] == expected


# ── CN emitter ───────────────────────────────────────────────────────────────
def _disclosure(**rec):
    return {"600519.SH": rec}


@pytest.mark.parametrize(
    ("record", "expected_date"),
    [
        ({"end_date": "20260630", "actual_date": "20260715", "pre_date": ""}, None),
        ({"end_date": "20260930", "actual_date": "", "pre_date": "20261025"}, "2026-10-25"),
        ({"end_date": "20260930", "actual_date": "", "pre_date": "20260826"}, "2026-08-26"),
        ({"end_date": "20260630", "actual_date": "nan", "pre_date": ""}, None),
        ({"end_date": "20260630", "actual_date": "", "pre_date": ""}, None),
    ],
    ids=("actual-date-is-past", "pre-date-future", "today", "nan", "empty"),
)
def test_cn_emitter_never_publishes_a_past_next_date(record, expected_date):
    """`actual_date` is the day a report was *filed* — necessarily past, yet preferred upstream."""
    next_date, next_period = gen_fund_cn._next_earnings_info("600519.SH", _disclosure(**record))
    assert next_date == expected_date
    if expected_date is None:
        assert next_period is None, "a period label must not outlive the date it describes"


def test_cn_does_not_inherit_a_stale_next_date_from_the_previous_artifact():
    """The carry-forward path re-proves the preserved date instead of recycling it forever."""
    assert select_next_earnings_date("2026-07-07", today=OBSERVATION_DAY) is None
    assert select_next_earnings_date("2026-10-25", today=OBSERVATION_DAY) == "2026-10-25"


# ── HK collector ─────────────────────────────────────────────────────────────
def test_hk_collector_keeps_the_whole_candidate_set_in_play(monkeypatch):
    """Truncating the vendor list to eds[0] at collect time hid real later dates.

    The emitter can only ever null a bad value it is handed; it cannot recover a
    future date the collector already threw away.
    """
    monkeypatch.setattr(earnings_calendar, "utc_today", lambda: OBSERVATION_DAY)
    select = collect_cn_hk_fund.select_next_earnings_date

    # stale first entry, real second entry: the future date must survive collection
    assert select(["2026-08-20", "2026-11-12"]) == "2026-11-12"
    # past-only still collapses to nothing
    assert select(["2026-08-20"]) is None
    # scalar and malformed vendor shapes are unchanged
    assert select("2026-11-12") == "2026-11-12"
    assert select(["nan"]) is None


# ── pandas null objects ──────────────────────────────────────────────────────
def test_pandas_nulls_are_skipped_rather_than_crashing_the_emitter():
    """``pandas.NaT`` is a *subclass of datetime*, so it defeats an isinstance gate.

    ``NaT.date()`` returns ``NaT`` rather than raising, and comparing that to a real
    date raises ``TypeError: Cannot compare NaT with datetime.date object``. Since the
    CN/HK calendars come out of pandas frames, one null in a vendor calendar would abort
    the emitter mid-run instead of being skipped — the opposite of "malformed candidates
    are ignored". The string ``'NaT'`` does NOT exercise this; only the object does.
    """
    pd = pytest.importorskip("pandas")

    assert select_next_earnings_date([pd.NaT], today=OBSERVATION_DAY) is None
    # a real date alongside a null must still be recovered, not lost with it
    assert select_next_earnings_date([pd.NaT, "2026-10-29"], today=OBSERVATION_DAY) == "2026-10-29"
    assert select_next_earnings_date(pd.Series([pd.NaT]), today=OBSERVATION_DAY) is None
    # genuine Timestamps keep working in both directions
    assert select_next_earnings_date([pd.Timestamp("2026-10-29")], today=OBSERVATION_DAY) == "2026-10-29"
    assert select_next_earnings_date([pd.Timestamp("2026-07-07")], today=OBSERVATION_DAY) is None
    assert select_next_earnings_date(pd.Series(["2026-10-29"]), today=OBSERVATION_DAY) == "2026-10-29"


# ── HK merge-mode ────────────────────────────────────────────────────────────
def test_hk_merge_mode_cannot_resurrect_a_past_next_date():
    """A correct fresh ``None`` must clear a stale date, not lose to it.

    gen_fund_hk's merge-mode is field-level: it starts from the EXISTING artifact and only
    lets a non-empty fresh value overwrite. That is right for "data we might be missing" and
    wrong for a temporal claim — a fresh ``next_date=None`` means "the vendor knows of no
    future report", so preserving the previous artifact's date republishes a past date
    forever and silently defeats the emitter fix. Observed live: 9988.HK regenerated through
    the canonical emitter still served next_date '2026-05-13'.
    """
    existing = {"earnings": {"next_date": "2026-05-13", "next_period": "Q1 2026", "fy": [{"period": "2025"}]}}
    fresh = {"earnings": {"next_date": None, "next_period": None, "fy": [{"period": "2026"}]}}

    merged = gen_fund_hk._merge_fund(fresh, existing)

    assert merged["earnings"]["next_date"] is None
    assert merged["earnings"]["next_period"] is None
    # the non-temporal fields keep their normal merge semantics
    assert merged["earnings"]["fy"] == [{"period": "2026"}]


def test_hk_merge_mode_still_lets_a_real_future_date_through():
    existing = {"earnings": {"next_date": "2026-05-13", "next_period": "Q1 2026"}}
    fresh = {"earnings": {"next_date": "2026-11-12", "next_period": None}}

    merged = gen_fund_hk._merge_fund(fresh, existing)

    assert merged["earnings"]["next_date"] == "2026-11-12"
    assert merged["earnings"]["next_period"] is None
