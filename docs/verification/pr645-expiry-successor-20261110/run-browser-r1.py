from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,re,stat
repo=Path(__file__).resolve().parents[3];terminal=repo/'terminal';proof=Path(__file__).resolve().parent;port=47465
head='a985bf7f37b9a5a9fc490f8b3eb72be04869bfe4';base='dad33e10089c9d51d931a1fe72e7fa1acb37abe1';dependency='9ef372c8086ceaac8bcb153bd2d2d71b5b63d62c'
def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def put(path,value):path.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
def observe(args):
    r=subprocess.run(args,text=True,capture_output=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def closed():
    r=observe(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in (0,1) and not r['stderr'].strip();return r['exit']==1
def snapshot():
    paths=set(git('ls-files','--cached','--others','--exclude-standard').splitlines())
    selected={p for p in paths if p.startswith('terminal/') and not p.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')) and re.search(r'\.(?:ts|tsx|css|js|cjs|mjs|json)$',p)}
    incumbent=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
    selected.update(incumbent);selected.update(inputs['expiry'])
    return {p:sha(repo/p) for p in sorted(selected)}
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
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
assert closed() and not (terminal/'.next/dev/lock').exists()
assert json.loads((proof/'native-validation-r1.json').read_text())['state']=='NATIVE_CAPTURE_QUALIFIED_PENDING_BROWSER_AND_DESCRIPTOR'
inputs=json.loads((proof/'reviewed-input-sets.json').read_text())
assert {k:len(inputs[k]) for k in ['gex','eod','browser','expiry','specs']}=={'gex':29,'eod':32,'browser':71,'expiry':76,'specs':6}
subprocess.run(['node','--check','terminal/e2e/tools/optionsExposureEvidence.cjs'],cwd=repo,check=True)
native=terminal/'docs/pr-crops/gex-levels-heatmap-load-failure/operations/exposure-source-compatibility-20261105/revisions/expiry-greeks-integration-20261110'
nativeBefore=json.loads((native/'capture-sources-before.json').read_text())
eod=terminal/'docs/pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-source-compatibility-20261105/revisions/options-integration-20261109'
eodBefore=json.loads((eod/'capture-sources-before.json').read_text())
assert all(sha(repo/p)==nativeBefore[p] for p in inputs['gex']) and all(sha(repo/p)==eodBefore[p] for p in inputs['eod'])
priorQualification=json.loads((terminal/'docs/verification/exposure-workspace-20261103/options-integration-20261109/qualification.json').read_text())
expected144=priorQualification['expectedPassed'];assert len(expected144)==len(set(expected144))==144 and not priorQualification['expectedSkipped']
titles=['Exposure desk carries expiry Vanna/Charm through bars and drawer in en','Exposure desk carries expiry Vanna/Charm through bars and drawer in zh','Exposure desk renders expiry VEX and CHEX from the enriched owner payload']
expected9=[p+'|'+title for p in ['desktop','tablet','mobile'] for title in titles]
browserRoot=terminal/'docs/verification/exposure-workspace-20261103/expiry-greeks-integration-20261110'
assert not browserRoot.exists();browserRoot.mkdir(parents=True)
baseline=snapshot();baseEnv=os.environ.copy()
overrides=['EXPOSURE_P09_CURRENT_WITNESS','EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE','TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE']
for key in [*overrides,'PLAYWRIGHT_JSON_OUTPUT_FILE','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID']:baseEnv.pop(key,None)
baseEnv.update({'CI':'1','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_E2E_PORT':str(port),'TERMINAL_VISUAL_EVIDENCE_OPERATION':'pr645-expiry-greeks-integration-20261110','PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright'})
stages=[
('integration',browserRoot,[p.removeprefix('terminal/') for p in inputs['specs']],[],expected144,inputs['browser'],'exposure_master_integration_browser_execution.v1','exposure_master_integration_browser.v1'),
('expiry',browserRoot/'expiry-journeys',['e2e/exposure-expiry-greeks.spec.ts','e2e/responsive.spec.ts'],['--grep','Exposure desk (carries expiry Vanna/Charm through bars and drawer in (en|zh)|renders expiry VEX and CHEX from the enriched owner payload)$','--trace=on'],expected9,inputs['expiry'],'exposure_expiry_greeks_browser_execution.v1','exposure_expiry_greeks_browser.v1')
]
overall={'schema':'terminal_pr645_browser_successor_validation.v1','state':'RUNNING','branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'startedAt':now(),'sourceEntries':len(baseline),'results':{}}
put(proof/'browser-validation-r1.json',overall)
for name,out,specs,extra,expected,currentInputs,executionSchema,qualificationSchema in stages:
 if name=='expiry':out.mkdir()
 assert closed() and not (terminal/'.next/dev/lock').exists()
 output=terminal/('test-results/pr645-expiry-successor-'+name+'-r1');assert not output.exists()
 priorRoot=proof/('prior-browser-root-'+name);assert not priorRoot.exists();priorRoot.mkdir()
 (terminal/'test-results').mkdir(exist_ok=True)
 priorInventory={}
 for file in sorted((terminal/'test-results').iterdir()):
  if file.is_file() and file.suffix in ['.png','.json']:
   shutil.copy2(file,priorRoot/file.name);priorInventory[file.name]={'sha256':sha(file),'mtimeNs':file.stat().st_mtime_ns,'bytes':file.stat().st_size}
 put(proof/('prior-browser-root-'+name+'.json'),priorInventory)
 env=baseEnv.copy();env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(out/'browser-report.json')
 cmd=['node','node_modules/@playwright/test/cli.js','test',*specs,*extra,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
 listed=subprocess.run([*cmd,'--list','--reporter=list'],cwd=terminal,env=env,capture_output=True,text=True)
 (proof/(name+'-selection.log')).write_text(listed.stdout+listed.stderr)
 assert listed.returncode==0 and re.search(r'Total: '+str(len(expected))+r' tests? in ',listed.stdout),(listed.returncode,listed.stdout[-6000:],listed.stderr)
 before=snapshot();assert before==baseline;put(out/'source-before.json',before)
 started=now();start=time.monotonic();startNs=time.time_ns();log=out/'browser.log'
 print(json.dumps({'starting':name,'expected':len(expected),'sourceFiles':len(before),'port':port,'specs':specs,'retries':0}),flush=True)
 with log.open('w') as h:r=subprocess.run(cmd,cwd=terminal,env=env,stdout=h,stderr=subprocess.STDOUT)
 after=snapshot();put(out/'source-after.json',after);lifecycle=settle(out)
 report=json.loads((out/'browser-report.json').read_text()) if (out/'browser-report.json').exists() else {'errors':[{'message':'missing report'}],'stats':{}}
 cases=[]
 def walk(value):
  for spec in value.get('specs',[]):
   for test in spec.get('tests',[]):cases.append({'key':test['projectName']+'|'+spec['title'],'expectedStatus':test.get('expectedStatus'),'attempts':[{'status':x.get('status'),'retry':x.get('retry')} for x in test.get('results',[])]})
  for child in value.get('suites',[]):walk(child)
 walk(report)
 artifacts={}
 def retain(src,relative):
  dest=out/'browser-artifacts'/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest);artifacts[str(dest.relative_to(out))]=sha(dest)
 for file in sorted(output.rglob('*')):
  if file.is_file():retain(file,Path('playwright')/file.relative_to(output))
 for file in sorted((terminal/'test-results').iterdir()):
  if file.is_file() and file.suffix in ['.png','.json'] and file.stat().st_mtime_ns>=startNs:retain(file,Path('direct')/file.name)
 stats=report.get('stats',{});execution={'schema':executionSchema,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'command':cmd,'port':port,'startedAt':started,'completedAt':now(),'seconds':round(time.monotonic()-start,2),'exit':r.returncode,'retries':0,'sourceStable':before==after,'ownedServerStopped':closed() and not (terminal/'.next/dev/lock').exists(),'passed':stats.get('expected',0),'failed':stats.get('unexpected',0),'skipped':stats.get('skipped',0),'flaky':stats.get('flaky',0),'fixtureOverrides':{k:env.get(k) for k in overrides},'artifactFiles':artifacts,'logSha256':sha(log),'node':subprocess.check_output(['node','--version'],text=True).strip(),'lifecycleSha256':sha(out/'lifecycle.json')}
 put(out/'browser-execution.json',execution)
 valid=r.returncode==0 and before==after and execution['ownedServerStopped'] and not report.get('errors') and execution['passed']==len(expected) and execution['failed']==execution['skipped']==execution['flaky']==0 and sorted(c['key'] for c in cases)==sorted(expected) and all(c['attempts']==[{'status':'passed','retry':0}] for c in cases) and bool(artifacts)
 if name=='expiry':
  required=[project+'-'+locale+'-expiry-'+state+'.png' for project in ['desktop','tablet','mobile'] for locale in ['en','zh'] for state in ['vanna-bars','vanna-drawer','charm-drawer','charm-bars']]+[project+'-expiry-vex-chex.png' for project in ['desktop','tablet','mobile']]
  actual=[Path(p).name for p in artifacts if p.endswith('.png')]
  valid=valid and len(actual)==len(set(actual))==27 and sorted(actual)==sorted(required)
  put(proof/'expiry-artifact-case-readback.json',{'expected':sorted(required),'actual':sorted(actual),'matches':sorted(actual)==sorted(required),'count':len(actual)})
 summary={'state':'QUALIFIED' if valid else 'FAILED','exit':r.returncode,'passed':execution['passed'],'failed':execution['failed'],'skipped':execution['skipped'],'flaky':execution['flaky'],'sourceStable':before==after,'ownedServerStopped':execution['ownedServerStopped'],'artifacts':len(artifacts),'seconds':execution['seconds']}
 if valid:
  names=['browser-report.json','browser-execution.json','source-before.json','source-after.json','browser.log']
  qualification={'schema':qualificationSchema,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'files':{p:sha(out/p) for p in names},'currentSources':{p:before[p] for p in currentInputs},'expectedPassed':sorted(c['key'] for c in cases),'expectedSkipped':[]}
  put(out/'qualification.json',qualification);summary['qualificationSha256']=sha(out/'qualification.json');summary['currentInputs']=len(currentInputs)
 overall['results'][name]=summary;put(proof/'browser-validation-r1.json',overall);print(json.dumps({'finished':name,**summary}),flush=True)
 if not valid:
  overall['state']='FAILED';overall['completedAt']=now();put(proof/'browser-validation-r1.json',overall);print(log.read_text()[-14000:],flush=True);raise SystemExit(1)
overall.update({'state':'BROWSER_PROOFS_QUALIFIED_PENDING_READER_AND_DESCRIPTOR','completedAt':now(),'sourceStable':snapshot()==baseline});put(proof/'browser-validation-r1.json',overall);print(json.dumps(overall),flush=True)
