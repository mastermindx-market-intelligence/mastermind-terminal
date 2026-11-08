"""Real delivery/team/RLS integration on a disposable socket-only PostgreSQL.

The fixture loads the existing tenancy and delivery migrations. It never reads
host credentials, connects to a network database, or applies production DDL.
"""
import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
OWNER = "10000000-0000-4000-8000-000000000001"
ADMIN = "10000000-0000-4000-8000-000000000002"
MEMBER = "10000000-0000-4000-8000-000000000003"
OUTSIDER = "10000000-0000-4000-8000-000000000004"
TEAM = "20000000-0000-4000-8000-000000000001"
OTHER_TEAM = "20000000-0000-4000-8000-000000000002"


def q(value):
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def delivery(n):
    return f"40000000-0000-4000-8000-{n:012d}"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    for binary in ("initdb", "pg_ctl", "psql"):
        if not shutil.which(binary):
            pytest.skip(f"PostgreSQL binary missing: {binary}")
    base = tmp_path_factory.mktemp("brief-share-pg")
    data = base / "data"
    socket = tempfile.TemporaryDirectory(prefix="brief-share-", dir="/tmp")
    subprocess.run(["initdb", "-D", str(data), "-U", "postgres", "-A", "trust",
                    "--no-locale", "--encoding=UTF8", "--no-sync"],
                   check=True, capture_output=True)
    subprocess.run(["pg_ctl", "-D", str(data), "-l", str(base / "postgres.log"),
                    "-o", f"-k {socket.name} -h '' -p 55486", "-w", "start"],
                   check=True, capture_output=True)
    command = ["psql", "-h", socket.name, "-p", "55486", "-U", "postgres",
               "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
               "-v", "VERBOSITY=verbose"]

    def run(sql, actor=None, check=True):
        if actor is not None:
            sql = f"set role authenticated; set request.jwt.claim.sub={q(actor)};" + sql
        result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=20)
        if not check:
            return result
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    run.command = command
    try:
        run("create role anon; create role authenticated; create role service_role bypassrls;"
            "create schema auth; create table auth.users(id uuid primary key);"
            "create function auth.uid() returns uuid language sql stable as $$"
            "select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"
            "grant usage on schema public,auth to anon,authenticated,service_role;"
            "create table public.profiles(id uuid primary key references auth.users(id),display_name text);"
            "create table public.theses(id uuid primary key);"
            "create table public.watchlists(id uuid primary key);")
        for name in ("0014_tenancy_foundation.sql", "0019_team_role_changes.sql",
                     "0020_team_ownership_transfer.sql", "0024_brief_subscriptions.sql",
                     "0048_brief_delivery_team_sharing.sql"):
            run((MIGRATIONS / name).read_text())
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
                       check=True, capture_output=True)
        socket.cleanup()


@pytest.fixture
def pg(server):
    server("truncate public.teams,auth.users,public.watchlists,public.theses cascade;")
    server("insert into auth.users values " + ",".join(f"({q(x)})" for x in (OWNER, ADMIN, MEMBER, OUTSIDER)) + ";")
    server(f"insert into public.teams(id,name,created_by) values ({q(TEAM)},'Research',{q(OWNER)}),"
           f"({q(OTHER_TEAM)},'Other',{q(OWNER)});"
           f"insert into public.team_members(team_id,user_id,role) values ({q(TEAM)},{q(ADMIN)},'admin'),"
           f"({q(TEAM)},{q(MEMBER)},'member');")
    for n, actor in ((1, OWNER), (2, ADMIN), (3, MEMBER)):
        target = f"30000000-0000-4000-8000-{n:012d}"
        subscription = f"50000000-0000-4000-8000-{n:012d}"
        body = {"target": {"kind": "watchlist", "id": target,
                           "name": "Private target", "version_or_asof": "2026-11-04"},
                "market_read": [{"section": "Market", "sentence_en": "An authored sentence.",
                                 "sentence_zh": "原有句子。", "asof": "2026-11-04"}],
                "monitors": [], "artifact": {"name": "Weekly research brief", "asof": "2026-11-04"}}
        server(f"insert into public.watchlists values ({q(target)});"
               "insert into public.brief_subscriptions(subscription_id,user_id,target_kind,target_id,target_watchlist_id,cadence)"
               f"values({q(subscription)},{q(actor)},'watchlist',{q(target)},{q(target)},'weekly_saturday');"
               "insert into public.brief_deliveries(delivery_id,subscription_id,slot_asof,state,artifact_asof,body)"
               f"values({q(delivery(n))},{q(subscription)},'2026-11-04','ready','2026-11-04T00:00:00Z',{q(json.dumps(body))}::jsonb);")
    return server


def read(pg, n=1, actor=OWNER, team=TEAM):
    return json.loads(pg(f"select public.read_brief_delivery_sharing({q(delivery(n))},{q(team)});", actor))


def share(pg, n=1, actor=OWNER, team=TEAM):
    snapshot = read(pg, n, actor, team)
    result = json.loads(pg("select public.share_brief_delivery("
                           f"{q(delivery(n))},{q(team)},{q(snapshot['delivery']['content_sha256'])},{q(snapshot['expected_effect_sha256'])});", actor))
    return snapshot, result


def test_owner_and_admin_share_exact_source_and_stable_receipt(pg):
    for n, actor in ((1, OWNER), (2, ADMIN)):
        original, first = share(pg, n, actor)
        assert first["grant"]["effect_sha256"] == original["expected_effect_sha256"]
        assert first["grant"]["content_sha256"] == original["delivery"]["content_sha256"]
        assert first["audience"]["membership_policy"] == "DYNAMIC_TEAM_MEMBERSHIP"
        _, repeated = share(pg, n, actor)
        assert repeated["grant"] == first["grant"]


def test_member_and_foreign_source_cannot_share(pg):
    snapshot = read(pg, 3, MEMBER)
    assert snapshot["eligibility"]["can_share"] is False
    denied = pg("select public.share_brief_delivery("
                f"{q(delivery(3))},{q(TEAM)},{q(snapshot['delivery']['content_sha256'])},{q(snapshot['expected_effect_sha256'])});", MEMBER, False)
    assert denied.returncode != 0 and "42501" in denied.stderr
    for actor in (ADMIN, MEMBER, OUTSIDER):
        denied = pg(f"select public.read_brief_delivery_sharing({q(delivery(1))},{q(TEAM)});", actor, False)
        assert denied.returncode != 0 and "42501" in denied.stderr


def test_recipient_has_fixed_redacted_read_and_no_private_table_visibility(pg):
    share(pg)
    shared = json.loads(pg(f"select public.read_shared_brief_delivery({q(delivery(1))});", MEMBER))
    assert set(shared["delivery"]["body"]) == {"market_read", "monitors", "artifact"}
    assert "subscription" not in json.dumps(shared)
    assert "30000000" not in json.dumps(shared)
    # A team grant must not expose the whole canonical row or private subscription.
    assert pg(f"select count(*) from public.brief_deliveries where delivery_id={q(delivery(1))};", MEMBER) == "0"
    assert pg("select count(*) from public.brief_subscriptions;", MEMBER) == "1"
    update = pg(f"update public.brief_deliveries set shared_team_id={q(OTHER_TEAM)} where delivery_id={q(delivery(1))};", OWNER, False)
    assert update.returncode != 0 and "42501" in update.stderr


def test_body_drift_and_membership_revocation_close_shared_read(pg):
    _, committed = share(pg)
    pg(f"delete from public.team_members where team_id={q(TEAM)} and user_id={q(MEMBER)};")
    denied = pg(f"select public.read_shared_brief_delivery({q(delivery(1))});", MEMBER, False)
    assert denied.returncode != 0 and "42501" in denied.stderr
    pg(f"update public.brief_deliveries set body=jsonb_set(body,'{{artifact,name}}','\"Changed\"') where delivery_id={q(delivery(1))};")
    denied = pg(f"select public.read_shared_brief_delivery({q(delivery(1))});", ADMIN, False)
    assert denied.returncode != 0 and "42501" in denied.stderr
    receipt = json.loads(pg("select public.reconcile_brief_delivery_sharing("
                            f"{q(delivery(1))},{q(committed['grant']['effect_sha256'])});", OWNER))
    assert receipt["observation"] == "MATCHED"
    assert receipt["current_access"] is False


def test_changed_team_conflicts_and_reconcile_never_writes(pg):
    _, committed = share(pg)
    current = read(pg, team=OTHER_TEAM)
    conflict = pg("select public.share_brief_delivery("
                  f"{q(delivery(1))},{q(OTHER_TEAM)},{q(current['delivery']['content_sha256'])},{q(current['expected_effect_sha256'])});", OWNER, False)
    assert conflict.returncode != 0 and "40001" in conflict.stderr
    receipt = json.loads(pg("select public.reconcile_brief_delivery_sharing("
                            f"{q(delivery(1))},{q(committed['grant']['effect_sha256'])});", OWNER))
    assert receipt["observation"] == "MATCHED" and receipt["current_access"] is True
    mismatch = json.loads(pg("select public.reconcile_brief_delivery_sharing("
                             f"{q(delivery(1))},{q('0' * 64)});", OWNER))
    assert mismatch["observation"] == "CONFLICT" and mismatch["grant"] is None
    assert read(pg)["grant"] == committed["grant"]


def test_content_digest_is_stable_across_session_timezone(pg):
    statement = f"select public.brief_delivery_content_sha256(d) from public.brief_deliveries d where delivery_id={q(delivery(1))};"
    assert pg("set timezone='UTC';" + statement) == pg("set timezone='Asia/Shanghai';" + statement)


def test_concurrent_different_teams_commit_one_original_grant(pg):
    previews = {team: read(pg, team=team) for team in (TEAM, OTHER_TEAM)}
    digest = previews[TEAM]["delivery"]["content_sha256"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        calls = [pool.submit(pg, "select public.share_brief_delivery("
                             f"{q(delivery(1))},{q(team)},{q(digest)},{q(previews[team]['expected_effect_sha256'])});", OWNER, False)
                 for team in (TEAM, OTHER_TEAM)]
        results = [call.result(timeout=15) for call in calls]
    assert sorted(result.returncode == 0 for result in results) == [False, True]
    assert "40001" in next(result.stderr for result in results if result.returncode)
    winner = json.loads(next(result.stdout for result in results if result.returncode == 0))
    assert read(pg)["grant"] == winner["grant"]


def test_admin_demotion_before_commit_is_a_real_authorization_boundary(pg):
    original = read(pg, 2, ADMIN)
    pg(f"update public.team_members set role='member' where team_id={q(TEAM)} and user_id={q(ADMIN)};")
    refused = pg("select public.share_brief_delivery("
                 f"{q(delivery(2))},{q(TEAM)},{q(original['delivery']['content_sha256'])},{q(original['expected_effect_sha256'])});", ADMIN, False)
    assert refused.returncode != 0 and "42501" in refused.stderr
    assert read(pg, 2, ADMIN)["grant"] is None


def test_share_lock_serializes_with_existing_membership_update(pg):
    preview = read(pg, 2, ADMIN)
    digest = preview["delivery"]["content_sha256"]
    expected = preview["expected_effect_sha256"]
    first = subprocess.Popen(pg.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
    second = None
    try:
        first.stdin.write("begin;set role authenticated;"
                          f"set request.jwt.claim.sub={q(ADMIN)};"
                          "select public.share_brief_delivery("
                          f"{q(delivery(2))},{q(TEAM)},{q(digest)},{q(expected)});"
                          "select 'sharing-lock-held';\n")
        first.stdin.flush()
        deadline = time.monotonic() + 10
        observed = b""
        while time.monotonic() < deadline:
            available, _, _ = select.select([first.stdout], [], [], 0.25)
            if available:
                observed += os.read(first.stdout.fileno(), 65536)
                if b"sharing-lock-held\n" in observed:
                    break
            assert first.poll() is None, first.stderr.read()
        else:
            pytest.fail("sharing transaction did not reach its lock marker")
        second = subprocess.Popen(pg.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        second.stdin.write("update public.team_members set role='member' "
                           f"where team_id={q(TEAM)} and user_id={q(ADMIN)};\n")
        second.stdin.close()
        time.sleep(0.15)
        assert second.poll() is None, "membership mutation escaped the sharing row lock"
        first.stdin.write("commit;\n\\q\n")
        first.stdin.flush()
        first.wait(timeout=10)
        assert first.returncode == 0, first.stderr.read()
        second.wait(timeout=10)
        assert second.returncode == 0, second.stderr.read()
        # The grant linearized before demotion; later writes are denied.
        assert read(pg, 2, ADMIN)["grant"] is not None
        refused = pg("select public.share_brief_delivery("
                     f"{q(delivery(2))},{q(TEAM)},{q(digest)},{q(expected)});", ADMIN, False)
        assert refused.returncode != 0 and "42501" in refused.stderr
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=5)


def test_anonymous_callers_and_direct_table_writers_stay_denied(pg):
    for name, signature in (("read_brief_delivery_sharing", "uuid,uuid"),
                            ("share_brief_delivery", "uuid,uuid,text,text"),
                            ("reconcile_brief_delivery_sharing", "uuid,text"),
                            ("read_shared_brief_delivery", "uuid")):
        assert pg(f"select has_function_privilege('anon','public.{name}({signature})','execute');") == "f"
    assert pg("select has_table_privilege('authenticated','public.brief_deliveries','update');") == "f"


@pytest.mark.parametrize("field", ["content", "effect"])
def test_changed_frozen_source_or_operation_address_cannot_start_a_grant(pg, field):
    original = read(pg)
    content = original["delivery"]["content_sha256"] if field != "content" else "0" * 64
    effect = original["expected_effect_sha256"] if field != "effect" else "0" * 64
    result = pg("select public.share_brief_delivery("
                f"{q(delivery(1))},{q(TEAM)},{q(content)},{q(effect)});", OWNER, False)
    assert result.returncode != 0 and "40001" in result.stderr
    assert read(pg)["grant"] is None


def test_expired_invitation_does_not_create_team_membership_or_share_authority(pg):
    pg("insert into public.team_invites(team_id,email,role,token_hash,invited_by,expires_at) "
       f"values({q(TEAM)},'synthetic@example.test','admin','synthetic-test-token-hash',{q(OWNER)},now()-interval '1 day');")
    # The source owns this brief but an expired invite supplies no membership.
    pg(f"update public.brief_subscriptions set user_id={q(OUTSIDER)} where subscription_id="
       f"(select subscription_id from public.brief_deliveries where delivery_id={q(delivery(3))});")
    result = pg(f"select public.read_brief_delivery_sharing({q(delivery(3))},{q(TEAM)});", OUTSIDER, False)
    assert result.returncode != 0 and "42501" in result.stderr


def test_route_handlers_join_the_real_database_owner(pg):
    vitest = ROOT / "terminal/node_modules/vitest/vitest.mjs"
    if not shutil.which("node") or not vitest.is_file():
        pytest.skip("Node/Vitest source integration runtime is unavailable")
    environment = dict(os.environ, MM_BRIEF_TEST_PSQL_ARGV=json.dumps(pg.command))
    result = subprocess.run(["node", str(vitest), "run",
        "lib/__tests__/briefDeliverySharing.postgres.integration.test.ts"],
        cwd=ROOT / "terminal", env=environment, text=True, capture_output=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
