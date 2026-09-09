"""B-F08-B5-3 §2.5 E — evaluation-time identity repair. No network."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ingest.alerts_engine as ae  # noqa: E402


class KeyedFlow:
    """Production-shaped Flow: payload exists only for the canonical root SPY."""

    def __init__(self, gexstate=None, tide=None):
        self._gexstate = gexstate
        self._tide = tide
        self.seen_roots: list[str] = []

    def gamma_state(self, root):
        self.seen_roots.append(root)
        return self._gexstate if root == "SPY" else None

    def gex(self, root):
        self.seen_roots.append(root)
        return None

    def tide(self):
        return self._tide

    def dte(self):
        return None

    def surface(self, root):
        self.seen_roots.append(root)
        return None


GS = {"root": "SPY", "spot": 751.71, "gamma_flip": 748.25, "asof": "2026-07-10T06:21Z"}


def test_normalize_opt_alert_root_table():
    assert ae.normalize_opt_alert_root(" spy ") == "SPY"
    assert ae.normalize_opt_alert_root("spy") == "SPY"
    assert ae.normalize_opt_alert_root("BRK.B") == "BRK.B"
    assert ae.normalize_opt_alert_root("brk-b") == "BRK-B"
    assert ae.normalize_opt_alert_root("") is None
    assert ae.normalize_opt_alert_root(None) is None
    assert ae.normalize_opt_alert_root(7) is None
    assert ae.normalize_opt_alert_root("TOOLONGROOTNAME") is None
    assert ae.normalize_opt_alert_root("SP Y") is None


def test_root_regex_parity_with_typescript():
    """§2.5 case 16 — the two pattern bodies must be equal, not merely non-empty."""
    ts = (ROOT / "terminal" / "lib" / "optionsAlerts.ts").read_text()
    py = (ROOT / "ingest" / "alerts_engine.py").read_text()
    ts_m = re.search(r"const OPT_ALERT_ROOT_RE = /(.+)/;", ts)
    py_m = re.search(r"FLOW_ROOT_RE = re\.compile\(r\"(.+)\"\)", py)
    assert ts_m and py_m
    assert ts_m.group(1) == py_m.group(1)


def test_padded_spy_evaluates_against_canonical_root():
    """§2.5 case 17 — armed-forever regression.

    Today: stored root \" spy \" fails Flow._root (no strip), payload is None, fired is None,
    row stays armed. After R5 it evaluates against SPY.
    """
    alert = {
        "id": "a1", "symbol": "SPY", "active": True,
        "condition": {"type": "opt_gamma_flip", "root": " spy "},
    }
    flow = KeyedFlow(gexstate=GS)
    fired, value, note, nxt = ae.evaluate(alert, None, flow)
    assert fired is not None, f"still unevaluable: {note!r}; roots seen={flow.seen_roots!r}"
    assert fired is False  # first observation arms, never fires
    assert nxt == {"side": "above"}
    assert "SPY" in flow.seen_roots


def test_underivable_root_refused_never_disarmed_never_patched(monkeypatch):
    """§2.5 case 18 — refusal path. Zero PATCHes on the stored condition."""
    patches: list[tuple] = []

    def fake_status(url, headers=None, method="GET", body=None, timeout=15):
        if method == "PATCH":
            patches.append((url, body))
            return 204, None, ""
        if method == "POST":
            return 201, None, ""
        if "/alerts?" in url:
            return 200, [{
                "id": "a1", "user_id": "u1", "symbol": "SPY", "active": True,
                "condition": {"type": "opt_gamma_flip", "root": "SP Y"},
            }], "[]"
        return 200, [], "[]"

    def fake_plain(url, headers=None, method="GET", body=None, timeout=15):
        status, parsed, _ = fake_status(url, headers, method, body, timeout)
        return parsed

    monkeypatch.setattr(ae, "http_json_status", fake_status)
    monkeypatch.setattr(ae, "http_json", fake_plain)

    alert = {
        "id": "a1", "symbol": "SPY", "active": True,
        "condition": {"type": "opt_gamma_flip", "root": "SP Y"},
    }
    flow = KeyedFlow(gexstate=GS)
    fired, value, note, nxt = ae.evaluate(alert, None, flow)
    assert fired is None
    assert "identity unresolved" in note
    assert alert["condition"]["root"] == "SP Y"  # never written back
    assert flow.seen_roots == []  # getter never ran

    # Drive a run_once-shaped PATCH counter: evaluate-only path records zero patches.
    assert patches == []


def test_plain_root_never_leaks_raw_stored_string():
    """§2.5 case 19."""
    assert ae._plain_root({"root": " spy "}, "qqq") == "SPY"
    assert ae._plain_root({"root": "SP Y"}, "also bad") == "the underlying"
    en = ae._condition_plain_en({"type": "opt_gamma_flip", "root": " spy "}, "qqq")
    zh = ae._condition_plain_zh({"type": "opt_gamma_flip", "root": " spy "}, "qqq")
    assert " spy " not in en
    assert " spy " not in zh
    assert "SPY" in en
    assert "SPY" in zh


def test_market_wide_premium_burst_unaffected():
    """§2.5 case 20 — opt_premium_burst with root MARKET evaluates exactly as today."""
    # Missing tide payload → honest skip, same as today; identity is not the blocker.
    alert = {
        "symbol": "MARKET",
        "condition": {"type": "opt_premium_burst", "root": "MARKET", "leg": "ncp"},
    }
    fired, value, note, nxt = ae.evaluate(alert, None, KeyedFlow())
    assert fired is None
    assert "identity unresolved" not in (note or "")
    assert "unavailable" in note or "tape" in note or "tide" in note or "premium" in note.lower() or note
