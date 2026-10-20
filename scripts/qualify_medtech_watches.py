#!/usr/bin/env python3
"""Qualify 0037 in a new, disposable local PostgreSQL cluster; never a remote database.

Runs the actual migration twice, tests RLS as authenticated/anon roles, and races
quota insertions on separate connections. Synthetic account and source IDs only.
No credentials, shared databases, or production service are used.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import io
import supabase_apply
import hashlib
from datetime import datetime, timezone
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
                -- Exercise platform defaults instead of an artificially narrow empty cluster.
                ALTER DEFAULT PRIVILEGES IN SCHEMA public
                  GRANT ALL ON TABLES TO authenticated, anon;
            """)
            sql("INSERT INTO auth.users VALUES ('" + A + "'),('" + B + "')")
            migration_path = ROOT / "supabase/migrations/0037_medtech_watches.sql"
            migration = migration_path.read_text()

            def applier_query(statement: str):
                if statement.lstrip().upper().startswith("SELECT"):
                    return json.loads(sql("SELECT coalesce(json_agg(q), '[]'::json) FROM (" + statement.rstrip("; ") + ") q"))
                sql(statement)
                return []

            def apply_file(path: Path, receipt_name: str):
                receipt_path = root / receipt_name
                output = io.StringIO()
                code = supabase_apply.run_apply(path, runner=applier_query,
                    receipt_path=receipt_path, project_ref="disposable-local-only", out=output)
                receipt = json.loads(receipt_path.read_text())
                return code, receipt

            code, first_receipt = apply_file(migration_path, "first-apply.json")
            if code != 0:
                raise AssertionError(json.dumps(first_receipt, indent=2))
            check("incumbent per-file applier succeeds on an empty catalog",
                  code == 0 and first_receipt["status"] == "applied"
                  and all(entry["rows"] == [] for entry in first_receipt["pre"]))
            catalog = first_receipt["post"][1]["rows"]
            watches, reviews = "medtech_watches", "medtech_reviewed_changes"
            expected_catalog = {
                ("table", watches, watches, None), ("table", reviews, reviews, None),
                ("index", "medtech_watches_user_created", watches, None),
                ("index", "medtech_reviews_user_watch", reviews, None),
                ("policy", "medtech_watches_owner", watches, None),
                ("policy", "medtech_reviews_read", reviews, None),
                ("policy", "medtech_reviews_insert", reviews, None),
                ("policy", "medtech_reviews_delete", reviews, None),
                ("trigger", "medtech_watch_guard", watches, None),
                ("trigger", "medtech_review_guard", reviews, None),
                ("function", "medtech_watch_guard", watches, "public.medtech_watch_guard()"),
                ("function", "medtech_review_guard", reviews, "public.medtech_review_guard()"),
            }
            actual_catalog = {(row["object_kind"], row["object_name"], row["owner_table"], row["function_signature"]) for row in catalog}
            check("readback proves all twelve typed objects in their owning public relations",
                  len(catalog) == 12 and actual_catalog == expected_catalog
                  and all(row["object_schema"] == "public" for row in catalog)
                  and first_receipt["missing_after"] == [])
            privilege_rows = first_receipt["post"][0]["rows"]
            check("readback proves RLS privileges policies and guards for both tables",
                  {row["relname"] for row in privilege_rows} == {watches, reviews}
                  and all(row["relrowsecurity"] and row["relforcerowsecurity"]
                      and not row["anon_any_privilege"] and not row["authenticated_unsafe_privilege"]
                      and row["authenticated_select"] and row["authenticated_insert"] and row["authenticated_delete"]
                      and row["authenticated_update"] == (row["relname"] == watches)
                      and row["policies"] == (1 if row["relname"] == watches else 3)
                      and row["guards"] == 1 for row in privilege_rows))

            # Same-named functions must not hide a missing trigger from typed closure.
            sql("DROP TRIGGER medtech_watch_guard ON public.medtech_watches")
            absent_post = [{"statement": statement, "rows": applier_query(statement)}
                           for statement in supabase_apply.readback_statements(migration)]
            absent_catalog = absent_post[1]["rows"]
            absent_typed = {(row["object_kind"], row["object_name"], row["owner_table"], row["function_signature"]) for row in absent_catalog}
            check("typed readback rejects a missing trigger while its same-named function survives",
                  sql("SELECT to_regprocedure('public.medtech_watch_guard()') IS NOT NULL") == "t"
                  and supabase_apply.missing_after(supabase_apply.expected_objects(
                      supabase_apply.split_statements(migration)), absent_post) == []
                  and absent_typed != expected_catalog
                  and not any(row["object_kind"] == "trigger" and row["object_name"] == "medtech_watch_guard" for row in absent_catalog))
            absence_control = {"removed": "trigger public.medtech_watches.medtech_watch_guard",
                "same_named_function_survived": True, "bare_name_match_missing": [],
                "typed_closure_rejected": True, "catalog_rows": absent_catalog}

            # The old count-only readback must fail even when the DDL succeeded.
            negative_text = migration.split("\n--\n-- SELECT 'table' AS object_kind,")[0] + "\n"
            negative_path = root / "0037_count_only_negative_control.sql"
            negative_path.write_text(negative_text)
            assert supabase_apply.split_statements(negative_text) == supabase_apply.split_statements(migration)
            negative_code, negative_receipt = apply_file(negative_path, "negative-control.json")
            expected_missing = [f"{obj.kind} {obj.name}" for obj in supabase_apply.expected_objects(
                supabase_apply.split_statements(migration)) if obj.kind != "table"]
            check("count-only negative control reproduces failed_readback with ten missing typed entries",
                  negative_code == 6 and negative_receipt["status"] == "failed_readback"
                  and negative_receipt["missing_after"] == expected_missing and len(expected_missing) == 10)
            # Reapplication must also remove privileges left by an earlier installation.
            sql("GRANT ALL ON medtech_watches, medtech_reviewed_changes TO authenticated, anon")
            replay_code, replay_receipt = apply_file(migration_path, "replay.json")
            check("incumbent per-file applier replay succeeds with complete object readback",
                  replay_code == 0 and replay_receipt["status"] == "applied" and replay_receipt["missing_after"] == [])
            check("migration executes twice and repairs inherited grants")
            check("authenticated table privileges are limited", sql(
                "SELECT has_table_privilege('authenticated','medtech_watches','TRUNCATE') "
                "OR has_table_privilege('authenticated','medtech_reviewed_changes','TRUNCATE') "
                "OR has_table_privilege('authenticated','medtech_reviewed_changes','UPDATE') "
                "OR has_table_privilege('authenticated','medtech_watches','TRIGGER') "
                "OR has_table_privilege('authenticated','medtech_watches','REFERENCES')") == "f")
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
            sql("TRUNCATE medtech_watches CASCADE", B, error="permission denied")
            sql("TRUNCATE medtech_reviewed_changes", B, error="permission denied")
            check("table-wide truncation is refused and owner data survives",
                  sql("SELECT count(*) FROM medtech_watches", A) == "1")
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
            check("existing review revision updates are denied")
            sql(review.replace("fda-510k-K260001", "fda-pma-P999999").replace(REV, "d" * 64),
                A, error="medtech_review_subject_mismatch")
            check("fresh review insert must match its event watch")
            family_watch = "30000000-0000-4000-8000-000000000001"
            sql("INSERT INTO medtech_watches(id,user_id,subject_type,subject_id,triggers,baseline_generation) "
                "VALUES ('" + family_watch + "','" + B + "','pma_application','fda-pma-P260001',"
                "ARRAY['record_changed','new_supplement'],'" + GEN + "')", B)
            family_review = ("INSERT INTO medtech_reviewed_changes(user_id,watch_id,event_id,revision_id) "
                             "VALUES ('" + B + "','" + family_watch + "','{}','" + REV + "')")
            sql(family_review.format("fda-pma-P260001"), B)
            sql(family_review.format("fda-pma-P260001-S001"), B)
            check("PMA family accepts its parent and supplements",
                  sql("SELECT count(*) FROM medtech_reviewed_changes", B) == "2")
            sql(family_review.format("fda-pma-P260002-S001"), B, error="medtech_review_subject_mismatch")
            check("PMA family rejects another application")

            for index, event_id in enumerate(
                    ("fda-510k-DEN230001", "fda-pma-N12345", "fda-pma-N12345-S001"), 1):
                exact_watch = "40000000-0000-4000-8000-" + str(index).zfill(12)
                exact_insert = (
                    "INSERT INTO medtech_watches(id,user_id,subject_type,subject_id,triggers,"
                    "baseline_generation,baseline_revision) VALUES "
                    "('" + exact_watch + "','" + B + "','event','" + event_id + "',"
                    "ARRAY['record_changed'],'" + GEN + "','" + REV + "')")
                sql(exact_insert, B)
                sql("INSERT INTO medtech_reviewed_changes(user_id,watch_id,event_id,revision_id) "
                    "VALUES ('" + B + "','" + exact_watch + "','" + event_id + "','" + REV + "')", B)
                check("native FDA identifier can be watched and reviewed: " + event_id,
                      sql("SELECT count(*) FROM medtech_reviewed_changes WHERE watch_id='" + exact_watch + "'", B) == "1")
                sql("DELETE FROM medtech_watches WHERE id='" + exact_watch + "'", B)

            invalid_insert = (
                "INSERT INTO medtech_watches(user_id,subject_type,subject_id,triggers,"
                "baseline_generation,baseline_revision) VALUES "
                "('" + B + "','event','{}',ARRAY['record_changed'],'" + GEN + "','" + REV + "')")
            for event_id in ("fda-510k-K260001-S001", "fda-510k-DEN230001-S001",
                             "fda-pma-DEN230001", "fda-pma-N1234", "fda-510k-K260001\n"):
                sql(invalid_insert.format(event_id), B, error="medtech_watches_subject")
            check("invalid or inexact FDA identifiers are rejected by SQL")
            sql(family_review.format("fda-pma-P260001-S001junk"), B,
                error="medtech_reviewed_changes_event_id_check")
            check("family review identifiers must still be exact FDA identifiers")
            for subject_id in ("fda-pma-N12345", "fda-pma-P260001-S001"):
                sql("INSERT INTO medtech_watches(user_id,subject_type,subject_id,triggers,baseline_generation) "
                    "VALUES ('" + B + "','pma_application','" + subject_id + "',"
                    "ARRAY['new_supplement'],'" + GEN + "')", B, error="medtech_watches_subject")
            check("application families remain limited to parent P numbers")

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
            return {"schema": "medtech.local_sql_qualification/v1",
                    "qualified_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "migration_sha256": hashlib.sha256(migration.encode("utf-8")).hexdigest(),
                    "qualifier_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    "checks_passed": len(checks),
                    "checks": checks, "database": "disposable local PostgreSQL",
                    "production_applied": False, "migration_applied_twice": True,
                    "broad_default_and_prior_table_grants_tested": True,
                    "incumbent_applier": {
                        "source_sha256": hashlib.sha256((ROOT / "scripts/supabase_apply.py").read_bytes()).hexdigest(),
                        "transport": "isolated local psql; production CurlRunner and HTTP transport not exercised",
                        "first_apply": first_receipt, "replay": replay_receipt,
                        "trigger_absence_control": absence_control,
                        "count_only_negative_control": {
                            "sql_sha256": hashlib.sha256(negative_text.encode()).hexdigest(),
                            "executable_statements_identical": True, "exit_code": negative_code,
                            "status": negative_receipt["status"], "missing_after": negative_receipt["missing_after"]}}}
        finally:
            if started:
                subprocess.run([binaries["pg_ctl"], "-D", str(data), "-m", "fast", "-w", "stop"],
                               check=True, capture_output=True, env=environment)


if __name__ == "__main__":
    print(json.dumps(qualify(), indent=2))
