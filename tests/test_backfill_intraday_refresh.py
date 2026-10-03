import json
import time
from unittest.mock import patch

import pytest

import test_backfill_intraday as base
from test_backfill_intraday import intraday_env  # noqa: F401

mod = base.mod


def rows(n=30, start=1_700_000_000, step=3600, scale=1.0):
    return [
        [start + i * step, (100 + i) * scale, (105 + i) * scale, (99 + i) * scale, (101 + i) * scale, 1000]
        for i in range(n)
    ]


def moved(bars, k):
    return [[r[0], r[1] * k, r[2] * k, r[3] * k, r[4] * k, r[5]] for r in bars]


def put(intraday_env, sym, bars, tf="1h"):
    path = intraday_env / f"{sym}.{tf}.json"
    base._write_store_rows(path, sym, tf, bars)
    return path


def run(fake, argv=None):
    with patch.object(mod, "fetch_polygon_intraday", fake):
        return mod.main(argv or ["--existing-only", "--tf", "1h", "--workers", "1"])


def _read_bars(path):
    return json.loads(path.read_text())["bars"]


def _refresh_tail_plus_new(store, k, n_shared=6):
    tail = moved(store[-n_shared:], k)
    last = store[-1][0]
    i = len(store)
    nb = [last + 3600, (100 + i) * k, (105 + i) * k, (99 + i) * k, (101 + i) * k, 1000]
    return tail + [nb]


def test_t01_split_rebuild(intraday_env, capsys):
    sym = "T01"
    store = rows(30)
    path = put(intraday_env, sym, store)
    asof = store[-1][0]
    calls = []

    def fake(s, tf, frm=None, **kwargs):
        calls.append((s, tf, frm))
        if frm is None:
            return moved(rows(40), 0.5)
        return _refresh_tail_plus_new(store, 0.5)

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 0
    assert calls == [(sym, "1h", mod._date_of(asof) - mod.dt.timedelta(days=3)), (sym, "1h", None)]
    on_disk = _read_bars(path)
    assert on_disk == moved(rows(40), 0.5)
    assert json.loads(path.read_text())["asof"] == on_disk[-1][0]
    assert f"rebuilt: {sym}.1h price basis moved x0.5000 over 6 shared bar(s); 30 -> 40 row(s)" in out
    assert "1/1 stored" in out
    assert "rebuilt=1" in out


def test_t02_rebuild_refused_when_full_refetch_small(intraday_env, capsys):
    sym = "T02"
    store = rows(30)
    path = put(intraday_env, sym, store)
    before = path.read_bytes()

    def fake_small(s, tf, frm=None, **kwargs):
        if frm is None:
            return moved(rows(19), 0.5)
        return _refresh_tail_plus_new(store, 0.5)

    rc = run(fake_small)
    out = capsys.readouterr().out
    assert rc == 1
    assert path.read_bytes() == before
    assert "AdjustmentMismatch" in out
    assert "full refetch returned 19 bar(s)" in out
    assert "failed=1" in out

    def fake_ok(s, tf, frm=None, **kwargs):
        if frm is None:
            return moved(rows(20), 0.5)
        return _refresh_tail_plus_new(store, 0.5)

    rc2 = run(fake_ok)
    assert rc2 == 0
    assert _read_bars(path) == moved(rows(20), 0.5)


def test_t03_rebuild_budget(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "MAX_REBUILDS", 1)
    sym_a, sym_b = "T3A", "T3B"
    store_a, store_b = rows(30), rows(30)
    path_a = put(intraday_env, sym_a, store_a)
    path_b = put(intraday_env, sym_b, store_b)
    before_b = path_b.read_bytes()
    full_fetches = []

    def fake(s, tf, frm=None, **kwargs):
        if frm is None:
            full_fetches.append((s, tf, frm))
            return moved(rows(40), 0.5)
        st = store_a if s == sym_a else store_b
        return _refresh_tail_plus_new(st, 0.5)

    before_a = path_a.read_bytes()
    rc = run(fake, ["--existing-only", "--tf", "1h", "--workers", "1"])
    out = capsys.readouterr().out
    assert rc == 1
    assert len(full_fetches) == 1
    rebuilt = moved(rows(40), 0.5)
    a_ok = _read_bars(path_a) == rebuilt
    b_ok = _read_bars(path_b) == rebuilt
    assert a_ok ^ b_ok
    if a_ok:
        assert path_b.read_bytes() == before_b
        assert path_a.read_bytes() != before_a
    else:
        assert path_a.read_bytes() == before_a
        assert _read_bars(path_b) == rebuilt
    assert "rebuild budget of 1 is spent" in out
    assert "rebuilt=1" in out
    assert "failed=1" in out


@pytest.mark.parametrize("k,expect_rebuild", [(1.004, False), (0.996, False), (1.006, True), (0.994, True)])
def test_t04_tolerance_boundary(intraday_env, capsys, k, expect_rebuild):
    sym = f"T4{k}"
    store = rows(30)
    path = put(intraday_env, sym, store)
    full_fetches = []

    def fake(s, tf, frm=None, **kwargs):
        if frm is None:
            full_fetches.append(1)
            return moved(rows(40), k)
        return _refresh_tail_plus_new(store, k)

    rc = run(fake, ["--existing-only", "--tf", "1h", "--workers", "1"])
    out = capsys.readouterr().out
    assert rc == 0
    if expect_rebuild:
        assert len(full_fetches) == 1
        assert "rebuilt=1" in out
    else:
        assert len(full_fetches) == 0
        assert "rebuilt=0" in out
        shared_eps = {r[0] for r in store[-6:]}
        on_disk = {r[0]: r for r in _read_bars(path)}
        for ep in shared_eps:
            assert on_disk[ep] == moved([r for r in store if r[0] == ep], k)[0]


def test_t05_too_few_shared_bars(intraday_env, capsys):
    sym = "T05"
    store = rows(30)
    path = put(intraday_env, sym, store)
    full = []

    def fake4(s, tf, frm=None, **kwargs):
        if frm is None:
            full.append(1)
            return rows(40)
        return _refresh_tail_plus_new(store, 0.5, n_shared=4)

    rc = run(fake4)
    out = capsys.readouterr().out
    assert rc == 0
    assert not full
    assert "basis_unverified=1" in out
    assert "rebuilt=0" in out

    path.unlink()
    store2 = rows(30)
    put(intraday_env, "T05B", store2)
    full.clear()

    def fake5(s, tf, frm=None, **kwargs):
        if frm is None:
            full.append(1)
            return moved(rows(40), 0.5)
        return _refresh_tail_plus_new(store2, 0.5, n_shared=5)

    rc2 = run(fake5, ["--existing-only", "--tf", "1h", "--workers", "1"])
    out2 = capsys.readouterr().out
    assert rc2 == 0
    assert len(full) == 1
    assert "rebuilt=1" in out2
    assert "basis_unverified=0" in out2


def test_t06_one_corrected_bar_not_basis_move(intraday_env, capsys):
    sym = "T06"
    store = rows(30)
    path = put(intraday_env, sym, store)
    before_unchanged = [r for r in store[:-6]]
    full = []

    def fake(s, tf, frm=None, **kwargs):
        if frm is None:
            full.append(1)
            return rows(40)
        tail = [list(r) for r in store[-6:]]
        tail[2] = [tail[2][0], tail[2][1] * 0.5, tail[2][2] * 0.5, tail[2][3] * 0.5, tail[2][4] * 0.5, tail[2][5]]
        last = store[-1][0]
        i = len(store)
        tail.append([last + 3600, 100 + i, 105 + i, 99 + i, 101 + i, 1000])
        return tail

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 0
    assert not full
    assert "rebuilt=0" in out
    on_disk = _read_bars(path)
    by_ep = {r[0]: r for r in on_disk}
    assert len(on_disk) == 31
    for r in before_unchanged:
        assert by_ep[r[0]] == r
    halved_ep = store[-4][0]
    assert by_ep[halved_ep] == [
        halved_ep,
        store[-4][1] * 0.5,
        store[-4][2] * 0.5,
        store[-4][3] * 0.5,
        store[-4][4] * 0.5,
        store[-4][5],
    ]
    for ep in {b[0] for b in store[-6:]} - {halved_ep}:
        orig = next(x for x in store if x[0] == ep)
        assert by_ep[ep] == orig


def test_t07_empty_refetch_store_failure(intraday_env, capsys):
    sym = "T07"
    store = rows(30)
    path = put(intraday_env, sym, store)
    before = path.read_bytes()
    full = []

    def fake(s, tf, frm=None, **kwargs):
        if frm is None:
            full.append(1)
        return []

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    assert "EmptyOverlap" in out
    assert "failed=1" in out
    assert "unchanged=0" in out
    assert path.read_bytes() == before
    assert not full


def test_t08_refetch_starts_after_store(intraday_env, capsys):
    sym = "T08"
    store = rows(30)
    path = put(intraday_env, sym, store)
    asof = store[-1][0]
    full = []

    def fake(s, tf, frm=None, **kwargs):
        if frm is None:
            full.append(1)
            return rows(40)
        return [
            [asof + 3600, 1.0, 2.0, 0.5, 1.5, 100],
            [asof + 7200, 1.0, 2.0, 0.5, 1.5, 100],
        ]

    rc = run(fake)
    out = capsys.readouterr().out
    assert len(full) == 1
    assert f"rebuilt: {sym}.1h refetch shares no bar with the store" in out
    assert _read_bars(path) == rows(40)
    assert rc == 0


def test_t09_unchanged_store_not_rewritten(intraday_env, capsys):
    sym = "T09"
    store = rows(30)
    path = put(intraday_env, sym, store)
    before = path.read_bytes()
    mtime_before = path.stat().st_mtime_ns

    def fake(s, tf, frm=None, **kwargs):
        return store[-6:]

    def no_write(*args, **kwargs):
        raise AssertionError("must not write")

    with patch.object(mod, "write_store", no_write):
        rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 0
    assert "0/1 stored (unchanged=1 failed=0" in out
    assert path.read_bytes() == before
    assert path.stat().st_mtime_ns == mtime_before


def test_t10_future_dated_store(intraday_env, capsys):
    sym = "T10"
    start = int(time.time()) + 86_400
    store = rows(30, start=start)
    path = put(intraday_env, sym, store)
    before = path.read_bytes()
    called = []

    def fake(s, tf, frm=None, **kwargs):
        called.append(1)
        return []

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    assert not called
    assert "StoreAsofInFuture" in out
    assert path.read_bytes() == before


def test_t11_merged_store_below_minimum(intraday_env, capsys):
    sym = "T11"
    store = rows(10)
    path = put(intraday_env, sym, store)
    before = path.read_bytes()
    last = store[-1][0]

    def fake(s, tf, frm=None, **kwargs):
        extra = [
            [last + 3600, 10.0, 11.0, 9.0, 10.5, 100],
            [last + 7200, 10.0, 11.0, 9.0, 10.5, 100],
        ]
        return store[-6:] + extra

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 1
    assert "StoreTooSmall: 12 bar(s) after merge" in out
    assert path.read_bytes() == before


def test_t12_retention_keeps_newest_rows(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "MAX_STORE_ROWS", 25)
    sym = "T12"
    store = rows(30)
    path = put(intraday_env, sym, store)
    last = store[-1][0]

    def fake(s, tf, frm=None, **kwargs):
        extra = [
            [last + 3600, 10.0, 11.0, 9.0, 10.5, 100],
            [last + 7200, 10.0, 11.0, 9.0, 10.5, 100],
        ]
        return store[-6:] + extra

    rc = run(fake)
    out = capsys.readouterr().out
    assert rc == 0
    on_disk = _read_bars(path)
    assert len(on_disk) == 25
    assert on_disk[0][0] == 1_700_000_000 + 7 * 3600
    assert on_disk[-1][0] == last + 7200
    assert f"retention: {sym}.1h dropped 7 oldest row(s) (cap 25)" in out
    assert "retention_dropped=7" in out


def test_t13_rebuild_retention_under_cap(intraday_env, monkeypatch, capsys):
    monkeypatch.setattr(mod, "MAX_STORE_ROWS", 25)
    sym = "T13"
    store = rows(30)
    path = put(intraday_env, sym, store)

    def fake(s, tf, frm=None, **kwargs):
        if frm is None:
            return moved(rows(40), 0.5)
        return _refresh_tail_plus_new(store, 0.5)

    rc = run(fake)
    assert rc == 0
    expected = moved(rows(40), 0.5)[-25:]
    assert _read_bars(path) == expected
