"""Execute the proposal state RPC on disposable PostgreSQL, never a live database."""
import json
import io
import os
from pathlib import Path
import shutil
import subprocess

import pytest

from scripts.supabase_apply import run_apply

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
REPAIR = MIGRATIONS / "0032_thesis_proposal_state_qualification.sql"
A = "10000000-0000-4000-8000-000000000001"
B = "10000000-0000-4000-8000-000000000002"
T = "20000000-0000-4000-8000-000000000001"
OTHER_T = "20000000-0000-4000-8000-000000000002"
V = "30000000-0000-4000-8000-000000000001"
OLDER_V = "30000000-0000-4000-8000-000000000002"
OTHER_V = "30000000-0000-4000-8000-000000000003"


def q(value):
    return "'" + value.replace("'", "''") + "'"


def proposal(n):
    return f"40000000-0000-4000-8000-{n:012d}"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    for binary in ("initdb", "pg_ctl", "psql"):
        if not shutil.which(binary):
            pytest.skip(f"PostgreSQL binary missing: {binary}")
    base = tmp_path_factory.mktemp("proposal-pg")
    data, sock = base / "data", base / "s"
    sock.mkdir()
    subprocess.run(["initdb", "-D", str(data), "-U", "postgres", "-A", "trust",
                    "--no-locale", "--encoding=UTF8", "--no-sync"],
                   check=True, capture_output=True)
    # Socket-only and unique directory: cannot connect to a host or production DB.
    subprocess.run(["pg_ctl", "-D", str(data), "-l", str(base / "server.log"),
                    "-o", f"-k {sock} -h '' -p 55488", "-w", "start"],
                   check=True, capture_output=True)

    def run(sql, actor=None, check=True):
        if actor is not None:
            sql = f"set role authenticated; set request.jwt.claim.sub={q(actor)};" + sql
        result = subprocess.run(["psql", "-h", str(sock), "-p", "55488", "-U", "postgres",
                                 "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                                 "-v", "VERBOSITY=verbose"],
                                input=sql, text=True, capture_output=True)
        if check:
            assert result.returncode == 0, result.stderr
            return result.stdout.strip()
        return result

    try:
        run("create role anon; create role authenticated; create schema auth; "
            "create schema extensions; create extension pgcrypto with schema extensions; "
            "create table auth.users(id uuid primary key); "
            "create function auth.uid() returns uuid language sql stable as $$"
            "select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; "
            "grant usage on schema auth to authenticated;")
        run((MIGRATIONS / "0012_thesis_objects.sql").read_text())
        run((MIGRATIONS / "0025_thesis_amendment_proposals.sql").read_text())
        catalog = "select row(proowner,prosecdef,proconfig,proacl,pg_get_function_result(oid))::text from pg_proc where oid='public.set_thesis_amendment_state(uuid,text)'::regprocedure;"
        baseline_catalog = run(catalog)
        if os.environ.get("THESIS_PROPOSAL_SKIP_REPAIR") != "1":
            run(REPAIR.read_text())
            assert run(catalog) == baseline_catalog
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
                       check=True, capture_output=True)


@pytest.fixture
def pg(server):
    server("truncate public.theses, public.thesis_versions, public.thesis_amendment_proposals; "
           f"insert into auth.users values ({q(A)}),({q(B)}) on conflict do nothing;")
    for tid, owner in ((T, A), (OTHER_T, B)):
        server("insert into theses(id,user_id,current_version,lifecycle_state,subject_ref,subject_digest) "
               f"values({q(tid)},{q(owner)},1,'active','{{}}',decode('01','hex'));")
    for vid, tid, owner, version in ((V, T, A, 1), (OLDER_V, T, A, 2), (OTHER_V, OTHER_T, B, 1)):
        prev = "null" if version == 1 else "1"
        transition = "create" if version == 1 else "revise"
        server("insert into thesis_versions(id,thesis_id,user_id,version,previous_version,transition,"
               "lifecycle_state,subject_ref,content,client_request_id,request_fingerprint) "
               f"values({q(vid)},{q(tid)},{q(owner)},{version},{prev},{q(transition)},'active',"
               f"'{{}}','{{\"statement\":\"unchanged\"}}',{q(vid)},decode('01','hex'));")
    for n, tid, vid, state in ((1, T, V, "proposed"), (2, T, V, "proposed"),
                               (3, T, OLDER_V, "proposed"), (4, OTHER_T, OTHER_V, "proposed"),
                               (5, T, V, "rejected")):
        server("insert into thesis_amendment_proposals(proposal_id,thesis_id,amended_from,body,"
               f"proposed_by,state) values({q(proposal(n))},{q(tid)},{q(vid)},'test proposal',"
               f"'assistant',{q(state)});")
    return server


def transition(pg, state, n=1, actor=A):
    value = "null" if state is None else q(state)
    return json.loads(pg("select row_to_json(r) from public.set_thesis_amendment_state("
                         f"{q(proposal(n))},{value}) r;", actor))


def snapshots(pg):
    return pg("select jsonb_build_object('heads',(select jsonb_agg(t order by id) from theses t),"
              "'versions',(select jsonb_agg(v order by id) from thesis_versions v),"
              "'proposals',(select jsonb_agg(to_jsonb(p)-'state' order by proposal_id) "
              "from thesis_amendment_proposals p));")


def states(pg):
    return json.loads(pg("select json_object_agg(proposal_id,state) from thesis_amendment_proposals;"))


@pytest.mark.parametrize("new_state", ["accepted", "rejected"])
def test_owner_transition_and_scoped_sibling_effect(pg, new_state):
    before = snapshots(pg)
    result = transition(pg, new_state)
    assert result == {"status": "ok", "proposal_id": proposal(1), "state": new_state}
    assert states(pg) == {proposal(1): new_state,
                          proposal(2): "superseded" if new_state == "accepted" else "proposed",
                          proposal(3): "proposed", proposal(4): "proposed", proposal(5): "rejected"}
    assert snapshots(pg) == before  # no statement/version or proposal payload mutation
    assert transition(pg, new_state)["status"] == "invalid_transition"


@pytest.mark.parametrize("actor", [B, ""])
def test_wrong_or_missing_user_cannot_change_any_state(pg, actor):
    before = states(pg)
    assert transition(pg, "accepted", actor=actor) == {
        "status": "not_found", "proposal_id": None, "state": None}
    assert states(pg) == before


@pytest.mark.parametrize("value", [None, "proposed", "superseded", "invalid"])
def test_invalid_state_leaves_all_rows_unchanged(pg, value):
    before = states(pg)
    assert transition(pg, value)["status"] == "invalid_transition"
    assert states(pg) == before


def test_absent_proposal_and_terminal_state_are_not_mutations(pg):
    before = states(pg)
    assert transition(pg, "accepted", n=99)["status"] == "not_found"
    assert transition(pg, "accepted", n=5) == {
        "status": "invalid_transition", "proposal_id": proposal(5), "state": "rejected"}
    assert states(pg) == before


def test_direct_write_and_anonymous_rpc_still_denied(pg):
    before = states(pg)
    for sql in ("update thesis_amendment_proposals set state='accepted';",
                "delete from thesis_amendment_proposals;"):
        result = pg(sql, A, check=False)
        assert result.returncode != 0 and "permission denied" in result.stderr
    result = pg("set role anon; select * from set_thesis_amendment_state("
                f"{q(proposal(1))},'accepted');", check=False)
    assert result.returncode != 0 and "permission denied" in result.stderr
    assert states(pg) == before


def test_forward_reapply_preserves_owner_grants_configuration_and_trigger(pg, tmp_path):
    catalog = """select jsonb_build_object('owner',pg_get_userbyid(p.proowner),
      'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,
      'result',pg_get_function_result(p.oid)) from pg_proc p
      where p.oid='public.set_thesis_amendment_state(uuid,text)'::regprocedure;"""
    before = pg(catalog)
    pg(REPAIR.read_text())

    def local_runner(sql):
        # Exercise the existing applier/readback protocol using only this test DB.
        if sql.lstrip().lower().startswith("select"):
            return json.loads(pg("select coalesce(json_agg(row_to_json(r)), '[]'::json) from (" + sql.rstrip().rstrip(";") + ") r;"))
        pg(sql)
        return []

    output = io.StringIO()
    receipt = tmp_path / "local-apply-receipt.json"
    assert run_apply(REPAIR, runner=local_runner, receipt_path=receipt,
                     project_ref="isolated-local-test", out=output) == 0, output.getvalue()
    assert json.loads(receipt.read_text())["status"] == "applied"
    assert pg(catalog) == before
    assert json.loads(before)["owner"] == "postgres"
    assert json.loads(before)["definer"] is True
    assert json.loads(before)["config"] == ["search_path=pg_catalog, public, auth"]
    denied = pg("update thesis_amendment_proposals set body='changed' "
                f"where proposal_id={q(proposal(1))};", check=False)
    assert denied.returncode != 0 and "fields are immutable" in denied.stderr
