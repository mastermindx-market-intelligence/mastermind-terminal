#!/usr/bin/env python3
"""Alerts evaluation engine — the server-side loop the Alerts UI always implied but never had.

Runs every 5 minutes (cron, same cadence as the flagship-signal refresh). One-shot semantics:
an armed alert whose condition is met FIRES once — the row is disarmed (active=false) and the
trigger evidence is stamped into condition.triggered = {at, value, note} (zero-DDL: the alerts
table has no state columns, so state rides the jsonb the UI already renders). Re-arming is a
user action in the UI (PATCH /api/alerts strips .triggered and re-sets active).

Condition contract (see terminal/components/AlertsView.tsx COND_TYPES):
  {type:"signal", target:"BUY"|"SELL"}   fires on a flagship signal of that side whose ts is
                                         >= the alert's creation date (stale signals never fire).
                                         BUY side = {BUY, REBUY}; SELL side = {SELL, CUT}.
  {type:"regime", target:"up"}           fires while manifest regimeBull is true.
  {type:"price", op:"above"|"below", value}  live hub quote (fallback: manifest EOD last).
  {type:"rsi", op:"below", value}        Wilder RSI(14) on daily EOD closes (matches chart RSI).

  Options-flow types (display-tier; algorithm is shared verbatim with terminal/lib/optionsAlerts.ts,
  parity-guarded by tests/test_alerts_options.py). Each carries per-condition hysteresis state on a
  cond sub-key that persists across runs WITHOUT firing (Supa.update_condition), except the
  preparatory frozen type, which requires protected lifecycle/state RPCs and cannot publish:
  {type:"opt_gamma_flip", root, band_pct?}          fires when spot crosses the gamma-flip level
                                                    (hysteresis dead-band = band_pct% of flip, default
                                                    0.05); first observation ARMS, never fires. State
                                                    on cond._fs = {side}. Reads Flow.gamma_state(root)
                                                    (current Quote-Hub spot vs latest EOD flip).
  {type:"opt_wall_touch", root, wall, within_pct?}  fires on ENTER within within_pct% (default 0.25)
                                                    of the call|put wall (EOD wall level). First obs
                                                    arms; re-arms on leave. State on cond._wp={inside}.
                                                    Reads Flow.gex(root).
  {type:"opt_premium_burst", root:"MARKET", leg, window_min?, z?}  fires when the trailing-window per-minute
                                                    slope of the cumulative ncp|npp leg runs ≥ z
                                                    standard errors ABOVE the baseline that PRECEDES
                                                    that window (defaults window 10, z 2). One-sided
                                                    (hot only); baseline must be ≥ MIN_BASELINE_MULT×
                                                    the window or the result is an honest null.
                                                    Fire-once per minute stamp on cond._pb=
                                                    {lastFiredT,lastZ}. Reads Flow.tide().
  {type:"opt_0dte_spike", root:"MARKET", share_pct?} fires when the 0d bucket's share of tracked net
                                                    premium at the latest common stamp ≥ share_pct
                                                    (default 55). Missing "0d" bucket → SKIP (honest
                                                    disable). Fire-once per stamp on cond._zd. Reads
                                                    Flow.dte().
  {type:"opt_wall_migration", root, wall, min_move_pct?}  fires when the call|put wall RE-STRIKES
                                                    between nightly builds by ≥ min_move_pct% of
                                                    spot (default 0.4) — a POSITIONING change, not
                                                    a price touch. First obs arms. State cond._wm=
                                                    {level}. Reads Flow.gex(root).
  {type:"opt_sign_fragile", root, tilt_pct?}        fires when the ladder's gamma tilt (the sign-
                                                    robustness statistic the Positioning tab renders)
                                                    drops below tilt_pct% (default 12) — ENTER only.
                                                    State cond._sf={fragile}. Reads Flow.gex(root).
  {type:"opt_opex_concentration", root, share_pct?} fires when the front expiry carries ≥ share_pct%
                                                    (default 35) of gross gamma — the OPEX-unwind
                                                    window. ENTER only; state cond._oc={above}.
                                                    Reads Flow.gex(root).
  {type:"opt_surface_pocket", root, k?, near_pct?, metric?}  fires when a single strike × interval
                                                    cell on the newest Flow-Surface snapshot, at a
                                                    strike within near_pct% of spot (default 5),
                                                    carries |net premium| ≥ k× (default 4) the mean
                                                    |cell| over the SAME strikes in the intervals
                                                    before it. No surface for the root → SKIP.
                                                    Fire-once per interval on cond._sp. Reads
                                                    Flow.surface(root).
  {type:"opt_frozen_node_proximity", root, target, within_pct?}
                                                    PREPARATORY — no production caller yet; the
                                                    armed-alert route does not admit this type and
                                                    no default admission reader exists. Fires when
                                                    the CURRENT SESSION spot first comes within
                                                    within_pct% (default 0.25) of ONE FROZEN options
                                                    node price carried by condition.target — sampled
                                                    proximity, never an exact intrabar touch. The
                                                    level is never re-priced or re-ranked: a node
                                                    frozen at 620 is judged against 620 even when
                                                    today's rebuilt wall prints 630. Admission is a
                                                    SEPARATE trusted reader argument (never read
                                                    from condition jsonb) that must attest the
                                                    principal, protected generation creation, the
                                                    current evaluation instant, the arming epoch,
                                                    the exact requested target identity and
                                                    rights.allowed with a policy version checked at
                                                    the evaluation instant — plus REQUIRED
                                                    priorState (null for an attested fresh
                                                    (re-)arming, or the reader-verified previous
                                                    state): own-row RLS means row.created_at and
                                                    condition._fnp are NEVER enrollment/prior-
                                                    observation evidence. Lifecycle comes from a
                                                    separate explicit service-RPC adapter; both
                                                    reader and adapter default unavailable. First qualifying quote
                                                    ARMS only (pre-enrollment touches are ignored);
                                                    a later outside→inside transition is a
                                                    candidate only: publication remains held.
                                                    Protected priorState (not cond._fnp)=
                                                    {targetFingerprint, armingEpoch, lastQuoteAt,
                                                    inside, withinPct, lastQuoteBasis}.
                                                    Quote comes ONLY from
                                                    Data.live_quote(root) — never Data.last,
                                                    spot_ref, Flow.gex or historical bars.

Data sources: terminal/public/data/manifest.json (verdict/regime/EOD), <SYM>.slice.json
(flagship signals), <SYM>.json (daily bars), Quote-Hub :HUB_PORT/quotes (live US+crypto),
and the same live Flow backend -> public-R2 fallback chain used by terminal/lib/flowSource.ts.
Committed Flow fixtures are available only through the explicit --flow-fixtures development flag;
production never treats fixture bytes as live alert evidence.
Supabase access via the service-role key in terminal/.env.local (same file the app loads).

Usage: alerts_engine.py [--dry-run] [--data-dir DIR] [--env-file FILE]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import hashlib
import re
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# Nightly invokes this file as a script; retain the house package bootstrap.
CA_ROOT = Path(__file__).resolve().parents[1]
if str(CA_ROOT) not in sys.path:
    sys.path.insert(0, str(CA_ROOT))
from ingest.options_frozen_lifecycle import FrozenNodeLifecycleAdapter  # noqa: E402
from ingest.options_frozen_service import FrozenNodeServiceReader  # noqa: E402
from ingest.options_frozen_assembly import assemble_frozen_node_services  # noqa: E402
from ingest.options_frozen_hit import FrozenNodeHitPublisher, runtime_record  # noqa: E402

DEFAULT_ENV = "/opt/terminal/terminal/.env.local"
DEFAULT_DATA = "/opt/terminal/terminal/public/data"
DEFAULT_FLOW_BACKEND = "http://127.0.0.1:8000"
DEFAULT_FLOW_R2 = "https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev"
# Meta-CEO ruling (PR #513 review round 5, MINOR-1): the one real lane this file runs, and the
# real cadence it runs on (see the module docstring: "Runs every 5 minutes"). main() passes both
# explicitly to run_once() rather than relying on the function's own defaults, so the receipt's
# lane_cadence_budget_s is plumbed from a named, documented source instead of an implicit match.
ALERTS_LANE = "alerts_engine"
ALERTS_LANE_CADENCE_S = 300
# Owned by the Node suite lane (ingest/suite_alerts.ts:185), which selects exactly
# these two and fires them with identical disarm semantics. This engine must never
# count another lane's rows as its own unevaluable — see F08 freeze §13 C2.
SUITE_LANE_TYPES = ("suite_event", "suite_sequence")
FLOW_USER_AGENT = "mastermind-alerts/1.0"
FLOW_ROOT_RE = re.compile(r"^[A-Z0-9]{1,10}(?:[.-][A-Z0-9]{1,4})?$")
_MARKET_WIDE_OPT = {"opt_premium_burst", "opt_0dte_spike"}


def normalize_opt_alert_root(value) -> str | None:
    """Byte-for-byte port of normalizeOptAlertRoot (terminal/lib/optionsAlerts.ts),
    which applies isValidRoot (terminal/lib/flowRoot.ts). Accepts exactly what
    Flow._root evaluates: strip+upper, total length ≤ 12, then FLOW_ROOT_RE. A root
    the engine will refuse is refused here too — F08 freeze §13 C12."""
    if not isinstance(value, str):
        return None
    root = value.strip().upper()
    return root if len(root) <= 12 and FLOW_ROOT_RE.fullmatch(root) else None


FLOW_STAMP_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
FLOW_ET = ZoneInfo("America/New_York")
FLOW_RTH_OPEN = time(9, 30)
FLOW_QUOTE_RTH_CLOSE = time(16, 0)
FLOW_TAPE_RTH_CLOSE = time(16, 15)
# A 15-minute-delayed source plus the 5-minute alert cron gets 20 minutes end to end.
# Anything older is context, not trigger evidence. This deliberately withholds alerts while
# the producer's actual cadence is slower instead of normalizing sparse tape as current.
FLOW_INTRADAY_MAX_AGE_SEC = 20 * 60
FLOW_EOD_MAX_AGE_DAYS = 3
FLOW_QUOTE_MAX_AGE_SEC = 30 * 60
FLOW_QUOTE_BASES = {"LIVE", "REALTIME", "DELAYED_15M"}
BUY_TYPES = {"BUY", "REBUY"}
SELL_TYPES = {"SELL", "CUT"}


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def load_env(path: str) -> dict:
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http_json(url: str, headers: dict | None = None, method: str = "GET", body: dict | None = None, timeout: int = 15):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw.strip() else None


def http_json_status(url: str, headers: dict | None = None, method: str = "GET", body: dict | None = None, timeout: int = 15):
    """Like http_json but never raises on an HTTPError — returns (status, parsed_body_or_None,
    raw_text). Used by the receipt/outbox paths, which must classify a 404/42P01 (table absent —
    typed READ_UNAVAILABLE) instead of crashing the run."""
    req = urllib.request.Request(url, method=method, headers=headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw.strip() else None), raw.decode(errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read()
        text = raw.decode(errors="replace")
        try:
            parsed = json.loads(raw) if raw.strip() else None
        except json.JSONDecodeError:
            parsed = None
        return e.code, parsed, text
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        # DNS failure / connection reset / socket timeout — a transport blip, not an HTTP
        # response. Must never propagate: the caller (start_run/conclude_run/insert_outbox) is
        # receipts-only, and letting this raise would abort fire() BEFORE the disarm PATCH runs
        # (MAJOR 8). Synthetic 599 classifies as READ_UNAVAILABLE, same as a 503.
        log(f"transport error contacting {url}: {e}")
        return 599, None, str(e)


# Transient state riding the condition jsonb — hysteresis flags the stateful options
# evaluators persist between runs, plus the trigger stamp itself. None of these are part of
# what the alert IS; excluding them keeps condition_version stable across the runs that lead
# up to a fire. _CONDITION_TRANSIENT_KEYS itself is assigned further down, DERIVED from
# _OPT_EVALUATORS' own state keys (Meta-CEO ruling, PR #513 review round 4, MAJOR-2) — never
# hand-duplicated here, so a new stateful evaluator can never forget to exclude its own
# hysteresis key. Module-level names resolve at call time, so referencing the name here (before
# its later assignment) is safe: nothing calls condition_version() before the whole module has
# finished loading.


def condition_version(condition: dict) -> str:
    """A short, deterministic fingerprint of the alert's condition, excluding transient/hysteresis
    keys, so it changes only when the user actually edits the condition."""
    stable = {k: v for k, v in (condition or {}).items() if k not in _CONDITION_TRANSIENT_KEYS}
    raw = json.dumps(stable, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def mint_fire_event_id(alert: dict, vintage: str) -> str:
    """Deterministic fire_event_id = f(alert id, condition version, evaluation vintage). Same
    alert + same condition + same data vintage => same id, so a replayed run (crash-and-retry, or
    a second engine invocation racing the first) inserts the SAME outbox row instead of a second
    one — the unique index on alert_outbox.fire_event_id is the enforcement point, this is just
    the deterministic input to it.

    Identity is ONLY this triple (Meta-CEO ruling, F08 id contract frozen with macro's B-F08-1b
    drain) — never the outbox row's own status. A same-vintage replay (crash-and-retry reading
    the same on-disk data) collapses onto the same id by construction; a genuine re-fire after a
    re-arm has a NEW vintage (the data moved on) and therefore mints a new id. There is
    deliberately no other identity signal (no lookup of a prior row) because a crash-retry and a
    genuine re-fire are indistinguishable from any state the outbox itself could offer."""
    raw = f"{alert.get('id')}:{condition_version(alert.get('condition') or {})}:{vintage}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _minute_vintage(value: str | None) -> str | None:
    """Best-effort truncation of an ISO-8601 timestamp to minute-granularity UTC — the id
    contract's evaluation_vintage is deliberately coarse so a fast crash-and-retry (same
    underlying data, a few seconds apart) collapses onto the same vintage. A bare date (no time
    component, e.g. an EOD build stamp) parses to that date's midnight and stays stable for the
    whole build day, which is all a daily-cadence EOD read needs."""
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value  # not parseable as a timestamp — pass through as an opaque-but-stable token
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


# Meta-CEO ruling (PR #513 review round 6, MINOR-2): the bare generic TA terms "resistance
# level"/"support level" collide with the chart resistance/support the user already has —
# precision loss without a qualifier. The wall side must always carry the "options" qualifier
# (DEC-CHAIRMAN-FRONTEND-PLAIN-LANGUAGE-LAW-2026-09-06 binds every user-facing string, and this
# dict feeds the delivered outbox payload).
_OPT_WALL_SIDE_EN = {
    "call": "an options level that tends to act as resistance",
    "put": "an options level that tends to act as support",
}
_OPT_WALL_SIDE_ZH = {
    "call": "一个通常起阻力作用的期权关键价位",
    "put": "一个通常起支撑作用的期权关键价位",
}


def _plain_root(cond: dict, symbol: str) -> str:
    return (
        normalize_opt_alert_root(cond.get("root"))
        or normalize_opt_alert_root(symbol)
        or "the underlying"
    )


def _condition_plain_en(cond: dict, symbol: str) -> str:
    """Plain-English description of what the alert WATCHES FOR — the condition, never the
    fired result (Meta-CEO ruling, PR #513 review round 4, MAJOR-3). Built from the STRUCTURED
    condition dict alone: no basis tags, no raw ISO timestamps, no internal slugs — those stay
    in the engine's own log lines and never reach a delivered payload.

    Meta-CEO ruling (PR #513 review round 5, MAJOR-1): every branch — including the opt_* ones
    — uses plain everyday words, never an internal study/indicator name (no "RSI(14)"), a raw
    Greek-letter options term (no "gamma"), or an internal leg/slug abbreviation (no
    "net-put"/"net-call"). "bullish"/"bearish" and the options-wall phrase above are the plain
    vocabulary this file already uses elsewhere (the regime branch below) — every reader already
    recognizes them, unlike the internal names they replace
    (DEC-CHAIRMAN-FRONTEND-PLAIN-LANGUAGE-LAW-2026-09-06 binds every user-facing string).

    Meta-CEO ruling (PR #513 review round 6, MAJOR-1/MAJOR-2/MINOR-3): plain wording must
    describe the MEASURED quantity, never a different claim. opt_0dte_spike measures a SHARE of
    the options money traded (never an absolute "surge in trading" — the share can cross while
    0DTE activity is flat or falling); opt_sign_fragile measures how BALANCED the call/put gamma
    split is (never a trader-sentiment/conviction claim — the evaluator observes no trader
    behavior); opt_opex_concentration measures a share of OPEN options positions concentrated in
    the front expiry (never generic "options activity")."""
    ctype = cond.get("type")
    sym = symbol or "the symbol"
    if ctype == "price":
        op_word = "rises above" if cond.get("op") == "above" else "falls below"
        return f"{sym} {op_word} {cond.get('value')}"
    if ctype == "rsi":
        return f"{sym} drops into oversold territory, below {cond.get('value')}"
    if ctype == "regime":
        return f"{sym} turns bullish"
    if ctype == "signal":
        return f"{sym} gets a buy signal" if cond.get("target") == "BUY" else f"{sym} gets a sell signal"
    root = _plain_root(cond, sym)
    if ctype == "opt_gamma_flip":
        return f"{root} crosses a key options level that can amplify its price swings"
    if ctype == "opt_wall_touch":
        wall = _OPT_WALL_SIDE_EN["put" if cond.get("wall") == "put" else "call"]
        return f"{root} nears {wall}"
    if ctype == "opt_premium_burst":
        bias = "bearish" if cond.get("leg") == "npp" else "bullish"
        return f"{root} sees an unusually large burst of {bias} options bets"
    if ctype == "opt_0dte_spike":
        return (f"same-day options now make up an unusually large share of the options money "
                 f"being traded in {root}")
    if ctype == "opt_wall_migration":
        role = "support" if cond.get("wall") == "put" else "resistance"
        return f"the options level that tends to act as {role} for {root} shifts to a new price"
    if ctype == "opt_sign_fragile":
        return f"the options positioning picture for {root} is finely balanced and could flip either way"
    if ctype == "opt_opex_concentration":
        return f"a large share of {root}'s open options positions is concentrated in the nearest expiration date"
    if ctype == "opt_surface_pocket":
        return f"{root} shows an unusual cluster of options activity at one price level"
    if ctype == "opt_frozen_node_proximity":
        # Describes the WATCHED condition, never a fired result and never a re-ranked level:
        # the alert is pinned to ONE specific frozen options price level from the moment it
        # was set up, and it fires when the current price first comes near THAT level.
        return _fnp_condition_plain(cond, root, zh=False)
    return f"{sym} condition is met"


def _condition_plain_zh(cond: dict, symbol: str) -> str:
    """Simplified-Chinese sibling of _condition_plain_en — same rule: describes the condition,
    built from the structured dict, never the fired result or internal jargon.

    Meta-CEO ruling (PR #513 review round 5, MAJOR-1): every internal term is TRANSLATED into
    plain Chinese, never left as a bare Latin/English fragment inside the Chinese sentence (no
    untranslated "gamma", no untranslated "RSI(14)") — a mixed-language sentence fails the plain-
    language law exactly as an untranslated jargon term does in English."""
    ctype = cond.get("type")
    sym = symbol or "该标的"
    if ctype == "price":
        op_word = "涨破" if cond.get("op") == "above" else "跌破"
        return f"{sym}{op_word}{cond.get('value')}"
    if ctype == "rsi":
        return f"{sym}跌入超卖区间，低于{cond.get('value')}"
    if ctype == "regime":
        return f"{sym}转为多头"
    if ctype == "signal":
        return f"{sym}出现买入信号" if cond.get("target") == "BUY" else f"{sym}出现卖出信号"
    root = _plain_root(cond, sym)
    if ctype == "opt_gamma_flip":
        return f"{root}突破一个可能放大其价格波动的关键期权水平"
    if ctype == "opt_wall_touch":
        wall = _OPT_WALL_SIDE_ZH["put" if cond.get("wall") == "put" else "call"]
        return f"{root}接近{wall}"
    if ctype == "opt_premium_burst":
        bias = "看跌" if cond.get("leg") == "npp" else "看涨"
        return f"{root}出现异常大量的{bias}期权押注"
    if ctype == "opt_0dte_spike":
        return f"{root}当日到期期权在期权成交金额中的占比异常偏高"
    if ctype == "opt_wall_migration":
        role = "支撑" if cond.get("wall") == "put" else "阻力"
        return f"{root}那个通常起{role}作用的关键期权价位变为新的价位"
    if ctype == "opt_sign_fragile":
        return f"{root}的期权持仓格局非常接近平衡，读数可能翻转"
    if ctype == "opt_opex_concentration":
        return f"{root}的未平仓期权头寸高度集中在最近的到期日"
    if ctype == "opt_surface_pocket":
        return f"{root}在某一价位出现异常集中的期权交易"
    if ctype == "opt_frozen_node_proximity":
        return _fnp_condition_plain(cond, root, zh=True)
    return f"{sym}条件已触发"


class Supa:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}

    def active_alerts(self) -> list[dict]:
        types = ",".join(SUITE_LANE_TYPES)
        return http_json(
            f"{self.base}/alerts?active=eq.true&condition->>type=not.in.({types})&select=*",
            self.h,
        ) or []

    def fire(self, alert: dict, value, note: str, *, vintage: str) -> bool:
        """Legacy types: disarm + stamp trigger evidence. Frozen-node fire is refused before
        any effect pending a future atomic authorized lifecycle/fire composition; retained
        frozen-node payload branches below are currently unreachable.
        The active=eq.true guard makes double-fires a no-op
        even if two engine runs overlap — this PATCH filter and its disarm semantics are FROZEN,
        never replaced. Before the disarm, mint a deterministic fire_event_id from (alert id,
        condition version, evaluation vintage) alone — see mint_fire_event_id — and insert (or,
        on replay over the same vintage, no-op into) the alert_outbox row so delivery has a
        durable, replay-safe queue entry. The outbox insert happens BEFORE the disarm PATCH so a
        crash between the two leaves a pending outbox row (never lost, never marked delivered)
        rather than a fire with no delivery trace.

        `vintage` is REQUIRED — the caller (run_once()) always supplies the data vintage the
        evaluator actually used for this alert this run (Data.evaluation_vintage() — no
        wall-clock rung anywhere in that ladder; Meta-CEO ruling, PR #513 review round 6,
        MINOR-1). There is deliberately no fallback identity here: a prior-
        row lookup cannot tell a crash-retry from a genuine re-fire (that heuristic swallowed a
        genuine second fire and, separately, double-enqueued a deferred one — Meta-CEO ruling on
        PR #513 review round 1), so identity comes ONLY from the deterministic triple.

        Returns True when the alert was disarmed (insert succeeded, replayed as a no-op duplicate,
        or the outbox table is not applied yet — the legacy pre-outbox disarm path). Returns False
        when the outbox insert hard-errored (5xx/401/400/network) — the alert is left ARMED so the
        next run re-evaluates and retries it: never lost, never duplicated, never delivered on a
        stale payload."""
        # This type needs a future atomic, authorized lifecycle+fire composition.
        # Outbox INSERT also fans out through the incumbent webhook trigger; the
        # email drain guard alone cannot make this generic method safe.
        if (alert.get("condition") or {}).get("type") == "opt_frozen_node_proximity":
            return False
        fired_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        raw_cond = alert.get("condition") or {}
        cond = dict(raw_cond)
        cond["triggered"] = {"at": fired_at, "value": value, "note": note}
        fire_event_id = mint_fire_event_id(alert, vintage)
        ticker = str(alert.get("symbol") or "").upper()
        if raw_cond.get("type") == "opt_frozen_node_proximity":
            target = raw_cond.get("target")
            ticker = normalize_opt_alert_root(raw_cond.get("root"))
            if ticker is None or not isinstance(target, dict) or target.get("root") != ticker:
                return False
        # Meta-CEO ruling (PR #513 review round 4, MAJOR-3): the outbox payload IS the
        # user-facing delivery text, so it is built from the STRUCTURED condition here — plain
        # operator words, plain signal names, no basis tags, no raw slugs, no ISO timestamps.
        # `note` (which carries all of that formatting for the engine's OWN log lines) never
        # reaches this payload. condition_plain describes the CONDITION the alert watches for,
        # never the fired result. subject_zh/summary_plain_zh/condition_plain_zh are additive
        # jsonb keys — the 0013 DDL contract is unchanged; macro's drain reads the EN keys
        # today and may read the ZH keys additively later.
        condition_plain = _condition_plain_en(raw_cond, ticker)
        condition_plain_zh = _condition_plain_zh(raw_cond, ticker)
        subject = f"{ticker} alert: {condition_plain}" if ticker else condition_plain
        subject_zh = f"{ticker}提醒：{condition_plain_zh}" if ticker else condition_plain_zh
        summary_plain = f"Your alert fired: {condition_plain}."
        summary_plain_zh = f"你的提醒已触发：{condition_plain_zh}。"
        payload = {
            "subject": subject,
            "subject_zh": subject_zh,
            "summary_plain": summary_plain,
            "summary_plain_zh": summary_plain_zh,
            "ticker": ticker,
            "condition_plain": condition_plain,
            "condition_plain_zh": condition_plain_zh,
            # Meta-CEO ruling (PR #513 review round 5, MAJOR-2): condition_plain/summary_plain
            # deliberately describe the CONDITION, never the fired result, so two fires of the
            # same condition at different observed readings share the same plain text (see
            # test_h1_genuine_refire_after_rearm_mints_two_distinct_events). But the observed
            # reading must still reach the delivery queue SOMEWHERE, or a delivered alert can
            # never say what actually printed — `value` is that raw observed reading, additive
            # to the payload dict, so a consumer (macro's drain today, this file's own log lines
            # already) can render it without it ever leaking into condition_plain's wording.
            "value": value,
            # /alerts is a real route (app/(shell)/alerts/page.tsx) — the query string was
            # removed because AlertsView does not read an "id" param yet, so it deep-linked
            # nowhere; this still lands the user on the page that lists their fired alert.
            "evidence_url": "/alerts",
            "fired_at": fired_at,
        }
        if raw_cond.get("type") == "opt_frozen_node_proximity":
            state = raw_cond.get(FNP_STATE_KEY) or {}
            payload.update({
                "category": "options_exposure_node",
                # No condition tier override is accepted by this preparatory contract.
                "requires_tier": "essential",
                "frozen_node": {
                    "target": raw_cond.get("target"),
                    "within_pct": state.get("withinPct"),
                    "quote": {"asof": state.get("lastQuoteAt"), "basis": state.get("lastQuoteBasis")},
                },
            })
        insert_outcome = self.insert_outbox(alert.get("user_id"), alert.get("id"), fire_event_id, payload)
        if insert_outcome == "error":
            # A genuine hard failure on the insert (not a schema-cache miss) must never disarm —
            # the fire would otherwise be unrecoverable (Meta-CEO ruling item 2).
            return False

        url = f"{self.base}/alerts?id=eq.{urllib.parse.quote(str(alert['id']))}&active=eq.true"
        http_json(url, {**self.h, "Prefer": "return=minimal"}, method="PATCH",
                  body={"active": False, "condition": cond})
        return True

    def update_condition(self, alert: dict, cond: dict) -> bool | None:
        """Persist a legacy condition WITHOUT firing; frozen-node conditions return False.
        Active stays true — used by the stateful
        options evaluators to record a confirmed flip-side / wall-inside flag between runs so the
        hysteresis machine survives across the 5-minute cron. Guarded by active=eq.true, mirroring
        fire(), so it never resurrects an already-disarmed alert."""
        if "opt_frozen_node_proximity" in {(alert.get("condition") or {}).get("type"), cond.get("type")}:
            return False  # This type persists ONLY through protected generation/revision CAS.
        url = f"{self.base}/alerts?id=eq.{urllib.parse.quote(str(alert['id']))}&active=eq.true"
        http_json(url, {**self.h, "Prefer": "return=minimal"}, method="PATCH", body={"condition": cond})

    def frozen_runtime_rpc(self, name: str, params: dict):
        """Explicit service-role RPC seam; no table fallback or default invocation."""
        if name not in {"read_frozen_node_runtime", "arm_frozen_node_runtime", "commit_frozen_node_state"}:
            return {"kind": "unavailable", "reason": "unknown lifecycle operation"}
        status, parsed, _ = http_json_status(f"{self.base}/rpc/{name}", self.h, method="POST", body=params)
        if (isinstance(params.get('p_hit'), dict) and params['p_hit'].get('mode') in ('prepare', 'commit', 'fence')
                and (status == 0 or status >= 500
                     or (200 <= status < 300 and not isinstance(parsed, dict)))):
            return {"kind": "effect_unknown", "reason": "atomic hit outcome unavailable"}
        return parsed if 200 <= status < 300 and isinstance(parsed, dict) else {
            "kind": "unavailable", "reason": "lifecycle RPC unavailable"}

    def frozen_lifecycle_adapter(self):
        """Constructing this explicit adapter does no IO and supplies no action grant."""
        return FrozenNodeLifecycleAdapter(self.frozen_runtime_rpc,
            fingerprint=frozen_node_target_fingerprint, instant_micros=_fnp_instant_micros,
            normalize_state=_fnp_normalize_state, format_instant=_fnp_format_instant_utc,
            default_within_pct=FNP_DEFAULT_WITHIN_PCT, source_origin=self.base.removesuffix("/rest/v1"))

    @staticmethod
    def _classify(status: int) -> str:
        """§5 read vocabulary: map a non-2xx PostgREST status to a typed label instead of the
        single catch-all READ_UNAVAILABLE this file used to apply to everything (MAJOR 2). Table-
        absent (404/42P01) is handled separately by _table_missing before this is ever consulted.
        """
        if status in (401, 403):
            return "READ_DENIED"          # signed-out / RLS refusing the write — not "not applied yet"
        if status == 409:
            return "READ_CONFLICT"        # a real uniqueness/constraint conflict, not a duplicate no-op
        if status in (503, 599):
            return "READ_UNAVAILABLE"     # substrate genuinely unreachable (incl. transport blips)
        return "READ_ERROR"               # anything else is a real error and must not be swallowed

    @staticmethod
    def _table_missing(status: int, parsed) -> bool:
        """A receipt/outbox table that has not been applied yet (migration 0013 is a RESERVATION,
        not an application — see supabase/migrations/README.md) answers 404 from PostgREST's
        schema-cache lookup, or occasionally 400 with Postgres code 42P01 (undefined_table).
        Anything else is a real error and must not be swallowed."""
        if status == 404:
            return True
        if isinstance(parsed, dict) and parsed.get("code") == "42P01":
            return True
        return False

    def frozen_publication_clear(self, lane: str) -> bool:
        """Read-only startup fence. Unknown/malformed/table-absent never clear it."""
        url = (f'{self.base}/alert_runs?lane=eq.{urllib.parse.quote(lane, safe="")}'
               '&error_class=in.(frozen_publication_pending,frozen_fire_effect_unknown)'
               '&select=run_id&limit=1')
        try:
            status, rows, _ = http_json_status(url, self.h)
            return 200 <= status < 300 and isinstance(rows, list) and not rows
        except Exception:
            return False

    def start_run(self, lane: str, run_id: str, started_at: str, source_asof: str | None,
                   lane_cadence_budget_s: int | None, *, frozen_pending: bool = False) -> bool:
        """Insert the 'started' half of the two-phase alert_runs receipt. Returns False (and logs
        a typed READ_UNAVAILABLE line) when alert_runs has not been applied yet — the fire path is
        unaffected either way, this is receipts-only."""
        url = f"{self.base}/alert_runs"
        body = {
            "lane": lane, "run_id": run_id, "started_at": started_at,
            "source_asof": source_asof, "lane_cadence_budget_s": lane_cadence_budget_s,
        }
        if frozen_pending:
            body["error_class"] = "frozen_publication_pending"
        status, parsed, text = http_json_status(url, {**self.h, "Prefer": "return=minimal"},
                                                 method="POST", body=body)
        if frozen_pending and not 200 <= status < 300:
            return False  # No acknowledged durable pre-transport barrier, no publication.
        if self._table_missing(status, parsed):
            log("READ_UNAVAILABLE alert_runs (start) — table not applied yet; run proceeds without a receipt")
            return False
        if status >= 300:
            log(f"{self._classify(status)} alert_runs (start) — {status}: {text[:200]}")
            return False
        return True

    def conclude_run(self, lane: str, run_id: str, concluded_at: str, outcome: str,
                      evaluated_n: int | None, fired_n: int | None, unevaluable_n: int | None,
                      error_class: str | None, source_asof: str | None = None) -> bool:
        """Patch the terminal half of the receipt by (lane, run_id). No-ops quietly if the start
        row was never written (table absent) — the guard mirrors start_run's classification.
        evaluated_n/fired_n/unevaluable_n are nullable: a crash before the counters are known must
        write null ('we don't know'), never 0 ('nothing happened') — see F08 run-receipt law.
        source_asof re-stamps the receipt to the fallback vintage when any price read this run
        fell back from the live hub to a previously-persisted manifest EOD last."""
        url = (f"{self.base}/alert_runs?lane=eq.{urllib.parse.quote(lane)}"
               f"&run_id=eq.{urllib.parse.quote(run_id)}")
        body = {
            "concluded_at": concluded_at, "outcome": outcome, "evaluated_n": evaluated_n,
            "fired_n": fired_n, "unevaluable_n": unevaluable_n, "error_class": error_class,
            "source_asof": source_asof,
        }
        status, parsed, text = http_json_status(url, {**self.h, "Prefer": "return=minimal"},
                                                 method="PATCH", body=body)
        if self._table_missing(status, parsed):
            log("READ_UNAVAILABLE alert_runs (conclude) — table not applied yet")
            return False
        if not 200 <= status < 300:
            log(f"{self._classify(status)} alert_runs (conclude) — {status}: {text[:200]}")
            return False
        return True

    def insert_outbox(self, user_id, alert_id, fire_event_id: str, payload: dict) -> str:
        """Insert one alert_outbox row keyed by fire_event_id. Idempotent by construction
        (Prefer: resolution=ignore-duplicates against the unique fire_event_id index): a
        replayed run computing the SAME fire_event_id (same alert, same condition version, same
        evaluation vintage) inserts nothing new and is reported 'duplicate', never raises, and
        never double-enqueues delivery. The outbox row's own status (pending/deferred/sent/
        failed/suppressed) never matters here — identity is the id alone.

        Returns one of:
          'inserted'    — a new row was written.
          'duplicate'   — the unique index (or, defensively, a raw 409) said this exact event
                          already exists; the caller proceeds to disarm exactly as on 'inserted'.
          'unavailable' — the table is not applied yet (404/42P01 — migration 0013 is still a
                          reservation); the caller proceeds with the LEGACY disarm, unchanged.
          'error'       — a genuine failure (5xx/401/400/network) that is NOT a schema-cache
                          miss; the caller must NOT disarm (Meta-CEO ruling item 2 — an
                          unrecoverable insert must never look like a successful fire)."""
        # PostgREST's ignore-duplicates upsert targets the PRIMARY KEY unless the request names
        # the conflict target explicitly — this table's unique key is fire_event_id, not the pk
        # id column, so ?on_conflict=fire_event_id is load-bearing: without it a real duplicate
        # raises 23505/409 instead of no-op'ing.
        url = f"{self.base}/alert_outbox?on_conflict=fire_event_id"
        headers = {**self.h, "Prefer": "return=representation,resolution=ignore-duplicates"}
        body = {
            "user_id": user_id, "alert_id": alert_id, "fire_event_id": fire_event_id,
            "channel": "email", "status": "pending", "payload": payload,
        }
        status, parsed, text = http_json_status(url, headers, method="POST", body=body)
        if self._table_missing(status, parsed):
            log("READ_UNAVAILABLE alert_outbox (insert) — table not applied yet; disarm proceeds without an outbox row")
            return "unavailable"
        if status == 409:
            # Meta-CEO ruling (PR #513 review round 4, MINOR-2): this is the expected,
            # idempotent duplicate-of-record disposition, not a genuine conflict/error — label
            # it ALREADY_ENQUEUED, not READ_CONFLICT, so it never reads like a failure.
            log("ALREADY_ENQUEUED alert_outbox (insert) — proceeding to disarm")
            return "duplicate"
        if status >= 300:
            # Any other non-2xx here (5xx/401/400/network — the transport-blip synthetic 599
            # included) is neither a schema-cache miss nor a duplicate-of-record. It must never
            # print as READ_UNAVAILABLE: that label means "table not applied yet, disarm
            # proceeds anyway" — the OPPOSITE disposition from this branch, which returns
            # 'error' so fire() leaves the alert armed. _classify()'s 503/599->READ_UNAVAILABLE
            # mapping is for the receipt tables (start_run/conclude_run), where no disarm
            # decision rides on the label; reusing it here made the two opposite outcomes share
            # one prefix (MAJOR 5, PR #513 review round 2). Always READ_ERROR.
            log(f"READ_ERROR alert_outbox (insert) — {status}: {text[:200]}")
            return "error"
        return "inserted" if parsed else "duplicate"


def rsi14(closes: list[float], period: int = 14) -> float | None:
    """Wilder RSI, seeded with the simple mean of the first `period` deltas — matches the chart's
    RSI implementation (ChartPanel) so the alert and the sub-pane agree."""
    if len(closes) < period + 1:
        return None
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    ag, al = gains / period, losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (period - 1) + max(d, 0.0)) / period
        al = (al * (period - 1) + max(-d, 0.0)) / period
    if al == 0:
        return 100.0
    rs = ag / al
    return 100.0 - 100.0 / (1.0 + rs)


class Data:
    """Lazy per-symbol data access over the on-disk store + one batched hub call."""

    def __init__(self, data_dir: str, hub_port: str | None, *, now_fn=None):
        self.dir = Path(data_dir)
        self.hub_port = hub_port
        self.now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self.quotes: dict[str, dict] = {}
        manifest = json.loads((self.dir / "manifest.json").read_text())
        self.symbols: dict[str, dict] = manifest.get("symbols") or {}
        # The typed live/eod signal data.last() already computes was being discarded. Track it
        # here so run_once() can force outcome='partial' and re-stamp source_asof to the fallback
        # vintage whenever ANY price read this run fell back to the persisted manifest EOD last
        # instead of a live hub quote.
        self.used_eod_fallback = False
        self.eod_fallback_asof: str | None = None
        # Meta-CEO ruling (PR #513 review round 4, BLOCKER): evaluation_vintage()'s rung (b)
        # falls back to the manifest's own build as_of when neither a live quote nor a
        # per-symbol manifest asof exists for the symbol/root an evaluator read. Captured once
        # at load time — never re-read per call.
        self.manifest_as_of: str | None = (
            manifest.get("as_of") if isinstance(manifest.get("as_of"), str) else None
        )

    def prime_quotes(self, syms: list[str]) -> None:
        if not self.hub_port or not syms:
            return
        try:
            q = http_json(f"http://127.0.0.1:{self.hub_port}/quotes?syms={urllib.parse.quote(','.join(syms))}", timeout=5)
            if isinstance(q, dict):
                self.quotes = q
        except Exception as e:  # hub down → manifest EOD fallback, not a failure
            log(f"quote hub unavailable ({e}); falling back to manifest EOD lasts")

    def last(self, sym: str):
        q = self.quotes.get(sym)
        if q and isinstance(q.get("last"), (int, float)):
            return float(q["last"]), "live"
        m = self.symbols.get(sym) or {}
        if isinstance(m.get("last"), (int, float)):
            self.used_eod_fallback = True
            if self.eod_fallback_asof is None and isinstance(m.get("asof"), str):
                self.eod_fallback_asof = m["asof"]
            return float(m["last"]), "eod"
        return None, None

    def evaluation_vintage(self, sym: str) -> str | None:
        """The data vintage backing this symbol/root's read, ISO-8601 UTC at minute granularity
        — the F08 id contract's third input (frozen with macro's B-F08-1b drain).

        Meta-CEO ruling on PR #513 review round 4 (BLOCKER): there is NO wall-clock rung
        anywhere in this ladder — evaluation_vintage is the vintage of the DATA the evaluator
        actually read for this alert, never the time the engine happened to run. Exactly two
        data-backed rungs, in order:

          (a) a freshness-vetted live quote's own tick timestamp (live_quote()'s existing
              session/date/age/lag gates — see below);
          (b) otherwise the EOD/manifest as-of for the symbol or option root the evaluator
              read: the manifest's PER-SYMBOL `asof` if the symbol carries one, else the
              manifest's own build-level `as_of` (Data.manifest_as_of).

        If neither rung produces a value, this returns None — the caller (run_once()) MUST
        treat that alert as UNEVALUABLE this run (no fire, no disarm, counted in the receipt):
        a fire without any data vintage has no identity to key on.

        Round-3 removed the manifest fallback entirely and substituted the run's own wall clock
        (`_minute_vintage(run_started_at)`) instead — that traded round-1 BLOCKER 1 (a
        day-stable manifest vintage silently swallowing a genuine re-fire) for a NEW pair of
        bugs the round-4 review measured: a second genuine fire on unrefreshed data mints a
        fresh id every run (never collapsing a real crash-retry), and once the macro drain
        marks a row 'deferred' a crash-retry of the SAME fire double-enqueues it. The ruling
        deletes the wall-clock rung outright: identity keys on the DATA vintage alone. A
        crash-retry over byte-identical on-disk data (rung b unchanged) collapses onto the same
        id by construction; a condition with no discoverable data vintage at all — the
        genuinely unevaluable case — no longer fires on a synthetic wall-clock stand-in.

        The live-quote rung reuses live_quote() rather than reading `asOfMs`/`ts` straight off
        the raw quote object (round-1 BLOCKER 2): the Quote Hub seeds a manifest/EOD
        PLACEHOLDER with `ts=Date.now()` and `regularSession="closed"` while waiting for a
        first current-session print — a fresh transport timestamp there is not evidence of a
        fresh quote — and live_quote()'s session/date/age/lag gates are what make its `asof` a
        genuine data-content vintage instead of wall-clock noise.

        opt_frozen_node_proximity NEVER routes through this method: its firing vintage must be
        the SAME eligible quote the evaluator accepted (nextState.lastQuoteAt), and a second
        read here could observe a different/expired quote and fall back to the EOD rung.
        """
        receipt = self.live_quote(sym)
        if receipt is not None:
            return _minute_vintage(receipt["asof"])
        m = self.symbols.get(sym) or {}
        per_symbol_asof = m.get("asof") if isinstance(m.get("asof"), str) else None
        if per_symbol_asof:
            return _minute_vintage(per_symbol_asof)
        if self.manifest_as_of:
            return _minute_vintage(self.manifest_as_of)
        return None

    def live_quote(self, sym: str) -> dict | None:
        """Return a current-session Quote-Hub spot receipt or fail closed.

        Delayed-15m quotes are admissible when their own timestamp is current; manifest/EOD
        fallback is not. Options crossing/touch alerts must never compare an EOD spot to an
        EOD structural level and call the result live. This is also the ONLY quote source the
        opt_frozen_node_proximity evaluator may read.
        """
        q = self.quotes.get(sym)
        if not isinstance(q, dict) or not _finite(q.get("last")):
            return None
        basis = str(q.get("basis") or "").upper()
        if basis not in FLOW_QUOTE_BASES:
            return None
        now = self.now_fn().astimezone(timezone.utc)
        now_et = now.astimezone(FLOW_ET)
        if now_et.weekday() >= 5 or not (FLOW_RTH_OPEN <= now_et.time() < FLOW_QUOTE_RTH_CLOSE):
            return None
        if str(q.get("marketSession") or "").lower() != "rth":
            return None
        # Quote Hub seeds a manifest/EOD placeholder with ts=Date.now(), a delayed basis,
        # and regularSession="closed" while waiting for the first current-session print.
        # A fresh transport timestamp is therefore not evidence of a fresh quote. Require
        # the publisher's actual-session receipt before a crossing/touch alert can arm.
        if str(q.get("regularSession") or "").lower() != "rth":
            return None
        if str(q.get("regularSessionDate") or "") != now_et.date().isoformat():
            return None
        observed_sec = (
            float(q["asOfMs"]) / 1000
            if _finite(q.get("asOfMs"))
            else float(q["ts"])
            if _finite(q.get("ts"))
            else None
        )
        if observed_sec is None:
            return None
        observed = datetime.fromtimestamp(observed_sec, tz=timezone.utc)
        age = (now - observed).total_seconds()
        if observed.astimezone(FLOW_ET).date() != now_et.date():
            return None
        if not (-60 <= age <= FLOW_QUOTE_MAX_AGE_SEC):
            return None
        if q.get("lagMs") is not None:
            if not _finite(q.get("lagMs")) or not (0 <= float(q["lagMs"]) <= FLOW_QUOTE_MAX_AGE_SEC * 1000):
                return None
        return {
            "spot": float(q["last"]),
            "asof": observed.isoformat().replace("+00:00", "Z"),
            "basis": basis or str(q.get("source") or "quote-hub"),
        }

    def live_spot(self, sym: str) -> float | None:
        receipt = self.live_quote(sym)
        return receipt["spot"] if receipt is not None else None

    def regime_bull(self, sym: str):
        m = self.symbols.get(sym)
        return None if m is None else bool(m.get("regimeBull"))

    def signals(self, sym: str) -> list[dict]:
        p = self.dir / f"{sym}.slice.json"
        if not p.exists():
            return []
        try:
            return ((json.loads(p.read_text()).get("indicator") or {}).get("signals")) or []
        except Exception:
            return []

    def rsi(self, sym: str):
        p = self.dir / f"{sym}.json"
        if not p.exists():
            return None
        try:
            bars = json.loads(p.read_text()).get("bars") or []
            closes = [b[4] for b in bars if isinstance(b, list) and len(b) >= 5]
            return rsi14(closes[-300:])  # 300 bars ≫ enough for Wilder convergence
        except Exception:
            return None


class Flow:
    """Options-flow accessor with the Terminal's production source law.

    Remote mode (the safe default) resolves the local Flow backend first and the public R2
    mirror second, using the exact paths in ``terminal/lib/flowSource.ts``. A malformed or
    unavailable document fails closed to ``None``; fixture files are never a production
    fallback. ``fixture_mode=True`` exists only for deterministic parity tests and the explicit
    ``--flow-fixtures`` development flag.
    """

    def __init__(
        self,
        data_dir: str,
        *,
        backend_base: str = DEFAULT_FLOW_BACKEND,
        r2_base: str = DEFAULT_FLOW_R2,
        fixture_mode: bool = False,
        fetch_json=None,
        now_fn=None,
        spot_getter=None,
    ):
        self.dir = Path(data_dir)
        self.backend_base = backend_base.rstrip("/")
        self.r2_base = r2_base.rstrip("/")
        self.fixture_mode = fixture_mode
        self.fetch_json = fetch_json or http_json
        self.now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self.spot_getter = spot_getter
        self._cache: dict[str, dict | None] = {}

    def _load(self, name: str):
        if name in self._cache:
            return self._cache[name]
        p = self.dir / name
        val = None
        if p.exists():
            try:
                val = json.loads(p.read_text())
            except Exception:
                val = None
        self._cache[name] = val
        return val

    @staticmethod
    def _root(root: str) -> str | None:
        key = str(root or "").strip().upper()
        return key if len(key) <= 12 and FLOW_ROOT_RE.fullmatch(key) else None

    @staticmethod
    def _root_doc(doc, root: str, *, schema: str | None = None) -> bool:
        if not isinstance(doc, dict):
            return False
        if schema is not None and doc.get("schema") != schema:
            return False
        return str(doc.get("root") or "").upper() == root

    @staticmethod
    def _schema_doc(doc, schema: str) -> bool:
        return isinstance(doc, dict) and doc.get("schema") == schema

    @staticmethod
    def _parse_clock(value) -> datetime | None:
        if not isinstance(value, str) or not value:
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc)

    def _intraday_fresh(self, doc) -> bool:
        if not isinstance(doc, dict):
            return False
        observed = self._parse_clock(doc.get("asof"))
        now = self.now_fn().astimezone(timezone.utc)
        if observed is None:
            return False
        age = (now - observed).total_seconds()
        now_et = now.astimezone(FLOW_ET)
        observed_et = observed.astimezone(FLOW_ET)
        if now_et.weekday() >= 5 or not (FLOW_RTH_OPEN <= now_et.time() <= FLOW_TAPE_RTH_CLOSE):
            return False
        if observed_et.date() != now_et.date() or not (-60 <= age <= FLOW_INTRADAY_MAX_AGE_SEC):
            return False
        session_date = doc.get("session_date")
        return session_date in (None, now_et.date().isoformat())

    def _eod_fresh(self, doc) -> bool:
        if not isinstance(doc, dict):
            return False
        value = doc.get("asof")
        observed_date = None
        if isinstance(value, str):
            try:
                observed_date = date.fromisoformat(value[:10])
            except ValueError:
                observed_date = None
        if observed_date is None:
            return False
        today = self.now_fn().astimezone(FLOW_ET).date()
        age_days = (today - observed_date).days
        return 0 <= age_days <= FLOW_EOD_MAX_AGE_DAYS

    def _remote(self, cache_key: str, backend_path: str, r2_key: str, validator):
        if cache_key in self._cache:
            return self._cache[cache_key]
        val = None
        urls = (
            f"{self.backend_base}{backend_path}",
            f"{self.r2_base}/{r2_key.lstrip('/')}",
        )
        for url in urls:
            try:
                candidate = self.fetch_json(
                    url,
                    headers={"User-Agent": FLOW_USER_AGENT, "Cache-Control": "no-cache"},
                    timeout=8,
                )
            except Exception:
                continue
            if validator(candidate):
                val = candidate
                break
        self._cache[cache_key] = val
        return val

    def _spot(self, root: str) -> dict | None:
        if self.spot_getter is None:
            return None
        try:
            receipt = self.spot_getter(root)
        except Exception:
            return None
        if not isinstance(receipt, dict) or not _finite(receipt.get("spot")):
            return None
        return receipt

    def gexstate(self, root: str):
        """Single-root structural state; exact-root and schema checked."""
        key = self._root(root)
        if key is None:
            return None
        if self.fixture_mode:
            specific = self._load(f"gex_state_{key}.json")
            if isinstance(specific, dict) and str(specific.get("root") or key).upper() == key:
                return specific
            fx = self._load("gexstate_fixture.json")
            if isinstance(fx, dict) and str(fx.get("root", "")).upper() == key:
                return fx
            return None
        doc = self._remote(
            f"gexstate:{key}",
            f"/api/hub/gexstate/{key}",
            f"options_structure/gex_state/{key}.json",
            lambda doc: (
                self._root_doc(doc, key, schema="options_structure.gex_state/v1")
                and self._eod_fresh(doc)
            ),
        )
        if not isinstance(doc, dict):
            return None
        return doc

    def gex(self, root: str):
        """Per-root EOD GEX payload; exact-root and schema checked."""
        key = self._root(root)
        if key is None:
            return None
        if self.fixture_mode:
            fx = self._load("gex_fixture.json")
            if isinstance(fx, dict):
                hit = fx.get(key)
                if isinstance(hit, dict):
                    return hit
            return None
        doc = self._remote(
            f"gex:{key}",
            f"/api/hub/gex/{key}",
            f"options_hub/gex/{key}.json",
            lambda doc: (
                self._root_doc(doc, key, schema="options_hub.gex/v1")
                and self._eod_fresh(doc)
            ),
        )
        if not isinstance(doc, dict):
            return None
        receipt = self._spot(key)
        return {
            **doc,
            # Preserve the publisher's settled spot_ref for structural EOD alerts such
            # as wall migration. Price-touch/cross alerts consume this separately named
            # current-session receipt and therefore fail closed when Quote-Hub cannot
            # attest a live spot.
            "live_spot": receipt.get("spot") if receipt else None,
            "live_spot_asof": receipt.get("asof") if receipt else None,
            "live_spot_basis": receipt.get("basis") if receipt else None,
        }

    def gamma_state(self, root: str):
        """Live quote crossed against the latest admissible EOD gamma-flip level."""
        if self.fixture_mode:
            return self.gexstate(root)
        gx = self.gex(root)
        if not isinstance(gx, dict):
            return None
        return {
            "root": gx.get("root"),
            "spot": gx.get("live_spot"),
            "gamma_flip": gx.get("gamma_flip"),
            "asof": gx.get("asof"),
            "spot_asof": gx.get("live_spot_asof"),
            "spot_basis": gx.get("live_spot_basis"),
        }

    def tide(self):
        if self.fixture_mode:
            fx = self._load("tide_fixture.json")
            return fx if isinstance(fx, dict) else None
        return self._remote(
            "tide",
            "/api/flow/tide",
            "live_flow/tide_current.json",
            lambda doc: self._schema_doc(doc, "live_flow.tide/v1") and self._intraday_fresh(doc),
        )

    def dte(self):
        if self.fixture_mode:
            fx = self._load("dte_fixture.json")
            return fx if isinstance(fx, dict) else None
        return self._remote(
            "dte",
            "/api/flow/dte",
            "live_flow/dte_tide_current.json",
            lambda doc: self._schema_doc(doc, "live_flow.dte_tide/v1") and self._intraday_fresh(doc),
        )

    def surface(self, root: str):
        """Latest exact-root Flow-Surface frame via idx.latest -> frame."""
        key = self._root(root)
        if key is None:
            return None
        if not self.fixture_mode:
            idx = self._remote(
                f"surface_idx:{key}",
                f"/api/flow/surface/{key}/idx",
                f"live_flow/surface/{key}/idx.json",
                lambda doc: (
                    self._root_doc(doc, key)
                    and isinstance(doc.get("stamps"), list)
                    and isinstance(doc.get("latest"), str)
                    and doc.get("latest") in doc.get("stamps")
                    and FLOW_STAMP_RE.fullmatch(doc.get("latest")) is not None
                    and self._intraday_fresh(doc)
                ),
            )
            if not isinstance(idx, dict):
                return None
            latest = idx["latest"]
            return self._remote(
                f"surface:{key}:{latest}",
                f"/api/flow/surface/{key}/{latest}",
                f"live_flow/surface/{key}/{latest}.json",
                lambda doc: (
                    self._root_doc(doc, key)
                    and isinstance(doc.get("time_steps"), list)
                    and isinstance(doc.get("grids"), dict)
                    and isinstance(doc.get("price_levels"), list)
                    and self._intraday_fresh(doc)
                ),
            )

        idx_all = self._load("surface_idx_fixture.json")
        idx = idx_all.get(key) if isinstance(idx_all, dict) else None
        if not isinstance(idx, dict):
            return None
        stamps = idx.get("stamps") if isinstance(idx.get("stamps"), list) else []
        latest = idx.get("latest")
        if not latest or not stamps:
            return None
        surf_all = self._load("surface_fixture.json")
        full = surf_all.get(key) if isinstance(surf_all, dict) else None
        if not isinstance(full, dict):
            return None
        frame_stamps = full.get("stamps") if isinstance(full.get("stamps"), list) else []
        times = full.get("time_steps") if isinstance(full.get("time_steps"), list) else []
        i = frame_stamps.index(latest) if latest in frame_stamps else -1
        upto = i + 1 if i >= 0 else len(times)
        grids_full = full.get("grids") if isinstance(full.get("grids"), dict) else {}
        grids = {m: [row[:upto] for row in g] for m, g in grids_full.items() if isinstance(g, list)}
        spot_path = full.get("spot_path") if isinstance(full.get("spot_path"), list) else None
        spot = full.get("spot")
        if spot_path and 0 <= upto - 1 < len(spot_path):
            spot = spot_path[upto - 1]
        return {
            "spot": spot,
            "price_levels": full.get("price_levels"),
            "time_steps": times[:upto],
            "grids": grids,
            "asof": full.get("asof"),
            "cadence": full.get("cadence"),
            "root": key,
            "session_date": full.get("session_date"),
        }


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(float(x))


def _as_of(asof) -> str:
    return f"as of {asof}" if asof else "as of unknown time"


def _quote_basis_label(basis) -> str:
    value = str(basis or "").upper()
    if value == "DELAYED_15M":
        return "15-minute-delayed quote"
    if value in {"LIVE", "REALTIME"}:
        return "live quote"
    return "current quote"


# The baseline must be at least this multiple of the test window before a pace can be called
# "unusual" (mirrors optionsAlerts.ts MIN_BASELINE_MULT).
MIN_BASELINE_MULT = 2
# Intervals of trailing surface history required before a hot pocket can be scored.
MIN_SURFACE_COLS = 3


def _session_slope_stats(series: list[float], window: int):
    """Slope stats for a CUMULATIVE series (ports optionsAlerts.ts sessionSlopeStats).

    Per-step deltas d[i]=series[i]-series[i-1]. The trailing `window` deltas are the TEST
    window; the deltas STRICTLY BEFORE it are the baseline. The statistic is winMean −
    baseMean, a comparison of TWO sample means, so it is judged against the standard error
    of THAT difference — base_std*sqrt(1/w + 1/base_n) — not the one-sample base_std/sqrt(w),
    which treats the baseline mean as a known constant and drops its own sampling error.
    At the minimum baseline this guard admits (base_n = 2w) that omission inflates z by
    exactly sqrt(1.5) ~ 22.5%: a "2 sigma" alert really fired at 1.63 sigma. The one-sample
    form is only the baseN -> infinity special case.

    This SE must stay byte-for-byte equivalent to optionsAlerts.ts (the TS is the source of
    truth and drives the same alerts client-side); tests/test_alerts_options.py mirrors the
    vitest expectations verbatim as the parity guard.

    z=None (with `why`) whenever it is not scoreable: too little baseline, or a flat baseline.
    """
    deltas = [series[i] - series[i - 1] for i in range(1, len(series))]
    n = len(deltas)
    if n == 0:
        return {"winMean": None, "baseMean": None, "baseStd": None, "se": None, "z": None,
                "n": 0, "w": 0, "baseN": 0, "why": "no tape"}
    w = max(1, min(int(window) or 1, n))
    base_n = max(0, n - w)
    blank = {"winMean": None, "baseMean": None, "baseStd": None, "se": None, "z": None,
             "n": n, "w": w, "baseN": base_n}
    # Min-sample guard — an honest null beats a z off a handful of samples.
    if base_n < MIN_BASELINE_MULT * w:
        return {**blank, "why": "not enough baseline before the window"}

    base = deltas[:base_n]
    win = deltas[base_n:]
    win_mean = sum(win) / w
    base_mean = sum(base) / base_n
    var = sum((d - base_mean) ** 2 for d in base) / base_n  # population
    base_std = math.sqrt(var)
    if not base_std > 0:
        return {**blank, "winMean": win_mean, "baseMean": base_mean, "baseStd": base_std,
                "why": "flat baseline"}
    # Two-sample SE of (win_mean − base_mean): base_std*sqrt(1/w + 1/base_n). The 1/base_n
    # term is the piece the old base_std/sqrt(w) form dropped (optionsAlerts.ts:215).
    se = base_std * math.sqrt(1 / w + 1 / base_n)
    return {"winMean": win_mean, "baseMean": base_mean, "baseStd": base_std, "se": se,
            "z": (win_mean - base_mean) / se, "n": n, "w": w, "baseN": base_n, "why": ""}


def _eval_gamma_flip(cond: dict, gs, prev: dict):
    """Ports evalGammaFlipCross — hysteresis dead-band, first-obs arms, fire-once per cross."""
    spot = gs.get("spot") if isinstance(gs, dict) else None
    flip = gs.get("gamma_flip") if isinstance(gs, dict) else None
    if not _finite(spot) or not _finite(flip):
        return None, None, "gamma-flip level unavailable", prev
    band = cond["band_pct"] if _finite(cond.get("band_pct")) else 0.05
    raw_side = "above" if spot >= flip else "below"
    prior = prev.get("side") if isinstance(prev.get("side"), str) else None
    beyond = flip != 0 and (abs(spot - flip) / flip) * 100 > band
    if prior is None:
        confirmed = raw_side
    elif raw_side != prior and beyond:
        confirmed = raw_side
    else:
        confirmed = prior
    nxt = {"side": confirmed}
    if prior is not None and confirmed != prior:
        root = cond.get("root") or (gs.get("root") if isinstance(gs, dict) else None) or "the underlying"
        if confirmed == "above":
            dirtxt = f"crossed above its gamma flip ({flip}) → long-gamma side"
        else:
            dirtxt = f"crossed below its gamma flip ({flip}) → short-gamma side"
        if gs.get("spot_asof"):
            note = (
                f"{root} {dirtxt} · {_quote_basis_label(gs.get('spot_basis'))} "
                f"{_as_of(gs.get('spot_asof'))}; "
                f"gamma level EOD {_as_of(gs.get('asof'))}"
            )
        else:
            note = f"{root} {dirtxt} · {_as_of(gs.get('asof'))}, intraday"
        return True, spot, note, nxt
    return False, spot, "", nxt


def _eval_wall(cond: dict, gx, prev: dict):
    """Ports evalWallProximity — fire on ENTER (false->true), first-obs arms, note says EOD."""
    # Remote GEX carries both a settled EOD spot_ref and an independently attested
    # current-session live_spot. Fixture payloads predate that split and keep spot_ref.
    spot = (gx.get("live_spot") if "live_spot" in gx else gx.get("spot_ref")) if isinstance(gx, dict) else None
    wall_side = "put" if cond.get("wall") == "put" else "call"
    wall = (gx.get("put_wall") if wall_side == "put" else gx.get("call_wall")) if isinstance(gx, dict) else None
    if not _finite(spot) or not _finite(wall) or wall == 0:
        return None, None, "wall level unavailable", prev
    within = cond["within_pct"] if _finite(cond.get("within_pct")) else 0.25
    dist_pct = (abs(spot - wall) / wall) * 100
    inside = dist_pct <= within
    prior = prev.get("inside") if isinstance(prev.get("inside"), bool) else None
    nxt = {"inside": inside}
    if inside and prior is False:
        root = cond.get("root") or (gx.get("root") if isinstance(gx, dict) else None) or "the underlying"
        if gx.get("live_spot_asof"):
            note = (
                f"{root} within {within}% of its {wall_side} wall ({wall}) — "
                f"{_quote_basis_label(gx.get('live_spot_basis'))} "
                f"{_as_of(gx.get('live_spot_asof'))}; EOD wall level {_as_of(gx.get('asof'))}"
            )
        else:
            note = f"{root} within {within}% of its {wall_side} wall ({wall}) — EOD wall level · {_as_of(gx.get('asof'))}"
        return True, spot, note, nxt
    return False, spot, "", nxt


def _eval_wall_migration(cond: dict, gx, prev: dict):
    """Ports evalWallMigration — fires when the wall RE-STRIKES (a positioning change),
    not when price touches it. Nobody in the category alerts on this (masterplan §8).

    State cond._wm = {level}. First observation ARMS (stores the wall strike, never
    fires); a later run fires when the published wall differs from the stored one by
    ≥ min_move_pct% of spot (default 0.4 — one $1 SPY strike is ~0.13%, so the default
    ignores grid jitter and catches genuine migrations). EOD-cadence data: the wall can
    only move once a night, and the state machine survives the 5-min cron between builds.
    """
    spot = gx.get("spot_ref") if isinstance(gx, dict) else None
    wall_side = "put" if cond.get("wall") == "put" else "call"
    wall = (gx.get("put_wall") if wall_side == "put" else gx.get("call_wall")) if isinstance(gx, dict) else None
    if not _finite(spot) or spot == 0 or not _finite(wall):
        return None, None, "wall level unavailable", prev
    min_move = cond["min_move_pct"] if _finite(cond.get("min_move_pct")) else 0.4
    prior = prev.get("level") if _finite(prev.get("level")) else None
    nxt = {"level": wall}
    if prior is None:
        return False, wall, "", nxt
    moved_pct = (abs(wall - prior) / spot) * 100
    if wall != prior and moved_pct >= min_move:
        root = cond.get("root") or (gx.get("root") if isinstance(gx, dict) else None) or "the underlying"
        arrow = "up" if wall > prior else "down"
        note = (f"{root} {wall_side} wall migrated {prior:g} → {wall:g} "
                f"({arrow} {moved_pct:.1f}% of spot) — positioning re-struck, EOD build · {_as_of(gx.get('asof'))}")
        return True, wall, note, nxt
    # sub-threshold jitter still updates the anchor so a slow drift cannot fire late
    return False, wall, "", nxt


def _eval_sign_fragile(cond: dict, gx, prev: dict):
    """Ports evalSignFragile — fires when the net-gamma SIGN becomes convention-fragile.

    tilt = |Σ|gamma_call| − Σ|gamma_put|| / (Σ|gamma_call| + Σ|gamma_put|) over the
    published ladder — the SAME statistic the Positioning tab's sign-robustness card and
    the Neural Web's sign_confidence render (one definition, three surfaces). Below
    tilt_pct% (default 12, the tab's fragile threshold) a small change of dealer-sign
    convention flips the regime read. State cond._sf = {fragile}: first obs arms; fires
    on the ENTER transition robust→fragile.
    """
    rows = gx.get("by_strike") if isinstance(gx, dict) else None
    if not isinstance(rows, list) or not rows:
        return None, None, "ladder unavailable", prev
    call_abs = put_abs = 0.0
    for r in rows:
        if not isinstance(r, dict):
            continue
        c, p = r.get("gamma_call"), r.get("gamma_put")
        if _finite(c):
            call_abs += abs(c)
        if _finite(p):
            put_abs += abs(p)
    total = call_abs + put_abs
    if not total > 0:
        return None, None, "no gamma in the published window", prev
    tilt_pct = (abs(call_abs - put_abs) / total) * 100
    thresh = cond["tilt_pct"] if _finite(cond.get("tilt_pct")) else 12.0
    fragile = tilt_pct < thresh
    prior = prev.get("fragile") if isinstance(prev.get("fragile"), bool) else None
    nxt = {"fragile": fragile}
    if fragile and prior is False:
        root = cond.get("root") or (gx.get("root") if isinstance(gx, dict) else None) or "the underlying"
        note = (f"{root} gamma tilt collapsed to {tilt_pct:.1f}% (< {thresh:g}%) — the long/short-gamma "
                f"read now depends on the dealer-sign assumption, EOD build · {_as_of(gx.get('asof'))}")
        return True, round(tilt_pct, 1), note, nxt
    return False, round(tilt_pct, 1), "", nxt


def _eval_opex_concentration(cond: dict, gx, prev: dict):
    """Ports evalOpexConcentration — fires when the front expiry carries ≥ share_pct% of
    gross gamma (default 35, the Neural Web's opex_window threshold).

    share = |gamma_net(front exp)| / Σ|gamma_net| over by_expiry, front = earliest
    expiration — the same arithmetic as the tab's front-expiry module and
    options_plane._expiring_share. The regime a desk reads under concentration is carried
    by contracts about to disappear. State cond._oc = {above}: first obs arms; fires on
    ENTER.
    """
    rows = gx.get("by_expiry") if isinstance(gx, dict) else None
    if not isinstance(rows, list):
        return None, None, "expiration breakdown unavailable", prev
    vals = [(str(r.get("exp") or ""), r.get("gamma_net")) for r in rows
            if isinstance(r, dict) and _finite(r.get("gamma_net"))]
    if not vals:
        return None, None, "expiration breakdown unavailable", prev
    vals.sort(key=lambda t: t[0])
    total = sum(abs(v) for _, v in vals)
    if not total > 0:
        return None, None, "no gamma in the expiration breakdown", prev
    front_exp, front_val = vals[0]
    share = (abs(front_val) / total) * 100
    thresh = cond["share_pct"] if _finite(cond.get("share_pct")) else 35.0
    above = share >= thresh
    prior = prev.get("above") if isinstance(prev.get("above"), bool) else None
    nxt = {"above": above}
    if above and prior is False:
        root = cond.get("root") or (gx.get("root") if isinstance(gx, dict) else None) or "the underlying"
        note = (f"{root} front expiry {front_exp} carries {share:.0f}% of gross gamma (≥ {thresh:g}%) — "
                f"OPEX-unwind window, today's structure rolls off at that date, EOD build · {_as_of(gx.get('asof'))}")
        return True, round(share, 1), note, nxt
    return False, round(share, 1), "", nxt


def _eval_premium_burst(cond: dict, tide, prev: dict):
    """Ports evalPremiumBurst — per-minute-delta z on the cumulative leg, fire-once per stamp.

    ONE-SIDED: only a HOT pace fires. The old two-sided abs(z) also fired on a tape that had
    gone unusually QUIET, which is the opposite of what the alert promises.
    """
    leg = "npp" if cond.get("leg") == "npp" else "ncp"
    window_min = max(1, int(cond["window_min"])) if _finite(cond.get("window_min")) else 10
    z_thresh = cond["z"] if _finite(cond.get("z")) else 2
    mins = tide.get("minutes") if isinstance(tide, dict) else None
    # Window + baseline: (1+MIN_BASELINE_MULT)*w deltas → one more sample than that.
    need = (1 + MIN_BASELINE_MULT) * window_min + 1
    if not isinstance(mins, list) or len(mins) < need:
        return None, None, "not enough tape for pace check", prev
    series = []
    for m in mins:
        v = m.get(leg) if isinstance(m, dict) else None
        if not _finite(v):
            return None, None, "not enough tape for pace check", prev
        series.append(float(v))
    stats = _session_slope_stats(series, window_min)
    z = stats["z"]
    if z is None or not math.isfinite(z):
        return None, None, stats.get("why") or "pace not scoreable", prev
    latest_t = (mins[-1].get("t") if isinstance(mins[-1], dict) else None) or ""
    fires = z >= z_thresh
    already = prev.get("lastFiredT") == latest_t
    zval = round(z, 2)
    if fires:
        nxt = {"lastFiredT": latest_t, "lastZ": zval}
    else:
        nxt = {"lastFiredT": prev.get("lastFiredT"), "lastZ": prev.get("lastZ")}
    if fires and not already:
        root = "Covered options tape"
        legw = "net-put premium" if leg == "npp" else "net-call premium"
        note = (f"{root} {legw} moving at an unusual pace (z {z:.1f}, last {window_min}m vs the "
                f"{stats['baseN']}m before it) · intraday tape {_as_of(tide.get('asof'))}")
        return True, zval, note, nxt
    return False, zval, "", nxt


def _eval_surface_pocket(cond: dict, frame, prev: dict):
    """Ports evalSurfaceHotPocket — a single strike x interval cell on the Flow-Surface that is
    running hot near spot.

    Scale = MEAN |cell| over the same near-spot strikes in the intervals STRICTLY BEFORE the
    newest one (same baseline-exclusion discipline as the premium-burst z). Tri-state null when
    there is no surface for the root, too few intervals, no strikes in the band, or a zero scale.
    """
    metric = cond.get("metric") if isinstance(cond.get("metric"), str) and cond.get("metric") else "netprem"
    k = cond["k"] if _finite(cond.get("k")) and cond["k"] > 0 else 4
    near_pct = cond["near_pct"] if _finite(cond.get("near_pct")) and cond["near_pct"] > 0 else 5
    levels = frame.get("price_levels") if isinstance(frame, dict) else None
    steps = frame.get("time_steps") if isinstance(frame, dict) else None
    grids = frame.get("grids") if isinstance(frame, dict) else None
    grid = grids.get(metric) if isinstance(grids, dict) else None
    spot = frame.get("spot") if isinstance(frame, dict) else None
    if (not isinstance(levels, list) or not isinstance(steps, list) or not isinstance(grid, list)
            or not _finite(spot) or spot <= 0):
        return None, None, "no surface for this root yet", prev
    t_last = len(steps) - 1
    if t_last < MIN_SURFACE_COLS:
        return None, None, "not enough surface history to scale", prev
    rows = [i for i, lv in enumerate(levels) if _finite(lv) and (abs(lv - spot) / spot) * 100 <= near_pct]
    if not rows:
        return None, None, "no strikes near spot on the surface", prev

    total = 0.0
    cnt = 0
    for r in rows:
        row = grid[r] if r < len(grid) else None
        if not isinstance(row, list):
            continue
        for t in range(min(t_last, len(row))):
            v = row[t]
            if _finite(v):
                total += abs(v)
                cnt += 1
    if cnt == 0 or total == 0:
        return None, None, "surface too sparse to scale", prev
    scale = total / cnt

    hot = 0.0
    hot_level = None
    for r in rows:
        row = grid[r] if r < len(grid) else None
        v = row[t_last] if isinstance(row, list) and t_last < len(row) else None
        if not _finite(v):
            continue
        if hot_level is None or abs(v) > abs(hot):
            hot, hot_level = float(v), levels[r]
    if hot_level is None:
        return None, None, "no surface reading at the latest interval", prev

    ratio = abs(hot) / scale
    stamp = steps[t_last] or ""
    fires = ratio >= k
    already = prev.get("lastFiredT") == stamp
    rval = round(ratio, 2)
    if fires:
        nxt = {"lastFiredT": stamp, "lastRatio": rval, "lastStrike": hot_level}
    else:
        nxt = {"lastFiredT": prev.get("lastFiredT"), "lastRatio": prev.get("lastRatio"),
               "lastStrike": prev.get("lastStrike")}
    if fires and not already:
        root = cond.get("root") or (frame.get("root") if isinstance(frame, dict) else None) or "the underlying"
        side = "call-side" if hot >= 0 else "put-side"
        note = (f"{root} {hot_level} strike lit up {ratio:.1f}× its usual cell on the surface "
                f"({side} net premium at {stamp}, strikes within {near_pct}% of spot) · "
                f"{_as_of(frame.get('asof'))}")
        return True, rval, note, nxt
    return False, rval, "", nxt


def _eval_0dte(cond: dict, dte, prev: dict):
    """Ports eval0dteShare — 0d share of tracked net premium at the latest common stamp. Missing
    '0d' bucket → None (honest disable, never fabricated)."""
    buckets = dte.get("buckets") if isinstance(dte, dict) else None
    if not isinstance(buckets, dict) or not isinstance(buckets.get("0d"), list):
        return None, None, "0DTE split unavailable", prev
    share_pct = cond["share_pct"] if _finite(cond.get("share_pct")) else 55
    keys = [k for k in buckets if isinstance(buckets[k], list)]
    stamp_sets = [set(r.get("t") for r in buckets[k] if isinstance(r, dict)) for k in keys]
    common = set.intersection(*stamp_sets) if stamp_sets else set()
    common.discard(None)
    if not common:
        return None, None, "0DTE split unavailable", prev
    stamp = sorted(common)[-1]

    def mag_at(rows):
        row = next((r for r in rows if isinstance(r, dict) and r.get("t") == stamp), None)
        if not row:
            return 0.0
        ncp = abs(row["ncp"]) if _finite(row.get("ncp")) else 0.0
        npp = abs(row["npp"]) if _finite(row.get("npp")) else 0.0
        return ncp + npp

    total = sum(mag_at(buckets[k]) for k in keys)
    zero_mag = mag_at(buckets["0d"])
    if total == 0:
        return None, None, "0DTE split unavailable", prev
    share = (zero_mag / total) * 100
    fires = share >= share_pct
    already = prev.get("lastFiredT") == stamp
    nxt = {"lastFiredT": stamp} if fires else {"lastFiredT": prev.get("lastFiredT")}
    if fires and not already:
        root = "Covered options tape"
        note = f"{root} 0DTE share {share:.0f}% of tracked net premium · 10-min DTE tape {_as_of(dte.get('asof'))}"
        return True, round(share, 1), note, nxt
    return False, round(share, 1), "", nxt


# ─── (f) frozen-node sampled proximity (PREPARATORY — no production caller yet) ─────
# cond {type:"opt_frozen_node_proximity", root, target, within_pct?}
#
# PREPARATORY CORE ONLY: the armed-alert route does not admit this type, no default
# admission reader exists and no UI/API allowlist entry is added. The core exists so the
# Python owner can be parity-guarded against terminal/lib/optionsAlerts.ts through the one
# shared vector file (options_frozen_node_vectors.json) before a verified reader lands.
#
# What it watches: ONE frozen options node — an exact expiry/strike/right member set bound
# to a source fingerprint at arming time. It fires when the CURRENT SESSION spot first comes
# within within_pct% of that frozen price — sampled proximity, never an exact intrabar touch
# and never a probability. The level is never re-derived, re-priced or re-ranked: a node
# frozen at 620 is judged against 620 even when today's rebuilt wall prints 630. Expiry and
# right stay EXPLICIT through members + scopeKey; observed_partial is carried verbatim, never
# upgraded to a "strongest"/"full"/"current" label.
#
# Trust law (binding — mirrors the TS contract):
#   * The admission context is a SEPARATE trusted caller argument (the out-of-band result of
#     a server-side admission reader). It is NEVER read from the condition jsonb: an
#     admission/rights/allowed key inside condition JSON grants nothing.
#   * Alerts carry own-row RLS, so row.created_at, condition._fnp and any planted admission
#     blob are NOT enrollment/prior-observation evidence — a browser or a direct DB write can
#     set them freely. The reader must INDEPENDENTLY attest the arming epoch AND the
#     priorState provenance (context.priorState: null for an attested fresh (re-)arming, or
#     the verified previous state; an ABSENT key is rejected). That authority is the reader's
#     responsibility, never a self-asserted boolean in the row. The stored condition._fnp
#     stays this evaluator's persistence OUTPUT; a future production reader must verify its
#     provenance independently before returning it.
#   * The envelope {principal, createdAt, evaluationAt} is built by THIS trusted server
#     caller from the server-side alert row plus the run's actual evaluation instant — never
#     from condition JSON. The admission must repeat the envelope's principal and createdAt
#     EXACTLY and bind the current evaluation instant; rights.allowed strictly True, nonempty
#     policy_version, checked_at equal to the actual evaluation instant; returned target
#     identity exactly equal to the requested one. This is a STRUCTURAL caller contract, not
#     cryptographic authentication — reader provenance is the trusted caller's responsibility.
#   * Clocks: availableAt <= armingEpoch <= evaluationAt, armingEpoch >= server createdAt,
#     and the qualified quote strictly after armingEpoch and no later than evaluationAt.
#     Timestamps are exact timezone-aware instants at microsecond resolution — naive stamps
#     and impossible calendar dates are rejected, microseconds preserved.
#
# State machine on cond._fnp = {targetFingerprint, armingEpoch, lastQuoteAt, inside, withinPct, lastQuoteBasis}: the
# FIRST qualifying quote for a (target, armingEpoch) binding ARMS ONLY — even when already
# inside — so pre-enrollment touches are ignored. Only a later outside→inside transition of a
# NEWER quote fires; a duplicate or out-of-order quote causes no transition and no state
# advance; a changed target or armingEpoch re-arms. Unknown/revoked context never updates
# state and never disarms (fired=None is honest, never a miss).
#
# Identity: sha256 over a canonical ordered tuple of EVERY target field with number payloads
# rendered as IEEE-754 big-endian hex (struct) and instants as UTC epoch microseconds — never
# json.dumps float text, which differs from JSON.stringify's rendering. The fingerprint is a
# STATE BINDING ONLY, not a new provenance proof; it reuses the existing
# sourceKey/inputSha256/member binding rather than replacing it.
FNP_STATE_KEY = "_fnp"
FNP_ADMITTED_ACTION = "frozen_node_proximity"
FNP_QUALIFICATION = "observed_partial"
FNP_DEFAULT_WITHIN_PCT = 0.25
_FNP_US = "\x1f"
_FNP_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
_FNP_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_FNP_INSTANT_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)"
    r"(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)
_FNP_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_FNP_STATE_KEYS = "armingEpoch,inside,lastQuoteAt,lastQuoteBasis,targetFingerprint,withinPct"


def _fnp_instant_micros(value) -> int | None:
    """Exact timezone-aware instant → UTC epoch microseconds, or None. Naive stamps and
    impossible calendar dates (Feb 30, month 13) are refused instead of being rolled forward;
    microseconds are preserved exactly."""
    if not isinstance(value, str):
        return None
    m = _FNP_INSTANT_RE.match(value)
    if not m:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None
    try:
        delta = dt.astimezone(timezone.utc) - _FNP_EPOCH
    except (ValueError, OverflowError):
        return None
    return delta.days * 86400 * 10**6 + delta.seconds * 10**6 + delta.microseconds


def _fnp_format_instant_utc(micros: int) -> str:
    """Canonical UTC rendering of epoch microseconds — the state's clock text, so both
    languages persist byte-identical state values."""
    secs, frac = divmod(int(micros), 10**6)  # floor semantics, frac >= 0
    dt = _FNP_EPOCH + timedelta(seconds=secs)
    return f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}T{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}.{frac:06d}Z"


def _fnp_finite(x) -> bool:
    # Match the finite IEEE-754 number contract without raising on huge JSON ints.
    try:
        return _finite(x)
    except (OverflowError, ValueError, TypeError):
        return False


def _fnp_source_clock_after(key, value, evaluation_at) -> bool:
    """Native date labels/null/correction references remain metadata, not instants."""
    if value is None or key in {"source_session", "oi_report_date", "oi_position_session", "correction_ref"}:
        return False
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?(Z|[+-][0-2]\d:[0-5]\d)", value)
    if not match:
        return False
    fraction = (match[2] or "").ljust(9, "0")
    micros = _fnp_instant_micros(f"{match[1]}.{fraction[:6]}{match[3]}")
    return micros is not None and micros * 1000 + int(fraction[6:]) > evaluation_at * 1000


def _fnp_positive_num(x) -> bool:
    return _fnp_finite(x) and float(x) > 0


def _fnp_f64_be_hex(x) -> str | None:
    """IEEE-754 big-endian hex of a finite double — the cross-language number payload token
    (Python struct ↔ JS DataView). Never a json.dumps/JSON.stringify float rendering."""
    if not _fnp_finite(x):
        return None
    return struct.pack(">d", float(x)).hex()


def _fnp_text(x):
    return x if isinstance(x, str) and len(x) > 0 and not any(0xD800 <= ord(c) <= 0xDFFF for c in x) else None


def _fnp_record(x):
    return x if isinstance(x, dict) else None


def _fnp_iso_date(x):
    if isinstance(x, str) and _FNP_ISO_DATE_RE.match(x):
        try:
            date.fromisoformat(x)
            return x
        except ValueError:
            return None
    return None


def _fnp_target_tokens(target) -> list[str] | None:
    """Canonical ordered token tuple for a frozen-node target — the ONE cross-language
    identity algorithm (mirrors fnpTargetTokens). Every field is validated in the same pass,
    so a target that cannot be fingerprinted is a target that cannot be evaluated."""
    t = _fnp_record(target)
    if not t or set(t) != {"availableAt", "definitionKey", "members", "price", "qualification", "root", "scopeKey", "securityId", "sourceBinding", "sourceKey", "sourceSession"}:
        return None
    root = _fnp_text(t.get("root"))
    if not root or normalize_opt_alert_root(root) != root:
        return None
    security_id = _fnp_text(t.get("securityId"))
    source_session = _fnp_text(t.get("sourceSession"))
    source_key = _fnp_text(t.get("sourceKey"))
    definition_key = _fnp_text(t.get("definitionKey"))
    scope_key = _fnp_text(t.get("scopeKey"))
    if not security_id or not source_session or not definition_key or not scope_key:
        return None
    if not source_key or not _FNP_HEX64_RE.fullmatch(source_key):
        return None
    available_at = _fnp_instant_micros(t.get("availableAt"))
    if available_at is None:
        return None
    binding = _fnp_record(t.get("sourceBinding"))
    if not binding or set(binding) != {"clocks", "inputSha256", "populationId", "sourceRef"}:
        return None
    input_sha256 = _fnp_text(binding.get("inputSha256"))
    population_id = _fnp_text(binding.get("populationId"))
    source_ref = _fnp_text(binding.get("sourceRef"))
    if not input_sha256 or not _FNP_HEX64_RE.fullmatch(input_sha256) or not population_id or not source_ref:
        return None
    clocks = _fnp_record(binding.get("clocks"))
    if not clocks:
        return None
    clock_tokens: list[str] = []
    if any(_fnp_text(key) is None for key in clocks):
        return None
    # Match JS default UTF-16 code-unit ordering, including non-BMP keys.
    for key in sorted(clocks, key=lambda key: key.encode("utf-16-be")):
        value = clocks[key]
        if value is None:
            clock_tokens.extend([key, "null"])
        elif isinstance(value, str) and (value == "" or _fnp_text(value) is not None):
            clock_tokens.extend([key, "string", value])
        else:
            return None
    price = t.get("price")
    if not _fnp_positive_num(price):
        return None
    price_token = _fnp_f64_be_hex(price)
    if price_token is None:
        return None
    raw_members = t.get("members")
    if not isinstance(raw_members, list) or len(raw_members) == 0:
        return None
    member_tokens: list[str] = []
    seen: set[str] = set()
    for raw in raw_members:
        m = _fnp_record(raw)
        if not m or set(m) != {"expiry", "right", "strike"}:
            return None
        expiry = _fnp_iso_date(m.get("expiry"))
        strike = m.get("strike")
        if not expiry or not _fnp_positive_num(strike):
            return None
        if m.get("right") not in ("C", "P"):
            return None
        # The frozen member set is exact: every strike IS the frozen price.
        if float(strike) != float(price):
            return None
        strike_token = _fnp_f64_be_hex(strike)
        if strike_token is None:
            return None
        key = f"{expiry}{_FNP_US}{m.get('right')}{_FNP_US}{strike_token}"
        if key in seen:
            return None
        seen.add(key)
        member_tokens.append(key)
    member_tokens.sort()
    if t.get("qualification") != FNP_QUALIFICATION:
        return None
    tokens = [
        "opt_frozen_node_target/v1",
        root,
        security_id,
        source_session,
        source_key,
        definition_key,
        scope_key,
        str(available_at),
        input_sha256,
        population_id,
        source_ref,
    ]
    tokens.extend(["clocks", str(len(clocks)), *clock_tokens, "members", str(len(member_tokens))])
    for mk in member_tokens:
        tokens.extend(["member", mk])
    tokens.extend(["price", price_token, FNP_QUALIFICATION])
    return tokens


def frozen_node_target_fingerprint(target) -> str | None:
    """The deterministic cross-language identity of a frozen-node target — sha256 over the
    canonical token tuple above. STATE BINDING ONLY: it keys the persisted hysteresis state
    to one exact target; it is not a provenance proof (the source's own fingerprint remains
    target.sourceKey / sourceBinding.inputSha256)."""
    tokens = _fnp_target_tokens(target)
    if tokens is None:
        return None
    # Prefix UTF-8 byte lengths so free-text delimiters cannot alias fields.
    encoded = [token.encode("utf-8") for token in tokens]
    return hashlib.sha256(b"".join(str(len(token)).encode("ascii") + b":" + token for token in encoded)).hexdigest()


def _fnp_normalize_state(x, fingerprint: str) -> dict | None:
    """Normalize/validate a persisted frozen-node state object: the exact predicate and quote state fields,
    a matching target fingerprint, boolean inside, canonical exact clocks."""
    s = _fnp_record(x)
    if not s:
        return None
    if set(s) != set(_FNP_STATE_KEYS.split(",")):
        return None
    if (s.get("targetFingerprint") != fingerprint or not isinstance(s.get("inside"), bool)
            or not _fnp_finite(s.get("withinPct")) or s["withinPct"] < 0 or not _fnp_text(s.get("lastQuoteBasis"))):
        return None
    epoch_micros = _fnp_instant_micros(s.get("armingEpoch"))
    last_quote_at = _fnp_instant_micros(s.get("lastQuoteAt"))
    if epoch_micros is None or last_quote_at is None:
        return None
    return {
        "targetFingerprint": fingerprint,
        "armingEpoch": _fnp_format_instant_utc(epoch_micros),
        "lastQuoteAt": _fnp_format_instant_utc(last_quote_at),
        "inside": s.get("inside"),
        "withinPct": float(s["withinPct"]),
        "lastQuoteBasis": s["lastQuoteBasis"],
    }


def _fnp_same_state(a, b) -> bool:
    if not isinstance(a, dict) or not isinstance(b, dict):
        return a is None and b is None
    return (
        a.get("targetFingerprint") == b.get("targetFingerprint")
        and a.get("armingEpoch") == b.get("armingEpoch")
        and a.get("lastQuoteAt") == b.get("lastQuoteAt")
        and a.get("inside") == b.get("inside")
        and a.get("withinPct") == b.get("withinPct")
        and a.get("lastQuoteBasis") == b.get("lastQuoteBasis")
    )


def _eval_frozen_node(cond: dict, envelope, admission, quote, prev_row_state=None):
    """Ports evalFrozenNodeProximity — the trusted-caller contract, not the browser payload
    contract: the server envelope, the out-of-band admission reader result and the qualified
    current-session quote all arrive as ARGUMENTS. Nothing is ever read out of `cond` except
    the target, root and threshold — a planted admission/rights/allowed blob inside condition
    JSON is inert, and so is the row's own `_fnp` (see prev_row_state).

    Returns (fired, value, note, nextState); fired=None means "cannot evaluate" — the caller
    logs and NEVER disarms, and the row state is returned unchanged."""
    row_state = prev_row_state if isinstance(prev_row_state, dict) else None

    def fail(note: str):
        return None, None, note, dict(row_state) if row_state else {}

    # ── trusted server envelope ───────────────────────────────────────────────
    env = _fnp_record(envelope)
    principal = _fnp_text(env.get("principal")) if env else None
    created_at = _fnp_instant_micros(env.get("createdAt")) if env else None
    evaluation_at = _fnp_instant_micros(env.get("evaluationAt")) if env else None
    if not env or not principal or created_at is None or evaluation_at is None:
        return fail("frozen-node server envelope unavailable")

    # ── condition: root identity, target, threshold ───────────────────────────
    if not isinstance(cond, dict) or cond.get("type") != "opt_frozen_node_proximity":
        return fail("condition is not a frozen-node proximity condition")
    root = normalize_opt_alert_root(cond.get("root"))
    if root is None:
        return fail("identity unresolved — stored underlying is not a readable options root")
    target_fingerprint = frozen_node_target_fingerprint(cond.get("target"))
    if target_fingerprint is None:
        return fail("frozen-node target unavailable or malformed")
    if cond["target"]["root"] != root:
        return fail("condition root does not match frozen-node target root")
    within_pct = cond.get("within_pct")
    if "within_pct" in cond and (not _fnp_finite(within_pct) or float(within_pct) < 0):
        return fail("frozen-node proximity threshold is not a usable percentage")
    within = float(within_pct) if _fnp_finite(within_pct) else FNP_DEFAULT_WITHIN_PCT

    # ── admission context (out-of-band reader result; NEVER from condition JSON) ──
    adm = _fnp_record(admission)
    if not adm:
        return fail("frozen-node admission unavailable")
    if adm.get("action") != FNP_ADMITTED_ACTION:
        return fail("frozen-node admission action is not recognized")
    if _fnp_text(adm.get("principal")) != principal:
        return fail("frozen-node admission principal does not match the server envelope")
    adm_created_at = _fnp_instant_micros(adm.get("createdAt"))
    adm_eval_at = _fnp_instant_micros(adm.get("evaluationAt"))
    arming_epoch = _fnp_instant_micros(adm.get("armingEpoch"))
    if adm_created_at is None or adm_eval_at is None or arming_epoch is None:
        return fail("frozen-node admission clocks are malformed")
    if adm_created_at != created_at:
        return fail("frozen-node admission does not attest the server creation instant")
    if adm_eval_at != evaluation_at:
        return fail("frozen-node admission does not bind the current evaluation instant")
    if arming_epoch < adm_created_at:
        return fail("frozen-node arming epoch precedes the server creation instant")
    # The returned target identity must equal the requested target identity exactly.
    admitted_fingerprint = frozen_node_target_fingerprint(adm.get("target"))
    if admitted_fingerprint is None or admitted_fingerprint != target_fingerprint:
        return fail("frozen-node admission target identity does not match the requested target")
    available_at = _fnp_instant_micros(adm["target"].get("availableAt"))
    if available_at is None or available_at > arming_epoch:
        return fail("frozen-node target source was not available at the arming epoch")
    if arming_epoch > evaluation_at:
        return fail("frozen-node arming epoch is after the evaluation instant")
    if any(_fnp_source_clock_after(key, value, evaluation_at)
           for key, value in adm["target"]["sourceBinding"]["clocks"].items()):
        return fail("frozen-node source clock is later than evaluation")

    rights = _fnp_record(adm.get("rights"))
    if not rights:
        return fail("frozen-node admission rights unavailable")
    if rights.get("allowed") is not True:
        return fail("frozen-node admission rights do not allow this action")
    if not _fnp_text(rights.get("policy_version")):
        return fail("frozen-node admission rights carry no policy version")
    checked_at = _fnp_instant_micros(rights.get("checked_at"))
    if checked_at is None or checked_at != evaluation_at:
        return fail("frozen-node rights were not checked at the evaluation instant")

    # ── reader-attested prior state (REQUIRED key; None = attested fresh arming) ──
    if "priorState" not in adm:
        return fail("frozen-node admission does not attest prior-state provenance")
    prior = None
    verified_prior = None
    if adm.get("priorState") is not None:
        normalized = _fnp_normalize_state(adm.get("priorState"), target_fingerprint)
        if not normalized or normalized["armingEpoch"] != _fnp_format_instant_utc(arming_epoch):
            return fail("attested prior state belongs to a different target or arming epoch")
        if _fnp_instant_micros(normalized["lastQuoteAt"]) <= arming_epoch:
            return fail("attested prior state quotes from before the arming epoch")
        if _fnp_instant_micros(normalized["lastQuoteAt"]) > evaluation_at:
            return fail("attested prior quote is later than evaluation")
        # A changed threshold re-arms the predicate; it is not a prospective entry.
        verified_prior = normalized
        prior = normalized if normalized["withinPct"] == within else None

    # ── tamper cross-check on the row's own persistence output ────────────────
    # A row state describing the SAME (target, armingEpoch) binding must agree with the
    # attested prior state, or the row was hand-edited under a live attestation. A row state
    # describing a DIFFERENT binding is stale output from before a re-arm and is ignored
    # (never an error, never an input).
    if row_state and prior:
        if (row_state.get("targetFingerprint") == target_fingerprint
                and row_state.get("armingEpoch") == prior["armingEpoch"]
                and row_state.get("withinPct") == prior["withinPct"]):
            row_normalized = _fnp_normalize_state(row_state, target_fingerprint)
            if not row_normalized or not _fnp_same_state(row_normalized, prior):
                return fail("frozen-node row state conflicts with the attested prior state")

    # ── qualified current-session quote (sampled-proximity evidence) ──────────
    q = _fnp_record(quote)
    spot = q.get("spot") if q else None
    quote_at = _fnp_instant_micros(q.get("asof")) if q else None
    basis = _fnp_text(q.get("basis")) if q else None
    if not q or not _fnp_positive_num(spot) or quote_at is None or not basis:
        return fail("no qualified current-session quote for the frozen node")
    if quote_at <= arming_epoch:
        return fail("quote is not after the arming epoch")
    if quote_at > evaluation_at:
        return fail("quote is later than the evaluation instant")
    # Threshold edits must not roll event time backward or reuse a duplicate print.
    if verified_prior and quote_at <= _fnp_instant_micros(verified_prior["lastQuoteAt"]):
        return False, float(spot), "", dict(verified_prior)


    # ── state machine ─────────────────────────────────────────────────────────
    target = cond["target"]
    price = target["price"]
    dist_pct = (abs(float(spot) - float(price)) / float(price)) * 100
    inside = dist_pct <= within
    nxt = {
        "targetFingerprint": target_fingerprint,
        "armingEpoch": _fnp_format_instant_utc(arming_epoch),
        "lastQuoteAt": _fnp_format_instant_utc(quote_at),
        "inside": inside,
        "withinPct": within,
        "lastQuoteBasis": basis,
    }

    # First qualifying quote for this binding: ARM ONLY — even when already inside — so a
    # pre-enrollment touch can never fire and an alert created near the node stays quiet.
    if prior is None:
        return False, float(spot), "", nxt

    # Duplicate or out-of-order quote: no transition, no state advance.
    if quote_at <= _fnp_instant_micros(prior["lastQuoteAt"]):
        return False, float(spot), "", dict(prior)

    if inside and prior["inside"] is False:
        has_c = any(m.get("right") == "C" for m in target["members"])
        has_p = any(m.get("right") == "P" for m in target["members"])
        side = "call/put" if (has_c and has_p) else "call" if has_c else "put"
        expiries = "/".join(sorted({m.get("expiry") for m in target["members"]}))
        basis_label = _quote_basis_label(basis)
        note = (
            f"{root} is within {within:g}% of its frozen {side} options node at "
            f"{float(price):g} (expiry {expiries}) — frozen level held at arming, not today's "
            f"rebuilt wall · sampled proximity on a {basis_label} {_as_of(q.get('asof'))}, intraday"
        )
        return True, float(spot), note, nxt
    return False, float(spot), "", nxt


def _fnp_condition_plain(cond: dict, root: str, *, zh: bool) -> str:
    """New-type user prose: exact identity stays in structured outbox fields."""
    target = cond.get("target") or {}
    price = target.get("price")
    shown_price = f"{price:g}" if _fnp_finite(price) else "?"
    session = str(target.get("sourceSession") or "unknown")
    state = cond.get(FNP_STATE_KEY) or {}
    basis = str(state.get("lastQuoteBasis") or "").upper()
    if zh:
        cadence = "15分钟延迟报价" if basis == "DELAYED_15M" else "延迟报价" if "DELAY" in basis else "当前合格报价"
        return (f"{root}的{cadence}接近我选定并固定的期权价位{shown_price}；"
                f"日期来源{session}，仅观察到部分覆盖，按离散报价判断接近，不代表盘中精确触及")
    cadence = "15-minute-delayed quote" if basis == "DELAYED_15M" else "delayed quote" if "DELAY" in basis else "qualified current quote"
    return (f"{root}'s {cadence} nears my selected frozen options price level {shown_price} "
            f"from dated source {session} (observed partial coverage; sampled proximity, no exact intrabar touch claim)")


def _evaluate_frozen_node(alert: dict, data: "Data | None", cond: dict, fn, reader, evaluation_at,
                          lifecycle_adapter=None, capture=None):
    """Compose separate lifecycle provenance and source/action context, both explicit.

    Lifecycle createdAt is this generation's server creation instant, NOT row.created_at.
    Only explicit deployment configuration may construct the reader/adapter;
    row JSON cannot supply either capability. Publication is separate and off.
    """
    row_state = cond.get(FNP_STATE_KEY) if isinstance(cond.get(FNP_STATE_KEY), dict) else None
    if reader is None:
        return None, None, "frozen-node admission reader unavailable", row_state or {}
    if not isinstance(lifecycle_adapter, FrozenNodeLifecycleAdapter):
        return None, None, "frozen-node lifecycle adapter unavailable", row_state or {}
    if not isinstance(evaluation_at, str) or not evaluation_at:
        return None, None, "frozen-node evaluation instant unavailable", row_state or {}
    try:
        # Snapshot before either injected reader can yield or mutate caller objects.
        bound_alert = json.loads(json.dumps(alert, allow_nan=False))
        cond = bound_alert.get("condition") or {}
        runtime = lifecycle_adapter.read(bound_alert, evaluation_at)
        if runtime is None:
            return None, None, "frozen-node protected lifecycle unavailable", row_state or {}
        admission = (reader.read(runtime, json.loads(json.dumps(bound_alert)), evaluation_at,
                                  source_origin=lifecycle_adapter.source_origin)
                     if isinstance(reader, FrozenNodeServiceReader)
                     else reader(json.loads(json.dumps(bound_alert)), evaluation_at))
        if not isinstance(admission, dict):
            return None, None, "frozen-node admission unavailable", row_state or {}
        admission = json.loads(json.dumps(admission, allow_nan=False))
        # Source/action reader fields cannot attest a creation epoch or prior observation.
        admission.update(createdAt=runtime.created_at, armingEpoch=runtime.arming_epoch,
                         priorState=runtime.prior_state)
    except Exception as e:
        log(f"frozen-node reader error {alert.get('symbol')} {alert.get('id')}: {e}")
        return None, None, "frozen-node protected context unavailable", row_state or {}
    envelope = {"principal": runtime.principal, "createdAt": runtime.created_at, "evaluationAt": evaluation_at}
    root = normalize_opt_alert_root(cond.get("root"))
    if root is None:
        return None, None, "identity unresolved — stored underlying is not a readable options root", row_state or {}
    quote = None
    if data is not None:
        receipt = data.live_quote(root)
        if isinstance(receipt, dict):
            quote = {"spot": receipt.get("spot"), "asof": receipt.get("asof"), "basis": receipt.get("basis")}
    # _fnp is inert legacy output here; only RPC-attested priorState enters the FSM.
    result = fn(cond, envelope, admission, quote, None)
    if capture is not None:
        capture["runtime"] = runtime
        if result[0] is True:
            capture["admission"] = json.loads(json.dumps(admission, allow_nan=False))
            capture["quote"] = json.loads(json.dumps(quote, allow_nan=False))
    return result


def _frozen_hit_envelope(runtime, state, admission, quote, *, invocation=None):
    """Installed evaluator output only; no condition-authored grant or row state."""
    condition = runtime.predicate
    root = normalize_opt_alert_root(condition.get('root'))
    if root is None or condition.get('target', {}).get('root') != root:
        raise ValueError('frozen hit root mismatch')
    vintage = _minute_vintage(state['lastQuoteAt'])
    alert = {'id': runtime.alert_id, 'condition': condition}
    receipt = {'schema': 'options.frozen_hit_receipt/v1', 'runtime': runtime_record(runtime),
        'admission': admission, 'quote': quote, 'nextState': state,
        'evaluationAt': runtime.evaluation_at, 'vintage': vintage,
        'conditionVersion': condition_version(condition), 'fireEventId': mint_fire_event_id(alert, vintage)}
    if invocation is not None:
        receipt['invocation'] = invocation
    described = {**condition, FNP_STATE_KEY: state}
    en = _condition_plain_en(described, root)
    zh = _condition_plain_zh(described, root)
    payload = {'subject': f'{root} alert: {en}', 'subject_zh': f'{root}提醒：{zh}',
        'summary_plain': f'Your alert fired: {en}.', 'summary_plain_zh': f'你的提醒已触发：{zh}。',
        'ticker': root, 'condition_plain': en, 'condition_plain_zh': zh, 'value': quote['spot'],
        'evidence_url': '/alerts', 'fired_at': runtime.evaluation_at,
        'category': 'options_exposure_node', 'requires_tier': 'essential',
        'frozen_node': {'target': condition['target'], 'within_pct': state['withinPct'],
            'quote': {'asof': state['lastQuoteAt'], 'basis': state['lastQuoteBasis']},
            'publication_receipt': receipt}}
    return json.loads(json.dumps([receipt, payload], allow_nan=False))


# Options-alert condition types that carry per-condition hysteresis state on a cond sub-key.
# The tuple is (state-key, evaluator, payload-getter). The engine persists nxt back to that
# sub-key when it changed but did NOT fire (see run_once()), so the state machine survives
# across runs. opt_frozen_node_proximity's getter is deliberately None and its payload is
# special-cased in evaluate(): the frozen-node quote may come ONLY from Data.live_quote(root)
# over the existing per-run quote cache (never Flow.gex/spot_ref/Data.last/historical bars),
# and its admission comes from the trusted reader argument — but the type is still REGISTERED
# here so the derived transient-key exclusion, per-root quote priming, root-keyed vintage
# wiring identify it consistently; its non-firing persistence alone uses protected CAS, not legacy
# evaluator.
_OPT_EVALUATORS = {
    "opt_gamma_flip": ("_fs", _eval_gamma_flip, lambda cond, flow: flow.gamma_state(normalize_opt_alert_root(cond.get("root")) or "")),
    "opt_wall_touch": ("_wp", _eval_wall, lambda cond, flow: flow.gex(normalize_opt_alert_root(cond.get("root")) or "")),
    "opt_premium_burst": ("_pb", _eval_premium_burst, lambda cond, flow: flow.tide()),
    "opt_0dte_spike": ("_zd", _eval_0dte, lambda cond, flow: flow.dte()),
    "opt_surface_pocket": ("_sp", _eval_surface_pocket, lambda cond, flow: flow.surface(normalize_opt_alert_root(cond.get("root")) or "")),
    # Market Structure Core §8 (2026-08-01). The masterplan sketched these as msc_*;
    # they ship under the opt_* prefix every existing options type already uses.
    "opt_wall_migration": ("_wm", _eval_wall_migration, lambda cond, flow: flow.gex(normalize_opt_alert_root(cond.get("root")) or "")),
    "opt_sign_fragile": ("_sf", _eval_sign_fragile, lambda cond, flow: flow.gex(normalize_opt_alert_root(cond.get("root")) or "")),
    "opt_opex_concentration": ("_oc", _eval_opex_concentration, lambda cond, flow: flow.gex(normalize_opt_alert_root(cond.get("root")) or "")),
    # Frozen-node sampled proximity — PREPARATORY (see the block comment above). Registered so
    # every engine-wide opt_* behavior applies; the production route does not admit this type.
    "opt_frozen_node_proximity": ("_fnp", _eval_frozen_node, None),
}

# Meta-CEO ruling (PR #513 review round 4, MAJOR-2): derived from _OPT_EVALUATORS' own state
# keys plus "triggered", never hand-duplicated — see the comment above condition_version().
# _fnp is excluded by this derivation, so the frozen-node state never perturbs the
# condition_version input to the fire-event id.
_CONDITION_TRANSIENT_KEYS = {"triggered"} | {state_key for state_key, _fn, _getter in _OPT_EVALUATORS.values()}


def evaluate(alert: dict, data: Data, flow: "Flow | None" = None, *,
             frozen_node_reader=None, evaluation_at=None, frozen_lifecycle_adapter=None, _frozen_capture=None):
    """Returns (fired, value, note, nextState) — fired=None means 'cannot evaluate' (missing data),
    which logs but never disarms. nextState is a dict ONLY for the stateful options types (the caller
    persists it on a non-firing change); it is None for the legacy signal/regime/price/rsi types.

    frozen_node_reader (PREPARATORY, opt_frozen_node_proximity only): the optional trusted
    source/action reader, called as reader(alert, evaluation_at). A separately injected
    frozen_lifecycle_adapter reads protected server generation/state through service RPC;
    createdAt is that generation creation time, never row.created_at. _fnp is inert output. There is deliberately
    NO default reader implementation and no wall-clock evaluation instant: without a reader (or
    without an evaluation instant) the type is an honest null, and the production route does not
    admit it at all. Legacy types never consult the reader and behave exactly as before."""
    cond = alert.get("condition") or {}
    sym = alert.get("symbol") or ""
    ctype = cond.get("type")

    if ctype in _OPT_EVALUATORS:
        state_key, fn, getter = _OPT_EVALUATORS[ctype]
        if ctype == "opt_frozen_node_proximity":
            # The frozen node needs no Flow payload: its quote comes from Data.live_quote over
            # the existing per-run cache and its admission from the trusted reader argument.
            return _evaluate_frozen_node(alert, data, cond, fn, frozen_node_reader, evaluation_at,
                                         frozen_lifecycle_adapter, _frozen_capture)
        if flow is None:
            return None, None, "flow feed unavailable", None
        if ctype not in _MARKET_WIDE_OPT and normalize_opt_alert_root(cond.get("root")) is None:
            return None, None, "identity unresolved — stored underlying is not a readable options root", None
        prev = cond.get(state_key) if isinstance(cond.get(state_key), dict) else {}
        payload = getter(cond, flow)
        return fn(cond, payload, prev)

    if ctype == "signal":
        want = BUY_TYPES if cond.get("target") == "BUY" else SELL_TYPES
        created = (alert.get("created_at") or "")[:10]
        for sig in reversed(data.signals(sym)):
            ts = str(sig.get("ts") or "")[:10]
            if ts < created:
                break  # signals are chronological; older than the alert → stop
            # HK-O1: an entry the v2 regime gate REFUSED still types BUY/REBUY (back-compat
            # for every existing reader), so a bare type check fired a live "BUY" push on a
            # setup the engine explicitly vetoed — the one place a blocked marker reached a
            # user as an instruction. Gate on the flag (and the legacy quality string).
            if sig.get("blocked") is True or str(sig.get("quality") or "") == "regime_blocked":
                continue
            if str(sig.get("type") or "").upper() in want:
                # a SELL here is the trailing structure stop, and the note says so — this text
                # is stored verbatim and rendered to the user (AlertsView renders it lang="en").
                quality = str(sig.get("quality") or "").lower()
                kind = ("STRUCTURE STOP" if sig.get("basis") == "structure_stop"
                        else "STARTER" if quality in {"block", "pending"}
                        else str(sig.get("type")))
                return True, sig.get("price"), f"{kind} signal on {ts} (strength {sig.get('strength')})", None
        return False, None, "", None

    if ctype == "regime":
        rb = data.regime_bull(sym)
        if rb is None:
            return None, None, "symbol missing from manifest", None
        return (rb is True), rb, "regime turned bullish" if rb else "", None

    if ctype == "price":
        last, basis = data.last(sym)
        if last is None:
            return None, None, "no price available", None
        v = float(cond.get("value") or 0)
        hit = last > v if cond.get("op") == "above" else last < v
        return hit, last, f"price {last} {cond.get('op')} {v} ({basis})" if hit else "", None

    if ctype == "rsi":
        r = data.rsi(sym)
        if r is None:
            return None, None, "no daily bars for RSI", None
        v = float(cond.get("value") or 0)
        hit = r < v
        return hit, round(r, 2), f"RSI(14) {r:.1f} below {v}" if hit else "", None

    return None, None, f"unknown condition type {ctype!r}", None


def run_once(
    supa: "Supa",
    data: "Data",
    now: datetime,
    run_id: str,
    *,
    lane: str = "alerts_engine",
    flow_backend: str = DEFAULT_FLOW_BACKEND,
    flow_r2: str = DEFAULT_FLOW_R2,
    flow_fixtures: bool = False,
    dry_run: bool = False,
    lane_cadence_budget_s: int = 300,
    frozen_node_reader=None,
    frozen_lifecycle_adapter=None,
    frozen_node_publisher=None,
) -> dict:
    """The real per-run body, extracted out of main() so tests drive production code directly
    (Meta-CEO ruling item 3) instead of re-deriving its arithmetic inline. Owns the two-phase
    alert_runs receipt (a 'started' row at run open, a terminal row with concluded_at/outcome
    once outputs are committed — the crash path below writes the terminal row with null counters
    + the exception's class name, then re-raises), evaluates every armed alert, fires the ones
    that hit (minting each fire_event_id from the REAL evaluation vintage, never a random one —
    id contract frozen with macro's B-F08-1b drain), and returns the receipt dict so a caller
    (main() or a test) can inspect exactly what happened.

    An alert whose outbox insert hard-errors is left ARMED (never disarmed) and counted as
    unevaluable so the next run re-evaluates and retries it — see Supa.fire()/insert_outbox. So
    is an alert whose condition hit but which has NO discoverable data vintage at all (Meta-CEO
    ruling, PR #513 review round 4, BLOCKER rung (c)) — a fire without a vintage has no identity
    to key on, so it is neither fired nor disarmed; the next run retries it once real data
    exists.

    `lane_cadence_budget_s` (MINOR-4, round 4) is the real cadence this lane runs on — passed
    through to start_run's receipt rather than a literal baked into this function body.

    `frozen_node_reader` and `frozen_lifecycle_adapter` are explicit, separate inputs for
    the preparatory frozen type. Both default unavailable; main() may explicitly assemble them. Only the
    service RPC result supplies generation creation/arming/prior-state provenance. An idle
    qualified observation persists by full predicate/generation/revision CAS. A hit remains
    deferred unless a separate explicit publisher is supplied; main()/reader opt-in supplies
    no publisher. The publisher uses the SAME protected adapter and atomic state/outbox RPC.
    Authorization is as of evaluation, not transaction-locked account revocation. A DB-exclusive
    unresolved marker in existing alert_runs precedes prepare; its private exact envelope lives
    only in the owner-scoped outbox. Unknown prepare/commit outcomes hold future invocations,
    including restarts, for explicit same-ID read-only reconciliation. Fencing is never automatic.
    The pure evaluator retains the accepted quote event time; no second/EOD quote substitutes.
    Legacy types retain their existing condition persistence, vintage and fire behavior.

    dry_run (MAJOR-1, round 4): when true, this function makes NO writes to Supabase at all —
    start_run/conclude_run are skipped (the receipt is logged instead) and the per-alert
    fire/update_condition writes are gated on `not dry_run`. The active_alerts() GET and,
    with an explicitly injected lifecycle adapter, the read-only lifecycle RPC still run.
    No state CAS, outbox or other write is performed.

    MINOR 6 (PR #513 review round 2): the try/except that writes the failure receipt wraps the
    active_alerts() fetch too, not just the evaluate/fire loop — a crash on THAT read (arguably
    the single most likely crash source: it is the first live network call the run makes) used
    to leave a 'started' row with every terminal field null forever, indistinguishable from a
    run that is still in progress.
    """
    run_started_at = now.isoformat(timespec="seconds")
    publication_enabled = (isinstance(frozen_node_publisher, FrozenNodeHitPublisher)
                           and frozen_node_publisher.lifecycle is frozen_lifecycle_adapter)
    publication_allowed = False
    if dry_run:
        log(f"[dry-run] start_run lane={lane} run_id={run_id} started_at={run_started_at} (no write)")
        run_receipted = False
    else:
        clear = not publication_enabled or supa.frozen_publication_clear(lane)
        if publication_enabled and clear:
            run_receipted = supa.start_run(lane, run_id, run_started_at, None,
                                          lane_cadence_budget_s, frozen_pending=True)
            publication_allowed = run_receipted
        else:
            run_receipted = supa.start_run(lane, run_id, run_started_at, None, lane_cadence_budget_s)

    try:
        alerts = supa.active_alerts()
        if not alerts:
            log("no armed alerts — nothing to do")
            if run_receipted:
                supa.conclude_run(lane, run_id, datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                   "success", 0, 0, 0, None)
            elif dry_run:
                # MINOR-3, Meta-CEO ruling (round 5): dry_run gates the WRITE, never the receipt
                # itself becoming unobservable — log what conclude_run would have recorded.
                log("[dry-run] conclude_run lane=%s run_id=%s outcome=success evaluated_n=0 "
                    "fired_n=0 unevaluable_n=0 (no write)" % (lane, run_id))
            return {"outcome": "success", "evaluated_n": 0, "fired_n": 0, "unevaluable_n": 0,
                    "error_class": None, "source_asof": None}

        price_syms = {
            str(a.get("symbol") or "").upper()
            for a in alerts
            if (a.get("condition") or {}).get("type") == "price"
        }
        option_syms = {
            (normalize_opt_alert_root((a.get("condition") or {}).get("root")) or "")
            for a in alerts
            if str((a.get("condition") or {}).get("type") or "").startswith("opt_")
        }
        quote_syms = sorted({
            sym for sym in price_syms | option_syms
            if sym != "MARKET" and len(sym) <= 12 and FLOW_ROOT_RE.fullmatch(sym)
        })
        data.prime_quotes(quote_syms)
        flow = Flow(
            str(data.dir),
            backend_base=flow_backend,
            r2_base=flow_r2,
            fixture_mode=flow_fixtures,
            spot_getter=data.live_quote,
        )

        fired = skipped = errored = deferred = no_vintage = 0
        unknown_commits = []
        for a in alerts:
            frozen_capture = {}
            try:
                if (a.get("condition") or {}).get("type") == "opt_frozen_node_proximity":
                    if publication_enabled and (not publication_allowed or unknown_commits):
                        deferred += 1
                        log("DEFER frozen-node — unresolved or unacknowledged publication run; no retry")
                        continue
                    # Prime quotes before taking THIS alert's trusted invocation clock.
                    # The run/receipt start can precede a legitimate primed quote.
                    clock = getattr(data, "now_fn", None)
                    frozen_now = clock() if callable(clock) else None
                    frozen_at = (frozen_now.astimezone(timezone.utc).isoformat()
                                 if isinstance(frozen_now, datetime) and frozen_now.tzinfo is not None
                                 and frozen_now.utcoffset() is not None else None)
                    hit, value, note, nxt = evaluate(
                        a, data, flow, frozen_node_reader=frozen_node_reader,
                        evaluation_at=frozen_at, frozen_lifecycle_adapter=frozen_lifecycle_adapter,
                        _frozen_capture=frozen_capture,
                    )
                else:
                    hit, value, note, nxt = evaluate(a, data, flow)
            except Exception as e:
                errored += 1
                log(f"EVAL ERROR {a.get('symbol')} {a.get('id')}: {e}")
                continue
            tag = f"{a.get('symbol')} {json.dumps((a.get('condition') or {}), separators=(',', ':'))[:80]}"
            if hit is None:
                skipped += 1
                log(f"SKIP  {tag} — {note}")
            elif hit:
                if (a.get("condition") or {}).get("type") == "opt_frozen_node_proximity":
                    if (not isinstance(frozen_node_publisher, FrozenNodeHitPublisher)
                            or frozen_node_publisher.lifecycle is not frozen_lifecycle_adapter or dry_run):
                        deferred += 1
                        log(f"DEFER {tag} — frozen-node publication unavailable; no state/fire/outbox effect")
                        continue
                    runtime = frozen_capture['runtime']
                    receipt, payload = _frozen_hit_envelope(
                        runtime, nxt, frozen_capture['admission'], frozen_capture['quote'],
                        invocation={'lane': lane, 'runId': run_id})
                    committed = frozen_node_publisher.publish(runtime, nxt, receipt, payload)
                    if committed.get('kind') == 'committed':
                        fired += 1
                        log(f"FIRE {tag} — atomic frozen-node event {receipt['fireEventId']}")
                    elif committed.get('kind') == 'already_committed':
                        log(f"ALREADY_COMMITTED {tag} — {receipt['fireEventId']}; no current-row mutation")
                    else:
                        deferred += 1
                        if committed.get('kind') == 'effect_unknown':
                            unknown_commits.append({'receipt': receipt, 'payload': payload, 'phase': committed.get('phase')})
                            log(f"EFFECT_UNKNOWN {tag} — fire_event_id={receipt['fireEventId']} run_id={run_id}; no retry")
                        else:
                            log(f"DEFER {tag} — atomic frozen-node conflict/unavailable")
                    continue
                if dry_run:
                    fired += 1
                    log(f"FIRE  {tag} — {note} [dry-run]")
                else:
                    ctype = (a.get("condition") or {}).get("type")
                    # MINOR-5 (round 4): an opt_* alert's data vintage is keyed on the
                    # CONDITION's root — the underlying the evaluator actually read — never the
                    # alert row's own `symbol` field, which can differ from it.
                    vintage_sym = (
                        (normalize_opt_alert_root((a.get("condition") or {}).get("root")) or "")
                        if ctype in _OPT_EVALUATORS
                        else str(a.get("symbol") or "").upper()
                    )
                    if ctype == "opt_frozen_node_proximity":
                        # The frozen node's firing vintage is the SAME eligible quote its
                        # evaluator accepted (nextState.lastQuoteAt), truncated by the existing
                        # _minute_vintage. Data.evaluation_vintage is deliberately NOT consulted
                        # for this type: it would re-read the quote (which may have changed or
                        # expired between evaluation and fire) and could fall back to the EOD
                        # rung — a different identity than the evidence that fired the alert.
                        last_quote_at = nxt.get("lastQuoteAt") if isinstance(nxt, dict) else None
                        vintage = (
                            _minute_vintage(last_quote_at)
                            if isinstance(last_quote_at, str)
                            and _fnp_instant_micros(last_quote_at) is not None
                            else None
                        )
                    else:
                        vintage = data.evaluation_vintage(vintage_sym)
                    if vintage is None:
                        # BLOCKER rung (c): a condition that hit but has NO discoverable data
                        # vintage anywhere has no identity to key a fire on. Never fire, never
                        # disarm — count it unevaluable so a later run (once real vintage data
                        # exists) retries it.
                        no_vintage += 1
                        log(f"NO_VINTAGE {tag} — condition met but no data vintage available; alert left armed")
                    elif supa.fire(
                            ({**a, "condition": {**a["condition"], FNP_STATE_KEY: nxt}}
                             if ctype == "opt_frozen_node_proximity" else a),
                            value, note, vintage=vintage):
                        fired += 1
                        log(f"FIRE  {tag} — {note}")
                    else:
                        # Outbox insert hard-errored (Supa.fire returned False): the alert was
                        # deliberately left armed. Count it as unevaluable so this run's receipt
                        # never claims a clean success while a fire silently failed to enqueue.
                        deferred += 1
                        log(f"DEFER {tag} — outbox insert failed; alert remains armed for re-evaluation")
            else:
                log(f"idle  {tag}")
                # Stateful options types: persist the confirmed flip-side / wall-inside flag between
                # runs (active stays true) so the hysteresis machine survives the 5-min cron. Only
                # when it actually changed — avoid a needless PATCH every run.
                ctype = (a.get("condition") or {}).get("type")
                if isinstance(nxt, dict) and ctype == "opt_frozen_node_proximity":
                    runtime = frozen_capture.get("runtime")
                    if runtime is not None and nxt != runtime.prior_state and not dry_run:
                        if not frozen_lifecycle_adapter.commit(runtime, nxt):
                            deferred += 1
                            log(f"DEFER {tag} — frozen-node state revision conflict/unavailable")
                elif isinstance(nxt, dict) and ctype in _OPT_EVALUATORS:
                    state_key = _OPT_EVALUATORS[ctype][0]
                    cur = (a.get("condition") or {}).get(state_key)
                    if cur != nxt:
                        cond = dict(a.get("condition") or {})
                        cond[state_key] = nxt
                        if not dry_run:
                            supa.update_condition(a, cond)
    except Exception as e:
        if run_receipted:
            # A crash mid-run means the counters are UNKNOWN, not zero — null is the honest "we
            # don't know", 0 would be indistinguishable from "nothing happened" in the one table
            # whose purpose is proof-of-run.
            supa.conclude_run(lane, run_id, datetime.now(timezone.utc).isoformat(timespec="seconds"),
                               "failure", None, None, None,
                               "frozen_fire_effect_unknown" if publication_enabled else type(e).__name__)
        elif dry_run:
            log("[dry-run] conclude_run lane=%s run_id=%s outcome=failure evaluated_n=None "
                "fired_n=None unevaluable_n=None error_class=%s (no write)" % (lane, run_id, type(e).__name__))
        log(f"FATAL: run crashed before completion: {e}")
        raise
    # evaluated_n and unevaluable_n must reconcile against len(alerts): a SKIP (hit is None), a
    # deferred fire (outbox insert error), and a no-vintage hit (BLOCKER rung (c)) are all
    # unevaluable, never counted as evaluated too.
    unevaluable_n = skipped + errored + deferred + no_vintage
    evaluated_n = len(alerts) - errored - skipped - deferred - no_vintage
    # A live-hub outage falls back to the persisted manifest EOD last and alerts still FIRE on
    # it — that must never be reported as a clean 'success' with no fallback trace. Force
    # 'partial' and re-stamp source_asof to the fallback vintage whenever any price read this run
    # used the eod fallback, or a deferred/no-vintage fire needs a later retry.
    fallback_asof = data.eod_fallback_asof if data.used_eod_fallback else None
    outcome = ("success" if (errored == 0 and skipped == 0 and deferred == 0 and no_vintage == 0
                              and not data.used_eod_fallback)
               else "partial")
    error_class = 'frozen_fire_effect_unknown' if unknown_commits else None if errored == 0 else "eval_error"
    if run_receipted:
        supa.conclude_run(lane, run_id, datetime.now(timezone.utc).isoformat(timespec="seconds"),
                           outcome, evaluated_n, fired, unevaluable_n,
                           error_class, source_asof=fallback_asof)
    elif dry_run:
        # MINOR-3, Meta-CEO ruling (round 5): the dry-run receipt is logged, never silently
        # dropped — this is the same outcome/evaluated_n/fired_n/unevaluable_n a real conclude_run
        # write would have recorded.
        log("[dry-run] conclude_run lane=%s run_id=%s outcome=%s evaluated_n=%s fired_n=%s "
            "unevaluable_n=%s error_class=%s (no write)"
            % (lane, run_id, outcome, evaluated_n, fired, unevaluable_n, error_class))
    # MINOR-3 (round 4): log the receipt's own unevaluable_n, not the skipped-only subcount —
    # unevaluable_n is what the receipt table actually records as "could not be evaluated".
    log(f"done: {len(alerts)} armed, {fired} fired, {unevaluable_n} unevaluable")
    result = {"outcome": outcome, "evaluated_n": evaluated_n, "fired_n": fired,
              "unevaluable_n": unevaluable_n, "error_class": error_class, "source_asof": fallback_asof}
    if unknown_commits:
        result['frozen_effect_unknown'] = unknown_commits
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="evaluate + log, but never write to Supabase")
    ap.add_argument("--env-file", default=DEFAULT_ENV)
    ap.add_argument("--data-dir", default=DEFAULT_DATA)
    ap.add_argument(
        "--flow-fixtures",
        action="store_true",
        help="development only: evaluate options conditions from committed Flow fixtures",
    )
    args = ap.parse_args()

    env = load_env(args.env_file)
    url, key = env.get("NEXT_PUBLIC_SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        log("FATAL: supabase url/key missing from env file")
        return 2

    supa = Supa(url, key)
    try:
        frozen_reader, frozen_lifecycle = assemble_frozen_node_services(
            supa, env, load_env=load_env, fingerprint=frozen_node_target_fingerprint,
            instant_micros=_fnp_instant_micros)
    except (OSError, TypeError, ValueError):
        log("FATAL: frozen options host configuration is unavailable")
        return 2
    data = Data(args.data_dir, env.get("HUB_PORT", "3100"))
    run_once(
        supa, data, datetime.now(timezone.utc), uuid.uuid4().hex,
        lane=ALERTS_LANE,
        flow_backend=env.get("FLOW_API_BASE") or DEFAULT_FLOW_BACKEND,
        flow_r2=env.get("FLOW_R2_BASE") or DEFAULT_FLOW_R2,
        flow_fixtures=args.flow_fixtures,
        dry_run=args.dry_run,
        frozen_node_reader=frozen_reader,
        frozen_lifecycle_adapter=frozen_lifecycle,
        lane_cadence_budget_s=ALERTS_LANE_CADENCE_S,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
