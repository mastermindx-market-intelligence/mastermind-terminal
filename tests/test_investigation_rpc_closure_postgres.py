"""Declared RPC facet against the incumbent disposable PostgreSQL fixture.

No live query, new launcher, runtime cutoff, or global drain qualification.
The inherited fixture owns startup and awaited shutdown of its socket-only DB.
"""
import json
from pathlib import Path
import subprocess

import pytest

from test_investigation_native_participant_postgres import pg
from ops import investigation_rpc_closure as observer

ROOT = Path(__file__).resolve().parents[1]
APPLY = "public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb)"


@pytest.fixture(scope="module")
def closed_pg(pg):
    # A durable CLOSED state in this disposable DB lets both read-only samples
    # see the same ACL tuple versions. No per-read revoke/rollback changes xmin.
    pg("revoke execute on function " + APPLY + ","
       "public.reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb),"
       "public.claim_investigation_native_capture_v1(jsonb,jsonb) "
       "from public,anon,authenticated,service_role;"
       "revoke insert,update,delete,truncate on public.chart_layout_revisions,"
       "public.investigation_mutation_receipts,public.investigation_revisions,"
       "public.investigations from public,anon,authenticated,service_role;")
    # The outer incumbent fixture destroys this dedicated module's DB afterward;
    # no production grants, shared fixture, or original startup is being repaired.
    return pg


def _observe(pg):
    calls = []

    def transport(argv, **kwargs):
        query = json.loads(Path(argv[argv.index("--data-binary") + 1][1:]).read_text())["query"]
        assert query == observer.CATALOG_QUERY
        assert "fixture-not-a-credential" not in " ".join(argv)
        row = json.loads(pg(query))
        calls.append(row)
        return subprocess.CompletedProcess(argv, 0, json.dumps([{"closure": row}]) + "\n200", "")

    head = observer.NATIVE._git(ROOT, "rev-parse", "HEAD").decode().strip()
    result = observer.observe_rpc_closure(
        runner=observer.CurlRunner("a" * 20, "fixture-not-a-credential", runner=transport),
        source_root=ROOT, expected_source_sha=head, expected_project_ref="a" * 20,
        expected_database="postgres")
    assert result["cutover_qualified"] is False
    assert result["drain_proven"] is False
    assert result["admission_cutoff_proven"] is False
    assert result["http_current_set_qualified"] is False
    return result, calls


def test_rpc_query_actual_engine_shape(closed_pg):
    row = json.loads(closed_pg(observer.CATALOG_QUERY))
    assert row["database"] == "postgres"
    assert row["function_count"] == len(observer.NEW_WORK) + 2
    assert row["relation_count"] == len(observer.TABLES)
    assert row["role_scope_count"] == len(row["role_scope"]) >= len(observer.ROLES)
    assert row["native_count"] == len(row["native_rows"]) == 0


def test_rpc_query_actual_engine_two_closed_observations(closed_pg):
    result, calls = _observe(closed_pg)
    assert result["state"] == "declared_rpc_new_work_closed", {
        "errors": result["errors"],
        "database_oid": calls[0]["database_oid"],
        "database_oid_type": type(calls[0]["database_oid"]).__name__,
        "role_oid_type": type(calls[0]["role_scope"][0]["oid"]).__name__,
    }
    assert result["rpc_new_work_closed"] is True
    assert len(calls) == len(result["observations"]) == 2


def test_rpc_query_actual_engine_hostile_execute_refused(closed_pg):
    closed_pg("grant execute on function " + APPLY + " to authenticated;")
    try:
        result, calls = _observe(closed_pg)
        assert calls
        assert result["rpc_new_work_closed"] is False
        assert "new_work_or_untrusted_completion_role_open" in result["errors"]
    finally:
        closed_pg("revoke execute on function " + APPLY + " from authenticated;")
