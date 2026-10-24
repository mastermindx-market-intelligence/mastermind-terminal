"""collect_cn_deep must never let an upstream outage overwrite a good cache.

The 2026-10-22 false-green: Tushare rejected the configured token, every call returned no
rows, and the collector wrote ZERO-row financials/holders parquets over valid data while the
shell reported success. These tests pin the contract that closes that hole:

  * importing the module performs no provider call and needs no token;
  * a rejected credential / missing entitlement / dead socket is a TYPED error, and an
    auth rejection is never retried;
  * a legitimately empty response stays data (a quiet 龙虎榜 session is not an outage);
  * a stage that hit a hard error writes nothing, leaving the last-good parquet byte-identical;
  * a partial holders refresh merges per symbol instead of deleting the others;
  * a holder's period is the provider's own end_date, never the build clock;
  * writes are atomic — no reader can see a half-published parquet.
"""
import datetime as dt
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]

# Hermetic: point the module's MACRO surface at a path that does not exist BEFORE import, so
# a stray TUSHARE_TOKEN in the developer's env can never reach a provider from this suite.
os.environ["MACRO_REPO"] = "/nonexistent-hermetic-macro-surface"
sys.path.insert(0, str(ROOT / "ingest"))
import collect_cn_deep as cnd  # noqa: E402


@pytest.fixture(autouse=True)
def _no_token_and_no_sleep(monkeypatch):
    """No credential, no provider, no real backoff — in every test."""
    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)
    cnd._TOKEN_CACHE = None
    monkeypatch.setattr(cnd.time, "sleep", lambda *_: None)
    yield
    cnd._TOKEN_CACHE = None


@pytest.fixture
def out(tmp_path, monkeypatch):
    """Redirect the collector's output store into the test's tmp dir."""
    d = tmp_path / "tushare"
    d.mkdir()
    monkeypatch.setattr(cnd, "OUT", d)
    return d


class _Resp:
    """Minimal stand-in for the object urlopen returns."""

    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _urlopen_returning(*payloads):
    """Serve the given payloads in order; fail the test if the queue runs dry."""
    payloads = list(payloads)
    calls = []

    def _open(req, timeout=None):
        calls.append(req)
        if not payloads:
            raise AssertionError("ts_call issued more provider requests than the test allows")
        item = payloads.pop(0)
        if isinstance(item, Exception):
            raise item
        return _Resp(item)

    _open.calls = calls
    return _open


def _raiser(exc):
    def _call(*_a, **_k):
        raise exc
    return _call


# ─────────────────────────────── import hygiene ───────────────────────────────
def test_import_makes_no_provider_call_and_requires_no_token(monkeypatch):
    """A module-level `TOKEN = _token()` made every import require a credential. Load a
    FRESH copy of the file with urlopen wired to explode and no token in the environment."""
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *a, **k: pytest.fail("provider called during import"))
    spec = importlib.util.spec_from_file_location(
        "cnd_fresh_import", ROOT / "ingest" / "collect_cn_deep.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # must not raise
    assert not hasattr(mod, "TOKEN"), "token must not be resolved at import time"


def test_missing_token_raises_typed_error_not_systemexit():
    with pytest.raises(cnd.MissingTokenError):
        cnd._token()


# ─────────────────────────────── typed upstream errors ───────────────────────────────
def test_auth_rejection_is_typed_and_never_retried(monkeypatch):
    """A rejected token fails identically for every later call, so retrying only wastes
    the rate budget and delays the abort."""
    cnd._TOKEN_CACHE = "rejected-token"
    open_ = _urlopen_returning({"code": -2001, "msg": "invalid token"})
    monkeypatch.setattr(urllib.request, "urlopen", open_)
    with pytest.raises(cnd.UpstreamAuthError):
        cnd.ts_call("daily", {})
    assert len(open_.calls) == 1, "auth failure must not be retried"


def test_permission_denial_is_not_retried(monkeypatch):
    cnd._TOKEN_CACHE = "unentitled-token"
    open_ = _urlopen_returning(
        {"code": -2002, "msg": "抱歉，您没有访问该接口的权限，积分不够或者分为0"})
    monkeypatch.setattr(urllib.request, "urlopen", open_)
    with pytest.raises(cnd.UpstreamPermissionError):
        cnd.ts_call("fina_indicator_vip", {"period": "20241231"})
    assert len(open_.calls) == 1, "entitlement failure must not be retried"


def test_transport_failure_retries_with_backoff_then_raises(monkeypatch):
    cnd._TOKEN_CACHE = "t"
    open_ = _urlopen_returning(*[urllib.error.URLError("connection reset")] * 3)
    monkeypatch.setattr(urllib.request, "urlopen", open_)
    with pytest.raises(cnd.UpstreamTransportError):
        cnd.ts_call("daily", {}, retries=3)
    assert len(open_.calls) == 3, "transport failures are retried before giving up"


def test_rate_limit_is_retried_and_can_recover(monkeypatch):
    cnd._TOKEN_CACHE = "t"
    open_ = _urlopen_returning(
        {"code": -2003, "msg": "抱歉，您每分钟最多访问该接口200次"},
        {"code": 0, "data": {"fields": ["ts_code"], "items": [["000001.SZ"]]}})
    monkeypatch.setattr(urllib.request, "urlopen", open_)
    assert cnd.ts_call("daily", {}) == (["ts_code"], [["000001.SZ"]])
    assert len(open_.calls) == 2


def test_legitimate_empty_response_is_data_not_an_error(monkeypatch):
    """The distinction the old code collapsed: an empty result is a real answer."""
    cnd._TOKEN_CACHE = "t"
    monkeypatch.setattr(urllib.request, "urlopen",
                        _urlopen_returning({"code": 0, "data": {"fields": [], "items": []}}))
    assert cnd.ts_call("top_list", {"trade_date": "20260103"}) == ([], [])


def test_message_classification_prefers_rate_limit_over_permission():
    assert cnd._classify("频率超限") is cnd.UpstreamRateLimited
    assert cnd._classify("系统繁忙，请稍后重试") is cnd.UpstreamRateLimited
    assert cnd._classify("invalid token") is cnd.UpstreamAuthError
    assert cnd._classify("您没有访问该接口的权限，积分不够") is cnd.UpstreamPermissionError
    assert cnd._classify("something else entirely") is cnd.UpstreamError


# ─────────────────────────────── last-good preservation ───────────────────────────────
def test_financials_auth_failure_preserves_last_good_byte_for_byte(out, monkeypatch):
    path = out / "financials.parquet"
    pd.DataFrame([{"ts_code": "000001.SZ", "years": [2024], "revenue": [1.0]}]).to_parquet(path)
    before = path.read_bytes()
    monkeypatch.setattr(cnd, "ts_call", _raiser(cnd.UpstreamAuthError("invalid token")))
    with pytest.raises(cnd.UpstreamAuthError):
        cnd.collect_financials([2024])
    assert path.read_bytes() == before, "a rejected credential must not touch the cache"


def test_financials_transport_failure_preserves_last_good(out, monkeypatch):
    path = out / "financials.parquet"
    pd.DataFrame([{"ts_code": "000001.SZ", "years": [2024], "revenue": [1.0]}]).to_parquet(path)
    before = path.read_bytes()
    monkeypatch.setattr(cnd, "ts_call", _raiser(cnd.UpstreamTransportError("socket died")))
    with pytest.raises(cnd.UpstreamTransportError):
        cnd.collect_financials([2024])
    assert path.read_bytes() == before, "a partial walk must not be published"


def test_lhb_all_quiet_sessions_publishes_an_empty_frame(out, monkeypatch):
    """A quiet week is real data. Every session answering empty must NOT be mistaken for a
    failed run — otherwise a holiday would wipe the 龙虎榜 cache."""
    monkeypatch.setattr(cnd, "ts_call", lambda *a, **k: ([], []))
    cnd.collect_lhb(1)
    assert (out / "lhb.parquet").exists()
    assert pd.read_parquet(out / "lhb.parquet").empty


def test_lhb_failed_session_preserves_last_good(out, monkeypatch):
    path = out / "lhb.parquet"
    pd.DataFrame([{"ts_code": "000001.SZ", "lhb_count": 3}]).to_parquet(path)
    before = path.read_bytes()
    monkeypatch.setattr(cnd, "ts_call", _raiser(cnd.UpstreamRateLimited("throttled")))
    with pytest.raises(cnd.UpstreamRateLimited):
        cnd.collect_lhb(1)
    assert path.read_bytes() == before


# ─────────────────────────────── holders: per-symbol merge ───────────────────────────────
@pytest.fixture
def cn_site(tmp_path, monkeypatch):
    site = tmp_path / "site"
    site.mkdir()
    for code in ("000001.SZ", "000002.SZ", "000003.SZ"):
        (site / f"{code}.json").write_text("{}")
    monkeypatch.setattr(cnd, "CN_SITE", site)
    return site


def test_partial_holders_refresh_merges_and_keeps_every_other_symbol(out, cn_site, monkeypatch):
    path = out / "holders.parquet"
    pd.DataFrame([
        {"ts_code": "000001.SZ", "period": "20240331", "holders_json": "OLD-A"},
        {"ts_code": "000002.SZ", "period": "20240331", "holders_json": "OLD-B"},
        {"ts_code": "000003.SZ", "period": "20240331", "holders_json": "OLD-C"},
    ]).to_parquet(path)

    def fake_ts_call(api, params, fields="", retries=4):
        code = params["ts_code"]
        if code == "000001.SZ":
            raise cnd.UpstreamTransportError("socket died")
        if code == "000002.SZ":
            return [], []                                    # legitimate empty
        return (["ts_code", "end_date", "holder_name", "hold_ratio", "hold_change", "holder_type"],
                [["000003.SZ", "20250630", "NEW-C HOLDER", 1.5, 0.1, "个人"]])

    monkeypatch.setattr(cnd, "ts_call", fake_ts_call)
    cnd.collect_holders(2, 0)

    df = pd.read_parquet(path).set_index("ts_code")
    assert set(df.index) == {"000001.SZ", "000002.SZ", "000003.SZ"}, "no symbol may be dropped"
    assert df.loc["000001.SZ", "holders_json"] == "OLD-A", "failed symbol keeps last-good"
    assert df.loc["000002.SZ", "holders_json"] == "OLD-B", "empty answer carries no new information"
    assert "NEW-C HOLDER" in df.loc["000003.SZ", "holders_json"]
    assert df.loc["000003.SZ", "period"] == "20250630", "period is the source end_date, not the build clock"


def test_holders_total_failure_preserves_last_good(out, cn_site, monkeypatch):
    path = out / "holders.parquet"
    pd.DataFrame([{"ts_code": "000001.SZ", "period": "20240331",
                   "holders_json": "OLD-A"}]).to_parquet(path)
    before = path.read_bytes()
    monkeypatch.setattr(cnd, "ts_call", _raiser(cnd.UpstreamTransportError("socket died")))
    with pytest.raises(cnd.UpstreamError):
        cnd.collect_holders(2, 0)
    assert path.read_bytes() == before


def test_holders_rejected_credential_is_fatal_for_the_whole_run(out, cn_site, monkeypatch):
    monkeypatch.setattr(cnd, "ts_call", _raiser(cnd.UpstreamAuthError("invalid token")))
    with pytest.raises(cnd.UpstreamAuthError):
        cnd.collect_holders(2, 0)
    assert not (out / "holders.parquet").exists(), "nothing may be written from a dead credential"


# ─────────────────────────────── atomic writes ───────────────────────────────
def test_atomic_write_leaves_no_temp_files_behind(out):
    cnd._atomic_write_parquet(pd.DataFrame([{"a": 1}]), out / "x.parquet")
    assert [p.name for p in out.iterdir()] == ["x.parquet"]


def test_failed_serialisation_leaves_the_previous_file_intact(out, monkeypatch):
    path = out / "x.parquet"
    pd.DataFrame([{"a": 1}]).to_parquet(path)
    before = path.read_bytes()

    def boom(self, *a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(pd.DataFrame, "to_parquet", boom)
    with pytest.raises(RuntimeError):
        cnd._atomic_write_parquet(pd.DataFrame([{"a": 2}]), path)
    assert path.read_bytes() == before
    assert [p.name for p in out.iterdir()] == ["x.parquet"], "no partial temp file may survive"


def test_unreadable_cache_does_not_crash_the_merge(out):
    assert cnd._read_last_good(out / "absent.parquet") is None
    corrupt = out / "corrupt.parquet"
    corrupt.write_bytes(b"not a parquet")
    assert cnd._read_last_good(corrupt) is None


# ─────────────────────────────── rolling horizon ───────────────────────────────
def test_fiscal_year_horizon_rolls_forward_and_reproduces_the_hardcoded_window():
    """2019..2025 was hardcoded. In 2026 the rolling window must equal it exactly, and it
    must advance by itself instead of freezing."""
    assert cnd.fiscal_years(7, dt.date(2026, 10, 21)) == [2019, 2020, 2021, 2022, 2023, 2024, 2025]
    assert cnd.fiscal_years(7, dt.date(2027, 1, 5)) == [2020, 2021, 2022, 2023, 2024, 2025, 2026]
    # A fiscal year is only complete once the next calendar year has begun, so a run in
    # January must not try to fetch the not-yet-published year.
    assert cnd.fiscal_years(7, dt.date(2030, 12, 31))[-1] == 2029


# ─────────────────────────────── driver contract ───────────────────────────────
def test_main_reports_incomplete_and_nonzero_when_a_stage_fails(out, monkeypatch, capsys):
    monkeypatch.setattr(cnd, "ts_call", _raiser(cnd.UpstreamAuthError("invalid token")))
    rc = cnd.main(["--stages", "financials,lhb,holders", "--years", "1"])
    out_text = capsys.readouterr().out
    assert rc == 1
    assert "collect_cn_deep: INCOMPLETE" in out_text
    # A dead credential means later stages are not attempted rather than retried into the ground.
    assert "NOT ATTEMPTED" in out_text


def test_main_returns_zero_when_every_stage_publishes(out, monkeypatch, capsys):
    monkeypatch.setattr(cnd, "ts_call", lambda *a, **k: ([], []))
    monkeypatch.setattr(cnd, "collect_holders", lambda w, l: None)
    rc = cnd.main(["--stages", "financials,lhb", "--years", "1"])
    assert rc == 0
    assert "collect_cn_deep: OK" in capsys.readouterr().out


def test_main_rejects_an_unknown_stage():
    assert cnd.main(["--stages", "financials,bogus"]) == 2