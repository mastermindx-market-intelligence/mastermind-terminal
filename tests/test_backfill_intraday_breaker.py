import concurrent.futures
import json
import re
from unittest.mock import patch

import pytest

import test_backfill_intraday as base
from test_backfill_intraday import intraday_env  # noqa: F401  (pytest fixture)

mod = base.mod


def stores(intraday_env, n):
    snapshot = {}
    for i in range(n):
        sym = f"S{i:03d}"
        path = intraday_env / f"{sym}.1h.json"
        base.make_store(path, sym, "1h", 30)
        snapshot[path] = path.read_bytes()
    return snapshot


def untouched(snapshot):
    for path, data in snapshot.items():
        assert path.read_bytes() == data


class _SequentialPool:
    """Run pool jobs in submit order when as_completed runs — matches workers=1 semantics."""

    def __init__(self, max_workers=1):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def submit(self, fn, job):
        fut = concurrent.futures.Future()
        fut._job_fn = fn  # type: ignore[attr-defined]
        fut._job_arg = job  # type: ignore[attr-defined]
        return fut


def _sequential_as_completed(futures):
    for fut in futures:
        if fut.cancelled():
            yield fut
            continue
        if not fut.done():
            try:
                fut.set_result(fut._job_fn(fut._job_arg))  # type: ignore[attr-defined]
            except BaseException as exc:
                fut.set_exception(exc)
        yield fut


def run(fake, argv=None):
    with patch.object(mod, "fetch_polygon_intraday", fake):
        with patch.object(mod, "ThreadPoolExecutor", _SequentialPool):
            with patch.object(mod, "as_completed", _sequential_as_completed):
                return mod.main(argv or ["--existing-only", "--tf", "1h", "--workers", "1"])


def detail(out):
    m = re.search(
        r"^intraday backfill detail: rebuilt=(\d+) basis_unverified=(\d+) "
        r"transport_failed=(\d+) skipped=(\d+) breaker=(clear|TRIPPED)$",
        out,
        re.MULTILINE,
    )
    assert m, f"no detail line in:\n{out}"
    return {
        "rebuilt": int(m.group(1)),
        "basis_unverified": int(m.group(2)),
        "transport_failed": int(m.group(3)),
        "skipped": int(m.group(4)),
        "breaker": m.group(5),
    }


_COMPLETE_RE = re.compile(
    r"^intraday backfill complete: \d+/\d+ stored "
    r"\(unchanged=\d+ failed=\d+ retention_dropped=\d+ "
    r"forming_skipped=\d+ delayed_pages=\d+\) in \d+s$",
    re.MULTILINE,
)
_DETAIL_RE = re.compile(
    r"^intraday backfill detail: rebuilt=\d+ basis_unverified=\d+ "
    r"transport_failed=\d+ skipped=\d+ breaker=(clear|TRIPPED)$",
    re.MULTILINE,
)


def test_t01_breaker_trips_on_consecutive_transport(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 5)
    snap = stores(intraday_env, 40)
    calls = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        calls["n"] += 1
        raise mod.TransportExhausted("vendor down")

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 3 == mod.EXIT_BREAKER_TRIPPED
    assert calls["n"] in (5, 6)
    assert "BREAKER: vendor unreachable" in out
    d = detail(out)
    assert d["breaker"] == "TRIPPED"
    assert d["transport_failed"] in (5, 6)
    assert d["transport_failed"] + d["skipped"] == 40
    untouched(snap)


def test_t02_consecutive_streak_resets(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 5)
    stores(intraday_env, 20)
    calls = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        idx = calls["n"]
        calls["n"] += 1
        if idx % 5 == 4:
            return mod.load_store(sym, tf)[0][-6:]
        raise mod.TransportExhausted("vendor down")

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    assert calls["n"] == 20
    d = detail(out)
    assert d["breaker"] == "clear"
    assert d["transport_failed"] == 16
    assert d["skipped"] == 0
    assert "BREAKER" not in out


def test_t03_breaker_trips_on_failure_fraction(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 10**9)
    monkeypatch.setattr(mod, "BREAKER_MIN_SAMPLE", 10)
    monkeypatch.setattr(mod, "BREAKER_FRACTION", 0.5)
    stores(intraday_env, 30)
    calls = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        idx = calls["n"]
        calls["n"] += 1
        if idx % 3 == 2:
            return mod.load_store(sym, tf)[0][-6:]
        raise mod.TransportExhausted("vendor down")

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 3
    assert calls["n"] in (10, 11)
    d = detail(out)
    assert d["breaker"] == "TRIPPED"
    assert d["transport_failed"] in (7, 8)


def test_t04_fraction_is_strictly_more_than(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 10**9)
    monkeypatch.setattr(mod, "BREAKER_MIN_SAMPLE", 10)
    monkeypatch.setattr(mod, "BREAKER_FRACTION", 0.5)
    stores(intraday_env, 10)
    calls = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        idx = calls["n"]
        calls["n"] += 1
        if idx % 2 == 1:
            return mod.load_store(sym, tf)[0][-6:]
        raise mod.TransportExhausted("vendor down")

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    d = detail(out)
    assert d["breaker"] == "clear"
    assert calls["n"] == 10
    assert d["transport_failed"] == 5


def test_t05_sample_floor_holds(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 10**9)
    monkeypatch.setattr(mod, "BREAKER_MIN_SAMPLE", 50)
    stores(intraday_env, 12)
    calls = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        calls["n"] += 1
        raise mod.TransportExhausted("vendor down")

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    assert calls["n"] == 12
    d = detail(out)
    assert d["breaker"] == "clear"
    assert d["transport_failed"] == 12
    assert d["skipped"] == 0


def test_t06_non_transport_failures_never_trip_breaker(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 3)
    monkeypatch.setattr(mod, "BREAKER_MIN_SAMPLE", 5)
    snap = stores(intraday_env, 12)
    calls = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        calls["n"] += 1
        raise RuntimeError("boom")

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    assert calls["n"] == 12
    d = detail(out)
    assert d["breaker"] == "clear"
    assert d["transport_failed"] == 0
    assert "failed=12" in out
    untouched(snap)


def test_t07_transport_failure_reported_by_class_name(intraday_env, capsys):
    stores(intraday_env, 1)
    msg = "Polygon aggregate retries exhausted after 5 attempts"

    def fake(sym, tf, frm=None, **kwargs):
        raise mod.TransportExhausted(msg)

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    assert f"FAILED S000.1h: TransportExhausted: {msg}" in out
    d = detail(out)
    assert d["transport_failed"] == 1
    assert "failed=1" in out


def test_t08_exit_constants():
    assert mod.EXIT_OK == 0
    assert mod.EXIT_STORE_FAILURES == 1
    assert mod.EXIT_NO_STORES == 2
    assert mod.EXIT_BREAKER_TRIPPED == 3
    assert mod.EXIT_USAGE == 64
    assert issubclass(mod.TransportExhausted, RuntimeError)
    assert issubclass(mod.EmptyOverlap, RuntimeError)
    assert issubclass(mod.AdjustmentMismatch, RuntimeError)


@pytest.mark.parametrize(
    "extra",
    [["--existing-only", "--update"], ["--existing-only", "--force"]],
)
def test_t09_usage_errors(intraday_env, capsys, extra):
    snap = stores(intraday_env, 3)
    called = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        called["n"] += 1
        return mod.load_store(sym, tf)[0][-6:]

    with patch.object(mod, "fetch_polygon_intraday", fake):
        rc = mod.main(extra + ["--tf", "1h"])
    out = capsys.readouterr().out
    assert rc == 64
    assert called["n"] == 0
    untouched(snap)
    assert "--existing-only cannot be combined with --update or --force" in out
    assert "intraday backfill complete" not in out


def test_t10_two_summary_lines_clean_run(intraday_env, capsys):
    stores(intraday_env, 3)
    calls = {"n": 0}

    def fake(sym, tf, frm=None, **kwargs):
        calls["n"] += 1
        return mod.load_store(sym, tf)[0][-6:]

    rc = run(fake)
    out = capsys.readouterr().out
    complete = list(_COMPLETE_RE.finditer(out))
    detail_lines = list(_DETAIL_RE.finditer(out))
    assert len(complete) == 1
    assert len(detail_lines) == 1
    assert complete[0].start() < detail_lines[0].start()
    assert rc == 0
    assert "0/3 stored (unchanged=3 failed=0" in out


def test_t11_two_summary_lines_tripped_run(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 5)
    stores(intraday_env, 40)

    def fake(sym, tf, frm=None, **kwargs):
        raise mod.TransportExhausted("vendor down")

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 3
    complete = list(_COMPLETE_RE.finditer(out))
    detail_lines = list(_DETAIL_RE.finditer(out))
    assert len(complete) == 1
    assert len(detail_lines) == 1
    assert detail_lines[0].group(0).endswith("breaker=TRIPPED")


def test_t12_tripped_run_prints_each_failure(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "BREAKER_CONSECUTIVE", 5)
    stores(intraday_env, 40)

    def fake(sym, tf, frm=None, **kwargs):
        raise mod.TransportExhausted("vendor down")

    run(fake)
    out = capsys.readouterr().out
    d = detail(out)
    failed_lines = [ln for ln in out.splitlines() if ln.startswith("  FAILED ")]
    assert len(failed_lines) == d["transport_failed"]
