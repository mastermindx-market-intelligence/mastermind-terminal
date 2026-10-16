"""G5 exercises canonical Thesis references against real RLS and transactions."""
import json
import uuid
import pytest
from test_investigation_postgres import pg, quote, manifest, apply, ROOT, A, B


def uid():
    return str(uuid.uuid4())


@pytest.fixture(scope="module")
def store(pg):
    pg((ROOT / "supabase/migrations/0012_thesis_objects.sql").read_text())
    migration = ROOT / "supabase/migrations/0029_investigation_thesis_refs.sql"
    assert migration.exists(), "G5 Thesis reference migration is not implemented"
    pg(migration.read_text())
    pg(migration.read_text())
    return pg


def thesis(pg, actor=A, previous=None):
    subject = {"schema":"mastermind.thesis-subject-ref/v1","kind":"issuer","owner":"terminal.analysis_symbol","key":"AAPL","identity_state":"listing_scoped","listing":{"symbol":"AAPL","mic":None,"security_id":None},"company_id":None,"display":"Apple"}
    content = {"schema":"mastermind.thesis-content/v1","title":"Apple thesis","statement":"Retained belief" if previous is None else "New belief","catalysts":[],"falsifiers":[],"risks":[],"horizon":"quarters","effective_at":None,"revision_note":None}
    args = ["null" if previous is None else quote(previous["thesis_id"])+"::uuid", "0" if previous is None else "1", quote("create" if previous is None else "revise"), quote(json.dumps(subject))+"::jsonb",quote(json.dumps(content))+"::jsonb",quote(uid())+"::uuid"]
    result=json.loads(pg("select row_to_json(r) from public.apply_thesis_version_v1("+",".join(args)+") r",actor))
    assert result["status"] in ("created","advanced"), result
    version=pg("select id from thesis_versions where thesis_id="+quote(result["thesis_id"])+" and version="+str(result["version"]),actor)
    return {"thesis_id":result["thesis_id"],"version_id":version,"role":"primary"}


def test_retained_reference_survives_canonical_head_advance_and_original_replay(store):
    ref=thesis(store)
    body={**manifest(),"thesis_refs":[ref]}
    target,key=uid(),uid()
    first=apply(store,key,content=body,target=target)
    assert first["status"]=="committed"
    newer=thesis(store,previous=ref)
    assert newer["version_id"]!=ref["version_id"]
    found=json.loads(store("select read_investigation_v2("+quote(target)+",1)",A))
    assert found["manifest"]["thesis_refs"]==[ref]
    assert apply(store,key,content=body,target=target)==first
    assert store("select content->>'statement' from thesis_versions where id="+quote(ref["version_id"]),A)=="Retained belief"
    assert apply(store,uid(),"revise",1,body,target)["revision"]==2
    assert apply(store,uid(),"revise",1,body,target)["status"]=="version_conflict"


def test_reference_validation_has_no_partial_effects_or_foreign_disclosure(store):
    own,foreign=thesis(store),thesis(store,B)
    counts="select (select count(*) from investigations),(select count(*) from investigation_revisions),(select count(*) from investigation_mutation_receipts),(select count(*) from chart_layout_revisions)"
    before=store(counts)
    for ref in (foreign,{**own,"version_id":foreign["version_id"]},{**foreign,"version_id":own["version_id"]},{**own,"version_id":uid()}):
        result=apply(store,uid(),content={**manifest(),"thesis_refs":[ref]},target=uid())
        assert result=={"status":"reference_unavailable"}
        assert store(counts)==before
    assert store("select count(*) from thesis_versions where id="+quote(own["version_id"]),B)=="0"


def test_closed_reference_shape_roles_and_bound(store):
    ref=thesis(store)
    for refs in ([{**ref,"belief":"shadow"}],[{**ref,"role":"opposition"}],[{**ref,"version_id":None}],[{**ref,"thesis_id":123}],[ref,ref],[ref,{**ref,"role":"context"}],[{**ref,"version_id":uid()} for _ in range(17)]):
        assert apply(store,uid(),content={**manifest(),"thesis_refs":refs},target=uid())["status"]=="invalid_payload"
    for role in ("primary","alternative","context"):
        assert apply(store,uid(),content={**manifest(),"thesis_refs":[{**ref,"role":role}]},target=uid())["status"]=="committed"


def test_canonical_belief_tables_remain_select_only_and_rpc_private_helpers(store):
    for table in ("theses","thesis_versions","investigation_revisions"):
        denied=store("delete from public."+table,A,check=False)
        assert denied.returncode and "permission denied" in denied.stderr
    assert store("select has_function_privilege('anon','public.apply_investigation_revision_v2(uuid,integer,text,uuid,jsonb,jsonb)','execute')")=="f"
    assert store("select has_function_privilege('authenticated','public.valid_investigation_manifest_v2(jsonb)','execute')")=="f"
