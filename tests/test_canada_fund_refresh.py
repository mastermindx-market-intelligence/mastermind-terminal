"""Canadian (.TO) fundamentals refresh — scope, selection, and the freshness guarantees around it.

WHY THIS FILE EXISTS
--------------------
The live Terminal manifest carries 216 Canadian `.TO` listings (2026-10-21), including NA.TO and
SGD.TO which had no cache file at all.  But `ops/nightly_fund.sh` invoked `collect_us_fund.py`
with no scope flag, and `collect_us_fund.py --foreign` — the only way to reach `.TO` — means
"every non-US market" (~1.2k intl names).  So Canadian names were reachable only by a manual,
occasional, all-foreign run: every `.TO` fund.json froze on whatever was last cached while the
US half of the same fund lane refreshed nightly.  A graceful fallback was not the issue here;
the producer simply never ran.

These tests pin the three things that would silently regress again:
  1. SELECTION — `--canada` picks the Canadian listings and nothing else, and does not become a
     back door to `--foreign`'s whole international universe.
  2. SAFETY   — a degraded fetch must never overwrite a richer cache, and a failed fetch must not
     bump mtime into looking fresh.
  3. WIRING   — the nightly actually invokes the Canadian pass, and invokes it BEFORE the
     generator that publishes it.

No test here touches yfinance or the network: the manifest is a fixture and `fetch_one` is
monkeypatched.  The date stamps are literals from the real 2026-10-21 manifest inspection,
not generated values.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from ingest import collect_us_fund, gen_fund_us

ROOT = Path(__file__).resolve().parents[1]
NIGHTLY = ROOT / "ops" / "nightly_fund.sh"

# Real rows observed in the live manifest on 2026-10-21: 216 `.TO` listings, all mkt="TSX", plus
# ^GSPTSE (S&P/TSX Composite) which carries mkt="TSX" and is the ONLY TSX symbol without a .TO
# suffix.  That last row is the whole reason the scope is not a plain mkt filter.
MANIFEST_FIXTURE = {
    "symbols": {
        # ── Canadian listings ──
        "SHOP.TO": {"mkt": "TSX", "last": 120.0, "vol": 1000},
        "CNR.TO": {"mkt": "TSX", "last": 30.0, "vol": 500},
        "RY.TO": {"mkt": "TSX", "last": 60.0, "vol": 400},
        # Canadian listings that had NO cache file at all — the reason the pass is needed.
        "NA.TO": {"mkt": "TSX", "last": 25.0, "vol": 200},
        "SGD.TO": {"mkt": "TSX", "last": 5.0, "vol": 100},
        # A Canadian listing with no exchange label: the .TO suffix still identifies it.
        "XYZ.TO": {"last": 1.0},
        # ── the TSX index: must be excluded from every fundamental scope ──
        "^GSPTSE": {"mkt": "TSX", "last": 36107.96},
        # ── other markets: must never enter a --canada run ──
        "AAPL": {"mkt": "NASDAQ"},
        "SHOP": {"mkt": "NASDAQ"},
        "000001.SS": {"mkt": "Shanghai"},
        "0700.HK": {"mkt": "HK"},
        "7203.T": {"mkt": "Japan"},
        "RELIANCE.NS": {"mkt": "India"},
        "SAP.DE": {"mkt": "Germany"},
        "SHOP-USD": {"mkt": "crypto"},
        "^GSPC": {"mkt": "US"},
    }
}

EXPECTED_CANADA = ["CNR.TO", "NA.TO", "RY.TO", "SGD.TO", "SHOP.TO", "XYZ.TO"]


@pytest.fixture
def manifest(monkeypatch):
    """Serve the manifest fixture to the collector instead of the network."""
    monkeypatch.setattr(collect_us_fund, "load_manifest", lambda: MANIFEST_FIXTURE)
    return MANIFEST_FIXTURE


# ───────────────────────────── 1. selection ─────────────────────────────
def test_canada_universe_selects_exactly_the_canadian_listings(manifest):
    """The .TO listings are in scope — including the ones that had no cache file at all."""
    assert collect_us_fund.canada_universe() == EXPECTED_CANADA


def test_canada_universe_includes_na_and_sgd(manifest):
    """NA.TO and SGD.TO were manifest-listed but had no cache, so they never produced a fund.json.

    They are the specific names whose absence made Canadian coverage look deceptively complete.
    """
    got = collect_us_fund.canada_universe()
    assert "NA.TO" in got and "SGD.TO" in got


def test_canada_universe_excludes_the_tsx_index(manifest):
    """^GSPTSE is filed under mkt="TSX" but has no company fundamentals.

    Selecting by exchange alone would collect it and emit a junk fund.json for the S&P/TSX
    Composite; selecting by suffix alone would only exclude it by luck of the spelling.
    """
    assert "^GSPTSE" not in collect_us_fund.canada_universe()


def test_canada_universe_excludes_other_markets_and_crypto(manifest):
    """A Canada scope must not become a back door to the international universe."""
    got = set(collect_us_fund.canada_universe())
    for other in ("AAPL", "SHOP", "000001.SS", "0700.HK", "7203.T",
                  "RELIANCE.NS", "SAP.DE", "SHOP-USD", "^GSPC"):
        assert other not in got, f"{other} must never be collected by a --canada run"


def test_canada_universe_is_narrower_than_foreign(manifest):
    """--foreign stays "every non-US market"; --canada is the narrow scheduled subset.

    Without this, a Canada pass would quietly become a 1.2k-symbol international run.
    """
    foreign = set(collect_us_fund.foreign_universe())
    canada = set(collect_us_fund.canada_universe())
    assert canada < foreign
    assert not (canada - foreign)


def test_canada_scope_is_selected_by_the_cli_flag(manifest, monkeypatch, tmp_path, capsys):
    """The scope must be reachable by flag, not only by importing the helper."""
    monkeypatch.setattr(collect_us_fund, "OUT", tmp_path / "us_fund")
    monkeypatch.setattr(collect_us_fund, "fetch_one", lambda sym: None)
    collect_us_fund.main(["--canada", "--limit", "0"])
    out = capsys.readouterr().out
    assert "--canada" in out
    assert "6 Canadian .TO manifest symbols" in out


def test_foreign_flag_still_works_after_the_canada_scope(manifest, monkeypatch):
    """Adding --canada must not regress --foreign, which other operators already use."""
    monkeypatch.setattr(collect_us_fund, "load_manifest", lambda: MANIFEST_FIXTURE)
    foreign = collect_us_fund.foreign_universe()
    assert "SHOP.TO" in foreign and "7203.T" in foreign and "RELIANCE.NS" in foreign


# ───────────────────────────── 2. freshness safety ─────────────────────────────
def _age_to(path: Path, iso_date: str) -> None:
    """Backdate a cache file's mtime — freshness in this lane is mtime-based, not date-based."""
    import os
    stamp = dt.datetime.strptime(iso_date, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp()
    os.utime(path, (stamp, stamp))


def _rich_payload(fetched_at="2026-07-14T00:00:00Z"):
    """A cache carrying real statement depth — the thing a bad fetch used to destroy."""
    return {
        "ticker": "SHOP.TO",
        "fetched_at": fetched_at,
        "info": {"currency": "CAD", "financialCurrency": "CAD", "longName": "Shopify"},
        "income_stmt": {"columns": ["2026-06-30"], "index": ["Total Revenue"], "data": [[1]]},
        "quarterly_income_stmt": {"columns": ["2026-06-30"], "index": ["Total Revenue"], "data": [[1]]},
        "balance_sheet": {"columns": ["2026-06-30"], "index": ["Total Assets"], "data": [[1]]},
        "quarterly_balance_sheet": {"columns": ["2026-06-30"], "index": ["Total Assets"], "data": [[1]]},
        "cashflow": {"columns": ["2026-06-30"], "index": ["Free Cash Flow"], "data": [[1]]},
        "dividends": {"index": ["2026-05-01"], "values": [0.2]},
        "_errors": [],
    }


def test_degraded_fetch_does_not_overwrite_a_rich_cache(manifest, tmp_path, monkeypatch):
    """An info-only fetch must not replace years of statements — and must not look fresh after.

    The old driver wrote whatever came back and bumped mtime, so one rate-limited response
    replaced good data AND caused the next run to skip the symbol as fresh. Both are regressions.
    """
    out = tmp_path / "us_fund"
    out.mkdir()
    dest = out / "SHOP.TO.json"
    dest.write_text(json.dumps(_rich_payload()))
    # Age the cache to the real-world case: a .TO file last refreshed back in July.
    _age_to(dest, "2026-07-14")

    thin = {"ticker": "SHOP.TO", "fetched_at": "2026-10-21T00:00:00Z",
            "info": {"currency": "CAD"}, "_errors": ["income_stmt:HTTPError"]}
    monkeypatch.setattr(collect_us_fund, "OUT", out)
    monkeypatch.setattr(collect_us_fund, "load_manifest", lambda: MANIFEST_FIXTURE)
    monkeypatch.setattr(collect_us_fund, "fetch_one", lambda sym: thin)

    collect_us_fund.main(["--canada", "--force", "--workers", "1", "--delay", "0", "0"])

    kept = json.loads(dest.read_text())
    assert kept["income_stmt"], "rich statements were destroyed by a thinner fetch"
    assert kept["fetched_at"] == "2026-07-14T00:00:00Z", "stale data was stamped as current"
    assert not collect_us_fund.is_fresh(dest, 3), "kept cache must stay stale so it is retried"


def test_equal_richness_still_writes(manifest, tmp_path, monkeypatch):
    """The guard blocks downgrades only — a normal refresh must still land."""
    out = tmp_path / "us_fund"
    out.mkdir()
    dest = out / "SHOP.TO.json"
    dest.write_text(json.dumps(_rich_payload()))

    fresh = _rich_payload(fetched_at="2026-10-21T00:00:00Z")
    monkeypatch.setattr(collect_us_fund, "OUT", out)
    monkeypatch.setattr(collect_us_fund, "load_manifest", lambda: MANIFEST_FIXTURE)
    monkeypatch.setattr(collect_us_fund, "fetch_one", lambda sym: fresh)

    collect_us_fund.main(["--canada", "--force", "--workers", "1", "--delay", "0", "0"])
    assert json.loads(dest.read_text())["fetched_at"] == "2026-10-21T00:00:00Z"


def test_deadline_defers_symbols_instead_of_failing_them(manifest, tmp_path, monkeypatch, capsys):
    """A wall-clock budget must end the pass cleanly, leaving the rest for the next night.

    macOS ships no `timeout(1)`, so the nightly needs the budget passed into the process. The
    pass must stop WITHOUT reporting the deferred names as failures and without raising.
    """
    out = tmp_path / "us_fund"
    out.mkdir()
    monkeypatch.setattr(collect_us_fund, "OUT", out)
    monkeypatch.setattr(collect_us_fund, "load_manifest", lambda: MANIFEST_FIXTURE)
    monkeypatch.setattr(collect_us_fund, "fetch_one",
                        lambda sym: {"info": {"currency": "CAD"}, "_errors": []})

    # A budget already in the past: the same code path the nightly hits when it runs late.
    collect_us_fund.main(["--canada", "--force", "--workers", "1", "--delay", "0", "0",
                          "--deadline-seconds", "-1"])
    captured = capsys.readouterr().out
    assert "deadline reached at 0/6" in captured
    assert "(DEADLINE)" in captured
    assert "deferred to the next run" in captured
    assert not list(out.glob("*.json")), "a past deadline must fetch nothing, not everything"


def test_cache_richness_orders_real_data_above_a_shell():
    assert collect_us_fund.cache_richness(_rich_payload()) > collect_us_fund.cache_richness(
        {"ticker": "SHOP.TO", "info": {"currency": "CAD"}, "_errors": ["x"]}
    )
    assert collect_us_fund.cache_richness(None) == -1


# ───────────────────────────── 3. emitter ─────────────────────────────
def test_emitter_publishes_canadian_names_and_keeps_currency_split():
    """A Canadian quote in CAD whose statements are USD must keep BOTH currencies apart.

    SHOP quotes in CAD and reports statements in USD; collapsing them into one field is exactly the
    kind of fabricated data this lane must not produce.
    """
    cache = {
        "ticker": "SHOP.TO",
        "fetched_at": "2026-07-14T00:00:00Z",
        "info": {"currency": "CAD", "financialCurrency": "USD"},
    }
    fund = gen_fund_us.build_fund("SHOP.TO", cache, {}, None)
    assert fund["quote_currency"] == "CAD"
    assert fund["stmt_currency"] == "USD"


def test_emitter_carries_the_real_source_fetch_time():
    """`asof` is the BUILD date and stays that way; source age travels separately and truthfully.

    A Canadian fund.json regenerated tonight from a July cache must not read as fresh.
    """
    cache = {"ticker": "CNR.TO", "fetched_at": "2026-07-14T00:00:00Z", "info": {"currency": "CAD"}}
    fund = gen_fund_us.build_fund("CNR.TO", cache, {}, None)
    assert fund["src"]["cache_fetched_at"] == "2026-07-14T00:00:00Z"
    assert fund["asof"] == dt.date.today().isoformat()


def test_emitter_source_freshness_is_null_rather_than_invented():
    """No stamp in the cache means no claim about the source — never a fabricated timestamp."""
    fund = gen_fund_us.build_fund("RY.TO", {"info": {"currency": "CAD"}}, {}, None)
    assert fund["src"]["cache_fetched_at"] is None


def test_emitter_canada_scope_is_cache_driven(tmp_path, monkeypatch):
    """The emitter publishes what the collector cached, so a missing cache means no fund.json.

    Selecting from the manifest here would emit an empty file for a name never successfully
    fetched — truthful-looking but unbacked.
    """
    cache = tmp_path / "us_fund"
    cache.mkdir()
    (cache / "SHOP.TO.json").write_text(json.dumps({"info": {"currency": "CAD"}}))
    (cache / "AAPL.json").write_text(json.dumps({"info": {"currency": "USD"}}))
    (cache / "^GSPTSE.json").write_text(json.dumps({"info": {}}))
    (cache / "_tx_index.json").write_text("{}")

    emitted = []
    monkeypatch.setattr(gen_fund_us, "CACHE", cache)
    monkeypatch.setattr(gen_fund_us, "SITE", tmp_path / "stockdata")
    monkeypatch.setattr(gen_fund_us, "OUT", tmp_path / "out")
    monkeypatch.setattr(gen_fund_us, "atomic_write",
                        lambda dest, text: emitted.append(Path(dest).name))
    monkeypatch.setattr(gen_fund_us, "load_tx_index", lambda: {})

    gen_fund_us.main(["--canada"])
    assert emitted == ["SHOP.TO.fund.json"]
    assert not any("GSPTSE" in name for name in emitted)
    assert not any("AAPL" in name for name in emitted)


# ───────────────────────────── 4. wiring ─────────────────────────────
def test_nightly_invokes_the_canada_pass():
    """Shipping a scope is not the same as running it.

    A collector that exists but is never invoked is indistinguishable from a broken wiring
    when every consumer degrades gracefully — the Canadian files simply stay frozen.
    """
    body = NIGHTLY.read_text()
    assert re.search(r'^\s*"\$PY" "\$DEPLOY/ingest/collect_us_fund\.py" --canada\b',
                     body, re.M), (
        "ops/nightly_fund.sh never invokes the Canadian pass — .TO fund.json will stay frozen "
        "at its last cached fetch, exactly as it did before this change"
    )


def _canada_invocation(body: str) -> str:
    """The Canadian collect command, ignoring the flow comment that also names --canada.

    Joined across its `\\` continuations: the flags are split over two lines, and a per-line
    assertion would silently check only the first half.
    """
    lines = body.splitlines()
    for i, line in enumerate(lines):
        if '"$DEPLOY/ingest/collect_us_fund.py" --canada' in line and not line.lstrip().startswith("#"):
            block = [line]
            while block[-1].rstrip().endswith("\\"):
                block.append(lines[i + len(block)])
            return "\n".join(block)
    raise AssertionError("no --canada invocation line found in ops/nightly_fund.sh")


def test_nightly_canada_pass_runs_before_the_generator():
    """Order is the contract: collect AFTER gen would publish the previous night's cache."""
    body = NIGHTLY.read_text()
    assert body.index(_canada_invocation(body)) < body.index('ingest/gen_fund_us.py'), (
        "the Canadian collect must precede gen_fund_us in the same run"
    )


def test_nightly_canada_pass_is_bounded_and_gentle():
    """workers=1 plus a deadline keeps Canada off yfinance's rate limit and off the 18:30 lane."""
    body = NIGHTLY.read_text()
    line = _canada_invocation(body)
    assert "--workers 1" in line, "the Canada pass must not share yfinance load"
    assert "--deadline-seconds" in line, "the Canada pass must be wall-clock bounded"
    assert 'run_bounded.py" --daily-budget' in body
    assert 'run_bounded.py" --seconds' in body


def test_nightly_us_pass_is_unchanged():
    """The Canada addition must not disturb the US half of the lane."""
    body = NIGHTLY.read_text()
    assert re.search(
        r'^"\$PY" "\$DEPLOY/ingest/collect_us_fund\.py" --workers 2 --stale-days 3 --delay 2\.0 5\.0 ',
        body, re.M,
    ), "the US collect invocation changed — the Canada pass must be additive"


# ───────────────────────────── 5. import discipline ─────────────────────────────
@pytest.mark.parametrize("module", ["collect_us_fund", "gen_fund_us"])
def test_module_imports_with_ingest_as_script_path(module):
    """`ingest/` runs as scripts, so sys.path[0] is ingest/ — not the repo root.

    pytest puts the root on sys.path and would pass a bare `from ingest.x import y` that raises
    ModuleNotFoundError in the nightly and aborts the run before deploy. Import each the way the
    nightly does: as a script from inside ingest/.
    """
    proc = subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        cwd=ROOT / "ingest", capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, f"`python ingest/{module}.py` style import failed:\n{proc.stderr}"