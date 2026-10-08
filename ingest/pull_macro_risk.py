"""Market-risk bridge (SELL_SIDE_CASCADE_MASTERPLAN §5 / MARKET_RISK_BRIDGE_SCOPE Phase 1).

Reads the Macro Dashboard's published market-risk state and writes a single trimmed,
versioned ``terminal/public/data/market_risk.json`` in the ``market_risk/v1`` shape —
the top-down "is the market distributing?" chip that sits beside the per-name signals.

Source (in preference order):
  1. ``MACRO_RISK_URL`` env → HTTPS GET the web-served ``risk_state.json`` (the same file
     the macro dashboard's own browser reads; custom UA for the Cloudflare WAF, last-good
     kept on any failure — mirrors ``pull_macro_intel.sync_r2_stockdata``).
  2. local ``MACRO_REPO/site/live/risk_state.json`` (schema ``risk_state.v1``).
  3. local ``MACRO_REPO/data/market_state/latest.json`` (schema ``market_state.v1``; the
     richer nightly file — carries the six component legs).

Contract note (verified against the live files 2026-07-07): the web-served
``risk_state.v1`` carries ``display{verdict,score,color,label_en}``,
``live/nightly{headline_en, radar{state,label_en,top_score}}`` and top-level
``stale/realtime/nightly_asof`` — but NO ``radar.gross`` (the earlier scope draft was
wrong) and NO ``components`` legs (those exist only in the non-served nightly file). The
chip therefore shows verdict/score/radar/headline; component legs appear only when the
richer file is the source.

DISPLAY-ONLY. This never originates a sell; ``is_display_only`` is propagated and a stale
tape is flagged. Stale observations must not be presented as current/live evidence.

Usage:  python ingest/pull_macro_risk.py
        MACRO_REPO / MACRO_RISK_URL / RISK_MAX_STALE_DAYS override the defaults.
"""
from __future__ import annotations

import json
import logging
import math
import os
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

log = logging.getLogger(__name__)


def _is_stale(asof, today: date, max_days: int) -> bool:
    """Reject unknown/future session dates and preserve the calendar-day age budget.

    The source contract is a settled session date, not a quote timestamp. Accept
    an actual date or its exact YYYY-MM-DD spelling; never make a malformed or
    future observation current by truncating/coercing it.
    """
    if type(asof) is date:
        src_date = asof
    elif isinstance(asof, str):
        try:
            src_date = date.fromisoformat(asof)
        except ValueError:
            return True
        if src_date.isoformat() != asof:
            return True
    else:
        return True
    age = (today - src_date).days
    return age < 0 or age >= max_days

MACRO = Path(os.environ.get("MACRO_REPO", "/Users/chriswong/Documents/Cluade/Macro Dashboard"))
OUT = ROOT / "terminal" / "public" / "data" / "market_risk.json"
MAX_STALE_DAYS = int(os.environ.get("RISK_MAX_STALE_DAYS", "5"))  # calendar days ≈ 3 trading
_UA = "mastermind-feed/1.0"
_TIMEOUT = 30

# Local source candidates, in preference order.
_LOCAL_SOURCES = ("site/live/risk_state.json", "data/market_state/latest.json")


def _num(v):
    """Return a finite display number, keeping zero distinct from missing evidence."""
    if v is None or isinstance(v, bool):
        return None
    try:
        number = float(v)
        if not math.isfinite(number):
            return None
        if isinstance(v, int):
            return int(v)
        return round(number, 4) if isinstance(v, float) else number
    except (TypeError, ValueError, OverflowError):
        return None


def _radar(raw: dict | None) -> dict | None:
    """Trim a radar block to {state, label_en, top_score} (None-safe)."""
    if not isinstance(raw, dict):
        return None
    state = raw.get("state")
    out = {
        "state": str(state) if state is not None else None,
        "label_en": str(raw["label_en"]) if raw.get("label_en") is not None else None,
        "label_zh": str(raw["label_zh"]) if raw.get("label_zh") is not None else None,
        "top_score": _num(raw.get("top_score")),
    }
    return out if any(v is not None for v in out.values()) else None


def build_market_risk(src: dict, today: date | None = None) -> dict:
    """Map a ``risk_state.v1`` (preferred) or ``market_state.v1`` dict → ``market_risk/v1``.

    ``today`` is injectable for deterministic freshness tests (production omits it).
    """
    if today is None:
        today = date.today()
    schema = str(src.get("schema") or "")

    if schema.startswith("risk_state") or "display" in src:
        # risk_state.v1 — the web-served display artifact.
        disp = src.get("display") or {}
        live = src.get("live") or {}
        nightly = src.get("nightly") or {}
        asof = src.get("nightly_asof")
        verdict = disp.get("verdict") or live.get("verdict") or nightly.get("verdict")
        score = disp.get("score", live.get("score"))
        color = disp.get("color") or live.get("color")
        label_en = disp.get("label_en") or live.get("label_en")
        label_zh = disp.get("label_zh") or live.get("label_zh")
        headline_en = live.get("headline_en") or nightly.get("headline_en")
        headline_zh = live.get("headline_zh") or nightly.get("headline_zh")
        radar = _radar(live.get("radar")) or _radar(nightly.get("radar"))
        realtime = src.get("realtime") is True and src.get("live_active") is True
        components = None
    else:
        # market_state.v1 — the richer nightly file (carries component legs).
        asof = src.get("asof")
        verdict = src.get("verdict")
        score = src.get("score")
        color = src.get("color")
        label_en = src.get("label_en")
        label_zh = src.get("label_zh")
        headline_en = src.get("headline_en")
        headline_zh = src.get("headline_zh")
        radar = _radar(src.get("radar"))
        realtime = False
        components = [
            {"key": c.get("key"), "label_en": c.get("label_en"),
             "score": _num(c.get("score")), "tone": c.get("tone")}
            for c in (src.get("components") or []) if isinstance(c, dict)
        ] or None

    # Absent marker preserves the older date-only source contract. An explicit
    # stale or malformed marker cannot be laundered by a recent artifact date.
    stale = _is_stale(asof, today, MAX_STALE_DAYS) or src.get("stale", False) is not False
    out = {
        "schema": "market_risk/v1",
        "asof": str(asof) if asof is not None else None,
        "stale": stale,
        "realtime": realtime and not stale,
        "verdict": str(verdict) if verdict is not None else None,
        "score": _num(score),
        "color": str(color) if color is not None else None,
        "label_en": str(label_en) if label_en is not None else None,
        "label_zh": str(label_zh) if label_zh is not None else None,
        "headline_en": str(headline_en) if headline_en is not None else None,
        "headline_zh": str(headline_zh) if headline_zh is not None else None,
        "radar": radar,
        "is_display_only": True,   # house law: context only, never a sell
    }
    if components is not None:
        out["components"] = components
    return out


def _fetch_url(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            return json.loads(r.read())
    except Exception as e:  # noqa: BLE001 — never raise; keep last-good output
        log.warning("market-risk URL fetch failed (%s): %s", url, e)
        return None


def resolve_source() -> tuple[dict, str] | None:
    """Return (raw_source_dict, provenance) or None if nothing is reachable."""
    url = os.environ.get("MACRO_RISK_URL")
    if url:
        d = _fetch_url(url)
        if d is not None:
            return d, f"url:{url}"
        log.warning("falling back to local macro files")
    for rel in _LOCAL_SOURCES:
        p = MACRO / rel
        if p.exists():
            try:
                return json.loads(p.read_text()), f"local:{rel}"
            except Exception as e:  # noqa: BLE001
                log.warning("could not read %s: %s", p, e)
    return None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    got = resolve_source()
    if got is None:
        log.error("no market-risk source reachable (set MACRO_RISK_URL or MACRO_REPO). "
                  "Leaving any existing %s untouched.", OUT.name)
        return 1
    src, provenance = got
    risk = build_market_risk(src)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(risk, separators=(",", ":"), ensure_ascii=False))
    log.info("wrote %s from %s — verdict=%s score=%s radar=%s stale=%s realtime=%s",
             OUT.name, provenance, risk["verdict"], risk["score"],
             (risk["radar"] or {}).get("state"), risk["stale"], risk["realtime"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())