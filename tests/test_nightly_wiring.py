"""The nightly WIRING seam — does anything actually run the producers we ship?

WHY THIS FILE EXISTS (charting-app #378, caught in production 2026-08-10).
#378 shipped a display class end to end: a reader with a graceful-absent fallback, a bridge
that writes the artifact the reader consumes, and the stamping that applies it. Every piece
was correct and every piece was tested. Nothing ran the bridge. `ops/terminal-data` invoked
`pull_macro_washout.py` and never its sibling, so `washout_history.json` was never written,
the fallback did exactly what it promised, and a full 10k-slice sweep produced ZERO retro
marks with no error anywhere — UEC regenerated with `signal_era: gc_v2_wo2` and 0 of 179
fires re-marked.

THE GENERAL LESSON, which is what this file guards: **a graceful fallback and an unwired
producer are indistinguishable from the outside.** Every test in the suite exercised the
fallback ("no artifact ⇒ no marks, byte-identical"), which is exactly the state a broken
wiring produces — so the whole suite stayed green while the feature was off. A silent-safe
design needs its PRODUCER pinned, not just its consumer.

So: one test that the nightly invokes each bridge, and one that each bridge, when invoked,
actually writes the file its reader opens. Cheap, and they fail loudly the moment either
half is dropped.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

NIGHTLY = ROOT / "ops" / "terminal-data"

# The bridges the nightly must run, and the file each one writes. Adding a bridge without
# adding it here is the mistake this table exists to make impossible.
PRE_SLICE_BRIDGES = [
    ("ingest/pull_macro_washout.py", "washout_state.json"),
    ("ingest/pull_macro_washout_history.py", "washout_history.json"),
]
POST_SLICE_BRIDGES = [
    ("ingest/pull_macro_opportunities.py", "*.slice.json#opportunities"),
]
BRIDGES = PRE_SLICE_BRIDGES + POST_SLICE_BRIDGES


@pytest.mark.parametrize("script,_out", BRIDGES, ids=[b[0] for b in BRIDGES])
def test_the_nightly_actually_invokes_the_bridge(script, _out):
    """Shipping a producer is not the same as running one."""
    body = NIGHTLY.read_text()
    assert re.search(rf'^run "\$PY" {re.escape(script)}\s*$', body, re.M), (
        f"{script} is never invoked by ops/terminal-data — it will not run in production, "
        "and the consumer's graceful fallback will hide that completely"
    )


def test_both_washout_bridges_run_before_the_slice_generator_that_consumes_them():
    """Order is part of the contract: a bridge that runs after the sweep feeds the NEXT night.

    Not a hypothetical — the artifacts are read once per slice build, so a bridge sequenced
    after `gen_slices_all` produces a full sweep against yesterday's file (or, on night one,
    no file at all) while looking perfectly healthy in the logs.
    """
    body = NIGHTLY.read_text().splitlines()

    def line_of(needle: str) -> int:
        for i, ln in enumerate(body):
            if ln.strip() == f'run "$PY" {needle}':
                return i
        raise AssertionError(f"{needle} not invoked in ops/terminal-data")

    consumer = line_of("ingest/gen_slices_all.py")
    for script, _out in PRE_SLICE_BRIDGES:
        assert line_of(script) < consumer, f"{script} must run BEFORE gen_slices_all"


def test_opportunity_bridge_runs_after_slice_generation_and_before_verification():
    """A pre-generation embed is erased; a post-verification embed escapes the gate."""
    body = NIGHTLY.read_text().splitlines()

    def line_of(needle: str) -> int:
        for i, ln in enumerate(body):
            if ln.strip() in (f'run "$PY" {needle}', f'"$PY" {needle}; VRC=$?'):
                return i
        raise AssertionError(f"{needle} not invoked in ops/terminal-data")

    producer = line_of("ingest/gen_slices_all.py")
    bridge = line_of("ingest/pull_macro_opportunities.py")
    verifier = line_of("ingest/verify_publish.py")
    assert producer < bridge < verifier


def test_each_bridges_DEFAULT_output_path_is_the_one_its_reader_defaults_to():
    """Writer and reader must agree on the path with NOTHING patched.

    Separate from the end-to-end test below on purpose: that one redirects `OUT` to a tmp
    dir, which is what makes it hermetic — and would also make it blind to the single most
    likely wiring bug, a producer writing `washout_hist.json` while the consumer opens
    `washout_history.json`. Nobody would see it: the reader's fallback is silent by design.
    Compare the module defaults directly, so the disagreement cannot hide behind a fixture.
    """
    import ingest.pull_macro_washout as state_bridge
    import ingest.pull_macro_washout_history as history_bridge
    from signal_layer import washout_override as reader

    assert history_bridge.OUT == reader.HISTORY_PATH
    assert state_bridge.OUT == reader.STATE_PATH
    # …and they are two different files, or one bridge is quietly clobbering the other
    assert history_bridge.OUT != state_bridge.OUT


def test_the_history_bridge_writes_the_exact_file_its_reader_opens(tmp_path, monkeypatch):
    """The PRODUCER half, executed — the half nothing exercised before today.

    Runs `main()` end to end over a fixture shaped like the real macro artifact, then opens
    the result with the READER (`load_history`) and marks a fire with it. If the two ever
    disagree about the path, the shape, or the notch keying, this goes red here rather than
    silently in a 10k-slice sweep.
    """
    import ingest.pull_macro_washout_history as bridge
    from signal_layer.washout_override import (WASHOUT_OVERRIDE_NOTCH, load_history,
                                               mark_retro)

    # hermetic: no network. Both remote sources answer None so the local macro checkout wins.
    monkeypatch.setattr(bridge, "_fetch_url", lambda _url: None)
    macro = tmp_path / "macro"
    (macro / "site" / "factordata").mkdir(parents=True)
    # Shaped exactly as scripts/build_basket_washout_state.py emits it: per-notch `intervals`,
    # each a [start, end] pair whose end is None while the window is still open.
    (macro / "site" / "factordata" / "basket_washout_history.json").write_text(json.dumps({
        "schema": "basket_washout_history.v1",
        "as_of": "2026-08-10",
        "names": {
            "UEC": {"basis": "basket", "group_id": "uranium_miners",
                    "name": "Uranium miners", "name_zh": "铀矿商",
                    "intervals": {"20": [["2026-04-01", "2026-06-30"],
                                         ["2026-07-10", None]],
                                  "25": [["2026-05-01", "2026-06-01"]],
                                  "30": []}},
            "CALM": {"basis": "sector", "group_id": "software_infra",
                     "intervals": {"20": [], "25": [], "30": []}},
        },
    }))
    monkeypatch.setattr(bridge, "MACRO", macro)
    out = tmp_path / "terminal" / "public" / "data" / "washout_history.json"
    monkeypatch.setattr(bridge, "OUT", out)

    assert bridge.main() == 0
    assert out.exists(), "the bridge reported success and wrote nothing"

    hist = load_history(out)
    assert hist is not None, "the reader refused the file its own bridge just wrote"
    assert hist.notch == WASHOUT_OVERRIDE_NOTCH

    ev = {"ts": "2026-05-04", "known_ts": "2026-05-04", "type": "BUY",
          "quality": "regime_blocked", "blocked": True}
    assert mark_retro("UEC", [ev], history=hist, live_as_of="2026-08-10") == 1
    assert ev["retro_ctx"]["group_id"] == "uranium_miners"
    # the open-ended window is honoured too (end=None means "still qualifying")
    open_ev = {"ts": "2026-07-20", "known_ts": "2026-07-20", "type": "BUY",
               "quality": "regime_blocked", "blocked": True}
    assert mark_retro("UEC", [open_ev], history=hist, live_as_of="2026-08-10") == 1
    # …and a name with no windows is still untouched
    calm = {"ts": "2026-05-04", "known_ts": "2026-05-04", "type": "BUY",
            "quality": "regime_blocked", "blocked": True}
    assert mark_retro("CALM", [calm], history=hist, live_as_of="2026-08-10") == 0


def test_the_history_bridge_leaves_the_old_file_alone_when_no_source_is_reachable(
        tmp_path, monkeypatch):
    """Failure tolerance, matching the state bridge: never raise, never truncate a good file.

    The nightly runs this step non-fatally, so its contract on a bad night is "change
    nothing" — a half-written or emptied artifact would be worse than a stale one.
    """
    import ingest.pull_macro_washout_history as bridge

    monkeypatch.setattr(bridge, "_fetch_url", lambda _url: None)
    monkeypatch.setattr(bridge, "MACRO", tmp_path / "nonexistent")
    out = tmp_path / "washout_history.json"
    out.write_text('{"schema":"washout_history/v1","names":{},"keep":"me"}')
    assert bridge.main() == 0                      # non-fatal
    assert json.loads(out.read_text())["keep"] == "me"


# ── coverage index (charting-app B5) ─────────────────────────────────────────────────────
#
# coverage.json tells the client which per-symbol artifacts exist, and the client trusts it
# BEFORE it makes any request. That makes it the same class of hazard as the washout bridges
# above, one layer out: an index generated on a different schedule than the artifacts it
# describes is silently wrong, and the wrongness is invisible from inside the app — the client
# does not 404, it does not request at all.
#
# Until this wave the index was regenerated ONLY by the Next package's `prebuild` (i.e. during a
# deploy) while `ops/terminal-data` published artifacts nightly. So: nightly writes XYZ.intel.json
# -> coverage still says XYZ has no intel -> an open tab refuses to ask for it. Pinning the step
# here is the producer half; the consumer half is the bounded TTL in terminal/lib/dataCache.ts.

COVERAGE_STEP = "scripts/build_data_coverage.py"


def test_the_nightly_regenerates_the_coverage_index():
    body = NIGHTLY.read_text()
    assert re.search(rf'^run "\$PY" {re.escape(COVERAGE_STEP)}\b', body, re.M), (
        f"{COVERAGE_STEP} is never invoked by ops/terminal-data — coverage.json would only be "
        "regenerated by a deploy, so every night's newly published artifacts stay invisible to "
        "any client that already read the index"
    )


def test_the_coverage_index_is_rebuilt_AFTER_every_artifact_writer():
    """Order is the whole point: an index built before the writers describes last night."""
    body = NIGHTLY.read_text().splitlines()

    def line_of(prefix: str) -> int:
        for i, ln in enumerate(body):
            if ln.strip().startswith(prefix):
                return i
        raise AssertionError(f"{prefix} not found in ops/terminal-data")

    coverage = line_of(f'run "$PY" {COVERAGE_STEP}')
    for writer in (
        'run "$PY" ingest/gen_slices_all.py',
        'run "$PY" ingest/pull_macro_intel.py',
        'run "$PY" ingest/backfill_ohlc.py',
        'run "$PY" ingest/refresh_crypto_ohlc.py',
        'run "$PY" ingest/hydrate_prices.py',
    ):
        assert line_of(writer) < coverage, f"{writer} must run BEFORE the coverage index"


def test_the_coverage_index_targets_the_live_data_dir_the_app_serves():
    """A coverage file written anywhere else is a file nobody reads."""
    body = NIGHTLY.read_text()
    assert re.search(
        rf'^run "\$PY" {re.escape(COVERAGE_STEP)} --data-dir "\$D"\s*$', body, re.M
    ), "the coverage step must write into $D (/opt/terminal/terminal/public/data)"


def test_the_coverage_writer_is_atomic_and_stamps_a_generation(tmp_path):
    """The PRODUCER half, executed.

    Atomicity is not decoration here: the deploy stages public/data as a hardlink farm
    (`cp -al` in ops/terminal-build.sh), so an in-place truncating write from the staged build
    would write THROUGH the shared inode into the live index.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "build_data_coverage", ROOT / "scripts" / "build_data_coverage.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "NVDA.intel.json").write_text("{}")
    (data_dir / "NVDA.json").write_text("[]")
    (data_dir / "manifest.json").write_text("{}")          # never a symbol

    out = data_dir / "coverage.json"
    # A pre-existing index sharing an inode with a "live" copy: an in-place write would
    # truncate BOTH. os.replace must leave the other link alone.
    out.write_text('{"intel":["STALE"]}')
    live_link = tmp_path / "live-coverage.json"
    os.link(out, live_link)

    module.write_atomic(out, '{"intel":["FRESH"]}')
    assert json.loads(out.read_text())["intel"] == ["FRESH"]
    assert json.loads(live_link.read_text())["intel"] == ["STALE"], (
        "write_atomic wrote through the hardlink — the deploy would clobber the live index"
    )
    assert not (data_dir / "coverage.json.tmp").exists()   # no temp file left behind

    # …and the generated document carries both freshness stamps.
    sys.argv = ["build_data_coverage.py", "--data-dir", str(data_dir)]
    assert module.main() == 0
    doc = json.loads(out.read_text())
    assert doc["intel"] == ["NVDA"]
    assert doc["ohlc"] == ["NVDA"]
    assert "manifest" not in doc["ohlc"]
    assert isinstance(doc["generation"], int) and doc["generation"] > 1_700_000_000
    assert doc["as_of"].endswith("Z")


def test_the_coverage_writer_refuses_to_publish_an_all_empty_index_for_a_missing_dir(tmp_path):
    """A freshly stamped 'nothing exists' is the one claim this file must never make.

    terminal/public/data is untracked, so a clean clone hits exactly this path — and the old
    behaviour wrote an index with every list empty and `as_of` = now, which the client trusts
    and pre-seeds every symbol's absence from.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "build_data_coverage_missing", ROOT / "scripts" / "build_data_coverage.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    missing = tmp_path / "not-there"
    sys.argv = ["build_data_coverage.py", "--data-dir", str(missing)]
    assert module.main() == 0                       # non-fatal: `npm run build` still works
    assert not (missing / "coverage.json").exists() # …and nothing was published
