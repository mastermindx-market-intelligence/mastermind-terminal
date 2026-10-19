"""Exercise real producer fallback, depth conservation and metadata boundaries."""
import hashlib
import json
import sys
from datetime import datetime
from types import SimpleNamespace

import pandas as pd
import pytest

from ingest import build_polygon_universe as producer
from ingest import build_universe as universe


def history(count=160):
    return [[day.strftime("%Y-%m-%d"), 10 + i / 100, 12 + i / 100,
             9 + i / 100, 11 + i / 100, 1000 + i]
            for i, day in enumerate(pd.date_range("2025-01-02", periods=count))]


def yahoo(monkeypatch, rows=None):
    calls = []

    def ticker(symbol):
        def fetch(**kwargs):
            calls.append((symbol, kwargs))
            if rows is None:
                raise ConnectionError("fixture feed unavailable")
            return pd.DataFrame([row[1:] for row in rows],
                                columns=["Open", "High", "Low", "Close", "Volume"],
                                index=pd.to_datetime([row[0] for row in rows]).tz_localize("America/New_York"))
        return SimpleNamespace(history=fetch)

    monkeypatch.setitem(sys.modules, "yfinance", SimpleNamespace(Ticker=ticker, __version__="fixture-1"))
    return calls


def prior_file(monkeypatch, tmp_path, rows, source="yahoo"):
    monkeypatch.setattr(producer, "OUT", tmp_path)
    doc = {"t": "NVDA", "o": 1, "bar_quality": "real_ohlc", "bars": rows,
           "view": {"fixture_bound_to": "prior bars only"},
           "source_observation": {"observed_at": "2025-01-01T00:00:00+00:00"},
           "session_anchor": {"fixture": "original"}}
    if source is not None:
        doc["src"] = source
    path = tmp_path / "NVDA.json"
    path.write_text(json.dumps(doc, indent=2) + "\n")
    return doc, path


@pytest.mark.parametrize("source", ["yahoo", "polygon", None])
def test_outage_reuses_whole_document_without_inventing_origin(monkeypatch, tmp_path, source):
    rows = history()
    doc, _ = prior_file(monkeypatch, tmp_path, rows, source)
    yahoo(monkeypatch)
    result = producer._deep_ohlc("NVDA", rows[-20:])
    assert result.reused and result.document == doc
    assert result.document.get("src") == source


@pytest.mark.parametrize("candidate", ["shorter", "older"])
def test_fetch_cannot_reduce_depth_or_latest_session(monkeypatch, tmp_path, candidate):
    rows = history()
    doc, _ = prior_file(monkeypatch, tmp_path, rows[-100:])
    yahoo(monkeypatch, rows[-80:] if candidate == "shorter" else rows[:-10])
    result = producer._deep_ohlc("NVDA", rows[-20:])
    assert result.reused and result.document == doc


def test_deep_but_stale_yahoo_cannot_replace_fresher_polygon(monkeypatch, tmp_path):
    rows = history()
    monkeypatch.setattr(producer, "OUT", tmp_path)
    yahoo(monkeypatch, rows[:-10])
    result = producer._deep_ohlc("NVDA", rows[-20:])
    assert not result.reused
    assert result.document["src"] == "polygon"
    assert result.document["bars"] == rows[-20:]


def test_fresh_fetch_records_observations_without_inheriting_qualification(monkeypatch, tmp_path):
    rows = history()
    prior_file(monkeypatch, tmp_path, rows[-100:])
    calls = yahoo(monkeypatch, rows)
    result = producer._deep_ohlc("NVDA", rows[-20:])
    assert not result.reused and result.document["src"] == "yahoo"
    assert "view" not in result.document and "session_anchor" not in result.document
    observation = result.document["source_observation"]
    assert calls == [("NVDA", {"period": "max", "interval": "1d", "auto_adjust": True})]
    assert observation["request"] == {"adapter": "yfinance", "period": "max", "interval": "1d",
                                      "auto_adjust": True, "symbol": "NVDA",
                                      "session_dates": "exchange_local", "index_timezone": "America/New_York"}
    assert observation["digest_codec"] == "python.json.compact.v1"
    assert observation["adapter_version"] == "fixture-1"
    assert datetime.fromisoformat(observation["observed_at"]).utcoffset().total_seconds() == 0
    assert observation["coverage"] == {"first": rows[0][0], "last": rows[-1][0], "rows": 160}
    actual = json.dumps(result.document["bars"], separators=(",", ":"), allow_nan=False).encode()
    assert observation["bars_sha256"] == hashlib.sha256(actual).hexdigest()
    assert observation["qualification"] == "OBSERVATION_ONLY"
    assert observation["historical_availability"] == "UNATTESTED"


@pytest.mark.parametrize("malformation", ["wrong-symbol", "duplicate", "reversed", "negative", "nonfinite", "missing-volume", "extra-column"])
def test_invalid_prior_is_not_reused_or_lent_to_new_bars(monkeypatch, tmp_path, malformation):
    rows = history()
    doc, path = prior_file(monkeypatch, tmp_path, rows)
    if malformation == "wrong-symbol":
        doc["t"] = "MSFT"
    elif malformation == "duplicate":
        doc["bars"] = rows + [rows[-1]]
    elif malformation == "reversed":
        doc["bars"] = list(reversed(rows))
    elif malformation == "missing-volume":
        doc["bars"][0] = doc["bars"][0][:-1]
    elif malformation == "extra-column":
        doc["bars"][0] = doc["bars"][0] + ["unknown"]
    else:
        doc["bars"][0][4] = -1 if malformation == "negative" else float("nan")
    path.write_text(json.dumps(doc))
    yahoo(monkeypatch)
    result = producer._deep_ohlc("NVDA", rows[-20:])
    assert not result.reused and result.document["t"] == "NVDA"
    assert result.document["src"] == "polygon" and "view" not in result.document


def test_real_main_reuse_keeps_exact_file_and_deep_signal_input(monkeypatch, tmp_path):
    rows = history()
    _, path = prior_file(monkeypatch, tmp_path, rows)
    before = path.read_bytes(), path.stat().st_mtime_ns
    monkeypatch.setattr(producer, "MANIFEST", tmp_path / "manifest.json")
    monkeypatch.setattr(producer, "fetch_daily", lambda *a, **k: rows[-120:])
    yahoo(monkeypatch)
    monkeypatch.setattr(producer.confluence, "ipo_bar_anchor", lambda *a: 0)
    monkeypatch.setattr(producer.confluence, "ipo_week_parity", lambda *a: 0)
    observed = []

    def signals(close, **kwargs):
        observed.append(close)
        return pd.DataFrame()

    monkeypatch.setattr(producer.confluence, "compute_signals", signals)
    monkeypatch.setattr(producer.time, "sleep", lambda *a: None)
    producer.main(["NVDA"])
    assert (path.read_bytes(), path.stat().st_mtime_ns) == before
    assert len(observed) == 1 and len(observed[0]) == len(rows)
    assert observed[0].iloc[0] == rows[0][4]
    assert json.loads((tmp_path / "manifest.json").read_bytes())["symbols"]["NVDA"]["last"] == rows[-1][4]


def test_universe_keeps_real_ohlc_even_when_legacy_vendor_is_unknown(monkeypatch, tmp_path):
    rows = history()
    _, path = prior_file(monkeypatch, tmp_path, rows, source=None)
    before = path.read_bytes()
    members = tmp_path / "members.parquet"
    members.touch()
    stocks = tmp_path / "stocks"
    stocks.mkdir()
    (stocks / "NVDA.parquet").touch()
    monkeypatch.setattr(universe, "OUT", tmp_path)
    monkeypatch.setattr(universe, "MANIFEST", tmp_path / "manifest.json")
    monkeypatch.setattr(universe, "MACRO", tmp_path)
    monkeypatch.setattr(universe, "STORES", [("US", "members.parquet", "name", "stocks", None)])
    monkeypatch.setattr(universe, "us_exchange_map", lambda: {"NVDA": "NASDAQ"})
    monkeypatch.setattr(universe, "_load_polygon_reference", lambda: ({}, {}))
    reads = []

    def parquet(p):
        reads.append(p)
        if p == members:
            return pd.DataFrame({"name": ["NVIDIA"]}, index=["NVDA"])
        raise AssertionError("synthetic-open source must not replace observed opens")

    monkeypatch.setattr(universe.pd, "read_parquet", parquet)
    universe.main(["--ohlc", "US"])
    assert path.read_bytes() == before
    assert reads == [members]

def test_fetch_cannot_trade_an_interior_session_for_an_extra_old_row(monkeypatch, tmp_path):
    rows = history()
    document, _ = prior_file(monkeypatch, tmp_path, rows)
    extra = ["2025-01-01", 10, 12, 9, 11, 1000]
    candidate = [extra] + rows[:40] + rows[41:]
    assert len(candidate) == len(rows) and candidate[0][0] < rows[0][0]
    yahoo(monkeypatch, candidate)
    result = producer._deep_ohlc("NVDA", rows[-20:])
    assert result.reused and result.document == document


@pytest.mark.parametrize("volume", [-1, float("nan"), float("inf"), True, "100"])
def test_invalid_prior_volume_is_not_reused(monkeypatch, tmp_path, volume):
    rows = history()
    document, path = prior_file(monkeypatch, tmp_path, rows)
    document["bars"][0][5] = volume
    path.write_text(json.dumps(document))
    yahoo(monkeypatch)
    result = producer._deep_ohlc("NVDA", rows[-20:])
    assert not result.reused and result.document["src"] == "polygon"


@pytest.mark.parametrize("status", ["bound", "refused"])
def test_fresh_main_uses_the_existing_owner_result_after_session_stamping(monkeypatch, tmp_path, status):
    rows = history(120)
    monkeypatch.setattr(producer, "OUT", tmp_path)
    monkeypatch.setattr(producer, "MANIFEST", tmp_path / "manifest.json")
    monkeypatch.setattr(producer, "fetch_daily", lambda *a, **k: rows)
    document = {**producer.ohlc_json("NVDA", rows), "src": "yahoo"}
    monkeypatch.setattr(producer, "_deep_ohlc", lambda *a: producer.DeepOhlcRead(document))
    captured = []
    owner_view = {"schema": "fixture-owner-view"}
    def bind(value):
        captured.append(dict(value))
        return {"status": status, "view": owner_view if status == "bound" else None,
                "refusal_reasons": [] if status == "bound" else ["MATERIALIZATION_ALIAS_UNBOUND"]}
    monkeypatch.setattr(producer, "load_materialization_context", lambda *_: SimpleNamespace(bind=bind))
    class StopAfterPublish(Exception):
        pass
    def stop(*_, **__):
        raise StopAfterPublish
    monkeypatch.setattr(producer.pd, "DataFrame", stop)
    with pytest.raises(StopAfterPublish):
        producer.main(["NVDA"])
    published = json.loads((tmp_path / "NVDA.json").read_text())
    assert len(captured) == 1 and "session_anchor" in captured[0]
    if status == "bound":
        assert published["view"] == owner_view
    else:
        assert published["view"]["contract"] is None
        assert published["view"]["refusal_reasons"] == ["MATERIALIZATION_ALIAS_UNBOUND"]


def test_deep_signal_quality_tracks_the_reused_chart_input(monkeypatch, tmp_path):
    rows = history()
    document, path = prior_file(monkeypatch, tmp_path, rows, source=None)
    document["bar_quality"] = "synthetic_open_deepstore"
    document["o"] = 0
    path.write_text(json.dumps(document))
    monkeypatch.setattr(producer, "MANIFEST", tmp_path / "manifest.json")
    monkeypatch.setattr(producer, "fetch_daily", lambda *a, **k: rows[-120:])
    yahoo(monkeypatch)
    monkeypatch.setattr(producer.confluence, "ipo_bar_anchor", lambda *a: 0)
    monkeypatch.setattr(producer.confluence, "ipo_week_parity", lambda *a: 0)
    monkeypatch.setattr(producer.confluence, "compute_signals", lambda *a, **k: pd.DataFrame({"fixture": [1]}))
    class StopAtIndicator(Exception):
        pass
    def indicator(*_, **kwargs):
        assert kwargs["bar_quality"] == "synthetic_open_deepstore"
        raise StopAtIndicator
    monkeypatch.setattr(producer.contracts, "indicator_contract", indicator)
    with pytest.raises(StopAtIndicator):
        producer.main(["NVDA"])
