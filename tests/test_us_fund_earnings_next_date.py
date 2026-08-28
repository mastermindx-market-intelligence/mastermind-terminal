"""Regression coverage for the US fund emitter's next-earnings date contract."""

import datetime as dt

import pytest

from ingest import earnings_calendar, gen_fund_us

OBSERVATION_DAY = dt.date(2026, 8, 26)


@pytest.fixture(autouse=True)
def _frozen_observation_day(monkeypatch):
    """Freeze the emitter's UTC observation day without using the wall clock."""
    monkeypatch.setattr(earnings_calendar, "utc_today", lambda: OBSERVATION_DAY)


@pytest.mark.parametrize(
    ("calendar_dates", "expected_next_date"),
    [
        (["2026-08-25"], None),
        (["2026-08-25", "2026-10-01", "2026-09-15"], "2026-09-15"),
        (["2026-08-26"], "2026-08-26"),
        (["not-a-date", "2026-09-20"], "2026-09-20"),
    ],
    ids=("past-only", "past-plus-future", "today", "malformed-plus-future"),
)
def test_build_earnings_emits_only_the_earliest_known_non_past_calendar_date(
    calendar_dates,
    expected_next_date,
):
    """A blind first-item calendar selection must never escape as ``next_date``."""

    earnings = gen_fund_us.build_earnings(
        {"calendar": {"Earnings Date": calendar_dates}},
        fy_end_m=12,
        tx_ids=None,
    )

    assert earnings["next_date"] == expected_next_date


def test_krus_shaped_stale_calendar_publishes_no_next_date():
    """The exact production counterexample from mastermind-terminal#474.

    KRUS served ``next_date: '2026-07-07'`` on 2026-08-26 — 50 days past — which the rail
    rendered as "Next earnings report — 50 days ago".
    """
    earnings = gen_fund_us.build_earnings(
        {"calendar": {"Earnings Date": ["2026-07-07"]}},
        fy_end_m=12,
        tx_ids=None,
    )

    assert earnings["next_date"] is None
    # A missing future date must not be back-filled from the last known report.
    assert earnings["next_period"] is None


def test_a_valid_future_date_is_still_published():
    """Failing closed must not become failing empty: real upcoming dates survive."""
    earnings = gen_fund_us.build_earnings(
        {"calendar": {"Earnings Date": ["2026-10-29"]}},
        fy_end_m=12,
        tx_ids=None,
    )

    assert earnings["next_date"] == "2026-10-29"
