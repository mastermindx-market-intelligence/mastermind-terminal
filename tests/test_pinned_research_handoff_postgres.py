"""Run the actual 0021 + 0028 + 0041 migrations and the pinned research handoff
boundary against isolated PostgreSQL. Real SQL is applied twice, no production
users, credentials, or services are used. Requires PostgreSQL binaries; a host
without them is reported as skipped, never as a pass. The keyset pagination
amendment is exercised two ways: the amended 0041 applied fresh, and the same
file replayed over an isolated prior draft whose superseded no-argument list
RPC and preexisting >200-pin overflow already live in the database.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest

ROOT = Path(__file__).resolve().parents[1]
PREVIOUS = (ROOT / "supabase/migrations/0021_resource_grants.sql",
            ROOT / "supabase/migrations/0028_investigations.sql")
SQL = ROOT / "supabase/migrations/0041_pinned_research_handoffs.sql"
A = "10000000-0000-4000-8000-000000000001"   # owner
B = "10000000-0000-4000-8000-000000000002"   # grantee
C = "10000000-0000-4000-8000-000000000003"   # unrelated account
X = "10000000-0000-4000-8000-000000000004"   # list-bound fixture account
P = "10000000-0000-4000-8000-000000000005"   # pagination fixture account
Q = "10000000-0000-4000-8000-000000000006"   # prior-draft upgrade fixture account
I1 = "20000000-0000-4000-8000-000000000001"  # A's shared investigation
I2 = "20000000-0000-4000-8000-000000000002"  # A's second investigation
I3 = "20000000-0000-4000-8000-000000000003"  # A's removed-revision probe
J1 = "20000000-0000-4000-8000-000000000004"  # B's own investigation
W1 = "30000000-0000-4000-8000-000000000001"  # A's watchlist
SUBJECT = {"kind": "security", "owner": "terminal.analysis_symbol", "object_id": "AAPL"}
EVIDENCE = {"owner": "earnings.workspace_generation", "object_type": "event_workspace",
            "object_id": "event", "mode": "pinned", "version_ref": "gen-1"}
I1_REV1 = {"schema": "investigation_manifest.v2",
           "intent": {"title": "Pinned handoff", "question": "Why?", "subjects": [SUBJECT]},
           "layout_refs": [], "thesis_refs": [], "evidence_refs": [EVIDENCE],
           "continuation": {"next_question": "Follow up?", "next_observation": "Watch price"}}
I1_REV2 = {"schema": "investigation_manifest.v2",
           "intent": {"title": "Revised handoff", "question": "Why now?", "subjects": []},
           "layout_refs": [], "thesis_refs": [], "evidence_refs": [], "continuation": {}}
I2_REV1 = {**I1_REV2, "intent": {"title": "Second", "question": "And?", "subjects": []}}
I3_REV1 = {**I1_REV2, "intent": {"title": "Probe", "question": "Hmm?", "subjects": []}}
J1_REV1 = {**I1_REV2, "intent": {"title": "Grantee own", "question": "Mine?", "subjects": []}}
SUMMARY_KEYS = {"grant_id", "investigation_id", "revision", "title", "shared_by",
                "grantee_user_id", "created_at"}
LIST_KEYS = {"status", "own", "sent", "received",
             "sent_next_cursor", "received_next_cursor"}

# The prior draft's no-argument list RPC, its ACL and its fail-closed >200 bound, embedded so
# the upgrade test exercises a real isolated prior-draft database without the old file on disk.
OLD_LIST_SQL = """
create or replace function public.list_investigation_handoffs_v1()
returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $func$
declare
  actor uuid := auth.uid();
  own jsonb;
  sent jsonb;
  received jsonb;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  select coalesce(jsonb_agg(x.item order by x.updated_at desc, x.id), '[]'::jsonb) into own
    from (select jsonb_build_object('id', h.id, 'revision', h.current_revision,
                    'title', r.manifest #>> '{intent,title}') as item,
                 h.updated_at, h.id
            from public.investigations h
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = h.current_revision
           where h.user_id = actor and h.lifecycle = 'active'
           limit 501) x;
  if jsonb_array_length(own) > 500 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.grant_id), '[]'::jsonb) into sent
    from (select public.investigation_handoff_summary_v1(g.id, g.resource_id, g.resource_revision,
                    g.granted_by, g.grantee_user_id, g.created_at, r.manifest) as item,
                 g.created_at, g.id as grant_id
            from public.resource_grants g
            join public.investigations h
              on h.id = g.resource_id and h.user_id = g.granted_by
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = g.resource_revision and r.lifecycle = 'active'
           where g.granted_by = actor and g.resource_kind = 'investigation' and g.revoked_at is null
           limit 201) x;
  if jsonb_array_length(sent) > 200 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.grant_id), '[]'::jsonb) into received
    from (select public.investigation_handoff_summary_v1(g.id, g.resource_id, g.resource_revision,
                    g.granted_by, g.grantee_user_id, g.created_at, r.manifest) as item,
                 g.created_at, g.id as grant_id
            from public.resource_grants g
            join public.investigations h
              on h.id = g.resource_id and h.user_id = g.granted_by and h.lifecycle = 'active'
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = g.resource_revision and r.lifecycle = 'active'
           where g.grantee_user_id = actor and g.resource_kind = 'investigation' and g.revoked_at is null
           limit 201) x;
  if jsonb_array_length(received) > 200 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  return jsonb_build_object('status', 'listed', 'own', own, 'sent', sent, 'received', received);
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end
$func$;
alter function public.list_investigation_handoffs_v1() owner to postgres;
revoke all on function public.list_investigation_handoffs_v1()
  from public, anon, authenticated;
do $$ begin
  revoke all on function public.list_investigation_handoffs_v1() from service_role;
exception when undefined_object then null; end $$;
grant execute on function public.list_investigation_handoffs_v1() to authenticated;
"""


def quote(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def manifest_like(body):
    return quote(json.dumps(body, ensure_ascii=False)) + "::jsonb"


def gid(n):
    # Deterministic grant UUIDs: ascending numeric order equals ascending uuid order, so the
    # keyset pages below are exact regardless of gen_random_uuid() luck.
    return "70000000-0000-4000-8000-%012d" % n


def seed_overflow_grants(pg, owner, count):
    # Direct privileged INSERTs: preexisting overflow rows, not admissions through the policy.
    # Every grant goes to C with the deterministic ascending id gid(n), so keyset pages are
    # exact regardless of gen_random_uuid() luck.
    pg("insert into public.investigations(id,user_id,current_revision,lifecycle,created_at,"
       "updated_at) select gen_random_uuid(),'" + owner + "',1,'active',now(),now()"
       " from generate_series(1," + str(count) + ");")
    pg("insert into public.investigation_revisions(investigation_id,user_id,revision,action,"
       "lifecycle,manifest,committed_at) select id,user_id,1,'create','active',"
       + manifest_like(I1_REV2) + ",now() from public.investigations where user_id='" + owner + "';")
    pg("insert into public.resource_grants(id,resource_kind,resource_id,resource_revision,"
       "grantee_user_id,granted_by) select ('70000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,"
       "'investigation',id,1,'" + C + "','" + owner + "' from (select id, row_number() over"
       " (order by id) n from public.investigations where user_id='" + owner + "') s"
       " order by n limit " + str(count) + ";")


def _spawn_postgres(tmp_path_factory, prefix, port):
    for binary in ("initdb", "pg_ctl", "psql"):
        if not shutil.which(binary):
            pytest.skip(f"PostgreSQL binary missing: {binary}")
    base = tmp_path_factory.mktemp(prefix)
    data = base / "data"
    # Darwin limits Unix socket paths to103bytes; pytest default temp roots can exceed it.
    socket_root = tempfile.TemporaryDirectory(prefix="mmx-handoff-pg-", dir="/tmp")
    sock = Path(socket_root.name)
    subprocess.run(["initdb", "-D", str(data), "-U", "postgres", "-A", "trust",
                    "--no-locale", "--encoding=UTF8", "--no-sync"], check=True, capture_output=True)
    subprocess.run(["pg_ctl", "-D", str(data), "-l", str(base / "server.log"),
                    "-o", f"-k {sock} -h '' -p {port}", "-w", "start"], check=True, capture_output=True)

    def run(sql, who=None, role=None, check=True):
        if who is not None:
            assert role is None
            sql = "set role authenticated; set request.jwt.claim.sub=" + quote(who) + ";" + sql
        elif role is not None:
            assert role in ("anon", "authenticated", "service_role")
            sql = f"set role {role};" + sql
        r = subprocess.run(["psql", "-h", str(sock), "-p", str(port), "-U", "postgres",
                            "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                           input=sql, text=True, capture_output=True)
        if check:
            assert r.returncode == 0, r.stderr
            return r.stdout.strip()
        return r

    return run, data, socket_root


def _bootstrap_base_schema(run):
    run("create role anon; create role authenticated;"
        "do $$ begin create role service_role; exception when duplicate_object then null; end $$;"
        "create schema auth; create schema extensions;"
        "create extension pgcrypto with schema extensions;"
        "create table auth.users(id uuid primary key);"
        "create function auth.uid() returns uuid language sql stable as"
        " $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"
        "grant usage on schema public, auth to anon, authenticated, service_role;"
        "insert into auth.users values ('" + A + "'),('" + B + "'),('" + C + "');"
        # Minimal canonical 0001-shaped base tables with owner RLS, so 0021 applies for real.
        "create table public.watchlists(id uuid primary key, user_id uuid not null"
        " references auth.users(id) on delete cascade, name text not null,"
        " created_at timestamptz default now());"
        "create table public.watchlist_symbols(id uuid primary key default gen_random_uuid(),"
        " watchlist_id uuid not null references public.watchlists(id) on delete cascade,"
        " symbol text not null, position int default 0, created_at timestamptz default now());"
        "alter table public.watchlists enable row level security;"
        "alter table public.watchlist_symbols enable row level security;"
        "create policy watchlists_owner on public.watchlists for all to authenticated"
        " using (user_id = auth.uid()) with check (user_id = auth.uid());"
        "create policy wls_via_parent on public.watchlist_symbols for all to authenticated"
        " using (exists (select 1 from public.watchlists w where w.id = watchlist_id"
        " and w.user_id = auth.uid()))"
        " with check (exists (select 1 from public.watchlists w where w.id = watchlist_id"
        " and w.user_id = auth.uid()));"
        "grant select on public.watchlists, public.watchlist_symbols to authenticated;"
        "create table public.chart_layouts(id uuid primary key, user_id uuid references auth.users(id),"
        " name text, config jsonb, updated_at timestamptz default now());"
        "insert into public.watchlists(id,user_id,name) values ('" + W1 + "','" + A + "','Owner list');"
        "insert into public.watchlist_symbols(watchlist_id,symbol) values ('" + W1 + "','AAPL');")


def _seed_handoff_world(run):
    # Seed through the real 0028 RPCs: two A investigations, one B investigation.
    run("select public.apply_investigation_revision_v2(" + quote(I1) + "::uuid,0,'create',"
        + quote(str(uuid4())) + "::uuid," + manifest_like(I1_REV1) + ");", who=A)
    run("select public.apply_investigation_revision_v2(" + quote(I1) + "::uuid,1,'revise',"
        + quote(str(uuid4())) + "::uuid," + manifest_like(I1_REV2) + ");", who=A)
    run("select public.apply_investigation_revision_v2(" + quote(I2) + "::uuid,0,'create',"
        + quote(str(uuid4())) + "::uuid," + manifest_like(I2_REV1) + ");", who=A)
    run("select public.apply_investigation_revision_v2(" + quote(I3) + "::uuid,0,'create',"
        + quote(str(uuid4())) + "::uuid," + manifest_like(I3_REV1) + ");", who=A)
    run("select public.apply_investigation_revision_v2(" + quote(I3) + "::uuid,1,'remove',"
        + quote(str(uuid4())) + "::uuid," + manifest_like(I3_REV1) + ");", who=A)
    run("select public.apply_investigation_revision_v2(" + quote(J1) + "::uuid,0,'create',"
        + quote(str(uuid4())) + "::uuid," + manifest_like(J1_REV1) + ");", who=B)


@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    run, data, socket_root = _spawn_postgres(tmp_path_factory, "handoff-pg", 55488)
    try:
        _bootstrap_base_schema(run)
        for sql_file in PREVIOUS + (SQL,):
            assert sql_file.exists(), f"{sql_file.name} is not implemented"
            run(sql_file.read_text())
        for sql_file in PREVIOUS + (SQL,):  # real rerun, no ledger assumptions
            run(sql_file.read_text())
        _seed_handoff_world(run)
        run.socket_path = str(socket_root.name)
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
                       check=True, capture_output=True)
        socket_root.cleanup()


@pytest.fixture(scope="module")
def pg_upgrade(tmp_path_factory):
    # An isolated prior-draft database: 0021 + 0028 plus the superseded no-argument list RPC and
    # its ACL, with >200 preexisting direct-INSERT pins already living in it. The amended 0041
    # file is replayed over exactly this state inside the upgrade test.
    run, data, socket_root = _spawn_postgres(tmp_path_factory, "handoff-pg-upgrade", 55489)
    try:
        _bootstrap_base_schema(run)
        for sql_file in PREVIOUS:
            run(sql_file.read_text())
        # The unchanged schema/guard/projection policy must exist in the old draft too.
        # Reconstruct that same draft using its frozen old list body and old ACL signature,
        # not a new-schema-free mock that could fail before exercising overflow.
        current = SQL.read_text()
        prefix = current.split("create or replace function public.list_investigation_handoffs_v1(", 1)[0]
        suffix = "-- Grantee-only read" + current.split("-- Grantee-only read", 1)[1]
        prior = (prefix + OLD_LIST_SQL + "\n" + suffix).replace(
            "list_investigation_handoffs_v1(uuid, uuid)", "list_investigation_handoffs_v1()")
        prior = prior.replace("list_investigation_handoffs_v1(uuid,uuid)",
                              "list_investigation_handoffs_v1()")
        run(prior)
        run("insert into auth.users values ('" + Q + "');")
        seed_overflow_grants(run, Q, 220)
        run.socket_path = str(socket_root.name)
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"],
                       check=True, capture_output=True)
        socket_root.cleanup()


def rpc(pg, expr, who=A, check=True):
    if who is None:  # claimless authenticated session
        result = pg("select " + expr + ";", role="authenticated", check=check)
    elif check:
        result = pg("select " + expr + ";", who)
    else:
        result = pg("select " + expr + ";", who, check=False)
    return json.loads(result) if check else result


def share(pg, inv=I1, revision=1, grantee=B, who=A, check=True):
    return rpc(pg, "public.create_investigation_handoff_v1(" + quote(inv) + "::uuid,"
               + ("null" if revision is None else str(revision)) + ","
               + quote(grantee) + "::uuid)", who, check=check)


def read_handoff(pg, grant_id, who=B, check=True):
    return rpc(pg, "public.read_investigation_handoff_v1(" + quote(grant_id) + "::uuid)",
               who, check=check)


def revoke_handoff(pg, grant_id, who=A, check=True):
    return rpc(pg, "public.revoke_investigation_handoff_v1(" + quote(grant_id) + "::uuid)",
               who, check=check)


def listing(pg, who, sent_after=None, received_after=None):
    # Absent cursors ride the RPC defaults; an explicit cursor goes back through the exact
    # named-argument contract (p_sent_after / p_received_after), each direction independently.
    if sent_after is None and received_after is None:
        return rpc(pg, "public.list_investigation_handoffs_v1()", who)
    return rpc(pg, "public.list_investigation_handoffs_v1(p_sent_after => "
               + quote(sent_after) + "::uuid, p_received_after => "
               + quote(received_after) + "::uuid)", who)


def live_grants(pg, owner=A):
    return json.loads(pg("select coalesce(json_agg(id),'[]'::json) from public.resource_grants"
                         " where granted_by='" + owner + "' and resource_kind='investigation'"
                         " and revoked_at is null;"))


def reset_live_grants(pg, owner=A):
    for grant_id in live_grants(pg, owner):
        assert revoke_handoff(pg, grant_id, owner)["status"] == "revoked"


def grants_multiset(pg):
    return pg("select coalesce(jsonb_agg(row order by row::text),'[]'::jsonb) from"
              " (select to_jsonb(t) row from public.resource_grants t) q;")


def test_share_create_converges_and_conflicts(pg):
    reset_live_grants(pg)
    first = share(pg)
    assert first["status"] == "created"
    summary = first["handoff"]
    assert set(summary) == SUMMARY_KEYS
    assert (summary["investigation_id"], summary["revision"], summary["title"],
            summary["shared_by"], summary["grantee_user_id"]) == (I1, 1, "Pinned handoff", A, B)
    again = share(pg)
    assert again["status"] == "already_shared" and again["handoff"] == summary
    # A different live pin is a conflict, never a silent repoint.
    assert share(pg, revision=2)["status"] == "share_conflict"
    assert live_grants(pg) and len(live_grants(pg)) == 1
    reset_live_grants(pg)  # race a new live share, not the one already created above
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda n: share(pg), [0, 1]))
    assert sorted(r["status"] for r in results) == ["already_shared", "created"]
    reset_live_grants(pg)


def test_share_boundary_is_non_disclosing(pg):
    assert share(pg, who=None)["status"] == "unauthenticated"
    for payload in ({"revision": 0}, {"revision": -3}, {"revision": None},
                    {"grantee": A}, {"grantee": None}):
        assert share(pg, **payload)["status"] == "invalid_payload", payload
    # Absent grantee, foreign/unknown aggregate and absent or removed revision all read
    # identically as not_found.
    assert share(pg, grantee="99999999-0000-4000-8000-000000000009")["status"] == "not_found"
    assert share(pg, inv=J1)["status"] == "not_found"
    assert share(pg, inv=str(uuid4()))["status"] == "not_found"
    assert share(pg, revision=99)["status"] == "not_found"
    assert share(pg, inv=I3, revision=2)["status"] == "not_found"  # remove-revision pin
    assert share(pg, inv=I1, who=B, grantee=C)["status"] == "not_found"  # B cannot share A's aggregate
    reset_live_grants(pg)


def test_read_dto_is_exact_and_pin_never_moves(pg):
    reset_live_grants(pg)
    grant_id = share(pg)["handoff"]["grant_id"]
    found = read_handoff(pg, grant_id)
    assert set(found) == {"status", "handoff"}
    handoff = found["handoff"]
    assert set(handoff) == {"schema", "grant_id", "investigation_id", "revision",
                            "shared_by", "committed_at", "intent", "continuation"}
    assert handoff["schema"] == "mm.research_handoff.v1"
    assert (handoff["grant_id"], handoff["investigation_id"], handoff["revision"],
            handoff["shared_by"]) == (grant_id, I1, 1, A)
    assert handoff["intent"] == {"title": "Pinned handoff", "question": "Why?"}
    assert handoff["continuation"] == {"next_question": "Follow up?",
                                       "next_observation": "Watch price"}
    blob = json.dumps(found)
    for forbidden in ("subjects", "layout_refs", "evidence_refs", "review_baseline_ref",
                      "current_revision", "lifecycle", "AAPL"):
        assert forbidden not in blob, forbidden
    # Late owner revisions never move the pin or leak the new head.
    key = str(uuid4())
    revised = json.loads(pg("select public.apply_investigation_revision_v2(" + quote(I1)
                            + "::uuid,2,'revise'," + quote(key) + "::uuid,"
                            + manifest_like({**I1_REV2, "intent": {"title": "Head changed",
                                             "question": "New head?", "subjects": [SUBJECT]}})
                            + ");", A))
    assert revised["status"] == "committed" and revised["revision"] == 3
    still = read_handoff(pg, grant_id)
    assert still == found
    # A pin on a manifest with no continuation keys reads an empty continuation object.
    other = share(pg, inv=I2)["handoff"]["grant_id"]
    empty = read_handoff(pg, other)
    assert empty["handoff"]["continuation"] == {} and empty["handoff"]["revision"] == 1
    reset_live_grants(pg)


def test_listing_scopes_own_sent_received(pg):
    reset_live_grants(pg)
    first = share(pg)["handoff"]["grant_id"]
    second = share(pg, inv=I2)["handoff"]["grant_id"]
    mine = listing(pg, A)
    assert set(mine) == LIST_KEYS and mine["status"] == "listed"
    assert mine["sent_next_cursor"] is None and mine["received_next_cursor"] is None
    assert all(set(item) == {"id", "revision", "title"} for item in mine["own"])
    assert {item["id"] for item in mine["own"]} == {I1, I2}
    assert {item["id"]: item["revision"] for item in mine["own"]} == {I1: 3, I2: 1}
    assert {item["grant_id"] for item in mine["sent"]} == {first, second}
    assert all(set(item) == SUMMARY_KEYS for item in mine["sent"])
    assert mine["received"] == []
    theirs = listing(pg, B)
    assert {item["grant_id"] for item in theirs["received"]} == {first, second}
    assert theirs["received_next_cursor"] is None and theirs["sent_next_cursor"] is None
    assert [item["id"] for item in theirs["own"]] == [J1]
    assert theirs["sent"] == []
    assert listing(pg, C) == {"status": "listed", "own": [], "sent": [], "received": [],
                              "sent_next_cursor": None, "received_next_cursor": None}
    assert listing(pg, None)["status"] == "unauthenticated"
    reset_live_grants(pg)


def test_keyset_pagination_walks_every_id_exactly_once(pg):
    # RED control: against the pre-pagination draft this contract cannot hold -- the no-argument
    # RPC has neither cursor fields nor ascending-id pages and refuse-overflows instead.
    pg("insert into auth.users values ('" + P + "');")
    seed_overflow_grants(pg, P, 250)
    try:
        first = listing(pg, P)
        assert first["status"] == "listed"
        assert set(first) == LIST_KEYS
        page_one = [item["grant_id"] for item in first["sent"]]
        assert len(page_one) == 200 and len(set(page_one)) == 200
        assert page_one == sorted(page_one)  # ascending immutable grant UUIDs, aggregate too
        assert first["sent_next_cursor"] == page_one[-1] == gid(200)
        assert first["received_next_cursor"] is None
        second = listing(pg, P, sent_after=first["sent_next_cursor"])
        page_two = [item["grant_id"] for item in second["sent"]]
        assert page_two == [gid(n) for n in range(201, 251)]
        assert second["sent_next_cursor"] is None  # the last page closes the walk
        walked = page_one + page_two
        assert walked == [gid(n) for n in range(1, 251)]  # every ID exactly once, no offset skip
        # The grantee walks the very same rows from the other direction, independently.
        inbox = listing(pg, C)
        assert inbox["received_next_cursor"] == gid(200)
        assert [item["grant_id"] for item in inbox["received"]] == [gid(n) for n in range(1, 201)]
        inbox_rest = listing(pg, C, received_after=inbox["received_next_cursor"])
        assert [item["grant_id"] for item in inbox_rest["received"]] == \
            [gid(n) for n in range(201, 251)]
        assert inbox_rest["received_next_cursor"] is None
        assert inbox_rest["sent_next_cursor"] is None
        # Concurrent revoke inside the walked prefix, plus arrivals on both sides of the cursor:
        # with no OFFSET the later page neither duplicates nor skips, and a row sorted before the
        # traversed cursor only surfaces on the next explicit refresh -- lists are live, not a
        # cross-page frozen snapshot.
        with ThreadPoolExecutor(2) as pool:
            revoke = pool.submit(revoke_handoff, pg, gid(50), P)
            boundary = pool.submit(listing, pg, P, gid(200))
            assert revoke.result()["status"] == "revoked"
            assert [item["grant_id"] for item in boundary.result()["sent"]] == \
                [gid(n) for n in range(201, 251)]
        # Both arrivals go to B: every investigation already carries a live C pin, and 0021's
        # live uniqueness is one grantee per aggregate.
        pg("insert into public.resource_grants(id,resource_kind,resource_id,resource_revision,"
           "grantee_user_id,granted_by) select '" + gid(0) + "','investigation',i.id,1,'" + B
           + "','" + P + "' from public.investigations i where i.user_id='" + P
           + "' order by i.id limit 1;")
        pg("insert into public.resource_grants(id,resource_kind,resource_id,resource_revision,"
           "grantee_user_id,granted_by) select '" + gid(300) + "','investigation',i.id,1,'" + B
           + "','" + P + "' from public.investigations i where i.user_id='" + P
           + "' order by i.id offset 1 limit 1;")
        later = listing(pg, P, sent_after=gid(200))
        later_ids = [item["grant_id"] for item in later["sent"]]
        assert later_ids == [gid(n) for n in range(201, 251)] + [gid(300)]
        assert gid(0) not in later_ids and gid(50) not in later_ids
        assert later["sent_next_cursor"] is None
        refreshed = listing(pg, P)
        fresh_ids = [item["grant_id"] for item in refreshed["sent"]]
        assert fresh_ids == [gid(0)] + [gid(n) for n in range(1, 50)] \
            + [gid(n) for n in range(51, 201)]
        assert refreshed["sent_next_cursor"] == gid(200)
        # Revoking from the last page keeps the walk consistent, and revocation stays terminal.
        assert revoke_handoff(pg, gid(250), P)["status"] == "revoked"
        tail = listing(pg, P, sent_after=gid(200))
        assert [item["grant_id"] for item in tail["sent"]] == \
            [gid(n) for n in range(201, 250)] + [gid(300)]
        assert tail["sent_next_cursor"] is None
        assert revoke_handoff(pg, gid(250), P)["status"] == "revoked"  # idempotent, terminal
        # Draining to exactly the page bound closes the list with a null cursor, never an
        # extra empty page.
        for n in range(201, 250):
            assert revoke_handoff(pg, gid(n), P)["status"] == "revoked"
        assert revoke_handoff(pg, gid(300), P)["status"] == "revoked"
        drained = listing(pg, P)
        assert len(drained["sent"]) == 200 and drained["sent_next_cursor"] is None
    finally:
        pg("delete from public.resource_grants where granted_by='" + P + "';")
        pg("delete from public.investigations where user_id='" + P + "';")
        pg("delete from auth.users where id='" + P + "';")
    assert listing(pg, B)["status"] == "listed"


def test_cursor_seeks_stay_inside_caller_scope_and_grant_nothing(pg):
    reset_live_grants(pg)
    mine = share(pg)["handoff"]["grant_id"]                          # A -> B on I1
    theirs = share(pg, inv=J1, grantee=C, who=B)["handoff"]["grant_id"]  # B -> C on J1
    # A seeking past B's grant sees only A's own rows; the seek reads, creates and grants
    # nothing outside A's scope.
    a_page = listing(pg, A, sent_after=theirs)
    assert {item["grant_id"] for item in a_page["sent"]} <= {mine}
    assert all(item["grant_id"] > theirs for item in a_page["sent"])
    # Seeking past one's own last grant is a legitimate empty trailing page.
    beyond_own = listing(pg, A, sent_after=mine)
    assert beyond_own["sent"] == [] and beyond_own["sent_next_cursor"] is None
    b_page = listing(pg, B, received_after=mine)
    assert {item["grant_id"] for item in b_page["received"]} <= {mine}
    assert all(item["grant_id"] > mine for item in b_page["received"])
    # A watchlist share never enters either paginated direction, on either side.
    pg("insert into public.resource_grants(resource_kind,resource_id,grantee_user_id,granted_by)"
       " values ('watchlist','" + W1 + "','" + B + "','" + A + "');", A)
    watch_id = pg("select id from public.resource_grants where resource_kind='watchlist'"
                  " and resource_id='" + W1 + "' and revoked_at is null limit 1;")
    scope = listing(pg, A)
    assert {item["grant_id"] for item in scope["sent"]} == {mine}
    assert watch_id not in {item["grant_id"] for item in scope["sent"]}
    assert scope["sent_next_cursor"] is None and scope["received_next_cursor"] is None
    b_scope = listing(pg, B)
    assert {item["grant_id"] for item in b_scope["received"]} == {mine}
    assert watch_id not in {item["grant_id"] for item in b_scope["received"]}
    # A malformed cursor is a strict parameter failure at the SQL boundary (the HTTP route
    # maps exactly this to 400); it never degrades into a page.
    broken = rpc(pg, "public.list_investigation_handoffs_v1(p_sent_after => 'nope'::uuid)",
                 A, check=False)
    assert broken.returncode != 0 and "invalid input syntax for type uuid" in broken.stderr
    # An arbitrary unknown UUID is a pure seek: an empty trailing page, not an error and not
    # somebody else's rows.
    seeked = listing(pg, A, sent_after="ffffffff-ffff-4fff-8fff-ffffffffffff")
    assert seeked["status"] == "listed" and seeked["sent"] == []
    assert seeked["sent_next_cursor"] is None and seeked["received_next_cursor"] is None
    # Explicit nulls are the plain first page.
    explicit_first = listing(pg, A, sent_after=None, received_after=None)
    assert {item["grant_id"] for item in explicit_first["sent"]} == {mine}
    # The cursor payload is a bare grant UUID: no foreign grant IDs, no user IDs, no raw
    # manifest and no revision futures leak into a listing.
    blob = json.dumps(listing(pg, A))
    assert theirs not in blob and watch_id not in blob
    for forbidden in ("AAPL", "evidence_refs", "layout_refs", "subjects", "current_revision"):
        assert forbidden not in blob, forbidden
    pg("update public.resource_grants set revoked_at=now() where resource_kind='watchlist'"
       " and granted_by='" + A + "' and revoked_at is null;", A)
    reset_live_grants(pg)
    reset_live_grants(pg, B)


def test_listing_bounds_fail_closed(pg):
    pg("insert into auth.users values ('" + X + "');")
    pg("insert into public.investigations(id,user_id,current_revision,lifecycle,created_at,"
       "updated_at) select gen_random_uuid(),'" + X + "',1,'active',now(),now()"
       " from generate_series(1,501);")
    pg("insert into public.investigation_revisions(investigation_id,user_id,revision,action,"
       "lifecycle,manifest,committed_at) select id,user_id,1,'create','active',"
       + manifest_like(I1_REV2) + ",now() from public.investigations where user_id='" + X + "';")
    try:
        # 501 own candidates still read one past their bound: unavailable, never a truncated
        # success. own keeps its hard limit; only the share directions paginate.
        assert listing(pg, X)["status"] == "unavailable"
        pg("delete from public.investigations where id in (select id from public.investigations"
           " where user_id='" + X + "' order by id limit 1);")
        own = listing(pg, X)
        assert own["status"] == "listed" and len(own["own"]) == 500
        assert len(own["sent"]) == 0 and len(own["received"]) == 0
        assert own["sent_next_cursor"] is None and own["received_next_cursor"] is None
        # 201 preexisting direct-INSERT sent pins are overflow to navigate, not an admission
        # cap to refuse: a full 200 page rides with a cursor, never a silent unavailable.
        pg("insert into public.resource_grants(id,resource_kind,resource_id,resource_revision,"
           "grantee_user_id,granted_by) select ('70000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,"
           "'investigation',id,1,'" + C + "','" + X + "' from (select id, row_number() over"
           " (order by id) n from public.investigations where user_id='" + X + "') s"
           " order by n limit 201;")
        flooded = listing(pg, X)
        assert flooded["status"] == "listed", "overflow is navigated, never refused"
        assert len(flooded["sent"]) == 200
        cursor = flooded["sent_next_cursor"]
        assert cursor == flooded["sent"][-1]["grant_id"]
        assert pg("select id from public.resource_grants where granted_by='" + X + "'"
                  " and resource_kind='investigation' and revoked_at is null"
                  " order by id offset 199 limit 1;") == cursor
        rest = listing(pg, X, sent_after=cursor)
        assert len(rest["sent"]) == 1 and rest["sent_next_cursor"] is None
        assert rest["sent"][0]["grant_id"] > cursor
        # The same rows paginate for the recipient in the other direction, independently.
        inbox = listing(pg, C)
        assert len(inbox["received"]) == 200 and inbox["received_next_cursor"] is not None
        assert len(listing(pg, C,
                           received_after=inbox["received_next_cursor"])["received"]) == 1
        # Exactly at the bound the list closes with a null cursor, not a phantom page.
        pg("delete from public.resource_grants where id = (select id from"
           " public.resource_grants where granted_by='" + X + "' order by id desc limit 1);")
        settled = listing(pg, X)
        assert settled["status"] == "listed" and len(settled["sent"]) == 200
        assert settled["sent_next_cursor"] is None
    finally:
        pg("delete from public.resource_grants where granted_by='" + X + "';")
        pg("delete from public.investigations where user_id='" + X + "';")
        pg("delete from auth.users where id='" + X + "';")
    assert listing(pg, C)["status"] == "listed"


def test_amended_0041_upgrades_an_isolated_prior_draft(pg_upgrade):
    pg = pg_upgrade
    # The prior draft's no-argument RPC fail-closes on its own preexisting overflow...
    assert rpc(pg, "public.list_investigation_handoffs_v1()", Q)["status"] == "unavailable"
    # ...the amended 0041 replays over exactly those live rows...
    pg(SQL.read_text())
    # ...and leaves exactly one list signature: the two-uuid keyset RPC. A zero-argument call
    # must resolve through the defaults, never collide with a surviving overload.
    assert pg("select count(*) from pg_proc where proname='list_investigation_handoffs_v1';") == "1"
    assert pg("select pg_get_function_identity_arguments(oid) from pg_proc"
              " where proname='list_investigation_handoffs_v1';") == \
        "p_sent_after uuid, p_received_after uuid"
    upgraded = rpc(pg, "public.list_investigation_handoffs_v1()", Q)
    assert upgraded["status"] == "listed" and len(upgraded["sent"]) == 200
    assert upgraded["sent_next_cursor"] == gid(200)
    walked = [item["grant_id"] for item in upgraded["sent"]]
    while upgraded["sent_next_cursor"] is not None:
        upgraded = listing(pg, Q, sent_after=upgraded["sent_next_cursor"])
        assert upgraded["status"] == "listed"
        walked += [item["grant_id"] for item in upgraded["sent"]]
    assert walked == [gid(n) for n in range(1, 221)]  # preexisting overflow fully navigable
    inbox = listing(pg, C)
    assert len(inbox["received"]) == 200 and inbox["received_next_cursor"] == gid(200)
    assert len(listing(pg, C, received_after=gid(200))["received"]) == 20
    # The upgraded caller keeps EXECUTE through the authenticated grant on the new signature,
    # and the grant ACL readback shape is unchanged apart from the signature.
    assert pg("select has_function_privilege('authenticated',"
              "'public.list_investigation_handoffs_v1(uuid,uuid)','EXECUTE');") == "t"


def test_removed_source_is_omitted_then_restored_while_revoke_stays_terminal(pg):
    reset_live_grants(pg)
    grant_id = share(pg)["handoff"]["grant_id"]
    assert read_handoff(pg, grant_id)["status"] == "found"
    removed = json.loads(pg("select public.apply_investigation_revision_v2(" + quote(I1)
                            + "::uuid,3,'remove'," + quote(str(uuid4())) + "::uuid,"
                            + manifest_like({**I1_REV2, "intent": {"title": "Head changed",
                                             "question": "New head?", "subjects": [SUBJECT]}})
                            + ");", A))
    assert removed["status"] == "committed" and removed["lifecycle"] == "removed"
    # Recipient content is unavailable, but owner keeps an explicit revoke control.
    assert read_handoff(pg, grant_id)["status"] == "not_found"
    mine = listing(pg, A)
    assert {item["id"] for item in mine["own"]} == {I2}
    assert {item["grant_id"] for item in mine["sent"]} == {grant_id}
    assert mine["sent_next_cursor"] is None and mine["received_next_cursor"] is None
    b_view = listing(pg, B)
    assert b_view["received"] == [] and b_view["received_next_cursor"] is None
    assert pg("select revoked_at is null from public.resource_grants where id='" + grant_id + "'") == "t"
    restored = json.loads(pg("select public.apply_investigation_revision_v2(" + quote(I1)
                             + "::uuid,4,'restore'," + quote(str(uuid4())) + "::uuid,"
                             + manifest_like({**I1_REV2, "intent": {"title": "Head changed",
                                              "question": "New head?", "subjects": [SUBJECT]}})
                             + ");", A))
    assert restored["status"] == "committed" and restored["revision"] == removed["revision"] + 1
    revived = read_handoff(pg, grant_id)
    assert revived["status"] == "found" and revived["handoff"]["revision"] == 1
    assert revived["handoff"]["intent"] == {"title": "Pinned handoff", "question": "Why?"}
    assert {item["grant_id"] for item in listing(pg, B)["received"]} == {grant_id}
    # An explicit revoke is terminal: no restore and no re-read, but a fresh share of the same
    # revision is a new grant, exactly as 0021 treats withdrawn watchlist shares.
    assert revoke_handoff(pg, grant_id)["status"] == "revoked"
    assert read_handoff(pg, grant_id)["status"] == "not_found"
    assert pg("select revoked_at is not null from public.resource_grants where id='" + grant_id + "'") == "t"
    fresh = share(pg)
    assert fresh["status"] == "created" and fresh["handoff"]["grant_id"] != grant_id
    reset_live_grants(pg)
    assert not live_grants(pg)


def test_revoke_is_owner_scoped_kind_bound_and_idempotent(pg):
    reset_live_grants(pg)
    grant_id = share(pg)["handoff"]["grant_id"]
    watch_grant = str(uuid4())
    pg("insert into public.resource_grants(resource_kind,resource_id,grantee_user_id,granted_by)"
       " values ('watchlist','" + W1 + "','" + B + "','" + A + "');")
    watch_id = pg("select id from public.resource_grants where resource_kind='watchlist' and"
                  " resource_id='" + W1 + "' order by created_at desc limit 1;")
    assert watch_id != grant_id
    assert revoke_handoff(pg, grant_id, B)["status"] == "not_found"
    assert revoke_handoff(pg, grant_id, C)["status"] == "not_found"
    assert revoke_handoff(pg, watch_id)["status"] == "not_found"  # never another kind
    assert revoke_handoff(pg, watch_grant)["status"] == "not_found"
    assert revoke_handoff(pg, str(uuid4()))["status"] == "not_found"
    assert revoke_handoff(pg, None)["status"] == "not_found"
    assert revoke_handoff(pg, grant_id, who=None)["status"] == "unauthenticated"
    assert pg("select revoked_at is null from public.resource_grants where id='" + grant_id + "'") == "t"
    assert revoke_handoff(pg, grant_id)["status"] == "revoked"
    assert revoke_handoff(pg, grant_id)["status"] == "revoked"  # idempotent on the owned row
    assert pg("select count(*) from public.resource_grants where id='" + watch_id + "'"
              " and revoked_at is null") == "1"
    reset_live_grants(pg)


def test_read_requires_an_explicit_live_grant_to_the_caller(pg):
    reset_live_grants(pg)
    mine = share(pg)["handoff"]["grant_id"]
    other = share(pg, grantee=C)["handoff"]["grant_id"]
    assert read_handoff(pg, mine, C)["status"] == "not_found"
    assert read_handoff(pg, other, B)["status"] == "not_found"
    assert read_handoff(pg, mine, A)["status"] == "not_found"  # grantee-only, owner uses 0028
    assert read_handoff(pg, str(uuid4()))["status"] == "not_found"
    assert read_handoff(pg, None)["status"] == "not_found"
    assert read_handoff(pg, mine, who=None)["status"] == "unauthenticated"
    reset_live_grants(pg)


def test_raw_tables_roles_and_receipts_stay_closed(pg):
    reset_live_grants(pg)
    before_receipts = pg("select count(*) from public.investigation_mutation_receipts", A)
    grant_id = share(pg)["handoff"]["grant_id"]
    assert read_handoff(pg, grant_id)["status"] == "found"
    assert listing(pg, A)["status"] == "listed"
    assert listing(pg, B)["status"] == "listed"
    for table in ("investigations", "investigation_revisions", "investigation_mutation_receipts",
                  "chart_layout_revisions"):
        # RLS shows B only their own rows and the ACL blocks every write shape.
        assert pg(f"select count(*) from public.{table} where user_id='{A}';", B) == "0", table
        denied = pg(f"delete from public.{table}", B, check=False)
        assert denied.returncode != 0 and "permission denied" in denied.stderr
    denied = pg("update public.investigations set current_revision=9 where id='" + I1 + "'",
                B, check=False)
    assert denied.returncode != 0 and "permission denied" in denied.stderr
    denied = pg("insert into public.investigations values ('" + str(uuid4()) + "','" + B
                + "',1,'active',now(),now())", B, check=False)
    assert denied.returncode != 0 and "permission denied" in denied.stderr
    # The handoff RPCs are not executable by anon or service_role, and the underlying
    # Investigation tables gained no new grant at all. The bare zero-argument call still
    # resolves to the keyset signature through its defaults, so the denial is about EXECUTE,
    # never about an overload.
    for who, role in ((None, "anon"), (None, "service_role")):
        for expr in ("public.create_investigation_handoff_v1('" + I1 + "'::uuid,1,'" + B + "'::uuid)",
                     "public.read_investigation_handoff_v1('" + grant_id + "'::uuid)",
                     "public.list_investigation_handoffs_v1()",
                     "public.list_investigation_handoffs_v1(p_sent_after => null::uuid)",
                     "public.revoke_investigation_handoff_v1('" + grant_id + "'::uuid)"):
            denied = pg("select " + expr + ";", who, role=role, check=False)
            assert denied.returncode != 0 and "permission denied" in denied.stderr
    denied = pg("select count(*) from public.investigations", role="service_role", check=False)
    assert denied.returncode != 0 and "permission denied" in denied.stderr
    # 0021's party SELECT on the grant table itself is intact for both parties.
    assert int(pg("select count(*) from public.resource_grants where grantee_user_id='" + B
                  + "';", B)) >= 1
    assert pg("select count(*) from public.investigation_mutation_receipts", A) == before_receipts
    reset_live_grants(pg)


def test_new_insert_policy_is_kind_bound_and_forgery_proof(pg):
    reset_live_grants(pg)
    def attempt(body, who=A):
        return pg("insert into public.resource_grants(resource_kind,resource_id,"
                  "resource_revision,grantee_user_id,granted_by) values " + body + ";",
                  who, check=False)
    allowed = attempt("('investigation','" + I1 + "',1,'" + B + "','" + A + "')")
    assert allowed.returncode == 0, allowed.stderr
    for body in ("('investigation','" + I1 + "',99,'" + B + "','" + A + "')",   # forged pin
                 "('investigation','" + I2 + "',1,'" + B + "','" + B + "')",    # forged owner
                 "('investigation','" + W1 + "',1,'" + B + "','" + A + "')",    # wrong kind, same uuid shape
                 "('investigation','" + I1 + "',1,'" + C + "','" + B + "')",    # B shares A's work
                 "('watchlist','" + I1 + "',1,'" + B + "','" + A + "')",        # kind/revision mismatch
                 "('investigation','" + I1 + "',null,'" + B + "','" + A + "')",
                 "('investigation','" + I1 + "',1,'" + A + "','" + A + "')"):  # self share
        denied = attempt(body)
        assert denied.returncode != 0, body
    # A live duplicate converges through the unique index, not a second row.
    duplicate = attempt("('investigation','" + I1 + "',1,'" + B + "','" + A + "')")
    assert duplicate.returncode != 0 and "duplicate key" in duplicate.stderr
    # The exact active revision of a removed record is not grantable either.
    denied = attempt("('investigation','" + I3 + "',2,'" + B + "','" + A + "')")
    assert denied.returncode != 0
    reset_live_grants(pg)


def test_revision_pin_is_immutable_and_update_acl_unchanged(pg):
    reset_live_grants(pg)
    grant_id = share(pg)["handoff"]["grant_id"]
    assert pg("select has_column_privilege('authenticated','public.resource_grants',"
              "'revoked_at','UPDATE');") == "t"
    assert pg("select has_column_privilege('authenticated','public.resource_grants',"
              "'resource_revision','UPDATE');") == "f"
    denied = pg("update public.resource_grants set resource_revision=2 where id='" + grant_id
                + "';", A, check=False)
    assert denied.returncode != 0 and "permission denied" in denied.stderr
    repoint = pg("update public.resource_grants set resource_revision=2 where id='" + grant_id
                 + "';", check=False)
    assert repoint.returncode != 0 and "a share record cannot be re-pointed" in repoint.stderr
    kindswap = pg("update public.resource_grants set resource_kind='watchlist' where id='"
                  + grant_id + "';", check=False)
    assert kindswap.returncode != 0 and "a share record cannot be re-pointed" in kindswap.stderr
    assert revoke_handoff(pg, grant_id)["status"] == "revoked"
    unrevoked = pg("update public.resource_grants set revoked_at=null where id='" + grant_id
                   + "';", check=False)
    assert unrevoked.returncode != 0 and "a withdrawn share cannot be changed" in unrevoked.stderr
    reset_live_grants(pg)


def test_watchlist_surface_is_unchanged_and_still_works(pg):
    reset_live_grants(pg)
    policies = json.loads(pg("select coalesce(json_agg(q order by q),'[]'::json) from (select"
                             " jsonb_build_object('name',policyname,'cmd',cmd) q from pg_policies"
                             " where schemaname='public' and tablename='resource_grants') q2;"))
    names = {p["name"] for p in policies}
    assert names == {"resource_grants_select_party", "resource_grants_revoke_owner",
                     "resource_grants_insert_owner", "resource_grants_insert_investigation_owner"}
    by_name = {p["name"]: p for p in policies}
    assert by_name["resource_grants_select_party"]["cmd"] == "SELECT"
    assert by_name["resource_grants_revoke_owner"]["cmd"] == "UPDATE"
    assert by_name["resource_grants_insert_owner"]["cmd"] == "INSERT"
    assert by_name["resource_grants_insert_investigation_owner"]["cmd"] == "INSERT"
    checks = pg("select with_check from pg_policies where policyname='resource_grants_insert_owner';")
    normalized = checks.replace("::text", "")
    for fragment in ("granted_by = auth.uid()", "grantee_user_id <> auth.uid()",
                     "resource_kind = 'watchlist'", "owns_watchlist(resource_id)"):
        assert fragment in normalized, fragment
    assert "investigation" not in normalized
    assert "investigation" in pg("select pg_get_constraintdef(oid) from pg_constraint where"
                                 " conrelid='public.resource_grants'::regclass and conname="
                                 "'resource_grants_resource_kind_check';")
    assert "grantee_user_id <> granted_by" in pg("select pg_get_constraintdef(oid) from"
                                                 " pg_constraint where conrelid='public.resource_grants'::regclass"
                                                 " and conname='resource_grants_not_self';")
    # Retain historical rows, but isolate this live watchlist share from the earlier probe.
    pg("update public.resource_grants set revoked_at=now() where resource_kind='watchlist'"
       " and granted_by='" + A + "' and revoked_at is null;", A)
    # End-to-end watchlist share through the untouched 0021 policy and granted-read policies.
    pg("insert into public.resource_grants(resource_kind,resource_id,grantee_user_id,granted_by)"
       " values ('watchlist','" + W1 + "','" + B + "','" + A + "');", A)
    assert pg("select count(*) from public.watchlists where id='" + W1 + "';", B) == "1"
    assert pg("select count(*) from public.watchlist_symbols where symbol='AAPL';", B) == "1"
    assert pg("select count(*) from public.watchlists;", C) == "0"
    foreign = pg("insert into public.resource_grants(resource_kind,resource_id,grantee_user_id,"
                 "granted_by) values ('watchlist','" + W1 + "','" + C + "','" + B + "');", B,
                 check=False)
    assert foreign.returncode != 0
    reset_live_grants(pg, A)


def test_storage_failure_surfaces_as_unavailable_and_never_false_empty(pg):
    reset_live_grants(pg)
    grant_id = share(pg)["handoff"]["grant_id"]
    assert read_handoff(pg, grant_id)["status"] == "found"
    pg("alter table public.investigation_revisions rename to investigation_revisions_probe;")
    try:
        broken_read = read_handoff(pg, grant_id, check=False)
        assert broken_read.returncode == 0
        assert json.loads(broken_read.stdout)["status"] == "unavailable"
        broken_list = rpc(pg, "public.list_investigation_handoffs_v1()", A, check=False)
        assert broken_list.returncode == 0
        listed = json.loads(broken_list.stdout)
        assert listed["status"] == "unavailable" and "own" not in listed
        broken_cursored = rpc(pg, "public.list_investigation_handoffs_v1("
                                 "p_sent_after => null::uuid, p_received_after => null::uuid)",
                              A, check=False)
        assert broken_cursored.returncode == 0
        assert json.loads(broken_cursored.stdout)["status"] == "unavailable"
        broken_share = share(pg, check=False)
        assert broken_share.returncode == 0
        assert json.loads(broken_share.stdout)["status"] == "unavailable"
    finally:
        pg("alter table public.investigation_revisions_probe rename to investigation_revisions;")
    assert read_handoff(pg, grant_id)["status"] == "found"
    reset_live_grants(pg)


def test_migration_rerun_preserves_live_rows_and_policies(pg):
    reset_live_grants(pg)
    grant_id = share(pg)["handoff"]["grant_id"]
    before = grants_multiset(pg)
    before_receipts = pg("select count(*) from public.investigation_mutation_receipts")
    for sql_file in PREVIOUS + (SQL,):
        pg(sql_file.read_text())
    assert grants_multiset(pg) == before
    assert pg("select count(*) from public.investigation_mutation_receipts") == before_receipts
    assert pg("select count(*) from pg_policies where schemaname='public' and tablename="
              "'resource_grants';") == "4"
    # The replayed signature handoff is a no-op: still exactly one list RPC, the keyset one.
    assert pg("select count(*) from pg_proc where proname='list_investigation_handoffs_v1';") == "1"
    assert read_handoff(pg, grant_id)["status"] == "found"
    assert listing(pg, A)["sent_next_cursor"] is None
    reset_live_grants(pg)


def test_revision_discriminator_is_required_at_the_table_boundary(pg):
    # Privileged writers still must not create a kind whose pin is NULL: SQL CHECK NULL
    # is not false, so the constraint must explicitly require IS NOT NULL.
    result = pg("insert into public.resource_grants(resource_kind,resource_id,resource_revision,"
                "grantee_user_id,granted_by) values ('investigation','" + str(uuid4())
                + "',NULL,'" + B + "','" + A + "');", check=False)
    assert result.returncode != 0
    assert "resource_grants_revision_matches_kind" in result.stderr


def test_exported_http_route_and_typed_client_use_the_actual_sql_contract(pg):
    import os
    vitest = ROOT / "terminal/node_modules/.bin/vitest"
    if not vitest.exists():
        pytest.skip("The isolated HTTP/SQL join requires the existing Terminal dependency tree")
    env = {**os.environ, "MMX_HANDOFF_TEST_SOCKET": pg.socket_path}
    result = subprocess.run(
        [str(vitest), "run", "lib/__tests__/researchHandoffsPostgresConsumer.test.ts"],
        cwd=ROOT / "terminal", env=env, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "1 passed" in result.stdout, "The HTTP/SQL join must execute, not skip"
