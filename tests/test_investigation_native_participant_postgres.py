"""Actual isolated PostgreSQL only: no live schema, credentials, capture or API.

Reuse the incumbent socket-only fixture lifecycle and minimal upstream tables.
Its controlled auth.role setting represents PostgREST's verified role claim; it
does not test JWT verification, installed keys/grants or any production issuer.
"""
import copy
import json
from pathlib import Path
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "tests") not in sys.path:
    sys.path.insert(0, str(ROOT / "tests"))
import test_pinned_research_handoff_postgres as base
from test_investigation_scenario_postgres import scenario_manifest, scenario_reference

SQL = ROOT / "supabase/migrations/0051_investigation_native_capture_participant.sql"
A, B = base.A, base.B
ISSUER = "https://project-fixture.invalid/auth/v1"
EPOCH = "30000000-0000-4000-8000-000000000003"


@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    run, data, socket = base._spawn_postgres(tmp_path_factory, "s17-native-participant", 55496)
    try:
        base._bootstrap_base_schema(run)
        run("create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;"
            "create table public.workspace_settings(scope text,user_id uuid,team_id uuid,key text,value jsonb,updated_at timestamptz);"
            "create table public.theses(id uuid,user_id uuid); create table public.thesis_versions(id uuid,thesis_id uuid,user_id uuid);")
        for path in ("supabase/migrations/0021_resource_grants.sql", "supabase/migrations/0028_investigations.sql",
                     "tests/fixtures/investigation_cutover/0030-pinned-source.txt", "supabase/migrations/0040_investigation_review.sql",
                     "supabase/migrations/0041_pinned_research_handoffs.sql", "supabase/migrations/0042_investigation_scenario_reference.sql",
                     "supabase/migrations/0047_investigation_options_selection_evidence.sql"):
            run((ROOT / path).read_text())
        # Seed a default direct server EXECUTE grant, the observed class missed
        # by PUBLIC-only revocation. The real migration must remove it safely.
        run("alter default privileges for role postgres grant execute on functions to service_role;")
        run(SQL.read_text())
        run(SQL.read_text())
        yield run
    finally:
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop"], check=True, capture_output=True)
        socket.cleanup()


def inputs():
    target, op = str(uuid4()), str(uuid4())
    binding = dict(actor=A, operation_id=op, issuer=ISSUER, auth_epoch=EPOCH,
                   request_sha256="a"*64, source_binding_sha256="b"*64)
    request = dict(principal=A, action="create", target=target, expected_revision=0,
                   manifest=scenario_manifest("Capture participant", scenario_reference()), layout_capture=None)
    return binding, request


def rpc(pg, name, args, *, role="service_role", who=None, check=True):
    sql = "set request.jwt.claim.role="+base.quote("authenticated" if who else role)+";select public."+name+"("+args+");"
    value = pg(sql, who=who, role=None if who else role, check=check)
    return json.loads(value) if check else value


def claim(pg, b, request, **kw):
    return rpc(pg, "claim_investigation_native_capture_v1", base.manifest_like(b)+","+base.manifest_like(request), **kw)


def complete(pg, b, generation, phase="retained", **kw):
    return rpc(pg, "complete_investigation_native_capture_v1", base.manifest_like(b)+","+base.quote(generation)+"::uuid,"+base.quote(phase), **kw)


def canonical(pg, b, request, reconcile=False):
    args = ",".join([base.quote(request["target"])+"::uuid", str(request["expected_revision"]), base.quote(request["action"]),
                     base.quote(b["operation_id"])+"::uuid", base.manifest_like(request["manifest"]), "null", "null"])
    return rpc(pg, "reconcile_investigation_operation_v2" if reconcile else "apply_investigation_revision_v2", args, who=request["principal"])


def test_real_effective_acl_and_role_proof_not_definer_current_user(pg):
    b, request = inputs()
    assert pg("select public.valid_investigation_manifest_v2("+base.manifest_like(request["manifest"])+")") == "t"
    assert pg("select public.investigation_keys_v2("+base.manifest_like(request)+",array['principal','action','target','expected_revision','manifest'],array['layout_capture'])") == "t"
    for role in ("anon", "authenticated"):
        denied = claim(pg, b, request, role=role, check=False)
        assert denied.returncode != 0 and "permission denied" in denied.stderr
        denied = complete(pg, b, str(uuid4()), role=role, check=False)
        assert denied.returncode != 0 and "permission denied" in denied.stderr
    for signature in ("claim_investigation_native_capture_v1(jsonb,jsonb)", "complete_investigation_native_capture_v1(jsonb,uuid,text)"):
        assert pg("select has_function_privilege('service_role','public."+signature+"','EXECUTE')") == "t"
        assert pg("select count(*) from pg_proc p,aclexplode(p.proacl) a where p.oid='public."+signature+"'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'") == "0"
    assert claim(pg, b, request)["status"] == "claimed"
    # Deliberately grant an untrusted role in the fixture: internal auth.role
    # still refuses even though SECURITY DEFINER current_user is postgres.
    pg("grant execute on function public.claim_investigation_native_capture_v1(jsonb,jsonb) to authenticated")
    try:
        denied = claim(pg, *inputs(), role="authenticated", check=False)
        assert denied.returncode != 0 and "native_server_role_required" in denied.stderr
    finally:
        pg("revoke execute on function public.claim_investigation_native_capture_v1(jsonb,jsonb) from authenticated")


def test_concurrent_same_operation_claims_one_generation_and_one_execution_eligible(pg):
    b, request = inputs()
    with ThreadPoolExecutor(2) as pool:
        returns = list(pool.map(lambda _: claim(pg, b, request), range(2)))
    assert sorted(r["status"] for r in returns) == ["claimed", "existing"]
    assert len({r["generation"] for r in returns}) == 1
    assert pg("select count(*) from investigation_mutation_receipts where operation_id="+base.quote(b["operation_id"])+"::uuid") == "1"
    assert canonical(pg, b, request)["status"] == "pending"
    assert pg("select count(*) from investigations where id="+base.quote(request["target"])+"::uuid") == "0"


def test_exact_actor_request_reference_epoch_and_generation_no_reclaim_or_effect(pg):
    b, request = inputs(); first = claim(pg, b, request)
    for key, value in (("actor", B), ("request_sha256", "c"*64), ("source_binding_sha256", "d"*64), ("auth_epoch", str(uuid4()))):
        changed = {**b, key:value}
        assert claim(pg, changed, request)["status"] in ("conflict", "invalid_request")
        assert complete(pg, changed, first["generation"])["status"] == "unresolved"
    changed = copy.deepcopy(request); changed["manifest"]["scenario_capture"]["inputs"]["days"] = 1
    assert claim(pg, b, changed)["status"] == "conflict"
    assert complete(pg, b, str(uuid4()))["status"] == "unresolved"
    assert complete(pg, b, first["generation"], "not_applied")["status"] == "invalid_binding"
    assert canonical(pg, b, changed)["status"] == "idempotency_conflict"
    assert canonical(pg, b, request)["status"] == "pending"


def test_known_retention_barrier_then_canonical_commit_and_repeat_no_new_claim(pg):
    b, request = inputs(); first = claim(pg, b, request)
    assert complete(pg, b, first["generation"])["native_phase"] == "retained"
    result = canonical(pg, b, request)
    assert result["status"] == "committed" and result["operation_id"] == b["operation_id"]
    assert canonical(pg, b, request) == result
    assert claim(pg, b, request)["status"] == "existing"
    assert complete(pg, b, first["generation"])["native_phase"] == "retained"


def test_canonical_fence_does_not_clear_native_unknown_and_original_late_completion_is_factual(pg):
    b, request = inputs(); first = claim(pg, b, request)
    fence = canonical(pg, b, request, reconcile=True)
    assert fence == {"status":"not_applied", "id":request["target"], "operation_id":b["operation_id"]}
    read = lambda who: rpc(pg, "read_investigation_native_capture_v1", base.quote(b["operation_id"])+"::uuid", who=who)
    assert read(A)["native_phase"] == "started" and read(A)["canonical_status"] == "not_applied"
    assert read(B) == {"status":"not_found"}
    assert complete(pg, b, first["generation"])["native_phase"] == "retained"
    assert read(A)["native_phase"] == "retained" and read(A)["canonical_status"] == "not_applied"
    assert canonical(pg, b, request) == fence
    assert claim(pg, b, request)["status"] == "existing"
    denied = pg("update investigation_mutation_receipts set native_phase='started',native_completed_at=null where operation_id="+base.quote(b["operation_id"])+"::uuid", check=False)
    assert denied.returncode != 0 and "native_completion_transition_invalid" in denied.stderr


def test_pending_and_terminal_rows_are_not_reset_deleted_or_adopted(pg):
    b, request = inputs(); first = claim(pg, b, request)
    where = " where operation_id="+base.quote(b["operation_id"])+"::uuid"
    for statement in ("delete from investigation_mutation_receipts", "update investigation_mutation_receipts set native_generation=gen_random_uuid()",
                      "update investigation_mutation_receipts set request='{}'::jsonb"):
        denied = pg(statement+where, check=False)
        assert denied.returncode != 0 and "immutable" in denied.stderr
    # A canonical SQL rejection still cannot clear a started external phase.
    assert complete(pg, b, first["generation"])["native_phase"] == "retained"
    assert canonical(pg, b, request)["status"] == "committed"
    denied = pg("update investigation_mutation_receipts set result='{}'::jsonb"+where, check=False)
    assert denied.returncode != 0 and "native_canonical_terminal_immutable" in denied.stderr


def test_plain_legacy_save_and_closed_acl_unchanged_by_native_extension(pg):
    b, request = inputs(); request["manifest"].pop("scenario_capture")
    result = canonical(pg, b, request)
    assert result["status"] == "committed"
    signature = "public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb,jsonb)"
    pg("revoke execute on function "+signature+" from authenticated")
    try:
        pg(SQL.read_text())
        assert pg("select has_function_privilege('authenticated',"+base.quote(signature)+",'EXECUTE')") == "f"
    finally:
        pg("grant execute on function "+signature+" to authenticated")


def test_concurrent_canonical_fence_and_native_claim_share_original_lock(pg):
    b, request = inputs()
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(claim, pg, b, request)
        fence = pool.submit(canonical, pg, b, request, True)
        native, canonical_result = first.result(), fence.result()
    assert canonical_result["status"] == "not_applied"
    assert canonical(pg, b, request) == canonical_result
    assert native["status"] in ("claimed", "conflict")
    observed = rpc(pg, "read_investigation_native_capture_v1", base.quote(b["operation_id"])+"::uuid", who=A)
    if native["status"] == "claimed":
        assert observed["native_phase"] == "started"
        assert complete(pg, b, native["generation"])["native_phase"] == "retained"
        assert canonical(pg, b, request) == canonical_result
    else:
        assert observed == {"status":"not_found"}


def test_actual_canonical_failure_rolls_back_head_revision_but_preserves_native_phase(pg):
    b, request = inputs(); first = claim(pg, b, request)
    complete(pg, b, first["generation"])
    pg("create function s17_fail_canonical_receipt() returns trigger language plpgsql as $$begin raise exception 's17_controlled_canonical_failure'; end$$;"
       "create trigger s17_fail_canonical_receipt before update on investigation_mutation_receipts for each row "
       "when (new.result->>'status'='committed') execute function s17_fail_canonical_receipt();")
    try:
        with pytest.raises(AssertionError, match="s17_controlled_canonical_failure"):
            canonical(pg, b, request)
        for table, column in (("investigations", "id"), ("investigation_revisions", "investigation_id")):
            assert pg("select count(*) from "+table+" where "+column+"="+base.quote(request["target"])+"::uuid") == "0"
        observed = rpc(pg, "read_investigation_native_capture_v1", base.quote(b["operation_id"])+"::uuid", who=A)
        assert observed["native_phase"] == "retained" and observed["canonical_status"] == "pending"
        assert claim(pg, b, request)["status"] == "existing"
    finally:
        pg("drop trigger s17_fail_canonical_receipt on investigation_mutation_receipts;drop function s17_fail_canonical_receipt();")


def test_failed_claim_transaction_leaves_no_execution_receipt(pg):
    b, request = inputs()
    pg("create function s17_fail_native_claim() returns trigger language plpgsql as $$begin raise exception 's17_controlled_claim_failure'; end$$;"
       "create trigger s17_fail_native_claim before insert on investigation_mutation_receipts for each row "
       "when (new.native_binding is not null) execute function s17_fail_native_claim();")
    try:
        failed = claim(pg, b, request, check=False)
        assert failed.returncode != 0 and "s17_controlled_claim_failure" in failed.stderr
        assert pg("select count(*) from investigation_mutation_receipts where operation_id="+base.quote(b["operation_id"])+"::uuid") == "0"
    finally:
        pg("drop trigger s17_fail_native_claim on investigation_mutation_receipts;drop function s17_fail_native_claim();")


@pytest.mark.parametrize('change', ['missing_layout', 'bad_layout', 'boolean_revision', 'fractional_revision', 'overflow_revision', 'max_revision'])
def test_exact_nullable_layout_and_native_int32_contract(pg,change):
    b, request = inputs()
    if change=='missing_layout':request.pop('layout_capture')
    elif change=='bad_layout':request['layout_capture']={'layout_id':str(uuid4()),'expected_revision':True,'revision_id':str(uuid4())}
    elif change=='boolean_revision':request['expected_revision']=False
    else:
        request['action']='revise'
        request['expected_revision']={'fractional_revision':1.5,'overflow_revision':2147483647,'max_revision':2147483646}[change]
    result=claim(pg,b,request)
    assert result['status']==('claimed' if change=='max_revision' else 'invalid_request')
    if change!='max_revision':
        assert pg("select count(*) from investigation_mutation_receipts where operation_id="+base.quote(b['operation_id'])+"::uuid")=='0'


def test_last_receipt_slot_is_reserved_once_not_charged_again_at_canonical_commit(pg):
    b, request=inputs();b['actor']=B;request['principal']=B
    assert pg("select count(*) from investigation_mutation_receipts where user_id="+base.quote(B)+"::uuid")=='0'
    plain=copy.deepcopy(request['manifest']);plain.pop('scenario_capture')
    pg("with slots as (select gen_random_uuid() op,gen_random_uuid() target from generate_series(1,3999)) "
       "insert into investigation_mutation_receipts(user_id,operation_id,request,result) select "+base.quote(B)+"::uuid,op,"
       "jsonb_build_object('principal',"+base.quote(B)+",'action','create','target',target,'expected_revision',0,'manifest',"+base.manifest_like(plain)+",'layout_capture',null),"
       "jsonb_build_object('status','not_applied','id',target,'operation_id',op) from slots")
    first=claim(pg,b,request);assert first['status']=='claimed'
    assert pg("select count(*) from investigation_mutation_receipts where user_id="+base.quote(B)+"::uuid")=='4000'
    complete(pg,b,first['generation'])
    result=canonical(pg,b,request)
    assert result['status']=='committed'
    assert pg("select count(*) from investigation_mutation_receipts where user_id="+base.quote(B)+"::uuid")=='4000'
    # The next operation still allocates a NEW receipt and stays refused.
    other, next_request=inputs();other['actor']=B;next_request['principal']=B
    assert claim(pg,other,next_request)['status']=='limit_reached'
    next_request['manifest'].pop('scenario_capture')
    assert canonical(pg,other,next_request)['status']=='limit_reached'


def test_reauthenticated_owner_read_preserves_original_epoch_without_new_capture_authority(pg):
    b, request=inputs();first=claim(pg,b,request)
    complete(pg,b,first['generation'])
    fresh_epoch=str(uuid4())
    observed=json.loads(pg("set request.jwt.claim.role='authenticated';set request.jwt.claim.session_id="+base.quote(fresh_epoch)
        +";select public.read_investigation_native_capture_v1("+base.quote(b['operation_id'])+"::uuid)",who=A))
    assert observed['binding']['auth_epoch']==EPOCH and observed['generation']==first['generation']
    assert observed['native_phase']=='retained' and fresh_epoch!=observed['binding']['auth_epoch']
    assert claim(pg,{**b,'auth_epoch':fresh_epoch},request)['status']=='conflict'
    denied=complete(pg,b,first['generation'],role='authenticated',check=False)
    assert denied.returncode!=0 and 'permission denied' in denied.stderr
