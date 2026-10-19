"""Brain/Macro intel bridge (HANDOFF §7.6).

Deployed to /opt/terminal/ingest by terminal-build.sh's runtime sync (see DEPLOY.md) —
merged changes reach the box on the next deploy, not before.

For each equity symbol in the Mastermind Terminal universe, reads the Macro Dashboard's
per-stock JSON (site/stockdata/<SYM>.json) and writes a trimmed, versioned
terminal/public/data/<SYM>.intel.json in the ``intel/v1`` shape.

#18 bridge-contract fix (2026-07-01):
  1. ai_lean.dir is now a pure function of decision.band + entry_signal.status via an
     explicit mapping table — never derived from a single scalar (ladder.dir was the
     prior bug: ladder.dir='up' → BULL even while decision.band='neutral', score=50).
  2. Freshness gate: source asof older than MAX_STALE_DAYS trading-calendar days →
     stale=True; ai_lean is replaced by abstain=True (panel/copilot must not use a
     stale lean as a live signal).
  3. MACRO_STOCKDATA is read from MACRO_STOCKDATA env var (falls back to a sane
     path-relative default); a missing directory is logged loudly rather than silently
     producing empty output.
  4. This script is wired into the nightly VPS refresh /usr/local/bin/terminal-data,
     whose canonical source is the macro repo's app/deploy/terminal-refresh.sh
     (ingest/terminal-refresh.sh here is a pointer stub only).

sector_pulse pass-through (feat/sector-pulse-intel):
  5. When the source stockdata JSON contains a top-level ``sector_pulse`` block, a
     trimmed subset is forwarded into the intel/v1 output under ``tape.sector_pulse``.
     Trimmed shape: {theme_id, theme_name, heat, label, reco, rank, n_themes,
     rank_delta_5d, as_of}.
     heat ∈ heating | hot | cooling | broken | idle.
  6. Stale gate applies: when tape.stale is True the sector_pulse block is dropped
     entirely (not emitted as null) so the panel cannot display a stale heat as live.
  7. Absent/null source sector_pulse → field omitted from output (never null).
     Consumers MUST handle missing field — presence is not guaranteed.

Crypto symbols (BTC-USD, ETH-USD, SOL-USD, XRP-USD) and any symbol missing a source
file are silently skipped (no source file in stockdata/).

--all universe fix (2026-07-14):
  8. Real argument parsing. refresh_fund.sh step 10 has always invoked this script as
     ``pull_macro_intel.py --all [--limit N]``, but there was no flag handling —
     ``--all`` was consumed as a literal ticker (META.get default = Equities), matched
     no source file, and the run ended "0 written, 1 skipped". Every full-universe US
     intel refresh had silently no-opped since 2026-07-03. ``--all`` now expands to
     the stockdata catalog (index.json, ~1,700 names; ticker-shaped glob fallback),
     resolved after the R2 sync so a fresh lane mirror works. ``--limit N`` caps it;
     bare symbols / ``--only SYM ...`` select explicitly; no args still falls back to
     the curated DEFAULT list (VPS nightly behavior unchanged).

factordata local-source (2026-07-24):
  9. The tech block (tech_lab.json + tech_events/<SYM>.json) no longer depends on
     anonymous public HTTP.  Macro PR #3393 regwalled /factordata/* and had to carve
     out exactly those two paths for this script; the source is now resolved local-first
     (FACTORDATA_BASE path or file:// URL → $MACRO_REPO/site/factordata →
     ~/.mm-factordata → sibling checkout) with the public HTTPS base only as the
     legacy fallback — see the resolution-order comment at _FACTORDATA_HTTP_DEFAULT.
     refresh_fund.sh step 9b keeps ~/.mm-factordata fresh via an authenticated rsync
     from the droplet's /opt/macro checkout.

washout_turn pass-through (weekly dual-read row):
 10. When the source stockdata JSON contains a top-level ``washout_turn`` block, a
     trimmed subset is forwarded into the intel/v1 output under ``tape.washout_turn``.
     Trimmed shape: {state, since, depth_pctile, data_through,
     history: {n, med_13w, med_26w}}; each field is omitted when absent/uncoercible
     and ``history`` is dropped whole when it would be empty.
     state ∈ WASHOUT_TURN | TURN_WATCH — any other value is treated as absent.
     The same stale gate as §6 applies (a stale weekly window must not render as a
     live one), and an absent/null source block means the field is omitted from the
     output, never emitted as null (§7).  Consumers MUST handle the missing field.

Usage:
    python ingest/pull_macro_intel.py [SYM ...]        # explicit symbols (default: DEFAULT list)
    python ingest/pull_macro_intel.py --only AAPL      # same as positional
    python ingest/pull_macro_intel.py --all            # every symbol with a stockdata source
    python ingest/pull_macro_intel.py --all --limit 20
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.build_polygon_universe import DEFAULT, META  # noqa: E402
from ingest.security_state_bridge import read_security_state  # noqa: E402

# ── path ───────────────────────────────────────────────────────────────────────
# Prefer the env var; fall back to the standard relative position from the repo root
# so the script works in worktrees and CI without hard-coded absolute paths.
_env_path = os.environ.get("MACRO_STOCKDATA")
if _env_path:
    MACRO_STOCKDATA = Path(_env_path)
else:
    # Default: assume charting-app sits next to the macro repo as a sibling
    MACRO_STOCKDATA = ROOT.parent / "Macro Dashboard" / "site" / "stockdata"

OUT = ROOT / "terminal" / "public" / "data"

# ── freshness ──────────────────────────────────────────────────────────────────
# Allow up to this many calendar days of lag before treating a snapshot as stale.
# 3 trading days ≈ 5 calendar days (with weekend buffer); using 5 is conservative
# but safe when no trading-calendar helper is available.
MAX_STALE_DAYS: int = int(os.environ.get("INTEL_MAX_STALE_DAYS", "5"))

# ── R2 stockdata sync ─────────────────────────────────────────────────────────
# site/stockdata/ was gitignored from the macro repo on 2026-07-01 and now lives
# exclusively on R2.  This leg mirrors the public bucket into MACRO_STOCKDATA so
# pull_macro_intel can read it regardless of how the VPS checkout is set up.
# No credentials: the bucket is publicly readable (same URL the browser clients use).
# Cloudflare WAF blocks the default Python-urllib User-Agent — must send a custom one.
_R2_BASE     = os.environ.get("MACRO_R2_BASE",
                               "https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev")
_R2_UA       = "mastermind-feed/1.0"
_R2_DIR      = "stockdata"
_R2_TIMEOUT  = 30        # seconds per request
_R2_WORKERS  = 16
_R2_META     = ".r2_sync.json"   # local stamp: {"etag": "...", "count": N}

# ── factordata (tech lab) ──────────────────────────────────────────────────────
# tech_lab.json — per-signal descriptive profiles (~71 signals; read once per run).
# tech_events/<SYM>.json — per-symbol fire dates (only present for covered symbols).
#
# These are PAID signal payloads: macro PR #3393 gated /factordata/* behind the
# registration wall and had to carve out exactly these two paths for this script's
# anonymous fetches.  To let that carve-out close, prefer a LOCAL macro surface
# and keep anonymous HTTPS only as the legacy fallback.  Resolution order
# (first usable wins; "usable" = <dir>/tech_lab.json exists):
#   1. FACTORDATA_BASE env — http(s):// URL, file:// URL, or filesystem path.
#      A local value without tech_lab.json falls back to the HTTPS default.
#   2. $MACRO_REPO/site/factordata — the VPS nightly (terminal-refresh.sh exports
#      MACRO_REPO=/opt/macro, the droplet's own 3-min-pulled macro checkout) and
#      any lane driven by ingest/refresh_fund.sh (which exports MACRO_REPO).
#   3. ~/.mm-factordata — the Mac lanes: refresh_fund.sh rsyncs the two payload
#      sets down from the VPS into this cache each run.  $HOME because launchd
#      cannot read ~/Documents (macOS TCC — see ops/nightly_fund.sh header).
#   4. <sibling>/Macro Dashboard/site/factordata — dev checkouts.
#   5. https://mastermind-x.com/factordata — the legacy public carve-out.
# A chosen local dir is AUTHORITATIVE: a missing tech_events/<SYM>.json means
# "symbol not covered" (the old HTTP 404) and is NOT retried over HTTPS — an
# --all run must never spray ~1,700 requests at the (closing) public endpoint.
_FACTORDATA_HTTP_DEFAULT = "https://mastermind-x.com/factordata"
_FACTORDATA_HOME_CACHE   = Path.home() / ".mm-factordata"
_FACTORDATA_SIBLING      = ROOT.parent / "Macro Dashboard" / "site" / "factordata"
_FACTORDATA_UA      = "mastermind-feed/1.0"
_FACTORDATA_TIMEOUT = 20   # seconds per request — tech_lab.json is ~20–80KB
_TECH_LAB_LOG_ONCE: set = set()  # suppress repeated 404/error log per target
_FACTORDATA_SOURCE: Path | str | None = None  # memoized by _factordata_source()

log = logging.getLogger(__name__)


def _r2_fetch(url: str) -> tuple[bytes, str] | None:
    """GET url → (body, etag) or None on any error."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _R2_UA})
        with urllib.request.urlopen(req, timeout=_R2_TIMEOUT) as r:
            return r.read(), (r.headers.get("ETag") or "").strip('"')
    except Exception:
        return None


def sync_r2_stockdata(dest: Path) -> int | None:
    """Mirror the R2 stockdata dir into *dest*.

    Returns the number of files written (0 = ETag fast-path, nothing changed)
    or None when the sync could not run.  Never raises — keeps the last-good
    local mirror intact on any failure.

    The sync destination is always MACRO_STOCKDATA so pull_macro_intel reads
    fresh files regardless of whether the VPS git checkout carries them.
    """
    try:
        got = _r2_fetch(f"{_R2_BASE}/{_R2_DIR}/_manifest.json")
        if not got:
            return None
        try:
            names = [str(n) for n in json.loads(got[0])["files"]]
        except Exception:
            return None
        tag, meta_path = got[1], dest / _R2_META
        # NOTE: there is deliberately NO manifest-ETag fast-path. `_manifest.json` is only a
        # filename LIST — its ETag changes when the universe adds/removes a name, NOT when the
        # per-ticker payloads are republished (which happens every build). Gating the sync on that
        # ETag froze the local mirror for days while NVDA.json et al. advanced on R2 (the Research
        # Desk stale-intel incident, 2026-07-10→13). The macro build republishes the whole set daily,
        # so we always pull current content; the retry passes below absorb the rate-limit cost.
        dest.mkdir(parents=True, exist_ok=True)

        def _pull(name: str) -> bool:
            result = _r2_fetch(f"{_R2_BASE}/{_R2_DIR}/{name}")
            if not result:
                return False
            out = dest / name
            tmp = out.with_name(f".{out.name}.tmp")
            tmp.write_bytes(result[0])
            tmp.replace(out)
            return True

        with ThreadPoolExecutor(max_workers=_R2_WORKERS) as ex:
            results = list(ex.map(_pull, names))
        failed = [n for n, r in zip(names, results) if not r]
        # Transient rate-limit failures under full parallelism resolve on narrower
        # passes (observed 2026-07-04: 1023/1666 failed at 16 workers, yet every
        # straggler succeeded when fetched individually).
        for pause, workers in ((2, 4), (5, 2)):
            if not failed or len(failed) == len(names):
                break
            time.sleep(pause)
            with ThreadPoolExecutor(max_workers=workers) as ex:
                retry = list(ex.map(_pull, failed))
            failed = [n for n, r in zip(failed, retry) if not r]
        ok = len(names) - len(failed)
        if failed:
            log.warning("R2 sync incomplete: %d/%d files failed (will retry next run)",
                        len(failed), len(names))
        if ok == len(names) and tag:   # only stamp a complete sync
            meta_path.write_text(json.dumps({"etag": tag, "count": ok}))
        return ok
    except Exception:
        return None

# ── ai_lean mapping table ──────────────────────────────────────────────────────
# HARD INVARIANT: dir must never contradict decision.band.
#
# decision.band values observed in production (2026-07-01 audit):
#   'high'         — high-conviction opportunity
#   'constructive' — setup forming, not yet confirmed
#   'neutral'      — no clear edge
#   'low'          — weak / avoid
#   ''  / None     — missing
#
# entry_signal.status values observed:
#   'buy_now', 'buy_soon', 'partial'      → active entry signals
#   'watch', 'wait_pullback'              → conditional / not yet
#   'hold', 'extended', 'blocked'         → no entry
#   'topping', 'exit'                     → exit / avoid
#   '' / None                             → missing
#
# Mapping logic (in priority order):
#   1. If decision.band is missing/empty → NEUTRAL (insufficient data, abstain)
#   2. band='low' OR entry='exit'/'topping' → BEAR
#   3. band='high' AND entry in buy family  → BULL
#   4. band='constructive' AND entry in buy family → BULL
#   5. Everything else → NEUTRAL
#      (includes: high-band but entry=blocked/extended, constructive but entry=watch, etc.)
#
# NEVER derive dir from ladder.dir alone — it is a price-regime descriptor, not an
# actionable directional lean (a stock can have ladder.dir='up' while decision.band='neutral').

_BUY_ENTRIES = frozenset({"buy_now", "buy_soon", "partial"})
_EXIT_ENTRIES = frozenset({"exit", "topping"})


def _map_ai_dir(band: str | None, entry_status: str | None) -> str:
    """Map (decision.band, entry_signal.status) → BULL | BEAR | NEUTRAL.

    This is the single canonical mapping for the intel bridge.  Every path through
    build_intel must call this function — never inline the logic.
    """
    b = (band or "").lower().strip()
    e = (entry_status or "").lower().strip()

    # 1. No band → can't determine direction
    if not b:
        return "NEUTRAL"

    # 2. Bearish band or active exit signals → BEAR
    if b == "low" or e in _EXIT_ENTRIES:
        return "BEAR"

    # 3. Bullish band + confirmed entry → BULL
    if b in ("high", "constructive") and e in _BUY_ENTRIES:
        return "BULL"

    # 4. Everything else → NEUTRAL (includes high-band but entry blocked/extended/hold)
    return "NEUTRAL"


# ── helpers ────────────────────────────────────────────────────────────────────

def _r(v, nd: int = 4):
    """Round a float or return None if not numeric."""
    if v is None:
        return None
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


def _str(v):
    """Return str or None."""
    if v is None:
        return None
    return str(v)


def _list(v):
    """Return list or None."""
    if isinstance(v, list):
        return v
    return None


# ── sector_pulse helpers ───────────────────────────────────────────────────────
# HARD INVARIANT: only these heat values are forwarded to the Terminal.
# Any unrecognised value from the source is dropped (treat as absent) so a
# future dashboard experiment cannot push an unknown label into the UI.
_VALID_HEAT = frozenset({"heating", "hot", "cooling", "broken", "idle"})


def _build_sector_pulse(src_pulse: object) -> dict | None:
    """Extract a trimmed sector_pulse dict from the raw stockdata block.

    Returns None when the block is absent, null, not a dict, or contains no
    recognisable heat value.  Callers that receive None must omit the field from
    the output entirely — never write ``sector_pulse: null``.

    Trimmed fields passed through:
        theme_id, theme_name, heat, label, reco, rank, n_themes, rank_delta_5d, as_of

    Fields intentionally omitted (dashboard-internal / too large for terminal):
        theme_name_zh, theme_ids (list), region
    """
    if not isinstance(src_pulse, dict):
        return None

    heat = _str(src_pulse.get("heat"))
    if not heat or heat not in _VALID_HEAT:
        return None  # unknown or missing heat → treat as absent

    out: dict = {"heat": heat}

    for key in ("theme_id", "theme_name", "label", "reco", "as_of"):
        v = _str(src_pulse.get(key))
        if v is not None:
            out[key] = v

    for key in ("rank", "n_themes"):
        v = src_pulse.get(key)
        if v is not None:
            try:
                out[key] = int(v)
            except (TypeError, ValueError):
                pass

    v_delta = src_pulse.get("rank_delta_5d")
    if v_delta is not None:
        rounded = _r(v_delta, 1)
        if rounded is not None:
            out["rank_delta_5d"] = rounded

    return out


# ── washout_turn helpers ───────────────────────────────────────────────────────
# HARD INVARIANT (same shape as _VALID_HEAT): only these two states are forwarded
# to the Terminal.  Anything else from the source is dropped (treated as absent)
# so a future dashboard experiment cannot push an unknown state into the UI.
_VALID_WASHOUT_STATES = frozenset({"WASHOUT_TURN", "TURN_WATCH"})


def _build_washout_turn(src_wt: object) -> dict | None:
    """Extract a trimmed washout_turn dict from the raw stockdata block.

    Returns None when the block is absent, null, not a dict, or carries a state
    outside _VALID_WASHOUT_STATES.  Callers that receive None must omit the field
    from the output entirely — never write ``washout_turn: null``.

    Trimmed fields passed through:
        state, since, depth_pctile, data_through, history{n, med_13w, med_26w}

    Fields intentionally omitted (dashboard-internal / not read by the row):
        weeks_since_cross, depth_pctile_at_cross, line, sig, hist, stoch_k,
        stoch_d, weekly_cb, drawdown_pct, history_weeks, history_start,
        history.win_13w, history.win_26w, history.reason
    """
    if not isinstance(src_wt, dict):
        return None

    state = _str(src_wt.get("state"))
    if not state or state not in _VALID_WASHOUT_STATES:
        return None  # unknown or missing state → treat as absent

    out: dict = {"state": state}

    for key in ("since", "data_through"):
        v = _str(src_wt.get(key))
        if v is not None:
            out[key] = v

    depth = _r(src_wt.get("depth_pctile"), 1)
    if depth is not None:
        out["depth_pctile"] = depth

    # history: the prior-turn base rates. The row prints the thin-history disclosure
    # instead of a summary when these are missing, so each field is omitted (never
    # null) and an empty history block is dropped whole.
    src_hist = src_wt.get("history")
    if isinstance(src_hist, dict):
        hist: dict = {}
        n = src_hist.get("n")
        if n is not None:
            try:
                hist["n"] = int(n)
            except (TypeError, ValueError):
                pass
        for key in ("med_13w", "med_26w"):
            v = _r(src_hist.get(key), 1)
            if v is not None:
                hist[key] = v
        if hist:
            out["history"] = hist

    return out


def _is_stale(asof: str | None, today: date, max_days: int) -> bool:
    """Return True if asof is absent or older than max_days calendar days."""
    if not asof:
        return True
    try:
        src_date = date.fromisoformat(str(asof)[:10])
    except (ValueError, TypeError):
        return True
    return (today - src_date).days >= max_days


# ── core builder ───────────────────────────────────────────────────────────────

def build_intel(sym: str, src: dict, today: date | None = None) -> dict:
    """Map a Macro Dashboard stockdata dict → intel/v1 contract.

    The ``today`` parameter exists for testing (pass a fixed date to make freshness
    assertions deterministic).  Production callers omit it and get date.today().
    """
    if today is None:
        today = date.today()

    # --- helpers to navigate nested dicts safely ---
    def g(obj, *keys, default=None):
        """Nested .get() — returns default on any missing key or wrong type."""
        cur = obj
        for k in keys:
            if not isinstance(cur, dict):
                return default
            cur = cur.get(k)
            if cur is None:
                return default
        return cur

    asof = _str(src.get("asof"))

    # ── freshness gate ───────────────────────────────────────────────────────
    stale = _is_stale(asof, today, MAX_STALE_DAYS)

    # ── field extraction ─────────────────────────────────────────────────────
    view = src.get("view") or {}
    decision = g(view, "decision") or {}
    conviction = src.get("conviction") or {}
    ladder = src.get("ladder") or {}
    gex = src.get("gex") or {}
    positioning = src.get("positioning") or {}
    entry_signal = src.get("entry_signal") or {}

    decision_band = _str(g(decision, "band"))
    entry_status = _str(entry_signal.get("status"))
    headline = _str(g(decision, "headline"))

    # ── ai_lean: mapping table, never single-scalar derivation ───────────────
    if stale:
        # Abstain entirely when data is stale; the panel/copilot must not display
        # a lean that may be many days out of date.
        ai_lean: dict = {"abstain": True, "reason": "stale"}
    else:
        ai_dir = _map_ai_dir(decision_band, entry_status)
        conviction_score = _r(conviction.get("score"), 1)
        # Consistency guard: a BULL with a low score or a BEAR with a high score
        # indicates a mapping edge-case — demote to NEUTRAL rather than lying.
        if ai_dir == "BULL" and conviction_score is not None and conviction_score < 55:
            ai_dir = "NEUTRAL"
        if ai_dir == "BEAR" and conviction_score is not None and conviction_score > 65:
            ai_dir = "NEUTRAL"
        ai_lean = {
            "dir": ai_dir,
            "score": conviction_score,
            "band": decision_band,
            "entry": entry_status,
        }

    tape: dict = {
        "ai_lean": ai_lean,
        "asof": asof,
        "stale": stale,
        "conviction": _r(conviction.get("score"), 1),
        "regime": _str(ladder.get("regime_label")),
        "gex_flip": _r(gex.get("gamma_flip"), 2),
        "call_wall": _r(gex.get("call_wall"), 2),
        "put_wall": _r(gex.get("put_wall"), 2),
        "short_pct": _r(g(positioning, "short", "pct_float"), 2),
    }

    # ── sector_pulse pass-through ─────────────────────────────────────────────
    # Drop when stale: the panel must not display a sector heat that may be days
    # out of date.  Absent/null source → field omitted (never null in output).
    if not stale:
        pulse = _build_sector_pulse(src.get("sector_pulse"))
        if pulse is not None:
            tape["sector_pulse"] = pulse

    # ── washout_turn pass-through ─────────────────────────────────────────────
    # Same stale gate: a weekly turn read is a WINDOW, and a stale window must not
    # render as a live one.  Absent/null source → field omitted (never null).
    if not stale:
        wt = _build_washout_turn(src.get("washout_turn"))
        if wt is not None:
            tape["washout_turn"] = wt

    # ── cards.ai_judgment ────────────────────────────────────────────────────
    size = conviction.get("size") or {}
    ai_judgment = {
        "verdict": headline,
        "gloss": _str(g(decision, "gloss")),
        "size_pct": _r(size.get("pct"), 1),
    }

    # ── cards.conviction ─────────────────────────────────────────────────────
    cautions_raw = conviction.get("cautions") or []
    cautions_en = []
    for c in cautions_raw:
        if isinstance(c, str):
            cautions_en.append(c)
        elif isinstance(c, dict):
            en = c.get("en") or c.get("text")
            if en:
                cautions_en.append(str(en))

    conviction_card = {
        "score": _r(conviction.get("score"), 1),
        "band": _str(conviction.get("band_en")),
        "drivers": _list(conviction.get("drivers")),
        "cautions": cautions_en or None,
    }

    # ── cards.levels ─────────────────────────────────────────────────────────
    levels = [
        {"label": "Call wall", "price": _r(gex.get("call_wall"), 2), "kind": "resistance"},
        {"label": "Gamma flip", "price": _r(gex.get("gamma_flip"), 2), "kind": "pivot"},
        {"label": "Put wall", "price": _r(gex.get("put_wall"), 2), "kind": "support"},
    ]

    # ── cards.analyst ────────────────────────────────────────────────────────
    revisions = src.get("revisions") or {}
    valuation = src.get("valuation") or {}
    analyst = src.get("analyst") or {}
    fwd_pe = _r(valuation.get("forward_pe") or analyst.get("forward_pe"), 2)
    analyst_card = {
        "revision_breadth": _r(revisions.get("breadth"), 3),
        "est_chg_30d": _r(revisions.get("est_chg_30d"), 2),
        "est_chg_90d": _r(revisions.get("est_chg_90d"), 2),
        "fwd_pe": fwd_pe,
        "n_analysts": _r(revisions.get("n_analysts"), 0),
    }

    # ── cards.smart_money ────────────────────────────────────────────────────
    sm = src.get("smart_money") or {}
    sm_trend = sm.get("trend") or {}
    smart_money_card = {
        "trend": _str(sm_trend.get("direction")),
        "n_holders": _r(sm.get("n_holders"), 0),
        "value_change_pct": _r(sm_trend.get("value_change_pct"), 2),
    }

    # ── analysis.confluence / analysis.sniper (new contract blocks) ─────────────
    # The Macro Dashboard nightly will carry these top-level keys once live.
    # Until then they are absent from old stockdata JSONs → we silently omit them
    # (never emit null; the UI must handle missing keys as "not yet available").
    analysis_extras: dict = {}

    raw_confluence = src.get("confluence")
    if isinstance(raw_confluence, dict):
        htf_s2_raw = raw_confluence.get("htf_s2")  # SHADOW — never forward to UI
        conf_out: dict = {}
        tier = raw_confluence.get("tier")
        if tier is not None:
            conf_out["tier"] = _str(tier)
        w = raw_confluence.get("weight")
        if w is not None:
            conf_out["weight"] = _r(w, 4)
        sub = raw_confluence.get("sub")
        if sub is not None:
            conf_out["sub"] = _str(sub)
        ticks = raw_confluence.get("ticks")
        if ticks is not None:
            try:
                conf_out["ticks"] = int(ticks)
            except (TypeError, ValueError):
                pass
        btc = raw_confluence.get("bars_to_cross")
        if btc is not None:
            conf_out["bars_to_cross"] = _r(btc, 2)
        for bool_key in ("provisional", "not_topped", "htf_s1"):
            v = raw_confluence.get(bool_key)
            if v is not None:
                conf_out[bool_key] = bool(v)
        # htf_s2 is SHADOW — deliberately not forwarded (brief contract)
        _ = htf_s2_raw  # consumed but not emitted
        asof_conf = _str(raw_confluence.get("asof"))
        if asof_conf is not None:
            conf_out["asof"] = asof_conf
        if conf_out:
            analysis_extras["confluence"] = conf_out

    raw_sniper = src.get("sniper")
    if isinstance(raw_sniper, dict):
        sniper_out: dict = {}
        w2w = raw_sniper.get("w2_washout")
        if w2w is not None:
            sniper_out["w2_washout"] = bool(w2w)
        w2s = raw_sniper.get("w2_stoch_d")
        if w2s is not None:
            sniper_out["w2_stoch_d"] = _r(w2s, 2)
        d63 = raw_sniper.get("days_since_63d_low")
        if d63 is not None:
            try:
                sniper_out["days_since_63d_low"] = int(d63)
            except (TypeError, ValueError):
                pass
        coiled = raw_sniper.get("coiled")
        if coiled is not None:
            sniper_out["coiled"] = bool(coiled)
        asof_sniper = _str(raw_sniper.get("asof"))
        if asof_sniper is not None:
            sniper_out["asof"] = asof_sniper
        if sniper_out:
            analysis_extras["sniper"] = sniper_out

    out: dict = {
        "schema": "intel/v1",
        "ticker": sym,
        "asof": asof,
        "tape": tape,
        "cards": {
            "ai_judgment": ai_judgment,
            "conviction": conviction_card,
            "levels": levels,
            "analyst": analyst_card,
            "smart_money": smart_money_card,
        },
    }
    # Only emit the analysis sub-object when there is at least one block to write.
    # This keeps old-data output identical to pre-contract (no empty {} noise).
    if analysis_extras:
        out["analysis"] = analysis_extras
    # The owner envelope has its own identity, clocks and typed degradation.
    # Forward it intact after validation; never apply the research score/age gate
    # to this independent source or infer private exposure from a public symbol.
    security_state, disposition = read_security_state(src.get("security_state"), sym)
    out["security_state_read"] = {"disposition": disposition, "source_contract": "security_state.v1"}
    if security_state is not None:
        out["security_state"] = security_state
    return out


# ── tech block helpers ─────────────────────────────────────────────────────────

def _as_local_path(base: str) -> Path | None:
    """A FACTORDATA_BASE value → Path when it denotes a local directory, else None.

    Accepts bare filesystem paths (absolute, relative, or ~-prefixed) and
    file:// URLs.  http(s):// values return None (HTTP mode).
    """
    if base.startswith("file://"):
        return Path(urllib.request.url2pathname(urllib.parse.urlparse(base).path))
    if base.startswith(("http://", "https://")):
        return None
    return Path(base).expanduser()


def _has_tech_lab(d: Path) -> bool:
    """True when *d* is a usable factordata dir (tech_lab.json present).

    Swallows OSError: a TCC-denied candidate (launchd reading ~/Documents raises
    EPERM, which pathlib propagates) must mean "keep looking", not a crash.
    """
    try:
        return (d / "tech_lab.json").is_file()
    except OSError:
        return False


def _factordata_source() -> Path | str:
    """Resolve the factordata source once per run (memoized).

    Returns a Path (local authoritative dir) or an http(s) base-URL string.
    See the resolution-order comment at the _FACTORDATA_* constants above.
    """
    global _FACTORDATA_SOURCE
    if _FACTORDATA_SOURCE is not None:
        return _FACTORDATA_SOURCE

    env = os.environ.get("FACTORDATA_BASE", "").strip()
    if env:
        local = _as_local_path(env)
        if local is None:
            _FACTORDATA_SOURCE = env.rstrip("/")
            return _FACTORDATA_SOURCE
        if _has_tech_lab(local):
            _FACTORDATA_SOURCE = local
            return _FACTORDATA_SOURCE
        log.warning(
            "FACTORDATA_BASE=%s has no tech_lab.json — falling back to %s",
            env, _FACTORDATA_HTTP_DEFAULT,
        )
        _FACTORDATA_SOURCE = _FACTORDATA_HTTP_DEFAULT
        return _FACTORDATA_SOURCE

    candidates: list[Path] = []
    macro_repo = os.environ.get("MACRO_REPO", "").strip()
    if macro_repo:
        candidates.append(Path(macro_repo).expanduser() / "site" / "factordata")
    candidates += [_FACTORDATA_HOME_CACHE, _FACTORDATA_SIBLING]
    for cand in candidates:
        if _has_tech_lab(cand):
            _FACTORDATA_SOURCE = cand
            return _FACTORDATA_SOURCE
    _FACTORDATA_SOURCE = _FACTORDATA_HTTP_DEFAULT
    return _FACTORDATA_SOURCE


def _factordata_fetch(path: str) -> dict | None:
    """Read {source}/{path} → parsed JSON dict, or None when unavailable.

    Local source: a missing file is the old HTTP 404 ("not covered") — return
    None without touching the network.  HTTP source: GET as before.  Either way
    a failure logs once per target and returns None; callers treat None as
    "not available" and omit the block rather than crashing.
    """
    src = _factordata_source()
    if isinstance(src, Path):
        fp = src / path
        try:
            return json.loads(fp.read_text())
        except FileNotFoundError:
            log.debug("factordata local miss (not covered): %s", fp)
            return None
        except Exception as e:
            if str(fp) not in _TECH_LAB_LOG_ONCE:
                _TECH_LAB_LOG_ONCE.add(str(fp))
                log.warning("factordata local read error for %s: %s", fp, e)
            return None
    url = f"{src}/{path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _FACTORDATA_UA})
        with urllib.request.urlopen(req, timeout=_FACTORDATA_TIMEOUT) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if url not in _TECH_LAB_LOG_ONCE:
            _TECH_LAB_LOG_ONCE.add(url)
            if e.code == 404:
                log.debug("factordata 404 (not yet live): %s", url)
            else:
                log.warning("factordata HTTP %d: %s", e.code, url)
        return None
    except Exception as e:
        if url not in _TECH_LAB_LOG_ONCE:
            _TECH_LAB_LOG_ONCE.add(url)
            log.warning("factordata fetch error for %s: %s", url, e)
        return None


def _fetch_tech_lab_profiles() -> dict | None:
    """Fetch tech_lab.json once per run.  Returns a dict keyed by signal_id, or None.

    tech_lab.json schema:
        {"generated_utc": "...", "signals": {<signal_id>: {...}}, ...}

    Returns the inner "signals" dict (keyed by signal_id → profile), or None when
    the request fails or the expected structure is absent.
    """
    raw = _factordata_fetch("tech_lab.json")
    if not isinstance(raw, dict):
        return None
    signals = raw.get("signals")
    if not isinstance(signals, dict) or not signals:
        return None
    return signals


def _build_tech_block(sym: str, lab_profiles: dict | None) -> dict | None:
    """Build intel["tech"] for *sym*.

    Fetches tech_events/<SYM>.json.  Returns None when:
    - the per-symbol events endpoint returns 404/error (not yet live, or symbol not covered)
    - the payload is malformed

    When lab_profiles is None (tech_lab.json unavailable), profiles are omitted
    from the output but the events block is still forwarded if available.

    Output shape:
        {
            "events": <raw tech_events payload>,
            "profiles": {signal_id: <tech_lab.json row>},   # only signals present in events
            "asof": "<generated_utc>",
        }
    The "profiles" key is omitted when lab_profiles is None.
    Callers must handle a missing "profiles" key.

    House-law invariant (TLT-R3): this function only FETCHES and FORWARDS data
    produced by the macro Python engine.  No signals, scores, or escalations are
    derived here.
    """
    events_raw = _factordata_fetch(f"tech_events/{sym}.json")
    if not isinstance(events_raw, dict):
        return None  # 404 or parse error — omit block silently, rest of intel unaffected

    out: dict = {"events": events_raw}

    # Forward only the signal profiles that appear in this symbol's events payload.
    if isinstance(lab_profiles, dict):
        sig_ids = set(events_raw.get("signals", {}).keys())
        profiles = {sid: lab_profiles[sid] for sid in sig_ids if sid in lab_profiles}
        if profiles:
            out["profiles"] = profiles

    # Forward the generated_utc timestamp for display / staleness checks in the UI.
    asof = events_raw.get("generated_utc")
    if isinstance(asof, str) and asof:
        out["asof"] = asof

    return out


# Ticker-shaped stems only: uppercase start, then uppercase/digits/dot/hyphen.
# Excludes the non-symbol artifacts sharing the stockdata dir (index, calibration,
# fund_flows, mag7_regime — lowercase) and futures snapshots (BZ_F — underscore).
_TICKER_RE = re.compile(r"[A-Z][A-Z0-9.\-]*")


def _stockdata_universe() -> list[str]:
    """The --all universe: every buildable symbol in MACRO_STOCKDATA.

    Prefer the dashboard's own catalog (index.json: [{"t": "AAPL", ...}, ...]) —
    it lists exactly the per-symbol snapshots and nothing else.  Fall back to a
    ticker-shaped glob of the directory when the catalog is missing or malformed
    (an older mirror, or a partial sync).
    """
    try:
        entries = json.loads((MACRO_STOCKDATA / "index.json").read_text())
        tickers = sorted({str(e["t"]) for e in entries if isinstance(e, dict) and e.get("t")})
        if tickers:
            return tickers
    except Exception:
        pass
    return sorted(p.stem for p in MACRO_STOCKDATA.glob("*.json")
                  if _TICKER_RE.fullmatch(p.stem))


def main(syms: list[str], *, all_syms: bool = False, limit: int | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    # ── R2 sync leg ─────────────────────────────────────────────────────────
    # site/stockdata/ is gitignored from the macro repo since 2026-07-01 and
    # lives exclusively on the public R2 bucket.  Pull it before reading files.
    n = sync_r2_stockdata(MACRO_STOCKDATA)
    if n is None:
        log.warning("R2 sync failed — reading last-good local mirror at %s", MACRO_STOCKDATA)
    elif n == 0:
        log.warning("R2 sync wrote 0 files (empty manifest?) — reading local mirror at %s", MACRO_STOCKDATA)
    else:
        log.info("R2 stockdata synced: %d files written to %s", n, MACRO_STOCKDATA)

    # ── loud directory check ─────────────────────────────────────────────────
    if not MACRO_STOCKDATA.is_dir():
        log.error(
            "MACRO_STOCKDATA directory not found: %s\n"
            "Set the MACRO_STOCKDATA env var to the correct path.\n"
            "This is a configuration error, not a per-symbol skip.",
            MACRO_STOCKDATA,
        )
        sys.exit(1)

    OUT.mkdir(parents=True, exist_ok=True)
    today = date.today()

    # ── --all: the buildable universe = the stockdata catalog ───────────────────
    # Resolved AFTER the R2 sync (the mirror may be empty on a fresh lane) and
    # never from DEFAULT/manifest — DEFAULT is the ~37-name curated seed list,
    # while stockdata carries the full ~1,700-name US universe.
    if all_syms:
        syms = _stockdata_universe()
        log.info("--all: %d symbols from %s", len(syms), MACRO_STOCKDATA)

    # Equity-only symbols (skip crypto)
    equity_syms = [s for s in syms if META.get(s, ("", "Equities", ""))[1] == "Equities"]
    if limit is not None and limit >= 0:
        equity_syms = equity_syms[:limit]

    # ── tech block: read tech_lab.json once per run ──────────────────────────
    # Missing/unreadable → lab_profiles=None; per-symbol tech block is omitted when None.
    # This is a best-effort enrichment — failure here must never block the core intel write.
    fd_src = _factordata_source()
    log.info("reading tech_lab.json from %s (%s) …",
             fd_src, "local" if isinstance(fd_src, Path) else "https")
    lab_profiles = _fetch_tech_lab_profiles()
    if lab_profiles is None:
        log.warning(
            "tech_lab.json unavailable from %s — tech block will be omitted "
            "from all intel files this run.  Core intel write is unaffected.",
            fd_src,
        )
    else:
        log.info("tech_lab.json: %d signals loaded", len(lab_profiles))

    # Per-symbol lines at INFO are fine for curated runs but would append ~1,700
    # lines per night to the refresh log on an --all run — demote to DEBUG there
    # and emit a periodic progress line instead.
    per_sym_level = logging.INFO if len(equity_syms) <= 50 else logging.DEBUG

    ok, skipped, stale_count, failed = [], [], [], []
    for i, sym in enumerate(equity_syms):
        if per_sym_level == logging.DEBUG and i and i % 250 == 0:
            log.info("  progress: %d/%d (%d written, %d skipped, %d failed)",
                     i, len(equity_syms), len(ok), len(skipped), len(failed))
        src_path = MACRO_STOCKDATA / f"{sym}.json"
        if not src_path.exists():
            log.debug("skip %s: no source file", sym)
            skipped.append(sym)
            continue
        try:
            with open(src_path) as f:
                src = json.load(f)
            intel = build_intel(sym, src, today=today)

            # ── tech block (best-effort enrichment) ─────────────────────────
            # Fetch per-symbol events; 404 = symbol not yet covered = omit quietly.
            # Any failure here must not affect the core intel write (handled by
            # the outer try/except on the symbol loop).
            tech = _build_tech_block(sym, lab_profiles)
            if tech is not None:
                intel["tech"] = tech

            out_path = OUT / f"{sym}.intel.json"
            out_path.write_text(json.dumps(intel, separators=(",", ":")))
            lean = intel["tape"]["ai_lean"]
            is_stale = intel["tape"].get("stale", False)
            if is_stale:
                stale_count.append(sym)
                log.log(per_sym_level, "  %s: STALE (asof=%s) → abstain", sym, intel.get("asof"))
            else:
                log.log(
                    per_sym_level,
                    "  %s: wrote %s (regime=%s dir=%s band=%s entry=%s score=%s tech=%s)",
                    sym,
                    out_path.name,
                    intel["tape"].get("regime"),
                    lean.get("dir"),
                    lean.get("band"),
                    lean.get("entry"),
                    lean.get("score"),
                    "yes" if tech is not None else "omitted",
                )
            ok.append(sym)
        except Exception as exc:
            log.error("  ERROR %s: %s", sym, exc)
            failed.append(sym)

    print(
        f"\nDone: {len(ok)} written ({len(stale_count)} stale→abstain), "
        f"{len(skipped)} skipped (no src), {len(failed)} failed"
    )
    if stale_count:
        print(f"  Stale (abstained): {stale_count[:10]}{'...' if len(stale_count)>10 else ''}")
    if failed:
        print(f"  Failed: {failed[:10]}{'...' if len(failed)>10 else ''}")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Macro Dashboard → Terminal intel bridge (stockdata → <SYM>.intel.json)"
    )
    ap.add_argument("syms", nargs="*", metavar="SYM",
                    help="explicit symbols (default: curated DEFAULT list)")
    ap.add_argument("--only", nargs="+", default=[], metavar="SYM",
                    help="alias for positional symbols")
    ap.add_argument("--all", action="store_true", dest="all_syms",
                    help="build every symbol with a source file in MACRO_STOCKDATA "
                         "(the full ~1,700-name US universe; overrides SYM/--only)")
    ap.add_argument("--limit", type=int, default=None, metavar="N",
                    help="cap the number of symbols processed (applied after universe resolution)")
    args = ap.parse_args()

    main(args.syms + args.only or DEFAULT, all_syms=args.all_syms, limit=args.limit)
