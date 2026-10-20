#!/usr/bin/env python3
"""Qualify 0037 in a new, disposable local PostgreSQL cluster; never a remote database.

Runs the actual migration twice, tests RLS as authenticated/anon roles, and races
quota insertions on separate connections. Synthetic account and source IDs only.
No credentials, shared databases, or production service are used.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
A = "10000000-0000-4000-8000-000000000001"
B = "10000000-0000-4000-8000-000000000002"
WATCH = "20000000-0000-4000-8000-000000000001"
GEN = "a" * 64
REV = "b" * 64


def qualify() -> dict:
    binaries = {}
    for name in ("initdb", "pg_ctl", "psql"):
        path = shutil.which(name)
        if not path:
            raise RuntimeError("PostgreSQL binaries required: " + name)
        binaries[name] = path
    with tempfile.TemporaryDirectory(prefix="medtech-r14-pg-") as temporary:
        root = Path(temporary)
        data, socket = root / "data", root / "socket"
        socket.mkdir(mode=0o700)
        subprocess.run([binaries["initdb"], "-D", str(data), "-A", "trust",
                        "--no-locale", "-E", "UTF8"], check=True, capture_output=True)
        started = False
        environment = {**os.environ}
        # Do not inherit an unrelated session's database target, role or credential.
        for key in list(environment):
            if key.startswith("PG"):
                del environment[key]
        command = [binaries["psql"], "-X", "-h", str(socket), "-p", "55437",
                   "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"]
        checks = []

        def sql(statement: str, user: str | None = None, *, error: str | None = None) -> str:
            prefix = ""
            if user is not None:
                prefix = "SET ROLE authenticated; SET request.jwt.claim.sub = '" + user + "'; "
            result = subprocess.run(command, input=prefix + statement, text=True,
                                    capture_output=True, env=environment, timeout=15)
            if error:
                assert result.returncode != 0 and error in result.stderr, result.stderr
            elif result.returncode:
                raise AssertionError(result.stderr)
            return result.stdout.strip()

        def check(name: str, condition: bool = True):
            assert condition, name
            checks.append(name)

        try:
            options = "-F -c listen_addresses='' -c max_connections=12 -c shared_buffers=16MB -k " + str(socket) + " -p 55437"
            subprocess.run([binaries["pg_ctl"], "-D", str(data), "-l", str(root / "postgres.log"),
                            "-o", options, "-w", "start"], check=True, capture_output=True, env=environment)
            started = True
            sql("""
                CREATE ROLE authenticated NOLOGIN;
                CREATE ROLE anon NOLOGIN;
                CREATE SCHEMA auth;
                CREATE TABLE auth.users(id uuid PRIMARY KEY);
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
                AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
                GRANT USAGE ON SCHEMA auth TO authenticated, anon;
            """)
            sql("INSERT INTO auth.users VALUES ('" + A + "'),('" + B + "')")
            migration = (ROOT / "supabase/migrations/0037_medtech_watches.sql").read_text()
            sql(migration)
            sql(migration)
            check("migration executes twice")
            check("both tables force RLS", sql(
                "SELECT count(*) FROM pg_class WHERE relname IN "
                "('medtech_watches','medtech_reviewed_changes') AND relrowsecurity AND relforcerowsecurity") == "2")
            insert = (
                "INSERT INTO public.medtech_watches(id,user_id,subject_type,subject_id,triggers,"
                "baseline_generation,baseline_revision,baseline_at,version) VALUES "
                "('" + WATCH + "','" + A + "','event','fda-510k-K260001',ARRAY['record_changed'],"
                "'" + GEN + "','" + REV + "','1970-01-01',999)"
            )
            sql(insert, A)
            check("database sets subscription baseline and version", sql(
                "SELECT version=1 AND baseline_at > now()-interval '10 seconds' "
                "FROM medtech_watches WHERE id='" + WATCH + "'", A) == "t")
            check("other account cannot read", sql("SELECT count(*) FROM medtech_watches", B) == "0")
            check("other account cannot update", sql(
                "WITH changed AS (UPDATE medtech_watches SET triggers=ARRAY['record_changed'] RETURNING id)"
                " SELECT count(*) FROM changed", B) == "0")
            check("other account cannot delete", sql(
                "WITH removed AS (DELETE FROM medtech_watches RETURNING id) SELECT count(*) FROM removed", B) == "0")
            sql(insert.replace(WATCH, "20000000-0000-4000-8000-000000000002")
                .replace("K260001", "K260002"), B, error="row-level security")
            check("cross-account insert refused")
            sql("SET ROLE anon; SELECT * FROM medtech_watches", error="permission denied")
            check("anonymous table access refused")
            sql("UPDATE medtech_watches SET baseline_at='1970-01-01'", A, error="medtech_watch_identity_immutable")
            check("subscription baseline immutable")
            sql("UPDATE medtech_watches SET subject_id='fda-510k-K260002'", A, error="medtech_watch_identity_immutable")
            check("watch subject immutable")
            check("first CAS edit advances version", sql(
                "UPDATE medtech_watches SET triggers=ARRAY['record_changed'] WHERE version=1 RETURNING version", A) == "2")
            check("stale CAS edit makes no change", sql(
                "UPDATE medtech_watches SET triggers=ARRAY['record_changed'] WHERE version=1 RETURNING version", A) == "")
            review = (
                "INSERT INTO medtech_reviewed_changes(user_id,watch_id,event_id,revision_id,reviewed_at) "
                "VALUES ('" + A + "','" + WATCH + "','fda-510k-K260001','" + REV + "','1970-01-01')"
            )
            sql(review, A)
            sql(review + " ON CONFLICT DO NOTHING", A)
            check("duplicate review retains one receipt", sql("SELECT count(*) FROM medtech_reviewed_changes", A) == "1")
            check("review clock is server-owned", sql(
                "SELECT reviewed_at > now()-interval '10 seconds' FROM medtech_reviewed_changes", A) == "t")
            sql(review.replace(A, B).replace(REV, "c" * 64), B, error="foreign key constraint")
            check("review cannot reference another account's watch")
            check("other account cannot read reviews", sql("SELECT count(*) FROM medtech_reviewed_changes", B) == "0")
            sql("UPDATE medtech_reviewed_changes SET revision_id='" + ("c" * 64) + "'", A, error="permission denied")
            check("review cannot acknowledge a different future revision")

            # 49 watches, then two simultaneous requests for the final slot.
            sql(
                "INSERT INTO medtech_watches(user_id,subject_type,subject_id,triggers,baseline_generation,baseline_revision)"
                " SELECT '" + A + "','event','fda-510k-K' || lpad(n::text,6,'0'),ARRAY['record_changed'],"
                "'" + GEN + "','" + REV + "' FROM generate_series(100001,100048) n", A)
            def race(number: int):
                statement = (
                    "SET ROLE authenticated; SET request.jwt.claim.sub='" + A + "';"
                    "INSERT INTO medtech_watches(user_id,subject_type,subject_id,triggers,baseline_generation,baseline_revision)"
                    "VALUES ('" + A + "','event','fda-510k-K" + str(number) + "',ARRAY['record_changed'],"
                    "'" + GEN + "','" + REV + "')"
                )
                return subprocess.run(command, input=statement, text=True, capture_output=True,
                                      env=environment, timeout=15)
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(race, [200001, 200002]))
            check("concurrent quota allows exactly one final insertion",
                  sorted(r.returncode for r in results) == [0, 3] and
                  any("medtech_watch_limit" in r.stderr for r in results))
            check("quota remains 50", sql("SELECT count(*) FROM medtech_watches", A) == "50")
            sql("DELETE FROM medtech_watches WHERE id='" + WATCH + "' AND version=2", A)
            check("deleting a watch cascades only its review state", sql("SELECT count(*) FROM medtech_reviewed_changes", A) == "0")
            return {"schema": "medtech.local_sql_qualification/v1", "checks_passed": len(checks),
                    "checks": checks, "database": "disposable local PostgreSQL",
                    "production_applied": False, "migration_applied_twice": True}
        finally:
            if started:
                subprocess.run([binaries["pg_ctl"], "-D", str(data), "-m", "fast", "-w", "stop"],
                               check=True, capture_output=True, env=environment)


if __name__ == "__main__":
    print(json.dumps(qualify(), indent=2))
