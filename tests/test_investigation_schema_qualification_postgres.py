"""Future ordinary-source engine proof; reuses the incumbent PG lifecycle.

Not executed by Coverage. This disposable fixture is not a production query,
issuer proof, OPEN qualification, or settlement of the prior local startup.
"""
import json
from pathlib import Path
import subprocess

import pytest
from test_investigation_native_participant_postgres import pg  # existing lifecycle
from ops import investigation_schema_qualification as qualifier

ROOT = Path(__file__).resolve().parents[1]


def _qualify_actual_catalog(pg, mutation=""):
    calls = []

    def transport(argv, **kwargs):
        query = json.loads(Path(argv[argv.index("--data-binary") + 1][1:]).read_text())["query"]
        assert query == qualifier.CATALOG_QUERY
        assert "fixture-not-a-credential" not in " ".join(argv)
        # The functional harness starts with public apply/reconcile enabled.
        # Qualify its CLOSED grant state only within this transaction. ROLLBACK
        # restores it; a psql error closes this connection and rolls back too.
        closed = ("revoke execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb),"
                  "public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;")
        value = pg("begin;" + closed + mutation + query + "rollback;")
        catalog = json.loads(value)
        calls.append(query)
        # Preserve the actual engine result; never synthesize expected rows.
        return subprocess.CompletedProcess(argv, 0, json.dumps([{"catalog": catalog}]) + "\n200", "")

    head = qualifier._git(ROOT, "rev-parse", "HEAD").decode().strip()
    result = qualifier.qualify_native_schema(
        runner=qualifier.CurlRunner("a" * 20, "fixture-not-a-credential", runner=transport),
        source_root=ROOT, expected_source_sha=head, expected_project_ref="a" * 20,
        expected_database="postgres")
    assert len(calls) == 1
    assert result["cutover_qualified"] is False
    assert result["application_provenance"] == "not_attested"
    return result


def test_native_catalog_actual_engine_closed_positive(pg):
    result = _qualify_actual_catalog(pg)
    assert result["state"] == "declared_native_facet_qualified", result["errors"]


def test_native_catalog_actual_engine_when_false_refused(pg):
    mutation = ("drop trigger investigation_native_receipt_guard on public.investigation_mutation_receipts;"
                "create trigger investigation_native_receipt_guard before update or delete on public.investigation_mutation_receipts "
                "for each row when (false) execute function public.investigation_native_receipt_guard_v1();")
    result = _qualify_actual_catalog(pg, mutation)
    assert result["state"] == "mismatch"
    assert "receipt_trigger_mismatch" in result["errors"]


@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("privilege", ["insert", "update"])
def test_native_catalog_actual_engine_column_only_write_refused(pg, role, privilege):
    result = _qualify_actual_catalog(pg,
        f"grant {privilege}(result) on public.investigation_mutation_receipts to {role};")
    assert result["state"] == "mismatch"
    assert "receipt_relation_access_mismatch" in result["errors"]
