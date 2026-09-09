#!/usr/bin/env python3
"""Real-Postgres RLS canary for packet B-F12-B5-2 (0022_chart_layouts_team_sharing.sql).

New file pair on purpose — B-F12-9 plans to extend f12_team_postgres_canary.py, and two
packets editing one script is a guaranteed conflict. Applies every supabase/migrations/*.sql
file in sorted order to a scratch Postgres 16, then exercises the capability matrix under
real actor-scoped connections. RLS is the only authority: this script never filters rows
in Python.

Env: F12_SHARED_WS_DATABASE_URL (required). Optional expected-commit / run metadata.
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
    print("::error title=f12-shared-ws-canary::psycopg is not installed", flush=True)
    raise


class Proof:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.failed = False

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.rows.append({"name": name, "ok": bool(condition), "detail": detail})
        if not condition:
            self.failed = True
            print(f"::error title=f12-shared-ws-canary::FAILED {name} {detail}", flush=True)
        else:
            print(f"::notice title=f12-shared-ws-canary::ok {name}", flush=True)


def env(name: str, required: bool = True, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        print(f"::error title=f12-shared-ws-canary::missing required env {name}", flush=True)
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
        cur.execute("grant usage on schema public to anon, authenticated")
        cur.execute("grant select on auth.users to anon, authenticated")


def apply_migrations(conn: "psycopg.Connection", migrations_dir: Path, applied: list[dict]) -> None:
    for path in sorted(migrations_dir.glob("*.sql")):
        sql = path.read_text()
        sha = hashlib.sha256(sql.encode("utf8")).hexdigest()
        with conn.cursor() as cur:
            cur.execute(sql)
        applied.append({"file": path.name, "sha256": sha})
        print(f"::notice title=f12-shared-ws-canary::applied {path.name}", flush=True)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations", default="supabase/migrations")
    parser.add_argument("--receipt", default="f12-shared-workspaces-postgres-canary-receipt.json")
    args = parser.parse_args()

    dsn = env("F12_SHARED_WS_DATABASE_URL")
    proof = Proof()
    applied: list[dict] = []

    def _receipt(failed: bool, migration_error: str | None = None) -> dict:
        r = {
            "database_url_host": dsn.split("@")[-1] if "@" in dsn else "local",
            "expected_commit": os.environ.get("F12_SHARED_WS_EXPECTED_COMMIT"),
            "run_id": os.environ.get("F12_SHARED_WS_GITHUB_RUN_ID"),
            "run_attempt": os.environ.get("F12_SHARED_WS_GITHUB_RUN_ATTEMPT"),
            "job": os.environ.get("F12_SHARED_WS_GITHUB_JOB"),
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
        # Estate grants on chart_layouts predate the reservation law; 0022 must not change them.
        # The canary mints the same authenticated table rights the live project already has.
        with admin.cursor() as cur:
            cur.execute("grant select, insert, update, delete on table public.chart_layouts to authenticated")
        # Idempotency: there is no migration history table for {ref}.
        sql_0022 = Path(args.migrations) / "0022_chart_layouts_team_sharing.sql"
        with admin.cursor() as cur:
            cur.execute(sql_0022.read_text())
        print("::notice title=f12-shared-ws-canary::re-applied 0022 (idempotent)", flush=True)
    except Exception as exc:  # noqa: BLE001
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-shared-ws-canary::migration application failed: {exc}", flush=True)
        return 1

    owner = str(uuid.uuid4())
    admin_user = str(uuid.uuid4())
    member = str(uuid.uuid4())
    other = str(uuid.uuid4())
    loner = str(uuid.uuid4())
    with admin.cursor() as cur:
        cur.execute(
            "insert into auth.users (id, email) values (%s,'owner@a.example'),(%s,'admin@a.example'),"
            "(%s,'member@a.example'),(%s,'other@b.example'),(%s,'loner@c.example')",
            (owner, admin_user, member, other, loner),
        )
        cur.execute("insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Desk', %s) returning id", (owner,))
        team_a = cur.fetchone()[0]
        cur.execute("insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Other Desk', %s) returning id", (other,))
        team_b = cur.fetchone()[0]
        cur.execute(
            "insert into public.team_members (team_id, user_id, role, invited_by) values (%s,%s,'admin',%s), (%s,%s,'member',%s)",
            (team_a, admin_user, owner, team_a, member, owner),
        )

    owner_c = actor_connection(dsn, owner)
    admin_c = actor_connection(dsn, admin_user)
    member_c = actor_connection(dsn, member)
    other_c = actor_connection(dsn, other)
    loner_c = actor_connection(dsn, loner)

    def owner_private():
        with owner_c.cursor() as cur:
            cur.execute(
                "insert into public.chart_layouts (user_id, name, config) values (%s,'Mine','{}'::jsonb) returning id",
                (owner,),
            )
            return cur.fetchone()[0]

    private_id = None
    try:
        private_id = owner_private()
        proof.check("private:owner_insert", True, str(private_id))
    except Exception as exc:  # noqa: BLE001
        proof.check("private:owner_insert", False, str(exc))

    def owner_share():
        with owner_c.cursor() as cur:
            cur.execute(
                "insert into public.chart_layouts (user_id, name, config, visibility, team_id)"
                " values (%s,'Open','{}'::jsonb,'team',%s) returning id",
                (owner, team_a),
            )
            return cur.fetchone()[0]

    shared_id = None
    try:
        shared_id = owner_share()
        proof.check("rls:owner_insert_team", True, str(shared_id))
    except Exception as exc:  # noqa: BLE001
        proof.check("rls:owner_insert_team", False, str(exc))

    def admin_share():
        with admin_c.cursor() as cur:
            cur.execute(
                "insert into public.chart_layouts (user_id, name, config, visibility, team_id)"
                " values (%s,'Admin Open','{}'::jsonb,'team',%s) returning id",
                (admin_user, team_a),
            )
            return cur.fetchone()[0]

    try:
        admin_share()
        proof.check("rls:admin_insert_team", True)
    except Exception as exc:  # noqa: BLE001
        proof.check("rls:admin_insert_team", False, str(exc))

    def member_share():
        with member_c.cursor() as cur:
            cur.execute(
                "insert into public.chart_layouts (user_id, name, config, visibility, team_id)"
                " values (%s,'Hijack','{}'::jsonb,'team',%s)",
                (member, team_a),
            )

    proof.check("rls:member_cannot_insert_team", expect_database_error(member_share, "42501"), "member insert team row")

    with member_c.cursor() as cur:
        cur.execute("select id from public.chart_layouts where visibility='team' and team_id=%s", (team_a,))
        seen = cur.fetchall()
    proof.check("rls:member_selects_shared", len(seen) >= 1, f"member saw {len(seen)}")

    with other_c.cursor() as cur:
        cur.execute("select id from public.chart_layouts where visibility='team'")
        seen_other = cur.fetchall()
    proof.check("rls:other_team_selects_zero", len(seen_other) == 0, f"other saw {len(seen_other)}")

    with loner_c.cursor() as cur:
        cur.execute("select id from public.chart_layouts where visibility='team'")
        seen_loner = cur.fetchall()
    proof.check("rls:no_team_selects_zero", len(seen_loner) == 0, f"loner saw {len(seen_loner)}")

    with admin.cursor() as cur:
        cur.execute("update public.team_members set role='member' where team_id=%s and user_id=%s", (team_a, admin_user))

    demoted = actor_connection(dsn, admin_user)

    # 0-row UPDATE is how a restrictive USING miss arrives (not always 42501). Treat either as a refusal.
    with demoted.cursor() as cur:
        cur.execute("update public.chart_layouts set name='Stolen' where id=%s", (shared_id,))
        updated = cur.rowcount
        cur.execute("select name from public.chart_layouts where id=%s", (shared_id,))
        name_row = cur.fetchone()
    proof.check("rls:demoted_admin_update_zero_or_denied", updated == 0 and (name_row is None or name_row[0] != "Stolen"), f"updated={updated} name={name_row}")

    with demoted.cursor() as cur:
        cur.execute("delete from public.chart_layouts where id=%s", (shared_id,))
        deleted = cur.rowcount
    proof.check("rls:demoted_admin_delete_zero_or_denied", deleted == 0, f"deleted={deleted}")

    def second_same_name():
        with owner_c.cursor() as cur:
            cur.execute(
                "insert into public.chart_layouts (user_id, name, config, visibility, team_id)"
                " values (%s,'Open','{}'::jsonb,'team',%s)",
                (owner, team_a),
            )

    proof.check("ddl:team_name_unique", expect_database_error(second_same_name, "23505"), "second (team,name)")

    def team_without_team_id():
        with owner_c.cursor() as cur:
            cur.execute(
                "insert into public.chart_layouts (user_id, name, config, visibility, team_id)"
                " values (%s,'Shapeless','{}'::jsonb,'team',null)",
                (owner,),
            )

    proof.check("ddl:shape_team_needs_team_id", expect_database_error(team_without_team_id, "23514"), "team + null team_id")

    def public_visibility():
        with owner_c.cursor() as cur:
            cur.execute(
                "insert into public.chart_layouts (user_id, name, config, visibility)"
                " values (%s,'Public','{}'::jsonb,'public')",
                (owner,),
            )

    proof.check("ddl:visibility_public_rejected", expect_database_error(public_visibility, "23514"), "visibility=public")

    with owner_c.cursor() as cur:
        cur.execute("select visibility, team_id from public.chart_layouts where id=%s", (private_id,))
        priv = cur.fetchone()
    proof.check("private:unaffected", bool(priv) and priv[0] == "private" and priv[1] is None, str(priv))

    Path(args.receipt).write_text(json.dumps(_receipt(proof.failed), indent=2))
    print(f"::notice title=f12-shared-ws-canary::receipt written to {args.receipt}", flush=True)
    return 1 if proof.failed else 0


if __name__ == "__main__":
    sys.exit(main())
