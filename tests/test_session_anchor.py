"""The PRODUCER half of one 3D bar identity.

`terminal/lib/__tests__/sessionBars.test.ts` holds the browser to a golden grid. This file holds
that grid to `signal_layer/confluence.py::_3d_groups` — the function every Golden Oracle 3D signal
is actually computed on — and pins the published `session_anchor` contract that carries the grid's
phase to the browser.

Without this half the fixture is just a file: someone could change the engine's bucketing rule, the
chart would keep reproducing the OLD fixture, and both suites would stay green while the chart and
the Oracle silently diverged again. Both halves read the SAME document.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest import session_anchor as anchor_mod  # noqa: E402
from signal_layer import confluence  # noqa: E402

GOLDEN = ROOT / "terminal" / "lib" / "__tests__" / "fixtures" / "sessionBars3D.golden.json"


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(GOLDEN.read_text())


def _close(bars: list[list]) -> pd.Series:
    idx = pd.DatetimeIndex([pd.Timestamp(b[0]) for b in bars])
    return pd.Series([float(b[4]) for b in bars], index=idx)


# ── the golden grid IS the engine's grid ────────────────────────────────────────────────────

def test_the_golden_3d_grid_is_what_the_signal_engine_produces(golden):
    """Re-derive every 3D bar from `_3d_groups` and compare to the committed fixture.

    Opening date, closing date and closing price, bar for bar. If the engine's rule moves, this
    goes red HERE — before the browser is allowed to keep reproducing a grid the engine no longer
    trades on.
    """
    bars = golden["full"]["bars"]
    od, cd, px = confluence._3d_groups(_close(bars), golden["full"]["barAnchor"])
    want = golden["expected"]["3D"]

    assert [str(t.date()) for t in od] == [b["time"] for b in want]
    assert [str(t.date()) for t in cd] == [b["closeTime"] for b in want]
    assert [float(p) for p in px] == [b["c"] for b in want]


def test_the_golden_grid_keys_bars_by_their_OPENING_session(golden):
    """Bar identity, stated as an invariant rather than as a list of dates.

    A 3D bar CLOSES on a global session index divisible by 3 and OPENS on the session after —
    which is why its key and its completion date are two different facts.
    """
    bars = golden["full"]["bars"]
    pos = {b[0]: i for i, b in enumerate(bars)}
    want = golden["expected"]["3D"]

    for bar in want:
        assert bar["sessions"][0] == bar["time"], "a bar is keyed by its first session"
        assert bar["sessions"][-1] == bar["closeTime"], "…and completes on its last"
    # every close but the final (still-forming) bar sits on index ≡ 0 (mod 3)
    for bar in want[:-1]:
        assert pos[bar["closeTime"]] % 3 == 0
    # …and every open but the forced first row sits on ≡ 1
    for bar in want[1:]:
        assert pos[bar["time"]] % 3 == 1
    # the two keyings really do disagree — this is the whole defect
    assert [b["time"] for b in want] != [b["closeTime"] for b in want]


def test_a_supplied_anchor_reproduces_the_full_history_grid_from_a_truncated_feed(golden):
    """The reason an anchor exists: dropping leading history must not re-phase later bars."""
    full_bars = golden["full"]["bars"]
    full_open = [b["time"] for b in golden["expected"]["3D"]]

    for trunc in golden["truncated"]:
        k = trunc["dropLeading"]
        od, cd, _ = confluence._3d_groups(_close(trunc["bars"]), k)
        got = [str(t.date()) for t in od]
        assert got == [b["time"] for b in trunc["expected"]["3D"]]
        # every bar after the leading (necessarily partial) one is a full-history bar
        assert set(got[1:]) <= set(full_open)
        # …and the anchor the fixture publishes is exactly that truncation point
        assert trunc["sessionAnchor"]["index"] == k
        assert trunc["sessionAnchor"]["date"] == full_bars[k][0]

    # …whereas anchoring at the feed's own first row does NOT reproduce it.
    worst = golden["truncated"][0]
    unanchored, _, _ = confluence._3d_groups(_close(worst["bars"]), 0)
    assert [str(t.date()) for t in unanchored] != [b["time"] for b in worst["expected"]["3D"]]


# ── the published contract ──────────────────────────────────────────────────────────────────

def test_anchor_basis_distinguishes_a_real_ipo_index_from_the_fallback(monkeypatch, tmp_path):
    """0 is BOTH a legitimate full-history anchor and the unavailable-store fallback.

    The integer cannot tell them apart, so the contract carries which one it is — a consumer that
    read the fallback as an IPO claim would be fabricating a phase out of truncated data.
    """
    idx = pd.date_range("2024-01-01", periods=5, freq="D")
    feed = pd.Series(range(5), index=idx, dtype="float64")

    # no deep store for this name → fallback
    monkeypatch.setattr(confluence, "DATA", tmp_path)
    assert confluence.ipo_bar_anchor_basis(feed, "NOSUCH") == (0, "feed")
    assert confluence.ipo_bar_anchor(feed, "NOSUCH") == 0      # unchanged for existing callers

    # a deep store that starts 3 sessions earlier → a real global index
    deep = pd.DataFrame({"close": range(8)},
                        index=pd.date_range("2023-12-29", periods=8, freq="D"))
    deep.to_parquet(tmp_path / "REAL.parquet")
    index, basis = confluence.ipo_bar_anchor_basis(feed, "REAL")
    assert basis == "ipo"
    assert index == 3
    assert confluence.ipo_bar_anchor(feed, "REAL") == index

    # a deep store that IS the feed → a real index that happens to be 0, and says so
    deep2 = pd.DataFrame({"close": range(5)}, index=idx)
    deep2.to_parquet(tmp_path / "FULL.parquet")
    assert confluence.ipo_bar_anchor_basis(feed, "FULL") == (0, "ipo")


def test_stamp_publishes_the_anchor_the_engine_would_use_for_these_exact_bars(monkeypatch, tmp_path):
    """The stamped document and the slice must be phased identically, or the chart is back to
    guessing. Both derive from the same function over the same bars — assert that directly."""
    monkeypatch.setattr(confluence, "DATA", tmp_path)
    bars = [[d.strftime("%Y-%m-%d"), 1.0, 2.0, 0.5, 1.5, 10]
            for d in pd.date_range("2024-01-04", periods=6, freq="D")]
    deep = pd.DataFrame({"close": range(10)},
                        index=pd.date_range("2024-01-01", periods=10, freq="D"))
    deep.to_parquet(tmp_path / "ACME.parquet")

    doc = {"t": "ACME", "o": 1, "src": "polygon", "bar_quality": "real_ohlc", "bars": bars}
    assert anchor_mod.stamp(doc, "ACME") is True
    published = doc["session_anchor"]
    assert published == {"v": 1, "date": "2024-01-04", "index": 3, "basis": "ipo"}
    # the engine, handed the same bars, phases its grid at the same integer
    assert confluence.ipo_bar_anchor(_close(bars), "ACME") == published["index"]

    # idempotent: a second pass over a stamped document rewrites nothing
    assert anchor_mod.stamp(doc, "ACME") is False

    # …and a document whose bars were re-cut gets a NEW anchor, never the old one
    doc["bars"] = bars[2:]
    assert anchor_mod.stamp(doc, "ACME") is True
    assert doc["session_anchor"] == {"v": 1, "date": "2024-01-06", "index": 5, "basis": "ipo"}


def test_stamp_refuses_to_guess_when_there_are_no_bars(monkeypatch, tmp_path):
    monkeypatch.setattr(confluence, "DATA", tmp_path)
    doc: dict = {"t": "EMPTY", "bars": []}
    assert anchor_mod.stamp(doc, "EMPTY") is False
    assert "session_anchor" not in doc
    assert anchor_mod.anchor_for([], "EMPTY") is None


def test_the_stamping_pass_walks_ohlc_documents_and_leaves_sidecars_alone(monkeypatch, tmp_path):
    """The nightly pass, executed. A sidecar stamped with a `session_anchor` would be noise at
    best; a manifest stamped with one would be a shape change nothing expects."""
    import ingest.stamp_session_anchors as pass_mod

    monkeypatch.setattr(confluence, "DATA", tmp_path / "deep")
    data = tmp_path / "data"
    data.mkdir()
    bars = [[d.strftime("%Y-%m-%d"), 1.0, 2.0, 0.5, 1.5, 10]
            for d in pd.date_range("2024-01-01", periods=9, freq="D")]
    (data / "NVDA.json").write_text(json.dumps({"t": "NVDA", "bars": bars}))
    (data / "NVDA.slice.json").write_text(json.dumps({"indicator": {"signals": []}}))
    (data / "NVDA.intel.json").write_text(json.dumps({"tech": {}}))
    (data / "manifest.json").write_text(json.dumps({"symbols": {"NVDA": {}}}))

    monkeypatch.setattr(sys, "argv", ["stamp_session_anchors.py", "--data-dir", str(data)])
    assert pass_mod.main() == 0

    ohlc = json.loads((data / "NVDA.json").read_text())
    assert ohlc["session_anchor"] == {"v": 1, "date": "2024-01-01", "index": 0, "basis": "feed"}
    assert ohlc["bars"] == bars                      # the document is otherwise untouched
    assert "session_anchor" not in json.loads((data / "NVDA.slice.json").read_text())
    assert "session_anchor" not in json.loads((data / "NVDA.intel.json").read_text())
    assert "session_anchor" not in json.loads((data / "manifest.json").read_text())
    # no temp file left behind by the atomic write
    assert not list(data.glob("*.anchor.tmp"))

    # a second run is a no-op that still reports the same basis
    monkeypatch.setattr(sys, "argv", ["stamp_session_anchors.py", "--data-dir", str(data)])
    assert pass_mod.main() == 0
    assert json.loads((data / "NVDA.json").read_text())["session_anchor"] == ohlc["session_anchor"]


def test_the_nightly_runs_the_stamping_pass_after_the_last_ohlc_writer(monkeypatch):
    """An unwired producer is invisible from inside the app (tests/test_nightly_wiring.py's
    lesson). This one has to run AFTER every OHLC writer — a document rebuilt from scratch after
    it would ship unstamped, and the chart would fall back to a feed-phased grid for a full day.
    """
    body = (ROOT / "ops" / "terminal-data").read_text().splitlines()

    def line_of(needle: str) -> int:
        for i, ln in enumerate(body):
            if ln.strip().startswith(f'run "$PY" {needle}'):
                return i
        raise AssertionError(f"{needle} is never invoked by ops/terminal-data")

    stamper = line_of("ingest/stamp_session_anchors.py")
    for writer in ("ingest/build_universe.py", "ingest/backfill_ohlc.py",
                   "ingest/build_macro_symbols.py", "ingest/fetch_fred_daily.py",
                   "ingest/refresh_crypto_ohlc.py"):
        assert line_of(writer) < stamper, f"{writer} rebuilds OHLC after the anchors are stamped"


def test_the_flagship_builder_stamps_its_own_rebuilt_documents():
    """Phase 1 rewrites the flagship OHLC from scratch hours before the marathon reaches the
    stamping pass. Without an inline stamp those documents lose the field every night."""
    src = (ROOT / "ingest" / "build_polygon_universe.py").read_text()
    assert "from ingest.session_anchor import stamp as stamp_session_anchor" in src
    write_at = src.index('(OUT / f"{sym}.json").write_text')
    stamp_at = src.index("stamp_session_anchor(_doc, sym)")
    assert stamp_at < write_at, "the anchor must be stamped BEFORE the document is written"
