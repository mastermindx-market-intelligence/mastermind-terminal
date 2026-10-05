"""Apply the forward repair to the real owner schema, then exercise shared bytes."""
import hashlib
import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from test_investigation_postgres import pg, quote, ROOT, A, B, apply, manifest
from test_investigation_kernel import CORPUS


@pytest.fixture(scope="module")
def kernel(pg):
    for file in ("0012_thesis_objects.sql", "0029_investigation_thesis_refs.sql"):
        pg((ROOT / "supabase/migrations" / file).read_text())
    pg.legacy_target, pg.legacy_operation = str(uuid4()), str(uuid4())
    pg.legacy_result = apply(pg, pg.legacy_operation, target=pg.legacy_target)
    for _ in range(2):
        pg((ROOT / "supabase/migrations/0030_investigation_kernel.sql").read_text())
    return pg


@pytest.mark.parametrize("vector", CORPUS["vectors"], ids=lambda v: v["name"])
def test_postgres_shared_semantics_bytes_digest(kernel, vector):
    payload = quote(json.dumps(vector["manifest"], ensure_ascii=False)) + "::jsonb"
    assert kernel("select valid_investigation_manifest_v2(" + payload + ")") == ("t" if vector["valid"] else "f")
    if vector["valid"]:
        # JSON envelope preserves significant leading/trailing authored whitespace.
        result = json.loads(kernel("select jsonb_build_object('canonical',investigation_json_v2(" + payload + "),'digest',encode(extensions.digest(convert_to(investigation_json_v2(" + payload + "),'UTF8'),'sha256'),'hex'))"))
        assert result["canonical"] == vector["canonical"]
        assert result["digest"] == vector["sha256"]
        assert hashlib.sha256(result["canonical"].encode()).hexdigest() == vector["sha256"]


def draft(question="Authored research"):
    return {**manifest(question), "argument_relations": []}


def reconcile_sql(target, operation, body, action="create", expected=0):
    return "select reconcile_investigation_operation_v2(" + ",".join((quote(target), str(expected), quote(action), quote(operation), quote(json.dumps(body))+"::jsonb")) + ");"


def test_legacy_rows_and_original_receipts_remain_exact(kernel):
    saved = json.loads(kernel("select read_investigation_v2(" + quote(kernel.legacy_target) + ",1)", A))
    assert saved["manifest"] == kernel.legacy_result["manifest"]
    assert "argument_relations" not in saved["manifest"]
    assert saved["operation_id"] == kernel.legacy_operation
    assert saved["parent_revision_id"] is None and saved["sequence"] == 1
    assert apply(kernel, kernel.legacy_operation, target=kernel.legacy_target) == kernel.legacy_result
    removed = apply(kernel, str(uuid4()), "remove", 1, saved["manifest"], kernel.legacy_target)
    assert removed["status"] == "committed"
    assert removed["manifest_digest"] == saved["manifest_digest"]


def test_server_revision_lineage_cas_digest_and_replay(kernel):
    target, op = str(uuid4()), str(uuid4())
    body = draft()
    first = apply(kernel, op, content=body, target=target)
    assert first["status"] == "committed" and first["sequence"] == first["revision"] == 1
    assert first["parent_revision_id"] is None and first["operation_id"] == op and first["author_ref"] == A
    assert first["manifest_digest"] == hashlib.sha256(json.dumps(body,sort_keys=True,separators=(",", ":"),ensure_ascii=False).encode()).hexdigest()
    assert first["recorded_at"] == first["committed_at"]
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda i: apply(kernel, str(uuid4()), "revise", 1, draft(str(i)), target), range(2)))
    assert sorted(r["status"] for r in results) == ["committed", "version_conflict"]
    second = next(r for r in results if r["status"] == "committed")
    assert second["parent_revision_id"] == first["revision_id"] and second["revision_id"] != first["revision_id"]
    assert apply(kernel, op, content=dict(reversed(list(body.items()))), target=target) == first
    assert apply(kernel, op, content=draft("Changed"), target=target)["status"] == "idempotency_conflict"
    old = json.loads(kernel("select read_investigation_v2("+quote(target)+",1)", A))
    assert old["revision_id"] == first["revision_id"] and old["manifest"] == body
    assert json.loads(kernel("select read_investigation_v2("+quote(target)+",1)", B))["status"] == "not_found"
    removed = apply(kernel, str(uuid4()), "remove", 2, second["manifest"], target)
    restored = apply(kernel, str(uuid4()), "restore", 3, second["manifest"], target)
    assert removed["manifest_digest"] == restored["manifest_digest"] == second["manifest_digest"]
    assert restored["parent_revision_id"] == removed["revision_id"]


def test_layout_owner_mints_and_reuses_identity_without_mutating_head(kernel):
    layout = str(uuid4())
    config = json.loads((ROOT / "terminal/lib/__tests__/fixtures/workspace/chart_layout_v2_real_capture.json").read_text())["expected"]
    kernel("insert into chart_layouts values ("+quote(layout)+","+quote(A)+",'Layout',"+quote(json.dumps(config))+",now())")
    capture = {"layout_id": layout, "expected_revision": 1}
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: apply(kernel, str(uuid4()), content=draft(), target=str(uuid4()), capture=capture), range(2)))
    assert all(r["status"] == "committed" for r in results)
    ref = results[0]["manifest"]["layout_refs"][0]
    assert ref == results[1]["manifest"]["layout_refs"][0]
    assert kernel("select count(*) from chart_layout_revisions where layout_id="+quote(layout)) == "1"
    assert apply(kernel, str(uuid4()), content=draft(), target=str(uuid4()), capture={**capture,"revision_id":str(uuid4())})["status"] == "invalid_payload"
    assert apply(kernel, str(uuid4()), content=draft(), target=str(uuid4()), capture=capture, actor=B)["status"] == "reference_unavailable"
    kernel("update chart_layout_revisions set config=jsonb_set(config,'{name}','\"Divergence\"') where id="+quote(ref["layout_revision_id"]))
    assert apply(kernel, str(uuid4()), content=draft(), target=str(uuid4()), capture=capture)["status"] == "layout_conflict"
    kernel("update chart_layout_revisions set config="+quote(json.dumps(config))+" where id="+quote(ref["layout_revision_id"]))
    kernel("update chart_layouts set config=jsonb_set(config,'{revision}','2') where id="+quote(layout))
    saved = json.loads(kernel("select read_investigation_v2("+quote(results[0]["id"])+",1)", A))
    assert saved["layouts"][0]["config"] == config
    assert kernel("select config->>'revision' from chart_layouts where id="+quote(layout)) == "2"
    kernel("delete from chart_layouts where id="+quote(layout))
    assert json.loads(kernel("select read_investigation_v2("+quote(results[0]["id"])+",1)", A))["layouts"][0]["config"] == config


def test_terminal_no_effect_fence_prevents_a_delayed_original_write(kernel):
    target, op = str(uuid4()), str(uuid4())
    body = draft()
    original = json.loads(kernel(reconcile_sql(target, op, body), A))
    assert original == {"status":"not_applied", "id":target, "operation_id":op}
    assert apply(kernel, op, content=body, target=target) == original
    assert json.loads(kernel(reconcile_sql(target, op, body), A)) == original
    assert apply(kernel, op, content=draft("Changed"), target=target)["status"] == "idempotency_conflict"
    assert kernel("select count(*) from investigations where id="+quote(target)) == "0"
    assert apply(kernel, str(uuid4()), content=body, target=target)["status"] == "committed"


def test_failed_receipt_rolls_back_capture_and_then_reconciles_zero_effect(kernel):
    target, op, layout = str(uuid4()), str(uuid4()), str(uuid4())
    config = json.loads((ROOT / "terminal/lib/__tests__/fixtures/workspace/chart_layout_v2_real_capture.json").read_text())["expected"]
    kernel("insert into chart_layouts values ("+quote(layout)+","+quote(A)+",'Layout',"+quote(json.dumps(config))+",now())")
    body = draft()
    capture = {"layout_id":layout,"expected_revision":1}
    kernel("create function fail_kernel_receipt() returns trigger language plpgsql as $$begin raise exception 'kernel_receipt_failure'; end$$; create trigger fail_kernel_receipt before insert on investigation_mutation_receipts for each row execute function fail_kernel_receipt();")
    try:
        with pytest.raises(AssertionError,match="kernel_receipt_failure"):
            apply(kernel,op,content=body,target=target,capture=capture)
        assert kernel("select count(*) from investigations where id="+quote(target)) == "0"
        assert kernel("select count(*) from investigation_revisions where investigation_id="+quote(target)) == "0"
        assert kernel("select count(*) from chart_layout_revisions where layout_id="+quote(layout)) == "0"
    finally:
        kernel("drop trigger fail_kernel_receipt on investigation_mutation_receipts; drop function fail_kernel_receipt();")
    sql = reconcile_sql(target,op,body).replace("::jsonb);", "::jsonb,"+quote(json.dumps(capture))+"::jsonb);")
    fenced = json.loads(kernel(sql,A))
    assert fenced["status"] == "not_applied"
    assert apply(kernel,op,content=body,target=target,capture=capture) == fenced
    assert kernel("select count(*) from chart_layout_revisions where layout_id="+quote(layout)) == "0"


def test_reconcile_waits_for_original_transaction_and_returns_exact_commit(kernel):
    target, op = str(uuid4()), str(uuid4())
    body = draft()
    sql = "begin; set role authenticated; set request.jwt.claim.sub="+quote(A)+"; select apply_investigation_revision_v2("+quote(target)+",0,'create',"+quote(op)+","+quote(json.dumps(body))+"::jsonb); select pg_sleep(1); commit;"
    binary = getattr(kernel, "binaries", {}).get("psql", "psql")
    process = subprocess.Popen([binary,*kernel.connection,"-d","postgres","-X","-qAt","-v","ON_ERROR_STOP=1"], stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        process.stdin.write(sql); process.stdin.close()
        committed = json.loads(process.stdout.readline())  # apply holds its transaction lock
        start = time.monotonic()
        recovered = json.loads(kernel(reconcile_sql(target, op, body), A))
        assert time.monotonic()-start >= .5
        assert recovered == committed and recovered["status"] == "committed"
        assert process.wait(timeout=5) == 0
    finally:
        if process.poll() is None: process.terminate(); process.wait(timeout=5)


def test_kernel_backup_restore_preserves_uuid_lineage_digest_and_no_effect_fences(kernel):
    dump = kernel.backup_path.with_name("kernel-backup.dump")
    subprocess.run([kernel.binaries["pg_dump"],*kernel.connection,"-d","postgres","-Fc","-f",str(dump)],check=True,capture_output=True)
    kernel("create database kernel_restore")
    subprocess.run([kernel.binaries["pg_restore"],*kernel.connection,"-d","kernel_restore","--exit-on-error",str(dump)],check=True,capture_output=True)
    for table in ("investigations","investigation_revisions","investigation_mutation_receipts","chart_layout_revisions"):
        query="select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from "+table+" r"
        assert kernel(query)==kernel(query,database="kernel_restore")
    # Disable only writes, preserving exact authenticated historical reads.
    kernel("revoke execute on function apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb),reconcile_investigation_operation_v2(uuid,integer,text,uuid,jsonb,jsonb) from authenticated",database="kernel_restore")
    query="select read_investigation_v2("+quote(kernel.legacy_target)+",1)"
    assert kernel(query,A)==kernel(query,A,database="kernel_restore")
    assert json.loads(kernel(query,B,database="kernel_restore"))["status"]=="not_found"
    denied=kernel(reconcile_sql(str(uuid4()),str(uuid4()),draft()),A,check=False,database="kernel_restore")
    assert denied.returncode and "permission denied" in denied.stderr
