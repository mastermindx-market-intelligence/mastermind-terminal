"""Exercise 0030 through the approved helper's separate-connection transport.

Each runner call uses a new PostgreSQL connection, like each Management API
request. No credentials, network requests or production data are used.
"""
import csv
import io
import json
import subprocess
from uuid import uuid4

import pytest

from scripts import supabase_apply
from test_investigation_postgres import A, ROOT, SQL, apply, pg, quote

MIGRATION = ROOT / "supabase/migrations/0030_investigation_kernel.sql"


@pytest.fixture
def owner(pg):
    database = "transport_" + uuid4().hex
    # The template contains the real 0028 owner, roles and two test principals.
    pg(f"create database {database} template postgres")

    def run(sql, actor=None, check=True):
        return pg(sql, actor, check, database=database)

    for name in ("0012_thesis_objects.sql", "0029_investigation_thesis_refs.sql"):
        run((SQL.parent / name).read_text())
    run.target, run.operation = str(uuid4()), str(uuid4())
    run.original = apply(run, run.operation, target=run.target)
    run.database = database
    yield run
    pg(f"drop database {database}")


def transport(pg, owner):
    def query(sql):
        result = subprocess.run(
            [pg.binaries["psql"], *pg.connection, "-d", owner.database,
             "-X", "-q", "--csv", "-v", "ON_ERROR_STOP=1"],
            input=sql, text=True, capture_output=True,
        )
        if result.returncode:
            raise supabase_apply.ApiError(400, result.stderr)
        return list(csv.DictReader(io.StringIO(result.stdout)))
    return query


def invoke(pg, owner, tmp_path):
    receipt = tmp_path / "receipt.json"
    output = io.StringIO()
    code = supabase_apply.run_apply(
        MIGRATION, runner=transport(pg, owner), receipt_path=receipt,
        project_ref="local-test-only", out=output,
    )
    return code, json.loads(receipt.read_text()), output.getvalue()


def owner_snapshot(pg, owner):
    # Includes function definitions, ACLs, indexes, columns and constraints:
    # a failed backfill must not leave even the earlier validator replacement.
    schema = subprocess.run(
        [pg.binaries["pg_dump"], *pg.connection, "-d", owner.database,
         "--schema-only", "--schema=public", "--no-owner"],
        text=True, capture_output=True, check=True,
    ).stdout
    # New pg_dump versions emit a randomized psql restriction token.
    schema = "\n".join(line for line in schema.splitlines()
                       if not line.startswith(("\\restrict ", "\\unrestrict ")))
    rows = {table: owner(f"select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.{table} t")
            for table in ("investigations", "investigation_revisions",
                          "investigation_mutation_receipts", "chart_layout_revisions")}
    return schema, rows


def test_approved_transport_applies_and_reapplies_one_atomic_migration(pg, owner, tmp_path):
    for _ in range(2):
        code, receipt, output = invoke(pg, owner, tmp_path)
        assert code == 0, output
        assert receipt["status"] == "applied"
        assert receipt["statements_n"] == 1
        assert receipt["missing_after"] == []
    assert apply(owner, owner.operation, target=owner.target) == owner.original
    saved = json.loads(owner("select read_investigation_v2(" + quote(owner.target) + ",1)", A))
    assert saved["manifest"] == owner.original["manifest"]
    assert saved["operation_id"] == owner.operation
    assert saved["revision_id"] and saved["parent_revision_id"] is None
    assert owner("select has_function_privilege('anon','reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb)','EXECUTE')") == "f"


@pytest.mark.parametrize("failure", ["ambiguous_receipt", "duplicate_capture"])
def test_transport_failure_rolls_back_schema_grants_backfill_and_retained_rows(pg, owner, tmp_path, failure):
    if failure == "ambiguous_receipt":
        owner("insert into investigation_mutation_receipts select user_id," + quote(str(uuid4())) + ",request,result from investigation_mutation_receipts")
        expected = "investigation_revision_receipt_lineage_ambiguous"
    else:
        layout = str(uuid4())
        for _ in range(2):
            owner("insert into chart_layout_revisions values(" + quote(str(uuid4())) + "," + quote(A) + "," + quote(layout) + ",1,'Retained','{}'," + quote("a" * 64) + ",now())")
        expected = "chart_layout_revision_source"
    before = owner_snapshot(pg, owner)
    code, receipt, output = invoke(pg, owner, tmp_path)
    assert code == 5, output
    assert expected in receipt["error"]
    assert receipt["failed_statement_index"] == 1
    assert owner_snapshot(pg, owner) == before
