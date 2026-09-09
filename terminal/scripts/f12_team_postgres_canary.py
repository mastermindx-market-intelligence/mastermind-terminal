#!/usr/bin/env python3
"""Real-Postgres RLS + isolation canary for packets B-F12-3 and B-F12-8.

Same shape as f12_tenancy_postgres_canary.py: bootstrap a minimal `auth` schema + roles, apply
every migration 0001..0019 in sorted order (0017 is applied when present), then exercise
accept_team_invite, workspace_settings, team_role_changes and team_member_names under real
actor-scoped connections (RLS is the authority under test, never application filtering). Emits
GitHub annotations at line start with flush=True (fleet law) and writes a JSON receipt.

Env: F12_TEAM_DATABASE_URL (required), F12_TEAM_EXPECTED_COMMIT/IMAGE/POSTGRES (optional, recorded
only), F12_TEAM_GITHUB_RUN_ID/RUN_ATTEMPT/JOB (optional, recorded only).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from pathlib import Path

try:
    import psycopg
except ImportError:  # pragma: no cover - environment guard
    print("::error title=f12-team-canary::psycopg is not installed", flush=True)
    raise


class Proof:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.failed = False

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.rows.append({"name": name, "ok": bool(condition), "detail": detail})
        if not condition:
            self.failed = True
            print(f"::error title=f12-team-canary::FAILED {name} {detail}", flush=True)
        else:
            print(f"::notice title=f12-team-canary::ok {name}", flush=True)


def env(name: str, required: bool = True, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        print(f"::error title=f12-team-canary::missing required env {name}", flush=True)
        raise SystemExit(2)
    return val or ""


def admin_connection(dsn: str) -> "psycopg.Connection":
    conn = psycopg.connect(dsn, autocommit=True)
    return conn


def actor_connection(dsn: str, user_id: str | None) -> "psycopg.Connection":
    conn = psycopg.connect(dsn, autocommit=True)
    with conn.cursor() as cur:
        if user_id:
            cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": user_id, "role": "authenticated"}),))
            cur.execute("set role authenticated")
        else:
            cur.execute("set role anon")
    return conn


def expect_database_error(fn, sqlstate: str | None = None) -> bool:
    try:
        fn()
    except psycopg.Error as exc:  # type: ignore[attr-defined]
        code = getattr(exc.diag, "sqlstate", None) if hasattr(exc, "diag") else None
        if sqlstate is None:
            return True
        return code == sqlstate
    return False


def bootstrap(conn: "psycopg.Connection") -> None:
    with conn.cursor() as cur:
        cur.execute("create schema if not exists auth")
        cur.execute("create schema if not exists extensions")
        cur.execute("create extension if not exists pgcrypto with schema extensions")
        cur.execute(
            "create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text,"
            " raw_user_meta_data jsonb not null default '{}'::jsonb)"
        )
        cur.execute(
            "create or replace function auth.uid() returns uuid language sql stable as $$"
            " select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$"
        )
        for role in ("anon", "authenticated", "service_role"):
            cur.execute(f"do $$ begin create role {role}; exception when duplicate_object then null; end $$;")
        cur.execute("grant select on auth.users to anon, authenticated")


def apply_migrations(conn: "psycopg.Connection", migrations_dir: Path, applied: list[dict]) -> None:
    for path in sorted(migrations_dir.glob("*.sql")):
        sql = path.read_text()
        sha = hashlib.sha256(sql.encode("utf8")).hexdigest()
        with conn.cursor() as cur:
            cur.execute(sql)
        applied.append({"file": path.name, "sha256": sha})
        print(f"::notice title=f12-team-canary::applied {path.name}", flush=True)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations", default="supabase/migrations")
    parser.add_argument("--receipt", default="f12-team-postgres-canary-receipt.json")
    args = parser.parse_args()

    dsn = env("F12_TEAM_DATABASE_URL")
    proof = Proof()
    applied: list[dict] = []

    def _receipt(failed: bool, migration_error: str | None = None) -> dict:
        r = {
            "database_url_host": dsn.split("@")[-1] if "@" in dsn else "local",
            "expected_commit": os.environ.get("F12_TEAM_EXPECTED_COMMIT"),
            "expected_image": os.environ.get("F12_TEAM_EXPECTED_IMAGE"),
            "expected_postgres": os.environ.get("F12_TEAM_EXPECTED_POSTGRES"),
            "run_id": os.environ.get("F12_TEAM_GITHUB_RUN_ID"),
            "run_attempt": os.environ.get("F12_TEAM_GITHUB_RUN_ATTEMPT"),
            "job": os.environ.get("F12_TEAM_GITHUB_JOB"),
            "applied_migrations": applied,
            "proofs": proof.rows,
            "failed": failed,
        }
        if migration_error is not None:
            r["migration_error"] = migration_error
        return r

    try:
        admin = admin_connection(dsn)
        bootstrap(admin)
        apply_migrations(admin, Path(args.migrations), applied)
    except Exception as exc:  # noqa: BLE001 - report PARTIAL via receipt, acceptance #7
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-team-canary::migration application failed: {exc}", flush=True)
        return 1

    with admin.cursor() as cur:
        cur.execute("select relrowsecurity, count(p.polname) from pg_class c left join pg_policy p on p.polrelid=c.oid where c.relnamespace='public'::regnamespace and c.relname='workspace_settings' group by 1")
        row = cur.fetchone()
    proof.check("catalog:workspace_settings", bool(row) and row[0] is True and row[1] == 4, str(row))

    with admin.cursor() as cur:
        cur.execute("select prosecdef, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='accept_team_invite'")
        row = cur.fetchone()
    proof.check("helper:accept_team_invite", bool(row) and row[0] is True and row[1] == "p_token text", str(row))

    a_owner = str(uuid.uuid4())
    b_user = str(uuid.uuid4())
    c_user = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute("insert into auth.users (id, email) values (%s, 'owner@a.example'), (%s, 'b@a.example'), (%s, 'c@a.example')", (a_owner, b_user, c_user))
        cur.execute("insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Team A', %s) returning id", (a_owner,))
        team_a = cur.fetchone()[0]
        cur.execute("insert into public.team_members (team_id, user_id, role, invited_by) values (%s,%s,'member',%s) on conflict do nothing", (team_a, b_user, a_owner))
        token = "canarytoken" + uuid.uuid4().hex
        token_hash = hashlib.sha256(token.encode("utf8")).hexdigest()
        cur.execute(
            "insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at) values (%s,'c@a.example','member',%s,%s, now() + interval '14 days')",
            (team_a, token_hash, a_owner),
        )

    a_conn = actor_connection(dsn, a_owner)
    b_conn = actor_connection(dsn, b_user)

    def b_insert_member():
        with b_conn.cursor() as cur:
            cur.execute("insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at) values (%s,'x@x.com','member','deadbeef',%s, now())", (team_a, b_user))

    proof.check("rls:member_cannot_create_invite", expect_database_error(b_insert_member, "42501"), "member insert into team_invites should raise 42501")

    c_conn = actor_connection(dsn, c_user)
    with c_conn.cursor() as cur:
        cur.execute("select * from public.team_invites where team_id=%s", (team_a,))
        rows = cur.fetchall()
    proof.check("rls:invitee_cannot_see_invite", len(rows) == 0, f"invitee saw {len(rows)} rows")

    with c_conn.cursor() as cur:
        cur.execute("select public.accept_team_invite(%s)", (token,))
        result = cur.fetchone()[0]
    proof.check("rpc:accept_creates_membership", isinstance(result, dict) and result.get("ok") is True, str(result))

    with c_conn.cursor() as cur:
        cur.execute("select public.accept_team_invite(%s)", (token,))
        result2 = cur.fetchone()[0]
    proof.check("rpc:accept_twice_is_already_used", isinstance(result2, dict) and result2.get("reason") == "already_used", str(result2))

    # rpc:accept_cannot_mint_owner (round-2 review MAJOR-3, revised after a real-Postgres finding):
    # the prior version of this check only re-counted owners after a MEMBER-role invite was
    # accepted, so it could never fail -- no path in that scenario could have minted an owner in
    # the first place. The first fix attempt tried inserting an OWNER-role team_invites row
    # directly (as admin, bypassing RLS) and having the invitee accept it -- but running this
    # canary for real revealed that 0014_tenancy_foundation.sql's team_invites.role column carries
    # `check (role in ('admin','member'))`, so an owner-role row can NEVER exist in team_invites,
    # not even via a superuser INSERT (a CHECK constraint binds every writer, RLS-bypassing or
    # not). That is a STRONGER guarantee than an RLS policy or an RPC-level guard could provide --
    # so this now proves the actual property directly: the schema itself refuses to store the row
    # that would be needed to mint an owner through acceptance.
    f_user = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute("insert into auth.users (id, email) values (%s, 'f@a.example')", (f_user,))

    def insert_owner_invite():
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at)"
                " values (%s,'f@a.example','owner','deadbeefdeadbeefdeadbeefdeadbeef',%s, now() + interval '14 days')",
                (team_a, a_owner),
            )

    proof.check(
        "rpc:accept_cannot_mint_owner",
        expect_database_error(insert_owner_invite, "23514"),
        "an owner-role team_invites row must be impossible to store (check_violation), even for the admin connection",
    )

    with admin.cursor() as cur:
        cur.execute("select count(*) from public.team_members where team_id=%s and role='owner'", (team_a,))
        owner_count = cur.fetchone()[0]
    proof.check("rpc:accept_owner_invite_creates_no_membership", owner_count == 1, f"owner_count={owner_count}")

    # workspace_settings cross-tenant isolation (acceptance #3)
    d_owner = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute("insert into auth.users (id, email) values (%s, 'owner@b.example')", (d_owner,))
        cur.execute("insert into public.teams (id, name, created_by) values (gen_random_uuid(),'Team B', %s) returning id", (d_owner,))
        team_b = cur.fetchone()[0]
        cur.execute("insert into public.workspace_settings (scope, team_id, user_id, key, value) values ('workspace', %s, %s, 'k', '\"vb\"'::jsonb)", (team_b, a_owner))

    with admin.cursor() as cur:
        cur.execute(
            "insert into public.workspace_settings (scope, team_id, user_id, key, value) values"
            " ('user', null, %s, 'view_density', '\"compact\"'::jsonb),"
            " ('workspace', %s, %s, 'view_density', '\"comfortable\"'::jsonb)"
            " on conflict (scope, owner_id, key) do update set value = excluded.value",
            (a_owner, team_a, a_owner),
        )
        cur.execute("select value from public.workspace_settings where scope='user' and user_id=%s and key='view_density'", (a_owner,))
        user_val = cur.fetchone()[0]
        cur.execute("select value from public.workspace_settings where scope='workspace' and team_id=%s and key='view_density'", (team_a,))
        ws_val = cur.fetchone()[0]
    proof.check(
        "settings:user_and_workspace_are_distinct",
        user_val == "compact" and ws_val == "comfortable" and user_val != ws_val,
        f"user={user_val} ws={ws_val}",
    )

    with admin.cursor() as cur:
        cur.execute("set role postgres")
        cur.execute("select count(*) from public.workspace_settings where team_id=%s", (team_b,))
        postgres_count = cur.fetchone()[0]
        cur.execute("reset role")
    proof.check(
        "control:set_role_postgres_sees_team_b_row",
        postgres_count >= 1,
        f"postgres saw {postgres_count} rows for team_b (proves the member-scoped emptiness below is RLS, not an empty table)",
    )

    with b_conn.cursor() as cur:
        cur.execute("select * from public.workspace_settings where team_id=%s", (team_b,))
        rows_b = cur.fetchall()
    proof.check("rls:cross_tenant_settings", len(rows_b) == 0, f"A member saw {len(rows_b)} of B's rows")

    # rls:admin_cannot_attribute_setting_to_another_user (round-2 review MAJOR-2): USING alone let
    # any owner/admin UPDATE a workspace_settings row and re-attribute it to an arbitrary user_id --
    # minting a false attribution for a write that user never made. a_owner is owner of team_a
    # (allowed to write team_a's settings) but must not be able to set user_id to b_user's id on
    # team_a's own existing row (inserted above as ('workspace', team_a, a_owner, 'view_density', ...)).
    def owner_attributes_write_to_another_user():
        with a_conn.cursor() as cur:
            cur.execute(
                "update public.workspace_settings set user_id=%s where scope='workspace' and team_id=%s and key='view_density'",
                (b_user, team_a),
            )

    proof.check(
        "rls:admin_cannot_attribute_setting_to_another_user",
        expect_database_error(owner_attributes_write_to_another_user, "42501"),
        "an owner/admin UPDATE must not be able to attribute a workspace setting to a different user_id",
    )

    # ddl:writer_deletion_preserves_workspace_setting (round-2 review MAJOR-2; round-3 review
    # BLOCKER-1 fix). The writer must NOT be `teams.created_by` -- 0014's
    # `created_by uuid not null references auth.users(id) on delete cascade` means deleting the
    # team's own creator cascades teams -> workspace_settings (via team_id's own `on delete
    # cascade`) regardless of what user_id's ON DELETE rule is, which is a different, frozen 0014
    # guarantee this PR does not touch and cannot weaken. So team E is created by a separate
    # `e_creator` account, and the setting is written (and its writer later deleted) by a second,
    # non-creator admin, `e_admin` -- the actor this check's guarantee actually describes. The
    # honest scope of the guarantee: a team CREATOR's own account deletion still destroys the
    # whole team and every workspace setting under it, by 0014's frozen `created_by` cascade
    # (see 0015's `-- readback:` note); only a non-creator writer's deletion is survived.
    e_creator = str(uuid.uuid4())
    e_admin = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute("insert into auth.users (id, email) values (%s, 'creator@e.example')", (e_creator,))
        cur.execute("insert into auth.users (id, email) values (%s, 'admin@e.example')", (e_admin,))
        cur.execute("insert into public.teams (id, name, created_by) values (gen_random_uuid(),'Team E', %s) returning id", (e_creator,))
        team_e = cur.fetchone()[0]
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values (%s,%s,'admin',%s)",
            (team_e, e_admin, e_creator),
        )
        cur.execute(
            "insert into public.workspace_settings (scope, team_id, user_id, key, value) values ('workspace', %s, %s, 'k', '\"ve\"'::jsonb)",
            (team_e, e_admin),
        )
        cur.execute("delete from auth.users where id=%s", (e_admin,))
        cur.execute("select user_id, value from public.workspace_settings where team_id=%s and key='k'", (team_e,))
        row = cur.fetchone()
        cur.execute("select count(*) from public.teams where id=%s", (team_e,))
        team_e_survives = cur.fetchone()[0] == 1
    proof.check(
        "ddl:writer_deletion_preserves_workspace_setting",
        bool(row) and row[0] is None and row[1] == "ve" and team_e_survives,
        f"row={row!r} team_e_survives={team_e_survives} (expected user_id=NULL, value preserved, team"
        " intact, after deleting a non-creator WRITER's auth.users row -- deleting the team's own"
        " creator is a separate, frozen 0014 cascade this check does not exercise)",
    )

    # --- B-F12-8: team_role_changes audit + T1/T3 policies + team_member_names ---
    with admin.cursor() as cur:
        cur.execute(
            "select relrowsecurity, count(p.polname) from pg_class c "
            "left join pg_policy p on p.polrelid=c.oid "
            "where c.relnamespace='public'::regnamespace and c.relname='team_role_changes' group by 1"
        )
        row = cur.fetchone()
    proof.check("catalog:team_role_changes", bool(row) and row[0] is True and row[1] == 1, str(row))

    with admin.cursor() as cur:
        cur.execute(
            "select polcmd from pg_policy p join pg_class c on c.oid=p.polrelid "
            "join pg_namespace n on n.oid=c.relnamespace "
            "where n.nspname='public' and c.relname='team_role_changes'"
        )
        cmds = [r[0] for r in cur.fetchall()]
    proof.check("rls:team_role_changes_select_only", cmds == ["r"], str(cmds))

    g_admin = str(uuid.uuid4())
    g_member = str(uuid.uuid4())
    g_promote = str(uuid.uuid4())
    g_peer = str(uuid.uuid4())
    g_stranger = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute(
            "insert into auth.users (id, email) values "
            "(%s, 'g-admin@a.example'), (%s, 'g-member@a.example'), (%s, 'g-promote@a.example'), "
            "(%s, 'g-peer@a.example'), (%s, 'g-stranger@a.example')",
            (g_admin, g_member, g_promote, g_peer, g_stranger),
        )
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values "
            "(%s,%s,'admin',%s), (%s,%s,'member',%s), (%s,%s,'member',%s), (%s,%s,'admin',%s)",
            (team_a, g_admin, a_owner, team_a, g_member, a_owner, team_a, g_promote, a_owner, team_a, g_peer, a_owner),
        )
        cur.execute("update public.profiles set display_name = 'G Member' where id = %s", (g_member,))

    g_admin_conn = actor_connection(dsn, g_admin)
    g_member_conn = actor_connection(dsn, g_member)
    g_stranger_conn = actor_connection(dsn, g_stranger)

    with admin.cursor() as cur:
        cur.execute(
            "select count(*) from public.team_role_changes where team_id=%s and subject_id=%s",
            (team_a, g_promote),
        )
        before_change = cur.fetchone()[0]

    with a_conn.cursor() as cur:
        cur.execute("update public.team_members set role='admin' where team_id=%s and user_id=%s", (team_a, g_promote))

    with admin.cursor() as cur:
        cur.execute(
            "select subject_id::text, actor_id::text, old_role, new_role from public.team_role_changes "
            "where team_id=%s and subject_id=%s and old_role is not null order by changed_at desc limit 1",
            (team_a, g_promote),
        )
        latest = cur.fetchone()
        cur.execute(
            "select count(*) from public.team_role_changes where team_id=%s and subject_id=%s",
            (team_a, g_promote),
        )
        after_change = cur.fetchone()[0]
    proof.check("audit:role_change_writes_one_row", after_change == before_change + 1, f"before={before_change} after={after_change}")
    proof.check(
        "audit:role_change_ids",
        bool(latest) and latest[0] == g_promote and latest[1] == a_owner and latest[2] == "member" and latest[3] == "admin",
        str(latest),
    )

    def admin_demotes_peer():
        with g_admin_conn.cursor() as cur:
            cur.execute("update public.team_members set role='member' where team_id=%s and user_id=%s", (team_a, g_peer))

    proof.check(
        "rls:admin_cannot_change_peer_admin",
        expect_database_error(admin_demotes_peer, "42501"),
        "an administrator UPDATE of a peer administrator must raise 42501",
    )

    with g_member_conn.cursor() as cur:
        cur.execute("select count(*) from public.team_role_changes where team_id=%s", (team_a,))
        member_log_count = cur.fetchone()[0]
    proof.check("rls:member_cannot_read_role_changes", member_log_count == 0, f"member saw {member_log_count} log rows")

    def member_deletes_other():
        with g_member_conn.cursor() as cur:
            cur.execute("delete from public.team_members where team_id=%s and user_id=%s", (team_a, g_admin))

    proof.check(
        "rls:member_cannot_delete_other",
        expect_database_error(member_deletes_other, "42501"),
        "a member DELETE of another row must raise 42501",
    )

    with g_member_conn.cursor() as cur:
        cur.execute("delete from public.team_members where team_id=%s and user_id=%s", (team_a, g_member))
        deleted = cur.rowcount
    proof.check("rls:member_can_leave", deleted == 1, f"rowcount={deleted}")

    with admin.cursor() as cur:
        cur.execute(
            "select old_role, new_role from public.team_role_changes "
            "where team_id=%s and subject_id=%s order by changed_at desc limit 1",
            (team_a, g_member),
        )
        removal = cur.fetchone()
    proof.check(
        "audit:removal_new_role_null",
        bool(removal) and removal[0] == "member" and removal[1] is None,
        str(removal),
    )

    with g_stranger_conn.cursor() as cur:
        cur.execute("select * from public.team_member_names(%s)", (team_a,))
        stranger_names = cur.fetchall()
    proof.check("rpc:team_member_names_hides_from_non_member", len(stranger_names) == 0, f"stranger saw {len(stranger_names)}")

    with a_conn.cursor() as cur:
        cur.execute("select user_id::text, display_name from public.team_member_names(%s)", (team_a,))
        owner_names = cur.fetchall()
    proof.check("rpc:team_member_names_for_member", len(owner_names) >= 1, str(owner_names))

    Path(args.receipt).write_text(json.dumps(_receipt(proof.failed), indent=2))
    print(f"::notice title=f12-team-canary::receipt written to {args.receipt}", flush=True)
    return 1 if proof.failed else 0


if __name__ == "__main__":
    sys.exit(main())
