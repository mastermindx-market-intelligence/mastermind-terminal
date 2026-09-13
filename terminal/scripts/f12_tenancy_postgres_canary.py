#!/usr/bin/env python3
"""F12 tenancy-foundation RLS canary.

Applies every supabase/migrations/*.sql file (in filename order) to a scratch Postgres 16
database, bootstraps a minimal auth.* shim (auth.users, auth.uid() from a JWT-claim GUC), seeds
three users A/B/C, and asserts the RLS/trigger/recursion-guard contract that
0014_tenancy_foundation.sql claims. Mirrors the shape of PR #502's
terminal/scripts/f11_thesis_postgres_canary.py (Proof class, env(), actor_connection(),
admin_row(), expect_database_error(), bootstrap()) for the tenancy tables instead of theses.

This script APPLIES migrations to a throwaway CI database only. It is never a substitute for the
manual, out-of-band operator application described in supabase/migrations/README.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import uuid
from pathlib import Path

import psycopg
from psycopg import sql


class Proof:
    def __init__(self) -> None:
        self.assertions = 0
        self.verdicts: dict[str, str] = {}

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.assertions += 1
        if condition:
            self.verdicts[name] = "pass"
        else:
            self.verdicts[name] = f"FAIL: {detail}"
            print(f"::error title=f12-canary::{name} failed: {detail}", flush=True)
            raise SystemExit(1)


def env(name: str, required: bool = True, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        print(f"::error title=f12-canary::missing required env {name}", flush=True)
        raise SystemExit(1)
    return value or ""


def admin_connection(dsn: str) -> psycopg.Connection:
    conn = psycopg.connect(dsn, autocommit=True)
    return conn


def actor_connection(dsn: str, user_id: str | None) -> psycopg.Connection:
    """A connection acting as `authenticated` (or `anon` when user_id is None), with
    request.jwt.claim.sub set so auth.uid() resolves inside SECURITY DEFINER helpers."""
    conn = psycopg.connect(dsn, autocommit=True)
    with conn.cursor() as cur:
        if user_id:
            cur.execute("set role authenticated")
            cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))
        else:
            cur.execute("set role anon")
    return conn


def admin_row(conn: psycopg.Connection, query: str, params: tuple = ()) -> tuple | None:
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchone()


def expect_database_error(fn, sqlstate: str | None = None) -> bool:
    """Runs `fn`, returning True only when it raises a `psycopg.Error`. When `sqlstate` is given,
    the raised error's SQLSTATE must match exactly — a negative probe that raises the WRONG error
    (e.g. a typo instead of a permission denial) must not read as a pass."""
    try:
        fn()
    except psycopg.Error as exc:
        if sqlstate is None:
            return True
        return getattr(exc, "sqlstate", None) == sqlstate
    return False


def bootstrap(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("create schema if not exists auth")
        cur.execute("create schema if not exists extensions")
        cur.execute("create extension if not exists pgcrypto with schema extensions")
        # raw_user_meta_data: 0001_init.sql's on_auth_user_created trigger (handle_new_user)
        # reads new.raw_user_meta_data->>'name' on every insert into auth.users, so migration
        # replay dies with UndefinedColumn before ever reaching 0014 unless the mock table carries
        # the same column real Supabase auth.users has.
        cur.execute(
            "create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb)"
        )
        cur.execute(
            """
            create or replace function auth.uid() returns uuid
              language sql stable as $$
              select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
            $$
            """
        )
        cur.execute("do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;")
        cur.execute("do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;")
        # service_role: 0006_lock_is_pro.sql and 0010_search_event_stats.sql (master) both
        # reference it (0010 grants execute on search_event_stats() to it), so migration replay
        # fails with UndefinedObject before ever reaching 0014 unless it exists here too. Real
        # Supabase project service_role is nologin + bypassrls; mirror both attributes.
        cur.execute("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end $$;")
        cur.execute("grant usage on schema public, auth to anon, authenticated")
        cur.execute("grant select on auth.users to anon, authenticated")


def apply_migrations(conn: psycopg.Connection, migrations_dir: Path) -> list[dict]:
    applied = []
    for path in sorted(migrations_dir.glob("*.sql")):
        text = path.read_text()
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        with conn.cursor() as cur:
            cur.execute(text)
        applied.append({"file": path.name, "sha256": digest})
    return applied


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()

    dsn = env("F12_DATABASE_URL")
    proof = Proof()

    admin = admin_connection(dsn)
    bootstrap(admin)
    applied = apply_migrations(admin, Path(args.migrations))

    # Seed four users A/B/C/X. X is never added to any team by an ordinary path — it exists only
    # as the target of the BLOCKER-1 insert-mints-an-owner probe below.
    user_ids: dict[str, str] = {}
    for label in ("a", "b", "c", "x"):
        row = admin_row(admin, "insert into auth.users default values returning id")
        user_ids[label] = str(row[0])

    # 1. catalog: owner + RLS enabled
    for table in ("teams", "team_members", "team_invites"):
        row = admin_row(
            admin,
            "select relowner::regrole::text, relrowsecurity from pg_class where relname = %s and relnamespace = 'public'::regnamespace",
            (table,),
        )
        proof.check(f"catalog:{table}", row is not None and row[0] == "postgres" and row[1] is True, f"{table} row={row}")

    # 2. helper functions: security definer + search_path, no user-id arg
    for fn in ("is_team_member", "team_role"):
        row = admin_row(
            admin,
            """
            select prosecdef, proconfig, pg_get_function_identity_arguments(oid)
              from pg_proc where proname = %s and pronamespace = 'public'::regnamespace
            """,
            (fn,),
        )
        ok = (
            row is not None
            and row[0] is True
            and row[1] is not None
            and any("search_path=pg_catalog, public, auth" in c for c in row[1])
            and row[2].strip() == "p_team uuid"
        )
        proof.check(f"helper:{fn}", ok, f"row={row}")

    conn_a = actor_connection(dsn, user_ids["a"])
    conn_b = actor_connection(dsn, user_ids["b"])
    conn_anon = actor_connection(dsn, None)

    # 3. A creates a team -> exactly one team_members row, role owner
    team_id = None
    with conn_a.cursor() as cur:
        cur.execute(
            "insert into public.teams (name, created_by) values (%s, %s) returning id",
            ("A-desk", user_ids["a"]),
        )
        team_id = cur.fetchone()[0]
    row = admin_row(
        admin,
        "select count(*), max(role), max(user_id::text) from public.team_members where team_id = %s",
        (team_id,),
    )
    proof.check("trigger:owner", row == (1, "owner", user_ids["a"]), f"row={row}")

    # 4. B cannot read A's team or membership rows
    with conn_b.cursor() as cur:
        cur.execute("select * from public.teams")
        proof.check("rls:b_cannot_read_teams", len(cur.fetchall()) == 0, "B saw A's teams")
        cur.execute("select * from public.team_members where team_id = %s", (team_id,))
        proof.check("rls:b_cannot_read_members", len(cur.fetchall()) == 0, "B saw A's membership rows")

    # 5/6. B cannot insert into team_members / teams for A's team
    def b_insert_member():
        with conn_b.cursor() as cur:
            cur.execute(
                "insert into public.team_members (team_id, user_id, role) values (%s, %s, 'member')",
                (team_id, user_ids["b"]),
            )

    proof.check("rls:b_cannot_insert_member", expect_database_error(b_insert_member), "insert did not raise")

    def b_insert_team_as_a():
        with conn_b.cursor() as cur:
            cur.execute(
                "insert into public.teams (name, created_by) values (%s, %s)",
                ("spoofed", user_ids["a"]),
            )

    proof.check("rls:b_cannot_insert_team_as_a", expect_database_error(b_insert_team_as_a), "insert did not raise")

    # 7. A adds B as member; B can now read; B (member) adding C raises
    with conn_a.cursor() as cur:
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values (%s, %s, 'member', %s)",
            (team_id, user_ids["b"], user_ids["a"]),
        )
    with conn_b.cursor() as cur:
        cur.execute("select * from public.teams where id = %s", (team_id,))
        proof.check("rls:b_can_read_after_join", len(cur.fetchall()) == 1, "B still cannot read after joining")

    def b_member_adds_c():
        with conn_b.cursor() as cur:
            cur.execute(
                "insert into public.team_members (team_id, user_id, role) values (%s, %s, 'member')",
                (team_id, user_ids["c"]),
            )

    proof.check("rls:member_cannot_add", expect_database_error(b_member_adds_c), "member insert did not raise")

    # 8. A promotes B to admin; B adds C -> succeeds
    with conn_a.cursor() as cur:
        cur.execute(
            "update public.team_members set role = 'admin' where team_id = %s and user_id = %s",
            (team_id, user_ids["b"]),
        )
    with conn_b.cursor() as cur:
        cur.execute(
            "insert into public.team_members (team_id, user_id, role) values (%s, %s, 'member')",
            (team_id, user_ids["c"]),
        )
    row = admin_row(
        admin,
        "select count(*) from public.team_members where team_id = %s and user_id = %s",
        (team_id, user_ids["c"]),
    )
    proof.check("rls:admin_can_add", row == (1,), f"row={row}")

    # 8b. M1: admin (B) cannot self-promote to owner. tm_update_admin's WITH CHECK restricts the
    # new role to admin/member only — owner transfer is out of scope for V1. Pinned to the exact
    # SQLSTATE (42501 InsufficientPrivilege, the RLS WITH CHECK violation code) so a typo or an
    # unrelated error would not misread as a pass (round-4 ruling m2).
    def b_admin_self_promotes():
        with conn_b.cursor() as cur:
            cur.execute(
                "update public.team_members set role = 'owner' where team_id = %s and user_id = %s",
                (team_id, user_ids["b"]),
            )

    proof.check(
        "rls:admin_cannot_self_promote",
        expect_database_error(b_admin_self_promotes, sqlstate="42501"),
        "admin self-promotion to owner did not raise 42501 InsufficientPrivilege",
    )

    # 8c. BLOCKER-1 (ruling r2): admin (B) cannot mint a NEW owner row by INSERTing role='owner'
    # for a different account (X, who is not on the team at all). tm_insert_admin's WITH CHECK
    # restricts the written role to admin/member, so this INSERT raises a WITH CHECK violation
    # (42501) — but assert on EFFECT too (an admin-connection re-read), not only on the exception,
    # since that is the stronger and more future-proof proof the ruling asks for.
    def b_admin_inserts_owner_for_x():
        with conn_b.cursor() as cur:
            cur.execute(
                "insert into public.team_members (team_id, user_id, role) values (%s, %s, 'owner')",
                (team_id, user_ids["x"]),
            )

    insert_owner_raised = expect_database_error(b_admin_inserts_owner_for_x, sqlstate="42501")
    row = admin_row(
        admin,
        "select count(*) filter (where role = 'owner') as owners, "
        "count(*) filter (where user_id = %s and role = 'owner') as x_is_owner "
        "from public.team_members where team_id = %s",
        (user_ids["x"], team_id),
    )
    proof.check(
        "rls:admin_cannot_insert_owner",
        insert_owner_raised and row == (1, 0),
        f"insert_raised_42501={insert_owner_raised}, (owner_count, x_is_owner)={row} (want (1, 0))",
    )

    # 8d. M1/B2: admin (B) cannot demote the owner (A). tm_update_admin's USING clause is a row
    # filter, not a check — a Postgres RLS USING clause on UPDATE silently excludes the non-
    # matching row instead of raising, so this must be asserted on EFFECT (RETURNING is empty, and
    # a follow-up admin-connection SELECT shows A's row unchanged), never via expect_database_error.
    with conn_b.cursor() as cur:
        cur.execute(
            "update public.team_members set role = 'member' where team_id = %s and user_id = %s returning id",
            (team_id, user_ids["a"]),
        )
        demote_returned = cur.fetchall()
    row = admin_row(
        admin,
        "select role from public.team_members where team_id = %s and user_id = %s",
        (team_id, user_ids["a"]),
    )
    proof.check(
        "rls:admin_cannot_demote_owner",
        demote_returned == [] and row == ("owner",),
        f"admin demoting the owner affected rows={demote_returned}, owner row after={row}",
    )

    # 8e. M1/B2: admin (B) cannot delete the owner (A)'s membership row. tm_delete_admin's USING
    # clause is likewise a silent row filter on DELETE — assert 0 rows returned and the row still
    # present afterward, not that an exception was raised.
    with conn_b.cursor() as cur:
        cur.execute(
            "delete from public.team_members where team_id = %s and user_id = %s returning id",
            (team_id, user_ids["a"]),
        )
        delete_returned = cur.fetchall()
    row = admin_row(
        admin,
        "select count(*) from public.team_members where team_id = %s and user_id = %s",
        (team_id, user_ids["a"]),
    )
    proof.check(
        "rls:admin_cannot_delete_owner",
        delete_returned == [] and row == (1,),
        f"admin deleting the owner affected rows={delete_returned}, owner row count after={row}",
    )

    # 8f. MAJOR-1 (ruling r2): the owner (A) cannot demote THEMSELVES either — round-2's SQL let
    # the owner through a disjunct in tm_update_admin's USING clause; round 4 removes it, so this
    # UPDATE is now filtered for everyone, owner included. Assert on EFFECT for the same silent-
    # row-filter reason as 8d/8e: RETURNING is empty and the row is unchanged afterward.
    with conn_a.cursor() as cur:
        cur.execute(
            "update public.team_members set role = 'member' where team_id = %s and user_id = %s returning id",
            (team_id, user_ids["a"]),
        )
        self_demote_returned = cur.fetchall()
    row = admin_row(
        admin,
        "select role from public.team_members where team_id = %s and user_id = %s",
        (team_id, user_ids["a"]),
    )
    proof.check(
        "rls:owner_cannot_self_demote",
        self_demote_returned == [] and row == ("owner",),
        f"owner self-demote affected rows={self_demote_returned}, owner row after={row}",
    )

    # 9. anon: no privilege at all on any tenancy table (0014 revokes all from anon and grants
    # nothing back), so every select/insert must raise 42501 InsufficientPrivilege specifically —
    # any other error would be a false pass (B2).
    def anon_select(table: str):
        with conn_anon.cursor() as cur:
            cur.execute(sql.SQL("select * from public.{}").format(sql.Identifier(table)))

    for table in ("teams", "team_members", "team_invites"):
        proof.check(
            f"anon:select_{table}",
            expect_database_error(lambda t=table: anon_select(t), sqlstate="42501"),
            f"anon select on {table} did not raise 42501 InsufficientPrivilege",
        )

    def anon_insert():
        with conn_anon.cursor() as cur:
            cur.execute(
                "insert into public.teams (name, created_by) values (%s, %s)",
                ("anon-team", user_ids["a"]),
            )

    proof.check(
        "anon:insert_raises",
        expect_database_error(anon_insert, sqlstate="42501"),
        "anon insert did not raise 42501 InsufficientPrivilege",
    )

    # 10. non-admin member cannot select team_invites; token_hash uniqueness rejects duplicate
    with conn_a.cursor() as cur:
        cur.execute(
            "insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at) values (%s, %s, 'member', %s, %s, now() + interval '14 days')",
            (team_id, "invitee@example.com", "deadbeef" * 8, user_ids["a"]),
        )
    # C is still a plain member (added at step 8) — a member, unlike admin/owner, must not see
    # team_invites at all.
    conn_c = actor_connection(dsn, user_ids["c"])
    with conn_c.cursor() as cur:
        cur.execute("select * from public.team_invites where team_id = %s", (team_id,))
        proof.check("rls:member_cannot_read_invites", len(cur.fetchall()) == 0, "member read invites")

    # 10b. M1: the owner (A) CAN change a member (C) to admin — the update policy only blocks
    # the *new* role from being 'owner' and blocks touching rows whose *current* role is 'owner';
    # member -> admin by the owner is squarely inside what should still work.
    with conn_a.cursor() as cur:
        cur.execute(
            "update public.team_members set role = 'admin' where team_id = %s and user_id = %s",
            (team_id, user_ids["c"]),
        )
    row = admin_row(
        admin,
        "select role from public.team_members where team_id = %s and user_id = %s",
        (team_id, user_ids["c"]),
    )
    proof.check("rls:owner_can_promote_member_to_admin", row == ("admin",), f"row={row}")

    def dup_token():
        with conn_a.cursor() as cur:
            cur.execute(
                "insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at) values (%s, %s, 'member', %s, %s, now() + interval '14 days')",
                (team_id, "other@example.com", "deadbeef" * 8, user_ids["a"]),
            )

    proof.check("unique:token_hash", expect_database_error(dup_token), "duplicate token_hash did not raise")

    # 11. no 42P17: RLS recursion is avoided because is_team_member/team_role are SECURITY DEFINER
    # (they bypass RLS internally instead of re-entering the policies that call them). Probe the
    # actual property in pg_proc rather than merely observing that earlier statements didn't raise.
    row = admin_row(
        admin,
        "select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
        "where n.nspname = 'public' and p.proname = 'is_team_member'",
    )
    proof.check("no_recursion", row == (True,), f"is_team_member not security definer: row={row}")

    # 12. re-runnability: apply 0014 a second time
    row_counts_before = admin_row(
        admin,
        "select (select count(*) from public.teams), (select count(*) from public.team_members), (select count(*) from public.team_invites)",
    )
    tenancy_file = Path(args.migrations) / "0014_tenancy_foundation.sql"
    with admin.cursor() as cur:
        cur.execute(tenancy_file.read_text())
    row_counts_after = admin_row(
        admin,
        "select (select count(*) from public.teams), (select count(*) from public.team_members), (select count(*) from public.team_invites)",
    )
    proof.check("rerun:idempotent", row_counts_before == row_counts_after, f"{row_counts_before} != {row_counts_after}")

    receipt = {
        "schema": "mastermind.f12-tenancy-canary/v1",
        "commit": env("F12_EXPECTED_COMMIT", required=False, default=""),
        "image": env("F12_EXPECTED_IMAGE", required=False, default=""),
        "postgres_version": env("F12_EXPECTED_POSTGRES", required=False, default=""),
        "migrations": applied,
        "assertions": proof.assertions,
        "verdicts": proof.verdicts,
        "run_id": env("F12_GITHUB_RUN_ID", required=False, default=""),
        "run_attempt": env("F12_GITHUB_RUN_ATTEMPT", required=False, default=""),
        "job": env("F12_GITHUB_JOB", required=False, default=""),
    }
    Path(args.receipt).write_text(json.dumps(receipt, indent=2))
    print(f"::notice title=f12-canary::{proof.assertions} assertions passed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
