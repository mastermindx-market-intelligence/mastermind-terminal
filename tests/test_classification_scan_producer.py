"""The cross-market classification PRODUCER (E03): ``ingest/gen_classification_scan.py``.

The Screener screens across markets on one bounded document, ``/data/scan/classification.json``.
This file pins what that document may say:

* a label is the owner record's own text, attributed to a taxonomy only when the record's
  provenance proves which one (AC-E03-02), and the undated manifest ``gics`` snapshot can only
  ever be ``stale`` (AC-E03-03);
* every listing is its own row with its own currency, so two listings of one issuer never
  collide (AC-E03-01), and nothing is converted or read from a ticker suffix (AC-E03-04);
* the real owner records committed under ``tests/fixtures/classification`` (trimmed copies of
  the published files; sha256 of each original in ``PROVENANCE.json``) classify exactly as
  their owners wrote them (AC-E03-06);
* publication is E01's guard (adoption rule, atomic replace, receipt);
* the document the TS reader is tested against (``classification.producer.json``) is
  regenerated from this producer, byte for byte.

Regenerate the committed producer fixture (only when the contract or vocabulary changes)::

    UPDATE_SCAN_FIXTURE=1 python3 -m pytest tests/test_classification_scan_producer.py -k fixture
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ingest import gen_classification_scan as scan  # noqa: E402
from ingest.macro_catalog import iter_catalog  # noqa: E402

SAMPLES = ROOT / "tests" / "fixtures" / "classification"
FIXTURE = (ROOT / "terminal" / "lib" / "__tests__" / "fixtures" / "screenerScan"
           / "classification.producer.json")
TS_READER = ROOT / "terminal" / "lib" / "classificationScan.ts"
NOW = 1791684000            # 2026-10-11T02:00:00Z — the generation clock of the fixture

E, ST, UNS, UNA = "evaluated", "stale", "unsupported", "unavailable"

# (sym) → expected (status, reason, label) for every taxonomy, from the REAL owner records.
# A label of None means the cell carries no label.
EXPECTED: dict[str, dict[str, tuple]] = {
    # HK (gen_fund_hk, yfinance info): Yahoo, always — the shared label included
    "0700.HK": {"yahoo_sector": (E, "ok", "Communication Services"),
                "yahoo_industry": (E, "ok", "Internet Content & Information"),
                "gics_sector": (UNS, "taxonomy_not_supplied", None)},
    "9988.HK": {"yahoo_sector": (E, "ok", "Consumer Cyclical"),
                "yahoo_industry": (E, "ok", "Internet Retail")},
    "80700.HK": {"yahoo_sector": (UNA, "not_classified", None),
                 "yahoo_industry": (UNA, "not_classified", None)},
    # CN (gen_fund_cn): its own taxonomy; the owner's "A-share" sentinel is not a sector
    "000001.SZ": {"cn_profile_sector": (E, "ok", "Financial Services"),
                  "yahoo_sector": (UNS, "taxonomy_not_supplied", None),
                  "gics_sector": (UNS, "taxonomy_not_supplied", None)},
    "600519.SS": {"cn_profile_sector": (E, "ok", "Consumer Defensive")},
    "688781.SS": {"cn_profile_sector": (UNA, "not_classified", None)},
    # yfinance lane (US + international): attributed by closed vocabulary only
    "2330.TW": {"yahoo_sector": (E, "ok", "Technology"),
                "yahoo_industry": (E, "ok", "Semiconductors")},
    "005930.KS": {"yahoo_sector": (E, "ok", "Technology")},
    "7203.T": {"yahoo_sector": (E, "ok", "Consumer Cyclical")},
    "HSBA.L": {"yahoo_sector": (E, "ok", "Financial Services")},
    "CBK.DE": {"yahoo_sector": (E, "ok", "Financial Services")},
    "RY.TO": {"yahoo_sector": (E, "ok", "Financial Services")},
    "SHOP.TO": {"yahoo_industry": (E, "ok", "Software - Application")},
    "RELIANCE.NS": {"yahoo_sector": (UNS, "taxonomy_ambiguous", "Energy"),
                    "gics_sector": (UNS, "taxonomy_ambiguous", "Energy"),
                    "yahoo_industry": (UNS, "taxonomy_ambiguous", "Oil & Gas Refining & Marketing")},
    "NVDA": {"gics_sector": (E, "ok", "Information Technology"),
             "yahoo_sector": (UNS, "taxonomy_not_supplied", None)},
    "COIN": {"gics_sector": (E, "ok", "Financials")},
    "AAPL": {"gics_sector": (ST, "snapshot_undated", "Information Technology"),
             "yahoo_sector": (E, "ok", "Technology"),
             "yahoo_industry": (E, "ok", "Consumer Electronics")},
    "PFE": {"gics_sector": (ST, "snapshot_undated", "Health Care"),
            "yahoo_sector": (E, "ok", "Healthcare")},
    "PG": {"gics_sector": (ST, "snapshot_undated", "Consumer Staples"),
           "yahoo_sector": (E, "ok", "Consumer Defensive")},
    "XOM": {"gics_sector": (ST, "snapshot_undated", "Energy"),
            "yahoo_sector": (UNS, "taxonomy_ambiguous", "Energy"),
            "yahoo_industry": (UNS, "taxonomy_ambiguous", "Oil & Gas Integrated")},
    "BA": {"gics_sector": (ST, "snapshot_undated", "Industrials"),
           "yahoo_sector": (UNS, "taxonomy_ambiguous", "Industrials")},
    "ARM": {"yahoo_sector": (E, "ok", "Technology"),
            "gics_sector": (UNS, "taxonomy_not_supplied", None)},
    "BABA": {"gics_sector": (UNA, "not_classified", None),
             "yahoo_sector": (UNA, "not_classified", None)},
    "TSM": {"yahoo_sector": (UNA, "not_classified", None)},
    "MSTR": {"gics_sector": (UNA, "not_classified", None)},
    # not equities: never classified under an equity taxonomy
    "SPY": {t: (UNS, "asset_class_not_covered", None) for t in scan.TAXONOMY_IDS},
    "BTC-USD": {t: (UNS, "asset_class_not_covered", None) for t in scan.TAXONOMY_IDS},
    "^GSPC": {t: (UNS, "asset_class_not_covered", None) for t in scan.TAXONOMY_IDS},
}

EXPECTED_CCY = {
    "0700.HK": "HKD", "80700.HK": "CNY", "9988.HK": "HKD", "000001.SZ": "CNY",
    "600519.SS": "CNY", "688781.SS": "CNY", "2330.TW": "TWD", "005930.KS": "KRW",
    "7203.T": "JPY", "HSBA.L": "GBp", "CBK.DE": "EUR", "RELIANCE.NS": "INR", "RY.TO": "CAD",
    "SHOP.TO": "CAD", "BABA": "USD", "TSM": "USD", "SPY": "USD", "NVDA": "USD", "AAPL": "USD",
    "XOM": "USD", "BA": "USD", "COIN": "USD", "PFE": "USD", "PG": "USD", "MSTR": "USD",
    "ARM": "USD", "BTC-USD": "USD",
}
NOT_MONEY = ("^GSPC", "^TNX", "EURUSD=X", "ES=F")


# ── helpers ─────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def data_dir(tmp_path) -> Path:
    d = tmp_path / "data"
    shutil.copytree(SAMPLES, d)
    (d / "PROVENANCE.json").unlink()
    return d


def _rows(doc: dict) -> dict[str, dict]:
    return {r["sym"]: r for r in doc["rows"]}


def _scan_path(d: Path) -> Path:
    return d / scan.SCAN_DIRNAME / scan.SCAN_FILENAME


def _receipt(d: Path) -> dict:
    return json.loads((d / scan.SCAN_DIRNAME / scan.RECEIPT_FILENAME).read_text())


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest(d: Path) -> dict:
    return json.loads((d / "manifest.json").read_text())


def _add(d: Path, sym: str, row: dict, record=None, raw: bytes | None = None) -> None:
    man = _manifest(d)
    man["symbols"][sym] = row
    _write(d / "manifest.json", man)
    if raw is not None:
        (d / f"{sym}.fund.json").write_bytes(raw)
    elif record is not None:
        _write(d / f"{sym}.fund.json", record)


def _rec(sym: str, *, sector=None, industry=None, lane="yfinance", asof="2026-10-01",
         ccy="USD") -> dict:
    return {"ticker": sym, "asof": asof, "quote_currency": ccy, "src": {"statements": lane},
            "profile": {"sector": sector, "industry": industry}}


# ── the committed samples ARE the published owner records ───────────────────────────────
def test_samples_are_trimmed_published_records():
    prov = json.loads((SAMPLES / "PROVENANCE.json").read_text())
    man = _manifest(SAMPLES)
    assert sorted(man["symbols"]) == prov["manifest"]["rows_kept"]
    for sym, ent in prov["records"].items():
        assert ent["source"] == f"https://app.mastermind-x.com/data/{sym}.fund.json"
        assert re.fullmatch(r"[0-9a-f]{64}", ent["sha256"])
        doc_bytes = (SAMPLES / f"{sym}.fund.json").read_bytes()
        if ent["bytes"] == 0:
            assert doc_bytes == b""            # the published file really is empty
            continue
        doc = json.loads(doc_bytes)
        assert doc["ticker"] == sym
        assert set(doc) == {"ticker", "asof", "quote_currency", "src", "profile"}


# ── constants restated from elsewhere are pinned to their owner ─────────────────────────
def test_reason_vocabulary_is_the_ts_readers():
    ts = TS_READER.read_text()
    for status, reasons in scan.REASONS.items():
        line = next(ln for ln in ts.splitlines() if ln.strip().startswith(f"{status}: ["))
        assert ast.literal_eval(line.split(":", 1)[1].strip().rstrip(",")) == list(reasons)
    assert scan.SCAN_SCHEMA in (ROOT / "terminal" / "lib" / "screenerScan.ts").read_text()
    for t in scan.TAXONOMY_IDS:
        assert f'"{t}"' in ts, t


def test_closed_vocabularies_are_the_screeners_and_the_ts_readers():
    tsx = (ROOT / "terminal" / "components" / "ScreenerView.tsx").read_text()
    body = tsx[tsx.index("const GICS_TKEY"):]
    body = body[: body.index("};")]
    assert sorted(re.findall(r'"([^"]+)":', body)) == sorted(scan.GICS_SECTORS)
    ts = TS_READER.read_text()
    for label in scan.YAHOO_SECTORS + scan.GICS_SECTORS:
        assert f'"{label}"' in ts, label
    assert set(scan.SHARED_SECTORS) == {"Communication Services", "Energy", "Industrials",
                                        "Real Estate", "Utilities"}


def test_crypto_currency_is_the_catalogs_usd_selection():
    cat = {s.sym for s in iter_catalog() if s.sec == "Crypto"}
    assert scan.crypto_catalog() == cat
    assert cat and all(s.endswith("-USD") for s in cat)


# ── AC-E03-06: real owner records classify exactly as their owners wrote them ───────────
def test_real_records_classify_as_their_owners_wrote_them(data_dir):
    rows = _rows(scan.build_scan(data_dir, NOW))
    for sym, cells in EXPECTED.items():
        for tax, (status, reason, label) in cells.items():
            c = rows[sym]["class"][tax]
            assert (c["status"], c["reason"]) == (status, reason), (sym, tax, c)
            assert c.get("label") == label, (sym, tax, c)
    for sym, row in rows.items():
        rec_path = data_dir / f"{sym}.fund.json"
        if not rec_path.is_file() or not rec_path.read_bytes().strip():
            continue
        rec = json.loads(rec_path.read_text())
        prof = rec["profile"]
        for tax, c in row["class"].items():
            if c["status"] != "evaluated":
                continue
            src = prof["industry"] if tax == "yahoo_industry" else prof["sector"]
            assert c["label"] == src, (sym, tax)            # verbatim, never translated
            assert c["as_of"] == rec["asof"] and c["source"] == "fund_profile", (sym, tax)


def test_a_manifest_gics_snapshot_is_never_the_current_sector(data_dir):
    """AC-E03-03: the undated manifest field may be SHOWN, never evaluated."""
    doc = scan.build_scan(data_dir, NOW)
    for r in doc["rows"]:
        for c in r["class"].values():
            if c.get("source") == "manifest_gics":
                assert (c["status"], c["reason"], c["as_of"]) == (ST, "snapshot_undated", None)
            if c["status"] == "evaluated":
                assert c["source"] == "fund_profile" and scan.is_iso_date(c["as_of"])


def test_a_dated_record_that_disagrees_with_the_snapshot_is_a_reclassification(data_dir):
    _add(data_dir, "ZZRC", {"sec": "Equities", "mkt": "NYSE", "gics": "Financials"},
         _rec("ZZRC", sector="Information Technology"))
    c = _rows(scan.build_scan(data_dir, NOW))["ZZRC"]["class"]["gics_sector"]
    assert (c["status"], c["label"], c["reclassified_from"]) == (E, "Information Technology",
                                                                 "Financials")
    # NVDA's record agrees with its snapshot: no reclassification is claimed
    assert "reclassified_from" not in _rows(scan.build_scan(data_dir, NOW))["NVDA"]["class"]["gics_sector"]


def test_an_undated_record_label_is_stale_not_current(data_dir):
    _add(data_dir, "ZZUD", {"sec": "Equities", "mkt": "HKEX"},
         _rec("ZZUD", sector="Technology", industry="Semiconductors", lane="akshare",
              asof="2026-13-40", ccy="HKD"))
    row = _rows(scan.build_scan(data_dir, NOW))["ZZUD"]
    for tax in ("yahoo_sector", "yahoo_industry"):
        c = row["class"][tax]
        assert (c["status"], c["reason"], c["as_of"]) == (ST, "record_undated", None)
    assert row["currency"] == {"status": E, "reason": "ok", "code": "HKD", "as_of": None,
                               "source": "fund_quote_currency"}


# ── AC-E03-01 / -04: listing identity and currency ──────────────────────────────────────
def test_two_listings_of_one_issuer_stay_two_listings_with_their_own_currency(data_dir):
    rows = _rows(scan.build_scan(data_dir, NOW))
    for a, b in (("0700.HK", "80700.HK"), ("BABA", "9988.HK"), ("TSM", "2330.TW")):
        assert rows[a]["sym"] != rows[b]["sym"]
        assert rows[a]["currency"]["code"] != rows[b]["currency"]["code"], (a, b)
    assert rows["0700.HK"]["mkt"] == rows["80700.HK"]["mkt"] == "HKEX"   # same venue, still two
    assert rows["80700.HK"]["currency"]["code"] == "CNY"                  # the RMB counter


def test_currency_is_the_owner_records_code_verbatim(data_dir):
    rows = _rows(scan.build_scan(data_dir, NOW))
    for sym, code in EXPECTED_CCY.items():
        c = rows[sym]["currency"]
        assert (c["status"], c["code"]) == (E, code), sym
        want = "crypto_catalog" if sym == "BTC-USD" else "fund_quote_currency"
        assert c["source"] == want
    assert rows["HSBA.L"]["currency"]["code"] == "GBp"     # pence, never silently GBP
    for sym in NOT_MONEY:
        assert rows[sym]["currency"] == {"status": UNS, "reason": "currency_not_applicable"}


def test_currency_is_never_read_from_a_ticker_suffix(data_dir):
    _add(data_dir, "ZZNC.HK", {"sec": "Equities", "mkt": "HKEX"},
         {**_rec("ZZNC.HK", lane="akshare"), "quote_currency": None})
    _add(data_dir, "ZZNR.TO", {"sec": "Equities", "mkt": "TSX"})
    _add(data_dir, "DOGE9-USD", {"sec": "Crypto", "mkt": "Crypto"})
    rows = _rows(scan.build_scan(data_dir, NOW))
    assert rows["ZZNC.HK"]["currency"] == {"status": UNA, "reason": "currency_missing"}
    assert rows["ZZNR.TO"]["currency"] == {"status": UNA, "reason": "no_fund_record"}
    assert rows["DOGE9-USD"]["currency"] == {"status": UNA, "reason": "not_in_catalog"}


# ── every remaining reason path ─────────────────────────────────────────────────────────
def test_unreadable_unrecognized_and_out_of_vocabulary_records(data_dir):
    _add(data_dir, "ZZEMPTY", {"sec": "Equities", "mkt": "NYSE", "gics": "Energy"}, raw=b"")
    _add(data_dir, "ZZWRONG", {"sec": "Equities", "mkt": "NYSE"}, _rec("SOMEONE_ELSE",
                                                                      sector="Technology"))
    _add(data_dir, "ZZLANE", {"sec": "Equities", "mkt": "NYSE"},
         _rec("ZZLANE", sector="Technology", lane="massive"))
    _add(data_dir, "ZZOOV", {"sec": "Equities", "mkt": "NYSE"}, _rec("ZZOOV", sector="A-share"))
    _add(data_dir, "ZZHKOOV", {"sec": "Equities", "mkt": "HKEX"},
         _rec("ZZHKOOV", sector="Financials", lane="akshare", ccy="HKD"))
    _add(data_dir, "ZZNOREC", {"sec": "Equities", "mkt": "NASDAQ", "gics": "Materials"})
    rows = _rows(scan.build_scan(data_dir, NOW))

    empty = rows["ZZEMPTY"]
    assert empty["currency"] == {"status": UNA, "reason": "record_unreadable"}
    assert empty["class"]["yahoo_sector"] == {"status": UNA, "reason": "record_unreadable"}
    assert empty["class"]["gics_sector"]["reason"] == "snapshot_undated"   # still shown, stale
    assert rows["ZZWRONG"]["class"]["yahoo_sector"]["reason"] == "record_unreadable"
    assert rows["ZZLANE"]["class"]["yahoo_sector"] == {"status": UNS, "reason": "lane_unrecognized"}
    assert rows["ZZLANE"]["lane"] is None
    oov = rows["ZZOOV"]["class"]
    assert oov["yahoo_sector"] == {"status": UNS, "reason": "label_outside_vocabulary",
                                   "label": "A-share"}
    assert oov["gics_sector"]["reason"] == "label_outside_vocabulary"
    assert rows["ZZHKOOV"]["class"]["yahoo_sector"]["reason"] == "label_outside_vocabulary"
    norec = rows["ZZNOREC"]
    assert norec["class"]["yahoo_sector"] == {"status": UNA, "reason": "no_fund_record"}
    assert norec["class"]["gics_sector"]["label"] == "Materials"
    assert norec["currency"] == {"status": UNA, "reason": "no_fund_record"}


def test_every_producer_reason_is_reachable(data_dir):
    """The vocabulary has no dead reason: each one is produced by some path in this file."""
    test_unreadable_unrecognized_and_out_of_vocabulary_records(data_dir)
    _add(data_dir, "ZZUD2", {"sec": "Equities"}, _rec("ZZUD2", sector="Technology", asof=None))
    _add(data_dir, "ZZNOCCY", {"sec": "Equities"}, {**_rec("ZZNOCCY"), "quote_currency": "usd"})
    _add(data_dir, "DOGE9-USD", {"sec": "Crypto", "mkt": "Crypto"})
    seen = set()
    for r in scan.build_scan(data_dir, NOW)["rows"]:
        seen.update(c["reason"] for c in (r["currency"], *r["class"].values()))
    for r in scan.build_scan(data_dir, NOW, limit=1)["rows"]:
        seen.update(c["reason"] for c in (r["currency"], *r["class"].values()))
    assert seen - {"ok"} == set(scan.STATUS_OF)


def test_one_bad_record_never_aborts_the_generation(data_dir, monkeypatch):
    real = scan.classify_symbol

    def boom(d, sym, mrow, crypto):
        if sym == "NVDA":
            raise RuntimeError("synthetic")
        return real(d, sym, mrow, crypto)
    monkeypatch.setattr(scan, "classify_symbol", boom)
    doc = scan.build_scan(data_dir, NOW)
    nv = _rows(doc)["NVDA"]
    assert nv["currency"]["reason"] == "record_unreadable"
    assert doc["complete"] is True and scan.validate_scan(doc) is None


def test_rows_equal_the_manifest_and_venue_is_copied(data_dir):
    doc = scan.build_scan(data_dir, NOW)
    man = _manifest(data_dir)
    assert [r["sym"] for r in doc["rows"]] == sorted(man["symbols"])
    assert doc["universe"] == {"source": "manifest", "as_of": man["as_of"],
                               "count": len(man["symbols"])}
    for r in doc["rows"]:
        m = man["symbols"][r["sym"]]
        assert r.get("mkt") == m.get("mkt") and r.get("sec") == m.get("sec")
    assert doc["crosswalks"] == {}                         # the E03 falsifier: none fabricated
    assert set(doc["taxonomies"]) == set(scan.TAXONOMY_IDS)
    assert all(t["version"] is None for t in doc["taxonomies"].values())


def test_limit_and_budget_mark_the_rest_not_processed_and_the_run_incomplete(data_dir):
    doc = scan.build_scan(data_dir, NOW, limit=3)
    assert doc["complete"] is False
    rest = doc["rows"][3:]
    assert rest and all(r["currency"]["reason"] == "not_processed" for r in rest)
    assert all(c["reason"] == "not_processed" for r in rest for c in r["class"].values())
    ticks = iter(range(0, 10_000, 5))
    doc = scan.build_scan(data_dir, NOW, budget_seconds=12, clock=lambda: next(ticks))
    assert doc["complete"] is False
    assert scan.validate_scan(doc) is None
    doc["complete"] = True
    assert scan.validate_scan(doc) == "complete_with_not_processed"


def test_an_unreadable_manifest_is_no_generation(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    with pytest.raises(Exception):
        scan.build_scan(d, NOW)


@pytest.mark.parametrize("mutate, error", [
    (lambda d: d.update(crosswalks={"gics_sector": {"Technology": "Information Technology"}}),
     "crosswalks_invalid"),
    (lambda d: d["taxonomies"].pop("cn_profile_sector"), "taxonomies_invalid"),
    (lambda d: d["rows"][0]["class"]["gics_sector"].update(status="evaluated", reason="ok",
                                                          label="X", as_of=None,
                                                          source="manifest_gics"),
     "row_cell_invalid"),
    (lambda d: d["rows"][0]["currency"].update(status="stale", reason="currency_missing"),
     "row_cell_invalid"),
    (lambda d: d["rows"][0]["class"]["yahoo_sector"].update(status="stale",
                                                           reason="taxonomy_ambiguous"),
     "row_cell_invalid"),
])
def test_validation_refuses_what_the_reader_would(data_dir, mutate, error):
    doc = scan.build_scan(data_dir, NOW)
    mutate(doc)
    assert scan.validate_scan(doc) == error


# ── publication (E01's guard, this family's files) ──────────────────────────────────────
def test_publication_sequence_and_receipts(data_dir):
    live = _scan_path(data_dir)
    r = scan.publish(data_dir, scan.build_scan(data_dir, NOW, limit=2))
    assert (r["decision"], r["published"], r["complete"]) == ("first", True, False)
    assert r["sha256"] == r["live_sha256"] == _sha(live)
    assert r["family"] == "classification" and r["schema"] == scan.RECEIPT_SCHEMA

    r = scan.publish(data_dir, scan.build_scan(data_dir, NOW + 10))
    assert (r["decision"], r["published"]) == ("newer_complete", True)
    held = _sha(live)
    assert r["currency"]["evaluated"]["ok"] == len(EXPECTED_CCY)
    assert r["class"]["gics_sector"]["stale"]["snapshot_undated"] == 5

    r = scan.publish(data_dir, scan.build_scan(data_dir, NOW + 20, limit=1))
    assert (r["decision"], r["published"]) == ("incomplete_over_complete", False)
    assert _sha(live) == held and r["sha256"] != r["live_sha256"] == held

    r = scan.publish(data_dir, scan.build_scan(data_dir, NOW + 10))
    assert (r["decision"], r["published"]) == ("not_newer", False)
    assert _receipt(data_dir)["live_sha256"] == _sha(live)


def test_an_invalid_document_is_never_published(data_dir):
    scan.publish(data_dir, scan.build_scan(data_dir, NOW))
    held = _sha(_scan_path(data_dir))
    bad = scan.build_scan(data_dir, NOW + 10)
    bad["rows"].append(dict(bad["rows"][0]))
    bad["universe"]["count"] += 1
    r = scan.publish(data_dir, bad)
    assert (r["decision"], r["published"], r["error"]) == \
        ("invalid_incoming", False, "row_identity_duplicate")
    assert r["live_sha256"] == held == _sha(_scan_path(data_dir))
    assert "currency" not in r


def test_writes_are_atomic_and_never_write_through_a_hardlink(data_dir, tmp_path):
    scan.publish(data_dir, scan.build_scan(data_dir, NOW))
    live = _scan_path(data_dir)
    deployed = tmp_path / "deployed-copy.json"
    os.link(live, deployed)
    before = deployed.read_bytes()
    _add(data_dir, "ZZNEW", {"sec": "Equities"})
    scan.publish(data_dir, scan.build_scan(data_dir, NOW + 10))
    assert deployed.read_bytes() == before
    assert live.read_bytes() != before
    assert oct(live.stat().st_mode & 0o777) == "0o644"


def test_main_aborts_with_a_receipt_and_keeps_the_held_generation(data_dir, capsys):
    assert scan.main(["--data-dir", str(data_dir), "--now", str(NOW)]) == 0
    held = _sha(_scan_path(data_dir))
    (data_dir / "manifest.json").write_text("{not json")
    assert scan.main(["--data-dir", str(data_dir), "--now", str(NOW + 10)]) == 2
    r = _receipt(data_dir)
    assert r["error"].startswith("aborted:") and r["published"] is False
    assert r["live_sha256"] == held == _sha(_scan_path(data_dir))
    assert "ABORTED" in capsys.readouterr().out


def test_now_accepts_epoch_and_iso():
    assert scan.parse_now(str(NOW)) == NOW
    assert scan.parse_now("2026-10-11T02:00:00Z") == NOW


def test_runs_as_a_script_from_the_nightly(data_dir):
    """The nightly invokes ``$PY ingest/gen_classification_scan.py``: sys.path[0] is ingest/."""
    imp = subprocess.run([sys.executable, "-c", "import gen_classification_scan"],
                         cwd=ROOT / "ingest", capture_output=True, text=True)
    assert imp.returncode == 0, imp.stderr
    run = subprocess.run([sys.executable, str(ROOT / "ingest" / "gen_classification_scan.py"),
                          "--data-dir", str(data_dir), "--now", str(NOW)],
                         cwd="/", capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert f"rows={len(_manifest(data_dir)['symbols'])}" in run.stdout
    assert "decision=first" in run.stdout


# ── the committed producer fixture the TS reader is tested against ──────────────────────
def test_the_producer_fixture_is_this_producers_output(data_dir):
    doc = scan.build_scan(data_dir, NOW)
    assert scan.validate_scan(doc) is None
    data = scan.encode(doc)
    if os.environ.get("UPDATE_SCAN_FIXTURE") == "1":
        FIXTURE.write_bytes(data)
    assert FIXTURE.read_bytes() == data, (
        "terminal/lib/__tests__/fixtures/screenerScan/classification.producer.json is stale — "
        "regenerate with UPDATE_SCAN_FIXTURE=1 (see module docstring)")
