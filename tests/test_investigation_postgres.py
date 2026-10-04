"""Run the actual migration and authenticated SQL boundary against isolated PostgreSQL.
No production users, credentials, or services are used. Requires PostgreSQL binaries.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
import pytest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "supabase/migrations/0028_investigations.sql"
A = "10000000-0000-4000-8000-000000000001"
B = "10000000-0000-4000-8000-000000000002"
ID = "20000000-0000-4000-8000-000000000001"
LAYOUT = "30000000-0000-4000-8000-000000000001"

def quote(v):
    return "'" + v.replace("'", "''") + "'"

def manifest(question="  Why 🧠?\r\n"):
    return {"schema":"investigation_manifest.v2","intent":{"title":"Retained","question":question,"subjects":[]},"layout_refs":[],"thesis_refs":[],"evidence_refs":[],"continuation":{}}

@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    for binary in ("initdb", "pg_ctl", "psql"):
        if not shutil.which(binary): pytest.skip(f"PostgreSQL binary missing: {binary}")
    base = tmp_path_factory.mktemp("investigation-pg")
    data, sock = base / "data", base / "socket"
    sock.mkdir()
    subprocess.run(["initdb","-D",str(data),"-U","postgres","-A","trust","--no-locale","--encoding=UTF8","--no-sync"],check=True,capture_output=True)
    subprocess.run(["pg_ctl","-D",str(data),"-l",str(base/"server.log"),"-o",f"-k {sock} -h '' -p 55487","-w","start"],check=True,capture_output=True)
    def run(sql, actor=None, check=True):
        if actor: sql = "set role authenticated; set request.jwt.claim.sub=" + quote(actor) + ";" + sql
        r = subprocess.run(["psql","-h",str(sock),"-p","55487","-U","postgres","-d","postgres","-X","-qAt","-v","ON_ERROR_STOP=1","-c",sql],text=True,capture_output=True)
        if check: assert r.returncode == 0, r.stderr
        return r.stdout.strip() if check else r
    try:
        run("create role anon; create role authenticated; create schema auth; create schema extensions; create extension pgcrypto with schema extensions; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; create table public.chart_layouts(id uuid primary key,user_id uuid references auth.users(id),name text,config jsonb,updated_at timestamptz default now()); insert into auth.users values ('"+A+"'),('"+B+"');")
        assert SQL.exists(), "Investigation migration is not implemented"
        run(SQL.read_text())
        run(SQL.read_text())  # real rerun, no ledger assumptions
        yield run
    finally:
        subprocess.run(["pg_ctl","-D",str(data),"-m","fast","-w","stop"],check=True,capture_output=True)

def apply(pg, key, action="create", expected=0, content=None, target=ID, actor=A, capture=None):
    body = json.dumps(content if content is not None else manifest(),ensure_ascii=False)
    return json.loads(pg("select public.apply_investigation_revision_v2(" + ",".join([quote(target)+"::uuid",str(expected),quote(action),quote(key)+"::uuid",quote(body)+"::jsonb",("null" if capture is None else quote(json.dumps(capture))+"::jsonb")]) + ");",actor))

def test_receipt_replay_precedes_cas_and_preserves_original_revision(pg):
    first = apply(pg,"40000000-0000-4000-8000-000000000001")
    assert first["status"] == "committed" and first["revision"] == 1
    assert first["manifest"]["intent"]["question"] == "  Why 🧠?\r\n"
    second = apply(pg,"40000000-0000-4000-8000-000000000002","revise",1,manifest("Next"))
    assert second["revision"] == 2
    assert apply(pg,"40000000-0000-4000-8000-000000000001") == first
    assert apply(pg,"40000000-0000-4000-8000-000000000001",content=manifest("Changed"))["status"] == "idempotency_conflict"
    assert apply(pg,"40000000-0000-4000-8000-000000000001",action="revise",expected=1)["status"] == "idempotency_conflict"
    assert apply(pg,"40000000-0000-4000-8000-000000000001",target=B)["status"] == "idempotency_conflict"
    assert apply(pg,"40000000-0000-4000-8000-000000000003","revise",1)["status"] == "version_conflict"

def test_two_concurrent_writers_have_one_winner(pg):
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda n: apply(pg,f"40000000-0000-4000-8000-{n:012d}","revise",2,manifest(str(n))),[4,5]))
    assert sorted(r["status"] for r in results) == ["committed","version_conflict"]
    assert pg("select count(*) from investigation_revisions where investigation_id='"+ID+"'",A) == "3"

def test_foreign_reads_and_direct_writes_are_denied(pg):
    for table in ("investigations","investigation_revisions","investigation_mutation_receipts","chart_layout_revisions"):
        assert pg(f"select count(*) from public.{table}",B) == "0"
        denied = pg(f"delete from public.{table}",A,check=False)
        assert denied.returncode != 0 and "permission denied" in denied.stderr
    assert json.loads(pg("select read_investigation_v2('"+ID+"',null)",B))["status"] == "not_found"
    assert json.loads(pg("select read_investigation_operation_v2('40000000-0000-4000-8000-000000000001')",B))["status"] == "not_found"
    assert apply(pg,"40000000-0000-4000-8000-000000000006","revise",3,actor=B)["status"] == "not_found"

def test_retained_layout_does_not_follow_or_mutate_current(pg):
    config = {"schema":"workspace_layout.v1","revision":1,"name":"My layout","requires":{"floor":1},"widgets":[],"link_groups":{}}
    pg("insert into chart_layouts values ('"+LAYOUT+"','"+A+"','My layout',"+quote(json.dumps(config))+",now())")
    capture={"layout_id":LAYOUT,"expected_revision":1,"revision_id":"50000000-0000-4000-8000-000000000001"}
    saved=apply(pg,"40000000-0000-4000-8000-000000000007","revise",3,capture=capture)
    assert saved["status"]=="committed"
    assert saved["manifest"]["layout_refs"][0]["layout_revision_id"]==capture["revision_id"]
    pg("update chart_layouts set config=jsonb_set(config,'{revision}','2') where id='"+LAYOUT+"'")
    restored=json.loads(pg("select read_investigation_v2('"+ID+"',4)",A))
    assert restored["layouts"][0]["config"]==config
    assert pg("select config->>'revision' from chart_layouts where id='"+LAYOUT+"'")=="2"
    assert apply(pg,"40000000-0000-4000-8000-000000000007","revise",3,capture=capture)==saved
    stale=apply(pg,"40000000-0000-4000-8000-000000000008","revise",4,capture={**capture,"revision_id":"50000000-0000-4000-8000-000000000002"})
    assert stale["status"]=="layout_conflict"
    assert pg("select count(*) from investigation_revisions",A)=="4"
    assert pg("select count(*) from investigation_mutation_receipts",A)=="4"

def test_invalid_manifest_and_unowned_reference_cannot_commit(pg):
    for bad in ({**manifest(),"facts":{"price":5}},manifest("x"*4001),{**manifest(),"intent":{"title":"X","question":"Q","subjects":[{"kind":"security","owner":"invented","object_id":"AAPL"}]}}):
        assert apply(pg,"40000000-0000-4000-8000-000000000009","revise",4,bad)["status"]=="invalid_payload"
    forged={**manifest(),"layout_refs":[{"layout_id":LAYOUT,"layout_revision_id":"50000000-0000-4000-8000-000000000099","digest":"a"*64,"role":"primary"}]}
    assert apply(pg,"40000000-0000-4000-8000-000000000009","revise",4,forged)["status"]=="reference_unavailable"
    assert pg("select count(*) from investigation_revisions",A)=="4"
