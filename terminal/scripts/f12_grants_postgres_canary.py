#!/usr/bin/env python3
"""Real-Postgres RLS canary for packet B-F12-B5-1 (0021_resource_grants.sql).

Same shape as f12_team_postgres_canary.py: bootstrap a minimal `auth` schema + roles, apply
every migration 0001..0021 in sorted order, then exercise explicit grants under real
actor-scoped connections (RLS is the authority under test, never application filtering).
Emits GitHub annotations at line start with flush=True and writes a JSON receipt.

Env: F12_GRANTS_DATABASE_URL (required), F12_GRANTS_EXPECTED_COMMIT/IMAGE/POSTGRES (optional,
recorded only), F12_GRANTS_GITHUB_RUN_ID/RUN_ATTEMPT/JOB (optional, recorded only).
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
    print("::error title=f12-grants-canary::psycopg is not installed", flush=True)
    raise


class Proof:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.failed = False

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.rows.append({"name": name, "ok": bool(condition), "detail": detail})
        if not condition:
            self.failed = True
            print(f"::error title=f12-grants-canary::FAILED {name} {detail}", flush=True)
        else:
            print(f"::notice title=f12-grants-canary::ok {name}", flush=True)


def env(name: str, required: bool = True, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        print(f"::error title=f12-grants-canary::missing required env {name}", flush=True)
        raise SystemExit(2)
    return val or ""


def admin_connection(dsn: str) -> "psycopg.Connection":
    return psycopg.connect(dsn, autocommit=True)


def actor_connection(dsn: str, user_id: str | None) -> "psycopg.Connection":
    conn = psycopg.connect(dsn, autocommit=True)
    with conn.cursor() as cur:
        if user_id:
            cur.execute(
                "select set_config('request.jwt.claims', %s, false)",
                (json.dumps({"sub": user_id, "role": "authenticated"}),),
            )
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
        print(f"::notice title=f12-grants-canary::applied {path.name}", flush=True)


def hosted_table_grants(conn: "psycopg.Connection") -> None:
    # Hosted {ref} grants DML on public tables to anon/authenticated and then lets RLS decide.
    # 0001 does not restate those default grants, so a local Postgres would otherwise raise 42501
    # before any policy ran. This is harness setup, not a product grant.
    with conn.cursor() as cur:
        cur.execute("grant usage on schema public to anon, authenticated")
        cur.execute(
            "grant select, insert, update, delete on public.watchlists, public.watchlist_symbols to authenticated"
        )
        cur.execute("grant select on public.watchlists, public.watchlist_symbols to anon")


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations", default="supabase/migrations")
    parser.add_argument("--receipt", default="f12-grants-postgres-canary-receipt.json")
    args = parser.parse_args()

    dsn = env("F12_GRANTS_DATABASE_URL")
    proof = Proof()
    applied: list[dict] = []

    def _receipt(failed: bool, migration_error: str | None = None) -> dict:
        r = {
            "database_url_host": dsn.split("@")[-1] if "@" in dsn else "local",
            "expected_commit": os.environ.get("F12_GRANTS_EXPECTED_COMMIT"),
            "expected_image": os.environ.get("F12_GRANTS_EXPECTED_IMAGE"),
            "expected_postgres": os.environ.get("F12_GRANTS_EXPECTED_POSTGRES"),
            "run_id": os.environ.get("F12_GRANTS_GITHUB_RUN_ID"),
            "run_attempt": os.environ.get("F12_GRANTS_GITHUB_RUN_ATTEMPT"),
            "job": os.environ.get("F12_GRANTS_GITHUB_JOB"),
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
        hosted_table_grants(admin)
    except Exception as exc:  # noqa: BLE001 - report PARTIAL via receipt
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-grants-canary::migration application failed: {exc}", flush=True)
        return 1

    with admin.cursor() as cur:
        cur.execute(
            "select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace"
            " where n.nspname='public' and c.relname='resource_grants'"
        )
        rls = cur.fetchone()
        cur.execute(
            "select policyname, cmd from pg_policies where schemaname='public' and tablename='resource_grants' order by 1"
        )
        policies = cur.fetchall()
    proof.check(
        "catalog:resource_grants",
        bool(rls) and rls[0] is True and len(policies) == 3,
        f"rls={rls} policies={policies}",
    )

    with admin.cursor() as cur:
        cur.execute(
            "select policyname, cmd from pg_policies where schemaname='public'"
            " and tablename in ('watchlists','watchlist_symbols') order by 1,2"
        )
        wl_policies = {row[0]: row[1] for row in cur.fetchall()}
    proof.check(
        "catalog:watchlist_read_policies",
        wl_policies.get("watchlists_granted_read") == "SELECT" and wl_policies.get("wls_granted_read") == "SELECT",
        str(wl_policies),
    )

    with admin.cursor() as cur:
        cur.execute(
            "select prosecdef, pg_get_function_identity_arguments(oid) from pg_proc"
            " where pronamespace='public'::regnamespace and proname='has_active_grant'"
        )
        helper = cur.fetchone()
    proof.check(
        "helper:has_active_grant",
        bool(helper) and helper[0] is True and helper[1] == "p_kind text, p_resource uuid",
        str(helper),
    )

    a_owner = str(uuid.uuid4())
    b_user = str(uuid.uuid4())
    c_user = str(uuid.uuid4())
    d_owner = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute(
            "insert into auth.users (id, email) values (%s,'a@example'), (%s,'b@example'), (%s,'c@example'), (%s,'d@example')",
            (a_owner, b_user, c_user, d_owner),
        )
        cur.execute(
            "insert into public.watchlists (user_id, name, position) values (%s,'Gold Miners',0), (%s,'Keep Private',1) returning id",
            (a_owner, a_owner),
        )
        list_a = cur.fetchone()[0]
        cur.execute("select id from public.watchlists where user_id=%s and name='Keep Private'", (a_owner,))
        list_b = cur.fetchone()[0]
        cur.execute(
            "insert into public.watchlist_symbols (watchlist_id, symbol, section, position) values"
            " (%s,'NEM','Miners',0), (%s,'AEM','Miners',1)",
            (list_a, list_a),
        )
        cur.execute(
            "insert into public.resource_grants (resource_kind, resource_id, grantee_user_id, granted_by)"
            " values ('watchlist', %s, %s, %s) returning id",
            (list_a, b_user, a_owner),
        )
        grant_id = cur.fetchone()[0]
        cur.execute(
            "insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Team B', %s) returning id",
            (d_owner,),
        )
        team_b = cur.fetchone()[0]
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values (%s,%s,'member',%s)",
            (team_b, c_user, d_owner),
        )

    with admin.cursor() as cur:
        cur.execute("set role postgres")
        cur.execute("select count(*) from public.watchlists where id=%s", (list_a,))
        postgres_count = cur.fetchone()[0]
        cur.execute("reset role")
    proof.check(
        "control:postgres_sees_the_shared_row",
        postgres_count >= 1,
        f"postgres saw {postgres_count} rows (proves emptiness below is RLS, not an empty table)",
    )

    b_conn = actor_connection(dsn, b_user)
    with b_conn.cursor() as cur:
        cur.execute("select id from public.watchlists")
        b_lists = cur.fetchall()
        cur.execute("select symbol from public.watchlist_symbols where watchlist_id=%s", (list_a,))
        b_symbols = cur.fetchall()
    proof.check(
        "rls:grantee_reads_shared_watchlist",
        len(b_lists) == 1 and b_lists[0][0] == list_a and len(b_symbols) == 2,
        f"lists={b_lists} symbols={b_symbols}",
    )

    c_conn = actor_connection(dsn, c_user)
    with c_conn.cursor() as cur:
        cur.execute("select id from public.watchlists where id=%s", (list_a,))
        c_lists = cur.fetchall()
    proof.check("rls:stranger_reads_nothing", len(c_lists) == 0, f"stranger saw {c_lists}")

    anon_conn = actor_connection(dsn, None)
    with anon_conn.cursor() as cur:
        cur.execute("select id from public.watchlists")
        anon_lists = cur.fetchall()
    proof.check("rls:anon_reads_nothing", len(anon_lists) == 0, f"anon saw {anon_lists}")

    with admin.cursor() as cur:
        cur.execute("update public.resource_grants set revoked_at = now() where id=%s", (grant_id,))
    b_conn2 = actor_connection(dsn, b_user)
    with b_conn2.cursor() as cur:
        cur.execute("select id from public.watchlists where id=%s", (list_a,))
        b_after = cur.fetchall()
    proof.check("rls:revoked_grant_denies_read", len(b_after) == 0, f"grantee after revoke saw {b_after}")

    # Fresh live grant for the remaining write / isolation proofs.
    with admin.cursor() as cur:
        cur.execute(
            "insert into public.resource_grants (resource_kind, resource_id, grantee_user_id, granted_by)"
            " values ('watchlist', %s, %s, %s) returning id",
            (list_a, b_user, a_owner),
        )
        live_grant = cur.fetchone()[0]

    b_conn3 = actor_connection(dsn, b_user)

    def b_insert_symbol():
        with b_conn3.cursor() as cur:
            cur.execute(
                "insert into public.watchlist_symbols (watchlist_id, symbol, section, position) values (%s,'GOLD','Miners',9)",
                (list_a,),
            )

    proof.check(
        "rls:grantee_cannot_write_shared_watchlist",
        expect_database_error(b_insert_symbol, "42501"),
        "grantee insert into watchlist_symbols should raise 42501",
    )

    def b_rename():
        with b_conn3.cursor() as cur:
            cur.execute("update public.watchlists set name='Stolen' where id=%s", (list_a,))
            return cur.rowcount

    renamed = 0
    raised_rename = False
    try:
        renamed = b_rename()
    except psycopg.Error as exc:
        code = getattr(exc.diag, "sqlstate", None) if hasattr(exc, "diag") else None
        raised_rename = code == "42501"
    proof.check(
        "rls:grantee_cannot_rename_shared_watchlist",
        raised_rename or renamed == 0,
        f"raised={raised_rename} rowcount={renamed}",
    )

    def b_delete():
        with b_conn3.cursor() as cur:
            cur.execute("delete from public.watchlists where id=%s", (list_a,))
            return cur.rowcount

    deleted = 0
    raised_delete = False
    try:
        deleted = b_delete()
    except psycopg.Error as exc:
        code = getattr(exc.diag, "sqlstate", None) if hasattr(exc, "diag") else None
        raised_delete = code == "42501"
    proof.check(
        "rls:grantee_cannot_delete_shared_watchlist",
        raised_delete or deleted == 0,
        f"raised={raised_delete} rowcount={deleted}",
    )

    with b_conn3.cursor() as cur:
        cur.execute("select count(*) from public.watchlists")
        b_count = cur.fetchone()[0]
    proof.check("rls:grantee_sees_only_the_shared_list", b_count == 1, f"grantee count={b_count}")

    def c_create_grant():
        with c_conn.cursor() as cur:
            cur.execute(
                "insert into public.resource_grants (resource_kind, resource_id, grantee_user_id, granted_by)"
                " values ('watchlist', %s, %s, %s)",
                (list_a, b_user, c_user),
            )

    proof.check(
        "rls:non_owner_cannot_create_grant",
        expect_database_error(c_create_grant, "42501"),
        "non-owner insert into resource_grants should raise 42501",
    )

    def self_grant():
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.resource_grants (resource_kind, resource_id, grantee_user_id, granted_by)"
                " values ('watchlist', %s, %s, %s)",
                (list_a, a_owner, a_owner),
            )

    proof.check(
        "ddl:self_grant_is_impossible",
        expect_database_error(self_grant, "23514"),
        "self-grant must raise 23514 even on the admin connection",
    )

    def duplicate_live():
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.resource_grants (resource_kind, resource_id, grantee_user_id, granted_by)"
                " values ('watchlist', %s, %s, %s)",
                (list_a, b_user, a_owner),
            )

    proof.check(
        "ddl:duplicate_live_grant_is_impossible",
        expect_database_error(duplicate_live, "23505"),
        "second live grant must raise 23505",
    )

    with admin.cursor() as cur:
        cur.execute("update public.resource_grants set revoked_at = now() where id=%s", (live_grant,))

    def reinstate():
        with admin.cursor() as cur:
            cur.execute("update public.resource_grants set revoked_at = null where id=%s", (live_grant,))

    proof.check(
        "ddl:revoke_is_terminal",
        expect_database_error(reinstate, "42501"),
        "updating revoked_at on an already-revoked row must raise 42501",
    )

    def repoint():
        with admin.cursor() as cur:
            cur.execute("update public.resource_grants set resource_id = %s where id=%s", (list_b, live_grant))

    proof.check(
        "ddl:grant_cannot_be_repointed",
        expect_database_error(repoint, "42501"),
        "updating resource_id must raise (column grant or trigger)",
    )

    with c_conn.cursor() as cur:
        cur.execute("select id from public.watchlists where id=%s", (list_a,))
        team_member_read = cur.fetchall()
    proof.check(
        "rls:other_team_member_gets_no_read",
        len(team_member_read) == 0,
        f"team-B member saw {team_member_read}",
    )

    with admin.cursor() as cur:
        cur.execute(
            "insert into public.resource_grants (resource_kind, resource_id, grantee_user_id, granted_by)"
            " values ('watchlist', %s, %s, %s)",
            (list_a, b_user, a_owner),
        )
        cur.execute("delete from public.watchlists where id=%s", (list_a,))
    b_conn4 = actor_connection(dsn, b_user)
    with b_conn4.cursor() as cur:
        cur.execute("select id from public.watchlists where id=%s", (list_a,))
        after_delete = cur.fetchall()
    proof.check(
        "ddl:deleting_the_list_ends_the_share",
        len(after_delete) == 0,
        f"grantee after list delete saw {after_delete}",
    )

    Path(args.receipt).write_text(json.dumps(_receipt(proof.failed), indent=2))
    print(f"::notice title=f12-grants-canary::receipt written to {args.receipt}", flush=True)
    return 1 if proof.failed else 0


if __name__ == "__main__":
    sys.exit(main())
