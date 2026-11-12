"""One attended probability proof run through the existing Playwright config and validators."""
from pathlib import Path
import datetime, hashlib, json, os, re, shutil, subprocess, time

ROOT = Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr678-probability-integration-20261109-c4')
assert ROOT.resolve() == ROOT
TERMINAL = ROOT / 'terminal'
CAPTURE = TERMINAL / 'docs/verification/exposure-workspace-20261103/probability-weighting-integration-20261112'
AUDIT = ROOT / 'docs/verification/pr678-protected-refresh-20261112/browser-qualification-r1'
PORT = 3912
OPERATION = 'terminal-pr678-probability-browser-current-20261112'
HEAD = 'a1e58b46da592bf03b1279e57cd1aff315946c0c'
HEAD_TREE = '813cdf5335cd28cf772533e50efdb18a501f0d4b'
MERGE_HEAD = None
PROTECTED_MASTER = '6c5d71ebbd797897b50f8727588bd95e834517a8'
PUBLISHED_BASIS = 'a1e58b46da592bf03b1279e57cd1aff315946c0c'
INTEGRATED_HEADS = ["492a73948a947c3cccc2981e90a5cc227d96385f","6c5d71ebbd797897b50f8727588bd95e834517a8"]
INDEX_TREE = '813cdf5335cd28cf772533e50efdb18a501f0d4b'
FORBIDDEN = ['EXPOSURE_P09_CURRENT_WITNESS', 'EXPOSURE_P09_PREVIOUS_WITNESS', 'EXPOSURE_NATIVE_WITNESS',
    'TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE', 'TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE', 'TERMINAL_EXPOSURE_PAINT_PROBE']

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(raw): return hashlib.sha256(raw).hexdigest()
def sha(path): return digest(path.read_bytes())
def write_json(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')
def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()
def command_receipt(command):
    result = subprocess.run(command, text=True, capture_output=True)
    return {'command': command, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
def node_json(source, args=()):
    result = subprocess.run(['node', '-e', source, *map(str,args)], cwd=TERMINAL, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('READ_ONLY_VALIDATOR_FAILED: ' + result.stderr[-4000:])
    return json.loads(result.stdout)

def merge_head():
    result=subprocess.run(['git','-C',str(ROOT),'rev-parse','--verify','MERGE_HEAD'],text=True,capture_output=True)
    return result.stdout.strip() if result.returncode==0 else None

def checkout():
    return {'checkoutCommit': git('rev-parse', 'HEAD'), 'checkoutTree': git('rev-parse', 'HEAD^{tree}'),
        'mergeHead': merge_head(), 'indexTree': git('write-tree')}

def runtime():
    port = command_receipt(['lsof', '-nP', '-iTCP:' + str(PORT), '-sTCP:LISTEN'])
    cwd = command_receipt(['lsof', '-nP', '-a', '-d', 'cwd', '-F', 'pn'])
    holders=[]; pid=None
    for line in cwd['stdout'].splitlines():
        if line.startswith('p'): pid=line[1:]
        elif line.startswith('n') and (line[1:] == str(ROOT) or line[1:].startswith(str(ROOT) + '/')):
            holders.append({'pid':pid,'cwd':line[1:]})
    return {'port':PORT,'listener':port,'workspaceCwdHolders':holders,'lockPresent':(TERMINAL/'.next/dev/lock').exists()}

def lock_checks():
    lock=TERMINAL/'.next/dev/lock'
    raw=lock.read_bytes();info=lock.stat();data=json.loads(raw)
    assert isinstance(data.get('pid'),int) and data['pid']>1 and data.get('port')==PORT,data
    assert data.get('hostname')=='127.0.0.1' and data.get('appUrl')=='http://127.0.0.1:'+str(PORT),data
    checks={'pid':command_receipt(['ps','-p',str(data['pid']),'-o','pid=,ppid=,comm=']),
        'lock':command_receipt(['lsof',str(lock)])}
    assert all(x['exit']==1 and x['stdout']=='' and x['stderr']=='' for x in checks.values()),checks
    checked=lock.stat()
    assert info.st_ino==checked.st_ino and info.st_dev==checked.st_dev and lock.read_bytes()==raw
    return {'lock':data,'lockSha256':digest(raw),'checks':checks,
        'lockIdentityBeforeChecks':{'inode':info.st_ino,'device':info.st_dev},
        'lockIdentityAfterChecks':{'inode':checked.st_ino,'device':checked.st_dev}}

def require_free():
    state=runtime()
    assert state['listener']['exit']==1 and state['listener']['stdout']==state['listener']['stderr']=='' and not state['workspaceCwdHolders'],state
    if state['lockPresent']:state['retainedUnlockedFile']=lock_checks()
    return state

def observe_owned_server(playwright_pid):
    lock=TERMINAL/'.next/dev/lock'
    if not lock.is_file():return None
    try:
        raw=lock.read_bytes();data=json.loads(raw);pid=data.get('pid')
        if not isinstance(pid,int) or pid<=1 or data.get('port')!=PORT:return None
        if data.get('hostname')!='127.0.0.1' or data.get('appUrl')!='http://127.0.0.1:'+str(PORT):return None
        listener=command_receipt(['lsof','-nP','-iTCP:'+str(PORT),'-sTCP:LISTEN','-Fp'])
        if listener['exit']!=0 or listener['stderr']:return None
        listener_pids=sorted({int(x[1:]) for x in listener['stdout'].splitlines() if x.startswith('p')})
        if pid not in listener_pids:return None
        ancestry=[];current=pid
        for _ in range(16):
            row=command_receipt(['ps','-p',str(current),'-o','pid=,ppid=,comm='])
            if row['exit']!=0 or row['stderr']:return None
            values=row['stdout'].strip().split(None,2)
            if len(values)!=3:return None
            item={'pid':int(values[0]),'ppid':int(values[1]),'command':values[2]}
            if item['pid']!=current or any(x['pid']==current for x in ancestry):return None
            ancestry.append(item)
            if current==playwright_pid:break
            current=item['ppid']
        if not ancestry or ancestry[-1]['pid']!=playwright_pid:return None
        if lock.read_bytes()!=raw:return None
        return {'pid':pid,'playwrightPid':playwright_pid,'observedAt':now(),'lock':data,
            'lockSha256':digest(raw),'ancestry':ancestry,'listenerPids':listener_pids,'listener':listener}
    except (OSError,ValueError,KeyError):return None

def settle(stage,owned):
    state=runtime();listener=state['listener']
    result={'state':'SETTLING','port':PORT,
        'listenerClosed':listener['exit']==1 and listener['stdout']==listener['stderr']=='',
        'listener':listener,'workspaceCwdHolders':state['workspaceCwdHolders'],'lockPresent':state['lockPresent'],
        'lockUnlinked':False,'lockRetained':False}
    assert result['listenerClosed'] and not result['workspaceCwdHolders'],result
    if state['lockPresent']:
        checks=lock_checks()
        assert owned and checks['lock']['pid']==owned['pid'] and checks['lockSha256']==owned['lockSha256'],{'lock':checks,'owned':owned}
        result.update(checks);result['ownedServerObservation']=owned;result['lockRetained']=True
    result['lockAbsent']=not (TERMINAL/'.next/dev/lock').exists()
    assert result['lockAbsent']!=result['lockRetained']
    result['state']='OWNED_SERVER_STOPPED';write_json(stage/'lifecycle.json',result)
    return result

def source_paths():
    value=node_json('const p=require("node:path"),v=require("./e2e/tools/visualEvidence.cjs"),e=require("./e2e/tools/optionsExposureEvidence.cjs");const r=p.resolve(process.cwd(),"..");console.log(JSON.stringify({visual:Object.keys(v.sourceSnapshot(r)),joint:e.momentumBrowserInputs(),expiry:e.momentumExpiryInputs(),jointSpecs:e.OPTIONS_INTEGRATION_BROWSER_SPECS,expirySpecs:e.EXPIRY_JOURNEY_SPECS}));')
    paths=set()
    output=subprocess.check_output(['git','-C',str(ROOT),'ls-files','--cached','--others','--exclude-standard','-z']).decode()
    for path in output.split('\0'):
        if path.startswith('terminal/') and Path(path).suffix in {'.ts','.tsx','.css','.js','.cjs','.mjs','.json','.py'} and not path.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')):
            paths.add(path)
    paths.update(value['visual']);paths.update(value['expiry'])
    return sorted(paths),value

def snapshot(paths):
    result={}
    for path in paths:
        file=ROOT/path
        assert file.is_file() and not file.is_symlink(),path
        result[path]=sha(file)
    return result

def prior_direct(stage_name):
    directory=TERMINAL/'test-results';directory.mkdir(exist_ok=True)
    prior=AUDIT/('prior-direct-root-'+stage_name);prior.mkdir()
    files=[x for x in sorted(directory.iterdir()) if x.is_file() and x.suffix in {'.png','.json'}]
    record={'state':'PRESERVING','files':{x.name:{'sha256':sha(x),'bytes':x.stat().st_size} for x in files}}
    write_json(AUDIT/('prior-direct-root-'+stage_name+'.json'),record)
    for file in files:
        assert not file.is_symlink();dest=prior/file.name;shutil.copy2(file,dest)
        assert sha(dest)==record['files'][file.name]['sha256'] and sha(file)==sha(dest)
        file.unlink()
    record['state']='PRESERVED_AND_FRESH_ROOT_EMPTY';write_json(AUDIT/('prior-direct-root-'+stage_name+'.json'),record)

def collect_direct(stage):
    direct=stage/'browser-artifacts/direct';direct.mkdir(parents=True)
    for file in sorted((TERMINAL/'test-results').iterdir()):
        if file.is_file() and file.suffix in {'.png','.json'}:
            assert not file.is_symlink();shutil.copy2(file,direct/file.name);assert sha(file)==sha(direct/file.name)
    artifacts={}
    for file in sorted((stage/'browser-artifacts').rglob('*')):
        if file.is_file():
            assert not file.is_symlink();artifacts[str(file.relative_to(stage))]=sha(file)
    return artifacts

def report_cases(report):
    passed=[];skipped=[]
    def visit(suite):
        for spec in suite.get('specs',[]):
            for test in spec['tests']:
                assert len(test['results'])==1 and test['results'][0]['retry']==0
                result=test['results'][0];assert result['status'] in ['passed','skipped']
                (passed if result['status']=='passed' else skipped).append(test['projectName']+'|'+spec['title'])
        for child in suite.get('suites',[]):visit(child)
    visit(report);return passed,skipped

def main():
    assert not CAPTURE.exists() and not AUDIT.exists()
    assert checkout()=={'checkoutCommit':HEAD,'checkoutTree':HEAD_TREE,'mergeHead':MERGE_HEAD,'indexTree':INDEX_TREE}
    assert git('ls-remote','origin','refs/heads/sol/skylit-r5-probability-weighting-20260919').split()[0]==HEAD
    old=json.loads((ROOT/'docs/verification/pr678-protected-refresh-20261112/execution.json').read_text())
    assert old['source_stable'] and all(x['returncode']==0 for x in old['results'])
    assert all(sha(ROOT/path)==value for path,value in old['source_after'].items())
    assert sha(TERMINAL/'e2e/tools/optionsExposureEvidence.cjs')=='753ff1d32da23b7e0b95268aeb20b08b2e6934f6a48cdfda08199bdb38749972'
    (CAPTURE/'prior-roots').mkdir(parents=True)
    roots={'eod':('eod-heatmap-flowdesk-load-failure','398ee08642c4db5eb7ee1648e5865e42146fd98aec9f96a208727bfe003d832d'),
        'gex':('gex-levels-heatmap-load-failure','0ffb688481f64075b6a07181900c709d4c58afe60cd6dce0e1e1c948bc6abf9e')}
    for family,(packet,pin) in roots.items():
        prior=TERMINAL/'docs/pr-crops'/packet/'EVIDENCE.yml';assert sha(prior)==pin
        (CAPTURE/'prior-roots'/(family+'.EVIDENCE.yml')).write_bytes(prior.read_bytes())
    AUDIT.mkdir();native=node_json('const p=require("node:path"),e=require("./e2e/tools/optionsExposureEvidence.cjs");console.log(JSON.stringify(e.verifyExpiryIntegrationNativePrerequisites(p.resolve(process.cwd(),".."))));')
    assert native['state']=='NATIVE_ONLY_VALIDATED' and native['currentBrowserQualified'] is False
    write_json(AUDIT/'native-preflight.json',native)
    initial=require_free();write_json(AUDIT/'initial-lifecycle.json',initial)
    observed=checkout()
    assert observed == {'checkoutCommit':HEAD, 'checkoutTree':HEAD_TREE, 'mergeHead':MERGE_HEAD, 'indexTree':INDEX_TREE}
    actual_git={'head':HEAD,'headTree':HEAD_TREE,'mergeHead':MERGE_HEAD,'indexTree':INDEX_TREE}
    context={'operation':OPERATION,'branchHead':HEAD,'protectedMaster':PROTECTED_MASTER,
        'publishedBasis':PUBLISHED_BASIS,'integratedSourceHeads':INTEGRATED_HEADS,'actualGit':actual_git,
        'checkoutCommit':HEAD,'checkoutTree':HEAD_TREE,'mergeHead':MERGE_HEAD,
        'indexTreeAtStart':observed['indexTree'],'indexTreeAtEnd':observed['indexTree'],'sourceIdentity':'stable-composed-working-tree'}
    write_json(AUDIT/'capture-context.json',context)
    paths,membership=source_paths();before=snapshot(paths);write_json(AUDIT/'source-baseline.json',before)
    assert len(membership['joint'])==72 and len(membership['expiry'])==77
    env=os.environ.copy()
    for key in FORBIDDEN+['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID']:assert not env.get(key),key
    for key in ['GITHUB_ACTIONS','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_HEAD_REF']:assert not env.get(key),key
    cache=Path('/Users/chriswong/Library/Caches/ms-playwright');assert cache.is_dir()
    env.update({'CI':'1','HUB_REALTIME_QUOTES':'1','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_E2E_PORT':str(PORT),
        'TERMINAL_VISUAL_EVIDENCE_OPERATION':OPERATION,'PLAYWRIGHT_BROWSERS_PATH':str(cache)})
    node=subprocess.check_output(['node','--version'],text=True).strip()
    record={'state':'RUNNING','context':context,'sourceFiles':len(before),'results':{},'startedAt':now()};write_json(AUDIT/'execution.json',record)
    print(json.dumps({'state':'STARTED','operation':OPERATION,'context':context,'sourceFiles':len(before)}),flush=True)
    for name,count in [('joint',144),('expiry',9)]:
        stage=CAPTURE if name=='joint' else CAPTURE/'expiry-journeys';stage.mkdir(exist_ok=True)
        assert not (stage/'browser-report.json').exists() and not (stage/'browser-artifacts').exists()
        require_free();prior_direct(name);write_json(stage/'source-before.json',before)
        inputs=membership['joint' if name=='joint' else 'expiry'];specs=membership['jointSpecs' if name=='joint' else 'expirySpecs']
        command=['./node_modules/.bin/playwright','test',*[x.removeprefix('terminal/') for x in specs],
            '--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--output='+str(stage/'browser-artifacts/playwright')]
        if name=='expiry':command+=['--trace=on','--grep','Exposure desk (carries expiry Vanna/Charm through bars and drawer in (en|zh)|renders expiry VEX and CHEX from the enriched owner payload)$']
        env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(stage/'browser-report.json')
        with (stage/'selection.log').open('w') as log:selection=subprocess.run(command+['--list','--reporter=list'],cwd=TERMINAL,env=env,stdout=log,stderr=subprocess.STDOUT)
        assert selection.returncode==0 and re.search(r'Total:\s*'+str(count)+r' tests in ',(stage/'selection.log').read_text()),(stage/'selection.log').read_text()[-5000:]
        started=now();clock=time.monotonic();actual=command+['--reporter=list,json']
        write_json(AUDIT/(name+'-command.json'),{'command':actual,'startedAt':started,'browserStarted':True})
        owned=None
        with (stage/'browser.log').open('w') as log:
            run=subprocess.Popen(actual,cwd=TERMINAL,env=env,stdout=log,stderr=subprocess.STDOUT)
            write_json(AUDIT/(name+'-process.json'),{'pid':run.pid,'command':actual,'startedAt':started})
            while run.poll() is None:
                if owned is None:
                    owned=observe_owned_server(run.pid)
                    if owned:write_json(AUDIT/(name+'-owned-server.json'),owned)
                time.sleep(0.25)
            run.wait()
        elapsed=round(time.monotonic()-clock,3);completed=now();after=snapshot(paths);write_json(stage/'source-after.json',after)
        lifecycle=settle(stage,owned);after_checkout=checkout();assert after_checkout==observed
        artifacts=collect_direct(stage);report=json.loads((stage/'browser-report.json').read_text());passed,skipped=report_cases(report)
        assert run.returncode==0 and before==after and len(passed)==count and len(set(passed))==count and not skipped
        assert not report.get('errors') and report['stats']['unexpected']==0 and report['stats']['flaky']==0 and report['stats']['skipped']==0 and report['stats']['expected']==count
        assert report['config']['workers']==1 and report['config']['metadata']['actualWorkers']==1
        if report['config']['metadata'].get('gitCommit'):assert report['config']['metadata']['gitCommit']['hash']==HEAD
        execution={'schema':'exposure_master_integration_browser_execution.v1' if name=='joint' else 'exposure_expiry_greeks_browser_execution.v1',**context,
            'command':actual,'port':PORT,'playwrightPid':run.pid,'startedAt':started,'completedAt':completed,'seconds':elapsed,'node':node,'exit':run.returncode,
            'retries':0,'passed':len(passed),'failed':0,'skipped':0,'flaky':0,'sourceStable':True,'ownedServerStopped':True,
            'fixtureOverrides':{key:None for key in FORBIDDEN},'artifactFiles':artifacts,'logSha256':sha(stage/'browser.log'),
            'lifecycleSha256':sha(stage/'lifecycle.json'),'checkoutObservedBefore':observed,'checkoutObservedAfter':after_checkout}
        write_json(stage/'browser-execution.json',execution)
        proof={'schema':'exposure_master_integration_browser.v1' if name=='joint' else 'exposure_expiry_greeks_browser.v1',**context,
            'files':{key:sha(stage/key) for key in ['browser-report.json','browser-execution.json','source-before.json','source-after.json','browser.log']},
            'currentSources':{key:before[key] for key in inputs},'expectedPassed':sorted(passed),'expectedSkipped':[]}
        write_json(stage/'qualification.json',proof);write_json(stage/'expected-cases.json',{'expectedPassed':sorted(passed),'expectedSkipped':[]})
        validator='const fs=require("node:fs"),e=require("./e2e/tools/optionsExposureEvidence.cjs"),p=process.argv[1],kind=process.argv[2];const q=JSON.parse(fs.readFileSync(p+"/qualification.json")),x=JSON.parse(fs.readFileSync(p+"/browser-execution.json")),r=JSON.parse(fs.readFileSync(p+"/browser-report.json"));e.requireSourceKeys(q.currentSources,kind==="joint"?e.momentumBrowserInputs():e.momentumExpiryInputs());if(kind==="joint"){const prior=JSON.parse(fs.readFileSync("docs/verification/exposure-workspace-20261103/ui-copy-integration-20261109/qualification.json"));e.requireOptionsIntegrationBrowserCases(q,prior);e.requireIntegrationBrowserReport(r,q);}else{e.requireExpiryGreeksBrowserCases(q);e.requireExpiryGreeksScreenshotSet(x.artifactFiles);if(Object.keys(x.artifactFiles).filter(k=>k.endsWith("/trace.zip")).length!==9)throw Error("TRACE_SET");}console.log(JSON.stringify({state:"PROBABILITY_BROWSER_STAGE_QUALIFIED",passed:q.expectedPassed.length,artifacts:Object.keys(x.artifactFiles).length}));'
        validated=node_json(validator,[stage,name]);write_json(stage/'validation.json',validated)
        row={**validated,'qualificationSha256':sha(stage/'qualification.json'),'lifecycleSha256':sha(stage/'lifecycle.json'),'seconds':elapsed,'sourceFiles':len(before)}
        record['results'][name]=row;write_json(AUDIT/'execution.json',record);print(json.dumps({'stage':name,**row}),flush=True)
    assert snapshot(paths)==before and checkout()==observed
    record['state']='BOTH_PROBABILITY_BROWSER_STAGES_QUALIFIED_PENDING_READER_PINS';record['completedAt']=now();record['snapshotSha256']=sha(AUDIT/'source-baseline.json')
    write_json(AUDIT/'execution.json',record);print(json.dumps(record),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as error:
        if AUDIT.exists():write_json(AUDIT/'failure.json',{'state':'FAILED','at':now(),'type':type(error).__name__,'message':str(error)[:5000]})
        raise
