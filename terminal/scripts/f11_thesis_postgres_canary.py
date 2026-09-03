#!/usr/bin/env python3
"""Disposable PostgreSQL proof for F11 thesis migration, RLS, CAS, and lineage."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from typing import Any, Callable

import psycopg


USER_A = "10000000-0000-4000-8000-000000000001"
USER_B = "10000000-0000-4000-8000-000000000002"
MISSING_THESIS = "20000000-0000-4000-8000-000000000099"
FUNCTION_SIGNATURE = (
    "public.apply_thesis_version_v1(uuid,integer,text,jsonb,jsonb,uuid,timestamptz)"
)


class Proof:
    def __init__(self) -> None:
        self.assertions = 0

    def check(self, condition: bool, code: str) -> None:
        self.assertions += 1
        if not condition:
            raise AssertionError(code)

    def equal(self, actual: Any, expected: Any, code: str) -> None:
        self.check(actual == expected, f"{code}:actual={actual!r}:expected={expected!r}")


def env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"missing_environment:{name}")
    return value


def subject(symbol: str = "NVDA") -> dict[str, Any]:
    return {
        "schema": "mastermind.thesis-subject-ref/v1",
        "kind": "issuer",
        "owner": "terminal.analysis_symbol",
        "key": symbol,
        "identity_state": "listing_scoped",
        "listing": {"symbol": symbol, "mic": None, "security_id": None},
        "company_id": None,
        "display": f"{symbol} fixture",
    }


def content(marker: str, revision_note: str | None = None) -> dict[str, Any]:
    return {
        "schema": "mastermind.thesis-content/v1",
        "title": f"title {marker}",
        "statement": f"statement {marker}",
        "catalysts": [f"catalyst {marker}"],
        "falsifiers": [f"falsifier {marker}"],
        "risks": [f"risk {marker}"],
        "horizon": "quarters",
        "effective_at": None,
        "revision_note": revision_note,
    }


def actor_connection(database_url: str, actor: str) -> psycopg.Connection[Any]:
    connection = psycopg.connect(database_url)
    connection.execute("set role authenticated")
    connection.execute("select set_config('request.jwt.claim.sub', %s, false)", (actor,))
    return connection


def rpc_on_connection(
    connection: psycopg.Connection[Any],
    *,
    thesis_id: str | None,
    expected_version: int,
    transition: str,
    thesis_subject: dict[str, Any],
    thesis_content: Any,
    request_id: str,
) -> dict[str, Any]:
    row = connection.execute(
        """
        select status, thesis_id, version, current_version, lifecycle_state, replayed
        from public.apply_thesis_version_v1(
          %s::uuid, %s::integer, %s::text, %s::jsonb, %s::jsonb, %s::uuid, %s::timestamptz
        )
        """,
        (
            thesis_id,
            expected_version,
            transition,
            json.dumps(thesis_subject, separators=(",", ":")),
            json.dumps(thesis_content, separators=(",", ":")),
            request_id,
            thesis_content.get("effective_at") if isinstance(thesis_content, dict) else None,
        ),
    ).fetchone()
    if row is None:
        raise AssertionError("rpc_returned_no_row")
    return dict(zip(("status", "thesis_id", "version", "current_version", "lifecycle_state", "replayed"), row))


def rpc(
    database_url: str,
    actor: str,
    **call: Any,
) -> dict[str, Any]:
    with actor_connection(database_url, actor) as connection:
        return rpc_on_connection(connection, **call)


def create(
    database_url: str,
    actor: str,
    marker: str,
    request_id: str,
    *,
    symbol: str = "NVDA",
) -> dict[str, Any]:
    return rpc(
        database_url,
        actor,
        thesis_id=None,
        expected_version=0,
        transition="create",
        thesis_subject=subject(symbol),
        thesis_content=content(marker),
        request_id=request_id,
    )


def admin_value(database_url: str, query: str, params: tuple[Any, ...] = ()) -> Any:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(query, params).fetchone()
    if row is None:
        raise AssertionError("admin_query_returned_no_row")
    return row[0]


def admin_row(database_url: str, query: str, params: tuple[Any, ...] = ()) -> tuple[Any, ...]:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(query, params).fetchone()
    if row is None:
        raise AssertionError("admin_query_returned_no_row")
    return row


def expect_database_error(action: Callable[[], Any], proof: Proof, code: str) -> None:
    raised = False
    try:
        action()
    except psycopg.Error:
        raised = True
    proof.check(raised, code)


def bootstrap(database_url: str) -> None:
    sql = """
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    create schema if not exists auth;
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users (id) values
      ('10000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000002')
    on conflict (id) do nothing;
    """
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(sql)


def apply_migration(database_url: str, migration_sql: str) -> None:
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(migration_sql)


def inspect_catalog(database_url: str, proof: Proof) -> dict[str, bool]:
    verdicts: dict[str, bool] = {}

    for table in ("theses", "thesis_versions"):
        owner, rls = admin_row(
            database_url,
            "select relowner::regrole::text, relrowsecurity from pg_class where oid = %s::regclass",
            (f"public.{table}",),
        )
        proof.equal(owner, "postgres", f"catalog_{table}_owner")
        proof.check(rls is True, f"catalog_{table}_rls")
    verdicts["table_owner"] = True
    verdicts["rls_enabled"] = True

    owner, security_definer, configuration = admin_row(
        database_url,
        """
        select p.proowner::regrole::text, p.prosecdef, p.proconfig
        from pg_proc p where p.oid = to_regprocedure(%s)
        """,
        (FUNCTION_SIGNATURE,),
    )
    proof.equal(owner, "postgres", "catalog_function_owner")
    proof.check(security_definer is True, "catalog_security_definer")
    proof.check(
        configuration is not None
        and "search_path=pg_catalog, public, auth, extensions" in configuration,
        "catalog_fixed_search_path",
    )
    verdicts["security_definer"] = True
    verdicts["fixed_search_path"] = True

    policies = admin_value(
        database_url,
        """
        select jsonb_object_agg(policyname, jsonb_build_object('command', cmd, 'roles', roles, 'qual', qual))
        from pg_policies where schemaname = 'public' and tablename in ('theses', 'thesis_versions')
        """,
    )
    proof.equal(set(policies), {"theses_select_own", "thesis_versions_select_own"}, "catalog_policy_names")
    for policy in policies.values():
        proof.equal(policy["command"], "SELECT", "catalog_policy_command")
        proof.check("authenticated" in policy["roles"], "catalog_policy_role")
        proof.check("auth.uid()" in policy["qual"] and "user_id" in policy["qual"], "catalog_policy_qual")
    verdicts["select_policies"] = True

    index_names = set(admin_value(
        database_url,
        """
        select jsonb_agg(indexname) from pg_indexes
        where schemaname = 'public' and tablename in ('theses', 'thesis_versions')
        """,
    ))
    expected_indexes = {
        "theses_pkey", "theses_id_user_id_key", "theses_owner_updated_idx", "theses_owner_subject_idx",
        "thesis_versions_pkey", "thesis_versions_thesis_id_version_key",
        "thesis_versions_user_id_client_request_id_key", "thesis_versions_owner_thesis_idx",
    }
    proof.check(expected_indexes.issubset(index_names), "catalog_indexes")
    verdicts["indexes"] = True

    constraints = admin_value(
        database_url,
        """
        select jsonb_object_agg(conname, jsonb_build_object('type', contype, 'definition', pg_get_constraintdef(oid)))
        from pg_constraint where conrelid in ('public.theses'::regclass, 'public.thesis_versions'::regclass)
        """,
    )
    proof.check(any(item["type"] == "f" and "(thesis_id, user_id)" in item["definition"] for item in constraints.values()), "catalog_owner_fk")
    proof.check(sum(item["type"] == "p" for item in constraints.values()) == 2, "catalog_primary_keys")
    proof.check(sum(item["type"] == "u" for item in constraints.values()) >= 3, "catalog_unique_constraints")
    proof.check(sum(item["type"] == "c" for item in constraints.values()) >= 7, "catalog_check_constraints")
    verdicts["constraints"] = True

    for table in ("public.theses", "public.thesis_versions"):
        proof.check(bool(admin_value(database_url, "select has_table_privilege('authenticated', %s, 'SELECT')", (table,))), f"grant_{table}_select")
        for privilege in ("INSERT", "UPDATE", "DELETE"):
            proof.check(not bool(admin_value(database_url, "select has_table_privilege('authenticated', %s, %s)", (table, privilege))), f"grant_{table}_{privilege}")
        proof.check(not bool(admin_value(database_url, "select has_table_privilege('anon', %s, 'SELECT')", (table,))), f"grant_{table}_anon")
    proof.check(bool(admin_value(database_url, "select has_function_privilege('authenticated', %s, 'EXECUTE')", (FUNCTION_SIGNATURE,))), "grant_rpc_authenticated")
    proof.check(not bool(admin_value(database_url, "select has_function_privilege('anon', %s, 'EXECUTE')", (FUNCTION_SIGNATURE,))), "grant_rpc_anon")
    public_execute = admin_value(
        database_url,
        """
        select exists (
          select 1
          from pg_proc p,
               aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where p.oid = to_regprocedure(%s)
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
        )
        """,
        (FUNCTION_SIGNATURE,),
    )
    proof.check(not bool(public_execute), "grant_rpc_public")
    verdicts["grants"] = True
    return verdicts


def prove_access_boundaries(database_url: str, proof: Proof) -> None:
    def anon_read() -> None:
        with psycopg.connect(database_url) as connection:
            connection.execute("set role anon")
            connection.execute("select count(*) from public.theses").fetchone()

    expect_database_error(anon_read, proof, "anon_table_read_denied")

    for verb, statement in (
        ("insert", "insert into public.theses default values"),
        ("update", "update public.theses set updated_at = now()"),
        ("delete", "delete from public.theses"),
    ):
        def direct_write(sql: str = statement) -> None:
            with actor_connection(database_url, USER_A) as connection:
                connection.execute(sql)

        expect_database_error(direct_write, proof, f"authenticated_direct_{verb}_denied")


def concurrent_rpc(
    database_url: str,
    calls: tuple[dict[str, Any], dict[str, Any]],
) -> list[dict[str, Any]]:
    barrier = Barrier(2)

    def run(call: dict[str, Any]) -> dict[str, Any]:
        with actor_connection(database_url, USER_A) as connection:
            barrier.wait(timeout=10)
            return rpc_on_connection(connection, **call)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(run, call) for call in calls]
        return [future.result(timeout=30) for future in futures]


def prove_concurrency(database_url: str, proof: Proof) -> tuple[dict[str, Any], str]:
    identical = {
        "thesis_id": None,
        "expected_version": 0,
        "transition": "create",
        "thesis_subject": subject("MSFT"),
        "thesis_content": content("concurrent-replay"),
        "request_id": "30000000-0000-4000-8000-000000000001",
    }
    replay_rows = concurrent_rpc(database_url, (identical, identical))
    proof.equal(sorted(row["status"] for row in replay_rows), ["created", "replayed"], "concurrent_identical_status")
    proof.equal(sum(row["replayed"] is True for row in replay_rows), 1, "concurrent_identical_replayed")
    replay_thesis = str(next(row["thesis_id"] for row in replay_rows if row["thesis_id"] is not None))
    proof.equal(admin_value(database_url, "select count(*) from public.thesis_versions where thesis_id = %s", (replay_thesis,)), 1, "concurrent_identical_one_version")

    first = create(database_url, USER_A, "fingerprint-a", "30000000-0000-4000-8000-000000000002", symbol="AMD")
    before = admin_value(database_url, "select count(*) from public.thesis_versions")
    collision = create(database_url, USER_A, "fingerprint-b", "30000000-0000-4000-8000-000000000002", symbol="AMD")
    proof.equal(first["status"], "created", "idempotency_seed_created")
    proof.equal(collision["status"], "idempotency_conflict", "idempotency_conflict_status")
    proof.equal(admin_value(database_url, "select count(*) from public.thesis_versions"), before, "idempotency_conflict_no_row")

    cas = create(database_url, USER_A, "cas-base", "30000000-0000-4000-8000-000000000003", symbol="TSLA")
    cas_id = str(cas["thesis_id"])
    competing = (
        {
            "thesis_id": cas_id,
            "expected_version": 1,
            "transition": "revise",
            "thesis_subject": subject("TSLA"),
            "thesis_content": content("cas-left"),
            "request_id": "30000000-0000-4000-8000-000000000004",
        },
        {
            "thesis_id": cas_id,
            "expected_version": 1,
            "transition": "revise",
            "thesis_subject": subject("TSLA"),
            "thesis_content": content("cas-right"),
            "request_id": "30000000-0000-4000-8000-000000000005",
        },
    )
    cas_rows = concurrent_rpc(database_url, competing)
    proof.equal(sorted(row["status"] for row in cas_rows), ["advanced", "version_conflict"], "concurrent_cas_status")
    proof.equal(admin_row(database_url, "select current_version, (select count(*) from public.thesis_versions where thesis_id = t.id) from public.theses t where id = %s", (cas_id,)), (2, 2), "concurrent_cas_head_history")
    outcomes = {
        "identical_request": sorted(row["status"] for row in replay_rows),
        "different_payload": [first["status"], collision["status"]],
        "competing_expected_version": sorted(row["status"] for row in cas_rows),
    }
    return outcomes, cas_id


def prove_owner_isolation(database_url: str, proof: Proof, thesis_id: str) -> None:
    with actor_connection(database_url, USER_B) as connection:
        proof.equal(connection.execute("select count(*) from public.theses").fetchone()[0], 0, "owner_b_head_list_empty")
        proof.equal(connection.execute("select count(*) from public.thesis_versions").fetchone()[0], 0, "owner_b_history_empty")
        proof.equal(connection.execute("select count(*) from public.theses where id = %s", (thesis_id,)).fetchone()[0], 0, "owner_b_head_read_hidden")

    valid = content("foreign-attempt")
    foreign = rpc(
        database_url, USER_B, thesis_id=thesis_id, expected_version=2, transition="revise",
        thesis_subject=subject("TSLA"), thesis_content=valid,
        request_id="40000000-0000-4000-8000-000000000001",
    )
    missing = rpc(
        database_url, USER_B, thesis_id=MISSING_THESIS, expected_version=2, transition="revise",
        thesis_subject=subject("TSLA"), thesis_content=valid,
        request_id="40000000-0000-4000-8000-000000000002",
    )
    projection = lambda row: tuple(row[key] for key in ("status", "thesis_id", "version", "current_version", "lifecycle_state", "replayed"))
    proof.equal(projection(foreign), projection(missing), "foreign_missing_observational_parity")
    proof.equal(foreign["status"], "not_found", "foreign_mutation_not_found")


def prove_lifecycle_and_lineage(database_url: str, proof: Proof, thesis_id: str) -> None:
    current_subject, current_content = admin_row(
        database_url,
        """
        select subject_ref, content from public.thesis_versions
        where thesis_id = %s order by version desc limit 1
        """,
        (thesis_id,),
    )
    version = 2
    lifecycle_steps = (
        ("archive", "archived", False),
        ("reopen", "active", False),
        ("invalidate", "invalidated", True),
        ("reopen", "active", True),
    )
    request_number = 10
    for transition, expected_state, note_required in lifecycle_steps:
        hostile = dict(current_content)
        hostile["statement"] = "hostile rewrite"
        hostile["revision_note"] = "required" if note_required else None
        denied = rpc(
            database_url, USER_A, thesis_id=thesis_id, expected_version=version, transition=transition,
            thesis_subject=current_subject, thesis_content=hostile,
            request_id=f"50000000-0000-4000-8000-{request_number:012d}",
        )
        request_number += 1
        proof.equal(denied["status"], "invalid_transition", f"lifecycle_{transition}_rewrite_denied")
        proof.equal(admin_value(database_url, "select current_version from public.theses where id = %s", (thesis_id,)), version, f"lifecycle_{transition}_denial_no_head_advance")

        permitted = dict(current_content)
        permitted["revision_note"] = f"note-{transition}" if note_required or transition != "reopen" else None
        accepted = rpc(
            database_url, USER_A, thesis_id=thesis_id, expected_version=version, transition=transition,
            thesis_subject=current_subject, thesis_content=permitted,
            request_id=f"50000000-0000-4000-8000-{request_number:012d}",
        )
        request_number += 1
        version += 1
        proof.equal((accepted["status"], accepted["version"], accepted["lifecycle_state"]), ("advanced", version, expected_state), f"lifecycle_{transition}_accepted")

    versions = admin_value(
        database_url,
        """
        select jsonb_agg(jsonb_build_object(
          'version', version, 'previous', previous_version, 'content', content, 'subject', subject_ref
        ) order by version)
        from public.thesis_versions where thesis_id = %s
        """,
        (thesis_id,),
    )
    proof.equal([item["version"] for item in versions], list(range(1, version + 1)), "lineage_contiguous_versions")
    proof.equal([item["previous"] for item in versions], [None] + list(range(1, version)), "lineage_parent_chain")
    proof.check(all(item["subject"] == versions[0]["subject"] for item in versions), "lineage_subject_immutable")
    canonical_substance = {key: value for key, value in versions[1]["content"].items() if key != "revision_note"}
    proof.check(all(
        {key: value for key, value in item["content"].items() if key != "revision_note"} == canonical_substance
        for item in versions[2:]
    ), "lineage_lifecycle_substance_immutable")
    proof.equal(admin_row(database_url, "select current_version, lifecycle_state from public.theses where id = %s", (thesis_id,)), (version, "active"), "lineage_head_agreement")

    count_before = len(versions)
    active_reopen = rpc(
        database_url, USER_A, thesis_id=thesis_id, expected_version=version, transition="reopen",
        thesis_subject=current_subject, thesis_content={**current_content, "revision_note": "not-valid-while-active"},
        request_id="50000000-0000-4000-8000-000000000099",
    )
    proof.equal(active_reopen["status"], "invalid_transition", "invalid_lifecycle_writes_nothing")

    malformed_subject = dict(current_subject)
    malformed_subject["extra"] = True
    bad_subject = rpc(
        database_url, USER_A, thesis_id=thesis_id, expected_version=version, transition="revise",
        thesis_subject=malformed_subject, thesis_content=current_content,
        request_id="50000000-0000-4000-8000-000000000100",
    )
    proof.equal(bad_subject["status"], "invalid_transition", "malformed_subject_writes_nothing")

    malformed_content = dict(current_content)
    malformed_content["conviction"] = 9
    bad_content = rpc(
        database_url, USER_A, thesis_id=thesis_id, expected_version=version, transition="revise",
        thesis_subject=current_subject, thesis_content=malformed_content,
        request_id="50000000-0000-4000-8000-000000000101",
    )
    proof.equal(bad_content["status"], "invalid_transition", "malformed_content_writes_nothing")
    malformed_root = rpc(
        database_url, USER_A, thesis_id=thesis_id, expected_version=version, transition="revise",
        thesis_subject=current_subject, thesis_content=["not", "an", "object"],
        request_id="50000000-0000-4000-8000-000000000102",
    )
    proof.equal(malformed_root["status"], "invalid_transition", "malformed_root_writes_nothing")
    proof.equal(admin_value(database_url, "select count(*) from public.thesis_versions where thesis_id = %s", (thesis_id,)), count_before, "invalid_calls_no_version")


def prove_atomic_failure(database_url: str, proof: Proof) -> None:
    created = create(database_url, USER_A, "atomic-base", "60000000-0000-4000-8000-000000000001", symbol="META")
    thesis_id = str(created["thesis_id"])
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("""
          create or replace function public.f11_canary_reject_head_update() returns trigger
          language plpgsql as $$ begin raise exception 'f11_canary_forced_failure'; end $$;
          create trigger f11_canary_reject_head_update before update on public.theses
          for each row execute function public.f11_canary_reject_head_update();
        """)
    failure: psycopg.Error | None = None
    try:
        rpc(
            database_url, USER_A, thesis_id=thesis_id, expected_version=1, transition="revise",
            thesis_subject=subject("META"), thesis_content=content("atomic-next"),
            request_id="60000000-0000-4000-8000-000000000002",
        )
    except psycopg.Error as error:
        failure = error
    finally:
        with psycopg.connect(database_url, autocommit=True) as connection:
            connection.execute("drop trigger if exists f11_canary_reject_head_update on public.theses")
            connection.execute("drop function if exists public.f11_canary_reject_head_update()")
    proof.check(failure is not None and "f11_canary_forced_failure" in str(failure), "forced_failure_observed")
    proof.equal(admin_row(database_url, "select current_version, (select count(*) from public.thesis_versions where thesis_id = t.id) from public.theses t where id = %s", (thesis_id,)), (1, 1), "forced_failure_no_partial_state")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--migration", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()

    database_url = env("F11_DATABASE_URL")
    expected_commit = env("F11_EXPECTED_COMMIT")
    expected_image = env("F11_EXPECTED_IMAGE")
    expected_postgres = env("F11_EXPECTED_POSTGRES")
    migration_bytes = args.migration.read_bytes()
    migration_sql = migration_bytes.decode("utf-8")
    migration_digest = hashlib.sha256(migration_bytes).hexdigest()
    proof = Proof()

    bootstrap(database_url)
    actual_postgres = str(admin_value(database_url, "show server_version"))
    proof.check(actual_postgres.startswith(f"{expected_postgres} ") or actual_postgres == expected_postgres, "postgres_version_drift")

    apply_migration(database_url, migration_sql)
    rerun_seed = create(database_url, USER_A, "migration-rerun", "20000000-0000-4000-8000-000000000001")
    proof.equal(rerun_seed["status"], "created", "migration_first_apply_rpc")
    rerun_seed_id = str(rerun_seed["thesis_id"])
    apply_migration(database_url, migration_sql)
    proof.equal(admin_row(database_url, "select current_version, (select count(*) from public.thesis_versions where thesis_id = t.id) from public.theses t where id = %s", (rerun_seed_id,)), (1, 1), "migration_second_apply_preserves_data")

    catalog = inspect_catalog(database_url, proof)
    prove_access_boundaries(database_url, proof)
    concurrency, cas_id = prove_concurrency(database_url, proof)
    prove_owner_isolation(database_url, proof, cas_id)
    prove_lifecycle_and_lineage(database_url, proof, cas_id)
    prove_atomic_failure(database_url, proof)

    receipt = {
        "schema": "mastermind.f11-thesis-postgres-canary-receipt/v1",
        "commit": expected_commit,
        "migration": str(args.migration),
        "migration_sha256": migration_digest,
        "postgres": {
            "image": expected_image,
            "expected_version": expected_postgres,
            "actual_version": actual_postgres,
        },
        "client": {"distribution": "psycopg[binary]", "version": psycopg.__version__},
        "workflow": {
            "run_id": env("F11_GITHUB_RUN_ID"),
            "run_attempt": env("F11_GITHUB_RUN_ATTEMPT"),
            "job": env("F11_GITHUB_JOB"),
        },
        "test_counts": {"assertions": proof.assertions, "failures": 0},
        "catalog_verdicts": catalog,
        "concurrency_outcomes": concurrency,
        "owner_isolation": "pass",
        "lifecycle_substance": "pass",
        "atomic_failure": "pass",
        "migration_rerun": "pass",
    }
    args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
