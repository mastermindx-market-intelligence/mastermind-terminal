"""Synthetic transport -> existing producer -> atomic source store conformance.

No provider calls, runtime stores, outcomes or admission changes.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import multiprocessing
import os
import subprocess
import sys
import threading
import urllib.error
from datetime import datetime, timezone
from email.message import Message
from urllib.response import addinfourl
from pathlib import Path
from unittest.mock import patch

import pytest

with patch.dict(os.environ, {"POLYGON_API_KEY": "capture-test-key-not-a-credential"}):
    from ingest import backfill_intraday as writer
from ingest import intraday_capture as cap

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 7, 16, tzinfo=timezone.utc).timestamp()
EVENT = int(datetime(2026, 10, 6, 14, tzinfo=timezone.utc).timestamp() * 1000)
TOKEN = "capture-test-key-not-a-credential"
CAPTURE_OPEN = getattr(writer, "_open_capture_request", None)


def bar(index=0, *, close=100, volume=10):
    return {"t": EVENT + index * 60000, "o": 100, "h": max(102, close),
            "l": 98, "c": close, "v": volume}


def response(rows=(), *, next_url=None, status="OK", **extra):
    data = {"status": status, "adjusted": True, "results": list(rows), **extra}
    if next_url is not None:
        data["next_url"] = next_url
    return json.dumps(data, separators=(",", ":")).encode()


def install(monkeypatch, body):
    def urlopen(request, *args, **kwargs):
        result = body(request) if callable(body) else body
        return io.BytesIO(result)
    monkeypatch.setattr(writer, "_open_capture_request", urlopen)


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setattr(writer, "INTRADAY", tmp_path / "intraday")
    monkeypatch.setattr(writer, "POLY", TOKEN)
    monkeypatch.setattr(writer.time, "time", lambda: NOW)
    clock = iter(range(int(NOW * 1e9), int(NOW * 1e9) + 10**12, 1_000_000))
    monkeypatch.setattr(writer.time, "time_ns", lambda: next(clock))
    monkeypatch.setattr(writer.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(writer, "is_nyse_holiday", lambda day: False)
    monkeypatch.setenv("POLYGON_API_KEY", TOKEN)
    def forbidden(*args, **kwargs):
        raise AssertionError("real transport forbidden")
    monkeypatch.setattr(writer.urllib.request, "urlopen", forbidden)
    monkeypatch.setattr(writer, "_open_capture_request", forbidden)
    return writer.INTRADAY / "SPY.1m.json"


def run(*extra):
    return writer.main(["--capture-minutes", "--symbols", "SPY", "--tf", "1m",
                        "--workers", "1", *extra])


def read(path):
    value = json.loads(path.read_bytes())
    cap.validate_envelope(value["minute_capture"], "SPY")
    return value


def payloads(path):
    return [record["payload"] for record in read(path)["minute_capture"]["captures"]]


def test_original_values_round_trip_and_credentials_never_persist(env, monkeypatch):
    rows = [bar(0, volume=1.75), bar(1, volume=None), bar(2)]
    del rows[2]["v"]
    rows[0].update({"apiKey": TOKEN, "message": TOKEN, "vw": 100.25, "n": 4})
    raw = response(rows, apiKey=TOKEN, request_url="https://example.invalid/?apiKey=" + TOKEN)
    install(monkeypatch, raw)
    assert run() == 0
    doc = read(env)
    payload = payloads(env)[0]
    original = [observation["raw"] for observation in payload["observations"]]
    assert original[0]["v"] == 1.75 and original[1]["v"] is None and "v" not in original[2]
    assert [row[5] for row in doc["bars"]] == [1, 0, 0]
    assert set(original[0]) == {"t", "o", "h", "l", "c", "v"}
    assert payload["pages"][0]["response_sha256"] == hashlib.sha256(raw).hexdigest()
    assert payload["pages"][0]["response_bytes"] == len(raw)
    assert payload["observations"][0]["event_start_utc_ms"] == rows[0]["t"]
    assert payload["request"]["adjusted"] is True
    assert TOKEN.encode() not in env.read_bytes()
    assert b"request_url" not in env.read_bytes() and b"known_at" not in env.read_bytes()
    assert doc["minute_capture"]["authority"] == cap.AUTHORITY
    assert len(doc["bars"]) == 3  # short stores are retained only under capture mode


def test_corrections_reversion_and_only_consecutive_suppression(env, monkeypatch):
    for close in [100, 100, 100.25, 100]:
        install(monkeypatch, response([bar(close=close)]))
        assert run() == 0
    captures = payloads(env)
    assert [p["counts"]["observations_retained"] for p in captures] == [1, 0, 1, 1]
    assert captures[1]["counts"]["unchanged_suppressed"] == 1
    assert [o["raw"]["c"] for p in captures for o in p["observations"]] == [100, 100.25, 100]
    records = read(env)["minute_capture"]["captures"]
    assert records[1]["previous_capture_sha256"] == records[0]["capture_sha256"]
    assert records[0]["payload"]["observations"][0]["raw"]["c"] == 100


def test_exact_capture_id_replay_and_conflict(env, monkeypatch):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    envelope = read(env)["minute_capture"]
    record = envelope["captures"][0]
    replay = cap.append_capture(envelope, record["payload"], record["capture_id"])
    assert cap.canonical_bytes(replay) == cap.canonical_bytes(envelope)
    changed = copy.deepcopy(record["payload"])
    changed["completed_at_utc_ns"] += 1
    with pytest.raises(cap.CaptureError, match="capture_id_conflict"):
        cap.append_capture(envelope, changed, record["capture_id"])


def test_first_empty_and_forming_only_success_are_distinct(env, monkeypatch):
    install(monkeypatch, response())
    assert run() == 0
    assert read(env)["bars"] == []
    forming = bar()
    forming["t"] = int(NOW * 1000) - 60000
    install(monkeypatch, response([forming]))
    assert run() == 0
    first, second = payloads(env)
    assert first["status"] == second["status"] == "complete"
    assert first["counts"]["rows_received"] == 0
    assert second["counts"]["rows_received"] == second["counts"]["forming_skipped"] == 1
    assert first["observations"] == second["observations"] == []
    assert second["finality_lag_s"] == 900
    assert second["finality_reference_utc_ns"] == int(NOW * 1e9)


def test_later_page_failure_keeps_chart_and_does_not_poison_complete_compaction(env, monkeypatch):
    original = [bar(i) for i in range(25)]
    install(monkeypatch, response(original))
    assert run() == 0
    chart_before = read(env)["bars"]
    changed = copy.deepcopy(original)
    changed[-1]["c"] = 100.25
    def partial(request):
        if "cursor=next" in request.full_url:
            raise urllib.error.HTTPError(request.full_url, 503, "upstream " + TOKEN, {}, None)
        return response(changed, next_url=cursor_url(request))
    install(monkeypatch, partial)
    assert run() == 1
    assert read(env)["bars"] == chart_before
    partial_payload = payloads(env)[-1]
    assert partial_payload["status"] == "partial"
    assert partial_payload["failure_kind"] == "transport_exhausted"
    assert partial_payload["counts"]["unchanged_suppressed"] == 0
    install(monkeypatch, response(changed))
    assert run() == 0
    complete = payloads(env)[-1]
    assert complete["status"] == "complete"
    assert complete["counts"]["observations_retained"] == 1
    assert complete["observations"][0]["raw"]["c"] == 100.25
    assert TOKEN.encode() not in env.read_bytes()


@pytest.mark.parametrize("body,reason,retained", [
    (b'not JSON containing capture-test-key-not-a-credential', "malformed_response", 0),
    (response([bar(), {"t": "not a timestamp"}]), "malformed_bar", 1),
    (response([], status="private error message"), "invalid_response", 0),
])
def test_failed_and_malformed_attempts_are_explicit(env, monkeypatch, body, reason, retained):
    install(monkeypatch, body)
    assert run() == 1
    doc = read(env)
    payload = payloads(env)[0]
    assert payload["status"] == "partial" and payload["failure_kind"] == reason
    assert len(payload["observations"]) == retained and doc["bars"] == []
    assert TOKEN.encode() not in env.read_bytes()


def test_transport_failure_before_response_is_failed_not_empty(env, monkeypatch):
    def failed(_request):
        raise urllib.error.URLError("synthetic no network " + TOKEN)
    install(monkeypatch, failed)
    assert run() == 1
    payload = payloads(env)[0]
    assert payload["status"] == "failed" and payload["failure_kind"] == "transport_exhausted"
    assert payload["pages"] == [] and payload["observations"] == []


def test_basis_rebuild_retains_prior_observations(env, monkeypatch):
    original = [bar(i) for i in range(25)]
    install(monkeypatch, response(original))
    assert run() == 0
    before = copy.deepcopy(read(env)["minute_capture"]["captures"][0])
    adjusted = [{key: (value * 0.5 if key in ("o", "h", "l", "c") else value)
                 for key, value in row.items()} for row in original]
    install(monkeypatch, response(adjusted))
    assert run() == 0
    doc = read(env)
    assert doc["minute_capture"]["captures"][0] == before
    assert doc["bars"][-1][4] == 50
    assert len(doc["minute_capture"]["captures"]) == 3  # overlap plus bounded full rebuild
    assert payloads(env)[1]["counts"]["observations_retained"] == 25
    assert payloads(env)[2]["counts"]["unchanged_suppressed"] == 25


@pytest.mark.parametrize("capacity", ["MAX_CAPTURES", "MAX_RESPONSE_BYTES", "MAX_FILE_BYTES", "MAX_CAPTURE_PAGES"])
def test_capacity_refusal_keeps_prior_file_byte_identical(env, monkeypatch, capacity, capsys):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    before = env.read_bytes()
    limit = {"MAX_CAPTURES": 1, "MAX_RESPONSE_BYTES": 8,
             "MAX_FILE_BYTES": len(before) + 8, "MAX_CAPTURE_PAGES": 1}[capacity]
    monkeypatch.setattr(cap, capacity, limit)
    install(monkeypatch, lambda request: response([bar(close=100.25)],
            next_url=cursor_url(request) if capacity == "MAX_CAPTURE_PAGES" else None))
    assert run() == 1
    assert env.read_bytes() == before
    output = capsys.readouterr().out
    assert "capacity" in output or "refused" in output


def test_enabled_file_stays_captured_on_existing_owner_refresh(env, monkeypatch):
    install(monkeypatch, response([bar(i) for i in range(25)]))
    assert run() == 0
    assert writer.main(["--existing-only", "--tf", "1m", "--workers", "1"]) == 0
    assert len(payloads(env)) == 2
    assert payloads(env)[-1]["counts"]["unchanged_suppressed"] == 25
    before = env.read_bytes()
    with pytest.raises(cap.CaptureError, match="capture_context_required"):
        writer.write_store("SPY", "1m", read(env)["bars"])
    assert env.read_bytes() == before


def test_tampered_prefix_refuses_before_transport(env, monkeypatch):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    doc = read(env)
    doc["minute_capture"]["captures"][0]["payload"]["observations"][0]["raw"]["v"] = 200
    env.write_text(json.dumps(doc))
    before = env.read_bytes()
    def forbidden(*args, **kwargs):
        raise AssertionError("must reject corrupted prefix before fetching")
    install(monkeypatch, forbidden)
    assert run() == 1
    assert env.read_bytes() == before


@pytest.mark.parametrize("arguments", [
    ["--capture-minutes"], ["--capture-minutes", "--symbols", ""],
    ["--capture-minutes", "--symbols", "SPY,SPY"],
    ["--capture-minutes", "--symbols", "../SPY"],
    ["--capture-minutes", "--symbols", "SPY", "--tf", "5m"],
    ["--capture-minutes", "--symbols", "SPY", "--top", "2"],
    ["--capture-minutes", "--symbols", "SPY", "--existing-only"],
    ["--symbols", "SPY"],
    ["--capture-minutes", "--symbols", ",".join("S" + str(i) for i in range(17))],
])
def test_capture_requires_explicit_bounded_true_minute_cohort(env, arguments):
    assert writer.main(arguments) == 64
    assert not env.exists()


def test_capture_does_not_follow_untrusted_pagination_host(env, monkeypatch):
    calls = []
    def provider(request):
        calls.append(request.full_url)
        return response([bar()], next_url="https://untrusted.invalid/?q=secret")
    install(monkeypatch, provider)
    assert run() == 1 and len(calls) == 1
    assert payloads(env)[0]["failure_kind"] == "invalid_response"
    assert b"untrusted.invalid" not in env.read_bytes()


@pytest.mark.parametrize("raw_first", [False, True])
def test_cross_process_updates_serialize_entire_fetch_and_append(env, monkeypatch, raw_first):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    context = multiprocessing.get_context("fork")
    first_entered, second_entered, release = context.Event(), context.Event(), context.Event()
    exits = context.Queue()

    def child(close, entered, block):
        def provider(_request, *args, **kwargs):
            entered.set()
            if block and not release.wait(5):
                raise AssertionError("test release missing")
            return io.BytesIO(response([bar(close=close)], adjusted=not (raw_first and block)))
        writer._open_capture_request = provider
        exits.put(run_raw() if raw_first and block else run())

    first = context.Process(target=child, args=(100.25, first_entered, True))
    second = context.Process(target=child, args=(100.5, second_entered, False))
    first.start()
    try:
        assert first_entered.wait(5)
        second.start()
        assert not second_entered.wait(0.2), "second fetch entered before first transaction released"
        release.set()
        first.join(10); second.join(10)
        assert first.exitcode == second.exitcode == 0
        assert sorted([exits.get(timeout=2), exits.get(timeout=2)]) == [0, 0]
        assert [p["observations"][0]["raw"]["c"] for p in payloads(env)] == [100, 100.25, 100.5]
    finally:
        release.set()
        for process in (first, second):
            if process.pid is not None and process.is_alive():
                process.terminate(); process.join(5)


@pytest.mark.parametrize("raw_mode", [False, True])
def test_actual_file_entry_pins_repo_and_captures_from_outside_checkout(tmp_path, raw_mode):
    foreign = tmp_path / "foreign"
    (foreign / "ingest").mkdir(parents=True)
    marker = tmp_path / "foreign-imported"
    (foreign / "ingest" / "__init__.py").write_text(
        "raise RuntimeError('foreign ingest must never execute')")
    body = response([bar(volume=1.25)], adjusted=not raw_mode)
    flag = "--capture-unadjusted-minutes" if raw_mode else "--capture-minutes"
    script = ROOT / "ingest" / "backfill_intraday.py"
    program = (
        "import io,runpy,sys,urllib.request\n"
        "from types import SimpleNamespace\n"
        "def forbidden(*a,**k): raise AssertionError('urlopen transport forbidden')\n"
        "urllib.request.urlopen=forbidden\n"
        f"urllib.request.build_opener=lambda *handlers: SimpleNamespace(open=lambda *a,**k: io.BytesIO({body!r}))\n"
        f"sys.argv=[{str(script)!r},{flag!r},'--symbols','SPY','--workers','1']\n"
        f"runpy.run_path({str(script)!r},run_name='__main__')\n")
    environment = dict(os.environ, POLYGON_API_KEY=TOKEN, TERMINAL_DATA_DIR=str(tmp_path / "out"),
                       PYTHONPATH=os.pathsep.join([str(foreign), str(ROOT)]))
    result = subprocess.run([sys.executable, "-c", program], cwd=tmp_path, env=environment,
                            text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
    path = tmp_path / "out" / "intraday" / "SPY.1m.json"
    assert payloads(path)[0]["observations"][0]["raw"]["v"] == 1.25
    assert (read(path)["bars"] == []) is raw_mode
    assert not marker.exists()


def test_replay_of_a_compacted_capture_uses_its_immutable_seal(env, monkeypatch):
    original = [bar(i) for i in range(25)]
    install(monkeypatch, response(original))
    assert run() == 0
    changed = copy.deepcopy(original)
    changed[-1]["c"] = 100.25
    install(monkeypatch, response(changed))
    assert run() == 0
    envelope = read(env)["minute_capture"]
    record = envelope["captures"][-1]
    assert record["payload"]["counts"]["unchanged_suppressed"] == 24
    assert len(record["payload"]["observations"]) == 1
    replay = cap.append_sealed_capture(envelope, record)
    assert cap.canonical_bytes(replay) == cap.canonical_bytes(envelope)
    altered = copy.deepcopy(record)
    altered["payload"]["completed_at_utc_ns"] += 1
    with pytest.raises(cap.CaptureError, match="capture_id_conflict"):
        cap.append_sealed_capture(envelope, altered)


def test_in_memory_attempt_replay_does_not_recompact_or_reclock(env, monkeypatch):
    raw = response([bar(i) for i in range(25)])
    install(monkeypatch, raw)
    assert run() == 0
    envelope = read(env)["minute_capture"]
    previous = envelope["captures"][0]["payload"]
    session = cap.CaptureSession("SPY", envelope)
    attempt = cap.CaptureAttempt("SPY", previous["request"], previous["finality_reference_utc_ns"],
                                 clock=writer.time.time_ns)
    page = attempt.received(raw, writer.time.time_ns(), writer.time.time_ns())
    page.update(status="OK", rows_received=25, finalized_rows=25,
                response_adjusted={"state": "TRUE"})
    attempt.data["observations"] = copy.deepcopy(previous["observations"])
    attempt.data["observations"][-1]["raw"]["c"] = 100.25
    session.retain(attempt)
    assert session.envelope["captures"][-1]["payload"]["counts"]["unchanged_suppressed"] == 24
    before = cap.canonical_bytes(session.envelope)
    session.retain(attempt)
    assert cap.canonical_bytes(session.envelope) == before
    attempt.data["observations"][-1]["raw"]["c"] = 100.5
    with pytest.raises(cap.CaptureError, match="capture_id_conflict"):
        session.retain(attempt)


def test_capture_replace_failure_does_not_retry_and_preserves_old_bytes(env, monkeypatch):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    before = env.read_bytes()
    calls = []
    def failed_replace(*args):
        calls.append(args)
        raise OSError("synthetic replace failure")
    monkeypatch.setattr(writer.os, "replace", failed_replace)
    install(monkeypatch, response([bar(close=100.25)]))
    assert run() == 1
    assert len(calls) == 1
    assert env.read_bytes() == before
    assert not list(env.parent.glob("*.tmp.*"))


def test_invalid_empty_envelope_is_not_treated_as_initial_capture(env, monkeypatch):
    env.parent.mkdir(parents=True)
    env.write_text(json.dumps({"t": "SPY", "tf": "1m", "src": "polygon",
                               "bars": [], "minute_capture": {}}))
    before = env.read_bytes()
    assert run() == 1
    assert env.read_bytes() == before


def cursor_url(request, query="cursor=next"):
    parts = writer.urllib.parse.urlsplit(request.full_url)
    return writer.urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


@pytest.mark.parametrize("conflict", [
    "symbol", "multiplier", "timespan", "from_date", "to_date",
    "adjusted", "sort", "limit", "duplicate_adjusted",
])
def test_reviewed_pagination_refuses_identity_change_before_second_request(env, monkeypatch, conflict):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    before = read(env)
    calls = []
    def provider(request):
        calls.append(request.full_url)
        next_url = cursor_url(request)
        parts = writer.urllib.parse.urlsplit(next_url)
        path = parts.path
        query = "cursor=next"
        if conflict == "symbol":
            path = path.replace("/ticker/SPY/", "/ticker/QQQ/")
        elif conflict == "multiplier":
            path = path.replace("/range/1/minute/", "/range/5/minute/")
        elif conflict == "timespan":
            path = path.replace("/range/1/minute/", "/range/1/hour/")
        elif conflict in ("from_date", "to_date"):
            segments = path.split("/")
            segments[-2 if conflict == "from_date" else -1] = "2000-01-01"
            path = "/".join(segments)
        else:
            query += {"adjusted": "&adjusted=false", "sort": "&sort=desc",
                      "limit": "&limit=1",
                      "duplicate_adjusted": "&adjusted=true&adjusted=false"}[conflict]
        if len(calls) > 1:
            raise AssertionError("wrong-identity pagination must not be requested")
        return response([bar(close=100.25)], ticker="SPY",
                        next_url=writer.urllib.parse.urlunsplit(
                            (parts.scheme, parts.netloc, path, query, "")))
    install(monkeypatch, provider)
    assert run() == 1
    assert len(calls) == 1
    after = read(env)
    assert after["bars"] == before["bars"]
    assert after["minute_capture"]["captures"][0] == before["minute_capture"]["captures"][0]
    assert payloads(env)[-1]["status"] == "partial"
    assert payloads(env)[-1]["failure_kind"] == "invalid_response"


@pytest.mark.parametrize("query", ["cursor=next", "cursor=next&adjusted=true&sort=asc&limit=50000"])
def test_reviewed_same_request_cursor_pagination_remains_valid(env, monkeypatch, query):
    calls = []
    def provider(request):
        calls.append(request.full_url)
        if len(calls) == 1:
            return response([bar()], ticker="SPY",
                            next_url=cursor_url(request, query))
        return response([bar(1)], ticker="SPY")
    install(monkeypatch, provider)
    assert run() == 0
    payload = payloads(env)[0]
    assert len(calls) == 2 and payload["status"] == "complete"
    assert len(read(env)["bars"]) == 2
    assert [observation["page_index"] for observation in payload["observations"]] == [0, 1]


@pytest.mark.parametrize("mismatch_page", [0, 1])
def test_reviewed_conflicting_response_ticker_never_contributes_rows(env, monkeypatch, mismatch_page):
    install(monkeypatch, response([bar()], ticker="SPY"))
    assert run() == 0
    before = read(env)["bars"]
    calls = []
    def provider(request):
        page_index = len(calls)
        calls.append(request.full_url)
        if page_index == mismatch_page:
            return response([bar(page_index, close=2000)], ticker="QQQ")
        return response([bar(close=100.25)], ticker="SPY", next_url=cursor_url(request))
    install(monkeypatch, provider)
    assert run() == 1
    payload = payloads(env)[-1]
    assert read(env)["bars"] == before
    assert payload["status"] == "partial" and payload["failure_kind"] == "invalid_response"
    assert all(observation["raw"]["c"] != 2000 for observation in payload["observations"])
    assert len(payload["observations"]) == mismatch_page
    assert payload["pages"][-1]["status"] == "INVALID"


@pytest.mark.parametrize("initial", ["empty", "forming", "failed"])
def test_reviewed_enabled_empty_store_recovers_through_existing_only(env, monkeypatch, initial):
    if initial == "failed":
        def first(_request):
            raise urllib.error.URLError("synthetic source unavailable")
    elif initial == "forming":
        row = bar()
        row["t"] = int(NOW * 1000) - 60000
        first = response([row])
    else:
        first = response()
    install(monkeypatch, first)
    assert run() == (1 if initial == "failed" else 0)
    before = read(env)
    assert before["bars"] == []
    calls = []
    def recovered(request):
        calls.append(request.full_url)
        return response([bar()], ticker="SPY")
    install(monkeypatch, recovered)
    assert writer.main(["--existing-only", "--tf", "1m", "--workers", "1"]) == 0
    assert len(calls) == 1
    after = read(env)
    assert len(after["bars"]) == 1
    assert len(after["minute_capture"]["captures"]) == 2
    assert after["minute_capture"]["captures"][0] == before["minute_capture"]["captures"][0]
    assert after["minute_capture"]["captures"][1]["previous_capture_sha256"] == before["minute_capture"]["prefix_sha256"]
    assert payloads(env)[-1]["status"] == "complete"


@pytest.mark.parametrize("legacy", ["empty", "unreadable", "missing"])
def test_reviewed_legacy_empty_unreadable_missing_stays_refused(env, monkeypatch, legacy):
    if legacy != "missing":
        env.parent.mkdir(parents=True)
        env.write_bytes(b"{unreadable" if legacy == "unreadable" else json.dumps(
            {"t": "SPY", "tf": "1m", "src": "polygon", "bars": []}).encode())
    before = env.read_bytes() if env.exists() else None
    calls = []
    def forbidden(request):
        calls.append(request.full_url)
        raise AssertionError("legacy refusal must not fetch")
    install(monkeypatch, forbidden)
    assert writer.main(["--existing-only", "--tf", "1m", "--workers", "1"]) == (
        2 if legacy == "missing" else 1)
    assert calls == []
    assert (env.read_bytes() if env.exists() else None) == before


def install_standard_urllib_transport(monkeypatch, provider):
    """Use standard urllib HTTP/error/redirect dispatch with synthetic HTTPS bodies."""
    build_opener = writer.urllib.request.build_opener
    class SyntheticHTTPSHandler(writer.urllib.request.HTTPSHandler):
        def https_open(self, request):
            code, location, body = provider(request)
            headers = Message()
            if location is not None:
                headers["Location"] = location
            result = addinfourl(io.BytesIO(body), headers, request.full_url, code)
            result.msg = "Found" if code == 302 else "OK"
            return result
    def injected_opener(*handlers):
        return build_opener(*handlers, SyntheticHTTPSHandler())
    monkeypatch.setattr(writer.urllib.request, "build_opener", injected_opener)
    # Support reproducing the old urlopen path and testing the repaired private opener.
    monkeypatch.setattr(writer.urllib.request, "urlopen", injected_opener().open)
    if CAPTURE_OPEN is not None:
        monkeypatch.setattr(writer, "_open_capture_request", CAPTURE_OPEN)


@pytest.mark.parametrize("destination", ["wrong_grain", "cross_host"])
def test_redirect_capture_refuses_before_following(env, monkeypatch, destination):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    before = read(env)
    calls = []
    def provider(request):
        calls.append(request.full_url)
        if len(calls) == 1:
            location = (request.full_url.replace("/range/1/minute/", "/range/5/minute/")
                        if destination == "wrong_grain" else "https://other.invalid/redirect")
            return 302, location, b"redirect body must not become an aggregate receipt"
        return 200, None, response([bar(close=100.25)], ticker="SPY")
    install_standard_urllib_transport(monkeypatch, provider)
    assert run() == 1
    assert len(calls) == 1
    after = read(env)
    assert after["bars"] == before["bars"]
    assert after["minute_capture"]["captures"][0] == before["minute_capture"]["captures"][0]
    payload = payloads(env)[-1]
    assert payload["status"] == "failed" and payload["failure_kind"] == "http_error"
    assert payload["pages"] == [] and payload["observations"] == []
    assert TOKEN.encode() not in env.read_bytes()
    assert b"other.invalid" not in env.read_bytes()


def test_redirect_capture_later_page_preserves_only_earlier_safe_receipt(env, monkeypatch):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    before = read(env)
    calls = []
    def provider(request):
        calls.append(request.full_url)
        if len(calls) == 1:
            return 200, None, response([bar(close=100.25)], ticker="SPY",
                                       next_url=cursor_url(request))
        if len(calls) == 2:
            return 302, request.full_url.replace("/range/1/minute/", "/range/5/minute/"), b""
        return 200, None, response([bar(1, close=100.5)], ticker="SPY")
    install_standard_urllib_transport(monkeypatch, provider)
    assert run() == 1
    assert len(calls) == 2
    after = read(env)
    assert after["bars"] == before["bars"]
    assert after["minute_capture"]["captures"][0] == before["minute_capture"]["captures"][0]
    payload = payloads(env)[-1]
    assert payload["status"] == "partial" and payload["failure_kind"] == "http_error"
    assert len(payload["pages"]) == 1
    assert [item["raw"]["c"] for item in payload["observations"]] == [100.25]
    assert payload["counts"]["unchanged_suppressed"] == 0


def test_redirect_capture_direct_standard_urllib_response_still_succeeds(env, monkeypatch):
    calls = []
    def provider(request):
        calls.append(request.full_url)
        return 200, None, response([bar(volume=1.25)], ticker="SPY")
    install_standard_urllib_transport(monkeypatch, provider)
    assert run() == 0
    assert len(calls) == 1
    payload = payloads(env)[0]
    assert payload["status"] == "complete" and len(payload["pages"]) == 1
    assert payload["observations"][0]["raw"]["v"] == 1.25


# V2 declares what the response actually said, independently of request.adjusted.
def v1_document(document):
    """Synthetic legacy fixture, sealed by the unchanged v1 hash definition."""
    result = copy.deepcopy(document)
    envelope = result["minute_capture"]
    envelope["schema"] = cap.SCHEMA_V1
    previous = cap.GENESIS_SHA256
    for record in envelope["captures"]:
        payload = record["payload"]
        payload.pop("schema")
        payload.pop("chart_eligible")
        payload.pop("acquisition_role", None)
        for page in payload["pages"]:
            page.pop("response_adjusted")
        record["previous_capture_sha256"] = previous
        record["payload_sha256"] = cap.digest(payload)
        record["capture_sha256"] = cap.digest({k: v for k, v in record.items()
                                               if k != "capture_sha256"})
        previous = record["capture_sha256"]
    envelope["prefix_sha256"] = previous
    cap.validate_envelope(envelope, "SPY")
    return result


@pytest.mark.parametrize("declaration", ["TRUE", "MISSING"])
def test_v1_prefix_upgrades_without_resealing_or_expansion(env, monkeypatch, declaration):
    install(monkeypatch, response([bar(i) for i in range(3)]))
    assert run() == run() == 0
    legacy = v1_document(read(env))
    env.write_bytes(cap.canonical_bytes(legacy))
    prior = copy.deepcopy(legacy["minute_capture"])
    prior_records = [cap.canonical_bytes(r) for r in prior["captures"]]
    assert [len(r["payload"]["observations"]) for r in prior["captures"]] == [3, 0]
    # The unchanged minute gains a genuinely observed declaration, not a re-expanded
    # old suppressed observation. The next identical complete response compacts.
    if declaration == "MISSING":
        install(monkeypatch, declaration_body("missing", [bar(i) for i in range(3)]))
    expected = 0 if declaration == "TRUE" else 1
    assert writer.main(["--existing-only", "--tf", "1m", "--workers", "1"]) == expected
    assert run() == expected
    upgraded = read(env)["minute_capture"]
    assert upgraded["schema"] == cap.SCHEMA
    assert [cap.canonical_bytes(r) for r in upgraded["captures"][:2]] == prior_records
    assert upgraded["captures"][2]["previous_capture_sha256"] == prior["prefix_sha256"]
    assert [len(r["payload"]["observations"]) for r in upgraded["captures"]] == [3, 0, 3, 0]
    assert upgraded["captures"][2]["payload"]["schema"] == cap.PAYLOAD_SCHEMA_V3
    assert cap.canonical_bytes(cap.append_sealed_capture(upgraded, prior["captures"][0])) == cap.canonical_bytes(upgraded)
    # A new v1 attempt cannot follow the first v2 attempt, even if freshly sealed.
    with pytest.raises(cap.CaptureError, match="capture_schema_order_invalid"):
        cap.append_capture(upgraded, prior["captures"][0]["payload"], "e" * 32)


def test_equal_values_false_true_false_are_three_declaration_episodes(env, monkeypatch):
    rows = [bar(i, volume=1.75) for i in range(30)]
    for adjusted, expected in [(False, 1), (True, 0), (False, 1), (False, 1)]:
        install(monkeypatch, response(rows, adjusted=adjusted))
        assert run() == expected
    captures = payloads(env)
    assert [p["status"] for p in captures] == ["complete"] * 4
    assert [p["failure_kind"] for p in captures] == [None] * 4
    assert [p["chart_eligible"] for p in captures] == [False, True, False, False]
    assert [p["counts"]["observations_retained"] for p in captures] == [30, 30, 30, 0]
    assert [p["pages"][0]["response_adjusted"]["state"] for p in captures] == ["FALSE", "TRUE", "FALSE", "FALSE"]
    assert captures[-1]["counts"]["unchanged_suppressed"] == 30
    assert len(read(env)["bars"]) == 30


def declaration_body(kind, rows):
    data = json.loads(response(rows))
    if kind == "missing":
        data.pop("adjusted")
    else:
        data["adjusted"] = {"false": False, "null": None, "integer": 1,
                            "string": TOKEN, "object": {"secret": TOKEN}, "array": []}.get(kind, True)
    raw = json.dumps(data, separators=(",", ":")).encode()
    if kind == "duplicate_conflict":
        raw = raw.replace(b'"adjusted":true', b'"adjusted":true,"adjusted":false')
    if kind == "duplicate_equal":
        raw = raw.replace(b'"adjusted":true', b'"adjusted":true,"adjusted":true')
    return raw


@pytest.mark.parametrize("kind,state", [
    ("false", "FALSE"), ("missing", "MISSING"), ("null", "NULL"),
    ("integer", "INVALID_TYPE"), ("string", "INVALID_TYPE"),
    ("object", "INVALID_TYPE"), ("array", "INVALID_TYPE"),
    ("duplicate_conflict", "AMBIGUOUS"), ("duplicate_equal", "AMBIGUOUS"),
])
def test_unavailable_declarations_retain_complete_evidence_and_preserve_chart(env, monkeypatch, kind, state):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    before = read(env)
    # Different values discriminate a forbidden chart promotion from a no-op.
    raw = declaration_body(kind, [bar(close=100.25)])
    install(monkeypatch, raw)
    assert run() == 1
    after = read(env)
    assert {k: v for k, v in after.items() if k != "minute_capture"} == {k: v for k, v in before.items() if k != "minute_capture"}
    payload = after["minute_capture"]["captures"][-1]["payload"]
    assert payload["status"] == "complete" and payload["failure_kind"] is None
    assert payload["chart_eligible"] is False
    assert payload["observations"][0]["raw"]["c"] == 100.25
    assert payload["pages"][0]["response_adjusted"] == {"state": state}
    assert payload["pages"][0]["response_sha256"] == hashlib.sha256(raw).hexdigest()
    assert payload["request"]["adjusted"] is True
    assert TOKEN.encode() not in env.read_bytes()


@pytest.mark.parametrize("raw,reason", [(b'{"adjusted":true,', "malformed_response"),
                                       (b'[]', "invalid_response")])
def test_unparsed_declaration_is_explicit_on_invalid_response(env, monkeypatch, raw, reason):
    install(monkeypatch, raw)
    assert run() == 1
    payload = payloads(env)[0]
    assert payload["status"] == "partial" and payload["failure_kind"] == reason
    assert payload["pages"][0]["response_adjusted"] == {"state": "UNPARSED"}
    assert payload["chart_eligible"] is False and not payload["observations"]


def test_nested_declaration_duplicates_do_not_ambiguate_top_level(env, monkeypatch):
    raw = response([bar()]).replace(b'"adjusted":true', b'"adjusted":true,"unknown":{"adjusted":false,"adjusted":true}')
    install(monkeypatch, raw)
    assert run() == 0
    assert payloads(env)[0]["pages"][0]["response_adjusted"] == {"state": "TRUE"}
    assert b"unknown" not in env.read_bytes()


def test_mixed_page_declarations_and_partial_attempt_do_not_invent_basis_vintages(env, monkeypatch):
    install(monkeypatch, response([bar(0), bar(1)]))
    assert run() == 0
    before = read(env)["bars"]
    def mixed(request):
        if "cursor=next" in request.full_url:
            return response([bar(1, close=100.25)], adjusted=False)
        return response([bar(0, close=100.25)], next_url=cursor_url(request))
    install(monkeypatch, mixed)
    assert run() == 1
    assert read(env)["bars"] == before
    p = payloads(env)[-1]
    assert p["status"] == "complete" and p["chart_eligible"] is False
    assert [x["response_adjusted"]["state"] for x in p["pages"]] == ["TRUE", "FALSE"]
    assert [x["page_index"] for x in p["observations"]] == [0, 1]
    def partial(request):
        if "cursor=next" in request.full_url:
            raise urllib.error.URLError("synthetic no network")
        return response([bar(1, close=100.25)], adjusted=True, next_url=cursor_url(request))
    install(monkeypatch, partial)
    assert run() == 1
    assert payloads(env)[-1]["status"] == "partial"
    install(monkeypatch, response([bar(0, close=100.25), bar(1, close=100.25)]))
    assert run() == 0
    p = payloads(env)[-1]
    assert p["counts"]["unchanged_suppressed"] == 1
    assert len(p["observations"]) == 1 and p["observations"][0]["raw"]["t"] == bar(1)["t"]


def test_v1_capacity_refusal_does_not_publish_schema_upgrade(env, monkeypatch):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    env.write_bytes(cap.canonical_bytes(v1_document(read(env))))
    before = env.read_bytes()
    monkeypatch.setattr(cap, "MAX_CAPTURES", 1)
    assert run() == 1
    assert env.read_bytes() == before


@pytest.mark.parametrize("mutation", ["unknown_state", "extra_value", "chart_flag", "v1_envelope", "unknown_payload_schema"])
def test_v2_closed_declaration_and_version_validation(env, monkeypatch, mutation):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    envelope = read(env)["minute_capture"]
    payload = envelope["captures"][0]["payload"]
    if mutation == "unknown_state":
        payload["pages"][0]["response_adjusted"]["state"] = "UNRECORDED"
    elif mutation == "extra_value":
        payload["pages"][0]["response_adjusted"]["raw"] = TOKEN
    elif mutation == "chart_flag":
        payload["chart_eligible"] = False
    elif mutation == "unknown_payload_schema":
        payload["schema"] = "unknown"
    else:
        envelope["schema"] = cap.SCHEMA_V1
    # Reseal the synthetic mutation so this discriminates semantic validation
    # from the independent tamper-digest check already exercised elsewhere.
    record = envelope["captures"][0]
    record["payload_sha256"] = cap.digest(payload)
    record["capture_sha256"] = cap.digest({k: v for k, v in record.items()
                                           if k != "capture_sha256"})
    envelope["prefix_sha256"] = record["capture_sha256"]
    with pytest.raises(cap.CaptureError):
        cap.validate_envelope(envelope, "SPY")



def test_equal_values_preserve_every_normalized_declaration_transition(env, monkeypatch):
    # Different invalid values are one normalized unavailable class; no raw
    # arbitrary declaration payload may leak just to distinguish those values.
    kinds = ["missing", "null", "integer", "string", "duplicate_equal", "false", "missing"]
    for kind in kinds:
        install(monkeypatch, declaration_body(kind, [bar()]))
        assert run() == 1
    captures = payloads(env)
    assert [p["pages"][0]["response_adjusted"]["state"] for p in captures] == [
        "MISSING", "NULL", "INVALID_TYPE", "INVALID_TYPE", "AMBIGUOUS", "FALSE", "MISSING"]
    assert [p["counts"]["observations_retained"] for p in captures] == [1, 1, 1, 0, 1, 1, 1]
    assert all(p["status"] == "complete" and p["chart_eligible"] is False for p in captures)
    assert read(env)["bars"] == []
    assert TOKEN.encode() not in env.read_bytes()


def test_missing_declaration_empty_capture_recovers_via_existing_owner(env, monkeypatch):
    install(monkeypatch, declaration_body("missing", []))
    assert run() == 1
    original = read(env)["minute_capture"]["captures"][0]
    assert original["payload"]["status"] == "complete"
    assert original["payload"]["counts"]["rows_received"] == 0
    assert original["payload"]["chart_eligible"] is False
    install(monkeypatch, response([bar(volume=0.125)]))
    assert writer.main(["--existing-only", "--tf", "1m", "--workers", "1"]) == 0
    doc = read(env)
    assert doc["minute_capture"]["captures"][0] == original
    assert len(doc["minute_capture"]["captures"]) == 2 and len(doc["bars"]) == 1
    assert doc["minute_capture"]["captures"][-1]["payload"]["observations"][0]["raw"]["v"] == 0.125

# V3 keeps unadjusted acquisition in this owner without touching its chart projection.
def run_raw(*extra):
    return writer.main(["--capture-unadjusted-minutes", "--symbols", "SPY", "--tf", "1m",
                        "--workers", "1", *extra])


def projection(document):
    return cap.canonical_bytes({k: v for k, v in document.items() if k != "minute_capture"})


def seed_chart(path):
    # Extra fields and a deliberately unrelated watermark detect reconstruction or
    # accidental reuse of chart state in the raw-only path.
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {"t": "SPY", "tf": "1m", "src": "polygon", "bar_quality": "real_ohlc",
                "asof": 17, "bars": [[17, 10, 12, 9, 11, 3.5]],
                "metadata": {"label": "keep café", "sequence": [None, False, 1.25]}}
    path.write_bytes(cap.canonical_bytes(document))
    return document


@pytest.mark.parametrize("outcome", [
    "complete", "empty", "forming", "true", "missing", "null", "integer", "string",
    "object", "array", "duplicate_conflict", "duplicate_equal", "malformed", "partial", "failed",
])
def test_raw_capture_preserves_every_chart_field_for_success_and_refusal(env, monkeypatch, outcome):
    before = projection(seed_chart(env))
    calls = []
    def forbidden(*args, **kwargs):
        raise AssertionError("raw acquisition must not use chart refresh/basis/merge")
    for name in ("load_store", "_basis_ratio", "_merge"):
        monkeypatch.setattr(writer, name, forbidden)
    def provider(request):
        calls.append(request.full_url)
        assert writer.urllib.parse.parse_qs(writer.urllib.parse.urlsplit(request.full_url).query)["adjusted"] == ["false"]
        if outcome == "failed" or (outcome == "partial" and "cursor=next" in request.full_url):
            raise urllib.error.HTTPError(request.full_url, 404, TOKEN, {}, None)
        if outcome == "malformed":
            return b'{"adjusted":false,'
        rows = [bar(0, volume=1.75), bar(1, volume=None), bar(2)]
        del rows[2]["v"]
        if outcome == "empty":
            rows = []
        if outcome == "forming":
            rows = [dict(bar(), t=int(NOW * 1000) - 60000)]
        if outcome in ("true", "missing", "null", "integer", "string", "object", "array",
                       "duplicate_conflict", "duplicate_equal"):
            return declaration_body(outcome, rows)
        return response(rows, adjusted=False,
                        next_url=cursor_url(request) if outcome == "partial" else None)
    install(monkeypatch, provider)
    assert run_raw() == (0 if outcome in ("complete", "empty", "forming") else 1)
    document = read(env)
    assert projection(document) == before
    payload = payloads(env)[0]
    assert payload["schema"] == cap.PAYLOAD_SCHEMA_V3
    assert payload["acquisition_role"] == cap.RESEARCH_UNADJUSTED
    assert payload["request"]["adjusted"] is False and payload["chart_eligible"] is False
    assert payload["finality_lag_s"] == 900
    assert payload["finality_reference_utc_ns"] == int(NOW * 1e9)
    assert len(calls) == (2 if outcome == "partial" else 1)  # no companion chart fetch
    if outcome == "complete":
        originals = [o["raw"] for o in payload["observations"]]
        assert originals[0]["v"] == 1.75 and originals[1]["v"] is None and "v" not in originals[2]
    if outcome == "empty":
        assert payload["counts"]["rows_received"] == 0 and payload["status"] == "complete"
    if outcome == "forming":
        assert payload["counts"]["forming_skipped"] == 1 and payload["status"] == "complete"
    assert payload["status"] == ("failed" if outcome == "failed" else
                                  "partial" if outcome in ("partial", "malformed") else "complete")
    assert TOKEN.encode() not in env.read_bytes()


@pytest.mark.parametrize("query", ["cursor=next", "cursor=next&adjusted=false&sort=asc&limit=50000"])
def test_raw_pages_request_false_and_fixed_window_ignores_chart_watermark(env, monkeypatch, query):
    seed_chart(env)
    urls = []
    def provider(request):
        urls.append(request.full_url)
        return response([bar(len(urls) - 1)], adjusted=False,
                        next_url=cursor_url(request, query) if len(urls) == 1 else None)
    install(monkeypatch, provider)
    assert run_raw() == 0
    assert len(urls) == 2
    for url in urls:
        parsed = writer.urllib.parse.urlsplit(url)
        assert writer.urllib.parse.parse_qs(parsed.query)["adjusted"] == ["false"]
        assert "/range/1/minute/" in parsed.path
    request = payloads(env)[0]["request"]
    start, end = [writer.dt.date.fromisoformat(request[k]) for k in ("from_date", "to_date")]
    assert (end - start).days == writer.TF_SPEC["1m"]["days"] == 40
    assert end == writer.dt.date.today()
    assert [o["page_index"] for o in payloads(env)[0]["observations"]] == [0, 1]


@pytest.mark.parametrize("conflict", ["adjusted", "duplicate_adjusted", "ticker", "path", "host"])
def test_raw_conflicting_source_identity_refuses_without_following(env, monkeypatch, conflict):
    before = projection(seed_chart(env))
    calls = []
    def provider(request):
        calls.append(request.full_url)
        next_url = cursor_url(request)
        extra = {}
        if conflict in ("adjusted", "duplicate_adjusted"):
            next_url += "&adjusted=true"
            if conflict == "duplicate_adjusted":
                next_url += "&adjusted=false"
        elif conflict == "ticker":
            extra["ticker"] = "QQQ"
        elif conflict == "path":
            next_url = next_url.replace("/range/1/minute/", "/range/5/minute/")
        else:
            next_url = next_url.replace("api.polygon.io", "untrusted.invalid")
        return response([bar()], adjusted=False, next_url=next_url, **extra)
    install(monkeypatch, provider)
    assert run_raw() == 1 and len(calls) == 1
    assert projection(read(env)) == before
    payload = payloads(env)[0]
    assert payload["status"] == "partial" and payload["failure_kind"] == "invalid_response"
    assert len(payload["observations"]) == (0 if conflict == "ticker" else 1)


@pytest.mark.parametrize("page", [0, 1])
def test_raw_standard_urllib_redirect_is_refused_before_body_or_target(env, monkeypatch, page):
    before = projection(seed_chart(env))
    calls = []
    def provider(request):
        calls.append(request.full_url)
        if len(calls) == page + 1:
            return 302, request.full_url.replace("adjusted=false", "adjusted=true"), b"redirect body"
        return 200, None, response([bar()], adjusted=False, next_url=cursor_url(request))
    install_standard_urllib_transport(monkeypatch, provider)
    assert run_raw() == 1
    assert len(calls) == page + 1 and projection(read(env)) == before
    payload = payloads(env)[0]
    assert payload["failure_kind"] == "http_error"
    assert payload["status"] == ("failed" if page == 0 else "partial")
    assert len(payload["pages"]) == page


@pytest.mark.parametrize("arguments", [
    [], ["--symbols", ""], ["--symbols", "SPY", "--capture-minutes"],
    ["--symbols", "SPY", "--tf", "5m"], ["--symbols", "SPY", "--workers", "0"],
    ["--symbols", "SPY", "--workers", "17"], ["--symbols", "SPY,SPY"],
    ["--symbols", "../SPY"], ["--symbols", ",".join("S" + str(i) for i in range(17))],
    *[["--symbols", "SPY", flag] for flag in
      ("--existing-only", "--top", "--limit", "--update", "--force", "--expect-advance")],
])
def test_raw_cli_is_explicit_bounded_and_rejects_chart_controls(env, arguments):
    assert writer.main(["--capture-unadjusted-minutes", *arguments]) == 64
    assert not env.exists()


@pytest.mark.parametrize("body", [b"{", b"[]", b'{"t":"SPY","tf":"1m","src":"polygon","bars":{}}',
                                b'{"t":"QQQ","tf":"1m","src":"polygon","bars":[]}'])
def test_raw_unreadable_or_mismatched_existing_store_refuses_before_transport(env, body):
    env.parent.mkdir(parents=True)
    env.write_bytes(body)
    assert run_raw() == 1  # env's transport is forbidden
    assert env.read_bytes() == body


@pytest.mark.parametrize("capacity", ["MAX_CAPTURES", "MAX_RESPONSE_BYTES", "MAX_FILE_BYTES", "MAX_CAPTURE_PAGES"])
def test_raw_capacity_limits_preserve_entire_prior_file(env, monkeypatch, capacity):
    seed_chart(env)
    install(monkeypatch, response([bar()], adjusted=False))
    assert run_raw() == 0
    before = env.read_bytes()
    monkeypatch.setattr(cap, capacity, {"MAX_CAPTURES": 1, "MAX_RESPONSE_BYTES": 8,
                                      "MAX_FILE_BYTES": len(before) + 8, "MAX_CAPTURE_PAGES": 1}[capacity])
    install(monkeypatch, lambda request: response([bar(close=100.25)], adjusted=False,
            next_url=cursor_url(request) if capacity == "MAX_CAPTURE_PAGES" else None))
    assert run_raw() == 1 and env.read_bytes() == before


def test_raw_atomic_replace_failure_has_no_blind_retry(env, monkeypatch):
    seed_chart(env)
    before = env.read_bytes()
    install(monkeypatch, response([bar()], adjusted=False))
    attempts = []
    def fail_replace(*args):
        attempts.append(args)
        raise OSError("synthetic replace failure")
    monkeypatch.setattr(writer.os, "replace", fail_replace)
    assert run_raw() == 1 and len(attempts) == 1
    assert env.read_bytes() == before
    assert not list(env.parent.glob("*.tmp.*"))


def test_equal_values_and_declarations_never_suppress_across_roles(env, monkeypatch):
    # Both responses say FALSE. The chart request is incompatible, while the raw
    # request complies. Their identical raw values still belong to separate runs.
    for acquire, expected in [(run, 1), (run_raw, 0), (run, 1), (run_raw, 0)]:
        install(monkeypatch, response([bar()], adjusted=False))
        assert acquire() == expected
    captures = payloads(env)
    assert [p["counts"]["observations_retained"] for p in captures] == [1, 1, 0, 0]
    assert [p["request"]["adjusted"] for p in captures] == [True, False, True, False]
    assert [p["acquisition_role"] for p in captures] == [
        cap.CHART_ADJUSTED, cap.RESEARCH_UNADJUSTED, cap.CHART_ADJUSTED, cap.RESEARCH_UNADJUSTED]
    assert all(p["chart_eligible"] is False for p in captures)
    assert read(env)["bars"] == []


def test_each_role_keeps_its_own_correction_and_reversion_history(env, monkeypatch):
    # Interleaving equal values from the other role must not change which value
    # counts as this role's previous observation.
    schedule = [(run, True, 100), (run_raw, False, 100),
                (run_raw, False, 100.25), (run, True, 100),
                (run, True, 100.25), (run_raw, False, 100),
                (run, True, 100), (run_raw, False, 100)]
    for acquire, adjusted, close in schedule:
        install(monkeypatch, response([bar(close=close)], adjusted=adjusted))
        assert acquire() == 0
    captures = payloads(env)
    assert [p["counts"]["observations_retained"] for p in captures] == [1, 1, 1, 0, 1, 1, 1, 0]
    for role in (cap.CHART_ADJUSTED, cap.RESEARCH_UNADJUSTED):
        assert [o["raw"]["c"] for p in captures if p["acquisition_role"] == role
                for o in p["observations"]] == [100, 100.25, 100]


@pytest.mark.parametrize("target_raw", [False, True])
@pytest.mark.parametrize("interruption", ["empty", "forming", "partial", "failed"])
@pytest.mark.parametrize("same_role", [False, True])
def test_role_local_latest_complete_baseline_survives_interruptions(
        env, monkeypatch, target_raw, interruption, same_role):
    target, other = (run_raw, run) if target_raw else (run, run_raw)
    target_adjusted = not target_raw
    install(monkeypatch, response([bar()], adjusted=target_adjusted))
    assert target() == 0
    first_record = copy.deepcopy(read(env)["minute_capture"]["captures"][0])
    interrupted = target if same_role else other
    interrupted_adjusted = target_adjusted if same_role else not target_adjusted
    def provider(request):
        if interruption == "failed" or (interruption == "partial" and "cursor=next" in request.full_url):
            raise urllib.error.HTTPError(request.full_url, 404, "synthetic", {}, None)
        rows = [] if interruption == "empty" else [bar(close=100.25)]
        if interruption == "forming":
            rows[0]["t"] = int(NOW * 1000) - 60000
        return response(rows, adjusted=interrupted_adjusted,
                        next_url=cursor_url(request) if interruption == "partial" else None)
    install(monkeypatch, provider)
    # Existing chart refresh still rejects an empty overlap; the complete empty
    # receipt remains retained. Raw acquisition has no chart-overlap requirement.
    expected_failure = interruption in ("partial", "failed") or (same_role and not target_raw)
    assert interrupted() == (1 if expected_failure else 0)
    install(monkeypatch, response([bar()], adjusted=target_adjusted))
    assert target() == 0
    assert payloads(env)[-1]["counts"]["observations_retained"] == 0
    assert payloads(env)[-1]["counts"]["unchanged_suppressed"] == 1
    assert read(env)["minute_capture"]["captures"][0] == first_record
    # The partial other-role value cannot pre-suppress a real correction.
    install(monkeypatch, response([bar(close=100.25)], adjusted=target_adjusted))
    assert target() == 0
    assert payloads(env)[-1]["counts"]["observations_retained"] == 1


def reseal_fixture(envelope):
    previous = cap.GENESIS_SHA256
    for record in envelope["captures"]:
        record["previous_capture_sha256"] = previous
        record["payload_sha256"] = cap.digest(record["payload"])
        record["capture_sha256"] = cap.digest({k: v for k, v in record.items() if k != "capture_sha256"})
        previous = record["capture_sha256"]
    envelope["prefix_sha256"] = previous


def test_v1_v2_prefix_upgrades_to_v3_without_resealing_or_suppressed_row_expansion(env, monkeypatch):
    for close in (100, 100.25, 100.25):
        install(monkeypatch, response([bar(close=close)]))
        assert run() == 0
    document = read(env)
    envelope = document["minute_capture"]
    envelope["schema"] = cap.SCHEMA_V2
    for index, record in enumerate(envelope["captures"]):
        payload = record["payload"]
        payload.pop("acquisition_role")
        if index == 0:
            payload.pop("schema")
            payload.pop("chart_eligible")
            for page in payload["pages"]:
                page.pop("response_adjusted")
        else:
            payload["schema"] = cap.PAYLOAD_SCHEMA_V2
    reseal_fixture(envelope)
    cap.validate_envelope(envelope, "SPY")
    env.write_bytes(cap.canonical_bytes(document))
    prior = [cap.canonical_bytes(r) for r in envelope["captures"]]
    assert [len(r["payload"]["observations"]) for r in envelope["captures"]] == [1, 1, 0]
    install(monkeypatch, response([bar(close=100.25)], adjusted=False))
    assert run_raw() == 0
    install(monkeypatch, response([bar(close=100.25)]))
    assert writer.main(["--existing-only", "--tf", "1m", "--workers", "1"]) == 0
    upgraded = read(env)["minute_capture"]
    assert upgraded["schema"] == cap.SCHEMA
    assert [cap.canonical_bytes(r) for r in upgraded["captures"][:3]] == prior
    assert [len(r["payload"]["observations"]) for r in upgraded["captures"]] == [1, 1, 0, 1, 0]
    assert upgraded["captures"][-1]["payload"]["acquisition_role"] == cap.CHART_ADJUSTED
    for record in envelope["captures"][:2]:
        assert cap.append_sealed_capture(upgraded, record) == upgraded
        with pytest.raises(cap.CaptureError, match="capture_schema_order_invalid"):
            cap.append_capture(upgraded, record["payload"], "f" * 32)


@pytest.mark.parametrize("mutation", [
    "unknown_role", "null_role", "object_role", "missing_role", "wrong_bool", "integer_bool",
    "raw_chart_eligible", "v2_envelope", "v2_payload", "unknown_payload", "null_payload",
])
def test_v3_closed_role_and_request_contract_refuses_correctly_resealed_bad_inputs(env, monkeypatch, mutation):
    install(monkeypatch, response([bar()], adjusted=False))
    assert run_raw() == 0
    envelope = read(env)["minute_capture"]
    payload = envelope["captures"][0]["payload"]
    if mutation == "unknown_role":
        payload["acquisition_role"] = "unadjusted"
    elif mutation == "null_role":
        payload["acquisition_role"] = None
    elif mutation == "object_role":
        payload["acquisition_role"] = {}
    elif mutation == "missing_role":
        payload.pop("acquisition_role")
    elif mutation in ("wrong_bool", "integer_bool"):
        payload["request"]["adjusted"] = True if mutation == "wrong_bool" else 0
    elif mutation == "raw_chart_eligible":
        payload["chart_eligible"] = True
    elif mutation == "v2_envelope":
        envelope["schema"] = cap.SCHEMA_V2
    else:
        payload["schema"] = {"v2_payload": cap.PAYLOAD_SCHEMA_V2,
                             "unknown_payload": "v999", "null_payload": None}[mutation]
    reseal_fixture(envelope)
    env.write_bytes(cap.canonical_bytes({"t": "SPY", "tf": "1m", "src": "polygon", "bars": [],
                                       "minute_capture": envelope}))
    before = env.read_bytes()
    def forbidden(*args, **kwargs):
        raise AssertionError("invalid existing v3 input must refuse before HTTP")
    install(monkeypatch, forbidden)
    with pytest.raises(cap.CaptureError):
        cap.validate_envelope(envelope, "SPY")
    assert run_raw() == 1
    assert env.read_bytes() == before


# Actual HTTP framing controls: a valid JSON prefix is not transport completion.
_FRAMING_FLAGS = ("--capture-minutes", "--capture-unadjusted-minutes")


def _framed_http_response(body, kind):
    import http.client
    class Socket:
        def makefile(self, mode):
            return io.BytesIO(wire)
    if kind in ("chunked", "truncated_chunked"):
        wire = (b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
                + format(len(body), "x").encode() + b"\r\n" + body + b"\r\n")
        if kind == "chunked":
            wire += b"0\r\n\r\n"
    elif kind == "eof":
        wire = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n" + body
    else:
        declared = len(body) + (10 if kind == "short_length" else 0)
        wire = (b"HTTP/1.1 200 OK\r\nContent-Length: " + str(declared).encode()
                + b"\r\n\r\n" + body)
    result = http.client.HTTPResponse(Socket())
    result.begin()
    return result


def _run_framed(flag):
    return writer.main([flag, "--symbols", "SPY", "--tf", "1m", "--workers", "1"])


@pytest.mark.parametrize("flag", _FRAMING_FLAGS)
@pytest.mark.parametrize("kind", ["length", "chunked", "eof"])
def test_captured_http_complete_framing_positive(env, monkeypatch, flag, kind):
    calls = []
    raw = flag == "--capture-unadjusted-minutes"
    body = response([bar(volume=1.25)], adjusted=not raw)
    def transport(request, *, timeout):
        calls.append(request.full_url)
        assert timeout == 45
        return _framed_http_response(body, kind)
    monkeypatch.setattr(writer, "_open_capture_request", transport)
    assert _run_framed(flag) == 0 and len(calls) == 1
    doc = read(env)
    payload = payloads(env)[-1]
    assert payload["status"] == "complete" and payload["failure_kind"] is None
    assert len(payload["pages"]) == len(payload["observations"]) == 1
    assert payload["pages"][0]["response_bytes"] == len(body)
    assert payload["pages"][0]["response_sha256"] == hashlib.sha256(body).hexdigest()
    assert payload["chart_eligible"] is (not raw)
    assert len(doc["bars"]) == (0 if raw else 1)


@pytest.mark.parametrize("flag", _FRAMING_FLAGS)
@pytest.mark.parametrize("kind", ["short_length", "truncated_chunked"])
def test_captured_http_incomplete_first_page_retains_existing_transport_failure(env, monkeypatch, flag, kind):
    calls = []
    raw = flag == "--capture-unadjusted-minutes"
    def transport(request, *, timeout):
        calls.append(request.full_url)
        return _framed_http_response(response([bar()], adjusted=not raw), kind)
    monkeypatch.setattr(writer, "_open_capture_request", transport)
    assert _run_framed(flag) == 1
    assert len(calls) == 5
    payload = payloads(env)[-1]
    assert payload["status"] == "failed" and payload["failure_kind"] == "transport_exhausted"
    assert payload["pages"] == payload["observations"] == []
    assert payload["chart_eligible"] is False and read(env)["bars"] == []
    assert TOKEN.encode() not in env.read_bytes()


@pytest.mark.parametrize("flag", _FRAMING_FLAGS)
@pytest.mark.parametrize("kind", ["short_length", "truncated_chunked"])
def test_captured_http_later_page_retains_only_complete_prefix_and_preserves_chart(env, monkeypatch, flag, kind):
    install(monkeypatch, response([bar(i) for i in range(25)]))
    assert run() == 0
    before = read(env)
    calls = []
    raw = flag == "--capture-unadjusted-minutes"
    def transport(request, *, timeout):
        calls.append(request.full_url)
        if "cursor=next" not in request.full_url:
            body = response([bar(close=100.25)], adjusted=not raw, next_url=cursor_url(request))
            return _framed_http_response(body, "length")
        return _framed_http_response(response([bar(1, close=100.5)], adjusted=not raw), kind)
    monkeypatch.setattr(writer, "_open_capture_request", transport)
    assert _run_framed(flag) == 1 and len(calls) == 6
    after = read(env)
    payload = payloads(env)[-1]
    assert payload["status"] == "partial" and payload["failure_kind"] == "transport_exhausted"
    assert len(payload["pages"]) == len(payload["observations"]) == 1
    assert payload["observations"][0]["raw"]["c"] == 100.25
    assert payload["chart_eligible"] is False
    assert {k: v for k, v in after.items() if k != "minute_capture"} == {k: v for k, v in before.items() if k != "minute_capture"}
    assert after["minute_capture"]["captures"][0] == before["minute_capture"]["captures"][0]


@pytest.mark.parametrize("flag", _FRAMING_FLAGS)
def test_captured_http_oversize_keeps_immediate_refusal_before_framing_retry(env, monkeypatch, flag):
    install(monkeypatch, response([bar()]))
    assert run() == 0
    before = env.read_bytes()
    # Keep the prior sealed page valid; only the new response exceeds this cap.
    monkeypatch.setattr(cap, "MAX_RESPONSE_BYTES", len(response([bar()])) + 8)
    calls, responses = [], []
    def transport(request, *, timeout):
        calls.append(request.full_url)
        result = _framed_http_response(response([bar()], adjusted=flag != "--capture-unadjusted-minutes", padding="x" * 512), "short_length")
        responses.append(result)
        return result
    monkeypatch.setattr(writer, "_open_capture_request", transport)
    assert _run_framed(flag) == 1
    assert len(calls) == 1 and responses[0].length > 0
    assert env.read_bytes() == before


def test_noncapture_http_read_behavior_is_unchanged(monkeypatch):
    calls = []
    body = response([bar()])
    def legacy(request, *, timeout):
        calls.append(request.full_url)
        return _framed_http_response(body, "short_length")
    monkeypatch.setattr(writer.urllib.request, "urlopen", legacy)
    # The legacy unbounded read already raises IncompleteRead and retries.
    monkeypatch.setattr(writer.time, "sleep", lambda _: None)
    with pytest.raises(writer.TransportExhausted):
        writer._get("https://example.invalid/legacy")
    assert len(calls) == 5
