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
    def run(sql, actor=None, check=True, database="postgres"):
        if actor: sql = "set role authenticated; set request.jwt.claim.sub=" + quote(actor) + ";" + sql
        # Corpus cases deliberately exceed 128 KiB; Linux limits each argv entry.
        # stdin exercises PostgreSQL's real parser without a shell or argv ceiling.
        r = subprocess.run(["psql","-h",str(sock),"-p","55487","-U","postgres","-d",database,"-X","-qAt","-v","ON_ERROR_STOP=1"],input=sql,text=True,capture_output=True)
        if check: assert r.returncode == 0, r.stderr
        return r.stdout.strip() if check else r
    run.connection = ["-h",str(sock),"-p","55487","-U","postgres"]
    run.backup_path = base / "investigation-backup.dump"
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


@pytest.fixture(scope="module")
def sector_pg(tmp_path_factory):
    import test_pinned_research_handoff_postgres as handoff

    run, data, socket_root = handoff._spawn_postgres(
        tmp_path_factory, "sector-admission-pg", 55491
    )
    try:
        handoff._bootstrap_base_schema(run)
        # This disposable cluster exercises the complete prerequisite chain.
        # The original pg fixture remains on the historical 0028 contract.
        migrations = handoff.PREVIOUS + (
            ROOT / "supabase/migrations/0040_investigation_review.sql",
            handoff.SQL,
            ROOT / "supabase/migrations/0042_investigation_scenario_reference.sql",
            ROOT / "supabase/migrations/0047_investigation_options_selection_evidence.sql",
            ROOT / "supabase/migrations/0052_sector_intelligence_investigation_admission.sql",
        )
        for sql_file in migrations:
            assert sql_file.exists(), f"{sql_file.name} is not implemented"
            run(sql_file.read_text())
        yield run
    finally:
        subprocess.run(
            ["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
            check=True,
            capture_output=True,
        )
        socket_root.cleanup()


@pytest.fixture(scope="module")
def v3_pg(tmp_path_factory):
    import test_pinned_research_handoff_postgres as handoff

    run, data, socket_root = handoff._spawn_postgres(
        tmp_path_factory, "investigation-v3-pg", 55493
    )
    try:
        handoff._bootstrap_base_schema(run)
        # Full chain, then the source-only v3 carrier. 0053 is stacked on 0052 (PR #1410).
        migrations = handoff.PREVIOUS + (
            ROOT / "supabase/migrations/0040_investigation_review.sql",
            handoff.SQL,
            ROOT / "supabase/migrations/0042_investigation_scenario_reference.sql",
            ROOT / "supabase/migrations/0047_investigation_options_selection_evidence.sql",
            ROOT / "supabase/migrations/0052_sector_intelligence_investigation_admission.sql",
            ROOT / "supabase/migrations/0053_investigation_v3_prophet_decision_admission.sql",
        )
        for sql_file in migrations:
            assert sql_file.exists(), f"{sql_file.name} is not implemented"
            run(sql_file.read_text())
        yield run
    finally:
        subprocess.run(
            ["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
            check=True,
            capture_output=True,
        )
        socket_root.cleanup()


def _assert_paired_manifest_corpus(pg, *, g1_only):
    bundle = json.loads((ROOT / "terminal/lib/__tests__/fixtures/investigation_manifest_vectors.json").read_text())
    for vector in bundle["vectors"]:
        content = vector["manifest"]
        # SQL has fixed adapter admission; the language corpus also tests a
        # caller supplying an empty admission registry.
        expected = (
            vector["valid"] or vector["name"] == "owner not implicitly admitted"
        ) and content.get("schema") == "investigation_manifest.v2"
        if expected and g1_only:
            # 0028 predates Thesis, review/scenario, and Sector admission.
            # Later valid vectors remain executed here and must be rejected.
            refs = content["evidence_refs"]
            if "review_baseline_ref" in content:
                refs = refs + [content["review_baseline_ref"]]
            expected = (
                not content.get("thesis_refs")
                and "review" not in content
                and "scenario_capture" not in content
                and all(
                    (subject["owner"], subject["kind"]) in {
                        ("terminal.analysis_symbol", "security"),
                        ("data_os.security_master", "security"),
                        ("data_os.security_master", "issuer"),
                    }
                    for subject in content["intent"]["subjects"]
                )
                and all(
                    (ref["owner"], ref["object_type"])
                    == ("earnings.workspace_generation", "event_workspace")
                    for ref in refs
                )
            )
        body = json.dumps(content, ensure_ascii=True)
        # PostgreSQL JSONB itself refuses NUL and unpaired surrogate escapes.
        response = pg("select public.valid_investigation_manifest_v2(" + quote(body) + "::jsonb);", check=False)
        if response.returncode:
            assert not expected, (vector["name"], response.stderr)
            assert "Unicode" in response.stderr or "unicode" in response.stderr, response.stderr
        else:
            assert (response.stdout.strip() == "t") is bool(expected), vector["name"]


def test_full_paired_manifest_corpus_at_the_sql_admission_boundary(pg):
    _assert_paired_manifest_corpus(pg, g1_only=True)


def test_full_paired_manifest_corpus_after_sector_admission(sector_pg):
    _assert_paired_manifest_corpus(sector_pg, g1_only=False)


# The language corpus also exercises a caller-supplied adapter registry; SQL admission is fixed.
_REGISTRY_ONLY_VECTORS = {"owner not implicitly admitted", "prophet.research not admitted by registry refused"}


def test_full_paired_manifest_corpus_after_v3_admission(v3_pg):
    bundle = json.loads((ROOT / "terminal/lib/__tests__/fixtures/investigation_manifest_vectors.json").read_text())
    for vector in bundle["vectors"]:
        content = vector["manifest"]
        expected = (vector["valid"] or vector["name"] in _REGISTRY_ONLY_VECTORS) and content.get("schema") in (
            "investigation_manifest.v2", "investigation_manifest.v3")
        body = json.dumps(content, ensure_ascii=True)
        response = v3_pg("select public.valid_investigation_manifest_v2(" + quote(body) + "::jsonb);", check=False)
        if response.returncode:
            assert not expected, (vector["name"], response.stderr)
            assert "nicode" in response.stderr, response.stderr
        else:
            assert (response.stdout.strip() == "t") is bool(expected), vector["name"]


def test_v3_dispatch_keeps_v2_core_and_is_idempotent(v3_pg):
    core = v3_pg("select pg_catalog.md5(prosrc) from pg_proc where oid='public.valid_investigation_manifest_core_v2(jsonb)'::regprocedure;")
    assert core == "75f2b7feba6b3c9f177f4cda6c3605e9"
    v3_pg((ROOT / "supabase/migrations/0053_investigation_v3_prophet_decision_admission.sql").read_text())  # real rerun
    assert v3_pg("select pg_catalog.md5(prosrc) from pg_proc where oid='public.valid_investigation_manifest_core_v2(jsonb)'::regprocedure;") == core
    assert v3_pg("select has_function_privilege('anon','public.valid_investigation_manifest_v3(jsonb)','EXECUTE'), has_function_privilege('authenticated','public.valid_investigation_manifest_core_v2(jsonb)','EXECUTE');") == "f|f"


@pytest.mark.parametrize(
    ("owner", "object_type", "expected"),
    [
        ("prophet.research", "today_selection", "t"),
        ("prophet.research", "b03_occurrence", "t"),
        ("prophet.research", "plan_origin", "t"),
        ("prophet.research", "evaluation", "t"),
        ("prophet.research", "order_ticket", "f"),
        ("macro.sector", "sector_observation", "t"),
        ("terminal.options_exposure", "options_matrix_selection", "t"),
        ("earnings.workspace_generation", "event_workspace", "t"),
    ],
)
def test_v3_evidence_probe_executes(v3_pg, owner, object_type, expected):
    assert v3_pg(
        "select public.investigation_evidence_admitted_v2(" + quote(owner) + "," + quote(object_type) + ");",
        role="authenticated",
    ) == expected


@pytest.mark.parametrize(
    ("owner", "object_type", "expected"),
    [
        ("macro.sector", "sector_observation", "t"),
        ("macro.sector", "basket_observation", "t"),
        ("theme_graph.curation_assertion", "curation_assertion", "t"),
        ("earnings.workspace_generation", "event_workspace", "t"),
        ("terminal.options_exposure", "options_matrix_selection", "t"),
        ("macro.sector", "event_workspace", "f"),
        ("unadmitted.owner", "sector_observation", "f"),
    ],
)
def test_sector_evidence_admission_probe_executes(sector_pg, owner, object_type, expected):
    assert sector_pg(
        "select public.investigation_evidence_admitted_v2("
        + quote(owner) + "," + quote(object_type) + ");",
        role="authenticated",
    ) == expected


def test_backup_restore_preserves_owner_rows_receipts_and_read_only_rollback(pg):
    for binary in ('pg_dump', 'pg_restore'):
        assert shutil.which(binary), f'restore proof requires {binary}'
    subprocess.run(['pg_dump', *pg.connection, '-d', 'postgres', '-Fc', '-f', str(pg.backup_path)], check=True, capture_output=True)
    pg('create database investigation_restore;')
    subprocess.run(['pg_restore', *pg.connection, '-d', 'investigation_restore', '--exit-on-error', str(pg.backup_path)], check=True, capture_output=True)
    def restored(sql, actor=None, check=True):
        return pg(sql, actor, check, database='investigation_restore')
    for table in ('investigations', 'investigation_revisions', 'investigation_mutation_receipts', 'chart_layout_revisions'):
        # Whole-row multiset equality includes original request/result, clocks,
        # exact manifests and retained layout config rather than counts alone.
        query = f"select coalesce(jsonb_agg(row order by row::text),'[]'::jsonb) from (select to_jsonb(t) row from public.{table} t) q;"
        assert restored(query) == pg(query), table
    replay = apply(restored, '40000000-0000-4000-8000-000000000001')
    assert replay['status'] == 'committed' and replay['revision'] == 1
    assert json.loads(restored('select public.read_investigation_v2('+quote(ID)+'::uuid);', B))['status'] == 'not_found'
    # Documented non-destructive rollback keeps owner readback, removes writes.
    restored('revoke execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) from authenticated;')
    assert restored("select has_function_privilege('authenticated','public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb)','EXECUTE');") == "f"
    assert json.loads(restored('select public.read_investigation_v2('+quote(ID)+'::uuid,1);', A))['revision'] == 1
    restored('grant execute on function public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb) to authenticated;')
    assert apply(restored, '40000000-0000-4000-8000-000000000001') == replay


def test_review_migration_applier_qualifies_behavior_and_catalog(pg, tmp_path):
    """The real applier needs catalog identity as well as behavioral probe rows."""
    import hashlib
    import io
    import re
    from scripts.supabase_apply import readback_statements, run_apply

    migration = ROOT / "supabase/migrations/0040_investigation_review.sql"
    predecessor = ROOT / "supabase/migrations/0039_investigation_options_evidence.sql"
    database = "review_migration_receipt"
    pg("do $$ begin create role service_role; exception when duplicate_object then null; end $$;")
    pg(f"create database {database} template postgres;")

    def sql_run(sql):
        return pg(sql, database=database)

    def runner(sql):
        if sql.lstrip().lower().startswith(("select", "with")):
            query = sql.rstrip().removesuffix(";")
            return json.loads(sql_run(f"select coalesce(json_agg(r),'[]'::json) from ({query}) r;"))
        sql_run(sql)
        return []

    metadata_query = """select p.proowner, p.provolatile, p.prosecdef, p.proconfig,
        p.proacl::text as acl, pg_get_function_identity_arguments(p.oid) as arguments,
        pg_get_function_result(p.oid) as result, l.lanname as language
        from pg_proc p join pg_language l on l.oid=p.prolang
        where p.oid=to_regprocedure('public.valid_investigation_manifest_v2(jsonb)')"""

    def invoke(path, name, transport=runner):
        receipt_path = tmp_path / f"{name}.json"
        result = run_apply(path, runner=transport, receipt_path=receipt_path,
                           project_ref="isolated-local-fixture", out=io.StringIO())
        return result, json.loads(receipt_path.read_text())

    try:
        sql_run(predecessor.read_text())
        sql_run("revoke all on function public.valid_investigation_manifest_v2(jsonb) "
                "from public, anon, authenticated; "
                "grant execute on function public.valid_investigation_manifest_v2(jsonb) to service_role;")
        before = runner(metadata_query)

        result, receipt = invoke(migration, "first-apply")
        assert result == 0, receipt
        assert receipt["status"] == "applied" and receipt["missing_after"] == []
        assert receipt["statements_n"] == 1
        assert receipt["pre"][0]["rows"] == [{
            "admits_valid_review": False, "rejects_invalid_assessment": False,
            "rejects_malformed_fire_event_id": False,
        }]
        assert receipt["post"][0]["rows"] == [{
            "admits_valid_review": True, "rejects_invalid_assessment": False,
            "rejects_malformed_fire_event_id": False,
        }]
        assert runner(metadata_query) == before
        assert sql_run("select public.valid_investigation_manifest_v2("
                       + quote(json.dumps(manifest())) + "::jsonb)") == "t"

        readbacks = readback_statements(migration.read_text())
        assert len(readbacks) == 2
        catalog = receipt["post"][1]["rows"]
        assert len(catalog) == 1
        assert catalog[0]["name"] == "valid_investigation_manifest_v2"
        assert catalog[0]["object_schema"] == "public"
        assert catalog[0]["identity_arguments"] == "m jsonb"
        body = re.search(r"as \$function\$(.*?)\$function\$", migration.read_text(), re.S).group(1)
        assert catalog[0]["body_md5"] == hashlib.md5(body.encode()).hexdigest()

        replay_result, replay = invoke(migration, "replay")
        assert replay_result == 0 and replay["status"] == "applied"
        assert replay["pre"] == replay["post"]
        assert runner(metadata_query) == before

        # Removing the catalog query reproduces the original failure even though
        # the function exists and its behavioral probes succeed.
        missing_catalog = tmp_path / migration.name
        missing_catalog.write_text(
            migration.read_text().split("-- readback:", 1)[0] + "-- readback:\n"
            + "\n".join("-- " + line for line in (readbacks[0].rstrip() + ";").splitlines()) + "\n"
        )
        missing_result, missing = invoke(missing_catalog, "missing-catalog-control")
        assert missing_result == 6 and missing["status"] == "failed_readback"
        assert missing["missing_after"] == ["function valid_investigation_manifest_v2"]

        # A name alone cannot establish that the replacement happened. The
        # captured behavior and body digest must also be checked by the operator.
        sql_run(predecessor.read_text())
        def no_op_runner(sql):
            return runner(sql) if sql.lstrip().lower().startswith(("select", "with")) else []
        noop_result, noop = invoke(migration, "no-op-control", no_op_runner)
        assert noop_result == 0  # generic applier checks catalog names only
        assert noop["post"][0]["rows"][0]["admits_valid_review"] is False
        assert noop["post"][1]["rows"][0]["body_md5"] != catalog[0]["body_md5"]
    finally:
        pg(f"drop database {database};")


def test_v3_down_block_restores_exact_0052_and_refuses_with_v3_records(v3_pg):
    text = (ROOT / "supabase/migrations/0053_investigation_v3_prophet_decision_admission.sql").read_text()
    block = text[text.index("-- down:"):text.index("-- readback:")]
    down = "\n".join(line[3:] if line.startswith("-- ") else line[2:] for line in block.splitlines()[2:])
    v2_md5 = "select pg_catalog.md5(prosrc) from pg_proc where oid='public.valid_investigation_manifest_v2(jsonb)'::regprocedure;"
    v3_manifest = {**manifest(), "schema": "investigation_manifest.v3"}
    uid = "10000000-0000-4000-8000-0000000000aa"
    v3_pg("insert into auth.users values (" + quote(uid) + ") on conflict do nothing;")
    # A stored v3 revision makes the down refuse; the installed dispatcher stays.
    v3_pg("insert into investigations values ('21000000-0000-4000-8000-000000000001'," + quote(uid) + ",1,'active',now(),now());"
          "insert into investigation_revisions values ('21000000-0000-4000-8000-000000000001'," + quote(uid) + ",1,'create','active'," + quote(json.dumps(v3_manifest)) + "::jsonb,now());")
    refused = v3_pg(down, check=False)
    assert refused.returncode != 0 and "v3 records exist" in refused.stderr, refused.stderr
    dispatcher = v3_pg(v2_md5)
    assert dispatcher != "75f2b7feba6b3c9f177f4cda6c3605e9"
    v3_pg("delete from investigation_revisions where investigation_id='21000000-0000-4000-8000-000000000001'; delete from investigations where id='21000000-0000-4000-8000-000000000001';")
    v3_pg(down)
    assert v3_pg(v2_md5) == "75f2b7feba6b3c9f177f4cda6c3605e9"
    assert v3_pg("select to_regprocedure('public.valid_investigation_manifest_v3(jsonb)') is null, to_regprocedure('public.valid_investigation_manifest_core_v2(jsonb)') is null;") == "t|t"
    assert v3_pg("select public.investigation_evidence_admitted_v2('prophet.research','today_selection');", role="authenticated") == "f"
    # Re-apply the carrier: the guard accepts the restored 0052 body and the dispatcher returns.
    v3_pg(text)
    assert v3_pg(v2_md5) == dispatcher


# --- SP15: account switch during save, late completion, lost response (real PostgreSQL 17) -------------
# The authenticated actor is auth.uid(); the receipt key is (user_id, operation_id). These tests execute the
# properties the client journey relies on: another account never reads or mutates the first account's
# operation or record, a not_found read is inconclusive (never proof of failure), a late commit still lands
# once, and recovery after a lost response is a READ of the original operation - the replay is never needed.

SP15_ID = "22000000-0000-4000-8000-000000000015"
SP15_KEY = "42000000-0000-4000-8000-000000000015"


def _sp15_counts(pg, actor):
    return (
        pg("select count(*) from investigations where id='" + SP15_ID + "'", actor),
        pg("select count(*) from investigation_revisions where investigation_id='" + SP15_ID + "'", actor),
        pg("select count(*) from investigation_mutation_receipts where operation_id='" + SP15_KEY + "'", actor),
    )


def test_sp15_lost_response_recovers_by_reading_the_original_operation_without_replay(pg):
    # Before the commit lands the original operation is not found: inconclusive, NOT proof of failure.
    assert json.loads(pg("select read_investigation_operation_v2('" + SP15_KEY + "')", A)) == {"status": "not_found"}
    # The save commits, but its HTTP response is lost (nothing here reads the apply return value).
    pg("select public.apply_investigation_revision_v2('" + SP15_ID + "'::uuid,0,'create','" + SP15_KEY + "'::uuid,"
       + quote(json.dumps(manifest("lost response"))) + "::jsonb,null);", A)
    # Recovery is a read of the exact operation, not a second write.
    recovered = json.loads(pg("select read_investigation_operation_v2('" + SP15_KEY + "')", A))
    assert recovered["status"] == "committed" and recovered["id"] == SP15_ID and recovered["revision"] == 1
    assert recovered["manifest"]["intent"]["question"] == "lost response"
    assert _sp15_counts(pg, A) == ("1", "1", "1")  # one record, one revision, one receipt: nothing replayed


def test_sp15_account_switch_cannot_read_or_mutate_the_first_accounts_operation(pg):
    before = _sp15_counts(pg, A)
    # The session switched to account B while A's save was in flight / just committed.
    assert json.loads(pg("select read_investigation_operation_v2('" + SP15_KEY + "')", B)) == {"status": "not_found"}
    assert json.loads(pg("select read_investigation_v2('" + SP15_ID + "',1)", B))["status"] == "not_found"
    listing = json.loads(pg("select list_investigations_v2()", B))
    assert SP15_ID not in [item["id"] for item in listing["items"]]
    # B cannot mutate A's record by id, with or without A's expected revision or operation key.
    for key, expected in ((SP15_KEY, 1), ("42000000-0000-4000-8000-0000000000b1", 1), ("42000000-0000-4000-8000-0000000000b2", 0)):
        result = apply(pg, key, "revise" if expected else "create", expected, manifest("hijack"), target=SP15_ID, actor=B)
        assert result["status"] in ("not_found", "version_conflict", "idempotency_conflict", "invalid_transition"), result
        assert "hijack" not in json.dumps(result)
    assert _sp15_counts(pg, A) == before
    assert json.loads(pg("select read_investigation_v2('" + SP15_ID + "',1)", A))["manifest"]["intent"]["question"] == "lost response"


def test_sp15_late_completion_lands_once_for_its_own_account_and_never_for_the_new_one(pg):
    late_id, late_key = "22000000-0000-4000-8000-000000000016", "42000000-0000-4000-8000-000000000016"
    # B is the active account; A's slow request completes late. It commits for A, only once.
    assert json.loads(pg("select read_investigation_operation_v2('" + late_key + "')", B)) == {"status": "not_found"}
    first = apply(pg, late_key, "create", 0, manifest("late A"), target=late_id, actor=A)
    assert first["status"] == "committed" and first["revision"] == 1
    # The late completion is invisible to B: B's own state is unchanged and B cannot see A's operation.
    assert json.loads(pg("select read_investigation_operation_v2('" + late_key + "')", B)) == {"status": "not_found"}
    assert late_id not in [item["id"] for item in json.loads(pg("select list_investigations_v2()", B))["items"]]
    # A re-delivered copy of the same late request returns the original outcome without a second revision.
    assert apply(pg, late_key, "create", 0, manifest("late A"), target=late_id, actor=A) == first
    assert pg("select count(*) from investigation_revisions where investigation_id='" + late_id + "'", A) == "1"
    # The same key under the other account is its own namespace and cannot collide with or reveal A's receipt.
    # (A fresh account: B's per-principal record limit is filled by an earlier capacity test in this module.)
    switched = "10000000-0000-4000-8000-0000000000d1"
    pg("insert into auth.users values (" + quote(switched) + ") on conflict do nothing;")
    other = apply(pg, late_key, "create", 0, manifest("switched own"), target="22000000-0000-4000-8000-0000000000bb", actor=switched)
    assert other["status"] == "committed" and other["id"] == "22000000-0000-4000-8000-0000000000bb"
    assert json.loads(pg("select read_investigation_operation_v2('" + late_key + "')", A))["manifest"]["intent"]["question"] == "late A"


@pytest.fixture(scope="module")
def pre0052_pg(tmp_path_factory):
    import test_pinned_research_handoff_postgres as handoff

    run, data, socket_root = handoff._spawn_postgres(tmp_path_factory, "investigation-pre0052-pg", 55497)
    try:
        handoff._bootstrap_base_schema(run)
        for sql_file in handoff.PREVIOUS + (
            ROOT / "supabase/migrations/0040_investigation_review.sql",
            handoff.SQL,
            ROOT / "supabase/migrations/0042_investigation_scenario_reference.sql",
            ROOT / "supabase/migrations/0047_investigation_options_selection_evidence.sql",
        ):
            run(sql_file.read_text())
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"], check=True, capture_output=True)
        socket_root.cleanup()


def test_0053_refuses_a_wrong_preimage_and_changes_nothing(pre0052_pg):
    """Reviewer N1: no other test applies 0053 to a chain without 0052. The FIRST guard must be what refuses."""
    md5 = "select pg_catalog.md5(prosrc) from pg_proc where oid='public.valid_investigation_manifest_v2(jsonb)'::regprocedure;"
    before = pre0052_pg(md5)
    assert before == "a554c15c1ae58dfbd34d04bcda9b5e48"  # the 0047 body
    refused = pre0052_pg((ROOT / "supabase/migrations/0053_investigation_v3_prophet_decision_admission.sql").read_text(), check=False)
    assert refused.returncode != 0
    assert "requires the exact 0052 valid_investigation_manifest_v2 body" in refused.stderr, refused.stderr
    assert "observed md5 a554c15c1ae58dfbd34d04bcda9b5e48" in refused.stderr
    assert pre0052_pg(md5) == before
    assert pre0052_pg("select to_regprocedure('public.valid_investigation_manifest_v3(jsonb)') is null, to_regprocedure('public.valid_investigation_manifest_core_v2(jsonb)') is null;") == "t|t"
