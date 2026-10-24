"""Snapshot-integrity tests: ONE immutable read binds parsed SQL to receipt SHA.

Regression harness for the two-read defect in scripts/supabase_apply.py:
run_dry() and run_apply() used to read the migration file twice --
path.read_text() for the parser, then a separate path.read_bytes() for the
sha256 -- so a concurrent rewrite landing between the two reads let the
receipt identify bytes that were never parsed, or the parser run bytes
not identified by the receipt.

Everything here is synthetic and in-memory: no real migration file, no
credentials, no network. A race-controlled Path stand-in hands read_bytes()
one immutable buffer while read_text() hands back a DIFFERENT buffer (the
version a racing rewrite between the two reads would produce) and counts
every access. The one-read contract: exactly one read_bytes call, zero
read_text calls, and every statement sent and every digest written must
derive from that single buffer -- even after the fake transport rewrites
the file's backing source mid-run.
"""
from __future__ import annotations

import hashlib
import json

import pytest

import scripts.supabase_apply as supabase_apply_module
from scripts.supabase_apply import run_apply, run_dry, split_statements


# Synthetic SELECT-like migration content (not a real migration): one
# statement, a down block, and a readback block, so the idempotency guard
# passes and run_apply walks its full pre-readback / apply / post-readback
# sequence against the fake QueryRunner.
RAW_SNAPSHOT = (
    b"select 1 as probe;\n"
    b"-- synthetic one-read probe -- not a real migration\n"
    b"-- down:\n"
    b"-- select 0 as undo;\n"
    b"\n"
    b"-- readback:\n"
    b"-- select 1 as probe;\n"
)
PROBE_SQL = "select 1 as probe"

# The divergent buffer read_text() would hand back if a concurrent rewrite
# landed between the old implementation's two back-to-back reads: same file
# shape, different SQL.
DECOY_TEXT = (
    "select 2 as decoy;\n"
    "select 3 as decoy;\n"
    "-- decoy: what a rewrite between two back-to-back reads would yield\n"
    "-- down:\n"
    "-- select 0 as undo;\n"
    "\n"
    "-- readback:\n"
    "-- select 9 as decoy;\n"
)

# Exact-byte case: UTF-8 multibyte characters inside the statement literal
# and CRLF line endings throughout -- the receipt digest must be taken over
# THESE exact bytes, never over a newline-normalized or re-encoded copy.
PROBE_UNICODE_SQL = "select 'é中\U0001f600' as probe"
RAW_UNICODE_CRLF = (
    "select 'é中\U0001f600' as probe;\r\n"
    "-- synthetic exact-byte probe -- not a real migration (unicode: é中\U0001f600)\r\n"
    "-- down:\r\n"
    "-- select 0 as undo;\r\n"
    "\r\n"
    "-- readback:\r\n"
    "-- select 'é中\U0001f600' as probe;\r\n"
).encode("utf-8")


class SnapshotProbe:
    """Race-controlled stand-in for the migration Path.

    read_bytes() always returns the ONE immutable snapshot and counts its
    calls; read_text() returns the DIFFERENT decoy buffer and counts its
    calls too. The one-read contract is observable directly: exactly one
    read_bytes call, zero read_text calls, no matter what happens to the
    file meanwhile.
    """

    def __init__(self, raw: bytes, decoy_text: str, name: str = "0001_snapshot_probe.sql") -> None:
        self.raw = raw
        self.decoy_text = decoy_text
        self.name = name
        self.read_bytes_calls = 0
        self.read_text_calls = 0

    def __fspath__(self) -> str:
        return self.name

    def __str__(self) -> str:
        return self.name

    def read_bytes(self) -> bytes:
        self.read_bytes_calls += 1
        return self.raw

    def read_text(self, *args, **kwargs) -> str:
        self.read_text_calls += 1
        return self.decoy_text


class MutatingRunner:
    """Fake QueryRunner: records every statement it is sent and, on its
    first call, rewrites the probe's backing buffer behind the run -- so
    any later re-read of the file (for instance to hash it at receipt
    time) would see different bytes than the ones actually parsed."""

    def __init__(self, probe: SnapshotProbe, rows=None) -> None:
        self.probe = probe
        self.rows = rows if rows is not None else [{"probe": 1}]
        self.calls: list[str] = []

    def __call__(self, sql: str):
        self.calls.append(sql)
        if len(self.calls) == 1:
            self.probe.raw = self.probe.raw + b"\n-- rewritten while the run was in flight\n"
        return self.rows


@pytest.fixture(autouse=True)
def fake_credentials_resolver(monkeypatch):
    # run_dry() resolves credentials before printing; stand in for it so no
    # test ever touches a real .env, environment token, or project ref.
    monkeypatch.setattr(
        supabase_apply_module,
        "resolve_credentials",
        lambda override=None: ("fake-snapshot-token", "fake-project-ref"),
    )


def test_run_dry_parses_and_hashes_one_immutable_read(capsys):
    probe = SnapshotProbe(RAW_SNAPSHOT, DECOY_TEXT)
    rc = run_dry(probe)
    assert rc == 0
    out = capsys.readouterr().out
    # The statements shown and the digest shown come from the SAME buffer.
    assert f"sha256:  {hashlib.sha256(RAW_SNAPSHOT).hexdigest()}" in out
    assert PROBE_SQL in out
    assert "select 2 as decoy" not in out
    assert "select 3 as decoy" not in out
    assert "select 9 as decoy" not in out
    # Exactly one read of the file; the second (text) read never happens.
    assert probe.read_bytes_calls == 1
    assert probe.read_text_calls == 0


def test_run_apply_receipt_digest_is_bound_to_the_one_parsed_buffer(tmp_path):
    probe = SnapshotProbe(RAW_SNAPSHOT, DECOY_TEXT)
    original = bytes(RAW_SNAPSHOT)
    runner = MutatingRunner(probe)
    receipt_path = tmp_path / "receipt.json"
    rc = run_apply(
        probe,
        runner=runner,
        receipt_path=receipt_path,
        project_ref="fake-project-ref",
        accept_unverifiable=True,
    )
    assert rc == 0
    # The backing source was rewritten mid-run -- and that produced no extra
    # read: the digest came from the single initial read, never a re-open.
    assert probe.raw != original
    assert probe.read_bytes_calls == 1
    assert probe.read_text_calls == 0
    # Every statement sent (pre-readback, apply, post-readback) is the one
    # the snapshot parses into -- never a statement from the decoy buffer.
    assert runner.calls == [PROBE_SQL, PROBE_SQL, PROBE_SQL]
    receipt = json.loads(receipt_path.read_text())
    assert receipt["sha256"] == hashlib.sha256(original).hexdigest()
    assert receipt["file"] == "0001_snapshot_probe.sql"


def test_unicode_crlf_snapshot_binds_text_and_digest_to_the_exact_bytes(tmp_path):
    raw = RAW_UNICODE_CRLF
    # Positive control for the fixture itself: the exact raw bytes and a
    # newline-normalized copy hash differently, so a receipt digest over the
    # exact buffer is distinguishable from one over a normalized re-read.
    normalized = raw.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
    assert hashlib.sha256(raw).hexdigest() != hashlib.sha256(normalized).hexdigest()

    probe = SnapshotProbe(raw, DECOY_TEXT)
    runner = MutatingRunner(probe)
    receipt_path = tmp_path / "receipt.json"
    rc = run_apply(
        probe,
        runner=runner,
        receipt_path=receipt_path,
        project_ref="fake-project-ref",
        accept_unverifiable=True,
    )
    assert rc == 0
    assert probe.read_bytes_calls == 1
    assert probe.read_text_calls == 0
    # The UTF-8 text parsed and sent is decoded from the exact raw buffer,
    # multibyte characters intact.
    assert runner.calls == [PROBE_UNICODE_SQL, PROBE_UNICODE_SQL, PROBE_UNICODE_SQL]
    receipt = json.loads(receipt_path.read_text())
    # CRLF included: the hash covers the exact raw bytes as supplied.
    assert receipt["sha256"] == hashlib.sha256(raw).hexdigest()


def test_the_probe_really_presents_two_divergent_buffers():
    # Positive control: the fake must hand read_text a genuinely different
    # buffer than read_bytes, or the one-read tests above would pass
    # vacuously against a two-read implementation. The OLD two-read
    # sequence binds the digest to bytes that were never parsed -- exactly
    # the hazard this file pins shut.
    probe = SnapshotProbe(RAW_SNAPSHOT, DECOY_TEXT)
    raced_text = probe.read_text()
    raced_digest = hashlib.sha256(probe.read_bytes()).hexdigest()
    assert probe.read_text_calls == 1 and probe.read_bytes_calls == 1
    assert hashlib.sha256(raced_text.encode("utf-8")).hexdigest() != raced_digest
    assert split_statements(raced_text) != split_statements(probe.read_bytes().decode("utf-8"))


@pytest.mark.parametrize("expected", ["0" * 64, "", "A" * 64, "a" * 63, "a" * 65, "g" * 64, "a" * 64 + "\n", 123, False])
@pytest.mark.parametrize("mode", ["dry", "apply"])
def test_source_pin_refuses_before_queries_and_preserves_receipt(expected, mode, tmp_path, monkeypatch):
    probe = SnapshotProbe(RAW_SNAPSHOT, DECOY_TEXT)
    runner = MutatingRunner(probe)
    receipt = tmp_path / "existing.json"
    receipt.write_text('existing original receipt')
    def forbidden_credentials(*args):
        pytest.fail("refused dry run must not resolve credentials")
    monkeypatch.setattr(supabase_apply_module, "resolve_credentials", forbidden_credentials)
    if mode == "dry":
        rc = run_dry(probe, expected_source_sha256=expected)
    else:
        rc = run_apply(probe, runner=runner, receipt_path=receipt,
                       project_ref="fake", expected_source_sha256=expected)
    assert rc == 3
    assert runner.calls == []
    assert receipt.read_text() == 'existing original receipt'
    assert probe.read_bytes_calls == 1 and probe.read_text_calls == 0


@pytest.mark.parametrize("mode", ["dry", "apply"])
def test_source_pin_matching_exact_crlf_snapshot_survives_later_mutation(mode, tmp_path):
    probe = SnapshotProbe(RAW_UNICODE_CRLF, DECOY_TEXT)
    expected = hashlib.sha256(RAW_UNICODE_CRLF).hexdigest()
    runner = MutatingRunner(probe)
    receipt = tmp_path / "receipt.json"
    if mode == "dry":
        assert run_dry(probe, expected_source_sha256=expected) == 0
    else:
        assert run_apply(probe, runner=runner, receipt_path=receipt, project_ref="fake",
                         accept_unverifiable=True, expected_source_sha256=expected) == 0
        assert runner.calls == [PROBE_UNICODE_SQL] * 3
        assert probe.raw != RAW_UNICODE_CRLF
        assert json.loads(receipt.read_text())["sha256"] == expected
    assert probe.read_bytes_calls == 1 and probe.read_text_calls == 0


def test_normalized_crlf_hash_is_not_the_source_pin(tmp_path):
    probe = SnapshotProbe(RAW_UNICODE_CRLF, DECOY_TEXT)
    runner = MutatingRunner(probe)
    receipt = tmp_path / "not-created.json"
    normalized = RAW_UNICODE_CRLF.replace(b"\r\n", b"\n")
    assert run_apply(probe, runner=runner, receipt_path=receipt, project_ref="fake",
                     expected_source_sha256=hashlib.sha256(normalized).hexdigest()) == 3
    assert not receipt.exists() and runner.calls == []


@pytest.mark.parametrize("mode", ["dry-run", "apply"])
@pytest.mark.parametrize("expected", [None, "a" * 64])
def test_cli_forwards_source_pin_without_transport(mode, expected, tmp_path, monkeypatch):
    source = tmp_path / "synthetic.sql"
    source.write_bytes(RAW_SNAPSHOT)
    calls = []
    def fake_run(path, **kwargs):
        calls.append((path, kwargs))
        return 17
    monkeypatch.setattr(supabase_apply_module, "run_dry", fake_run)
    monkeypatch.setattr(supabase_apply_module, "run_apply", fake_run)
    monkeypatch.setattr(supabase_apply_module, "CurlRunner", lambda *a, **kw: object())
    args = [str(source), "--" + mode]
    if mode == "apply":
        args += ["--receipt", str(tmp_path / "receipt.json")]
    if expected is not None:
        args += ["--expected-source-sha256", expected]
    assert supabase_apply_module.main(args) == 17
    assert len(calls) == 1 and calls[0][0] == source
    assert calls[0][1]["expected_source_sha256"] == expected
