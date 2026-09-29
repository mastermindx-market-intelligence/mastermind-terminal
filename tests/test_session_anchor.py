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


def test_the_anchor_survives_the_nightly_appending_and_backfilling_history(monkeypatch, tmp_path):
    """The nightly mutates a document two ways, and the anchor must describe the grid after both.

    This is the property that makes the contract an anchor POINT rather than a bare integer.
    A bare integer reads as "phase at row 0", which stays true only until row 0 moves — and
    every other test in this file would still pass after that simplification, while the next
    backfill silently re-phased every bar on the chart.
    """
    monkeypatch.setattr(confluence, "DATA", tmp_path)
    full = pd.date_range("2024-01-01", periods=60, freq="B")
    pd.DataFrame({"close": range(len(full))}, index=full).to_parquet(tmp_path / "EXT.parquet")

    def bars_from(start: int, count: int) -> list[list]:
        return [[d.strftime("%Y-%m-%d"), 1.0, 2.0, 0.5, 1.0 + i, 10]
                for i, d in enumerate(full[start:start + count])]

    def opens(bars: list[list], index: int) -> list[str]:
        return [str(t.date()) for t in confluence._3d_groups(_close(bars), index)[0]]

    # a truncated feed starting at global session 20
    doc = {"t": "EXT", "bars": bars_from(20, 25)}
    assert anchor_mod.stamp(doc, "EXT") is True
    before = dict(doc["session_anchor"])
    assert before == {"v": 1, "date": full[20].strftime("%Y-%m-%d"), "index": 20, "basis": "ipo"}
    opens_before = opens(doc["bars"], before["index"])

    # APPEND — today's session arrives. Row 0 did not move, so the anchor does not move, the
    # stamping pass rewrites nothing, and every bar that already existed keeps its opening date.
    doc["bars"] = bars_from(20, 26)
    assert anchor_mod.stamp(doc, "EXT") is False
    assert doc["session_anchor"] == before
    assert opens(doc["bars"], before["index"])[:len(opens_before)] == opens_before

    # BACKWARDS EXTENSION — a backfill prepends 12 sessions. Row 0 moves EARLIER, so its global
    # index gets SMALLER. That direction is easy to get backwards, so pin it explicitly.
    doc["bars"] = bars_from(8, 38)
    assert anchor_mod.stamp(doc, "EXT") is True
    after = doc["session_anchor"]
    assert after == {"v": 1, "date": full[8].strftime("%Y-%m-%d"), "index": 8, "basis": "ipo"}
    assert after["index"] < before["index"]

    # The decisive part. A row's phase is a property of its GLOBAL index, so extending history
    # backwards must not re-phase a bar that already existed. The one and only opening date that
    # legitimately disappears is the FORCED first bucket: global 20 is row 0 of the truncated
    # feed and opens for that reason alone (20 % 3 == 2, so it never opens on its own), and once
    # real history precedes it, it correctly stops being a bar boundary.
    opens_after = opens(doc["bars"], after["index"])
    assert set(opens_before) - set(opens_after) == {full[20].strftime("%Y-%m-%d")}
    assert set(opens_before) - {full[20].strftime("%Y-%m-%d")} <= set(opens_after)


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
    """An unwired producer is invisible from inside the app. (That lesson comes FROM
    tests/test_nightly_wiring.py; it does not cover this pass — THIS test is the pin.)
    The stamper has to run AFTER every OHLC writer — a document rebuilt from scratch after
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


def test_every_nightly_step_after_the_stamper_is_explicitly_classified():
    """The ordering test above names five writers BY HAND, and a hand-written list goes stale.

    ``ingest/refresh_ohlc_intl.py --days 10 --write`` already runs AFTER the stamper and is absent
    from that list, so the enumeration would not have caught it. It happens to be safe — it does
    ``d = json.load(open(p))`` … ``json.dump(d, …)``, a read-modify-write that round-trips the whole
    document and therefore preserves ``session_anchor`` — but nothing was checking that, and nothing
    stopped a NEW writer landing after line 126.

    So invert the check. Instead of listing writers that must come before, classify every step that
    comes after: adding one reds this test until somebody states whether it rebuilds per-symbol OHLC
    documents. Fail-closed on additions rather than fail-open on omissions.

    This already paid for itself on its first run: it caught ``ingest/gen_seasonal_outlook.py``, an
    INDENTED (Mondays-only) invocation that a ``^run`` grep of the script does not match and that a
    human reading the file top-to-bottom had missed. Hence ``ln.strip().startswith`` below rather
    than a line-anchored match.
    """
    body = (ROOT / "ops" / "terminal-data").read_text().splitlines()
    steps = [ln.strip()[len('run "$PY" '):].split()[0]
             for ln in body if ln.strip().startswith('run "$PY" ')]
    assert "ingest/stamp_session_anchors.py" in steps, "the stamping pass is not wired at all"
    after = steps[steps.index("ingest/stamp_session_anchors.py") + 1:]

    # Each entry states WHY it may run after the anchors are stamped. A step that rebuilds a
    # per-symbol OHLC document from scratch does NOT belong here — move it before the stamper.
    classified = {
        "ingest/pull_macro_washout.py": "writes a macro washout artifact, not <SYM>.json",
        "ingest/pull_macro_washout_history.py": "writes a macro washout artifact, not <SYM>.json",
        "ingest/gen_slices_all.py": "writes <SYM>.slice.json, a separate file",
        "ingest/pull_macro_opportunities.py": "writes a macro artifact, not <SYM>.json",
        "-m": "ingest.artifact_conformance — validates artifacts, writes no OHLC",
        "ingest/pull_macro_intel.py": "writes intel artifacts, not <SYM>.json",
        "ingest/refresh_ohlc_intl.py": "read-modify-write on an EXISTING <SYM>.json; preserves unknown keys",
        "ingest/hydrate_prices.py": "writes the MANIFEST only; reads bars, never writes <SYM>.json",
        "scripts/build_data_coverage.py": "writes a coverage artifact, not <SYM>.json",
        # Indented (Mondays-only) invocation — found by this test, missed by a `^run` grep.
        "ingest/gen_seasonal_outlook.py": "writes <SYM>.seasonal.json; READS <SYM>.json as an offline fallback",
    }
    unclassified = [s for s in after if s not in classified]
    assert not unclassified, (
        "these nightly steps run AFTER ingest/stamp_session_anchors.py and are unclassified: "
        f"{unclassified}. If one rebuilds a per-symbol OHLC document it must move BEFORE the "
        "stamper, or every document it touches ships unstamped for a full day. If it is safe, "
        "add it to `classified` with the reason."
    )


def test_the_one_ohlc_writer_after_the_stamper_still_round_trips_the_document():
    """`refresh_ohlc_intl.py` is the only per-symbol OHLC writer that runs after the stamper, and it
    is safe ONLY because it mutates a document it loaded rather than building a fresh one. Rewriting
    it as a fresh-dict writer would silently strip `session_anchor` from every CN/HK document every
    night, and the chart would fall back to a feed-phased grid for those symbols.
    """
    src = (ROOT / "ingest" / "refresh_ohlc_intl.py").read_text()
    assert "json.load(open(p))" in src, (
        "refresh_ohlc_intl.py no longer loads the existing document before writing it — "
        "a fresh-dict write drops session_anchor (and every other key it does not know about)"
    )
    assert "json.dump(d," in src, (
        "refresh_ohlc_intl.py no longer dumps the loaded document `d`; if it now builds its own "
        "dict, unknown keys including session_anchor are lost"
    )


def test_the_seam_comments_point_at_a_test_that_actually_exists():
    """The two artifacts that carry the stamping seam each name the test that pins it. A stale
    node-id there is worse than no pointer: it reads as covered, and a path-existence check
    passes because the FILE exists. Both shipped pointers named tests/test_nightly_wiring.py,
    which is parameterised over the named washout / opportunity / coverage bridges and never
    enumerates this pass — so nothing was checking the ordering the comments claimed was checked.
    """
    import re

    for rel in ("ops/terminal-data", "ingest/stamp_session_anchors.py"):
        text = (ROOT / rel).read_text()
        # A node-id is long enough that it wraps; in a shell file the continuation line starts
        # with "#". Rejoin lines, then heal a reference split across the wrap, so the check is
        # about the pointer being TRUE rather than about how it happens to be formatted.
        flat = re.sub(r"\n\s*#?\s*", " ", text)
        flat = re.sub(r"\s*::\s*", "::", flat)
        refs = re.findall(r"tests/([A-Za-z0-9_/]+\.py)::([A-Za-z0-9_]+)", flat)
        assert refs, f"{rel} no longer names the test that pins the seam"
        for fname, test in refs:
            target = ROOT / "tests" / fname
            assert target.exists(), f"{rel} points at tests/{fname}, which does not exist"
            assert f"def {test}(" in target.read_text(), (
                f"{rel} points at tests/{fname}::{test}, which that file does not define"
            )


def test_the_flagship_builder_stamps_its_own_rebuilt_documents():
    """Phase 1 rewrites the flagship OHLC from scratch hours before the marathon reaches the
    stamping pass. Without an inline stamp those documents lose the field every night."""
    src = (ROOT / "ingest" / "build_polygon_universe.py").read_text()
    assert "from ingest.session_anchor import stamp as stamp_session_anchor" in src
    write_at = src.index('(OUT / f"{sym}.json").write_text')
    stamp_at = src.index("stamp_session_anchor(_doc, sym)")
    assert stamp_at < write_at, "the anchor must be stamped BEFORE the document is written"
