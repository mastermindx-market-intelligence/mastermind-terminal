"""Offline fixed-owner contract checks. No DB/catalog/runtime/ingress effects.

The real CurlRunner's subprocess seam receives a controlled catalog projection.
Actual pinned SQL bytes and Git pre/post identity checks are exercised. These
fixtures prove contract discrimination, never actual closure, drain or OPEN.
"""
import copy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
from uuid import UUID

import pytest
from ops import investigation_rpc_closure as M
from scripts.supabase_apply import API_URL, CurlRunner, split_statements

ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'a'*20
TOKEN = 'controlled-owner-token-not-real'
P = '11111111-1111-4111-8111-111111111111'
O = '22222222-2222-4222-8222-222222222222'
G = '33333333-3333-4333-8333-333333333333'


def git(root,*args):
    env=dict(os.environ,GIT_NO_LAZY_FETCH='1',GIT_CONFIG_GLOBAL=os.devnull,GIT_CONFIG_SYSTEM=os.devnull,GIT_TERMINAL_PROMPT='0')
    return subprocess.check_output(['git','-C',str(root),*args],env=env,stderr=subprocess.DEVNULL)


@pytest.fixture
def source(tmp_path):
    root=tmp_path/'source';root.mkdir()
    for name in (*M.PINNED_SOURCE,M.NATIVE.MIGRATION,*M.SOURCE_INTERFACES):
        dest=root/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((ROOT/name).read_bytes())
    git(root,'init','-q','-b','master');git(root,'config','user.name','Controlled Source')
    git(root,'config','user.email','controlled@example.invalid');git(root,'add','.')
    git(root,'-c','commit.gpgsign=false','commit','-qm','pinned source fixture')
    return root,git(root,'rev-parse','HEAD').decode().strip()


def snapshot(source, *, native=(), late=True, inherited=False):
    root,head=source;expected,_=M._source_contract(root,head)
    now=datetime.now(timezone.utc)
    roles=[dict(origin=name,oid=100+i,name=name,revision='a'*64,superuser=False,bypassrls=False,login=False,inherit=True)
           for i,name in enumerate(M.ROLES)]
    memberships=[]
    if inherited:
        roles.append(dict(origin='service_role',oid=150,name='native_parent',revision='b'*64,superuser=False,bypassrls=False,login=False,inherit=False))
        memberships=[dict(roleid=150,member=102,grantor=10,admin_option=False,revision='12')]
    def privileges(name=None):
        return [dict(origin=r['origin'],role_oid=r['oid'],allowed=bool(late and name==M.LATE_COMPLETION and r['origin']=='service_role')) for r in roles]
    functions=[dict(oid=200+i,name=name,revision='20',**value,public_execute=False,effective_execute=privileges(name)) for i,(name,value) in enumerate(sorted(expected.items()))]
    relations=[dict(oid=300+i,name=name,revision='30',owner='postgres',rls=True,force_rls=False,
                    attributes=[dict(number=1,revision='31',type_oid=2950,acl=None)],effective_write=privileges()) for i,name in enumerate(M.TABLES)]
    guard=dict(name='investigation_native_receipt_guard',revision='40',enabled='O',type=27,function=M.GUARD,schema='public',
               unconditional=True,columns='',args_hex='',internal=False,constraint_oid='0',parent_oid='0',old_table=None,new_table=None)
    return dict(database='postgres',database_oid=5,schema='public',current_role='postgres',session_role='postgres',observer_bypassrls=True,
                server_version_num='180000',server_started_at=(now-timedelta(days=1)).isoformat(),snapshot='100:105:101,103',observed_at=now.isoformat(),
                role_scope_count=len(roles),role_scope=roles,membership_count=len(memberships),memberships=memberships,
                function_count=len(functions),functions=functions,relation_count=len(relations),relations=relations,guards=[guard],
                native_count=len(native),native_rows=list(native))


def original(*, phase='started', canonical='not_applied', tracked=True):
    claimed=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()
    return dict(principal=P,operation=O,generation=G if tracked else None,native_phase=phase if tracked else None,
                native_claimed_at=claimed if tracked else None,
                native_completed_at=(datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat() if tracked and phase=='retained' else None,
                canonical_status=canonical,request_sha256='b'*64,binding_sha256='c'*64 if tracked else None)


class Transport:
    def __init__(self,rows,*,status=200,after=None):self.rows=rows;self.status=status;self.after=after;self.calls=[]
    def __call__(self,argv,**kwargs):
        assert argv[0]=='curl' and API_URL.format(ref=PROJECT) in argv
        assert TOKEN not in ' '.join(argv) and TOKEN in kwargs['input']
        body=Path(argv[argv.index('--data-binary')+1][1:])
        assert body.stat().st_mode&0o777==0o600
        sql=json.loads(body.read_text())['query'];assert sql==M.CATALOG_QUERY
        self.calls.append(sql);number=len(self.calls)-1
        data=copy.deepcopy(self.rows[min(number,len(self.rows)-1)])
        if self.after:self.after(number)
        return subprocess.CompletedProcess(argv,0,json.dumps([{'closure':data}])+f'\n{self.status}','')


def observe(source, before, after=None, *, status=200, callback=None):
    second=copy.deepcopy(before) if after is None else copy.deepcopy(after)
    if after is None:second['observed_at']=(datetime.fromisoformat(before['observed_at'])+timedelta(microseconds=1)).isoformat()
    transport=Transport([before,second],status=status,after=callback)
    runner=CurlRunner(PROJECT,TOKEN,runner=transport)
    result=M.observe_rpc_closure(runner=runner,source_root=source[0],expected_source_sha=source[1],expected_project_ref=PROJECT,expected_database='postgres')
    return result,transport,runner


def assert_unproved(result):
    for field in ('http_current_set_qualified','admission_cutoff_proven','drain_proven','old_effects_reconciled','cutover_qualified'):
        assert result[field] is False
    assert result['schema_application_provenance']=='not_attested'


@pytest.mark.parametrize('late',[False,True])
def test_real_fixed_owner_interface_can_qualify_declared_rpc_facet_with_optional_late_completion_only(source,late):
    before=snapshot(source,late=late)
    result,transport,_=observe(source,before)
    assert result['state']=='declared_rpc_new_work_closed' and result['rpc_new_work_closed'] is True
    assert not result['errors'] and len(transport.calls)==2
    a,b=result['observations'];assert a['current_set_revision']==b['current_set_revision']
    assert bool(b['late_completion_grants']) is late
    assert_unproved(result)


def test_native_not_applied_with_started_phase_and_untracked_originals_never_becomes_drained(source):
    first=original();second=original(tracked=False);second['operation']='44444444-4444-4444-8444-444444444444'
    result,_,_=observe(source,snapshot(source,native=[first,second]))
    assert result['rpc_new_work_closed'] is True
    assert result['observations'][0]['originals']==[first,second]
    assert_unproved(result)


def test_empty_actual_owner_inventory_only_qualifies_rpc_facet_not_admitted_request_or_native_drain(source):
    result,_,_=observe(source,snapshot(source))
    assert result['rpc_new_work_closed'] is True and result['observations'][0]['originals']==[]
    assert_unproved(result)


@pytest.mark.parametrize('name',sorted(M.NEW_WORK))
@pytest.mark.parametrize('role',M.ROLES)
def test_any_direct_new_work_grant_refuses_even_when_other_roles_are_closed(source,name,role):
    row=snapshot(source)
    next(v for f in row['functions'] if f['name']==name for v in f['effective_execute'] if v['origin']==role)['allowed']=True
    result,transport,_=observe(source,row)
    assert result['rpc_new_work_closed'] is False and result['errors']==['new_work_or_untrusted_completion_role_open']
    assert len(transport.calls)==1;assert_unproved(result)


def test_inherited_noinherit_role_is_included_in_the_actual_effective_privilege_scope(source):
    row=snapshot(source,inherited=True)
    next(v for f in row['functions'] if f['name']=='claim_investigation_native_capture_v1' for v in f['effective_execute'] if v['role_oid']==150)['allowed']=True
    result,_,_=observe(source,row)
    assert result['errors']==['new_work_or_untrusted_completion_role_open'] and result['rpc_new_work_closed'] is False


@pytest.mark.parametrize('fault',['public','legacy-six','unknown-overload','missing-function','body','owner','config','late-auth','table-dml','column-dml',
                                  'missing-role','empty-role','partial-privileges','wrong-role-key','missing-relation','partial-native','guard-disabled',
                                  'guard-conditional','guard-numeric','guard-extra','bypassrls','timestamp-stale','future-epoch','server-version-type',
                                  'native-binding','native-generation','native-completed-started','native-duplicate','raw-extra'])
def test_missing_partial_stale_mismatched_source_and_role_facts_refuse(source,fault):
    row=snapshot(source,native=[original()])
    if fault=='public':row['functions'][0]['public_execute']=True
    elif fault in {'legacy-six','unknown-overload'}:
        extra=copy.deepcopy(next(f for f in row['functions'] if f['name']=='apply_investigation_revision_v2'));extra['oid']=999
        extra['arguments']='uuid,integer,text,uuid,jsonb,jsonb' if fault=='legacy-six' else 'text'
        row['functions'].append(extra);row['function_count']+=1
    elif fault=='missing-function':row['functions'].pop();row['function_count']-=1
    elif fault in {'body','owner','config'}:
        key={'body':'body_sha256','owner':'owner','config':'config'}[fault]
        next(f for f in row['functions'] if f['name']==M.LATE_COMPLETION)[key]=['search_path=evil'] if fault=='config' else ('d'*64 if fault=='body' else 'foreign_owner')
    elif fault=='late-auth':next(v for f in row['functions'] if f['name']==M.LATE_COMPLETION for v in f['effective_execute'] if v['origin']=='authenticated')['allowed']=True
    elif fault in {'table-dml','column-dml'}:row['relations'][0]['effective_write'][2]['allowed']=True
    elif fault=='missing-role':row['role_scope'].pop();row['role_scope_count']-=1
    elif fault=='empty-role':row['role_scope']=[];row['role_scope_count']=0
    elif fault=='partial-privileges':row['functions'][0]['effective_execute'].pop()
    elif fault=='wrong-role-key':row['functions'][0]['effective_execute'][0]['role_oid']=999
    elif fault=='missing-relation':row['relations'].pop();row['relation_count']-=1
    elif fault=='partial-native':row['native_count']+=1
    elif fault=='guard-disabled':row['guards'][0]['enabled']='D'
    elif fault=='guard-conditional':row['guards'][0]['unconditional']=False
    elif fault=='guard-numeric':row['guards'][0]['unconditional']=1
    elif fault=='guard-extra':row['guards'].append(copy.deepcopy(row['guards'][0]))
    elif fault=='bypassrls':row['observer_bypassrls']=False
    elif fault=='timestamp-stale':row['observed_at']=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat()
    elif fault=='future-epoch':row['server_started_at']=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
    elif fault=='server-version-type':row['server_version_num']=True
    elif fault=='native-binding':row['native_rows'][0]['binding_sha256']='SECRET'
    elif fault=='native-generation':row['native_rows'][0]['generation']=None
    elif fault=='native-completed-started':row['native_rows'][0]['native_completed_at']=row['native_rows'][0]['native_claimed_at']
    elif fault=='native-duplicate':row['native_rows']*=2;row['native_count']=2
    elif fault=='raw-extra':row['raw']='SECRET https://private.invalid credential'
    result,transport,_=observe(source,row)
    assert result['rpc_new_work_closed'] is False and result['errors'] and len(transport.calls)==1
    assert 'SECRET' not in json.dumps(result);assert_unproved(result)


@pytest.mark.parametrize('change',['role-revision','function-revision','membership','relation-revision','attribute-revision','guard-revision','target','clock-replay'])
def test_two_reads_are_bound_to_the_same_current_set_and_database_epoch_without_replay(source,change):
    first=snapshot(source);second=copy.deepcopy(first)
    second['observed_at']=(datetime.fromisoformat(first['observed_at'])+timedelta(microseconds=1)).isoformat()
    if change=='role-revision':second['role_scope'][0]['revision']='f'*64
    elif change=='function-revision':second['functions'][0]['revision']='99'
    elif change=='membership':
        second['memberships']=[dict(roleid=100,member=101,grantor=10,admin_option=False,revision='99')];second['membership_count']=1
    elif change=='relation-revision':second['relations'][0]['revision']='99'
    elif change=='attribute-revision':second['relations'][0]['attributes'][0]['revision']='99'
    elif change=='guard-revision':second['guards'][0]['revision']='99'
    elif change=='target':second['database_oid']=99
    else:second['observed_at']=first['observed_at']
    result,transport,_=observe(source,first,second)
    assert result['rpc_new_work_closed'] is False and result['errors'] and len(transport.calls)==2
    assert len(result['observations'])==2;assert_unproved(result)


def test_late_native_completion_is_retained_as_a_fact_but_cannot_become_drain_or_cutoff(source):
    first=snapshot(source,native=[original()]);second=copy.deepcopy(first)
    second['observed_at']=(datetime.fromisoformat(first['observed_at'])+timedelta(microseconds=1)).isoformat()
    second['native_rows'][0]['native_phase']='retained';second['native_rows'][0]['native_completed_at']=first['observed_at']
    result,transport,_=observe(source,first,second)
    assert result['errors']==['original_phase_inventory_changed'] and result['rpc_new_work_closed'] is False
    assert [r['originals'][0]['native_phase'] for r in result['observations']]==['started','retained']
    assert len(transport.calls)==2;assert_unproved(result)


@pytest.mark.parametrize('status',[401,403,500])
def test_owner_denial_and_unavailable_query_are_never_retried_or_leaked(source,status):
    row=snapshot(source);row['raw']='SECRET credential body'
    result,transport,_=observe(source,row,status=status)
    assert len(transport.calls)==1 and result['http_status']==status and result['rpc_new_work_closed'] is False
    assert 'SECRET' not in json.dumps(result) and TOKEN not in json.dumps(result)


def test_changed_source_between_reads_stops_on_the_same_owner_without_a_second_query(source):
    row=snapshot(source)
    def mutate(number):
        if number==0:
            p=source[0]/M.NATIVE.MIGRATION;p.write_bytes(p.read_bytes()+b'\n-- changed\n')
    result,transport,_=observe(source,row,callback=mutate)
    assert len(transport.calls)==1 and result['rpc_new_work_closed'] is False and result['errors']==['source_worktree_changed']
    assert len(result['observations'])==1


def test_fixed_query_contains_complete_native_owner_scope_and_no_mutation_or_secret_projection():
    statements=split_statements(M.CATALOG_QUERY)
    assert len(statements)==1 and statements[0].startswith('WITH declared_roles')
    for text in ('pg_has_role(d.oid,r.oid,\'MEMBER\')','has_function_privilege','has_any_column_privilege',
                 'pg_auth_members','m.xmin::text','observer_bypassrls','native_binding','LIMIT 129'):
        assert text in M.CATALOG_QUERY
    assert 'rolpassword' not in M.CATALOG_QUERY and 'pg_authid' not in M.CATALOG_QUERY and 'row_security' not in M.CATALOG_QUERY
    assert not any(token in M.CATALOG_QUERY.lower() for token in ('revoke ', 'grant ', 'delete from ', 'update public.', 'insert into '))


@pytest.mark.parametrize('path',M.SOURCE_INTERFACES)
def test_actual_source_and_executing_owner_bindings_cannot_change_between_reads(source,path):
    row=snapshot(source)
    def mutate(number):
        if number==0:
            p=source[0]/path;p.write_bytes(p.read_bytes()+b'\n# SECRET drift\n')
    result,transport,_=observe(source,row,callback=mutate)
    assert len(transport.calls)==1 and result['errors']==['executing_owner_source_mismatch']
    assert not result['rpc_new_work_closed'] and len(result['observations'])==1 and 'SECRET' not in json.dumps(result)


@pytest.mark.parametrize('attribute,value',[('project_ref','b'*20),('token','changed-secret-token'),('timeout',17)])
def test_same_owner_target_and_credential_context_are_checked_after_the_actual_query(source,attribute,value):
    row=snapshot(source);second=copy.deepcopy(row)
    second['observed_at']=(datetime.fromisoformat(row['observed_at'])+timedelta(microseconds=1)).isoformat()
    transport=Transport([row,second]);runner=CurlRunner(PROJECT,TOKEN,runner=transport)
    transport.after=lambda number:setattr(runner,attribute,value) if number==0 else None
    result=M.observe_rpc_closure(runner=runner,source_root=source[0],expected_source_sha=source[1],expected_project_ref=PROJECT,expected_database='postgres')
    assert result['errors']==['owner_target_changed'] and len(transport.calls)==1
    assert not result['rpc_new_work_closed']
    if type(value) is str:assert value not in json.dumps(result)


@pytest.mark.parametrize('field',['role_scope','memberships','functions','relations','native_rows'])
def test_a_caller_cannot_hide_partial_sets_behind_an_empty_or_zero_count(source,field):
    row=snapshot(source,native=[original()],inherited=True)
    count={'role_scope':'role_scope_count','memberships':'membership_count','functions':'function_count',
           'relations':'relation_count','native_rows':'native_count'}[field]
    row[field]=[]
    result,transport,_=observe(source,row)
    assert result['errors']==['catalog_set_partial_or_oversize'] and len(transport.calls)==1
    assert not result['rpc_new_work_closed'];assert_unproved(result)


def test_metadata_inventory_overflow_refuses_instead_of_accepting_a_truncated_first_page(source):
    row=snapshot(source);row['native_count']=129;row['native_rows']=[original()]*129
    result,_,_=observe(source,row)
    assert result['errors']==['catalog_set_partial_or_oversize'] and not result['rpc_new_work_closed']


def test_no_json_receipt_or_arbitrary_queryrunner_entrance_and_malformed_identity_cannot_leak(source):
    called=[]
    result=M.observe_rpc_closure(runner=lambda query:called.append(query) or {'ready':True},source_root=source[0],
                                expected_source_sha='SECRET',expected_project_ref=PROJECT,expected_database='postgres')
    assert result['errors']==['incumbent_target_binding_invalid'] and result['source_sha'] is None
    assert called==[] and 'SECRET' not in json.dumps(result);assert_unproved(result)
