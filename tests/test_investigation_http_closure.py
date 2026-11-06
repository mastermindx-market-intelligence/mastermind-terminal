"""S7 controlled owner IO and private-attempt facts, never a live host/proc/API.

No process spawn, sockets, systemd, credentials, catalog or production query.
The existing installer owns all captures; fixtures replace its IO boundaries.
"""
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('http_owner_under_test', ROOT/'ops/investigation_http_closure.py')
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)
SHA='a'*40
OLD='b'*40
BOOT='12345678-1234-1234-1234-123456789012'


def config():
    return {'apps': {'http': {'servers': {'one': {'routes': [
        {'match': [{'host': ['beta.mastermind-x.com'], 'path': ['/api/*']}],
         'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:3001'}]}]},
        {'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:3000'}]}]},
        {'handle': [{'handler': 'headers', 'response': {'set': {'Authorization': ['SECRET']}}}]}
    ]}}}}}


def sample(*, prior=False):
    offset=0 if prior else 100
    units=[]
    for name, (_,_,_,port) in h.PROFILES.items():
        pid=(10 if name=='production' else 20)+offset
        units.append(dict(unit=h.PROFILES[name][0],source_sha=OLD if prior else SHA,build_id='old' if prior else 'new',
                          invocation_id=('1' if prior else '2')*32,cgroup='/system.slice/'+h.PROFILES[name][0]+'.service',
                          processes=[dict(pid=pid,start_ticks=str(pid*100),role='server',initial_closed=not prior,node_executable=True)],
                          boot_contract=not prior,port=port))
    nodes=[{k:p[k] for k in ('pid','start_ticks')} for u in units for p in u['processes']]
    listeners=[dict(pid=u['processes'][0]['pid'],start_ticks=u['processes'][0]['start_ticks'],address='127.0.0.1',port=u['port'],inode=str(u['port'])) for u in units]
    return dict(schema='terminal.http_observation.v1',owner_source_sha=SHA,host=h.HOST,boot_id=BOOT,
                proxy=dict(reader_sha256=h.DRIVER_SHA256,etag='"config/x"',projection=h._proxy_projection(config())),
                units=units,nodes=nodes,listeners=listeners,scope='local-terminal-node-owner',global_cutover_qualified=False,macro_options_http='unqualified')


def assess(before=None,after=None,pids=None):
    return h.assess_exit(before if before is not None else sample(prior=True),after if after is not None else sample(),
                         pids if pids is not None else {'10':None,'20':None},SHA,SHA,'new')


def test_factual_exit_keeps_cross_owner_unqualified():
    result=assess()
    assert result['state']=='local_terminal_http_exit_observed'
    assert result['global_cutover_qualified'] is False
    assert result['macro_options_http']=='unqualified'
    assert result['before']['units'][0]['boot_contract'] is False


@pytest.mark.parametrize('mutate',[
 lambda b,c: b.clear(),
 lambda b,c: b.update(nodes=[]),
 lambda b,c: c['nodes'].append({'pid':999,'start_ticks':'9'}),
 lambda b,c: c['units'].pop(),
 lambda b,c: c['listeners'].pop(),
 lambda b,c: c['listeners'][0].update(port=9001),
 lambda b,c: c.update(boot_id='99999999-1234-1234-1234-123456789012'),
 lambda b,c: c['proxy'].update(etag='"new"'),
 lambda b,c: c.update(owner_source_sha=OLD),
 lambda b,c: c.update(host='other-host'),
 lambda b,c: c.update(global_cutover_qualified=True),
 lambda b,c: c.update(macro_options_http='ready'),
 lambda b,c: c['units'][0].update(boot_contract=False),
 lambda b,c: c['units'][0]['processes'][0].update(initial_closed=False),
 lambda b,c: c['units'][1].update(source_sha=OLD),
 lambda b,c: c['units'][1].update(build_id='foreign'),
 lambda b,c: c['units'][0]['processes'].append(copy.deepcopy(c['units'][0]['processes'][0])),
 lambda b,c: c['proxy'].update(reader_sha256='0'*64),
])
def test_missing_hidden_partial_or_changed_never_qualifies(mutate):
    b,c=sample(prior=True),sample();mutate(b,c)
    with pytest.raises(h.Unavailable): assess(b,c)


@pytest.mark.parametrize('states',[{}, {'10':None}, {'10':'1000','20':None}, {'10':'999999','20':None}, {'10':None,'20':None,'999':None}])
def test_old_alive_reused_or_partial_is_not_exit(states):
    with pytest.raises(h.Unavailable): assess(pids=states)


def test_proxy_all_branches_and_secrecy():
    value=config(); value['apps']['http']['servers']['one']['errors']={'routes':[
      {'handle':[{'handler':'reverse_proxy','upstreams':[{'dial':'localhost:3001'}]}]}]}
    rows=h._proxy_projection(value)
    assert len(rows)==3
    assert [r['route'] for r in rows]==[0,1,2]
    assert 'SECRET' not in json.dumps(rows) and 'Authorization' not in json.dumps(rows)


@pytest.mark.parametrize('upstream',[{'dial':'other:3001'},{'dial':'{dynamic}:3001'},{'dial':'127.0.0.1:3001','headers':{}},{}])
def test_unknown_proxy_target_refuses(upstream):
    value=config();value['apps']['http']['servers']['one']['routes'][0]['handle'][0]['upstreams']=[upstream]
    with pytest.raises(h.Unavailable): h._proxy_projection(value)


def controlled_owner(monkeypatch, snapshots=None):
    owner=h.TerminalHttpOwner.__new__(h.TerminalHttpOwner); owner.repo=Path('/controlled');owner.source_sha=SHA
    s=sample(); calls=[]
    monkeypatch.setattr(h.socket,'gethostname',lambda:h.HOST)
    monkeypatch.setattr(h.os,'geteuid',lambda:0)
    monkeypatch.setattr(owner,'_boot',lambda:BOOT)
    monkeypatch.setattr(owner,'_nodes',lambda:copy.deepcopy(s['nodes']))
    monkeypatch.setattr(owner,'_unit',lambda p,closed:copy.deepcopy(next(u for u in s['units'] if u['unit']==h.PROFILES[p][0])))
    monkeypatch.setattr(owner,'_sockets',lambda nodes:copy.deepcopy(s['listeners']))
    monkeypatch.setattr(h,'_read',lambda *a: b'bound driver')
    monkeypatch.setattr(h,'DRIVER_SHA256',h.hashlib.sha256(b'bound driver').hexdigest())
    def read():
        calls.append('read')
        return (copy.deepcopy(config()),'"config/x"') if not snapshots else snapshots.pop(0)
    monkeypatch.setattr(h,'_safe_driver',lambda:SimpleNamespace(read=read))
    return owner,s,calls


def test_real_owner_snapshot_reads_twice_binds_actual_sets(monkeypatch):
    owner,s,calls=controlled_owner(monkeypatch)
    result=owner.snapshot(require_closed=True)
    assert calls==['read','read']
    assert result['nodes']==s['nodes'] and result['units']==s['units']
    assert result['global_cutover_qualified'] is False and 'SECRET' not in json.dumps(result)


@pytest.mark.parametrize('kind',['hidden','empty','extra_port','etag','partial','source_generation'])
def test_actual_owner_boundary_fail_closed(monkeypatch,kind):
    owner,s,calls=controlled_owner(monkeypatch)
    if kind=='hidden': s['nodes'].append({'pid':999,'start_ticks':'1'})
    if kind=='empty': s['nodes'].clear()
    if kind=='extra_port': s['listeners'][0]['port']=9999
    if kind=='partial': s['listeners'].clear()
    if kind=='etag':
        n=iter(['"first"','"second"']);monkeypatch.setattr(h,'_safe_driver',lambda:SimpleNamespace(read=lambda:(config(),next(n))))
    if kind=='source_generation':
        count=[0]
        def unit(p,closed):
            count[0]+=1
            u=copy.deepcopy(next(u for u in s['units'] if u['unit']==h.PROFILES[p][0]))
            if count[0]>2:u['source_sha']=OLD
            return u
        monkeypatch.setattr(owner,'_unit',unit)
    with pytest.raises(h.Unavailable):owner.snapshot(require_closed=True)


def test_after_requires_private_prior_before_any_provider(monkeypatch):
    monkeypatch.setattr(h,'TerminalHttpOwner',lambda *a:pytest.fail('must refuse before native owner creation'))
    with pytest.raises(h.Unavailable):h.capture_after('/repo',SHA,{},SHA,'new')


def test_capture_after_and_current_observer_recheck_prior_pid(monkeypatch):
    owner=SimpleNamespace(snapshot=lambda **kw:copy.deepcopy(sample()),_pid=lambda pid:None)
    monkeypatch.setattr(h,'TerminalHttpOwner',lambda *a:owner)
    result=h.capture_after('/repo',SHA,sample(prior=True),SHA,'new')
    assert h.observe_current('/repo',SHA,result)['state']=='local_terminal_http_observation_current'
    owner._pid=lambda pid:'1234'
    with pytest.raises(h.Unavailable,match='earlier_process'):h.observe_current('/repo',SHA,result)


def statectl():
    source=(ROOT/'ops/terminal-build.sh').read_text()
    body=source.split("<<'PY_STATECTL'",1)[1].split('\n',1)[1].split('\nPY_STATECTL',1)[0]
    ns={'__name__':'test_private_installer_owner'};exec(compile(body,'<statectl>','exec'),ns)
    return ns


def attempt_fixture(monkeypatch):
    ns=statectl(); events=[]
    a=dict(phase='staging',live_inputs_dirty=False,prior_runtime_record_id='p',app_root='/beta',canonical_repo='/repo',prior_sha=OLD,prior_build_id='old',target_sha=SHA)
    current=[a,'path']
    ns.update(read_attempt=lambda *args:(current[1],copy.deepcopy(current[0])),hex64=lambda *args:None,
      pointer_destination=lambda *args:('prior',None),validated_runtime=lambda *args:{'old':True},
      require_live_identity=lambda *args:None,norm=lambda p:p)
    original_id=ns['record_id']
    ns['record_id']=lambda value:'p' if value=={'old':True} else original_id(value)
    def save(root,state,identifier,old_path,value):
        events.append(('save',copy.deepcopy(value)))
        current[:]=[copy.deepcopy(value),'path'+str(len(events))]
        return current[1],copy.deepcopy(value)
    ns['_http_save']=save
    def before(*args):
        events.append(('read',None));assert current[0]['terminal_http_before']['state']=='observing'
        return sample(prior=True)
    ns['_http_module']=lambda *args:dict(Unavailable=h.Unavailable,capture_before=before,capture_after=lambda *args:assess())
    return ns,current,events


def test_private_attempt_intent_precedes_read_and_second_sample_refused(monkeypatch):
    ns,current,events=attempt_fixture(monkeypatch)
    args=['root','state','attempt',ns['record_id'](current[0])]
    assert ns['_http_action'](args,'before')==0
    assert [v[0] for v in events]==['save','read','save']
    assert current[0]['terminal_http_before']['state']=='observed'
    with pytest.raises(SystemExit):ns['_http_action'](['root','state','attempt',ns['record_id'](current[0])],'before')
    assert len(events)==3


def test_failed_owner_read_is_sticky_and_secret_safe(monkeypatch):
    ns,current,events=attempt_fixture(monkeypatch)
    def broken(*args):raise PermissionError('SECRET runtime denial')
    ns['_http_module']=lambda *args:dict(Unavailable=h.Unavailable,capture_before=broken)
    with pytest.raises(SystemExit):ns['_http_action'](['root','state','attempt',ns['record_id'](current[0])],'before')
    assert current[0]['terminal_http_before']['state']=='unavailable'
    assert 'SECRET' not in json.dumps(current[0])
    with pytest.raises(SystemExit):ns['_http_action'](['root','state','attempt',ns['record_id'](current[0])],'before')
    assert len(events)==2


def test_lost_read_result_keeps_original_observing_intent(monkeypatch):
    ns,current,events=attempt_fixture(monkeypatch)
    def lost(*args):raise KeyboardInterrupt()
    ns['_http_module']=lambda *args:dict(Unavailable=h.Unavailable,capture_before=lost)
    with pytest.raises(KeyboardInterrupt):ns['_http_action'](['root','state','attempt',ns['record_id'](current[0])],'before')
    assert current[0]['terminal_http_before']['state']=='observing'
    with pytest.raises(SystemExit):ns['_http_action'](['root','state','attempt',ns['record_id'](current[0])],'before')
    assert len(events)==1


def test_missing_prestate_or_changed_attempt_precedes_any_new_native_read(monkeypatch):
    ns,current,_=attempt_fixture(monkeypatch)
    ns['_http_module']=lambda *args:pytest.fail('must refuse before native module')
    with pytest.raises(SystemExit):ns['_http_action'](['root','state','attempt','0'*64],'before')
    current[0]['phase']='validated'
    with pytest.raises(SystemExit):ns['_http_action'](['root','state','attempt',ns['record_id'](current[0])],'after')


def test_source_hooks_optional_default_off_and_ordered():
    source=(ROOT/'ops/terminal-build.sh').read_text()
    assert 'HTTP_OBSERVATION_REQUESTED=0' in source
    begin=source.split('beta_txn_begin(){',1)[1].split('\n}\n',1)[0]
    assert begin.index('attempt-begin')<begin.index('beta_http_capture before')<begin.index('systemctl disable')
    commit=source.split('beta_txn_commit(){',1)[1].split('\n}\n',1)[0]
    assert commit.index('beta_txn_phase validated')<commit.index('beta_http_capture after')<commit.index('beta_txn_phase committing')
    hook=source.split('beta_http_capture(){',1)[1].split('\n}\n',1)[0]
    assert hook.index('HTTP_OBSERVATION_REQUESTED')<hook.index('beta_statectl http-pending-id')
    assert 'DEPLOY_LOCK_HELD' in hook and 'return 0' in hook
    runtime=source.split('def action_runtime(args):',1)[1].split('\ndef action_demote',1)[0]
    assert 'terminal_http_observation' in runtime
    assert 'if (attempt.get("terminal_http_before",{}).get("state")=="observed"' in runtime

@pytest.mark.parametrize('flags,stable,expected',[(0x00200000,True,True),(0,True,False),(0x00200000,False,False)])
def test_no_executable_only_excludes_stable_actual_kernel_thread(monkeypatch,flags,stable,expected):
    owner=h.TerminalHttpOwner.__new__(h.TerminalHttpOwner)
    class Proc:
        def iterdir(self):return [Path('/fake/1')]
        def __truediv__(self,value):return Path('/fake')/value
    monkeypatch.setattr(h,'PROC',Proc())
    monkeypatch.setattr(h.os,'readlink',lambda p:(_ for _ in ()).throw(FileNotFoundError()))
    fields=['S']+['0']*19;fields[6]=str(flags);fields[19]='1234'
    monkeypatch.setattr(h,'_read',lambda *a:('1 (kernel thread) '+' '.join(fields)).encode())
    monkeypatch.setattr(owner,'_pid',lambda pid:'1234' if stable else '9999')
    if expected: assert owner._nodes()==[]
    else:
        with pytest.raises(h.Unavailable):owner._nodes()


def test_partial_permission_read_never_becomes_an_empty_process_set(monkeypatch):
    owner=h.TerminalHttpOwner.__new__(h.TerminalHttpOwner)
    class Proc:
        def iterdir(self):return [Path('/fake/1')]
        def __truediv__(self,value):return Path('/fake')/value
    monkeypatch.setattr(h,'PROC',Proc())
    monkeypatch.setattr(h.os,'readlink',lambda p:(_ for _ in ()).throw(PermissionError('not an absence')))
    with pytest.raises(PermissionError):owner._nodes()


def test_read_reaches_eof_and_refuses_oversize_or_symlink(tmp_path):
    p=tmp_path/'owned';p.write_bytes(b'x'*131073)
    with pytest.raises(h.Unavailable):h._read(p)
    assert h._read(p,131073)==b'x'*131073
    link=tmp_path/'alias';link.symlink_to(p)
    with pytest.raises(OSError):h._read(link,131073)


def test_provider_construction_binds_same_immutable_owner_and_boot_sources(monkeypatch):
    calls=[]
    source=(ROOT/'ops/terminal-build.sh').read_bytes()
    def git(repo,*args):
        calls.append(args)
        path=args[-1].split(':',1)[1]
        return source if path=='ops/terminal-build.sh' else (ROOT/path).read_bytes()
    monkeypatch.setattr(h,'_git',git)
    owner=h.TerminalHttpOwner('/controlled',SHA)
    assert calls==[('show',SHA+':'+p) for p in ['ops/terminal-build.sh','terminal/lib/investigationApiAdmission.ts','terminal/lib/investigationBootAdmission.ts']]
    assert callable(owner.ns['classify_serving_processes'])
    assert len(owner.boot_blobs)==2


def beta_only_pair():
    """The only supported opt-in transaction replaces beta, not production."""
    before=sample(prior=True);after=sample()
    production=copy.deepcopy(after['units'][0])
    before['units'][0]=production
    before['nodes'][0]=copy.deepcopy(after['nodes'][0])
    before['listeners'][0]=copy.deepcopy(after['listeners'][0])
    return before,after,{'110':'11000','20':None}


def test_normal_beta_only_replacement_preserves_fully_bound_born_closed_production():
    before,after,states=beta_only_pair()
    result=assess(before,after,states)
    assert result['state']=='local_terminal_http_exit_observed'
    assert result['global_cutover_qualified'] is False
    assert result['macro_options_http']=='unqualified'


def test_actual_beta_owner_after_and_current_observer_support_same_stable_production(monkeypatch):
    before,after,states=beta_only_pair()
    owner=SimpleNamespace(snapshot=lambda **kw:copy.deepcopy(after),_pid=lambda pid:states.get(str(pid)))
    monkeypatch.setattr(h,'TerminalHttpOwner',lambda *a:owner)
    result=h.capture_after('/repo',SHA,before,SHA,'new')
    assert h.observe_current('/repo',SHA,result)['state']=='local_terminal_http_observation_current'


@pytest.mark.parametrize('mutate',[
 lambda b,c,s: b['units'][0].update(boot_contract=False),
 lambda b,c,s: b['units'][0]['processes'][0].update(initial_closed=False),
 lambda b,c,s: b['units'][0].update(source_sha=OLD),
 lambda b,c,s: b['units'][0].update(build_id='old'),
 lambda b,c,s: b['units'][0].update(invocation_id='f'*32),
 lambda b,c,s: b['units'][0].update(cgroup='/system.slice/other.service'),
 lambda b,c,s: b['units'][0]['processes'][0].update(role='launcher'),
 lambda b,c,s: b['units'][0]['processes'][0].update(node_executable=False),
 lambda b,c,s: b['listeners'][0].update(address='0.0.0.0'),
 lambda b,c,s: b['listeners'][0].update(inode='999'),
 lambda b,c,s: b['listeners'].pop(0),
 lambda b,c,s: b['nodes'].pop(0),
 lambda b,c,s: b['proxy'].update(etag='"other"'),
 lambda b,c,s: s.update({'110':'99999'}),
 lambda b,c,s: s.update({'110':None}),
 lambda b,c,s: s.pop('110'),
 lambda b,c,s: s.update({'20':'2000'}),
])
def test_retained_production_requires_every_bound_birth_and_generation_fact(mutate):
    before,after,states=beta_only_pair();mutate(before,after,states)
    with pytest.raises(h.Unavailable):assess(before,after,states)


@pytest.mark.parametrize('phase',['second_snapshot','second_pid','later_observer'])
def test_retained_production_must_stay_bound_through_fresh_checks(monkeypatch,phase):
    before,after,states=beta_only_pair();counts={'snapshot':0,'pid':0}
    def snapshot(**kw):
        counts['snapshot']+=1;value=copy.deepcopy(after)
        if phase=='second_snapshot' and counts['snapshot']>1:value['units'][0]['invocation_id']='f'*32
        return value
    def pid(value):
        counts['pid']+=1
        if phase=='second_pid' and counts['pid']>2 and value==110:return '99999'
        return states.get(str(value))
    owner=SimpleNamespace(snapshot=snapshot,_pid=pid)
    monkeypatch.setattr(h,'TerminalHttpOwner',lambda *a:owner)
    if phase!='later_observer':
        with pytest.raises(h.Unavailable):h.capture_after('/repo',SHA,before,SHA,'new')
    else:
        result=h.capture_after('/repo',SHA,before,SHA,'new')
        states['110']='99999'
        with pytest.raises(h.Unavailable):h.observe_current('/repo',SHA,result)
