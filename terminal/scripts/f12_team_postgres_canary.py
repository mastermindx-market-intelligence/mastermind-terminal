#!/usr/bin/env python3
"""Real-Postgres RLS + isolation canary for packets B-F12-3, B-F12-8 and B-F12-9.

Same shape as f12_tenancy_postgres_canary.py: bootstrap a minimal `auth` schema + roles, apply
every migration 0001..0020 in sorted order (0017 is applied when present), then exercise
accept_team_invite, workspace_settings, team_role_changes, team_member_names and
transfer_team_ownership under real actor-scoped connections (RLS is the authority under test,
never application filtering). Emits GitHub annotations at line start with flush=True (fleet law)
and writes a JSON receipt.

Env: F12_TEAM_DATABASE_URL (required), F12_TEAM_EXPECTED_COMMIT/IMAGE/POSTGRES (optional, recorded
only), F12_TEAM_GITHUB_RUN_ID/RUN_ATTEMPT/JOB (optional, recorded only).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import time
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

    def member_writes_workspace_setting():
        with g_member_conn.cursor() as cur:
            cur.execute(
                "insert into public.workspace_settings (scope, team_id, user_id, key, value)"
                " values ('workspace', %s, %s, 'member_k', '\"x\"'::jsonb)",
                (team_a, g_member),
            )

    proof.check(
        "rls:member_cannot_write_workspace_setting",
        expect_database_error(member_writes_workspace_setting, "42501"),
        "a member INSERT into workspace_settings must raise 42501",
    )

    def admin_invites_admin():
        with g_admin_conn.cursor() as cur:
            cur.execute(
                "insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at)"
                " values (%s,'peer-admin@a.example','admin',%s,%s, now() + interval '14 days')",
                (team_a, hashlib.sha256(b"admininvite").hexdigest(), g_admin),
            )

    proof.check(
        "rls:admin_cannot_invite_admin",
        expect_database_error(admin_invites_admin, "42501"),
        "an administrator INSERT of an admin-role invite must raise 42501",
    )

    with a_conn.cursor() as cur:
        cur.execute(
            "insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at)"
            " values (%s,'ok-admin@a.example','admin',%s,%s, now() + interval '14 days')",
            (team_a, hashlib.sha256(b"owneradmininvite").hexdigest(), a_owner),
        )
        owner_invite_count = cur.rowcount
    proof.check("rls:owner_can_invite_admin", owner_invite_count == 1, f"rowcount={owner_invite_count}")

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

    # Round-4 ruling R1: a membership row never moves between teams or between people.
    # rls:admin_cannot_change_peer_admin above stays INSIDE one team, so it never reached the hole
    # the round-3 review found: USING is evaluated on the OLD row and WITH CHECK on the NEW one, so
    # public.team_role(team_id) reads the SOURCE team in one and the DESTINATION team in the other.
    # An administrator of team A who owns any team B could therefore UPDATE a peer administrator's
    # row out of A by setting team_id = B -- and because the audit trigger fires `of role`, that
    # removal wrote no log row at all. 0019's BEFORE UPDATE trigger deny_team_member_move is what
    # closes it. Both moves get a case: an administrator moving a PEER ADMINISTRATOR into a team
    # the attacker owns, and the team owner moving any row out of their own team.
    with admin.cursor() as cur:
        cur.execute(
            "insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Team H', %s) returning id",
            (g_admin,),
        )
        team_h = cur.fetchone()[0]
        cur.execute(
            "insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Team I', %s) returning id",
            (a_owner,),
        )
        team_i = cur.fetchone()[0]
        cur.execute("select count(*) from public.team_role_changes where subject_id=%s", (g_peer,))
        peer_log_before = cur.fetchone()[0]

    def admin_moves_peer_admin_across_teams():
        with g_admin_conn.cursor() as cur:
            cur.execute(
                "update public.team_members set team_id=%s where team_id=%s and user_id=%s",
                (team_h, team_a, g_peer),
            )

    peer_move_raised = expect_database_error(admin_moves_peer_admin_across_teams, "42501")
    with admin.cursor() as cur:
        cur.execute("select team_id::text, role from public.team_members where user_id=%s", (g_peer,))
        peer_rows = cur.fetchall()
        cur.execute("select count(*) from public.team_role_changes where subject_id=%s", (g_peer,))
        peer_log_after = cur.fetchone()[0]
    proof.check(
        "rls:admin_cannot_move_peer_admin_across_teams",
        peer_move_raised
        and peer_rows == [(str(team_a), "admin")]
        and peer_log_after == peer_log_before,
        f"raised42501={peer_move_raised} rows={peer_rows!r} (expected the row still in team A as"
        f" admin) log_before={peer_log_before} log_after={peer_log_after} (expected equal: a"
        " team_id-only UPDATE writes no audit row, so a successful move would be invisible)",
    )

    def owner_moves_row_across_teams():
        with a_conn.cursor() as cur:
            cur.execute(
                "update public.team_members set team_id=%s where team_id=%s and user_id=%s",
                (team_i, team_a, g_member),
            )

    owner_move_raised = expect_database_error(owner_moves_row_across_teams, "42501")
    with admin.cursor() as cur:
        cur.execute("select team_id::text, role from public.team_members where user_id=%s", (g_member,))
        member_rows = cur.fetchall()
    proof.check(
        "rls:owner_cannot_move_row_across_teams",
        owner_move_raised and member_rows == [(str(team_a), "member")],
        f"raised42501={owner_move_raised} rows={member_rows!r} (expected the row still in team A"
        " as member; the owner of both teams passes USING and WITH CHECK, so only the trigger"
        " stops the move)",
    )

    # Round-4 ruling R4(d): tm_delete_admin's raising ELSE must not become a membership oracle.
    # A caller who is not a member of the team gets a plain 0-row miss -- the behaviour before
    # 0019 -- so 42501 vs 0 rows cannot be used to test whether a membership row exists.
    stranger_delete_raised = False
    stranger_deleted = None
    try:
        with g_stranger_conn.cursor() as cur:
            cur.execute("delete from public.team_members where team_id=%s and user_id=%s", (team_a, g_member))
            stranger_deleted = cur.rowcount
    except psycopg.Error as exc:  # type: ignore[attr-defined]
        stranger_delete_raised = True
        stranger_deleted = getattr(exc.diag, "sqlstate", None) if hasattr(exc, "diag") else "error"
    proof.check(
        "rls:stranger_delete_is_silent",
        (not stranger_delete_raised) and stranger_deleted == 0,
        f"raised={stranger_delete_raised} rowcount_or_sqlstate={stranger_deleted!r} (a non-member"
        " must get a silent 0-row miss, never 42501)",
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

    # Round-6 ruling R9(8): owner-row DELETE is refused. tm_delete_admin's first
    # CASE arm (`role = 'owner' then false`) is a USING miss, so this is a silent
    # 0-row result, not 42501; the owner row must still be there afterwards.
    owner_row_delete_raised = False
    owner_row_deleted = None
    try:
        with a_conn.cursor() as cur:
            cur.execute("delete from public.team_members where team_id=%s and user_id=%s", (team_a, a_owner))
            owner_row_deleted = cur.rowcount
    except psycopg.Error as exc:  # type: ignore[attr-defined]
        owner_row_delete_raised = True
        owner_row_deleted = getattr(exc.diag, "sqlstate", None) if hasattr(exc, "diag") else "error"
    with admin.cursor() as cur:
        cur.execute(
            "select count(*) from public.team_members where team_id=%s and user_id=%s and role='owner'",
            (team_a, a_owner),
        )
        owner_row_still = cur.fetchone()[0] == 1
    proof.check(
        "rls:owner_row_delete_is_refused",
        (not owner_row_delete_raised) and owner_row_deleted == 0 and owner_row_still,
        f"raised={owner_row_delete_raised} rowcount_or_sqlstate={owner_row_deleted!r}"
        f" owner_row_still={owner_row_still} (the owner row must survive; a USING miss is a"
        " silent 0-row, not 42501)",
    )

    # Round-6 ruling R9(8): a user_id-only UPDATE is refused. Round-4's
    # rls:owner_cannot_move_row_across_teams covers team_id; this covers the
    # other column deny_team_member_move pins.
    def owner_rewrites_user_id():
        with a_conn.cursor() as cur:
            cur.execute(
                "update public.team_members set user_id=%s where team_id=%s and user_id=%s",
                (g_stranger, team_a, g_promote),
            )

    uid_move_raised = expect_database_error(owner_rewrites_user_id, "42501")
    with admin.cursor() as cur:
        cur.execute(
            "select user_id::text, role from public.team_members where team_id=%s and user_id=%s",
            (team_a, g_promote),
        )
        promote_rows = cur.fetchall()
    proof.check(
        "rls:user_id_only_move_is_refused",
        uid_move_raised and promote_rows == [(g_promote, "admin")],
        f"raised42501={uid_move_raised} rows={promote_rows!r} (expected the row still on"
        " g_promote as admin; rewriting user_id would move a membership between people)",
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

    # Round-6 ruling R2: deleting a team creator's auth.users row must complete.
    # Creator + one other living member; after the delete, the team, its
    # memberships and its role-change rows are gone and no error was raised.
    # Against 0019 before the team-FK guard this raised:
    #   insert or update on table "team_role_changes" violates foreign key
    #   constraint "team_role_changes_team_id_fkey"
    c_creator = str(uuid.uuid4())
    c_living = str(uuid.uuid4())
    creator_delete_error = None
    with admin.cursor() as cur:
        cur.execute(
            "insert into auth.users (id, email) values (%s, 'creator@c.example'), (%s, 'living@c.example')",
            (c_creator, c_living),
        )
        cur.execute(
            "insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Team C', %s) returning id",
            (c_creator,),
        )
        team_c = cur.fetchone()[0]
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values (%s,%s,'member',%s)",
            (team_c, c_living, c_creator),
        )
        try:
            cur.execute("delete from auth.users where id=%s", (c_creator,))
        except psycopg.Error as exc:  # type: ignore[attr-defined]
            diag = getattr(exc, "diag", None)
            creator_delete_error = (getattr(diag, "message_primary", None) if diag else None) or str(exc)
        cur.execute("select count(*) from public.teams where id=%s", (team_c,))
        team_c_gone = cur.fetchone()[0] == 0
        cur.execute("select count(*) from public.team_members where team_id=%s", (team_c,))
        memberships_gone = cur.fetchone()[0] == 0
        cur.execute("select count(*) from public.team_role_changes where team_id=%s", (team_c,))
        role_change_rows_gone = cur.fetchone()[0] == 0
        cur.execute("select count(*) from auth.users where id=%s", (c_creator,))
        creator_gone = cur.fetchone()[0] == 0
    proof.check(
        "rls:creator_account_deletion_completes",
        creator_delete_error is None and team_c_gone and memberships_gone and role_change_rows_gone and creator_gone,
        f"error={creator_delete_error!r} team_gone={team_c_gone} memberships_gone={memberships_gone}"
        f" role_change_rows_gone={role_change_rows_gone} creator_gone={creator_gone}",
    )

    # --- B-F12-9: transfer_team_ownership (atomic demote-then-promote) ---
    with admin.cursor() as cur:
        cur.execute(
            "select prosecdef, pg_get_function_identity_arguments(oid) from pg_proc "
            "where pronamespace='public'::regnamespace and proname='transfer_team_ownership'"
        )
        row = cur.fetchone()
    proof.check(
        "helper:transfer_team_ownership",
        bool(row) and row[0] is True and row[1] == "p_team uuid, p_new_owner_user_id uuid",
        str(row),
    )

    t_owner = str(uuid.uuid4())
    t_admin = str(uuid.uuid4())
    t_member = str(uuid.uuid4())
    t_stranger = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute(
            "insert into auth.users (id, email) values "
            "(%s, 't-owner@a.example'), (%s, 't-admin@a.example'), (%s, 't-member@a.example'), (%s, 't-stranger@a.example')",
            (t_owner, t_admin, t_member, t_stranger),
        )
        cur.execute(
            "insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Team Transfer', %s) returning id",
            (t_owner,),
        )
        team_t = cur.fetchone()[0]
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values (%s,%s,'admin',%s), (%s,%s,'member',%s)",
            (team_t, t_admin, t_owner, team_t, t_member, t_owner),
        )
        # Count the same population the after-read uses: UPDATE/DELETE log rows
        # (old_role is not null). INSERT trigger rows (owner/admin/member, old_role
        # NULL) must not be in this number — CI run 34394270728 failed 2 >= 3+2.
        cur.execute(
            "select count(*) from public.team_role_changes where team_id=%s and old_role is not null",
            (team_t,),
        )
        audit_before = cur.fetchone()[0]

    t_owner_conn = actor_connection(dsn, t_owner)
    t_admin_conn = actor_connection(dsn, t_admin)
    t_member_conn = actor_connection(dsn, t_member)

    # Server-side elapsed for the transfer statement. The function takes
    # pg_advisory_xact_lock and holds it until this autocommit xact ends, so this
    # is the lock-hold upper bound excluding client RTT (Risk 5).
    with t_owner_conn.cursor() as cur:
        cur.execute(
            """
            select x.success, x.message,
                   extract(epoch from (clock_timestamp() - s.t0)) * 1000
              from (select clock_timestamp() as t0) s
              cross join lateral (
                select success, message
                  from public.transfer_team_ownership(%s, %s)
              ) x
            """,
            (team_t, t_admin),
        )
        xfer = cur.fetchone()
    lock_hold_ms = float(xfer[2]) if xfer and xfer[2] is not None else -1.0
    proof.check("rpc:transfer_success", bool(xfer) and xfer[0] is True and xfer[1] == "transfer_success", str(xfer[:2] if xfer else xfer))

    with admin.cursor() as cur:
        cur.execute("select user_id::text, role from public.team_members where team_id=%s order by role, user_id::text", (team_t,))
        roles = cur.fetchall()
        cur.execute(
            "select old_role, new_role, actor_id::text from public.team_role_changes "
            "where team_id=%s and old_role is not null order by changed_at, id",
            (team_t,),
        )
        audit_rows = cur.fetchall()
        cur.execute("select count(*) from public.team_members where team_id=%s and role='owner'", (team_t,))
        owner_n = cur.fetchone()[0]
    proof.check(
        "rpc:transfer_roles_swapped",
        owner_n == 1
        and (str(t_admin), "owner") in roles
        and (str(t_owner), "admin") in roles,
        str(roles),
    )
    demote = ("owner", "admin", t_owner)
    promote = ("admin", "owner", t_owner)
    proof.check(
        "audit:transfer_writes_two_rows",
        audit_rows.count(demote) >= 1 and audit_rows.count(promote) >= 1 and len(audit_rows) == audit_before + 2,
        f"audit={audit_rows!r} before={audit_before}",
    )
    proof.check("rpc:transfer_lock_hold_ms", 0 < lock_hold_ms < 60_000, f"lock_hold_ms={lock_hold_ms:.3f}")

    t_admin_conn.close()
    t_admin_conn = actor_connection(dsn, t_admin)
    with t_admin_conn.cursor() as cur:
        cur.execute("select success, message from public.transfer_team_ownership(%s, %s)", (team_t, t_owner))
        back = cur.fetchone()
    proof.check("rpc:transfer_reversible", bool(back) and back[0] is True and back[1] == "transfer_success", str(back))

    with t_owner_conn.cursor() as cur:
        cur.execute("select success, message from public.transfer_team_ownership(%s, %s)", (team_t, t_member))
        member_jump = cur.fetchone()
    proof.check(
        "rpc:transfer_member_refused",
        bool(member_jump) and member_jump[0] is False and member_jump[1] == "transfer_requires_admin",
        str(member_jump),
    )

    with t_admin_conn.cursor() as cur:
        cur.execute("select success, message from public.transfer_team_ownership(%s, %s)", (team_t, t_owner))
        admin_call = cur.fetchone()
    proof.check(
        "rpc:transfer_admin_owner_only",
        bool(admin_call) and admin_call[0] is False and admin_call[1] == "owner_only",
        str(admin_call),
    )

    with t_owner_conn.cursor() as cur:
        cur.execute("select success, message from public.transfer_team_ownership(%s, %s)", (team_t, t_owner))
        self_call = cur.fetchone()
        cur.execute("select success, message from public.transfer_team_ownership(%s, %s)", (team_t, t_stranger))
        missing = cur.fetchone()
        missing_team = str(uuid.uuid4())
        cur.execute("select success, message from public.transfer_team_ownership(%s, %s)", (missing_team, t_admin))
        no_team = cur.fetchone()
    proof.check("rpc:transfer_same_owner", bool(self_call) and self_call[1] == "same_owner", str(self_call))
    proof.check("rpc:transfer_not_on_team", bool(missing) and missing[1] == "not_on_team", str(missing))
    proof.check("rpc:transfer_team_not_found", bool(no_team) and no_team[1] == "team_not_found", str(no_team))

    c_owner = str(uuid.uuid4())
    c_admin = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute(
            "insert into auth.users (id, email) values (%s, 'c-owner@a.example'), (%s, 'c-admin@a.example')",
            (c_owner, c_admin),
        )
        cur.execute(
            "insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Team Concurrent', %s) returning id",
            (c_owner,),
        )
        team_c = cur.fetchone()[0]
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values (%s,%s,'admin',%s)",
            (team_c, c_admin, c_owner),
        )

    barrier = threading.Barrier(3)
    boxes: list[dict] = [{}, {}]

    def _xfer_thread(idx: int) -> None:
        conn = actor_connection(dsn, c_owner)
        barrier.wait()
        t_start = time.perf_counter()
        try:
            with conn.cursor() as cur:
                cur.execute("select success, message from public.transfer_team_ownership(%s, %s)", (team_c, c_admin))
                boxes[idx] = {"row": cur.fetchone(), "ms": (time.perf_counter() - t_start) * 1000}
        except Exception as exc:  # noqa: BLE001 - canary records the exception
            boxes[idx] = {"error": str(exc), "ms": (time.perf_counter() - t_start) * 1000}
        finally:
            conn.close()

    threads = [threading.Thread(target=_xfer_thread, args=(0,)), threading.Thread(target=_xfer_thread, args=(1,))]
    blocker = psycopg.connect(dsn, autocommit=False)
    with blocker.cursor() as cur:
        cur.execute("select pg_advisory_xact_lock(hashtext(%s::text))", (str(team_c),))
    for thread in threads:
        thread.start()
    barrier.wait()
    time.sleep(0.15)
    blocker.commit()
    blocker.close()
    for thread in threads:
        thread.join(timeout=15)

    outcomes = [b.get("row") for b in boxes]
    successes = [r for r in outcomes if r and r[0] is True]
    conflicts = [r for r in outcomes if r and r[0] is False and r[1] == "conflict"]
    with admin.cursor() as cur:
        cur.execute("select count(*) from public.team_members where team_id=%s and role='owner'", (team_c,))
        concurrent_owners = cur.fetchone()[0]
        cur.execute("select user_id::text from public.team_members where team_id=%s and role='owner'", (team_c,))
        concurrent_owner_id = cur.fetchone()[0]
    proof.check(
        "rpc:transfer_concurrent_serializes",
        len(successes) == 1 and len(conflicts) == 1 and concurrent_owners == 1 and concurrent_owner_id == c_admin,
        f"outcomes={outcomes!r} owners={concurrent_owners} owner_id={concurrent_owner_id} boxes={boxes!r}",
    )

    receipt = _receipt(proof.failed)
    receipt["lock_hold_ms"] = round(lock_hold_ms, 3)
    Path(args.receipt).write_text(json.dumps(receipt, indent=2))
    print(f"::notice title=f12-team-canary::lock_hold_ms={lock_hold_ms:.3f}", flush=True)
    print(f"::notice title=f12-team-canary::receipt written to {args.receipt}", flush=True)
    return 1 if proof.failed else 0


if __name__ == "__main__":
    sys.exit(main())
