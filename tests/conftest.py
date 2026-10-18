"""Shared pytest hooks for the intraday backfill test modules."""

import pytest

_INTRADAY_RUN_DATE_MODULES = frozenset({
    "test_backfill_intraday",
    "test_backfill_intraday_breaker",
    "test_backfill_intraday_refresh",
})


@pytest.fixture(autouse=True)
def _pin_intraday_run_date_et(monkeypatch, request):
    if request.module.__name__ in _INTRADAY_RUN_DATE_MODULES:
        monkeypatch.setenv("INTRADAY_RUN_DATE_ET", "2026-11-27")
