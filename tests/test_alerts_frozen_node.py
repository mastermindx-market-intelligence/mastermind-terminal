"""Frozen-node sampled-proximity core — parity + trust-law + run_once guard (PREPARATORY).

Feeds ingest.alerts_engine._eval_frozen_node the SAME shared vector file the vitest
(optionsFrozenNode.test.ts) feeds evalFrozenNodeProximity — options_frozen_node_vectors.json —
so the TS and Python identity algorithms and the fired tri-state/state machine cannot drift.

The run_once tests below use a SYNTHETIC trusted admission reader, a fake in-memory PostgREST
and a hand-primed per-run quote cache: no network, no Supabase, no real reader (none exists —
this core is preparatory and the armed-alert route does not admit the type).

Trust law under test: the admission context is a separate trusted caller ARGUMENT; the row's
created_at / condition._fnp / any planted admission blob are NOT enrollment or prior-observation
evidence and cannot bootstrap a transition; an absent/denied/malformed admission is an honest
null that never disarms and never updates state; the firing vintage is the SAME eligible quote
the evaluator accepted (never a second Data read, never wall clock).
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ingest.alerts_engine as ae  # noqa: E402

HERE = Path(__file__).resolve().parent


def _load_vectors() -> dict:
    return json.loads((ROOT / "tests" / "fixtures" / "options_frozen_node_vectors.json").read_text())


V = _load_vectors()

SRC_KEY = "3f" * 32
INPUT_SHA = "ab" * 32
ARMING = "2026-09-08T13:30:00Z"          # 09:30 ET open
CREATED = "2026-09-08T13:25:00+00:00"    # the server row's created_at (envelope input)
ARMING_CANON = "2026-09-08T13:30:00.000000Z"
NOW = datetime(2026, 9, 8, 14, 0, 0, tzinfo=timezone.utc)   # 10:00 ET Tuesday, inside RTH
EVAL_AT = NOW.isoformat(timespec="seconds")                  # 2026-09-08T14:00:00+00:00


def _target(price=620.0, **over) -> dict:
    t = {
        "root": "SPY",
        "securityId": "sec-8f2c1",
        "sourceSession": "sess-2026-09-08-a",
        "sourceKey": SRC_KEY,
        "definitionKey": "defn.frozen-node/v1",
        "scopeKey": "lens:atm-0dte",
        "availableAt": "2026-09-08T13:15:00Z",
        "sourceBinding": {
            "inputSha256": INPUT_SHA,
            "populationId": "pop.opt.spy",
            "sourceRef": "flow/snapshots/2026-09-08T1315Z",
            "clocks": {"build": "2026-09-08T09:15:00-04:00", "ingest": "2026-09-08T13:20:30.500000Z"},
        },
        "members": [
            {"expiry": "2026-09-18", "strike": price, "right": "C"},
            {"expiry": "2026-09-18", "strike": price, "right": "P"},
        ],
        "price": price,
        "qualification": "observed_partial",
    }
    t.update(over)
    return t


TARGET = _target()
FP = ae.frozen_node_target_fingerprint(TARGET)
assert FP, "the shared sample target must be fingerprintable"


def _cond(**over) -> dict:
    c = {"type": "opt_frozen_node_proximity", "root": "SPY", "target": _target()}
    c.update(over)
    return c


def _fnp_state(last_quote_at="2026-09-08T13:45:00.000000Z", inside=False, fp=FP,
               arming=ARMING_CANON) -> dict:
    return {"targetFingerprint": fp, "armingEpoch": arming, "lastQuoteAt": last_quote_at,
            "inside": inside, "withinPct": .25, "lastQuoteBasis": "DELAYED_15M"}


def _reader(prior_state, captures=None, *, allowed=True, policy_version="frozen-node-admission/2026-09"):
    """Synthetic trusted admission reader — receives the FULL server alert envelope plus the
    evaluation instant, exactly as a real reader would. Returned context is caller-controlled."""
    def reader(alert, evaluation_at):
        if captures is not None:
            captures.append((alert, evaluation_at))
        return {
            "principal": str(alert.get("user_id") or ""),
            "createdAt": str(alert.get("created_at") or ""),
            "armingEpoch": ARMING,
            "evaluationAt": str(evaluation_at),
            "action": "frozen_node_proximity",
            "target": _target(),
            "rights": {"allowed": allowed, "policy_version": policy_version,
                        "checked_at": str(evaluation_at)},
            "priorState": prior_state,
        }
    return reader


def _rth_quote(spot=620.0, minutes_ago=15):
    """A Quote-Hub receipt that passes Data.live_quote's RTH/date/basis/lag gates."""
    observed = NOW - timedelta(minutes=minutes_ago)
    return {
        "last": spot,
        "asOfMs": int(observed.timestamp() * 1000),
        "lagMs": minutes_ago * 60 * 1000,
        "basis": "DELAYED_15M",
        "marketSession": "rth",
        "regularSession": "rth",
        "regularSessionDate": "2026-09-08",
    }


def _manifest(tmp_path: Path) -> Path:
    (tmp_path / "manifest.json").write_text(json.dumps({"symbols": {"SPY": {}}}))
    return tmp_path


# ─── shared-vector parity (same JSON the vitest consumes) ─────────────────────


def test_number_payloads_render_as_big_endian_hex():
    for v in V["numbers"]:
        assert ae._fnp_f64_be_hex(v["value"]) == v["beHex"]


def test_exact_instants_round_trip_to_utc_micros():
    for i in V["instants"]:
        micros = ae._fnp_instant_micros(i["input"])
        assert micros is not None and str(micros) == i["micros"], i["input"]
        assert ae._fnp_format_instant_utc(micros) == i["canonicalUtc"], i["input"]


def test_naive_and_impossible_clocks_are_refused():
    for bad in V["instantRejections"]:
        assert ae._fnp_instant_micros(bad) is None, repr(bad)


def test_target_fingerprints_match_the_shared_vectors():
    for t in V["targetVectors"]:
        assert ae.frozen_node_target_fingerprint(t["target"]) == t["fingerprint"], t["name"]


def test_malformed_targets_are_never_fingerprintable():
    for t in V["invalidTargets"]:
        assert ae.frozen_node_target_fingerprint(t["target"]) is None, t["name"]


def test_truth_table_matches_the_shared_vectors_case_for_case():
    for c in V["cases"]:
        fired, value, note, nxt = ae._eval_frozen_node(
            c["cond"], c["envelope"], c["admission"], c["quote"], c["prevState"])
        exp = c["expected"]
        tag = f"{c['name']}: note={note}"
        assert (fired is None) == (exp["fired"] is None), tag
        assert fired == exp["fired"], tag
        assert value == exp["value"], tag
        assert nxt == exp["nextState"], f"{c['name']}: {nxt!r} != {exp['nextState']!r}"
        if exp["fired"] is True:
            for inc in exp["noteIncludes"]:
                assert inc in note, f"{c['name']}: {inc!r} missing from {note!r}"
            for exc in exp["noteExcludes"]:
                assert exc not in note, f"{c['name']}: {exc!r} must not appear in {note!r}"
            low = note.lower()
            for banned in ("signal", "buy", "sell", "validated", "strongest"):
                assert banned not in low, f"{c['name']}: banned {banned!r} in {note!r}"
        if exp["fired"] is None:
            assert note, c["name"]


# ─── unit laws the JSON cannot carry ──────────────────────────────────────────


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), -0.5])
def test_non_finite_or_negative_thresholds_are_rejected(bad):
    fired, _v, note, _n = ae._eval_frozen_node(
        _cond(within_pct=bad),
        {"principal": "user-42", "createdAt": CREATED, "evaluationAt": EVAL_AT},
        None, None, None)
    assert fired is None
    assert "threshold" in note


def test_null_result_says_why_and_preserves_the_row_state():
    row = _fnp_state()
    fired, value, note, nxt = ae._eval_frozen_node(
        _cond(), {"principal": "user-42", "createdAt": CREATED, "evaluationAt": EVAL_AT},
        None, {"spot": 620.0, "asof": "2026-09-08T13:45:00Z", "basis": "DELAYED_15M"}, row)
    assert fired is None and value is None
    assert note
    assert nxt == row  # unchanged, never disarmed, never advanced


def test_constants_are_documented_shapes():
    assert ae.FNP_STATE_KEY == "_fnp"
    assert ae.FNP_ADMITTED_ACTION == "frozen_node_proximity"
    assert ae.FNP_QUALIFICATION == "observed_partial"
    assert ae.FNP_DEFAULT_WITHIN_PCT == 0.25


def test_identity_is_offset_insensitive_for_the_same_instant():
    shifted = _target(availableAt="2026-09-08T09:15:00-04:00")
    assert ae.frozen_node_target_fingerprint(shifted) == FP


# ─── run_once integration: synthetic reader + fake PostgREST, no I/O ──────────


class _FakeRest:
    """In-memory PostgREST: alerts rows, alert_runs receipts, alert_outbox inserts."""

    def __init__(self, alerts):
        self.alerts = {a["id"]: dict(a) for a in alerts}
        self.outbox = []
        self.runs = []
        self.calls = []

    def get(self, url):
        self.calls.append(("GET", url, None))
        if "/alerts?active=eq.true" in url:
            return 200, [a for a in self.alerts.values() if a.get("active", True)], "[...]"
        raise AssertionError(url)

    def post(self, url, body):
        self.calls.append(("POST", url, body))
        if "/alert_outbox" in url:
            if any(r["fire_event_id"] == body["fire_event_id"] for r in self.outbox):
                return 200, [], "[]"
            self.outbox.append(dict(body))
            return 201, [dict(body)], "[...]"
        if "/alert_runs" in url:
            self.runs.append(dict(body))
            return 201, None, ""
        raise AssertionError(url)

    def patch(self, url, body):
        self.calls.append(("PATCH", url, body))
        if "/alert_runs" in url:
            for r in self.runs:
                r.update(body)
            return 204, None, ""
        if "/alerts?id=eq." in url:
            for aid, row in self.alerts.items():
                if f"id=eq.{aid}&" in url:
                    row.update(body)
            return 204, None, ""
        raise AssertionError(url)


def _patch_http(monkeypatch, fake):
    def status(url, headers=None, method="GET", body=None, timeout=15):
        if method == "GET":
            return fake.get(url)
        if method == "POST":
            return fake.post(url, body)
        if method == "PATCH":
            return fake.patch(url, body)
        raise AssertionError((method, url))

    def plain(url, headers=None, method="GET", body=None, timeout=15):
        _status, parsed, _text = status(url, headers, method, body, timeout)
        return parsed

    monkeypatch.setattr(ae, "http_json_status", status)
    monkeypatch.setattr(ae, "http_json", plain)


def _alert(condition=None):
    return {
        "id": "fnp-1", "user_id": "user-42", "symbol": "SPY", "active": True,
        "created_at": CREATED,
        "condition": condition if condition is not None else _cond(),
    }


def _engine(tmp_path, monkeypatch, alert, quote=None, now=NOW):
    """Manifest + Data with a hand-primed per-run quote cache + fake REST."""
    _manifest(tmp_path)
    fake = _FakeRest([alert])
    _patch_http(monkeypatch, fake)
    data = ae.Data(str(tmp_path), None, now_fn=lambda: now)
    if quote is not None:
        data.quotes = {"SPY": dict(quote)}
    return fake, data


def _receipt(monkeypatch, fake, data, reader):
    return ae.run_once(
        ae.Supa("https://x.example.co", "k"), data, NOW, "r1",
        frozen_node_reader=reader,
    )


def test_first_eligible_quote_arms_only_and_persists_state(tmp_path, monkeypatch):
    """Pre-enrollment touches are ignored: the alert was created with spot already AT the
    frozen level, and the first attested quote must ARM (no fire, no disarm) while persisting
    the hysteresis state through the existing update_condition path."""
    fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=_rth_quote(620.0))
    receipt = _receipt(monkeypatch, fake, data, _reader(None))

    assert receipt["fired_n"] == 0
    assert receipt["evaluated_n"] == 1
    assert receipt["outcome"] == "success"
    assert fake.outbox == []
    assert fake.alerts["fnp-1"]["active"] is True  # never disarmed
    stored = fake.alerts["fnp-1"]["condition"]["_fnp"]
    assert stored == _fnp_state(inside=True)
    assert stored["armingEpoch"] == ARMING_CANON
    assert stored["lastQuoteAt"] == "2026-09-08T13:45:00.000000Z"


def test_reader_receives_the_full_envelope_and_evaluation_instant(tmp_path, monkeypatch):
    captures = []
    fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=_rth_quote(620.0))
    _receipt(monkeypatch, fake, data, _reader(None, captures))

    alert, evaluation_at = captures[0]
    assert alert["id"] == "fnp-1"
    assert alert["user_id"] == "user-42"
    assert alert["symbol"] == "SPY"
    assert "condition" in alert  # the FULL row, never just the browser condition
    assert evaluation_at == EVAL_AT


def test_prospective_outside_inside_fires_once_through_the_existing_outbox_path(tmp_path, monkeypatch):
    """Run 1 arms outside; run 2's NEWER quote enters the band -> exactly one fire through the
    existing mint_fire_event_id + alert_outbox + one-shot disarm pathway."""
    fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=_rth_quote(630.0))
    _receipt(monkeypatch, fake, data, _reader(None))
    stored = fake.alerts["fnp-1"]["condition"]["_fnp"]
    assert stored["inside"] is False
    assert fake.alerts["fnp-1"]["active"] is True

    # Run 2: a newer qualified quote moves INSIDE the band; the reader attests the verified
    # previous state provenance (null would be a fresh re-arming, which must not fire).
    newer = _rth_quote(620.0, minutes_ago=0.5)
    fake2 = _FakeRest([fake.alerts["fnp-1"]])
    _patch_http(monkeypatch, fake2)
    data2 = ae.Data(str(tmp_path), None, now_fn=lambda: NOW)
    data2.quotes = {"SPY": newer}
    receipt2 = ae.run_once(
        ae.Supa("https://x.example.co", "k"), data2, NOW, "r2",
        frozen_node_reader=_reader(_fnp_state(inside=False)),
    )

    assert receipt2["fired_n"] == 1
    assert len(fake2.outbox) == 1
    row = fake2.outbox[0]
    assert row["status"] == "pending"
    assert row["fire_event_id"] == ae.mint_fire_event_id(
        fake2.alerts["fnp-1"], ae._minute_vintage("2026-09-08T13:59:30Z"))
    assert fake2.alerts["fnp-1"]["active"] is False  # one-shot disarm, unchanged semantics
    payload = row["payload"]
    low = (payload["condition_plain"] + " " + payload["summary_plain"]).lower()
    for banned in ("gamma", "signal", "buy", "sell", "strongest", "frozen node"):
        assert banned not in low, banned
    assert "selected frozen options price level 620" in payload["condition_plain"]
    assert payload["category"] == "options_exposure_node"
    assert payload["requires_tier"] == "essential"
    assert payload["frozen_node"]["target"] == _target()
    assert payload["frozen_node"]["quote"] == {
        "asof": "2026-09-08T13:59:30.000000Z", "basis": "DELAYED_15M"}
    assert payload["frozen_node"]["within_pct"] == .25
    assert all(word in low for word in ("dated", "partial", "sampled", "15-minute-delayed"))
    assert SRC_KEY not in low and INPUT_SHA not in low
    assert payload["condition_plain_zh"]
    assert payload["value"] == 620.0  # the observed reading rides the payload's value field
    assert "620" in payload["condition_plain"]  # the selected target is part of the condition


def test_fire_vintage_is_the_accepted_quote_with_no_second_read(tmp_path, monkeypatch):
    """The firing vintage comes from nextState.lastQuoteAt (the SAME eligible quote the
    evaluator accepted). The quote getter is read exactly once per evaluation; even though a
    second read would return an EOD-shaped receipt that Data.live_quote withholds, there IS
    no second read — and Data.evaluation_vintage (which can fall back to EOD) is never
    consulted for this type. Legacy engine law preserved: the id triple is unchanged."""
    fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=_rth_quote(630.0))
    _receipt(monkeypatch, fake, data, _reader(None))

    fake2 = _FakeRest([fake.alerts["fnp-1"]])
    _patch_http(monkeypatch, fake2)
    data2 = ae.Data(str(tmp_path), None, now_fn=lambda: NOW)
    data2.quotes = {"SPY": _rth_quote(620.0, minutes_ago=0.5)}

    reads = []
    real_live_quote = data2.live_quote
    expired_receipt = {
        "last": 620.0, "ts": (NOW - timedelta(minutes=45)).timestamp() * 1000,
        "basis": "EOD",  # would be withheld if a second read ever happened
    }

    def flaky_live_quote(sym):
        reads.append(sym)
        return real_live_quote(sym) if len(reads) == 1 else expired_receipt

    vintage_calls = []

    def spy_vintage(sym):
        vintage_calls.append(sym)
        return "2026-09-08T13:00Z"

    monkeypatch.setattr(data2, "live_quote", flaky_live_quote)
    monkeypatch.setattr(data2, "evaluation_vintage", spy_vintage)

    receipt = ae.run_once(
        ae.Supa("https://x.example.co", "k"), data2, NOW, "r3",
        frozen_node_reader=_reader(_fnp_state(inside=False)),
    )

    assert receipt["fired_n"] == 1
    assert reads == ["SPY"]  # exactly one quote read: the one the evaluator accepted
    assert vintage_calls == []  # the EOD-capable ladder is never consulted for this type
    assert fake2.outbox[0]["fire_event_id"] == ae.mint_fire_event_id(
        fake2.alerts["fnp-1"], ae._minute_vintage("2026-09-08T13:59:30Z"))


def test_eod_and_seeded_quotes_are_withheld_by_live_quote(tmp_path, monkeypatch):
    """Data.live_quote's session/date/basis/lag gates fail closed: a manifest/EOD placeholder
    (regularSession=closed, ts=now, EOD basis) is never sampled-proximity evidence."""
    for withheld in (
        {"last": 620.0, "ts": NOW.timestamp(), "basis": "EOD",
         "marketSession": "rth", "regularSession": "rth", "regularSessionDate": "2026-09-08"},
        {"last": 620.0, "ts": NOW.timestamp(), "basis": "DELAYED_15M",
         "marketSession": "rth", "regularSession": "closed", "regularSessionDate": "2026-09-08"},
        {"last": 620.0, "ts": NOW.timestamp(), "basis": "DELAYED_15M",
         "marketSession": "post", "regularSession": "rth", "regularSessionDate": "2026-09-08"},
        {"last": 620.0, "ts": (NOW - timedelta(minutes=45)).timestamp(),
         "basis": "DELAYED_15M", "marketSession": "rth", "regularSession": "rth",
         "regularSessionDate": "2026-09-08"},
    ):
        fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=withheld)
        receipt = _receipt(monkeypatch, fake, data, _reader(None))
        assert data.live_quote("SPY") is None
        assert receipt["fired_n"] == 0
        assert receipt["evaluated_n"] == 0
        assert receipt["unevaluable_n"] == 1  # honest SKIP
        assert fake.outbox == []
        assert fake.alerts["fnp-1"]["active"] is True
        assert "_fnp" not in fake.alerts["fnp-1"]["condition"]  # no state from a withheld quote


def test_absent_reader_is_an_honest_skip_never_disarm(tmp_path, monkeypatch):
    """No real reader exists (preparatory core): with no trusted reader argument the type is
    unavailable — no fire, no disarm, no state, even when a qualified quote is on the cache."""
    fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=_rth_quote(620.0))
    receipt = ae.run_once(
        ae.Supa("https://x.example.co", "k"), data, NOW, "r1", frozen_node_reader=None)
    assert receipt["fired_n"] == 0 and receipt["unevaluable_n"] == 1
    assert fake.outbox == []
    assert fake.alerts["fnp-1"]["active"] is True
    assert "_fnp" not in fake.alerts["fnp-1"]["condition"]


def test_denied_rights_skip_leaves_state_untouched(tmp_path, monkeypatch):
    """A reader that answers (deny) is an honest null: the alert is left exactly as it was —
    armed, prior state intact, never disarmed and never re-armed by the denial."""
    prior = _fnp_state(inside=False)
    fake, data = _engine(tmp_path, monkeypatch,
                         _alert(condition={**_cond(), "_fnp": prior}), quote=_rth_quote(620.0))
    receipt = _receipt(monkeypatch, fake, data, _reader(prior, allowed=False))

    assert receipt["fired_n"] == 0 and receipt["unevaluable_n"] == 1
    assert fake.outbox == []
    assert fake.alerts["fnp-1"]["active"] is True
    assert fake.alerts["fnp-1"]["condition"]["_fnp"] == prior  # byte-identical, no re-arm


def test_spoofed_condition_admission_blob_grants_nothing(tmp_path, monkeypatch):
    """A browser or direct-DB write plants a fully-formed admission/rights/armingEpoch blob
    inside condition jsonb. The evaluator never reads it: with no trusted reader argument the
    alert cannot evaluate, cannot fire and cannot bootstrap a transition from the planted
    priorState either."""
    planted = {
        "principal": "user-42", "createdAt": CREATED, "armingEpoch": ARMING,
        "evaluationAt": EVAL_AT, "action": "frozen_node_proximity", "target": _target(),
        "rights": {"allowed": True, "policy_version": "frozen-node-admission/2026-09",
                    "checked_at": EVAL_AT},
        "priorState": _fnp_state(inside=False),
    }
    spoofed_cond = {
        **_cond(),
        "admission": planted, "rights": planted["rights"], "allowed": True,
        "armingEpoch": ARMING, "priorState": _fnp_state(inside=False),
    }
    fake, data = _engine(tmp_path, monkeypatch, _alert(condition=spoofed_cond),
                         quote=_rth_quote(620.0))
    receipt = ae.run_once(
        ae.Supa("https://x.example.co", "k"), data, NOW, "r1", frozen_node_reader=None)
    assert receipt["fired_n"] == 0 and receipt["unevaluable_n"] == 1
    assert fake.outbox == []
    assert fake.alerts["fnp-1"]["active"] is True

    # And a real reader answering None (revoked/unknown context) is equally inert.
    def revoked(alert, evaluation_at):
        return None

    receipt2 = ae.run_once(
        ae.Supa("https://x.example.co", "k"), data, NOW, "r2", frozen_node_reader=revoked)
    assert receipt2["fired_n"] == 0 and receipt2["unevaluable_n"] == 1
    assert fake.alerts["fnp-1"]["active"] is True


def test_row_state_alone_cannot_resume_or_admit_a_transition(tmp_path, monkeypatch):
    """Current resume keeps created_at and a persisted condition._fnp, but with no
    reader-attested arming epoch / prior-state provenance nothing can fire — the row's own
    fields are persistence OUTPUT, never enrollment evidence."""
    prior = _fnp_state(inside=False)
    fake, data = _engine(tmp_path, monkeypatch,
                         _alert(condition={**_cond(), "_fnp": prior}), quote=_rth_quote(620.0))
    receipt = ae.run_once(
        ae.Supa("https://x.example.co", "k"), data, NOW, "r1", frozen_node_reader=None)
    assert receipt["fired_n"] == 0
    assert fake.outbox == []
    row = fake.alerts["fnp-1"]
    assert row["active"] is True
    assert row["created_at"] == CREATED  # untouched
    assert row["condition"]["_fnp"] == prior  # untouched, never advanced by the row's own claim


def test_transient_state_is_excluded_from_the_condition_version(tmp_path, monkeypatch):
    """_fnp rides _OPT_EVALUATORS' derived transient-key exclusion: the fire-event id input is
    stable across arming state and only moves when the user edits the condition."""
    assert "_fnp" in ae._CONDITION_TRANSIENT_KEYS
    assert ae._OPT_EVALUATORS["opt_frozen_node_proximity"][0] == "_fnp"
    base = _cond()
    with_state = {**base, "_fnp": _fnp_state(inside=True)}
    with_trigger = {**with_state, "triggered": {"at": "x", "value": 1, "note": "n"}}
    assert ae.condition_version(base) == ae.condition_version(with_state)
    assert ae.condition_version(base) == ae.condition_version(with_trigger)
    edited = {**base, "target": _target(price=630.0)}
    assert ae.condition_version(edited) != ae.condition_version(base)
    assert ae.condition_version({**base, "within_pct": 0.5}) != ae.condition_version(base)


def test_quote_priming_and_registry_wiring_are_preserved(tmp_path, monkeypatch):
    """The type is registered in _OPT_EVALUATORS, so the engine treats it like every other
    stateful options type: the condition root is quote-primed and the root keys the wiring."""
    assert "opt_frozen_node_proximity" in ae._OPT_EVALUATORS
    spy = {}
    real_prime = ae.Data.prime_quotes

    def spy_prime(self, syms):
        spy["syms"] = list(syms)
        return real_prime(self, syms)

    monkeypatch.setattr(ae.Data, "prime_quotes", spy_prime)
    fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=_rth_quote(620.0))
    _receipt(monkeypatch, fake, data, _reader(None))
    assert spy["syms"] == ["SPY"]  # the CONDITION root was primed, not the row symbol


def test_missing_resume_arming_epoch_is_unavailable(tmp_path, monkeypatch):
    """A reader result without an attested arming epoch (the 'resume' case: row created_at and
    state exist, resolver provided nothing) is unavailable — no fire, no state advance."""
    def reader_without_epoch(alert, evaluation_at):
        ctx = dict(_reader(_fnp_state(inside=False))(alert, evaluation_at))
        ctx.pop("armingEpoch")
        return ctx

    fake, data = _engine(tmp_path, monkeypatch,
                         _alert(condition={**_cond(), "_fnp": _fnp_state(inside=False)}),
                         quote=_rth_quote(620.0))
    receipt = _receipt(monkeypatch, fake, data, reader_without_epoch)
    assert receipt["fired_n"] == 0 and receipt["unevaluable_n"] == 1
    assert fake.outbox == []
    assert fake.alerts["fnp-1"]["active"] is True


def test_plain_language_condition_text_en_and_zh():
    cond = _cond()
    en = ae._condition_plain_en(cond, "SPY")
    zh = ae._condition_plain_zh(cond, "SPY")
    assert "SPY" in en and "options price level" in en
    assert "期权" in zh
    low = en.lower()
    for banned in ("gamma", "signal", "buy", "sell", "strongest", "fingerprint"):
        assert banned not in low, banned
    # describes the WATCHED condition, never a fired reading
    assert "620" in en and "620" in zh
    assert "dated" in en and "partial" in en and "sampled" in en


def test_fire_note_discloses_the_delayed_basis(tmp_path, monkeypatch):
    """Delayed-basis disclosure is retained in the evaluator note, with the accepted quote's
    exact as-of and the frozen (not rebuilt) level — plus the sampled-proximity honesty."""
    envelope = {"principal": "user-42", "createdAt": CREATED, "evaluationAt": EVAL_AT}
    admission = _reader(_fnp_state(inside=False))(
        {"user_id": "user-42", "created_at": CREATED}, EVAL_AT)
    fired, value, note, _n = ae._eval_frozen_node(
        _cond(), envelope, admission,
        {"spot": 620.0, "asof": "2026-09-08T13:59:30Z", "basis": "DELAYED_15M"},
        _fnp_state(inside=False))
    assert fired is True and value == 620.0
    assert "15-minute-delayed quote" in note
    assert "as of 2026-09-08T13:59:30Z" in note
    assert "intraday" in note
    assert "620" in note and "630" not in note
    assert "sampled proximity" in note
    assert "2026-09-18" in note  # the expiry stays explicit
    for banned in ("signal", "buy", "sell", "validated", "strongest"):
        assert banned not in note.lower()


# Principal counterexamples against the retained worker return.
def test_condition_root_must_match_the_frozen_target_root():
    prior = _fnp_state(inside=False)
    ctx = _reader(prior)({"user_id": "user-42", "created_at": CREATED}, EVAL_AT)
    hit, value, note, state = ae._eval_frozen_node(
        _cond(root="QQQ"), {"principal": "user-42", "createdAt": CREATED, "evaluationAt": EVAL_AT},
        ctx, {"spot": 620, "asof": "2026-09-08T13:59:30Z", "basis": "DELAYED_15M"}, prior)
    assert hit is None and value is None
    assert "root" in note
    assert state == prior


def test_free_text_cannot_alias_a_different_definition_or_lens():
    left = _target(definitionKey="a\x1fb", scopeKey="c")
    right = _target(definitionKey="a", scopeKey="b\x1fc")
    assert ae.frozen_node_target_fingerprint(left) != ae.frozen_node_target_fingerprint(right)


def test_threshold_edit_rearms_instead_of_reusing_old_proximity_state():
    prior = _fnp_state(inside=False)
    ctx = _reader(prior)({"user_id": "user-42", "created_at": CREATED}, EVAL_AT)
    hit, value, note, state = ae._eval_frozen_node(
        _cond(within_pct=.5), {"principal": "user-42", "createdAt": CREATED, "evaluationAt": EVAL_AT},
        ctx, {"spot": 620, "asof": "2026-09-08T13:59:30Z", "basis": "DELAYED_15M"}, prior)
    assert hit is False and value == 620
    assert state["withinPct"] == .5 and state["inside"] is True


def test_future_attested_previous_quote_is_unavailable():
    prior = _fnp_state(last_quote_at="2026-09-08T14:01:00Z", inside=False)
    ctx = _reader(prior)({"user_id": "user-42", "created_at": CREATED}, EVAL_AT)
    hit, value, note, state = ae._eval_frozen_node(
        _cond(), {"principal": "user-42", "createdAt": CREATED, "evaluationAt": EVAL_AT},
        ctx, {"spot": 620, "asof": "2026-09-08T13:59:30Z", "basis": "DELAYED_15M"}, prior)
    assert hit is None and value is None
    assert state == prior


@pytest.mark.parametrize("field", ["price", "within_pct"])
def test_huge_python_integer_is_refused_without_raising(field):
    cond = _cond()
    if field == "price":
        cond["target"]["price"] = 10**1000
        assert ae.frozen_node_target_fingerprint(cond["target"]) is None
    else:
        cond[field] = 10**1000
        result = ae._eval_frozen_node(cond,
            {"principal": "user-42", "createdAt": CREATED, "evaluationAt": EVAL_AT}, None, None)
        assert result[0] is None



def test_delivered_ticker_uses_the_accepted_target_root_not_the_row_symbol(tmp_path, monkeypatch):
    alert = _alert(condition={**_cond(), "_fnp": _fnp_state(inside=False)})
    alert["symbol"] = "QQQ"
    fake, data = _engine(tmp_path, monkeypatch, alert, quote=_rth_quote(620.0, minutes_ago=.5))
    result = _receipt(monkeypatch, fake, data, _reader(_fnp_state(inside=False)))
    assert result["fired_n"] == 1
    payload = fake.outbox[0]["payload"]
    assert payload["ticker"] == "SPY"
    assert payload["subject"].startswith("SPY alert:")
    assert payload["subject_zh"].startswith("SPY提醒：")
    assert "QQQ" not in payload["condition_plain"]
    assert payload["frozen_node"]["target"]["root"] == "SPY"


def test_trusted_reader_receives_exact_server_evaluation_microseconds(tmp_path, monkeypatch):
    at = NOW.replace(microsecond=123456)
    calls = []
    fake, data = _engine(tmp_path, monkeypatch, _alert(), quote=_rth_quote(620), now=at)
    result = ae.run_once(ae.Supa("https://x.example.co", "k"), data, at, "microseconds",
                        frozen_node_reader=_reader(None, calls))
    assert result["evaluated_n"] == 1
    assert calls[0][1] == at.isoformat()



def test_native_dates_nulls_and_correction_reference_bind_without_coercion():
    target = _target()
    target["sourceBinding"]["clocks"] = {
        "source_session": "2026-09-08", "oi_report_date": "2026-09-08",
        "oi_position_session": None, "option_observed_at": None,
        "available_at": "2026-09-08T13:15:00Z", "correction_ref": "revision:1"}
    assert ae.frozen_node_target_fingerprint(target) is not None
    changed = {**target, "sourceBinding": {**target["sourceBinding"], "clocks": {
        **target["sourceBinding"]["clocks"], "oi_position_session": "null"}}}
    assert ae.frozen_node_target_fingerprint(target) != ae.frozen_node_target_fingerprint(changed)
