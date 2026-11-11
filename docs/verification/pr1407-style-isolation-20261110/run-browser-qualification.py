from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,re,stat
repo=Path(__file__).resolve().parents[3];terminal=repo/'terminal';proof=Path(__file__).resolve().parent;port=47407
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def put(path,value):path.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
def observe(args):
    r=subprocess.run(args,text=True,capture_output=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def closed():
    r=observe(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in (0,1) and not r['stderr'].strip();return r['exit']==1
def snapshot():return json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
def settle(out):
    for _ in range(20):
        if closed():break
        time.sleep(.25)
    assert closed(),'owned listener remains'
    lock=terminal/'.next/dev/lock';receipt={'at':now(),'port':port,'listenerClosed':True,'lockPresent':lock.exists()}
    if lock.exists():
        initial=lock.read_bytes();data=json.loads(initial);st=lock.lstat()
        assert data['port']==port and stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid()
        checks={}
        for key,args in [('pid',['ps','-p',str(data['pid']),'-o','pid=,ppid=,comm=']),('lock',['lsof',str(lock)])]:
            checks[key]=observe(args);assert checks[key]['exit']==1 and not checks[key]['stdout'].strip() and not checks[key]['stderr'].strip(),checks
        cwd=observe(['lsof','-a','-u',str(os.getuid()),'-d','cwd','-F','pcn'])
        assert cwd['exit']==0 and not cwd['stderr'].strip() and not any(x.startswith('n'+str(repo)) for x in cwd['stdout'].splitlines())
        receipt.update({'lock':data,'lockSha256':hashlib.sha256(initial).hexdigest(),'checks':checks,'workspaceCwdHolders':[]})
        put(out/'lifecycle.json',receipt);assert lock.read_bytes()==initial and lock.lstat().st_ino==st.st_ino and closed();lock.unlink()
    receipt['state']='OWNED_SERVER_STOPPED';receipt['completedAt']=now();put(out/'lifecycle.json',receipt)
    return receipt
assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()=='3e376bb93c0cdd9dc55b110186fcfea62d0cd746'
assert json.loads((proof/'qualification.json').read_text())['state']=='QUALIFIED'
assert closed() and not (terminal/'.next/dev/lock').exists()
baseline=snapshot();assert all(p in baseline for p in ['terminal/components/IndicatorsModal.module.css','terminal/components/LayoutMenu.module.css'])
baseEnv=os.environ.copy();baseEnv.update({'CI':'1','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_E2E_PORT':str(port)})
for key in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_VISUAL_EVIDENCE_OPERATION','PLAYWRIGHT_JSON_OUTPUT_FILE']:baseEnv.pop(key,None)
prefix=['node','node_modules/@playwright/test/cli.js','test']
projects=['--project=desktop','--project=tablet','--project=mobile']
focus='workspace rename keeps the keyboard task intact|late rename success never replays|unreadable workspace actions stay keyboard accessible|script rename and touch actions keep the whole task intact'
states='ready / empty / row-open / renaming / unsupported-rows / name-conflict / stale|ready / unavailable / stale, no English leaking through|stale in zh|390-en-stale|tap targets are >=44x44|zero horizontal document overflow|1440 EN/ZH grouped library, share confirm|820 EN grouped library tap targets'
stages=[
 ('workspace-library',['e2e/workspace-rename-focus.spec.ts','e2e/scripts-library.spec.ts',*projects,'--grep',focus],16,2),
 ('workspace-states',['e2e/w2a-workspaces.spec.ts','--project=w2a-workspaces','--grep',states],9,0),
 ('chart-layers',['e2e/chart-object-tree.spec.ts',*projects,'--trace=on'],7,2),
]
overall={'schema':'terminal_pr1407_style_browser_qualification.v1','state':'RUNNING','sourceHead':'3e376bb93c0cdd9dc55b110186fcfea62d0cd746','sourceEntries':len(baseline),'startedAt':now(),'results':{}}
put(proof/'browser-qualification.json',overall)
for name,args,passed,skipped in stages:
    out=proof/name;assert not out.exists();out.mkdir();output=terminal/('test-results/pr1407-style-'+name);assert not output.exists()
    env=baseEnv.copy();env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(out/'browser-report.json')
    command=[*prefix,*args,'--workers=1','--retries=0','--max-failures=1']
    listing=subprocess.run([*command,'--list','--reporter=list'],cwd=terminal,env=env,text=True,capture_output=True)
    (out/'selection.log').write_text(listing.stdout+listing.stderr)
    assert listing.returncode==0 and re.search(r'Total: '+str(passed+skipped)+r' tests? in ',listing.stdout),(name,listing.stdout[-4000:],listing.stderr)
    before=snapshot();assert before==baseline;put(out/'source-before.json',before)
    generatedDir=terminal/'e2e/proof/w2a-workspaces';generatedBefore={str(p.relative_to(repo)):sha(p) for p in generatedDir.rglob('*.png')} if generatedDir.exists() else {}
    tracked=set(subprocess.check_output(['git','-C',str(repo),'ls-files','terminal/e2e/proof/w2a-workspaces'],text=True).splitlines())
    if name=='workspace-states':
        assert all(hashlib.sha256(subprocess.check_output(['git','-C',str(repo),'show','HEAD:'+path])).hexdigest()==digest for path,digest in generatedBefore.items() if path in tracked)
    cmd=[*command,'--reporter=list,json','--output='+str(output)]
    record={'schema':'terminal_pr1407_style_browser_stage.v1','stage':name,'state':'RUNNING','command':cmd,'sourceHead':overall['sourceHead'],'sourceEntries':len(before),'startedAt':now(),'expectedPassed':passed,'expectedAuthoredSkips':skipped,'port':port,'sharedShell':0,'investorPreview':0}
    put(out/'execution.json',record);print(json.dumps({'starting':name,'selectedCases':passed+skipped,'expectedPass':passed,'expectedSkips':skipped}),flush=True);start=time.monotonic()
    with (out/'browser.log').open('w') as log:r=subprocess.run(cmd,cwd=terminal,env=env,stdout=log,stderr=subprocess.STDOUT)
    report=json.loads((out/'browser-report.json').read_text()) if (out/'browser-report.json').exists() else {'errors':[{'message':'missing report'}],'stats':{}}
    cases=[]
    def walk(value):
        for spec in value.get('specs',[]):
            for test in spec.get('tests',[]):cases.append({'project':test['projectName'],'title':spec['title'],'expectedStatus':test.get('expectedStatus'),'attempts':[{'status':x.get('status'),'retry':x.get('retry')} for x in test.get('results',[])]})
        for child in value.get('suites',[]):walk(child)
    walk(report)
    artifacts={}
    for file in sorted(output.rglob('*')):
        if file.is_file():
            dest=out/'artifacts'/file.relative_to(output);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest);artifacts[str(dest.relative_to(out))]=sha(dest)
    generated={}
    if name=='workspace-states':
        for file in generatedDir.rglob('*.png'):
            path=str(file.relative_to(repo));digest=sha(file)
            if generatedBefore.get(path)!=digest:
                dest=out/'generated-crops'/file.relative_to(generatedDir);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest);generated[path]={'sha256':digest,'artifact':str(dest.relative_to(out)),'priorSha256':generatedBefore.get(path)}
                if path in tracked:file.write_bytes(subprocess.check_output(['git','-C',str(repo),'show','HEAD:'+path]))
                elif path not in generatedBefore:file.unlink()
                else:raise AssertionError('Existing untracked output changed: '+path)
    after=snapshot();put(out/'source-after.json',after);lifecycle=settle(out)
    stats=report.get('stats',{});valid=r.returncode==0 and before==after and not report.get('errors') and stats.get('expected')==passed and stats.get('skipped')==skipped and stats.get('unexpected',0)==0 and stats.get('flaky',0)==0 and all(len(c['attempts'])==1 and c['attempts'][0]['retry']==0 and c['attempts'][0]['status'] in ['passed','skipped'] for c in cases)
    record.update({'state':'QUALIFIED' if valid else 'FAILED','exit':r.returncode,'stats':stats,'cases':cases,'errors':report.get('errors',[]),'sourceStable':before==after,'ownedServerStopped':closed() and not (terminal/'.next/dev/lock').exists(),'seconds':round(time.monotonic()-start,2),'completedAt':now(),'logSha256':sha(out/'browser.log'),'reportSha256':sha(out/'browser-report.json') if (out/'browser-report.json').exists() else None,'lifecycleSha256':sha(out/'lifecycle.json'),'artifacts':artifacts,'generatedWorkspaceCrops':generated})
    put(out/'execution.json',record)
    summary={k:record[k] for k in ['state','exit','stats','sourceStable','ownedServerStopped','seconds']};summary['executionSha256']=sha(out/'execution.json')
    overall['results'][name]=summary;put(proof/'browser-qualification.json',overall);print(json.dumps({'finished':name,**summary}),flush=True)
    if not valid:print((out/'browser.log').read_text()[-10000:],flush=True)
overall['state']='QUALIFIED' if all(x['state']=='QUALIFIED' for x in overall['results'].values()) and len(overall['results'])==3 else 'FAILED';overall['completedAt']=now();overall['sourceStable']=snapshot()==baseline
put(proof/'browser-qualification.json',overall);print(json.dumps({'complete':overall}),flush=True)
raise SystemExit(0 if overall['state']=='QUALIFIED' and overall['sourceStable'] else 1)
