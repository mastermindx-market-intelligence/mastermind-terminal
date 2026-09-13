#!/usr/bin/env python3
"""Real-Postgres due-select canary for packet B-F12-7 (0018_webhook_delivery.sql).

Applies every supabase/migrations/*.sql file in sorted order to a scratch
Postgres 16, then inserts pending, retrying, delivering-stale and
delivering-fresh webhook_deliveries rows and asserts the due-select (the
PostgREST filter in ingest/webhook_delivery.ts:230-240, expressed as SQL)
returns exactly the pending, retrying-due and delivering-stale ids.

This script APPLIES migrations to a throwaway CI database only. It is never a
substitute for the manual, out-of-band operator application described in
supabase/migrations/README.md. 0018 stays UNAPPLIED in production.

Env: F12_WEBHOOKS_DATABASE_URL (required). Optional expected-commit / run metadata.

GAPS (not repaired here): the delivering/claimed_at arm of the due-select has
no supporting index. webhook_deliveries_due is (status, next_retry_at) only.
0018 is byte-identical and UNAPPLIED; the index is a follow-on DDL.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import psycopg
except ImportError:  # pragma: no cover - environment guard
    print("::error title=f12-webhooks-canary::psycopg is not installed", flush=True)
    raise


NOW = datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc)
STALE_LEASE = timedelta(minutes=10)
STALE_CUTOFF = NOW - STALE_LEASE
DUE_PAGE_LIMIT = 100

# SQL equivalent of ingest/webhook_delivery.ts dueDeliveriesPath's PostgREST
# or=(and(status.in.(pending,retrying),or(next_retry_at.is.null,next_retry_at.lte.<now>)),
#     and(status.eq.delivering,claimed_at.lte.<stale>))
DUE_SELECT_SQL = """
select id
  from public.webhook_deliveries
 where (
         (status in ('pending', 'retrying')
          and (next_retry_at is null or next_retry_at <= %s))
         or
         (status = 'delivering' and claimed_at <= %s)
       )
 order by created_at asc
 limit %s
"""


class Proof:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.failed = False

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.rows.append({"name": name, "ok": bool(condition), "detail": detail})
        if not condition:
            self.failed = True
            print(f"::error title=f12-webhooks-canary::FAILED {name} {detail}", flush=True)
        else:
            print(f"::notice title=f12-webhooks-canary::ok {name}", flush=True)


def env(name: str, required: bool = True, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        print(f"::error title=f12-webhooks-canary::missing required env {name}", flush=True)
        raise SystemExit(2)
    return val or ""


def admin_connection(dsn: str) -> "psycopg.Connection":
    return psycopg.connect(dsn, autocommit=True)


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
            extra = " bypassrls" if role == "service_role" else ""
            cur.execute(
                f"do $$ begin create role {role} nologin{extra}; exception when duplicate_object then null; end $$;"
            )
        cur.execute("grant usage on schema public, auth to anon, authenticated")
        cur.execute("grant select on auth.users to anon, authenticated")


def apply_migrations(conn: "psycopg.Connection", migrations_dir: Path, applied: list[dict]) -> None:
    for path in sorted(migrations_dir.glob("*.sql")):
        sql = path.read_text()
        sha = hashlib.sha256(sql.encode("utf8")).hexdigest()
        with conn.cursor() as cur:
            cur.execute(sql)
        applied.append({"file": path.name, "sha256": sha})
        print(f"::notice title=f12-webhooks-canary::applied {path.name}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations", default="supabase/migrations")
    parser.add_argument("--receipt", default="f12-webhooks-postgres-canary-receipt.json")
    args = parser.parse_args()

    dsn = env("F12_WEBHOOKS_DATABASE_URL")
    proof = Proof()
    applied: list[dict] = []

    def _receipt(failed: bool, migration_error: str | None = None) -> dict:
        r = {
            "database_url_host": dsn.split("@")[-1] if "@" in dsn else "local",
            "expected_commit": os.environ.get("F12_WEBHOOKS_EXPECTED_COMMIT"),
            "run_id": os.environ.get("F12_WEBHOOKS_GITHUB_RUN_ID"),
            "run_attempt": os.environ.get("F12_WEBHOOKS_GITHUB_RUN_ATTEMPT"),
            "job": os.environ.get("F12_WEBHOOKS_GITHUB_JOB"),
            "applied_migrations": applied,
            "proofs": proof.rows,
            "failed": failed,
            "gaps": [
                "delivering/claimed_at arm of the due-select has no supporting index; "
                "webhook_deliveries_due is (status, next_retry_at) only. 0018 stays "
                "byte-identical and UNAPPLIED; the index is a follow-on DDL."
            ],
        }
        if migration_error is not None:
            r["migration_error"] = migration_error
        return r

    try:
        admin = admin_connection(dsn)
        bootstrap(admin)
        apply_migrations(admin, Path(args.migrations), applied)
    except Exception as exc:  # noqa: BLE001
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-webhooks-canary::migration application failed: {exc}", flush=True)
        return 1

    owner = str(uuid.uuid4())
    pending_id = str(uuid.uuid4())
    retrying_id = str(uuid.uuid4())
    stale_id = str(uuid.uuid4())
    fresh_id = str(uuid.uuid4())

    try:
        with admin.cursor() as cur:
            cur.execute("insert into auth.users (id, email) values (%s, 'owner@a.example')", (owner,))
            cur.execute(
                "insert into public.teams (id, name, created_by) values (gen_random_uuid(), 'Desk', %s) returning id",
                (owner,),
            )
            team_id = cur.fetchone()[0]
            cur.execute(
                "insert into public.webhook_endpoints (team_id, url, secret, enabled, event_filter, created_by) "
                "values (%s, 'https://hooks.example.com/mastermind', 'whsec_canary', true, '{webhook.test}', %s) "
                "returning id",
                (team_id, owner),
            )
            endpoint_id = cur.fetchone()[0]

            rows = [
                (pending_id, "pending", None, None, NOW - timedelta(minutes=4)),
                (retrying_id, "retrying", None, NOW - timedelta(seconds=1), NOW - timedelta(minutes=3)),
                (stale_id, "delivering", STALE_CUTOFF - timedelta(seconds=1), None, NOW - timedelta(minutes=2)),
                (fresh_id, "delivering", NOW - timedelta(seconds=30), None, NOW - timedelta(minutes=1)),
            ]
            for row_id, status, claimed_at, next_retry_at, created_at in rows:
                cur.execute(
                    "insert into public.webhook_deliveries "
                    "(id, endpoint_id, team_id, event_id, event_type, payload, attempt, status, "
                    " claimed_at, next_retry_at, created_at) "
                    "values (%s, %s, %s, %s, 'webhook.test', '{}'::jsonb, 1, %s, %s, %s, %s)",
                    (
                        row_id,
                        endpoint_id,
                        team_id,
                        f"evt-{row_id}",
                        status,
                        claimed_at,
                        next_retry_at,
                        created_at,
                    ),
                )

            cur.execute(DUE_SELECT_SQL, (NOW, STALE_CUTOFF, DUE_PAGE_LIMIT))
            selected = [str(r[0]) for r in cur.fetchall()]

        proof.check(
            "due-select:pending",
            pending_id in selected,
            f"selected={selected}",
        )
        proof.check(
            "due-select:retrying",
            retrying_id in selected,
            f"selected={selected}",
        )
        proof.check(
            "due-select:delivering-stale",
            stale_id in selected,
            f"selected={selected}",
        )
        proof.check(
            "due-select:delivering-fresh-excluded",
            fresh_id not in selected,
            f"selected={selected}",
        )
        proof.check(
            "due-select:set",
            set(selected) == {pending_id, retrying_id, stale_id},
            f"selected={selected}",
        )
    except Exception as exc:  # noqa: BLE001
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-webhooks-canary::due-select case failed: {exc}", flush=True)
        return 1

    Path(args.receipt).write_text(json.dumps(_receipt(proof.failed), indent=2))
    if proof.failed:
        print("::error title=f12-webhooks-canary::one or more proofs failed", flush=True)
        return 1
    print("::notice title=f12-webhooks-canary::all proofs passed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
