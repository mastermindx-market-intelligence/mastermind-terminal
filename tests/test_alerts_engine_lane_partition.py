"""B-F08-B5-3 §2.5 D — Python lane partition.

No network. Supa's HTTP is monkeypatched. Case 13 is the receipt regression: one
armed suite_event row must not pin the alerts_engine lane to partial.
"""
from __future__ import annotations

import json
import re as _re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ingest.alerts_engine as ae  # noqa: E402


class _FakeRest:
    def __init__(self, alerts: list[dict], tables_exist: bool = True):
        self.tables_exist = tables_exist
        self.alerts = {a["id"]: dict(a) for a in alerts}
        self.outbox: list[dict] = []
        self.runs: list[dict] = []
        self.calls: list[tuple] = []
        self.disarmed: set[str] = set()

    def _missing(self):
        return 404, {"message": "Could not find the table"}, '{"message":"missing"}'

    def get(self, url):
        self.calls.append(("GET", url, None))
        if "/alerts?active=eq.true" in url:
            rows = [a for a in self.alerts.values() if a.get("active", True)]
            # Honour the PostgREST type filter when present — that is the partition.
            m = _re.search(r"condition->>type=not\.in\.\(([^)]+)\)", url)
            if m:
                excluded = {t.strip() for t in m.group(1).split(",") if t.strip()}
                rows = [a for a in rows if (a.get("condition") or {}).get("type") not in excluded]
            return 200, rows, "[...]"
        raise AssertionError(url)

    def post(self, url, body):
        self.calls.append(("POST", url, body))
        if not self.tables_exist:
            return self._missing()
        if "/alert_outbox" in url:
            self.outbox.append(dict(body))
            return 201, [body], "[...]"
        if "/alert_runs" in url:
            self.runs.append(dict(body))
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
            m = _re.search(r"id=eq\.([^&]+)", url)
            aid = m.group(1) if m else None
            if aid in self.alerts:
                self.alerts[aid].update(body)
                if body.get("active") is False:
                    self.disarmed.add(aid)
            return 204, None, ""
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


def test_active_alerts_url_excludes_suite_types(monkeypatch):
    """§2.5 case 12 — equality on the built URL, not a containment check."""
    captured: list[str] = []

    def fake_json(url, headers=None, method="GET", body=None, timeout=15):
        captured.append(url)
        return []

    monkeypatch.setattr(ae, "http_json", fake_json)
    supa = ae.Supa("https://x.example.co", "k")
    supa.active_alerts()
    assert captured == [
        "https://x.example.co/rest/v1/alerts?active=eq.true"
        "&condition->>type=not.in.(suite_event,suite_sequence)&select=*"
    ]


def test_suite_row_does_not_pin_alerts_engine_receipt_to_partial(tmp_path, monkeypatch):
    """§2.5 case 13 — the reported failure.

    Today: one armed suite_event row is pulled by the unfiltered selector, evaluate()
    falls through, SKIP, unevaluable_n == 1, outcome == partial.
    After R1: the suite row is never returned, outcome == success, unevaluable_n == 0.
    """
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:30:00Z", "symbols": {"AAPL": {}}}
    ))
    price = {
        "id": "p1", "user_id": "u1", "symbol": "AAPL", "active": True,
        "condition": {"type": "price", "op": "above", "value": 100},
    }
    suite = {
        "id": "s1", "user_id": "u1", "symbol": "AAPL", "active": True,
        "condition": {"type": "suite_event", "suite": "smc", "event": "bos"},
    }
    fake = _FakeRest([price, suite])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)
    data.quotes = {"AAPL": {"last": 101.0}}

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert receipt["outcome"] == "success"
    assert receipt["unevaluable_n"] == 0
    assert receipt["evaluated_n"] == 1
    assert receipt["fired_n"] == 1
    gets = [c[1] for c in fake.calls if c[0] == "GET" and "/alerts?" in c[1]]
    assert gets, "active_alerts must have been called"
    assert "condition->>type=not.in.(suite_event,suite_sequence)" in gets[0]


def test_unknown_type_still_skips_and_forces_partial(tmp_path, monkeypatch):
    """§2.5 case 14 — the fall-through at evaluate() is not weakened by R1."""
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"as_of": "2026-09-05T09:30:00Z", "symbols": {"AAPL": {}}}
    ))
    unknown = {
        "id": "u1", "user_id": "u1", "symbol": "AAPL", "active": True,
        "condition": {"type": "not_a_thing"},
    }
    fake = _FakeRest([unknown])
    _patch_http(monkeypatch, fake)
    supa = ae.Supa("https://x.example.co", "k")
    data = ae.Data(str(tmp_path), None)

    receipt = ae.run_once(supa, data, datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc), "r1")

    assert receipt["outcome"] == "partial"
    assert receipt["unevaluable_n"] == 1
    assert receipt["evaluated_n"] == 0
    assert fake.disarmed == set()
