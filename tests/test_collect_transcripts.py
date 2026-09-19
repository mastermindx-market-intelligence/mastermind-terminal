import os
import sys
import time

import pytest

import ingest.collect_transcripts as collect
from ingest.build_transcript_index import body_sha256
from ingest.collect_transcripts import _infer_role, _infer_transcript_roles


class _FakeTranscriptConnection:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, _query):
        return self

    def fetchall(self):
        return self.rows

    def close(self):
        return None


class _FakeTranscriptDuckDB:
    def __init__(self, rows):
        self.rows = rows

    def connect(self, _database):
        return _FakeTranscriptConnection(self.rows)


def _transcript_row(text: str):
    return (
        "AAPL",
        2026,
        3,
        "2026-07-31",
        [{"paragraph_number": 1, "speaker": "Jane Doe", "content": text}],
    )



def test_parquet_source_tracks_defeatbeta_us_namespace() -> None:
    """The live provider moved the US corpus under data/US on 2026-09-18."""

    assert collect.PARQUET_URL.endswith(
        "/resolve/main/data/US/stock_earning_call_transcripts.parquet"
    )
    assert "/resolve/main/data/stock_earning_call_transcripts.parquet" not in (
        collect.PARQUET_URL
    )

def test_unchanged_upstream_revision_skips_download_even_when_cache_is_old(
    tmp_path, monkeypatch,
) -> None:
    parquet = tmp_path / "transcripts.parquet"
    parquet.write_bytes(b"valid parquet fixture")
    old = time.time() - ((collect.PARQUET_STALE_DAYS + 2) * 86400)
    os.utime(parquet, (old, old))
    cache_marker = tmp_path / "cache_revision"
    applied_marker = tmp_path / "applied_revision"
    revision = "etag:upstream-2026-08-01"

    monkeypatch.setattr(collect, "LOCAL_PARQUET", parquet)
    monkeypatch.setattr(collect, "MIN_PARQUET_BYTES", 1)
    monkeypatch.setattr(collect, "PARQUET_CACHE_REVISION_MARKER", cache_marker)
    monkeypatch.setattr(collect, "PARQUET_REVISION_MARKER", applied_marker)
    collect._write_revision_marker(cache_marker, revision)
    collect._write_revision_marker(applied_marker, revision)
    monkeypatch.setattr(collect, "_probe_parquet_revision", lambda: revision)

    assert collect._need_download(upstream_revision=revision) is False
    assert collect._parquet_revision_probe_status() == (
        collect.REVISION_UNCHANGED,
        revision,
        None,
    )


def test_changed_upstream_revision_requests_one_refresh(tmp_path, monkeypatch) -> None:
    parquet = tmp_path / "transcripts.parquet"
    parquet.write_bytes(b"valid parquet fixture")
    cache_marker = tmp_path / "cache_revision"
    applied_marker = tmp_path / "applied_revision"
    old_revision = "etag:upstream-old"
    new_revision = "etag:upstream-new"

    monkeypatch.setattr(collect, "LOCAL_PARQUET", parquet)
    monkeypatch.setattr(collect, "MIN_PARQUET_BYTES", 1)
    monkeypatch.setattr(collect, "PARQUET_CACHE_REVISION_MARKER", cache_marker)
    monkeypatch.setattr(collect, "PARQUET_REVISION_MARKER", applied_marker)
    collect._write_revision_marker(cache_marker, old_revision)
    collect._write_revision_marker(applied_marker, old_revision)
    monkeypatch.setattr(collect, "_probe_parquet_revision", lambda: new_revision)

    assert collect._parquet_revision_probe_status() == (
        collect.REVISION_CHANGED,
        new_revision,
        None,
    )
    assert collect._need_download(upstream_revision=new_revision) is True


def test_probe_failure_preserves_existing_age_fallback(tmp_path, monkeypatch) -> None:
    parquet = tmp_path / "transcripts.parquet"
    parquet.write_bytes(b"valid parquet fixture")
    monkeypatch.setattr(collect, "LOCAL_PARQUET", parquet)
    monkeypatch.setattr(collect, "MIN_PARQUET_BYTES", 1)

    def failed_probe():
        raise RuntimeError("temporary Hugging Face outage")

    monkeypatch.setattr(collect, "_probe_parquet_revision", failed_probe)
    status, revision, error = collect._parquet_revision_probe_status()
    assert status == collect.REVISION_PROBE_FAILED
    assert revision is None
    assert "temporary Hugging Face outage" in (error or "")

    assert collect._need_download() is False
    old = time.time() - ((collect.PARQUET_STALE_DAYS + 2) * 86400)
    os.utime(parquet, (old, old))
    assert collect._need_download() is True


def test_revision_candidate_is_written_only_after_successful_processing(
    tmp_path, monkeypatch,
) -> None:
    parquet = tmp_path / "transcripts.parquet"
    parquet.write_bytes(b"valid parquet fixture")
    cache_marker = tmp_path / "cache_revision"
    applied_marker = tmp_path / "applied_revision"
    candidate = tmp_path / "revision_candidate"
    revision = "etag:upstream-new"

    monkeypatch.setattr(collect, "LOCAL_PARQUET", parquet)
    monkeypatch.setattr(collect, "MIN_PARQUET_BYTES", 1)
    monkeypatch.setattr(collect, "PARQUET_CACHE_REVISION_MARKER", cache_marker)
    monkeypatch.setattr(collect, "PARQUET_REVISION_MARKER", applied_marker)
    monkeypatch.setattr(collect, "TX_OUT", tmp_path / "tx")
    monkeypatch.setattr(collect, "_is_running_in_dbeta_venv", lambda: True)
    monkeypatch.setitem(sys.modules, "duckdb", object())
    collect._write_revision_marker(cache_marker, revision)
    collect._write_revision_marker(applied_marker, "etag:upstream-old")

    args = [
        "collect_transcripts.py",
        "--only", "AAPL",
        "--quarters", "1",
        "--defer-index-publish",
        "--upstream-revision", revision,
        "--revision-candidate-out", str(candidate),
    ]
    monkeypatch.setattr(sys, "argv", args)
    monkeypatch.setattr(collect, "process_symbol", lambda *_args: (1, ["2026Q3"]))

    assert collect.main() == 0
    assert collect._read_revision_marker(candidate) == revision
    assert collect._read_revision_marker(applied_marker) == "etag:upstream-old"

    candidate.unlink()

    def failed_processing(*_args):
        raise RuntimeError("DuckDB processing failed")

    monkeypatch.setattr(collect, "process_symbol", failed_processing)
    with pytest.raises(RuntimeError, match="DuckDB processing failed"):
        collect.main()
    assert not candidate.exists()
    assert collect._read_revision_marker(applied_marker) == "etag:upstream-old"


def test_existing_unchanged_body_is_not_rewritten(tmp_path, monkeypatch) -> None:
    tx_root = tmp_path / "tx"
    monkeypatch.setattr(collect, "TX_OUT", tx_root)
    source = _FakeTranscriptDuckDB([_transcript_row("Prepared remarks.")])

    first_written, first_ids = collect.process_symbol("AAPL", "fixture.parquet", 1, source)
    path = tx_root / "AAPL" / "2026Q3.json.gz"
    stable_mtime = 1_700_000_000_123_456_789
    os.utime(path, ns=(stable_mtime, stable_mtime))
    compressed = path.read_bytes()

    second_written, second_ids = collect.process_symbol("AAPL", "fixture.parquet", 1, source)

    assert first_written == 1
    assert second_written == 0
    assert first_ids == second_ids == ["2026Q3"]
    assert path.stat().st_mtime_ns == stable_mtime
    assert path.read_bytes() == compressed


def test_corrected_same_id_body_is_atomically_rewritten_once(tmp_path, monkeypatch) -> None:
    tx_root = tmp_path / "tx"
    monkeypatch.setattr(collect, "TX_OUT", tx_root)
    original = _FakeTranscriptDuckDB([_transcript_row("Original prepared remarks.")])
    corrected = _FakeTranscriptDuckDB([_transcript_row("Corrected prepared remarks.")])

    first_written, first_ids = collect.process_symbol("AAPL", "fixture.parquet", 1, original)
    path = tx_root / "AAPL" / "2026Q3.json.gz"
    before = collect._read_body(path, "AAPL", "2026Q3")
    before_hash = body_sha256(before)
    replacements = []
    real_replace = os.replace

    def recorded_replace(source, destination):
        replacements.append((source, destination))
        real_replace(source, destination)

    monkeypatch.setattr(collect.os, "replace", recorded_replace)
    second_written, second_ids = collect.process_symbol("AAPL", "fixture.parquet", 1, corrected)
    after = collect._read_body(path, "AAPL", "2026Q3")

    assert first_written == second_written == 1
    assert first_ids == second_ids == ["2026Q3"]
    assert len(replacements) == 1
    assert replacements[0][0] == path.with_name(path.name + ".tmp")
    assert replacements[0][1] == path
    assert not path.with_name(path.name + ".tmp").exists()
    assert body_sha256(after) != before_hash
    assert after["segments"][0]["text"] == "Corrected prepared remarks."


def test_corrupt_existing_body_is_repaired_without_changing_id(tmp_path, monkeypatch) -> None:
    tx_root = tmp_path / "tx"
    path = tx_root / "AAPL" / "2026Q3.json.gz"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"not a gzip body")
    monkeypatch.setattr(collect, "TX_OUT", tx_root)
    source = _FakeTranscriptDuckDB([_transcript_row("Prepared remarks.")])

    written, ids = collect.process_symbol("AAPL", "fixture.parquet", 1, source)
    repaired = collect._read_body(path, "AAPL", "2026Q3")

    assert written == 1
    assert ids == ["2026Q3"]
    assert repaired["id"] == "2026Q3"
    assert repaired["segments"][0]["text"] == "Prepared remarks."
    assert not path.with_name(path.name + ".tmp").exists()


def test_operator_label_wins_over_people_named_in_intro() -> None:
    assert _infer_role("Operator", "Our Chief Executive Officer is Jane Doe.") == "Operator"


def test_self_identified_investor_relations_is_not_the_named_ceo() -> None:
    text = (
        "My name is Suhasini Chandramouli, Director of Investor Relations. "
        "Speaking first today is Apple's CEO, Tim Cook."
    )
    assert _infer_role("Suhasini Chandramouli", text) == "IR"


def test_other_executive_title_is_not_assigned_to_current_speaker() -> None:
    assert _infer_role("Jane Doe", "I'll now hand it to our CFO, John Smith.") == ""


def test_role_embedded_in_speaker_label_is_accepted() -> None:
    assert _infer_role("Jane Doe, Chief Financial Officer", "Good afternoon.") == "CFO"


def test_role_next_to_current_speaker_name_is_accepted() -> None:
    text = "This is Jane Doe, Chief Financial Officer. Thank you for joining us."
    assert _infer_role("Jane Doe", text) == "CFO"


def test_unrelated_role_later_in_paragraph_is_not_accepted() -> None:
    text = "Thanks, everyone. I will turn the call over to our CEO, John Smith."
    assert _infer_role("Jane Doe", text) == ""


def test_i_am_joined_by_an_executive_is_not_self_identification() -> None:
    text = "I am joined today by William Oplinger, our President and Chief Executive Officer."
    assert _infer_role("Louis Langlois", text) == ""


def test_first_person_role_transition_is_accepted() -> None:
    assert _infer_role(
        "Kelly Young",
        "As I take on the role of CEO, I am mindful of the journey that brought us here.",
    ) == "CEO"
    assert _infer_role(
        "John Ternus",
        "Stepping into the role of CEO is an incredible honor, and it means a lot to me.",
    ) == "CEO"
    assert _infer_role(
        "Luca Maestri",
        "Serving as Apple's CFO has been a real privilege, and I've valued your support.",
    ) == "CFO"
    assert _infer_role(
        "Gary Fields",
        "I will be stepping down as CEO at our annual stockholders meeting.",
    ) == "CEO"


def test_roles_are_bound_to_the_named_person_not_the_first_title() -> None:
    assert _infer_role(
        "Stuart Ford",
        "I'm Stuart Ford, Head of Investor Relations, joined by our CEO and CFO.",
    ) == "IR"
    assert _infer_role(
        "Jorge Flores",
        "Our CEO, Jane Doe; COO, Jorge Flores; and CFO, John Smith are here.",
    ) == "COO"
    assert _infer_role(
        "Tyler Wilcox",
        "This is Tyler Wilcox, and joining me is Katie Bailey, our CFO.",
    ) == ""


def test_colloquial_or_third_party_titles_do_not_leak() -> None:
    assert _infer_role(
        "Ryan Ezell",
        "I think this is like any other E&P operator in the basin.",
    ) == ""
    assert _infer_role(
        "Tony Smurfit",
        "Smurfit Westrock is an owner/operator, and I'm happy with our progress.",
    ) == ""
    assert _infer_role(
        "Jane Doe",
        "I'm sure we will share more at our Analyst Day.",
    ) == ""


def test_transcript_roster_role_is_propagated_without_oscillation() -> None:
    segments = [
        {
            "speaker": "Suhasini Chandramouli",
            "role": "",
            "text": (
                "My name is Suhasini Chandramouli, Director of Investor Relations. "
                "Speaking first is Apple's CEO, Tim Cook, followed by CFO, Kevan Parekh."
            ),
        },
        {"speaker": "Tim Cook", "role": "", "text": "Thank you, Suhasini."},
        {"speaker": "Suhasini Chandramouli", "role": "", "text": "Operator, next question."},
        {"speaker": "Kevan Parekh", "role": "", "text": "Revenue grew this quarter."},
    ]
    assert _infer_transcript_roles(segments) == ["IR", "CEO", "IR", "CFO"]
