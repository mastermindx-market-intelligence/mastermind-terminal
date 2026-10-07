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


def bar(index=0, *, close=100, volume=10):
    return {"t": EVENT + index * 60000, "o": 100, "h": max(102, close),
            "l": 98, "c": close, "v": volume}


def response(rows=(), *, next_url=None, status="OK", **extra):
    data = {"status": status, "results": list(rows), **extra}
    if next_url is not None:
        data["next_url"] = next_url
    return json.dumps(data, separators=(",", ":")).encode()


def install(monkeypatch, body):
    def urlopen(request, *args, **kwargs):
        result = body(request) if callable(body) else body
        return io.BytesIO(result)
    monkeypatch.setattr(writer.urllib.request, "urlopen", urlopen)


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


def test_cross_process_updates_serialize_entire_fetch_and_append(env, monkeypatch):
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
            return io.BytesIO(response([bar(close=close)]))
        writer.urllib.request.urlopen = provider
        exits.put(run())

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


def test_actual_file_entry_pins_repo_and_captures_from_outside_checkout(tmp_path):
    foreign = tmp_path / "foreign"
    (foreign / "ingest").mkdir(parents=True)
    marker = tmp_path / "foreign-imported"
    (foreign / "ingest" / "__init__.py").write_text(
        "raise RuntimeError('foreign ingest must never execute')")
    body = response([bar(volume=1.25)])
    script = ROOT / "ingest" / "backfill_intraday.py"
    program = (
        "import io,runpy,sys,urllib.request\n"
        f"urllib.request.urlopen=lambda *a,**k: io.BytesIO({body!r})\n"
        f"sys.argv=[{str(script)!r},'--capture-minutes','--symbols','SPY','--workers','1']\n"
        f"runpy.run_path({str(script)!r},run_name='__main__')\n")
    environment = dict(os.environ, POLYGON_API_KEY=TOKEN, TERMINAL_DATA_DIR=str(tmp_path / "out"),
                       PYTHONPATH=os.pathsep.join([str(foreign), str(ROOT)]))
    result = subprocess.run([sys.executable, "-c", program], cwd=tmp_path, env=environment,
                            text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
    path = tmp_path / "out" / "intraday" / "SPY.1m.json"
    assert payloads(path)[0]["observations"][0]["raw"]["v"] == 1.25
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
    page.update(status="OK", rows_received=25, finalized_rows=25)
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
