"""Static source/serialization controls only; never execute SQL or assert effects.

The real PostgreSQL migration/grant/transition qualification remains separate.
Native route tests in Macro exercise lost ACK, duplicate/partial and late phases.
"""
import hashlib
import json
import re
from pathlib import Path

from scripts.supabase_apply import split_statements, readback_statements

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "supabase/migrations/0051_investigation_native_capture_participant.sql"
PIN = ROOT / "tests/fixtures/investigation_cutover/0030-pinned-source.txt"


def source():
    return SQL.read_text()


def function(text, name, tag):
    return re.search(r"create or replace function public\." + name + r"\(.*?end " + re.escape(tag) + r";", text, re.S).group()


def test_one_incumbent_statement_with_source_only_readbacks_and_reserved_identity():
    sql = source()
    assert len(split_statements(sql)) == 1
    assert sql.count("$native_ddl$") == 2 and sql.count("$migration$") == 2
    assert len(readback_statements(sql)) == 4
    ledger = json.loads((SQL.parent / "RESERVATIONS.json").read_text())
    row = ledger["prefixes"]["0051"]
    assert row["file"] == SQL.name and row["packet"] == "P12.T11.S17-NATIVE-CAPTURE-PARTICIPANT"
    assert row["applied_in_production"] is False and row["applied_date"] is None
    assert ledger["prefixes"]["0049"]["pr"] == 1290 and ledger["prefixes"]["0050"]["pr"] == 1048


def test_exact_original_body_preimages_and_no_validator_or_old_source_replacement():
    original = PIN.read_bytes()
    assert hashlib.sha256(original).hexdigest() == "e98d5a59cfb1932ebf4e562ecf89b6d08b7a5c9365b3e2fbe0b612eaaeff4694"
    sql = source()
    for name in ("apply_investigation_revision_v2", "reconcile_investigation_operation_v2"):
        prior = function(original.decode(), name, "$$")
        body = prior.split("as $$", 1)[1].rsplit("$$;", 1)[0]
        assert hashlib.sha256(body.encode()).hexdigest() in sql
        current = function(sql, name, "$$")
        current_body = current.split("as $$", 1)[1].rsplit("$$;", 1)[0]
        assert hashlib.sha256(current_body.encode()).hexdigest() in sql
    assert "p.proowner='postgres'::regrole and p.prosecdef" in sql
    assert "create or replace function public.valid_investigation_manifest" not in sql
    assert "grant execute on function public.apply_investigation_revision" not in sql.lower()
    assert "grant execute on function public.reconcile_investigation_operation" not in sql.lower()


def test_same_original_owner_lock_precedes_claim_insert_and_duplicate_has_no_execution():
    sql = source(); claim = function(sql, "claim_investigation_native_capture_v1", "$fn$")
    assert claim.index("auth.role()") < claim.index("select * into prior")
    assert claim.index("'investigation.operation:'") < claim.index("select * into prior") < claim.index("insert into")
    assert "prior.request is distinct from p_request or prior.native_binding is distinct from p_binding" in claim
    assert claim.index("'status','existing'") < claim.index("insert into")
    assert "investigation_receipt_capacity_reached_v2(actor)" in claim
    assert not re.search(r"create\s+table", sql, re.I)


def test_completion_only_original_generation_and_never_resets_canonical_or_claim():
    complete = function(source(), "complete_investigation_native_capture_v1", "$fn$")
    assert "auth.role() is distinct from 'service_role'" in complete
    assert "prior.native_binding is distinct from p_binding or prior.native_generation is distinct from p_generation" in complete
    assert "p_native_phase is distinct from 'retained'" in complete
    assert "set native_phase='retained',native_completed_at=clock_timestamp()" in complete
    assert "set result" not in complete and "insert into" not in complete and "delete from" not in complete
    assert "expires" not in complete and "ttl" not in complete


def test_no_terminal_or_new_draft_authority_from_native_phase_or_pending_read():
    sql = source()
    apply = function(sql, "apply_investigation_revision_v2", "$$")
    reconcile = function(sql, "reconcile_investigation_operation_v2", "$$")
    assert "if prior.native_phase is distinct from 'retained' then return prior.result; end if;" in apply
    assert "elsif p_action in ('create','revise') and content ? 'scenario_capture'" in apply
    assert "q.native_phase='retained' and q.result->>'status'='pending'" in apply
    assert "set result=output" in reconcile and "native_phase=" not in reconcile
    assert "native_canonical_terminal_immutable" in sql and "native_original_binding_immutable" in sql
    assert "native_historical_enrollment_forbidden" in sql
    assert "native_phase is not null" in sql
    assert "new.result->>'status'" in sql and "auth.uid() is distinct from old.user_id" in sql
    assert "if prior.user_id is null and public.investigation_receipt_capacity_reached_v2(actor)" in apply
    # The reserved slot waiver affects receipt allocation only. Preserve the
    # independent original500-head/2000-revision cap block byte for byte.
    pattern = r" if \(p_action='create' and.*?return jsonb_build_object\('status','limit_reached'\);\n end if;"
    old = function(PIN.read_text(), "apply_investigation_revision_v2", "$$")
    assert re.search(pattern, apply, re.S).group() == re.search(pattern, old, re.S).group()


def test_effective_execute_acl_is_private_server_only_and_owner_read_only():
    sql = source()
    revoke = "from public,anon,authenticated,service_role;"
    assert revoke in sql
    assert "grant execute on function public.claim_investigation_native_capture_v1(jsonb,jsonb),public.complete_investigation_native_capture_v1(jsonb,uuid,text) to service_role;" in sql
    assert "grant execute on function public.read_investigation_native_capture_v1(uuid) to authenticated;" in sql
    assert "where user_id=auth.uid() and operation_id=p_operation_id" in sql
    assert "has_function_privilege(role_name,function_name,'EXECUTE')" in sql
    assert "current_user=" not in sql and "current_user =" not in sql
