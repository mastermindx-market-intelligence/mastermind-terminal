"""Shared pytest hooks and explicit ownership for release test fixtures."""

import os

import pytest

# Reporter activates only for the canonical CI Ingest job; test selection is unchanged.
pytest_plugins = ["scripts.ci_pytest_results"]


@pytest.fixture(scope="session", autouse=True)
def _fixture_creation_umask():
    """Give fresh test fixtures safe defaults while preserving explicit modes."""
    previous = os.umask(0o022)
    try:
        yield
    finally:
        os.umask(previous)


@pytest.fixture(scope="session", autouse=True)
def _terminal_build_memory_admission_is_not_the_test_host():
    """Keep sandboxed terminal-build.sh runs independent of this machine's memory.

    The deploy owner refuses to start when MemAvailable + SwapFree is below its
    floor, and refuses when /proc/meminfo cannot be read at all. A sandbox that
    executes the real deploy body would therefore pass or fail on whatever the CI
    runner or a macOS workstation happens to have free. The operator's documented
    per-invocation override is the one input that decides it, so pin that for the
    session. Tests of the admission itself pass their own value and a meminfo
    fixture; they never read this default.
    """
    previous = os.environ.get("BUILD_MIN_AVAILABLE_MB")
    os.environ["BUILD_MIN_AVAILABLE_MB"] = "0"
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("BUILD_MIN_AVAILABLE_MB", None)
        else:
            os.environ["BUILD_MIN_AVAILABLE_MB"] = previous


_INTRADAY_RUN_DATE_MODULES = frozenset({
    "test_backfill_intraday",
    "test_backfill_intraday_breaker",
    "test_backfill_intraday_refresh",
})


@pytest.fixture(autouse=True)
def _pin_intraday_run_date_et(monkeypatch, request):
    if request.module.__name__ in _INTRADAY_RUN_DATE_MODULES:
        monkeypatch.setenv("INTRADAY_RUN_DATE_ET", "2026-11-27")



_TERMINAL_RECEIPT_MODULES = frozenset({
    "test_terminal_build_admission",
    "test_terminal_build_rollback",
})


@pytest.fixture(autouse=True)
def _terminal_receipt_fixture_group(request):
    """Give fresh fixture descendants the executor's real receipt-custody GID.

    macOS inherits a new entry's group from its parent. Its /private/tmp group
    can differ from the invoking user's effective group, so an ordinary pytest
    directory is not automatically a valid model of the root-owned deploy tree.
    Establish the fixture root before any receipt is written; the production
    validator remains unchanged and still rejects a mismatched receipt group.
    """
    module = request.module.__name__.rsplit(".", 1)[-1]
    if module in _TERMINAL_RECEIPT_MODULES and "tmp_path" in request.fixturenames:
        temporary_root = request.getfixturevalue("tmp_path")
        os.chown(temporary_root, -1, os.getegid())
        assert temporary_root.stat().st_gid == os.getegid()
