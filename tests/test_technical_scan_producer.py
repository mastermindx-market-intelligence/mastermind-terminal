"""The screener scan PRODUCER (E01): ``ingest/gen_technical_scan.py``.

The Screener reads one document, ``/data/scan/technical.json``, instead of one OHLC file per
ticker. This file pins what that document is allowed to say:

* every observed value is the slice writer's own ``indicator`` output, projected verbatim —
  never recomputed, never inferred (AC-E01-01, and the falsifier: a slice that cannot state a
  qualified completed-bar cutoff is ``unsupported/cutoff_unqualified``);
* every requested manifest name gets exactly one row and a reason (AC-E01-02);
* the publication guard is the client's adoption rule, so an incomplete run never replaces a
  complete generation, and every run leaves a receipt that agrees with the live file
  (AC-E01-03 / AC-E01-06);
* the document the TS reader is tested against (``technical.producer.json``) is regenerated
  from this producer, byte for byte, so the two halves of the contract cannot drift.

Regenerate the committed producer fixture (only when the contract or vocabulary changes)::

    UPDATE_SCAN_FIXTURE=1 python3 -m pytest tests/test_technical_scan_producer.py -k fixture
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ingest import gen_technical_scan as scan  # noqa: E402
from signal_layer import SIGNAL_ERA, SIGNAL_ERA_PRE, confluence, contracts  # noqa: E402
from tests._synthetic_tape import synthetic_close  # noqa: E402

SAMPLES = ROOT / "terminal" / "public" / "data"
FIXTURE = ROOT / "terminal" / "lib" / "__tests__" / "fixtures" / "screenerScan" / "technical.producer.json"
NOW = 1791684000            # 2026-10-11T02:00:00Z — the generation clock of the fixture
HASH_BROAD = "sha256:" + "b" * 64
HASH_FLAGSHIP = "sha256:" + "f" * 64
TRACK_RECORD_KEYS = {"extended", "wr", "pf", "cagr", "verdict"}


# ── tmp data-dir builders ───────────────────────────────────────────────────────────────
def _bars(n: int, *, flat: bool = False, start: str = "2024-01-02") -> list[list]:
    idx = pd.bdate_range(start, periods=n)
    out = []
    for i, d in enumerate(idx):
        c = 100.0 + (0.0 if flat else np.sin(i / 9.0) * 5 + i * 0.05)
        out.append([d.strftime("%Y-%m-%d"), c, c if flat else c + 1, c if flat else c - 1, c,
                    0 if flat else 1000 + i])
    return out


def _ohlc(n: int, *, bar_quality: str = "real_ohlc", flat: bool = False) -> dict:
    return {"bar_quality": bar_quality, "bars": _bars(n, flat=flat)}


BASE_STATE = {
    "position_hint": "long", "last_signal": "BUY", "last_scored_signal": "BUY",
    "last_scored_ts": "2026-09-30", "last_scored_basis": None, "bars_since_signal": 3,
    "extended": False, "strong_bull": False, "overbought": False, "weeklyBull": True,
    "above200": True,
}


def _indicator(sym: str, *, session="2026-10-09", bar_open="2026-10-08", bar_closed=True,
               era: str | None = SIGNAL_ERA, leakfree=True, state=None, source_hash=HASH_BROAD,
               cutoff="default", score_basis="full", bar_quality="real_ohlc") -> dict:
    """A slim ``mastermind.indicator/v1`` slice exactly as the broad writer stores it."""
    ind: dict = {
        "schema": contracts.SCHEMA_INDICATOR, "symbol": sym, "timeframe": "3D",
        "as_of": f"{bar_open}T00:00:00Z", "bar_quality": bar_quality,
        "indicator": {"id": contracts.CONFLUENCE_INDICATOR_ID,
                      "engine": contracts.CONFLUENCE_ENGINE, "source_hash": source_hash},
        "meta": {"leakfree": leakfree, "scored": False, "score_basis": score_basis},
        "signals": [], "early_dots": [], "warnings": [],
        "state": {**BASE_STATE, **(state or {})},
    }
    if era is not None:
        ind["signal_era"] = era
    if cutoff == "default":
        ind["cutoff"] = {"session": session, "bar_open": bar_open, "bar_closed": bar_closed}
    elif cutoff is not None:
        ind["cutoff"] = cutoff
    return {"indicator": ind}


def _write(path: Path, doc) -> None:
    path.write_text(doc if isinstance(doc, str) else json.dumps(doc))


def _manifest(d: Path, symbols: dict, as_of: str = "2026-10-09") -> None:
    _write(d / "manifest.json", {"as_of": as_of, "source": "test", "symbols": symbols})


# One case per reason path: (sym, manifest row, files) → (status, reason). The ORDER of this
# table is the fixture's coverage story; the fixture rows are sorted by sym anyway.
def _cases() -> list[tuple[str, dict, dict, tuple[str, str]]]:
    model = contracts.model_slice(_indicator("FLAGSHIP_LIVE")["indicator"] | {
        "indicator": {"id": contracts.CONFLUENCE_INDICATOR_ID,
                      "engine": contracts.CONFLUENCE_ENGINE}})
    model["state"]["forming"] = True
    return [
        ("NVDA", {"mkt": "NASDAQ", "sec": "Equities", "verdict": "BUY", "wr": 0.6, "pf": 3.1,
                  "cagr": 0.2},
         {"slice": _indicator("NVDA", source_hash=HASH_FLAGSHIP)}, ("observed", "ok")),
        ("AAPL", {"mkt": "NASDAQ", "sec": "Equities"},
         {"slice": _indicator("AAPL", state={"position_hint": "flat", "last_signal": "SELL",
                                             "last_scored_signal": "SELL",
                                             "last_scored_basis": "structure_stop",
                                             "bars_since_signal": 12, "weeklyBull": False,
                                             "above200": False})},
         ("observed", "ok")),
        ("0700.HK", {"mkt": "HKEX", "sec": "Equities"},
         {"slice": _indicator("0700.HK", session="2026-10-09", bar_open="2026-10-09",
                              bar_closed=False, score_basis="partial",
                              state={"last_signal": None, "last_scored_signal": None,
                                     "last_scored_ts": None, "bars_since_signal": None,
                                     "position_hint": None, "strong_bull": None})},
         ("observed", "ok")),
        ("OLDERA", {"mkt": "NYSE", "sec": "Equities"},
         {"slice": _indicator("OLDERA", era=None)}, ("observed", "ok")),
        ("FLAGSHIP_LIVE", {"mkt": "NASDAQ", "sec": "Equities"},
         {"slice": {"indicator": model}}, ("unsupported", "cutoff_unqualified")),
        ("LEGACY", {"mkt": "NYSE", "sec": "Equities"},
         {"slice": _indicator("LEGACY", cutoff=None)}, ("unsupported", "cutoff_unqualified")),
        ("INVERTED", {"mkt": "NYSE", "sec": "Equities"},
         {"slice": _indicator("INVERTED", session="2026-10-07", bar_open="2026-10-08")},
         ("unsupported", "cutoff_unqualified")),
        ("LEAKY", {"mkt": "NYSE", "sec": "Equities"},
         {"slice": _indicator("LEAKY", leakfree=False)}, ("unsupported", "not_leakfree")),
        ("^TNX", {"sec": "Rates"}, {"ohlc": _ohlc(400)}, ("unsupported", "rate_series")),
        ("DFII10", {"sec": "Rates"},
         {"ohlc": _ohlc(400, bar_quality="single_value_daily", flat=True)},
         ("unsupported", "single_value_series")),
        ("NEWIPO", {"mkt": "NYSE", "sec": "Equities"}, {"ohlc": _ohlc(scan.MIN_SESSIONS - 1)},
         ("unavailable", "insufficient_history")),
        ("UNRUN", {"mkt": "NYSE", "sec": "Equities"}, {"ohlc": _ohlc(scan.MIN_SESSIONS)},
         ("unavailable", "no_slice")),
        ("GHOST", {"mkt": "NYSE", "sec": "Equities"}, {}, ("unavailable", "no_ohlc")),
        ("CORRUPT", {"mkt": "NYSE", "sec": "Equities"}, {"slice": '{"indicator": {"sch'},
         ("unavailable", "slice_unreadable")),
        ("WRONGSYM", {"mkt": "NYSE", "sec": "Equities"}, {"slice": _indicator("OTHER")},
         ("unavailable", "slice_unreadable")),
        ("BADSTATE", {"mkt": "NYSE", "sec": "Equities"},
         {"slice": _indicator("BADSTATE", state={"bars_since_signal": -1})},
         ("unavailable", "slice_unreadable")),
        ("OPPONLY", {"mkt": "NYSE", "sec": "Equities"},
         {"slice": {"opportunities": {"rows": []}}}, ("unavailable", "no_slice")),
    ]


def _build_dir(d: Path, cases=None) -> dict[str, tuple[str, str]]:
    d.mkdir(parents=True, exist_ok=True)
    cases = cases if cases is not None else _cases()
    for sym, _row, files, _exp in cases:
        if "ohlc" in files:
            _write(d / f"{sym}.json", files["ohlc"])
        if "slice" in files:
            _write(d / f"{sym}.slice.json", files["slice"])
    _manifest(d, {sym: row for sym, row, _f, _e in cases})
    return {sym: exp for sym, _r, _f, exp in cases}


@pytest.fixture
def data_dir(tmp_path) -> tuple[Path, dict]:
    d = tmp_path / "data"
    return d, _build_dir(d)


def _rows(doc: dict) -> dict[str, dict]:
    return {r["sym"]: r for r in doc["rows"]}


def _scan_path(d: Path) -> Path:
    return d / scan.SCAN_DIRNAME / scan.SCAN_FILENAME


def _receipt(d: Path) -> dict:
    return json.loads((d / scan.SCAN_DIRNAME / scan.RECEIPT_FILENAME).read_text())


# ── constants restated from elsewhere are pinned to their owner ─────────────────────────
def test_min_sessions_is_the_oracle_floor_under_every_bar_anchor():
    close = synthetic_close()
    at = scan.MIN_SESSIONS
    assert not confluence.compute_signals(close.iloc[:at], bar_anchor=0).empty
    for anchor in range(3):
        assert confluence.compute_signals(close.iloc[: at - 1], bar_anchor=anchor).empty, anchor


def test_rate_tickers_are_the_slice_writers_own_set():
    tree = ast.parse((ROOT / "ingest" / "gen_slices_all.py").read_text())
    owner = next(ast.literal_eval(n.value) for n in tree.body
                 if isinstance(n, ast.Assign)
                 and any(getattr(t, "id", None) == "RATE_TICKERS" for t in n.targets))
    assert scan.RATE_TICKERS == owner


def test_reason_vocabulary_is_the_ts_readers():
    ts = (ROOT / "terminal" / "lib" / "technicalScan.ts").read_text()
    for status, reasons in scan.REASONS.items():
        line = next(ln for ln in ts.splitlines() if ln.strip().startswith(f"{status}: ["))
        assert ast.literal_eval(line.split(":", 1)[1].strip().rstrip(",")) == list(reasons)
    assert '"' + '", "'.join(scan.STATE_KEYS[:5]) + '"' in ts
    assert scan.SCAN_SCHEMA in (ROOT / "terminal" / "lib" / "screenerScan.ts").read_text()


# ── classification: one reason per path, never a guess ──────────────────────────────────
def test_every_reason_path(data_dir):
    d, expected = data_dir
    for sym, (status, reason) in expected.items():
        obs, ident = scan.classify_symbol(d, sym)
        assert (obs["status"], obs["reason"]) == (status, reason), sym
        assert (ident is not None) == (status == "observed"), sym


def test_observed_rows_are_the_slice_verbatim_and_nothing_else(data_dir):
    d, expected = data_dir
    doc = scan.build_scan(d, NOW)
    rows = _rows(doc)
    for sym, (status, _r) in expected.items():
        if status != "observed":
            continue
        ind = json.loads((d / f"{sym}.slice.json").read_text())["indicator"]
        obs = rows[sym]["tf"]["3D"]
        assert obs["cutoff"] == ind["cutoff"], sym
        assert obs["state"] == {k: ind["state"].get(k) for k in scan.STATE_KEYS}, sym
        assert obs["bar_quality"] == ind["bar_quality"]
        assert obs["score_basis"] == ind["meta"]["score_basis"]
        eng = doc["engines"][obs["engine"]]
        assert eng == {"indicator_id": ind["indicator"]["id"],
                       "engine": ind["indicator"]["engine"],
                       "signal_era": ind.get("signal_era", SIGNAL_ERA_PRE),
                       "source_hash": ind["indicator"]["source_hash"]}
    # the flagship track record on the manifest row never reaches the scan
    blob = json.dumps(doc)
    for key in TRACK_RECORD_KEYS:
        assert f'"{key}"' not in blob, key


def test_the_current_engine_is_the_current_identity_and_hashes_do_not_split_it(data_dir):
    d, _ = data_dir
    doc = scan.build_scan(d, NOW)
    rows = _rows(doc)
    current = doc["engines"][doc["timeframes"]["3D"]["engine"]]
    assert (current["indicator_id"], current["engine"], current["signal_era"]) == \
        scan.CURRENT_IDENTITY
    # flagship and broad hashes are distinct keys but the SAME identity (consumer: current)
    nv, aa = rows["NVDA"]["tf"]["3D"]["engine"], rows["AAPL"]["tf"]["3D"]["engine"]
    assert nv != aa
    ident = lambda k: {x: doc["engines"][k][x] for x in ("indicator_id", "engine", "signal_era")}  # noqa: E731
    assert ident(nv) == ident(aa)
    # a pre-fence slice is carried under its own era, so the consumer marks it engine_mismatch
    assert doc["engines"][rows["OLDERA"]["tf"]["3D"]["engine"]]["signal_era"] == SIGNAL_ERA_PRE
    assert SIGNAL_ERA_PRE != SIGNAL_ERA


def test_no_current_slice_still_declares_the_current_engine(tmp_path):
    d = tmp_path / "data"
    _build_dir(d, [c for c in _cases() if c[3][0] != "observed"])
    doc = scan.build_scan(d, NOW)
    key = doc["timeframes"]["3D"]["engine"]
    assert doc["engines"] == {key: {"indicator_id": scan.CURRENT_IDENTITY[0],
                                    "engine": scan.CURRENT_IDENTITY[1],
                                    "signal_era": scan.CURRENT_IDENTITY[2],
                                    "source_hash": None}}
    assert scan.validate_scan(doc) is None


def test_one_bad_file_never_aborts_the_generation(data_dir, monkeypatch):
    d, expected = data_dir
    real = scan.classify_symbol

    def flaky(dd, sym):
        if sym == "AAPL":
            raise MemoryError("boom")
        return real(dd, sym)

    monkeypatch.setattr(scan, "classify_symbol", flaky)
    doc = scan.build_scan(d, NOW)
    assert _rows(doc)["AAPL"]["tf"]["3D"] == {"status": "unavailable", "reason": "slice_unreadable"}
    assert doc["complete"] is True and len(doc["rows"]) == len(expected)


# ── AC-E01-02: the requested universe, every name accounted for ─────────────────────────
def test_rows_equal_the_manifest_and_the_populations_sum(data_dir):
    d, expected = data_dir
    doc = scan.build_scan(d, NOW)
    assert scan.validate_scan(doc) is None
    assert [r["sym"] for r in doc["rows"]] == sorted(expected)
    assert doc["universe"] == {"source": "manifest", "as_of": "2026-10-09", "count": len(expected)}
    s = scan.summarize(doc)
    assert sum(s["by_status"].values()) == len(expected)
    assert sum(n for b in s["by_reason"].values() for n in b.values()) == len(expected)
    assert {(st, r) for st, b in s["by_reason"].items() for r in b} == set(expected.values())


def test_venue_and_asset_class_are_copied_verbatim(data_dir):
    d, _ = data_dir
    rows = _rows(scan.build_scan(d, NOW))
    assert (rows["0700.HK"]["mkt"], rows["0700.HK"]["sec"]) == ("HKEX", "Equities")
    assert "mkt" not in rows["^TNX"] and rows["^TNX"]["sec"] == "Rates"


def test_limit_and_budget_mark_the_rest_not_processed_and_the_run_incomplete(data_dir):
    d, expected = data_dir
    doc = scan.build_scan(d, NOW, limit=3)
    assert doc["complete"] is False and len(doc["rows"]) == len(expected)
    np_rows = [r for r in doc["rows"] if r["tf"]["3D"]["reason"] == "not_processed"]
    assert len(np_rows) == len(expected) - 3
    assert all(r["tf"]["3D"]["status"] == "unavailable" for r in np_rows)
    assert scan.validate_scan(doc) is None
    # a partial run that claims full coverage is refused outright
    assert scan.validate_scan({**doc, "complete": True}) == "complete_with_not_processed"

    ticks = iter(range(100))
    doc = scan.build_scan(d, NOW, budget_seconds=4.5, clock=lambda: float(next(ticks)))
    assert doc["complete"] is False
    assert 0 < sum(r["tf"]["3D"]["reason"] == "not_processed" for r in doc["rows"]) < len(expected)


def test_an_unreadable_manifest_is_no_generation(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    with pytest.raises(Exception):
        scan.build_scan(d, NOW)
    _write(d / "manifest.json", {"symbols": ["NVDA"]})
    with pytest.raises(ValueError):
        scan.build_scan(d, NOW)


# ── AC-E01-03 / -06: publication guard + receipt ────────────────────────────────────────
@pytest.mark.parametrize("current, incoming, adopt, reason", [
    (None, {"generation": 0, "complete": True}, False, "invalid_incoming"),
    (None, {"generation": 5, "complete": "yes"}, False, "invalid_incoming"),
    (None, {"generation": True, "complete": True}, False, "invalid_incoming"),
    (None, None, False, "invalid_incoming"),
    (None, {"generation": 5, "complete": False}, True, "first"),
    ({"generation": 5, "complete": True}, {"generation": 5, "complete": True}, False, "not_newer"),
    ({"generation": 5, "complete": False}, {"generation": 4, "complete": True}, False, "not_newer"),
    ({"generation": 5, "complete": False}, {"generation": 6, "complete": True}, True, "newer_complete"),
    ({"generation": 5, "complete": True}, {"generation": 6, "complete": False}, False,
     "incomplete_over_complete"),
    ({"generation": 5, "complete": False}, {"generation": 6, "complete": False}, True,
     "newer_incomplete"),
])
def test_adoption_mirrors_the_client_rule(current, incoming, adopt, reason):
    assert scan.adopt_generation(current, incoming) == (adopt, reason)


def test_adoption_reasons_are_the_ts_readers_in_the_same_order():
    ts = (ROOT / "terminal" / "lib" / "screenerScan.ts").read_text()
    body = ts[ts.index("export function adoptGeneration"):]
    body = body[: body.index("\n}\n")]
    order = [r for r in ("invalid_incoming", "first", "not_newer", "newer_complete",
                         "incomplete_over_complete", "newer_incomplete")]
    assert sorted(order, key=body.index) == order


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_publication_sequence_and_receipts(data_dir):
    d, expected = data_dir
    live = _scan_path(d)

    # 1. first generation (even incomplete) is published and labelled
    r = scan.publish(d, scan.build_scan(d, NOW, limit=2))
    assert (r["decision"], r["published"], r["complete"]) == ("first", True, False)
    assert r["sha256"] == r["live_sha256"] == _sha(live)

    # 2. a newer complete generation replaces it
    r = scan.publish(d, scan.build_scan(d, NOW + 10))
    assert (r["decision"], r["published"]) == ("newer_complete", True)
    assert r["live_generation"] == {"generation": NOW + 10, "complete": True}
    held_sha = _sha(live)
    assert r["sha256"] == r["live_sha256"] == held_sha
    assert r["by_status"]["observed"] == 4 and sum(r["by_status"].values()) == len(expected)

    # 3. AC-E01-03: a newer INCOMPLETE run never replaces the complete one …
    r = scan.publish(d, scan.build_scan(d, NOW + 20, limit=1))
    assert (r["decision"], r["published"], r["error"]) == ("incomplete_over_complete", False, None)
    assert _sha(live) == held_sha
    # … and the receipt says so: what it built is NOT what readers get
    assert r["sha256"] != r["live_sha256"] == held_sha
    assert r["held_generation"] == r["live_generation"] == {"generation": NOW + 10, "complete": True}

    # 4. a replay of an equal/older generation is refused
    r = scan.publish(d, scan.build_scan(d, NOW + 10))
    assert (r["decision"], r["published"]) == ("not_newer", False)
    assert _sha(live) == held_sha

    # the receipt on disk is the last decision, and it agrees with the live bytes
    assert _receipt(d)["live_sha256"] == _sha(live)


def test_an_invalid_document_is_never_published(data_dir):
    d, _ = data_dir
    scan.publish(d, scan.build_scan(d, NOW))
    held = _sha(_scan_path(d))
    bad = scan.build_scan(d, NOW + 10)
    bad["rows"].append(dict(bad["rows"][0]))   # a duplicate listing
    bad["universe"]["count"] += 1
    r = scan.publish(d, bad)
    assert (r["decision"], r["published"], r["error"]) == \
        ("invalid_incoming", False, "row_identity_duplicate")
    assert r["sha256"] is None and r["live_sha256"] == held == _sha(_scan_path(d))
    assert "by_status" not in r


def test_writes_are_atomic_and_never_write_through_a_hardlink(data_dir, tmp_path):
    d, _ = data_dir
    scan.publish(d, scan.build_scan(d, NOW))
    live = _scan_path(d)
    deployed = tmp_path / "deployed-copy.json"     # the deploy's `cp -al` farm
    os.link(live, deployed)
    before = deployed.read_bytes()
    scan.publish(d, scan.build_scan(d, NOW + 10))
    assert deployed.read_bytes() == before         # the old inode is untouched
    assert live.read_bytes() != before
    assert oct(live.stat().st_mode & 0o777) == "0o644"
    assert sorted(p.name for p in live.parent.iterdir()) == sorted([scan.RECEIPT_FILENAME,
                                                                    scan.SCAN_FILENAME])


def test_main_aborts_with_a_receipt_and_keeps_the_held_generation(data_dir, capsys):
    d, _ = data_dir
    assert scan.main(["--data-dir", str(d), "--now", str(NOW)]) == 0
    held = _sha(_scan_path(d))
    (d / "manifest.json").write_text("{not json")
    assert scan.main(["--data-dir", str(d), "--now", str(NOW + 10)]) == 2
    r = _receipt(d)
    assert r["error"] == "aborted:JSONDecodeError" and r["published"] is False
    assert r["live_sha256"] == held == _sha(_scan_path(d))
    assert "ABORTED" in capsys.readouterr().out


def test_now_accepts_epoch_and_iso():
    assert scan._parse_now(str(NOW)) == NOW
    assert scan._parse_now("2026-10-11T02:00:00Z") == NOW
    assert scan._parse_now("2026-10-11T02:00:00") == NOW


def test_runs_as_a_script_from_the_nightly(data_dir):
    """The nightly invokes ``$PY ingest/gen_technical_scan.py``: sys.path[0] is ingest/."""
    d, expected = data_dir
    imp = subprocess.run([sys.executable, "-c", "import gen_technical_scan"],
                         cwd=ROOT / "ingest", capture_output=True, text=True)
    assert imp.returncode == 0, imp.stderr
    run = subprocess.run([sys.executable, str(ROOT / "ingest" / "gen_technical_scan.py"),
                          "--data-dir", str(d), "--now", str(NOW)],
                         cwd="/", capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert f"rows={len(expected)}" in run.stdout and "decision=first" in run.stdout
    assert json.loads(_scan_path(d).read_text())["generation"] == NOW


# ── the committed producer fixture the TS reader is tested against ──────────────────────
def test_the_producer_fixture_is_this_producers_output(tmp_path):
    d = tmp_path / "data"
    _build_dir(d)
    doc = scan.build_scan(d, NOW)
    assert scan.validate_scan(doc) is None
    data = scan.encode(doc)
    if os.environ.get("UPDATE_SCAN_FIXTURE") == "1":
        FIXTURE.write_bytes(data)
    assert FIXTURE.read_bytes() == data, (
        "terminal/lib/__tests__/fixtures/screenerScan/technical.producer.json is stale — "
        "regenerate with UPDATE_SCAN_FIXTURE=1 (see module docstring)")


# ── AC-E01-01 end to end: the INCUMBENT writer's real output, projected ─────────────────
REAL_SAMPLES = ("NVDA", "SPY", "BTC-USD", "TLT")


@pytest.fixture(scope="module")
def incumbent_run(tmp_path_factory):
    """Run the real broad slice writer (gen_slices_all) on tracked OHLC samples in a tmp dir,
    then the scan over its output. Nothing touches the repo: OUT is a tmp dir, the flagship
    exclusion is lifted so the samples go through the broad path, and every washout side
    file points at tmp."""
    from ingest import gen_slices_all as g

    tmp = tmp_path_factory.mktemp("incumbent")
    d = tmp / "data"
    d.mkdir()
    man_src = json.loads((SAMPLES / "manifest.json").read_text())["symbols"]
    symbols = {s: man_src.get(s, {"sec": "Equities"}) for s in REAL_SAMPLES}
    for s in REAL_SAMPLES:
        shutil.copy(SAMPLES / f"{s}.json", d / f"{s}.json")
    tlt = json.loads((SAMPLES / "TLT.json").read_text())
    _write(d / "^TNX.json", tlt)                                        # rate: writer skips
    _write(d / "DFII10.json", _ohlc(400, bar_quality="single_value_daily", flat=True))
    _write(d / "SHORTY.json", _ohlc(150))                               # engine refuses
    symbols.update({"^TNX": {"sec": "Rates"}, "DFII10": {"sec": "Rates"},
                    "SHORTY": {"sec": "Equities"}, "GHOST": {"sec": "Equities"}})
    _manifest(d, symbols, as_of="2026-06-26")

    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(g, "OUT", d)
        mp.setattr(g, "FLAG", set())
        mp.setattr(sys, "argv", ["gen_slices_all.py"])
        mp.setenv("WASHOUT_STATE_PATH", str(tmp / "absent_state.json"))
        mp.setenv("WASHOUT_HISTORY_PATH", str(tmp / "absent_history.json"))
        mp.setenv("BLOCKED_OVERRIDE_LEDGER", str(tmp / "ledger.jsonl"))
        g.main()
    finally:
        mp.undo()
    receipt = scan.publish(d, scan.build_scan(d, NOW))
    return d, json.loads(_scan_path(d).read_text()), receipt


def test_incumbent_slices_project_verbatim(incumbent_run):
    d, doc, receipt = incumbent_run
    rows = _rows(doc)
    assert receipt["published"] and receipt["live_sha256"] == _sha(_scan_path(d))
    for sym in REAL_SAMPLES:
        ind = json.loads((d / f"{sym}.slice.json").read_text())["indicator"]
        obs = rows[sym]["tf"]["3D"]
        assert obs["status"] == "observed", (sym, obs)
        assert obs["cutoff"] == ind["cutoff"]
        assert obs["state"] == {k: ind["state"].get(k) for k in scan.STATE_KEYS}
        # the stamp is the engine frame's: last session of the tape, phase from the oracle
        bars = json.loads((d / f"{sym}.json").read_text())["bars"]
        close = pd.Series([float(b[4]) for b in bars], index=pd.to_datetime([b[0] for b in bars]))
        assert obs["cutoff"]["session"] == bars[-1][0]
        assert obs["cutoff"]["bar_closed"] is contracts.three_day_bar_closed(
            close, confluence.ipo_bar_anchor(close, sym))
        assert doc["engines"][obs["engine"]]["signal_era"] == SIGNAL_ERA
    assert doc["engines"][doc["timeframes"]["3D"]["engine"]]["signal_era"] == SIGNAL_ERA


def test_incumbent_skips_are_reported_as_their_reason(incumbent_run):
    d, doc, _ = incumbent_run
    rows = _rows(doc)
    for sym in ("^TNX", "DFII10", "SHORTY", "GHOST"):
        assert not (d / f"{sym}.slice.json").exists(), sym      # the writer made none
    assert rows["^TNX"]["tf"]["3D"]["reason"] == "rate_series"
    assert rows["DFII10"]["tf"]["3D"]["reason"] == "single_value_series"
    assert rows["SHORTY"]["tf"]["3D"]["reason"] == "insufficient_history"
    assert rows["GHOST"]["tf"]["3D"]["reason"] == "no_ohlc"
    assert doc["complete"] is True and doc["universe"]["count"] == len(REAL_SAMPLES) + 4


def test_falsifier_the_same_real_slice_without_its_cutoff_is_unsupported(incumbent_run, tmp_path):
    """Strip ONLY the stamp from a real incumbent slice: the screen must say unsupported, not
    reconstruct a cutoff from as_of / signals / OHLC (all of which are still present)."""
    d, _, _ = incumbent_run
    dd = tmp_path / "data"
    dd.mkdir()
    shutil.copy(d / "manifest.json", dd / "manifest.json")
    for s in REAL_SAMPLES:
        shutil.copy(d / f"{s}.json", dd / f"{s}.json")
        doc = json.loads((d / f"{s}.slice.json").read_text())
        doc["indicator"].pop("cutoff")
        _write(dd / f"{s}.slice.json", doc)
    rows = _rows(scan.build_scan(dd, NOW))
    for s in REAL_SAMPLES:
        assert rows[s]["tf"]["3D"] == {"status": "unsupported", "reason": "cutoff_unqualified"}


def test_tracked_pre_stamp_samples_are_unsupported_not_inferred(tmp_path):
    """The committed sample slices predate the cutoff stamp. Read as-is they are exactly the
    falsifier's case — every one must be unsupported/cutoff_unqualified until the nightly
    rewrites it with a stamp."""
    stamped = []
    dd = tmp_path / "data"
    dd.mkdir()
    shutil.copy(SAMPLES / "manifest.json", dd / "manifest.json")
    for p in SAMPLES.glob("*.slice.json"):
        shutil.copy(p, dd / p.name)
        if "cutoff" in (json.loads(p.read_text()).get("indicator") or {}):
            stamped.append(p.name)
    doc = scan.build_scan(dd, NOW)
    for r in doc["rows"]:
        if not (dd / f"{r['sym']}.slice.json").exists() or f"{r['sym']}.slice.json" in stamped:
            continue
        assert r["tf"]["3D"] == {"status": "unsupported", "reason": "cutoff_unqualified"}, r["sym"]
