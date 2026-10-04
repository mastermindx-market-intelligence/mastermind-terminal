"""Run the actual migration and authenticated SQL boundary against isolated PostgreSQL.
No production users, credentials, or services are used. Requires PostgreSQL binaries.
"""
import json
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
    config = json.loads((ROOT / "terminal/lib/__tests__/fixtures/workspace/chart_layout_v2_real_capture.json").read_text())["expected"]
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
    for bad in ({**manifest(),"facts":{"price":5}},manifest("x"*4001),manifest("\ufeff"),manifest("\u00a0"),{**manifest(),"intent":{"title":"X","question":"Q","subjects":[{"kind":"security","owner":"invented","object_id":"AAPL"}]}}):
        assert apply(pg,"40000000-0000-4000-8000-000000000009","revise",4,bad)["status"]=="invalid_payload"
    forged={**manifest(),"layout_refs":[{"layout_id":LAYOUT,"layout_revision_id":"50000000-0000-4000-8000-000000000099","digest":"a"*64,"role":"primary"}]}
    assert apply(pg,"40000000-0000-4000-8000-000000000009","revise",4,forged)["status"]=="reference_unavailable"
    assert pg("select count(*) from investigation_revisions",A)=="4"


def test_receipt_failure_rolls_back_capture_head_and_revision(pg):
    pg("create function fail_iw_receipt() returns trigger language plpgsql as $$begin raise exception 'receipt_write_injected_failure'; end$$; create trigger fail_iw_receipt before insert on investigation_mutation_receipts for each row execute function fail_iw_receipt();")
    capture={"layout_id":LAYOUT,"expected_revision":2,"revision_id":"50000000-0000-4000-8000-000000000044"}
    try:
        with pytest.raises(AssertionError,match="receipt_write_injected_failure"):
            apply(pg,"40000000-0000-4000-8000-000000000044","revise",4,capture=capture)
        assert pg("select current_revision from investigations where id='"+ID+"'",A)=="4"
        assert pg("select count(*) from investigation_revisions",A)=="4"
        assert pg("select count(*) from investigation_mutation_receipts",A)=="4"
        assert pg("select count(*) from chart_layout_revisions",A)=="1"
    finally:
        pg("drop trigger fail_iw_receipt on investigation_mutation_receipts; drop function fail_iw_receipt();")


def test_database_preserves_authored_scalar_and_whitespace_rules(pg):
    for text in ("v", "  Why?\r\n", "🧠"*4000, "e\u0301"):
        assert pg("select public.valid_investigation_manifest_v2("+quote(json.dumps(manifest(text),ensure_ascii=False))+"::jsonb)")=="t"
    for text in ("\ufeff", "\u00a0", "🧠"*4001, "\t\r\n"):
        assert pg("select public.valid_investigation_manifest_v2("+quote(json.dumps(manifest(text),ensure_ascii=False))+"::jsonb)")=="f"


def test_inventory_is_owner_scoped_and_read_only(pg):
    before=pg("select count(*) from investigation_mutation_receipts",A)
    own=json.loads(pg("select list_investigations_v2()",A))
    assert own["status"]=="listed" and own["items"][0]["id"]==ID
    assert own["items"][0]["revision"]==4
    assert own["items"][0]["title"]=="Retained"
    assert json.loads(pg("select list_investigations_v2()",B))=={"status":"listed","items":[]}
    assert pg("select count(*) from investigation_mutation_receipts",A)==before


def test_manifest_evidence_duplicate_identity_and_null_optional_rejected(pg):
    evidence={"owner":"earnings.workspace_generation","object_type":"event_workspace","object_id":"event","mode":"pinned","version_ref":"generation"}
    for refs in ([evidence,evidence],[evidence,{**evidence,"fingerprint":"a"*64}],[{**evidence,"selection":{"field":None}}],[{**evidence,"version_ref":None}]):
        body={**manifest(),"evidence_refs":refs}
        assert pg("select valid_investigation_manifest_v2("+quote(json.dumps(body))+"::jsonb)")=="f"
    # A baseline may deliberately refer to the same object as an evidence row.
    body={**manifest(),"evidence_refs":[evidence],"review_baseline_ref":evidence}
    assert pg("select valid_investigation_manifest_v2("+quote(json.dumps(body))+"::jsonb)")=="t"


def test_concurrent_record_capacity_is_atomic_and_replay_still_works(pg):
    from uuid import uuid4
    stamp="2026-10-04T00:00:00Z"
    values=','.join('('+','.join([quote(str(uuid4())),quote(B),'1',quote('active'),quote(stamp),quote(stamp)])+')' for _ in range(499))
    pg('insert into investigations values '+values)
    pg("insert into investigation_revisions select id,user_id,1,'create','active',"+quote(json.dumps(manifest()))+"::jsonb,created_at from investigations where user_id="+quote(B))
    ids=[str(uuid4()),str(uuid4())];keys=[str(uuid4()),str(uuid4())]
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda n:apply(pg,keys[n],actor=B,target=ids[n]),[0,1]))
    assert sorted(r['status'] for r in results)==['committed','limit_reached']
    winner=next(n for n,r in enumerate(results) if r['status']=='committed')
    assert apply(pg,keys[winner],actor=B,target=ids[winner])==results[winner]
    assert pg('select count(*) from investigations',B)=='500'
    assert pg('select count(*) from investigation_mutation_receipts',B)=='1'


def test_lifecycle_actions_preserve_content_and_have_their_own_receipts(pg):
    from uuid import uuid4
    current=json.loads(pg("select read_investigation_v2('"+ID+"',4)",A))["manifest"]
    assert apply(pg,str(uuid4()),"remove",4,manifest("Hidden edit"))["status"]=="invalid_transition"
    key=str(uuid4());removed=apply(pg,key,"remove",4,current)
    assert removed["status"]=="committed" and removed["lifecycle"]=="removed" and removed["revision"]==5
    restored=apply(pg,str(uuid4()),"restore",5,current)
    assert restored["status"]=="committed" and restored["lifecycle"]=="active" and restored["revision"]==6
    assert apply(pg,key,"remove",4,current)==removed
    assert json.loads(pg("select read_investigation_v2('"+ID+"',5)",A))["lifecycle"]=="removed"


def test_full_paired_manifest_corpus_at_the_sql_admission_boundary(pg):
    bundle = json.loads((ROOT / "terminal/lib/__tests__/fixtures/investigation_manifest_vectors.json").read_text())
    for vector in bundle["vectors"]:
        content = vector["manifest"]
        expected = vector["valid"] and content.get("schema") == "investigation_manifest.v2" and not content.get("thesis_refs")
        # This private SQL boundary has the fixed G1 adapter admission, while
        # the language contract also tests the caller's empty admission.
        if vector["name"] == "owner not implicitly admitted":
            expected = True
        body = json.dumps(content, ensure_ascii=True)
        # PostgreSQL JSONB itself refuses NUL and unpaired surrogate escapes.
        response = pg("select public.valid_investigation_manifest_v2(" + quote(body) + "::jsonb);", check=False)
        if response.returncode:
            assert not expected, (vector["name"], response.stderr)
            assert "Unicode" in response.stderr or "unicode" in response.stderr, response.stderr
        else:
            assert (response.stdout.strip() == "t") is bool(expected), vector["name"]
