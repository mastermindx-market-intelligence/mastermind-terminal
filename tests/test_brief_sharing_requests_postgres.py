"""Explicit request ownership on disposable socket-only PostgreSQL; no live effects."""
import hashlib,json,os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
from tests.test_brief_delivery_team_sharing_postgres import server,pg as delivery_pg,OWNER,ADMIN,MEMBER,OUTSIDER,TEAM,OTHER_TEAM,delivery,q,read
MIGRATION=Path(__file__).resolve().parents[1]/'supabase/migrations/0049_brief_sharing_requests.sql'
REQUEST='60000000-0000-4000-8000-000000000001'
SESSION='70000000-0000-4000-8000-000000000001'
@pytest.fixture
def pg(delivery_pg):
    delivery_pg("create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;")
    delivery_pg(MIGRATION.read_text())
    return delivery_pg

def issue(pg,n=1,actor=OWNER,team=TEAM,ref=REQUEST):
    content=read(pg,n,actor,team)['delivery']['content_sha256']
    return json.loads(pg(f"select public.issue_brief_sharing_request({q(delivery(n))},{q(ref)},{q(team)},{q(content)});",actor))
def feed(pg,actor=OWNER,session=SESSION):
    return json.loads(pg(f"set request.jwt.claims={q(json.dumps({'session_id':session}))};select public.read_brief_sharing_requests();",actor))
def record(pg,n=1,actor=OWNER,ref=REQUEST):
    return json.loads(pg(f"select public.read_brief_sharing_request({q(delivery(n))},{q(ref)},1);",actor))
def action(pg,value,name='share_requested_brief',actor=OWNER):
    review=value['review'];content=review['delivery']['content_sha256'];effect=review['expected_effect_sha256']
    args=f"{q(review['delivery']['delivery_id'])},{q(value['request_ref'])},1,{q(content)}"+(f",{q(effect)}" if name=='share_requested_brief' else '')
    return json.loads(pg(f"select public.{name}({args});",actor))

def test_ready_eligible_deliveries_never_issue_requests(pg):
    assert read(pg)['eligibility']['can_share'] is True
    actual=feed(pg)
    assert actual['requests']==[] and actual['coverage']=={'state':'COMPLETE_WITHIN_SCOPE','reason_codes':[]}
    assert set(actual)=={'schema','viewer','source','coverage','requests'}

def test_explicit_issue_same_original_and_actual_source_feed_fixture(pg):
    issued=issue(pg);assert issue(pg)==issued
    actual=feed(pg)
    assert len(actual['requests'])==1
    row=actual['requests'][0]
    assert row['request_ref']==REQUEST and row['revision']==1
    assert row['delivery']['delivery_id']==delivery(1)
    assert row['audience']=={'team_id':TEAM,'name':'Research','member_count':3,'membership_policy':'DYNAMIC_TEAM_MEMBERSHIP'}
    assert actual['viewer']['principal_scope']==hashlib.sha256(('mastermind.terminal.principal.v1:'+OWNER).encode()).hexdigest()
    assert actual['viewer']['session_scope']==hashlib.sha256(('mastermind.terminal.session.v1:'+OWNER+':'+SESSION).encode()).hexdigest()
    text=json.dumps(actual)
    for private in ['subscription_id','target_id','Private target',OWNER,'An authored sentence.']:assert private not in text
    fixture=Path(__file__).resolve().parents[1]/'terminal/lib/__tests__/fixtures/brief-sharing-request-feed.json'
    if os.environ.get('MM_RETAIN_SHARING_REQUEST_FIXTURE')=='1':
        fixture.write_text(json.dumps(actual,ensure_ascii=False,indent=2)+'\n')
        request_fixture=fixture.with_name('brief-sharing-request-record.json')
        request_fixture.write_text(json.dumps(issued,ensure_ascii=False,indent=2)+'\n')

def test_actual_member_nonmember_and_cross_owner_denied(pg):
    for actor,n in [(MEMBER,3),(OUTSIDER,1),(ADMIN,1)]:
        content=read(pg)['delivery']['content_sha256']
        response=pg(f"select public.issue_brief_sharing_request({q(delivery(n))},{q(REQUEST)},{q(TEAM)},{q(content)});",actor,check=False)
        assert response.returncode!=0 and '42501' in response.stderr
    assert issue(pg,2,ADMIN)['disposition']=='OPEN'

def test_new_request_or_cross_delivery_same_ref_conflicts(pg):
    issue(pg)
    with pytest.raises(AssertionError,match='40001'):issue(pg,ref='60000000-0000-4000-8000-000000000002')
    pg(f"insert into public.brief_deliveries(delivery_id,subscription_id,slot_asof,state,artifact_asof,body) select {q(delivery(4))},subscription_id,'2026-11-05',state,artifact_asof,body from public.brief_deliveries where delivery_id={q(delivery(1))};")
    with pytest.raises(AssertionError,match='40001'):issue(pg,4)

def test_share_is_atomic_same_original_receipt_and_feed_closure(pg):
    issued=issue(pg);shared=action(pg,issued)
    assert shared['disposition']=='SHARED' and shared['review']['grant']
    assert action(pg,issued)==shared
    assert record(pg)==shared and feed(pg)['requests']==[]
    assert issue(pg)==shared
    assert shared['review']['grant']['team_id']==TEAM

def test_keep_private_closes_exact_request_without_grant(pg):
    issued=issue(pg);kept=action(pg,issued,'keep_requested_brief_private')
    assert kept['disposition']=='KEPT_PRIVATE' and kept['review']['grant'] is None
    assert action(pg,issued,'keep_requested_brief_private')==kept
    assert feed(pg)['requests']==[]
    with pytest.raises(AssertionError,match='40001'):action(pg,issued)

def test_source_or_authority_change_suppresses_with_truthful_partial(pg):
    issued=issue(pg)
    pg(f"update public.brief_deliveries set body=jsonb_set(body,'{{artifact,name}}','\"Changed brief\"') where delivery_id={q(delivery(1))};")
    assert feed(pg)['coverage']=={'state':'PARTIAL','reason_codes':['REQUEST_SOURCE_CHANGED']}
    assert feed(pg)['requests']==[]
    with pytest.raises(AssertionError,match='40001'):action(pg,issued)

def test_revoked_admin_and_expired_invite_never_grant_request_authority(pg):
    issued=issue(pg,2,ADMIN)
    pg(f"delete from public.team_members where team_id={q(TEAM)} and user_id={q(ADMIN)};")
    pg(f"insert into public.team_invites(team_id,email,role,token_hash,invited_by,expires_at) values({q(TEAM)},'inert-admin@example.invalid','admin','inert-expired',{q(OWNER)},now()-interval '1 day');")
    value=feed(pg,ADMIN)
    assert value['coverage']=={'state':'PARTIAL','reason_codes':['REQUEST_AUTHORITY_CHANGED']} and value['requests']==[]
    with pytest.raises(AssertionError,match='42501'):action(pg,issued,actor=ADMIN)

def test_missing_session_denies_and_different_session_is_distinct(pg):
    issue(pg)
    missing=pg("select public.read_brief_sharing_requests();",OWNER,check=False)
    assert missing.returncode!=0 and '42501' in missing.stderr
    original=feed(pg);other=feed(pg,session='70000000-0000-4000-8000-000000000002')
    assert original['viewer']['principal_scope']==other['viewer']['principal_scope']
    assert original['viewer']['session_scope']!=other['viewer']['session_scope']

def test_exact_shape_rejects_partial_null_fields_and_authenticated_update(pg):
    issue(pg)
    for column in ['sharing_request_revision','sharing_request_content_sha256','sharing_request_status']:
        value=pg(f"update public.brief_deliveries set {column}=null where delivery_id={q(delivery(1))};",check=False)
        assert value.returncode!=0 and '23514' in value.stderr
    denied=pg(f"update public.brief_deliveries set sharing_request_status='KEPT_PRIVATE' where delivery_id={q(delivery(1))};",OWNER,check=False)
    assert denied.returncode!=0 and '42501' in denied.stderr

def test_concurrent_identical_issue_and_resolve_are_one_original(pg):
    with ThreadPoolExecutor(2) as pool:values=list(pool.map(lambda _:issue(pg),range(2)))
    assert values[0]==values[1]
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:action(pg,values[0]),range(2)))
    assert results[0]==results[1]


def test_changed_owner_cannot_adopt_another_principals_request(pg):
    issued=issue(pg)
    pg(f"update public.brief_subscriptions set user_id={q(ADMIN)} where subscription_id=(select subscription_id from public.brief_deliveries where delivery_id={q(delivery(1))});")
    actual=feed(pg,ADMIN)
    assert actual['requests']==[] and actual['coverage']['state']=='PARTIAL'
    assert 'REQUEST_AUTHORITY_CHANGED' in actual['coverage']['reason_codes']
    with pytest.raises(AssertionError,match='42501'):record(pg,actor=ADMIN)
    with pytest.raises(AssertionError,match='42501'):action(pg,issued,actor=ADMIN)


def test_feed_limit_is_partial_and_underlying_unrequested_grant_is_not_needs_you(pg):
    issue(pg)
    source=read(pg)
    pg(f"select public.share_brief_delivery({q(delivery(1))},{q(TEAM)},{q(source['delivery']['content_sha256'])},{q(source['expected_effect_sha256'])});",OWNER)
    assert feed(pg)['requests']==[]
    assert feed(pg)['coverage']=={'state':'PARTIAL','reason_codes':['REQUEST_SOURCE_CHANGED']}


def test_more_than_twenty_actual_issued_requests_never_claim_complete(pg):
    from datetime import date,timedelta
    issue(pg)
    for n in range(4,25):
        slot=(date(2026,11,4)+timedelta(days=n)).isoformat()
        pg(f"insert into public.brief_deliveries(delivery_id,subscription_id,slot_asof,state,artifact_asof,body) select {q(delivery(n))},subscription_id,{q(slot)},state,artifact_asof,body from public.brief_deliveries where delivery_id={q(delivery(1))};")
        issue(pg,n,ref=f'60000000-0000-4000-8000-{n:012d}')
    actual=feed(pg)
    assert len(actual['requests'])==20
    assert actual['coverage']=={'state':'PARTIAL','reason_codes':['LIMIT_REACHED']}
