#!/usr/bin/env python3
"""Project every listing's owner-record classification and trading currency into ONE scan.

    $PY ingest/gen_classification_scan.py [--data-dir DIR] [--limit N] [--budget-seconds S] [--now T]

WHAT IT IS. The Screener reads one bounded document, ``/data/scan/classification.json``
(``mastermind.screener_scan/v1``, family ``classification`` v1; reader in
``terminal/lib/classificationScan.ts``), so it can screen across markets on NATIVE
classifications with visible currency labels (E03). Each row is one manifest listing, keyed by
its exact manifest symbol, so two listings of one issuer (0700.HK in HKD, 80700.HK in CNY) are
two rows with two currencies — never one issuer row.

WHAT IT IS NOT. It classifies nothing. Every label is copied verbatim from the listing's owner
record — the ``<SYM>.fund.json`` the incumbent fund emitters already publish — and is
ATTRIBUTED to a taxonomy only when the record's own provenance proves which one it is:

* ``gen_fund_us`` (``src.statements == "yfinance"``, US and the legacy international names)
  writes ``info.sector or site_profile.sector``. Yahoo's and GICS's sector vocabularies are
  closed and share five labels (Energy, Industrials, Utilities, Real Estate, Communication
  Services), so a label in only one vocabulary is attributed to it, and a shared label is
  ``unsupported/taxonomy_ambiguous`` — shown verbatim, never filed under either.
* ``gen_fund_hk`` (``akshare``) writes ``yf.sector`` / ``yf.industry`` only: Yahoo, always.
* ``gen_fund_cn`` (``tushare``) writes the Macro CN profile's ``sector`` with no industry. Its
  owner (Macro ``collectors/china_universe.py``) fills it from yfinance ``get_info`` ONCE per
  ticker and caches it, lets curated seeds override it, and files an empty answer under the
  sentinel ``"A-share"``. Its own native taxonomy (``cn_profile_sector``), therefore —
  deliberately NOT merged into Yahoo's even though its labels look alike — and the sentinel
  is ``unavailable/not_classified``, exactly as the owner's own consumers treat it.

Every attributed label carries the owner record's emission date (``asof``) — the date the
owner asserted it. Providers publish no effective dates, and the fund emitters may carry a
profile forward from an earlier emission, so that date is never claimed as a reclassification
date; the reader ages a label whose record date is old.

No crosswalk exists between these taxonomies, so none is published: a screen picks ONE native
taxonomy (the E03 falsifier). The manifest's ``gics`` field is a retained, UNDATED reference
snapshot; it is carried as ``stale/snapshot_undated`` so it is shown with that label and can
never pass for the current sector (AC-E03-03). A dated owner-record label that disagrees with
the snapshot is published with ``reclassified_from``.

CURRENCY. ``quote_currency`` from the owner record, verbatim (``GBp`` is pence, not ``GBP``);
crypto rows from the curated catalog, whose selection rule admits only Coinbase USD-quoted
products; indices, rates, FX and futures are ``unsupported/currency_not_applicable`` — their
"price x volume" is not money. Nothing is converted and nothing is read from a ticker suffix.

COVERAGE, PUBLICATION. Exactly E01's rules (``gen_technical_scan``): one row per manifest key,
``complete: false`` with ``unavailable/not_processed`` past ``--limit``/``--budget-seconds``,
the client's adoption rule guarding an atomic replace (tmp + fsync + os.replace — public/data
is a hardlink farm), and a receipt for every run (``scan/classification.receipt.json``).

Runs as a script from the nightly (``ops/terminal-data``), so ``sys.path[0]`` is ``ingest/``;
the house bootstrap below puts the repo root on the path before the package imports.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

CA_ROOT = Path(__file__).resolve().parents[1]
if str(CA_ROOT) not in sys.path:
    sys.path.insert(0, str(CA_ROOT))

# ONE Python mirror of the client's adoption rule and ONE atomic writer for every scan family.
from ingest.gen_technical_scan import (  # noqa: E402
    adopt_generation,
    encode,
    read_universe,
    write_atomic,
)
from ingest.macro_catalog import iter_catalog  # noqa: E402

DEFAULT_DATA_DIR = CA_ROOT / "terminal" / "public" / "data"
SCAN_DIRNAME = "scan"
SCAN_FILENAME = "classification.json"
RECEIPT_FILENAME = "classification.receipt.json"

SCAN_SCHEMA = "mastermind.screener_scan/v1"
RECEIPT_SCHEMA = "mastermind.screener_scan_receipt/v1"
FAMILY = "classification"
FAMILY_VERSION = 1

# ── vocabularies (closed sets, as published by each authority) ──────────────────────────
YAHOO_SECTORS = (
    "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
    "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology",
    "Utilities",
)
GICS_SECTORS = (
    "Communication Services", "Consumer Discretionary", "Consumer Staples", "Energy",
    "Financials", "Health Care", "Industrials", "Information Technology", "Materials",
    "Real Estate", "Utilities",
)
_Y, _G = frozenset(YAHOO_SECTORS), frozenset(GICS_SECTORS)
SHARED_SECTORS = tuple(sorted(_Y & _G))

TAXONOMY_IDS = ("gics_sector", "yahoo_sector", "yahoo_industry", "cn_profile_sector")

TAXONOMIES: dict[str, dict] = {
    "gics_sector": {
        "name": "GICS sector",
        "authority": "MSCI / S&P Dow Jones Indices",
        "level": "sector",
        "version": None,
        "labels": list(GICS_SECTORS),
        "source": "fund.json profile.sector when the label is in the GICS vocabulary only "
                  "(gen_fund_us site-profile fallback); manifest gics is an undated reference "
                  "snapshot (stale/snapshot_undated)",
    },
    "yahoo_sector": {
        "name": "Yahoo Finance sector",
        "authority": "Yahoo Finance",
        "level": "sector",
        "version": None,
        "labels": list(YAHOO_SECTORS),
        "source": "fund.json profile.sector from yfinance info (gen_fund_hk always; gen_fund_us "
                  "when the label is in the Yahoo vocabulary only)",
    },
    "yahoo_industry": {
        "name": "Yahoo Finance industry",
        "authority": "Yahoo Finance",
        "level": "industry",
        "version": None,
        "labels": None,
        "source": "fund.json profile.industry, attributed only where the sector is Yahoo-attributed",
    },
    "cn_profile_sector": {
        "name": "CN profile sector",
        "authority": "Macro CN search universe (yfinance get_info sector, cached per ticker; "
                     "curated seeds)",
        "level": "sector",
        "version": None,
        "labels": None,
        "unclassified_sentinels": ["A-share"],
        "source": "fund.json profile.sector from gen_fund_cn (Macro site/chinastockdata, filled "
                  "by collectors/china_universe.py); not mapped onto any other taxonomy",
    },
}

# The CN owner's own "no sector" bucket (Macro collectors/china_universe.py fills an empty
# yfinance answer with it; Macro's consumers route it to their skip sentinel).
CN_UNCLASSIFIED_SENTINELS = frozenset(TAXONOMIES["cn_profile_sector"]["unclassified_sentinels"])

# Owner-record lanes, identified by the record's OWN provenance (src.statements).
LANE_OF_STATEMENTS = {"yfinance": "yfinance_profile", "akshare": "hk_akshare", "tushare": "cn_tushare"}
NON_MONETARY_SECS = frozenset({"Indices", "Bonds", "Forex", "Futures"})
CLASSIFIED_SECS = frozenset({"Equities"})

# Producer reason vocabulary — terminal/lib/classificationScan.ts CLASSIFICATION_PRODUCER_REASONS.
REASONS = {
    "stale": ["snapshot_undated", "record_undated"],
    "unsupported": ["taxonomy_ambiguous", "taxonomy_not_supplied", "label_outside_vocabulary",
                    "asset_class_not_covered", "lane_unrecognized", "currency_not_applicable"],
    "unavailable": ["not_classified", "no_fund_record", "record_unreadable", "currency_missing",
                    "not_in_catalog", "not_processed"],
}
STATUS_OF = {r: s for s, rs in REASONS.items() for r in rs}

REASON_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# ISO 4217 codes plus Yahoo's minor-unit quotes (GBp pence, ZAc cents, ILA agorot) — kept exact.
CURRENCY_RE = re.compile(r"^(?:[A-Z]{3}|[A-Z]{2}[a-z]|ILA)$")
SOURCES = frozenset({"fund_profile", "manifest_gics", "fund_quote_currency", "crypto_catalog"})


def is_iso_date(v: Any) -> bool:
    if not (isinstance(v, str) and DATE_RE.match(v)):
        return False
    try:
        return dt.date.fromisoformat(v).isoformat() == v
    except ValueError:
        return False


def _cell(reason: str, **extra: Any) -> dict:
    out = {"status": STATUS_OF[reason], "reason": reason}
    out.update(extra)
    return out


def _evaluated(label: str, as_of: str, source: str, **extra: Any) -> dict:
    out = {"status": "evaluated", "reason": "ok", "label": label, "as_of": as_of, "source": source}
    out.update(extra)
    return out


def _label(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


def _safe_name(sym: str) -> bool:
    return bool(sym) and "/" not in sym and "\\" not in sym and sym not in (".", "..") \
        and "\x00" not in sym


def read_record(data_dir: Path, sym: str) -> tuple[str, dict | None]:
    """``("ok", record)`` | ``("absent", None)`` | ``("unreadable", None)``."""
    if not _safe_name(sym):
        return "absent", None
    path = data_dir / f"{sym}.fund.json"
    if not path.is_file():
        return "absent", None
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        doc = json.loads(raw) if raw.strip() else None
    except Exception:  # noqa: BLE001 — one bad file is that row's reason, never the run's
        return "unreadable", None
    if not isinstance(doc, dict):
        return "unreadable", None
    tk = doc.get("ticker")
    if tk is not None and tk != sym:
        return "unreadable", None   # a record filed under another listing is not this one's
    return "ok", doc


def crypto_catalog() -> frozenset[str]:
    return frozenset(s.sym for s in iter_catalog() if s.sec == "Crypto")


# ── the classification of one listing ───────────────────────────────────────────────────
def classify_sectors(lane: str | None, record: dict | None, rec_state: str,
                     gics_snapshot: str | None) -> dict[str, dict]:
    """The four native-taxonomy cells for one EQUITY listing (see the module doc)."""
    snap = (_cell("snapshot_undated", label=gics_snapshot, as_of=None, source="manifest_gics")
            if gics_snapshot else None)

    def gics_fallback(reason: str, **extra: Any) -> dict:
        return snap if snap is not None else _cell(reason, **extra)

    if rec_state != "ok":
        reason = "no_fund_record" if rec_state == "absent" else "record_unreadable"
        return {"gics_sector": gics_fallback(reason), "yahoo_sector": _cell(reason),
                "yahoo_industry": _cell(reason), "cn_profile_sector": _cell(reason)}
    if lane is None:
        return {"gics_sector": gics_fallback("lane_unrecognized"),
                "yahoo_sector": _cell("lane_unrecognized"),
                "yahoo_industry": _cell("lane_unrecognized"),
                "cn_profile_sector": _cell("lane_unrecognized")}

    profile = record.get("profile") if isinstance(record.get("profile"), dict) else {}
    sector, industry = _label(profile.get("sector")), _label(profile.get("industry"))
    as_of = record.get("asof")
    dated = is_iso_date(as_of)

    def ev(label: str, **extra: Any) -> dict:
        # An owner-record label with no valid date can be shown, never filtered as current.
        if not dated:
            return _cell("record_undated", label=label, as_of=None, source="fund_profile", **extra)
        return _evaluated(label, as_of, "fund_profile", **extra)

    not_supplied = _cell("taxonomy_not_supplied")

    if lane == "cn_tushare":
        return {
            "gics_sector": gics_fallback("taxonomy_not_supplied"),
            "yahoo_sector": not_supplied,
            "yahoo_industry": not_supplied,
            "cn_profile_sector": (ev(sector) if sector and sector not in CN_UNCLASSIFIED_SENTINELS
                                  else _cell("not_classified")),
        }

    if lane == "hk_akshare":
        if sector is None:
            ys = _cell("not_classified")
        elif sector in _Y:
            ys = ev(sector)
        else:
            ys = _cell("label_outside_vocabulary", label=sector)
        yi = ev(industry) if (industry and ys["status"] in ("evaluated", "stale")) else (
            _cell("not_classified") if industry is None else _cell("taxonomy_ambiguous", label=industry))
        return {"gics_sector": gics_fallback("taxonomy_not_supplied"), "yahoo_sector": ys,
                "yahoo_industry": yi, "cn_profile_sector": not_supplied}

    # yfinance_profile: info.sector OR site_profile.sector — attribute by vocabulary only.
    if sector is None:
        gs, ys = gics_fallback("not_classified"), _cell("not_classified")
    elif sector in _Y and sector in _G:
        gs = gics_fallback("taxonomy_ambiguous", label=sector)
        ys = _cell("taxonomy_ambiguous", label=sector)
    elif sector in _G:
        extra = {"reclassified_from": gics_snapshot} if gics_snapshot and gics_snapshot != sector else {}
        gs, ys = ev(sector, **extra), _cell("taxonomy_not_supplied")
    elif sector in _Y:
        gs, ys = gics_fallback("taxonomy_not_supplied"), ev(sector)
    else:
        gs = gics_fallback("label_outside_vocabulary", label=sector)
        ys = _cell("label_outside_vocabulary", label=sector)
    if industry is None:
        yi = _cell("not_classified")
    elif ys["status"] in ("evaluated", "stale"):
        yi = ev(industry)
    else:
        # The industry may be Yahoo's or the site profile's SIC description; the record does
        # not say which, so it is shown, never filed under Yahoo.
        yi = _cell("taxonomy_ambiguous", label=industry)
    return {"gics_sector": gs, "yahoo_sector": ys, "yahoo_industry": yi,
            "cn_profile_sector": not_supplied}


def classify_currency(sec: str | None, sym: str, record: dict | None, rec_state: str,
                      crypto: frozenset[str]) -> dict:
    if sec == "Crypto":
        if sym in crypto:
            return {"status": "evaluated", "reason": "ok", "code": "USD", "as_of": None,
                    "source": "crypto_catalog"}
        return _cell("not_in_catalog")
    if sec in NON_MONETARY_SECS:
        return _cell("currency_not_applicable")
    if rec_state == "absent":
        return _cell("no_fund_record")
    if rec_state != "ok":
        return _cell("record_unreadable")
    code = record.get("quote_currency")
    if not (isinstance(code, str) and CURRENCY_RE.match(code)):
        return _cell("currency_missing")
    as_of = record.get("asof")
    return {"status": "evaluated", "reason": "ok", "code": code,
            "as_of": as_of if is_iso_date(as_of) else None, "source": "fund_quote_currency"}


def classify_symbol(data_dir: Path, sym: str, mrow: dict, crypto: frozenset[str]) -> dict:
    sec = mrow.get("sec") if isinstance(mrow.get("sec"), str) else None
    rec_state, record = read_record(data_dir, sym)
    lane = None
    if rec_state == "ok":
        src = record.get("src") if isinstance(record.get("src"), dict) else {}
        lane = LANE_OF_STATEMENTS.get(src.get("statements"))
    out: dict[str, Any] = {
        "lane": lane if rec_state == "ok" else None,
        "currency": classify_currency(sec, sym, record, rec_state, crypto),
    }
    gics_snapshot = _label(mrow.get("gics"))
    if sec is not None and sec not in CLASSIFIED_SECS:
        cell = _cell("asset_class_not_covered")
        out["class"] = {t: dict(cell) for t in TAXONOMY_IDS}
    else:
        out["class"] = classify_sectors(lane, record, rec_state, gics_snapshot)
    return out


# ── the generation ──────────────────────────────────────────────────────────────────────
def build_scan(data_dir: Path, now: int, limit: int = 0, budget_seconds: float = 0.0,
               clock=time.monotonic) -> dict:
    as_of, universe = read_universe(data_dir)
    crypto = crypto_catalog()
    started = clock()
    rows: list[dict] = []
    complete = True
    for i, sym in enumerate(sorted(universe)):
        mrow = universe[sym]
        row: dict[str, Any] = {"sym": sym}
        for k in ("mkt", "sec"):
            v = mrow.get(k)
            if isinstance(v, str) and v:
                row[k] = v
        over_limit = bool(limit) and i >= limit
        over_budget = bool(budget_seconds) and (clock() - started) > budget_seconds
        if over_limit or over_budget:
            complete = False
            np_cell = _cell("not_processed")
            row.update({"lane": None, "currency": dict(np_cell),
                        "class": {t: dict(np_cell) for t in TAXONOMY_IDS}})
        else:
            try:
                row.update(classify_symbol(data_dir, sym, mrow, crypto))
            except Exception:  # noqa: BLE001 — one bad record never aborts the generation
                bad = _cell("record_unreadable")
                row.update({"lane": None, "currency": dict(bad),
                            "class": {t: dict(bad) for t in TAXONOMY_IDS}})
        rows.append(row)
    return {
        "schema": SCAN_SCHEMA,
        "family": FAMILY,
        "family_version": FAMILY_VERSION,
        "generation": int(now),
        "generated_at": dt.datetime.fromtimestamp(int(now), dt.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "complete": complete,
        "universe": {"source": "manifest", "as_of": as_of, "count": len(rows)},
        "taxonomies": copy.deepcopy(TAXONOMIES),
        "crosswalks": {},
        "rows": rows,
    }


def _valid_cell(c: Any, *, currency: bool) -> bool:
    if not isinstance(c, dict):
        return False
    status, reason = c.get("status"), c.get("reason")
    if not (isinstance(reason, str) and REASON_RE.match(reason)):
        return False
    if status == "evaluated":
        if reason != "ok" or c.get("source") not in SOURCES:
            return False
        if currency:
            return isinstance(c.get("code"), str) and bool(CURRENCY_RE.match(c["code"])) \
                and (c.get("as_of") is None or is_iso_date(c.get("as_of")))
        return bool(_label(c.get("label"))) and is_iso_date(c.get("as_of"))
    if STATUS_OF.get(reason) != status:
        return False
    if status == "stale":
        return not currency and bool(_label(c.get("label"))) and c.get("as_of") is None \
            and c.get("source") in SOURCES
    return True


def validate_scan(doc: Any) -> str | None:
    """Whole-document invariants the consumer enforces; None when the document is valid."""
    if not isinstance(doc, dict):
        return "document_invalid"
    if doc.get("schema") != SCAN_SCHEMA:
        return "schema_unsupported"
    if doc.get("family") != FAMILY or doc.get("family_version") != FAMILY_VERSION:
        return "family_invalid"
    gen = doc.get("generation")
    if not (isinstance(gen, int) and not isinstance(gen, bool) and gen > 0):
        return "generation_invalid"
    if not isinstance(doc.get("complete"), bool):
        return "complete_invalid"
    uni, rows = doc.get("universe"), doc.get("rows")
    if not (isinstance(uni, dict) and uni.get("source") == "manifest"
            and isinstance(uni.get("as_of"), str) and isinstance(uni.get("count"), int)):
        return "universe_invalid"
    if not isinstance(rows, list) or len(rows) != uni["count"]:
        return "row_count_mismatch"
    tax = doc.get("taxonomies")
    if not isinstance(tax, dict) or set(tax) != set(TAXONOMY_IDS):
        return "taxonomies_invalid"
    if doc.get("crosswalks") != {}:
        return "crosswalks_invalid"   # v1 publishes none; a crosswalk is a contract change
    seen: set[str] = set()
    for r in rows:
        sym = r.get("sym") if isinstance(r, dict) else None
        if not isinstance(sym, str) or not sym:
            return "row_identity_invalid"
        if sym in seen:
            return "row_identity_duplicate"
        seen.add(sym)
        if not _valid_cell(r.get("currency"), currency=True):
            return "row_cell_invalid"
        cls = r.get("class")
        if not isinstance(cls, dict) or set(cls) != set(TAXONOMY_IDS):
            return "row_cell_invalid"
        cells = [r["currency"], *cls.values()]
        if any(not _valid_cell(c, currency=False) for c in cls.values()):
            return "row_cell_invalid"
        if doc["complete"] and any(c.get("reason") == "not_processed" for c in cells):
            return "complete_with_not_processed"
    return None


# ── publication (E01's rule, this family's files) ───────────────────────────────────────
def held_generation(path: Path) -> dict | None:
    try:
        with open(path, "rb") as fh:
            doc = json.loads(fh.read())
    except Exception:  # noqa: BLE001 — absent or unreadable ⇒ nothing is held
        return None
    if validate_scan(doc) is not None:
        return None
    return {"generation": doc["generation"], "complete": doc["complete"]}


def summarize(doc: dict) -> dict:
    def tally(cells) -> dict:
        out: dict[str, dict[str, int]] = {}
        for c in cells:
            b = out.setdefault(c["status"], {})
            b[c["reason"]] = b.get(c["reason"], 0) + 1
        return {s: dict(sorted(v.items())) for s, v in sorted(out.items())}
    rows = doc["rows"]
    return {
        "currency": tally(r["currency"] for r in rows),
        "class": {t: tally(r["class"][t] for r in rows) for t in TAXONOMY_IDS},
    }


def publish(data_dir: Path, doc: dict | None, *, error: str | None = None) -> dict:
    scan_path = data_dir / SCAN_DIRNAME / SCAN_FILENAME
    held = held_generation(scan_path)
    invalid = error or (validate_scan(doc) if doc is not None else "no_document")
    if invalid:
        adopt, reason = False, "invalid_incoming"
    else:
        adopt, reason = adopt_generation(held, doc)
    payload = encode(doc) if (doc is not None and not invalid) else None
    if adopt and payload is not None:
        write_atomic(scan_path, payload)
    try:
        live_bytes = scan_path.read_bytes()
    except OSError:
        live_bytes = None
    live = held_generation(scan_path) if live_bytes is not None else None
    receipt: dict[str, Any] = {
        "schema": RECEIPT_SCHEMA,
        "family": FAMILY,
        "decision": reason,
        "published": bool(adopt),
        "error": invalid,
        "held_generation": held,
        "generation": doc.get("generation") if isinstance(doc, dict) else None,
        "generated_at": doc.get("generated_at") if isinstance(doc, dict) else None,
        "complete": doc.get("complete") if isinstance(doc, dict) else None,
        "universe": doc.get("universe") if isinstance(doc, dict) else None,
        "sha256": hashlib.sha256(payload).hexdigest() if payload is not None else None,
        "bytes": len(payload) if payload is not None else None,
        "live_generation": live,
        "live_sha256": hashlib.sha256(live_bytes).hexdigest() if live_bytes is not None else None,
    }
    if isinstance(doc, dict) and not invalid:
        receipt.update(summarize(doc))
    write_atomic(data_dir / SCAN_DIRNAME / RECEIPT_FILENAME, encode(receipt))
    return receipt


def parse_now(raw: str | None) -> int:
    if raw is None:
        return int(time.time())
    try:
        return int(raw)
    except ValueError:
        t = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        return int(t.timestamp())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    ap.add_argument("--limit", type=int, default=0,
                    help="process only the first N names (the rest: not_processed, incomplete)")
    ap.add_argument("--budget-seconds", type=float, default=0.0,
                    help="stop classifying after S seconds (the rest: not_processed)")
    ap.add_argument("--now", default=None, help="generation clock: epoch seconds or ISO-8601")
    args = ap.parse_args(argv)
    data_dir: Path = args.data_dir
    now = parse_now(args.now)
    t0 = time.time()
    try:
        doc = build_scan(data_dir, now, limit=args.limit, budget_seconds=args.budget_seconds)
    except Exception as exc:  # noqa: BLE001 — no requested universe ⇒ no generation
        receipt = publish(data_dir, None, error=f"aborted:{type(exc).__name__}")
        print(f"[gen_classification_scan] ABORTED ({exc}); held={receipt['held_generation']}",
              flush=True)
        return 2
    receipt = publish(data_dir, doc)
    cur = receipt.get("currency", {})
    print(f"[gen_classification_scan] generation={receipt['generation']} "
          f"complete={receipt['complete']} rows={doc['universe']['count']} "
          f"currency_evaluated={sum(cur.get('evaluated', {}).values())} "
          f"decision={receipt['decision']} published={receipt['published']} "
          f"({time.time() - t0:.1f}s)", flush=True)
    return 0 if receipt["error"] is None else 1


if __name__ == "__main__":
    sys.exit(main())
