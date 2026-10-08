"""Bridge source-owned Macro risk reads into terminal/public/data/market_risk.json.

market_risk/v1 stays a flat, display-only projection. The measured verdict, its
cause, and the selected source clock travel together. Live wrappers are only live
when the producer says so; an inactive live calculation cannot replace the settled
headline. The Terminal never originates a risk score or trading authority.
"""
from __future__ import annotations

import json
import logging
import math
import os
import tempfile
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
log = logging.getLogger(__name__)
MACRO = Path(os.environ.get("MACRO_REPO", "/Users/chriswong/Documents/Cluade/Macro Dashboard"))
OUT = ROOT / "terminal" / "public" / "data" / "market_risk.json"
MAX_STALE_DAYS = int(os.environ.get("RISK_MAX_STALE_DAYS", "5"))
_UA = "mastermind-feed/1.0"
_TIMEOUT = 30
_LOCAL_SOURCES = ("site/live/risk_state.json", "data/market_state/latest.json")
_VERDICTS = {"RISK_ON", "MIXED", "RISK_OFF"}
_CAUSE_FIELDS = ("raw_score", "score_source", "capped", "score_ceiling", "score_caps", "score_gap")
_RADAR_FIELDS = ("state", "label_en", "label_zh", "top_score", "can_force", "binding",
                 "authority", "ceiling", "candidate_ceiling", "amp", "amp_keys", "recovery")


def _dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _timestamp(value) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace(" UTC", "+00:00").replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _is_stale(asof, today: date, max_days: int) -> bool:
    """Unknown, future, or expired sessions are unusable, never calm votes."""
    source_date = _date(asof)
    return source_date is None or not 0 <= (today - source_date).days < max_days


def _num(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else round(number, 4)


def _radar(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    out = {key: raw[key] for key in _RADAR_FIELDS if key in raw}
    if "top_score" in out:
        out["top_score"] = _num(out["top_score"])
    if "recovery" in out:
        recovery = _dict(out["recovery"])
        out["recovery"] = {key: recovery[key] for key in ("phase", "receding", "peaking", "suppressed", "turn_confirmed") if key in recovery}
    return out or None


def build_market_risk(src: dict, today: date | None = None, *,
                      now: datetime | None = None, provenance: str | None = None,
                      risk_envelope: dict | None = None) -> dict:
    """Project a native source without computing a new state.

    Injecting today preserves date-only legacy tests. Inject now for exact
    source-clock checks; production supplies a UTC clock. Missing intraday expiry
    is disclosed as unqualified and cannot masquerade as fresh live information.
    """
    src = _dict(src)
    if now is None and today is None:
        now = datetime.now(timezone.utc)
    if now is not None:
        now = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)
    today = today or now.date()
    schema = str(src.get("schema") or "")
    wrapped = schema == "risk_state.v1" or (not schema and isinstance(src.get("display"), dict))
    reasons = []
    source_fresh = _dict(src.get("freshness"))
    live_active = wrapped and src.get("live_active") is True
    legacy = wrapped and not schema and src.get("live_active") is None
    basis = "live_display" if live_active else "legacy_display" if legacy else "settled"
    cause_basis = basis

    if wrapped:
        display = _dict(src.get("display"))
        live = _dict(src.get("live"))
        nightly = _dict(src.get("nightly"))
        # The owner moves score/raw_score every tick while debouncing only the
        # displayed word. Numeric causes remain attached to that live observation.
        selected = display if live_active or legacy else nightly
        fallback = live if live_active else display
        fields = {**fallback, **selected}
        native = ({**live, **{key: display[key] for key in _CAUSE_FIELDS if key in display}}
                  if live_active else display if legacy else nightly)
        if live_active and live.get("verdict") != fields.get("verdict"):
            cause_basis = "live_score_pending_band"
        asof = src.get("nightly_asof") or (src.get("asof") if legacy else None)
        event_time = (live.get("source_event_time") or src.get("source_event_time")) if live_active else None
        event_dt = _timestamp(event_time)
        if live_active and event_dt is not None:
            # US RTH source quote dates are the selected live session.
            asof = event_dt.date().isoformat()
        source_fresh = _dict(native.get("freshness")) or source_fresh
        components = None
    else:
        fields = native = src
        asof = src.get("asof")
        event_time = src.get("source_event_time")
        components = [
            {key: c.get(key) for key in ("key", "label_en", "label_zh", "score", "tone", "weight", "degraded")
             if key in c}
            for c in (src.get("components") or []) if isinstance(c, dict)
        ] or None
        if schema not in ("market_state.v1", "market_risk/v1"):
            reasons.append("unknown_source_schema")

    verdict = fields.get("verdict")
    if verdict not in _VERDICTS:
        verdict = None
        reasons.append("missing_or_invalid_verdict")
    score = _num(fields.get("score"))
    if score is not None and not 0 <= score <= 100:
        score = None
        reasons.append("invalid_score")
    if fields.get("score") is not None and score is None and "invalid_score" not in reasons:
        reasons.append("invalid_score")

    if _is_stale(asof, today, MAX_STALE_DAYS):
        source_date = _date(asof)
        reasons.append("missing_or_invalid_asof" if source_date is None else
                       "future_asof" if source_date > today else "expired_asof")
    if source_fresh.get("stale") is True:
        reasons.append("owner_stale")
    # A stale quote plane after market close does not invalidate the chosen
    # settled view. Its original stale reason remains preserved below.
    if src.get("stale") is True and (live_active or legacy or not wrapped):
        reasons.append("source_stale")

    built = src.get("built") or src.get("produced_at")
    expiry = src.get("stale_after")
    for name, value in (("built", built), ("source_event_time", event_time)):
        if value is not None:
            clock = _timestamp(value)
            if clock is None:
                reasons.append("invalid_" + name)
            elif (now is not None and clock > now) or (now is None and clock.date() > today):
                reasons.append("future_" + name)
    if live_active:
        if _timestamp(event_time) is None:
            reasons.append("missing_live_source_clock")
        if _timestamp(expiry) is None:
            reasons.append("missing_live_expiry")
    if expiry is not None:
        expiry_dt = _timestamp(expiry)
        if expiry_dt is None:
            reasons.append("invalid_stale_after")
        elif now is not None and expiry_dt <= now:
            reasons.append("expired_source")
    reasons = sorted(set(reasons))
    out = {
        "schema": "market_risk/v1",
        "asof": str(asof) if asof is not None else None,
        "built": built,
        "source_event_time": event_time,
        "stale_after": expiry,
        "source_schema": schema or None,
        "source_basis": basis,
        "cause_basis": cause_basis,
        "source_path": provenance,
        "stale": bool(reasons),
        "freshness": {
            "qualified": not reasons,
            "reasons": reasons,
            "owner": source_fresh or None,
            "source_stale": src.get("stale"),
            "source_stale_reason": src.get("stale_reason"),
            "max_stale_days": MAX_STALE_DAYS,
        },
        "realtime": live_active and src.get("realtime") is True and not reasons,
        "verdict": verdict,
        "score": score,
        "color": fields.get("color"),
        "label_en": fields.get("label_en"),
        "label_zh": fields.get("label_zh"),
        "headline_en": (fields if live_active or legacy else native).get("headline_en"),
        "headline_zh": (fields if live_active or legacy else native).get("headline_zh"),
        "source_verdict": native.get("source_verdict") or native.get("verdict"),
        "radar": _radar((live if live_active else native).get("radar")) if wrapped else _radar(native.get("radar")),
        "is_display_only": True,
    }
    # Caps belong to the numerical measurement owner even while its displayed
    # band word is held. The pending band is a separate source-owned field.
    out.update({key: native[key] for key in _CAUSE_FIELDS if key in native})
    if wrapped:
        out["display_pending"] = _dict(src.get("display")).get("pending")
    if components is not None:
        out["components"] = components
    out["risk_envelope"], out["risk_envelope_freshness"] = qualify_risk_envelope(
        risk_envelope, out["asof"], today=today, now=now)
    return out


_ENVELOPE_FIELDS = ("schema", "bundle_id", "definition_id", "market", "revision", "source_session",
                    "as_of", "observed_at", "produced_at", "stale_after", "measured_state",
                    "hazard_summary", "policy_summary", "data_state", "authority",
                    "rotation_context", "confluence", "market_transition", "coverage",
                    "freshness", "coherence")
_AUTHORITY_FLAGS = ("envelope_may_execute", "envelope_may_gate", "envelope_may_rank", "envelope_may_size")


def qualify_risk_envelope(raw, asof, *, today: date, now: datetime | None = None) -> tuple[dict | None, dict]:
    """Carry a matching native envelope; transport clocks never refresh its evidence."""
    envelope = _dict(raw)
    reasons = []
    if not envelope:
        return None, {"qualified": False, "reasons": ["missing_envelope"]}
    if envelope.get("schema") != "mastermind.risk_envelope/v1":
        reasons.append("invalid_schema")
    session = envelope.get("source_session")
    if _is_stale(session, today, MAX_STALE_DAYS) or (_date(session) and _date(session).isoformat() != session):
        reasons.append("invalid_future_or_expired_session")
    if session != asof or envelope.get("as_of") != session:
        reasons.append("source_session_mismatch")
    if envelope.get("data_state") not in {"FRESH", "PARTIAL", "DEGRADED"}:
        reasons.append("unusable_data_state")
    if not isinstance(envelope.get("bundle_id"), str) or not envelope["bundle_id"]:
        reasons.append("missing_bundle_id")
    for key in ("measured_state", "hazard_summary", "policy_summary"):
        if not isinstance(envelope.get(key), dict):
            reasons.append("invalid_" + key)
    authority = _dict(envelope.get("authority"))
    if any(authority.get(key) is not False for key in _AUTHORITY_FLAGS):
        reasons.append("unqualified_authority")
    for key in ("observed_at", "produced_at"):
        clock = _timestamp(envelope.get(key))
        if clock is None:
            reasons.append("missing_or_invalid_" + key)
        elif (now is not None and clock > now) or (now is None and clock.date() > today):
            reasons.append("future_" + key)
    expires = envelope.get("stale_after")
    if expires is not None:
        clock = _timestamp(expires)
        if clock is None or (now is not None and clock <= now):
            reasons.append("invalid_or_expired_envelope")
    observed = _timestamp(envelope.get("observed_at"))
    produced = _timestamp(envelope.get("produced_at"))
    if observed is not None and produced is not None and observed > produced:
        reasons.append("incoherent_publication_clocks")
    if envelope.get("revision") == "live_provisional" and _timestamp(expires) is None:
        reasons.append("missing_live_expiry")
    measured = _dict(envelope.get("measured_state"))
    if measured.get("usable") is True and measured.get("as_of") != session:
        reasons.append("measured_session_mismatch")
    owner_freshness = _dict(envelope.get("freshness"))
    if owner_freshness.get("source_session") not in (None, session):
        reasons.append("freshness_session_mismatch")
    if envelope.get("stale") is True or owner_freshness.get("stale") is True:
        reasons.append("owner_stale")
    confluence = _dict(envelope.get("confluence"))
    if confluence and any(confluence.get(key) is not False for key in (
            "statistical_independence_established", "changes_hazard_stage", "changes_policy")):
        reasons.append("invalid_confluence_authority")
    # all_on_session includes optional organs. Their own stale/null coverage is
    # preserved; it must not erase independently qualified measured state.
    try:
        json.dumps(envelope, allow_nan=False)
    except (ValueError, TypeError):
        reasons.append("invalid_json_values")
    qualified = {key: envelope[key] for key in _ENVELOPE_FIELDS if key in envelope}
    reasons = sorted(set(reasons))
    return (None if reasons else qualified), {"qualified": not reasons, "reasons": reasons}


def resolve_risk_envelope(asof, *, today: date, now: datetime | None = None):
    """Optional existing-owner mirror. Failure does not manufacture a calm read."""
    url = os.environ.get("MACRO_RISK_ENVELOPE_URL")
    candidates = []
    if url:
        candidate = _fetch_url(url)
        if candidate is not None:
            candidates.append(candidate)
    for relative in ("site/riskdata/risk_envelope.json", "data/risk_envelope/latest.json"):
        try:
            candidate = json.loads((MACRO / relative).read_text())
            if isinstance(candidate, dict):
                candidates.append(candidate)
        except (OSError, ValueError):
            continue
    for candidate in candidates:
        admitted, _ = qualify_risk_envelope(candidate, asof, today=today, now=now)
        if admitted is not None:
            return candidate
    return candidates[0] if candidates else None


def _fetch_url(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as response:
            raw = json.loads(response.read())
            return raw if isinstance(raw, dict) else None
    except Exception as exc:  # noqa: BLE001 — keep the existing output on failure
        log.warning("market-risk URL fetch failed: %s", exc)
        return None


def resolve_source(*, today: date | None = None, now: datetime | None = None) -> tuple[dict, str] | None:
    """Choose a qualified source before any stale fallback; keep source order on ties."""
    candidates = []
    url = os.environ.get("MACRO_RISK_URL")
    if url:
        raw = _fetch_url(url)
        if raw is not None:
            candidates.append((raw, "url:" + url))
    for relative in _LOCAL_SOURCES:
        path = MACRO / relative
        try:
            if path.exists():
                raw = json.loads(path.read_text())
                if isinstance(raw, dict):
                    candidates.append((raw, "local:" + relative))
        except Exception as exc:  # noqa: BLE001
            log.warning("could not read %s: %s", path, exc)
    for raw, provenance in candidates:
        if not build_market_risk(raw, today, now=now)["stale"]:
            return raw, provenance
    return candidates[0] if candidates else None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    now = datetime.now(timezone.utc)
    got = resolve_source(now=now)
    if got is None:
        log.error("no market-risk source reachable; leaving existing %s untouched", OUT.name)
        return 1
    src, provenance = got
    risk = build_market_risk(src, now=now, provenance=provenance)
    envelope = resolve_risk_envelope(risk["asof"], today=now.date(), now=now)
    risk = build_market_risk(src, now=now, provenance=provenance, risk_envelope=envelope)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(risk, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=OUT.parent,
                                         prefix=".market-risk-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(payload)
        temporary.replace(OUT)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    log.info("wrote %s — verdict=%s score=%s stale=%s basis=%s",
             OUT.name, risk["verdict"], risk["score"], risk["stale"], risk["source_basis"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
