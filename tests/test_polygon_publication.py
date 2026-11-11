"""The real flagship writer must conserve published JSON on write failure."""
import errno
import io
import json
import os
from pathlib import Path

import pytest

from ingest import build_polygon_universe as producer


class StopAfterOhlc(Exception):
    pass


def artifact(monkeypatch, tmp_path, kind):
    monkeypatch.setattr(producer, "OUT", tmp_path)
    monkeypatch.setattr(producer, "MANIFEST", tmp_path / "manifest.json")
    if kind == "ohlc":
        bars = [["2026-10-08", 10, 12, 9, 11, 100]] * 120
        monkeypatch.setattr(producer, "fetch_daily", lambda *a, **k: bars)
        monkeypatch.setattr(producer, "_deep_ohlc", lambda *a: (bars, "fixture"))

        def stop(*a, **k):
            raise StopAfterOhlc

        monkeypatch.setattr(producer.pd, "DataFrame", stop)

        def publish():
            with pytest.raises(StopAfterOhlc):
                producer.main(["NVDA"])

        return tmp_path / "NVDA.json", publish
    if kind == "backtest":
        bt = {"status": "ok", "trades": [{"fixture": True}], "first": "2026-10-08"}
        return tmp_path / "NVDA.backtest.json", lambda: producer.write_backtest_artifact(
            "NVDA", bt, {"fixture": "完整"}, tmp_path
        )
    return tmp_path / "manifest.json", lambda: producer.main([])


class PartialDiskFull:
    def __init__(self, stream):
        self.stream = stream

    def __enter__(self):
        self.stream.__enter__()
        return self

    def __exit__(self, *args):
        return self.stream.__exit__(*args)

    def __getattr__(self, name):
        return getattr(self.stream, name)

    def write(self, text):
        self.stream.write(text[:17])
        self.stream.flush()
        raise OSError(errno.ENOSPC, "simulated disk full after partial write")


@pytest.mark.parametrize("kind", ["ohlc", "backtest", "manifest"])
def test_disk_full_preserves_published_preimage(monkeypatch, tmp_path, kind):
    path, publish = artifact(monkeypatch, tmp_path, kind)
    before = b'{"prior":"complete","bars":[]}'
    path.write_bytes(before)
    real_open = io.open

    def failing_open(file, mode="r", *args, **kwargs):
        stream = real_open(file, mode, *args, **kwargs)
        return PartialDiskFull(stream) if "w" in mode else stream

    monkeypatch.setattr(io, "open", failing_open)
    with pytest.raises(OSError, match="simulated disk full"):
        publish()
    assert path.read_bytes() == before
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("kind", ["ohlc", "backtest", "manifest"])
def test_failed_publish_preserves_preimage(monkeypatch, tmp_path, kind):
    path, publish = artifact(monkeypatch, tmp_path, kind)
    before = b'{"prior":"complete"}'
    path.write_bytes(before)

    def reject_replace(*args):
        raise OSError(errno.EIO, "simulated rename failure")

    monkeypatch.setattr(os, "replace", reject_replace)
    with pytest.raises(OSError, match="simulated rename failure"):
        publish()
    assert path.read_bytes() == before
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("kind", ["ohlc", "backtest", "manifest"])
def test_reader_sees_old_until_complete_publish(monkeypatch, tmp_path, kind):
    path, publish = artifact(monkeypatch, tmp_path, kind)
    before = b'{"prior":"complete"}'
    path.write_bytes(before)
    real_open = io.open
    observed = []

    class ObserveDuringWrite:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            self.stream.__enter__()
            return self

        def __exit__(self, *args):
            return self.stream.__exit__(*args)

        def __getattr__(self, name):
            return getattr(self.stream, name)

        def write(self, text):
            midpoint = len(text) // 2
            self.stream.write(text[:midpoint])
            self.stream.flush()
            observed.append(path.read_bytes())
            self.stream.write(text[midpoint:])
            return len(text)

    def observed_open(file, mode="r", *args, **kwargs):
        stream = real_open(file, mode, *args, **kwargs)
        return ObserveDuringWrite(stream) if "w" in mode else stream

    monkeypatch.setattr(io, "open", observed_open)
    publish()
    assert observed and all(value == before for value in observed)
    assert "prior" not in json.loads(path.read_bytes())
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("kind", ["ohlc", "backtest", "manifest"])
def test_success_publishes_complete_readable_json(monkeypatch, tmp_path, kind):
    path, publish = artifact(monkeypatch, tmp_path, kind)
    publish()
    doc = json.loads(path.read_bytes())
    if kind == "ohlc":
        assert doc["t"] == "NVDA" and len(doc["bars"]) == 120
        assert doc["src"] == "fixture"
    elif kind == "backtest":
        assert doc["fixture"] == "完整" and doc["equity"]["v"] == [1.0]
    else:
        assert doc["symbols"] == {} and doc["source"] == "polygon"
    assert path.stat().st_mode & 0o777 == 0o644
    assert list(tmp_path.iterdir()) == [path]
