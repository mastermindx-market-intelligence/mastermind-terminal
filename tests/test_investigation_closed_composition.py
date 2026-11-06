"""Source assembly/parser proof only. Never executes SQL or resolves credentials."""
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/investigation_cutover/0030-pinned-source.txt"


def owner():
    spec = importlib.util.spec_from_file_location("closed_composition", ROOT / "ops/investigation_closed_composition.py")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def test_exact_pinned_body_is_inside_one_incumbent_statement():
    code = owner()
    original = FIXTURE.read_bytes()
    composed = code.compose_closed_migration(original)
    from scripts.supabase_apply import split_statements, strip_sql_comments, readback_statements
    statements = split_statements(composed.decode())
    assert len(statements) == 1
    sent = strip_sql_comments(statements[0])
    start = sent.index(code.INNER_TAG) + len(code.INNER_TAG)
    end = sent.index(code.INNER_TAG, start)
    assert sent[start:end].encode() == original
    assert readback_statements(composed.decode())[-1] == code.GRANT_READBACK.rstrip(";")
    assert code.validate_closed_composition(original, composed) is None


def test_final_revokes_are_after_migration_and_not_swallowed():
    code = owner()
    text = code.compose_closed_migration(FIXTURE.read_bytes()).decode()
    tail = text.split(code.INNER_TAG)[-1]
    assert tail.index(code.FINAL_REVOKE) < tail.index("RAISE EXCEPTION")
    assert "EXCEPTION WHEN" not in tail and "COMMIT;" not in tail and "ROLLBACK;" not in tail
    assert text.rstrip().endswith(code.OUTER_TAG + ";")


def test_changed_or_unqualified_migration_bytes_refuse():
    code = owner()
    import pytest
    for raw in [b"", b"DO $$ BEGIN NULL; END $$;", FIXTURE.read_bytes() + b"\n"]:
        with pytest.raises(code.CompositionRefused):
            code.compose_closed_migration(raw)


def test_regrant_window_split_and_error_swallow_mutations_refuse():
    code = owner()
    import pytest
    raw = FIXTURE.read_bytes()
    composed = code.compose_closed_migration(raw)
    before_revoke, after_revoke = composed.rsplit(code.FINAL_REVOKE.encode(), 1)
    for changed in [
        before_revoke + b"NULL;" + after_revoke,
        composed + b"COMMIT;\n",
        composed.replace(b"END\n" + code.OUTER_TAG.encode(), b"EXCEPTION WHEN OTHERS THEN NULL; END\n" + code.OUTER_TAG.encode()),
        composed.replace(code.GRANT_ASSERTION.encode(), b"NULL;", 1),
    ]:
        with pytest.raises(code.CompositionRefused):
            code.validate_closed_composition(raw, changed)


def test_incumbent_metadata_and_guard_contract_still_parse():
    code = owner()
    from scripts.supabase_apply import readback_statements, idempotency_findings, split_statements
    text = code.compose_closed_migration(FIXTURE.read_bytes()).decode()
    assert len(readback_statements(text)) >= 5
    assert idempotency_findings(text, split_statements(text)) == []


def test_module_can_be_imported_from_ops_working_directory(tmp_path):
    import subprocess
    result = subprocess.run([sys.executable, "-I", "-c",
        "import runpy; runpy.run_path(" + repr(str(ROOT / 'ops/investigation_closed_composition.py')) + ")"],
        cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0 and not result.stdout and not result.stderr


def test_separate_begin_commit_would_not_be_one_incumbent_request():
    from scripts.supabase_apply import split_statements
    code = owner()
    broken = "BEGIN;\n" + FIXTURE.read_text() + "\n" + code.FINAL_REVOKE + "\nCOMMIT;"
    assert len(split_statements(broken)) == 4
    import pytest
    with pytest.raises(code.CompositionRefused):
        code.validate_closed_composition(FIXTURE.read_bytes(), broken.encode())


def test_incumbent_failure_is_one_failed_statement_not_a_later_revoke_request(tmp_path):
    # Actual owner orchestration, synthetic QueryRunner only: not an engine
    # rollback experiment and not an invocation of the held SQL qualifier.
    from scripts.supabase_apply import ApiError, run_apply
    import io
    import json
    code = owner()
    path = tmp_path / "0030-closed-source.txt"
    path.write_bytes(code.compose_closed_migration(FIXTURE.read_bytes()))
    mutations = []
    def runner(query):
        if query.lstrip().startswith("DO "):
            mutations.append(query)
            raise ApiError(400, "synthetic statement failure")
        assert query.lstrip().lower().startswith("select ")
        return []
    receipt = tmp_path / "synthetic-owner-result.json"
    rc = run_apply(path, runner=runner, receipt_path=receipt,
                   project_ref="fixture-only", out=io.StringIO())
    result = json.loads(receipt.read_text())
    assert rc == 5 and result["status"] == "failed"
    assert result["failed_statement_index"] == 1 and len(mutations) == 1
