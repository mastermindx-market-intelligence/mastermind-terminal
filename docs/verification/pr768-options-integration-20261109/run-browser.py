from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3]
root=repo/'terminal';t=root;run=Path(__file__).resolve().parent;out=run
head='90f275f15b4d174f003fb5b1087823dce6ec865a';base='03af393ce05c12282003a3919cc473c032264922';dependency='d3bd6b2d98c6c23398be0bed6c7450caa47bd665';port=3862
def git(*args):return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True).stdout.strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,data):p.write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
def put(p,x):write(p,x)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def inspect(args):
 r=subprocess.run(args,capture_output=True,text=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'observedAt':now()}
def port_closed(port):
 r=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in [0,1] and not r['stderr'].strip();return r['exit']==1
def sources():return json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
def packet(folder):return {str(p.relative_to(folder)):sha(p) for p in sorted(folder.rglob('*')) if p.is_file()}
def reconcile_lock(port,label,extraPids=[]):
 lock=t/'.next/dev/lock'
 for _ in range(40):
  if port_closed(port):break
  time.sleep(.25)
 assert port_closed(port),'Owned listener remains live'
 if not lock.exists():return {'initialLockPresent':False,'serverAbsenceVerifiedAt':now()}
 def identity():
  st=lock.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==501
  return {'dev':st.st_dev,'ino':st.st_ino,'size':st.st_size,'mtimeNs':st.st_mtime_ns,'sha256':sha(lock),'content':json.loads(lock.read_text())}
 initial=identity();assert initial['content']['port']==port
 pids=[initial['content']['pid'],*extraPids]
 def observations(withFd):
  checks={}
  for name,args in [('listener',['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']),('recordedProcesses',['ps','-p',','.join(str(x) for x in pids),'-o','pid=,ppid=,comm='])]:
   r=inspect(args);checks[name]=r;assert r['exit']==1 and not r['stdout'].strip() and not r['stderr'].strip(),checks
  if withFd:
   r=inspect(['lsof',str(lock)]);checks['lockDescriptors']=r;assert r['exit']==1 and not r['stdout'].strip() and not r['stderr'].strip()
  else:assert not lock.exists();checks['lockDescriptors']={'state':'fileAbsent','observedAt':now()}
  r=inspect(['lsof','-a','-u','chriswong','-d','cwd','-F','pcn']);cur=[];records=[]
  for line in r['stdout'].splitlines():
   if line.startswith('p'):
    if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
    cur=[line]
   else:cur.append(line)
  if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
  checks['ownedWorkspaceCwds']={k:v for k,v in r.items() if k!='stdout'};checks['ownedWorkspaceCwds']['records']=records
  assert r['exit']==0 and not r['stderr'].strip() and not records
  return checks
 receipt={'schema':'terminal_pr768_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
assert not (root/'.next/dev/lock').exists()
assert subprocess.run(['lsof','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True).returncode==1
inputs=json.loads((run/'reviewed-input-sets.json').read_text());assert len(inputs['browser'])==71 and len(inputs['specs'])==6
for kind,packet,count in [('gex','gex-levels-heatmap-load-failure',114),('eod','eod-heatmap-flowdesk-load-failure',126)]:
 revision=root/'docs/pr-crops'/packet/'operations/exposure-source-compatibility-20261105/revisions'/'options-integration-20261109'
 receipt=json.loads((revision/'capture-execution.json').read_text())
 assert receipt['exit']==0 and receipt['expected']==count and receipt['successfulFiles']==count and receipt['sourceStable'] and len(receipt['frames'])==count and all(f['status']=='success' for f in receipt['frames'])
observed=json.loads((root/'docs/pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-source-compatibility-20261105/revisions/options-integration-20261109/capture-sources-before.json').read_text())
sourcePaths=sorted(set(observed)|set(inputs['browser']))
def snapshot():return {p:sha(repo/p) for p in sourcePaths}
proof=root/'docs/verification/exposure-workspace-20261103/options-integration-20261109'
output=root/'test-results/pr768-options-browser-raw';prior=run/'prior-browser-root'
assert not output.exists()
if proof.exists() or prior.exists():
 prepared=json.loads((run/'browser-preparation-r1.json').read_text())
 assert prepared['state']=='PREPARATION_FAILED_NO_CAPTURE'
 for p in [proof,prior]:
  identity=prepared['retainedPreparedDirectories'][str(p.relative_to(repo))];current=p.stat()
  assert p.is_dir() and not p.is_symlink() and not list(p.iterdir()) and current.st_dev==identity['device'] and current.st_ino==identity['inode']
else:
 proof.mkdir(parents=True);prior.mkdir()
(root/'test-results').mkdir(exist_ok=True)
priorInventory={}
for p in sorted((root/'test-results').iterdir()):
 if p.is_file() and p.suffix in ['.png','.json']:
  shutil.copy2(p,prior/p.name);priorInventory[p.name]={'sha256':sha(p),'mtimeNs':p.stat().st_mtime_ns,'bytes':p.stat().st_size}
write(run/'prior-browser-root.json',priorInventory)
before=snapshot();write(proof/'source-before.json',before)
env=os.environ.copy()
env["PLAYWRIGHT_BROWSERS_PATH"]=str(root/"node_modules/.cache/pr768-playwright")
overrideKeys=['EXPOSURE_P09_CURRENT_WITNESS','EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE','TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE']
for key in overrideKeys:env.pop(key,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'TERMINAL_VISUAL_EVIDENCE_OPERATION':'pr768-options-integration-20261109','PLAYWRIGHT_JSON_OUTPUT_FILE':str(proof/'browser-report.json')})
specs=[p.removeprefix('terminal/') for p in inputs['specs']]
cmd=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
historical=json.loads((root/'docs/verification/exposure-workspace-20261103/ui-copy-integration-20261109/qualification.json').read_text())['expectedPassed'];assert len(historical)==123 and len(set(historical))==123
titles=['Exposure 0DTE unknown cell withholds the total','Exposure 0DTE complete grid shows its total','Exposure All except 0DTE withholds the total when a chain expiration is outside the snapshot','[en] Exposure known subtotal keeps its date-only source session','[en] Exposure complete grid keeps its date-only source session','[zh] Exposure known subtotal keeps its date-only source session','[zh] Exposure complete grid keeps its date-only source session']
expected=[{'key':k} for k in historical+[p+'|'+title for p in ['desktop','tablet','mobile'] for title in titles]];assert len(expected)==144 and len({c['key'] for c in expected})==144
log=proof/'browser.log';assert not log.exists()
started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic();startNs=time.time_ns()
print(json.dumps({'starting':'browser','tests':144,'specs':specs,'projects':['desktop','tablet','mobile'],'sourceFiles':len(before),'port':port,'retries':0,'priorRootFilesPreserved':len(priorInventory)}),flush=True)
with log.open('w') as h:r=subprocess.run(cmd,cwd=root,env=env,stdout=h,stderr=subprocess.STDOUT)
after=snapshot();write(proof/'source-after.json',after)
ownedServerStopped=subprocess.run(['lsof','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True).returncode==1 and not (root/'.next/dev/lock').exists()
report=json.loads((proof/'browser-report.json').read_text()) if (proof/'browser-report.json').exists() else {'errors':[{'message':'missing native JSON report'}],'stats':{}}
cases=[]
def walk(s):
 for p in s.get('specs',[]):
  for t in p.get('tests',[]):cases.append({'key':t['projectName']+'|'+p['title'],'expectedStatus':t.get('expectedStatus'),'attempts':[{'status':v.get('status'),'retry':v.get('retry')} for v in t.get('results',[])]})
 for ch in s.get('suites',[]):walk(ch)
walk(report)
artifacts={}
def retain(src,relative):
 dest=proof/'browser-artifacts'/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest);artifacts[str(dest.relative_to(proof))]=sha(dest)
if output.exists():
 for p in sorted(output.rglob('*')):
  if p.is_file():retain(p,Path('playwright')/p.relative_to(output))
for p in sorted((root/'test-results').iterdir()):
 if p.is_file() and p.suffix in ['.png','.json'] and p.stat().st_mtime_ns>=startNs:retain(p,Path('direct')/p.name)
stats=report.get('stats',{});execution={'schema':'exposure_master_integration_browser_execution.v1','branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'command':cmd,'port':port,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':round(time.monotonic()-start,2),'exit':r.returncode,'retries':0,'sourceStable':before==after,'ownedServerStopped':ownedServerStopped,'passed':stats.get('expected',0),'failed':stats.get('unexpected',0),'skipped':stats.get('skipped',0),'flaky':stats.get('flaky',0),'fixtureOverrides':{k:env.get(k) for k in overrideKeys},'artifactFiles':artifacts,'logSha256':sha(log),'node':subprocess.run(['node','--version'],capture_output=True,text=True,check=True).stdout.strip()}
write(proof/'browser-execution.json',execution)
execution['initialOwnedServerStopped']=ownedServerStopped
execution['lifecycle']=reconcile_lock(port,'options-browser')
execution['ownedServerStopped']=ownedServerStopped=port_closed(port) and not(root/'.next/dev/lock').exists()
write(proof/'browser-execution.json',execution)
valid=r.returncode==0 and before==after and ownedServerStopped and not report.get('errors') and execution['passed']==144 and execution['failed']==0 and execution['skipped']==0 and execution['flaky']==0 and sorted(c['key'] for c in cases)==sorted(c['key'] for c in expected) and all(c['attempts']==[{'status':'passed','retry':0}] for c in cases) and bool(artifacts)
print(json.dumps({'finished':'browser','accepted':valid,'exit':r.returncode,'passed':execution['passed'],'failed':execution['failed'],'skipped':execution['skipped'],'flaky':execution['flaky'],'sourceStable':before==after,'ownedServerStopped':ownedServerStopped,'artifacts':len(artifacts),'seconds':execution['seconds']}),flush=True)
if not valid:print(log.read_text()[-16000:],flush=True);raise SystemExit(1)
files=['browser-report.json','browser-execution.json','source-before.json','source-after.json','browser.log']
qualification={'schema':'exposure_master_integration_browser.v1','branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'files':{p:sha(proof/p) for p in files},'currentSources':{p:before[p] for p in inputs['browser']},'expectedPassed':sorted(c['key'] for c in cases),'expectedSkipped':[]}
write(proof/'qualification.json',qualification)
print(json.dumps({'browserQualificationSha256':sha(proof/'qualification.json'),'currentInputs':len(qualification['currentSources'])}),flush=True)