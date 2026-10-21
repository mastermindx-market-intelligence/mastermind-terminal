"""Real PostgreSQL proof for the inactive Forex owner; no network or production account."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import io
import json
import shutil
import subprocess
import tempfile
import uuid

import pytest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "supabase/migrations/0038_forex_inactive_conditions.sql"
A = "10000000-0000-4000-8000-000000000001"
B = "10000000-0000-4000-8000-000000000002"
ID = "30000000-0000-4000-8000-000000000001"
OTHER = "30000000-0000-4000-8000-000000000002"
RULE = dict(kind="price_close", pair="USDJPY", quote_basis="literal", interval="4H",
            calendar="fx-utc-4h/v1", operator="lt", threshold=149.5, consecutive=2,
            expires_at="2100-01-02T03:04:05.000Z", feed=None, origin_snapshot_id="fixture-only")


def quote(value):
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def j(value):
    return quote(json.dumps(value, separators=(",", ":"), allow_nan=False)) + "::jsonb"


def claims(owner):
    return "set request.jwt.claims=" + quote(json.dumps({"sub": owner} if owner else {})) + ";"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    for binary in ("initdb", "pg_ctl", "psql"):
        if not shutil.which(binary):
            pytest.skip(f"PostgreSQL binary missing: {binary}")
    base = tmp_path_factory.mktemp("forex-owner-pg")
    data = base / "data"
    socket_dir = tempfile.TemporaryDirectory(prefix="fxr26-", dir="/tmp")
    sock = Path(socket_dir.name)
    subprocess.run(["initdb", "-D", str(data), "-U", "postgres", "-A", "trust",
                    "--no-locale", "--encoding=UTF8", "--no-sync"], check=True, capture_output=True)
    subprocess.run(["pg_ctl", "-D", str(data), "-l", str(base / "server.log"),
                    "-o", f"-k {sock} -h '' -p 55488", "-w", "start"], check=True, capture_output=True)

    def run(sql, role=None, check=True):
        if role:
            assert role in ("anon", "authenticated", "service_role")
            sql = f"set role {role};" + sql
        result = subprocess.run(["psql", "-h", str(sock), "-p", "55488", "-U", "postgres",
                                 "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                                input=sql, text=True, capture_output=True)
        if check:
            assert result.returncode == 0, result.stderr
            return result.stdout.strip()
        return result

    try:
        run("create role anon; create role authenticated; create role service_role bypassrls;"
            "create schema auth; create table auth.users(id uuid primary key);"
            "create function auth.uid() returns uuid language sql stable as $$"
            "select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;"
            "grant usage on schema public,auth to anon,authenticated,service_role;")
        # The existing alerts DDL and owner policy, taken from 0001 rather than a substitute schema.
        initial = (ROOT / "supabase/migrations/0001_init.sql").read_text()
        run(initial.split("-- ---------- alerts ----------", 1)[1].split("-- ---------- favorites", 1)[0])
        run("alter table public.alerts enable row level security;"
            "create policy alerts_owner on public.alerts for all "
            "using(user_id=auth.uid()) with check(user_id=auth.uid());"
            "grant select,insert,update,delete on public.alerts to authenticated,service_role;"
            "grant select on public.alerts to anon;"
            "alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;")
        run(f"insert into auth.users values ({quote(A)}),({quote(B)});"
            f"insert into alerts(id,user_id,symbol,condition) values ({quote(OTHER)},{quote(B)},'SPY','{{\"type\":\"price\"}}');")
        catalog = ("select row(c.relrowsecurity,c.relforcerowsecurity,c.relacl,"
                   "(select jsonb_agg(to_jsonb(p) order by p.policyname) from pg_policies p "
                   "where p.schemaname='public' and p.tablename='alerts'))::text "
                   "from pg_class c where c.oid='public.alerts'::regclass")
        before = run(catalog)
        before_row = run(f"select row_to_json(a) from public.alerts a where id={quote(OTHER)}")
        from scripts.supabase_apply import split_statements, idempotency_findings, run_apply
        statements = split_statements(SQL.read_text())
        assert len(statements) == 1, "All new functions, ACL and trigger must install atomically"
        assert not idempotency_findings(SQL.read_text(), statements)

        def query_runner(statement):
            if statement.lstrip().lower().startswith("select"):
                return json.loads(run("select coalesce(json_agg(q),'[]'::json)::text from (" + statement.rstrip(";") + ") q"))
            run(statement)
            return []

        output = io.StringIO()
        assert run_apply(SQL, runner=query_runner, receipt_path=base / "apply.json",
                         project_ref="disposable-local", out=output) == 0, output.getvalue()
        for statement in statements:
            run(statement)
        assert run(catalog) == before, "Existing table grants, RLS and policies changed"
        assert run(f"select row_to_json(a) from public.alerts a where id={quote(OTHER)}") == before_row
        run.psql_args = ["psql", "-h", str(sock), "-p", "55488", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"], check=True, capture_output=True)
        socket_dir.cleanup()


@pytest.fixture
def pg(server):
    server("truncate public.alerts;")
    return server


def save(pg, rule=None, revision=0, owner=A, expected=A, row_id=ID, check=True):
    result = pg(claims(owner) + "select row_to_json(public.save_forex_watch("
                + ",".join((quote(row_id), str(revision) if revision is not None else "null",
                            quote(expected), j(RULE if rule is None else rule))) + "));",
                role="authenticated", check=check)
    return json.loads(result) if check else result


def remove(pg, revision=1, owner=A, expected=A, row_id=ID, check=True):
    result = pg(claims(owner) + "select public.delete_forex_watch("
                + ",".join((quote(row_id), str(revision) if revision is not None else "null", quote(expected))) + ");",
                role="authenticated", check=check)
    return json.loads(result) if check else result


def condition(row_id=ID, revision=1, **changes):
    return dict(RULE, type="forex_price_close", schema_version=1, condition_id=row_id,
                revision=revision, **changes)


def direct_insert(pg, cond=None, active=False, owner=A, row_id=ID, check=True):
    return pg(claims(owner) + "insert into public.alerts(id,user_id,symbol,condition,active) values("
              + ",".join((quote(row_id), quote(owner), quote((cond or RULE)["pair"]),
                          j(condition() if cond is None else cond), str(active).lower())) + ");",
              role="authenticated", check=check)


def denied(result, token):
    assert result.returncode != 0
    assert token in result.stderr, result.stderr


def test_create_read_edit_delete_and_same_id_create_idempotency(pg):
    first = save(pg)
    assert first["id"] == ID and first["user_id"] == A and first["symbol"] == "USDJPY"
    assert first["active"] is False and first["condition"] == condition()
    assert save(pg) == first
    assert pg(claims(A) + "select count(*) from alerts", role="authenticated") == "1"
    edited = save(pg, dict(RULE, threshold=148.25), revision=1)
    assert edited["condition"]["revision"] == 2 and edited["condition"]["threshold"] == 148.25
    assert edited["created_at"] == first["created_at"]
    denied(save(pg, revision=1, check=False), "forex_watch_revision_conflict")
    denied(save(pg, check=False), "forex_watch_identity_conflict")
    denied(remove(pg, revision=1, check=False), "forex_watch_revision_conflict")
    assert remove(pg, revision=2) == {"id": ID, "deleted": True}
    assert remove(pg, revision=2) == {"id": ID, "deleted": False}


def test_owner_rls_and_expected_account_fence(pg):
    save(pg, owner=B, expected=B)
    assert pg(claims(A) + "select count(*) from alerts", role="authenticated") == "0"
    assert pg("select count(*) from alerts", role="anon") == "0"
    denied(save(pg, check=False), "forex_watch_identity_conflict")
    denied(save(pg, revision=1, check=False), "forex_watch_not_found")
    assert remove(pg) == {"id": ID, "deleted": False}
    for call in (lambda: save(pg, owner=B, expected=A, check=False),
                 lambda: save(pg, owner=B, expected=A, revision=1, check=False),
                 lambda: remove(pg, owner=B, expected=A, check=False),
                 lambda: save(pg, expected=None, row_id=OTHER, check=False)):
        denied(call(), "forex_watch_owner_changed")
    denied(save(pg, owner=None, check=False), "forex_watch_unauthenticated")
    denied(remove(pg, owner=None, check=False), "forex_watch_unauthenticated")
    assert pg(claims(B) + "select count(*) from alerts", role="authenticated") == "1"


@pytest.mark.parametrize("field,value", [
    ("kind", "residual_shock"), ("pair", "JPYUSD"), ("pair", None), ("quote_basis", "strength"),
    ("interval", "1D"), ("calendar", None), ("operator", None), ("operator", "above"),
    ("threshold", 0), ("threshold", -1), ("threshold", "149"), ("threshold", True), ("threshold", None),
    ("consecutive", 0), ("consecutive", 11), ("consecutive", 1.5), ("consecutive", "2"),
    ("consecutive", None), ("expires_at", "2001-01-01T00:00:00Z"),
    ("expires_at", "2100-02-30T00:00:00Z"), ("expires_at", "2100-01-01T24:00:00Z"),
    ("expires_at", "2100-01-01T00:00:00+00:00"), ("expires_at", "2100-01-01"),
    ("expires_at", "2100-01-01T00:00:00.1234Z"), ("expires_at", None),
    ("feed", {"source": "unadmitted"}), ("feed", "daily"),
    ("origin_snapshot_id", " "), ("origin_snapshot_id", "x" * 257), ("origin_snapshot_id", {}),
    ("user_id", B), ("active", True), ("revision", 900), ("delivery", "email"),
])
def test_invalid_rules_cannot_reach_storage(pg, field, value):
    denied(save(pg, dict(RULE, **{field: value}), check=False), "forex_watch_invalid_condition")
    assert pg("select count(*) from alerts") == "0"


@pytest.mark.parametrize("field", list(RULE.keys() - {"origin_snapshot_id"}))
def test_required_keys_cannot_be_omitted(pg, field):
    rule = dict(RULE)
    del rule[field]
    denied(save(pg, rule, check=False), "forex_watch_invalid_condition")


@pytest.mark.parametrize("rule", [[], "USDJPY", {}, 12, False])
def test_wrong_json_shape_is_rejected(pg, rule):
    denied(save(pg, rule, check=False), "forex_watch_invalid_condition")


def test_extreme_numeric_domain_rejected(pg):
    for raw in ("1e309", "1e-400"):
        payload = json.dumps(RULE).replace("149.5", raw)
        denied(pg(claims(A) + f"select save_forex_watch({quote(ID)},0,{quote(A)},{quote(payload)}::jsonb)",
                  role="authenticated", check=False), "forex_watch_invalid_condition")


def test_rule_normalization_is_utc_and_optional_origin_is_inert(pg):
    rule = dict(RULE, expires_at="2100-01-02T03:04:05.1Z")
    del rule["origin_snapshot_id"]
    result = pg(claims(A) + "set timezone='Pacific/Auckland';select row_to_json(save_forex_watch("
                + ",".join((quote(ID), "0", quote(A), j(rule))) + "));", role="authenticated")
    stored = json.loads(result)
    assert stored["condition"]["expires_at"] == "2100-01-02T03:04:05.100Z"
    assert "origin_snapshot_id" not in stored["condition"]


def test_direct_activation_and_family_escape_are_rejected(pg):
    denied(direct_insert(pg, active=True, check=False), "forex_activation_unavailable")
    save(pg)
    for patch, token in [
        ("active=true", "forex_activation_unavailable"),
        ("condition=condition-'type',active=true", "forex_activation_unavailable"),
        ("condition=condition-'type'", "forex_watch_identity_conflict"),
        ("condition=jsonb_set(condition,'{type}','\"price\"')", "forex_watch_identity_conflict"),
        (f"id={quote(OTHER)}", "forex_watch_identity_conflict"),
        (f"user_id={quote(B)}", "forex_watch_identity_conflict"),
        ("created_at=created_at+interval '1 second'", "forex_watch_identity_conflict"),
        ("symbol='EURUSD'", "forex_watch_invalid_condition"),
        ("condition=jsonb_set(condition,'{threshold}','148')", "forex_watch_revision_conflict"),
        ("condition=jsonb_set(condition,'{revision}','3')", "forex_watch_revision_conflict"),
        ("condition=condition||'{\"active\":false}'", "forex_watch_invalid_condition"),
    ]:
        denied(pg(claims(A) + f"update alerts set {patch} where id={quote(ID)}",
                  role="authenticated", check=False), token)
    assert pg(f"select active::text from alerts where id={quote(ID)}") == "false"


def test_direct_canonical_edit_retains_invariants_and_legacy_conversion_is_refused(pg):
    save(pg)
    new = condition(revision=2, threshold=148)
    pg(claims(A) + f"update alerts set condition={j(new)} where id={quote(ID)}", role="authenticated")
    assert json.loads(pg(f"select condition from alerts where id={quote(ID)}"))["revision"] == 2
    pg(claims(A) + f"insert into alerts(id,user_id,symbol,condition) values({quote(OTHER)},{quote(A)},'USDJPY','{{\"type\":\"price\"}}')",
       role="authenticated")
    denied(pg(claims(A) + f"update alerts set condition={j(condition(row_id=OTHER))},active=false where id={quote(OTHER)}",
              role="authenticated", check=False), "forex_watch_identity_conflict")


def test_expired_row_can_be_read_paused_and_deleted_without_reactivation(pg):
    # Fixture setup simulates the passage of time without requiring a wall-clock sleep.
    save(pg)
    pg("alter table alerts disable trigger alerts_forex_inactive_guard;"
       f"update alerts set condition=jsonb_set(condition,'{{expires_at}}','\"2001-01-01T00:00:00.000Z\"') where id={quote(ID)};"
       "alter table alerts enable trigger alerts_forex_inactive_guard;")
    expired = dict(RULE, expires_at="2001-01-01T00:00:00.000Z")
    assert save(pg, expired)["condition"]["revision"] == 1
    pg(claims(A) + f"update alerts set active=false where id={quote(ID)}", role="authenticated")
    denied(save(pg, expired, revision=1, check=False), "forex_watch_invalid_condition")
    assert remove(pg)["deleted"] is True


def test_simultaneous_same_id_creates_have_one_authoritative_row(pg):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: save(pg), range(4)))
    assert all(row == results[0] for row in results)
    assert pg("select count(*) from alerts") == "1"
    denied(save(pg, dict(RULE, threshold=144), check=False), "forex_watch_identity_conflict")


def test_simultaneous_same_revision_edits_cannot_lose_an_update(pg):
    save(pg)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda value: save(pg, dict(RULE, threshold=value), revision=1, check=False), [147, 146]))
    assert sum(r.returncode == 0 for r in results) == 1
    denied(next(r for r in results if r.returncode), "forex_watch_revision_conflict")
    row = json.loads(pg(f"select condition from alerts where id={quote(ID)}"))
    assert row["revision"] == 2 and row["threshold"] in (146, 147)


def test_concurrent_edit_and_delete_have_a_consistent_outcome(pg):
    save(pg)
    with ThreadPoolExecutor(max_workers=2) as pool:
        edit = pool.submit(save, pg, dict(RULE, threshold=147), 1, A, A, ID, False)
        delete = pool.submit(remove, pg, 1, A, A, ID, False)
        edited, deleted = edit.result(), delete.result()
    assert sum(r.returncode == 0 for r in (edited, deleted)) == 1
    if edited.returncode == 0:
        denied(deleted, "forex_watch_revision_conflict")
        assert pg("select count(*) from alerts") == "1"
    else:
        denied(edited, "forex_watch_not_found")
        assert pg("select count(*) from alerts") == "0"


def test_cap_serializes_rpc_and_direct_legacy_inserts(pg):
    pg(claims(A) + f"insert into alerts(user_id,symbol,condition) select {quote(A)}::uuid,'SPY','{{\"type\":\"price\"}}'::jsonb from generate_series(1,49)",
       role="authenticated")
    with ThreadPoolExecutor(max_workers=2) as pool:
        forex = pool.submit(save, pg, None, 0, A, A, ID, False)
        legacy = pool.submit(pg, claims(A) + f"insert into alerts(user_id,symbol,condition) values({quote(A)},'QQQ','{{\"type\":\"price\"}}')",
                             "authenticated", False)
        results = [forex.result(), legacy.result()]
    assert sum(r.returncode == 0 for r in results) == 1
    denied(next(r for r in results if r.returncode), "forex_watch_limit_reached")
    assert pg("select count(*) from alerts") == "50"


def test_cap_is_per_owner_and_existing_inactive_rows_count(pg):
    for n in range(50):
        save(pg, row_id=str(uuid.uuid4()))
    denied(save(pg, check=False), "forex_watch_limit_reached")
    assert save(pg, owner=B, expected=B)["user_id"] == B


def test_privileges_search_paths_and_trigger_survive_hostile_defaults(pg):
    functions = json.loads(pg("select json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,"
        "'settings',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),"
        "'service',has_function_privilege('service_role',p.oid,'execute'),"
        "'authenticated',has_function_privilege('authenticated',p.oid,'execute'))) "
        "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' "
        "and p.proname in ('canonical_forex_watch_rule','validate_forex_watch_row','guard_forex_watch_write','save_forex_watch','delete_forex_watch')"))
    assert len(functions) == 5
    for function in functions:
        assert not function["definer"] and not function["anon"] and not function["service"]
        assert function["settings"] == ["search_path=pg_catalog"]
        assert function["authenticated"] == (function["name"] != "guard_forex_watch_write")
    for role in ("anon", "service_role"):
        result = pg(claims(A) + f"select save_forex_watch({quote(ID)},0,{quote(A)},{j(RULE)})", role=role, check=False)
        denied(result, "permission denied")
    assert pg("select tgenabled from pg_trigger where tgname='alerts_forex_inactive_guard'") == "O"


def test_direct_owner_delete_limit_is_explicit_and_no_durable_replay_is_claimed(pg):
    # Existing direct DML rights remain: RPC CAS is not an exclusive table-write gate.
    save(pg)
    pg(claims(A) + f"delete from alerts where id={quote(ID)}", role="authenticated")
    assert remove(pg)["deleted"] is False
    # A hard-deleted identity has no retained journal. Product clients never replay this old create.
    assert save(pg)["condition"]["revision"] == 1

def test_rerun_with_existing_forex_data_is_a_noop(pg):
    before = save(pg)
    pg(SQL.read_text())
    assert save(pg) == before
    assert pg("select count(*) from alerts") == "1"


def test_failed_prerequisite_rolls_back_without_catalog_or_data_effect(pg):
    before = save(pg)
    result = pg("begin;alter table public.alerts disable row level security;" + SQL.read_text() + "commit;", check=False)
    denied(result, "forex_watch_prerequisite_alerts_rls")
    assert pg("select relrowsecurity::text from pg_class where oid='public.alerts'::regclass") == "true"
    assert save(pg) == before
    result = pg("begin;revoke update on public.alerts from authenticated;" + SQL.read_text() + "commit;", check=False)
    denied(result, "forex_watch_prerequisite_authenticated_privilege")
    assert pg("select has_table_privilege('authenticated','public.alerts','UPDATE')::text") == "true"
    assert save(pg) == before


def test_missing_identity_and_invalid_expected_revisions_cannot_mutate(pg):
    for row_id, revision in ((None, 0), (ID, None), (ID, -1)):
        denied(save(pg, row_id=row_id, revision=revision, check=False), "forex_watch_invalid_request")
    for row_id, revision in ((None, 1), (ID, None), (ID, 0), (ID, -1)):
        denied(remove(pg, row_id=row_id, revision=revision, check=False), "forex_watch_invalid_request")
    assert pg("select count(*) from alerts") == "0"

def test_retained_snapshot_cannot_insert_above_the_shared_cap(pg):
    import selectors
    pg(claims(A) + f"insert into alerts(user_id,symbol) select {quote(A)}::uuid,'SPY' from generate_series(1,49)",
       role="authenticated")
    process = subprocess.Popen(pg.psql_args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        process.stdin.write("begin isolation level repeatable read;set role authenticated;" + claims(A)
                            + "select count(*) from public.alerts;\n")
        process.stdin.flush()
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=10), "Retained-snapshot session did not answer"
        assert process.stdout.readline().strip() == "49"
        pg(claims(A) + f"insert into alerts(user_id,symbol) values({quote(A)},'SPY')", role="authenticated")
        out, err = process.communicate(f"insert into alerts(user_id,symbol) values({quote(A)},'QQQ');commit;", timeout=10)
        assert process.returncode != 0, (out, err, pg("select count(*) from alerts"))
        assert "forex_watch_invalid_request" in err
        assert pg("select count(*) from alerts") == "50"
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)


@pytest.mark.parametrize("isolation", ["repeatable read", "serializable"])
def test_insert_rejects_retained_snapshot_modes_before_any_write(pg, isolation):
    result = pg(f"begin isolation level {isolation};" + claims(A)
                + f"select save_forex_watch({quote(ID)},0,{quote(A)},{j(RULE)});commit;",
                role="authenticated", check=False)
    denied(result, "forex_watch_invalid_request")
    assert pg("select count(*) from alerts") == "0"
