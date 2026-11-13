"""Effective0049 ACLs on the incumbent disposable socket-only PostgreSQL.

The seeded default service-role grant models the actual catalog prerequisite;
it is not production SQL or an authentication substitute. All function bodies,
roles, ACL checks and the0049→0048 transaction are real inside this fixture.
"""
import json
from pathlib import Path

from tests.test_brief_delivery_team_sharing_postgres import pg as delivery_pg, server, q
from tests.test_brief_sharing_requests_postgres import issue, action

MIGRATION = Path(__file__).resolve().parents[1] / "supabase/migrations/0049_brief_sharing_requests.sql"
SIGNATURES = (
    "brief_sharing_request_record(uuid,integer,timestamptz,text,timestamptz,jsonb)",
    "brief_sharing_request_record_bound(jsonb)",
    "brief_sharing_request_feed_bound(jsonb)",
    "issue_brief_sharing_request(uuid,uuid,uuid,text)",
    "read_brief_sharing_requests()",
    "read_brief_sharing_request(uuid,uuid,integer)",
    "share_requested_brief(uuid,uuid,integer,text,text)",
    "keep_requested_brief_private(uuid,uuid,integer,text)",
)
SURFACES = {s.split("(")[0] for s in SIGNATURES[3:]}
# Independently pinned accepted4635674d function bodies; only the ACL changes.
BODY_MD5 = {
    "brief_sharing_request_record_bound": "b0e860a3b6a36bf06718333f592f6aae",
    "brief_sharing_request_record": "4ead774d15a0d99807b562d5106e2a41",
    "brief_sharing_request_feed_bound": "52707b6af58eabd4606dbae6d6ca0891",
    "issue_brief_sharing_request": "cc198a7327c7d2c60b492a11320cfb38",
    "read_brief_sharing_requests": "93772affb78e9d72ef2da577c9086303",
    "read_brief_sharing_request": "c6359e5087ac695d470e723acf015280",
    "share_requested_brief": "0ab312c2da74071dc8f73e0db4493b22",
    "keep_requested_brief_private": "8c6d96601d0387243c6b52a034279204",
}


def _0048_snapshot(pg):
    return json.loads(pg("""select jsonb_object_agg(proname,
      jsonb_build_object('owner',proowner,'body',md5(prosrc),
        'acl',proacl::text,'config',proconfig,'definer',prosecdef))
      from pg_proc where pronamespace='public'::regnamespace and proname in (
        'brief_delivery_content_sha256','brief_delivery_share_effect_sha256',
        'brief_delivery_share_grant','brief_delivery_sharing_bound',
        'brief_delivery_sharing_view','read_brief_delivery_sharing',
        'share_brief_delivery','reconcile_brief_delivery_sharing',
        'read_shared_brief_delivery');"""))


def test_service_default_cannot_open0049_and_same_owner0048_still_works(delivery_pg):
    pg = delivery_pg
    # The existing fixture uses a private Unix socket and an exclusive cluster.
    assert Path(pg.command[pg.command.index("-h") + 1]).is_dir()
    pg("alter default privileges for role postgres in schema public "
       "grant execute on functions to service_role;")
    # Preserve the already-applied0048 privileged-backend boundary as observed.
    old = _0048_snapshot(pg)
    assert len(old) == 9
    for name in old:
        signature = pg("select oid::regprocedure::text from pg_proc "
                       f"where pronamespace='public'::regnamespace and proname={q(name)};")
        pg(f"grant execute on function {signature} to service_role;")
    old = _0048_snapshot(pg)
    pg("create or replace function auth.jwt() returns jsonb language sql stable as $$"
       "select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;")
    pg(MIGRATION.read_text())

    oids = ",".join(f"{q('public.' + s)}::regprocedure" for s in SIGNATURES)
    actual = json.loads(pg(f"""select jsonb_object_agg(p.proname,jsonb_build_object(
      'owner',pg_get_userbyid(p.proowner),'body',md5(p.prosrc),
      'service',has_function_privilege('service_role',p.oid,'execute'),
      'anon',has_function_privilege('anon',p.oid,'execute'),
      'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
      'public',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE')))
      from pg_proc p where p.oid in ({oids});"""))
    assert set(actual) == set(BODY_MD5)
    for name, row in actual.items():
        assert row["service"] is False, f"service_role retained execute on {name}"
        assert row["anon"] is False and row["public"] is False
        assert row["authenticated"] is (name in SURFACES)
        assert row["owner"] == "postgres"
        assert row["body"] == BODY_MD5[name]

    assert _0048_snapshot(pg) == old  # no0048 body/ACL/owner/definer drift
    assert pg("select exists(select 1 from pg_default_acl d,aclexplode(d.defaclacl) a "
              "where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace "
              "and d.defaclobjtype='f' and a.grantee='service_role'::regrole "
              "and a.privilege_type='EXECUTE');") == "t"
    denied = pg("set role service_role; select public.brief_sharing_request_feed_bound('{}'::jsonb);",
                check=False)
    assert denied.returncode != 0 and "42501" in denied.stderr
    issued = issue(pg)
    shared = action(pg, issued)  # actual0049 definer invokes owner-only0048 helpers
    assert shared["disposition"] == "SHARED" and shared["review"]["grant"]
    assert action(pg, issued) == shared  # original transaction remains idempotent
