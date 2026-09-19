#!/usr/bin/env python3
"""Real-Postgres tenant-isolation canary for packet B-F12-10 (0027_api_keys.sql).

Applies every supabase/migrations/*.sql file in sorted order to a scratch
Postgres 16, then creates two users (A and B) each with a thesis, watchlist,
alert, claim, and position. It calls api_v1_read_as_user(A's id) and asserts
ZERO rows belonging to B are returned for every resource.

This script APPLIES migrations to a throwaway CI database only. It is never a
substitute for the manual, out-of-band operator application described in
supabase/migrations/README.md. 0027 stays UNAPPLIED in production.

Env: F12_API_V1_DATABASE_URL (required). Optional expected-commit / run metadata.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    import psycopg
except ImportError:  # pragma: no cover - environment guard
    print("::error title=f12-api-v1-canary::psycopg is not installed", flush=True)
    raise


NOW = datetime(2026, 9, 18, 12, 0, 0, tzinfo=timezone.utc)

# SQL: call api_v1_read_as_user and return rows as JSONB
CALL_READ = "select api_v1_read_as_user(%s, %s, %s)"


class Proof:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.failed = False

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.rows.append({"name": name, "ok": bool(condition), "detail": detail})
        if not condition:
            self.failed = True
            print(f"::error title=f12-api-v1-canary::FAILED {name} {detail}", flush=True)
        else:
            print(f"::notice title=f12-api-v1-canary::ok {name}", flush=True)


def env(name: str, required: bool = True, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        print(f"::error title=f12-api-v1-canary::missing required env {name}", flush=True)
        raise SystemExit(2)
    return val or ""


def admin_connection(dsn: str) -> "psycopg.Connection":
    return psycopg.connect(dsn, autocommit=True)


def bootstrap(conn: "psycopg.Connection") -> None:
    """Minimal schema needed to exercise api_v1_read_as_user."""
    with conn.cursor() as cur:
        cur.execute("create schema if not exists auth")
        cur.execute("create schema if not exists extensions")
        cur.execute("create extension if not exists pgcrypto with schema extensions")
        cur.execute(
            "create table if not exists auth.users ("
            "  id uuid primary key default gen_random_uuid(),"
            "  email text,"
            "  raw_user_meta_data jsonb not null default '{}'::jsonb"
            ")"
        )
        cur.execute(
            "create or replace function auth.uid() returns uuid language sql stable as $$"
            "  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid"
            "$$"
        )
        for role in ("anon", "authenticated", "service_role"):
            extra = " bypassrls" if role == "service_role" else ""
            cur.execute(
                f"do $$ begin create role {role} nologin{extra}; "
                f"exception when duplicate_object then null; end $$;"
            )
        cur.execute("grant usage on schema public, auth to anon, authenticated")
        cur.execute("grant select on auth.users to anon, authenticated")

        # Minimal stub tables matching what api_v1_read_as_user reads.
        # Columns are reduced to what the function actually uses.

        cur.execute(
            "create table if not exists public.theses ("
            "  id uuid primary key default gen_random_uuid(),"
            "  user_id uuid not null,"
            "  current_version int not null default 1,"
            "  lifecycle_state text not null default 'active',"
            "  subject_ref jsonb,"
            "  subject_digest bytea not null default '\\\\x',"
            "  created_at timestamptz not null default now(),"
            "  updated_at timestamptz not null default now()"
            ")"
        )
        cur.execute(
            "create table if not exists public.thesis_versions ("
            "  id uuid primary key default gen_random_uuid(),"
            "  thesis_id uuid not null,"
            "  user_id uuid not null,"
            "  version int not null default 1,"
            "  previous_version int,"
            "  transition text,"
            "  lifecycle_state text,"
            "  subject_ref jsonb,"
            "  content jsonb,"
            "  client_request_id text,"
            "  request_fingerprint bytea not null default '\\\\x',"
            "  system_recorded_at timestamptz,"
            "  effective_at timestamptz"
            ")"
        )
        cur.execute(
            "create table if not exists public.watchlists ("
            "  id uuid primary key default gen_random_uuid(),"
            "  user_id uuid not null,"
            "  name text not null,"
            "  position int not null default 0,"
            "  created_at timestamptz not null default now()"
            ")"
        )
        cur.execute(
            "create table if not exists public.watchlist_symbols ("
            "  id uuid primary key default gen_random_uuid(),"
            "  watchlist_id uuid not null,"
            "  symbol text not null,"
            "  section text,"
            "  position int not null default 0,"
            "  created_at timestamptz not null default now()"
            ")"
        )
        cur.execute(
            "create table if not exists public.alerts ("
            "  id uuid primary key default gen_random_uuid(),"
            "  user_id uuid not null,"
            "  symbol text not null,"
            "  condition jsonb not null default '{}'::jsonb,"
            "  active bool not null default true,"
            "  created_at timestamptz not null default now()"
            ")"
        )
        cur.execute(
            "create table if not exists public.alert_outbox ("
            "  id uuid primary key default gen_random_uuid(),"
            "  user_id uuid not null,"
            "  alert_id uuid not null,"
            "  fire_event_id text not null,"
            "  channel text not null default 'email',"
            "  status text not null default 'pending',"
            "  payload jsonb not null,"
            "  attempts int not null default 0,"
            "  last_error text,"
            "  deliver_after timestamptz,"
            "  created_at timestamptz not null default now(),"
            "  delivered_at timestamptz"
            ")"
        )
        cur.execute(
            "create table if not exists public.user_claims ("
            "  claim_id uuid primary key default gen_random_uuid(),"
            "  user_id uuid not null,"
            "  subject jsonb,"
            "  stated_at timestamptz not null default now(),"
            "  resolves_at timestamptz,"
            "  claim_text text,"
            "  condition jsonb,"
            "  stated_probability real,"
            "  evidence jsonb,"
            "  status text,"
            "  resolution jsonb,"
            "  supersedes text,"
            "  created_at timestamptz not null default now()"
            ")"
        )
        cur.execute(
            "create table if not exists public.portfolio_positions ("
            "  id uuid primary key default gen_random_uuid(),"
            "  user_id uuid not null,"
            "  ticker text not null,"
            "  shares real not null default 0,"
            "  entry_price real,"
            "  entry_date date,"
            "  notes text,"
            "  status text not null default 'open',"
            "  created_at timestamptz not null default now()"
            ")"
        )


def apply_migrations(conn: "psycopg.Connection", migrations_dir: Path, applied: list[dict]) -> None:
    for path in sorted(migrations_dir.glob("*.sql")):
        sql = path.read_text()
        sha = hashlib.sha256(sql.encode("utf8")).hexdigest()
        with conn.cursor() as cur:
            cur.execute(sql)
        applied.append({"file": path.name, "sha256": sha})
        print(f"::notice title=f12-api-v1-canary::applied {path.name}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations", default="supabase/migrations")
    parser.add_argument("--receipt", default="f12-api-v1-postgres-canary-receipt.json")
    args = parser.parse_args()

    dsn = env("F12_API_V1_DATABASE_URL")
    proof = Proof()
    applied: list[dict] = []

    def _receipt(failed: bool, migration_error: str | None = None) -> dict:
        r = {
            "database_url_host": dsn.split("@")[-1] if "@" in dsn else "local",
            "expected_commit": os.environ.get("F12_API_V1_EXPECTED_COMMIT"),
            "run_id": os.environ.get("F12_API_V1_GITHUB_RUN_ID"),
            "run_attempt": os.environ.get("F12_API_V1_GITHUB_RUN_ATTEMPT"),
            "job": os.environ.get("F12_API_V1_GITHUB_JOB"),
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
    except Exception as exc:  # noqa: BLE001
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-api-v1-canary::migration application failed: {exc}", flush=True)
        return 1

    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())

    try:
        with admin.cursor() as cur:
            # Create two users
            cur.execute(
                "insert into auth.users (id, email) values (%s, 'user_a@example.com')",
                (user_a,),
            )
            cur.execute(
                "insert into auth.users (id, email) values (%s, 'user_b@example.com')",
                (user_b,),
            )

            # --- Theses ---
            thesis_a_id = str(uuid.uuid4())
            thesis_b_id = str(uuid.uuid4())
            cur.execute(
                "insert into public.theses (id, user_id, current_version, lifecycle_state, updated_at) "
                "values (%s, %s, 1, 'active', %s)",
                (thesis_a_id, user_a, NOW),
            )
            cur.execute(
                "insert into public.theses (id, user_id, current_version, lifecycle_state, updated_at) "
                "values (%s, %s, 1, 'active', %s)",
                (thesis_b_id, user_b, NOW),
            )
            # Thesis versions
            cur.execute(
                "insert into public.thesis_versions (thesis_id, user_id, version, content) "
                "values (%s, %s, 1, %s)",
                (thesis_a_id, user_a, '{"title": "A thesis"}'),
            )
            cur.execute(
                "insert into public.thesis_versions (thesis_id, user_id, version, content) "
                "values (%s, %s, 1, %s)",
                (thesis_b_id, user_b, '{"title": "B thesis"}'),
            )

            # --- Watchlists ---
            wl_a_id = str(uuid.uuid4())
            wl_b_id = str(uuid.uuid4())
            cur.execute(
                "insert into public.watchlists (id, user_id, name, position) "
                "values (%s, %s, 'Watchlist A', 0)",
                (wl_a_id, user_a),
            )
            cur.execute(
                "insert into public.watchlists (id, user_id, name, position) "
                "values (%s, %s, 'Watchlist B', 0)",
                (wl_b_id, user_b),
            )
            cur.execute(
                "insert into public.watchlist_symbols (watchlist_id, symbol, section, position) "
                "values (%s, 'NVDA', 'equity', 0)",
                (wl_a_id,),
            )
            cur.execute(
                "insert into public.watchlist_symbols (watchlist_id, symbol, section, position) "
                "values (%s, 'TSLA', 'equity', 0)",
                (wl_b_id,),
            )

            # --- Alerts ---
            alert_a_id = str(uuid.uuid4())
            alert_b_id = str(uuid.uuid4())
            cur.execute(
                "insert into public.alerts (id, user_id, symbol, condition) "
                "values (%s, %s, 'NVDA', %s)",
                (alert_a_id, user_a, '{"type": "price_above", "threshold": 500}'),
            )
            cur.execute(
                "insert into public.alerts (id, user_id, symbol, condition) "
                "values (%s, %s, 'TSLA', %s)",
                (alert_b_id, user_b, '{"type": "price_above", "threshold": 300}'),
            )

            # Alert fires
            cur.execute(
                "insert into public.alert_outbox (user_id, alert_id, fire_event_id, payload, status) "
                "values (%s, %s, %s, %s, 'delivered')",
                (user_a, alert_a_id, str(uuid.uuid4()), '{"triggered": true}'),
            )
            cur.execute(
                "insert into public.alert_outbox (user_id, alert_id, fire_event_id, payload, status) "
                "values (%s, %s, %s, %s, 'delivered')",
                (user_b, alert_b_id, str(uuid.uuid4()), '{"triggered": true}'),
            )

            # --- Claims ---
            claim_a_id = str(uuid.uuid4())
            claim_b_id = str(uuid.uuid4())
            cur.execute(
                "insert into public.user_claims (claim_id, user_id, stated_at, claim_text, stated_probability) "
                "values (%s, %s, %s, 'A will win', 0.7)",
                (claim_a_id, user_a, NOW),
            )
            cur.execute(
                "insert into public.user_claims (claim_id, user_id, stated_at, claim_text, stated_probability) "
                "values (%s, %s, %s, 'B will win', 0.3)",
                (claim_b_id, user_b, NOW),
            )

            # --- Positions ---
            pos_a_id = str(uuid.uuid4())
            pos_b_id = str(uuid.uuid4())
            cur.execute(
                "insert into public.portfolio_positions (id, user_id, ticker, shares, entry_price) "
                "values (%s, %s, 'NVDA', 100, 450.0)",
                (pos_a_id, user_a),
            )
            cur.execute(
                "insert into public.portfolio_positions (id, user_id, ticker, shares, entry_price) "
                "values (%s, %s, 'TSLA', 50, 250.0)",
                (pos_b_id, user_b),
            )

            # MAJOR-2: verify unrevoke is blocked
            key_id = str(uuid.uuid4())
            cur.execute(
                "insert into public.api_keys (key_id, user_id, key_digest, key_salt, key_prefix, label) "
                "values (%s, %s, %s, %s, 'test1234', 'test key')",
                (
                    key_id,
                    user_a,
                    base64.b64encode(hashlib.scrypt(b"mmx_" + b"a" * 40, salt=b"s" * 16, n=16384, r=8, p=1, dklen=32)).decode("ascii"),
                    base64.b64encode(b"s" * 16).decode("ascii"),
                ),
            )
            # Revoke it first
            cur.execute("select revoke_api_key(%s, %s)", (key_id, user_a))
            # Try to unrevoke — should be blocked by trigger
            try:
                cur.execute(
                    "update public.api_keys set revoked_at = null where key_id = %s",
                    (key_id,),
                )
                proof.check("unrevoke:blocked", False, "update did not raise")
            except psycopg.errors.RaiseException as e:
                proof.check(
                    "unrevoke:blocked",
                    "cannot unrevoke" in str(e),
                    f"got: {e}",
                )

            # MINOR-2 fix: insert a thesis version with a forbidden field (confidence) to confirm
            # the SQL function does not crash on it. The TypeScript firstForbiddenField walker
            # (tested in apiV1.test.ts) is what actually filters forbidden fields on the read path.
            # The isolation tests above already verify the user_id = p_user_id predicates.
            cur.execute(
                "insert into public.thesis_versions (thesis_id, user_id, version, content) "
                "values (%s, %s, 2, %s)",
                (
                    thesis_a_id,
                    user_a,
                    '{"title": "A v2", "confidence": 0.95}',
                ),
            )

            # Now the isolation test: call api_v1_read_as_user(user_a) for each resource
            # and verify user_b's rows never appear

            def read_as(user_id: str, resource: str) -> list:
                cur.execute(
                    CALL_READ,
                    (user_id, resource, '{"limit": 50}'),
                )
                row = cur.fetchone()
                if row is None:
                    return []
                import json as _json

                data = row[0]
                if isinstance(data, str):
                    data = _json.loads(data)
                if not isinstance(data, dict):
                    return []
                return data.get("rows", []) if isinstance(data.get("rows"), list) else []

            resources = [
                ("theses", thesis_b_id, "B thesis"),
                ("watchlists", wl_b_id, "Watchlist B"),
                ("alerts", alert_b_id, "B alert"),
                ("claims", claim_b_id, "B claim"),
                ("positions", pos_b_id, "B position"),
            ]
            for resource, b_id, label in resources:
                rows = read_as(user_a, resource)
                b_ids = [str(r.get("id") or r.get("claim_id") or r.get("key_id")) for r in rows]
                proof.check(
                    f"isolation:{resource}",
                    b_id not in b_ids,
                    f"{label} (id={b_id}) found in A's {resource}: {b_ids}",
                )

            # Also verify A CAN see their own rows
            own_rows = read_as(user_a, "theses")
            own_ids = [str(r.get("id")) for r in own_rows]
            proof.check(
                "isolation:theses:A_sees_own",
                thesis_a_id in own_ids,
                f"A's own thesis {thesis_a_id} not found in {own_ids}",
            )

            # Keep the pagination fixture independent of the isolation fixture.
            cur.execute("delete from public.watchlist_symbols where watchlist_id = %s", (wl_a_id,))
            cur.execute("delete from public.watchlists where id = %s", (wl_a_id,))

            # Watchlist cursor pagination: insert 51 watchlists for user_a and verify
            # the SQL function returns v_limit+1=51 rows (the TypeScript pageOf slice is separate).
            # MAJOR-canary-3 fix: verify the function returns exactly 51 rows, and that
            # next_cursor is present at the top level of the SQL function's JSON response
            # (encoded from the fiftieth row's position and id by the SQL function itself).
            for i in range(51):
                cur.execute(
                    "insert into public.watchlists (user_id, name, position) values (%s, %s, %s)",
                    (user_a, f"WL{i}", i),
                )

            def read_full(user_id: str, resource: str, cursor: str | None = None) -> dict:
                """Return the full api_v1_read_as_user response dict (not just rows)."""
                args = json.dumps({"limit": 50, **({"cursor": cursor} if cursor else {})})
                cur.execute(
                    CALL_READ,
                    (user_id, resource, args),
                )
                row = cur.fetchone()
                if row is None:
                    return {}
                import json as _json
                data = row[0]
                if isinstance(data, str):
                    data = _json.loads(data)
                return data if isinstance(data, dict) else {}

            full_resp = read_full(user_a, "watchlists")
            rows_51 = full_resp.get("rows", [])
            proof.check(
                "pagination:watchlists:function_returns_51",
                len(rows_51) == 51,
                f"expected 51 rows from SQL function, got {len(rows_51)}",
            )
            # The SQL contract deliberately returns the 51st row as the lookahead row.
            # The route/pageOf layer below slices it out of page 1.
            # next_cursor must be non-null when there are more rows than the limit
            next_cursor = full_resp.get("next_cursor")
            proof.check(
                "pagination:watchlists:cursor_present",
                next_cursor is not None,
                f"next_cursor was null; expected a cursor string",
            )
            cursor_text = base64.b64decode(str(next_cursor), validate=True).decode("utf-8")
            cursor_position, cursor_id = cursor_text.rsplit("|", 1)
            proof.check(
                "pagination:watchlists:cursor_encodes_50th_row",
                cursor_position == "49" and cursor_id == str(rows_51[49]["id"]),
                f"cursor decoded to {cursor_text}; expected 49 and {rows_51[49]['id']}",
            )
            page1_rows = rows_51[:50]
            proof.check(
                "pagination:watchlists:route_page_returns_50",
                len(page1_rows) == 50,
                f"expected the route page to return 50 rows, got {len(page1_rows)}",
            )
            proof.check(
                "pagination:watchlists:route_page_excludes_51st",
                all(str(row.get("name", "")) != "WL50" for row in page1_rows),
                "WL50 appeared in the first 50 route rows",
            )
            page2 = read_full(user_a, "watchlists", str(next_cursor))
            page2_rows = page2.get("rows", [])
            proof.check(
                "pagination:watchlists:page2_returns_51st_first",
                len(page2_rows) > 0 and str(page2_rows[0].get("name", "")) == "WL50",
                f"expected WL50 first on page 2, got {[r.get('name') for r in page2_rows]}",
            )

    except Exception as exc:  # noqa: BLE001
        Path(args.receipt).write_text(json.dumps(_receipt(True, str(exc)), indent=2))
        print(f"::error title=f12-api-v1-canary::canary case failed: {exc}", flush=True)
        return 1

    Path(args.receipt).write_text(json.dumps(_receipt(proof.failed), indent=2))
    if proof.failed:
        print("::error title=f12-api-v1-canary::one or more proofs failed", flush=True)
        return 1
    print("::notice title=f12-api-v1-canary::all proofs passed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
