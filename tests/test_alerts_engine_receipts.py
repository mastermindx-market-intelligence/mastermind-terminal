"""Alert run receipts + fire-to-delivery outbox (Market Ontology F08, packet B-F08-2).

RED-first regression + new-behavior tests for ingest/alerts_engine.py. No network, no Supabase:
Supa's HTTP calls are monkeypatched at the module-level http_json / http_json_status functions so
these tests exercise the real Supa methods against a fake in-memory PostgREST.

Frozen-guard test (must never fail): the alerts PATCH filter still contains active=eq.true and
the disarm body shape is unchanged, regardless of any receipt/outbox behavior added around it.
"""
from __future__ import annotations

import json
import re as _re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ingest.alerts_engine as ae  # noqa: E402


def test_fire_patch_filter_is_frozen(monkeypatch):
    """The one-shot disarm guard (active=eq.true) must never be replaced — only extended.

    MINOR-1, Meta-CEO ruling (PR #513 review round 4): assert against the CAPTURED PATCH url a
    real fire() call sends, not the function's source text — a source-text match can be
    satisfied by a stray comment or string containing the phrase without it ever reaching the
    actual PATCH."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z")
    patches = [c for c in fake.calls if c[0] == "PATCH" and "/alerts?" in c[1]]
    assert len(patches) == 1
    assert "active=eq.true" in patches[0][1]
    assert patches[0][2]["active"] is False


def test_condition_version_ignores_transient_state():
    base = {"type": "opt_gamma_flip", "root": "SPY", "band_pct": 0.1}
    with_state = dict(base, _fs={"side": "above"})
    with_trigger = dict(base, triggered={"at": "x", "value": 1, "note": "n"})
    assert ae.condition_version(base) == ae.condition_version(with_state)
    assert ae.condition_version(base) == ae.condition_version(with_trigger)


def test_condition_version_changes_on_real_edit():
    a = {"type": "price", "op": "above", "value": 100}
    b = {"type": "price", "op": "above", "value": 200}
    assert ae.condition_version(a) != ae.condition_version(b)


def test_mint_fire_event_id_deterministic_and_replay_safe():
    alert = {"id": "abc-123", "condition": {"type": "price", "op": "above", "value": 100}}
    id1 = ae.mint_fire_event_id(alert, "2026-09-05")
    id2 = ae.mint_fire_event_id(alert, "2026-09-05")
    assert id1 == id2  # same alert + same condition + same vintage -> same id (replay-safe)
    id3 = ae.mint_fire_event_id(alert, "2026-09-06")
    assert id3 != id1  # a new vintage mints a new fire event


class _FakeRest:
    """In-memory stand-in for the two receipt/outbox tables, keyed the way PostgREST would be."""

    def __init__(self, tables_exist=True):
        self.tables_exist = tables_exist
        self.outbox = []  # list of dict rows
        self.runs = []  # list of dict rows
        self.calls = []

    def _missing(self):
        return 404, {"message": "Could not find the table"}, '{"message":"missing"}'

    def post(self, url, body):
        self.calls.append(("POST", url, body))
        if not self.tables_exist:
            return self._missing()
        if "/alert_outbox" in url:
            if any(r["fire_event_id"] == body["fire_event_id"] for r in self.outbox):
                return 200, [], "[]"  # ignore-duplicates: no new row
            row = dict(body)
            self.outbox.append(row)
            return 201, [row], "[...]"
        if "/alert_runs" in url:
            self.runs.append(dict(body, _matched_by=None))
            return 201, None, ""
        raise AssertionError(url)

    def patch(self, url, body):
        self.calls.append(("PATCH", url, body))
        if not self.tables_exist:
            return self._missing()
        if "/alert_runs" in url:
            for r in self.runs:
                r.update(body)
            return 204, None, ""
        if "/alerts" in url:
            return 204, None, ""
        raise AssertionError(url)

    def get(self, url):
        self.calls.append(("GET", url, None))
        if not self.tables_exist:
            return self._missing()
        if "/alert_outbox" in url:
            import re as _re
            m = _re.search(r"alert_id=eq\.([^&]+)", url)
            aid = m.group(1) if m else None
            rows = [r for r in self.outbox if str(r.get("alert_id")) == aid]
            rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
            return 200, rows[:1], "[...]"
        raise AssertionError(url)


def _patch_http(monkeypatch, fake: _FakeRest):
    def fake_status(url, headers=None, method="GET", body=None, timeout=15):
        if method == "POST":
            return fake.post(url, body)
        if method == "PATCH":
            return fake.patch(url, body)
        if method == "GET":
            return fake.get(url)
        raise AssertionError((method, url))

    def fake_plain(url, headers=None, method="GET", body=None, timeout=15):
        status, parsed, _ = fake_status(url, headers, method, body, timeout)
        return parsed

    monkeypatch.setattr(ae, "http_json_status", fake_status)
    monkeypatch.setattr(ae, "http_json", fake_plain)


class _FakeAlertsRest(_FakeRest):
    """_FakeRest + GET /alerts?active=eq.true and disarm tracking, for end-to-end run_once()
    tests. `outbox_status`, when set, forces every alert_outbox insert to fail with that HTTP
    status (used to simulate MAJOR 3's hard-error case) instead of behaving like a real table."""

    def __init__(self, alerts: list[dict], tables_exist: bool = True, outbox_status: int | None = None):
        super().__init__(tables_exist=tables_exist)
        self.alerts = {a["id"]: dict(a) for a in alerts}
        self.outbox_status = outbox_status
        self.disarmed: set[str] = set()

    def get(self, url):
        if "/alerts?active=eq.true" in url:
            self.calls.append(("GET", url, None))
            return 200, [a for a in self.alerts.values() if a.get("active", True)], "[...]"
        return super().get(url)

    def post(self, url, body):
        if "/alert_outbox" in url and self.outbox_status is not None:
            self.calls.append(("POST", url, body))
            return self.outbox_status, None, "forced error"
        return super().post(url, body)

    def patch(self, url, body):
        if "/alerts?id=eq." in url:
            self.calls.append(("PATCH", url, body))
            m = _re.search(r"id=eq\.([^&]+)", url)
            aid = m.group(1) if m else None
            if aid in self.alerts:
                self.alerts[aid].update(body)
                self.disarmed.add(aid)
            return 204, None, ""
        return super().patch(url, body)


def test_fire_inserts_outbox_before_disarm(monkeypatch, tmp_path):
    """Meta-CEO ruling (PR #513 review round 4): rewritten to drive production code — the
    vintage is DERIVED from Data.evaluation_vintage() over a real manifest, not a hand-picked
    literal, so this exercises the actual id-contract input production uses."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:00:00Z", "symbols": {"AAPL": {"asof": "2026-09-05T09:00:00Z"}}}
    ))
    data = ae.Data(str(tmp_path), None)
    vintage = data.evaluation_vintage("AAPL")
    assert vintage == "2026-09-05T09:00Z"

    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    supa.fire(alert, 101, "price 101 above 100 (LIVE)", vintage=vintage)

    assert len(fake.outbox) == 1
    row = fake.outbox[0]
    assert row["fire_event_id"] == ae.mint_fire_event_id(alert, vintage)
    assert row["status"] == "pending"
    assert row["payload"]["ticker"] == "AAPL"
    assert "summary_plain" in row["payload"] and "condition_plain" in row["payload"]
    # outbox insert happened before the disarm PATCH
    outbox_idx = next(i for i, c in enumerate(fake.calls) if c[0] == "POST" and "/alert_outbox" in c[1])
    disarm_idx = next(i for i, c in enumerate(fake.calls) if c[0] == "PATCH" and "/alerts?" in c[1])
    assert outbox_idx < disarm_idx


def test_replayed_fire_over_same_vintage_inserts_nothing_new(monkeypatch, tmp_path):
    """Meta-CEO ruling (PR #513 review round 4): rewritten to drive production code — the
    vintage is derived via Data.evaluation_vintage() against a real, UNCHANGED on-disk
    manifest, so a crash-retry re-reading the same data collapses onto the same vintage by
    construction (production behavior), rather than asserting only Supa.fire()'s insert/conflict
    mechanics given a hand-picked literal.

    MINOR-2, Meta-CEO ruling (round 5): the `len(fake.outbox) == 1` assertion below is only
    genuine RED-first coverage of the collapse if `vintage` is actually a real, non-None data
    vintage — on the OLD engine (round 3's wall-clock-only ladder, no manifest rung)
    evaluation_vintage() silently returned None here, and two None-vintage fires ALSO collapse
    to one row, satisfying the assertion vacuously without ever exercising the real collapse.
    Pin the vintage's own value first (mirrors test_fire_inserts_outbox_before_disarm above)."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:00:00Z", "symbols": {"AAPL": {"asof": "2026-09-05T09:00:00Z"}}}
    ))
    data = ae.Data(str(tmp_path), None)
    vintage = data.evaluation_vintage("AAPL")
    assert vintage == "2026-09-05T09:00Z"

    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    supa.fire(alert, 101, "price 101 above 100 (LIVE)", vintage=vintage)
    supa.fire(alert, 101, "price 101 above 100 (LIVE)", vintage=vintage)  # replay
    assert len(fake.outbox) == 1  # no second row


def test_fire_survives_missing_outbox_table_and_still_disarms(monkeypatch, capsys):
    """RED-first: when alert_outbox/alert_runs are not applied yet (404/42P01), the existing fire
    path must behave exactly as before — the disarm PATCH still fires, with a typed
    READ_UNAVAILABLE line and zero outbox rows (Meta-CEO ruling item 4, table-absent case)."""
    fake = _FakeRest(tables_exist=False)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    result = supa.fire(alert, 101, "price 101 above 100 (LIVE)", vintage="2026-09-05T10:01Z")
    assert result is True
    assert fake.outbox == []
    patches = [c for c in fake.calls if c[0] == "PATCH" and "/alerts" in c[1]]
    assert len(patches) == 1
    assert "active=eq.true" in patches[0][1]
    assert patches[0][2]["active"] is False
    assert "READ_UNAVAILABLE" in capsys.readouterr().out


def test_no_per_position_alerts_rows_created():
    """Fire only ever touches the existing single alerts table + alert_outbox — never a second
    per-position table (F08 do_not_redo)."""
    import inspect
    src = inspect.getsource(ae.Supa.fire)
    assert "/alerts?id=eq." in src
    assert "alert_outbox" in src
    assert "alerts_v2" not in src and "position_alerts" not in src


def test_outbox_insert_uses_on_conflict_fire_event_id():
    """MAJOR 1: without ?on_conflict=fire_event_id, ignore-duplicates targets the primary key
    (id), not the unique fire_event_id index, so a real duplicate 409s instead of no-op'ing."""
    import inspect
    src = inspect.getsource(ae.Supa.insert_outbox)
    assert "on_conflict=fire_event_id" in src


def test_status_classifier_distinguishes_denied_from_unavailable():
    """MAJOR 2: a permanent 401/403 must not be reported as 'table not applied yet' — READ_OK/
    READ_OK_ZERO/READ_UNAVAILABLE/READ_DENIED are distinct, per §5."""
    assert ae.Supa._classify(401) == "READ_DENIED"
    assert ae.Supa._classify(403) == "READ_DENIED"
    assert ae.Supa._classify(503) == "READ_UNAVAILABLE"
    assert ae.Supa._classify(599) == "READ_UNAVAILABLE"
    assert ae.Supa._classify(500) == "READ_ERROR"


def test_conclude_run_writes_null_counters_not_zero_on_crash(monkeypatch):
    """MAJOR 3: unknown must not be shaped like empty — a crash reports null counters, not 0."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    supa.start_run("alerts_engine", "r1", "2026-09-05T10:00:00", None, 300)
    supa.conclude_run("alerts_engine", "r1", "2026-09-05T10:00:05", "failure", None, None, None, "RuntimeError")
    assert fake.runs[0]["evaluated_n"] is None
    assert fake.runs[0]["fired_n"] is None
    assert fake.runs[0]["unevaluable_n"] is None


def test_evidence_url_points_at_a_real_route():
    """MAJOR 7: /alerts is a real page (app/(shell)/alerts/page.tsx); the query string used to
    carry an ?id= that AlertsView never reads, so it deep-linked nowhere useful."""
    import inspect
    src = inspect.getsource(ae.Supa.fire)
    assert '"evidence_url": "/alerts"' in src


def test_transport_error_does_not_raise_and_leaves_alert_armed(monkeypatch):
    """A socket timeout / connection reset on the outbox insert must not propagate (it is a
    caught, classified status — 599 — not a raised exception), and per the Meta-CEO ruling item
    2 a network error is one of the 'ANY other non-2xx' cases that must NOT disarm: the fire is
    deferred, not lost, so the next run retries it. This supersedes the prior round's 'a
    transport blip must still disarm' expectation, which predates the ruling. Patches urlopen
    (the real network boundary) so the actual http_json_status exception handling is exercised,
    not mocked out."""
    import urllib.error

    def raising_urlopen(req, data=None, timeout=15):
        raise urllib.error.URLError("connection reset")
    monkeypatch.setattr(ae.urllib.request, "urlopen", raising_urlopen)
    calls = []

    def patched_http_json(url, headers=None, method="GET", body=None, timeout=15):
        calls.append((method, url, body))
        return None
    monkeypatch.setattr(ae, "http_json", patched_http_json)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    result = supa.fire(alert, 101, "price 101 above 100 (LIVE)", vintage="2026-09-05T10:01Z")  # must not raise
    assert result is False
    assert calls == []  # the disarm PATCH (routed through http_json) never ran


def test_h1_genuine_refire_after_rearm_mints_two_distinct_events(monkeypatch):
    """Unit-level: given two DIFFERENT hand-chosen vintages, Supa.fire() mints two distinct
    fire_event_ids and inserts two rows — i.e. mint_fire_event_id() is injective in its vintage
    argument. This is real coverage of Supa.fire()'s mechanics, but the vintage here is a
    literal, not derived by Data.evaluation_vintage() from any manifest/quote state, so on its
    own it does NOT prove H1 (round-1 BLOCKER 1 — a day-stable vintage fallback silently
    collapsing a genuine re-fire) is fixed; that was flagged in PR #513 review round 2 as
    BLOCKER 3. See test_h1_rearm_refire_over_unchanged_manifest_collapses_by_design for the
    end-to-end production-vintage exercise (round 4 revises the expected outcome again —
    see that test's docstring)."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    assert supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z") is True
    assert supa.fire(alert, 140, "price 140 above 100 (live)", vintage="2026-09-05T10:40Z") is True
    assert len(fake.outbox) == 2
    disarms = [c for c in fake.calls if c[0] == "PATCH" and "/alerts?" in c[1]]
    assert len(disarms) == 2
    # MAJOR-3, Meta-CEO ruling (round 4): summary_plain/condition_plain describe the CONDITION,
    # never the fired result -- two fires of the SAME condition (only the result value differs,
    # 101 vs 140) therefore share the SAME summary_plain, even though they mint two distinct
    # fire_event_ids over two distinct vintages.
    summaries = {row["payload"]["summary_plain"] for row in fake.outbox}
    assert len(summaries) == 1
    assert fake.outbox[0]["fire_event_id"] != fake.outbox[1]["fire_event_id"]


def test_crash_before_disarm_retry_over_same_vintage_reuses_the_event(monkeypatch):
    """Unit-level: given the SAME hand-chosen vintage passed twice (modeling "the retry re-read
    the same on-disk data before anything refreshed"), Supa.fire() collapses onto one row — the
    insert/conflict mechanics, not Data.evaluation_vintage()'s derivation of that sameness from
    real manifest/quote state (see test_evaluation_vintage_ignores_placeholder_ts_noise, which
    exercises the derivation itself — PR #513 review round 2 BLOCKER 3)."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    assert supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z") is True
    assert fake.outbox[0]["status"] == "pending"
    # retry — same vintage (same data), alert still active because the crash happened before the
    # first PATCH landed
    assert supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z") is True
    assert len(fake.outbox) == 1


def test_deferred_row_crash_retry_same_vintage_still_one_row(monkeypatch):
    """Unit-level: once macro's drain has moved the row to 'deferred', a hand-chosen same-vintage
    crash-retry must still collapse onto that one row — the outbox row's status
    (pending/deferred/sent/failed/suppressed) is irrelevant to identity. As with the two tests
    above, this exercises Supa.fire()'s mechanics given a fixed vintage, not the production
    derivation of that vintage from real quote/manifest state — see
    test_evaluation_vintage_ignores_placeholder_ts_noise for BLOCKER 2's end-to-end
    reproduction (PR #513 review round 2 BLOCKER 3)."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z")
    fake.outbox[0]["status"] = "deferred"  # macro's drain tried delivery and deferred it
    supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z")  # crash-retry
    assert len(fake.outbox) == 1


def test_insert_hard_error_never_disarms(monkeypatch):
    """MAJOR 3, Meta-CEO RULED: any hard error on the outbox insert (5xx/401/400/network — NOT a
    table-absent schema-cache miss) must NOT disarm. fire() returns False so the caller can leave
    the alert armed and count it unevaluable for the next run's retry."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    orig_post = fake.post

    def failing_post(url, body):
        if "/alert_outbox" in url:
            fake.calls.append(("POST", url, body))
            return 500, None, "boom"
        return orig_post(url, body)
    fake.post = failing_post

    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    result = supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z")
    assert result is False
    assert fake.outbox == []
    disarms = [c for c in fake.calls if c[0] == "PATCH" and "/alerts?" in c[1]]
    assert disarms == []


def test_run_once_two_phase_receipt_and_success_outcome(tmp_path, monkeypatch):
    """Item 3: run_once() drives the REAL two-phase alert_runs receipt end to end — a 'started'
    row at run open, a terminal row with concluded_at/outcome once outputs are committed — and a
    genuine fire disarms the real alert row via the production fire() path (not re-derived
    arithmetic)."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:30:00Z", "symbols": {"AAPL": {}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)
    data.quotes = {"AAPL": {"last": 101.0}}  # a live quote as if hub priming had populated it

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert receipt["outcome"] == "success"
    assert receipt["fired_n"] == 1
    assert receipt["evaluated_n"] == 1
    assert receipt["unevaluable_n"] == 0
    assert len(fake.runs) == 1
    assert fake.runs[0]["started_at"]
    assert fake.runs[0]["concluded_at"]
    assert fake.runs[0]["outcome"] == "success"
    assert fake.disarmed == {"a1"}


def test_run_once_insert_error_leaves_alert_armed_and_counts_unevaluable(tmp_path, monkeypatch):
    """MAJOR 3, Meta-CEO RULED, end to end: a hard error on the outbox insert must not disarm —
    the run receipt counts the alert as unevaluable so the NEXT run re-evaluates and retries it,
    and the outcome reads 'partial', never a clean 'success'."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:30:00Z", "symbols": {"AAPL": {}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert], outbox_status=500)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)
    data.quotes = {"AAPL": {"last": 101.0}}

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert receipt["fired_n"] == 0
    assert receipt["unevaluable_n"] == 1
    assert receipt["outcome"] == "partial"
    assert fake.alerts["a1"]["active"] is True  # never disarmed
    assert fake.outbox == []
    assert fake.disarmed == set()


def test_run_once_crash_writes_failure_receipt_with_error_class(tmp_path, monkeypatch):
    """Item 3: a top-level crash during the run writes the failure half of the two-phase receipt
    with null counters (unknown, never shaped like zero) + the exception's class name, then
    re-raises — a genuine crash must never be swallowed."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:30:00Z", "symbols": {"AAPL": {}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)
    data.quotes = {"AAPL": {"last": 101.0}}

    def boom(alert, value, note, *, vintage):
        raise RuntimeError("disarm PATCH network failure")
    monkeypatch.setattr(supa, "fire", boom)

    with pytest.raises(RuntimeError):
        ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert fake.runs[0]["outcome"] == "failure"
    assert fake.runs[0]["evaluated_n"] is None
    assert fake.runs[0]["fired_n"] is None
    assert fake.runs[0]["unevaluable_n"] is None
    assert fake.runs[0]["error_class"] == "RuntimeError"


def test_run_once_eod_fallback_forces_partial_outcome(tmp_path, monkeypatch):
    """BLOCKER 2, end to end via run_once(): a live-hub outage falls back to the manifest EOD
    last and the alert still fires on it — the run receipt must read 'partial' with source_asof
    re-stamped to the fallback vintage, never a clean 'success' over stale data."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-04T21:00:00Z",
         "symbols": {"AAPL": {"last": 101.5, "asof": "2026-09-04T21:00:00Z"}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)  # no live quote primed -> falls back to manifest EOD last

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert receipt["outcome"] == "partial"
    assert receipt["source_asof"] == "2026-09-04T21:00:00Z"
    assert fake.disarmed == {"a1"}  # the fallback forces 'partial', not a skip


def test_outcome_forced_partial_on_eod_price_fallback(tmp_path, monkeypatch):
    """BLOCKER 2: when the quote hub is down and a price alert evaluates against the manifest EOD
    fallback, the run receipt must not read 'success' with a null source_asof — it must be
    'partial' with source_asof re-stamped to the fallback vintage."""
    (tmp_path / "manifest.json").write_text(
        '{"symbols": {"AAPL": {"last": 101.5, "asof": "2026-09-04T21:00:00Z"}}}'
    )
    data = ae.Data(str(tmp_path), None)
    assert data.used_eod_fallback is False
    last, basis = data.last("AAPL")
    assert basis == "eod"
    assert data.used_eod_fallback is True
    assert data.eod_fallback_asof == "2026-09-04T21:00:00Z"


# --- PR #513 review round 2: BLOCKER 1/2/3/5, MINOR 6 -----------------------------------------


def test_h1_rearm_refire_over_unchanged_manifest_collapses_by_design(tmp_path, monkeypatch):
    """Meta-CEO ruling on PR #513 review round 4 (BLOCKER) SUPERSEDES round 3's fix and this
    test's own former expectations (it was named
    test_h1_genuine_refire_after_rearm_reproduces_via_production_vintage). Round 3 added a
    wall-clock fallback rung specifically so a genuine re-arm+re-fire on unchanged EOD-only data
    would mint a NEW vintage (and a second outbox row) -- but that wall-clock rung is exactly
    what round 4 measured double-enqueuing a 'deferred' row on a crash-retry (round-4 BLOCKER 2)
    and letting an unrelated placeholder poll mint spurious new vintages (round-4 BLOCKER 1).
    The ruling deletes the wall-clock rung outright and states the accepted trade-off plainly:
    identity keys on the DATA vintage alone. With no new data (hub down, same on-disk manifest,
    nothing re-built), a genuine re-arm+re-fire mints the SAME vintage as the first fire and
    therefore the SAME fire_event_id -- the second insert is an idempotent no-op ('duplicate'),
    not a new row. The alert itself is still correctly disarmed BOTH times (the PATCH runs
    unconditionally once insert_outbox resolves to anything other than a hard error), so the
    one-shot disarm semantics hold; only the delivery queue does not gain a second entry for a
    fire the id contract cannot tell apart from the first."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:00:00Z",
         "symbols": {"AAPL": {"last": 101.5, "asof": "2026-09-05T09:00:00Z"}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")

    data1 = ae.Data(str(tmp_path), None)  # hub_port=None -> hub down, EOD-only, no live quote
    r1 = ae.run_once(supa, data1, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")
    assert r1["fired_n"] == 1
    assert len(fake.outbox) == 1

    # The user re-arms the SAME alert. Nothing about the underlying manifest/EOD data changed --
    # same day, same build, hub still down.
    fake.alerts["a1"]["active"] = True

    data2 = ae.Data(str(tmp_path), None)
    r2 = ae.run_once(supa, data2, datetime(2026, 9, 5, 10, 39, tzinfo=timezone.utc), "r2")
    assert r2["fired_n"] == 1  # the alert IS disarmed again -- the fire path still runs cleanly

    assert len(fake.outbox) == 1, (
        "no new data vintage exists between the two runs, so identity collapses by design "
        "(Meta-CEO ruling, round 4) -- this is the accepted trade-off, not a bug"
    )
    disarms = [c for c in fake.calls if c[0] == "PATCH" and "/alerts?id=eq." in c[1]]
    assert len(disarms) == 2


def test_evaluation_vintage_ignores_placeholder_ts_noise(tmp_path):
    """BLOCKER 2 / BLOCKER 3, Meta-CEO RULED — unit-level reproduction of the reviewer's
    measured PROBE2, directly against Data.evaluation_vintage() (no Supa, no hand-chosen
    vintage). The Quote Hub seeds a manifest/EOD placeholder while waiting for a first
    current-session print: `regularSession="closed"`, `ts=Date.now()` at RESPONSE time (see
    live_quote()'s own docstring) — so the SAME unrefreshed placeholder polled twice, 61 seconds
    apart, carries two different `ts` values despite being identical data. The unfixed
    evaluation_vintage() read that raw `ts` with none of live_quote()'s freshness guards, so it
    minted two different vintages for the one unchanged placeholder (measured: 09:20Z vs 09:21Z,
    2 outbox rows for a single real event). The fix reuses live_quote()'s own gates, which
    reject `regularSession != "rth"` outright — a placeholder is recognized as "no live vintage"
    (both reads answer None) rather than laundered into two distinct fake ones."""
    (tmp_path / "manifest.json").write_text(json.dumps({"symbols": {"AAPL": {}}}))

    def placeholder_at(poll_dt):
        return {
            "last": 101.0, "basis": "DELAYED_15M",
            "marketSession": "rth", "regularSession": "closed",  # the placeholder tell
            "regularSessionDate": "2026-09-08",
            "ts": poll_dt.timestamp() * 1000,  # re-stamped to "now" on every poll
        }

    now1 = datetime(2026, 9, 8, 13, 30, 0, tzinfo=timezone.utc)  # Tuesday, inside RTH (9:30 ET)
    data1 = ae.Data(str(tmp_path), None, now_fn=lambda: now1)
    data1.quotes = {"AAPL": placeholder_at(now1)}
    v1 = data1.evaluation_vintage("AAPL")

    now2 = datetime(2026, 9, 8, 13, 31, 1, tzinfo=timezone.utc)  # 61s later, same placeholder
    data2 = ae.Data(str(tmp_path), None, now_fn=lambda: now2)
    data2.quotes = {"AAPL": placeholder_at(now2)}
    v2 = data2.evaluation_vintage("AAPL")

    assert v1 == v2 is None


def test_evaluation_vintage_rung_b_falls_back_on_a_production_shaped_manifest(tmp_path):
    """MINOR-4, Meta-CEO ruling (round 5): every other rung-(b) test in this file hand-writes a
    manifest whose per-symbol entry carries a synthetic `asof` key — no producer under ingest/
    actually writes that shape. terminal/public/data/manifest.json (the real, in-repo manifest)
    has a build-level `as_of` and per-symbol entries carrying only display fields
    (name/last/chg/hi52/.../regimeBull), never a per-symbol `asof`. This pins that rung (b)
    correctly falls back to the manifest's build-level `as_of` — not that it silently returns
    None — against that PRODUCTION shape, not a synthetic one."""
    (tmp_path / "manifest.json").write_text(json.dumps({
        "as_of": "2026-06-26",
        "source": "eod-build",
        "symbols": {
            "AAPL": {"name": "Apple Inc", "last": 200.1, "chg": -0.5, "hi52": 260.1,
                       "lo52": 150.0, "regimeBull": True},
        },
    }))
    data = ae.Data(str(tmp_path), None)
    assert "asof" not in data.symbols["AAPL"]  # confirms the shape carries no per-symbol asof
    assert data.evaluation_vintage("AAPL") == "2026-06-26T00:00Z"


def test_insert_hard_error_logs_read_error_not_read_unavailable(monkeypatch, capsys):
    """MAJOR 5, Meta-CEO RULED: a genuine hard failure on the outbox insert (5xx/401/400/
    network — NOT a table-absent schema-cache miss) must print a typed READ_ERROR line, never
    READ_UNAVAILABLE. That label means "table not applied yet — disarm proceeds anyway"; this
    branch is the OPPOSITE disposition (fire() returns False, the alert stays armed). Before
    this fix, `_classify()` mapped 503/599 to READ_UNAVAILABLE and insert_outbox printed that
    label for the exact same statuses it treats as a hard 'error' outcome — one prefix covering
    two opposite dispositions."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    orig_post = fake.post

    def failing_post(url, body):
        if "/alert_outbox" in url:
            fake.calls.append(("POST", url, body))
            return 599, None, "connection reset"
        return orig_post(url, body)
    fake.post = failing_post

    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    result = supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z")
    assert result is False

    out = capsys.readouterr().out
    assert "READ_ERROR alert_outbox (insert)" in out
    assert "READ_UNAVAILABLE" not in out


def test_run_once_crash_in_active_alerts_fetch_still_writes_failure_receipt(tmp_path, monkeypatch):
    """MINOR 6: a crash while FETCHING armed alerts — the first live network call the run makes,
    and arguably the single most likely crash source — must still leave a terminal receipt row.
    Before this fix the try/except only wrapped the evaluate/fire loop, so this crash left a
    'started' row with every terminal field null forever, indistinguishable from a run that is
    still in progress."""
    (tmp_path / "manifest.json").write_text(json.dumps({"symbols": {}}))
    fake = _FakeAlertsRest([])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")

    def boom():
        raise RuntimeError("supabase read failed")
    monkeypatch.setattr(supa, "active_alerts", boom)
    data = ae.Data(str(tmp_path), None)

    with pytest.raises(RuntimeError):
        ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert fake.runs[0]["outcome"] == "failure"
    assert fake.runs[0]["concluded_at"]
    assert fake.runs[0]["error_class"] == "RuntimeError"


# --- PR #513 review round 4 (Meta-CEO ruling): BLOCKER, MAJOR-1/2/3, MINOR-2/3/5 -----------------


def test_crash_between_insert_and_disarm_retry_over_same_vintage_one_row_and_disarmed(tmp_path, monkeypatch):
    """BLOCKER, Meta-CEO ruling, run_once()-level RED-first test named by the reviewer: a crash
    lands the outbox insert but never reaches the disarm PATCH at 10:00; a retry 5 minutes
    later, over byte-identical on-disk data with the hub down (no live quote, so the ladder
    falls back to rung (b) -- the manifest's own per-symbol asof, unchanged between the two
    runs), must collapse onto the SAME fire_event_id and end with exactly one outbox row and
    the alert disarmed."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:00:00Z",
         "symbols": {"AAPL": {"last": 101.5, "asof": "2026-09-05T09:00:00Z"}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)

    # Simulate "crash between insert and disarm": the FIRST disarm PATCH raises instead of
    # landing -- the outbox insert above it already completed over the wire.
    orig_patch = fake.patch
    state = {"crashed": False}

    def crashing_patch(url, body):
        if "/alerts?id=eq." in url and not state["crashed"]:
            state["crashed"] = True
            raise RuntimeError("simulated crash before the disarm PATCH lands")
        return orig_patch(url, body)
    fake.patch = crashing_patch

    supa = ae.Supa("https://x.example.co", "k")
    data1 = ae.Data(str(tmp_path), None)  # hub down -> no live quote
    with pytest.raises(RuntimeError):
        ae.run_once(supa, data1, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert len(fake.outbox) == 1  # the insert landed before the simulated crash
    assert fake.disarmed == set()  # the disarm PATCH never landed

    data2 = ae.Data(str(tmp_path), None)  # retry, byte-identical on-disk manifest, hub still down
    r2 = ae.run_once(supa, data2, datetime(2026, 9, 5, 10, 5, tzinfo=timezone.utc), "r2")

    assert len(fake.outbox) == 1  # same vintage (same manifest data) -> same fire_event_id
    assert fake.disarmed == {"a1"}
    assert r2["fired_n"] == 1


def test_no_data_vintage_leaves_alert_unevaluable_no_fire_no_disarm(tmp_path, monkeypatch):
    """BLOCKER rung (c), Meta-CEO ruling: a condition that evaluates true but has NO
    discoverable data vintage anywhere (no live quote, no per-symbol manifest asof, no manifest
    build as_of) must not fire and must not disarm -- a fire without a vintage has no identity
    to key on. The run counts it unevaluable so a later run (once real vintage data exists) can
    retry it."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"symbols": {"AAPL": {"last": 101.5}}}  # no "asof" anywhere, no top-level "as_of" either
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert receipt["fired_n"] == 0
    assert receipt["unevaluable_n"] == 1
    assert receipt["outcome"] == "partial"
    assert fake.outbox == []
    assert fake.disarmed == set()
    assert fake.alerts["a1"]["active"] is True


def test_dry_run_writes_nothing_to_supabase(tmp_path, monkeypatch, capsys):
    """MAJOR-1, Meta-CEO ruling: --dry-run must make ZERO writes to Supabase. start_run/
    conclude_run are gated on `not dry_run` (the receipt is logged instead); the per-alert
    fire()/update_condition writes were already gated. Only the read-only active_alerts() GET
    may still happen.

    MINOR-3, Meta-CEO ruling (round 5): the conclude_run receipt (outcome/evaluated_n/fired_n/
    unevaluable_n) must be LOGGED, not silently dropped, when dry_run skips the real write —
    round 4 logged only the start_run line, leaving the run's actual outcome unobservable in a
    dry run."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:00:00Z", "symbols": {"AAPL": {"asof": "2026-09-05T09:00:00Z"}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)
    data.quotes = {"AAPL": {"last": 101.0}}

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1",
                           dry_run=True)

    assert receipt["fired_n"] == 1  # dry-run still reports what it would have done
    writes = [c for c in fake.calls if c[0] in ("POST", "PATCH")]
    assert writes == [], f"dry_run made a Supabase write: {writes}"
    assert fake.alerts["a1"]["active"] is True  # never disarmed
    out = capsys.readouterr().out
    assert "[dry-run] start_run" in out
    assert "[dry-run] conclude_run" in out
    assert "outcome=success" in out
    assert "fired_n=1" in out


def test_condition_transient_keys_excludes_every_evaluator_state_key():
    """MAJOR-2, Meta-CEO ruling: _CONDITION_TRANSIENT_KEYS is DERIVED from _OPT_EVALUATORS' own
    state keys (never hand-duplicated), so adding a new stateful evaluator can never forget to
    exclude its hysteresis key from condition_version()."""
    for ctype, (state_key, _fn, _getter) in ae._OPT_EVALUATORS.items():
        assert state_key in ae._CONDITION_TRANSIENT_KEYS, (
            f"{ctype}'s state key {state_key!r} must be excluded from condition_version"
        )
    assert "triggered" in ae._CONDITION_TRANSIENT_KEYS


def test_outbox_payload_condition_plain_describes_condition_not_result(monkeypatch):
    """MAJOR-3, Meta-CEO ruling: condition_plain (and its EN/ZH siblings) is built from the
    STRUCTURED condition -- it describes what the alert WATCHES FOR, never the fired result,
    and never leaks basis tags / raw slugs / ISO timestamps that belong only in the engine's own
    log lines."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    # The fired value (140) and the internal note (with basis tag + jargon) must NOT leak into
    # condition_plain -- only the condition's own op/value (100, "above") may appear.
    supa.fire(alert, 140, "price 140 above 100 (LIVE) as of 2026-09-05T10:01:00Z",
              vintage="2026-09-05T10:01Z")

    payload = fake.outbox[0]["payload"]
    assert payload["condition_plain"] == "AAPL rises above 100"
    assert "140" not in payload["condition_plain"]
    assert "LIVE" not in payload["condition_plain"]
    assert "2026-09-05T10:01:00Z" not in payload["condition_plain"]
    # EN/ZH siblings are additive jsonb keys, present alongside the EN fields.
    for key in ("subject_zh", "summary_plain_zh", "condition_plain_zh"):
        assert key in payload and payload[key], f"missing or empty {key}"
    assert payload["condition_plain_zh"] == "AAPL涨破100"


def test_outbox_payload_carries_the_fired_value(monkeypatch):
    """MAJOR-2, Meta-CEO ruling (round 5): condition_plain/summary_plain deliberately describe
    the CONDITION, never the fired result (MAJOR-3, round 4) — but the observed reading that
    actually fired the alert must still reach the delivery queue somewhere, or a delivered alert
    can never say what printed. `value` is that raw observed reading, additive to the payload,
    alongside the (deliberately result-free) plain-text fields."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    supa.fire(alert, 140, "price 140 above 100 (LIVE)", vintage="2026-09-05T10:01Z")

    payload = fake.outbox[0]["payload"]
    assert payload["value"] == 140
    # condition_plain still names only the threshold (100), never the observed value (140) —
    # MAJOR-3's rule is unaffected by adding `value` alongside it.
    assert "140" not in payload["condition_plain"]
    assert "140" not in payload["summary_plain"]


_JARGON_TERMS = ("RSI(14)", "rsi(14)", "gamma", "net-put", "net-call", "direction-fragile",
                  "outsized")

# MAJOR-1, Meta-CEO ruling (round 5): every opt_* condition type, with a condition dict shaped
# the way a real armed alert carries one (per terminal/components/AlertsView.tsx COND_TYPES).
_ALL_CONDITION_TYPES = [
    {"type": "price", "op": "above", "value": 100},
    {"type": "rsi", "value": 30},
    {"type": "regime"},
    {"type": "signal", "target": "BUY"},
    {"type": "opt_gamma_flip", "root": "SPY"},
    {"type": "opt_wall_touch", "root": "SPY", "wall": "call"},
    {"type": "opt_wall_touch", "root": "SPY", "wall": "put"},
    {"type": "opt_premium_burst", "root": "SPY", "leg": "npp"},
    {"type": "opt_premium_burst", "root": "SPY", "leg": "ncp"},
    {"type": "opt_0dte_spike", "root": "SPY"},
    {"type": "opt_wall_migration", "root": "SPY", "wall": "call"},
    {"type": "opt_sign_fragile", "root": "SPY"},
    {"type": "opt_opex_concentration", "root": "SPY"},
    {"type": "opt_surface_pocket", "root": "SPY"},
]


def test_condition_plain_en_never_uses_internal_jargon():
    """MAJOR-1, Meta-CEO ruling (round 5): every delivered condition_plain string uses plain
    everyday words — no internal study/indicator name, no raw Greek-letter options term, no
    internal leg/slug abbreviation (DEC-CHAIRMAN-FRONTEND-PLAIN-LANGUAGE-LAW-2026-09-06 binds
    every user-facing string). Covers every opt_* type, not just the price/regime/signal
    branches the round-4 review already found compliant."""
    for cond in _ALL_CONDITION_TYPES:
        text = ae._condition_plain_en(cond, "AAPL")
        low = text.lower()
        for term in _JARGON_TERMS:
            assert term.lower() not in low, f"{cond['type']!r} -> {text!r} contains banned jargon {term!r}"


def test_condition_plain_zh_never_leaves_untranslated_jargon():
    """MAJOR-1, Meta-CEO ruling (round 5): the Chinese sibling must not leave a bare
    English/Latin jargon fragment (RSI(14), gamma) sitting inside the Chinese sentence — a
    mixed-language sentence fails the plain-language law exactly as an untranslated term does
    in English."""
    for cond in _ALL_CONDITION_TYPES:
        text = ae._condition_plain_zh(cond, "AAPL")
        low = text.lower()
        for term in ("rsi(14)", "gamma"):
            assert term not in low, f"{cond['type']!r} -> {text!r} leaves untranslated {term!r}"


def test_insert_conflict_logs_already_enqueued_not_read_conflict(monkeypatch, capsys):
    """MINOR-2, Meta-CEO ruling: a 409 on the outbox insert is the expected, idempotent
    duplicate-of-record disposition -- it must log ALREADY_ENQUEUED, never READ_CONFLICT (which
    would read like a genuine error for the happy-path duplicate case)."""
    fake = _FakeRest(tables_exist=True)
    _patch_http(monkeypatch, fake)
    orig_post = fake.post

    def conflicting_post(url, body):
        if "/alert_outbox" in url:
            fake.calls.append(("POST", url, body))
            return 409, None, "conflict"
        return orig_post(url, body)
    fake.post = conflicting_post

    supa = ae.Supa("https://x.example.co", "k")
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL",
              "condition": {"type": "price", "op": "above", "value": 100}}
    result = supa.fire(alert, 101, "price 101 above 100 (live)", vintage="2026-09-05T10:01Z")
    assert result is True  # a duplicate still proceeds to disarm

    out = capsys.readouterr().out
    assert "ALREADY_ENQUEUED alert_outbox (insert)" in out
    assert "READ_CONFLICT" not in out


def test_opt_alert_vintage_uses_condition_root_not_alert_symbol(tmp_path, monkeypatch):
    """MINOR-5, Meta-CEO ruling: an opt_* alert's data vintage is keyed on the CONDITION's root
    -- the underlying the evaluator actually read -- never the alert row's own `symbol` field,
    which can differ from it."""
    (tmp_path / "manifest.json").write_text(json.dumps({"symbols": {}}))
    alert = {"id": "a1", "user_id": "u1", "symbol": "MY-OPT-ALERT", "active": True,
              "condition": {"type": "opt_gamma_flip", "root": "SPY"}}
    fake = _FakeAlertsRest([alert])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)

    seen = []
    orig = data.evaluation_vintage

    def spy(sym):
        seen.append(sym)
        return orig(sym)
    monkeypatch.setattr(data, "evaluation_vintage", spy)
    monkeypatch.setattr(ae, "evaluate", lambda a, d, flow=None: (True, 1.0, "note", None))

    ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert seen == ["SPY"]


def test_run_once_logs_unevaluable_n_not_skipped_only(tmp_path, monkeypatch, capsys):
    """MINOR-3, Meta-CEO ruling: the run's done-line logs the receipt's own unevaluable_n
    (which reconciles skipped + errored + deferred + no_vintage), not a skipped-only subcount.
    A forced outbox-insert error produces unevaluable_n=1 with skipped=0 -- the two subcounts
    DIFFER here, so a log line that used `skipped` instead of `unevaluable_n` would have
    printed '0 unevaluable' for a run that could not evaluate one alert."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:30:00Z", "symbols": {"AAPL": {}}}
    ))
    alert = {"id": "a1", "user_id": "u1", "symbol": "AAPL", "active": True,
              "condition": {"type": "price", "op": "above", "value": 100}}
    fake = _FakeAlertsRest([alert], outbox_status=500)
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)
    data.quotes = {"AAPL": {"last": 101.0}}

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert receipt["unevaluable_n"] == 1
    out = capsys.readouterr().out
    assert "1 unevaluable" in out


# Meta-CEO ruling (PR #513 review round 6, MAJOR-1/MAJOR-2/MINOR-3): the round-5 plain-language
# rewrite of opt_0dte_spike and opt_sign_fragile changed the underlying CLAIM (a measured share
# turned into an absolute "surge in trading"; an instrument-robustness statistic turned into a
# trader-sentiment claim). Round 6 restores a plain-English/plain-Chinese description of the
# actual MEASURED quantity: opt_0dte_spike measures a SHARE of options money traded (_eval_0dte,
# "0d share of tracked net premium"); opt_sign_fragile measures how BALANCED the call/put gamma
# split is (_eval_sign_fragile, tilt = ||call|-|put|| / total); opt_opex_concentration measures a
# share of OPEN options positions concentrated in the front expiry (_eval_opex_concentration,
# front-expiry share of gross/open gamma), never generic "options activity". Each condition's
# EN and ZH sentence must name its measured quantity; this pins the round-6 fix against the
# round-5 regression these three condition types held.
_MEASURED_QUANTITY_TERMS = {
    "opt_0dte_spike": {"en": ("share",), "zh": ("占比",)},
    "opt_sign_fragile": {"en": ("balanced", "balance"), "zh": ("平衡",)},
    "opt_opex_concentration": {"en": ("open options positions",), "zh": ("未平仓",)},
}


def test_opt_measured_quantity_named_in_plain_text_en_and_zh():
    """Meta-CEO ruling, round 6: opt_0dte_spike/opt_sign_fragile/opt_opex_concentration must each
    name their measured quantity (share / balance / open positions) in BOTH the EN and ZH plain
    text -- never a different claim the evaluator does not measure (no "surge in trading", no
    "losing conviction", no generic "options activity")."""
    conds = {
        "opt_0dte_spike": {"type": "opt_0dte_spike", "root": "SPY"},
        "opt_sign_fragile": {"type": "opt_sign_fragile", "root": "SPY"},
        "opt_opex_concentration": {"type": "opt_opex_concentration", "root": "SPY"},
    }
    for ctype, cond in conds.items():
        en = ae._condition_plain_en(cond, "SPY")
        zh = ae._condition_plain_zh(cond, "SPY")
        en_terms = _MEASURED_QUANTITY_TERMS[ctype]["en"]
        zh_terms = _MEASURED_QUANTITY_TERMS[ctype]["zh"]
        assert any(t in en.lower() for t in en_terms), (
            f"{ctype} EN text {en!r} names none of its measured-quantity terms {en_terms!r}"
        )
        assert any(t in zh for t in zh_terms), (
            f"{ctype} ZH text {zh!r} names none of its measured-quantity terms {zh_terms!r}"
        )


def test_opt_0dte_spike_never_claims_a_surge_in_trading():
    """Meta-CEO ruling, round 6, MAJOR-1: _eval_0dte (alerts_engine.py) computes the 0d SHARE of
    tracked net premium against share_pct -- the share can cross while 0DTE activity is flat or
    falling (longer-dated premium collapsing elsewhere). The round-5 text ("a surge in trading of
    options expiring today" / ZH "交易量大幅上升") asserted an absolute volume surge the evaluator
    never measures. The fix must never claim a surge/increase in trading or volume."""
    en = ae._condition_plain_en({"type": "opt_0dte_spike", "root": "SPY"}, "SPY")
    zh = ae._condition_plain_zh({"type": "opt_0dte_spike", "root": "SPY"}, "SPY")
    assert "surge" not in en.lower()
    assert "share" in en.lower()
    assert "交易量" not in zh and "大幅上升" not in zh
    assert "占比" in zh


def test_opt_sign_fragile_never_claims_trader_sentiment():
    """Meta-CEO ruling, round 6, MAJOR-2: _eval_sign_fragile measures the gamma tilt statistic
    ||call|-|put||/total falling below tilt_pct -- an instrument-robustness measure, not a claim
    about what options traders believe or how divided they are. The round-5 text ("options
    traders are losing conviction" / ZH "期权交易者...看法出现分歧") asserted a market-participant
    claim the evaluator never observes. The fix must never mention traders' conviction or
    disagreement."""
    en = ae._condition_plain_en({"type": "opt_sign_fragile", "root": "SPY"}, "SPY")
    zh = ae._condition_plain_zh({"type": "opt_sign_fragile", "root": "SPY"}, "SPY")
    assert "conviction" not in en.lower() and "trader" not in en.lower()
    assert "balanced" in en.lower() or "balance" in en.lower()
    assert "交易者" not in zh and "分歧" not in zh
    assert "平衡" in zh


def test_opt_opex_concentration_names_open_positions_not_activity():
    """Meta-CEO ruling, round 6, MINOR-3: _eval_opex_concentration measures a share of gross/open
    gamma (open options POSITIONS) concentrated in the front expiry -- the round-5 text
    substituted the generic "options activity" for that quantity. Fixed text names open options
    positions."""
    en = ae._condition_plain_en({"type": "opt_opex_concentration", "root": "SPY"}, "SPY")
    zh = ae._condition_plain_zh({"type": "opt_opex_concentration", "root": "SPY"}, "SPY")
    assert "options activity" not in en.lower()
    assert "open options positions" in en.lower()
    assert "未平仓" in zh


def test_opt_wall_side_names_options_qualifier():
    """Meta-CEO ruling, round 6, MINOR-2: the gamma call/put wall must never render as the bare
    generic TA term "resistance level"/"support level" (collides with chart resistance/support
    the user already has) -- it must carry the "options" qualifier, e.g. "an options level that
    tends to act as resistance/support"."""
    for wall in ("call", "put"):
        en = ae._condition_plain_en({"type": "opt_wall_touch", "root": "SPY", "wall": wall}, "SPY")
        zh = ae._condition_plain_zh({"type": "opt_wall_touch", "root": "SPY", "wall": wall}, "SPY")
        assert "options" in en.lower()
        assert "期权" in zh
