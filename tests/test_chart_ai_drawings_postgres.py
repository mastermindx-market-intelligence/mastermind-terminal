"""Direct RPC coverage for0050 using the existing socket-only disposable PG pattern.

No remote URL, credentials or installed service is used. Missing PostgreSQL
binaries are reported as skipped by the same convention as the other PG suites.
"""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import pytest

ROOT = Path(__file__).resolve().parents[1]
A = "10000000-0000-4000-8000-000000000001"
B = "10000000-0000-4000-8000-000000000002"
OP = "20000000-0000-4000-8000-000000000001"
OP2 = "20000000-0000-4000-8000-000000000002"
SCHEMA = "chart.ai_drawing.v1"


def quote(value):
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def encoded(value):
    return quote(json.dumps(value, ensure_ascii=True, allow_nan=False)) + "::jsonb"


def human(index=0):
    return {"id": "human_" + str(index), "schemaVersion": 1, "source": "user",
            "kind": "hline", "points": [{"t": "2026-01-01", "p": 100}]}


def ai(index=0):
    return {"id": "ai_child_" + str(index), "schemaVersion": 1, "source": "ai",
            "by": "ai", "auto": True, "kind": "hline",
            "points": [{"t": "1700000000", "p": 101}],
            "meta": {"by": "ai", "chart_ai": {"schema": SCHEMA,
                "command_id": "ai_parent", "op": "draw.hline", "batch_id": "saved",
                "seq": 0, "caption": "Level", "layer_hidden": False}}}


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    for binary in ("initdb", "pg_ctl", "psql"):
        if not shutil.which(binary):
            pytest.skip(f"PostgreSQL binary missing: {binary}")
    base = tmp_path_factory.mktemp("chart-ai-pg")
    data = base / "data"
    socket_dir = tempfile.TemporaryDirectory(prefix="drawing-pg-", dir="/tmp")
    sock = Path(socket_dir.name)
    started = False
    try:
        subprocess.run(["initdb", "-D", str(data), "-U", "postgres", "-A", "trust",
                        "--no-locale", "--encoding=UTF8", "--no-sync"],
                       check=True, capture_output=True)
        subprocess.run(["pg_ctl", "-D", str(data), "-l", str(base / "server.log"),
                        "-o", f"-k {sock} -h '' -p 55491", "-w", "start"],
                       check=True, capture_output=True)
        started = True

        def run(sql, owner=None, role=None, check=True):
            if role:
                assert role in ("anon", "authenticated")
                sql = "set role " + role + ";" + sql
            if owner:
                sql = "set request.jwt.claims=" + quote(json.dumps({"sub": owner})) + ";" + sql
            result = subprocess.run(
                ["psql", "-h", str(sock), "-p", "55491", "-U", "postgres",
                 "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                input=sql, text=True, capture_output=True)
            if check:
                assert result.returncode == 0, result.stderr
                return result.stdout.strip()
            return result

        run("create role anon; create role authenticated; create schema auth;"
            "create table auth.users(id uuid primary key);"
            "create function auth.uid() returns uuid language sql stable as $$"
            "select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;"
            "grant usage on schema public,auth to anon,authenticated;")
        run((ROOT / "supabase/migrations/0002_drawings.sql").read_text())
        run("grant select,insert,update,delete on public.drawings to authenticated;")
        run((ROOT / "supabase/migrations/0031_drawings_atomic_replace.sql").read_text())
        before = run("select pg_get_functiondef('public.replace_drawings_collection(text,jsonb,text,uuid)'::regprocedure)")
        table_acl = run("select relacl::text from pg_class where oid='public.drawings'::regclass")
        migration = (ROOT / "supabase/migrations/0050_chart_ai_drawing_workspace.sql").read_text()
        run(migration)
        run(migration)
        assert run("select pg_get_functiondef('public.replace_drawings_collection(text,jsonb,text,uuid)'::regprocedure)") == before
        assert run("select relacl::text from pg_class where oid='public.drawings'::regclass") == table_acl
        assert run("select relrowsecurity from pg_class where oid='public.drawings'::regclass") == "t"
        assert run("select bool_and(not prosecdef and has_function_privilege('authenticated',oid,'EXECUTE') "
                   "and not has_function_privilege('anon',oid,'EXECUTE')) from pg_proc where oid in "
                   "('public.replace_drawings_collection(text,jsonb,text,uuid)'::regprocedure,"
                   "'public.read_drawings_collection(text)'::regprocedure,"
                   "'public.validate_drawing_replace_input(text,jsonb,uuid)'::regprocedure)") == "t"
        run(f"insert into auth.users values ({quote(A)}),({quote(B)});")
        yield run
    finally:
        if started:
            subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
                           check=True, capture_output=True)
        socket_dir.cleanup()


@pytest.fixture
def pg(server):
    server("truncate public.drawings;")
    return server


def read(pg, owner=A):
    return json.loads(pg("select public.read_drawings_collection('NVDA')",
                         owner=owner, role="authenticated"))


def replace(pg, drawings, revision=None, operation=OP, owner=A, check=True):
    sql = ("select public.replace_drawings_collection('NVDA'," + encoded(drawings)
           + "," + quote(revision) + "," + quote(operation) + "::uuid)")
    result = pg(sql, owner=owner, role="authenticated", check=check)
    return json.loads(result) if check else result


def validate(pg, drawings, check=True):
    return pg("select public.validate_drawing_replace_input('NVDA'," + encoded(drawings)
              + "," + quote(OP) + "::uuid)", owner=A, role="authenticated", check=check)


def test_empty_and_mixed_reads_advertise_the_installed_capability(pg):
    empty = read(pg)
    assert empty["drawings"] == [] and empty["revision"] is None
    assert empty["schemaVersion"] == 1 and empty["aiDrawingSchema"] == SCHEMA
    drawings = [human(), ai()]
    saved = replace(pg, drawings)
    snapshot = read(pg)
    assert snapshot["drawings"] == drawings
    assert snapshot["revision"] == saved["revision"]
    assert snapshot["aiDrawingSchema"] == SCHEMA
    assert read(pg, B)["drawings"] == []
    denied = pg("select public.read_drawings_collection('NVDA')", role="anon", check=False)
    assert denied.returncode != 0


def test_mixed_cas_replay_and_payload_hash_remain_with_the_incumbent_rpc(pg):
    first = [human(), ai()]
    receipt = replace(pg, first)
    retry = replace(pg, first)
    assert retry["idempotentReplay"] is True and retry["superseded"] is False
    assert retry["revision"] == receipt["revision"]
    changed = copy.deepcopy(first)
    changed[1]["hidden"] = True
    mismatch = replace(pg, changed)
    assert mismatch["code"] == "operation_payload_mismatch"
    stale = replace(pg, changed, operation=OP2)
    assert stale["code"] == "revision_conflict"
    second = replace(pg, changed, receipt["revision"], OP2)
    old = replace(pg, first)
    assert old["idempotentReplay"] is True and old["superseded"] is True
    assert read(pg)["drawings"] == changed and read(pg)["revision"] == second["revision"]


@pytest.mark.parametrize("time_value", [631152000, 1700000000.0, 4102444800, "1700000000"])
def test_integer_numeric_and_canonical_string_epochs_are_accepted(pg, time_value):
    drawing = ai()
    drawing["points"][0]["t"] = time_value
    validate(pg, [drawing])


@pytest.mark.parametrize("time_value", ["1700000000.0", "1.7e9", "+1700000000",
                                      " 1700000000", "1700000000.5",
                                      1700000000.5, 631151999, 4102444801])
def test_bad_epochs_cannot_replace_an_existing_collection(pg, time_value):
    before = replace(pg, [human()])
    drawing = ai()
    drawing["points"][0]["t"] = time_value
    assert replace(pg, [drawing], before["revision"], OP2, check=False).returncode != 0
    assert read(pg)["drawings"] == [human()]


@pytest.mark.parametrize("change", [
    {"schema": "unknown"}, {"op": "draw.zone"}, {"command_id": "human"},
    {"batch_id": "x" * 41}, {"seq": -1}, {"seq": 0.5}, {"seq": 9007199254740992},
    {"caption": "x" * 141}, {"caption": "bad\ncaption"}, {"target": "not provenance"},
    {"layer_hidden": "false"}, {"caption": "x" * 139 + "😀"},
    {"caption": "\ud800"},
])
def test_direct_rpc_rejects_invalid_provenance(pg, change):
    drawing = ai()
    drawing["meta"]["chart_ai"].update(change)
    assert validate(pg, [drawing], check=False).returncode != 0
    assert read(pg)["drawings"] == []


def test_limits_unicode_boundaries_and_independent_children(pg):
    first, second = ai(), ai(1)
    first["meta"]["chart_ai"]["caption"] = "x" * 138 + "😀"
    validate(pg, [first, second])  # Shared command/sequence; no complete-sibling rule.
    validate(pg, [human(i) for i in range(440)] + [ai(i) for i in range(60)])
    assert validate(pg, [ai(i) for i in range(61)], check=False).returncode != 0
    assert validate(pg, [human(i) for i in range(501)], check=False).returncode != 0
    second["meta"]["chart_ai"]["layer_hidden"] = True
    assert validate(pg, [first, second], check=False).returncode != 0
    for change in ({"by": "user"}, {"auto": False}, {"source": "user"},
                   {"points": [{"t": "1700000000", "p": 0}]}, {"text": "\ud800"},
                   {"text": "\u0000"}):
        malformed = ai()
        malformed.update(change)
        assert validate(pg, [malformed], check=False).returncode != 0


def test_legacy_ai_cannot_be_promoted_to_a_human_snapshot(pg):
    data = ai()
    pg("insert into public.drawings(user_id,symbol,kind,data) values("
       + quote(A) + ",'NVDA','hline'," + encoded(data) + ")")
    denied = pg("select public.read_drawings_collection('NVDA')",
                owner=A, role="authenticated", check=False)
    assert denied.returncode != 0
    assert pg("select data from public.drawings where user_id=" + quote(A))
    assert read(pg, B)["drawings"] == []
