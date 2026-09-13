#!/usr/bin/python3
"""Real-Postgres canary for packet B-F12-11 (0026_webhook_rotation_alert_fires.sql).

Applies every supabase/migrations/*.sql file in sorted order to a scratch
Postgres 16, then exercises the four B-F12-11 invariants end-to-end:

  1. event_filter accepts the widened vocabulary {'webhook.test','alert.fired'};
  2. an alert_outbox INSERT for an opted-in member of a team with an enabled,
     subscribed endpoint yields exactly ONE webhook_deliveries row whose
     event_type is 'alert.fired', whose payload->>'schema' equals
     'mastermind.alert-fired/v1', and whose event_id equals fire_event_id;
  3. a second INSERT with the same fire_event_id is a no-op (still one row);
  4. a non-opted-in user or an unsubscribed endpoint yields zero rows;
  5. rotate_webhook_secret bumps secret_version to 2 and sets secret_previous
     + secret_previous_expires_at.

This script APPLIES migrations to a throwaway CI database only. It is never a
substitute for the manual, out-of-band operator application described in
supabase/migrations/README.md. 0026 stays UNAPPLIED in production.

Env: F12_WEBHOOKS_DATABASE_URL (required).
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

# SQL equivalent of ingest/webhook_delivery.ts dueDeliveriesPath's PostgREST filter
# (status in (pending, retrying) and (next_retry_at is null or next_retry_at <= now))
# OR (status = delivering and claimed_at <= stale_cutoff).
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
                "byte-identical and UNAPPLIED; the index is a follow-on DDL.",
            ],
        }
        if migration_error is not None:
            r["migration_error"] = migration_error
        return r

    # ---------------------------------------------------------------
    # Phase 1 — apply every migration (0001 through 0026 in order).
    # ---------------------------------------------------------------
    try:
        admin = admin_connection(dsn)
        bootstrap(admin)
        apply_migrations(admin, Path(args.migrations), applied)
    except Exception as exc:  # noqa: BLE001
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-webhooks-canary::migration application failed: {exc}", flush=True)
        return 1

    # ---------------------------------------------------------------
    # Phase 2 — due-select proofs (carry-over from B-F12-7).
    # ---------------------------------------------------------------
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

        proof.check("due-select:pending", pending_id in selected, f"selected={selected}")
        proof.check("due-select:retrying", retrying_id in selected, f"selected={selected}")
        proof.check("due-select:delivering-stale", stale_id in selected, f"selected={selected}")
        proof.check("due-select:delivering-fresh-excluded", fresh_id not in selected, f"selected={selected}")
        proof.check(
            "due-select:set",
            set(selected) == {pending_id, retrying_id, stale_id},
            f"selected={selected}",
        )
    except Exception as exc:  # noqa: BLE001
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-webhooks-canary::due-select case failed: {exc}", flush=True)
        return 1

    # ---------------------------------------------------------------
    # Phase 3 — B-F12-11 vocabulary widening (event_filter accepts 'alert.fired').
    # ---------------------------------------------------------------
    try:
        with admin.cursor() as cur:
            # Insert an endpoint whose event_filter contains 'alert.fired'. 0026 widens the
            # vocabulary; if the constraint still says 'webhook.test' alone, this INSERT raises.
            cur.execute(
                "insert into public.webhook_endpoints (team_id, url, secret, enabled, event_filter, created_by) "
                "values (%s, 'https://hooks.example.com/alerts', 'whsec_alert_canary', true, "
                " '{webhook.test,alert.fired}', %s) returning id",
                (team_id, owner),
            )
            alert_endpoint_id = cur.fetchone()[0]
        proof.check("event_filter:alert.fired-accepted", True, "endpoint inserted with widened vocabulary")
    except Exception as exc:  # noqa: BLE001
        proof.check("event_filter:alert.fired-accepted", False, f"insert failed: {exc}")

    # ---------------------------------------------------------------
    # Phase 4 — alert-fire producer wiring (R1, R2, R5).
    # owner is a member of the team and has opted-in to alert-fires for the team; the team
    # owns an enabled endpoint subscribed to 'alert.fired'. The trigger MUST insert exactly
    # one webhook_deliveries row with event_type='alert.fired', payload->>'schema' equal to
    # 'mastermind.alert-fired/v1', and event_id equal to fire_event_id.
    #
    # Payload shape mirrors ingest/alerts_engine.py (no `team_id` key — alerts are personal per
    # 0001 / R2, and 0013_alert_runs_outbox.sql has no team_id column). The trigger MUST
    # therefore stamp team_id into the per-delivery payload from the matched endpoint row.
    # This is the realistic-payload check that exposed the FIFTH-gate bug in the previous head:
    # a payload->>'team_id' filter always evaluated to NULL → '' against e.team_id, so the
    # trigger inserted ZERO rows. With the FIFTH gate removed, this insert must yield one row.
    # ---------------------------------------------------------------
    fire_id_1 = str(uuid.uuid4())
    payload_1 = {
        "schema": "mastermind.alert-fired/v1",
        "ticker": "AAPL",
        "subject": "Alert",
        "subject_zh": "提醒",
        "summary_plain": "summary",
        "summary_plain_zh": "摘要",
        "condition_plain": "condition",
        "condition_plain_zh": "条件",
        "value": "100",
        "evidence_url": "https://example.com",
        "fired_at": NOW.isoformat(),
    }
    try:
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.webhook_alert_optins (user_id, team_id, enabled) values (%s, %s, true)",
                (owner, team_id),
            )
            cur.execute(
                "insert into public.alert_outbox (id, user_id, alert_id, fire_event_id, channel, status, payload) "
                "values (gen_random_uuid(), %s, gen_random_uuid(), %s, 'webhook', 'pending', %s::jsonb)",
                (owner, fire_id_1, json.dumps(payload_1)),
            )
            cur.execute(
                "select count(*) from public.webhook_deliveries where event_id = %s and event_type = 'alert.fired'",
                (fire_id_1,),
            )
            count = cur.fetchone()[0]
            cur.execute(
                "select event_id, payload->>'schema', payload->>'team_id' from public.webhook_deliveries "
                "where event_id = %s and event_type = 'alert.fired'",
                (fire_id_1,),
            )
            row = cur.fetchone()
        proof.check(
            "alert-fire:one-delivery",
            count == 1,
            f"expected exactly 1 alert.fired row for fire_event_id, got {count}",
        )
        proof.check(
            "alert-fire:event-id-equals-fire-event-id",
            row is not None and row[0] == fire_id_1,
            f"event_id={row[0] if row else None}",
        )
        proof.check(
            "alert-fire:payload-schema-tag",
            row is not None and row[1] == "mastermind.alert-fired/v1",
            f"payload->>'schema'={row[1] if row else None}",
        )
        # Realistic-payload regression: the trigger must stamp team_id from the matched
        # endpoint, since alert_outbox.payload carries no team_id (alerts are personal).
        proof.check(
            "alert-fire:payload-team-id-from-endpoint",
            row is not None and row[2] == team_id,
            f"payload->>'team_id'={row[2] if row else None} (expected the endpoint's team_id {team_id})",
        )
    except Exception as exc:  # noqa: BLE001
        proof.check("alert-fire:happy-path", False, f"insert failed: {exc}")

    # ---------------------------------------------------------------
    # Phase 5 — replay idempotency (R1: a second insert with the same fire_event_id is a no-op).
    # ---------------------------------------------------------------
    try:
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.alert_outbox (id, user_id, alert_id, fire_event_id, channel, status, payload) "
                "values (gen_random_uuid(), %s, gen_random_uuid(), %s, 'webhook', 'pending', %s::jsonb)",
                (owner, fire_id_1, json.dumps(payload_1)),
            )
            cur.execute(
                "select count(*) from public.webhook_deliveries where event_id = %s and event_type = 'alert.fired'",
                (fire_id_1,),
            )
            count_after = cur.fetchone()[0]
        proof.check(
            "alert-fire:replay-idempotent",
            count_after == 1,
            f"expected still exactly 1 alert.fired row after replay, got {count_after}",
        )
    except Exception as exc:  # noqa: BLE001
        proof.check("alert-fire:replay-idempotent", False, f"replay insert failed: {exc}")

    # ---------------------------------------------------------------
    # Phase 6 — non-opted-in user yields zero deliveries (R2 fourth gate).
    # Add a second team member without an optin and insert an alert fire for them.
    # ---------------------------------------------------------------
    try:
        non_optin_user = str(uuid.uuid4())
        fire_id_2 = str(uuid.uuid4())
        with admin.cursor() as cur:
            cur.execute("insert into auth.users (id, email) values (%s, 'noopt@a.example')", (non_optin_user,))
            cur.execute(
                "insert into public.team_members (team_id, user_id, role, invited_by) values (%s, %s, 'member', %s)",
                (team_id, non_optin_user, owner),
            )
            cur.execute(
                "insert into public.alert_outbox (id, user_id, alert_id, fire_event_id, channel, status, payload) "
                "values (gen_random_uuid(), %s, gen_random_uuid(), %s, 'webhook', 'pending', %s::jsonb)",
                (non_optin_user, fire_id_2, json.dumps(payload_1)),
            )
            cur.execute(
                "select count(*) from public.webhook_deliveries where event_id = %s",
                (fire_id_2,),
            )
            count = cur.fetchone()[0]
        proof.check(
            "alert-fire:non-opted-in-yields-zero",
            count == 0,
            f"expected 0 webhook_deliveries for non-opted-in user, got {count}",
        )
    except Exception as exc:  # noqa: BLE001
        proof.check("alert-fire:non-opted-in-yields-zero", False, f"insert failed: {exc}")

    # ---------------------------------------------------------------
    # Phase 7 — unsubscribed endpoint yields zero deliveries (R2 second gate).
    # The owner IS opted in, but the endpoint's event_filter does NOT contain 'alert.fired'.
    # Use the original endpoint_id (event_filter = {webhook.test} only).
    # ---------------------------------------------------------------
    try:
        fire_id_3 = str(uuid.uuid4())
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.alert_outbox (id, user_id, alert_id, fire_event_id, channel, status, payload) "
                "values (gen_random_uuid(), %s, gen_random_uuid(), %s, 'webhook', 'pending', %s::jsonb)",
                (owner, fire_id_3, json.dumps(payload_1)),
            )
            cur.execute(
                "select count(*) from public.webhook_deliveries where event_id = %s",
                (fire_id_3,),
            )
            count = cur.fetchone()[0]
        proof.check(
            "alert-fire:unsubscribed-endpoint-yields-zero",
            count == 0,
            f"expected 0 webhook_deliveries for unsubscribed endpoint, got {count}",
        )
    except Exception as exc:  # noqa: BLE001
        proof.check("alert-fire:unsubscribed-endpoint-yields-zero", False, f"insert failed: {exc}")

    # ---------------------------------------------------------------
    # Phase 8 — rotate_webhook_secret bumps secret_version to 2 and sets secret_previous + expiry.
    # ---------------------------------------------------------------
    try:
        with admin.cursor() as cur:
            cur.execute(
                "select public.rotate_webhook_secret(%s)",
                (endpoint_id,),
            )
            rotate_row = cur.fetchone()
            cur.execute(
                "select secret_version, secret_previous is not null, secret_previous_expires_at > now(), secret_rotated_at is not null "
                "from public.webhook_endpoints where id = %s",
                (endpoint_id,),
            )
            ep = cur.fetchone()
        rotate_data = rotate_row[0] if rotate_row and rotate_row[0] else {}
        proof.check(
            "rotate:ok-secret-returned",
            isinstance(rotate_data, dict) and rotate_data.get("ok") is True and isinstance(rotate_data.get("secret"), str) and rotate_data.get("secret") != "",
            f"rpc returned {rotate_row[0] if rotate_row else None}",
        )
        proof.check(
            "rotate:secret-version-2",
            ep[0] == 2,
            f"secret_version={ep[0]}",
        )
        proof.check(
            "rotate:secret-previous-set",
            ep[1] is True,
            f"secret_previous_is_not_null={ep[1]}",
        )
        proof.check(
            "rotate:expiry-in-future",
            ep[2] is True,
            f"secret_previous_expires_at>now()={ep[2]}",
        )
        proof.check(
            "rotate:rotated-at-set",
            ep[3] is True,
            f"secret_rotated_at_is_not_null={ep[3]}",
        )
    except Exception as exc:  # noqa: BLE001
        proof.check("rotate:happy-path", False, f"rotate failed: {exc}")

    # ---------------------------------------------------------------
    # Phase 9 — requeue_failed_webhook_delivery resets a failed row to pending.
    # ---------------------------------------------------------------
    try:
        failed_delivery_id = str(uuid.uuid4())
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.webhook_deliveries (id, endpoint_id, team_id, event_id, event_type, payload, "
                "attempt, status, last_error, response_code) "
                "values (%s, %s, %s, 'evt-failed', 'webhook.test', '{}'::jsonb, 5, 'failed', 'http 500', 500)",
                (failed_delivery_id, endpoint_id, team_id),
            )
            cur.execute("select public.requeue_failed_webhook_delivery(%s)", (failed_delivery_id,))
            requeue_row = cur.fetchone()
            cur.execute(
                "select status, attempt, next_retry_at, last_error, claimed_at from public.webhook_deliveries "
                "where id = %s",
                (failed_delivery_id,),
            )
            row = cur.fetchone()
        requeue_data = requeue_row[0] if requeue_row and requeue_row[0] else {}
        proof.check(
            "requeue:ok-returned",
            isinstance(requeue_data, dict) and requeue_data.get("ok") is True,
            f"rpc returned {requeue_row[0] if requeue_row else None}",
        )
        proof.check("requeue:status-pending", row[0] == "pending", f"status={row[0]}")
        proof.check("requeue:attempt-0", row[1] == 0, f"attempt={row[1]}")
        proof.check("requeue:next_retry_at-null", row[2] is None, f"next_retry_at={row[2]}")
        proof.check("requeue:last_error-null", row[3] is None, f"last_error={row[3]}")
        proof.check("requeue:claimed_at-null", row[4] is None, f"claimed_at={row[4]}")
    except Exception as exc:  # noqa: BLE001
        proof.check("requeue:happy-path", False, f"requeue failed: {exc}")

    # ---------------------------------------------------------------
    # Phase 10 — requeue refuses a non-failed delivery (409 not_failed).
    # ---------------------------------------------------------------
    try:
        pending_delivery_id = str(uuid.uuid4())
        with admin.cursor() as cur:
            cur.execute(
                "insert into public.webhook_deliveries (id, endpoint_id, team_id, event_id, event_type, payload, "
                "attempt, status) values (%s, %s, %s, 'evt-pending', 'webhook.test', '{}'::jsonb, 1, 'pending')",
                (pending_delivery_id, endpoint_id, team_id),
            )
            cur.execute("select public.requeue_failed_webhook_delivery(%s)", (pending_delivery_id,))
            row = cur.fetchone()
        requeue_data = row[0] if row and row[0] else {}
        proof.check(
            "requeue:not-failed-rejected",
            isinstance(requeue_data, dict)
            and requeue_data.get("ok") is False
            and requeue_data.get("reason") == "not_failed",
            f"rpc returned {row[0] if row else None}",
        )
    except Exception as exc:  # noqa: BLE001
        proof.check("requeue:not-failed-rejected", False, f"check failed: {exc}")

    Path(args.receipt).write_text(json.dumps(_receipt(proof.failed), indent=2))
    if proof.failed:
        print("::error title=f12-webhooks-canary::one or more proofs failed", flush=True)
        return 1
    print("::notice title=f12-webhooks-canary::all proofs passed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())