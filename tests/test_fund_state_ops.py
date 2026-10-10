from __future__ import annotations

import os
from pathlib import Path

import pytest

from ingest import fund_state_ops


def test_replace_file_copies_then_atomically_replaces_and_removes_source(tmp_path: Path) -> None:
    source_dir = tmp_path / "source"
    destination_dir = tmp_path / "destination"
    source_dir.mkdir(); destination_dir.mkdir()
    source = source_dir / "index.json"
    destination = destination_dir / "index.json"
    source.write_bytes(b"new-index")
    destination.write_bytes(b"old-index")

    fund_state_ops.replace_file(source, destination)

    assert destination.read_bytes() == b"new-index"
    assert not source.exists()
    assert not list(destination_dir.glob(".*.fund-state-*.tmp"))


def test_replace_file_preserves_source_when_atomic_destination_replace_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "source"
    destination = tmp_path / "dest"
    source.write_bytes(b"validated")
    destination.write_bytes(b"last-good")

    def refuse(_source: Path, _destination: Path) -> None:
        raise PermissionError("simulated TCC refusal")

    monkeypatch.setattr(fund_state_ops.os, "replace", refuse)
    with pytest.raises(PermissionError, match="TCC refusal"):
        fund_state_ops.replace_file(source, destination)

    assert source.read_bytes() == b"validated"
    assert destination.read_bytes() == b"last-good"
    assert not list(tmp_path.glob(".*.fund-state-*.tmp"))


def test_touch_file_creates_parent_and_stamp(tmp_path: Path) -> None:
    stamp = tmp_path / "nested" / ".stamp"
    fund_state_ops.touch_file(stamp)
    assert stamp.is_file()


def test_nightly_fund_routes_external_state_mutations_through_python_helper() -> None:
    text = (Path(__file__).resolve().parents[1] / "ops" / "nightly_fund.sh").read_text()
    assert 'fund_state_ops.py" replace "$TX_TMP" "$TX_INDEX"' in text
    assert 'fund_state_ops.py" replace "$TX_REVISION_CANDIDATE" "$TX_REVISION_MARKER"' in text
    assert 'fund_state_ops.py" touch "$TX_ROLE_REPAIR_STAMP"' in text
    assert 'fund_state_ops.py" touch "$TX_REFRESH_STAMP"' in text
    assert 'mv "$TX_TMP" "$TX_INDEX"' not in text
    assert 'mv "$TX_REVISION_CANDIDATE" "$TX_REVISION_MARKER"' not in text
    assert '\n      touch "$TX_ROLE_REPAIR_STAMP"\n' not in text
    assert '\n            touch "$TX_REFRESH_STAMP"\n' not in text
    assert '\n          touch "$TX_REFRESH_STAMP"\n' not in text
